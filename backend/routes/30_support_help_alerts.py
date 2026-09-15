# 30_support_help_alerts.py — Supporto in-app, Help Center, Axon alerts
# Estratto da server.py (righe originali 21197-21603). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V49.j — In-app support ("Bug, Errori e Idee")
#
# Widget FAB accessibile da ogni pagina. L'utente descrive il problema
# (checklist preconfigurata + testo libero + allegati opzionali) e Axon
# (Claude Sonnet 5) prova a risolverlo. Se dopo 2 tentativi il problema
# non è risolto la segnalazione viene escalata al Master del tenant.
# Ogni risposta AI può essere votata con 👍/👎.
# =========================================================================
SUPPORT_ESCALATE_AFTER = 2

SUPPORT_PRESETS = [
    {"id": "app_slow", "label": "L'app è lenta / non risponde"},
    {"id": "login_issue", "label": "Non riesco ad accedere / logout inatteso"},
    {"id": "sync_issue", "label": "I dati non si sincronizzano tra dispositivi"},
    {"id": "notification", "label": "Non ricevo notifiche"},
    {"id": "axon_wrong", "label": "Axon dà risposte sbagliate o poco utili"},
    {"id": "ui_glitch", "label": "Grafica rotta / bottoni nascosti / testo sovrapposto"},
    {"id": "file_upload", "label": "Errore nel caricamento file / documenti"},
    {"id": "call_issue", "label": "Problemi con chiamate / registrazione durata"},
    {"id": "calendar_issue", "label": "Problemi con calendario / appuntamenti"},
    {"id": "idea", "label": "Non è un bug: ho un'idea da proporre"},
]


class SupportMessageIn(BaseModel):
    checks: List[str] = Field(default_factory=list)
    text: str = ""
    attachments: List[Dict[str, Any]] = Field(default_factory=list)  # [{name, mime, data_base64}]


class SupportFeedbackIn(BaseModel):
    reply_index: int
    vote: Literal["up", "down"]


