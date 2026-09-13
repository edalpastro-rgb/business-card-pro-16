# axon_media.py — V50.z199 — BLOCCO 8 · Fase 3: Archivio intelligente foto / audio / video a due sfere (modulo ISOLATO)
#
# Caricato DOPO axon_expenses.py e PRIMA di 37. Nessuna modifica al core. Riusa: Object Storage (_put_object_sync/_get_object_sync),
# OpenAISpeechToText (Whisper, come /ai/transcribe), LlmChat/ImageContent (Gemini flash vision), Haiku (riassunto/tag),
# _apx_emit (alert proattivo «Non classificato»), _maybe_push_command e _prepare_assistant_prompt (wrapper a catena).
#
# Flusso: `POST /axon/media {kind photo|audio|video, data_base64, mime, name, sphere?}` → file su Object Storage `media/{tenant}/{id}.ext`
#   → riga in `axon_media` {sphere business|home|unclassified, status processing|ready|error} → elaborazione in background:
#   audio/video → Whisper (trascrizione) + Haiku (titolo, riassunto, tag); foto → Gemini vision (descrizione, testo leggibile, tag).
#   Se `sphere` non è indicata Axon risponde «È privata o aziendale?» (ask_sphere=true); senza risposta l'elemento resta in
#   «Non classificato» e dopo 2 ore Axon lo ricorda una sola volta (alert proattivo `media_unclassified`, disattivabile).
# Ricerca `GET /axon/media?sphere&kind&q` cerca in titolo, trascrizione, descrizione, testo OCR e tag — sempre filtrata per sfera.
# Chat: «cerca nelle foto/audio/video …», «cosa ho registrato …»; «privata» / «aziendale» subito dopo una cattura classifica l'ultimo elemento.

import asyncio as _axm_asyncio

_AXM_KINDS = ("photo", "audio", "video")
_AXM_SPHERES = ("business", "home", "unclassified")
_AXM_ICON = {"business": "🔵", "home": "🟢", "unclassified": "⚪"}
_AXM_LABEL = {"business": "Business", "home": "Home (privata)", "unclassified": "Non classificato"}
_AXM_KIND_LABEL = {"photo": "Foto", "audio": "Audio", "video": "Video"}
_AXM_MAX_BYTES = 25 * 1024 * 1024
_AXM_VISION_MODEL = ("gemini", "gemini-3-flash-preview")
_AXM_TEXT_MODEL = ("anthropic", "claude-haiku-4-5-20251001")
_AXM_REMIND_AFTER_H = 2

_OMNI_EXTRA_SECTIONS.append((
    "Archivio intelligente foto/audio/video (Integrazioni · Fase 3)", "/axon-media",
    "Foto, note vocali e video catturati o allegati: Axon trascrive audio e video (Whisper), descrive le foto e legge il testo che contengono, "
    "estrae titolo/riassunto/tag e rende tutto ricercabile. A ogni cattura chiede «Privata o aziendale?» (🔵 Business / 🟢 Home); senza risposta "
    "l'elemento resta in ⚪ Non classificato e Axon lo ricorda dopo 2 ore. Le sfere non si mescolano mai.",
))
_APX_TYPE_LABELS["media_unclassified"] = "Media da classificare"
_APX_DEFAULT_CONFIG["alerts"]["media_unclassified"] = True


class AxmUploadIn(BaseModel):
    kind: str
    data_base64: str
    mime: Optional[str] = None
    name: Optional[str] = None
    sphere: Optional[str] = None          # business | home | None → unclassified (Axon chiede)
    duration_sec: Optional[float] = None
    note: Optional[str] = None
    contact_id: Optional[str] = None


class AxmPatch(BaseModel):
    sphere: Optional[str] = None
    title: Optional[str] = None
    note: Optional[str] = None
    contact_id: Optional[str] = None
    tags: Optional[List[str]] = None


