"""v1.5 backend tests: contact PUT partial updates, extended settings, sub-user RBAC."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"
SUB_EMAIL = "sub1@dalpastro.it"
SUB_PASS = "Sub12345!"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def owner_headers():
    return {"Authorization": f"Bearer {_login(OWNER_EMAIL, OWNER_PASS)}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def sub_headers():
    return {"Authorization": f"Bearer {_login(SUB_EMAIL, SUB_PASS)}", "Content-Type": "application/json"}


# --------- Contact partial update ---------
@pytest.fixture()
def temp_contact(owner_headers):
    payload = {
        "first_name": "TEST_V15",
        "last_name": "Edit",
        "phone": "+39 111 000",
        "email": "TEST_v15@example.com",
        "area": "energy",
        "source": "personal",
        "address_street": "Via Test",
        "address_number": "10",
        "tags": ["a"],
    }
    r = requests.post(f"{API}/contacts", headers=owner_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    c = r.json()
    yield c
    requests.delete(f"{API}/contacts/{c['contact_id']}", headers=owner_headers, timeout=15)


def test_put_contact_partial_update(owner_headers, temp_contact):
    cid = temp_contact["contact_id"]
    body = {"first_name": "TEST_V15_Renamed", "phone": "+39 222 333", "tags": ["hot", "vip"]}
    r = requests.put(f"{API}/contacts/{cid}", headers=owner_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    doc = r.json()
    # Response must be the full doc, updated fields must reflect, untouched fields preserved
    assert doc["contact_id"] == cid
    assert doc["first_name"] == "TEST_V15_Renamed"
    assert doc["phone"] == "+39 222 333"
    assert sorted(doc["tags"]) == ["hot", "vip"]
    assert doc["last_name"] == "Edit"  # untouched
    assert doc["email"] == "TEST_v15@example.com"  # untouched
    assert doc["address_number"] == "10"  # untouched
    # Round-trip GET
    r2 = requests.get(f"{API}/contacts/{cid}", headers=owner_headers, timeout=15)
    d2 = r2.json()
    assert d2["first_name"] == "TEST_V15_Renamed"
    assert d2["phone"] == "+39 222 333"


# --------- Extended settings ---------
def test_settings_extended_owner_roundtrip(owner_headers):
    body = {
        "energy_title": "Consulente E",
        "energy_color": "#C83232",
        "network_title": "Networker N",
        "network_color": "#1B6CB0",
        "app_name": "Dal Pastro CRM v1.5",
        "custom_appointment_types": ["Consulenza iniziale", "Follow-up"],
        "custom_product_categories": [
            {"name": "Luce", "subcategories": ["Domestico", "Business"]},
            {"name": "Gas", "subcategories": ["Casa"]},
        ],
    }
    r = requests.put(f"{API}/settings", headers=owner_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["app_name"] == "Dal Pastro CRM v1.5"
    assert d["custom_appointment_types"] == ["Consulenza iniziale", "Follow-up"]
    assert len(d["custom_product_categories"]) == 2
    assert d["custom_product_categories"][0]["name"] == "Luce"
    assert d["custom_product_categories"][0]["subcategories"] == ["Domestico", "Business"]

    # GET returns same
    r2 = requests.get(f"{API}/settings", headers=owner_headers, timeout=15)
    d2 = r2.json()
    assert d2["app_name"] == "Dal Pastro CRM v1.5"
    assert len(d2["custom_product_categories"]) == 2


def test_settings_sub_user_forbidden(sub_headers):
    body = {
        "energy_title": "hack", "energy_color": "#000000",
        "network_title": "hack", "network_color": "#000000",
        "app_name": "HACK",
        "custom_appointment_types": [],
        "custom_product_categories": [],
    }
    r = requests.put(f"{API}/settings", headers=sub_headers, json=body, timeout=15)
    assert r.status_code == 403, f"expected 403 for sub-user, got {r.status_code} {r.text}"


def test_settings_sub_user_can_read(sub_headers):
    # Sub-user should still be able to GET settings (shared tenant)
    r = requests.get(f"{API}/settings", headers=sub_headers, timeout=15)
    assert r.status_code == 200


# --------- Regression: notes kinds + appointment tags + product cats ---------
def test_contact_notes_kinds(owner_headers, temp_contact):
    cid = temp_contact["contact_id"]
    for kind, extra in [
        ("text", {"text": "hi"}),
        ("audio", {"audio_base64": "aGVsbG8="}),
        ("photo", {"photo_base64": "aGVsbG8="}),
        ("link", {"link_url": "https://example.com"}),
    ]:
        nid = str(uuid.uuid4())
        r = requests.post(f"{API}/contacts/{cid}/notes", headers=owner_headers,
                          json={"id": nid, "kind": kind, **extra}, timeout=15)
        assert r.status_code == 200, f"note kind={kind} failed: {r.text}"


def test_appointment_type_and_product_categories(owner_headers, temp_contact):
    from datetime import datetime, timezone, timedelta
    start = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    end = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    payload = {
        "contact_id": temp_contact["contact_id"],
        "title": "TEST_v15_apt",
        "area": "energy",
        "start_at": start, "end_at": end,
        "is_phone": False, "location": "Rome", "notes": "",
        "appointment_type_tags": ["Consulenza iniziale"],
        "product_categories": ["Luce"],
    }
    r = requests.post(f"{API}/appointments", headers=owner_headers, json=payload, timeout=15)
    assert r.status_code == 200, r.text
    a = r.json()
    aid = a["appointment_id"]
    try:
        assert "Consulenza iniziale" in (a.get("appointment_type_tags") or [])
        pc = a.get("product_categories") or []
        assert "Luce" in pc
    finally:
        requests.delete(f"{API}/appointments/{aid}", headers=owner_headers, timeout=15)
