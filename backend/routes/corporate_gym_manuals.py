# corporate_gym_manuals.py — Corporate Gym · Manuali su Google Drive (AxonOS gestore manuali)
# Modulo ISOLATO (nessuna modifica ai moduli esistenti). Usa gli helper condivisi del namespace:
#   api_router, db, get_current_user, tenant_id, is_owner, utcnow, jwt/JWT_SECRET/JWT_ALG, Request,
#   _gd_configured, _gd_get_credentials (28_google_drive.py).
#
# Funzionamento:
#   • V50.z203 — Il Master Coach SCEGLIE MANUALMENTE (browser Drive con cartelle E file) la cartella o il file da collegare a ogni
#     sezione del Gym (e a ogni fase, vedi corporate_gym_config). NESSUNA ricerca per nomi predefiniti ("Obiezioni"/"WIN-WIN").
#     AxonOS legge esclusivamente ciò che è collegato. Senza collegamento → avviso soft «Nessun manuale collegato» (mai bloccante).
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
    "application/vnd.google-apps.spreadsheet",
}
_CGYM_MAN_FOLDER = "application/vnd.google-apps.folder"
_CGYM_MAN_SHORTCUT = "application/vnd.google-apps.shortcut"
_CGYM_MAN_MAX_BYTES = 40 * 1024 * 1024
_CGYM_MAN_LINK_HOURS = 12
_CGYM_MAN_SOFT = "Nessun manuale collegato"


class CgymManualsLinkIn(BaseModel):
    """V50.z203 — collegamento MANUALE scelto dal Master Coach: cartella O file Drive per una sezione del Gym."""
    type: str                      # obiezioni | winwin
    kind: str = "folder"           # folder | file
    id: str
    name: Optional[str] = None


def _cgym_man_out_file(f: dict) -> dict:
    mime = f.get("mimeType") or ""
    return {
        "id": f.get("id"),
        "name": f.get("name"),
        "mime": mime,
        "is_folder": mime == _CGYM_MAN_FOLDER,
        "size": int(f["size"]) if str(f.get("size") or "").isdigit() else None,
        "modified_time": f.get("modifiedTime"),
        "web_view_link": f.get("webViewLink"),
        "exportable": mime in _CGYM_MAN_EXPORTABLE,
        "readable": mime == "application/pdf" or mime in _CGYM_MAN_EXPORTABLE or mime.startswith("image/") or mime.startswith("text/")
                    or mime in ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword",
                                "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
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


def _cgym_man_list_sync(service, parent_id: str, folders_only: bool = False, q: Optional[str] = None, files_only: bool = False) -> List[dict]:
    """TUTTI gli elementi figli (cartelle E file) di `parent_id`; shortcut risolti al target."""
    clauses = ["trashed = false", f"'{parent_id}' in parents"]
    if folders_only:
        clauses.append(f"mimeType = '{_CGYM_MAN_FOLDER}'")
    if files_only:
        clauses.append(f"mimeType != '{_CGYM_MAN_FOLDER}'")
    if q:
        clauses.append("name contains '" + q.replace("'", "\\'") + "'")
    out: List[dict] = []
    token = None
    while True:
        r = service.files().list(
            q=" and ".join(clauses), spaces="drive",
            fields="nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,shortcutDetails)",
            pageSize=200, orderBy="folder,name", pageToken=token, supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute()
        for f in r.get("files") or []:
            if f.get("mimeType") == _CGYM_MAN_SHORTCUT:
                sd = f.get("shortcutDetails") or {}
                if sd.get("targetId"):
                    try:
                        tgt = _cgym_man_get_sync(service, sd["targetId"])
                        tgt["name"] = f.get("name") or tgt.get("name"); tgt["_shortcut"] = True
                        f = tgt
                    except Exception:  # noqa: BLE001
                        continue
                else:
                    continue
            out.append(f)
        token = r.get("nextPageToken")
        if not token or len(out) >= 600:
            break
    return out


def _cgym_man_get_sync(service, file_id: str, fields: str = "id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed") -> dict:
    return service.files().get(fileId=file_id, fields=fields, supportsAllDrives=True).execute()


def _cgym_man_links(cfg: Optional[dict]) -> Dict[str, dict]:
    """Collegamenti per sezione. Migrazione soft dalla vecchia config (subfolders trovate per nome → link cartella)."""
    if not cfg:
        return {}
    links = dict(cfg.get("links") or {})
    for t, sub in (cfg.get("subfolders") or {}).items():
        if t not in links and sub and sub.get("id"):
            links[t] = {"kind": "folder", "id": sub["id"], "name": sub.get("name")}
    return links


def _cgym_man_public_out(cfg: Optional[dict], user: dict, master_connected: bool) -> dict:
    links = _cgym_man_links(cfg)
    return {
        "configured": bool(links),
        "root_folder_id": (cfg or {}).get("root_folder_id"),
        "root_folder_name": (cfg or {}).get("root_folder_name"),
        "links": links,
        "updated_at": (cfg or {}).get("updated_at").isoformat() if isinstance((cfg or {}).get("updated_at"), datetime) else (cfg or {}).get("updated_at"),
        "can_edit": is_owner(user),
        "master_drive_connected": master_connected,
        "drive_configured": _gd_configured(),
        "types": [{"type": t, "label": _CGYM_MAN_LABELS[t], "link": links.get(t), "soft_message": None if links.get(t) else _CGYM_MAN_SOFT} for t in _CGYM_MAN_TYPES],
    }


@api_router.get("/cgym/manuals/config")
async def cgym_manuals_config_get(user=Depends(get_current_user)):
    """Configurazione manuali del tenant (lettura per tutti i membri; `can_edit` solo per il Master). Mai errori bloccanti."""
    tid = tenant_id(user)
    cfg = await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 0})
    master_connected = bool(await db.google_drive_connections.find_one({"user_id": tid}, {"_id": 1}))
    return _cgym_man_public_out(cfg, user, master_connected)