def _axm_sphere(s: Optional[str], allow_unclassified: bool = True) -> str:
    s = (s or "unclassified").lower()
    if s == "private" or s == "privata" or s == "personale":
        s = "home"
    if s == "aziendale":
        s = "business"
    if s not in _AXM_SPHERES or (s == "unclassified" and not allow_unclassified):
        raise HTTPException(status_code=400, detail="Sfera non valida (business | home)")
    return s


def _axm_out(d: dict) -> dict:
    d = dict(d); d.pop("_id", None)
    for k in ("created_at", "updated_at", "classified_at", "reminded_at", "processed_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    d["sphere_icon"] = _AXM_ICON.get(d.get("sphere") or "unclassified", "⚪")
    d["sphere_label"] = _AXM_LABEL.get(d.get("sphere") or "unclassified", "Non classificato")
    return d


def _axm_bare_b64(b64: str) -> str:
    return b64.split(",", 1)[1] if b64.startswith("data:") else b64


def _axm_ext(kind: str, mime: str, name: Optional[str]) -> str:
    n = (name or "").lower()
    if "." in n and len(n.rsplit(".", 1)[1]) <= 4:
        return n.rsplit(".", 1)[1]
    m = mime.lower()
    if kind == "photo":
        return "png" if "png" in m else ("webp" if "webp" in m else "jpg")
    if kind == "video":
        return "webm" if "webm" in m else ("mov" if "quicktime" in m else "mp4")
    if "webm" in m or "ogg" in m:
        return "webm"
    if "wav" in m:
        return "wav"
    if "mp3" in m or "mpeg" in m:
        return "mp3"
    return "m4a"


def _axm_scope(user: dict) -> dict:
    return {"tenant_id": tenant_id(user), "user_id": user["user_id"]}   # archivio personale: MAI condiviso col team


# ============================================================================ ELABORAZIONE IN BACKGROUND
_AXM_HALLUCINATION_RE = re.compile(r"amara\.org|sottotitoli (creati|a cura|e revisione)|qtss|www\.mooji", re.IGNORECASE)


def _axm_clean_transcript(t: str) -> str:
    """Whisper su audio senza parlato «inventa» frasi tipiche (es. «Sottotitoli creati dalla comunità Amara.org»): scartate."""
    t = (t or "").strip()
    return "" if (len(t) < 160 and _AXM_HALLUCINATION_RE.search(t)) else t


async def _axm_transcribe(raw: bytes, ext: str) -> str:
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY mancante")
    import tempfile
    from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText  # type: ignore
    suffix = "." + (ext if ext in ("mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg", "flac", "mov") else "m4a")
    if suffix == ".mov":
        suffix = ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw); path = tmp.name
    try:
        stt = OpenAISpeechToText(api_key=key)
        with open(path, "rb") as fh:
            result = await stt.transcribe(file=fh, model="whisper-1", language="it", response_format="text")
        if isinstance(result, str):
            return _axm_clean_transcript(result)
        if isinstance(result, dict):
            return _axm_clean_transcript(result.get("text") or result.get("transcript") or "")
        return _axm_clean_transcript(str(getattr(result, "text", result) or ""))
    finally:
        try:
            os.unlink(path)
        except Exception:  # noqa: BLE001
            pass


async def _axm_llm_json(system: str, text: str, image_b64: Optional[str] = None) -> dict:
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY mancante")
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
    if image_b64:
        chat = LlmChat(api_key=key, session_id=f"axm-{uuid.uuid4().hex[:8]}", system_message=system).with_model(*_AXM_VISION_MODEL)
        resp = await chat.send_message(UserMessage(text=text, file_contents=[ImageContent(image_base64=image_b64)]))
    else:
        chat = LlmChat(api_key=key, session_id=f"axm-{uuid.uuid4().hex[:8]}", system_message=system).with_model(*_AXM_TEXT_MODEL)
        resp = await chat.send_message(UserMessage(text=text))
    return _parse_llm_json((resp or "").strip(), fallback_key="raw") or {}


