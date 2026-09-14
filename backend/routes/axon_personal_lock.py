# axon_personal_lock.py — V50.z237 — PIN a 6 cifre (+ biometria lato client) per «Spazio Personale».
# PIN salvato server-side (bcrypt) nel doc utente → vale su tutti i dispositivi. Rate limit tentativi.
# «Ho dimenticato il PIN»: codice 6 cifre via email (Emergent Resend → fallback SMTP del tenant), valido 15 min, monouso.
import ipaddress as _pl_ipaddress
from html import escape as _pl_escape
from html.parser import HTMLParser as _PL_HTMLParser
from urllib.parse import urlparse as _pl_urlparse

# Emergent managed email proxy — COSTANTE (mai da env: sopravvive al deploy)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "AdvisorOS")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

_PL_MAX_ATTEMPTS = 5
_PL_LOCK_MINUTES = 10
_PL_CODE_TTL_MIN = 15

# ---- Guardrail gate (G2/G3) — copiato dal playbook, chiamato su OGNI invio ----
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        _pl_ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(_PL_HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = _pl_urlparse(low).hostname or ""
        if not _host_ok(host) or _pl_urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = _pl_urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


async def _pl_send_resend(*, to: str, subject: str, html: str) -> str:
    _assert_safe_email(subject, html)
    if not EMAIL_KEY:
        raise RuntimeError("EMERGENT_EMAIL_KEY mancante")
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
    resp.raise_for_status()
    return resp.json().get("id") or "sent"


async def _pl_send_email(tid: str, *, to: str, subject: str, html: str, text: str) -> str:
    """Resend (Emergent) → fallback SMTP del tenant. Ritorna il canale usato."""
    try:
        await _pl_send_resend(to=to, subject=subject, html=html)
        return "resend"
    except Exception as e:
        logging.getLogger("personal_lock").warning("Resend fallito (%s) → provo SMTP tenant", str(e)[:120])
    cfg = await db.smtp_configs.find_one({"user_id": tid}, {"_id": 0})
    if not cfg or not cfg.get("host") or not cfg.get("username"):
        raise HTTPException(status_code=502, detail="Invio email non riuscito e nessun SMTP configurato. Configura l'SMTP in Impostazioni oppure riprova più tardi.")
    _assert_safe_email(subject, html)
    await asyncio.get_event_loop().run_in_executor(None, _send_smtp_email, cfg, to, subject, text, html)
    return "smtp"


# ---- Modelli ----
class PersonalPinIn(BaseModel):
    pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class PersonalPinChangeIn(BaseModel):
    current_pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class PersonalPinResetIn(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_pin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


def _pl_weak(pin: str) -> bool:
    if len(set(pin)) == 1:
        return True
    return pin in ("123456", "654321", "012345", "543210")


async def _pl_user(user: dict) -> dict:
    return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "personal_lock": 1, "email": 1, "name": 1}) or {}


def _pl_status_out(u: dict) -> dict:
    lock = u.get("personal_lock") or {}
    until = lock.get("locked_until")
    locked_for = 0
    if isinstance(until, datetime):
        u_aware = until if until.tzinfo else until.replace(tzinfo=timezone.utc)
        locked_for = max(0, int((u_aware - utcnow()).total_seconds()))
    return {
        "configured": bool(lock.get("pin_hash")),
        "attempts_left": max(0, _PL_MAX_ATTEMPTS - int(lock.get("failed", 0))),
        "locked_for_seconds": locked_for,
        "email": u.get("email"),
        "updated_at": lock["updated_at"].isoformat() if isinstance(lock.get("updated_at"), datetime) else None,
    }


@api_router.get("/personal-space/lock/status")
async def personal_lock_status(user=Depends(get_current_user)):
    return _pl_status_out(await _pl_user(user))


