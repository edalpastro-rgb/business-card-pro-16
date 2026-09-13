# axon_ops_status.py — V50.z222 — «Autonomia Axon»: visibilità in tempo reale su OUTBOX invii e JOB FETCHER GME (modulo ISOLATO)
#
# Adattamento allo stack reale (FastAPI + Emergent Push + scheduler APScheduler) del task «API outbox Teams/Email + fetcher GME»:
#  • L'outbox di AdvisorOS è quello delle PUSH (`axon_push_outbox` + `axon_push_log`, retry a backoff nel job apb-outbox-tick): non esiste
#    un canale Teams/Email verso «Neo» (Neo È l'assistente). Ogni invio riceve un `message_id` univoco (idempotency_key `msg_…`).
#  • TASK 1  GET /api/integrations/outbox/status?message_id=…  → {message_id, type, status pending|sent|failed|retry, recipient, timestamp_queued,
#            timestamp_sent, retry_count, last_error, next_retry}  · GET /api/integrations/outbox/recent (ultimi invii dell'utente)
#  • TASK 2  GET /api/jobs/gme-fetcher/status → {job_id, status idle|running|completed|failed|timeout, last_run, next_run, timeout_sec (20),
#            duration_ms, files_found, files_downloaded, errors[], last_success}. Il fetcher (`_punq_refresh`) è avvolto per misurare durata,
#            stato e raccogliere gli errori «[punq]»; timeout HTTP alzato a 20 s in axon_pun_quick.py.
#  • TASK 3/4 Axon: ogni push è tracciata con message_id; quando l'utente chiede di invii/notifiche/fetcher, il prompt riceve la sezione
#            «📡 STATO INVII E FETCHER GME» con dati live e le formule ✅/⚠️/🔴 richieste. POST /api/notify {urgency,title,body} → push a se stessi.

import logging as _ops_logging
import time as _ops_time

_OPS_STATUS_MAP = {"sent": "sent", "delivered": "sent", "ok": "sent", "queued": "pending", "pending": "pending", "sending": "pending",
                   "failed": "failed", "not_configured": "failed", "error": "failed", "skipped": "failed"}


def _ops_iso(v) -> Optional[str]:
    d = _am_dt(v) if v is not None else None
    return d.isoformat() if d else None


def _ops_shape(message_id: str, ob: Optional[dict], lg: Optional[dict]) -> dict:
    """Unisce riga outbox (retry) e ultima riga di log in un'unica risposta nella forma richiesta."""
    data = (ob or {}).get("data") or {}
    if lg and not data:
        data = {"title": lg.get("title"), "urgency": None}
    recips = (ob or lg or {}).get("recipients") or []
    if ob:
        st = ob.get("status") or "pending"
        status = "retry" if st in ("pending", "sending") and int(ob.get("attempts") or 0) > 1 else _OPS_STATUS_MAP.get(st, "pending")
        return {"message_id": message_id, "type": "push", "status": status, "urgency": data.get("urgency"), "title": data.get("title"),
                "recipient": recips[0] if len(recips) == 1 else recips,
                "timestamp_queued": _ops_iso(ob.get("created_at")), "timestamp_sent": _ops_iso(ob.get("done_at")) if status == "sent" else None,
                "retry_count": max(0, int(ob.get("attempts") or 1) - 1), "last_error": ob.get("last_error") if status != "sent" else None,
                "next_retry": _ops_iso(ob.get("next_at")) if status in ("pending", "retry") else None}
    st = (lg or {}).get("status") or "pending"
    status = _OPS_STATUS_MAP.get(st, "pending")
    return {"message_id": message_id, "type": "push", "status": status, "urgency": data.get("urgency"), "title": data.get("title"),
            "recipient": recips[0] if len(recips) == 1 else recips,
            "timestamp_queued": _ops_iso((lg or {}).get("at")), "timestamp_sent": _ops_iso((lg or {}).get("at")) if status == "sent" else None,
            "retry_count": max(0, int((lg or {}).get("attempt") or 1) - 1), "last_error": (lg or {}).get("error") if status != "sent" else None, "next_retry": None,
            "note": ("servizio push non configurato in questo ambiente: l'invio partirà sull'app pubblicata" if st == "not_configured" else None)}


