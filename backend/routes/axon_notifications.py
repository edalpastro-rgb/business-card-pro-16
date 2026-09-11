# axon_notifications.py — V50.z181 — Notifiche push native AxonOS (modulo ISOLATO)
# Nessuna modifica al codice esistente: riusa `send_push` (05, Emergent managed push), `db`, auth helpers,
# `_bill_deadline_entry` (14), `cgym_weekly_report` (corporate_gym) dal namespace condiviso.
#
# Casi coperti (job ogni 10 minuti su scheduler PROPRIO + hook manuali):
#   • cgym_due        — sessione Corporate Gym OBBLIGATORIA in scadenza (entro 24h) o scaduta da poco
#   • callback_urgent — richiamata URGENTE (priorità alta/urgente) in scadenza entro 60 min o già scaduta oggi
#   • credits         — utilizzo crediti AI del piano (richieste AxonOS del mese) al 50% / 80% / 100%
#   • weekly_report   — report settimanale Master Corporate Gym pronto (lunedì 08:00 Europe/Rome)
#   • axon_message    — messaggi critici decisi autonomamente da AxonOS (es. scadenze contratto critiche,
#                        errori sorgenti) + endpoint per invio programmatico
#
# Visibilità: il collaboratore riceve SOLO le proprie notifiche; il Master (owner) riceve anche una copia "[Team]"
# di quelle dei collaboratori (se abilitato nelle sue preferenze).
# Badge: ogni push porta `badge` = n. non lette del destinatario; l'app aggiorna l'icona (setBadgeCountAsync).
#
# Collections: axon_notifications { notif_id, tenant_id, user_id, kind, title, body, data{deeplink,...}, created_at,
#                                   read, read_at, push_sent, dedupe_key, team_copy_of }
#              axon_notification_prefs { user_id, enabled, kinds{kind: bool}, team_copies (owner), credits_plan_monthly (owner) }

from apscheduler.schedulers.asyncio import AsyncIOScheduler as _AxnScheduler

AXN_KINDS = {
    "cgym_due": "Sessioni Corporate Gym obbligatorie in scadenza",
    "callback_urgent": "Richiamate urgenti in scadenza",
    "credits": "Avvisi utilizzo crediti AI (50/80/100%)",
    "weekly_report": "Report settimanale Master pronto",
    "axon_message": "Messaggi critici di AxonOS",
}
AXN_DEFAULT_CREDITS_PLAN = 1000  # richieste AxonOS / mese per tenant (modificabile dal Master)
_AXN_TZ = "Europe/Rome"


class AxnPrefsIn(BaseModel):
    enabled: Optional[bool] = None
    kinds: Optional[Dict[str, bool]] = None
    team_copies: Optional[bool] = None
    credits_plan_monthly: Optional[int] = None


class AxnSendIn(BaseModel):
    user_id: Optional[str] = None  # default: me
    title: str
    body: str
    deeplink: Optional[str] = None
    kind: str = "axon_message"
    dedupe_key: Optional[str] = None


def _axn_aware(d):
    """Motor restituisce datetime naive (UTC): rendili confrontabili con utcnow()."""
    if isinstance(d, datetime) and d.tzinfo is None:
        return d.replace(tzinfo=timezone.utc)
    return d


def _axn_default_prefs(uid: str) -> dict:
    return {"user_id": uid, "enabled": True, "kinds": {k: True for k in AXN_KINDS}, "team_copies": True, "credits_plan_monthly": AXN_DEFAULT_CREDITS_PLAN}


async def _axn_prefs(uid: str) -> dict:
    p = await db.axon_notification_prefs.find_one({"user_id": uid}, {"_id": 0})
    base = _axn_default_prefs(uid)
    if p:
        base.update({k: v for k, v in p.items() if v is not None})
        base["kinds"] = {**_axn_default_prefs(uid)["kinds"], **(p.get("kinds") or {})}
    return base


async def _axn_unread(uid: str) -> int:
    return await db.axon_notifications.count_documents({"user_id": uid, "read": False})


async def _axn_owner_of(tid: str) -> Optional[dict]:
    return await db.users.find_one({"user_id": tid}, {"_id": 0, "user_id": 1, "name": 1, "role": 1, "email": 1})


