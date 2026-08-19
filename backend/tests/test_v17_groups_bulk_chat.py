"""v1.7 backend tests: Groups CRUD, SMTP config, Bulk email/preview, Chat channels/messages,
Team members endpoint, Contact vCard, and regression on contacts/appointments/settings."""
import os
import time
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://contact-hub-italy.preview.emergentagent.com"
).rstrip("/")

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    assert "token" in j, "Login must return 'token' field (not 'access_token')"
    assert "user" in j, "Login must return 'user' object"
    return j["token"], j["user"]


@pytest.fixture(scope="module")
def owner_auth():
    token, user = _login(OWNER)
    return token, user


@pytest.fixture(scope="module")
def sub_auth():
    token, user = _login(SUB)
    return token, user


@pytest.fixture
def owner_h(owner_auth):
    return {"Authorization": f"Bearer {owner_auth[0]}", "Content-Type": "application/json"}


@pytest.fixture
def sub_h(sub_auth):
    return {"Authorization": f"Bearer {sub_auth[0]}", "Content-Type": "application/json"}


# =========================
# Auth login shape
# =========================
class TestAuth:
    def test_owner_login_returns_token_field(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json=OWNER, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "token" in j
        assert "access_token" not in j or j.get("token") == j.get("access_token")
        assert isinstance(j["user"], dict)

    def test_sub_login_ok(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json=SUB, timeout=15)
        assert r.status_code == 200, r.text
        assert "token" in r.json()


# =========================
# Groups CRUD + contact filter
# =========================
class TestGroups:
    created_group_id = None
    created_contact_id = None

    def test_list_groups_ok(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/groups", headers=owner_h, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_create_group(self, owner_h):
        payload = {"name": "TEST_V17_Group", "color": "#FF5722", "description": "TEST group"}
        r = requests.post(f"{BASE_URL}/api/groups", json=payload, headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["name"] == payload["name"]
        assert g["color"] == payload["color"]
        assert g["description"] == payload["description"]
        assert "group_id" in g
        assert g.get("member_count", 0) == 0
        TestGroups.created_group_id = g["group_id"]

        # verify persisted via LIST
        r2 = requests.get(f"{BASE_URL}/api/groups", headers=owner_h, timeout=15)
        ids = [x["group_id"] for x in r2.json()["items"]]
        assert g["group_id"] in ids

    def test_create_contact_with_group_and_filter(self, owner_h):
        assert TestGroups.created_group_id, "requires previous test"
        payload = {
            "first_name": "TESTV17",
            "last_name": "GroupMember",
            "phone": "+391110000000",
            "email": "testv17group@example.com",
            "area": "energy",
            "group_ids": [TestGroups.created_group_id],
        }
        r = requests.post(f"{BASE_URL}/api/contacts", json=payload, headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        c = r.json()
        assert TestGroups.created_group_id in c.get("group_ids", [])
        TestGroups.created_contact_id = c["contact_id"]

        # Filter by group_id
        r2 = requests.get(
            f"{BASE_URL}/api/contacts?group_id={TestGroups.created_group_id}",
            headers=owner_h,
            timeout=15,
        )
        assert r2.status_code == 200
        items = r2.json()["items"]
        ids = [x["contact_id"] for x in items]
        assert c["contact_id"] in ids
        # Every returned contact should have our group_id
        for it in items:
            assert TestGroups.created_group_id in it.get("group_ids", [])

    def test_group_contacts_endpoint(self, owner_h):
        gid = TestGroups.created_group_id
        r = requests.get(f"{BASE_URL}/api/groups/{gid}/contacts", headers=owner_h, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(c["contact_id"] == TestGroups.created_contact_id for c in items)

    def test_group_member_count_updated(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/groups", headers=owner_h, timeout=15)
        g = next(x for x in r.json()["items"] if x["group_id"] == TestGroups.created_group_id)
        assert g["member_count"] >= 1

    def test_update_group(self, owner_h):
        gid = TestGroups.created_group_id
        r = requests.put(
            f"{BASE_URL}/api/groups/{gid}",
            json={"name": "TEST_V17_Group_UPD", "color": "#00AA00"},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["name"] == "TEST_V17_Group_UPD"
        assert g["color"] == "#00AA00"

    def test_delete_group_removes_references(self, owner_h):
        gid = TestGroups.created_group_id
        r = requests.delete(f"{BASE_URL}/api/groups/{gid}", headers=owner_h, timeout=15)
        assert r.status_code == 200
        # group should no longer appear
        r2 = requests.get(f"{BASE_URL}/api/groups", headers=owner_h, timeout=15)
        assert not any(x["group_id"] == gid for x in r2.json()["items"])
        # contact should no longer reference the group
        cid = TestGroups.created_contact_id
        r3 = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        assert r3.status_code == 200
        assert gid not in r3.json().get("group_ids", [])
        # cleanup contact
        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)


# =========================
# SMTP config
# =========================
class TestSmtp:
    def test_get_smtp_default_shape(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/smtp/config", headers=owner_h, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "configured" in j
        assert "host" in j
        assert "password" not in j, "password must NEVER be returned by GET"

    def test_put_smtp_then_get_no_password(self, owner_h):
        cfg = {
            "host": "smtps.aruba.it",
            "port": 465,
            "username": "TEST_V17_user@dalpastro.it",
            "password": "TEST_FAKE_PASSWORD_v17",
            "sender_name": "TEST V17",
            "sender_email": "TEST_V17_sender@dalpastro.it",
            "use_ssl": True,
        }
        r = requests.put(f"{BASE_URL}/api/smtp/config", json=cfg, headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["host"] == cfg["host"]
        assert j["configured"] is True
        assert "password" not in j

        # GET returns configured=true but no password
        r2 = requests.get(f"{BASE_URL}/api/smtp/config", headers=owner_h, timeout=15)
        assert r2.status_code == 200
        j2 = r2.json()
        assert j2["configured"] is True
        assert j2["username"] == cfg["username"]
        assert "password" not in j2

    def test_smtp_test_with_fake_creds_returns_400(self, owner_h):
        # We have SMTP configured (fake) — /smtp/test should either
        # 400 with connection error OR 400 with 'Configurazione SMTP mancante'.
        # We expect 400 (auth/connect fail) since creds are fake.
        r = requests.post(
            f"{BASE_URL}/api/smtp/test",
            json={"to_email": "TEST_V17_receiver@example.com"},
            headers=owner_h,
            timeout=45,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_smtp_test_sub_user_forbidden(self, sub_h):
        r = requests.post(
            f"{BASE_URL}/api/smtp/test",
            json={"to_email": "x@example.com"},
            headers=sub_h,
            timeout=30,
        )
        assert r.status_code == 403


# =========================
# Bulk email + preview
# =========================
class TestBulk:
    created_group_id = None
    contact_ids = []

    def test_setup_group_and_contacts(self, owner_h):
        # Create fresh group + 2 contacts to use as recipients
        gr = requests.post(
            f"{BASE_URL}/api/groups",
            json={"name": "TEST_V17_Bulk", "color": "#123456"},
            headers=owner_h,
            timeout=15,
        )
        assert gr.status_code == 200
        gid = gr.json()["group_id"]
        TestBulk.created_group_id = gid

        for i in range(2):
            r = requests.post(
                f"{BASE_URL}/api/contacts",
                json={
                    "first_name": f"TESTV17BULK{i}",
                    "last_name": "Recipient",
                    "phone": f"+3911100000{i}",
                    "whatsapp": f"+3911100000{i}",
                    "telegram": f"@testv17_{i}",
                    "email": f"testv17bulk{i}@example.com",
                    "area": "energy",
                    "group_ids": [gid],
                },
                headers=owner_h,
                timeout=15,
            )
            assert r.status_code == 200, r.text
            TestBulk.contact_ids.append(r.json()["contact_id"])

    def test_bulk_preview_whatsapp(self, owner_h):
        r = requests.post(
            f"{BASE_URL}/api/bulk/preview",
            json={"channel": "whatsapp", "group_id": TestBulk.created_group_id},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) >= 2
        for it in items:
            assert "target" in it and "skip" in it and "contact_id" in it and "name" in it
            # our test contacts all have whatsapp/phone
            if it["contact_id"] in TestBulk.contact_ids:
                assert it["skip"] is False
                assert it["target"].startswith("+")

    def test_bulk_preview_telegram(self, owner_h):
        r = requests.post(
            f"{BASE_URL}/api/bulk/preview",
            json={"channel": "telegram", "group_id": TestBulk.created_group_id},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200
        items = r.json()["items"]
        for it in items:
            if it["contact_id"] in TestBulk.contact_ids:
                assert it["skip"] is False
                assert it["target"].startswith("@")

    def test_bulk_preview_sms(self, owner_h):
        r = requests.post(
            f"{BASE_URL}/api/bulk/preview",
            json={"channel": "sms", "group_id": TestBulk.created_group_id},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200
        items = r.json()["items"]
        for it in items:
            if it["contact_id"] in TestBulk.contact_ids:
                assert it["skip"] is False

    def test_bulk_preview_no_recipients(self, owner_h):
        r = requests.post(
            f"{BASE_URL}/api/bulk/preview",
            json={"channel": "whatsapp"},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 400

    def test_bulk_email_with_fake_smtp_returns_all_failed(self, owner_h):
        # SMTP is configured with fake creds -> tenta invio, ogni contatto va in failed.
        r = requests.post(
            f"{BASE_URL}/api/bulk/email",
            json={
                "group_id": TestBulk.created_group_id,
                "subject": "TEST V17 bulk",
                "body_text": "Ciao {nome} {cognome}",
            },
            headers=owner_h,
            timeout=90,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "sent_count" in j and "failed_count" in j
        # All should fail because SMTP creds are fake
        assert j["failed_count"] >= 2
        assert j["sent_count"] == 0
        # Every failed entry must reference a real contact
        for f in j["failed"]:
            assert "contact_id" in f
            assert "reason" in f

    def test_cleanup_bulk(self, owner_h):
        for cid in TestBulk.contact_ids:
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        if TestBulk.created_group_id:
            requests.delete(f"{BASE_URL}/api/groups/{TestBulk.created_group_id}", headers=owner_h, timeout=15)


# =========================
# Bulk email WITHOUT SMTP -> 400  (must run AFTER reset of smtp)
# We can't easily reset password to empty here, so we test the negative branch
# by using a NEW tenant would be required. Skip this specific test if config already set.
# Instead we verify the message shape when SMTP is missing on a first fresh account.
# Given main agent instructs not to create second owner, we omit this negative and rely on
# smtp/test 400 already asserted.
# =========================


# =========================
# Team members
# =========================
class TestTeam:
    def test_owner_sees_sub(self, owner_h, sub_auth):
        r = requests.get(f"{BASE_URL}/api/team/members", headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert any(u.get("email") == SUB["email"] for u in items), f"owner should see sub in team roster, got: {items}"

    def test_sub_sees_owner(self, sub_h):
        r = requests.get(f"{BASE_URL}/api/team/members", headers=sub_h, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert any(u.get("email") == OWNER["email"] for u in items), f"sub should see owner in team roster, got: {items}"


# =========================
# Chat channels + messages
# =========================
class TestChat:
    channel_id = None

    def test_create_channel_owner_to_sub(self, owner_h, sub_auth):
        sub_user_id = sub_auth[1]["user_id"]
        r = requests.post(
            f"{BASE_URL}/api/chat/channels",
            json={"name": "TEST_V17_channel", "member_user_ids": [sub_user_id], "is_direct": True},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        ch = r.json()
        assert "channel_id" in ch
        # Creator auto-added
        assert len(ch["member_user_ids"]) == 2
        TestChat.channel_id = ch["channel_id"]

    def test_direct_channel_dedup(self, owner_h, sub_auth):
        sub_user_id = sub_auth[1]["user_id"]
        r = requests.post(
            f"{BASE_URL}/api/chat/channels",
            json={"name": "duplicate", "member_user_ids": [sub_user_id], "is_direct": True},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        ch = r.json()
        assert ch["channel_id"] == TestChat.channel_id, "1-1 direct channel must be deduped"

    def test_list_channels_visible_to_owner(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/chat/channels", headers=owner_h, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(c["channel_id"] == TestChat.channel_id for c in items)

    def test_list_channels_visible_to_sub(self, sub_h):
        r = requests.get(f"{BASE_URL}/api/chat/channels", headers=sub_h, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(c["channel_id"] == TestChat.channel_id for c in items)

    def test_send_text_message(self, owner_h):
        r = requests.post(
            f"{BASE_URL}/api/chat/channels/{TestChat.channel_id}/messages",
            json={"kind": "text", "text": "hello TEST_V17"},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["kind"] == "text"
        assert m["text"] == "hello TEST_V17"

    def test_send_link_message(self, owner_h):
        r = requests.post(
            f"{BASE_URL}/api/chat/channels/{TestChat.channel_id}/messages",
            json={"kind": "link", "link_url": "https://example.com", "link_title": "TEST V17 link"},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["kind"] == "link"
        assert m["link_url"] == "https://example.com"

    def test_list_messages_ordered_and_updates_last_message_at(self, sub_h):
        # Read all messages as sub
        r = requests.get(
            f"{BASE_URL}/api/chat/channels/{TestChat.channel_id}/messages",
            headers=sub_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) >= 2
        # Ordered by created_at ascending
        for i in range(1, len(items)):
            assert items[i - 1]["created_at"] <= items[i]["created_at"]

        # channel last_message_at updated
        r2 = requests.get(f"{BASE_URL}/api/chat/channels", headers=sub_h, timeout=15)
        ch = next(c for c in r2.json()["items"] if c["channel_id"] == TestChat.channel_id)
        assert ch.get("last_message") is not None
        assert ch["last_message"]["kind"] in ("text", "link")

    def test_cannot_send_to_foreign_channel(self, owner_h):
        r = requests.post(
            f"{BASE_URL}/api/chat/channels/ch_doesnotexist/messages",
            json={"kind": "text", "text": "x"},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 404

    def test_cleanup_channel(self, owner_h):
        if TestChat.channel_id:
            requests.delete(f"{BASE_URL}/api/chat/channels/{TestChat.channel_id}", headers=owner_h, timeout=15)


# =========================
# Contact vCard
# =========================
class TestVCard:
    def test_vcard_format(self, owner_h):
        # Create a contact
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            json={
                "first_name": "TESTV17",
                "last_name": "VCard",
                "phone": "+3911122233",
                "email": "vcardv17@example.com",
                "area": "energy",
            },
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200
        cid = r.json()["contact_id"]
        try:
            v = requests.get(f"{BASE_URL}/api/contacts/{cid}/vcard", headers=owner_h, timeout=15)
            assert v.status_code == 200
            ct = v.headers.get("content-type", "")
            assert ct.startswith("text/plain"), f"expected text/plain, got {ct}"
            text = v.text
            assert "BEGIN:VCARD" in text
            assert "END:VCARD" in text
            assert "TESTV17" in text
            assert "+3911122233" in text
        finally:
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)


# =========================
# Regression
# =========================
class TestRegression:
    def test_contacts_crud(self, owner_h):
        # CREATE
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            json={"first_name": "TEST_REG", "last_name": "V17", "area": "energy"},
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200
        cid = r.json()["contact_id"]
        # GET
        r2 = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["first_name"] == "TEST_REG"
        # PUT
        r3 = requests.put(
            f"{BASE_URL}/api/contacts/{cid}",
            json={"first_name": "TEST_REG_UPD"},
            headers=owner_h,
            timeout=15,
        )
        assert r3.status_code == 200
        assert r3.json()["first_name"] == "TEST_REG_UPD"
        # DELETE
        r4 = requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        assert r4.status_code == 200
        # verify 404
        r5 = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        assert r5.status_code == 404

    def test_appointments_list(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/appointments", headers=owner_h, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_settings(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/settings", headers=owner_h, timeout=15)
        assert r.status_code == 200
        assert "app_name" in r.json()
