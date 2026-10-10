# 24_axon_quick_actions_memory.py — AxonOS: quick actions + endpoint memoria
# Estratto da server.py (righe originali 17169-17420). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V29.ag — Axon Quick Actions con cache server-side + auto-refresh.
#
# Flow:
#  1) Il client (chat AxonOS) invoca POST /api/axon/quick-action con {label, prompt}
#  2) Server cerca in db.axon_qa_cache un doc (user_id, label). Se `updated_at`
#     è entro `QA_CACHE_TTL_DAYS` giorni → risposta istantanea dalla cache.
#  3) Se cache mancante o stale → chiama internamente `assistant_chat` con un
#     prompt arricchito che istruisce l'LLM a recuperare autonomamente i dati
#     dalle fonti già configurate nelle regole (URL, file allegati). L'LLM
#     esistente già ha accesso a web search + file delle regole → nessuna
#     richiesta esplicita di upload lato utente.
#  4) La risposta viene persistita in cache con timestamp, poi restituita
#     al client con `from_cache=false` e `updated_at`.
# =========================================================================

QA_CACHE_TTL_DAYS = 7


async def _qa_deterministic(label: str, prompt: str, user: dict) -> Optional[dict]:
    """V50.z206 — hook: risposta deterministica (calcolatore) per alcune azioni rapide. Ridefinito in axon_pun_quick.py."""
    return None


class AxonQuickActionIn(BaseModel):
    label: str
    prompt: str
    force_refresh: bool = False
    # V50.z126 — Solo lookup cache: su miss ritorna subito {"reply": None, "miss": True}
    # così il client passa allo streaming SSE invece di attendere una POST bloccante.
    cache_only: bool = False


def _qa_enrich_prompt(prompt: str) -> str:
    return (
        f"{prompt}\n\n"
        "ISTRUZIONI OPERATIVE:\n"
        "- Usa i file e link presenti nelle 'regole' come fonte primaria.\n"
        "- Se il dato richiesto non è aggiornato nelle regole, cerca autonomamente "
        "online (web_search) SOLO nelle fonti/link già indicati nelle regole "
        "o in fonti ufficiali equivalenti (es. GME per PUN, ARERA per bollette).\n"
        "- Non chiedere mai all'utente di caricare file: recupera tutto da solo.\n"
        "- Formatta la risposta in modo chiaro (tabelle Markdown se utile) e "
        "specifica sempre la fonte/data del dato."
    )


@api_router.post("/axon/quick-action")
async def axon_quick_action(body: AxonQuickActionIn, user=Depends(get_current_user)):
    label = (body.label or "").strip()
    prompt = (body.prompt or "").strip()
    if not label or not prompt:
        raise HTTPException(status_code=400, detail="label e prompt richiesti")

    now = utcnow()
    key = {"user_id": user["user_id"], "label": label}

    # V50.z206 — Azioni rapide deterministiche (es. tabella PUN): risposta dal backend, mai dall'LLM, mai da cache stale.
    det = await _qa_deterministic(label, prompt, user)
    if det:
        return det

    # 1) Cache lookup
    if not body.force_refresh:
        cached = await db.axon_qa_cache.find_one(key, {"_id": 0})
        if cached:
            updated = cached.get("updated_at")
            try:
                if isinstance(updated, str):
                    updated_dt = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                elif isinstance(updated, datetime):
                    updated_dt = updated
                else:
                    updated_dt = None
            except Exception:
                updated_dt = None
            if updated_dt:
                # normalizza tz-aware
                if updated_dt.tzinfo is None:
                    updated_dt = updated_dt.replace(tzinfo=timezone.utc)
                age_days = (now - updated_dt).total_seconds() / 86400.0
                if age_days < QA_CACHE_TTL_DAYS and cached.get("reply"):
                    return {
                        "reply": cached["reply"],
                        "updated_at": updated_dt.isoformat(),
                        "from_cache": True,
                        "cache_age_days": round(age_days, 2),
                    }

    if body.cache_only:
        return {"reply": None, "updated_at": None, "from_cache": False, "miss": True}

    # 2) Cache stale/missing → richiesta all'LLM con istruzioni di auto-refresh.
    enriched_prompt = _qa_enrich_prompt(prompt)

    chat_body = AssistantChatIn(message=enriched_prompt, session_id=None, attachments=[])
    try:
        result = await assistant_chat(chat_body, user)  # type: ignore[arg-type]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-refresh Axon fallito: {e}")

    reply = (result or {}).get("reply", "") if isinstance(result, dict) else ""
    if not reply:
        raise HTTPException(status_code=500, detail="Risposta vuota dall'assistente")

    # 3) Persist in cache
    await db.axon_qa_cache.update_one(
        key,
        {
            "$set": {
                **key,
                "reply": reply,
                "updated_at": now,
                "web_sources": (result.get("web_sources") if isinstance(result, dict) else []) or [],
                "used_web_search": bool(result.get("used_web_search")) if isinstance(result, dict) else False,
            }
        },
        upsert=True,
    )

    return {
        "reply": reply,
        "updated_at": now.isoformat(),
        "from_cache": False,
        "cache_age_days": 0.0,
    }