async def _axm_process(media_id: str, raw: bytes, ext: str) -> None:
    """Trascrizione / descrizione / tag. Aggiorna la riga (status ready|error). Mai blocca l'upload."""
    it = await db.axon_media.find_one({"media_id": media_id}, {"_id": 0})
    if not it:
        return
    upd: Dict[str, Any] = {"processed_at": utcnow(), "updated_at": utcnow(), "status": "ready"}
    try:
        if it["kind"] == "photo":
            data = await _axm_llm_json(
                "Sei l'archivio foto di AxonOS (assistente di un consulente energetico italiano). Descrivi la foto in italiano e rispondi SOLO JSON: "
                "{\"titolo\": \"max 60 caratteri\", \"descrizione\": \"2-3 frasi, cosa si vede e a cosa può servire\", \"testo\": \"tutto il testo leggibile nella foto (targhe, insegne, documenti, lavagne), altrimenti \\\"\\\"\", "
                "\"tag\": [\"3-6 parole chiave minuscole\"], \"suggerimento_sfera\": \"business|home|null\" (business se sembra lavoro: contratti, bollette, contatori, clienti, cantieri, biglietti da visita; home se personale)}",
                "Analizza questa foto.", base64.b64encode(raw).decode())
            upd.update({"title": (data.get("titolo") or it.get("title") or "Foto")[:80], "description": str(data.get("descrizione") or "")[:1200], "ocr_text": str(data.get("testo") or "")[:4000],
                        "tags": [str(t).lower()[:30] for t in (data.get("tag") or []) if t][:8], "suggested_sphere": data.get("suggerimento_sfera") if data.get("suggerimento_sfera") in ("business", "home") else None})
        else:
            transcript = await _axm_transcribe(raw, ext)
            upd["transcript"] = transcript[:20000]
            if len(transcript.strip()) >= 8:
                data = await _axm_llm_json(
                    "Sei l'archivio audio/video di AxonOS (assistente di un consulente energetico italiano). Data la trascrizione rispondi SOLO JSON: "
                    "{\"titolo\": \"max 60 caratteri\", \"riassunto\": \"2-4 frasi in italiano\", \"tag\": [\"3-6 parole chiave minuscole\"], \"azioni\": [\"eventuali cose da fare citate, max 4\"], "
                    "\"suggerimento_sfera\": \"business|home|null\" (business se parla di clienti, contratti, bollette, appuntamenti di lavoro; home se personale/famiglia)}",
                    f"Trascrizione:\n{transcript[:12000]}")
                upd.update({"title": (data.get("titolo") or it.get("title") or _AXM_KIND_LABEL[it["kind"]])[:80], "summary": str(data.get("riassunto") or "")[:1200],
                            "tags": [str(t).lower()[:30] for t in (data.get("tag") or []) if t][:8], "actions": [str(a)[:160] for a in (data.get("azioni") or [])][:4],
                            "suggested_sphere": data.get("suggerimento_sfera") if data.get("suggerimento_sfera") in ("business", "home") else None})
            else:
                upd["summary"] = "Nessun parlato riconoscibile."
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axm] process %s failed: %s", media_id, exc)
        upd.update({"status": "error", "error": str(exc)[:300]})
    await db.axon_media.update_one({"media_id": media_id}, {"$set": upd})


