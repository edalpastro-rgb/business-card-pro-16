# 00_core.py — Import, .env, Mongo, JWT, FastAPI app + api_router, costanti globali
# Estratto da server.py (righe originali 1-288). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status, BackgroundTasks, Request, Body, UploadFile, File, Form
from fastapi.responses import PlainTextResponse, HTMLResponse, Response
from urllib.parse import quote_plus as _quote_plus_std
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import bcrypt
import jwt
import httpx
import smtplib
import ssl
import asyncio
import base64
import json as _json_stdlib
import re
import secrets
import io
import html as html_lib  # V50.z273
import pyotp
import qrcode
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any, Literal, Tuple
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT config
# In production JWT_SECRET MUST be provided via environment. In dev/test we allow a
# non-persistent random fallback that is generated fresh on process start so tokens
# never leak across environments and are never predictable.
_JWT_SECRET_ENV = os.environ.get('JWT_SECRET')
if _JWT_SECRET_ENV:
    JWT_SECRET = _JWT_SECRET_ENV
elif os.environ.get('APP_ENV', 'development').lower() in ('production', 'prod'):
    raise RuntimeError("JWT_SECRET environment variable is required in production but was not set.")
else:
    import secrets as _secrets_mod
    JWT_SECRET = _secrets_mod.token_urlsafe(64)
    import logging as _logging_mod
    _logging_mod.getLogger(__name__).warning(
        "JWT_SECRET not set; generated a random per-process secret for development. "
        "All sessions will invalidate on backend restart."
    )
JWT_ALG = 'HS256'
JWT_EXP_DAYS = 30

# 2FA config
TOTP_ISSUER = os.environ.get('TOTP_ISSUER', 'Dal Pastro CRM')
TEMP_2FA_TOKEN_MINUTES = 10
DEVICE_TRUST_HOURS = 24

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ── Lightweight unauthenticated health probes (used by K8s/ingress deploy checks)
@app.get("/health")
async def _root_health():
    return {"status": "ok"}


@api_router.get("/health")
async def _api_health():
    return {"status": "ok"}


# V29.b — Defensive safety net: se per qualche misconfig di ingress il redirect
# OAuth di Google finisce sul backend anziché sul frontend, ripiega redirigendo
# alla pagina Expo Router che sa gestire code/state. Non impatta il flow normale.
# V29.ap — La route GET /auth/google/callback ora completa lo scambio del code
# LATO SERVER (invece di limitarsi a redirigere al frontend). Motivazione: su
# APK Android il chrome custom tab spesso "perde" il redirect a un URL scheme
# custom dopo il primo hop → il vecchio bridge redirect al frontend non
# raggiungeva mai l'app. Ora invece:
#  1. Google reindirizza qui con code+state
#  2. Chiamiamo internamente la logica di scambio (equivalente a POST
#     /google-drive/oauth/exchange) — best effort, se fallisce non è drammatico
#  3. Rispondiamo con una pagina HTML "Autorizzato ✓ Torna all'app"
#  4. L'app in foreground rileva via polling /google-drive/status che il token
#     è ora presente → aggancia la UI.
# V50.z154 — Ritorno all'app affidabile su Android (APK):
#  • Il client passa a `/oauth/start` il proprio deep-link (`return_url`, es.
#    frontend://google-drive?oauth=google) e il package Android; li salviamo
#    nello state e nella connessione, così la pagina di callback NON deve più
#    indovinare la piattaforma dallo User-Agent (il vecchio check "android;"
#    non matchava mai "Android 14;" → su APK veniva usato il link HTTPS web e
#    l'utente restava nel browser).
#  • Su Android il bottone/auto-redirect usano un URL `intent://…#Intent;
#    scheme=…;package=…;end`: Chrome e Samsung Internet lo onorano sempre,
#    mentre `scheme://` da JS viene spesso ignorato senza gesto utente.
def _oauth_return_links(ret: dict, ua: str, default_path: str, provider_key: str, ok: bool):
    """Return (deep_link, intent_link|None) for the OAuth callback page."""
    from urllib.parse import quote as _q
    ret = ret or {}
    status = "ok" if ok else "err"
    ua_l = (ua or "").lower()
    is_android = "android" in ua_l
    is_ios = any(k in ua_l for k in ("iphone", "ipad", "ipod", "cfnetwork/", "darwin"))
    is_app = bool(ret.get("return_url")) or is_android or is_ios or any(k in ua_l for k in ("expo", "advisoros-app", "okhttp"))
    base = (ret.get("return_url") or "").strip()
    if base:
        sep = "&" if "?" in base else "?"
        if f"oauth=" not in base:
            base = f"{base}{sep}oauth={provider_key}"
            sep = "&"
        deep = f"{base}{sep}status={status}"
    elif not is_app:
        web_ret = _GD_FRONTEND_URL or "https://advisoros.it/"
        sep = "&" if "?" in web_ret else "?"
        deep = f"{web_ret}{sep}oauth={provider_key}&status={status}"
    else:
        deep = f"frontend://{default_path}?oauth={provider_key}&status={status}"
    intent = None
    pkg = (ret.get("android_package") or "").strip()
    if is_android and pkg and "://" in deep and not deep.lower().startswith("http"):
        scheme, rest = deep.split("://", 1)
        intent = f"intent://{rest}#Intent;scheme={scheme};package={pkg};S.browser_fallback_url={_q(deep, safe='')};end"
    return deep, intent


