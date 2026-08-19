"""V38E — Backend smoke test.
Verifies GET /api/contacts/{id} returns files array with data_base64 for the new
'Da file cliente' picker (frontend feature). Backend was not modified but is a
dependency for the new picker.
"""
import base64
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to the same var name pattern used in other tests
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": OWNER_EMAIL, "password": OWNER_PASSWORD,
    }, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def contact_id(headers):
    payload = {
        "first_name": "TEST_V38E",
        "last_name": f"SourcePicker_{uuid.uuid4().hex[:6]}",
        "phone": "+391112223344",
    }
    r = requests.post(f"{BASE_URL}/api/contacts", headers=headers, json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    cid = body.get("id") or body.get("contact_id")
    assert cid, f"missing id in create response: {body}"
    yield cid
    requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)


TINY_PDF_B64 = (
    "JVBERi0xLjEKJcKlwrHDqwoKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1Bh"
    "Z2VzIDIgMCBSCiAgPj4KZW5kb2JqCgoyIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2VzCiAgICAg"
    "L0tpZHMgWzMgMCBSXQogICAgIC9Db3VudCAxCiAgICAgL01lZGlhQm94IFswIDAgMzAwIDE0"
    "NF0KICA+PgplbmRvYmoKCjMgMCBvYmoKICA8PCAgL1R5cGUgL1BhZ2UKICAgICAgL1BhcmVu"
    "dCAyIDAgUgogICAgICAvUmVzb3VyY2VzCiAgICAgICA8PCAvRm9udAogICAgICAgICAgIDw8"
    "IC9GMQogICAgICAgICAgICAgICA8PCAvVHlwZSAvRm9udAogICAgICAgICAgICAgICAgICAv"
    "U3VidHlwZSAvVHlwZTEKICAgICAgICAgICAgICAgICAgL0Jhc2VGb250IC9UaW1lcy1Sb21h"
    "bgogICAgICAgICAgICAgICA+PgogICAgICAgICAgID4+CiAgICAgICA+PgogICAgICAvQ29u"
    "dGVudHMgNCAwIFIKICA+PgplbmRvYmoKCjQgMCBvYmoKICA8PCAvTGVuZ3RoIDU1ID4+CnN0"
    "cmVhbQogIEJUCiAgICAvRjEgMTggVGYKICAgIDAgMCBUZAogICAgKEhlbGxvIFdvcmxkKSBU"
    "agogIEVUCmVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZgow"
    "MDAwMDAwMDE4IDAwMDAwIG4KMDAwMDAwMDA3NyAwMDAwMCBuCjAwMDAwMDAxNzggMDAwMDAg"
    "bgowMDAwMDAwNDU3IDAwMDAwIG4KdHJhaWxlcgogIDw8ICAvUm9vdCAxIDAgUgogICAgICAv"
    "U2l6ZSA1CiAgPj4Kc3RhcnR4cmVmCjU2NQolJUVPRgo="
)


def test_get_contact_returns_files_array(headers, contact_id):
    """GET /contacts/{id} must expose `files` array (empty by default) so the
    picker can filter PDFs client-side."""
    r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert (data.get("id") or data.get("contact_id")) == contact_id
    assert "files" in data, "contact response must include files field"
    assert isinstance(data["files"], list)


def test_upload_pdf_file_and_verify_fields_for_picker(headers, contact_id):
    """After POST /contacts/{cid}/files, GET must return that file with all
    fields required by the picker: id, name, mime, data_base64, size, created_at."""
    payload = {
        "name": "TEST_V38E_bolletta.pdf",
        "mime": "application/pdf",
        "data_base64": TINY_PDF_B64,
        "size": len(base64.b64decode(TINY_PDF_B64)),
    }
    up = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/files",
                       headers=headers, json=payload, timeout=15)
    assert up.status_code in (200, 201), up.text

    r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    files = r.json()["files"]
    pdfs = [f for f in files if (f.get("mime") or "").lower() == "application/pdf"]
    assert len(pdfs) >= 1, "expected at least 1 PDF"

    f = pdfs[0]
    for k in ("id", "name", "mime", "data_base64", "size", "created_at"):
        assert k in f, f"file entry missing field: {k}"
    assert f["name"] == "TEST_V38E_bolletta.pdf"
    assert f["mime"] == "application/pdf"
    assert isinstance(f["data_base64"], str) and len(f["data_base64"]) > 100
    assert f["size"] > 0


def test_non_pdf_file_ignored_by_picker_filter_logic(headers, contact_id):
    """Sanity: uploading a non-PDF file (image) results in a file entry the
    frontend picker will filter OUT — verified here indirectly by checking mime."""
    img_b64 = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode()
    payload = {
        "name": "TEST_V38E_photo.png",
        "mime": "image/png",
        "data_base64": img_b64,
        "size": 40,
    }
    up = requests.post(f"{BASE_URL}/api/contacts/{contact_id}/files",
                       headers=headers, json=payload, timeout=15)
    assert up.status_code in (200, 201), up.text

    r = requests.get(f"{BASE_URL}/api/contacts/{contact_id}", headers=headers, timeout=15)
    files = r.json()["files"]
    non_pdfs = [f for f in files if (f.get("mime") or "").lower() != "application/pdf"]
    assert any(f["name"] == "TEST_V38E_photo.png" for f in non_pdfs)
