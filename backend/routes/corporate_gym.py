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
    assigned_total, assigned_done = 0, 0  # Blocco 3 — sessioni assegnate dal Master (assigned_by != me)
    for r in rows:
        dt = _cgym_dt(r.get("scheduled_at"))
        done = r.get("status") == "completata"
        if r.get("assigned_by") and r.get("assigned_by") != user["user_id"]:
            assigned_total += 1
            if done:
                assigned_done += 1
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
        "assigned_total": assigned_total,
        "assigned_done": assigned_done,
        "assigned_pending": assigned_total - assigned_done,
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
CGYM_RP_MAX_TURNS = 5  # default turni del consulente (obiezioni) prima della chiusura forzata

# Blocco 5 — Scenari: obiezioni TEMPO / COSTO / DECISORE (area obiezioni, ~5 turni) e trattativa
# integrata WIN-WIN (area winwin, sessione vocale completa da 45 minuti, fino a 30 turni, a fasi).
CGYM_OBJ_RULES = (
    "- Valuta la risposta del consulente turno per turno: se gestisce bene l'obiezione (ascolta, riformula, dà valore concreto e "
    "quantificato, propone un prossimo passo preciso) il tuo \"mood\" migliora; altrimenti peggiora.\n"
    "- Chiudi la conversazione (end=true) quando: accetti il prossimo passo concreto proposto, OPPURE rifiuti definitivamente dopo "
    "risposte deboli, OPPURE hai raggiunto il turno {max_turns}."
)
CGYM_WW_RULES = (
    "- È una TRATTATIVA INTEGRATA (win-win) su un contratto di fornitura energia: le variabili sono prezzo, durata contratto, termini di "
    "pagamento, servizi (monitoraggio consumi, efficientamento, referente dedicato), penali/uscita, decorrenza. Hai INTERESSI NASCOSTI "
    "che riveli solo se il consulente fa domande e ascolta: stabilità del budget annuale, cassa (pagamento a 60 gg), immagine sostenibile "
    "verso i clienti, zero sorprese in bolletta.\n"
    "- Segui le FASI: 1 apertura e clima (0-5 min), 2 esplorazione bisogni (5-15), 3 proposta e creazione di opzioni (15-30), 4 scambio "
    "di concessioni (30-40), 5 accordo e prossimi passi (40-45). Fase attuale suggerita: {phase}. Minuti trascorsi: {elapsed}.\n"
    "- Chiedi concessioni (sconto, uscita libera) ma cedi qualcosa in cambio SOLO se il consulente scambia (non regala) e collega le "
    "concessioni ai tuoi interessi. Se il consulente regala sconti senza contropartita, chiedi di più. Se ignora i tuoi interessi o forza, "
    "il mood peggiora.\n"
    "- Chiudi (end=true) SOLO quando avete un accordo concreto su almeno prezzo, durata e pagamento, OPPURE quando i minuti trascorsi "
    "superano 45, OPPURE al turno {max_turns}. Non chiudere prima della fase 4 senza un motivo forte."
)

