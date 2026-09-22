# axon_proactive.py — V50.z196 — BLOCCO 9: Proattività AxonOS (modulo ISOLATO, nessuna modifica al core CRM)
#
# Caricato nel namespace condiviso DOPO axon_notifications / axon_push_bridge / axon_imported_data / axon_crm_omniscience
# e PRIMA di 37 (include_router). Usa: axon_notify (→ send_push avvolto dal bridge push: esito reale + outbox retry),
# _axn_scheduler (APScheduler già attivo), _omni_contact_query/_omni_own (stesso perimetro di visibilità di Axon),
# _prepare_assistant_prompt (wrapper a catena: istruzione promemoria proattivi), db.assistant_messages (messaggi in chat).
#
# COSA FA — AxonOS decide da solo quando parlare all'utente:
#   a) BRIEFING MATTUTINO (default 07:30 Europe/Rome, orario/giorni configurabili): appuntamenti di oggi, richiamate in scadenza,
#      clienti non contattati da > N giorni, contratti in scadenza, obiettivi settimanali. Push + messaggio già in chat.
#   b) SUGGERIMENTI CONTESTUALI (scan ogni 10 min, 08:00-21:00, max N/giorno — default 3, cap del Master sul team):
#      cliente inattivo, appuntamento domani, contratto in scadenza ≤ N giorni, obiettivo settimanale sotto soglia a metà settimana.
#   c) ALERT CRITICI (max 5/giorno): scadenza entro 24/48 h (contratti/richiamate), richiamata urgente non evasa da > X ore,
#      anomalia su dati importati (variazione > X % rispetto alla media della serie), promemoria impostati da AxonOS in chat
#      (riga «📌 Promemoria proattivo: GG/MM/AAAA HH:MM — testo» nelle sue risposte → letta dallo scan → notifica alla scadenza).
#   d) REPORT SETTIMANALE (lunedì, default 08:00): telefonate, appuntamenti completati, contratti, nuovi contatti, obiettivi vs target.
#
# TRIGGER UNICO (ViolaWake-ready): POST /axon/proactive/trigger {action, source} — stessa funzione sia dal tap sulla notifica
# (deeplink /axon-proactive?item=…) sia da un segnale vocale esterno (source="voice"/"wake_word"): nessuna modifica interna richiesta.
#
# Collection: axon_proactive_config {user_id, tenant_id, …soglie…}, axon_proactive_log {item_id, kind, type, title, body, chat_text,
#             actions[], deeplink, dedupe_key, source, created_at, read_at, dismissed_at, responded_at, push_status},
#             axon_proactive_reminders {reminder_id, user_id, text, due_at, status, origin(message_id|api), created_at}.
# Preferenze per utente (attiva/disattiva per tipo) → nuove voci in AXN_KINDS (UI Preferenze già esistente):
#   proactive_briefing, proactive_suggestion, proactive_alert, proactive_weekly.

from zoneinfo import ZoneInfo as _ApxZone

_APX_TZ = _ApxZone("Europe/Rome")
_APX_LAST_SCAN: Dict[str, datetime] = {}
_APX_SCAN_EVERY = timedelta(minutes=10)
_APX_MAX_ALERTS_DAY = 5
_APX_REMINDER_RE = re.compile(r"📌\s*Promemoria proattivo:\s*(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?\s*[—\-–:]\s*(.+)", re.IGNORECASE)
_APX_MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
_APX_GIORNI = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]

AXN_KINDS.update({
    "proactive_briefing": "Briefing mattutino AxonOS",
    "proactive_suggestion": "Suggerimenti proattivi AxonOS (max N al giorno)",
    "proactive_alert": "Alert critici proattivi (scadenze, anomalie, richiamate, promemoria)",
    "proactive_weekly": "Report settimanale AxonOS (lunedì)",
})

_APX_DEFAULT_CONFIG: Dict[str, Any] = {
    "briefing_enabled": True, "briefing_time": "07:30", "briefing_days": [0, 1, 2, 3, 4, 5],
    "weekly_report_enabled": True, "weekly_report_time": "08:00",
    "max_suggestions_per_day": 3, "quiet_start": "21:00", "quiet_end": "08:00",
    "inactive_days": 30, "deadline_hours": 48, "callback_overdue_hours": 2, "contract_days": 15, "anomaly_pct": 15, "goal_alert_pct": 20,
    "weekly_targets": {"calls": 20, "appointments": 5, "contracts": 2, "new_contacts": 5},
    "alerts": {"inactive": True, "appointment_tomorrow": True, "contract_expiry": True, "goal_progress": True,
               "deadline": True, "callback_overdue": True, "imported_anomaly": True, "custom_reminder": True},
    "team_max_suggestions_per_day": 3,   # solo Master: tetto per tutto il team
}

_APX_TYPE_LABELS = {
    "briefing": "Briefing mattutino", "weekly": "Report settimanale", "inactive": "Cliente inattivo", "appointment_tomorrow": "Appuntamento domani",
    "contract_expiry": "Contratto in scadenza", "goal_progress": "Obiettivo settimanale", "deadline": "Scadenza critica",
    "callback_overdue": "Richiamata urgente non evasa", "imported_anomaly": "Anomalia dati importati", "custom_reminder": "Promemoria di AxonOS",
    "lead_demo": "Richiesta demo (landing)",
}

_OMNI_EXTRA_SECTIONS.append((
    "Proattività AxonOS (Blocco 9)", "/axon-proactive",
    "AxonOS parla per primo: briefing mattutino (07:30, configurabile), suggerimenti contestuali (cliente inattivo, appuntamento domani, contratto in "
    "scadenza, obiettivo settimanale), alert critici (scadenze 24/48 h, richiamate urgenti non evase, anomalie sui dati importati, promemoria "
    "proattivi) e report settimanale del lunedì. Tutto configurabile in Notifiche AxonOS → Preferenze (soglie, orari, max al giorno); log in "
    "Memoria AxonOS. In chat: «briefing di oggi», «report della settimana», «ricordati di … il GG/MM».",
))


# ============================================================================ helper
class ApxConfigIn(BaseModel):
    briefing_enabled: Optional[bool] = None
    briefing_time: Optional[str] = None
    briefing_days: Optional[List[int]] = None
    weekly_report_enabled: Optional[bool] = None
    weekly_report_time: Optional[str] = None
    max_suggestions_per_day: Optional[int] = None
    quiet_start: Optional[str] = None
    quiet_end: Optional[str] = None
    inactive_days: Optional[int] = None
    deadline_hours: Optional[int] = None
    callback_overdue_hours: Optional[int] = None
    contract_days: Optional[int] = None
    anomaly_pct: Optional[int] = None
    goal_alert_pct: Optional[int] = None
    weekly_targets: Optional[Dict[str, int]] = None
    alerts: Optional[Dict[str, bool]] = None
    team_max_suggestions_per_day: Optional[int] = None


