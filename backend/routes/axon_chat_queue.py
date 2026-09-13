# axon_chat_queue.py — V50.z223 — Chat NON bloccante: coda messaggi con priorità + chat parallele (tab = sessioni) — modulo ISOLATO
#
# Fase A: mentre Axon elabora, l'utente continua a scrivere: i messaggi finiscono in coda (server-side, sopravvive alla chiusura dell'app)
#   con stato pending ⏳ | processing 🔄 | done ✅ | failed, priorità URGENT (salta la coda) > HIGH > NORMAL (FIFO), posizione ed ETA.
#   Il client elabora UNA bozza alla volta (scelta utente) prendendo la prima in ordine di priorità: PATCH status=processing → stream → done.
#   POST /chat/messages · GET /chat/queue · PATCH /chat/queue/{id} · DELETE /chat/queue/{id} · POST /chat/queue/next (claim atomico)
# Fase B: tab = sessioni chat (`assistant_messages.session_id`): GET /chat/tabs (ultime sessioni + titolo), PATCH /chat/tabs/{session_id} {title},
#   POST /chat/tabs → nuova sessione vuota. La storia per tab arriva da GET /assistant/history?session_id=…

from pymongo import ReturnDocument

_CQ_PRIO = {"URGENT": 0, "HIGH": 1, "NORMAL": 2}
_CQ_ETA_SEC = 45


class CqMessageIn(BaseModel):
    content: str
    attachments: Optional[List[str]] = None
    priority: str = "NORMAL"
    queue_id: Optional[str] = None
    session_id: Optional[str] = None


class CqPatchIn(BaseModel):
    content: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None


class CqTabIn(BaseModel):
    title: str


def _cq_prio(p: Optional[str]) -> str:
    p = (p or "NORMAL").upper()
    return p if p in _CQ_PRIO else "NORMAL"


def _cq_out(d: dict, pos: Optional[int] = None) -> dict:
    o = {k: v for k, v in d.items() if k != "_id"}
    for k in ("created_at", "updated_at", "started_at", "done_at"):
        if isinstance(o.get(k), datetime):
            o[k] = o[k].isoformat()
    if pos is not None:
        o["position_in_queue"] = pos
        o["estimated_time"] = f"{pos * _CQ_ETA_SEC}s" if pos > 0 else "ora"
    return o


async def _cq_list(uid: str, session_id: Optional[str] = None) -> List[dict]:
    q: Dict[str, Any] = {"user_id": uid, "status": {"$in": ["pending", "processing"]}}
    if session_id:
        q["session_id"] = session_id
    items = [d async for d in db.axon_chat_queue.find(q, {"_id": 0})]
    items.sort(key=lambda d: (0 if d.get("status") == "processing" else 1, _CQ_PRIO.get(d.get("priority"), 2), d.get("created_at") or utcnow()))
    out = []
    pos = 0
    for d in items:
        if d.get("status") == "processing":
            out.append(_cq_out(d, 0))
        else:
            pos += 1
            out.append(_cq_out(d, pos))
    return out


