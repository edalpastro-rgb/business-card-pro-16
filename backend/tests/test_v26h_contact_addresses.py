"""
V26.h — Contact new address fields:
- work_address
- residence_address

Tests:
1. POST /api/contacts with both fields persists them.
2. GET /api/contacts/{id} returns them.
3. PUT /api/contacts/{id} updates them.
4. Defaults are empty strings when not provided.
"""
import os
import pytest
import requests

def _load_base_url():
    u = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not u:
        try:
            with open("/app/frontend/.env", "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                        u = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    assert u, "EXPO_PUBLIC_BACKEND_URL must be set"
    return u.rstrip("/")

BASE_URL = _load_base_url()

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_contact_id(headers):
    payload = {
        "first_name": "TEST_V26H",
        "last_name": "Addresses",
        "phone": "+390000000",
        "email": "test_v26h_addresses@example.com",
        "area": "energy",
        "work_address": "Via Roma 10, Milano",
        "residence_address": "Via Napoli 5, Roma",
    }
    r = requests.post(f"{BASE_URL}/api/contacts", headers=headers, json=payload)
    assert r.status_code in (200, 201), r.text
    d = r.json()
    cid = d.get("contact_id") or d.get("id")
    assert cid, f"Missing contact id in response: {d}"
    yield cid
    # cleanup
    requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers)


def test_contact_persists_new_address_fields(headers, created_contact_id):
    r = requests.get(f"{BASE_URL}/api/contacts/{created_contact_id}", headers=headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("work_address") == "Via Roma 10, Milano", d
    assert d.get("residence_address") == "Via Napoli 5, Roma", d


def test_contact_update_address_fields(headers, created_contact_id):
    upd = {"work_address": "Via Torino 22", "residence_address": "Via Firenze 33"}
    r = requests.put(f"{BASE_URL}/api/contacts/{created_contact_id}", headers=headers, json=upd)
    assert r.status_code == 200, r.text
    # Verify with GET
    g = requests.get(f"{BASE_URL}/api/contacts/{created_contact_id}", headers=headers)
    assert g.status_code == 200
    d = g.json()
    assert d.get("work_address") == "Via Torino 22"
    assert d.get("residence_address") == "Via Firenze 33"


def test_contact_defaults_empty_strings(headers):
    payload = {
        "first_name": "TEST_V26H_Default",
        "last_name": "Empty",
        "phone": "+390000001",
        "area": "energy",
    }
    r = requests.post(f"{BASE_URL}/api/contacts", headers=headers, json=payload)
    assert r.status_code in (200, 201), r.text
    d = r.json()
    cid = d.get("contact_id") or d.get("id")
    try:
        g = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=headers)
        assert g.status_code == 200
        dd = g.json()
        assert dd.get("work_address", "") == ""
        assert dd.get("residence_address", "") == ""
    finally:
        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers)


def test_partial_update_only_work_address(headers, created_contact_id):
    r = requests.put(f"{BASE_URL}/api/contacts/{created_contact_id}", headers=headers, json={"work_address": "Solo lavoro update"})
    assert r.status_code == 200, r.text
    g = requests.get(f"{BASE_URL}/api/contacts/{created_contact_id}", headers=headers)
    d = g.json()
    assert d.get("work_address") == "Solo lavoro update"
    # residence unchanged from previous test
    assert d.get("residence_address") == "Via Firenze 33"