async def _support_ai_reply(user: dict, ticket: dict, message: dict) -> str:
    """Chiedi a Claude Sonnet 5 una risposta di supporto in italiano."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return "Grazie della segnalazione. Il tuo Master è stato avvisato."
    presets_map = {p["id"]: p["label"] for p in SUPPORT_PRESETS}
    checks_labels = [presets_map.get(cid, cid) for cid in (message.get("checks") or [])]
    history: List[Dict[str, Any]] = ticket.get("messages", [])[:-1][-4:]
    system = (
        "Sei un tecnico di supporto in-app di AdvisorOS/AxonOS. Rispondi SEMPRE in italiano, "
        "chiaro e conciso (max 4-6 frasi). Non inventare feature. Se il problema è chiaramente "
        "un bug o richiede modifiche al software rispondi in modo empatico e informa che la "
        "segnalazione verrà rivista dal team. Se il problema può essere risolto lato utente "
        "fornisci 2-3 passi pratici numerati. Non chiedere info personali."
    )
    parts: List[str] = []
    if history:
        parts.append("Storico segnalazione (breve):")
        for h in history:
            role = "Utente" if h.get("from") == "user" else "Axon"
            parts.append(f"- {role}: {(h.get('text') or '')[:200]}")
    parts.append("Nuovo messaggio utente:")
    if checks_labels:
        parts.append("Problemi selezionati: " + " · ".join(checks_labels))
    if message.get("text"):
        parts.append(f"Note: {message['text'][:600]}")
    if message.get("attachments"):
        parts.append(f"Allegati: {len(message['attachments'])} file")
    chat = LlmChat(
        api_key=key,
        session_id=f"support-{ticket['ticket_id'][:8]}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-5")
    try:
        raw = await chat.send_message(UserMessage(text="\n".join(parts)))
        return (raw or "").strip() or "Grazie, prendo in carico e ti richiamo appena analizzo il problema."
    except Exception as exc:
        logger.warning("[support] LLM error: %s", exc)
        return "Grazie della segnalazione. Il team la sta esaminando."


def _support_serialize(t: dict) -> dict:
    """Rimuove i base64 pesanti per la lista."""
    out = {k: v for k, v in t.items() if k not in ("_id",)}
    msgs = []
    for m in out.get("messages", []):
        m2 = {k: v for k, v in m.items() if k != "attachments"}
        m2["attachments"] = [
            {"name": a.get("name"), "mime": a.get("mime"), "size": a.get("size")}
            for a in (m.get("attachments") or [])
        ]
        msgs.append(m2)
    out["messages"] = msgs
    for k in ("created_at", "updated_at", "escalated_at"):
        v = out.get(k)
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out


@api_router.get("/support/presets")
async def support_presets(_user=Depends(get_current_user)):
    return {"items": SUPPORT_PRESETS}


@api_router.post("/support/tickets")
async def support_create_ticket(body: SupportMessageIn, user=Depends(get_current_user)):
    tid_ = f"stkt_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    # sanitize attachments
    atts = []
    for a in (body.attachments or [])[:5]:
        b64 = str(a.get("data_base64") or "")
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        if not b64:
            continue
        approx = int(len(b64) * 0.75)
        if approx > 6 * 1024 * 1024:
            continue
        atts.append({
            "name": (a.get("name") or "allegato")[:120],
            "mime": (a.get("mime") or "application/octet-stream")[:80],
            "size": approx,
            "data_base64": b64,
        })
    user_msg = {
        "from": "user",
        "text": (body.text or "")[:2000],
        "checks": body.checks or [],
        "attachments": atts,
        "created_at": now,
    }
    ticket = {
        "ticket_id": tid_,
        "user_id": user["user_id"],
        "user_name": user.get("name"),
        "user_email": user.get("email"),
        "tenant_id": tenant_id(user),
        "status": "open",   # open | escalated | resolved
        "attempts": 1,
        "messages": [user_msg],
        "created_at": now,
        "updated_at": now,
    }
    ai_reply = await _support_ai_reply(user, ticket, user_msg)
    ticket["messages"].append({
        "from": "ai",
        "text": ai_reply,
        "created_at": utcnow(),
        "attachments": [],
    })
    ticket["updated_at"] = utcnow()
    await db.support_tickets.insert_one(ticket)
    return _support_serialize(ticket)


@api_router.post("/support/tickets/{ticket_id}/reply")
async def support_reply_ticket(ticket_id: str, body: SupportMessageIn, user=Depends(get_current_user)):
    t = await db.support_tickets.find_one({"ticket_id": ticket_id, "user_id": user["user_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    if t.get("status") == "resolved":
        raise HTTPException(status_code=400, detail="Ticket già risolto")
    now = utcnow()
    atts = []
    for a in (body.attachments or [])[:5]:
        b64 = str(a.get("data_base64") or "")
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        if not b64:
            continue
        approx = int(len(b64) * 0.75)
        if approx > 6 * 1024 * 1024:
            continue
        atts.append({
            "name": (a.get("name") or "allegato")[:120],
            "mime": (a.get("mime") or "application/octet-stream")[:80],
            "size": approx,
            "data_base64": b64,
        })
    user_msg = {"from": "user", "text": (body.text or "")[:2000], "checks": body.checks or [], "attachments": atts, "created_at": now}
    t["messages"].append(user_msg)
    t["attempts"] = int(t.get("attempts") or 0) + 1
    ai_reply = await _support_ai_reply(user, t, user_msg)
    t["messages"].append({"from": "ai", "text": ai_reply, "created_at": utcnow(), "attachments": []})
    escalate = t["attempts"] >= SUPPORT_ESCALATE_AFTER and t.get("status") == "open"
    if escalate:
        t["status"] = "escalated"
        t["escalated_at"] = utcnow()
    t["updated_at"] = utcnow()
    await db.support_tickets.update_one(
        {"ticket_id": ticket_id},
        {"$set": {k: v for k, v in t.items() if k != "_id"}},
    )
    return _support_serialize(t)


@api_router.post("/support/tickets/{ticket_id}/feedback")
async def support_feedback(ticket_id: str, body: SupportFeedbackIn, user=Depends(get_current_user)):
    t = await db.support_tickets.find_one({"ticket_id": ticket_id, "user_id": user["user_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    idx = int(body.reply_index)
    msgs = t.get("messages", [])
    if idx < 0 or idx >= len(msgs) or msgs[idx].get("from") != "ai":
        raise HTTPException(status_code=400, detail="reply_index non valido")
    msgs[idx]["feedback"] = body.vote
    updates: Dict[str, Any] = {"messages": msgs, "updated_at": utcnow()}
    if body.vote == "up" and t.get("status") != "resolved":
        updates["status"] = "resolved"
        updates["resolved_at"] = utcnow()
    await db.support_tickets.update_one({"ticket_id": ticket_id}, {"$set": updates})
    # Persist also as generic AI feedback for future learning
    try:
        await db.assistant_feedback.insert_one({
            "source": "support",
            "ticket_id": ticket_id,
            "message_index": idx,
            "text": msgs[idx].get("text", ""),
            "vote": body.vote,
            "user_id": user["user_id"],
            "tenant_id": tenant_id(user),
            "created_at": utcnow(),
        })
    except Exception:
        pass
    t.update(updates)
    return _support_serialize(t)


@api_router.get("/support/tickets/mine")
async def support_my_tickets(user=Depends(get_current_user)):
    cur = db.support_tickets.find({"user_id": user["user_id"]}).sort("updated_at", -1)
    items = [_support_serialize(t) async for t in cur]
    return {"items": items, "total": len(items)}


@api_router.get("/support/tickets")
async def support_master_tickets(status: Optional[str] = None, user=Depends(get_current_user)):
    """Master-only: elenco di tutti i ticket del tenant."""
    _require_master(user)
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if status:
        q["status"] = status
    cur = db.support_tickets.find(q).sort("updated_at", -1)
    items = [_support_serialize(t) async for t in cur]
    counts = {
        "total": len(items),
        "open": sum(1 for it in items if it.get("status") == "open"),
        "escalated": sum(1 for it in items if it.get("status") == "escalated"),
        "resolved": sum(1 for it in items if it.get("status") == "resolved"),
    }
    return {"items": items, **counts}


# =========================================================================
# V50.z17 — HELP CENTER (Termini d'uso + richieste cancellazione dati)
#
# Al primo utilizzo di AxonOS l'utente vede una schermata con i termini di
# utilizzo dell'assistente AI. Da lì può richiedere la cancellazione dei
# propri dati. Ogni richiesta è registrata e visibile al Master (admin).
# =========================================================================

def _help_center_serialize(r: dict) -> dict:
    return {
        "request_id": r.get("request_id"),
        "user_id": r.get("user_id"),
        "user_email": r.get("user_email"),
        "user_name": r.get("user_name"),
        "reason": r.get("reason", ""),
        "status": r.get("status", "pending"),
        "handled_by": r.get("handled_by"),
        "handled_at": r.get("handled_at").isoformat() if r.get("handled_at") else None,
        "created_at": r.get("created_at").isoformat() if r.get("created_at") else None,
    }


@api_router.post("/help-center/data-deletion-request")
async def help_center_deletion_request(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Registra una richiesta di cancellazione dati. Aperto a qualsiasi utente."""
    reason = (payload or {}).get("reason") or ""
    reason = reason.strip()[:2000]
    doc = {
        "request_id": str(uuid.uuid4()),
        "tenant_id": tenant_id(user),
        "user_id": user["user_id"],
        "user_email": user.get("email"),
        "user_name": user.get("name") or user.get("email"),
        "reason": reason,
        "status": "pending",
        "handled_by": None,
        "handled_at": None,
        "created_at": datetime.utcnow(),
    }
    await db.help_center_deletion_requests.insert_one(doc)
    return _help_center_serialize(doc)


