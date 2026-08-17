"""
V24: Role-based contact visibility + assignment tests
Covers:
- Startup migration back-fill (assigned_to_user_id from created_by)
- Owner sees all contacts
- Member sees only self-assigned
- Group manager (admin non-owner) sees self+descendants+orphans
- Assignment permissions (owner / group manager / member)
- POST /api/contacts auto-assignment behavior
"""

import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PWD = "Test1234!"
SUB1_EMAIL = "sub1@dalpastro.it"
SUB1_PWD = "Sub12345!"


# ---------- fixtures ----------
def _login(email: str, pwd: str) -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    return data


@pytest.fixture(scope="module")
def owner_session():
    d = _login(OWNER_EMAIL, OWNER_PWD)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"})
    return {"session": s, "user": d["user"]}


@pytest.fixture(scope="module")
def sub1_session():
    d = _login(SUB1_EMAIL, SUB1_PWD)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"})
    return {"session": s, "user": d["user"]}


# List of contact_ids created by this test module to cleanup
CREATED_CIDS: list = []


@pytest.fixture(scope="module", autouse=True)
def cleanup(owner_session, sub1_session):
    yield
    # Ensure sub1 back to member
    try:
        sub1_uid = sub1_session["user"]["user_id"]
        owner_session["session"].put(
            f"{BASE_URL}/api/team/{sub1_uid}/role", json={"role": "member"}, timeout=10
        )
    except Exception:
        pass
    # Delete all test contacts we created
    for cid in CREATED_CIDS:
        try:
            owner_session["session"].delete(f"{BASE_URL}/api/contacts/{cid}", timeout=10)
        except Exception:
            pass


def _mk_contact(sess, first="TEST_V24", last=None, assigned=None, area="network"):
    payload = {
        "first_name": first,
        "last_name": last or f"C_{uuid.uuid4().hex[:6]}",
        "area": area,
        "source": "personal",
    }
    if assigned is not None:
        payload["assigned_to_user_id"] = assigned
    r = sess.post(f"{BASE_URL}/api/contacts", json=payload, timeout=15)
    assert r.status_code == 200, f"create contact failed: {r.status_code} {r.text}"
    c = r.json()
    CREATED_CIDS.append(c["contact_id"])
    return c


# ---------- Test 1: Login sanity ----------
class TestLogin:
    def test_owner_login(self, owner_session):
        assert owner_session["user"].get("role") == "owner"

    def test_sub1_login(self, sub1_session):
        # sub1 should be a non-owner (member or admin - starts as member)
        assert sub1_session["user"].get("role") in ("member", "admin")


# ---------- Test 2: Ensure sub1 starts as member ----------
class TestPrepareRoles:
    def test_ensure_sub1_is_member(self, owner_session, sub1_session):
        sub1_uid = sub1_session["user"]["user_id"]
        r = owner_session["session"].put(
            f"{BASE_URL}/api/team/{sub1_uid}/role", json={"role": "member"}, timeout=10
        )
        # 200 if promoted/demoted, or accept 400 if already member (server dependent)
        assert r.status_code in (200, 400), f"role set: {r.status_code} {r.text}"


# ---------- Test 3: Migration + Owner visibility ----------
class TestOwnerAndMigration:
    def test_owner_sees_all_contacts(self, owner_session):
        r = owner_session["session"].get(f"{BASE_URL}/api/contacts", timeout=15)
        assert r.status_code == 200
        items = r.json().get("items", [])
        # Verify assigned_to_user_id field is present on all/most contacts (migration ran)
        with_assign = [c for c in items if c.get("assigned_to_user_id")]
        # After migration, if there are contacts they should mostly have assigned_to_user_id
        if items:
            ratio = len(with_assign) / len(items)
            assert ratio >= 0.8, f"only {len(with_assign)}/{len(items)} contacts have assigned_to_user_id — migration incomplete"

    def test_owner_creates_auto_assigned(self, owner_session):
        c = _mk_contact(owner_session["session"], first="TEST_V24_auto")
        assert c["assigned_to_user_id"] == owner_session["user"]["user_id"], \
            f"expected auto-assign to owner, got {c.get('assigned_to_user_id')}"

    def test_owner_creates_with_explicit_assignee(self, owner_session, sub1_session):
        sub1_uid = sub1_session["user"]["user_id"]
        c = _mk_contact(owner_session["session"], first="TEST_V24_toSub1", assigned=sub1_uid)
        assert c["assigned_to_user_id"] == sub1_uid


