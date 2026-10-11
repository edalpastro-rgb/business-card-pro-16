# axon_referral_credits.py — V50.z523 — PROGRAMMA REFERRAL «PORTA UN AMICO» con CREDITI AI
#   • Codice univoco per utente, generato al primo onboarding (registrazione): NOME + 3 cifre casuali (es. MARIO482).
#     I codici già distribuiti (formato AMICO-…) restano validi.
#   • Chi invita riceve 30 CREDITI AI BONUS quando il collega si registra con il suo codice.
#   • Il collega riceve 30 CREDITI AI BONUS quando attiva l'abbonamento a pagamento (hook su _pw_grant_days, una sola volta).
#   • Crediti AI: BASE mensili (si azzerano ogni mese al valore del workspace, default 300) + BONUS (non scadono mai).
#     1 credito = 1 messaggio ad Axon (chat/stream/voce). Consumo: prima i base, poi i bonus. Il blocco a crediti esauriti è
#     OPZIONALE per workspace (enforce_credits, default off) per non interrompere chi paga: di default si contano soltanto.
#   • Attivabile/disattivabile dal pannello admin PER WORKSPACE (db.referral_workspace), oltre all'interruttore globale esistente.
#   • Il messaggio di invito usa il NOME DELL'APP del workspace di chi condivide (db.settings.app_name → org_branding.company_name → AdvisorOS).
#   Collezioni: ai_credits {user_id, base_credits, base_month, bonus_credits}, ai_credit_events (ledger), referral_workspace {tenant_id,
#   enabled, monthly_base_credits, enforce_credits}, referrals (+ status, inviter_credits, invitee_credits, invitee_credits_granted_at).
import random as _rc_random
import re as _rc_re

REF_INVITER_CREDITS = 30
REF_INVITEE_CREDITS = 30
AI_CREDITS_MONTHLY_BASE = 300
_RC_TENANT_SETTINGS_PROJ = {"_id": 0, "enabled": 1, "monthly_base_credits": 1, "enforce_credits": 1}


# ───────────────────────────── workspace settings ─────────────────────────────
async def _rc_ws(tenant_uid: str) -> dict:
    d = await db.referral_workspace.find_one({"tenant_id": tenant_uid}, _RC_TENANT_SETTINGS_PROJ) or {}
    return {"enabled": bool(d.get("enabled", True)), "monthly_base_credits": int(d.get("monthly_base_credits") or AI_CREDITS_MONTHLY_BASE),
            "enforce_credits": bool(d.get("enforce_credits", False))}


async def _rc_app_name(user: dict) -> str:
    tid = tenant_id(user)
    st = await db.settings.find_one({"user_id": tid}, {"_id": 0, "app_name": 1}) or {}
    if (st.get("app_name") or "").strip():
        return st["app_name"].strip()
    ob = await db.org_branding.find_one({"tenant_id": tid}, {"_id": 0, "company_name": 1}) or {}
    return (ob.get("company_name") or "").strip() or "AdvisorOS"


# ───────────────────────────── codice NOME+3 cifre ─────────────────────────────
async def _ref_code_for(user: dict) -> str:  # noqa: F811 — sostituisce il formato AMICO-… di axon_referral.py
    if user.get("referral_code"):
        return user["referral_code"]
    raw = ((user.get("first_name") or user.get("name") or (user.get("email") or "AMICO").split("@")[0]).strip().split() or ["AMICO"])[0]  # solo il NOME
    base = _rc_re.sub(r"[^A-Z]", "", raw.upper())[:10] or "AMICO"
    for _ in range(50):
        code = f"{base}{_rc_random.randint(0, 999):03d}"
        if not await db.users.find_one({"referral_code": code}, {"_id": 1}) and not await db.promo_codes.find_one({"code": code}, {"_id": 1}):
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"referral_code": code, "referral_code_at": utcnow()}})
            return code
    raise HTTPException(status_code=500, detail="Impossibile generare il codice invito")


# generazione al primo onboarding: hook già chiamato da /auth/register con il documento utente appena creato
_rc_orig_email_on_register = globals().get("_email_on_register")


async def _email_on_register(doc: dict) -> None:  # noqa: F811
    try:
        await _ref_code_for(doc)
    except Exception as e:  # noqa: BLE001
        logger.warning("[referral] codice invito non generato per %s: %s", doc.get("email"), e)
    if _rc_orig_email_on_register:
        await _rc_orig_email_on_register(doc)


