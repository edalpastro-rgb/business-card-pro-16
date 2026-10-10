# 25_health_birthday_banners.py — Health, generatore auguri, banner eventi
# Estratto da server.py (righe originali 17421-18108). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Health
# =========================
@api_router.get("/")
async def root():
    return {"message": "ProSync CRM API", "ok": True}


# =========================
# V38H — AI Birthday message generator
# =========================
class BirthdayGenIn(BaseModel):
    contact_id: str
    is_active_client: Optional[bool] = None  # override; if None uses stored value

@api_router.post("/contacts/{contact_id}/birthday/generate-message")
async def generate_birthday_message(contact_id: str, user=Depends(get_current_user)):
    """Generate a fresh, human-sounding birthday message using Claude Sonnet 5.
    The message uses the contact's first name and varies year over year. If the
    contact is marked as active client (`is_active_client=True`) the message also
    thanks them for their continued trust and invites them to reach out."""
    contact = await _ensure_contact_owned(contact_id, user)
    first_name = (contact.get("first_name") or "").strip() or "Cliente"
    is_active = bool(contact.get("is_active_client"))
    year = datetime.now(timezone.utc).year

    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")

    # Include prior years' generated messages to encourage variation
    prior = await db.birthday_messages.find(
        {"user_id": tenant_id(user), "contact_id": contact_id},
        {"_id": 0, "year": 1, "message": 1},
    ).sort("year", -1).limit(3).to_list(3)
    prior_txt = ""
    if prior:
        prior_txt = "\n\nMessaggi degli anni precedenti (NON riscriverli, cambia stile e parole):\n" + "\n".join(
            [f"- {p['year']}: {p.get('message', '')[:200]}" for p in prior]
        )

    system = (
        "Sei un consulente energetico italiano che scrive messaggi di auguri "
        "di compleanno personalizzati ai propri clienti. Il messaggio deve essere:\n"
        "- Caldo, sincero e personale — MAI generico o da spam\n"
        "- Breve (3-6 frasi, massimo 500 caratteri totali)\n"
        "- Scritto in prima persona come consulente\n"
        "- Con un tocco di originalità (metafora, ricordo simbolico, riferimento alla stagione, alla città…)\n"
        "- Firmato genericamente 'Il tuo Consulente' o simile (non usare un nome specifico)\n"
        "- Diverso dai messaggi degli anni scorsi\n"
        "Rispondi solo con il testo del messaggio, senza intestazioni né virgolette."
    )
    user_prompt = (
        f"Genera il messaggio di auguri di compleanno {year} per {first_name}."
        + (
            "\n\nQuesto cliente è ATTIVO: ringrazialo brevemente per la continua fiducia "
            "e invita gentilmente a contattarti per qualsiasi dubbio o consulenza — senza forzare la vendita."
            if is_active else
            "\n\nNon è più un cliente attivo: mantieni il messaggio cordiale e cortese, senza riferimenti commerciali."
        )
        + prior_txt
    )

    chat = LlmChat(
        api_key=key,
        session_id=f"bday-{contact_id}-{year}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-5")

    try:
        resp = await chat.send_message(UserMessage(text=user_prompt))
        message = (resp or "").strip().strip('"').strip("'")
        if not message:
            raise Exception("Messaggio vuoto")
        # Trim overly long output
        if len(message) > 800:
            message = message[:800].rsplit(".", 1)[0] + "."
    except Exception as e:
        logger.exception(f"birthday gen failed: {e}")
        raise HTTPException(status_code=500, detail=f"Impossibile generare il messaggio: {str(e)[:200]}")

    # Persist so future generations can vary from it
    await db.birthday_messages.insert_one({
        "user_id": tenant_id(user),
        "contact_id": contact_id,
        "year": year,
        "message": message,
        "is_active_client": is_active,
        "created_at": utcnow(),
    })
    return {"message": message, "year": year, "is_active_client": is_active}


@api_router.get("/contacts/{contact_id}/birthday/history")
async def birthday_history(contact_id: str, user=Depends(get_current_user)):
    """Return previously generated birthday messages for a contact."""
    await _ensure_contact_owned(contact_id, user)
    items = await db.birthday_messages.find(
        {"user_id": tenant_id(user), "contact_id": contact_id},
        {"_id": 0},
    ).sort("year", -1).limit(10).to_list(10)
    return {"items": items}


