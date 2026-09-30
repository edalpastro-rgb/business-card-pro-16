# axon_system_awareness.py — V50.z200 — AxonOS «vede» il backend in tempo reale (modulo ISOLATO)
#
# Caricato DOPO axon_media.py e PRIMA di 37 (che fa include_router). Nessuna modifica al core.
# STATO PRIMA: Axon conosceva i DATI (omniscienza CRM) ma non il SISTEMA: non sapeva quale versione dell'app l'utente ha installato,
# quando è uscita una nuova build, quali novità contiene (CHANGELOG), quando il backend è stato riavviato/deployato, quali job girano,
# quali errori avvengono, cosa succede nelle API. STATO DOPO — quattro canali sempre attivi:
#   1) EVENTI BACKEND `axon_system_events`: middleware HTTP (ogni POST/PUT/DELETE/PATCH riuscito o fallito + ogni 5xx, con utente e tenant),
#      handler di logging (tutti i WARNING/ERROR di qualunque modulo, con dedupe), boot/deploy del backend (boot_id, versione CHANGELOG),
#      job dello scheduler, e `axs_event()` utilizzabile da chiunque. Retention 14 giorni.
#   2) VERSIONI CLIENT `axon_client_versions`: l'app invia un heartbeat (`POST /axon/system/heartbeat`: versione nativa APK/IPA, build,
#      versione JS, piattaforma, dispositivo). Prima volta che appare una versione nuova per l'utente → evento `client_update` + messaggio
#      proattivo di Axon (chat + push) «🚀 Hai aggiornato l'app alla vX: ecco le novità…» (mai più «non sapevo che avessi aggiornato»).
#   3) CHANGELOG: `/app/CHANGELOG.md` letto (cache su mtime) → versione backend corrente + ultime novità reali.
#   4) PROMPT: wrapper `_prepare_assistant_prompt` → sezione «🛰️ STATO SISTEMA IN TEMPO REALE» (versioni, uptime, novità, job, errori 24h,
#      ultimi eventi, integrazioni, push) con la regola: MAI dire di non avere visibilità su build/aggiornamenti/backend.
# Chat senza LLM (wrapper `_maybe_push_command`): «che versione ho?», «hai aggiornamenti?», «cosa c'è di nuovo?», «stato sistema»,
# «cosa è successo nel backend». API: `GET /axon/system/status`, `GET /axon/system/events`, `POST /axon/system/heartbeat`,
# `GET /axon/system/changelog`. Schermata `/axon-system` (Axon Hub → «🛰️ Stato sistema»).

import collections as _axs_collections
import logging as _axs_logging
import platform as _axs_platform
import time as _axs_time

_AXS_BOOT_ID = uuid.uuid4().hex[:10]
_AXS_STARTED_AT = utcnow()
_AXS_CHANGELOG_PATH = next((p for p in (os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "CHANGELOG.md"), "/app/CHANGELOG.md") if os.path.exists(p)), "/app/CHANGELOG.md")
_AXS_CHANGELOG_PATH = os.path.abspath(_AXS_CHANGELOG_PATH)
_AXS_RETENTION_DAYS = 14
_AXS_SKIP_PATHS = ("/api/axon/system/", "/api/assistant/chat", "/api/axon/push/", "/api/health", "/api/axon/proactive/items", "/api/auth/me", "/api/axon/notifications/", "/api/weather/", "/api/axon/quick-actions/preflight")
_AXS_LEVEL_ICON = {"info": "ℹ️", "warning": "⚠️", "error": "🛑", "deploy": "🚀", "client": "📱"}

_OMNI_EXTRA_SECTIONS.append((
    "Stato sistema AxonOS (visibilità backend in tempo reale)", "/axon-system",
    "Axon vede TUTTO ciò che accade nel backend: versione dell'app installata su ogni dispositivo dell'utente (heartbeat) e aggiornamenti "
    "rilevati automaticamente, versione/novità dal CHANGELOG, riavvii/deploy, job pianificati, errori, ogni azione API (chi ha fatto cosa e "
    "quando), stato push e integrazioni. Non ha bisogno che l'utente lo avvisi degli aggiornamenti dell'app.",
))
_APX_TYPE_LABELS["client_update"] = "App aggiornata"
_APX_DEFAULT_CONFIG["alerts"]["client_update"] = True

