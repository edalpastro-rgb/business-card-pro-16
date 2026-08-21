"""V38Z — robust LLM JSON parsing tests.

Covers:
  A) Unit tests of `_parse_llm_json` helper for various malformed inputs
     (empty, None, broken, code-fenced, trailing commas, embedded, valid).
     - Verifies NEVER raises + returns proper structure.
     - Verifies user-facing error message is Italian and does NOT contain
       'JSON' / 'Expecting value' / raw stacktraces.
  B) Integration: `_build_analysis_html` produces the parse_error banner
     when `extracted.parse_error` is truthy AND does NOT expose internal
     diagnostics (parse_error_kind / raw JSON) in KV rows.
  C) Regression: login + master-files load OK.
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

# The user-facing message must match verbatim per PRD.
EXPECTED_MSG = (
    "L'analisi AI ha restituito una risposta non valida. "
    "Riprova più tardi o contatta il supporto se il problema persiste."
)


# ---------------- Unit tests: _parse_llm_json ----------------

def _import_helper():
    """Import helper without booting FastAPI/DB (server.py has module-level init)."""
    from server import _parse_llm_json  # noqa: WPS433 – needed at test time
    return _parse_llm_json


class TestParseLlmJsonUnit:
    """Direct unit tests of the helper."""

    def test_empty_string_returns_parse_error(self):
        p = _import_helper()
        r = p("")
        assert r["parse_error"] is True
        assert r["error_message"] == EXPECTED_MSG
        assert r["parse_error_kind"] == "empty"

    def test_none_returns_parse_error(self):
        p = _import_helper()
        r = p(None)  # type: ignore[arg-type]
        assert r["parse_error"] is True
        assert r["parse_error_kind"] == "empty"
        assert r["error_message"] == EXPECTED_MSG

    def test_broken_json_returns_parse_error(self):
        p = _import_helper()
        r = p("{invalid nonsense not even close}")
        assert r["parse_error"] is True
        assert r["error_message"] == EXPECTED_MSG
        # Diagnostic kind is present but should NOT be visible in user text
        assert r["parse_error_kind"] in ("unparseable", "empty")

    def test_totally_garbage_returns_parse_error(self):
        p = _import_helper()
        r = p("!!!totally not JSON!!!")
        assert r["parse_error"] is True
        assert r["error_message"] == EXPECTED_MSG

    def test_code_fenced_json_parses_ok(self):
        p = _import_helper()
        r = p('```json\n{"fornitore": "Enel", "note_ai": ["ok"]}\n```')
        assert r.get("parse_error") is not True
        assert r["fornitore"] == "Enel"
        assert r["note_ai"] == ["ok"]

    def test_code_fenced_without_lang(self):
        p = _import_helper()
        r = p('```\n{"a": 1}\n```')
        assert r.get("parse_error") is not True
        assert r["a"] == 1

    def test_trailing_commas_are_repaired(self):
        p = _import_helper()
        r = p('{"a": 1, "b": 2,}')
        assert r.get("parse_error") is not True
        assert r["a"] == 1 and r["b"] == 2

    def test_text_before_and_after_json_extracted(self):
        p = _import_helper()
        r = p('Ecco il JSON: {"fornitore": "Iren", "importo": 42.5} fine.')
        assert r.get("parse_error") is not True
        assert r["fornitore"] == "Iren"
        assert r["importo"] == 42.5

    def test_valid_json_untouched(self):
        p = _import_helper()
        payload = '{"fornitore": "A2A", "offerta": "Flex", "note_ai": ["x", "y"]}'
        r = p(payload)
        assert r.get("parse_error") is not True
        assert r["fornitore"] == "A2A"
        assert len(r["note_ai"]) == 2

    def test_no_exception_on_various_garbage(self):
        p = _import_helper()
        # Must never raise for any of these
        for bad in ["", "   ", "null", "[1,2,3]", "{", "}", "{{}}", "'x'",
                    "42", "true", "```json```", "```\n```"]:
            try:
                r = p(bad)
            except Exception as e:  # pragma: no cover
                pytest.fail(f"_parse_llm_json raised on {bad!r}: {e}")
            assert isinstance(r, dict)

    def test_error_message_has_no_technical_leak(self):
        p = _import_helper()
        r = p("{oops")
        msg = r["error_message"]
        # User-facing text must not leak technical hints
        for forbidden in ["JSON", "Expecting value", "Traceback",
                          "line 1 column", "python", "raise "]:
            assert forbidden.lower() not in msg.lower(), (
                f"Forbidden token {forbidden!r} in user message: {msg}")


# ---------------- Integration: HTML render ----------------

class TestAnalysisHtmlBanner:
    """`_build_analysis_html` must show a red banner + hide internal fields."""

    def test_parse_error_banner_rendered(self):
        from server import _build_analysis_html  # type: ignore
        extracted = {
            "parse_error": True,
            "error_message": EXPECTED_MSG,
            "parse_error_kind": "unparseable",
            "note_ai": "raw broken text preview...",
        }
        html = _build_analysis_html(
            extracted, "Luce", "#F59E0B", "bolletta.pdf", [], None
        )
        # Banner present
        assert "Analisi non riuscita" in html
        # Message rendered as HTML-escaped inside the banner
        html_escaped = EXPECTED_MSG.replace("'", "&#x27;")
        assert html_escaped in html or EXPECTED_MSG in html
        # Internal diagnostic keys must NOT leak into KV table
        assert "Parse Error Kind" not in html
        assert "unparseable" not in html
        assert "Error Message" not in html  # error_message is banner-only

    def test_no_banner_when_no_parse_error(self):
        from server import _build_analysis_html  # type: ignore
        extracted = {
            "fornitore": "Enel Energia",
            "offerta": "Sicura 24",
            "note_ai": ["Buon prezzo", "Bassi costi fissi"],
        }
        html = _build_analysis_html(
            extracted, "Luce", "#F59E0B", "b.pdf", [], None
        )
        assert "Analisi non riuscita" not in html
        assert "Enel Energia" in html


# ---------------- Regression: quick sanity ----------------

@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestRegression:
    def test_login_ok(self, token):
        assert token and len(token) > 20

    def test_master_files_loads(self, headers):
        r = requests.get(f"{API}/master-files", headers=headers, timeout=30)
        # Endpoint should not 5xx; may return empty list or forbidden depending on setup
        assert r.status_code in (200, 401, 403), r.text

    def test_contacts_list_ok(self, headers):
        r = requests.get(f"{API}/contacts", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Endpoint returns either a list or {items: [...]}
        items = data["items"] if isinstance(data, dict) else data
        assert isinstance(items, list)


# ---------------- E2E: Bill upload with garbage PDF (best-effort) ----------------

class TestGarbagePdfBill:
    """Upload random bytes as PDF; ensure backend never crashes and returns
    either error status or parse_error=true in extracted."""

    def test_random_bytes_bill_no_crash(self, headers):
        # Create a temp contact
        payload = {
            "first_name": "TEST_V38Z",
            "last_name": "GarbagePDF",
            "phone": "0000000000",
        }
        rc = requests.post(f"{API}/contacts", headers=headers, json=payload, timeout=30)
        if rc.status_code not in (200, 201):
            pytest.skip(f"contact create failed: {rc.status_code} {rc.text}")
        cid = rc.json().get("id") or rc.json().get("contact_id")
        if not cid:
            pytest.skip("no contact id in response")
        try:
            # Random bytes → invalid PDF
            fake = os.urandom(2048)
            b64 = base64.b64encode(fake).decode()
            bill_body = {
                "bill_type": "luce",
                "pdf_base64": b64,
                "pdf_name": "TEST_random.pdf",
                "pdf_mime": "application/pdf",
                "analysis_params": ["fornitore"],
            }
            rb = requests.post(f"{API}/contacts/{cid}/bills",
                               headers=headers, json=bill_body, timeout=45)
            assert rb.status_code in (200, 201), rb.text
            bill_id = rb.json().get("bill_id") or rb.json().get("id")
            assert bill_id
            # Poll for completion up to ~40s (analysis is background)
            import time
            final = None
            for _ in range(20):
                time.sleep(2)
                rl = requests.get(f"{API}/contacts/{cid}/bills",
                                  headers=headers, timeout=30)
                assert rl.status_code == 200
                items = rl.json().get("items", [])
                match = [x for x in items if (x.get("bill_id") or x.get("id")) == bill_id]
                if match and match[0].get("status") in ("done", "error", "cancelled"):
                    final = match[0]
                    break
            assert final is not None, "bill never completed"
            # Either 'error' status (PDF extraction failed) or 'done' with parse_error
            # Both scenarios acceptable — backend must NOT crash (200 above).
            if final["status"] == "done":
                ex = final.get("extracted") or {}
                # If AI got something meaningful, that's fine; if it returned
                # parse_error, the error_message must be user-friendly.
                if ex.get("parse_error"):
                    assert ex.get("error_message") == EXPECTED_MSG
                    # And no technical leaks in the message
                    for bad in ["Expecting value", "Traceback", "JSONDecodeError"]:
                        assert bad not in ex["error_message"]
        finally:
            requests.delete(f"{API}/contacts/{cid}", headers=headers, timeout=30)
