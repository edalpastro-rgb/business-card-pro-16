# courses.py — V50.z273 — AREA CORSI (Corporate Gym v2.0 · Fase 1 core)
# Cartelle corsi create da Master/Manager (owner o utente con sotto-collaboratori), assegnate a singoli / tutti;
# contenuti (PDF, foto, audio, testo) salvati su Object Storage (fallback Mongo); tracciamento lettura (badge lampeggiante
# finché non aperta) e partecipazione (✅/❌ + motivo) con notifiche al creatore; lista partecipanti solo per il creatore;
# export Excel/PDF(HTML); reminder automatici (3/7/14 gg) via axon_notify (job giornaliero 08:45).
# Isolato: usa descendant_user_ids, tenant_id, axon_notify, _put_object_sync/_get_object_sync.

COURSE_REMINDER_DEFAULT_DAYS = 3


class CourseFileIn(BaseModel):
    name: str
    mime: str = "application/octet-stream"
    data_base64: str


class CourseIn(BaseModel):
    title: str
    description: Optional[str] = ""
    body_text: Optional[str] = ""  # testo libero / appunti del corso
    course_date: Optional[str] = ""  # AAAA-MM-GG
    location: Optional[str] = ""
    maps_url: Optional[str] = ""
    recipients: List[str] = Field(default_factory=list)  # user_id; vuoto = tutti i collaboratori del creatore
    reminder_days: int = COURSE_REMINDER_DEFAULT_DAYS  # 0 = disattivato
    files: List[CourseFileIn] = Field(default_factory=list)


class CourseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    body_text: Optional[str] = None
    course_date: Optional[str] = None
    location: Optional[str] = None
    maps_url: Optional[str] = None
    recipients: Optional[List[str]] = None
    reminder_days: Optional[int] = None
    status: Optional[str] = None  # active | archived
    add_files: Optional[List[CourseFileIn]] = None
    remove_file_ids: Optional[List[str]] = None


class ParticipationIn(BaseModel):
    status: str  # yes | no
    notes: Optional[str] = ""


async def _course_can_manage(user: dict) -> bool:
    """Master (owner) o Manager = ha almeno un collaboratore sotto di sé."""
    if is_owner(user):
        return True
    return bool(await db.users.find_one({"parent_user_id": user["user_id"]}, {"_id": 1}))


async def _course_default_recipients(user: dict) -> List[str]:
    return await descendant_user_ids(user["user_id"])


async def _course_store_file(tid: str, course_id: str, f: CourseFileIn) -> dict:
    b64 = f.data_base64.split(",", 1)[1] if f.data_base64.startswith("data:") else f.data_base64
    if len(b64) > 24 * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File troppo grande: {f.name}")
    fid = f"cf_{uuid.uuid4().hex[:10]}"
    meta = {"file_id": fid, "name": f.name[:160], "mime": f.mime or "application/octet-stream", "size": int(len(b64) * 0.75), "created_at": utcnow()}
    try:
        ext = (f.name.rsplit(".", 1)[-1] if "." in f.name else "bin")[:6]
        path = f"{_STORAGE_APP_NAME}/courses/{tid}/{course_id}/{fid}.{ext}"
        res = await run_in_threadpool(_put_object_sync, path, base64.b64decode(b64), meta["mime"])
        if res:
            meta["path"] = res.get("path") or path
            return meta
    except Exception as exc:  # noqa: BLE001
        logger.warning("[courses] object storage fallito (%s) → fallback Mongo", exc)
    meta["data_b64"] = b64
    return meta


def _course_public(c: dict, user: dict, names: Dict[str, str]) -> dict:
    uid = user["user_id"]
    is_creator = c.get("created_by") == uid
    reads = c.get("reads") or {}
    part = c.get("participation") or {}
    out = {k: v for k, v in c.items() if k not in ("_id", "reads", "participation")}
    out["files"] = [{k: v for k, v in f.items() if k != "data_b64"} for f in (c.get("files") or [])]
    out["is_creator"] = is_creator
    out["creator_name"] = names.get(c.get("created_by") or "", "")
    out["my_read_at"] = reads.get(uid)
    out["is_new"] = (not is_creator) and uid not in reads  # → badge lampeggiante
    mp = part.get(uid) or {}
    out["my_participation"] = mp.get("status") or "pending"
    out["my_notes"] = mp.get("notes") or ""
    out["recipient_count"] = len(c.get("recipients") or [])
    out["read_count"] = sum(1 for r in (c.get("recipients") or []) if r in reads)
    out["yes_count"] = sum(1 for r in (c.get("recipients") or []) if (part.get(r) or {}).get("status") == "yes")
    out["no_count"] = sum(1 for r in (c.get("recipients") or []) if (part.get(r) or {}).get("status") == "no")
    if is_creator:  # lista partecipanti: SOLO il creatore
        out["participants"] = [{
            "user_id": r, "name": names.get(r, r), "read_at": reads.get(r), "status": (part.get(r) or {}).get("status") or "pending",
            "notes": (part.get(r) or {}).get("notes") or "", "answered_at": (part.get(r) or {}).get("timestamp"),
        } for r in (c.get("recipients") or [])]
    return out


