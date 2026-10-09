# axon_critical_events.py — V50.z496 — ALLARME PRIORITARIO per eventi critici di sistema (stress test notturno, anomalie, …)
# Un solo punto d'ingresso: `await axon_critical_alert(user_id, source, title, message, route=…, dedupe_key=…)` → 3 livelli simultanei:
#   1) BANNER rosso in Home (db.axon_critical_events, resta finché l'utente non lo chiude: POST /axon/critical-events/{id}/dismiss)
#   2) PUSH urgente (kind «system_critical» → urgenza CRITICAL: canale urgent_alerts, LED rosso, vibrazione lunga, bypass DND, time-sensitive iOS)
#      + voce nella campanella (axon_notifications) — inviata anche se le preferenze del tipo sono disattivate (non silenziabile)
#   3) VOCE: alla prima interazione con Axon (chat o stream) dopo l'evento, la risposta inizia con
#      «Attenzione: … Vuoi che ti mostri i dettagli?» (+ chip «Vedi dettagli»); l'evento viene marcato announced.
# Caricato DOPO axon_nav_guard.py (ri-avvolge /assistant/chat e /assistant/chat/stream come ultimo strato).
import json as _ce_json

_CE_KIND = "system_critical"
_CE_KIND_LABEL = "Eventi critici di sistema (stress test notturno, anomalie)"
try:
    AXN_KINDS[_CE_KIND] = _CE_KIND_LABEL  # noqa: F821 — campanella + preferenze
    _APU_DEFAULT_KIND_MAP[_CE_KIND] = "CRITICAL"  # noqa: F821 — push su canale urgente
except Exception as _e:  # noqa: BLE001
    logger.warning("[critical] kind registration failed: %s", _e)  # noqa: F821


def _ce_out(d: dict) -> dict:
    d = dict(d); d.pop("_id", None)
    for k in ("created_at", "dismissed_at", "announced_at"):
        if isinstance(d.get(k), datetime):  # noqa: F821
            d[k] = d[k].isoformat()
    return d


async def axon_critical_alert(user_id: str, source: str, title: str, message: str, route: str = None, dedupe_key: str = None,
                              voice_text: str = None, extra: dict = None) -> dict:
    """Registra un evento critico e fa scattare banner + push urgente + avviso vocale alla prossima interazione."""
    if dedupe_key:
        prev = await db.axon_critical_events.find_one({"user_id": user_id, "dedupe_key": dedupe_key}, {"_id": 0})  # noqa: F821
        if prev:
            return prev
    urow = await db.users.find_one({"user_id": user_id}, {"_id": 0, "parent_user_id": 1}) or {}  # noqa: F821
    tenant = urow.get("parent_user_id") or user_id
    ev = {"event_id": f"cev_{uuid.uuid4().hex[:12]}", "user_id": user_id, "tenant_id": tenant, "source": source, "severity": "critical",  # noqa: F821
          "title": (title or "Evento critico")[:160], "message": (message or "")[:800], "route": route,
          "voice_text": (voice_text or f"Attenzione: {message}")[:400], "extra": extra or {}, "dedupe_key": dedupe_key,
          "created_at": utcnow(), "dismissed": False, "dismissed_at": None, "announced": False, "announced_at": None, "push_sent": False}  # noqa: F821
    await db.axon_critical_events.insert_one(ev)  # noqa: F821
    # Livello 2 — push urgente + campanella (non silenziabile: se le preferenze bloccano il tipo, il push parte comunque)
    try:
        n = await axon_notify(user_id, tenant, _CE_KIND, title, message, deeplink=route or "/axon-notifications",  # noqa: F821
                              dedupe_key=f"cev:{ev['event_id']}", extra={"urgency": "CRITICAL", "critical_event_id": ev["event_id"], "source": source}, team_copy=False)
        if not (n or {}).get("push_sent"):
            await send_critical_alert([user_id], title, message, deeplink=route, idempotency_key=f"cev-{ev['event_id']}", kind=_CE_KIND)  # noqa: F821
        await db.axon_critical_events.update_one({"event_id": ev["event_id"]}, {"$set": {"push_sent": True}})  # noqa: F821
        ev["push_sent"] = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[critical] push failed: %s", exc)  # noqa: F821
    logger.warning("[critical] %s · %s: %s", source, title, message)  # noqa: F821
    return _ce_out(ev)