@api_router.post("/personal-space/lock/set")
async def personal_lock_set(body: PersonalPinIn, user=Depends(get_current_user)):
    """Primo accesso: imposta il PIN (solo se non ancora configurato)."""
    u = await _pl_user(user)
    if (u.get("personal_lock") or {}).get("pin_hash"):
        raise HTTPException(status_code=409, detail="PIN già impostato: usa «Cambia PIN» o «Ho dimenticato il PIN»")
    if _pl_weak(body.pin):
        raise HTTPException(status_code=400, detail="PIN troppo semplice: evita cifre tutte uguali o sequenze")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"personal_lock": {
        "pin_hash": hash_password(body.pin), "failed": 0, "locked_until": None, "updated_at": utcnow()}}})
    return {"ok": True, **_pl_status_out(await _pl_user(user))}


async def _pl_check(user: dict, pin: str) -> dict:
    u = await _pl_user(user)
    lock = u.get("personal_lock") or {}
    if not lock.get("pin_hash"):
        raise HTTPException(status_code=404, detail="PIN non configurato")
    st = _pl_status_out(u)
    if st["locked_for_seconds"] > 0:
        raise HTTPException(status_code=423, detail=f"Troppi tentativi. Riprova tra {max(1, st['locked_for_seconds'] // 60)} min o usa «Ho dimenticato il PIN».")
    if verify_password(pin, lock["pin_hash"]):
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"personal_lock.failed": 0, "personal_lock.locked_until": None}})
        return {"ok": True, "attempts_left": _PL_MAX_ATTEMPTS}
    failed = int(lock.get("failed", 0)) + 1
    upd: Dict[str, Any] = {"personal_lock.failed": failed}
    if failed >= _PL_MAX_ATTEMPTS:
        upd["personal_lock.locked_until"] = utcnow() + timedelta(minutes=_PL_LOCK_MINUTES)
        upd["personal_lock.failed"] = 0
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": upd})
    left = max(0, _PL_MAX_ATTEMPTS - failed)
    return {"ok": False, "attempts_left": left, "locked_for_seconds": _PL_LOCK_MINUTES * 60 if failed >= _PL_MAX_ATTEMPTS else 0}


@api_router.post("/personal-space/lock/verify")
async def personal_lock_verify(body: PersonalPinIn, user=Depends(get_current_user)):
    return await _pl_check(user, body.pin)


@api_router.post("/personal-space/lock/change")
async def personal_lock_change(body: PersonalPinChangeIn, user=Depends(get_current_user)):
    r = await _pl_check(user, body.current_pin)
    if not r.get("ok"):
        raise HTTPException(status_code=401, detail="PIN attuale non corretto")
    if _pl_weak(body.new_pin):
        raise HTTPException(status_code=400, detail="PIN troppo semplice: evita cifre tutte uguali o sequenze")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {
        "personal_lock.pin_hash": hash_password(body.new_pin), "personal_lock.failed": 0,
        "personal_lock.locked_until": None, "personal_lock.updated_at": utcnow()}})
    return {"ok": True}


def _pl_mask_email(e: str) -> str:
    if not e or "@" not in e:
        return e or ""
    local, dom = e.split("@", 1)
    return (local[:2] + "•••" if len(local) > 2 else local[:1] + "•••") + "@" + dom