# =========================
# v2.10 (Feb 2026) — Event Banners
# Master can create a homepage banner for a scheduled event. Banner has cover,
# title, event date, program (uploaded PDF or AI-generated HTML), and per-user /
# per-contact / per-group visibility. Team collaborators see it in their home.
# Contacts can view via a public link (no auth). Countdown rendered client-side.
# =========================

class EventBannerIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    event_at: datetime
    event_end_at: Optional[datetime] = None  # v2.18 — optional end date for ranges
    description: Optional[str] = None  # v2.18 — free-text description
    cover_base64: str = Field(min_length=10)
    cover_mime: str = "image/jpeg"
    program_pdf_base64: Optional[str] = None
    program_pdf_name: Optional[str] = None
    program_html: Optional[str] = None  # AI-generated OR manually provided
    # v2.18 — Optional audio attachment (announcement/promo voice message)
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None  # audio/mpeg | audio/mp4 | audio/wav | audio/m4a
    audio_name: Optional[str] = None
    # Visibility
    visibility_kind: str = "all"  # "all" | "specific"
    visible_user_ids: List[str] = Field(default_factory=list)
    visible_contact_ids: List[str] = Field(default_factory=list)
    visible_group_ids: List[str] = Field(default_factory=list)


class EventBannerUpdate(BaseModel):
    title: Optional[str] = None
    event_at: Optional[datetime] = None
    event_end_at: Optional[datetime] = None
    description: Optional[str] = None
    cover_base64: Optional[str] = None
    cover_mime: Optional[str] = None
    program_pdf_base64: Optional[str] = None
    program_pdf_name: Optional[str] = None
    program_html: Optional[str] = None
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = None
    audio_name: Optional[str] = None
    visibility_kind: Optional[str] = None
    visible_user_ids: Optional[List[str]] = None
    visible_contact_ids: Optional[List[str]] = None
    visible_group_ids: Optional[List[str]] = None


def _ensure_master(user: dict):
    """Only the master (owner/no parent) or admin can manage event banners."""
    role = user.get("role") or "member"
    if role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Solo il master può gestire gli eventi")


def _event_visible_to_user(banner: dict, user: dict) -> bool:
    """Team-member visibility check. Master (owner) always sees own banners."""
    if banner.get("user_id") != tenant_id(user):
        return False
    if banner.get("visibility_kind", "all") == "all":
        return True
    uids = banner.get("visible_user_ids") or []
    return user.get("user_id") in uids or user.get("role") == "owner"


def _strip_banner_heavy(b: dict) -> dict:
    """Return a light copy without cover/PDF base64 blobs for list endpoints."""
    out = {k: v for k, v in b.items() if k not in ("cover_base64", "program_pdf_base64", "program_html")}
    out["_id"] = None
    strip_id(out)
    return out


