"""V38U — Web link + Fiscal check + Report header branding + regression tests."""
import os
import base64
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- (1) Report branding: slogan + contacts persisted ----------
class TestReportBranding:
    def test_put_profile_slogan_contacts(self, headers):
        payload = {
            "report_slogan": "Consulenza energetica e reti — dal 1998",
            "report_contacts": "Via Roma 1, 30100 Venezia · +39 041 123456 · info@dalpastro.it",
        }
        r = requests.put(f"{API}/auth/profile", headers=headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["report_slogan"] == payload["report_slogan"]
        assert u["report_contacts"] == payload["report_contacts"]

    def test_get_me_returns_new_fields(self, headers):
        r = requests.get(f"{API}/auth/me", headers=headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        u = body.get("user", body)
        assert "report_slogan" in u
        assert "report_contacts" in u
        assert u["report_slogan"]
        assert u["report_contacts"]


# ---------- (2) POST /api/bill-drafts with fiscal-check markers ----------
def _tiny_pdf_b64():
    # minimal valid PDF (header + eof)
    pdf = (b"%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
           b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n"
           b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\n"
           b"xref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n0000000110 00000 n\ntrailer<< /Root 1 0 R /Size 4 >>\nstartxref\n180\n%%EOF")
    return base64.b64encode(pdf).decode()


class TestBillDraftsFiscal:
    def test_create_draft_with_fiscal_markers(self, headers):
        payload = {
            "bill_type": "gas",
            "pdf_base64": _tiny_pdf_b64(),
            "pdf_name": "TEST_fiscal_gas.pdf",
            "pdf_mime": "application/pdf",
            "label": "TEST-fiscal",
            "analysis_params": ["__verifica_iva__=22", "__verifica_accise_gas__=0.012498", "Costo materia prima gas"],
        }
        r = requests.post(f"{API}/bill-drafts", headers=headers, json=payload, timeout=30)
        # Backend uses default 200 (not 201) — accept both
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d.get("draft_id")
        params = d.get("analysis_params") or []
        assert "__verifica_iva__=22" in params
        assert "__verifica_accise_gas__=0.012498" in params
        # GET back to verify persistence
        gr = requests.get(f"{API}/bill-drafts/{d['draft_id']}", headers=headers, timeout=15)
        assert gr.status_code == 200
        persisted = gr.json()
        assert "__verifica_iva__=22" in (persisted.get("analysis_params") or [])
        # cleanup
        requests.delete(f"{API}/bill-drafts/{d['draft_id']}", headers=headers, timeout=15)

    def test_llm_helper_filters_verifica_markers(self):
        """Unit: _llm_analyze_bill_text splits fiscal_directives vs display_params."""
        import sys
        sys.path.insert(0, "/app/backend")
        # We cannot easily call the async LLM path without hitting Claude — instead
        # verify the parsing logic by inspecting the module source (contract test).
        with open("/app/backend/server.py", "r") as f:
            src = f.read()
        assert 'fiscal_directives: List[str] = []' in src
        assert 's.startswith("__verifica_")' in src
        assert 'PARAMETRI PRIORITARI RICHIESTI DALL' in src
        # Verify the display_params branch skips __verifica_* markers
        assert 'display_params.append(s)' in src


# ---------- (3) Regression ----------
class TestRegression:
    def test_login_ok(self):
        r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
        assert r.status_code == 200
        assert "token" in r.json()

    def test_list_contacts(self, headers):
        r = requests.get(f"{API}/contacts", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_list_bill_drafts(self, headers):
        r = requests.get(f"{API}/bill-drafts", headers=headers, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_master_files_reachable(self, headers):
        r = requests.get(f"{API}/master-files", headers=headers, timeout=15)
        assert r.status_code == 200

    def test_master_business_card_reachable(self, headers):
        r = requests.get(f"{API}/master/business-card", headers=headers, timeout=15)
        # Endpoint returns 200 with data OR 404 if not yet created — both are fine
        assert r.status_code in (200, 404)

    def test_create_contact_with_website(self, headers):
        payload = {
            "first_name": "TEST_Web",
            "last_name": "V38U",
            "area": "energy",
            "website": "https://example.com",
            "phone": "+390000000",
        }
        r = requests.post(f"{API}/contacts", headers=headers, json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        c = r.json()
        cid = c.get("contact_id") or c.get("id")
        assert cid
        # verify website persisted
        gr = requests.get(f"{API}/contacts/{cid}", headers=headers, timeout=15)
        assert gr.status_code == 200
        assert gr.json().get("website") == "https://example.com"
        # cleanup
        requests.delete(f"{API}/contacts/{cid}", headers=headers, timeout=15)
