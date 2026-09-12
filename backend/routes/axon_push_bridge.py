# axon_push_bridge.py — V50.z193 — Bridge persistente AxonOS → Push Service (modulo ISOLATO)
#
# Caricato nel namespace condiviso DOPO `axon_notifications.py` e `axon_chat_push.py` (usa `axon_notify`,
# `_axn_scheduler`, `_push_client`, `_PUSH_KEY`, `_maybe_push_command`, auth helpers) e PRIMA di 37 (include_router).
# Nessuna riscrittura del codice esistente: solo wrapper per nome nel namespace + nuove collection/endpoint.
#
# Problema risolto: il server inviava già i push in autonomia, ma non aveva NESSUNA visibilità sull'esito
# (send_push di 05 inghiotte gli errori) né sullo stato del dispositivo (token registrato? permesso negato?
# Firebase mancante?). Risultato: "le notifiche arrivano solo ad app aperta" senza modo di capire perché.
#
# Cosa aggiunge:
#   1) WRAPPER `send_push` (stessa firma, stesso client httpx): registra l'esito REALE di ogni invio in
#      `axon_push_log`, aggiorna `push_devices` (last_delivered_at / last_failed_at / last_push_status),
#      scrive `push_status` truthful sulla notifica in `axon_notifications` e, se il provider risponde
#      5xx/429/timeout, mette l'invio in OUTBOX (`axon_push_outbox`) con retry a backoff (1,2,5,10,30,60 min)
#      sul job già esistente `_axn_scheduler` (tick 60s). Nessun push perso per un hiccup del provider.
#   2) STATO DISPOSITIVO `push_devices` {user_id, platform, registered, permission, can_ask_again, token_hint,
#      error, app_env, registered_at, last_seen_at, last_delivered_at, last_failed_at, last_push_status, last_nudge_at}
#      alimentato dal client (`POST /axon/push/device`) dopo ogni tentativo di registrazione.
#   3) DIAGNOSTICA in linguaggio semplice: `GET /axon/push/status` (card "Stato canale push"), comando chat
#      «il mio telefono riceve le notifiche?» (wrapper di `_maybe_push_command`), nudge settimanale in chat
#      (`POST /axon/push/nudge`) quando il permesso è negato definitivamente.
#   4) TEST PROGRAMMATO `POST /axon/push/test-scheduled {minutes}` → `axon_push_tests`: il server spara la
#      notifica a T+N min (arming esatto + tick di recupero), esito visibile nella card; `POST /tests/{id}/ack`
#      dal telefono quando la riceve → "Ricevuta sul telefono ✅".

from zoneinfo import ZoneInfo as _ApbZone

_APB_BACKOFF_MIN = [1, 2, 5, 10, 30, 60]          # minuti tra un tentativo e il successivo
_APB_MAX_ATTEMPTS = len(_APB_BACKOFF_MIN) + 1
_APB_ARMED_TESTS: Dict[str, Any] = {}             # test_id → TimerHandle
_APB_TZ = _ApbZone("Europe/Rome")


def _apb_configured() -> bool:
    return _PUSH_KEY not in ("", "placeholder")


def _apb_it(dt: Optional[datetime]) -> str:
    """'12 settembre alle 15:30' (Europe/Rome) per messaggi in linguaggio semplice."""
    if not isinstance(dt, datetime):
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    d = dt.astimezone(_APB_TZ)
    mesi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
    return f"{d.day} {mesi[d.month - 1]} alle {d.strftime('%H:%M')}"


def _apb_hhmm(dt: Optional[datetime]) -> str:
    if not isinstance(dt, datetime):
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_APB_TZ).strftime("%H:%M")


