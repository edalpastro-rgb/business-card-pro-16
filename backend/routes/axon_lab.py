# axon_lab.py — V50.z343 — AXON LAB: autocompilazione contratti in due aree
# • AREA MASTER (Super Master + delegati): Fase 1 «anagrafica cliente tipo» = checklist di 12 documenti (ordine fisso) +
#   campi liberi ripetibili; ogni documento caricato viene letto da Axon e i dati mostrati campo per campo → il Master
#   approva/corregge/scarta. Fase 2 «addestramento moduli»: modulo vuoto (+ esempio compilato facoltativo) → per ogni campo
#   «Da dove prendo questo dato?» → REGOLA di mapping (fonte generale: es. bill_electric.pod), non il dato.
#   Il modello è GLOBALE per il tenant. Data e luogo NON si estraggono mai: chiesti a fine compilazione (sign_date/sign_place).
# • AREA CONSULENTE (business): cliente CRM → stessa checklist (% completamento) → estrazione → selezione moduli multipla →
#   compilazione in parallelo con le regole del Master → revisione campo per campo → data/luogo unici → PDF condivisibili.
# Riusa il motore form_templates (rilevamento campi Gemini/AcroForm, _ft_render_filled, _ft_store_pdf) e i prompt CRT.
# Ridefinisce `_ft_render_filled` (wrapper) per disegnare l'immagine del TIMBRO nei campi mappati su stamp.image.

LAB_DOCS: List[Dict[str, Any]] = [
    {"id": "id_card", "label": "Carta d'identità", "mode": "upload", "hint": "Foto o PDF (fronte/retro)"},
    {"id": "visura", "label": "Visura camerale", "mode": "upload", "hint": "PDF o foto"},
    {"id": "iban", "label": "IBAN", "mode": "manual_or_upload", "hint": "Inserimento manuale o foto/PDF", "manual_keys": ["iban", "bank"]},
    {"id": "sdi", "label": "Codice univoco / SDI", "mode": "manual_or_upload", "hint": "Inserimento manuale o foto", "manual_keys": ["sdi_code"]},
    {"id": "stamp", "label": "Timbro aziendale", "mode": "stamp", "hint": "Foto del timbro o testo manuale · replicato in tutti i campi che lo richiedono", "manual_keys": ["stamp_text"]},
    {"id": "bill_electric", "label": "Fattura energia elettrica", "mode": "upload", "hint": "PDF o foto della bolletta luce"},
    {"id": "bill_gas", "label": "Fattura gas", "mode": "upload", "hint": "PDF o foto della bolletta gas"},
    {"id": "cte", "label": "CTE / condizioni fornitore precedente", "mode": "upload", "hint": "Condizioni tecnico-economiche o contratto precedente"},
    {"id": "phone_company", "label": "Telefono fisso azienda", "mode": "manual", "hint": "Manuale o estratto dal timbro · da confermare", "derived": ("stamp", "phone"), "manual_keys": ["phone"]},
    {"id": "mobile_referent", "label": "Cellulare referente contratto", "mode": "manual", "hint": "Manuale o estratto dal timbro · da confermare", "derived": ("stamp", "mobile"), "manual_keys": ["mobile"]},
    {"id": "email_referent", "label": "Email referente", "mode": "manual", "hint": "Manuale o estratta dal timbro · da confermare", "derived": ("stamp", "email"), "manual_keys": ["email"]},
    {"id": "pec", "label": "PEC", "mode": "manual", "hint": "Estratta dalla visura camerale · da confermare", "derived": ("visura", "pec"), "manual_keys": ["pec"]},
]
LAB_DEFAULT_KEYS: Dict[str, List[str]] = {
    "id_card": ["first_name", "last_name", "birth_date", "birth_place", "sex", "tax_id", "doc_number", "doc_issue_date", "doc_expiry_date", "doc_issuer", "residence_address", "residence_cap", "residence_city", "residence_province", "nationality"],
    "visura": ["company_name", "legal_form", "vat_number", "company_tax_id", "company_address", "company_cap", "company_city", "company_province", "pec", "rea", "rea_cciaa", "ateco", "legal_rep", "legal_rep_tax_id", "legal_rep_birth", "legal_rep_role", "share_capital"],
    "iban": ["iban", "bank", "account_holder", "bic"], "sdi": ["sdi_code"],
    "stamp": ["stamp_text", "company_name", "company_address", "company_cap", "company_city", "company_province", "vat_number", "phone", "mobile", "email", "pec", "website"],
    "bill_electric": ["pod", "current_supplier", "customer_code", "supply_address", "supply_cap", "supply_city", "supply_province", "meter_power_kw", "voltage", "annual_consumption_kwh", "avg_monthly_kwh", "offer_name"],
    "bill_gas": ["pdr", "current_supplier", "customer_code", "supply_address", "supply_cap", "supply_city", "supply_province", "annual_consumption_smc", "avg_monthly_smc", "offer_name"],
    "cte": ["offer_name", "supplier", "offer_price", "offer_duration", "fixed_fee", "offer_code", "service", "previous_supplier", "previous_customer_code", "previous_contract_expiry"],
    "phone_company": ["phone"], "mobile_referent": ["mobile"], "email_referent": ["email"], "pec": ["pec"],
}
LAB_DOC_IDS = [d["id"] for d in LAB_DOCS]
LAB_DOC_BY_ID = {d["id"]: d for d in LAB_DOCS}
LAB_UPLOAD_MAX = 12 * 1024 * 1024

# Chiavi extra (non in FT_SEMANTIC_KEYS) prodotte dai documenti Axon Lab
LAB_EXTRA_KEYS: Dict[str, str] = {
    "stamp_text": "Testo del timbro", "website": "Sito web", "account_holder": "Intestatario conto", "bic": "BIC", "supplier": "Fornitore (CTE)", "fixed_fee": "Quota fissa (CTE)",
    "offer_code": "Codice offerta (CTE)", "service": "Servizio", "activation_date": "Data attivazione", "notice_days": "Giorni di preavviso", "founded_date": "Data costituzione",
    "activity_status": "Stato attività",
}
LAB_KEY_LABELS: Dict[str, str] = {**FT_SEMANTIC_KEYS, **LAB_EXTRA_KEYS}