async def axon_notify(user_id: str, tenant: str, kind: str, title: str, body: str, deeplink: Optional[str] = None,
                      dedupe_key: Optional[str] = None, extra: Optional[dict] = None, team_copy: bool = True,
                      _copy_of: Optional[str] = None, _sender_name: Optional[str] = None) -> Optional[dict]:
    """Crea la notifica in-app e invia il push (se preferenze lo consentono). Idempotente su dedupe_key."""
    if kind not in AXN_KINDS:
        kind = "axon_message"
    if dedupe_key and await db.axon_notifications.find_one({"user_id": user_id, "dedupe_key": dedupe_key}, {"_id": 1}):
        return None
    prefs = await _axn_prefs(user_id)
    allowed = prefs.get("enabled", True) and prefs.get("kinds", {}).get(kind, True)
    doc = {
        "notif_id": f"axn_{uuid.uuid4().hex[:12]}", "tenant_id": tenant, "user_id": user_id, "kind": kind,
        "title": title[:120], "body": body[:600], "data": {"deeplink": deeplink or "/axon-notifications", **(extra or {})},
        "created_at": utcnow(), "read": False, "read_at": None, "push_sent": False, "dedupe_key": dedupe_key, "team_copy_of": _copy_of,
    }
    await db.axon_notifications.insert_one(doc)
    if allowed:
        try:
            badge = await _axn_unread(user_id)
            await send_push([user_id], {"title": doc["title"], "message": doc["body"], "deeplink": doc["data"]["deeplink"],
                                        "badge": badge, "kind": kind, "notif_id": doc["notif_id"], "tag": f"axn_{kind}"},
                            idempotency_key=f"{user_id}:{dedupe_key}" if dedupe_key else None)
            await db.axon_notifications.update_one({"notif_id": doc["notif_id"]}, {"$set": {"push_sent": True}})
            doc["push_sent"] = True
        except Exception as exc:  # noqa: BLE001
            logger.warning("[axn] push failed: %s", exc)
    # Copia per il Master (visibilità team): solo se il destinatario NON è il titolare
    if team_copy and user_id != tenant and _copy_of is None:
        owner = await _axn_owner_of(tenant)
        if owner:
            oprefs = await _axn_prefs(tenant)
            if oprefs.get("team_copies", True):
                who = _sender_name
                if not who:
                    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "name": 1, "email": 1})
                    who = (u or {}).get("name") or (u or {}).get("email") or "collaboratore"
                await axon_notify(tenant, tenant, kind, f"[Team · {who}] {title}", body, deeplink,
                                  dedupe_key=f"team:{user_id}:{dedupe_key}" if dedupe_key else None, extra=extra,
                                  team_copy=False, _copy_of=doc["notif_id"])
    doc.pop("_id", None)
    return doc


