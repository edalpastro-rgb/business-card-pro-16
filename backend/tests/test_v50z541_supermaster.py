"""V50.z541 — Supermaster panel + Org plans + FAQ by role + Welcome email at registration.

Testing against localhost:8001 (production backend behind preview — same instance locally).
"""
import hashlib
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("BACKEND_INTERNAL_URL", "http://localhost:8001").rstrip("/")
API = BASE_URL + "/api"
SUPER_EMAIL = "test@dalpastro.it"
SUPER_PASSWORD = "Test1234!"
CMS_PASSWORD = os.environ.get("LANDING_CMS_PASSWORD", "axon-cms-2026")

# Collect created test user ids for cleanup at end
_CREATED_UIDS: list[str] = []


# ----------------- helpers ------------------
def _solve_pow(prefix: str, difficulty: int) -> str:
    target = "0" * difficulty
    n = 0
    while True:
        nonce = str(n)
        if hashlib.sha256((prefix + nonce).encode()).hexdigest().startswith(target):
            return nonce
        n += 1


def register_user(email: str, name: str, password: str = "Test1234!", org_plan: str | None = None) -> dict:
    ch = requests.get(f"{API}/auth/register/challenge").json()
    nonce = _solve_pow(ch["prefix"], int(ch["difficulty"]))
    # Respect min_fill_ms
    time.sleep(max(0, (ch.get("min_fill_ms", 3000) / 1000.0) + 0.3))
    body = {
        "email": email, "password": password, "name": name,
        "challenge_id": ch["challenge_id"], "pow_nonce": nonce,
        "hp": "", "privacy_accepted": True,
    }
    if org_plan is not None:
        body["org_plan"] = org_plan
    r = requests.post(f"{API}/auth/register", json=body)
    assert r.status_code == 200, f"register failed {r.status_code}: {r.text}"
    data = r.json()
    assert "token" in data and data.get("user", {}).get("user_id")
    _CREATED_UIDS.append(data["user"]["user_id"])
    return data


def hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ----------------- fixtures ------------------
@pytest.fixture(scope="module")
def super_token() -> str:
    r = requests.post(f"{API}/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def unique_tag():
    return uuid.uuid4().hex[:8]


# ============== (A) Super admin + /admin/users ==============
class TestAdminUsers:
    def test_super_admin_me(self, super_token):
        r = requests.get(f"{API}/admin/me", headers=hdr(super_token))
        assert r.status_code == 200, r.text
        assert r.json().get("super_admin") is True

    def test_admin_users_list(self, super_token):
        r = requests.get(f"{API}/admin/users", headers=hdr(super_token))
        assert r.status_code == 200, r.text
        j = r.json()
        assert "items" in j and isinstance(j["items"], list)
        assert "counts" in j and all(k in j["counts"] for k in ("total", "masters", "managers", "collabs", "unverified"))
        assert "plans" in j and len(j["plans"]) >= 1
        assert "me" in j

    def test_admin_users_filter_role_master(self, super_token):
        r = requests.get(f"{API}/admin/users?role=master", headers=hdr(super_token))
        assert r.status_code == 200
        for i in r.json()["items"]:
            assert i["is_root_master"] is True

    def test_admin_users_filter_status_unverified(self, super_token):
        r = requests.get(f"{API}/admin/users?status=unverified", headers=hdr(super_token))
        assert r.status_code == 200
        for i in r.json()["items"]:
            assert i["email_verified"] is False

    def test_admin_users_search_q(self, super_token):
        r = requests.get(f"{API}/admin/users?q=dalpastro", headers=hdr(super_token))
        assert r.status_code == 200
        emails = [i["email"] or "" for i in r.json()["items"]]
        assert any("dalpastro" in e.lower() for e in emails)

    def test_admin_users_without_token_401(self):
        r = requests.get(f"{API}/admin/users")
        assert r.status_code == 401

    def test_admin_users_with_non_super_token_403(self, unique_tag):
        tok = register_user(f"nonsuper_{unique_tag}@gmail.com", "Non Super", org_plan="master10")["token"]
        me = requests.get(f"{API}/admin/me", headers=hdr(tok))
        assert me.status_code == 200
        assert me.json().get("super_admin") is False
        r = requests.get(f"{API}/admin/users", headers=hdr(tok))
        assert r.status_code == 403


# ============== (B) Org plans and user limit enforcement ==============
class TestOrgPlanFlow:
    @pytest.fixture(scope="class")
    def m1(self, unique_tag):
        return register_user(f"m1_{unique_tag}@gmail.com", "Master One", org_plan="collab")

    def test_team_creation_hits_plan_limit(self, m1, unique_tag):
        r = requests.post(f"{API}/team",
                          headers=hdr(m1["token"]),
                          json={"email": f"tm_{unique_tag}@gmail.com", "name": "T", "password": "Test1234!", "areas": ["energy"]})
        assert r.status_code == 402, r.text
        det = r.json().get("detail") or {}
        assert det.get("code") == "plan_limit"

    def test_invites_hits_plan_limit(self, m1):
        r = requests.post(f"{API}/invites", headers=hdr(m1["token"]), json={"role": "basic"})
        assert r.status_code == 402
        det = r.json().get("detail") or {}
        assert det.get("code") == "plan_limit"

    def test_org_plan_mine(self, m1):
        r = requests.get(f"{API}/org/plan", headers=hdr(m1["token"]))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["used"] == 1
        assert j["max_users"] == 1
        assert j["left"] == 0
        assert j["over_limit"] is False
        assert len(j.get("upgrades") or []) >= 1

    def test_org_plan_upgrade_request(self, m1):
        r1 = requests.post(f"{API}/org/plan/upgrade-request",
                           headers=hdr(m1["token"]), json={"plan_id": "master10"})
        assert r1.status_code == 200, r1.text
        assert r1.json().get("ok") is True
        r2 = requests.post(f"{API}/org/plan/upgrade-request",
                           headers=hdr(m1["token"]), json={"plan_id": "master10"})
        assert r2.status_code == 200
        assert r2.json().get("already") is True

    def test_super_admin_patches_plan_then_team_create_succeeds(self, m1, super_token, unique_tag):
        r = requests.patch(f"{API}/admin/users/{m1['user']['user_id']}",
                           headers=hdr(super_token), json={"org_plan": "master10"})
        assert r.status_code == 200, r.text
        r2 = requests.post(f"{API}/team", headers=hdr(m1["token"]),
                           json={"email": f"mem_{unique_tag}@gmail.com", "name": "Mem", "password": "Test1234!", "areas": ["energy"]})
        assert r2.status_code in (200, 201), r2.text
        member = r2.json()
        mid = member.get("user_id") or member.get("id") or (member.get("user") or {}).get("user_id")
        assert mid, f"missing member id in {member}"
        _CREATED_UIDS.append(mid)
        # verify usage
        pl = requests.get(f"{API}/org/plan", headers=hdr(m1["token"])).json()
        assert pl["used"] == 2 and pl["max_users"] == 10
        # stash member id on m1 for next tests
        m1["member_id"] = mid


# ============== (C) PATCH roles / parent / cycles ==============
class TestPatchRolesParent:
    def test_patch_member_role_admin(self, super_token, unique_tag):
        master = register_user(f"roles_m_{unique_tag}@gmail.com", "Roles Master", org_plan="master10")
        requests.patch(f"{API}/admin/users/{master['user']['user_id']}",
                       headers=hdr(super_token), json={"org_plan": "master10"})
        member_r = requests.post(f"{API}/team", headers=hdr(master["token"]),
                                 json={"email": f"roles_mb_{unique_tag}@gmail.com", "name": "RM", "password": "Test1234!", "areas": ["energy"]})
        assert member_r.status_code in (200, 201)
        mem = member_r.json()
        mid = mem.get("user_id") or mem.get("id") or (mem.get("user") or {}).get("user_id")
        _CREATED_UIDS.append(mid)
        r = requests.patch(f"{API}/admin/users/{mid}", headers=hdr(super_token), json={"role": "admin"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "admin"

    def test_patch_parent_moves_user(self, super_token, unique_tag):
        # Create M1 root
        m1 = register_user(f"par_m1_{unique_tag}@gmail.com", "Par M1", org_plan="master10")
        requests.patch(f"{API}/admin/users/{m1['user']['user_id']}", headers=hdr(super_token), json={"org_plan": "master10"})
        # Fresh U2 root
        u2 = register_user(f"par_u2_{unique_tag}@gmail.com", "Par U2", org_plan="collab")
        r = requests.patch(f"{API}/admin/users/{u2['user']['user_id']}",
                           headers=hdr(super_token), json={"parent_user_id": m1["user"]["user_id"]})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["parent_user_id"] == m1["user"]["user_id"]
        assert r.json()["user"]["role"] == "admin"

    def test_patch_parent_self_400(self, super_token, unique_tag):
        u = register_user(f"self_{unique_tag}@gmail.com", "Self Par", org_plan="collab")
        r = requests.patch(f"{API}/admin/users/{u['user']['user_id']}",
                           headers=hdr(super_token), json={"parent_user_id": u["user"]["user_id"]})
        assert r.status_code == 400, r.text

    def test_patch_parent_empty_root(self, super_token, unique_tag):
        parent = register_user(f"root_p_{unique_tag}@gmail.com", "Root Parent", org_plan="master10")
        requests.patch(f"{API}/admin/users/{parent['user']['user_id']}", headers=hdr(super_token), json={"org_plan": "master10"})
        child_r = requests.post(f"{API}/team", headers=hdr(parent["token"]),
                                json={"email": f"child_{unique_tag}@gmail.com", "name": "Child", "password": "Test1234!", "areas": ["energy"]})
        cid = (child_r.json().get("user_id") or child_r.json().get("id")
               or (child_r.json().get("user") or {}).get("user_id"))
        _CREATED_UIDS.append(cid)
        r = requests.patch(f"{API}/admin/users/{cid}", headers=hdr(super_token), json={"parent_user_id": ""})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["parent_user_id"] in (None, "")
        assert r.json()["user"]["role"] == "owner"


# ============== (D) DELETE user cascade ==============
class TestDelete:
    def test_delete_with_children_409_then_cascade(self, super_token, unique_tag):
        m = register_user(f"del_m_{unique_tag}@gmail.com", "Del M", org_plan="master10")
        requests.patch(f"{API}/admin/users/{m['user']['user_id']}", headers=hdr(super_token), json={"org_plan": "master10"})
        child_r = requests.post(f"{API}/team", headers=hdr(m["token"]),
                                json={"email": f"del_c_{unique_tag}@gmail.com", "name": "DelC", "password": "Test1234!", "areas": ["energy"]})
        _ = (child_r.json().get("user_id") or child_r.json().get("id")
             or (child_r.json().get("user") or {}).get("user_id"))
        r = requests.delete(f"{API}/admin/users/{m['user']['user_id']}", headers=hdr(super_token))
        assert r.status_code == 409, r.text
        assert (r.json().get("detail") or {}).get("code") == "has_children"
        r2 = requests.delete(f"{API}/admin/users/{m['user']['user_id']}?cascade=1", headers=hdr(super_token))
        assert r2.status_code == 200, r2.text
        assert r2.json().get("deleted") >= 2

    def test_delete_self_400(self, super_token):
        # /admin/me doesn't return user_id; look it up via admin list
        lst = requests.get(f"{API}/admin/users?q={SUPER_EMAIL}", headers=hdr(super_token)).json()
        me = [i for i in lst["items"] if i["email"] == SUPER_EMAIL][0]
        r = requests.delete(f"{API}/admin/users/{me['user_id']}", headers=hdr(super_token))
        assert r.status_code == 400


# ============== (E) Welcome email / force verify ==============
class TestWelcomeEmail:
    def test_resend_welcome_and_verify(self, super_token, unique_tag):
        u = register_user(f"welc_{unique_tag}@gmail.com", "Welc", org_plan="collab")
        uid = u["user"]["user_id"]
        r = requests.post(f"{API}/admin/users/{uid}/welcome-email", headers=hdr(super_token))
        assert r.status_code in (200, 502), r.text
        # Check welcome fields now present in admin listing
        lst = requests.get(f"{API}/admin/users?q={u['user']['email']}", headers=hdr(super_token)).json()
        found = [x for x in lst["items"] if x["user_id"] == uid]
        assert found, "User missing from admin list"
        row = found[0]
        assert (row.get("welcome_email_sent_at") is not None) or (row.get("welcome_email_error") is not None)

        v = requests.post(f"{API}/admin/users/{uid}/verify-email", headers=hdr(super_token))
        assert v.status_code == 200
        lst2 = requests.get(f"{API}/admin/users?q={u['user']['email']}", headers=hdr(super_token)).json()
        row2 = [x for x in lst2["items"] if x["user_id"] == uid][0]
        assert row2.get("email_verified") is True


# ============== (F) Public & Admin org plans CRUD ==============
class TestOrgPlansCrud:
    def test_public_org_plans(self):
        r = requests.get(f"{API}/public/org-plans")
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()["items"]}
        assert {"collab", "master10", "master50", "enterprise"}.issubset(ids)
        pricing = {p["id"]: p for p in r.json()["items"]}
        assert pricing["collab"]["price_month"] == 19.0
        assert pricing["master10"]["price_month"] == 50.0
        assert pricing["master50"]["price_month"] == 100.0
        assert pricing["enterprise"]["price_month"] is None

    def test_admin_org_plans_get(self, super_token):
        r = requests.get(f"{API}/admin/org-plans", headers=hdr(super_token))
        assert r.status_code == 200
        assert "items" in r.json() and "defaults" in r.json()

    def test_admin_org_plans_put_modify_and_reset(self, super_token):
        current = requests.get(f"{API}/admin/org-plans", headers=hdr(super_token)).json()["items"]
        modified = []
        for p in current:
            np = {k: p.get(k) for k in ("id", "label", "price_month", "max_users", "quote", "order", "desc", "badge")}
            if np["id"] == "master10":
                np["label"] = "Master10 CUSTOM"
                np["price_month"] = 55.0
            modified.append(np)
        r = requests.put(f"{API}/admin/org-plans", headers=hdr(super_token), json={"items": modified})
        assert r.status_code == 200, r.text
        pub = requests.get(f"{API}/public/org-plans").json()["items"]
        m10 = [p for p in pub if p["id"] == "master10"][0]
        assert m10["label"] == "Master10 CUSTOM"
        assert m10["price_month"] == 55.0

        # Duplicate ids
        dup = modified + [modified[0]]
        rd = requests.put(f"{API}/admin/org-plans", headers=hdr(super_token), json={"items": dup})
        assert rd.status_code == 400

        # Non-quote plan missing price
        bad = []
        for p in current:
            np = {k: p.get(k) for k in ("id", "label", "price_month", "max_users", "quote", "order", "desc", "badge")}
            if np["id"] == "collab":
                np["price_month"] = None
                np["quote"] = False
            bad.append(np)
        rb = requests.put(f"{API}/admin/org-plans", headers=hdr(super_token), json={"items": bad})
        assert rb.status_code == 400

        rr = requests.post(f"{API}/admin/org-plans/reset", headers=hdr(super_token))
        assert rr.status_code == 200
        pub2 = requests.get(f"{API}/public/org-plans").json()["items"]
        m10b = [p for p in pub2 if p["id"] == "master10"][0]
        assert m10b["price_month"] == 50.0


# ============== (G) Registration org_plan fallback + welcome recorded ==============
class TestRegistrationFallbackAndWelcome:
    def test_invalid_org_plan_fallback(self, super_token, unique_tag):
        u = register_user(f"fb_{unique_tag}@gmail.com", "Fallback", org_plan="invalid")
        assert u.get("requires_email_verification") is True
        # Check admin listing has org_plan='collab' (first)
        lst = requests.get(f"{API}/admin/users?q={u['user']['email']}", headers=hdr(super_token)).json()
        row = [x for x in lst["items"] if x["user_id"] == u["user"]["user_id"]][0]
        assert row.get("org_plan") == "collab"
        # Welcome fields were written during registration (best-effort)
        assert (row.get("welcome_email_sent_at") is not None) or (row.get("welcome_email_error") is not None)


# ============== (H) /api/billing/plans derived from org plans ==============
class TestBillingPlans:
    def test_billing_plans(self, super_token):
        r = requests.get(f"{API}/billing/plans", headers=hdr(super_token))
        assert r.status_code == 200, r.text
        j = r.json()
        # 'plans' is probably a dict keyed by id OR a list. Normalize.
        plans = j.get("plans") or {}
        if isinstance(plans, dict):
            ids = set(plans.keys())
            amounts = {k: v.get("amount") for k, v in plans.items()}
        else:
            ids = {p["id"] for p in plans}
            amounts = {p["id"]: p.get("amount") for p in plans}
        assert {"collab", "master10", "master50"}.issubset(ids), f"got {ids}"
        assert amounts.get("collab") == 19.0
        assert amounts.get("master10") == 50.0
        assert amounts.get("master50") == 100.0
        assert "org" in j


# ============== (I) FAQ by role ==============
class TestFaqRoles:
    def test_anonymous_no_tagged_items(self):
        r = requests.get(f"{API}/public/faq")
        assert r.status_code == 200
        j = r.json()
        assert j.get("role") in (None, "")
        for it in j.get("items") or []:
            assert not (it.get("roles") or []), f"anon leaked tagged item: {it}"

    def test_superadmin_sees_all(self, super_token):
        r = requests.get(f"{API}/public/faq", headers=hdr(super_token))
        assert r.status_code == 200
        j = r.json()
        assert j.get("role") == "superadmin"
        assert len(j.get("items") or []) == 26, f"expected 26, got {len(j.get('items') or [])}"

    def test_master_owner_role_filter(self, unique_tag):
        owner = register_user(f"faq_m_{unique_tag}@gmail.com", "FAQ M", org_plan="collab")
        r = requests.get(f"{API}/public/faq", headers=hdr(owner["token"]))
        assert r.status_code == 200
        j = r.json()
        assert j.get("role") == "master"
        ids = [i.get("id") for i in j.get("items") or []]
        assert "faq_17" in ids and "faq_19" in ids
        for exc in ("faq_21", "faq_22", "faq_23"):
            assert exc not in ids, f"{exc} should NOT be in master FAQ"

    def test_admin_role_filter(self, super_token, unique_tag):
        master = register_user(f"faq_mg_m_{unique_tag}@gmail.com", "FAQ MG M", org_plan="master10")
        requests.patch(f"{API}/admin/users/{master['user']['user_id']}", headers=hdr(super_token), json={"org_plan": "master10"})
        mem_r = requests.post(f"{API}/team", headers=hdr(master["token"]),
                              json={"email": f"faq_mg_{unique_tag}@gmail.com", "name": "FAQMG",
                                    "password": "Test1234!", "areas": ["energy"]})
        mem = mem_r.json()
        mid = mem.get("user_id") or mem.get("id") or (mem.get("user") or {}).get("user_id")
        _CREATED_UIDS.append(mid)
        # Promote to admin
        requests.patch(f"{API}/admin/users/{mid}", headers=hdr(super_token), json={"role": "admin"})
        # Login as this user
        login = requests.post(f"{API}/auth/login", json={"email": f"faq_mg_{unique_tag}@gmail.com", "password": "Test1234!"}).json()
        tok = login.get("token")
        assert tok
        r = requests.get(f"{API}/public/faq", headers=hdr(tok))
        j = r.json()
        assert j.get("role") == "manager"
        ids = [i.get("id") for i in j.get("items") or []]
        assert "faq_22" in ids
        assert "faq_17" not in ids

    def test_suggest_role_aware(self, unique_tag):
        owner = register_user(f"sug_m_{unique_tag}@gmail.com", "Sug M", org_plan="collab")
        r1 = requests.get(f"{API}/public/faq/suggest", params={"q": "landing page"}, headers=hdr(owner["token"]))
        assert r1.status_code == 200
        items1 = r1.json().get("items") or []
        assert items1 and items1[0].get("id") == "faq_17"
        r2 = requests.get(f"{API}/public/faq/suggest", params={"q": "landing page"})
        items2 = r2.json().get("items") or []
        assert not any(i.get("id") == "faq_17" for i in items2)


# ============== (J) CMS FAQ PUT with roles validation + reset ==============
class TestCmsFaq:
    def test_put_faq_filters_bogus_roles(self, super_token):
        # Fetch existing FAQ (super admin sees them)
        current = requests.get(f"{API}/public/faq", headers=hdr(super_token)).json().get("items") or []
        assert current
        items = []
        for i, it in enumerate(current):
            new_it = {k: it.get(k) for k in ("id", "q", "a", "roles") if it.get(k) is not None}
            new_it.setdefault("id", it.get("id") or f"faq_x{i}")
            new_it.setdefault("q", it.get("q") or "Q?")
            new_it.setdefault("a", it.get("a") or "A")
            items.append(new_it)
        # Inject bogus role on first item
        items[0]["roles"] = ["collab", "bogus"]
        r = requests.put(f"{API}/landing/cms/faq",
                         headers={**hdr(super_token), "X-CMS-Password": CMS_PASSWORD},
                         json={"items": items})
        assert r.status_code == 200, r.text
        # Verify roles stored only valid ones
        after = requests.get(f"{API}/public/faq", headers=hdr(super_token)).json().get("items") or []
        target = [x for x in after if x.get("id") == items[0]["id"]]
        assert target
        assert target[0].get("roles") == ["collab"], f"expected ['collab'], got {target[0].get('roles')}"
        # Reset
        rr = requests.post(f"{API}/landing/cms/faq/reset",
                          headers={**hdr(super_token), "X-CMS-Password": CMS_PASSWORD})
        assert rr.status_code == 200, rr.text


# ============== Cleanup ==============
def test_zz_cleanup(super_token=None):
    tok = requests.post(f"{API}/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASSWORD}).json()["token"]
    for uid in set(_CREATED_UIDS):
        try:
            requests.delete(f"{API}/admin/users/{uid}?cascade=1", headers=hdr(tok))
        except Exception:
            pass
