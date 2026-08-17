"""V25.c: Voice transcription (/ai/transcribe) endpoint tests."""
import os, base64, pytest, requests
from pathlib import Path

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email":"test@dalpastro.it","password":"Test1234!"}, timeout=15)
    return r.json()["token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def tok(): return _login()


class TestTranscribe:
    def test_auth_required(self):
        r = requests.post(f"{BASE_URL}/api/ai/transcribe", json={"audio_base64":"aGVsbG8="}, timeout=15)
        assert r.status_code == 401

    def test_invalid_base64(self, tok):
        r = requests.post(f"{BASE_URL}/api/ai/transcribe", headers=_h(tok),
                          json={"audio_base64":"@@@invalid@@@", "mime":"audio/webm"}, timeout=15)
        assert r.status_code == 400

    def test_too_short(self, tok):
        # 100 byte payload
        tiny = base64.b64encode(b"x" * 100).decode()
        r = requests.post(f"{BASE_URL}/api/ai/transcribe", headers=_h(tok),
                          json={"audio_base64": tiny, "mime":"audio/webm"}, timeout=15)
        assert r.status_code == 400

    def test_real_italian_audio(self, tok):
        # Generate a real Italian audio if ffmpeg + espeak-ng are available
        webm_path = "/tmp/pytest_hello.webm"
        wav_path = "/tmp/pytest_hello.wav"
        import subprocess, shutil
        if not (shutil.which("ffmpeg") and shutil.which("espeak-ng")):
            pytest.skip("ffmpeg/espeak-ng not installed")
        subprocess.run(["espeak-ng","-v","it","Ciao Mario questo è un test.","-w", wav_path], check=True, capture_output=True)
        subprocess.run(["ffmpeg","-y","-i", wav_path, "-c:a","libopus", webm_path], check=True, capture_output=True)
        b64 = base64.b64encode(Path(webm_path).read_bytes()).decode()
        r = requests.post(f"{BASE_URL}/api/ai/transcribe", headers=_h(tok),
                          json={"audio_base64": b64, "mime":"audio/webm"}, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["language"] == "it"
        assert j["model"] == "whisper-1"
        assert isinstance(j["transcript"], str) and len(j["transcript"]) > 0
        # Basic sanity — should contain at least one word from the input
        low = j["transcript"].lower()
        assert any(w in low for w in ("ciao","mario","test")), f"Unexpected transcript: {j['transcript']}"
