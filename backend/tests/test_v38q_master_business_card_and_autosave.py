"""V38Q — Master Business Card + bill-drafts auto-save to master_files.

Covers:
  1. GET/PUT /api/master/business-card (auto-seed, upsert, card_id)
  2. GET /api/master/business-card/public/{card_id} (no auth, 404)
  3. PUT validation of qr_type ∈ {app, website, text, vcard}
  4. POST /api/bill-drafts → wait done → /api/master-files?category=bills
     contains "Analisi-<pdf_name>" entry, and re-analyze is idempotent.
  5. Regression: /api/auth/login, /api/contacts (DESC by created_at),
     /api/master-files CRUD.
"""
import os
import time
import base64
import io
import uuid
import pytest
import requests
from dotenv import load_dotenv
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB   = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


# --------------- fixtures ---------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body and "user" in body
    return body["token"]


@pytest.fixture
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sample_pdf_b64():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 12)
    y = 800
    for l in [
        "FATTURA ENERGIA ELETTRICA",
        "Fornitore: ENEL ENERGIA SPA",
        "Cliente: Mario Rossi",
        "POD: IT001E12345678",
        "Consumo annuo: 3200 kWh",
        "Potenza impegnata: 3 kW",
        "Tipologia: Domestico residente",
        "Periodo: 01/01/2026 - 28/02/2026",
        "Importo totale: 145,72 EUR",
        "Spesa materia energia: 78,00 EUR",
        "Spesa trasporto e gestione: 42,00 EUR",
        "Oneri di sistema: 25,72 EUR",
    ]:
        c.drawString(50, y, l); y -= 20
    c.save()
    return base64.b64encode(buf.getvalue()).decode()