async def _ops_lookup(message_id: str, uid: Optional[str] = None) -> Optional[dict]:
    q_ob = {"$or": [{"idempotency_key": message_id}, {"item_id": message_id}, {"data.message_id": message_id}]}
    q_lg = {"$or": [{"idempotency_key": message_id}, {"data.message_id": message_id}]}
    if uid:
        q_ob["recipients"] = uid; q_lg["recipients"] = uid
    ob = await db.axon_push_outbox.find_one(q_ob, {"_id": 0}, sort=[("created_at", -1)])
    lg = await db.axon_push_log.find_one(q_lg, {"_id": 0}, sort=[("at", -1)])
    if not ob and not lg:
        return None
    return _ops_shape(message_id, ob, lg)


@api_router.get("/integrations/outbox/status")
async def ops_outbox_status(message_id: str, user=Depends(get_current_user)):
    res = await _ops_lookup(message_id, user["user_id"])
    if not res:
        raise HTTPException(status_code=404, detail="message_id sconosciuto")
    return res


@api_router.get("/integrations/outbox/recent")
async def ops_outbox_recent(limit: int = 10, user=Depends(get_current_user)):
    uid = user["user_id"]
    out: List[dict] = []
    seen = set()
    async for lg in db.axon_push_log.find({"recipients": uid}, {"_id": 0}).sort("at", -1).limit(max(1, min(limit, 50))):
        mid = lg.get("idempotency_key") or (lg.get("data") or {}).get("message_id")
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append(await _ops_lookup(mid, uid) or _ops_shape(mid, None, lg))
    pending = await db.axon_push_outbox.count_documents({"recipients": uid, "status": {"$in": ["pending", "sending"]}})
    return {"items": out, "pending_in_outbox": pending, "push_configured": _apb_configured()}


# ---------------------------------------------------------------------------- ogni invio ha un message_id (TASK 3.1-3.3)
_ops_prev_send_push = send_push


async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:  # noqa: F811
    mid = idempotency_key or f"msg_{uuid.uuid4().hex[:12]}"
    if isinstance(data, dict):
        data = {**data, "message_id": mid}
    await _ops_prev_send_push(recipients, data, mid)


# ---------------------------------------------------------------------------- TASK 2: stato del fetcher GME (wrapper di _punq_refresh)
_OPS_GME_TIMEOUT_SEC = 20
_ops_gme_state: Dict[str, Any] = {"status": "idle", "job_id": None, "started_at": None, "duration_ms": None, "files_found": 0, "files_downloaded": 0,
                                  "errors": [], "last_success": None, "last_run": None}


class _OpsPunqHandler(_ops_logging.Handler):
    def __init__(self):
        super().__init__(level=_ops_logging.WARNING)
        self.items: List[dict] = []

    def emit(self, record):
        try:
            msg = record.getMessage()
            if "[punq]" in msg:
                low = msg.lower()
                typ = "timeout" if "timeout" in low or "timed out" in low else "parse" if "parse" in low else "http"
                m = re.search(r"https?://\S+", msg)
                self.items.append({"timestamp": utcnow().isoformat(), "type": typ, "url": m.group(0) if m else None, "message": msg[:300]})
        except Exception:  # noqa: BLE001
            pass


_ops_prev_punq_refresh = _punq_refresh