@api_router.get("/help-center/data-deletion-requests")
async def help_center_list_requests(status: Optional[str] = None, user=Depends(get_current_user)):
    """Master-only: elenca tutte le richieste di cancellazione dati del tenant."""
    _require_master(user)
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if status:
        q["status"] = status
    cur = db.help_center_deletion_requests.find(q).sort("created_at", -1)
    items = [_help_center_serialize(r) async for r in cur]
    counts = {
        "total": len(items),
        "pending": sum(1 for it in items if it.get("status") == "pending"),
        "handled": sum(1 for it in items if it.get("status") == "handled"),
    }
    return {"items": items, **counts}


@api_router.post("/help-center/data-deletion-requests/{request_id}/handle")
async def help_center_mark_handled(request_id: str, payload: Dict[str, Any] = Body(default={}), user=Depends(get_current_user)):
    """Master-only: marca una richiesta come gestita."""
    _require_master(user)
    r = await db.help_center_deletion_requests.find_one({"request_id": request_id, "tenant_id": tenant_id(user)})
    if not r:
        raise HTTPException(404, "Richiesta non trovata")
    new_status = (payload or {}).get("status", "handled")
    if new_status not in ("pending", "handled", "rejected"):
        new_status = "handled"
    await db.help_center_deletion_requests.update_one(
        {"request_id": request_id},
        {"$set": {
            "status": new_status,
            "handled_by": user["user_id"],
            "handled_at": datetime.utcnow(),
        }},
    )
    r2 = await db.help_center_deletion_requests.find_one({"request_id": request_id})
    return _help_center_serialize(r2 or {})


