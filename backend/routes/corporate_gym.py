# corporate_gym.py — Corporate Gym (Blocco 1: struttura base)
# Modulo ISOLATO: nessuna dipendenza da altri moduli oltre a helper condivisi
# (api_router, db, get_current_user, tenant_id, is_admin_or_owner, utcnow, uuid, BaseModel).
# Tutte le collection sono prefissate `cgym_`.
#
# Modello sessione (cgym_sessions):
#   session_id, tenant_id, user_id (assegnatario), assigned_by, type ("obiezioni"|"winwin"),
#   title, scheduled_at (ISO UTC), status ("assegnata"|"in_corso"|"completata"),
#   mandatory (bool), score (float|None), created_at, completed_at
from zoneinfo import ZoneInfo as _CgymZoneInfo

_CGYM_TZ = _CgymZoneInfo("Europe/Rome")
CGYM_TYPES = ("obiezioni", "winwin")
CGYM_STATUSES = ("assegnata", "in_corso", "completata")


class CgymSessionIn(BaseModel):
    type: Literal["obiezioni", "winwin"]
    scheduled_at: str  # ISO 8601
    user_id: Optional[str] = None  # None = me stesso
    title: Optional[str] = None
    mandatory: bool = False


class CgymSessionUpdate(BaseModel):
    status: Optional[Literal["assegnata", "in_corso", "completata"]] = None
    score: Optional[float] = None
    scheduled_at: Optional[str] = None
    title: Optional[str] = None
    mandatory: Optional[bool] = None


def _cgym_parse_dt(s: str) -> datetime:
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="Data/ora non valida (ISO 8601)")
    if d.tzinfo is None:
        d = d.replace(tzinfo=_CGYM_TZ)
    return d.astimezone(timezone.utc)


def _cgym_dt(v) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _cgym_out(doc: dict) -> dict:
    d = {k: v for k, v in doc.items() if k != "_id"}
    for k in ("scheduled_at", "created_at", "completed_at", "updated_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].astimezone(timezone.utc).isoformat()
    return d


async def _cgym_tenant_member_ids(tid: str) -> set:
    rows = await db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 0, "user_id": 1}).to_list(2000)
    return {r["user_id"] for r in rows}


async def _cgym_get_or_404(session_id: str, user: dict) -> dict:
    doc = await db.cgym_sessions.find_one({"session_id": session_id, "tenant_id": tenant_id(user)})
    if not doc:
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    return doc