# ----------------------------------------------------------------------------- API
@api_router.get("/axon/critical-events/active")  # noqa: F821
async def critical_events_active(user=Depends(get_current_user)):  # noqa: F821
    """Banner in Home: eventi critici NON ancora chiusi dall'utente (più recenti prima)."""
    rows = await db.axon_critical_events.find({"user_id": user["user_id"], "dismissed": False}, {"_id": 0}).sort("created_at", -1).to_list(20)  # noqa: F821
    return {"items": [_ce_out(r) for r in rows]}


@api_router.get("/axon/critical-events")  # noqa: F821
async def critical_events_list(limit: int = 50, user=Depends(get_current_user)):  # noqa: F821
    rows = await db.axon_critical_events.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(limit, 200)))  # noqa: F821
    return {"items": [_ce_out(r) for r in rows]}


@api_router.post("/axon/critical-events/{event_id}/dismiss")  # noqa: F821
async def critical_events_dismiss(event_id: str, user=Depends(get_current_user)):  # noqa: F821
    r = await db.axon_critical_events.update_one({"event_id": event_id, "user_id": user["user_id"]}, {"$set": {"dismissed": True, "dismissed_at": utcnow(), "announced": True}})  # noqa: F821
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Evento non trovato")  # noqa: F821
    return {"ok": True}


@api_router.post("/axon/critical-events/{event_id}/announced")  # noqa: F821
async def critical_events_announced(event_id: str, user=Depends(get_current_user)):  # noqa: F821
    await db.axon_critical_events.update_one({"event_id": event_id, "user_id": user["user_id"]}, {"$set": {"announced": True, "announced_at": utcnow()}})  # noqa: F821
    return {"ok": True}


class _CeTestIn(BaseModel):  # noqa: F821
    title: str = "Test allarme critico"
    message: str = "Stress test notturno: prestazioni Axon calate al 44.9%, era 95%. Richiede attenzione."
    route: str = "/axon-stress-report"
    source: str = "test"


@api_router.post("/axon/critical-events/test")  # noqa: F821
async def critical_events_test(body: _CeTestIn, user=Depends(get_current_user)):  # noqa: F821
    """Master: prova i 3 livelli (banner, push urgente, voce alla prossima domanda ad Axon)."""
    if not is_owner(user):  # noqa: F821
        raise HTTPException(status_code=403, detail="Solo il titolare")  # noqa: F821
    return await axon_critical_alert(user["user_id"], body.source, body.title, body.message, route=body.route,
                                     voice_text="Attenzione: questo è un test dell'allarme critico. Vuoi che ti mostri i dettagli?")


# ----------------------------------------------------------------------------- Livello 3 — voce alla prima interazione
async def _ce_take_pending_voice(user: dict):
    """Eventi critici non ancora annunciati a voce → testo da anteporre alla risposta (e li marca announced)."""
    try:
        rows = await db.axon_critical_events.find({"user_id": user["user_id"], "announced": False}, {"_id": 0, "event_id": 1, "voice_text": 1, "route": 1, "title": 1}).sort("created_at", -1).to_list(5)  # noqa: F821
    except Exception:  # noqa: BLE001
        return None
    if not rows:
        return None
    await db.axon_critical_events.update_many({"event_id": {"$in": [r["event_id"] for r in rows]}}, {"$set": {"announced": True, "announced_at": utcnow()}})  # noqa: F821
    first = rows[0]
    txt = first.get("voice_text") or f"Attenzione: {first.get('title')}."
    if not txt.rstrip().endswith("?"):
        txt = txt.rstrip(" .") + ". Vuoi che ti mostri i dettagli?"
    if len(rows) > 1:
        txt += f" (Ci sono altri {len(rows) - 1} avvisi critici nella campanella.)"
    chip = f" [[NAV:{first['route']}|Vedi dettagli]]" if first.get("route") else ""
    return {"text": f"⚠️ {txt}{chip}\n\n", "spoken": txt, "event_id": first["event_id"]}


