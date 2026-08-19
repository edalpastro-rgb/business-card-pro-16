"""V34 — Voice response mode + TTS + Weather natural-language integration.

Tests:
- GET /api/user-settings returns default assistant_response_mode='text' + assistant_voice='nova'
- PUT /api/user-settings can update both fields; all 3 modes and all 9 voices accepted
- POST /api/assistant/tts returns audio_base64 (>1000 chars), mime='audio/mpeg', voice
- POST /api/assistant/tts with empty text returns 400
- POST /api/assistant/chat with an Italian weather question mentioning Padova returns a
  reply that references actual weather data (temperature/condition/city).
- Weather question without a city → assistant asks which city
- Non-weather question still works (regression)
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]
MODES = ["text", "voice", "both"]


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers():
    return {"Authorization": f"Bearer {_login(OWNER)}"}


# ---------- user-settings assistant_response_mode & assistant_voice ----------
class TestUserSettingsVoiceMode:
    def test_defaults_present(self, headers):
        # Ensure any prior test mutation is reset to defaults first
        requests.put(f"{BASE_URL}/api/user-settings", headers=headers,
                     json={"assistant_response_mode": "text", "assistant_voice": "nova"}, timeout=15)
        r = requests.get(f"{BASE_URL}/api/user-settings", headers=headers, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j.get("assistant_response_mode") == "text"
        assert j.get("assistant_voice") == "nova"

    @pytest.mark.parametrize("mode", MODES)
    def test_all_modes_accepted_and_persisted(self, headers, mode):
        r = requests.put(f"{BASE_URL}/api/user-settings", headers=headers,
                         json={"assistant_response_mode": mode}, timeout=15)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/user-settings", headers=headers, timeout=15).json()
        assert g.get("assistant_response_mode") == mode

    @pytest.mark.parametrize("voice", VOICES)
    def test_all_voices_accepted_and_persisted(self, headers, voice):
        r = requests.put(f"{BASE_URL}/api/user-settings", headers=headers,
                         json={"assistant_voice": voice}, timeout=15)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/user-settings", headers=headers, timeout=15).json()
        assert g.get("assistant_voice") == voice

    def test_cleanup_reset(self, headers):
        # reset to defaults for other tests
        requests.put(f"{BASE_URL}/api/user-settings", headers=headers,
                     json={"assistant_response_mode": "text", "assistant_voice": "nova"}, timeout=15)


# ---------- /api/assistant/tts ----------
class TestAssistantTTS:
    def test_tts_ok(self, headers):
        r = requests.post(f"{BASE_URL}/api/assistant/tts", headers=headers,
                          json={"text": "Ciao Neo", "voice": "nova"}, timeout=90)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("mime") == "audio/mpeg"
        assert j.get("voice") == "nova"
        b64 = j.get("audio_base64", "")
        assert isinstance(b64, str) and len(b64) > 1000, f"audio_base64 too short: {len(b64)}"

    def test_tts_empty_text_400(self, headers):
        r = requests.post(f"{BASE_URL}/api/assistant/tts", headers=headers,
                          json={"text": "   ", "voice": "nova"}, timeout=30)
        assert r.status_code == 400

    def test_tts_no_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/assistant/tts",
                          json={"text": "Ciao", "voice": "nova"}, timeout=30)
        assert r.status_code in (401, 403)

    def test_tts_alternate_voice(self, headers):
        r = requests.post(f"{BASE_URL}/api/assistant/tts", headers=headers,
                          json={"text": "Buongiorno", "voice": "alloy"}, timeout=90)
        assert r.status_code == 200, r.text
        assert r.json().get("voice") == "alloy"


# ---------- weather integration ----------
class TestWeatherIntegration:
    def test_weather_padova(self, headers):
        r = requests.post(f"{BASE_URL}/api/assistant/chat", headers=headers,
                          json={"message": "Com'è il tempo a Padova oggi pomeriggio?"}, timeout=180)
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "")
        low = reply.lower()
        # City reference
        assert "padova" in low, f"City not referenced in reply: {reply!r}"
        # Temperature (a number followed by ° or 'gradi' or C)
        assert re.search(r"\d{1,2}\s*(?:°|gradi|c\b)", low), f"No temperature in reply: {reply!r}"

    def test_weather_no_city_asks(self, headers):
        r = requests.post(f"{BASE_URL}/api/assistant/chat", headers=headers,
                          json={"message": "Che tempo fa?"}, timeout=180)
        assert r.status_code == 200, r.text
        low = r.json().get("reply", "").lower()
        # Must be a question about which city
        assert any(kw in low for kw in ["citt", "dove", "quale", "specific"]), f"No city clarification: {low!r}"

    def test_non_weather_regression(self, headers):
        r = requests.post(f"{BASE_URL}/api/assistant/chat", headers=headers,
                          json={"message": "Ciao, presentati brevemente."}, timeout=180)
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "")
        assert isinstance(reply, str) and len(reply) > 5
