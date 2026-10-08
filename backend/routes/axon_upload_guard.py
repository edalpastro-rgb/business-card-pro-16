# axon_upload_guard.py — V50.z469 — Feature 15/15: sicurezza upload (whitelist formati + limiti + antivirus ClamAV) — modulo ISOLATO
#
# Caricato DOPO axon_uploads.py / identity_documents.py / 16_master_files (wrap) e PRIMA di 37. Un solo punto di controllo:
#   `_upg_check(raw: bytes, name, mime, kind)` → 415 formato non consentito · 413 troppo grande · 422 contenuto malevolo.
# • WHITELIST per MAGIC BYTES (non per estensione, che è falsificabile): documenti/immagini = JPG, PNG, PDF; audio (trascrizioni) =
#   m4a/mp4, mp3, wav, ogg, webm, flac, 3gp. Tutto il resto (exe, zip, html, svg, docx…) → 415.
# • LIMITI: immagini 12 MB, PDF 50 MB, audio 25 MB (env UPLOAD_MAX_IMAGE_MB / UPLOAD_MAX_PDF_MB / UPLOAD_MAX_AUDIO_MB).
# • ANTIVIRUS: ClamAV via protocollo clamd INSTREAM (TCP `CLAMAV_HOST:CLAMAV_PORT`, default clamav:3310 = servizio del docker-compose VPS).
#   Esito FOUND → 422 «File rifiutato: contenuto potenzialmente dannoso». ClamAV non raggiungibile → `CLAMAV_REQUIRED=1` rifiuta (503),
#   altrimenti (default) lascia passare e logga (fail-open per non bloccare il lavoro se il container AV è in aggiornamento firme).
# Hook: `_put_object_sync` (tutti gli upload su Object Storage: master files, documenti identità, audio), `_upl_stream_to_temp`
# (multipart: rifiuto PRIMA della compressione/store), `POST /master-files` (base64 in Mongo). Esito in `axon_upload_guard_log`.

import socket as _upg_socket
import struct as _upg_struct
import contextvars as _upg_ctxvars

# V50.z472 — Report antivirus: ogni rifiuto (formato/dimensione/virus/AV non disponibile) viene registrato in `axon_upload_guard_log`
# con data, utente, file, endpoint e motivo. Utente/endpoint arrivano da una contextvar impostata dal middleware (anche nei
# thread di run_in_threadpool: anyio propaga il contesto). GET /admin/upload-guard/rejections → pannello Master.
_upg_req_ctx: _upg_ctxvars.ContextVar[Optional[dict]] = _upg_ctxvars.ContextVar("upg_req_ctx", default=None)
_upg_loop: dict = {"loop": None}

_UPG_HOST = (os.environ.get("CLAMAV_HOST") or "clamav").strip()
_UPG_PORT = int(os.environ.get("CLAMAV_PORT") or 3310)
_UPG_REQUIRED = (os.environ.get("CLAMAV_REQUIRED") or "0").strip().lower() in ("1", "true", "yes")
_UPG_ENABLED = (os.environ.get("CLAMAV_DISABLE") or "0").strip().lower() not in ("1", "true", "yes")
_UPG_MAX = {
    "image": int(os.environ.get("UPLOAD_MAX_IMAGE_MB") or 12) * 1024 * 1024,
    "pdf": int(os.environ.get("UPLOAD_MAX_PDF_MB") or 50) * 1024 * 1024,
    "audio": int(os.environ.get("UPLOAD_MAX_AUDIO_MB") or 25) * 1024 * 1024,
}
_UPG_ALLOWED_DOC = ("image/jpeg", "image/png", "application/pdf")
_upg_state = {"last_ok": None, "last_error": None, "scanned": 0, "blocked": 0}


def _upg_sniff(raw: bytes) -> Optional[str]:
    """Tipo reale dai magic bytes (None = sconosciuto/non consentito)."""
    h = raw[:16]
    if h.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if h.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if h.startswith(b"%PDF-"):
        return "application/pdf"
    if len(raw) >= 12 and raw[4:8] == b"ftyp":
        return "audio/mp4"  # m4a/mp4/3gp (isom, M4A, 3gp…)
    if h.startswith(b"ID3") or (len(h) >= 2 and h[0] == 0xFF and (h[1] & 0xE0) == 0xE0):
        return "audio/mpeg"
    if h.startswith(b"RIFF") and raw[8:12] == b"WAVE":
        return "audio/wav"
    if h.startswith(b"OggS"):
        return "audio/ogg"
    if h.startswith(b"\x1aE\xdf\xa3"):
        return "audio/webm"
    if h.startswith(b"fLaC"):
        return "audio/flac"
    if h.startswith(b"#!AMR"):
        return "audio/amr"
    return None


