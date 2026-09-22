"""V50.z327 — Contratto Axon Core ↔ AxonOS Lite.
Simula il client Lite esattamente come descritto in /app/memory/AXON_CORE_LITE_PROMPT.md:
ogni endpoint citato nel prompt deve esistere e rispondere con la forma attesa per un utente `product: "lite"`.
"""
import os
import uuid
import time
import requests

B = os.environ.get("TEST_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com") + "/api"
EMAIL = f"lite_{uuid.uuid4().hex[:8]}@axonlite-test.com"
PWD = "LiteTest123!"
S = {}


def h():
    return {"Authorization": f"Bearer {S['token']}"}


def _flat(j):
    if isinstance(j, list):
        return j
    if "sections" in j:
        return [i for s in j["sections"] for i in s.get("items", [])]
    return j.get("items", [])


def test_01_manifest_public():
    r = requests.get(B + "/axon/core/manifest", timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    ids = {p["id"] for p in j["products"]}
    assert {"advisor", "lite"} <= ids
    lite = next(p for p in j["products"] if p["id"] == "lite")
    assert lite["label"] == "AxonOS Lite"
    for ep in ["/assistant/chat", "/axon/memory", "/axon/proactive/items", "/promo/redeem", "/referral/me", "/subscription/status", "/user-settings", "/axon/setup/state"]:
        assert any(ep in e for e in j["shared_endpoints"]), f"manifest non elenca {ep}"


def test_02_register_lite_and_login():
    r = requests.post(B + "/auth/register", json={"email": EMAIL, "password": PWD, "name": "Lite Tester", "product": "lite"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    r = requests.post(B + "/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "token" in j and "user" in j
    S["token"] = j["token"]
    S["user_id"] = j["user"]["user_id"]
    me = requests.get(B + "/auth/me", headers=h(), timeout=30).json()["user"]
    assert me["product"] == "lite", me


def test_03_core_me_features():
    r = requests.get(B + "/axon/core/me", headers=h(), timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["product"] == "lite" and j["label"] == "AxonOS Lite"
    for f in ["axon_chat", "axon_memory", "axon_proactive", "axon_voice", "personal_space", "notes", "reminders", "calendar", "promo", "referral"]:
        assert f in j["features"], f"feature {f} mancante in Lite"
    assert "crm" not in j["features"] and "team" not in j["features"]


def test_04_user_settings_identity():
    r = requests.put(B + "/user-settings", headers=h(), json={"assistant_name": "Viola", "assistant_voice": "nova", "assistant_setup_done": True, "activation_done": True, "onboarding_done": True}, timeout=30)
    assert r.status_code == 200, r.text
    g = requests.get(B + "/user-settings", headers=h(), timeout=30).json()
    assert g["assistant_name"] == "Viola" and g["assistant_setup_done"] is True


def test_05_chat_lite_identity_no_crm():
    r = requests.post(B + "/assistant/chat", headers=h(), json={"message": "Ciao! Chi sei e cosa puoi fare per me? Posso gestire i miei clienti e il team da qui?"}, timeout=120)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("reply"), j
    S["session_id"] = j.get("session_id")
    low = j["reply"].lower()
    # non deve promettere CRM/team ad un utente Lite
    assert "advisoros" not in low or "lite" in low, j["reply"][:300]
    assert not any(k in low for k in ["apri la scheda cliente", "[[nav:/(tabs)/contatti", "[[nav:/team"]), j["reply"][:400]
    assert "reply" in j and "session_id" in j


def test_06_chat_stream_sse():
    with requests.post(B + "/assistant/chat/stream", headers=h(), json={"message": "Ricordami di bere acqua alle 15", "session_id": S.get("session_id")}, stream=True, timeout=120) as r:
        assert r.status_code == 200, r.text[:300]
        assert "text/event-stream" in r.headers.get("content-type", ""), r.headers
        got = b""
        for chunk in r.iter_content(chunk_size=None):
            got += chunk
            if len(got) > 200:
                break
        assert got, "stream vuoto"


def test_07_tts():
    r = requests.post(B + "/assistant/tts", headers=h(), json={"text": "Ciao, sono Viola."}, timeout=90)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    assert j.get("audio_base64") or j.get("audio") or j.get("data"), list(j.keys())


def test_08_memory_private():
    r = requests.post(B + "/axon/memory", headers=h(), json={"section": "comunicazione", "text": "Rispondimi sempre in modo breve e amichevole"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    item = r.json()
    iid = item.get("item_id") or item.get("id") or (item.get("item") or {}).get("item_id")
    assert iid, item
    g = requests.get(B + "/axon/memory", headers=h(), timeout=30)
    assert g.status_code == 200
    items = _flat(g.json())
    assert any((i.get("item_id") or i.get("id")) == iid for i in items), g.json()
    u = requests.put(B + f"/axon/memory/{iid}", headers=h(), json={"text": "Mi piace il caffè lungo"}, timeout=30)
    assert u.status_code == 200, u.text
    a = requests.post(B + "/axon/memory/analyze", headers=h(), json={}, timeout=120)
    assert a.status_code in (200, 202), a.text[:200]
    d = requests.delete(B + f"/axon/memory/{iid}", headers=h(), timeout=30)
    assert d.status_code in (200, 204), d.text


def test_09_personal_space_summary():
    r = requests.get(B + "/axon/personal-space/summary", headers=h(), timeout=60)
    assert r.status_code == 200, r.text[:200]


def test_10_proactive_and_reminders():
    r = requests.get(B + "/axon/proactive/config", headers=h(), timeout=30)
    assert r.status_code == 200, r.text
    r = requests.put(B + "/axon/proactive/config", headers=h(), json={"enabled": True}, timeout=30)
    assert r.status_code == 200, r.text
    r = requests.post(B + "/axon/proactive/trigger", headers=h(), json={}, timeout=120)
    assert r.status_code in (200, 202), r.text[:200]
    r = requests.get(B + "/axon/proactive/items", headers=h(), timeout=30)
    assert r.status_code == 200, r.text
    r = requests.post(B + "/axon/proactive/reminders", headers=h(), json={"text": "Chiamare la mamma", "due_at": time.strftime("%Y-%m-%dT18:00:00", time.gmtime(time.time() + 86400))}, timeout=30)
    assert r.status_code in (200, 201), r.text
    rid = r.json().get("reminder_id") or r.json().get("id") or (r.json().get("item") or {}).get("reminder_id")
    g = requests.get(B + "/axon/proactive/reminders", headers=h(), timeout=30)
    assert g.status_code == 200
    if rid:
        d = requests.delete(B + f"/axon/proactive/reminders/{rid}", headers=h(), timeout=30)
        assert d.status_code in (200, 204), d.text


def test_11_promo_referral_subscription():
    r = requests.post(B + "/promo/redeem", headers=h(), json={"code": "NON-ESISTE-XYZ"}, timeout=30)
    assert r.status_code == 404, r.text
    r = requests.get(B + "/promo/my", headers=h(), timeout=30)
    assert r.status_code == 200, r.text
    r = requests.get(B + "/referral/me", headers=h(), timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    for k in ["code", "share_path", "share_text", "reward_inviter", "reward_invitee", "friends_count", "days_earned", "friends"]:
        assert k in j, f"referral/me manca {k}"
    assert j["share_path"] == f"/login?ref={j['code']}"
    assert "summary" in j["reward_inviter"] and "summary" in j["reward_invitee"]
    # il proprio codice amico → 400
    r = requests.post(B + "/promo/redeem", headers=h(), json={"code": j["code"]}, timeout=30)
    assert r.status_code == 400, r.text
    r = requests.get(B + "/subscription/status", headers=h(), timeout=30)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["status"] in ("trial", "active", "expired", "free_forever"), s
    assert "days_left" in s and "expires_at" in s


def test_12_setup_state():
    r = requests.get(B + "/axon/setup/state", headers=h(), timeout=30)
    assert r.status_code == 200, r.text
    r = requests.put(B + "/axon/setup/state", headers=h(), json=r.json() if isinstance(r.json(), dict) else {}, timeout=30)
    assert r.status_code == 200, r.text[:200]


def test_13_isolation_from_advisor_tenant():
    """Un utente Lite NON deve vedere dati CRM di altri tenant e la memoria di Advisor non deve trapelare."""
    owner = requests.post(B + "/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=30).json()
    oh = {"Authorization": f"Bearer {owner['token']}"}
    oitems = _flat(requests.get(B + "/axon/memory", headers=oh, timeout=30).json())
    litems = _flat(requests.get(B + "/axon/memory", headers=h(), timeout=30).json())
    oids = {(i.get("item_id") or i.get("id")) for i in oitems}
    lids = {(i.get("item_id") or i.get("id")) for i in litems}
    assert not (oids & lids), "memoria condivisa tra Advisor e Lite!"
    r = requests.get(B + "/contacts", headers=h(), timeout=30)
    assert r.status_code in (200, 403)
    if r.status_code == 200:
        items = r.json().get("items", r.json())
        assert len(items) == 0, "utente Lite vede contatti di altri tenant"
