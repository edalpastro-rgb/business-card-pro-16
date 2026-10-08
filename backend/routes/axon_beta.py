# axon_beta.py — V50.z474 — «Beta sul campo»: eventi d'uso, sondaggio NPS in-app, cruscotto 10 metriche nel Pannello Master — ISOLATO
#
# • POST /beta/event {name, meta}            → db.beta_events (nomi whitelist; app_open dedup 1/giorno). Tracciati dall'app: app_open,
#                                              pun_history, scanner, voice_message, stt_error, nps_shown.
# • GET  /beta/nps/status                     → {show, wave, ask_price} (ondata attiva impostata dal Master e non ancora risposta dall'utente)
# • POST /beta/nps {wave, score, would_recommend, price_tier, best, worst}  → db.beta_nps (una risposta per utente/ondata)
# • POST /admin/beta/nps-wave {wave, active, ask_price}  (Master) → db.beta_config {_id: tenant}
# • GET  /admin/beta/dashboard?days=42        (Master = proprio tenant; Super Master = tutti) → 10 metriche del piano MERCATO_E_BETA.md
#   con value/target/status (ok|warn|ko|nd) e dettaglio; fonti: onboarding_progress, assistant_messages, beta_events, ai_teach_rules,
#   axon_watchdog_log, support_tickets, contacts, appointments, call_transcripts, axon_emergency_plans, master_files, beta_nps.

_BETA_EVENTS = {"app_open", "pun_history", "scanner", "voice_message", "stt_error", "nps_shown", "transcript", "emergency", "axon_appointment"}


class BetaEventIn(BaseModel):
    name: str
    meta: Optional[Dict[str, Any]] = None


class BetaNpsIn(BaseModel):
    wave: int = 1
    score: int
    would_recommend: Optional[bool] = None
    price_tier: Optional[int] = None  # 0 = non pagherei · 19 · 29 · 49
    best: Optional[str] = None
    worst: Optional[str] = None


class BetaWaveIn(BaseModel):
    wave: int = 1
    active: bool = True
    ask_price: bool = False


def _beta_scope(user: dict) -> dict:
    """Super Master → tutti; Master/consulente → il proprio tenant."""
    return {} if user.get("super_admin") is True else {"tenant_id": tenant_id(user)}


@api_router.post("/beta/event")
async def beta_event(body: BetaEventIn, user=Depends(get_current_user)):
    name = (body.name or "").strip()
    if name not in _BETA_EVENTS:
        raise HTTPException(status_code=400, detail="Evento non riconosciuto")
    now = utcnow()
    if name == "app_open":  # 1 per giorno per utente
        day = now.strftime("%Y-%m-%d")
        await db.beta_events.update_one({"user_id": user["user_id"], "name": "app_open", "day": day}, {"$setOnInsert": {"user_id": user["user_id"], "tenant_id": tenant_id(user), "name": "app_open", "day": day, "at": now}}, upsert=True)
        return {"ok": True}
    doc = {"user_id": user["user_id"], "tenant_id": tenant_id(user), "name": name, "at": now, "day": now.strftime("%Y-%m-%d")}
    if body.meta:
        doc["meta"] = {k: v for k, v in list(body.meta.items())[:10] if isinstance(v, (str, int, float, bool))}
    await db.beta_events.insert_one(doc)
    return {"ok": True}


@api_router.get("/beta/nps/status")
async def beta_nps_status(user=Depends(get_current_user)):
    cfg = await db.beta_config.find_one({"_id": tenant_id(user)}) or {}
    wave = int(cfg.get("wave") or 1)
    if not cfg.get("active"):
        return {"show": False, "wave": wave, "ask_price": bool(cfg.get("ask_price"))}
    done = await db.beta_nps.find_one({"user_id": user["user_id"], "wave": wave}, {"_id": 1})
    return {"show": done is None, "wave": wave, "ask_price": bool(cfg.get("ask_price"))}


@api_router.post("/beta/nps")
async def beta_nps(body: BetaNpsIn, user=Depends(get_current_user)):
    if not 0 <= body.score <= 10:
        raise HTTPException(status_code=400, detail="Punteggio 0-10")
    if body.price_tier is not None and body.price_tier not in (0, 19, 29, 49):
        raise HTTPException(status_code=400, detail="Fascia prezzo non valida")
    doc = {"user_id": user["user_id"], "tenant_id": tenant_id(user), "user_email": user.get("email"), "user_name": user.get("name"), "wave": int(body.wave or 1), "score": int(body.score),
           "would_recommend": body.would_recommend, "price_tier": body.price_tier, "best": (body.best or "").strip()[:600], "worst": (body.worst or "").strip()[:600], "at": utcnow()}
    await db.beta_nps.update_one({"user_id": user["user_id"], "wave": doc["wave"]}, {"$set": doc}, upsert=True)
    return {"ok": True, "message": "Grazie! Il tuo parere guida le prossime versioni."}


