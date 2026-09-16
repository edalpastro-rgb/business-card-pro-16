# identity_documents.py — V50.z267 — Documenti di riconoscimento (carta d'identità, patente, passaporto, tessera sanitaria/CF)
# • OCR Gemini fronte/retro → precompila anagrafica master (/master/profile) o scheda cliente (come per il biglietto da visita)
# • Le foto vengono salvate su Object Storage (fallback base64 in Mongo) nella collection `identity_documents`,
#   riutilizzabili/condivisibili da Anagrafica Master (sezione «Documenti di riconoscimento») e dalle schede cliente.
# • Scadenza: job giornaliero 09:15 → 3 mesi prima email (Resend → SMTP tenant) + notifica in app; 1 mese prima notifica CRITICAL
#   + popup in app (GET /identity-documents/expiring-popup, snooze 24h).
# Isolato: usa LlmChat/ImageContent (come 12_ai_contact_copilot), _put_object_sync/_get_object_sync (05), _pl_send_email (axon_personal_lock),
# axon_notify (axon_notifications). Il job viene registrato in 37_app_startup_scheduler.

IDDOC_TYPES = {"id_card": "Carta d'identità", "driving_license": "Patente", "passport": "Passaporto", "health_card": "Tessera sanitaria / CF"}
_IDDOC_MAX_B64 = 12 * 1024 * 1024  # ~9 MB immagine

IDDOC_OCR_SYSTEM = (
    "Sei un motore OCR per documenti d'identità italiani (carta d'identità cartacea o elettronica CIE, patente, passaporto, "
    "tessera sanitaria / codice fiscale). Ricevi fronte e, se presente, retro. Estrai SOLO i dati leggibili e restituisci "
    "ESCLUSIVAMENTE un JSON compatto con queste chiavi (stringa vuota se non presente):\n"
    "doc_type (id_card|driving_license|passport|health_card), first_name, last_name, sex (M|F), birth_date (AAAA-MM-GG), "
    "birth_place, tax_id (codice fiscale 16 caratteri maiuscolo), nationality, document_number, issue_date (AAAA-MM-GG), "
    "expiry_date (AAAA-MM-GG), issuing_authority, address, city, height, notes.\n"
    "Regole: le date SEMPRE in formato AAAA-MM-GG (converti da GG.MM.AAAA o GG/MM/AAAA). Sulla tessera sanitaria la data "
    "di scadenza è la 'Data di scadenza' del tesserino. Non inventare mai: se un campo non è leggibile lascia stringa vuota. "
    "Nessun testo fuori dal JSON."
)


class IdDocOcrIn(BaseModel):
    front_base64: str
    back_base64: Optional[str] = None
    doc_type: Optional[str] = None


class IdDocIn(BaseModel):
    subject_type: str = "user"  # user | contact
    subject_id: Optional[str] = None  # contact_id quando subject_type == contact
    doc_type: str = "id_card"
    document_number: Optional[str] = ""
    issue_date: Optional[str] = ""
    expiry_date: Optional[str] = ""
    issuing_authority: Optional[str] = ""
    holder_name: Optional[str] = ""
    notes: Optional[str] = ""
    extracted: Optional[Dict[str, Any]] = None  # dati OCR completi (riutilizzati per la compilazione moduli)
    front_base64: Optional[str] = None
    back_base64: Optional[str] = None


class IdDocUpdate(BaseModel):
    doc_type: Optional[str] = None
    document_number: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    issuing_authority: Optional[str] = None
    holder_name: Optional[str] = None
    notes: Optional[str] = None


def _iddoc_bare_b64(b64: str) -> str:
    return b64.split(",", 1)[1] if b64.startswith("data:") else b64


def _iddoc_mime(b64: str) -> str:
    if b64.startswith("data:"):
        try:
            return b64[5:].split(";", 1)[0] or "image/jpeg"
        except Exception:  # noqa: BLE001
            return "image/jpeg"
    return "image/png" if _iddoc_bare_b64(b64).startswith("iVBOR") else "image/jpeg"


def _iddoc_days_left(expiry: Optional[str]) -> Optional[int]:
    try:
        d = datetime.strptime((expiry or "")[:10], "%Y-%m-%d").date()
        return (d - datetime.now(timezone.utc).date()).days
    except Exception:  # noqa: BLE001
        return None


def _iddoc_public(doc: dict) -> dict:
    out = {k: v for k, v in doc.items() if k not in ("_id", "front_b64", "back_b64")}
    out["has_front"] = bool(doc.get("front_path") or doc.get("front_b64"))
    out["has_back"] = bool(doc.get("back_path") or doc.get("back_b64"))
    out["days_left"] = _iddoc_days_left(doc.get("expiry_date"))
    out["doc_type_label"] = IDDOC_TYPES.get(doc.get("doc_type") or "", doc.get("doc_type") or "Documento")
    return out


