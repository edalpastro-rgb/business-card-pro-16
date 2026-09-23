# V50.z339 — UI Theme (users.ui_theme) backend tests
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read from frontend .env if env not set in shell
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    data = r.json()
    tok = data.get("token")
    assert tok, f"token missing: {data}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestUiTheme:
    """UI theme GET/PUT flow"""

    def test_get_theme_returns_valid_id(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/me/theme", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "ui_theme" in data
        assert data["ui_theme"] in ["light", "pearl", "slate", "midnight"], data

    def test_get_without_token_is_401_or_403(self):
        r = requests.get(f"{BASE_URL}/api/me/theme", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_put_pearl_ok(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/me/theme",
                         headers=auth_headers, json={"ui_theme": "pearl"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("ui_theme") == "pearl"

        # verify persistence
        g = requests.get(f"{BASE_URL}/api/me/theme", headers=auth_headers, timeout=15).json()
        assert g["ui_theme"] == "pearl"

    def test_put_light_ok(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/me/theme",
                         headers=auth_headers, json={"ui_theme": "light"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ui_theme") == "light"

    def test_put_midnight_ok(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/me/theme",
                         headers=auth_headers, json={"ui_theme": "midnight"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ui_theme") == "midnight"

    def test_put_invalid_grey_returns_422(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/me/theme",
                         headers=auth_headers, json={"ui_theme": "grey"}, timeout=15)
        assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text}"

    def test_put_invalid_pink_returns_422(self, auth_headers):
        r = requests.put(f"{BASE_URL}/api/me/theme",
                         headers=auth_headers, json={"ui_theme": "pink"}, timeout=15)
        assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text}"

    def test_put_without_token_is_401_or_403(self):
        r = requests.put(f"{BASE_URL}/api/me/theme",
                         headers={"Content-Type": "application/json"},
                         json={"ui_theme": "slate"}, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_zzz_reset_to_slate(self, auth_headers):
        """Cleanup: leave theme as slate (default) as requested by the review."""
        r = requests.put(f"{BASE_URL}/api/me/theme",
                         headers=auth_headers, json={"ui_theme": "slate"}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/me/theme", headers=auth_headers, timeout=15).json()
        assert g["ui_theme"] == "slate"