@api_router.post("/admin/beta/nps-wave")
async def beta_wave(body: BetaWaveIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    await db.beta_config.update_one({"_id": tenant_id(user)}, {"$set": {"wave": max(1, int(body.wave)), "active": bool(body.active), "ask_price": bool(body.ask_price), "updated_at": utcnow(), "by": user["user_id"]}}, upsert=True)
    return {"ok": True}


def _beta_status(value: Optional[float], target: float, higher_is_better: bool = True, warn_ratio: float = 0.8) -> str:
    if value is None:
        return "nd"
    if higher_is_better:
        return "ok" if value >= target else "warn" if value >= target * warn_ratio else "ko"
    return "ok" if value <= target else "warn" if value <= target / warn_ratio else "ko"


async def _beta_count(coll, q: dict) -> int:
    return await getattr(db, coll).count_documents(q)


@api_router.get("/admin/beta/dashboard")
async def beta_dashboard(days: int = 42, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    days = max(7, min(days, 180))
    since = utcnow() - timedelta(days=days)
    weeks = max(1.0, days / 7.0)
    scope = _beta_scope(user)
    # utenti beta = utenti del tenant (o tutti) con ruolo attivo
    uq: dict = {} if not scope else {"$or": [{"user_id": scope["tenant_id"]}, {"parent_user_id": scope["tenant_id"]}]}
    users = await db.users.find(uq, {"_id": 0, "user_id": 1, "created_at": 1, "email": 1, "name": 1}).to_list(2000)
    uids = [u["user_id"] for u in users]
    n_users = len(uids) or 1
    in_users = {"user_id": {"$in": uids}}
    metrics: List[dict] = []

    # 1 — Attivazione onboarding entro 48 h
    prog = await db.onboarding_progress.find(in_users, {"_id": 0, "user_id": 1, "registered_at": 1, "completed_at": 1, "completed": 1}).to_list(2000)
    act = 0
    for p in prog:
        ra, ca = p.get("registered_at"), p.get("completed_at")
        if p.get("completed") and isinstance(ra, datetime) and isinstance(ca, datetime) and (ca - ra) <= timedelta(hours=48):
            act += 1
    v1 = round(100 * act / max(1, len(prog)), 0) if prog else None
    metrics.append({"key": "activation", "label": "Attivazione onboarding ≤ 48 h", "value": v1, "unit": "%", "target": 80, "status": _beta_status(v1, 80), "detail": f"{act}/{len(prog)} consulenti con i 3 checkpoint completati entro 48 h dalla registrazione"})

    # 2 — Giorni attivi/settimana (app_open + messaggi Axon + contatti/appuntamenti creati)
    active_days: Dict[str, set] = {}
    async for e in db.beta_events.find({**in_users, "name": "app_open", "at": {"$gte": since}}, {"_id": 0, "user_id": 1, "day": 1}):
        active_days.setdefault(e["user_id"], set()).add(e["day"])
    for coll, field in (("assistant_messages", "created_at"), ("contacts", "created_at"), ("appointments", "created_at")):
        q = {**in_users, field: {"$gte": since}} if coll != "assistant_messages" else {**in_users, "role": "user", field: {"$gte": since}}
        async for d in getattr(db, coll).find(q, {"_id": 0, "user_id": 1, field: 1}):
            dt = d.get(field)
            if isinstance(dt, datetime):
                active_days.setdefault(d["user_id"], set()).add(dt.strftime("%Y-%m-%d"))
    per_week = [len(v) / weeks for v in active_days.values()]
    share3 = round(100 * sum(1 for x in per_week if x >= 3) / n_users, 0) if active_days else None
    metrics.append({"key": "dau", "label": "≥ 3 giorni attivi/settimana", "value": share3, "unit": "% utenti", "target": 70, "status": _beta_status(share3, 70), "detail": f"{len(active_days)}/{n_users} utenti attivi nel periodo · media {round(sum(per_week) / len(per_week), 1) if per_week else 0} gg/sett."})

    # 3 — Comandi Axon riusciti
    user_msgs = await _beta_count("assistant_messages", {**in_users, "role": "user", "created_at": {"$gte": since}})
    fails = await _beta_count("assistant_messages", {**in_users, "role": "assistant", "created_at": {"$gte": since}, "content": {"$regex": "^(Sono temporaneamente offline|⏱️|Non ho capito|Non riesco)"}})
    teach = await _beta_count("ai_teach_rules", {**in_users, "created_at": {"$gte": since}})
    wd = await _beta_count("axon_watchdog_log", {"at": {"$gte": since}, **({"user_id": {"$in": uids}} if scope else {})})
    v3 = round(100 * max(0, user_msgs - fails - teach) / user_msgs, 0) if user_msgs else None
    metrics.append({"key": "axon_success", "label": "Comandi Axon riusciti", "value": v3, "unit": "%", "target": 85, "status": _beta_status(v3, 85), "detail": f"{user_msgs} richieste · {fails} risposte di errore · {teach} correzioni «Insegna ad Axon» · {wd} incidenti watchdog"})

    # 4 — Voce
    voice = await _beta_count("beta_events", {**in_users, "name": "voice_message", "at": {"$gte": since}})
    stt_err = await _beta_count("beta_events", {**in_users, "name": "stt_error", "at": {"$gte": since}})
    v4 = round(100 * voice / user_msgs, 0) if user_msgs else None
    err_rate = round(100 * stt_err / voice, 0) if voice else None
    metrics.append({"key": "voice", "label": "Interazioni vocali", "value": v4, "unit": "%", "target": 30, "status": _beta_status(v4, 30), "detail": f"{voice} messaggi dettati su {user_msgs} · errori riconoscimento vocale: {f'{err_rate}%' if err_rate is not None else 'n/d'} (obiettivo < 10%)"})

    # 5 — Tempo appuntamento via Axon (dalla richiesta al salvataggio)
    durs: List[float] = []
    async for a in db.appointments.find({**({"user_id": scope["tenant_id"]} if scope else {}), "created_at": {"$gte": since}, "source": {"$regex": "^axon"}}, {"_id": 0, "created_by": 1, "user_id": 1, "created_at": 1}).limit(500):
        ca = a.get("created_at")
        if not isinstance(ca, datetime):
            continue
        m = await db.assistant_messages.find_one({"user_id": a.get("created_by") or a.get("user_id"), "role": "user", "created_at": {"$lte": ca, "$gte": ca - timedelta(minutes=5)}}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
        if m and isinstance(m.get("created_at"), datetime):
            durs.append((ca - m["created_at"]).total_seconds())
    ev_durs = [e["meta"]["ms"] / 1000 for e in await db.beta_events.find({**in_users, "name": "axon_appointment", "at": {"$gte": since}, "meta.ms": {"$exists": True}}, {"_id": 0, "meta": 1}).to_list(500)]
    durs += ev_durs
    v5 = round(sorted(durs)[len(durs) // 2], 0) if durs else None
    metrics.append({"key": "appt_time", "label": "Appuntamento via Axon (mediana)", "value": v5, "unit": "s", "target": 20, "higher_is_better": False, "status": _beta_status(v5, 20, higher_is_better=False), "detail": f"{len(durs)} appuntamenti creati da Axon nel periodo" + ("" if durs else " · nessun dato: usa «fissa un appuntamento con…» in chat")})

    # 6 — Crash & errori
    tickets = await _beta_count("support_tickets", {**in_users, "created_at": {"$gte": since}})
    bug_tickets = await _beta_count("support_tickets", {**in_users, "created_at": {"$gte": since}, "$or": [{"category": {"$regex": "bug|crash|errore", "$options": "i"}}, {"messages.0.text": {"$regex": "crash|si chiude|blocca|errore", "$options": "i"}}]})
    wd_per_user_week = round(wd / n_users / weeks, 2)
    metrics.append({"key": "stability", "label": "Incidenti watchdog / utente / settimana", "value": wd_per_user_week, "unit": "", "target": 1, "higher_is_better": False, "status": _beta_status(wd_per_user_week, 1, higher_is_better=False), "detail": f"{wd} incidenti watchdog · {bug_tickets} segnalazioni bug su {tickets} ticket Help"})

    # 7 — Dati inseriti
    tq = {"user_id": scope["tenant_id"]} if scope else {}
    new_contacts = await _beta_count("contacts", {**tq, "created_at": {"$gte": since}})
    new_appts = await _beta_count("appointments", {**tq, "created_at": {"$gte": since}})
    v7 = round(new_contacts / n_users, 1)
    first2w = await _beta_count("contacts", {**tq, "created_at": {"$gte": utcnow() - timedelta(days=14)}})
    metrics.append({"key": "data", "label": "Contatti nuovi per utente", "value": v7, "unit": "", "target": 10, "status": _beta_status(v7, 10), "detail": f"{new_contacts} contatti · {new_appts} appuntamenti nel periodo · {first2w} contatti negli ultimi 14 gg"})

    # 8 — Feature usate almeno una volta (% utenti)
    feats = {}
    for label, coll, q in (
        ("Storico PUN", "beta_events", {"name": "pun_history"}),
        ("Scanner", "beta_events", {"name": "scanner"}),
        ("Trascrizione chiamate", "call_transcripts", {}),
        ("Imprevisti", "axon_emergency_plans", {}),
        ("Upload documenti", "master_files", {}),
    ):
        base = {**q, **({"user_id": {"$in": uids}} if coll != "master_files" else tq)}
        base["at" if coll in ("beta_events",) else "created_at"] = {"$gte": since}
        try:
            d = await getattr(db, coll).distinct("created_by" if coll == "master_files" else "user_id", base)
        except Exception:  # noqa: BLE001
            d = []
        feats[label] = round(100 * len([x for x in d if x]) / n_users, 0)
    low = [k for k, v in feats.items() if v < 20]
    v8 = min(feats.values()) if feats else None
    metrics.append({"key": "features", "label": "Feature usate da ≥ 50 % utenti (minimo)", "value": v8, "unit": "%", "target": 50, "status": _beta_status(v8, 50), "detail": " · ".join(f"{k} {v:.0f}%" for k, v in feats.items()) + (f" — sotto il 20 % (candidate a taglio/ridisegno): {', '.join(low)}" if low else ""), "breakdown": feats})

    # 9 — NPS
    nps_rows = await db.beta_nps.find({**in_users, "at": {"$gte": since}}, {"_id": 0}).sort("at", -1).to_list(2000)
    latest: Dict[str, dict] = {}
    for r in nps_rows:
        latest.setdefault(r["user_id"], r)
    scores = [r["score"] for r in latest.values()]
    nps = round(100 * (sum(1 for s_ in scores if s_ >= 9) - sum(1 for s_ in scores if s_ <= 6)) / len(scores), 0) if scores else None
    rec = [r for r in latest.values() if r.get("would_recommend") is not None]
    rec_pct = round(100 * sum(1 for r in rec if r["would_recommend"]) / len(rec), 0) if rec else None
    metrics.append({"key": "nps", "label": "NPS", "value": nps, "unit": "", "target": 40, "status": _beta_status(nps, 40) if nps is not None else "nd", "detail": f"{len(scores)} risposte · «lo consiglieresti?» sì {f'{rec_pct}%' if rec_pct is not None else 'n/d'} (obiettivo ≥ 70%)"})

    # 10 — Disponibilità a pagare
    price = [r["price_tier"] for r in latest.values() if r.get("price_tier") is not None]
    v10 = round(100 * sum(1 for p in price if p >= 25) / len(price), 0) if price else None
    dist = {str(t): sum(1 for p in price if p == t) for t in (0, 19, 29, 49)}
    metrics.append({"key": "wtp", "label": "Disposti a pagare ≥ 25 €/mese", "value": v10, "unit": "%", "target": 50, "status": _beta_status(v10, 50), "detail": f"{len(price)} risposte · 0€: {dist['0']} · 19€: {dist['19']} · 29€: {dist['29']} · 49€: {dist['49']}", "breakdown": dist})

    ok = sum(1 for m in metrics if m["status"] == "ok")
    nd = sum(1 for m in metrics if m["status"] == "nd")
    core_ok = all(next(m for m in metrics if m["key"] == k)["status"] == "ok" for k in ("activation", "axon_success", "stability", "nps"))
    verdict = "GO" if core_ok and ok >= 6 else "ITERA" if next(m for m in metrics if m["key"] == "axon_success")["status"] != "ok" or next(m for m in metrics if m["key"] == "stability")["status"] != "ok" else "RIPENSA" if next(m for m in metrics if m["key"] == "dau")["status"] == "ko" else "IN CORSO"
    cfg = await db.beta_config.find_one({"_id": tenant_id(user)}) or {}
    comments = [{"user": r.get("user_name") or r.get("user_email"), "score": r["score"], "best": r.get("best"), "worst": r.get("worst"), "at": r["at"].isoformat() if isinstance(r.get("at"), datetime) else None} for r in list(latest.values())[:30] if r.get("best") or r.get("worst")]
    return {"days": days, "users": n_users, "metrics": metrics, "summary": {"ok": ok, "nd": nd, "total": len(metrics), "verdict": verdict},
            "nps_wave": {"wave": int(cfg.get("wave") or 1), "active": bool(cfg.get("active")), "ask_price": bool(cfg.get("ask_price")), "responses": len(scores)}, "comments": comments, "scope": "all" if not scope else "tenant"}


@app.on_event("startup")
async def _beta_indexes():
    try:
        await db.beta_events.create_index([("user_id", 1), ("name", 1), ("at", -1)])
        await db.beta_nps.create_index([("user_id", 1), ("wave", 1)], unique=True)
    except Exception:  # noqa: BLE001
        pass


_OMNI_EXTRA_SECTIONS.append((
    "Beta sul campo: cruscotto Master + sondaggio NPS", "/admin/beta/dashboard",
    "Pannello Master › «Cruscotto Beta» (route app /admin/beta): 10 metriche con soglie (attivazione, giorni attivi, comandi Axon riusciti, voce, tempo appuntamento, stabilità, "
    "dati inseriti, feature usate, NPS, disponibilità a pagare) e verdetto GO/ITERA/RIPENSA; il Master attiva le ondate del sondaggio NPS. Gli utenti rispondono dal tab Help › «Dicci la tua» (route /beta-nps).",
))


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# V50.z475 — PROGRAMMA BETA 6 SETTIMANE: missioni della settimana + Diario del venerdì
#   GET  /beta/program            → {enrolled, week 1-6, start_date, mission{title,tasks[]}, diary_due, diary_done, nps_pending}
#   POST /beta/diary {week, saved_time, angry, manual} → db.beta_diary (1 per utente/settimana, upsert)
#   POST /admin/beta/start {start_date?, user_ids?}     → Master: iscrive il tenant (o utenti scelti) al programma; db.beta_program
#   GET  /admin/beta/program       → Master: iscritti con settimana corrente, diari compilati, ultimi diari
# Il Diario è «dovuto» da venerdì a domenica della settimana corrente (e resta compilabile sempre dalla card).
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

_BETA_MISSIONS = [
    {"week": 1, "title": "Parti con i clienti veri", "goal": "Attivazione", "tasks": ["Inserisci 10 clienti reali (anche dalla rubrica o da una cartella)", "Fissa 3 appuntamenti A VOCE con Axon («fissa un appuntamento con Rossi domani alle 10»)", "Completa profilo e anagrafica (checkpoint onboarding)"]},
    {"week": 2, "title": "Axon in auto", "goal": "Uso quotidiano e voce", "tasks": ["Per 5 giorni chiedi «cosa ho oggi» appena sali in auto", "Usa «chiama…», «numero di…», «sposta l'appuntamento…» almeno una volta al giorno", "Prova la modalità Solo testo in un luogo rumoroso"]},
    {"week": 3, "title": "Documenti e mercato", "goal": "Feature di settore", "tasks": ["Scansiona 3 bollette o documenti con lo Scanner", "Apri lo Storico PUN davanti a un cliente e scarica il PDF", "Rispondi al sondaggio «Dicci la tua» (2 minuti)"]},
    {"week": 4, "title": "Imprevisti e chiamate", "goal": "Automazioni avanzate", "tasks": ["Simula un imprevisto: «sono bloccato nel traffico fino alle 11»", "Registra o carica una chiamata e fai estrarre riepilogo e prossimi passi", "Chiedi ad Axon un comando multi-step («chiudi la trattativa e richiamalo tra 30 giorni»)"]},
    {"week": 5, "title": "Settimana libera", "goal": "Uso spontaneo", "tasks": ["Usa AdvisorOS come se fosse il tuo CRM definitivo", "Segnala dall'Help tutto ciò che hai dovuto fare a mano", "Invita un collega a vedere come lavori con Axon"]},
    {"week": 6, "title": "Bilancio", "goal": "Valore e prezzo", "tasks": ["Rispondi al sondaggio finale con la domanda sul prezzo", "Scrivi nel Diario cosa ti mancherebbe se domani non avessi più AdvisorOS", "Esporta i tuoi dati (contatti/PDF) per verificare che siano sempre tuoi"]},
]


class BetaDiaryIn(BaseModel):
    week: int = 1
    saved_time: Optional[str] = None
    angry: Optional[str] = None
    manual: Optional[str] = None


class BetaStartIn(BaseModel):
    start_date: Optional[str] = None  # YYYY-MM-DD (default oggi)
    user_ids: Optional[List[str]] = None  # default: tutti gli utenti del tenant


def _beta_week(start: datetime, now: datetime) -> int:
    return max(1, min(6, (now.date() - start.date()).days // 7 + 1))


async def _beta_enrollment(user: dict) -> Optional[dict]:
    doc = await db.beta_program.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if doc:
        return doc
    return await db.beta_program.find_one({"tenant_id": tenant_id(user), "user_id": None}, {"_id": 0})


@api_router.get("/beta/program")
async def beta_program(user=Depends(get_current_user)):
    enr = await _beta_enrollment(user)
    if not enr or not isinstance(enr.get("start_date"), datetime):
        return {"enrolled": False}
    now = utcnow()
    week = _beta_week(enr["start_date"], now)
    mission = _BETA_MISSIONS[week - 1]
    wd = now.weekday()  # 0 = lunedì … 4 = venerdì
    diary = await db.beta_diary.find_one({"user_id": user["user_id"], "week": week}, {"_id": 0, "at": 1})
    cfg = await db.beta_config.find_one({"_id": tenant_id(user)}) or {}
    nps_pending = False
    if cfg.get("active"):
        nps_pending = (await db.beta_nps.find_one({"user_id": user["user_id"], "wave": int(cfg.get("wave") or 1)}, {"_id": 1})) is None
    done_weeks = [d["week"] async for d in db.beta_diary.find({"user_id": user["user_id"]}, {"_id": 0, "week": 1})]
    return {"enrolled": True, "week": week, "start_date": enr["start_date"].strftime("%Y-%m-%d"), "days_left": max(0, 42 - (now.date() - enr["start_date"].date()).days),
            "mission": mission, "diary_due": wd >= 4 and diary is None, "diary_done": diary is not None, "diary_weeks_done": sorted(set(done_weeks)), "nps_pending": nps_pending}


@api_router.post("/beta/diary")
async def beta_diary(body: BetaDiaryIn, user=Depends(get_current_user)):
    vals = {k: (getattr(body, k) or "").strip()[:800] for k in ("saved_time", "angry", "manual")}
    if not any(vals.values()):
        raise HTTPException(status_code=400, detail="Scrivi almeno una risposta")
    week = max(1, min(6, int(body.week or 1)))
    doc = {"user_id": user["user_id"], "tenant_id": tenant_id(user), "user_email": user.get("email"), "user_name": user.get("name"), "week": week, **vals, "at": utcnow()}
    await db.beta_diary.update_one({"user_id": user["user_id"], "week": week}, {"$set": doc}, upsert=True)
    return {"ok": True, "message": "Diario salvato. Grazie: lo leggo venerdì stesso."}


@api_router.post("/admin/beta/start")
async def beta_start(body: BetaStartIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    try:
        start = datetime.strptime(body.start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc) if body.start_date else utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    except ValueError:
        raise HTTPException(status_code=400, detail="Data non valida (AAAA-MM-GG)")
    tid = tenant_id(user)
    if body.user_ids:
        for uid in body.user_ids[:200]:
            await db.beta_program.update_one({"user_id": uid}, {"$set": {"user_id": uid, "tenant_id": tid, "start_date": start, "by": user["user_id"], "updated_at": utcnow()}}, upsert=True)
    else:
        await db.beta_program.update_one({"tenant_id": tid, "user_id": None}, {"$set": {"tenant_id": tid, "user_id": None, "start_date": start, "by": user["user_id"], "updated_at": utcnow()}}, upsert=True)
    return {"ok": True, "start_date": start.strftime("%Y-%m-%d")}


@api_router.delete("/admin/beta/start")
async def beta_stop(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    r = await db.beta_program.delete_many({"tenant_id": tenant_id(user)})
    return {"ok": True, "removed": r.deleted_count}


@api_router.get("/admin/beta/program")
async def beta_program_admin(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    scope = _beta_scope(user)
    uq: dict = {} if not scope else {"$or": [{"user_id": scope["tenant_id"]}, {"parent_user_id": scope["tenant_id"]}]}
    users = await db.users.find(uq, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "parent_user_id": 1}).to_list(2000)
    enrolls = {e.get("user_id") or f"tenant:{e['tenant_id']}": e async for e in db.beta_program.find(scope or {}, {"_id": 0})}
    now = utcnow()
    rows = []
    for u in users:
        enr = enrolls.get(u["user_id"]) or enrolls.get(f"tenant:{u.get('parent_user_id') or u['user_id']}")
        if not enr:
            continue
        week = _beta_week(enr["start_date"], now)
        diaries = [d["week"] async for d in db.beta_diary.find({"user_id": u["user_id"]}, {"_id": 0, "week": 1})]
        last_open = await db.beta_events.find_one({"user_id": u["user_id"], "name": "app_open"}, {"_id": 0, "day": 1}, sort=[("at", -1)])
        rows.append({"user_id": u["user_id"], "name": u.get("name"), "email": u.get("email"), "week": week, "start_date": enr["start_date"].strftime("%Y-%m-%d"), "diaries_done": sorted(set(diaries)), "last_open": (last_open or {}).get("day")})
    diaries = await db.beta_diary.find({**({"tenant_id": scope["tenant_id"]} if scope else {})}, {"_id": 0}).sort("at", -1).to_list(60)
    for d in diaries:
        if isinstance(d.get("at"), datetime):
            d["at"] = d["at"].isoformat()
    tenant_enr = enrolls.get(f"tenant:{tenant_id(user)}")
    return {"participants": rows, "missions": _BETA_MISSIONS, "diaries": diaries, "tenant_start": tenant_enr["start_date"].strftime("%Y-%m-%d") if tenant_enr else None,
            "current_week": _beta_week(tenant_enr["start_date"], now) if tenant_enr else None}


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# V50.z476 — «FRASI NON CAPITE»: richieste che Axon non ha capito/gestito, per correggerle prima di allargare i tester.
#   GET /admin/beta/misunderstood?days=42&limit=200&reason=
#   Fonti/euristiche (ogni voce ha reason):
#   • error      → risposta assistant con pattern di errore/incomprensione («Non ho capito», «Non riesco», «Sono temporaneamente offline», «⏱️», «Puoi ripetere», «Non trovo…»)
#   • repeated   → l'utente ripete/riformula entro 90 s la stessa richiesta (similarità ≥ 0.6 sui token): segno che la prima risposta non andava
#   • correction → regola «Insegna ad Axon» creata dalla chat (ai_teach_rules.source_user_message)
#   • watchdog   → incidente watchdog durante la risposta
#   Super Master (scope all) vede tutte le reti + «cluster» per frase normalizzata (top ricorrenze) → dove migliorare AdvisorOS.
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

_MIS_ERR_RE = re.compile(r"^(sono temporaneamente offline|⏱️|non ho capito|non riesco|non sono riuscit|puoi ripetere|non trovo|non ho trovato|mi dispiace, non|non posso eseguire|comando non riconosciuto|non è chiaro|cosa intendi)", re.IGNORECASE)
_MIS_STOP = {"il", "lo", "la", "le", "gli", "un", "una", "di", "da", "a", "al", "alla", "per", "con", "che", "mi", "me", "e", "è", "in", "su", "del", "della", "dei", "delle", "ho", "hai", "oggi", "domani", "per favore", "puoi", "vorrei", "axon", "viola"}


def _mis_norm(t: str) -> str:
    t = re.sub(r"\s+", " ", (t or "").split("\n\nISTRUZIONI OPERATIVE", 1)[0].lower().strip())
    return re.sub(r"[^a-zà-ù0-9 ]", "", t)[:160]


def _mis_tokens(t: str) -> set:
    return {w for w in _mis_norm(t).split() if len(w) > 2 and w not in _MIS_STOP}


def _mis_sim(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def _mis_cluster_key(t: str) -> str:
    toks = sorted(_mis_tokens(t))[:6]
    return " ".join(toks)


@api_router.get("/admin/beta/misunderstood")
async def beta_misunderstood(days: int = 42, limit: int = 200, reason: Optional[str] = None, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    days = max(1, min(days, 180)); limit = max(10, min(limit, 1000))
    since = utcnow() - timedelta(days=days)
    scope = _beta_scope(user)
    uq: dict = {} if not scope else {"$or": [{"user_id": scope["tenant_id"]}, {"parent_user_id": scope["tenant_id"]}]}
    users = {u["user_id"]: u async for u in db.users.find(uq, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "parent_user_id": 1})}
    uids = list(users.keys())
    items: List[dict] = []

    def who(uid: str) -> str:
        u = users.get(uid) or {}
        return u.get("name") or u.get("email") or (uid or "")[:12]

    # messaggi in ordine per utente (ultimi N per non esplodere)
    msgs = await db.assistant_messages.find({"user_id": {"$in": uids}, "created_at": {"$gte": since}}, {"_id": 0, "user_id": 1, "session_id": 1, "role": 1, "content": 1, "created_at": 1}).sort("created_at", 1).to_list(20000)
    by_user: Dict[str, List[dict]] = {}
    for m in msgs:
        if isinstance(m.get("created_at"), datetime):
            by_user.setdefault(m["user_id"], []).append(m)
    for uid, seq in by_user.items():
        last_user: Optional[dict] = None
        for m in seq:
            if m["role"] == "user":
                txt = (m.get("content") or "").split("\n\nISTRUZIONI OPERATIVE", 1)[0].strip()
                if last_user and (m["created_at"] - last_user["created_at"]).total_seconds() <= 90:
                    sim = _mis_sim(_mis_tokens(txt), _mis_tokens(last_user["_txt"]))
                    if sim >= 0.6 and txt and txt != last_user["_txt"]:
                        items.append({"at": m["created_at"], "user_id": uid, "user": who(uid), "phrase": last_user["_txt"][:220], "retry": txt[:220], "reply": (last_user.get("_reply") or "")[:200], "reason": "repeated", "session_id": m.get("session_id")})
                last_user = {**m, "_txt": txt, "_reply": None}
            elif m["role"] == "assistant" and last_user is not None:
                rep = (m.get("content") or "").strip()
                last_user["_reply"] = rep
                if _MIS_ERR_RE.match(rep):
                    items.append({"at": m["created_at"], "user_id": uid, "user": who(uid), "phrase": last_user["_txt"][:220], "reply": rep[:200], "reason": "error", "session_id": m.get("session_id")})
    # correzioni «Insegna ad Axon»
    async for r in db.ai_teach_rules.find({"user_id": {"$in": uids}, "created_at": {"$gte": since}, "source_user_message": {"$exists": True, "$ne": ""}}, {"_id": 0, "user_id": 1, "source_user_message": 1, "text": 1, "created_at": 1}):
        items.append({"at": r["created_at"], "user_id": r["user_id"], "user": who(r["user_id"]), "phrase": (r.get("source_user_message") or "")[:220], "reply": f"Regola insegnata: {(r.get('text') or '')[:160]}", "reason": "correction"})
    # watchdog
    async for w in db.axon_watchdog_log.find({"at": {"$gte": since}, **({"user_id": {"$in": uids}} if scope else {})}, {"_id": 0, "user_id": 1, "kind": 1, "detail": 1, "at": 1}):
        uid = w.get("user_id") or ""
        lu = next((m for m in reversed(by_user.get(uid, [])) if m["role"] == "user" and m["created_at"] <= w["at"]), None) if uid else None
        items.append({"at": w["at"], "user_id": uid, "user": who(uid) if uid else "—", "phrase": ((lu or {}).get("content") or "").split("\n\nISTRUZIONI OPERATIVE", 1)[0][:220] or "(richiesta non disponibile)", "reply": f"Watchdog: {w.get('kind')} {w.get('detail') or ''}"[:200], "reason": "watchdog"})

    if reason in ("error", "repeated", "correction", "watchdog"):
        items = [i for i in items if i["reason"] == reason]
    items.sort(key=lambda x: x["at"], reverse=True)
    by_reason = {k: sum(1 for i in items if i["reason"] == k) for k in ("error", "repeated", "correction", "watchdog")}
    # cluster per frase (dove migliorare): top 15 per ricorrenza, con utenti distinti
    clusters: Dict[str, dict] = {}
    for i in items:
        k = _mis_cluster_key(i["phrase"])
        if not k:
            continue
        c = clusters.setdefault(k, {"key": k, "example": i["phrase"], "count": 0, "users": set(), "reasons": {}})
        c["count"] += 1; c["users"].add(i["user_id"]); c["reasons"][i["reason"]] = c["reasons"].get(i["reason"], 0) + 1
    top = sorted(clusters.values(), key=lambda c: (-c["count"], -len(c["users"])))[:15]
    for c in top:
        c["users"] = len(c["users"])
    total_user_msgs = sum(1 for m in msgs if m["role"] == "user")
    out = items[:limit]
    for i in out:
        i["at"] = i["at"].isoformat()
    return {"days": days, "scope": "all" if not scope else "tenant", "total": len(items), "user_messages": total_user_msgs, "rate_pct": round(100 * len(items) / total_user_msgs, 1) if total_user_msgs else None,
            "by_reason": by_reason, "clusters": top, "items": out,
            "labels": {"error": "Risposta di errore / non capito", "repeated": "Richiesta ripetuta/riformulata", "correction": "Corretta con «Insegna ad Axon»", "watchdog": "Timeout / ripristino"}}


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# V50.z477 — EXPORT CRUSCOTTO BETA (CSV + PDF) per partner/investitori — riusa i payload di dashboard/misunderstood/program.
#   GET /admin/beta/export.csv?days=42  → CSV (;) con sezioni: metriche, frasi non capite (cluster), NPS commenti, diari, partecipanti
#   GET /admin/beta/export.pdf?days=42  → report A4 (reportlab/platypus): verdetto, 10 metriche con stato, frasi non capite, NPS, diari
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

_BX_STATUS_IT = {"ok": "A OBIETTIVO", "warn": "VICINO", "ko": "SOTTO", "nd": "N/D"}


def _bx_txt(v: Any) -> str:
    """Testo sicuro per font Helvetica (Latin-1): sostituisce simboli non supportati, rimuove emoji."""
    s = "" if v is None else str(v)
    s = s.replace("≥", ">=").replace("≤", "<=").replace("→", "->").replace("↻", "~").replace("×", "x").replace("‑", "-")
    return "".join(ch for ch in s if ord(ch) < 256 or ch in "–—‘’“”…€").strip()


def _bx_val(m: dict) -> str:
    v = m.get("value")
    if v is None:
        return "n/d"
    unit = m.get("unit") or ""
    vs = f"{v:.0f}" if float(v).is_integer() else f"{v:.1f}"
    return f"{vs}%" if unit in ("%", "% utenti") else f"{vs} {unit}".strip()


def _bx_target(m: dict) -> str:
    unit = m.get("unit") or ""
    sym = "<=" if m.get("higher_is_better") is False else ">="
    return f"{sym} {m['target']}{'%' if unit in ('%', '% utenti') else (' ' + unit if unit else '')}"


async def _bx_collect(days: int, user: dict) -> dict:
    dash = await beta_dashboard(days=days, user=user)
    mis = await beta_misunderstood(days=days, limit=200, reason=None, user=user)
    prog = await beta_program_admin(user=user)
    return {"dash": dash, "mis": mis, "prog": prog}


@api_router.get("/admin/beta/export.csv")
async def beta_export_csv(days: int = 42, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    import csv as _csv
    d = await _bx_collect(days, user)
    dash, mis, prog = d["dash"], d["mis"], d["prog"]
    buf = io.StringIO(); w = _csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(["AdvisorOS - Cruscotto Beta", f"periodo ultimi {dash['days']} giorni", f"generato {utcnow().strftime('%d/%m/%Y %H:%M')} UTC", "ambito: " + ("tutte le reti" if dash["scope"] == "all" else "la tua rete")])
    w.writerow(["Verdetto", dash["summary"]["verdict"], f"{dash['summary']['ok']}/{dash['summary']['total']} metriche a obiettivo", f"{dash['summary']['nd']} n/d", f"{dash['users']} utenti"])
    w.writerow([])
    w.writerow(["METRICHE"]); w.writerow(["#", "Metrica", "Valore", "Unità", "Obiettivo", "Stato", "Dettaglio"])
    for i, m in enumerate(dash["metrics"], 1):
        w.writerow([i, m["label"], "" if m["value"] is None else m["value"], m.get("unit") or "", _bx_target(m), _BX_STATUS_IT.get(m["status"], m["status"]), m.get("detail") or ""])
    w.writerow([])
    w.writerow(["FRASI NON CAPITE DA AXON", f"{mis['total']} su {mis['user_messages']} richieste", f"{mis['rate_pct'] if mis['rate_pct'] is not None else 'n/d'}%", f"errori {mis['by_reason'].get('error', 0)}", f"ripetute {mis['by_reason'].get('repeated', 0)}", f"corrette {mis['by_reason'].get('correction', 0)}", f"timeout {mis['by_reason'].get('watchdog', 0)}"])
    w.writerow(["Frase ricorrente (esempio)", "Occorrenze", "Utenti distinti", "Motivi"])
    for c in mis["clusters"]:
        w.writerow([c["example"], c["count"], c["users"], ", ".join(f"{mis['labels'].get(k, k)}: {v}" for k, v in c["reasons"].items())])
    w.writerow([])
    w.writerow(["ELENCO FRASI NON CAPITE"]); w.writerow(["Data", "Utente", "Motivo", "Frase", "Riformulazione", "Risposta Axon"])
    for it in mis["items"]:
        w.writerow([it["at"][:16].replace("T", " "), it["user"], mis["labels"].get(it["reason"], it["reason"]), it["phrase"], it.get("retry") or "", it.get("reply") or ""])
    w.writerow([])
    w.writerow(["SONDAGGIO NPS", f"ondata {dash['nps_wave']['wave']}", "attiva" if dash["nps_wave"]["active"] else "non attiva", f"{dash['nps_wave']['responses']} risposte"])
    w.writerow(["Utente", "Punteggio", "Cosa funziona", "Cosa manca", "Data"])
    for c in dash["comments"]:
        w.writerow([c["user"], c["score"], c.get("best") or "", c.get("worst") or "", (c.get("at") or "")[:10]])
    w.writerow([])
    w.writerow(["PARTECIPANTI PROGRAMMA 6 SETTIMANE", f"inizio {prog.get('tenant_start') or 'non avviato'}", f"settimana corrente {prog.get('current_week') or '-'}"])
    w.writerow(["Utente", "Email", "Settimana", "Inizio", "Diari compilati", "Ultimo accesso"])
    for p in prog["participants"]:
        w.writerow([p.get("name") or "", p.get("email") or "", p["week"], p["start_date"], " ".join(f"S{x}" for x in p["diaries_done"]) or "nessuno", p.get("last_open") or "mai"])
    w.writerow([])
    w.writerow(["DIARIO DEL VENERDÌ"]); w.writerow(["Utente", "Settimana", "Data", "Tempo risparmiato", "Cosa ha fatto arrabbiare", "Fatto a mano"])
    for dd in prog["diaries"]:
        w.writerow([dd.get("user_name") or dd.get("user_email") or "", dd["week"], (dd.get("at") or "")[:10], dd.get("saved_time") or "", dd.get("angry") or "", dd.get("manual") or ""])
    fname = f"AdvisorOS_Beta_{dash['days']}gg_{utcnow().strftime('%Y%m%d')}.csv"
    return Response(content=("\ufeff" + buf.getvalue()).encode("utf-8"), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{fname}"'})


def _bx_render_pdf(dash: dict, mis: dict, prog: dict, owner: str) -> bytes:
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors as _c  # type: ignore
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak  # type: ignore
    ss = getSampleStyleSheet()
    H1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=20, leading=24, textColor=_c.HexColor("#0F766E"), alignment=0, spaceAfter=2)
    H2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=13, leading=16, textColor=_c.HexColor("#0F766E"), spaceBefore=10, spaceAfter=4)
    P = ParagraphStyle("p", parent=ss["BodyText"], fontSize=9, leading=12)
    SM = ParagraphStyle("sm", parent=P, fontSize=8, leading=10, textColor=_c.HexColor("#475569"))
    CELL = ParagraphStyle("cell", parent=P, fontSize=8, leading=10)
    ST_COL = {"ok": "#16A34A", "warn": "#D97706", "ko": "#DC2626", "nd": "#64748B"}
    VERD_COL = {"GO": "#16A34A", "ITERA": "#D97706", "RIPENSA": "#DC2626"}
    VERD_TXT = {"GO": "pronto per il rilascio pubblico", "ITERA": "altre 3 settimane su affidabilità Axon / Android", "RIPENSA": "problema di valore percepito: rivedere onboarding e proposta", "IN CORSO": "raccolta dati in corso"}

    def para(t, st=CELL):
        s_ = _bx_txt(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        for a, b in (("&lt;b&gt;", "<b>"), ("&lt;/b&gt;", "</b>"), ("&lt;br/&gt;", "<br/>")):  # solo i tag di layout usati qui
            s_ = s_.replace(a, b)
        return Paragraph(s_, st)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm, title="AdvisorOS - Report Beta", author="AdvisorOS")
    W = A4[0] - 30 * mm
    gen = utcnow().strftime("%d/%m/%Y %H:%M")
    el: list = [Paragraph("AdvisorOS - Report Beta sul campo", H1),
                para(f"Periodo: ultimi {dash['days']} giorni - {dash['users']} utenti - ambito: {'tutte le reti' if dash['scope'] == 'all' else 'la tua rete'} - generato il {gen} UTC da {owner}", SM), Spacer(1, 6)]
    v = dash["summary"]["verdict"]; vc = VERD_COL.get(v, "#0F766E")
    vt = Table([[Paragraph(f"<b>{_bx_txt(v)}</b>", ParagraphStyle("v", parent=P, fontSize=18, leading=22, textColor=_c.HexColor(vc))), para(f"{VERD_TXT.get(v, '')}<br/>{dash['summary']['ok']}/{dash['summary']['total']} metriche a obiettivo - {dash['summary']['total'] - dash['summary']['ok'] - dash['summary']['nd']} sotto - {dash['summary']['nd']} n/d. Regola GO: Attivazione, Comandi Axon, Stabilità e NPS a obiettivo e almeno 6 metriche su 10.", P)]], colWidths=[35 * mm, W - 35 * mm])
    vt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1.2, _c.HexColor(vc)), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    el += [vt, Paragraph("Le 10 metriche", H2)]
    rows = [[para("<b>#</b>"), para("<b>Metrica</b>"), para("<b>Valore</b>"), para("<b>Obiettivo</b>"), para("<b>Stato</b>"), para("<b>Dettaglio</b>")]]
    for i, m in enumerate(dash["metrics"], 1):
        rows.append([para(str(i)), para(m["label"]), para(f"<b>{_bx_val(m)}</b>"), para(_bx_target(m)), Paragraph(f"<font color='{ST_COL.get(m['status'], '#64748B')}'><b>{_BX_STATUS_IT.get(m['status'], m['status'])}</b></font>", CELL), para(m.get("detail") or "")])
    mt = Table(rows, colWidths=[9 * mm, 37 * mm, 18 * mm, 18 * mm, 24 * mm, W - 106 * mm], repeatRows=1)
    mt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), _c.HexColor("#E6F4F2")), ("GRID", (0, 0), (-1, -1), 0.4, _c.HexColor("#CBD5E1")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [_c.white, _c.HexColor("#F8FAFC")])]))
    el.append(mt)

    el.append(Paragraph("Frasi non capite da Axon", H2))
    el.append(para(f"{mis['total']} richieste non capite su {mis['user_messages']} ({mis['rate_pct'] if mis['rate_pct'] is not None else 'n/d'}%) - errori {mis['by_reason'].get('error', 0)}, ripetute {mis['by_reason'].get('repeated', 0)}, corrette con «Insegna ad Axon» {mis['by_reason'].get('correction', 0)}, timeout {mis['by_reason'].get('watchdog', 0)}.", P))
    if mis["clusters"]:
        rows = [[para("<b>Richiesta ricorrente (esempio)</b>"), para("<b>Volte</b>"), para("<b>Utenti</b>"), para("<b>Motivi</b>")]]
        for c in mis["clusters"][:12]:
            rows.append([para(f"«{c['example']}»"), para(str(c["count"])), para(str(c["users"])), para(", ".join(f"{mis['labels'].get(k, k)} {n}" for k, n in c["reasons"].items()))])
        ct = Table(rows, colWidths=[W - 95 * mm, 15 * mm, 15 * mm, 65 * mm], repeatRows=1)
        ct.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), _c.HexColor("#FEF3C7")), ("GRID", (0, 0), (-1, -1), 0.4, _c.HexColor("#CBD5E1")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        el.append(ct)
    else:
        el.append(para("Nessuna frase non capita nel periodo.", SM))

    el.append(Paragraph("Sondaggio NPS e commenti", H2))
    nw = dash["nps_wave"]
    el.append(para(f"Ondata {nw['wave']} ({'attiva' if nw['active'] else 'non attiva'}) - {nw['responses']} risposte. " + " ".join(f"{m['label']}: <b>{_bx_val(m)}</b>." for m in dash["metrics"] if m["key"] in ("nps", "wtp")), P))
    if dash["comments"]:
        rows = [[para("<b>Utente</b>"), para("<b>Voto</b>"), para("<b>Cosa funziona</b>"), para("<b>Cosa manca</b>")]]
        for c in dash["comments"][:20]:
            rows.append([para(c["user"]), para(f"{c['score']}/10"), para(c.get("best") or "-"), para(c.get("worst") or "-")])
        nt = Table(rows, colWidths=[35 * mm, 14 * mm, (W - 49 * mm) / 2, (W - 49 * mm) / 2], repeatRows=1)
        nt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), _c.HexColor("#E6F4F2")), ("GRID", (0, 0), (-1, -1), 0.4, _c.HexColor("#CBD5E1")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        el.append(nt)
    else:
        el.append(para("Nessun commento nel periodo.", SM))

    el.append(Paragraph("Programma Beta 6 settimane", H2))
    if prog.get("tenant_start"):
        el.append(para(f"Avviato il {prog['tenant_start']} - settimana corrente {prog['current_week']}/6 - {len(prog['participants'])} partecipanti.", P))
        rows = [[para("<b>Consulente</b>"), para("<b>Sett.</b>"), para("<b>Diari</b>"), para("<b>Ultimo accesso</b>")]]
        for p_ in prog["participants"]:
            rows.append([para(p_.get("name") or p_.get("email") or ""), para(f"S{p_['week']}"), para(" ".join(f"S{x}" for x in p_["diaries_done"]) or "nessuno"), para(p_.get("last_open") or "mai")])
        pt = Table(rows, colWidths=[W - 85 * mm, 15 * mm, 40 * mm, 30 * mm], repeatRows=1)
        pt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), _c.HexColor("#E6F4F2")), ("GRID", (0, 0), (-1, -1), 0.4, _c.HexColor("#CBD5E1"))]))
        el.append(pt)
    else:
        el.append(para("Programma non avviato.", SM))
    if prog.get("diaries"):
        el.append(Paragraph("Diario del venerdì - ultime voci", H2))
        rows = [[para("<b>Consulente</b>"), para("<b>Sett.</b>"), para("<b>Tempo risparmiato</b>"), para("<b>Cosa ha fatto arrabbiare</b>"), para("<b>Fatto a mano</b>")]]
        for dd in prog["diaries"][:30]:
            rows.append([para(dd.get("user_name") or dd.get("user_email") or ""), para(f"S{dd['week']}"), para(dd.get("saved_time") or "-"), para(dd.get("angry") or "-"), para(dd.get("manual") or "-")])
        dt = Table(rows, colWidths=[30 * mm, 12 * mm, (W - 42 * mm) / 3, (W - 42 * mm) / 3, (W - 42 * mm) / 3], repeatRows=1)
        dt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), _c.HexColor("#E6F4F2")), ("GRID", (0, 0), (-1, -1), 0.4, _c.HexColor("#CBD5E1")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        el.append(dt)
    el += [Spacer(1, 10), para("Documento riservato - dati aggregati del programma Beta AdvisorOS. Le frasi riportate sono richieste degli utenti tester, senza dati dei clienti finali.", SM)]

    def _footer(cv, d_):
        cv.saveState(); cv.setFont("Helvetica", 7.5); cv.setFillColor(_c.HexColor("#64748B"))
        cv.drawString(15 * mm, 8 * mm, f"AdvisorOS - Report Beta - {gen} UTC"); cv.drawRightString(A4[0] - 15 * mm, 8 * mm, f"pag. {d_.page}"); cv.restoreState()

    doc.build(el, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


@api_router.get("/admin/beta/export.pdf")
async def beta_export_pdf(days: int = 42, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    d = await _bx_collect(days, user)
    pdf = await asyncio.to_thread(_bx_render_pdf, d["dash"], d["mis"], d["prog"], user.get("name") or user.get("email") or "")
    fname = f"AdvisorOS_Beta_{d['dash']['days']}gg_{utcnow().strftime('%Y%m%d')}.pdf"
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
