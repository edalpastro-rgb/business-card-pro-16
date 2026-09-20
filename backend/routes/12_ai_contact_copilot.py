# 12_ai_contact_copilot.py — AI helper contatti + Copilot vocale in auto
# Estratto da server.py (righe originali 5794-6414). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# AI-powered Contact helpers (Emergent LLM Key)
# =========================
class AIUrlIn(BaseModel):
    url: str
    context: Optional[str] = None


class AITextIn(BaseModel):
    text: str


class AIVoiceIn(BaseModel):
    audio_base64: str  # data URL or plain b64
    mime: Optional[str] = "audio/webm"


class AIImageIn(BaseModel):
    image_base64: str  # data URL or plain b64
    mime: Optional[str] = "image/jpeg"
    back_image_base64: Optional[str] = None  # V50.z280 — retro del biglietto (servizi, orari, social, note)


CONTACT_EXTRACTION_SYSTEM = (
    "Sei un assistente che estrae informazioni di contatto da testo, biglietti da visita o pagine web. "
    "Rispondi SEMPRE con un oggetto JSON valido (senza testo aggiuntivo, senza markdown) con questi campi opzionali: "
    "first_name (string), last_name (string), role (string, ruolo/qualifica), company (string, ragione sociale completa con forma giuridica es. s.n.c., s.r.l.), "
    "phones (array di oggetti {label, number, type}: UNO per OGNI numero presente, senza tralasciarne nessuno; type = mobile|landline|fax|other; "
    "label = a chi/cosa si riferisce, es. 'Cell. Rudy', 'Cell. Massimo', 'Tel. ufficio', 'Fax'; number con prefisso +39 se italiano), "
    "emails (array di oggetti {label, address}: una per ogni email presente), fax (string), vat_number (string, partita IVA 11 cifre), fiscal_code (string), "
    "people (array di oggetti {name, role, phone, email}: le ALTRE persone citate oltre al contatto principale, es. soci o colleghi; se sul biglietto c'è 'di Andriolo R. & Ferronato M.' e un 'cell. Massimo', associa il numero a Ferronato M.), "
    "address_street (string, via), address_number (string, numero civico), address_city (string), address_zip (string), address_province (string, sigla), "
    "website (string), linkedin (string), telegram (string), whatsapp (string), "
    "birth_date (string in formato DD/MM/YYYY se identificabile), "
    "notes (string, breve descrizione professionale: attività, servizi, orari). "
    "Il contatto principale (first_name/last_name) è la persona il cui cellulare è indicato per primo o che è nominata per prima. "
    "Associa SEMPRE ogni numero alla persona o funzione giusta usando le etichette presenti (cell., tel., fax, nome accanto al numero). "
    "Se un campo non è presente, omettilo. Rispondi in italiano nei campi testuali. NON aggiungere spiegazioni."
)

_PHONE_TYPE_RX = {"fax": re.compile(r"\bfax\b", re.I), "mobile": re.compile(r"\b(cell|cellulare|mobile|mob)\b\.?", re.I)}


