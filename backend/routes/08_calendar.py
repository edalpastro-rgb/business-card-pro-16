# 08_calendar.py — Appuntamenti + Team Calendar
# Estratto da server.py (righe originali 4051-4494). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Appointments
# =========================
@api_router.get("/appointments")
async def list_appointments(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    area: Optional[str] = None,
    contact_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    tid = tenant_id(user)
    # Base scope: own records + broadcast events I'm a recipient of
    scope_filter: Dict[str, Any] = {"user_id": tid}
    if is_owner(user):
        # Owner sees everything in tenant
        base = {"user_id": tid}
    else:
        base = {
            "user_id": tid,
            "$or": [
                {"created_by": user["user_id"]},
                {"is_broadcast": True, "broadcast_to_user_ids": user["user_id"]},
            ],
        }
    q: Dict[str, Any] = base
    date_filter: Dict[str, Any] = {}
    if start and end:
        date_filter = {"$gte": start, "$lte": end}
    elif start:
        date_filter = {"$gte": start}
    if date_filter:
        q["start_at"] = date_filter
    if area in ("energy", "network"):
        q["area"] = area
    if contact_id:
        q["contact_id"] = contact_id
    items = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(1000)
    # Attach read_only flag for broadcast recipients (creator != me)
    for it in items:
        _aware_utc_times(it)
        it["read_only"] = bool(it.get("is_broadcast") and it.get("created_by") != user["user_id"] and not is_owner(user))
    return {"items": items}
    _ = scope_filter  # placeholder to avoid unused warnings


@api_router.post("/appointments")
async def create_appointment(body: AppointmentIn, user=Depends(get_current_user)):
    check_area_allowed(user, body.area)
    aid = f"a_{uuid.uuid4().hex[:12]}"
    payload = body.model_dump()
    # Broadcast: only owners or admins can broadcast
    if payload.get("is_broadcast"):
        if not is_admin_or_owner(user):
            raise HTTPException(status_code=403, detail="Solo owner o admin possono creare eventi broadcast")
        scope = payload.get("broadcast_scope") or "all"
        # "all" is restricted to owner
        if scope == "all" and not is_owner(user):
            raise HTTPException(status_code=403, detail="Solo l'owner può inviare a tutta l'azienda")
        payload["broadcast_to_user_ids"] = await resolve_broadcast_recipients(user, scope, payload.get("broadcast_to_user_ids"))
    doc = {
        "appointment_id": aid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **payload,
        "done": False,
        "outcome_tags": [],
        "outcome_notes": "",
        "products_sold": 0,
        "contract_signed": False,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.appointments.insert_one(doc)
    strip_id(doc)
    return doc


# v2.19 — Statistiche appuntamenti per collaboratore
@api_router.get("/appointments/stats")
async def appointments_stats(
    range_days: int = 30,
    user=Depends(get_current_user),
):
    """Return counts done/undone per user (self + team) over the last N days.
    Owner/admin see all tenant members; members see only their own row."""
    tid = tenant_id(user)
    since = utcnow() - timedelta(days=max(1, min(range_days, 365)))
    # Fetch team members within tenant
    members = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1}
    ).to_list(200)
    is_master = user.get("role") in ("owner", "admin")
    if not is_master:
        members = [m for m in members if m["user_id"] == user["user_id"]]
    # Aggregate counts per created_by
    pipeline = [
        {"$match": {"user_id": tid, "start_at": {"$gte": since}, "is_broadcast": {"$ne": True}}},
        {"$group": {
            "_id": "$created_by",
            "total": {"$sum": 1},
            "done": {"$sum": {"$cond": [{"$eq": ["$done", True]}, 1, 0]}},
        }},
    ]
    agg = {}
    async for row in db.appointments.aggregate(pipeline):
        agg[row["_id"]] = {"total": row["total"], "done": row["done"]}
    per_user = []
    for m in members:
        st = agg.get(m["user_id"], {"total": 0, "done": 0})
        per_user.append({
            "user_id": m["user_id"],
            "name": m.get("name") or m.get("email") or "—",
            "role": m.get("role"),
            "total": st["total"],
            "done": st["done"],
            "undone": st["total"] - st["done"],
        })
    # Sort by total desc for a leaderboard feel
    per_user.sort(key=lambda x: (-x["total"], x["name"]))
    my_row = next((r for r in per_user if r["user_id"] == user["user_id"]), {"total": 0, "done": 0, "undone": 0})
    group_total = sum(r["total"] for r in per_user)
    group_done = sum(r["done"] for r in per_user)
    return {
        "range_days": max(1, min(range_days, 365)),
        "mine": {"total": my_row["total"], "done": my_row["done"], "undone": my_row["undone"]},
        "group": {"total": group_total, "done": group_done, "undone": group_total - group_done},
        "per_user": per_user,
    }


