"""Backend tests for the Team Calendar endpoints (V38Y).

Endpoints under test:
  - GET /api/calendar/team-members
  - GET /api/calendar/team

Privacy rule: for events not owned by caller, sensitive fields must be redacted.
"""
import os
import re
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"
SUB_EMAIL = "sub1@dalpastro.it"
SUB_PASSWORD = "Sub12345!"

HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


# ---------- Fixtures / helpers ----------
def _login(email: str, password: str) -> dict:
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data, f"Unexpected login response: {data}"
    return data


@pytest.fixture(scope="module")
def owner_session():
    d = _login(OWNER_EMAIL, OWNER_PASSWORD)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"})
    s.user = d["user"]  # type: ignore[attr-defined]
    return s


@pytest.fixture(scope="module")
def sub_session():
    d = _login(SUB_EMAIL, SUB_PASSWORD)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"})
    s.user = d["user"]  # type: ignore[attr-defined]
    return s


@pytest.fixture(scope="module")
def seeded_appointments(owner_session, sub_session):
    """Create two owner appointments + one sub-user appointment. Cleanup at end."""
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)
    owner_start = tomorrow.replace(hour=10, minute=0, second=0)
    sub_start = tomorrow.replace(hour=14, minute=0, second=0)

    ids = {"owner": [], "sub": []}

    owner_payload = {
        "title": "OWNER_APPT_TEST",
        "area": "energy",
        "start_at": owner_start.isoformat(),
        "duration_min": 60,
        "location": "Milano Office",
        "notes": "Private owner notes",
    }
    r = owner_session.post(f"{BASE_URL}/appointments", json=owner_payload, timeout=30)
    assert r.status_code in (200, 201), f"owner create failed: {r.status_code} {r.text}"
    body = r.json()
    ids["owner"].append(body.get("appointment_id") or body.get("id"))

    sub_payload = {
        "title": "SUBUSER_APPT_TEST",
        "area": "network",
        "start_at": sub_start.isoformat(),
        "duration_min": 60,
        "location": "Roma",
        "notes": "Private sub notes",
    }
    r = sub_session.post(f"{BASE_URL}/appointments", json=sub_payload, timeout=30)
    assert r.status_code in (200, 201), f"sub create failed: {r.status_code} {r.text}"
    body = r.json()
    ids["sub"].append(body.get("appointment_id") or body.get("id"))

    yield ids

    # Cleanup - each user deletes their own appointments
    for aid in ids["owner"]:
        if aid:
            try:
                owner_session.delete(f"{BASE_URL}/appointments/{aid}", timeout=15)
            except Exception:
                pass
    for aid in ids["sub"]:
        if aid:
            try:
                sub_session.delete(f"{BASE_URL}/appointments/{aid}", timeout=15)
            except Exception:
                pass


