# axon_personal_space.py — V50.z205 — BLOCCO 8 · Fase 4: «Spazio Personale» (Sfera 🟢 Home) — modulo ISOLATO
#
# Caricato DOPO axon_uploads.py e PRIMA di 37. Nessuna modifica al core, solo:
#   • 18_master_interface: hook `_audio_record_hooks` (dopo la creazione di un audio) + filtro `sphere` nell'elenco
#   • axon_memory: campo `sphere` nelle voci (+ wrap di `_am_analyze` per etichettarle)
#
# 1) UNIFICAZIONE: /my-thing, /my-web, /my-audios (+ archivio media Home, spese personali, memoria Home) vivono sotto la
#    Sfera Home come «Spazio Personale» → `GET /axon/personal-space/summary` (conteggi per la pagina hub /spazio-personale).
# 2) AUDIO PERSONALI (`audio_records`, target personal): classificazione sfera (`PUT /audio-records/{id}/sphere`) e
#    trascrizione automatica (hook alla creazione + job di recupero ogni 10 min per gli audio esistenti):
#    Whisper (riuso `_axm_transcribe`) + Haiku (titolo/riassunto/tag/suggerimento sfera, riuso `_axm_llm_json`).
#    `POST /audio-records/{id}/transcribe` per rilanciare, `GET /audio-records/{id}/file?token=` per il player nativo.
# 3) MEMORIA AXON: ogni voce di `axon_user_memory` ha `sphere` business|home (euristica testo; override manuale
#    persistito in `axon_user_memory_sphere` così l'analisi successiva lo rispetta). `PUT /axon/memory/{id}/sphere`.
# Chat: «cosa c'è nel mio spazio personale» → riepilogo.

import asyncio as _ps_asyncio

_PS_SPHERES = ("business", "home", "unclassified")
_PS_ICON = {"business": "🔵", "home": "🟢", "unclassified": "⚪"}
_PS_LABEL = {"business": "Business", "home": "Home (privata)", "unclassified": "Non classificato"}
_PS_HOME_RE = re.compile(
    r"\b(cas[ae]|famigli\w*|figli\w*|mogli\w*|marit\w*|compleann\w*|privat\w*|personal\w*|domotic\w*|home assistant|luci|clima|vacanz\w*|"
    r"salute|hobby|weekend|fine settimana|palestra|spesa|animal\w*|cane|gatto|hom(e)? (calendar|contacts|drive)|sfera home|spazio personale|my thing|my web)\b",
    re.IGNORECASE)
_PS_MODEL_NOTE = "Whisper + Claude Haiku"

_OMNI_EXTRA_SECTIONS.append((
    "Spazio Personale (Sfera Home · Fase 4)", "/spazio-personale",
    "Hub della sfera 🟢 Home: My Thing (messaggi, immagini, eventi e anniversari personali), My Web (link preferiti), I miei audio "
    "(note vocali personali con classificazione Privata/Aziendale e trascrizione automatica), archivio foto/audio/video Home, spese personali "
    "e voci Home della memoria Axon. Ogni voce della memoria Axon ha un tag sfera 🔵 Business / 🟢 Home modificabile dall'utente.",
))


class PsSphereIn(BaseModel):
    sphere: str


def _ps_sphere(s: Optional[str], allow_unclassified: bool = True) -> str:
    return _axm_sphere(s, allow_unclassified)


def _ps_iso(d: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items() if k != "_id"}


# ============================================================================ AUDIO PERSONALI: trascrizione + sfera
_ps_audio_busy: set = set()