@api_router.get("/appointments/{appointment_id}")
async def get_appointment(appointment_id: str, user=Depends(get_current_user)):
    # Fetch within tenant (allow broadcast visibility)
    a = await db.appointments.find_one({
        "user_id": tenant_id(user),
        "appointment_id": appointment_id,
    }, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    # Non-owner: must be creator or broadcast recipient
    if not is_owner(user):
        allowed = a.get("created_by") == user["user_id"] or (
            a.get("is_broadcast") and user["user_id"] in (a.get("broadcast_to_user_ids") or [])
        )
        if not allowed:
            raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    a["read_only"] = bool(a.get("is_broadcast") and a.get("created_by") != user["user_id"] and not is_owner(user))
    return _aware_utc_times(a)


# V50.z80 — Preview per condivisione appuntamento con cliente (WA + email)
@api_router.get("/appointments/{appointment_id}/share-preview")
async def appointment_share_preview(appointment_id: str, user=Depends(get_current_user)):
    a = await db.appointments.find_one({"user_id": tenant_id(user), "appointment_id": appointment_id}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    contact = None
    if a.get("contact_id"):
        contact = await db.contacts.find_one(
            {"user_id": tenant_id(user), "contact_id": a["contact_id"]},
            {"_id": 0, "first_name": 1, "last_name": 1, "phone": 1, "email": 1}
        )
    start = a.get("start_at")
    if isinstance(start, datetime):
        # Fuso orario Europe/Rome per il preview leggibile
        try:
            import zoneinfo as _zoneinfo
            local = start.astimezone(_zoneinfo.ZoneInfo("Europe/Rome")) if start.tzinfo else start.replace(tzinfo=timezone.utc).astimezone(_zoneinfo.ZoneInfo("Europe/Rome"))
        except Exception:
            local = start
        date_str = local.strftime("%A %d %B %Y").lower()
        time_str = local.strftime("%H:%M")
        # V50.z80.1 — Localizzazione italiana forzata (indipendente dal locale di sistema)
        _IT_DAYS = {"monday": "lunedì", "tuesday": "martedì", "wednesday": "mercoledì", "thursday": "giovedì", "friday": "venerdì", "saturday": "sabato", "sunday": "domenica"}
        _IT_MONTHS = {"january": "gennaio", "february": "febbraio", "march": "marzo", "april": "aprile", "may": "maggio", "june": "giugno", "july": "luglio", "august": "agosto", "september": "settembre", "october": "ottobre", "november": "novembre", "december": "dicembre"}
        for en, it in _IT_DAYS.items():
            date_str = date_str.replace(en, it)
        for en, it in _IT_MONTHS.items():
            date_str = date_str.replace(en, it)
    else:
        date_str = "data da definire"; time_str = "orario da definire"
    first_name = (contact or {}).get("first_name") or "Gentile Cliente"
    location = (a.get("location") or "").strip() or "presso il nostro ufficio"
    title = (a.get("title") or "Appuntamento").strip()
    agent_name = (user.get("name") or "").split(" ")[0] or "il tuo consulente"
    default_msg = (
        f"Ciao {first_name}, ti confermo il nostro appuntamento «{title}» "
        f"del {date_str} alle {time_str} presso {location}. "
        f"A presto — {agent_name}"
    )
    phone_raw = ((contact or {}).get("phone") or "").replace(" ", "").replace("+", "").replace("-", "")
    email = (contact or {}).get("email") or ""
    from urllib.parse import quote
    wa_url = f"https://wa.me/{phone_raw}?text={quote(default_msg)}" if phone_raw else None
    mailto = f"mailto:{email}?subject={quote('Conferma appuntamento')}&body={quote(default_msg)}" if email else None
    return {
        "message": default_msg,
        "wa_url": wa_url,
        "mailto": mailto,
        "contact": contact,
        "channels_available": {
            "whatsapp": bool(phone_raw),
            "email": bool(email),
        },
        "current_settings": {
            "hours": a.get("client_reminder_hours"),
            "channels": a.get("client_reminder_channels") or [],
            "sent_at": a.get("client_reminder_sent_at"),
        },
    }





@api_router.put("/appointments/{appointment_id}")
async def update_appointment(appointment_id: str, body: AppointmentUpdate, user=Depends(get_current_user)):
    # Only creator (or owner) can update
    existing = await db.appointments.find_one({
        "user_id": tenant_id(user),
        "appointment_id": appointment_id,
    })
    if not existing:
        raise HTTPException(status_code=404, detail="Appuntamento non trovato")
    if not is_owner(user) and existing.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non puoi modificare un evento broadcast: sola lettura")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "area" in upd:
        check_area_allowed(user, upd["area"])
    upd["updated_at"] = utcnow()
    await db.appointments.update_one({"appointment_id": appointment_id}, {"$set": upd})
    a = await db.appointments.find_one({"appointment_id": appointment_id}, {"_id": 0})
    return _aware_utc_times(a)


@api_router.delete("/appointments/{appointment_id}")
async def delete_appointment(appointment_id: str, user=Depends(get_current_user)):
    existing = await db.appointments.find_one({
        "user_id": tenant_id(user),
        "appointment_id": appointment_id,
    })
    if not existing:
        return {"ok": True}
    if not is_owner(user) and existing.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non puoi eliminare un evento broadcast di cui non sei creatore")
    await db.appointments.delete_one({"appointment_id": appointment_id})
    return {"ok": True}


# =========================
# Team Calendar (V38T)
# =========================
# Palette used to assign deterministic colors to each collaborator on the team
# calendar. Colors are picked by hashing the user_id into the palette.
_TEAM_MEMBER_COLORS: List[str] = [
    "#2563EB",  # blue
    "#DC2626",  # red
    "#16A34A",  # green
    "#D97706",  # amber
    "#7C3AED",  # violet
    "#DB2777",  # pink
    "#0891B2",  # cyan
    "#EA580C",  # orange
    "#65A30D",  # lime
    "#0369A1",  # sky
    "#7E22CE",  # purple
    "#B45309",  # brown
]


def _color_for_user(user_id: str) -> str:
    if not user_id:
        return "#6B7280"
    # Deterministic hash → palette index
    h = 0
    for ch in user_id:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return _TEAM_MEMBER_COLORS[h % len(_TEAM_MEMBER_COLORS)]


async def _tenant_member_ids(user: dict) -> List[str]:
    """Return the list of user_ids belonging to the same tenant as `user`.
    Includes the tenant owner and all sub-users under the owner.
    """
    tid = tenant_id(user)
    # Owner + direct children under the tenant
    tenant_users = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"user_id": 1, "_id": 0},
    ).to_list(2000)
    ids = {u["user_id"] for u in tenant_users}
    # Also traverse deeper descendants (nested hierarchy)
    for uid in await descendant_user_ids(tid):
        ids.add(uid)
    return list(ids)


