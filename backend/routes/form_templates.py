# form_templates.py — V50.z268 — Auto-compilazione moduli pre-impostati
# • Il Master carica il PDF del modulo (vuoto o esempio compilato) da dispositivo / Drive / Dropbox → «Modelli moduli».
#   Se il PDF ha campi compilabili (AcroForm) li usiamo; altrimenti Gemini vision rileva i campi su ogni pagina (bbox 0-1000)
#   e li mappa su chiavi semantiche (nome, CF, POD, IBAN, indirizzo fornitura…). Il Master può correggere chiavi/posizioni/ordine.
# • Compilazione per cliente: dati da scheda cliente + documenti di riconoscimento (OCR) + fatture (POD/PDR/fornitura)
#   + documenti allegati (visura camerale ecc. letti da Gemini e messi in cache) → valori per campo; i mancanti vengono chiesti.
# • PDF generato scrivendo i valori SUL PDF ORIGINALE (PyMuPDF) → stampa/firma/email/condivisione. Ogni valore e ogni testo
#   libero aggiunto sulla pagina è modificabile → il PDF viene rigenerato.
# Isolato: usa LlmChat/ImageContent (pattern 12), _parse_llm_json, _put_object_sync/_get_object_sync (05), tenant_scope.

import pymupdf as _pymupdf  # noqa: E402

FT_MAX_PAGES = 8
FT_MAX_PDF_B64 = 20 * 1024 * 1024

# Chiavi semantiche condivise (modulo ↔ dati cliente). label usata nell'editor del Master e nel form «dati mancanti».
FT_SEMANTIC_KEYS: Dict[str, str] = {
    "first_name": "Nome", "last_name": "Cognome", "full_name": "Nome e cognome", "sex": "Sesso", "birth_date": "Data di nascita",
    "birth_place": "Luogo di nascita", "birth_province": "Provincia di nascita", "tax_id": "Codice fiscale", "nationality": "Nazionalità",
    "residence_address": "Indirizzo di residenza", "residence_cap": "CAP residenza", "residence_city": "Comune residenza", "residence_province": "Provincia residenza",
    "phone": "Telefono", "mobile": "Cellulare", "email": "Email", "pec": "PEC",
    "doc_type": "Tipo documento", "doc_number": "Numero documento", "doc_issue_date": "Data rilascio documento", "doc_expiry_date": "Scadenza documento", "doc_issuer": "Rilasciato da",
    "company_name": "Ragione sociale", "vat_number": "Partita IVA", "company_address": "Sede legale (indirizzo)", "company_cap": "CAP sede", "company_city": "Comune sede",
    "company_province": "Provincia sede", "rea": "REA", "ateco": "Codice ATECO", "legal_rep": "Legale rappresentante", "sdi_code": "Codice destinatario SDI",
    "iban": "IBAN", "bank": "Banca",
    "supply_address": "Indirizzo di fornitura", "supply_cap": "CAP fornitura", "supply_city": "Comune fornitura", "supply_province": "Provincia fornitura",
    "pod": "POD (luce)", "pdr": "PDR (gas)", "current_supplier": "Fornitore attuale", "customer_code": "Codice cliente fornitore",
    "annual_consumption_kwh": "Consumo annuo kWh", "annual_consumption_smc": "Consumo annuo Smc", "meter_power_kw": "Potenza impegnata kW",
    "date_today": "Data (oggi)", "place_today": "Luogo (oggi)", "signature": "Firma (lasciare vuoto)", "other": "Altro / testo libero",
}

FT_DETECT_SYSTEM = (
    "Sei un analista di moduli cartacei italiani (contratti energia/gas, deleghe, privacy, adesioni). Ricevi l'immagine di UNA pagina di un modulo. "
    "Individua OGNI campo da compilare (riga, casella, spazio dopo un'etichetta, checkbox) e restituisci ESCLUSIVAMENTE un JSON: "
    '{"fields":[{"key":"<chiave>","label":"<etichetta stampata>","kind":"text|checkbox|date","bbox":[x0,y0,x1,y1],"example_value":"<valore se il modulo è un esempio già compilato, altrimenti vuoto>"}]}. '
    "bbox = rettangolo DOVE SCRIVERE IL VALORE (non l'etichetta), coordinate intere 0-1000 relative alla pagina (x da sinistra, y dall'alto). "
    "Le chiavi ammesse sono: " + ", ".join(FT_SEMANTIC_KEYS.keys()) + ". Usa 'other' se nessuna chiave corrisponde e metti in label il testo dell'etichetta. "
    "Se il modulo è un esempio compilato, i valori scritti a mano/macchina indicano ESATTAMENTE dove va il testo: usa la loro posizione come bbox e riportali in example_value. "
    "Ordina i campi nell'ordine di lettura (alto→basso, sinistra→destra). Nessun testo fuori dal JSON."
)

