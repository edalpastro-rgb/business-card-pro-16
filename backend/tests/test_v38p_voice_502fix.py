"""V38P — Backend tests for the 5 fixes/additions:
1. `POST /api/ai/contact-from-voice` — 502 bug fix (wrong kwarg name).
2. Master-files reuse for bill-quick source picker
   - GET /api/master-files?category=bills
   - GET /api/master-files?category=files
   - GET /api/master-files/{id} → returns data_base64

Regression:
- Login, contacts CRUD, bill drafts CRUD (basic).
- Existing /api/ai/contact-from-card still works.
"""

import base64
import os
import subprocess
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

# Load env from frontend/.env so BASE_URL resolves to the public preview URL
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


def _login():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tok():
    return _login()


# ---------------------------------------------------------------------------
# 1) BUG FIX: /api/ai/contact-from-voice must not return 502
# ---------------------------------------------------------------------------
class TestVoiceEndpoint502Fix:
    """The primary V38P bug fix — must never return HTTP 502."""

    def _make_silent_m4a(self, duration=1.0):
        """Generate a tiny silent m4a using ffmpeg (installed at runtime)."""
        path = f"/tmp/silent_{uuid.uuid4().hex}.m4a"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"anullsrc=r=16000:cl=mono",
                "-t",
                str(duration),
                "-c:a",
                "aac",
                path,
            ],
            check=True,
            capture_output=True,
        )
        return path

    def _make_spoken_m4a(self):
        """Generate a real Italian m4a via espeak-ng + ffmpeg if present."""
        import shutil
        if not shutil.which("espeak-ng"):
            return None
        wav = f"/tmp/speak_{uuid.uuid4().hex}.wav"
        m4a = wav.replace(".wav", ".m4a")
        subprocess.run(
            ["espeak-ng", "-v", "it",
             "Ciao mi chiamo Mario Rossi e il mio numero è 3331234567.",
             "-w", wav],
            check=True, capture_output=True)
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav, "-c:a", "aac", m4a],
            check=True, capture_output=True)
        return m4a

    def test_silent_m4a_not_502(self, tok):
        """Silent audio → whisper may return empty text; endpoint must be 200/422 but NEVER 502."""
        path = self._make_silent_m4a(1.0)
        b64 = base64.b64encode(Path(path).read_bytes()).decode()
        r = requests.post(
            f"{BASE_URL}/api/ai/contact-from-voice",
            headers=_h(tok),
            json={"audio_base64": b64, "mime": "audio/m4a"},
            timeout=90,
        )
        assert r.status_code != 502, f"REGRESSION: still 502! body={r.text}"
        assert r.status_code in (200, 400, 422), f"Unexpected status: {r.status_code} body={r.text}"

    def test_spoken_m4a_success(self, tok):
        """Real spoken audio should return 200 with contact + transcript."""
        m4a = self._make_spoken_m4a()
        if not m4a:
            pytest.skip("espeak-ng not installed")
        b64 = base64.b64encode(Path(m4a).read_bytes()).decode()
        r = requests.post(
            f"{BASE_URL}/api/ai/contact-from-voice",
            headers=_h(tok),
            json={"audio_base64": b64, "mime": "audio/m4a"},
            timeout=90,
        )
        assert r.status_code != 502, f"REGRESSION: still 502! body={r.text}"
        # spoken audio should succeed
        assert r.status_code == 200, f"Expected 200, got {r.status_code} — body={r.text}"
        j = r.json()
        assert "contact" in j
        assert "transcript" in j
        assert isinstance(j["transcript"], str)

    def test_truncated_audio(self, tok):
        """Truncated/invalid audio → should be 4xx (400/422), never 502."""
        garbage = base64.b64encode(b"\x00\x01\x02" * 500).decode()
        r = requests.post(
            f"{BASE_URL}/api/ai/contact-from-voice",
            headers=_h(tok),
            json={"audio_base64": garbage, "mime": "audio/m4a"},
            timeout=60,
        )
        # Ideally 400/422 for invalid content. Since server currently uses 502 catch-all
        # for transcription errors, this test flags the potential issue.
        assert r.status_code != 502, (
            f"BUG: truncated audio still returns 502 (transcription errors "
            f"should be 400/422 not 502). body={r.text}"
        )

    def test_invalid_base64(self, tok):
        r = requests.post(
            f"{BASE_URL}/api/ai/contact-from-voice",
            headers=_h(tok),
            json={"audio_base64": "@@@invalid@@@", "mime": "audio/m4a"},
            timeout=15,
        )
        assert r.status_code == 400
        assert "non valido" in r.text.lower() or "invalid" in r.text.lower()

    def test_auth_required(self):
        r = requests.post(
            f"{BASE_URL}/api/ai/contact-from-voice",
            json={"audio_base64": "aGVsbG8=", "mime": "audio/m4a"},
            timeout=15,
        )
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# 2) Master-files reuse endpoints used by bill-quick source picker
# ---------------------------------------------------------------------------
class TestMasterFilesReuse:
    """Verify master-files endpoints support the bill-quick source picker flow."""

    _seed_ids = []

    @classmethod
    def _post_master_file(cls, tok, category, name, mime, data_b64):
        r = requests.post(
            f"{BASE_URL}/api/master-files",
            headers=_h(tok),
            json={"category": category, "name": name,
                  "mime": mime, "data_base64": data_b64},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        fid = j.get("file_id") or j.get("id") or (j.get("file") or {}).get("file_id") or (j.get("file") or {}).get("id")
        assert fid, f"No file_id in response: {j}"
        cls._seed_ids.append(fid)
        return fid

    def test_seed_and_list_bills(self, tok):
        """Seed 1 bill and 1 file, then verify GET ?category=bills returns items."""
        tiny_pdf = base64.b64encode(b"%PDF-1.4\ntest pdf content\n%%EOF").decode()
        bid = self._post_master_file(
            tok, "bills", "TEST_v38p_bill.pdf", "application/pdf", tiny_pdf
        )
        r = requests.get(
            f"{BASE_URL}/api/master-files?category=bills",
            headers=_h(tok), timeout=15
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "items" in j
        ids = [(it.get("file_id") or it.get("id")) for it in j["items"]]
        assert bid in ids, "Seeded bill not returned by category=bills"
        # data_base64 must NOT be included in list responses (per V38O contract)
        assert all("data_base64" not in it for it in j["items"])

    def test_list_files_category(self, tok):
        """category=files must be reachable (used by picker to filter PDFs)."""
        tiny_pdf = base64.b64encode(b"%PDF-1.4\nanother pdf\n%%EOF").decode()
        fid = self._post_master_file(
            tok, "files", "TEST_v38p_file.pdf", "application/pdf", tiny_pdf
        )
        r = requests.get(
            f"{BASE_URL}/api/master-files?category=files",
            headers=_h(tok), timeout=15
        )
        assert r.status_code == 200, r.text
        ids = [(it.get("file_id") or it.get("id")) for it in r.json()["items"]]
        assert fid in ids

    def test_get_single_returns_data_base64(self, tok):
        """Picker requires data_base64 on single-file fetch to embed for reuse."""
        assert self._seed_ids, "No seeded ids"
        target = self._seed_ids[0]
        r = requests.get(
            f"{BASE_URL}/api/master-files/{target}",
            headers=_h(tok), timeout=15
        )
        assert r.status_code == 200, r.text
        j = r.json()
        # endpoint returns doc directly (no wrapper)
        node = j.get("file", j)
        assert "data_base64" in node, f"data_base64 missing: {list(node.keys())}"
        assert isinstance(node["data_base64"], str) and len(node["data_base64"]) > 0
        assert "mime" in node
        assert "name" in node

    def test_cleanup(self, tok):
        """Cleanup all seeded master-files."""
        for fid in self._seed_ids:
            requests.delete(
                f"{BASE_URL}/api/master-files/{fid}",
                headers=_h(tok), timeout=10
            )


# ---------------------------------------------------------------------------
# 3) Regression: existing endpoints
# ---------------------------------------------------------------------------
class TestRegression:
    def test_login_still_works(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": EMAIL, "password": PASSWORD}, timeout=15,
        )
        assert r.status_code == 200
        assert "token" in r.json()

    def test_contacts_list(self, tok):
        r = requests.get(f"{BASE_URL}/api/contacts", headers=_h(tok), timeout=20)
        assert r.status_code == 200
        assert "items" in r.json() or isinstance(r.json(), list)

    def test_contact_create_get_delete(self, tok):
        payload = {"first_name": "TEST_v38p", "last_name": "Regression",
                   "phone": "3339999999", "email": "test_v38p@example.com"}
        r = requests.post(f"{BASE_URL}/api/contacts", headers=_h(tok),
                          json=payload, timeout=15)
        assert r.status_code == 200, r.text
        cid = r.json().get("contact_id") or r.json().get("id")
        assert cid, f"No contact_id: {r.json()}"
        g = requests.get(f"{BASE_URL}/api/contacts/{cid}",
                         headers=_h(tok), timeout=10)
        assert g.status_code == 200
        assert g.json()["first_name"] == "TEST_v38p"
        d = requests.delete(f"{BASE_URL}/api/contacts/{cid}",
                            headers=_h(tok), timeout=10)
        assert d.status_code in (200, 204)

    def test_bill_drafts_endpoint_reachable(self, tok):
        """Basic reachability of bill-drafts endpoint (used for autosave)."""
        r = requests.get(f"{BASE_URL}/api/bill-drafts",
                         headers=_h(tok), timeout=15)
        # 200 or 404 (if no drafts route) — must not 5xx
        assert r.status_code < 500, r.text

    def test_master_files_crud_still_works(self, tok):
        """Sanity check: master-files basic CRUD unaffected."""
        b64 = base64.b64encode(b"regression test note").decode()
        r = requests.post(
            f"{BASE_URL}/api/master-files",
            headers=_h(tok),
            json={"category": "notes", "name": "TEST_v38p_note",
                  "mime": "text/plain", "data_base64": b64},
            timeout=15,
        )
        assert r.status_code == 200
        fid = r.json().get("file_id") or r.json().get("id")
        requests.delete(f"{BASE_URL}/api/master-files/{fid}",
                        headers=_h(tok), timeout=10)

    def test_contact_from_card_still_reachable(self, tok):
        """AIImageIn requires image_base64 — invalid input should not 502."""
        r = requests.post(
            f"{BASE_URL}/api/ai/contact-from-card",
            headers=_h(tok),
            json={"image_base64": "not_valid_base64_@@@",
                  "mime": "image/png"},
            timeout=20,
        )
        # Should be a client error (400/422), never 5xx
        assert r.status_code < 500, r.text