async def _ce_patch_history(message_id: str, prefix: str):
    """La domanda successiva («sì, mostrameli») deve avere il contesto: il prefisso finisce anche nello storico della chat."""
    if not message_id or not prefix:
        return
    try:
        m = await db.assistant_messages.find_one({"message_id": message_id}, {"_id": 0, "content": 1})  # noqa: F821
        if m and not (m.get("content") or "").startswith(prefix.strip()[:20]):
            await db.assistant_messages.update_one({"message_id": message_id}, {"$set": {"content": prefix + (m.get("content") or "")}})  # noqa: F821
    except Exception:  # noqa: BLE001
        pass


_ce_orig_chat = None
_ce_orig_stream = None
for _r in list(api_router.routes):  # noqa: F821
    _p = getattr(_r, "path", "")
    if "POST" in (getattr(_r, "methods", None) or set()):
        if _p.endswith("/assistant/chat") and _ce_orig_chat is None:
            _ce_orig_chat = _r.endpoint; api_router.routes.remove(_r)  # noqa: F821
        elif _p.endswith("/assistant/chat/stream") and _ce_orig_stream is None:
            _ce_orig_stream = _r.endpoint; api_router.routes.remove(_r)  # noqa: F821

if _ce_orig_chat is not None:
    @api_router.post("/assistant/chat")  # noqa: F821
    async def assistant_chat(body: AssistantChatIn, user=Depends(get_current_user)):  # noqa: F811, F821
        pend = await _ce_take_pending_voice(user)
        # V50.z506 — BUG 1 (chat NON-stream): gli intercettori imprevisto/agente (axon_emergency, axon_agent) erano agganciati SOLO allo
        # stream (22) → qui «programma una telefonata con X martedì» arrivava all'LLM conversazionale che rispondeva «Fatto» senza salvare.
        # Stessa catena dello stream: emergenza → agente (scrittura reale + verifica) → altrimenti percorso normale.
        _ag = None
        if not getattr(body, "no_cache", False):
            try:
                user["_client_ctx"] = getattr(body, "client_context", None)
                _ag = (await _maybe_emergency_command(body.message or "", user)) or (await _maybe_agent_command(body.message or "", user))  # noqa: F821
            except Exception as _exc:  # noqa: BLE001
                logger.warning("[critical-events] agent intercept failed: %s", _exc)  # noqa: F821
        if _ag and _ag.get("reply") is not None:
            _sid = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"  # noqa: F821
            _mid = uuid.uuid4().hex[:16]  # noqa: F821
            try:
                await db.assistant_messages.insert_many([  # noqa: F821
                    {"user_id": user["user_id"], "session_id": _sid, "role": "user", "content": body.message or "", "created_at": utcnow()},  # noqa: F821
                    {"message_id": _mid, "user_id": user["user_id"], "session_id": _sid, "role": "assistant", "content": _ag["reply"], "created_at": utcnow()},  # noqa: F821
                ])
            except Exception:  # noqa: BLE001
                pass
            out = {"session_id": _sid, "message_id": _mid, "reply": _ag["reply"], "used_web_search": False, "web_sources": [], "from_cache": False, "slash": _ag.get("cmd")}
        else:
            out = await _ce_orig_chat(body, user)
        if pend and isinstance(out, dict) and isinstance(out.get("reply"), str):
            out["reply"] = pend["text"] + out["reply"]
            out["critical_event_id"] = pend["event_id"]
            await _ce_patch_history(out.get("message_id"), pend["text"])
        return out