class ApxTriggerIn(BaseModel):
    action: str = "briefing"            # briefing | weekly_report | scan | open
    source: str = "manual"              # manual | notification_tap | voice | wake_word | scheduler
    item_id: Optional[str] = None


class ApxReminderIn(BaseModel):
    text: str
    due_at: str                          # ISO 8601 (locale o UTC)


def _apx_now_it() -> datetime:
    return datetime.now(_APX_TZ)


def _apx_hm(s: str, default: str) -> Tuple[int, int]:
    try:
        h, m = str(s or default).split(":")[:2]
        return max(0, min(23, int(h))), max(0, min(59, int(m)))
    except Exception:
        h, m = default.split(":")
        return int(h), int(m)


def _apx_out(d: Optional[dict]) -> Optional[dict]:
    if not d:
        return None
    d = dict(d); d.pop("_id", None)
    for k, v in list(d.items()):
        if isinstance(v, datetime):
            d[k] = (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat()
    return d


def _apx_dt_it(d: Optional[datetime], with_day: bool = True) -> str:
    d = _axn_aware(d)
    if not isinstance(d, datetime):
        return ""
    loc = d.astimezone(_APX_TZ)
    return (f"{_APX_GIORNI[loc.weekday()]} {loc.day} {_APX_MESI[loc.month - 1]} " if with_day else "") + loc.strftime("%H:%M")


def _apx_date_it(d) -> str:
    """'27 settembre' da datetime o stringa YYYY-MM-DD."""
    if isinstance(d, str):
        try:
            d = datetime.strptime(d[:10], "%Y-%m-%d")
        except Exception:
            return d
    d = _axn_aware(d)
    if not isinstance(d, datetime):
        return ""
    loc = d.astimezone(_APX_TZ) if d.tzinfo else d
    return f"{loc.day} {_APX_MESI[loc.month - 1]}"


async def _apx_config(uid: str) -> dict:
    doc = await db.axon_proactive_config.find_one({"user_id": uid}, {"_id": 0}) or {}
    cfg = {**_APX_DEFAULT_CONFIG, **{k: v for k, v in doc.items() if v is not None}}
    cfg["weekly_targets"] = {**_APX_DEFAULT_CONFIG["weekly_targets"], **(doc.get("weekly_targets") or {})}
    cfg["alerts"] = {**_APX_DEFAULT_CONFIG["alerts"], **(doc.get("alerts") or {})}
    cfg["user_id"] = uid
    return cfg


async def _apx_effective_max_suggestions(user: dict, cfg: dict) -> int:
    own = int(cfg.get("max_suggestions_per_day") or 3)
    tid = tenant_id(user)
    if tid == user["user_id"]:
        return max(0, own)
    master = await db.axon_proactive_config.find_one({"user_id": tid}, {"_id": 0, "team_max_suggestions_per_day": 1}) or {}
    cap = int(master.get("team_max_suggestions_per_day") or _APX_DEFAULT_CONFIG["team_max_suggestions_per_day"])
    return max(0, min(own, cap))


async def _apx_users() -> List[dict]:
    return [u async for u in db.users.find({"$or": [{"disabled": {"$exists": False}}, {"disabled": False}]},
                                           {"_id": 0, "user_id": 1, "parent_user_id": 1, "role": 1, "name": 1, "email": 1}).limit(3000)]


async def _apx_count_today(uid: str, kind: str) -> int:
    start = _apx_now_it().replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    return await db.axon_proactive_log.count_documents({"user_id": uid, "kind": kind, "created_at": {"$gte": start}})


def _apx_in_quiet(cfg: dict, now_it: datetime) -> bool:
    qs = _apx_hm(cfg.get("quiet_start"), "21:00"); qe = _apx_hm(cfg.get("quiet_end"), "08:00")
    cur = now_it.hour * 60 + now_it.minute; s = qs[0] * 60 + qs[1]; e = qe[0] * 60 + qe[1]
    return (cur >= s or cur < e) if s > e else (s <= cur < e)


async def _apx_names(cids: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not cids:
        return out
    async for c in db.contacts.find({"contact_id": {"$in": list(set(cids))}}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "email": 1, "contact_code": 1}):
        out[c["contact_id"]] = _omni_name(c)
    return out


# ============================================================================ pubblicazione (chat + push + log)
async def _apx_emit(user: dict, kind: str, typ: str, title: str, body: str, chat_text: str, dedupe_key: Optional[str],
                    actions: Optional[List[dict]] = None, source: str = "scheduler", extra: Optional[dict] = None, push: bool = True) -> Optional[dict]:
    """Un'unica uscita per ogni comunicazione proattiva: log → messaggio in chat → push (bridge). Idempotente su dedupe_key."""
    uid = user["user_id"]; tid = tenant_id(user); now = utcnow()
    if dedupe_key and await db.axon_proactive_log.find_one({"user_id": uid, "dedupe_key": dedupe_key}, {"_id": 1}):
        return None
    item = {"item_id": f"apx_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "user_id": uid, "kind": kind, "type": typ, "type_label": _APX_TYPE_LABELS.get(typ, typ),
            "title": title[:120], "body": body[:600], "chat_text": chat_text[:6000], "actions": (actions or [])[:4], "deeplink": None,
            "dedupe_key": dedupe_key, "source": source, "created_at": now, "read_at": None, "dismissed_at": None, "responded_at": None,
            "push_status": None, "notif_id": None, **(extra or {})}
    item["deeplink"] = f"/axon-proactive?item={item['item_id']}"
    await db.axon_proactive_log.insert_one(dict(item))
    # messaggio già in chat (ultima sessione, o nuova)
    try:
        latest = await db.assistant_messages.find_one({"user_id": uid}, {"session_id": 1}, sort=[("created_at", -1)])
        sid = (latest or {}).get("session_id") or f"asst_{uid}_{uuid.uuid4().hex[:10]}"
        await db.assistant_messages.insert_one({"message_id": uuid.uuid4().hex[:16], "user_id": uid, "session_id": sid, "role": "assistant",
                                                "content": chat_text[:6000], "created_at": now, "kind": "proactive", "proactive_id": item["item_id"]})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[apx] chat insert failed: %s", exc)
    if push:
        try:
            n = await axon_notify(uid, tid, f"proactive_{kind}", title, body, item["deeplink"], dedupe_key=f"apx:{item['item_id']}",
                                  extra={"proactive_id": item["item_id"], "tag": "axn_proactive"}, team_copy=False)
            if n:
                await db.axon_proactive_log.update_one({"item_id": item["item_id"]}, {"$set": {"notif_id": n["notif_id"], "push_status": "sent" if n.get("push_sent") else "blocked_by_prefs"}})
        except Exception as exc:  # noqa: BLE001
            logger.warning("[apx] notify failed: %s", exc)
    logger.info("[apx] %s/%s → %s: %s", kind, typ, uid, title)
    return item


# ============================================================================ raccolta dati (stesso perimetro di Axon)
async def _apx_collect(user: dict, cfg: dict) -> dict:
    """Dati di oggi/domani/settimana per briefing e detector. Tutte le query sono già filtrate per visibilità."""
    now_it = _apx_now_it(); today0 = now_it.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow0 = today0 + timedelta(days=1); after0 = today0 + timedelta(days=2)
    week0 = today0 - timedelta(days=today0.weekday())
    u = lambda d: d.astimezone(timezone.utc)  # noqa: E731
    d: Dict[str, Any] = {"now_it": now_it, "today0": today0, "week0": week0}
    cq = await _omni_contact_query(user)

    # appuntamenti oggi / domani
    appts = [a async for a in db.appointments.find(_omni_own(user, {"start_at": {"$gte": u(today0), "$lt": u(after0)}}),
                                                    {"_id": 0, "appointment_id": 1, "title": 1, "start_at": 1, "contact_id": 1, "done": 1, "location": 1, "is_phone": 1}).sort("start_at", 1).limit(60)]
    names = await _apx_names([a.get("contact_id") for a in appts if a.get("contact_id")])
    for a in appts:
        a["_who"] = names.get(a.get("contact_id") or "", "")
        a["_start"] = _axn_aware(a.get("start_at"))
    d["appts_today"] = [a for a in appts if a["_start"] and a["_start"] < u(tomorrow0)]
    d["appts_tomorrow"] = [a for a in appts if a["_start"] and a["_start"] >= u(tomorrow0)]

    # richiamate aperte (scadute o entro 24h)
    cb_q = {"$and": [{"$or": [{"user_id": tenant_id(user)}, {"tenant_id": tenant_id(user)}]}, {"$or": [{"done": False}, {"done": {"$exists": False}}]},
                     {"status": {"$nin": ["done", "fatta", "cancelled", "completed"]}}]}
    if not is_owner(user):
        cb_q["$and"].append({"$or": [{"created_by": user["user_id"]}, {"user_id": user["user_id"]}, {"assignee_user_id": user["user_id"]}]})
    cbs = []
    async for cb in db.callbacks.find(cb_q, {"_id": 0}).limit(300):
        due = _axn_aware(cb.get("next_at") or cb.get("scheduled_at"))
        if isinstance(due, datetime) and due <= utcnow() + timedelta(hours=24):
            cb["_due"] = due; cbs.append(cb)
    cnames = await _apx_names([c.get("contact_id") for c in cbs if c.get("contact_id")])
    for cb in cbs:
        cb["_who"] = cnames.get(cb.get("contact_id") or "", "")
    cbs.sort(key=lambda c: c["_due"])
    d["callbacks_due"] = cbs

    # contratti in scadenza entro contract_days (expiry_date "YYYY-MM-DD")
    lim = (today0 + timedelta(days=int(cfg.get("contract_days") or 15))).strftime("%Y-%m-%d")
    ctr = [c async for c in db.contracts.find(_omni_own(user, {"status": {"$in": ["active", "attivo", None]}, "expiry_date": {"$gte": today0.strftime("%Y-%m-%d"), "$lte": lim}}),
                                               {"_id": 0, "contract_id": 1, "contact_id": 1, "supplier": 1, "contract_type": 1, "expiry_date": 1, "contract_number": 1}).sort("expiry_date", 1).limit(30)]
    knames = await _apx_names([c.get("contact_id") for c in ctr if c.get("contact_id")])
    for c in ctr:
        c["_who"] = knames.get(c.get("contact_id") or "", "") or c.get("supplier") or c.get("contract_number") or "contratto"
    d["contracts_expiring"] = ctr

    # clienti inattivi: ultima interazione = max(chiamate, appuntamenti passati, created_at)
    days = int(cfg.get("inactive_days") or 30); cutoff = u(today0 - timedelta(days=days))
    last: Dict[str, datetime] = {}
    async for row in db.call_logs.aggregate([{"$match": _omni_own(user, {"contact_id": {"$ne": None}})}, {"$group": {"_id": "$contact_id", "l": {"$max": "$created_at"}}}]):
        if row["_id"]: last[row["_id"]] = _axn_aware(row["l"])
    async for row in db.appointments.aggregate([{"$match": _omni_own(user, {"contact_id": {"$ne": None}, "start_at": {"$lte": utcnow()}})}, {"$group": {"_id": "$contact_id", "l": {"$max": "$start_at"}}}]):
        if row["_id"]:
            l2 = _axn_aware(row["l"]); last[row["_id"]] = max(last.get(row["_id"], l2), l2)
    inactive = []
    async for c in db.contacts.find({"$and": [cq, {"$or": [{"status": "client"}, {"is_active_client": True}]}]},
                                    {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "created_at": 1, "updated_at": 1}).limit(1500):
        li = last.get(c["contact_id"]) or _axn_aware(c.get("created_at"))
        if isinstance(li, datetime) and li < cutoff:
            inactive.append({"contact_id": c["contact_id"], "name": _omni_name(c), "days": (utcnow() - li).days})
    inactive.sort(key=lambda x: -x["days"])
    d["inactive"] = inactive

    # obiettivi settimanali: progresso da lunedì
    d["week_progress"] = await _apx_week_progress(user, u(week0), utcnow(), cq)
    return d


async def _apx_week_progress(user: dict, start: datetime, end: datetime, cq: Optional[dict] = None) -> Dict[str, int]:
    cq = cq or await _omni_contact_query(user)
    return {
        "calls": await db.call_logs.count_documents(_omni_own(user, {"created_at": {"$gte": start, "$lt": end}})),
        "appointments": await db.appointments.count_documents(_omni_own(user, {"start_at": {"$gte": start, "$lt": end}, "$or": [{"done": True}, {"start_at": {"$lte": utcnow()}}]})),
        "contracts": await db.contracts.count_documents(_omni_own(user, {"created_at": {"$gte": start, "$lt": end}})),
        "new_contacts": await db.contacts.count_documents({"$and": [cq, {"created_at": {"$gte": start, "$lt": end}}]}),
    }


def _apx_goal_pct(progress: Dict[str, int], targets: Dict[str, int]) -> int:
    tot = 0; n = 0
    for k, t in (targets or {}).items():
        if t and int(t) > 0:
            tot += min(100, int(progress.get(k, 0)) * 100 // int(t)); n += 1
    return tot // n if n else 0


# ============================================================================ a) BRIEFING
async def _apx_build_briefing(user: dict, cfg: dict) -> Tuple[str, str, str, List[dict]]:
    d = await _apx_collect(user, cfg); now_it = d["now_it"]
    name = (user.get("name") or "").split(" ")[0]
    lines = [f"☀️ **Briefing di {_APX_GIORNI[now_it.weekday()]} {now_it.day} {_APX_MESI[now_it.month - 1]}**" + (f" — buongiorno {name}!" if name else "")]
    actions: List[dict] = []
    at = d["appts_today"]
    if at:
        lines.append(f"\n📅 **Appuntamenti oggi ({len(at)})**")
        for a in at[:6]:
            lines.append(f"• {a['_start'].astimezone(_APX_TZ).strftime('%H:%M')} — {a.get('title') or 'Appuntamento'}" + (f" con {a['_who']}" if a["_who"] else "") + (" 📞" if a.get("is_phone") else ""))
        if at[0]["_who"]:
            actions.append({"label": f"Briefing su {at[0]['_who']}", "prompt": f"Preparami il briefing completo su {at[0]['_who']} per l'appuntamento di oggi"})
    else:
        lines.append("\n📅 Nessun appuntamento oggi.")
    cbs = d["callbacks_due"]
    if cbs:
        late = [c for c in cbs if c["_due"] < utcnow()]
        lines.append(f"\n📞 **Richiamate in scadenza ({len(cbs)})**" + (f" — {len(late)} già scadute" if late else ""))
        for c in cbs[:5]:
            lines.append(f"• {_apx_dt_it(c['_due'], with_day=False)} — {c.get('title') or 'Richiamata'}" + (f" · {c['_who']}" if c["_who"] else "") + (" ⚠️" if c["_due"] < utcnow() else ""))
        actions.append({"label": "Organizza le richiamate", "prompt": "Aiutami a organizzare le richiamate di oggi in ordine di priorità"})
    ina = d["inactive"]
    if ina:
        top = ", ".join(f"{x['name']} ({x['days']} gg)" for x in ina[:3])
        lines.append(f"\n😴 **Clienti non contattati da oltre {cfg.get('inactive_days')} giorni: {len(ina)}** — {top}" + (" …" if len(ina) > 3 else ""))
        actions.append({"label": f"Follow-up per {ina[0]['name']}", "prompt": f"Prepara un messaggio di follow-up per {ina[0]['name']}, che non contatto da {ina[0]['days']} giorni"})
    ctr = d["contracts_expiring"]
    if ctr:
        lines.append(f"\n📄 **Contratti in scadenza entro {cfg.get('contract_days')} giorni ({len(ctr)})**")
        for c in ctr[:4]:
            lines.append(f"• {c['_who']} — scade il {_apx_date_it(c.get('expiry_date'))}" + (f" ({c.get('supplier')})" if c.get("supplier") and c["_who"] != c.get("supplier") else ""))
    wp = d["week_progress"]; tg = cfg.get("weekly_targets") or {}
    pct = _apx_goal_pct(wp, tg)
    lines.append(f"\n🎯 **Obiettivi settimanali: {pct}%** — telefonate {wp['calls']}/{tg.get('calls', 0)} · appuntamenti {wp['appointments']}/{tg.get('appointments', 0)} · contratti {wp['contracts']}/{tg.get('contracts', 0)} · nuovi contatti {wp['new_contacts']}/{tg.get('new_contacts', 0)}")
    if d["appts_tomorrow"]:
        lines.append(f"\n🔭 Domani: {len(d['appts_tomorrow'])} appuntament{'o' if len(d['appts_tomorrow']) == 1 else 'i'}.")
    if not actions:
        actions.append({"label": "Cosa mi consigli oggi?", "prompt": "In base al briefing di oggi, quali sono le 3 azioni più utili che posso fare?"})
    chat_text = "\n".join(lines)
    title = f"☀️ Briefing di oggi · {len(at)} app. · {len(cbs)} richiamate" + (f" · {len(ina)} inattivi" if ina else "")
    body = (f"{len(at)} appuntament{'o' if len(at) == 1 else 'i'}, {len(cbs)} richiamate in scadenza" + (f", {len(ina)} clienti da ricontattare" if ina else "")
            + (f", {len(ctr)} contratti in scadenza" if ctr else "") + f". Obiettivi settimana al {pct}%.")
    return title, body, chat_text, actions


async def _apx_send_briefing(user: dict, cfg: dict, source: str = "scheduler", force: bool = False) -> Optional[dict]:
    now_it = _apx_now_it()
    title, body, chat_text, actions = await _apx_build_briefing(user, cfg)
    key = None if force else f"briefing:{now_it.strftime('%Y-%m-%d')}"
    return await _apx_emit(user, "briefing", "briefing", title, body, chat_text, key, actions, source)


# ============================================================================ d) REPORT SETTIMANALE
async def _apx_build_weekly(user: dict, cfg: dict) -> Tuple[str, str, str, List[dict]]:
    now_it = _apx_now_it(); today0 = now_it.replace(hour=0, minute=0, second=0, microsecond=0)
    this_mon = today0 - timedelta(days=today0.weekday()); prev_mon = this_mon - timedelta(days=7)
    start, end = prev_mon.astimezone(timezone.utc), this_mon.astimezone(timezone.utc)
    p = await _apx_week_progress(user, start, end)
    prev = await _apx_week_progress(user, start - timedelta(days=7), start)
    tg = cfg.get("weekly_targets") or {}
    pct = _apx_goal_pct(p, tg)

    def row(label, k):
        t = int(tg.get(k) or 0); v = p.get(k, 0); dv = v - prev.get(k, 0)
        trend = "▲" if dv > 0 else "▼" if dv < 0 else "＝"
        ok = "✅" if t and v >= t else ("⚠️" if t else "")
        return f"• {label}: **{v}**" + (f"/{t}" if t else "") + f" {ok} ({trend}{abs(dv)} vs sett. prima)"

    lines = [f"📊 **Report settimana {prev_mon.day} {_APX_MESI[prev_mon.month - 1]} – {(this_mon - timedelta(days=1)).day} {_APX_MESI[(this_mon - timedelta(days=1)).month - 1]}**",
             row("Telefonate", "calls"), row("Appuntamenti completati", "appointments"), row("Contratti chiusi", "contracts"), row("Clienti aggiunti", "new_contacts"),
             f"\n🎯 Obiettivi raggiunti: **{pct}%** del target settimanale."]
    if pct >= 100:
        lines.append("Settimana piena: target centrato. 💪")
    elif pct >= 60:
        lines.append("Buon ritmo: manca poco al target.")
    else:
        lines.append("Settimana sotto target: vuoi che pianifichiamo insieme quella nuova?")
    actions = [{"label": "Pianifica la settimana", "prompt": "In base al report della settimana scorsa, aiutami a pianificare questa settimana per raggiungere gli obiettivi"}]
    title = f"📊 Report settimana · {p['calls']} tel. · {p['appointments']} app. · {p['contracts']} contratti"
    body = f"Telefonate {p['calls']}, appuntamenti {p['appointments']}, contratti {p['contracts']}, nuovi clienti {p['new_contacts']}. Obiettivi al {pct}%."
    return title, body, "\n".join(lines), actions


async def _apx_send_weekly(user: dict, cfg: dict, source: str = "scheduler", force: bool = False) -> Optional[dict]:
    title, body, chat_text, actions = await _apx_build_weekly(user, cfg)
    key = None if force else f"weekly:{_apx_now_it().strftime('%G-W%V')}"
    return await _apx_emit(user, "weekly", "weekly", title, body, chat_text, key, actions, source)


# ============================================================================ b)+c) SCAN eventi → suggerimenti e alert
async def _apx_detect(user: dict, cfg: dict) -> List[dict]:
    """Ritorna candidati {kind: suggestion|alert, type, title, body, chat_text, key, actions, priority}."""
    d = await _apx_collect(user, cfg); now_it = d["now_it"]; al = cfg["alerts"]; out: List[dict] = []
    ym = now_it.strftime("%Y-%m")

    if al.get("inactive") and d["inactive"]:
        x = d["inactive"][0]
        out.append({"kind": "suggestion", "type": "inactive", "priority": 3, "key": f"inactive:{x['contact_id']}:{ym}",
                    "title": f"😴 {x['name']}: {x['days']} giorni senza contatti", "body": f"Sono passati {x['days']} giorni da {x['name']}. Vuoi che prepari un messaggio di follow-up?",
                    "chat_text": f"😴 Sono passati **{x['days']} giorni** dall'ultimo contatto con **{x['name']}**. Vuoi che prepari un messaggio di follow-up?",
                    "actions": [{"label": "Sì, prepara il follow-up", "prompt": f"Prepara un messaggio di follow-up per {x['name']} (ultimo contatto {x['days']} giorni fa)"},
                                {"label": "Cosa sai di lui/lei?", "prompt": f"Dammi un riepilogo di {x['name']}: storico, note e ultime interazioni"}]})

    if al.get("appointment_tomorrow") and d["appts_tomorrow"] and now_it.hour >= 16:
        a = d["appts_tomorrow"][0]; who = a["_who"] or a.get("title") or "un cliente"; hh = a["_start"].astimezone(_APX_TZ).strftime("%H:%M")
        out.append({"kind": "suggestion", "type": "appointment_tomorrow", "priority": 2, "key": f"appt:{a.get('appointment_id')}",
                    "title": f"📅 Domani alle {hh}: {who}", "body": f"Domani alle {hh} hai un appuntamento con {who}. Vuoi il briefing completo?",
                    "chat_text": f"📅 Domani alle **{hh}** hai un appuntamento con **{who}**" + (f" ({a.get('title')})" if a["_who"] and a.get("title") else "") + ". Vuoi il briefing completo su di lui/lei?",
                    "actions": [{"label": "Sì, briefing completo", "prompt": f"Preparami il briefing completo su {who} per l'appuntamento di domani alle {hh}"}]})

    if al.get("contract_expiry") and d["contracts_expiring"]:
        c = d["contracts_expiring"][0]
        out.append({"kind": "suggestion", "type": "contract_expiry", "priority": 2, "key": f"contract:{c.get('contract_id')}:{c.get('expiry_date')}",
                    "title": f"📄 Contratto {c['_who']} in scadenza", "body": f"Il contratto con {c['_who']} scade il {_apx_date_it(c.get('expiry_date'))}. Vuoi gestirlo ora?",
                    "chat_text": f"📄 Il contratto con **{c['_who']}** scade il **{_apx_date_it(c.get('expiry_date'))}**" + (f" ({c.get('supplier')})" if c.get("supplier") else "") + ". Vuoi gestirlo ora?",
                    "actions": [{"label": "Sì, gestiamolo", "prompt": f"Il contratto con {c['_who']} scade il {_apx_date_it(c.get('expiry_date'))}: proponimi come gestire il rinnovo o la nuova offerta"}]})

    if al.get("goal_progress") and now_it.weekday() >= 2 and now_it.hour >= 12:
        pct = _apx_goal_pct(d["week_progress"], cfg.get("weekly_targets") or {})
        if pct <= int(cfg.get("goal_alert_pct") or 20):
            out.append({"kind": "suggestion", "type": "goal_progress", "priority": 1, "key": f"goal:{now_it.strftime('%G-W%V')}",
                        "title": f"🎯 Sei al {pct}% dell'obiettivo settimanale", "body": f"Sei al {pct}% dell'obiettivo settimanale. Vuoi che analizziamo insieme i prossimi passi?",
                        "chat_text": f"🎯 Siamo a metà settimana e sei al **{pct}%** dell'obiettivo settimanale. Vuoi che analizziamo insieme i prossimi passi?",
                        "actions": [{"label": "Sì, analizziamo", "prompt": "Analizza i miei obiettivi settimanali e proponimi un piano concreto per i prossimi giorni"}]})

    # --- alert critici ---
    dl_h = int(cfg.get("deadline_hours") or 48)
    if al.get("deadline"):
        lim = (now_it + timedelta(hours=dl_h)).strftime("%Y-%m-%d")
        for c in d["contracts_expiring"]:
            if (c.get("expiry_date") or "") <= lim:
                out.append({"kind": "alert", "type": "deadline", "priority": 5, "key": f"deadline:contract:{c.get('contract_id')}",
                            "title": f"⏰ Scadenza critica: {c['_who']}", "body": f"Il contratto con {c['_who']} scade entro {dl_h} ore ({_apx_date_it(c.get('expiry_date'))}).",
                            "chat_text": f"⏰ **Scadenza critica**: il contratto con **{c['_who']}** scade entro {dl_h} ore ({_apx_date_it(c.get('expiry_date'))}). Vuoi che ti prepari il piano d'azione?",
                            "actions": [{"label": "Piano d'azione", "prompt": f"Il contratto con {c['_who']} scade entro {dl_h} ore: cosa devo fare subito?"}]})
        for cb in d["callbacks_due"]:
            if utcnow() <= cb["_due"] <= utcnow() + timedelta(hours=min(dl_h, 24)) and not (cb.get("urgent") or str(cb.get("priority") or "").lower() in ("alta", "urgente", "high", "urgent", "massima")):
                out.append({"kind": "alert", "type": "deadline", "priority": 4, "key": f"deadline:cb:{cb.get('callback_id') or cb.get('id')}",
                            "title": f"⏰ Richiamata entro 24 h: {cb['_who'] or cb.get('title')}", "body": f"{cb.get('title') or 'Richiamata'} — {_apx_dt_it(cb['_due'])}",
                            "chat_text": f"⏰ Richiamata in scadenza **{_apx_dt_it(cb['_due'])}**: {cb.get('title') or 'Richiamata'}" + (f" · {cb['_who']}" if cb["_who"] else "") + ". Vuoi che ti prepari la scaletta della chiamata?",
                            "actions": [{"label": "Scaletta chiamata", "prompt": f"Preparami la scaletta per la richiamata a {cb['_who'] or cb.get('title')}"}]})
                break

    if al.get("callback_overdue"):
        oh = int(cfg.get("callback_overdue_hours") or 2)
        for cb in d["callbacks_due"]:
            urgent = cb.get("urgent") or str(cb.get("priority") or "").lower() in ("alta", "urgente", "high", "urgent", "massima")
            if urgent and cb["_due"] <= utcnow() - timedelta(hours=oh):
                out.append({"kind": "alert", "type": "callback_overdue", "priority": 6, "key": f"cbover:{cb.get('callback_id') or cb.get('id')}:{now_it.strftime('%Y-%m-%d')}",
                            "title": f"🚨 Richiamata urgente non evasa: {cb['_who'] or cb.get('title')}", "body": f"Era prevista {_apx_dt_it(cb['_due'])} ed è passata da oltre {oh} ore.",
                            "chat_text": f"🚨 La richiamata urgente **{cb.get('title') or ''}**" + (f" a **{cb['_who']}**" if cb["_who"] else "") + f" era prevista {_apx_dt_it(cb['_due'])} e non risulta evasa da oltre {oh} ore. Vuoi chiamare ora o riprogrammare?",
                            "actions": [{"label": "Riprogramma", "prompt": f"Riprogramma la richiamata urgente a {cb['_who'] or cb.get('title')} per il prossimo slot utile"}]})
                break

    if al.get("imported_anomaly"):
        out.extend(await _apx_detect_anomalies(user, cfg))
    return out


async def _apx_detect_anomalies(user: dict, cfg: dict) -> List[dict]:
    """Serie in axon_imported_data (per categoria+etichetta con date): ultimo valore vs media dei precedenti > anomaly_pct %."""
    pct_lim = float(cfg.get("anomaly_pct") or 15); out = []
    series: Dict[Tuple[str, str], List[dict]] = {}
    async for it in db.axon_imported_data.find({"tenant_id": tenant_id(user), "data": {"$nin": [None, ""]}}, {"_id": 0, "categoria": 1, "etichetta": 1, "valore": 1, "unita": 1, "data": 1, "fonte": 1}).limit(3000):
        series.setdefault((it.get("categoria") or "Altro", it.get("etichetta") or ""), []).append(it)
    for (cat, et), rows in series.items():
        rows = sorted(rows, key=lambda r: str(r.get("data")))
        if len(rows) < 4:
            continue
        prev = [float(r["valore"]) for r in rows[:-1] if isinstance(r.get("valore"), (int, float))]
        last = rows[-1]
        if not prev or not isinstance(last.get("valore"), (int, float)):
            continue
        avg = sum(prev) / len(prev)
        if avg == 0:
            continue
        dev = (float(last["valore"]) - avg) / abs(avg) * 100
        if abs(dev) >= pct_lim:
            arrow = "▲" if dev > 0 else "▼"
            out.append({"kind": "alert", "type": "imported_anomaly", "priority": 4, "key": f"anomaly:{cat}:{et}:{last.get('data')}",
                        "title": f"📈 {cat} fuori soglia: {et} {arrow}{abs(dev):.0f}%",
                        "body": f"{et} ({last.get('data')}) = {_aid_fmt_val(last['valore'])} {last.get('unita') or ''}: {arrow}{abs(dev):.0f}% rispetto alla media della serie.",
                        "chat_text": f"📈 **Anomalia sui dati importati** — {cat}: **{et}** al {last.get('data')} vale **{_aid_fmt_val(last['valore'])} {last.get('unita') or ''}**, "
                                     f"{arrow}{abs(dev):.0f}% rispetto alla media dei valori precedenti ({_aid_fmt_val(avg)}). Fonte: {last.get('fonte') or 'n/d'}. Vuoi che valuti l'impatto sui tuoi clienti?",
                        "actions": [{"label": "Valuta l'impatto", "prompt": f"Il valore {et} ({cat}) al {last.get('data')} è {arrow}{abs(dev):.0f}% rispetto alla media: che impatto ha sui miei clienti e cosa consigli?"}]})
    return out[:2]


async def _apx_scan_user(user: dict, cfg: dict, source: str = "scheduler") -> int:
    now_it = _apx_now_it(); sent = 0
    if _apx_in_quiet(cfg, now_it) and source == "scheduler":
        return 0
    cands = await _apx_detect(user, cfg)
    if not cands:
        return 0
    cands.sort(key=lambda c: -c["priority"])
    max_sugg = await _apx_effective_max_suggestions(user, cfg)
    n_sugg = await _apx_count_today(user["user_id"], "suggestion"); n_alert = await _apx_count_today(user["user_id"], "alert")
    for c in cands:
        if c["kind"] == "suggestion" and n_sugg >= max_sugg:
            continue
        if c["kind"] == "alert" and n_alert >= _APX_MAX_ALERTS_DAY:
            continue
        r = await _apx_emit(user, c["kind"], c["type"], c["title"], c["body"], c["chat_text"], c["key"], c.get("actions"), source)
        if r:
            sent += 1
            if c["kind"] == "suggestion": n_sugg += 1
            else: n_alert += 1
    return sent


# ============================================================================ c) PROMEMORIA impostati da AxonOS in chat
_apx_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _apx_prev_prepare_prompt(user, body)
    try:
        if prep.get("system_message"):
            prep["system_message"] += ("\n\n📌 PROMEMORIA PROATTIVI (AxonOS): se dalla conversazione emerge qualcosa da ricordare all'utente in futuro (follow-up, scadenza, "
                                       "richiamata, controllo) oppure l'utente ti chiede di ricordartene, chiudi la risposta con UNA riga nel formato esatto "
                                       "`📌 Promemoria proattivo: GG/MM/AAAA HH:MM — testo breve` (ora di default 09:00). AxonOS invierà una notifica a quell'ora, "
                                       "anche ad app chiusa. Non inventare promemoria se non servono.")
    except Exception:  # noqa: BLE001
        pass
    return prep


async def _apx_harvest_reminders() -> int:
    """Legge le risposte recenti di Axon con «📌 Promemoria proattivo: …» e crea i promemoria (idempotente per message_id)."""
    n = 0
    since = utcnow() - timedelta(minutes=30)
    async for m in db.assistant_messages.find({"role": "assistant", "created_at": {"$gte": since}, "content": {"$regex": "Promemoria proattivo"}, "apx_harvested": {"$ne": True}},
                                              {"_id": 0, "message_id": 1, "user_id": 1, "content": 1}).limit(200):
        await db.assistant_messages.update_one({"message_id": m["message_id"]}, {"$set": {"apx_harvested": True}})
        for mt in _APX_REMINDER_RE.finditer(m.get("content") or ""):
            try:
                dd, mm, yy, hh, mi, text = mt.groups()
                due = datetime(int(yy), int(mm), int(dd), int(hh or 9), int(mi or 0), tzinfo=_APX_TZ).astimezone(timezone.utc)
            except Exception:
                continue
            if due < utcnow() - timedelta(days=1):
                continue
            u = await db.users.find_one({"user_id": m["user_id"]}, {"_id": 0, "user_id": 1, "parent_user_id": 1})
            await db.axon_proactive_reminders.insert_one({"reminder_id": f"apr_{uuid.uuid4().hex[:10]}", "user_id": m["user_id"], "tenant_id": (u or {}).get("parent_user_id") or m["user_id"],
                                                          "text": text.strip().rstrip("*").strip()[:300], "due_at": due, "status": "scheduled", "origin": m["message_id"], "created_at": utcnow()})
            n += 1
    return n


async def _apx_fire_reminders() -> int:
    n = 0
    async for r in db.axon_proactive_reminders.find({"status": "scheduled", "due_at": {"$lte": utcnow()}}, {"_id": 0}).limit(100):
        claimed = await db.axon_proactive_reminders.find_one_and_update({"reminder_id": r["reminder_id"], "status": "scheduled"}, {"$set": {"status": "firing"}})
        if not claimed:
            continue
        user = await db.users.find_one({"user_id": r["user_id"]}, {"_id": 0}) or {"user_id": r["user_id"], "role": "owner"}
        cfg = await _apx_config(r["user_id"])
        item = None
        if cfg["alerts"].get("custom_reminder", True):
            item = await _apx_emit(user, "alert", "custom_reminder", f"📌 Promemoria: {r['text'][:80]}", r["text"][:300],
                                   f"📌 **Promemoria che ti avevo promesso**: {r['text']}\n\nVuoi che ti aiuti a procedere?", f"reminder:{r['reminder_id']}",
                                   [{"label": "Sì, procediamo", "prompt": f"Riguardo al promemoria «{r['text'][:120]}»: aiutami a procedere"}], "scheduler")
        await db.axon_proactive_reminders.update_one({"reminder_id": r["reminder_id"]}, {"$set": {"status": "sent" if item else "skipped", "fired_at": utcnow(), "item_id": (item or {}).get("item_id")}})
        n += 1 if item else 0
    return n


# ============================================================================ TICK (60 s) — event listener interno
async def _apx_tick():
    try:
        now_it = _apx_now_it(); now = utcnow()
        await _apx_harvest_reminders()
        await _apx_fire_reminders()
        for u in await _apx_users():
            uid = u["user_id"]
            try:
                cfg = await _apx_config(uid)
                # a) briefing: da briefing_time fino a +4h (recupero dopo riavvio), una volta al giorno
                if cfg.get("briefing_enabled") and now_it.weekday() in (cfg.get("briefing_days") or []):
                    bh, bm = _apx_hm(cfg.get("briefing_time"), "07:30"); bt = now_it.replace(hour=bh, minute=bm, second=0, microsecond=0)
                    if bt <= now_it <= bt + timedelta(hours=4) and not await db.axon_proactive_log.find_one({"user_id": uid, "dedupe_key": f"briefing:{now_it.strftime('%Y-%m-%d')}"}, {"_id": 1}):
                        await _apx_send_briefing(u, cfg)
                # d) report settimanale: lunedì da weekly_report_time fino a +6h
                if cfg.get("weekly_report_enabled") and now_it.weekday() == 0:
                    wh, wm = _apx_hm(cfg.get("weekly_report_time"), "08:00"); wt = now_it.replace(hour=wh, minute=wm, second=0, microsecond=0)
                    if wt <= now_it <= wt + timedelta(hours=6) and not await db.axon_proactive_log.find_one({"user_id": uid, "dedupe_key": f"weekly:{now_it.strftime('%G-W%V')}"}, {"_id": 1}):
                        await _apx_send_weekly(u, cfg)
                # b)+c) scan ogni 10 minuti per utente
                last = _APX_LAST_SCAN.get(uid)
                if not last or now - last >= _APX_SCAN_EVERY:
                    _APX_LAST_SCAN[uid] = now
                    await _apx_scan_user(u, cfg)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[apx] tick user %s failed: %s", uid, exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[apx] tick failed: %s", exc)


# ============================================================================ API
@api_router.get("/axon/proactive/config")
async def apx_get_config(user=Depends(get_current_user)):
    cfg = await _apx_config(user["user_id"])
    cfg["is_master"] = tenant_id(user) == user["user_id"]
    cfg["effective_max_suggestions_per_day"] = await _apx_effective_max_suggestions(user, cfg)
    cfg["type_labels"] = _APX_TYPE_LABELS
    return cfg


@api_router.put("/axon/proactive/config")
async def apx_put_config(body: ApxConfigIn, user=Depends(get_current_user)):
    upd: Dict[str, Any] = {}
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "team_max_suggestions_per_day" and tenant_id(user) != user["user_id"]:
            continue
        if k in ("briefing_time", "weekly_report_time", "quiet_start", "quiet_end"):
            h, m = _apx_hm(v, _APX_DEFAULT_CONFIG[k]); v = f"{h:02d}:{m:02d}"
        if k == "briefing_days":
            v = sorted({int(x) for x in v if 0 <= int(x) <= 6})
        if k in ("max_suggestions_per_day", "team_max_suggestions_per_day"):
            v = max(0, min(10, int(v)))
        if k in ("inactive_days", "deadline_hours", "callback_overdue_hours", "contract_days", "anomaly_pct", "goal_alert_pct"):
            v = max(1, min(365, int(v)))
        if k == "weekly_targets":
            v = {kk: max(0, int(vv)) for kk, vv in v.items() if kk in _APX_DEFAULT_CONFIG["weekly_targets"]}
            cur = (await db.axon_proactive_config.find_one({"user_id": user["user_id"]}, {"_id": 0, "weekly_targets": 1}) or {}).get("weekly_targets") or {}
            v = {**cur, **v}
        if k == "alerts":
            v = {kk: bool(vv) for kk, vv in v.items() if kk in _APX_DEFAULT_CONFIG["alerts"]}
            cur = (await db.axon_proactive_config.find_one({"user_id": user["user_id"]}, {"_id": 0, "alerts": 1}) or {}).get("alerts") or {}
            v = {**cur, **v}
        upd[k] = v
    if upd:
        upd["updated_at"] = utcnow()
        await db.axon_proactive_config.update_one({"user_id": user["user_id"]}, {"$set": upd, "$setOnInsert": {"user_id": user["user_id"], "tenant_id": tenant_id(user), "created_at": utcnow()}}, upsert=True)
    return await apx_get_config(user)


@api_router.post("/axon/proactive/trigger")
async def apx_trigger(body: ApxTriggerIn, user=Depends(get_current_user)):
    """TRIGGER UNICO (tap notifica, voce/ViolaWake, manuale): genera ora e risponde con testo + deeplink."""
    cfg = await _apx_config(user["user_id"]); src = (body.source or "manual")[:20]
    if body.action == "briefing":
        item = await _apx_send_briefing(user, cfg, src, force=True)
    elif body.action == "weekly_report":
        item = await _apx_send_weekly(user, cfg, src, force=True)
    elif body.action == "scan":
        n = await _apx_scan_user(user, cfg, src)
        item = await db.axon_proactive_log.find_one({"user_id": user["user_id"]}, {"_id": 0}, sort=[("created_at", -1)]) if n else None
        if not n:
            return {"ok": True, "item": None, "reply": "✅ Ho controllato scadenze, clienti, richiamate e dati: al momento nessun evento richiede la tua attenzione.", "deeplink": "/axon-proactive"}
    elif body.action == "open" and body.item_id:
        item = await db.axon_proactive_log.find_one({"item_id": body.item_id, "user_id": user["user_id"]}, {"_id": 0})
        if item:
            await db.axon_proactive_log.update_one({"item_id": item["item_id"]}, {"$set": {"read_at": utcnow(), "opened_from": src}})
    else:
        raise HTTPException(status_code=400, detail="action non valida (briefing | weekly_report | scan | open)")
    return {"ok": True, "item": _apx_out(item), "reply": (item or {}).get("chat_text"), "deeplink": (item or {}).get("deeplink") or "/axon-proactive"}


@api_router.get("/axon/proactive/items")
async def apx_items(limit: int = 30, home: bool = False, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": user["user_id"]}
    if home:
        q.update({"dismissed_at": None, "responded_at": None, "created_at": {"$gte": utcnow() - timedelta(hours=36)}})
    items = [_apx_out(d) async for d in db.axon_proactive_log.find(q, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 200)))]
    return {"items": items}


