"""V36 bug fix regression tests:
- GET /api/contacts sort order is created_at DESC
- Multi-tenant isolation preserved
- Search (q), area, group_id filters still work
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback for backend .env style
    BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PWD = "Test1234!"
SUB_EMAIL = "sub1@dalpastro.it"
SUB_PWD = "Sub12345!"


def _login(email, pwd):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PWD)


@pytest.fixture(scope="module")
def sub_token():
    return _login(SUB_EMAIL, SUB_PWD)


def _headers(tok):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {tok}"}


# ============ Contacts endpoint ============

class TestContactsListEndpoint:

    def test_get_contacts_200(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/contacts", headers=_headers(owner_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert isinstance(data["items"], list)

    def test_sort_order_is_created_at_desc(self, owner_token):
        """Create 2 contacts back to back — newest one must be at index 0."""
        ts = int(time.time())
        c1_first = f"TESTNEW_A_{ts}_{uuid.uuid4().hex[:6]}"
        c2_first = f"TESTNEW_B_{ts}_{uuid.uuid4().hex[:6]}"

        r1 = requests.post(
            f"{BASE_URL}/api/contacts",
            headers=_headers(owner_token),
            json={"first_name": c1_first, "last_name": "Alpha", "area": "energy"},
            timeout=30,
        )
        assert r1.status_code in (200, 201), f"contact1 create: {r1.status_code} {r1.text}"
        c1_id = r1.json()["contact_id"]

        # small pause so created_at differs meaningfully
        time.sleep(1.1)

        r2 = requests.post(
            f"{BASE_URL}/api/contacts",
            headers=_headers(owner_token),
            json={"first_name": c2_first, "last_name": "Zulu", "area": "energy"},
            timeout=30,
        )
        assert r2.status_code in (200, 201), f"contact2 create: {r2.status_code} {r2.text}"
        c2_id = r2.json()["contact_id"]

        # Get list; contact 2 must appear BEFORE contact 1 (created_at DESC)
        rl = requests.get(f"{BASE_URL}/api/contacts", headers=_headers(owner_token), timeout=30)
        assert rl.status_code == 200
        items = rl.json()["items"]

        idx_c1 = next((i for i, x in enumerate(items) if x["contact_id"] == c1_id), -1)
        idx_c2 = next((i for i, x in enumerate(items) if x["contact_id"] == c2_id), -1)
        assert idx_c1 >= 0 and idx_c2 >= 0, "created contacts not in list"
        assert idx_c2 < idx_c1, f"expected newer (c2 idx={idx_c2}) before older (c1 idx={idx_c1})"

        # Also confirm c2 is at the top or near top
        assert idx_c2 <= 1, f"newest contact should be at top (got idx={idx_c2})"

        # cleanup
        for cid in (c1_id, c2_id):
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=_headers(owner_token), timeout=30)

    def test_search_q_filter(self, owner_token):
        """Search still works after sort change."""
        ts = int(time.time())
        first = f"TESTSRC_{ts}_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            headers=_headers(owner_token),
            json={"first_name": first, "last_name": "SearchZ", "area": "energy"},
            timeout=30,
        )
        assert r.status_code in (200, 201)
        cid = r.json()["contact_id"]

        rl = requests.get(
            f"{BASE_URL}/api/contacts",
            headers=_headers(owner_token),
            params={"q": first},
            timeout=30,
        )
        assert rl.status_code == 200
        items = rl.json()["items"]
        assert any(x["contact_id"] == cid for x in items), "q filter did not return expected contact"

        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=_headers(owner_token), timeout=30)

    def test_area_filter(self, owner_token):
        rl = requests.get(
            f"{BASE_URL}/api/contacts",
            headers=_headers(owner_token),
            params={"area": "energy"},
            timeout=30,
        )
        assert rl.status_code == 200
        items = rl.json()["items"]
        # All returned items must have area energy OR additional_areas including energy
        for it in items:
            assert it.get("area") == "energy" or "energy" in (it.get("additional_areas") or []), \
                f"non-energy item returned: {it.get('contact_id')} area={it.get('area')}"

    def test_group_id_filter(self, owner_token):
        # Create a temp group + contact then filter
        gname = f"TESTGRP_{int(time.time())}_{uuid.uuid4().hex[:5]}"
        rg = requests.post(
            f"{BASE_URL}/api/groups",
            headers=_headers(owner_token),
            json={"name": gname, "color": "#4444AA"},
            timeout=30,
        )
        assert rg.status_code in (200, 201), f"group create failed: {rg.status_code} {rg.text}"
        gid = rg.json()["group_id"]

        rc = requests.post(
            f"{BASE_URL}/api/contacts",
            headers=_headers(owner_token),
            json={"first_name": f"TESTGRPC_{uuid.uuid4().hex[:6]}", "last_name": "Grp", "area": "energy", "group_ids": [gid]},
            timeout=30,
        )
        assert rc.status_code in (200, 201)
        cid = rc.json()["contact_id"]

        rl = requests.get(
            f"{BASE_URL}/api/contacts",
            headers=_headers(owner_token),
            params={"group_id": gid},
            timeout=30,
        )
        assert rl.status_code == 200
        items = rl.json()["items"]
        assert any(x["contact_id"] == cid for x in items), "group_id filter did not return contact"

        # cleanup
        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=_headers(owner_token), timeout=30)
        requests.delete(f"{BASE_URL}/api/groups/{gid}", headers=_headers(owner_token), timeout=30)

    def test_multi_tenant_isolation(self, owner_token, sub_token):
        """Owner-created contact must NOT be visible to sub-user if not assigned to them.
        Note: sub1 is member of same tenant; role=member sees only self-assigned contacts.
        So an owner-created contact assigned to owner should be invisible to sub."""
        ts = int(time.time())
        first = f"TESTISO_{ts}_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            headers=_headers(owner_token),
            json={"first_name": first, "last_name": "Iso", "area": "network"},
            timeout=30,
        )
        assert r.status_code in (200, 201)
        cid = r.json()["contact_id"]

        # sub-user list must NOT contain this contact (member role only sees own)
        rs = requests.get(f"{BASE_URL}/api/contacts", headers=_headers(sub_token), timeout=30)
        assert rs.status_code == 200
        sub_items = rs.json()["items"]
        assert not any(x["contact_id"] == cid for x in sub_items), \
            "member sub-user should not see owner's contact"

        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=_headers(owner_token), timeout=30)
