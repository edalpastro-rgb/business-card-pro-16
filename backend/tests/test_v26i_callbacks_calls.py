"""
V26.i backend tests — Callbacks + Calls integration for the 3 bug fixes:
- POST /api/callbacks with contact_id → GET returns it linked to contact
- POST /api/calls/log persists a log for the contact
- GET /api/calls/log?contact_id=X returns the log(s) with expected fields
- Reschedule via reschedule_at creates a new follow-up callback with parent_call_log_id linkage
"""
import os
import time
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PW = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PW})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def contact_id(token):
    H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "first_name": "TEST_V26I",
        "last_name": "Callflow",
        "area": "energy",
        "source": "personal",
        "phone": "+390000123456",
    }
    r = requests.post(f"{API}/contacts", json=payload, headers=H)
    assert r.status_code == 200, r.text
    cid = r.json()["contact_id"]
    yield cid
    # cleanup
    requests.delete(f"{API}/contacts/{cid}", headers=H)


class TestCallbackForContact:
    """Creates a callback linked to a contact; verifies GET returns it."""

    def test_create_callback_with_contact_id(self, H, contact_id):
        sched = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        r = requests.post(f"{API}/callbacks", json={
            "title": "TEST_V26I ritelefonata",
            "area": "energy",
            "scheduled_at": sched,
            "contact_id": contact_id,
            "phone": "+390000123456",
        }, headers=H)
        assert r.status_code == 200, r.text
        cb = r.json()
        assert cb.get("contact_id") == contact_id
        cb_id = cb["callback_id"]

        # GET list should include it
        r = requests.get(f"{API}/callbacks", headers=H)
        assert r.status_code == 200
        items = r.json().get("items", [])
        assert any(c["callback_id"] == cb_id for c in items), "created callback not in list"

        # cleanup
        requests.delete(f"{API}/callbacks/{cb_id}", headers=H)


class TestCallLogAndReschedule:
    def test_log_appuntamento_preso(self, H, contact_id):
        r = requests.post(f"{API}/calls/log", json={
            "contact_id": contact_id,
            "phone": "+390000123456",
            "outcome_id": "call_appointment",
            "note": "TEST_ appuntamento preso",
        }, headers=H)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["log"]["outcome_id"] == "call_appointment"
        assert data["log"]["contact_id"] == contact_id
        assert data.get("new_callback") is None, "no reschedule → no new callback"

    def test_log_no_answer_with_reschedule_at(self, H, contact_id):
        when = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
        r = requests.post(f"{API}/calls/log", json={
            "contact_id": contact_id,
            "phone": "+390000123456",
            "outcome_id": "call_no_answer",
            "note": "TEST_ posponi 3h",
            "reschedule_at": when,
        }, headers=H)
        assert r.status_code == 200, r.text
        data = r.json()
        log_id = data["log"].get("log_id") or data["log"].get("id")
        new_cb = data.get("new_callback")
        assert new_cb is not None, "expected new_callback"
        # Link back to parent call log
        assert new_cb.get("parent_call_log_id") == log_id, (
            f"expected parent_call_log_id={log_id}, got {new_cb.get('parent_call_log_id')}"
        )
        # Scheduled ~3h in future
        sched_dt = datetime.fromisoformat(str(new_cb["scheduled_at"]).replace("Z", "+00:00"))
        delta_min = (sched_dt - datetime.now(timezone.utc)).total_seconds() / 60
        assert 170 < delta_min < 195, f"expected ~180min, got {delta_min:.1f}"

        # cleanup follow-up
        requests.delete(f"{API}/callbacks/{new_cb['callback_id']}", headers=H)

    def test_get_calls_log_for_contact(self, H, contact_id):
        r = requests.get(f"{API}/calls/log", params={"contact_id": contact_id, "limit": 200}, headers=H)
        assert r.status_code == 200, r.text
        body = r.json()
        items = body.get("items", body if isinstance(body, list) else [])
        # At least the 2 posted above must be returned
        assert len(items) >= 2, f"expected ≥2 logs, got {len(items)}"
        first = items[0]
        for k in ("outcome_id", "created_at"):
            assert k in first, f"missing field '{k}' in call log: {first}"


class TestCallOutcomesSeed:
    def test_default_outcomes_present(self, H):
        r = requests.get(f"{API}/settings", headers=H)
        assert r.status_code == 200
        outs = r.json().get("call_outcomes") or []
        ids = {o["id"] for o in outs}
        required = {"call_appointment", "call_no_answer", "call_recall", "call_busy",
                    "call_wrong_number", "call_not_interested"}
        assert required.issubset(ids), f"missing outcomes: {required - ids}"