def _upg_clamd_scan(raw: bytes) -> Tuple[str, str]:
    """('OK'|'FOUND'|'ERROR', dettaglio) — protocollo clamd INSTREAM: zINSTREAM\\0 + [len(4 BE) + chunk]* + len 0."""
    try:
        with _upg_socket.create_connection((_UPG_HOST, _UPG_PORT), timeout=4) as s:
            s.settimeout(30)
            s.sendall(b"zINSTREAM\0")
            mv = memoryview(raw); step = 256 * 1024
            for i in range(0, len(mv), step):
                chunk = mv[i:i + step]
                s.sendall(_upg_struct.pack("!I", len(chunk))); s.sendall(chunk)
            s.sendall(_upg_struct.pack("!I", 0))
            resp = b""
            while True:
                part = s.recv(4096)
                if not part:
                    break
                resp += part
                if b"\0" in part:
                    break
        txt = resp.decode(errors="ignore").strip("\0 \n")
        if txt.endswith("OK"):
            return "OK", txt
        if "FOUND" in txt:
            return "FOUND", txt
        return "ERROR", txt or "risposta vuota"
    except Exception as exc:  # noqa: BLE001
        return "ERROR", f"{type(exc).__name__}: {exc}"


def _upg_log_rejection(reason_code: str, reason: str, name: str, mime: str, size: int, sniffed: Optional[str], detail: str = "") -> None:
    """Registra il rifiuto (thread-safe: usa il loop principale catturato allo startup)."""
    ctx = _upg_req_ctx.get() or {}
    doc = {"at": utcnow(), "reason_code": reason_code, "reason": reason, "detail": (detail or "")[:300], "file_name": (name or "")[:200], "declared_mime": (mime or "")[:80],
           "sniffed_mime": sniffed, "size": int(size or 0), "user_id": ctx.get("user_id"), "user_email": ctx.get("email"), "user_name": ctx.get("name"), "tenant_id": ctx.get("tenant_id"),
           "endpoint": ctx.get("path"), "ip": ctx.get("ip")}
    _upg_state["blocked"] += 1
    logger.warning("[upload-guard] REJECTED %s · %s · %s (%s) user=%s", reason_code, name, reason, detail[:80], ctx.get("email"))
    try:
        loop = _upg_loop.get("loop")
        if loop is None:
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            loop.create_task(db.axon_upload_guard_log.insert_one(doc))
        else:
            asyncio.run_coroutine_threadsafe(db.axon_upload_guard_log.insert_one(doc), loop)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[upload-guard] log failed: %s", exc)


def _upg_check_sync(raw: bytes, name: str = "", mime: str = "", kind: str = "document") -> dict:
    """kind: document (jpg/png/pdf) | audio | any (document+audio). Alza HTTPException 413/415/422/503 (ogni rifiuto è loggato)."""
    real = _upg_sniff(raw)

    def _reject(code: int, reason_code: str, msg: str, detail: str = ""):
        _upg_log_rejection(reason_code, msg, name, mime, len(raw), real, detail)
        raise HTTPException(status_code=code, detail=msg)

    if real is None:
        _reject(415, "format", "Formato non consentito: sono accettati solo JPG, PNG e PDF" + (" (o audio per le trascrizioni)" if kind != "document" else "") + ".", f"magic bytes sconosciuti: {raw[:8].hex()}")
    is_audio = real.startswith("audio/")
    if kind == "document" and is_audio:
        _reject(415, "format", "Formato non consentito: sono accettati solo JPG, PNG e PDF.", f"audio ({real}) dove servono documenti")
    if kind == "audio" and not is_audio:
        _reject(415, "format", "Formato audio non riconosciuto (m4a, mp3, wav, ogg, webm, flac).", f"rilevato {real}")
    cat = "audio" if is_audio else ("pdf" if real == "application/pdf" else "image")
    if len(raw) > _UPG_MAX[cat]:
        _reject(413, "size", f"File troppo grande (max {_UPG_MAX[cat] // (1024 * 1024)} MB per {cat})", f"{len(raw) // 1024} KB")
    av = "skipped"
    if _UPG_ENABLED:
        status, detail = _upg_clamd_scan(raw)
        _upg_state["scanned"] += 1
        if status == "FOUND":
            _reject(422, "virus", "File rifiutato: contenuto potenzialmente dannoso rilevato dall'antivirus.", detail)
        if status == "ERROR":
            _upg_state["last_error"] = detail
            if _UPG_REQUIRED:
                _reject(503, "av_unavailable", "Antivirus non disponibile: riprova tra qualche istante.", detail)
            av = "unavailable"
        else:
            _upg_state["last_ok"] = utcnow(); av = "clean"
    return {"mime": real, "size": len(raw), "category": cat, "antivirus": av}


