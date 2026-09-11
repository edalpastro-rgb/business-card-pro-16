# Corporate Gym (cgym) — Blocco 1 backend tests
import os
import time
from datetime import datetime, timedelta, timezone
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
MEMBER = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


def _login(cred):
    r = requests.post(f"{API}/auth/login", json=cred, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["user"]


@pytest.fixture(scope="module")
def owner_ctx():
    tok, u = _login(OWNER)
    return {"headers": {"Authorization": f"Bearer {tok}"}, "user": u, "created": []}


@pytest.fixture(scope="module")
def member_ctx():
    tok, u = _login(MEMBER)
    return {"headers": {"Authorization": f"Bearer {tok}"}, "user": u, "created": []}


def _iso_in(minutes=60):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


# ---------------- Auth / basic ----------------
class TestAuth:
    def test_owner_login(self, owner_ctx):
        assert owner_ctx["user"].get("email") == OWNER["email"]

    def test_member_login(self, member_ctx):
        assert member_ctx["user"].get("email") == MEMBER["email"]


# ---------------- GET /cgym/sessions ----------------
class TestListSessions:
    def test_scope_mine_default_owner(self, owner_ctx):
        r = requests.get(f"{API}/cgym/sessions", headers=owner_ctx["headers"], timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json().get("items"), list)

    def test_scope_mine_default_member(self, member_ctx):
        r = requests.get(f"{API}/cgym/sessions", headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 200

    def test_scope_team_owner_ok(self, owner_ctx):
        r = requests.get(f"{API}/cgym/sessions", params={"scope": "team"}, headers=owner_ctx["headers"], timeout=30)
        assert r.status_code == 200

    def test_scope_team_member_forbidden(self, member_ctx):
        r = requests.get(f"{API}/cgym/sessions", params={"scope": "team"}, headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 403


# ---------------- POST /cgym/sessions ----------------
class TestCreateSession:
    def test_member_self_assign_ok(self, member_ctx):
        payload = {"type": "obiezioni", "scheduled_at": _iso_in(120), "title": "TEST_member_self", "mandatory": False}
        r = requests.post(f"{API}/cgym/sessions", json=payload, headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["type"] == "obiezioni"
        assert j["status"] == "assegnata"
        assert j["user_id"] == member_ctx["user"]["user_id"]
        member_ctx["created"].append(j["session_id"])

    def test_member_assign_to_other_forbidden(self, member_ctx, owner_ctx):
        payload = {"type": "winwin", "scheduled_at": _iso_in(120), "user_id": owner_ctx["user"]["user_id"]}
        r = requests.post(f"{API}/cgym/sessions", json=payload, headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 403

    def test_owner_assign_to_sub_ok(self, owner_ctx, member_ctx):
        payload = {"type": "winwin", "scheduled_at": _iso_in(180), "user_id": member_ctx["user"]["user_id"], "title": "TEST_owner_assigned", "mandatory": True}
        r = requests.post(f"{API}/cgym/sessions", json=payload, headers=owner_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["user_id"] == member_ctx["user"]["user_id"]
        assert j["assigned_by"] == owner_ctx["user"]["user_id"]
        assert j["mandatory"] is True
        owner_ctx["created"].append(j["session_id"])

    def test_invalid_scheduled_at(self, owner_ctx):
        payload = {"type": "obiezioni", "scheduled_at": "not-a-date"}
        r = requests.post(f"{API}/cgym/sessions", json=payload, headers=owner_ctx["headers"], timeout=30)
        assert r.status_code == 400

    def test_user_not_in_tenant(self, owner_ctx):
        payload = {"type": "obiezioni", "scheduled_at": _iso_in(120), "user_id": "not-a-real-user-id-xyz"}
        r = requests.post(f"{API}/cgym/sessions", json=payload, headers=owner_ctx["headers"], timeout=30)
        assert r.status_code == 400


# ---------------- PATCH /cgym/sessions/{id} ----------------
class TestUpdateSession:
    def test_assignee_complete_ok(self, member_ctx):
        # Create own
        payload = {"type": "obiezioni", "scheduled_at": _iso_in(60), "title": "TEST_patch_complete"}
        c = requests.post(f"{API}/cgym/sessions", json=payload, headers=member_ctx["headers"], timeout=30).json()
        sid = c["session_id"]
        member_ctx["created"].append(sid)
        r = requests.patch(f"{API}/cgym/sessions/{sid}", json={"status": "completata", "score": 8.5}, headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "completata"
        assert j["score"] == 8.5
        assert j.get("completed_at") is not None

    def test_member_cannot_patch_others_session(self, owner_ctx, member_ctx):
        # Owner creates one for themselves
        payload = {"type": "obiezioni", "scheduled_at": _iso_in(60), "title": "TEST_owner_own"}
        c = requests.post(f"{API}/cgym/sessions", json=payload, headers=owner_ctx["headers"], timeout=30).json()
        sid = c["session_id"]
        owner_ctx["created"].append(sid)
        r = requests.patch(f"{API}/cgym/sessions/{sid}", json={"status": "completata"}, headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 403


# ---------------- DELETE ----------------
class TestDeleteSession:
    def test_owner_delete_ok(self, owner_ctx):
        payload = {"type": "winwin", "scheduled_at": _iso_in(60), "title": "TEST_owner_del"}
        c = requests.post(f"{API}/cgym/sessions", json=payload, headers=owner_ctx["headers"], timeout=30).json()
        sid = c["session_id"]
        r = requests.delete(f"{API}/cgym/sessions/{sid}", headers=owner_ctx["headers"], timeout=30)
        assert r.status_code == 200
        # verify 404 on GET now — via list scope=mine
        lr = requests.get(f"{API}/cgym/sessions", headers=owner_ctx["headers"], timeout=30).json()
        assert sid not in [i["session_id"] for i in lr["items"]]

    def test_member_delete_own_self_created_ok(self, member_ctx):
        payload = {"type": "obiezioni", "scheduled_at": _iso_in(60), "title": "TEST_mem_own_del"}
        c = requests.post(f"{API}/cgym/sessions", json=payload, headers=member_ctx["headers"], timeout=30).json()
        sid = c["session_id"]
        r = requests.delete(f"{API}/cgym/sessions/{sid}", headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 200

    def test_member_cannot_delete_owner_assigned(self, owner_ctx, member_ctx):
        payload = {"type": "obiezioni", "scheduled_at": _iso_in(60), "user_id": member_ctx["user"]["user_id"], "title": "TEST_owner_assigned_del"}
        c = requests.post(f"{API}/cgym/sessions", json=payload, headers=owner_ctx["headers"], timeout=30).json()
        sid = c["session_id"]
        owner_ctx["created"].append(sid)
        r = requests.delete(f"{API}/cgym/sessions/{sid}", headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 403


# ---------------- GET /cgym/summary ----------------
class TestSummary:
    def test_summary_shape(self, member_ctx):
        # ensure at least one mandatory pending
        payload = {"type": "obiezioni", "scheduled_at": _iso_in(30), "title": "TEST_summary_mand", "mandatory": True}
        c = requests.post(f"{API}/cgym/sessions", json=payload, headers=member_ctx["headers"], timeout=30).json()
        member_ctx["created"].append(c["session_id"])
        r = requests.get(f"{API}/cgym/summary", headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 200
        j = r.json()
        for k in ("due_soon", "due_soon_count", "today_total", "today_done", "mandatory_pending", "overdue", "server_time"):
            assert k in j, f"missing key {k}"
        assert j["mandatory_pending"] >= 1


# ---------------- GET /cgym/team-overview ----------------
class TestTeamOverview:
    def test_owner_ok(self, owner_ctx):
        r = requests.get(f"{API}/cgym/team-overview", headers=owner_ctx["headers"], timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j.get("items"), list)
        # Should include per-member counts
        if j["items"]:
            for m in j["items"]:
                for k in ("user_id", "name", "assegnata", "in_corso", "completata", "mandatory_pending"):
                    assert k in m

    def test_member_forbidden(self, member_ctx):
        r = requests.get(f"{API}/cgym/team-overview", headers=member_ctx["headers"], timeout=30)
        assert r.status_code == 403


# ---------------- Dashboard widgets ----------------
class TestDashboardWidgets:
    def test_cgym_widget_listed(self, owner_ctx):
        r = requests.get(f"{API}/settings/dashboard-widgets", headers=owner_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        # Various shapes possible — look for id 'cgym'
        s = str(j)
        assert "cgym" in s.lower(), f"cgym widget not present in dashboard-widgets: {s[:400]}"


# ---------------- Cleanup ----------------
class TestCleanup:
    def test_cleanup(self, owner_ctx, member_ctx):
        # Delete everything created during the run
        for sid in owner_ctx.get("created", []):
            try:
                requests.delete(f"{API}/cgym/sessions/{sid}", headers=owner_ctx["headers"], timeout=15)
            except Exception:
                pass
        for sid in member_ctx.get("created", []):
            try:
                requests.delete(f"{API}/cgym/sessions/{sid}", headers=member_ctx["headers"], timeout=15)
            except Exception:
                pass
            # If member can't delete owner-assigned, owner should
            try:
                requests.delete(f"{API}/cgym/sessions/{sid}", headers=owner_ctx["headers"], timeout=15)
            except Exception:
                pass
