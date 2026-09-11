# 17_company_offers_docs.py — Offerte azienda/confronto + Comunica con l'azienda (documenti)
# Estratto da server.py (righe originali 9760-10360). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Company Offers + Comparison (V25.b)
# Each user (tenant owner) can upload company offer PDFs (luce/gas/telco). AI extracts
# offer parameters, then the /bills/comparison endpoint compares any client's bill vs an offer.
# =========================

class CompanyOfferIn(BaseModel):
    bill_type: str  # luce | gas | telco
    pdf_base64: Optional[str] = None
    pdf_name: Optional[str] = None
    pdf_mime: Optional[str] = "application/pdf"
    label: Optional[str] = None  # short label like "Offerta Fibra 24m"
    manual_text: Optional[str] = None  # V26.q: testo condizioni economiche inserito manualmente


COMPANY_OFFER_PROMPT = """Sei un analista esperto di offerte commerciali italiane per energia elettrica, gas e telecomunicazioni.
Analizza il testo estratto dal documento delle CONDIZIONI ECONOMICHE di un'offerta commerciale e restituisci ESCLUSIVAMENTE un JSON valido.

Schema atteso (ometti chiavi mancanti):
{
  "fornitore": "Nome azienda che propone l'offerta",
  "tipo": "luce" | "gas" | "telco",
  "nome_offerta": "es. Placet Fisso Business",
  "tipologia_prezzo": "fisso" | "variabile" | "indicizzato",
  "durata_contratto_mesi": 24,
  "prezzo_energia_eur_kwh": 0.13,
  "prezzo_gas_eur_smc": 0.38,
  "spread_eur_kwh": 0.008,
  "spread_eur_smc": 0.015,
  "quota_fissa_mensile_eur": 5.0,
  "costo_mensile_eur": 24.90,
  "costo_annuale_eur": 298.80,
  "penale_uscita_anticipata_eur": 0,
  "servizi_extra": ["..."],
  "condizioni_particolari": ["..."],
  "target_cliente": "residenziale" | "business" | "misto",
  "note_ai": ["punto 1", "punto 2"]
}"""


async def _llm_analyze_offer_text(text: str) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise Exception("EMERGENT_LLM_KEY non configurato")
    chat = LlmChat(
        api_key=key,
        session_id=f"offer-{uuid.uuid4().hex[:8]}",
        system_message=COMPANY_OFFER_PROMPT,
    ).with_model("anthropic", "claude-sonnet-5")
    snippet = text[:18000]
    resp = await chat.send_message(UserMessage(text=f"Testo delle condizioni economiche:\n\n{snippet}"))
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing
    return _parse_llm_json(raw, fallback_key="note_ai")


async def _analyze_offer_task(offer_id: str):
    o = await db.company_offers.find_one({"offer_id": offer_id})
    if not o:
        return
    try:
        await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {"status": "analyzing"}})
        # V26.q: se abbiamo manual_text usiamo quello, altrimenti estraiamo dal PDF
        if o.get("manual_text"):
            text = o["manual_text"]
        elif o.get("pdf_base64"):
            text = _extract_pdf_text(o["pdf_base64"])
        else:
            text = ""
        if not text or len(text.strip()) < 20:
            await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {
                "status": "error",
                "error_message": "Testo vuoto o troppo corto (min 20 caratteri) per essere analizzato dall'AI.",
                "analyzed_at": utcnow(),
            }})
            return
        extracted = await _llm_analyze_offer_text(text)
        await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {
            "status": "done",
            "extracted": extracted,
            "analyzed_at": utcnow(),
            "error_message": None,
        }})
    except Exception as e:
        logger.exception(f"offer analysis failed for {offer_id}: {e}")
        await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {
            "status": "error",
            "error_message": str(e)[:400],
            "analyzed_at": utcnow(),
        }})


