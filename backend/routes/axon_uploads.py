# axon_uploads.py — V50.z202 — Upload MULTIPART a chunk (senza base64, senza file interi in RAM) per Master Files e trascrizione (modulo ISOLATO)
#
# Caricato DOPO axon_drive_root.py e PRIMA di 37. STATO PRIMA: `POST /master-files` e `POST /ai/transcribe` ricevevano JSON con base64
# (+33% di banda, intero payload in RAM per il parse JSON) e i Master Files erano salvati INLINE in MongoDB (`data_base64`) → documenti
# vicini al limite 16 MB fallivano e ogni lettura caricava tutto. STATO DOPO:
#   • `POST /master-files/upload` (multipart: file, category, name?, title?) → lettura a chunk da 1 MB su file temporaneo con limite in
#     ingresso (50 MB, 413 oltre) + SHA-256 → Object Storage `master-files/{tenant}/{id}.ext` → MongoDB salva SOLO il riferimento
#     {storage:"object", storage_path, sha256, size, mime} (mai il contenuto). `GET /master-files/{id}/content[?token=]` serve il file.
#   • `POST /ai/transcribe/upload` (multipart: file, mime?) → chunk su temp (limite 25 MB) → Whisper direttamente dal file su disco.
#   • Gli endpoint JSON esistenti restano per compatibilità ma `POST /master-files` NON salva più inline (vedi patch in 16) e
#     `GET /master-files/{id}` ricarica il contenuto dallo storage solo su richiesta.
# NOTA Drive/Dropbox: le connessioni esistenti hanno SOLO scope di lettura (drive.readonly / files.content.read): scrivere lì richiederebbe
# una nuova autorizzazione con scope di scrittura → i file vanno su Object Storage (già usato da spese, media, KB).

import hashlib as _upl_hashlib
import tempfile as _upl_tempfile

_UPL_MASTER_MAX = 50 * 1024 * 1024
_UPL_AUDIO_MAX = 25 * 1024 * 1024
_UPL_CHUNK = 1024 * 1024


async def _upl_stream_to_temp(upload: UploadFile, max_bytes: int, suffix: str) -> Tuple[str, int, str]:
    """Legge l'UploadFile a chunk e lo scrive su un file temporaneo. Ritorna (path, size, sha256). 413 se supera il limite."""
    h = _upl_hashlib.sha256(); size = 0
    tmp = _upl_tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        while True:
            chunk = await upload.read(_UPL_CHUNK)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise HTTPException(status_code=413, detail=f"File troppo grande (max {max_bytes // (1024 * 1024)} MB)")
            h.update(chunk); tmp.write(chunk)
        tmp.flush()
    except Exception:
        tmp.close()
        try: os.unlink(tmp.name)
        except Exception: pass  # noqa: BLE001
        raise
    finally:
        try: await upload.close()
        except Exception: pass  # noqa: BLE001
    tmp.close()
    if size == 0:
        try: os.unlink(tmp.name)
        except Exception: pass  # noqa: BLE001
        raise HTTPException(status_code=400, detail="File vuoto")
    return tmp.name, size, h.hexdigest()


def _upl_ext(name: str, mime: str) -> str:
    n = (name or "").lower()
    if "." in n and 1 <= len(n.rsplit(".", 1)[1]) <= 5:
        return n.rsplit(".", 1)[1]
    m = (mime or "").lower()
    for k, v in (("pdf", "pdf"), ("png", "png"), ("jpeg", "jpg"), ("jpg", "jpg"), ("webp", "webp"), ("mp4", "mp4"), ("webm", "webm"), ("m4a", "m4a"), ("mpeg", "mp3"), ("wav", "wav"), ("csv", "csv"), ("json", "json"), ("text", "txt")):
        if k in m:
            return v
    return "bin"


def _upl_store_from_path(path: str, storage_path: str, mime: str) -> Optional[str]:
    """Thread: legge il temp e carica su Object Storage (3 tentativi)."""
    with open(path, "rb") as fh:
        data = fh.read()
    last = None
    for attempt in range(3):
        try:
            res = _put_object_sync(storage_path, data, mime)
            if res:
                return (res or {}).get("path") or storage_path
        except Exception as exc:  # noqa: BLE001
            last = exc
        import time as _t; _t.sleep(0.6 * (attempt + 1))
    logger.warning("[upl] store %s failed: %s", storage_path, last)
    return None


async def _upl_master_store(user: dict, category: str, name: str, mime: str, tmp_path: str, size: int, sha: str, title: Optional[str]) -> dict:
    file_id = f"mf_{uuid.uuid4().hex[:12]}"; tid = tenant_id(user)
    storage_path = f"master-files/{tid}/{file_id}.{_upl_ext(name, mime)}"
    try:
        stored = await run_in_threadpool(_upl_store_from_path, tmp_path, storage_path, mime)
    finally:
        try: os.unlink(tmp_path)
        except Exception: pass  # noqa: BLE001
    if not stored:
        raise HTTPException(status_code=503, detail="Archivio file non disponibile, riprova")
    doc = {"file_id": file_id, "user_id": tid, "created_by": user["user_id"], "category": category, "name": name, "title": (title or "").strip() or None, "body": None,
           "mime": mime, "storage": "object", "storage_path": stored, "sha256": sha, "size": size, "created_at": utcnow(), "updated_at": utcnow()}
    await db.master_files.insert_one(dict(doc))
    doc.pop("_id", None)
    doc["content_url"] = f"/api/master-files/{file_id}/content"
    return doc