# ============================================================================ UPLOAD / CRUD
@api_router.post("/axon/media")
async def axm_upload(body: AxmUploadIn, user=Depends(get_current_user)):
    kind = (body.kind or "").lower()
    if kind not in _AXM_KINDS:
        raise HTTPException(status_code=400, detail="kind non valido (photo | audio | video)")
    sphere = _axm_sphere(body.sphere) if body.sphere else "unclassified"
    try:
        raw = base64.b64decode(_axm_bare_b64(body.data_base64))
    except Exception:
        raise HTTPException(status_code=400, detail="Base64 non valido")
    if not raw or len(raw) < 256:
        raise HTTPException(status_code=400, detail="File vuoto o troppo corto")
    if len(raw) > _AXM_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File troppo grande (max 25 MB): per i video tieni la durata sotto i 60 secondi")
    mime = (body.mime or "").lower() or {"photo": "image/jpeg", "audio": "audio/m4a", "video": "video/mp4"}[kind]
    ext = _axm_ext(kind, mime, body.name)
    mid = f"axm_{uuid.uuid4().hex[:10]}"; tid = tenant_id(user); now = utcnow()
    path = None
    for attempt in range(3):   # Object Storage a volte risponde 500 transitorio: fino a 3 tentativi
        try:
            res = await run_in_threadpool(_put_object_sync, f"media/{tid}/{mid}.{ext}", raw, mime)
            path = (res or {}).get("path") or (f"media/{tid}/{mid}.{ext}" if res else None)
            if path:
                break
        except Exception as exc:  # noqa: BLE001
            logger.warning("[axm] store failed (attempt %s): %s", attempt + 1, exc)
        await _axm_asyncio.sleep(0.6 * (attempt + 1))
    if not path:
        raise HTTPException(status_code=503, detail="Archivio file non disponibile, riprova")
    default_title = f"{_AXM_KIND_LABEL[kind]} {now.strftime('%d/%m %H:%M')}"
    doc = {"media_id": mid, "tenant_id": tid, "user_id": user["user_id"], "user_name": user.get("name") or user.get("email"), "kind": kind, "sphere": sphere,
           "title": (body.name or "").rsplit(".", 1)[0][:80] if body.name and not body.name.lower().startswith(("image", "img", "video", "vid", "audio", "rec", "file")) else default_title,
           "mime": mime, "size": len(raw), "duration_sec": body.duration_sec, "file_path": path, "note": (body.note or "")[:300] or None, "contact_id": body.contact_id,
           "status": "processing", "transcript": None, "summary": None, "description": None, "ocr_text": None, "tags": [], "actions": [], "suggested_sphere": None,
           "created_at": now, "updated_at": now, "classified_at": now if sphere != "unclassified" else None, "reminded_at": None, "processed_at": None}
    await db.axon_media.insert_one(dict(doc))
    _axm_asyncio.create_task(_axm_process(mid, raw, ext))
    ask = sphere == "unclassified"
    reply = (f"📂 {_AXM_KIND_LABEL[kind]} salvat{'a' if kind == 'photo' else 'o'}, sto {'trascrivendo' if kind != 'photo' else 'analizzando'}… "
             + ("**È privata o aziendale?** (🟢 Privata · 🔵 Aziendale — se non rispondi resta in ⚪ Non classificato e te lo ricordo tra 2 ore)" if ask
                else f"Archiviat{'a' if kind == 'photo' else 'o'} nella sfera {_AXM_ICON[sphere]} {_AXM_LABEL[sphere]}."))
    return {"ok": True, "media": _axm_out(doc), "ask_sphere": ask, "reply": reply}


@api_router.get("/axon/media")
async def axm_list(sphere: Optional[str] = None, kind: Optional[str] = None, q: Optional[str] = None, contact_id: Optional[str] = None, limit: int = 100, user=Depends(get_current_user)):
    f: Dict[str, Any] = _axm_scope(user)
    if sphere:
        f["sphere"] = _axm_sphere(sphere)
    if kind and kind in _AXM_KINDS:
        f["kind"] = kind
    if contact_id:
        f["contact_id"] = contact_id
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        f["$or"] = [{"title": rx}, {"transcript": rx}, {"summary": rx}, {"description": rx}, {"ocr_text": rx}, {"note": rx}, {"tags": rx}]
    items = [_axm_out(d) async for d in db.axon_media.find(f, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 300)))]
    for it in items:   # elenco leggero: anteprima testo, il dettaglio ha tutto
        for k in ("transcript", "ocr_text"):
            if it.get(k) and len(it[k]) > 240:
                it[k] = it[k][:240] + "…"
    counts = {s: 0 for s in _AXM_SPHERES}
    async for r in db.axon_media.aggregate([{"$match": _axm_scope(user)}, {"$group": {"_id": "$sphere", "n": {"$sum": 1}}}]):
        counts[r["_id"]] = r["n"]
    processing = await db.axon_media.count_documents({**_axm_scope(user), "status": "processing"})
    return {"items": items, "counts": counts, "processing": processing, "sphere": f.get("sphere"), "q": q or ""}