# ---------------------------------------------------------------------------- buffer eventi (thread-safe per il logging handler)
_AXS_PENDING: "_axs_collections.deque[dict]" = _axs_collections.deque(maxlen=500)
_AXS_LOG_DEDUPE: Dict[str, float] = {}
_AXS_TENANT_CACHE: Dict[str, str] = {}


def _axs_mk_event(source: str, level: str, title: str, detail: Optional[str] = None, user_id: Optional[str] = None, tenant_id_: Optional[str] = None, extra: Optional[dict] = None) -> dict:
    return {"event_id": f"axs_{uuid.uuid4().hex[:10]}", "ts": utcnow(), "source": source, "level": level, "title": str(title)[:200], "detail": (str(detail)[:1200] if detail else None),
            "user_id": user_id, "tenant_id": tenant_id_, "boot_id": _AXS_BOOT_ID, **(extra or {})}


def axs_event(source: str, level: str, title: str, detail: Optional[str] = None, user_id: Optional[str] = None, tenant_id_: Optional[str] = None, extra: Optional[dict] = None) -> None:
    """Registra un evento di sistema (sincrono, non blocca: scritto dal flush ogni 10 s)."""
    _AXS_PENDING.append(_axs_mk_event(source, level, title, detail, user_id, tenant_id_, extra))


async def _axs_flush() -> int:
    if not _AXS_PENDING:
        return 0
    batch = []
    while _AXS_PENDING and len(batch) < 500:
        batch.append(_AXS_PENDING.popleft())
    for ev in batch:   # tenant mancante → risolto dalla cache/db
        if ev.get("user_id") and not ev.get("tenant_id"):
            ev["tenant_id"] = await _axs_tenant_of(ev["user_id"])
    try:
        await db.axon_system_events.insert_many(batch, ordered=False)
    except Exception as exc:  # noqa: BLE001
        _axs_logging.getLogger("axs.silent").debug("flush failed: %s", exc)
    return len(batch)


async def _axs_tenant_of(uid: str) -> Optional[str]:
    if uid in _AXS_TENANT_CACHE:
        return _AXS_TENANT_CACHE[uid]
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "parent_user_id": 1, "user_id": 1})
    tid = (u or {}).get("parent_user_id") or uid
    _AXS_TENANT_CACHE[uid] = tid
    return tid


# ---------------------------------------------------------------------------- 1a) logging handler: WARNING/ERROR di tutti i moduli
class _AxsLogHandler(_axs_logging.Handler):
    def emit(self, record: _axs_logging.LogRecord) -> None:
        try:
            if record.levelno < _axs_logging.WARNING or record.name.startswith(("axs", "httpx", "httpcore", "apscheduler", "uvicorn.access")):
                return
            msg = record.getMessage()
            if "[axs]" in msg:
                return
            key = f"{record.name}:{msg[:80]}"
            now = _axs_time.time()
            if now - _AXS_LOG_DEDUPE.get(key, 0) < 60:      # stesso warning entro 60 s → una volta sola
                return
            _AXS_LOG_DEDUPE[key] = now
            if len(_AXS_LOG_DEDUPE) > 2000:
                _AXS_LOG_DEDUPE.clear()
            axs_event("log", "error" if record.levelno >= _axs_logging.ERROR else "warning", msg[:160], (msg + (f"\n{record.exc_text}" if record.exc_text else ""))[:1200], extra={"logger": record.name})
        except Exception:  # noqa: BLE001
            pass


_axs_logging.getLogger().addHandler(_AxsLogHandler())


# ---------------------------------------------------------------------------- 1b) middleware HTTP: ogni azione API (mutazioni) + ogni 5xx
def _axs_user_from_auth(auth: Optional[str]) -> Optional[str]:
    if not auth or not auth.startswith("Bearer "):
        return None
    try:
        return jwt.decode(auth.split(" ", 1)[1].strip(), JWT_SECRET, algorithms=[JWT_ALG]).get("sub")
    except Exception:  # noqa: BLE001
        return None


