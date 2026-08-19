"""V38R — Phase 1 backend regression:
1. POST /api/master-files accepts category='analisi' (was 400)
2. GET /api/master-files?category=analisi filters correctly
3. POST /api/bill-drafts → after 'done' status, TWO master_files entries are
   created: category='bills' (raw PDF, ~pdf size) AND category='analisi'
   (HTML, much smaller). Sizes must be DIFFERENT.
4. POST /api/master-files/{file_id}/share-link returns {url, expires_at,
   name, mime} pattern /api/public/master-files/{token}
5. GET /api/public/master-files/{token} without auth serves the file inline
6. Public endpoint error paths: invalid token → 400, wrong-kind token → 400,
   expired token → 410
7. Regression: /api/auth/login, /api/master/business-card, /api/contacts (DESC)
"""
import os
import time
import base64
import io
import uuid
import jwt
import pytest
import requests
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me-in-prod-9827345")

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_user_id(owner_token):
    r = requests.get(f"{API}/auth/me",
                     headers={"Authorization": f"Bearer {owner_token}"}, timeout=15)
    assert r.status_code == 200
    return r.json()["user"]["user_id"]


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
        "Spesa trasporto: 42,00 EUR",
        "Oneri di sistema: 25,72 EUR",
    ]:
        c.drawString(50, y, l); y -= 20
    c.save()
    return base64.b64encode(buf.getvalue()).decode()


# ============ 1. category='analisi' accepted ============
class TestAnalisiCategoryAccepted:
    def test_post_master_file_with_analisi_category(self, owner_headers):
        html = "<html><body><h1>TEST_V38R analisi</h1></body></html>"
        b64 = base64.b64encode(html.encode()).decode()
        payload = {
            "category": "analisi",
            "name": f"TEST_V38R_analisi_{uuid.uuid4().hex[:6]}.html",
            "mime": "text/html",
            "data_base64": b64,
        }
        r = requests.post(f"{API}/master-files", json=payload,
                          headers=owner_headers, timeout=15)
        assert r.status_code in (200, 201), f"category=analisi rejected: {r.text}"
        j = r.json()
        assert j["category"] == "analisi"
        assert j.get("file_id", "").startswith("mf_")
        # cleanup
        requests.delete(f"{API}/master-files/{j['file_id']}",
                        headers=owner_headers, timeout=10)

    def test_list_filter_by_analisi_category(self, owner_headers):
        # Create 2 items in 'analisi' and 1 in 'files'
        created_ids = []
        for i in range(2):
            r = requests.post(f"{API}/master-files",
                json={"category": "analisi",
                      "name": f"TEST_V38R_filter_ana_{i}_{uuid.uuid4().hex[:6]}.html",
                      "mime": "text/html",
                      "data_base64": base64.b64encode(f"<p>ana{i}</p>".encode()).decode()},
                headers=owner_headers, timeout=15)
            assert r.status_code in (200, 201)
            created_ids.append(("analisi", r.json()["file_id"], r.json()["name"]))
        r = requests.post(f"{API}/master-files",
            json={"category": "files",
                  "name": f"TEST_V38R_filter_other_{uuid.uuid4().hex[:6]}.txt",
                  "mime": "text/plain",
                  "data_base64": base64.b64encode(b"other").decode()},
            headers=owner_headers, timeout=15)
        created_ids.append(("files", r.json()["file_id"], r.json()["name"]))

        lst = requests.get(f"{API}/master-files", params={"category": "analisi"},
                           headers=owner_headers, timeout=15)
        assert lst.status_code == 200
        items = lst.json().get("items", [])
        cats = {it.get("category") for it in items}
        assert cats == {"analisi"} or (cats == set() and len(items) == 0), \
            f"list is not filtered to only analisi: got {cats}"
        # our 2 analisi items must be present
        our_ana_names = {name for cat, _, name in created_ids if cat == "analisi"}
        got_names = {it["name"] for it in items}
        assert our_ana_names.issubset(got_names), (
            f"missing analisi items in filtered list: expected {our_ana_names}, "
            f"got {list(got_names)[:10]}")

        # cleanup
        for _, fid, _ in created_ids:
            requests.delete(f"{API}/master-files/{fid}",
                            headers=owner_headers, timeout=10)

    def test_invalid_category_still_rejected(self, owner_headers):
        r = requests.post(f"{API}/master-files",
            json={"category": "invalid_cat", "name": "x.txt", "mime": "text/plain",
                  "data_base64": base64.b64encode(b"x").decode()},
            headers=owner_headers, timeout=15)
        assert r.status_code == 400