def _axn_out(d: dict) -> dict:
    d = dict(d); d.pop("_id", None)
    for k in ("created_at", "read_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    return d


# ----------------------------------------------------------------------------- API
@api_router.get("/axon-notifications")
async def axn_list(unread_only: bool = False, limit: int = 50, user=Depends(get_current_user)):
    q = {"user_id": user["user_id"]}
    if unread_only:
        q["read"] = False
    items = [_axn_out(d) async for d in db.axon_notifications.find(q).sort("created_at", -1).limit(max(1, min(limit, 200)))]
    return {"items": items, "unread": await _axn_unread(user["user_id"])}


@api_router.get("/axon-notifications/unread-count")
async def axn_unread_count(user=Depends(get_current_user)):
    return {"unread": await _axn_unread(user["user_id"])}


@api_router.post("/axon-notifications/read-all")
async def axn_read_all(user=Depends(get_current_user)):
    r = await db.axon_notifications.update_many({"user_id": user["user_id"], "read": False}, {"$set": {"read": True, "read_at": utcnow()}})
    return {"ok": True, "updated": r.modified_count, "unread": 0}


@api_router.post("/axon-notifications/{notif_id}/read")
async def axn_read(notif_id: str, user=Depends(get_current_user)):
    await db.axon_notifications.update_one({"notif_id": notif_id, "user_id": user["user_id"]}, {"$set": {"read": True, "read_at": utcnow()}})
    return {"ok": True, "unread": await _axn_unread(user["user_id"])}


@api_router.delete("/axon-notifications/{notif_id}")
async def axn_delete(notif_id: str, user=Depends(get_current_user)):
    r = await db.axon_notifications.delete_one({"notif_id": notif_id, "user_id": user["user_id"]})
    return {"ok": True, "deleted": r.deleted_count, "unread": await _axn_unread(user["user_id"])}


@api_router.get("/axon-notifications/prefs")
async def axn_prefs_get(user=Depends(get_current_user)):
    p = await _axn_prefs(user["user_id"])
    p["kinds_labels"] = AXN_KINDS
    p["is_owner"] = is_owner(user)
    if is_owner(user):
        p["credits_used_month"] = await _axn_credits_used(tenant_id(user))
    return p


@api_router.put("/axon-notifications/prefs")
async def axn_prefs_put(body: AxnPrefsIn, user=Depends(get_current_user)):
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.enabled is not None:
        upd["enabled"] = bool(body.enabled)
    if body.kinds is not None:
        upd["kinds"] = {k: bool(v) for k, v in body.kinds.items() if k in AXN_KINDS}
    if body.team_copies is not None and is_owner(user):
        upd["team_copies"] = bool(body.team_copies)
    if body.credits_plan_monthly is not None and is_owner(user):
        upd["credits_plan_monthly"] = max(10, min(1_000_000, int(body.credits_plan_monthly)))
    await db.axon_notification_prefs.update_one({"user_id": user["user_id"]}, {"$set": upd, "$setOnInsert": {"user_id": user["user_id"]}}, upsert=True)
    return await axn_prefs_get(user)


@api_router.post("/axon-notifications/send")
async def axn_send(body: AxnSendIn, user=Depends(get_current_user)):
    """Invio programmatico (AxonOS / Master). Un collaboratore può inviare solo a sé stesso."""
    target = body.user_id or user["user_id"]
    tid = tenant_id(user)
    if target != user["user_id"]:
        if not is_admin_or_owner(user):
            raise HTTPException(status_code=403, detail="Solo Master/Admin possono notificare altri utenti")
        t = await db.users.find_one({"user_id": target, "$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 1})
        if not t:
            raise HTTPException(status_code=404, detail="Utente non nel tuo team")
    doc = await axon_notify(target, tid, body.kind, body.title, body.body, body.deeplink, dedupe_key=body.dedupe_key,
                            team_copy=(target != user["user_id"]))
    return {"ok": True, "notification": _axn_out(doc) if doc else None, "deduplicated": doc is None}


@api_router.post("/axon-notifications/test")
async def axn_test(user=Depends(get_current_user)):
    """Notifica di prova a sé stessi (verifica push sul dispositivo)."""
    doc = await axon_notify(user["user_id"], tenant_id(user), "axon_message", "AxonOS · notifica di prova",
                            "Se leggi questo messaggio sul telefono, le notifiche push funzionano ✅", "/axon-notifications", team_copy=False)
    return {"ok": True, "notification": _axn_out(doc) if doc else None, "push_configured": _PUSH_KEY not in ("", "placeholder")}


@api_router.post("/axon-notifications/run-checks")
async def axn_run_checks(user=Depends(get_current_user)):
    """Esegue subito i controlli (solo Master/Admin) — utile per test."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo Master/Admin")
    return await _axn_run_all_checks(only_tenant=tenant_id(user))


# ----------------------------------------------------------------------------- CHECKS
def _axn_members_filter(tid: str) -> dict:
    return {"$or": [{"user_id": tid}, {"parent_user_id": tid}]}


async def _axn_tenants(only_tenant: Optional[str] = None) -> List[str]:
    if only_tenant:
        return [only_tenant]
    return [u["user_id"] async for u in db.users.find({"role": "owner", "parent_user_id": {"$in": [None, ""]}}, {"_id": 0, "user_id": 1}).limit(2000)]


async def _axn_check_cgym_due(tid: str) -> int:
    now = utcnow(); horizon = now + timedelta(hours=24); n = 0
    cur = db.cgym_sessions.find({"tenant_id": tid, "mandatory": True, "status": {"$nin": ["completata", "annullata"]},
                                 "scheduled_at": {"$gte": now - timedelta(hours=12), "$lte": horizon}},
                                {"_id": 0, "session_id": 1, "user_id": 1, "title": 1, "type": 1, "scheduled_at": 1})
    async for s in cur:
        due = _axn_aware(s.get("scheduled_at"))
        late = bool(due and due < now)
        when = _fmt_dt_it(due) if due else ""
        title = "Sessione Gym obbligatoria scaduta" if late else "Sessione Gym obbligatoria in scadenza"
        body = f"{s.get('title') or 'Role-play'} · {'era prevista per' if late else 'entro'} {when}. Aprila in Corporate Gym."
        r = await axon_notify(s["user_id"], tid, "cgym_due", title, body, "/corporate-gym",
                              dedupe_key=f"cgym_due:{s['session_id']}:{'late' if late else 'soon'}", extra={"session_id": s["session_id"]})
        n += 1 if r else 0
    return n


async def _axn_check_callbacks(tid: str) -> int:
    now = utcnow(); n = 0
    urgent_vals = ["alta", "urgente", "high", "urgent", "massima"]
    q = {"$and": [{"$or": [{"user_id": tid}, {"tenant_id": tid}]},
                  {"$or": [{"done": False}, {"done": {"$exists": False}}]},
                  {"status": {"$nin": ["done", "fatta", "cancelled", "completed"]}},
                  {"$or": [{"priority": {"$in": urgent_vals}}, {"urgent": True}]}]}
    async for cb in db.callbacks.find(q, {"_id": 0}).limit(500):
        due = _axn_aware(cb.get("next_at") or cb.get("scheduled_at"))
        if not isinstance(due, datetime) or not (now - timedelta(hours=6) <= due <= now + timedelta(minutes=60)):
            continue
        recipient = cb.get("assignee_user_id") or cb.get("created_by") or cb.get("user_id")
        if not recipient or recipient == tid and cb.get("user_id") == tid and cb.get("created_by") and cb["created_by"] != tid:
            recipient = cb.get("created_by")
        if not recipient:
            continue
        cname = ""
        if cb.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": cb["contact_id"]}, {"first_name": 1, "last_name": 1})
            if c:
                cname = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip()
        late = due < now
        cid = cb.get("callback_id") or cb.get("id") or ""
        title = "Richiamata urgente scaduta" if late else "Richiamata urgente tra poco"
        body = f"{cname or cb.get('title') or cb.get('phone') or 'Contatto'} · {_fmt_dt_it(due)}" + (f" · {cb.get('phone')}" if cb.get("phone") and cname else "")
        r = await axon_notify(recipient, tid, "callback_urgent", title, body, "/callback",
                              dedupe_key=f"cb:{cid}:{'late' if late else 'soon'}:{due.strftime('%Y%m%d%H%M')}", extra={"callback_id": cid})
        n += 1 if r else 0
    return n


async def _axn_credits_used(tid: str) -> int:
    now = utcnow(); month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    uids = [u["user_id"] async for u in db.users.find(_axn_members_filter(tid), {"_id": 0, "user_id": 1}).limit(500)]
    return await db.assistant_messages.count_documents({"user_id": {"$in": uids}, "role": "user", "created_at": {"$gte": month_start}})


async def _axn_check_credits(tid: str) -> int:
    prefs = await _axn_prefs(tid)
    plan = int(prefs.get("credits_plan_monthly") or AXN_DEFAULT_CREDITS_PLAN)
    used = await _axn_credits_used(tid)
    pct = used * 100.0 / max(plan, 1)
    month = utcnow().strftime("%Y-%m"); n = 0
    for thr in (50, 80, 100):
        if pct >= thr:
            if thr == 100:
                title, body = "Crediti AI esauriti (100%)", f"Hai usato {used}/{plan} richieste AxonOS del piano mensile. Axon continua a rispondere, ma valuta l'upgrade del piano."
            else:
                title, body = f"Crediti AI al {thr}%", f"Hai usato {used}/{plan} richieste AxonOS di questo mese ({pct:.0f}%)."
            r = await axon_notify(tid, tid, "credits", title, body, "/axon-notifications?tab=prefs", dedupe_key=f"credits:{month}:{thr}",
                                  extra={"used": used, "plan": plan, "pct": round(pct)}, team_copy=False)
            n += 1 if r else 0
    return n


async def _axn_check_weekly_report(tid: str, force_now: bool = False) -> int:
    """Lunedì (Europe/Rome) → genera/recupera il report settimanale Corporate Gym e avvisa il Master."""
    from zoneinfo import ZoneInfo
    now_it = datetime.now(ZoneInfo(_AXN_TZ))
    if not force_now and not (now_it.weekday() == 0 and now_it.hour >= 8):
        return 0
    week = now_it.strftime("%G-W%V")
    if await db.axon_notifications.find_one({"user_id": tid, "dedupe_key": f"weekly:{week}"}, {"_id": 1}):
        return 0
    has_activity = await db.cgym_roleplays.count_documents({"tenant_id": tid, "status": "finished", "finished_at": {"$gte": utcnow() - timedelta(days=7)}})
    if not has_activity and not force_now:
        return 0
    owner = await _axn_owner_of(tid)
    if not owner:
        return 0
    summary = ""
    try:
        rep = await cgym_weekly_report(False, user={**owner, "role": "owner"})
        content = (rep or {}).get("content") or {}
        summary = str(content.get("summary") or content.get("sintesi") or "")[:200]
    except Exception as exc:  # noqa: BLE001
        logger.info("[axn] weekly report generation skipped: %s", exc)
    r = await axon_notify(tid, tid, "weekly_report", "Report settimanale Corporate Gym pronto",
                          summary or "AxonOS ha preparato il riepilogo settimanale del team: apri le Statistiche per leggerlo.",
                          "/corporate-gym/stats", dedupe_key=f"weekly:{week}", team_copy=False)
    return 1 if r else 0


async def _axn_check_axon_critical(tid: str) -> int:
    """Messaggi autonomi di AxonOS: scadenze contratto critiche (≤ 3 giorni o scadute da ≤ 7) sui contatti visibili."""
    n = 0
    members = [u async for u in db.users.find(_axn_members_filter(tid), {"_id": 0, "user_id": 1, "role": 1})]
    bills = await db.energy_bills.find({"user_id": tid, "status": "done"}, {"_id": 0, "pdf_base64": 0}).limit(3000).to_list(3000)
    cache_c: Dict[str, dict] = {}
    for b in bills:
        try:
            d = _bill_deadline_entry(b)
        except Exception:
            d = None
        if not d or d.get("days_left") is None or not (-7 <= d["days_left"] <= 3):
            continue
        c = cache_c.get(b.get("contact_id"))
        if c is None:
            c = await db.contacts.find_one({"contact_id": b.get("contact_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "created_by": 1, "assigned_to_user_id": 1}) or {}
            cache_c[b.get("contact_id")] = c
        recipient = c.get("assigned_to_user_id") or c.get("created_by") or tid
        if recipient not in {m["user_id"] for m in members}:
            recipient = tid
        cname = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip() or "Cliente"
        dl = d["days_left"]
        title = "Contratto scaduto" if dl < 0 else ("Contratto scade oggi" if dl == 0 else f"Contratto scade tra {dl} giorni")
        body = f"{cname} · {d.get('bill_type') or ''} {d.get('fornitore') or ''} · scadenza {str(d.get('due_date') or '')[:10]}. Contatta il cliente per il rinnovo."
        r = await axon_notify(recipient, tid, "axon_message", f"AxonOS · {title}", body, f"/contact/{b.get('contact_id')}",
                              dedupe_key=f"deadline:{b.get('bill_id')}:{'late' if dl < 0 else 'soon'}", extra={"contact_id": b.get("contact_id")})
        n += 1 if r else 0
    return n


async def _axn_run_all_checks(only_tenant: Optional[str] = None, force_weekly: bool = False) -> dict:
    stats = {"tenants": 0, "cgym_due": 0, "callback_urgent": 0, "credits": 0, "weekly_report": 0, "axon_message": 0}
    for tid in await _axn_tenants(only_tenant):
        stats["tenants"] += 1
        for key, fn in (("cgym_due", _axn_check_cgym_due), ("callback_urgent", _axn_check_callbacks), ("credits", _axn_check_credits),
                        ("axon_message", _axn_check_axon_critical)):
            try:
                stats[key] += await fn(tid)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[axn] check %s failed for %s: %s", key, tid, exc)
        try:
            stats["weekly_report"] += await _axn_check_weekly_report(tid, force_now=force_weekly)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[axn] weekly check failed for %s: %s", tid, exc)
    return stats


_axn_scheduler = _AxnScheduler(timezone=_AXN_TZ)


async def _axn_tick():
    try:
        s = await _axn_run_all_checks()
        if any(v for k, v in s.items() if k != "tenants"):
            logger.info("[axn] tick: %s", s)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axn] tick failed: %s", exc)


@app.on_event("startup")
async def _axn_start():
    try:
        await db.axon_notifications.create_index([("user_id", 1), ("read", 1), ("created_at", -1)])
        await db.axon_notifications.create_index([("user_id", 1), ("dedupe_key", 1)])
        _axn_scheduler.add_job(_axn_tick, "interval", minutes=10, id="axn-tick", replace_existing=True)
        _axn_scheduler.start()
        logger.info("[axn] AxonOS notifications scheduler started (every 10 min)")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axn] scheduler start failed: %s", exc)
