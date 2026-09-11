# master_docs_files.py — V50.z185 — Knowledge Base Axon: PDF originale visibile + testo estratto
#
# MODULO ISOLATO (dopo 23_axon_feedback_rag_rules e corporate_gym_manuals). Il PDF caricato in
# `POST /master-docs` viene ora salvato anche su Emergent Object Storage (`file_path` nel doc,
# vedi hook `_mdf_store_pdf` chiamato da 23). Qui:
#   • POST /master-docs/{doc_id}/link        → link firmato 12h (JWT kind="master_doc") apri/scarica
#   • GET  /public/master-doc/{token}[?download=1] → serve il PDF dallo storage (inline/attachment)
#   • GET  /master-docs/{doc_id}/text        → testo estratto per pagina (dai chunk) — fallback per i
#                                              PDF caricati PRIMA di questa versione (senza file originale)

_MDF_LINK_HOURS = 12
_MDF_MAX_BYTES = 40 * 1024 * 1024


def _mdf_path(tid: str, doc_id: str) -> str:
    return f"{_STORAGE_APP_NAME}/master-docs/{tid}/{doc_id}.pdf"


async def _mdf_store_pdf(tid: str, doc_id: str, b64: str) -> Optional[str]:
    """Salva il PDF originale su Object Storage; ritorna il path o None (fault-tolerant)."""
    try:
        import base64 as _b64
        raw = _b64.b64decode(b64.split(",", 1)[1] if b64.startswith("data:") else b64)
        if not raw or len(raw) > _MDF_MAX_BYTES:
            return None
        path = _mdf_path(tid, doc_id)
        res = await run_in_threadpool(_put_object_sync, path, raw, "application/pdf")
        if not res:
            return None
        fp = res.get("path") or path
        await db.master_documents.update_one({"doc_id": doc_id}, {"$set": {"file_path": fp, "file_size": len(raw)}})
        return fp
    except Exception as exc:  # noqa: BLE001
        logger.warning("[master-docs-files] store failed for %s: %s", doc_id, exc)
        return None


@api_router.post("/master-docs/{doc_id}/link")
async def master_doc_link(doc_id: str, request: Request, user=Depends(get_current_user)):
    tid = tenant_id(user)
    doc = await db.master_documents.find_one({"doc_id": doc_id, "tenant_id": tid}, {"_id": 0, "name": 1, "kind": 1, "file_path": 1, "file_size": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    if (doc.get("kind") or "pdf") != "pdf" or not doc.get("file_path"):
        raise HTTPException(status_code=404, detail="File originale non disponibile: questo PDF è stato caricato prima dell'aggiornamento. Puoi leggere il testo estratto oppure ricaricarlo.")
    exp_dt = utcnow() + timedelta(hours=_MDF_LINK_HOURS)
    token = jwt.encode({"kind": "master_doc", "tenant_id": tid, "doc_id": doc_id, "user_id": user["user_id"],
                        "exp": int(exp_dt.timestamp())}, JWT_SECRET, algorithm=JWT_ALG)
    base = _cgym_man_base_url(request)
    name = (doc.get("name") or "documento").strip()
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return {"name": name, "mime": "application/pdf", "size": doc.get("file_size"),
            "url": f"{base}/api/public/master-doc/{token}", "download_url": f"{base}/api/public/master-doc/{token}?download=1",
            "expires_at": exp_dt.isoformat()}


@api_router.get("/public/master-doc/{token}")
async def master_doc_public(token: str, download: Optional[str] = None):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link scaduto: riapri il documento dall'app")
    except Exception:
        raise HTTPException(status_code=400, detail="Link non valido")
    if payload.get("kind") != "master_doc":
        raise HTTPException(status_code=400, detail="Token non compatibile")
    doc = await db.master_documents.find_one({"doc_id": payload.get("doc_id"), "tenant_id": payload.get("tenant_id")},
                                             {"_id": 0, "name": 1, "file_path": 1})
    if not doc or not doc.get("file_path"):
        raise HTTPException(status_code=404, detail="Documento non trovato")
    res = await run_in_threadpool(_get_object_sync, doc["file_path"])
    if not res:
        raise HTTPException(status_code=502, detail="Storage non disponibile")
    data, _ = res
    name = (doc.get("name") or "documento").strip()
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    disp = "attachment" if (download or "").lower() in ("1", "true", "yes") else "inline"
    safe_name = re.sub(r'[\r\n"]', "_", name)
    from urllib.parse import quote as _mdf_quote
    return Response(content=data, media_type="application/pdf", headers={
        "Content-Disposition": f"{disp}; filename=\"{safe_name.encode('ascii', 'ignore').decode() or 'documento.pdf'}\"; filename*=UTF-8''{_mdf_quote(safe_name)}",
        "Cache-Control": "no-store",
    })


@api_router.get("/master-docs/{doc_id}/text")
async def master_doc_text(doc_id: str, user=Depends(get_current_user)):
    """Testo estratto per pagina (quello che Axon legge). Sempre disponibile, anche per i PDF senza file originale."""
    tid = tenant_id(user)
    doc = await db.master_documents.find_one({"doc_id": doc_id, "tenant_id": tid}, {"_id": 0, "name": 1, "kind": 1, "file_path": 1, "total_pages": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    pages: Dict[int, List[str]] = {}
    async for c in db.master_doc_chunks.find({"doc_id": doc_id}, {"_id": 0, "page_number": 1, "chunk_index": 1, "content": 1}).sort([("page_number", 1), ("chunk_index", 1)]).limit(2000):
        pages.setdefault(int(c.get("page_number") or 1), []).append(c.get("content") or "")
    return {"doc_id": doc_id, "name": doc.get("name"), "has_file": bool(doc.get("file_path")),
            "pages": [{"page": p, "text": "\n\n".join(t).strip()} for p, t in sorted(pages.items())]}
