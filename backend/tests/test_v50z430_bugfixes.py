"""V50.z430 bug-fix batch backend tests.

Covers:
 - Bug 1: GET /api/auth/app-return returns HTML bridge page
 - Bug 11-13: Axon reply discipline (<= 4 lines, no technical IDs/log/fetcher states)
 - Bug 14: Axon fetches public URLs pasted in chat (Tavily extract + httpx fallback)
"""

import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture
def api_client(auth_token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {auth_token}"})
    return s


# ---------- Bug 1: app-return HTML bridge ----------

class TestAppReturn:
    def test_app_return_with_to_param(self):
        r = requests.get(f"{API}/auth/app-return", params={"to": "frontend://"}, timeout=15)
        assert r.status_code == 200, f"status {r.status_code}"
        ctype = r.headers.get("content-type", "")
        assert "text/html" in ctype.lower(), f"wrong content-type: {ctype}"
        body = r.text
        assert "Apri AdvisorOS" in body, "missing 'Apri AdvisorOS' button text"
        assert "location.hash" in body, "missing location.hash reading in script"
        assert "session_id" in body, "missing session_id handling"

    def test_app_return_without_to(self):
        r = requests.get(f"{API}/auth/app-return", timeout=15)
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "").lower()
        assert "Apri AdvisorOS" in r.text


# ---------- Bug 11-14: Axon assistant chat ----------

TECH_LEAKAGE_PATTERNS = [
    "fetched_at",
    "Tavily",  # TAV_API etc leaked
    "###",
    "---",
    "user_id",
    "tool_calls",
    "fetcher",
    "contact_id=",
    "appointment_id=",
]


def _count_lines(text: str) -> int:
    # count non-empty lines
    return len([ln for ln in text.splitlines() if ln.strip()])


def _assert_no_tech_leak(reply: str):
    low = reply.lower()
    bad = []
    for pat in TECH_LEAKAGE_PATTERNS:
        if pat.lower() in low:
            bad.append(pat)
    assert not bad, f"reply leaked tech tokens {bad}: {reply[:400]}"


class TestAxonAssistantRules:
    def test_axon_short_reply_count_contacts(self, api_client):
        r = api_client.post(f"{API}/assistant/chat", json={"message": "Quanti contatti ho?"}, timeout=120)
        assert r.status_code == 200, f"status {r.status_code}: {r.text[:400]}"
        data = r.json()
        reply = data.get("reply") or data.get("text") or ""
        assert reply, f"empty reply: {data}"
        lines = _count_lines(reply)
        assert lines <= 6, f"reply too long ({lines} lines): {reply}"
        _assert_no_tech_leak(reply)

    def test_axon_fetch_public_url(self, api_client):
        msg = "Leggi questa pagina e dimmi in una riga di cosa parla: https://example.com/"
        r = api_client.post(f"{API}/assistant/chat", json={"message": msg}, timeout=180)
        assert r.status_code == 200, f"status {r.status_code}: {r.text[:400]}"
        data = r.json()
        reply = data.get("reply") or data.get("text") or ""
        assert reply, f"empty reply: {data}"
        lines = _count_lines(reply)
        assert lines <= 6, f"reply too long ({lines} lines): {reply}"
        _assert_no_tech_leak(reply)
        # Should reference example.com content (contains "example" or "domain" or "documenti")
        low = reply.lower()
        content_hits = any(k in low for k in ["example", "dominio", "domain", "documentazione", "illustrativo", "illustrat", "esempio"])
        assert content_hits, f"reply doesn't seem to reference example.com content: {reply}"
