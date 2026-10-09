import re
"""
V50.z315 — VIOLAWAKE (modulo standalone opzionale) — backend.

Ascolto della wake-word «Axon» (motore interno "ViolaWake", nome MAI in UI) sul telefono (Picovoice Porcupine, 100% offline) → cattura del comando
(riconoscimento vocale on-device, nessun costo) → AxonOS in modalità voce (risposta parlata) oppure
trigger proattivo (briefing / scansione / report) tramite POST /axon/proactive/trigger (source=wake_word).

Qui: impostazioni per utente, ATTIVAZIONE DEL MODULO PER AZIENDA (servizio a sovrapprezzo, deciso dal
Master: spento di default), log eventi (wake / comando / esito) e routing deterministico del comando.

Endpoint:
  GET  /viola-wake/settings          → {module_enabled(azienda), enabled(utente), sensitivity, stt_engine, keyword_mode, ...}
  PUT  /viola-wake/settings          → aggiorna impostazioni utente
  PUT  /viola-wake/module            → Master: attiva/disattiva il modulo per tutta l'azienda
  POST /viola-wake/route             → classifica il comando: {mode: trigger|chat, action?, prompt}
  POST /viola-wake/event             → log evento dal telefono
  GET  /viola-wake/events?limit=30   → ultimi eventi dell'utente
"""

VW_DEFAULT_SETTINGS = {
    "enabled": False,            # ascolto attivo per QUESTO utente
    "sensitivity": 0.6,          # Porcupine 0..1
    "stt_engine": "device",      # device (on-device, gratis) | whisper (cloud, dopo la wake-word)
    "keyword_mode": "custom",    # custom («Axon», file .ppn) | builtin (parola di fallback finché manca il modello)
    "speak_reply": True,         # risposta parlata
    "confirm_sound": True,       # segnale acustico alla rilevazione
    "listen_seconds": 6,         # finestra massima per il comando
}

# comando → azione del trigger proattivo (deterministico, niente LLM)
VW_TRIGGER_RULES = [
    ("briefing", ("briefing", "riassunto della giornata", "cosa mi aspetta oggi", "buongiorno", "la mia giornata", "agenda di oggi")),
    ("weekly_report", ("report settimanale", "rapporto settimanale", "come è andata la settimana", "com'è andata la settimana", "resoconto settimanale")),
    ("scan", ("controlla tutto", "controlla scadenze", "c'è qualcosa di urgente", "novità", "cosa c'è di nuovo", "controlla la situazione", "scansione")),
]

VW_STOP_WORDS = ("annulla", "niente", "lascia stare", "stop", "basta", "fermati", "cancella")


class ViolaSettingsIn(BaseModel):
    enabled: Optional[bool] = None
    sensitivity: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    stt_engine: Optional[str] = None       # device | whisper
    keyword_mode: Optional[str] = None     # custom | builtin
    speak_reply: Optional[bool] = None
    confirm_sound: Optional[bool] = None
    listen_seconds: Optional[int] = Field(default=None, ge=3, le=15)


class ViolaModuleIn(BaseModel):
    enabled: bool
    note: Optional[str] = None             # es. "attivato su richiesta cliente — sovrapprezzo"


class ViolaRouteIn(BaseModel):
    transcript: str = Field(min_length=1, max_length=600)
    guard_token: Optional[str] = None  # V50.z371 — conferma PIN/biometria per comandi critici
    speaker_profile_id: Optional[str] = None  # V50.z372 — voce riconosciuta da /viola-wake/transcribe (permessi voci secondarie)


class ViolaEventIn(BaseModel):
    kind: str = Field(min_length=2, max_length=30)   # wake | command | trigger | chat | error | cancelled | permission
    transcript: Optional[str] = Field(default=None, max_length=600)
    detail: Optional[str] = Field(default=None, max_length=600)
    platform: Optional[str] = Field(default=None, max_length=20)
    engine: Optional[str] = Field(default=None, max_length=20)
    latency_ms: Optional[int] = None


