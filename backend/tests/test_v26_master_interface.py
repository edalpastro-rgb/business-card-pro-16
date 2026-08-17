"""V26 — Master Interface support endpoints tests."""
import os, pytest, requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL


def _login(email="test@dalpastro.it", pwd="Test1234!"):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def tok(): return _login()


class TestContracts:
    def test_auth_required(self):
        r = requests.post(f"{BASE_URL}/api/contracts", json={}, timeout=15)
        assert r.status_code == 401

    def test_create_and_list(self, tok):
        r = requests.post(f"{BASE_URL}/api/contracts", headers=_h(tok),
                          json={"contract_number":"TEST-C001","supplier":"ENEL","contract_type":"luce","amount_eur":100.5,"status":"active"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["contract_id"].startswith("ctr_")
        assert j["supplier"] == "ENEL"
        pytest.contract_id = j["contract_id"]
        r = requests.get(f"{BASE_URL}/api/contracts", headers=_h(tok), timeout=15)
        assert r.status_code == 200
        assert any(c["contract_id"] == j["contract_id"] for c in r.json()["items"])

    def test_alerts_and_mark_seen(self, tok):
        r = requests.get(f"{BASE_URL}/api/contracts/new-alerts", headers=_h(tok), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "unread" in j and "latest" in j
        r = requests.post(f"{BASE_URL}/api/contracts/mark-seen", headers=_h(tok), timeout=15)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_delete(self, tok):
        cid = getattr(pytest, "contract_id", None)
        if not cid: pytest.skip("no contract")
        r = requests.delete(f"{BASE_URL}/api/contracts/{cid}", headers=_h(tok), timeout=15)
        assert r.status_code == 200


class TestWebLinks:
    def test_crud(self, tok):
        r = requests.post(f"{BASE_URL}/api/web-links", headers=_h(tok),
                          json={"title":"Google","url":"google.com","icon":"🔍"}, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["url"] == "https://google.com"
        lid = j["link_id"]
        r = requests.get(f"{BASE_URL}/api/web-links", headers=_h(tok), timeout=15)
        assert any(x["link_id"] == lid for x in r.json()["items"])
        r = requests.delete(f"{BASE_URL}/api/web-links/{lid}", headers=_h(tok), timeout=15)
        assert r.status_code == 200


class TestUserSettings:
    def test_get_update(self, tok):
        r = requests.get(f"{BASE_URL}/api/user-settings", headers=_h(tok), timeout=15)
        assert r.status_code == 200
        r = requests.put(f"{BASE_URL}/api/user-settings", headers=_h(tok),
                         json={"theme":"dark","accent_color":"#0891B2"}, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["theme"] == "dark"
        assert j["accent_color"] == "#0891B2"


class TestInviteWithRole:
    def test_invite_with_role_basic(self, tok):
        r = requests.post(f"{BASE_URL}/api/invites", headers=_h(tok),
                          json={"trial_days": 30, "note":"test", "role":"basic"}, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["invite_role"] == "member"

    def test_invite_with_role_manager(self, tok):
        r = requests.post(f"{BASE_URL}/api/invites", headers=_h(tok),
                          json={"trial_days": 30, "role":"manager"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["invite_role"] == "admin"

    def test_invite_with_role_master_figlio(self, tok):
        r = requests.post(f"{BASE_URL}/api/invites", headers=_h(tok),
                          json={"trial_days": 30, "role":"master_figlio"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["invite_role"] == "owner"

    def test_invite_no_role_default(self, tok):
        r = requests.post(f"{BASE_URL}/api/invites", headers=_h(tok), json={"trial_days": 30}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("invite_role") is None