@api_router.get("/calendar/team-members")
async def calendar_team_members(user=Depends(get_current_user)):
    """Return all team members (same tenant) with an assigned display color.
    Includes the current user. Used by the team calendar for filtering and
    color-coding events.
    """
    tid = tenant_id(user)
    members = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1, "parent_user_id": 1},
    ).to_list(2000)
    # Also include deeper descendants (nested) that weren't caught by parent_user_id == tid
    known = {m.get("user_id") for m in members}
    for uid in await descendant_user_ids(tid):
        if uid not in known:
            m = await db.users.find_one(
                {"user_id": uid},
                {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1, "parent_user_id": 1},
            )
            if m:
                members.append(m)
                known.add(uid)
    out = []
    for m in members:
        out.append({
            "user_id": m.get("user_id"),
            "name": m.get("name") or m.get("email") or "Collaboratore",
            "email": m.get("email"),
            "role": m.get("role") or "member",
            "picture": m.get("picture"),
            "color": _color_for_user(m.get("user_id") or ""),
            "is_me": m.get("user_id") == user["user_id"],
            "is_owner": (m.get("user_id") == tid),
        })
    # Sort: me first, then owner, then by name
    out.sort(key=lambda x: (0 if x["is_me"] else (1 if x["is_owner"] else 2), (x["name"] or "").lower()))
    return {"items": out}


