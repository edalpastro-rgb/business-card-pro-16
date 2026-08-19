"""V38D — Verify DELETE /api/contacts/{cid}/bills/{bid} still works and bill disappears."""
import os
import base64
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}


# minimal valid PDF (small)
TINY_PDF = base64.b64encode(
    b"%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
    b"2 0 obj<< /Type /Pages /Count 1 /Kids [3 0 R] >>endobj\n"
    b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>endobj\n"
    b"4 0 obj<< /Length 44 >>stream\nBT /F1 12 Tf 20 60 Td (V38D bill test) Tj ET\nendstream endobj\n"
    b"xref\n0 5\n0000000000 65535 f\ntrailer<< /Size 5 /Root 1 0 R >>\n%%EOF"
).decode()


class TestBillDeleteFlow:
    contact_id = None
    bill_id = None

    def test_1_create_contact(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            headers=headers,
            json={"first_name": "TEST_V38D", "last_name": "BillDelete", "phone": "+391230000000"},
            timeout=20,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        cid = data.get("id") or data.get("contact_id") or data.get("_id")
        assert cid, data
        TestBillDeleteFlow.contact_id = cid

    def test_2_upload_bill(self, headers):
        cid = TestBillDeleteFlow.contact_id
        r = requests.post(
            f"{BASE_URL}/api/contacts/{cid}/bills",
            headers=headers,
            json={
                "bill_type": "luce",
                "pdf_base64": TINY_PDF,
                "pdf_name": "test_v38d.pdf",
                "pdf_mime": "application/pdf",
            },
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        bid = data.get("bill_id") or data.get("id")
        assert bid, data
        TestBillDeleteFlow.bill_id = bid

    def test_3_bill_present_in_list(self, headers):
        cid = TestBillDeleteFlow.contact_id
        bid = TestBillDeleteFlow.bill_id
        r = requests.get(f"{BASE_URL}/api/contacts/{cid}/bills", headers=headers, timeout=20)
        assert r.status_code == 200
        grouped = r.json().get("grouped", {})
        all_bills = grouped.get("luce", []) + grouped.get("gas", []) + grouped.get("telco", [])
        ids = [b.get("bill_id") for b in all_bills]
        assert bid in ids, f"Uploaded bill {bid} not found in list: {ids}"

    def test_4_delete_bill(self, headers):
        cid = TestBillDeleteFlow.contact_id
        bid = TestBillDeleteFlow.bill_id
        r = requests.delete(f"{BASE_URL}/api/contacts/{cid}/bills/{bid}", headers=headers, timeout=20)
        assert r.status_code in (200, 204), r.text

    def test_5_bill_gone(self, headers):
        cid = TestBillDeleteFlow.contact_id
        bid = TestBillDeleteFlow.bill_id
        r = requests.get(f"{BASE_URL}/api/contacts/{cid}/bills", headers=headers, timeout=20)
        assert r.status_code == 200
        grouped = r.json().get("grouped", {})
        all_bills = grouped.get("luce", []) + grouped.get("gas", []) + grouped.get("telco", [])
        ids = [b.get("bill_id") for b in all_bills]
        assert bid not in ids, f"Bill still present after DELETE: {ids}"

    def test_6_cleanup_contact(self, headers):
        cid = TestBillDeleteFlow.contact_id
        r = requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=20)
        assert r.status_code in (200, 204, 404)