# ───────────────────────────── crediti AI ─────────────────────────────
def _rc_month() -> str:
    return utcnow().strftime("%Y-%m")


async def _credits_get(user: dict) -> dict:
    """Saldo crediti dell'utente; azzera/ricarica i base al cambio mese (al valore del workspace)."""
    ws = await _rc_ws(tenant_id(user))
    month = _rc_month()
    d = await db.ai_credits.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not d or d.get("base_month") != month:
        await db.ai_credits.update_one({"user_id": user["user_id"]}, {"$set": {"base_credits": ws["monthly_base_credits"], "base_month": month, "updated_at": utcnow()},
                                                                       "$setOnInsert": {"bonus_credits": 0, "created_at": utcnow()}}, upsert=True)
        d = await db.ai_credits.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"base_credits": int(d.get("base_credits") or 0), "bonus_credits": int(d.get("bonus_credits") or 0), "base_month": month,
            "monthly_base": ws["monthly_base_credits"], "enforce": ws["enforce_credits"],
            "total": int(d.get("base_credits") or 0) + int(d.get("bonus_credits") or 0)}


async def _credits_add_bonus(user_id: str, amount: int, reason: str, ref: Optional[str] = None) -> None:
    await db.ai_credits.update_one({"user_id": user_id}, {"$inc": {"bonus_credits": int(amount)}, "$set": {"updated_at": utcnow()},
                                                      "$setOnInsert": {"base_credits": 0, "base_month": None, "created_at": utcnow()}}, upsert=True)
    await db.ai_credit_events.insert_one({"user_id": user_id, "kind": "bonus", "amount": int(amount), "reason": reason, "ref": ref, "at": utcnow()})


async def _credits_consume(user: dict, amount: int = 1) -> dict:
    bal = await _credits_get(user)
    if bal["total"] <= 0:
        if bal["enforce"]:
            # V50.z524 — codice macchina: il frontend (AssistantChat) lo riconosce e mostra la card «Crediti AI esauriti» con richiesta add-on
            raise HTTPException(status_code=402, detail="ai_credits_exhausted")
        return bal
    use_base = min(amount, bal["base_credits"]); use_bonus = min(amount - use_base, bal["bonus_credits"])
    await db.ai_credits.update_one({"user_id": user["user_id"]}, {"$inc": {"base_credits": -use_base, "bonus_credits": -use_bonus}, "$set": {"updated_at": utcnow()}})
    bal["base_credits"] -= use_base; bal["bonus_credits"] -= use_bonus; bal["total"] -= (use_base + use_bonus)
    return bal


# consumo: 1 credito per ogni messaggio ad Axon — ri-registro /assistant/chat (non-stream) e /assistant/chat/stream con un wrapper
# sottile che scala il credito e poi chiama l'endpoint originale (pattern remove+re-register del progetto; il non-stream NON passa da
# _prepare_assistant_prompt, quindi un hook lì non basterebbe).
def _rc_take_route(suffix: str):
    for _r in list(api_router.routes):
        if getattr(_r, "path", "").endswith(suffix) and "POST" in (getattr(_r, "methods", None) or set()):
            api_router.routes.remove(_r)
            return _r.endpoint
    return None


_rc_orig_chat = _rc_take_route("/assistant/chat")
_rc_orig_stream = _rc_take_route("/assistant/chat/stream")

if _rc_orig_chat is not None:
    @api_router.post("/assistant/chat")
    async def assistant_chat(body: AssistantChatIn, user=Depends(get_current_user)):  # noqa: F811, F821
        await _credits_consume(user, 1)
        return await _rc_orig_chat(body, user)

if _rc_orig_stream is not None:
    @api_router.post("/assistant/chat/stream")
    async def assistant_chat_stream(body: AssistantChatStreamIn, user=Depends(get_current_user)):  # noqa: F811, F821
        await _credits_consume(user, 1)
        return await _rc_orig_stream(body, user)


def _rc_next_renewal() -> str:
    """Primo giorno del mese successivo (ISO date) — i crediti base si ricaricano il 1° del mese."""
    now = utcnow()
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return f"{y:04d}-{m:02d}-01"


async def _rc_open_addon_request(user_id: str) -> Optional[dict]:
    return await db.ai_credit_addon_requests.find_one({"user_id": user_id, "status": "open"}, {"_id": 0, "req_id": 1, "created_at": 1})


