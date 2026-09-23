# axon_email.py — V50.z336 — Sistema email AdvisorOS su Resend (dominio advisoros.it) con 3 caselle mittente.
#
#   SENDER_INFO      info@advisoros.it     → modulo contatti/demo della landing + richieste generali
#   SENDER_HELP      help@advisoros.it     → supporto (ticket Help Center, FAQ), PIN reset, avvisi documenti
#   SENDER_EMANUELE  emanuele@advisoros.it → notifiche interne al Master (nuovi lead, iscrizioni, ticket)
#
# Catena di invio: Resend (RESEND_API_KEY proprio, dominio verificato) → Emergent managed Resend (EMERGENT_EMAIL_KEY)
# → SMTP del tenant (db.smtp_configs) se disponibile. Il fallback scatta SOLO se il provider primario non è
# configurato o rifiuta in modo esplicito (mai su timeout ambiguo → evita doppi invii).
# Ogni invio è tracciato in db.email_events (provider, sender, to, subject, status, error).
#
# Endpoint (Master/owner):
#   GET  /email/config            → stato configurazione (chiavi mascherate, mittenti, provider attivo, dominio)
#   POST /email/test              → invio di prova {kind, to}
#   GET  /email/events?limit=50   → ultimi invii
#
# Hook (chiamati dagli endpoint esistenti via globals().get(...) — il modulo carica dopo, ma i nomi sono risolti a runtime):
#   _email_on_demo_request(doc, owner)  · _email_on_support_ticket(user, ticket)  · _email_on_register(doc)
# Ridefinisce `_pl_send_resend` (axon_personal_lock) così PIN reset / avvisi documenti passano dal nuovo servizio (help@).

import resend as _resend_sdk

EMAIL_DOMAIN = "advisoros.it"
_EMAIL_PLACEHOLDER_MARKERS = ("placeholder", "your_", "xxx", "changeme", "re_xxxxxxxxx")


def _email_env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _email_is_placeholder(v: str) -> bool:
    if not v:
        return True
    low = v.lower()
    return any(m in low for m in _EMAIL_PLACEHOLDER_MARKERS)


EMAIL_SENDERS: Dict[str, Dict[str, str]] = {
    "info":   {"env": "SENDER_INFO",     "default": f"info@{EMAIL_DOMAIN}",     "name": "AdvisorOS",           "purpose": "Landing page · richieste generali"},
    "help":   {"env": "SENDER_HELP",     "default": f"help@{EMAIL_DOMAIN}",     "name": "AdvisorOS Supporto",  "purpose": "Supporto · FAQ · sicurezza account"},
    "master": {"env": "SENDER_EMANUELE", "default": f"emanuele@{EMAIL_DOMAIN}", "name": "AdvisorOS · Emanuele", "purpose": "Notifiche interne al Master"},
}


def _email_sender_address(kind: str) -> str:
    meta = EMAIL_SENDERS.get(kind) or EMAIL_SENDERS["info"]
    v = _email_env(meta["env"])
    return meta["default"] if _email_is_placeholder(v) else v


def _email_sender_from(kind: str) -> str:
    meta = EMAIL_SENDERS.get(kind) or EMAIL_SENDERS["info"]
    return formataddr((meta["name"], _email_sender_address(kind)))


def _email_master_recipient() -> str:
    """Casella che riceve le notifiche interne (default: emanuele@)."""
    v = _email_env("MASTER_NOTIFY_EMAIL")
    return v if not _email_is_placeholder(v) else _email_sender_address("master")


def _email_resend_key() -> str:
    k = _email_env("RESEND_API_KEY")
    return "" if _email_is_placeholder(k) else k


def _email_provider_mode() -> str:
    if _email_resend_key():
        return "resend"
    if EMAIL_KEY:
        return "emergent"
    return "smtp_only"


def _email_html_to_text(html: str) -> str:
    txt = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    txt = re.sub(r"</p\s*>", "\n\n", txt, flags=re.I)
    txt = re.sub(r"<[^>]+>", "", txt)
    return html_lib.unescape(re.sub(r"\n{3,}", "\n\n", txt)).strip()


