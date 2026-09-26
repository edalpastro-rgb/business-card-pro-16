# axon_voiceprint.py — V50.z372 — SISTEMA VOCALE · BLOCCHI 2-3: IMPRONTA VOCALE (SpeechBrain ECAPA-TDNN, sul server)
# Blocco 2: il proprietario legge un testo guidato (≥ 2 minuti di parlato) → embedding 192-d (media di N spezzoni) → Axon
#           risponde SOLO alla sua voce; voce sconosciuta → SILENZIO TOTALE (nessuna risposta, evento «unknown_voice»).
# Blocco 3: il Master registra voci secondarie (collaboratori/famiglia) con permessi spuntabili fino all'«accesso totale».
# Modello: speechbrain/spkrec-ecapa-voxceleb (CPU, ~3 s di caricamento lazy, 0.15 s per embedding). Audio m4a/webm/wav → ffmpeg
# (imageio-ffmpeg, stesso di media_compress) → PCM 16 kHz mono → VAD a energia (parlato effettivo, SNR) → embedding.
# Endpoint (tutti autenticati):
#   GET  /voiceprint/status                → {engine_ready, enforced, my_profile, profiles_count, threshold, min_speech_sec}
#   GET  /voiceprint/enroll/text           → testo guidato (paragrafi) da leggere
#   POST /voiceprint/enroll/start          → {session_id} (role owner = la propria voce; secondary = solo Master, con name)
#   POST /voiceprint/enroll/chunk          → spezzone 15-30 s → qualità cumulata {speech_sec, snr_db, consistency, progress, ready}
#   POST /voiceprint/enroll/finish         → crea/sostituisce il profilo (operativo se speech_sec ≥ min e consistency ≥ min)
#   POST /voiceprint/verify                → {match, profile, score} (stesso motore usato da /viola-wake/transcribe e /ai/transcribe)
#   GET  /voiceprint/profiles · PATCH/DELETE /voiceprint/profiles/{id} · PUT /voiceprint/settings {enabled, threshold}
# Helper condivisi: vp_verify_for_user(user, raw, mime) → None (nessun profilo: comportamento attuale) | {match, profile, score}
#                   vp_permission_denied(profile, category) → messaggio | None

VP_MODEL = "speechbrain/spkrec-ecapa-voxceleb"
VP_MODEL_DIR = str(Path(__file__).resolve().parent.parent / "models" / "ecapa")
VP_MIN_SPEECH_SEC = float(os.environ.get("VP_MIN_SPEECH_SEC", "120"))   # parlato effettivo minimo per un profilo operativo
VP_MIN_CONSISTENCY = float(os.environ.get("VP_MIN_CONSISTENCY", "0.60"))  # coerenza minima tra spezzoni (cos)
VP_DEFAULT_THRESHOLD = 0.40   # cos ≥ soglia → stessa voce (ECAPA: stessa persona 0.5-0.8, estranei < 0.3)
VP_THRESHOLDS = {"strict": 0.55, "normal": 0.40, "tolerant": 0.30}
VP_PERMISSION_KEYS = ("briefing", "chat", "crm", "device", "critical")
VP_PERMISSION_LABELS = {
    "briefing": "Briefing, agenda e report",
    "chat": "Domande libere ad Axon",
    "crm": "Dati clienti e CRM",
    "device": "Effetti e «trova il telefono»",
    "critical": "Comandi critici (sempre con PIN)",
}
VP_SECONDARY_DEFAULT = {"briefing": True, "chat": True, "crm": False, "device": True, "critical": False}
VP_CRM_RX = re.compile(r"\b(client\w*|contatt\w*|fattur\w*|bollett\w*|scadenz\w*|appuntament\w*|agenda|chiama\w*|telefono d\w*|numero d\w*|email d\w*|mail d\w*|indirizzo d\w*|nota\b|note\b|pratic\w*|pod\b|pdr\b|iban|codice fiscale|contratt\w*|offert\w*|preventiv\w*)\b", re.I)

