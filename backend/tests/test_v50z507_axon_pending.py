"""V50.z507 — Axon pending confirm (BUG 1-4):
- stats days/range_days alias (count today Europe/Rome only)
- tipo discrimination (appuntamento vs telefonata vs richiama)
- contatto NON in rubrica → appointment saved (contact_id null) + avviso
- doppione pending persistente 48h + resolve confirm/cancel/modify + voce
"""
import os, re, time, pytest, requests
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

BASE = "http://localhost:8001/api"
OWNER = ("test@dalpastro.it", "Test1234!")
DEMO = ("demo@advisoros.it", "Demo1234!")
ROME = ZoneInfo("Europe/Rome")

# ---- helpers ----
def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["token"]

def H(tok): return {"Authorization": f"Bearer {tok}"}

@pytest.fixture(scope="module")
def owner_tok():
    return login(*OWNER)

@pytest.fixture(scope="module")
def demo_tok():
    return login(*DEMO)

@pytest.fixture(scope="module", autouse=True)
def cleanup_db():
    async def do(when):
        client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = client["test_database"]
        u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
        tid = u["user_id"]
        await db.appointments.delete_many({"user_id": tid, "title": {"$regex": "Sperandio|Zanini", "$options": "i"}})
        await db.callbacks.delete_many({"user_id": tid, "title": {"$regex": "Sperandio|Zanini", "$options": "i"}})
        await db.axon_agent_runs.update_many({"user_id": tid, "status": "awaiting"}, {"$set": {"status": "cancelled"}})
        client.close()
    asyncio.get_event_loop().run_until_complete(do("before"))
    yield
    asyncio.new_event_loop().run_until_complete(do("after"))

def _cleanup_appts(tok):
    """quick cleanup via API: find and delete appts/callbacks with Zanini/Sperandio in title"""
    async def do():
        client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = client["test_database"]
        u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
        tid = u["user_id"]
        await db.appointments.delete_many({"user_id": tid, "title": {"$regex": "Sperandio|Zanini", "$options": "i"}})
        await db.callbacks.delete_many({"user_id": tid, "title": {"$regex": "Sperandio|Zanini", "$options": "i"}})
        await db.axon_agent_runs.update_many({"user_id": tid, "status": "awaiting"}, {"$set": {"status": "cancelled"}})
        client.close()
    try:
        asyncio.new_event_loop().run_until_complete(do())
    except Exception:
        pass

