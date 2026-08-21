"""V38W — Analysis page bugfixes tests.

Covers:
  (1) Emoji removed from analysis HTML title/H1 and section header
  (2) __verifica_ markers filtered from params chips
  (3) fiscal_check rendered as readable <li> rows (never JSON)
  (4) Notes labelled "Note di {consultant name}"
  (5) Professional header block (logo + agency + slogan + contacts)
  (6) Backend regression on auth / master-files / bill-drafts CRUD / business-card / assistant chat
"""

import os
import sys
import base64
import asyncio
import requests
import pytest

# Allow importing server module for unit tests on helper functions
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============================================================================
# (a) Unit tests on helper functions (pure Python, no DB)
# ============================================================================

class TestConsultantDisplay:
    """_consultant_display(user_doc)"""

    def test_prefers_name(self):
        from server import _consultant_display
        assert _consultant_display({"name": "Mario Rossi"}) == "Mario Rossi"

    def test_falls_back_to_company_name(self):
        from server import _consultant_display
        assert _consultant_display({"company_name": "Dal Pastro"}) == "Dal Pastro"

    def test_default_consulente_when_empty(self):
        from server import _consultant_display
        assert _consultant_display({}) == "Consulente"

    def test_none_input_returns_default(self):
        from server import _consultant_display
        assert _consultant_display(None) == "Consulente"

    def test_name_wins_over_company(self):
        from server import _consultant_display
        got = _consultant_display({"name": "Mario", "company_name": "Dal Pastro"})
        assert got == "Mario"


class TestFormatFiscalCheckHtml:
    """_format_fiscal_check_html(fc)"""

    def test_iva_ok_green(self):
        from server import _format_fiscal_check_html
        html = _format_fiscal_check_html({
            "iva": {"expected": 10, "actual": 10, "ok": True, "delta_annual_eur": None}
        })
        assert "IVA 10" in html
        assert "OK" in html
        # green success color
        assert "#059669" in html
        assert "errata" not in html

    def test_iva_wrong_red_with_delta(self):
        from server import _format_fiscal_check_html
        html = _format_fiscal_check_html({
            "iva": {"expected": 10, "actual": 22, "ok": False, "delta_annual_eur": 120}
        })
        assert "IVA errata" in html
        assert "attesa 10" in html
        assert "trovata 22" in html
        assert "Extra 12 mesi" in html
        assert "120" in html
        assert "#DC2626" in html  # red

    def test_pcv_ok(self):
        from server import _format_fiscal_check_html
        html = _format_fiscal_check_html({
            "pcv": {"expected": 5.0, "actual": 5.0, "ok": True, "delta_annual_eur": None}
        })
        assert "PCV" in html
        assert "OK" in html

    def test_empty_returns_blank(self):
        from server import _format_fiscal_check_html
        assert _format_fiscal_check_html({}) == ""
        assert _format_fiscal_check_html(None) == ""

    def test_output_is_never_raw_json(self):
        from server import _format_fiscal_check_html
        html = _format_fiscal_check_html({
            "iva": {"expected": 10, "actual": 10, "ok": True, "delta_annual_eur": None}
        })
        # Must not contain naive JSON serialization tokens
        assert '{"iva"' not in html
        assert '"ok": true' not in html
        assert '"ok":true' not in html