async def _course_names(ids: List[str]) -> Dict[str, str]:
    names: Dict[str, str] = {}
    async for u in db.users.find({"user_id": {"$in": list(set(ids))}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}):
        names[u["user_id"]] = u.get("name") or u.get("email") or u["user_id"]
    return names


async def _course_get(course_id: str, user: dict) -> dict:
    c = await db.courses_folders.find_one({"course_id": course_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Corso non trovato")
    if c.get("created_by") != user["user_id"] and user["user_id"] not in (c.get("recipients") or []) and not is_owner(user):
        raise HTTPException(status_code=403, detail="Corso non assegnato a te")
    return c


@api_router.get("/courses/can-manage")
async def courses_can_manage(user=Depends(get_current_user)):
    team = await _course_default_recipients(user)
    names = await _course_names(team)
    return {"can_manage": await _course_can_manage(user), "team": [{"user_id": u, "name": names.get(u, u)} for u in team]}


@api_router.post("/courses")
async def course_create(body: CourseIn, user=Depends(get_current_user)):
    if not await _course_can_manage(user):
        raise HTTPException(status_code=403, detail="Solo Master o Manager possono creare cartelle corsi")
    tid = tenant_id(user)
    course_id = f"crs_{uuid.uuid4().hex[:12]}"
    recipients = body.recipients or await _course_default_recipients(user)
    files = [await _course_store_file(tid, course_id, f) for f in body.files[:20]]
    doc = {
        "course_id": course_id, "tenant_id": tid, "created_by": user["user_id"], "title": body.title.strip()[:160] or "Corso",
        "description": (body.description or "").strip()[:2000], "body_text": (body.body_text or "")[:20000], "course_date": (body.course_date or "")[:10],
        "location": (body.location or "").strip()[:200], "maps_url": (body.maps_url or "").strip()[:500], "recipients": recipients,
        "reminder_days": max(0, min(30, int(body.reminder_days or 0))), "files": files, "status": "active", "reads": {}, "participation": {},
        "reminders_sent": {}, "created_at": utcnow(), "updated_at": utcnow(),
    }
    await db.courses_folders.insert_one(doc)
    for r in recipients:
        try:
            await axon_notify(r, tid, "reminder", f"📚 Nuovo corso: {doc['title']}", "Apri la cartella per leggere i materiali e indicare se partecipi.",
                              deeplink=f"/courses/{course_id}", dedupe_key=f"course_new_{course_id}_{r}", team_copy=False)
        except Exception:  # noqa: BLE001
            pass
    names = await _course_names([user["user_id"], *recipients])
    return _course_public(doc, user, names)


@api_router.get("/courses")
async def courses_list(include_archived: bool = False, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"tenant_id": tenant_id(user), "$or": [{"created_by": user["user_id"]}, {"recipients": user["user_id"]}]}
    if is_owner(user):
        q.pop("$or")
    if not include_archived:
        q["status"] = "active"
    items = await db.courses_folders.find(q, {"_id": 0, "files.data_b64": 0, "body_text": 0}).sort("created_at", -1).to_list(300)
    ids = {c["created_by"] for c in items} | {r for c in items for r in (c.get("recipients") or [])}
    names = await _course_names(list(ids))
    out = [_course_public(c, user, names) for c in items]
    return {"items": out, "new_count": sum(1 for c in out if c["is_new"]), "can_manage": await _course_can_manage(user)}


@api_router.get("/courses/{course_id}")
async def course_get(course_id: str, user=Depends(get_current_user)):
    c = await _course_get(course_id, user)
    names = await _course_names([c["created_by"], *(c.get("recipients") or [])])
    return _course_public(c, user, names)


@api_router.post("/courses/{course_id}/read")
async def course_mark_read(course_id: str, user=Depends(get_current_user)):
    """Primo click sulla cartella: ferma il lampeggio, registra timestamp, notifica il creatore."""
    c = await _course_get(course_id, user)
    uid = user["user_id"]
    if c.get("created_by") == uid or uid in (c.get("reads") or {}):
        return {"ok": True, "already": True}
    now = utcnow()
    await db.courses_folders.update_one({"course_id": course_id}, {"$set": {f"reads.{uid}": now}})
    try:
        await axon_notify(c["created_by"], c["tenant_id"], "reminder", f"👀 {user.get('name') or user.get('email')} ha letto il corso «{c['title']}»",
                          f"Letto il {now.astimezone().strftime('%d/%m/%Y %H:%M')}.", deeplink=f"/courses/{course_id}", dedupe_key=f"course_read_{course_id}_{uid}", team_copy=False)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "read_at": now}


@api_router.post("/courses/{course_id}/participation")
async def course_participation(course_id: str, body: ParticipationIn, user=Depends(get_current_user)):
    c = await _course_get(course_id, user)
    if body.status not in ("yes", "no"):
        raise HTTPException(status_code=400, detail="status deve essere yes|no")
    uid = user["user_id"]
    now = utcnow()
    rec = {"status": body.status, "notes": (body.notes or "").strip()[:1000], "timestamp": now}
    await db.courses_folders.update_one({"course_id": course_id}, {"$set": {f"participation.{uid}": rec, f"reads.{uid}": (c.get("reads") or {}).get(uid) or now}})
    who = user.get("name") or user.get("email")
    title = f"✅ {who}: Partecipo" if body.status == "yes" else f"❌ {who}: Non partecipo"
    msg = f"Corso «{c['title']}»" + (f" — motivo: {rec['notes']}" if body.status == "no" and rec["notes"] else "")
    try:
        await axon_notify(c["created_by"], c["tenant_id"], "reminder", title, msg, deeplink=f"/courses/{course_id}",
                          dedupe_key=f"course_part_{course_id}_{uid}_{body.status}_{now.strftime('%Y%m%d%H%M')}", extra={"urgency": "HIGH" if body.status == "no" else "NORMAL"}, team_copy=False)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "participation": rec}


