# ============================================================================
# V50.z492 — «TROVA IL MIO TELEFONO» via push (il dispositivo sorgente NON squilla mai se stesso)
# ----------------------------------------------------------------------------
# Gerarchia: sorgente phone → squilla il TABLET; sorgente pc / tablet / carplay → squilla il TELEFONO.
# Fallback: un altro dispositivo attivo diverso dalla sorgente (mai la sorgente). Nessun altro dispositivo → 404.
# Canale: push reale via relay Emergent (`send_push`, destinatario = user_id; il payload porta `target_device_id`, ogni
# dispositivo squilla SOLO se è il target) + coda `find_phone_cmds` consultata dall'app (polling quando è aperta) come rete di
# sicurezza. Il bersaglio continua finché: tocca lo schermo / dice «stop» (ack) oppure la sorgente dice «stop» (`/stop`).
# Modalità: `ring` (squillo dedicato find_phone.wav) · `vibrate` (vibrazione continua) — «fallo vibrare» nel comando → vibrate.
# ============================================================================
import re as _fp_re
import uuid as _fp_uuid
from datetime import timedelta as _fp_td
from typing import Optional as _fp_Optional

_FP_TTL_MIN = 3
_FP_RX_VIBRATE = _fp_re.compile(r"\b(vibra\w*|fallo vibrare|falla vibrare|solo vibrazione|in vibrazione|senza suono|silenzios\w*)\b", _fp_re.I)
_FP_RX_CARPLAY = _fp_re.compile(r"\b(carplay|android auto|auto|macchina)\b", _fp_re.I)


class FindPhoneTriggerIn(BaseModel):  # noqa: F821
    source_device_id: _fp_Optional[str] = None
    source_type: _fp_Optional[str] = None  # phone | tablet | pc | carplay
    mode: _fp_Optional[str] = None  # ring | vibrate (se assente → dedotto dal testo)
    text: _fp_Optional[str] = None


class FindPhoneAckIn(BaseModel):  # noqa: F821
    status: str = "ringing"  # ringing | stopped
    device_id: _fp_Optional[str] = None


class FindPhoneStopIn(BaseModel):  # noqa: F821
    source_device_id: _fp_Optional[str] = None


def _fp_mode(body: FindPhoneTriggerIn) -> str:
    if (body.mode or "").lower() in ("ring", "vibrate"):
        return body.mode.lower()
    return "vibrate" if _FP_RX_VIBRATE.search(body.text or "") else "ring"


async def _fp_pick_target(uid: str, src_id: _fp_Optional[str], src_type: _fp_Optional[str]) -> _fp_Optional[dict]:
    devs = [d async for d in db.user_devices.find({"user_id": uid, "status": {"$in": ["active", None]}}, {"_id": 0}).sort("last_seen_at", -1)]  # noqa: F821
    if not devs:
        devs = [d async for d in db.user_devices.find({"user_id": uid, "status": {"$ne": "revoked"}}, {"_id": 0}).sort("last_seen_at", -1)]  # noqa: F821
    others = [d for d in devs if d.get("device_id") != (src_id or "")]
    src_type = (src_type or "").lower()
    if not src_type and src_id:
        me = next((d for d in devs if d.get("device_id") == src_id), None)
        src_type = (me or {}).get("type") or ""
    wanted = "tablet" if src_type == "phone" else "phone"
    for d in others:
        if d.get("type") == wanted:
            return d
    # fallback: qualsiasi altro dispositivo mobile (mai un PC web, mai la sorgente)
    for d in others:
        if d.get("type") in ("phone", "tablet"):
            return d
    return None


async def _fp_expire(uid: str) -> None:
    await db.find_phone_cmds.update_many({"user_id": uid, "status": {"$in": ["pending", "delivered", "ringing"]}, "expires_at": {"$lt": utcnow()}}, {"$set": {"status": "expired"}})  # noqa: F821


