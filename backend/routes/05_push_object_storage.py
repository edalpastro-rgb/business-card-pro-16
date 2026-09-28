# 05_push_object_storage.py — Push notifications (Emergent) + Object Storage
# Estratto da server.py (righe originali 1984-2289). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V50.z84 — Push notifications (Emergent managed) + Object Storage (allegati)
# =========================
import httpx as _httpx  # sicurezza: httpx già importato altrove ma alias safe
from fastapi.concurrency import run_in_threadpool
import requests as _requests

_PUSH_BASE_URL = (os.environ.get("INTEGRATION_PROXY_URL") or "https://integrations.emergentagent.com").rstrip("/")
_PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = _httpx.AsyncClient(
    base_url=_PUSH_BASE_URL,
    headers={"X-Push-Key": _PUSH_KEY},
    timeout=10.0,
)


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, user=Depends(get_current_user)):
    """Registra il device token del dispositivo dell'utente per ricevere push."""
    # Sicurezza: forza user_id = utente autenticato
    payload = {"user_id": user["user_id"], "platform": body.platform, "device_token": body.device_token}
    try:
        resp = await _push_client.post("/api/v1/push/users/register", json=payload)
        if resp.status_code == 401:
            raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
        if resp.status_code >= 500:
            raise HTTPException(502, "Push provider unavailable")
        resp.raise_for_status()
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"register_push failed: {e}")
        # Non blocchiamo il login se push provider è down
        return {"status": "deferred"}
    return {"status": "registered"}


async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    """Trigger push notification a una lista di user_id (max 100). Fault-tolerant."""
    if not recipients:
        return
    if len(recipients) > 100:
        recipients = recipients[:100]
    if "title" not in data or "message" not in data:
        raise ValueError("send_push data must include title and message")
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    try:
        resp = await _push_client.post("/api/v1/push/trigger", json=payload)
        if resp.status_code == 401:
            logger.warning("send_push: EMERGENT_PUSH_KEY not configured (placeholder). Skipping.")
            return
        if resp.status_code >= 400:
            logger.warning(f"send_push: upstream returned {resp.status_code}: {resp.text[:200]}")
            return
    except Exception as e:
        logger.warning(f"send_push failed: {e}")


# --- Object Storage (allegati chat) ---
_STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
_STORAGE_URL = _STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
_STORAGE_APP_NAME = "advisoros"
_EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
_storage_key_cache: Optional[str] = None


def _init_storage_sync() -> Optional[str]:
    global _storage_key_cache
    if _storage_key_cache:
        return _storage_key_cache
    if not _EMERGENT_LLM_KEY:
        return None
    try:
        r = _requests.post(f"{_STORAGE_URL}/init", json={"emergent_key": _EMERGENT_LLM_KEY}, timeout=30)
        r.raise_for_status()
        _storage_key_cache = r.json().get("storage_key")
        return _storage_key_cache
    except Exception as e:
        logger.warning(f"init_storage failed: {e}")
        return None


def _put_object_sync(path: str, data: bytes, content_type: str) -> Optional[dict]:
    key = _init_storage_sync()
    if not key:
        return None
    try:
        r = _requests.put(
            f"{_STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
        if r.status_code == 503:
            # stale key → reinit
            global _storage_key_cache
            _storage_key_cache = None
            key2 = _init_storage_sync()
            if not key2:
                return None
            r = _requests.put(
                f"{_STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key2, "Content-Type": content_type},
                data=data,
                timeout=120,
            )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"put_object failed for {path}: {e}")
        return None