@api_router.put("/courses/{course_id}")
async def course_update(course_id: str, body: CourseUpdate, user=Depends(get_current_user)):
    c = await _course_get(course_id, user)
    if c.get("created_by") != user["user_id"] and not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il creatore può modificare il corso")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    for k in ("title", "description", "body_text", "course_date", "location", "maps_url", "recipients", "status"):
        v = getattr(body, k)
        if v is not None:
            upd[k] = v.strip() if isinstance(v, str) and k != "body_text" else v
    if body.reminder_days is not None:
        upd["reminder_days"] = max(0, min(30, int(body.reminder_days)))
    files = list(c.get("files") or [])
    if body.remove_file_ids:
        files = [f for f in files if f.get("file_id") not in set(body.remove_file_ids)]
    for f in (body.add_files or [])[:20]:
        files.append(await _course_store_file(c["tenant_id"], course_id, f))
    upd["files"] = files
    await db.courses_folders.update_one({"course_id": course_id}, {"$set": upd})
    new_recipients = [r for r in (body.recipients or []) if r not in (c.get("recipients") or [])]
    for r in new_recipients:
        try:
            await axon_notify(r, c["tenant_id"], "reminder", f"📚 Nuovo corso: {upd.get('title') or c['title']}", "Apri la cartella per leggere i materiali e indicare se partecipi.",
                              deeplink=f"/courses/{course_id}", dedupe_key=f"course_new_{course_id}_{r}", team_copy=False)
        except Exception:  # noqa: BLE001
            pass
    c2 = await db.courses_folders.find_one({"course_id": course_id}, {"_id": 0})
    names = await _course_names([c2["created_by"], *(c2.get("recipients") or [])])
    return _course_public(c2, user, names)


@api_router.delete("/courses/{course_id}")
async def course_delete(course_id: str, user=Depends(get_current_user)):
    c = await _course_get(course_id, user)
    if c.get("created_by") != user["user_id"] and not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il creatore può eliminare il corso")
    await db.courses_folders.delete_one({"course_id": course_id})
    return {"ok": True}


@api_router.get("/courses/{course_id}/files/{file_id}")
async def course_file(course_id: str, file_id: str, user=Depends(get_current_user)):
    c = await _course_get(course_id, user)
    f = next((x for x in (c.get("files") or []) if x.get("file_id") == file_id), None)
    if not f:
        raise HTTPException(status_code=404, detail="File non trovato")
    b64 = None
    if f.get("path"):
        got = await run_in_threadpool(_get_object_sync, f["path"])
        if got:
            b64 = base64.b64encode(got[0]).decode()
    b64 = b64 or f.get("data_b64")
    if not b64:
        raise HTTPException(status_code=404, detail="Contenuto non disponibile")
    return {"name": f["name"], "mime": f.get("mime") or "application/octet-stream", "data_base64": b64}