@api_router.post("/company-offers")
async def create_company_offer(body: CompanyOfferIn, background: BackgroundTasks, user=Depends(get_current_user)):
    if body.bill_type not in BILL_TYPES:
        raise HTTPException(status_code=400, detail=f"bill_type non valido: usa {BILL_TYPES}")
    if not body.pdf_base64 and not body.manual_text:
        raise HTTPException(status_code=400, detail="Fornisci un PDF (pdf_base64) o un testo manuale (manual_text)")
    b64 = body.pdf_base64 or ""
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    approx = int(len(b64) * 0.75) if b64 else 0
    if approx > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF troppo grande (max ~12 MB)")
    offer_id = f"offer_{uuid.uuid4().hex[:12]}"
    doc = {
        "offer_id": offer_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": body.bill_type,
        "label": body.label or f"Offerta {body.bill_type}",
        "pdf_base64": body.pdf_base64 or None,
        "pdf_name": body.pdf_name or (f"offerta-{body.bill_type}.pdf" if body.pdf_base64 else f"offerta-manuale-{body.bill_type}.txt"),
        "pdf_mime": body.pdf_mime or "application/pdf",
        "pdf_size": approx,
        "manual_text": body.manual_text or None,  # V26.q
        "source": "pdf" if body.pdf_base64 else "manual",
        "status": "pending",
        "extracted": None,
        "error_message": None,
        "created_at": utcnow(),
        "analyzed_at": None,
    }
    await db.company_offers.insert_one(doc)
    background.add_task(_analyze_offer_task, offer_id)
    strip_id(doc)
    doc.pop("pdf_base64", None)
    return doc


