# 01e_core_bridge.py — V50.z562 — PONTE verso il package protetto `backend/core/` (Accordo di produzione V1423+).
# Lega nel namespace delle routes i nomi protetti (_core_*), configura il retrieval Drive semantico con l'embedder locale,
# verifica l'integrità all'avvio e la espone in /api/health e /api/axon/core/integrity. Carica subito dopo 01_helpers.
import asyncio
import logging as _cb_logging
import os as _cb_os

from core import CORE_VERSION as _CORE_VERSION
from core import context_cache as _core_ctx_cache
from core import drive_retrieval as _core_drive
from core import embedding as _core_embedding
from core import fup_middleware as _core_fup
from core import integrity as _core_integrity
from core import response_rules as _core_rules
from core import smoke_auth as _core_smoke
from core import streaming as _core_streaming

_cb_log = _cb_logging.getLogger("server")

# ── nomi protetti nel namespace (identità verificata da core.integrity.check) ──
_core_drive_search = _core_drive.search
_core_drive_upsert = _core_drive.upsert_file
_core_drive_delete = _core_drive.delete_file
_core_wants_gme = _core_rules.wants_gme_download
_core_llm_self = _core_rules.llm_can_answer_without_web
_core_stream_record = _core_streaming.record
_core_stream_stats = _core_streaming.stats
_core_stream_begin_phases = _core_streaming.begin_phases  # V50.z564 — scomposizione TTFT per fase
_core_stream_mark_phase = _core_streaming.mark_phase
_core_ctx_get = _core_ctx_cache.get  # V50.z565 — cache del contesto compilata in background (GME, link insegnati, Tavily)
_core_ctx_register = _core_ctx_cache.register
_core_ctx_schedule = _core_ctx_cache.schedule
_core_ctx_pending_note = _core_ctx_cache.pending_note
_core_embedder = _core_embedding.embedder

_core_drive.configure(_core_embedder.embed)
_core_ctx_cache.configure(db)  # noqa: F821


