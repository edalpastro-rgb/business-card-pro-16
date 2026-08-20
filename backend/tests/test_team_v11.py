"""v1.1 tests: multi-user team, tenant scoping + regression on v1 endpoints."""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"
SUB_EMAIL = "sub1@dalpastro.it"
SUB_PASS = "Sub12345!"


def _login(email: str, password: str) -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def owner():
    data = _login(OWNER_EMAIL, OWNER_PASS)
    return {"token": data["token"], "user": data["user"],
            "headers": {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"}}


@pytest.fixture(scope="session")
def subuser(owner):
    # Ensure sub1 exists; if missing, invite via owner.
    r = requests.post(f"{API}/auth/login", json={"email": SUB_EMAIL, "password": SUB_PASS}, timeout=20)
    if r.status_code != 200:
        inv = requests.post(f"{API}/team", headers=owner["headers"],
                            json={"email": SUB_EMAIL, "name": "Sub One", "password": SUB_PASS,
                                  "areas": ["network"]}, timeout=20)
        assert inv.status_code == 200, f"could not invite sub-user: {inv.status_code} {inv.text}"
        r = requests.post(f"{API}/auth/login", json={"email": SUB_EMAIL, "password": SUB_PASS}, timeout=20)
        assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["token"], "user": data["user"],
            "headers": {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"}}


# ================== v1.1: Login returns parent_user_id ==================
def test_owner_login_shape(owner):
    u = owner["user"]
    assert u["role"] == "owner"
    assert u.get("parent_user_id") in (None, "")
    assert "energy" in u["areas"] and "network" in u["areas"]


def test_sub_login_returns_parent_user_id(owner, subuser):
    u = subuser["user"]
    assert u["role"] == "member"
    assert u.get("parent_user_id") == owner["user"]["user_id"], u
    assert u["areas"] == ["network"], u


# ================== v1.1: Team endpoints ==================
def test_team_list_owner_only(owner, subuser):
    r = requests.get(f"{API}/team", headers=owner["headers"], timeout=15)
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(m.get("email") == SUB_EMAIL for m in items)
    # every item must belong to owner tenant
    for m in items:
        assert m.get("parent_user_id") == owner["user"]["user_id"]
        assert "password_hash" not in m


def test_team_list_forbidden_for_sub(subuser):
    r = requests.get(f"{API}/team", headers=subuser["headers"], timeout=15)
    assert r.status_code == 403


def test_team_invite_forbidden_for_sub(subuser):
    r = requests.post(f"{API}/team", headers=subuser["headers"],
                     json={"email": f"TEST_x_{uuid.uuid4().hex[:6]}@x.it", "name": "n",
                           "password": "Passw0rd!", "areas": ["energy"]}, timeout=15)
    assert r.status_code == 403


def test_team_invite_update_delete_cycle(owner):
    email = f"TEST_m_{uuid.uuid4().hex[:6]}@dalpastro.it"
    r = requests.post(f"{API}/team", headers=owner["headers"],
                      json={"email": email, "name": "Temp Member", "password": "Temp1234!",
                            "areas": ["energy"]}, timeout=15)
    assert r.status_code == 200, r.text
    m = r.json()
    mid = m["user_id"]
    assert m["role"] == "member" and m["parent_user_id"] == owner["user"]["user_id"]
    assert m["areas"] == ["energy"]
    # login works
    lr = requests.post(f"{API}/auth/login", json={"email": email, "password": "Temp1234!"}, timeout=15)
    assert lr.status_code == 200
    # PUT areas
    up = requests.put(f"{API}/team/{mid}", headers=owner["headers"],
                      json={"areas": ["network"]}, timeout=15)
    assert up.status_code == 200
    assert up.json()["areas"] == ["network"]
    # GET verifies persisted
    gt = requests.get(f"{API}/team", headers=owner["headers"], timeout=15)
    found = [x for x in gt.json()["items"] if x["user_id"] == mid]
    assert found and found[0]["areas"] == ["network"]
    # DELETE
    dl = requests.delete(f"{API}/team/{mid}", headers=owner["headers"], timeout=15)
    assert dl.status_code == 200
    # login should now fail
    lr2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "Temp1234!"}, timeout=15)
    assert lr2.status_code == 401


# ================== v1.1: Area enforcement (403 IT message) ==================
def test_sub_create_contact_forbidden_area(subuser):
    r = requests.post(f"{API}/contacts", headers=subuser["headers"],
                      json={"first_name": "TEST_Forbidden", "area": "energy", "source": "personal"}, timeout=15)
    assert r.status_code == 403
    assert "non consentita" in r.json().get("detail", "").lower()


def test_sub_create_appointment_forbidden_area(subuser):
    start = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    r = requests.post(f"{API}/appointments", headers=subuser["headers"],
                      json={"title": "TEST_bad", "area": "energy", "start_at": start}, timeout=15)
    assert r.status_code == 403
    assert "non consentita" in r.json().get("detail", "").lower()


def test_sub_create_callback_forbidden_area(subuser):
    sched = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = requests.post(f"{API}/callbacks", headers=subuser["headers"],
                      json={"title": "TEST_bad_cb", "area": "energy", "scheduled_at": sched}, timeout=15)
    assert r.status_code == 403


# ================== v1.1: Tenant scoping (created_by / user_id) ==================
@pytest.fixture(scope="session")
def sub_contact(subuser, owner):
    r = requests.post(f"{API}/contacts", headers=subuser["headers"],
                      json={"first_name": "TEST_SubOwned", "last_name": "N",
                            "area": "network", "source": "personal"}, timeout=15)
    assert r.status_code == 200, r.text
    c = r.json()
    # scoping fields
    assert c["created_by"] == subuser["user"]["user_id"]
    assert c["user_id"] == owner["user"]["user_id"]
    yield c
    # cleanup via owner (sub can delete own too, but owner sees all)
    requests.delete(f"{API}/contacts/{c['contact_id']}", headers=owner["headers"], timeout=15)


@pytest.fixture(scope="session")
def owner_contact(owner):
    r = requests.post(f"{API}/contacts", headers=owner["headers"],
                      json={"first_name": "TEST_OwnerOwned", "last_name": "O",
                            "area": "energy", "source": "personal"}, timeout=15)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["created_by"] == owner["user"]["user_id"]
    assert c["user_id"] == owner["user"]["user_id"]
    yield c
    requests.delete(f"{API}/contacts/{c['contact_id']}", headers=owner["headers"], timeout=15)


def test_sub_lists_only_own_contacts(subuser, sub_contact, owner_contact):
    r = requests.get(f"{API}/contacts", headers=subuser["headers"], timeout=15)
    assert r.status_code == 200
    ids = [c["contact_id"] for c in r.json()["items"]]
    assert sub_contact["contact_id"] in ids
    assert owner_contact["contact_id"] not in ids, "sub should NOT see owner's contacts"


def test_owner_sees_all_tenant_contacts(owner, sub_contact, owner_contact):
    r = requests.get(f"{API}/contacts", headers=owner["headers"], timeout=15)
    assert r.status_code == 200
    ids = [c["contact_id"] for c in r.json()["items"]]
    assert sub_contact["contact_id"] in ids
    assert owner_contact["contact_id"] in ids


def test_sub_cannot_get_owner_contact_by_id(subuser, owner_contact):
    r = requests.get(f"{API}/contacts/{owner_contact['contact_id']}", headers=subuser["headers"], timeout=15)
    assert r.status_code == 404  # scoping treats as not found


def test_sub_appointment_and_callback_scoping(owner, subuser):
    start = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    ra = requests.post(f"{API}/appointments", headers=subuser["headers"],
                       json={"title": "TEST_sub_appt", "area": "network", "start_at": start}, timeout=15)
    assert ra.status_code == 200
    ap = ra.json()
    assert ap["created_by"] == subuser["user"]["user_id"]
    assert ap["user_id"] == owner["user"]["user_id"]

    sched = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
    rc = requests.post(f"{API}/callbacks", headers=subuser["headers"],
                       json={"title": "TEST_sub_cb", "area": "network", "scheduled_at": sched}, timeout=15)
    assert rc.status_code == 200
    cb = rc.json()
    assert cb["created_by"] == subuser["user"]["user_id"]
    assert cb["user_id"] == owner["user"]["user_id"]

    # Sub lists include only own
    la = requests.get(f"{API}/appointments", headers=subuser["headers"], timeout=15).json()["items"]
    assert all(x["created_by"] == subuser["user"]["user_id"] for x in la)
    assert any(x["appointment_id"] == ap["appointment_id"] for x in la)

    lc = requests.get(f"{API}/callbacks", headers=subuser["headers"], timeout=15).json()["items"]
    assert all(x["created_by"] == subuser["user"]["user_id"] for x in lc)
    assert any(x["callback_id"] == cb["callback_id"] for x in lc)

    # Owner sees both
    la_o = requests.get(f"{API}/appointments", headers=owner["headers"], timeout=15).json()["items"]
    assert any(x["appointment_id"] == ap["appointment_id"] for x in la_o)

    # cleanup
    requests.delete(f"{API}/appointments/{ap['appointment_id']}", headers=owner["headers"], timeout=15)
    requests.delete(f"{API}/callbacks/{cb['callback_id']}", headers=owner["headers"], timeout=15)


# ================== v1.1: Sub cannot mutate settings ==================
def test_sub_put_settings_forbidden(subuser):
    r = requests.put(f"{API}/settings", headers=subuser["headers"],
                     json={"energy_title": "x", "energy_color": "#111111",
                           "network_title": "y", "network_color": "#222222"}, timeout=15)
    assert r.status_code == 403


def test_sub_get_settings_ok_same_tenant(owner, subuser):
    r_o = requests.get(f"{API}/settings", headers=owner["headers"], timeout=15)
    r_s = requests.get(f"{API}/settings", headers=subuser["headers"], timeout=15)
    assert r_o.status_code == 200 and r_s.status_code == 200
    # Same tenant settings doc
    assert r_o.json().get("user_id") == r_s.json().get("user_id") == owner["user"]["user_id"]


# ================== Regression: v1 endpoints ==================
def test_regression_health():
    r = requests.get(f"{API}/", timeout=15)
    assert r.status_code == 200 and r.json().get("ok") is True


def test_regression_me_and_logout(owner):
    r = requests.get(f"{API}/auth/me", headers=owner["headers"], timeout=15)
    assert r.status_code == 200
    assert r.json()["user"]["email"] == OWNER_EMAIL
    # logout on JWT is idempotent no-op
    rl = requests.post(f"{API}/auth/logout", headers=owner["headers"], timeout=15)
    assert rl.status_code == 200
    # JWT still valid (stateless)
    r2 = requests.get(f"{API}/auth/me", headers=owner["headers"], timeout=15)
    assert r2.status_code == 200


def test_regression_contact_notes_files(owner, owner_contact):
    cid = owner_contact["contact_id"]
    note_id = str(uuid.uuid4())
    r = requests.post(f"{API}/contacts/{cid}/notes", headers=owner["headers"],
                      json={"id": note_id, "kind": "text", "text": "reg note"}, timeout=15)
    assert r.status_code == 200
    file_id = str(uuid.uuid4())
    r = requests.post(f"{API}/contacts/{cid}/files", headers=owner["headers"],
                      json={"id": file_id, "name": "t.txt", "mime": "text/plain",
                            "data_base64": "aGVsbG8=", "size": 5}, timeout=15)
    assert r.status_code == 200
    r = requests.get(f"{API}/contacts/{cid}", headers=owner["headers"], timeout=15)
    body = r.json()
    assert any(n["id"] == note_id for n in body.get("notes", []))
    assert any(f["id"] == file_id for f in body.get("files", []))


def test_regression_reports_all_periods(owner):
    for period in ("day", "week", "month", "year"):
        r = requests.get(f"{API}/reports?period={period}", headers=owner["headers"], timeout=15)
        assert r.status_code == 200, f"{period}: {r.text}"
        d = r.json()
        assert d["period"] == period
        assert "energy" in d["stats"] and "network" in d["stats"]
        for a in ("energy", "network"):
            for k in ("appointments_done", "appointments_total", "phone_done", "contracts", "products"):
                assert k in d["stats"][a]


def test_regression_reports_sub_scoped(owner, subuser):
    # Sub reports should not exceed owner totals for same period.
    ro = requests.get(f"{API}/reports?period=year", headers=owner["headers"], timeout=15).json()
    rs = requests.get(f"{API}/reports?period=year", headers=subuser["headers"], timeout=15).json()
    for area in ("energy", "network"):
        for k in ("appointments_total", "appointments_done"):
            assert rs["stats"][area][k] <= ro["stats"][area][k], \
                f"sub {area}.{k}={rs['stats'][area][k]} > owner {ro['stats'][area][k]}"
