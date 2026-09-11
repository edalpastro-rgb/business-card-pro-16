# 28_google_drive.py — Google Drive OAuth + Picker + cartelle Axon
# Estratto da server.py (righe originali 20294-20970). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V28.w — Google Drive OAuth integration
# V50.h — Scope allargato da `drive.file` → `drive.readonly` su richiesta
# utente: `drive.file` mostra SOLO i file che l'utente ha esplicitamente
# autorizzato via Picker (o creati dall'app), quindi da "Cerca file Drive" in
# Axon si vedeva sempre "Nessun file trovato". Con `drive.readonly` Axon può
# elencare e leggere TUTTI i file/cartelle dell'utente (sola lettura, no
# scrittura né cancellazione). Richiede riautorizzazione dell'account.
# Storage: refresh_token cifrato via Fernet; state OAuth con TTL 10min.
# =========================================================================
import base64 as _b64
import secrets as _secrets
from cryptography.fernet import Fernet as _Fernet

_GD_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
_GD_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
# V50.i — Browser API key per Google Picker (Cloud Console > API key con
# Picker API + Drive API abilitate). Non è un secret sensibile, ma la teniamo
# lato server per non hardcodarla nel bundle mobile.
_GD_API_KEY = os.getenv("GOOGLE_API_KEY", "")
# V29.as — Hardening: some deployments have accidentally included query-string
# fragments (e.g. `?flowName=GeneralOAuthFlow` from a copy-paste) inside the
# GOOGLE_DRIVE_REDIRECT_URI secret. Google rejects any redirect_uri that does
# not EXACTLY match one entry of the Authorized redirect URIs list, so we
# strip any trailing `?...`, `#...` or whitespace before using the value.
def _sanitize_redirect_uri(raw: str) -> str:
    if not raw:
        return ""
    v = raw.strip()
    # Cut on the first '?' or '#' that appears (a valid OAuth redirect must
    # not contain query/fragment).
    v = v.split("?", 1)[0]
    v = v.split("#", 1)[0]
    return v.strip().rstrip("/")

_GD_REDIRECT_URI = _sanitize_redirect_uri(os.getenv("GOOGLE_DRIVE_REDIRECT_URI", ""))
_GD_TOKEN_KEY = os.getenv("GOOGLE_DRIVE_TOKEN_KEY", "")
_GD_FRONTEND_URL = os.getenv("GOOGLE_DRIVE_FRONTEND_URL", "https://advisoros.it/profile")
# V50.t — Scope Drive: usiamo drive.readonly per permettere la navigazione
# nativa delle cartelle (l'utente ha bisogno di un picker interno all'app;
# il Google Picker web è inutilizzabile su mobile per selezionare cartelle).
# L'app RESTRINGE localmente l'accesso solo alle cartelle scelte dall'utente
# (endpoint /google-drive/folders → filter in /files).
_GD_SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
]
_gd_fernet = _Fernet(_GD_TOKEN_KEY.encode()) if _GD_TOKEN_KEY else None
# V50.z128 — Cache in-memory access token Drive: user_id → {key, token, expiry}
_GD_TOKEN_CACHE: Dict[str, Dict[str, Any]] = {}


def _gd_client_config() -> Dict[str, Any]:
    return {
        "web": {
            "client_id": _GD_CLIENT_ID,
            "client_secret": _GD_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [_GD_REDIRECT_URI],
        }
    }


def _gd_configured() -> bool:
    return bool(_GD_CLIENT_ID and _GD_CLIENT_SECRET and _GD_REDIRECT_URI and _gd_fernet)