def _axs_path_label(path: str) -> str:
    p = path[5:] if path.startswith("/api/") else path
    return re.sub(r"/[0-9a-f]{8,}[0-9a-z_\-]*|/(user|c|apt|axe|axm|axs|apx|axi|kb|grp|ev|cb|bill|ctr)_[0-9a-z]+|/\d{3,}", "/{id}", p)


@app.middleware("http")
async def _axs_http_middleware(request, call_next):
    t0 = _axs_time.time()
    try:
        response = await call_next(request)
    except Exception as exc:  # noqa: BLE001
        path = request.url.path
        axs_event("api", "error", f"{request.method} {_axs_path_label(path)} → eccezione", str(exc)[:600], _axs_user_from_auth(request.headers.get("authorization")), extra={"method": request.method, "path": path, "status": 500})
        raise
    path = request.url.path
    if path.startswith("/api/") and not path.startswith(_AXS_SKIP_PATHS):
        status = response.status_code
        if request.method in ("POST", "PUT", "DELETE", "PATCH") or status >= 500:
            uid = _axs_user_from_auth(request.headers.get("authorization"))
            level = "error" if status >= 500 else ("warning" if status >= 400 else "info")
            axs_event("api", level, f"{request.method} {_axs_path_label(path)} → {status}", None, uid,
                      extra={"method": request.method, "path": path[:200], "status": status, "ms": int((_axs_time.time() - t0) * 1000)})
    return response


# ---------------------------------------------------------------------------- 3) CHANGELOG
_AXS_CL_CACHE: Dict[str, Any] = {"mtime": None, "rows": [], "version": None}
_AXS_CL_ROW_RE = re.compile(r"^\|\s*(V[\w.\-–]+|v[\w.\-–]+|Giu 2026[^|]*)\s*\|\s*([^|]*)\|\s*(.+?)\s*\|\s*$")


# V50.z359 — CHANGELOG DINAMICO: oltre alla tabella di CHANGELOG.md, Axon legge SEMPRE i titoli di versione del PRD
# (`## V50.zNNN (Mese Anno) — Titolo`), che l'agente aggiorna a ogni rilascio. Così le novità dell'app (Axon Lab, Compilazione
# CRT, Mercato, voce Kokoro…) entrano nel prompt di Axon appena esistono, anche se la tabella del CHANGELOG non è stata aggiornata.
_AXS_PRD_PATH = "/app/memory/PRD.md"
_AXS_PRD_HEAD_RE = re.compile(r"^##\s+(V[\w.\-–/]+)\s*(?:\(([^)]*)\))?\s*[—\-:]+\s*(.+?)\s*$")


def _axs_prd_rows() -> List[dict]:
    rows: List[dict] = []
    try:
        with open(_AXS_PRD_PATH, encoding="utf-8") as fh:
            for line in fh:
                m = _AXS_PRD_HEAD_RE.match(line.rstrip())
                if m:
                    desc = re.sub(r"\s*[—\-]+\s*(DONE|FATTO|COMPLETATO)\b.*$", "", m.group(3), flags=re.I).strip()
                    rows.append({"version": m.group(1).strip(), "date": (m.group(2) or "Giu 2026").strip(), "desc": desc, "src": "prd"})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axs] PRD read failed: %s", exc)
    return rows


def _axs_changelog() -> Dict[str, Any]:
    try:
        mt = os.path.getmtime(_AXS_CHANGELOG_PATH)
    except OSError:
        mt = 0.0
    try:
        mt_prd = os.path.getmtime(_AXS_PRD_PATH)
    except OSError:
        mt_prd = 0.0
    key = (mt, mt_prd)
    if _AXS_CL_CACHE.get("mtime") == key:
        return {"version": _AXS_CL_CACHE["version"], "rows": _AXS_CL_CACHE["rows"], "path": _AXS_CHANGELOG_PATH}
    rows: List[dict] = []
    try:
        with open(_AXS_CHANGELOG_PATH, encoding="utf-8") as fh:
            for line in fh:
                m = _AXS_CL_ROW_RE.match(line.strip())
                if m and not m.group(1).lower().startswith(("versione", "---")):
                    rows.append({"version": m.group(1).strip(), "date": m.group(2).strip(), "desc": m.group(3).strip()})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axs] changelog read failed: %s", exc)
    # Fusione con il PRD: le versioni presenti solo nel PRD vanno in testa (sono le più recenti), ordinate dalla più nuova
    known = {r["version"] for r in rows}
    prd_only = [r for r in _axs_prd_rows() if r["version"] not in known]
    rows = prd_only + rows

    def _vkey(r: dict) -> int:  # ordina per numero di versione (V50.z359 > V50.z347/z348 > …); righe storiche in fondo
        m = re.search(r"z(\d+)", r.get("version") or "")
        return int(m.group(1)) if m else -1
    rows.sort(key=_vkey, reverse=True)
    version = rows[0]["version"] if rows else None
    _AXS_CL_CACHE.update({"mtime": key, "rows": rows[:60], "version": version})
    return {"version": version, "rows": rows[:60], "path": _AXS_CHANGELOG_PATH}


