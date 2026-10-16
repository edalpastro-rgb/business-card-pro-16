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
_ADR_OCR_TABLES = (os.environ.get("DRIVE_OCR_TABLES") or "0").strip() in ("1", "true", "yes")  # V50.z568 — default OFF (costo CPU/LLM)


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


def _adr_ocr_pdf_sync(data: bytes, name: str, max_pages: int = _ADR_OCR_PAGES) -> str:
    """OCR di fallback per PDF senza layer testo (o con numeri rasterizzati): PyMuPDF → PNG (max_pages, 150 dpi) → Gemini vision
    con tabelle rese come righe markdown. Eseguito nel thread del download."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return ""
    try:
        # V50.z210 — rasterizzazione nel sottoprocesso worker (PyMuPDF mai nel processo API)
        images: List[str] = [base64.b64encode(b).decode() for b in (heavy_call_sync("pdf_render_pages", data=data, max_pages=max_pages, dpi=150, fmt="png").get("images") or [])]
        if not images:
            return ""
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore

        async def _run() -> str:
            chat = LlmChat(api_key=key, session_id=f"adr-{uuid.uuid4().hex[:8]}",
                           system_message="Sei un OCR per documenti commerciali italiani (listini energia, contratti). Trascrivi fedelmente TUTTO il testo leggibile. REGOLA TABELLE: ogni tabella va resa riga per riga in formato markdown «| cella | cella |» con l'intestazione delle colonne, riportando OGNI numero esattamente com'è scritto (virgole decimali, separatori delle migliaia, unità: €/kWh, €/Smc, kWh, spread). Nessun numero va omesso o arrotondato. Nessun commento.").with_model(*_ADR_OCR_MODEL)
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
        # V50.z567 — PARSER TABELLE: testo strutturato (find_tables + ricostruzione righe) SENZA il tetto di 8000 caratteri
        # (prima `_extract_pdf_text_bytes` troncava i listini e `get_text` separava i numeri dalle etichette).
        _digits = 0
        try:
            _st = heavy_call_sync("pdf_structured_text", data=data, max_pages=0, max_chars=200000)
            text = (_st.get("text") or "")
            _digits = int(_st.get("digits") or 0)
            if _st.get("tables"):
                logger.info("[drive-reindex] %s: %d tabelle strutturate, %d cifre", f.get("name"), _st.get("tables"), _digits)
        except Exception as _se:  # noqa: BLE001
            logger.warning("[drive-reindex] structured text failed for %s: %s", f.get("name"), _se)
            try:
                text = _extract_pdf_text_bytes(data) or ""
            except Exception:  # noqa: BLE001
                text = ""
        _low = (text or "").lower(); _nm = (f.get("name") or "").lower()
        _looks_pricelist = any(k in _low or k in _nm for k in ("kwh", "smc", "€/", "listino", "prezzo", "spread", "tariff", "offerta"))
        _numbers_missing = _ADR_OCR_TABLES and pages > 0 and _digits / max(1, min(pages, 12)) < 15 and _looks_pricelist  # V50.z568 — OCR Vision sui listini OPZIONALE (DRIVE_OCR_TABLES=1)
        if len(text.strip()) < 40 or _numbers_missing:
            # OCR Vision (tabelle come righe markdown): PDF scansionato, oppure listino con etichette testuali ma numeri rasterizzati
            _ocr_txt = _adr_ocr_pdf_sync(data, f.get("name") or fid, max_pages=_ADR_OCR_PAGES if len(text.strip()) < 40 else 12)
            if _ocr_txt.strip():
                text = (_ocr_txt if len(text.strip()) < 40 else text + "\n\n[OCR TABELLE — numeri letti dalle immagini delle pagine]\n" + _ocr_txt); ocr = True
                logger.info("[drive-reindex] %s: OCR tabelle eseguito (%s)", f.get("name"), "scansione" if _digits == 0 else f"solo {_digits} cifre nel layer testo")
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
DRIVE_PARSER_VERSION = "z567-tables"  # V50.z567 — bump = ri-parsing COMPLETO di tutti i file (parser tabelle strutturate + OCR numeri)


async def _reindex_drive_files_for_user(user_id: str, max_files: int = 300) -> Dict[str, int]:  # noqa: F811
    stats = await _adr_prev_reindex(user_id, max_files)
    try:
        roots, _sf = await _drive_index_roots(user_id)
        root_names = {r.get("name") or "" for r in roots}
        await db.drive_snapshots.update_many({"user_id": user_id, "folder_path": {"$in": list(root_names)}}, {"$set": {"is_root": True}})
        await db.drive_snapshots.update_many({"user_id": user_id, "folder_path": {"$nin": list(root_names)}}, {"$set": {"is_root": False}})
        n_root = await db.drive_snapshots.count_documents({"user_id": user_id, "is_root": True})
        n_empty = await db.drive_snapshots.count_documents({"user_id": user_id, "$or": [{"text": ""}, {"text": None}]})
        await db.drive_index_meta.update_one({"user_id": user_id}, {"$set": {"root_files": n_root, "empty_text_files": n_empty, "parser_version": DRIVE_PARSER_VERSION}}, upsert=True)
        if stats.get("updated"):
            axs_event("scheduler", "info", f"Drive reindex: {stats.get('updated')} file aggiornati, {n_root} nella root, {n_empty} senza testo", None, user_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("[drive-reindex] root flag failed: %s", e)
    return stats


async def _run_drive_parser_upgrade_nightly() -> None:
    """V50.z568 — JOB NOTTURNO A BASSA PRIORITÀ (03:30 Europe/Rome, registrato in 37): per ogni tenant con Drive collegato il cui
    indice è stato costruito con un parser precedente, invalida i modified_time e ri-indicizza TUTTI i file UN TENANT ALLA VOLTA,
    un file alla volta con pausa (DRIVE_REINDEX_PAUSE_S), embedding a 1 thread, sottoprocessi nice(10), OCR Vision solo se
    DRIVE_OCR_TABLES=1. All'avvio del container NON parte più nessun processo pesante sui file Drive (incidente 11:22 → 502)."""
    try:
        tenants = [c["user_id"] async for c in db.google_drive_connections.find({}, {"_id": 0, "user_id": 1})]
    except Exception as e:  # noqa: BLE001
        logger.warning("[drive-reindex] nightly: %s", e); return
    n = 0
    for uid in tenants:
        meta = await db.drive_index_meta.find_one({"user_id": uid}, {"_id": 0, "parser_version": 1}) or {}
        if meta.get("parser_version") == DRIVE_PARSER_VERSION or uid in _DRIVE_REINDEX_RUNNING:  # noqa: F821
            continue
        r = await db.drive_snapshots.update_many({"user_id": uid}, {"$set": {"modified_time": None}})
        logger.info("[drive-reindex] nightly parser %s → %s: %d snapshot invalidati, reindex completo tenant %s", meta.get("parser_version"), DRIVE_PARSER_VERSION, r.modified_count, uid)
        try:
            stats = await _reindex_drive_files_for_user(uid)  # gestisce da sé _DRIVE_REINDEX_RUNNING; sequenziale, con pausa tra i file
            logger.info("[drive-reindex] nightly tenant %s completato: %s", uid, stats)
        except Exception as e:  # noqa: BLE001
            logger.warning("[drive-reindex] nightly tenant %s: %s", uid, e)
        n += 1
    if n:
        axs_event("scheduler", "info", f"Drive: ri-indicizzazione notturna completata per {n} tenant (parser tabelle {DRIVE_PARSER_VERSION})")  # noqa: F821


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
