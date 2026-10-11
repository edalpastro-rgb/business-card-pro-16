# axon_idle_summary.py — V50.z518 — AUTO-SUMMARY DOPO INATTIVITÀ (ottimizzazione costi API)
#   Ogni 5 minuti: per ogni sessione chat con ≥2 messaggi NON archiviati il cui ultimo messaggio risale a più di
#   AXON_IDLE_MINUTES (30) fa, genera con Claude Haiku un riassunto compatto (≤ AXON_IDLE_SUMMARY_MAX_TOKENS = 300 token; input: ultimi 5 msg × 200 car., < 1000 car.),
#   archivia la cronologia precedente e la sostituisce con UN SOLO messaggio di contesto (role=assistant, summary=True).
#   Al messaggio successivo dell'utente la sliding window (V50.z517) invia quindi solo il riassunto (~500 token) invece di migliaia.
#   Idempotente: una sessione già ridotta al solo riassunto (1 messaggio) non viene rielaborata finché l'utente non scrive altro.
#   Il riassunto è visibile anche in GET /assistant/history (bolla «📝 Riassunto …») così l'utente capisce perché la chat è corta.
#   Dipendenze (namespace condiviso): db, logger, _axn_scheduler (37), _axon_llm_chat (19), _get_assistant_name (19).
from datetime import datetime as _is_dt, timezone as _is_tz, timedelta as _is_td

AXON_IDLE_MINUTES = 30
AXON_IDLE_SUMMARY_MAX_TOKENS = 300  # V50.z522 — 500 → 300 token di output
AXON_IDLE_INPUT_MSGS = 5  # V50.z522 — al riassuntore vanno SOLO gli ultimi 5 messaggi (z521: 10)
AXON_IDLE_MSG_CHARS = 200  # V50.z522 — ogni messaggio troncato a 200 car. (z521: 800)
AXON_IDLE_INPUT_MAX_CHARS = 1000  # V50.z522 — tetto assoluto dell'input complessivo al riassuntore
_IS_PREFIX = "📝 Riassunto della conversazione precedente"


async def _is_summarize(user: dict, session_id: str, msgs: list) -> str:
    assistant_name = await _get_assistant_name(user)  # noqa: F821
    msgs = msgs[-AXON_IDLE_INPUT_MSGS:]  # V50.z522 — ultimi 5 messaggi, 200 car. ciascuno, totale < 1000 car.
    lines = []
    for m in msgs:
        c = " ".join((m.get("content") or "").split())  # compatta spazi/righe (il riassunto precedente ha a capo multipli)
        lines.append(f"{'U' if m.get('role') == 'user' else 'A'}: {c[:AXON_IDLE_MSG_CHARS]}")
    convo = "\n".join(lines)
    if len(convo) > AXON_IDLE_INPUT_MAX_CHARS:  # tetto assoluto: taglio dall'inizio (i messaggi più vecchi)
        convo = convo[-AXON_IDLE_INPUT_MAX_CHARS:]
    from emergentintegrations.llm.chat import UserMessage
    chat = _axon_llm_chat(  # noqa: F821 — ANTHROPIC_API_KEY diretta se presente, altrimenti Emergent
        system_message=(
            "Sei un riassuntore. Ricevi gli ultimi scambi (U = utente consulente energetico, A = assistente AI). Produci in ITALIANO un "
            "riassunto COMPATTO (massimo 180 parole) con: argomenti, decisioni, dati concreti citati (nomi, numeri, date, importi), "
            "richieste aperte. Niente premesse, niente commenti: solo il riassunto."
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
    # V50.z521 — sessione già riassunta (flag su db.assistant_active_session / assistant_sessions_summarized) → mai più riprocessata
    if await db.assistant_sessions_summarized.find_one({"session_id": session_id}, {"_id": 1}):  # noqa: F821
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
    # V50.z521 — flag persistente: summarized=true + data → il job non la riprocessa mai più (anche se l'utente riprende a scrivere,
    # la sessione resta marcata; una NUOVA sessione dopo «Nuova chat» non ha il flag e verrà gestita normalmente)
    await db.assistant_sessions_summarized.update_one(  # noqa: F821
        {"session_id": session_id},
        {"$set": {"user_id": user_id, "summarized": True, "summarized_at": now, "messages_condensed": len(msgs), "input_messages": min(len(msgs), AXON_IDLE_INPUT_MSGS)}},
        upsert=True,
    )
    await db.assistant_active_session.update_one({"user_id": user_id, "session_id": session_id}, {"$set": {"summarized": True, "summarized_at": now}})  # noqa: F821
    logger.info("[idle-summary] sessione %s di %s: %d messaggi → riassunto (%d car., input ultimi %d) · flag summarized", session_id[-10:], user_id[-8:], len(msgs), len(summary), min(len(msgs), AXON_IDLE_INPUT_MSGS))  # noqa: F821
    return True


async def _is_tick() -> None:
    cutoff = _is_dt.now(_is_tz.utc) - _is_td(minutes=AXON_IDLE_MINUTES)
    try:
        # SOLO la sessione ATTIVA di ogni utente (db.assistant_active_session): è l'unica che verrà inviata al modello al prossimo
        # messaggio. Le sessioni vecchie/archiviate/di stress test non vengono toccate (nessun burst di chiamate al primo deploy).
        actives = await db.assistant_active_session.find({}, {"_id": 0, "user_id": 1, "session_id": 1}).to_list(5000)  # noqa: F821
        done_sids = {d["session_id"] async for d in db.assistant_sessions_summarized.find({}, {"_id": 0, "session_id": 1})}  # noqa: F821
        sids = [a["session_id"] for a in actives if a.get("session_id") and a["session_id"] not in done_sids]  # V50.z521 — già riassunte: mai più
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
