# axon_referral.py — V50.z322 «Invita un amico»: referral tra utenti con codice personale e premio per chi invita e chi arriva.
# Namespace condiviso (api_router, db, get_current_user, require_super_admin, utcnow, uuid, BaseModel, Field, Depends,
# HTTPException, Optional, Literal, Dict, Any, datetime, timedelta, logger, secrets) + helper di axon_promo_codes
# (_promo_norm, _promo_apply_benefit, _promo_benefit_summary, PROMO_BENEFITS, _promo_as_dt).
# Collezioni: users.referral_code (AMICO-NOME-XXXX, generato alla prima richiesta), users.referred_by_user_id,
#             referrals {referral_id, inviter_user_id, invitee_user_id, invitee_email, invitee_name, code,
#                        inviter_reward, invitee_reward, created_at}
#             referral_settings {_id:"default", enabled, inviter {benefit_type, benefit_value, premium_days},
#                                invitee {…}, updated_at, updated_by}
# Riscatto: POST /promo/redeem accetta anche i codici amico (fallback quando il codice non è un promo).
# SPEC CONDIVISA con AxonOS Lite: stessi endpoint/shape (GET /referral/me, GET/PUT /admin/referral-settings, GET /admin/referrals).

_REF_DEFAULT_REWARD = {"benefit_type": "free_weeks", "benefit_value": 1, "premium_days": None}  # 7 giorni gratis


class RefRewardIn(BaseModel):
    benefit_type: Literal["free_weeks", "free_months", "premium", "credits"] = "free_weeks"
    benefit_value: int = Field(default=1, ge=1, le=100000)
    premium_days: Optional[int] = Field(default=None, ge=1, le=3650)


class RefSettingsIn(BaseModel):
    enabled: Optional[bool] = None
    inviter: Optional[RefRewardIn] = None
    invitee: Optional[RefRewardIn] = None


def _ref_reward_out(r: dict) -> dict:
    d = {"benefit_type": r.get("benefit_type", "free_weeks"), "benefit_value": int(r.get("benefit_value") or 1), "premium_days": r.get("premium_days")}
    d["summary"] = _promo_benefit_summary(d)
    d["label"] = PROMO_BENEFITS.get(d["benefit_type"], d["benefit_type"])
    return d


async def _ref_settings() -> dict:
    d = await db.referral_settings.find_one({"_id": "default"}) or {}
    return {
        "enabled": d.get("enabled", True),
        "inviter": _ref_reward_out(d.get("inviter") or _REF_DEFAULT_REWARD),
        "invitee": _ref_reward_out(d.get("invitee") or _REF_DEFAULT_REWARD),
    }


def _ref_slug(user: dict) -> str:
    raw = (user.get("first_name") or (user.get("name") or "").split(" ")[0] or (user.get("email") or "AMICO").split("@")[0])
    s = "".join(ch for ch in raw.upper() if ch.isalnum())[:8]
    return s or "AMICO"


async def _ref_code_for(user: dict) -> str:
    if user.get("referral_code"):
        return user["referral_code"]
    for _ in range(20):
        code = f"AMICO-{_ref_slug(user)}-{secrets.token_hex(2).upper()}"
        if not await db.users.find_one({"referral_code": code}) and not await db.promo_codes.find_one({"code": code}):
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"referral_code": code}})
            return code
    raise HTTPException(status_code=500, detail="Impossibile generare il codice amico")


def _ref_days_from_reward(r: dict) -> int:
    t = r.get("benefit_type")
    v = int(r.get("benefit_value") or 0)
    if t == "free_weeks":
        return 7 * v
    if t == "free_months":
        return 30 * v
    if t == "premium":
        return int(r.get("premium_days") or 0)
    return 0


