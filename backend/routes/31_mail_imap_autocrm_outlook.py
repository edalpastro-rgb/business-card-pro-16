# 31_mail_imap_autocrm_outlook.py — Mail IMAP universale, Auto-CRM da mail, Outlook OAuth
# Estratto da server.py (righe originali 21604-22811). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V50.z21 — MAIL UNIVERSALE IMAP (Aruba, Gmail, Outlook, Register, Libero, …)
#
# L'utente registra la propria casella mail con host IMAP + user + password.
# La password viene cifrata (Fernet, stessa chiave di Outlook OAuth).
# Backend legge INBOX via IMAPS e serve messaggi + allegati.
# =========================================================================
from imap_tools import MailBox, AND
# V50.z21c — Init Fernet DIRETTAMENTE (la sezione Outlook è più in basso nel
# file, quindi _outlook_fernet non era ancora definito qui → _MAIL_FERNET
# risultava sempre None e ogni tentativo di salvare una casella dava
# "Cifratura non configurata").
try:
    from cryptography.fernet import Fernet as _FernetMail
    _MAIL_ENC_KEY_STR = os.environ.get("OUTLOOK_TOKEN_ENC_KEY", "")
    if _MAIL_ENC_KEY_STR:
        _MAIL_FERNET = _FernetMail(_MAIL_ENC_KEY_STR.encode())
    else:
        _MAIL_FERNET = None
except Exception as _e_mail:
    logger.error(f"[Mail] Fernet init failed: {_e_mail}")
    _MAIL_FERNET = None


# Preset provider comuni (host IMAPS standard su porta 993)
_MAIL_PRESETS = {
    "aruba": {"label": "Aruba", "host": "imaps.aruba.it", "port": 993, "ssl": True},
    "gmail": {"label": "Gmail", "host": "imap.gmail.com", "port": 993, "ssl": True, "note": "Richiede App Password (Google → Sicurezza → Password per le app)"},
    "outlook": {"label": "Outlook.com / Hotmail", "host": "imap-mail.outlook.com", "port": 993, "ssl": True},
    "office365": {"label": "Microsoft 365 (aziendale)", "host": "outlook.office365.com", "port": 993, "ssl": True, "note": "Richiede che l'admin abiliti IMAP legacy nel tenant"},
    "register": {"label": "Register.it", "host": "imaps.register.it", "port": 993, "ssl": True},
    "libero": {"label": "Libero.it", "host": "imapmail.libero.it", "port": 993, "ssl": True},
    "yahoo": {"label": "Yahoo Mail", "host": "imap.mail.yahoo.com", "port": 993, "ssl": True, "note": "Richiede App Password"},
    "ionos": {"label": "IONOS", "host": "imap.ionos.it", "port": 993, "ssl": True},
    "custom": {"label": "Altro (configurazione manuale)", "host": "", "port": 993, "ssl": True},
}


def _mail_enc(s: str) -> str:
    if not _MAIL_FERNET:
        raise HTTPException(500, "Cifratura non configurata (OUTLOOK_TOKEN_ENC_KEY manca)")
    return _MAIL_FERNET.encrypt(s.encode()).decode()


def _mail_dec(s: str) -> str:
    return _MAIL_FERNET.decrypt(s.encode()).decode()


# V50.z42 — Master Profile & Password Vault (isolamento per-utente)
@api_router.get("/master/profile")
async def master_profile_get(user=Depends(get_current_user)):
    p = await db.master_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not p:
        p = {"user_id": user["user_id"], "tenant_id": tenant_id(user),
             "first_name": "", "last_name": "", "phone": "", "address": "",
             "iban": "", "tax_id": "", "vat_id": "", "notes": "", "credentials": []}
    creds_out = []
    for c in (p.get("credentials") or []):
        creds_out.append({
            "cred_id": c.get("cred_id"), "service": c.get("service"),
            "username": c.get("username"), "url": c.get("url"),
            "notes": c.get("notes"), "password_masked": bool(c.get("password_enc")),
        })
    p["credentials"] = creds_out
    return p


@api_router.put("/master/profile")
async def master_profile_update(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    updates: Dict[str, Any] = {}
    for k in ["first_name", "last_name", "phone", "address", "iban", "tax_id", "vat_id", "notes"]:
        if k in payload:
            updates[k] = str(payload.get(k) or "").strip()
    updates["updated_at"] = datetime.utcnow()
    await db.master_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$set": {**updates, "user_id": user["user_id"], "tenant_id": tenant_id(user)}},
        upsert=True,
    )
    return await master_profile_get(user)


@api_router.post("/master/profile/credentials")
async def master_profile_add_credential(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    service = (payload.get("service") or "").strip()
    username = (payload.get("username") or "").strip()
    password = (payload.get("password") or "").strip()
    url = (payload.get("url") or "").strip()
    notes = (payload.get("notes") or "").strip()
    if not service or not password:
        raise HTTPException(400, "service e password sono obbligatori")
    cred = {
        "cred_id": f"cr_{uuid.uuid4().hex[:12]}",
        "service": service, "username": username, "url": url, "notes": notes,
        "password_enc": _mail_enc(password), "created_at": datetime.utcnow(),
    }
    await db.master_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$push": {"credentials": cred},
         "$setOnInsert": {"tenant_id": tenant_id(user), "user_id": user["user_id"]}},
        upsert=True,
    )
    return {"ok": True, "cred_id": cred["cred_id"]}


@api_router.get("/master/profile/credentials/{cred_id}/reveal")
async def master_profile_reveal_credential(cred_id: str, user=Depends(get_current_user)):
    p = await db.master_profiles.find_one(
        {"user_id": user["user_id"], "credentials.cred_id": cred_id},
        {"_id": 0, "credentials.$": 1},
    )
    if not p or not p.get("credentials"):
        raise HTTPException(404, "Credenziale non trovata")
    try:
        return {"password": _mail_dec(p["credentials"][0]["password_enc"])}
    except Exception:
        raise HTTPException(500, "Impossibile decifrare la password")


@api_router.delete("/master/profile/credentials/{cred_id}")
async def master_profile_delete_credential(cred_id: str, user=Depends(get_current_user)):
    r = await db.master_profiles.update_one(
        {"user_id": user["user_id"]},
        {"$pull": {"credentials": {"cred_id": cred_id}}},
    )
    if r.modified_count == 0:
        raise HTTPException(404, "Credenziale non trovata")
    return {"ok": True}




