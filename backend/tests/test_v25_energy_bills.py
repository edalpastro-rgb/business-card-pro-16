"""
V25: Energy Bills (Fatture Energia) — Claude Sonnet 5 background AI analysis tests.

Covers:
- POST/GET/DELETE endpoints
- Background analysis lifecycle: pending → analyzing → done
- Report endpoint with AI suggestions
- Auth-required + tenant scoping
"""

import os
import time
import base64
import pytest
import requests
from io import BytesIO

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PWD = "Test1234!"


def _login(email: str, pwd: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _headers(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def _make_bill_pdf(fornitore: str, bill_type: str = "luce") -> bytes:
    from reportlab.pdfgen import canvas
    buf = BytesIO()
    c = canvas.Canvas(buf)
    c.setFont("Helvetica", 10)
    y = 780
    if bill_type == "luce":
        lines = [
            f"{fornitore} S.p.A.",
            "Cliente: Test Cliente Automation",
            "POD: IT001E12345678",
            "Tensione: Bassa",
            "Potenza impegnata: 3 kW",
            "Consumo totale 12 mesi: 2450 kWh",
            "Consumo medio mensile: 204 kWh",
            "Offerta: Placet Fisso Luce",
            "Data attivazione: 01/03/2024",
            "Data scadenza: 01/03/2026",
            "IVA: 10%",
            "Importo totale: 145,30 EUR",
        ]
    elif bill_type == "gas":
        lines = [
            f"{fornitore} S.p.A.",
            "Cliente: Test Cliente Automation",
            "PDR: 01234567890123",
            "Consumo totale 12 mesi: 850 SMC",
            "Consumo medio mensile: 71 SMC",
            "Offerta: Placet Gas",
            "Data attivazione: 01/06/2024",
            "IVA: 22%",
            "Accisa: 0,044 EUR/SMC",
            "Importo totale: 245,30 EUR",
        ]
    else:  # telco
        lines = [
            f"{fornitore} S.p.A.",
            "Cliente: Test Cliente Automation",
            "Tipo connessione: Fibra",
            "Velocita download: 1000 Mbps",
            "Costo mensile: 29,90 EUR",
            "Durata contratto: 24 mesi",
            "Codice migrazione: CM123456",
            "Penale disdetta: 49,90 EUR",
        ]
    for line in lines:
        c.drawString(80, y, line)
        y -= 18
    c.save()
    return buf.getvalue()


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PWD)


@pytest.fixture(scope="module")
def contact_id(owner_token):
    r = requests.get(f"{BASE_URL}/api/contacts", headers=_headers(owner_token), timeout=15)
    r.raise_for_status()
    items = r.json()["items"]
    if not items:
        # Create one
        r2 = requests.post(f"{BASE_URL}/api/contacts", headers=_headers(owner_token), timeout=15,
                           json={"first_name": "Bill", "last_name": "Test", "area": "energy", "source": "personal", "referral_note": "", "email_note": "", "general_note": "", "email": "", "phone": ""})
        r2.raise_for_status()
        return r2.json()["contact_id"]
    return items[0]["contact_id"]


class TestBillsCRUD:
    def test_auth_required(self, contact_id):
        r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills", timeout=15)
        assert r.status_code == 401

    def test_list_empty_or_ok(self, owner_token, contact_id):
        r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills", headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "grouped" in j and "items" in j
        assert set(j["grouped"].keys()) == {"luce", "gas", "telco"}

    def test_invalid_bill_type(self, owner_token, contact_id):
        pdf = _make_bill_pdf("Test")
        b64 = base64.b64encode(pdf).decode()
        r = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/bills", headers=_headers(owner_token),
                          json={"bill_type": "invalid_type", "pdf_base64": b64}, timeout=15)
        assert r.status_code == 400

    def test_upload_and_lifecycle(self, owner_token, contact_id):
        pdf = _make_bill_pdf("ENEL ENERGIA", "luce")
        b64 = base64.b64encode(pdf).decode()
        r = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/bills", headers=_headers(owner_token),
                          json={"bill_type": "luce", "pdf_base64": b64, "pdf_name": "enel-test.pdf"}, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["bill_id"]
        assert j["status"] == "pending"
        assert "pdf_base64" not in j  # not echoed
        bill_id = j["bill_id"]

        # Poll for completion
        final_status = None
        for _ in range(30):
            time.sleep(2)
            r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills", headers=_headers(owner_token), timeout=15)
            bill = next((b for b in r.json()["items"] if b["bill_id"] == bill_id), None)
            assert bill is not None
            if bill["status"] in ("done", "error"):
                final_status = bill["status"]
                break
        assert final_status == "done", f"Expected done, got {final_status}"
        assert bill.get("extracted") is not None
        ex = bill["extracted"]
        # AI should have extracted at least fornitore + POD
        assert "fornitore" in ex or "pod" in ex, f"Missing key fields: {ex}"

        # Store for other tests
        pytest.bill_id = bill_id  # type: ignore

    def test_get_pdf(self, owner_token, contact_id):
        bill_id = getattr(pytest, "bill_id", None)
        if not bill_id:
            pytest.skip("no bill from previous test")
        r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills/{bill_id}/pdf", headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j.get("pdf_base64")

    def test_reanalyze(self, owner_token, contact_id):
        bill_id = getattr(pytest, "bill_id", None)
        if not bill_id:
            pytest.skip("no bill")
        r = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/bills/{bill_id}/reanalyze",
                          headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "pending"

    def test_report_generation(self, owner_token, contact_id):
        # Wait a bit if reanalyze in progress
        for _ in range(20):
            time.sleep(2)
            r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills", headers=_headers(owner_token), timeout=15)
            done_count = sum(1 for b in r.json()["items"] if b.get("status") == "done")
            if done_count >= 1:
                break
        r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills/report", headers=_headers(owner_token), timeout=60)
        assert r.status_code == 200
        rep = r.json()
        assert "contact" in rep
        assert "grouped" in rep
        assert "ai_suggestions" in rep

    def test_delete(self, owner_token, contact_id):
        bill_id = getattr(pytest, "bill_id", None)
        if not bill_id:
            pytest.skip("no bill")
        r = requests.delete(f"{BASE_URL}/api/contacts/{contact_id}/bills/{bill_id}",
                            headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        # Confirm gone
        r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills", headers=_headers(owner_token), timeout=15)
        assert not any(b["bill_id"] == bill_id for b in r.json()["items"])


class TestBillsIsolation:
    def test_cross_contact_delete_returns_404(self, owner_token, contact_id):
        # Try to delete a non-existent bill
        r = requests.delete(f"{BASE_URL}/api/contacts/{contact_id}/bills/bill_ffffffffffff",
                            headers=_headers(owner_token), timeout=15)
        assert r.status_code == 404

    def test_report_requires_bills(self, owner_token, contact_id):
        # After cleanup, should return 400 if no analyzed bills
        # (bills may still exist from other tests, so skip if so)
        r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills", headers=_headers(owner_token), timeout=15)
        done_count = sum(1 for b in r.json()["items"] if b.get("status") == "done")
        if done_count == 0:
            r2 = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills/report", headers=_headers(owner_token), timeout=15)
            assert r2.status_code == 400