@api_router.get("/cgym/sessions")
async def cgym_list_sessions(
    scope: str = "mine",
    type: Optional[str] = None,
    status: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Sessioni Corporate Gym. scope=mine (default) → le mie; scope=team → tutto il tenant (solo Titolare/Admin)."""
    tid = tenant_id(user)
    q: Dict[str, Any] = {"tenant_id": tid}
    if scope == "team":
        if not is_admin_or_owner(user):
            raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    else:
        q["user_id"] = user["user_id"]
    if type in CGYM_TYPES:
        q["type"] = type
    if status in CGYM_STATUSES:
        q["status"] = status
    rows = await db.cgym_sessions.find(q).sort("scheduled_at", 1).to_list(1000)
    # nome assegnatario (per la vista team)
    names: Dict[str, str] = {}
    if scope == "team":
        ids = list({r["user_id"] for r in rows})
        if ids:
            us = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(2000)
            names = {u["user_id"]: (u.get("name") or u.get("email") or u["user_id"]) for u in us}
    out = []
    for r in rows:
        o = _cgym_out(r)
        if names:
            o["user_name"] = names.get(r["user_id"], "")
        out.append(o)
    return {"items": out}


@api_router.post("/cgym/sessions")
async def cgym_create_session(body: CgymSessionIn, user=Depends(get_current_user)):
    """Crea/assegna una sessione. Tutti possono auto-assegnarsi; assegnare ad altri richiede Titolare/Admin."""
    tid = tenant_id(user)
    target = body.user_id or user["user_id"]
    if target != user["user_id"]:
        if not is_admin_or_owner(user):
            raise HTTPException(status_code=403, detail="Solo Titolare/Admin possono assegnare sessioni ad altri")
        if target not in await _cgym_tenant_member_ids(tid):
            raise HTTPException(status_code=400, detail="Utente non appartenente al team")
    now = utcnow()
    doc = {
        "session_id": str(uuid.uuid4()),
        "tenant_id": tid,
        "user_id": target,
        "assigned_by": user["user_id"],
        "type": body.type,
        "title": (body.title or "").strip() or ("Gym Obiezioni" if body.type == "obiezioni" else "Gym WIN-WIN"),
        "scheduled_at": _cgym_parse_dt(body.scheduled_at),
        "status": "assegnata",
        "mandatory": bool(body.mandatory),
        "score": None,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
    }
    await db.cgym_sessions.insert_one(doc)
    return _cgym_out(doc)


@api_router.patch("/cgym/sessions/{session_id}")
async def cgym_update_session(session_id: str, body: CgymSessionUpdate, user=Depends(get_current_user)):
    """Aggiorna stato/score/data. Consentito all'assegnatario e a Titolare/Admin."""
    doc = await _cgym_get_or_404(session_id, user)
    if doc["user_id"] != user["user_id"] and not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.status is not None:
        upd["status"] = body.status
        upd["completed_at"] = utcnow() if body.status == "completata" else None
    if body.score is not None:
        upd["score"] = float(body.score)
    if body.scheduled_at is not None:
        upd["scheduled_at"] = _cgym_parse_dt(body.scheduled_at)
    if body.title is not None:
        upd["title"] = body.title.strip()
    if body.mandatory is not None:
        if not is_admin_or_owner(user) and doc["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Non autorizzato")
        upd["mandatory"] = bool(body.mandatory)
    await db.cgym_sessions.update_one({"session_id": session_id}, {"$set": upd})
    doc.update(upd)
    return _cgym_out(doc)


@api_router.delete("/cgym/sessions/{session_id}")
async def cgym_delete_session(session_id: str, user=Depends(get_current_user)):
    """Elimina: Titolare/Admin, oppure chi l'ha creata per sé."""
    doc = await _cgym_get_or_404(session_id, user)
    own_self = doc["user_id"] == user["user_id"] and doc.get("assigned_by") == user["user_id"]
    if not (is_admin_or_owner(user) or own_self):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.cgym_sessions.delete_one({"session_id": session_id})
    return {"ok": True}


@api_router.get("/cgym/summary")
async def cgym_summary(user=Depends(get_current_user)):
    """Riepilogo per widget Home e striscia avviso (solo le MIE sessioni).
    - due_soon: non completate con scheduled_at entro 7 giorni (incluse scadute)
    - today_total / today_done: sessioni di oggi (Europe/Rome)
    - mandatory_pending: obbligatorie non completate (→ striscia arancione)
    - overdue: non completate con data passata
    """
    now = utcnow()
    local_now = now.astimezone(_CGYM_TZ)
    day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    horizon = now + timedelta(days=7)
    rows = await db.cgym_sessions.find({"tenant_id": tenant_id(user), "user_id": user["user_id"]}).to_list(2000)
    due_soon, today_total, today_done, mandatory_pending, overdue = [], 0, 0, 0, 0
    for r in rows:
        dt = _cgym_dt(r.get("scheduled_at"))
        done = r.get("status") == "completata"
        if dt is not None and day_start <= dt.astimezone(_CGYM_TZ) < day_end:
            today_total += 1
            if done:
                today_done += 1
        if not done:
            if r.get("mandatory"):
                mandatory_pending += 1
            if dt is not None and dt < now:
                overdue += 1
            if dt is not None and dt <= horizon:
                due_soon.append(_cgym_out(r))
    due_soon.sort(key=lambda x: x.get("scheduled_at") or "")
    return {
        "due_soon": due_soon[:10],
        "due_soon_count": len(due_soon),
        "today_total": today_total,
        "today_done": today_done,
        "mandatory_pending": mandatory_pending,
        "overdue": overdue,
        "server_time": now.isoformat(),
    }


@api_router.get("/cgym/team-overview")
async def cgym_team_overview(user=Depends(get_current_user)):
    """Quadro team (Titolare/Admin): per ogni membro conteggi assegnate/in corso/completate/obbligatorie pendenti."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    tid = tenant_id(user)
    members = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1},
    ).to_list(2000)
    rows = await db.cgym_sessions.find({"tenant_id": tid}).to_list(5000)
    agg: Dict[str, Dict[str, Any]] = {}
    for m in members:
        agg[m["user_id"]] = {"user_id": m["user_id"], "name": m.get("name") or m.get("email") or m["user_id"], "role": m.get("role"),
                             "assegnata": 0, "in_corso": 0, "completata": 0, "mandatory_pending": 0, "avg_score": None, "_scores": []}
    for r in rows:
        a = agg.get(r["user_id"])
        if not a:
            continue
        st = r.get("status", "assegnata")
        a[st] = a.get(st, 0) + 1
        if r.get("mandatory") and st != "completata":
            a["mandatory_pending"] += 1
        if st == "completata" and isinstance(r.get("score"), (int, float)):
            a["_scores"].append(float(r["score"]))
    out = []
    for a in agg.values():
        sc = a.pop("_scores")
        a["avg_score"] = round(sum(sc) / len(sc), 1) if sc else None
        out.append(a)
    out.sort(key=lambda x: (-x["mandatory_pending"], x["name"].lower()))
    return {"items": out}


# =========================================================================
# Blocco 2 — Role-play vocale: obiezione TEMPO (MVP)
# AxonOS interpreta il cliente (LLM via LlmChat + TTS interno `assistant_tts`);
# il consulente risponde a voce (STT interno `ai_transcribe`). Al termine: score,
# feedback e salvataggio in cgym_sessions. Collection: cgym_roleplays.
# Nessuna modifica al codice AxonOS: qui vengono SOLO richiamate le sue funzioni.
# =========================================================================
CGYM_RP_MAX_TURNS = 5  # turni del consulente prima della chiusura forzata

CGYM_SCENARIOS = {
    "tempo": {
        "label": "Obiezione TEMPO",
        "objection": "Non ho tempo",
        "opening_hint": "Il consulente ha appena proposto un breve incontro/analisi della bolletta. Tu rispondi con l'obiezione del TEMPO: sei di fretta, non hai tempo, rimanda.",
        "persona": (
            "Sei Marco Bianchi, titolare di una piccola azienda (officina meccanica, 6 dipendenti) a Vicenza. "
            "Sei un cliente potenziale di un consulente energetico che ti ha contattato per proporti un'analisi delle bollette luce/gas. "
            "La tua obiezione principale è il TEMPO: sei sempre di corsa, hai già troppe cose da fare, rimandi. "
            "Sei educato ma sbrigativo. Non sei ostile: se il consulente riconosce il tuo problema, ti fa capire in modo concreto "
            "quanto poco tempo serve, quantifica il vantaggio e propone uno slot preciso e breve, puoi aprirti gradualmente e alla fine accettare. "
            "Se il consulente insiste, è generico, parla troppo o ignora la tua obiezione, resti chiuso e concludi la telefonata."
        ),
    }
}

CGYM_RP_TURN_SYSTEM = """{persona}

REGOLE DI RECITAZIONE:
- Parla SOLO come il cliente, in italiano, prima persona, tono naturale da telefonata. MAX 2 frasi brevi (parlato, non scritto).
- Resta nel personaggio: mai spiegare, mai dare consigli al consulente, mai uscire dal ruolo.
- Valuta la risposta del consulente turno per turno: se gestisce bene l'obiezione (ascolta, riformula, quantifica il tempo richiesto, dà un beneficio concreto, propone uno slot preciso) il tuo "mood" migliora; altrimenti peggiora.
- Chiudi la conversazione (end=true) quando: accetti un appuntamento concreto, OPPURE rifiuti definitivamente dopo risposte deboli, OPPURE hai raggiunto il turno {max_turns}.
- Turno attuale del consulente: {turn} di {max_turns}.

RISPONDI SOLO con JSON valido, senza testo attorno:
{{"reply": "<battuta del cliente>", "mood": "chiuso|scettico|aperto|convinto", "end": true|false}}"""

CGYM_RP_EVAL_SYSTEM = """Sei un formatore commerciale esperto nel settore energia (consulenti luce/gas B2B/B2C in Italia).
Valuta la gestione dell'obiezione "{objection}" da parte del consulente nella trascrizione di un role-play telefonico.
Criteri (peso uguale): 1) Ascolto e riconoscimento dell'obiezione (empatia, niente contro-attacco); 2) Riformulazione/isolamento dell'obiezione;
3) Valore concreto e quantificato (tempo richiesto minimo, beneficio economico chiaro); 4) Proposta di chiusura precisa (slot breve, data/ora, alternativa);
5) Tono e chiarezza (frasi brevi, sicurezza, niente gergo).
Sii concreto: cita frasi realmente dette dal consulente. Feedback in italiano, diretto, utile, max 3 punti per lista.