def _get_object_sync(path: str) -> Optional[Tuple[bytes, str]]:
    key = _init_storage_sync()
    if not key:
        return None
    try:
        r = _requests.get(f"{_STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
        r.raise_for_status()
        return r.content, r.headers.get("Content-Type", "application/octet-stream")
    except Exception as e:
        logger.warning(f"get_object failed for {path}: {e}")
        return None


@api_router.post("/info-requests/{request_id}/attachments")
async def upload_ireq_attachment(request_id: str, file: UploadFile = File(...), user=Depends(get_current_user)):
    """Upload di un allegato (foto o PDF) nel thread di una richiesta info.
    Il file viene salvato su Emergent Object Storage e il record salvato nel messaggio."""
    tid = tenant_id(user)
    d = await db.info_requests.find_one({"user_id": tid, "request_id": request_id})
    if not d:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if not is_owner(user) and d.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    # Sanity: solo immagini/PDF, max ~15 MB
    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File troppo grande (max 15 MB)")
    ctype = (file.content_type or "").lower()
    # V50.z388 — compressione globale silenziosa (foto/PDF) prima dello store
    content, _ci = await media_auto_compress(content, ctype, file.filename or "", "ireq-attachment")  # noqa: F821 — media_compress.py
    if _ci.get("compressed") and _ci.get("mime"):
        ctype = _ci["mime"]
    ext = ""
    if ctype.startswith("image/"): ext = ctype.split("/", 1)[1].split(";")[0] or "jpg"
    elif ctype == "application/pdf": ext = "pdf"
    else:
        # accetta comunque con ext dal filename
        fn = (file.filename or "").lower()
        if "." in fn: ext = fn.rsplit(".", 1)[1][:5]
        else: ext = "bin"
    obj_id = uuid.uuid4().hex
    path = f"{_STORAGE_APP_NAME}/info-requests/{tid}/{request_id}/{obj_id}.{ext}"
    put_res = await run_in_threadpool(_put_object_sync, path, content, ctype or "application/octet-stream")
    if not put_res:
        raise HTTPException(status_code=502, detail="Storage non disponibile")
    now = utcnow()
    attach = {
        "attach_id": obj_id,
        "path": put_res.get("path") or path,
        "size": put_res.get("size") or len(content),
        "content_type": ctype or "application/octet-stream",
        "filename": file.filename or f"{obj_id}.{ext}",
    }
    msg = {
        "author_id": user["user_id"],
        "author_name": user.get("name") or user.get("email") or "",
        "author_role": "master" if is_owner(user) else "collaborator",
        "text": "",
        "attachment": attach,
        "at": now,
    }
    seen_field = "master_last_seen_at" if is_owner(user) else "collaborator_last_seen_at"
    await db.info_requests.update_one(
        {"request_id": request_id},
        {"$push": {"messages": msg}, "$set": {"updated_at": now, seen_field: now}},
    )
    # Push notification al destinatario opposto
    try:
        recipient = None
        if is_owner(user):
            recipient = d.get("created_by")
        else:
            # Master = tenant owner
            recipient = tid
        if recipient and recipient != user["user_id"]:
            await send_push(
                recipients=[recipient],
                data={
                    "title": user.get("name") or "Nuovo allegato",
                    "message": f"📎 {attach['filename']}",
                    "action_url": f"/info-request-chat?id={request_id}",
                },
                idempotency_key=f"ireq-att-{obj_id}",
            )
    except Exception as e:
        logger.warning(f"push on attachment failed: {e}")
    updated = await db.info_requests.find_one({"request_id": request_id}, {"_id": 0})
    return _info_req_out(updated)


@api_router.get("/info-requests/attachments/{attach_path:path}")
async def get_ireq_attachment(attach_path: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """Scarica un allegato. Verifica proprietà via DB (Master vede tutto del tenant, sub-user solo proprie richieste).
    Auth via header Authorization o query ?token= (utile per <img src> su web preview)."""
    # Auth flessibile
    auth_header = authorization or (f"Bearer {token}" if token else None)
    user = await get_current_user(authorization=auth_header)
    tid = tenant_id(user)
    # Trova richiesta contenente l'allegato
    doc = await db.info_requests.find_one({"user_id": tid, "messages.attachment.path": attach_path})
    if not doc:
        raise HTTPException(status_code=404, detail="Allegato non trovato")
    if not is_owner(user) and doc.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    res = await run_in_threadpool(_get_object_sync, attach_path)
    if not res:
        raise HTTPException(status_code=502, detail="Storage non disponibile")
    content, ctype = res
    return Response(content=content, media_type=ctype)


@api_router.post("/info-requests/{request_id}/messages")
async def reply_info_request(request_id: str, body: InfoRequestMessageIn, user=Depends(get_current_user)):
    """Aggiunge un messaggio al thread. Sia Master che creatore possono rispondere."""
    tid = tenant_id(user)
    d = await db.info_requests.find_one({"user_id": tid, "request_id": request_id})
    if not d:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if not is_owner(user) and d.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    now = utcnow()
    msg = {
        "author_id": user["user_id"],
        "author_name": user.get("name") or user.get("email") or "",
        "author_role": "master" if is_owner(user) else "collaborator",
        "text": body.text.strip(),
        "at": now,
    }
    seen_field = "master_last_seen_at" if is_owner(user) else "collaborator_last_seen_at"
    await db.info_requests.update_one(
        {"request_id": request_id},
        {
            "$push": {"messages": msg},
            "$set": {"updated_at": now, seen_field: now},
        },
    )
    # V50.z84 — Push al destinatario opposto (Master → collaboratore, o viceversa)
    try:
        recipient = None
        if is_owner(user):
            recipient = d.get("created_by")  # push al collaboratore che ha creato
        else:
            recipient = tid  # push al Master (tenant owner)
        if recipient and recipient != user["user_id"]:
            preview = (body.text.strip()[:120] + ("…" if len(body.text.strip()) > 120 else ""))
            await send_push(
                recipients=[recipient],
                data={
                    "title": user.get("name") or "Nuovo messaggio",
                    "message": preview,
                    "action_url": f"/info-request-chat?id={request_id}",
                },
                idempotency_key=f"ireq-msg-{request_id}-{int(now.timestamp())}",
            )
    except Exception as e:
        logger.warning(f"push on reply failed: {e}")
    updated = await db.info_requests.find_one({"request_id": request_id}, {"_id": 0})
    return _info_req_out(updated)


@api_router.post("/info-requests/{request_id}/seen")
async def mark_info_request_seen(request_id: str, user=Depends(get_current_user)):
    """Segna la richiesta come letta dall'utente corrente."""
    tid = tenant_id(user)
    d = await db.info_requests.find_one({"user_id": tid, "request_id": request_id})
    if not d:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if not is_owner(user) and d.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    now = utcnow()
    seen_field = "master_last_seen_at" if is_owner(user) else "collaborator_last_seen_at"
    await db.info_requests.update_one({"request_id": request_id}, {"$set": {seen_field: now}})
    return {"ok": True}


@api_router.get("/contacts/{contact_id}/info-requests")
async def list_info_requests_for_contact(contact_id: str, user=Depends(get_current_user)):
    """Richieste info collegate a un contatto specifico (per la scheda cliente)."""
    tid = tenant_id(user)
    c = await db.contacts.find_one({"user_id": tid, "contact_id": contact_id}, {"_id": 0, "contact_id": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    q: Dict[str, Any] = {"user_id": tid, "contact_id": contact_id}
    if not is_owner(user):
        q["created_by"] = user["user_id"]
    docs = await db.info_requests.find(q, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return {"items": [{**_info_req_out(d), "unread": _info_req_unread_for(d, user)} for d in docs]}


# =========================