@api_router.get("/ai/credits/me")
async def ai_credits_me(user=Depends(get_current_user)):
    bal = await _credits_get(user)
    ev = await db.ai_credit_events.find({"user_id": user["user_id"]}, {"_id": 0}).sort("at", -1).to_list(20)
    for e in ev:
        e["at"] = e["at"].isoformat() if isinstance(e.get("at"), datetime) else e.get("at")
    return {**bal, "events": ev, "renews_on": _rc_next_renewal(), "addon_request_open": bool(await _rc_open_addon_request(user["user_id"]))}


# ───────────────────────────── V50.z524 — pacchetto add-on: richiesta manuale all'admin ─────────────────────────────
# L'utente a crediti esauriti chiede un pacchetto add-on dalla chat; il Master lo accredita (crediti BONUS, non scadono) dal pannello
# «Porta un amico». Nessun pagamento Stripe per ora. Collezione: ai_credit_addon_requests {req_id, user_id, tenant_id, email, name,
# note, balance, status: open|granted|rejected, credits_granted, handled_by, handled_at}. Max 1 richiesta aperta per utente.
ADDON_PACK_DEFAULT_CREDITS = 100


class AddonRequestIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class AddonHandleIn(BaseModel):
    action: str = Field(pattern="^(grant|reject)$")
    credits: Optional[int] = Field(default=None, ge=1, le=100000)


@api_router.post("/ai/credits/addon-request")
async def ai_credits_addon_request(body: AddonRequestIn, user=Depends(get_current_user)):
    existing = await _rc_open_addon_request(user["user_id"])
    if existing:
        return {"ok": True, "already": True, "req_id": existing["req_id"], "message": "Richiesta già inviata: ti ricontattiamo al più presto."}
    bal = await _credits_get(user)
    req_id = f"addon_{uuid.uuid4().hex[:10]}"
    name = user.get("name") or " ".join(x for x in [user.get("first_name"), user.get("last_name")] if x)
    await db.ai_credit_addon_requests.insert_one({
        "req_id": req_id, "user_id": user["user_id"], "tenant_id": tenant_id(user), "email": user.get("email"), "name": name,
        "note": (body.note or "").strip() or None, "balance": {"base": bal["base_credits"], "bonus": bal["bonus_credits"]},
        "status": "open", "created_at": utcnow(),
    })
    admins = sorted(_super_admin_emails_env()) or [BILLING_SUPPORT_EMAIL]  # noqa: F821 — axon_paywall.py
    html = (f"<p>Richiesta pacchetto add-on crediti AI.</p><ul><li><b>Utente:</b> {name or ''} &lt;{user.get('email')}&gt;</li>"
            f"<li><b>Saldo:</b> base {bal['base_credits']} · bonus {bal['bonus_credits']}</li><li><b>Nota:</b> {(body.note or '').strip() or '—'}</li></ul>"
            f"<p>Accredita da Master → Porta un amico → Richieste add-on.</p>")
    sent = []
    for to in admins:
        try:
            await _pl_send_resend(to=to, subject=f"[AdvisorOS] Richiesta add-on crediti AI — {name or user.get('email')}", html=html)  # noqa: F821
            sent.append(to)
        except Exception as e:  # noqa: BLE001
            logger.warning("[addon] email a %s fallita: %s", to, str(e)[:120])
    await db.ai_credit_addon_requests.update_one({"req_id": req_id}, {"$set": {"emailed_to": sent}})
    return {"ok": True, "req_id": req_id, "emailed": bool(sent), "message": "Richiesta inviata: ti ricontattiamo al più presto."}