async def _gd_get_credentials(user_id: str):
    """Return authenticated googleapiclient credentials (refreshed if needed) or raise 409/401/503.

    V50.z128:
    - Cache in-memory dell'access token per utente (chiave legata al refresh
      token cifrato → una riconnessione invalida automaticamente la cache).
    - Refresh ritentato automaticamente (3 tentativi con backoff) sugli errori
      transitori (rete, timeout, 5xx Google).
    - La connessione Drive viene rimossa SOLO su `invalid_grant` confermato
      (token revocato/scaduto). Gli altri errori → 503 senza cancellare nulla.
    """
    from google.oauth2.credentials import Credentials  # type: ignore
    from google.auth.transport.requests import Request as GoogleRequest  # type: ignore
    row = await db.google_drive_connections.find_one({"user_id": user_id})
    if not row:
        _GD_TOKEN_CACHE.pop(user_id, None)
        raise HTTPException(status_code=409, detail="Google Drive non collegato")
    if not _gd_fernet:
        raise HTTPException(status_code=500, detail="Google Drive non configurato lato server")
    refresh_enc = row["refresh_token_enc"]
    refresh = _gd_fernet.decrypt(refresh_enc.encode()).decode()

    def _build(token: Optional[str] = None, expiry: Optional[datetime] = None):
        return Credentials(
            token,
            refresh_token=refresh,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=_GD_CLIENT_ID,
            client_secret=_GD_CLIENT_SECRET,
            scopes=_GD_SCOPES,
            expiry=expiry,
        )

    # 1) Cache hit: access token ancora valido (margine 60s)
    cached = _GD_TOKEN_CACHE.get(user_id)
    now_naive = datetime.utcnow()
    if cached and cached.get("key") == refresh_enc and cached.get("expiry") and cached["expiry"] - timedelta(seconds=60) > now_naive:
        return _build(cached["token"], cached["expiry"])

    # 2) Refresh con retry sugli errori transitori
    creds = _build()
    last_exc: Optional[Exception] = None
    for attempt in range(3):
        try:
            await asyncio.to_thread(creds.refresh, GoogleRequest())
            last_exc = None
            break
        except Exception as e:  # noqa: BLE001
            last_exc = e
            msg = str(e).lower()
            if "invalid_grant" in msg:
                # Token revocato/scaduto CONFERMATO da Google → rimuovi la connessione locale.
                _GD_TOKEN_CACHE.pop(user_id, None)
                await db.google_drive_connections.delete_one({"user_id": user_id})
                logger.warning("[gdrive] invalid_grant per user=%s: connessione rimossa", user_id)
                raise HTTPException(status_code=401, detail="Token Google revocato o non valido: forza riconnessione") from e
            logger.warning("[gdrive] refresh transitorio fallito (tentativo %d/3) user=%s: %s", attempt + 1, user_id, e)
            if attempt < 2:
                await asyncio.sleep(0.5 * (2 ** attempt))
    if last_exc is not None:
        raise HTTPException(status_code=503, detail="Google Drive temporaneamente non raggiungibile: riprova tra qualche istante") from last_exc

    # 3) Salva in cache (expiry naive UTC come da google-auth; fallback 55 min)
    exp = creds.expiry or (now_naive + timedelta(minutes=55))
    if creds.token:
        _GD_TOKEN_CACHE[user_id] = {"key": refresh_enc, "token": creds.token, "expiry": exp}
    return creds


@api_router.get("/google-drive/status")
async def google_drive_status(user=Depends(get_current_user)):
    """Ritorna lo stato di connessione Drive dell'utente (senza mai esporre il token)."""
    if not _gd_configured():
        return {"connected": False, "configured": False}
    row = await db.google_drive_connections.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "scopes": 1, "updated_at": 1, "google_email": 1},
    )
    # V50.z110 — Espone il redirect URI usato nel flow OAuth: deve coincidere
    # ESATTAMENTE con uno degli "Authorized redirect URIs" in Google Cloud Console.
    return {"connected": bool(row), "configured": True, "redirect_uri": _sanitize_redirect_uri(_GD_REDIRECT_URI), **(row or {})}


# V50.z154 — Info di ritorno all'app inviate dal client allo start OAuth
class OAuthStartIn(BaseModel):
    return_url: Optional[str] = None       # deep-link app (frontend://google-drive?oauth=google, exp://…)
    android_package: Optional[str] = None  # per intent:// su Android
    platform: Optional[str] = None


