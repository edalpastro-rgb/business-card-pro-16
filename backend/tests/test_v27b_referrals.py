"""Backend tests for Contact Referrals (Anagrafiche collegate) feature.

Covers:
- GET /api/contacts/{id}/referrals for contact with no relations
- GET /api/contacts/{id}/referrals when there's a parent (referred_by)
- GET /api/contacts/{id}/referrals when there are children (referrals[])
- Multi-tenant isolation (referrals from other tenant not exposed)
- POST /api/contacts with referred_by_contact_id creates the link
- PUT /api/contacts/{id} updating referred_by_contact_id
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"
SUB_EMAIL = "sub1@dalpastro.it"
SUB_PASS = "Sub12345!"


# ------- Helpers -------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_contact(token, first_name, last_name, referred_by=None, area="energy"):
    payload = {
        "first_name": first_name,
        "last_name": last_name,
        "area": area,
    }
    if referred_by:
        payload["referred_by_contact_id"] = referred_by
    r = requests.post(f"{API}/contacts", json=payload, headers=_auth(token), timeout=30)
    assert r.status_code in (200, 201), f"Create failed: {r.status_code} {r.text}"
    return r.json()


def _delete_contact(token, cid):
    try:
        requests.delete(f"{API}/contacts/{cid}", headers=_auth(token), timeout=15)
    except Exception:
        pass


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER_EMAIL, OWNER_PASS)


@pytest.fixture(scope="module")
def other_token():
    # We need a completely separate tenant. Sub1 is in the SAME tenant as owner
    # (parent_user_id = owner). So we register a fresh account instead.
    email = f"tester_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email,
        "password": "Passw0rd!",
        "name": "Iso Tenant",
    }, timeout=30)
    assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
    return r.json().get("token") or _login(email, "Passw0rd!")


class TestReferralsEndpoint:

    def test_referrals_empty_for_isolated_contact(self, owner_token):
        c = _create_contact(owner_token, "TEST_Iso", f"Solo_{uuid.uuid4().hex[:6]}")
        cid = c["contact_id"]
        try:
            r = requests.get(f"{API}/contacts/{cid}/referrals", headers=_auth(owner_token), timeout=30)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["referred_by"] is None
            assert data["referrals"] == []
        finally:
            _delete_contact(owner_token, cid)

    def test_referrals_parent_and_children(self, owner_token):
        parent = _create_contact(owner_token, "TEST_Parent", f"Master_{uuid.uuid4().hex[:6]}")
        pid = parent["contact_id"]
        child1 = _create_contact(owner_token, "TEST_Child1", f"Kid_{uuid.uuid4().hex[:6]}", referred_by=pid)
        child2 = _create_contact(owner_token, "TEST_Child2", f"Kid_{uuid.uuid4().hex[:6]}", referred_by=pid)
        try:
            # parent side — referrals should include both children
            r = requests.get(f"{API}/contacts/{pid}/referrals", headers=_auth(owner_token), timeout=30)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["referred_by"] is None
            ids = {c["contact_id"] for c in data["referrals"]}
            assert child1["contact_id"] in ids
            assert child2["contact_id"] in ids
            # required fields present
            for c in data["referrals"]:
                assert "contact_id" in c
                assert "first_name" in c
                assert "last_name" in c
                # area may be present
                # contact_code may exist or not depending on seeded contacts

            # child side — referred_by should be the parent
            r2 = requests.get(f"{API}/contacts/{child1['contact_id']}/referrals",
                              headers=_auth(owner_token), timeout=30)
            assert r2.status_code == 200
            d2 = r2.json()
            assert d2["referred_by"] is not None
            assert d2["referred_by"]["contact_id"] == pid
            assert d2["referred_by"].get("first_name") == "TEST_Parent"
            assert d2["referrals"] == []
        finally:
            _delete_contact(owner_token, child1["contact_id"])
            _delete_contact(owner_token, child2["contact_id"])
            _delete_contact(owner_token, pid)

    def test_referrals_tenant_isolation(self, owner_token, other_token):
        # Create parent+child on owner tenant
        parent = _create_contact(owner_token, "TEST_IsoParent", f"P_{uuid.uuid4().hex[:6]}")
        pid = parent["contact_id"]
        child = _create_contact(owner_token, "TEST_IsoChild", f"C_{uuid.uuid4().hex[:6]}", referred_by=pid)
        try:
            # Other tenant should NOT see this contact at all (404 on the parent id)
            r = requests.get(f"{API}/contacts/{pid}/referrals", headers=_auth(other_token), timeout=30)
            assert r.status_code == 404, f"Expected 404 for cross-tenant access, got {r.status_code}"
        finally:
            _delete_contact(owner_token, child["contact_id"])
            _delete_contact(owner_token, pid)

    def test_edit_referred_by_via_put(self, owner_token):
        p1 = _create_contact(owner_token, "TEST_P1", f"a_{uuid.uuid4().hex[:6]}")
        p2 = _create_contact(owner_token, "TEST_P2", f"b_{uuid.uuid4().hex[:6]}")
        child = _create_contact(owner_token, "TEST_Ch", f"c_{uuid.uuid4().hex[:6]}", referred_by=p1["contact_id"])
        try:
            # Verify initial link -> p1
            r0 = requests.get(f"{API}/contacts/{child['contact_id']}/referrals",
                              headers=_auth(owner_token), timeout=30)
            assert r0.json()["referred_by"]["contact_id"] == p1["contact_id"]

            # PUT switch parent to p2
            up = requests.put(
                f"{API}/contacts/{child['contact_id']}",
                json={"referred_by_contact_id": p2["contact_id"]},
                headers=_auth(owner_token),
                timeout=30,
            )
            assert up.status_code == 200, up.text

            r1 = requests.get(f"{API}/contacts/{child['contact_id']}/referrals",
                              headers=_auth(owner_token), timeout=30)
            assert r1.status_code == 200
            assert r1.json()["referred_by"]["contact_id"] == p2["contact_id"]

            # p1 should no longer list this child; p2 should
            r2 = requests.get(f"{API}/contacts/{p1['contact_id']}/referrals",
                              headers=_auth(owner_token), timeout=30)
            assert child["contact_id"] not in {c["contact_id"] for c in r2.json()["referrals"]}
            r3 = requests.get(f"{API}/contacts/{p2['contact_id']}/referrals",
                              headers=_auth(owner_token), timeout=30)
            assert child["contact_id"] in {c["contact_id"] for c in r3.json()["referrals"]}
        finally:
            _delete_contact(owner_token, child["contact_id"])
            _delete_contact(owner_token, p1["contact_id"])
            _delete_contact(owner_token, p2["contact_id"])

    def test_referrals_404_for_missing_contact(self, owner_token):
        r = requests.get(f"{API}/contacts/nonexistent-xyz/referrals",
                         headers=_auth(owner_token), timeout=30)
        assert r.status_code == 404