@api_router.get("/admin/ai-credits/addon-requests")
async def admin_addon_requests(status: Optional[str] = "open", user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    q = {"status": status} if status else {}
    rows = await db.ai_credit_addon_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    for r in rows:
        for k in ("created_at", "handled_at"):
            if isinstance(r.get(k), datetime):
                r[k] = r[k].isoformat()
    return {"items": rows, "default_credits": ADDON_PACK_DEFAULT_CREDITS}


@api_router.post("/admin/ai-credits/addon-requests/{req_id}/handle")
async def admin_addon_request_handle(req_id: str, body: AddonHandleIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    credits = int(body.credits or ADDON_PACK_DEFAULT_CREDITS) if body.action == "grant" else 0
    r = await db.ai_credit_addon_requests.find_one_and_update(
        {"req_id": req_id, "status": "open"},
        {"$set": {"status": "granted" if body.action == "grant" else "rejected", "credits_granted": credits, "handled_by": user["user_id"], "handled_at": utcnow()}},
        projection={"_id": 0, "user_id": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Richiesta non trovata o già gestita")
    if credits:
        await _credits_add_bonus(r["user_id"], credits, "addon_pack", req_id)
    return {"ok": True, "req_id": req_id, "status": "granted" if credits else "rejected", "credits": credits}


# ───────────────────────────── /referral/me (crediti + nome app + flag workspace) ─────────────────────────────
for _r in list(api_router.routes):  # pattern del progetto: rimuovo la route originale (first-match) e la ri-registro
    if getattr(_r, "path", "").endswith("/referral/me") and "GET" in (getattr(_r, "methods", None) or set()):
        api_router.routes.remove(_r)


@api_router.get("/referral/me")
async def referral_me(user=Depends(get_current_user)):  # noqa: F811
    st = await _ref_settings()
    ws = await _rc_ws(tenant_id(user))
    enabled = bool(st["enabled"]) and ws["enabled"]
    code = await _ref_code_for(user)
    app_name = await _rc_app_name(user)
    rows = await db.referrals.find({"inviter_user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    friends = []
    credits_earned = 0
    for r in rows:
        credits_earned += int(r.get("inviter_credits") or 0)
        friends.append({"name": r.get("invitee_name") or r.get("invitee_email"), "email": r.get("invitee_email"),
                        "created_at": r["created_at"].isoformat() if isinstance(r.get("created_at"), datetime) else r.get("created_at"),
                        "status": r.get("status") or "registered", "reward": f"+{int(r.get('inviter_credits') or 0)} crediti AI"})
    bal = await _credits_get(user)
    first = user.get("first_name") or (user.get("name") or "").split(" ")[0] or ""
    share_text = (f"Ciao! Uso {app_name} per gestire clienti, appuntamenti e bollette con l'aiuto di Axon, l'assistente AI. "
                  f"Registrati con il mio codice invito {code}: quando attivi l'abbonamento ricevi {REF_INVITEE_CREDITS} crediti AI bonus in regalo 🎁"
                  + (f" — {first}" if first else ""))
    return {
        "code": code, "share_path": f"/login?ref={code}", "share_text": share_text, "app_name": app_name, "enabled": enabled,
        "workspace_enabled": ws["enabled"], "program_enabled": bool(st["enabled"]),
        "reward_inviter": {"summary": f"{REF_INVITER_CREDITS} crediti AI bonus", "credits": REF_INVITER_CREDITS, "when": "quando il collega si registra"},
        "reward_invitee": {"summary": f"{REF_INVITEE_CREDITS} crediti AI bonus", "credits": REF_INVITEE_CREDITS, "when": "quando attiva l'abbonamento"},
        "friends_count": len(rows), "credits_earned": credits_earned, "days_earned": 0, "friends": friends,
        "credits": {"base": bal["base_credits"], "bonus": bal["bonus_credits"], "total": bal["total"], "monthly_base": bal["monthly_base"]},
        "referred_by": bool(user.get("referred_by_user_id")),
    }


# ───────────────────────────── riscatto (registrazione) → 30 crediti a chi invita ─────────────────────────────
async def _ref_redeem(code: str, user: dict, target: dict) -> dict:  # noqa: F811
    inviter = await db.users.find_one({"referral_code": code})
    if not inviter:
        raise HTTPException(status_code=404, detail="Codice non valido")
    st = await _ref_settings()
    ws = await _rc_ws(tenant_id(inviter))
    if not st["enabled"] or not ws["enabled"]:
        raise HTTPException(status_code=410, detail="Il programma «Porta un amico» non è attivo per questo workspace")
    if inviter["user_id"] in (user["user_id"], target["user_id"]) or inviter.get("parent_user_id") == target["user_id"] or user.get("parent_user_id") == inviter["user_id"]:
        raise HTTPException(status_code=400, detail="Non puoi usare il tuo codice invito (o quello del tuo team)")
    if target.get("referred_by_user_id") or user.get("referred_by_user_id"):
        raise HTTPException(status_code=409, detail="Hai già usato un codice invito")
    now = utcnow()
    rid = str(uuid.uuid4())
    await db.users.update_one({"user_id": target["user_id"]}, {"$set": {"referred_by_user_id": inviter["user_id"], "referred_at": now, "referral_id": rid}})
    if user["user_id"] != target["user_id"]:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"referred_by_user_id": inviter["user_id"], "referred_at": now, "referral_id": rid}})
    name = " ".join(x for x in [user.get("first_name"), user.get("last_name")] if x).strip() or user.get("name") or user.get("email") or ""
    await db.referrals.insert_one({
        "referral_id": rid, "inviter_user_id": inviter["user_id"], "invitee_user_id": user["user_id"], "invitee_tenant_id": target["user_id"],
        "invitee_email": user.get("email"), "invitee_name": name, "code": code, "status": "registered",
        "inviter_credits": REF_INVITER_CREDITS, "invitee_credits": REF_INVITEE_CREDITS, "invitee_credits_granted_at": None, "created_at": now,
    })
    await _credits_add_bonus(inviter["user_id"], REF_INVITER_CREDITS, "referral_signup", rid)
    inviter_name = inviter.get("first_name") or inviter.get("name") or "un collega"
    return {"ok": True, "code": code, "kind": "referral", "benefit_type": "credits",
            "benefit_summary": f"Codice invito di {inviter_name} · {REF_INVITEE_CREDITS} crediti AI bonus all'attivazione dell'abbonamento",
            "message": f"Codice invito accettato! Quando attiverai l'abbonamento riceverai {REF_INVITEE_CREDITS} crediti AI bonus 🎁"}


# ───────────────────────────── attivazione abbonamento → 30 crediti al collega ─────────────────────────────
_rc_orig_grant_days = _pw_grant_days  # noqa: F821 — axon_paywall.py


async def _pw_grant_days(tenant_uid: str, days: int, *, reason: str) -> dict:  # noqa: F811
    out = await _rc_orig_grant_days(tenant_uid, days, reason=reason)
    try:
        if reason and str(reason).startswith("trial"):
            return out
        ref = await db.referrals.find_one({"invitee_tenant_id": tenant_uid, "invitee_credits_granted_at": None}, {"_id": 0, "referral_id": 1, "invitee_user_id": 1, "invitee_credits": 1})
        if ref:
            now = utcnow()
            r = await db.referrals.update_one({"referral_id": ref["referral_id"], "invitee_credits_granted_at": None},
                                              {"$set": {"invitee_credits_granted_at": now, "status": "subscribed", "subscribed_at": now}})
            if r.modified_count:
                await _credits_add_bonus(ref["invitee_user_id"], int(ref.get("invitee_credits") or REF_INVITEE_CREDITS), "referral_subscription", ref["referral_id"])
                logger.info("[referral] abbonamento attivato da %s → %d crediti bonus al collega", tenant_uid[-8:], REF_INVITEE_CREDITS)
    except Exception as e:  # noqa: BLE001
        logger.warning("[referral] bonus abbonamento non assegnato: %s", e)
    return out


# ───────────────────────────── pannello admin per workspace ─────────────────────────────
class RefWorkspaceIn(BaseModel):
    enabled: Optional[bool] = None
    monthly_base_credits: Optional[int] = Field(default=None, ge=0, le=100000)
    enforce_credits: Optional[bool] = None


@api_router.get("/admin/referral/workspaces")
async def admin_referral_workspaces(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    owners = await db.users.find({"role": "owner", "parent_user_id": {"$in": [None, ""]}}, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "first_name": 1, "last_name": 1}).to_list(2000)
    out = []
    for o in owners:
        ws = await _rc_ws(o["user_id"])
        st = await db.settings.find_one({"user_id": o["user_id"]}, {"_id": 0, "app_name": 1}) or {}
        n = await db.referrals.count_documents({"inviter_user_id": o["user_id"]})
        out.append({"tenant_id": o["user_id"], "email": o.get("email"), "name": o.get("name") or " ".join(x for x in [o.get("first_name"), o.get("last_name")] if x),
                    "app_name": st.get("app_name") or "", "referrals": n, **ws})
    return {"items": out, "program_enabled": (await _ref_settings())["enabled"], "defaults": {"monthly_base_credits": AI_CREDITS_MONTHLY_BASE, "inviter_credits": REF_INVITER_CREDITS, "invitee_credits": REF_INVITEE_CREDITS}}


@api_router.put("/admin/referral/workspaces/{tenant_uid}")
async def admin_referral_workspace_put(tenant_uid: str, body: RefWorkspaceIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    upd["updated_at"] = utcnow(); upd["updated_by"] = user["user_id"]
    await db.referral_workspace.update_one({"tenant_id": tenant_uid}, {"$set": upd}, upsert=True)
    return {"ok": True, "tenant_id": tenant_uid, **(await _rc_ws(tenant_uid))}
