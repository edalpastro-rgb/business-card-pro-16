# 13_bills.py — Bollette energia + promozione cliente→agente
# Estratto da server.py (righe originali 6415-7074). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Energy Bills (Fatture Energia) — V25
# Multi-section (luce/gas/telco) PDF upload + Claude Sonnet 5 background AI analysis
# =========================

BILL_TYPES = ("luce", "gas", "telco")

class EnergyBillIn(BaseModel):
    bill_type: str  # luce | gas | telco
    pdf_base64: str
    pdf_name: Optional[str] = None
    pdf_mime: Optional[str] = "application/pdf"
    # V38: user-selected parameters to focus the AI extraction on (optional list of labels)
    analysis_params: Optional[List[str]] = None


BILL_SYSTEM_PROMPT_LUCE = """Sei un analista esperto di bollette elettriche italiane. Analizza il testo estratto da una fattura LUCE e restituisci ESCLUSIVAMENTE un JSON valido, senza testo introduttivo, senza markdown.

Estrai TUTTI i campi disponibili. Se un campo NON è presente, ometti la chiave (non usare null/N.D.).

Schema JSON atteso:
{
  "fornitore": "Nome azienda fornitrice",
  "cliente": "Nome intestatario",
  "codice_cliente": "codice cliente",
  "pod": "IT001E12345678",
  "pod_count": 1,
  "tensione": "bassa" | "media",
  "potenza_impegnata_kw": 3.0,
  "consumo_totale_12m_kwh": 2450,
  "consumo_medio_mensile_kwh": 204,
  "consumi_mensili_kwh": [{"mese":"gen","kwh":180}, ...],
  "nome_offerta": "Placet Fisso Luce",
  "data_attivazione": "01/03/2024",
  "data_scadenza": "01/03/2026",
  "durata_contratto_mesi": 24,
  "iva_percentuale": 10,
  "spread_eur_kwh": 0.015,
  "prezzo_energia_eur_kwh": 0.145,
  "importo_totale_eur": 145.30,
  "periodo_fattura": "01/09/2024 - 31/10/2024",
  "note_ai": ["punto 1", "punto 2", "punto 3"]
}"""

BILL_SYSTEM_PROMPT_GAS = """Sei un analista esperto di bollette gas italiane. Analizza il testo estratto da una fattura GAS e restituisci ESCLUSIVAMENTE un JSON valido, senza testo introduttivo, senza markdown.

Estrai TUTTI i campi disponibili. Se un campo NON è presente, ometti la chiave.

Schema JSON atteso:
{
  "fornitore": "Nome azienda fornitrice",
  "cliente": "Nome intestatario",
  "codice_cliente": "codice cliente",
  "pdr": "01234567890123",
  "pdr_count": 1,
  "consumo_totale_12m_smc": 850,
  "consumo_medio_mensile_smc": 71,
  "consumi_mensili_smc": [{"mese":"gen","smc":120}, ...],
  "nome_offerta": "Placet Fisso Gas",
  "data_attivazione": "01/03/2024",
  "data_scadenza": "01/03/2026",
  "durata_contratto_mesi": 24,
  "iva_percentuale": 22,
  "accisa_eur_smc": 0.044,
  "spread_eur_smc": 0.02,
  "prezzo_gas_eur_smc": 0.42,
  "importo_totale_eur": 245.30,
  "periodo_fattura": "01/09/2024 - 31/10/2024",
  "note_ai": ["punto 1", "punto 2", "punto 3"]
}"""

BILL_SYSTEM_PROMPT_TELCO = """Sei un analista esperto di bollette telefoniche/internet italiane. Analizza il testo estratto da una fattura TELCO e restituisci ESCLUSIVAMENTE un JSON valido, senza testo introduttivo, senza markdown.

Estrai TUTTI i campi disponibili. Se un campo NON è presente, ometti la chiave.

Schema JSON atteso:
{
  "fornitore": "Nome azienda fornitrice (TIM, Vodafone, Fastweb, ...)",
  "cliente": "Nome intestatario",
  "codice_cliente": "codice cliente",
  "tipo_connessione": "Fibra" | "ADSL" | "FWA" | "Mobile",
  "velocita_download_mbps": 1000,
  "velocita_upload_mbps": 300,
  "numero_telefono": "0245XXXX",
  "servizi_inclusi": ["Chiamate illimitate","IPTV"],
  "costo_mensile_eur": 29.90,
  "costo_annuale_eur": 358.80,
  "durata_contratto_mesi": 24,
  "data_attivazione": "01/03/2024",
  "data_scadenza": "01/03/2026",
  "codice_migrazione": "CM123456",
  "penale_disdetta_eur": 49.90,
  "iva_percentuale": 22,
  "importo_totale_eur": 32.90,
  "periodo_fattura": "01/09/2024 - 31/10/2024",
  "note_ai": ["punto 1", "punto 2", "punto 3"]
}"""


