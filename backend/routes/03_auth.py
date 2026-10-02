# 03_auth.py — Auth: register/login/2FA/Google session, eliminazione account
# Estratto da server.py (righe originali 1117-1562). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Auth
# =========================
TRIAL_DAYS = 14  # V50.z329 — giorni di prova gratuita alla registrazione


@api_router.post("/auth/register")
async def register(body: RegisterInput):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email già registrata")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    first_name = (body.name or "").strip()
    last_name = (body.last_name or "").strip()
    full_name = " ".join(x for x in [first_name, last_name] if x) or body.email.split("@")[0]
    doc = {
        "user_id": user_id,
        "email": body.email.lower(),
        "name": full_name,
        "first_name": first_name or None,  # V50.z433
        "last_name": last_name or None,
        "password_hash": hash_password(body.password),
        "role": "owner",
        "areas": ["energy", "network"],
        "picture": None,
        "product": body.product or "advisor",  # V50.z323 — Axon Core
        "subscription_status": "trial",  # V50.z329 — prova gratuita di TRIAL_DAYS giorni per ogni nuovo iscritto (promo/referral la estendono)
        "trial_expires_at": utcnow() + timedelta(days=TRIAL_DAYS),
        "created_at": utcnow(),
        "email_verified": False,  # V50.z433 — attivazione con codice a 6 cifre via email
    }
    await db.users.insert_one(doc)
    # Init default settings
    await db.settings.insert_one({
        "user_id": user_id,
        **SettingsModel().model_dump(),
    })
    # V50.z433 — Codice promozionale inserito nel modulo: STESSO sistema di /promo/redeem (codici del Master + codici amico
    # AMICO-/referral della landing). Un codice non valido NON blocca la registrazione: viene riportato in `promo`.
    promo: Optional[Dict[str, Any]] = None
    promo_code = (body.promo_code or "").strip()
    if promo_code:
        _redeem = globals().get("promo_redeem")
        try:
            res = await _redeem(PromoRedeemIn(code=promo_code), user=doc) if _redeem else None  # noqa: F821
            promo = {"ok": True, "code": promo_code.upper(), "message": (res or {}).get("message") or "Codice applicato."}
        except HTTPException as exc:
            promo = {"ok": False, "code": promo_code.upper(), "message": str(exc.detail)}
        except Exception as exc:  # noqa: BLE001
            logging.getLogger("auth").warning("promo at register failed: %s", exc)
            promo = {"ok": False, "code": promo_code.upper(), "message": "Codice non applicato: potrai inserirlo nelle impostazioni."}
    # V50.z336 — notifica interna al Master (emanuele@) per ogni nuova iscrizione in prova
    _hook = globals().get("_email_on_register")
    if _hook:
        try:
            await _hook(doc)
        except Exception as exc:  # noqa: BLE001
            logging.getLogger("auth").warning("email hook failed: %s", exc)
    token = create_jwt(user_id)
    # V50.z433 — invio codice di verifica email (l'account si attiva con POST /auth/verify-email)
    try:
        await _email_verify_send(doc)
    except Exception as exc:  # noqa: BLE001
        logging.getLogger("auth").warning("verify email send failed: %s", exc)
    return {"token": token, "user": UserOut(**{k: doc.get(k) for k in ["user_id", "email", "name", "picture", "role", "areas", "parent_user_id", "product", "email_verified"]}).model_dump(), "promo": promo, "requires_email_verification": True}


# ── V50.z433 — Verifica email alla registrazione (codice a 6 cifre, 30 min, max 6 tentativi) ──
_EMAILVERIFY_TTL_MIN = 30
_EMAILVERIFY_MAX_ATTEMPTS = 6


async def _email_verify_send(user: dict) -> None:
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = utcnow()
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"email_verify": {
        "code_hash": hash_password(code), "expires_at": now + timedelta(minutes=_EMAILVERIFY_TTL_MIN), "attempts": 0, "sent_at": now,
    }}})
    first = (user.get("first_name") or (user.get("name") or "").split(" ")[0] or "ciao")
    html = (
        f"<p>Ciao {first},</p><p>benvenuto in AdvisorOS! Per attivare il tuo account inserisci nell'app questo codice di conferma:</p>"
        f"<p style=\"font-size:30px;font-weight:800;letter-spacing:8px;margin:18px 0\">{code}</p>"
        f"<p>Il codice vale <b>{_EMAILVERIFY_TTL_MIN} minuti</b>. Se non ti sei registrato tu, ignora questa email.</p>"
    )
    _send = globals().get("axon_send_email")
    if _send:
        await _send("help", user["email"], "AdvisorOS · Codice di conferma email", html, tag="email_verify")


class EmailVerifyIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


@api_router.post("/auth/verify-email")
async def verify_email(body: EmailVerifyIn, user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    if not fresh:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    if fresh.get("email_verified") is not False:
        strip_id(fresh); fresh.pop("password_hash", None)
        return {"ok": True, "already": True, "user": UserOut(**fresh).model_dump()}
    ev = fresh.get("email_verify") or {}
    exp = ev.get("expires_at")
    if isinstance(exp, datetime) and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if not ev or not exp or exp < utcnow():
        raise HTTPException(status_code=400, detail="Codice scaduto: richiedi un nuovo codice.")
    if int(ev.get("attempts") or 0) >= _EMAILVERIFY_MAX_ATTEMPTS:
        raise HTTPException(status_code=400, detail="Troppi tentativi: richiedi un nuovo codice.")
    if not verify_password(body.code, ev["code_hash"]):
        await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"email_verify.attempts": 1}})
        left = _EMAILVERIFY_MAX_ATTEMPTS - int(ev.get("attempts") or 0) - 1
        raise HTTPException(status_code=400, detail=f"Codice errato. Tentativi rimasti: {max(left, 0)}.")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"email_verified": True, "email_verified_at": utcnow()}, "$unset": {"email_verify": ""}})
    fresh["email_verified"] = True
    strip_id(fresh); fresh.pop("password_hash", None); fresh.pop("email_verify", None)
    return {"ok": True, "user": UserOut(**fresh).model_dump()}


@api_router.post("/auth/verify-email/resend")
async def verify_email_resend(user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    if not fresh or fresh.get("email_verified") is not False:
        return {"ok": True, "already": True}
    sent_at = (fresh.get("email_verify") or {}).get("sent_at")
    if isinstance(sent_at, datetime) and sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)
    if sent_at and (utcnow() - sent_at).total_seconds() < 45:
        raise HTTPException(status_code=429, detail="Attendi qualche secondo prima di richiedere un nuovo codice.")
    await _email_verify_send(fresh)
    return {"ok": True, "message": f"Nuovo codice inviato a {fresh['email']}."}


# ── V50.z433 — Recupero password (codice a 6 cifre via email, nessun deep link richiesto) ──
# Flusso: POST /auth/password-reset/request {email} → sempre 202 + reset_id (anti-enumerazione: per email sconosciute
# un reset_id casuale che non validerà mai); email con codice 6 cifre (bcrypt hash su DB, 15 min, max 6 tentativi).
# POST /auth/password-reset/confirm {reset_id, code, new_password} → cambia password_hash, consuma il record (atomico).
_PWRESET_TTL_MIN = 15
_PWRESET_MAX_ATTEMPTS = 6
_pwreset_rate: Dict[str, list] = {}  # chiave (email|ip) → timestamp richieste (processo singolo VPS)


def _pwreset_allow(key: str, limit: int, window_s: int) -> bool:
    now_ts = time.time()
    arr = [t for t in _pwreset_rate.get(key, []) if now_ts - t < window_s]
    _pwreset_rate[key] = arr
    if len(arr) >= limit:
        return False
    arr.append(now_ts)
    return True


class PasswordResetRequestIn(BaseModel):
    email: EmailStr


class PasswordResetConfirmIn(BaseModel):
    reset_id: str = Field(min_length=8, max_length=64)
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=6, max_length=128)


