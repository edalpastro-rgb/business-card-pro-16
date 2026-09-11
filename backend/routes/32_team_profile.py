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
