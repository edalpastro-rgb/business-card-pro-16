"""Backend API tests for ProSync CRM (dual-area energy/network)."""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test@dalpastro.it"
TEST_PASS = "Test1234!"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS}, timeout=20)
    if r.status_code != 200:
        # attempt register (idempotent-safe: 400 if already exists is fine)
        reg = requests.post(f"{API}/auth/register", json={"email": TEST_EMAIL, "password": TEST_PASS, "name": "Mario Test"}, timeout=20)
        if reg.status_code == 200:
            return reg.json()["token"]
        r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    return data["token"]


@pytest.fixture(scope="session")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Health ----------
def test_health():
    r = requests.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("ok") is True


# ---------- Auth ----------
def test_login_returns_jwt(token):
    assert isinstance(token, str) and len(token) > 20


def test_auth_me(headers):
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
    assert r.status_code == 200
    u = r.json()["user"]
    assert u["email"] == TEST_EMAIL
    assert "energy" in u["areas"] and "network" in u["areas"]


def test_auth_me_unauth():
    r = requests.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 401


def test_register_duplicate_rejected():
    r = requests.post(f"{API}/auth/register", json={"email": TEST_EMAIL, "password": TEST_PASS, "name": "x"}, timeout=15)
    assert r.status_code == 400


# ---------- Settings ----------
def test_settings_get_and_update(headers):
    r = requests.get(f"{API}/settings", headers=headers, timeout=15)
    assert r.status_code == 200
    body = {"energy_title": "Consulente Test", "energy_color": "#AA1111",
            "network_title": "Networker Test", "network_color": "#1122AA"}
    r = requests.put(f"{API}/settings", headers=headers, json=body, timeout=15)
    assert r.status_code == 200
    r2 = requests.get(f"{API}/settings", headers=headers, timeout=15)
    d = r2.json()
    assert d["energy_title"] == "Consulente Test"
    assert d["network_color"] == "#1122AA"