@api_router.post("/chat/messages")
async def cq_enqueue(body: CqMessageIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Messaggio vuoto")
    did = body.queue_id or f"draft_{uuid.uuid4().hex[:10]}"
    now = utcnow()
    await db.axon_chat_queue.update_one({"draft_id": did, "user_id": uid}, {
        "$set": {"content": content[:4000], "attachments": body.attachments or [], "priority": _cq_prio(body.priority), "session_id": body.session_id, "updated_at": now},
        "$setOnInsert": {"draft_id": did, "user_id": uid, "status": "pending", "created_at": now}}, upsert=True)
    lst = await _cq_list(uid)
    me = next((x for x in lst if x["draft_id"] == did), None)
    return {"message_id": did, "draft_id": did, "position_in_queue": (me or {}).get("position_in_queue", 0), "estimated_time": (me or {}).get("estimated_time", "ora"), "queue": lst}


@api_router.get("/chat/queue")
async def cq_queue(session_id: Optional[str] = None, include_done: bool = False, user=Depends(get_current_user)):
    uid = user["user_id"]
    lst = await _cq_list(uid, session_id)
    done: List[dict] = []
    if include_done:
        done = [_cq_out(d) async for d in db.axon_chat_queue.find({"user_id": uid, "status": {"$in": ["done", "failed"]}}, {"_id": 0}).sort("updated_at", -1).limit(10)]
    return {"items": lst, "recent_done": done, "pending": sum(1 for x in lst if x["status"] == "pending"), "processing": any(x["status"] == "processing" for x in lst)}


@api_router.patch("/chat/queue/{draft_id}")
async def cq_patch(draft_id: str, body: CqPatchIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.content is not None:
        if not body.content.strip():
            raise HTTPException(status_code=400, detail="Messaggio vuoto")
        upd["content"] = body.content.strip()[:4000]
    if body.priority is not None:
        upd["priority"] = _cq_prio(body.priority)
    if body.status is not None:
        if body.status not in ("pending", "processing", "done", "failed"):
            raise HTTPException(status_code=400, detail="status non valido")
        upd["status"] = body.status
        if body.status == "processing":
            upd["started_at"] = utcnow()
        if body.status in ("done", "failed"):
            upd["done_at"] = utcnow()
            if body.error:
                upd["error"] = body.error[:300]
    r = await db.axon_chat_queue.update_one({"draft_id": draft_id, "user_id": uid}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    return {"ok": True, "queue": await _cq_list(uid)}


@api_router.post("/chat/queue/next")
async def cq_next(session_id: Optional[str] = None, user=Depends(get_current_user)):
    """Claim atomico della prossima bozza (URGENT > HIGH > NORMAL, poi FIFO) → status processing. Nessuna se un'altra è già in elaborazione."""
    uid = user["user_id"]
    lst = await _cq_list(uid, session_id)
    if any(x["status"] == "processing" for x in lst):
        return {"item": None, "reason": "busy", "queue": lst}
    for cand in lst:
        r = await db.axon_chat_queue.find_one_and_update({"draft_id": cand["draft_id"], "user_id": uid, "status": "pending"},
                                                          {"$set": {"status": "processing", "started_at": utcnow(), "updated_at": utcnow()}}, projection={"_id": 0},
                                                          return_document=ReturnDocument.AFTER)
        if r:
            return {"item": _cq_out(r, 0), "queue": await _cq_list(uid, session_id)}
    return {"item": None, "reason": "empty", "queue": lst}


@api_router.delete("/chat/queue/{draft_id}")
async def cq_delete(draft_id: str, user=Depends(get_current_user)):
    r = await db.axon_chat_queue.delete_one({"draft_id": draft_id, "user_id": user["user_id"]})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    return {"ok": True, "queue": await _cq_list(user["user_id"])}


# ---------------------------------------------------------------------------- Fase B: tab = sessioni
@api_router.get("/chat/tabs")
async def cq_tabs(limit: int = 8, user=Depends(get_current_user)):
    uid = user["user_id"]
    sess = await assistant_sessions(limit=limit, user=user)
    rows = sess if isinstance(sess, list) else (sess.get("sessions") or sess.get("items") or [])
    titles = {d["session_id"]: d.get("title") for d in await db.assistant_session_meta.find({"user_id": uid}, {"_id": 0, "session_id": 1, "title": 1}).to_list(100)}
    qcounts: Dict[str, int] = {}
    async for d in db.axon_chat_queue.find({"user_id": uid, "status": {"$in": ["pending", "processing"]}}, {"_id": 0, "session_id": 1}):
        qcounts[d.get("session_id") or ""] = qcounts.get(d.get("session_id") or "", 0) + 1
    out = []
    for s in rows[:limit]:
        sid = s.get("session_id") or s.get("_id") or s.get("id")
        if not sid:
            continue
        prev = (s.get("preview") or s.get("first_user") or "")
        out.append({"session_id": sid, "title": titles.get(sid) or (prev[:28] + ("…" if len(prev) > 28 else "")) or "Chat", "count": s.get("count") or 0,
                    "last_at": s.get("last_at").isoformat() if isinstance(s.get("last_at"), datetime) else s.get("last_at"), "queued": qcounts.get(sid, 0)})
    seen = {o["session_id"] for o in out}
    for d in await db.assistant_session_meta.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(20):
        if d.get("session_id") and d["session_id"] not in seen and len(out) < limit + 2:
            out.insert(0, {"session_id": d["session_id"], "title": d.get("title") or "Chat", "count": 0, "last_at": None, "queued": qcounts.get(d["session_id"], 0)})
    return {"tabs": out}


@api_router.post("/chat/tabs")
async def cq_tab_new(body: Optional[CqTabIn] = None, user=Depends(get_current_user)):
    sid = f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"
    title = (body.title.strip() if body and body.title else "") or f"Chat {utcnow().strftime('%H:%M')}"
    await db.assistant_session_meta.update_one({"user_id": user["user_id"], "session_id": sid}, {"$set": {"title": title[:40], "created_at": utcnow()}}, upsert=True)
    return {"session_id": sid, "title": title[:40]}


@api_router.patch("/chat/tabs/{session_id}")
async def cq_tab_rename(session_id: str, body: CqTabIn, user=Depends(get_current_user)):
    await db.assistant_session_meta.update_one({"user_id": user["user_id"], "session_id": session_id}, {"$set": {"title": body.title.strip()[:40], "updated_at": utcnow()}}, upsert=True)
    return {"ok": True}