def _oauth_return_page_html(title: str, ok: bool, message: str, detail: str, deep_link: str, intent_link: Optional[str], color_ok: str) -> str:
    color = color_ok if ok else "#DC2626"
    icon = "✓" if ok else "✗"
    href = intent_link or deep_link
    return f"""<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AdvisorOS · {title}</title>
<style>
body {{ font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 32px;
       background: #0F2438; color: #FFF; min-height: 100vh; display: flex; flex-direction: column;
       align-items: center; justify-content: center; text-align: center; }}
.circle {{ width: 88px; height: 88px; border-radius: 44px; background: {color};
           display: flex; align-items: center; justify-content: center; font-size: 48px;
           color: #FFF; font-weight: 800; margin-bottom: 20px; }}
h1 {{ font-size: 22px; margin: 0 0 8px 0; font-weight: 800; letter-spacing: -0.4px; }}
p {{ color: rgba(255,255,255,0.75); font-size: 14px; margin: 4px 0; max-width: 380px; }}
.btn {{ display: inline-block; margin-top: 22px; padding: 14px 28px;
        background: #EA580C; color: #FFF; font-weight: 800; font-size: 15px;
        border-radius: 999px; text-decoration: none; letter-spacing: 0.3px;
        box-shadow: 0 6px 20px rgba(234,88,12,0.35); }}
.btn:active {{ transform: scale(0.98); }}
.hint {{ margin-top: 14px; color: #38BDF8; font-size: 11px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 1px; }}
.small {{ margin-top: 18px; color: rgba(255,255,255,0.5); font-size: 12px; }}
</style></head><body>
<div class="circle">{icon}</div>
<h1>{message}</h1>
<p>{detail}</p>
<a class="btn" id="openApp" href="{href}">Apri AdvisorOS</a>
<p class="hint">Ti riportiamo automaticamente all'app…</p>
<p class="small">Se non succede nulla, tocca "Apri AdvisorOS" oppure chiudi questa scheda e torna all'app.</p>
<script>
(function(){{
  var deep = "{deep_link}";
  var intent = {('"' + intent_link + '"') if intent_link else 'null'};
  // 1) Android: prova subito l'intent (Chrome/Samsung Internet), poi lo scheme.
  //    iOS/altri: scheme diretto.
  try {{ window.location.href = intent || deep; }} catch(e){{}}
  setTimeout(function(){{ try {{ window.location.href = deep; }} catch(e){{}} }}, 1200);
  // 2) Fallback: chiude il tab/browser (funziona solo se aperto da script/in-app)
  setTimeout(function(){{ try{{ window.close(); }} catch(e){{}} }}, 4000);
}})();
</script>
</body></html>"""