def _mail_account_serialize(a: dict) -> dict:
    return {
        "account_id": a.get("account_id"),
        "email": a.get("email"),
        "label": a.get("label"),
        "provider": a.get("provider"),
        "imap_host": a.get("imap_host"),
        "imap_port": a.get("imap_port"),
        "imap_ssl": a.get("imap_ssl", True),
        "connected_at": a.get("connected_at").isoformat() if a.get("connected_at") else None,
        "last_check_at": a.get("last_check_at").isoformat() if a.get("last_check_at") else None,
        "last_error": a.get("last_error"),
    }


def _imap_test_and_login_sync(host: str, port: int, ssl: bool, user_email: str, password: str):
    """Sync helper eseguito in un executor. Ritorna un contesto MailBox già loggato."""
    if ssl:
        mb = MailBox(host, port=port).login(user_email, password, initial_folder="INBOX")
    else:
        mb = MailBox(host, port=port, ssl=False).login(user_email, password, initial_folder="INBOX")
    return mb


@api_router.get("/mail/presets")
async def mail_presets_list(user=Depends(get_current_user)):
    """Elenco provider preimpostati (host/porta già settati)."""
    return {"presets": [
        {"id": k, **v} for k, v in _MAIL_PRESETS.items()
    ]}


@api_router.get("/mail/accounts")
async def mail_accounts_list(user=Depends(get_current_user)):
    """Elenca le caselle mail collegate dall'utente."""
    cur = db.mail_accounts.find({"user_id": user["user_id"]}).sort("connected_at", -1)
    items = [_mail_account_serialize(a) async for a in cur]
    return {"items": items}