async def _punq_refresh(n: int = _PUNQ_LOOKBACK, force: bool = False) -> dict:  # noqa: F811
    st = _ops_gme_state
    st.update({"status": "running", "job_id": f"gme-fetch-{utcnow().strftime('%Y%m%d-%H%M')}", "started_at": utcnow(), "errors": []})
    h = _OpsPunqHandler(); logger.addHandler(h); t0 = _ops_time.monotonic()
    try:
        r = await asyncio.wait_for(_ops_prev_punq_refresh(n, force), timeout=_OPS_GME_TIMEOUT_SEC * 6)  # 6 PDF × 20 s max
        st["files_found"] = int(r.get("checked") or 0); st["files_downloaded"] = int(r.get("checked") or 0) - len(r.get("missing") or [])
        st["status"] = "completed" if not h.items or r.get("added") or not r.get("missing") else "failed"
        st["last_success"] = utcnow() if st["status"] == "completed" else st.get("last_success")
        return r
    except asyncio.TimeoutError:
        st["status"] = "timeout"; h.items.append({"timestamp": utcnow().isoformat(), "type": "timeout", "url": _PUNQ_GME_PAGE, "message": f"Fetcher GME oltre {_OPS_GME_TIMEOUT_SEC * 6}s"})
        return {"added": [], "missing": [], "checked": 0}
    except Exception as exc:  # noqa: BLE001
        st["status"] = "failed"; h.items.append({"timestamp": utcnow().isoformat(), "type": "error", "url": None, "message": str(exc)[:300]})
        return {"added": [], "missing": [], "checked": 0}
    finally:
        logger.removeHandler(h)
        st["errors"] = h.items[-10:]; st["duration_ms"] = int((_ops_time.monotonic() - t0) * 1000); st["last_run"] = utcnow()
        try:
            await db.axon_pun_meta.update_one({"key": "fetcher_status"}, {"$set": {"key": "fetcher_status", **{k: v for k, v in st.items()}}}, upsert=True)
        except Exception:  # noqa: BLE001
            pass


async def _ops_gme_status() -> dict:
    st = dict(_ops_gme_state)
    if not st.get("last_run"):
        saved = await db.axon_pun_meta.find_one({"key": "fetcher_status"}, {"_id": 0}) or {}
        st.update({k: v for k, v in saved.items() if k != "key"})
    nxt = None
    try:
        runs = [j.next_run_time for j in (_axn_scheduler.get_job("punq-daily"), _axn_scheduler.get_job("punq-monthly")) if j and j.next_run_time]
        nxt = min(runs).isoformat() if runs else None
    except Exception:  # noqa: BLE001
        pass
    cached = await db.gme_pun_cache.count_documents({})
    return {"job_id": st.get("job_id"), "status": st.get("status") or "idle", "last_run": _ops_iso(st.get("last_run")), "next_run": nxt,
            "timeout_sec": _OPS_GME_TIMEOUT_SEC, "duration_ms": st.get("duration_ms"), "files_found": st.get("files_found") or 0,
            "files_downloaded": st.get("files_downloaded") or 0, "errors": st.get("errors") or [], "last_success": _ops_iso(st.get("last_success")),
            "months_in_cache": cached, "source": _PUNQ_GME_PAGE}


@api_router.get("/jobs/gme-fetcher/status")
async def ops_gme_status(user=Depends(get_current_user)):
    return await _ops_gme_status()


@api_router.post("/jobs/gme-fetcher/run")
async def ops_gme_run(user=Depends(get_current_user)):
    if (user.get("role") or "owner") not in ("owner", "master", "admin"):
        raise HTTPException(status_code=403, detail="Solo il Master")
    r = await _punq_refresh(_PUNQ_LOOKBACK)
    return {"result": r, "status": await _ops_gme_status()}


# ---------------------------------------------------------------------------- POST /api/notify (notifica di completamento task, urgenza a scelta)
class OpsNotifyIn(BaseModel):
    title: str
    body: str
    urgency: str = "HIGH"
    device_id: Optional[str] = None  # informativo: le push vanno a tutti i dispositivi registrati dell'utente
    deeplink: Optional[str] = None


@api_router.post("/notify")
async def ops_notify(body: OpsNotifyIn, user=Depends(get_current_user)):
    mid = f"msg_{uuid.uuid4().hex[:12]}"
    u = apu_normalize(body.urgency)
    fn = {"CRITICAL": send_critical_alert, "HIGH": send_standard_notif, "NORMAL": send_normal_notif}[u]
    await fn([user["user_id"]], body.title, body.body, body.deeplink, kind="axon_message", idempotency_key=mid, device_id=body.device_id)
    return {"ok": True, "message_id": mid, "urgency": u, "status": await _ops_lookup(mid, user["user_id"])}