def _oauth_app_return(body: Optional["OAuthStartIn"]) -> Dict[str, Any]:
    if not body:
        return {}
    ru = (body.return_url or "").strip()
    # Solo scheme custom / exp / https (no javascript: ecc.)
    if ru and not re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://", ru):
        ru = ""
    pkg = (body.android_package or "").strip()
    if pkg and not re.match(r"^[a-zA-Z0-9_.]+$", pkg):
        pkg = ""
    out: Dict[str, Any] = {}
    if ru:
        out["return_url"] = ru[:500]
    if pkg:
        out["android_package"] = pkg[:200]
    if body.platform:
        out["platform"] = str(body.platform)[:20]
    return out


@api_router.post("/google-drive/oauth/start")
async def google_drive_oauth_start(body: Optional[OAuthStartIn] = None, user=Depends(get_current_user)):
    """Genera l'authorization URL per il flow OAuth. Lo state è persistito con TTL 10min."""
    if not _gd_configured():
        raise HTTPException(status_code=503, detail="Google Drive non configurato sul server")
    from google_auth_oauthlib.flow import Flow  # type: ignore
    nonce = _secrets.token_urlsafe(32)
    # V29.aw — Sanitize redirect_uri BEFORE creating the flow so PKCE code_verifier
    # (generated by google_auth_oauthlib.flow.authorization_url when it embeds a
    # code_challenge in the auth URL) is bound to the exact same redirect_uri
    # we will use at token exchange time.
    clean_redirect = _sanitize_redirect_uri(_GD_REDIRECT_URI)
    flow = Flow.from_client_config(_gd_client_config(), scopes=_GD_SCOPES, state=nonce, redirect_uri=clean_redirect)
    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    # V29.aw — CRITICAL: google_auth_oauthlib >= 1.0 automatically generates a
    # PKCE code_verifier and embeds the code_challenge in the authorization URL.
    # When Google redirects back with the code, it EXPECTS the code_verifier at
    # token exchange. Since our callback creates a NEW Flow instance, we must
    # persist the verifier here and restore it before calling fetch_token, else
    # Google returns "invalid_grant: Missing code verifier".
    code_verifier = getattr(flow, "code_verifier", None)
    # Salva lo state con TTL (indice creato al primo utilizzo) + code_verifier
    await db.google_oauth_states.insert_one({
        "_id": nonce,
        "user_id": user["user_id"],
        "code_verifier": code_verifier,  # V29.aw — may be None if lib version < 1.0 (older versions didn't do PKCE)
        "redirect_uri": clean_redirect,  # persist to guarantee identical value at exchange time
        "app_return": _oauth_app_return(body),  # V50.z154
        "expires_at": utcnow(),
        "created_at": utcnow(),
    })
    # Creiamo indice TTL una volta sola (idempotent)
    # V50.z54 — TTL portato da 600s (10min) a 1800s (30min): il flusso OAuth
    # Google può richiedere più di 10min quando l'utente ha 2FA con codice via
    # SMS, aggiunge un account, o rinegozia i permessi. TTL più lungo elimina
    # falsi "Sessione scaduta" nel callback.
    try:
        await db.google_oauth_states.create_index("created_at", expireAfterSeconds=1800)
    except Exception:
        pass
    logger.info(
        "OAuth start: redirect_uri=%r, code_verifier=%s",
        clean_redirect,
        "<set>" if code_verifier else "<none>",
    )
    return {"authorization_url": authorization_url}


class GoogleDriveExchangeIn(BaseModel):
    code: str
    state: str


class GoogleDriveMobileExchangeIn(BaseModel):
    """V29.ah — Payload per lo scambio del code OAuth ottenuto tramite
    expo-auth-session (mobile app). Non usa uno `state` server-side ma il
    verifier PKCE generato dal client e il `redirect_uri` deep-link o
    exp:// URI restituito da `AuthSession.makeRedirectUri()`."""
    code: str
    code_verifier: str
    redirect_uri: str


