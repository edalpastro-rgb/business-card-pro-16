# axon_app_info.py — V50.z208 / V50.z361 — Profilo → «Piano attivo + versione APK installata» (modulo ISOLATO)
#
# `GET /axon/app-info?device_key=…` → { plan_name, latest_version (V50.z361: build nativa più recente vista in un heartbeat standalone —
# app.json NON è affidabile, la pipeline assegna il numero), latest_version_date (prima rilevazione di quella build), backend_version (CHANGELOG), device
# {installed_version, build_number, first_seen = data installazione (primo heartbeat), updated_at = ultimo aggiornamento rilevato,
# previous_version, last_seen} }. Il confronto «aggiornata / disponibile una versione più recente» lo fa il client con la versione
# nativa reale (expo-application). `PUT /axon/app-info/plan {plan_name}` (solo Master): nome del piano mostrato a tutto il team.
# Riusa `axon_client_versions` (heartbeat di axon_system_awareness) e `_axs_changelog()`.

_API_DEFAULT_PLAN = "Piano Pro"


class ApiPlanIn(BaseModel):
    plan_name: str


async def _api_latest_version() -> Dict[str, Any]:
    """V50.z361 — «Versione disponibile» = la build nativa PIÙ RECENTE realmente installata su un dispositivo (heartbeat standalone).
    app.json (`expo.version` = 2.0.0, placeholder del Libretto) NON è più usato: la pipeline di pubblicazione assegna il proprio numero
    (es. 1.0.88), quindi confrontarlo generava il falso avviso «Hai la v1.0.88, è disponibile la v2.0.0»."""
    best: Optional[str] = None; date: Optional[datetime] = None; code: Optional[str] = None
    try:
        async for d in db.axon_client_versions.find({"app_env": "standalone", "app_version": {"$ne": None}},
                                                    {"_id": 0, "app_version": 1, "build_number": 1, "first_seen": 1, "updated_at": 1}):
            c = _api_vcmp(d["app_version"], best) if best else 1
            seen = d.get("updated_at") or d.get("first_seen")
            if c is None:
                continue
            if c > 0:
                best, date, code = d["app_version"], seen, d.get("build_number")
            elif c == 0 and seen and (date is None or seen < date):
                date = seen
    except Exception as exc:  # noqa: BLE001
        logger.warning("[app-info] latest version lookup failed: %s", exc)
    return {"version": best, "date": _api_dt(date), "android_version_code": code, "ios_build": None}


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
    latest = (await _api_latest_version()).get("version")
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


async def _api_purge_false_updates() -> int:
    """V50.z361 — chiude gli avvisi «Aggiornamento disponibile» già emessi verso una versione che NON è una build reale
    (es. v2.0.0 da app.json) o quando l'installata è ormai ≥ disponibile: alert Home, notifica, messaggio in chat."""
    n = 0
    try:
        latest = (await _api_latest_version()).get("version")
        now = utcnow()
        async for it in db.axon_proactive_log.find({"type": "app_update", "dismissed_at": None}, {"_id": 0, "item_id": 1, "user_id": 1, "latest_version": 1, "installed_version": 1, "notif_id": 1}):
            c = _api_vcmp(it.get("installed_version"), latest) if latest else None
            stale = latest is None or it.get("latest_version") != latest or (c is not None and c >= 0)
            if not stale:
                continue
            await db.axon_proactive_log.update_one({"item_id": it["item_id"]}, {"$set": {"dismissed_at": now, "read_at": now, "dismiss_reason": "false_update"}})
            await db.axon_notifications.delete_many({"user_id": it["user_id"], "$or": [{"notif_id": it.get("notif_id")}, {"dedupe_key": f"apx:{it['item_id']}"}]})
            await db.assistant_messages.delete_many({"user_id": it["user_id"], "proactive_id": it["item_id"]})
            n += 1
        # notifiche orfane (stesso titolo, versione non reale)
        pat = r"^📲 Aggiornamento disponibile: v" + (r"(?!" + re.escape(latest) + r"$)" if latest else "")
        r = await db.axon_notifications.delete_many({"title": {"$regex": pat}})
        n += r.deleted_count
        if n:
            logger.info("[app-info] purge falsi aggiornamenti: %d voci (versione reale %s)", n, latest)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[app-info] purge failed: %s", exc)
    return n


async def _api_outdated_tick() -> int:
    """Job orario: tutti i dispositivi nativi visti negli ultimi 30 giorni."""
    n = 0
    try:
        await _api_purge_false_updates()
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
    latest = await _api_latest_version()
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
                               next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30))  # V50.z361 — il tick fa prima il purge dei falsi avvisi
        logger.info("[app-info] update watcher armed")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[app-info] start failed: %s", exc)