@api_router.post("/master-files/upload")
async def master_file_upload(file: UploadFile = File(...), category: str = Form("files"), name: Optional[str] = Form(None), title: Optional[str] = Form(None), user=Depends(get_current_user)):
    """Upload multipart a chunk (max 50 MB): il contenuto va su Object Storage, MongoDB conserva solo il riferimento."""
    if category not in ALLOWED_MASTER_CATS or category == "notes":
        raise HTTPException(status_code=400, detail=f"category deve essere una tra: {sorted(ALLOWED_MASTER_CATS - {'notes'})}")
    nm = (name or file.filename or f"file-{int(utcnow().timestamp())}").strip()[:200]
    mime = (file.content_type or "application/octet-stream").split(";")[0].strip() or "application/octet-stream"
    tmp_path, size, sha = await _upl_stream_to_temp(file, _UPL_MASTER_MAX, "." + _upl_ext(nm, mime))
    doc = await _upl_master_store(user, category, nm, mime, tmp_path, size, sha, title)
    axs_event("api", "info", f"Master file caricato: {nm} ({round(size / 1024)} KB, {category})", None, user["user_id"], tenant_id(user))
    return doc


@api_router.get("/master-files/{file_id}/content")
async def master_file_content(file_id: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """Contenuto del Master File (storage o legacy inline). Auth via header o ?token= (viewer web / download)."""
    user = await get_current_user(authorization=authorization or (f"Bearer {token}" if token else None))
    d = await db.master_files.find_one({"user_id": tenant_id(user), "file_id": file_id}, {"_id": 0, "storage_path": 1, "mime": 1, "name": 1, "data_base64": 1})
    if not d:
        raise HTTPException(status_code=404, detail="File non trovato")
    from fastapi.responses import Response as _Resp
    if d.get("storage_path"):
        got = await run_in_threadpool(_get_object_sync, d["storage_path"])
        if not got:
            raise HTTPException(status_code=404, detail="Contenuto non disponibile")
        data, ctype = got[0], (d.get("mime") or got[1] or "application/octet-stream")
    elif d.get("data_base64"):
        data, ctype = base64.b64decode(d["data_base64"]), d.get("mime") or "application/octet-stream"
    else:
        raise HTTPException(status_code=404, detail="File senza contenuto")
    return _Resp(content=data, media_type=ctype, headers={"Content-Disposition": f'inline; filename="{(d.get("name") or file_id).replace(chr(34), "")}"', "Cache-Control": "private, max-age=3600"})


# ---------------------------------------------------------------------------- Whisper da file su disco
async def _upl_whisper_path(path: str) -> str:
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText  # type: ignore
    try:
        stt = OpenAISpeechToText(api_key=key)
        with open(path, "rb") as fh:
            result = await stt.transcribe(file=fh, model="whisper-1", language="it", response_format="text")
    except Exception as e:  # noqa: BLE001
        logger.exception("transcribe (multipart) error: %s", e)
        raise HTTPException(status_code=502, detail=f"Errore trascrizione: {str(e)[:300]}")
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, dict):
        return (result.get("text") or result.get("transcript") or "").strip()
    return str(getattr(result, "text", result) or "").strip()


def _upl_audio_suffix(mime: str, name: str) -> str:
    m = (mime or "").lower(); n = (name or "").lower()
    for k, s in (("webm", ".webm"), ("ogg", ".webm"), ("m4a", ".m4a"), ("mp4", ".m4a"), ("aac", ".m4a"), ("wav", ".wav"), ("mpeg", ".mp3"), ("mp3", ".mp3"), ("flac", ".flac")):
        if k in m or n.endswith(s):
            return s
    return ".mp3"


@api_router.post("/ai/transcribe/upload")
async def ai_transcribe_upload(file: UploadFile = File(...), mime: Optional[str] = Form(None), user=Depends(get_current_user)):
    """Trascrizione Whisper da upload multipart a chunk (max 25 MB), senza base64 né file in RAM."""
    eff_mime = (mime or file.content_type or "audio/webm").split(";")[0].strip()
    path, size, _sha = await _upl_stream_to_temp(file, _UPL_AUDIO_MAX, _upl_audio_suffix(eff_mime, file.filename or ""))
    if size < 1024:
        try: os.unlink(path)
        except Exception: pass  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Audio troppo corto o vuoto")
    try:
        transcript = await _upl_whisper_path(path)
    finally:
        try: os.unlink(path)
        except Exception: pass  # noqa: BLE001
    return {"transcript": transcript, "language": "it", "model": "whisper-1", "bytes": size}
