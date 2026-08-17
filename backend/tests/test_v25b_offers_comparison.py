"""V25.b: Company Offers + Comparison tests."""
import os, time, base64, pytest, requests
from io import BytesIO

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL required"

OWNER = ("test@dalpastro.it", "Test1234!")


def _login(email, pwd):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def _pdf(lines):
    from reportlab.pdfgen import canvas
    buf = BytesIO(); c = canvas.Canvas(buf); c.setFont("Helvetica", 10)
    y = 780
    for line in lines: c.drawString(80, y, line); y -= 18
    c.save()
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(scope="module")
def tok():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def cid(tok):
    r = requests.get(f"{BASE_URL}/api/contacts", headers=_h(tok), timeout=15)
    return r.json()["items"][0]["contact_id"]


class TestOffersCRUD:
    def test_auth_required(self):
        r = requests.get(f"{BASE_URL}/api/company-offers", timeout=15)
        assert r.status_code == 401

    def test_list_empty(self, tok):
        r = requests.get(f"{BASE_URL}/api/company-offers", headers=_h(tok), timeout=15)
        assert r.status_code == 200
        assert "grouped" in r.json()

    def test_invalid_type(self, tok):
        r = requests.post(f"{BASE_URL}/api/company-offers", headers=_h(tok),
                          json={"bill_type": "invalid", "pdf_base64": _pdf(["test"])}, timeout=15)
        assert r.status_code == 400

    def test_upload_and_lifecycle(self, tok):
        b64 = _pdf([
            "MYENERGY BUSINESS SOLUTIONS",
            "Offerta: Fisso Premium",
            "Prezzo energia: 0,145 EUR/kWh",
            "Durata contratto: 24 mesi",
            "Penale uscita: 0 EUR",
        ])
        r = requests.post(f"{BASE_URL}/api/company-offers", headers=_h(tok),
                          json={"bill_type": "luce", "pdf_base64": b64, "label": "Test Offer"}, timeout=15)
        assert r.status_code == 200
        oid = r.json()["offer_id"]
        pytest.oid = oid  # type: ignore
        for _ in range(20):
            time.sleep(2)
            r = requests.get(f"{BASE_URL}/api/company-offers", headers=_h(tok), timeout=15)
            o = next((x for x in r.json()["items"] if x["offer_id"] == oid), None)
            if o and o["status"] in ("done", "error"): break
        assert o and o["status"] == "done", f"status={o.get('status') if o else None}"

    def test_pdf(self, tok):
        oid = getattr(pytest, "oid", None)
        r = requests.get(f"{BASE_URL}/api/company-offers/{oid}/pdf", headers=_h(tok), timeout=15)
        assert r.status_code == 200 and r.json().get("pdf_base64")

    def test_delete(self, tok):
        oid = getattr(pytest, "oid", None)
        r = requests.delete(f"{BASE_URL}/api/company-offers/{oid}", headers=_h(tok), timeout=15)
        assert r.status_code == 200


class TestComparison:
    def test_requires_bills_and_offers(self, tok, cid):
        # After cleanup no offers should exist → 400
        r = requests.get(f"{BASE_URL}/api/contacts/{cid}/bills/comparison", headers=_h(tok), timeout=15)
        assert r.status_code in (400, )

    def test_full_comparison(self, tok, cid):
        # Upload one bill + one offer, then compare
        bill_b64 = _pdf([
            "ENEL", "POD: IT001E12345678", "Tensione: Bassa",
            "Consumo totale 12 mesi: 3200 kWh",
            "Offerta: Placet Fisso", "Prezzo energia: 0,182 EUR/kWh",
            "IVA: 10%",
        ])
        offer_b64 = _pdf([
            "MYENERGY", "Offerta: Fisso Premium", "Prezzo energia: 0,145 EUR/kWh",
            "Durata contratto: 24 mesi", "Penale: 0",
        ])
        r = requests.post(f"{BASE_URL}/api/contacts/{cid}/bills", headers=_h(tok),
                          json={"bill_type": "luce", "pdf_base64": bill_b64}, timeout=15)
        bid = r.json()["bill_id"]
        r = requests.post(f"{BASE_URL}/api/company-offers", headers=_h(tok),
                          json={"bill_type": "luce", "pdf_base64": offer_b64, "label": "Comp Test"}, timeout=15)
        oid = r.json()["offer_id"]
        # Wait
        for _ in range(30):
            time.sleep(2)
            b = requests.get(f"{BASE_URL}/api/contacts/{cid}/bills", headers=_h(tok), timeout=15).json()
            o = requests.get(f"{BASE_URL}/api/company-offers", headers=_h(tok), timeout=15).json()
            bs = next((x["status"] for x in b["items"] if x["bill_id"] == bid), None)
            os_ = next((x["status"] for x in o["items"] if x["offer_id"] == oid), None)
            if bs in ("done", "error") and os_ in ("done", "error"): break
        assert bs == "done" and os_ == "done"

        r = requests.get(f"{BASE_URL}/api/contacts/{cid}/bills/comparison", headers=_h(tok), timeout=180)
        assert r.status_code == 200
        j = r.json()
        assert len(j["items"]) >= 1
        cmp = j["items"][0]["comparison"]
        # AI provided at least one of the key fields
        assert any(k in cmp for k in ("sintesi", "vantaggi_offerta_aziendale", "risparmio_annuo_stimato_eur", "raccomandazione"))

        # Cleanup
        requests.delete(f"{BASE_URL}/api/contacts/{cid}/bills/{bid}", headers=_h(tok))
        requests.delete(f"{BASE_URL}/api/company-offers/{oid}", headers=_h(tok))