FT_ACRO_MAP_SYSTEM = (
    "Ricevi i nomi dei campi compilabili di un PDF (AcroForm) e le etichette vicine. Mappa ciascuno su una chiave semantica tra: "
    + ", ".join(FT_SEMANTIC_KEYS.keys()) + '. Rispondi SOLO con JSON {"map":{"<nome_campo>":"<chiave>"}} usando "other" quando non c\'è corrispondenza.'
)

FT_DOC_FACTS_SYSTEM = (
    "Estrai dati anagrafici/aziendali da un documento italiano (visura camerale, contratto, bolletta, documento d'identità, IBAN, ecc.). "
    "Restituisci SOLO un JSON piatto con le chiavi presenti tra: " + ", ".join(k for k in FT_SEMANTIC_KEYS.keys() if k not in ("date_today", "place_today", "signature", "other"))
    + ". Date in AAAA-MM-GG, codice fiscale/IBAN/POD/PDR senza spazi. Non inventare: ometti le chiavi non leggibili."
)


class FormTemplateIn(BaseModel):
    name: str
    notes: Optional[str] = ""
    pdf_base64: str
    is_filled_example: bool = False


class FormFieldIn(BaseModel):
    id: Optional[str] = None
    key: str = "other"
    label: str = ""
    kind: str = "text"
    page: int = 0
    bbox: List[float] = Field(default_factory=lambda: [0, 0, 0, 0])  # 0-1000 relativi alla pagina
    font_size: Optional[float] = None
    order: Optional[int] = None
    acro_name: Optional[str] = None
    example_value: Optional[str] = ""


class FormTemplateUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    fields: Optional[List[FormFieldIn]] = None


class FilledFormCreate(BaseModel):
    template_id: str


class ExtraTextIn(BaseModel):
    id: Optional[str] = None
    page: int = 0
    x: float = 0  # 0-1000
    y: float = 0
    text: str = ""
    font_size: float = 10


class FilledFormUpdate(BaseModel):
    values: Optional[Dict[str, str]] = None
    extra_texts: Optional[List[ExtraTextIn]] = None
    name: Optional[str] = None


def _ft_require_master(user: dict):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può gestire i modelli moduli")


def _ft_b64_to_bytes(b64: str) -> bytes:
    return base64.b64decode(b64.split(",", 1)[1] if b64.startswith("data:") else b64)


async def _ft_store_pdf(tid: str, kind: str, doc_id: str, raw: bytes) -> dict:
    try:
        path = f"{_STORAGE_APP_NAME}/forms/{tid}/{kind}_{doc_id}.pdf"
        res = await run_in_threadpool(_put_object_sync, path, raw, "application/pdf")
        if res:
            return {"pdf_path": res.get("path") or path}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[forms] object storage fallito (%s) → fallback Mongo", exc)
    return {"pdf_b64": base64.b64encode(raw).decode()}


async def _ft_load_pdf(doc: dict) -> Optional[bytes]:
    if doc.get("pdf_path"):
        got = await run_in_threadpool(_get_object_sync, doc["pdf_path"])
        if got:
            return got[0]
    if doc.get("pdf_b64"):
        return base64.b64decode(doc["pdf_b64"])
    return None


def _ft_render_pages(raw: bytes, dpi: int = 80) -> List[dict]:
    out = []
    with _pymupdf.open(stream=raw, filetype="pdf") as pdf:
        for i, page in enumerate(pdf):
            if i >= FT_MAX_PAGES:
                break
            pix = page.get_pixmap(dpi=dpi)
            out.append({"index": i, "width": page.rect.width, "height": page.rect.height, "png_b64": base64.b64encode(pix.tobytes("png")).decode()})
    return out


