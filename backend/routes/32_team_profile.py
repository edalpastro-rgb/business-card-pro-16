# 32_team_profile.py — Profilo team/KPI collaboratori
# Estratto da server.py (righe originali 22812-23158). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
#
# Master-only. Fornisce al Master una visione aggregata + profilo AI di
# ogni collaboratore della sua rete:
#   - Metriche quantitative (contatti, appuntamenti, chiamate, chat, feedback)
#   - Trend 30 giorni
#   - Argomenti più richiesti ad Axon (top 5)
#   - Profilo comportamentale AI (comunicazione, punti forza, aree di
#     miglioramento) generato da Claude Sonnet 5 sulle interazioni reali,
#     cached 24h per non consumare LLM ad ogni apertura.
# =========================================================================

TEAM_PROFILE_CACHE_HOURS = 24
TEAM_PROFILE_TREND_DAYS = 30


async def _compute_team_member_metrics(member_uid: str) -> Dict[str, Any]:
    """Return quantitative activity metrics for a single collaborator."""
    now = utcnow()
    d30 = now - timedelta(days=30)
    d7 = now - timedelta(days=7)

    # Contatti gestiti (creati o modificati da lui)
    contacts_total = await db.contacts.count_documents({"user_id": member_uid})
    contacts_30d = await db.contacts.count_documents(
        {"user_id": member_uid, "created_at": {"$gte": d30}}
    )

    # Appuntamenti
    appts_total = await db.appointments.count_documents({"user_id": member_uid})
    appts_30d = await db.appointments.count_documents(
        {"user_id": member_uid, "date": {"$gte": d30}}
    )
    appts_upcoming = await db.appointments.count_documents(
        {"user_id": member_uid, "date": {"$gte": now}}
    )

    # Callbacks (chiamate/promemoria)
    callbacks_30d = await db.callbacks.count_documents(
        {"user_id": member_uid, "created_at": {"$gte": d30}}
    )
    callbacks_pending = await db.callbacks.count_documents(
        {"user_id": member_uid, "status": {"$ne": "done"}}
    )

    # Chat Axon
    chat_msgs_30d = await db.assistant_messages.count_documents(
        {"user_id": member_uid, "role": "user", "created_at": {"$gte": d30}}
    )
    chat_msgs_7d = await db.assistant_messages.count_documents(
        {"user_id": member_uid, "role": "user", "created_at": {"$gte": d7}}
    )

    # Feedback dati dal collaboratore sulle proprie risposte Axon
    fb_ups = await db.assistant_feedback.count_documents(
        {"user_id": member_uid, "rating": "up"}
    )
    fb_downs = await db.assistant_feedback.count_documents(
        {"user_id": member_uid, "rating": "down"}
    )

    # Ultima attività (max fra ultimo login, ultimo messaggio, ultimo appuntamento)
    last_login_doc = await db.users.find_one(
        {"user_id": member_uid}, {"_id": 0, "last_login_at": 1}
    )
    last_login = (last_login_doc or {}).get("last_login_at")
    last_chat_doc = await db.assistant_messages.find_one(
        {"user_id": member_uid}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)]
    )
    last_chat_at = (last_chat_doc or {}).get("created_at")
    candidates = [x for x in [last_login, last_chat_at] if x]
    last_active_at = max(candidates) if candidates else None

    return {
        "contacts_total": contacts_total,
        "contacts_30d": contacts_30d,
        "appts_total": appts_total,
        "appts_30d": appts_30d,
        "appts_upcoming": appts_upcoming,
        "callbacks_30d": callbacks_30d,
        "callbacks_pending": callbacks_pending,
        "chat_msgs_30d": chat_msgs_30d,
        "chat_msgs_7d": chat_msgs_7d,
        "feedback_ups": fb_ups,
        "feedback_downs": fb_downs,
        "last_active_at": last_active_at.isoformat() if hasattr(last_active_at, "isoformat") else last_active_at,
    }


