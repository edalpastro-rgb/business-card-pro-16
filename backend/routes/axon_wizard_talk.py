# axon_wizard_talk.py — V50.z215 — BLOCCO 4 · Step 4 «Parla a Neo» del wizard Set Up and Go (modulo ISOLATO)
#
# Tre input non esclusivi: testo libero · file (multipart a chunk, MAI base64, max 50 MB: PDF, immagini, DOCX/PPTX/XLSX, testo) ·
# audio (multipart → Whisper). Tutto passa da Neo (Claude Haiku / Gemini vision per immagini e PDF scansionati) che restituisce:
#   • proposals: valori strutturati rilevati (mail → proposta come MAIL PRINCIPALE, indirizzo → anagrafica, telefono, nome/cognome,
#     data di nascita, CF, P.IVA, azienda, ruolo) → un tap = `POST /axon/setup/talk/confirm` applica il campo (master_profiles / users).
#   • facts: cose apprese su vita e lavoro → confermando vanno in `axon_user_memory` (source wizard_talk) → Neo le usa nel prompt.
# Persistenza: `axon_setup_state.talk = {inputs: [...], proposals: [...], facts_confirmed: n}`; i file caricati sono Master Files (Object
# Storage, categoria files, title «Parla a Neo»). Riuso: _upl_stream_to_temp/_upl_master_store/_upl_whisper_path (axon_uploads),
# heavy_call pdf_text/pdf_render_pages (worker), _axm_llm_json (axon_media), _parse_llm_json.

import zipfile as _wt_zipfile
import io as _wt_io

_WT_TEXT_CAP = 14000
_WT_FIELDS = {
    "primary_email": "Mail principale", "email": "Mail aggiuntiva", "address": "Indirizzo principale", "address_second": "Seconda abitazione",
    "phone": "Telefono", "first_name": "Nome", "last_name": "Cognome", "birth_date": "Data di nascita", "tax_id": "Codice fiscale",
    "vat_id": "Partita IVA", "company_name": "Azienda", "job_title": "Ruolo / attività", "iban": "IBAN",
}
_WT_PROFILE_FIELDS = {"address", "address_second", "phone", "first_name", "last_name", "birth_date", "tax_id", "vat_id", "iban", "job_title"}
_WT_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_WT_SYSTEM = (
    "Sei Neo (AxonOS), assistente personale di un professionista italiano. L'utente ti sta raccontando chi è (testo libero, CV, documenti, "
    "presentazioni, foto o una registrazione vocale trascritta). Estrai SOLO ciò che è davvero presente, senza inventare. Rispondi SOLO JSON:\n"
    "{\"summary\": \"1-2 frasi in italiano, calde e concrete, su cosa hai capito\",\n"
    " \"proposals\": [{\"field\": \"primary_email|email|address|address_second|phone|first_name|last_name|birth_date|tax_id|vat_id|company_name|job_title|iban\", "
    "\"value\": \"valore pulito\", \"why\": \"da dove l'hai preso, 1 frase\"}],\n"
    " \"facts\": [{\"section\": \"stile_lavoro|argomenti|comunicazione|clienti_chiave|scadenze_ricorrenti|integrazioni\", \"text\": \"fatto su vita/lavoro, max 160 caratteri, in terza persona (es. 'Lavora soprattutto con PMI del Veneto')\"}]}\n"
    "Regole: la PRIMA mail trovata va come field primary_email, le altre come email; birth_date in formato AAAA-MM-GG; telefono con prefisso se noto; "
    "indirizzi completi (via, numero, CAP, città); max 10 proposals e max 8 facts; se non trovi nulla usa liste vuote."
)


def _wt_xml_text(raw: bytes) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw.decode("utf-8", "ignore"))).strip()