def _ft_acro_fields(raw: bytes) -> List[dict]:
    fields = []
    with _pymupdf.open(stream=raw, filetype="pdf") as pdf:
        for i, page in enumerate(pdf):
            if i >= FT_MAX_PAGES:
                break
            W, H = page.rect.width, page.rect.height
            for w in page.widgets() or []:
                r = w.rect
                kind = "checkbox" if w.field_type in (_pymupdf.PDF_WIDGET_TYPE_CHECKBOX, _pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON) else "text"
                fields.append({"id": f"f_{uuid.uuid4().hex[:8]}", "key": "other", "label": w.field_name or "", "kind": kind, "page": i,
                               "bbox": [round(r.x0 / W * 1000), round(r.y0 / H * 1000), round(r.x1 / W * 1000), round(r.y1 / H * 1000)],
                               "acro_name": w.field_name, "font_size": None, "example_value": ""})
    return fields


async def _ft_llm(system: str, text: str, images_b64: Optional[List[str]] = None, session: str = "ft") -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    files = [ImageContent(image_base64=b) for b in (images_b64 or [])]
    last_err = None
    for model in ("gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"):
        try:
            chat = LlmChat(api_key=key, session_id=f"{session}-{uuid.uuid4().hex[:8]}", system_message=system).with_model("gemini", model)
            resp = await chat.send_message(UserMessage(text=text, file_contents=files) if files else UserMessage(text=text))
            if resp:
                data = _parse_llm_json(resp.strip(), fallback_key="_raw")
                for k in ("parse_error", "error_message", "parse_error_kind"):
                    data.pop(k, None)
                return data
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning(f"[forms] LLM {model} failed: {e}")
    raise HTTPException(status_code=422, detail=f"Analisi AI non riuscita: {str(last_err)[:200] if last_err else 'nessuna risposta'}")


def _ft_norm_field(f: dict, order: int) -> dict:
    bbox = [float(x) for x in (f.get("bbox") or [0, 0, 0, 0])][:4]
    while len(bbox) < 4:
        bbox.append(0.0)
    bbox = [max(0.0, min(1000.0, v)) for v in bbox]
    if bbox[2] <= bbox[0]:
        bbox[2] = min(1000.0, bbox[0] + 200)
    if bbox[3] <= bbox[1]:
        bbox[3] = min(1000.0, bbox[1] + 18)
    key = str(f.get("key") or "other")
    return {"id": f.get("id") or f"f_{uuid.uuid4().hex[:8]}", "key": key if key in FT_SEMANTIC_KEYS else "other", "label": str(f.get("label") or FT_SEMANTIC_KEYS.get(key, ""))[:120],
            "kind": f.get("kind") if f.get("kind") in ("text", "checkbox", "date") else "text", "page": int(f.get("page") or 0), "bbox": bbox,
            "font_size": f.get("font_size"), "order": int(f.get("order") if f.get("order") is not None else order), "acro_name": f.get("acro_name"),
            "example_value": str(f.get("example_value") or "")[:200]}


async def _ft_detect_fields(raw: bytes, is_filled_example: bool) -> Tuple[List[dict], str]:
    acro = _ft_acro_fields(raw)
    if acro:
        names = [{"name": f["acro_name"], "page": f["page"]} for f in acro]
        try:
            m = (await _ft_llm(FT_ACRO_MAP_SYSTEM, "Campi: " + _json_stdlib.dumps(names, ensure_ascii=False), session="ft-acro")).get("map") or {}
            for f in acro:
                k = m.get(f["acro_name"])
                if k in FT_SEMANTIC_KEYS:
                    f["key"] = k
                    f["label"] = f["label"] or FT_SEMANTIC_KEYS[k]
        except HTTPException:
            pass
        return [_ft_norm_field(f, i) for i, f in enumerate(acro)], "acroform"
    fields: List[dict] = []
    pages = _ft_render_pages(raw, dpi=110)
    hint = "Questo modulo è un ESEMPIO GIÀ COMPILATO: usa i valori scritti per individuare la posizione esatta dei campi." if is_filled_example else "Questo modulo è vuoto."
    for p in pages:
        data = await _ft_llm(FT_DETECT_SYSTEM, f"Pagina {p['index'] + 1}. {hint} Restituisci il JSON dei campi.", [p["png_b64"]], session="ft-detect")
        for f in data.get("fields") or []:
            if isinstance(f, dict):
                f["page"] = p["index"]
                fields.append(_ft_norm_field(f, len(fields)))
    return fields, "ai"


