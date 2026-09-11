"""
Backend tests — Corporate Gym Blocco 3: Master Assignments (piani).

Endpoints under test:
- POST   /api/cgym/assignments
- GET    /api/cgym/assignments
- DELETE /api/cgym/assignments/{id}
Regression:
- GET  /api/cgym/summary (assigned_* fields)
- GET  /api/cgym/sessions
- GET  /api/cgym/team-overview
- POST /api/cgym/roleplay/start
"""
import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import requests

BASE_URL = "https://business-card-pro-16.preview.emergentagent.com/api"
ROME = ZoneInfo("Europe/Rome")

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
MEMBER = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, f"owner login: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def member_token():
    r = requests.post(f"{BASE_URL}/auth/login", json=MEMBER, timeout=30)
    assert r.status_code == 200, f"member login: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_me(owner_token):
    r = requests.get(f"{BASE_URL}/auth/me", headers=_auth(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return data.get("user") or data


@pytest.fixture(scope="module")
def member_me(member_token):
    r = requests.get(f"{BASE_URL}/auth/me", headers=_auth(member_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return data.get("user") or data


# --------- module-level cleanup ----------
_created_assignments = []  # list[(assignment_id, owner_token)]
_created_sessions = []     # list[(session_id, owner_token)] — leftover completed sessions to delete


@pytest.fixture(scope="module", autouse=True)
def _cleanup(owner_token):
    yield
    # first delete assignments (removes non-completed sessions)
    for aid, tok in _created_assignments:
        try:
            requests.delete(f"{BASE_URL}/cgym/assignments/{aid}", headers=_auth(tok), timeout=20)
        except Exception:
            pass
    # then delete any leftover (completed) sessions we tracked
    for sid, tok in _created_sessions:
        try:
            requests.delete(f"{BASE_URL}/cgym/sessions/{sid}", headers=_auth(tok), timeout=20)
        except Exception:
            pass


def _due(days_ahead: int) -> str:
    today_rome = datetime.now(tz=ROME).date()
    return (today_rome + timedelta(days=days_ahead)).isoformat()


# =========================================================================
# 1) POST /api/cgym/assignments — validation + creation
# =========================================================================
class TestCreateAssignment:
    def test_create_users_target_generates_correct_sessions(self, owner_token, owner_me, member_me):
        sub_id = member_me["user_id"]
        owner_id = owner_me["user_id"]
        payload = {
            "target": "users",
            "user_ids": [sub_id],
            "type": "winwin",
            "per_day": 2,
            "due_date": _due(2),
        }
        r = requests.post(f"{BASE_URL}/cgym/assignments", headers=_auth(owner_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        aid = d.get("assignment_id")
        assert aid, "assignment_id missing"
        _created_assignments.append((aid, owner_token))

        # 1 user * 3 days (today + 2) * 2 slots = 6
        assert d.get("sessions_total") == 6, f"expected 6 sessions, got {d.get('sessions_total')}"
        assert d.get("sessions_done") == 0
        assert d.get("type") == "winwin"
        assert d.get("per_day") == 2
        assert d.get("user_ids") == [sub_id]

        # verify sessions visible for sub with correct fields
        rs = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth_of_member(), timeout=20)
        assert rs.status_code == 200, rs.text
        items = [it for it in rs.json()["items"] if it.get("assignment_id") == aid]
        assert len(items) == 6, f"sub sees {len(items)} sessions for this plan, expected 6"

        # Every session: mandatory=True, status=assegnata, assigned_by=owner, type=winwin
        for it in items:
            assert it["mandatory"] is True
            assert it["status"] == "assegnata"
            assert it["assigned_by"] == owner_id
            assert it["type"] == "winwin"
            assert it["user_id"] == sub_id

        # scheduled times: 09:00 and 15:00 Europe/Rome per each of the 3 days
        times_by_day = {}
        for it in items:
            dt_utc = datetime.fromisoformat(it["scheduled_at"].replace("Z", "+00:00"))
            local = dt_utc.astimezone(ROME)
            times_by_day.setdefault(local.date().isoformat(), []).append(local.strftime("%H:%M"))
        assert len(times_by_day) == 3, f"expected 3 days, got {len(times_by_day)}"
        for day, tms in times_by_day.items():
            assert sorted(tms) == ["09:00", "15:00"], f"day {day} slots wrong: {tms}"

        # keep session_id for later completata test
        pytest.v3_assignment_id = aid
        pytest.v3_first_sid = items[0]["session_id"]

    def test_create_team_target_excludes_creator(self, owner_token, owner_me):
        payload = {"target": "team", "type": "obiezioni", "per_day": 1, "due_date": _due(0)}
        r = requests.post(f"{BASE_URL}/cgym/assignments", headers=_auth(owner_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        aid = d["assignment_id"]
        _created_assignments.append((aid, owner_token))
        # creator excluded → owner user_id must not be in user_ids
        assert owner_me["user_id"] not in (d.get("user_ids") or []), "creator must be excluded from team target"
        # sessions_total = N_members_ex_creator * 1 day * 1 slot
        assert d["sessions_total"] == len(d["user_ids"]) * 1, "team sessions_total mismatch"
        assert d["sessions_total"] >= 1, "at least sub should be included"

    def test_validation_per_day_5(self, owner_token, member_me):
        r = requests.post(f"{BASE_URL}/cgym/assignments", headers=_auth(owner_token),
                          json={"target": "users", "user_ids": [member_me["user_id"]],
                                "type": "winwin", "per_day": 5, "due_date": _due(1)}, timeout=15)
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text}"

    def test_validation_due_date_past(self, owner_token, member_me):
        r = requests.post(f"{BASE_URL}/cgym/assignments", headers=_auth(owner_token),
                          json={"target": "users", "user_ids": [member_me["user_id"]],
                                "type": "winwin", "per_day": 1, "due_date": "2020-01-01"}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_validation_due_date_malformed(self, owner_token, member_me):
        r = requests.post(f"{BASE_URL}/cgym/assignments", headers=_auth(owner_token),
                          json={"target": "users", "user_ids": [member_me["user_id"]],
                                "type": "winwin", "per_day": 1, "due_date": "not-a-date"}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_validation_unknown_user_id(self, owner_token):
        r = requests.post(f"{BASE_URL}/cgym/assignments", headers=_auth(owner_token),
                          json={"target": "users", "user_ids": ["unknown-user-xyz-9999"],
                                "type": "winwin", "per_day": 1, "due_date": _due(1)}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_member_forbidden(self, member_token, member_me):
        r = requests.post(f"{BASE_URL}/cgym/assignments", headers=_auth(member_token),
                          json={"target": "users", "user_ids": [member_me["user_id"]],
                                "type": "winwin", "per_day": 1, "due_date": _due(1)}, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


# helper accessing member_token globally via pytest cache — set on first fixture call
def _auth_of_member():
    tok = getattr(pytest, "_member_tok_cache", None)
    if tok is None:
        r = requests.post(f"{BASE_URL}/auth/login", json=MEMBER, timeout=30)
        r.raise_for_status()
        tok = r.json()["token"]
        pytest._member_tok_cache = tok
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# =========================================================================
# 2) GET /api/cgym/assignments — list + progress
# =========================================================================
class TestListAssignments:
    def test_owner_list_contains_plan_with_progress(self, owner_token, member_me):
        r = requests.get(f"{BASE_URL}/cgym/assignments", headers=_auth(owner_token), timeout=20)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        aid = pytest.v3_assignment_id
        plan = next((p for p in items if p["assignment_id"] == aid), None)
        assert plan is not None, "plan not in list"
        assert plan["sessions_total"] == 6
        assert plan["sessions_done"] == 0
        assert plan["overdue"] is False
        pu = plan["per_user"]
        assert isinstance(pu, list) and len(pu) == 1
        entry = pu[0]
        assert entry["user_id"] == member_me["user_id"]
        assert entry["total"] == 6
        assert entry["done"] == 0
        assert "name" in entry

    def test_member_forbidden(self, member_token):
        r = requests.get(f"{BASE_URL}/cgym/assignments", headers=_auth(member_token), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_progress_updates_after_sub_completes(self, owner_token, member_token, member_me):
        sid = pytest.v3_first_sid
        # sub PATCHes to completata
        r = requests.patch(f"{BASE_URL}/cgym/sessions/{sid}", headers=_auth(member_token),
                           json={"status": "completata", "score": 80}, timeout=15)
        assert r.status_code == 200, r.text
        # track as leftover to clean since delete assignment won't remove completed
        _created_sessions.append((sid, owner_token))

        # owner list reflects done=1
        r2 = requests.get(f"{BASE_URL}/cgym/assignments", headers=_auth(owner_token), timeout=20)
        assert r2.status_code == 200
        plan = next(p for p in r2.json()["items"] if p["assignment_id"] == pytest.v3_assignment_id)
        assert plan["sessions_done"] == 1, f"sessions_done expected 1, got {plan['sessions_done']}"
        assert plan["per_user"][0]["done"] == 1


# =========================================================================
# 3) GET /api/cgym/summary — sub view
# =========================================================================
class TestSubSummary:
    def test_sub_summary_reflects_plan(self, member_token):
        r = requests.get(f"{BASE_URL}/cgym/summary", headers=_auth(member_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        # after completing 1 of 6: assigned_total >=6, assigned_done >=1
        assert d.get("assigned_total", 0) >= 6, f"assigned_total {d.get('assigned_total')}"
        assert d.get("assigned_done", 0) >= 1, f"assigned_done {d.get('assigned_done')}"
        assert d.get("assigned_pending", 0) == d["assigned_total"] - d["assigned_done"]
        # mandatory_pending must reflect unfinished mandatory sessions
        assert d.get("mandatory_pending", 0) >= 5, f"mandatory_pending {d.get('mandatory_pending')}"


# =========================================================================
# 4) DELETE /api/cgym/assignments/{id}
# =========================================================================
class TestDeleteAssignment:
    def test_member_forbidden(self, member_token):
        aid = pytest.v3_assignment_id
        r = requests.delete(f"{BASE_URL}/cgym/assignments/{aid}", headers=_auth(member_token), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_unknown_id_404(self, owner_token):
        r = requests.delete(f"{BASE_URL}/cgym/assignments/nonexistent-xyz-123",
                            headers=_auth(owner_token), timeout=15)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"

    def test_delete_only_removes_non_completed(self, owner_token, member_token):
        aid = pytest.v3_assignment_id
        completed_sid = pytest.v3_first_sid
        r = requests.delete(f"{BASE_URL}/cgym/assignments/{aid}", headers=_auth(owner_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        # 6 total, 1 completed → 5 deleted
        assert d.get("deleted_sessions") == 5, f"deleted_sessions expected 5, got {d.get('deleted_sessions')}"

        # remove from cleanup list (already deleted)
        for i, (a, _) in enumerate(list(_created_assignments)):
            if a == aid:
                _created_assignments.pop(i)
                break

        # completed session still exists (view via sub)
        rs = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(member_token), timeout=20)
        assert rs.status_code == 200
        found = next((it for it in rs.json()["items"] if it["session_id"] == completed_sid), None)
        assert found is not None, "completed session must remain after plan delete"
        assert found["status"] == "completata"

        # owner cleans it up
        rd = requests.delete(f"{BASE_URL}/cgym/sessions/{completed_sid}",
                             headers=_auth(owner_token), timeout=15)
        assert rd.status_code == 200
        # remove tracking
        for i, (s, _) in enumerate(list(_created_sessions)):
            if s == completed_sid:
                _created_sessions.pop(i)
                break


# =========================================================================
# 5) Regression: Blocco 1/2 endpoints still work
# =========================================================================
class TestRegression:
    def test_sessions_list(self, owner_token):
        r = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        assert "items" in r.json()

    def test_team_overview_owner(self, owner_token):
        r = requests.get(f"{BASE_URL}/cgym/team-overview", headers=_auth(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        assert "items" in r.json()

    def test_team_overview_member_forbidden(self, member_token):
        r = requests.get(f"{BASE_URL}/cgym/team-overview", headers=_auth(member_token), timeout=15)
        assert r.status_code == 403

    def test_roleplay_start_no_tts(self, owner_token):
        r = requests.post(f"{BASE_URL}/cgym/roleplay/start", headers=_auth(owner_token),
                          json={"tts": False}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("roleplay_id")
        assert isinstance(d.get("reply"), str) and d["reply"]
        assert d.get("turn") == 0
        assert d.get("ended") is False