VP_ENROLL_TEXT = [
    "Ciao Axon, sono io. Da oggi risponderai solo alla mia voce: leggo questo testo con calma, come se stessi parlando con un collega in ufficio.",
    "Buongiorno, che appuntamenti ho oggi? Ricordami di chiamare il signor Rossi alle dieci e di inviare il preventivo alla ditta Bianchi entro sera.",
    "Quando parlo con i clienti cambio tono: a volte sono deciso e veloce, a volte lento e tranquillo. Ora leggo questa frase un po' più forte, come se fossi in strada.",
    "Adesso invece parlo piano, quasi sottovoce, come quando sono in una sala d'attesa e non voglio disturbare nessuno intorno a me.",
    "Axon, controlla le scadenze delle bollette di questo mese e dimmi se c'è qualcosa di urgente. Poi prepara il report settimanale per lunedì.",
    "Uno, due, tre, quattro, cinque, sei, sette, otto, nove, dieci. Lunedì, martedì, mercoledì, giovedì, venerdì, sabato e domenica.",
    "Il mio lavoro è aiutare le persone a scegliere bene: luce, gas, telefonia, assicurazioni. Ogni cliente ha una storia diversa e io la ascolto tutta.",
    "Che tempo farà domani a Milano? Qual è il prezzo del PUN oggi? Quanto ho speso di carburante nell'ultimo mese? Chi devo richiamare?",
    "Ora leggo con entusiasmo: che bella giornata, abbiamo chiuso tre contratti e il team è al completo! Domani si parte per la fiera di Bologna.",
    "E ora con voce seria e professionale: la conferma dell'attivazione arriverà via email entro quarantotto ore, con il codice della pratica.",
    "Apri la scheda del cliente Colferai, aggiungi una nota: ha chiesto una comparativa gas per la seconda casa. Fissa un richiamo per giovedì.",
    "Le vocali: a, e, i, o, u. Le parole lunghe: straordinariamente, precipitevolissimevolmente, amministrazione, telecomunicazioni, responsabilità.",
    "Se qualcun altro dice il mio nome o prova a parlarti, tu resterai in silenzio. Risponderai soltanto quando riconoscerai davvero la mia voce.",
    "Grazie Axon, abbiamo quasi finito. Ricorda: tono calmo, tono deciso, tono allegro, tono stanco a fine giornata. Sono sempre io, in ogni caso.",
    "Ultimo paragrafo: nel traffico, in metropolitana, in ufficio o a casa, la mia voce resta la stessa. Da questo momento sei operativo e sei il mio assistente.",
]

_VP_MODEL = None
_VP_MODEL_LOCK = None
_VP_MODEL_ERR: Optional[str] = None


def _vp_load_model():
    """Carica ECAPA una sola volta (thread-safe). Ritorna il classificatore o solleva."""
    global _VP_MODEL, _VP_MODEL_LOCK, _VP_MODEL_ERR
    import threading
    if _VP_MODEL_LOCK is None:
        _VP_MODEL_LOCK = threading.Lock()
    with _VP_MODEL_LOCK:
        if _VP_MODEL is not None:
            return _VP_MODEL
        try:
            import torch  # noqa: F401
            from speechbrain.inference.speaker import EncoderClassifier
            _VP_MODEL = EncoderClassifier.from_hparams(source=VP_MODEL, savedir=VP_MODEL_DIR, run_opts={"device": "cpu"})
            _VP_MODEL_ERR = None
            logger.info("voiceprint: modello ECAPA pronto")
        except Exception as exc:  # noqa: BLE001
            _VP_MODEL_ERR = str(exc)[:300]
            logger.exception("voiceprint: caricamento modello fallito")
            raise
        return _VP_MODEL


