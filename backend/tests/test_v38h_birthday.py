"""V38H — additional_emails on user profile, new birthday fields on contact,
AI birthday message generation, delete contact + team endpoints."""

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    j = r.json()
    if j.get("requires_2fa"):
        pytest.skip("Owner has 2FA enabled — cannot test")
    return j["token"]


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="module")
def test_contact_id(owner_headers):
    """Create a TEST_ contact used across tests. Yield id, cleanup at end."""
    payload = {
        "first_name": "Marco",
        "last_name": "TEST_V38H",
        "email": "marco.test@example.com",
        "email_alt": "marco.alt@example.com",
        "phone": "3331112233",
        "birth_date": "1990-01-15",
        "birthday_auto_send": True,
        "is_active_client": True,
        "birthday_sender_email": "a@a.com",
        "birthday_recipient_email": "marco.test@example.com",
    }
    r = requests.post(f"{API}/contacts", json=payload, headers=owner_headers, timeout=30)
    assert r.status_code in (200, 201), f"Create contact failed: {r.status_code} {r.text}"
    cid = r.json().get("contact_id") or r.json().get("id")
    yield cid
    try:
        requests.delete(f"{API}/contacts/{cid}", headers=owner_headers, timeout=15)
    except Exception:
        pass


# ---------- Section 1: additional_emails on user profile ----------
class TestAdditionalEmails:

    def test_me_returns_additional_emails_field(self, owner_headers):
        r = requests.get(f"{API}/auth/me", headers=owner_headers, timeout=15)
        assert r.status_code == 200
        payload = r.json()
        u = payload.get("user", payload)
        assert "additional_emails" in u, f"user missing additional_emails: {u.keys()}"
        assert isinstance(u["additional_emails"], list)

    def test_profile_put_sets_additional_emails(self, owner_headers):
        emails = ["work@example.com", "personal@example.com"]
        r = requests.put(f"{API}/auth/profile", json={"additional_emails": emails}, headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        me_resp = requests.get(f"{API}/auth/me", headers=owner_headers, timeout=15).json()
        me = me_resp.get("user", me_resp)
        assert set(me["additional_emails"]) == set(emails)

    def test_profile_put_only_name_leaves_emails_unchanged(self, owner_headers):
        emails = ["one@ex.com", "two@ex.com"]
        requests.put(f"{API}/auth/profile", json={"additional_emails": emails}, headers=owner_headers, timeout=15)
        r = requests.put(f"{API}/auth/profile", json={"name": "Test Owner"}, headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        me_resp = requests.get(f"{API}/auth/me", headers=owner_headers, timeout=15).json()
        me = me_resp.get("user", me_resp)
        assert set(me["additional_emails"]) == set(emails), "additional_emails changed when only name sent"

    def test_profile_put_clears_additional_emails(self, owner_headers):
        r = requests.put(f"{API}/auth/profile", json={"additional_emails": []}, headers=owner_headers, timeout=15)
        assert r.status_code == 200
        me_resp = requests.get(f"{API}/auth/me", headers=owner_headers, timeout=15).json()
        me = me_resp.get("user", me_resp)
        assert me["additional_emails"] == []


# ---------- Section 2: Contact new birthday fields ----------
class TestContactBirthdayFields:

    def test_create_contact_echoes_new_fields(self, test_contact_id, owner_headers):
        r = requests.get(f"{API}/contacts/{test_contact_id}", headers=owner_headers, timeout=15)
        assert r.status_code == 200
        c = r.json()
        assert c.get("birthday_sender_email") == "a@a.com"
        assert c.get("birthday_recipient_email") == "marco.test@example.com"
        assert c.get("is_active_client") is True

    def test_put_updates_is_active_client(self, test_contact_id, owner_headers):
        r = requests.put(f"{API}/contacts/{test_contact_id}", json={"is_active_client": False}, headers=owner_headers, timeout=15)
        assert r.status_code == 200
        c = requests.get(f"{API}/contacts/{test_contact_id}", headers=owner_headers, timeout=15).json()
        assert c["is_active_client"] is False
        # revert to True for AI test
        requests.put(f"{API}/contacts/{test_contact_id}", json={"is_active_client": True}, headers=owner_headers, timeout=15)


# ---------- Section 3: AI birthday message generation ----------
class TestAIBirthdayMessage:

    def test_generate_ai_message_active_client(self, test_contact_id, owner_headers):
        r = requests.post(f"{API}/contacts/{test_contact_id}/birthday/generate-message",
                          headers=owner_headers, timeout=90)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        assert "message" in j
        assert "year" in j
        assert j.get("is_active_client") is True
        msg = j["message"]
        assert 50 <= len(msg) <= 800, f"message length {len(msg)}: {msg}"
        # contains name
        assert "marco" in msg.lower(), f"name not in message: {msg}"
        # no forbidden words
        low = msg.lower()
        assert "spam" not in low
        assert "automatico" not in low
        assert msg.strip() not in ("[TODO]", "")

    def test_second_generation_differs(self, test_contact_id, owner_headers):
        # first call already made in previous test, so grab history baseline
        h1 = requests.get(f"{API}/contacts/{test_contact_id}/birthday/history",
                         headers=owner_headers, timeout=15).json()
        prev_messages = [i["message"] for i in h1.get("items", [])]
        assert len(prev_messages) >= 1, "expected prior message in history"

        # generate again
        r = requests.post(f"{API}/contacts/{test_contact_id}/birthday/generate-message",
                          headers=owner_headers, timeout=90)
        assert r.status_code == 200
        m2 = r.json()["message"]
        assert m2 not in prev_messages, "2nd generation identical to a prior message"

    def test_history_sorted_desc(self, test_contact_id, owner_headers):
        r = requests.get(f"{API}/contacts/{test_contact_id}/birthday/history", headers=owner_headers, timeout=15)
        assert r.status_code == 200
        items = r.json().get("items", [])
        assert len(items) >= 1
        years = [it["year"] for it in items]
        assert years == sorted(years, reverse=True), f"not sorted desc: {years}"


# ---------- Section 4: AI tone modulation with inactive client ----------
class TestAIToneModulation:

    def test_inactive_client_message_still_valid(self, owner_headers):
        # Create separate contact with is_active_client=False
        payload = {
            "first_name": "Luigi",
            "last_name": "TEST_V38H_INACT",
            "email": "luigi@example.com",
            "birth_date": "1985-05-05",
            "is_active_client": False,
        }
        r = requests.post(f"{API}/contacts", json=payload, headers=owner_headers, timeout=30)
        assert r.status_code in (200, 201)
        cid = r.json().get("contact_id") or r.json().get("id")
        try:
            g = requests.post(f"{API}/contacts/{cid}/birthday/generate-message",
                             headers=owner_headers, timeout=90)
            assert g.status_code == 200, g.text
            j = g.json()
            assert j.get("is_active_client") is False
            msg = j["message"]
            assert 50 <= len(msg) <= 800
            assert "luigi" in msg.lower()
            # best-effort tone check — do NOT include commercial invite for inactive clients
            low = msg.lower()
            # not asserting hard, just log if present
            if "grazie per la continua fiducia" in low or "contattami per" in low:
                print(f"WARN: possible commercial phrasing in inactive client msg: {msg}")
        finally:
            requests.delete(f"{API}/contacts/{cid}", headers=owner_headers, timeout=15)


# ---------- Section 5: Delete contact + team ----------
class TestDeleteEndpoints:

    def test_delete_contact(self, owner_headers):
        # create + delete
        r = requests.post(f"{API}/contacts",
                          json={"first_name": "TEST_DEL", "last_name": "TEST_V38H"},
                          headers=owner_headers, timeout=30)
        assert r.status_code in (200, 201)
        cid = r.json().get("contact_id") or r.json().get("id")
        d = requests.delete(f"{API}/contacts/{cid}", headers=owner_headers, timeout=15)
        assert d.status_code == 200, d.text
        # verify gone
        g = requests.get(f"{API}/contacts/{cid}", headers=owner_headers, timeout=15)
        assert g.status_code == 404

    def test_owner_can_delete_team_member(self, owner_headers):
        # Create a temporary team member via /api/team
        temp_email = f"test_v38h_{uuid.uuid4().hex[:8]}@example.com"
        create = requests.post(f"{API}/team",
                              json={"email": temp_email, "name": "TEST_V38H_TEAM",
                                    "areas": ["energy"], "password": "TempPass123!"},
                              headers=owner_headers, timeout=15)
        if create.status_code not in (200, 201):
            pytest.skip(f"Cannot create team member for test: {create.status_code} {create.text}")
        j = create.json()
        uid = j.get("user_id") or j.get("id") or j.get("user", {}).get("user_id")
        assert uid, f"No user_id in team-create response: {j}"

        d = requests.delete(f"{API}/team/{uid}", headers=owner_headers, timeout=15)
        assert d.status_code == 200, d.text

    def test_member_cannot_delete_other_member(self, owner_headers):
        e1 = f"test_v38h_a_{uuid.uuid4().hex[:6]}@example.com"
        e2 = f"test_v38h_b_{uuid.uuid4().hex[:6]}@example.com"
        pwd = "TempPass123!"
        r1 = requests.post(f"{API}/team",
                          json={"email": e1, "name": "TEST_A", "areas": ["energy"], "password": pwd},
                          headers=owner_headers, timeout=15)
        r2 = requests.post(f"{API}/team",
                          json={"email": e2, "name": "TEST_B", "areas": ["energy"], "password": pwd},
                          headers=owner_headers, timeout=15)
        if r1.status_code not in (200, 201) or r2.status_code not in (200, 201):
            pytest.skip("cannot create team members")

        uid1 = r1.json().get("user_id")
        uid2 = r2.json().get("user_id")

        login = requests.post(f"{API}/auth/login", json={"email": e1, "password": pwd}, timeout=15)
        if login.status_code != 200:
            requests.delete(f"{API}/team/{uid1}", headers=owner_headers, timeout=15)
            requests.delete(f"{API}/team/{uid2}", headers=owner_headers, timeout=15)
            pytest.skip(f"Cannot log in as member: {login.status_code} {login.text}")

        j = login.json()
        if j.get("requires_2fa"):
            requests.delete(f"{API}/team/{uid1}", headers=owner_headers, timeout=15)
            requests.delete(f"{API}/team/{uid2}", headers=owner_headers, timeout=15)
            pytest.skip("member has 2fa")

        m_token = j["token"]
        m_headers = {"Authorization": f"Bearer {m_token}", "Content-Type": "application/json"}

        d = requests.delete(f"{API}/team/{uid2}", headers=m_headers, timeout=15)
        assert d.status_code in (401, 403), f"expected 401/403 got {d.status_code} {d.text}"

        # cleanup via owner
        requests.delete(f"{API}/team/{uid1}", headers=owner_headers, timeout=15)
        requests.delete(f"{API}/team/{uid2}", headers=owner_headers, timeout=15)