@app.middleware("http")
async def _upg_context_middleware(request: Request, call_next):
    """Contesto richiesta (utente dal JWT, endpoint, IP) per il report antivirus — solo sulle richieste con body da caricare."""
    token = None
    if request.method in ("POST", "PUT") and (request.headers.get("content-length") or "0") != "0":
        auth = request.headers.get("authorization") or ""
        if auth.startswith("Bearer "):
            token = auth[7:].strip()
    ctx = None
    if token:
        ctx = {"path": request.url.path, "ip": (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "") or "").split(",")[0].strip()}
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            ctx["user_id"] = payload.get("sub")
        except Exception:  # noqa: BLE001
            sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0, "user_id": 1})
            ctx["user_id"] = sess.get("user_id") if sess else None
        if ctx.get("user_id"):
            u = await db.users.find_one({"user_id": ctx["user_id"]}, {"_id": 0, "email": 1, "name": 1, "parent_user_id": 1})
            if u:
                ctx["email"] = u.get("email"); ctx["name"] = u.get("name"); ctx["tenant_id"] = u.get("parent_user_id") or ctx["user_id"]
    tok = _upg_req_ctx.set(ctx)
    try:
        return await call_next(request)
    finally:
        _upg_req_ctx.reset(tok)


@app.on_event("startup")
async def _upg_startup():
    _upg_loop["loop"] = asyncio.get_running_loop()
    try:
        await db.axon_upload_guard_log.create_index([("at", -1)])
        await db.axon_upload_guard_log.create_index([("tenant_id", 1), ("at", -1)])
    except Exception:  # noqa: BLE001
        pass


