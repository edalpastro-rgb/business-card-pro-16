"""V50.z397 — Corporate Gym Live: from-recording/upload + live/start opening determinism.

Tests:
1) POST /api/cgym/live/from-recording/upload with generated WAV → 200, status=processing, session_id.
2) Poll GET /api/cgym/live/{id} → status transitions to done or error (both acceptable outcomes).
3) POST /api/cgym/live/from-recording/upload with tiny text file → 400 (Italian message).
4) POST /api/cgym/live/from-recording/upload without auth → 401/403.
5) POST /api/cgym/live/start deterministic opening: 'Prego, si accomodi. Mi dica.' (no ANT area).
6) Regression: POST /api/cgym/live/from-recording (legacy JSON base64) → 200/400/502 (not 500).
"""
import base64
import io
import math
import os
import struct
import time
import wave

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def areas(token):
    r = requests.get(f"{BASE_URL}/api/cgym/areas",
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data.get("items"), list) and len(data["items"]) > 0
    return data["items"]


def _gen_wav_bytes(duration_sec=3, freq=440, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        for i in range(int(duration_sec * rate)):
            s = int(32767 * 0.3 * math.sin(2 * math.pi * freq * i / rate))
            w.writeframes(struct.pack("<h", s))
    return buf.getvalue()


class TestCgymRecordingUpload:
    """POST /api/cgym/live/from-recording/upload — multipart audio path."""

    def test_upload_wav_returns_processing_and_completes(self, token, areas):
        area_id = areas[0]["area_id"]
        wav = _gen_wav_bytes(duration_sec=3)
        files = {"file": ("test.wav", wav, "audio/wav")}
        data = {"area_id": area_id, "title": "TEST_recording_upload", "training_level": "base"}
        r = requests.post(f"{BASE_URL}/api/cgym/live/from-recording/upload",
                          headers={"Authorization": f"Bearer {token}"},
                          files=files, data=data, timeout=60)
        assert r.status_code == 200, f"Upload failed: {r.status_code} {r.text[:300]}"
        session = r.json()
        assert session.get("status") == "processing", f"Expected processing, got {session.get('status')}"
        session_id = session.get("session_id")
        assert session_id and session_id.startswith("cgl_")

        # Poll up to ~90s
        deadline = time.time() + 100
        last_status = "processing"
        while time.time() < deadline:
            time.sleep(5)
            gr = requests.get(f"{BASE_URL}/api/cgym/live/{session_id}",
                              headers={"Authorization": f"Bearer {token}"}, timeout=30)
            assert gr.status_code == 200
            last_status = gr.json().get("status")
            if last_status in ("done", "error"):
                break
        assert last_status in ("done", "error"), f"Session stuck at status={last_status} (bug)"
        print(f"Final status: {last_status}")

    def test_upload_tiny_text_returns_400_italian(self, token, areas):
        area_id = areas[0]["area_id"]
        files = {"file": ("test.txt", b"hi", "text/plain")}
        data = {"area_id": area_id, "training_level": "base"}
        r = requests.post(f"{BASE_URL}/api/cgym/live/from-recording/upload",
                          headers={"Authorization": f"Bearer {token}"},
                          files=files, data=data, timeout=30)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text[:200]}"
        detail = r.json().get("detail", "")
        assert any(w in detail.lower() for w in ["vuoto", "audio", "video", "leggibile"]), f"Detail not Italian: {detail}"

    def test_upload_without_auth_returns_401_or_403(self, areas):
        area_id = areas[0]["area_id"]
        wav = _gen_wav_bytes(duration_sec=1)
        files = {"file": ("test.wav", wav, "audio/wav")}
        data = {"area_id": area_id, "training_level": "base"}
        r = requests.post(f"{BASE_URL}/api/cgym/live/from-recording/upload",
                          files=files, data=data, timeout=30)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"


class TestCgymLiveStartOpening:
    """POST /api/cgym/live/start — deterministic opening 'Prego, si accomodi. Mi dica.'"""

    def test_all_areas_return_deterministic_client_opening(self, token, areas):
        expected = "Prego, si accomodi. Mi dica."
        for a in areas:
            body = {"area_id": a["area_id"], "training_level": "base"}
            r = requests.post(f"{BASE_URL}/api/cgym/live/start",
                              headers={"Authorization": f"Bearer {token}"},
                              json=body, timeout=30)
            assert r.status_code == 200, f"start failed for {a['name']}: {r.status_code} {r.text[:200]}"
            js = r.json()
            turns = js.get("turns") or []
            assert turns, f"No turns for area {a['name']}"
            first = turns[0]
            assert first.get("role") == "client"
            assert first.get("text") == expected, (
                f"Area {a['name']}: expected opening '{expected}', got '{first.get('text')}'"
            )
            # audio_base64 may be present or null; presence checked (key exists in response)
            assert "audio_base64" in js


class TestCgymLegacyFromRecording:
    """Regression: POST /api/cgym/live/from-recording (JSON base64)."""

    def test_legacy_json_endpoint_does_not_500(self, token, areas):
        area_id = areas[0]["area_id"]
        wav = _gen_wav_bytes(duration_sec=2)
        body = {
            "area_id": area_id,
            "audio_base64": base64.b64encode(wav).decode("ascii"),
            "mime": "audio/wav",
            "title": "TEST_legacy",
            "training_level": "base",
        }
        r = requests.post(f"{BASE_URL}/api/cgym/live/from-recording",
                          headers={"Authorization": f"Bearer {token}"},
                          json=body, timeout=120)
        assert r.status_code in (200, 400, 502), f"Unexpected status {r.status_code}: {r.text[:200]}"
        assert r.status_code != 500
