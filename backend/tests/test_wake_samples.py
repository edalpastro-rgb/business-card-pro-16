"""Backend tests for wake-sample collection (V50.z390)."""
import base64
import io
import os
import zipfile

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL", "")).rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}
SESSION_ID = "qa-test"


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def sub_token():
    r = requests.post(f"{API}/auth/login", json=SUB, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def pron_bytes():
    r = requests.get(f"{API}/public/wake-samples/pronunciation", timeout=60)
    assert r.status_code == 200, r.text
    assert "audio" in r.headers.get("content-type", "").lower()
    assert len(r.content) > 10_000
    return r.content


created_sample_ids = []


# ── PUBLIC ────────────────────────────────────────────────────────────────────
class TestPublic:
    def test_pronunciation(self, pron_bytes):
        assert len(pron_bytes) > 10_000

    def test_counts_shape(self):
        r = requests.get(f"{API}/public/wake-samples/counts", timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "total" in j and "sessions" in j
        assert isinstance(j["total"], int)

    def test_b64_valid_positive(self, pron_bytes):
        b64 = base64.b64encode(pron_bytes).decode("ascii")
        r = requests.post(f"{API}/public/wake-samples/b64", json={
            "data_base64": b64, "mime": "audio/mpeg",
            "word": "axon", "environment": "casa", "kind": "positive",
            "seq": 1, "session_id": SESSION_ID,
        }, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("sample_id", "").startswith("wks_")
        assert j["word"] == "axon" and j["environment"] == "casa" and j["kind"] == "positive"
        created_sample_ids.append(j["sample_id"])

    def test_b64_valid_negative(self, pron_bytes):
        b64 = base64.b64encode(pron_bytes).decode("ascii")
        r = requests.post(f"{API}/public/wake-samples/b64", json={
            "data_base64": b64, "mime": "audio/mpeg",
            "word": "action", "environment": "bar", "kind": "negative",
            "seq": 1, "session_id": SESSION_ID,
        }, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        created_sample_ids.append(j["sample_id"])

    def test_b64_invalid_word(self, pron_bytes):
        b64 = base64.b64encode(pron_bytes).decode("ascii")
        r = requests.post(f"{API}/public/wake-samples/b64", json={
            "data_base64": b64, "mime": "audio/mpeg",
            "word": "pippo", "environment": "casa", "kind": "positive",
            "seq": 1, "session_id": SESSION_ID,
        }, timeout=30)
        assert r.status_code == 400, r.text

    def test_b64_invalid_environment(self, pron_bytes):
        b64 = base64.b64encode(pron_bytes).decode("ascii")
        r = requests.post(f"{API}/public/wake-samples/b64", json={
            "data_base64": b64, "mime": "audio/mpeg",
            "word": "axon", "environment": "ufficio", "kind": "positive",
            "seq": 1, "session_id": SESSION_ID,
        }, timeout=30)
        assert r.status_code == 400

    def test_b64_too_short(self):
        b64 = base64.b64encode(b"x" * 100).decode("ascii")
        r = requests.post(f"{API}/public/wake-samples/b64", json={
            "data_base64": b64, "mime": "audio/mpeg",
            "word": "axon", "environment": "casa", "kind": "positive",
            "seq": 1, "session_id": SESSION_ID,
        }, timeout=30)
        assert r.status_code == 400

    def test_multipart_upload(self, pron_bytes):
        files = {"file": ("t.mp3", io.BytesIO(pron_bytes), "audio/mpeg")}
        data = {"word": "axon", "environment": "macchina", "kind": "positive",
                "seq": "2", "session_id": SESSION_ID}
        r = requests.post(f"{API}/public/wake-samples", files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        created_sample_ids.append(j["sample_id"])


# ── ADMIN ─────────────────────────────────────────────────────────────────────
class TestAdmin:
    def test_stats_no_auth(self):
        r = requests.get(f"{API}/wake-samples/stats", timeout=30)
        assert r.status_code in (401, 403)

    def test_stats_sub_forbidden(self, sub_token):
        r = requests.get(f"{API}/wake-samples/stats",
                         headers={"Authorization": f"Bearer {sub_token}"}, timeout=30)
        assert r.status_code == 403, r.text

    def test_stats_owner(self, owner_token):
        r = requests.get(f"{API}/wake-samples/stats",
                         headers={"Authorization": f"Bearer {owner_token}"}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["total"] >= 2
        assert "expected_words" in j
        assert "axon" in j["expected_words"]["positive"]
        assert "action" in j["expected_words"]["negative"]
        words = {w["word"]: w for w in j["words"]}
        assert "axon" in words
        assert words["axon"]["kind"] == "positive"
        assert words["axon"]["environments"].get("casa", 0) >= 1
        assert "action" in words
        assert words["action"]["kind"] == "negative"
        assert words["action"]["environments"].get("bar", 0) >= 1
        assert isinstance(j.get("by_environment"), dict)

    def test_export_zip_owner(self, owner_token):
        r = requests.get(f"{API}/wake-samples/export.zip",
                         params={"token": owner_token}, timeout=120)
        assert r.status_code == 200, r.text[:200]
        assert "application/zip" in r.headers.get("content-type", "")
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert "manifest.csv" in names
        assert any(n.startswith("positive/axon/casa/") for n in names), names[:20]
        assert any(n.startswith("negative/action/bar/") for n in names), names[:20]

    def test_delete_cleanup(self, owner_token):
        assert created_sample_ids, "no samples created"
        for sid in created_sample_ids:
            r = requests.delete(f"{API}/wake-samples/{sid}",
                                headers={"Authorization": f"Bearer {owner_token}"}, timeout=30)
            assert r.status_code == 200, r.text
            assert r.json().get("ok") is True