CGYM_SCENARIOS = {
    "tempo": {
        "area": "obiezioni", "label": "Obiezione TEMPO", "objection": "Non ho tempo", "max_turns": 5, "duration_min": 5, "voice": "onyx",
        "opening_hint": "Il consulente ha appena proposto un breve incontro/analisi della bolletta. Tu rispondi con l'obiezione del TEMPO: sei di fretta, non hai tempo, rimanda.",
        "persona": (
            "Sei Marco Bianchi, titolare di una piccola azienda (officina meccanica, 6 dipendenti) a Vicenza. "
            "Sei un cliente potenziale di un consulente energetico che ti ha contattato per proporti un'analisi delle bollette luce/gas. "
            "La tua obiezione principale è il TEMPO: sei sempre di corsa, hai già troppe cose da fare, rimandi. "
            "Sei educato ma sbrigativo. Non sei ostile: se il consulente riconosce il tuo problema, ti fa capire in modo concreto "
            "quanto poco tempo serve, quantifica il vantaggio e propone uno slot preciso e breve, puoi aprirti gradualmente e alla fine accettare. "
            "Se il consulente insiste, è generico, parla troppo o ignora la tua obiezione, resti chiuso e concludi la telefonata."
        ),
        "eval_criteria": (
            "1) Ascolto e riconoscimento dell'obiezione (empatia, niente contro-attacco); 2) Riformulazione/isolamento dell'obiezione; "
            "3) Valore concreto e quantificato (tempo richiesto minimo, beneficio economico chiaro); 4) Proposta di chiusura precisa (slot breve, data/ora, alternativa); "
            "5) Tono e chiarezza (frasi brevi, sicurezza, niente gergo)."
        ),
    },
    "costo": {
        "area": "obiezioni", "label": "Obiezione COSTO", "objection": "Costa troppo / il mio fornitore è più economico", "max_turns": 5, "duration_min": 5, "voice": "onyx",
        "opening_hint": "Il consulente ti ha appena presentato la proposta di fornitura/consulenza. Tu rispondi con l'obiezione del COSTO: è cara, il tuo fornitore attuale ti fa un prezzo migliore, vuoi uno sconto.",
        "persona": (
            "Sei Giuseppe Ferraro, titolare di un bar-pasticceria a Verona con bollette luce alte (forni e frigoriferi). "
            "Un consulente energetico ti ha presentato una proposta di cambio fornitura con servizio di analisi. "
            "La tua obiezione principale è il COSTO: ti sembra cara, il tuo fornitore attuale ti ha promesso un prezzo migliore, chiedi subito uno sconto. "
            "Sei un negoziatore istintivo: guardi solo il prezzo al kWh e diffidi dei 'costi nascosti'. "
            "Ti apri se il consulente sposta il confronto dal prezzo unitario al costo totale annuo, ti mostra il valore (garanzie, "
            "servizi, prevedibilità), chiede cosa confronti esattamente e ti dà numeri concreti. Ti chiudi se abbassa il prezzo subito senza "
            "spiegazioni (ti fa pensare che stesse gonfiando) o se svaluta il concorrente."
        ),
        "eval_criteria": (
            "1) Ascolto e comprensione di cosa il cliente confronta davvero (senza svalutare il concorrente); 2) Riformulazione dell'obiezione (prezzo vs costo totale/valore); "
            "3) Valore quantificato: costo annuo, garanzie, servizi, rischi evitati, numeri concreti; 4) Gestione dello sconto (niente sconti immediati, eventuale concessione in cambio di qualcosa) e prossimo passo preciso; "
            "5) Tono e sicurezza (calma, niente difensiva, frasi brevi)."
        ),
    },
    "decisore": {
        "area": "obiezioni", "label": "Obiezione DECISORE", "objection": "Devo parlarne con il socio / non decido io", "max_turns": 5, "duration_min": 5, "voice": "nova",
        "opening_hint": "Il consulente ha appena proposto di procedere. Tu rispondi con l'obiezione del DECISORE: non decidi da sola, devi parlarne con il socio/titolare/marito, richiamerai tu.",
        "persona": (
            "Sei Laura Conti, responsabile amministrativa di uno studio dentistico con tre sedi a Padova. "
            "Il consulente energetico ti ha fatto la proposta e ora ti chiede di procedere. "
            "La tua obiezione principale è il DECISORE: 'devo parlarne con il dottore/socio, non decido io', 'le faccio sapere'. "
            "In realtà hai una forte influenza sulla decisione ma non vuoi esporti; usi il socio anche come scudo per prendere tempo. "
            "Ti apri se il consulente rispetta il tuo ruolo, capisce come si decide davvero (chi, quando, con quali criteri), ti aiuta "
            "a presentare la proposta al decisore (materiale sintetico, numeri) e propone un incontro a tre o un passo concreto con data. "
            "Ti chiudi se ti scavalca ('mi dia il numero del dottore'), ti mette fretta o insiste per una decisione ora."
        ),
        "eval_criteria": (
            "1) Ascolto e rispetto del ruolo dell'interlocutore (niente scavalcamenti); 2) Domande per capire il processo decisionale reale (chi decide, quando, criteri) e riformulazione; "
            "3) Valore: rendere facile presentare la proposta al decisore (sintesi, numeri, materiali); 4) Chiusura: proposta concreta di incontro a tre / prossimo passo con data e ora; "
            "5) Tono: alleanza, niente pressione, frasi brevi e chiare."
        ),
    },
    "winwin": {
        "area": "winwin", "label": "Trattativa WIN-WIN", "objection": "Trattativa integrata contratto di fornitura energia", "max_turns": 30, "duration_min": 45, "voice": "nova",
        "opening_hint": "Sei al tavolo (videocall) con il consulente per la trattativa finale sul contratto di fornitura energia della tua azienda. Apri tu: saluta brevemente e metti subito sul tavolo la tua richiesta iniziale (prezzo più basso e uscita libera), senza rivelare i tuoi interessi nascosti.",
        "persona": (
            "Sei Elena Rossi, direttrice acquisti di una PMI con tre supermercati in Veneto (spesa energia ~180.000 €/anno). "
            "Stai negoziando con un consulente energetico il nuovo contratto di fornitura luce/gas per i tre punti vendita. "
            "Posizione dichiarata: vuoi il prezzo più basso possibile, contratto breve (12 mesi) e possibilità di uscita libera. "
            "Interessi reali (nascosti): budget annuale stabile senza sorprese (preferisci prezzo fisso), pagamento a 60 giorni per la cassa, "
            "un referente dedicato perché la precedente fornitura ha avuto bollette sbagliate, e una comunicazione 'energia verde' da usare "
            "con i clienti. Puoi accettare 24-36 mesi se hai garanzie e servizi. Sei professionale, preparata, ferma ma corretta: "
            "apprezzi chi fa domande, ascolta, crea opzioni e scambia concessioni; punisci chi regala sconti senza contropartita o forza la chiusura."
        ),
        "eval_criteria": (
            "1) Preparazione ed esplorazione degli interessi (domande aperte, ascolto, scoperta degli interessi nascosti: budget stabile, pagamento 60 gg, referente, energia verde); "
            "2) Creazione di valore (più opzioni/pacchetti, allargare la torta oltre il prezzo: durata, servizi, pagamento, green); "
            "3) Gestione delle concessioni (scambio condizionato 'se... allora', mai regali, ancoraggio e giustificazione delle richieste); "
            "4) Equilibrio e relazione (fermezza sui propri interessi, rispetto, gestione delle pressioni, niente cedimenti sul prezzo puro); "
            "5) Chiusura dell'accordo (sintesi dei punti, accordo concreto su prezzo/durata/pagamento, prossimi passi con date) e gestione del tempo nelle 5 fasi."
        ),
    },
}
CGYM_WW_PHASES = [(5, "1 · Apertura e clima"), (15, "2 · Esplorazione bisogni"), (30, "3 · Proposta e opzioni"), (40, "4 · Scambio concessioni"), (46, "5 · Accordo e prossimi passi")]