@api_router.get("/admin/upload-guard/rejections")
async def upg_rejections(limit: int = 100, reason: Optional[str] = None, user=Depends(get_current_user)):
    """Report antivirus per il pannello Master: file rifiutati con data, utente, motivo. Master → solo il proprio tenant; Super Master → tutti."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    q: dict = {}
    if not (user.get("super_admin") is True):
        q["tenant_id"] = tenant_id(user)
    if reason in ("format", "size", "virus", "av_unavailable"):
        q["reason_code"] = reason
    n = max(1, min(limit, 500))
    rows = await db.axon_upload_guard_log.find(q, {"_id": 0}).sort("at", -1).to_list(n)
    for r in rows:
        if isinstance(r.get("at"), datetime):
            r["at"] = r["at"].isoformat()
    since = utcnow() - timedelta(days=30)
    agg = await db.axon_upload_guard_log.aggregate([{"$match": {**q, "at": {"$gte": since}}}, {"$group": {"_id": "$reason_code", "n": {"$sum": 1}}}]).to_list(10)
    by_reason = {a["_id"]: a["n"] for a in agg if a.get("_id")}
    total30 = sum(by_reason.values())
    av_status, av_detail = (await run_in_threadpool(_upg_clamd_scan, b"ping-" + b"x" * 16)) if _UPG_ENABLED else ("disabled", "")
    return {"items": rows, "stats_30d": {"total": total30, "by_reason": by_reason}, "antivirus": {"enabled": _UPG_ENABLED, "required": _UPG_REQUIRED, "status": av_status, "detail": av_detail[:160], "host": f"{_UPG_HOST}:{_UPG_PORT}"},
            "limits_mb": {k: v // (1024 * 1024) for k, v in _UPG_MAX.items()}, "allowed": ["JPG", "PNG", "PDF", "audio (trascrizioni)"],
            "labels": {"format": "Formato non consentito", "size": "File troppo grande", "virus": "Virus / contenuto dannoso", "av_unavailable": "Antivirus non disponibile"}}


# ── HOOK 1: Object Storage (tutti gli upload binari) ────────────────────────────────────────────────────────────────────
_upg_prev_put_object_sync = _put_object_sync  # noqa: F821 — 05_push_object_storage


def _put_object_sync(path: str, data: bytes, content_type: str) -> Optional[dict]:  # noqa: F811
    kind = "audio" if (content_type or "").startswith("audio/") or "/audio" in (path or "") or "transcri" in (path or "") else ("any" if "master-files" in (path or "") else "document")
    _upg_check_sync(data, path, content_type, kind)
    return _upg_prev_put_object_sync(path, data, content_type)


# ── HOOK 2: multipart → temp file (rifiuto PRIMA di compressione/store) ─────────────────────────────────────────────────
_upg_prev_stream_to_temp = _upl_stream_to_temp  # noqa: F821 — axon_uploads


async def _upl_stream_to_temp(upload, max_bytes: int, suffix: str):  # noqa: F811
    path, size, sha = await _upg_prev_stream_to_temp(upload, max_bytes, suffix)
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
        kind = "audio" if (upload.content_type or "").startswith("audio/") or (suffix or "").lower() in (".m4a", ".mp3", ".wav", ".ogg", ".webm", ".3gp", ".flac") else "any"
        await run_in_threadpool(_upg_check_sync, raw, getattr(upload, "filename", "") or "", upload.content_type or "", kind)
    except HTTPException:
        try: os.unlink(path)
        except Exception: pass  # noqa: BLE001
        raise
    return path, size, sha


# ── HOOK 3: POST /master-files (base64 in Mongo) ────────────────────────────────────────────────────────────────────────
_upg_prev_add_master_file = add_master_file  # noqa: F821 — 16_master_files_business_card


async def add_master_file(body: MasterFileIn, user=Depends(get_current_user)):  # noqa: F811, F821 — MasterFileIn da 16
    b64 = (getattr(body, "data_base64", "") or "").strip()
    if b64:
        try:
            raw = base64.b64decode(b64.split(",", 1)[1] if b64.startswith("data:") and "," in b64 else b64, validate=False)
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="data_base64 non valido")
        await run_in_threadpool(_upg_check_sync, raw, getattr(body, "name", "") or "", getattr(body, "mime", "") or "", "any")
    return await _upg_prev_add_master_file(body, user)


# la rotta registrata in 16 punta alla vecchia funzione: la togliamo e la registriamo di nuovo con il wrapper (prima di include_router in 37)
api_router.routes[:] = [_r for _r in api_router.routes if not (getattr(_r, "path", "") == "/api/master-files" and "POST" in (getattr(_r, "methods", None) or set()))]
api_router.add_api_route("/master-files", add_master_file, methods=["POST"])
assert sum(1 for _r in api_router.routes if getattr(_r, "path", "") == "/api/master-files" and "POST" in (getattr(_r, "methods", None) or set())) == 1, "upload-guard: rotta POST /master-files duplicata"


@api_router.get("/admin/upload-guard/status")
async def upg_status(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    status, detail = await run_in_threadpool(_upg_clamd_scan, b"ping-" + b"x" * 16) if _UPG_ENABLED else ("disabled", "")
    return {"enabled": _UPG_ENABLED, "required": _UPG_REQUIRED, "host": f"{_UPG_HOST}:{_UPG_PORT}", "clamav": status, "detail": detail[:200],
            "allowed": ["jpg", "png", "pdf", "audio (trascrizioni)"], "limits_mb": {k: v // (1024 * 1024) for k, v in _UPG_MAX.items()},
            "scanned": _upg_state["scanned"], "blocked": _upg_state["blocked"], "last_ok": _upg_state["last_ok"].isoformat() if _upg_state["last_ok"] else None, "last_error": _upg_state["last_error"]}


_OMNI_EXTRA_SECTIONS.append((
    "Sicurezza upload (antivirus) + Report file rifiutati", "/admin/upload-guard/rejections",
    "Ogni file caricato è accettato solo se è davvero JPG, PNG o PDF (audio per le trascrizioni), entro i limiti di dimensione, e viene analizzato da ClamAV sul server prima del salvataggio; "
    "un file sospetto è rifiutato con un messaggio chiaro. Nel Pannello Master › «Report antivirus» (route app /admin/upload-guard) il Master vede l'elenco dei file rifiutati con data, utente, file e motivo "
    "(formato, dimensione, virus, antivirus non disponibile) e lo stato di ClamAV.",
))