def _ft_public_template(t: dict, with_fields: bool = True) -> dict:
    out = {k: v for k, v in t.items() if k not in ("_id", "pdf_b64")}
    if not with_fields:
        out.pop("fields", None)
        out.pop("pages", None)
    out["field_count"] = len(t.get("fields") or [])
    return out


@api_router.post("/form-templates")
async def form_template_create(body: FormTemplateIn, user=Depends(get_current_user)):
    _ft_require_master(user)
    if not body.pdf_base64 or len(body.pdf_base64) > FT_MAX_PDF_B64:
        raise HTTPException(status_code=400, detail="PDF mancante o troppo grande (max ~15 MB)")
    raw = _ft_b64_to_bytes(body.pdf_base64)
    try:
        with _pymupdf.open(stream=raw, filetype="pdf") as pdf:
            n_pages = pdf.page_count
            pages = [{"index": i, "width": pg.rect.width, "height": pg.rect.height} for i, pg in enumerate(pdf) if i < FT_MAX_PAGES]
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Il file non è un PDF valido")
    fields, source = await _ft_detect_fields(raw, body.is_filled_example)
    tid = tenant_id(user)
    template_id = f"ftpl_{uuid.uuid4().hex[:12]}"
    doc = {"template_id": template_id, "tenant_id": tid, "name": body.name.strip()[:120] or "Modulo", "notes": (body.notes or "").strip()[:500],
           "page_count": n_pages, "pages": pages, "fields": fields, "field_source": source, "is_filled_example": body.is_filled_example,
           "created_by": user["user_id"], "created_at": utcnow(), "updated_at": utcnow()}
    doc.update(await _ft_store_pdf(tid, "tpl", template_id, raw))
    await db.form_templates.insert_one(doc)
    return _ft_public_template(doc)


@api_router.get("/form-templates")
async def form_templates_list(user=Depends(get_current_user)):
    items = await db.form_templates.find({"tenant_id": tenant_id(user)}, {"_id": 0, "pdf_b64": 0}).sort("created_at", -1).to_list(200)
    return {"items": [_ft_public_template(t, with_fields=False) for t in items], "semantic_keys": FT_SEMANTIC_KEYS, "is_master": is_owner(user)}


