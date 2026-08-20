"""Backend regression tests for v1.2 bugfixes.

Focus: address_number field on ContactIn/ContactUpdate should be
accepted and persisted (round-trip via POST + GET + PUT + GET).
"""
import os
import requests
import pytest

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://business-card-pro-16.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "test@dalpastro.it"
TEST_PASS = "Test1234!"


@pytest.fixture(scope="module")
def headers():
    r = requests.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json()["token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- address_number round-trip ----------
def test_create_contact_with_address_number(headers):
    payload = {
        "first_name": "TEST_Addr",
        "last_name": "Numero",
        "address_street": "Via Verdi",
        "address_number": "15/A",
        "address_zip": "20100",
        "address_city": "Milano",
        "address_province": "MI",
        "area": "energy",
        "source": "personal",
    }
    r = requests.post(f"{API}/contacts", headers=headers, json=payload, timeout=20)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["address_number"] == "15/A"
    assert c["address_street"] == "Via Verdi"
    cid = c["contact_id"]

    # GET verification (persistence)
    r2 = requests.get(f"{API}/contacts/{cid}", headers=headers, timeout=15)
    assert r2.status_code == 200
    got = r2.json()
    assert got["address_number"] == "15/A"
    assert got["address_street"] == "Via Verdi"

    # PUT update address_number
    r3 = requests.put(f"{API}/contacts/{cid}", headers=headers,
                      json={"address_number": "27bis"}, timeout=15)
    assert r3.status_code == 200
    assert r3.json()["address_number"] == "27bis"

    # GET verify update
    r4 = requests.get(f"{API}/contacts/{cid}", headers=headers, timeout=15)
    assert r4.json()["address_number"] == "27bis"

    # cleanup
    requests.delete(f"{API}/contacts/{cid}", headers=headers, timeout=15)


def test_contact_without_address_number_defaults_empty(headers):
    payload = {"first_name": "TEST_NoNum", "area": "energy", "source": "personal"}
    r = requests.post(f"{API}/contacts", headers=headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c.get("address_number", "") == ""
    requests.delete(f"{API}/contacts/{c['contact_id']}", headers=headers, timeout=15)