# ---------- Test 4: Member visibility (sub1 as member) ----------
class TestMemberVisibility:
    def test_member_sees_only_own_contacts(self, owner_session, sub1_session):
        # Ensure sub1 is member
        sub1_uid = sub1_session["user"]["user_id"]
        owner_session["session"].put(
            f"{BASE_URL}/api/team/{sub1_uid}/role", json={"role": "member"}, timeout=10
        )
        # Create a contact assigned to sub1
        c_sub = _mk_contact(owner_session["session"], first="TEST_V24_mem_sub1", assigned=sub1_uid)
        # And one assigned to owner (default)
        c_own = _mk_contact(owner_session["session"], first="TEST_V24_mem_owner")

        r = sub1_session["session"].get(f"{BASE_URL}/api/contacts", timeout=15)
        assert r.status_code == 200
        items = r.json().get("items", [])
        cids = {c["contact_id"] for c in items}
        assert c_sub["contact_id"] in cids, "sub1 (member) should see contact assigned to self"
        assert c_own["contact_id"] not in cids, "sub1 (member) should NOT see contact assigned to owner"
        # Also, ALL returned contacts must be assigned to sub1
        for c in items:
            assert c.get("assigned_to_user_id") == sub1_uid, \
                f"member sees non-self contact: {c.get('contact_id')} assigned to {c.get('assigned_to_user_id')}"

    def test_member_get_forbidden_contact_returns_404(self, owner_session, sub1_session):
        # Contact owned by owner (not assigned to sub1)
        c_own = _mk_contact(owner_session["session"], first="TEST_V24_forbidden")
        r = sub1_session["session"].get(f"{BASE_URL}/api/contacts/{c_own['contact_id']}", timeout=15)
        assert r.status_code == 404, f"expected 404 for forbidden contact GET, got {r.status_code} {r.text}"


# ---------- Test 5: Group manager visibility ----------
class TestGroupManagerVisibility:
    def test_admin_sees_orphans_and_own(self, owner_session, sub1_session):
        sub1_uid = sub1_session["user"]["user_id"]
        # Promote sub1 to admin
        r = owner_session["session"].put(
            f"{BASE_URL}/api/team/{sub1_uid}/role", json={"role": "admin"}, timeout=10
        )
        assert r.status_code == 200, f"promote failed: {r.text}"

        # Re-login sub1 to refresh token role
        d = _login(SUB1_EMAIL, SUB1_PWD)
        admin_sess = requests.Session()
        admin_sess.headers.update({"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"})
        assert d["user"]["role"] == "admin"

        # Create contact assigned to sub1
        c_assigned = _mk_contact(owner_session["session"], first="TEST_V24_admin_self", assigned=sub1_uid)
        # Create orphan contact: create as owner then unassign
        c_orphan = _mk_contact(owner_session["session"], first="TEST_V24_orphan")
        rr = owner_session["session"].put(
            f"{BASE_URL}/api/contacts/{c_orphan['contact_id']}/assign",
            json={"assignee_user_id": None},
            timeout=10,
        )
        assert rr.status_code == 200, f"unassign failed: {rr.text}"
        assert rr.json().get("assigned_to_user_id") in (None, "") or "assigned_to_user_id" not in rr.json(), \
            f"contact still has assignee: {rr.json()}"

        # Create owner-assigned contact (not descendant of sub1) — sub1 admin should NOT see it
        c_owner_only = _mk_contact(owner_session["session"], first="TEST_V24_owner_only")

        # sub1 (admin) list
        r = admin_sess.get(f"{BASE_URL}/api/contacts", timeout=15)
        assert r.status_code == 200
        items = r.json().get("items", [])
        cids = {c["contact_id"] for c in items}
        assert c_assigned["contact_id"] in cids, "admin should see contact assigned to self"
        assert c_orphan["contact_id"] in cids, "admin should see orphan"
        assert c_owner_only["contact_id"] not in cids, "admin should NOT see contact assigned to owner (not descendant)"

        # cleanup: revert to member happens in module teardown
        # but demote here for later tests
        owner_session["session"].put(
            f"{BASE_URL}/api/team/{sub1_uid}/role", json={"role": "member"}, timeout=10
        )


