# axon_watchdog.py — V50.z469 — Feature 8/15: Watchdog Axon (lato FastAPI) — modulo ISOLATO
#
# Tre livelli di protezione, tutti con lo stesso messaggio utente «Axon si sta riprendendo, torno subito…»:
# 1) LLM FIRST-TOKEN WATCHDOG (`_wd_llm_stream`, usato dallo streaming SSE in 22): se il modello non produce il primo token
#    entro 10 s → evento SSE `progress {stage: recovering}` + nuova sessione LLM e secondo tentativo (timeout 30 s). Se fallisce
#    anche il secondo → eccezione → risposta amichevole offline (V50.z467). Ogni scatto è un incidente in `axon_watchdog_log`.
# 2) EVENT-LOOP WATCHDOG (thread): una coroutine aggiorna un heartbeat ogni 2 s; un thread separato controlla che non sia più
#    vecchio di 10 s. Loop bloccato (CPU sync, deadlock) → log + `os._exit(3)` → docker (`restart: unless-stopped`) / supervisor
#    (`autorestart=true`) riavviano il servizio in pochi secondi: è il «riavvio automatico» richiesto.
# 3) RECOVER SU RICHIESTA (`POST /axon/watchdog/recover`): l'app lo chiama quando non riceve NULLA per 10 s. Soft recovery
#    (gc, reset cache semantica in RAM se presente, incidente registrato); se gli incidenti sono ≥ 3 in 2 minuti → riavvio
#    programmato del processo (hard) dopo aver risposto. `GET /axon/watchdog/status` per diagnostica (Master).

import asyncio as _wd_asyncio
import gc as _wd_gc
import json as _wd_json
import os as _wd_os
import threading as _wd_threading
import time as _wd_time

_WD_FIRST_TOKEN_S = float(_wd_os.environ.get("AXON_WATCHDOG_FIRST_TOKEN_S") or 10.0)
_WD_RETRY_TOKEN_S = 30.0
_WD_LOOP_STALL_S = float(_wd_os.environ.get("AXON_WATCHDOG_LOOP_STALL_S") or 15.0)
_WD_HARD_RESTART_INCIDENTS = 3
_WD_HARD_RESTART_WINDOW_S = 120
_WD_USER_MSG = "Axon si sta riprendendo, torno subito…"
_wd_state = {"heartbeat": _wd_time.time(), "started": _wd_time.time(), "incidents": [], "restart_scheduled": False, "loop_stalls": 0}


async def _wd_incident(kind: str, detail: str = "", user_id: Optional[str] = None) -> int:
    now = _wd_time.time()
    _wd_state["incidents"] = [t for t in _wd_state["incidents"] if now - t < _WD_HARD_RESTART_WINDOW_S] + [now]
    try:
        await db.axon_watchdog_log.insert_one({"kind": kind, "detail": (detail or "")[:400], "user_id": user_id, "at": utcnow(), "pid": _wd_os.getpid()})
    except Exception:  # noqa: BLE001
        pass
    logger.warning("[watchdog] incident %s %s (recent=%s)", kind, detail[:120], len(_wd_state["incidents"]))
    return len(_wd_state["incidents"])


def _wd_schedule_hard_restart(reason: str, delay: float = 1.5) -> None:
    if _wd_state["restart_scheduled"]:
        return
    _wd_state["restart_scheduled"] = True
    logger.error("[watchdog] HARD RESTART scheduled in %.1fs — %s", delay, reason)
    try:  # V50.z496 — marker su file: al riavvio axon_critical_events.py lo trasforma in ALLARME PRIORITARIO per il Super Master
        with open("/tmp/axon_watchdog_restart.json", "w", encoding="utf-8") as _f:
            _f.write(_wd_json.dumps({"reason": reason, "at": _wd_time.time()}))
    except Exception:  # noqa: BLE001
        pass

    def _die():
        _wd_time.sleep(delay)
        logger.error("[watchdog] exiting process for automatic restart (%s)", reason)
        _wd_os._exit(3)
    _wd_threading.Thread(target=_die, daemon=True, name="axon-watchdog-restart").start()


async def _wd_llm_stream(make_chat, text: str, first_timeout: float = _WD_FIRST_TOKEN_S, user_id: Optional[str] = None):
    """Async generator: yield ("recovering", None) al primo timeout, poi ("event", ev) per ogni evento LLM.
    `make_chat()` deve restituire un LlmChat NUOVO ad ogni chiamata (sessione pulita per il retry)."""
    from emergentintegrations.llm.chat import UserMessage  # import locale come in 22 (non è un globale del server)
    for attempt in range(2):
        chat = make_chat()
        agen = chat.stream_message(UserMessage(text=text)).__aiter__()
        timeout = first_timeout if attempt == 0 else _WD_RETRY_TOKEN_S
        try:
            first = await _wd_asyncio.wait_for(agen.__anext__(), timeout=timeout)
        except _wd_asyncio.TimeoutError:
            try:
                await agen.aclose()
            except Exception:  # noqa: BLE001
                pass
            n = await _wd_incident("llm_first_token_timeout", f"attempt={attempt + 1} timeout={timeout}s", user_id)
            if attempt == 0:
                yield ("recovering", None)
                continue
            if n >= _WD_HARD_RESTART_INCIDENTS:
                _wd_schedule_hard_restart(f"{n} LLM timeouts in {_WD_HARD_RESTART_WINDOW_S}s", delay=3.0)
            raise TimeoutError("Axon non ha risposto in tempo (watchdog)")
        except StopAsyncIteration:
            return
        yield ("event", first)
        async for ev in agen:
            yield ("event", ev)
        return