def _email_wrap_html(title: str, body_html: str, kind: str) -> str:
    """Template minimale dark/premium coerente con il brand (inline CSS, safe per i client mail)."""
    footer = _email_sender_address(kind)
    return f"""<!doctype html><html><body style="margin:0;background:#0B1626;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#F4F7FB">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
  <div style="font-size:20px;font-weight:800;letter-spacing:-0.4px;margin-bottom:18px">Advisor<span style="color:#F97316">OS</span></div>
  <div style="background:#101E33;border:1px solid #22334C;border-radius:16px;padding:22px">
    <h1 style="font-size:18px;margin:0 0 12px 0;color:#F4F7FB">{html_lib.escape(title)}</h1>
    <div style="font-size:14.5px;line-height:1.55;color:#CBD5E1">{body_html}</div>
  </div>
  <p style="font-size:11.5px;color:#7F8FA4;margin-top:16px">Questa email è stata inviata da {html_lib.escape(footer)} · AdvisorOS — {EMAIL_DOMAIN}</p>
</div></body></html>"""


def _email_send_resend_sync(kind: str, to: str, subject: str, html: str, text: str, reply_to: Optional[str]) -> str:
    _resend_sdk.api_key = _email_resend_key()
    params: Dict[str, Any] = {"from": _email_sender_from(kind), "to": [to], "subject": subject, "html": html, "text": text}
    if reply_to:
        params["reply_to"] = reply_to
    res = _resend_sdk.Emails.send(params)  # type: ignore[arg-type]
    return (res or {}).get("id") or "sent"


async def axon_send_email(kind: str, to: str, subject: str, html: str, *, text: Optional[str] = None,
                          reply_to: Optional[str] = None, tid: Optional[str] = None, tag: str = "generic") -> Dict[str, Any]:
    """Invio unificato. Ritorna {provider, message_id, ok}. Solleva se nessun canale riesce."""
    kind = kind if kind in EMAIL_SENDERS else "info"
    to = (to or "").strip()
    if not to or "@" not in to:
        raise ValueError("Destinatario non valido")
    text = text or _email_html_to_text(html)
    event: Dict[str, Any] = {"event_id": f"em_{uuid.uuid4().hex[:12]}", "kind": kind, "sender": _email_sender_address(kind), "to": to,
                             "subject": subject[:200], "tag": tag, "tenant_id": tid, "created_at": utcnow(), "status": "pending", "provider": None, "error": None}
    log = logging.getLogger("axon_email")
    errors: List[str] = []
    # 1) Resend con chiave propria
    if _email_resend_key():
        try:
            mid = await asyncio.get_event_loop().run_in_executor(None, _email_send_resend_sync, kind, to, subject, html, text, reply_to)
            event.update(status="sent", provider="resend", message_id=mid)
            await db.email_events.insert_one(dict(event))
            return {"ok": True, "provider": "resend", "message_id": mid}
        except Exception as e:  # noqa: BLE001
            msg = str(e)[:200]
            errors.append(f"resend: {msg}")
            log.warning("Resend (chiave propria) fallito: %s", msg)
            if "timeout" in msg.lower() or "timed out" in msg.lower():
                event.update(status="unknown", provider="resend", error=msg)
                await db.email_events.insert_one(dict(event))
                raise RuntimeError("Timeout provider email (nessun retry per evitare doppi invii)")
    # 2) Emergent managed Resend (mittente gestito; from_name = casella scelta)
    if EMAIL_KEY:
        try:
            _assert_safe_email(subject, html)
            payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_SENDERS[kind]["name"], "contact_email": reply_to or _email_sender_address(kind)}
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
            resp.raise_for_status()
            mid = resp.json().get("id") or "sent"
            event.update(status="sent", provider="emergent", message_id=mid)
            await db.email_events.insert_one(dict(event))
            return {"ok": True, "provider": "emergent", "message_id": mid}
        except Exception as e:  # noqa: BLE001
            errors.append(f"emergent: {str(e)[:200]}")
            log.warning("Emergent email fallito: %s", str(e)[:200])
    # 3) SMTP del tenant
    if tid:
        cfg = await db.smtp_configs.find_one({"user_id": tid}, {"_id": 0})
        if cfg and cfg.get("host") and cfg.get("username"):
            try:
                await asyncio.get_event_loop().run_in_executor(None, _send_smtp_email, cfg, to, subject, text, html)
                event.update(status="sent", provider="smtp")
                await db.email_events.insert_one(dict(event))
                return {"ok": True, "provider": "smtp", "message_id": None}
            except Exception as e:  # noqa: BLE001
                errors.append(f"smtp: {str(e)[:200]}")
    event.update(status="failed", error=" | ".join(errors)[:600] or "nessun provider configurato")
    await db.email_events.insert_one(dict(event))
    raise RuntimeError(event["error"])