# ---------- Test 6: Assignment permissions ----------
class TestAssignmentPermissions:
    def test_owner_can_assign_and_unassign(self, owner_session, sub1_session):
        sub1_uid = sub1_session["user"]["user_id"]
        c = _mk_contact(owner_session["session"], first="TEST_V24_assign1")
        # assign to sub1
        r = owner_session["session"].put(
            f"{BASE_URL}/api/contacts/{c['contact_id']}/assign",
            json={"assignee_user_id": sub1_uid},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json().get("assigned_to_user_id") == sub1_uid

        # unassign (None) → orphan
        r = owner_session["session"].put(
            f"{BASE_URL}/api/contacts/{c['contact_id']}/assign",
            json={"assignee_user_id": None},
            timeout=10,
        )
        assert r.status_code == 200
        # Verify persisted via GET
        g = owner_session["session"].get(f"{BASE_URL}/api/contacts/{c['contact_id']}", timeout=10)
        assert g.status_code == 200
        assert not g.json().get("assigned_to_user_id"), \
            f"contact still assigned after unassign: {g.json().get('assigned_to_user_id')}"

    def test_member_cannot_assign(self, owner_session, sub1_session):
        # Ensure sub1 is member
        sub1_uid = sub1_session["user"]["user_id"]
        owner_session["session"].put(
            f"{BASE_URL}/api/team/{sub1_uid}/role", json={"role": "member"}, timeout=10
        )
        # Re-login sub1 to refresh token
        d = _login(SUB1_EMAIL, SUB1_PWD)
        mem_sess = requests.Session()
        mem_sess.headers.update({"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"})

        c = _mk_contact(owner_session["session"], first="TEST_V24_memasgn", assigned=sub1_uid)
        # Member attempts to reassign
        r = mem_sess.put(
            f"{BASE_URL}/api/contacts/{c['contact_id']}/assign",
            json={"assignee_user_id": sub1_uid},
            timeout=10,
        )
        assert r.status_code == 403, f"expected 403 for member assign, got {r.status_code}: {r.text}"

    def test_group_manager_cannot_assign_non_descendant(self, owner_session, sub1_session):
        sub1_uid = sub1_session["user"]["user_id"]
        owner_uid = owner_session["user"]["user_id"]
        # Promote sub1 to admin
        r = owner_session["session"].put(
            f"{BASE_URL}/api/team/{sub1_uid}/role", json={"role": "admin"}, timeout=10
        )
        assert r.status_code == 200

        # Re-login sub1 to get admin token
        d = _login(SUB1_EMAIL, SUB1_PWD)
        adm_sess = requests.Session()
        adm_sess.headers.update({"Authorization": f"Bearer {d['token']}", "Content-Type": "application/json"})
        assert d["user"]["role"] == "admin"

        # Create a contact assigned to sub1 (so sub1 admin can see/PUT it)
        c = _mk_contact(owner_session["session"], first="TEST_V24_gm_reassign", assigned=sub1_uid)

        # Attempt to assign to owner (non-descendant of sub1) → should 403
        r = adm_sess.put(
            f"{BASE_URL}/api/contacts/{c['contact_id']}/assign",
            json={"assignee_user_id": owner_uid},
            timeout=10,
        )
        assert r.status_code == 403, f"expected 403 for admin assign to non-descendant, got {r.status_code}: {r.text}"

        # But sub1 admin CAN assign to self
        r2 = adm_sess.put(
            f"{BASE_URL}/api/contacts/{c['contact_id']}/assign",
            json={"assignee_user_id": sub1_uid},
            timeout=10,
        )
        assert r2.status_code == 200, f"admin self-assign failed: {r2.text}"

        # cleanup: demote sub1 back to member
        owner_session["session"].put(
            f"{BASE_URL}/api/team/{sub1_uid}/role", json={"role": "member"}, timeout=10
        )
