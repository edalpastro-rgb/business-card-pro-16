"""
V50.z370/z371 — Backend tests for:
- /api/voice-devices/* (device selection: Block 1)
- /api/voice-guard/* + /api/viola-wake/route (critical command guard: Block 4)
- /api/voice/copilot/execute (guard + CRM-first regression)
"""
import os
import time
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if v:
        return v
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not configured")


BASE = _load_backend_url().rstrip("/") + "/api"
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"
PIN = "123456"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


DK_PHONE = f"test-phone-{int(time.time())}"
DK_DESK = f"test-desktop-{int(time.time())}"
_STATE: dict = {}


# ============================================================
# BLOCK 1 — Voice devices
# ============================================================
class TestVoiceDevices:
    def test_1_single_device_wake_respond(self, H):
        # cleanup first
        requests.post(f"{BASE}/voice-devices/release", json={"device_key": DK_PHONE}, headers=H, timeout=10)
        requests.post(f"{BASE}/voice-devices/release", json={"device_key": DK_DESK}, headers=H, timeout=10)
        r = requests.post(f"{BASE}/voice-devices/wake", json={"device_key": DK_PHONE, "kind": "phone"}, headers=H, timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["mode"] == "respond", j

    def test_2_second_device_causes_ask(self, H):
        # desktop heartbeat
        r = requests.post(f"{BASE}/voice-devices/heartbeat",
                          json={"device_key": DK_DESK, "kind": "desktop", "listening": True},
                          headers=H, timeout=10)
        assert r.status_code == 200
        # wake from phone → should ask
        r = requests.post(f"{BASE}/voice-devices/wake", json={"device_key": DK_PHONE, "kind": "phone"}, headers=H, timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["mode"] == "ask", j
        assert "prompt" in j and j["prompt"]

    def test_3_select_phone_is_me(self, H):
        r = requests.post(f"{BASE}/voice-devices/select",
                          json={"device_key": DK_PHONE, "transcript": "dal telefono", "kind": "phone"},
                          headers=H, timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert j["is_me"] is True
        assert j.get("active_kind") == "phone"

    def test_4_wake_desktop_silent_phone_respond(self, H):
        r = requests.post(f"{BASE}/voice-devices/wake",
                          json={"device_key": DK_DESK, "kind": "desktop"}, headers=H, timeout=10)
        assert r.status_code == 200
        assert r.json()["mode"] == "silent"
        r2 = requests.post(f"{BASE}/voice-devices/wake",
                           json={"device_key": DK_PHONE, "kind": "phone"}, headers=H, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["mode"] == "respond"

    def test_5_switch_to_desktop(self, H):
        r = requests.post(f"{BASE}/voice-devices/select",
                          json={"device_key": DK_PHONE, "transcript": "passa al desktop", "kind": "phone"},
                          headers=H, timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert "desktop" in (j.get("message") or "").lower()
        # wake desktop → respond
        r2 = requests.post(f"{BASE}/voice-devices/wake",
                           json={"device_key": DK_DESK, "kind": "desktop"}, headers=H, timeout=10)
        assert r2.json()["mode"] == "respond"

    def test_6_release_desktop_frees_session(self, H):
        r = requests.post(f"{BASE}/voice-devices/release",
                          json={"device_key": DK_DESK}, headers=H, timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("session_released") is True
        # wake phone → respond (session freed)
        r2 = requests.post(f"{BASE}/voice-devices/wake",
                           json={"device_key": DK_PHONE, "kind": "phone"}, headers=H, timeout=10)
        assert r2.json()["mode"] == "respond"

    def test_7_get_status_active_devices(self, H):
        r = requests.get(f"{BASE}/voice-devices", headers=H, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert "active_devices" in j
        assert isinstance(j["active_devices"], list)

    def test_zz_cleanup(self, H):
        requests.post(f"{BASE}/voice-devices/release", json={"device_key": DK_PHONE}, headers=H, timeout=10)
        requests.post(f"{BASE}/voice-devices/release", json={"device_key": DK_DESK}, headers=H, timeout=10)


# ============================================================
# BLOCK 4 — Voice guard
# ============================================================
class TestVoiceGuard:
    def test_1_status_has_pin(self, H):
        r = requests.get(f"{BASE}/voice-guard", headers=H, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["has_pin"] is True
        assert "categories" in j

    def test_2_verify_wrong_pin_403(self, H):
        r = requests.post(f"{BASE}/voice-guard/verify",
                          json={"pin": "000000", "category": "delete"}, headers=H, timeout=10)
        assert r.status_code == 403, r.text

    def test_3_verify_correct_pin_returns_token(self, H):
        r = requests.post(f"{BASE}/voice-guard/verify",
                          json={"pin": PIN, "category": "delete"}, headers=H, timeout=10)
        assert r.status_code == 200, r.text
        tok = r.json()["guard_token"]
        assert tok
        _STATE["guard_token"] = tok

    def test_4_route_critical_without_token_returns_guard(self, H):
        r = requests.post(f"{BASE}/viola-wake/route",
                          json={"transcript": "Axon cancella tutti i contatti"}, headers=H, timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["mode"] == "guard"
        assert j["category"] == "delete"

    def test_5_route_critical_with_token_returns_chat(self, H):
        # need a fresh token (previous one may have been consumed by no test)
        r0 = requests.post(f"{BASE}/voice-guard/verify",
                           json={"pin": PIN, "category": "delete"}, headers=H, timeout=10)
        tok = r0.json()["guard_token"]
        r = requests.post(f"{BASE}/viola-wake/route",
                          json={"transcript": "Axon cancella tutti i contatti", "guard_token": tok}, headers=H, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["mode"] == "chat", j
        # reuse SAME token → guard again (single-use)
        r2 = requests.post(f"{BASE}/viola-wake/route",
                           json={"transcript": "Axon cancella tutti i contatti", "guard_token": tok}, headers=H, timeout=10)
        assert r2.json()["mode"] == "guard"

    def test_6_route_annulla_is_cancel(self, H):
        r = requests.post(f"{BASE}/viola-wake/route",
                          json={"transcript": "Axon annulla"}, headers=H, timeout=10)
        assert r.status_code == 200
        assert r.json()["mode"] == "cancel"

    def test_7_route_non_critical_chat(self, H):
        r = requests.post(f"{BASE}/viola-wake/route",
                          json={"transcript": "Axon che ore sono"}, headers=H, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["mode"] == "chat", j

    def test_8_biometric_ok_returns_token(self, H):
        r = requests.post(f"{BASE}/voice-guard/biometric-ok",
                          json={"category": "settings"}, headers=H, timeout=10)
        assert r.status_code == 200
        assert r.json()["guard_token"]


# ============================================================
# Drive: voice/copilot/execute — guard + regression
# ============================================================
class TestVoiceCopilotDriveGuard:
    def test_1_delete_without_token_returns_guard_required(self, H):
        r = requests.post(f"{BASE}/voice/copilot/execute",
                          json={"transcript": "Elimina il cliente Rossi", "want_audio": False},
                          headers=H, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["intent"] == "guard_required", j

    def test_2_delete_with_token_bypasses_guard(self, H):
        tok = requests.post(f"{BASE}/voice-guard/verify",
                            json={"pin": PIN, "category": "delete"}, headers=H, timeout=10).json()["guard_token"]
        r = requests.post(f"{BASE}/voice/copilot/execute",
                          json={"transcript": "Elimina il cliente Rossi", "want_audio": False, "guard_token": tok},
                          headers=H, timeout=45)
        assert r.status_code in (200, 404, 422), r.text
        # If 200 it must not be guard_required anymore
        if r.status_code == 200:
            assert r.json()["intent"] != "guard_required", r.json()


# ============================================================
# Regression: CRM-first (V50.z368) still works for non-critical
# ============================================================
class TestCopilotCRMRegression:
    def test_1_create_contact(self, H):
        r = requests.post(f"{BASE}/contacts",
                          json={"first_name": "Carlo", "last_name": "Colferai", "phone": "3331112233",
                                "area": "energy"},
                          headers=H, timeout=15)
        assert r.status_code in (200, 201), r.text
        cid = r.json().get("id") or r.json().get("contact_id")
        assert cid
        _STATE["carlo_id"] = cid

    def test_2_query_phone_exact(self, H):
        r = requests.post(f"{BASE}/voice/copilot/execute",
                          json={"transcript": "Che numero ha Colferai?", "want_audio": False},
                          headers=H, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        intent = j["intent"]
        # Some LLM runs return confirm_contact for surnames — do follow-up
        if intent == "confirm_contact":
            cid = j.get("extra", {}).get("pending_contact_id")
            r2 = requests.post(f"{BASE}/voice/copilot/execute",
                               json={"transcript": "sì esatto lui", "want_audio": False,
                                     "pending_contact_id": cid,
                                     "pending_question": "Che numero ha Colferai?"},
                               headers=H, timeout=60)
            assert r2.status_code == 200, r2.text
            j = r2.json()
            assert j["intent"] == "query", j
        else:
            assert intent == "query", j
        spoken = (j.get("spoken") or "") + " " + str(j.get("params", {}).get("answer") or "")
        assert "333" in spoken or "3331112233" in spoken, f"phone not in spoken: {spoken}"

    def test_3_confirm_contact_partial_match(self, H):
        r = requests.post(f"{BASE}/voice/copilot/execute",
                          json={"transcript": "Qual è il telefono di col ferraio?", "want_audio": False},
                          headers=H, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["intent"] == "confirm_contact", j
        conf = (j.get("confirmation") or "") + " " + (j.get("spoken") or "")
        assert "Carlo Colferai" in conf, conf

    def test_4_cleanup_contact(self, H):
        cid = _STATE.get("carlo_id")
        if cid:
            requests.delete(f"{BASE}/contacts/{cid}", headers=H, timeout=15)
