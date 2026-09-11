# 29_dropbox.py — Dropbox OAuth
# Estratto da server.py (righe originali 20971-21196). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V49.i — Dropbox OAuth 2.0 integration
#
# Pattern: authorization code + PKCE, server-side token exchange.
# Frontend: apre `/api/dropbox/oauth/start` → riceve authorization_url →
#   redirige a Dropbox → Dropbox redirige a `/auth/dropbox/callback?code=...`
#   (rotta frontend) che POSTa il code a `/api/dropbox/oauth/exchange`.
# Backend: salva refresh_token cifrato e usa il token per browsing/download.
# =========================================================================
import hashlib as _dbx_hashlib

_DBX_APP_KEY = os.environ.get("DROPBOX_APP_KEY", "").strip()
_DBX_APP_SECRET = os.environ.get("DROPBOX_APP_SECRET", "").strip()
_DBX_REDIRECT_URI = os.environ.get("DROPBOX_REDIRECT_URI", "").strip()
_DBX_SCOPES = "files.metadata.read files.content.read account_info.read"


def _dbx_configured() -> bool:
    return bool(_DBX_APP_KEY and _DBX_APP_SECRET and _DBX_REDIRECT_URI)


def _dbx_b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _dbx_pkce_pair() -> Tuple[str, str]:
    verifier = _dbx_b64url(secrets.token_bytes(48))
    challenge = _dbx_b64url(_dbx_hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


async def _dbx_access_token(user_id: str) -> str:
    """Refresh & return a short-lived access token per l'utente."""
    if not _dbx_configured():
        raise HTTPException(status_code=503, detail="Dropbox non configurato sul server")
    row = await db.dropbox_connections.find_one({"user_id": user_id})
    if not row or not row.get("refresh_token"):
        raise HTTPException(status_code=401, detail="Dropbox non collegato")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.dropboxapi.com/oauth2/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": row["refresh_token"],
                "client_id": _DBX_APP_KEY,
                "client_secret": _DBX_APP_SECRET,
            },
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Dropbox: sessione scaduta, ricollega")
    return r.json().get("access_token", "")


@api_router.get("/dropbox/status")
async def dropbox_status(user=Depends(get_current_user)):
    if not _dbx_configured():
        return {"connected": False, "configured": False}
    row = await db.dropbox_connections.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "dropbox_email": 1, "updated_at": 1, "account_id": 1},
    )
    return {"connected": bool(row), "configured": True, **(row or {})}


@api_router.post("/dropbox/oauth/start")
async def dropbox_oauth_start(body: Optional[OAuthStartIn] = None, user=Depends(get_current_user)):
    if not _dbx_configured():
        raise HTTPException(status_code=503, detail="Dropbox non configurato sul server")
    state = secrets.token_urlsafe(32)
    verifier, challenge = _dbx_pkce_pair()
    await db.dropbox_oauth_states.insert_one({
        "_id": state,
        "user_id": user["user_id"],
        "code_verifier": verifier,
        "app_return": _oauth_app_return(body),  # V50.z154
        "expires_at": utcnow() + timedelta(minutes=10),
    })
    from urllib.parse import urlencode
    params = {
        "client_id": _DBX_APP_KEY,
        "response_type": "code",
        "redirect_uri": _DBX_REDIRECT_URI,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "token_access_type": "offline",
        "scope": _DBX_SCOPES,
    }
    return {"authorization_url": "https://www.dropbox.com/oauth2/authorize?" + urlencode(params)}


class DropboxExchangeIn(BaseModel):
    code: str
    state: str


