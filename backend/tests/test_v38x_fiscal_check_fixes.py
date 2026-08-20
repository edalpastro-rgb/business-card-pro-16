"""V38X — 3 bug fixes tests.

Covers:
  (1) fiscal_check rendered readably (never JSON) in _build_analysis_html
      - dedicated fiscal_html block with 'errata — attesa' text
      - no leftover 'ok":' / '{\"expected' / JSON.stringify-like output in KV table
  (2) misc dict with fiscal shape at top-level → renders '<val> OK', not JSON
  (3) misc dict without fiscal shape → flattens 'Key1: v1 · Key2: v2', not JSON
  (4) Regression: /api/auth/login, /api/bill-drafts CRUD, /api/master-files,
      /api/master/business-card, /api/contacts.
"""

import os
import sys
import re
import base64
import requests
import pytest

sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


# ---------------- Fixtures ----------------

@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- Unit tests on helper _build_analysis_html ----------------

# Unit test module: fiscal_check readable rendering + no JSON leakage in KV table
class TestBuildAnalysisHtmlFiscal:
    def _import(self):
        import importlib
        import server as srv  # type: ignore
        importlib.reload_if_needed = None  # noop; keep reference
        return srv

    def test_fiscal_check_full_shape_renders_readable_and_kv_skipped(self):
        srv = self._import()
        extracted = {
            "fornitore": "Enel Energia",
            "nome_offerta": "E-Light",
            "fiscal_check": {
                "iva": {"expected": 10, "actual": 22, "ok": False, "delta_annual_eur": 120},
                "accise_gas": {"expected": 0.012498, "actual": 0.02, "ok": False, "delta_annual_eur": 80},
                "pcv": {"expected": 0, "actual": 5, "ok": False, "delta_annual_eur": 60},
            },
        }
        html = srv._build_analysis_html(extracted, "Luce", "#F59E0B", "bolletta.pdf", ["consumi"], user_doc={"name": "Mario Rossi"})

        # Fiscal readable block present
        assert "errata — attesa" in html, "Fiscal block missing 'errata — attesa' rendering"
        assert "IVA errata — attesa" in html, "IVA readable row missing"
        assert "Accise gas errata" in html
        assert "PCV / Costi fissi errata" in html
        # Delta rendered
        assert "Extra 12 mesi: € 120" in html
        assert "Extra 12 mesi: € 80" in html

        # No JSON residue anywhere (fiscal_check should NOT appear in KV table)
        # Detect: raw JSON braces around expected/actual keys.
        assert '{"expected' not in html
        assert "'expected'" not in html
        # `ok":` would only appear if json.dumps ran
        assert 'ok":' not in html
        assert '"ok":' not in html
        # No JSON.stringify-like output for fiscal_check keys
        # Make sure no <td>...raw json...</td> exists with braces
        assert not re.search(r"<td[^>]*>\s*\{", html), "KV table cell contains raw '{' brace = JSON leakage"

    def test_misc_object_fiscal_shape_ok_true(self):
        srv = self._import()
        extracted = {"misc_object": {"ok": True, "expected": 100, "actual": 100}}
        html = srv._build_analysis_html(extracted, "Gas", "#3B82F6", "test.pdf", [])
        # Expect readable "<val> OK", not JSON
        assert " OK" in html
        assert "100 OK" in html or "100,00 OK" in html or "100 OK" in html
        assert '{"expected' not in html
        assert 'ok":' not in html

    def test_misc_object_generic_dict_flattened(self):
        srv = self._import()
        extracted = {"misc_object": {"key1": "val1", "key2": "val2"}}
        html = srv._build_analysis_html(extracted, "Luce", "#F59E0B", "test.pdf", [])
        # Expect 'Key1: val1 · Key2: val2', not JSON
        assert "Key1: val1" in html
        assert "Key2: val2" in html
        assert " · " in html
        assert '{"key1' not in html
        assert '"key1":' not in html

    def test_misc_object_list_of_primitives(self):
        srv = self._import()
        extracted = {"tags": ["alpha", "beta", "gamma"]}
        html = srv._build_analysis_html(extracted, "Luce", "#F59E0B", "test.pdf", [])
        assert "alpha, beta, gamma" in html
        assert '[' not in re.sub(r"<[^>]+>", "", html).split("alpha")[0][-30:]  # no raw array bracket before rendered value


# ---------------- Unit tests on _format_fiscal_check_html ----------------

# Unit test module: standalone fiscal check formatter
class TestFormatFiscalCheckHtml:
    def _import(self):
        import server as srv  # type: ignore
        return srv

    def test_ok_true_shows_ok_suffix(self):
        srv = self._import()
        h = srv._format_fiscal_check_html({"iva": {"expected": 10, "actual": 10, "ok": True}})
        assert "IVA 10% OK" in h
        assert "errata" not in h

    def test_ok_false_shows_error_and_delta(self):
        srv = self._import()
        h = srv._format_fiscal_check_html({
            "iva": {"expected": 10, "actual": 22, "ok": False, "delta_annual_eur": 120}
        })
        assert "IVA errata — attesa 10%, trovata 22%" in h
        assert "Extra 12 mesi: € 120" in h

    def test_empty_returns_empty_string(self):
        srv = self._import()
        assert srv._format_fiscal_check_html({}) == ""
        assert srv._format_fiscal_check_html(None) == ""


# ---------------- Regression on live endpoints ----------------

# Regression module: standard endpoints must still work after V38X
class TestRegression:
    def test_auth_login(self, token):
        assert token and len(token) > 10

    def test_bill_drafts_crud(self, headers):
        # Create a draft
        # Minimal valid PDF header (base64)
        pdf_b64 = base64.b64encode(b"%PDF-1.4\n%TEST_v38x\n").decode()
        payload = {
            "extracted": {"fornitore": "Enel", "nome_offerta": "E-Light"},
            "bill_type": "luce",
            "doc_name": "TEST_v38x_draft.pdf",
            "pdf_base64": pdf_b64,
            "pdf_name": "TEST_v38x_draft.pdf",
            "pdf_mime": "application/pdf",
        }
        r = requests.post(f"{API}/bill-drafts", json=payload, headers=headers, timeout=30)
        assert r.status_code in (200, 201), r.text
        draft = r.json()
        draft_id = draft.get("draft_id") or draft.get("id") or draft.get("_id")
        assert draft_id

        # List
        r = requests.get(f"{API}/bill-drafts", headers=headers, timeout=30)
        assert r.status_code == 200
        items = r.json().get("items", [])
        ids = [d.get("draft_id") or d.get("id") for d in items]
        assert draft_id in ids

        # Delete
        r = requests.delete(f"{API}/bill-drafts/{draft_id}", headers=headers, timeout=30)
        assert r.status_code in (200, 204), r.text

    def test_master_files_list(self, headers):
        r = requests.get(f"{API}/master-files", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_master_business_card(self, headers):
        r = requests.get(f"{API}/master/business-card", headers=headers, timeout=30)
        # 200 with card payload OR 404 if never configured — both acceptable regression signals
        assert r.status_code in (200, 404), r.text

    def test_contacts_list(self, headers):
        r = requests.get(f"{API}/contacts", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert isinstance(j, (list, dict))
