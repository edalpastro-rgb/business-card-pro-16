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
