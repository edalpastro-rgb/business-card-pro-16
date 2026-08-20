"""V26.o — Backend regression for UI/UX fixes:
- Callbacks with contact_id / phone-only / neither
- Call log creation with callback_id + outcome + phone
- /api/reports?period=day used by Master statistiche
"""
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def _iso_soon(minutes=10):
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


# --- Callback creation variants ---

def test_callback_with_contact(client):
    # Create a contact first
    c = client.post(f"{BASE_URL}/api/contacts", json={"first_name": "TEST_V26O", "last_name": "WithContact", "phones": [{"label": "Cellulare", "number": "+393334445566"}]})
    assert c.status_code in (200, 201), c.text
    contact_id = c.json()["contact_id"]

    r = client.post(f"{BASE_URL}/api/callbacks", json={
        "contact_id": contact_id,
        "title": "TEST_V26O contact-linked",
        "area": "energy",
        "scheduled_at": _iso_soon(20),
        "note": "test",
    })
    assert r.status_code in (200, 201), r.text
    cb = r.json()
    assert cb["contact_id"] == contact_id
    assert cb["title"] == "TEST_V26O contact-linked"

    # cleanup
    client.delete(f"{BASE_URL}/api/callbacks/{cb['callback_id']}")
    client.delete(f"{BASE_URL}/api/contacts/{contact_id}")


def test_callback_phone_only_no_contact(client):
    r = client.post(f"{BASE_URL}/api/callbacks", json={
        "title": "TEST_V26O No contact but phone",
        "area": "energy",
        "scheduled_at": _iso_soon(15),
        "phone": "+393331112233",
    })
    assert r.status_code in (200, 201), r.text
    cb = r.json()
    assert cb.get("contact_id") in (None, "", "null")
    assert cb["phone"] == "+393331112233"
    cb_id = cb["callback_id"]

    # GET to verify persistence in day listing
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).date().isoformat()
    g = client.get(f"{BASE_URL}/api/callbacks?day={today}&include_done=true")
    assert g.status_code == 200
    found = [x for x in g.json()["items"] if x["callback_id"] == cb_id]
    assert len(found) == 1
    assert found[0]["phone"] == "+393331112233"

    # Log a call for this callback with outcome=call_busy
    log = client.post(f"{BASE_URL}/api/calls/log", json={
        "callback_id": cb_id,
        "outcome_id": "call_busy",
        "phone": "+393331112233",
        "note": "TEST_V26O busy",
    })
    assert log.status_code in (200, 201), log.text
    body = log.json()
    log_obj = body.get("log", body)
    assert log_obj.get("outcome_id") == "call_busy"
    assert log_obj.get("callback_id") == cb_id
    assert log_obj.get("phone") == "+393331112233"

    # Verify the callback still exists and has last_call_outcome_id
    g2 = client.get(f"{BASE_URL}/api/callbacks/{cb_id}")
    assert g2.status_code == 200
    assert g2.json().get("last_call_outcome_id") == "call_busy"

    # cleanup
    client.delete(f"{BASE_URL}/api/callbacks/{cb_id}")


def test_callback_no_contact_no_phone(client):
    r = client.post(f"{BASE_URL}/api/callbacks", json={
        "title": "TEST_V26O neither",
        "area": "energy",
        "scheduled_at": _iso_soon(30),
    })
    assert r.status_code in (200, 201), r.text
    cb = r.json()
    assert not cb.get("contact_id")
    assert not cb.get("phone")
    client.delete(f"{BASE_URL}/api/callbacks/{cb['callback_id']}")


# --- Reports for Master statistiche ---

def test_reports_day_returns_energy_network(client):
    r = client.get(f"{BASE_URL}/api/reports?period=day")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "stats" in data
    assert "energy" in data["stats"]
    assert "network" in data["stats"]
    for area in ("energy", "network"):
        s = data["stats"][area]
        assert "appointments_done" in s
        assert "contracts" in s
        assert "products" in s
