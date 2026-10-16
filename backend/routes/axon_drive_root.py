# axon_drive_root.py — V50.z201 — Google Drive: file nella ROOT delle cartelle monitorate sempre visibili ad Axon + shortcut + OCR (modulo ISOLATO)
#
# Caricato DOPO axon_system_awareness.py e PRIMA di 37. Ridefinisce nel namespace condiviso tre funzioni usate dal reindex Drive
# (`_drive_walk_and_collect`, `_drive_download_text`) e avvolge `_reindex_drive_files_for_user`. V50.z565: non avvolge più
# `_fetch_teach_drive_pdfs_for_query` ([ROOT FILES] integrato in 20_axon_memory.py con lettura dei soli file selezionati).
# STATO PRIMA: la BFS indicizzava anche i file nella root (depth 0), MA: (a) gli shortcut Drive («Link … .pdf», mimeType
# application/vnd.google-apps.shortcut) erano esclusi dal filtro → mai indicizzati; (b) i PDF scansionati (senza layer testo) finivano
# nell'indice con testo vuoto → Axon vedeva il nome ma non il contenuto; (c) nel prompt l'elenco era «i 40 più recenti» senza distinzione
# root/sottocartella → i PDF root più vecchi sparivano e Axon concludeva «i PDF nella root non vengono parsati».
# STATO DOPO: (1) walk: root SEMPRE per prima, shortcut risolti al target (nome originale + «→ shortcut»), flag `_is_root`;
# (2) download con retry/backoff (3 tentativi) e OCR di fallback (PyMuPDF render → Gemini vision, max 3 pagine) per PDF senza testo;
# log «Parsed [ROOT] nome — N pagine, K KB»; (3) post-reindex: `is_root`, `pages`, `ocr` sui `drive_snapshots`; (4) prompt: sezione
# «📁 [ROOT FILES]» per ogni cartella monitorata (TUTTI i file root, mai tagliati) + prefisso [ROOT] nell'elenco + bonus pertinenza.
# Nessun toggle: attivo per tutti i tenant con Drive collegato, stessa cadenza (job drive-reindex ogni 30 min + reindex manuale).

import asyncio as _adr_asyncio
import time as _adr_time

_ADR_MIME_FOLDER = "application/vnd.google-apps.folder"
_ADR_MIME_SHORTCUT = "application/vnd.google-apps.shortcut"
_ADR_WANT_MIMES = ("application/pdf", "application/json", "application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet")
_ADR_OCR_MODEL = ("gemini", "gemini-3-flash-preview")
_ADR_OCR_PAGES = 3


def _adr_wanted(mt: str) -> bool:
    return mt in _ADR_WANT_MIMES or mt.startswith("text/")


