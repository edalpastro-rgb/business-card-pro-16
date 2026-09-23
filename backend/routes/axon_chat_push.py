# axon_chat_push.py — V50.z184 — AxonOS invia notifiche push IN AUTONOMIA dalla chat
#
# MODULO ISOLATO. Caricato nel namespace condiviso DOPO `axon_notifications.py`
# (usa `axon_notify`, `AXN_KINDS`, `_axn_prefs`, `_axn_check_*`, `_axn_scheduler`) e dopo
# `34_alarms_homeassistant.py` (avvolge `_create_axon_alarm_doc`).
#
# Cosa fa:
#   1) CONSEGNA SERVER-SIDE dei promemoria/timer creati in chat ("ricordami domani alle 10…")
#      o dalla pagina Timer & Sveglie: al `trigger_at` il server invia il push (kind `reminder`)
#      anche se l'app è chiusa / il telefono è stato cambiato. Precisione: arming esatto
#      in-process al momento della creazione (call_later) + tick di recupero ogni 60s.
#      Le SVEGLIE (kind alarm, HH:MM ricorrenti) restano notifiche locali (bypass DnD, suono).
#      Claim atomico su `push_sent_at` → mai doppio invio.
#   2) COMANDI CHAT senza LLM (`_maybe_push_command`), intercettati PRIMA del comando sveglie:
#      • "mandami una notifica di prova"                        → push di test
#      • "mandami una notifica: <testo>" / "invia push: <testo>" → push immediato a me
#      • Master: "manda una notifica a Mario: <testo>"           → push a un collaboratore
#      • "avvisami se/quando ho ritelefonate urgenti|scadenze|sessioni gym|crediti"
#            → riattiva la categoria nelle preferenze, esegue SUBITO il controllo e conferma
#      • "quali notifiche push (ho|sono) attive"                → stato preferenze
#
# Il client, se ha registrato il token push, NON schedula più la notifica locale per
# reminder/timer (evita il doppione): vedi frontend `src/alarmNotifs.ts`.

AXN_KINDS["reminder"] = "Promemoria e timer impostati in chat con Axon"
_OMNI_EXTRA_SECTIONS.append((
    "Notifiche push AxonOS", "/axon-notifications",
    "Axon invia push in autonomia (anche ad app chiusa): promemoria/timer da chat («ricordami domani alle 10 di chiamare Rossi», "
    "«timer 15 minuti»), avvisi automatici ogni 10 min su richiamate urgenti, scadenze contratto, sessioni Gym, crediti AI "
    "(«avvisami se ho ritelefonate urgenti»), notifiche immediate («mandami una notifica: testo»; Master: «manda una notifica a Mario: testo»)."
))

_ACP_EXACT_MAX_S = 12 * 3600      # arming in-process solo entro 12h (oltre ci pensa il tick)
_ACP_LATE_MAX = timedelta(hours=6)  # promemoria scaduti da più di 6h (server fermo) → non inviare
_ACP_ARMED: Dict[str, Any] = {}     # alarm_id → TimerHandle


def _acp_parse_iso(v) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


async def _acp_tenant_of(uid: str) -> str:
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "parent_user_id": 1})
    return (u or {}).get("parent_user_id") or uid


