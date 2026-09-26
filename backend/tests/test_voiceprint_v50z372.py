"""V50.z372 — Axon Voice System (Blocchi 2-3): impronta vocale SpeechBrain ECAPA.
Copre: /api/voiceprint/* (status/enroll/verify/profiles/settings), /api/viola-wake/{route,transcribe,events},
/api/ai/transcribe (verify_speaker), /api/voice/copilot/execute con permessi voci secondarie.
Backend con VP_MIN_SPEECH_SEC=20 (test). Owner test@dalpastro.it / Test1234!.
"""
import os
import time
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"
EMAIL = "test@dalpastro.it"
PW = "Test1234!"

# ---- shared session fixtures ----
@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    r = s.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def paragraphs(sess):
    r = sess.get(f"{BASE}/voiceprint/enroll/text", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data.get("paragraphs"), list) and len(data["paragraphs"]) >= 6
    assert data.get("min_speech_sec") == 20
    return data["paragraphs"]


def tts(sess, text, voice):
    r = sess.post(f"{BASE}/assistant/tts", json={"text": text, "voice": voice}, timeout=60)
    assert r.status_code == 200, f"tts {voice} {r.status_code}: {r.text[:200]}"
    j = r.json()
    return j["audio_base64"], j["mime"]


# ---- Feature: /voiceprint/status ----
def test_01_status_engine_ready_and_owner_profile(sess):
    # ensure engine loaded (lazy on first call)
    sess.post(f"{BASE}/voiceprint/engine/warmup", timeout=120)
    r = sess.get(f"{BASE}/voiceprint/status", timeout=30)
    assert r.status_code == 200
    j = r.json()
    for k in ("engine_ready", "enforced", "my_profile", "threshold", "level", "permission_keys"):
        assert k in j, f"missing {k} in status"
    assert isinstance(j["permission_keys"], list) and len(j["permission_keys"]) >= 5
    assert j["engine_ready"] is True
    # my_profile owner exists
    assert j["my_profile"] and j["my_profile"].get("name") == "Test Owner"


# ---- Feature: /voiceprint/enroll/text ----
def test_02_enroll_text_has_15_paragraphs(paragraphs):
    assert len(paragraphs) == 15


# ---- Feature: enroll owner flow + finish messaggio + 422 se prima del minimo ----
def test_03_enroll_owner_reenrollment(sess, paragraphs):
    # start owner
    st = sess.post(f"{BASE}/voiceprint/enroll/start", json={"role": "owner"}, timeout=30)
    assert st.status_code == 200, st.text
    sid = st.json()["session_id"]

    # single chunk → must be < 20 → finish deve dare 422
    b64, mime = tts(sess, paragraphs[0], "sara")
    q = sess.post(f"{BASE}/voiceprint/enroll/chunk",
                  json={"session_id": sid, "audio_base64": b64, "mime": mime}, timeout=60).json()
    assert "speech_sec" in q and "consistency" in q and "ready" in q
    fbad = sess.post(f"{BASE}/voiceprint/enroll/finish", json={"session_id": sid}, timeout=30)
    if q["speech_sec"] < 20:
        assert fbad.status_code == 422
        assert "parlato" in fbad.json().get("detail", "").lower()

    # continue reading chunks until ready or 6 paragraphs total
    speech = q["speech_sec"]
    cons_last = q["consistency"]
    ready = q["ready"]
    for i in range(1, 6):
        b64, mime = tts(sess, paragraphs[i], "sara")
        q = sess.post(f"{BASE}/voiceprint/enroll/chunk",
                      json={"session_id": sid, "audio_base64": b64, "mime": mime}, timeout=60).json()
        speech = q["speech_sec"]; cons_last = q["consistency"]; ready = q["ready"]
        if ready:
            break
    assert speech >= 20, f"speech too low: {speech}"
    assert cons_last > 0.6, f"consistency low: {cons_last}"
    assert ready is True

    f = sess.post(f"{BASE}/voiceprint/enroll/finish", json={"session_id": sid}, timeout=60)
    assert f.status_code == 200, f.text
    fj = f.json()
    assert fj.get("ok") is True
    assert "Axon" in (fj.get("message") or "")


# ---- Feature: /voiceprint/verify sara -> Test Owner ----
def test_04_verify_sara_matches_owner(sess, paragraphs):
    b64, mime = tts(sess, paragraphs[8], "sara")
    v = sess.post(f"{BASE}/voiceprint/verify",
                  json={"audio_base64": b64, "mime": mime}, timeout=60).json()
    assert v.get("match") is True
    assert v.get("score", 0) > 0.4
    assert v.get("profile") and v["profile"].get("name") == "Test Owner"


# ---- Feature: profiles list, campi embedding esclusi ----
def test_05_profiles_no_embedding_fields(sess):
    r = sess.get(f"{BASE}/voiceprint/profiles", timeout=30)
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert len(items) >= 1
    for p in items:
        for forbidden in ("embedding", "embeddings", "vectors", "vec"):
            assert forbidden not in p, f"leaked {forbidden} in profile {p}"