async def _ps_transcribe_audio(audio_id: str) -> None:
    """Whisper + Haiku sull'audio `audio_records`. Mai blocca; aggiorna transcribe_status processing|ready|error."""
    if audio_id in _ps_audio_busy:
        return
    _ps_audio_busy.add(audio_id)
    try:
        a = await db.audio_records.find_one({"audio_id": audio_id}, {"_id": 0})
        if not a:
            return
        await db.audio_records.update_one({"audio_id": audio_id}, {"$set": {"transcribe_status": "processing", "updated_at": utcnow()}})
        upd: Dict[str, Any] = {"transcribe_status": "ready", "transcribed_at": utcnow(), "updated_at": utcnow()}
        try:
            raw = base64.b64decode(_axm_bare_b64(a.get("audio_base64") or ""))
            if len(raw) < 256:
                raise RuntimeError("Audio vuoto")
            transcript = await _axm_transcribe(raw, _axm_ext("audio", (a.get("mime") or "audio/webm").lower(), None))
            upd["transcript"] = transcript[:20000]
            if len(transcript.strip()) >= 8:
                data = await _axm_llm_json(
                    "Sei l'archivio note vocali di AxonOS (assistente di un consulente energetico italiano). Data la trascrizione rispondi SOLO JSON: "
                    "{\"titolo\": \"max 60 caratteri\", \"riassunto\": \"2-4 frasi in italiano\", \"tag\": [\"3-6 parole chiave minuscole\"], \"azioni\": [\"eventuali cose da fare citate, max 4\"], "
                    "\"suggerimento_sfera\": \"business|home|null\" (business se parla di clienti, contratti, bollette, appuntamenti di lavoro; home se personale/famiglia/casa)}",
                    f"Trascrizione:\n{transcript[:12000]}")
                upd.update({"summary": str(data.get("riassunto") or "")[:1200], "tags": [str(t).lower()[:30] for t in (data.get("tag") or []) if t][:8],
                            "actions": [str(x)[:160] for x in (data.get("azioni") or [])][:4],
                            "suggested_sphere": data.get("suggerimento_sfera") if data.get("suggerimento_sfera") in ("business", "home") else None})
                if not (a.get("title") or "").strip() and data.get("titolo"):
                    upd["title"] = str(data["titolo"])[:80]
            else:
                upd["summary"] = "Nessun parlato riconoscibile."
        except Exception as exc:  # noqa: BLE001
            logger.warning("[pspace] transcribe %s failed: %s", audio_id, exc)
            upd.update({"transcribe_status": "error", "transcribe_error": str(exc)[:300]})
        await db.audio_records.update_one({"audio_id": audio_id}, {"$set": upd})
    finally:
        _ps_audio_busy.discard(audio_id)


async def _ps_on_audio_created(doc: dict) -> None:
    """Hook (18_master_interface._audio_record_hooks): trascrizione automatica delle note vocali personali."""
    if doc.get("target_type") == "personal":
        await _ps_transcribe_audio(doc["audio_id"])


_audio_record_hooks.append(_ps_on_audio_created)


async def _ps_audio_catchup_tick() -> int:
    """Audio personali esistenti senza trascrizione: massimo 3 per giro (ogni 10 min)."""
    n = 0
    try:
        async for a in db.audio_records.find({"target_type": "personal", "transcribe_status": {"$in": [None, "pending"]}}, {"_id": 0, "audio_id": 1}).sort("created_at", -1).limit(3):
            await _ps_transcribe_audio(a["audio_id"]); n += 1
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pspace] catchup failed: %s", exc)
    return n