@api_router.post("/mail/accounts")
async def mail_accounts_add(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Aggiunge una casella mail. Testa la connessione IMAP prima di salvare."""
    if not _MAIL_FERNET:
        raise HTTPException(500, "Cifratura non configurata")
    email_addr = (payload.get("email") or "").strip()
    password = payload.get("password") or ""
    provider = (payload.get("provider") or "custom").lower()
    label = (payload.get("label") or "").strip() or email_addr
    host = (payload.get("imap_host") or "").strip()
    port = int(payload.get("imap_port") or 993)
    ssl_flag = bool(payload.get("imap_ssl", True))

    if not email_addr or "@" not in email_addr:
        raise HTTPException(400, "Email non valida")
    if not password:
        raise HTTPException(400, "Password mancante")

    # Se provider è un preset noto, usa i suoi valori
    if provider in _MAIL_PRESETS and provider != "custom":
        preset = _MAIL_PRESETS[provider]
        if not host:
            host = preset["host"]
        if not port:
            port = preset["port"]
        if "ssl" in preset:
            ssl_flag = preset["ssl"]

    if not host:
        raise HTTPException(400, "Host IMAP mancante")

    # Test connessione
    loop = asyncio.get_event_loop()
    try:
        def _try():
            mb = _imap_test_and_login_sync(host, port, ssl_flag, email_addr, password)
            mb.logout()
            return True
        await asyncio.wait_for(loop.run_in_executor(None, _try), timeout=15)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Timeout: server IMAP non raggiungibile")
    except Exception as e:
        raise HTTPException(400, f"Login IMAP fallito: {str(e)[:200]}")

    # Salva
    account_id = f"mail_{uuid.uuid4().hex[:12]}"
    doc = {
        "account_id": account_id,
        "user_id": user["user_id"],
        "tenant_id": tenant_id(user),
        "email": email_addr,
        "label": label,
        "provider": provider,
        "imap_host": host,
        "imap_port": port,
        "imap_ssl": ssl_flag,
        "password_enc": _mail_enc(password),
        "connected_at": datetime.utcnow(),
        "last_check_at": datetime.utcnow(),
        "last_error": None,
    }
    await db.mail_accounts.insert_one(doc)
    return _mail_account_serialize(doc)


@api_router.delete("/mail/accounts/{account_id}")
async def mail_accounts_delete(account_id: str, user=Depends(get_current_user)):
    r = await db.mail_accounts.delete_one({"account_id": account_id, "user_id": user["user_id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Casella non trovata")
    return {"deleted": True}


async def _mail_load_account(account_id: str, user_id: str) -> dict:
    a = await db.mail_accounts.find_one({"account_id": account_id, "user_id": user_id})
    if not a:
        raise HTTPException(404, "Casella non trovata")
    return a


@api_router.get("/mail/inbox")
async def mail_inbox_combined(
    unread_only: bool = True,
    per_account: int = 15,
    user=Depends(get_current_user),
):
    """V50.z21 — Vista UNIFICATA: legge le mail da TUTTE le caselle collegate
    dell'utente **in parallelo** e le restituisce ordinate per data desc.

    Utile per il collaboratore/Master che ha più caselle e vuole vedere
    tutto in un colpo senza dover selezionare account per account.
    """
    per_account = max(1, min(per_account, 50))
    accounts_cur = db.mail_accounts.find({"user_id": user["user_id"]})
    accounts = [a async for a in accounts_cur]
    if not accounts:
        return {"messages": [], "accounts_count": 0, "errors": []}

    loop = asyncio.get_event_loop()

    def _fetch_account(a: dict) -> Dict[str, Any]:
        try:
            password = _mail_dec(a["password_enc"])
            results = []
            with _imap_test_and_login_sync(
                a["imap_host"], a["imap_port"], a.get("imap_ssl", True), a["email"], password
            ) as mb:
                criteria = AND(seen=False) if unread_only else "ALL"
                fetched = list(mb.fetch(criteria, limit=per_account, reverse=True, mark_seen=False))
                for m in fetched:
                    atts = []
                    try:
                        for att in m.attachments:
                            atts.append({
                                "filename": att.filename or "allegato",
                                "content_type": att.content_type or "application/octet-stream",
                                "size": att.size or 0,
                            })
                    except Exception:
                        pass
                    preview = ""
                    try:
                        if m.text:
                            preview = (m.text or "").strip()[:400]
                        elif m.html:
                            preview = re.sub(r"<[^>]+>", " ", m.html or "").strip()[:400]
                    except Exception:
                        pass
                    results.append({
                        "account_id": a["account_id"],
                        "account_email": a["email"],
                        "account_label": a.get("label") or a["email"],
                        "uid": m.uid,
                        "subject": m.subject or "(senza oggetto)",
                        "from_name": (m.from_values.name if m.from_values else "") or "",
                        "from_email": (m.from_values.email if m.from_values else m.from_) or "",
                        "date": m.date.isoformat() if m.date else None,
                        "date_ts": m.date.timestamp() if m.date else 0,
                        "preview": preview,
                        "is_read": ("\\Seen" in (m.flags or [])),
                        "has_attachments": len(atts) > 0,
                        "attachments": atts,
                    })
            return {"account_id": a["account_id"], "ok": True, "messages": results}
        except Exception as e:
            return {"account_id": a["account_id"], "ok": False, "error": str(e)[:200], "account_email": a["email"]}

    tasks = [loop.run_in_executor(None, _fetch_account, a) for a in accounts]
    try:
        results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=60)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Timeout fetch multi-account")

    # Aggrega + salva errori per singolo account
    all_messages: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    now = datetime.utcnow()
    for r in results:
        if r.get("ok"):
            all_messages.extend(r.get("messages", []))
            await db.mail_accounts.update_one(
                {"account_id": r["account_id"]},
                {"$set": {"last_check_at": now, "last_error": None}},
            )
        else:
            errors.append({"account_id": r["account_id"], "email": r.get("account_email", ""), "error": r.get("error", "")})
            await db.mail_accounts.update_one(
                {"account_id": r["account_id"]},
                {"$set": {"last_check_at": now, "last_error": r.get("error", "")[:200]}},
            )

    all_messages.sort(key=lambda x: x.get("date_ts", 0), reverse=True)
    return {
        "messages": all_messages,
        "accounts_count": len(accounts),
        "success_count": len(accounts) - len(errors),
        "errors": errors,
    }


@api_router.get("/mail/accounts/{account_id}/messages")
async def mail_messages_list(
    account_id: str,
    unread_only: bool = True,
    limit: int = 30,
    user=Depends(get_current_user),
):
    """Elenca gli ultimi messaggi INBOX della casella."""
    a = await _mail_load_account(account_id, user["user_id"])
    password = _mail_dec(a["password_enc"])
    limit = max(1, min(limit, 100))

    loop = asyncio.get_event_loop()

    def _fetch():
        results = []
        with _imap_test_and_login_sync(a["imap_host"], a["imap_port"], a.get("imap_ssl", True), a["email"], password) as mb:
            criteria = AND(seen=False) if unread_only else "ALL"
            fetched = list(mb.fetch(criteria, limit=limit, reverse=True, bulk=True, mark_seen=False, headers_only=False))
            for m in fetched:
                atts = []
                try:
                    for att in m.attachments:
                        atts.append({
                            "filename": att.filename or "allegato",
                            "content_type": att.content_type or "application/octet-stream",
                            "size": att.size or 0,
                            # part_id sostituito da un identificativo posizionale
                            "part_id": att.part,
                        })
                except Exception:
                    pass
                # V50.z21 — Anteprima testo (max ~500 char)
                preview = ""
                try:
                    if m.text:
                        preview = (m.text or "").strip()[:500]
                    elif m.html:
                        preview = re.sub(r"<[^>]+>", " ", m.html or "").strip()[:500]
                except Exception:
                    pass
                results.append({
                    "uid": m.uid,
                    "subject": m.subject or "(senza oggetto)",
                    "from_name": (m.from_values.name if m.from_values else "") or "",
                    "from_email": (m.from_values.email if m.from_values else m.from_) or "",
                    "date": m.date.isoformat() if m.date else None,
                    "preview": preview,
                    "flags": list(m.flags or []),
                    "is_read": ("\\Seen" in (m.flags or [])),
                    "has_attachments": len(atts) > 0,
                    "attachments_count": len(atts),
                    "attachments": atts,
                })
        return results

    try:
        messages = await asyncio.wait_for(loop.run_in_executor(None, _fetch), timeout=30)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Timeout durante il download messaggi")
    except Exception as e:
        # Salva last_error
        try:
            await db.mail_accounts.update_one({"account_id": account_id},
                {"$set": {"last_error": str(e)[:300], "last_check_at": datetime.utcnow()}})
        except Exception:
            pass
        raise HTTPException(400, f"Errore lettura mail: {str(e)[:200]}")

    # OK: reset last_error, aggiorna last_check_at
    await db.mail_accounts.update_one({"account_id": account_id},
        {"$set": {"last_error": None, "last_check_at": datetime.utcnow()}})

    return {"messages": messages, "count": len(messages)}


@api_router.get("/mail/accounts/{account_id}/messages/{uid}/attachments/{filename}")
async def mail_download_attachment(
    account_id: str, uid: str, filename: str, user=Depends(get_current_user),
):
    """Scarica un allegato specifico di un messaggio dalla casella."""
    from fastapi.responses import Response as _Resp
    a = await _mail_load_account(account_id, user["user_id"])
    password = _mail_dec(a["password_enc"])

    loop = asyncio.get_event_loop()

    def _fetch_attachment():
        with _imap_test_and_login_sync(a["imap_host"], a["imap_port"], a.get("imap_ssl", True), a["email"], password) as mb:
            for m in mb.fetch(AND(uid=uid), limit=1, mark_seen=False):
                for att in m.attachments:
                    if (att.filename or "") == filename:
                        return {"payload": att.payload, "content_type": att.content_type or "application/octet-stream"}
        return None

    try:
        result = await asyncio.wait_for(loop.run_in_executor(None, _fetch_attachment), timeout=30)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Timeout durante il download allegato")
    except Exception as e:
        raise HTTPException(400, f"Errore: {str(e)[:200]}")

    if not result:
        raise HTTPException(404, "Allegato non trovato")

    return _Resp(
        content=result["payload"],
        media_type=result["content_type"],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/mail/accounts/{account_id}/messages/{uid}/body")
async def mail_get_message_body(
    account_id: str, uid: str, user=Depends(get_current_user),
):
    """V50.z65 — Recupera il corpo completo (testo + HTML) di un singolo
    messaggio dalla casella IMAP. Ritorna anche mittente/data/subject per
    la vista dettaglio."""
    a = await _mail_load_account(account_id, user["user_id"])
    password = _mail_dec(a["password_enc"])
    loop = asyncio.get_event_loop()

    def _fetch_body():
        with _imap_test_and_login_sync(a["imap_host"], a["imap_port"], a.get("imap_ssl", True), a["email"], password) as mb:
            for m in mb.fetch(AND(uid=uid), limit=1, mark_seen=True):
                return {
                    "uid": str(m.uid),
                    "subject": m.subject or "",
                    "from_name": (m.from_values.name if m.from_values else "") or "",
                    "from_email": (m.from_values.email if m.from_values else m.from_) or "",
                    "to": [str(x) for x in (m.to or [])],
                    "cc": [str(x) for x in (m.cc or [])],
                    "date": m.date.isoformat() if m.date else None,
                    "text": m.text or "",
                    "html": m.html or "",
                    "attachments": [{"filename": a.filename or "", "size": len(a.payload or b""), "content_type": a.content_type or ""} for a in (m.attachments or [])],
                }
        return None

    try:
        result = await asyncio.wait_for(loop.run_in_executor(None, _fetch_body), timeout=30)
    except asyncio.TimeoutError:
        raise HTTPException(504, "Timeout durante il caricamento del messaggio")
    except Exception as e:
        raise HTTPException(400, f"Errore: {str(e)[:200]}")

    if not result:
        raise HTTPException(404, "Messaggio non trovato")
    return result


# =========================================================================
# V50.z22 — AI AUTO-CRM DA MAIL
# Riconosce clienti CRM dal from_email, aggancia mail, salva allegati e
# usa LLM per estrarre dati dalla firma → propone aggiornamenti anagrafica.
# =========================================================================
async def _find_contact_by_email(user_id: str, email_addr: str) -> Optional[dict]:
    """Cerca contact per email (case-insensitive) nel tenant dell'utente."""
    tid = tenant_id({"user_id": user_id, "parent_user_id": None})  # semplice: user_id come tid
    e = email_addr.strip().lower()
    return await db.contacts.find_one({
        "$or": [
            {"user_id": tid, "email": {"$regex": f"^{re.escape(e)}$", "$options": "i"}},
        ]
    })


async def _extract_signature_llm(mail_text: str, from_name: str) -> Optional[dict]:
    """Usa Emergent LLM per estrarre nome/ruolo/telefono/CF/PIVA/indirizzo dalla firma."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        key = os.environ.get("EMERGENT_LLM_KEY") or ""
        if not key:
            return None
        prompt = f"""Estrai dalla FIRMA della seguente mail italiana i dati anagrafici. Rispondi SOLO in JSON con questi campi (usa null se non presenti):
{{"full_name": ..., "role": ..., "phone": ..., "mobile": ..., "codice_fiscale": ..., "partita_iva": ..., "address": ..., "city": ..., "website": ...}}

Mittente: {from_name}

TESTO MAIL:
{mail_text[:4000]}"""
        chat = LlmChat(api_key=key, session_id=f"crm-sig-{uuid.uuid4().hex[:8]}", system_message="Sei un estrattore di firme email. Rispondi solo in JSON valido.").with_model("openai", "gpt-5.4-mini")
        r = await chat.send_message(UserMessage(text=prompt))
        txt = (r or "").strip()
        # Rimuovi eventuale code fence
        if txt.startswith("```"):
            txt = re.sub(r"^```(?:json)?\n?|\n?```$", "", txt).strip()
        import json as _json
        data = _json.loads(txt)
        # Rimuovi valori null / stringhe vuote
        return {k: v for k, v in data.items() if v and str(v).strip() and str(v).lower() != "null"}
    except Exception as e:
        logger.warning(f"[auto-crm] LLM signature extract failed: {e}")
        return None


@api_router.post("/mail/auto-crm/scan")
async def mail_auto_crm_scan(payload: Dict[str, Any] = Body(default={}), user=Depends(get_current_user)):
    """Scansiona una casella (o tutte) per mail nuove da clienti CRM.
    - aggancia la mail al contact matched
    - salva allegati (base64 in `contact_mail_attachments`)
    - estrae dati firma via LLM → crea proposals in `mail_crm_proposals`
    - crea axon_alerts per gli aggiornamenti proposti
    Ritorna statistiche.
    """
    account_id = payload.get("account_id")  # None = scan all
    limit = int(payload.get("limit", 30))
    result = await _auto_crm_scan_impl(user["user_id"], tenant_id(user), account_id=account_id, limit=limit)
    if not result.get("ok") and result.get("error") == "no_accounts":
        raise HTTPException(404, "Nessuna casella collegata")
    return result


async def _auto_crm_scan_impl(user_id: str, tid: str, account_id: Optional[str] = None, limit: int = 30) -> Dict[str, Any]:
    """Core Auto-CRM scan — usato da endpoint manuale e scheduler."""
    q = {"user_id": user_id}
    if account_id:
        q["account_id"] = account_id
    accounts = [a async for a in db.mail_accounts.find(q)]
    if not accounts:
        return {"ok": False, "error": "no_accounts", "stats": {}, "accounts_scanned": 0}

    stats = {"scanned": 0, "clients_matched": 0, "attachments_saved": 0, "proposals_created": 0, "alerts": 0}
    loop = asyncio.get_event_loop()

    def _scan_one(a: dict) -> Dict[str, Any]:
        results = []
        try:
            password = _mail_dec(a["password_enc"])
            with _imap_test_and_login_sync(
                a["imap_host"], a["imap_port"], a.get("imap_ssl", True), a["email"], password
            ) as mb:
                fetched = list(mb.fetch("ALL", limit=limit, reverse=True, mark_seen=False))
                for m in fetched:
                    atts_data = []
                    try:
                        for att in m.attachments:
                            data = att.payload or b""
                            if len(data) > 8 * 1024 * 1024:  # skip >8MB
                                continue
                            import base64 as _b64
                            atts_data.append({
                                "filename": att.filename or "allegato",
                                "content_type": att.content_type or "application/octet-stream",
                                "size": len(data),
                                "b64": _b64.b64encode(data).decode(),
                            })
                    except Exception:
                        pass
                    results.append({
                        "uid": m.uid,
                        "subject": m.subject or "",
                        "from_email": ((m.from_values.email if m.from_values else m.from_) or "").lower(),
                        "from_name": (m.from_values.name if m.from_values else "") or "",
                        "date": m.date.isoformat() if m.date else None,
                        "text": (m.text or "") or (re.sub(r"<[^>]+>", " ", m.html or "") if m.html else ""),
                        "atts": atts_data,
                    })
            return {"account_id": a["account_id"], "messages": results, "ok": True}
        except Exception as e:
            return {"account_id": a["account_id"], "ok": False, "error": str(e)}

    tasks = [loop.run_in_executor(None, _scan_one, a) for a in accounts]
    fetch_results = await asyncio.gather(*tasks)

    for acc_res in fetch_results:
        if not acc_res.get("ok"):
            continue
        for m in acc_res["messages"]:
            stats["scanned"] += 1
            from_email = m["from_email"]
            if not from_email:
                continue
            contact = await _find_contact_by_email(user_id, from_email)
            if not contact:
                continue
            stats["clients_matched"] += 1
            cid = contact["contact_id"]
            # Aggancia mail (dedup per uid+account_id+contact_id)
            mail_link_key = {"contact_id": cid, "account_id": acc_res["account_id"], "uid": m["uid"]}
            existing = await db.contact_mails.find_one(mail_link_key)
            if existing:
                continue  # già processata

            await db.contact_mails.insert_one({
                **mail_link_key,
                "tenant_id": tid,
                "subject": m["subject"],
                "from_email": from_email,
                "from_name": m["from_name"],
                "received_at": m["date"],
                "created_at": datetime.utcnow(),
            })

            # Salva allegati
            for att in m.get("atts", []):
                await db.contact_mail_attachments.insert_one({
                    "attachment_id": f"cma_{uuid.uuid4().hex[:12]}",
                    "contact_id": cid,
                    "tenant_id": tid,
                    "account_id": acc_res["account_id"],
                    "mail_uid": m["uid"],
                    "filename": att["filename"],
                    "content_type": att["content_type"],
                    "size": att["size"],
                    "content_b64": att["b64"],
                    "created_at": datetime.utcnow(),
                })
                stats["attachments_saved"] += 1

            # LLM signature parser (solo se testo abbastanza lungo)
            if m.get("text") and len(m["text"]) > 50:
                sig_data = await _extract_signature_llm(m["text"], m["from_name"])
                if sig_data:
                    # Confronta con dati esistenti del contact
                    changes = {}
                    for key, new_val in sig_data.items():
                        current_val = contact.get(key)
                        if not current_val and new_val:
                            changes[key] = {"from": None, "to": new_val}
                        elif current_val and new_val and str(current_val).lower() != str(new_val).lower():
                            changes[key] = {"from": current_val, "to": new_val}
                    if changes:
                        proposal_id = f"mcp_{uuid.uuid4().hex[:12]}"
                        await db.mail_crm_proposals.insert_one({
                            "proposal_id": proposal_id,
                            "contact_id": cid,
                            "tenant_id": tid,
                            "source_mail_uid": m["uid"],
                            "source_account_id": acc_res["account_id"],
                            "from_email": from_email,
                            "from_name": m["from_name"],
                            "subject": m["subject"],
                            "changes": changes,
                            "status": "pending",
                            "created_at": datetime.utcnow(),
                        })
                        stats["proposals_created"] += 1

                        # Axon alert
                        try:
                            await db.axon_alerts.insert_one({
                                "alert_id": f"aal_{uuid.uuid4().hex[:12]}",
                                "tenant_id": tid,
                                "type": "crm_signature",
                                "title": f"Aggiorna anagrafica: {contact.get('name') or from_email}",
                                "message": f"{len(changes)} campo/i da rivedere · da mail '{m['subject'][:60]}'",
                                "url_id": proposal_id,
                                "seen": False,
                                "created_at": datetime.utcnow(),
                            })
                            stats["alerts"] += 1
                        except Exception:
                            pass

    return {"ok": True, "stats": stats, "accounts_scanned": len(accounts)}


# ─── Auto-CRM scheduler settings ────────────────────────────────────
# V50.z24 — Settings per tenant per pianificazione scansione automatica.
# Collection `mail_auto_crm_settings`:
#   { tenant_id, user_id, enabled, interval_minutes, last_run_at, next_run_at, updated_at }
AUTOCRM_MIN_INTERVAL = 5      # minimo consentito (minuti)
AUTOCRM_MAX_INTERVAL = 1440   # massimo consentito (24h)
AUTOCRM_DEFAULT_INTERVAL = 15


@api_router.get("/mail/auto-crm/settings")
async def mail_auto_crm_get_settings(user=Depends(get_current_user)):
    tid = tenant_id(user)
    s = await db.mail_auto_crm_settings.find_one({"tenant_id": tid, "user_id": user["user_id"]}, {"_id": 0})
    if not s:
        s = {
            "tenant_id": tid,
            "user_id": user["user_id"],
            "enabled": False,
            "interval_minutes": AUTOCRM_DEFAULT_INTERVAL,
            "last_run_at": None,
            "next_run_at": None,
            "last_stats": None,
        }
    # Serialize datetimes
    for k in ("last_run_at", "next_run_at", "updated_at"):
        v = s.get(k)
        if isinstance(v, datetime):
            s[k] = v.isoformat()
    return {
        **s,
        "limits": {"min_minutes": AUTOCRM_MIN_INTERVAL, "max_minutes": AUTOCRM_MAX_INTERVAL},
    }


@api_router.patch("/mail/auto-crm/settings")
async def mail_auto_crm_update_settings(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    tid = tenant_id(user)
    updates: Dict[str, Any] = {}
    if "enabled" in payload:
        updates["enabled"] = bool(payload["enabled"])
    if "interval_minutes" in payload:
        try:
            mins = int(payload["interval_minutes"])
        except Exception:
            raise HTTPException(400, "interval_minutes deve essere un numero")
        if mins < AUTOCRM_MIN_INTERVAL or mins > AUTOCRM_MAX_INTERVAL:
            raise HTTPException(400, f"interval_minutes deve essere tra {AUTOCRM_MIN_INTERVAL} e {AUTOCRM_MAX_INTERVAL}")
        updates["interval_minutes"] = mins
    if not updates:
        raise HTTPException(400, "Nessun campo da aggiornare")
    updates["updated_at"] = datetime.utcnow()
    # Se enabled=true e non c'è un next_run_at, pianifica adesso
    now = datetime.utcnow()
    existing = await db.mail_auto_crm_settings.find_one({"tenant_id": tid, "user_id": user["user_id"]})
    if updates.get("enabled") is True:
        # Riparte da subito
        updates["next_run_at"] = now
    if updates.get("enabled") is False:
        updates["next_run_at"] = None
    # Se solo cambia interval e già attivo, ricalcola next_run partendo da last_run
    if "interval_minutes" in updates and existing and existing.get("enabled") and "enabled" not in updates:
        base = existing.get("last_run_at") or now
        if isinstance(base, str):
            try:
                base = datetime.fromisoformat(base)
            except Exception:
                base = now
        updates["next_run_at"] = base + timedelta(minutes=updates["interval_minutes"])

    await db.mail_auto_crm_settings.update_one(
        {"tenant_id": tid, "user_id": user["user_id"]},
        {"$set": {**updates, "tenant_id": tid, "user_id": user["user_id"]}},
        upsert=True,
    )
    return await mail_auto_crm_get_settings(user)


async def _run_auto_crm_tick():
    """Job schedulato: gira ogni minuto, controlla tenant con scan in scadenza."""
    try:
        now = datetime.utcnow()
        cursor = db.mail_auto_crm_settings.find({"enabled": True})
        candidates = []
        async for s in cursor:
            nra = s.get("next_run_at")
            if nra is None or (isinstance(nra, datetime) and nra <= now):
                candidates.append(s)
        for s in candidates:
            try:
                interval = int(s.get("interval_minutes") or AUTOCRM_DEFAULT_INTERVAL)
                # Prova a scanare per questo user
                res = await _auto_crm_scan_impl(s["user_id"], s["tenant_id"], account_id=None, limit=30)
                await db.mail_auto_crm_settings.update_one(
                    {"tenant_id": s["tenant_id"], "user_id": s["user_id"]},
                    {"$set": {
                        "last_run_at": now,
                        "next_run_at": now + timedelta(minutes=interval),
                        "last_stats": res.get("stats") or {},
                        "last_error": None if res.get("ok") else res.get("error"),
                    }},
                )
                if res.get("ok"):
                    st = res.get("stats") or {}
                    logger.info(f"[auto-crm-scheduler] tenant={s['tenant_id']} scanned={st.get('scanned')} proposals={st.get('proposals_created')}")
            except Exception as e:
                logger.warning(f"[auto-crm-scheduler] tenant={s.get('tenant_id')} error: {e}")
                await db.mail_auto_crm_settings.update_one(
                    {"tenant_id": s["tenant_id"], "user_id": s["user_id"]},
                    {"$set": {"last_error": str(e)[:200], "next_run_at": now + timedelta(minutes=int(s.get("interval_minutes") or AUTOCRM_DEFAULT_INTERVAL))}},
                )
    except Exception as e:
        logger.warning(f"[auto-crm-scheduler] tick error: {e}")





@api_router.get("/mail/auto-crm/proposals")
async def mail_auto_crm_list_proposals(status: str = "pending", user=Depends(get_current_user)):
    tid = tenant_id(user)
    q = {"tenant_id": tid}
    if status != "all":
        q["status"] = status
    items = [p async for p in db.mail_crm_proposals.find(q, {"_id": 0}).sort("created_at", -1).limit(100)]
    # Serialize datetime
    for it in items:
        if isinstance(it.get("created_at"), datetime):
            it["created_at"] = it["created_at"].isoformat()
        # Attach contact info
        c = await db.contacts.find_one({"contact_id": it["contact_id"]}, {"_id": 0, "name": 1, "email": 1})
        it["contact_name"] = (c or {}).get("name")
        it["contact_email"] = (c or {}).get("email")
    return {"items": items, "count": len(items)}


@api_router.post("/mail/auto-crm/proposals/{proposal_id}/accept")
async def mail_auto_crm_accept(proposal_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    p = await db.mail_crm_proposals.find_one({"proposal_id": proposal_id, "tenant_id": tid})
    if not p:
        raise HTTPException(404, "Proposta non trovata")
    if p.get("status") != "pending":
        raise HTTPException(400, "Proposta già gestita")
    updates = {}
    for field, delta in (p.get("changes") or {}).items():
        updates[field] = delta.get("to")
    if updates:
        updates["updated_at"] = datetime.utcnow()
        await db.contacts.update_one({"contact_id": p["contact_id"]}, {"$set": updates})
    await db.mail_crm_proposals.update_one(
        {"proposal_id": proposal_id},
        {"$set": {"status": "accepted", "handled_at": datetime.utcnow(), "handled_by": user["user_id"]}},
    )
    return {"ok": True, "applied_fields": list(updates.keys())}


@api_router.post("/mail/auto-crm/proposals/{proposal_id}/reject")
async def mail_auto_crm_reject(proposal_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.mail_crm_proposals.update_one(
        {"proposal_id": proposal_id, "tenant_id": tid, "status": "pending"},
        {"$set": {"status": "rejected", "handled_at": datetime.utcnow(), "handled_by": user["user_id"]}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Proposta non trovata o già gestita")
    return {"ok": True}


# ─── V50.z25 — Allegati salvati per contatto (Auto-CRM) ──────────────
@api_router.get("/contacts/{contact_id}/mail-attachments")
async def contact_mail_attachments_list(contact_id: str, user=Depends(get_current_user)):
    """Lista degli allegati salvati automaticamente dall'Auto-CRM per il contatto."""
    tid = tenant_id(user)
    # Verifica ownership contatto
    contact = await db.contacts.find_one({"contact_id": contact_id, "user_id": user["user_id"]}, {"_id": 0, "contact_id": 1})
    if not contact:
        # Consenti anche accesso via tenant (team)
        contact = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "contact_id": 1, "user_id": 1})
        if not contact:
            raise HTTPException(404, "Contatto non trovato")
    items = []
    cursor = db.contact_mail_attachments.find(
        {"contact_id": contact_id, "tenant_id": tid},
        {"_id": 0, "content_b64": 0},  # escludi payload dalla lista
    ).sort("created_at", -1).limit(200)
    async for a in cursor:
        # Cerca la mail sorgente per subject/from
        mail = None
        try:
            mail = await db.contact_mails.find_one(
                {"contact_id": contact_id, "account_id": a.get("account_id"), "uid": a.get("mail_uid")},
                {"_id": 0, "subject": 1, "from_email": 1, "from_name": 1, "received_at": 1},
            )
        except Exception:
            pass
        if isinstance(a.get("created_at"), datetime):
            a["created_at"] = a["created_at"].isoformat()
        if mail:
            a["mail_subject"] = mail.get("subject")
            a["mail_from_email"] = mail.get("from_email")
            a["mail_from_name"] = mail.get("from_name")
            a["mail_received_at"] = mail.get("received_at")
        items.append(a)
    return {"items": items, "count": len(items)}


