"""V50.z335 Contatti restyling — Backend smoke tests

Verify the endpoints used by the restyled contacts list and detail screen still respond 200.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://business-card-pro-16.preview.emergentagent.com').rstrip('/')
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": EMAIL, "password": PASSWORD},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- Contacts list ---
def _extract_items(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("items") or data.get("contacts") or []
    return []


def test_list_contacts(headers):
    r = requests.get(f"{BASE_URL}/api/contacts", headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    items = _extract_items(r.json())
    assert isinstance(items, list)


# --- Contact detail ---
@pytest.fixture(scope="module")
def sample_contact_id(headers):
    r = requests.get(f"{BASE_URL}/api/contacts", headers=headers, timeout=20)
    assert r.status_code == 200
    items = _extract_items(r.json())
    if not items:
        pytest.skip("No contacts available for detail test")
    cid = items[0].get("contact_id") or items[0].get("id")
    assert cid, f"No id in contact record: {items[0]}"
    return cid


def test_get_contact_detail(headers, sample_contact_id):
    r = requests.get(f"{BASE_URL}/api/contacts/{sample_contact_id}", headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    got = body.get("contact_id") or body.get("id")
    assert got == sample_contact_id, f"Expected {sample_contact_id} got {got}"


def test_get_axon_profile(headers, sample_contact_id):
    r = requests.get(f"{BASE_URL}/api/contacts/{sample_contact_id}/axon-profile",
                     headers=headers, timeout=30)
    # axon-profile can legitimately return 200 (with profile) or 200 with empty payload / 404 when no interactions
    assert r.status_code in (200, 404), f"Unexpected {r.status_code}: {r.text[:200]}"


def test_distances_batch(headers, sample_contact_id):
    payload = {
        "origin": "Milano",
        "contact_ids": [sample_contact_id],
    }
    r = requests.post(f"{BASE_URL}/api/contacts/distances-batch",
                      headers=headers, json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict) or isinstance(body, list)
