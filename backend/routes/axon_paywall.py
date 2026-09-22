# =========================================================================
# axon_paywall.py — V50.z330 — Paywall a fine prova + pagamento Stripe (Checkout ospitato) + richiesta attivazione
# =========================================================================
# Namespace condiviso: app, api_router, db, get_current_user, utcnow, uuid, jwt, JWT_SECRET, JWT_ALG, BaseModel, Field,
# Depends, HTTPException, Request, Optional, Literal, datetime, timedelta, timezone, logging, os, asyncio,
# _subscription_state (10), is_super_admin / require_super_admin (36), tenant_id (01), _pl_send_resend (axon_personal_lock).
#
# • Middleware HTTP: se il tenant (owner) ha la prova/abbonamento SCADUTO, ogni /api/* fuori dall'allowlist risponde
#   402 {"detail": "subscription_expired"} → il client mostra /paywall. Allowlist: auth, subscription, promo, referral,
#   billing, webhook, user-settings, manifest, devices. I Super Admin non vengono mai bloccati.
# • GET  /billing/plans                     → piani (server-side), stato abbonamento, email supporto
# • POST /billing/checkout {plan, origin_url} → Stripe Checkout Session (importo fisso lato server) → {url, session_id}
# • GET  /billing/checkout-status/{sid}     → stato pagamento; se pagato accredita i giorni UNA sola volta (idempotente)
# • POST /webhook/stripe                    → stesso accredito idempotente via webhook Stripe
# • POST /billing/activation-request {note} → email al Super Admin (Resend) + record `activation_requests` (max 1 ogni 12 h)
# • GET  /admin/activation-requests · POST /admin/activation-requests/{id}/handle → gestione lato Master
# =========================================================================
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest  # noqa: E402

_PW_LOG = logging.getLogger("axon_paywall")
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
BILLING_SUPPORT_EMAIL = os.environ.get("BILLING_SUPPORT_EMAIL", "info@advisoros.it")

# Piani definiti SOLO lato server (mai importi dal client). Modificabili qui.
BILLING_PLANS = {
    "mensile": {"id": "mensile", "label": "Mensile", "amount": 29.0, "currency": "eur", "days": 30, "desc": "Tutte le funzioni AdvisorOS per 30 giorni"},
    "annuale": {"id": "annuale", "label": "Annuale", "amount": 290.0, "currency": "eur", "days": 365, "desc": "12 mesi al prezzo di 10 — tutte le funzioni", "badge": "-17 %"},
}

_PW_ALLOW_PREFIXES = (
    "/api/auth", "/api/subscription", "/api/promo", "/api/referral", "/api/billing", "/api/webhook",
    "/api/user-settings", "/api/axon/core/manifest", "/api/health", "/api/devices", "/api/axon/app-info", "/api/admin",
)
_PW_CACHE: dict = {}  # user_id → (ts, expired: bool) — 20 s per non fare 2 query DB a ogni richiesta
_PW_CACHE_TTL = 20.0


def _pw_tenant_state(tenant: dict) -> dict:
    return _subscription_state(tenant)  # noqa: F821


async def _pw_is_expired(user_id: str) -> bool:
    import time as _t
    now = _t.monotonic()
    hit = _PW_CACHE.get(user_id)
    if hit and now - hit[0] < _PW_CACHE_TTL:
        return hit[1]
    proj = {"_id": 0, "user_id": 1, "parent_user_id": 1, "subscription_status": 1, "trial_expires_at": 1, "email": 1, "super_admin": 1}
    user = await db.users.find_one({"user_id": user_id}, proj)
    expired = False
    if user and not is_super_admin(user):  # noqa: F821
        tenant = user
        if user.get("parent_user_id"):
            tenant = await db.users.find_one({"user_id": user["parent_user_id"]}, proj) or user
        expired = _pw_tenant_state(tenant).get("status") == "expired"
    _PW_CACHE[user_id] = (now, expired)
    return expired


