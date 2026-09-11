# 11_team_chat_vcard_mything.py — Chat interna team, vCard, My Thing
# Estratto da server.py (righe originali 5422-5793). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Internal team chat
# =========================
class ChannelIn(BaseModel):
    name: str = ""
    member_user_ids: List[str] = Field(default_factory=list)
    is_direct: bool = False


class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    member_user_ids: Optional[List[str]] = None


class ChatMessageIn(BaseModel):
    kind: Literal["text", "audio", "photo", "file", "link"] = "text"
    text: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None
    photo_base64: Optional[str] = None
    file_base64: Optional[str] = None
    file_name: Optional[str] = None
    file_mime: Optional[str] = None
    file_size: Optional[int] = None
    link_url: Optional[str] = None
    link_title: Optional[str] = None
    duration_ms: Optional[int] = None
    reply_to: Optional[str] = None


async def _validate_channel_members(tid: str, member_ids: List[str]) -> List[str]:
    """Ensure all provided user_ids belong to same tenant."""
    if not member_ids:
        return []
    users = await db.users.find({
        "user_id": {"$in": member_ids},
        "$or": [{"user_id": tid}, {"parent_user_id": tid}],
    }, {"_id": 0, "user_id": 1}).to_list(1000)
    return [u["user_id"] for u in users]


