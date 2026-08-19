"""V38G — Backend smoke tests for auto-save to contact files & share flow.

Coverage:
- POST /contacts/{cid}/files ALLOWS duplicate names (dedup is client-side only)
- DELETE + PATCH still functional
- POST /contacts/{cid}/files/{fid}/share-link returns valid URL
- GET /public/files/{token} serves the file
- POST /contacts/{cid}/bills accepts a small PDF and creates a bill record
"""
import base64
import io
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


def _tiny_pdf_b64() -> str:
    """Produce a minimal valid PDF encoded as base64."""
    pdf_bytes = (
        b"%PDF-1.1\n"
        b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
        b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n"
        b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n"
        b"4 0 obj<< /Length 55 >>stream\nBT /F1 12 Tf 20 50 Td (Bolletta luce test V38G) Tj ET\nendstream endobj\n"
        b"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n"
        b"xref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000058 00000 n \n0000000110 00000 n \n0000000210 00000 n \n0000000305 00000 n \n"
        b"trailer<< /Size 6 /Root 1 0 R >>\nstartxref\n370\n%%EOF\n"
    )
    return base64.b64encode(pdf_bytes).decode("ascii")


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "token" in body, body
    return body["token"]


@pytest.fixture(scope="module")
def headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def contact_id(headers):
    payload = {"first_name": "TEST_V38G", "last_name": "AutoSave", "phone": "+39000000000", "area": "energy"}
    r = requests.post(f"{BASE_URL}/api/contacts", json=payload, headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    cid = r.json()["contact_id"]
    yield cid
    # cleanup
    requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=30)


class TestFilesSmoke:
    """Files endpoints must still work — this is a smoke check (no regression)."""

    def test_create_file(self, headers, contact_id):
        body = {"name": "Test-V38G-file.pdf", "mime": "application/pdf", "data_base64": _tiny_pdf_b64(), "size": 400}
        r = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/files", json=body, headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "Test-V38G-file.pdf"
        assert "id" in data

    def test_duplicate_name_allowed(self, headers, contact_id):
        """Backend must ALLOW duplicate names (client-side dedup only)."""
        body = {"name": "dupe-test.pdf", "mime": "application/pdf", "data_base64": _tiny_pdf_b64(), "size": 400}
        r1 = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/files", json=body, headers=headers, timeout=30)
        r2 = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/files", json=body, headers=headers, timeout=30)
        assert r1.status_code == 200
        assert r2.status_code == 200, "backend must not enforce uniqueness"
        # Verify both persisted
        c = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=30).json()
        dupes = [f for f in c.get("files", []) if f.get("name") == "dupe-test.pdf"]
        assert len(dupes) == 2, f"expected 2 files with same name, got {len(dupes)}"

    def test_patch_rename(self, headers, contact_id):
        # create a file to rename
        body = {"name": "rename-me.pdf", "mime": "application/pdf", "data_base64": _tiny_pdf_b64(), "size": 400}
        r = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/files", json=body, headers=headers, timeout=30)
        fid = r.json()["id"]
        p = requests.patch(
            f"{BASE_URL}/api/contacts/{contact_id}/files/{fid}",
            json={"name": "renamed.pdf"},
            headers=headers,
            timeout=30,
        )
        assert p.status_code == 200, p.text
        assert p.json()["name"] == "renamed.pdf"

    def test_delete_file(self, headers, contact_id):
        body = {"name": "delete-me.pdf", "mime": "application/pdf", "data_base64": _tiny_pdf_b64(), "size": 400}
        r = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/files", json=body, headers=headers, timeout=30)
        fid = r.json()["id"]
        d = requests.delete(f"{BASE_URL}/api/contacts/{contact_id}/files/{fid}", headers=headers, timeout=30)
        assert d.status_code == 200
        # verify gone
        c = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=30).json()
        assert not any(f.get("id") == fid for f in c.get("files", []))


class TestShareLink:
    def test_share_link_and_public_download(self, headers, contact_id):
        body = {"name": "share-test.pdf", "mime": "application/pdf", "data_base64": _tiny_pdf_b64(), "size": 400}
        r = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/files", json=body, headers=headers, timeout=30)
        fid = r.json()["id"]

        sl = requests.post(
            f"{BASE_URL}/api/contacts/{contact_id}/files/{fid}/share-link", headers=headers, timeout=30
        )
        assert sl.status_code == 200, sl.text
        data = sl.json()
        assert data["url"].startswith("http")
        assert "/api/public/files/" in data["url"]
        # public GET
        pr = requests.get(data["url"], timeout=30)
        assert pr.status_code == 200, f"public download failed: {pr.status_code} {pr.text[:200]}"
        assert pr.headers.get("content-type", "").startswith("application/pdf")


