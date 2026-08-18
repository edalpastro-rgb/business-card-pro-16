"""V26.m backend tests: GET/PUT/DELETE /callbacks/{callback_id}

Covers:
- GET /callbacks/{callback_id}: NEW endpoint, returns callback data or 404
- PUT /callbacks/{callback_id}: verify note update via edit form
- DELETE /callbacks/{callback_id}: verify delete via edit form
- POST /callbacks with and without contact_id (row tap fallback scenario)
"""
import os
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://consulente-app.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    if data.get("requires_2fa"):
        pytest.skip("Test account has 2FA enabled")
    token = data.get("token")
    assert token
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def contact_id(auth_headers):
    r = requests.post(f"{API}/contacts", json={
        "first_name": "TEST_V26M", "last_name": "Row", "phone": "+391112223399", "area": "energy"
    }, headers=auth_headers, timeout=15)
    assert r.status_code in (200, 201), r.text
    cid = r.json().get("contact_id") or r.json().get("id")
    yield cid
    requests.delete(f"{API}/contacts/{cid}", headers=auth_headers, timeout=10)


class TestCallbackWithContact:
    """Scenario 1: Callback created WITH linked contact_id."""

    def test_create_with_contact(self, auth_headers, contact_id):
        sched = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        r = requests.post(f"{API}/callbacks", json={
            "title": "TEST_row_with_contact",
            "area": "energy",
            "scheduled_at": sched,
            "contact_id": contact_id,
            "note": "linked",
        }, headers=auth_headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        cb = r.json()
        cb_id = cb.get("callback_id") or cb.get("id")
        assert cb_id
        assert cb.get("contact_id") == contact_id
        # cleanup
        requests.delete(f"{API}/callbacks/{cb_id}", headers=auth_headers, timeout=10)


class TestCallbackWithoutContactEditFlow:
    """Scenario 2 (V26.m): Fallback to /callback/{id} when contact_id is null.
    Tests full edit form flow: GET → PUT → GET(verify) → DELETE → GET(404).
    """

    cb_id = None

    def test_create_without_contact(self, auth_headers):
        sched = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        r = requests.post(f"{API}/callbacks", json={
            "title": "TEST_row_no_contact",
            "area": "energy",
            "scheduled_at": sched,
            "note": "original_note",
        }, headers=auth_headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        cb = r.json()
        TestCallbackWithoutContactEditFlow.cb_id = cb.get("callback_id") or cb.get("id")
        assert TestCallbackWithoutContactEditFlow.cb_id
        # Verify NULL/absent contact_id
        assert not cb.get("contact_id"), f"Expected null contact_id, got {cb.get('contact_id')}"

    def test_get_callback_by_id(self, auth_headers):
        """NEW GET /callbacks/{callback_id} endpoint."""
        cb_id = TestCallbackWithoutContactEditFlow.cb_id
        assert cb_id
        r = requests.get(f"{API}/callbacks/{cb_id}", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        cb = r.json()
        assert cb.get("title") == "TEST_row_no_contact"
        assert cb.get("area") == "energy"
        assert cb.get("note") == "original_note"
        assert cb.get("scheduled_at")
        # contact_id may be null or absent
        assert not cb.get("contact_id")

    def test_put_update_note(self, auth_headers):
        cb_id = TestCallbackWithoutContactEditFlow.cb_id
        r = requests.put(f"{API}/callbacks/{cb_id}", json={"note": "MODIFIED_NOTE"},
                         headers=auth_headers, timeout=15)
        assert r.status_code in (200, 204), r.text
        # Verify via GET
        r2 = requests.get(f"{API}/callbacks/{cb_id}", headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("note") == "MODIFIED_NOTE"

    def test_modified_note_in_list(self, auth_headers):
        """Ensure the modified note is visible in the day listing (used by Home subtitle)."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = requests.get(f"{API}/callbacks?day={today}&include_done=true",
                         headers=auth_headers, timeout=15)
        assert r.status_code == 200
        cb_id = TestCallbackWithoutContactEditFlow.cb_id
        items = r.json().get("items", [])
        found = [x for x in items if (x.get("callback_id") or x.get("id")) == cb_id]
        assert found, "Callback missing from today list"
        assert found[0].get("note") == "MODIFIED_NOTE"

    def test_delete_callback(self, auth_headers):
        cb_id = TestCallbackWithoutContactEditFlow.cb_id
        r = requests.delete(f"{API}/callbacks/{cb_id}", headers=auth_headers, timeout=15)
        assert r.status_code in (200, 204)
        # Verify 404 on GET
        r2 = requests.get(f"{API}/callbacks/{cb_id}", headers=auth_headers, timeout=15)
        assert r2.status_code == 404


class TestCallbackGetEdgeCases:
    def test_get_nonexistent_returns_404(self, auth_headers):
        r = requests.get(f"{API}/callbacks/cb_doesnotexist12345",
                         headers=auth_headers, timeout=15)
        assert r.status_code == 404