@api_router.post("/auth/password-reset/request", status_code=202)
async def password_reset_request(body: PasswordResetRequestIn, request: Request):
    email = str(body.email).strip().lower()
    ip = request.client.host if request.client else "?"
    generic = {"ok": True, "message": "Se l'email è registrata riceverai un codice a 6 cifre valido 15 minuti.", "reset_id": secrets.token_urlsafe(16), "ttl_minutes": _PWRESET_TTL_MIN}
    if not (_pwreset_allow(f"ip:{ip}", 10, 3600) and _pwreset_allow(f"em:{email}", 3, 3600)):
        return generic
    user = await db.users.find_one({"email": email}, {"user_id": 1, "email": 1, "name": 1, "password_hash": 1})
    if not user or not user.get("password_hash"):
        hash_password("timing-only-value")  # tempo di risposta simile a quello di un account esistente
        return generic
    code = f"{secrets.randbelow(1_000_000):06d}"
    reset_id = secrets.token_urlsafe(16)
    now = utcnow()
    await db.password_reset_tokens.delete_many({"user_id": user["user_id"]})
    await db.password_reset_tokens.insert_one({
        "reset_id": reset_id, "user_id": user["user_id"], "code_hash": hash_password(code),
        "created_at": now, "expires_at": now + timedelta(minutes=_PWRESET_TTL_MIN), "used_at": None, "attempts": 0,
    })
    first = (user.get("name") or "").split(" ")[0] or "ciao"
    html = (
        f"<p>Ciao {first},</p><p>hai chiesto di reimpostare la password di AdvisorOS. Inserisci nell'app questo codice:</p>"
        f"<p style=\"font-size:30px;font-weight:800;letter-spacing:8px;margin:18px 0\">{code}</p>"
        f"<p>Il codice vale <b>{_PWRESET_TTL_MIN} minuti</b> e può essere usato una sola volta.</p>"
        "<p>Se non sei stato tu, ignora questa email: la tua password resta invariata.</p>"
    )
    _send = globals().get("axon_send_email")
    try:
        if _send:
            await _send("help", user["email"], "AdvisorOS · Codice per reimpostare la password", html, tag="password_reset")
    except Exception as exc:  # noqa: BLE001 — mai rivelare al chiamante se l'invio è fallito
        logging.getLogger("auth").warning("password reset email failed: %s", exc)
    generic["reset_id"] = reset_id
    return generic


@api_router.post("/auth/password-reset/confirm")
async def password_reset_confirm(body: PasswordResetConfirmIn):
    bad = HTTPException(status_code=400, detail="Codice non valido o scaduto. Richiedi un nuovo codice.")
    now = utcnow()
    rec = await db.password_reset_tokens.find_one({"reset_id": body.reset_id, "used_at": None, "expires_at": {"$gt": now}})
    if not rec or int(rec.get("attempts") or 0) >= _PWRESET_MAX_ATTEMPTS:
        raise bad
    if not verify_password(body.code, rec["code_hash"]):
        await db.password_reset_tokens.update_one({"reset_id": body.reset_id, "used_at": None}, {"$inc": {"attempts": 1}})
        left = _PWRESET_MAX_ATTEMPTS - int(rec.get("attempts") or 0) - 1
        raise HTTPException(status_code=400, detail=f"Codice errato. Tentativi rimasti: {max(left, 0)}." if left > 0 else "Troppi tentativi: richiedi un nuovo codice.")
    claimed = await db.password_reset_tokens.find_one_and_update(
        {"reset_id": body.reset_id, "used_at": None, "expires_at": {"$gt": now}},
        {"$set": {"used_at": now}},
    )
    if not claimed:
        raise bad
    r = await db.users.update_one({"user_id": rec["user_id"]}, {"$set": {"password_hash": hash_password(body.new_password), "password_changed_at": now}})
    if r.matched_count != 1:
        raise bad
    return {"ok": True, "message": "Password aggiornata. Ora puoi accedere con la nuova password."}


@api_router.post("/auth/login")
async def login(body: LoginInput, request: Request):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenziali non valide")

    # If 2FA enabled, return temp token requiring 2FA
    if user.get("two_factor_enabled"):
        return {
            "requires_2fa": True,
            "temp_token": create_temp_2fa_token(user["user_id"]),
        }

    # V50.z433 — account non ancora attivato (email non verificata): token emesso ma l'app mostra la schermata del codice
    if user.get("email_verified") is False:
        try:
            await _email_verify_send(user)
        except Exception as exc:  # noqa: BLE001
            logging.getLogger("auth").warning("verify email resend at login failed: %s", exc)
        return {"requires_email_verification": True, "token": create_jwt(user["user_id"]), "email": user["email"]}

    dev = await _device_register_login(user, body.device, request)  # V50.z293
    token = create_jwt(user["user_id"], dev.get("device_id") if dev else None)
    strip_id(user)
    user.pop("password_hash", None)
    trust_expires_at = utcnow() + timedelta(hours=DEVICE_TRUST_HOURS)
    return {
        "token": token,
        "user": UserOut(**user).model_dump(),
        "trust_expires_at": trust_expires_at.isoformat(),
        "device": dev,
    }


