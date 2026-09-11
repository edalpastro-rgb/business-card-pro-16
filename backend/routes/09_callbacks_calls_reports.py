# 09_callbacks_calls_reports.py — Ritelefonate, call log/esiti, report
# Estratto da server.py (righe originali 4495-4797). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Callbacks (Ritelefonate)
# =========================
@api_router.get("/callbacks")
async def list_callbacks(
    day: Optional[str] = None,
    area: Optional[str] = None,
    include_done: bool = False,
    user=Depends(get_current_user),
):
    q: Dict[str, Any] = scope_query(user)
    if area in ("energy", "network"):
        q["area"] = area
    if not include_done:
        q["done"] = {"$ne": True}
    if day:
        try:
            d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            q["scheduled_at"] = {"$gte": d, "$lt": d + timedelta(days=1)}
        except Exception:
            pass
    items = await db.callbacks.find(q, {"_id": 0}).sort("scheduled_at", 1).to_list(1000)
    return {"items": items}


@api_router.post("/callbacks")
async def create_callback(body: CallbackIn, user=Depends(get_current_user)):
    check_area_allowed(user, body.area)
    cid = f"cb_{uuid.uuid4().hex[:12]}"
    doc = {
        "callback_id": cid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **body.model_dump(),
        "done": False,
        "created_at": utcnow(),
    }
    await db.callbacks.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.get("/callbacks/{callback_id}")
