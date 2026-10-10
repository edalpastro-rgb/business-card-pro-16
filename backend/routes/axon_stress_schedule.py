# axon_stress_schedule.py — V50.z509 — CALENDARIO STRESS TEST: i test di Axon si programmano come appuntamenti ricorrenti
# (una volta sola · settimanale · mensile · personalizzata) al posto della pianificazione notturna fissa (ora disattivata di default).
# Collezione db.axon_stress_schedules: {schedule_id, user_id, title, kind: once|weekly|monthly|custom, time 'HH:MM' (Europe/Rome),
#   once_date 'YYYY-MM-DD', weekdays [0=lun..6=dom], month_day 1..31 (31 = ultimo giorno), interval_days N, mode quick|full, reps,
#   enabled, next_run_at (UTC), last_run_at, last_run_id, created_at}
# Tick ogni minuto (APScheduler già attivo): schedule abilitate con next_run_at <= adesso → avvia un run «nightly» (stesso motore,
# stesso verdetto, stessa autocorrezione e notifica riepilogativa) → aggiorna last_run e next_run (once → disabilitata dopo l'esecuzione).
# Endpoint (owner): GET/POST /axon/stress/schedules · PUT/DELETE /axon/stress/schedules/{id} · POST /axon/stress/schedules/{id}/run-now
#   · GET /axon/stress/schedules/upcoming?days=60 (occorrenze future per la vista calendario).
from calendar import monthrange as _ss_monthrange
from datetime import datetime as _ss_dt, timedelta as _ss_td, timezone as _ss_tz
from typing import List as _ss_List, Optional as _ss_Optional
from zoneinfo import ZoneInfo as _ss_ZoneInfo

_SS_ROME = _ss_ZoneInfo("Europe/Rome")
_SS_KINDS = ("once", "weekly", "monthly", "custom")

_ST_NIGHTLY_DEFAULT["enabled"] = False  # noqa: F821 — il test notturno quotidiano fisso è DISATTIVATO di default: si usa il calendario


class StressScheduleIn(BaseModel):  # noqa: F821
    title: _ss_Optional[str] = None
    kind: str = "weekly"
    time: str = "03:00"
    once_date: _ss_Optional[str] = None
    weekdays: _ss_Optional[_ss_List[int]] = None
    month_day: _ss_Optional[int] = None
    interval_days: _ss_Optional[int] = None
    mode: _ss_Optional[str] = None
    reps: _ss_Optional[int] = None
    enabled: _ss_Optional[bool] = None


def _ss_parse_time(t: str) -> tuple:
    try:
        h, m = (int(x) for x in (t or "03:00").split(":")[:2])
        return max(0, min(23, h)), max(0, min(59, m))
    except Exception:
        return 3, 0


def _ss_next_run(s: dict, after: _ss_Optional[_ss_dt] = None) -> _ss_Optional[_ss_dt]:
    """Prossima occorrenza (UTC) strettamente successiva ad `after` (default adesso), calcolata in Europe/Rome."""
    now = (after or utcnow()).astimezone(_SS_ROME)  # noqa: F821
    h, m = _ss_parse_time(s.get("time"))
    kind = s.get("kind")
    if kind == "once":
        try:
            y, mo, d = (int(x) for x in (s.get("once_date") or "").split("-"))
            cand = _ss_dt(y, mo, d, h, m, tzinfo=_SS_ROME)
        except Exception:
            return None
        return cand.astimezone(_ss_tz.utc) if cand > now else None
    if kind == "weekly" or (kind == "custom" and s.get("weekdays")):
        days = sorted({int(x) for x in (s.get("weekdays") or []) if 0 <= int(x) <= 6}) or [0]
        for off in range(0, 15):
            d = (now + _ss_td(days=off)).replace(hour=h, minute=m, second=0, microsecond=0)
            if d.weekday() in days and d > now:
                return d.astimezone(_ss_tz.utc)
        return None
    if kind == "monthly":
        md = int(s.get("month_day") or 1)
        for k in range(0, 14):
            y, mo = now.year + (now.month - 1 + k) // 12, (now.month - 1 + k) % 12 + 1
            last = _ss_monthrange(y, mo)[1]
            d = _ss_dt(y, mo, min(md, last), h, m, tzinfo=_SS_ROME)
            if d > now:
                return d.astimezone(_ss_tz.utc)
        return None
    if kind == "custom":
        n = max(1, int(s.get("interval_days") or 1))
        base = s.get("last_run_at") or s.get("created_at") or utcnow()  # noqa: F821
        base = (base.replace(tzinfo=_ss_tz.utc) if base.tzinfo is None else base).astimezone(_SS_ROME).replace(hour=h, minute=m, second=0, microsecond=0)
        d = base
        while d <= now:
            d += _ss_td(days=n)
        return d.astimezone(_ss_tz.utc)
    return None