@api_router.post("/auth/login/2fa")
async def login_2fa(body: TwoFAVerifyInput, request: Request):
    try:
        payload = jwt.decode(body.temp_token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(status_code=401, detail="Token temporaneo non valido o scaduto")
    if payload.get("purpose") != "2fa_pending":
        raise HTTPException(status_code=401, detail="Token non valido")
    user_id = payload.get("sub")
    user = await db.users.find_one({"user_id": user_id})
    if not user or not user.get("two_factor_enabled"):
        raise HTTPException(status_code=401, detail="Sessione non valida")

    code = (body.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Codice mancante")

    verified = False
    used_backup_index = None

    # Try backup codes first (if code contains letters or dashes, it's likely a backup code)
    if not code.isdigit() or len(code) >= 8:
        for idx, item in enumerate(user.get("backup_codes") or []):
            if item.get("used_at") is None and verify_backup_code(code, item["hash"]):
                used_backup_index = idx
                verified = True
                break

    # Try TOTP
    if not verified and code.isdigit() and len(code) == 6:
        try:
            totp = pyotp.TOTP(user["totp_secret"])
            timecode = totp.verify(code, valid_window=1)
            if timecode:
                # Prevent replay: check last used
                last = user.get("totp_last_code")
                if last == code:
                    raise HTTPException(status_code=401, detail="Codice già utilizzato, attendi il prossimo")
                verified = True
                await db.users.update_one(
                    {"user_id": user_id},
                    {"$set": {"totp_last_code": code, "totp_last_verified_at": utcnow()}},
                )
        except HTTPException:
            raise
        except Exception:
            verified = False

    if not verified:
        raise HTTPException(status_code=401, detail="Codice 2FA non valido")

    # Mark backup code as used
    if used_backup_index is not None:
        codes_list = user.get("backup_codes") or []
        codes_list[used_backup_index]["used_at"] = utcnow()
        await db.users.update_one({"user_id": user_id}, {"$set": {"backup_codes": codes_list}})

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "backup_codes": 0})
    dev = await _device_register_login(user, body.device, request)  # V50.z293
    token = create_jwt(user_id, dev.get("device_id") if dev else None)
    trust_expires_at = utcnow() + timedelta(hours=DEVICE_TRUST_HOURS)
    return {
        "token": token,
        "user": UserOut(**user).model_dump(),
        "trust_expires_at": trust_expires_at.isoformat(),
        "used_backup_code": used_backup_index is not None,
        "device": dev,
    }


@api_router.post("/auth/2fa/setup/start")
async def twofa_setup_start(user=Depends(get_current_user)):
    """Generate a fresh TOTP secret (not activated until confirmed)."""
    secret = pyotp.random_base32()
    uri = totp_provisioning_uri(user["email"], secret)
    # Store as pending secret (does NOT enable yet)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"totp_secret_pending": secret}},
    )
    return {
        "otpauth_uri": uri,
        "qr_code_data_url": qr_png_data_url(uri),
        "secret": secret,  # Show once for manual entry
    }


@api_router.post("/auth/2fa/setup/confirm")
async def twofa_setup_confirm(body: TwoFAConfirmInput, user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    secret = fresh.get("totp_secret_pending")
    if not secret:
        raise HTTPException(status_code=400, detail="Nessun setup 2FA in corso. Ricomincia.")
    code = (body.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail="Codice deve essere 6 cifre")
    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Codice non valido, riprova")

    # Generate backup codes
    backup_codes = generate_backup_codes(10)
    backup_hashed = [{"hash": hash_backup_code(c), "used_at": None} for c in backup_codes]

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "two_factor_enabled": True,
            "totp_secret": secret,
            "totp_last_code": code,
            "totp_enabled_at": utcnow(),
            "backup_codes": backup_hashed,
        }, "$unset": {"totp_secret_pending": ""}},
    )
    return {"ok": True, "backup_codes": backup_codes}