# ---------------------------------------------------------------------------- 2) heartbeat client (versione app installata)
class AxsHeartbeatIn(BaseModel):
    device_key: str
    platform: str
    app_version: Optional[str] = None        # versione nativa (APK/IPA): es. 1.0.60
    build_number: Optional[str] = None       # versionCode / buildNumber
    js_version: Optional[str] = None         # app.json version (bundle JS)
    device_name: Optional[str] = None
    os_version: Optional[str] = None
    expo_sdk: Optional[str] = None
    app_env: Optional[str] = None            # expo-go | standalone | web


def _axs_ver_label(d: dict) -> str:
    v = d.get("app_version") or d.get("js_version") or "?"
    return f"{v}" + (f" (build {d['build_number']})" if d.get("build_number") else "")


@api_router.post("/axon/system/heartbeat")
async def axs_heartbeat(body: AxsHeartbeatIn, user=Depends(get_current_user)):
    uid = user["user_id"]; tid = tenant_id(user); now = utcnow()
    prev = await db.axon_client_versions.find_one({"user_id": uid, "device_key": body.device_key}, {"_id": 0})
    known = await db.axon_client_versions.distinct("app_version", {"user_id": uid, "app_version": {"$ne": None}})
    doc = {"user_id": uid, "tenant_id": tid, "device_key": body.device_key, "platform": body.platform, "app_version": body.app_version, "build_number": body.build_number,
           "js_version": body.js_version, "device_name": body.device_name, "os_version": body.os_version, "expo_sdk": body.expo_sdk, "app_env": body.app_env,
           "last_seen": now, "first_seen": (prev or {}).get("first_seen") or now}
    if prev and (prev.get("app_version") != body.app_version or prev.get("build_number") != body.build_number):
        doc["previous_version"] = _axs_ver_label(prev); doc["updated_at"] = now
    await db.axon_client_versions.update_one({"user_id": uid, "device_key": body.device_key}, {"$set": doc}, upsert=True)
    is_new_version = bool(body.app_version) and body.app_version not in known and (prev is not None or bool(known))
    changed_device = prev is not None and (prev.get("app_version") != body.app_version or prev.get("build_number") != body.build_number)
    if changed_device or is_new_version:
        cl = _axs_changelog()
        news = "\n".join(f"• {r['version']}: {r['desc'][:150]}" for r in cl["rows"][:5]) or "(changelog non disponibile)"
        prev_lbl = _axs_ver_label(prev) if prev else (known[-1] if known else "?")
        axs_event("client", "deploy", f"App aggiornata: {prev_lbl} → {_axs_ver_label(doc)} ({body.platform}, {body.device_name or 'dispositivo'})", None, uid, tid, {"app_version": body.app_version, "previous_version": prev_lbl})
        try:
            cfg = await _apx_config(uid)
            if cfg["alerts"].get("client_update", True):
                await _apx_emit(user, "alert", "client_update", f"🚀 App aggiornata alla {_axs_ver_label(doc)}", f"Rilevata in autonomia sul tuo {body.device_name or body.platform}. Backend {cl['version'] or ''}.",
                                f"🚀 **Ho rilevato da solo che hai aggiornato l'app**: {prev_lbl} → **{_axs_ver_label(doc)}** su {body.device_name or body.platform} ({now.strftime('%d/%m %H:%M')}). "
                                f"Backend attuale: {cl['version'] or 'n/d'}.\n\n**Ultime novità dal CHANGELOG:**\n{news}\n\nLe ho già integrate nei miei flussi: chiedimi pure come usarle.",
                                f"client_update:{uid}:{body.app_version}:{body.build_number}", [{"label": "Cosa c'è di nuovo?", "prompt": "Spiegami le novità dell'ultimo aggiornamento dell'app e come usarle"}], "heartbeat")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[axs] client_update emit failed: %s", exc)
    elif prev is None:
        axs_event("client", "client", f"Nuovo dispositivo: {body.device_name or body.platform} · app {_axs_ver_label(doc)}", None, uid, tid, {"app_version": body.app_version})
    return {"ok": True, "version": _axs_ver_label(doc), "backend_version": _axs_changelog()["version"], "new_version_detected": bool(changed_device or is_new_version)}


