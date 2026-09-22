# 03_auth.py — Auth: register/login/2FA/Google session, eliminazione account
# Estratto da server.py (righe originali 1117-1562). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Auth
# =========================
@api_router.post("/auth/register")
async def register(body: RegisterInput):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email già registrata")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": body.email.lower(),
        "name": body.name,
        "password_hash": hash_password(body.password),
        "role": "owner",
        "areas": ["energy", "network"],
        "picture": None,
        "product": body.product or "advisor",  # V50.z323 — Axon Core
        "created_at": utcnow(),
    }
    await db.users.insert_one(doc)
    # Init default settings
    await db.settings.insert_one({
        "user_id": user_id,
        **SettingsModel().model_dump(),
    })
    token = create_jwt(user_id)
    return {"token": token, "user": UserOut(**{k: doc.get(k) for k in ["user_id", "email", "name", "picture", "role", "areas", "parent_user_id", "product"]}).model_dump()}


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
