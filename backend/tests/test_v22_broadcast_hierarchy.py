"""V22 — Team Broadcast Events + Multi-level Admin Roles
Tests broadcast appointments (scope all/subtree/custom), role promotion/demotion,
nested hierarchy invites, and /api/team/hierarchy endpoint.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://contact-hub-italy.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB1 = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


# ---------- Fixtures ----------
def _login(session: requests.Session, creds: dict) -> dict:
    r = session.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed {creds['email']}: {r.status_code} {r.text}"
    body = r.json()
    assert "token" in body, f"No token in login response: {body}"
    return body


@pytest.fixture(scope="module")
def owner_ctx():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    body = _login(s, OWNER)
    token = body["token"]
    user = body["user"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return {"session": s, "user": user, "token": token}


@pytest.fixture(scope="module")
def sub1_ctx():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    body = _login(s, SUB1)
    token = body["token"]
    user = body["user"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return {"session": s, "user": user, "token": token}


@pytest.fixture(scope="module")
def sub1_id(owner_ctx):
    """Look up sub1's user_id from team roster."""
    r = owner_ctx["session"].get(f"{API}/team")
    assert r.status_code == 200, r.text
    members = r.json()
    if isinstance(members, dict):
        members = members.get("items", [])
    for m in members:
        if m.get("email", "").lower() == SUB1["email"].lower():
            return m["user_id"]
    pytest.fail(f"sub1 not found in team roster: {members}")


# ---------- Test 1: Broadcast Permissions ----------
class TestBroadcastPermissions:
    """Broadcast permission tests: owner can, member cannot; recipient read-only."""

    @pytest.fixture(scope="class")
    def broadcast_all_event(self, owner_ctx):
        """Owner creates broadcast_scope='all' event."""
        start = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        payload = {
            "title": f"TEST_broadcast_all_{uuid.uuid4().hex[:6]}",
            "area": "energy",
            "start_at": start,
            "duration_min": 60,
            "is_broadcast": True,
            "broadcast_scope": "all",
            "broadcast_notify_advance_min": 30,
        }
        r = owner_ctx["session"].post(f"{API}/appointments", json=payload)
        assert r.status_code == 200, f"Owner broadcast(all) failed: {r.status_code} {r.text}"
        data = r.json()
        yield data
        # Cleanup
        try:
            owner_ctx["session"].delete(f"{API}/appointments/{data['appointment_id']}")
        except Exception:
            pass

    def test_owner_broadcast_all_populates_recipients(self, broadcast_all_event, sub1_id):
        """Owner scope='all' → recipients include all sub-users, owner excluded."""
        a = broadcast_all_event
        assert a.get("is_broadcast") is True
        assert a.get("broadcast_scope") == "all"
        recipients = a.get("broadcast_to_user_ids") or []
        assert isinstance(recipients, list) and len(recipients) > 0, f"recipients empty: {a}"
        assert sub1_id in recipients, f"sub1 not in recipients: {recipients}"
        # owner should be excluded
        assert a.get("created_by") not in recipients

    def test_subuser_cannot_broadcast_all(self, sub1_ctx):
        start = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        payload = {
            "title": f"TEST_subuser_broadcast_all",
            "area": "network",
            "start_at": start,
            "duration_min": 60,
            "is_broadcast": True,
            "broadcast_scope": "all",
        }
        r = sub1_ctx["session"].post(f"{API}/appointments", json=payload)
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    def test_subuser_sees_broadcast_readonly(self, sub1_ctx, broadcast_all_event):
        start = (datetime.now(timezone.utc)).isoformat()
        end = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        r = sub1_ctx["session"].get(f"{API}/appointments", params={"start": start, "end": end})
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        found = next((it for it in items if it.get("appointment_id") == broadcast_all_event["appointment_id"]), None)
        assert found is not None, f"Broadcast event not visible to sub-user. IDs: {[i.get('appointment_id') for i in items]}"
        assert found.get("read_only") is True, f"read_only flag not True: {found}"

    def test_subuser_cannot_put_broadcast(self, sub1_ctx, broadcast_all_event):
        aid = broadcast_all_event["appointment_id"]
        r = sub1_ctx["session"].put(f"{API}/appointments/{aid}", json={"title": "TEST_hack"})
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        assert "sola lettura" in r.text.lower() or "broadcast" in r.text.lower()

    def test_subuser_cannot_delete_broadcast(self, sub1_ctx, broadcast_all_event):
        aid = broadcast_all_event["appointment_id"]
        r = sub1_ctx["session"].delete(f"{API}/appointments/{aid}")
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    def test_owner_can_put_own_broadcast(self, owner_ctx, broadcast_all_event):
        aid = broadcast_all_event["appointment_id"]
        r = owner_ctx["session"].put(f"{API}/appointments/{aid}", json={"title": "TEST_updated_broadcast"})
        assert r.status_code == 200, r.text
        assert r.json().get("title") == "TEST_updated_broadcast"


