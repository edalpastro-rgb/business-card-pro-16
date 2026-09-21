# auth_devices.py — V50.z293 — REGISTRO DISPOSITIVI: 1 telefono + 1 tablet + 1 PC per utente.
# Regola (scelta dell'utente): il login su un NUOVO dispositivo dello stesso tipo disconnette e SOSPENDE automaticamente
# quello precedente (es. PC in trasferta → accesso temporaneo). Quando il nuovo dispositivo termina la sessione (logout /
# rimozione), il dispositivo sospeso più recente dello stesso tipo viene RIATTIVATO. Token legato al dispositivo (claim «did»):
# un dispositivo sospeso/rimosso riceve 401 «device_suspended» → logout forzato nel client.
# Master: elenco dispositivi del team, rimozione, log accessi.

_DEV_TYPES = ("phone", "tablet", "pc")
_DEV_TYPE_LABEL = {"phone": "Telefono", "tablet": "Tablet", "pc": "PC"}
_DEV_GATE_CACHE: Dict[str, Tuple[str, float]] = {}  # device_id → (status, ts) — 20 s per non leggere il DB a ogni richiesta


def _dev_ip(request: Optional[Request]) -> str:
    try:
        if request is None:
            return ""
        xf = request.headers.get("x-forwarded-for") or ""
        return (xf.split(",")[0].strip() if xf else (request.client.host if request.client else "")) or ""
    except Exception:
        return ""


async def _device_log(user: dict, dev: dict, event: str, ip: str = "", note: str = "") -> None:
    try:
        await db.auth_access_log.insert_one({"log_id": f"al_{uuid.uuid4().hex[:12]}", "tenant_id": tenant_id(user), "user_id": user["user_id"], "user_name": user.get("name") or user.get("email"),
                                             "device_id": dev.get("device_id"), "device_type": dev.get("type"), "device_name": dev.get("name"), "event": event, "ip": ip, "note": note, "at": utcnow()})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[devices] log failed: %s", exc)


async def _device_register_login(user: dict, device, request: Optional[Request] = None) -> Optional[dict]:
    """Registra/aggiorna il dispositivo che fa login; sospende l'eventuale altro dispositivo ATTIVO dello stesso tipo."""
    if not device or not getattr(device, "device_id", None):
        return None  # client vecchio senza identità dispositivo: nessun vincolo (retro-compatibilità)
    did = str(device.device_id)[:80]
    dtype = device.type if device.type in _DEV_TYPES else "phone"
    name = (device.name or _DEV_TYPE_LABEL[dtype])[:80]
    ip = _dev_ip(request)
    now = utcnow()
    uid = user["user_id"]
    # 1) sospendi gli altri attivi dello stesso tipo (slot unico per tipo)
    others = await db.user_devices.find({"user_id": uid, "type": dtype, "status": "active", "device_id": {"$ne": did}}, {"_id": 0}).to_list(20)
    for o in others:
        await db.user_devices.update_one({"device_id": o["device_id"], "user_id": uid}, {"$set": {"status": "suspended", "suspended_by": did, "suspended_at": now}})
        _DEV_GATE_CACHE.pop(o["device_id"], None)
        await _device_log(user, o, "suspended", ip, f"sostituito da {name}")
    # 2) upsert del dispositivo corrente come attivo
    existing = await db.user_devices.find_one({"device_id": did, "user_id": uid}, {"_id": 0})
    doc = {"device_id": did, "user_id": uid, "tenant_id": tenant_id(user), "type": dtype, "name": name, "platform": (device.platform or "")[:60],
           "status": "active", "last_seen_at": now, "last_ip": ip, "last_login_at": now}
    if existing:
        await db.user_devices.update_one({"device_id": did, "user_id": uid}, {"$set": doc, "$unset": {"suspended_by": "", "suspended_at": ""}, "$inc": {"logins": 1}})
    else:
        await db.user_devices.insert_one({**doc, "created_at": now, "logins": 1})
    _DEV_GATE_CACHE[did] = ("active", now.timestamp())
    await _device_log(user, doc, "login", ip, f"{len(others)} dispositivo/i sospeso/i" if others else "")
    return {**doc, "replaced": [{"device_id": o["device_id"], "name": o.get("name")} for o in others]}


async def _device_gate(user_id: str, device_id: str) -> None:
    """Chiamata da get_current_user: blocca i token di dispositivi sospesi/rimossi (cache 20 s)."""
    now_ts = utcnow().timestamp()
    cached = _DEV_GATE_CACHE.get(device_id)
    if cached and now_ts - cached[1] < 20:
        status_ = cached[0]
    else:
        d = await db.user_devices.find_one({"device_id": device_id, "user_id": user_id}, {"_id": 0, "status": 1, "type": 1})
        status_ = (d or {}).get("status") or "missing"
        _DEV_GATE_CACHE[device_id] = (status_, now_ts)
        if d and status_ == "active":
            await db.user_devices.update_one({"device_id": device_id, "user_id": user_id}, {"$set": {"last_seen_at": utcnow()}})
    if status_ == "active":
        return
    if status_ == "missing":
        return  # dispositivo mai registrato (es. dati azzerati): non bloccare
    raise HTTPException(status_code=401, detail="device_suspended")