# ---------------------------------------------------------------------------- STATUS / EVENTS
async def _axs_status(user: dict, events_limit: int = 30) -> dict:
    uid = user["user_id"]; tid = tenant_id(user); now = utcnow(); cl = _axs_changelog()
    devices = [_axs_out_dt(d) async for d in db.axon_client_versions.find({"user_id": uid}, {"_id": 0}).sort("last_seen", -1).limit(10)]
    team_devices = []
    if is_admin_or_owner(user):
        async for d in db.axon_client_versions.find({"tenant_id": tid, "user_id": {"$ne": uid}}, {"_id": 0, "user_id": 1, "app_version": 1, "build_number": 1, "platform": 1, "device_name": 1, "last_seen": 1}).sort("last_seen", -1).limit(30):
            team_devices.append(_axs_out_dt(d))
    ev_filter = {"$or": [{"tenant_id": tid}, {"tenant_id": None, "source": {"$in": ["deploy", "scheduler", "log"]}}]}
    if not is_admin_or_owner(user):
        ev_filter = {"$or": [{"user_id": uid}, {"tenant_id": None, "source": {"$in": ["deploy", "scheduler"]}}]}
    events = [_axs_out_dt(e) async for e in db.axon_system_events.find(ev_filter, {"_id": 0}).sort("ts", -1).limit(events_limit)]
    since = now - timedelta(hours=24)
    errors_24h = await db.axon_system_events.count_documents({"level": "error", "ts": {"$gte": since}, **({} if is_admin_or_owner(user) else {"user_id": uid})})
    warnings_24h = await db.axon_system_events.count_documents({"level": "warning", "ts": {"$gte": since}, **({} if is_admin_or_owner(user) else {"user_id": uid})})
    api_24h = await db.axon_system_events.count_documents({"source": "api", "tenant_id": tid, "ts": {"$gte": since}})
    jobs = []
    try:
        for j in _axn_scheduler.get_jobs():
            nr = getattr(j, "next_run_time", None)
            jobs.append({"id": j.id, "next_run": nr.isoformat() if nr else None})
        jobs.sort(key=lambda x: x["next_run"] or "9")
    except Exception:  # noqa: BLE001
        pass
    integ = {}
    try:
        integ = {"google_drive": bool(await db.google_drive_connections.find_one({"user_id": uid}, {"_id": 1})), "dropbox": bool(await db.dropbox_connections.find_one({"user_id": uid}, {"_id": 1})),
                 "google_business": bool(await db.axon_integrations.find_one({"user_id": uid, "sphere": "business", "provider": "google"}, {"_id": 1})),
                 "google_home": bool(await db.axon_integrations.find_one({"user_id": uid, "sphere": "home", "provider": "google"}, {"_id": 1})),
                 "homeassistant": bool(await db.homeassistant_configs.find_one({"user_id": tid}, {"_id": 1}))}
    except Exception:  # noqa: BLE001
        pass
    push_dev = await db.push_devices.count_documents({"user_id": uid})
    uptime_s = int((now - _AXS_STARTED_AT).total_seconds())
    return {"now": now.isoformat(), "backend": {"version": cl["version"], "boot_id": _AXS_BOOT_ID, "started_at": _AXS_STARTED_AT.isoformat(), "uptime_sec": uptime_s,
                                                  "uptime_label": f"{uptime_s // 86400}g {uptime_s % 86400 // 3600}h {uptime_s % 3600 // 60}m", "python": _axs_platform.python_version(),
                                                  "llm_key": bool(os.environ.get("EMERGENT_LLM_KEY")), "push_configured": bool(os.environ.get("EMERGENT_PUSH_KEY")) and os.environ.get("EMERGENT_PUSH_KEY") != "placeholder",
                                                  "modules": len(__import__("routes").MODULES)},
            "changelog": cl["rows"][:10], "devices": devices, "team_devices": team_devices, "events": events, "counters": {"errors_24h": errors_24h, "warnings_24h": warnings_24h, "api_actions_24h": api_24h},
            "jobs": jobs[:20], "integrations": integ, "push_devices": push_dev}


