"""
V38F backend tests — share-link generation + public download + rename + security.
Endpoints:
  POST /api/contacts/{cid}/files/{fid}/share-link
  GET  /api/public/files/{token}   (no auth)
  PATCH /api/contacts/{cid}/files/{fid}   (rename)
"""
import os
import base64
import time
from datetime import datetime, timezone
import pytest
import requests
import jwt

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://contact-hub-italy.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"

# Same default as server.py
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-change-me-in-prod-9827345')
JWT_ALG = 'HS256'

# A tiny valid-ish PDF header (bytes)
TINY_PDF_BYTES = b"%PDF-1.4\n%tiny\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
TINY_PDF_B64 = base64.b64encode(TINY_PDF_BYTES).decode()


# ---- fixtures ----
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    d = r.json()
    assert "token" in d
    return d["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def contact(headers):
    payload = {
        "first_name": "TEST_V38F",
        "last_name": "ShareLink",
        "area": "energy",
    }
    r = requests.post(f"{API}/contacts", json=payload, headers=headers, timeout=30)
    assert r.status_code in (200, 201), f"contact create failed: {r.text}"
    c = r.json()
    yield c
    # cleanup
    try:
        requests.delete(f"{API}/contacts/{c['contact_id']}", headers=headers, timeout=30)
    except Exception:
        pass


@pytest.fixture(scope="module")
def contact_file(headers, contact):
    fpayload = {
        "name": "test-share.pdf",
        "mime": "application/pdf",
        "data_base64": TINY_PDF_B64,
        "size": len(TINY_PDF_BYTES),
    }
    r = requests.post(f"{API}/contacts/{contact['contact_id']}/files", json=fpayload, headers=headers, timeout=30)
    assert r.status_code in (200, 201), f"file add failed: {r.text}"
    f = r.json()
    assert "id" in f
    return f


# ---- share-link ----
class TestShareLinkGeneration:
    def test_create_share_link(self, headers, contact, contact_file):
        cid = contact["contact_id"]
        fid = contact_file["id"]
        r = requests.post(f"{API}/contacts/{cid}/files/{fid}/share-link", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "url" in d and "expires_at" in d and "name" in d and "mime" in d
        assert "/api/public/files/" in d["url"]
        assert d["url"].startswith("http")
        assert d["mime"] == "application/pdf"
        assert d["name"] == "test-share.pdf"

        # expires_at ~24h in future
        exp = datetime.fromisoformat(d["expires_at"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta_h = (exp - now).total_seconds() / 3600.0
        assert 23 <= delta_h <= 25, f"exp delta not ~24h: {delta_h}"

    def test_public_download_no_auth(self, headers, contact, contact_file):
        cid = contact["contact_id"]
        fid = contact_file["id"]
        r = requests.post(f"{API}/contacts/{cid}/files/{fid}/share-link", headers=headers, timeout=30)
        assert r.status_code == 200
        url = r.json()["url"]

        # Fetch WITHOUT auth header
        r2 = requests.get(url, timeout=30)
        assert r2.status_code == 200, f"public fetch failed: {r2.status_code} {r2.text[:200]}"
        assert r2.headers.get("Content-Type", "").startswith("application/pdf")
        cd = r2.headers.get("Content-Disposition", "")
        assert "inline" in cd
        assert "test-share.pdf" in cd
        # bytes match
        assert r2.content == TINY_PDF_BYTES


# ---- security ----
class TestShareLinkSecurity:
    def test_bogus_token_400(self):
        r = requests.get(f"{API}/public/files/not-a-valid-jwt", timeout=15)
        assert r.status_code == 400
        assert "non valido" in r.json().get("detail", "").lower()

    def test_expired_token_410(self, contact, contact_file):
        cid = contact["contact_id"]
        fid = contact_file["id"]
        expired_payload = {
            "kind": "cfile",
            "contact_id": cid,
            "file_id": fid,
            "user_id": "whatever",
            "exp": int(time.time()) - 3600,  # 1h ago
        }
        tok = jwt.encode(expired_payload, JWT_SECRET, algorithm=JWT_ALG)
        r = requests.get(f"{API}/public/files/{tok}", timeout=15)
        assert r.status_code == 410, f"expected 410 got {r.status_code}: {r.text}"
        assert "scaduto" in r.json().get("detail", "").lower()

    def test_wrong_kind_400(self, contact, contact_file):
        cid = contact["contact_id"]
        fid = contact_file["id"]
        payload = {
            "kind": "other",
            "contact_id": cid,
            "file_id": fid,
            "user_id": "x",
            "exp": int(time.time()) + 3600,
        }
        tok = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
        r = requests.get(f"{API}/public/files/{tok}", timeout=15)
        assert r.status_code == 400

    def test_deleted_file_404(self, headers, contact):
        # Create a temp file, get a token, delete file, then try to fetch
        fpayload = {
            "name": "temp-del.pdf",
            "mime": "application/pdf",
            "data_base64": TINY_PDF_B64,
            "size": len(TINY_PDF_BYTES),
        }
        cid = contact["contact_id"]
        r = requests.post(f"{API}/contacts/{cid}/files", json=fpayload, headers=headers, timeout=30)
        assert r.status_code in (200, 201)
        fid = r.json()["id"]
        r2 = requests.post(f"{API}/contacts/{cid}/files/{fid}/share-link", headers=headers, timeout=30)
        assert r2.status_code == 200
        url = r2.json()["url"]

        # Delete the file
        rd = requests.delete(f"{API}/contacts/{cid}/files/{fid}", headers=headers, timeout=30)
        assert rd.status_code == 200

        r3 = requests.get(url, timeout=15)
        assert r3.status_code == 404, f"expected 404, got {r3.status_code}: {r3.text}"


# ---- rename endpoint ----
class TestRenameFile:
    def test_rename_success(self, headers, contact):
        cid = contact["contact_id"]
        # add a fresh file so we don't mangle other tests
        fpayload = {
            "name": "before.pdf",
            "mime": "application/pdf",
            "data_base64": TINY_PDF_B64,
            "size": len(TINY_PDF_BYTES),
        }
        r = requests.post(f"{API}/contacts/{cid}/files", json=fpayload, headers=headers, timeout=30)
        assert r.status_code in (200, 201)
        fid = r.json()["id"]

        rr = requests.patch(
            f"{API}/contacts/{cid}/files/{fid}",
            json={"name": "after.pdf"},
            headers=headers, timeout=30,
        )
        assert rr.status_code == 200, rr.text
        assert rr.json().get("name") == "after.pdf"

        # Verify persisted via GET /contacts/{cid}
        g = requests.get(f"{API}/contacts/{cid}", headers=headers, timeout=30)
        assert g.status_code == 200
        files = g.json().get("files", [])
        found = [x for x in files if x.get("id") == fid]
        assert len(found) == 1
        assert found[0]["name"] == "after.pdf"

    def test_rename_empty_name_400(self, headers, contact, contact_file):
        cid = contact["contact_id"]
        fid = contact_file["id"]
        r = requests.patch(f"{API}/contacts/{cid}/files/{fid}", json={"name": "   "}, headers=headers, timeout=30)
        assert r.status_code == 400

    def test_rename_wrong_cid_404(self, headers, contact_file):
        fid = contact_file["id"]
        r = requests.patch(
            f"{API}/contacts/does-not-exist/files/{fid}",
            json={"name": "x.pdf"}, headers=headers, timeout=30,
        )
        assert r.status_code == 404

    def test_rename_wrong_fid_404(self, headers, contact):
        cid = contact["contact_id"]
        r = requests.patch(
            f"{API}/contacts/{cid}/files/nope-fid",
            json={"name": "x.pdf"}, headers=headers, timeout=30,
        )
        assert r.status_code == 404