# ── V50.z565 — FAIR USAGE POLICY: 5/min · 120/ora · 7.500/mese per utente, 429 PRIMA della pipeline LLM/ChromaDB ──
async def _fup_resolve_user_id(token: str):
    """Stessa risoluzione di get_current_user (JWT → sub; altrimenti sessione Google), senza sollevare eccezioni."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG]).get("sub")  # noqa: F821
    except Exception:  # noqa: BLE001
        pass
    try:
        s = await db.user_sessions.find_one({"session_token": token}, {"_id": 0, "user_id": 1})  # noqa: F821
        return (s or {}).get("user_id")
    except Exception:  # noqa: BLE001
        return None


_fup = _core_fup.FairUsage(db)  # noqa: F821
app.add_middleware(_core_fup.FupMiddleware, fair_usage=_fup, resolve_user_id=_fup_resolve_user_id, paths=("/assistant/chat", "/assistant/chat/stream"))  # noqa: F821


async def _fup_load_exemptions() -> None:
    """Esenzioni: FUP_EXEMPT_EMAILS (default: SMOKE_EMAIL, l'account dello smoke gate che fa 4 domande di fila a ogni deploy)."""
    emails = [e.strip().lower() for e in (_cb_os.environ.get("FUP_EXEMPT_EMAILS") or _cb_os.environ.get("SMOKE_EMAIL") or "").split(",") if e.strip()]
    if not emails:
        return
    try:
        async for u in db.users.find({"email": {"$in": emails}}, {"_id": 0, "user_id": 1}):  # noqa: F821
            if u.get("user_id"):
                _fup.exempt.add(u["user_id"])
    except Exception as exc:  # noqa: BLE001
        _cb_log.warning("[fup] esenzioni: %s", exc)


@app.on_event("startup")  # noqa: F821
async def _core_integrity_boot() -> None:
    res = _core_integrity.check(globals())
    _cb_log.info("[boot] core %s · integrità=%s · embedder=%s · chroma_dir=%s", _CORE_VERSION, "OK" if res["ok"] else "VIOLATA",
                 "disponibile" if _core_embedder.available else "ASSENTE", _core_drive.default_dir())
    await _core_ctx_cache.ensure_indexes()
    await _fup.ensure_indexes()
    await _fup_load_exemptions()
    _cb_log.info("[boot] FUP attiva: %s · esenti=%d · context-cache refresher=%s", _fup.limits, len(_fup.exempt), ",".join(_core_ctx_cache.stats()["kinds"]) or "—")


@api_router.get("/axon/fup/me")  # noqa: F821
async def axon_fup_me(user=Depends(get_current_user)):  # noqa: F821
    """V50.z565 — Contatori Fair Usage dell'utente corrente (minuto/ora/mese) e soglie."""
    return await _fup.usage(user["user_id"])


@api_router.get("/axon/core/integrity")  # noqa: F821
async def axon_core_integrity():
    """Stato del namespace protetto (usato dallo smoke gate del deploy)."""
    res = _core_integrity.check(globals())
    return {"core_version": _CORE_VERSION, **res, "embedder_available": _core_embedder.available, "protected": sorted(_core_integrity.PROTECTED.keys())}


@api_router.get("/google-drive/retrieval-check")  # noqa: F821
async def google_drive_retrieval_check(q: str = "", user=Depends(get_current_user)):  # noqa: F821
    """V50.z562 — Verifica del retrieval Drive (smoke gate): ricerca semantica sul contenuto + fallback lessicale sul nome.
    → {found, semantic:[…], lexical:[…], indexed_files, semantic_chunks}. `found` = almeno un file con testo non vuoto."""
    tenant = tenant_id(user)  # noqa: F821
    q = (q or "").strip()
    sem = []
    try:
        sem = await asyncio.to_thread(_core_drive_search, tenant, q, 5) if q else []  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        _cb_log.warning("[retrieval-check] semantic failed: %s", exc)
    lex = []
    if q:
        words = [w for w in q.lower().replace("_", " ").split() if len(w) >= 3]
        # V50.z565 — mai leggere i testi di tutti gli snapshot: has_text calcolato lato Mongo
        rows = await db.drive_snapshots.aggregate([{"$match": {"user_id": tenant}}, {"$limit": 3000},  # noqa: F821
                                                   {"$project": {"_id": 0, "file_id": 1, "name": 1, "folder_path": 1, "has_text": {"$gt": [{"$strLenCP": {"$ifNull": ["$text", ""]}}, 0]}}}]).to_list(3000)
        for r in rows:
            nm = (r.get("name") or "").lower().replace("_", " ")
            if any(w in nm for w in words):
                lex.append({"file_id": r["file_id"], "name": r.get("name"), "folder_path": r.get("folder_path"), "has_text": bool(r.get("has_text"))})
    indexed = await db.drive_snapshots.count_documents({"user_id": tenant})  # noqa: F821
    found = any(s.get("score", 0) >= 0.25 for s in sem) or any(l["has_text"] for l in lex)
    return {"query": q, "found": found, "semantic": sem, "lexical": lex[:10], "indexed_files": indexed, "semantic_chunks": _core_drive.count(tenant)}


# ── V50.z566 — SMOKE GATE: token a corto circuito (core/smoke_auth.py). Richiesta da localhost + header X-Smoke-Test-Secret
# == SMOKE_TEST_SECRET (.env) → il server inietta un Bearer JWT interno (15 min) per SMOKE_EMAIL. Nessun login, nessun OAuth.
async def _smoke_resolve_user_id(email: str):
    u = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})  # noqa: F821
    return (u or {}).get("user_id")


def _smoke_mint_token(user_id: str) -> str:
    payload = {"sub": user_id, "iat": int(utcnow().timestamp()), "exp": int((utcnow() + timedelta(minutes=15)).timestamp()), "smoke": True}  # noqa: F821
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)  # noqa: F821


app.add_middleware(_core_smoke.SmokeAuthMiddleware, resolve_user_id=_smoke_resolve_user_id, mint_token=_smoke_mint_token, on_user=lambda uid: _fup.exempt.add(uid))  # noqa: F821
