# axon_org_branding.py — V50.z232 — Personalizzazione Aziendale (pannello Master)
# (a) logo aziendale (data URI, max 1.5 MB) che sostituisce il logo AdvisorOS nell'header per TUTTI gli utenti del tenant;
# (b) ragione sociale, P.IVA, indirizzo (+ note) → firma nei PDF generati (note spese), nei documenti e nelle comunicazioni
#     automatiche prodotte da Axon (sezione «FIRMA AZIENDALE» nel prompt). Collection `org_branding {tenant_id, logo_data_uri, company_name, vat, address, extra}`.
import base64 as _ob_b64

_OB_LOGO_MAX = 1_500_000
_OB_LOGO_MIMES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}


def _ob_out(d: Optional[dict]) -> dict:
    d = d or {}
    return {"company_name": d.get("company_name") or "", "vat": d.get("vat") or "", "address": d.get("address") or "", "extra": d.get("extra") or "",
            "logo_data_uri": d.get("logo_data_uri") or None, "logo_name": d.get("logo_name") or None,
            "updated_at": d["updated_at"].isoformat() if isinstance(d.get("updated_at"), datetime) else d.get("updated_at")}


async def _ob_get(tid: str) -> dict:
    return await db.org_branding.find_one({"tenant_id": tid}, {"_id": 0}) or {}


async def _ob_signature(tid: str) -> str:
    """Firma testuale «Ragione sociale · P.IVA … · Indirizzo» (vuota se non configurata)."""
    b = await _ob_get(tid)
    parts = [p for p in [b.get("company_name"), (f"P.IVA {b['vat']}" if b.get("vat") else None), b.get("address"), b.get("extra")] if p]
    return " · ".join(parts)


def _ob_require_owner(user: dict) -> None:
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Solo il Master può modificare la personalizzazione aziendale")


@api_router.get("/org/branding")
async def ob_get(user=Depends(get_current_user)):
    return {**_ob_out(await _ob_get(tenant_id(user))), "can_edit": user.get("role") == "owner"}


class ObIn(BaseModel):
    company_name: Optional[str] = None
    vat: Optional[str] = None
    address: Optional[str] = None
    extra: Optional[str] = None


@api_router.put("/org/branding")
async def ob_put(body: ObIn, user=Depends(get_current_user)):
    _ob_require_owner(user)
    upd = {k: (v or "").strip()[:300] for k, v in body.model_dump().items() if v is not None}
    upd["updated_at"] = utcnow()
    await db.org_branding.update_one({"tenant_id": tenant_id(user)}, {"$set": upd, "$setOnInsert": {"created_at": utcnow()}}, upsert=True)
    return {**_ob_out(await _ob_get(tenant_id(user))), "can_edit": True}


@api_router.post("/org/branding/logo")
async def ob_logo(file: UploadFile = File(...), user=Depends(get_current_user)):
    _ob_require_owner(user)
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in _OB_LOGO_MIMES:
        raise HTTPException(status_code=400, detail="Formato non supportato: usa PNG, JPG o WEBP (meglio PNG trasparente)")
    raw = await file.read(_OB_LOGO_MAX + 1)
    if len(raw) > _OB_LOGO_MAX:
        raise HTTPException(status_code=413, detail="Logo troppo grande: max 1,5 MB")
    if not raw:
        raise HTTPException(status_code=400, detail="File vuoto")
    uri = f"data:{'image/jpeg' if mime == 'image/jpg' else mime};base64,{_ob_b64.b64encode(raw).decode()}"
    await db.org_branding.update_one({"tenant_id": tenant_id(user)}, {"$set": {"logo_data_uri": uri, "logo_name": (file.filename or "logo")[:120], "updated_at": utcnow()}, "$setOnInsert": {"created_at": utcnow()}}, upsert=True)
    return {**_ob_out(await _ob_get(tenant_id(user))), "can_edit": True}


@api_router.delete("/org/branding/logo")
async def ob_logo_delete(user=Depends(get_current_user)):
    _ob_require_owner(user)
    await db.org_branding.update_one({"tenant_id": tenant_id(user)}, {"$unset": {"logo_data_uri": "", "logo_name": ""}, "$set": {"updated_at": utcnow()}})
    return {**_ob_out(await _ob_get(tenant_id(user))), "can_edit": True}


# --- firma nelle comunicazioni/documenti generati da Axon -------------------------------------------------------------
_ob_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _ob_prev_prepare_prompt(user, body)
    try:
        if prep.get("system_message"):
            sig = await _ob_signature(tenant_id(user))
            if sig:
                prep["system_message"] += (f"\n\n🏢 FIRMA AZIENDALE (usala in calce a email, messaggi, documenti, report e comunicazioni automatiche che generi; "
                                           f"non inventare altri dati societari): {sig}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[org-branding] prompt failed: %s", exc)
    return prep