def _wt_office_text(path: str, ext: str) -> str:
    """DOCX/PPTX/XLSX → testo via XML dello zip (stdlib, leggero)."""
    parts: List[str] = []
    with _wt_zipfile.ZipFile(path) as z:
        names = z.namelist()
        if ext == "docx":
            sel = [n for n in names if n in ("word/document.xml",) or n.startswith("word/header")]
        elif ext == "pptx":
            sel = sorted(n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n))
        else:
            sel = [n for n in names if n == "xl/sharedStrings.xml"]
        for n in sel[:60]:
            parts.append(_wt_xml_text(z.read(n)))
            if sum(len(p) for p in parts) > _WT_TEXT_CAP:
                break
    return "\n".join(p for p in parts if p)


async def _wt_extract(path: str, ext: str, mime: str) -> Tuple[str, Optional[str]]:
    """Ritorna (testo, image_b64 per la vision). Il file resta su disco: mai interamente in JSON."""
    ext = (ext or "").lower()
    if ext == "pdf" or "pdf" in mime:
        with open(path, "rb") as fh:
            data = fh.read()
        txt = ""
        try:
            txt = (await heavy_call("pdf_text", data=data, max_pages=30, max_chars=_WT_TEXT_CAP)).get("text") or ""
        except Exception as exc:  # noqa: BLE001
            logger.warning("[wizard-talk] pdf_text failed: %s", exc)
        if len(txt.strip()) >= 80:
            return txt, None
        try:  # PDF scansionato → prima pagina alla vision
            imgs = (await heavy_call("pdf_render_pages", data=data, max_pages=1, scale=1.5)).get("images") or []
            if imgs:
                return txt, base64.b64encode(imgs[0] if isinstance(imgs[0], (bytes, bytearray)) else imgs[0].get("jpeg", b"")).decode()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[wizard-talk] pdf_render failed: %s", exc)
        return txt, None
    if ext in ("jpg", "jpeg", "png", "webp") or mime.startswith("image/"):
        with open(path, "rb") as fh:
            return "", base64.b64encode(fh.read()).decode()
    if ext in ("docx", "pptx", "xlsx"):
        try:
            return await run_in_threadpool(_wt_office_text, path, ext), None
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"File {ext} non leggibile: {exc}")
    if ext in ("txt", "md", "csv", "json", "rtf") or mime.startswith("text/"):
        with open(path, "rb") as fh:
            return fh.read(_WT_TEXT_CAP * 2).decode("utf-8", "ignore")[:_WT_TEXT_CAP], None
    raise HTTPException(status_code=400, detail="Formato non supportato: usa PDF, immagini, DOCX, PPTX, XLSX o testo")


def _wt_clean_proposals(raw: Any, profile: dict) -> List[dict]:
    out: List[dict] = []
    seen = set()
    for p in (raw or []):
        if not isinstance(p, dict):
            continue
        f = str(p.get("field") or "").strip(); v = str(p.get("value") or "").strip()
        if f not in _WT_FIELDS or not v:
            continue
        if f in ("primary_email", "email"):
            v = v.lower()
            if not _WT_EMAIL_RE.fullmatch(v):
                continue
            if f == "primary_email" and profile.get("primary_email") == v:
                continue
        if f == "tax_id":
            v = v.upper().replace(" ", "")
        key = (f, v.lower())
        if key in seen:
            continue
        seen.add(key)
        cur = profile.get(f) if f in _WT_PROFILE_FIELDS else None
        out.append({"id": uuid.uuid4().hex[:10], "field": f, "label": _WT_FIELDS[f], "value": v[:200], "why": str(p.get("why") or "")[:160],
                    "current": (str(cur)[:120] if cur else None), "status": "pending"})
    return out[:10]


def _wt_clean_facts(raw: Any) -> List[dict]:
    secs = {s[0] for s in _AM_SECTIONS}
    out = []
    for f in (raw or []):
        if not isinstance(f, dict):
            continue
        t = str(f.get("text") or "").strip()
        if len(t) < 6:
            continue
        out.append({"id": uuid.uuid4().hex[:10], "section": (f.get("section") if f.get("section") in secs else "argomenti"), "text": t[:160], "status": "pending"})
    return out[:8]


