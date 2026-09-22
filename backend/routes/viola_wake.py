import re
"""
V50.z315 — VIOLAWAKE (modulo standalone opzionale) — backend.

Ascolto della wake-word «Viola» sul telefono (Picovoice Porcupine, 100% offline) → cattura del comando
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
    "keyword_mode": "custom",    # custom («Viola», file .ppn) | builtin (parola di fallback finché manca il modello)
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
    for w in ("ehi viola", "hey viola", "ok viola", "viola,", "viola "):
        if low.startswith(w):
            t = t[len(w):].strip(" ,.!?")
            break
    return t


def _vw_route(transcript: str) -> dict:
    """Classificazione deterministica del comando vocale."""
    cmd = _vw_strip_wake(transcript)
    low = cmd.lower().strip()
    if not low or low in VW_STOP_WORDS or any(low.startswith(s) for s in VW_STOP_WORDS):
        return {"mode": "cancel", "prompt": "", "reply": "OK!"}
    # V50.z318 — effetti locali del telefono (gestiti dall'app, nessun LLM)
    if re.search(r"\bfai (l'|lo |l )?effetto\b|\beffetto di attivazione\b|\battivati\b", low):
        return {"mode": "effect", "prompt": cmd}
    if re.search(r"\bdove sei\b|\btrova il (mio )?telefono\b|\bdov'è il (mio )?telefono\b|\bcerca il (mio )?telefono\b", low):
        return {"mode": "find_phone", "prompt": cmd}
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
            raise HTTPException(status_code=403, detail="ViolaWake non è attivo per la tua azienda: chiedi al Master di attivare il modulo")
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
    return _vw_route(body.transcript)


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