@api_router.get("/form-templates/{template_id}")
async def form_template_get(template_id: str, user=Depends(get_current_user)):
    t = await db.form_templates.find_one({"template_id": template_id, "tenant_id": tenant_id(user)}, {"_id": 0, "pdf_b64": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    out = _ft_public_template(t)
    out["semantic_keys"] = FT_SEMANTIC_KEYS
    return out


@api_router.get("/form-templates/{template_id}/page/{index}")
async def form_template_page(template_id: str, index: int, user=Depends(get_current_user)):
    t = await db.form_templates.find_one({"template_id": template_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    raw = await _ft_load_pdf(t)
    if not raw:
        raise HTTPException(status_code=404, detail="PDF non disponibile")
    pages = await run_in_threadpool(_ft_render_pages, raw, 80)
    if index < 0 or index >= len(pages):
        raise HTTPException(status_code=404, detail="Pagina non trovata")
    p = pages[index]
    return {"index": index, "width": p["width"], "height": p["height"], "data_url": f"data:image/png;base64,{p['png_b64']}"}


@api_router.put("/form-templates/{template_id}")
async def form_template_update(template_id: str, body: FormTemplateUpdate, user=Depends(get_current_user)):
    _ft_require_master(user)
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.name is not None:
        upd["name"] = body.name.strip()[:120]
    if body.notes is not None:
        upd["notes"] = body.notes.strip()[:500]
    if body.fields is not None:
        upd["fields"] = [_ft_norm_field(f.model_dump(), i) for i, f in enumerate(body.fields)]
    r = await db.form_templates.update_one({"template_id": template_id, "tenant_id": tenant_id(user)}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    t = await db.form_templates.find_one({"template_id": template_id}, {"_id": 0, "pdf_b64": 0})
    return _ft_public_template(t)


@api_router.delete("/form-templates/{template_id}")
async def form_template_delete(template_id: str, user=Depends(get_current_user)):
    _ft_require_master(user)
    r = await db.form_templates.delete_one({"template_id": template_id, "tenant_id": tenant_id(user)})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    return {"ok": True}


# ---------- Dati cliente per la compilazione ----------
def _ft_first(*vals) -> str:
    for v in vals:
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


async def _ft_contact_doc_facts(user: dict, c: dict) -> Dict[str, str]:
    """Legge (una volta, poi cache) i documenti allegati alla scheda (visura camerale, IBAN, contratti…) con Gemini."""
    facts: Dict[str, str] = {}
    files = [f for f in (c.get("files") or []) if f.get("data_base64") and (str(f.get("mime", "")).startswith("image/") or "pdf" in str(f.get("mime", "")))][:6]
    for f in files:
        cached = await db.contact_doc_facts.find_one({"contact_id": c["contact_id"], "file_id": f.get("id")}, {"_id": 0, "facts": 1})
        if cached:
            facts.update({k: v for k, v in (cached.get("facts") or {}).items() if v and k not in facts})
            continue
        try:
            b64 = f["data_base64"].split(",", 1)[1] if str(f["data_base64"]).startswith("data:") else f["data_base64"]
            if "pdf" in str(f.get("mime", "")):
                pages = await run_in_threadpool(_ft_render_pages, base64.b64decode(b64), 90)
                imgs = [p["png_b64"] for p in pages[:3]]
            else:
                imgs = [b64]
            data = await _ft_llm(FT_DOC_FACTS_SYSTEM, f"Documento allegato «{f.get('name', '')}». Estrai i dati.", imgs, session="ft-facts")
            got = {k: str(v).strip() for k, v in data.items() if k in FT_SEMANTIC_KEYS and isinstance(v, (str, int, float)) and str(v).strip()}
            await db.contact_doc_facts.update_one({"contact_id": c["contact_id"], "file_id": f.get("id")}, {"$set": {"facts": got, "file_name": f.get("name"), "updated_at": utcnow()}}, upsert=True)
            facts.update({k: v for k, v in got.items() if k not in facts})
        except Exception as exc:  # noqa: BLE001
            logger.warning("[forms] lettura allegato %s fallita: %s", f.get("name"), exc)
    return facts


async def _ft_collect_contact_data(user: dict, contact_id: str, read_attachments: bool = True) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Ritorna (valori per chiave semantica, provenienza per chiave)."""
    c = await db.contacts.find_one(tenant_scope(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    vals: Dict[str, str] = {}
    src: Dict[str, str] = {}

    def put(k: str, v: Any, s: str):
        v = _ft_first(v)
        if v and k not in vals:
            vals[k] = v
            src[k] = s

    put("first_name", c.get("first_name"), "scheda"); put("last_name", c.get("last_name"), "scheda")
    put("full_name", f"{c.get('first_name', '')} {c.get('last_name', '')}".strip(), "scheda")
    put("tax_id", c.get("fiscal_code"), "scheda"); put("vat_number", c.get("vat_number"), "scheda"); put("company_name", c.get("company"), "scheda")
    put("phone", c.get("phone"), "scheda"); put("mobile", _ft_first(c.get("whatsapp"), c.get("phone_alt"), c.get("phone")), "scheda")
    put("email", c.get("email"), "scheda"); put("pec", c.get("pec"), "scheda"); put("birth_date", c.get("birth_date"), "scheda")
    addr = _ft_first(c.get("residence_address"), c.get("address"), " ".join(x for x in [c.get("address_street"), c.get("address_number")] if x))
    put("residence_address", addr, "scheda"); put("residence_cap", c.get("address_zip"), "scheda"); put("residence_city", c.get("address_city"), "scheda"); put("residence_province", c.get("address_province"), "scheda")
    put("supply_address", _ft_first(c.get("work_address"), addr), "scheda")
    # Documenti di riconoscimento (OCR)
    async for d in db.identity_documents.find({"tenant_id": tenant_id(user), "subject_type": "contact", "subject_id": contact_id}, {"_id": 0, "front_b64": 0, "back_b64": 0}).sort("created_at", -1):
        ex = d.get("extracted") or {}
        put("doc_type", IDDOC_TYPES.get(d.get("doc_type") or "", ""), "documento"); put("doc_number", d.get("document_number"), "documento")
        put("doc_expiry_date", d.get("expiry_date"), "documento"); put("doc_issue_date", _ft_first(d.get("issue_date"), ex.get("issue_date")), "documento")
        put("doc_issuer", _ft_first(d.get("issuing_authority"), ex.get("issuing_authority")), "documento")
        for k_src, k_dst in (("first_name", "first_name"), ("last_name", "last_name"), ("birth_date", "birth_date"), ("birth_place", "birth_place"), ("sex", "sex"), ("tax_id", "tax_id"), ("nationality", "nationality"), ("address", "residence_address"), ("city", "residence_city")):
            put(k_dst, ex.get(k_src), "documento")
    # Fatture (ultima luce / ultima gas)
    async for b in db.energy_bills.find({"user_id": tenant_id(user), "contact_id": contact_id}, {"_id": 0, "pdf_base64": 0}).sort("created_at", -1).limit(6):
        ex = b.get("extracted") or {}
        put("pod", ex.get("pod"), "fattura"); put("pdr", ex.get("pdr"), "fattura"); put("current_supplier", ex.get("fornitore"), "fattura"); put("customer_code", ex.get("codice_cliente"), "fattura")
        put("meter_power_kw", ex.get("potenza_impegnata_kw"), "fattura")
        if ex.get("consumo_medio_mensile_kwh"):
            try: put("annual_consumption_kwh", str(round(float(ex["consumo_medio_mensile_kwh"]) * 12)), "fattura")
            except Exception: pass  # noqa: BLE001
        if ex.get("consumo_medio_mensile_smc"):
            try: put("annual_consumption_smc", str(round(float(ex["consumo_medio_mensile_smc"]) * 12)), "fattura")
            except Exception: pass  # noqa: BLE001
        put("supply_address", _ft_first(ex.get("indirizzo_fornitura"), ex.get("supply_address")), "fattura")
    # Allegati (visura camerale, IBAN, …)
    if read_attachments:
        for k, v in (await _ft_contact_doc_facts(user, c)).items():
            put(k, v, "allegato")
    today = datetime.now(timezone.utc).astimezone().date()
    put("date_today", today.strftime("%d/%m/%Y"), "auto")
    put("place_today", _ft_first(c.get("address_city")), "auto")
    if vals.get("full_name") and not vals.get("legal_rep"):
        put("legal_rep", vals["full_name"], "scheda")
    return vals, src


def _ft_fmt_value(key: str, v: str) -> str:
    v = (v or "").strip()
    if key.endswith("_date") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        y, m, d = v.split("-")
        return f"{d}/{m}/{y}"
    return v


@api_router.get("/contacts/{contact_id}/form-data")
async def contact_form_data(contact_id: str, read_attachments: bool = True, user=Depends(get_current_user)):
    vals, src = await _ft_collect_contact_data(user, contact_id, read_attachments)
    return {"values": vals, "sources": src, "semantic_keys": FT_SEMANTIC_KEYS}


# ---------- Moduli compilati ----------
def _ft_public_form(f: dict) -> dict:
    return {k: v for k, v in f.items() if k not in ("_id", "pdf_b64")}


@api_router.post("/contacts/{contact_id}/forms")
async def filled_form_create(contact_id: str, body: FilledFormCreate, user=Depends(get_current_user)):
    t = await db.form_templates.find_one({"template_id": body.template_id, "tenant_id": tenant_id(user)}, {"_id": 0, "pdf_b64": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    vals, src = await _ft_collect_contact_data(user, contact_id, True)
    values: Dict[str, str] = {}
    sources: Dict[str, str] = {}
    missing: List[dict] = []
    for f in t.get("fields") or []:
        if f["key"] in ("signature",):
            continue
        v = vals.get(f["key"], "")
        if f["kind"] == "checkbox":
            v = ""
        if v:
            values[f["id"]] = _ft_fmt_value(f["key"], v)
            sources[f["id"]] = src.get(f["key"], "")
        elif f["key"] != "other" and f["kind"] != "checkbox":
            missing.append({"field_id": f["id"], "key": f["key"], "label": f.get("label") or FT_SEMANTIC_KEYS.get(f["key"], f["key"])})
    c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "first_name": 1, "last_name": 1})
    cname = f"{(c or {}).get('first_name', '')} {(c or {}).get('last_name', '')}".strip()
    form_id = f"ffrm_{uuid.uuid4().hex[:12]}"
    doc = {"form_id": form_id, "tenant_id": tenant_id(user), "template_id": t["template_id"], "template_name": t["name"], "contact_id": contact_id, "contact_name": cname,
           "name": f"{t['name']} — {cname}".strip(" —"), "values": values, "sources": sources, "missing": missing, "extra_texts": [],
           "created_by": user["user_id"], "created_at": utcnow(), "updated_at": utcnow()}
    await db.filled_forms.insert_one(doc)
    return _ft_public_form(doc)


@api_router.get("/contacts/{contact_id}/forms")
async def filled_forms_list(contact_id: str, user=Depends(get_current_user)):
    items = await db.filled_forms.find({"tenant_id": tenant_id(user), "contact_id": contact_id}, {"_id": 0, "pdf_b64": 0}).sort("created_at", -1).to_list(100)
    return {"items": [_ft_public_form(f) for f in items]}


async def _ft_get_form(form_id: str, user: dict) -> Tuple[dict, dict]:
    f = await db.filled_forms.find_one({"form_id": form_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Modulo non trovato")
    t = await db.form_templates.find_one({"template_id": f["template_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modello del modulo non più disponibile")
    return f, t


@api_router.get("/filled-forms/{form_id}")
async def filled_form_get(form_id: str, user=Depends(get_current_user)):
    f, t = await _ft_get_form(form_id, user)
    out = _ft_public_form(f)
    out["fields"] = t.get("fields") or []
    out["pages"] = t.get("pages") or []
    out["semantic_keys"] = FT_SEMANTIC_KEYS
    return out


@api_router.put("/filled-forms/{form_id}")
async def filled_form_update(form_id: str, body: FilledFormUpdate, user=Depends(get_current_user)):
    f, t = await _ft_get_form(form_id, user)
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.values is not None:
        upd["values"] = {str(k): str(v)[:500] for k, v in body.values.items()}
        ids_with_value = {k for k, v in upd["values"].items() if str(v).strip()}
        upd["missing"] = [m for m in (f.get("missing") or []) if m["field_id"] not in ids_with_value]
    if body.extra_texts is not None:
        upd["extra_texts"] = [{"id": e.id or f"x_{uuid.uuid4().hex[:8]}", "page": int(e.page), "x": max(0.0, min(1000.0, float(e.x))), "y": max(0.0, min(1000.0, float(e.y))),
                               "text": e.text[:500], "font_size": max(6.0, min(28.0, float(e.font_size or 10)))} for e in body.extra_texts if e.text.strip()]
    if body.name is not None:
        upd["name"] = body.name.strip()[:160]
    await db.filled_forms.update_one({"form_id": form_id}, {"$set": upd, "$unset": {"pdf_b64": ""}})
    f = await db.filled_forms.find_one({"form_id": form_id}, {"_id": 0, "pdf_b64": 0})
    return _ft_public_form(f)


@api_router.delete("/filled-forms/{form_id}")
async def filled_form_delete(form_id: str, user=Depends(get_current_user)):
    r = await db.filled_forms.delete_one({"form_id": form_id, "tenant_id": tenant_id(user)})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Modulo non trovato")
    return {"ok": True}


def _ft_render_filled(raw: bytes, t: dict, f: dict) -> bytes:
    """Scrive valori + testi liberi SUL PDF ORIGINALE (PyMuPDF). Coordinate 0-1000 → punti pagina."""
    values = f.get("values") or {}
    with _pymupdf.open(stream=raw, filetype="pdf") as pdf:
        for fld in t.get("fields") or []:
            v = (values.get(fld["id"]) or "").strip()
            if not v or fld["page"] >= pdf.page_count:
                continue
            page = pdf[fld["page"]]
            W, H = page.rect.width, page.rect.height
            x0, y0, x1, y1 = fld["bbox"]
            rect = _pymupdf.Rect(x0 / 1000 * W, y0 / 1000 * H, x1 / 1000 * W, y1 / 1000 * H)
            if fld.get("acro_name"):
                done = False
                for w in page.widgets() or []:
                    if w.field_name == fld["acro_name"]:
                        try:
                            if fld["kind"] == "checkbox":
                                w.field_value = v.lower() in ("x", "si", "sì", "true", "1", "yes", "on")
                            else:
                                w.field_value = v
                            w.update(); done = True
                        except Exception:  # noqa: BLE001
                            pass
                        break
                if done:
                    continue
            if fld["kind"] == "checkbox":
                if v.lower() in ("x", "si", "sì", "true", "1", "yes", "on"):
                    fs = max(6.0, min(rect.height * 0.9, 14.0))
                    page.insert_text(_pymupdf.Point(rect.x0 + 1, rect.y1 - (rect.height - fs) / 2 - 1), "X", fontsize=fs, fontname="helv", color=(0, 0, 0))
                continue
            fs = float(fld.get("font_size") or 0) or max(6.0, min(rect.height * 0.72, 11.0))
            r2 = _pymupdf.Rect(rect.x0 + 1, rect.y0, rect.x1 + 2, rect.y1 + 2)
            ok = page.insert_textbox(r2, v, fontsize=fs, fontname="helv", color=(0, 0, 0), align=0)
            if ok < 0:  # non entra → riduci fino a 6pt, poi scrivi comunque
                while fs > 6 and page.insert_textbox(r2, v, fontsize=fs, fontname="helv", color=(0, 0, 0)) < 0:
                    fs -= 1
                if fs <= 6:
                    page.insert_text(_pymupdf.Point(rect.x0 + 1, rect.y1 - 2), v, fontsize=6, fontname="helv", color=(0, 0, 0))
        for e in f.get("extra_texts") or []:
            if e["page"] >= pdf.page_count or not e.get("text"):
                continue
            page = pdf[e["page"]]
            W, H = page.rect.width, page.rect.height
            page.insert_text(_pymupdf.Point(e["x"] / 1000 * W, e["y"] / 1000 * H + float(e.get("font_size") or 10)), e["text"], fontsize=float(e.get("font_size") or 10), fontname="helv", color=(0, 0, 0))
        try:
            pdf.bake()  # rende definitivi i widget compilati (stampa/condivisione coerenti)
        except Exception:  # noqa: BLE001
            pass
        return pdf.tobytes(garbage=3, deflate=True)


async def _ft_filled_pdf(form_id: str, user: dict) -> Tuple[bytes, dict]:
    f, t = await _ft_get_form(form_id, user)
    if f.get("pdf_b64"):
        return base64.b64decode(f["pdf_b64"]), f
    raw = await _ft_load_pdf(t)
    if not raw:
        raise HTTPException(status_code=404, detail="PDF del modello non disponibile")
    out = await run_in_threadpool(_ft_render_filled, raw, t, f)
    if len(out) < 8 * 1024 * 1024:
        await db.filled_forms.update_one({"form_id": form_id}, {"$set": {"pdf_b64": base64.b64encode(out).decode()}})
    return out, f


@api_router.get("/filled-forms/{form_id}/pdf")
async def filled_form_pdf(form_id: str, user=Depends(get_current_user)):
    out, f = await _ft_filled_pdf(form_id, user)
    safe = re.sub(r"[^A-Za-z0-9_\- ]+", "", f.get("name") or "modulo").strip() or "modulo"
    return {"name": f"{safe}.pdf", "mime": "application/pdf", "data_base64": base64.b64encode(out).decode()}


@api_router.get("/filled-forms/{form_id}/page/{index}")
async def filled_form_page(form_id: str, index: int, user=Depends(get_current_user)):
    out, _ = await _ft_filled_pdf(form_id, user)
    pages = await run_in_threadpool(_ft_render_pages, out, 90)
    if index < 0 or index >= len(pages):
        raise HTTPException(status_code=404, detail="Pagina non trovata")
    p = pages[index]
    return {"index": index, "width": p["width"], "height": p["height"], "page_count": len(pages), "data_url": f"data:image/png;base64,{p['png_b64']}"}