RISPONDI SOLO con JSON valido:
{{"score": <intero 0-100>, "summary": "<2 frasi di sintesi>", "what_worked": ["..."], "to_improve": ["..."], "best_line": "<la frase migliore del consulente o stringa vuota>", "suggested_answer": "<esempio di risposta ideale all'obiezione, 2-3 frasi>"}}"""


class CgymRoleplayStartIn(BaseModel):
    session_id: Optional[str] = None
    scenario: Literal["tempo"] = "tempo"
    voice: Optional[str] = None  # voce TTS (default onyx = cliente uomo)
    tts: bool = True


class CgymRoleplayTurnIn(BaseModel):
    audio_base64: Optional[str] = None
    mime: Optional[str] = "audio/m4a"
    text: Optional[str] = None  # fallback testuale (web senza microfono / test)
    tts: bool = True


def _cgym_rp_out(doc: dict) -> dict:
    d = {k: v for k, v in doc.items() if k != "_id"}
    for k in ("started_at", "finished_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].astimezone(timezone.utc).isoformat()
    for t in d.get("turns", []):
        if isinstance(t.get("at"), datetime):
            t["at"] = t["at"].astimezone(timezone.utc).isoformat()
    return d


def _cgym_llm_json(raw: str) -> dict:
    """Parser JSON tollerante (blocchi ```json, testo attorno)."""
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:]
    try:
        return _json_stdlib.loads(s)
    except Exception:
        pass
    m = re.search(r"\{.*\}", s, re.S)
    if m:
        try:
            return _json_stdlib.loads(m.group(0))
        except Exception:
            pass
    return {}


async def _cgym_llm(system: str, user_text: str, model: str = "claude-haiku-4-5") -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    chat = LlmChat(api_key=key, session_id=f"cgym-rp-{uuid.uuid4().hex[:8]}", system_message=system).with_model("anthropic", model)
    try:
        resp = await chat.send_message(UserMessage(text=user_text))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore LLM: {str(e)[:200]}")
    return (resp or "").strip()


def _cgym_transcript_text(turns: List[dict]) -> str:
    lines = []
    for t in turns:
        who = "CLIENTE" if t.get("role") == "cliente" else "CONSULENTE"
        lines.append(f"{who}: {t.get('text', '')}")
    return "\n".join(lines) if lines else "(nessun turno)"


async def _cgym_tts_b64(text: str, voice: Optional[str], user: dict) -> Optional[str]:
    """TTS via la funzione interna di AxonOS (`assistant_tts`). None se non disponibile."""
    try:
        r = await assistant_tts(AssistantTTSIn(text=text, voice=voice or "onyx"), user)
        return r.get("audio_base64")
    except Exception as e:
        logger.warning("cgym tts failed: %s", e)
        return None


async def _cgym_customer_turn(rp: dict, turn_no: int) -> dict:
    sc = CGYM_SCENARIOS[rp["scenario"]]
    system = CGYM_RP_TURN_SYSTEM.format(persona=sc["persona"], max_turns=CGYM_RP_MAX_TURNS, turn=turn_no)
    if turn_no == 0:
        user_text = f"{sc['opening_hint']}\nApri tu la conversazione con la tua obiezione (il consulente ha appena finito di presentarsi e proporre l'incontro)."
    else:
        user_text = f"TRASCRIZIONE FINORA:\n{_cgym_transcript_text(rp['turns'])}\n\nRispondi come il cliente all'ultima battuta del consulente."
    raw = await _cgym_llm(system, user_text, "claude-haiku-4-5")
    data = _cgym_llm_json(raw)
    reply = (data.get("reply") or "").strip() if isinstance(data, dict) else ""
    if not reply:
        reply = raw[:300] if raw else "Guardi, davvero, adesso non ho tempo. Mi richiami un'altra volta."
    mood = data.get("mood") if isinstance(data, dict) else None
    end = bool(data.get("end")) if isinstance(data, dict) else False
    if turn_no >= CGYM_RP_MAX_TURNS:
        end = True
    return {"reply": reply, "mood": mood if mood in ("chiuso", "scettico", "aperto", "convinto") else "scettico", "end": end}


async def _cgym_rp_get(roleplay_id: str, user: dict) -> dict:
    rp = await db.cgym_roleplays.find_one({"roleplay_id": roleplay_id, "user_id": user["user_id"]})
    if not rp:
        raise HTTPException(status_code=404, detail="Role-play non trovato")
    return rp


@api_router.post("/cgym/roleplay/start")
async def cgym_roleplay_start(body: CgymRoleplayStartIn, user=Depends(get_current_user)):
    """Avvia un role-play: crea il record e genera la battuta di apertura del cliente (testo + audio TTS)."""
    tid = tenant_id(user)
    session_id = body.session_id
    if session_id:
        s = await db.cgym_sessions.find_one({"session_id": session_id, "tenant_id": tid})
        if not s or s["user_id"] != user["user_id"]:
            raise HTTPException(status_code=404, detail="Sessione non trovata")
        await db.cgym_sessions.update_one({"session_id": session_id}, {"$set": {"status": "in_corso", "updated_at": utcnow()}})
    now = utcnow()
    rp = {
        "roleplay_id": str(uuid.uuid4()),
        "tenant_id": tid,
        "user_id": user["user_id"],
        "session_id": session_id,
        "scenario": body.scenario,
        "status": "active",
        "turns": [],
        "voice": body.voice or "onyx",
        "started_at": now,
        "finished_at": None,
        "score": None,
        "feedback": None,
    }
    first = await _cgym_customer_turn(rp, 0)
    rp["turns"].append({"role": "cliente", "text": first["reply"], "mood": first["mood"], "at": now})
    await db.cgym_roleplays.insert_one(rp)
    audio = await _cgym_tts_b64(first["reply"], rp["voice"], user) if body.tts else None
    return {
        "roleplay_id": rp["roleplay_id"],
        "scenario": body.scenario,
        "scenario_label": CGYM_SCENARIOS[body.scenario]["label"],
        "reply": first["reply"],
        "mood": first["mood"],
        "audio_base64": audio,
        "audio_mime": "audio/mpeg",
        "turn": 0,
        "max_turns": CGYM_RP_MAX_TURNS,
        "ended": False,
    }


@api_router.post("/cgym/roleplay/{roleplay_id}/turn")
async def cgym_roleplay_turn(roleplay_id: str, body: CgymRoleplayTurnIn, user=Depends(get_current_user)):
    """Turno del consulente (audio → STT interno, oppure testo) → risposta del cliente (LLM + TTS)."""
    rp = await _cgym_rp_get(roleplay_id, user)
    if rp.get("status") != "active":
        raise HTTPException(status_code=400, detail="Role-play già concluso")
    text = (body.text or "").strip()
    if not text and body.audio_base64:
        r = await ai_transcribe(AIVoiceIn(audio_base64=body.audio_base64, mime=body.mime or "audio/m4a"), user)
        text = (r.get("transcript") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Non ho capito la risposta: riprova parlando più vicino al microfono")
    now = utcnow()
    rp["turns"].append({"role": "consulente", "text": text, "at": now})
    turn_no = sum(1 for t in rp["turns"] if t["role"] == "consulente")
    cust = await _cgym_customer_turn(rp, turn_no)
    rp["turns"].append({"role": "cliente", "text": cust["reply"], "mood": cust["mood"], "at": utcnow()})
    await db.cgym_roleplays.update_one({"roleplay_id": roleplay_id}, {"$set": {"turns": rp["turns"]}})
    audio = await _cgym_tts_b64(cust["reply"], rp.get("voice"), user) if body.tts else None
    return {
        "transcript": text,
        "reply": cust["reply"],
        "mood": cust["mood"],
        "audio_base64": audio,
        "audio_mime": "audio/mpeg",
        "turn": turn_no,
        "max_turns": CGYM_RP_MAX_TURNS,
        "ended": cust["end"],
    }


@api_router.post("/cgym/roleplay/{roleplay_id}/finish")
async def cgym_roleplay_finish(roleplay_id: str, user=Depends(get_current_user)):
    """Chiude il role-play: valutazione LLM (score + feedback) e salvataggio in cgym_sessions."""
    rp = await _cgym_rp_get(roleplay_id, user)
    if rp.get("status") == "finished" and rp.get("feedback"):
        return _cgym_rp_out(rp)
    sc = CGYM_SCENARIOS[rp["scenario"]]
    n_cons = sum(1 for t in rp["turns"] if t["role"] == "consulente")
    if n_cons == 0:
        feedback = {"score": 0, "summary": "Nessuna risposta del consulente: il role-play è stato interrotto prima di iniziare.",
                    "what_worked": [], "to_improve": ["Rispondi almeno una volta all'obiezione del cliente per ottenere una valutazione."],
                    "best_line": "", "suggested_answer": ""}
    else:
        raw = await _cgym_llm(CGYM_RP_EVAL_SYSTEM.format(objection=sc["objection"]),
                              f"TRASCRIZIONE ROLE-PLAY ({sc['label']}):\n{_cgym_transcript_text(rp['turns'])}", "claude-sonnet-5")
        data = _cgym_llm_json(raw)
        try:
            score = int(round(float(data.get("score", 0))))
        except Exception:
            score = 0
        feedback = {
            "score": max(0, min(100, score)),
            "summary": str(data.get("summary") or "").strip() or raw[:400],
            "what_worked": [str(x) for x in (data.get("what_worked") or [])][:3],
            "to_improve": [str(x) for x in (data.get("to_improve") or [])][:3],
            "best_line": str(data.get("best_line") or "").strip(),
            "suggested_answer": str(data.get("suggested_answer") or "").strip(),
        }
    now = utcnow()
    upd = {"status": "finished", "finished_at": now, "score": feedback["score"], "feedback": feedback}
    await db.cgym_roleplays.update_one({"roleplay_id": roleplay_id}, {"$set": upd})
    rp.update(upd)
    # Salvataggio risultato in cgym_sessions (sessione collegata o nuova sessione completata)
    session_id = rp.get("session_id")
    sess_upd = {"status": "completata", "score": float(feedback["score"]), "completed_at": now, "updated_at": now,
                "roleplay_id": roleplay_id, "feedback": feedback}
    if session_id and await db.cgym_sessions.find_one({"session_id": session_id}):
        await db.cgym_sessions.update_one({"session_id": session_id}, {"$set": sess_upd})
    else:
        session_id = str(uuid.uuid4())
        await db.cgym_sessions.insert_one({
            "session_id": session_id, "tenant_id": rp["tenant_id"], "user_id": user["user_id"], "assigned_by": user["user_id"],
            "type": "obiezioni", "title": f"Role-play {sc['label']}", "scheduled_at": rp.get("started_at") or now,
            "mandatory": False, "created_at": now, **sess_upd,
        })
        await db.cgym_roleplays.update_one({"roleplay_id": roleplay_id}, {"$set": {"session_id": session_id}})
        rp["session_id"] = session_id
    return _cgym_rp_out(rp)


@api_router.get("/cgym/roleplay/{roleplay_id}")
async def cgym_roleplay_get(roleplay_id: str, user=Depends(get_current_user)):
    return _cgym_rp_out(await _cgym_rp_get(roleplay_id, user))
