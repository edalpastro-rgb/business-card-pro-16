"""
V20 backend tests:
- Calendar range (year span) still works on /api/appointments
- Call log endpoint with outcome + reschedule → creates new callback
- Free Sempre (set / revoke to trial / revoke to expired) on invited user
- Appointment note_attachments create + get + clear
- Settings default palette (energy/network) + hex accept
- Call outcomes seed (6 defaults)
"""
import os
import time
import base64
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing from env"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PW = "Test1234!"
SUB_EMAIL = "sub1@dalpastro.it"
SUB_PW = "Sub12345!"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PW})
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="session")
def sub_token():
    r = requests.post(f"{API}/auth/login", json={"email": SUB_EMAIL, "password": SUB_PW})
    if r.status_code != 200:
        pytest.skip(f"sub user login failed: {r.status_code}")
    return r.json()["token"]


@pytest.fixture
def owner_h(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


@pytest.fixture
def sub_h(sub_token):
    return {"Authorization": f"Bearer {sub_token}", "Content-Type": "application/json"}


# ---------- 1. Calendar range (year span) ----------
class TestCalendarRange:
    def test_year_span_appointments(self, owner_h):
        start = "2025-01-01T00:00:00Z"
        end = "2026-12-31T23:59:59Z"
        r = requests.get(f"{API}/appointments", params={"start": start, "end": end}, headers=owner_h)
        assert r.status_code == 200, r.text
        body = r.json()
        # Response should be a list or dict with items
        assert isinstance(body, (list, dict))


# ---------- 2. Call log endpoint ----------
class TestCallLog:
    def test_full_call_log_flow(self, owner_h):
        # 2a. Create a callback
        scheduled = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        cb_payload = {
            "title": "TEST_V20 callback",
            "area": "energy",
            "scheduled_at": scheduled,
            "phone": "+390000000001",
            "notify": True,
            "notify_advance_min": 15,
        }
        r = requests.post(f"{API}/callbacks", json=cb_payload, headers=owner_h)
        assert r.status_code == 200, r.text
        cb = r.json()
        cb_id = cb["callback_id"]

        # 2b. Log call with no_answer + reschedule_delta_min=30
        r = requests.post(
            f"{API}/calls/log",
            json={
                "callback_id": cb_id,
                "phone": "+390000000001",
                "outcome_id": "call_no_answer",
                "note": "TEST_ nessuna risposta",
                "reschedule_delta_min": 30,
            },
            headers=owner_h,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "log" in data
        assert data["log"]["outcome_id"] == "call_no_answer"
        assert data.get("new_callback") is not None
        new_cb = data["new_callback"]
        # scheduled_at ~= now + 30 min
        sched = new_cb["scheduled_at"]
        if isinstance(sched, str):
            sched_dt = datetime.fromisoformat(sched.replace("Z", "+00:00"))
        else:
            sched_dt = sched
        delta = (sched_dt - datetime.now(timezone.utc)).total_seconds() / 60
        assert 25 < delta < 40, f"expected ~30 min in future, got {delta} min"
        new_cb_id = new_cb["callback_id"]

        # 2c. Verify original marked done + has last_call_outcome_id
        # need include_done=true because default list filters out done callbacks
        r = requests.get(f"{API}/callbacks", params={"include_done": "true"}, headers=owner_h)
        assert r.status_code == 200
        items = r.json().get("items", [])
        original = next((c for c in items if c["callback_id"] == cb_id), None)
        assert original is not None, f"original callback {cb_id} not found among {[c['callback_id'] for c in items]}"
        assert original.get("done") is True
        assert original.get("last_call_outcome_id") == "call_no_answer"

        # 2d. Log another call: call_ok, no reschedule → new_callback: null
        r = requests.post(
            f"{API}/calls/log",
            json={
                "callback_id": new_cb_id,
                "phone": "+390000000001",
                "outcome_id": "call_ok",
                "note": "TEST_ ok",
            },
            headers=owner_h,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "log" in data
        assert data.get("new_callback") is None

        # cleanup
        for _id in [cb_id, new_cb_id]:
            requests.delete(f"{API}/callbacks/{_id}", headers=owner_h)


# ---------- 3. Free Sempre lifecycle ----------
class TestFreeSempre:
    _created_user_id = None
    _invite_token = None
    _invite_token_email = None

    def test_00_create_invite_and_register(self, owner_h):
        # a. Create invite
        r = requests.post(f"{API}/invites", json={"trial_days": 30, "note": "TEST_v20"}, headers=owner_h)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert "invite_token" in inv
        TestFreeSempre._invite_token = inv["invite_token"]

        # b. Register via token
        unique = int(time.time())
        email = f"TEST_v20_invitee_{unique}@example.com"
        TestFreeSempre._invite_token_email = email
        r = requests.post(
            f"{API}/invites/{TestFreeSempre._invite_token}/register",
            json={"email": email, "password": "Passw0rd!", "name": "TEST V20"},
        )
        assert r.status_code == 200, r.text
        reg = r.json()
        assert reg["subscription"]["status"] == "trial"
        days_left = reg["subscription"]["days_left"]
        assert 28 <= days_left <= 30, f"expected ~30 days trial, got {days_left}"
        TestFreeSempre._created_user_id = reg["user"]["user_id"]

    def test_01_set_free_forever(self, owner_h):
        uid = TestFreeSempre._created_user_id
        assert uid, "invite/register must run first"
        r = requests.put(f"{API}/users/{uid}/free-forever", headers=owner_h)
        assert r.status_code == 200, r.text
        sub = r.json()["subscription"]
        assert sub["status"] == "free_forever"
        assert sub["days_left"] is None
        assert sub["is_active"] is True

    def test_02_get_invites_shows_free_forever(self, owner_h):
        uid = TestFreeSempre._created_user_id
        r = requests.get(f"{API}/invites", headers=owner_h)
        assert r.status_code == 200
        items = r.json().get("items", [])
        match = next((i for i in items if (i.get("invited_user") or {}).get("user_id") == uid), None)
        assert match is not None, "invited_user block missing"
        assert match["invited_user"]["subscription"]["status"] == "free_forever"

    def test_03_revoke_to_trial(self, owner_h):
        uid = TestFreeSempre._created_user_id
        r = requests.put(
            f"{API}/users/{uid}/revoke-free-forever",
            json={"mode": "trial", "trial_days": 15},
            headers=owner_h,
        )
        assert r.status_code == 200, r.text
        sub = r.json()["subscription"]
        assert sub["status"] == "trial"
        assert 13 <= sub["days_left"] <= 15, f"expected ~14-15, got {sub['days_left']}"

    def test_04_revoke_to_expired(self, owner_h):
        uid = TestFreeSempre._created_user_id
        # First re-set free_forever to test transition from free_forever -> expired
        r = requests.put(f"{API}/users/{uid}/free-forever", headers=owner_h)
        assert r.status_code == 200
        r = requests.put(
            f"{API}/users/{uid}/revoke-free-forever",
            json={"mode": "expired"},
            headers=owner_h,
        )
        assert r.status_code == 200, r.text
        sub = r.json()["subscription"]
        assert sub["status"] == "expired"
        assert sub["is_active"] is False

    def test_05_non_owner_forbidden(self, sub_h):
        uid = TestFreeSempre._created_user_id
        r = requests.put(f"{API}/users/{uid}/free-forever", headers=sub_h)
        assert r.status_code == 403
        r = requests.put(
            f"{API}/users/{uid}/revoke-free-forever",
            json={"mode": "trial"},
            headers=sub_h,
        )
        assert r.status_code == 403

    def test_06_user_not_invited_by_caller_404(self, owner_h):
        # Bogus user id -> 404
        r = requests.put(f"{API}/users/user_doesnotexist/free-forever", headers=owner_h)
        assert r.status_code == 404
        r = requests.put(
            f"{API}/users/user_doesnotexist/revoke-free-forever",
            json={"mode": "trial"},
            headers=owner_h,
        )
        assert r.status_code == 404

    def test_99_cleanup(self, owner_h):
        # Delete the test user and invite via direct DB is not available, but we can:
        # - delete the invite endpoint (invite is already used, but endpoint still deletes doc)
        # - user itself cannot be deleted via API; leave a marker (email prefix TEST_)
        tok = TestFreeSempre._invite_token
        if tok:
            r = requests.delete(f"{API}/invites/{tok}", headers=owner_h)
            # 200 or 404 ok
            assert r.status_code in (200, 204, 404)
        # Attempt to remove the test user directly through mongo if accessible
        try:
            from motor.motor_asyncio import AsyncIOMotorClient  # noqa: F401
            import asyncio
            from pymongo import MongoClient
            mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db_name = os.environ.get("DB_NAME", "test_database")
            mc[db_name].users.delete_one({"user_id": TestFreeSempre._created_user_id})
        except Exception:
            pass


# ---------- 4. Appointment note_attachments ----------
class TestAppointmentAttachments:
    def test_create_and_clear_attachments(self, owner_h):
        # 1x1 PNG base64 (valid data URI)
        png = (
            "data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        start = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        payload = {
            "title": "TEST_v20_appt",
            "area": "energy",
            "start_at": start,
            "duration_min": 30,
            "notes": "test attach",
            "note_attachments": [
                {"id": "a1", "kind": "photo", "photo_base64": png},
                {"id": "a2", "kind": "text", "text": "quick note"},
            ],
        }
        r = requests.post(f"{API}/appointments", json=payload, headers=owner_h)
        assert r.status_code == 200, r.text
        appt = r.json()
        apt_id = appt.get("appointment_id") or appt.get("id")
        assert apt_id, f"no appointment_id in response: {appt}"

        # GET back
        r = requests.get(f"{API}/appointments/{apt_id}", headers=owner_h)
        assert r.status_code == 200
        appt2 = r.json()
        attach = appt2.get("note_attachments") or []
        assert len(attach) == 2, f"expected 2 attachments got {attach}"
        ids = {a["id"] for a in attach}
        assert ids == {"a1", "a2"}
        # Check photo base64 preserved
        photo = next(a for a in attach if a["id"] == "a1")
        assert "iVBOR" in (photo.get("photo_base64") or "")

        # PUT clear
        r = requests.put(f"{API}/appointments/{apt_id}", json={"note_attachments": []}, headers=owner_h)
        assert r.status_code == 200, r.text

        r = requests.get(f"{API}/appointments/{apt_id}", headers=owner_h)
        assert r.status_code == 200
        assert r.json().get("note_attachments") == []

        # cleanup
        requests.delete(f"{API}/appointments/{apt_id}", headers=owner_h)


# ---------- 5. Settings default palette + hex accept ----------
class TestSettingsPalette:
    def test_get_settings_has_colors(self, owner_h):
        r = requests.get(f"{API}/settings", headers=owner_h)
        assert r.status_code == 200
        s = r.json()
        assert "energy_color" in s
        assert "network_color" in s
        assert isinstance(s["energy_color"], str)
        assert isinstance(s["network_color"], str)
        # Save originals for restore
        TestSettingsPalette._orig_energy = s["energy_color"]
        TestSettingsPalette._orig_network = s["network_color"]

    def test_put_settings_accepts_hex(self, owner_h):
        r = requests.put(
            f"{API}/settings",
            json={"energy_color": "#FF00AA"},
            headers=owner_h,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["energy_color"] == "#FF00AA"

    def test_restore_settings(self, owner_h):
        # restore originals
        payload = {
            "energy_color": TestSettingsPalette._orig_energy,
            "network_color": TestSettingsPalette._orig_network,
        }
        r = requests.put(f"{API}/settings", json=payload, headers=owner_h)
        assert r.status_code == 200


# ---------- 6. Call outcomes seed ----------
class TestCallOutcomesSeed:
    def test_settings_has_6_default_outcomes(self, owner_h):
        r = requests.get(f"{API}/settings", headers=owner_h)
        assert r.status_code == 200
        s = r.json()
        outcomes = s.get("call_outcomes") or []
        assert len(outcomes) >= 6, f"expected >=6 outcomes, got {len(outcomes)}"
        ids = {o["id"] for o in outcomes}
        expected = {"call_ok", "call_no_answer", "call_recall", "call_wrong_number", "call_busy", "call_not_interested"}
        assert expected.issubset(ids), f"missing outcomes: {expected - ids}"