def _norm_extracted_contact(data: dict) -> dict:
    """V50.z278 — Rende coerente l'estrazione adattiva: liste phones/emails con flag `primary`, campi piatti
    (phone = cellulare principale, phone_alt = fisso, fax, email) sempre valorizzati per il resto dell'app."""
    if not isinstance(data, dict):
        return {}
    ppl = []
    for p in (data.get("people") if isinstance(data.get("people"), list) else []):
        if isinstance(p, dict) and str(p.get("name") or "").strip():
            ppl.append({"name": str(p.get("name") or "").strip()[:80], "role": str(p.get("role") or "").strip()[:60], "phone": str(p.get("phone") or "").strip()[:30], "email": str(p.get("email") or "").strip()[:120]})
    data["people"] = ppl
    phones = []
    seen = set()
    raw_phones = data.get("phones") if isinstance(data.get("phones"), list) else []
    # i numeri degli altri referenti entrano nell'elenco recapiti, associati al nome
    raw_phones = raw_phones + [{"label": f"Cell. {p['name']}", "number": p["phone"], "type": ""} for p in ppl if p["phone"]]
    for src in ([{"label": "Telefono", "number": data.get("phone"), "type": "mobile"}, {"label": "Telefono 2", "number": data.get("phone_alt"), "type": "landline"},
                 {"label": "Fax", "number": data.get("fax"), "type": "fax"}] if not raw_phones else []) + raw_phones:
        if not isinstance(src, dict):
            continue
        num = re.sub(r"[^\d+]", "", str(src.get("number") or ""))
        if len(num) < 6 or num in seen:
            continue
        seen.add(num)
        label = str(src.get("label") or "").strip()[:40]
        typ = str(src.get("type") or "").lower()
        if typ not in ("mobile", "landline", "fax", "other"):
            typ = "fax" if _PHONE_TYPE_RX["fax"].search(label) else "mobile" if _PHONE_TYPE_RX["mobile"].search(label) or re.match(r"^(\+39)?3\d{8,9}$", num) else "landline"
        phones.append({"label": label or {"mobile": "Cellulare", "landline": "Telefono fisso", "fax": "Fax"}.get(typ, "Telefono"), "number": str(src.get("number") or "").strip()[:30], "type": typ, "primary": False})
    emails = []
    seen_e = set()
    raw_emails = data.get("emails") if isinstance(data.get("emails"), list) else []
    for src in ([{"label": "Email", "address": data.get("email")}, {"label": "Email 2", "address": data.get("email_alt")}] if not raw_emails else []) + raw_emails:
        if not isinstance(src, dict):
            continue
        addr = str(src.get("address") or "").strip().lower()
        if "@" not in addr or addr in seen_e:
            continue
        seen_e.add(addr)
        emails.append({"label": str(src.get("label") or "Email").strip()[:40], "address": addr[:120], "primary": False})
    # principale: primo cellulare (altrimenti primo numero non fax), prima email
    main = next((p for p in phones if p["type"] == "mobile"), None) or next((p for p in phones if p["type"] != "fax"), None)
    if main:
        main["primary"] = True
        data["phone"] = main["number"]
    land = next((p for p in phones if p["type"] == "landline"), None)
    data["phone_alt"] = land["number"] if land else (next((p["number"] for p in phones if p is not main and p["type"] != "fax"), ""))
    fax = next((p for p in phones if p["type"] == "fax"), None)
    data["fax"] = fax["number"] if fax else str(data.get("fax") or "")
    if emails:
        emails[0]["primary"] = True
        data["email"] = emails[0]["address"]
        data["email_alt"] = emails[1]["address"] if len(emails) > 1 else ""
    data["phones"], data["emails"] = phones, emails
    if data.get("vat_number"):
        data["vat_number"] = re.sub(r"[^\dA-Za-z]", "", str(data["vat_number"]))[:16]
    for k in list(data.keys()):
        if data[k] in ("", None, [], {}) and k not in ("phones", "emails", "people"):
            data.pop(k)
    return data