@api_router.get("/chat/channels")
async def list_channels(user=Depends(get_current_user)):
    uid = user["user_id"]
    tid = tenant_id(user)
    items = await db.chat_channels.find(
        {"user_id": tid, "member_user_ids": uid},
        {"_id": 0},
    ).sort("last_message_at", -1).to_list(200)
    # Attach last message + unread count + display info
    for ch in items:
        last = await db.chat_messages.find_one(
            {"channel_id": ch["channel_id"]},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        ch["last_message"] = last
        # Unread: messages after user's last_read_at (per member)
        read_map = ch.get("read_map") or {}
        last_read = read_map.get(uid)
        unread_q = {"channel_id": ch["channel_id"], "sender_id": {"$ne": uid}}
        if last_read:
            unread_q["created_at"] = {"$gt": last_read}
        ch["unread_count"] = await db.chat_messages.count_documents(unread_q)
    return {"items": items}


@api_router.post("/chat/channels")
async def create_channel(body: ChannelIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    uid = user["user_id"]
    valid_members = await _validate_channel_members(tid, list(set(body.member_user_ids + [uid])))
    if len(valid_members) < 2:
        raise HTTPException(status_code=400, detail="Aggiungi almeno un altro utente")
    # For direct 1-1 chats, reuse existing
    if body.is_direct and len(valid_members) == 2:
        existing = await db.chat_channels.find_one({
            "user_id": tid,
            "is_direct": True,
            "member_user_ids": {"$all": valid_members, "$size": 2},
        }, {"_id": 0})
        if existing:
            return existing
    cid = f"ch_{uuid.uuid4().hex[:12]}"
    doc = {
        "channel_id": cid,
        "user_id": tid,
        "name": body.name or "",
        "is_direct": bool(body.is_direct) and len(valid_members) == 2,
        "member_user_ids": valid_members,
        "created_by": uid,
        "created_at": utcnow(),
        "last_message_at": utcnow(),
        "read_map": {uid: utcnow()},
    }
    await db.chat_channels.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.put("/chat/channels/{channel_id}")
async def update_channel(channel_id: str, body: ChannelUpdate, user=Depends(get_current_user)):
    tid = tenant_id(user)
    uid = user["user_id"]
    ch = await db.chat_channels.find_one({"channel_id": channel_id, "user_id": tid, "member_user_ids": uid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Canale non trovato")
    upd = {}
    if body.name is not None:
        upd["name"] = body.name
    if body.member_user_ids is not None:
        valid = await _validate_channel_members(tid, list(set(body.member_user_ids + [uid])))
        upd["member_user_ids"] = valid
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    await db.chat_channels.update_one({"channel_id": channel_id}, {"$set": upd})
    ch2 = await db.chat_channels.find_one({"channel_id": channel_id}, {"_id": 0})
    return ch2


@api_router.delete("/chat/channels/{channel_id}")
async def delete_channel(channel_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    ch = await db.chat_channels.find_one({"channel_id": channel_id, "user_id": tid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Canale non trovato")
    if ch["created_by"] != user["user_id"] and not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il creatore o l'owner può eliminare")
    await db.chat_channels.delete_one({"channel_id": channel_id})
    await db.chat_messages.delete_many({"channel_id": channel_id})
    return {"ok": True}


@api_router.get("/chat/channels/{channel_id}/messages")
async def list_messages(channel_id: str, after: Optional[datetime] = None, limit: int = 100, user=Depends(get_current_user)):
    tid = tenant_id(user)
    uid = user["user_id"]
    ch = await db.chat_channels.find_one({"channel_id": channel_id, "user_id": tid, "member_user_ids": uid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Canale non trovato")
    q: Dict[str, Any] = {"channel_id": channel_id}
    if after:
        if after.tzinfo is None:
            after = after.replace(tzinfo=timezone.utc)
        q["created_at"] = {"$gt": after}
    items = await db.chat_messages.find(q, {"_id": 0}).sort("created_at", 1).to_list(limit)
    # Mark as read
    await db.chat_channels.update_one(
        {"channel_id": channel_id},
        {"$set": {f"read_map.{uid}": utcnow()}},
    )
    return {"items": items}


@api_router.post("/chat/channels/{channel_id}/messages")
async def send_message(channel_id: str, body: ChatMessageIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    uid = user["user_id"]
    ch = await db.chat_channels.find_one({"channel_id": channel_id, "user_id": tid, "member_user_ids": uid}, {"_id": 0})
    if not ch:
        raise HTTPException(status_code=404, detail="Canale non trovato")
    mid = f"m_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    doc = {
        "message_id": mid,
        "channel_id": channel_id,
        "sender_id": uid,
        "sender_name": user.get("name", ""),
        "created_at": now,
        **body.model_dump(),
    }
    await db.chat_messages.insert_one(doc)
    await db.chat_channels.update_one(
        {"channel_id": channel_id},
        {"$set": {"last_message_at": now, f"read_map.{uid}": now}},
    )
    strip_id(doc)
    return doc


@api_router.delete("/chat/messages/{message_id}")
async def delete_message(message_id: str, user=Depends(get_current_user)):
    m = await db.chat_messages.find_one({"message_id": message_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Messaggio non trovato")
    if m["sender_id"] != user["user_id"] and not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.chat_messages.delete_one({"message_id": message_id})
    return {"ok": True}


# =========================
# Contact vCard (share)
# =========================
@api_router.get("/contacts/{contact_id}/vcard", response_class=PlainTextResponse)
async def contact_vcard(contact_id: str, user=Depends(get_current_user)):
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    parts = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"N:{c.get('last_name', '')};{c.get('first_name', '')};;;",
        f"FN:{c.get('first_name', '')} {c.get('last_name', '')}".strip(),
    ]
    if c.get("phone"):
        parts.append(f"TEL;TYPE=CELL:{c['phone']}")
    if c.get("phone_alt"):
        parts.append(f"TEL;TYPE=HOME:{c['phone_alt']}")
    if c.get("email"):
        parts.append(f"EMAIL:{c['email']}")
    if c.get("email_alt"):
        parts.append(f"EMAIL:{c['email_alt']}")
    addr_parts = [c.get("address_street", ""), c.get("address_city", ""), c.get("address_zip", ""), c.get("address_province", "")]
    if any(addr_parts):
        parts.append(f"ADR:;;{addr_parts[0]};{addr_parts[1]};{addr_parts[3]};{addr_parts[2]};")
    if c.get("website"):
        parts.append(f"URL:{c['website']}")
    if c.get("birth_date"):
        try:
            bd = c["birth_date"]
            if len(bd) == 10:
                parts.append(f"BDAY:{bd.replace('-', '')}")
        except Exception:
            pass
    if c.get("general_note"):
        parts.append(f"NOTE:{c['general_note']}")
    parts.append("END:VCARD")
    return "\r\n".join(parts)


# =========================
# MY THING (personal, private per user)
# =========================
def _mt_scope(user: dict) -> Dict[str, Any]:
    # Strictly private: only items owned by the caller (not tenant-wide)
    return {"owner_user_id": user["user_id"]}


def _serialize_mt(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    if isinstance(doc.get("scheduled_at"), datetime):
        doc["scheduled_at"] = doc["scheduled_at"].isoformat()
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
    return doc


@api_router.get("/my-thing")
async def my_thing_list(kind: Optional[str] = None, user=Depends(get_current_user)):
    q = _mt_scope(user)
    if kind:
        q["kind"] = kind
    docs = await db.my_thing.find(q).sort("created_at", -1).to_list(500)
    return {"items": [_serialize_mt(d) for d in docs]}


@api_router.post("/my-thing")
async def my_thing_create(body: MyThingIn, user=Depends(get_current_user)):
    item_id = f"mt_{uuid.uuid4().hex[:12]}"
    doc = {
        "item_id": item_id,
        "owner_user_id": user["user_id"],
        "kind": body.kind,
        "title": body.title,
        "body": body.body,
        "image_base64": body.image_base64,
        "scheduled_at": body.scheduled_at,
        "daily_time": body.daily_time,
        "recurring": body.recurring,
        "display_mode": body.display_mode,
        "notify": body.notify,
        "active": body.active,
        "color": body.color,
        # V28.d — banner customization (message-kind only)
        "font_family": body.font_family or "system",
        "font_size": body.font_size or "medium",
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.my_thing.insert_one(doc)
    return {"item": _serialize_mt(doc)}


@api_router.put("/my-thing/{item_id}")
async def my_thing_update(item_id: str, body: MyThingUpdate, user=Depends(get_current_user)):
    existing = await db.my_thing.find_one({"item_id": item_id, **_mt_scope(user)})
    if not existing:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    upd["updated_at"] = utcnow()
    await db.my_thing.update_one({"item_id": item_id}, {"$set": upd})
    doc = await db.my_thing.find_one({"item_id": item_id})
    return {"item": _serialize_mt(doc)}


@api_router.delete("/my-thing/{item_id}")
async def my_thing_delete(item_id: str, user=Depends(get_current_user)):
    r = await db.my_thing.delete_one({"item_id": item_id, **_mt_scope(user)})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Elemento non trovato")
    return {"ok": True}


@api_router.get("/my-thing/random-banner")
async def my_thing_random_banner(user=Depends(get_current_user)):
    """Random active message or image for the home splash banner."""
    q = {**_mt_scope(user), "active": True, "kind": {"$in": ["message", "image"]}}
    # Prefer scheduled messages if current time matches HH:MM
    now = utcnow()
    now_it = now.astimezone(timezone(timedelta(hours=2)))  # rough Italy TZ; TZ-agnostic OK for HH:MM
    hhmm = now_it.strftime("%H:%M")
    scheduled = await db.my_thing.find_one({**q, "display_mode": "scheduled", "daily_time": hhmm})
    if scheduled:
        return {"item": _serialize_mt(scheduled)}
    # Otherwise: random pick among random-mode items
    import random as _random
    items = await db.my_thing.find({**q, "display_mode": "random"}).to_list(200)
    if not items:
        return {"item": None}
    return {"item": _serialize_mt(_random.choice(items))}


@api_router.get("/my-thing/upcoming-events")
async def my_thing_upcoming_events(user=Depends(get_current_user)):
    """Return events + anniversaries in next 30 days."""
    now = utcnow()
    horizon = now + timedelta(days=30)
    # Events with scheduled_at in [now, horizon]
    events = await db.my_thing.find({
        **_mt_scope(user),
        "active": True,
        "kind": {"$in": ["event", "anniversary"]},
    }).to_list(500)
    upcoming = []
    for e in events:
        sched = e.get("scheduled_at")
        if not sched:
            continue
        if e.get("kind") == "anniversary":
            # Compute next yearly occurrence
            try:
                base = sched if isinstance(sched, datetime) else datetime.fromisoformat(str(sched))
                if base.tzinfo is None:
                    base = base.replace(tzinfo=timezone.utc)
                next_year = base.replace(year=now.year)
                if next_year < now:
                    next_year = next_year.replace(year=now.year + 1)
                if next_year <= horizon:
                    ee = _serialize_mt(dict(e))
                    ee["next_occurrence"] = next_year.isoformat()
                    upcoming.append(ee)
            except Exception:
                pass
        else:
            base = sched if isinstance(sched, datetime) else datetime.fromisoformat(str(sched))
            if base.tzinfo is None:
                base = base.replace(tzinfo=timezone.utc)
            if now <= base <= horizon:
                ee = _serialize_mt(dict(e))
                ee["next_occurrence"] = base.isoformat()
                upcoming.append(ee)
    upcoming.sort(key=lambda x: x.get("next_occurrence") or "")
    return {"items": upcoming}


# =========================