@api_router.get("/assistant/history")
async def assistant_history(session_id: Optional[str] = None, user=Depends(get_current_user)):
    """Load conversation history. V50.z385 — senza session_id restituisce SOLO la sessione ATTIVA
    (db.assistant_active_session); le sessioni chiuse con «Nuova chat» sono archiviate e non riappaiono mai."""
    uid = user["user_id"]
    # Sessione richiesta dal client (persistita in AsyncStorage): valida solo se ha ancora messaggi NON archiviati
    if session_id:
        ok = await db.assistant_messages.find_one({"user_id": uid, "session_id": session_id, "archived": {"$ne": True}}, {"_id": 1})
        if not ok:
            session_id = None
    if not session_id:
        # Conversazione corrente = ultimo messaggio non archiviato (il reset archivia tutto il precedente)
        latest = await db.assistant_messages.find_one(
            {"user_id": uid, "archived": {"$ne": True}}, {"session_id": 1}, sort=[("created_at", -1)]
        )
        if latest:
            session_id = latest["session_id"]
        else:
            active = await db.assistant_active_session.find_one({"user_id": uid}, {"session_id": 1})
            return {"session_id": (active or {}).get("session_id"), "messages": [], "assistant_name": await _get_assistant_name(user)}

    cursor = db.assistant_messages.find(
        {"user_id": uid, "session_id": session_id, "archived": {"$ne": True}},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", 1).limit(100)
    msgs = [m async for m in cursor]
    return {
        "session_id": session_id,
        "messages": msgs,
        "assistant_name": await _get_assistant_name(user),
    }


@api_router.get("/assistant/unread")
async def assistant_unread(user=Depends(get_current_user)):
    """V50.z383 — Ultimo messaggio scritto da Axon (chat, proattività, push bridge): il FAB lo confronta con l'ultima
    apertura della chat per lampeggiare in verde quando c'è un messaggio non letto."""
    last = await db.assistant_messages.find_one(
        {"user_id": user["user_id"], "role": "assistant", "archived": {"$ne": True}}, {"created_at": 1, "message_id": 1}, sort=[("created_at", -1)]
    )
    at = (last or {}).get("created_at")
    if isinstance(at, datetime):
        at = at.isoformat()
    return {"last_assistant_at": at, "message_id": (last or {}).get("message_id")}


@api_router.post("/assistant/reset")
async def assistant_reset(user=Depends(get_current_user)):
    """Start a new conversation. V50.z385 — le sessioni precedenti vengono ARCHIVIATE (archived=True) e la nuova
    sessione diventa quella attiva (db.assistant_active_session): «Nuova chat» non fa più riapparire la vecchia."""
    uid = user["user_id"]
    session_id = f"asst_{uid}_{uuid.uuid4().hex[:10]}"
    await db.assistant_messages.update_many(
        {"user_id": uid, "archived": {"$ne": True}}, {"$set": {"archived": True, "archived_at": datetime.now(timezone.utc)}}
    )
    await db.assistant_active_session.update_one(
        {"user_id": uid},
        {"$set": {"session_id": session_id, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"session_id": session_id, "assistant_name": await _get_assistant_name(user)}


# V50.z517 — «Pulisci Memoria» (chat vocale): azzera la cronologia della sessione ATTIVA mantenendo lo stesso session_id
# (la sessione resta aperta, il modello riparte senza contesto). I messaggi vengono archiviati, non cancellati.
@api_router.post("/assistant/history/clear")
async def assistant_history_clear(user=Depends(get_current_user)):
    uid = user["user_id"]
    active = await db.assistant_active_session.find_one({"user_id": uid}, {"_id": 0, "session_id": 1})
    sid = (active or {}).get("session_id")
    q: dict = {"user_id": uid, "archived": {"$ne": True}}
    if sid:
        q["session_id"] = sid
    r = await db.assistant_messages.update_many(q, {"$set": {"archived": True, "archived_at": datetime.now(timezone.utc), "cleared": True}})
    return {"ok": True, "session_id": sid, "cleared": r.modified_count}


# ============================================================
# V38T — Neo persistent memory endpoints
# ============================================================
@api_router.get("/assistant/memory")
async def list_neo_memories(user=Depends(get_current_user)):
    """List all persistent memories saved by Neo for the current user."""
    cursor = db.neo_memory.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "memory_id": 1, "summary": 1, "facts": 1, "created_at": 1, "session_id": 1},
    ).sort("created_at", -1).limit(200)
    items = [m async for m in cursor]
    return {"items": items, "total": len(items)}


@api_router.delete("/assistant/memory/{memory_id}")
async def delete_neo_memory(memory_id: str, user=Depends(get_current_user)):
    res = await db.neo_memory.delete_one({"user_id": user["user_id"], "memory_id": memory_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Memoria non trovata")
    return {"deleted": True, "memory_id": memory_id}


@api_router.delete("/assistant/memory")
async def clear_all_neo_memories(user=Depends(get_current_user)):
    res = await db.neo_memory.delete_many({"user_id": user["user_id"]})
    return {"deleted_count": res.deleted_count}


class SaveNeoResponseIn(BaseModel):
    content: str
    name: str
    session_id: Optional[str] = None
    category: Optional[str] = "notes"  # notes | files | analisi


@api_router.post("/assistant/save-to-master")
async def save_neo_response_to_master(body: SaveNeoResponseIn, user=Depends(get_current_user)):
    """V38T — Persist a Neo response as a text/markdown file in the Master's
    file cabinet. Used by the "Salva nei file Master" button in the assistant."""
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Contenuto vuoto")
    name = (body.name or "").strip() or f"Neo-{datetime.now().strftime('%Y%m%d-%H%M')}"
    if not name.lower().endswith((".txt", ".md", ".html")):
        name = f"{name}.md"
    category = body.category if body.category in ALLOWED_MASTER_CATS else "notes"
    b64 = base64.b64encode(content.encode("utf-8")).decode("ascii")
    file_id = f"mf_{uuid.uuid4().hex[:12]}"
    mime = "text/markdown" if name.endswith(".md") else ("text/html" if name.endswith(".html") else "text/plain")
    doc = {
        "file_id": file_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "category": category,
        "name": name,
        "title": f"Risposta Neo — {name}",
        "body": content if len(content) < 2000 else content[:2000] + "…",
        "mime": mime,
        "data_base64": b64,
        "size": len(content.encode("utf-8")),
        "created_at": utcnow(),
        "updated_at": utcnow(),
        "source": "neo-assistant",
        "source_session_id": body.session_id,
    }
    await db.master_files.insert_one(doc)
    return {"file_id": file_id, "name": name, "category": category, "size": doc["size"]}





@api_router.post("/assistant/tts")
async def assistant_tts(body: AssistantTTSIn, user=Depends(get_current_user)):
    """V50.z347 — TTS unificato: Kokoro locale (default) o OpenAI cloud secondo user_settings.assistant_tts_engine, con fallback."""
    return await axon_tts_generate(user, body.text, body.voice, body.speed, force=bool(body.force))


# =========================
