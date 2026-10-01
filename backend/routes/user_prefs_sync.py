# V50.z428 — PREFERENZE UTENTE SUL SERVER (sopravvivono a reinstallazione APK, aggiornamenti, cambio dispositivo)
# Il frontend specchia automaticamente le chiavi locali (AsyncStorage + SecureStore whitelist: PIN, blocco app, tema,
# widget del menu laterale, impostazioni personali…) in `user_prefs` legate all'account; al login/avvio ripristina le chiavi
# mancanti in locale. Merge last-write-wins per chiave con timestamp `at` (ms) del client.
import time as _up_time
from typing import Any, Dict, Optional

from pydantic import BaseModel as _UpBase

_UP_MAX_KEYS = 400
_UP_MAX_VALUE = 64 * 1024  # 64 KB per valore (JSON serializzato)
_UP_MAX_TOTAL = 2 * 1024 * 1024


class UpPutIn(_UpBase):
    prefs: Dict[str, Dict[str, Any]]  # key → {"v": <json>, "at": <ms>} ; v=None → cancellazione
    device: Optional[str] = None


@api_router.get("/me/prefs")  # noqa: F821
async def up_get(user=Depends(get_current_user)):  # noqa: F821
    doc = await db.user_prefs.find_one({"user_id": user["user_id"]}, {"_id": 0, "prefs": 1, "updated_at": 1})  # noqa: F821
    return {"prefs": (doc or {}).get("prefs") or {}, "updated_at": (doc or {}).get("updated_at")}


@api_router.put("/me/prefs")  # noqa: F821
async def up_put(body: UpPutIn, user=Depends(get_current_user)):  # noqa: F821
    import json as _j
    doc = await db.user_prefs.find_one({"user_id": user["user_id"]}, {"_id": 0, "prefs": 1}) or {}  # noqa: F821
    prefs: Dict[str, Any] = dict(doc.get("prefs") or {})
    now_ms = int(_up_time.time() * 1000)
    applied, rejected = 0, []
    for key, item in (body.prefs or {}).items():
        if not isinstance(key, str) or not key or len(key) > 160 or not isinstance(item, dict):
            rejected.append(key); continue
        at = int(item.get("at") or now_ms)
        cur = prefs.get(key)
        if cur and int(cur.get("at") or 0) > at:
            continue  # il server ha una versione più recente (altro dispositivo)
        if item.get("v") is None:
            prefs.pop(key, None); applied += 1; continue
        try:
            size = len(_j.dumps(item.get("v"), ensure_ascii=False))
        except Exception:  # noqa: BLE001
            rejected.append(key); continue
        if size > _UP_MAX_VALUE:
            rejected.append(key); continue
        prefs[key] = {"v": item.get("v"), "at": at, "dev": (body.device or "")[:40]}
        applied += 1
    if len(prefs) > _UP_MAX_KEYS:
        # tieni le più recenti
        prefs = dict(sorted(prefs.items(), key=lambda kv: -int(kv[1].get("at") or 0))[:_UP_MAX_KEYS])
    try:
        if len(_j.dumps(prefs, ensure_ascii=False)) > _UP_MAX_TOTAL:
            raise HTTPException(status_code=413, detail="Preferenze troppo grandi")  # noqa: F821
    except HTTPException:  # noqa: F821
        raise
    except Exception:  # noqa: BLE001
        pass
    await db.user_prefs.update_one({"user_id": user["user_id"]}, {"$set": {"prefs": prefs, "updated_at": utcnow(), "tenant_id": tenant_id(user)}}, upsert=True)  # noqa: F821
    return {"ok": True, "applied": applied, "rejected": rejected, "count": len(prefs)}