def _vp_pcm16k(raw: bytes, mime: str):
    """bytes audio (m4a/webm/wav/mp3) → numpy float32 mono 16 kHz via ffmpeg."""
    import subprocess
    import numpy as np
    ff = globals().get("MC_FFMPEG")
    if not ff:
        raise RuntimeError("ffmpeg non disponibile")
    m = (mime or "").lower()
    ext = ".webm" if "webm" in m or "ogg" in m else ".wav" if "wav" in m else ".mp3" if "mp3" in m or "mpeg" in m else ".m4a"
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(raw)
        path = tmp.name
    try:
        p = subprocess.run([ff, "-nostdin", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                           capture_output=True, timeout=60)
        if p.returncode != 0 or len(p.stdout) < 3200:
            raise RuntimeError(f"decodifica audio fallita: {p.stderr.decode(errors='ignore')[:120]}")
        return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


def _vp_vad(sig, sr: int = 16000):
    """VAD a energia: ritorna (segnale solo parlato, speech_sec, snr_db)."""
    import numpy as np
    frame, hop = int(0.025 * sr), int(0.010 * sr)
    if len(sig) < frame * 4:
        return sig, 0.0, 0.0
    n = 1 + (len(sig) - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    frames = sig[idx]
    e_db = 10 * np.log10(np.mean(frames ** 2, axis=1) + 1e-10)
    noise = float(np.percentile(e_db, 10))
    speech_mask = (e_db > noise + 10) & (e_db > -55)
    # dilata di 5 frame (50 ms) per non tagliare attacchi/code
    k = np.ones(11)
    dil = np.convolve(speech_mask.astype(float), k, mode="same") > 0
    speech_sec = float(speech_mask.sum() * hop / sr)
    snr = float(np.median(e_db[speech_mask]) - noise) if speech_mask.any() else 0.0
    if speech_sec < 0.8:
        return sig, speech_sec, snr
    keep = np.zeros(len(sig), dtype=bool)
    for i in np.nonzero(dil)[0]:
        keep[i * hop:i * hop + frame] = True
    return sig[keep], speech_sec, snr


def _vp_embed_sync(raw: bytes, mime: str) -> dict:
    """Embedding normalizzato (lista 192 float) + qualità. Sincrono: chiamare in thread."""
    import numpy as np
    import torch
    sig = _vp_pcm16k(raw, mime)
    total_sec = len(sig) / 16000.0
    speech, speech_sec, snr = _vp_vad(sig)
    if len(speech) < 16000 * 0.6:
        return {"ok": False, "reason": "poco parlato", "speech_sec": round(speech_sec, 1), "snr_db": round(snr, 1), "total_sec": round(total_sec, 1)}
    model = _vp_load_model()
    with torch.no_grad():
        emb = model.encode_batch(torch.from_numpy(np.ascontiguousarray(speech)).unsqueeze(0)).squeeze().cpu().numpy()
    emb = emb / (np.linalg.norm(emb) + 1e-9)
    return {"ok": True, "emb": [float(x) for x in emb], "speech_sec": round(speech_sec, 1), "snr_db": round(snr, 1), "total_sec": round(total_sec, 1)}


def _vp_cos(a, b) -> float:
    import numpy as np
    a, b = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def _vp_mean(embs):
    import numpy as np
    m = np.mean(np.asarray(embs, dtype=np.float32), axis=0)
    m = m / (np.linalg.norm(m) + 1e-9)
    return [float(x) for x in m]


def _vp_consistency(embs) -> float:
    """Coerenza tra spezzoni: media del cos tra ogni spezzone e la media degli altri (1.0 se un solo spezzone)."""
    if len(embs) < 2:
        return 1.0
    vals = []
    for i, e in enumerate(embs):
        others = embs[:i] + embs[i + 1:]
        vals.append(_vp_cos(e, _vp_mean(others)))
    return float(sum(vals) / len(vals))


def _vp_profile_out(p: dict) -> dict:
    return {k: p.get(k) for k in ("profile_id", "name", "role", "status", "permissions", "quality", "chunks", "created_at", "updated_at", "last_match_at", "matches")}


async def _vp_settings(uid: str) -> dict:
    row = await db.voice_print_settings.find_one({"user_id": uid}, {"_id": 0}) or {}
    return {"enabled": bool(row.get("enabled", True)), "threshold": float(row.get("threshold") or VP_DEFAULT_THRESHOLD)}


async def vp_verify_for_user(user: dict, raw: bytes, mime: str) -> Optional[dict]:
    """None → nessun profilo operativo / impronta disattivata (comportamento attuale).
    Altrimenti {match: bool, profile: {...}|None, score: float, best_name}."""
    uid = user["user_id"]
    st = await _vp_settings(uid)
    if not st["enabled"]:
        return None
    profiles = await db.voice_profiles.find({"owner_user_id": uid, "status": "active"}, {"_id": 0}).to_list(50)
    if not profiles:
        return None
    try:
        r = await asyncio.to_thread(_vp_embed_sync, raw, mime)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"voiceprint verify: {exc}")
        return {"match": False, "profile": None, "score": 0.0, "error": str(exc)[:120]}
    if not r.get("ok"):
        return {"match": False, "profile": None, "score": 0.0, "error": r.get("reason")}
    best, best_score = None, -1.0
    for p in profiles:
        sc = _vp_cos(r["emb"], p["embedding"])
        # spezzoni singoli: il massimo aiuta con toni diversi (media pesata 70/30)
        chunk_scores = sorted((_vp_cos(r["emb"], c) for c in (p.get("chunk_embeddings") or [])), reverse=True)
        if chunk_scores:
            sc = 0.7 * sc + 0.3 * chunk_scores[0]
        if sc > best_score:
            best, best_score = p, sc
    match = best is not None and best_score >= st["threshold"]
    if match:
        await db.voice_profiles.update_one({"profile_id": best["profile_id"]}, {"$set": {"last_match_at": utcnow()}, "$inc": {"matches": 1}})
    return {"match": match, "profile": {"profile_id": best["profile_id"], "name": best["name"], "role": best["role"], "permissions": best.get("permissions") or {}} if match else None,
            "score": round(best_score, 3), "threshold": st["threshold"], "best_name": best["name"] if best else None, "speech_sec": r["speech_sec"], "snr_db": r["snr_db"]}


def vp_category_for(mode: str, text: str) -> str:
    if mode == "trigger":
        return "briefing"
    if mode in ("effect", "find_phone"):
        return "device"
    return "crm" if VP_CRM_RX.search(text or "") else "chat"


def vp_permission_denied(profile: Optional[dict], category: str) -> Optional[str]:
    """Voce secondaria senza il permesso richiesto → messaggio parlato; proprietario → None."""
    if not profile or profile.get("role") != "secondary":
        return None
    perms = profile.get("permissions") or {}
    if perms.get(category):
        return None
    if category == "critical":
        return "Non sei autorizzato ai comandi critici."
    return "Non sei autorizzato a questa sezione."


async def vp_profile_for(user: dict, profile_id: Optional[str]) -> Optional[dict]:
    if not profile_id:
        return None
    return await db.voice_profiles.find_one({"profile_id": profile_id, "owner_user_id": user["user_id"], "status": "active"}, {"_id": 0})


# ─── Modelli ───────────────────────────────────────────────────────────────────────────────────────────────────────

class VpEnrollStartIn(BaseModel):
    role: str = "owner"                      # owner | secondary
    name: Optional[str] = Field(default=None, max_length=60)
    profile_id: Optional[str] = None         # ri-registrazione di un profilo esistente


class VpChunkIn(BaseModel):
    session_id: str
    audio_base64: str
    mime: Optional[str] = "audio/m4a"


class VpFinishIn(BaseModel):
    session_id: str


class VpVerifyIn(BaseModel):
    audio_base64: str
    mime: Optional[str] = "audio/m4a"


class VpProfilePatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=60)
    permissions: Optional[Dict[str, bool]] = None
    status: Optional[str] = None             # active | paused


