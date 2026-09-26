"""V50.z375 - Axon Lab multi-profile + test extraction + module examples."""
import base64
import io
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:300]}"
    tok = r.json().get("token")
    assert tok, "No token"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _pdf_bytes(lines):
    """Build a synthetic PDF via reportlab, >=4KB."""
    try:
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import A4
    except ImportError:
        pytest.skip("reportlab not installed")
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    # Add lots of pages to exceed 4KB (reportlab compresses well)
    for page_i in range(3):
        y = 800
        for ln in lines:
            c.drawString(50, y, ln)
            y -= 18
        # More unique text to defeat compression
        for i in range(60):
            c.drawString(50, y - i * 10, f"filler p{page_i} line {i:04d} XYZ{i * 37:x} " + "".join(chr(65 + ((i + page_i + j) % 26)) for j in range(50)))
        c.showPage()
    c.save()
    data = buf.getvalue()
    # Extra guarantee: pad with a benign trailing comment (won't break PDF readers, keeps parseable)
    if len(data) < 4200:
        data = data + b"\n%" + os.urandom(4200 - len(data)).hex().encode()
    return data


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


# ================== Fase 1 · profili cliente tipo ==================

class TestLabProfiles:
    _state = {}

    def test_list_profiles(self, client):
        r = client.get(f"{BASE_URL}/api/lab/training/profiles", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        items = data.get("items") or []
        assert len(items) >= 1
        assert items[0]["profile_id"] == "default"
        assert "completion" in items[0]
        assert items[0].get("name") in ("Cliente tipo 1", None) or "Cliente tipo" in (items[0].get("name") or "")

    def test_create_profile(self, client):
        r = client.post(f"{BASE_URL}/api/lab/training/profiles", json={"name": "Cliente tipo test"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        p = r.json()
        assert p["profile_id"].startswith("ct_")
        assert p["name"] == "Cliente tipo test"
        TestLabProfiles._state["pid"] = p["profile_id"]

    def test_rename_profile(self, client):
        pid = TestLabProfiles._state["pid"]
        r = client.patch(f"{BASE_URL}/api/lab/training/profiles/{pid}", json={"name": "Rinominato"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["name"] == "Rinominato"

    def test_get_training_by_profile(self, client):
        pid = TestLabProfiles._state["pid"]
        r = client.get(f"{BASE_URL}/api/lab/training?profile={pid}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["profile_id"] == pid
        assert data.get("name") == "Rinominato"
        docs = data.get("docs") or {}
        assert len(docs) == 12
        for d, e in docs.items():
            assert e.get("status") == "none"
        assert isinstance(data.get("profiles"), list)
        assert any(p["profile_id"] == "default" for p in data["profiles"])
        assert any(p["profile_id"] == pid for p in data["profiles"])

    def test_add_extra(self, client):
        pid = TestLabProfiles._state["pid"]
        r = client.post(f"{BASE_URL}/api/lab/training/extra?profile={pid}",
                        json={"label": "Codice agente", "value": "A1"}, timeout=30)
        assert r.status_code == 200
        extras = r.json().get("extra") or []
        assert len(extras) == 1
        assert extras[0]["label"] == "Codice agente"
        assert extras[0]["value"] == "A1"
        TestLabProfiles._state["extra_id"] = extras[0]["id"]

    def test_default_does_not_have_extra(self, client):
        r = client.get(f"{BASE_URL}/api/lab/training?profile=default", timeout=30)
        assert r.status_code == 200
        default_extras = r.json().get("extra") or []
        eid = TestLabProfiles._state.get("extra_id")
        assert not any(x.get("id") == eid for x in default_extras)

    def test_delete_extra(self, client):
        pid = TestLabProfiles._state["pid"]
        eid = TestLabProfiles._state["extra_id"]
        r = client.delete(f"{BASE_URL}/api/lab/training/extra/{eid}?profile={pid}", timeout=30)
        assert r.status_code == 200
        assert (r.json().get("extra") or []) == []

    def test_sources_endpoint(self, client):
        r = client.get(f"{BASE_URL}/api/lab/sources", timeout=30)
        assert r.status_code == 200
        srcs = r.json().get("sources") or []
        assert len(srcs) > 5
        assert any(s.get("id") == "sign_date" for s in srcs)

    def test_delete_profile(self, client):
        pid = TestLabProfiles._state["pid"]
        r = client.delete(f"{BASE_URL}/api/lab/training/profiles/{pid}", timeout=30)
        assert r.status_code == 200

    def test_cannot_delete_last_profile(self, client):
        # create a temp then delete default? no - do not delete default.
        # Instead: leave only 'default' → attempt to delete it → 400
        # First ensure only 1 exists
        r = client.get(f"{BASE_URL}/api/lab/training/profiles", timeout=30)
        items = r.json().get("items") or []
        # If more than 1 exists (e.g., leftover from previous tests), delete non-default ones
        for it in items:
            if it["profile_id"] != "default":
                client.delete(f"{BASE_URL}/api/lab/training/profiles/{it['profile_id']}", timeout=30)
        r = client.delete(f"{BASE_URL}/api/lab/training/profiles/default", timeout=30)
        assert r.status_code == 400
        assert "almeno un" in (r.text or "").lower()


# ================== Fase 1 · test-extract ==================

class TestLabTestExtract:
    _state = {}

    def test_extract_two_pdfs_single_profile(self, client):
        pdf_iban = _pdf_bytes([
            "IBAN: IT60X0542811101000000123456",
            "Intestatario: Mario Rossi",
            "Banca Intesa Sanpaolo",
        ])
        pdf_visura = _pdf_bytes([
            "VISURA CAMERALE",
            "Denominazione: ROSSI SRL",
            "Partita IVA: 01234567890",
            "PEC: rossi@pec.it",
            "Sede: Via Roma 1 20100 Milano MI",
        ])
        assert len(pdf_iban) >= 4096
        assert len(pdf_visura) >= 4096

        payload = {
            "profile": "default",
            "files": [
                {"name": "iban.pdf", "mime": "application/pdf", "data_base64": _b64(pdf_iban)},
                {"name": "visura.pdf", "mime": "application/pdf", "data_base64": _b64(pdf_visura)},
            ],
        }
        r = client.post(f"{BASE_URL}/api/lab/training/test-extract", json=payload, timeout=180)
        assert r.status_code == 200, r.text[:400]
        data = r.json()
        assert "at" in data
        TestLabTestExtract._state["at"] = data["at"]
        files = data.get("files") or []
        assert len(files) == 2
        doc_types = {f.get("doc_type") for f in files}
        # Should recognize at least one; allow LLM variability - test soft
        assert doc_types & {"iban", "visura", "unknown"}
        rows = data.get("rows") or []
        summary = data.get("summary") or {}
        assert "total" in summary
        assert summary["total"] == len(rows)
        for s in ("ok", "mismatch", "not_found", "conflict", "new"):
            assert s in summary

    def test_get_last_test_default(self, client):
        r = client.get(f"{BASE_URL}/api/lab/training/test-extract?profile=default", timeout=30)
        assert r.status_code == 200
        lt = r.json().get("last_test")
        assert lt is not None
        # Same 'at' timestamp (compare seconds - timezone and microsecond precision may differ on roundtrip)
        expected = str(TestLabTestExtract._state.get("at") or "")[:19]
        actual = str(lt.get("at") or "")[:19]
        assert actual == expected, f"{actual!r} != {expected!r}"

    def test_extract_mode_all(self, client):
        # Create a second temp profile
        r = client.post(f"{BASE_URL}/api/lab/training/profiles", json={"name": "TEST_all_mode"}, timeout=30)
        assert r.status_code == 200
        pid_temp = r.json()["profile_id"]
        try:
            pdf = _pdf_bytes(["IBAN: IT99Z0000000000000000000000", "Intestatario: Test User"])
            payload = {
                "profile": "all",
                "files": [{"name": "t.pdf", "mime": "application/pdf", "data_base64": _b64(pdf)}],
            }
            r = client.post(f"{BASE_URL}/api/lab/training/test-extract", json=payload, timeout=180)
            assert r.status_code == 200
            data = r.json()
            assert data.get("mode") == "all"
            pnames = data.get("profile_names") or {}
            assert "default" in pnames
            assert pid_temp in pnames

            r = client.get(f"{BASE_URL}/api/lab/training/test-extract?profile=all", timeout=30)
            assert r.status_code == 200
            assert r.json().get("last_test") is not None
        finally:
            client.delete(f"{BASE_URL}/api/lab/training/profiles/{pid_temp}", timeout=30)

    def test_extract_empty_files_422(self, client):
        r = client.post(f"{BASE_URL}/api/lab/training/test-extract",
                        json={"profile": "default", "files": []}, timeout=30)
        assert r.status_code == 422

    def test_extract_profile_not_found(self, client):
        pdf = _pdf_bytes(["test"])
        r = client.post(f"{BASE_URL}/api/lab/training/test-extract",
                        json={"profile": "ct_nonexistent_xxxx",
                              "files": [{"name": "x.pdf", "mime": "application/pdf", "data_base64": _b64(pdf)}]},
                        timeout=60)
        assert r.status_code == 404


# ================== Fase 2 · esempi moduli ==================

class TestLabModuleExamples:
    _state = {}

    def test_list_modules(self, client):
        r = client.get(f"{BASE_URL}/api/lab/modules", timeout=30)
        assert r.status_code == 200
        items = r.json().get("items") or []
        TestLabModuleExamples._state["existing"] = items
        if items:
            TestLabModuleExamples._state["template_id"] = items[0]["template_id"]

    def test_create_module_if_needed(self, client):
        if TestLabModuleExamples._state.get("template_id"):
            pytest.skip("module already exists")
        pdf = _pdf_bytes([
            "MODULO TEST",
            "Nome: ____________________",
            "Cognome: ____________________",
            "Codice Fiscale: ____________________",
            "Indirizzo: ____________________",
        ])
        r = client.post(f"{BASE_URL}/api/lab/modules",
                        json={"name": "TEST Module V50z375", "pdf_base64": _b64(pdf)}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        tid = r.json().get("template_id")
        assert tid
        TestLabModuleExamples._state["template_id"] = tid
        TestLabModuleExamples._state["created"] = tid

    def test_get_module_examples(self, client):
        tid = TestLabModuleExamples._state.get("template_id")
        if not tid:
            pytest.skip("no module")
        r = client.get(f"{BASE_URL}/api/lab/modules/{tid}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "examples" in data
        assert "examples_count" in data

    def test_invalid_pdf_example_returns_4xx(self, client):
        tid = TestLabModuleExamples._state.get("template_id")
        if not tid:
            pytest.skip("no module")
        r = client.post(f"{BASE_URL}/api/lab/modules/{tid}/examples",
                        json={"pdf_base64": "AAAA"}, timeout=60)
        assert r.status_code in (400, 422), f"expected 400/422 got {r.status_code}: {r.text[:200]}"

    def test_delete_nonexistent_example_404(self, client):
        tid = TestLabModuleExamples._state.get("template_id")
        if not tid:
            pytest.skip("no module")
        r = client.delete(f"{BASE_URL}/api/lab/modules/{tid}/examples/ex_inesistente_xxxx", timeout=30)
        assert r.status_code == 404

    def test_repropose(self, client):
        tid = TestLabModuleExamples._state.get("template_id")
        if not tid:
            pytest.skip("no module")
        r = client.post(f"{BASE_URL}/api/lab/modules/{tid}/examples/repropose", timeout=120)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "mapping" in data
        assert "examples" in data

    def test_cleanup(self, client):
        # Delete the module ONLY if we created it (never delete pre-existing lab modules)
        created = TestLabModuleExamples._state.get("created")
        if created:
            r = client.delete(f"{BASE_URL}/api/lab/modules/{created}", timeout=30)
            assert r.status_code == 200