def _cgym_ww_phase(elapsed_min: float) -> str:
    for lim, name in CGYM_WW_PHASES:
        if elapsed_min < lim:
            return name
    return CGYM_WW_PHASES[-1][1]


CGYM_RP_TURN_SYSTEM = """{persona}

REGOLE DI RECITAZIONE:
- Parla SOLO come il cliente, in italiano, prima persona, tono naturale ({channel}). MAX {max_sentences} frasi brevi (parlato, non scritto).
- Resta nel personaggio: mai spiegare, mai dare consigli al consulente, mai uscire dal ruolo.
{rules}
- Turno attuale del consulente: {turn} di {max_turns}.

RISPONDI SOLO con JSON valido, senza testo attorno:
{{"reply": "<battuta del cliente>", "mood": "chiuso|scettico|aperto|convinto", "end": true|false}}"""

CGYM_RP_EVAL_SYSTEM = """Sei un formatore commerciale esperto nel settore energia (consulenti luce/gas B2B/B2C in Italia).
Valuta la prestazione del consulente nella trascrizione del role-play "{label}" (tema: {objection}).
Criteri (peso uguale): {criteria}
Sii concreto: cita frasi realmente dette dal consulente. Feedback in italiano, diretto, utile, max 3 punti per lista.

RISPONDI SOLO con JSON valido:
{{"score": <intero 0-100>, "summary": "<2 frasi di sintesi>", "what_worked": ["..."], "to_improve": ["..."], "best_line": "<la frase migliore del consulente o stringa vuota>", "suggested_answer": "<esempio di risposta ideale all'obiezione, 2-3 frasi>"}}"""


class CgymRoleplayStartIn(BaseModel):
    session_id: Optional[str] = None
    scenario: Literal["tempo", "costo", "decisore", "winwin"] = "tempo"
    voice: Optional[str] = None  # voce TTS (default: voce dello scenario)
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
    max_turns = sc.get("max_turns", CGYM_RP_MAX_TURNS)
    if sc["area"] == "winwin":
        started = _cgym_dt(rp.get("started_at")) or utcnow()
        elapsed = max(0.0, (utcnow() - started).total_seconds() / 60.0)
        rules = CGYM_WW_RULES.format(max_turns=max_turns, phase=_cgym_ww_phase(elapsed), elapsed=f"{elapsed:.0f}")
        channel, max_sentences = "videocall di trattativa", 4
    else:
        rules = CGYM_OBJ_RULES.format(max_turns=max_turns)
        channel, max_sentences = "telefonata", 2
    system = CGYM_RP_TURN_SYSTEM.format(persona=sc["persona"], rules=rules, channel=channel, max_sentences=max_sentences, max_turns=max_turns, turn=turn_no)
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
    if turn_no >= max_turns:
        end = True
    if sc["area"] == "winwin" and turn_no > 0:
        started = _cgym_dt(rp.get("started_at")) or utcnow()
        if (utcnow() - started).total_seconds() / 60.0 >= sc.get("duration_min", 45):
            end = True
    return {"reply": reply, "mood": mood if mood in ("chiuso", "scettico", "aperto", "convinto") else "scettico", "end": end}


async def _cgym_rp_get(roleplay_id: str, user: dict) -> dict:
    rp = await db.cgym_roleplays.find_one({"roleplay_id": roleplay_id, "user_id": user["user_id"]})
    if not rp:
        raise HTTPException(status_code=404, detail="Role-play non trovato")
    return rp


@api_router.get("/cgym/roleplay/scenarios")
async def cgym_roleplay_scenarios(user=Depends(get_current_user)):
    return {"items": [{"key": k, "label": v["label"], "area": v["area"], "objection": v["objection"], "max_turns": v.get("max_turns", CGYM_RP_MAX_TURNS), "duration_min": v.get("duration_min", 5)} for k, v in CGYM_SCENARIOS.items()]}


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
        "voice": body.voice or CGYM_SCENARIOS[body.scenario].get("voice", "onyx"),
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
        "area": CGYM_SCENARIOS[body.scenario]["area"],
        "duration_min": CGYM_SCENARIOS[body.scenario].get("duration_min", 5),
        "started_at": now.isoformat(),
        "reply": first["reply"],
        "mood": first["mood"],
        "audio_base64": audio,
        "audio_mime": "audio/mpeg",
        "turn": 0,
        "max_turns": CGYM_SCENARIOS[body.scenario].get("max_turns", CGYM_RP_MAX_TURNS),
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
        "max_turns": CGYM_SCENARIOS[rp["scenario"]].get("max_turns", CGYM_RP_MAX_TURNS),
        "phase": _cgym_ww_phase(((utcnow() - (_cgym_dt(rp.get("started_at")) or utcnow())).total_seconds()) / 60.0) if CGYM_SCENARIOS[rp["scenario"]]["area"] == "winwin" else None,
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
        raw = await _cgym_llm(CGYM_RP_EVAL_SYSTEM.format(label=sc["label"], objection=sc["objection"], criteria=sc["eval_criteria"]),
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
            "type": sc["area"], "title": f"Role-play {sc['label']}", "scheduled_at": rp.get("started_at") or now,
            "mandatory": False, "created_at": now, **sess_upd,
        })
        await db.cgym_roleplays.update_one({"roleplay_id": roleplay_id}, {"$set": {"session_id": session_id}})
        rp["session_id"] = session_id
    return _cgym_rp_out(rp)