# ---- Verifica voce Nicola secondaria attiva (creata dal main agent) ----
def _find_secondary(sess, name_contains="Nicola"):
    items = sess.get(f"{BASE}/voiceprint/profiles", timeout=30).json()["items"]
    return next((p for p in items if p["role"] == "secondary" and name_contains.lower() in p["name"].lower()), None)


def test_06_verify_nicola_matches_secondary(sess):
    sec = _find_secondary(sess)
    if not sec:
        pytest.skip("Profilo Nicola non presente, salto")
    # riattiva se in pausa
    if sec.get("status") != "active":
        sess.patch(f"{BASE}/voiceprint/profiles/{sec['profile_id']}", json={"status": "active"})
    b64, mime = tts(sess, "Axon, che appuntamenti ho domani mattina?", "nicola")
    v = sess.post(f"{BASE}/voiceprint/verify",
                  json={"audio_base64": b64, "mime": mime}, timeout=60).json()
    assert v.get("match") is True
    assert v["profile"]["name"].lower().startswith("nicola")


# ---- Feature: transcribe con sara -> speaker Test Owner ----
def test_07_transcribe_sara_speaker_owner(sess):
    b64, mime = tts(sess, "Axon, che appuntamenti ho domani mattina?", "sara")
    r = sess.post(f"{BASE}/viola-wake/transcribe",
                  json={"audio_base64": b64, "mime": mime}, timeout=90).json()
    assert (r.get("transcript") or "").strip() != ""
    assert (r.get("speaker") or {}).get("name") == "Test Owner"


# ---- Feature: nicola in pausa -> transcribe silenzioso + evento unknown_voice ----
def test_08_paused_secondary_yields_silence(sess):
    sec = _find_secondary(sess)
    if not sec:
        pytest.skip("Nicola non presente")
    pid = sec["profile_id"]
    sess.patch(f"{BASE}/voiceprint/profiles/{pid}", json={"status": "paused"})
    try:
        b64, mime = tts(sess, "Axon, che appuntamenti ho domani mattina?", "nicola")
        r = sess.post(f"{BASE}/viola-wake/transcribe",
                      json={"audio_base64": b64, "mime": mime}, timeout=90).json()
        assert r.get("reason") == "unknown_voice"
        assert r.get("silent") is True
        assert (r.get("transcript") or "") == ""
        # event kind unknown_voice
        ev = sess.get(f"{BASE}/viola-wake/events?limit=10", timeout=30).json()["items"]
        assert any(e.get("kind") == "unknown_voice" for e in ev)
    finally:
        sess.patch(f"{BASE}/voiceprint/profiles/{pid}", json={"status": "active"})


# ---- Feature: permessi voce secondaria (route) ----
def test_09_permissions_route_denied_and_granted(sess):
    sec = _find_secondary(sess)
    if not sec:
        pytest.skip("Nicola non presente")
    pid = sec["profile_id"]
    # negato crm e critical
    sess.patch(f"{BASE}/voiceprint/profiles/{pid}",
               json={"permissions": {"briefing": True, "chat": True, "crm": False, "device": True, "critical": False}})

    # crm richiesto → denied
    r = sess.post(f"{BASE}/viola-wake/route",
                  json={"transcript": "che appuntamenti ho con il cliente Rossi",
                        "speaker_profile_id": pid}, timeout=30).json()
    assert r["mode"] == "denied"
    assert "Non sei autorizzato" in (r.get("reply") or "")

    # briefing → trigger
    r = sess.post(f"{BASE}/viola-wake/route",
                  json={"transcript": "briefing", "speaker_profile_id": pid}, timeout=30).json()
    assert r["mode"] == "trigger"

    # critico → denied + category critical
    r = sess.post(f"{BASE}/viola-wake/route",
                  json={"transcript": "cancella tutti i contatti",
                        "speaker_profile_id": pid}, timeout=30).json()
    assert r["mode"] == "denied"
    assert r.get("category") == "critical"

    # tutte true → crm ok (chat), critico → guard (PIN)
    sess.patch(f"{BASE}/voiceprint/profiles/{pid}",
               json={"permissions": {k: True for k in ("briefing", "chat", "crm", "device", "critical")}})
    r = sess.post(f"{BASE}/viola-wake/route",
                  json={"transcript": "che appuntamenti ho con il cliente Rossi",
                        "speaker_profile_id": pid}, timeout=30).json()
    assert r["mode"] == "chat"
    r = sess.post(f"{BASE}/viola-wake/route",
                  json={"transcript": "cancella tutti i contatti",
                        "speaker_profile_id": pid}, timeout=30).json()
    assert r["mode"] == "guard"


# ---- Feature: PATCH permissions su owner → 400 ----
def test_10_patch_permissions_owner_forbidden(sess):
    st = sess.get(f"{BASE}/voiceprint/status", timeout=30).json()
    owner_pid = st["my_profile"]["profile_id"]
    r = sess.patch(f"{BASE}/voiceprint/profiles/{owner_pid}",
                   json={"permissions": {"crm": False}}, timeout=30)
    assert r.status_code == 400, r.text