# ---------------------------------------------------------------------------
# V38Z — Robust JSON parser for LLM responses.
# ---------------------------------------------------------------------------
# LLMs occasionally emit malformed JSON: wrapped in prose, missing quotes,
# trailing commas, single quotes, etc. This helper attempts multiple fallback
# strategies and, when ALL fail, returns a dict with a *clear user-facing*
# error message (no raw broken JSON exposed to the frontend).
# ---------------------------------------------------------------------------
def _parse_llm_json(raw: str, fallback_key: str = "note_ai") -> dict:
    """Best-effort JSON parser for LLM responses.

    Returns a dict. When parsing fails after all strategies, returns:
      {
        "parse_error": True,
        "error_message": "L'analisi AI ha restituito una risposta non valida. Riprova più tardi.",
        <fallback_key>: <short excerpt of the raw text for debugging>
      }
    NEVER raises. Callers can check `result.get("parse_error")` to detect
    the failure and display a clear message instead of raw fields.
    """
    import json as _json_local
    import re as _re_local

    USER_FRIENDLY_MSG = (
        "L'analisi AI ha restituito una risposta non valida. "
        "Riprova più tardi o contatta il supporto se il problema persiste."
    )

    def _err(kind: str, snippet: str) -> dict:
        return {
            "parse_error": True,
            "error_message": USER_FRIENDLY_MSG,
            "parse_error_kind": kind,  # internal, not shown to user
            fallback_key: snippet[:300],
        }

    if not raw or not isinstance(raw, str):
        return _err("empty", "")
    text = raw.strip()

    # Strip common markdown code fences ```json ... ```
    if text.startswith("```"):
        text = text.strip("`")
        # remove optional leading "json"
        if text.lower().startswith("json"):
            text = text[4:].strip()
        if text.endswith("```"):
            text = text[:-3].strip()

    # Attempt 1: strict parse
    try:
        data = _json_local.loads(text)
        if isinstance(data, dict):
            return data
        # Not a dict — wrap it
        return {fallback_key: str(data)[:500]}
    except Exception:
        pass

    # Attempt 2: extract the outermost {...} block via regex
    m = _re_local.search(r"\{[\s\S]*\}", text)
    if m:
        candidate = m.group(0)
        try:
            data = _json_local.loads(candidate)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
        # Attempt 3: repair common defects on the candidate
        repaired = candidate
        # Remove trailing commas before } or ]
        repaired = _re_local.sub(r",(\s*[}\]])", r"\1", repaired)
        # Replace single-quoted string literals with double quotes (best-effort)
        repaired = _re_local.sub(r"(?<![\\])'([^'\n]*?)'", r'"\1"', repaired)
        # Wrap unquoted keys in double quotes: {foo: 1} -> {"foo": 1}
        repaired = _re_local.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', repaired)
        try:
            data = _json_local.loads(repaired)
            if isinstance(data, dict):
                return data
        except Exception:
            pass

    # All attempts failed
    logger.warning("_parse_llm_json failed; raw preview=%r", (raw or "")[:200])
    return _err("unparseable", raw)