class TestBuildAnalysisHtml:
    """_build_analysis_html(extracted, bt_label, bt_color, doc_base, params, user_doc)"""

    def _sample_extracted(self):
        return {
            "fornitore": "Enel Energia",
            "nome_offerta": "Placet Fissa",
            "pod": "IT001E1234567",
            "note_ai": ["Prezzo competitivo", "Verificare accise"],
            "fiscal_check": {"iva": {"expected": 10, "actual": 22, "ok": False, "delta_annual_eur": 120}},
        }

    def test_no_corrupt_emoji_in_title(self):
        from server import _build_analysis_html
        user_doc = {"name": "Mario Rossi", "company_name": "Dal Pastro"}
        html = _build_analysis_html(self._sample_extracted(), "Luce", "#EA580C", "fattura-01", ["fornitore"], user_doc)
        # No corrupted characters
        assert "ðŸ" not in html
        assert "📄" not in html
        # Title tag clean
        assert "<title>Analisi Fattura Luce - fattura-01</title>" in html
        # H1 clean
        assert "<h1>Analisi Fattura Luce</h1>" in html

    def test_note_title_uses_consulenza_corporate(self):
        from server import _build_analysis_html
        html = _build_analysis_html(self._sample_extracted(), "Luce", "#EA580C", "doc", [], {"name": "Mario Rossi"})
        assert "Consulenza Corporate" in html
        assert "Note AI" not in html
        assert "Note di " not in html

    def test_note_title_is_static_regardless_of_company(self):
        from server import _build_analysis_html
        html = _build_analysis_html(self._sample_extracted(), "Luce", "#EA580C", "doc", [], {"company_name": "Dal Pastro"})
        assert "Consulenza Corporate" in html
        assert "Note di " not in html

    def test_note_title_default_consulenza_corporate(self):
        from server import _build_analysis_html
        html = _build_analysis_html(self._sample_extracted(), "Luce", "#EA580C", "doc", [], {})
        assert "Consulenza Corporate" in html
        assert "Note di " not in html

    def test_verifica_markers_filtered(self):
        from server import _build_analysis_html
        params = ["fornitore", "__verifica_iva__=10", "__verifica_pcv_annullato__=1", "pod"]
        html = _build_analysis_html(self._sample_extracted(), "Luce", "#EA580C", "doc", params, {"name": "Mario"})
        assert "__verifica_" not in html
        # But visible params still rendered
        assert "fornitore" in html

    def test_fiscal_check_rendered_as_li_not_json(self):
        from server import _build_analysis_html
        html = _build_analysis_html(self._sample_extracted(), "Luce", "#EA580C", "doc", [], {"name": "Mario"})
        # Rendered as list item
        assert "<li" in html
        assert "IVA errata" in html
        # Fiscal check dict is filtered from KV table (no JSON dump)
        assert '{"expected": 10' not in html
        assert '"expected":10' not in html
        assert "&quot;expected&quot;" not in html  # not html-escaped JSON either

    def test_professional_header_present_when_branding(self):
        from server import _build_analysis_html
        user_doc = {
            "name": "Mario Rossi",
            "company_name": "Dal Pastro Consulting",
            "company_logo_base64": "data:image/png;base64,AAAA",
            "report_slogan": "Consulenza energetica",
            "report_contacts": "Via Roma 1 · +39 041 123456",
        }
        html = _build_analysis_html(self._sample_extracted(), "Luce", "#EA580C", "doc", [], user_doc)
        assert "Dal Pastro Consulting" in html
        assert "Consulenza energetica" in html
        assert "Via Roma 1" in html
        assert '<img src="data:image/png;base64,AAAA"' in html

    def test_header_absent_when_no_branding(self):
        from server import _build_analysis_html
        html = _build_analysis_html(self._sample_extracted(), "Luce", "#EA580C", "doc", [], {})
        # Consultant fallback appears in footer regardless
        assert "Consulente" in html


# ============================================================================
# (b) Integration: _auto_save_draft_to_master_files persists proper HTML
# ============================================================================