async def _acp_deliver(alarm: dict, reason: str = "tick") -> bool:
    """Invia il push per un promemoria/timer scaduto. Claim atomico su push_sent_at."""
    trig = _acp_parse_iso(alarm.get("trigger_at"))
    if not trig:
        return False
    claimed = await db.axon_alarms.find_one_and_update(
        {"id": alarm["id"], "enabled": True, "trigger_at": alarm.get("trigger_at"), "push_sent_at": {"$exists": False}},
        {"$set": {"push_sent_at": utcnow().isoformat(), "last_triggered_at": utcnow().isoformat()}},
    )
    if not claimed:
        return False
    kind = alarm.get("kind")
    label = (alarm.get("label") or "").strip()
    if kind == "timer":
        title = f"⏱️ Timer scaduto · {label}" if label and label.lower() != "timer" else "⏱️ Timer scaduto"
        body = alarm.get("note") or f"Sono passati {_fmt_duration_it(int(alarm.get('duration_seconds') or 0))}."
    else:
        title = f"🔔 Promemoria: {label or 'Promemoria'}"
        body = alarm.get("note") or f"AxonOS ti ricorda: {label or 'promemoria'}."
    tenant = await _acp_tenant_of(alarm["user_id"])
    ln = alarm.get("local_notif") or {}
    if ln.get("trigger_at") and ln.get("trigger_at") == alarm.get("trigger_at"):
        # V50.z333 — notifica locale già sul telefono (suono+vibrazione): solo voce in-app, niente push doppio/muto
        await db.axon_notifications.insert_one({
            "notif_id": f"axn_{uuid.uuid4().hex[:12]}", "user_id": alarm["user_id"], "tenant_id": tenant, "kind": "reminder", "title": title, "body": body,
            "data": {"deeplink": "/axon-alarms", "alarmId": alarm["id"], "alarm_kind": kind, "tag": f"alarm_{alarm['id']}"},
            "created_at": utcnow(), "read": False, "read_at": None, "push_sent": False, "dedupe_key": f"alarm:{alarm['id']}:{alarm.get('trigger_at')}", "team_copy_of": None,
        })
        logger.info("[axn-chat-push] %s %s: notifica locale sul device → push saltato", kind, alarm["id"])
        return True
    r = await axon_notify(alarm["user_id"], tenant, "reminder", title, body, "/axon-alarms",
                          dedupe_key=f"alarm:{alarm['id']}:{alarm.get('trigger_at')}",
                          extra={"alarmId": alarm["id"], "alarm_kind": kind, "tag": f"alarm_{alarm['id']}"}, team_copy=False)
    logger.info("[axn-chat-push] delivered %s %s (%s) push_sent=%s", kind, alarm["id"], reason, bool(r and r.get("push_sent")))
    return bool(r)


async def _acp_fire(alarm_id: str) -> None:
    _ACP_ARMED.pop(alarm_id, None)
    a = await db.axon_alarms.find_one({"id": alarm_id, "enabled": True, "push_sent_at": {"$exists": False}}, {"_id": 0})
    if not a:
        return
    trig = _acp_parse_iso(a.get("trigger_at"))
    if not trig:
        return
    if trig > utcnow() + timedelta(seconds=2):   # trigger spostato in avanti nel frattempo → ri-arma
        _acp_arm(a)
        return
    await _acp_deliver(a, "exact")


def _acp_arm(alarm: dict) -> None:
    """Programma l'invio esatto in-process (solo reminder/timer entro 12h)."""
    if alarm.get("kind") not in ("reminder", "timer") or not alarm.get("enabled", True):
        return
    trig = _acp_parse_iso(alarm.get("trigger_at"))
    if not trig:
        return
    delay = (trig - utcnow()).total_seconds()
    if delay > _ACP_EXACT_MAX_S:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    old = _ACP_ARMED.pop(alarm["id"], None)
    if old:
        try: old.cancel()
        except Exception: pass
    aid = alarm["id"]
    _ACP_ARMED[aid] = loop.call_later(max(0.0, delay), lambda: asyncio.ensure_future(_acp_fire(aid)))


async def _acp_deliver_due(limit: int = 2000) -> int:
    """Tick di recupero: promemoria/timer scaduti non ancora inviati (riavvii, modifiche, >12h)."""
    now = utcnow(); n = 0
    cur = db.axon_alarms.find({"enabled": True, "kind": {"$in": ["reminder", "timer"]}, "push_sent_at": {"$exists": False}},
                              {"_id": 0}).limit(limit)
    async for a in cur:
        trig = _acp_parse_iso(a.get("trigger_at"))
        if not trig:
            continue
        if trig > now:
            if a["id"] not in _ACP_ARMED:
                _acp_arm(a)
            continue
        if now - trig > _ACP_LATE_MAX:
            await db.axon_alarms.update_one({"id": a["id"], "push_sent_at": {"$exists": False}},
                                            {"$set": {"push_sent_at": None, "push_skipped": "too_late"}})
            continue
        n += 1 if await _acp_deliver(a, "tick") else 0
    return n


async def _acp_tick():
    try:
        n = await _acp_deliver_due()
        if n:
            logger.info("[axn-chat-push] tick delivered %d", n)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axn-chat-push] tick failed: %s", exc)


# --- wrap NON invasivo di `_create_axon_alarm_doc` (REST + comando chat) → arming esatto
_acp_orig_create_axon_alarm_doc = _create_axon_alarm_doc


async def _create_axon_alarm_doc(user: dict, payload: Dict[str, Any]) -> Dict[str, Any]:  # noqa: F811
    doc = await _acp_orig_create_axon_alarm_doc(user, payload)
    _acp_arm(doc)
    return doc