async def _device_end_session(user_id: str, device_id: str, reason: str = "logout") -> Optional[dict]:
    """Termina la sessione di un dispositivo → 'revoked'; riattiva il dispositivo sospeso più recente dello stesso tipo."""
    d = await db.user_devices.find_one({"device_id": device_id, "user_id": user_id}, {"_id": 0})
    if not d:
        return None
    now = utcnow()
    await db.user_devices.update_one({"device_id": device_id, "user_id": user_id}, {"$set": {"status": "revoked", "revoked_at": now, "revoked_reason": reason}})
    _DEV_GATE_CACHE.pop(device_id, None)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "parent_user_id": 1, "role": 1}) or {"user_id": user_id}
    await _device_log(user, d, "revoked", "", reason)
    reactivated = None
    if d.get("status") == "active":
        cand = await db.user_devices.find({"user_id": user_id, "type": d["type"], "status": "suspended"}, {"_id": 0}).sort("suspended_at", -1).to_list(1)
        if cand:
            await db.user_devices.update_one({"device_id": cand[0]["device_id"], "user_id": user_id}, {"$set": {"status": "active"}, "$unset": {"suspended_by": "", "suspended_at": ""}})
            _DEV_GATE_CACHE.pop(cand[0]["device_id"], None)
            await _device_log(user, cand[0], "reactivated", "", f"{d.get('name')} ha terminato la sessione")
            reactivated = {"device_id": cand[0]["device_id"], "name": cand[0].get("name")}
    return {"revoked": device_id, "reactivated": reactivated}


def _dev_pub(d: dict, current: Optional[str] = None) -> dict:
    return {"device_id": d["device_id"], "type": d.get("type"), "type_label": _DEV_TYPE_LABEL.get(d.get("type") or "", d.get("type")), "name": d.get("name"), "platform": d.get("platform"),
            "status": d.get("status"), "last_seen_at": d.get("last_seen_at"), "last_login_at": d.get("last_login_at"), "last_ip": d.get("last_ip"), "created_at": d.get("created_at"),
            "suspended_by": d.get("suspended_by"), "is_current": bool(current and d["device_id"] == current), "user_id": d.get("user_id")}


def _dev_current_id(authorization: Optional[str]) -> Optional[str]:
    try:
        token = (authorization or "").split(" ", 1)[1].strip()
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG]).get("did")
    except Exception:
        return None


@api_router.get("/auth/devices")
async def my_devices(user=Depends(get_current_user), authorization: Optional[str] = Header(None)):
    cur = _dev_current_id(authorization)
    rows = await db.user_devices.find({"user_id": user["user_id"], "status": {"$ne": "revoked"}}, {"_id": 0}).sort("last_seen_at", -1).to_list(50)
    return {"items": [_dev_pub(d, cur) for d in rows], "limits": {t: 1 for t in _DEV_TYPES}, "current_device_id": cur}


@api_router.delete("/auth/devices/{device_id}")
async def my_device_remove(device_id: str, user=Depends(get_current_user)):
    r = await _device_end_session(user["user_id"], device_id, reason="removed_by_user")
    if not r:
        raise HTTPException(status_code=404, detail="Dispositivo non trovato")
    return {"ok": True, **r}


@api_router.get("/team/devices")
async def team_devices(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    tenant = tenant_id(user)
    team_ids = [tenant] + await descendant_user_ids(tenant)
    users = {u["user_id"]: u for u in await db.users.find({"user_id": {"$in": team_ids}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(500)}
    rows = await db.user_devices.find({"user_id": {"$in": team_ids}, "status": {"$ne": "revoked"}}, {"_id": 0}).sort("last_seen_at", -1).to_list(2000)
    out = []
    for d in rows:
        u = users.get(d["user_id"], {})
        out.append({**_dev_pub(d), "user_name": u.get("name") or u.get("email"), "user_email": u.get("email")})
    # utenti con più dispositivi attivi dello stesso tipo non dovrebbero esistere; segnala chi ha ≥2 attivi in totale ≥ 3 tipi ecc.
    return {"items": out, "users": [{"user_id": k, "name": v.get("name"), "email": v.get("email")} for k, v in users.items()]}


@api_router.delete("/team/devices/{device_id}")
async def team_device_remove(device_id: str, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    d = await db.user_devices.find_one({"device_id": device_id}, {"_id": 0, "user_id": 1})
    if not d:
        raise HTTPException(status_code=404, detail="Dispositivo non trovato")
    team_ids = [tenant_id(user)] + await descendant_user_ids(tenant_id(user))
    if d["user_id"] not in team_ids:
        raise HTTPException(status_code=403, detail="Dispositivo di un altro team")
    r = await _device_end_session(d["user_id"], device_id, reason=f"removed_by_master:{user['user_id']}")
    return {"ok": True, **(r or {})}


@api_router.get("/team/access-log")
async def team_access_log(limit: int = 100, user_id: Optional[str] = None, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if user_id:
        q["user_id"] = user_id
    rows = await db.auth_access_log.find(q, {"_id": 0}).sort("at", -1).to_list(max(1, min(limit, 500)))
    return {"items": rows}