@api_router.get("/calendar/team")
async def calendar_team(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    area: Optional[str] = None,
    user_ids: Optional[str] = None,  # comma-separated
    user=Depends(get_current_user),
):
    """Return appointments across the whole tenant for the Team Calendar view.
    Enriches each event with `created_by_name`, `created_by_color`, and `is_mine`.
    Non-owned appointments have contact_id / location / notes / phone fields
    redacted for privacy (per user choice: only title + orario + collaboratore).
    """
    tid = tenant_id(user)
    # Base tenant filter (everyone under this tenant)
    q: Dict[str, Any] = {"user_id": tid}

    # Date window
    if start and end:
        q["start_at"] = {"$gte": start, "$lte": end}
    elif start:
        q["start_at"] = {"$gte": start}

    if area in ("energy", "network"):
        q["area"] = area

    # Optional filter by user_ids (comma-separated). Keep only those in the tenant.
    # Note: if the caller passes ONLY foreign user_ids, allowed_ids may be empty →
    # we still apply the filter (with an empty $in) so the response is [] instead of
    # accidentally returning the entire tenant's events. (V38T bug fix.)
    tenant_ids = set(await _tenant_member_ids(user))
    if user_ids:
        requested = {u.strip() for u in user_ids.split(",") if u.strip()}
        allowed_ids = list(requested & tenant_ids)
        q["created_by"] = {"$in": allowed_ids}

    # Fetch
    items = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(2000)

    # Build user lookup for enrichment
    creator_ids = list({it.get("created_by") for it in items if it.get("created_by")})
    users_lookup: Dict[str, Dict[str, Any]] = {}
    if creator_ids:
        async for u in db.users.find(
            {"user_id": {"$in": creator_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1},
        ):
            users_lookup[u["user_id"]] = u

    my_id = user["user_id"]
    out = []
    for it in items:
        created_by = it.get("created_by") or ""
        u_info = users_lookup.get(created_by, {})
        creator_name = u_info.get("name") or u_info.get("email") or "Collaboratore"
        is_mine = (created_by == my_id)
        _aware_utc_times(it)
        enriched = {
            "appointment_id": it.get("appointment_id"),
            "title": it.get("title"),
            "area": it.get("area"),
            "start_at": it.get("start_at"),
            "end_at": it.get("end_at"),
            "duration_min": it.get("duration_min"),
            "is_phone": bool(it.get("is_phone")),
            "done": bool(it.get("done")),
            "appointment_type_tags": it.get("appointment_type_tags") or [],
            "is_broadcast": bool(it.get("is_broadcast")),
            "created_by": created_by,
            "created_by_name": creator_name,
            "created_by_color": _color_for_user(created_by),
            "is_mine": is_mine,
        }
        if is_mine:
            # Full detail for my own appointments
            enriched.update({
                "location": it.get("location") or "",
                "map_address": it.get("map_address") or "",
                "full_address": it.get("full_address") or "",
                "notes": it.get("notes") or "",
                "contact_id": it.get("contact_id"),
                "phone_mobile": it.get("phone_mobile") or "",
                "phone_work": it.get("phone_work") or "",
                "outcome_tags": it.get("outcome_tags") or [],
                "products_sold": it.get("products_sold") or 0,
                "contract_signed": bool(it.get("contract_signed")),
                "value_amount": it.get("value_amount") or 0.0,
                "read_only": False,
            })
        else:
            # Redacted view for others' appointments (privacy)
            enriched.update({
                "location": "",
                "map_address": "",
                "full_address": "",
                "notes": "",
                "contact_id": None,
                "phone_mobile": "",
                "phone_work": "",
                "read_only": True,
            })
        out.append(enriched)

    return {"items": out}


# =========================