async def _llm_extract_contact(text: str, model: str = "claude-haiku-4-5-20251001", provider: str = "anthropic") -> dict:
    """Send raw text to Claude Haiku and parse the JSON contact dict."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    chat = LlmChat(
        api_key=key,
        session_id=f"contact-extract-{uuid.uuid4().hex[:8]}",
        system_message=CONTACT_EXTRACTION_SYSTEM,
    ).with_model(provider, model)
    try:
        resp = await chat.send_message(UserMessage(text=text))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore LLM: {e}")
    raw = (resp or "").strip()
    # V38Z — robust JSON parsing (never raises)
    data = _parse_llm_json(raw, fallback_key="notes")
    # For contact extraction, ignore parse_error flag (caller expects a dict either way)
    data.pop("parse_error", None)
    data.pop("error_message", None)
    data.pop("parse_error_kind", None)
    return _norm_extracted_contact(data)


@api_router.post("/ai/contact-from-url")
async def ai_contact_from_url(body: AIUrlIn, user=Depends(get_current_user)):
    """Fetch the URL, extract clean text, feed it to Claude Haiku 4.5 for JSON contact parsing."""
    url = (body.url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL non valido")
    # Download HTML
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as c:
            r = await c.get(url, headers={"User-Agent": "Mozilla/5.0 DalPastroCRM/1.0"})
            r.raise_for_status()
            html = r.text
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Impossibile scaricare la pagina: {e}")
    # Naive text extraction (strip tags)
    import re as _re
    text = _re.sub(r"<script[\s\S]*?</script>", " ", html, flags=_re.IGNORECASE)
    text = _re.sub(r"<style[\s\S]*?</style>", " ", text, flags=_re.IGNORECASE)
    text = _re.sub(r"<[^>]+>", " ", text)
    text = _re.sub(r"\s+", " ", text).strip()
    if len(text) > 6000:
        text = text[:6000]
    prompt = (
        f"Ecco il contenuto testuale della pagina {url}. Estrai i dati di contatto.\n\n{text}"
        + (f"\n\nContesto aggiuntivo: {body.context}" if body.context else "")
    )
    parsed = await _llm_extract_contact(prompt)
    return {"contact": parsed, "source_url": url}


@api_router.post("/ai/transcribe")
async def ai_transcribe(body: AIVoiceIn, user=Depends(get_current_user)):
    """Transcribe audio to text via OpenAI Whisper (Italian language).
    Returns just the raw transcript — used by the microphone button on the contact card notes.
    """
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    b64 = body.audio_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        audio_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Audio base64 non valido")
    if len(audio_bytes) < 1024:
        raise HTTPException(status_code=400, detail="Audio troppo corto o vuoto")
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio troppo grande (max 25 MB)")
    import tempfile
    mime = (body.mime or "").lower()
    if "webm" in mime:
        ext = ".webm"
    elif "m4a" in mime or "mp4" in mime or "aac" in mime:
        ext = ".m4a"
    elif "wav" in mime:
        ext = ".wav"
    elif "ogg" in mime:
        ext = ".webm"  # litellm expects webm/ogg family
    else:
        ext = ".mp3"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        path = tmp.name
    try:
        from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=key)
        with open(path, "rb") as _fh:
            result = await stt.transcribe(
                file=_fh,
                model="whisper-1",
                language="it",
                response_format="text",
            )
        # response can be a plain string when response_format=text, or an object with .text
        if isinstance(result, str):
            transcript = result.strip()
        elif isinstance(result, dict):
            transcript = (result.get("text") or result.get("transcript") or "").strip()
        else:
            transcript = str(getattr(result, "text", result) or "").strip()
    except Exception as e:
        logger.exception(f"transcribe error: {e}")
        raise HTTPException(status_code=502, detail=f"Errore trascrizione: {str(e)[:300]}")
    finally:
        try:
            import os as _os
            _os.unlink(path)
        except Exception:
            pass
    return {"transcript": transcript, "language": "it", "model": "whisper-1"}


@api_router.post("/ai/contact-from-voice")
async def ai_contact_from_voice(body: AIVoiceIn, user=Depends(get_current_user)):
    """Transcribe audio via Whisper, then parse to contact fields via Claude Haiku."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    b64 = body.audio_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        audio_bytes = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Audio base64 non valido")
    import tempfile
    ext = ".webm" if "webm" in (body.mime or "") else (".m4a" if "m4a" in (body.mime or "") else ".mp3")
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        path = tmp.name
    try:
        from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
        stt = OpenAISpeechToText(api_key=key)
        # V38P — bug fix: the correct kwarg is `file`, not `file_path`.
        # Previously this raised TypeError → HTTP 502.
        with open(path, "rb") as _fh:
            result = await stt.transcribe(
                file=_fh,
                model="whisper-1",
                language="it",
                response_format="text",
            )
        if isinstance(result, str):
            transcript = result.strip()
        elif isinstance(result, dict):
            transcript = (result.get("text") or result.get("transcript") or "").strip()
        else:
            transcript = str(getattr(result, "text", result) or "").strip()
    except Exception as e:
        emsg = str(e).lower()
        logger.exception(f"transcribe (contact-from-voice) error: {e}")
        # V38P — narrow error mapping: content/format problems from Whisper
        # (invalid audio, truncated, unsupported codec) → 422; only genuine
        # transport/auth problems → 502.
        content_hints = (
            "invalid file format", "invalid_audio", "audio file might be corrupted",
            "could not decode", "unsupported format", "empty", "no audio data",
            "invalid_request_error", "invalid file", "unable to parse",
            "decoding", "ffprobe", "bad request", "400",
        )
        if any(hint in emsg for hint in content_hints):
            raise HTTPException(status_code=422, detail=f"Audio non decodificabile: {str(e)[:200]}")
        raise HTTPException(status_code=502, detail=f"Errore trascrizione: {str(e)[:300]}")
    finally:
        try:
            os.remove(path)
        except Exception:
            pass
    parsed = await _llm_extract_contact(
        f"Ecco un dettato vocale in italiano di dati di contatto. Estrai i campi:\n\n{transcript}"
    )
    return {"contact": parsed, "transcript": transcript}


# =========================================================================
# V50.o — Copilot Vocale in Auto: intent parser + esecuzione hands-free.
#
# Flusso:
#  1. Frontend registra audio → invia a /api/ai/transcribe (whisper).
#  2. Frontend chiama /api/voice/copilot/execute con `transcript`.
#  3. Backend classifica intent via Claude Haiku (JSON structured output):
#     - create_contact: {first_name, last_name, phone?, email?, city?, area?}
#     - add_note: {contact_query, note_text}
#     - schedule_call: {contact_query, when_iso, notes?}
#     - query: {question} → delega a chat Axon (opzionale)
#  4. Backend esegue l'azione e ritorna confermatext leggibile.
# =========================================================================