class VpSettingsIn(BaseModel):
    enabled: Optional[bool] = None
    threshold: Optional[float] = Field(default=None, ge=0.15, le=0.85)
    level: Optional[str] = None              # strict | normal | tolerant


def _vp_b64(s: str) -> bytes:
    b = s.split(",", 1)[1] if s.startswith("data:") else s
    try:
        raw = base64.b64decode(b)
    except Exception:
        raise HTTPException(status_code=400, detail="Audio base64 non valido")
    if len(raw) < 2048:
        raise HTTPException(status_code=400, detail="Audio troppo corto")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio troppo grande")
    return raw


# ─── Endpoint ──────────────────────────────────────────────────────────────────────────────────────────────────────

@api_router.get("/voiceprint/status")
async def vp_status(user=Depends(get_current_user)):
    uid = user["user_id"]
    st = await _vp_settings(uid)
    profiles = await db.voice_profiles.find({"owner_user_id": uid}, {"_id": 0, "embedding": 0, "chunk_embeddings": 0}).to_list(50)
    mine = next((p for p in profiles if p["role"] == "owner"), None)
    active = [p for p in profiles if p["status"] == "active"]
    if _VP_MODEL is None and _VP_MODEL_ERR is None:
        asyncio.create_task(asyncio.to_thread(_vp_load_model))  # riscaldo in background al primo accesso alla sezione
    return {"engine_ready": _VP_MODEL is not None, "engine_error": _VP_MODEL_ERR, "ffmpeg": bool(globals().get("MC_FFMPEG")),
            "enabled": st["enabled"], "enforced": st["enabled"] and bool(active), "threshold": st["threshold"],
            "level": next((k for k, v in VP_THRESHOLDS.items() if abs(v - st["threshold"]) < 0.01), "custom"),
            "my_profile": _vp_profile_out(mine) if mine else None, "profiles_count": len(profiles), "active_count": len(active),
            "min_speech_sec": VP_MIN_SPEECH_SEC, "min_consistency": VP_MIN_CONSISTENCY, "is_master": tenant_id(user) == uid,
            "permission_keys": VP_PERMISSION_KEYS, "permission_labels": VP_PERMISSION_LABELS}