# ============ 2. Bill-draft creates TWO entries (bills+analisi) ============
class TestBillDraftDualSave:
    def _wait_done(self, draft_id, headers, timeout=180):
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

    def test_draft_creates_bills_and_analisi_entries(self, owner_headers, sample_pdf_b64):
        unique = uuid.uuid4().hex[:6]
        pdf_name = f"TEST_V38R_bill_{unique}.pdf"
        pdf_size_bytes = int(len(sample_pdf_b64) * 0.75)

        r = requests.post(f"{API}/bill-drafts",
                          json={"bill_type": "luce", "pdf_base64": sample_pdf_b64,
                                "pdf_name": pdf_name, "pdf_mime": "application/pdf"},
                          headers=owner_headers, timeout=30)
        assert r.status_code == 200, r.text
        draft_id = r.json()["draft_id"]
        final = self._wait_done(draft_id, owner_headers, timeout=180)
        assert final is not None
        if final.get("status") != "done":
            pytest.skip(f"draft status={final.get('status')} err={final.get('error_message')}")

        # Fetch both categories
        r_bills = requests.get(f"{API}/master-files", params={"category": "bills"},
                               headers=owner_headers, timeout=15)
        r_ana = requests.get(f"{API}/master-files", params={"category": "analisi"},
                             headers=owner_headers, timeout=15)
        assert r_bills.status_code == 200 and r_ana.status_code == 200

        bills_items = r_bills.json().get("items", [])
        ana_items = r_ana.json().get("items", [])

        expected_bill = pdf_name  # "{base}.pdf"
        expected_ana = f"Analisi-{pdf_name[:-4]}.html"

        bill_match = [it for it in bills_items if it["name"] == expected_bill]
        ana_match = [it for it in ana_items if it["name"] == expected_ana]

        assert bill_match, f"'{expected_bill}' NOT in bills; got names={[b['name'] for b in bills_items][:8]}"
        assert ana_match, f"'{expected_ana}' NOT in analisi; got names={[a['name'] for a in ana_items][:8]}"

        bill_size = bill_match[0].get("size") or 0
        ana_size = ana_match[0].get("size") or 0

        assert bill_size > 0 and ana_size > 0
        assert bill_size != ana_size, (
            f"bills and analisi files have SAME size: bills={bill_size} ana={ana_size} — "
            "expected different files")
        # PDF should generally be larger than HTML analysis (rough sanity)
        assert bill_size > 500, f"bill size suspicious: {bill_size}"

        # Idempotency: reanalyze → still ONE of each name
        rr = requests.post(f"{API}/bill-drafts/{draft_id}/reanalyze",
                           headers=owner_headers, timeout=15)
        assert rr.status_code == 200
        self._wait_done(draft_id, owner_headers, timeout=180)
        r_bills2 = requests.get(f"{API}/master-files", params={"category": "bills"},
                                headers=owner_headers, timeout=15).json().get("items", [])
        r_ana2 = requests.get(f"{API}/master-files", params={"category": "analisi"},
                              headers=owner_headers, timeout=15).json().get("items", [])
        assert [x["name"] for x in r_bills2].count(expected_bill) == 1
        assert [x["name"] for x in r_ana2].count(expected_ana) == 1

        # Cleanup
        for it in bill_match + ana_match:
            requests.delete(f"{API}/master-files/{it['file_id']}",
                            headers=owner_headers, timeout=10)
        requests.delete(f"{API}/bill-drafts/{draft_id}", headers=owner_headers, timeout=10)


# ============ 3. Master-files share-link + public endpoint ============
class TestMasterFileShareLink:
    @pytest.fixture
    def sample_master_file(self, owner_headers):
        payload_b64 = base64.b64encode(b"TEST_V38R share content hello world").decode()
        r = requests.post(f"{API}/master-files",
                          json={"category": "files",
                                "name": f"TEST_V38R_share_{uuid.uuid4().hex[:6]}.txt",
                                "mime": "text/plain",
                                "data_base64": payload_b64},
                          headers=owner_headers, timeout=15)
        assert r.status_code in (200, 201)
        fid = r.json()["file_id"]
        yield fid, r.json()["name"]
        requests.delete(f"{API}/master-files/{fid}", headers=owner_headers, timeout=10)

    def test_create_share_link_returns_valid_url(self, owner_headers, sample_master_file):
        fid, name = sample_master_file
        r = requests.post(f"{API}/master-files/{fid}/share-link",
                          headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ["url", "expires_at", "name", "mime"]:
            assert k in j, f"missing key {k}"
        assert "/api/public/master-files/" in j["url"], f"bad URL: {j['url']}"
        assert j["name"] == name

    def test_public_endpoint_serves_file_no_auth(self, owner_headers, sample_master_file):
        fid, name = sample_master_file
        j = requests.post(f"{API}/master-files/{fid}/share-link",
                          headers=owner_headers, timeout=15).json()
        url = j["url"]
        # No auth header
        r = requests.get(url, timeout=15)
        assert r.status_code == 200, r.text
        assert r.content == b"TEST_V38R share content hello world"
        cd = r.headers.get("content-disposition", "")
        assert "inline" in cd.lower(), f"expected inline disposition, got: {cd}"
        assert name in cd
        assert "text/plain" in r.headers.get("content-type", "")

    def test_public_endpoint_invalid_token_400(self):
        r = requests.get(f"{API}/public/master-files/not.a.token", timeout=15)
        assert r.status_code == 400

    def test_public_endpoint_wrong_kind_token_400(self, owner_user_id):
        # Sign a token with kind='cfile' (contact-file) instead of 'mfile'
        token = jwt.encode({
            "kind": "cfile",
            "file_id": "fake",
            "user_id": owner_user_id,
            "exp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
        }, JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/public/master-files/{token}", timeout=15)
        assert r.status_code == 400, f"expected 400 for wrong kind, got {r.status_code}: {r.text}"

    def test_public_endpoint_expired_token_410(self, owner_user_id):
        token = jwt.encode({
            "kind": "mfile",
            "file_id": "any",
            "user_id": owner_user_id,
            "exp": int((datetime.now(timezone.utc) - timedelta(hours=1)).timestamp()),
        }, JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/public/master-files/{token}", timeout=15)
        assert r.status_code == 410, f"expected 410 for expired, got {r.status_code}"


# ============ 4. Regression: business-card + contacts DESC ============
class TestRegression:
    def test_login_ok(self):
        r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
        assert r.status_code == 200
        assert "token" in r.json()

    def test_master_business_card_get(self, owner_headers):
        r = requests.get(f"{API}/master/business-card", headers=owner_headers, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "qr_type" in j and j["qr_type"] in {"app", "website", "text", "vcard"}

    def test_contacts_desc_by_created_at(self, owner_headers):
        r = requests.get(f"{API}/contacts", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        cas = [c.get("created_at") for c in items if c.get("created_at")]
        assert cas == sorted(cas, reverse=True), "contacts not DESC by created_at"
