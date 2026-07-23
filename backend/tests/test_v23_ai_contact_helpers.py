"""V23 — AI Contact Helpers (URL / Voice / Card) tests."""
import os
import base64
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if v:
        return v
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.strip().startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set")

BASE_URL = _load_backend_url().rstrip("/")

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    if data.get("requires_2fa"):
        pytest.skip("2FA enabled on test account — cannot test")
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth requirements ----------
class TestAuthRequired:
    def test_url_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-url", json={"url": "https://x.com"}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_voice_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-voice", json={"audio_base64": "abc"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_card_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-card", json={"image_base64": "abc"}, timeout=15)
        assert r.status_code in (401, 403)


# ---------- URL extraction ----------
class TestContactFromUrl:
    def test_invalid_url_no_prefix(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-url",
                          headers=auth_headers, json={"url": "www.example.com"}, timeout=15)
        assert r.status_code == 400
        assert "URL non valido" in r.text or "non valido" in r.text.lower()

    def test_unreachable_domain(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-url",
                          headers=auth_headers,
                          json={"url": "https://this-domain-really-does-not-exist-xyz-12345.tld/"},
                          timeout=25)
        assert r.status_code == 400
        assert "Impossibile scaricare" in r.text

    def test_emergent_url_extraction(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-url",
                          headers=auth_headers,
                          json={"url": "https://www.emergent.sh/"},
                          timeout=60)
        assert r.status_code == 200, f"body: {r.text[:400]}"
        data = r.json()
        assert "contact" in data
        contact = data["contact"]
        assert isinstance(contact, dict)
        # At least some field must be populated
        assert len(contact) > 0, f"contact dict is empty: {contact}"
        # source_url should be present
        assert data.get("source_url") == "https://www.emergent.sh/"
        # Prefer non-empty notes/company/website (soft-check with informative failure)
        has_meaningful = any(contact.get(k) for k in ("company", "website", "notes", "email", "first_name"))
        assert has_meaningful, f"no meaningful field in contact: {contact}"


# ---------- Voice ----------
class TestContactFromVoice:
    def test_invalid_base64(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-voice",
                          headers=auth_headers,
                          json={"audio_base64": "!!!not_valid_base64!!!", "mime": "audio/webm"},
                          timeout=15)
        assert r.status_code == 400
        assert "Audio base64 non valido" in r.text

    def test_valid_b64_reaches_whisper(self, auth_headers):
        # 44-byte silent WAV-like header (valid base64 but likely not a real audio file)
        tiny = base64.b64encode(b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20).decode()
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-voice",
                          headers=auth_headers,
                          json={"audio_base64": tiny, "mime": "audio/webm"},
                          timeout=45)
        # Wiring OK: either 200 (transcript found) or 502 (whisper rejected the content).
        # The 400 "Audio base64 non valido" would only be raised on invalid b64.
        assert r.status_code in (200, 502), f"unexpected {r.status_code}: {r.text[:300]}"
        if r.status_code == 200:
            data = r.json()
            assert "contact" in data
            assert "transcript" in data


# ---------- Business card ----------
class TestContactFromCard:
    def test_missing_image_base64(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-card",
                          headers=auth_headers, json={}, timeout=15)
        assert r.status_code == 422  # pydantic validation

    def test_invalid_image_reaches_llm(self, auth_headers):
        # Base64 that decodes but is not a real image
        fake_b64 = base64.b64encode(b"not-a-real-image-data").decode()
        r = requests.post(f"{BASE_URL}/api/ai/contact-from-card",
                          headers=auth_headers,
                          json={"image_base64": fake_b64, "mime": "image/jpeg"},
                          timeout=60)
        # Auth+plumbing OK: either 200 (LLM tolerated), 500 or 502 (LLM error) all acceptable
        assert r.status_code in (200, 400, 500, 502), f"unexpected {r.status_code}: {r.text[:300]}"