@app.on_event("startup")
async def _acp_start():
    try:
        await db.axon_alarms.create_index([("enabled", 1), ("kind", 1), ("push_sent_at", 1)])
        _axn_scheduler.add_job(_acp_tick, "interval", seconds=60, id="axn-chat-push-tick", replace_existing=True)
        asyncio.get_running_loop().call_later(3, lambda: asyncio.ensure_future(_acp_tick()))
        logger.info("[axn-chat-push] reminder delivery armed (tick 60s)")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axn-chat-push] start failed: %s", exc)


# ============================================================================ COMANDI CHAT
_ACP_TEST_RE = re.compile(r"\b(manda|invia|mandami|inviami|fammi|prova)\b.*\b(notific\w*|push)\b.*\b(prova|test)\b|\b(notific\w*|push)\s+di\s+(prova|test)\b", re.IGNORECASE)
_ACP_SEND_TO_RE = re.compile(
    r"^\s*(?:axon[,:\s]*|neo[,:\s]*)?(?:manda|invia)\s+(?:una\s+|un\s+)?(?:notifica|push|messaggio\s+push|notifica\s+push)"
    r"\s+a\s+([A-Za-zÀ-ÿ'’ .-]{2,40}?)\s*[:\-–—]\s*(.+)$", re.IGNORECASE | re.DOTALL)
_ACP_SEND_ME_RE = re.compile(
    r"^\s*(?:axon[,:\s]*|neo[,:\s]*)?(?:manda(?:mi)?|invia(?:mi)?)\s+(?:una\s+|un\s+)?(?:notifica|push|messaggio\s+push|notifica\s+push)"
    r"(?:\s+(?:con|che\s+dice|con\s+scritto))?\s*[:\-–—]\s*(.+)$", re.IGNORECASE | re.DOTALL)
_ACP_WATCH_RE = re.compile(r"\b(avvisami|avvertimi|notificami|mandami\s+una\s+(?:notifica|push)|voglio\s+(?:una\s+)?(?:notifica|push))\b.*\b(se|quando|appena|ogni\s+volta|in\s+caso)\b", re.IGNORECASE)
_ACP_STATUS_RE = re.compile(r"\b(quali|che|quante)\b.*\b(notific\w*|push)\b.*\b(attiv\w*|abilitat\w*|ho)\b", re.IGNORECASE)
_ACP_WATCH_TOPICS = [
    ("callback_urgent", re.compile(r"ritelefonat|richiamat|callback|telefonat", re.IGNORECASE), "richiamate urgenti in scadenza", _axn_check_callbacks),
    ("cgym_due", re.compile(r"\bgym\b|corporate|sessioni?|role.?play|allenament", re.IGNORECASE), "sessioni Corporate Gym obbligatorie in scadenza", _axn_check_cgym_due),
    ("credits", re.compile(r"credit|richieste\s+ai|piano\s+mensile", re.IGNORECASE), "utilizzo crediti AI (50/80/100%)", _axn_check_credits),
    ("axon_message", re.compile(r"scadenz|contratt|bollett|rinnov", re.IGNORECASE), "scadenze contratto critiche dei clienti", _axn_check_axon_critical),
]


