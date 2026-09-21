# 01_helpers.py — Helper generici: utcnow, hashing, tenant, auth deps, LLM helpers
# Estratto da server.py (righe originali 289-511). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Helpers
# =========================
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# V50.f — Callback server-side per Dropbox (specular a quello Google in
# `/auth/google/callback`). Dropbox reindirizza qui con ?code=...&state=...
# perché l'ingress Emergent instrada `/auth/*` al backend, NON al frontend.
# Prima esisteva solo la pagina Expo Router a `/auth/dropbox/callback.tsx`
# che però NON veniva mai raggiunta → 404 "Not Found" restituito da FastAPI.
# Ora facciamo lo scambio del code lato server e mostriamo una pagina HTML
# di successo; il polling `/api/dropbox/status` nell'app aggancia la UI.
@app.get("/auth/dropbox/callback")
async def _dropbox_oauth_callback_bridge(request: Request):
    from fastapi.responses import HTMLResponse
    qp = request.query_params
    code = qp.get("code")
    state = qp.get("state")
    err = qp.get("error") or qp.get("error_description")
    _ua = request.headers.get("user-agent") or ""
    ret_info: Dict[str, Any] = {}  # V50.z154 — deep-link/package dell'app (dallo state)

    def _page(ok: bool, message: str, detail: str = "") -> HTMLResponse:
        deep_link, intent_link = _oauth_return_links(ret_info, _ua, "dropbox", "dropbox", ok)
        html = _oauth_return_page_html("Dropbox", ok, message, detail, deep_link, intent_link, "#0061FF")
        return HTMLResponse(content=html, status_code=200)

    if err:
        return _page(False, "Autorizzazione annullata", err)
    if not code or not state:
        return _page(False, "Callback OAuth incompleto", "Manca code o state")

    try:
        if not _dbx_configured():
            return _page(False, "Dropbox non configurato",
                         "Contatta l'amministratore del server")
        st = await db.dropbox_oauth_states.find_one_and_delete({"_id": state})
        if not st:
            return _page(False, "Sessione scaduta",
                         "Riprova dalla schermata Dropbox")
        ret_info.update(st.get("app_return") or {})
        # V50.q — Mongo può restituire datetime tz-naive: normalizza a UTC
        # prima del confronto per evitare "can't compare offset-naive and
        # offset-aware datetimes".
        exp = st.get("expires_at")
        if exp is not None and getattr(exp, "tzinfo", None) is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp is not None and exp < utcnow():
            return _page(False, "Stato OAuth scaduto",
                         "Riprova dalla schermata Dropbox")
        # Scambia il code con Dropbox usando lo stesso client_secret + code_verifier
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://api.dropboxapi.com/oauth2/token",
                data={
                    "code": code,
                    "grant_type": "authorization_code",
                    "client_id": _DBX_APP_KEY,
                    "client_secret": _DBX_APP_SECRET,
                    "redirect_uri": _DBX_REDIRECT_URI,
                    "code_verifier": st.get("code_verifier", ""),
                },
            )
        if r.status_code != 200:
            logger.warning("[dropbox-callback] token exchange %s: %s", r.status_code, r.text[:200])
            return _page(False, "Scambio token fallito", f"HTTP {r.status_code}")
        tok = r.json()
        # Best-effort account info
        dropbox_email = None
        account_id = tok.get("account_id")
        try:
            if tok.get("access_token"):
                async with httpx.AsyncClient(timeout=10) as c2:
                    ar = await c2.post(
                        "https://api.dropboxapi.com/2/users/get_current_account",
                        headers={"Authorization": f"Bearer {tok['access_token']}"},
                    )
                    if ar.status_code == 200:
                        aj = ar.json()
                        dropbox_email = (aj.get("email") or "").lower() or None
                        account_id = aj.get("account_id") or account_id
        except Exception:
            pass
        await db.dropbox_connections.update_one(
            {"user_id": st["user_id"]},
            {"$set": {
                "user_id": st["user_id"],
                "account_id": account_id,
                "dropbox_email": dropbox_email,
                "refresh_token": tok.get("refresh_token", ""),
                "scopes": tok.get("scope") or _DBX_SCOPES,
                "updated_at": utcnow(),
            }},
            upsert=True,
        )
        return _page(True, "Dropbox collegato",
                     f"Account: {dropbox_email}" if dropbox_email else "")
    except Exception as e:
        logger.warning("[dropbox-callback] exception: %s", e)
        return _page(False, "Errore durante il collegamento", str(e))


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_jwt(user_id: str, device_id: Optional[str] = None) -> str:
    payload = {
        "sub": user_id,
        "iat": int(utcnow().timestamp()),
        "exp": int((utcnow() + timedelta(days=JWT_EXP_DAYS)).timestamp()),
    }
    if device_id:
        payload["did"] = device_id  # V50.z293 — token legato al dispositivo (registro dispositivi)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def create_temp_2fa_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "purpose": "2fa_pending",
        "iat": int(utcnow().timestamp()),
        "exp": int((utcnow() + timedelta(minutes=TEMP_2FA_TOKEN_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def totp_provisioning_uri(email: str, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=TOTP_ISSUER)


def qr_png_data_url(data: str) -> str:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=6, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0F2438", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def generate_backup_codes(count: int = 10) -> list[str]:
    # 10-char, split into 5-5 for display: XXXXX-XXXXX
    codes = []
    for _ in range(count):
        raw = secrets.token_hex(5).upper()  # 10 chars
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def hash_backup_code(code: str) -> str:
    # Normalize by removing dashes/spaces + upper
    norm = code.replace("-", "").replace(" ", "").upper()
    return bcrypt.hashpw(norm.encode(), bcrypt.gensalt()).decode()


def verify_backup_code(code: str, hashed: str) -> bool:
    try:
        norm = code.replace("-", "").replace(" ", "").upper()
        return bcrypt.checkpw(norm.encode(), hashed.encode())
    except Exception:
        return False


def strip_id(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


def _aware_utc_times(doc: Optional[dict], keys: tuple = ("start_at", "end_at")) -> Optional[dict]:
    """V50.z127 — Mongo restituisce datetime NAIVE (UTC implicito): serializzati
    come "2026-06-20T06:15:00" senza suffisso, il client JS li interpreta come
    ora LOCALE → 08:15 inserite diventavano 06:15 (bug orario appuntamenti).
    Rende espliciti i datetime come UTC (+00:00) sui campi indicati."""
    if not doc:
        return doc
    for k in keys:
        v = doc.get(k)
        if isinstance(v, datetime) and v.tzinfo is None:
            doc[k] = v.replace(tzinfo=timezone.utc)
    return doc


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()

    # Try JWT first
    user_id = None
    device_id = None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
        device_id = payload.get("did")
    except Exception:
        # Try session token (Google auth)
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if session:
            exp = session.get("expires_at")
            if isinstance(exp, datetime):
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < utcnow():
                    raise HTTPException(status_code=401, detail="Session expired")
            user_id = session.get("user_id")
            device_id = session.get("device_id")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    # V50.z293 — registro dispositivi: se il token è legato a un dispositivo sospeso/rimosso → 401 «device_suspended»
    if device_id:
        try:
            await _device_gate(user_id, device_id)  # noqa: F821 — definita in auth_devices.py (stesso namespace)
        except HTTPException:
            raise
        except NameError:
            pass

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "totp_secret_pending": 0, "backup_codes": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# =========================