class VoiceCopilotIn(BaseModel):
    transcript: str
    session_id: Optional[str] = None


_VOICE_INTENT_PROMPT = """Sei un intent classifier per un CRM italiano.
Data una trascrizione vocale dell'utente (consulente energetico in auto),
identifica l'intent tra:
- create_contact: creare un NUOVO cliente/contatto
- add_note: aggiungere una nota a un cliente ESISTENTE
- schedule_call: programmare una telefonata di richiamo
- query: qualsiasi altra domanda o richiesta informativa

Rispondi SOLO con un JSON valido in questo formato esatto:
{
  "intent": "create_contact" | "add_note" | "schedule_call" | "query",
  "params": {
    // per create_contact: first_name, last_name, phone, email, city, area (energy/network)
    // per add_note: contact_query (nome/cognome cercabile), note_text
    // per schedule_call: contact_query, when_iso (ISO8601 con timezone Europe/Rome), notes
    // per query: question
  },
  "confirmation": "frase in italiano da leggere all'utente per confermare (max 15 parole)"
}

Regole:
- Se una data è "domani alle 10", calcola l'ISO8601 rispetto a ORA (%s).
- Se un campo manca, ometti la chiave (non mettere null o stringa vuota).
- La confirmation deve essere naturale e concisa, es. "Ho creato Mario Rossi con numero 3331234567".

Trascrizione utente:
"""