if _ce_orig_stream is not None:
    @api_router.post("/assistant/chat/stream")  # noqa: F821
    async def assistant_chat_stream(body: AssistantChatStreamIn, user=Depends(get_current_user)):  # noqa: F811, F821
        pend = await _ce_take_pending_voice(user)
        resp = await _ce_orig_stream(body, user)
        if not pend or not hasattr(resp, "body_iterator"):
            return resp
        orig_iter = resp.body_iterator
        prefix_evt = f"event: delta\ndata: {_ce_json.dumps({'text': pend['text'], 'critical_event_id': pend['event_id']}, ensure_ascii=False)}\n\n"

        async def wrapped():
            sent = False
            async for chunk in orig_iter:
                s = chunk.decode("utf-8", "ignore") if isinstance(chunk, (bytes, bytearray)) else str(chunk)
                if not sent and ("event: delta" in s or "event: done" in s):
                    sent = True
                    yield prefix_evt.encode("utf-8")
                if "event: done" in s:
                    try:
                        _d = s.split("data: ", 1)[1].split("\n", 1)[0]
                        await _ce_patch_history(_ce_json.loads(_d).get("message_id"), pend["text"])
                    except Exception:  # noqa: BLE001
                        pass
                yield chunk
            if not sent:
                yield prefix_evt.encode("utf-8")
        resp.body_iterator = wrapped()
        return resp


# ----------------------------------------------------------------------------- anomalie di sistema (es. riavvio forzato dal watchdog)
async def axon_critical_alert_masters(source: str, title: str, message: str, route: str = None, dedupe_key: str = None, voice_text: str = None) -> int:
    """Evento critico SENZA utente (backend): avvisa i Super Master (SUPER_MASTER_EMAILS). Ritorna quanti avvisati."""
    emails = [e.strip().lower() for e in (os.environ.get("SUPER_MASTER_EMAILS") or "").split(",") if e.strip()]  # noqa: F821
    if not emails:
        logger.warning("[critical] nessun SUPER_MASTER_EMAILS: evento «%s» solo a log", title)  # noqa: F821
        return 0
    n = 0
    async for u in db.users.find({"email": {"$in": emails}}, {"_id": 0, "user_id": 1}):  # noqa: F821
        await axon_critical_alert(u["user_id"], source, title, message, route=route, dedupe_key=dedupe_key, voice_text=voice_text)
        n += 1
    return n


@app.on_event("startup")  # noqa: F821
async def _ce_check_watchdog_restart():
    """Il watchdog ha riavviato il processo (loop bloccato / LLM muto) → allarme prioritario al Super Master."""
    import os as _ce_os
    p = "/tmp/axon_watchdog_restart.json"
    if not _ce_os.path.exists(p):
        return
    try:
        with open(p, encoding="utf-8") as f:
            info = _ce_json.load(f)
        _ce_os.remove(p)
        at = datetime.fromtimestamp(float(info.get("at") or 0), tz=timezone.utc).astimezone(_vd_zoneinfo.ZoneInfo("Europe/Rome")).strftime("%d/%m %H:%M")  # noqa: F821
        await axon_critical_alert_masters("watchdog", "⚠️ Axon riavviato automaticamente",
                                          f"Anomalia critica alle {at}: {info.get('reason') or 'blocco del servizio'}. Il watchdog ha riavviato Axon. Controlla lo stato del sistema.",
                                          route="/axon-system", dedupe_key=f"wd-{int(float(info.get('at') or 0))}",
                                          voice_text="Attenzione: Axon è stato riavviato automaticamente dal watchdog per un'anomalia critica. Vuoi che ti mostri i dettagli?")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[critical] watchdog restart alert failed: %s", exc)  # noqa: F821