@api_router.get("/contacts/{contact_id}/mail-attachments/{attachment_id}/download")
async def contact_mail_attachment_download(contact_id: str, attachment_id: str, user=Depends(get_current_user)):
    """Scarica il binario dell'allegato salvato (base64 → bytes)."""
    from fastapi.responses import Response as _Resp
    import base64 as _b64
    tid = tenant_id(user)
    att = await db.contact_mail_attachments.find_one(
        {"attachment_id": attachment_id, "contact_id": contact_id, "tenant_id": tid},
        {"_id": 0},
    )
    if not att:
        raise HTTPException(404, "Allegato non trovato")
    try:
        payload = _b64.b64decode(att.get("content_b64") or "")
    except Exception:
        raise HTTPException(500, "Contenuto allegato corrotto")
    filename = att.get("filename") or "allegato"
    ctype = att.get("content_type") or "application/octet-stream"
    # RFC5987 per filename con caratteri non-ASCII
    from urllib.parse import quote as _q
    return _Resp(
        content=payload,
        media_type=ctype,
        headers={"Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{_q(filename)}'},
    )


@api_router.delete("/contacts/{contact_id}/mail-attachments/{attachment_id}")
async def contact_mail_attachment_delete(contact_id: str, attachment_id: str, user=Depends(get_current_user)):
    """Rimuove un allegato salvato per il contatto."""
    tid = tenant_id(user)
    r = await db.contact_mail_attachments.delete_one(
        {"attachment_id": attachment_id, "contact_id": contact_id, "tenant_id": tid},
    )
    if r.deleted_count == 0:
        raise HTTPException(404, "Allegato non trovato")
    return {"ok": True}



# =========================================================================
# V50.z18 — MICROSOFT OUTLOOK OAUTH (Microsoft Graph Mail.Read)
#
# Flow (auth code + PKCE + offline_access):
#   1. Frontend chiama GET /api/outlook/start → riceve URL di autorizzazione
#   2. WebBrowser Expo apre auth Microsoft
#   3. Callback GET /api/outlook/callback riceve code+state
#   4. Backend scambia code → access_token+refresh_token → salvati cifrati
#   5. Redirect al frontend (?ok=1) — chiude popup
#   6. Frontend chiama GET /api/outlook/messages → legge inbox
#
# I token sono cifrati con Fernet (OUTLOOK_TOKEN_ENC_KEY in .env).
# =========================================================================
import base64 as _b64
import hashlib as _hashlib
import secrets as _secrets
from urllib.parse import urlencode as _urlencode
try:
    from cryptography.fernet import Fernet as _Fernet
except Exception:
    _Fernet = None

_MS_CLIENT_ID = os.environ.get("MS_CLIENT_ID", "")
_MS_CLIENT_SECRET = os.environ.get("MS_CLIENT_SECRET", "")
_MS_TENANT = os.environ.get("MS_TENANT", "common")
_MS_REDIRECT_URI = os.environ.get("MS_REDIRECT_URI", "")
_MS_SCOPES = os.environ.get("MS_SCOPES", "openid profile offline_access Mail.Read")
_OUTLOOK_TOKEN_ENC_KEY = os.environ.get("OUTLOOK_TOKEN_ENC_KEY", "")
_OUTLOOK_APP_RETURN_URL = os.environ.get("OUTLOOK_APP_RETURN_URL", "")

_MS_AUTHORITY = f"https://login.microsoftonline.com/{_MS_TENANT}/oauth2/v2.0"
_MS_GRAPH = "https://graph.microsoft.com/v1.0"

_outlook_fernet = None
if _Fernet and _OUTLOOK_TOKEN_ENC_KEY:
    try:
        _outlook_fernet = _Fernet(_OUTLOOK_TOKEN_ENC_KEY.encode())
    except Exception as _e:
        logger.error(f"[Outlook] Fernet init failed: {_e}")


def _outlook_configured() -> bool:
    return bool(_MS_CLIENT_ID and _MS_CLIENT_SECRET and _MS_REDIRECT_URI and _outlook_fernet)


def _b64url(data: bytes) -> str:
    return _b64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _make_pkce() -> tuple:
    verifier = _b64url(_secrets.token_bytes(32))
    challenge = _b64url(_hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def _enc(s: str) -> str:
    return _outlook_fernet.encrypt(s.encode()).decode()


def _dec(s: str) -> str:
    return _outlook_fernet.decrypt(s.encode()).decode()


@api_router.get("/outlook/status")
async def outlook_status(user=Depends(get_current_user)):
    """Ritorna se l'utente ha già collegato Outlook."""
    if not _outlook_configured():
        return {"configured": False, "connected": False}
    doc = await db.outlook_tokens.find_one({"user_id": user["user_id"]})
    return {
        "configured": True,
        "connected": bool(doc),
        "account_email": (doc or {}).get("account_email"),
        "connected_at": (doc or {}).get("updated_at").isoformat() if (doc or {}).get("updated_at") else None,
    }


@api_router.get("/outlook/start")
async def outlook_start(user=Depends(get_current_user)):
    """Genera URL di autorizzazione Microsoft (auth code + PKCE)."""
    if not _outlook_configured():
        raise HTTPException(400, "Outlook non configurato: credenziali Microsoft mancanti")
    verifier, challenge = _make_pkce()
    state = _secrets.token_urlsafe(32)
    await db.outlook_oauth_states.insert_one({
        "state": state,
        "user_id": user["user_id"],
        "code_verifier": verifier,
        "created_at": datetime.utcnow(),
        "expires_at": datetime.utcnow() + timedelta(minutes=10),
    })
    # Cleanup old states (best-effort)
    try:
        await db.outlook_oauth_states.delete_many({"expires_at": {"$lt": datetime.utcnow()}})
    except Exception:
        pass
    params = {
        "client_id": _MS_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": _MS_REDIRECT_URI,
        "response_mode": "query",
        "scope": _MS_SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return {"authorization_url": f"{_MS_AUTHORITY}/authorize?{_urlencode(params)}"}


async def _ms_token_request(data: dict) -> dict:
    body = {**data, "client_id": _MS_CLIENT_ID, "client_secret": _MS_CLIENT_SECRET}
    async with httpx.AsyncClient(timeout=15) as cx:
        r = await cx.post(f"{_MS_AUTHORITY}/token", data=body)
    if r.status_code >= 400:
        logger.error(f"[Outlook] token exchange failed status={r.status_code} body={r.text[:400]}")
        raise HTTPException(502, f"Microsoft token exchange failed: {r.text[:200]}")
    return r.json()


@api_router.get("/outlook/callback")
async def outlook_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None, error_description: Optional[str] = None):
    """Callback Microsoft: scambia code→token, salva cifrato, redirige all'app."""
    from fastapi.responses import RedirectResponse as _RR
    return_url = _OUTLOOK_APP_RETURN_URL or "/"
    if error or not code or not state:
        logger.warning(f"[Outlook] callback error={error} desc={error_description}")
        return _RR(f"{return_url}?ok=0&error={error or 'missing_code'}")
    if not _outlook_configured():
        return _RR(f"{return_url}?ok=0&error=not_configured")

    saved = await db.outlook_oauth_states.find_one_and_delete({"state": state})
    if not saved:
        return _RR(f"{return_url}?ok=0&error=invalid_state")
    exp = saved.get("expires_at")
    if isinstance(exp, datetime) and exp < datetime.utcnow():
        return _RR(f"{return_url}?ok=0&error=state_expired")

    try:
        tokens = await _ms_token_request({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _MS_REDIRECT_URI,
            "scope": _MS_SCOPES,
            "code_verifier": saved["code_verifier"],
        })
    except HTTPException as e:
        return _RR(f"{return_url}?ok=0&error=token_exchange_failed")

    # Recupera email dell'account collegato via /me
    account_email = None
    try:
        async with httpx.AsyncClient(timeout=10) as cx:
            r = await cx.get(f"{_MS_GRAPH}/me?$select=mail,userPrincipalName,displayName",
                             headers={"Authorization": f"Bearer {tokens['access_token']}"})
        if r.status_code < 400:
            me = r.json()
            account_email = me.get("mail") or me.get("userPrincipalName")
    except Exception as e:
        logger.warning(f"[Outlook] /me lookup failed: {e}")

    now = int(datetime.utcnow().timestamp())
    doc = {
        "user_id": saved["user_id"],
        "access_token_enc": _enc(tokens["access_token"]),
        "refresh_token_enc": _enc(tokens["refresh_token"]) if tokens.get("refresh_token") else None,
        "expires_at": now + int(tokens.get("expires_in", 3600)),
        "scope": tokens.get("scope", _MS_SCOPES),
        "account_email": account_email,
        "updated_at": datetime.utcnow(),
    }
    await db.outlook_tokens.replace_one({"user_id": saved["user_id"]}, doc, upsert=True)
    logger.info(f"[Outlook] connected user={saved['user_id']} account={account_email}")
    return _RR(f"{return_url}?ok=1")


async def _get_valid_graph_token(user_id: str) -> str:
    doc = await db.outlook_tokens.find_one({"user_id": user_id})
    if not doc:
        raise HTTPException(404, "Outlook non collegato")
    now = int(datetime.utcnow().timestamp())
    if doc["expires_at"] > now + 120:
        return _dec(doc["access_token_enc"])
    if not doc.get("refresh_token_enc"):
        raise HTTPException(401, "Outlook: riautorizzazione richiesta")
    refreshed = await _ms_token_request({
        "grant_type": "refresh_token",
        "refresh_token": _dec(doc["refresh_token_enc"]),
        "scope": _MS_SCOPES,
    })
    update = {
        "access_token_enc": _enc(refreshed["access_token"]),
        "expires_at": now + int(refreshed.get("expires_in", 3600)),
        "updated_at": datetime.utcnow(),
    }
    if refreshed.get("refresh_token"):
        update["refresh_token_enc"] = _enc(refreshed["refresh_token"])
    await db.outlook_tokens.update_one({"user_id": user_id}, {"$set": update})
    return refreshed["access_token"]


@api_router.get("/outlook/messages")
async def outlook_messages(unread_only: bool = True, top: int = 25, user=Depends(get_current_user)):
    """Legge le mail INBOX dell'utente da Microsoft Graph."""
    if not _outlook_configured():
        raise HTTPException(400, "Outlook non configurato")
    token = await _get_valid_graph_token(user["user_id"])
    params = {
        "$select": "id,subject,from,receivedDateTime,bodyPreview,isRead,webLink,importance,hasAttachments",
        "$orderby": "receivedDateTime DESC",
        "$top": str(max(1, min(top, 100))),
    }
    if unread_only:
        params["$filter"] = "isRead eq false"
    headers = {
        "Authorization": f"Bearer {token}",
        "Prefer": 'outlook.body-content-type="text"',
    }
    async with httpx.AsyncClient(timeout=20) as cx:
        r = await cx.get(f"{_MS_GRAPH}/me/mailFolders/inbox/messages", params=params, headers=headers)
    if r.status_code == 401:
        raise HTTPException(401, "Outlook token scaduto o revocato — ricollega Outlook")
    if r.status_code >= 400:
        logger.error(f"[Outlook] graph error status={r.status_code} body={r.text[:300]}")
        raise HTTPException(502, f"Errore Microsoft Graph: {r.text[:200]}")
    data = r.json()
    msgs = []
    for m in data.get("value", []):
        sender = ((m.get("from") or {}).get("emailAddress") or {})
        msgs.append({
            "id": m.get("id"),
            "subject": m.get("subject") or "(senza oggetto)",
            "preview": m.get("bodyPreview") or "",
            "from_name": sender.get("name"),
            "from_email": sender.get("address"),
            "received_at": m.get("receivedDateTime"),
            "is_read": m.get("isRead", False),
            "web_link": m.get("webLink"),
            "importance": m.get("importance"),
            "has_attachments": m.get("hasAttachments", False),
        })
    return {"messages": msgs, "count": len(msgs), "next_link": data.get("@odata.nextLink")}


@api_router.post("/outlook/disconnect")
async def outlook_disconnect(user=Depends(get_current_user)):
    """Rimuove il collegamento Outlook dell'utente (token cancellati dal DB)."""
    await db.outlook_tokens.delete_one({"user_id": user["user_id"]})
    return {"disconnected": True}