@app.get("/auth/google/callback")
async def _oauth_callback_bridge(request: Request):
    from fastapi.responses import HTMLResponse, RedirectResponse
    qp = request.query_params
    code = qp.get("code")
    state = qp.get("state")
    err = qp.get("error")
    _ua = request.headers.get("user-agent") or ""
    # V50.z154 — Info di ritorno all'app (deep-link + package) salvate allo start
    # o sulla connessione: popolate appena disponibili, usate dalla pagina.
    ret_info: Dict[str, Any] = {}

    async def _try_exchange_and_page(ok: bool, message: str, detail: str = "") -> HTMLResponse:
        deep_link, intent_link = _oauth_return_links(ret_info, _ua, "google-drive", "google", ok)
        html = _oauth_return_page_html("Google Drive", ok, message, detail, deep_link, intent_link, "#16A34A")
        return HTMLResponse(content=html, status_code=200)

    if err:
        return await _try_exchange_and_page(False, "Autorizzazione annullata", err)
    if not code or not state:
        # V50.z110 — Su APK Android il custom tab può ricaricare/precaricare la
        # callback SENZA query (preload di Chrome, back, "Apri app" tardivo)
        # DOPO che il primo hit ha già completato lo scambio. Se esiste una
        # connessione salvata negli ultimi 5 minuti la mostriamo come riuscita
        # invece di un falso errore; altrimenti spieghiamo cosa fare.
        try:
            recent = await db.google_drive_connections.find_one(
                {"updated_at": {"$gte": utcnow() - timedelta(minutes=5)}},
                sort=[("updated_at", -1)],
            )
        except Exception:
            recent = None
        if recent:
            ret_info.update(recent.get("app_return") or {})
            return await _try_exchange_and_page(True, "Google Drive già collegato",
                                                f"Account: {recent.get('google_email') or ''}")
        return await _try_exchange_and_page(False, "Callback OAuth incompleto",
                                            "Google non ha restituito il codice di autorizzazione. "
                                            "Torna all'app e riprova da Google Drive → Collega.")

    # Scambio server-side (stesso codice del POST /google-drive/oauth/exchange)
    try:
        if not _gd_configured():
            return await _try_exchange_and_page(False, "Google Drive non configurato",
                                                "Contatta l'amministratore del server")
        s = await db.google_oauth_states.find_one_and_delete({"_id": state})
        if not s:
            # V50.z54 — La callback può essere invocata DUE VOLTE (browser
            # preload di Chrome, back-button, refresh accidentale). Al primo
            # hit consumiamo lo state e salviamo la connessione. Al secondo
            # hit lo state non c'è più: se però l'utente è già collegato
            # (updated_at negli ultimi 5 minuti), NON dobbiamo mostrare
            # "sessione scaduta" perché la connessione È andata a buon fine.
            recent = await db.google_drive_connections.find_one(
                {"updated_at": {"$gte": utcnow() - timedelta(minutes=5)}},
                sort=[("updated_at", -1)],
            )
            if recent:
                ret_info.update(recent.get("app_return") or {})
                return await _try_exchange_and_page(True, "Google Drive già collegato",
                                                    f"Account: {recent.get('google_email') or ''}")
            return await _try_exchange_and_page(False, "Sessione scaduta",
                                                "Riprova dalla schermata Google Drive")
        ret_info.update(s.get("app_return") or {})
        from google_auth_oauthlib.flow import Flow  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
        # V29.aw — Use the redirect_uri and code_verifier persisted at start time
        # so the PKCE proof stays valid across the two requests.
        stored_redirect = s.get("redirect_uri") or _sanitize_redirect_uri(_GD_REDIRECT_URI)
        stored_verifier = s.get("code_verifier")
        flow = Flow.from_client_config(_gd_client_config(), scopes=_GD_SCOPES, state=state, redirect_uri=stored_redirect)
        if stored_verifier:
            flow.code_verifier = stored_verifier
        flow.fetch_token(code=code)
        creds = flow.credentials
        refresh = creds.refresh_token
        if not refresh:
            old = await db.google_drive_connections.find_one({"user_id": s["user_id"]})
            if old:
                refresh = _gd_fernet.decrypt(old["refresh_token_enc"].encode()).decode()
            else:
                return await _try_exchange_and_page(False, "Refresh token mancante",
                                                    "Revoca l'accesso in Google e riprova")
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
            "app_return": s.get("app_return") or {},  # V50.z154 — per i re-hit senza state
        }
        await db.google_drive_connections.update_one(
            {"user_id": s["user_id"]}, {"$set": doc, "$setOnInsert": {"created_at": utcnow()}}, upsert=True
        )
        _schedule_drive_reindex(s["user_id"], reason="oauth-connected")  # V50.z155
        return await _try_exchange_and_page(True, "Google Drive collegato",
                                            f"Account: {google_email}" if google_email else "")
    except Exception as e:
        return await _try_exchange_and_page(False, "Errore durante il collegamento", str(e))


# =========================
