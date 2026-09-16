"""V50.z267/z268 — Identity documents + Form templates + Filled forms

Covers:
 - /api/identity-documents (OCR, CRUD, expiry checks, popup, snooze, tenant isolation)
 - /api/user-settings tour_voice_muted persistence
 - /api/form-templates + /api/contacts/{cid}/forms + /api/filled-forms (master permissions, PDF gen)
"""
import base64
import io
import os
import time
import re
from datetime import datetime, timedelta, timezone

import pytest
import pymupdf
import requests
from PIL import Image, ImageDraw

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
OWNER = ("test@dalpastro.it", "Test1234!")
SUB   = ("sub1@dalpastro.it", "Sub12345!")

TIMEOUT_LLM = 180


# ------------ fixtures ------------
def _login(email, pw):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {email} failed {r.status_code}: {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def owner_headers():
    return {"Authorization": f"Bearer {_login(*OWNER)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sub_headers():
    try:
        return {"Authorization": f"Bearer {_login(*SUB)}", "Content-Type": "application/json"}
    except AssertionError:
        pytest.skip("sub user not available")


@pytest.fixture(scope="module")
def owner_contact_id(owner_headers):
    # Try existing else create.
    r = requests.get(f"{BASE}/api/contacts?limit=1", headers=owner_headers, timeout=30)
    if r.status_code == 200:
        items = r.json().get("items") or r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if isinstance(items, list) and items:
            cid = items[0].get("contact_id") or items[0].get("id")
            if cid:
                return cid
    # Create one
    r = requests.post(f"{BASE}/api/contacts", headers=owner_headers, json={
        "first_name": "TESTIDDOCS", "last_name": "QA", "phone": "+390000000001",
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json().get("contact_id") or r.json().get("id")


def _png_id_card_b64():
    img = Image.new("RGB", (720, 460), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 720, 60], fill=(30, 60, 120))
    d.text((20, 22), "CARTA D'IDENTITA'", fill="white")
    lines = ["COGNOME: ROSSI", "NOME: MARIO", "SESSO: M",
             "NATO IL: 10.05.1980  A: ROMA",
             "CODICE FISCALE: RSSMRA80E10H501U",
             "NUMERO DOC: CA1234567",
             "SCADENZA: 20.05.2032"]
    for i, t in enumerate(lines):
        d.text((30, 100 + i*40), t, fill="black")
    buf = io.BytesIO(); img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


# ============ IDENTITY DOCUMENTS ============
class TestIdentityDocsOCR:
    def test_ocr_endpoint(self, owner_headers):
        r = requests.post(f"{BASE}/api/identity-documents/ocr",
                          headers=owner_headers,
                          json={"front_base64": _png_id_card_b64(), "doc_type": "id_card"},
                          timeout=TIMEOUT_LLM)
        if r.status_code == 429 or "spend limit" in r.text.lower() or "budget" in r.text.lower():
            pytest.skip(f"LLM budget/spend limit: {r.text[:200]}")
        assert r.status_code == 200, f"OCR failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        assert "document" in data
        # Best-effort: some field returned
        doc = data["document"]
        assert isinstance(doc, dict)


class TestIdentityDocsCRUD:
    doc_id_user = None
    doc_id_contact = None

    def test_create_user_doc(self, owner_headers):
        exp = (datetime.now(timezone.utc).date() + timedelta(days=20)).isoformat()
        r = requests.post(f"{BASE}/api/identity-documents", headers=owner_headers,
                          json={"subject_type": "user", "doc_type": "id_card",
                                "front_base64": _png_id_card_b64(),
                                "expiry_date": exp,
                                "document_number": "CA1234567",
                                "holder_name": "Mario Rossi"},
                          timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("doc_id")
        assert d.get("has_front") is True
        assert d.get("days_left") is not None and 15 <= d["days_left"] <= 25
        TestIdentityDocsCRUD.doc_id_user = d["doc_id"]

    def test_list_user_docs(self, owner_headers):
        r = requests.get(f"{BASE}/api/identity-documents?subject_type=user", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        ids = [i["doc_id"] for i in r.json().get("items", [])]
        assert TestIdentityDocsCRUD.doc_id_user in ids

    def test_get_image(self, owner_headers):
        r = requests.get(f"{BASE}/api/identity-documents/{TestIdentityDocsCRUD.doc_id_user}/image/front",
                         headers=owner_headers, timeout=30)
        assert r.status_code == 200
        assert r.json().get("data_url", "").startswith("data:image/")

    def test_run_expiry_check(self, owner_headers):
        r = requests.post(f"{BASE}/api/identity-documents/run-expiry-check", headers=owner_headers, timeout=60)
        assert r.status_code == 200
        j = r.json()
        assert "email_90" in j and "popup_30" in j

    def test_expiring_popup_includes(self, owner_headers):
        r = requests.get(f"{BASE}/api/identity-documents/expiring-popup", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        ids = [i["doc_id"] for i in r.json().get("items", [])]
        assert TestIdentityDocsCRUD.doc_id_user in ids

    def test_snooze_removes_from_popup(self, owner_headers):
        r = requests.post(f"{BASE}/api/identity-documents/{TestIdentityDocsCRUD.doc_id_user}/popup-snooze",
                          headers=owner_headers, timeout=30)
        assert r.status_code == 200
        r2 = requests.get(f"{BASE}/api/identity-documents/expiring-popup", headers=owner_headers, timeout=30)
        ids = [i["doc_id"] for i in r2.json().get("items", [])]
        assert TestIdentityDocsCRUD.doc_id_user not in ids

    def test_update_expiry(self, owner_headers):
        new_exp = (datetime.now(timezone.utc).date() + timedelta(days=200)).isoformat()
        r = requests.put(f"{BASE}/api/identity-documents/{TestIdentityDocsCRUD.doc_id_user}",
                         headers=owner_headers, json={"expiry_date": new_exp}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("expiry_date") == new_exp
        assert r.json().get("days_left", 0) > 150

    def test_create_contact_doc(self, owner_headers, owner_contact_id):
        exp = (datetime.now(timezone.utc).date() + timedelta(days=25)).isoformat()
        r = requests.post(f"{BASE}/api/identity-documents", headers=owner_headers,
                          json={"subject_type": "contact", "subject_id": owner_contact_id,
                                "doc_type": "driving_license",
                                "front_base64": _png_id_card_b64(),
                                "expiry_date": exp},
                          timeout=60)
        assert r.status_code == 200, r.text
        TestIdentityDocsCRUD.doc_id_contact = r.json()["doc_id"]

    def test_foreign_contact_404(self, owner_headers):
        r = requests.post(f"{BASE}/api/identity-documents", headers=owner_headers,
                          json={"subject_type": "contact", "subject_id": "does_not_exist_xyz",
                                "doc_type": "id_card",
                                "front_base64": _png_id_card_b64(),
                                "expiry_date": "2030-01-01"},
                          timeout=30)
        assert r.status_code == 404

    def test_delete_user_doc(self, owner_headers):
        r = requests.delete(f"{BASE}/api/identity-documents/{TestIdentityDocsCRUD.doc_id_user}",
                            headers=owner_headers, timeout=30)
        assert r.status_code == 200
        if TestIdentityDocsCRUD.doc_id_contact:
            requests.delete(f"{BASE}/api/identity-documents/{TestIdentityDocsCRUD.doc_id_contact}",
                            headers=owner_headers, timeout=30)


# ============ USER SETTINGS tour_voice_muted ============
class TestUserSettings:
    def test_get_has_key(self, owner_headers):
        r = requests.get(f"{BASE}/api/user-settings", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        assert "tour_voice_muted" in r.json()

    def test_put_persists(self, owner_headers):
        r = requests.put(f"{BASE}/api/user-settings", headers=owner_headers,
                        json={"tour_voice_muted": True}, timeout=30)
        assert r.status_code == 200
        r2 = requests.get(f"{BASE}/api/user-settings", headers=owner_headers, timeout=30)
        assert r2.json().get("tour_voice_muted") is True
        # Reset
        requests.put(f"{BASE}/api/user-settings", headers=owner_headers,
                    json={"tour_voice_muted": False}, timeout=30)


# ============ FORM TEMPLATES ============
def _make_simple_pdf_b64():
    doc = pymupdf.open()
    p = doc.new_page(width=595, height=842)
    labels = ["Cognome:", "Nome:", "Codice Fiscale:", "POD:", "IBAN:", "Data:", "Firma:"]
    y = 80
    for lb in labels:
        p.insert_text((60, y), lb, fontsize=12, fontname="helv")
        y += 60
    raw = doc.tobytes(); doc.close()
    return base64.b64encode(raw).decode()


class TestFormTemplates:
    template_id = None
    form_id = None

    def test_master_creates_template(self, owner_headers):
        pdf_b64 = _make_simple_pdf_b64()
        r = requests.post(f"{BASE}/api/form-templates", headers=owner_headers,
                          json={"name": "TEST QA Contratto", "pdf_base64": pdf_b64}, timeout=TIMEOUT_LLM)
        if r.status_code in (429, 422) and ("spend limit" in r.text.lower() or "budget" in r.text.lower()):
            pytest.skip(f"LLM budget: {r.text[:200]}")
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        d = r.json()
        assert d.get("template_id")
        assert d.get("field_source") in ("ai", "acroform")
        # Fields present
        r2 = requests.get(f"{BASE}/api/form-templates/{d['template_id']}", headers=owner_headers, timeout=30)
        assert r2.status_code == 200
        fields = r2.json().get("fields") or []
        assert isinstance(fields, list) and len(fields) >= 1
        TestFormTemplates.template_id = d["template_id"]

    def test_list_templates(self, owner_headers):
        r = requests.get(f"{BASE}/api/form-templates", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        assert r.json().get("is_master") is True
        ids = [i["template_id"] for i in r.json().get("items", [])]
        assert TestFormTemplates.template_id in ids

    def test_template_page_render(self, owner_headers):
        r = requests.get(f"{BASE}/api/form-templates/{TestFormTemplates.template_id}/page/0",
                        headers=owner_headers, timeout=60)
        assert r.status_code == 200
        assert r.json().get("data_url", "").startswith("data:image/png;base64,")

    def test_update_template_fields(self, owner_headers):
        r = requests.get(f"{BASE}/api/form-templates/{TestFormTemplates.template_id}", headers=owner_headers, timeout=30)
        fields = r.json().get("fields") or []
        # Modify first field's bbox and key
        if fields:
            fields[0]["key"] = "last_name"
            fields[0]["bbox"] = [200, 100, 500, 130]
        r2 = requests.put(f"{BASE}/api/form-templates/{TestFormTemplates.template_id}",
                          headers=owner_headers, json={"fields": fields}, timeout=30)
        assert r2.status_code == 200

    def test_non_master_can_get_but_not_write(self, sub_headers):
        # GET → 200
        r = requests.get(f"{BASE}/api/form-templates", headers=sub_headers, timeout=30)
        assert r.status_code == 200
        assert r.json().get("is_master") is False
        # POST → 403
        r2 = requests.post(f"{BASE}/api/form-templates", headers=sub_headers,
                          json={"name": "sub", "pdf_base64": _make_simple_pdf_b64()}, timeout=30)
        assert r2.status_code == 403, f"expected 403, got {r2.status_code}"
        # PUT → 403
        r3 = requests.put(f"{BASE}/api/form-templates/{TestFormTemplates.template_id}",
                          headers=sub_headers, json={"name": "x"}, timeout=30)
        assert r3.status_code == 403
        # DELETE → 403
        r4 = requests.delete(f"{BASE}/api/form-templates/{TestFormTemplates.template_id}",
                            headers=sub_headers, timeout=30)
        assert r4.status_code == 403

    def test_fill_form_for_contact(self, owner_headers, owner_contact_id):
        r = requests.post(f"{BASE}/api/contacts/{owner_contact_id}/forms",
                          headers=owner_headers,
                          json={"template_id": TestFormTemplates.template_id},
                          timeout=TIMEOUT_LLM)
        if r.status_code in (429, 422) and ("spend" in r.text.lower() or "budget" in r.text.lower()):
            pytest.skip(f"LLM budget: {r.text[:200]}")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("form_id")
        assert "values" in d and "missing" in d
        TestFormTemplates.form_id = d["form_id"]

    def test_update_filled_form(self, owner_headers):
        # Set explicit value for the first field
        fr = requests.get(f"{BASE}/api/filled-forms/{TestFormTemplates.form_id}", headers=owner_headers, timeout=30)
        assert fr.status_code == 200
        fields = fr.json().get("fields") or []
        if not fields:
            pytest.skip("No fields present in template")
        vals = dict(fr.json().get("values") or {})
        vals[fields[0]["id"]] = "TESTVALORE_QA_UNICO_123"
        extras = [{"page": 0, "x": 500, "y": 700, "text": "Nota QA", "font_size": 9}]
        r = requests.put(f"{BASE}/api/filled-forms/{TestFormTemplates.form_id}",
                        headers=owner_headers, json={"values": vals, "extra_texts": extras}, timeout=30)
        assert r.status_code == 200

    def test_filled_pdf_contains_value(self, owner_headers):
        r = requests.get(f"{BASE}/api/filled-forms/{TestFormTemplates.form_id}/pdf",
                        headers=owner_headers, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d.get("mime") == "application/pdf"
        raw = base64.b64decode(d["data_base64"])
        with pymupdf.open(stream=raw, filetype="pdf") as pdf:
            all_text = ""
            for pg in pdf:
                all_text += pg.get_text()
        assert "TESTVALORE_QA_UNICO_123" in all_text or "Nota QA" in all_text, \
            f"PDF missing expected text; got sample: {all_text[:400]}"

    def test_filled_page_image(self, owner_headers):
        r = requests.get(f"{BASE}/api/filled-forms/{TestFormTemplates.form_id}/page/0",
                        headers=owner_headers, timeout=60)
        assert r.status_code == 200
        assert r.json().get("data_url", "").startswith("data:image/png;base64,")

    def test_list_forms_by_contact(self, owner_headers, owner_contact_id):
        r = requests.get(f"{BASE}/api/contacts/{owner_contact_id}/forms", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        ids = [i["form_id"] for i in r.json().get("items", [])]
        assert TestFormTemplates.form_id in ids

    def test_zzz_cleanup(self, owner_headers):
        if TestFormTemplates.form_id:
            r = requests.delete(f"{BASE}/api/filled-forms/{TestFormTemplates.form_id}",
                                headers=owner_headers, timeout=30)
            assert r.status_code in (200, 404)
        if TestFormTemplates.template_id:
            r = requests.delete(f"{BASE}/api/form-templates/{TestFormTemplates.template_id}",
                                headers=owner_headers, timeout=30)
            assert r.status_code in (200, 404)