LAB_DOC_PROMPTS: Dict[str, str] = {
    **CRT_DOC_PROMPTS,
    "bill_electric": ("Dalla BOLLETTA DELL'ENERGIA ELETTRICA estrai un JSON con: pod (14 caratteri, inizia con IT), current_supplier (fornitore), customer_code (codice cliente), supply_address (via e civico fornitura), "
                      "supply_cap, supply_city, supply_province (sigla), meter_power_kw (potenza impegnata), voltage (BT/MT), annual_consumption_kwh (consumo annuo), avg_monthly_kwh, company_name o full_name (intestatario), tax_id, vat_number, offer_name."),
    "bill_gas": ("Dalla BOLLETTA DEL GAS estrai un JSON con: pdr (14 cifre), current_supplier (fornitore), customer_code (codice cliente), supply_address, supply_cap, supply_city, supply_province (sigla), "
                 "annual_consumption_smc (consumo annuo Smc), avg_monthly_smc, company_name o full_name (intestatario), tax_id, vat_number, offer_name."),
    "stamp": ("Dalla foto del TIMBRO AZIENDALE estrai un JSON con: stamp_text (testo completo del timbro, righe separate da ' · '), company_name, company_address (via e civico), company_cap, company_city, company_province (sigla), "
              "vat_number, company_tax_id, phone (telefono fisso), mobile (cellulare), email, pec, website."),
}
LAB_SOURCE_PRIORITY = ["visura", "id_card", "phone_company", "mobile_referent", "email_referent", "pec", "stamp", "bill_electric", "bill_gas", "iban", "sdi", "cte"]
LAB_SPECIAL_SOURCES = [
    {"id": "manual", "label": "Chiedi al consulente (inserimento manuale)", "group": "Speciali"},
    {"id": "empty", "label": "Lascia vuoto", "group": "Speciali"},
    {"id": "sign_date", "label": "Data (inserita a fine compilazione)", "group": "Speciali"},
    {"id": "sign_place", "label": "Luogo (inserito a fine compilazione)", "group": "Speciali"},
    {"id": "stamp.image", "label": "Timbro aziendale (immagine o testo)", "group": "Speciali"},
]


# ------------------------------------------------------------------ modelli
class LabDocIn(BaseModel):
    name: str = "documento"
    mime: str = "application/pdf"
    data_base64: Optional[str] = None
    manual: Optional[Dict[str, Any]] = None


class LabConfirmIn(BaseModel):
    values: Dict[str, Any] = Field(default_factory=dict)
    status: str = "confirmed"  # confirmed | discarded


class LabExtraIn(BaseModel):
    id: Optional[str] = None
    label: str
    value: str = ""


class LabDelegatesIn(BaseModel):
    delegates: List[str]


class LabModuleIn(BaseModel):
    name: str
    notes: Optional[str] = ""
    pdf_base64: str
    example_pdf_base64: Optional[str] = None


class LabMappingIn(BaseModel):
    mapping: Dict[str, str]  # field_id → source id (doc.key | manual | empty | sign_date | sign_place | stamp.image | extra.<id>)
    trained: Optional[bool] = None


class LabPracticeIn(BaseModel):
    contact_id: str


class LabFillIn(BaseModel):
    template_ids: List[str]


class LabSignIn(BaseModel):
    sign_date: Optional[str] = None   # YYYY-MM-DD o DD/MM/YYYY
    sign_place: Optional[str] = None


# ------------------------------------------------------------------ accesso
async def _lab_settings(tid: str) -> dict:
    return await db.axon_lab_settings.find_one({"tenant_id": tid}, {"_id": 0}) or {"tenant_id": tid, "delegates": []}


async def _lab_can_train(user: dict) -> bool:
    if is_owner(user):
        return True
    st = await _lab_settings(tenant_id(user))
    return user["user_id"] in (st.get("delegates") or [])


async def _lab_require_train(user: dict):
    if not await _lab_can_train(user):
        raise HTTPException(status_code=403, detail="Area Addestramento riservata al Master e ai delegati Axon Lab")


@api_router.get("/lab/access")
async def lab_access(user=Depends(get_current_user)):
    can = await _lab_can_train(user)
    return {"is_master": is_owner(user), "can_train": can, "docs": LAB_DOCS, "key_labels": LAB_KEY_LABELS}


@api_router.get("/lab/delegates")
async def lab_delegates(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master gestisce i delegati")
    st = await _lab_settings(tenant_id(user))
    members = await db.users.find({"parent_user_id": user["user_id"]}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1}).to_list(500)
    return {"delegates": st.get("delegates") or [], "members": members}