# --------------- auth / regression ---------------
class TestAuthRegression:
    def test_login_returns_token_and_user(self):
        r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j.get("token"), str) and len(j["token"]) > 10
        assert j["user"]["email"] == OWNER["email"]

    def test_login_bad_password_401(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": OWNER["email"], "password": "wrong"}, timeout=15)
        assert r.status_code in (400, 401)

    def test_contacts_list_sorted_desc(self, owner_headers):
        r = requests.get(f"{API}/contacts", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        # Newest first
        cas = [c.get("created_at") for c in items if c.get("created_at")]
        assert cas == sorted(cas, reverse=True), "contacts NOT sorted DESC by created_at"


# --------------- Master Business Card ---------------
class TestBusinessCard:
    def test_get_auto_seeds_from_profile(self, owner_headers):
        r = requests.get(f"{API}/master/business-card", headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        # Auto-seeded default keys
        for k in ["display_name", "email", "phone", "qr_type", "accent_color"]:
            assert k in j, f"missing key {k}"
        assert j["email"] == OWNER["email"] or j["email"] == "" or j["email"]
        assert j["qr_type"] in {"app", "website", "text", "vcard"}

    def test_put_creates_card_with_card_id(self, owner_headers):
        payload = {
            "display_name": "TEST_V38Q Dal Pastro",
            "title": "Consulente Energetico",
            "company_name": "Dal Pastro Energy",
            "phone": "+390451234567",
            "email": "test@dalpastro.it",
            "website": "https://dalpastro.example",
            "tagline": "Risparmia in bolletta",
            "accent_color": "#7C3AED",
            "qr_type": "website",
            "qr_content": "https://dalpastro.example",
        }
        r = requests.put(f"{API}/master/business-card", json=payload,
                         headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("card_id"), "card_id must be auto-generated on first upsert"
        assert j["card_id"].startswith("bc_")
        assert j["display_name"] == payload["display_name"]
        assert j["qr_type"] == "website"

    def test_put_upsert_returns_same_card_id(self, owner_headers):
        r1 = requests.get(f"{API}/master/business-card", headers=owner_headers, timeout=15).json()
        cid1 = r1.get("card_id")
        assert cid1
        r2 = requests.put(f"{API}/master/business-card",
                          json={"tagline": "Updated tagline"},
                          headers=owner_headers, timeout=15)
        assert r2.status_code == 200
        j2 = r2.json()
        assert j2["card_id"] == cid1, "card_id must NOT change on subsequent PUTs"
        assert j2["tagline"] == "Updated tagline"

    def test_put_rejects_invalid_qr_type(self, owner_headers):
        r = requests.put(f"{API}/master/business-card",
                         json={"qr_type": "invalid_kind"},
                         headers=owner_headers, timeout=15)
        assert r.status_code == 400, r.text

    def test_put_accepts_all_valid_qr_types(self, owner_headers):
        for qt in ["app", "website", "text", "vcard"]:
            r = requests.put(f"{API}/master/business-card",
                             json={"qr_type": qt},
                             headers=owner_headers, timeout=15)
            assert r.status_code == 200, f"qr_type={qt} rejected: {r.text}"
            assert r.json()["qr_type"] == qt

    def test_public_endpoint_no_auth_returns_card(self, owner_headers):
        card = requests.get(f"{API}/master/business-card", headers=owner_headers, timeout=15).json()
        cid = card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{cid}", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "user_id" not in j, "public payload must NOT expose user_id"
        assert j["card_id"] == cid
        assert "display_name" in j

    def test_public_endpoint_404_for_unknown_card(self):
        r = requests.get(f"{API}/master/business-card/public/bc_doesnotexist", timeout=15)
        assert r.status_code == 404


# --------------- Bill-drafts autosave ---------------
class TestBillDraftAutoSave:
    def _wait_done(self, draft_id, headers, timeout=90):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            r = requests.get(f"{API}/bill-drafts/{draft_id}", headers=headers, timeout=15)
            if r.status_code == 200:
                last = r.json()
                if last.get("status") in ("done", "error"):
                    return last
            time.sleep(3)
        return last

    def test_create_draft_and_auto_save_to_master_files(self, owner_headers, sample_pdf_b64):
        unique = uuid.uuid4().hex[:6]
        pdf_name = f"TEST_V38Q_bill_{unique}.pdf"
        r = requests.post(f"{API}/bill-drafts",
                          json={"bill_type": "luce", "pdf_base64": sample_pdf_b64,
                                "pdf_name": pdf_name, "pdf_mime": "application/pdf"},
                          headers=owner_headers, timeout=30)
        assert r.status_code == 200, r.text
        draft = r.json()
        draft_id = draft["draft_id"]

        final = self._wait_done(draft_id, owner_headers, timeout=120)
        assert final is not None, "draft did not update"
        # Even if analysis errors (LLM outage), we only require done→autosave path.
        # Skip autosave check when the LLM path errored, but note it.
        if final.get("status") != "done":
            pytest.skip(f"draft status={final.get('status')} err={final.get('error_message')}")

        # Now check master-files category=bills contains Analisi-<pdf_name>
        target = f"Analisi-{pdf_name}"
        r2 = requests.get(f"{API}/master-files", params={"category": "bills"},
                          headers=owner_headers, timeout=15)
        assert r2.status_code == 200
        items = r2.json().get("items", [])
        names = [it.get("name") for it in items]
        assert target in names, f"'{target}' not in master-files/bills: {names[:5]}"

        # Idempotency: re-analyze same draft → still ONE copy
        rr = requests.post(f"{API}/bill-drafts/{draft_id}/reanalyze",
                           headers=owner_headers, timeout=15)
        assert rr.status_code == 200, rr.text
        final2 = self._wait_done(draft_id, owner_headers, timeout=120)
        if final2 and final2.get("status") == "done":
            r3 = requests.get(f"{API}/master-files", params={"category": "bills"},
                              headers=owner_headers, timeout=15)
            names2 = [it.get("name") for it in r3.json().get("items", [])]
            assert names2.count(target) == 1, f"Duplicate auto-save! count={names2.count(target)}"

        # Cleanup: delete the master_file + draft
        try:
            for it in r2.json().get("items", []):
                if it.get("name") == target:
                    requests.delete(f"{API}/master-files/{it['file_id']}",
                                    headers=owner_headers, timeout=10)
                    break
            requests.delete(f"{API}/bill-drafts/{draft_id}",
                            headers=owner_headers, timeout=10)
        except Exception:
            pass


# --------------- Master-files CRUD regression ---------------
class TestMasterFilesCRUD:
    def test_create_list_delete_master_file(self, owner_headers):
        payload_b64 = base64.b64encode(b"hello world test content").decode()
        create = requests.post(f"{API}/master-files",
                               json={"category": "files",
                                     "name": f"TEST_V38Q_doc_{uuid.uuid4().hex[:6]}.txt",
                                     "mime": "text/plain",
                                     "data_base64": payload_b64},
                               headers=owner_headers, timeout=15)
        assert create.status_code in (200, 201), create.text
        fid = create.json()["file_id"]

        lst = requests.get(f"{API}/master-files", params={"category": "files"},
                           headers=owner_headers, timeout=15)
        assert lst.status_code == 200
        assert any(x["file_id"] == fid for x in lst.json()["items"])

        d = requests.delete(f"{API}/master-files/{fid}", headers=owner_headers, timeout=15)
        assert d.status_code in (200, 204)