@api_router.post("/dropbox/oauth/exchange")
async def dropbox_oauth_exchange(body: DropboxExchangeIn, user=Depends(get_current_user)):
    if not _dbx_configured():
        raise HTTPException(status_code=503, detail="Dropbox non configurato sul server")
    st = await db.dropbox_oauth_states.find_one_and_delete({"_id": body.state})
    if not st or st.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=400, detail="Stato OAuth non valido o scaduto")
    # V50.q — normalizza a UTC (Mongo può restituire naive)
    exp = st.get("expires_at")
    if exp is not None and getattr(exp, "tzinfo", None) is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp is not None and exp < utcnow():
        raise HTTPException(status_code=400, detail="Stato OAuth scaduto")
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            "https://api.dropboxapi.com/oauth2/token",
            data={
                "code": body.code,
                "grant_type": "authorization_code",
                "client_id": _DBX_APP_KEY,
                "client_secret": _DBX_APP_SECRET,
                "redirect_uri": _DBX_REDIRECT_URI,
                "code_verifier": st["code_verifier"],
            },
        )
    if r.status_code != 200:
        logger.warning("[dropbox] token exchange %s: %s", r.status_code, r.text[:200])
        raise HTTPException(status_code=502, detail="Scambio token Dropbox fallito")
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
        {"user_id": user["user_id"]},
        {"$set": {
            "user_id": user["user_id"],
            "account_id": account_id,
            "dropbox_email": dropbox_email,
            "refresh_token": tok.get("refresh_token", ""),
            "scopes": tok.get("scope") or _DBX_SCOPES,
            "updated_at": utcnow(),
        }},
        upsert=True,
    )
    return {"ok": True, "dropbox_email": dropbox_email}


@api_router.delete("/dropbox")
async def dropbox_disconnect(user=Depends(get_current_user)):
    await db.dropbox_connections.delete_one({"user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/dropbox/files")
async def dropbox_list_files(search: Optional[str] = None, cursor: Optional[str] = None, user=Depends(get_current_user)):
    token = await _dbx_access_token(user["user_id"])
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        if search and search.strip():
            r = await client.post(
                "https://api.dropboxapi.com/2/files/search_v2",
                json={"query": search.strip(), "options": {"max_results": 50, "file_status": "active"}},
                headers=headers,
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=f"Dropbox search: {r.text[:120]}")
            data = r.json()
            files = []
            for m in data.get("matches", []):
                md = (m.get("metadata") or {}).get("metadata") or m.get("metadata")
                if md and md.get(".tag") == "file":
                    files.append(md)
            return {"files": files, "cursor": None, "has_more": False}
        endpoint = "https://api.dropboxapi.com/2/files/list_folder/continue" if cursor else "https://api.dropboxapi.com/2/files/list_folder"
        payload = {"cursor": cursor} if cursor else {"path": "", "recursive": False, "include_non_downloadable_files": False, "limit": 100}
        r = await client.post(endpoint, json=payload, headers=headers)
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=f"Dropbox list: {r.text[:120]}")
    data = r.json()
    return {
        "files": [e for e in data.get("entries", []) if e.get(".tag") == "file"],
        "folders": [e for e in data.get("entries", []) if e.get(".tag") == "folder"],
        "cursor": data.get("cursor"),
        "has_more": data.get("has_more", False),
    }


@api_router.get("/dropbox/files/{file_id:path}/content")
async def dropbox_download_file(file_id: str, user=Depends(get_current_user)):
    token = await _dbx_access_token(user["user_id"])
    # file_id può essere "id:xxx" oppure un path "/cartella/file.pdf"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://content.dropboxapi.com/2/files/download",
            headers={
                "Authorization": f"Bearer {token}",
                "Dropbox-API-Arg": _json_stdlib.dumps({"path": file_id}),
            },
        )
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=f"Dropbox download: {r.text[:200]}")
    md = {}
    try:
        md = _json_stdlib.loads(r.headers.get("Dropbox-API-Result", "{}"))
    except Exception:
        pass
    raw = r.content or b""
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File troppo grande (>10MB)")
    return {
        "name": md.get("name") or "file",
        "mime": "application/octet-stream",
        "data_base64": base64.b64encode(raw).decode(),
        "size": len(raw),
    }


# =========================================================================