@api_router.post("/voice/copilot/execute")
async def voice_copilot_execute(body: VoiceCopilotIn, user=Depends(get_current_user)):
    """V50.o — Copilot vocale hands-free: intent parsing + execution."""
    transcript = (body.transcript or "").strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="Trascrizione vuota")
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    now_iso = utcnow().isoformat()
    prompt = _VOICE_INTENT_PROMPT % now_iso + transcript
    session_id = body.session_id or f"voice-copilot-{uuid.uuid4().hex[:8]}"

    chat = LlmChat(
        api_key=key,
        session_id=session_id,
        system_message="Sei un intent classifier che risponde SOLO con JSON valido. Nessun testo prima o dopo.",
    ).with_model("anthropic", "claude-haiku-4-5")

    try:
        raw = await chat.send_message(UserMessage(text=prompt))
    except Exception as exc:
        logger.exception("[voice-copilot] LLM failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Errore intent classifier: {exc}")

    raw_txt = raw if isinstance(raw, str) else getattr(raw, "text", str(raw))
    # Strip code fences se presenti
    txt = raw_txt.strip()
    if txt.startswith("```"):
        txt = txt.strip("`")
        txt = txt.split("\n", 1)[1] if "\n" in txt else txt
        if txt.endswith("```"):
            txt = txt[:-3]
    try:
        import json as _json_std
        parsed = _json_std.loads(txt)
    except Exception:
        # Retry con fallback: prova a estrarre il primo JSON con regex
        m = re.search(r"\{[\s\S]*\}", txt)
        if not m:
            raise HTTPException(status_code=422, detail=f"Impossibile parsare intent: {txt[:200]}")
        try:
            import json as _json_std
            parsed = _json_std.loads(m.group(0))
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"JSON intent malformato: {exc}")

    intent = (parsed.get("intent") or "").strip()
    params = parsed.get("params") or {}
    confirmation = (parsed.get("confirmation") or "Fatto.").strip()

    result_extra: dict = {}
    tenant = tenant_id(user)

    try:
        if intent == "create_contact":
            first_name = (params.get("first_name") or "").strip()
            last_name = (params.get("last_name") or "").strip()
            if not first_name and not last_name:
                raise HTTPException(status_code=422, detail="Nome/cognome mancanti nella trascrizione")
            contact_doc = {
                "id": uuid.uuid4().hex,
                "tenant_id": tenant,
                "user_id": user["user_id"],
                "first_name": first_name,
                "last_name": last_name,
                "phone": (params.get("phone") or "").strip(),
                "email": (params.get("email") or "").strip(),
                "city": (params.get("city") or "").strip(),
                "area": params.get("area") if params.get("area") in ("energy", "network") else "energy",
                "created_at": utcnow(),
                "updated_at": utcnow(),
                "source": "voice_copilot",
            }
            await db.contacts.insert_one(contact_doc)
            result_extra = {"contact_id": contact_doc["id"], "name": f"{first_name} {last_name}".strip()}

        elif intent == "add_note":
            q = (params.get("contact_query") or "").strip()
            note_text = (params.get("note_text") or "").strip()
            if not q or not note_text:
                raise HTTPException(status_code=422, detail="Nome cliente o testo nota mancanti")
            # V50.o — Match fuzzy: split query per parole e cerca ognuna in first/last_name
            q_tokens = [t for t in re.split(r"\s+", q) if t]
            or_conds: List[dict] = []
            for t in q_tokens:
                or_conds.append({"first_name": {"$regex": t, "$options": "i"}})
                or_conds.append({"last_name": {"$regex": t, "$options": "i"}})
            contact = await db.contacts.find_one(
                {"tenant_id": tenant, "$or": or_conds or [{"_": None}]},
                {"_id": 0, "id": 1, "first_name": 1, "last_name": 1},
            )
            if not contact:
                raise HTTPException(status_code=404, detail=f"Cliente '{q}' non trovato")
            note_doc = {
                "id": uuid.uuid4().hex,
                "contact_id": contact["id"],
                "tenant_id": tenant,
                "user_id": user["user_id"],
                "text": note_text,
                "created_at": utcnow(),
                "source": "voice_copilot",
            }
            await db.contact_notes.insert_one(note_doc)
            result_extra = {"contact_id": contact["id"], "note_id": note_doc["id"]}

        elif intent == "schedule_call":
            q = (params.get("contact_query") or "").strip()
            when_iso = (params.get("when_iso") or "").strip()
            if not q or not when_iso:
                raise HTTPException(status_code=422, detail="Nome cliente o data mancanti")
            try:
                when_dt = datetime.fromisoformat(when_iso.replace("Z", "+00:00"))
            except Exception:
                raise HTTPException(status_code=422, detail=f"Data non parsabile: {when_iso}")
            # V50.o — Fuzzy match per parole
            q_tokens = [t for t in re.split(r"\s+", q) if t]
            or_conds: List[dict] = []
            for t in q_tokens:
                or_conds.append({"first_name": {"$regex": t, "$options": "i"}})
                or_conds.append({"last_name": {"$regex": t, "$options": "i"}})
            contact = await db.contacts.find_one(
                {"tenant_id": tenant, "$or": or_conds or [{"_": None}]},
                {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "phone": 1},
            )
            if not contact:
                raise HTTPException(status_code=404, detail=f"Cliente '{q}' non trovato")
            cb_doc = {
                "id": uuid.uuid4().hex,
                "contact_id": contact["id"],
                "tenant_id": tenant,
                "user_id": user["user_id"],
                "phone": contact.get("phone", ""),
                "scheduled_at": when_dt,
                "notes": (params.get("notes") or "").strip(),
                "created_at": utcnow(),
                "status": "scheduled",
                "source": "voice_copilot",
            }
            await db.callbacks.insert_one(cb_doc)
            result_extra = {"callback_id": cb_doc["id"], "contact_id": contact["id"]}

        elif intent == "query":
            # Delega alla chat Axon normale
            result_extra = {"delegate_to_axon": params.get("question") or transcript}

        else:
            raise HTTPException(status_code=422, detail=f"Intent sconosciuto: {intent}")

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[voice-copilot] execution failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Errore esecuzione: {exc}")

    return {
        "intent": intent,
        "params": params,
        "confirmation": confirmation,
        "extra": result_extra,
        "transcript": transcript,
    }


# V50.o — TTS endpoint via OpenAI proxy Emergent (per copilot vocale).
class TTSIn(BaseModel):
    text: str
    voice: Optional[str] = "nova"  # openai voices: alloy/echo/fable/onyx/nova/shimmer