# ---------- Contacts ----------
@pytest.fixture(scope="session")
def created_contact(headers):
    payload = {"first_name": "TEST_Luca", "last_name": "Rossi", "phone": "+39 333 000",
               "email": "TEST_luca@example.com", "area": "energy", "source": "personal",
               "general_note": "hello"}
    r = requests.post(f"{API}/contacts", headers=headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["first_name"] == "TEST_Luca" and c["area"] == "energy"
    assert c.get("contact_id")
    yield c
    requests.delete(f"{API}/contacts/{c['contact_id']}", headers=headers, timeout=15)


def test_contact_get_after_create(headers, created_contact):
    cid = created_contact["contact_id"]
    r = requests.get(f"{API}/contacts/{cid}", headers=headers, timeout=15)
    assert r.status_code == 200
    assert r.json()["contact_id"] == cid


def test_contact_list_filter(headers, created_contact):
    r = requests.get(f"{API}/contacts?area=energy", headers=headers, timeout=15)
    assert r.status_code == 200
    ids = [x["contact_id"] for x in r.json()["items"]]
    assert created_contact["contact_id"] in ids


def test_contact_update(headers, created_contact):
    cid = created_contact["contact_id"]
    r = requests.put(f"{API}/contacts/{cid}", headers=headers, json={"phone": "+39 999"}, timeout=15)
    assert r.status_code == 200
    r2 = requests.get(f"{API}/contacts/{cid}", headers=headers, timeout=15)
    assert r2.json()["phone"] == "+39 999"


def test_contact_notes_and_files(headers, created_contact):
    cid = created_contact["contact_id"]
    note_id = str(uuid.uuid4())
    r = requests.post(f"{API}/contacts/{cid}/notes", headers=headers,
                      json={"id": note_id, "kind": "text", "text": "hello note"}, timeout=15)
    assert r.status_code == 200
    file_id = str(uuid.uuid4())
    r = requests.post(f"{API}/contacts/{cid}/files", headers=headers,
                      json={"id": file_id, "name": "t.txt", "mime": "text/plain",
                            "data_base64": "aGVsbG8=", "size": 5}, timeout=15)
    assert r.status_code == 200
    # verify persisted
    r = requests.get(f"{API}/contacts/{cid}", headers=headers, timeout=15)
    c = r.json()
    assert any(n["id"] == note_id for n in c.get("notes", []))
    assert any(f["id"] == file_id for f in c.get("files", []))
    # delete note & file
    r = requests.delete(f"{API}/contacts/{cid}/notes/{note_id}", headers=headers, timeout=15)
    assert r.status_code == 200
    r = requests.delete(f"{API}/contacts/{cid}/files/{file_id}", headers=headers, timeout=15)
    assert r.status_code == 200


# ---------- Appointments ----------
@pytest.fixture(scope="session")
def created_appointment(headers, created_contact):
    start = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    end = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    payload = {"contact_id": created_contact["contact_id"], "title": "TEST_meet",
               "area": "energy", "start_at": start, "end_at": end,
               "is_phone": False, "location": "Milano", "notes": "n"}
    r = requests.post(f"{API}/appointments", headers=headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["title"] == "TEST_meet" and a.get("appointment_id")
    yield a
    requests.delete(f"{API}/appointments/{a['appointment_id']}", headers=headers, timeout=15)


def test_appointment_list(headers, created_appointment):
    r = requests.get(f"{API}/appointments", headers=headers, timeout=15)
    assert r.status_code == 200
    ids = [x["appointment_id"] for x in r.json()["items"]]
    assert created_appointment["appointment_id"] in ids


def test_appointment_reschedule_and_done(headers, created_appointment):
    aid = created_appointment["appointment_id"]
    new_start = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = requests.put(f"{API}/appointments/{aid}", headers=headers,
                     json={"start_at": new_start, "done": True,
                           "outcome_tags": ["sold"], "products_sold": 2, "contract_signed": True}, timeout=15)
    assert r.status_code == 200
    r = requests.get(f"{API}/appointments/{aid}", headers=headers, timeout=15)
    a = r.json()
    assert a["done"] is True and a["products_sold"] == 2 and a["contract_signed"] is True
    assert "sold" in a["outcome_tags"]


# ---------- Callbacks ----------
def test_callbacks_crud_and_day_filter(headers, created_contact):
    sched = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0)
    r = requests.post(f"{API}/callbacks", headers=headers,
                      json={"contact_id": created_contact["contact_id"], "title": "TEST_cb",
                            "area": "energy", "scheduled_at": sched.isoformat(), "note": "x"}, timeout=15)
    assert r.status_code == 200, r.text
    cb = r.json()
    cid = cb["callback_id"]
    day = sched.strftime("%Y-%m-%d")
    r = requests.get(f"{API}/callbacks?day={day}", headers=headers, timeout=15)
    assert r.status_code == 200
    ids = [x["callback_id"] for x in r.json()["items"]]
    assert cid in ids
    r = requests.put(f"{API}/callbacks/{cid}", headers=headers, json={"done": True}, timeout=15)
    assert r.status_code == 200
    r = requests.delete(f"{API}/callbacks/{cid}", headers=headers, timeout=15)
    assert r.status_code == 200


# ---------- Reports ----------
def test_reports_dual_area(headers):
    r = requests.get(f"{API}/reports?period=day", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "stats" in d and "energy" in d["stats"] and "network" in d["stats"]
    for a in ("energy", "network"):
        for k in ("appointments_done", "appointments_total", "phone_done", "contracts", "products"):
            assert k in d["stats"][a]


# ---------- Google session endpoint reachable ----------
def test_google_session_endpoint_reachable():
    r = requests.post(f"{API}/auth/google-session", json={"session_id": "invalid_fake"}, timeout=20)
    # Should return 401 (auth failed) but endpoint exists
    assert r.status_code in (401, 400, 500) and r.status_code != 404