@api_router.get("/cgym/manuals/browse")
async def cgym_manuals_browse(parent: str = "root", q: Optional[str] = None, user=Depends(get_current_user)):
    """Browser Drive del Master (per il pannello Master Coach): cartelle E file del livello, oppure ricerca globale con `q`."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master Coach può sfogliare il Drive dei manuali")
    tid = tenant_id(user)
    service = await _cgym_man_service(tid)
    qq = (q or "").strip()
    try:
        if qq:
            def _search():
                r = service.files().list(q="trashed = false and name contains '" + qq.replace("'", "\\'") + "'", spaces="drive",
                                         fields="files(id,name,mimeType,size,modifiedTime,webViewLink,parents)", pageSize=100, orderBy="folder,name",
                                         supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
                return r.get("files") or []
            items = await asyncio.to_thread(_search)
        else:
            items = await asyncio.to_thread(_cgym_man_list_sync, service, parent)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Errore Drive: {e}")
    out = [_cgym_man_out_file(f) for f in items]
    out.sort(key=lambda x: (not x["is_folder"], (x.get("name") or "").lower()))
    return {"parent": parent, "items": out, "folders": [i for i in out if i["is_folder"]], "files": [i for i in out if not i["is_folder"]], "global_search": bool(qq)}


@api_router.put("/cgym/manuals/config")
async def cgym_manuals_config_put(body: CgymManualsLinkIn, user=Depends(get_current_user)):
    """Solo il Master Coach: collega a una sezione del Gym la cartella O il file Drive scelto manualmente (nessuna ricerca per nome)."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può modificare i manuali collegati")
    if body.type not in _CGYM_MAN_TYPES:
        raise HTTPException(status_code=404, detail="Sezione non valida")
    tid = tenant_id(user)
    fid = (body.id or "").strip()
    if not fid:
        raise HTTPException(status_code=400, detail="Elemento Drive non valido")
    service = await _cgym_man_service(tid)
    try:
        meta = await asyncio.to_thread(_cgym_man_get_sync, service, fid)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Elemento Drive non trovato o non accessibile: {e}")
    if meta.get("trashed"):
        raise HTTPException(status_code=400, detail="L'elemento scelto è nel cestino di Drive")
    kind = "folder" if meta.get("mimeType") == _CGYM_MAN_FOLDER else "file"
    cfg = await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    links = _cgym_man_links(cfg)
    links[body.type] = {"kind": kind, "id": fid, "name": body.name or meta.get("name"), "mime": meta.get("mimeType")}
    doc = {"tenant_id": tid, "links": links, "configured_by": user["user_id"], "updated_at": utcnow()}
    await db.cgym_manuals_config.update_one({"tenant_id": tid}, {"$set": doc, "$unset": {"subfolders": ""}}, upsert=True)
    return _cgym_man_public_out({**cfg, **doc}, user, True)


