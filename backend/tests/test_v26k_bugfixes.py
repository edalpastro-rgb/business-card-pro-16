"""
V26.k backend tests — verifies:
 1) GET /api/settings returns call_outcomes with "Presa Appuntamento" (call_appointment) FIRST (migration applied).
 2) POST /api/calls/log accepts outcome_id=call_appointment.
 3) POST/PUT/DELETE /api/my-thing works for image items (Elimina & Modifica flows on frontend).
"""
import os
import base64
import requests
import pytest

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


class TestSettingsCallOutcomesMigration:
    """Fix 2 — Backend part: Presa Appuntamento must be the first call outcome."""

    def test_settings_first_outcome_is_call_appointment(self, auth):
        r = auth.get(f"{BASE_URL}/api/settings", timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()
        outcomes = s.get("call_outcomes")
        assert isinstance(outcomes, list) and len(outcomes) > 0, "call_outcomes missing/empty"
        first = outcomes[0]
        assert first.get("id") == "call_appointment", f"first outcome id={first.get('id')}"
        assert first.get("name") == "Presa Appuntamento", f"first outcome name={first.get('name')}"
        assert first.get("icon") in ("calendar", "calendar-outline")
        assert first.get("color", "").upper() == "#16A34A"


class TestCallsLogWithAppointmentOutcome:
    """Fix 2 — Backend accepts outcome_id=call_appointment on POST /calls/log."""

    def test_create_contact_and_log_call_with_appointment_outcome(self, auth):
        # Create a test contact
        cr = auth.post(
            f"{BASE_URL}/api/contacts",
            json={
                "first_name": "TEST_V26K",
                "last_name": "Appuntamento",
                "phone_primary": "+39 340 1234567",
                "area": "energy",
            },
            timeout=15,
        )
        assert cr.status_code in (200, 201), cr.text
        contact_id = cr.json()["contact_id"]
        try:
            # Log a call with outcome=call_appointment
            lr = auth.post(
                f"{BASE_URL}/api/calls/log",
                json={
                    "contact_id": contact_id,
                    "phone": "+39 340 1234567",
                    "outcome_id": "call_appointment",
                    "note": "TEST_V26K appointment scheduled",
                },
                timeout=15,
            )
            assert lr.status_code in (200, 201), lr.text
            body = lr.json()
            # accept either full log object or wrapped
            log = body.get("log") or body
            assert log.get("outcome_id") == "call_appointment"
            # GET call logs and verify persistence
            gr = auth.get(f"{BASE_URL}/api/calls/log", params={"contact_id": contact_id}, timeout=15)
            assert gr.status_code == 200
            items = gr.json().get("items") or gr.json()
            assert any(x.get("outcome_id") == "call_appointment" for x in items), "logged call not found"
        finally:
            auth.delete(f"{BASE_URL}/api/contacts/{contact_id}", timeout=15)


def _tiny_png_data_uri():
    # 1x1 transparent PNG
    raw = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )
    return "data:image/png;base64," + base64.b64encode(raw).decode()


class TestMyThingImageCrud:
    """Fix 3 — Backend supports create/update/delete for image items."""

    def test_create_update_delete_image(self, auth):
        payload = {
            "kind": "image",
            "title": "TEST_V26K_IMG_1",
            "image_base64": _tiny_png_data_uri(),
        }
        cr = auth.post(f"{BASE_URL}/api/my-thing", json=payload, timeout=15)
        assert cr.status_code in (200, 201), cr.text
        body_json = cr.json()
        item = body_json.get("item") or body_json
        item_id = item.get("item_id") or item.get("id")
        assert item_id, f"no item_id in create response: {body_json}"
        try:
            # Update title (Modifica → Salva modifiche)
            ur = auth.put(
                f"{BASE_URL}/api/my-thing/{item_id}",
                json={"title": "TEST_V26K_IMG_1_MOD"},
                timeout=15,
            )
            assert ur.status_code == 200, ur.text
            # GET list and verify title updated
            lr = auth.get(f"{BASE_URL}/api/my-thing", params={"kind": "image"}, timeout=15)
            assert lr.status_code == 200
            items = lr.json().get("items") or lr.json()
            found = next((x for x in items if (x.get("item_id") or x.get("id")) == item_id), None)
            assert found is not None, "updated item missing from list"
            assert found.get("title") == "TEST_V26K_IMG_1_MOD"
        finally:
            # Delete (Elimina)
            dr = auth.delete(f"{BASE_URL}/api/my-thing/{item_id}", timeout=15)
            assert dr.status_code in (200, 204), dr.text
            # GET again — should be gone
            lr2 = auth.get(f"{BASE_URL}/api/my-thing", params={"kind": "image"}, timeout=15)
            items2 = lr2.json().get("items") or lr2.json()
            assert not any((x.get("item_id") or x.get("id")) == item_id for x in items2), "item still present after delete"


class TestCallbackWithContact:
    """Fix 1 — Support: POST /callbacks linked to a contact used by the home row press."""

    def test_create_callback_linked_to_contact(self, auth):
        cr = auth.post(
            f"{BASE_URL}/api/contacts",
            json={"first_name": "TEST_V26K", "last_name": "Callback", "phone_primary": "+39 340 7654321", "area": "energy"},
            timeout=15,
        )
        assert cr.status_code in (200, 201)
        contact_id = cr.json()["contact_id"]
        try:
            from datetime import datetime, timedelta, timezone

            when = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
            kr = auth.post(
                f"{BASE_URL}/api/callbacks",
                json={
                    "contact_id": contact_id,
                    "title": "TEST_V26K callback",
                    "area": "energy",
                    "scheduled_at": when,
                    "note": "TEST_V26K",
                },
                timeout=15,
            )
            assert kr.status_code in (200, 201), kr.text
            cb = kr.json()
            # response may wrap in {"callback": ...} or return the doc directly
            cbd = cb.get("callback") or cb
            cb_id = cbd.get("callback_id") or cbd.get("id")
            assert cb_id
            assert cbd.get("contact_id") == contact_id
            # cleanup callback
            auth.delete(f"{BASE_URL}/api/callbacks/{cb_id}", timeout=15)
        finally:
            auth.delete(f"{BASE_URL}/api/contacts/{contact_id}", timeout=15)
