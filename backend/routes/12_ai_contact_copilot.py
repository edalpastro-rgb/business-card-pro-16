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
    verify_speaker: bool = False  # V50.z372 — Axon Drive: verifica impronta vocale (voce sconosciuta → transcript vuoto, reason unknown_voice)


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


# V50.z432 — Rilevamento formato audio dai magic bytes + normalizzazione WAV via ffmpeg (imageio-ffmpeg)
_WHISPER_OK_EXTS = {".m4a", ".mp3", ".wav", ".webm", ".ogg", ".flac", ".mp4", ".mpeg", ".mpga", ".oga"}


def _sniff_audio_ext(data: bytes, mime: str) -> str:
    head = data[:16]
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        return ".3gp" if brand.startswith(b"3gp") else ".m4a"
    if head[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return ".wav"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return ".webm"
    if head[:4] == b"OggS":
        return ".ogg"
    if head[:4] == b"fLaC":
        return ".flac"
    if head[:3] == b"ID3" or (head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return ".mp3"
    if head[:5] == b"#!AMR":
        return ".amr"
    # fallback sul mime dichiarato dal client
    if "webm" in mime:
        return ".webm"
    if "m4a" in mime or "mp4" in mime or "aac" in mime:
        return ".m4a"
    if "wav" in mime:
        return ".wav"
    if "ogg" in mime:
        return ".ogg"
    if "mp3" in mime or "mpeg" in mime:
        return ".mp3"
    return ".bin"


async def _audio_to_wav16k(data: bytes) -> Optional[bytes]:
    """Converte qualsiasi audio in WAV PCM 16 kHz mono con ffmpeg (stdin → stdout). None se ffmpeg manca o fallisce."""
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            ffmpeg, "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
            "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(data), timeout=40)
        if proc.returncode != 0 or len(out) < 1024:
            logger.warning(f"[transcribe] ffmpeg conversione fallita: {err[:200]!r}")
            return None
        return out
    except Exception as exc:
        logger.warning(f"[transcribe] ffmpeg non disponibile: {exc}")
        return None


_DG_MIME_BY_EXT = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".webm": "audio/webm", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".flac": "audio/flac", ".mpeg": "audio/mpeg", ".mpga": "audio/mpeg"}


async def _dg_transcribe_text(audio_bytes: bytes, ext: str, key: str) -> str:
    """V50.z483 — Deepgram nova-3 (it) per Axon Drive / dettatura: veloce e indipendente dal proxy LLM. Ritorna il testo (anche vuoto)."""
    import httpx as _hx
    params = {"model": os.environ.get("DEEPGRAM_MODEL", "nova-3"), "language": "it", "smart_format": "true", "punctuate": "true"}
    async with _hx.AsyncClient(timeout=_hx.Timeout(60.0)) as client:
        r = await client.post("https://api.deepgram.com/v1/listen", params=params, headers={"Authorization": f"Token {key}", "Content-Type": _DG_MIME_BY_EXT.get(ext, "application/octet-stream")}, content=audio_bytes)
    if r.status_code >= 400:
        raise RuntimeError(f"Deepgram HTTP {r.status_code}: {r.text[:200]}")
    ch = (r.json().get("results") or {}).get("channels") or []
    alt = ((ch[0].get("alternatives") or [{}])[0]) if ch else {}
    return (alt.get("transcript") or "").strip()


@api_router.post("/ai/transcribe")
async def ai_transcribe(body: AIVoiceIn, user=Depends(get_current_user)):
    """Transcribe audio to text. V50.z483 — Deepgram (DEEPGRAM_API_KEY, nova-3 it) se configurato, altrimenti OpenAI Whisper.
    Returns just the raw transcript — used by Axon Drive, dictation buttons and the contact card notes.
    """
    key = os.environ.get("EMERGENT_LLM_KEY")
    dg_key = (os.environ.get("DEEPGRAM_API_KEY") or "").strip()
    if not key and not dg_key:
        raise HTTPException(status_code=500, detail="Nessun motore di trascrizione configurato (DEEPGRAM_API_KEY o EMERGENT_LLM_KEY)")
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
    # V50.z432 — il formato REALE si decide dai magic bytes (Android può produrre .3gp/AMR anche se il client dice m4a);
    # i formati non supportati da Whisper (3gp/AMR/sconosciuti) vengono convertiti in WAV 16 kHz mono con ffmpeg.
    ext = _sniff_audio_ext(audio_bytes, mime)
    if ext not in _WHISPER_OK_EXTS:
        converted = await _audio_to_wav16k(audio_bytes)
        if converted:
            audio_bytes, ext = converted, ".wav"
        else:
            raise HTTPException(status_code=415, detail="Formato audio non supportato dal dispositivo: riprova o aggiorna l'app.")
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        path = tmp.name
    vp_task = asyncio.create_task(vp_verify_for_user(user, audio_bytes, mime)) if body.verify_speaker else None  # noqa: F821  # V50.z372
    model_used = "whisper-1"
    transcript: Optional[str] = None
    if dg_key:
        try:
            transcript = await _dg_transcribe_text(audio_bytes, ext, dg_key)
            model_used = "deepgram-" + os.environ.get("DEEPGRAM_MODEL", "nova-3")
        except Exception as dg_exc:  # fallback Whisper se disponibile
            logger.warning(f"[transcribe] Deepgram fallito ({dg_exc}) → fallback Whisper={'sì' if key else 'no'}")
            transcript = None
            if not key:
                try: os.unlink(path)
                except Exception: pass
                raise HTTPException(status_code=502, detail=f"Errore trascrizione Deepgram: {str(dg_exc)[:200]}")
    try:
        if transcript is not None:
            result = transcript
        else:
            from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
            stt = OpenAISpeechToText(api_key=key)
            try:
                with open(path, "rb") as _fh:
                    result = await stt.transcribe(file=_fh, model="whisper-1", language="it", response_format="text")
            except Exception as first_err:
                # V50.z432 — ultimo tentativo: normalizza in WAV e riprova (copre container m4a «strani» di alcuni Android)
                if ext == ".wav" or "format" not in str(first_err).lower():
                    raise
                converted = await _audio_to_wav16k(audio_bytes)
                if not converted:
                    raise
                with open(path, "wb") as _fw:
                    _fw.write(converted)
                with open(path, "rb") as _fh:
                    result = await stt.transcribe(file=_fh, model="whisper-1", language="it", response_format="text")
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
    if vp_task is not None:
        vp = await vp_task
        if vp is not None and not vp.get("match"):
            await db.viola_wake_events.insert_one({"kind": "unknown_voice", "detail": f"Axon Drive · score {vp.get('score')} < soglia {vp.get('threshold')}", "engine": "ecapa",
                                                   "event_id": f"vw_{uuid.uuid4().hex[:10]}", "user_id": user["user_id"], "tenant_id": tenant_id(user), "created_at": utcnow()})
            return {"transcript": "", "reason": "unknown_voice", "silent": True, "speaker": None, "score": vp.get("score"), "language": "it", "model": model_used}
        return {"transcript": transcript, "language": "it", "model": model_used, "speaker": (vp or {}).get("profile"), "speaker_score": (vp or {}).get("score")}
    return {"transcript": transcript, "language": "it", "model": model_used}


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
    pending_contact_id: Optional[str] = None   # V50.z368 — conferma «Intendi il tuo cliente X?» in corso
    pending_question: Optional[str] = None
    guard_token: Optional[str] = None          # V50.z371 — conferma PIN/biometria per comandi critici
    want_audio: bool = True                    # V50.z368 — TTS nella stessa risposta (voce del profilo Axon), niente 2° round-trip
    speaker_profile_id: Optional[str] = None   # V50.z372 — voce riconosciuta (permessi voci secondarie)
    pending_nav_contact_id: Optional[str] = None  # V50.z495 — Axon Drive: scelta indirizzo in sospeso («casa o lavoro?»)


# V50.z368 — PRIORITÀ CRM: prima di qualsiasi ragionamento si cercano i NOMI presenti nella frase tra contatti/clienti del tenant
# (match esatto o parziale/fonetico, es. «col ferraio» → «Carlo Colferai»). Mai fonti esterne se il dato può essere nel CRM.
_VC_STOP = {"che", "chi", "come", "cosa", "dove", "quando", "quale", "quanto", "numero", "telefono", "mail", "email", "cliente", "contatto",
            "chiama", "chiamare", "manda", "mandare", "nota", "appuntamento", "domani", "oggi", "alle", "ore", "con", "per", "del", "della",
            "dello", "dei", "delle", "il", "lo", "la", "le", "gli", "un", "una", "uno", "di", "da", "in", "su", "mi", "ti", "ci", "si", "ha",
            "hai", "ho", "è", "sono", "sai", "dimmi", "dammi", "cerca", "trova", "vorrei", "voglio", "sapere", "signor", "signora", "dottor",
            "crea", "nuovo", "nuova", "segna", "ricorda", "ricordami", "fissa", "quanti", "quante", "questo", "questa", "axon", "viola"}


def _vc_norm(t: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]+", " ", t).strip()


async def _vc_crm_candidates(user: dict, transcript: str) -> List[dict]:
    import difflib
    words = [w for w in _vc_norm(transcript).split() if len(w) >= 3 and w not in _VC_STOP]
    if not words:
        return []
    queries = set(words) | {f"{a}{b}" for a, b in zip(words, words[1:])} | {f"{a} {b}" for a, b in zip(words, words[1:])}
    rows = await db.contacts.find({"user_id": tenant_id(user)}, {"_id": 0, "contact_id": 1, "id": 1, "first_name": 1, "last_name": 1, "company": 1, "phone": 1,
                                                                  "phone_alt": 1, "email": 1, "address_city": 1, "area": 1, "general_note": 1}).to_list(4000)
    out = []
    for c in rows:
        first, last, comp = _vc_norm(c.get("first_name") or ""), _vc_norm(c.get("last_name") or ""), _vc_norm(c.get("company") or "")
        full = f"{first} {last}".strip()
        best = 0.0
        for q in queries:
            for target in (first, last, full, comp, last.replace(" ", ""), full.replace(" ", "")):
                if not target or len(target) < 3:
                    continue
                if q == target or (len(q) >= 4 and (q in target or target in q)):
                    best = max(best, 0.95 if q == target else 0.85)
                else:
                    best = max(best, difflib.SequenceMatcher(None, q, target).ratio())
        if best >= 0.62:
            out.append({"score": round(best, 2), "contact_id": c.get("contact_id") or c.get("id"), "name": f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip(),
                        "company": c.get("company"), "phone": c.get("phone") or c.get("phone_alt"), "email": c.get("email"), "city": c.get("address_city"), "area": c.get("area"),
                        "note": (c.get("general_note") or "")[:160]})
    out.sort(key=lambda x: -x["score"])
    return out[:4]


_VOICE_INTENT_PROMPT = """Sei un intent classifier per un CRM italiano.
Data una trascrizione vocale dell'utente (consulente energetico in auto),
identifica l'intent tra:
- create_contact: creare un NUOVO cliente/contatto
- add_note: aggiungere una nota a un cliente ESISTENTE
- schedule_call: programmare una telefonata di richiamo (richiamata/ritelefonata)
- list_callbacks: MOSTRARE/elencare le ritelefonate (richiamate) programmate («mostrami le ritelefonate di oggi», «che richiamate ho domani»)
- read_note: leggere l'ULTIMA nota di un cliente («leggimi l'ultima nota su Zanini», «cosa ho scritto su Rossi»)
- navigate_to: portare l'utente da un cliente / indicazioni stradali («portami da Zanini», «dammi le indicazioni per Rossi», «naviga verso Bianchi»)
- query: qualsiasi altra domanda o richiesta informativa

Rispondi SOLO con un JSON valido in questo formato esatto:
{
  "intent": "create_contact" | "add_note" | "schedule_call" | "list_callbacks" | "read_note" | "navigate_to" | "query" | "confirm_contact",
  "params": {
    // per create_contact: first_name, last_name, phone, email, city, area (energy/network)
    // per add_note: contact_query (nome/cognome cercabile), contact_id (id dal CRM se presente), note_text
    // per schedule_call: contact_query, contact_id (id dal CRM se presente), when_iso (ISO8601 con timezone Europe/Rome), notes
    // per list_callbacks: day ("today" | "tomorrow" | "YYYY-MM-DD"; default today)
    // per read_note: contact_query, contact_id (id dal CRM se presente)
    // per navigate_to: contact_query, contact_id (id dal CRM se presente), nav_app ("waze" | "google" solo se l'utente lo nomina)
    // per query: question, answer (RISPOSTA COMPLETA da leggere a voce, max 45 parole, usando SOLO i dati CRM forniti)
    // per confirm_contact: contact_id, contact_name (quando il nome detto corrisponde solo PARZIALMENTE a un cliente)
  },
  "confirmation": "frase in italiano da leggere all'utente (max 15 parole; per confirm_contact ESATTAMENTE: Intendi il tuo cliente <Nome Cognome>?)"
}

Per schedule_call / add_note / read_note / navigate_to con un cliente presente nel CRM (score ≥ 0.62): usa SEMPRE il suo id in contact_id.

PRIORITÀ CRM (obbligatoria): se la frase contiene un nome di persona/azienda, la fonte è SOLO la sezione CONTATTI CRM qui sotto.
- Match forte (score ≥ 0.9): rispondi subito con i dati del CRM (intent "query" + "answer").
- Match parziale (score < 0.9, es. «col ferraio» → «Carlo Colferai»): intent "confirm_contact", NON rispondere ancora.
- Nessun candidato: di' che nel CRM non c'è un cliente con quel nome e proponi di crearlo. MAI Google o fonti esterne.

Regole:
- ORA in Italia (Europe/Rome): %s. Calcola TUTTE le date rispetto a questo momento. «domani alle 10» = giorno successivo ore 10:00;
  un giorno della settimana («lunedì alle 9») = la PROSSIMA occorrenza futura di quel giorno (mai nel passato); senza ora → 09:00.
  when_iso deve avere l'offset di Roma (es. 2026-10-12T09:00:00+02:00).
- Se un campo manca, ometti la chiave (non mettere null o stringa vuota).
- La confirmation deve essere naturale e concisa, es. "Ho creato Mario Rossi con numero 3331234567".

"""


@api_router.post("/voice/copilot/execute")
async def voice_copilot_execute(body: VoiceCopilotIn, background: BackgroundTasks, user=Depends(get_current_user)):
    """V50.o — Copilot vocale hands-free: intent parsing + execution."""
    transcript = (body.transcript or "").strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="Trascrizione vuota")
    # V50.z495 — scelta indirizzo in sospeso («casa o lavoro?») → risposta deterministica, nessun LLM
    if body.pending_nav_contact_id:
        nav_pick = await _vd_pick_address(user, body.pending_nav_contact_id, transcript, body.want_audio)
        if nav_pick:
            return {**nav_pick, "transcript": transcript}
    # V50.z371 — comandi critici mai eseguiti solo su voce: serve conferma PIN/impronta (token monouso 90 s)
    g_cat = vg_is_critical(transcript)  # noqa: F821
    # V50.z372 — voce secondaria: permessi (Drive = dati CRM; critici solo se abilitati, e comunque con PIN)
    speaker = await vp_profile_for(user, body.speaker_profile_id)  # noqa: F821
    denied = vp_permission_denied(speaker, "critical" if g_cat else "crm") if speaker else None  # noqa: F821
    if denied:
        audio_b64 = None
        try:
            audio_b64 = (await axon_tts_generate(user, denied, None)).get("audio_base64")  # noqa: F821
        except Exception:  # noqa: BLE001
            pass
        return {"intent": "denied", "spoken": denied, "confirmation": denied, "audio_base64": audio_b64, "params": {}, "extra": {}, "transcript": transcript}
    if g_cat and not await vg_check_token(user, body.guard_token):  # noqa: F821
        spoken = "Comando critico: confermalo con impronta o PIN."
        audio_b64 = None
        try:
            audio_b64 = (await axon_tts_generate(user, spoken, None)).get("audio_base64")  # noqa: F821
        except Exception:  # noqa: BLE001
            pass
        return {"intent": "guard_required", "category": g_cat, "spoken": spoken, "confirmation": spoken, "audio_base64": audio_b64, "params": {}, "extra": {}, "transcript": transcript}
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    # V50.z458 — Prompt 19: comando vocale multi-step → stesso agente della chat (axon_agent.py); riepilogo parlato senza marker
    _ag = (await _maybe_emergency_command(transcript, user)) or (await _maybe_agent_command(transcript, user))  # noqa: F821 — V50.z460 emergenze + agente
    if _ag and _ag.get("reply"):
        _ag_spoken = re.sub(r"\[\[(NAV|ACTION):[^\]]*\]\]", "", _ag["reply"]).replace("**", "").replace("↳ ", "").strip()
        _ag_audio = None; _ag_mime = None
        if body.want_audio:
            try:
                _ag_tts = await axon_tts_generate(user, _ag_spoken[:600], None)  # noqa: F821
                _ag_audio, _ag_mime = _ag_tts.get("audio_base64"), _ag_tts.get("mime")
            except Exception as exc:  # noqa: BLE001
                logger.warning("[voice-copilot] agent tts failed: %s", exc)
        return {"spoken": _ag_spoken, "audio_base64": _ag_audio, "audio_mime": _ag_mime, "intent": "agent", "params": {}, "confirmation": _ag_spoken,
                "extra": {"reply": _ag["reply"], "cmd": _ag.get("cmd"), "agent_status": _ag.get("agent_status")}, "transcript": transcript}

    now_iso = _vd_fmt_now(_vd_now_rome())  # noqa: F821 — V50.z495 — giorno della settimana + ora locale Roma: «lunedì alle 9» calcolato bene
    # V50.z368 — CRM-first: candidati dal CRM (o cliente in attesa di conferma) nel prompt, prima di tutto il resto
    candidates = await _vc_crm_candidates(user, transcript)
    if body.pending_contact_id:
        pc = await db.contacts.find_one({"user_id": tenant_id(user), "$or": [{"contact_id": body.pending_contact_id}, {"id": body.pending_contact_id}]},
                                        {"_id": 0, "contact_id": 1, "id": 1, "first_name": 1, "last_name": 1, "company": 1, "phone": 1, "phone_alt": 1, "email": 1, "address_city": 1, "area": 1, "general_note": 1})
        if pc:
            candidates = [{"score": 1.0, "contact_id": pc.get("contact_id") or pc.get("id"), "name": f"{pc.get('first_name') or ''} {pc.get('last_name') or ''}".strip(), "company": pc.get("company"),
                           "phone": pc.get("phone") or pc.get("phone_alt"), "email": pc.get("email"), "city": pc.get("address_city"), "area": pc.get("area"), "note": (pc.get("general_note") or "")[:160]}] + [c for c in candidates if c["contact_id"] != (pc.get("contact_id") or pc.get("id"))]
    crm_block = "\nCONTATTI CRM (candidati per i nomi nella frase, score 0-1):\n" + ("\n".join(
        f"- {c['name']}{' · ' + c['company'] if c.get('company') else ''} · score {c['score']} · id {c['contact_id']} · tel {c.get('phone') or 'n.d.'} · email {c.get('email') or 'n.d.'} · città {c.get('city') or 'n.d.'} · area {c.get('area') or 'n.d.'}{' · note: ' + c['note'] if c.get('note') else ''}"
        for c in candidates) if candidates else "(nessun cliente corrispondente nel CRM)")
    if body.pending_contact_id and body.pending_question:
        crm_block += f"\nCONFERMA IN CORSO: avevi chiesto «Intendi il tuo cliente {candidates[0]['name'] if candidates else ''}?» per la domanda «{body.pending_question}». " \
                     "Se l'utente conferma (sì/esatto/giusto/lui/lei), rispondi ORA alla domanda con i dati di quel cliente (intent query + answer). Se nega, chiedi il nome esatto."
    prompt = _VOICE_INTENT_PROMPT % now_iso + crm_block + "\n\nTrascrizione utente:\n" + transcript
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
            # V50.z495 — stesso percorso del «Nuovo contatto» manuale (contact_id, created_by, contact_code, notes/files…)
            new_c = await create_contact(ContactIn(  # noqa: F821
                first_name=first_name or last_name, last_name=last_name if first_name else "",
                phone=(params.get("phone") or "").strip(), email=(params.get("email") or "").strip(),
                address_city=(params.get("city") or "").strip(),
                area=params.get("area") if params.get("area") in ("energy", "network") else "energy",
            ), user)
            result_extra = {"contact_id": new_c["contact_id"], "name": f"{first_name} {last_name}".strip()}

        elif intent == "add_note":
            note_text = (params.get("note_text") or "").strip()
            if not note_text:
                raise HTTPException(status_code=422, detail="Testo nota mancante")
            contact = await _vd_find_contact(user, params, candidates, body.pending_contact_id)
            # V50.z495 — la nota va nell'array contacts.notes (come dalla scheda), non in una collezione separata invisibile
            note = await add_note(contact["contact_id"], ContactNote(kind="text", text=note_text), background, user)  # noqa: F821
            result_extra = {"contact_id": contact["contact_id"], "note_id": note.get("id")}

        elif intent == "schedule_call":
            when_iso = (params.get("when_iso") or "").strip()
            if not when_iso:
                raise HTTPException(status_code=422, detail="Data mancante")
            try:
                when_dt = datetime.fromisoformat(when_iso.replace("Z", "+00:00"))
            except Exception:
                raise HTTPException(status_code=422, detail=f"Data non parsabile: {when_iso}")
            if when_dt.tzinfo is None:
                when_dt = when_dt.replace(tzinfo=_vd_zoneinfo.ZoneInfo("Europe/Rome"))
            contact = await _vd_find_contact(user, params, candidates, body.pending_contact_id)
            cname = f"{contact.get('first_name') or ''} {contact.get('last_name') or ''}".strip()
            # V50.z495 — BUG: la richiamata era scritta con campi propri (id/notes/status, senza callback_id/title/area/done/created_by)
            # → invisibile in Home e nella scheda. Ora passa dallo STESSO create_callback del form manuale.
            cb = await create_callback(CallbackIn(  # noqa: F821
                contact_id=contact["contact_id"], title=cname or "Ritelefonata",
                area=contact.get("area") if contact.get("area") in ("energy", "network") else "energy",
                scheduled_at=when_dt, note=(params.get("notes") or "").strip(), phone=contact.get("phone") or contact.get("phone_alt") or None,
            ), user)
            result_extra = {"callback_id": cb["callback_id"], "contact_id": contact["contact_id"], "scheduled_at": when_dt.isoformat()}

        elif intent == "list_callbacks":
            # V50.z495 — display dinamico Axon Drive: elenco ritelefonate del giorno
            result_extra = await _vd_list_callbacks(user, (params.get("day") or "today").strip())

        elif intent == "read_note":
            contact = await _vd_find_contact(user, params, candidates, body.pending_contact_id)
            result_extra = _vd_last_note(contact)

        elif intent == "navigate_to":
            contact = await _vd_find_contact(user, params, candidates, body.pending_contact_id)
            result_extra = _vd_navigate(contact, (params.get("nav_app") or "").strip().lower() or None)

        elif intent == "query":
            # V50.z368 — risposta diretta (CRM-first) già nel JSON; nessun 2° giro LLM
            result_extra = {"answer": (params.get("answer") or "").strip() or None, "crm_candidates": candidates[:3]}

        elif intent == "confirm_contact" and candidates and candidates[0]["score"] >= 0.9 and not body.pending_contact_id and params.get("answer"):
            # V50.z371 — match forte nel CRM: niente conferma, risposta diretta (deterministico)
            intent = "query"; result_extra = {"answer": params["answer"].strip(), "crm_candidates": candidates[:3]}

        elif intent == "confirm_contact":
            cid = params.get("contact_id") or (candidates[0]["contact_id"] if candidates else None)
            cname = params.get("contact_name") or (candidates[0]["name"] if candidates else "")
            result_extra = {"pending_contact_id": cid, "pending_question": transcript, "contact_name": cname}
            if cname:
                parsed["confirmation"] = f"Intendi il tuo cliente {cname}?"

        else:
            raise HTTPException(status_code=422, detail=f"Intent sconosciuto: {intent}")

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("[voice-copilot] execution failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Errore esecuzione: {exc}")

    spoken = (result_extra.get("answer") if isinstance(result_extra, dict) else None) or parsed.get("confirmation") or "Fatto."
    audio_b64 = None; audio_mime = None
    if body.want_audio:
        try:
            tts = await axon_tts_generate(user, spoken[:320], None)  # noqa: F821 — voce del PROFILO Axon (assistant_voice), mai voce fissa
            audio_b64, audio_mime = tts.get("audio_base64"), tts.get("mime")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[voice-copilot] tts failed: %s", exc)
    return {
        "spoken": spoken,
        "audio_base64": audio_b64,
        "audio_mime": audio_mime,
        "intent": intent,
        "params": params,
        "confirmation": confirmation,
        "extra": result_extra,
        "transcript": transcript,
    }


# V50.o — TTS endpoint via OpenAI proxy Emergent (per copilot vocale).
class TTSIn(BaseModel):
    text: str
    voice: Optional[str] = None  # V50.z368 — default = voce del profilo Axon (assistant_voice)  # openai voices: alloy/echo/fable/onyx/nova/shimmer


@api_router.post("/ai/tts")
async def ai_tts(body: TTSIn, user=Depends(get_current_user)):
    """V50.z347 — stesso motore di /assistant/tts (Kokoro locale o OpenAI)."""
    out = await axon_tts_generate(user, (body.text or "")[:1000], body.voice)
    out["chars"] = len((body.text or "").strip())
    return out


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
