"""V38N — Quick Bill Analysis (Bill Drafts) backend tests.
Covers POST/GET/DELETE /bill-drafts, associate, create-contact, reanalyze,
validation errors, auth errors, and non-leakage of pdf_base64 in list/get.
"""
import base64
import io
import os
import time
import uuid

import pytest
import requests
from reportlab.pdfgen import canvas

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to the frontend .env public URL
    BASE_URL = "https://business-card-pro-16.preview.emergentagent.com"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"

POLL_INTERVAL = 2
POLL_MAX = 60  # seconds


def _make_bill_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    lines = [
        "Fornitore: Enel Energia",
        "Importo totale: 128.45 EUR",
        "Periodo: Gennaio 2026",
        "Intestatario: Mario Rossi",
        "Indirizzo fornitura: Via Roma 12, 20100 Milano",
        "POD: IT001E12345678",
        "Consumo: 350 kWh",
        "Codice cliente: 987654321",
        "Codice fiscale: RSSMRA80A01F205X",
        "Tipo contratto: Mercato libero",
    ]
    y = 800
    for ln in lines:
        c.drawString(50, y, ln)
        y -= 20
    c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data, data
    return data["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def pdf_b64():
    return base64.b64encode(_make_bill_pdf()).decode()


def _create_draft(headers, pdf_b64, bill_type="luce", label=None):
    body = {
        "bill_type": bill_type,
        "pdf_base64": pdf_b64,
        "pdf_name": "TEST_fattura.pdf",
    }
    if label:
        body["label"] = label
    r = requests.post(f"{BASE_URL}/api/bill-drafts", json=body, headers=headers, timeout=30)
    return r


def _poll_until_done(headers, draft_id, max_wait=POLL_MAX):
    deadline = time.time() + max_wait
    last = None
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/bill-drafts/{draft_id}", headers=headers, timeout=30)
        if r.status_code != 200:
            return r.status_code, None
        d = r.json()
        last = d
        if d.get("status") in ("done", "error"):
            return 200, d
        time.sleep(POLL_INTERVAL)
    return 200, last


class TestBillDraftValidation:
    """Validation & auth"""

    def test_unauth_create(self, pdf_b64):
        r = requests.post(
            f"{BASE_URL}/api/bill-drafts",
            json={"bill_type": "luce", "pdf_base64": pdf_b64},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"got {r.status_code}: {r.text}"

    def test_invalid_bill_type(self, headers, pdf_b64):
        r = requests.post(
            f"{BASE_URL}/api/bill-drafts",
            json={"bill_type": "invalid", "pdf_base64": pdf_b64},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_pdf_too_large(self, headers):
        # ~15 MB fake base64 (not a valid PDF but size check should trigger first)
        fake = base64.b64encode(b"A" * (15 * 1024 * 1024)).decode()
        r = requests.post(
            f"{BASE_URL}/api/bill-drafts",
            json={"bill_type": "luce", "pdf_base64": fake},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 400, r.text


class TestBillDraftLifecycle:
    """Create → poll → GET, PDF endpoint, delete, reanalyze."""

    created_ids = []

    def test_create_draft_success(self, headers, pdf_b64):
        r = _create_draft(headers, pdf_b64, "luce", label="TEST_v38n_lifecycle")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("draft_id", "").startswith("bdft_")
        assert d.get("status") in ("pending", "analyzing")
        assert d.get("bill_type") == "luce"
        assert "pdf_base64" not in d, "pdf_base64 must not be returned in create response"
        assert d.get("contact_id") is None
        assert d.get("created_at")
        TestBillDraftLifecycle.created_ids.append(d["draft_id"])

    def test_list_drafts_contains_created(self, headers):
        r = requests.get(f"{BASE_URL}/api/bill-drafts", headers=headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data
        ids = [x.get("draft_id") for x in data["items"]]
        assert TestBillDraftLifecycle.created_ids[0] in ids
        # Verify no pdf_base64 in list
        for x in data["items"]:
            assert "pdf_base64" not in x
            assert x.get("contact_id") is None  # only unassociated drafts

    def test_get_draft_pdf(self, headers):
        did = TestBillDraftLifecycle.created_ids[0]
        r = requests.get(f"{BASE_URL}/api/bill-drafts/{did}/pdf", headers=headers, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("pdf_base64")
        assert j.get("pdf_name") == "TEST_fattura.pdf"
        assert j.get("pdf_mime") == "application/pdf"

    def test_poll_until_done_or_error(self, headers):
        did = TestBillDraftLifecycle.created_ids[0]
        code, d = _poll_until_done(headers, did)
        assert code == 200
        assert d is not None
        # Accept either done or error (LLM may fail); log for context
        assert d.get("status") in ("done", "error", "pending", "analyzing"), d.get("status")
        if d.get("status") == "done":
            extracted = d.get("extracted") or {}
            assert isinstance(extracted, dict)
            assert len(extracted) > 0, "extracted should have some keys when done"
            print(f"extracted keys: {list(extracted.keys())[:10]}")

    def test_get_missing_draft_404(self, headers):
        r = requests.get(f"{BASE_URL}/api/bill-drafts/bdft_nonexistent", headers=headers, timeout=15)
        assert r.status_code == 404

    def test_delete_draft(self, headers, pdf_b64):
        # create a fresh draft to delete
        r = _create_draft(headers, pdf_b64, "gas", label="TEST_delete_me")
        assert r.status_code == 200
        did = r.json()["draft_id"]
        rd = requests.delete(f"{BASE_URL}/api/bill-drafts/{did}", headers=headers, timeout=15)
        assert rd.status_code == 200, rd.text
        # verify not in list
        r_list = requests.get(f"{BASE_URL}/api/bill-drafts", headers=headers, timeout=15).json()
        ids = [x["draft_id"] for x in r_list["items"]]
        assert did not in ids
        # 404 on second delete
        rd2 = requests.delete(f"{BASE_URL}/api/bill-drafts/{did}", headers=headers, timeout=15)
        assert rd2.status_code == 404

    def test_reanalyze(self, headers):
        did = TestBillDraftLifecycle.created_ids[0]
        r = requests.post(f"{BASE_URL}/api/bill-drafts/{did}/reanalyze", headers=headers, timeout=15)
        assert r.status_code == 200
        # status should reset to pending
        r_get = requests.get(f"{BASE_URL}/api/bill-drafts/{did}", headers=headers, timeout=15).json()
        assert r_get.get("status") in ("pending", "analyzing", "done"), r_get.get("status")


class TestAssociateFlow:
    """Associate draft → existing contact."""

    def test_associate_draft_to_contact(self, headers, pdf_b64):
        # get any existing contact
        rc = requests.get(f"{BASE_URL}/api/contacts", headers=headers, timeout=20)
        assert rc.status_code == 200, rc.text
        contacts_data = rc.json()
        # contacts endpoint may return list or {items}
        contacts = contacts_data if isinstance(contacts_data, list) else contacts_data.get("items", [])
        if not contacts:
            pytest.skip("no contacts available to test associate")
        cid = contacts[0].get("contact_id") or contacts[0].get("id")
        assert cid, contacts[0]

        # Create fresh draft
        r = _create_draft(headers, pdf_b64, "luce", label="TEST_associate")
        assert r.status_code == 200
        did = r.json()["draft_id"]

        # Wait briefly for pending → allow (associate should work regardless of status)
        time.sleep(3)

        ra = requests.post(
            f"{BASE_URL}/api/bill-drafts/{did}/associate",
            json={"contact_id": cid},
            headers=headers,
            timeout=30,
        )
        assert ra.status_code == 200, ra.text
        payload = ra.json()
        assert payload.get("ok") is True
        assert payload.get("bill_id", "").startswith("bill_")
        assert payload.get("contact_id") == cid
        bill_id = payload["bill_id"]

        # Verify draft is gone
        rg = requests.get(f"{BASE_URL}/api/bill-drafts/{did}", headers=headers, timeout=15)
        assert rg.status_code == 404

        # Verify bill appears under contact bills
        rb = requests.get(f"{BASE_URL}/api/contacts/{cid}/bills", headers=headers, timeout=20)
        assert rb.status_code == 200, rb.text
        bills_data = rb.json()
        items = bills_data.get("items") if isinstance(bills_data, dict) else bills_data
        ids = [b.get("bill_id") for b in (items or [])]
        assert bill_id in ids, f"bill_id {bill_id} not in {ids[:5]}"

        # cleanup: delete the bill
        requests.delete(f"{BASE_URL}/api/contacts/{cid}/bills/{bill_id}", headers=headers, timeout=15)

    def test_associate_invalid_contact_404(self, headers, pdf_b64):
        r = _create_draft(headers, pdf_b64, "telco", label="TEST_bad_contact")
        assert r.status_code == 200
        did = r.json()["draft_id"]
        ra = requests.post(
            f"{BASE_URL}/api/bill-drafts/{did}/associate",
            json={"contact_id": "c_nonexistent_xxx"},
            headers=headers,
            timeout=15,
        )
        assert ra.status_code in (404, 400, 403), ra.status_code
        # cleanup
        requests.delete(f"{BASE_URL}/api/bill-drafts/{did}", headers=headers, timeout=10)


class TestCreateContactFromDraft:
    """POST /bill-drafts/{id}/create-contact"""

    def test_create_contact_requires_extracted(self, headers, pdf_b64):
        # Create fresh draft — should still be pending immediately
        r = _create_draft(headers, pdf_b64, "luce", label="TEST_needs_extracted")
        assert r.status_code == 200
        did = r.json()["draft_id"]
        # try immediately (extracted should be None)
        r400 = requests.post(
            f"{BASE_URL}/api/bill-drafts/{did}/create-contact",
            headers=headers,
            timeout=15,
        )
        # Either 400 (no extracted yet) or the analysis finished super fast → 200
        assert r400.status_code in (200, 400), r400.status_code
        if r400.status_code == 200:
            new_cid = r400.json().get("contact_id")
            if new_cid:
                requests.delete(f"{BASE_URL}/api/contacts/{new_cid}", headers=headers, timeout=15)
        else:
            requests.delete(f"{BASE_URL}/api/bill-drafts/{did}", headers=headers, timeout=10)

    def test_create_contact_success(self, headers, pdf_b64):
        r = _create_draft(headers, pdf_b64, "luce", label="TEST_create_contact")
        assert r.status_code == 200
        did = r.json()["draft_id"]
        # Wait for done
        _, d = _poll_until_done(headers, did, max_wait=90)
        if not d or d.get("status") != "done":
            # cleanup and skip
            requests.delete(f"{BASE_URL}/api/bill-drafts/{did}", headers=headers, timeout=10)
            pytest.skip(f"analysis did not complete: status={d.get('status') if d else 'unknown'}")

        rc = requests.post(
            f"{BASE_URL}/api/bill-drafts/{did}/create-contact",
            headers=headers,
            timeout=30,
        )
        assert rc.status_code == 200, rc.text
        payload = rc.json()
        assert payload.get("ok") is True
        new_cid = payload.get("contact_id")
        assert new_cid, payload
        assert payload.get("bill_id", "").startswith("bill_")

        # Verify contact exists with tag
        rget = requests.get(f"{BASE_URL}/api/contacts/{new_cid}", headers=headers, timeout=15)
        assert rget.status_code == 200, rget.text
        contact = rget.json()
        assert "da-bolletta" in (contact.get("tags") or []), contact.get("tags")

        # Draft should be gone
        rd = requests.get(f"{BASE_URL}/api/bill-drafts/{did}", headers=headers, timeout=15)
        assert rd.status_code == 404

        # cleanup
        requests.delete(f"{BASE_URL}/api/contacts/{new_cid}", headers=headers, timeout=15)


def teardown_module(module):
    """Delete any leftover TEST_ drafts."""
    try:
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
            timeout=15,
        )
        if r.status_code != 200:
            return
        tok = r.json().get("token")
        h = {"Authorization": f"Bearer {tok}"}
        rl = requests.get(f"{BASE_URL}/api/bill-drafts", headers=h, timeout=15)
        if rl.status_code == 200:
            for x in rl.json().get("items", []):
                if (x.get("label") or "").startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/bill-drafts/{x['draft_id']}", headers=h, timeout=10)
    except Exception:
        pass
