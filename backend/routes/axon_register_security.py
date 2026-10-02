# axon_register_security.py — V50.z434 — «Fort Knox» registrazione + Email di benvenuto configurabile dal Master
#
# ANTI-BOT (sempre attivo, nessun servizio esterno) + Cloudflare Turnstile (se il Master configura le chiavi):
#   1. GET  /auth/register/challenge   → challenge_id, prefix PoW, difficulty, min_fill_ms, turnstile_site_key, privacy_url
#   2. POST /auth/register (03_auth)   → _register_guard_check(body, request):
#        • rate limiting IP (N/ora, M/giorno) ed email (per indirizzo normalizzato, Gmail dots/+ inclusi)
#        • honeypot `hp` deve essere vuoto
#        • challenge valida, non usata, età ≥ min_fill_ms (bot compilano in <1 s), ≤ 15 min
#        • proof-of-work: sha256(prefix + nonce) inizia con `difficulty` zeri esadecimali
#        • Turnstile token verificato su challenges.cloudflare.com (se secret configurato)
#        • blocco domini email usa-e-getta (lista integrata + domini aggiunti dal Master)
#        • privacy_accepted obbligatorio
#      Ogni blocco è registrato in db.register_blocked (motivo, ip, email mascherata) → stats per il Master.
#   Master: GET/PUT /admin/register-guard, GET /admin/register-guard/stats
# EMAIL DI BENVENUTO (dopo l'attivazione dell'account in /auth/verify-email):
#   db.app_settings{key:"welcome_email"}: enabled, subject, body (segnaposto {nome} {cognome} {email} {codice_promo}
#   {link_privacy} {link_app}), promo_code, privacy_url, app_url. Master: GET/PUT /admin/welcome-email, POST /admin/welcome-email/test
# Namespace condiviso: api_router, db, require_super_admin, get_current_user, utcnow, logger, HTTPException, Request, BaseModel, Field, Optional…

import hashlib as _rs_hashlib
import html as _rs_html

_RS_DEFAULT_PRIVACY_URL = "https://advisoros.it/privacy"
_RS_DEFAULT_APP_URL = "https://advisoros.it"

_RS_DISPOSABLE = {
    "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org",
    "yopmail.com", "yopmail.fr", "throwawaymail.com", "trashmail.com", "trashmail.de", "getnada.com", "maildrop.cc", "dispostable.com",
    "fakeinbox.com", "mohmal.com", "sharklasers.com", "grr.la", "guerrillamailblock.com", "spam4.me", "mailnesia.com", "mintemail.com",
    "tempr.email", "discard.email", "emailondeck.com", "mytemp.email", "tempmailo.com", "burnermail.io", "inboxkitten.com", "moakt.com",
    "tmpmail.org", "tmpmail.net", "mail-temp.com", "emailfake.com", "crazymailing.com", "spamgourmet.com", "mailcatch.com", "mailsac.com",
    "33mail.com", "anonaddy.me", "trash-mail.com", "wegwerfmail.de", "einrot.com", "armyspy.com", "cuvox.de", "dayrep.com", "fleckens.hu",
    "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us", "nwytg.net", "tempinbox.com", "mailexpire.com",
}

_RS_GUARD_DEFAULTS: Dict[str, Any] = {
    "enabled": True,
    "pow_difficulty": 4,          # zeri esadecimali richiesti (4 ≈ 65k hash ≈ < 1 s su telefono)
    "min_fill_ms": 3000,          # tempo minimo tra apertura modulo e invio
    "ip_per_hour": 5,
    "ip_per_day": 12,
    "email_per_day": 3,
    "block_disposable": True,
    "extra_blocked_domains": [],
    "turnstile_site_key": "",
    "turnstile_secret": "",
    "privacy_url": _RS_DEFAULT_PRIVACY_URL,
}

_RS_WELCOME_DEFAULTS: Dict[str, Any] = {
    "enabled": True,
    "subject": "Benvenuto in AdvisorOS, {nome}!",
    "body": (
        "Ciao {nome},\n\n"
        "il tuo account AdvisorOS è attivo. Ecco i primi passi:\n"
        "1. Apri l'app e completa il profilo (Impostazioni → Profilo).\n"
        "2. Importa i tuoi contatti (Contatti → Importa) o aggiungine uno a voce con Axon.\n"
        "3. Prova Axon: tocca il pulsante viola e chiedi «Cosa posso fare oggi?».\n\n"
        "Codice promozionale per te: {codice_promo}\n\n"
        "Informativa privacy: {link_privacy}\n"
        "Apri AdvisorOS: {link_app}\n\n"
        "A presto,\nil team AdvisorOS"
    ),
    "promo_code": "",
    "privacy_url": _RS_DEFAULT_PRIVACY_URL,
    "app_url": _RS_DEFAULT_APP_URL,
}


