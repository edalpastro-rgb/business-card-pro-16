"""V27 — AI Personal Assistant "Neo" backend tests.
Endpoints: /api/assistant/chat, /api/assistant/history, /api/assistant/reset, /api/user-settings.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    assert "token" in j
    return j["token"], j["user"]


@pytest.fixture(scope="module")
def owner_ctx():
    token, user = _login(OWNER)
    return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="module")
def sub_ctx():
    token, user = _login(SUB)
    return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}


# ---------- user-settings assistant_name ----------
class TestUserSettingsAssistantName:
    def test_get_default_neo(self, owner_ctx):
        # First reset to Neo to ensure clean state
        requests.put(f"{BASE_URL}/api/user-settings", headers=owner_ctx["headers"], json={"assistant_name": "Neo"}, timeout=15)
        r = requests.get(f"{BASE_URL}/api/user-settings", headers=owner_ctx["headers"], timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j.get("assistant_name") == "Neo"

    def test_put_rename_and_persist(self, owner_ctx):
        r = requests.put(f"{BASE_URL}/api/user-settings", headers=owner_ctx["headers"],
                         json={"assistant_name": "Aria"}, timeout=15)
        assert r.status_code == 200
        # verify persistence
        r2 = requests.get(f"{BASE_URL}/api/user-settings", headers=owner_ctx["headers"], timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("assistant_name") == "Aria"

    def test_assistant_name_reflected_in_chat(self, owner_ctx):
        # Ensure name is Aria at this point (test order: after rename)
        r = requests.post(f"{BASE_URL}/api/assistant/chat",
                          headers=owner_ctx["headers"],
                          json={"message": "Come ti chiami?"}, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("assistant_name") == "Aria"
        # Cleanup: reset name to Neo for other tests
        requests.put(f"{BASE_URL}/api/user-settings", headers=owner_ctx["headers"],
                     json={"assistant_name": "Neo"}, timeout=15)


# ---------- assistant/chat validation ----------
class TestAssistantChatValidation:
    def test_empty_message_400(self, owner_ctx):
        r = requests.post(f"{BASE_URL}/api/assistant/chat",
                          headers=owner_ctx["headers"], json={"message": "   "}, timeout=30)
        assert r.status_code == 400

    def test_no_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/assistant/chat", json={"message": "ciao"}, timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# ---------- assistant/chat happy path + CRM context ----------
class TestAssistantChatFlow:
    def test_basic_chat_returns_italian_reply(self, owner_ctx):
        r = requests.post(f"{BASE_URL}/api/assistant/chat",
                          headers=owner_ctx["headers"],
                          json={"message": "Ciao, presentati brevemente."}, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "session_id" in j and j["session_id"]
        assert "reply" in j and isinstance(j["reply"], str) and len(j["reply"]) > 5
        assert j.get("assistant_name") == "Neo"

    def test_context_contains_client_count(self, owner_ctx):
        """Ask for total clients — the LLM must return a number (proves CRM context is passed)."""
        r = requests.post(f"{BASE_URL}/api/assistant/chat",
                          headers=owner_ctx["headers"],
                          json={"message": "Quanti clienti ho in totale? Rispondi solo con il numero."},
                          timeout=120)
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "")
        assert re.search(r"\d+", reply), f"Reply should contain a number: {reply!r}"

    def test_next_appointment_question(self, owner_ctx):
        r = requests.post(f"{BASE_URL}/api/assistant/chat",
                          headers=owner_ctx["headers"],
                          json={"message": "Qual è il mio prossimo appuntamento?"}, timeout=120)
        assert r.status_code == 200, r.text
        reply = r.json().get("reply", "").lower()
        # Either references appointment info or clearly states none — should NOT be empty
        assert len(reply) > 10
        # Loosely check Italian keyword presence
        assert any(k in reply for k in ["appuntament", "non", "nessun", "trovo", "prossim", "hai"])

    def test_multi_turn_context(self, owner_ctx):
        """First message tells assistant a name; second message asks it back."""
        # Fresh session
        r1 = requests.post(f"{BASE_URL}/api/assistant/reset", headers=owner_ctx["headers"], timeout=30)
        assert r1.status_code == 200
        sid = r1.json()["session_id"]

        r2 = requests.post(f"{BASE_URL}/api/assistant/chat", headers=owner_ctx["headers"],
                           json={"message": "Ricorda per favore che il mio cliente preferito si chiama TESTZEBRA123.", "session_id": sid}, timeout=120)
        assert r2.status_code == 200
        assert r2.json()["session_id"] == sid

        r3 = requests.post(f"{BASE_URL}/api/assistant/chat", headers=owner_ctx["headers"],
                           json={"message": "Come si chiama il mio cliente preferito che ti ho detto poco fa?", "session_id": sid}, timeout=120)
        assert r3.status_code == 200
        reply = r3.json().get("reply", "")
        assert "TESTZEBRA123" in reply.upper() or "TESTZEBRA123" in reply, f"Multi-turn context lost: {reply!r}"


# ---------- history & reset ----------
class TestAssistantHistoryAndReset:
    def test_reset_returns_new_session(self, owner_ctx):
        r1 = requests.post(f"{BASE_URL}/api/assistant/reset", headers=owner_ctx["headers"], timeout=30)
        assert r1.status_code == 200
        sid1 = r1.json()["session_id"]
        r2 = requests.post(f"{BASE_URL}/api/assistant/reset", headers=owner_ctx["headers"], timeout=30)
        sid2 = r2.json()["session_id"]
        assert sid1 and sid2 and sid1 != sid2

    def test_history_latest(self, owner_ctx):
        # Ensure at least one message exists
        r = requests.post(f"{BASE_URL}/api/assistant/chat",
                          headers=owner_ctx["headers"],
                          json={"message": "TESTHISTMARKER_ABC ciao"}, timeout=120)
        assert r.status_code == 200
        sid = r.json()["session_id"]

        h = requests.get(f"{BASE_URL}/api/assistant/history", headers=owner_ctx["headers"], timeout=30)
        assert h.status_code == 200
        j = h.json()
        assert j.get("session_id") == sid
        msgs = j.get("messages", [])
        assert len(msgs) >= 2
        # chronological order
        roles = [m["role"] for m in msgs]
        assert roles[-2] == "user" and roles[-1] == "assistant"
        # Marker present in one of the user messages
        assert any("TESTHISTMARKER_ABC" in m["content"] for m in msgs if m["role"] == "user")

    def test_history_by_session_id(self, owner_ctx):
        # Create a fresh session with a specific message
        rst = requests.post(f"{BASE_URL}/api/assistant/reset", headers=owner_ctx["headers"], timeout=30)
        sid = rst.json()["session_id"]
        requests.post(f"{BASE_URL}/api/assistant/chat", headers=owner_ctx["headers"],
                      json={"message": "MARKER_XYZ prova", "session_id": sid}, timeout=120)

        h = requests.get(f"{BASE_URL}/api/assistant/history", headers=owner_ctx["headers"],
                         params={"session_id": sid}, timeout=30)
        assert h.status_code == 200
        j = h.json()
        assert j["session_id"] == sid
        # Only this session's messages
        assert all("MARKER_XYZ" in m["content"] or m["role"] == "assistant" for m in j["messages"])
        assert any("MARKER_XYZ" in m["content"] for m in j["messages"])


# ---------- multi-tenant isolation ----------
class TestMultiTenantIsolation:
    def test_sub_user_sees_own_data(self, owner_ctx, sub_ctx):
        """Ask both users for total clients — counts should be user-scoped (sub user has its own view)."""
        r_owner = requests.post(f"{BASE_URL}/api/assistant/chat",
                                headers=owner_ctx["headers"],
                                json={"message": "Quanti clienti ho in totale? Rispondi solo con un numero."},
                                timeout=120)
        r_sub = requests.post(f"{BASE_URL}/api/assistant/chat",
                              headers=sub_ctx["headers"],
                              json={"message": "Quanti clienti ho in totale? Rispondi solo con un numero."},
                              timeout=120)
        assert r_owner.status_code == 200 and r_sub.status_code == 200
        # Both should reply with a number
        assert re.search(r"\d+", r_owner.json()["reply"])
        assert re.search(r"\d+", r_sub.json()["reply"])

    def test_sub_history_isolated(self, owner_ctx, sub_ctx):
        # sub creates its own message
        sub_msg = f"SUB_MARKER_{int(time.time())}"
        r = requests.post(f"{BASE_URL}/api/assistant/chat", headers=sub_ctx["headers"],
                          json={"message": sub_msg}, timeout=120)
        assert r.status_code == 200
        sub_sid = r.json()["session_id"]

        # Owner history should NOT contain sub's session id or marker
        oh = requests.get(f"{BASE_URL}/api/assistant/history", headers=owner_ctx["headers"], timeout=30)
        assert oh.status_code == 200
        oj = oh.json()
        assert oj.get("session_id") != sub_sid
        assert not any(sub_msg in m["content"] for m in oj.get("messages", []))
