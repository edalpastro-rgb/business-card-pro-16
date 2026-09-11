# corporate_gym.py — Corporate Gym (Blocco 1: struttura base)
# Modulo ISOLATO: nessuna dipendenza da altri moduli oltre a helper condivisi
# (api_router, db, get_current_user, tenant_id, is_admin_or_owner, utcnow, uuid, BaseModel).
# Tutte le collection sono prefissate `cgym_`.
#
# Modello sessione (cgym_sessions):
#   session_id, tenant_id, user_id (assegnatario), assigned_by, type ("obiezioni"|"winwin"),
#   title, scheduled_at (ISO UTC), status ("assegnata"|"in_corso"|"completata"),
#   mandatory (bool), score (float|None), created_at, completed_at
from zoneinfo import ZoneInfo as _CgymZoneInfo

_CGYM_TZ = _CgymZoneInfo("Europe/Rome")
CGYM_TYPES = ("obiezioni", "winwin")
CGYM_STATUSES = ("assegnata", "in_corso", "completata")


class CgymSessionIn(BaseModel):
    type: Literal["obiezioni", "winwin"]
    scheduled_at: str  # ISO 8601
    user_id: Optional[str] = None  # None = me stesso
    title: Optional[str] = None
    mandatory: bool = False


class CgymSessionUpdate(BaseModel):
    status: Optional[Literal["assegnata", "in_corso", "completata"]] = None
    score: Optional[float] = None
    scheduled_at: Optional[str] = None
    title: Optional[str] = None
    mandatory: Optional[bool] = None


def _cgym_parse_dt(s: str) -> datetime:
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="Data/ora non valida (ISO 8601)")
    if d.tzinfo is None:
        d = d.replace(tzinfo=_CGYM_TZ)
    return d.astimezone(timezone.utc)


def _cgym_dt(v) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _cgym_out(doc: dict) -> dict:
    d = {k: v for k, v in doc.items() if k != "_id"}
    for k in ("scheduled_at", "created_at", "completed_at", "updated_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].astimezone(timezone.utc).isoformat()
    return d


async def _cgym_tenant_member_ids(tid: str) -> set:
    rows = await db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 0, "user_id": 1}).to_list(2000)
    return {r["user_id"] for r in rows}


async def _cgym_get_or_404(session_id: str, user: dict) -> dict:
    doc = await db.cgym_sessions.find_one({"session_id": session_id, "tenant_id": tenant_id(user)})
    if not doc:
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    return doc