@api_router.post("/ai/tts")
async def ai_tts(body: TTSIn, user=Depends(get_current_user)):
    txt = (body.text or "").strip()
    if not txt:
        raise HTTPException(status_code=400, detail="Testo vuoto")
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(
                "https://integrations.emergentagent.com/llm/openai/v1/audio/speech",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": "tts-1",
                    "voice": (body.voice or "nova"),
                    "input": txt[:1000],
                    "response_format": "mp3",
                },
            )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"OpenAI TTS {r.status_code}: {r.text[:200]}")
        import base64 as _b64_tts
        audio_b64 = _b64_tts.b64encode(r.content).decode("utf-8")
        return {"audio_base64": audio_b64, "mime": "audio/mp3", "chars": len(txt)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[tts] failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Errore TTS: {exc}")


@api_router.post("/ai/contact-from-card")
async def ai_contact_from_card(body: AIImageIn, user=Depends(get_current_user)):
    """V38I — OCR + extraction of a business card image via Gemini vision.
    Bug fix: previously `'ImageContent' in dir()` was always False inside the
    function scope, so the image was never attached and Gemini returned an error
    → HTTP 502. Also added better error propagation and a fallback model."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    b64 = body.image_base64 or ""
    if not b64:
        raise HTTPException(status_code=400, detail="Immagine mancante")
    # Normalise to a BARE base64 string (no data URL prefix) — this is what
    # emergentintegrations.ImageContent(image_base64=...) expects. Its mime
    # detection looks at the base64 magic bytes (iVBORw0KGgo / /9j/ / etc.).
    if b64.startswith("data:"):
        # strip "data:<mime>;base64,"
        try:
            bare_b64 = b64.split(",", 1)[1]
        except IndexError:
            bare_b64 = b64
    else:
        bare_b64 = b64
    back_b64 = (body.back_image_base64 or "").split(",", 1)[-1] if body.back_image_base64 else ""

    async def _run(model_name: str):
        chat = LlmChat(
            api_key=key,
            session_id=f"card-ocr-{uuid.uuid4().hex[:8]}",
            system_message=CONTACT_EXTRACTION_SYSTEM,
        ).with_model("gemini", model_name)
        intro = ("Ecco le immagini di un biglietto da visita italiano: la PRIMA è il FRONTE, la SECONDA è il RETRO (leggile entrambe, potrebbero essere ruotate). Unisci le informazioni dei due lati: dal retro prendi servizi offerti, orari di apertura, marchi/partner, social, slogan e mettili in `notes` insieme all'attività; eventuali numeri/email/persone aggiuntive vanno nei rispettivi campi. "
                 if back_b64 else "Ecco l'immagine di un biglietto da visita italiano (potrebbe essere ruotato: leggilo in ogni orientamento). ")
        msg = UserMessage(
            text=intro + "Estrai TUTTI i dati: nome, cognome, ruolo, azienda (ragione sociale completa), OGNI numero di telefono con la sua etichetta (cellulari di ciascuna persona, telefono fisso, fax), OGNI email, partita IVA, indirizzo con civico, CAP, città, provincia, sito web, altre persone citate (soci/colleghi) con i loro numeri, e una nota sull'attività (servizi, orari). Restituisci un JSON compatto.",
            file_contents=[ImageContent(image_base64=bare_b64)] + ([ImageContent(image_base64=back_b64)] if back_b64 else []),
        )
        return await chat.send_message(msg)

    resp = None
    last_err: Optional[Exception] = None
    for model in ("gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash"):
        try:
            resp = await _run(model)
            if resp:
                break
        except Exception as e:
            last_err = e
            logger.warning(f"card OCR failed with {model}: {e}")
            continue
    if resp is None:
        raise HTTPException(
            status_code=422,
            detail=f"Impossibile leggere il biglietto: {str(last_err)[:200] if last_err else 'nessuna risposta'}"
        )

    raw = (resp or "").strip()
    # V38Z — robust JSON parsing (never raises)
    data = _parse_llm_json(raw, fallback_key="notes")
    data.pop("parse_error", None)
    data.pop("error_message", None)
    data.pop("parse_error_kind", None)
    return {"contact": _norm_extracted_contact(data)}


# =========================