async def _vw_module_enabled(tid: str) -> dict:
    doc = await db.viola_wake_modules.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    return {"enabled": bool(doc.get("enabled")), "note": doc.get("note"), "updated_at": doc.get("updated_at")}


def _vw_strip_wake(text: str) -> str:
    t = (text or "").strip()
    low = t.lower()
    for w in ("ehi axon", "hey axon", "ok axon", "ciao axon", "axon,", "axon ", "ehi viola", "hey viola", "ok viola", "viola,", "viola "):  # V50.z369 — wake-word «Axon»
        if low.startswith(w):
            t = t[len(w):].strip(" ,.!?")
            break
    return t


def _vw_route(transcript: str) -> dict:
    """Classificazione deterministica del comando vocale."""
    cmd = _vw_strip_wake(transcript)
    low = cmd.lower().strip()
    # V50.z371 — «cancella/annulla» da soli (≤ 3 parole) = STOP; con un oggetto («cancella tutti i contatti») è un comando critico
    if not low or low in VW_STOP_WORDS or (any(low.startswith(s) for s in VW_STOP_WORDS) and len(low.split()) <= 3):
        return {"mode": "cancel", "prompt": "", "reply": "OK!"}
    # V50.z318 — effetti locali del telefono (gestiti dall'app, nessun LLM)
    if re.search(r"\bfai (l'|lo |l )?effetto\b|\beffetto di attivazione\b|\battivati\b", low):
        return {"mode": "effect", "prompt": cmd}
    if re.search(r"\bdove sei\b|\btrova il (mio )?telefono\b|\bdov'è il (mio )?telefono\b|\bcerca il (mio )?telefono\b", low):
        return {"mode": "find_phone", "prompt": cmd, "ring_mode": "vibrate" if re.search(r"\bvibra\w*|senza suono|silenzios\w*", low) else "ring"}  # V50.z492 — «fallo vibrare» → vibrazione continua sul dispositivo bersaglio
    for action, keys in VW_TRIGGER_RULES:
        if any(k in low for k in keys):
            return {"mode": "trigger", "action": action, "prompt": cmd}
    return {"mode": "chat", "prompt": cmd}


@api_router.get("/viola-wake/settings")
async def viola_settings_get(user=Depends(get_current_user)):
    tid = tenant_id(user)
    mod = await _vw_module_enabled(tid)
    doc = await db.viola_wake_settings.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    st = {**VW_DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k in VW_DEFAULT_SETTINGS and v is not None}}
    return {"module": mod, "is_master": tid == user["user_id"], "settings": st, "trigger_rules": [a for a, _ in VW_TRIGGER_RULES]}


@api_router.put("/viola-wake/settings")
async def viola_settings_put(body: ViolaSettingsIn, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "stt_engine" in upd and upd["stt_engine"] not in ("device", "whisper"):
        raise HTTPException(status_code=400, detail="stt_engine: device | whisper")
    if "keyword_mode" in upd and upd["keyword_mode"] not in ("custom", "builtin"):
        raise HTTPException(status_code=400, detail="keyword_mode: custom | builtin")
    if upd.get("enabled"):
        mod = await _vw_module_enabled(tenant_id(user))
        if not mod["enabled"]:
            raise HTTPException(status_code=403, detail="I comandi vocali «Axon» non sono attivi per la tua azienda: chiedi al Master di attivare il modulo")
    upd["updated_at"] = utcnow()
    await db.viola_wake_settings.update_one({"user_id": user["user_id"]}, {"$set": upd, "$setOnInsert": {"user_id": user["user_id"], "created_at": utcnow()}}, upsert=True)
    return await viola_settings_get(user)


@api_router.put("/viola-wake/module")
async def viola_module_put(body: ViolaModuleIn, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    await db.viola_wake_modules.update_one(
        {"tenant_id": tid},
        {"$set": {"enabled": body.enabled, "note": (body.note or "").strip() or None, "updated_at": utcnow(), "updated_by": user["user_id"]},
         "$setOnInsert": {"tenant_id": tid, "created_at": utcnow()}},
        upsert=True,
    )
    if not body.enabled:
        # modulo spento per l'azienda → spegne l'ascolto a tutti gli utenti del tenant
        uids = [u["user_id"] async for u in db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 0, "user_id": 1})]
        await db.viola_wake_settings.update_many({"user_id": {"$in": uids}}, {"$set": {"enabled": False, "updated_at": utcnow()}})
    return {"ok": True, "module": await _vw_module_enabled(tid)}