@api_router.post("/auth/2fa/disable")
async def twofa_disable(body: TwoFADisableInput, user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    if not fresh.get("two_factor_enabled"):
        return {"ok": True}

    verified = False
    if body.password and fresh.get("password_hash") and verify_password(body.password, fresh["password_hash"]):
        verified = True
    elif body.code:
        code = body.code.strip()
        # Try TOTP
        if code.isdigit() and len(code) == 6:
            totp = pyotp.TOTP(fresh["totp_secret"])
            if totp.verify(code, valid_window=1):
                verified = True
        # Try backup code
        if not verified:
            for item in fresh.get("backup_codes") or []:
                if item.get("used_at") is None and verify_backup_code(code, item["hash"]):
                    verified = True
                    break

    if not verified:
        raise HTTPException(status_code=401, detail="Password o codice non validi")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"two_factor_enabled": False}, "$unset": {"totp_secret": "", "totp_secret_pending": "", "backup_codes": "", "totp_last_code": ""}},
    )
    return {"ok": True}


@api_router.post("/auth/2fa/regenerate-backup-codes")
async def twofa_regen_backup(body: TwoFAConfirmInput, user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    if not fresh.get("two_factor_enabled"):
        raise HTTPException(status_code=400, detail="2FA non attivo")
    code = (body.code or "").strip()
    if not (code.isdigit() and len(code) == 6):
        raise HTTPException(status_code=400, detail="Serve codice TOTP a 6 cifre")
    totp = pyotp.TOTP(fresh["totp_secret"])
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Codice TOTP non valido")

    backup_codes = generate_backup_codes(10)
    backup_hashed = [{"hash": hash_backup_code(c), "used_at": None} for c in backup_codes]
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"backup_codes": backup_hashed}},
    )
    return {"backup_codes": backup_codes}


@api_router.get("/auth/2fa/status")
async def twofa_status(user=Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    codes = fresh.get("backup_codes") or []
    unused = sum(1 for c in codes if c.get("used_at") is None)
    return {
        "enabled": bool(fresh.get("two_factor_enabled")),
        "backup_codes_remaining": unused,
        "enabled_at": fresh.get("totp_enabled_at").isoformat() if fresh.get("totp_enabled_at") else None,
    }


@api_router.post("/auth/google-session")
async def google_session(body: GoogleSessionInput, request: Request):
    """Exchange Emergent session_id -> session_token, upsert user, store session."""
    # V45c — Base URL from env only; fail fast if not configured to avoid
    # silent environment drift.
    # V50.z272 — endpoint Emergent fisso da playbook (l'env di deploy potrebbe contenere un dominio diverso)
    emergent_auth_base = (os.environ.get("EMERGENT_AUTH_BASE_URL", "").strip().rstrip("/") or "https://demobackend.emergentagent.com")
    if "emergentagent.com" not in emergent_auth_base:
        emergent_auth_base = "https://demobackend.emergentagent.com"
    if not emergent_auth_base:
        raise HTTPException(
            status_code=500,
            detail="EMERGENT_AUTH_BASE_URL non configurato lato server",
        )
    async with httpx.AsyncClient(timeout=15) as hx:
        r = await hx.get(
            f"{emergent_auth_base}/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Google auth fallita")
    data = r.json()
    email = data["email"].lower()
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "password_hash": None,
            "role": "owner",
            "areas": ["energy", "network"],
            "product": body.product or "advisor",  # V50.z323 — Axon Core
            "subscription_status": "trial",  # V50.z329
            "trial_expires_at": utcnow() + timedelta(days=TRIAL_DAYS),
            "created_at": utcnow(),
        })
        await db.settings.insert_one({
            "user_id": user_id,
            **SettingsModel().model_dump(),
        })

    # Store session
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": utcnow() + timedelta(days=7),
            "created_at": utcnow(),
        }},
        upsert=True,
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    dev = await _device_register_login(user, body.device, request)  # V50.z293
    if dev:
        await db.user_sessions.update_one({"session_token": session_token}, {"$set": {"device_id": dev["device_id"]}})
    return {"token": session_token, "user": UserOut(**user).model_dump(), "device": dev}