def _score_topic_from_messages(messages: List[dict]) -> List[dict]:
    """Extract top-5 recurring topics (single-token frequency after stopwords).
    Cheap alternative to LLM classification for scale."""
    from collections import Counter
    all_tokens: List[str] = []
    for m in messages:
        if m.get("role") != "user":
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        _, toks = _normalize_and_tokenize(content)
        # Keep only length >= 4 to reduce noise ("PUN" and short acronyms drop out
        # — but 90% of noise ("come","cosa","dammi") is already in stopwords).
        all_tokens.extend([t for t in toks if len(t) >= 4])
    if not all_tokens:
        return []
    freq = Counter(all_tokens).most_common(12)
    # Filter out overly rare (freq 1 in tiny samples)
    top: List[dict] = []
    for tok, cnt in freq:
        if cnt < 2 and len(freq) > 5:
            continue
        top.append({"topic": tok, "count": cnt})
        if len(top) >= 5:
            break
    return top


async def _generate_behavioral_profile(
    member: dict,
    metrics: Dict[str, Any],
    topics: List[dict],
    sample_messages: List[dict],
) -> Dict[str, Any]:
    """Ask the LLM for a short behavioural profile. Returns
    {communication_style, strengths[], improvement_areas[], overall_summary}."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return {}

    sample_dialog = ""
    for m in sample_messages[-30:]:
        role = "USER" if m.get("role") == "user" else "AXON"
        content = (m.get("content") or "").replace("\n", " ").strip()
        if not content:
            continue
        sample_dialog += f"[{role}] {content[:300]}\n"

    system_prompt = (
        "Sei un coach comportamentale che analizza uno CONSULENTE ENERGETICO membro "
        "di una rete di vendita italiana, sulla base delle sue interazioni con l'AI "
        "aziendale (Axon) e delle metriche di attività. Restituisci un profilo BREVE, "
        "CONCRETO e UTILE al Master (capo-rete) per capire come lavora e come farlo "
        "crescere. NON inventare, basati SOLO sui dati forniti. Rispondi SOLO in JSON puro.\n\n"
        "SCHEMA OUTPUT (JSON, no markdown):\n"
        "{\n"
        "  \"communication_style\": \"stringa breve (max 12 parole)\",\n"
        "  \"strengths\": [\"...\", \"...\"],  // 2-3 punti forza osservabili\n"
        "  \"improvement_areas\": [\"...\", \"...\"],  // 2-3 aree con azione concreta\n"
        "  \"overall_summary\": \"paragrafo unico max 60 parole\"\n"
        "}"
    )

    user_prompt = (
        f"COLLABORATORE: {member.get('name','?')} ({member.get('email','')})\n\n"
        f"METRICHE 30 GIORNI:\n"
        f"- Contatti totali: {metrics.get('contacts_total')}\n"
        f"- Nuovi contatti 30gg: {metrics.get('contacts_30d')}\n"
        f"- Appuntamenti 30gg: {metrics.get('appts_30d')} (prossimi: {metrics.get('appts_upcoming')})\n"
        f"- Callback 30gg: {metrics.get('callbacks_30d')} (pending: {metrics.get('callbacks_pending')})\n"
        f"- Domande ad Axon 30gg: {metrics.get('chat_msgs_30d')}\n"
        f"- Feedback dati: 👍 {metrics.get('feedback_ups')} · 👎 {metrics.get('feedback_downs')}\n\n"
        f"ARGOMENTI PIÙ RICORRENTI: {', '.join([t['topic'] for t in topics]) or '(nessuno)'}\n\n"
        f"CAMPIONE DIALOGO AXON (ultimi scambi):\n{sample_dialog[:6000] or '(chat vuota)'}\n"
    )

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=key,
            session_id=f"team_profile_{member.get('user_id','?')[:10]}_{uuid.uuid4().hex[:6]}",
            system_message=system_prompt,
        ).with_model("anthropic", "claude-sonnet-5")
        reply = await chat.send_message(UserMessage(text=user_prompt))
    except Exception as exc:
        logger.warning("[team-insights] LLM failed for %s: %s", member.get("user_id"), exc)
        return {}

    import json as _json, re as _re
    txt = (reply or "").strip()
    if txt.startswith("```"):
        txt = txt.strip("`")
        if txt.lower().startswith("json"):
            txt = txt[4:].strip()
    try:
        data = _json.loads(txt)
    except Exception:
        m = _re.search(r"\{[\s\S]*\}", txt)
        if not m:
            return {}
        try:
            data = _json.loads(m.group(0))
        except Exception:
            return {}
    if not isinstance(data, dict):
        return {}
    # Sanitise
    out = {
        "communication_style": str(data.get("communication_style") or "")[:200],
        "strengths": [str(s)[:200] for s in (data.get("strengths") or []) if s][:4],
        "improvement_areas": [str(s)[:200] for s in (data.get("improvement_areas") or []) if s][:4],
        "overall_summary": str(data.get("overall_summary") or "")[:800],
    }
    return out


@api_router.get("/team-insights")
async def team_insights_list(user=Depends(get_current_user)):
    """Master-only. Lista dei collaboratori con mini-KPI aggregati.
    Non genera profili AI qui (troppo costoso) — solo metriche quantitative."""
    _require_master(user)
    tid = tenant_id(user)
    # Members = tutti gli utenti figli (esclude il master stesso)
    members = await db.users.find(
        {"parent_user_id": tid},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1, "areas": 1, "last_login_at": 1, "created_at": 1},
    ).to_list(500)
    out: List[dict] = []
    for m in members:
        metrics = await _compute_team_member_metrics(m["user_id"])
        out.append({
            "user_id": m["user_id"],
            "name": m.get("name") or "",
            "email": m.get("email") or "",
            "role": m.get("role") or "member",
            "picture": m.get("picture"),
            "areas": m.get("areas") or [],
            "metrics": metrics,
        })
    # Order: most active first (by chat_msgs_30d desc, then appts_30d desc)
    out.sort(
        key=lambda x: (
            x["metrics"].get("chat_msgs_30d", 0),
            x["metrics"].get("appts_30d", 0),
        ),
        reverse=True,
    )
    return {"items": out, "total": len(out)}


# =========================================================================
# V50.z310 — CONFRONTO COLLABORATORI (Master): KPI per periodo, classifica,
# medie di squadra e migliore per metrica. Dati per collaboratore = documenti
# del tenant con created_by = collaboratore (contatti, appuntamenti, chiamate,
# richiamate, contratti) + corsi (recipients/participation/attendance/certificates).
# =========================================================================
TEAM_COMPARE_PERIODS = {"30": 30, "90": 90, "365": 365, "all": None}

# (chiave, etichetta, unità, peso nel punteggio composito, migliore = più alto?)
TEAM_COMPARE_METRICS: List[Dict[str, Any]] = [
    {"key": "contracts", "label": "Contratti", "unit": "n", "weight": 3.0},
    {"key": "contracts_amount", "label": "Valore contratti", "unit": "€", "weight": 2.0},
    {"key": "appts_done", "label": "Appuntamenti svolti", "unit": "n", "weight": 2.0},
    {"key": "appts", "label": "Appuntamenti fissati", "unit": "n", "weight": 1.0},
    {"key": "contacts_new", "label": "Nuovi contatti", "unit": "n", "weight": 1.5},
    {"key": "calls", "label": "Chiamate", "unit": "n", "weight": 1.0},
    {"key": "call_minutes", "label": "Minuti al telefono", "unit": "min", "weight": 0.5},
    {"key": "callbacks_done", "label": "Richiamate fatte", "unit": "n", "weight": 1.0},
    {"key": "callbacks_pending", "label": "Richiamate in sospeso", "unit": "n", "weight": 0.0},
    {"key": "products_sold", "label": "Prodotti venduti (app.)", "unit": "n", "weight": 1.0},
    {"key": "courses_yes", "label": "Corsi: adesioni", "unit": "n", "weight": 0.5},
    {"key": "courses_present", "label": "Corsi: presenze", "unit": "n", "weight": 0.5},
    {"key": "certificates", "label": "Attestati", "unit": "n", "weight": 1.0},
    {"key": "chat_msgs", "label": "Domande ad Axon", "unit": "n", "weight": 0.5},
    {"key": "conversion_pct", "label": "Conversione contatti→contratti", "unit": "%", "weight": 1.5},
]


async def _tc_sum(coll, q: dict, field: str) -> float:
    cur = coll.aggregate([{"$match": q}, {"$group": {"_id": None, "s": {"$sum": {"$ifNull": [f"${field}", 0]}}}}])
    rows = await cur.to_list(1)
    try:
        return float((rows[0] if rows else {}).get("s") or 0)
    except Exception:
        return 0.0


async def _tc_member_kpi(tid: str, uid: str, since: Optional[datetime]) -> Dict[str, Any]:
    """KPI di UN collaboratore nel periodo (since=None → da sempre)."""
    now = utcnow()
    own = {"$or": [{"user_id": tid, "created_by": uid}, {"user_id": uid}]}

    def _p(field: str, extra: Optional[dict] = None) -> dict:
        q: dict = {**own, **(extra or {})}
        if since is not None:
            q[field] = {"$gte": since}
        return q

    contacts_new = await db.contacts.count_documents(_p("created_at"))

    appt_q = _p("start_at")
    if since is None:
        appt_q["start_at"] = {"$lte": now}
    else:
        appt_q["start_at"]["$lte"] = now
    appts = await db.appointments.count_documents(appt_q)
    appts_done = await db.appointments.count_documents({**appt_q, "done": True})
    appts_signed = await db.appointments.count_documents({**appt_q, "contract_signed": True})
    products_sold = await _tc_sum(db.appointments, appt_q, "products_sold")

    calls_q = _p("created_at")
    calls = await db.call_logs.count_documents(calls_q)
    call_minutes = round(await _tc_sum(db.call_logs, calls_q, "duration_sec") / 60.0, 1)

    cb_q = _p("created_at")
    cb_q["$or"] = cb_q["$or"] + [{"user_id": tid, "assignee_user_id": uid}]
    callbacks = await db.callbacks.count_documents(cb_q)
    callbacks_done = await db.callbacks.count_documents({**cb_q, "$and": [{"$or": [{"done": True}, {"status": "done"}]}]})
    callbacks_pending = max(0, callbacks - callbacks_done)

    ctr_q = _p("created_at")
    contracts = await db.contracts.count_documents(ctr_q)
    contracts_amount = round(await _tc_sum(db.contracts, ctr_q, "amount_eur"), 2)
    contracts_active = await db.contracts.count_documents({**ctr_q, "status": {"$in": ["active", "attivo", "signed", "firmato"]}})

    course_q: dict = {"recipients": uid}
    if since is not None:
        course_q["created_at"] = {"$gte": since}
    courses_yes = courses_present = certificates = courses_invited = 0
    async for c in db.courses.find(course_q, {"_id": 0, "participation": 1, "attendance": 1, "certificates": 1}):
        courses_invited += 1
        if ((c.get("participation") or {}).get(uid) or {}).get("status") == "yes":
            courses_yes += 1
        if ((c.get("attendance") or {}).get(uid) or {}).get("present"):
            courses_present += 1
        if (c.get("certificates") or {}).get(uid):
            certificates += 1

    chat_q: dict = {"user_id": uid, "role": "user"}
    if since is not None:
        chat_q["created_at"] = {"$gte": since}
    chat_msgs = await db.assistant_messages.count_documents(chat_q)

    conversion_pct = round(100.0 * contracts / contacts_new, 1) if contacts_new else 0.0
    return {
        "contacts_new": contacts_new,
        "appts": appts, "appts_done": appts_done, "appts_signed": appts_signed,
        "products_sold": int(products_sold),
        "calls": calls, "call_minutes": call_minutes,
        "callbacks": callbacks, "callbacks_done": callbacks_done, "callbacks_pending": callbacks_pending,
        "contracts": contracts, "contracts_amount": contracts_amount, "contracts_active": contracts_active,
        "courses_invited": courses_invited, "courses_yes": courses_yes, "courses_present": courses_present, "certificates": certificates,
        "chat_msgs": chat_msgs,
        "conversion_pct": conversion_pct,
    }


def _tc_score(kpi: Dict[str, Any], maxima: Dict[str, float]) -> float:
    """Punteggio composito 0-100: media pesata di valore/massimo-di-squadra per metrica."""
    num = den = 0.0
    for m in TEAM_COMPARE_METRICS:
        w = float(m.get("weight") or 0)
        mx = maxima.get(m["key"]) or 0
        if w <= 0 or mx <= 0:
            continue
        num += w * min(1.0, float(kpi.get(m["key"]) or 0) / mx)
        den += w
    return round(100.0 * num / den, 1) if den else 0.0


@api_router.get("/team-insights/compare")
async def team_insights_compare(period: str = "30", user=Depends(get_current_user)):
    """Master-only. Confronto KPI fra tutti i collaboratori diretti nel periodo
    (30 / 90 / 365 giorni / all). Restituisce membri con KPI + punteggio, classifica,
    media di squadra e miglior collaboratore per ogni metrica."""
    _require_master(user)
    tid = tenant_id(user)
    if period not in TEAM_COMPARE_PERIODS:
        raise HTTPException(status_code=400, detail="period deve essere 30, 90, 365 o all")
    days = TEAM_COMPARE_PERIODS[period]
    since = (utcnow() - timedelta(days=days)) if days else None

    members = await db.users.find(
        {"parent_user_id": tid},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1, "areas": 1},
    ).to_list(500)
    rows: List[dict] = []
    for m in members:
        kpi = await _tc_member_kpi(tid, m["user_id"], since)
        rows.append({
            "user_id": m["user_id"], "name": m.get("name") or m.get("email") or "?", "email": m.get("email") or "",
            "role": m.get("role") or "member", "picture": m.get("picture"), "areas": m.get("areas") or [],
            "kpi": kpi,
        })

    keys = [m["key"] for m in TEAM_COMPARE_METRICS]
    maxima = {k: max([float(r["kpi"].get(k) or 0) for r in rows] or [0]) for k in keys}
    n = len(rows) or 1
    team_avg = {k: round(sum(float(r["kpi"].get(k) or 0) for r in rows) / n, 1) for k in keys}
    team_total = {k: round(sum(float(r["kpi"].get(k) or 0) for r in rows), 1) for k in keys}
    best: Dict[str, Optional[str]] = {}
    for k in keys:
        if maxima[k] <= 0:
            best[k] = None
            continue
        best[k] = next((r["user_id"] for r in rows if float(r["kpi"].get(k) or 0) >= maxima[k]), None)
    for r in rows:
        r["score"] = _tc_score(r["kpi"], maxima)
        r["wins"] = sum(1 for k in keys if best.get(k) == r["user_id"] and (TEAM_COMPARE_METRICS[keys.index(k)].get("weight") or 0) > 0)
    rows.sort(key=lambda r: (r["score"], r["kpi"].get("contracts", 0), r["kpi"].get("appts_done", 0)), reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1

    return {
        "period": period, "days": days, "since": since.isoformat() if since else None,
        "generated_at": utcnow().isoformat(),
        "metrics": TEAM_COMPARE_METRICS,
        "members": rows, "total": len(rows),
        "team_avg": team_avg, "team_total": team_total, "best": best,
    }



@api_router.get("/team-insights/{member_user_id}")
async def team_insights_detail(member_user_id: str, user=Depends(get_current_user)):
    """Master-only. Profilo dettagliato di un collaboratore.
    Il profilo AI viene generato o servito dalla cache 24h."""
    _require_master(user)
    tid = tenant_id(user)
    member = await db.users.find_one(
        {"user_id": member_user_id, "parent_user_id": tid},
        {"_id": 0, "password_hash": 0, "sensitive_password_enc": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Collaboratore non trovato")

    metrics = await _compute_team_member_metrics(member_user_id)

    # Sample messages for topic extraction + LLM context
    since = utcnow() - timedelta(days=30)
    sample_cursor = db.assistant_messages.find(
        {"user_id": member_user_id, "created_at": {"$gte": since}},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", -1).limit(80)
    sample_msgs = [m async for m in sample_cursor]
    sample_msgs.reverse()
    topics = _score_topic_from_messages(sample_msgs)

    # Profile from cache
    now = utcnow()
    cache_doc = await db.team_member_profiles.find_one(
        {"tenant_id": tid, "user_id": member_user_id},
        {"_id": 0},
    )
    profile: Dict[str, Any] = {}
    from_cache = False
    if cache_doc:
        upd = cache_doc.get("updated_at")
        if isinstance(upd, datetime) and upd.tzinfo is None:
            upd = upd.replace(tzinfo=timezone.utc)
        if upd and (now - upd).total_seconds() < TEAM_PROFILE_CACHE_HOURS * 3600:
            profile = cache_doc.get("profile") or {}
            from_cache = True

    if not profile:
        profile = await _generate_behavioral_profile(member, metrics, topics, sample_msgs)
        if profile:
            await db.team_member_profiles.update_one(
                {"tenant_id": tid, "user_id": member_user_id},
                {"$set": {
                    "tenant_id": tid,
                    "user_id": member_user_id,
                    "profile": profile,
                    "updated_at": now,
                }},
                upsert=True,
            )

    return {
        "user_id": member_user_id,
        "name": member.get("name"),
        "email": member.get("email"),
        "role": member.get("role"),
        "areas": member.get("areas") or [],
        "picture": member.get("picture"),
        "metrics": metrics,
        "topics": topics,
        "profile": profile,
        "profile_from_cache": from_cache,
        "profile_generated_at": (cache_doc or {}).get("updated_at").isoformat() if from_cache and (cache_doc or {}).get("updated_at") and hasattr((cache_doc or {}).get("updated_at"), "isoformat") else now.isoformat(),
    }


@api_router.post("/team-insights/{member_user_id}/refresh-profile")
async def team_insights_refresh(member_user_id: str, user=Depends(get_current_user)):
    """Forza la rigenerazione del profilo AI di un collaboratore (bypassa la cache)."""
    _require_master(user)
    tid = tenant_id(user)
    member = await db.users.find_one(
        {"user_id": member_user_id, "parent_user_id": tid},
        {"_id": 0, "password_hash": 0, "sensitive_password_enc": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Collaboratore non trovato")
    metrics = await _compute_team_member_metrics(member_user_id)
    since = utcnow() - timedelta(days=30)
    sample_cursor = db.assistant_messages.find(
        {"user_id": member_user_id, "created_at": {"$gte": since}},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", -1).limit(80)
    sample_msgs = [m async for m in sample_cursor]
    sample_msgs.reverse()
    topics = _score_topic_from_messages(sample_msgs)
    profile = await _generate_behavioral_profile(member, metrics, topics, sample_msgs)
    if not profile:
        raise HTTPException(status_code=502, detail="Impossibile generare il profilo (LLM non disponibile o dati insufficienti)")
    now = utcnow()
    await db.team_member_profiles.update_one(
        {"tenant_id": tid, "user_id": member_user_id},
        {"$set": {
            "tenant_id": tid,
            "user_id": member_user_id,
            "profile": profile,
            "updated_at": now,
        }},
        upsert=True,
    )
    return {"ok": True, "profile": profile, "generated_at": now.isoformat()}


# =========================================================================