@api_router.post("/google-drive/oauth/mobile-exchange")
async def google_drive_oauth_mobile_exchange(body: GoogleDriveMobileExchangeIn, user=Depends(get_current_user)):
    """Scambia il code OAuth per un refresh_token — flow PKCE per mobile.
    L'utente autenticato è passato via Bearer token (nessun bisogno di state
    server-side perché PKCE + user JWT garantiscono l'identità)."""
    if not _gd_configured():
        raise HTTPException(status_code=503, detail="Google Drive non configurato")
    import httpx  # type: ignore
    try:
        cfg = _gd_client_config()["web"]
        form = {
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "code": body.code,
            "code_verifier": body.code_verifier,
            "grant_type": "authorization_code",
            "redirect_uri": body.redirect_uri,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post("https://oauth2.googleapis.com/token", data=form)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Google token exchange failed: {resp.text[:200]}")
        tokens = resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Scambio code fallito: {e}")

    refresh = tokens.get("refresh_token")
    if not refresh:
        old = await db.google_drive_connections.find_one({"user_id": user["user_id"]})
        if old:
            refresh = _gd_fernet.decrypt(old["refresh_token_enc"].encode()).decode()
        else:
            raise HTTPException(status_code=400, detail="Nessun refresh_token ricevuto; revoca l'accesso in Google e riprova")

    # Best-effort: recupera email account Google
    google_email = None
    try:
        access = tokens.get("access_token")
        if access:
            async with httpx.AsyncClient(timeout=10) as client:
                info_resp = await client.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {access}"},
                )
                if info_resp.status_code == 200:
                    google_email = info_resp.json().get("email")
    except Exception:
        pass

    doc = {
        "user_id": user["user_id"],
        "refresh_token_enc": _gd_fernet.encrypt(refresh.encode()).decode(),
        "scopes": (tokens.get("scope") or "").split() or list(_GD_SCOPES),
        "google_email": google_email,
        "updated_at": utcnow(),
    }
    await db.google_drive_connections.update_one(
        {"user_id": user["user_id"]}, {"$set": doc, "$setOnInsert": {"created_at": utcnow()}}, upsert=True
    )
    return {"ok": True, "google_email": google_email}


@api_router.post("/google-drive/oauth/exchange")
async def google_drive_oauth_exchange(body: GoogleDriveExchangeIn):
    """Scambia il code OAuth per un refresh_token. Chiamato dalla pagina di callback FE."""
    if not _gd_configured():
        raise HTTPException(status_code=503, detail="Google Drive non configurato")
    s = await db.google_oauth_states.find_one_and_delete({"_id": body.state})
    if not s:
        raise HTTPException(status_code=400, detail="State OAuth non valido o scaduto")
    from google_auth_oauthlib.flow import Flow  # type: ignore
    from googleapiclient.discovery import build  # type: ignore
    try:
        # V29.aw — Restore PKCE code_verifier and redirect_uri persisted at start.
        stored_redirect = s.get("redirect_uri") or _sanitize_redirect_uri(_GD_REDIRECT_URI)
        stored_verifier = s.get("code_verifier")
        flow = Flow.from_client_config(_gd_client_config(), scopes=_GD_SCOPES, state=body.state, redirect_uri=stored_redirect)
        if stored_verifier:
            flow.code_verifier = stored_verifier
        flow.fetch_token(code=body.code)
        creds = flow.credentials
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Scambio code fallito: {e}")
    refresh = creds.refresh_token
    if not refresh:
        # Riuso del refresh_token vecchio se disponibile (Google non lo re-invia se già concesso)
        old = await db.google_drive_connections.find_one({"user_id": s["user_id"]})
        if old:
            refresh = _gd_fernet.decrypt(old["refresh_token_enc"].encode()).decode()
        else:
            raise HTTPException(status_code=400, detail="Nessun refresh_token ricevuto; revoca l'accesso in Google e riprova")
    # Tentativo di leggere l'email account per debug/UI (best-effort)
    google_email = None
    try:
        oauth2_service = build("oauth2", "v2", credentials=creds, cache_discovery=False)
        info = oauth2_service.userinfo().get().execute()
        google_email = info.get("email")
    except Exception:
        pass
    doc = {
        "user_id": s["user_id"],
        "refresh_token_enc": _gd_fernet.encrypt(refresh.encode()).decode(),
        "scopes": list(creds.scopes or _GD_SCOPES),
        "google_email": google_email,
        "updated_at": utcnow(),
    }
    await db.google_drive_connections.update_one(
        {"user_id": s["user_id"]}, {"$set": doc, "$setOnInsert": {"created_at": utcnow()}}, upsert=True
    )
    return {"ok": True, "google_email": google_email}


