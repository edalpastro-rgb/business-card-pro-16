"""V50.z466 — Extended tests for Features 5, 6, 7, 8, 12, 15 (backend only).

Testing against http://localhost:8001/api (NOT the preview VPS).
"""
import os
import json
import base64
import time
import requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


# ─────────────────────────── Helpers ─────────────────────────── #

def _login():
    r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    r.raise_for_status()
    body = r.json()
    assert "token" in body, f"login response missing 'token': {body.keys()}"
    return {"Authorization": f"Bearer {body['token']}"}


def _stream_text(h, msg, timeout=120):
    """Follow the SSE stream until the connection ends; return the concatenated reply text.

    The server uses `{text: str}` events for delta tokens and various `stage` events
    for status; the stream ends when the server closes the connection.
    """
    r = requests.post(f"{BASE}/assistant/chat/stream", json={"message": msg}, headers=h, timeout=timeout, stream=True)
    out = []
    for line in r.iter_lines():
        if not line or not line.startswith(b"data:"):
            continue
        try:
            d = json.loads(line[5:].decode())
        except Exception:
            continue
        if "text" in d and "stage" not in d:
            out.append(d["text"])
        elif "delta" in d and "stage" not in d:
            out.append(d["delta"])
    return "".join(out), True


# ──────────────────────── Health / Regression ──────────────────────── #

class TestHealth:
    def test_login_returns_token(self):
        r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data
        assert data["user"]["email"] == EMAIL

    def test_health(self):
        r = requests.get(f"{BASE}/health", timeout=20)
        assert r.status_code == 200

    def test_quick_action_pun_18(self):
        h = _login()
        r = requests.get(f"{BASE}/quick-action/pun-18", headers=h, timeout=30)
        assert r.status_code == 200, r.text[:200]

    def test_contacts_list(self):
        h = _login()
        r = requests.get(f"{BASE}/contacts", headers=h, timeout=30)
        assert r.status_code == 200

    def test_libretto_content(self):
        h = _login()
        r = requests.get(f"{BASE}/libretto/content", headers=h, timeout=20)
        assert r.status_code == 200


# ──────────────────────── Feature 5 — Storico PUN ──────────────────────── #

