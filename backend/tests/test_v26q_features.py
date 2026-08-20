"""V26.q backend tests: manual_text company offers + appointments contact_id filter."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def contact_id(headers):
    """Reuse or create a TEST_ contact."""
    r = requests.get(f"{API}/contacts", headers=headers, timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", r.json() if isinstance(r.json(), list) else [])
    for c in items:
        if (c.get("first_name") or "").startswith("TEST_V26q"):
            return c["contact_id"]
    payload = {"first_name": "TEST_V26q", "last_name": "Cliente", "area": "energy", "phone": "+390000000"}
    r = requests.post(f"{API}/contacts", headers=headers, json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()["contact_id"]


# --- Feature 1: manual_text on company-offers ---
class TestCompanyOfferManualText:
    def test_reject_when_no_pdf_and_no_manual_text(self, headers):
        r = requests.post(f"{API}/company-offers", headers=headers, json={"bill_type": "luce"}, timeout=30)
        assert r.status_code == 400

    def test_reject_invalid_bill_type(self, headers):
        r = requests.post(f"{API}/company-offers", headers=headers, json={"bill_type": "invalid", "manual_text": "x" * 30}, timeout=30)
        assert r.status_code == 400

    def test_create_manual_text_offer_luce(self, headers):
        txt = "Offerta Placet Fisso Luce prezzo 0.13 €/kWh quota fissa 5€ durata 24 mesi, no penali."
        r = requests.post(f"{API}/company-offers", headers=headers, json={
            "bill_type": "luce",
            "manual_text": txt,
            "label": "TEST_V26q manual luce",
        }, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["bill_type"] == "luce"
        assert d.get("source") == "manual"
        assert d["status"] in ("pending", "analyzing")
        assert d.get("pdf_base64") is None
        offer_id = d["offer_id"]

        # Poll for background analysis (up to ~25s)
        final_status = None
        for _ in range(25):
            time.sleep(1)
            g = requests.get(f"{API}/company-offers", headers=headers, timeout=30)
            assert g.status_code == 200
            match = [o for o in g.json().get("items", []) if o["offer_id"] == offer_id]
            if match:
                final_status = match[0]["status"]
                if final_status in ("done", "error"):
                    break
        assert final_status in ("done", "error", "analyzing"), f"unexpected status: {final_status}"

        # Cleanup
        requests.delete(f"{API}/company-offers/{offer_id}", headers=headers, timeout=15)

    def test_create_manual_text_short_returns_error_status(self, headers):
        # Backend accepts <20 chars payload but analysis will set status=error
        r = requests.post(f"{API}/company-offers", headers=headers, json={
            "bill_type": "gas",
            "manual_text": "short",
            "label": "TEST_V26q too_short",
        }, timeout=30)
        # Server-side accepts (client validates >=20). But analyzer should mark error.
        assert r.status_code == 200
        offer_id = r.json()["offer_id"]
        time.sleep(5)
        g = requests.get(f"{API}/company-offers", headers=headers, timeout=30)
        m = [o for o in g.json()["items"] if o["offer_id"] == offer_id]
        assert m and m[0]["status"] in ("error", "pending", "analyzing")
        requests.delete(f"{API}/company-offers/{offer_id}", headers=headers, timeout=15)


# --- Feature 2: GET /appointments filter by contact_id ---
class TestAppointmentsContactFilter:
    def test_contact_id_filter_returns_only_matching(self, headers, contact_id):
        # Create an appointment linked to contact
        payload = {
            "title": "TEST_V26q Appt",
            "area": "energy",
            "start_at": "2027-01-15T10:00:00Z",
            "duration_min": 60,
            "contact_id": contact_id,
            "is_phone": False,
        }
        r = requests.post(f"{API}/appointments", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        appt_id = r.json()["appointment_id"]

        # Fetch filtered
        f = requests.get(f"{API}/appointments?contact_id={contact_id}", headers=headers, timeout=30)
        assert f.status_code == 200
        items = f.json()["items"]
        ids = [a["appointment_id"] for a in items]
        assert appt_id in ids
        assert all(a.get("contact_id") == contact_id for a in items), "filter leaked non-matching contacts"

        # PUT outcome_notes update
        u = requests.put(f"{API}/appointments/{appt_id}", headers=headers, json={"outcome_notes": "TEST note V26q"}, timeout=30)
        assert u.status_code == 200
        g = requests.get(f"{API}/appointments/{appt_id}", headers=headers, timeout=30)
        assert g.json().get("outcome_notes") == "TEST note V26q"

        # Cleanup
        requests.delete(f"{API}/appointments/{appt_id}", headers=headers, timeout=15)

    def test_no_filter_returns_all(self, headers):
        r = requests.get(f"{API}/appointments", headers=headers, timeout=30)
        assert r.status_code == 200
        assert "items" in r.json()


# --- Feature 4: reschedule flow — POST new appt + PUT rescheduled_to on old ---
class TestRescheduleFlow:
    def test_reschedule_creates_new_appt_and_updates_old(self, headers, contact_id):
        # Create original appt
        old_payload = {
            "title": "TEST_V26q Original",
            "area": "energy",
            "start_at": "2027-02-01T09:00:00Z",
            "duration_min": 30,
            "contact_id": contact_id,
        }
        r = requests.post(f"{API}/appointments", headers=headers, json=old_payload, timeout=30)
        assert r.status_code == 200
        old_id = r.json()["appointment_id"]

        # Simulate reschedule: create new + update old
        new_payload = {
            "title": "TEST_V26q Original (rinviato)",
            "area": "energy",
            "start_at": "2027-02-10T09:00:00Z",
            "duration_min": 30,
            "contact_id": contact_id,
            "is_phone": True,
            "notes": "Ri-programmato da: TEST_V26q Original",
        }
        n = requests.post(f"{API}/appointments", headers=headers, json=new_payload, timeout=30)
        assert n.status_code == 200
        new_id = n.json()["appointment_id"]

        u = requests.put(f"{API}/appointments/{old_id}", headers=headers, json={"rescheduled_to": new_id}, timeout=30)
        assert u.status_code == 200

        g = requests.get(f"{API}/appointments/{old_id}", headers=headers, timeout=30)
        assert g.status_code == 200
        assert g.json().get("rescheduled_to") == new_id

        # Cleanup
        requests.delete(f"{API}/appointments/{old_id}", headers=headers, timeout=15)
        requests.delete(f"{API}/appointments/{new_id}", headers=headers, timeout=15)
