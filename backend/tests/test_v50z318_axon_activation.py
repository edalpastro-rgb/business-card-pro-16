# V50.z318 — Backend tests for AxonOS activation flow and ViolaWake routing
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --- user-settings flags ---
def test_user_settings_has_activation_flags(headers):
    r = requests.get(f"{API}/user-settings", headers=headers, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "assistant_setup_done" in d
    assert "activation_done" in d
    assert isinstance(d["assistant_setup_done"], bool)
    assert isinstance(d["activation_done"], bool)


def test_reset_activation_flags(headers):
    r = requests.put(f"{API}/user-settings", headers=headers, json={"assistant_setup_done": False, "activation_done": False}, timeout=15)
    assert r.status_code == 200
    g = requests.get(f"{API}/user-settings", headers=headers, timeout=15).json()
    assert g["assistant_setup_done"] is False
    assert g["activation_done"] is False


# --- ViolaWake route command classification ---
@pytest.mark.parametrize("transcript,expected", [
    ("Axon fai l'effetto", "effect"),
    ("dove sei", "find_phone"),
    ("trova il mio telefono", "find_phone"),
    ("stop", "cancel"),
])
def test_viola_route_local_commands(headers, transcript, expected):
    r = requests.post(f"{API}/viola-wake/route", headers=headers, json={"transcript": transcript}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["mode"] == expected, f"transcript='{transcript}' → {d}"


def test_viola_route_normal_chat(headers):
    r = requests.post(f"{API}/viola-wake/route", headers=headers, json={"transcript": "che ore sono"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["mode"] == "chat"