def _apb_out(d: Optional[dict]) -> Optional[dict]:
    if not d:
        return None
    d = dict(d); d.pop("_id", None)
    for k, v in list(d.items()):
        if isinstance(v, datetime):
            d[k] = (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat()
    return d


# ============================================================================ 1) WRAPPER send_push
async def _apb_push_once(recipients: List[str], data: dict, idempotency_key: Optional[str]) -> Tuple[str, Optional[int], Optional[str]]:
    """Una chiamata al provider. Ritorna (status, http_status, error). status ∈ sent | not_configured | rejected | failed."""
    if not _apb_configured():
        return "not_configured", None, "servizio push non configurato in questo ambiente (attivo sull'app pubblicata)"
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    try:
        resp = await _push_client.post("/api/v1/push/trigger", json=payload)
    except Exception as exc:  # noqa: BLE001 — timeout / rete
        return "failed", None, f"{type(exc).__name__}: {exc}"[:200]
    if resp.status_code < 300:
        return "sent", resp.status_code, None
    if resp.status_code == 401:
        return "not_configured", 401, "chiave push non valida"
    if resp.status_code >= 500 or resp.status_code == 429:
        return "failed", resp.status_code, resp.text[:200]
    return "rejected", resp.status_code, resp.text[:200]


async def _apb_log(recipients: List[str], data: dict, idempotency_key: Optional[str], status: str, http: Optional[int],
                   err: Optional[str], attempt: int, source: str) -> str:
    log_id = f"apl_{uuid.uuid4().hex[:12]}"
    await db.axon_push_log.insert_one({
        "log_id": log_id, "recipients": recipients, "title": str(data.get("title") or "")[:120], "kind": data.get("kind"),
        "notif_id": data.get("notif_id"), "test_id": data.get("test_id"), "idempotency_key": idempotency_key,
        "status": status, "http_status": http, "error": err, "attempt": attempt, "source": source, "at": utcnow(),
    })
    return log_id


async def _apb_after(recipients: List[str], data: dict, status: str, err: Optional[str]) -> None:
    """Propaga l'esito: push_devices, notifica in-app (push_status), test programmato."""
    now = utcnow()
    upd: Dict[str, Any] = {"last_push_at": now, "last_push_status": status}
    if status == "sent":
        upd["last_delivered_at"] = now
    elif status in ("failed", "queued", "rejected"):
        upd["last_failed_at"] = now
        upd["last_error"] = (err or status)[:200]
    try:
        await db.push_devices.update_many({"user_id": {"$in": recipients}}, {"$set": upd})
        if data.get("notif_id"):
            await db.axon_notifications.update_one({"notif_id": data["notif_id"]}, {"$set": {"push_status": status, "push_status_at": now}})
        if data.get("test_id"):
            await db.axon_push_tests.update_one({"test_id": data["test_id"], "status": {"$nin": ["delivered"]}},
                                                {"$set": {"status": status, "fired_at": now, "error": err}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[apb] after-hook failed: %s", exc)


async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:  # noqa: F811
    """V50.z193 — stessa firma di 05.send_push, ma con esito registrato + outbox con retry. Non alza mai eccezioni."""
    if not recipients:
        return
    recipients = list(recipients)[:100]
    if "title" not in data or "message" not in data:
        raise ValueError("send_push data must include title and message")
    if data.get("notif_id") and not data.get("test_id"):
        # axon_notify NON propaga `extra` nel payload push: recupera test_id dalla notifica (serve per l'ack dal telefono)
        try:
            nd = await db.axon_notifications.find_one({"notif_id": data["notif_id"]}, {"_id": 0, "data.test_id": 1})
            if nd and (nd.get("data") or {}).get("test_id"):
                data = {**data, "test_id": nd["data"]["test_id"]}
        except Exception:  # noqa: BLE001
            pass
    status, http, err = await _apb_push_once(recipients, data, idempotency_key)
    await _apb_log(recipients, data, idempotency_key, status, http, err, 1, "direct")
    if status == "failed":
        try:
            await db.axon_push_outbox.insert_one({
                "item_id": f"apo_{uuid.uuid4().hex[:12]}", "recipients": recipients, "data": data, "idempotency_key": idempotency_key,
                "status": "pending", "attempts": 1, "next_at": utcnow() + timedelta(minutes=_APB_BACKOFF_MIN[0]),
                "last_error": err, "created_at": utcnow(),
            })
            status = "queued"
        except Exception as exc:  # noqa: BLE001
            logger.warning("[apb] outbox insert failed: %s", exc)
    if status != "sent":
        logger.warning("[apb] push %s (%s) → %s: %s", str(data.get("title"))[:60], recipients[0] if recipients else "-", status, err)
    await _apb_after(recipients, data, status, err)


async def _apb_outbox_tick() -> int:
    """Retry degli invii in outbox (job su _axn_scheduler ogni 60s)."""
    now = utcnow(); n = 0
    try:
        cur = db.axon_push_outbox.find({"status": "pending", "next_at": {"$lte": now}}, {"_id": 0}).limit(200)
        async for it in cur:
            claimed = await db.axon_push_outbox.find_one_and_update({"item_id": it["item_id"], "status": "pending"}, {"$set": {"status": "sending"}})
            if not claimed:
                continue
            status, http, err = await _apb_push_once(it["recipients"], it["data"], it.get("idempotency_key"))
            attempts = int(it.get("attempts") or 1) + 1
            await _apb_log(it["recipients"], it["data"], it.get("idempotency_key"), status, http, err, attempts, "outbox")
            if status == "failed" and attempts < _APB_MAX_ATTEMPTS:
                await db.axon_push_outbox.update_one({"item_id": it["item_id"]}, {"$set": {
                    "status": "pending", "attempts": attempts, "last_error": err,
                    "next_at": utcnow() + timedelta(minutes=_APB_BACKOFF_MIN[min(attempts - 1, len(_APB_BACKOFF_MIN) - 1)])}})
                await _apb_after(it["recipients"], it["data"], "queued", err)
                continue
            final = "failed" if status == "failed" else status
            await db.axon_push_outbox.update_one({"item_id": it["item_id"]}, {"$set": {"status": final, "attempts": attempts, "last_error": err, "done_at": utcnow()}})
            await _apb_after(it["recipients"], it["data"], final, err)
            n += 1 if final == "sent" else 0
    except Exception as exc:  # noqa: BLE001
        logger.warning("[apb] outbox tick failed: %s", exc)
    return n


# ============================================================================ 2) STATO DISPOSITIVO
class ApbDeviceIn(BaseModel):
    platform: str                          # android | ios
    registered: bool
    permission: str = "undetermined"       # granted | denied | undetermined
    can_ask_again: bool = True
    token_hint: Optional[str] = None       # ultimi 6 caratteri del token (mai il token intero)
    error: Optional[str] = None            # es. "FirebaseApp is not initialized"
    app_env: Optional[str] = None          # standalone | expo_go | dev | web
    device_name: Optional[str] = None
    app_version: Optional[str] = None


@api_router.post("/axon/push/device")
async def apb_device_report(body: ApbDeviceIn, user=Depends(get_current_user)):
    """Il telefono comunica l'esito della registrazione al push service (dopo login / app open)."""
    uid = user["user_id"]; now = utcnow()
    prev = await db.push_devices.find_one({"user_id": uid, "platform": body.platform}, {"_id": 0})
    upd: Dict[str, Any] = {
        "registered": body.registered, "permission": body.permission[:20], "can_ask_again": body.can_ask_again,
        "token_hint": (body.token_hint or "")[-6:] or None, "error": (body.error or "")[:200] or None,
        "app_env": (body.app_env or "")[:20] or None, "device_name": (body.device_name or "")[:60] or None,
        "app_version": (body.app_version or "")[:20] or None, "last_seen_at": now, "tenant_id": tenant_id(user),
    }
    if body.registered and (not prev or not prev.get("registered") or prev.get("token_hint") != upd["token_hint"]):
        upd["registered_at"] = now
    if not body.registered and body.permission == "granted":
        upd["last_failed_at"] = now       # permesso ok ma token/registrazione falliti → problema di build/config
    await db.push_devices.update_one({"user_id": uid, "platform": body.platform}, {"$set": upd, "$setOnInsert": {"user_id": uid, "platform": body.platform, "created_at": now}}, upsert=True)
    return await apb_status(user)


async def _apb_devices(uid: str) -> List[dict]:
    return [d async for d in db.push_devices.find({"user_id": uid}, {"_id": 0}).sort("last_seen_at", -1).limit(5)]


def _apb_summary(devices: List[dict], outbox_pending: int) -> Tuple[str, str]:
    """(level, frase) in linguaggio semplice — niente token, endpoint o codici HTTP."""
    configured = _apb_configured()
    if not devices:
        return "warn", ("Il telefono non ha ancora comunicato lo stato delle notifiche. Apri l'app installata sul telefono "
                        "(non l'anteprima web): al primo avvio si collega da solo al servizio notifiche.")
    d = devices[0]
    env = d.get("app_env") or ""
    if env == "expo_go":
        return "off", "No: stai usando Expo Go, dove le notifiche ad app chiusa non possono funzionare. Serve l'app pubblicata (build Android/iOS)."
    if d.get("permission") == "denied":
        return "off", "No: il permesso notifiche risulta negato sul telefono. Vuoi che ti mostri come attivarlo?"
    if not d.get("registered"):
        err = (d.get("error") or "").lower()
        if "firebase" in err or "google-services" in err or "fcm" in err or "default firebaseapp" in err:
            why = "manca la configurazione Firebase (file google-services.json) nella build Android"
        elif d.get("permission") == "undetermined":
            why = "il permesso notifiche non è ancora stato concesso"
        else:
            why = "il telefono non è riuscito a collegarsi al servizio notifiche"
        return "off", f"No: {why}. Appena risolto, riapri l'app e il collegamento si rifà da solo."
    lf, ld = d.get("last_failed_at"), d.get("last_delivered_at")
    if not configured:
        if ld:
            return "ok", f"Sì, il tuo dispositivo è registrato e l'ultima notifica è stata ricevuta il {_apb_it(ld)}."
        return "warn", ("Il telefono è registrato, ma in questo ambiente di anteprima il servizio push non è attivo: "
                        "sull'app pubblicata le notifiche arrivano anche ad app chiusa.")
    if lf and (not ld or _axn_aware(lf) > _axn_aware(ld)):
        if outbox_pending:
            return "warn", f"Sì, il dispositivo è registrato. L'ultimo invio ({_apb_it(lf)}) ha avuto un intoppo: sto riprovando automaticamente."
        return "warn", f"Sì, il dispositivo è registrato, ma l'ultima notifica ({_apb_it(lf)}) non è stata consegnata. Prova un test dalla card Stato canale push."
    if ld:
        return "ok", f"Sì, il tuo dispositivo è registrato e l'ultima notifica è stata consegnata il {_apb_it(ld)}."
    return "ok", "Sì, il tuo dispositivo è registrato. Nessuna notifica ancora inviata: prova con «Test push tra 2 minuti»."


def _apb_test_label(t: Optional[dict]) -> Optional[str]:
    """'Test inviato alle HH:MM — Consegnato / Non consegnato' per la card."""
    if not t:
        return None
    when = _apb_hhmm(t.get("fired_at") or t.get("scheduled_at"))
    st = t.get("status")
    if st == "scheduled":
        return f"Test programmato per le {_apb_hhmm(t.get('scheduled_at'))} — in attesa"
    if st == "delivered":
        return f"Test inviato alle {when} — Ricevuto sul telefono ✅"
    if st == "sent":
        return f"Test inviato alle {when} — Consegnato al telefono ✅"
    if st == "queued":
        return f"Test inviato alle {when} — In consegna (riprovo automaticamente) ⏳"
    if st == "not_configured":
        return f"Test inviato alle {when} — Non consegnato: servizio push attivo solo sull'app pubblicata"
    return f"Test inviato alle {when} — Non consegnato ❌"


@api_router.get("/axon/push/status")
async def apb_status(user=Depends(get_current_user)):
    uid = user["user_id"]
    devices = await _apb_devices(uid)
    last_push = await db.axon_push_log.find_one({"recipients": uid}, {"_id": 0}, sort=[("at", -1)])
    outbox_pending = await db.axon_push_outbox.count_documents({"recipients": uid, "status": {"$in": ["pending", "sending"]}})
    last_test = await db.axon_push_tests.find_one({"user_id": uid}, {"_id": 0}, sort=[("created_at", -1)])
    level, summary = _apb_summary(devices, outbox_pending)
    return {
        "push_configured": _apb_configured(), "level": level, "summary": summary,
        "devices": [_apb_out(d) for d in devices], "last_push": _apb_out(last_push), "outbox_pending": outbox_pending,
        "last_test": _apb_out(last_test), "last_test_label": _apb_test_label(last_test),
    }


@api_router.get("/axon/push/log")
async def apb_log_list(limit: int = 30, user=Depends(get_current_user)):
    items = [_apb_out(d) async for d in db.axon_push_log.find({"recipients": user["user_id"]}, {"_id": 0}).sort("at", -1).limit(max(1, min(limit, 200)))]
    return {"items": items}


# ============================================================================ 3) NUDGE in chat (permesso negato)
_APB_NUDGE_DAYS = 7


@api_router.post("/axon/push/nudge")
async def apb_nudge(user=Depends(get_current_user)):
    """Permesso notifiche negato definitivamente → AxonOS lo ricorda UNA volta a settimana come messaggio in chat (non popup)."""
    uid = user["user_id"]; now = utcnow()
    dev = await db.push_devices.find_one({"user_id": uid, "last_nudge_at": {"$gte": now - timedelta(days=_APB_NUDGE_DAYS)}}, {"_id": 1})
    if dev:
        return {"ok": True, "skipped": True}
    latest = await db.assistant_messages.find_one({"user_id": uid}, {"session_id": 1}, sort=[("created_at", -1)])
    sid = (latest or {}).get("session_id") or f"asst_{uid}_{uuid.uuid4().hex[:10]}"
    text = ("📵 Ho notato che le notifiche di questa app risultano **disattivate** sul tuo telefono: così non posso avvisarti di "
            "promemoria, richiamate urgenti e briefing quando l'app è chiusa.\n\n"
            "Per riattivarle: *Impostazioni del telefono → App → questa app → Notifiche → Consenti*. "
            "Oppure apri **Notifiche AxonOS → Preferenze → Stato canale push** e tocca «Apri impostazioni».\n\n"
            "Te lo ricorderò al massimo una volta a settimana.")
    await db.assistant_messages.insert_one({"message_id": uuid.uuid4().hex[:16], "user_id": uid, "session_id": sid, "role": "assistant",
                                            "content": text, "created_at": now, "kind": "push_nudge"})
    await db.push_devices.update_many({"user_id": uid}, {"$set": {"last_nudge_at": now}})
    return {"ok": True, "skipped": False, "session_id": sid}


# ============================================================================ 4) TEST PROGRAMMATO
class ApbTestIn(BaseModel):
    minutes: int = 2


async def _apb_fire_test(test_id: str) -> None:
    _APB_ARMED_TESTS.pop(test_id, None)
    t = await db.axon_push_tests.find_one_and_update({"test_id": test_id, "status": "scheduled"}, {"$set": {"status": "firing"}})
    if not t:
        return
    when = _apb_hhmm(t.get("scheduled_at"))
    await axon_notify(t["user_id"], t.get("tenant_id") or t["user_id"], "axon_message", "AxonOS · test push programmato",
                      f"Test delle {when} riuscito: le notifiche ti raggiungono anche ad app chiusa ✅", "/axon-notifications?tab=prefs",
                      dedupe_key=f"pushtest:{test_id}", extra={"test_id": test_id, "tag": "axn_pushtest"}, team_copy=False)
    # se le preferenze bloccavano il push, axon_notify non chiama send_push → chiudi il test come non inviato
    await db.axon_push_tests.update_one({"test_id": test_id, "status": "firing"}, {"$set": {"status": "failed", "fired_at": utcnow(), "error": "notifiche disattivate nelle preferenze"}})
    logger.info("[apb] scheduled test %s fired", test_id)


def _apb_arm_test(t: dict) -> None:
    sched = _axn_aware(t.get("scheduled_at"))
    if not isinstance(sched, datetime):
        return
    delay = max(0.0, (sched - utcnow()).total_seconds())
    if delay > 12 * 3600:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    old = _APB_ARMED_TESTS.pop(t["test_id"], None)
    if old:
        try: old.cancel()
        except Exception: pass
    tid = t["test_id"]
    _APB_ARMED_TESTS[tid] = loop.call_later(delay, lambda: asyncio.ensure_future(_apb_fire_test(tid)))


async def _apb_tests_tick() -> None:
    """Recupero test scaduti non sparati (riavvio server) + riarmo dei futuri."""
    try:
        async for t in db.axon_push_tests.find({"status": "scheduled"}, {"_id": 0}).limit(200):
            sched = _axn_aware(t.get("scheduled_at"))
            if not isinstance(sched, datetime):
                continue
            if sched <= utcnow():
                await _apb_fire_test(t["test_id"])
            elif t["test_id"] not in _APB_ARMED_TESTS:
                _apb_arm_test(t)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[apb] tests tick failed: %s", exc)


@api_router.post("/axon/push/test-scheduled")
async def apb_test_scheduled(body: ApbTestIn, user=Depends(get_current_user)):
    """Programma una notifica di test a T+N minuti (1..60): la spara il server, anche ad app chiusa."""
    minutes = max(1, min(60, int(body.minutes or 2)))
    now = utcnow()
    t = {"test_id": f"apt_{uuid.uuid4().hex[:10]}", "user_id": user["user_id"], "tenant_id": tenant_id(user), "minutes": minutes,
         "scheduled_at": now + timedelta(minutes=minutes), "created_at": now, "status": "scheduled", "fired_at": None, "ack_at": None, "error": None}
    await db.axon_push_tests.insert_one(dict(t))
    _apb_arm_test(t)
    return {"ok": True, "test": _apb_out(t), "label": _apb_test_label(t), "push_configured": _apb_configured()}


@api_router.post("/axon/push/tests/{test_id}/ack")
async def apb_test_ack(test_id: str, user=Depends(get_current_user)):
    """Il telefono ha RICEVUTO la notifica di test (listener nativo) → conferma end-to-end."""
    now = utcnow()
    r = await db.axon_push_tests.update_one({"test_id": test_id, "user_id": user["user_id"]}, {"$set": {"status": "delivered", "ack_at": now}})
    await db.push_devices.update_many({"user_id": user["user_id"]}, {"$set": {"last_delivered_at": now, "last_push_status": "delivered"}})
    return {"ok": True, "updated": r.modified_count}


# ============================================================================ 5) COMANDO CHAT «il mio telefono riceve le notifiche?»
_APB_DIAG_RE = re.compile(
    r"\b(telefono|cellulare|dispositivo|smartphone|ricev\w*|arriv\w*|funzion\w*)\b.{0,40}\b(notific\w*|push)\b"
    r"|\b(notific\w*|push)\b.{0,40}\b(arriv\w*|funzion\w*|ricev\w*|telefono|cellulare|dispositivo)\b", re.IGNORECASE)

_apb_orig_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").strip()
    is_cmd = bool(_ACP_SEND_TO_RE.match(txt) or _ACP_SEND_ME_RE.match(txt) or _ACP_TEST_RE.search(txt) or _ACP_WATCH_RE.search(txt)
                  or re.search(r"\b(ricordami|avvisami|avvertimi|mandami|inviami|manda|invia|timer|sveglia|programma)\b", txt, re.IGNORECASE)) if txt else True
    if txt and len(txt) <= 160 and not is_cmd and _APB_DIAG_RE.search(txt):
        st = await apb_status(user)
        rep = "📲 " + st["summary"]
        if st.get("last_test_label"):
            rep += f"\n\n{st['last_test_label']}."
        if st["level"] == "ok":
            rep += "\n\nSe vuoi una verifica ad app chiusa, dimmi «programma un test push tra 2 minuti» oppure usa la card *Stato canale push* in Notifiche AxonOS."
        elif st["level"] == "off" and any(d.get("permission") == "denied" for d in st["devices"]):
            rep += "\n\nApri **Notifiche AxonOS → Preferenze → Stato canale push** e tocca «Apri impostazioni»: attivi il permesso e il collegamento si rifà da solo."
        return {"reply": rep, "cmd": "push_diag"}
    m = re.search(r"\b(programma|imposta|fai|manda|invia)\b.{0,30}\btest\b.{0,20}\b(push|notific\w*)\b.{0,30}?\b(\d{1,2})\s*min", txt, re.IGNORECASE) if txt else None
    if m:
        r = await apb_test_scheduled(ApbTestIn(minutes=int(m.group(3))), user)
        when = _apb_hhmm(_axn_aware(datetime.fromisoformat(r["test"]["scheduled_at"])))
        note = "" if r["push_configured"] else "\n\n⚠️ In questo ambiente di anteprima il push reale non parte: l'esito completo si vede sull'app pubblicata."
        return {"reply": f"⏱️ Test programmato: alle **{when}** ti invierò una notifica push. Puoi anche chiudere l'app: l'esito comparirà nella card *Stato canale push*.{note}", "cmd": "push_test_scheduled"}
    return await _apb_orig_maybe_push_command(msg, user)


# ============================================================================ STARTUP
@app.on_event("startup")
async def _apb_start():
    try:
        await db.push_devices.create_index([("user_id", 1), ("platform", 1)], unique=True)
        await db.axon_push_log.create_index([("recipients", 1), ("at", -1)])
        await db.axon_push_outbox.create_index([("status", 1), ("next_at", 1)])
        await db.axon_push_tests.create_index([("user_id", 1), ("created_at", -1)])
        await db.axon_push_tests.create_index([("status", 1), ("scheduled_at", 1)])
        _axn_scheduler.add_job(_apb_outbox_tick, "interval", seconds=60, id="apb-outbox-tick", replace_existing=True)
        _axn_scheduler.add_job(_apb_tests_tick, "interval", seconds=60, id="apb-tests-tick", replace_existing=True)
        asyncio.get_running_loop().call_later(4, lambda: asyncio.ensure_future(_apb_tests_tick()))
        logger.info("[apb] push bridge armed (outbox retry + scheduled tests, tick 60s) configured=%s", _apb_configured())
    except Exception as exc:  # noqa: BLE001
        logger.warning("[apb] start failed: %s", exc)