async def _rs_settings(key: str, defaults: Dict[str, Any]) -> Dict[str, Any]:
    doc = await db.app_settings.find_one({"key": key}, {"_id": 0, "key": 0}) or {}
    return {**defaults, **doc}


def _rs_norm_email(email: str) -> str:
    e = (email or "").strip().lower()
    if "@" not in e:
        return e
    local, dom = e.rsplit("@", 1)
    local = local.split("+", 1)[0]
    if dom in ("gmail.com", "googlemail.com"):
        local = local.replace(".", "")
        dom = "gmail.com"
    return f"{local}@{dom}"


def _rs_mask(email: str) -> str:
    if "@" not in (email or ""):
        return "***"
    local, dom = email.rsplit("@", 1)
    return f"{local[:2]}***@{dom}"


def _rs_client_ip(request) -> str:
    try:
        xff = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")
        if xff:
            return xff.split(",")[0].strip()
        return request.client.host if request.client else "?"
    except Exception:
        return "?"


async def _rs_block(reason: str, ip: str, email: str, detail: str = "") -> None:
    try:
        await db.register_blocked.insert_one({"reason": reason, "ip": ip, "email": _rs_mask(email), "email_norm": _rs_norm_email(email), "detail": detail[:200], "at": utcnow()})
    except Exception:
        pass


async def _rs_count(coll, q: Dict[str, Any]) -> int:
    try:
        return await coll.count_documents(q)
    except Exception:
        return 0


# ---------------------------------------------------------------- challenge

@api_router.get("/auth/register/challenge")
async def register_challenge(request: Request):
    cfg = await _rs_settings("register_guard", _RS_GUARD_DEFAULTS)
    ip = _rs_client_ip(request)
    # anti-flood sulle challenge stesse
    if await _rs_count(db.register_challenges, {"ip": ip, "created_at": {"$gt": utcnow() - timedelta(minutes=10)}}) > 30:
        raise HTTPException(status_code=429, detail="Troppe richieste. Riprova tra qualche minuto.")
    cid = secrets.token_urlsafe(18)
    prefix = secrets.token_hex(12)
    await db.register_challenges.insert_one({"challenge_id": cid, "prefix": prefix, "difficulty": int(cfg["pow_difficulty"]), "ip": ip, "created_at": utcnow(), "used": False})
    return {
        "challenge_id": cid, "prefix": prefix, "difficulty": int(cfg["pow_difficulty"]), "min_fill_ms": int(cfg["min_fill_ms"]),
        "turnstile_site_key": (cfg.get("turnstile_site_key") or "") if cfg.get("turnstile_secret") else "",
        "privacy_url": cfg.get("privacy_url") or _RS_DEFAULT_PRIVACY_URL,
    }


async def _rs_verify_turnstile(secret: str, token: str, ip: str) -> bool:
    try:
        async with _httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", data={"secret": secret, "response": token, "remoteip": ip})
            return bool(r.json().get("success"))
    except Exception as exc:
        logger.warning(f"[register-guard] turnstile verify error: {exc}")
        return False


