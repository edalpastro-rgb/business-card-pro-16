# axon_voice_devices.py — V50.z370 — SISTEMA VOCALE · BLOCCO 1: selezione dispositivo.
# Più dispositivi dello stesso utente in ascolto (Desktop = web app su PC, Telefono, Tablet) sentono «Axon» insieme →
# Axon chiede su tutti «Da dove vuoi che risponda? Desktop, Telefono o Tablet?»; l'utente risponde su uno solo e quello
# diventa il dispositivo ATTIVO per la sessione; gli altri restano in silenzio. La scelta vale finché il dispositivo si spegne /
# l'app viene chiusa (release) o l'utente dice «passa a <dispositivo>». Un solo dispositivo attivo → risponde subito.
#   POST /voice-devices/heartbeat  {device_key, kind, listening}   → presenza (ogni 30 s mentre ascolta)
#   POST /voice-devices/wake       {device_key, kind}              → {mode: respond|ask|silent, prompt?, active_kind?}
#   POST /voice-devices/select     {device_key, transcript}        → interpreta «desktop/telefono/tablet/qui/passa a …»
#   POST /voice-devices/release    {device_key}                    → dispositivo spento/app chiusa → libera la sessione
#   GET  /voice-devices                                            → stato (dispositivi attivi + sessione)

VD_ACTIVE_WINDOW_S = 90      # dispositivo «attivo» = in ascolto e visto negli ultimi 90 s
VD_ASK_WINDOW_S = 25         # finestra in cui la domanda «da dove rispondo?» resta aperta
VD_KINDS = {"desktop": "Desktop", "phone": "Telefono", "tablet": "Tablet"}
VD_PROMPT = "Ti sento da più dispositivi. Da dove vuoi che risponda? Desktop, Telefono o Tablet?"
_VD_WORDS = {"desktop": ("desktop", "computer", "pc", "portatile", "browser", "web"), "phone": ("telefono", "cellulare", "smartphone", "iphone", "android", "mobile"), "tablet": ("tablet", "ipad")}


class VdHeartbeatIn(BaseModel):
    device_key: str
    kind: str = "phone"
    listening: bool = True
    label: Optional[str] = None


class VdWakeIn(BaseModel):
    device_key: str
    kind: str = "phone"


class VdSelectIn(BaseModel):
    device_key: str
    transcript: str
    kind: str = "phone"


class VdReleaseIn(BaseModel):
    device_key: str


def _vd_naive(d: Any) -> datetime:
    return d.replace(tzinfo=None) if isinstance(d, datetime) and d.tzinfo else d


def _vd_kind(k: Optional[str]) -> str:
    return k if k in VD_KINDS else "phone"


async def _vd_active(uid: str) -> List[dict]:
    since = utcnow() - timedelta(seconds=VD_ACTIVE_WINDOW_S)
    rows = await db.axon_voice_devices.find({"user_id": uid, "listening": True, "last_seen": {"$gte": since}}, {"_id": 0}).sort("last_seen", -1).to_list(20)
    return rows


async def _vd_session(uid: str) -> Optional[dict]:
    s = await db.axon_voice_sessions.find_one({"user_id": uid}, {"_id": 0})
    if not s:
        return None
    # sessione valida solo se il dispositivo attivo è ancora presente
    if s.get("active_device_key"):
        dev = await db.axon_voice_devices.find_one({"user_id": uid, "device_key": s["active_device_key"]}, {"_id": 0, "last_seen": 1, "listening": 1})
        if not dev or not dev.get("listening") or _vd_naive(dev["last_seen"]) < _vd_naive(utcnow()) - timedelta(seconds=VD_ACTIVE_WINDOW_S * 2):
            await db.axon_voice_sessions.delete_one({"user_id": uid}); return None
    return s


def _vd_out(active: List[dict], s: Optional[dict]) -> dict:
    return {"active_devices": [{"device_key": d["device_key"], "kind": d["kind"], "label": d.get("label") or VD_KINDS[d["kind"]], "last_seen": d["last_seen"].isoformat()} for d in active],
            "active_device_key": (s or {}).get("active_device_key"), "active_kind": (s or {}).get("active_kind"),
            "pending_selection": bool(s and s.get("pending_since") and not s.get("active_device_key") and _vd_naive(s["pending_since"]) > _vd_naive(utcnow()) - timedelta(seconds=VD_ASK_WINDOW_S))}


@api_router.post("/voice-devices/heartbeat")
async def vd_heartbeat(body: VdHeartbeatIn, user=Depends(get_current_user)):
    uid = user["user_id"]; kind = _vd_kind(body.kind)
    await db.axon_voice_devices.update_one({"user_id": uid, "device_key": body.device_key},
                                           {"$set": {"kind": kind, "listening": body.listening, "label": body.label or VD_KINDS[kind], "last_seen": utcnow()}, "$setOnInsert": {"first_seen": utcnow()}}, upsert=True)
    return _vd_out(await _vd_active(uid), await _vd_session(uid))


