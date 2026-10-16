"""core/context_cache.py — V50.z565 — CACHE DEL CONTESTO COMPILATA IN BACKGROUND (fetcher fuori dal preflight).

Regola di produzione: la chat NON scarica mai nulla dalla rete (PDF GME, link insegnati, Tavily). Legge SOLO questa cache
in MongoDB (`axon_context_cache`, una lettura indicizzata < 50 ms); se la voce manca o è scaduta programma il refresh in
background (`schedule`) e risponde subito con quello che c'è (anche se stale) o con una nota «in aggiornamento».
Il job periodico `refresh_due()` rinfresca le voci usate di recente prima che scadano, così il dato è già pronto alla
domanda successiva. Ogni tipo di contenuto registra il proprio refresher con `register(kind, fn)`.
"""
import asyncio
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

_log = logging.getLogger("axon.core.context_cache")
COLLECTION = "axon_context_cache"
Refresher = Callable[[Dict[str, Any]], Awaitable[Optional[str]]]
_db = None
_refreshers: Dict[str, Refresher] = {}
_inflight: Set[str] = set()
_lock = asyncio.Lock()
_stats = {"hits": 0, "stale_hits": 0, "misses": 0, "scheduled": 0, "refreshed": 0, "errors": 0}


def configure(db) -> None:
    """Inietta il database Motor (chiamato da 01e_core_bridge)."""
    global _db
    _db = db


def register(kind: str, fn: Refresher) -> None:
    """Registra la funzione di background che produce il testo per `kind` a partire da `args`."""
    _refreshers[kind] = fn


def key_for(kind: str, args: Dict[str, Any]) -> str:
    raw = json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
    return f"{kind}:{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes() -> None:
    if _db is None:
        return
    try:
        await _db[COLLECTION].create_index("key", unique=True)
        await _db[COLLECTION].create_index("expires_at")
        await _db[COLLECTION].create_index("last_used_at")
    except Exception as exc:  # noqa: BLE001
        _log.warning("[context-cache] indexes: %s", exc)


async def get(kind: str, args: Dict[str, Any], *, ttl_s: int, stale_ok: bool = True, schedule_on_miss: bool = True) -> Dict[str, Any]:
    """Lettura istantanea. → {"text": str|None, "status": "fresh"|"stale"|"missing", "updated_at": datetime|None}.
    Su miss/stale programma il refresh in background (mai atteso)."""
    key = key_for(kind, args)
    doc = None
    if _db is not None:
        try:
            doc = await _db[COLLECTION].find_one_and_update({"key": key}, {"$set": {"last_used_at": _now()}}, projection={"_id": 0})
        except Exception as exc:  # noqa: BLE001
            _log.warning("[context-cache] read %s: %s", key, exc)
    now = _now()
    if doc and doc.get("text") is not None:
        exp = doc.get("expires_at")
        if isinstance(exp, datetime) and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp and exp > now:
            _stats["hits"] += 1
            return {"text": doc["text"], "status": "fresh", "updated_at": doc.get("updated_at")}
        _stats["stale_hits"] += 1
        if schedule_on_miss:
            schedule(kind, args, ttl_s=ttl_s)
        return {"text": doc["text"] if stale_ok else None, "status": "stale", "updated_at": doc.get("updated_at")}
    _stats["misses"] += 1
    if schedule_on_miss:
        schedule(kind, args, ttl_s=ttl_s)
    return {"text": None, "status": "missing", "updated_at": None}


def schedule(kind: str, args: Dict[str, Any], *, ttl_s: int) -> bool:
    """Avvia il refresh in background (fire-and-forget, deduplicato per chiave). False se già in corso o refresher assente."""
    if kind not in _refreshers:
        _log.warning("[context-cache] nessun refresher per %s", kind)
        return False
    key = key_for(kind, args)
    if key in _inflight:
        return False
    _inflight.add(key)
    _stats["scheduled"] += 1
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        _inflight.discard(key)
        return False
    loop.create_task(_run(kind, args, key, ttl_s))
    return True


async def _run(kind: str, args: Dict[str, Any], key: str, ttl_s: int) -> None:
    t0 = time.monotonic()
    try:
        text = await asyncio.wait_for(_refreshers[kind](args), timeout=120)
        if _db is not None:
            now = _now()
            await _db[COLLECTION].update_one(
                {"key": key},
                {"$set": {"kind": kind, "args": args, "text": text if text is not None else "", "updated_at": now, "expires_at": now + timedelta(seconds=ttl_s),
                          "ttl_s": ttl_s, "duration_s": round(time.monotonic() - t0, 2), "chars": len(text or "")},
                 "$setOnInsert": {"last_used_at": now}},
                upsert=True,
            )
        _stats["refreshed"] += 1
        _log.info("[context-cache] %s aggiornata in %.2fs (%d car.)", key, time.monotonic() - t0, len(text or ""))
    except Exception as exc:  # noqa: BLE001
        _stats["errors"] += 1
        _log.warning("[context-cache] refresh %s fallito: %s", key, exc)
    finally:
        _inflight.discard(key)


async def refresh_due(*, horizon_s: int = 1800, used_within_days: int = 7, limit: int = 20) -> int:
    """Job periodico: rinfresca le voci che scadono entro `horizon_s` e sono state usate negli ultimi `used_within_days` giorni."""
    if _db is None:
        return 0
    now = _now()
    try:
        rows = await _db[COLLECTION].find(
            {"expires_at": {"$lt": now + timedelta(seconds=horizon_s)}, "last_used_at": {"$gt": now - timedelta(days=used_within_days)}, "kind": {"$in": list(_refreshers)}},
            {"_id": 0, "kind": 1, "args": 1, "ttl_s": 1},
        ).sort("expires_at", 1).to_list(limit)
    except Exception as exc:  # noqa: BLE001
        _log.warning("[context-cache] refresh_due query: %s", exc)
        return 0
    n = 0
    for r in rows:
        if schedule(r["kind"], r.get("args") or {}, ttl_s=int(r.get("ttl_s") or 3600)):
            n += 1
    if n:
        _log.info("[context-cache] refresh_due: %d voci programmate", n)
    return n


def stats() -> Dict[str, Any]:
    return {**_stats, "inflight": len(_inflight), "kinds": sorted(_refreshers)}


def pending_note(label: str) -> str:
    """Frase standard da iniettare nel prompt quando il dato non è ancora in cache."""
    return (f"⏳ {label}: dato NON ancora in cache locale — il download è stato avviato in background adesso e sarà disponibile "
            f"alla prossima domanda (di solito entro 10-30 secondi). Dillo all'utente in una riga e invitalo a richiederlo tra poco; "
            f"NON inventare valori.")


__all__: List[str] = ["configure", "register", "get", "schedule", "refresh_due", "stats", "pending_note", "key_for", "ensure_indexes", "COLLECTION"]
