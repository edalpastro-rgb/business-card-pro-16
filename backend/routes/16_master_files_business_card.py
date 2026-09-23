# 16_master_files_business_card.py — Master Files, Biglietto da visita + analytics
# Estratto da server.py (righe originali 8920-9759). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Master Files (V38O) — personal file cabinet for the Master (owner) that
# mirrors the client-side files section. Categories: notes, bills, audio, files.
# Files are stored inline (data_base64) — same pattern as ContactFile.
# =========================

class MasterFileIn(BaseModel):
    category: str  # notes | bills | audio | files
    name: str
    mime: str = "application/octet-stream"
    data_base64: str = ""            # for binary files (audio/bills/generic)
    body: Optional[str] = None       # for text notes — rich text markdown-ish
    title: Optional[str] = None      # for notes
    size: Optional[int] = None
    # V50.z226 — provenienza (scanner): contatto di origine e canale (widget / scheda cliente / bollette / chat)
    source: Optional[str] = None
    source_contact_id: Optional[str] = None
    # V50.z246 — Scanner: testo OCR (Tesseract locale) ricercabile + impronta del contenuto per il rilevamento duplicati
    ocr_text: Optional[str] = None
    text_hash: Optional[str] = None


class MasterFileRenameIn(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None


# V50.z226 — "scanner": cartella dedicata ai PDF creati dallo scanner (sempre salvati, anche se l'analisi non viene completata)
ALLOWED_MASTER_CATS = {"notes", "bills", "audio", "files", "analisi", "scanner"}


@api_router.get("/master-files/duplicate")
async def master_file_duplicate(name: str = "", size: int = 0, category: Optional[str] = None, text_hash: Optional[str] = None, user=Depends(get_current_user)):
    """V50.z226 — Controllo duplicati: stesso nome (case-insensitive) e stessa dimensione → {duplicate, file}.
    V50.z246 — oppure stesso `text_hash` (impronta del testo OCR: stesso documento riscansionato, anche con nome/dimensione diversi) → match `by: "content"`."""
    tid = tenant_id(user)
    proj = {"_id": 0, "file_id": 1, "name": 1, "category": 1, "size": 1, "created_at": 1}
    if text_hash:
        q_h: Dict[str, Any] = {"user_id": tid, "text_hash": text_hash}
        if category:
            q_h["category"] = category
        d = await db.master_files.find_one(q_h, proj, sort=[("created_at", -1)])
        if d:
            return {"duplicate": True, "file": d, "by": "content"}
    nm = (name or "").strip()
    if not nm or not size:
        return {"duplicate": False, "file": None, "by": None}
    q: Dict[str, Any] = {"user_id": tid, "size": int(size), "name": {"$regex": f"^{re.escape(nm)}$", "$options": "i"}}
    if category:
        q["category"] = category
    d = await db.master_files.find_one(q, proj)
    return {"duplicate": bool(d), "file": d, "by": "name_size" if d else None}


@api_router.post("/master-files")
async def add_master_file(body: MasterFileIn, user=Depends(get_current_user)):
    if body.category not in ALLOWED_MASTER_CATS:
        raise HTTPException(status_code=400, detail=f"category deve essere: {sorted(ALLOWED_MASTER_CATS)}")
    file_id = f"mf_{uuid.uuid4().hex[:12]}"
    b64 = body.data_base64 or ""
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    est_size = int(len(b64) * 0.75) if b64 else 0
    if est_size > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File troppo grande (max 50 MB)")
    name = (body.name or "").strip() or (body.title or "senza titolo")
    if b64 and body.category != "notes":
        # V50.z202 — mai più inline in MongoDB: contenuto su Object Storage, qui solo il riferimento (endpoint legacy JSON;
        # i client nuovi usano POST /master-files/upload multipart a chunk).
        import tempfile as _mf_tempfile
        tmp = _mf_tempfile.NamedTemporaryFile(suffix="." + _upl_ext(name, body.mime or ""), delete=False)
        try:
            raw = base64.b64decode(b64)
            raw, _ci = await pdf_auto_compress(raw, body.mime or "", name, "master-files-json")  # V50.z345
            tmp.write(raw); tmp.close()
        except Exception:
            tmp.close(); os.unlink(tmp.name)
            raise HTTPException(status_code=400, detail="Base64 non valido")
        stored_doc = await _upl_master_store(user, body.category, name, body.mime or "application/octet-stream", tmp.name, len(raw), __import__('hashlib').sha256(raw).hexdigest(), body.title)
        extra: Dict[str, Any] = {}
        if body.source or body.source_contact_id:
            extra.update({"source": body.source, "source_contact_id": body.source_contact_id})
        if body.ocr_text:
            extra["ocr_text"] = body.ocr_text[:200000]
        if body.text_hash:
            extra["text_hash"] = body.text_hash
        if extra:
            await db.master_files.update_one({"file_id": stored_doc["file_id"]}, {"$set": extra})
            stored_doc.update(extra)
        return stored_doc
    doc = {
        "file_id": file_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "category": body.category,
        "name": name,
        "title": (body.title or "").strip() or None,
        "body": body.body if body.category == "notes" else None,
        "mime": body.mime or "application/octet-stream",
        "size": body.size if body.size is not None else est_size,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.master_files.insert_one(doc)
    out = {k: v for k, v in doc.items() if k not in {"_id", "data_base64"}}
    return out


# =========================
# Master Business Card (V38Q)
# One document per user with the digital business-card configuration. QR
# content is user-defined: app-demo link / website / free text. Shared as
# image, link or QR code from the frontend.
# =========================

class BusinessCardIn(BaseModel):
    display_name: Optional[str] = None
    title: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    tagline: Optional[str] = None
    logo_base64: Optional[str] = None
    photo_base64: Optional[str] = None
    accent_color: Optional[str] = None
    qr_type: Optional[str] = None      # "app" | "website" | "text" | "vcard"
    qr_content: Optional[str] = None
    demo_app_link: Optional[str] = None
    social_links: Optional[Dict[str, str]] = None
    # V38V — Public page customization
    link_title: Optional[str] = Field(default=None, max_length=200)
    visual_effect: Optional[str] = None  # "none" | "shimmer" | "border"
    # V27 — Theme selection (orange/navy redesign)
    card_theme: Optional[str] = None  # "sunset" | "midnight" | "ivory" | "mono" | "gold" (default "sunset")
    show_photo: Optional[bool] = None  # V27 — whether to show the agent photo on the public link
    # V28.i — Custom URL slug (e.g. "emanuele" -> /api/bc/emanuele redirects to the public card)
    # Case-insensitive, unique globally, letters/digits/hyphens only, 2..40 chars.
    slug: Optional[str] = None


@api_router.get("/master/info")
async def get_master_info(user=Depends(get_current_user)):
    """
    Bug 9 — Return the tenant's Master personal data + business-card slug so
    that the "Profilo & Impostazioni" screen (both for Master and Collaborators)
    can render a compact card with: name, role, phone, company email, avatar.

    Uses tenant_id(user) → for a Collaborator this returns their Master's user_id,
    for the Master it returns their own user_id. Business-card fields (phone,
    title, company) are merged in as fallbacks.
    """
    tid = tenant_id(user)
    m = await db.users.find_one(
        {"user_id": tid},
        {
            "_id": 0,
            "user_id": 1,
            "name": 1,
            "email": 1,
            "role": 1,
            "avatar_base64": 1,
            "picture": 1,
            "company_name": 1,
            "company_logo_base64": 1,
            "additional_emails": 1,
        },
    )
    if not m:
        raise HTTPException(status_code=404, detail="Master non trovato")
    bc = await db.business_cards.find_one(
        {"user_id": tid},
        {
            "_id": 0,
            "card_id": 1,
            "display_name": 1,
            "title": 1,
            "company_name": 1,
            "phone": 1,
            "email": 1,
            "website": 1,
            "address": 1,
            "tagline": 1,
            "logo_base64": 1,
            "photo_base64": 1,
            "accent_color": 1,
            "slug": 1,
        },
    ) or {}
    return {
        "user_id": m.get("user_id"),
        "name": m.get("name") or bc.get("display_name") or "",
        "email": m.get("email") or bc.get("email") or "",
        "role": m.get("role") or "owner",
        "role_label": "Master" if (m.get("role") == "owner") else (m.get("role") or "Team"),
        "title": bc.get("title") or "",
        "phone": bc.get("phone") or "",
        "company_name": bc.get("company_name") or m.get("company_name") or "",
        "website": bc.get("website") or "",
        "address": bc.get("address") or "",
        "tagline": bc.get("tagline") or "",
        "avatar_base64": m.get("avatar_base64") or m.get("picture") or "",
        "logo_base64": bc.get("logo_base64") or m.get("company_logo_base64") or "",
        "photo_base64": bc.get("photo_base64") or "",
        "accent_color": bc.get("accent_color") or "#6366F1",
        "additional_emails": m.get("additional_emails") or [],
        "business_card": {
            "card_id": bc.get("card_id") or None,
            "slug": bc.get("slug") or None,
        },
    }


@api_router.get("/master/business-card")
async def get_business_card(user=Depends(get_current_user)):
    d = await db.business_cards.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not d:
        # Seed a lightweight default from the user profile
        return {
            "user_id": tenant_id(user),
            "display_name": user.get("name") or user.get("email") or "",
            "title": "",
            "company_name": user.get("company_name") or "",
            "phone": user.get("phone") or "",
            "email": user.get("email") or "",
            "website": "",
            "address": "",
            "tagline": "",
            "logo_base64": user.get("company_logo_base64") or "",
            "photo_base64": "",  # V27 — no auto-load; user must explicitly pick a photo
            "accent_color": "#6366F1",
            "qr_type": "website",
            "qr_content": "",
            "demo_app_link": "",
            "social_links": {},
            "created_at": None,
            "updated_at": None,
        }
    return d


@api_router.put("/master/business-card")
async def update_business_card(body: BusinessCardIn, user=Depends(get_current_user)):
    patch: Dict[str, Any] = {"updated_at": utcnow()}
    for field in [
        "display_name", "title", "company_name", "phone", "email", "website",
        "address", "tagline", "logo_base64", "photo_base64", "accent_color",
        "qr_type", "qr_content", "demo_app_link", "social_links",
        "link_title", "visual_effect",  # V38V
        "card_theme", "show_photo",  # V27
    ]:
        v = getattr(body, field, None)
        if v is not None:
            patch[field] = v
    if body.qr_type and body.qr_type not in {"app", "website", "text", "vcard"}:
        raise HTTPException(status_code=400, detail="qr_type deve essere: app | website | text | vcard")
    if body.visual_effect and body.visual_effect not in {"none", "shimmer", "border"}:
        raise HTTPException(status_code=400, detail="visual_effect deve essere: none | shimmer | border")
    if body.card_theme and body.card_theme not in {"sunset", "midnight", "ivory", "mono", "gold"}:
        raise HTTPException(status_code=400, detail="card_theme non valido")
    tid = tenant_id(user)
    # V28.i — Slug validation + uniqueness (case-insensitive, globally unique so
    # advisoros.it/<slug> always resolves to the correct owner).
    if body.slug is not None:
        s = (body.slug or "").strip().lower()
        if s == "":
            patch["slug"] = None
        else:
            import re as _re
            if not _re.fullmatch(r"[a-z0-9][a-z0-9-]{0,38}[a-z0-9]", s):
                raise HTTPException(
                    status_code=400,
                    detail="Slug non valido: usa 2-40 caratteri minuscoli (a-z), cifre e trattini. Deve iniziare e finire con lettera/cifra.",
                )
            RESERVED = {"api", "admin", "app", "bc", "bv", "public", "auth", "login", "logout", "www", "static", "assets"}
            if s in RESERVED:
                raise HTTPException(status_code=400, detail=f"Slug riservato: '{s}' non è disponibile.")
            clash = await db.business_cards.find_one({"slug": s, "user_id": {"$ne": tid}}, {"_id": 1})
            if clash:
                raise HTTPException(status_code=409, detail=f"Slug '{s}' già usato da un altro utente. Scegline un altro.")
            patch["slug"] = s
    existing = await db.business_cards.find_one({"user_id": tid})
    if not existing:
        patch["user_id"] = tid
        patch["created_at"] = utcnow()
        patch["card_id"] = f"bc_{uuid.uuid4().hex[:12]}"
        await db.business_cards.insert_one(patch)
    else:
        await db.business_cards.update_one({"user_id": tid}, {"$set": patch})
    out = await db.business_cards.find_one({"user_id": tid}, {"_id": 0})
    return out


class BusinessCardShareLinkIn(BaseModel):
    channel: Optional[str] = None  # optional analytics tag


def _build_vcard(d: dict) -> str:
    """V38V — Build a valid vCard 3.0 string from a business card doc."""
    lines = ["BEGIN:VCARD", "VERSION:3.0"]
    name = (d.get("display_name") or "").strip()
    if name:
        parts = name.split(" ", 1)
        surname = parts[1] if len(parts) > 1 else ""
        given = parts[0]
        lines.append(f"N:{surname};{given};;;")
        lines.append(f"FN:{name}")
    if d.get("company_name"):
        lines.append(f"ORG:{d['company_name']}")
    if d.get("title"):
        lines.append(f"TITLE:{d['title']}")
    if d.get("phone"):
        lines.append(f"TEL;TYPE=CELL:{d['phone']}")
    if d.get("email"):
        lines.append(f"EMAIL;TYPE=INTERNET:{d['email']}")
    if d.get("website"):
        lines.append(f"URL:{d['website']}")
    if d.get("address"):
        lines.append(f"ADR;TYPE=WORK:;;{d['address']};;;;")
    if d.get("tagline"):
        lines.append(f"NOTE:{d['tagline']}")
    lines.append("END:VCARD")
    return "\r\n".join(lines)


def _build_public_card_html(d: dict, card_id: str) -> str:
    """V27 — Server-side HTML page for the public /master/business-card/public/{card_id}
    endpoint. Redesigned with orange/navy palette, clean/minimal typography,
    optional agent photo, and 5 selectable themes (sunset · midnight · ivory ·
    mono · gold). Optional visual effect (shimmer / animated border) applied
    via pure CSS.
    """
    from html import escape as esc
    name = esc(d.get("display_name") or "Biglietto")
    title = esc(d.get("title") or "")
    company = esc(d.get("company_name") or "")
    phone = esc(d.get("phone") or "")
    email = esc(d.get("email") or "")
    website = (d.get("website") or "").strip()
    website_esc = esc(website)
    address = esc(d.get("address") or "")
    tagline = esc(d.get("tagline") or "")
    logo = d.get("logo_base64") or ""
    logo_esc = esc(logo)
    photo = d.get("photo_base64") or ""
    photo_esc = esc(photo)
    show_photo_pref = d.get("show_photo")
    show_photo = bool(photo) and (show_photo_pref is not False)  # default: show if photo present
    page_title = esc(d.get("link_title") or f"Biglietto da visita — {d.get('display_name') or ''}".strip())
    effect = (d.get("visual_effect") or "none").lower()
    card_theme = (d.get("card_theme") or "sunset").lower()
    # V27 palette
    THEMES = {
        # sunset: orange primary + navy accent (default)
        "sunset":   {"primary": "#FF6B35", "secondary": "#1B2B4B", "bg1": "#FFFFFF", "bg2": "#FFF1E9", "text": "#0F172A", "muted": "#64748B", "card_bg": "#FFFFFF", "stripe": "#FF6B35", "surface": "#F8FAFC"},
        # midnight: pure navy with orange accent
        "midnight": {"primary": "#1B2B4B", "secondary": "#FF6B35", "bg1": "#1B2B4B", "bg2": "#0F172A", "text": "#FFFFFF", "muted": "#94A3B8", "card_bg": "#0F172A", "stripe": "#FF6B35", "surface": "#1E2A44"},
        # ivory: light navy on cream
        "ivory":    {"primary": "#1B2B4B", "secondary": "#B8845A", "bg1": "#FFFBF3", "bg2": "#F5EDDF", "text": "#1B2B4B", "muted": "#6B5A47", "card_bg": "#FFFDF7", "stripe": "#1B2B4B", "surface": "#F5EDDF"},
        # mono: pure black/white minimal
        "mono":     {"primary": "#0F172A", "secondary": "#0F172A", "bg1": "#FFFFFF", "bg2": "#F1F5F9", "text": "#0F172A", "muted": "#94A3B8", "card_bg": "#FFFFFF", "stripe": "#0F172A", "surface": "#F8FAFC"},
        # gold: navy with gold accent
        "gold":     {"primary": "#1B2B4B", "secondary": "#D4A853", "bg1": "#F8F5EE", "bg2": "#EFE7D2", "text": "#1B2B4B", "muted": "#7A6C4C", "card_bg": "#FFFFFF", "stripe": "#D4A853", "surface": "#F8F5EE"},
    }
    T = THEMES.get(card_theme, THEMES["sunset"])
    primary = T["primary"]
    secondary = T["secondary"]
    bg1 = T["bg1"]; bg2 = T["bg2"]
    text_c = T["text"]; muted_c = T["muted"]; card_bg = T["card_bg"]
    stripe_c = T["stripe"]
    surface_c = T["surface"]
    qr_type = d.get("qr_type") or "website"
    if qr_type == "app":
        qr_value = d.get("demo_app_link") or d.get("qr_content") or ""
    elif qr_type == "website":
        qr_value = website or (d.get("qr_content") or "")
    elif qr_type == "vcard":
        qr_value = _build_vcard(d)
    else:
        qr_value = d.get("qr_content") or ""
    # QR — use the primary color for dark modules; on midnight theme use white bg
    qr_color = primary.replace("#", "")
    qr_bg = "FFFFFF" if card_theme != "midnight" else "FFFFFF"
    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?data={_quote_plus_std(qr_value or ' ')}&size=200x200&color={qr_color}&bgcolor={qr_bg}"

    # Effect styles — pure CSS
    effect_css = ""
    effect_class = ""
    if effect == "shimmer":
        effect_class = "with-shimmer"
        effect_css = """
        .card.with-shimmer { position: relative; overflow: hidden; }
        .card.with-shimmer::before {
          content: ""; position: absolute; top: 0; left: -100%; width: 55%; height: 100%;
          background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.4) 50%, transparent 70%);
          animation: bc-shimmer 10s infinite; pointer-events: none;
        }
        @keyframes bc-shimmer { 0% { left: -100%; } 12% { left: 120%; } 100% { left: 120%; } }
        """
    elif effect == "border":
        effect_class = "with-border-glow"
        effect_css = f"""
        .card.with-border-glow {{ position: relative; }}
        .card.with-border-glow::after {{
          content: ""; position: absolute; inset: -3px; border-radius: 26px;
          padding: 3px; background: conic-gradient(from 0deg, transparent 60%, {secondary}, transparent 100%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          animation: bc-border-spin 3s linear infinite; pointer-events: none;
        }}
        @keyframes bc-border-spin {{ to {{ transform: rotate(360deg); }} }}
        """

    # Contact rows — icon-only labels for a cleaner minimal look
    contacts_rows = "".join([
        (f'<a class="row" href="tel:{phone}"><span class="ico">📞</span><span>{phone}</span></a>' if phone else ""),
        (f'<a class="row" href="mailto:{email}"><span class="ico">✉️</span><span>{email}</span></a>' if email else ""),
        (f'<a class="row" href="{website_esc if website.startswith("http") else "https://" + website_esc}" target="_blank" rel="noopener"><span class="ico">🌐</span><span>{website_esc}</span></a>' if website else ""),
        (f'<div class="row"><span class="ico">📍</span><span>{address}</span></div>' if address else ""),
    ])
    logo_html = f'<img class="logo" src="{logo_esc}" alt="Logo"/>' if logo else ""
    photo_html = f'<img class="photo" src="{photo_esc}" alt="{name}"/>' if show_photo else ""
    tagline_html = f'<div class="tagline">« {tagline} »</div>' if tagline else ""
    title_html = f'<div class="role">{title}</div>' if title else ""
    company_html = f'<div class="company">{company}</div>' if company else ""

    return f"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover"/>
<title>{page_title}</title>
<meta property="og:title" content="{page_title}"/>
<meta property="og:description" content="{tagline or name}"/>
<meta name="theme-color" content="{primary}"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * {{ box-sizing: border-box; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }}
  html, body {{ margin: 0; padding: 0; min-height: 100vh; background: linear-gradient(160deg, {bg1} 0%, {bg2} 100%);
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: {text_c}; letter-spacing: -0.011em; }}
  .wrap {{ max-width: 440px; margin: 0 auto; padding: 16px 14px 32px; }}
  .banner {{ background: {primary}; color: #FFF; padding: 10px 12px; border-radius: 12px; margin-bottom: 12px;
    display: none; align-items: center; gap: 8px; box-shadow: 0 4px 16px {primary}44; }}
  .banner .txt {{ flex: 1; font-size: 12.5px; line-height: 1.35; font-weight: 500; }}
  .banner button {{ background: #FFF; color: {primary}; border: none; padding: 7px 14px; border-radius: 8px;
    font-weight: 800; font-size: 11.5px; cursor: pointer; font-family: inherit; }}
  .banner .close {{ background: transparent; color: #FFF; padding: 0 4px; font-size: 18px; }}

  .card {{ background: {card_bg}; border-radius: 22px; overflow: hidden;
    box-shadow: 0 16px 48px rgba(15,23,42,0.11), 0 4px 14px rgba(15,23,42,0.05);
    position: relative;
  }}
  .stripe {{ height: 5px; background: linear-gradient(90deg, {primary} 0%, {secondary} 100%); }}

  /* Photo — fully INSIDE the card (no negative margin), integrated into the header block */
  .photo-wrap {{ display: flex; justify-content: center; padding: 16px 0 4px; position: relative; z-index: 2; }}
  .photo {{ width: 92px; height: 92px; border-radius: 50%; object-fit: cover;
    border: 3px solid {card_bg}; box-shadow: 0 0 0 3px {primary}, 0 6px 16px rgba(15,23,42,0.15); }}

  /* Header — logo + name + role, compact spacing */
  .head {{ padding: 6px 20px 4px; text-align: center; }}
  .head.head-no-photo {{ padding-top: 22px; }}
  .logo-wrap {{ display: flex; justify-content: center; margin-bottom: 10px; }}
  .logo {{ max-width: 130px; max-height: 40px; object-fit: contain; }}
  .name {{ font-size: 25px; font-weight: 900; color: {secondary}; line-height: 1.05; letter-spacing: -0.03em; }}
  .role {{ font-size: 12px; color: {primary}; margin-top: 4px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }}
  .company {{ font-size: 12px; color: {muted_c}; margin-top: 3px; font-weight: 600; }}
  .divider {{ height: 2px; width: 32px; background: {primary}; margin: 12px auto 2px; border-radius: 999px; }}

  /* Contact block — tighter */
  .contacts {{ padding: 8px 18px 12px; display: flex; flex-direction: column; gap: 3px; }}
  .row {{ display: flex; align-items: center; gap: 10px; padding: 9px 12px; font-size: 14px;
    color: {text_c}; text-decoration: none; border-radius: 10px; font-weight: 600;
    background: {surface_c}; transition: background 0.2s; word-break: break-all; }}
  .row:hover {{ background: {primary}18; }}
  a.row {{ color: {text_c}; }}
  a.row span:last-child {{ color: {text_c}; }}
  .row .ico {{ font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }}

  .tagline {{ padding: 4px 22px 14px; font-size: 13px; font-weight: 500; color: {primary};
    text-align: center; font-style: italic; line-height: 1.4; }}

  /* QR area — smaller, tighter */
  .qr-box {{ padding: 14px 18px 18px; border-top: 1px solid {primary}18; text-align: center; }}
  .qr-frame {{ display: inline-block; padding: 10px; background: #FFF; border-radius: 16px;
    box-shadow: 0 6px 16px rgba(15,23,42,0.08); }}
  .qr-frame img {{ display: block; width: 140px; height: 140px; }}
  .qr-hint {{ font-size: 10px; color: {muted_c}; text-transform: uppercase;
    letter-spacing: 1.4px; font-weight: 800; margin-top: 8px; }}

  /* Actions */
  .actions {{ padding: 14px 14px 4px; display: flex; flex-direction: column; gap: 8px; }}
  .btn {{ display: flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 16px;
    border-radius: 12px; font-weight: 800; font-size: 14px; text-decoration: none; cursor: pointer;
    border: none; font-family: inherit; letter-spacing: 0.01em; transition: transform 0.15s, box-shadow 0.15s; }}
  .btn:active {{ transform: scale(0.98); }}
  .btn-primary {{ background: {primary}; color: #FFF; box-shadow: 0 6px 18px {primary}55; }}
  .btn-primary:hover {{ box-shadow: 0 8px 22px {primary}77; }}
  .btn-secondary {{ background: transparent; color: {secondary}; border: 2px solid {secondary}; }}

  .footer {{ text-align: center; color: {muted_c}; font-size: 10px; padding: 18px 0 4px;
    letter-spacing: 1px; text-transform: uppercase; font-weight: 700; }}

  {effect_css}

  @media (max-width: 380px) {{
    .name {{ font-size: 22px; }}
    .photo {{ width: 82px; height: 82px; }}
    .qr-frame img {{ width: 128px; height: 128px; }}
  }}
</style>
</head>
<body>
  <div class="wrap">
    <div id="save-banner" class="banner">
      <div class="txt">Vuoi salvare i dati nella tua rubrica telefonica?</div>
      <button onclick="downloadVCard()">Salva</button>
      <button class="close" onclick="closeBanner()" aria-label="Chiudi">×</button>
    </div>

    <div class="card {effect_class}">
      <div class="stripe"></div>
      {"<div class='photo-wrap'>" + photo_html + "</div>" if show_photo else ""}
      <div class="head {'head-no-photo' if not show_photo else ''}">
        {("<div class='logo-wrap'>" + logo_html + "</div>") if logo else ""}
        <div class="name">{name}</div>
        {title_html}
        {company_html}
        <div class="divider"></div>
      </div>
      <div class="contacts">{contacts_rows}</div>
      {tagline_html}
      <div class="qr-box">
        <div class="qr-frame"><img src="{qr_url}" alt="QR code"/></div>
        <div class="qr-hint">Scansiona con la fotocamera</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" onclick="downloadVCard()">
        📇 Salva in rubrica
      </button>
      <a class="btn btn-secondary" href="/api/master/business-card/public/{card_id}.vcf" target="_blank" rel="noopener">
        ⬇️ Scarica vCard
      </a>
    </div>

    <div class="footer">Biglietto digitale</div>
  </div>

<script>
  function isMobile() {{ return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); }}
  function downloadVCard() {{
    window.location.href = '/api/master/business-card/public/{card_id}.vcf';
  }}
  function closeBanner() {{
    var b = document.getElementById('save-banner');
    if (b) b.style.display = 'none';
    try {{ localStorage.setItem('bc_banner_dismissed_{card_id}', '1'); }} catch(e) {{}}
  }}
  (function() {{
    if (!isMobile()) return;
    try {{ if (localStorage.getItem('bc_banner_dismissed_{card_id}') === '1') return; }} catch(e) {{}}
    var b = document.getElementById('save-banner');
    if (b) b.style.display = 'flex';
  }})();
</script>
</body>
</html>"""


@api_router.get("/master/business-card/public/{card_id}.vcf")
async def get_public_business_card_vcf(card_id: str):
    """V38V — Serve the vCard (.vcf) file so the phonebook opens it directly."""
    d = await db.business_cards.find_one({"card_id": card_id}, {"_id": 0, "user_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Biglietto non trovato")
    vc = _build_vcard(d)
    name_slug = (d.get("display_name") or "contatto").replace(" ", "_")
    return Response(
        content=vc,
        media_type="text/vcard",
        headers={"Content-Disposition": f'attachment; filename="{name_slug}.vcf"'},
    )


# =========================
# Business Card Analytics (V28)
# Track opens of the public share link and aggregate stats by city.
# Uses ip-api.com (free, no key) for reverse-geolocation with graceful
# fallback when the network is unavailable or the lookup fails.
# =========================


def _client_ip_from_request(request: Request) -> str:
    """Extract the best-effort real client IP behind the ingress proxy."""
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        # X-Forwarded-For: "client, proxy1, proxy2" — client IP is the first.
        first = xff.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    try:
        return request.client.host if request.client else ""
    except Exception:
        return ""


def _is_private_ip(ip: str) -> bool:
    """Return True for loopback / RFC1918 / link-local addresses where a
    geo-lookup would only return 'unknown'."""
    if not ip:
        return True
    if ip.startswith(("10.", "127.", "169.254.", "192.168.")):
        return True
    if ip.startswith("172."):
        try:
            second = int(ip.split(".")[1])
            if 16 <= second <= 31:
                return True
        except Exception:
            pass
    if ip in ("::1", "0.0.0.0", "localhost"):
        return True
    return False


async def _geolocate_ip(ip: str) -> Dict[str, str]:
    """Look up city/region/country for an IP via ip-api.com. Best-effort,
    silent fallback to empty strings when offline / rate-limited."""
    if not ip or _is_private_ip(ip):
        return {"city": "", "region": "", "country": "", "country_code": ""}
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city"
        async with httpx.AsyncClient(timeout=4) as hx:
            r = await hx.get(url)
            if r.status_code != 200:
                return {"city": "", "region": "", "country": "", "country_code": ""}
            j = r.json()
            if j.get("status") != "success":
                return {"city": "", "region": "", "country": "", "country_code": ""}
            return {
                "city": j.get("city") or "",
                "region": j.get("regionName") or "",
                "country": j.get("country") or "",
                "country_code": (j.get("countryCode") or "").upper(),
            }
    except Exception:
        return {"city": "", "region": "", "country": "", "country_code": ""}


async def _record_business_card_view(card_id: str, user_id: str, ip: str, user_agent: str) -> None:
    """Insert a single view document. Runs in background; never raises."""
    try:
        geo = await _geolocate_ip(ip)
        doc = {
            "view_id": f"bcv_{uuid.uuid4().hex[:12]}",
            "card_id": card_id,
            "user_id": user_id,
            "ip": ip or "",
            "user_agent": (user_agent or "")[:400],
            "city": geo["city"],
            "region": geo["region"],
            "country": geo["country"],
            "country_code": geo["country_code"],
            "timestamp": utcnow(),
        }
        await db.business_card_views.insert_one(doc)
    except Exception as exc:  # pragma: no cover — analytics must never break the page
        logging.getLogger(__name__).warning("business_card_view record failed: %s", exc)


# V28.i — Public slug resolver: advisoros.it/bv/<slug> (or /bc/<slug>) → biglietto pubblico
# Redirect 302 verso l'URL canonico HTML del biglietto. Se lo slug non esiste, ritorna 404 HTML.
@api_router.get("/bc/{slug}", response_class=HTMLResponse)
@api_router.get("/bv/{slug}", response_class=HTMLResponse)
async def resolve_business_card_slug(slug: str, request: Request):
    s = (slug or "").strip().lower()
    if not s:
        return HTMLResponse(
            content=(
                "<html><body style='font-family:sans-serif;padding:40px;text-align:center;color:#DC2626'>"
                "<h1>Slug mancante</h1></body></html>"
            ),
            status_code=400,
        )
    d = await db.business_cards.find_one({"slug": s}, {"_id": 0, "card_id": 1})
    if not d or not d.get("card_id"):
        return HTMLResponse(
            content=(
                "<html><body style='font-family:sans-serif;padding:40px;text-align:center;color:#DC2626'>"
                f"<h1>Biglietto non trovato</h1><p>Lo slug &quot;{s}&quot; non &egrave; associato ad alcun biglietto.</p></body></html>"
            ),
            status_code=404,
        )
    # 302 redirect verso l'endpoint canonico (che gestisce anche l'analytics view)
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"/api/master/business-card/public/{d['card_id']}", status_code=302)



@api_router.get("/master/business-card/public/{card_id}", response_class=HTMLResponse)
async def get_public_business_card(card_id: str, request: Request, background_tasks: BackgroundTasks):
    """V38V — Public HTML page (no auth) rendered server-side. Includes vCard
    download button + mobile 'save to phonebook' banner + optional CSS effect.
    V28 — Also records an anonymous analytics view (city aggregation).
    """
    d = await db.business_cards.find_one({"card_id": card_id}, {"_id": 0})
    if not d:
        return HTMLResponse(
            content="<html><body style='font-family:sans-serif;padding:40px;text-align:center;color:#DC2626'>"
                    "<h1>Biglietto non trovato</h1><p>Il link è scaduto o non valido.</p></body></html>",
            status_code=404,
        )
    # V28 — Record analytics in background so the HTML response is instant.
    ip = _client_ip_from_request(request)
    ua = request.headers.get("user-agent") or ""
    background_tasks.add_task(_record_business_card_view, card_id, d.get("user_id") or "", ip, ua)
    # Strip user_id from data used to render the public page
    d.pop("user_id", None)
    return HTMLResponse(content=_build_public_card_html(d, card_id))


@api_router.get("/master/business-card/stats")
async def get_business_card_stats(user=Depends(get_current_user)):
    """V28 — Aggregated stats for the current master's business card.

    Returns:
      - total_views: all-time
      - unique_views: distinct IPs all-time
      - views_last_7_days: [{date: "YYYY-MM-DD", count}] most-recent last
      - views_last_30_days: total count in the last 30 days
      - top_cities: [{city, country, country_code, count}] top 10
      - top_countries: [{country, country_code, count}] top 5
      - recent_views: [{city, country, country_code, timestamp}] last 20
    """
    tid = tenant_id(user)
    # Fetch the card_id belonging to this tenant (some legacy docs might not have one)
    card = await db.business_cards.find_one({"user_id": tid}, {"_id": 0, "card_id": 1})
    card_id = (card or {}).get("card_id")
    if not card_id:
        return {
            "total_views": 0, "unique_views": 0,
            "views_last_7_days": [], "views_last_30_days": 0,
            "top_cities": [], "top_countries": [], "recent_views": [],
            "card_id": None,
        }
    q = {"$or": [{"card_id": card_id}, {"user_id": tid}]}
    now = utcnow()
    since_7 = now - timedelta(days=7)
    since_30 = now - timedelta(days=30)

    total_views = await db.business_card_views.count_documents(q)
    unique_views_agg = await db.business_card_views.aggregate([
        {"$match": q},
        {"$group": {"_id": "$ip"}},
        {"$count": "n"},
    ]).to_list(1)
    unique_views = (unique_views_agg[0]["n"] if unique_views_agg else 0)

    views_last_30_days = await db.business_card_views.count_documents({**q, "timestamp": {"$gte": since_30}})

    # Timeline last 7 days
    daily_agg = await db.business_card_views.aggregate([
        {"$match": {**q, "timestamp": {"$gte": since_7}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": 1},
        }},
    ]).to_list(31)
    daily_map = {row["_id"]: row["count"] for row in daily_agg}
    views_last_7_days: List[Dict[str, Any]] = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        views_last_7_days.append({"date": day, "count": int(daily_map.get(day, 0))})

    # Top cities
    top_cities_raw = await db.business_card_views.aggregate([
        {"$match": {**q, "city": {"$ne": ""}}},
        {"$group": {
            "_id": {"city": "$city", "country": "$country", "country_code": "$country_code"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]).to_list(10)
    top_cities = [
        {
            "city": r["_id"]["city"],
            "country": r["_id"].get("country") or "",
            "country_code": r["_id"].get("country_code") or "",
            "count": r["count"],
        }
        for r in top_cities_raw
    ]

    # Top countries
    top_countries_raw = await db.business_card_views.aggregate([
        {"$match": {**q, "country": {"$ne": ""}}},
        {"$group": {
            "_id": {"country": "$country", "country_code": "$country_code"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]).to_list(5)
    top_countries = [
        {
            "country": r["_id"]["country"],
            "country_code": r["_id"].get("country_code") or "",
            "count": r["count"],
        }
        for r in top_countries_raw
    ]

    # Recent views (last 20)
    recent_raw = await db.business_card_views.find(
        q, {"_id": 0, "city": 1, "country": 1, "country_code": 1, "timestamp": 1}
    ).sort("timestamp", -1).limit(20).to_list(20)
    recent_views = [
        {
            "city": r.get("city") or "",
            "country": r.get("country") or "",
            "country_code": r.get("country_code") or "",
            "timestamp": (r.get("timestamp").isoformat() if r.get("timestamp") else ""),
        }
        for r in recent_raw
    ]

    return {
        "card_id": card_id,
        "total_views": int(total_views),
        "unique_views": int(unique_views),
        "views_last_7_days": views_last_7_days,
        "views_last_30_days": int(views_last_30_days),
        "top_cities": top_cities,
        "top_countries": top_countries,
        "recent_views": recent_views,
    }


@api_router.get("/master-files")
async def list_master_files(category: Optional[str] = None, q: Optional[str] = None, user=Depends(get_current_user)):
    """V50.z246 — `q`: ricerca (case-insensitive) su nome, titolo e TESTO OCR dei documenti scansionati (Tesseract locale)."""
    flt: Dict[str, Any] = {"user_id": tenant_id(user)}
    if category:
        if category not in ALLOWED_MASTER_CATS:
            raise HTTPException(status_code=400, detail=f"category invalida")
        flt["category"] = category
    if (q or "").strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        flt["$or"] = [{"name": rx}, {"title": rx}, {"ocr_text": rx}]
    items = await db.master_files.find(flt, {"_id": 0, "data_base64": 0, "ocr_text": 0}).sort("created_at", -1).to_list(500)
    if (q or "").strip():
        # estratto del testo OCR attorno alla prima occorrenza (per mostrare «trovato in: …»)
        ids = [it["file_id"] for it in items]
        async for d in db.master_files.find({"user_id": tenant_id(user), "file_id": {"$in": ids}, "ocr_text": {"$exists": True}}, {"_id": 0, "file_id": 1, "ocr_text": 1}):
            txt = d.get("ocr_text") or ""; pos = txt.lower().find(q.strip().lower())
            if pos >= 0:
                for it in items:
                    if it["file_id"] == d["file_id"]:
                        it["ocr_excerpt"] = ("…" if pos > 60 else "") + txt[max(0, pos - 60): pos + 90].replace("\n", " ").replace("\f", " ") + "…"
    return {"items": items}


@api_router.get("/master-files/{file_id}")
async def get_master_file(file_id: str, user=Depends(get_current_user)):
    d = await db.master_files.find_one({"user_id": tenant_id(user), "file_id": file_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="File non trovato")
    # V50.z202 — contenuto su Object Storage: ricaricato SOLO qui su richiesta (compatibilità viewer che legge data_base64)
    if d.get("storage_path") and not d.get("data_base64"):
        got = await run_in_threadpool(_get_object_sync, d["storage_path"])
        d["data_base64"] = base64.b64encode(got[0]).decode() if got else ""
    d["content_url"] = f"/api/master-files/{file_id}/content"
    return d


@api_router.patch("/master-files/{file_id}")
async def rename_master_file(file_id: str, body: MasterFileRenameIn, user=Depends(get_current_user)):
    patch: Dict[str, Any] = {"updated_at": utcnow()}
    if body.name is not None:
        nm = body.name.strip()
        if not nm:
            raise HTTPException(status_code=400, detail="Nome non valido")
        patch["name"] = nm
    if body.title is not None:
        patch["title"] = body.title.strip() or None
    if body.body is not None:
        patch["body"] = body.body
    r = await db.master_files.update_one({"user_id": tenant_id(user), "file_id": file_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="File non trovato")
    return {"ok": True}


@api_router.delete("/master-files/{file_id}")
async def delete_master_file(file_id: str, user=Depends(get_current_user)):
    r = await db.master_files.delete_one({"user_id": tenant_id(user), "file_id": file_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File non trovato")
    return {"ok": True}


# =========================