@api_router.put("/lab/delegates")
async def lab_delegates_put(body: LabDelegatesIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master gestisce i delegati")
    ids = [m["user_id"] for m in await db.users.find({"parent_user_id": user["user_id"], "user_id": {"$in": body.delegates}}, {"_id": 0, "user_id": 1}).to_list(500)]
    await db.axon_lab_settings.update_one({"tenant_id": tenant_id(user)}, {"$set": {"tenant_id": tenant_id(user), "delegates": ids, "updated_at": utcnow()}}, upsert=True)
    return {"delegates": ids}


# ------------------------------------------------------------------ dossier (training + practice)
def _lab_empty_dossier() -> dict:
    return {"docs": {d: {"status": "none", "files": [], "extracted": {}, "values": {}} for d in LAB_DOC_IDS}, "extra": []}


def _lab_pub_dossier(d: dict) -> dict:
    docs = {}
    for k, e in (d.get("docs") or {}).items():
        docs[k] = {**e, "files": [{kk: vv for kk, vv in f.items() if kk not in ("pdf_b64",)} for f in (e.get("files") or [])], "has_image": bool(e.get("image_b64"))}
        docs[k].pop("image_b64", None)
    return {"docs": docs, "extra": d.get("extra") or []}


def _lab_completion(d: dict) -> dict:
    docs = d.get("docs") or {}
    confirmed = sum(1 for k in LAB_DOC_IDS if (docs.get(k) or {}).get("status") == "confirmed")
    uploaded = sum(1 for k in LAB_DOC_IDS if (docs.get(k) or {}).get("status") == "uploaded")
    return {"confirmed": confirmed, "uploaded": uploaded, "total": len(LAB_DOC_IDS), "percent": round(confirmed / len(LAB_DOC_IDS) * 100)}


async def _lab_extract(doc_type: str, name: str, mime: str, data_base64: str) -> Tuple[dict, bytes, List[str]]:
    """Legge il documento con Axon (Gemini vision / testo PDF). Ritorna (dati, bytes, immagini_b64)."""
    raw = base64.b64decode(data_base64.split(",", 1)[-1])
    if len(raw) > LAB_UPLOAD_MAX:
        raise HTTPException(status_code=413, detail="File troppo grande (max 12MB)")
    if len(raw) < 4 * 1024:
        raise HTTPException(status_code=400, detail="File troppo piccolo o illeggibile: carica una foto nitida o un PDF del documento")
    images: List[str] = []
    text = ""
    if mime == "application/pdf" or name.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
            text = "\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(raw)).pages[:6])
        except Exception:  # noqa: BLE001
            text = ""
        if len(text.strip()) < 200:
            images = [pg["png_b64"] for pg in await run_in_threadpool(_ft_render_pages, raw, 110)][:4]
    else:
        images = [base64.b64encode(raw).decode()]
    prompt = LAB_DOC_PROMPTS.get(doc_type, "Estrai in JSON tutti i dati anagrafici, fiscali e di contatto presenti.")
    prompt += "\n\nREGOLA: se il documento è illeggibile, sfocato, vuoto o non è del tipo atteso, rispondi {} (JSON vuoto). NON inventare mai dati plausibili."
    data = await _ft_llm(CRT_DOC_SYSTEM, prompt + ("\n\nTESTO DEL DOCUMENTO:\n" + text[:20000] if text.strip() else ""), images or None, session="lab-doc")
    out = {k: (str(v) if not isinstance(v, (list, dict)) else _json_stdlib.dumps(v, ensure_ascii=False)) for k, v in data.items() if v not in (None, "", []) and not k.startswith("_")}
    if doc_type == "iban" and out.get("iban"):
        out["iban"] = re.sub(r"\s+", "", out["iban"]).upper()
    if doc_type in ("bill_electric",) and out.get("pod"):
        out["pod"] = re.sub(r"\s+", "", out["pod"]).upper()
    if doc_type in ("bill_gas",) and out.get("pdr"):
        out["pdr"] = re.sub(r"\s+", "", out["pdr"])
    return out, raw, images


def _lab_apply_derived(d: dict) -> None:
    """Telefono/cellulare/email dal timbro e PEC dalla visura → proposti (status uploaded) finché non confermati."""
    docs = d["docs"]
    for spec in LAB_DOCS:
        der = spec.get("derived")
        if not der:
            continue
        src_doc, src_key = der
        tgt = docs.setdefault(spec["id"], {"status": "none", "files": [], "extracted": {}, "values": {}})
        if tgt.get("status") in ("confirmed", "discarded") or tgt.get("values"):
            continue
        src = docs.get(src_doc) or {}
        v = (src.get("values") or {}).get(src_key) or (src.get("extracted") or {}).get(src_key)
        if v:
            key = spec["manual_keys"][0]
            tgt["extracted"] = {key: v}
            tgt["status"] = "uploaded"
            tgt["derived_from"] = f"{src_doc}.{src_key}"


async def _lab_dossier_upload(store_kind: str, store_id: str, d: dict, doc_type: str, body: LabDocIn, tid: str) -> dict:
    if doc_type not in LAB_DOC_BY_ID:
        raise HTTPException(status_code=400, detail="Documento non previsto dalla checklist")
    spec = LAB_DOC_BY_ID[doc_type]
    entry = (d.get("docs") or {}).get(doc_type) or {"status": "none", "files": [], "extracted": {}, "values": {}}
    if body.data_base64:
        data, raw, images = await _lab_extract(doc_type, body.name, body.mime, body.data_base64)
        entry["extracted"] = {**(entry.get("extracted") or {}), **data}
        meta = await _ft_store_pdf(tid, f"lab_{store_kind}", f"{store_id}_{doc_type}_{uuid.uuid4().hex[:6]}", raw)
        entry["files"] = (entry.get("files") or [])[-3:] + [{**meta, "name": body.name[:120], "mime": body.mime, "size": len(raw), "uploaded_at": utcnow()}]
        if doc_type == "stamp" and images and body.mime.startswith("image/"):
            entry["image_b64"] = images[0]  # immagine del timbro replicata nei campi «stamp.image»
        entry["status"] = "uploaded"
        entry["source"] = "upload"
    if body.manual:
        man = {k: str(v)[:300] for k, v in body.manual.items() if str(v).strip()}
        if doc_type == "iban" and man.get("iban"):
            man["iban"] = re.sub(r"\s+", "", man["iban"]).upper()
        entry["extracted"] = {**(entry.get("extracted") or {}), **man}
        entry["status"] = "uploaded"
        entry["source"] = "manual"
    if not body.data_base64 and not body.manual:
        raise HTTPException(status_code=400, detail="Carica un file o inserisci i dati")
    if spec["mode"] == "manual" and not entry.get("extracted"):
        raise HTTPException(status_code=400, detail="Inserisci il dato")
    entry["updated_at"] = utcnow()
    d.setdefault("docs", {})[doc_type] = entry
    _lab_apply_derived(d)
    return entry


def _lab_dossier_confirm(d: dict, doc_type: str, body: LabConfirmIn) -> dict:
    if doc_type not in LAB_DOC_BY_ID:
        raise HTTPException(status_code=400, detail="Documento non previsto dalla checklist")
    entry = (d.get("docs") or {}).get(doc_type) or {"status": "none", "files": [], "extracted": {}, "values": {}}
    if body.status == "discarded":
        entry.update({"status": "none", "extracted": {}, "values": {}, "files": [], "image_b64": None})
        entry.pop("derived_from", None)
    else:
        entry["values"] = {k: str(v)[:300] for k, v in body.values.items() if str(v).strip()}
        entry["status"] = "confirmed"
    entry["updated_at"] = utcnow()
    d["docs"][doc_type] = entry
    _lab_apply_derived(d)
    return entry


def _lab_sources(d: dict, with_samples: bool = True) -> List[dict]:
    """Fonti disponibili per il mapping: ogni (documento, chiave) del dossier di addestramento + campi liberi + speciali."""
    out: List[dict] = []
    docs = d.get("docs") or {}
    for spec in LAB_DOCS:
        e = docs.get(spec["id"]) or {}
        keys = dict(e.get("extracted") or {})
        keys.update(e.get("values") or {})
        for k in list(spec.get("manual_keys") or []) + LAB_DEFAULT_KEYS.get(spec["id"], []):
            keys.setdefault(k, "")
        for k, v in keys.items():
            if k.endswith("_uncertain") or k in ("iban_valid",):
                continue
            out.append({"id": f"{spec['id']}.{k}", "doc": spec["id"], "key": k, "label": f"{LAB_KEY_LABELS.get(k, k)} · {spec['label']}", "group": spec["label"], "sample": (v if with_samples else "")[:80]})
    for x in d.get("extra") or []:
        out.append({"id": f"extra.{x['id']}", "doc": "extra", "key": x["id"], "label": f"{x['label']} · Campo aggiuntivo", "group": "Campi aggiuntivi", "sample": (x.get("value") or "")[:80] if with_samples else ""})
    out.extend(LAB_SPECIAL_SOURCES)
    return out


def _lab_default_rule(field: dict, sources: List[dict]) -> str:
    """Regola proposta senza esempio: chiave semantica → prima fonte (per priorità documento) che espone quella chiave."""
    key = field.get("key") or "other"
    base, row = _ft_split_key(key)
    if base == "date_today":
        return "sign_date"
    if base == "place_today":
        return "sign_place"
    if base in ("signature", "other") or field.get("kind") == "checkbox" or row >= 2:
        return "empty"
    cands = [s for s in sources if s.get("key") == base and s.get("doc") in LAB_SOURCE_PRIORITY]
    cands.sort(key=lambda s: LAB_SOURCE_PRIORITY.index(s["doc"]))
    if cands:
        return cands[0]["id"]
    # alias frequenti
    alias = {"referent_phone": "mobile", "referent_email": "email", "phone": "phone", "legal_rep": "legal_rep", "previous_supplier": "supplier", "company_tax_id": "vat_number"}
    if base in alias:
        c2 = [s for s in sources if s.get("key") == alias[base] and s.get("doc") in LAB_SOURCE_PRIORITY]
        c2.sort(key=lambda s: LAB_SOURCE_PRIORITY.index(s["doc"]))
        if c2:
            return c2[0]["id"]
    return "manual"


LAB_PROPOSE_SYSTEM = (
    "Sei Axon Lab: impari da un ESEMPIO COMPILATO come si compila un modulo. Ricevi (1) i campi del modulo vuoto (id, chiave, etichetta, pagina), "
    "(2) i campi rilevati sull'esempio compilato con il valore scritto, (3) le FONTI disponibili (id, etichetta, valore campione nel cliente tipo). "
    'Per ogni campo del modulo vuoto indica la fonte da cui prendere il dato, ragionando sul valore dell\'esempio (se il valore scritto nell\'esempio coincide con il campione di una fonte, quella è la fonte). '
    "Fonti speciali: 'empty' (campo lasciato vuoto nell'esempio), 'manual' (dato non deducibile dai documenti), 'sign_date' (una data di firma/compilazione), 'sign_place' (luogo di firma), 'stamp.image' (timbro). "
    'Rispondi SOLO con JSON {"mapping":{"<field_id>":"<source_id>"}, "notes":"<breve>"}. Usa solo source_id presenti nella lista fonti.'
)


async def _lab_propose_mapping(fields: List[dict], example_fields: Optional[List[dict]], sources: List[dict]) -> Tuple[Dict[str, str], str]:
    mapping = {f["id"]: _lab_default_rule(f, sources) for f in fields}
    if not example_fields:
        return mapping, "default"
    src_list = [{"id": s["id"], "label": s["label"], "sample": s.get("sample", "")} for s in sources]
    blank = [{"id": f["id"], "key": f["key"], "label": f.get("label", ""), "page": f["page"], "kind": f["kind"]} for f in fields]
    ex = [{"key": f["key"], "label": f.get("label", ""), "page": f["page"], "value": f.get("example_value", "")} for f in example_fields if f.get("example_value")]
    try:
        data = await _ft_llm(LAB_PROPOSE_SYSTEM, "MODULO VUOTO:\n" + _json_stdlib.dumps(blank, ensure_ascii=False) + "\n\nESEMPIO COMPILATO:\n" + _json_stdlib.dumps(ex, ensure_ascii=False)
                             + "\n\nFONTI:\n" + _json_stdlib.dumps(src_list, ensure_ascii=False), session="lab-propose")
        valid = {s["id"] for s in sources}
        got = data.get("mapping") or {}
        for fid, sid in got.items():
            if fid in mapping and sid in valid:
                mapping[fid] = sid
        return mapping, "example"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[lab] proposta mapping da esempio fallita: %s", exc)
        return mapping, "default"


# ------------------------------------------------------------------ AREA MASTER — Fase 1: cliente tipo
async def _lab_training(tid: str) -> dict:
    t = await db.axon_lab_training.find_one({"tenant_id": tid}, {"_id": 0})
    if not t:
        t = {"tenant_id": tid, **_lab_empty_dossier(), "created_at": utcnow(), "updated_at": utcnow()}
        await db.axon_lab_training.insert_one(dict(t))
    for k in LAB_DOC_IDS:
        t["docs"].setdefault(k, {"status": "none", "files": [], "extracted": {}, "values": {}})
    return t


def _lab_training_pub(t: dict) -> dict:
    return {**_lab_pub_dossier(t), "completion": _lab_completion(t), "docs_spec": LAB_DOCS, "key_labels": LAB_KEY_LABELS, "updated_at": t.get("updated_at")}


@api_router.get("/lab/training")
async def lab_training_get(user=Depends(get_current_user)):
    await _lab_require_train(user)
    return _lab_training_pub(await _lab_training(tenant_id(user)))


@api_router.post("/lab/training/docs/{doc_type}")
async def lab_training_doc_upload(doc_type: str, body: LabDocIn, user=Depends(get_current_user)):
    await _lab_require_train(user)
    tid = tenant_id(user)
    t = await _lab_training(tid)
    entry = await _lab_dossier_upload("train", tid, t, doc_type, body, tid)
    await db.axon_lab_training.update_one({"tenant_id": tid}, {"$set": {"docs": t["docs"], "updated_at": utcnow(), "updated_by": user["user_id"]}})
    pub = _lab_pub_dossier(t)
    return {"doc_type": doc_type, "entry": pub["docs"][doc_type], "docs": pub["docs"], "completion": _lab_completion(t), "extracted": entry.get("extracted") or {}}


@api_router.put("/lab/training/docs/{doc_type}")
async def lab_training_doc_confirm(doc_type: str, body: LabConfirmIn, user=Depends(get_current_user)):
    await _lab_require_train(user)
    tid = tenant_id(user)
    t = await _lab_training(tid)
    _lab_dossier_confirm(t, doc_type, body)
    await db.axon_lab_training.update_one({"tenant_id": tid}, {"$set": {"docs": t["docs"], "updated_at": utcnow(), "updated_by": user["user_id"]}})
    pub = _lab_pub_dossier(t)
    return {"doc_type": doc_type, "entry": pub["docs"][doc_type], "docs": pub["docs"], "completion": _lab_completion(t)}


@api_router.post("/lab/training/extra")
async def lab_training_extra(body: LabExtraIn, user=Depends(get_current_user)):
    await _lab_require_train(user)
    tid = tenant_id(user)
    t = await _lab_training(tid)
    extra = [x for x in (t.get("extra") or []) if x["id"] != body.id]
    extra.append({"id": body.id or f"x_{uuid.uuid4().hex[:6]}", "label": body.label.strip()[:80] or "Campo", "value": body.value.strip()[:300]})
    await db.axon_lab_training.update_one({"tenant_id": tid}, {"$set": {"extra": extra, "updated_at": utcnow()}})
    return {"extra": extra}


@api_router.delete("/lab/training/extra/{extra_id}")
async def lab_training_extra_del(extra_id: str, user=Depends(get_current_user)):
    await _lab_require_train(user)
    tid = tenant_id(user)
    t = await _lab_training(tid)
    extra = [x for x in (t.get("extra") or []) if x["id"] != extra_id]
    await db.axon_lab_training.update_one({"tenant_id": tid}, {"$set": {"extra": extra, "updated_at": utcnow()}})
    return {"extra": extra}


@api_router.get("/lab/sources")
async def lab_sources(user=Depends(get_current_user)):
    await _lab_require_train(user)
    t = await _lab_training(tenant_id(user))
    return {"sources": _lab_sources(t)}


# ------------------------------------------------------------------ AREA MASTER — Fase 2: moduli
def _lab_module_pub(t: dict, with_fields: bool = True) -> dict:
    out = _ft_public_template(t, with_fields)
    mapping = t.get("lab_mapping") or {}
    fields = t.get("fields") or []
    mapped = sum(1 for f in fields if f["id"] in mapping)
    out["mapping"] = mapping if with_fields else None
    out["mapping_count"] = mapped
    out["trained"] = bool(t.get("lab_trained"))
    out["mapping_source"] = t.get("lab_mapping_source")
    return out


@api_router.get("/lab/modules")
async def lab_modules(user=Depends(get_current_user)):
    items = await db.form_templates.find({"tenant_id": tenant_id(user), "lab": True}, {"_id": 0, "pdf_b64": 0}).sort("created_at", -1).to_list(200)
    return {"items": [_lab_module_pub(t, with_fields=False) for t in items]}


@api_router.post("/lab/modules")
async def lab_module_create(body: LabModuleIn, user=Depends(get_current_user)):
    """Modulo vuoto (+ esempio compilato facoltativo): Axon rileva i campi e PROPONE una regola per ciascuno."""
    await _lab_require_train(user)
    if not body.pdf_base64 or len(body.pdf_base64) > FT_MAX_PDF_B64:
        raise HTTPException(status_code=400, detail="PDF mancante o troppo grande (max ~15 MB)")
    raw = _ft_b64_to_bytes(body.pdf_base64)
    try:
        with _pymupdf.open(stream=raw, filetype="pdf") as pdf:
            n_pages = pdf.page_count
            pages = [{"index": i, "width": pg.rect.width, "height": pg.rect.height} for i, pg in enumerate(pdf) if i < FT_MAX_PAGES]
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Il file non è un PDF valido")
    tid = tenant_id(user)
    t = await _lab_training(tid)
    sources = _lab_sources(t)
    fields, source = await _ft_detect_fields(raw, False)
    fields = _ft_postprocess_fields(fields)
    example_fields = None
    if body.example_pdf_base64:
        try:
            ex_raw = _ft_b64_to_bytes(body.example_pdf_base64)
            example_fields, _ = await _ft_detect_fields(ex_raw, True)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[lab] esempio compilato non leggibile: %s", exc)
    mapping, msrc = await _lab_propose_mapping(fields, example_fields, sources)
    template_id = f"ftpl_{uuid.uuid4().hex[:12]}"
    doc = {"template_id": template_id, "tenant_id": tid, "name": body.name.strip()[:120] or "Modulo", "notes": (body.notes or "").strip()[:500],
           "page_count": n_pages, "pages": pages, "fields": fields, "field_source": source, "is_filled_example": False, "lab": True,
           "lab_mapping": mapping, "lab_mapping_source": msrc, "lab_trained": False, "lab_has_example": bool(example_fields),
           "created_by": user["user_id"], "created_at": utcnow(), "updated_at": utcnow()}
    doc.update(await _ft_store_pdf(tid, "tpl", template_id, raw))
    await db.form_templates.insert_one(doc)
    out = _lab_module_pub(doc)
    out["sources"] = sources
    return out


@api_router.get("/lab/modules/{template_id}")
async def lab_module_get(template_id: str, user=Depends(get_current_user)):
    t = await db.form_templates.find_one({"template_id": template_id, "tenant_id": tenant_id(user), "lab": True}, {"_id": 0, "pdf_b64": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modulo non trovato")
    out = _lab_module_pub(t)
    if await _lab_can_train(user):
        out["sources"] = _lab_sources(await _lab_training(tenant_id(user)))
    return out


@api_router.put("/lab/modules/{template_id}/mapping")
async def lab_module_mapping(template_id: str, body: LabMappingIn, user=Depends(get_current_user)):
    await _lab_require_train(user)
    tid = tenant_id(user)
    t = await db.form_templates.find_one({"template_id": template_id, "tenant_id": tid, "lab": True}, {"_id": 0, "pdf_b64": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modulo non trovato")
    ids = {f["id"] for f in t.get("fields") or []}
    valid = {s["id"] for s in _lab_sources(await _lab_training(tid), with_samples=False)}
    mapping = {fid: sid for fid, sid in body.mapping.items() if fid in ids and (sid in valid or sid.split(".")[0] in ("extra",) or sid in ("manual", "empty", "sign_date", "sign_place", "stamp.image"))}
    upd = {"lab_mapping": mapping, "updated_at": utcnow()}
    if body.trained is not None:
        upd["lab_trained"] = bool(body.trained)
    await db.form_templates.update_one({"template_id": template_id}, {"$set": upd})
    t = await db.form_templates.find_one({"template_id": template_id}, {"_id": 0, "pdf_b64": 0})
    return _lab_module_pub(t)


@api_router.delete("/lab/modules/{template_id}")
async def lab_module_delete(template_id: str, user=Depends(get_current_user)):
    await _lab_require_train(user)
    r = await db.form_templates.delete_one({"template_id": template_id, "tenant_id": tenant_id(user), "lab": True})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Modulo non trovato")
    return {"ok": True}


# ------------------------------------------------------------------ AREA CONSULENTE — pratiche
def _lab_practice_pub(p: dict) -> dict:
    out = {k: v for k, v in p.items() if k not in ("_id", "docs", "extra")}
    out.update(_lab_pub_dossier(p))
    out["completion"] = _lab_completion(p)
    return out


async def _lab_practice(practice_id: str, user: dict) -> dict:
    p = await db.axon_lab_practices.find_one({"practice_id": practice_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Pratica non trovata")
    for k in LAB_DOC_IDS:
        p.setdefault("docs", {}).setdefault(k, {"status": "none", "files": [], "extracted": {}, "values": {}})
    return p


@api_router.get("/lab/practices")
async def lab_practices(user=Depends(get_current_user)):
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if not is_owner(user):
        q["created_by"] = user["user_id"]
    items = await db.axon_lab_practices.find(q, {"_id": 0, "docs": 0, "extra": 0}).sort("updated_at", -1).to_list(200)
    return {"items": items}


@api_router.post("/lab/practices")
async def lab_practice_create(body: LabPracticeIn, user=Depends(get_current_user)):
    c = await db.contacts.find_one(tenant_scope(user, {"contact_id": body.contact_id}), {"_id": 0, "first_name": 1, "last_name": 1, "company": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    cname = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip() or c.get("company") or "Cliente"
    pid = f"lab_{uuid.uuid4().hex[:12]}"
    p = {"practice_id": pid, "tenant_id": tenant_id(user), "contact_id": body.contact_id, "contact_name": cname, "company": c.get("company") or "",
         **_lab_empty_dossier(), "template_ids": [], "form_ids": [], "sign_date": "", "sign_place": "", "status": "docs",
         "created_by": user["user_id"], "created_at": utcnow(), "updated_at": utcnow()}
    await _lab_prefill_from_contact(user, p)
    await db.axon_lab_practices.insert_one(dict(p))
    return _lab_practice_pub(p)


async def _lab_prefill_from_contact(user: dict, p: dict) -> None:
    """V50.z344 — Riuso documenti cliente: carta d'identità (identity_documents), fatture luce/gas (energy_bills) e recapiti
    della scheda precompilano la checklist come «Caricato · da confermare» (status uploaded, source scheda)."""
    docs = p["docs"]
    tid = p["tenant_id"]

    def propose(doc_id: str, data: Dict[str, Any], src: str):
        vals = {k: str(v).strip() for k, v in data.items() if v not in (None, "", [], {})}
        if not vals:
            return
        docs[doc_id] = {**docs.get(doc_id, {}), "status": "uploaded", "extracted": vals, "values": {}, "files": docs.get(doc_id, {}).get("files") or [], "source": "scheda", "reused_from": src, "updated_at": utcnow()}

    try:
        d = await db.identity_documents.find_one({"tenant_id": tid, "subject_type": "contact", "subject_id": p["contact_id"]}, {"_id": 0, "front_b64": 0, "back_b64": 0}, sort=[("created_at", -1)])
        if d:
            ex = d.get("extracted") or {}
            propose("id_card", {"first_name": ex.get("first_name"), "last_name": ex.get("last_name"), "birth_date": ex.get("birth_date"), "birth_place": ex.get("birth_place"), "sex": ex.get("sex"),
                                "tax_id": ex.get("tax_id"), "doc_number": d.get("document_number"), "doc_issue_date": d.get("issue_date") or ex.get("issue_date"), "doc_expiry_date": d.get("expiry_date"),
                                "doc_issuer": d.get("issuing_authority") or ex.get("issuing_authority"), "residence_address": ex.get("address"), "residence_city": ex.get("city"), "nationality": ex.get("nationality")}, "Documento di riconoscimento in scheda")
        async for b in db.energy_bills.find({"user_id": tid, "contact_id": p["contact_id"], "status": "done"}, {"_id": 0, "pdf_base64": 0}).sort("created_at", -1).limit(8):
            ex = b.get("extracted") or {}
            common = {"current_supplier": ex.get("fornitore"), "customer_code": ex.get("codice_cliente"), "supply_address": ex.get("indirizzo_fornitura") or ex.get("supply_address"), "offer_name": ex.get("offerta") or ex.get("offer_name")}
            if ex.get("pod") and docs["bill_electric"]["status"] == "none":
                kwh = ex.get("consumo_medio_mensile_kwh")
                propose("bill_electric", {**common, "pod": re.sub(r"\s+", "", str(ex["pod"])).upper(), "meter_power_kw": ex.get("potenza_impegnata_kw"), "voltage": ex.get("tensione"),
                                          "avg_monthly_kwh": kwh, "annual_consumption_kwh": (str(round(float(kwh) * 12)) if kwh not in (None, "") else None)}, f"Fattura luce in scheda ({b.get('pdf_name') or ''})".strip())
            if ex.get("pdr") and docs["bill_gas"]["status"] == "none":
                smc = ex.get("consumo_medio_mensile_smc")
                propose("bill_gas", {**common, "pdr": re.sub(r"\s+", "", str(ex["pdr"])), "avg_monthly_smc": smc, "annual_consumption_smc": (str(round(float(smc) * 12)) if smc not in (None, "") else None)}, f"Fattura gas in scheda ({b.get('pdf_name') or ''})".strip())
        c = await db.contacts.find_one({"contact_id": p["contact_id"]}, {"_id": 0, "pec": 1, "email": 1, "phone": 1, "whatsapp": 1, "phone_alt": 1, "iban": 1, "sdi_code": 1})
        if c:
            propose("pec", {"pec": c.get("pec")}, "Scheda cliente")
            propose("email_referent", {"email": c.get("email")}, "Scheda cliente")
            propose("mobile_referent", {"mobile": c.get("whatsapp") or c.get("phone_alt")}, "Scheda cliente")
            propose("phone_company", {"phone": c.get("phone")}, "Scheda cliente")
            propose("iban", {"iban": c.get("iban")}, "Scheda cliente")
            propose("sdi", {"sdi_code": c.get("sdi_code")}, "Scheda cliente")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[lab] prefill da scheda cliente fallito: %s", exc)


@api_router.get("/lab/practices/{practice_id}")
async def lab_practice_get(practice_id: str, user=Depends(get_current_user)):
    p = await _lab_practice(practice_id, user)
    out = _lab_practice_pub(p)
    forms = await db.filled_forms.find({"lab_practice_id": practice_id}, {"_id": 0, "pdf_b64": 0, "stamp_image_b64": 0}).to_list(50)
    out["forms"] = forms
    out["modules"] = [_lab_module_pub(t, with_fields=False) for t in await db.form_templates.find({"tenant_id": p["tenant_id"], "lab": True}, {"_id": 0, "pdf_b64": 0, "fields": 0}).to_list(200)]
    return out


@api_router.delete("/lab/practices/{practice_id}")
async def lab_practice_delete(practice_id: str, user=Depends(get_current_user)):
    p = await _lab_practice(practice_id, user)
    await db.filled_forms.delete_many({"lab_practice_id": practice_id})
    await db.axon_lab_practices.delete_one({"practice_id": p["practice_id"]})
    return {"ok": True}


@api_router.post("/lab/practices/{practice_id}/docs/{doc_type}")
async def lab_practice_doc_upload(practice_id: str, doc_type: str, body: LabDocIn, user=Depends(get_current_user)):
    p = await _lab_practice(practice_id, user)
    entry = await _lab_dossier_upload("prac", practice_id, p, doc_type, body, p["tenant_id"])
    await db.axon_lab_practices.update_one({"practice_id": practice_id}, {"$set": {"docs": p["docs"], "updated_at": utcnow()}})
    pub = _lab_pub_dossier(p)
    return {"doc_type": doc_type, "entry": pub["docs"][doc_type], "docs": pub["docs"], "completion": _lab_completion(p), "extracted": entry.get("extracted") or {}}


@api_router.put("/lab/practices/{practice_id}/docs/{doc_type}")
async def lab_practice_doc_confirm(practice_id: str, doc_type: str, body: LabConfirmIn, user=Depends(get_current_user)):
    p = await _lab_practice(practice_id, user)
    _lab_dossier_confirm(p, doc_type, body)
    await db.axon_lab_practices.update_one({"practice_id": practice_id}, {"$set": {"docs": p["docs"], "updated_at": utcnow()}})
    pub = _lab_pub_dossier(p)
    return {"doc_type": doc_type, "entry": pub["docs"][doc_type], "docs": pub["docs"], "completion": _lab_completion(p)}


def _lab_resolve(rule: str, p: dict, contact_vals: Dict[str, str], field: dict) -> Tuple[str, str, Optional[str]]:
    """Ritorna (valore, provenienza, missing_reason). Regola → dato della pratica; fallback scheda cliente."""
    base, _row = _ft_split_key(field.get("key") or "other")
    if rule == "empty":
        return "", "vuoto", None
    if rule == "manual":
        return "", "manuale", "Da inserire dal consulente"
    if rule == "sign_date":
        return _crt_fmt_sign_date(p.get("sign_date")) if p.get("sign_date") else "", "data", None
    if rule == "sign_place":
        return (p.get("sign_place") or ""), "luogo", None
    if rule == "stamp.image":
        st = (p.get("docs") or {}).get("stamp") or {}
        txt = (st.get("values") or {}).get("stamp_text") or (st.get("extracted") or {}).get("stamp_text") or ""
        return txt if not st.get("image_b64") else "", "timbro", None
    if rule.startswith("extra."):
        xid = rule.split(".", 1)[1]
        for x in p.get("extra") or []:
            if x["id"] == xid and x.get("value"):
                return x["value"], "campo aggiuntivo", None
        return "", "campo aggiuntivo", "Campo aggiuntivo non compilato"
    if "." in rule:
        doc, key = rule.split(".", 1)
        e = (p.get("docs") or {}).get(doc) or {}
        v = (e.get("values") or {}).get(key) or (e.get("extracted") or {}).get(key) or ""
        if v:
            return _ft_fmt_value(key, v), LAB_DOC_BY_ID.get(doc, {}).get("label", doc), None
        cv = contact_vals.get(base) or contact_vals.get(key) or ""
        if cv:
            return _ft_fmt_value(base, cv), "scheda cliente", None
        return "", LAB_DOC_BY_ID.get(doc, {}).get("label", doc), f"Manca «{LAB_KEY_LABELS.get(key, key)}» in {LAB_DOC_BY_ID.get(doc, {}).get('label', doc)}"
    return "", "", None


async def _lab_fill_one(p: dict, t: dict, contact_vals: Dict[str, str], user: dict) -> dict:
    mapping = t.get("lab_mapping") or {}
    sources_all = _lab_sources({"docs": p.get("docs") or {}, "extra": p.get("extra") or []}, with_samples=False)
    values: Dict[str, str] = {}
    sources: Dict[str, str] = {}
    rules: Dict[str, str] = {}
    images: Dict[str, dict] = {}
    missing: List[dict] = []
    stamp = (p.get("docs") or {}).get("stamp") or {}
    for f in t.get("fields") or []:
        rule = mapping.get(f["id"]) or _lab_default_rule(f, sources_all)
        rules[f["id"]] = rule
        if f["key"] == "signature" or f.get("skip"):
            continue
        v, src, miss = _lab_resolve(rule, p, contact_vals, f)
        if rule == "stamp.image" and stamp.get("image_b64"):
            images[f["id"]] = {"kind": "stamp"}
        if f["kind"] == "checkbox" and rule not in ("empty",) and v:
            v = _ft_cell_value(f, v) if f.get("option") else v
        if v:
            values[f["id"]] = _ft_cell_value(f, v) if f.get("char_index") is not None else v
            sources[f["id"]] = src
        elif miss:
            missing.append({"field_id": f["id"], "key": f["key"], "label": f.get("label") or LAB_KEY_LABELS.get(f["key"], f["key"]), "reason": miss})
    form_id = f"ffrm_{uuid.uuid4().hex[:12]}"
    doc = {"form_id": form_id, "tenant_id": p["tenant_id"], "template_id": t["template_id"], "template_name": t["name"], "contact_id": p["contact_id"], "contact_name": p.get("contact_name", ""),
           "name": f"{t['name']} — {p.get('contact_name', '')}".strip(" —"), "values": values, "sources": sources, "rules": rules, "images": images, "missing": missing, "extra_texts": [],
           "lab_practice_id": p["practice_id"], "created_by": user["user_id"], "created_at": utcnow(), "updated_at": utcnow()}
    if images and stamp.get("image_b64"):
        doc["stamp_image_b64"] = stamp["image_b64"]  # letto dal wrapper _ft_render_filled
    await db.filled_forms.insert_one(dict(doc))
    doc.pop("stamp_image_b64", None)
    return doc


@api_router.post("/lab/practices/{practice_id}/fill")
async def lab_practice_fill(practice_id: str, body: LabFillIn, user=Depends(get_current_user)):
    """Compila TUTTI i moduli selezionati in parallelo con le regole del Master (nessuna estrazione: dati già nel dossier)."""
    p = await _lab_practice(practice_id, user)
    tpls = await db.form_templates.find({"template_id": {"$in": body.template_ids}, "tenant_id": p["tenant_id"], "lab": True}, {"_id": 0, "pdf_b64": 0}).to_list(50)
    if not tpls:
        raise HTTPException(status_code=400, detail="Seleziona almeno un modulo addestrato")
    try:
        contact_vals, _ = await _ft_collect_contact_data(user, p["contact_id"], read_attachments=False)
    except HTTPException:
        contact_vals = {}
    # sostituisce i moduli già compilati per gli stessi modelli
    await db.filled_forms.delete_many({"lab_practice_id": practice_id, "template_id": {"$in": [t["template_id"] for t in tpls]}})
    forms = await asyncio.gather(*[_lab_fill_one(p, t, contact_vals, user) for t in tpls])
    form_ids = [f["form_id"] for f in await db.filled_forms.find({"lab_practice_id": practice_id}, {"_id": 0, "form_id": 1}).to_list(50)]
    await db.axon_lab_practices.update_one({"practice_id": practice_id}, {"$set": {"template_ids": sorted(set((p.get("template_ids") or []) + body.template_ids)), "form_ids": form_ids, "status": "review", "updated_at": utcnow()}})
    return {"forms": [{k: v for k, v in f.items() if k != "_id"} for f in forms]}


@api_router.put("/lab/practices/{practice_id}/sign")
async def lab_practice_sign(practice_id: str, body: LabSignIn, user=Depends(get_current_user)):
    """Data e luogo: UNICO inserimento per tutti i moduli aperti. Mai estratti automaticamente; se vuoti restano vuoti."""
    p = await _lab_practice(practice_id, user)
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.sign_date is not None:
        sd = body.sign_date.strip()
        m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", sd)
        if m:
            sd = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        if sd and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", sd):
            raise HTTPException(status_code=400, detail="Data non valida (usa GG/MM/AAAA)")
        upd["sign_date"] = sd
        p["sign_date"] = sd
    if body.sign_place is not None:
        upd["sign_place"] = body.sign_place.strip()[:120]
        p["sign_place"] = upd["sign_place"]
    if p.get("form_ids"):
        upd["status"] = "done"
    await db.axon_lab_practices.update_one({"practice_id": practice_id}, {"$set": upd})
    # propaga ai moduli: campi con regola sign_date / sign_place
    forms = await db.filled_forms.find({"lab_practice_id": practice_id}, {"_id": 0, "pdf_b64": 0}).to_list(50)
    for f in forms:
        vals = dict(f.get("values") or {})
        changed = False
        for fid, rule in (f.get("rules") or {}).items():
            if rule == "sign_date":
                vals[fid] = _crt_fmt_sign_date(p["sign_date"]) if p.get("sign_date") else ""; changed = True
            elif rule == "sign_place":
                vals[fid] = p.get("sign_place") or ""; changed = True
        if changed:
            vals = {k: v for k, v in vals.items() if v}
            await db.filled_forms.update_one({"form_id": f["form_id"]}, {"$set": {"values": vals, "updated_at": utcnow()}, "$unset": {"pdf_b64": ""}})
    return {"sign_date": p.get("sign_date", ""), "sign_place": p.get("sign_place", ""), "forms_updated": len(forms)}


@api_router.post("/lab/practices/{practice_id}/archive")
async def lab_practice_archive(practice_id: str, user=Depends(get_current_user)):
    """Salva tutti i PDF compilati della pratica in I miei file (master_files) e nella scheda cliente."""
    p = await _lab_practice(practice_id, user)
    forms = await db.filled_forms.find({"lab_practice_id": practice_id}, {"_id": 0, "pdf_b64": 0, "stamp_image_b64": 0}).to_list(50)
    if not forms:
        raise HTTPException(status_code=400, detail="Nessun modulo compilato")
    owner_id = p["tenant_id"]
    saved = []
    for f in forms:
        out, ff = await _ft_filled_pdf(f["form_id"], user)
        b64 = base64.b64encode(out).decode()
        safe = re.sub(r"[^A-Za-z0-9_\- ]+", "", ff.get("name") or "modulo").strip() or "modulo"
        fid = f"mf_{uuid.uuid4().hex[:12]}"
        await db.master_files.insert_one({"file_id": fid, "user_id": owner_id, "created_by": user["user_id"], "category": "files", "name": f"{safe}.pdf", "title": f"Axon Lab · {ff.get('template_name', '')}",
                                          "body": f"Contratto compilato per {p.get('contact_name', '')}", "mime": "application/pdf", "data_base64": b64, "size": len(out), "created_at": utcnow(), "updated_at": utcnow(),
                                          "source": "axon_lab", "source_practice_id": practice_id, "source_contact_id": p["contact_id"]})
        await db.contacts.update_one({"contact_id": p["contact_id"]}, {"$push": {"files": {"id": f"cf_{uuid.uuid4().hex[:10]}", "name": f"{safe}.pdf", "mime": "application/pdf", "size": len(out), "data_base64": b64, "uploaded_at": utcnow().isoformat(), "source": "axon_lab"}}})
        saved.append({"form_id": f["form_id"], "file_id": fid, "name": f"{safe}.pdf"})
    await db.axon_lab_practices.update_one({"practice_id": practice_id}, {"$set": {"archived_at": utcnow(), "status": "done", "updated_at": utcnow()}})
    return {"saved": saved}


# ------------------------------------------------------------------ rendering: timbro (immagine) nei campi stamp.image
_lab_orig_render_filled = _ft_render_filled  # noqa: F821 — definito in form_templates.py (stesso namespace)


def _ft_render_filled(raw: bytes, t: dict, f: dict) -> bytes:  # noqa: F811 — wrapper Axon Lab
    out = _lab_orig_render_filled(raw, t, f)
    images = f.get("images") or {}
    stamp_b64 = f.get("stamp_image_b64")
    if not images or not stamp_b64:
        return out
    try:
        img = base64.b64decode(stamp_b64)
        with _pymupdf.open(stream=out, filetype="pdf") as pdf:
            for fld in t.get("fields") or []:
                if fld["id"] not in images or fld["page"] >= pdf.page_count:
                    continue
                page = pdf[fld["page"]]
                W, H = page.rect.width, page.rect.height
                x0, y0, x1, y1 = fld["bbox"]
                rect = _pymupdf.Rect(x0 / 1000 * W, y0 / 1000 * H, x1 / 1000 * W, y1 / 1000 * H)
                if rect.height < 30:  # spazio timbro minimo
                    rect = _pymupdf.Rect(rect.x0, rect.y0 - 20, max(rect.x1, rect.x0 + 90), rect.y1 + 20)
                page.insert_image(rect, stream=img, keep_proportion=True, overlay=True)
            return pdf.tobytes(garbage=3, deflate=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[lab] timbro non inserito: %s", exc)
        return out