async def _wt_analyze(user: dict, text: str, image_b64: Optional[str], source: str, meta: dict) -> dict:
    profile = await db.master_profiles.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    prompt = f"Fonte: {source}. " + (f"Contenuto:\n{text[:_WT_TEXT_CAP]}" if text.strip() else "Contenuto: solo immagine allegata.")
    if not text.strip() and not image_b64:
        raise HTTPException(status_code=400, detail="Nessun contenuto da analizzare")
    try:
        data = await asyncio.wait_for(_axm_llm_json(_WT_SYSTEM, prompt, image_b64), timeout=75)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Neo sta impiegando troppo: riprova")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[wizard-talk] llm failed: %s", exc)
        raise HTTPException(status_code=502, detail="Neo non è riuscito ad analizzare il contenuto, riprova")
    proposals = _wt_clean_proposals(data.get("proposals"), profile)
    facts = _wt_clean_facts(data.get("facts"))
    entry = {"id": uuid.uuid4().hex[:10], "source": source, "at": utcnow(), "chars": len(text or ""), "summary": str(data.get("summary") or "")[:400], **meta}
    await db.axon_setup_state.update_one({"user_id": user["user_id"]}, {
        "$push": {"talk.inputs": entry, "talk.proposals": {"$each": proposals}, "talk.facts": {"$each": facts}},
        "$set": {"updated_at": utcnow()}}, upsert=True)
    return {"input": {**entry, "at": entry["at"].isoformat()}, "summary": entry["summary"], "proposals": proposals, "facts": facts, "text": (text or "")[:1200]}


class WtTextIn(BaseModel):
    text: str


class WtConfirmIn(BaseModel):
    proposal_id: Optional[str] = None
    fact_id: Optional[str] = None
    accept: bool = True


@api_router.post("/axon/setup/talk/analyze")
async def wt_analyze_text(body: WtTextIn, user=Depends(get_current_user)):
    t = (body.text or "").strip()
    if len(t) < 10:
        raise HTTPException(status_code=400, detail="Scrivi almeno una frase (10 caratteri)")
    return await _wt_analyze(user, t[:_WT_TEXT_CAP], None, "testo libero", {"kind": "text"})


@api_router.post("/axon/setup/talk/upload")
async def wt_upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    """File multipart a chunk (max 50 MB) → Master File su Object Storage + estrazione testo/vision → analisi Neo."""
    nm = (file.filename or f"file-{int(utcnow().timestamp())}").strip()[:200]
    mime = (file.content_type or "application/octet-stream").split(";")[0].strip()
    ext = _upl_ext(nm, mime)
    tmp_path, size, sha = await _upl_stream_to_temp(file, _UPL_MASTER_MAX, "." + ext)
    try:
        text, img = await _wt_extract(tmp_path, ext, mime)
        doc = await _upl_master_store(user, "files", nm, mime, tmp_path, size, sha, "Parla a Neo")  # cancella il temp
        tmp_path = None
    finally:
        if tmp_path:
            try: os.unlink(tmp_path)
            except Exception: pass  # noqa: BLE001
    if not text.strip() and not img:
        return {"input": None, "summary": "", "proposals": [], "facts": [], "file": {"file_id": doc["file_id"], "name": nm, "size": size}, "empty": True,
                "message": "Il file è stato salvato ma non contiene testo leggibile."}
    res = await _wt_analyze(user, text, img, f"file «{nm}»", {"kind": "file", "file_id": doc["file_id"], "name": nm, "size": size})
    res["file"] = {"file_id": doc["file_id"], "name": nm, "size": size, "content_url": doc.get("content_url")}
    return res


@api_router.post("/axon/setup/talk/audio")
async def wt_audio(file: UploadFile = File(...), mime: Optional[str] = Form(None), user=Depends(get_current_user)):
    """Registrazione vocale multipart (max 25 MB) → Whisper → analisi Neo."""
    eff = (mime or file.content_type or "audio/webm").split(";")[0].strip()
    path, size, _sha = await _upl_stream_to_temp(file, _UPL_AUDIO_MAX, _upl_audio_suffix(eff, file.filename or ""))
    if size < 1024:
        try: os.unlink(path)
        except Exception: pass  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Audio troppo corto o vuoto")
    try:
        transcript = await _upl_whisper_path(path)
    finally:
        try: os.unlink(path)
        except Exception: pass  # noqa: BLE001
    if len(transcript) < 5:
        raise HTTPException(status_code=400, detail="Non ho riconosciuto il parlato: riprova parlando più vicino al microfono")
    res = await _wt_analyze(user, transcript, None, "registrazione vocale", {"kind": "audio", "seconds": None, "bytes": size})
    res["transcript"] = transcript
    return res


