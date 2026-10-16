"""tests/core_guards/test_core_v565.py — V50.z565 — test BLOCCANTI (build_package.sh): cache del contesto in background e Fair Usage Policy."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone

import pytest

from core import context_cache as cc
from core import fup_middleware as fup


class _FakeCollection:
    """Sottoinsieme di Motor usato dai moduli core (find_one_and_update con $inc/$set/$setOnInsert, find_one, update_one, find, create_index)."""

    def __init__(self):
        self.docs = []

    def _match(self, q):
        return [d for d in self.docs if all(d.get(k) == v for k, v in q.items() if not isinstance(v, dict))]

    def _apply(self, d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v
        for k, v in (update.get("$inc") or {}).items():
            d[k] = d.get(k, 0) + v

    async def find_one_and_update(self, q, update, upsert=False, return_document=False, projection=None):
        rows = self._match(q)
        if rows:
            d = rows[0]
            before = copy.deepcopy(d)
            self._apply(d, update)
            return d if return_document else before
        if not upsert:
            return None
        d = dict(q)
        d.update(update.get("$setOnInsert") or {})
        self._apply(d, update)
        self.docs.append(d)
        return d if return_document else None

    async def find_one(self, q, projection=None):
        rows = self._match(q)
        return copy.deepcopy(rows[0]) if rows else None

    async def update_one(self, q, update, upsert=False):
        rows = self._match(q)
        if rows:
            self._apply(rows[0], update)
        elif upsert:
            d = dict(q); d.update(update.get("$setOnInsert") or {}); self._apply(d, update); self.docs.append(d)

    async def create_index(self, *a, **k):
        return None

    def find(self, q, projection=None):
        coll = self

        class _Cur:
            def sort(self, *a):
                return self

            async def to_list(self, n):
                return [copy.deepcopy(d) for d in coll.docs][:n]
        return _Cur()


class _FakeDB(dict):
    def __getitem__(self, name):
        if name not in self:
            dict.__setitem__(self, name, _FakeCollection())
        return dict.get(self, name)


# ───────────── FAIR USAGE POLICY ─────────────
def test_fup_burst_blocks_sixth_request_with_prescribed_payload():
    db = _FakeDB()
    fu = fup.FairUsage(db, limits={"minute": 5, "hour": 120, "month": 7500})
    now = datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)

    async def run():
        res = [await fu.check("u1", now) for _ in range(6)]
        return res
    res = asyncio.run(run())
    assert res[:5] == [None] * 5, "le prime 5 richieste/minuto passano"
    blocked = res[5]
    assert blocked and blocked["status"] == "blocked" and blocked["reason"] == "fair_usage_limit_triggered"
    assert blocked["msg"] == "Attività insolita rilevata. Attendi qualche minuto o contatta il supporto."
    assert blocked["window"] == "minute" and blocked["counts"]["minute"] == 6
    assert fup.BLOCK_PAYLOAD == {"status": "blocked", "reason": "fair_usage_limit_triggered", "msg": "Attività insolita rilevata. Attendi qualche minuto o contatta il supporto."}


def test_fup_hour_and_month_windows_and_exemption():
    db = _FakeDB()
    fu = fup.FairUsage(db, limits={"minute": 1000, "hour": 3, "month": 4}, exempt_user_ids={"smoke"})
    t0 = datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)

    async def run():
        out = []
        for i in range(4):  # minuti diversi → burst mai superato, l'ora sì alla 4ª
            out.append(await fu.check("u2", t0 + timedelta(minutes=i)))
        nxt = await fu.check("u2", t0 + timedelta(hours=2))  # nuova ora ma 5ª del mese → blocco mensile
        ex = [await fu.check("smoke", t0) for _ in range(50)]
        usage = await fu.usage("u2", t0)
        return out, nxt, ex, usage
    out, nxt, ex, usage = asyncio.run(run())
    assert out[:3] == [None] * 3 and out[3]["window"] == "hour"
    assert nxt["window"] == "month"
    assert all(e is None for e in ex), "gli account esenti (smoke gate) non vengono mai bloccati"
    assert usage["counts"]["hour"] == 4 and usage["limits"]["hour"] == 3


def test_fup_middleware_returns_429_before_app_and_passes_others():
    db = _FakeDB()
    fu = fup.FairUsage(db, limits={"minute": 1, "hour": 100, "month": 100})
    calls = {"app": 0}

    async def app(scope, receive, send):
        calls["app"] += 1
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def resolve(token):
        return "user-" + token

    mw = fup.FupMiddleware(app, fu, resolve, paths=("/assistant/chat", "/assistant/chat/stream"))

    async def call(path, method="POST", token="abc"):
        sent = []
        scope = {"type": "http", "method": method, "path": path, "headers": [(b"authorization", f"Bearer {token}".encode())], "query_string": b""}

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(msg):
            sent.append(msg)
        await mw(scope, receive, send)
        return sent

    async def run():
        a = await call("/api/assistant/chat/stream")            # 1ª → passa
        b = await call("/api/assistant/chat/stream")            # 2ª nello stesso minuto → 429
        c = await call("/api/contacts")                          # rotta non LLM → mai contata
        d = await call("/api/assistant/chat/stream", method="GET")
        return a, b, c, d
    a, b, c, d = asyncio.run(run())
    assert a[0]["status"] == 200 and b[0]["status"] == 429
    assert b"fair_usage_limit_triggered" in b[1]["body"] and b"blocked" in b[1]["body"]
    assert c[0]["status"] == 200 and d[0]["status"] == 200
    assert calls["app"] == 3, "l'app (pipeline LLM) NON viene toccata quando la richiesta è bloccata"


# ───────────── CACHE DEL CONTESTO IN BACKGROUND ─────────────
def test_context_cache_never_awaits_network_and_schedules_background_refresh():
    db = _FakeDB()
    cc.configure(db)
    cc._inflight.clear()
    seen = []

    async def slow_refresher(args):
        seen.append(args)
        await asyncio.sleep(0.05)
        return f"TESTO per {args['q']}"
    cc.register("test-kind", slow_refresher)

    async def run():
        t0 = asyncio.get_event_loop().time()
        miss = await cc.get("test-kind", {"q": "pun"}, ttl_s=60)
        dt = asyncio.get_event_loop().time() - t0
        await asyncio.sleep(0.2)  # il refresh gira in background
        hit = await cc.get("test-kind", {"q": "pun"}, ttl_s=60)
        return miss, dt, hit
    miss, dt, hit = asyncio.run(run())
    assert miss["status"] == "missing" and miss["text"] is None and dt < 0.05, "la lettura su miss è istantanea (nessuna rete)"
    assert seen == [{"q": "pun"}], "il refresher è stato eseguito UNA volta in background"
    assert hit["status"] == "fresh" and hit["text"] == "TESTO per pun"
    assert "in background" in cc.pending_note("PDF GME") and "NON inventare" in cc.pending_note("x")


def test_context_cache_stale_returns_old_text_and_refreshes():
    db = _FakeDB()
    cc.configure(db)
    cc._inflight.clear()
    cc.register("k2", lambda args: _ret("nuovo"))
    key = cc.key_for("k2", {"a": 1})
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    db[cc.COLLECTION].docs.append({"key": key, "kind": "k2", "args": {"a": 1}, "text": "vecchio", "updated_at": past, "expires_at": past, "ttl_s": 60, "last_used_at": past})

    async def run():
        st = await cc.get("k2", {"a": 1}, ttl_s=60)
        await asyncio.sleep(0.05)
        fr = await cc.get("k2", {"a": 1}, ttl_s=60)
        return st, fr
    st, fr = asyncio.run(run())
    assert st["status"] == "stale" and st["text"] == "vecchio", "testo stale servito subito"
    assert fr["status"] == "fresh" and fr["text"] == "nuovo"


async def _ret(v):
    return v


def test_core_protected_names_include_v565():
    from core import integrity
    for n in ("_core_ctx_get", "_core_ctx_register", "_core_ctx_schedule", "_core_ctx_pending_note"):
        assert n in integrity.PROTECTED