@api_router.post("/personal-space/lock/forgot")
async def personal_lock_forgot(user=Depends(get_current_user)):
    """Invia all'email dell'account un codice a 6 cifre (15 min, monouso) per impostare un nuovo PIN."""
    u = await _pl_user(user)
    lock = u.get("personal_lock") or {}
    if not lock.get("pin_hash"):
        raise HTTPException(status_code=404, detail="PIN non configurato")
    last = lock.get("reset_sent_at")
    if isinstance(last, datetime):
        last_aware = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
        if (utcnow() - last_aware).total_seconds() < 60:
            raise HTTPException(status_code=429, detail="Email già inviata: attendi un minuto prima di richiederne un'altra")
    to = (u.get("email") or "").strip().lower()
    if not to:
        raise HTTPException(status_code=400, detail="Nessuna email associata all'account")
    code = f"{secrets.randbelow(1_000_000):06d}"
    name = _pl_escape((u.get("name") or "").strip() or to.split("@")[0])
    brand = _pl_escape(EMAIL_FROM_NAME)
    subject = f"{EMAIL_FROM_NAME} — codice per reimpostare il PIN dello Spazio Personale"
    html = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1B2B4B">'
        f'<p style="font-size:16px;margin:0 0 12px">Ciao {name},</p>'
        '<p style="font-size:14px;line-height:20px;margin:0 0 16px">hai chiesto di reimpostare il PIN del tuo <strong>Spazio Personale</strong>. '
        f'Inserisci questo codice nell\'app {brand} per scegliere un nuovo PIN:</p>'
        f'<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:0 0 16px;color:#FF6B35">{code}</p>'
        f'<p style="font-size:13px;line-height:19px;margin:0 0 8px">Il codice vale <strong>{_PL_CODE_TTL_MIN} minuti</strong> e può essere usato una sola volta. '
        'Se non hai fatto tu questa richiesta, ignora questa email: il tuo PIN attuale resta valido.</p>'
        f'<p style="font-size:12px;color:#888;margin:16px 0 0">Inviato da {brand}. Non ti chiederemo mai la password o il PIN via email.</p>'
        '</td></tr></table>'
    )
    text = (f"Ciao {name},\n\nhai chiesto di reimpostare il PIN del tuo Spazio Personale. Inserisci questo codice nell'app {EMAIL_FROM_NAME}: {code}\n\n"
            f"Il codice vale {_PL_CODE_TTL_MIN} minuti e può essere usato una sola volta. Se non hai fatto tu questa richiesta, ignora questa email.\n\n{EMAIL_FROM_NAME}")
    channel = await _pl_send_email(tenant_id(user), to=to, subject=subject, html=html, text=text)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {
        "personal_lock.reset_code_hash": hash_password(code),
        "personal_lock.reset_expires_at": utcnow() + timedelta(minutes=_PL_CODE_TTL_MIN),
        "personal_lock.reset_sent_at": utcnow(),
        "personal_lock.reset_attempts": 0,
    }})
    return {"ok": True, "sent_to": _pl_mask_email(to), "channel": channel, "expires_in_minutes": _PL_CODE_TTL_MIN}


@api_router.post("/personal-space/lock/reset")
async def personal_lock_reset(body: PersonalPinResetIn, user=Depends(get_current_user)):
    u = await _pl_user(user)
    lock = u.get("personal_lock") or {}
    h = lock.get("reset_code_hash")
    exp = lock.get("reset_expires_at")
    if not h or not isinstance(exp, datetime):
        raise HTTPException(status_code=400, detail="Nessuna richiesta di reset attiva: usa «Ho dimenticato il PIN»")
    exp_aware = exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)
    if utcnow() > exp_aware:
        raise HTTPException(status_code=410, detail="Codice scaduto: richiedine uno nuovo")
    if int(lock.get("reset_attempts", 0)) >= _PL_MAX_ATTEMPTS:
        await db.users.update_one({"user_id": user["user_id"]}, {"$unset": {"personal_lock.reset_code_hash": "", "personal_lock.reset_expires_at": ""}})
        raise HTTPException(status_code=429, detail="Troppi tentativi: richiedi un nuovo codice")
    if not verify_password(body.code, h):
        await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"personal_lock.reset_attempts": 1}})
        raise HTTPException(status_code=401, detail="Codice non corretto")
    if _pl_weak(body.new_pin):
        raise HTTPException(status_code=400, detail="PIN troppo semplice: evita cifre tutte uguali o sequenze")
    await db.users.update_one({"user_id": user["user_id"]}, {
        "$set": {"personal_lock.pin_hash": hash_password(body.new_pin), "personal_lock.failed": 0,
                 "personal_lock.locked_until": None, "personal_lock.updated_at": utcnow()},
        "$unset": {"personal_lock.reset_code_hash": "", "personal_lock.reset_expires_at": "", "personal_lock.reset_attempts": ""},
    })
    return {"ok": True}
