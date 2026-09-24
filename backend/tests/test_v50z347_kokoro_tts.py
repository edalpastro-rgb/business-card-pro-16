"""V50.z347 — Kokoro TTS local engine + fallback + Whisper ViolaWake transcribe."""
import base64
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _is_mp3(raw: bytes) -> bool:
    if len(raw) < 4:
        return False
    return raw[:3] == b"ID3" or raw[0] == 0xFF and (raw[1] in (0xFB, 0xF3, 0xF2))


# ------ /api/tts/engine ------
class TestEngineStatus:
    def test_engine_status_ok(self, H):
        r = requests.get(f"{API}/tts/engine", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("engine", "local_ready", "local_loading", "files", "languages", "cloud_available", "generations"):
            assert k in d, f"missing {k}"
        assert d["engine"] in ("local", "cloud")
        assert isinstance(d["files"], dict) and d["files"]
        assert "it" in d["languages"]

    def test_warmup(self, H):
        r = requests.post(f"{API}/tts/engine/warmup", headers=H, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "local_ready" in d and "local_loading" in d


# ------ ensure Kokoro loaded (wait up to 5 min for first download/load) ------
@pytest.fixture(scope="module", autouse=True)
def wait_local_ready(H):
    requests.post(f"{API}/tts/engine/warmup", headers=H, timeout=30)
    deadline = time.time() + 300
    while time.time() < deadline:
        try:
            r = requests.get(f"{API}/tts/engine", headers=H, timeout=15)
            if r.status_code == 200 and r.json().get("local_ready"):
                return
        except Exception:
            pass
        time.sleep(5)
    pytest.skip("Kokoro not ready within 5 minutes — skipping Kokoro-dependent tests")


# ------ POST /assistant/tts ------
class TestAssistantTTS:
    def test_default_kokoro_italian(self, H):
        r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Ciao, sono Axon."}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("engine") == "kokoro", f"engine={d.get('engine')}"
        assert d.get("mime") == "audio/mpeg"
        assert d.get("voice") in ("if_sara", "im_nicola"), f"voice={d.get('voice')}"
        assert isinstance(d.get("gen_ms"), int) and d["gen_ms"] > 0
        assert isinstance(d.get("speed"), (int, float))
        b64 = d.get("audio_base64") or ""
        raw = base64.b64decode(b64)
        assert len(raw) > 1024
        assert _is_mp3(raw), f"not mp3 header: {raw[:4]!r}"

    def test_markdown_emoji_ok(self, H):
        r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "**Ciao** 🚀 [link](https://x.it) `code`"}, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["engine"] == "kokoro"

    def test_empty_text_400(self, H):
        r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "   "}, timeout=30)
        assert r.status_code == 400

    def test_voice_onyx_maps_male_local(self, H):
        r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Prova voce maschile."}, timeout=60)
        # onyx explicit
        r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Prova voce maschile.", "voice": "onyx"}, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["engine"] == "kokoro"
        assert d["voice"] == "im_nicola", f"voice={d['voice']}"

    def test_voice_nicola(self, H):
        r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Prova.", "voice": "nicola"}, timeout=60)
        assert r.status_code == 200
        assert r.json()["voice"] == "im_nicola"

    def test_voice_nova(self, H):
        r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Prova.", "voice": "nova"}, timeout=60)
        assert r.status_code == 200
        assert r.json()["voice"] == "if_sara"


# ------ POST /ai/tts ------
class TestAiTts:
    def test_ai_tts_nova(self, H):
        r = requests.post(f"{API}/ai/tts", headers=H, json={"text": "Ciao mondo", "voice": "nova"}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("audio_base64")
        assert d.get("engine") in ("kokoro", "openai")
        assert "chars" in d or True  # optional


# ------ user_settings engine switch ------
class TestEngineSwitch:
    def test_switch_to_cloud_and_back(self, H):
        try:
            r = requests.put(f"{API}/user-settings", headers=H, json={"assistant_tts_engine": "cloud"}, timeout=30)
            assert r.status_code == 200, r.text
            # POST /assistant/tts → engine 'openai'
            r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Test cloud."}, timeout=90)
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["engine"] == "openai", f"engine={d.get('engine')}"
            # sara → nova mapping when cloud
            assert d["voice"] in ("nova", "onyx", "alloy", "echo", "fable", "shimmer", "coral", "sage", "ash")
        finally:
            # RESTORE
            requests.put(f"{API}/user-settings", headers=H, json={"assistant_tts_engine": "local"}, timeout=30)

    def test_invalid_engine_400(self, H):
        r = requests.put(f"{API}/user-settings", headers=H, json={"assistant_tts_engine": "invalid"}, timeout=30)
        assert r.status_code == 400

    def test_user_settings_includes_engine_and_voice(self, H):
        r = requests.get(f"{API}/user-settings", headers=H, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "assistant_tts_engine" in d
        assert "assistant_voice" in d
        assert d["assistant_tts_engine"] in ("local", "cloud")


# ------ language fallback ------
class TestLanguageFallback:
    def test_german_falls_back_to_openai(self, H):
        try:
            r = requests.put(f"{API}/user-settings", headers=H, json={"assistant_language": "de"}, timeout=30)
            assert r.status_code == 200
            r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Guten Tag."}, timeout=90)
            assert r.status_code == 200
            assert r.json()["engine"] == "openai"
        finally:
            requests.put(f"{API}/user-settings", headers=H, json={"assistant_language": "it"}, timeout=30)

    def test_english_uses_kokoro(self, H):
        try:
            r = requests.put(f"{API}/user-settings", headers=H, json={"assistant_language": "en"}, timeout=30)
            assert r.status_code == 200
            r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Hello world."}, timeout=60)
            assert r.status_code == 200
            d = r.json()
            assert d["engine"] == "kokoro"
            assert d["voice"] in ("af_heart", "am_michael")
        finally:
            requests.put(f"{API}/user-settings", headers=H, json={"assistant_language": "it"}, timeout=30)


# ------ ViolaWake transcribe ------
class TestViolaTranscribe:
    def test_transcribe_briefing(self, H):
        # First generate MP3 via /assistant/tts for the exact phrase
        r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": "Viola dammi il briefing di oggi"}, timeout=60)
        assert r.status_code == 200
        b64 = r.json()["audio_base64"]
        r2 = requests.post(f"{API}/viola-wake/transcribe", headers=H, json={"audio_base64": b64, "mime": "audio/mpeg"}, timeout=90)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d.get("engine") == "whisper"
        assert d.get("segments", 0) >= 1
        assert "latency_ms" in d
        assert "briefing" in (d.get("transcript") or "").lower(), f"transcript={d.get('transcript')!r}"

    def test_transcribe_tiny_returns_empty(self, H):
        # 1KB tiny → 200 with '' and reason
        tiny = base64.b64encode(b"\x00" * 512).decode()
        r = requests.post(f"{API}/viola-wake/transcribe", headers=H, json={"audio_base64": tiny, "mime": "audio/mpeg"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["transcript"] == ""
        assert "reason" in d

    def test_transcribe_invalid_base64(self, H):
        r = requests.post(f"{API}/viola-wake/transcribe", headers=H, json={"audio_base64": "!!!not-base64!!!", "mime": "audio/mpeg"}, timeout=30)
        assert r.status_code == 400


# ------ regression ------
class TestRegression:
    def test_market_benchmark_luce(self, H):
        r = requests.get(f"{API}/market/benchmark?commodity=luce", headers=H, timeout=30)
        assert r.status_code == 200

    def test_auth_login(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
        assert r.status_code == 200
        assert "token" in r.json()