@api_router.post("/viola-wake/route")
async def viola_route(body: ViolaRouteIn, user=Depends(get_current_user)):
    r = _vw_route(body.transcript)
    # V50.z372 — voce secondaria (Blocco 3): sezioni non permesse → «Non sei autorizzato a questa sezione»
    speaker = await vp_profile_for(user, body.speaker_profile_id)  # noqa: F821
    cat = vg_is_critical(body.transcript)  # noqa: F821
    if speaker and r.get("mode") != "cancel":
        need = "critical" if cat else vp_category_for(r.get("mode"), r.get("prompt") or body.transcript)  # noqa: F821
        denied = vp_permission_denied(speaker, need)  # noqa: F821
        if denied:
            await db.viola_wake_events.insert_one({"kind": "denied", "transcript": body.transcript[:200], "detail": f"{speaker['name']} → {need}", "event_id": f"vw_{uuid.uuid4().hex[:10]}",
                                                   "user_id": user["user_id"], "tenant_id": tenant_id(user), "created_at": utcnow()})
            return {"mode": "denied", "category": need, "prompt": r.get("prompt") or body.transcript, "reply": denied, "speaker": speaker["name"]}
    # V50.z371 — comando critico (cancella/impostazioni/dati sensibili) → serve conferma PIN o impronta, anche per il proprietario
    if cat and r.get("mode") != "cancel" and not await vg_check_token(user, body.guard_token):  # noqa: F821
        return {"mode": "guard", "category": cat, "prompt": r.get("prompt") or body.transcript,
                "message": "Comando critico: confermalo con impronta o PIN."}
    return r


# ─── V50.z348 — Trascrizione comando ROBUSTA AL RUMORE (traffico, metro, esterni): Whisper con vocabolario Axon,
#     verbose_json → scarta i segmenti «no_speech» e le allucinazioni tipiche del silenzio. Usata quando stt_engine=whisper.
VW_WHISPER_PROMPT = "Comando vocale ad Axon, assistente di AdvisorOS: agenda, briefing, report settimanale, bolletta, PUN, contatto, cliente, scadenze, chiama, ricorda, annulla, stop."
VW_HALLUCINATIONS = ("sottotitoli", "amara.org", "grazie per aver guardato", "iscriviti al canale", "traduzione di", "www.", "sottotitolato", "a cura di qtss", "qtss", "revisione a cura")


class ViolaTranscribeIn(BaseModel):
    audio_base64: str
    mime: Optional[str] = "audio/m4a"
    noise_db: Optional[float] = None       # rumore di fondo misurato dal telefono (dBFS), solo per statistiche
    ambient_db: Optional[int] = None       # V50.z367 — dB ambiente (≈ dBFS+90) e profilo scelto dal telefono (silent/normal/noisy)
    band: Optional[str] = None


def _vw_clean_transcript(segments: List[dict], text: str) -> str:
    keep = []
    for sg in segments or []:
        t = str(sg.get("text") or "").strip()
        if not t:
            continue
        if float(sg.get("no_speech_prob") or 0) > 0.6 and float(sg.get("avg_logprob") or 0) < -0.8:
            continue
        if any(h in t.lower() for h in VW_HALLUCINATIONS):
            continue
        keep.append(t)
    out = " ".join(keep).strip() if segments else (text or "").strip()
    if any(h in out.lower() for h in VW_HALLUCINATIONS):
        return ""
    return re.sub(r"\s+", " ", out)


