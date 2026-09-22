# axon_promo_codes.py — V50.z320 Codici promozionali (Super Admin crea, qualsiasi utente riscatta)
# Namespace condiviso: api_router, db, get_current_user, require_super_admin, utcnow, uuid, BaseModel, Depends, HTTPException,
# Optional, Literal, Dict, Any, List, datetime, timedelta, timezone, Field, logger.
# Collezioni: promo_codes {code_id, code, description, benefit_type, benefit_value, premium_days, expires_at, max_uses,
#             uses_count, active, created_by, created_at}
#             promo_redemptions {redemption_id, code_id, code, user_id, target_user_id, email, name, benefit_summary, redeemed_at}
# Benefici: free_weeks / free_months → estende trial_expires_at dell'owner del tenant (base = max(oggi, scadenza attuale));
#           premium → advisor_tier = paying_business (per premium_days giorni, poi ripristino via job giornaliero);
#           credits → $inc promo_credits (crediti utilizzo AxonOS).

PROMO_BENEFITS = {
    "free_weeks": "Settimane gratuite",
    "free_months": "Mesi gratuiti",
    "premium": "Accesso funzioni premium",
    "credits": "Crediti AxonOS",
}
_PROMO_PREMIUM_TIER = "paying_business"


class PromoCodeIn(BaseModel):
    code: str = Field(min_length=3, max_length=32)
    description: Optional[str] = Field(default="", max_length=200)
    benefit_type: Literal["free_weeks", "free_months", "premium", "credits"]
    benefit_value: int = Field(default=1, ge=1, le=100000)
    premium_days: Optional[int] = Field(default=None, ge=1, le=3650)
    expires_at: Optional[str] = None  # ISO o GG/MM/AAAA; None = nessuna scadenza
    max_uses: Optional[int] = Field(default=None, ge=1, le=1000000)  # None = illimitato
    active: bool = True


class PromoCodePatchIn(BaseModel):
    description: Optional[str] = Field(default=None, max_length=200)
    expires_at: Optional[str] = None
    clear_expires: bool = False
    max_uses: Optional[int] = Field(default=None, ge=1, le=1000000)
    clear_max_uses: bool = False
    active: Optional[bool] = None


class PromoRedeemIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)


def _promo_norm(code: str) -> str:
    return "".join(ch for ch in (code or "").upper().strip() if ch.isalnum() or ch in "-_")