@api_router.get("/referral/me")
async def referral_me(user=Depends(get_current_user)):
    st = await _ref_settings()
    code = await _ref_code_for(user)
    rows = await db.referrals.find({"inviter_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    friends = []
    days = 0
    for r in rows:
        days += _ref_days_from_reward(r.get("inviter_reward") or {})
        friends.append({"name": r.get("invitee_name") or r.get("invitee_email"), "email": r.get("invitee_email"),
                        "created_at": r["created_at"].isoformat() if isinstance(r.get("created_at"), datetime) else r.get("created_at"),
                        "reward": (r.get("inviter_reward") or {}).get("summary")})
    return {
        "code": code,
        "share_path": f"/login?ref={code}",
        "share_text": f"Ti regalo {st['invitee']['summary'].lower()} su AdvisorOS: registrati e inserisci il mio codice amico {code}. Anche io ricevo {st['inviter']['summary'].lower()} quando arrivi 🎁",
        "enabled": st["enabled"],
        "reward_inviter": st["inviter"],
        "reward_invitee": st["invitee"],
        "friends_count": len(rows),
        "days_earned": days,
        "friends": friends,
        "referred_by": bool(user.get("referred_by_user_id")),
    }


async def _ref_redeem(code: str, user: dict, target: dict) -> dict:
    """Riscatta un codice amico. Chiamato da /promo/redeem quando il codice non è un promo. Ritorna la risposta o alza HTTPException."""
    inviter = await db.users.find_one({"referral_code": code})
    if not inviter:
        raise HTTPException(status_code=404, detail="Codice non valido")
    st = await _ref_settings()
    if not st["enabled"]:
        raise HTTPException(status_code=410, detail="Il programma «Invita un amico» non è attivo al momento")
    if inviter["user_id"] in (user["user_id"], target["user_id"]) or inviter.get("parent_user_id") == target["user_id"] or user.get("parent_user_id") == inviter["user_id"]:
        raise HTTPException(status_code=400, detail="Non puoi usare il tuo codice amico (o quello del tuo team)")
    if target.get("referred_by_user_id") or user.get("referred_by_user_id"):
        raise HTTPException(status_code=409, detail="Hai già usato un codice amico")
    now = utcnow()
    inv_reward, ee_reward = st["inviter"], st["invitee"]
    msg_invitee = await _promo_apply_benefit(ee_reward, target)
    inviter_target = inviter
    if inviter.get("parent_user_id"):
        inviter_target = await db.users.find_one({"user_id": inviter["parent_user_id"]}) or inviter
    try:
        await _promo_apply_benefit(inv_reward, inviter_target)
    except Exception as exc:
        logger.warning(f"[referral] inviter reward failed: {exc}")
    await db.users.update_one({"user_id": target["user_id"]}, {"$set": {"referred_by_user_id": inviter["user_id"], "referred_at": now}})
    if user["user_id"] != target["user_id"]:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"referred_by_user_id": inviter["user_id"], "referred_at": now}})
    name = " ".join(x for x in [user.get("first_name"), user.get("last_name")] if x).strip() or user.get("name") or user.get("email") or ""
    await db.referrals.insert_one({
        "referral_id": str(uuid.uuid4()), "inviter_user_id": inviter["user_id"], "invitee_user_id": user["user_id"],
        "invitee_email": user.get("email"), "invitee_name": name, "code": code,
        "inviter_reward": inv_reward, "invitee_reward": ee_reward, "created_at": now,
    })
    inviter_name = inviter.get("first_name") or inviter.get("name") or "un amico"
    return {"ok": True, "code": code, "kind": "referral", "benefit_type": ee_reward["benefit_type"],
            "benefit_summary": f"Codice amico di {inviter_name} · {ee_reward['summary']}", "message": msg_invitee}


# ---------------------------------------------------------------- Super Admin

@api_router.get("/admin/referral-settings")
async def referral_settings_get(user=Depends(require_super_admin)):
    st = await _ref_settings()
    st["total_referrals"] = await db.referrals.count_documents({})
    st["benefits"] = [{"id": k, "label": v} for k, v in PROMO_BENEFITS.items()]
    return st


@api_router.put("/admin/referral-settings")
async def referral_settings_put(body: RefSettingsIn, user=Depends(require_super_admin)):
    upd: Dict[str, Any] = {"updated_at": utcnow(), "updated_by": user["user_id"]}
    if body.enabled is not None:
        upd["enabled"] = body.enabled
    for k in ("inviter", "invitee"):
        r = getattr(body, k)
        if r is not None:
            upd[k] = {"benefit_type": r.benefit_type, "benefit_value": r.benefit_value, "premium_days": r.premium_days if r.benefit_type == "premium" else None}
    await db.referral_settings.update_one({"_id": "default"}, {"$set": upd}, upsert=True)
    return await _ref_settings()


@api_router.get("/admin/referrals")
async def referrals_list(user=Depends(require_super_admin)):
    rows = await db.referrals.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    cache: Dict[str, dict] = {}
    out = []
    for r in rows:
        iid = r["inviter_user_id"]
        if iid not in cache:
            u = await db.users.find_one({"user_id": iid}, {"_id": 0, "email": 1, "first_name": 1, "name": 1, "referral_code": 1}) or {}
            cache[iid] = u
        u = cache[iid]
        out.append({
            "referral_id": r["referral_id"], "code": r.get("code"),
            "inviter": {"user_id": iid, "email": u.get("email"), "name": u.get("first_name") or u.get("name") or u.get("email")},
            "invitee": {"user_id": r["invitee_user_id"], "email": r.get("invitee_email"), "name": r.get("invitee_name")},
            "inviter_reward": (r.get("inviter_reward") or {}).get("summary"), "invitee_reward": (r.get("invitee_reward") or {}).get("summary"),
            "created_at": r["created_at"].isoformat() if isinstance(r.get("created_at"), datetime) else r.get("created_at"),
        })
    # classifica invitanti
    top: Dict[str, int] = {}
    for r in rows:
        top[r["inviter_user_id"]] = top.get(r["inviter_user_id"], 0) + 1
    leaderboard = sorted(({"user_id": k, "email": cache.get(k, {}).get("email"), "name": cache.get(k, {}).get("first_name") or cache.get(k, {}).get("name") or cache.get(k, {}).get("email"), "code": cache.get(k, {}).get("referral_code"), "count": v} for k, v in top.items()), key=lambda x: -x["count"])[:20]
    return {"items": out, "total": len(rows), "leaderboard": leaderboard}