@api_router.get("/axon/media/{media_id}")
async def axm_get(media_id: str, user=Depends(get_current_user)):
    d = await db.axon_media.find_one({**_axm_scope(user), "media_id": media_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    return _axm_out(d)


@api_router.put("/axon/media/{media_id}")
async def axm_update(media_id: str, body: AxmPatch, user=Depends(get_current_user)):
    it = await db.axon_media.find_one({**_axm_scope(user), "media_id": media_id}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.sphere is not None:
        upd["sphere"] = _axm_sphere(body.sphere); upd["classified_at"] = utcnow() if upd["sphere"] != "unclassified" else None
    if body.title is not None: upd["title"] = body.title.strip()[:80] or it.get("title")
    if body.note is not None: upd["note"] = body.note.strip()[:300] or None
    if body.contact_id is not None: upd["contact_id"] = body.contact_id or None
    if body.tags is not None: upd["tags"] = [str(t).lower().strip()[:30] for t in body.tags if str(t).strip()][:10]
    await db.axon_media.update_one({"media_id": media_id}, {"$set": upd})
    out = _axm_out({**it, **upd})
    if "sphere" in upd:
        out["reply"] = f"{_AXM_ICON[upd['sphere']]} «{out.get('title')}» classificat{'a' if it['kind'] == 'photo' else 'o'} come {_AXM_LABEL[upd['sphere']]}."
    return {"ok": True, "media": out}


@api_router.post("/axon/media/{media_id}/reprocess")
async def axm_reprocess(media_id: str, user=Depends(get_current_user)):
    it = await db.axon_media.find_one({**_axm_scope(user), "media_id": media_id}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    got = await run_in_threadpool(_get_object_sync, it["file_path"])
    if not got:
        raise HTTPException(status_code=404, detail="File non disponibile")
    await db.axon_media.update_one({"media_id": media_id}, {"$set": {"status": "processing", "error": None, "updated_at": utcnow()}})
    _axm_asyncio.create_task(_axm_process(media_id, got[0], (it["file_path"].rsplit(".", 1)[-1] or "m4a").lower()))
    return {"ok": True}


@api_router.delete("/axon/media/{media_id}")
async def axm_delete(media_id: str, user=Depends(get_current_user)):
    r = await db.axon_media.delete_one({**_axm_scope(user), "media_id": media_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    return {"ok": True}


@api_router.get("/axon/media/{media_id}/file")
async def axm_file(media_id: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """File originale (foto/audio/video). Auth via header o ?token= (Image/Audio/Video player mobile e web)."""
    user = await get_current_user(authorization=authorization or (f"Bearer {token}" if token else None))
    it = await db.axon_media.find_one({**_axm_scope(user), "media_id": media_id}, {"_id": 0, "file_path": 1, "mime": 1, "kind": 1})
    if not it:
        raise HTTPException(status_code=404, detail="File non trovato")
    got = await run_in_threadpool(_get_object_sync, it["file_path"])
    if not got:
        raise HTTPException(status_code=404, detail="File non disponibile")
    from fastapi.responses import Response as _Resp
    return _Resp(content=got[0], media_type=it.get("mime") or got[1] or "application/octet-stream", headers={"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"})


# ============================================================================ REMINDER «Non classificato» (una volta per elemento, dopo 2 h)
async def _axm_remind_tick() -> int:
    n = 0
    try:
        cutoff = utcnow() - timedelta(hours=_AXM_REMIND_AFTER_H)
        by_user: Dict[str, List[dict]] = {}
        async for it in db.axon_media.find({"sphere": "unclassified", "reminded_at": None, "created_at": {"$lte": cutoff}}, {"_id": 0, "media_id": 1, "user_id": 1, "title": 1, "kind": 1}).limit(200):
            by_user.setdefault(it["user_id"], []).append(it)
        for uid, items in by_user.items():
            user = await db.users.find_one({"user_id": uid}, {"_id": 0}) or {"user_id": uid, "role": "owner"}
            cfg = await _apx_config(uid)
            ids = [i["media_id"] for i in items]
            if cfg["alerts"].get("media_unclassified", True):
                names = ", ".join(f"{_AXM_KIND_LABEL[i['kind']]} «{i.get('title') or ''}»" for i in items[:3]) + (f" e altri {len(items) - 3}" if len(items) > 3 else "")
                await _apx_emit(user, "alert", "media_unclassified", f"📂 {len(items)} elemento/i da classificare", f"{names}. Privata o aziendale?",
                                f"📂 **Archivio media**: hai {len(items)} elemento/i ancora in ⚪ Non classificato ({names}). Mi dici se sono **privati** (🟢 Home) o **aziendali** (🔵 Business)? Apri l'archivio e tocca la sfera giusta.",
                                f"media_uncl:{ids[0]}", [{"label": "Apri archivio", "prompt": "Apri l'archivio media da classificare"}], "scheduler", {"route": "/axon-media?sphere=unclassified"})
                n += 1
            await db.axon_media.update_many({"media_id": {"$in": ids}}, {"$set": {"reminded_at": utcnow()}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axm] remind tick failed: %s", exc)
    return n


# ============================================================================ CHAT: ricerca + classificazione rapida
_AXM_SEARCH_RE = re.compile(r"\b(cerca|trova|cercami|trovami|mostra(mi)?)\b.*\b(foto|audio|video|registrazion\w*|archivio media|nelle? (mie )?(foto|registrazioni|note vocali))\b|\b(cosa ho (registrato|fotografato|detto))\b", re.IGNORECASE)
_AXM_CLASSIFY_RE = re.compile(r"^\s*(è |e' |e )?(privat[ao]|personale|home|aziendale|business|lavoro)\s*[.!]?\s*$", re.IGNORECASE)
_axm_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").strip()
    try:
        if txt and _AXM_CLASSIFY_RE.match(txt):
            last = await db.axon_media.find_one({**_axm_scope(user), "sphere": "unclassified", "created_at": {"$gte": utcnow() - timedelta(minutes=30)}}, {"_id": 0}, sort=[("created_at", -1)])
            if last:
                sphere = "home" if re.search(r"privat|personale|home", txt, re.IGNORECASE) else "business"
                await db.axon_media.update_one({"media_id": last["media_id"]}, {"$set": {"sphere": sphere, "classified_at": utcnow(), "updated_at": utcnow()}})
                return {"reply": f"{_AXM_ICON[sphere]} Fatto: {_AXM_KIND_LABEL[last['kind']]} «{last.get('title')}» archiviat{'a' if last['kind'] == 'photo' else 'o'} in {_AXM_LABEL[sphere]}.", "cmd": "media_classify"}
        if txt and len(txt) <= 160 and _AXM_SEARCH_RE.search(txt):
            sphere = "home" if re.search(r"\b(personal\w*|privat\w*|casa|home)\b", txt, re.IGNORECASE) else ("business" if re.search(r"\b(aziendal\w*|business|lavoro)\b", txt, re.IGNORECASE) else None)
            kind = "photo" if re.search(r"\bfoto\b", txt, re.IGNORECASE) else ("video" if re.search(r"\bvideo\b", txt, re.IGNORECASE) else ("audio" if re.search(r"\b(audio|registrazion|vocal)", txt, re.IGNORECASE) else None))
            q = re.sub(r"\b(cerca|trova|cercami|trovami|mostrami|mostra|nelle|nei|negli|nell'|tra|le|i|gli|mie|miei|foto|audio|video|registrazioni|registrazione|note vocali|archivio media|cosa ho registrato|cosa ho fotografato|cosa ho detto|su|di|del|della|sul|sulla|personali|private|aziendali|business|home)\b", " ", txt, flags=re.IGNORECASE)
            q = re.sub(r"\s+", " ", q).strip(" ?.,!")
            r = await axm_list(sphere, kind, q or None, None, 8, user)
            if not r["items"]:
                return {"reply": f"📂 Nessun elemento nell'archivio media{f' {_AXM_ICON[sphere]} {_AXM_LABEL[sphere]}' if sphere else ''}{f' per «{q}»' if q else ''}.", "cmd": "media_search"}
            lines = [f"{_AXM_ICON[i['sphere']]} {_AXM_KIND_LABEL[i['kind']]} **{i.get('title')}** · {(i.get('created_at') or '')[:10]}" + (f" — {(i.get('summary') or i.get('description') or i.get('transcript') or '')[:110]}" if (i.get('summary') or i.get('description') or i.get('transcript')) else "") for i in r["items"]]
            return {"reply": f"📂 **Archivio media**{f' · {q}' if q else ''} ({len(r['items'])}):\n" + "\n".join(lines) + "\n\nApri *Archivio media* per ascoltare/vedere e classificare.", "cmd": "media_search"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axm] chat failed: %s", exc)
    return await _axm_prev_maybe_push_command(msg, user)


# ============================================================================ CONTESTO AXON (per sfera, mai incrociato)
async def _axm_context_section(user: dict) -> str:
    scope = _axm_scope(user)
    total = await db.axon_media.count_documents(scope)
    if not total:
        return ""
    parts = ["📂 ARCHIVIO MEDIA (foto/audio/video dell'utente, Fase 3). Regola: cita SEMPRE la sfera dell'elemento; MAI mescolare contenuti Business e Home senza richiesta esplicita."]
    for s in ("business", "home", "unclassified"):
        rows = [r async for r in db.axon_media.find({**scope, "sphere": s}, {"_id": 0, "kind": 1, "title": 1, "summary": 1, "description": 1, "created_at": 1, "actions": 1}).sort("created_at", -1).limit(5)]
        if not rows:
            continue
        line = f"{_AXM_ICON[s]} {_AXM_LABEL[s].upper()}: " + "; ".join(f"{_AXM_KIND_LABEL[r['kind']]} «{r.get('title')}» ({(r['created_at'].isoformat() if isinstance(r.get('created_at'), datetime) else '')[:10]})" + (f": {(r.get('summary') or r.get('description') or '')[:140]}" if (r.get('summary') or r.get('description')) else "") for r in rows)
        parts.append(line)
    uncl = await db.axon_media.count_documents({**scope, "sphere": "unclassified"})
    if uncl:
        parts.append(f"⚪ {uncl} elemento/i ancora da classificare: se l'utente dice «privata/aziendale» viene classificato l'ultimo.")
    return "\n".join(parts)[:3500]


_axm_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _axm_prev_prepare_prompt(user, body)
    try:
        sec = await _axm_context_section(user)
        if sec and prep.get("system_message"):
            prep["system_message"] = f"{prep['system_message']}\n\n{sec}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axm] context failed: %s", exc)
    return prep


@app.on_event("startup")
async def _axm_start():
    try:
        await db.axon_media.create_index([("tenant_id", 1), ("user_id", 1), ("sphere", 1), ("created_at", -1)])
        await db.axon_media.create_index([("media_id", 1)], unique=True)
        await db.axon_media.create_index([("sphere", 1), ("reminded_at", 1), ("created_at", 1)])
        _axn_scheduler.add_job(_axm_remind_tick, "interval", minutes=30, id="axm-remind-tick", replace_existing=True)
        logger.info("[axm] media archive armed")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axm] start failed: %s", exc)