@api_router.delete("/cgym/manuals/config")
async def cgym_manuals_config_delete(type: Optional[str] = None, user=Depends(get_current_user)):
    """Scollega una sezione (`?type=`) o tutte."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può rimuovere i manuali collegati")
    tid = tenant_id(user)
    if type:
        cfg = await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 0}) or {}
        links = _cgym_man_links(cfg); links.pop(type, None)
        await db.cgym_manuals_config.update_one({"tenant_id": tid}, {"$set": {"links": links, "updated_at": utcnow()}, "$unset": {"subfolders": ""}}, upsert=True)
        return {"ok": True, "links": links}
    r = await db.cgym_manuals_config.delete_one({"tenant_id": tid})
    return {"ok": True, "deleted": r.deleted_count}


async def _cgym_man_allowed_ids(tid: str) -> Tuple[set, set]:
    """(cartelle collegate, file collegati) di sezioni E fasi (corporate_gym_config) — perimetro di apertura dei file."""
    cfg = await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 0})
    folders, files = set(), set()
    if cfg and cfg.get("root_folder_id"):
        folders.add(cfg["root_folder_id"])
    for l in _cgym_man_links(cfg).values():
        (folders if l.get("kind") == "folder" else files).add(l["id"])
    async for sc in db.cgym_scenario_configs.find({"tenant_id": tid}, {"_id": 0, "overrides.manual_ref": 1, "phases": 1}):
        refs = [((sc.get("overrides") or {}).get("manual_ref"))] + [p.get("manual_ref") for p in (sc.get("phases") or [])]
        for r in refs:
            if r and r.get("id"):
                (folders if r.get("kind") == "folder" else files).add(r["id"])
    return folders, files


@api_router.get("/cgym/manuals/ref")
async def cgym_manuals_ref(kind: str, id: str, q: Optional[str] = None, user=Depends(get_current_user)):
    """Manuali di un riferimento qualsiasi scelto dal Master (sezione o fase): cartella → tutti i file; file → l'elemento singolo."""
    tid = tenant_id(user)
    folders, files = await _cgym_man_allowed_ids(tid)
    if id not in folders and id not in files:
        return {"items": [], "linked": False, "soft_message": _CGYM_MAN_SOFT}
    service = await _cgym_man_service(tid)
    try:
        if kind == "file":
            items = [_cgym_man_out_file(await asyncio.to_thread(_cgym_man_get_sync, service, id))]
        else:
            items = [_cgym_man_out_file(f) for f in await asyncio.to_thread(_cgym_man_list_sync, service, id, False, (q or "").strip() or None, True)]
    except Exception as e:  # noqa: BLE001
        return {"items": [], "linked": True, "soft_message": f"Manuale momentaneamente non leggibile da Drive ({str(e)[:80]})"}
    items.sort(key=lambda x: (x.get("name") or "").lower())
    return {"items": items, "linked": True, "soft_message": None, "fetched_at": utcnow().isoformat()}


@api_router.get("/cgym/manuals/{mtype}")
async def cgym_manuals_list(mtype: str, q: Optional[str] = None, user=Depends(get_current_user)):
    """Manuali della sezione: SOLO ciò che il Master Coach ha collegato (cartella → tutti i file, root inclusa; file → singolo).
    Mai errori bloccanti: senza collegamento → items=[] + soft_message «Nessun manuale collegato»."""
    if mtype not in _CGYM_MAN_TYPES:
        raise HTTPException(status_code=404, detail="Sezione non valida")
    tid = tenant_id(user)
    cfg = await db.cgym_manuals_config.find_one({"tenant_id": tid}, {"_id": 0})
    link = _cgym_man_links(cfg).get(mtype)
    base = {"type": mtype, "label": _CGYM_MAN_LABELS[mtype], "link": link, "missing_subfolder": not link, "linked": bool(link),
            "root_folder_name": (cfg or {}).get("root_folder_name")}
    if not link:
        return {**base, "items": [], "soft_message": _CGYM_MAN_SOFT}
    try:
        service = await _cgym_man_service(tid)
        if link.get("kind") == "file":
            meta = await asyncio.to_thread(_cgym_man_get_sync, service, link["id"])
            items = [] if meta.get("trashed") else [_cgym_man_out_file(meta)]
        else:
            items = [_cgym_man_out_file(f) for f in await asyncio.to_thread(_cgym_man_list_sync, service, link["id"], False, (q or "").strip() or None, True)]
    except HTTPException as e:
        return {**base, "items": [], "soft_message": e.detail if isinstance(e.detail, str) else _CGYM_MAN_SOFT}
    except Exception as e:  # noqa: BLE001
        return {**base, "items": [], "soft_message": f"Manuali momentaneamente non leggibili da Drive ({str(e)[:80]})"}
    items.sort(key=lambda x: (x.get("name") or "").lower())
    return {**base, "items": items, "soft_message": None if items else "Nessun file nella cartella collegata", "fetched_at": utcnow().isoformat()}


def _cgym_man_base_url(request: Request) -> str:
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_proto and fwd_host:
        return f"{fwd_proto}://{fwd_host}".rstrip("/")
    return str(request.base_url).rstrip("/")


@api_router.post("/cgym/manuals/{mtype}/files/{file_id}/link")
async def cgym_manuals_link(mtype: str, file_id: str, request: Request, user=Depends(get_current_user)):
    """Link firmato (12h) per aprire/scaricare un manuale collegato (sezione o fase). `mtype` = sezione oppure `any`."""
    if mtype not in _CGYM_MAN_TYPES and mtype != "any":
        raise HTTPException(status_code=404, detail="Sezione non valida")
    tid = tenant_id(user)
    service = await _cgym_man_service(tid)
    try:
        meta = await asyncio.to_thread(_cgym_man_get_sync, service, file_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Manuale non trovato su Drive: {e}")
    folders, files = await _cgym_man_allowed_ids(tid)
    if meta.get("trashed") or not (file_id in files or (set(meta.get("parents") or []) & folders)):
        raise HTTPException(status_code=403, detail="Il file non appartiene ai manuali collegati dal Master Coach")
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
