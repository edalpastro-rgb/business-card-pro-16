"""V50.z506 — Modulo Call + 5 bug fix.
Testa: date deterministiche IT, voice copilot (telefonata/call → appuntamento is_phone),
doppione conferma, richiamata → callbacks, chat endpoint, /appointments/stats?range_days=1,
GET /calls/today, POST /calls/{id}/reschedule, home layout 'calls'.
"""
import os
import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"
CONTACT_ID = "c_93be547cca7f"
ROME = ZoneInfo("Europe/Rome")

MONGO = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
DB = MONGO["test_database"]


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def user_id(token):
    me = requests.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=10).json()
    me = me.get("user", me)
    return me["user_id"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(autouse=True, scope="module")
def cleanup(user_id):
    """Pulisce prima e dopo la run."""
    def wipe():
        DB.appointments.delete_many({"contact_id": CONTACT_ID})
        DB.callbacks.delete_many({"contact_id": CONTACT_ID})
        DB.axon_agent_runs.delete_many({"user_id": user_id, "status": "awaiting"})
    wipe()
    yield
    wipe()


# ------------------------ Date determistiche IT ---------------------------
def _load_dates_mod():
    spec = importlib.util.spec_from_file_location("axon_dates_it", "/app/backend/routes/axon_dates_it.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["axon_dates_it"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_date_it_resolve_cases():
    mod = _load_dates_mod()
    now = datetime(2026, 10, 9, 16, 0, tzinfo=ROME)  # venerdì
    cases = [
        ("martedì alle 10:30",             datetime(2026, 10, 13, 10, 30, tzinfo=ROME)),
        ("lunedì alle 8",                  datetime(2026, 10, 12,  8,  0, tzinfo=ROME)),
        ("domani alle 9 e mezza",          datetime(2026, 10, 10,  9, 30, tzinfo=ROME)),
        ("venerdì alle 17",                datetime(2026, 10,  9, 17,  0, tzinfo=ROME)),  # oggi, ora futura
        ("venerdì alle 10",                datetime(2026, 10, 16, 10,  0, tzinfo=ROME)),  # ora passata → prossimo
        ("il 20/10 alle 15",               datetime(2026, 10, 20, 15,  0, tzinfo=ROME)),
        ("tra 3 giorni",                   datetime(2026, 10, 12, 10,  0, tzinfo=ROME)),  # default hour
    ]
    errors = []
    for text, want in cases:
        got = mod.it_resolve_datetime(text, now)
        if got is None or got.astimezone(ROME) != want:
            errors.append(f"{text!r} → got={got} want={want}")
    assert not errors, "\n".join(errors)
    assert mod.it_resolve_datetime("ciao come stai", now) is None


# ---------------------- VOICE COPILOT — telefonata ------------------------
def test_voice_copilot_telefonata_creates_phone_appt(H, user_id):
    body = {"transcript": "programma una telefonata con Fabio Zanini martedì 13 ottobre alle 10:30", "want_audio": False}
    r = requests.post(f"{BASE}/voice/copilot/execute", headers=H, json=body, timeout=90)
    assert r.status_code == 200, r.text
    j = r.json()
    spoken = (j.get("spoken") or j.get("reply") or "")
    assert "✅" in spoken, f"spoken manca ✅: {spoken[:300]}"
    assert "13/10/2026" in spoken and "10:30" in spoken, f"testo: {spoken[:300]}"
    # Mongo verifica
    appt = DB.appointments.find_one({"contact_id": CONTACT_ID, "is_phone": True})
    assert appt is not None, "nessun appuntamento is_phone creato"
    sa = appt["start_at"]
    sa = sa.replace(tzinfo=timezone.utc) if sa.tzinfo is None else sa
    want = datetime(2026, 10, 13, 8, 30, tzinfo=timezone.utc)
    assert sa == want, f"start_at={sa.isoformat()} want={want.isoformat()}"


def test_voice_copilot_doppione_asks_confirmation(H):
    body = {"transcript": "fissa una telefonata con Fabio Zanini martedì alle 15", "want_audio": False}
    before = DB.appointments.count_documents({"contact_id": CONTACT_ID})
    r = requests.post(f"{BASE}/voice/copilot/execute", headers=H, json=body, timeout=90)
    assert r.status_code == 200, r.text
    spoken = (r.json().get("spoken") or r.json().get("reply") or "")
    assert "⚠️" in spoken and "ha già un appuntamento" in spoken.lower() or "ha già" in spoken, f"attesa warning doppione: {spoken[:300]}"
    assert "sì" in spoken.lower() or "si" in spoken.lower(), f"deve chiedere conferma: {spoken[:300]}"
    after = DB.appointments.count_documents({"contact_id": CONTACT_ID})
    assert after == before, f"non deve creare: before={before} after={after}"


def test_voice_copilot_confirm_sì_creates_duplicate(H):
    before = DB.appointments.count_documents({"contact_id": CONTACT_ID})
    r = requests.post(f"{BASE}/voice/copilot/execute", headers={**H}, json={"transcript": "sì", "want_audio": False}, timeout=90)
    assert r.status_code == 200, r.text
    spoken = (r.json().get("spoken") or r.json().get("reply") or "")
    assert "✅" in spoken, f"attesa ✅ dopo sì: {spoken[:300]}"
    after = DB.appointments.count_documents({"contact_id": CONTACT_ID})
    assert after == before + 1, f"doveva creare 1: before={before} after={after}"
    # Il nuovo appuntamento è alle 15 del 13/10
    appt = DB.appointments.find_one({"contact_id": CONTACT_ID, "start_at": datetime(2026, 10, 13, 13, 0, tzinfo=timezone.utc)})
    assert appt is not None, "appuntamento 13/10 15:00 Roma (13:00Z) mancante"
    assert appt.get("is_phone") is True


def test_voice_copilot_annulla_blocks_dup(H, user_id):
    # provocare un altro doppione
    r1 = requests.post(f"{BASE}/voice/copilot/execute", headers=H,
                       json={"transcript": "fissa telefonata con Fabio Zanini martedì alle 17", "want_audio": False},
                       timeout=90)
    assert r1.status_code == 200
    before = DB.appointments.count_documents({"contact_id": CONTACT_ID})
    r2 = requests.post(f"{BASE}/voice/copilot/execute", headers=H,
                       json={"transcript": "annulla", "want_audio": False}, timeout=60)
    assert r2.status_code == 200
    after = DB.appointments.count_documents({"contact_id": CONTACT_ID})
    assert after == before, f"annulla non deve creare: before={before} after={after}"


def test_voice_copilot_richiamata_creates_callback(H):
    before = DB.callbacks.count_documents({"contact_id": CONTACT_ID})
    r = requests.post(f"{BASE}/voice/copilot/execute", headers=H,
                     json={"transcript": "richiama Fabio Zanini giovedì alle 9", "want_audio": False}, timeout=90)
    assert r.status_code == 200, r.text
    after = DB.callbacks.count_documents({"contact_id": CONTACT_ID})
    assert after == before + 1, f"callback non creata: {before}->{after}"
    cb = DB.callbacks.find_one({"contact_id": CONTACT_ID, "scheduled_at": datetime(2026, 10, 15, 7, 0, tzinfo=timezone.utc)})
    assert cb is not None, "callback 15/10 09:00 Roma mancante"


# ------------------------ /api/assistant/chat ------------------------------
def test_assistant_chat_creates_phone_appt(H):
    body = {"message": "programma una telefonata con Fabio Zanini mercoledì alle 11", "session_id": "test_v506"}
    r = requests.post(f"{BASE}/assistant/chat", headers=H, json=body, timeout=90)
    assert r.status_code == 200, r.text
    reply = r.json().get("reply", "")
    assert "✅" in reply, f"attesa ✅: {reply[:300]}"
    appt = DB.appointments.find_one({"contact_id": CONTACT_ID, "is_phone": True,
                                      "start_at": datetime(2026, 10, 14, 9, 0, tzinfo=timezone.utc)})
    assert appt is not None, "appuntamento 14/10 11:00 Roma non trovato"


# ---------------------- /appointments/stats range_days=1 -------------------
def test_appointments_stats_range_1(H):
    # cleanup degli appt del contatto, poi crea 2 appt
    DB.appointments.delete_many({"contact_id": CONTACT_ID})
    now = datetime.now(tz=timezone.utc)
    today_plus1h = now + timedelta(hours=1)
    in_3d = now + timedelta(days=3)
    for sa in (today_plus1h, in_3d):
        r = requests.post(f"{BASE}/appointments", headers=H, json={
            "title": "Telefonata con Fabio Zanini", "contact_id": CONTACT_ID, "is_phone": True,
            "start_at": sa.isoformat(), "end_at": (sa + timedelta(minutes=30)).isoformat(),
            "duration_min": 30, "area": "energy",
        }, timeout=15)
        assert r.status_code in (200, 201), r.text
    s = requests.get(f"{BASE}/appointments/stats?range_days=1", headers=H, timeout=15).json()
    mine_total = ((s.get("mine") or {}).get("total")) or s.get("total") or 0
    assert mine_total == 1, f"range_days=1 deve contare SOLO oggi: {s}"


# ---------------------- /calls/today ---------------------------------------
def test_calls_today_filters(H):
    r = requests.get(f"{BASE}/calls/today", headers=H, timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert set(["items", "day", "total", "todo", "done"]) <= set(j.keys())
    phones = [it for it in j["items"] if it.get("contact_id") == CONTACT_ID]
    # Deve includere quello di oggi, non quello +3giorni
    assert any(it.get("is_phone") for it in phones), "manca la call di oggi"
    assert all(it.get("is_phone") for it in j["items"]), "items devono essere tutti is_phone"


# ---------------------- /calls/{id}/reschedule -----------------------------
def test_calls_reschedule_creates_callback_and_excludes_from_today(H):
    todo = requests.get(f"{BASE}/calls/today", headers=H, timeout=15).json()
    cand = next((it for it in todo["items"] if it.get("contact_id") == CONTACT_ID and not it.get("done")), None)
    assert cand is not None
    aid = cand.get("appointment_id") or cand.get("id")
    new_at = (datetime.now(tz=timezone.utc) + timedelta(days=2)).replace(hour=6, minute=0, second=0, microsecond=0)  # 08:00 Rome ≈ 06:00Z (CET+2 estivo→invernale OK)
    r = requests.post(f"{BASE}/calls/{aid}/reschedule", headers=H,
                      json={"new_scheduled_at": new_at.isoformat().replace("+00:00", "Z")}, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") and j.get("callback"), j
    # L'appointment ha moved_to_callback_id
    appt = DB.appointments.find_one({"appointment_id": aid}, {"_id": 0})
    assert appt and appt.get("moved_to_callback_id"), appt
    # Non appare più in /calls/today
    todo2 = requests.get(f"{BASE}/calls/today", headers=H, timeout=15).json()
    assert not any((it.get("appointment_id") or it.get("id")) == aid for it in todo2["items"]), "call spostata deve sparire da /calls/today"
    # Secondo reschedule → 400
    r2 = requests.post(f"{BASE}/calls/{aid}/reschedule", headers=H,
                       json={"new_scheduled_at": new_at.isoformat().replace("+00:00", "Z")}, timeout=15)
    assert r2.status_code == 400, r2.text


def test_calls_reschedule_done_rejected(H):
    # Crea un appt is_phone, done=True, poi tenta reschedule → 400
    sa = (datetime.now(tz=timezone.utc) + timedelta(hours=2))
    r = requests.post(f"{BASE}/appointments", headers=H, json={
        "title": "Telefonata con Fabio Zanini", "contact_id": CONTACT_ID, "is_phone": True,
        "start_at": sa.isoformat(), "end_at": (sa + timedelta(minutes=30)).isoformat(),
        "duration_min": 30, "area": "energy",
    }, timeout=15)
    assert r.status_code in (200, 201)
    aid = r.json().get("appointment_id") or r.json().get("id")
    DB.appointments.update_one({"appointment_id": aid}, {"$set": {"done": True}})
    new_at = (datetime.now(tz=timezone.utc) + timedelta(days=2))
    r2 = requests.post(f"{BASE}/calls/{aid}/reschedule", headers=H,
                       json={"new_scheduled_at": new_at.isoformat().replace("+00:00", "Z")}, timeout=15)
    assert r2.status_code == 400, r2.text


# -------------------- Home layout --------------------
def test_home_layout_has_calls_block(H):
    r = requests.get(f"{BASE}/home/layout", headers=H, timeout=10)
    assert r.status_code == 200
    blocks = r.json().get("blocks", [])
    calls_block = next((b for b in blocks if b.get("id") == "calls"), None)
    assert calls_block is not None, f"blocco 'calls' mancante: {[b.get('id') for b in blocks]}"
    label = (calls_block.get("label") or "").lower()
    assert "call" in label, f"label={calls_block.get('label')}"