def _ss_label(s: dict) -> str:
    wd = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"]
    k = s.get("kind")
    if k == "once":
        try:
            y, mo, d = s["once_date"].split("-"); return f"Una volta: {d}/{mo}/{y} alle {s.get('time')}"
        except Exception:
            return f"Una volta alle {s.get('time')}"
    if k == "weekly":
        return "Ogni " + ", ".join(wd[int(x)] for x in sorted(s.get("weekdays") or [0])) + f" alle {s.get('time')}"
    if k == "monthly":
        md = int(s.get("month_day") or 1)
        return ("L'ultimo giorno del mese" if md >= 31 else f"Il giorno {md} di ogni mese") + f" alle {s.get('time')}"
    if s.get("weekdays"):
        return "Personalizzata: " + ", ".join(wd[int(x)] for x in sorted(s["weekdays"])) + f" alle {s.get('time')}"
    return f"Ogni {int(s.get('interval_days') or 1)} giorni alle {s.get('time')}"


def _ss_out(s: dict) -> dict:
    o = {k: v for k, v in s.items() if k != "_id"}
    o["label"] = _ss_label(s)
    for k in ("next_run_at", "last_run_at", "created_at"):
        if isinstance(o.get(k), _ss_dt):
            o[k] = (o[k].replace(tzinfo=_ss_tz.utc) if o[k].tzinfo is None else o[k]).isoformat()
    return o


def _ss_validate(body: StressScheduleIn, base: _ss_Optional[dict] = None) -> dict:
    s = dict(base or {})
    data = body.model_dump(exclude_none=True)
    s.update(data)
    s["kind"] = s.get("kind") if s.get("kind") in _SS_KINDS else "weekly"
    h, m = _ss_parse_time(s.get("time")); s["time"] = f"{h:02d}:{m:02d}"
    s["mode"] = s.get("mode") if s.get("mode") in ("quick", "full") else "quick"
    s["reps"] = max(1, min(5, int(s.get("reps") or 3)))
    s["enabled"] = bool(s.get("enabled", True))
    if s["kind"] == "once" and not s.get("once_date"):
        raise HTTPException(status_code=400, detail="Per «una volta sola» serve la data (YYYY-MM-DD)")  # noqa: F821
    if s["kind"] == "weekly" and not s.get("weekdays"):
        s["weekdays"] = [0]
    if s["kind"] == "monthly":
        s["month_day"] = max(1, min(31, int(s.get("month_day") or 1)))
    if s["kind"] == "custom" and not s.get("weekdays") and not s.get("interval_days"):
        s["interval_days"] = 2
    s["title"] = (s.get("title") or "").strip()[:60] or "Stress test Axon"
    return s


@api_router.get("/axon/stress/schedules")  # noqa: F821
async def stress_schedules_list(user=Depends(get_current_user)):  # noqa: F821
    _st_require_owner(user)  # noqa: F821
    items = await db.axon_stress_schedules.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(100)  # noqa: F821
    return {"items": [_ss_out(s) for s in items]}


@api_router.post("/axon/stress/schedules")  # noqa: F821
async def stress_schedules_create(body: StressScheduleIn, user=Depends(get_current_user)):  # noqa: F821
    _st_require_owner(user)  # noqa: F821
    s = _ss_validate(body)
    s.update({"schedule_id": f"ss_{uuid.uuid4().hex[:10]}", "user_id": user["user_id"], "created_at": utcnow(), "last_run_at": None, "last_run_id": None})  # noqa: F821
    s["next_run_at"] = _ss_next_run(s) if s["enabled"] else None
    if s["kind"] == "once" and s["enabled"] and not s["next_run_at"]:
        raise HTTPException(status_code=400, detail="La data scelta è già passata")  # noqa: F821
    await db.axon_stress_schedules.insert_one(dict(s))  # noqa: F821
    return _ss_out(s)


@api_router.put("/axon/stress/schedules/{schedule_id}")  # noqa: F821
async def stress_schedules_update(schedule_id: str, body: StressScheduleIn, user=Depends(get_current_user)):  # noqa: F821
    _st_require_owner(user)  # noqa: F821
    cur = await db.axon_stress_schedules.find_one({"schedule_id": schedule_id, "user_id": user["user_id"]}, {"_id": 0})  # noqa: F821
    if not cur:
        raise HTTPException(status_code=404, detail="Programmazione non trovata")  # noqa: F821
    s = _ss_validate(body, cur)
    s["next_run_at"] = _ss_next_run(s) if s["enabled"] else None
    await db.axon_stress_schedules.update_one({"schedule_id": schedule_id}, {"$set": s})  # noqa: F821
    return _ss_out(s)


