"""
Iteration 112 — Full system regression test for AdvisorOS after theme-loop bug fix.
Covers: auth, /me/theme (get/put/validation), user-settings, contacts, team, market,
kokoro tts engine + POST, health, viola-wake settings, weather.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
MEMBER = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text[:200]}"
    j = r.json()
    assert "token" in j and "user" in j
    return j["token"], j["user"]


@pytest.fixture(scope="module")
def owner_ctx():
    s = requests.Session()
    tok, user = _login(s, OWNER)
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    yield s, user
    # cleanup: leave theme=slate
    try:
        s.put(f"{API}/me/theme", json={"ui_theme": "slate"}, timeout=15)
    except Exception:
        pass


@pytest.fixture(scope="module")
def member_ctx():
    s = requests.Session()
    tok, user = _login(s, MEMBER)
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    yield s, user


# ---------------- auth ----------------
class TestAuth:
    def test_login_owner(self, owner_ctx):
        _, u = owner_ctx
        assert u.get("email") == OWNER["email"]

    def test_login_member(self, member_ctx):
        _, u = member_ctx
        assert u.get("email") == MEMBER["email"]

    def test_auth_me(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        j = r.json()
        # Endpoint returns either {user:{...}} envelope or the user object directly
        u = j.get("user") if isinstance(j, dict) and "user" in j else j
        assert u.get("email") == OWNER["email"], j


# ---------------- /me/theme ----------------
class TestMeTheme:
    def test_get_theme_normalized(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/me/theme", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "ui_theme" in j
        assert j["ui_theme"] in ("light", "pearl", "slate", "midnight"), j

    def test_put_and_readback_midnight(self, owner_ctx):
        s, _ = owner_ctx
        r = s.put(f"{API}/me/theme", json={"ui_theme": "midnight"}, timeout=15)
        assert r.status_code == 200
        r2 = s.get(f"{API}/me/theme", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["ui_theme"] == "midnight"

    def test_put_all_valid_values(self, owner_ctx):
        s, _ = owner_ctx
        for v in ("light", "pearl", "slate", "midnight"):
            r = s.put(f"{API}/me/theme", json={"ui_theme": v}, timeout=15)
            assert r.status_code == 200, f"{v}: {r.status_code} {r.text[:200]}"
            assert s.get(f"{API}/me/theme", timeout=15).json()["ui_theme"] == v

    def test_put_invalid_400(self, owner_ctx):
        s, _ = owner_ctx
        r = s.put(f"{API}/me/theme", json={"ui_theme": "neon"}, timeout=15)
        # 400 (custom validation) or 422 (Pydantic Literal) both acceptable as "invalid"
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code} {r.text[:200]}"

    def test_restore_slate(self, owner_ctx):
        s, _ = owner_ctx
        r = s.put(f"{API}/me/theme", json={"ui_theme": "slate"}, timeout=15)
        assert r.status_code == 200


# ---------------- other endpoints ----------------
class TestSmoke:
    def test_user_settings(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/user-settings", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_contacts_no_huge_base64(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/contacts", timeout=30)
        assert r.status_code == 200
        data = r.json()
        # accept list or dict-with-items
        items = data if isinstance(data, list) else data.get("items", [])
        assert isinstance(items, list)
        # first ~5 must not carry huge base64 payloads
        for c in items[:5]:
            for k, v in c.items():
                if isinstance(v, str) and len(v) > 200_000:
                    pytest.fail(f"Contact {c.get('id')} has huge field {k} len={len(v)}")

    def test_team_members(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/team/members", timeout=20)
        assert r.status_code == 200
        j = r.json()
        items = j if isinstance(j, list) else j.get("items", [])
        assert isinstance(items, list)

    def test_market_benchmark_luce(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/market/benchmark", params={"commodity": "luce"}, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_market_official_luce(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/market/official", params={"commodity": "luce"}, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_tts_engine_local_ready(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/tts/engine", timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert j.get("local_ready") is True, j

    def test_assistant_tts_kokoro(self, owner_ctx):
        s, _ = owner_ctx
        r = s.post(f"{API}/assistant/tts", json={"text": "Ciao"}, timeout=45)
        assert r.status_code == 200, r.text[:200]
        j = r.json()
        assert j.get("engine") == "kokoro", j
        assert "audio_base64" in j and len(j["audio_base64"]) > 100

    def test_health(self):
        r = requests.get(f"{API}/health", timeout=15)
        assert r.status_code == 200

    def test_viola_wake_settings(self, owner_ctx):
        s, _ = owner_ctx
        r = s.get(f"{API}/viola-wake/settings", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_weather_forecast(self, owner_ctx):
        s, _ = owner_ctx
        # V50.z342 — /api/weather/forecast is a POST accepting {lat,lon} or {city}
        payload = {"lat": 45.4642, "lon": 9.19}
        r = s.post(f"{API}/weather/forecast", json=payload, timeout=30)
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:200]}"
        assert isinstance(r.json(), dict)