@api_router.post("/axon/find-phone/trigger")  # noqa: F821
async def find_phone_trigger(body: FindPhoneTriggerIn, user=Depends(get_current_user)):  # noqa: F821
    uid = user["user_id"]
    await _fp_expire(uid)
    src_type = (body.source_type or "").lower() or ("carplay" if _FP_RX_CARPLAY.search(body.text or "") else "")
    target = await _fp_pick_target(uid, body.source_device_id, src_type)
    if not target:
        raise HTTPException(status_code=404, detail="Nessun altro dispositivo registrato da far squillare: accedi ad AdvisorOS dal telefono (o dal tablet) almeno una volta.")  # noqa: F821
    mode = _fp_mode(body)
    now = utcnow()  # noqa: F821
    # un solo comando attivo per utente: i precedenti vengono chiusi
    await db.find_phone_cmds.update_many({"user_id": uid, "status": {"$in": ["pending", "delivered", "ringing"]}}, {"$set": {"status": "stopped", "stopped_at": now, "stopped_by": "superseded"}})  # noqa: F821
    cmd = {
        "cmd_id": f"fp_{_fp_uuid.uuid4().hex[:12]}", "user_id": uid, "tenant_id": tenant_id(user),  # noqa: F821
        "source_device_id": body.source_device_id or "", "source_type": src_type or "unknown",
        "target_device_id": target["device_id"], "target_type": target.get("type") or "", "target_name": target.get("name") or "",
        "mode": mode, "status": "pending", "created_at": now, "expires_at": now + _fp_td(minutes=_FP_TTL_MIN), "push_sent": False,
    }
    await db.find_phone_cmds.insert_one(dict(cmd))  # noqa: F821
    name = (user.get("assistant_name") or "Axon") if isinstance(user, dict) else "Axon"
    if not globals().get("_PUSH_KEY_OK", True):  # EMERGENT_PUSH_KEY = placeholder → nessuna push reale, resta la coda (app aperta)
        await db.find_phone_cmds.update_one({"cmd_id": cmd["cmd_id"]}, {"$set": {"push_error": "push_key_not_configured"}})  # noqa: F821
        logger.warning("[find-phone] EMERGENT_PUSH_KEY non configurata: il bersaglio squilla solo con app aperta (polling)")  # noqa: F821
        return {"cmd_id": cmd["cmd_id"], "mode": mode, "push_sent": False, "target": {"device_id": target["device_id"], "type": target.get("type"), "name": target.get("name") or target.get("type")},
                "message": f"📱 {'Faccio vibrare' if mode == 'vibrate' else 'Faccio squillare'} {target.get('name') or 'il telefono'}: continua finché non tocchi lo schermo o dici «stop»."}
    try:
        await send_push([uid], {  # noqa: F821 — relay Emergent (per user_id): ogni dispositivo controlla target_device_id
            "title": "📍 Trova il mio telefono",
            "message": ("Vibrazione continua" if mode == "vibrate" else "Squillo") + " finché non tocchi lo schermo o dici «stop».",
            "channel_id": "find_phone", "sound": "find_phone.wav",
            "type": "find_phone", "cmd_id": cmd["cmd_id"], "target_device_id": target["device_id"], "source_device_id": cmd["source_device_id"],
            "mode": mode, "assistant_name": name, "action_url": "/home",
        }, idempotency_key=cmd["cmd_id"])
        await db.find_phone_cmds.update_one({"cmd_id": cmd["cmd_id"]}, {"$set": {"push_sent": True, "push_at": utcnow()}})  # noqa: F821
        cmd["push_sent"] = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[find-phone] push failed (non-blocking, resta la coda): %s", exc)  # noqa: F821
        await db.find_phone_cmds.update_one({"cmd_id": cmd["cmd_id"]}, {"$set": {"push_error": str(exc)[:200]}})  # noqa: F821
    cmd.pop("_id", None)
    return {"cmd_id": cmd["cmd_id"], "mode": mode, "push_sent": cmd["push_sent"],
            "target": {"device_id": target["device_id"], "type": target.get("type"), "name": target.get("name") or target.get("type")},
            "message": f"📱 {'Faccio vibrare' if mode == 'vibrate' else 'Faccio squillare'} {target.get('name') or ('il tablet' if target.get('type') == 'tablet' else 'il telefono')}: continua finché non tocchi lo schermo o dici «stop»."}


@api_router.get("/axon/find-phone/pending")  # noqa: F821
async def find_phone_pending(device_id: str, user=Depends(get_current_user)):  # noqa: F821
    """Il dispositivo chiede se deve squillare (rete di sicurezza quando la push non arriva / app aperta)."""
    uid = user["user_id"]
    await _fp_expire(uid)
    cmd = await db.find_phone_cmds.find_one({"user_id": uid, "target_device_id": device_id, "status": {"$in": ["pending", "delivered"]}}, {"_id": 0}, sort=[("created_at", -1)])  # noqa: F821
    if not cmd:
        return {"cmd": None}
    await db.find_phone_cmds.update_one({"cmd_id": cmd["cmd_id"]}, {"$set": {"status": "delivered", "delivered_at": utcnow(), "delivered_via": "poll"}})  # noqa: F821
    return {"cmd": {"cmd_id": cmd["cmd_id"], "mode": cmd["mode"], "assistant_name": user.get("assistant_name") or "Axon", "source_type": cmd.get("source_type")}}


@api_router.get("/axon/find-phone/{cmd_id}")  # noqa: F821
async def find_phone_get(cmd_id: str, user=Depends(get_current_user)):  # noqa: F821
    await _fp_expire(user["user_id"])
    cmd = await db.find_phone_cmds.find_one({"cmd_id": cmd_id, "user_id": user["user_id"]}, {"_id": 0})  # noqa: F821
    if not cmd:
        raise HTTPException(status_code=404, detail="Comando non trovato")  # noqa: F821
    return cmd


@api_router.post("/axon/find-phone/{cmd_id}/ack")  # noqa: F821
async def find_phone_ack(cmd_id: str, body: FindPhoneAckIn, user=Depends(get_current_user)):  # noqa: F821
    st = "stopped" if body.status == "stopped" else "ringing"
    upd = {"status": st, f"{st}_at": utcnow()}  # noqa: F821
    if st == "stopped":
        upd["stopped_by"] = "target"
    r = await db.find_phone_cmds.update_one({"cmd_id": cmd_id, "user_id": user["user_id"]}, {"$set": upd})  # noqa: F821
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Comando non trovato")  # noqa: F821
    return {"ok": True, "status": st}


@api_router.post("/axon/find-phone/stop")  # noqa: F821
async def find_phone_stop(body: FindPhoneStopIn, user=Depends(get_current_user)):  # noqa: F821
    """«Stop» detto da qualsiasi dispositivo: ferma lo squillo sul bersaglio (il bersaglio lo legge entro ~3 s)."""
    now = utcnow()  # noqa: F821
    r = await db.find_phone_cmds.update_many({"user_id": user["user_id"], "status": {"$in": ["pending", "delivered", "ringing"]}}, {"$set": {"status": "stopped", "stopped_at": now, "stopped_by": body.source_device_id or "remote"}})  # noqa: F821
    return {"ok": True, "stopped": r.modified_count}


@api_router.get("/axon/find-phone/status/last")  # noqa: F821
async def find_phone_status_last(user=Depends(get_current_user)):  # noqa: F821
    cmd = await db.find_phone_cmds.find_one({"user_id": user["user_id"]}, {"_id": 0}, sort=[("created_at", -1)])  # noqa: F821
    return {"cmd": cmd}