class TestBillsAndAutoSave:
    """Simulate V38G frontend auto-save flow via API.

    The frontend does two auto-saves on `confirmUploadWithParams`:
      1) POST /bills (the actual analysis job)
      2) saveFileToContactIfNew(uploadName, mime, b64) — mirrored PDF into contact.files

    Since we can't drive the DocumentPicker headless, we recreate step 2 explicitly.
    """

    def test_bill_creation_and_mirrored_file(self, headers, contact_id):
        pdf_b64 = _tiny_pdf_b64()
        name = "fattura-test-luce.pdf"
        # 1) create bill
        r = requests.post(
            f"{BASE_URL}/api/contacts/{contact_id}/bills",
            json={"bill_type": "luce", "pdf_base64": pdf_b64, "pdf_name": name, "pdf_mime": "application/pdf"},
            headers=headers,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        bill = r.json()
        assert bill["bill_type"] == "luce"
        assert bill["status"] in ("pending", "analyzing", "done", "error")

        # 2) V38G client-side mirror: check-existing-then-post
        c0 = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=30).json()
        already = any((f.get("name") or "").lower() == name.lower() for f in c0.get("files", []))
        assert not already
        m = requests.post(
            f"{BASE_URL}/api/contacts/{contact_id}/files",
            json={"name": name, "mime": "application/pdf", "data_base64": pdf_b64, "size": 400},
            headers=headers,
            timeout=30,
        )
        assert m.status_code == 200

        # 3) On a second attempt the frontend should skip — verify it CAN skip (i.e. the check works)
        c1 = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=30).json()
        assert any((f.get("name") or "").lower() == name.lower() for f in c1.get("files", []))

    def test_bill_reaches_done_and_analysis_pdf_could_be_saved(self, headers, contact_id):
        """Poll for status=done (analysis via Claude). Skipping strict assert if AI unavailable."""
        # Create fresh bill
        pdf_b64 = _tiny_pdf_b64()
        name = "fattura-status-luce.pdf"
        r = requests.post(
            f"{BASE_URL}/api/contacts/{contact_id}/bills",
            json={"bill_type": "luce", "pdf_base64": pdf_b64, "pdf_name": name, "pdf_mime": "application/pdf"},
            headers=headers,
            timeout=60,
        )
        assert r.status_code == 200
        # Poll bills list up to 60s
        final_status = None
        for _ in range(24):
            time.sleep(2.5)
            g = requests.get(f"{BASE_URL}/api/contacts/{contact_id}/bills", headers=headers, timeout=30)
            assert g.status_code == 200
            items = g.json().get("items", [])
            matching = [b for b in items if b.get("pdf_name") == name]
            if matching:
                st = matching[0].get("status")
                if st in ("done", "error"):
                    final_status = st
                    break
        # Even if error (tiny PDF may not have text), the frontend behavior is what we test
        # We just require that eventually the bill reaches a terminal state
        assert final_status in ("done", "error"), f"bill did not reach terminal state: {final_status}"

        # Simulate frontend auto-save of Analisi-*.html (web path)
        analysis_name = f"Analisi-{name.replace('.pdf', '')}.html"
        c0 = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=30).json()
        already = any((f.get("name") or "").lower() == analysis_name.lower() for f in c0.get("files", []))
        if not already:
            html = f"<html><body>Analisi {name}</body></html>"
            b64 = base64.b64encode(html.encode()).decode()
            saved = requests.post(
                f"{BASE_URL}/api/contacts/{contact_id}/files",
                json={"name": analysis_name, "mime": "text/html", "data_base64": b64, "size": len(html)},
                headers=headers,
                timeout=30,
            )
            assert saved.status_code == 200

        # Second attempt: verify the client-side check would skip (same-name file present)
        c1 = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=30).json()
        matches = [f for f in c1.get("files", []) if (f.get("name") or "").lower() == analysis_name.lower()]
        assert len(matches) == 1, f"expected 1 analysis file, got {len(matches)}"