async def _ocr_pdf_fallback(pdf_base64: str, max_pages: int = 6) -> str:
    """V50.z250 — Testo da PDF SENZA layer testuale (scansione/foto): heavy worker `pdf_ocr` (PyMuPDF → Tesseract locale)."""
    b64 = pdf_base64.split(",", 1)[1] if pdf_base64.startswith("data:") else pdf_base64
    r = await heavy_call("pdf_ocr", data=base64.b64decode(b64), max_pages=max_pages, timeout=240)
    return (r.get("text") or "").strip() if r.get("available") else ""


def _extract_pdf_text(pdf_base64: str) -> str:
    """Extract text from a base64-encoded PDF using pypdf."""
    b64 = pdf_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF base64 non valido: {e}")
    try:
        from pypdf import PdfReader
        from io import BytesIO
        reader = PdfReader(BytesIO(raw))
        parts: List[str] = []
        for page in reader.pages[:20]:  # cap first 20 pages
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        text = "\n".join(parts).strip()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Impossibile leggere PDF: {e}")
    return text


async def _llm_analyze_bill_text(bill_type: str, text: str, analysis_params: Optional[List[str]] = None, tenant: Optional[str] = None) -> dict:
    """Send extracted PDF text to Claude Sonnet 5 and get structured JSON."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise Exception("EMERGENT_LLM_KEY non configurato")
    system = {
        "luce": BILL_SYSTEM_PROMPT_LUCE,
        "gas": BILL_SYSTEM_PROMPT_GAS,
        "telco": BILL_SYSTEM_PROMPT_TELCO,
    }.get(bill_type, BILL_SYSTEM_PROMPT_LUCE)
    # V27 — Insegna all'AI: prepend Master-configured rules + monitored URLs as PRIORITY context
    if tenant:
        try:
            teach = await build_ai_teach_context(tenant, bill_type if bill_type in ("luce", "gas", "telco") else "luce")
            if teach:
                system = (
                    "CONTESTO PRIORITARIO CONFIGURATO DAL MASTER (usa queste regole PRIMA di qualsiasi altra fonte):\n"
                    f"{teach}\n\n"
                    "———\n\n"
                ) + system
        except Exception as _e:
            logger.warning("ai_teach context build failed: %s", _e)
    # V38: if user selected specific parameters to focus on, append them to the system prompt
    fiscal_directives: List[str] = []
    display_params: List[str] = []
    if analysis_params:
        for p in analysis_params:
            s = str(p).strip()
            if not s:
                continue
            if s.startswith("__verifica_"):
                fiscal_directives.append(s)
            else:
                display_params.append(s)
    if display_params:
        focus = ", ".join(display_params[:40])
        system = system + (
            f"\n\nPARAMETRI PRIORITARI RICHIESTI DALL'UTENTE (assicurati di estrarli se presenti): {focus}."
            f"\nSe uno dei parametri richiesti non ha corrispondenza diretta nello schema, includilo in un oggetto 'parametri_richiesti' con chiave = nome parametro e valore = valore trovato (o 'N.D.' se non rilevabile)."
        )
    # V38U — Fiscal-check directives → the LLM must extract the *actual* values
    # and flag them in a `fiscal_check` object we render red in the UI.
    if fiscal_directives:
        expected_iva = None
        expected_accise = None
        require_pcv_zero = False
        for d in fiscal_directives:
            if d.startswith("__verifica_iva__="):
                try: expected_iva = float(d.split("=", 1)[1])
                except Exception: pass
            elif d.startswith("__verifica_accise_gas__="):
                try: expected_accise = float(d.split("=", 1)[1])
                except Exception: pass
            elif d.startswith("__verifica_pcv_annullato__="):
                require_pcv_zero = True
        directive_txt = "\n\nVERIFICA AGEVOLAZIONI FISCALI (obbligatorio se presente nella fattura):\n"
        directive_txt += (
            "Includi nella risposta un oggetto `fiscal_check` con la seguente struttura:\n"
            "{\n"
            "  \"iva\": { \"expected\": <expected|null>, \"actual\": <numero>, \"ok\": <bool>, \"delta_annual_eur\": <numero|null> },\n"
            "  \"accise_gas\": { \"expected\": <expected|null>, \"actual\": <numero>, \"ok\": <bool>, \"delta_annual_eur\": <numero|null> },\n"
            "  \"pcv\": { \"expected\": <0|null>, \"actual\": <numero>, \"ok\": <bool>, \"delta_annual_eur\": <numero|null> }\n"
            "}\n"
            "Regole:\n"
            "- `ok` = true se `actual` corrisponde all'expected entro 5% di tolleranza.\n"
            "- `delta_annual_eur` = quanto ha speso in più il cliente su 12 mesi rispetto al valore corretto. Se non calcolabile usa null.\n"
            "- Ometti le chiavi non richieste.\n"
        )
        if expected_iva is not None:
            directive_txt += f"- IVA attesa: {expected_iva}%. Confronta con l'aliquota IVA effettivamente applicata sulla fattura. delta_annual_eur = (aliquota_effettiva - {expected_iva})/100 * imponibile_annuo_stimato.\n"
        if expected_accise is not None:
            directive_txt += f"- Accise gas attese: {expected_accise:.6f} €/Smc. Confronta con l'importo unitario delle accise sul gas riportato in fattura. delta_annual_eur = (accise_effettive - {expected_accise:.6f}) * consumo_annuo_smc_stimato.\n"
        if require_pcv_zero:
            directive_txt += "- PCV / costi fissi mensili attesi: 0 (annullato nel contratto). Se in fattura risulta un PCV / costi fissi > 0, ok=false. delta_annual_eur = PCV_effettivo * 12.\n"
        system = system + directive_txt
    chat = LlmChat(
        api_key=key,
        session_id=f"bill-{bill_type}-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-5")
    # cap text length
    snippet = text[:18000]
    resp = await chat.send_message(UserMessage(
        text=f"Testo della fattura {bill_type.upper()}:\n\n{snippet}"
    ))
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing for bill analysis. `parse_error` flag survives
    # so the frontend can render a clear red banner instead of raw fields.
    return _parse_llm_json(raw, fallback_key="note_ai")


async def _analyze_bill_task(bill_id: str):
    """Background task: extract PDF text + call Claude, then update bill status.
    Checks for 'cancelled' status before starting the LLM call and before saving results."""
    bill = await db.energy_bills.find_one({"bill_id": bill_id})
    if not bill:
        return
    try:
        # Check cancellation before starting
        curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {"status": "analyzing"}})
        text = _extract_pdf_text(bill["pdf_base64"])
        if not text or len(text.strip()) < 20:
            # V50.z250 — PDF senza livello testo (scansione/foto): OCR Tesseract locale sulle pagine rasterizzate (heavy worker)
            try:
                text = await _ocr_pdf_fallback(bill["pdf_base64"])
            except Exception as _e:  # noqa: BLE001
                logger.warning("bill OCR fallback failed: %s", _e)
        if not text or len(text.strip()) < 20:
            # respect cancellation
            curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
            if not (curr and curr.get("status") == "cancelled"):
                await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {
                    "status": "error",
                    "error_message": "PDF vuoto o non leggibile (potrebbe essere scansione senza OCR).",
                    "analyzed_at": utcnow(),
                }})
            return
        # Check again before hitting the LLM (which is expensive)
        curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        extracted = await _llm_analyze_bill_text(
            bill["bill_type"], text, analysis_params=bill.get("analysis_params"), tenant=bill.get("user_id")
        )
        # Final check: if cancelled during LLM, don't overwrite
        curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {
            "status": "done",
            "extracted": extracted,
            "raw_text_preview": text[:800],
            "analyzed_at": utcnow(),
            "error_message": None,
        }})
        # V50.w — Aggiorna cheat sheet fornitori/prezzi (best-effort, non blocca)
        try:
            await _update_bill_cheatsheet(bill.get("user_id"), bill.get("bill_type"), extracted or {})
        except Exception:
            pass
    except Exception as e:
        logger.exception(f"bill analysis failed for {bill_id}: {e}")
        curr = await db.energy_bills.find_one({"bill_id": bill_id}, {"status": 1})
        if not (curr and curr.get("status") == "cancelled"):
            await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {
                "status": "error",
                "error_message": str(e)[:400],
                "analyzed_at": utcnow(),
            }})


async def _ensure_contact_owned(contact_id: str, user: dict) -> dict:
    c = await db.contacts.find_one(tenant_scope(user, {"contact_id": contact_id}))
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    # Also apply visibility filter
    vis = await contact_visibility_filter(user)
    if vis:
        # cheap re-check
        recheck = await db.contacts.find_one({**tenant_scope(user, {"contact_id": contact_id}), **vis})
        if not recheck:
            raise HTTPException(status_code=403, detail="Non autorizzato su questo contatto")
    return c


# =========================
# V29 — Promuovi cliente → agente (solo Master)
# Converte un contatto in un account collaboratore reale del team.
# Solo l'Owner (Master) può eseguire questa operazione.
# =========================

class PromoteContactIn(BaseModel):
    areas: Optional[List[Literal["energy", "network"]]] = None
    send_welcome_email: bool = True


def _generate_random_password(length: int = 12) -> str:
    """Generate a memorable-yet-strong password: letters + digits + one symbol."""
    import string, secrets as _s
    alphabet = string.ascii_letters + string.digits
    pwd = "".join(_s.choice(alphabet) for _ in range(length - 2))
    pwd += _s.choice("!@#$%&*?")
    pwd += _s.choice(string.digits)
    if not any(c.isupper() for c in pwd):
        pwd = _s.choice(string.ascii_uppercase) + pwd[1:]
    if not any(c.islower() for c in pwd):
        pwd = pwd[:-1] + _s.choice(string.ascii_lowercase)
    return pwd


def _welcome_email_html(agent_name: str, master_name: str, email: str, password: str, login_url: str):
    text = (
        f"Ciao {agent_name},\n\n"
        f"{master_name or 'Il tuo referente'} ti ha attivato un account come collaboratore su Dal Pastro CRM.\n\n"
        f"Credenziali di accesso:\n"
        f"  - Email: {email}\n"
        f"  - Password provvisoria: {password}\n\n"
        f"Accedi qui: {login_url}\n\n"
        f"Ti consigliamo di cambiare la password al primo accesso da Impostazioni -> Sicurezza.\n\n"
        f"Benvenuto nel team!\n\n"
        f"---\n"
        f"Powered by AxonOS\n"
        f"L'intelligenza artificiale al servizio del tuo business"
    )
    html = f"""<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#F6F7FA;padding:24px;color:#111820">
  <div style="max-width:520px;margin:0 auto;background:#FFF;border-radius:14px;padding:28px;border:1px solid #E5E7EB">
    <h2 style="margin:0 0 8px;color:#EA580C;letter-spacing:-0.3px">Benvenuto nel team!</h2>
    <p style="margin:0 0 14px;color:#334155;line-height:1.5">
      Ciao <b>{agent_name}</b>, <b>{master_name or 'il tuo referente'}</b> ti ha attivato un account
      come collaboratore su <b>Dal Pastro CRM</b>.
    </p>
    <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:14px 16px;margin:14px 0">
      <div style="font-size:12px;color:#9A3412;font-weight:800;letter-spacing:0.3px;text-transform:uppercase">Credenziali provvisorie</div>
      <div style="margin-top:6px;font-family:ui-monospace,Menlo,monospace;color:#111820">
        <div><b>Email:</b> {email}</div>
        <div><b>Password:</b> {password}</div>
      </div>
    </div>
    <a href="{login_url}" style="display:inline-block;background:#EA580C;color:#FFF;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:800">Accedi ora</a>
    <p style="margin:18px 0 0;color:#64748B;font-size:12.5px;line-height:1.5">
      Per sicurezza, cambia la password al primo accesso da <b>Impostazioni -> Sicurezza</b>.
    </p>
    <!-- V29.f Firma AxonOS -->
    <div style="margin-top:26px;padding-top:16px;border-top:1px solid #E5E7EB;display:flex;align-items:center;gap:12px">
      <div style="width:44px;height:44px;border-radius:10px;background:#0B1220;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
        <img src="https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/592863265f614b9bb4273fef7b1b8f1b_AxonOS%20logo.png" alt="AxonOS" width="36" height="36" style="display:block;border:0;outline:none;text-decoration:none;background:transparent" />
      </div>
      <div style="line-height:1.35">
        <div style="font-size:13px;font-weight:800;color:#0B1220;letter-spacing:-0.2px">Powered by AxonOS</div>
        <div style="font-size:11.5px;color:#64748B">L'intelligenza artificiale al servizio del tuo business</div>
      </div>
    </div>
  </div>