# ---------- Test 2: Broadcast Scopes ----------
class TestBroadcastScopes:
    def test_scope_subtree_owner(self, owner_ctx, sub1_id):
        """Owner subtree → all descendants; sub1 must be in the list."""
        start = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        payload = {
            "title": "TEST_broadcast_subtree",
            "area": "energy",
            "start_at": start,
            "duration_min": 30,
            "is_broadcast": True,
            "broadcast_scope": "subtree",
        }
        r = owner_ctx["session"].post(f"{API}/appointments", json=payload)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a.get("broadcast_scope") == "subtree"
        recipients = a.get("broadcast_to_user_ids") or []
        assert sub1_id in recipients, f"sub1 not in subtree recipients: {recipients}"
        # cleanup
        owner_ctx["session"].delete(f"{API}/appointments/{a['appointment_id']}")

    def test_scope_custom(self, owner_ctx, sub1_id):
        """Custom scope with single sub-user id."""
        start = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        payload = {
            "title": "TEST_broadcast_custom",
            "area": "network",
            "start_at": start,
            "duration_min": 30,
            "is_broadcast": True,
            "broadcast_scope": "custom",
            "broadcast_to_user_ids": [sub1_id],
        }
        r = owner_ctx["session"].post(f"{API}/appointments", json=payload)
        assert r.status_code == 200, r.text
        a = r.json()
        recipients = a.get("broadcast_to_user_ids") or []
        assert recipients == [sub1_id], f"Expected [{sub1_id}], got {recipients}"
        # cleanup
        owner_ctx["session"].delete(f"{API}/appointments/{a['appointment_id']}")


# ---------- Test 3: Role Promotion & Nested Hierarchy ----------
class TestRolePromotion:
    def test_owner_promotes_sub1_to_admin(self, owner_ctx, sub1_id):
        r = owner_ctx["session"].put(f"{API}/team/{sub1_id}/role", json={"role": "admin"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("role") == "admin"

    def test_admin_can_broadcast_subtree(self, sub1_id):
        """Sub1 (now admin) creates broadcast subtree — should succeed with empty recipients initially."""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        body = _login(s, SUB1)
        s.headers.update({"Authorization": f"Bearer {body['token']}"})
        start = (datetime.now(timezone.utc) + timedelta(days=4)).isoformat()
        payload = {
            "title": "TEST_admin_broadcast_subtree",
            "area": "network",
            "start_at": start,
            "duration_min": 30,
            "is_broadcast": True,
            "broadcast_scope": "subtree",
        }
        r = s.post(f"{API}/appointments", json=payload)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a.get("broadcast_scope") == "subtree"
        # cleanup
        s.delete(f"{API}/appointments/{a['appointment_id']}")

    def test_admin_cannot_broadcast_all(self):
        """Admin (not owner) cannot use scope='all'."""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        body = _login(s, SUB1)
        s.headers.update({"Authorization": f"Bearer {body['token']}"})
        start = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        payload = {
            "title": "TEST_admin_broadcast_all_denied",
            "area": "network",
            "start_at": start,
            "duration_min": 30,
            "is_broadcast": True,
            "broadcast_scope": "all",
        }
        r = s.post(f"{API}/appointments", json=payload)
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    def test_admin_can_invite_subuser_nested(self, owner_ctx, sub1_id):
        """Admin invites a sub-user; new user's parent_user_id = admin's user_id."""
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        body = _login(s, SUB1)
        s.headers.update({"Authorization": f"Bearer {body['token']}"})
        admin_uid = body["user"]["user_id"]
        assert admin_uid == sub1_id
        new_email = f"test_nested_{uuid.uuid4().hex[:6]}@dalpastro.it"
        payload = {
            "email": new_email,
            "name": "TEST_Nested_User",
            "password": "Nested123!",
            "areas": ["network"],
        }
        r = s.post(f"{API}/team", json=payload)
        assert r.status_code == 200, f"Admin invite failed: {r.status_code} {r.text}"
        new_user = r.json()
        assert new_user.get("parent_user_id") == admin_uid, (
            f"parent_user_id mismatch: {new_user.get('parent_user_id')} != {admin_uid}"
        )
        new_uid = new_user["user_id"]
        # Cleanup: owner deletes the new user (owner has authority)
        del_r = owner_ctx["session"].delete(f"{API}/team/{new_uid}")
        assert del_r.status_code == 200, f"Cleanup delete failed: {del_r.text}"

    def test_zzz_demote_sub1_back_to_member(self, owner_ctx, sub1_id):
        """Final cleanup step: sub1 back to member (test named zzz to run last within class)."""
        r = owner_ctx["session"].put(f"{API}/team/{sub1_id}/role", json={"role": "member"})
        assert r.status_code == 200, r.text
        assert r.json().get("role") == "member"


# ---------- Test 4: Hierarchy Endpoint ----------
class TestHierarchy:
    def test_get_team_hierarchy(self, owner_ctx):
        r = owner_ctx["session"].get(f"{API}/team/hierarchy")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "root" in data
        assert "flat" in data
        assert data["root"] is not None, "root should not be None"
        assert isinstance(data["root"].get("children"), list)
        assert isinstance(data["flat"], list)
        # Owner should be the root
        assert data["root"].get("role") == "owner" or data["root"].get("user_id") == owner_ctx["user"]["user_id"]