class WdRecoverIn(BaseModel):
    reason: Optional[str] = None
    elapsed_ms: Optional[int] = None


@api_router.post("/axon/watchdog/recover")
async def wd_recover(body: WdRecoverIn, user=Depends(get_current_user)):
    """Chiamato dall'app quando Axon non dà segni di vita per 10 s: soft recovery subito, hard restart se il problema persiste."""
    n = await _wd_incident("client_silence", f"{body.reason or ''} {body.elapsed_ms or ''}ms", user.get("user_id"))
    _wd_gc.collect()
    try:
        g = globals()
        for name in ("_semantic_cache_mem", "_sem_cache_mem", "_SEM_CACHE"):
            if isinstance(g.get(name), dict):
                g[name].clear()
    except Exception:  # noqa: BLE001
        pass
    action = "soft"
    if n >= _WD_HARD_RESTART_INCIDENTS:
        action = "restart"
        _wd_schedule_hard_restart(f"{n} client-silence incidents in {_WD_HARD_RESTART_WINDOW_S}s")
    return {"ok": True, "action": action, "message": _WD_USER_MSG, "incidents_recent": n}


@api_router.get("/axon/watchdog/status")
async def wd_status(user=Depends(get_current_user)):
    now = _wd_time.time()
    recent = await db.axon_watchdog_log.find({}, {"_id": 0}).sort("at", -1).to_list(20)
    for r in recent:
        if isinstance(r.get("at"), datetime):
            r["at"] = r["at"].isoformat()
    return {"pid": _wd_os.getpid(), "uptime_s": int(now - _wd_state["started"]), "heartbeat_age_s": round(now - _wd_state["heartbeat"], 2),
            "first_token_timeout_s": _WD_FIRST_TOKEN_S, "loop_stall_threshold_s": _WD_LOOP_STALL_S, "loop_stalls": _wd_state["loop_stalls"],
            "incidents_recent": len([t for t in _wd_state["incidents"] if now - t < _WD_HARD_RESTART_WINDOW_S]), "restart_scheduled": _wd_state["restart_scheduled"],
            "recent": recent if (is_owner(user) if "is_owner" in globals() else True) else []}


async def _wd_heartbeat_loop():
    while True:
        _wd_state["heartbeat"] = _wd_time.time()
        await _wd_asyncio.sleep(2)


def _wd_monitor_thread():
    """Thread indipendente dall'event loop: se il loop è bloccato da più di `_WD_LOOP_STALL_S` → riavvio automatico del processo."""
    while True:
        _wd_time.sleep(2)
        age = _wd_time.time() - _wd_state["heartbeat"]
        if age > _WD_LOOP_STALL_S:
            _wd_state["loop_stalls"] += 1
            logger.error("[watchdog] event loop stalled for %.1fs → automatic restart", age)
            _wd_schedule_hard_restart(f"event loop stalled {age:.1f}s", delay=0.5)
            return


@app.on_event("startup")
async def _wd_start():
    try:
        await db.axon_watchdog_log.create_index([("at", -1)])
        _wd_state["heartbeat"] = _wd_time.time()
        _wd_asyncio.create_task(_wd_heartbeat_loop())
        if not _wd_os.environ.get("AXON_WATCHDOG_DISABLE"):
            _wd_threading.Thread(target=_wd_monitor_thread, daemon=True, name="axon-watchdog").start()
        logger.info("[watchdog] armed: first-token %.0fs · loop-stall %.0fs · hard restart after %s incidents/%ss", _WD_FIRST_TOKEN_S, _WD_LOOP_STALL_S, _WD_HARD_RESTART_INCIDENTS, _WD_HARD_RESTART_WINDOW_S)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[watchdog] start failed: %s", exc)


_OMNI_EXTRA_SECTIONS.append((
    "Watchdog Axon (auto-ripristino)", "/axon/watchdog/status",
    "Se Axon non risponde entro 10 secondi il sistema si auto-ripristina (nuova sessione con il modello, riavvio del servizio se il blocco persiste) e "
    "l'app mostra «Axon si sta riprendendo, torno subito…» riprendendo poi la chat. Il Master può vedere gli incidenti con «stato watchdog».",
))