@api_router.post("/viola-wake/transcribe")
async def viola_transcribe(body: ViolaTranscribeIn, user=Depends(get_current_user)):
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    b64 = body.audio_base64.split(",", 1)[1] if body.audio_base64.startswith("data:") else body.audio_base64
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Audio base64 non valido")
    if len(raw) < 2048:
        return {"transcript": "", "reason": "audio troppo corto", "segments": 0}
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio troppo grande")
    mime = (body.mime or "").lower()
    ext = ".webm" if "webm" in mime or "ogg" in mime else ".wav" if "wav" in mime else ".mp3" if "mp3" in mime or "mpeg" in mime else ".m4a"
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(raw)
        path = tmp.name
    t0 = utcnow()
    # V50.z372 — impronta vocale (Blocchi 2-3): verifica ECAPA in parallelo a Whisper. Nessun profilo → None (comportamento attuale).
    vp_task = asyncio.create_task(vp_verify_for_user(user, raw, mime))  # noqa: F821

    async def _whisper():
        from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=key)
        with open(path, "rb") as fh:
            return await stt.transcribe(file=fh, model="whisper-1", language="it", response_format="verbose_json", prompt=VW_WHISPER_PROMPT, temperature=0.0)
    try:
        res, vp = await asyncio.gather(_whisper(), vp_task)
        if isinstance(res, str):
            segs, text = [], res
        else:
            d = res if isinstance(res, dict) else (res.model_dump() if hasattr(res, "model_dump") else {"text": getattr(res, "text", ""), "segments": getattr(res, "segments", [])})
            segs = [s if isinstance(s, dict) else (s.model_dump() if hasattr(s, "model_dump") else dict(s)) for s in (d.get("segments") or [])]
            text = d.get("text") or ""
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Errore trascrizione: {str(exc)[:200]}")
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass
    transcript = _vw_clean_transcript(segs, text)
    latency = int((utcnow() - t0).total_seconds() * 1000)
    if vp is not None and not vp.get("match"):
        # voce NON riconosciuta → SILENZIO TOTALE: nessuna trascrizione, nessuna risposta (solo log)
        await db.viola_wake_events.insert_one({"kind": "unknown_voice", "detail": f"score {vp.get('score')} < soglia {vp.get('threshold')} · «{transcript[:80]}»" if not vp.get("error") else f"verifica fallita: {vp['error']}",
                                               "engine": "ecapa", "latency_ms": latency, "event_id": f"vw_{uuid.uuid4().hex[:10]}", "user_id": user["user_id"], "tenant_id": tenant_id(user), "created_at": utcnow()})
        return {"transcript": "", "reason": "unknown_voice", "silent": True, "speaker": None, "score": vp.get("score"), "engine": "whisper", "latency_ms": latency}
    return {"transcript": transcript, "raw": (text or "").strip(), "segments": len(segs), "engine": "whisper", "latency_ms": latency, "noise_db": body.noise_db, "ambient_db": body.ambient_db, "band": body.band,
            "speaker": (vp or {}).get("profile"), "speaker_score": (vp or {}).get("score")}


@api_router.post("/viola-wake/event")
async def viola_event(body: ViolaEventIn, user=Depends(get_current_user)):
    doc = {**body.model_dump(), "event_id": f"vw_{uuid.uuid4().hex[:10]}", "user_id": user["user_id"], "tenant_id": tenant_id(user), "created_at": utcnow()}
    await db.viola_wake_events.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "event_id": doc["event_id"]}


@api_router.get("/viola-wake/events")
async def viola_events(limit: int = 30, user=Depends(get_current_user)):
    items = await db.viola_wake_events.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(int(limit), 200)))
    return {"items": items, "total": len(items)}
