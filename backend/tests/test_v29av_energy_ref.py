"""V29.av - Test that Contact model accepts energy_ref_* fields (BUG 7)."""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")

DEMO_EMAIL = "demo@advisoros.it"
DEMO_PASSWORD = "Demo1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    if data.get("requires_2fa"):
        pytest.skip("2FA required, skipping")
    return data["token"]


@pytest.fixture
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestEnergyRefFields:
    """BUG 7 - energy_ref_name/phone/email should be accepted and returned."""

    def test_create_contact_with_energy_ref_fields(self, headers):
        payload = {
            "first_name": "TEST_Ref",
            "last_name": "TEST_Energy",
            "energy_ref_name": "Mario Bianchi",
            "energy_ref_phone": "+39 335 1234567",
            "energy_ref_email": "mario.bianchi@example.com",
            "birth_date": "1990-05-15",
        }
        r = requests.post(f"{BASE_URL}/api/contacts", json=payload, headers=headers, timeout=15)
        assert r.status_code == 200, f"POST failed: {r.status_code} {r.text}"
        created = r.json()
        cid = created.get("contact_id")
        assert cid, "No id in response"
        try:
            # verify fields returned in POST
            assert created.get("energy_ref_name") == "Mario Bianchi", f"energy_ref_name missing/wrong: {created.get('energy_ref_name')!r}"
            assert created.get("energy_ref_phone") == "+39 335 1234567"
            assert created.get("energy_ref_email") == "mario.bianchi@example.com"
            assert created.get("birth_date") == "1990-05-15"

            # verify GET persistence
            g = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)
            assert g.status_code == 200
            got = g.json()
            assert got.get("energy_ref_name") == "Mario Bianchi"
            assert got.get("energy_ref_phone") == "+39 335 1234567"
            assert got.get("energy_ref_email") == "mario.bianchi@example.com"
        finally:
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)

    def test_update_contact_energy_ref_fields(self, headers):
        # create bare contact
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            json={"first_name": "TEST_UpdRef", "last_name": "TEST_Energy"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200
        cid = r.json()["contact_id"]
        try:
            # PATCH via PUT with only energy_ref fields
            upd = requests.put(
                f"{BASE_URL}/api/contacts/{cid}",
                json={
                    "energy_ref_name": "Luigi Verdi",
                    "energy_ref_phone": "0555555",
                    "energy_ref_email": "luigi@example.com",
                },
                headers=headers,
                timeout=15,
            )
            assert upd.status_code == 200, f"PUT failed: {upd.status_code} {upd.text}"

            g = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)
            assert g.status_code == 200
            got = g.json()
            assert got.get("energy_ref_name") == "Luigi Verdi"
            assert got.get("energy_ref_phone") == "0555555"
            assert got.get("energy_ref_email") == "luigi@example.com"
        finally:
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)

    def test_energy_ref_fields_optional_defaults_empty(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            json={"first_name": "TEST_NoRef", "last_name": "TEST_Energy"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200
        cid = r.json()["contact_id"]
        try:
            g = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)
            got = g.json()
            # optional string fields default to ""
            assert got.get("energy_ref_name", "") == ""
            assert got.get("energy_ref_phone", "") == ""
            assert got.get("energy_ref_email", "") == ""
        finally:
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)