def _drive_walk_and_collect(creds, root_folders: List[Dict[str, str]], single_files: List[str],  # noqa: F811
                            max_folders: int = 80, max_depth: int = 6, max_files: int = 300) -> Tuple[List[Dict[str, Any]], int]:
    """SYNC (thread): BFS sulle cartelle radice — root per prima, shortcut risolti, `_is_root` su ogni file."""
    from googleapiclient.discovery import build  # type: ignore
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    files: List[Dict[str, Any]] = []
    visited: set = set()
    queue: List[Tuple[str, int, str, str]] = []
    for rf in root_folders:
        if rf["id"] not in visited:
            visited.add(rf["id"]); queue.append((rf["id"], 0, rf.get("name") or "", rf["id"]))
    scanned = 0
    while queue and scanned < max_folders and len(files) < max_files:
        fid, depth, path, root_id = queue.pop(0)
        scanned += 1
        page_token = None
        for _ in range(3):
            try:
                res = service.files().list(
                    q=f"'{fid}' in parents and trashed = false",
                    pageSize=500, orderBy="folder,modifiedTime desc",
                    fields="nextPageToken, files(id,name,mimeType,size,modifiedTime,parents,shortcutDetails)",
                    pageToken=page_token, supportsAllDrives=True, includeItemsFromAllDrives=True,
                ).execute()
            except Exception as e:  # noqa: BLE001
                logger.warning("[drive-reindex] list %s failed: %s", fid, e)
                break
            for ch in res.get("files", []) or []:
                mt = ch.get("mimeType") or ""
                if mt == _ADR_MIME_FOLDER:
                    if ch["id"] not in visited and depth < max_depth:
                        visited.add(ch["id"]); queue.append((ch["id"], depth + 1, f"{path}/{ch.get('name') or ''}" if path else (ch.get("name") or ""), root_id))
                    continue
                if mt == _ADR_MIME_SHORTCUT:
                    sd = ch.get("shortcutDetails") or {}
                    tmt = sd.get("targetMimeType") or ""
                    tid = sd.get("targetId")
                    if tid and tmt == _ADR_MIME_FOLDER:
                        if tid not in visited and depth < max_depth:
                            visited.add(tid); queue.append((tid, depth + 1, f"{path}/{ch.get('name') or ''}" if path else (ch.get("name") or ""), root_id))
                        continue
                    if not tid or not _adr_wanted(tmt):
                        continue
                    try:
                        tgt = service.files().get(fileId=tid, fields="id,name,mimeType,size,modifiedTime,parents", supportsAllDrives=True).execute()
                    except Exception as e:  # noqa: BLE001
                        logger.warning("[drive-reindex] shortcut %s → %s failed: %s", ch.get("name"), tid, e)
                        continue
                    tgt["name"] = ch.get("name") or tgt.get("name")          # nome dello shortcut come lo vede l'utente
                    tgt["_shortcut"] = True; tgt["_shortcut_id"] = ch["id"]
                    ch = tgt
                elif not _adr_wanted(mt):
                    continue
                ch["_folder_path"] = path; ch["_root_id"] = root_id; ch["_is_root"] = depth == 0
                files.append(ch)
                if len(files) >= max_files:
                    break
            page_token = res.get("nextPageToken")
            if not page_token or len(files) >= max_files:
                break
    for sfid in single_files[:20]:
        try:
            meta = service.files().get(fileId=sfid, fields="id,name,mimeType,size,modifiedTime,parents", supportsAllDrives=True).execute()
            meta["_folder_path"] = ""; meta["_root_id"] = sfid; meta["_is_root"] = False
            files.append(meta)
        except Exception as e:  # noqa: BLE001
            logger.warning("[drive-reindex] meta %s failed: %s", sfid, e)
    return files, scanned


