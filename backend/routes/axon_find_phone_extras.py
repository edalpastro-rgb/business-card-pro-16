# ============================================================================
# V50.z493 — «Trova il mio telefono»: suono personalizzabile + foto di chi ferma lo squillo
# ----------------------------------------------------------------------------
# GET/PUT /axon/find-phone-sound → user_settings.find_phone_sound {kind: preset|custom, preset: axon|bell|siren|beep, mime?, b64?}
#   (registrazione personale ≤ 600 KB base64; lo squillo in-app usa questo suono, il canale di notifica Android resta find_phone.wav)
# POST /axon/find-phone/{cmd_id}/finder-photo {image_base64} → foto frontale silenziosa scattata quando qualcuno tocca lo schermo
#   per fermare lo squillo; salvata sul comando (miniatura, documento transitorio) e letta dal dispositivo sorgente via status/last.
# ============================================================================
from typing import Optional as _fpx_Optional

_FPX_PRESETS = ("axon", "bell", "siren", "beep")
_FPX_MAX_B64 = 600_000


class FindPhoneSoundIn(BaseModel):  # noqa: F821
    kind: str = "preset"  # preset | custom
    preset: _fpx_Optional[str] = "axon"
    mime: _fpx_Optional[str] = None
    b64: _fpx_Optional[str] = None


class FinderPhotoIn(BaseModel):  # noqa: F821
    image_base64: str
    device_id: _fpx_Optional[str] = None


@api_router.get("/axon/find-phone-sound")  # noqa: F821
async def find_phone_sound_get(user=Depends(get_current_user)):  # noqa: F821
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0, "find_phone_sound": 1}) or {}  # noqa: F821
    return {"sound": s.get("find_phone_sound") or {"kind": "preset", "preset": "axon"}}


@api_router.put("/axon/find-phone-sound")  # noqa: F821
async def find_phone_sound_put(body: FindPhoneSoundIn, user=Depends(get_current_user)):  # noqa: F821
    if body.kind == "custom":
        if not body.b64 or len(body.b64) < 500:
            raise HTTPException(status_code=400, detail="Registrazione vuota")  # noqa: F821
        if len(body.b64) > _FPX_MAX_B64:
            raise HTTPException(status_code=413, detail="Registrazione troppo lunga (max ~8 s)")  # noqa: F821
        doc = {"kind": "custom", "mime": body.mime or "audio/m4a", "b64": body.b64, "updated_at": utcnow()}  # noqa: F821
    else:
        if (body.preset or "axon") not in _FPX_PRESETS:
            raise HTTPException(status_code=400, detail="preset: axon | bell | siren | beep")  # noqa: F821
        doc = {"kind": "preset", "preset": body.preset or "axon", "updated_at": utcnow()}  # noqa: F821
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"find_phone_sound": doc}}, upsert=True)  # noqa: F821
    return {"ok": True, "sound": {k: v for k, v in doc.items() if k != "b64"} | ({"has_custom": True} if doc["kind"] == "custom" else {})}


@api_router.post("/axon/find-phone/{cmd_id}/finder-photo")  # noqa: F821
async def find_phone_finder_photo(cmd_id: str, body: FinderPhotoIn, user=Depends(get_current_user)):  # noqa: F821
    b64 = (body.image_base64 or "").split(",")[-1]
    if len(b64) < 200:
        raise HTTPException(status_code=400, detail="Foto vuota")  # noqa: F821
    if len(b64) > 900_000:
        raise HTTPException(status_code=413, detail="Foto troppo grande")  # noqa: F821
    r = await db.find_phone_cmds.update_one({"cmd_id": cmd_id, "user_id": user["user_id"]}, {"$set": {"finder_photo": b64, "finder_photo_at": utcnow(), "finder_device_id": body.device_id or ""}})  # noqa: F821
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Comando non trovato")  # noqa: F821
    return {"ok": True}