# ============================================================
# TEST 1: stats days/range_days alias + today only
# ============================================================
class TestStatsAlias:
    def test_days_alias_counts_today_only(self, owner_tok):
        _cleanup_appts(owner_tok)
        # Baseline today count (there may be other legit appts for test@dalpastro.it)
        baseline = requests.get(f"{BASE}/appointments/stats?days=1", headers=H(owner_tok), timeout=15).json()["mine"]["total"]
        # Create appt today +1h (Rome)
        now_rome = datetime.now(ROME)
        today_1h = (now_rome + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        future_3d = (now_rome + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
        
        payload_today = {"contact_id": "c_93be547cca7f", "title": "Zanini test oggi",
                         "start_at": today_1h.astimezone(timezone.utc).isoformat()}
        payload_future = {"contact_id": "c_93be547cca7f", "title": "Zanini test futuro",
                          "start_at": future_3d.astimezone(timezone.utc).isoformat()}
        
        r1 = requests.post(f"{BASE}/appointments", json=payload_today, headers=H(owner_tok), timeout=15)
        r2 = requests.post(f"{BASE}/appointments", json=payload_future, headers=H(owner_tok), timeout=15)
        assert r1.status_code in (200, 201), r1.text
        assert r2.status_code in (200, 201), r2.text
        
        # days=1 alias → should increase by exactly 1 (future_3d excluded)
        r = requests.get(f"{BASE}/appointments/stats?days=1", headers=H(owner_tok), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["range_days"] == 1
        assert d["mine"]["total"] == baseline + 1, f"days=1 expected baseline+1 (today only), got {d['mine']['total']} vs baseline {baseline}"
        
        # range_days=1 param
        r = requests.get(f"{BASE}/appointments/stats?range_days=1", headers=H(owner_tok), timeout=15)
        assert r.json()["mine"]["total"] == baseline + 1
        
        # Combined range_days=1&days=1 (days wins)
        r = requests.get(f"{BASE}/appointments/stats?range_days=1&days=1", headers=H(owner_tok), timeout=15)
        assert r.json()["mine"]["total"] == baseline + 1

    def test_default_30d_window(self, owner_tok):
        # default should be 30 calendar days (no future beyond today) - at least 2 (we created 2)
        r = requests.get(f"{BASE}/appointments/stats", headers=H(owner_tok), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["range_days"] == 30
        # future_3d is outside "fino a fine oggi" → total should count only today one
        # Based on code: until = today0 + 1day, since = today0 - 29days → future_3d is EXCLUDED
        assert d["mine"]["total"] >= 1
        _cleanup_appts(owner_tok)


# ============================================================
# TEST 2: tipo discrimination
# ============================================================
class TestTipoDiscrimination:
    def _exec(self, tok, transcript, timeout=120):
        r = requests.post(f"{BASE}/voice/copilot/execute",
                          json={"transcript": transcript, "lang": "it"},
                          headers=H(tok), timeout=timeout)
        return r

    def test_appuntamento_is_phone_false(self, owner_tok):
        _cleanup_appts(owner_tok)
        r = self._exec(owner_tok, "fissa un appuntamento con Fabio Zanini lunedì alle 15")
        assert r.status_code == 200, r.text
        spoken = (r.json().get("spoken") or r.json().get("reply") or "").lower()
        assert "✅" in r.json().get("spoken","") or "✅" in r.json().get("reply",""), f"missing ✅: {r.json()}"
        # verify appt created, is_phone False
        appts = requests.get(f"{BASE}/appointments?contact_id=c_93be547cca7f", headers=H(owner_tok), timeout=15).json()
        items = appts if isinstance(appts, list) else appts.get("items", [])
        zanini = [a for a in items if "Zanini" in (a.get("title") or "")]
        assert zanini, "no Zanini appointment created"
        a = zanini[0]
        assert a.get("is_phone") in (False, None), f"is_phone should be False, got {a.get('is_phone')}"
        # verify 12/10 15:00 Rome = 13:00Z
        sa = a["start_at"]
        assert "2026-10-12T13:00" in sa, f"expected 2026-10-12T13:00Z got {sa}"
        _cleanup_appts(owner_tok)

    def test_telefonata_is_phone_true(self, owner_tok):
        _cleanup_appts(owner_tok)
        r = self._exec(owner_tok, "programma una telefonata con Fabio Zanini mercoledì alle 11")
        assert r.status_code == 200, r.text
        appts = requests.get(f"{BASE}/appointments?contact_id=c_93be547cca7f", headers=H(owner_tok), timeout=15).json()
        items = appts if isinstance(appts, list) else appts.get("items", [])
        zanini = [a for a in items if "Zanini" in (a.get("title") or "")]
        assert zanini, "no Zanini phone appt created"
        a = zanini[0]
        assert a.get("is_phone") is True, f"is_phone should be True, got {a.get('is_phone')}"
        assert "2026-10-14T09:00" in a["start_at"], f"expected 14/10 09:00Z got {a['start_at']}"
        _cleanup_appts(owner_tok)

    def test_richiama_creates_callback_not_appointment(self, owner_tok):
        _cleanup_appts(owner_tok)
        r = self._exec(owner_tok, "richiama Fabio Zanini giovedì alle 9")
        assert r.status_code == 200, r.text
        # verify callback in collection
        async def check():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client["test_database"]
            u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
            cbs = await db.callbacks.find({"user_id": u["user_id"], "title": {"$regex": "Zanini", "$options": "i"}}).to_list(10)
            appts = await db.appointments.find({"user_id": u["user_id"], "title": {"$regex": "Zanini", "$options": "i"}}).to_list(10)
            client.close()
            return cbs, appts
        cbs, appts = asyncio.new_event_loop().run_until_complete(check())
        assert len(cbs) >= 1, f"expected callback for Zanini, found {len(cbs)}"
        assert len(appts) == 0, f"no appointment should be created for richiama, got {len(appts)}"
        # verify date: 15/10 07:00Z (9:00 Rome)
        cb = cbs[0]
        sa = cb.get("scheduled_at") or cb.get("start_at")
        if isinstance(sa, datetime):
            sa_iso = sa.replace(tzinfo=timezone.utc).isoformat() if sa.tzinfo is None else sa.isoformat()
        else:
            sa_iso = str(sa)
        assert "2026-10-15" in sa_iso and ("07:00" in sa_iso or "T07" in sa_iso), f"callback date wrong: {sa_iso}"
        _cleanup_appts(owner_tok)


# ============================================================
# TEST 3: contatto non in rubrica
# ============================================================
class TestContactNotInBook:
    def test_appuntamento_sperandio_saved_without_contact(self, owner_tok):
        _cleanup_appts(owner_tok)
        r = requests.post(f"{BASE}/voice/copilot/execute",
                          json={"transcript": "fissa un appuntamento con Ludovico Sperandio venerdì alle 16", "lang": "it"},
                          headers=H(owner_tok), timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        spoken = d.get("spoken") or d.get("reply") or ""
        assert "✅" in spoken, f"missing ✅: {spoken}"
        assert "non è in rubrica" in spoken.lower() or "rubrica" in spoken.lower(), f"missing 'non è in rubrica' notice: {spoken}"
        # verify appt saved: contact_id null, title "Appuntamento con Ludovico Sperandio", start 16/10 14:00Z
        async def check():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client["test_database"]
            u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
            appts = await db.appointments.find({"user_id": u["user_id"], "title": {"$regex": "Sperandio", "$options": "i"}}).to_list(10)
            client.close()
            return appts
        appts = asyncio.new_event_loop().run_until_complete(check())
        assert len(appts) >= 1, f"expected 1 Sperandio appt, got {len(appts)}"
        a = appts[0]
        assert a.get("contact_id") in (None, ""), f"contact_id should be null, got {a.get('contact_id')}"
        assert "Ludovico Sperandio" in a.get("title", ""), f"title missing name: {a.get('title')}"
        sa = a["start_at"]
        if isinstance(sa, datetime):
            sa_iso = sa.replace(tzinfo=timezone.utc).isoformat() if sa.tzinfo is None else sa.isoformat()
        else:
            sa_iso = str(sa)
        assert "2026-10-16" in sa_iso and ("14:00" in sa_iso or "T14" in sa_iso), f"expected 16/10 14:00Z got {sa_iso}"
        _cleanup_appts(owner_tok)

    def test_telefonata_sperandio_saved_is_phone_true(self, owner_tok):
        _cleanup_appts(owner_tok)
        r = requests.post(f"{BASE}/voice/copilot/execute",
                          json={"transcript": "programma una telefonata con Ludovico Sperandio sabato alle 10", "lang": "it"},
                          headers=H(owner_tok), timeout=120)
        assert r.status_code == 200
        async def check():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client["test_database"]
            u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
            appts = await db.appointments.find({"user_id": u["user_id"], "title": {"$regex": "Sperandio", "$options": "i"}}).to_list(10)
            client.close()
            return appts
        appts = asyncio.new_event_loop().run_until_complete(check())
        assert len(appts) >= 1
        assert appts[0].get("is_phone") is True
        assert appts[0].get("contact_id") in (None, "")
        _cleanup_appts(owner_tok)


# ============================================================
# TEST 4: pending doppione persistente + resolve
# ============================================================
class TestPendingResolve:
    def _create_duplicate(self, tok):
        """Create base appt lunedì 17 then try duplicate → pending."""
        _cleanup_appts(tok)
        # Base appt
        r1 = requests.post(f"{BASE}/voice/copilot/execute",
                           json={"transcript": "fissa un appuntamento con Fabio Zanini lunedì alle 17", "lang": "it"},
                           headers=H(tok), timeout=120)
        assert r1.status_code == 200, r1.text
        # Duplicate same day
        r2 = requests.post(f"{BASE}/voice/copilot/execute",
                           json={"transcript": "fissa un appuntamento con Fabio Zanini lunedì alle 17", "lang": "it"},
                           headers=H(tok), timeout=120)
        assert r2.status_code == 200
        spoken = (r2.json().get("spoken") or r2.json().get("reply") or "")
        assert "⚠️" in spoken or "già" in spoken.lower(), f"expected warning for duplicate: {spoken}"
        return r2.json()

    def test_pending_appears_after_duplicate(self, owner_tok):
        self._create_duplicate(owner_tok)
        r = requests.get(f"{BASE}/axon/agent/pending", headers=H(owner_tok), timeout=15)
        assert r.status_code == 200
        p = r.json().get("pending")
        assert p is not None, "pending should be set"
        assert p.get("run_id")
        assert p.get("question")
        assert p.get("start_at") and "2026-10-12T17:00" in p["start_at"]
        assert p.get("label")

    def test_resolve_modify(self, owner_tok):
        self._create_duplicate(owner_tok)
        p = requests.get(f"{BASE}/axon/agent/pending", headers=H(owner_tok), timeout=15).json()["pending"]
        rid = p["run_id"]
        r = requests.post(f"{BASE}/axon/agent/pending/{rid}",
                          json={"action": "modify", "new_start_at": "2026-10-14T17:00"},
                          headers=H(owner_tok), timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "done", f"expected done: {d}"
        assert "14/10/2026" in d["reply"] and "17:00" in d["reply"], f"reply should contain date: {d['reply']}"
        assert d["pending"] is None
        # verify appt exists on 14/10
        async def check():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client["test_database"]
            u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
            appts = await db.appointments.find({"user_id": u["user_id"], "title": {"$regex": "Zanini"}}).to_list(10)
            client.close()
            return appts
        appts = asyncio.new_event_loop().run_until_complete(check())
        found = False
        for a in appts:
            sa = a.get("start_at")
            s = sa.isoformat() if isinstance(sa, datetime) else str(sa)
            if "2026-10-14" in s and ("15:00" in s or "T15" in s):  # 17:00 Rome = 15:00Z
                found = True; break
        assert found, f"no appt on 14/10 17:00 Rome found; got: {[a.get('start_at') for a in appts]}"

    def test_resolve_cancel(self, owner_tok):
        self._create_duplicate(owner_tok)
        p = requests.get(f"{BASE}/axon/agent/pending", headers=H(owner_tok), timeout=15).json()["pending"]
        rid = p["run_id"]
        # Count appts before
        async def count():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client["test_database"]
            u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
            n = await db.appointments.count_documents({"user_id": u["user_id"], "title": {"$regex": "Zanini"}, "start_at": {"$gte": datetime(2026,10,12,15,0,tzinfo=timezone.utc), "$lt": datetime(2026,10,12,16,0,tzinfo=timezone.utc)}})
            client.close()
            return n
        before = asyncio.new_event_loop().run_until_complete(count())
        r = requests.post(f"{BASE}/axon/agent/pending/{rid}",
                          json={"action": "cancel"}, headers=H(owner_tok), timeout=30)
        assert r.status_code == 200
        assert r.json()["pending"] is None
        after = asyncio.new_event_loop().run_until_complete(count())
        assert after == before, f"cancel should not create appt (before={before}, after={after})"

    def test_resolve_confirm_creates_second(self, owner_tok):
        self._create_duplicate(owner_tok)
        p = requests.get(f"{BASE}/axon/agent/pending", headers=H(owner_tok), timeout=15).json()["pending"]
        rid = p["run_id"]
        r = requests.post(f"{BASE}/axon/agent/pending/{rid}",
                          json={"action": "confirm"}, headers=H(owner_tok), timeout=30)
        assert r.status_code == 200
        async def count():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client["test_database"]
            u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
            n = await db.appointments.count_documents({"user_id": u["user_id"], "title": {"$regex": "Zanini"}, "start_at": {"$gte": datetime(2026,10,12,15,0,tzinfo=timezone.utc), "$lt": datetime(2026,10,12,16,0,tzinfo=timezone.utc)}})
            client.close()
            return n
        n = asyncio.new_event_loop().run_until_complete(count())
        assert n >= 2, f"confirm should create 2nd same-day appt, got {n}"

    def test_resolve_voice_modify(self, owner_tok):
        self._create_duplicate(owner_tok)
        r = requests.post(f"{BASE}/voice/copilot/execute",
                          json={"transcript": "modifica: giovedì alle 10", "lang": "it"},
                          headers=H(owner_tok), timeout=60)
        assert r.status_code == 200, r.text
        async def check():
            client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = client["test_database"]
            u = await db.users.find_one({"email": OWNER[0]}, {"_id":0, "user_id":1})
            # 15/10 08:00Z = 10:00 Rome
            n = await db.appointments.count_documents({"user_id": u["user_id"], "title": {"$regex": "Zanini"}, "start_at": {"$gte": datetime(2026,10,15,7,30,tzinfo=timezone.utc), "$lt": datetime(2026,10,15,9,0,tzinfo=timezone.utc)}})
            client.close()
            return n
        n = asyncio.new_event_loop().run_until_complete(check())
        assert n >= 1, f"voice modify should create appt on 15/10 10:00 Rome, got {n}"

    def test_404_on_unknown_run_id(self, owner_tok):
        r = requests.post(f"{BASE}/axon/agent/pending/does_not_exist",
                          json={"action": "cancel"}, headers=H(owner_tok), timeout=10)
        assert r.status_code == 404

    def test_demo_user_isolation(self, owner_tok, demo_tok):
        # Create pending on owner
        self._create_duplicate(owner_tok)
        # Demo should NOT see it
        r = requests.get(f"{BASE}/axon/agent/pending", headers=H(demo_tok), timeout=15)
        assert r.status_code == 200
        assert r.json().get("pending") is None, "demo should not see owner's pending"
