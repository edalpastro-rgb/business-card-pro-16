"""V38S regression: auth, appointments (new type tags), master-files, business-card, bill-drafts."""
import os
import pytest
import requests

BASE = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                BASE = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

API = f"{BASE}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# Auth
def test_login():
    r = requests.post(f"{API}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"})
    assert r.status_code == 200
    assert "token" in r.json()


# Appointments GET
def test_appointments_get(headers):
    r = requests.get(f"{API}/appointments", headers=headers)
    assert r.status_code == 200
    assert "items" in r.json()


# Appointments POST with new type tags
@pytest.mark.parametrize("tag", ["Energy", "Telefonata", "Personale", "Riunione", "Promemoria", "Altro"])
def test_appointment_new_type_tags(headers, tag):
    payload = {
        "title": f"TEST_V38S {tag}",
        "area": "energy",
        "start_at": "2026-03-01T10:00:00Z",
        "duration_min": 30,
        "reminder_minutes": 15,
        "recurrence": "none",
        "is_phone": False,
        "location": "",
        "notes": "",
        "value_amount": 0,
        "appointment_type_tags": [tag],
    }
    r = requests.post(f"{API}/appointments", headers=headers, json=payload)
    assert r.status_code in (200, 201), r.text
    appt_id = r.json().get("appointment_id")
    assert appt_id
    # cleanup
    requests.delete(f"{API}/appointments/{appt_id}", headers=headers)


# Master files
def test_master_files(headers):
    r = requests.get(f"{API}/master-files", headers=headers)
    assert r.status_code == 200
    assert "items" in r.json()


# Master business card
def test_master_business_card(headers):
    r = requests.get(f"{API}/master/business-card", headers=headers)
    assert r.status_code == 200
    # should exist with branding-related fields (may be auto-seeded)
    data = r.json()
    assert isinstance(data, dict)


# Bill drafts
def test_bill_drafts(headers):
    r = requests.get(f"{API}/bill-drafts", headers=headers)
    assert r.status_code == 200
    assert "items" in r.json()