def _pw_invalidate(user_id: Optional[str] = None) -> None:
    if user_id:
        _PW_CACHE.pop(user_id, None)
    else:
        _PW_CACHE.clear()


@app.middleware("http")
async def _paywall_middleware(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS" or not path.startswith("/api/") or path.startswith(_PW_ALLOW_PREFIXES):
        return await call_next(request)
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        return await call_next(request)
    token = auth.split(" ", 1)[1].strip()
    user_id = None
    try:
        user_id = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG]).get("sub")
    except Exception:
        try:
            sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0, "user_id": 1})
            user_id = (sess or {}).get("user_id")
        except Exception:
            user_id = None
    if not user_id:
        return await call_next(request)
    try:
        if await _pw_is_expired(user_id):
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=402, content={"detail": "subscription_expired"})
    except Exception as e:  # mai bloccare l'app per un errore del paywall
        _PW_LOG.warning("paywall check fallito: %s", str(e)[:120])
    return await call_next(request)


# ---------- piani + stato ----------
@api_router.get("/billing/plans")
async def billing_plans(user=Depends(get_current_user)):
    tid = tenant_id(user)  # noqa: F821
    tenant = await db.users.find_one({"user_id": tid}, {"_id": 0, "password_hash": 0}) or user
    st = _pw_tenant_state(tenant)
    return {
        "plans": list(BILLING_PLANS.values()),
        "state": st,
        "is_owner": tid == user["user_id"],
        "support_email": BILLING_SUPPORT_EMAIL,
        "stripe_enabled": bool(STRIPE_API_KEY),
    }


# ---------- Stripe Checkout ----------
class BillingCheckoutIn(BaseModel):
    plan: Literal["mensile", "annuale"]
    origin_url: str = Field(min_length=8, max_length=300)


def _pw_backend_base(request: Request) -> str:
    # Preferisce l'host pubblico visto dal client (proxy) → webhook raggiungibile da Stripe
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


async def _pw_grant_days(tenant_uid: str, days: int, *, reason: str) -> dict:
    tenant = await db.users.find_one({"user_id": tenant_uid}, {"_id": 0, "trial_expires_at": 1, "subscription_status": 1})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant non trovato")
    now = utcnow()
    cur = tenant.get("trial_expires_at")
    if isinstance(cur, str):
        try:
            cur = datetime.fromisoformat(cur.replace("Z", "+00:00"))
        except Exception:
            cur = None
    if isinstance(cur, datetime) and cur.tzinfo is None:
        cur = cur.replace(tzinfo=timezone.utc)
    base = cur if (isinstance(cur, datetime) and cur > now) else now
    new_exp = base + timedelta(days=days)
    await db.users.update_one({"user_id": tenant_uid}, {"$set": {"trial_expires_at": new_exp, "subscription_status": "active", "subscription_last_grant": {"days": days, "reason": reason, "at": now}}})
    # invalida la cache paywall di tutto il tenant
    _pw_invalidate()
    return {"expires_at": new_exp.isoformat(), "days": days}


@api_router.post("/billing/checkout")
async def billing_checkout(body: BillingCheckoutIn, request: Request, user=Depends(get_current_user)):
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail="Pagamenti non configurati: contatta il supporto")
    plan = BILLING_PLANS[body.plan]
    tid = tenant_id(user)  # noqa: F821
    origin = body.origin_url.rstrip("/")
    if not origin.startswith("http"):
        raise HTTPException(status_code=400, detail="origin_url non valido")
    sc = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=f"{_pw_backend_base(request)}/api/webhook/stripe")
    req = CheckoutSessionRequest(
        amount=float(plan["amount"]), currency=plan["currency"],
        success_url=f"{origin}/paywall?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/paywall?cancelled=1",
        metadata={"user_id": user["user_id"], "tenant_id": tid, "plan": plan["id"], "product": "advisoros"},
    )
    try:
        sess = await sc.create_checkout_session(req)
    except Exception as e:
        _PW_LOG.error("stripe checkout: %s", str(e)[:200])
        raise HTTPException(status_code=502, detail="Impossibile avviare il pagamento, riprova tra poco")
    await db.payment_transactions.insert_one({
        "tx_id": f"ptx_{uuid.uuid4().hex[:12]}", "session_id": sess.session_id, "user_id": user["user_id"], "tenant_id": tid,
        "plan": plan["id"], "amount": plan["amount"], "currency": plan["currency"], "days": plan["days"],
        "payment_status": "pending", "status": "initiated", "created_at": utcnow(), "updated_at": utcnow(),
    })
    return {"url": sess.url, "session_id": sess.session_id}