@api_router.delete("/google-drive")
async def google_drive_disconnect(user=Depends(get_current_user)):
    """Revoca il refresh_token e cancella la connessione."""
    row = await db.google_drive_connections.find_one({"user_id": user["user_id"]})
    if not row:
        return {"connected": False}
    if _gd_fernet:
        try:
            refresh = _gd_fernet.decrypt(row["refresh_token_enc"].encode()).decode()
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post("https://oauth2.googleapis.com/revoke", params={"token": refresh})
        except Exception:
            pass
    await db.google_drive_connections.delete_one({"user_id": user["user_id"]})
    # V50.i — Rimuovi anche la lista di cartelle Axon salvate
    await db.google_drive_folders.delete_many({"user_id": user["user_id"]})
    return {"connected": False}


# =========================================================================
# V50.i — Google Picker + gestione cartelle Axon
#
# Flusso:
#   1) Frontend chiama GET /google-drive/picker-config → riceve api_key,
#      app_id (numeric project number derivato dal client_id) e un
#      access_token fresco (mintato dal refresh_token cifrato).
#   2) Frontend renderizza una WebView con l'HTML del Picker (contenente
#      Google Picker JS SDK). L'utente sceglie 1 o più cartelle.
#   3) Il Picker chiama window.ReactNativeWebView.postMessage con i folder_id.
#   4) Frontend POST /google-drive/folders → salva {id, name} in Mongo.
#   5) Da qui in poi, quando `folder_id` NON è specificato in /files, la
#      lista è filtrata SOLO alle cartelle Axon dell'utente (con scope
#      drive.file, comunque le altre non sarebbero visibili).
# =========================================================================

@api_router.get("/google-drive/picker-config")
async def google_drive_picker_config(user=Depends(get_current_user)):
    """Ritorna api_key + app_id + access_token per il Google Picker.

    `app_id` = project number, estratto dalla prima parte del client_id
    (formato: `<PROJECT_NUMBER>-<HASH>.apps.googleusercontent.com`).
    """
    if not _gd_configured():
        raise HTTPException(status_code=503, detail="Google Drive non configurato")
    if not _GD_API_KEY:
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY mancante lato server. Vai su Google Cloud → Credentials → API key → abilita Picker API + Drive API.")
    # Access token fresco dal refresh
    creds = await _gd_get_credentials(user["user_id"])
    access_token = getattr(creds, "token", None)
    if not access_token:
        raise HTTPException(status_code=401, detail="Impossibile ottenere access_token")
    # App ID = project number davanti al primo dash del client_id
    app_id = (_GD_CLIENT_ID or "").split("-", 1)[0] if _GD_CLIENT_ID else ""
    return {
        "api_key": _GD_API_KEY,
        "app_id": app_id,
        "client_id": _GD_CLIENT_ID,
        "oauth_token": access_token,
    }


class DrivePickedFolderIn(BaseModel):
    id: str
    name: str


class DrivePickedFoldersIn(BaseModel):
    folders: List[DrivePickedFolderIn]


@api_router.get("/google-drive/folders")
async def google_drive_folders_list(user=Depends(get_current_user)):
    """Lista le cartelle Axon scelte dall'utente."""
    cur = db.google_drive_folders.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "folder_id": 1, "folder_name": 1, "picked_at": 1},
    ).sort("picked_at", -1)
    items = [i async for i in cur]
    return {"folders": items}


@api_router.post("/google-drive/folders")
async def google_drive_folders_add(body: DrivePickedFoldersIn, user=Depends(get_current_user)):
    """Aggiunge una o più cartelle scelte dal picker (upsert per folder_id)."""
    if not body.folders:
        return {"added": 0}
    now = utcnow()
    added = 0
    for f in body.folders:
        if not f.id or not f.name:
            continue
        r = await db.google_drive_folders.update_one(
            {"user_id": user["user_id"], "folder_id": f.id},
            {"$set": {
                "user_id": user["user_id"],
                "folder_id": f.id,
                "folder_name": f.name,
                "picked_at": now,
            }},
            upsert=True,
        )
        if r.upserted_id or r.modified_count:
            added += 1
    if added:
        _schedule_drive_reindex(user["user_id"], reason="folders-added")  # V50.z155
    return {"added": added}