def _promo_parse_date(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    s = raw.strip()
    try:
        if "/" in s and len(s) == 10:
            d, m, y = s.split("/")
            return datetime(int(y), int(m), int(d), 23, 59, 59, tzinfo=timezone.utc)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        raise HTTPException(status_code=400, detail="Data di scadenza non valida (usa GG/MM/AAAA)")


def _promo_as_dt(v) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return None
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v


def _promo_benefit_summary(doc: dict) -> str:
    t = doc.get("benefit_type")
    v = int(doc.get("benefit_value") or 1)
    if t == "free_weeks":
        return f"{v} settiman{'a' if v == 1 else 'e'} gratuit{'a' if v == 1 else 'e'}"
    if t == "free_months":
        return f"{v} mes{'e' if v == 1 else 'i'} gratuit{'o' if v == 1 else 'i'}"
    if t == "premium":
        pd = doc.get("premium_days")
        return f"Funzioni premium per {pd} giorni" if pd else "Funzioni premium senza scadenza"
    if t == "credits":
        return f"{v} crediti AxonOS"
    return t or ""


def _promo_out(doc: dict) -> dict:
    exp = _promo_as_dt(doc.get("expires_at"))
    now = utcnow()
    max_uses = doc.get("max_uses")
    uses = int(doc.get("uses_count") or 0)
    status = "active"
    if not doc.get("active", True):
        status = "disabled"
    elif exp and exp < now:
        status = "expired"
    elif max_uses and uses >= max_uses:
        status = "exhausted"
    return {
        "code_id": doc["code_id"],
        "code": doc["code"],
        "description": doc.get("description") or "",
        "benefit_type": doc.get("benefit_type"),
        "benefit_label": PROMO_BENEFITS.get(doc.get("benefit_type"), doc.get("benefit_type")),
        "benefit_value": doc.get("benefit_value"),
        "premium_days": doc.get("premium_days"),
        "benefit_summary": _promo_benefit_summary(doc),
        "expires_at": exp.isoformat() if exp else None,
        "max_uses": max_uses,
        "uses_count": uses,
        "active": bool(doc.get("active", True)),
        "status": status,
        "created_at": doc.get("created_at").isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "last_used_at": doc.get("last_used_at").isoformat() if isinstance(doc.get("last_used_at"), datetime) else doc.get("last_used_at"),
    }


# ---------------------------------------------------------------- Super Admin CRUD

@api_router.get("/admin/promo-codes")
async def promo_codes_list(user=Depends(require_super_admin)):
    docs = await db.promo_codes.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": [_promo_out(d) for d in docs], "benefits": [{"id": k, "label": v} for k, v in PROMO_BENEFITS.items()]}


@api_router.post("/admin/promo-codes", status_code=201)
async def promo_codes_create(body: PromoCodeIn, user=Depends(require_super_admin)):
    code = _promo_norm(body.code)
    if len(code) < 3:
        raise HTTPException(status_code=400, detail="Codice troppo corto (min 3 caratteri: lettere, numeri, - _)")
    if await db.promo_codes.find_one({"code": code}):
        raise HTTPException(status_code=409, detail=f"Il codice {code} esiste già")
    if body.benefit_type == "premium" and body.premium_days is None and body.benefit_value > 1:
        # compat: valore usato come giorni se premium_days non indicato
        body.premium_days = body.benefit_value
    doc = {
        "code_id": str(uuid.uuid4()),
        "code": code,
        "description": (body.description or "").strip(),
        "benefit_type": body.benefit_type,
        "benefit_value": body.benefit_value,
        "premium_days": body.premium_days if body.benefit_type == "premium" else None,
        "expires_at": _promo_parse_date(body.expires_at),
        "max_uses": body.max_uses,
        "uses_count": 0,
        "active": body.active,
        "created_by": user["user_id"],
        "created_at": utcnow(),
    }
    await db.promo_codes.insert_one(doc)
    doc.pop("_id", None)
    return _promo_out(doc)


@api_router.patch("/admin/promo-codes/{code_id}")
async def promo_codes_patch(code_id: str, body: PromoCodePatchIn, user=Depends(require_super_admin)):
    doc = await db.promo_codes.find_one({"code_id": code_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Codice non trovato")
    upd: Dict[str, Any] = {}
    if body.description is not None:
        upd["description"] = body.description.strip()
    if body.clear_expires:
        upd["expires_at"] = None
    elif body.expires_at is not None:
        upd["expires_at"] = _promo_parse_date(body.expires_at)
    if body.clear_max_uses:
        upd["max_uses"] = None
    elif body.max_uses is not None:
        upd["max_uses"] = body.max_uses
    if body.active is not None:
        upd["active"] = body.active
    if upd:
        await db.promo_codes.update_one({"code_id": code_id}, {"$set": upd})
    doc = await db.promo_codes.find_one({"code_id": code_id}, {"_id": 0})
    return _promo_out(doc)


@api_router.delete("/admin/promo-codes/{code_id}", status_code=204)
async def promo_codes_delete(code_id: str, user=Depends(require_super_admin)):
    r = await db.promo_codes.delete_one({"code_id": code_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Codice non trovato")
    await db.promo_redemptions.delete_many({"code_id": code_id})
    return None


@api_router.get("/admin/promo-codes/{code_id}/redemptions")
async def promo_codes_redemptions(code_id: str, user=Depends(require_super_admin)):
    doc = await db.promo_codes.find_one({"code_id": code_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Codice non trovato")
    rows = await db.promo_redemptions.find({"code_id": code_id}, {"_id": 0}).sort("redeemed_at", -1).to_list(2000)
    # V50.z321 — coesistenza con «Invita Cliente/Collaboratore»: se l'utente è arrivato da un invito, mostro chi lo ha invitato
    inviter_cache: Dict[str, Optional[str]] = {}
    for r in rows:
        if isinstance(r.get("redeemed_at"), datetime):
            r["redeemed_at"] = r["redeemed_at"].isoformat()
        u = await db.users.find_one({"user_id": r.get("user_id")}, {"_id": 0, "invited_by": 1, "trial_expires_at": 1, "subscription_status": 1})
        inviter_id = (u or {}).get("invited_by")
        if inviter_id and inviter_id not in inviter_cache:
            inviter = await db.users.find_one({"user_id": inviter_id}, {"_id": 0, "email": 1})
            inviter_cache[inviter_id] = (inviter or {}).get("email")
        r["invited_by_email"] = inviter_cache.get(inviter_id) if inviter_id else None
        r["subscription"] = _subscription_state(u) if u else None
    return {"code": _promo_out(doc), "items": rows}


# ---------------------------------------------------------------- Riscatto (tutti gli utenti)

async def _promo_apply_benefit(code_doc: dict, target: dict) -> str:
    """Applica il beneficio al documento utente `target` (owner del tenant). Ritorna il messaggio per l'utente."""
    now = utcnow()
    t = code_doc.get("benefit_type")
    v = int(code_doc.get("benefit_value") or 1)
    uid = target["user_id"]
    if t in ("free_weeks", "free_months"):
        if target.get("subscription_status") == "free_forever":
            return "Il tuo accesso è già illimitato: il codice è stato registrato."
        delta = timedelta(weeks=v) if t == "free_weeks" else timedelta(days=30 * v)
        cur = _promo_as_dt(target.get("trial_expires_at"))
        base = cur if (cur and cur > now) else now
        new_exp = base + delta
        await db.users.update_one({"user_id": uid}, {"$set": {"trial_expires_at": new_exp, "subscription_status": "trial" if target.get("subscription_status") in (None, "trial", "expired") else target.get("subscription_status")}})
        return f"Periodo gratuito esteso fino al {new_exp.strftime('%d/%m/%Y')}."
    if t == "premium":
        pd = code_doc.get("premium_days")
        upd: Dict[str, Any] = {"advisor_tier": _PROMO_PREMIUM_TIER}
        if target.get("advisor_tier") != _PROMO_PREMIUM_TIER:
            upd["promo_prev_tier"] = target.get("advisor_tier") or "test"
        if pd:
            cur_until = _promo_as_dt(target.get("promo_premium_until"))
            base = cur_until if (cur_until and cur_until > now) else now
            upd["promo_premium_until"] = base + timedelta(days=int(pd))
            msg = f"Funzioni premium attive fino al {upd['promo_premium_until'].strftime('%d/%m/%Y')}."
        else:
            upd["promo_premium_until"] = None
            msg = "Funzioni premium attivate senza scadenza."
        await db.users.update_one({"user_id": uid}, {"$set": upd})
        return msg
    if t == "credits":
        await db.users.update_one({"user_id": uid}, {"$inc": {"promo_credits": v}})
        return f"{v} crediti AxonOS aggiunti al tuo account."
    return "Codice applicato."


@api_router.post("/promo/redeem")
async def promo_redeem(body: PromoRedeemIn, user=Depends(get_current_user)):
    code = _promo_norm(body.code)
    if not code:
        raise HTTPException(status_code=400, detail="Inserisci un codice")
    doc = await db.promo_codes.find_one({"code": code})
    if not doc or not doc.get("active", True):
        # V50.z322 — fallback: codice amico («Invita un amico»)
        if code.startswith("AMICO-") or await db.users.find_one({"referral_code": code}, {"_id": 1}):
            target = user
            if user.get("parent_user_id"):
                target = await db.users.find_one({"user_id": user["parent_user_id"]}) or user
            return await _ref_redeem(code, user, target)
        raise HTTPException(status_code=404, detail="Codice non valido")
    now = utcnow()
    exp = _promo_as_dt(doc.get("expires_at"))
    if exp and exp < now:
        raise HTTPException(status_code=410, detail="Codice scaduto")
    if await db.promo_redemptions.find_one({"code_id": doc["code_id"], "user_id": user["user_id"]}):
        raise HTTPException(status_code=409, detail="Hai già utilizzato questo codice")
    if doc.get("max_uses") and int(doc.get("uses_count") or 0) >= int(doc["max_uses"]):
        raise HTTPException(status_code=410, detail="Codice esaurito: ha raggiunto il numero massimo di utilizzi")
    # prenotazione atomica dell'utilizzo (evita superamento max_uses in concorrenza)
    q: Dict[str, Any] = {"code_id": doc["code_id"]}
    if doc.get("max_uses"):
        q["uses_count"] = {"$lt": int(doc["max_uses"])}
    r = await db.promo_codes.update_one(q, {"$inc": {"uses_count": 1}, "$set": {"last_used_at": now}})
    if r.modified_count == 0:
        raise HTTPException(status_code=410, detail="Codice esaurito: ha raggiunto il numero massimo di utilizzi")
    target = user
    if user.get("parent_user_id"):
        target = await db.users.find_one({"user_id": user["parent_user_id"]}) or user
    try:
        message = await _promo_apply_benefit(doc, target)
    except Exception as exc:  # rollback della prenotazione
        await db.promo_codes.update_one({"code_id": doc["code_id"]}, {"$inc": {"uses_count": -1}})
        logger.warning(f"[promo] apply failed {code}: {exc}")
        raise HTTPException(status_code=500, detail="Impossibile applicare il codice, riprova")
    name = " ".join(x for x in [user.get("first_name"), user.get("last_name")] if x).strip() or user.get("email") or ""
    await db.promo_redemptions.insert_one({
        "redemption_id": str(uuid.uuid4()),
        "code_id": doc["code_id"],
        "code": code,
        "user_id": user["user_id"],
        "target_user_id": target["user_id"],
        "email": user.get("email"),
        "name": name,
        "benefit_type": doc.get("benefit_type"),
        "benefit_summary": _promo_benefit_summary(doc),
        "redeemed_at": now,
    })
    return {"ok": True, "code": code, "benefit_type": doc.get("benefit_type"), "benefit_summary": _promo_benefit_summary(doc), "message": message}


@api_router.get("/promo/my")
async def promo_my(user=Depends(get_current_user)):
    rows = await db.promo_redemptions.find({"user_id": user["user_id"]}, {"_id": 0, "code": 1, "benefit_summary": 1, "redeemed_at": 1}).sort("redeemed_at", -1).to_list(50)
    for r in rows:
        if isinstance(r.get("redeemed_at"), datetime):
            r["redeemed_at"] = r["redeemed_at"].isoformat()
    me = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "promo_credits": 1, "promo_premium_until": 1}) or {}
    pu = _promo_as_dt(me.get("promo_premium_until"))
    return {"items": rows, "promo_credits": int(me.get("promo_credits") or 0), "premium_until": pu.isoformat() if pu else None}


# ---------------------------------------------------------------- Job: fine periodo premium → ripristino tier

async def _promo_premium_expiry_job():
    now = utcnow()
    try:
        cur = db.users.find({"promo_premium_until": {"$ne": None, "$lt": now}}, {"user_id": 1, "promo_prev_tier": 1})
        async for u in cur:
            await db.users.update_one(
                {"user_id": u["user_id"]},
                {"$set": {"advisor_tier": u.get("promo_prev_tier") or "test"}, "$unset": {"promo_premium_until": "", "promo_prev_tier": ""}},
            )
            logger.info(f"[promo] premium expired for {u['user_id']} → tier {u.get('promo_prev_tier') or 'test'}")
    except Exception as exc:
        logger.warning(f"[promo] premium expiry job failed: {exc}")