async def _pw_settle(session_id: str, payment_status: str, status: str) -> dict:
    """Aggiorna la transazione e, se pagata, accredita i giorni UNA sola volta (idempotente)."""
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(status_code=404, detail="Transazione non trovata")
    if tx.get("payment_status") == "paid":
        return {"ok": True, "already": True, "payment_status": "paid", "granted": tx.get("granted")}
    upd = {"payment_status": payment_status, "status": status, "updated_at": utcnow()}
    granted = None
    if payment_status == "paid":
        # claim atomico: solo chi passa da != paid → paid accredita
        r = await db.payment_transactions.update_one({"session_id": session_id, "payment_status": {"$ne": "paid"}}, {"$set": upd})
        if r.modified_count:
            granted = await _pw_grant_days(tx["tenant_id"], int(tx["days"]), reason=f"stripe:{tx['plan']}")
            await db.payment_transactions.update_one({"session_id": session_id}, {"$set": {"granted": granted}})
            await db.activation_requests.update_many({"tenant_id": tx["tenant_id"], "status": "open"}, {"$set": {"status": "paid", "handled_at": utcnow()}})
    else:
        await db.payment_transactions.update_one({"session_id": session_id}, {"$set": upd})
    return {"ok": True, "payment_status": payment_status, "granted": granted}


@api_router.get("/billing/checkout-status/{session_id}")
async def billing_checkout_status(session_id: str, user=Depends(get_current_user)):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx or tx.get("tenant_id") != tenant_id(user):  # noqa: F821
        raise HTTPException(status_code=404, detail="Transazione non trovata")
    if tx.get("payment_status") == "paid":
        return {"payment_status": "paid", "status": tx.get("status"), "plan": tx["plan"], "granted": tx.get("granted"), "state": _pw_tenant_state(await db.users.find_one({"user_id": tx["tenant_id"]}, {"_id": 0}) or {})}
    sc = StripeCheckout(api_key=STRIPE_API_KEY)
    try:
        cs = await sc.get_checkout_status(session_id)
    except Exception as e:
        _PW_LOG.warning("stripe status: %s", str(e)[:160])
        raise HTTPException(status_code=502, detail="Stato pagamento non disponibile, riprova")
    res = await _pw_settle(session_id, cs.payment_status, cs.status)
    tenant = await db.users.find_one({"user_id": tx["tenant_id"]}, {"_id": 0}) or {}
    return {"payment_status": cs.payment_status, "status": cs.status, "plan": tx["plan"], "granted": res.get("granted"), "state": _pw_tenant_state(tenant)}


@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail="Stripe non configurato")
    raw = await request.body()
    sig = request.headers.get("stripe-signature") or ""
    sc = StripeCheckout(api_key=STRIPE_API_KEY)
    try:
        ev = await sc.handle_webhook(raw, sig)
    except Exception as e:
        _PW_LOG.warning("webhook non valido: %s", str(e)[:160])
        raise HTTPException(status_code=400, detail="webhook non valido")
    if ev.session_id and ev.payment_status:
        try:
            await _pw_settle(ev.session_id, ev.payment_status, "complete" if ev.payment_status == "paid" else "open")
        except HTTPException:
            pass
    return {"received": True, "event": ev.event_type}


# ---------- richiesta di attivazione al Super Admin ----------
class ActivationRequestIn(BaseModel):
    note: Optional[str] = Field(None, max_length=500)
    plan: Optional[Literal["mensile", "annuale"]] = None


