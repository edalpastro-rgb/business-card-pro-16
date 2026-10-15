"""V50.z554 RETEST — unique phrasing + from_cache=false + Mongo cache + startup log."""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"

NAV_RE = re.compile(r"\[\[NAV:([^|\]]+)\|([^\]]+)\]\]")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return s


@pytest.fixture(scope="module")
def manual_routes():
    r = requests.get(f"{BASE_URL}/api/public/manual", timeout=20)
    return {a["route"] for a in r.json()["items"] if a.get("route")}


# Unique phrasing variants to defeat semantic cache
_rand = str(int(time.time()))[-4:]
REVIEW_QUERIES = [
    f"Come faccio a creare un nuovo contatto nel CRM? [{_rand}a]",
    f"Come registro una nota vocale su un cliente specifico? [{_rand}b]",
    f"Dove si trova lo scanner per biglietti da visita? [{_rand}c]",
]


@pytest.mark.parametrize("msg", REVIEW_QUERIES)
def test_review_howto_chip_and_not_offline(session, msg, manual_routes):
    r = session.post(f"{BASE_URL}/api/assistant/chat", json={"message": msg}, timeout=90)
    assert r.status_code == 200, f"status {r.status_code}: {r.text[:300]}"
    data = r.json()
    reply = data.get("reply", "")
    # 1) NOT offline
    assert "temporaneamente offline" not in reply.lower(), f"OFFLINE reply for '{msg}': {reply[:200]}"
    # 2) from_cache must be false on first ask
    from_cache = data.get("from_cache", False)
    assert from_cache is False, f"Unexpected from_cache=True for unique phrasing '{msg}'"
    # 3) NAV chip present and route valid
    chips = NAV_RE.findall(reply)
    assert chips, f"No NAV chip for '{msg}'. Reply: {reply[:300]}"
    for route, _label in chips:
        assert route in manual_routes, f"Invented route {route} for '{msg}'"


def test_stream_howto_has_nav(session):
    url = f"{BASE_URL}/api/assistant/chat/stream"
    unique = f"Come posso aggiungere un nuovo cliente da questa app? [{_rand}s]"
    with session.post(url, json={"message": unique}, stream=True, timeout=90) as r:
        assert r.status_code == 200
        joined = ""
        for i, line in enumerate(r.iter_lines(decode_unicode=True)):
            if line:
                joined += line + "\n"
            if i > 600:
                break
        assert joined, "empty stream"
        assert "temporaneamente offline" not in joined.lower(), "stream returned offline"
        assert "NAV:" in joined, f"No NAV chip in stream. Last 400: {joined[-400:]}"


def test_mongo_no_offline_entries_in_cache():
    """Verify db.axon_semantic_cache has no entries with offline reply."""
    try:
        from pymongo import MongoClient
    except Exception:
        pytest.skip("pymongo not available")
    # read /app/backend/.env
    mongo_url = None
    db_name = None
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("MONGO_URL="):
                mongo_url = line.split("=", 1)[1].strip().strip('"')
            elif line.startswith("DB_NAME="):
                db_name = line.split("=", 1)[1].strip().strip('"')
    assert mongo_url and db_name
    cli = MongoClient(mongo_url)
    db = cli[db_name]
    coll = db["axon_semantic_cache"]
    bad = coll.count_documents({"reply": {"$regex": "temporaneamente offline", "$options": "i"}})
    assert bad == 0, f"Found {bad} offline cache entries in axon_semantic_cache"


def test_startup_log_contains_malformed_key_message():
    """Backend err.log should mention 'ANTHROPIC_API_KEY malformata' and no 'invalid x-api-key' for NEW requests."""
    log_path = "/var/log/supervisor/backend.err.log"
    if not os.path.exists(log_path):
        pytest.skip("backend.err.log not available")
    # read last 50k bytes
    with open(log_path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 100000))
        tail = f.read().decode("utf-8", errors="ignore")
    assert "ANTHROPIC_API_KEY malformata" in tail, "No malformed key log line found"
    assert "IGNORATA" in tail or "Emergent" in tail


def test_manual_prompt_log_emitted(session):
    """After a how-to send, backend log must contain '[manual] prompt:'."""
    unique = f"Come creo un contatto per un cliente nuovo [{_rand}p]"
    r = session.post(f"{BASE_URL}/api/assistant/chat", json={"message": unique}, timeout=90)
    assert r.status_code == 200
    time.sleep(1)
    with open("/var/log/supervisor/backend.err.log", "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 50000))
        tail = f.read().decode("utf-8", errors="ignore")
    assert "[manual] prompt:" in tail, "No '[manual] prompt:' log emitted on how-to request"