@api_router.get("/axon/proactive/items/{item_id}")
async def apx_item(item_id: str, user=Depends(get_current_user)):
    it = await db.axon_proactive_log.find_one({"item_id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Comunicazione non trovata")
    if not it.get("read_at"):
        await db.axon_proactive_log.update_one({"item_id": item_id}, {"$set": {"read_at": utcnow()}})
    return _apx_out(it)


@api_router.post("/axon/proactive/items/dismiss-all")
async def apx_dismiss_all(user=Depends(get_current_user)):
    """V50.z233 — «Chiudi tutte»: chiude in un tap tutte le card aperte dell'utente (Home «AxonOS ti segnala»)."""
    r = await db.axon_proactive_log.update_many({"user_id": user["user_id"], "dismissed_at": None}, {"$set": {"dismissed_at": utcnow(), "dismiss_reason": "dismiss_all"}})
    return {"ok": True, "dismissed": r.modified_count}


@api_router.post("/axon/proactive/items/{item_id}/{action}")
async def apx_item_action(item_id: str, action: str, user=Depends(get_current_user)):
    """action ∈ dismiss | respond (tap/voce sul suggerimento) | read."""
    field = {"dismiss": "dismissed_at", "respond": "responded_at", "read": "read_at"}.get(action)
    if not field:
        raise HTTPException(status_code=400, detail="action non valida")
    r = await db.axon_proactive_log.update_one({"item_id": item_id, "user_id": user["user_id"]}, {"$set": {field: utcnow()}})
    return {"ok": True, "updated": r.modified_count}


@api_router.get("/axon/proactive/reminders")
async def apx_reminders(user=Depends(get_current_user)):
    items = [_apx_out(d) async for d in db.axon_proactive_reminders.find({"user_id": user["user_id"]}, {"_id": 0}).sort("due_at", -1).limit(100)]
    return {"items": items}


@api_router.post("/axon/proactive/reminders")
async def apx_add_reminder(body: ApxReminderIn, user=Depends(get_current_user)):
    due = _acp_parse_iso(body.due_at)
    if not due:
        raise HTTPException(status_code=400, detail="due_at non valida")
    doc = {"reminder_id": f"apr_{uuid.uuid4().hex[:10]}", "user_id": user["user_id"], "tenant_id": tenant_id(user), "text": body.text.strip()[:300],
           "due_at": due, "status": "scheduled", "origin": "api", "created_at": utcnow()}
    await db.axon_proactive_reminders.insert_one(dict(doc))
    return {"ok": True, "reminder": _apx_out(doc)}


@api_router.delete("/axon/proactive/reminders/{reminder_id}")
async def apx_del_reminder(reminder_id: str, user=Depends(get_current_user)):
    r = await db.axon_proactive_reminders.delete_one({"reminder_id": reminder_id, "user_id": user["user_id"]})
    return {"ok": True, "deleted": r.deleted_count}


# ============================================================================ comandi chat («briefing di oggi», «report della settimana»)
_APX_BRIEF_RE = re.compile(r"\b(briefing|riepilogo|programma)\b.{0,20}\b(di oggi|giornata|mattutino|del giorno|oggi)\b|\bcosa (ho|c'è) (oggi|in programma)\b|\bbriefing\b\s*$", re.IGNORECASE)
_APX_WEEK_RE = re.compile(r"\breport\b.{0,25}\b(settiman\w*)\b|\bcom'è andata la settimana\b|\bbilancio settimanale\b", re.IGNORECASE)
_apx_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").strip()
    try:
        if txt and len(txt) <= 120:
            if _APX_BRIEF_RE.search(txt) and not re.search(r"\bsu\b|\bdi\s+[A-Z]", txt):
                cfg = await _apx_config(user["user_id"])
                _t, _b, chat_text, _a = await _apx_build_briefing(user, cfg)
                return {"reply": chat_text, "cmd": "proactive_briefing"}
            if _APX_WEEK_RE.search(txt) and "corporate" not in txt.lower():
                cfg = await _apx_config(user["user_id"])
                _t, _b, chat_text, _a = await _apx_build_weekly(user, cfg)
                return {"reply": chat_text, "cmd": "proactive_weekly"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[apx] chat command failed: %s", exc)
    return await _apx_prev_maybe_push_command(msg, user)


@app.on_event("startup")
async def _apx_start():
    try:
        await db.axon_proactive_log.create_index([("user_id", 1), ("created_at", -1)])
        await db.axon_proactive_log.create_index([("user_id", 1), ("dedupe_key", 1)])
        await db.axon_proactive_config.create_index([("user_id", 1)], unique=True)
        await db.axon_proactive_reminders.create_index([("status", 1), ("due_at", 1)])
        _axn_scheduler.add_job(_apx_tick, "interval", seconds=60, id="apx-tick", replace_existing=True)
        logger.info("[apx] proactive engine armed (tick 60s, scan 10min, briefing/weekly per config)")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[apx] start failed: %s", exc)
