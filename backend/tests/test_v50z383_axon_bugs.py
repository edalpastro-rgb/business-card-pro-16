# V50.z383 — TTS Italian default + single engine, NAV impostazioni?section=axon, unread endpoint
import os
import time
import base64
import concurrent.futures as cf
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
EMAIL = "test@dalpastro.it"
PASS = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASS}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    tok = d.get("token") or d.get("access_token")
    assert tok, d
    return tok


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- TTS: engine + Italian + single engine ----------------
def test_tts_engine_status(H):
    r = requests.get(f"{API}/tts/engine", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("engine") == "cloud", d
    assert d.get("local_disabled") is True, d


def test_tts_italian_default(H):
    r = requests.post(f"{API}/assistant/tts", headers=H,
                      json={"text": "Ciao, come posso aiutarti?"}, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("engine") == "openai", d
    assert d.get("lang") == "it", d
    assert d.get("mime") == "audio/mpeg", d
    assert d.get("audio_base64"), "audio_base64 missing"
    # sanity: base64 decodes
    raw = base64.b64decode(d["audio_base64"])
    assert len(raw) > 500


def _one_tts(H, text):
    r = requests.post(f"{API}/assistant/tts", headers=H, json={"text": text}, timeout=90)
    return r.status_code, r.json() if r.headers.get("content-type", "").startswith("application/json") else {}


def test_tts_parallel_single_engine(H):
    texts = ["Certo,", "Vai in Impostazioni AxonOS.", "Ecco i passaggi:"]
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(lambda t: _one_tts(H, t), texts))
    for status, body in results:
        assert status == 200, body
        assert body.get("engine") == "openai", body
        assert body.get("engine") != "kokoro"
        assert body.get("lang") == "it", body


# ---------------- Unread endpoint ----------------
def test_unread_endpoint(H):
    r = requests.get(f"{API}/assistant/unread", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "last_assistant_at" in d, d


def test_unread_advances_after_chat(H):
    r0 = requests.get(f"{API}/assistant/unread", headers=H, timeout=15).json()
    prev = r0.get("last_assistant_at")
    # send chat message
    rc = requests.post(f"{API}/assistant/chat", headers=H,
                       json={"message": "Ciao Axon, dimmi solo 'ok'."}, timeout=90)
    assert rc.status_code == 200, rc.text
    time.sleep(1)
    r1 = requests.get(f"{API}/assistant/unread", headers=H, timeout=15).json()
    new = r1.get("last_assistant_at")
    assert new, r1
    if prev:
        assert new >= prev, (prev, new)


# ---------------- Navigator NAV markers ----------------
@pytest.mark.parametrize("msg", [
    "Come cambio lingua, tono e voce di Axon?",
    "Dove sono le impostazioni AxonOS?",
])
def test_nav_impostazioni_section_axon(H, msg):
    r = requests.post(f"{API}/assistant/chat", headers=H, json={"message": msg}, timeout=90)
    assert r.status_code == 200, r.text
    reply = (r.json() or {}).get("reply", "")
    assert "[[NAV:/impostazioni?section=axon" in reply, f"missing correct NAV in reply: {reply[:400]}"
    assert "[[NAV:/axon-hub" not in reply, f"unexpected axon-hub NAV: {reply[:400]}"
    assert "[[NAV:/axon-voice" not in reply, f"unexpected axon-voice NAV: {reply[:400]}"
