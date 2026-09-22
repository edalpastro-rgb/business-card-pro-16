# crt_practices.py — V50.z282 — COMPILAZIONE CRT (ex Nuovo Contratto)
# Pratica = cliente + servizi (luce/gas/telco, anche insieme) + dossier documenti (estrazione Axon per tipo) +
# per servizio: fatture già analizzate → UNA FORNITURA PER FATTURA (POD/PDR) con consumo 12 mesi stimato
# (somma mesi ÷ mesi presenti × 12, min 4 mesi) → moduli compilati con RIGHE numerate (pod_1, pod_2…) e
# REPLICA automatica dello stesso modulo vuoto finché tutte le forniture sono inserite → PDF unico compresso.
# Esempi compilati: `POST /form-templates/{id}/examples` → Axon impara quali campi compilare (skip) e come.
CRT_SERVICES = ("luce", "gas", "telco")
CRT_DOC_TYPES = {"id_card": "Carta d'identità", "tax_code": "Codice fiscale / Tessera sanitaria", "visura": "Visura camerale", "iban": "IBAN (foto/PDF)", "sdi": "Codice univoco SDI / PEC",
                 "referent": "Referente contratto (cellulare + email)", "cte": "CTE offerta", "previous_contract": "Contratto precedente fornitore",
                 "visura_catastale": "Visura catastale (opzionale, volture)"}  # V50.z286
# V50.z286 — documenti «modulo» del fornitore già firmati/scannerizzati: si caricano nel dossier senza estrazione dati (solo file per il PDF unico)
CRT_FILE_ONLY_TYPES = {"sepa": "Modulo SEPA", "pda": "Proposta di adesione", "procura": "Procura/Delega"}
CRT_DOC_PROMPTS = {
    "visura_catastale": ("Estrai dalla VISURA CATASTALE un JSON con: cadastral_municipality (comune), cadastral_section, cadastral_sheet (foglio), cadastral_parcel (particella), cadastral_sub (subalterno), cadastral_category (categoria), "
                         "cadastral_class, cadastral_rent (rendita), property_address (indirizzo immobile), property_owner (intestatario), owner_tax_id. Ometti i campi assenti."),
    "visura": ("Estrai dalla VISURA CAMERALE (documento legale Registro Imprese) un JSON con: company_name (denominazione), legal_form (forma giuridica), vat_number (partita IVA 11 cifre), company_tax_id (codice fiscale azienda), "
               "company_address (via e civico sede legale), company_cap, company_city, company_province (sigla), pec, rea (numero REA), rea_cciaa (CCIAA), ateco (codice + descrizione breve), legal_rep (nome e cognome del legale rappresentante: "
               "Amministratore Unico / Presidente CdA / Titolare per ditta individuale), legal_rep_tax_id, legal_rep_birth (data e luogo), legal_rep_role (carica), share_capital, activity_status (attiva/cessata), founded_date. Ometti i campi assenti."),
    "iban": "Estrai un JSON con: iban (IBAN completo senza spazi, 27 caratteri se italiano), bank (banca), account_holder (intestatario), bic. Verifica che l'IBAN inizi con IT e abbia 27 caratteri; se dubbio metti iban_uncertain=true.",
    "tax_code": "Estrai un JSON con: tax_id (codice fiscale 16 caratteri), first_name, last_name, birth_date (DD/MM/YYYY), birth_place, sex, doc_expiry_date (scadenza tessera se presente).",
    "sdi": "Estrai un JSON con: sdi_code (codice destinatario/univoco 7 caratteri), pec, company_name, vat_number.",
    "cte": "Dalle CONDIZIONI TECNICO-ECONOMICHE estrai un JSON con: offer_name, supplier (fornitore), offer_price (prezzo energia/gas con unità, es. 0,12 €/kWh o spread), offer_duration (durata/validità), fixed_fee (quota fissa), offer_code, service (luce/gas/telco), notes (altre condizioni chiave).",
    "previous_contract": "Dal CONTRATTO DEL PRECEDENTE FORNITORE estrai un JSON con: previous_supplier, previous_customer_code (codice cliente), pod, pdr, supply_address, activation_date, previous_contract_expiry (scadenza/rinnovo), notice_days (preavviso disdetta), offer_name, service.",
    "id_card": "Estrai dalla carta d'identità un JSON con: first_name, last_name, birth_date (DD/MM/YYYY), birth_place, sex, tax_id, doc_number, doc_issue_date, doc_expiry_date, doc_issuer, residence_address, residence_cap, residence_city, residence_province, nationality.",
}
CRT_DOC_SYSTEM = "Sei un estrattore di dati da documenti italiani (PDF/foto, anche ruotati). Rispondi SOLO con JSON valido; valori come stringhe; niente testo fuori dal JSON; ometti i campi non presenti; non inventare."


class CrtPracticeIn(BaseModel):
    contact_id: str
    services: List[str] = Field(default_factory=lambda: ["luce"])
    title: Optional[str] = None


class CrtPracticeUpdate(BaseModel):
    services: Optional[List[str]] = None
    title: Optional[str] = None
    status: Optional[str] = None
    dossier_manual: Optional[Dict[str, Dict[str, Any]]] = None  # {doc_type: {campo: valore}}
    # V50.z286 — ordine documenti solo per questa pratica (override; [] = usa il predefinito), data/luogo firma (facoltativi)
    doc_order: Optional[List[str]] = None
    doc_excluded: Optional[List[str]] = None
    sign_date: Optional[str] = None   # YYYY-MM-DD | "" per azzerare (→ data di compilazione)
    sign_place: Optional[str] = None  # "" per azzerare (→ proposta da visura / città cliente)


class CrtOrderIn(BaseModel):
    doc_order: List[str]
    excluded: List[str] = Field(default_factory=list)
    custom_types: Optional[Dict[str, str]] = None  # {id: etichetta}


class CrtDossierIn(BaseModel):
    name: str = "documento"
    mime: str = "application/pdf"
    data_base64: Optional[str] = None
    manual: Optional[Dict[str, Any]] = None
    reuse_identity_doc_id: Optional[str] = None


class CrtServiceIn(BaseModel):
    bill_ids: Optional[List[str]] = None
    reuse_dossier: Optional[bool] = None
    template_ids: Optional[List[str]] = None
    supply_overrides: Optional[Dict[str, Dict[str, Any]]] = None  # {supply_id: {campo: valore}}
    extract_options: Optional[Dict[str, bool]] = None


class CrtFillIn(BaseModel):
    template_id: str


class CrtMergeIn(BaseModel):
    include_dossier: bool = True
    include_bills: Optional[bool] = None  # None = come da ordine documenti («Fatture» incluso/escluso)
    order: Optional[List[str]] = None  # ["luce","gas","telco"]


class FormExampleIn(BaseModel):
    name: str = "esempio"
    data_base64: str