def _axs_out_dt(d: dict) -> dict:
    d = dict(d); d.pop("_id", None)
    for k, v in list(d.items()):
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


@api_router.get("/axon/system/status")
async def axs_status(user=Depends(get_current_user)):
    await _axs_flush()
    return await _axs_status(user)


@api_router.get("/axon/system/events")
async def axs_events(level: Optional[str] = None, source: Optional[str] = None, limit: int = 100, user=Depends(get_current_user)):
    await _axs_flush()
    uid = user["user_id"]; tid = tenant_id(user)
    f: Dict[str, Any] = {"$or": [{"tenant_id": tid}, {"tenant_id": None}]} if is_admin_or_owner(user) else {"$or": [{"user_id": uid}, {"tenant_id": None, "source": {"$in": ["deploy", "scheduler"]}}]}
    if level: f["level"] = level
    if source: f["source"] = source
    items = [_axs_out_dt(e) async for e in db.axon_system_events.find(f, {"_id": 0}).sort("ts", -1).limit(max(1, min(limit, 300)))]
    return {"items": items}


@api_router.get("/axon/system/changelog")
async def axs_changelog(limit: int = 30, user=Depends(get_current_user)):
    cl = _axs_changelog()
    return {"version": cl["version"], "rows": cl["rows"][:max(1, min(limit, 60))]}


# ---------------------------------------------------------------------------- 4) PROMPT: sezione stato sistema
def _axs_fmt_event(e: dict) -> str:
    ts = (e.get("ts") or "")[:16].replace("T", " ")
    who = f" [{e['user_id'][-6:]}]" if e.get("user_id") else ""
    return f"{_AXS_LEVEL_ICON.get(e.get('level'), '•')} {ts}{who} {e.get('title')}"


async def _axs_context_section(user: dict) -> str:
    st = await _axs_status(user, events_limit=18)
    b = st["backend"]
    lines = ["🛰️ STATO SISTEMA IN TEMPO REALE — Axon ha ACCESSO COMPLETO al backend: versioni installate, aggiornamenti dell'app rilevati in autonomia (heartbeat), CHANGELOG, riavvii, job, errori, ogni azione API. "
             "REGOLA: NON dire MAI «non ho visibilità su build/aggiornamenti/backend» o «devi avvisarmi tu»: usa questi dati. Se manca un heartbeat recente di un dispositivo dillo esplicitamente (ultimo visto).",
             f"Backend: versione {b['version'] or 'n/d'} · avviato {b['started_at'][:16].replace('T', ' ')} UTC (uptime {b['uptime_label']}, boot {b['boot_id']}) · {b['modules']} moduli · LLM key {'ok' if b['llm_key'] else 'ASSENTE'} · push service {'configurato' if b['push_configured'] else 'non configurato in questo ambiente (attivo solo sull app pubblicata)'} · dispositivi push registrati: {st['push_devices']}.",
             f"Ultime 24h: {st['counters']['errors_24h']} errori · {st['counters']['warnings_24h']} warning · {st['counters']['api_actions_24h']} azioni API nel tenant."]
    if st["changelog"]:
        lines.append("ULTIME NOVITÀ RILASCIATE (CHANGELOG dinamico backend+PRD, dalla più recente) — se l'utente chiede novità/versioni/cosa c'è di nuovo, ELENCA QUESTE righe testualmente (mai dire di non avere accesso allo storico). "
                     "⛔ Le UNICHE versioni esistenti sono queste, nel formato V50.zNNN: IGNORA qualsiasi altra numerazione (es. «v3.8.x», «v2.x») o novità che ricordi da conversazioni precedenti o dalla memoria — sarebbero inventate. "
                     + " | ".join(f"{r['version']} ({r['date']}): {r['desc'][:170]}" for r in st["changelog"][:10]))
    if st["devices"]:
        lines.append("App installata sui dispositivi dell'utente: " + "; ".join(f"{d.get('device_name') or d.get('platform')} ({d.get('platform')}, {d.get('app_env') or ''}) v{_axs_ver_label(d)} · JS {d.get('js_version') or '?'} · ultimo heartbeat {(d.get('last_seen') or '')[:16].replace('T', ' ')}" + (f" · aggiornata da {d['previous_version']}" if d.get("previous_version") else "") for d in st["devices"]))
    else:
        lines.append("Nessun heartbeat ricevuto ancora da un'app installata (l'app invia versione e dispositivo all'avvio: se l'utente usa il web non c'è versione nativa).")
    if st["team_devices"]:
        lines.append("Dispositivi del team: " + "; ".join(f"{d.get('user_id', '')[-6:]} {d.get('platform')} v{_axs_ver_label(d)} ({(d.get('last_seen') or '')[:10]})" for d in st["team_devices"][:10]))
    if st["jobs"]:
        lines.append("Job pianificati (prossime esecuzioni UTC): " + ", ".join(f"{j['id']}@{(j['next_run'] or '')[11:16]}" for j in st["jobs"][:12]))
    integ = st["integrations"]
    if integ:
        lines.append("Integrazioni: " + ", ".join(f"{k}={'✓' if v else '✗'}" for k, v in integ.items()))
    if st["events"]:
        lines.append("ULTIMI EVENTI BACKEND (più recenti prima):\n" + "\n".join(_axs_fmt_event(e) for e in st["events"]))
    return "\n".join(lines)[:8000]