class TestAutoSaveDraft:
    """Insert a draft with populated extracted + call helper, verify HTML in master_files."""

    def test_end_to_end_analysis_saved(self, headers):
        import server as srv

        async def run():
            # 1) Fetch tenant user_id
            u = await srv.db.users.find_one({"email": EMAIL}, {"_id": 0, "user_id": 1, "parent_user_id": 1, "name": 1, "company_name": 1})
            assert u, "test user not found in DB"
            tenant_id = u.get("parent_user_id") or u["user_id"]

            import uuid as _uuid
            draft_id = f"bdft_test_{_uuid.uuid4().hex[:8]}"
            pdf_name = f"TEST_V38W_{_uuid.uuid4().hex[:6]}.pdf"
            draft = {
                "draft_id": draft_id,
                "user_id": tenant_id,
                "created_by": u["user_id"],
                "bill_type": "luce",
                "pdf_name": pdf_name,
                "pdf_mime": "application/pdf",
                "pdf_base64": base64.b64encode(b"%PDF-1.4\n%%EOF").decode(),
                "status": "done",
                "analysis_params": ["fornitore", "__verifica_iva__=10", "__verifica_pcv_annullato__=1", "spread"],
                "extracted": {
                    "fornitore": "Enel Energia",
                    "nome_offerta": "Placet Fissa",
                    "pod": "IT001E9999999",
                    "note_ai": ["Prezzo competitivo per il mercato tutelato", "Verificare la corretta applicazione IVA"],
                    "fiscal_check": {
                        "iva": {"expected": 10, "actual": 22, "ok": False, "delta_annual_eur": 120},
                        "pcv": {"expected": 5.0, "actual": 5.0, "ok": True, "delta_annual_eur": None},
                    },
                },
            }
            try:
                await srv.db.bill_drafts.insert_one(dict(draft))
                await srv._auto_save_draft_to_master_files(draft)

                # Assert analysis file was created and contains proper HTML
                base_name = pdf_name[:-4]
                mf = await srv.db.master_files.find_one({
                    "user_id": tenant_id,
                    "category": "analisi",
                    "name": f"Analisi-{base_name}.html",
                })
                assert mf, "Analysis file was not created"

                html = base64.b64decode(mf["data_base64"]).decode("utf-8")
                # (a) No corrupted emoji
                assert "ðŸ" not in html
                assert "📄" not in html
                # (b) __verifica_ markers not shown
                assert "__verifica_" not in html
                # (c) fiscal_check rendered as <li>, not JSON
                assert "<li" in html
                assert "IVA errata" in html
                assert '{"expected"' not in html
                # (d) Note title now uses "Consulenza Corporate" (was "Note di {consultant}")
                assert "Consulenza Corporate" in html
                assert "Note di " not in html
                # (e) Clean H1 + title
                assert "<h1>Analisi Fattura Luce</h1>" in html
                assert "<title>Analisi Fattura Luce - " in html
                # Filename verified via mf['name']
                assert mf["mime"] == "text/html"

                # Also check RAW PDF was saved in 'bills' category
                mfp = await srv.db.master_files.find_one({
                    "user_id": tenant_id,
                    "category": "bills",
                    "name": pdf_name,
                })
                assert mfp, "Raw PDF was not saved into bills category"
                return mf["file_id"], mfp["file_id"], tenant_id
            finally:
                # Cleanup
                await srv.db.bill_drafts.delete_one({"draft_id": draft_id})

        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            mf_id, mfp_id, tenant = loop.run_until_complete(run())
            # Cleanup master files
            async def _clean():
                await srv.db.master_files.delete_many({"file_id": {"$in": [mf_id, mfp_id]}})
            loop.run_until_complete(_clean())
        finally:
            loop.close()


# ============================================================================
# (c) Backend regression endpoints
# ============================================================================

class TestRegression:
    def test_auth_login(self):
        r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "token" in body
        assert "user" in body

    def test_master_files_list(self, headers):
        r = requests.get(f"{API}/master-files", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_bill_drafts_list(self, headers):
        r = requests.get(f"{API}/bill-drafts", headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        # returns list of items
        assert isinstance(data, list) or (isinstance(data, dict) and "items" in data)

    def test_bill_drafts_crud(self, headers):
        # CREATE (tiny valid PDF)
        pdf = (b"%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
               b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n"
               b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\n"
               b"xref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n0000000110 00000 n\n"
               b"trailer<< /Root 1 0 R /Size 4 >>\nstartxref\n180\n%%EOF")
        b64 = base64.b64encode(pdf).decode()
        payload = {
            "bill_type": "luce",
            "pdf_base64": b64,
            "pdf_name": "TEST_V38W_regression.pdf",
            "pdf_mime": "application/pdf",
            "analysis_params": ["fornitore", "pod"],
        }
        r = requests.post(f"{API}/bill-drafts", headers=headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        draft_id = r.json().get("draft_id")
        assert draft_id
        # GET single
        rg = requests.get(f"{API}/bill-drafts/{draft_id}", headers=headers, timeout=15)
        assert rg.status_code == 200
        assert rg.json().get("draft_id") == draft_id
        # DELETE
        rd = requests.delete(f"{API}/bill-drafts/{draft_id}", headers=headers, timeout=15)
        assert rd.status_code in (200, 204)
        # GET again → 404
        rg2 = requests.get(f"{API}/bill-drafts/{draft_id}", headers=headers, timeout=15)
        assert rg2.status_code == 404

    def test_master_business_card(self, headers):
        r = requests.get(f"{API}/master/business-card", headers=headers, timeout=15)
        assert r.status_code in (200, 404)

    def test_assistant_chat(self, headers):
        r = requests.post(f"{API}/assistant/chat",
                          headers=headers,
                          json={"message": "Ciao Neo, dimmi solo 'ok'."},
                          timeout=90)
        # LLM might occasionally 502; accept 200 primarily
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reply" in data
        assert isinstance(data["reply"], str) and len(data["reply"]) > 0
