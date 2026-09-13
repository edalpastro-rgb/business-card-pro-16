# axon_app_info.py — V50.z208 — Profilo → «Piano attivo + versione APK installata» (modulo ISOLATO)
#
# `GET /axon/app-info?device_key=…` → { plan_name, latest_version (app.json expo.version = versione della build generabile dal codice
# attuale), latest_version_date (data ultima build/aggiornamento del codice = mtime app.json), backend_version (CHANGELOG), device
# {installed_version, build_number, first_seen = data installazione (primo heartbeat), updated_at = ultimo aggiornamento rilevato,
# previous_version, last_seen} }. Il confronto «aggiornata / disponibile una versione più recente» lo fa il client con la versione
# nativa reale (expo-application). `PUT /axon/app-info/plan {plan_name}` (solo Master): nome del piano mostrato a tutto il team.
# Riusa `axon_client_versions` (heartbeat di axon_system_awareness) e `_axs_changelog()`.

import json as _api_json
from pathlib import Path as _ApiPath

def _api_find_app_json() -> _ApiPath:
    p = _ApiPath(__file__).resolve().parent   # __file__ può essere server.py (loader) o routes/…
    while not (p / "frontend" / "app.json").exists() and p != p.parent:
        p = p.parent
    return p / "frontend" / "app.json"


_API_APP_JSON = _api_find_app_json()
_API_DEFAULT_PLAN = "Piano Pro"
_api_cache: Dict[str, Any] = {"mtime": None, "version": None, "date": None}


class ApiPlanIn(BaseModel):
    plan_name: str


def _api_latest_version() -> Dict[str, Any]:
    try:
        mt = _API_APP_JSON.stat().st_mtime
        if _api_cache["mtime"] != mt:
            data = _api_json.loads(_API_APP_JSON.read_text(encoding="utf-8"))
            expo = data.get("expo") or {}
            _api_cache.update({"mtime": mt, "version": expo.get("version"), "android_version_code": (expo.get("android") or {}).get("versionCode"),
                               "ios_build": (expo.get("ios") or {}).get("buildNumber"), "date": datetime.fromtimestamp(mt, tz=timezone.utc).isoformat()})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[app-info] app.json read failed: %s", exc)
    return {"version": _api_cache.get("version"), "date": _api_cache.get("date"), "android_version_code": _api_cache.get("android_version_code"), "ios_build": _api_cache.get("ios_build")}


def _api_dt(v) -> Optional[str]:
    return v.isoformat() if isinstance(v, datetime) else (v or None)


def _api_vcmp(a: Optional[str], b: Optional[str]) -> Optional[int]:
    """Confronto versioni «1.0.60» vs «2.0.0» (None se non confrontabili)."""
    try:
        pa = [int(x) for x in re.findall(r"\d+", a or "")]; pb = [int(x) for x in re.findall(r"\d+", b or "")]
        if not pa or not pb:
            return None
        for i in range(max(len(pa), len(pb))):
            d = (pa[i] if i < len(pa) else 0) - (pb[i] if i < len(pb) else 0)
            if d:
                return d
        return 0
    except Exception:
        return None


def _api_whats_new(n: int = 3) -> List[dict]:
    rows = (_axs_changelog().get("rows") or [])[:n]
    return [{"version": r["version"], "date": r["date"], "desc": re.sub(r"`", "", r["desc"])[:220]} for r in rows]


_APX_TYPE_LABELS["app_update"] = "Aggiornamento app disponibile"
_APX_DEFAULT_CONFIG["alerts"]["app_update"] = True