@api_router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return {"user": UserOut(**user).model_dump()}


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0, "user_id": 1, "device_id": 1})
        await db.user_sessions.delete_one({"session_token": token})
        # V50.z293 — fine sessione del dispositivo: libera lo slot e riattiva l'eventuale dispositivo sospeso dello stesso tipo
        did = (sess or {}).get("device_id"); uid = (sess or {}).get("user_id")
        if not did:
            try:
                payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG], options={"verify_exp": False})
                did, uid = payload.get("did"), payload.get("sub")
            except Exception:
                did = None
        if did and uid:
            try:
                await _device_end_session(uid, did, reason="logout")  # noqa: F821
            except NameError:
                pass
    return {"ok": True}


@api_router.put("/auth/profile")
async def update_profile(body: ProfileUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": upd})
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"user": UserOut(**u).model_dump()}


# V50.z140 — Header tabelle AxonOS: logo + nome azienda configurati dal Master (tenant owner),
# mostrati in testa a ogni tabella esportata dalla chat (anche per i collaboratori).
# Fallback: se il Master non ha configurato l'header tabella si usa il Branding aziendale.
@api_router.get("/table-header")
async def get_table_header(user=Depends(get_current_user)):
    owner = await db.users.find_one(
        {"user_id": tenant_id(user)},
        {"_id": 0, "table_header_name": 1, "table_header_logo_base64": 1, "company_name": 1, "company_logo_base64": 1},
    ) or {}
    name = (owner.get("table_header_name") or "").strip()
    logo = (owner.get("table_header_logo_base64") or "").strip()
    source = "table"
    if not name and not logo:
        name = (owner.get("company_name") or "").strip()
        logo = (owner.get("company_logo_base64") or "").strip()
        source = "branding" if (name or logo) else "none"
    return {"name": name, "logo_base64": logo, "source": source}


# =========================
# V29.b — Elimina il mio account (Apple/Google compliance)
# Elimina completamente l'utente + TUTTI i suoi dati (contatti, appuntamenti,
# callback, bollette, business_card, impostazioni, connessioni Google Drive,
# regole/fonti Insegna ad Axon, note My Thing, log chat AI, ecc.).
# Richiede conferma con password (per account non-OAuth) e frase esatta.
# Un Master NON può eliminare il proprio account se ha ancora sub-utenti attivi.
# =========================

class DeleteAccountIn(BaseModel):
    password: Optional[str] = None
    confirmation: str  # deve essere esattamente "ELIMINA IL MIO ACCOUNT"