async def _register_guard_check(body, request) -> None:
    """Solleva HTTPException se la registrazione sembra automatica. Chiamata da 03_auth.register PRIMA di creare l'utente."""
    cfg = await _rs_settings("register_guard", _RS_GUARD_DEFAULTS)
    ip = _rs_client_ip(request)
    email = str(body.email).lower()
    now = utcnow()

    if not getattr(body, "privacy_accepted", False):
        raise HTTPException(status_code=422, detail="Devi accettare l'informativa privacy per registrarti.")
    if not cfg.get("enabled", True):
        return

    # honeypot
    if (getattr(body, "hp", "") or "").strip():
        await _rs_block("honeypot", ip, email)
        raise HTTPException(status_code=400, detail="Registrazione non consentita.")

    # email usa-e-getta
    dom = email.rsplit("@", 1)[-1]
    blocked_domains = set(d.lower() for d in (cfg.get("extra_blocked_domains") or []))
    if (cfg.get("block_disposable", True) and dom in _RS_DISPOSABLE) or dom in blocked_domains:
        await _rs_block("disposable_email", ip, email, dom)
        raise HTTPException(status_code=400, detail="Indirizzi email temporanei non sono ammessi: usa la tua email personale o aziendale.")

    # rate limiting (registrazioni riuscite + bloccate)
    hour_ago, day_ago = now - timedelta(hours=1), now - timedelta(days=1)
    ip_hour = await _rs_count(db.users, {"register_ip": ip, "created_at": {"$gt": hour_ago}}) + await _rs_count(db.register_blocked, {"ip": ip, "at": {"$gt": hour_ago}})
    ip_day = await _rs_count(db.users, {"register_ip": ip, "created_at": {"$gt": day_ago}}) + await _rs_count(db.register_blocked, {"ip": ip, "at": {"$gt": day_ago}})
    if ip_hour >= int(cfg["ip_per_hour"]) or ip_day >= int(cfg["ip_per_day"]):
        await _rs_block("rate_ip", ip, email, f"{ip_hour}/h {ip_day}/d")
        raise HTTPException(status_code=429, detail="Troppe registrazioni da questa rete. Riprova più tardi.")
    norm = _rs_norm_email(email)
    if await _rs_count(db.users, {"email_normalized": norm}) >= 1 or await _rs_count(db.register_blocked, {"email_norm": norm, "at": {"$gt": day_ago}}) >= int(cfg["email_per_day"]):
        await _rs_block("rate_email", ip, email, norm)
        raise HTTPException(status_code=400, detail="Email già registrata o troppi tentativi con questo indirizzo.")

    # challenge + tempo minimo + proof-of-work
    cid = getattr(body, "challenge_id", None) or ""
    ch = await db.register_challenges.find_one({"challenge_id": cid}) if cid else None
    if not ch or ch.get("used"):
        await _rs_block("challenge_missing", ip, email)
        raise HTTPException(status_code=400, detail="Verifica di sicurezza mancante: ricarica il modulo e riprova.")
    created = ch["created_at"] if ch["created_at"].tzinfo else ch["created_at"].replace(tzinfo=timezone.utc)
    age_ms = (now - created).total_seconds() * 1000
    if age_ms > 15 * 60 * 1000:
        await _rs_block("challenge_expired", ip, email)
        raise HTTPException(status_code=400, detail="Verifica di sicurezza scaduta: ricarica il modulo e riprova.")
    if age_ms < int(cfg["min_fill_ms"]):
        await _rs_block("too_fast", ip, email, f"{int(age_ms)}ms")
        raise HTTPException(status_code=400, detail="Compilazione troppo rapida. Riprova.")
    nonce = str(getattr(body, "pow_nonce", "") or "")
    digest = _rs_hashlib.sha256((ch["prefix"] + nonce).encode()).hexdigest()
    if not nonce or not digest.startswith("0" * int(ch.get("difficulty") or cfg["pow_difficulty"])):
        await _rs_block("pow_invalid", ip, email)
        raise HTTPException(status_code=400, detail="Verifica di sicurezza non superata: riprova.")

    # Turnstile (se configurato)
    if cfg.get("turnstile_secret"):
        tok = getattr(body, "turnstile_token", None) or ""
        if not tok or not await _rs_verify_turnstile(cfg["turnstile_secret"], tok, ip):
            await _rs_block("turnstile", ip, email)
            raise HTTPException(status_code=400, detail="Verifica anti-bot non superata: completa il controllo e riprova.")

    await db.register_challenges.update_one({"challenge_id": cid}, {"$set": {"used": True, "used_at": now}})
    # metadati salvati sul nuovo utente da 03_auth (register_ip, email_normalized, newsletter_opt_in, privacy_accepted_at)
    body.__dict__["_guard_meta"] = {"register_ip": ip, "email_normalized": norm}


# ---------------------------------------------------------------- Turnstile: pagina widget (iframe web / WebView nativa)
_RS_TURNSTILE_PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:transparent;display:flex;align-items:center;justify-content:center;min-height:70px}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__onTS&render=explicit" async defer></script></head>
<body><div id="w"></div><script>
function __post(m){var s=JSON.stringify(m);try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s);return;}}catch(e){}try{if(window.parent&&window.parent!==window){window.parent.postMessage(s,"*");}}catch(e){}}
function __onTS(){var sk=new URLSearchParams(location.search).get("sitekey")||"";var th=new URLSearchParams(location.search).get("theme")||"auto";
 try{turnstile.render("#w",{sitekey:sk,theme:th,language:"it",callback:function(t){__post({type:"turnstile",token:t});},
 "error-callback":function(){__post({type:"turnstile-error"});},"expired-callback":function(){__post({type:"turnstile-expired"});}});}catch(e){__post({type:"turnstile-error"});}}