@api_router.post("/voiceprint/engine/warmup")
async def vp_warmup(user=Depends(get_current_user)):
    try:
        await asyncio.to_thread(_vp_load_model)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Motore impronta vocale non disponibile: {str(exc)[:160]}")
    return {"ok": True}


@api_router.get("/voiceprint/enroll/text")
async def vp_enroll_text(user=Depends(get_current_user)):
    words = sum(len(p.split()) for p in VP_ENROLL_TEXT)
    return {"paragraphs": VP_ENROLL_TEXT, "words": words, "estimated_sec": int(words / 2.2), "min_speech_sec": VP_MIN_SPEECH_SEC}


@api_router.post("/voiceprint/enroll/start")
async def vp_enroll_start(body: VpEnrollStartIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    role = body.role if body.role in ("owner", "secondary") else "owner"
    if role == "secondary":
        _require_master(user)  # noqa: F821
        if not (body.name or "").strip():
            raise HTTPException(status_code=400, detail="Indica il nome della persona (voce secondaria)")
    target = None
    if body.profile_id:
        target = await db.voice_profiles.find_one({"profile_id": body.profile_id, "owner_user_id": uid}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Profilo vocale non trovato")
        role = target["role"]
    await db.voice_enroll_sessions.delete_many({"$or": [{"user_id": uid}, {"created_at": {"$lt": utcnow() - timedelta(hours=2)}}]})
    sid = f"vpe_{uuid.uuid4().hex[:12]}"
    name = (body.name or "").strip() or (target or {}).get("name") or (user.get("name") or user.get("email") or "Proprietario")
    await db.voice_enroll_sessions.insert_one({"session_id": sid, "user_id": uid, "tenant_id": tenant_id(user), "role": role, "name": name,
                                               "target_profile_id": body.profile_id, "chunks": [], "created_at": utcnow()})
    # riscalda il modello mentre l'utente inizia a leggere
    asyncio.create_task(asyncio.to_thread(_vp_load_model))
    return {"session_id": sid, "role": role, "name": name, "paragraphs": VP_ENROLL_TEXT, "min_speech_sec": VP_MIN_SPEECH_SEC, "min_consistency": VP_MIN_CONSISTENCY}


def _vp_session_quality(chunks: List[dict]) -> dict:
    embs = [c["emb"] for c in chunks if c.get("emb")]
    speech = sum(float(c.get("speech_sec") or 0) for c in chunks)
    snr = sum(float(c.get("snr_db") or 0) for c in chunks) / len(chunks) if chunks else 0.0
    cons = _vp_consistency(embs) if embs else 0.0
    progress = min(1.0, speech / VP_MIN_SPEECH_SEC) if VP_MIN_SPEECH_SEC > 0 else 1.0
    ready = speech >= VP_MIN_SPEECH_SEC and cons >= VP_MIN_CONSISTENCY and len(embs) >= 2
    return {"speech_sec": round(speech, 1), "snr_db": round(snr, 1), "consistency": round(cons, 3), "chunks": len(embs), "progress": round(progress, 3), "ready": ready,
            "min_speech_sec": VP_MIN_SPEECH_SEC, "min_consistency": VP_MIN_CONSISTENCY}


@api_router.post("/voiceprint/enroll/chunk")
async def vp_enroll_chunk(body: VpChunkIn, user=Depends(get_current_user)):
    sess = await db.voice_enroll_sessions.find_one({"session_id": body.session_id, "user_id": user["user_id"]}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=404, detail="Sessione di registrazione non trovata: ricomincia")
    raw = _vp_b64(body.audio_base64)
    try:
        r = await asyncio.to_thread(_vp_embed_sync, raw, body.mime or "")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Analisi voce non riuscita: {str(exc)[:160]}")
    chunks = list(sess.get("chunks") or [])
    hint = None
    if r.get("ok"):
        prev = [c["emb"] for c in chunks if c.get("emb")]
        cos_prev = _vp_cos(r["emb"], _vp_mean(prev)) if prev else None
        if r["snr_db"] < 8:
            hint = "Troppo rumore di fondo: avvicina il telefono o spostati in un posto più silenzioso."
        elif cos_prev is not None and cos_prev < 0.35:
            hint = "Questo tratto sembra una voce diversa o troppo disturbato: deve leggere sempre la stessa persona."
        chunks.append({"emb": r["emb"], "speech_sec": r["speech_sec"], "snr_db": r["snr_db"], "total_sec": r["total_sec"], "cos_prev": cos_prev, "at": utcnow()})
        await db.voice_enroll_sessions.update_one({"session_id": sess["session_id"]}, {"$set": {"chunks": chunks}})
    else:
        hint = "In questo tratto non ho sentito parlato: leggi il testo a voce normale."
    q = _vp_session_quality(chunks)
    return {**q, "accepted": bool(r.get("ok")), "chunk": {"speech_sec": r.get("speech_sec"), "snr_db": r.get("snr_db"), "total_sec": r.get("total_sec")}, "hint": hint}


@api_router.post("/voiceprint/enroll/finish")
async def vp_enroll_finish(body: VpFinishIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    sess = await db.voice_enroll_sessions.find_one({"session_id": body.session_id, "user_id": uid}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=404, detail="Sessione di registrazione non trovata: ricomincia")
    chunks = [c for c in (sess.get("chunks") or []) if c.get("emb")]
    q = _vp_session_quality(chunks)
    if not q["ready"]:
        if q["speech_sec"] < VP_MIN_SPEECH_SEC:
            raise HTTPException(status_code=422, detail=f"Serve più parlato: {int(q['speech_sec'])} s su {int(VP_MIN_SPEECH_SEC)} s minimi. Continua a leggere.")
        raise HTTPException(status_code=422, detail="Le registrazioni non sono coerenti tra loro (voci diverse o troppo rumore): ripeti la lettura in un ambiente più tranquillo.")
    embs = [c["emb"] for c in chunks]
    now = utcnow()
    pid = sess.get("target_profile_id")
    if not pid and sess["role"] == "owner":
        ex = await db.voice_profiles.find_one({"owner_user_id": uid, "role": "owner"}, {"_id": 0, "profile_id": 1})
        pid = ex["profile_id"] if ex else None
    is_new = not pid
    pid = pid or f"vp_{uuid.uuid4().hex[:12]}"
    doc = {"name": sess["name"], "role": sess["role"], "status": "active", "embedding": _vp_mean(embs), "chunk_embeddings": embs[-20:],
           "quality": {"speech_sec": q["speech_sec"], "snr_db": q["snr_db"], "consistency": q["consistency"]}, "chunks": len(embs), "updated_at": now}
    ins = {"profile_id": pid, "owner_user_id": uid, "tenant_id": sess["tenant_id"], "created_at": now, "matches": 0,
           "permissions": {k: True for k in VP_PERMISSION_KEYS} if sess["role"] == "owner" else dict(VP_SECONDARY_DEFAULT)}
    await db.voice_profiles.update_one({"profile_id": pid}, {"$set": doc, "$setOnInsert": ins}, upsert=True)
    await db.voice_enroll_sessions.delete_one({"session_id": sess["session_id"]})
    if sess["role"] == "owner":
        await db.voice_print_settings.update_one({"user_id": uid}, {"$set": {"enabled": True, "updated_at": now}, "$setOnInsert": {"user_id": uid, "threshold": VP_DEFAULT_THRESHOLD}}, upsert=True)
    p = await db.voice_profiles.find_one({"profile_id": pid}, {"_id": 0, "embedding": 0, "chunk_embeddings": 0})
    await db.viola_wake_events.insert_one({"kind": "voiceprint", "detail": f"{'nuovo' if is_new else 'aggiornato'} profilo {sess['role']} «{sess['name']}» · {int(q['speech_sec'])} s · coerenza {q['consistency']:.2f}",
                                           "event_id": f"vw_{uuid.uuid4().hex[:10]}", "user_id": uid, "tenant_id": sess["tenant_id"], "created_at": now})
    return {"ok": True, "profile": _vp_profile_out(p), "quality": q, "message": "Axon è operativo: da ora risponde alla tua voce." if sess["role"] == "owner" else f"Voce di {sess['name']} registrata."}


@api_router.post("/voiceprint/verify")
async def vp_verify(body: VpVerifyIn, user=Depends(get_current_user)):
    raw = _vp_b64(body.audio_base64)
    r = await vp_verify_for_user(user, raw, body.mime or "")
    if r is None:
        return {"enforced": False, "match": None, "profile": None, "score": None, "message": "Nessuna impronta vocale attiva"}
    return {"enforced": True, **r}


@api_router.get("/voiceprint/profiles")
async def vp_profiles(user=Depends(get_current_user)):
    items = await db.voice_profiles.find({"owner_user_id": user["user_id"]}, {"_id": 0, "embedding": 0, "chunk_embeddings": 0}).sort("created_at", 1).to_list(50)
    return {"items": [_vp_profile_out(p) for p in items], "total": len(items), "permission_keys": VP_PERMISSION_KEYS, "permission_labels": VP_PERMISSION_LABELS}


@api_router.patch("/voiceprint/profiles/{profile_id}")
async def vp_profile_patch(profile_id: str, body: VpProfilePatch, user=Depends(get_current_user)):
    p = await db.voice_profiles.find_one({"profile_id": profile_id, "owner_user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Profilo vocale non trovato")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.name is not None and body.name.strip():
        upd["name"] = body.name.strip()
    if body.permissions is not None:
        if p["role"] == "owner":
            raise HTTPException(status_code=400, detail="Il proprietario ha sempre accesso totale")
        _require_master(user)  # noqa: F821
        upd["permissions"] = {k: bool(body.permissions.get(k, (p.get("permissions") or {}).get(k, False))) for k in VP_PERMISSION_KEYS}
    if body.status is not None:
        if body.status not in ("active", "paused"):
            raise HTTPException(status_code=400, detail="status: active | paused")
        upd["status"] = body.status
    await db.voice_profiles.update_one({"profile_id": profile_id}, {"$set": upd})
    p = await db.voice_profiles.find_one({"profile_id": profile_id}, {"_id": 0, "embedding": 0, "chunk_embeddings": 0})
    return {"ok": True, "profile": _vp_profile_out(p)}


@api_router.delete("/voiceprint/profiles/{profile_id}")
async def vp_profile_delete(profile_id: str, user=Depends(get_current_user)):
    r = await db.voice_profiles.delete_one({"profile_id": profile_id, "owner_user_id": user["user_id"]})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Profilo vocale non trovato")
    return {"ok": True}


@api_router.put("/voiceprint/settings")
async def vp_settings_put(body: VpSettingsIn, user=Depends(get_current_user)):
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.enabled is not None:
        upd["enabled"] = body.enabled
    if body.level in VP_THRESHOLDS:
        upd["threshold"] = VP_THRESHOLDS[body.level]
    elif body.threshold is not None:
        upd["threshold"] = body.threshold
    await db.voice_print_settings.update_one({"user_id": user["user_id"]}, {"$set": upd, "$setOnInsert": {"user_id": user["user_id"]}}, upsert=True)
    return await vp_status(user)