def _adr_ocr_pdf_sync(data: bytes, name: str) -> str:
    """OCR di fallback per PDF senza layer testo: PyMuPDF → PNG (max 3 pagine) → Gemini vision. Eseguito nel thread del download."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return ""
    try:
        # V50.z210 — rasterizzazione nel sottoprocesso worker (PyMuPDF mai nel processo API)
        images: List[str] = [base64.b64encode(b).decode() for b in (heavy_call_sync("pdf_render_pages", data=data, max_pages=_ADR_OCR_PAGES, dpi=110, fmt="png").get("images") or [])]
        if not images:
            return ""
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore

        async def _run() -> str:
            chat = LlmChat(api_key=key, session_id=f"adr-{uuid.uuid4().hex[:8]}",
                           system_message="Sei un OCR. Trascrivi fedelmente TUTTO il testo leggibile nelle pagine (italiano), mantenendo l'ordine e le tabelle come righe. Nessun commento.").with_model(*_ADR_OCR_MODEL)
            resp = await chat.send_message(UserMessage(text=f"Trascrivi il testo di queste {len(images)} pagine del documento «{name}».", file_contents=[ImageContent(image_base64=b) for b in images]))
            return (resp or "").strip()
        return _adr_asyncio.run(_run())
    except Exception as e:  # noqa: BLE001
        logger.warning("[drive-reindex] OCR %s failed: %s", name, e)
        return ""


def _drive_download_text(creds, f: Dict[str, Any]) -> str:  # noqa: F811
    """SYNC (thread): scarica/esporta un file (3 tentativi con backoff), estrae il testo; PDF senza testo → OCR Gemini. Log per i file root."""
    from googleapiclient.discovery import build  # type: ignore
    from googleapiclient.http import MediaIoBaseDownload  # type: ignore
    from io import BytesIO
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    mt = f.get("mimeType") or ""
    fid = f["id"]
    data = b""
    last_exc: Optional[Exception] = None
    for attempt in range(3):
        try:
            if mt == "application/vnd.google-apps.document":
                req = service.files().export_media(fileId=fid, mimeType="text/plain"); eff = "text/plain"
            elif mt == "application/vnd.google-apps.spreadsheet":
                req = service.files().export_media(fileId=fid, mimeType="text/csv"); eff = "text/csv"
            else:
                req = service.files().get_media(fileId=fid, supportsAllDrives=True); eff = mt
            buf = BytesIO()
            dl = MediaIoBaseDownload(buf, req, chunksize=1024 * 1024)
            done = False
            while not done:
                _, done = dl.next_chunk()
            data = buf.getvalue()[: 12 * 1024 * 1024]
            mt = eff
            break
        except Exception as e:  # noqa: BLE001
            last_exc = e
            _adr_time.sleep(1.5 * (attempt + 1))
    if not data:
        raise RuntimeError(f"download fallito dopo 3 tentativi: {last_exc}")
    text = ""; pages = 0; ocr = False
    if mt == "application/pdf" or data[:5] == b"%PDF-":
        try:
            pages = int(heavy_call_sync("pdf_page_count", data=data).get("page_count") or 0)   # V50.z210 — worker
        except Exception:  # noqa: BLE001
            pages = 0
        try:
            text = _extract_pdf_text_bytes(data) or ""
        except Exception:  # noqa: BLE001
            text = ""
        if len(text.strip()) < 40:
            text = _adr_ocr_pdf_sync(data, f.get("name") or fid) or text; ocr = bool(text.strip())
    else:
        try:
            text = data.decode("utf-8", errors="ignore")
        except Exception:  # noqa: BLE001
            text = ""
    f["_pages"] = pages; f["_ocr"] = ocr; f["_bytes"] = len(data)
    if f.get("_is_root"):
        logger.info("[drive-reindex] Parsed [ROOT] %s — %s pagine, %s KB%s%s", f.get("name"), pages or "?", round(len(data) / 1024), " (OCR)" if ocr else "", " (shortcut)" if f.get("_shortcut") else "")
    return re.sub(r"\s{3,}", " ", text or "").strip()[:100000]


# ---------------------------------------------------------------------------- post-reindex: flag is_root / pages / ocr sui snapshot
_adr_prev_reindex = _reindex_drive_files_for_user


async def _reindex_drive_files_for_user(user_id: str, max_files: int = 300) -> Dict[str, int]:  # noqa: F811
    stats = await _adr_prev_reindex(user_id, max_files)
    try:
        roots, _sf = await _drive_index_roots(user_id)
        root_names = {r.get("name") or "" for r in roots}
        await db.drive_snapshots.update_many({"user_id": user_id, "folder_path": {"$in": list(root_names)}}, {"$set": {"is_root": True}})
        await db.drive_snapshots.update_many({"user_id": user_id, "folder_path": {"$nin": list(root_names)}}, {"$set": {"is_root": False}})
        n_root = await db.drive_snapshots.count_documents({"user_id": user_id, "is_root": True})
        n_empty = await db.drive_snapshots.count_documents({"user_id": user_id, "$or": [{"text": ""}, {"text": None}]})
        await db.drive_index_meta.update_one({"user_id": user_id}, {"$set": {"root_files": n_root, "empty_text_files": n_empty}})
        if stats.get("updated"):
            axs_event("scheduler", "info", f"Drive reindex: {stats.get('updated')} file aggiornati, {n_root} nella root, {n_empty} senza testo", None, user_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("[drive-reindex] root flag failed: %s", e)
    return stats


# V50.z565 — la sezione [ROOT FILES] del prompt è ora dentro `_fetch_teach_drive_pdfs_for_query` (20_axon_memory.py, snapshot leggeri):
# il wrapper duplicato che rileggeva TUTTI i testi root da Mongo a ogni domanda è stato rimosso.


@api_router.get("/google-drive/root-files")
async def google_drive_root_files(user=Depends(get_current_user)):
    """File indicizzati nella root delle cartelle monitorate (verifica rapida «Axon vede i miei PDF root?»)."""
    tenant = tenant_id(user)
    roots, _sf = await _drive_index_roots(tenant)
    names = [r.get("name") or "" for r in roots]
    rows = await db.drive_snapshots.find({"user_id": tenant, "folder_path": {"$in": names}}, {"_id": 0, "text": 0}).sort("name", 1).to_list(200)
    for r in rows:
        if isinstance(r.get("indexed_at"), datetime):
            r["indexed_at"] = r["indexed_at"].isoformat()
    meta = await db.drive_index_meta.find_one({"user_id": tenant}, {"_id": 0, "root_files": 1, "empty_text_files": 1, "last_run_at": 1, "status": 1}) or {}
    if isinstance(meta.get("last_run_at"), datetime):
        meta["last_run_at"] = meta["last_run_at"].isoformat()
    return {"roots": roots, "items": rows, "meta": meta}
