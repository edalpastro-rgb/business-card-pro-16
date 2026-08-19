"""V21.a bug fixes — quick sanity for note_attachments and contacts."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"

TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestNoteAttachments:
    """POST /api/appointments with photo + file note_attachments echoes them back and persists."""

    def test_create_appointment_with_photo_and_file_attachments(self, hdr):
        payload = {
            "title": "TEST_V21a media attachments",
            "start_at": "2026-08-01T10:00:00Z",
            "duration_min": 30,
            "area": "energy",
            "note_attachments": [
                {"id": "att1", "kind": "photo", "photo_base64": f"data:image/png;base64,{TINY_PNG_B64}"},
                {"id": "att2", "kind": "file", "file_base64": "SGVsbG8gV29ybGQ=", "file_name": "hello.txt", "file_mime": "text/plain", "file_size": 11},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/appointments", headers=hdr, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        appt_id = j.get("appointment_id") or j.get("id")
        assert appt_id, j
        atts = j.get("note_attachments", [])
        assert len(atts) == 2, atts
        kinds = sorted([a["kind"] for a in atts])
        assert kinds == ["file", "photo"]

        # verify persistence via GET
        r2 = requests.get(f"{BASE_URL}/api/appointments/{appt_id}", headers=hdr, timeout=15)
        assert r2.status_code == 200, r2.text
        atts2 = r2.json().get("note_attachments", [])
        assert len(atts2) == 2
        # cleanup
        requests.delete(f"{BASE_URL}/api/appointments/{appt_id}", headers=hdr, timeout=15)


class TestContactCreate:
    """Contacts endpoint still accepts a normal create (no schema regression)."""

    def test_contact_create_basic(self, hdr):
        payload = {
            "first_name": "TEST_V21a",
            "last_name": f"User_{int(time.time())}",
            "area": "energy",
            "phone": "3331234567",
        }
        r = requests.post(f"{BASE_URL}/api/contacts", headers=hdr, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        cid = r.json().get("contact_id") or r.json().get("id")
        assert cid
        # cleanup
        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=hdr, timeout=15)