async def notify_master(subject: str, body_html: str, *, tag: str = "master") -> Optional[Dict[str, Any]]:
    """Notifica interna al Master (emanuele@). Non solleva mai: le notifiche non devono rompere il flusso principale."""
    try:
        return await axon_send_email("master", _email_master_recipient(), subject, _email_wrap_html(subject, body_html, "master"), tag=tag)
    except Exception as e:  # noqa: BLE001
        logging.getLogger("axon_email").warning("notify_master fallita: %s", str(e)[:200])
        return None


# ─── Ridefinizione: PIN reset / avvisi documenti (axon_personal_lock) → casella help@ ────────────────────────────
async def _pl_send_resend(*, to: str, subject: str, html: str) -> str:  # noqa: F811 — sostituisce la versione di axon_personal_lock
    _assert_safe_email(subject, html)
    r = await axon_send_email("help", to, subject, html, tag="security")
    return r.get("message_id") or "sent"


# ─── Hook chiamati dagli endpoint esistenti ─────────────────────────────────────────────────────────────────────
async def _email_on_demo_request(doc: dict, owner: dict) -> None:
    """Landing: conferma al lead da info@ (se ha lasciato l'email) + notifica interna al Master."""
    name = html_lib.escape(doc.get("full_name") or "")
    company = html_lib.escape(doc.get("company") or "")
    if doc.get("email"):
        body = (f"<p>Ciao {name},</p><p>grazie per l'interesse verso <b>AdvisorOS</b>. Abbiamo ricevuto la tua richiesta di demo"
                f"{' per <b>' + company + '</b>' if company else ''}: ti ricontatteremo a breve per fissare un appuntamento.</p>"
                f"<p>Nel frattempo puoi rispondere a questa email per qualsiasi domanda.</p><p>Il team AdvisorOS</p>")
        try:
            await axon_send_email("info", doc["email"], "Abbiamo ricevuto la tua richiesta di demo · AdvisorOS",
                                  _email_wrap_html("Richiesta demo ricevuta", body, "info"), reply_to=_email_sender_address("info"), tag="lead_confirm")
        except Exception as e:  # noqa: BLE001
            logging.getLogger("axon_email").warning("conferma lead fallita: %s", str(e)[:200])
    contact = html_lib.escape(doc.get("phone") or "") + (f" · {html_lib.escape(doc['email'])}" if doc.get("email") else "")
    await notify_master(f"🆕 Richiesta demo: {doc.get('full_name')} ({doc.get('company')})",
                        f"<p><b>Nome:</b> {name}<br><b>Azienda:</b> {company}<br><b>Contatto:</b> {contact}</p>"
                        f"<p>Fonte: landing page · Lead ID {html_lib.escape(doc.get('lead_id') or '')}</p>", tag="lead_demo")


async def _email_on_support_ticket(user: dict, ticket: dict) -> None:
    """Help Center: ricevuta al cliente da help@ + copia del ticket a help@."""
    first_msg = ((ticket.get("messages") or [{}])[0].get("text") or "")[:1500]
    uname = html_lib.escape(user.get("name") or user.get("email") or "")
    if user.get("email"):
        body = (f"<p>Ciao {uname},</p><p>abbiamo ricevuto la tua richiesta di supporto (ticket <b>{html_lib.escape(ticket.get('ticket_id') or '')}</b>). "
                f"Axon ti ha già dato una prima risposta nell'Help Center; se non risolve, il team ti ricontatterà da questa casella.</p>"
                f"<blockquote style='border-left:3px solid #38BDF8;margin:12px 0;padding:6px 12px;color:#94A3B8'>{html_lib.escape(first_msg)}</blockquote>")
        try:
            await axon_send_email("help", user["email"], f"Ticket {ticket.get('ticket_id')} ricevuto · Supporto AdvisorOS",
                                  _email_wrap_html("Richiesta di supporto ricevuta", body, "help"), reply_to=_email_sender_address("help"), tid=user.get("user_id"), tag="support_ack")
        except Exception as e:  # noqa: BLE001
            logging.getLogger("axon_email").warning("ack supporto fallito: %s", str(e)[:200])
    try:
        await axon_send_email("help", _email_sender_address("help"), f"[Ticket {ticket.get('ticket_id')}] {uname}",
                              _email_wrap_html("Nuovo ticket Help Center", f"<p><b>Utente:</b> {uname} ({html_lib.escape(user.get('email') or '')})</p><p>{html_lib.escape(first_msg)}</p>", "help"),
                              reply_to=user.get("email"), tag="support_inbox")
    except Exception as e:  # noqa: BLE001
        logging.getLogger("axon_email").warning("copia ticket a help@ fallita: %s", str(e)[:200])


