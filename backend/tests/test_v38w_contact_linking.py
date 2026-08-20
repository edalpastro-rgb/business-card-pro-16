"""V38W — Tests for appointment contact linking (PUT /api/appointments/{id} with contact_id)."""
import os
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("token")
    assert token, "no token in login response"
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_contact(auth_headers):
    payload = {
        "first_name": "TESTLINK",
        "last_name": "Contact V38W",
        "area": "energy",
        "phone": "+391234567890",
        "email": "testlink_v38w@example.com",
    }
    r = requests.post(f"{BASE_URL}/api/contacts", json=payload, headers=auth_headers)
    assert r.status_code in (200, 201), f"contact create failed: {r.status_code} {r.text}"
    contact = r.json()
    cid = contact.get("contact_id") or contact.get("id")
    assert cid
    yield cid
    requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=auth_headers)


class TestAppointmentContactLinking:

    def test_create_appointment_without_contact_id(self, auth_headers):
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
        payload = {
            "title": "TEST V38W link",
            "area": "energy",
            "start_at": tomorrow.isoformat(),
            "duration_min": 60,
            "is_phone": False,
        }
        r = requests.post(f"{BASE_URL}/api/appointments", json=payload, headers=auth_headers)
        assert r.status_code in (200, 201), f"appt create failed: {r.status_code} {r.text}"
        data = r.json()
        aid = data.get("appointment_id") or data.get("id")
        assert aid
        # no contact_id present or empty
        assert not data.get("contact_id")
        pytest.appt_id = aid

    def test_put_appointment_with_contact_id(self, auth_headers, test_contact):
        aid = pytest.appt_id
        r = requests.put(
            f"{BASE_URL}/api/appointments/{aid}",
            json={"contact_id": test_contact},
            headers=auth_headers,
        )
        assert r.status_code == 200, f"appt update failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("contact_id") == test_contact, f"contact_id not set on update: {body}"

    def test_get_appointment_returns_contact_id(self, auth_headers, test_contact):
        aid = pytest.appt_id
        r = requests.get(f"{BASE_URL}/api/appointments/{aid}", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("contact_id") == test_contact, f"contact_id not persisted: {body}"

    def test_delete_appointment_cleanup(self, auth_headers):
        aid = pytest.appt_id
        r = requests.delete(f"{BASE_URL}/api/appointments/{aid}", headers=auth_headers)
        assert r.status_code in (200, 204), r.text


class TestAutolinkFromContactCard:
    """Feature 2 — When creating appt via POST with contact_id, it should be persisted and queryable."""

    def test_create_and_query_by_contact_id(self, auth_headers):
        # create a fresh contact
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            json={"first_name": "AUTOLINK", "last_name": "Test V38W", "area": "energy", "phone": "+3900011122"},
            headers=auth_headers,
        )
        assert r.status_code in (200, 201), r.text
        cid = r.json().get("contact_id") or r.json().get("id")

        tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).replace(hour=11, minute=0, second=0, microsecond=0)
        r = requests.post(
            f"{BASE_URL}/api/appointments",
            json={
                "title": "Appuntamento AUTOLINK Test V38W",
                "area": "energy",
                "start_at": tomorrow.isoformat(),
                "duration_min": 60,
                "is_phone": False,
                "contact_id": cid,
            },
            headers=auth_headers,
        )
        assert r.status_code in (200, 201), r.text
        appt = r.json()
        aid = appt.get("appointment_id") or appt.get("id")
        assert appt.get("contact_id") == cid, f"contact_id not persisted at POST: {appt}"

        # Query
        r = requests.get(f"{BASE_URL}/api/appointments?contact_id={cid}", headers=auth_headers)
        assert r.status_code == 200, r.text
        items = r.json()
        if isinstance(items, dict):
            items = items.get("items", [])
        found = [a for a in items if (a.get("appointment_id") or a.get("id")) == aid]
        assert found, f"appointment not found when filtering by contact_id: {items}"

        # Cleanup
        requests.delete(f"{BASE_URL}/api/appointments/{aid}", headers=auth_headers)
        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=auth_headers)
