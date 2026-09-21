# auth_quick_unlock.py — V50.z187 — Accesso rapido dalla schermata di login (impronta / Face ID / PIN)
#
# MODULO ISOLATO. Il dispositivo, dopo un login completo (password + eventuale 2FA TOTP), può
# registrarsi come "dispositivo fidato": riceve un `device_id` + `secret` (48 byte casuali) che l'app
# conserva in SecureStore e usa SOLO dopo aver superato la biometria o il PIN locale. Il server conserva
# solo l'hash SHA-256 del secret (mai il secret). Login rapido → JWT identico a quello del login classico.
#
#   POST   /auth/quick-unlock/enroll            (auth)  {device_name, platform} → {device_id, secret}
#   POST   /auth/quick-unlock/login             (pub)   {device_id, secret}     → {token, user}
#   GET    /auth/quick-unlock/devices           (auth)  → elenco dispositivi fidati
#   DELETE /auth/quick-unlock/devices/{device_id} (auth)
# Revoca automatica: cambio password / disattivazione da Sicurezza. Scadenza 180 giorni senza uso.

import hashlib as _qu_hashlib
import secrets as _qu_secrets

_QU_MAX_DEVICES = 5
_QU_IDLE_DAYS = 180


class QuEnrollIn(BaseModel):
    device_name: Optional[str] = None
    platform: Optional[str] = None


class QuLoginIn(BaseModel):
    device_id: str
    secret: str
    device: Optional[DeviceIn] = None  # V50.z293 — identità dispositivo per il registro (1 telefono + 1 tablet + 1 PC)


def _qu_hash(secret: str) -> str:
    return _qu_hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _qu_out(d: dict) -> dict:
    return {"device_id": d["device_id"], "device_name": d.get("device_name") or "Dispositivo", "platform": d.get("platform") or "",
            "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at"),
            "last_used_at": d["last_used_at"].isoformat() if isinstance(d.get("last_used_at"), datetime) else d.get("last_used_at")}


@api_router.post("/auth/quick-unlock/enroll")
async def quick_unlock_enroll(body: QuEnrollIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    n = await db.quick_unlock_devices.count_documents({"user_id": uid})
    if n >= _QU_MAX_DEVICES:
        oldest = await db.quick_unlock_devices.find({"user_id": uid}).sort("last_used_at", 1).limit(1).to_list(1)
        if oldest:
            await db.quick_unlock_devices.delete_one({"_id": oldest[0]["_id"]})
    secret = _qu_secrets.token_urlsafe(48)
    doc = {"device_id": f"dev_{uuid.uuid4().hex[:16]}", "user_id": uid, "secret_hash": _qu_hash(secret),
           "device_name": (body.device_name or "").strip()[:60] or "Dispositivo", "platform": (body.platform or "")[:20],
           "created_at": utcnow(), "last_used_at": utcnow()}
    await db.quick_unlock_devices.insert_one(doc)
    return {"device_id": doc["device_id"], "secret": secret, "device": _qu_out(doc)}


@api_router.post("/auth/quick-unlock/login")
async def quick_unlock_login(body: QuLoginIn, request: Request):
    d = await db.quick_unlock_devices.find_one({"device_id": body.device_id})
    if not d or not _qu_secrets.compare_digest(d.get("secret_hash") or "", _qu_hash(body.secret)):
        raise HTTPException(status_code=401, detail="Accesso rapido non valido: esegui il login con email e password")
    last = d.get("last_used_at")
    if isinstance(last, datetime) and (utcnow() - (last if last.tzinfo else last.replace(tzinfo=timezone.utc))).days > _QU_IDLE_DAYS:
        await db.quick_unlock_devices.delete_one({"_id": d["_id"]})
        raise HTTPException(status_code=401, detail="Accesso rapido scaduto: esegui il login con email e password")
    user = await db.users.find_one({"user_id": d["user_id"]}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "backup_codes": 0})
    if not user or user.get("disabled"):
        raise HTTPException(status_code=401, detail="Account non disponibile")
    await db.quick_unlock_devices.update_one({"_id": d["_id"]}, {"$set": {"last_used_at": utcnow()}})
    dev = await _device_register_login(user, body.device, request)  # V50.z293
    return {"token": create_jwt(user["user_id"], dev.get("device_id") if dev else None), "user": UserOut(**user).model_dump(), "device": dev}


@api_router.get("/auth/quick-unlock/devices")
async def quick_unlock_devices(user=Depends(get_current_user)):
    items = await db.quick_unlock_devices.find({"user_id": user["user_id"]}).sort("last_used_at", -1).to_list(20)
    return {"items": [_qu_out(d) for d in items]}


@api_router.delete("/auth/quick-unlock/devices/{device_id}")
async def quick_unlock_revoke(device_id: str, user=Depends(get_current_user)):
    r = await db.quick_unlock_devices.delete_one({"device_id": device_id, "user_id": user["user_id"]})
    return {"ok": True, "deleted": r.deleted_count}
