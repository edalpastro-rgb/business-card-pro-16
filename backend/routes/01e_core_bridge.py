# 01e_core_bridge.py — V50.z562 — PONTE verso il package protetto `backend/core/` (Accordo di produzione V1423+).
# Lega nel namespace delle routes i nomi protetti (_core_*), configura il retrieval Drive semantico con l'embedder locale,
# verifica l'integrità all'avvio e la espone in /api/health e /api/axon/core/integrity. Carica subito dopo 01_helpers.
import asyncio
import logging as _cb_logging

from core import CORE_VERSION as _CORE_VERSION
from core import drive_retrieval as _core_drive
from core import embedding as _core_embedding
from core import integrity as _core_integrity
from core import response_rules as _core_rules
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
_core_embedder = _core_embedding.embedder

_core_drive.configure(_core_embedder.embed)


@app.on_event("startup")  # noqa: F821
async def _core_integrity_boot() -> None:
    res = _core_integrity.check(globals())
    _cb_log.info("[boot] core %s · integrità=%s · embedder=%s · chroma_dir=%s", _CORE_VERSION, "OK" if res["ok"] else "VIOLATA",
                 "disponibile" if _core_embedder.available else "ASSENTE", _core_drive.default_dir())


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
        rows = await db.drive_snapshots.find({"user_id": tenant}, {"_id": 0, "file_id": 1, "name": 1, "folder_path": 1, "text": 1}).to_list(3000)  # noqa: F821
        for r in rows:
            nm = (r.get("name") or "").lower().replace("_", " ")
            if any(w in nm for w in words):
                lex.append({"file_id": r["file_id"], "name": r.get("name"), "folder_path": r.get("folder_path"), "has_text": bool((r.get("text") or "").strip())})
    indexed = await db.drive_snapshots.count_documents({"user_id": tenant})  # noqa: F821
    found = any(s.get("score", 0) >= 0.25 for s in sem) or any(l["has_text"] for l in lex)
    return {"query": q, "found": found, "semantic": sem, "lexical": lex[:10], "indexed_files": indexed, "semantic_chunks": _core_drive.count(tenant)}