@api_router.delete("/auth/me")
async def delete_my_account(body: DeleteAccountIn, authorization: Optional[str] = Header(None), user=Depends(get_current_user)):
    """Elimina permanentemente l'account dell'utente autenticato e tutti i suoi dati.
    Guardrail:
      - Frase di conferma esatta ("ELIMINA IL MIO ACCOUNT")
      - Password richiesta per account con password_hash impostato
      - Un Master (owner) non può auto-eliminarsi finché ha sub-utenti attivi
    """
    expected = "ELIMINA IL MIO ACCOUNT"
    if (body.confirmation or "").strip().upper() != expected:
        raise HTTPException(status_code=400, detail=f"Devi digitare esattamente '{expected}' per confermare")

    # Password check (solo se l'account ha una password, i.e. non-OAuth)
    fresh = await db.users.find_one({"user_id": user["user_id"]})
    if fresh and fresh.get("password_hash"):
        if not body.password or not verify_password(body.password, fresh["password_hash"]):
            raise HTTPException(status_code=401, detail="Password non corretta")

    uid = user["user_id"]
    # Se è owner (Master) e ha collaboratori attivi, blocca
    if is_owner(user):
        sub_count = await db.users.count_documents({"parent_user_id": uid})
        if sub_count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Non puoi eliminare l'account: hai {sub_count} collaboratore/i attivi. Rimuovili prima dalla sezione Team.",
            )

    tid = tenant_id(user)

    # Elenco collezioni da ripulire per questo user. Le collezioni tenant-scoped
    # (contatti/appuntamenti/bollette) usano user_id = tid (tenant_id), quelle
    # user-scoped (settings, business_card, drive) usano user_id = uid.
    tenant_collections = [
        "contacts", "appointments", "callbacks", "energy_bills",
        "corporate_records", "contract_records", "contact_files",
        "chat_conversations", "chat_messages", "assistant_chat_sessions",
        "events", "event_registrations", "smtp_configs",
        "axon_analyses",
        "axon_profiles",
        # V42 — RAG Master documents (tenant-scoped)
        "master_documents", "master_doc_chunks",
        # V43 — Auto-extracted rule proposals (tenant-scoped)
        "axon_rule_proposals",
        # V44 — Team member behavioural profiles (tenant-scoped)
        "team_member_profiles",
    ]
    user_collections = [
        "user_settings", "business_cards", "google_drive_connections",
        "google_oauth_states", "user_sessions", "my_thing_items",
        "ai_teach_rules", "ai_teach_urls", "totp_secrets",
        "assistant_memory", "assistant_teach_categories",
    ]

    deleted_summary: Dict[str, int] = {}
    for coll in tenant_collections:
        try:
            r = await db[coll].delete_many({"user_id": tid})
            deleted_summary[coll] = r.deleted_count
        except Exception as e:
            logger.warning(f"[delete-account] tenant collection {coll} error: {e}")
    for coll in user_collections:
        try:
            r = await db[coll].delete_many({"user_id": uid})
            deleted_summary[coll] = deleted_summary.get(coll, 0) + r.deleted_count
        except Exception as e:
            logger.warning(f"[delete-account] user collection {coll} error: {e}")

    # Rimuovi eventuali riferimenti bidirezionali nei contatti degli altri utenti (referral)
    try:
        await db.contacts.update_many(
            {"referred_by_contact_ids": {"$exists": True}},
            {"$pull": {"referred_by_contact_ids": {"$regex": "^c_"}}},
        )
    except Exception:
        pass

    # Elimina infine l'utente
    await db.users.delete_one({"user_id": uid})
    # Rimuovi eventuali reset-password pending
    try:
        await db.password_reset_tokens.delete_many({"user_id": uid})
    except Exception:
        pass
    # Invalida la sessione corrente
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            await db.user_sessions.delete_one({"session_token": token})
        except Exception:
            pass

    logger.info(f"[delete-account] user {uid} deleted. Cleaned: {deleted_summary}")
    return {"ok": True, "deleted": deleted_summary}


# =========================


# ── V50.z249 — Cambio password (utente autenticato, verifica password attuale, bcrypt; nessuna sessione invalidata) ──
class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=64)
    new_password_confirm: str = Field(min_length=8, max_length=64)


_CHPWD_ATTEMPTS: Dict[str, List[float]] = {}


@api_router.post("/auth/change-password", status_code=204)
async def auth_change_password(body: ChangePasswordIn, user=Depends(get_current_user)):
    import time as _t
    uid = user["user_id"]
    now = _t.time()
    hits = [t for t in _CHPWD_ATTEMPTS.get(uid, []) if now - t < 900]
    if len(hits) >= 5:
        raise HTTPException(status_code=429, detail="Troppi tentativi. Riprova tra 15 minuti.")
    if body.new_password != body.new_password_confirm:
        raise HTTPException(status_code=422, detail="Le nuove password non coincidono")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=422, detail="La nuova password deve essere diversa da quella attuale")
    if len(body.new_password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password troppo lunga")
    doc = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 1})
    if not doc or not doc.get("password_hash") or not verify_password(body.current_password, doc["password_hash"]):
        _CHPWD_ATTEMPTS[uid] = hits + [now]
        raise HTTPException(status_code=401, detail="Password attuale non corretta")
    await db.users.update_one({"user_id": uid}, {"$set": {"password_hash": hash_password(body.new_password), "password_changed_at": utcnow()}})
    _CHPWD_ATTEMPTS.pop(uid, None)
    return Response(status_code=204)


# V50.z405 — CAMBIO EMAIL DI ACCESSO (Profilo › Sicurezza). Richiede la password attuale; email salvata in minuscolo (come
# register/login); unicità case-insensitive; rate-limit condiviso con il cambio password; il JWT usa user_id → la sessione resta valida.
class ChangeEmailIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_email: EmailStr


