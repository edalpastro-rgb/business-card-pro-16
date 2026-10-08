# ============================================================================
# V50.z487 — OCR UNIVERSALE «Scansiona documento → compila i campi»
# ----------------------------------------------------------------------------
# POST /documents/ocr-fields {image_base64, back_base64?, hint?}
# Riconosce da solo il tipo (carta d'identità / CIE, patente, passaporto, tessera sanitaria, biglietto da visita, visura,
# bolletta, documento generico con dati anagrafici) e restituisce un set UNICO di campi, pronto per precompilare
# Set Up and Go › Chi sei, Nuovo contatto, Anagrafica. L'immagine resta in memoria: niente DB, niente storage.
# ============================================================================
import uuid as _dfo_uuid
import re as _dfo_re
from typing import Optional as _dfo_Optional

DOC_FIELDS_OCR_SYSTEM = (
    "Sei un motore OCR per documenti italiani usati in un CRM: carta d'identità (cartacea o CIE), patente, passaporto, tessera sanitaria / "
    "codice fiscale, biglietto da visita, visura camerale, bolletta luce/gas, lettera o modulo con dati anagrafici. Ricevi una o due immagini "
    "(fronte e retro). Riconosci il tipo e restituisci ESCLUSIVAMENTE un JSON compatto con queste chiavi (stringa vuota se non presente):\n"
    "doc_kind (id_card|driving_license|passport|health_card|business_card|company_doc|bill|other), first_name, last_name, sex (M|F), "
    "birth_date (AAAA-MM-GG), birth_place, tax_id (codice fiscale 16 caratteri maiuscolo), vat_number (partita IVA 11 cifre), company, role, "
    "phone, phone_alt, email, email_alt, website, address_street (via e numero civico), address_zip (CAP), address_city, address_province (sigla), "
    "address (indirizzo completo in una riga), document_number, issue_date (AAAA-MM-GG), expiry_date (AAAA-MM-GG), issuing_authority, pod, pdr, notes.\n"
    "Regole: date SEMPRE AAAA-MM-GG (converti da GG.MM.AAAA o GG/MM/AAAA). Telefoni con prefisso così come scritti. Non inventare mai: se un campo "
    "non è leggibile lascia stringa vuota. Nessun testo fuori dal JSON."
)


class DocFieldsOcrIn(BaseModel):  # noqa: F821
    image_base64: str
    back_base64: _dfo_Optional[str] = None
    hint: _dfo_Optional[str] = None  # «identity» | «business_card» | «any»


@api_router.post("/documents/ocr-fields")  # noqa: F821
async def documents_ocr_fields(body: DocFieldsOcrIn, user=Depends(get_current_user)):  # noqa: F821
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    key = os.environ.get("EMERGENT_LLM_KEY")  # noqa: F821
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")  # noqa: F821
    if not body.image_base64:
        raise HTTPException(status_code=400, detail="Immagine mancante")  # noqa: F821
    if len(body.image_base64) > _IDDOC_MAX_B64 or (body.back_base64 and len(body.back_base64) > _IDDOC_MAX_B64):  # noqa: F821
        raise HTTPException(status_code=413, detail="Immagine troppo grande (max ~9 MB)")  # noqa: F821
    files = [ImageContent(image_base64=_iddoc_bare_b64(body.image_base64))]  # noqa: F821
    if body.back_base64:
        files.append(ImageContent(image_base64=_iddoc_bare_b64(body.back_base64)))  # noqa: F821
    hints = {"identity": "Dovrebbe essere un documento d'identità (carta d'identità, patente, passaporto o tessera sanitaria).",
             "business_card": "Dovrebbe essere un biglietto da visita."}
    text = ("Ecco " + ("fronte e retro" if body.back_base64 else "la foto") + " di un documento. " + hints.get(body.hint or "", "")
            + " Riconosci il tipo, estrai i dati e restituisci il JSON richiesto.")

    async def _run(model_name: str):
        chat = LlmChat(api_key=key, session_id=f"docfields-{_dfo_uuid.uuid4().hex[:8]}", system_message=DOC_FIELDS_OCR_SYSTEM).with_model("gemini", model_name)
        return await chat.send_message(UserMessage(text=text, file_contents=files))

    resp, last_err = None, None
    for model in ("gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"):
        try:
            resp = await _run(model)
            if resp:
                break
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning(f"doc fields OCR failed with {model}: {e}")  # noqa: F821
    if resp is None:
        raise HTTPException(status_code=422, detail=f"Impossibile leggere il documento: {str(last_err)[:200] if last_err else 'nessuna risposta'}")  # noqa: F821
    data = _parse_llm_json((resp or "").strip(), fallback_key="notes")  # noqa: F821
    for k in ("parse_error", "error_message", "parse_error_kind"):
        data.pop(k, None)
    data = {k: ("" if v is None else str(v).strip()) for k, v in data.items()}
    if data.get("tax_id"):
        data["tax_id"] = _dfo_re.sub(r"[^A-Z0-9]", "", data["tax_id"].upper())
    if data.get("vat_number"):
        data["vat_number"] = _dfo_re.sub(r"\D", "", data["vat_number"])
    if not data.get("address") and (data.get("address_street") or data.get("address_city")):
        data["address"] = ", ".join(p for p in [data.get("address_street"), " ".join(x for x in [data.get("address_zip"), data.get("address_city")] if x), data.get("address_province")] if p)
    filled = [k for k, v in data.items() if v and k not in ("doc_kind", "notes")]
    return {"document": data, "doc_kind": data.get("doc_kind") or "other", "filled": filled}