@api_router.post("/voice-devices/wake")
async def vd_wake(body: VdWakeIn, user=Depends(get_current_user)):
    uid = user["user_id"]; kind = _vd_kind(body.kind)
    await db.axon_voice_devices.update_one({"user_id": uid, "device_key": body.device_key}, {"$set": {"kind": kind, "listening": True, "last_seen": utcnow()}, "$setOnInsert": {"first_seen": utcnow(), "label": VD_KINDS[kind]}}, upsert=True)
    active = await _vd_active(uid); s = await _vd_session(uid)
    others = [d for d in active if d["device_key"] != body.device_key]
    if s and s.get("active_device_key"):
        if s["active_device_key"] == body.device_key:
            return {"mode": "respond", "active_kind": s.get("active_kind"), **_vd_out(active, s)}
        return {"mode": "silent", "active_kind": s.get("active_kind"), **_vd_out(active, s)}
    if not others:
        return {"mode": "respond", "active_kind": kind, **_vd_out(active, s)}
    # più dispositivi → domanda (una sola finestra condivisa)
    await db.axon_voice_sessions.update_one({"user_id": uid}, {"$set": {"pending_since": utcnow(), "active_device_key": None, "active_kind": None,
                                                                         "asked_devices": sorted({d["device_key"] for d in active})}}, upsert=True)
    return {"mode": "ask", "prompt": VD_PROMPT, "options": [VD_KINDS[d["kind"]] for d in active], **_vd_out(active, await _vd_session(uid))}


def vd_parse_choice(transcript: str) -> Optional[str]:
    t = (transcript or "").lower()
    for kind, words in _VD_WORDS.items():
        if any(re.search(rf"\b{w}\b", t) for w in words):
            return kind
    if re.search(r"\b(qui|questo|da qui|su questo)\b", t):
        return "__self__"
    return None


def vd_is_switch(transcript: str) -> Optional[str]:
    """«passa a telefono» / «rispondi dal desktop» / «usa il tablet» → kind."""
    t = (transcript or "").lower()
    if re.search(r"\b(passa|passare|sposta|rispondi|usa|vai)\b", t):
        return vd_parse_choice(t) or None
    return None


@api_router.post("/voice-devices/select")
async def vd_select(body: VdSelectIn, user=Depends(get_current_user)):
    uid = user["user_id"]; choice = vd_parse_choice(body.transcript)
    if not choice:
        return {"ok": False, "message": "Non ho capito: dimmi Desktop, Telefono o Tablet."}
    active = await _vd_active(uid)
    if choice == "__self__":
        target = next((d for d in active if d["device_key"] == body.device_key), None) or {"device_key": body.device_key, "kind": _vd_kind(body.kind)}
    else:
        cands = [d for d in active if d["kind"] == choice]
        target = next((d for d in cands if d["device_key"] == body.device_key), None) or (cands[0] if cands else None)
        if not target:
            return {"ok": False, "message": f"Non trovo un {VD_KINDS[choice].lower()} in ascolto. Dispositivi attivi: {', '.join(VD_KINDS[d['kind']] for d in active) or 'nessuno'}."}
    await db.axon_voice_sessions.update_one({"user_id": uid}, {"$set": {"active_device_key": target["device_key"], "active_kind": target["kind"], "since": utcnow(), "pending_since": None}}, upsert=True)
    label = VD_KINDS[target["kind"]].lower()
    return {"ok": True, "active_device_key": target["device_key"], "active_kind": target["kind"], "is_me": target["device_key"] == body.device_key,
            "message": f"Perfetto, rispondo dal {label}." if target["device_key"] == body.device_key else f"Va bene, da ora rispondo dal {label}: qui resto in silenzio."}


@api_router.post("/voice-devices/release")
async def vd_release(body: VdReleaseIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    await db.axon_voice_devices.update_one({"user_id": uid, "device_key": body.device_key}, {"$set": {"listening": False, "last_seen": utcnow()}})
    s = await db.axon_voice_sessions.find_one({"user_id": uid}, {"_id": 0, "active_device_key": 1})
    released = bool(s and s.get("active_device_key") == body.device_key)
    if released:
        await db.axon_voice_sessions.delete_one({"user_id": uid})
    return {"ok": True, "session_released": released}


@api_router.get("/voice-devices")
async def vd_status(user=Depends(get_current_user)):
    uid = user["user_id"]
    return {**_vd_out(await _vd_active(uid), await _vd_session(uid)), "kinds": VD_KINDS}