async def _ps_audio_for_user(audio_id: str, user: dict) -> dict:
    a = await db.audio_records.find_one({"user_id": tenant_id(user), "audio_id": audio_id}, {"_id": 0, "audio_base64": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Audio non trovato")
    if a.get("target_type") == "personal" and a.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    return a


@api_router.post("/audio-records/{audio_id}/transcribe")
async def ps_audio_transcribe(audio_id: str, user=Depends(get_current_user)):
    a = await _ps_audio_for_user(audio_id, user)
    if a.get("transcribe_status") == "processing" or audio_id in _ps_audio_busy:
        return {"ok": True, "status": "processing"}
    await db.audio_records.update_one({"audio_id": audio_id}, {"$set": {"transcribe_status": "processing", "transcribe_error": None}})
    _ps_asyncio.create_task(_ps_transcribe_audio(audio_id))
    return {"ok": True, "status": "processing"}


@api_router.put("/audio-records/{audio_id}/sphere")
async def ps_audio_sphere(audio_id: str, body: PsSphereIn, user=Depends(get_current_user)):
    a = await _ps_audio_for_user(audio_id, user)
    sphere = _ps_sphere(body.sphere)
    await db.audio_records.update_one({"audio_id": audio_id}, {"$set": {"sphere": sphere, "classified_at": utcnow() if sphere != "unclassified" else None, "updated_at": utcnow()}})
    return {"ok": True, "sphere": sphere, "reply": f"{_PS_ICON[sphere]} «{a.get('title') or 'Nota vocale'}» classificato come {_PS_LABEL[sphere]}."}


@api_router.get("/audio-records/{audio_id}/file")
async def ps_audio_file(audio_id: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """Bytes dell'audio (player nativo expo-audio / <audio> web). Auth via header o ?token=."""
    user = await get_current_user(authorization=authorization or (f"Bearer {token}" if token else None))
    a = await db.audio_records.find_one({"user_id": tenant_id(user), "audio_id": audio_id}, {"_id": 0, "audio_base64": 1, "mime": 1, "target_type": 1, "created_by": 1})
    if not a:
        raise HTTPException(status_code=404, detail="Audio non trovato")
    if a.get("target_type") == "personal" and a.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    try:
        raw = base64.b64decode(_axm_bare_b64(a.get("audio_base64") or ""))
    except Exception:
        raise HTTPException(status_code=404, detail="Audio non disponibile")
    return Response(content=raw, media_type=a.get("mime") or "audio/webm", headers={"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"})


# ============================================================================ MEMORIA AXON: tag sfera per ogni voce
def _ps_guess_memory_sphere(section: str, text: str) -> str:
    return "home" if _PS_HOME_RE.search(text or "") else "business"


async def _ps_tag_memory(uid: str) -> int:
    """Etichetta le voci senza sfera; rispetta gli override manuali (`axon_user_memory_sphere` per chiave)."""
    overrides = {d["key"]: d["sphere"] async for d in db.axon_user_memory_sphere.find({"user_id": uid}, {"_id": 0, "key": 1, "sphere": 1})}
    n = 0
    async for it in db.axon_user_memory.find({"user_id": uid, "$or": [{"sphere": {"$exists": False}}, {"sphere": None}]}, {"_id": 0, "id": 1, "section": 1, "text": 1}):
        k = _am_key(it.get("section") or "", it.get("text") or "")
        sphere = overrides.get(k) or _ps_guess_memory_sphere(it.get("section") or "", it.get("text") or "")
        await db.axon_user_memory.update_one({"id": it["id"]}, {"$set": {"sphere": sphere}})
        n += 1
    return n


_ps_prev_am_analyze = _am_analyze


async def _am_analyze(user: dict) -> Dict[str, int]:  # noqa: F811
    r = await _ps_prev_am_analyze(user)
    try:
        await _ps_tag_memory(user["user_id"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pspace] memory tagging failed: %s", exc)
    return r


@api_router.put("/axon/memory/{item_id}/sphere")
async def ps_memory_sphere(item_id: str, body: PsSphereIn, user=Depends(get_current_user)):
    sphere = _ps_sphere(body.sphere, allow_unclassified=False)
    it = await db.axon_user_memory.find_one({"id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Voce non trovata")
    k = _am_key(it["section"], it["text"])
    await db.axon_user_memory.update_one({"id": item_id}, {"$set": {"sphere": sphere, "updated_at": utcnow()}})
    await db.axon_user_memory_sphere.update_one({"user_id": user["user_id"], "key": k}, {"$set": {"user_id": user["user_id"], "key": k, "sphere": sphere, "at": utcnow()}}, upsert=True)
    return {"ok": True, "id": item_id, "sphere": sphere}


# ============================================================================ SPAZIO PERSONALE: riepilogo
async def _ps_summary(user: dict) -> dict:
    uid = user["user_id"]; tid = tenant_id(user)
    mt: Dict[str, int] = {"message": 0, "image": 0, "event": 0, "anniversary": 0}
    async for r in db.my_thing.aggregate([{"$match": {"owner_user_id": uid}}, {"$group": {"_id": "$kind", "n": {"$sum": 1}}}]):
        if r["_id"] in mt:
            mt[r["_id"]] = r["n"]
    aud = {"total": 0, "business": 0, "home": 0, "unclassified": 0, "transcribed": 0, "processing": 0}
    async for a in db.audio_records.find({"user_id": tid, "target_type": "personal", "created_by": uid}, {"_id": 0, "sphere": 1, "transcribe_status": 1}):
        aud["total"] += 1
        aud[a.get("sphere") if a.get("sphere") in _PS_SPHERES else "unclassified"] += 1
        if a.get("transcribe_status") == "ready":
            aud["transcribed"] += 1
        elif a.get("transcribe_status") == "processing":
            aud["processing"] += 1
    mem_total = await db.axon_user_memory.count_documents({"user_id": uid})
    mem_home = await db.axon_user_memory.count_documents({"user_id": uid, "sphere": "home"})
    g_home = await db.axon_integrations.find_one({"user_id": uid, "provider": "google", "sphere": "home"}, {"_id": 0, "google_email": 1})
    return {
        "sphere": {"key": "home", "label": "Home", "icon": "🟢", "color": "#059669"},
        "my_thing": {**mt, "total": sum(mt.values())},
        "web_links": await db.web_links.count_documents({"user_id": uid}),
        "audios": aud,
        "media_home": await db.axon_media.count_documents({"tenant_id": tid, "user_id": uid, "sphere": "home"}),
        "expenses_home": await db.axon_expenses.count_documents({"tenant_id": tid, "user_id": uid, "sphere": "home"}),
        "memory": {"total": mem_total, "home": mem_home, "business": mem_total - mem_home},
        "google_home": {"connected": bool(g_home), "account": (g_home or {}).get("google_email")},
        "homeassistant": bool(await db.homeassistant_configs.count_documents({"user_id": tid})),
    }


@api_router.get("/axon/personal-space/summary")
async def ps_summary(user=Depends(get_current_user)):
    return await _ps_summary(user)


# ============================================================================ CHAT: «cosa c'è nel mio spazio personale»
_PS_CHAT_RE = re.compile(r"\b(spazio personale|sfera home|cosa (ho|c'è) (nella|nel) (mia |mio )?(sfera home|spazio personale))\b", re.IGNORECASE)
_ps_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").strip()
    try:
        if txt and len(txt) <= 120 and _PS_CHAT_RE.search(txt) and re.search(r"\b(cosa|quanti|quante|riepilogo|riassunto|mostra|apri|stato)\b", txt, re.IGNORECASE):
            s = await _ps_summary(user)
            a = s["audios"]
            lines = [
                f"🟢 **Spazio Personale** (Sfera Home):",
                f"• My Thing: {s['my_thing']['message']} messaggi · {s['my_thing']['image']} immagini · {s['my_thing']['event']} eventi · {s['my_thing']['anniversary']} anniversari",
                f"• My Web: {s['web_links']} link salvati",
                f"• I miei audio: {a['total']} note vocali ({a['transcribed']} trascritte, {a['unclassified']} da classificare)",
                f"• Archivio media Home: {s['media_home']} elementi · Spese personali: {s['expenses_home']}",
                f"• Memoria Axon: {s['memory']['home']} voci Home su {s['memory']['total']}",
                f"• Google Home: {'collegato' if s['google_home']['connected'] else 'non collegato'} · Domotica: {'attiva' if s['homeassistant'] else 'non collegata'}",
                "Apri *Spazio Personale* dal menu per gestire tutto in un unico posto.",
            ]
            return {"reply": "\n".join(lines), "cmd": "personal_space"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pspace] chat failed: %s", exc)
    return await _ps_prev_maybe_push_command(msg, user)


# ============================================================================ STARTUP
async def _ps_memory_backfill() -> None:
    """Una tantum per avvio: voci di memoria senza sfera (tutti gli utenti) → tag."""
    try:
        uids = await db.axon_user_memory.distinct("user_id", {"$or": [{"sphere": {"$exists": False}}, {"sphere": None}]})
        for uid in uids:
            await _ps_tag_memory(uid)
        if uids:
            logger.info("[pspace] memory sphere backfill for %s users", len(uids))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pspace] backfill failed: %s", exc)


@app.on_event("startup")
async def _ps_start():
    try:
        await db.audio_records.create_index([("target_type", 1), ("transcribe_status", 1), ("created_at", -1)])
        await db.axon_user_memory_sphere.create_index([("user_id", 1), ("key", 1)], unique=True)
        _axn_scheduler.add_job(_ps_audio_catchup_tick, "interval", minutes=10, id="pspace-audio-catchup", replace_existing=True,
                               next_run_time=datetime.now(timezone.utc) + timedelta(seconds=45))
        _ps_asyncio.create_task(_ps_memory_backfill())
        logger.info("[pspace] personal space armed")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pspace] start failed: %s", exc)