@api_router.post("/billing/activation-request")
async def billing_activation_request(body: ActivationRequestIn, user=Depends(get_current_user)):
    tid = tenant_id(user)  # noqa: F821
    recent = await db.activation_requests.find_one({"tenant_id": tid, "status": "open", "created_at": {"$gte": utcnow() - timedelta(hours=12)}}, {"_id": 0, "req_id": 1})
    if recent:
        return {"ok": True, "already": True, "req_id": recent["req_id"], "message": "Richiesta già inviata: ti ricontattiamo al più presto."}
    tenant = await db.users.find_one({"user_id": tid}, {"_id": 0, "email": 1, "name": 1, "company": 1, "product": 1}) or {}
    st = _pw_tenant_state(await db.users.find_one({"user_id": tid}, {"_id": 0}) or {})
    req_id = f"actreq_{uuid.uuid4().hex[:10]}"
    doc = {"req_id": req_id, "tenant_id": tid, "user_id": user["user_id"], "email": user.get("email"), "name": user.get("name"),
           "tenant_email": tenant.get("email"), "company": tenant.get("company"), "plan": body.plan, "note": (body.note or "").strip() or None,
           "state": st, "status": "open", "created_at": utcnow()}
    await db.activation_requests.insert_one(doc)
    # email al Super Admin (best effort)
    admins = sorted(_super_admin_emails_env())  # noqa: F821
    if not admins:
        admins = [BILLING_SUPPORT_EMAIL]
    subject = f"[AdvisorOS] Richiesta attivazione — {user.get('name') or user.get('email')}"
    plan_txt = BILLING_PLANS[body.plan]["label"] if body.plan else "non indicato"
    html = (f"<p>Richiesta di attivazione abbonamento.</p><ul><li><b>Utente:</b> {user.get('name') or ''} &lt;{user.get('email')}&gt;</li>"
            f"<li><b>Azienda:</b> {tenant.get('company') or '—'}</li><li><b>Stato:</b> {st.get('status')} (scad. {st.get('expires_at') or '—'})</li>"
            f"<li><b>Piano richiesto:</b> {plan_txt}</li><li><b>Nota:</b> {doc['note'] or '—'}</li></ul>"
            f"<p>Attiva da Master → Clienti (aggiungi giorni) oppure da GET /api/admin/activation-requests.</p>")
    sent = []
    for to in admins:
        try:
            await _pl_send_resend(to=to, subject=subject, html=html)  # noqa: F821
            sent.append(to)
        except Exception as e:
            _PW_LOG.warning("email attivazione a %s fallita: %s", to, str(e)[:120])
    await db.activation_requests.update_one({"req_id": req_id}, {"$set": {"emailed_to": sent}})
    return {"ok": True, "req_id": req_id, "emailed": bool(sent), "message": "Richiesta inviata: ti ricontattiamo al più presto."}


@api_router.get("/admin/activation-requests")
async def admin_activation_requests(status: Optional[str] = None, user=Depends(require_super_admin)):  # noqa: F821
    q = {"status": status} if status else {}
    items = await db.activation_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"items": items}


class ActivationHandleIn(BaseModel):
    action: Literal["grant", "dismiss"]
    days: int = Field(30, ge=1, le=3650)


@api_router.post("/admin/activation-requests/{req_id}/handle")
async def admin_activation_handle(req_id: str, body: ActivationHandleIn, user=Depends(require_super_admin)):  # noqa: F821
    req = await db.activation_requests.find_one({"req_id": req_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    granted = None
    if body.action == "grant":
        granted = await _pw_grant_days(req["tenant_id"], body.days, reason=f"admin:{user['user_id']}")
    await db.activation_requests.update_one({"req_id": req_id}, {"$set": {"status": "granted" if body.action == "grant" else "dismissed", "handled_by": user["user_id"], "handled_at": utcnow(), "granted": granted}})
    return {"ok": True, "granted": granted}