async def _acp_find_member(tid: str, name: str) -> Optional[dict]:
    q = _omni_norm(name).strip()
    if not q:
        return None
    best = None
    async for u in db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).limit(300):
        full = _omni_norm(u.get("name") or "")
        if full == q:
            return u
        if q in full or q in _omni_norm(u.get("email") or "").split("@")[0]:
            best = best or u
    return best


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:
    """Comandi notifiche push in linguaggio naturale. Ritorna {"reply","cmd"} o None."""
    txt = (msg or "").strip()
    if not txt or len(txt) > 400 or not re.search(r"notific|push|avvisami|avvertimi", txt, re.IGNORECASE):
        return None
    uid = user["user_id"]; tid = tenant_id(user)

    # 1) Push a un collaboratore (solo Master/Admin)
    m = _ACP_SEND_TO_RE.match(txt)
    if m and m.group(1).strip().lower() not in ("me", "me stesso", "me stessa"):
        if not is_admin_or_owner(user):
            return {"reply": "📲 Solo il Master può inviare notifiche push ai collaboratori.", "cmd": "push_denied"}
        target = await _acp_find_member(tid, m.group(1))
        if not target:
            return {"reply": f"📲 Non trovo «{m.group(1).strip()}» nel tuo team. Dimmi il nome esatto del collaboratore.", "cmd": "push_ask"}
        text = m.group(2).strip()
        sender = user.get("name") or user.get("email") or "Master"
        await axon_notify(target["user_id"], tid, "axon_message", f"Messaggio da {sender}", text[:600], "/axon-notifications", team_copy=False)
        return {"reply": f"📲 Notifica inviata a **{target.get('name') or target.get('email')}**:\n\n«{text}»", "cmd": "push_send"}

    # 2) Notifica di prova
    if _ACP_TEST_RE.search(txt):
        doc = await axon_notify(uid, tid, "axon_message", "AxonOS · notifica di prova",
                                "Se leggi questo messaggio sul telefono, le notifiche push funzionano ✅", "/axon-notifications", team_copy=False)
        configured = _PUSH_KEY not in ("", "placeholder")
        note = "" if configured else "\n\n⚠️ Il servizio push non è configurato in questo ambiente: il push reale funziona sull'app pubblicata."
        return {"reply": f"📲 Notifica di prova {'inviata sul tuo telefono' if configured and doc and doc.get('push_sent') else 'salvata'}. La trovi anche in *Notifiche AxonOS*.{note}", "cmd": "push_test"}

    # 3) Push immediato a me
    m = _ACP_SEND_ME_RE.match(txt)
    if m:
        text = m.group(1).strip()
        if text and not re.search(r"\b(se|quando|appena)\b", text[:12], re.IGNORECASE):
            doc = await axon_notify(uid, tid, "axon_message", "AxonOS", text[:600], "/axon-notifications", team_copy=False)
            sent = _PUSH_KEY not in ("", "placeholder") and bool(doc and doc.get("push_sent"))
            return {"reply": f"📲 Notifica {'inviata sul tuo telefono' if sent else 'salvata in *Notifiche AxonOS*'}:\n\n«{text}»" + ("" if sent else "\n\n(il push sul telefono arriva con l'app pubblicata)"), "cmd": "push_send"}

    # 4) "Avvisami se/quando ho ritelefonate urgenti" → riattiva la categoria + controllo immediato
    if _ACP_WATCH_RE.search(txt):
        for kind, rx, label, fn in _ACP_WATCH_TOPICS:
            if not rx.search(txt):
                continue
            prefs = await _axn_prefs(uid)
            kinds = {**prefs.get("kinds", {}), kind: True}
            await db.axon_notification_prefs.update_one({"user_id": uid}, {"$set": {"enabled": True, "kinds": kinds, "updated_at": utcnow()},
                                                                        "$setOnInsert": {"user_id": uid}}, upsert=True)
            try:
                sent = await fn(tid)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[axn-chat-push] immediate check %s failed: %s", kind, exc)
                sent = 0
            now_s = "Ho appena controllato: " + (f"**{sent}** avvis{'o' if sent == 1 else 'i'} inviat{'o' if sent == 1 else 'i'} adesso." if sent else "al momento non c'è nulla di urgente.")
            return {"reply": f"🔔 Perfetto: ti avviso con una notifica push sulle **{label}**, anche ad app chiusa. Il controllo automatico gira ogni 10 minuti.\n\n{now_s}\n\nPuoi gestire le categorie in *Notifiche AxonOS*.", "cmd": "push_watch"}
        return None  # "avvisami tra 20 minuti…" → passa al comando promemoria

    # 5) Stato notifiche
    if _ACP_STATUS_RE.search(txt):
        prefs = await _axn_prefs(uid)
        if not prefs.get("enabled", True):
            return {"reply": "🔕 Le notifiche push AxonOS sono **disattivate**. Puoi riattivarle in *Notifiche AxonOS*.", "cmd": "push_status"}
        on = [AXN_KINDS[k] for k, v in prefs.get("kinds", {}).items() if v and k in AXN_KINDS]
        off = [AXN_KINDS[k] for k, v in prefs.get("kinds", {}).items() if not v and k in AXN_KINDS]
        rep = "📲 **Notifiche push AxonOS attive:**\n" + "\n".join(f"• {x}" for x in on)
        if off:
            rep += "\n\n**Disattivate:**\n" + "\n".join(f"• {x}" for x in off)
        rep += "\n\nDimmi ad esempio «ricordami domani alle 10 di chiamare Rossi» oppure «avvisami se ho ritelefonate urgenti»."
        return {"reply": rep, "cmd": "push_status"}
    return None
