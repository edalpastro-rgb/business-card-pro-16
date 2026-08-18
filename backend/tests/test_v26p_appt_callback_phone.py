"""
V26.p tests — Appointment new phone/address fields + Callback phone field.
Covers:
- POST /api/appointments accepts phone_mobile, phone_work, phone_target, full_address
- GET /api/appointments/{id} returns those fields
- POST /api/callbacks accepts phone (no contact_id) and returns it via GET
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://consulente-app.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Appointment new fields ----------

class TestAppointmentPhoneAddress:
    created_ids = []

    def test_create_appointment_with_new_fields(self, headers):
        payload = {
            "title": "TEST_V26p appt phone",
            "area": "energy",
            "start_at": "2026-12-01T10:00:00Z",
            "duration_min": 60,
            "is_phone": True,
            "phone_mobile": "+39 333 1234567",
            "phone_work": "+39 02 12345678",
            "phone_target": "mobile",
            "full_address": "Via Roma 10, 20100 Milano MI",
            "location": "Via Roma 10",
            "notes": "TEST_V26p",
        }
        r = requests.post(f"{BASE_URL}/api/appointments", json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), f"POST failed: {r.status_code} {r.text}"
        data = r.json()
        assert "appointment_id" in data
        aid = data["appointment_id"]
        TestAppointmentPhoneAddress.created_ids.append(aid)

        # GET and verify
        g = requests.get(f"{BASE_URL}/api/appointments/{aid}", headers=headers, timeout=20)
        assert g.status_code == 200, f"GET failed: {g.status_code} {g.text}"
        got = g.json()
        assert got.get("phone_mobile") == "+39 333 1234567", got
        assert got.get("phone_work") == "+39 02 12345678", got
        assert got.get("phone_target") == "mobile", got
        assert got.get("full_address") == "Via Roma 10, 20100 Milano MI", got

    def test_update_appointment_phone_target_to_work(self, headers):
        assert TestAppointmentPhoneAddress.created_ids
        aid = TestAppointmentPhoneAddress.created_ids[0]
        r = requests.put(
            f"{BASE_URL}/api/appointments/{aid}",
            json={"phone_target": "work", "full_address": "Via Milano 5, Roma"},
            headers=headers, timeout=20,
        )
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        g = requests.get(f"{BASE_URL}/api/appointments/{aid}", headers=headers, timeout=20)
        assert g.status_code == 200
        got = g.json()
        assert got.get("phone_target") == "work"
        assert got.get("full_address") == "Via Milano 5, Roma"

    def test_appointment_defaults_when_omitted(self, headers):
        # New appointment without new fields must default to "" (not error)
        payload = {
            "title": "TEST_V26p appt defaults",
            "area": "energy",
            "start_at": "2026-12-02T09:00:00Z",
            "duration_min": 30,
        }
        r = requests.post(f"{BASE_URL}/api/appointments", json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), f"POST failed: {r.status_code} {r.text}"
        aid = r.json()["appointment_id"]
        TestAppointmentPhoneAddress.created_ids.append(aid)
        g = requests.get(f"{BASE_URL}/api/appointments/{aid}", headers=headers, timeout=20)
        got = g.json()
        assert got.get("phone_mobile", "") == ""
        assert got.get("phone_work", "") == ""
        assert got.get("phone_target", "") == ""
        assert got.get("full_address", "") == ""

    def test_invalid_phone_target_rejected(self, headers):
        payload = {
            "title": "TEST_V26p invalid target",
            "area": "energy",
            "start_at": "2026-12-03T09:00:00Z",
            "duration_min": 30,
            "phone_target": "sms",  # invalid literal
        }
        r = requests.post(f"{BASE_URL}/api/appointments", json=payload, headers=headers, timeout=20)
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"

    @classmethod
    def teardown_class(cls):
        h = {"Authorization": f"Bearer {_TOKEN[0]}"} if _TOKEN else {}
        for aid in cls.created_ids:
            try:
                requests.delete(f"{BASE_URL}/api/appointments/{aid}", headers=h, timeout=10)
            except Exception:
                pass


# ---------- Callback phone field ----------

_TOKEN = []  # captured for teardown


@pytest.fixture(scope="module", autouse=True)
def _capture_token(token):
    _TOKEN.append(token)
    yield


class TestCallbackPhone:
    created_ids = []

    def test_create_callback_with_phone_no_contact(self, headers):
        payload = {
            "title": "TEST_V26p callback phone-only",
            "area": "energy",
            "scheduled_at": "2026-12-10T15:00:00Z",
            "phone": "+39 333 9999999",
            "contact_id": None,
            "note": "TEST_V26p",
        }
        r = requests.post(f"{BASE_URL}/api/callbacks", json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), f"POST failed: {r.status_code} {r.text}"
        data = r.json()
        assert "callback_id" in data
        cid = data["callback_id"]
        TestCallbackPhone.created_ids.append(cid)
        # GET verify
        g = requests.get(f"{BASE_URL}/api/callbacks/{cid}", headers=headers, timeout=20)
        assert g.status_code == 200, f"GET failed: {g.status_code} {g.text}"
        got = g.json()
        assert got.get("phone") == "+39 333 9999999", got
        assert (got.get("contact_id") or "") == "", got

    def test_update_callback_phone(self, headers):
        assert TestCallbackPhone.created_ids
        cid = TestCallbackPhone.created_ids[0]
        r = requests.put(
            f"{BASE_URL}/api/callbacks/{cid}",
            json={"phone": "+39 340 1111222"},
            headers=headers, timeout=20,
        )
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        g = requests.get(f"{BASE_URL}/api/callbacks/{cid}", headers=headers, timeout=20)
        assert g.status_code == 200
        assert g.json().get("phone") == "+39 340 1111222"

    def test_list_callbacks_includes_created(self, headers):
        r = requests.get(f"{BASE_URL}/api/callbacks", headers=headers, timeout=20)
        assert r.status_code == 200
        items = r.json().get("items", [])
        ids = [x.get("callback_id") for x in items]
        for cid in TestCallbackPhone.created_ids:
            assert cid in ids, f"created callback {cid} not in list"

    @classmethod
    def teardown_class(cls):
        h = {"Authorization": f"Bearer {_TOKEN[0]}"} if _TOKEN else {}
        for cid in cls.created_ids:
            try:
                requests.delete(f"{BASE_URL}/api/callbacks/{cid}", headers=h, timeout=10)
            except Exception:
                pass