def _crt_pub(p: dict) -> dict:
    out = {k: v for k, v in p.items() if k not in ("merged_pdf_b64",)}
    for dt, d in (out.get("dossier") or {}).items():
        for f in d.get("files") or []:
            f.pop("data_base64", None)
    return out


async def _crt_get(practice_id: str, user: dict) -> dict:
    p = await db.crt_practices.find_one({"practice_id": practice_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Pratica non trovata")
    return p


def _crt_months(extracted: dict, svc: str) -> List[dict]:
    key, unit = ("consumi_mensili_kwh", "kwh") if svc == "luce" else ("consumi_mensili_smc", "smc")
    out = {}
    for m in (extracted.get(key) or []):
        if isinstance(m, dict) and m.get(unit) not in (None, ""):
            try:
                out[str(m.get("mese") or len(out))] = float(m[unit])
            except (TypeError, ValueError):
                pass
    return [{"month": k, "value": v} for k, v in out.items()]


def _crt_estimate(months: List[dict], fallback_total) -> Tuple[Optional[float], str, int]:
    """Regola: 12 mesi → reale; 4-11 → somma÷n×12 (stimato); <4 → nessuna stima (fallback al totale dichiarato in fattura se c'è)."""
    n = len(months)
    tot = sum(m["value"] for m in months)
    if n >= 12:
        return round(tot), "real", n
    if n >= 4:
        return round(tot / n * 12), f"estimated_{n}m", n
    if fallback_total not in (None, ""):
        try:
            return round(float(fallback_total)), "declared", n
        except (TypeError, ValueError):
            pass
    return None, "insufficient", n


def _crt_supply_from_bill(b: dict, svc: str) -> dict:
    e = b.get("extracted") or {}
    months = _crt_months(e, svc)
    annual, method, n = _crt_estimate(months, e.get("consumo_totale_12m_kwh") if svc == "luce" else e.get("consumo_totale_12m_smc"))
    unit = "kwh" if svc == "luce" else "smc"
    volt = str(e.get("tensione") or "").lower()
    sup = {"supply_id": f"sup_{b['bill_id']}", "bill_ids": [b["bill_id"]], "bill_name": b.get("file_name") or b.get("name") or "", "service": svc,
           "pod": str(e.get("pod") or "") if svc == "luce" else "", "pdr": str(e.get("pdr") or "") if svc == "gas" else "", "line_number": str(e.get("numero_linea") or e.get("numero_telefono") or "") if svc == "telco" else "",
           "supply_address": str(e.get("indirizzo_fornitura") or e.get("supply_address") or ""), "supply_city": str(e.get("comune_fornitura") or ""), "supply_cap": str(e.get("cap_fornitura") or ""),
           "meter_power_kw": str(e.get("potenza_impegnata_kw") or e.get("potenza_disponibile_kw") or ""), "voltage": "MT" if volt.startswith("med") else ("BT" if volt else ""),
           "current_supplier": str(e.get("fornitore") or e.get("venditore") or ""), "supply_customer_code": str(e.get("codice_cliente") or ""),
           "vat_or_cf": str(e.get("partita_iva") or e.get("codice_fiscale") or ""), "months": months, "months_count": n, "annual": annual, "annual_method": method, "unit": unit,
           "avg_monthly": round(annual / 12) if annual else None, "overrides": {}}
    return sup


def _crt_merge_same_pod(supplies: List[dict]) -> List[dict]:
    """Stesso POD/PDR su più fatture → una fornitura, mesi uniti senza doppioni, stima ricalcolata."""
    by: Dict[str, dict] = {}
    for s in supplies:
        k = s["pod"] or s["pdr"] or s["line_number"] or s["supply_id"]
        if k in by:
            t = by[k]
            seen = {m["month"] for m in t["months"]}
            t["months"] += [m for m in s["months"] if m["month"] not in seen]
            t["bill_ids"] += s["bill_ids"]
            for f in ("supply_address", "meter_power_kw", "voltage", "current_supplier", "supply_customer_code", "vat_or_cf"):
                t[f] = t[f] or s[f]
            t["annual"], t["annual_method"], t["months_count"] = _crt_estimate(t["months"], None)
            t["avg_monthly"] = round(t["annual"] / 12) if t["annual"] else None
        else:
            by[k] = s
    return list(by.values())


def _crt_supply_row(s: dict) -> Dict[str, str]:
    o = s.get("overrides") or {}
    g = lambda k: str(o.get(k, s.get(k)) or "")  # noqa: E731
    annual = o.get("annual", s.get("annual"))
    row = {"pod": g("pod"), "pdr": g("pdr"), "line_number": g("line_number"), "supply_address": g("supply_address"), "supply_city": g("supply_city"), "supply_cap": g("supply_cap"),
           "meter_power_kw": g("meter_power_kw"), "voltage": g("voltage"), "current_supplier": g("current_supplier"), "supply_customer_code": g("supply_customer_code"), "customer_code": g("supply_customer_code")}
    if annual not in (None, ""):
        key = "annual_consumption_kwh" if s.get("unit") == "kwh" else "annual_consumption_smc"
        row[key] = str(int(float(annual)))
        row["avg_monthly_kwh" if s.get("unit") == "kwh" else "avg_monthly_smc"] = str(int(float(annual) / 12))
    return {k: v for k, v in row.items() if v}


def _crt_dossier_values(p: dict) -> Dict[str, str]:
    """Dossier → chiavi semantiche dei moduli (manuale prevale su estratto)."""
    vals: Dict[str, str] = {}
    for dt, d in (p.get("dossier") or {}).items():
        merged = {**(d.get("extracted") or {}), **(d.get("manual") or {})}
        for k, v in merged.items():
            if v in (None, "", [], {}) or isinstance(v, (list, dict)):
                continue
            vals[k] = str(v)
    # alias
    for a, b in (("company_tax_id", "tax_id"), ("tax_id", "company_tax_id")):
        vals.setdefault(a, vals.get(b, "")) if vals.get(b) else None
    if vals.get("referent_phone") and not vals.get("mobile"):
        vals["mobile"] = vals["referent_phone"]
    return {k: v for k, v in vals.items() if v}


async def _crt_order_settings(tenant: str) -> dict:
    """Ordine documenti del tenant: {doc_order, excluded, custom_types, source}. Fallback predefinito."""
    s = await db.crt_settings.find_one({"tenant_id": tenant}, {"_id": 0}) or {}
    custom = {k: str(v)[:60] for k, v in (s.get("custom_types") or {}).items() if str(k).startswith("custom_")}
    order = [x for x in (s.get("doc_order") or CRT_DEFAULT_ORDER) if x in CRT_ORDER_LABELS or x in custom]
    for x in CRT_DEFAULT_ORDER:  # tipologie nuove/mancanti finiscono in coda (mai perse)
        if x not in order:
            order.append(x)
    for x in custom:
        if x not in order:
            order.append(x)
    excluded = [x for x in (s.get("doc_excluded") or []) if x in order]
    return {"doc_order": order, "excluded": excluded, "custom_types": custom, "source": s.get("doc_order_source") or ("example" if s.get("example_name") else "default"), "example_name": s.get("example_name")}


def _crt_all_labels(custom: Dict[str, str]) -> Dict[str, str]:
    return {**CRT_ORDER_LABELS, **custom}


def _crt_doc_types_for(custom: Dict[str, str]) -> Dict[str, str]:
    """Tipologie caricabili nel dossier (con etichetta), in ordine di presentazione."""
    return {**CRT_DOC_TYPES, **CRT_FILE_ONLY_TYPES, **custom}


async def _crt_effective_order(p: dict) -> Tuple[List[str], List[str], Dict[str, str]]:
    """(ordine, esclusi, etichette) effettivi per la pratica: override della pratica → impostazione tenant → predefinito."""
    st = await _crt_order_settings(p["tenant_id"])
    labels = _crt_all_labels(st["custom_types"])
    if p.get("doc_order_override"):
        order = [x for x in p["doc_order_override"] if x in labels]
        for x in st["doc_order"]:
            if x not in order:
                order.append(x)
        excluded = [x for x in (p.get("doc_excluded_override") or []) if x in order]
    else:
        order, excluded = st["doc_order"], st["excluded"]
    return order, excluded, labels


def _crt_sign_place_suggested(p: dict, contact: Optional[dict]) -> str:
    """Luogo firma proposto: comune della sede legale (visura camerale) → città del cliente."""
    vis = (p.get("dossier") or {}).get("visura") or {}
    merged = {**(vis.get("extracted") or {}), **(vis.get("manual") or {})}
    city = str(merged.get("company_city") or "").strip()
    if city:
        return city
    return str((contact or {}).get("address_city") or (contact or {}).get("city") or "").strip()


def _crt_fmt_sign_date(v: Optional[str]) -> str:
    v = (v or "").strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", v)
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else ""


# ------------------------------- pratiche -------------------------------
@api_router.post("/crt")
async def crt_create(body: CrtPracticeIn, user=Depends(get_current_user)):
    c = await db.contacts.find_one(tenant_scope(user, {"contact_id": body.contact_id}), {"_id": 0, "first_name": 1, "last_name": 1, "company": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    services = [s for s in body.services if s in CRT_SERVICES] or ["luce"]
    cname = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip() or c.get("company") or "Cliente"
    doc = {"practice_id": f"crt_{uuid.uuid4().hex[:12]}", "tenant_id": tenant_id(user), "created_by": user["user_id"], "contact_id": body.contact_id, "contact_name": cname,
           "title": body.title or f"CRT {cname} – {'+'.join(s.capitalize() for s in services)}", "services": services, "status": "bozza",
           "dossier": {}, "per_service": {s: {"bill_ids": [], "supplies": [], "template_ids": [], "filled_form_ids": [], "reuse_dossier": True} for s in services},
           "merged_pdf": None, "created_at": utcnow(), "updated_at": utcnow()}
    await db.crt_practices.insert_one(doc)
    return _crt_pub({k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/crt")
async def crt_list(contact_id: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if contact_id:
        q["contact_id"] = contact_id
    if not is_owner(user):
        q["created_by"] = user["user_id"]
    items = await db.crt_practices.find(q, {"_id": 0, "dossier": 0, "merged_pdf_b64": 0}).sort("updated_at", -1).to_list(300)
    st = await _crt_order_settings(tenant_id(user))
    return {"items": items, "doc_types": _crt_doc_types_for(st["custom_types"])}


@api_router.get("/crt/{practice_id}")
async def crt_get(practice_id: str, user=Depends(get_current_user)):
    p = await _crt_get(practice_id, user)
    # documenti di riconoscimento già in scheda → proposti
    ids = await db.identity_documents.find({"contact_id": p["contact_id"]}, {"_id": 0, "doc_id": 1, "doc_type": 1, "extracted": 1, "expiry_date": 1}).to_list(20)
    bills = await db.energy_bills.find({"contact_id": p["contact_id"], "status": "done"}, {"_id": 0, "bill_id": 1, "bill_type": 1, "file_name": 1, "created_at": 1, "extracted.pod": 1, "extracted.pdr": 1, "extracted.fornitore": 1}).sort("created_at", -1).to_list(600)
    forms = await db.filled_forms.find({"practice_id": practice_id}, {"_id": 0, "form_id": 1, "name": 1, "service": 1, "part": 1, "parts": 1, "missing": 1, "updated_at": 1}).to_list(200)
    c = await db.contacts.find_one({"contact_id": p["contact_id"]}, {"_id": 0, "address_city": 1, "city": 1})
    order, excluded, labels = await _crt_effective_order(p)
    st = await _crt_order_settings(p["tenant_id"])
    return {**_crt_pub(p), "doc_types": _crt_doc_types_for(st["custom_types"]), "available_identity_docs": ids, "available_bills": bills, "filled_forms": forms,
            "doc_order_effective": order, "doc_excluded_effective": excluded, "doc_order_labels": labels, "doc_order_is_override": bool(p.get("doc_order_override")),
            "sign_place_suggested": _crt_sign_place_suggested(p, c), "sign_date_effective": _crt_fmt_sign_date(p.get("sign_date")) or utcnow().astimezone().strftime("%d/%m/%Y")}


@api_router.put("/crt/{practice_id}")
async def crt_update(practice_id: str, body: CrtPracticeUpdate, user=Depends(get_current_user)):
    p = await _crt_get(practice_id, user)
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.services is not None:
        services = [s for s in body.services if s in CRT_SERVICES] or ["luce"]
        upd["services"] = services
        ps = p.get("per_service") or {}
        for s in services:
            ps.setdefault(s, {"bill_ids": [], "supplies": [], "template_ids": [], "filled_form_ids": [], "reuse_dossier": True})
        upd["per_service"] = ps
    if body.title is not None:
        upd["title"] = body.title.strip()[:160]
    if body.status in ("bozza", "completa", "inviata", "attivata", "ko"):
        upd["status"] = body.status
    if body.dossier_manual:
        for dt, vals in body.dossier_manual.items():
            if dt in CRT_DOC_TYPES:
                upd[f"dossier.{dt}.manual"] = {k: str(v)[:300] for k, v in vals.items()}
                upd[f"dossier.{dt}.confirmed"] = True
    # V50.z286 — ordine documenti solo per questa pratica ([] → torna al predefinito), data e luogo firma (mai vincolanti)
    if body.doc_order is not None:
        st = await _crt_order_settings(p["tenant_id"])
        labels = _crt_all_labels(st["custom_types"])
        upd["doc_order_override"] = [x for x in body.doc_order if x in labels][:60]
        upd["doc_excluded_override"] = [x for x in (body.doc_excluded or []) if x in labels][:60]
    elif body.doc_excluded is not None and p.get("doc_order_override"):
        upd["doc_excluded_override"] = [x for x in body.doc_excluded][:60]
    if body.sign_date is not None:
        sd = body.sign_date.strip()
        if sd and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", sd):
            raise HTTPException(status_code=400, detail="Data firma non valida (YYYY-MM-DD)")
        upd["sign_date"] = sd
    if body.sign_place is not None:
        upd["sign_place"] = body.sign_place.strip()[:120]
    await db.crt_practices.update_one({"practice_id": practice_id}, {"$set": upd})
    return _crt_pub(await _crt_get(practice_id, user))


@api_router.delete("/crt/{practice_id}")
async def crt_delete(practice_id: str, user=Depends(get_current_user)):
    await _crt_get(practice_id, user)
    await db.crt_practices.delete_one({"practice_id": practice_id})
    await db.filled_forms.delete_many({"practice_id": practice_id})
    return {"ok": True}


# ------------------------------- dossier -------------------------------
@api_router.post("/crt/{practice_id}/dossier/{doc_type}")
async def crt_dossier_upload(practice_id: str, doc_type: str, body: CrtDossierIn, user=Depends(get_current_user)):
    """Carica (telefono/Drive/Dropbox → base64) un documento del dossier: Axon estrae i dati; oppure riusa un documento d'identità già in scheda; oppure solo dati manuali."""
    p = await _crt_get(practice_id, user)
    st = await _crt_order_settings(p["tenant_id"])
    if doc_type not in _crt_doc_types_for(st["custom_types"]):
        raise HTTPException(status_code=400, detail="Tipo documento non valido")
    file_only = doc_type not in CRT_DOC_TYPES  # SEPA/PdA/procura/personalizzati: solo file, nessuna estrazione
    entry = (p.get("dossier") or {}).get(doc_type) or {"files": [], "extracted": {}, "manual": {}, "confirmed": False}
    if body.reuse_identity_doc_id:
        d = await db.identity_documents.find_one({"doc_id": body.reuse_identity_doc_id, "contact_id": p["contact_id"]}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Documento non trovato in scheda")
        entry["extracted"] = {k: str(v) for k, v in (d.get("extracted") or {}).items() if v not in (None, "")}
        entry["source"] = "scheda"
    if body.data_base64:
        raw = base64.b64decode(body.data_base64.split(",", 1)[-1])
        if len(raw) > 12 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File troppo grande (max 12MB)")
        if len(raw) < 4 * 1024:  # V50.z332 — immagine/PDF minuscolo = illeggibile: Axon inventerebbe i dati
            raise HTTPException(status_code=400, detail="File troppo piccolo o illeggibile: carica una foto nitida o un PDF del documento")
        images: List[str] = []
        text = ""
        if body.mime == "application/pdf" or body.name.lower().endswith(".pdf"):
            try:
                from pypdf import PdfReader
                text = "\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(raw)).pages[:6])
            except Exception:  # noqa: BLE001
                text = ""
            if len(text.strip()) < 200:
                images = [pg["png_b64"] for pg in _ft_render_pages(raw, dpi=110)[:4]]
        else:
            images = [base64.b64encode(raw).decode()]
        if doc_type != "referent" and not file_only:
            prompt = CRT_DOC_PROMPTS.get(doc_type, "Estrai in JSON tutti i dati anagrafici, fiscali e di contatto presenti.")
            prompt += "\n\nREGOLA: se il documento è illeggibile, sfocato, vuoto o non è del tipo atteso, rispondi {} (JSON vuoto). NON inventare mai dati plausibili."
            data = await _ft_llm(CRT_DOC_SYSTEM, prompt + ("\n\nTESTO DEL DOCUMENTO:\n" + text[:20000] if text.strip() else ""), images or None, session="crt-dossier")
            entry["extracted"] = {**entry.get("extracted", {}), **{k: (str(v) if not isinstance(v, (list, dict)) else json.dumps(v, ensure_ascii=False)) for k, v in data.items() if v not in (None, "", [])}}
            if doc_type == "iban" and entry["extracted"].get("iban"):
                ib = re.sub(r"\s+", "", entry["extracted"]["iban"]).upper()
                entry["extracted"]["iban"] = ib
                entry["extracted"]["iban_valid"] = "sì" if (ib.startswith("IT") and len(ib) == 27) else "da verificare"
        meta = await _ft_store_pdf(p["tenant_id"], "crt", f"{practice_id}_{doc_type}_{uuid.uuid4().hex[:6]}", raw)
        entry["files"] = (entry.get("files") or [])[-4:] + [{**meta, "name": body.name[:120], "mime": body.mime, "size": len(raw), "uploaded_at": utcnow()}]
        entry["source"] = "upload"
    if body.manual:
        entry["manual"] = {**entry.get("manual", {}), **{k: str(v)[:300] for k, v in body.manual.items()}}
        entry["confirmed"] = True
    entry["updated_at"] = utcnow()
    await db.crt_practices.update_one({"practice_id": practice_id}, {"$set": {f"dossier.{doc_type}": entry, "updated_at": utcnow()}})
    return {"doc_type": doc_type, "entry": {**entry, "files": [{k: v for k, v in f.items() if k != "data_b64"} for f in entry.get("files") or []]}}


# ------------------------------- servizi / forniture -------------------------------
@api_router.put("/crt/{practice_id}/services/{svc}")
async def crt_service_update(practice_id: str, svc: str, body: CrtServiceIn, user=Depends(get_current_user)):
    """Collega fatture (già analizzate dal caricatore) → una fornitura per fattura; override manuali; modelli scelti."""
    if svc not in CRT_SERVICES:
        raise HTTPException(status_code=400, detail="Servizio non valido")
    p = await _crt_get(practice_id, user)
    ps = (p.get("per_service") or {}).get(svc) or {"bill_ids": [], "supplies": [], "template_ids": [], "filled_form_ids": [], "reuse_dossier": True}
    if body.bill_ids is not None:
        bills = await db.energy_bills.find({"bill_id": {"$in": body.bill_ids}, "contact_id": p["contact_id"], "status": "done"}, {"_id": 0}).to_list(600)
        prev = {s["supply_id"]: s.get("overrides") or {} for s in ps.get("supplies") or []}
        sups = _crt_merge_same_pod([_crt_supply_from_bill(b, svc) for b in bills])
        for s in sups:
            s["overrides"] = prev.get(s["supply_id"], {})
        ps["bill_ids"], ps["supplies"] = [b["bill_id"] for b in bills], sups
    if body.supply_overrides:
        for s in ps.get("supplies") or []:
            if s["supply_id"] in body.supply_overrides:
                s["overrides"] = {**(s.get("overrides") or {}), **{k: v for k, v in body.supply_overrides[s["supply_id"]].items()}}
    if body.reuse_dossier is not None:
        ps["reuse_dossier"] = bool(body.reuse_dossier)
    if body.template_ids is not None:
        ps["template_ids"] = body.template_ids[:10]
    if body.extract_options is not None:
        ps["extract_options"] = body.extract_options
    sups = ps.get("supplies") or []
    ps["totals"] = {"supplies_count": len(sups), "annual_sum": sum((s.get("overrides") or {}).get("annual", s.get("annual")) or 0 for s in sups),
                    "estimated_count": sum(1 for s in sups if str(s.get("annual_method", "")).startswith("estimated")), "insufficient_count": sum(1 for s in sups if s.get("annual_method") == "insufficient" and not (s.get("overrides") or {}).get("annual"))}
    await db.crt_practices.update_one({"practice_id": practice_id}, {"$set": {f"per_service.{svc}": ps, "updated_at": utcnow()}})
    return {"service": svc, **ps}


@api_router.post("/crt/{practice_id}/services/{svc}/fill")
async def crt_service_fill(practice_id: str, svc: str, body: CrtFillIn, user=Depends(get_current_user)):
    """Compila il modello: dati fissi (scheda + dossier) + righe fornitura numerate; REPLICA lo stesso modulo finché tutte le forniture sono inserite."""
    p = await _crt_get(practice_id, user)
    t = await db.form_templates.find_one({"template_id": body.template_id, "tenant_id": p["tenant_id"]}, {"_id": 0, "pdf_b64": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    ps = (p.get("per_service") or {}).get(svc) or {}
    base_vals, base_src = await _ft_collect_contact_data(user, p["contact_id"], True)
    fixed = {**base_vals, **_crt_dossier_values(p)}
    src = {**base_src, **{k: "dossier CRT" for k in _crt_dossier_values(p)}}
    # V50.z286 — data firma scelta (retroattiva/posticipata) e luogo firma (manuale → visura → città cliente)
    sd = _crt_fmt_sign_date(p.get("sign_date"))
    if sd:
        fixed["date_today"] = sd; src["date_today"] = "data firma pratica"
    c_row = await db.contacts.find_one({"contact_id": p["contact_id"]}, {"_id": 0, "address_city": 1, "city": 1})
    place = (p.get("sign_place") or "").strip() or _crt_sign_place_suggested(p, c_row)
    if place:
        fixed["place_today"] = place; src["place_today"] = "luogo firma pratica" if p.get("sign_place") else "visura/scheda"
    rows = [_crt_supply_row(s) for s in (ps.get("supplies") or [])]
    fields = [f for f in (t.get("fields") or []) if not f.get("skip") and f["key"] != "signature"]
    rows_per_form = max([_ft_split_key(f["key"])[1] for f in fields] + [0])
    if rows_per_form == 0 and rows:
        fixed = {**fixed, **rows[0]}  # modulo senza tabella: prima fornitura nei campi singoli
        chunks = [rows[:1]]
    else:
        chunks = [rows[i:i + rows_per_form] for i in range(0, len(rows), rows_per_form)] if rows and rows_per_form else [[]]
    # rimuove compilazioni precedenti dello stesso modello per questo servizio
    await db.filled_forms.delete_many({"practice_id": practice_id, "service": svc, "template_id": t["template_id"]})
    created = []
    for part, chunk in enumerate(chunks, start=1):
        values, sources, missing = {}, {}, []
        for f in fields:
            base, row = _ft_split_key(f["key"])
            if f["kind"] == "checkbox" and not f.get("option"):
                continue
            v = ""
            if row >= 1:
                v = (chunk[row - 1].get(base, "") if row - 1 < len(chunk) else "")
                if not v and row - 1 >= len(chunk):
                    continue  # riga vuota oltre le forniture: non è un dato mancante
            else:
                v = fixed.get(f["key"], "") or fixed.get(base, "")
            if v:
                cv = _ft_cell_value(f, _ft_fmt_value(base, v))
                if cv:
                    values[f["id"]] = cv
                    sources[f["id"]] = ("fattura" if row >= 1 else src.get(base, src.get(f["key"], "")))
            elif base != "other" and f.get("char_index") in (None, 0) and not f.get("option"):
                missing.append({"field_id": f["id"], "key": f["key"], "label": f.get("label") or FT_SEMANTIC_KEYS.get(base, base)})
        form_id = f"ffrm_{uuid.uuid4().hex[:12]}"
        name = f"{t['name']} — {p['contact_name']} · {svc.capitalize()}" + (f" · modulo {part} di {len(chunks)}" if len(chunks) > 1 else "")
        doc = {"form_id": form_id, "tenant_id": p["tenant_id"], "template_id": t["template_id"], "template_name": t["name"], "contact_id": p["contact_id"], "contact_name": p["contact_name"],
               "practice_id": practice_id, "service": svc, "part": part, "parts": len(chunks), "supplies_in_part": len(chunk), "name": name, "values": values, "sources": sources, "missing": missing,
               "extra_texts": [], "created_by": user["user_id"], "created_at": utcnow(), "updated_at": utcnow()}
        await db.filled_forms.insert_one(doc)
        created.append({"form_id": form_id, "name": name, "part": part, "parts": len(chunks), "missing": len(missing), "supplies": len(chunk)})
    fids = [c["form_id"] for c in created]
    await db.crt_practices.update_one({"practice_id": practice_id}, {"$set": {f"per_service.{svc}.filled_form_ids": fids, "updated_at": utcnow()}, "$addToSet": {f"per_service.{svc}.template_ids": t["template_id"]}})
    return {"forms": created, "rows_per_form": rows_per_form, "supplies": len(rows), "copies": len(chunks)}


# ------------------------------- PDF unico -------------------------------
@api_router.post("/crt/{practice_id}/merge")
async def crt_merge(practice_id: str, body: CrtMergeIn, user=Depends(get_current_user)):
    """Unisce moduli compilati (ordine servizi) + documenti dossier (+ fatture) in un PDF compresso con indice."""
    p = await _crt_get(practice_id, user)
    order_svc = [s for s in (body.order or p["services"]) if s in p["services"]] or p["services"]
    doc_order, excluded, labels = await _crt_effective_order(p)
    out = _pymupdf.open()
    toc: List[str] = []

    async def _add_form(svc: str) -> None:
        for fid in ((p.get("per_service") or {}).get(svc) or {}).get("filled_form_ids") or []:
            try:
                raw, f = await _ft_filled_pdf(fid, user)
                src = _pymupdf.open(stream=raw, filetype="pdf"); toc.append(f"{svc.capitalize()} · {f['name']} (pag. {len(out) + 2})"); out.insert_pdf(src); src.close()
            except Exception as e:  # noqa: BLE001
                logger.warning("[CRT] merge form %s: %s", fid, e)

    async def _add_dossier(dt: str) -> None:
        d = (p.get("dossier") or {}).get(dt) or {}
        for fm in (d.get("files") or [])[-1:]:
            raw = await _ft_load_pdf(fm)
            if not raw:
                continue
            try:
                if (fm.get("mime") or "").startswith("image/"):
                    img = _pymupdf.open(stream=raw, filetype="image"); pdfb = img.convert_to_pdf(); img.close(); src = _pymupdf.open("pdf", pdfb)
                else:
                    src = _pymupdf.open(stream=raw, filetype="pdf")
                toc.append(f"{labels.get(dt, dt)} (pag. {len(out) + 2})"); out.insert_pdf(src); src.close()
            except Exception as e:  # noqa: BLE001
                logger.warning("[CRT] merge dossier %s: %s", dt, e)

    async def _add_bills() -> None:
        bids = [b for svc in order_svc for b in (((p.get("per_service") or {}).get(svc) or {}).get("bill_ids") or [])]
        for b in await db.energy_bills.find({"bill_id": {"$in": bids}}, {"_id": 0, "file_b64": 1, "data_base64": 1, "file_name": 1, "mime": 1}).to_list(600):
            raw_b64 = b.get("file_b64") or b.get("data_base64")
            if not raw_b64:
                continue
            try:
                src = _pymupdf.open(stream=base64.b64decode(raw_b64), filetype="pdf"); toc.append(f"Fattura {b.get('file_name', '')} (pag. {len(out) + 2})"); out.insert_pdf(src); src.close()
            except Exception:  # noqa: BLE001
                pass

    # V50.z286 — il PDF unico segue l'ORDINE DOCUMENTI effettivo (predefinito / override pratica), saltando le tipologie escluse
    bills_wanted = body.include_bills if body.include_bills is not None else ("bills" in doc_order and "bills" not in excluded)
    for key in doc_order:
        if key in excluded:
            continue
        if key.startswith("form_"):
            svc = key[5:]
            if svc in order_svc:
                await _add_form(svc)
        elif key == "bills":
            if bills_wanted:
                await _add_bills()
        elif body.include_dossier:
            await _add_dossier(key)
    for svc in order_svc:  # moduli di servizi non presenti nell'ordine (sicurezza: nessun modulo compilato viene perso)
        if f"form_{svc}" not in doc_order:
            await _add_form(svc)
    order = order_svc
    if len(out) == 0:
        raise HTTPException(status_code=400, detail="Nessun documento da unire: compila prima i moduli")
    # indice in prima pagina
    idx = out.new_page(pno=0, width=595, height=842)
    idx.insert_text((50, 70), p["title"], fontsize=18, fontname="helv", color=(0.42, 0.13, 0.66))
    idx.insert_text((50, 95), f"Cliente: {p['contact_name']} · Servizi: {', '.join(s.capitalize() for s in order)} · {utcnow().astimezone().strftime('%d/%m/%Y')}", fontsize=10, fontname="helv", color=(0.3, 0.3, 0.3))
    y = 130
    for line in toc[:45]:
        idx.insert_text((50, y), f"• {line}", fontsize=10.5, fontname="helv"); y += 16
    for pg in out:  # compressione immagini pesanti
        for img in pg.get_images(full=True):
            try:
                xref = img[0]
                if out.extract_image(xref).get("width", 0) > 1600:
                    pix = _pymupdf.Pixmap(out, xref)
                    pix = _pymupdf.Pixmap(pix, 0) if pix.alpha else pix
                    pix.shrink(1); pg.replace_image(xref, pixmap=pix)
            except Exception:  # noqa: BLE001
                pass
    raw = out.tobytes(garbage=4, deflate=True, deflate_images=True, clean=True)
    out.close()
    safe = re.sub(r"[^A-Za-z0-9_\- ]+", "", p["title"]).strip() or "CRT"
    meta = await _ft_store_pdf(p["tenant_id"], "crt_merged", practice_id, raw)
    info = {**{k: v for k, v in meta.items() if k != "data_b64"}, "name": f"{safe}.pdf", "size": len(raw), "pages": len(toc) + 1, "created_at": utcnow(), "too_big": len(raw) > 10 * 1024 * 1024}
    await db.crt_practices.update_one({"practice_id": practice_id}, {"$set": {"merged_pdf": info, "status": "completa" if p.get("status") == "bozza" else p.get("status"), "updated_at": utcnow()}})
    # copia negli allegati del cliente (sostituisce la precedente)
    await db.contacts.update_one({"contact_id": p["contact_id"]}, {"$pull": {"files": {"crt_practice_id": practice_id}}})
    await db.contacts.update_one({"contact_id": p["contact_id"]}, {"$push": {"files": {"id": f"file_{uuid.uuid4().hex[:12]}", "name": info["name"], "mime": "application/pdf", "size": len(raw), "created_at": utcnow(), "data_base64": base64.b64encode(raw).decode() if len(raw) < 4 * 1024 * 1024 else "", "crt_practice_id": practice_id}}})
    return {"merged_pdf": info, "data_base64": base64.b64encode(raw).decode(), "mime": "application/pdf", "name": info["name"]}


@api_router.get("/crt/{practice_id}/merged")
async def crt_merged_download(practice_id: str, user=Depends(get_current_user)):
    p = await _crt_get(practice_id, user)
    if not p.get("merged_pdf"):
        raise HTTPException(status_code=404, detail="PDF non ancora generato")
    raw = await _ft_load_pdf(p["merged_pdf"])
    if not raw:
        raise HTTPException(status_code=404, detail="PDF non disponibile")
    return {"name": p["merged_pdf"]["name"], "mime": "application/pdf", "data_base64": base64.b64encode(raw).decode()}


# ------------------------------- V50.z326 — Autocompilazione CRT: campi da estrarre + salva nel database Master -------------------------------
CRT_EXTRACT_PRESETS = [
    {"key": "full_name", "label": "Nome e cognome"}, {"key": "tax_code", "label": "Codice fiscale"}, {"key": "vat_number", "label": "Partita IVA"},
    {"key": "address", "label": "Indirizzo / sede"}, {"key": "iban", "label": "IBAN"}, {"key": "birth", "label": "Data e luogo di nascita"},
    {"key": "id_document", "label": "Numero e scadenza documento"}, {"key": "phone", "label": "Telefono"}, {"key": "email", "label": "Email"},
    {"key": "pod_pdr", "label": "POD / PDR"}, {"key": "company_name", "label": "Ragione sociale"}, {"key": "rea", "label": "REA / registro imprese"},
]


class CrtExtractIn(BaseModel):
    fields: List[str] = Field(default_factory=list)
    custom_fields: List[str] = Field(default_factory=list)
    sign_place_date_everywhere: bool = True
    notes: Optional[str] = ""


@api_router.get("/crt/settings/extract")
async def crt_extract_get(user=Depends(get_current_user)):
    s = await db.crt_settings.find_one({"tenant_id": tenant_id(user)}, {"_id": 0, "extract": 1}) or {}
    ex = s.get("extract") or {}
    return {"presets": CRT_EXTRACT_PRESETS, "fields": ex.get("fields") or [p["key"] for p in CRT_EXTRACT_PRESETS[:5]],
            "custom_fields": ex.get("custom_fields") or [], "sign_place_date_everywhere": ex.get("sign_place_date_everywhere", True), "notes": ex.get("notes") or ""}


@api_router.put("/crt/settings/extract")
async def crt_extract_put(body: CrtExtractIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può impostare i campi da estrarre")
    ex = {"fields": [f for f in body.fields if f][:40], "custom_fields": [c.strip()[:60] for c in body.custom_fields if c.strip()][:20],
          "sign_place_date_everywhere": body.sign_place_date_everywhere, "notes": (body.notes or "").strip()[:500], "updated_at": utcnow()}
    await db.crt_settings.update_one({"tenant_id": tenant_id(user)}, {"$set": {"extract": ex, "tenant_id": tenant_id(user)}}, upsert=True)
    return {"ok": True, **ex}


@api_router.post("/crt/{practice_id}/save-master")
async def crt_save_master(practice_id: str, user=Depends(get_current_user)):
    """Copia il PDF unico della pratica nel database Master (master_files, categoria files)."""
    p = await _crt_get(practice_id, user)
    if not p.get("merged_pdf"):
        raise HTTPException(status_code=404, detail="Genera prima il PDF unico")
    raw = await _ft_load_pdf(p["merged_pdf"])
    if not raw:
        raise HTTPException(status_code=404, detail="PDF non disponibile")
    b64 = base64.b64encode(raw).decode()
    owner_id = user.get("parent_user_id") or user["user_id"]
    fid = f"mf_{uuid.uuid4().hex[:12]}"
    await db.master_files.insert_one({"file_id": fid, "user_id": owner_id, "created_by": user["user_id"], "category": "files", "name": p["merged_pdf"]["name"],
                                      "title": f"CRT · {p.get('title') or ''}".strip(), "body": f"Pratica CRT di {p.get('contact_name') or ''}", "mime": "application/pdf",
                                      "data_base64": b64, "size": len(raw), "created_at": utcnow(), "updated_at": utcnow(), "source": "crt", "source_practice_id": practice_id})
    await db.crt_practices.update_one({"practice_id": practice_id}, {"$set": {"saved_master_file_id": fid, "saved_master_at": utcnow()}})
    return {"ok": True, "file_id": fid, "name": p["merged_pdf"]["name"]}
@api_router.post("/form-templates/{template_id}/examples")
async def form_template_example(template_id: str, body: FormExampleIn, user=Depends(get_current_user)):
    """Zona esempi: carica un modulo COMPILATO d'esempio. Axon confronta con i campi del modello e impara:
    quali campi restano vuoti (skip), esempi di valore/formato, righe forniture usate."""
    _ft_require_master(user)
    t = await db.form_templates.find_one({"template_id": template_id, "tenant_id": tenant_id(user)}, {"_id": 0, "pdf_b64": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Modello non trovato")
    raw = _ft_b64_to_bytes(body.data_base64)
    pages = _ft_render_pages(raw, dpi=90)[:8]
    fields = t.get("fields") or []
    listing = "\n".join(f"- id={f['id']} key={f['key']} label={f.get('label', '')} page={f.get('page', 0)} bbox={[int(x) for x in f['bbox']]}" for f in fields)
    data = await _ft_llm(
        "Sei un assistente che confronta un MODULO COMPILATO d'esempio con l'elenco dei campi di un modello. Rispondi SOLO JSON: "
        "{\"fields\": [{\"id\": \"<id campo>\", \"filled\": true|false, \"example_value\": \"testo scritto nell'esempio o vuoto\", \"note\": \"eventuale regola (es. formato data, maiuscolo, abbreviazione)\"}], "
        "\"rules\": [\"regole generali osservate, es. 'la PEC va nel campo Email', 'firma e data lasciati al cliente'\"]}",
        "Campi del modello (bbox 0-1000 normalizzati per pagina):\n" + listing + "\n\nPer OGNI campo indica se nell'esempio è compilato (filled) e con quale valore. I campi vuoti nell'esempio vanno lasciati vuoti anche nelle compilazioni future (skip).",
        [pg["png_b64"] for pg in pages], session="ft-example")
    learned = {str(x.get("id")): x for x in (data.get("fields") or []) if isinstance(x, dict)}
    n_skip = 0
    for f in fields:
        l = learned.get(f["id"])
        if not l:
            continue
        if l.get("filled") is False and f["key"] not in ("signature",):
            f["skip"] = True; n_skip += 1
        elif l.get("filled") is True:
            f["skip"] = False
            if l.get("example_value"):
                f["example_value"] = str(l["example_value"])[:200]
        if l.get("note"):
            f["note"] = str(l["note"])[:200]
    ex = {"example_id": f"fex_{uuid.uuid4().hex[:8]}", "name": body.name[:120], "uploaded_at": utcnow(), "skipped": n_skip, "rules": [str(r)[:200] for r in (data.get("rules") or [])][:10]}
    await db.form_templates.update_one({"template_id": template_id}, {"$set": {"fields": fields, "updated_at": utcnow()}, "$push": {"examples": {"$each": [ex], "$slice": -5}}})
    return {"example": ex, "fields": fields, "skipped": n_skip, "rules": ex["rules"]}


# ------------------------------- esempio pratica completa → ordine documenti -------------------------------
CRT_ORDER_LABELS = {"form_luce": "Modulo Luce", "form_gas": "Modulo Gas", "form_telco": "Modulo Telco", "sepa": "Modulo SEPA", "procura": "Procura/Delega", "pda": "Proposta di adesione",
                    **CRT_DOC_TYPES, "bills": "Fatture", "other": "Altro"}
CRT_DEFAULT_ORDER = ["form_luce", "form_gas", "form_telco", "sepa", "pda", "procura", "id_card", "tax_code", "visura", "visura_catastale", "iban", "sdi", "cte", "previous_contract", "bills"]


class CrtOrderExampleIn(BaseModel):
    name: str = "esempio pratica"
    data_base64: str


@api_router.post("/crt/dossier-example")
async def crt_dossier_example(body: CrtOrderExampleIn, user=Depends(get_current_user)):
    """Master carica un CONTRATTO COMPLETO d'esempio (PDF con tutti i documenti in ordine): Axon riconosce la sequenza dei documenti e la salva come ordine standard del PDF unico."""
    _ft_require_master(user)
    raw = _ft_b64_to_bytes(body.data_base64)
    try:
        pages = _ft_render_pages(raw, dpi=60)[:30]
    except Exception:
        pages = []
    if not pages:  # V50.z332 — file non leggibile (PDF corrotto/vuoto) → 400 chiaro invece di 500
        raise HTTPException(status_code=400, detail="File non leggibile: carica un PDF (o immagine) valido della pratica completa")
    data = await _ft_llm(
        "Classifica ogni pagina di una pratica contrattuale energia/telco italiana. Rispondi SOLO JSON: {\"pages\": [{\"page\": 1, \"type\": \"<tipo>\"}], \"order\": [\"<tipi in ordine di prima comparsa, senza ripetizioni>\"]}. "
        "Tipi ammessi: " + ", ".join(CRT_ORDER_LABELS.keys()) + ". form_luce/form_gas/form_telco = moduli contratto del fornitore; sepa = mandato SEPA; pda = proposta di adesione; procura = procura/delega; "
        "id_card, tax_code, visura, iban, sdi, cte, previous_contract, bills come da nome; other se non riconoscibile.",
        f"La pratica ha {len(pages)} pagine (immagini in ordine).", [pg["png_b64"] for pg in pages], session="crt-order")
    order = [t for t in (data.get("order") or []) if t in CRT_ORDER_LABELS]
    seen = set(); order = [t for t in order if not (t in seen or seen.add(t))]
    if not order:
        raise HTTPException(status_code=422, detail="Non sono riuscito a riconoscere i documenti: riprova con una scansione più leggibile")
    doc = {"tenant_id": tenant_id(user), "doc_order": order, "doc_order_source": "example", "example_name": body.name[:120], "pages": [p for p in (data.get("pages") or []) if isinstance(p, dict)][:60], "updated_at": utcnow()}
    await db.crt_settings.update_one({"tenant_id": tenant_id(user)}, {"$set": doc}, upsert=True)
    return {"doc_order": order, "labels": {k: CRT_ORDER_LABELS[k] for k in order}, "pages": doc["pages"]}


@api_router.get("/crt/settings/order")
async def crt_order_get(user=Depends(get_current_user)):
    st = await _crt_order_settings(tenant_id(user))
    labels = _crt_all_labels(st["custom_types"])
    return {"doc_order": st["doc_order"], "excluded": st["excluded"], "custom_types": st["custom_types"], "labels": labels, "source": st["source"],
            "from_example": st["source"] == "example", "example_name": st["example_name"], "default_order": CRT_DEFAULT_ORDER}


@api_router.put("/crt/settings/order")
async def crt_order_put(body: CrtOrderIn, user=Depends(get_current_user)):
    """V50.z286 — Master: salva l'ordine predefinito dei documenti (riordino manuale), le tipologie escluse e quelle personalizzate."""
    _ft_require_master(user)
    custom = {}
    for k, v in (body.custom_types or {}).items():
        k = str(k).strip(); v = str(v).strip()
        if not v:
            continue
        if not k.startswith("custom_"):
            k = "custom_" + re.sub(r"[^a-z0-9]+", "_", v.lower()).strip("_")[:30]
        custom[k] = v[:60]
    labels = _crt_all_labels(custom)
    order: List[str] = []
    for x in body.doc_order:
        if x in labels and x not in order:
            order.append(x)
    for x in CRT_DEFAULT_ORDER + list(custom):
        if x not in order:
            order.append(x)
    excluded = [x for x in body.excluded if x in order]
    await db.crt_settings.update_one({"tenant_id": tenant_id(user)}, {"$set": {"doc_order": order, "doc_excluded": excluded, "custom_types": custom, "doc_order_source": "manual", "updated_at": utcnow()}}, upsert=True)
    return await crt_order_get(user)


@api_router.delete("/crt/settings/order")
async def crt_order_reset(user=Depends(get_current_user)):
    """V50.z286 — Ripristina l'ordine predefinito (mantiene le tipologie personalizzate)."""
    _ft_require_master(user)
    await db.crt_settings.update_one({"tenant_id": tenant_id(user)}, {"$set": {"doc_order": CRT_DEFAULT_ORDER, "doc_excluded": [], "doc_order_source": "default", "updated_at": utcnow()}, "$unset": {"example_name": "", "pages": ""}}, upsert=True)
    return await crt_order_get(user)


# ------------------------------- condivisione rapida: link firmato + QR code -------------------------------
@api_router.post("/crt/{practice_id}/share-link")
async def crt_share_link(practice_id: str, request: Request, days: int = 7, user=Depends(get_current_user)):
    """Link pubblico firmato (scade in N giorni, default 7) + QR code PNG: chi lo scansiona scarica direttamente il PDF unico."""
    p = await _crt_get(practice_id, user)
    if not p.get("merged_pdf"):
        raise HTTPException(status_code=400, detail="Genera prima il PDF unico")
    exp_dt = utcnow() + timedelta(days=max(1, min(30, days)))
    token = jwt.encode({"kind": "crt", "practice_id": practice_id, "user_id": user["user_id"], "exp": int(exp_dt.timestamp())}, JWT_SECRET, algorithm=JWT_ALG)
    fwd_proto = request.headers.get("x-forwarded-proto"); fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    base = f"{fwd_proto}://{fwd_host}" if fwd_proto and fwd_host else str(request.base_url).rstrip("/")
    url = f"{base.rstrip('/')}/api/public/crt/{token}"
    import qrcode
    img = qrcode.make(url, box_size=8, border=2)
    buf = io.BytesIO(); img.save(buf, format="PNG")
    await db.crt_practices.update_one({"practice_id": practice_id}, {"$set": {"share": {"url": url, "expires_at": exp_dt, "created_at": utcnow()}, "updated_at": utcnow()}})
    return {"url": url, "expires_at": exp_dt.isoformat(), "qr_png_base64": base64.b64encode(buf.getvalue()).decode(), "name": p["merged_pdf"]["name"]}


@api_router.get("/public/crt/{token}")
async def crt_public_download(token: str):
    """Download pubblico del PDF unico (nessun login): pagina di cortesia + file. Usato dal QR code."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        return HTMLResponse("<h3 style='font-family:sans-serif'>Link scaduto. Chiedi al consulente un nuovo QR code.</h3>", status_code=410)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Link non valido")
    if payload.get("kind") != "crt":
        raise HTTPException(status_code=400, detail="Token non compatibile")
    p = await db.crt_practices.find_one({"practice_id": payload.get("practice_id")}, {"_id": 0, "merged_pdf": 1, "title": 1})
    raw = await _ft_load_pdf(p["merged_pdf"]) if p and p.get("merged_pdf") else None
    if not raw:
        raise HTTPException(status_code=404, detail="Documento non disponibile")
    await db.crt_practices.update_one({"practice_id": payload.get("practice_id")}, {"$inc": {"share.downloads": 1}, "$set": {"share.last_download_at": utcnow()}})
    return Response(content=raw, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename=\"{p['merged_pdf']['name']}\""})
