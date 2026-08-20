"""v1.6 backend tests: telegram field in Contact + regression on comms-related endpoints."""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=OWNER, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestContactTelegramField:
    """Verify telegram field roundtrip through POST/PUT/GET."""

    def test_create_contact_with_telegram(self, headers):
        payload = {
            "first_name": "TESTV16",
            "last_name": "Telegram",
            "phone": "+391112223344",
            "email": "testv16@example.com",
            "whatsapp": "+391112223344",
            "telegram": "@mario_v16",
            "linkedin": "in/mario-v16",
            "instagram": "@mario.v16",
            "facebook": "mario.v16",
            "area": "energy",
        }
        r = requests.post(f"{BASE_URL}/api/contacts", json=payload, headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["telegram"] == "@mario_v16"
        assert c["whatsapp"] == "+391112223344"
        assert c["linkedin"] == "in/mario-v16"
        assert c["instagram"] == "@mario.v16"
        assert c["facebook"] == "mario.v16"
        cid = c["contact_id"]

        # GET to verify persistence
        r2 = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["telegram"] == "@mario_v16"

        # PUT partial update of telegram only
        r3 = requests.put(
            f"{BASE_URL}/api/contacts/{cid}",
            json={"telegram": "@updated_v16"},
            headers=headers,
            timeout=15,
        )
        assert r3.status_code == 200
        updated = r3.json()
        assert updated["telegram"] == "@updated_v16"
        # other fields preserved
        assert updated["whatsapp"] == "+391112223344"
        assert updated["first_name"] == "TESTV16"

        # verify via GET
        r4 = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)
        assert r4.json()["telegram"] == "@updated_v16"

        # cleanup
        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)

    def test_create_contact_without_telegram_defaults_empty(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            json={"first_name": "TESTV16NOTG", "area": "energy"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200
        c = r.json()
        assert c.get("telegram", "") == ""
        requests.delete(f"{BASE_URL}/api/contacts/{c['contact_id']}", headers=headers, timeout=15)


# Regression on core endpoints
class TestRegression:
    def test_list_contacts(self, headers):
        r = requests.get(f"{BASE_URL}/api/contacts", headers=headers, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_settings(self, headers):
        r = requests.get(f"{BASE_URL}/api/settings", headers=headers, timeout=15)
        assert r.status_code == 200
        s = r.json()
        assert "app_name" in s
        assert "custom_appointment_types" in s
        assert "custom_product_categories" in s

    def test_team(self, headers):
        r = requests.get(f"{BASE_URL}/api/team", headers=headers, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_reports(self, headers):
        r = requests.get(f"{BASE_URL}/api/reports?period=day", headers=headers, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "stats" in j and "energy" in j["stats"] and "network" in j["stats"]

    def test_callbacks_list(self, headers):
        r = requests.get(f"{BASE_URL}/api/callbacks", headers=headers, timeout=15)
        assert r.status_code == 200

    def test_appointments_list(self, headers):
        r = requests.get(f"{BASE_URL}/api/appointments", headers=headers, timeout=15)
        assert r.status_code == 200