@api_router.delete("/google-drive/folders/{folder_id}")
async def google_drive_folders_remove(folder_id: str, user=Depends(get_current_user)):
    """Rimuove una cartella dalla lista Axon (non revoca l'OAuth grant)."""
    r = await db.google_drive_folders.delete_one({"user_id": user["user_id"], "folder_id": folder_id})
    if r.deleted_count:
        _schedule_drive_reindex(user["user_id"], reason="folder-removed")  # V50.z155
    return {"removed": r.deleted_count}


async def _gd_user_folder_ids(user_id: str) -> List[str]:
    """Helper: ritorna gli ID delle cartelle Axon salvate (o [] se nessuna)."""
    cur = db.google_drive_folders.find({"user_id": user_id}, {"_id": 0, "folder_id": 1})
    return [d["folder_id"] async for d in cur if d.get("folder_id")]


# V50.t — Browse cartelle Drive per il picker NATIVO (RN, non WebView).
@api_router.get("/google-drive/folders/browse")
async def google_drive_folders_browse(
    parent: str = "root",
    q: str = "",
    user=Depends(get_current_user),
):
    """Lista cartelle figlie di `parent` (default root) opzionalmente filtrate da `q`.

    V50.u — Se `q` è presente, la ricerca diventa GLOBALE su tutto il Drive
    (non più limitata al parent corrente). Così l'utente che cerca dalla root
    "corporate club" trova la cartella anche se è annidata in profondità.
    Ritorna anche `path` (percorso leggibile) per ogni risultato quando globale.

    Ritorna:
        { parent: str, folders: [{id, name, path?}], global_search: bool }
    """
    if not _gd_configured():
        raise HTTPException(status_code=503, detail="Google Drive non configurato")
    from googleapiclient.discovery import build  # type: ignore
    try:
        creds = await _gd_get_credentials(user["user_id"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Credenziali Drive non valide: {e}")
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    q_clean = (q or "").strip()
    is_global = bool(q_clean)
    clauses = [
        "mimeType = 'application/vnd.google-apps.folder'",
        "trashed = false",
    ]
    if not is_global:
        # Navigazione livello per livello
        clauses.append(f"'{parent}' in parents")
    else:
        # Ricerca globale su tutto il Drive
        q_esc = q_clean.replace("'", "\\'")
        clauses.append(f"name contains '{q_esc}'")
    query = " and ".join(clauses)
    try:
        r = service.files().list(
            q=query,
            spaces="drive",
            fields="files(id,name,parents)",
            pageSize=200,
            orderBy="name",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            corpora="user",
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore Drive: {e}")
    raw = r.get("files") or []

    # Se ricerca globale, costruiamo un path leggibile risalendo i parents.
    # Cache di lookup per non chiedere lo stesso id due volte.
    name_cache: Dict[str, Dict[str, Any]] = {}

    def _resolve_parent(pid: str) -> Optional[Dict[str, Any]]:
        if not pid or pid == "root":
            return None
        if pid in name_cache:
            return name_cache[pid]
        try:
            info = service.files().get(
                fileId=pid,
                fields="id,name,parents",
                supportsAllDrives=True,
            ).execute()
            name_cache[pid] = info
            return info
        except Exception:
            return None

    folders = []
    for f in raw:
        item: Dict[str, Any] = {"id": f.get("id"), "name": f.get("name")}
        if is_global:
            # Ricostruisci path risalendo max 6 livelli
            path_parts: List[str] = []
            parents = f.get("parents") or []
            cur = parents[0] if parents else None
            depth = 0
            while cur and depth < 6:
                info = _resolve_parent(cur)
                if not info:
                    break
                path_parts.insert(0, info.get("name") or "")
                nps = info.get("parents") or []
                cur = nps[0] if nps else None
                depth += 1
            if path_parts:
                item["path"] = "My Drive / " + " / ".join(path_parts)
            else:
                item["path"] = "My Drive"
        folders.append(item)
    return {"parent": parent, "folders": folders, "global_search": is_global}


@api_router.get("/google-drive/files")
async def google_drive_list_files(search: Optional[str] = None, mime_type: Optional[str] = None, page_token: Optional[str] = None, folder_id: Optional[str] = None, user=Depends(get_current_user)):
    """Lista i file Drive accessibili.
    V50.q — Aggiunto `folder_id` per navigare dentro una cartella (`'ID' in parents`).
    """
    from googleapiclient.discovery import build  # type: ignore
    from googleapiclient.errors import HttpError  # type: ignore
    creds = await _gd_get_credentials(user["user_id"])
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    clauses = ["trashed = false"]
    if folder_id:
        # V50.q — Naviga dentro la cartella (folders sono file con parents)
        clauses.append(f"'{folder_id}' in parents")
    else:
        # V50.i — Se l'utente ha scelto delle "cartelle Axon" tramite Picker,
        # limitiamo l'elenco top-level a QUELLE cartelle (e ai loro figli
        # diretti). Se non ne ha ancora scelte, ritorniamo elenco vuoto con
        # un flag `needs_picker` così il frontend può guidarlo al picker.
        user_folders = await _gd_user_folder_ids(user["user_id"])
        if not user_folders:
            return {"files": [], "needs_picker": True, "message": "Scegli una cartella Axon dal picker"}
        # Filtra ai figli diretti delle cartelle scelte
        parents_or = " or ".join([f"'{fid}' in parents" for fid in user_folders])
        clauses.append(f"({parents_or})")
    if search:
        escaped = search.replace("'", "\\'")
        clauses.append(f"name contains '{escaped}'")
    if mime_type:
        clauses.append(f"mimeType = '{mime_type.replace(chr(39), chr(92) + chr(39))}'")
    try:
        result = service.files().list(
            q=" and ".join(clauses),
            pageSize=50,
            pageToken=page_token,
            orderBy="folder,modifiedTime desc",
            fields="nextPageToken,files(id,name,mimeType,size,modifiedTime,iconLink,webViewLink)",
        ).execute()
        return result
    except HttpError as e:
        raise HTTPException(status_code=e.resp.status, detail=f"Google Drive list: {e}")


@api_router.get("/google-drive/files/{file_id}/content")
async def google_drive_download_file(file_id: str, user=Depends(get_current_user)):
    """Scarica un file Drive e lo ritorna nel formato attachment (name, mime, data_base64)."""
    from googleapiclient.discovery import build  # type: ignore
    from googleapiclient.errors import HttpError  # type: ignore
    from googleapiclient.http import MediaIoBaseDownload  # type: ignore
    from io import BytesIO
    creds = await _gd_get_credentials(user["user_id"])
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    try:
        meta = service.files().get(fileId=file_id, fields="id,name,mimeType,size").execute()
        out = BytesIO()
        mime = meta.get("mimeType", "")
        # Google-native docs devono essere esportati
        if mime.startswith("application/vnd.google-apps."):
            if mime.endswith("document"):
                export_mime = "application/pdf"
                out_ext = ".pdf"
            elif mime.endswith("spreadsheet"):
                export_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                out_ext = ".xlsx"
            elif mime.endswith("presentation"):
                export_mime = "application/pdf"
                out_ext = ".pdf"
            else:
                export_mime = "application/pdf"
                out_ext = ".pdf"
            req = service.files().export_media(fileId=file_id, mimeType=export_mime)
            display_name = f"{meta.get('name','file')}{out_ext}"
            display_mime = export_mime
        else:
            req = service.files().get_media(fileId=file_id)
            display_name = meta.get("name", "file")
            display_mime = mime or "application/octet-stream"
        downloader = MediaIoBaseDownload(out, req, chunksize=1024 * 1024)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        raw = out.getvalue()
        # Limita a 10MB per coerenza col picker esistente
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"File troppo grande (>10MB): {display_name}")
        return {
            "name": display_name,
            "mime": display_mime,
            "data_base64": _b64.b64encode(raw).decode(),
            "size": len(raw),
        }
    except HttpError as e:
        raise HTTPException(status_code=e.resp.status, detail=f"Google Drive download: {e}")


# =========================================================================
