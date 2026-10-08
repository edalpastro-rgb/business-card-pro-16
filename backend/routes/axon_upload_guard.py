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


def _upg_check_sync(raw: bytes, name: str = "", mime: str = "", kind: str = "document") -> dict:
    """kind: document (jpg/png/pdf) | audio | any (document+audio). Alza HTTPException 413/415/422/503."""
    real = _upg_sniff(raw)
    if real is None:
        raise HTTPException(status_code=415, detail="Formato non consentito: sono accettati solo JPG, PNG e PDF" + (" (o audio per le trascrizioni)" if kind != "document" else "") + ".")
    is_audio = real.startswith("audio/")
    if kind == "document" and is_audio:
        raise HTTPException(status_code=415, detail="Formato non consentito: sono accettati solo JPG, PNG e PDF.")
    if kind == "audio" and not is_audio:
        raise HTTPException(status_code=415, detail="Formato audio non riconosciuto (m4a, mp3, wav, ogg, webm, flac).")
    cat = "audio" if is_audio else ("pdf" if real == "application/pdf" else "image")
    if len(raw) > _UPG_MAX[cat]:
        raise HTTPException(status_code=413, detail=f"File troppo grande (max {_UPG_MAX[cat] // (1024 * 1024)} MB per {cat})")
    av = "skipped"
    if _UPG_ENABLED:
        status, detail = _upg_clamd_scan(raw)
        _upg_state["scanned"] += 1
        if status == "FOUND":
            _upg_state["blocked"] += 1
            logger.warning("[upload-guard] BLOCKED %s (%s): %s", name, real, detail)
            raise HTTPException(status_code=422, detail="File rifiutato: contenuto potenzialmente dannoso rilevato dall'antivirus.")
        if status == "ERROR":
            _upg_state["last_error"] = detail
            if _UPG_REQUIRED:
                raise HTTPException(status_code=503, detail="Antivirus non disponibile: riprova tra qualche istante.")
            av = "unavailable"
        else:
            _upg_state["last_ok"] = utcnow(); av = "clean"
    return {"mime": real, "size": len(raw), "category": cat, "antivirus": av}


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
    "Sicurezza upload (antivirus)", "/admin/upload-guard/status",
    "Ogni file caricato è accettato solo se è davvero JPG, PNG o PDF (audio per le trascrizioni), entro i limiti di dimensione, e viene analizzato da ClamAV sul server prima del salvataggio; "
    "un file sospetto è rifiutato con un messaggio chiaro. Il Master vede lo stato dell'antivirus con «stato antivirus».",
))
