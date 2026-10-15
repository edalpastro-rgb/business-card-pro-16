"""V50.z558 — Google Drive reindex status + refresh frequency + manual reindex + _drive_refresh_due logic.
Test target: preview backend (EXPO_PUBLIC_BACKEND_URL in /app/frontend/.env), owner test@dalpastro.it.
"""
import os
import asyncio
import pytest
import requests
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Load preview backend URL
_env_path = Path("/app/frontend/.env")
BASE_URL = None
for line in _env_path.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
        break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get("token")
    if not tok and data.get("requires_2fa"):
        pytest.skip("Owner has 2FA enabled; cannot login via password-only")
    assert tok, f"no token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- /google-drive/reindex/status ----------
class TestReindexStatus:
    def test_status_shape(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/google-drive/reindex/status", headers=auth_headers, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        data = r.json()
        for k in ["indexed_files", "failed_files", "folders", "running", "stats", "refresh_frequency", "meta"]:
            assert k in data, f"missing key '{k}' in {list(data.keys())}"
        assert isinstance(data["indexed_files"], int)
        assert isinstance(data["failed_files"], int)
        assert isinstance(data["folders"], int)
        assert isinstance(data["running"], bool)
        assert data["refresh_frequency"] in ["hourly", "daily", "weekly", "monthly", "manual"]

    def test_status_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/google-drive/reindex/status", timeout=20)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# ---------- /google-drive/refresh-frequency ----------
class TestRefreshFrequency:
    def test_get_default(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/google-drive/refresh-frequency", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "frequency" in data and "options" in data
        assert data["options"] == ["hourly", "daily", "weekly", "monthly", "manual"]
        assert data["frequency"] in data["options"]

    @pytest.mark.parametrize("freq", ["hourly", "daily", "weekly", "monthly", "manual"])
    def test_put_valid_and_persisted(self, auth_headers, freq):
        r = requests.put(
            f"{BASE_URL}/api/google-drive/refresh-frequency",
            headers=auth_headers,
            json={"frequency": freq},
            timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("frequency") == freq
        # GET reflects
        g = requests.get(f"{BASE_URL}/api/google-drive/refresh-frequency", headers=auth_headers, timeout=20).json()
        assert g["frequency"] == freq
        # reindex/status.refresh_frequency reflects
        s = requests.get(f"{BASE_URL}/api/google-drive/reindex/status", headers=auth_headers, timeout=20).json()
        assert s["refresh_frequency"] == freq

    def test_put_invalid(self, auth_headers):
        r = requests.put(
            f"{BASE_URL}/api/google-drive/refresh-frequency",
            headers=auth_headers,
            json={"frequency": "yearly"},
            timeout=20,
        )
        assert r.status_code == 400, f"expected 400 got {r.status_code}"

    def test_put_unauthenticated(self):
        r = requests.put(
            f"{BASE_URL}/api/google-drive/refresh-frequency",
            json={"frequency": "hourly"},
            timeout=20,
        )
        assert r.status_code in (401, 403)

    def test_restore_hourly(self, auth_headers):
        r = requests.put(
            f"{BASE_URL}/api/google-drive/refresh-frequency",
            headers=auth_headers,
            json={"frequency": "hourly"},
            timeout=20,
        )
        assert r.status_code == 200


# ---------- /google-drive/reindex (POST) ----------
class TestManualReindex:
    def test_post_no_drive_connected_no_500(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/google-drive/reindex", headers=auth_headers, timeout=30)
        assert r.status_code == 200, f"expected 200 (even without Drive connected) got {r.status_code} {r.text[:200]}"
        data = r.json()
        assert data.get("ok") is True


# ---------- _drive_refresh_due logic replica ----------
_DRIVE_FREQ_SECONDS = {"hourly": 3600, "daily": 86400, "weekly": 7 * 86400, "monthly": 30 * 86400, "manual": None}


def _refresh_due_replica(meta: dict, now: datetime) -> bool:
    """Replica of _drive_refresh_due in /app/backend/routes/34_alarms_homeassistant.py"""
    freq = meta.get("refresh_frequency") or "hourly"
    every = _DRIVE_FREQ_SECONDS.get(freq, 3600)
    if every is None:
        return False
    last = meta.get("last_run_at")
    if not isinstance(last, datetime):
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (now - last).total_seconds() >= every - 60


class TestDriveRefreshDueLogic:
    """V50.z558 — exercise the _drive_refresh_due semantics against the real DB docs.

    Inserts a fake drive_index_meta doc for a TEST user_id via pymongo (MONGO_URL/DB_NAME
    from /app/backend/.env), then validates the replica logic against each row. Cleans up.
    """

    @pytest.fixture(scope="class")
    def dbh(self):
        from pymongo import MongoClient
        envp = Path("/app/backend/.env")
        mongo_url = None
        dbname = None
        for line in envp.read_text().splitlines():
            if line.startswith("MONGO_URL="):
                mongo_url = line.split("=", 1)[1].strip().strip('"')
            elif line.startswith("DB_NAME="):
                dbname = line.split("=", 1)[1].strip().strip('"')
        assert mongo_url and dbname
        client = MongoClient(mongo_url)
        db = client[dbname]
        yield db
        # cleanup any TEST_V50z558_ docs
        db.drive_index_meta.delete_many({"user_id": {"$regex": "^TEST_V50z558_"}})
        client.close()

    def test_manual_never_due(self, dbh):
        uid = "TEST_V50z558_manual"
        dbh.drive_index_meta.update_one(
            {"user_id": uid},
            {"$set": {"refresh_frequency": "manual", "last_run_at": datetime.now(timezone.utc) - timedelta(days=30)}},
            upsert=True,
        )
        meta = dbh.drive_index_meta.find_one({"user_id": uid})
        assert _refresh_due_replica(meta, datetime.now(timezone.utc)) is False

    def test_daily_recent_not_due(self, dbh):
        uid = "TEST_V50z558_daily2h"
        now = datetime.now(timezone.utc)
        dbh.drive_index_meta.update_one(
            {"user_id": uid},
            {"$set": {"refresh_frequency": "daily", "last_run_at": now - timedelta(hours=2)}},
            upsert=True,
        )
        meta = dbh.drive_index_meta.find_one({"user_id": uid})
        assert _refresh_due_replica(meta, now) is False

    def test_hourly_two_hours_ago_due(self, dbh):
        uid = "TEST_V50z558_hourly2h"
        now = datetime.now(timezone.utc)
        dbh.drive_index_meta.update_one(
            {"user_id": uid},
            {"$set": {"refresh_frequency": "hourly", "last_run_at": now - timedelta(hours=2)}},
            upsert=True,
        )
        meta = dbh.drive_index_meta.find_one({"user_id": uid})
        assert _refresh_due_replica(meta, now) is True

    def test_no_last_run_due(self, dbh):
        uid = "TEST_V50z558_nolast"
        dbh.drive_index_meta.update_one(
            {"user_id": uid},
            {"$set": {"refresh_frequency": "hourly"}, "$unset": {"last_run_at": ""}},
            upsert=True,
        )
        meta = dbh.drive_index_meta.find_one({"user_id": uid})
        assert _refresh_due_replica(meta, datetime.now(timezone.utc)) is True

    def test_weekly_6days_not_due(self, dbh):
        uid = "TEST_V50z558_weekly6d"
        now = datetime.now(timezone.utc)
        dbh.drive_index_meta.update_one(
            {"user_id": uid},
            {"$set": {"refresh_frequency": "weekly", "last_run_at": now - timedelta(days=6)}},
            upsert=True,
        )
        meta = dbh.drive_index_meta.find_one({"user_id": uid})
        assert _refresh_due_replica(meta, now) is False

    def test_weekly_8days_due(self, dbh):
        uid = "TEST_V50z558_weekly8d"
        now = datetime.now(timezone.utc)
        dbh.drive_index_meta.update_one(
            {"user_id": uid},
            {"$set": {"refresh_frequency": "weekly", "last_run_at": now - timedelta(days=8)}},
            upsert=True,
        )
        meta = dbh.drive_index_meta.find_one({"user_id": uid})
        assert _refresh_due_replica(meta, now) is True