</script></body></html>"""


@api_router.get("/auth/register/turnstile-page", include_in_schema=False)
async def register_turnstile_page():
    return HTMLResponse(content=_RS_TURNSTILE_PAGE, headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- Master: register guard

class RegisterGuardIn(BaseModel):
    enabled: Optional[bool] = None
    pow_difficulty: Optional[int] = Field(default=None, ge=2, le=6)
    min_fill_ms: Optional[int] = Field(default=None, ge=0, le=60000)
    ip_per_hour: Optional[int] = Field(default=None, ge=1, le=1000)
    ip_per_day: Optional[int] = Field(default=None, ge=1, le=10000)
    email_per_day: Optional[int] = Field(default=None, ge=1, le=100)
    block_disposable: Optional[bool] = None
    extra_blocked_domains: Optional[List[str]] = None
    turnstile_site_key: Optional[str] = None
    turnstile_secret: Optional[str] = None
    privacy_url: Optional[str] = None


def _rs_guard_out(cfg: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(cfg)
    sec = out.pop("turnstile_secret", "") or ""
    out["turnstile_secret_set"] = bool(sec)
    out["turnstile_secret_hint"] = (sec[:4] + "…" + sec[-3:]) if len(sec) > 8 else ("•••" if sec else "")
    return out


@api_router.get("/admin/register-guard")
async def admin_register_guard_get(user=Depends(require_super_admin)):
    return _rs_guard_out(await _rs_settings("register_guard", _RS_GUARD_DEFAULTS))


@api_router.put("/admin/register-guard")
async def admin_register_guard_put(body: RegisterGuardIn, user=Depends(require_super_admin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "extra_blocked_domains" in upd:
        upd["extra_blocked_domains"] = sorted({d.strip().lower() for d in upd["extra_blocked_domains"] if d and "." in d})
    for k in ("turnstile_site_key", "turnstile_secret", "privacy_url"):
        if k in upd:
            upd[k] = upd[k].strip()
    upd["updated_at"] = utcnow(); upd["updated_by"] = user["user_id"]
    await db.app_settings.update_one({"key": "register_guard"}, {"$set": upd}, upsert=True)
    return _rs_guard_out(await _rs_settings("register_guard", _RS_GUARD_DEFAULTS))


@api_router.get("/admin/register-guard/stats")
async def admin_register_guard_stats(user=Depends(require_super_admin)):
    now = utcnow()
    day_ago, week_ago = now - timedelta(days=1), now - timedelta(days=7)
    pipeline = [{"$match": {"at": {"$gt": week_ago}}}, {"$group": {"_id": "$reason", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}]
    by_reason = [{"reason": r["_id"], "count": r["n"]} async for r in db.register_blocked.aggregate(pipeline)]
    recent = await db.register_blocked.find({}, {"_id": 0}).sort("at", -1).to_list(30)
    for r in recent:
        if isinstance(r.get("at"), datetime):
            r["at"] = r["at"].isoformat()
    return {
        "blocked_24h": await _rs_count(db.register_blocked, {"at": {"$gt": day_ago}}),
        "blocked_7d": await _rs_count(db.register_blocked, {"at": {"$gt": week_ago}}),
        "registered_24h": await _rs_count(db.users, {"created_at": {"$gt": day_ago}}),
        "registered_7d": await _rs_count(db.users, {"created_at": {"$gt": week_ago}}),
        "pending_verification": await _rs_count(db.users, {"email_verified": False}),
        "by_reason": by_reason, "recent": recent,
    }


# ---------------------------------------------------------------- Email di benvenuto

def _rs_render(tpl: str, ctx: Dict[str, str]) -> str:
    out = tpl or ""
    for k, v in ctx.items():
        out = out.replace("{" + k + "}", v or "")
    return out


def _rs_body_html(body_text: str) -> str:
    paras = [p for p in (body_text or "").split("\n\n")]
    html_parts = []
    for p in paras:
        esc = _rs_html.escape(p).replace("\n", "<br>")
        esc = re.sub(r"(https?://[^\s<]+)", r'<a href="\1">\1</a>', esc)
        html_parts.append(f"<p>{esc}</p>")
    return "".join(html_parts)


async def _welcome_email_send(user: dict) -> Optional[Dict[str, Any]]:
    """Invia l'email di benvenuto (dopo l'attivazione). Ritorna l'esito o None se disabilitata."""
    cfg = await _rs_settings("welcome_email", _RS_WELCOME_DEFAULTS)
    if not cfg.get("enabled", True) or not user.get("email"):
        return None
    ctx = {
        "nome": user.get("first_name") or (user.get("name") or "").split(" ")[0] or "",
        "cognome": user.get("last_name") or "",
        "email": user.get("email") or "",
        "codice_promo": cfg.get("promo_code") or "",
        "link_privacy": cfg.get("privacy_url") or _RS_DEFAULT_PRIVACY_URL,
        "link_app": cfg.get("app_url") or _RS_DEFAULT_APP_URL,
    }
    subject = _rs_render(cfg.get("subject") or _RS_WELCOME_DEFAULTS["subject"], ctx)
    body_tpl = cfg.get("body") or _RS_WELCOME_DEFAULTS["body"]
    if not ctx["codice_promo"]:  # nessun codice configurato → le righe con {codice_promo} spariscono
        body_tpl = "\n".join(l for l in body_tpl.split("\n") if "{codice_promo}" not in l)
    body_text = _rs_render(body_tpl, ctx)
    _send = globals().get("axon_send_email")
    if not _send:
        return None
    res = await _send("info", user["email"], subject, _rs_body_html(body_text), text=body_text, tag="welcome")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"welcome_email_sent_at": utcnow()}})
    return res


