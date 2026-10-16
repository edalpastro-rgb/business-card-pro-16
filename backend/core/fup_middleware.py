"""core/fup_middleware.py — V50.z565 — FAIR USAGE POLICY (FUP) per le rotte LLM, contatori in MongoDB.

Soglie rigide per utente: burst 5 richieste/minuto · 120/ora · 7.500/mese (override via env FUP_BURST_PER_MIN, FUP_PER_HOUR,
FUP_PER_MONTH). Al superamento la richiesta viene bloccata PRIMA di toccare la pipeline LLM/ChromaDB con HTTP 429 e payload
{"status": "blocked", "reason": "fair_usage_limit_triggered", "msg": "Attività insolita rilevata. …"}.
Contatori: collection `fup_counters`, un documento per (user_id, finestra, bucket) con `$inc` atomico e indice TTL su `expires_at`.
Il middleware Starlette (`FupMiddleware`) intercetta i POST sulle rotte indicate, risolve l'utente dal Bearer token tramite il
resolver iniettato (nessuna dipendenza da routes/) e consente esenzioni (account smoke gate / supporto).
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, Optional

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

_log = logging.getLogger("axon.core.fup")
COLLECTION = "fup_counters"
DEFAULT_LIMITS: Dict[str, int] = {
    "minute": int(os.environ.get("FUP_BURST_PER_MIN") or 5),
    "hour": int(os.environ.get("FUP_PER_HOUR") or 120),
    "month": int(os.environ.get("FUP_PER_MONTH") or 7500),
}
BLOCK_PAYLOAD: Dict[str, str] = {
    "status": "blocked",
    "reason": "fair_usage_limit_triggered",
    "msg": "Attività insolita rilevata. Attendi qualche minuto o contatta il supporto.",
}
_WINDOW_SECONDS = {"minute": 60, "hour": 3600, "month": 32 * 86400}


def _buckets(now: datetime) -> Dict[str, str]:
    return {"minute": now.strftime("%Y-%m-%dT%H:%M"), "hour": now.strftime("%Y-%m-%dT%H"), "month": now.strftime("%Y-%m")}


class FairUsage:
    def __init__(self, db, limits: Optional[Dict[str, int]] = None, exempt_user_ids: Optional[Iterable[str]] = None):
        self.db = db
        self.limits = dict(limits or DEFAULT_LIMITS)
        self.exempt = set(exempt_user_ids or [])
        self.blocked_total = 0

    async def ensure_indexes(self) -> None:
        try:
            await self.db[COLLECTION].create_index([("user_id", 1), ("window", 1), ("bucket", 1)], unique=True)
            await self.db[COLLECTION].create_index("expires_at", expireAfterSeconds=0)
        except Exception as exc:  # noqa: BLE001
            _log.warning("[fup] indexes: %s", exc)

    async def check(self, user_id: str, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
        """Conta la richiesta su tutte le finestre e restituisce il payload di blocco se UNA soglia è superata, altrimenti None."""
        if not user_id or user_id in self.exempt:
            return None
        now = now or datetime.now(timezone.utc)
        counts: Dict[str, int] = {}
        for window, bucket in _buckets(now).items():
            try:
                doc = await self.db[COLLECTION].find_one_and_update(
                    {"user_id": user_id, "window": window, "bucket": bucket},
                    {"$inc": {"n": 1}, "$setOnInsert": {"expires_at": now + timedelta(seconds=_WINDOW_SECONDS[window] + 60)}},
                    upsert=True, return_document=True,
                )
                counts[window] = int((doc or {}).get("n") or 1)
            except Exception as exc:  # noqa: BLE001 — Mongo non raggiungibile: non bloccare l'utente per un guasto nostro
                _log.warning("[fup] counter %s: %s", window, exc)
                counts[window] = 0
        over = [w for w, n in counts.items() if n > self.limits.get(w, 10**9)]
        if not over:
            return None
        self.blocked_total += 1
        _log.warning("[fup] BLOCCO user=%s finestra=%s contatori=%s soglie=%s", user_id, ",".join(over), counts, self.limits)
        return {**BLOCK_PAYLOAD, "window": over[0], "counts": counts, "limits": self.limits}

    async def usage(self, user_id: str, now: Optional[datetime] = None) -> Dict[str, Any]:
        """Contatori correnti (senza incrementare) per la schermata/manuale."""
        now = now or datetime.now(timezone.utc)
        out: Dict[str, Any] = {"limits": self.limits, "counts": {}, "exempt": user_id in self.exempt}
        for window, bucket in _buckets(now).items():
            try:
                doc = await self.db[COLLECTION].find_one({"user_id": user_id, "window": window, "bucket": bucket}, {"_id": 0, "n": 1})
            except Exception:  # noqa: BLE001
                doc = None
            out["counts"][window] = int((doc or {}).get("n") or 0)
        return out


class FupMiddleware:
    """Middleware ASGI puro (nessun buffering dello streaming SSE): applica FairUsage ai POST sulle `paths`
    (confronto sul suffisso del percorso, es. /assistant/chat e /assistant/chat/stream, con o senza prefisso /api)."""

    def __init__(self, app, fair_usage: FairUsage, resolve_user_id: Callable[[str], Awaitable[Optional[str]]], paths: Iterable[str]):
        self.app = app
        self.fu = fair_usage
        self.resolve = resolve_user_id
        self.paths = tuple(paths)

    def _matches(self, path: str) -> bool:
        return any(path == p or path.endswith(p) for p in self.paths)

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and scope.get("method") == "POST" and self._matches(scope.get("path") or ""):
            auth = Headers(scope=scope).get("authorization") or ""
            token = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else ""
            user_id = None
            if token:
                try:
                    user_id = await self.resolve(token)
                except Exception as exc:  # noqa: BLE001
                    _log.debug("[fup] resolve: %s", exc)
            if user_id:
                blocked = await self.fu.check(user_id)
                if blocked:
                    await JSONResponse(blocked, status_code=429, headers={"Retry-After": "60"})(scope, receive, send)
                    return
        await self.app(scope, receive, send)