_axs_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _axs_prev_prepare_prompt(user, body)
    if isinstance(prep, dict) and prep.get("query_class") == "simple":
        return prep  # V50.z413 — domanda semplice (ora/meteo/saluti/domotica): nessuna sezione extra nel prompt
    try:
        await _axs_flush()
        sec = await _axs_context_section(user)
        if sec and prep.get("system_message"):
            prep["system_message"] = f"{prep['system_message']}\n\n{sec}"
            logger.info("[axs] sezione stato aggiunta (%d car., changelog=%s, prompt totale %d car.)", len(sec), "ULTIME NOVITÀ" in sec, len(prep["system_message"]))
        else:
            logger.warning("[axs] sezione stato NON aggiunta: sec=%d keys=%s", len(sec or ""), list(prep.keys())[:8])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axs] context failed: %s", exc)
    return prep


# ---------------------------------------------------------------------------- CHAT senza LLM
_AXS_CHAT_RE = re.compile(r"\b(che|quale) versione\b|\bhai (degli |nuovi |novità o )?aggiornament|\bnovit[àa] (dell'|della |dell )?app\b|\bcosa c'?[èe] di nuovo\b|\bstato (del |di )?sistema\b|\b(cosa|che cosa|che) (è |e' )?(successo|accaduto) (nel|sul|in) backend\b|\blog (di )?sistema\b|\bultimi eventi (backend|di sistema)\b", re.IGNORECASE)
_axs_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").strip()
    try:
        if txt and len(txt) <= 60 and _AXS_CHAT_RE.search(txt):
            await _axs_flush()
            st = await _axs_status(user, events_limit=10)
            b = st["backend"]
            dev = "\n".join(f"• {d.get('device_name') or d.get('platform')} ({d.get('platform')}): **v{_axs_ver_label(d)}** · visto {(d.get('last_seen') or '')[:16].replace('T', ' ')}" + (f" · aggiornata da {d['previous_version']}" if d.get("previous_version") else "") for d in st["devices"]) or "• nessun heartbeat ricevuto da un'app installata (da web non c'è versione nativa)"
            news = "\n".join(f"• **{r['version']}** ({r['date']}): {r['desc'][:160]}" for r in st["changelog"][:6])
            if re.search(r"\bstato\b|\bbackend\b|\blog\b|\beventi\b", txt, re.IGNORECASE):
                evs = "\n".join(_axs_fmt_event(e) for e in st["events"][:10]) or "nessun evento"
                reply = (f"🛰️ **Stato sistema** — backend **{b['version'] or 'n/d'}**, uptime {b['uptime_label']} (avvio {b['started_at'][:16].replace('T', ' ')} UTC) · ultime 24h: {st['counters']['errors_24h']} errori, {st['counters']['warnings_24h']} warning, {st['counters']['api_actions_24h']} azioni API.\n"
                         f"Push: {'configurato' if b['push_configured'] else 'non configurato qui (attivo sull app pubblicata)'} · dispositivi push {st['push_devices']} · integrazioni: {', '.join(k for k, v in st['integrations'].items() if v) or 'nessuna'}.\n\n**App installata:**\n{dev}\n\n**Ultimi eventi backend:**\n{evs}\n\nDettagli in *Axon Hub → Stato sistema*.")
            else:
                reply = f"🚀 **Aggiornamenti** — backend **{b['version'] or 'n/d'}** (uptime {b['uptime_label']}).\n\n**App installata sui tuoi dispositivi:**\n{dev}\n\n**Ultime novità (CHANGELOG):**\n{news}\n\nVedo gli aggiornamenti da solo tramite l'heartbeat dell'app: non serve che mi avvisi."
            return {"reply": reply, "cmd": "system_status"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axs] chat failed: %s", exc)
    return await _axs_prev_maybe_push_command(msg, user)