# ---------------------------------------------------------------------------- TASK 3/4: Axon vede e riferisce (prompt live su richiesta)
_OPS_ASK_RE = re.compile(r"(outbox|in coda|inviat|invio|arrivat|ricevut|consegnat|notific|push\b|fetcher|gme\b|aggiorn\w*\s+(pun|tabella)|stato\s+(sistem|invii|job)|message_id|msg_[a-z0-9]+|retry|riprov)", re.I)
_ops_prev_prepare_prompt = _prepare_assistant_prompt


def _ops_age(iso: Optional[str]) -> str:
    d = _am_dt(iso) if iso else None
    if not d:
        return "n/d"
    s = int((_am_dt(utcnow()) - d).total_seconds())
    return f"{s}s fa" if s < 90 else f"{s // 60} min fa" if s < 5400 else f"{s // 3600} h fa"


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _ops_prev_prepare_prompt(user, body)
    try:
        msg = (getattr(body, "message", None) or "") if body is not None else ""
        if not prep.get("system_message") or not _OPS_ASK_RE.search(msg):
            return prep
        rec = await ops_outbox_recent(5, user)
        gme = await _ops_gme_status()
        lines = ["\n\n📡 STATO INVII (outbox push) E FETCHER GME — dati LIVE dal backend, riferiscili con precisione (mai inventare):",
                 f"• Servizio push: {'attivo' if rec['push_configured'] else 'NON configurato in questo ambiente (anteprima/Expo Go): gli invii risultano failed/not_configured e partiranno sull app pubblicata'}; in coda outbox: {rec['pending_in_outbox']}."]
        for it in rec["items"][:5]:
            lines.append(f"  - {it['message_id']} «{(it.get('title') or '')[:40]}» → {it['status'].upper()} ({_ops_age(it.get('timestamp_queued'))})"
                         + (f", errore: {it['last_error']}" if it.get("last_error") else "") + (f", prossimo tentativo {it['next_retry']}" if it.get("next_retry") else ""))
        if not rec["items"]:
            lines.append("  - nessun invio recente.")
        lines.append(f"• Fetcher GME (job {gme.get('job_id') or 'n/d'}): stato {gme['status'].upper()}, ultimo run {_ops_age(gme.get('last_run'))}, durata {gme.get('duration_ms') or 'n/d'} ms, "
                     f"timeout HTTP {gme['timeout_sec']}s, PDF trovati {gme['files_found']} / scaricati {gme['files_downloaded']}, mesi in cache {gme['months_in_cache']}, "
                     f"ultimo successo {_ops_age(gme.get('last_success'))}, prossimo run {gme.get('next_run') or 'n/d'}." + (f" Errori recenti: {'; '.join(e['message'][:90] for e in gme['errors'][-3:])}" if gme.get("errors") else " Nessun errore."))
        lines.append("Formule da usare: ✅ «Invio X consegnato in Ns» se sent; ⚠️ «Invio ancora in coda (attesa > 15s), riproviamo» se pending/retry; "
                     "🔴 «Errore invio: {errore} — nuovo tentativo alle {next_retry}» se failed con retry; ⚠️ «Fetcher GME in timeout/errore» se il job non è completed. "
                     "Tutto verificabile da Impostazioni → Notifiche AxonOS (log push) e con GET /api/integrations/outbox/status?message_id=… · GET /api/jobs/gme-fetcher/status.")
        prep["system_message"] += "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[ops-status] prompt failed: %s", exc)
    return prep


_OMNI_EXTRA_SECTIONS.append((
    "Stato invii (outbox) e fetcher GME", "/axon-notifications",
    "Ogni push ha un message_id (msg_…) tracciato in outbox/log con stato pending|sent|failed|retry, tentativi, errore e prossimo retry (backoff 1-2-5-10-30-60 min). "
    "API: GET /api/integrations/outbox/status?message_id=…, GET /api/integrations/outbox/recent, GET /api/jobs/gme-fetcher/status (job PUN GME: stato, durata, errori, "
    "timeout 20 s, prossimo run 06:40 e 1° del mese 07:00), POST /api/notify {urgency,title,body}. Axon li legge in tempo reale quando gli si chiede di invii, notifiche o fetcher.",
))