@api_router.get("/cgym/roleplay/{roleplay_id}")
async def cgym_roleplay_get(roleplay_id: str, user=Depends(get_current_user)):
    return _cgym_rp_out(await _cgym_rp_get(roleplay_id, user))


# =========================================================================
# Blocco 3 — Assegnazioni Master (piani): agente o tutto il team, tipo, frequenza
# 1/2/3 al giorno, scadenza → genera le sessioni (obbligatorie) in cgym_sessions.
# Collection: cgym_assignments.
# =========================================================================
CGYM_SLOT_TIMES = {1: ["09:00"], 2: ["09:00", "15:00"], 3: ["09:00", "13:00", "17:00"]}
CGYM_ASSIGN_MAX_SESSIONS = 300


class CgymAssignmentIn(BaseModel):
    target: Literal["team", "users"] = "users"
    user_ids: List[str] = []
    type: Literal["obiezioni", "winwin"]
    per_day: int = 1  # 1..3
    due_date: str  # YYYY-MM-DD (Europe/Rome), inclusa
    title: Optional[str] = None
    mandatory: bool = True


def _cgym_assignment_out(doc: dict) -> dict:
    d = {k: v for k, v in doc.items() if k != "_id"}
    for k in ("created_at", "updated_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].astimezone(timezone.utc).isoformat()
    return d


@api_router.post("/cgym/assignments")
async def cgym_create_assignment(body: CgymAssignmentIn, user=Depends(get_current_user)):
    """Master: crea un piano di assegnazione e genera le sessioni per ogni collaboratore/giorno/slot."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    tid = tenant_id(user)
    per_day = int(body.per_day)
    if per_day not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Frequenza: 1, 2 o 3 sessioni al giorno")
    try:
        due = datetime.strptime(body.due_date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(status_code=400, detail="Data di scadenza non valida (YYYY-MM-DD)")
    today = utcnow().astimezone(_CGYM_TZ).date()
    if due < today:
        raise HTTPException(status_code=400, detail="La scadenza deve essere oggi o futura")
    members = await db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
                                  {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(2000)
    by_id = {m["user_id"]: m for m in members}
    if body.target == "team":
        targets = [m["user_id"] for m in members if m["user_id"] != user["user_id"]] or [user["user_id"]]
    else:
        targets = [u for u in dict.fromkeys(body.user_ids) if u in by_id]
        if not targets:
            raise HTTPException(status_code=400, detail="Seleziona almeno un collaboratore del team")
    days = (due - today).days + 1
    total = len(targets) * days * per_day
    if total > CGYM_ASSIGN_MAX_SESSIONS:
        raise HTTPException(status_code=400, detail=f"Troppe sessioni ({total}): riduci scadenza, frequenza o destinatari (max {CGYM_ASSIGN_MAX_SESSIONS})")
    now = utcnow()
    label = "Gym Obiezioni" if body.type == "obiezioni" else "Gym WIN-WIN"
    title = (body.title or "").strip() or label
    assignment_id = str(uuid.uuid4())
    docs = []
    for uid in targets:
        for d in range(days):
            day = today + timedelta(days=d)
            for hhmm in CGYM_SLOT_TIMES[per_day]:
                hh, mm = hhmm.split(":")
                local = datetime(day.year, day.month, day.day, int(hh), int(mm), tzinfo=_CGYM_TZ)
                docs.append({
                    "session_id": str(uuid.uuid4()), "tenant_id": tid, "user_id": uid, "assigned_by": user["user_id"],
                    "assignment_id": assignment_id, "type": body.type, "title": title,
                    "scheduled_at": local.astimezone(timezone.utc), "status": "assegnata", "mandatory": bool(body.mandatory),
                    "score": None, "created_at": now, "updated_at": now, "completed_at": None,
                })
    if docs:
        await db.cgym_sessions.insert_many(docs)
    plan = {
        "assignment_id": assignment_id, "tenant_id": tid, "created_by": user["user_id"], "target": body.target,
        "user_ids": targets, "user_names": [by_id[u].get("name") or by_id[u].get("email") or u for u in targets],
        "type": body.type, "title": title, "per_day": per_day, "due_date": body.due_date, "mandatory": bool(body.mandatory),
        "sessions_total": len(docs), "created_at": now, "updated_at": now,
    }
    await db.cgym_assignments.insert_one(plan)
    out = _cgym_assignment_out(plan)
    out["sessions_done"] = 0
    return out


@api_router.get("/cgym/assignments")
async def cgym_list_assignments(user=Depends(get_current_user)):
    """Master: piani del tenant con avanzamento (completate/totali, anche per collaboratore)."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    tid = tenant_id(user)
    plans = await db.cgym_assignments.find({"tenant_id": tid}).sort("created_at", -1).to_list(200)
    if not plans:
        return {"items": []}
    ids = [p["assignment_id"] for p in plans]
    rows = await db.cgym_sessions.find({"tenant_id": tid, "assignment_id": {"$in": ids}},
                                       {"_id": 0, "assignment_id": 1, "user_id": 1, "status": 1}).to_list(20000)
    prog: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        a = prog.setdefault(r["assignment_id"], {"total": 0, "done": 0, "per_user": {}})
        a["total"] += 1
        pu = a["per_user"].setdefault(r["user_id"], {"total": 0, "done": 0})
        pu["total"] += 1
        if r.get("status") == "completata":
            a["done"] += 1
            pu["done"] += 1
    out = []
    for p in plans:
        o = _cgym_assignment_out(p)
        a = prog.get(p["assignment_id"], {"total": 0, "done": 0, "per_user": {}})
        o["sessions_total"] = a["total"]
        o["sessions_done"] = a["done"]
        o["per_user"] = [{"user_id": u, "name": n, **a["per_user"].get(u, {"total": 0, "done": 0})}
                         for u, n in zip(p.get("user_ids", []), p.get("user_names", []))]
        o["overdue"] = p.get("due_date", "") < utcnow().astimezone(_CGYM_TZ).date().isoformat() and a["done"] < a["total"]
        out.append(o)
    return {"items": out}


@api_router.delete("/cgym/assignments/{assignment_id}")
async def cgym_delete_assignment(assignment_id: str, user=Depends(get_current_user)):
    """Master: elimina il piano e le sue sessioni NON completate (le completate restano nello storico)."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    tid = tenant_id(user)
    plan = await db.cgym_assignments.find_one({"assignment_id": assignment_id, "tenant_id": tid})
    if not plan:
        raise HTTPException(status_code=404, detail="Piano non trovato")
    res = await db.cgym_sessions.delete_many({"tenant_id": tid, "assignment_id": assignment_id, "status": {"$ne": "completata"}})
    await db.cgym_assignments.delete_one({"assignment_id": assignment_id})
    return {"ok": True, "deleted_sessions": res.deleted_count}


# =========================================================================
# Blocco 4 — Dashboard statistiche Master (solo Titolare/Admin)
# Aggrega cgym_sessions + cgym_roleplays: score per agente nel tempo, completate vs
# assegnate, aree di forza/debolezza (classificazione feedback per criterio), confronto,
# trend. AxonOS (LLM) genera feedback personale per agente e report settimanale
# (lacune team, nuovi scenari, aggiornamenti manuale vendite). Cache: cgym_ai_reports.
# =========================================================================
CGYM_CRITERIA = {
    "ascolto": {"label": "Ascolto ed empatia", "kw": ["ascolt", "empat", "riconosc", "comprens", "capisco", "valid", "accogl"]},
    "riformulazione": {"label": "Riformulazione", "kw": ["riformul", "isol", "parafras", "ripet", "chiarif", "domand"]},
    "valore": {"label": "Valore e numeri", "kw": ["quantific", "numer", "benefic", "rispar", "valor", "concret", "euro", "€", "tempo richiesto", "minuti", "dati"]},
    "chiusura": {"label": "Chiusura e appuntamento", "kw": ["chius", "appuntament", "slot", "propost", "data", "orario", "alternativ", "prossimo passo", "giovedì", "venerdì"]},
    "tono": {"label": "Tono e chiarezza", "kw": ["tono", "chiar", "sicur", "brev", "gergo", "lung", "prolisso", "frasi", "ritmo", "energia", "insist", "pression"]},
}


def _cgym_classify(text: str) -> Optional[str]:
    t = (text or "").lower()
    best, score = None, 0
    for key, c in CGYM_CRITERIA.items():
        n = sum(1 for k in c["kw"] if k in t)
        if n > score:
            best, score = key, n
    return best


def _cgym_week_key(dt: datetime) -> str:
    y, w, _ = dt.astimezone(_CGYM_TZ).isocalendar()
    return f"{y}-W{w:02d}"


async def _cgym_build_stats(tid: str, days: int) -> dict:
    now = utcnow()
    since = now - timedelta(days=days)
    members = await db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
                                  {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1}).to_list(2000)
    sessions = await db.cgym_sessions.find({"tenant_id": tid}).to_list(20000)
    roleplays = await db.cgym_roleplays.find({"tenant_id": tid, "status": "finished"}).to_list(20000)
    agents: Dict[str, Dict[str, Any]] = {}
    for m in members:
        agents[m["user_id"]] = {
            "user_id": m["user_id"], "name": m.get("name") or m.get("email") or m["user_id"], "role": m.get("role"),
            "assigned_total": 0, "assigned_done": 0, "self_total": 0, "completed_total": 0, "overdue": 0,
            "scores": [], "timeline": [], "strengths": {}, "weaknesses": {}, "convinto": 0, "roleplays": 0,
            "by_type": {"obiezioni": {"total": 0, "done": 0}, "winwin": {"total": 0, "done": 0}},
        }
    for s in sessions:
        a = agents.get(s["user_id"])
        if not a:
            continue
        created = _cgym_dt(s.get("created_at")) or now
        if created < since and s.get("status") != "completata":
            pass  # le assegnate vecchie contano comunque come pendenti
        elif created < since:
            continue
        done = s.get("status") == "completata"
        assigned_by_other = s.get("assigned_by") and s.get("assigned_by") != s["user_id"]
        if assigned_by_other:
            a["assigned_total"] += 1
            if done:
                a["assigned_done"] += 1
        else:
            a["self_total"] += 1
        if done:
            a["completed_total"] += 1
        bt = a["by_type"].setdefault(s.get("type", "obiezioni"), {"total": 0, "done": 0})
        bt["total"] += 1
        if done:
            bt["done"] += 1
        dt = _cgym_dt(s.get("scheduled_at"))
        if not done and dt and dt < now:
            a["overdue"] += 1
        if done and isinstance(s.get("score"), (int, float)):
            when = _cgym_dt(s.get("completed_at")) or created
            a["scores"].append((when, float(s["score"])))
    for rp in roleplays:
        a = agents.get(rp["user_id"])
        if not a:
            continue
        fin = _cgym_dt(rp.get("finished_at")) or now
        if fin < since:
            continue
        a["roleplays"] += 1
        fb = rp.get("feedback") or {}
        for t in fb.get("what_worked") or []:
            k = _cgym_classify(t)
            if k:
                a["strengths"][k] = a["strengths"].get(k, 0) + 1
        for t in fb.get("to_improve") or []:
            k = _cgym_classify(t)
            if k:
                a["weaknesses"][k] = a["weaknesses"].get(k, 0) + 1
        moods = [t.get("mood") for t in rp.get("turns", []) if t.get("role") == "cliente"]
        if moods and moods[-1] == "convinto":
            a["convinto"] += 1
    out_agents = []
    team_scores: List[float] = []
    weekly: Dict[str, List[float]] = {}
    for a in agents.values():
        a["scores"].sort(key=lambda x: x[0])
        vals = [v for _, v in a["scores"]]
        a["timeline"] = [{"date": w.astimezone(_CGYM_TZ).strftime("%d/%m"), "at": w.isoformat(), "score": v} for w, v in a["scores"]][-30:]
        for w, v in a["scores"]:
            weekly.setdefault(_cgym_week_key(w), []).append(v)
        team_scores.extend(vals)
        a["avg_score"] = round(sum(vals) / len(vals), 1) if vals else None
        a["last_score"] = vals[-1] if vals else None
        a["best_score"] = max(vals) if vals else None
        if len(vals) >= 2:
            head = vals[: max(1, len(vals) // 3)]
            tail = vals[-max(1, len(vals) // 3):]
            a["trend"] = round(sum(tail) / len(tail) - sum(head) / len(head), 1)
        else:
            a["trend"] = None
        a["completion_rate"] = round(a["assigned_done"] / a["assigned_total"], 3) if a["assigned_total"] else None
        a["convinto_rate"] = round(a["convinto"] / a["roleplays"], 3) if a["roleplays"] else None
        a["strengths"] = [{"key": k, "label": CGYM_CRITERIA[k]["label"], "count": n} for k, n in sorted(a["strengths"].items(), key=lambda x: -x[1])][:3]
        a["weaknesses"] = [{"key": k, "label": CGYM_CRITERIA[k]["label"], "count": n} for k, n in sorted(a["weaknesses"].items(), key=lambda x: -x[1])][:3]
        del a["scores"]
        out_agents.append(a)
    out_agents.sort(key=lambda x: (-(x["avg_score"] or -1), x["name"].lower()))
    for i, a in enumerate(out_agents):
        a["rank"] = i + 1
    weekly_series = [{"week": k, "avg": round(sum(v) / len(v), 1), "n": len(v)} for k, v in sorted(weekly.items())][-12:]
    team_weak: Dict[str, int] = {}
    team_strong: Dict[str, int] = {}
    for a in out_agents:
        for w in a["weaknesses"]:
            team_weak[w["key"]] = team_weak.get(w["key"], 0) + w["count"]
        for s_ in a["strengths"]:
            team_strong[s_["key"]] = team_strong.get(s_["key"], 0) + s_["count"]
    assigned_total = sum(a["assigned_total"] for a in out_agents)
    assigned_done = sum(a["assigned_done"] for a in out_agents)
    return {
        "days": days,
        "generated_at": now.isoformat(),
        "team": {
            "agents": len(out_agents),
            "active_agents": sum(1 for a in out_agents if a["completed_total"] > 0),
            "assigned_total": assigned_total,
            "assigned_done": assigned_done,
            "completion_rate": round(assigned_done / assigned_total, 3) if assigned_total else None,
            "completed_total": sum(a["completed_total"] for a in out_agents),
            "overdue": sum(a["overdue"] for a in out_agents),
            "avg_score": round(sum(team_scores) / len(team_scores), 1) if team_scores else None,
            "roleplays": sum(a["roleplays"] for a in out_agents),
            "weekly": weekly_series,
            "weaknesses": [{"key": k, "label": CGYM_CRITERIA[k]["label"], "count": n} for k, n in sorted(team_weak.items(), key=lambda x: -x[1])][:3],
            "strengths": [{"key": k, "label": CGYM_CRITERIA[k]["label"], "count": n} for k, n in sorted(team_strong.items(), key=lambda x: -x[1])][:3],
        },
        "agents": out_agents,
    }


@api_router.get("/cgym/stats")
async def cgym_stats(days: int = 30, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    days = max(7, min(365, int(days)))
    return await _cgym_build_stats(tenant_id(user), days)


CGYM_AGENT_FEEDBACK_SYSTEM = """Sei AxonOS, coach commerciale del settore energia (consulenti luce/gas in Italia). Analizzi i dati di allenamento
di UN agente nella Corporate Gym e scrivi un feedback personale, concreto e motivante, in italiano, rivolto al Master ma leggibile dall'agente.
Basati SOLO sui dati forniti (statistiche + estratti dei role-play). Se i dati sono pochi dillo e resta prudente.
RISPONDI SOLO con JSON valido:
{{"character": "<profilo comunicativo dell'agente in 1-2 frasi: stile, punti di carattere emersi>",
 "where_to_improve": ["<max 3 punti concreti, citando frasi reali se disponibili>"],
 "corrective_actions": ["<max 3 azioni pratiche per la prossima settimana, misurabili>"],
 "strengths": ["<max 3 punti di forza da consolidare>"],
 "encouragement": "<2 frasi di incoraggiamento personalizzate, senza retorica>",
 "suggested_focus": "<il criterio su cui concentrarsi: ascolto|riformulazione|valore|chiusura|tono>"}}"""

CGYM_WEEKLY_REPORT_SYSTEM = """Sei AxonOS, direttore formazione di una rete di consulenti energetici (Italia). Prepari per il Master il REPORT SETTIMANALE
della Corporate Gym partendo dalle statistiche del team e dagli estratti dei role-play. Sii concreto, operativo e sintetico, in italiano.
RISPONDI SOLO con JSON valido:
{{"headline": "<1 frase che riassume la settimana>",
 "team_gaps": ["<max 4 lacune del team, con evidenza numerica dove possibile>"],
 "highlights": ["<max 3 cose che vanno bene / agenti da lodare>"],
 "agents_to_watch": ["<max 3 agenti che richiedono attenzione e perché>"],
 "new_scenarios": [{{"title": "<nome scenario role-play>", "objection": "<obiezione o situazione>", "why": "<perché serve al team>"}}],
 "manual_updates": ["<max 4 aggiornamenti/aggiunte proposte al manuale vendite (frasi-chiave, script, regole)>"],
 "next_week_plan": "<proposta di assegnazione per la prossima settimana: chi, cosa, frequenza>"}}"""


def _cgym_agent_excerpts(rps: List[dict], limit: int = 4) -> str:
    parts = []
    for rp in rps[:limit]:
        fb = rp.get("feedback") or {}
        cons = [t["text"] for t in rp.get("turns", []) if t.get("role") == "consulente"][:3]
        parts.append(
            f"- Role-play {rp.get('scenario')} del {(_cgym_dt(rp.get('finished_at')) or utcnow()).astimezone(_CGYM_TZ).strftime('%d/%m')} — score {rp.get('score')}: "
            f"sintesi: {fb.get('summary', '')} | ha funzionato: {'; '.join(fb.get('what_worked') or [])} | da migliorare: {'; '.join(fb.get('to_improve') or [])} | "
            f"frasi del consulente: " + " / ".join(f'"{c[:160]}"' for c in cons)
        )
    return "\n".join(parts) if parts else "(nessun role-play concluso)"


@api_router.post("/cgym/stats/agent-feedback/{agent_id}")
async def cgym_agent_feedback(agent_id: str, force: bool = False, days: int = 30, user=Depends(get_current_user)):
    """Feedback personale AxonOS per un agente (cache 24h in cgym_ai_reports; force=true rigenera)."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    tid = tenant_id(user)
    if not force:
        cached = await db.cgym_ai_reports.find_one({"tenant_id": tid, "kind": "agent", "user_id": agent_id}, sort=[("generated_at", -1)])
        if cached and (utcnow() - (_cgym_dt(cached.get("generated_at")) or utcnow())) < timedelta(hours=24):
            return _cgym_report_out(cached)
    stats = await _cgym_build_stats(tid, max(7, min(365, days)))
    agent = next((a for a in stats["agents"] if a["user_id"] == agent_id), None)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente non trovato")
    rps = await db.cgym_roleplays.find({"tenant_id": tid, "user_id": agent_id, "status": "finished"}).sort("finished_at", -1).to_list(6)
    data_txt = (
        f"AGENTE: {agent['name']} (ruolo {agent.get('role')})\n"
        f"Periodo: ultimi {stats['days']} giorni. Sessioni completate: {agent['completed_total']}; assegnate dal Master: {agent['assigned_done']}/{agent['assigned_total']}; "
        f"in ritardo: {agent['overdue']}; role-play conclusi: {agent['roleplays']}; media score: {agent['avg_score']}; ultimo: {agent['last_score']}; "
        f"migliore: {agent['best_score']}; trend (fine vs inizio periodo): {agent['trend']}; clienti convinti: {agent['convinto_rate']}.\n"
        f"Punti di forza rilevati: {', '.join(s['label'] for s in agent['strengths']) or '-'}. Debolezze rilevate: {', '.join(w['label'] for w in agent['weaknesses']) or '-'}.\n"
        f"Media team: {stats['team']['avg_score']}; posizione in classifica: {agent['rank']}/{len(stats['agents'])}.\n"
        f"ESTRATTI ROLE-PLAY:\n{_cgym_agent_excerpts(rps)}"
    )
    raw = await _cgym_llm(CGYM_AGENT_FEEDBACK_SYSTEM, data_txt, "claude-sonnet-5")
    content = _cgym_llm_json(raw) or {"character": "", "where_to_improve": [], "corrective_actions": [], "strengths": [], "encouragement": raw[:400], "suggested_focus": ""}
    doc = {"report_id": str(uuid.uuid4()), "tenant_id": tid, "kind": "agent", "user_id": agent_id, "agent_name": agent["name"],
           "generated_at": utcnow(), "generated_by": user["user_id"], "days": stats["days"], "content": content,
           "snapshot": {k: agent[k] for k in ("avg_score", "last_score", "trend", "completed_total", "assigned_total", "assigned_done", "roleplays")}}
    await db.cgym_ai_reports.insert_one(doc)
    return _cgym_report_out(doc)


def _cgym_report_out(doc: dict) -> dict:
    d = {k: v for k, v in doc.items() if k != "_id"}
    if isinstance(d.get("generated_at"), datetime):
        d["generated_at"] = d["generated_at"].astimezone(timezone.utc).isoformat()
    return d


@api_router.get("/cgym/stats/agent-feedback/{agent_id}")
async def cgym_agent_feedback_get(agent_id: str, user=Depends(get_current_user)):
    """Ultimo feedback AxonOS salvato per l'agente (Master; l'agente stesso può leggere il proprio)."""
    tid = tenant_id(user)
    if not is_admin_or_owner(user) and user["user_id"] != agent_id:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    cached = await db.cgym_ai_reports.find_one({"tenant_id": tid, "kind": "agent", "user_id": agent_id}, sort=[("generated_at", -1)])
    return _cgym_report_out(cached) if cached else {"content": None}


@api_router.post("/cgym/stats/weekly-report")
async def cgym_weekly_report(force: bool = False, user=Depends(get_current_user)):
    """Report settimanale AxonOS per il Master (cache per settimana ISO; force=true rigenera)."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    tid = tenant_id(user)
    week = _cgym_week_key(utcnow())
    if not force:
        cached = await db.cgym_ai_reports.find_one({"tenant_id": tid, "kind": "weekly", "week": week}, sort=[("generated_at", -1)])
        if cached:
            return _cgym_report_out(cached)
    stats = await _cgym_build_stats(tid, 7)
    stats30 = await _cgym_build_stats(tid, 30)
    rps = await db.cgym_roleplays.find({"tenant_id": tid, "status": "finished", "finished_at": {"$gte": utcnow() - timedelta(days=7)}}).sort("finished_at", -1).to_list(12)
    t = stats["team"]
    weak_txt = ", ".join(f"{w['label']} x{w['count']}" for w in t["weaknesses"])
    weekly_txt = ", ".join(f"{w['week']}={w['avg']}" for w in stats30["team"]["weekly"])
    agents_txt = "\n".join(
        f"- {a['name']}: completate {a['completed_total']} (assegnate {a['assigned_done']}/{a['assigned_total']}, in ritardo {a['overdue']}), "
        f"media {a['avg_score']}, trend {a['trend']}, forza: {', '.join(s['label'] for s in a['strengths']) or '-'}, debolezze: {', '.join(w['label'] for w in a['weaknesses']) or '-'}"
        for a in stats30["agents"]
    )
    data_txt = (
        f"SETTIMANA {week}. Team: {t['agents']} agenti ({t['active_agents']} attivi). Sessioni completate: {t['completed_total']}; assegnate dal Master completate "
        f"{t['assigned_done']}/{t['assigned_total']} (tasso {t['completion_rate']}); in ritardo: {t['overdue']}; role-play: {t['roleplays']}; media score: {t['avg_score']}.\n"
        f"Debolezze team (frequenza): {weak_txt or '-'}. Forze team: {', '.join(s['label'] for s in t['strengths']) or '-'}.\n"
        f"Andamento medio settimanale (ultimi 30 gg): {weekly_txt or '-'}.\n"
        f"AGENTI (30 gg):\n{agents_txt or '(nessun agente)'}\n"
        f"Scenari disponibili oggi: {', '.join(v['label'] for v in CGYM_SCENARIOS.values())} (role-play vocali). Aree Gym: Obiezioni, WIN-WIN.\n"
        f"ESTRATTI ROLE-PLAY DELLA SETTIMANA:\n{_cgym_agent_excerpts(rps, limit=6)}"
    )
    raw = await _cgym_llm(CGYM_WEEKLY_REPORT_SYSTEM, data_txt, "claude-sonnet-5")
    content = _cgym_llm_json(raw) or {"headline": raw[:200], "team_gaps": [], "highlights": [], "agents_to_watch": [], "new_scenarios": [], "manual_updates": [], "next_week_plan": ""}
    doc = {"report_id": str(uuid.uuid4()), "tenant_id": tid, "kind": "weekly", "week": week, "generated_at": utcnow(),
           "generated_by": user["user_id"], "content": content, "snapshot": {k: t[k] for k in ("agents", "completed_total", "assigned_done", "assigned_total", "avg_score", "overdue")}}
    await db.cgym_ai_reports.insert_one(doc)
    return _cgym_report_out(doc)


@api_router.get("/cgym/stats/weekly-report")
async def cgym_weekly_report_get(user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    cached = await db.cgym_ai_reports.find_one({"tenant_id": tenant_id(user), "kind": "weekly"}, sort=[("generated_at", -1)])
    return _cgym_report_out(cached) if cached else {"content": None}