# ---------------------------------------------------------------------------- scheduler hooks + startup
async def _axs_cleanup() -> None:
    try:
        r = await db.axon_system_events.delete_many({"ts": {"$lt": utcnow() - timedelta(days=_AXS_RETENTION_DAYS)}})
        if r.deleted_count:
            axs_event("scheduler", "info", f"Pulizia eventi di sistema: {r.deleted_count} rimossi (> {_AXS_RETENTION_DAYS} gg)")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axs] cleanup failed: %s", exc)


def _axs_job_listener(event) -> None:
    try:
        if getattr(event, "exception", None):
            axs_event("scheduler", "error", f"Job {event.job_id} fallito", str(event.exception)[:600])
        elif event.job_id in ("axi-sync-tick", "axm-remind-tick", "axs-cleanup") or "briefing" in event.job_id or "weekly" in event.job_id:
            axs_event("scheduler", "info", f"Job {event.job_id} eseguito")
    except Exception:  # noqa: BLE001
        pass


@app.on_event("startup")
async def _axs_start():
    try:
        await db.axon_system_events.create_index([("ts", -1)])
        await db.axon_system_events.create_index([("tenant_id", 1), ("ts", -1)])
        await db.axon_system_events.create_index([("level", 1), ("ts", -1)])
        await db.axon_client_versions.create_index([("user_id", 1), ("device_key", 1)], unique=True)
        cl = _axs_changelog()
        prev_boot = await db.axon_backend_meta.find_one({"key": "boot"}, {"_id": 0})
        await db.axon_backend_meta.update_one({"key": "boot"}, {"$set": {"key": "boot", "boot_id": _AXS_BOOT_ID, "started_at": _AXS_STARTED_AT, "version": cl["version"], "python": _axs_platform.python_version()}}, upsert=True)
        what = "Deploy/riavvio backend" if prev_boot else "Primo avvio backend"
        ver_chg = f" · versione {prev_boot.get('version')} → {cl['version']}" if prev_boot and prev_boot.get("version") != cl["version"] else f" · versione {cl['version']}"
        axs_event("deploy", "deploy", f"{what}{ver_chg}", f"boot {_AXS_BOOT_ID}, {len(__import__('routes').MODULES)} moduli, Python {_axs_platform.python_version()}")
        _axn_scheduler.add_job(_axs_flush, "interval", seconds=10, id="axs-flush", replace_existing=True)
        _axn_scheduler.add_job(_axs_cleanup, "interval", hours=24, id="axs-cleanup", replace_existing=True)
        try:
            from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR  # type: ignore
            _axn_scheduler.add_listener(_axs_job_listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[axs] listener failed: %s", exc)
        logger.info("[axs] system awareness armed (backend %s, boot %s)", cl["version"], _AXS_BOOT_ID)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axs] start failed: %s", exc)