async def _api_check_outdated(user: dict, dev: Optional[dict]) -> Optional[dict]:
    """APK installata più vecchia di quella disponibile → UN avviso in chat (dedupe per coppia installata→disponibile)."""
    if not dev or dev.get("app_env") != "standalone" or not dev.get("app_version"):
        return None
    latest = _api_latest_version().get("version")
    c = _api_vcmp(dev["app_version"], latest)
    if c is None or c >= 0:
        return None
    news = _api_whats_new(3)
    bullets = "\n".join(f"• {r['version']}: {r['desc'][:140]}" for r in news) or "• miglioramenti e correzioni"
    return await _apx_emit(
        user, "alert", "app_update", f"📲 Aggiornamento disponibile: v{latest}",
        f"Hai la v{dev['app_version']}, è disponibile la v{latest}",
        f"📲 **La tua app è da aggiornare.** Sul dispositivo {dev.get('device_name') or dev.get('platform') or ''} hai installata la **v{dev['app_version']}**"
        f"{(' (build ' + str(dev.get('build_number')) + ')') if dev.get('build_number') else ''}, mentre è disponibile la **v{latest}**.\n\nCosa ti perdi:\n{bullets}\n\n"
        "Scarica la nuova build dell'app e installala: i tuoi dati restano tutti al loro posto. Trovi lo stato in Profilo → prima card.",
        f"app_update:{dev['app_version']}->{latest}", [{"label": "Apri Profilo", "route": "/(tabs)/impostazioni"}], "app-info", {"installed_version": dev["app_version"], "latest_version": latest})


async def _api_outdated_tick() -> int:
    """Job orario: tutti i dispositivi nativi visti negli ultimi 30 giorni."""
    n = 0
    try:
        since = utcnow() - timedelta(days=30)
        async for dev in db.axon_client_versions.find({"app_env": "standalone", "app_version": {"$ne": None}, "last_seen": {"$gte": since}}, {"_id": 0}):
            user = await db.users.find_one({"user_id": dev["user_id"]}, {"_id": 0})
            if user and await _api_check_outdated(user, dev):
                n += 1
    except Exception as exc:  # noqa: BLE001
        logger.warning("[app-info] outdated tick failed: %s", exc)
    return n


@api_router.get("/axon/app-info")
async def axon_app_info(device_key: Optional[str] = None, user=Depends(get_current_user)):
    tid = tenant_id(user)
    owner = await db.users.find_one({"user_id": tid}, {"_id": 0, "plan_name": 1, "name": 1}) or {}
    plan = owner.get("plan_name") or _API_DEFAULT_PLAN
    dev = None
    if device_key:
        dev = await db.axon_client_versions.find_one({"user_id": user["user_id"], "device_key": device_key}, {"_id": 0})
    if not dev:
        dev = await db.axon_client_versions.find_one({"user_id": user["user_id"], "app_version": {"$ne": None}}, {"_id": 0}, sort=[("last_seen", -1)])
    latest = _api_latest_version()
    cl = _axs_changelog()
    try:
        await _api_check_outdated(user, dev)   # avviso in chat se l'APK è vecchia (idempotente)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[app-info] outdated check failed: %s", exc)
    return {
        "plan_name": plan, "plan_scope": "master" if user["user_id"] == tid else "team",
        "latest_version": latest["version"], "latest_version_date": latest["date"], "android_version_code": latest["android_version_code"],
        "backend_version": cl.get("version"), "backend_version_date": (cl.get("rows") or [{}])[0].get("date"),
        "whats_new": _api_whats_new(3),
        "device": None if not dev else {"installed_version": dev.get("app_version"), "build_number": dev.get("build_number"), "js_version": dev.get("js_version"), "platform": dev.get("platform"),
                                        "app_env": dev.get("app_env"), "first_seen": _api_dt(dev.get("first_seen")), "updated_at": _api_dt(dev.get("updated_at")), "previous_version": dev.get("previous_version"), "last_seen": _api_dt(dev.get("last_seen"))},
    }


@api_router.put("/axon/app-info/plan")
async def axon_app_info_plan(body: ApiPlanIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può impostare il nome del piano")
    name = (body.plan_name or "").strip()[:60]
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Nome piano troppo corto")
    await db.users.update_one({"user_id": tenant_id(user)}, {"$set": {"plan_name": name}})
    return {"ok": True, "plan_name": name}


@app.on_event("startup")
async def _api_start():
    try:
        _axn_scheduler.add_job(_api_outdated_tick, "interval", hours=1, id="app-info-outdated", replace_existing=True,
                               next_run_time=datetime.now(timezone.utc) + timedelta(seconds=90))
        logger.info("[app-info] update watcher armed")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[app-info] start failed: %s", exc)