@api_router.get("/cgym/sessions")
async def cgym_list_sessions(
    scope: str = "mine",
    type: Optional[str] = None,
    status: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Sessioni Corporate Gym. scope=mine (default) → le mie; scope=team → tutto il tenant (solo Titolare/Admin)."""
    tid = tenant_id(user)
    q: Dict[str, Any] = {"tenant_id": tid}
    if scope == "team":
        if not is_admin_or_owner(user):
            raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    else:
        q["user_id"] = user["user_id"]
    if type in CGYM_TYPES:
        q["type"] = type
    if status in CGYM_STATUSES:
        q["status"] = status
    rows = await db.cgym_sessions.find(q).sort("scheduled_at", 1).to_list(1000)
    # nome assegnatario (per la vista team)
    names: Dict[str, str] = {}
    if scope == "team":
        ids = list({r["user_id"] for r in rows})
        if ids:
            us = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(2000)
            names = {u["user_id"]: (u.get("name") or u.get("email") or u["user_id"]) for u in us}
    out = []
    for r in rows:
        o = _cgym_out(r)
        if names:
            o["user_name"] = names.get(r["user_id"], "")
        out.append(o)
    return {"items": out}


@api_router.post("/cgym/sessions")
async def cgym_create_session(body: CgymSessionIn, user=Depends(get_current_user)):
    """Crea/assegna una sessione. Tutti possono auto-assegnarsi; assegnare ad altri richiede Titolare/Admin."""
    tid = tenant_id(user)
    target = body.user_id or user["user_id"]
    if target != user["user_id"]:
        if not is_admin_or_owner(user):
            raise HTTPException(status_code=403, detail="Solo Titolare/Admin possono assegnare sessioni ad altri")
        if target not in await _cgym_tenant_member_ids(tid):
            raise HTTPException(status_code=400, detail="Utente non appartenente al team")
    now = utcnow()
    doc = {
        "session_id": str(uuid.uuid4()),
        "tenant_id": tid,
        "user_id": target,
        "assigned_by": user["user_id"],
        "type": body.type,
        "title": (body.title or "").strip() or ("Gym Obiezioni" if body.type == "obiezioni" else "Gym WIN-WIN"),
        "scheduled_at": _cgym_parse_dt(body.scheduled_at),
        "status": "assegnata",
        "mandatory": bool(body.mandatory),
        "score": None,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
    }
    await db.cgym_sessions.insert_one(doc)
    return _cgym_out(doc)


@api_router.patch("/cgym/sessions/{session_id}")
async def cgym_update_session(session_id: str, body: CgymSessionUpdate, user=Depends(get_current_user)):
    """Aggiorna stato/score/data. Consentito all'assegnatario e a Titolare/Admin."""
    doc = await _cgym_get_or_404(session_id, user)
    if doc["user_id"] != user["user_id"] and not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.status is not None:
        upd["status"] = body.status
        upd["completed_at"] = utcnow() if body.status == "completata" else None
    if body.score is not None:
        upd["score"] = float(body.score)
    if body.scheduled_at is not None:
        upd["scheduled_at"] = _cgym_parse_dt(body.scheduled_at)
    if body.title is not None:
        upd["title"] = body.title.strip()
    if body.mandatory is not None:
        if not is_admin_or_owner(user) and doc["user_id"] != user["user_id"]:
            raise HTTPException(status_code=403, detail="Non autorizzato")
        upd["mandatory"] = bool(body.mandatory)
    await db.cgym_sessions.update_one({"session_id": session_id}, {"$set": upd})
    doc.update(upd)
    return _cgym_out(doc)


@api_router.delete("/cgym/sessions/{session_id}")
async def cgym_delete_session(session_id: str, user=Depends(get_current_user)):
    """Elimina: Titolare/Admin, oppure chi l'ha creata per sé."""
    doc = await _cgym_get_or_404(session_id, user)
    own_self = doc["user_id"] == user["user_id"] and doc.get("assigned_by") == user["user_id"]
    if not (is_admin_or_owner(user) or own_self):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.cgym_sessions.delete_one({"session_id": session_id})
    return {"ok": True}


@api_router.get("/cgym/summary")
async def cgym_summary(user=Depends(get_current_user)):
    """Riepilogo per widget Home e striscia avviso (solo le MIE sessioni).
    - due_soon: non completate con scheduled_at entro 7 giorni (incluse scadute)
    - today_total / today_done: sessioni di oggi (Europe/Rome)
    - mandatory_pending: obbligatorie non completate (→ striscia arancione)
    - overdue: non completate con data passata
    """
    now = utcnow()
    local_now = now.astimezone(_CGYM_TZ)
    day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    horizon = now + timedelta(days=7)
    rows = await db.cgym_sessions.find({"tenant_id": tenant_id(user), "user_id": user["user_id"]}).to_list(2000)
    due_soon, today_total, today_done, mandatory_pending, overdue = [], 0, 0, 0, 0
    for r in rows:
        dt = _cgym_dt(r.get("scheduled_at"))
        done = r.get("status") == "completata"
        if dt is not None and day_start <= dt.astimezone(_CGYM_TZ) < day_end:
            today_total += 1
            if done:
                today_done += 1
        if not done:
            if r.get("mandatory"):
                mandatory_pending += 1
            if dt is not None and dt < now:
                overdue += 1
            if dt is not None and dt <= horizon:
                due_soon.append(_cgym_out(r))
    due_soon.sort(key=lambda x: x.get("scheduled_at") or "")
    return {
        "due_soon": due_soon[:10],
        "due_soon_count": len(due_soon),
        "today_total": today_total,
        "today_done": today_done,
        "mandatory_pending": mandatory_pending,
        "overdue": overdue,
        "server_time": now.isoformat(),
    }


@api_router.get("/cgym/team-overview")
async def cgym_team_overview(user=Depends(get_current_user)):
    """Quadro team (Titolare/Admin): per ogni membro conteggi assegnate/in corso/completate/obbligatorie pendenti."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Titolare/Admin")
    tid = tenant_id(user)
    members = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1},
    ).to_list(2000)
    rows = await db.cgym_sessions.find({"tenant_id": tid}).to_list(5000)
    agg: Dict[str, Dict[str, Any]] = {}
    for m in members:
        agg[m["user_id"]] = {"user_id": m["user_id"], "name": m.get("name") or m.get("email") or m["user_id"], "role": m.get("role"),
                             "assegnata": 0, "in_corso": 0, "completata": 0, "mandatory_pending": 0, "avg_score": None, "_scores": []}
    for r in rows:
        a = agg.get(r["user_id"])
        if not a:
            continue
        st = r.get("status", "assegnata")
        a[st] = a.get(st, 0) + 1
        if r.get("mandatory") and st != "completata":
            a["mandatory_pending"] += 1
        if st == "completata" and isinstance(r.get("score"), (int, float)):
            a["_scores"].append(float(r["score"]))
    out = []
    for a in agg.values():
        sc = a.pop("_scores")
        a["avg_score"] = round(sum(sc) / len(sc), 1) if sc else None
        out.append(a)
    out.sort(key=lambda x: (-x["mandatory_pending"], x["name"].lower()))
    return {"items": out}