# ---------- Tests: /calendar/team-members ----------
class TestTeamMembers:
    def test_owner_team_members(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/calendar/team-members", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)
        items = data["items"]
        assert len(items) >= 2, f"Expected >=2 members (owner + sub), got {len(items)}"

        # Every item has a valid hex color
        for it in items:
            assert HEX_RE.match(it.get("color") or ""), f"Bad color: {it}"

        # First item must be me
        assert items[0]["is_me"] is True, f"First not me: {items[0]}"

        # Owner should be flagged is_owner=true and is_me=true (owner is caller)
        owner_entry = next(it for it in items if it["email"] == OWNER_EMAIL)
        assert owner_entry["is_owner"] is True
        assert owner_entry["is_me"] is True

        # Sub-user present
        sub_entry = next((it for it in items if it["email"] == SUB_EMAIL), None)
        assert sub_entry is not None, "sub1 not in owner's team-members list"
        assert sub_entry["is_me"] is False
        assert sub_entry["is_owner"] is False

    def test_subuser_team_members(self, sub_session):
        r = sub_session.get(f"{BASE_URL}/calendar/team-members", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        items = r.json()["items"]
        # Owner (test@dalpastro.it) present with is_owner=true
        owner_entry = next((it for it in items if it["email"] == OWNER_EMAIL), None)
        assert owner_entry is not None, "Owner not in sub-user team list"
        assert owner_entry["is_owner"] is True
        assert owner_entry["is_me"] is False
        # Current user (sub) flagged is_me
        me = next(it for it in items if it["email"] == SUB_EMAIL)
        assert me["is_me"] is True
        assert me["is_owner"] is False
        # Me first
        assert items[0]["is_me"] is True

    def test_team_members_requires_auth(self):
        r = requests.get(f"{BASE_URL}/calendar/team-members", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"


# ---------- Tests: /calendar/team ----------
class TestTeamCalendar:
    def _range(self):
        start = (datetime.now(timezone.utc) - timedelta(days=1)).replace(microsecond=0)
        end = (datetime.now(timezone.utc) + timedelta(days=8)).replace(microsecond=0)
        return start.isoformat(), end.isoformat()

    def _find(self, items, title):
        return next((it for it in items if it.get("title") == title), None)

    def test_owner_sees_both_events_privacy_applied(self, owner_session, seeded_appointments):
        start, end = self._range()
        r = owner_session.get(f"{BASE_URL}/calendar/team", params={"start": start, "end": end}, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        items = r.json()["items"]

        owner_appt = self._find(items, "OWNER_APPT_TEST")
        sub_appt = self._find(items, "SUBUSER_APPT_TEST")
        assert owner_appt is not None, "OWNER_APPT_TEST missing"
        assert sub_appt is not None, "SUBUSER_APPT_TEST missing (owner should see team events)"

        # Owner's own event: full detail
        assert owner_appt["is_mine"] is True
        assert owner_appt["read_only"] is False
        assert owner_appt["location"] == "Milano Office"
        assert owner_appt["notes"] == "Private owner notes"
        assert HEX_RE.match(owner_appt["created_by_color"] or "")
        assert owner_appt["created_by_name"]

        # Sub-user event as seen by owner: REDACTED (privacy)
        assert sub_appt["is_mine"] is False
        assert sub_appt["read_only"] is True
        assert sub_appt["location"] == ""
        assert sub_appt["notes"] == ""
        assert sub_appt["contact_id"] is None
        assert sub_appt["phone_mobile"] == ""
        assert sub_appt["phone_work"] == ""
        assert HEX_RE.match(sub_appt["created_by_color"] or "")
        assert sub_appt["created_by_name"]

    def test_subuser_sees_both_events_owner_redacted(self, sub_session, seeded_appointments):
        start, end = self._range()
        r = sub_session.get(f"{BASE_URL}/calendar/team", params={"start": start, "end": end}, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        items = r.json()["items"]

        owner_appt = self._find(items, "OWNER_APPT_TEST")
        sub_appt = self._find(items, "SUBUSER_APPT_TEST")
        assert owner_appt is not None
        assert sub_appt is not None

        # Sub-user own event: full detail
        assert sub_appt["is_mine"] is True
        assert sub_appt["read_only"] is False
        assert sub_appt["location"] == "Roma"
        assert sub_appt["notes"] == "Private sub notes"

        # Owner event REDACTED for sub-user (critical privacy check)
        assert owner_appt["is_mine"] is False
        assert owner_appt["read_only"] is True
        assert owner_appt["location"] == ""
        assert owner_appt["notes"] == ""
        assert owner_appt["contact_id"] is None

    def test_filter_user_ids_owner_only(self, owner_session, seeded_appointments):
        start, end = self._range()
        owner_uid = owner_session.user["user_id"]  # type: ignore[attr-defined]
        r = owner_session.get(
            f"{BASE_URL}/calendar/team",
            params={"start": start, "end": end, "user_ids": owner_uid},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        titles = [it["title"] for it in items]
        assert "OWNER_APPT_TEST" in titles, f"Owner appt missing: {titles}"
        assert "SUBUSER_APPT_TEST" not in titles, f"Sub appt should be filtered out: {titles}"
        for it in items:
            assert it["created_by"] == owner_uid

    def test_filter_foreign_user_id_silent(self, owner_session, seeded_appointments):
        start, end = self._range()
        r = owner_session.get(
            f"{BASE_URL}/calendar/team",
            params={"start": start, "end": end, "user_ids": "fakeuser_xyz"},
            timeout=30,
        )
        # Must not 4xx/5xx
        assert r.status_code == 200, f"Expected 200 (silent drop), got {r.status_code}: {r.text}"
        items = r.json()["items"]
        # Foreign user_id should silently return empty (no leakage)
        assert items == [], f"Expected empty for foreign user, got {len(items)} items"

    def test_filter_area_energy(self, owner_session, seeded_appointments):
        start, end = self._range()
        r = owner_session.get(
            f"{BASE_URL}/calendar/team",
            params={"start": start, "end": end, "area": "energy"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        for it in items:
            assert it["area"] == "energy", f"Non-energy leaked: {it}"
        titles = [it["title"] for it in items]
        assert "OWNER_APPT_TEST" in titles
        assert "SUBUSER_APPT_TEST" not in titles

    def test_team_calendar_requires_auth(self):
        r = requests.get(f"{BASE_URL}/calendar/team", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"