# =========================================================================
# V50.z20 — AXON ALERTS (notifiche in-app per eventi Axon)
# Es. nuovo PDF pubblicato da GME/ARERA/ecc. Ogni utente vede i propri alert.
# =========================================================================

def _axon_alert_serialize(a: dict) -> dict:
    return {
        "alert_id": a.get("alert_id"),
        "type": a.get("type"),
        "title": a.get("title"),
        "message": a.get("message"),
        "url_id": a.get("url_id"),
        "source_url": a.get("source_url"),
        "pdf_url": a.get("pdf_url"),
        "pdf_name": a.get("pdf_name"),
        "route": a.get("route"),  # V50.z261 — deep link (es. report stress test)
        "seen": bool(a.get("seen")),
        "created_at": a.get("created_at").isoformat() if a.get("created_at") else None,
    }


@api_router.get("/axon-alerts")
async def axon_alerts_list(unread_only: bool = False, limit: int = 50, user=Depends(get_current_user)):
    """Lista alert Axon del tenant + conteggio non letti."""
    tid = tenant_id(user)
    q: Dict[str, Any] = {"tenant_id": tid}
    if unread_only:
        q["seen"] = False
    cur = db.axon_alerts.find(q).sort("created_at", -1).limit(max(1, min(limit, 200)))
    items = [_axon_alert_serialize(a) async for a in cur]
    unread = await db.axon_alerts.count_documents({"tenant_id": tid, "seen": False})
    return {"items": items, "unread": unread}


@api_router.get("/axon-alerts/unread-count")
async def axon_alerts_unread_count(user=Depends(get_current_user)):
    """Solo il conteggio non letti (leggero, per polling frequente/badge)."""
    tid = tenant_id(user)
    unread = await db.axon_alerts.count_documents({"tenant_id": tid, "seen": False})
    return {"unread": unread}


@api_router.post("/axon-alerts/{alert_id}/seen")
async def axon_alerts_mark_seen(alert_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.axon_alerts.update_one(
        {"alert_id": alert_id, "tenant_id": tid},
        {"$set": {"seen": True, "seen_at": utcnow()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Alert non trovato")
    return {"seen": True}


@api_router.post("/axon-alerts/mark-all-seen")
async def axon_alerts_mark_all_seen(user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.axon_alerts.update_many(
        {"tenant_id": tid, "seen": False},
        {"$set": {"seen": True, "seen_at": utcnow()}},
    )
    return {"updated": r.modified_count}


@api_router.delete("/axon-alerts/{alert_id}")
async def axon_alerts_delete(alert_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.axon_alerts.delete_one({"alert_id": alert_id, "tenant_id": tid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Alert non trovato")
    return {"deleted": True}


# =========================================================================