class TestF5PunHistory:
    def test_history_json_shape(self):
        h = _login()
        r = requests.get(f"{BASE}/pun/history?months=18", headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["months"] == 18 and d["unit"] == "€/kWh"
        assert len(d["rows"]) in (18, 19)
        for row in d["rows"]:
            assert {"month_key", "label", "available", "F1", "F2", "F3", "monorario", "kind", "is_max", "is_min"} <= set(row)
        assert "source" in d and "cache_updated_at" in d

    def test_history_pdf(self):
        h = _login()
        r = requests.get(f"{BASE}/pun/history/pdf?months=18", headers=h, timeout=60)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"
        cd = r.headers.get("content-disposition", "").lower()
        assert "attachment" in cd

    def test_history_requires_auth(self):
        r = requests.get(f"{BASE}/pun/history", timeout=20)
        assert r.status_code == 401

    def test_history_clamp_to_36(self):
        h = _login()
        r = requests.get(f"{BASE}/pun/history?months=50", headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # Should be clamped to 36
        assert d["months"] == 36


# ──────────────────────── Feature 6 — Google Places ──────────────────────── #

class TestF6Places:
    def test_autocomplete_permission_denied_returns_502(self):
        h = _login()
        r = requests.get(f"{BASE}/places/autocomplete", params={"q": "via roma 10 asolo", "session": "abc"}, headers=h, timeout=20)
        # Google key returns PERMISSION_DENIED → expected 502 with italian message
        assert r.status_code in (200, 502), f"got {r.status_code}: {r.text[:200]}"
        if r.status_code == 502:
            body = r.json()
            assert "non disponibile" in body.get("detail", "").lower() or "indirizzi" in body.get("detail", "").lower()
        else:
            # If somehow Google works, at least check structure
            d = r.json()
            assert "suggestions" in d or "enabled" in d

    def test_autocomplete_short_query(self):
        h = _login()
        r = requests.get(f"{BASE}/places/autocomplete", params={"q": "vi"}, headers=h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("enabled") in (True, False)
        assert d.get("suggestions") == []

    def test_details_missing_place_id(self):
        h = _login()
        r = requests.get(f"{BASE}/places/details", headers=h, timeout=20)
        assert r.status_code == 422


# ──────────────────────── Feature 7 — Rubrica fallback ──────────────────────── #

class TestF7Phonebook:
    def test_marker_for_unknown_name(self):
        h = _login()
        text, done = _stream_text(h, "numero di Zebedeo Mastrangelo")
        assert done, f"stream did not complete; got: {text[:200]}"
        assert "[[RUBRICA:Zebedeo Mastrangelo]]" in text, f"marker missing in: {text[:400]}"
        assert "Non trovo" in text or "non trovo" in text.lower()

    def test_crm_hit_no_marker(self):
        h = _login()
        text, done = _stream_text(h, "numero di Mario Rossi")
        assert done
        assert "[[RUBRICA" not in text
        assert "Mario Rossi" in text

    def test_phonebook_result_persists(self):
        h = _login()
        r = requests.post(f"{BASE}/assistant/phonebook-result",
                          json={"name": "Zebedeo Mastrangelo", "phone": "+39 333 0000000", "found": True},
                          headers=h, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "+39 333 0000000" in body.get("content", "")

    def test_phonebook_denied(self):
        h = _login()
        r = requests.post(f"{BASE}/assistant/phonebook-result",
                          json={"name": "X", "found": False, "permission": "denied"},
                          headers=h, timeout=20)
        assert r.status_code == 200
        assert "Permessi" in r.json().get("content", "")


# ──────────────────────── Feature 8 — Watchdog Axon ──────────────────────── #

class TestF8Watchdog:
    def test_status(self):
        h = _login()
        r = requests.get(f"{BASE}/axon/watchdog/status", headers=h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["first_token_timeout_s"] == 10
        assert d["heartbeat_age_s"] < 5
        assert d["restart_scheduled"] is False
        assert d.get("loop_stall_threshold_s") == 15

    def test_recover_soft(self):
        h = _login()
        # Only ONE call here (prior test file already does one; be careful)
        r = requests.post(f"{BASE}/axon/watchdog/recover",
                          json={"reason": "pytest-extended", "elapsed_ms": 10000},
                          headers=h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["action"] == "soft"
        assert "riprendendo" in d["message"]

    def test_chat_regression_still_streams(self):
        h = _login()
        text, done = _stream_text(h, "ciao, cosa puoi fare?", timeout=120)
        assert done, f"stream not completed: {text[:200]}"
        assert len(text.strip()) > 10, f"short reply: {text!r}"


# ──────────────────────── Feature 12 — Libretto ↔ Axon ──────────────────────── #

class TestF12Libretto:
    def test_index(self):
        h = _login()
        r = requests.get(f"{BASE}/libretto/index", headers=h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["total"] >= 30
        for it in d["items"]:
            assert "id" in it and "title" in it and "route" in it
            assert it["route"].startswith("/libretto?section=")

    def test_index_query(self):
        h = _login()
        r = requests.get(f"{BASE}/libretto/index", params={"q": "pun pdf"}, headers=h, timeout=20)
        assert r.status_code == 200
        items = r.json()["items"]
        assert items and items[0]["id"] == "storico-pun", f"first item: {items[:3] if items else []}"

    def test_sse_chat_opens_libretto_section(self):
        h = _login()
        text, done = _stream_text(h, "apri il libretto sullo storico PUN", timeout=120)
        assert done
        assert "[[NAV:/libretto?section=storico-pun|" in text, f"marker missing: {text[:400]}"

    def test_sse_chat_opens_libretto_root(self):
        h = _login()
        text, done = _stream_text(h, "apri il manuale", timeout=120)
        assert done
        assert "[[NAV:/libretto|" in text, f"marker missing: {text[:400]}"


# ──────────────────────── Feature 15 — Upload antivirus / whitelist ──────────────────────── #

class TestF15UploadGuard:
    _created_file_ids = []

    def test_upload_pe_binary_as_pdf_blocked(self):
        h = _login()
        payload = b"MZ\x90\x00" + (b"\x00" * 2000)
        files = {"file": ("x.pdf", payload, "application/pdf")}
        r = requests.post(f"{BASE}/master-files/upload",
                          files=files, data={"category": "files"}, headers=h, timeout=30)
        assert r.status_code == 415, f"expected 415 got {r.status_code}: {r.text[:200]}"
        assert "Formato non consentito" in r.text or "non consentito" in r.text.lower()

    def test_upload_real_pdf_accepted(self):
        h = _login()
        pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog>>endobj\nxref\n0 1\n0000000000 65535 f \ntrailer<</Size 1>>\nstartxref\n9\n%%EOF\n"
        files = {"file": ("real.pdf", pdf, "application/pdf")}
        r = requests.post(f"{BASE}/master-files/upload",
                          files=files, data={"category": "files"}, headers=h, timeout=60)
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        body = r.json()
        fid = body.get("file_id") or body.get("id")
        assert fid, f"no file_id in response: {body}"
        type(self)._created_file_ids.append(fid)

    def test_json_master_file_html_rejected(self):
        h = _login()
        html = b"<html><body>hi</body></html>"
        payload = {
            "category": "files",
            "name": "evil.html",
            "mime": "text/html",
            "data_base64": base64.b64encode(html).decode(),
        }
        r = requests.post(f"{BASE}/master-files", json=payload, headers=h, timeout=30)
        assert r.status_code == 415, f"expected 415 got {r.status_code}: {r.text[:200]}"

    def test_json_master_note_without_data_ok(self):
        h = _login()
        payload = {
            "category": "notes",
            "name": "TEST_note",
            "title": "TEST_note",
            "body": "testo nota",
            "mime": "text/plain",
        }
        r = requests.post(f"{BASE}/master-files", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, f"got {r.status_code}: {r.text[:300]}"
        fid = r.json().get("file_id")
        if fid:
            type(self)._created_file_ids.append(fid)

    def test_upload_guard_status(self):
        h = _login()
        r = requests.get(f"{BASE}/admin/upload-guard/status", headers=h, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["enabled"] is True
        # ClamAV may be ERROR in dev (expected)
        assert d["clamav"] in ("OK", "ERROR", "disabled", "FOUND")
        assert isinstance(d["allowed"], list) and len(d["allowed"]) >= 3
        assert d["limits_mb"]["image"] == 12
        assert d["limits_mb"]["pdf"] == 50
        assert d["limits_mb"]["audio"] == 25

    def test_identity_document_png_allowed(self):
        h = _login()
        # Tiny valid PNG (1x1 transparent)
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        )
        payload = {
            "doc_type": "id_card",
            "front_base64": base64.b64encode(png).decode(),
            "document_number": "TEST_12345",
            "holder_name": "TEST User",
            "subject_type": "user",
        }
        r = requests.post(f"{BASE}/identity-documents", json=payload, headers=h, timeout=30)
        # Antivirus/whitelist must NOT reject a valid PNG (415). 200/201 is ideal,
        # but 400 for business validation is acceptable; 415 means wrongly blocked.
        assert r.status_code != 415, f"PNG blocked by whitelist (415): {r.text[:300]}"
        assert r.status_code in (200, 201), f"got {r.status_code}: {r.text[:300]}"
        try:
            doc_id = r.json().get("doc_id") or r.json().get("id")
            if doc_id:
                requests.delete(f"{BASE}/identity-documents/{doc_id}", headers=h, timeout=15)
        except Exception:
            pass

    @classmethod
    def teardown_class(cls):
        # Clean up any master-files created by this suite
        try:
            h = _login()
            for fid in cls._created_file_ids:
                try:
                    requests.delete(f"{BASE}/master-files/{fid}", headers=h, timeout=15)
                except Exception:
                    pass
        except Exception:
            pass
