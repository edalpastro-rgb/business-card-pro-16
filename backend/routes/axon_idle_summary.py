# axon_idle_summary.py — V50.z518 — AUTO-SUMMARY DOPO INATTIVITÀ (ottimizzazione costi API)
#   Ogni 5 minuti: per ogni sessione chat con ≥2 messaggi NON archiviati il cui ultimo messaggio risale a più di
#   AXON_IDLE_MINUTES (30) fa, genera con Claude Haiku un riassunto compatto (≤ AXON_IDLE_SUMMARY_MAX_TOKENS = 500 token),
#   archivia la cronologia precedente e la sostituisce con UN SOLO messaggio di contesto (role=assistant, summary=True).
#   Al messaggio successivo dell'utente la sliding window (V50.z517) invia quindi solo il riassunto (~500 token) invece di migliaia.
#   Idempotente: una sessione già ridotta al solo riassunto (1 messaggio) non viene rielaborata finché l'utente non scrive altro.
#   Il riassunto è visibile anche in GET /assistant/history (bolla «📝 Riassunto …») così l'utente capisce perché la chat è corta.
#   Dipendenze (namespace condiviso): db, logger, _axn_scheduler (37), _axon_llm_chat (19), _get_assistant_name (19).
from datetime import datetime as _is_dt, timezone as _is_tz, timedelta as _is_td

AXON_IDLE_MINUTES = 30
AXON_IDLE_SUMMARY_MAX_TOKENS = 500
_IS_PREFIX = "📝 Riassunto della conversazione precedente"


async def _is_summarize(user: dict, session_id: str, msgs: list) -> str:
    assistant_name = await _get_assistant_name(user)  # noqa: F821
    convo = "\n".join(f"{'Utente' if m.get('role') == 'user' else assistant_name}: {(m.get('content') or '')[:800]}" for m in msgs)
    from emergentintegrations.llm.chat import UserMessage
    chat = _axon_llm_chat(  # noqa: F821 — ANTHROPIC_API_KEY diretta se presente, altrimenti Emergent
        system_message=(
            "Sei un riassuntore. Ricevi una conversazione tra un consulente energetico e il suo assistente AI. Produci in ITALIANO un "
            "riassunto COMPATTO (massimo 350 parole) con: argomenti trattati, decisioni prese, dati concreti citati (nomi, numeri, date, "
            "importi), richieste ancora aperte e preferenze espresse dall'utente. Niente premesse, niente commenti: solo il riassunto."
        ),
        session_id=f"idle-summary-{session_id[-10:]}",
        model="claude-haiku-4-5",
        max_tokens=AXON_IDLE_SUMMARY_MAX_TOKENS,
    )
    out = await chat.send_message(UserMessage(text=convo))
    return (out or "").strip()


async def _is_compact_session(user_id: str, session_id: str) -> bool:
    """Riduce la sessione al solo riassunto. Ritorna True se ha fatto qualcosa."""
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})  # noqa: F821
    if not user:
        return False
    msgs = await db.assistant_messages.find(  # noqa: F821
        {"user_id": user_id, "session_id": session_id, "archived": {"$ne": True}},
        {"_id": 1, "role": 1, "content": 1, "created_at": 1, "summary": 1},
    ).sort("created_at", 1).to_list(200)
    if len(msgs) < 2:
        return False
    if len(msgs) == 1 and msgs[0].get("summary"):
        return False
    summary = await _is_summarize(user, session_id, msgs)
    if not summary:
        return False
    now = _is_dt.now(_is_tz.utc)
    ids = [m["_id"] for m in msgs]
    await db.assistant_messages.update_many({"_id": {"$in": ids}}, {"$set": {"archived": True, "archived_at": now, "idle_summarized": True}})  # noqa: F821
    await db.assistant_messages.insert_one({  # noqa: F821
        "user_id": user_id, "session_id": session_id, "role": "assistant", "summary": True,
        "content": f"{_IS_PREFIX} (dopo {AXON_IDLE_MINUTES} min di pausa, {len(msgs)} messaggi condensati):\n{summary}",
        "created_at": now, "archived": False,
    })
    logger.info("[idle-summary] sessione %s di %s: %d messaggi → riassunto (%d car.)", session_id[-10:], user_id[-8:], len(msgs), len(summary))  # noqa: F821
    return True


async def _is_tick() -> None:
    cutoff = _is_dt.now(_is_tz.utc) - _is_td(minutes=AXON_IDLE_MINUTES)
    try:
        # SOLO la sessione ATTIVA di ogni utente (db.assistant_active_session): è l'unica che verrà inviata al modello al prossimo
        # messaggio. Le sessioni vecchie/archiviate/di stress test non vengono toccate (nessun burst di chiamate al primo deploy).
        actives = await db.assistant_active_session.find({}, {"_id": 0, "user_id": 1, "session_id": 1}).to_list(5000)  # noqa: F821
        sids = [a["session_id"] for a in actives if a.get("session_id")]
        pipeline = [
            {"$match": {"archived": {"$ne": True}, "session_id": {"$in": sids}}},
            {"$group": {"_id": {"u": "$user_id", "s": "$session_id"}, "last": {"$max": "$created_at"}, "n": {"$sum": 1}}},
            {"$match": {"n": {"$gte": 2}, "last": {"$lt": cutoff}}},
            {"$limit": 50},
        ]
        groups = await db.assistant_messages.aggregate(pipeline).to_list(50)  # noqa: F821
    except Exception as e:  # noqa: BLE001
        logger.warning("[idle-summary] query fallita: %s", e)  # noqa: F821
        return
    done = 0
    for g in groups:
        uid, sid = g["_id"].get("u"), g["_id"].get("s")
        if not uid or not sid:
            continue
        try:
            if await _is_compact_session(uid, sid):
                done += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("[idle-summary] %s/%s fallita: %s", uid[-8:], sid[-10:], e)  # noqa: F821
    if done:
        logger.info("[idle-summary] %d sessioni condensate", done)  # noqa: F821


@api_router.post("/assistant/history/compact")  # noqa: F821
async def assistant_history_compact(user=Depends(get_current_user)):  # noqa: F821
    """Compattazione manuale della sessione attiva (stessa logica dell'auto-summary) — utile per test e per il bottone futuro."""
    active = await db.assistant_active_session.find_one({"user_id": user["user_id"]}, {"_id": 0, "session_id": 1})  # noqa: F821
    sid = (active or {}).get("session_id")
    if not sid:
        return {"ok": False, "reason": "nessuna sessione attiva"}
    ok = await _is_compact_session(user["user_id"], sid)
    return {"ok": ok, "session_id": sid}


@app.on_event("startup")  # noqa: F821
async def _is_start():
    try:
        _axn_scheduler.add_job(_is_tick, "interval", minutes=5, id="idle-summary-tick", replace_existing=True, max_instances=1, coalesce=True)  # noqa: F821
        logger.info("[idle-summary] auto-summary dopo %d min di inattività attivo (tick 5 min, max %d token)", AXON_IDLE_MINUTES, AXON_IDLE_SUMMARY_MAX_TOKENS)  # noqa: F821
    except Exception as e:  # noqa: BLE001
        logger.warning("[idle-summary] scheduler non avviato: %s", e)  # noqa: F821