</body></html>"""
    return text, html


@api_router.post("/contacts/{contact_id}/promote-to-agent")
async def promote_contact_to_agent(contact_id: str, body: PromoteContactIn, background: BackgroundTasks, user=Depends(get_current_user)):
    """Promuovi un contatto ad account collaboratore (solo Master).
    - Crea un nuovo utente `member` con parent_user_id=Master.
    - Aggiorna il contatto: status=collaborator, linked_user_id=nuovo utente.
    - Seed un business_card di default per il nuovo utente.
    - Invia una email di benvenuto con le credenziali via SMTP (se configurato).
    Ritorna anche la password generata (visibile UNA SOLA VOLTA al Master)."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master puo promuovere un contatto ad agente")
    contact = await _ensure_contact_owned(contact_id, user)

    if contact.get("linked_user_id") or contact.get("status") == "collaborator":
        raise HTTPException(status_code=400, detail="Questo contatto e' gia' collegato a un account collaboratore")

    email = (contact.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Il contatto non ha un'email: impossibile creare l'account")
    name_parts = [contact.get("first_name") or "", contact.get("last_name") or ""]
    full_name = " ".join(p for p in name_parts if p).strip() or email.split("@")[0]

    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Esiste gia' un account con questa email")

    areas = body.areas or ["energy", "network"]
    if not areas:
        areas = ["energy", "network"]

    password = _generate_random_password(12)
    new_uid = f"user_{uuid.uuid4().hex[:12]}"
    now = utcnow()

    user_doc = {
        "user_id": new_uid,
        "email": email,
        "name": full_name,
        "password_hash": hash_password(password),
        "role": "member",
        "areas": areas,
        "parent_user_id": user["user_id"],
        "picture": None,
        "created_at": now,
        "promoted_from_contact_id": contact_id,
    }
    await db.users.insert_one(user_doc)

    contact_upd: Dict[str, Any] = {
        "status": "collaborator",
        "linked_user_id": new_uid,
        "updated_at": now,
    }
    await db.contacts.update_one(
        {"contact_id": contact_id, "user_id": tenant_id(user)},
        {"$set": contact_upd},
    )

    bc: Dict[str, Any] = {}
    try:
        bc = {
            "card_id": f"bc_{uuid.uuid4().hex[:12]}",
            "user_id": new_uid,
            "display_name": full_name,
            "title": "Consulente",
            "company_name": (user.get("company_name") or "").strip() or "",
            "phone": (contact.get("phone") or "").strip(),
            "email": email,
            "website": "",
            "address": (contact.get("address") or "").strip(),
            "tagline": "",
            "logo_base64": user.get("company_logo_base64") or "",
            "photo_base64": contact.get("avatar_base64") or "",
            "accent_color": "#EA580C",
            "qr_type": "vcard",
            "qr_content": "",
            "demo_app_link": "",
            "social_links": {},
            "created_at": now,
            "updated_at": now,
        }
        await db.business_cards.insert_one(bc)
    except Exception as e:
        logger.warning(f"[promote] business_card seed failed for {new_uid}: {e}")

    email_status = "skipped"
    email_error: Optional[str] = None
    if body.send_welcome_email:
        cfg = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
        if cfg and cfg.get("host") and cfg.get("password"):
            base_url = os.environ.get("APP_PUBLIC_URL") or os.environ.get("EXPO_PUBLIC_APP_URL") or "https://advisoros.it"
            login_url = f"{base_url.rstrip('/')}/login"
            text, html = _welcome_email_html(full_name, user.get("name") or "", email, password, login_url)

            def _send():
                try:
                    _send_smtp_email(cfg, email, "Benvenuto nel team - Dal Pastro CRM", text, html)
                except Exception as exc:
                    logger.exception(f"[promote] welcome email failed: {exc}")

            background.add_task(_send)
            email_status = "queued"
        else:
            email_status = "smtp_missing"
            email_error = "SMTP non configurato: le credenziali sono qui sotto, condividile manualmente."

    return {
        "ok": True,
        "user_id": new_uid,
        "email": email,
        "name": full_name,
        "password": password,
        "areas": areas,
        "business_card_id": bc.get("card_id"),
        "email_status": email_status,
        "email_error": email_error,
    }




@api_router.post("/contacts/{contact_id}/bills")
async def create_bill(contact_id: str, body: EnergyBillIn, background: BackgroundTasks, user=Depends(get_current_user)):
    if body.bill_type not in BILL_TYPES:
        raise HTTPException(status_code=400, detail=f"bill_type non valido: usa {BILL_TYPES}")
    await _ensure_contact_owned(contact_id, user)
    # rough size check to avoid huge PDFs
    b64 = body.pdf_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    approx_size = int(len(b64) * 0.75)
    if approx_size > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF troppo grande (max ~12 MB)")
    bill_id = f"bill_{uuid.uuid4().hex[:12]}"
    doc = {
        "bill_id": bill_id,
        "contact_id": contact_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": body.bill_type,
        "pdf_base64": body.pdf_base64,
        "pdf_name": body.pdf_name or f"fattura-{body.bill_type}.pdf",
        "pdf_mime": body.pdf_mime or "application/pdf",
        "pdf_size": approx_size,
        "status": "pending",
        "extracted": None,
        "error_message": None,
        "analysis_params": body.analysis_params or None,
        "created_at": utcnow(),
        "analyzed_at": None,
    }
    await db.energy_bills.insert_one(doc)
    background.add_task(_analyze_bill_task, bill_id)
    strip_id(doc)
    # Do not return the huge base64 in the response
    doc.pop("pdf_base64", None)
    return doc


@api_router.get("/contacts/{contact_id}/bills")
async def list_bills(contact_id: str, user=Depends(get_current_user)):
    await _ensure_contact_owned(contact_id, user)
    items = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(200)
    grouped: Dict[str, List[Dict[str, Any]]] = {"luce": [], "gas": [], "telco": []}
    for it in items:
        bt = it.get("bill_type") or "luce"
        grouped.setdefault(bt, []).append(it)
    return {"items": items, "grouped": grouped}


@api_router.get("/contacts/{contact_id}/bills/{bill_id}/pdf")
async def get_bill_pdf(contact_id: str, bill_id: str, user=Depends(get_current_user)):
    """Return the raw base64 PDF (for viewing/downloading)."""
    await _ensure_contact_owned(contact_id, user)
    b = await db.energy_bills.find_one(
        {"user_id": tenant_id(user), "contact_id": contact_id, "bill_id": bill_id},
        {"_id": 0},
    )
    if not b:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    return {"pdf_base64": b.get("pdf_base64"), "pdf_name": b.get("pdf_name"), "pdf_mime": b.get("pdf_mime")}


@api_router.delete("/contacts/{contact_id}/bills/{bill_id}")
async def delete_bill(contact_id: str, bill_id: str, user=Depends(get_current_user)):
    await _ensure_contact_owned(contact_id, user)
    r = await db.energy_bills.delete_one({"user_id": tenant_id(user), "contact_id": contact_id, "bill_id": bill_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    return {"ok": True}


@api_router.post("/contacts/{contact_id}/bills/{bill_id}/reanalyze")
async def reanalyze_bill(contact_id: str, bill_id: str, background: BackgroundTasks, user=Depends(get_current_user)):
    await _ensure_contact_owned(contact_id, user)
    b = await db.energy_bills.find_one({"user_id": tenant_id(user), "contact_id": contact_id, "bill_id": bill_id})
    if not b:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    # V50.z153 — Rianalisi = "bolletta sostituita": riattiva l'avviso scadenza
    # e rimuove eventuale data manuale (la nuova lettura fa fede).
    await db.energy_bills.update_one({"bill_id": bill_id}, {
        "$set": {"status": "pending", "error_message": None},
        "$unset": {"deadline_dismissed": "", "deadline_dismissed_at": "", "deadline_override": ""},
    })
    background.add_task(_analyze_bill_task, bill_id)
    return {"ok": True, "status": "pending"}


@api_router.post("/contacts/{contact_id}/bills/{bill_id}/cancel")
async def cancel_bill_analysis(contact_id: str, bill_id: str, user=Depends(get_current_user)):
    """V38: Mark a bill analysis as cancelled. The background task will skip saving results.
    Only bills that are pending or analyzing can be cancelled."""
    await _ensure_contact_owned(contact_id, user)
    b = await db.energy_bills.find_one({"user_id": tenant_id(user), "contact_id": contact_id, "bill_id": bill_id})
    if not b:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    st = b.get("status")
    if st not in ("pending", "analyzing"):
        raise HTTPException(status_code=400, detail=f"Impossibile annullare: stato attuale '{st}'")
    await db.energy_bills.update_one({"bill_id": bill_id}, {"$set": {
        "status": "cancelled",
        "error_message": "Analisi annullata dall'utente",
        "analyzed_at": utcnow(),
    }})
    return {"ok": True, "status": "cancelled"}


BILL_REPORT_SYSTEM = """Sei un consulente energetico esperto italiano. Analizzi bollette LUCE, GAS e TELCO e produci consigli concreti in italiano.
Rispondi ESCLUSIVAMENTE con JSON valido (nessun markdown, nessuna intro):
{
  "riepilogo_generale": ["punto 1 di overview", "punto 2", "punto 3"],
  "punti_forza": ["...", "..."],
  "punti_debolezza": ["...", "..."],
  "suggerimenti_luce": ["..."],
  "suggerimenti_gas": ["..."],
  "suggerimenti_telco": ["..."],
  "risparmio_stimato_annuo_eur": 240,
  "priorita_azione": "alta" | "media" | "bassa"
}"""


async def _llm_bill_suggestions(summary_data: dict) -> dict:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return {"error": "EMERGENT_LLM_KEY non configurato"}
    chat = LlmChat(
        api_key=key,
        session_id=f"bill-report-{uuid.uuid4().hex[:8]}",
        system_message=BILL_REPORT_SYSTEM,
    ).with_model("anthropic", "claude-sonnet-5")
    import json as _json
    prompt = (
        "Ecco i dati estratti dalle fatture del cliente. Fornisci analisi e consigli come da schema:\n\n"
        + _json.dumps(summary_data, ensure_ascii=False, indent=2)[:15000]
    )
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        return {"error": f"Errore LLM: {e}"}
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing
    data = _parse_llm_json(raw, fallback_key="riepilogo_generale")
    return data


@api_router.get("/contacts/{contact_id}/bills/report")
async def bills_report(contact_id: str, user=Depends(get_current_user)):
    contact = await _ensure_contact_owned(contact_id, user)
    items = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id, "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", -1).to_list(200)
    if not items:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile")
    # Group extracted data per type
    grouped: Dict[str, List[Dict[str, Any]]] = {"luce": [], "gas": [], "telco": []}
    for it in items:
        bt = it.get("bill_type") or "luce"
        grouped.setdefault(bt, []).append({
            "pdf_name": it.get("pdf_name"),
            "extracted": it.get("extracted") or {},
        })
    ai_suggestions = await _llm_bill_suggestions(grouped)
    return {
        "contact": {
            "contact_id": contact["contact_id"],
            "first_name": contact.get("first_name"),
            "last_name": contact.get("last_name"),
            "contact_code": contact.get("contact_code"),
            "phone": contact.get("phone"),
            "email": contact.get("email"),
        },
        "grouped": grouped,
        "ai_suggestions": ai_suggestions,
        "generated_at": utcnow(),
    }


# =========================