@api_router.delete("/axon/stress/schedules/{schedule_id}")  # noqa: F821
async def stress_schedules_delete(schedule_id: str, user=Depends(get_current_user)):  # noqa: F821
    _st_require_owner(user)  # noqa: F821
    r = await db.axon_stress_schedules.delete_one({"schedule_id": schedule_id, "user_id": user["user_id"]})  # noqa: F821
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Programmazione non trovata")  # noqa: F821
    return {"ok": True}


@api_router.post("/axon/stress/schedules/{schedule_id}/run-now")  # noqa: F821
async def stress_schedules_run_now(schedule_id: str, user=Depends(get_current_user)):  # noqa: F821
    _st_require_owner(user)  # noqa: F821
    s = await db.axon_stress_schedules.find_one({"schedule_id": schedule_id, "user_id": user["user_id"]}, {"_id": 0})  # noqa: F821
    if not s:
        raise HTTPException(status_code=404, detail="Programmazione non trovata")  # noqa: F821
    run_id = await _ss_fire(s, user)
    if not run_id:
        raise HTTPException(status_code=409, detail="C'è già un test in corso")  # noqa: F821
    return {"ok": True, "run_id": run_id}


@api_router.get("/axon/stress/schedules/upcoming")  # noqa: F821
async def stress_schedules_upcoming(days: int = 60, user=Depends(get_current_user)):  # noqa: F821
    """Occorrenze future (max 90 gg) per la vista calendario: [{date 'YYYY-MM-DD', time, schedule_id, title, kind}]."""
    _st_require_owner(user)  # noqa: F821
    days = max(7, min(90, days))
    horizon = utcnow() + _ss_td(days=days)  # noqa: F821
    out = []
    async for s in db.axon_stress_schedules.find({"user_id": user["user_id"], "enabled": True}, {"_id": 0}):  # noqa: F821
        t = _ss_next_run(s)
        n = 0
        while t and t <= horizon and n < 40:
            loc = t.astimezone(_SS_ROME)
            out.append({"date": loc.strftime("%Y-%m-%d"), "time": loc.strftime("%H:%M"), "schedule_id": s["schedule_id"], "title": s.get("title"), "kind": s.get("kind"), "label": _ss_label(s)})
            n += 1
            if s.get("kind") == "once":
                break
            t = _ss_next_run({**s, "last_run_at": t}, after=t)
    out.sort(key=lambda x: (x["date"], x["time"]))
    return {"items": out, "days": days}


async def _ss_fire(s: dict, user: dict) -> _ss_Optional[str]:
    cfg = await _st_nightly_settings(user["user_id"])  # noqa: F821 — soglie/autofix dalle impostazioni generali; modalità e ripetizioni dalla programmazione
    cfg = {**cfg, "mode": s.get("mode") or cfg["mode"], "reps": int(s.get("reps") or cfg["reps"])}
    run_id = await _st_start_nightly(user, cfg)  # noqa: F821
    now = utcnow()  # noqa: F821
    upd = {"last_run_at": now, "last_run_id": run_id}
    if s.get("kind") == "once":
        upd.update({"enabled": False, "next_run_at": None})
    else:
        upd["next_run_at"] = _ss_next_run({**s, "last_run_at": now}, after=now)
    await db.axon_stress_schedules.update_one({"schedule_id": s["schedule_id"]}, {"$set": upd})  # noqa: F821
    if run_id:
        await db.axon_stress_runs.update_one({"run_id": run_id}, {"$set": {"schedule_id": s["schedule_id"], "schedule_title": s.get("title")}})  # noqa: F821
        logger.info("[STRESS-SCHEDULE] «%s» (%s) → run %s", s.get("title"), _ss_label(s), run_id)  # noqa: F821
    return run_id


async def _ss_tick():
    now = utcnow()  # noqa: F821
    async for s in db.axon_stress_schedules.find({"enabled": True, "next_run_at": {"$lte": now}}, {"_id": 0}):  # noqa: F821
        try:
            user = await db.users.find_one({"user_id": s["user_id"]}, {"_id": 0})  # noqa: F821
            if not user:
                continue
            await _ss_fire(s, user)
        except Exception as e:  # noqa: BLE001
            logger.warning("[STRESS-SCHEDULE] tick failed for %s: %s", s.get("schedule_id"), e)  # noqa: F821
            # evita loop: sposta avanti di un'ora
            await db.axon_stress_schedules.update_one({"schedule_id": s["schedule_id"]}, {"$set": {"next_run_at": now + _ss_td(hours=1)}})  # noqa: F821


@app.on_event("startup")  # noqa: F821
async def _ss_start():
    try:
        _axn_scheduler.add_job(_ss_tick, "interval", minutes=1, id="stress-schedule-tick", replace_existing=True, max_instances=1, coalesce=True)  # noqa: F821
        logger.info("[STRESS-SCHEDULE] calendario stress test attivo (tick 1 min)")  # noqa: F821
    except Exception as e:  # noqa: BLE001
        logger.warning("[STRESS-SCHEDULE] scheduler non avviato: %s", e)  # noqa: F821