async def _email_on_register(doc: dict) -> None:
    """Nuova iscrizione (prova 14 gg) → notifica interna al Master."""
    await notify_master(f"👤 Nuovo iscritto in prova: {doc.get('name') or doc.get('email')}",
                        f"<p><b>Nome:</b> {html_lib.escape(doc.get('name') or '')}<br><b>Email:</b> {html_lib.escape(doc.get('email') or '')}<br>"
                        f"<b>Prodotto:</b> {html_lib.escape(doc.get('product') or 'advisor')}<br><b>Fine prova:</b> {doc.get('trial_expires_at').strftime('%d/%m/%Y') if doc.get('trial_expires_at') else '—'}</p>",
                        tag="register")


# ─── Endpoint Master ────────────────────────────────────────────────────────────────────────────────────────────
class EmailTestIn(BaseModel):
    kind: Literal["info", "help", "master"] = "info"
    to: EmailStr


def _email_mask(v: str) -> str:
    if not v:
        return ""
    return v[:4] + "…" + v[-3:] if len(v) > 10 else "•••"


@api_router.get("/email/config")
async def email_config(user=Depends(get_current_user)):
    _require_super_master(user)
    resend_key = _email_env("RESEND_API_KEY")
    senders = []
    for kind, meta in EMAIL_SENDERS.items():
        raw = _email_env(meta["env"])
        senders.append({"kind": kind, "env": meta["env"], "address": _email_sender_address(kind), "display_name": meta["name"],
                        "purpose": meta["purpose"], "configured": not _email_is_placeholder(raw), "using_default": _email_is_placeholder(raw)})
    return {
        "domain": EMAIL_DOMAIN,
        "provider": _email_provider_mode(),
        "resend_key_configured": bool(_email_resend_key()),
        "resend_key_masked": _email_mask(resend_key) if _email_resend_key() else "",
        "emergent_fallback": bool(EMAIL_KEY),
        "master_notify_email": _email_master_recipient(),
        "senders": senders,
        "dns_hint": ("Su Resend → Domains → Add Domain «advisoros.it», poi copia su Aruba i record DKIM (TXT resend._domainkey), "
                     "SPF (TXT/CNAME) e MX return-path esattamente come mostrati; verifica e aggiungi _dmarc."),
    }


@api_router.post("/email/test")
async def email_test(body: EmailTestIn, user=Depends(get_current_user)):
    _require_super_master(user)
    html = _email_wrap_html("Email di prova", f"<p>Questa è un'email di prova inviata dalla casella <b>{html_lib.escape(_email_sender_address(body.kind))}</b> "
                            f"tramite il provider <b>{_email_provider_mode()}</b>.</p><p>Se la leggi, la configurazione funziona. ✅</p>", body.kind)
    try:
        r = await axon_send_email(body.kind, str(body.to), f"Test email {body.kind}@ · AdvisorOS", html, tid=user["user_id"], tag="test")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Invio non riuscito: {str(e)[:300]}")
    return r


@api_router.get("/email/events")
async def email_events(limit: int = 50, user=Depends(get_current_user)):
    _require_super_master(user)
    cur = db.email_events.find({}, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 200)))
    items = await cur.to_list(length=200)
    for it in items:
        if isinstance(it.get("created_at"), datetime):
            it["created_at"] = it["created_at"].isoformat()
    return {"items": items}