@api_router.get("/courses/{course_id}/export")
async def course_export(course_id: str, fmt: str = "xlsx", user=Depends(get_current_user)):
    """Riepilogo partecipanti (solo creatore/Master): xlsx (openpyxl) oppure html (stampabile in PDF)."""
    c = await _course_get(course_id, user)
    if c.get("created_by") != user["user_id"] and not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il creatore può esportare la lista")
    names = await _course_names(c.get("recipients") or [])
    reads, part = c.get("reads") or {}, c.get("participation") or {}
    rows = []
    for r in c.get("recipients") or []:
        p = part.get(r) or {}
        ra = reads.get(r)
        rows.append([names.get(r, r), ra.astimezone().strftime("%d/%m/%Y %H:%M") if isinstance(ra, datetime) else "non letto",
                     {"yes": "Partecipa", "no": "Non partecipa"}.get(p.get("status"), "In attesa"), p.get("notes") or ""])
    safe = re.sub(r"[^A-Za-z0-9_\- ]+", "", c["title"]).strip() or "corso"
    if fmt == "xlsx":
        import openpyxl
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Partecipanti"
        ws.append([f"Corso: {c['title']}", "", "", f"Data: {c.get('course_date') or '-'}"])
        ws.append(["Collaboratore", "Lettura", "Partecipazione", "Motivazioni"])
        for row in rows:
            ws.append(row)
        for col, w in zip("ABCD", (32, 20, 18, 60)):
            ws.column_dimensions[col].width = w
        buf = io.BytesIO(); wb.save(buf)
        return {"name": f"{safe}_partecipanti.xlsx", "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "data_base64": base64.b64encode(buf.getvalue()).decode()}
    trs = "".join(f"<tr><td>{html_lib.escape(a)}</td><td>{html_lib.escape(b)}</td><td>{html_lib.escape(cc)}</td><td>{html_lib.escape(d)}</td></tr>" for a, b, cc, d in rows)
    html = (f"<html><head><meta charset='utf-8'><style>body{{font-family:Helvetica,Arial;padding:24px}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #cbd5e1;padding:6px 8px;font-size:13px;text-align:left}}th{{background:#ede9fe}}</style></head>"
            f"<body><h2>Corso: {html_lib.escape(c['title'])}</h2><p>Data corso: {html_lib.escape(c.get('course_date') or '-')} · Letture {sum(1 for r in c.get('recipients') or [] if r in reads)}/{len(c.get('recipients') or [])}</p>"
            f"<table><tr><th>Collaboratore</th><th>Lettura</th><th>Partecipazione</th><th>Motivazioni</th></tr>{trs}</table></body></html>")
    return {"name": f"{safe}_partecipanti.html", "mime": "text/html", "html": html}


# ---------- Reminder automatici: non ha aperto entro X giorni / ha letto ma non ha risposto ----------
async def _courses_reminder_job():
    n = 0
    now = utcnow()
    try:
        async for c in db.courses_folders.find({"status": "active", "reminder_days": {"$gt": 0}}, {"_id": 0, "files": 0, "body_text": 0}):
            days = int(c.get("reminder_days") or 0)
            created = c.get("created_at")
            if not isinstance(created, datetime):
                continue
            created = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
            if (now - created).days < days:
                continue
            reads, part, sent = c.get("reads") or {}, c.get("participation") or {}, c.get("reminders_sent") or {}
            for r in c.get("recipients") or []:
                key = None
                if r not in reads:
                    key, title, msg = f"read_{r}", f"⏰ Corso da leggere: {c['title']}", f"Non hai ancora aperto la cartella del corso (da {days} giorni)."
                elif not (part.get(r) or {}).get("status"):
                    key, title, msg = f"part_{r}", f"⏰ Indica se partecipi: {c['title']}", "Hai letto il corso ma non hai ancora risposto ✅ Partecipo / ❌ Non partecipo."
                if not key or sent.get(key):
                    continue
                try:
                    await axon_notify(r, c["tenant_id"], "reminder", title, msg, deeplink=f"/courses/{c['course_id']}", dedupe_key=f"course_rem_{c['course_id']}_{key}", team_copy=False)
                    sent[key] = now.isoformat(); n += 1
                except Exception:  # noqa: BLE001
                    pass
            await db.courses_folders.update_one({"course_id": c["course_id"]}, {"$set": {"reminders_sent": sent}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[courses] reminder job error: %s", exc)
    return {"sent": n}


@api_router.post("/courses/run-reminders")
async def courses_run_reminders(user=Depends(get_current_user)):
    if not await _course_can_manage(user):
        raise HTTPException(status_code=403, detail="Solo Master/Manager")
    return await _courses_reminder_job()
