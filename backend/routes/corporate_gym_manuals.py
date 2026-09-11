# corporate_gym_manuals.py — Corporate Gym · Manuali su Google Drive (AxonOS gestore manuali)
# Modulo ISOLATO (nessuna modifica ai moduli esistenti). Usa gli helper condivisi del namespace:
#   api_router, db, get_current_user, tenant_id, is_owner, utcnow, jwt/JWT_SECRET/JWT_ALG, Request,
#   _gd_configured, _gd_get_credentials (28_google_drive.py).
#
# Funzionamento:
#   • Il Master (titolare del tenant) collega Google Drive (pagina Google Drive esistente) e configura UNA volta
#     la cartella principale "Corporate Gym" (con sottocartelle "Obiezioni" e "WIN-WIN").
#   • Le sottocartelle vengono riconosciute per nome (case-insensitive: obiezioni/obbiezioni, win-win/winwin/win win)
#     e ri-risolte automaticamente se mancanti (il Master può crearle anche dopo).
#   • Tutti i membri del tenant leggono i manuali con le CREDENZIALI DRIVE DEL MASTER (non serve Drive personale).
#   • Nessuna copia locale: ogni apertura legge da Drive → tutti vedono sempre l'ultima versione del file.
#   • Apertura/download via link firmato (JWT kind="cgym_manual", 12h) servito da GET /public/cgym-manual/{token}.
#
# Collection: cgym_manuals_config { tenant_id, root_folder_id, root_folder_name, subfolders: {obiezioni:{id,name}, winwin:{id,name}},
#                                   configured_by, updated_at }

_CGYM_MAN_TYPES = ("obiezioni", "winwin")
_CGYM_MAN_LABELS = {"obiezioni": "Gym Obiezioni", "winwin": "Gym WIN-WIN"}
_CGYM_MAN_EXPORTABLE = {
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.presentation",
}
_CGYM_MAN_MAX_BYTES = 40 * 1024 * 1024
_CGYM_MAN_LINK_HOURS = 12


class CgymManualsConfigIn(BaseModel):
    folder_id: str
    folder_name: Optional[str] = None


def _cgym_man_norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def _cgym_man_type_of(folder_name: str) -> Optional[str]:
    n = _cgym_man_norm(folder_name)
    if "obiezion" in n or "obbiezion" in n:
        return "obiezioni"
    if "winwin" in n:
        return "winwin"
    return None


def _cgym_man_out_file(f: dict) -> dict:
    return {
        "id": f.get("id"),
        "name": f.get("name"),
        "mime": f.get("mimeType"),
        "size": int(f["size"]) if str(f.get("size") or "").isdigit() else None,
        "modified_time": f.get("modifiedTime"),
        "web_view_link": f.get("webViewLink"),
        "exportable": f.get("mimeType") in _CGYM_MAN_EXPORTABLE,
    }


async def _cgym_man_service(tid: str):
    """Servizio Drive autenticato con le credenziali del MASTER del tenant."""
    if not _gd_configured():
        raise HTTPException(status_code=503, detail="Google Drive non configurato lato server")
    from googleapiclient.discovery import build  # type: ignore
    try:
        creds = await _gd_get_credentials(tid)
    except HTTPException as e:
        if e.status_code == 409:
            raise HTTPException(status_code=409, detail="Il Google Drive del Master non è collegato: il titolare deve collegarlo da Impostazioni → Google Drive") from e
        raise
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _cgym_man_list_sync(service, parent_id: str, folders_only: bool, q: Optional[str] = None) -> List[dict]:
    clauses = ["trashed = false", f"'{parent_id}' in parents"]
    if folders_only:
        clauses.append("mimeType = 'application/vnd.google-apps.folder'")
    else:
        clauses.append("mimeType != 'application/vnd.google-apps.folder'")
    if q:
        clauses.append("name contains '" + q.replace("'", "\\'") + "'")
    out: List[dict] = []
    token = None
    while True:
        r = service.files().list(
            q=" and ".join(clauses),
            spaces="drive",
            fields="nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents)",
            pageSize=200,
            orderBy="name",
            pageToken=token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        out.extend(r.get("files") or [])
        token = r.get("nextPageToken")
        if not token or len(out) >= 600:
            break
    return out


def _cgym_man_get_sync(service, file_id: str, fields: str = "id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed") -> dict:
    return service.files().get(fileId=file_id, fields=fields, supportsAllDrives=True).execute()


async def _cgym_man_resolve_subfolders(service, root_id: str) -> Dict[str, dict]:
    """Cerca nella cartella principale le sottocartelle Obiezioni / WIN-WIN (per nome)."""
    try:
        children = await asyncio.to_thread(_cgym_man_list_sync, service, root_id, True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Errore Drive nella lettura della cartella: {e}")
    found: Dict[str, dict] = {}
    for c in children:
        t = _cgym_man_type_of(c.get("name") or "")
        if t and t not in found:
            found[t] = {"id": c["id"], "name": c.get("name")}
    return found


def _cgym_man_public_out(cfg: Optional[dict], user: dict, master_connected: bool) -> dict:
    return {
        "configured": bool(cfg),
        "root_folder_id": (cfg or {}).get("root_folder_id"),
        "root_folder_name": (cfg or {}).get("root_folder_name"),
        "subfolders": (cfg or {}).get("subfolders") or {},
        "updated_at": (cfg or {}).get("updated_at").isoformat() if isinstance((cfg or {}).get("updated_at"), datetime) else (cfg or {}).get("updated_at"),
        "can_edit": is_owner(user),
        "master_drive_connected": master_connected,
        "drive_configured": _gd_configured(),
        "types": [{"type": t, "label": _CGYM_MAN_LABELS[t], "subfolder": ((cfg or {}).get("subfolders") or {}).get(t)} for t in _CGYM_MAN_TYPES],
    }


@api_router.get("/cgym/manuals/config")
async def cgym_manuals_config_get(user=Depends(get_current_user)):
    """Configurazione manuali del tenant (lettura per tutti i membri; `can_edit` solo per il Master)."""
    tid = tenant_id(user)
    cfg = await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 0})
    master_connected = bool(await db.google_drive_connections.find_one({"user_id": tid}, {"_id": 1}))
    return _cgym_man_public_out(cfg, user, master_connected)