async def _wt_apply(user: dict, p: dict) -> dict:
    uid = user["user_id"]; f = p["field"]; v = p["value"]
    if f in ("primary_email", "email"):
        prof = await db.master_profiles.find_one({"user_id": uid}, {"_id": 0, "emails": 1, "primary_email": 1}) or {}
        emails = [e for e in (prof.get("emails") or []) if e]
        if v not in emails:
            emails.append(v)
        upd = {"emails": emails[:5], "updated_at": datetime.utcnow(), "user_id": uid, "tenant_id": tenant_id(user)}
        if f == "primary_email":
            upd["primary_email"] = v
        await db.master_profiles.update_one({"user_id": uid}, {"$set": upd}, upsert=True)
    elif f == "company_name":
        await db.users.update_one({"user_id": uid}, {"$set": {"company_name": v}})
    else:
        await db.master_profiles.update_one({"user_id": uid}, {"$set": {f: v, "updated_at": datetime.utcnow(), "user_id": uid, "tenant_id": tenant_id(user)}}, upsert=True)
    return {"field": f, "value": v}


@api_router.post("/axon/setup/talk/confirm")
async def wt_confirm(body: WtConfirmIn, user=Depends(get_current_user)):
    """Un tap: applica (o scarta) una proposta o un fatto."""
    uid = user["user_id"]
    st = await db.axon_setup_state.find_one({"user_id": uid}, {"_id": 0, "talk": 1}) or {}
    talk = st.get("talk") or {}
    status = "accepted" if body.accept else "rejected"
    if body.proposal_id:
        p = next((x for x in (talk.get("proposals") or []) if x.get("id") == body.proposal_id), None)
        if not p:
            raise HTTPException(status_code=404, detail="Proposta non trovata")
        applied = await _wt_apply(user, p) if body.accept else None
        await db.axon_setup_state.update_one({"user_id": uid, "talk.proposals.id": body.proposal_id}, {"$set": {"talk.proposals.$.status": status, "updated_at": utcnow()}})
        return {"ok": True, "status": status, "applied": applied}
    if body.fact_id:
        fct = next((x for x in (talk.get("facts") or []) if x.get("id") == body.fact_id), None)
        if not fct:
            raise HTTPException(status_code=404, detail="Fatto non trovato")
        if body.accept:
            now = utcnow()
            await db.axon_user_memory.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "section": fct["section"], "text": fct["text"], "source": "wizard_talk",
                                                  "edited": True, "confidence": 1.0, "evidence": "Parla a Neo (wizard)", "created_at": now, "updated_at": now,
                                                  "sphere": _ps_guess_memory_sphere(fct["section"], fct["text"])})
        await db.axon_setup_state.update_one({"user_id": uid, "talk.facts.id": body.fact_id}, {"$set": {"talk.facts.$.status": status, "updated_at": utcnow()}})
        return {"ok": True, "status": status}
    raise HTTPException(status_code=400, detail="proposal_id o fact_id richiesto")


@api_router.get("/axon/setup/talk")
async def wt_get(user=Depends(get_current_user)):
    st = await db.axon_setup_state.find_one({"user_id": user["user_id"]}, {"_id": 0, "talk": 1}) or {}
    talk = st.get("talk") or {}
    inputs = [{**i, "at": i["at"].isoformat() if isinstance(i.get("at"), datetime) else i.get("at")} for i in (talk.get("inputs") or [])]
    return {"inputs": inputs, "proposals": talk.get("proposals") or [], "facts": talk.get("facts") or []}