async def _iddoc_check_subject(user: dict, subject_type: str, subject_id: Optional[str]) -> str:
    if subject_type == "user":
        return user["user_id"]
    if subject_type == "contact":
        if not subject_id:
            raise HTTPException(status_code=400, detail="subject_id (contact_id) mancante")
        c = await db.contacts.find_one(tenant_scope(user, {"contact_id": subject_id}), {"_id": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Contatto non trovato")
        return subject_id
    raise HTTPException(status_code=400, detail="subject_type non valido")


async def _iddoc_store_image(tid: str, doc_id: str, side: str, b64: Optional[str]) -> dict:
    """Object Storage → fallback base64 in Mongo (il documento non deve mai andare perso)."""
    if not b64:
        return {}
    if len(b64) > _IDDOC_MAX_B64:
        raise HTTPException(status_code=413, detail="Immagine troppo grande (max ~9 MB)")
    mime = _iddoc_mime(b64)
    try:
        raw = base64.b64decode(_iddoc_bare_b64(b64))
        ext = "png" if mime == "image/png" else "jpg"
        path = f"{_STORAGE_APP_NAME}/identity-docs/{tid}/{doc_id}_{side}.{ext}"
        res = await run_in_threadpool(_put_object_sync, path, raw, mime)
        if res:
            return {f"{side}_path": res.get("path") or path, f"{side}_mime": mime}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[identity-docs] object storage fallito (%s) → fallback Mongo", exc)
    return {f"{side}_b64": _iddoc_bare_b64(b64), f"{side}_mime": mime}


async def _iddoc_load_image(doc: dict, side: str) -> Optional[str]:
    mime = doc.get(f"{side}_mime") or "image/jpeg"
    if doc.get(f"{side}_path"):
        got = await run_in_threadpool(_get_object_sync, doc[f"{side}_path"])
        if got:
            return f"data:{got[1] if got[1] and got[1] != 'application/octet-stream' else mime};base64,{base64.b64encode(got[0]).decode()}"
    if doc.get(f"{side}_b64"):
        return f"data:{mime};base64,{doc[f'{side}_b64']}"
    return None


@api_router.post("/identity-documents/ocr")
async def identity_document_ocr(body: IdDocOcrIn, user=Depends(get_current_user)):
    """OCR Gemini del documento (fronte + retro opzionale) → campi anagrafici + numero/scadenza documento."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    if not body.front_base64:
        raise HTTPException(status_code=400, detail="Immagine del fronte mancante")
    files = [ImageContent(image_base64=_iddoc_bare_b64(body.front_base64))]
    if body.back_base64:
        files.append(ImageContent(image_base64=_iddoc_bare_b64(body.back_base64)))
    _dflt = "documento d'identità"
    hint = f" Il documento dovrebbe essere: {IDDOC_TYPES.get(body.doc_type or '', _dflt)}." if body.doc_type else ""
    text = ("Ecco il fronte" + (" e il retro" if body.back_base64 else "") + " di un documento di riconoscimento italiano." + hint
            + " Estrai i dati e restituisci il JSON richiesto.")

    async def _run(model_name: str):
        chat = LlmChat(api_key=key, session_id=f"iddoc-ocr-{uuid.uuid4().hex[:8]}", system_message=IDDOC_OCR_SYSTEM).with_model("gemini", model_name)
        return await chat.send_message(UserMessage(text=text, file_contents=files))

    resp, last_err = None, None
    for model in ("gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"):
        try:
            resp = await _run(model)
            if resp:
                break
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning(f"identity doc OCR failed with {model}: {e}")
    if resp is None:
        raise HTTPException(status_code=422, detail=f"Impossibile leggere il documento: {str(last_err)[:200] if last_err else 'nessuna risposta'}")
    data = _parse_llm_json((resp or "").strip(), fallback_key="notes")
    for k in ("parse_error", "error_message", "parse_error_kind"):
        data.pop(k, None)
    if body.doc_type and not data.get("doc_type"):
        data["doc_type"] = body.doc_type
    if data.get("tax_id"):
        data["tax_id"] = re.sub(r"[^A-Z0-9]", "", str(data["tax_id"]).upper())
    return {"document": data}


@api_router.post("/identity-documents")
async def identity_document_create(body: IdDocIn, user=Depends(get_current_user)):
    if body.doc_type not in IDDOC_TYPES:
        raise HTTPException(status_code=400, detail="Tipo documento non valido")
    if not body.front_base64:
        raise HTTPException(status_code=400, detail="Serve almeno la foto del fronte")
    subject_id = await _iddoc_check_subject(user, body.subject_type, body.subject_id)
    tid = tenant_id(user)
    doc_id = f"idd_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    doc = {
        "doc_id": doc_id, "tenant_id": tid, "owner_user_id": user["user_id"], "subject_type": body.subject_type, "subject_id": subject_id,
        "doc_type": body.doc_type, "document_number": (body.document_number or "").strip().upper(), "issue_date": (body.issue_date or "")[:10],
        "expiry_date": (body.expiry_date or "")[:10], "issuing_authority": (body.issuing_authority or "").strip(), "holder_name": (body.holder_name or "").strip(),
        "notes": (body.notes or "").strip(), "extracted": {k: v for k, v in (body.extracted or {}).items() if isinstance(v, (str, int, float)) and str(v).strip()},
        "alerts": {}, "popup_snooze_until": None, "created_at": now, "updated_at": now,
    }
    doc.update(await _iddoc_store_image(tid, doc_id, "front", body.front_base64))
    doc.update(await _iddoc_store_image(tid, doc_id, "back", body.back_base64))
    await db.identity_documents.insert_one(doc)
    return _iddoc_public(doc)


@api_router.get("/identity-documents")
async def identity_documents_list(subject_type: str = "user", subject_id: Optional[str] = None, user=Depends(get_current_user)):
    sid = await _iddoc_check_subject(user, subject_type, subject_id)
    q = {"tenant_id": tenant_id(user), "subject_type": subject_type, "subject_id": sid}
    items = await db.identity_documents.find(q, {"_id": 0, "front_b64": 0, "back_b64": 0}).sort("created_at", -1).to_list(50)
    return {"items": [_iddoc_public(d) for d in items]}


@api_router.get("/identity-documents/expiring-popup")
async def identity_documents_expiring_popup(user=Depends(get_current_user)):
    """Documenti (propri + dei clienti di cui l'utente è owner) in scadenza entro 30 giorni, non snoozati → popup in app."""
    now = utcnow()
    q = {"tenant_id": tenant_id(user), "$or": [{"subject_type": "user", "subject_id": user["user_id"]}, {"subject_type": "contact", "owner_user_id": user["user_id"]}],
         "expiry_date": {"$nin": ["", None]}}
    out = []
    async for d in db.identity_documents.find(q, {"_id": 0, "front_b64": 0, "back_b64": 0}):
        dl = _iddoc_days_left(d.get("expiry_date"))
        if dl is None or dl > 30:
            continue
        sn = d.get("popup_snooze_until")
        if sn and isinstance(sn, datetime) and (sn.replace(tzinfo=timezone.utc) if sn.tzinfo is None else sn) > now:
            continue
        p = _iddoc_public(d)
        if d.get("subject_type") == "contact":
            c = await db.contacts.find_one({"contact_id": d.get("subject_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company": 1})
            p["subject_label"] = (f"{(c or {}).get('first_name', '')} {(c or {}).get('last_name', '')}".strip() or (c or {}).get("company") or "Cliente") if c else "Cliente"
            p["deeplink"] = f"/contact/{d.get('subject_id')}?tab=files"
        else:
            p["subject_label"] = "Tu"
            p["deeplink"] = "/anagrafica-master"
        out.append(p)
    out.sort(key=lambda x: x.get("days_left") if x.get("days_left") is not None else 999)
    return {"items": out}


@api_router.post("/identity-documents/{doc_id}/popup-snooze")
async def identity_document_snooze(doc_id: str, user=Depends(get_current_user)):
    r = await db.identity_documents.update_one({"doc_id": doc_id, "tenant_id": tenant_id(user)}, {"$set": {"popup_snooze_until": utcnow() + timedelta(hours=24)}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    return {"ok": True}


@api_router.get("/identity-documents/{doc_id}/image/{side}")
async def identity_document_image(doc_id: str, side: str, user=Depends(get_current_user)):
    if side not in ("front", "back"):
        raise HTTPException(status_code=400, detail="side deve essere front|back")
    d = await db.identity_documents.find_one({"doc_id": doc_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    data_url = await _iddoc_load_image(d, side)
    if not data_url:
        raise HTTPException(status_code=404, detail="Immagine non disponibile")
    return {"data_url": data_url, "mime": d.get(f"{side}_mime") or "image/jpeg"}


@api_router.put("/identity-documents/{doc_id}")
async def identity_document_update(doc_id: str, body: IdDocUpdate, user=Depends(get_current_user)):
    upd = {k: (v.strip() if isinstance(v, str) else v) for k, v in body.model_dump().items() if v is not None}
    if "doc_type" in upd and upd["doc_type"] not in IDDOC_TYPES:
        raise HTTPException(status_code=400, detail="Tipo documento non valido")
    if "document_number" in upd:
        upd["document_number"] = upd["document_number"].upper()
    if "expiry_date" in upd:
        upd["expiry_date"] = upd["expiry_date"][:10]
        upd["alerts"] = {}  # nuova scadenza → gli avvisi ripartono
    upd["updated_at"] = utcnow()
    r = await db.identity_documents.update_one({"doc_id": doc_id, "tenant_id": tenant_id(user)}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    d = await db.identity_documents.find_one({"doc_id": doc_id}, {"_id": 0, "front_b64": 0, "back_b64": 0})
    return _iddoc_public(d)


@api_router.delete("/identity-documents/{doc_id}")
async def identity_document_delete(doc_id: str, user=Depends(get_current_user)):
    r = await db.identity_documents.delete_one({"doc_id": doc_id, "tenant_id": tenant_id(user)})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    return {"ok": True}


# ---------- Job giornaliero: avvisi di scadenza (90 gg email + notifica, 30 gg notifica CRITICAL + popup) ----------
async def _iddoc_expiry_job():
    n_mail = n_pop = 0
    try:
        async for d in db.identity_documents.find({"expiry_date": {"$nin": ["", None]}}, {"_id": 0, "front_b64": 0, "back_b64": 0}):
            dl = _iddoc_days_left(d.get("expiry_date"))
            if dl is None or dl > 90:
                continue
            alerts = d.get("alerts") or {}
            owner = await db.users.find_one({"user_id": d.get("owner_user_id")}, {"_id": 0, "user_id": 1, "email": 1, "name": 1})
            if not owner:
                continue
            label = IDDOC_TYPES.get(d.get("doc_type") or "", "Documento")
            who = "Il tuo"
            deeplink = "/anagrafica-master"
            if d.get("subject_type") == "contact":
                c = await db.contacts.find_one({"contact_id": d.get("subject_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company": 1}) or {}
                nm = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip() or c.get("company") or "un cliente"
                who = f"Il documento di {nm}:"
                deeplink = f"/contact/{d.get('subject_id')}?tab=files"
            when = "è SCADUTO" if dl < 0 else ("scade oggi" if dl == 0 else f"scade tra {dl} giorni")
            exp_it = "/".join(reversed(d["expiry_date"].split("-")))
            title = f"{label} in scadenza" if dl >= 0 else f"{label} scaduto"
            body_txt = f"{who} {label.lower()} {('n. ' + d['document_number'] + ' ') if d.get('document_number') else ''}{when} ({exp_it}). Ricordati di rinnovarlo."
            if not alerts.get("email_90"):
                sent = False
                if owner.get("email"):
                    try:
                        html = f"<p>Ciao {owner.get('name') or ''},</p><p>{body_txt}</p><p>Apri AdvisorOS → Anagrafica → Documenti di riconoscimento per i dettagli.</p><p>— AxonOS</p>"
                        await _pl_send_email(d.get("tenant_id"), to=owner["email"], subject=f"AdvisorOS · {title} ({exp_it})", html=html, text=body_txt)
                        sent = True
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("[identity-docs] email scadenza non inviata (%s): %s", d.get("doc_id"), exc)
                try:
                    await axon_notify(owner["user_id"], d.get("tenant_id"), "reminder", f"⏳ {title}", body_txt, deeplink=deeplink,
                                      dedupe_key=f"iddoc90_{d['doc_id']}_{d['expiry_date']}", extra={"iddoc_id": d["doc_id"], "urgency": "HIGH"}, team_copy=False)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[identity-docs] notifica 90gg fallita: %s", exc)
                alerts["email_90"] = utcnow().isoformat()
                alerts["email_sent"] = sent
                n_mail += 1
            if dl <= 30 and not alerts.get("popup_30"):
                try:
                    await axon_notify(owner["user_id"], d.get("tenant_id"), "reminder", f"🚨 {title}", body_txt, deeplink=deeplink,
                                      dedupe_key=f"iddoc30_{d['doc_id']}_{d['expiry_date']}", extra={"iddoc_id": d["doc_id"], "urgency": "CRITICAL", "popup": True}, team_copy=False)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[identity-docs] notifica 30gg fallita: %s", exc)
                alerts["popup_30"] = utcnow().isoformat()
                n_pop += 1
            await db.identity_documents.update_one({"doc_id": d["doc_id"]}, {"$set": {"alerts": alerts}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[identity-docs] expiry job error: %s", exc)
    if n_mail or n_pop:
        logger.info("[identity-docs] expiry job: %s avvisi 90gg, %s avvisi 30gg", n_mail, n_pop)
    return {"email_90": n_mail, "popup_30": n_pop}


@api_router.post("/identity-documents/run-expiry-check")
async def identity_documents_run_expiry_check(user=Depends(get_current_user)):
    """Esecuzione manuale del controllo scadenze (Master / Strumenti di sviluppo)."""
    return await _iddoc_expiry_job()