@api_router.post("/event-banners")
async def create_event_banner(body: EventBannerIn, user=Depends(get_current_user)):
    _ensure_master(user)
    if body.visibility_kind not in ("all", "specific"):
        raise HTTPException(status_code=400, detail="visibility_kind non valido")
    event_id = f"evt_{uuid.uuid4().hex[:12]}"
    public_token = uuid.uuid4().hex
    doc = {
        "event_id": event_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "title": body.title.strip(),
        "event_at": body.event_at,
        "event_end_at": body.event_end_at,  # v2.18
        "description": (body.description or "").strip() or None,  # v2.18
        "cover_base64": body.cover_base64,
        "cover_mime": body.cover_mime or "image/jpeg",
        "program_pdf_base64": body.program_pdf_base64,
        "program_pdf_name": body.program_pdf_name,
        "program_html": body.program_html,
        "audio_base64": body.audio_base64,  # v2.18
        "audio_mime": body.audio_mime,
        "audio_name": body.audio_name,
        "visibility_kind": body.visibility_kind,
        "visible_user_ids": body.visible_user_ids or [],
        "visible_contact_ids": body.visible_contact_ids or [],
        "visible_group_ids": body.visible_group_ids or [],
        "public_token": public_token,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.event_banners.insert_one(doc)
    return {"ok": True, "event_id": event_id, "public_token": public_token}


@api_router.get("/event-banners")
async def list_event_banners(user=Depends(get_current_user)):
    """Master view: list all banners in tenant (light)."""
    _ensure_master(user)
    items = await db.event_banners.find(
        {"user_id": tenant_id(user)},
        {"_id": 0, "cover_base64": 0, "program_pdf_base64": 0, "program_html": 0},
    ).sort("event_at", -1).to_list(200)
    return {"items": items}


@api_router.get("/event-banners/active")
async def list_active_event_banners(user=Depends(get_current_user)):
    """Any authenticated user (master + collaborators) can call this to fetch
    the banners currently visible to them (event_at in future, visibility ok).
    Returns light payload (cover_base64 included for rendering, no PDF/HTML/audio)."""
    now = utcnow()
    # V27 fix — show banners that are UPCOMING (event_at in future) OR ONGOING
    # (event_at in past but event_end_at in future OR within 24h grace period).
    # This fixes the bug where Master-created banners with "TUTTI" didn't appear
    # if their event_at was already reached.
    grace_cutoff = now - timedelta(hours=24)
    all_banners = await db.event_banners.find(
        {
            "user_id": tenant_id(user),
            "$or": [
                {"event_at": {"$gte": now}},
                {"event_end_at": {"$gte": now}},
                {"event_at": {"$gte": grace_cutoff}, "event_end_at": None},
            ],
        },
        {"_id": 0, "program_pdf_base64": 0, "program_html": 0, "audio_base64": 0},
    ).sort("event_at", 1).to_list(50)
    visible = [b for b in all_banners if _event_visible_to_user(b, user)]
    return {"items": visible}


@api_router.get("/event-banners/{event_id}")
async def get_event_banner(event_id: str, user=Depends(get_current_user)):
    b = await db.event_banners.find_one(
        {"user_id": tenant_id(user), "event_id": event_id},
        {"_id": 0, "audio_base64": 0},  # v2.18 — audio via dedicated /audio endpoint
    )
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    if not _event_visible_to_user(b, user):
        raise HTTPException(status_code=403, detail="Non hai accesso a questo evento")
    # v2.18 — Expose a boolean "has_audio" flag so UI can toggle the playback button
    b["has_audio"] = False
    audio_check = await db.event_banners.find_one(
        {"event_id": event_id}, {"_id": 0, "audio_base64": 1}
    )
    if audio_check and audio_check.get("audio_base64"):
        b["has_audio"] = True
    return b


@api_router.put("/event-banners/{event_id}")
async def update_event_banner(event_id: str, body: EventBannerUpdate, user=Depends(get_current_user)):
    _ensure_master(user)
    # v2.18 — audio/program fields must be settable to None (to clear them)
    _nullable_ok = ("program_pdf_base64", "program_pdf_name", "program_html",
                    "audio_base64", "audio_mime", "audio_name",
                    "event_end_at", "description")
    upd = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None or k in _nullable_ok}
    # V28.aa — Se il PDF caricato non è un PDF valido (header != %PDF-), convertiamolo
    # in HTML e salviamolo in program_html invece di program_pdf_base64. Evita l'errore
    # "Invalid PDF structure" al reader.
    if upd.get("program_pdf_base64"):
        import base64 as _b64
        raw_b64 = upd["program_pdf_base64"]
        try:
            raw = raw_b64.split(",")[-1] if raw_b64.startswith("data:") else raw_b64
            data = _b64.b64decode(raw, validate=False)
        except Exception:
            data = b""
        if data[:5] != b"%PDF-":
            # Non è un PDF: prova a interpretare come HTML/testo
            text = data.decode("utf-8", errors="replace")
            if text.strip():
                looks_like_html = "<html" in text.lower() or "<body" in text.lower()
                if not looks_like_html:
                    safe = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
                    text = (
                        f"<!DOCTYPE html><html><head><meta charset='utf-8'/>"
                        f"<style>body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#1B2B4B;line-height:1.55}}"
                        f"pre{{white-space:pre-wrap;font-family:inherit;font-size:14px}}</style>"
                        f"</head><body><pre>{safe}</pre></body></html>"
                    )
                upd["program_html"] = text
            upd["program_pdf_base64"] = None
            upd["program_pdf_name"] = None
    upd["updated_at"] = utcnow()
    r = await db.event_banners.update_one(
        {"user_id": tenant_id(user), "event_id": event_id},
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    return {"ok": True}


@api_router.delete("/event-banners/{event_id}")
async def delete_event_banner(event_id: str, user=Depends(get_current_user)):
    _ensure_master(user)
    r = await db.event_banners.delete_one({"user_id": tenant_id(user), "event_id": event_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    return {"ok": True}


class EventProgramAIIn(BaseModel):
    description: str = ""
    duration_hint: Optional[str] = None  # e.g. "mezza giornata", "sera"


@api_router.post("/event-banners/{event_id}/generate-program")
async def generate_event_program(event_id: str, body: EventProgramAIIn, user=Depends(get_current_user)):
    """Ask Claude to draft a professional event program in Italian (HTML),
    then store it on the banner for later viewing / sharing."""
    _ensure_master(user)
    b = await db.event_banners.find_one({"user_id": tenant_id(user), "event_id": event_id})
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM non disponibile: {e}")
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")

    when_str = b["event_at"].strftime("%d/%m/%Y ore %H:%M")
    system = (
        "Sei un event manager professionista italiano. Redigi un programma d'evento "
        "chiaro, ben strutturato, in HTML pulito (usa <h2>, <h3>, <ul>, <li>, <p>). "
        "Includi: intro/benvenuto, obiettivi, agenda con orari, relatori (se applicabile), "
        "networking/pausa, chiusura. Tono professionale ma caloroso. NON usare markdown. "
        "Rispondi SOLO con l'HTML dell'evento (nessuna intro, nessun code fence)."
    )
    prompt = (
        f"Titolo evento: {b['title']}\n"
        f"Data e ora: {when_str}\n"
        f"Descrizione libera: {(body.description or '').strip() or '—'}\n"
        f"Durata prevista: {(body.duration_hint or '').strip() or 'non specificata'}\n\n"
        "Crea l'HTML del programma dell'evento."
    )
    chat = LlmChat(
        api_key=key,
        session_id=f"event-program-{event_id}",
        system_message=system,
    ).with_model("anthropic", "claude-haiku-4-5")
    try:
        raw = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Errore LLM: {e}")
    html_body = (raw or "").strip()
    # Escape only the title to avoid HTML injection
    def _esc(s: str) -> str:
        return (str(s or "")
                .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;").replace("'", "&#39;"))
    full = f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{_esc(b['title'])} — Programma</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; margin: 0; padding: 0; background: #F8FAFC; }}
  .wrap {{ max-width: 780px; margin: 0 auto; padding: 24px 20px 48px; background: #FFF; }}
  h1 {{ font-size: 24px; margin: 0 0 4px; color: #0F172A; }}
  .when {{ color: #64748B; font-size: 13px; margin-bottom: 20px; }}
  h2 {{ font-size: 17px; color: #1E3A5F; margin-top: 22px; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px; }}
  h3 {{ font-size: 14px; color: #334155; margin-top: 16px; }}
  ul {{ padding-left: 20px; }}
  li {{ margin-bottom: 4px; line-height: 1.5; font-size: 13px; }}
  p {{ line-height: 1.6; font-size: 13px; }}
</style></head><body>
<div class="wrap">
  <h1>{_esc(b['title'])}</h1>
  <div class="when">{_esc(when_str)}</div>
  {html_body}
</div>
</body></html>"""
    await db.event_banners.update_one(
        {"event_id": event_id},
        {"$set": {"program_html": full, "updated_at": utcnow()}},
    )
    return {"ok": True, "program_html": full}


@api_router.get("/event-banners/{event_id}/audio")
async def get_event_audio(event_id: str, user=Depends(get_current_user)):
    """v2.18 — Return the audio attachment for an event (if present)."""
    b = await db.event_banners.find_one(
        {"user_id": tenant_id(user), "event_id": event_id},
        {"_id": 0, "audio_base64": 1, "audio_mime": 1, "audio_name": 1, "user_id": 1, "visibility_kind": 1, "visible_user_ids": 1},
    )
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    if not _event_visible_to_user(b, user):
        raise HTTPException(status_code=403, detail="Non hai accesso a questo evento")
    if not b.get("audio_base64"):
        raise HTTPException(status_code=404, detail="Nessuna audio-registrazione allegata")
    return {
        "name": b.get("audio_name") or "audio.m4a",
        "mime": b.get("audio_mime") or "audio/mp4",
        "data_base64": b["audio_base64"],
    }


@api_router.get("/event-banners/{event_id}/program")
async def get_event_program(event_id: str, user=Depends(get_current_user)):
    """Return the program (PDF or HTML) for viewing/sharing.
    V28.aa — Validazione PDF: se il base64 non ha l'header %PDF- (file corrotto / non
    è realmente un PDF), fallback a HTML per evitare l'errore 'Invalid PDF structure'
    lato pdfjs. Se il programma è testo/dati grezzi lo mostriamo come pagina HTML.
    """
    b = await db.event_banners.find_one(
        {"user_id": tenant_id(user), "event_id": event_id},
        {"_id": 0},
    )
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    if not _event_visible_to_user(b, user):
        raise HTTPException(status_code=403, detail="Non hai accesso a questo evento")
    import base64 as _b64
    pdf_b64 = b.get("program_pdf_base64")
    pdf_valid = False
    pdf_bytes = None
    if pdf_b64:
        try:
            raw = pdf_b64.split(",")[-1] if pdf_b64.startswith("data:") else pdf_b64
            pdf_bytes = _b64.b64decode(raw, validate=False)
            # PDF spec: file must start with %PDF-
            pdf_valid = pdf_bytes[:5] == b"%PDF-"
        except Exception:
            pdf_valid = False
    if pdf_valid and pdf_b64:
        return {
            "kind": "pdf",
            "name": b.get("program_pdf_name") or f"Programma-{b['title']}.pdf",
            "mime": "application/pdf",
            "data_base64": _b64.b64encode(pdf_bytes).decode("ascii"),
        }
    # Prefer explicit HTML program (generated by AI or uploaded)
    html = b.get("program_html")
    if not html and pdf_b64 and not pdf_valid:
        # Fallback: se il "pdf" era in realtà testo/dati, decodifichiamolo come HTML.
        try:
            text = pdf_bytes.decode("utf-8", errors="replace") if pdf_bytes else ""
        except Exception:
            text = ""
        if text.strip():
            # Se sembra già HTML lo passiamo così, altrimenti wrappiamo in <pre>
            looks_like_html = "<html" in text.lower() or "<body" in text.lower() or "<h1" in text.lower()
            if looks_like_html:
                html = text
            else:
                safe = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
                html = (
                    f"<!DOCTYPE html><html><head><meta charset='utf-8'/>"
                    f"<title>Programma {b.get('title','')}</title>"
                    f"<style>body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#1B2B4B;line-height:1.55}}"
                    f"h1{{color:#4C1D95;margin-bottom:8px}}pre{{white-space:pre-wrap;font-family:inherit;font-size:14px}}</style>"
                    f"</head><body><h1>{b.get('title','Programma')}</h1><pre>{safe}</pre></body></html>"
                )
    if html:
        return {
            "kind": "html",
            "name": f"Programma-{b['title']}.html",
            "mime": "text/html",
            "data_base64": _b64.b64encode(html.encode("utf-8")).decode("ascii"),
        }
    raise HTTPException(status_code=404, detail="Nessun programma disponibile per questo evento")


def _extract_best_image_from_pdf(pdf_b64: str) -> Optional[Tuple[bytes, str]]:
    """v2.11 — Immagine «più significativa» del PDF → (jpeg_bytes, mime) 16:9 1600x900.
    V50.z210: PyMuPDF + Pillow girano nel sottoprocesso worker (`pdf_cover`), mai nel processo API."""
    import base64 as _b64
    try:
        raw = _b64.b64decode(pdf_b64.split(",", 1)[-1])
    except Exception as e:
        logger.warning("PDF decode failed: %s", e)
        return None
    try:
        r = heavy_call_sync("pdf_cover", data=raw)
    except Exception as e:  # noqa: BLE001
        logger.warning("PDF cover extraction failed: %s", e)
        return None
    jpg = r.get("jpeg")
    return (jpg, "image/jpeg") if jpg else None



class EventCoverExtractIn(BaseModel):
    # If True (default), persist the extracted cover on the event.
    apply: bool = True


@api_router.post("/event-banners/{event_id}/extract-cover-from-pdf")
async def extract_event_cover_from_pdf(event_id: str, body: EventCoverExtractIn, user=Depends(get_current_user)):
    """v2.11 — Extract the most significant image from the event's uploaded
    program PDF and either apply it as the banner cover (default) or preview it."""
    _ensure_master(user)
    b = await db.event_banners.find_one({"user_id": tenant_id(user), "event_id": event_id})
    if not b:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    pdf_b64 = b.get("program_pdf_base64")
    if not pdf_b64:
        raise HTTPException(status_code=400, detail="Nessun PDF programma caricato. Carica il PDF prima di estrarre la copertina.")

    result = await asyncio.to_thread(_extract_best_image_from_pdf, pdf_b64)  # V50.z210 — worker in thread, non blocca il loop
    if not result:
        raise HTTPException(status_code=422, detail="Impossibile estrarre un'immagine significativa dal PDF.")
    import base64 as _b64
    jpeg_bytes, mime = result
    cover_b64 = _b64.b64encode(jpeg_bytes).decode("ascii")

    if body.apply:
        await db.event_banners.update_one(
            {"event_id": event_id},
            {"$set": {"cover_base64": cover_b64, "cover_mime": mime, "updated_at": utcnow()}},
        )
    return {"ok": True, "applied": body.apply, "cover_base64": cover_b64, "cover_mime": mime, "size_bytes": len(jpeg_bytes)}


@app.get("/api/public/event-banners/{public_token}", response_class=HTMLResponse)
async def public_event_page(public_token: str):
    """Public page for contacts (no auth). Simple HTML with cover, title,
    countdown script, and inline program preview."""
    b = await db.event_banners.find_one({"public_token": public_token}, {"_id": 0})
    if not b:
        return HTMLResponse("<h1>Evento non trovato</h1>", status_code=404)
    title = (b.get("title") or "").replace("<", "&lt;")
    when_iso = b["event_at"].isoformat() if isinstance(b.get("event_at"), datetime) else str(b.get("event_at"))
    when_pretty = b["event_at"].strftime("%d/%m/%Y · %H:%M") if isinstance(b.get("event_at"), datetime) else ""
    cover = b.get("cover_base64") or ""
    cover_mime = b.get("cover_mime") or "image/jpeg"
    cover_src = f"data:{cover_mime};base64,{cover}" if cover else ""
    program_href = ""
    if b.get("program_pdf_base64"):
        program_href = f"data:application/pdf;base64,{b['program_pdf_base64']}"
    elif b.get("program_html"):
        import base64 as _b64
        program_href = "data:text/html;base64," + _b64.b64encode(b["program_html"].encode("utf-8")).decode("ascii")
    html = f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{title}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0F172A; color: #FFF; min-height: 100vh; }}
  .hero {{ position: relative; width: 100%; height: 60vh; min-height: 340px; overflow: hidden; }}
  .hero img {{ width: 100%; height: 100%; object-fit: cover; }}
  .hero .overlay {{ position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 100%); display: flex; flex-direction: column; justify-content: flex-end; padding: 28px 22px; }}
  h1 {{ font-size: 30px; margin: 0 0 6px; line-height: 1.15; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }}
  .when {{ font-size: 15px; opacity: 0.85; margin-bottom: 16px; }}
  .cd {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; max-width: 460px; }}
  .cd .box {{ background: rgba(255,255,255,0.12); backdrop-filter: blur(6px); border-radius: 10px; padding: 10px 4px; text-align: center; }}
  .cd .n {{ font-size: 22px; font-weight: 800; line-height: 1.1; }}
  .cd .l {{ font-size: 10px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.4px; }}
  .actions {{ padding: 22px; text-align: center; }}
  .btn {{ display: inline-block; background: #F59E0B; color: #0F172A; text-decoration: none; font-weight: 800; padding: 12px 22px; border-radius: 10px; margin: 6px; box-shadow: 0 4px 12px rgba(245,158,11,0.35); }}
  .btn.sec {{ background: transparent; color: #FFF; border: 1px solid rgba(255,255,255,0.4); box-shadow: none; }}
</style></head><body>
<div class="hero">
  {'<img src="'+cover_src+'"/>' if cover_src else ''}
  <div class="overlay">
    <h1>{title}</h1>
    <div class="when">{when_pretty}</div>
    <div class="cd" id="cd">
      <div class="box"><div class="n" id="dd">—</div><div class="l">Giorni</div></div>
      <div class="box"><div class="n" id="hh">—</div><div class="l">Ore</div></div>
      <div class="box"><div class="n" id="mm">—</div><div class="l">Min</div></div>
      <div class="box"><div class="n" id="ss">—</div><div class="l">Sec</div></div>
    </div>
  </div>
</div>
<div class="actions">
  {'<a class="btn" href="'+program_href+'" target="_blank" rel="noopener">Apri il programma</a>' if program_href else ''}
</div>
<script>
  const target = new Date("{when_iso}").getTime();
  function pad(n){{ return String(n).padStart(2,"0"); }}
  function tick(){{
    const now = Date.now();
    let d = Math.max(0, target - now);
    const days = Math.floor(d/86400000); d -= days*86400000;
    const hh = Math.floor(d/3600000); d -= hh*3600000;
    const mm = Math.floor(d/60000); d -= mm*60000;
    const ss = Math.floor(d/1000);
    document.getElementById("dd").textContent = pad(days);
    document.getElementById("hh").textContent = pad(hh);
    document.getElementById("mm").textContent = pad(mm);
    document.getElementById("ss").textContent = pad(ss);
  }}
  tick(); setInterval(tick, 1000);
</script>
</body></html>"""
    return HTMLResponse(html)


# ================================================================