@api_router.post("/auth/change-email")
async def auth_change_email(body: ChangeEmailIn, user=Depends(get_current_user)):
    import time as _t
    uid = user["user_id"]
    now = _t.time()
    hits = [t for t in _CHPWD_ATTEMPTS.get(uid, []) if now - t < 900]
    if len(hits) >= 5:
        raise HTTPException(status_code=429, detail="Troppi tentativi. Riprova tra 15 minuti.")
    new_email = str(body.new_email).strip().lower()
    doc = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 1, "email": 1})
    if not doc or not doc.get("password_hash") or not verify_password(body.current_password, doc["password_hash"]):
        _CHPWD_ATTEMPTS[uid] = hits + [now]
        raise HTTPException(status_code=401, detail="Password attuale non corretta")
    if new_email == (doc.get("email") or "").lower():
        raise HTTPException(status_code=422, detail="La nuova email coincide con quella attuale")
    other = await db.users.find_one({"email": new_email, "user_id": {"$ne": uid}}, {"_id": 0, "user_id": 1})
    if other:
        raise HTTPException(status_code=409, detail="Email già utilizzata da un altro account")
    await db.users.update_one({"user_id": uid}, {"$set": {"email": new_email, "email_changed_at": utcnow(), "email_previous": doc.get("email")}})
    _CHPWD_ATTEMPTS.pop(uid, None)
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0, "totp_secret": 0})
    return {"ok": True, "email": new_email, "user": UserOut(**u).model_dump()}


# V50.z430 — Bug 1 (login Google su tablet/APK): auth.emergentagent.com reindirizza a «frontend://#session_id=…»;
# su alcuni Android/tablet Chrome Custom Tabs BLOCCA la navigazione automatica verso schemi custom (nessun gesto
# utente) → pagina bianca su emergentagent.com e l'app torna al login. Ora l'app usa come redirect QUESTA pagina
# https (sempre apribile): legge session_id dal frammento, prova subito il deep link e mostra un bottone grande
# «Apri AdvisorOS» (gesto utente → Chrome consente lo schema custom). Nessun dato passa dal server (hash lato client).
_APP_RETURN_HTML = """<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AdvisorOS · Accesso</title>
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#2d3250;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
.c{padding:32px 24px;max-width:420px}.l{font-size:30px;font-weight:900;letter-spacing:-.5px}.l span{color:#6b8cff}
p{color:#c5cbe3;font-size:15px;line-height:1.5}a.b{display:inline-block;margin-top:18px;background:#6b8cff;color:#fff;text-decoration:none;font-weight:800;font-size:17px;padding:16px 28px;border-radius:14px;min-width:220px}
.s{margin-top:16px;font-size:12px;color:#8b93b8}</style></head><body><div class="c">
<div class="l">Advisor<span>OS</span></div><p id="m">Accesso completato. Sto riaprendo l'app…</p>
<a id="b" class="b" href="#" style="display:none">Apri AdvisorOS</a>
<div class="s" id="e"></div></div>
<script>
(function(){
  var q=new URLSearchParams(location.search);var to=q.get("to")||"";
  var h=(location.hash||"").replace(/^#/,"");var m=(h+"&"+location.search).match(/session_id=([^&#]+)/);
  var sid=m?m[1]:"";var msg=document.getElementById("m"),btn=document.getElementById("b"),err=document.getElementById("e");
  if(!to||!/^[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\//.test(to)){msg.textContent="Link di ritorno non valido.";return;}
  if(!sid){msg.textContent="Accesso non completato: riprova dall'app.";err.textContent="Nessun codice di sessione ricevuto.";return;}
  var link=to+(to.indexOf("#")>=0?"&":"#")+"session_id="+encodeURIComponent(sid);
  btn.href=link;btn.style.display="inline-block";
  try{location.replace(link);}catch(e){}
  setTimeout(function(){msg.textContent="Tocca il bottone per tornare nell'app e completare l'accesso.";},1200);
})();
</script></body></html>"""


@api_router.get("/auth/app-return", include_in_schema=False)
async def auth_app_return():
    return HTMLResponse(content=_APP_RETURN_HTML, headers={"Cache-Control": "no-store"})