class WelcomeEmailIn(BaseModel):
    enabled: Optional[bool] = None
    subject: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default=None, max_length=8000)
    promo_code: Optional[str] = Field(default=None, max_length=40)
    privacy_url: Optional[str] = Field(default=None, max_length=300)
    app_url: Optional[str] = Field(default=None, max_length=300)


@api_router.get("/admin/welcome-email")
async def admin_welcome_email_get(user=Depends(require_super_admin)):
    cfg = await _rs_settings("welcome_email", _RS_WELCOME_DEFAULTS)
    promos = await db.promo_codes.find({"active": True}, {"_id": 0, "code": 1, "description": 1, "benefit_type": 1}).sort("created_at", -1).to_list(100)
    sent_7d = await _rs_count(db.users, {"welcome_email_sent_at": {"$gt": utcnow() - timedelta(days=7)}})
    return {**cfg, "placeholders": ["{nome}", "{cognome}", "{email}", "{codice_promo}", "{link_privacy}", "{link_app}"], "promo_codes": promos, "sent_7d": sent_7d}


@api_router.put("/admin/welcome-email")
async def admin_welcome_email_put(body: WelcomeEmailIn, user=Depends(require_super_admin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "promo_code" in upd:
        upd["promo_code"] = upd["promo_code"].strip().upper()
    upd["updated_at"] = utcnow(); upd["updated_by"] = user["user_id"]
    await db.app_settings.update_one({"key": "welcome_email"}, {"$set": upd}, upsert=True)
    return await _rs_settings("welcome_email", _RS_WELCOME_DEFAULTS)


@api_router.post("/admin/welcome-email/test")
async def admin_welcome_email_test(user=Depends(require_super_admin)):
    fake = {"user_id": user["user_id"], "email": user["email"], "name": user.get("name") or "Master", "first_name": user.get("first_name") or (user.get("name") or "Master").split(" ")[0]}
    cfg = await _rs_settings("welcome_email", _RS_WELCOME_DEFAULTS)
    if not cfg.get("enabled", True):
        raise HTTPException(status_code=400, detail="Email di benvenuto disabilitata: attivala prima di inviare la prova.")
    res = await _welcome_email_send(fake)
    await db.users.update_one({"user_id": user["user_id"]}, {"$unset": {"welcome_email_sent_at": ""}})
    return {"ok": True, "to": user["email"], "provider": (res or {}).get("provider")}


# indici best-effort
async def _rs_ensure_indexes():
    try:
        await db.register_challenges.create_index("created_at", expireAfterSeconds=3600)
        await db.register_challenges.create_index("challenge_id")
        await db.register_blocked.create_index("at")
        await db.register_blocked.create_index("ip")
        await db.users.create_index("email_normalized")
        await db.app_settings.create_index("key", unique=True)
    except Exception as exc:
        logger.warning(f"[register-guard] index error: {exc}")


@app.on_event("startup")
async def _rs_startup():
    await _rs_ensure_indexes()