@api_router.put("/cgym/manuals/config")
async def cgym_manuals_config_put(body: CgymManualsConfigIn, user=Depends(get_current_user)):
    """Solo il Master: imposta la cartella Drive principale Corporate Gym e rileva le sottocartelle."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può modificare la cartella dei manuali")
    tid = tenant_id(user)
    folder_id = (body.folder_id or "").strip()
    if not folder_id:
        raise HTTPException(status_code=400, detail="Cartella non valida")
    service = await _cgym_man_service(tid)
    try:
        meta = await asyncio.to_thread(_cgym_man_get_sync, service, folder_id, "id,name,mimeType,trashed")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Cartella Drive non trovata o non accessibile: {e}")
    if meta.get("mimeType") != "application/vnd.google-apps.folder" or meta.get("trashed"):
        raise HTTPException(status_code=400, detail="L'elemento scelto non è una cartella Drive valida")
    subfolders = await _cgym_man_resolve_subfolders(service, folder_id)
    doc = {
        "tenant_id": tid,
        "root_folder_id": folder_id,
        "root_folder_name": body.folder_name or meta.get("name"),
        "subfolders": subfolders,
        "configured_by": user["user_id"],
        "updated_at": utcnow(),
    }
    await db.cgym_manuals_config.update_one({"tenant_id": tid}, {"$set": doc}, upsert=True)
    out = _cgym_man_public_out(doc, user, True)
    out["missing_subfolders"] = [t for t in _CGYM_MAN_TYPES if t not in subfolders]
    return out


@api_router.delete("/cgym/manuals/config")
async def cgym_manuals_config_delete(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può rimuovere la cartella dei manuali")
    r = await db.cgym_manuals_config.delete_one({"tenant_id": tenant_id(user)})
    return {"ok": True, "deleted": r.deleted_count}


async def _cgym_man_subfolder(tid: str, mtype: str, service) -> Tuple[dict, Optional[dict]]:
    """Ritorna (config, sottocartella) — ri-risolve le sottocartelle mancanti e le persiste."""
    cfg = await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 0})
    if not cfg:
        raise HTTPException(status_code=404, detail="Cartella manuali non configurata: il Master deve impostarla in Corporate Gym → Manuali")
    sub = (cfg.get("subfolders") or {}).get(mtype)
    if not sub:
        found = await _cgym_man_resolve_subfolders(service, cfg["root_folder_id"])
        if found:
            merged = {**(cfg.get("subfolders") or {}), **found}
            await db.cgym_manuals_config.update_one({"tenant_id": tid}, {"$set": {"subfolders": merged}})
            cfg["subfolders"] = merged
            sub = merged.get(mtype)
    return cfg, sub


@api_router.get("/cgym/manuals/{mtype}")
async def cgym_manuals_list(mtype: str, q: Optional[str] = None, user=Depends(get_current_user)):
    """Elenca i manuali (PDF e documenti Google esportabili in PDF) della sottocartella del tipo, letti LIVE da Drive."""
    if mtype not in _CGYM_MAN_TYPES:
        raise HTTPException(status_code=404, detail="Tipo non valido")
    tid = tenant_id(user)
    service = await _cgym_man_service(tid)
    cfg, sub = await _cgym_man_subfolder(tid, mtype, service)
    if not sub:
        return {"type": mtype, "label": _CGYM_MAN_LABELS[mtype], "items": [], "missing_subfolder": True,
                "root_folder_name": cfg.get("root_folder_name"), "subfolder": None}
    try:
        files = await asyncio.to_thread(_cgym_man_list_sync, service, sub["id"], False, (q or "").strip() or None)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Errore Drive: {e}")
    items = []
    for f in files:
        mime = f.get("mimeType") or ""
        name = (f.get("name") or "").lower()
        if mime == "application/pdf" or name.endswith(".pdf") or mime in _CGYM_MAN_EXPORTABLE:
            items.append(_cgym_man_out_file(f))
    items.sort(key=lambda x: (x.get("name") or "").lower())
    return {"type": mtype, "label": _CGYM_MAN_LABELS[mtype], "items": items, "missing_subfolder": False,
            "root_folder_name": cfg.get("root_folder_name"), "subfolder": sub, "fetched_at": utcnow().isoformat()}


def _cgym_man_base_url(request: Request) -> str:
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_proto and fwd_host:
        return f"{fwd_proto}://{fwd_host}".rstrip("/")
    return str(request.base_url).rstrip("/")


@api_router.post("/cgym/manuals/{mtype}/files/{file_id}/link")
async def cgym_manuals_link(mtype: str, file_id: str, request: Request, user=Depends(get_current_user)):
    """Crea un link firmato (12h) per aprire/scaricare il manuale: il contenuto viene letto da Drive ad ogni richiesta."""
    if mtype not in _CGYM_MAN_TYPES:
        raise HTTPException(status_code=404, detail="Tipo non valido")
    tid = tenant_id(user)
    service = await _cgym_man_service(tid)
    cfg, sub = await _cgym_man_subfolder(tid, mtype, service)
    try:
        meta = await asyncio.to_thread(_cgym_man_get_sync, service, file_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Manuale non trovato su Drive: {e}")
    allowed = {cfg.get("root_folder_id")} | ({sub["id"]} if sub else set())
    if meta.get("trashed") or not (set(meta.get("parents") or []) & allowed):
        raise HTTPException(status_code=403, detail="Il file non appartiene alla cartella manuali del Corporate Gym")
    exp_dt = utcnow() + timedelta(hours=_CGYM_MAN_LINK_HOURS)
    token = jwt.encode({"kind": "cgym_manual", "tenant_id": tid, "file_id": file_id, "user_id": user["user_id"],
                        "exp": int(exp_dt.timestamp())}, JWT_SECRET, algorithm=JWT_ALG)
    out = _cgym_man_out_file(meta)
    if out["exportable"]:
        out["name"] = f"{meta.get('name', 'manuale')}.pdf"
        out["mime"] = "application/pdf"
    base = _cgym_man_base_url(request)
    return {**out, "url": f"{base}/api/public/cgym-manual/{token}", "download_url": f"{base}/api/public/cgym-manual/{token}?download=1",
            "expires_at": exp_dt.isoformat()}


def _cgym_man_download_sync(service, meta: dict) -> Tuple[bytes, str, str]:
    from googleapiclient.http import MediaIoBaseDownload  # type: ignore
    from io import BytesIO
    mime = meta.get("mimeType") or ""
    if mime in _CGYM_MAN_EXPORTABLE:
        req = service.files().export_media(fileId=meta["id"], mimeType="application/pdf")
        name, out_mime = f"{meta.get('name', 'manuale')}.pdf", "application/pdf"
    else:
        req = service.files().get_media(fileId=meta["id"], supportsAllDrives=True)
        name, out_mime = meta.get("name") or "manuale.pdf", mime or "application/pdf"
    buf = BytesIO()
    dl = MediaIoBaseDownload(buf, req, chunksize=2 * 1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
        if buf.tell() > _CGYM_MAN_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Manuale troppo grande (>40MB)")
    return buf.getvalue(), name, out_mime


@api_router.get("/public/cgym-manual/{token}")
async def cgym_manuals_public(token: str, download: Optional[str] = None):
    """Serve il manuale (senza auth, token firmato) leggendolo LIVE da Drive con le credenziali del Master."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link scaduto: riapri il manuale dall'app")
    except Exception:
        raise HTTPException(status_code=400, detail="Link non valido")
    if payload.get("kind") != "cgym_manual":
        raise HTTPException(status_code=400, detail="Token non compatibile")
    tid, file_id = payload.get("tenant_id"), payload.get("file_id")
    service = await _cgym_man_service(tid)
    try:
        meta = await asyncio.to_thread(_cgym_man_get_sync, service, file_id, "id,name,mimeType,size,trashed")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Manuale non trovato su Drive: {e}")
    if meta.get("trashed"):
        raise HTTPException(status_code=404, detail="Il manuale è stato eliminato da Drive")
    data, name, mime = await asyncio.to_thread(_cgym_man_download_sync, service, meta)
    disp = "attachment" if (download or "").lower() in ("1", "true", "yes") else "inline"
    safe_name = re.sub(r'[\r\n"]', "_", name)
    from urllib.parse import quote as _cgym_quote
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f"{disp}; filename=\"{safe_name.encode('ascii', 'ignore').decode() or 'manuale.pdf'}\"; filename*=UTF-8''{_cgym_quote(safe_name)}",
            "Cache-Control": "no-store",
        },
    )
