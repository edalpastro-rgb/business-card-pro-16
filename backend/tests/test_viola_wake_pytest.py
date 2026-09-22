"""V50.z315 — ViolaWake backend pytest suite.

Runs against the public EXPO_PUBLIC_BACKEND_URL so we exercise the same URL
users hit. Covers:
- settings shape, module toggle, permission gating
- validation errors (400 stt_engine / 422 sensitivity range)
- deterministic routing (chat / trigger / cancel + wake-word stripping)
- events log + module OFF cascading disable of user settings
- leaves module enabled at the end for UI regression tests
"""
import os
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"
OWNER = ("test@dalpastro.it", "Test1234!")
SUB = ("sub1@dalpastro.it", "Sub12345!")


def _login(email, pwd):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_h():
    return {"Authorization": f"Bearer {_login(*OWNER)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sub_h():
    return {"Authorization": f"Bearer {_login(*SUB)}", "Content-Type": "application/json"}


# ---- module toggle + permission gating ----

class TestModuleToggle:
    def test_sub_cannot_toggle_module(self, sub_h):
        r = requests.put(f"{BASE}/viola-wake/module", headers=sub_h, json={"enabled": True}, timeout=30)
        assert r.status_code == 403, r.text

    def test_owner_disables_module(self, owner_h):
        r = requests.put(f"{BASE}/viola-wake/module", headers=owner_h, json={"enabled": False}, timeout=30)
        assert r.status_code == 200
        assert r.json()["module"]["enabled"] is False

    def test_sub_cannot_enable_settings_when_module_off(self, sub_h, owner_h):
        # ensure module OFF
        requests.put(f"{BASE}/viola-wake/module", headers=owner_h, json={"enabled": False}, timeout=30)
        r = requests.put(f"{BASE}/viola-wake/settings", headers=sub_h, json={"enabled": True}, timeout=30)
        assert r.status_code == 403, r.text


# ---- settings shape + validation ----

class TestSettings:
    def test_get_settings_shape(self, sub_h):
        r = requests.get(f"{BASE}/viola-wake/settings", headers=sub_h, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert set(["module", "is_master", "settings", "trigger_rules"]).issubset(data.keys())
        assert set(["enabled", "sensitivity", "stt_engine", "keyword_mode", "speak_reply", "confirm_sound", "listen_seconds"]).issubset(data["settings"].keys())
        assert data["is_master"] is False

    def test_owner_enables_then_sub_updates(self, owner_h, sub_h):
        requests.put(f"{BASE}/viola-wake/module", headers=owner_h, json={"enabled": True, "note": "test"}, timeout=30).raise_for_status()
        r = requests.put(f"{BASE}/viola-wake/settings", headers=sub_h,
                         json={"enabled": True, "sensitivity": 0.8, "stt_engine": "device", "listen_seconds": 8},
                         timeout=30)
        assert r.status_code == 200, r.text
        st = r.json()["settings"]
        assert st["enabled"] is True and st["sensitivity"] == 0.8 and st["stt_engine"] == "device" and st["listen_seconds"] == 8

    def test_invalid_stt_engine(self, sub_h):
        r = requests.put(f"{BASE}/viola-wake/settings", headers=sub_h, json={"stt_engine": "x"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_sensitivity_out_of_range(self, sub_h):
        r = requests.put(f"{BASE}/viola-wake/settings", headers=sub_h, json={"sensitivity": 1.5}, timeout=30)
        assert r.status_code == 422, r.text


# ---- deterministic routing ----

@pytest.mark.parametrize("text,mode,action", [
    ("Viola, che appuntamenti ho domani?", "chat", None),
    ("Ehi Viola briefing", "trigger", "briefing"),
    ("viola controlla tutto", "trigger", "scan"),
    ("Viola com'è andata la settimana", "trigger", "weekly_report"),
    ("Viola annulla", "cancel", None),
    ("cerca sul web il prezzo del PUN", "chat", None),
])
def test_routing(sub_h, text, mode, action):
    r = requests.post(f"{BASE}/viola-wake/route", headers=sub_h, json={"transcript": text}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["mode"] == mode, (text, data)
    assert data.get("action") == action
    if mode == "chat":
        assert not data["prompt"].lower().startswith("viola"), data
    if mode == "cancel":
        assert data.get("reply") == "OK!"


# ---- events + module OFF cascade ----

class TestEvents:
    def test_log_and_list_event(self, sub_h):
        r = requests.post(f"{BASE}/viola-wake/event", headers=sub_h,
                          json={"kind": "wake", "platform": "android", "engine": "porcupine"}, timeout=30)
        assert r.status_code == 200 and r.json()["ok"]
        ev = requests.get(f"{BASE}/viola-wake/events?limit=5", headers=sub_h, timeout=30).json()
        assert ev["total"] >= 1 and any(i["kind"] == "wake" for i in ev["items"])


class TestModuleCascade:
    def test_module_off_disables_user(self, owner_h, sub_h):
        # ensure enabled + user enabled
        requests.put(f"{BASE}/viola-wake/module", headers=owner_h, json={"enabled": True}, timeout=30)
        requests.put(f"{BASE}/viola-wake/settings", headers=sub_h, json={"enabled": True}, timeout=30)
        # master disables module
        requests.put(f"{BASE}/viola-wake/module", headers=owner_h, json={"enabled": False}, timeout=30).raise_for_status()
        st = requests.get(f"{BASE}/viola-wake/settings", headers=sub_h, timeout=30).json()
        assert st["settings"]["enabled"] is False


@pytest.fixture(scope="module", autouse=True)
def _final_leave_module_on(owner_h):
    yield
    # final teardown: leave module enabled for UI tests
    requests.put(f"{BASE}/viola-wake/module", headers=owner_h, json={"enabled": True, "note": "test"}, timeout=30)