async def get_callback(callback_id: str, user=Depends(get_current_user)):
    c = await db.callbacks.find_one(scope_query(user, {"callback_id": callback_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Ritelefonata non trovata")
    return c


@api_router.put("/callbacks/{callback_id}")
async def update_callback(callback_id: str, body: CallbackUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "area" in upd:
        check_area_allowed(user, upd["area"])
    r = await db.callbacks.update_one(
        scope_query(user, {"callback_id": callback_id}),
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ritelefonata non trovata")
    c = await db.callbacks.find_one({"callback_id": callback_id}, {"_id": 0})
    return c


@api_router.delete("/callbacks/{callback_id}")
async def delete_callback(callback_id: str, user=Depends(get_current_user)):
    await db.callbacks.delete_one(scope_query(user, {"callback_id": callback_id}))
    return {"ok": True}


# =========================
# Call logs & outcomes
# =========================
@api_router.post("/calls/log")
async def log_call(body: CallLogIn, background: BackgroundTasks, user=Depends(get_current_user)):
    """Records a communication event (phone call, SMS, WhatsApp, email, telegram).
    Optionally creates a follow-up callback if the outcome indicates a reschedule
    (reschedule_at or reschedule_delta_min). V28.c: added `channel` field so the
    frontend can render a unified communications timeline.
    """
    log_id = f"cl_{uuid.uuid4().hex[:12]}"
    channel = (body.channel or "phone").lower()
    if channel not in {"phone", "sms", "whatsapp", "email", "telegram"}:
        channel = "phone"
    outcome_id = body.outcome_id or ("auto_started" if channel == "phone" else f"auto_{channel}")
    doc = {
        "log_id": log_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "contact_id": body.contact_id,
        "callback_id": body.callback_id,
        "appointment_id": body.appointment_id,
        "phone": body.phone,
        "channel": channel,
        "outcome_id": outcome_id,
        "note": body.note,
        "duration_sec": body.duration_sec,
        "created_at": utcnow(),
    }
    await db.call_logs.insert_one(doc)
    strip_id(doc)

    # Update the source callback (mark done + outcome)
    if body.callback_id:
        await db.callbacks.update_one(
            scope_query(user, {"callback_id": body.callback_id}),
            {"$set": {
                "last_call_outcome_id": outcome_id,
                "last_call_at": utcnow(),
                "done": True,  # by default; a reschedule creates a new callback
            }},
        )

    # Create a follow-up callback if requested
    new_callback = None
    reschedule_time: Optional[datetime] = None
    if body.reschedule_at:
        reschedule_time = body.reschedule_at
    elif body.reschedule_delta_min is not None:
        reschedule_time = utcnow() + timedelta(minutes=int(body.reschedule_delta_min))

    if reschedule_time:
        # Fetch original callback for context
        original = None
        if body.callback_id:
            original = await db.callbacks.find_one({"callback_id": body.callback_id})

        # Also fetch contact for name/phone if provided
        contact = None
        cid = body.contact_id or (original.get("contact_id") if original else None)
        if cid:
            contact = await db.contacts.find_one({"contact_id": cid})

        cb_id = f"cb_{uuid.uuid4().hex[:12]}"
        settings = await db.settings.find_one({"user_id": tenant_id(user)}) or {}
        area = (original or {}).get("area") or "energy"
        phone = body.phone or (original or {}).get("phone") or (contact or {}).get("phone")
        title = (original or {}).get("title") or (contact and f"{contact.get('first_name','')} {contact.get('last_name','')}".strip()) or "Ritelefonata"
        cb_doc = {
            "callback_id": cb_id,
            "user_id": tenant_id(user),
            "created_by": user["user_id"],
            "contact_id": cid,
            "title": title,
            "area": area,
            "scheduled_at": reschedule_time,
            "note": body.note or "",
            "phone": phone,
            "notify": True,
            "notify_advance_min": (original or {}).get("notify_advance_min") or settings.get("callback_notify_default_advance_min", 10),
            "done": False,
            "created_at": utcnow(),
            "parent_call_log_id": log_id,
        }
        await db.callbacks.insert_one(cb_doc)
        strip_id(cb_doc)
        new_callback = cb_doc

    # V29.g — Trigger analisi Axon per la chiamata: usa nota+esito+canale+durata
    if body.contact_id:
        ctx_bits = [f"canale: {channel}", f"esito: {outcome_id}"]
        if body.duration_sec: ctx_bits.append(f"durata: {int(body.duration_sec)}s")
        if body.note and body.note.strip(): ctx_bits.append(f"note: {body.note.strip()}")
        _schedule_axon_analysis(
            background=background,
            user=user,
            contact_id=body.contact_id,
            interaction_type="call",
            interaction_ref_id=log_id,
            interaction_summary=" | ".join(ctx_bits),
        )

    return {"log": doc, "new_callback": new_callback}


@api_router.get("/calls/log")
async def list_call_logs(contact_id: Optional[str] = None, limit: int = 50, user=Depends(get_current_user)):
    q = scope_query(user)
    if contact_id:
        q["contact_id"] = contact_id
    items = await db.call_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"items": items}


# V28.f — Edit outcome / duration / note of a persisted call log
class CallLogPatch(BaseModel):
    outcome_id: Optional[str] = None
    duration_sec: Optional[int] = None
    note: Optional[str] = None


@api_router.patch("/calls/log/{log_id}")
async def patch_call_log(log_id: str, body: CallLogPatch, background: BackgroundTasks, user=Depends(get_current_user)):
    existing = await db.call_logs.find_one(scope_query(user, {"log_id": log_id}))
    if not existing:
        raise HTTPException(status_code=404, detail="Log non trovato")
    upd: Dict[str, Any] = {}
    if body.outcome_id is not None:
        upd["outcome_id"] = body.outcome_id
    if body.duration_sec is not None:
        upd["duration_sec"] = max(0, int(body.duration_sec))
    if body.note is not None:
        upd["note"] = body.note
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    upd["updated_at"] = utcnow()
    await db.call_logs.update_one({"log_id": log_id}, {"$set": upd})
    doc = await db.call_logs.find_one({"log_id": log_id}, {"_id": 0})
    # V29.g — Se la nota è stata aggiornata, rigenera l'analisi Axon (nuova entry, le vecchie restano)
    if body.note is not None and body.note.strip() and existing.get("contact_id"):
        merged_note = body.note.strip()
        ctx_bits = [f"canale: {existing.get('channel')}", f"esito: {upd.get('outcome_id') or existing.get('outcome_id')}"]
        dur = upd.get("duration_sec") if upd.get("duration_sec") is not None else existing.get("duration_sec")
        if dur: ctx_bits.append(f"durata: {int(dur)}s")
        ctx_bits.append(f"note: {merged_note}")
        _schedule_axon_analysis(
            background=background,
            user=user,
            contact_id=existing.get("contact_id"),
            interaction_type="call",
            interaction_ref_id=log_id,
            interaction_summary=" | ".join(ctx_bits),
        )
    return {"log": doc}


# =========================
# Reports
# =========================
def _period_range(period: str) -> tuple:
    now = utcnow()
    if period == "day":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
    elif period == "week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)
    elif period == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # naive next month
        if start.month == 12:
            end = start.replace(year=start.year + 1, month=1)
        else:
            end = start.replace(month=start.month + 1)
    elif period == "year":
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(year=start.year + 1)
    else:
        start = now - timedelta(days=1)
        end = now + timedelta(days=1)
    return start, end


@api_router.get("/reports")
async def reports(period: str = "day", user=Depends(get_current_user)):
    start, end = _period_range(period)
    result = {}
    base = scope_query(user)
    for area in ("energy", "network"):
        appointments_done = await db.appointments.count_documents({
            **base, "area": area,
            "done": True, "start_at": {"$gte": start, "$lt": end},
        })
        appointments_total = await db.appointments.count_documents({
            **base, "area": area,
            "start_at": {"$gte": start, "$lt": end},
        })
        phone_done = await db.appointments.count_documents({
            **base, "area": area,
            "done": True, "is_phone": True, "start_at": {"$gte": start, "$lt": end},
        })
        contracts = await db.appointments.count_documents({
            **base, "area": area,
            "contract_signed": True, "start_at": {"$gte": start, "$lt": end},
        })
        pipe = [
            {"$match": {**base, "area": area, "start_at": {"$gte": start, "$lt": end}}},
            {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$products_sold", 0]}}}},
        ]
        agg = await db.appointments.aggregate(pipe).to_list(1)
        products = int(agg[0]["s"]) if agg else 0
        result[area] = {
            "appointments_done": appointments_done,
            "appointments_total": appointments_total,
            "phone_done": phone_done,
            "contracts": contracts,
            "products": products,
        }

    # Outcome breakdown (across both areas)
    outcome_pipe = [
        {"$match": {**base, "done": True, "start_at": {"$gte": start, "$lt": end}, "outcome_ids": {"$exists": True, "$not": {"$size": 0}}}},
        {"$unwind": "$outcome_ids"},
        {"$group": {"_id": "$outcome_ids", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    outcome_agg = await db.appointments.aggregate(outcome_pipe).to_list(100)
    outcomes = [{"outcome_id": o["_id"], "count": o["count"]} for o in outcome_agg]

    return {"period": period, "start": start.isoformat(), "end": end.isoformat(), "stats": result, "outcomes": outcomes}


# =========================