# ---- Feature: /api/ai/transcribe verify_speaker + copilot denied ----
def test_11_ai_transcribe_with_speaker(sess):
    b64, mime = tts(sess, "Axon, che appuntamenti ho domani mattina?", "sara")
    r = sess.post(f"{BASE}/ai/transcribe",
                  json={"audio_base64": b64, "mime": mime, "verify_speaker": True}, timeout=90).json()
    assert (r.get("transcript") or "").strip() != ""
    assert (r.get("speaker") or {}).get("name") == "Test Owner"


def test_12_copilot_denied_when_crm_false(sess):
    sec = _find_secondary(sess)
    if not sec:
        pytest.skip("Nicola non presente")
    pid = sec["profile_id"]
    sess.patch(f"{BASE}/voiceprint/profiles/{pid}",
               json={"permissions": {"briefing": True, "chat": True, "crm": False, "device": True, "critical": False}})
    r = sess.post(f"{BASE}/voice/copilot/execute",
                  json={"transcript": "aggiungi una nota a Rossi",
                        "speaker_profile_id": pid, "want_audio": False}, timeout=30).json()
    assert r.get("intent") == "denied"


# ---- Feature: /voiceprint/settings level & enabled toggle ----
def test_13_settings_level_and_enabled_toggle(sess):
    # tolerant
    r = sess.put(f"{BASE}/voiceprint/settings", json={"level": "tolerant"}, timeout=30).json()
    assert abs(r.get("threshold", 0) - 0.30) < 0.01
    assert r.get("level") == "tolerant"
    # normal
    r = sess.put(f"{BASE}/voiceprint/settings", json={"level": "normal"}, timeout=30).json()
    assert abs(r.get("threshold", 0) - 0.40) < 0.01

    # disable → enforced false → transcribe con nicola in pausa non silenzia
    sess.put(f"{BASE}/voiceprint/settings", json={"enabled": False}, timeout=30)
    st = sess.get(f"{BASE}/voiceprint/status", timeout=30).json()
    assert st["enforced"] is False

    sec = _find_secondary(sess)
    if sec:
        pid = sec["profile_id"]
        sess.patch(f"{BASE}/voiceprint/profiles/{pid}", json={"status": "paused"})
        try:
            b64, mime = tts(sess, "Axon, che appuntamenti ho domani mattina?", "nicola")
            r = sess.post(f"{BASE}/viola-wake/transcribe",
                          json={"audio_base64": b64, "mime": mime}, timeout=90).json()
            # non silent con enforcement OFF
            assert r.get("reason") != "unknown_voice"
            assert r.get("silent") is not True
        finally:
            sess.patch(f"{BASE}/voiceprint/profiles/{pid}", json={"status": "active"})

    # reset
    sess.put(f"{BASE}/voiceprint/settings", json={"enabled": True}, timeout=30)


# ---- Feature: enroll/start secondary senza name → 400; delete secondary ----
def test_14_enroll_secondary_requires_name(sess):
    r = sess.post(f"{BASE}/voiceprint/enroll/start", json={"role": "secondary"}, timeout=30)
    assert r.status_code == 400


def test_15_create_and_delete_secondary_prova(sess, paragraphs):
    # delete existing "Prova" if any
    for p in sess.get(f"{BASE}/voiceprint/profiles", timeout=30).json()["items"]:
        if p.get("role") == "secondary" and p.get("name", "").lower() == "prova":
            sess.delete(f"{BASE}/voiceprint/profiles/{p['profile_id']}")

    st = sess.post(f"{BASE}/voiceprint/enroll/start",
                   json={"role": "secondary", "name": "Prova"}, timeout=30).json()
    sid = st["session_id"]
    for i in range(5):
        b64, mime = tts(sess, paragraphs[i], "nicola")
        q = sess.post(f"{BASE}/voiceprint/enroll/chunk",
                      json={"session_id": sid, "audio_base64": b64, "mime": mime}, timeout=60).json()
        if q.get("ready"):
            break
    f = sess.post(f"{BASE}/voiceprint/enroll/finish", json={"session_id": sid}, timeout=60)
    assert f.status_code == 200, f.text
    pid = f.json()["profile"]["profile_id"]

    # DELETE ok
    r = sess.delete(f"{BASE}/voiceprint/profiles/{pid}", timeout=30)
    assert r.status_code == 200
    # DELETE 404 su id inesistente
    r = sess.delete(f"{BASE}/voiceprint/profiles/nope-1234", timeout=30)
    assert r.status_code == 404


# ---- Regression: /viola-wake/route senza speaker_profile_id + /viola-wake/settings GET ----
def test_16_regression_route_without_speaker(sess):
    for cmd, expected_modes in [
        ("che appuntamenti ho domani", {"chat", "trigger"}),
        ("briefing", {"trigger"}),
        ("cancella tutti i contatti", {"guard"}),
    ]:
        r = sess.post(f"{BASE}/viola-wake/route", json={"transcript": cmd}, timeout=30).json()
        assert r["mode"] in expected_modes, f"{cmd} → {r}"


def test_17_wake_settings_get(sess):
    r = sess.get(f"{BASE}/viola-wake/settings", timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert isinstance(j, dict)