@api_router.get("/company-offers")
async def list_company_offers(user=Depends(get_current_user)):
    items = await db.company_offers.find(
        {"user_id": tenant_id(user)},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(50)
    grouped: Dict[str, List[Dict[str, Any]]] = {"luce": [], "gas": [], "telco": []}
    for it in items:
        bt = it.get("bill_type") or "luce"
        grouped.setdefault(bt, []).append(it)
    return {"items": items, "grouped": grouped}


@api_router.get("/company-offers/{offer_id}/pdf")
async def get_offer_pdf(offer_id: str, user=Depends(get_current_user)):
    o = await db.company_offers.find_one({"user_id": tenant_id(user), "offer_id": offer_id}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Offerta non trovata")
    return {"pdf_base64": o.get("pdf_base64"), "pdf_name": o.get("pdf_name"), "pdf_mime": o.get("pdf_mime")}


@api_router.delete("/company-offers/{offer_id}")
async def delete_company_offer(offer_id: str, user=Depends(get_current_user)):
    r = await db.company_offers.delete_one({"user_id": tenant_id(user), "offer_id": offer_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Offerta non trovata")
    return {"ok": True}


@api_router.post("/company-offers/{offer_id}/reanalyze")
async def reanalyze_offer(offer_id: str, background: BackgroundTasks, user=Depends(get_current_user)):
    o = await db.company_offers.find_one({"user_id": tenant_id(user), "offer_id": offer_id})
    if not o:
        raise HTTPException(status_code=404, detail="Offerta non trovata")
    await db.company_offers.update_one({"offer_id": offer_id}, {"$set": {"status": "pending", "error_message": None}})
    background.add_task(_analyze_offer_task, offer_id)
    return {"ok": True, "status": "pending"}


# =========================================================================
# V49 — Company Documents (Comunica con l'azienda)
#
# PDF aziendali caricati dal Master e visibili a tutti gli utenti del tenant.
# Include un endpoint AI (Claude Sonnet 5) che estrae automaticamente i contatti
# aziendali (nome, ruolo, email, telefono) dal testo del PDF così il Master può
# aggiungerli al pannello con un tocco.
# =========================================================================
class CompanyDocIn(BaseModel):
    name: str
    mime: Optional[str] = "application/pdf"
    file_base64: str


def _is_tenant_master(u: dict) -> bool:
    return not u.get("parent_user_id") and (u.get("role") or "member") == "owner"


@api_router.post("/company-docs")
async def upload_company_doc(body: CompanyDocIn, user=Depends(get_current_user)):
    if not _is_tenant_master(user):
        raise HTTPException(status_code=403, detail="Solo il Master può caricare documenti aziendali")
    b64 = body.file_base64 or ""
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    if not b64:
        raise HTTPException(status_code=400, detail="File mancante")
    approx = int(len(b64) * 0.75)
    if approx > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF troppo grande (max ~12 MB)")
    doc_id = f"cdoc_{uuid.uuid4().hex[:12]}"
    doc = {
        "doc_id": doc_id,
        "tenant_id": tenant_id(user),
        "created_by": user["user_id"],
        "name": (body.name or "documento.pdf").strip()[:200],
        "mime": body.mime or "application/pdf",
        "size": approx,
        "file_base64": b64,
        "created_at": utcnow(),
    }
    await db.company_documents.insert_one(doc)
    # Return metadata only (no base64) to keep the response light
    return {
        "doc_id": doc_id,
        "name": doc["name"],
        "mime": doc["mime"],
        "size": approx,
        "created_at": doc["created_at"].isoformat(),
    }


@api_router.get("/company-docs")
async def list_company_docs(user=Depends(get_current_user)):
    """List company docs for the tenant. Every tenant user can list (they must
    be able to open PDFs from the 'Comunica con l'azienda' panel)."""
    tid = tenant_id(user)
    cursor = db.company_documents.find(
        {"tenant_id": tid},
        {"_id": 0, "file_base64": 0},
    ).sort("created_at", -1)
    items = [d async for d in cursor]
    for it in items:
        v = it.get("created_at")
        if hasattr(v, "isoformat"):
            it["created_at"] = v.isoformat()
    return {"items": items, "total": len(items)}


@api_router.get("/company-docs/{doc_id}/file")
async def get_company_doc_file(doc_id: str, user=Depends(get_current_user)):
    """Return the base64 file for viewing. Any tenant user can download."""
    tid = tenant_id(user)
    doc = await db.company_documents.find_one({"doc_id": doc_id, "tenant_id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    return {
        "doc_id": doc_id,
        "name": doc.get("name"),
        "mime": doc.get("mime", "application/pdf"),
        "size": doc.get("size"),
        "file_base64": doc.get("file_base64", ""),
    }


@api_router.delete("/company-docs/{doc_id}")
async def delete_company_doc(doc_id: str, user=Depends(get_current_user)):
    if not _is_tenant_master(user):
        raise HTTPException(status_code=403, detail="Solo il Master può eliminare documenti aziendali")
    tid = tenant_id(user)
    r = await db.company_documents.delete_one({"doc_id": doc_id, "tenant_id": tid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    return {"ok": True}


@api_router.post("/company-docs/{doc_id}/extract-contacts")
async def extract_company_contacts(doc_id: str, user=Depends(get_current_user)):
    """Ask Claude Sonnet 5 to read the PDF and extract company contacts.

    Returns a list of {label, name, role, email, phone} entries that the Master
    can review/append to the "Comunica con l'azienda" panel. Only the Master can
    trigger extraction (LLM cost + tenant-config action)."""
    if not _is_tenant_master(user):
        raise HTTPException(status_code=403, detail="Solo il Master può usare Axon sui documenti aziendali")
    tid = tenant_id(user)
    doc = await db.company_documents.find_one({"doc_id": doc_id, "tenant_id": tid})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    file_b64 = doc.get("file_base64") or ""
    if not file_b64:
        raise HTTPException(status_code=400, detail="Documento senza contenuto")

    # 1) Extract text from PDF
    try:
        text = _extract_pdf_text(file_b64)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[company-docs] pdf extract failed: %s", exc)
        raise HTTPException(status_code=400, detail="Impossibile leggere il PDF")
    text = (text or "").strip()
    if len(text) < 20:
        raise HTTPException(status_code=400, detail="Nessun testo utile trovato nel PDF")

    # 2) Ask Claude Sonnet 5 for structured contact extraction
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    system = (
        "Sei un assistente che estrae contatti aziendali da testi/PDF italiani. "
        "Analizza il testo fornito e restituisci ESCLUSIVAMENTE un JSON valido, senza markdown, "
        "senza commenti, con la seguente struttura:\n"
        '{ "contacts": [ { "name": "Mario Rossi", "role": "Assistenza Consulenti", '
        '"email": "assistenza@azienda.it", "phone": "+39 02 1234 5678" } ] }\n'
        "Regole:\n"
        "- Includi SOLO contatti con almeno UN campo tra email e phone valorizzato.\n"
        "- `role` (opzionale) è il ruolo/reparto/etichetta (es. 'Assistenza Clienti', 'Segreteria', 'Direzione').\n"
        "- Se un contatto non ha nome ma ha un ruolo/reparto, usa il ruolo come `name`.\n"
        "- Normalizza i numeri di telefono in formato leggibile (mantieni prefisso +39 se presente).\n"
        "- Deduplica per email + numero.\n"
        "- Se non trovi contatti restituisci {\"contacts\": []}.\n"
    )
    chat = LlmChat(
        api_key=key,
        session_id=f"company-doc-extract-{doc_id[:8]}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-5")
    snippet = text[:16000]
    try:
        raw = await chat.send_message(UserMessage(
            text=f"Testo del PDF aziendale:\n\n{snippet}"
        ))
    except Exception as exc:
        logger.warning("[company-docs] LLM error: %s", exc)
        raise HTTPException(status_code=502, detail="Errore chiamando Axon (Claude)")

    parsed = _parse_llm_json((raw or "").strip(), fallback_key="contacts_raw")
    contacts_raw = parsed.get("contacts") if isinstance(parsed, dict) else None
    if not isinstance(contacts_raw, list):
        contacts_raw = []

    # 3) Sanitize + normalize output
    import re as _re
    def _clean(v: Any) -> str:
        return (str(v or "").strip())[:120]

    cleaned: List[dict] = []
    seen: set = set()
    for c in contacts_raw:
        if not isinstance(c, dict):
            continue
        name = _clean(c.get("name") or c.get("label") or "")
        role = _clean(c.get("role") or "")
        email = _clean(c.get("email") or "")
        phone = _clean(c.get("phone") or c.get("number") or "")
        if not (email or phone):
            continue
        dedup_key = f"{email.lower()}|{_re.sub(r'[^0-9+]', '', phone)}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        label = name or role or "Contatto"
        if role and name and role.lower() not in name.lower():
            label = f"{name} — {role}"
        cleaned.append({
            "id": uuid.uuid4().hex[:10],
            "name": name,
            "role": role,
            "email": email,
            "phone": phone,
            "label": label,
        })

    return {"doc_id": doc_id, "contacts": cleaned, "total": len(cleaned)}


COMPARISON_PROMPT_BASIC = """Sei un consulente energetico italiano esperto. Confronta due offerte energia/gas/telco.
Rispondi ESCLUSIVAMENTE con JSON valido (nessun markdown, nessuna intro):
{
  "tipo_fornitura": "luce" | "gas" | "telco",
  "sintesi": ["punto 1 conciso", "punto 2", "punto 3"],
  "vantaggi_offerta_aziendale": ["vantaggio 1", "vantaggio 2"],
  "svantaggi_offerta_aziendale": ["svantaggio 1"],
  "differenza_prezzo_energia_eur_kwh": 0.015,
  "differenza_prezzo_gas_eur_smc": 0.03,
  "differenza_costo_mensile_eur": 5.0,
  "risparmio_annuo_stimato_eur": 180,
  "risparmio_percentuale": 15,
  "raccomandazione": "consigliato" | "neutro" | "sconsigliato",
  "motivazione_raccomandazione": ["motivo 1"],
  "azione_consigliata": ["passo 1", "passo 2"]
}
Se un dato non è disponibile, ometti la chiave (non usare null). Sii conciso."""

COMPARISON_PROMPT_RICH = """Sei un consulente energetico italiano. Analizza l'offerta ATTUALE del cliente e produci un report VISIVO strutturato.
Rispondi ESCLUSIVAMENTE con JSON valido (nessun markdown):
{
  "impronta_energetica": {
    "consumo_annuo_kwh_o_smc": 3200,
    "unita": "kWh" | "SMC" | "GB",
    "profilo_utilizzo": "descrizione breve (max 15 parole)",
    "categoria_consumo": "basso" | "medio" | "medio-alto" | "alto",
    "note": ["osservazione 1", "osservazione 2"]
  },
  "dettaglio_fasce": {
    "F1_kwh": 1200, "F2_kwh": 900, "F3_kwh": 1100,
    "F1_percent": 37.5, "F2_percent": 28.1, "F3_percent": 34.4,
    "fascia_prevalente": "F1" | "F2" | "F3" | "monoraria",
    "raccomandazione_tariffa": "biorario" | "monorario" | "trioraria",
    "motivazione": "spiegazione max 20 parole"
  },
  "analisi_contratto_attuale": {
    "fornitore": "nome", "nome_offerta": "nome",
    "tipo_prezzo": "fisso" | "variabile" | "indicizzato",
    "spread_eur_kwh_o_smc": 0.045,
    "durata_contratto_mesi": 24,
    "data_scadenza": "MM/AAAA",
    "criticita": ["criticità 1"],
    "punti_forza": ["punto forte 1"]
  },
  "calcolo_risparmio": {
    "costo_annuo_attuale_eur": 1450,
    "costo_annuo_nuovo_eur": 1250,
    "risparmio_annuo_eur": 200,
    "risparmio_percentuale": 13.8,
    "risparmio_mensile_eur": 16.7,
    "dettaglio_calcolo": ["voce -180€"]
  },
  "matrice_confronto": [
    {"parametro": "Prezzo €/kWh", "attuale": "0.185", "proposta": "0.152", "delta": "-0.033", "vantaggio": "cliente"},
    {"parametro": "Quota fissa", "attuale": "12€", "proposta": "9€", "delta": "-3€", "vantaggio": "cliente"}
  ],
  "executive_summary": {
    "verdetto": "Passaggio fortemente consigliato" | "Passaggio consigliato" | "Situazione neutra" | "Passaggio sconsigliato",
    "risparmio_annuo_eur": 200,
    "punti_chiave": ["risparmio 13.8%", "flessibilità"],
    "prossimi_passi": ["Presentare proposta", "Firma modulo"]
  }
}
Basa i calcoli sui dati reali. Se manca un dato ometti la chiave. Le fasce F1/F2/F3 sono solo per luce/gas."""

# Legacy fallback prompt (single big call) — kept for backward compat but unused in comparison endpoint
COMPARISON_PROMPT = COMPARISON_PROMPT_BASIC


async def _llm_compare_offers_basic(bill_extracted: dict, offer_extracted: dict, bill_type: str) -> dict:
    return await _llm_compare_call(COMPARISON_PROMPT_BASIC, bill_extracted, offer_extracted, bill_type, "compare-basic")


async def _llm_compare_offers_rich(bill_extracted: dict, offer_extracted: dict, bill_type: str) -> dict:
    return await _llm_compare_call(COMPARISON_PROMPT_RICH, bill_extracted, offer_extracted, bill_type, "compare-rich")


async def _llm_compare_call(system_prompt: str, bill_extracted: dict, offer_extracted: dict, bill_type: str, session_prefix: str) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise Exception("EMERGENT_LLM_KEY non configurato")
    chat = LlmChat(
        api_key=key,
        session_id=f"{session_prefix}-{uuid.uuid4().hex[:8]}",
        system_message=system_prompt,
    ).with_model("anthropic", "claude-sonnet-5")
    import json as _json
    # Trim payload aggressively to keep the LLM prompt/response fast
    bill_str = _json.dumps(bill_extracted, ensure_ascii=False)[:4500]
    offer_str = _json.dumps(offer_extracted, ensure_ascii=False)[:4500]
    prompt = (
        f"Tipo fornitura: {bill_type.upper()}\n\n"
        f"=== FATTURA CLIENTE (offerta attuale) ===\n{bill_str}\n\n"
        f"=== OFFERTA AZIENDALE (proposta) ===\n{offer_str}\n\n"
        f"Produci il JSON richiesto."
    )
    resp = await chat.send_message(UserMessage(text=prompt))
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing (never raises)
    return _parse_llm_json(raw, fallback_key="note_ai")


async def _llm_compare_offers(bill_extracted: dict, offer_extracted: dict, bill_type: str) -> dict:
    """Run BASIC + RICH prompts in PARALLEL and merge into one dict.
    This keeps each individual call small/fast (< 30s) so we don't hit the ~60s ingress timeout.
    If one call fails, we still return the other's data + a note."""
    import asyncio as _asyncio
    basic_task = _llm_compare_offers_basic(bill_extracted, offer_extracted, bill_type)
    rich_task = _llm_compare_offers_rich(bill_extracted, offer_extracted, bill_type)
    basic_res, rich_res = await _asyncio.gather(basic_task, rich_task, return_exceptions=True)
    merged: dict = {"tipo_fornitura": bill_type}
    partial_errors: List[str] = []
    if isinstance(basic_res, Exception):
        logger.warning(f"compare basic failed: {basic_res}")
        partial_errors.append(f"basic:{str(basic_res)[:120]}")
    elif isinstance(basic_res, dict):
        merged.update(basic_res)
    if isinstance(rich_res, Exception):
        logger.warning(f"compare rich failed: {rich_res}")
        partial_errors.append(f"rich:{str(rich_res)[:120]}")
    elif isinstance(rich_res, dict):
        # Rich takes precedence for its keys
        merged.update(rich_res)
    if partial_errors and not merged.get("sintesi"):
        merged["parse_error"] = True
        merged["error_message"] = " | ".join(partial_errors)
        merged.setdefault("sintesi", ["Comparazione parzialmente completata a causa di un errore AI."])
        merged.setdefault("raccomandazione", "neutro")
    elif partial_errors:
        merged["partial_error"] = " | ".join(partial_errors)
    return merged


@api_router.get("/contacts/{contact_id}/bills/comparison")
async def bills_comparison(
    contact_id: str,
    bill_id: Optional[str] = None,
    offer_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Compare a client bill vs a company offer. If bill_id/offer_id omitted, use latest done for
    matching bill_type per section (creates one comparison per fornitura where both exist).
    V38: LLM calls now run in parallel via asyncio.gather to stay under ingress timeout."""
    contact = await _ensure_contact_owned(contact_id, user)
    # Fetch bills done
    bills = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id, "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", -1).to_list(200)
    offers = await db.company_offers.find(
        {"user_id": tenant_id(user), "status": "done"},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(50)
    if not bills:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile")
    if not offers:
        raise HTTPException(status_code=400, detail="Nessuna offerta aziendale analizzata disponibile")

    async def _safe_compare(bill_ex: dict, offer_ex: dict, bt: str) -> dict:
        try:
            return await _llm_compare_offers(bill_ex or {}, offer_ex or {}, bt)
        except Exception as e:
            logger.exception(f"comparison failed for bill_type={bt}: {e}")
            return {
                "parse_error": True,
                "error_message": f"Impossibile completare il confronto: {str(e)[:200]}",
                "sintesi": [f"Errore durante l'elaborazione AI ({bt}). Riprova più tardi."],
                "raccomandazione": "neutro",
            }

    # If specific ids given, compare just those
    if bill_id and offer_id:
        bill = next((b for b in bills if b["bill_id"] == bill_id), None)
        offer = next((o for o in offers if o["offer_id"] == offer_id), None)
        if not bill or not offer:
            raise HTTPException(status_code=404, detail="Fattura o offerta non trovata")
        comparison = await _safe_compare(bill.get("extracted") or {}, offer.get("extracted") or {}, bill.get("bill_type") or "luce")
        return {
            "contact": {
                "contact_id": contact["contact_id"],
                "first_name": contact.get("first_name"),
                "last_name": contact.get("last_name"),
                "contact_code": contact.get("contact_code"),
            },
            "items": [{
                "bill_type": bill.get("bill_type"),
                "bill": {"bill_id": bill["bill_id"], "pdf_name": bill.get("pdf_name"), "extracted": bill.get("extracted")},
                "offer": {"offer_id": offer["offer_id"], "label": offer.get("label"), "extracted": offer.get("extracted")},
                "comparison": comparison,
            }],
            "generated_at": utcnow(),
        }

    # Auto-match: latest bill and latest offer per bill_type — run LLM calls in PARALLEL
    pairs: List[Dict[str, Any]] = []
    for bt in BILL_TYPES:
        latest_bill = next((b for b in bills if b.get("bill_type") == bt), None)
        latest_offer = next((o for o in offers if o.get("bill_type") == bt), None)
        if not latest_bill or not latest_offer:
            continue
        pairs.append({"bill_type": bt, "bill": latest_bill, "offer": latest_offer})
    if not pairs:
        raise HTTPException(status_code=400, detail="Nessuna coppia fattura/offerta corrispondente. Carica un'offerta aziendale dello stesso tipo (luce/gas/telco).")

    # Parallel execution
    import asyncio as _asyncio
    comparisons = await _asyncio.gather(
        *[_safe_compare(p["bill"].get("extracted") or {}, p["offer"].get("extracted") or {}, p["bill_type"]) for p in pairs],
        return_exceptions=False,
    )
    results: List[Dict[str, Any]] = []
    for p, comparison in zip(pairs, comparisons):
        results.append({
            "bill_type": p["bill_type"],
            "bill": {"bill_id": p["bill"]["bill_id"], "pdf_name": p["bill"].get("pdf_name"), "extracted": p["bill"].get("extracted")},
            "offer": {"offer_id": p["offer"]["offer_id"], "label": p["offer"].get("label"), "extracted": p["offer"].get("extracted")},
            "comparison": comparison,
        })
    total_risparmio = sum(float(r["comparison"].get("risparmio_annuo_stimato_eur") or 0) for r in results)
    return {
        "contact": {
            "contact_id": contact["contact_id"],
            "first_name": contact.get("first_name"),
            "last_name": contact.get("last_name"),
            "contact_code": contact.get("contact_code"),
        },
        "items": results,
        "risparmio_totale_annuo_eur": total_risparmio,
        "generated_at": utcnow(),
    }


# =========================