# ---------------------------------------------------------------------------- Risposta DETERMINISTICA (nessun LLM) quando l'utente chiede lo stato
_OPS_CMD_RE = re.compile(r"(outbox|fetcher|\bgme\b|message_id|msg_[a-z0-9_]+|stato\s+(degli\s+|dei\s+)?(invii|sistemi|job)|in\s+coda|riprov\w*\s+(l'|il\s+)?invio|(il\s+)?prompt\s+(è|e')\s+(arrivat|stato\s+inviat|partit))", re.I)
_ops_prev_push_cmd = _maybe_push_command


def _ops_line(it: dict) -> str:
    st = it.get("status"); t = f"«{(it.get('title') or '')[:48]}»"
    if st == "sent":
        q, s = _am_dt(it.get("timestamp_queued")), _am_dt(it.get("timestamp_sent"))
        secs = int((s - q).total_seconds()) if q and s else None
        return f"✅ {t} consegnato{f' in {secs}s' if secs is not None else ''} · `{it['message_id']}`"
    if st in ("pending", "retry"):
        return f"⚠️ {t} ancora in coda (attesa > 15s, riproviamo{' alle ' + it['next_retry'][11:16] if it.get('next_retry') else ''}) · `{it['message_id']}`"
    err = it.get("last_error") or "errore sconosciuto"
    return f"🔴 {t} errore invio: {err}{' — nuovo tentativo alle ' + it['next_retry'][11:16] if it.get('next_retry') else ''} · `{it['message_id']}`"


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    try:
        if msg and len(msg) <= 600 and _OPS_CMD_RE.search(msg):
            mid_m = re.search(r"\b(msg_[a-z0-9_]+)\b", msg, re.I)
            parts = ["📡 **Stato invii e fetcher GME** (dati live)"]
            if mid_m:
                one = await _ops_lookup(mid_m.group(1), user["user_id"])
                parts.append(_ops_line(one) if one else f"❔ `{mid_m.group(1)}`: message_id sconosciuto.")
            else:
                rec = await ops_outbox_recent(5, user)
                if not rec["push_configured"]:
                    parts.append("ℹ️ Servizio push non configurato in questo ambiente (anteprima/Expo Go): gli invii risultano in errore e partiranno sull'app pubblicata.")
                parts += [_ops_line(it) for it in rec["items"][:5]] or ["Nessun invio recente."]
                if rec["pending_in_outbox"]:
                    parts.append(f"⏳ In coda outbox: {rec['pending_in_outbox']} (retry automatico 1-2-5-10-30-60 min).")
            g = await _ops_gme_status()
            if g["status"] == "completed":
                parts.append(f"✅ Fetcher GME ok: ultimo run {_ops_age(g.get('last_run'))} in {g.get('duration_ms') or 0} ms, {g['files_downloaded']}/{g['files_found']} PDF, {g['months_in_cache']} mesi in cache, prossimo run {(g.get('next_run') or 'n/d')[:16].replace('T', ' ')}.")
            elif g["status"] == "running":
                parts.append(f"⏳ Fetcher GME in esecuzione (job {g.get('job_id')}), timeout {g['timeout_sec']}s.")
            elif g["status"] == "idle":
                parts.append(f"💤 Fetcher GME in attesa: {g['months_in_cache']} mesi in cache, prossimo run {(g.get('next_run') or 'n/d')[:16].replace('T', ' ')}, timeout {g['timeout_sec']}s.")
            else:
                last = (g.get("errors") or [{}])[-1].get("message", "")
                parts.append(f"⚠️ Fetcher GME in {g['status']} (timeout {g['timeout_sec']}s): {last[:120]} — ultimo successo {_ops_age(g.get('last_success'))}, ritento al prossimo run {(g.get('next_run') or 'n/d')[:16].replace('T', ' ')}.")
            return {"reply": "\n".join(parts), "cmd": "ops_status", "deterministic": True}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[ops-status] cmd failed: %s", exc)
    return await _ops_prev_push_cmd(msg, user)
