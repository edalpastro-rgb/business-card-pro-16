# 18_master_interface.py — Interfaccia Master: contratti, web links, user settings
# Estratto da server.py (righe originali 10361-10941). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V26 — Master Interface support: Contracts, Web Links, User Settings
# =========================

class ContractIn(BaseModel):
    contact_id: Optional[str] = None
    contract_number: Optional[str] = None
    contract_type: str = "energy"  # energy | luce | gas | telco | other
    supplier: Optional[str] = None
    signed_date: Optional[str] = None
    activation_date: Optional[str] = None
    expiry_date: Optional[str] = None
    amount_eur: Optional[float] = None
    status: str = "active"  # draft | active | expired | cancelled
    notes: Optional[str] = ""


class ContractUpdate(BaseModel):
    contact_id: Optional[str] = None
    contract_number: Optional[str] = None
    contract_type: Optional[str] = None
    supplier: Optional[str] = None
    signed_date: Optional[str] = None
    activation_date: Optional[str] = None
    expiry_date: Optional[str] = None
    amount_eur: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class WebLinkIn(BaseModel):
    title: str
    url: str
    icon: Optional[str] = None  # emoji or url


class AudioRecordIn(BaseModel):
    target_type: str  # "personal" | "contact" | "group"
    target_id: Optional[str] = None  # contact_id or group_id
    audio_base64: str
    mime: Optional[str] = "audio/webm"
    duration_sec: Optional[float] = None
    title: Optional[str] = None
    sphere: Optional[str] = None  # V50.z205 — business | home (None → unclassified)


class QuickActionIn(BaseModel):
    id: Optional[str] = None
    label: str
    prompt: str


class UserSettingsIn(BaseModel):
    theme: Optional[str] = None  # "light" | "dark" | "auto"
    accent_color: Optional[str] = None  # hex e.g. "#7C3AED"
    banner_image_url: Optional[str] = None  # Master banner override
    assistant_name: Optional[str] = None  # AI assistant custom name (default "Neo")
    assistant_response_mode: Optional[str] = None  # "text" | "voice" | "both" (default "text")
    assistant_voice: Optional[str] = None  # OpenAI TTS voice: alloy | echo | fable | onyx | nova | shimmer
    assistant_language: Optional[str] = None  # V50.z271 — lingua delle risposte di Axon (it | en | es | fr | de | pt | ro | uk | ar | zh)
    # V28.o — Azioni rapide personalizzabili mostrate nell'empty state della chat Axon.
    # Ogni voce: {id: str, label: str (max ~50 char), prompt: str (comando da inviare)}.
    assistant_quick_actions: Optional[List[QuickActionIn]] = None
    # V29 — Finestra (giorni) per il widget "Scadenze imminenti" in Home.
    # Valori consigliati: 30 | 60 | 90 | 180. Default 60.
    deadlines_window_days: Optional[int] = None
    # Indirizzo di residenza del singolo utente (master/collaboratore/manager):
    # usato dal widget Meteo & Allerte in Home come fallback quando il GPS non è disponibile.
    home_address: Optional[str] = None
    # Tour guidato di benvenuto completato/saltato (per-utente, sopravvive a reinstall/cambio device)
    onboarding_done: Optional[bool] = None
    # V50.z256 — Rilevamento Visite GPS {enabled, stay_minutes, radius_m, mode: realtime|evening|both, recap_time "HH:MM"}
    visit_detection: Optional[Dict[str, Any]] = None
    # V50.z266 — Tour guidato: voce di Axon silenziata (tasto altoparlante in alto a destra)
    tour_voice_muted: Optional[bool] = None


class AssistantAttachmentIn(BaseModel):
    name: str
    mime: Optional[str] = None
    data_base64: str


class AssistantChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None
    # V28.l — Attachments (PDF, Excel, images, txt/csv, ...) inviati con il messaggio.
    # Axon estrae il testo e lo include nel prompt come "contesto allegato".
    attachments: List[AssistantAttachmentIn] = Field(default_factory=list)
    no_cache: Optional[bool] = False  # V50.z260 — stress test: salta la cache semantica


class AssistantTTSIn(BaseModel):
    text: str
    voice: Optional[str] = None


@api_router.post("/contracts")
async def create_contract(body: ContractIn, user=Depends(get_current_user)):
    if body.contact_id:
        c = await db.contacts.find_one(tenant_scope(user, {"contact_id": body.contact_id}))
        if not c:
            raise HTTPException(status_code=404, detail="Contatto non trovato")
    contract_id = f"ctr_{uuid.uuid4().hex[:12]}"
    doc = {
        "contract_id": contract_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "contact_id": body.contact_id,
        "contract_number": body.contract_number,
        "contract_type": body.contract_type,
        "supplier": body.supplier,
        "signed_date": body.signed_date,
        "activation_date": body.activation_date,
        "expiry_date": body.expiry_date,
        "amount_eur": body.amount_eur,
        "status": body.status,
        "notes": body.notes or "",
        "created_at": utcnow(),
    }
    await db.contracts.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.get("/contracts")
async def list_contracts(user=Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": tenant_id(user)}
    vis = await contact_visibility_filter(user)
    if vis:
        # Same visibility rules as contacts: non-admin sees only own (created_by)
        q["created_by"] = user["user_id"]
    items = await db.contracts.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Enrich with contact name (small)
    contact_ids = [c["contact_id"] for c in items if c.get("contact_id")]
    if contact_ids:
        contacts = await db.contacts.find(
            {"contact_id": {"$in": contact_ids}, "user_id": tenant_id(user)},
            {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "contact_code": 1},
        ).to_list(500)
        cmap = {c["contact_id"]: c for c in contacts}
        for it in items:
            it["contact"] = cmap.get(it.get("contact_id"))
    return {"items": items}


@api_router.get("/contracts/new-alerts")
async def contracts_new_alerts(user=Depends(get_current_user)):
    """Returns unread contracts created by OTHER team members in the same tenant.
    A user's last-seen timestamp is stored in user_settings.contracts_last_seen_at."""
    tid = tenant_id(user)
    settings = await db.user_settings.find_one({"user_id": user["user_id"]}) or {}
    last_seen = settings.get("contracts_last_seen_at") or datetime(1970, 1, 1)
    if isinstance(last_seen, str):
        try:
            last_seen = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        except Exception:
            last_seen = datetime(1970, 1, 1)
    count = await db.contracts.count_documents({
        "user_id": tid,
        "created_by": {"$ne": user["user_id"]},
        "created_at": {"$gt": last_seen},
    })
    latest = await db.contracts.find({
        "user_id": tid,
        "created_by": {"$ne": user["user_id"]},
        "created_at": {"$gt": last_seen},
    }, {"_id": 0}).sort("created_at", -1).to_list(10)
    return {"unread": count, "latest": latest}


@api_router.post("/contracts/mark-seen")
async def contracts_mark_seen(user=Depends(get_current_user)):
    now = utcnow()
    await db.user_settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"contracts_last_seen_at": now, "updated_at": now}, "$setOnInsert": {"user_id": user["user_id"], "created_at": now}},
        upsert=True,
    )
    return {"ok": True, "seen_at": now}


@api_router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str, user=Depends(get_current_user)):
    c = await db.contracts.find_one({"user_id": tenant_id(user), "contract_id": contract_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contratto non trovato")
    return c


@api_router.put("/contracts/{contract_id}")
async def update_contract(contract_id: str, body: ContractUpdate, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    updates["updated_at"] = utcnow()
    r = await db.contracts.update_one({"user_id": tenant_id(user), "contract_id": contract_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contratto non trovato")
    return {"ok": True}


@api_router.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, user=Depends(get_current_user)):
    r = await db.contracts.delete_one({"user_id": tenant_id(user), "contract_id": contract_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contratto non trovato")
    return {"ok": True}


# ---- Web Links (My Web) ----
@api_router.get("/web-links")
async def list_web_links(user=Depends(get_current_user)):
    items = await db.web_links.find({"user_id": user["user_id"]}, {"_id": 0}).sort("order", 1).to_list(200)
    return {"items": items}


@api_router.post("/web-links")
async def create_web_link(body: WebLinkIn, user=Depends(get_current_user)):
    link_id = f"lnk_{uuid.uuid4().hex[:10]}"
    order_max = await db.web_links.find_one({"user_id": user["user_id"]}, sort=[("order", -1)])
    order = int(order_max.get("order", 0)) + 1 if order_max else 1
    url = body.url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    doc = {
        "link_id": link_id,
        "user_id": user["user_id"],
        "title": body.title.strip()[:120],
        "url": url,
        "icon": body.icon or "🔗",
        "order": order,
        "created_at": utcnow(),
    }
    await db.web_links.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.delete("/web-links/{link_id}")
async def delete_web_link(link_id: str, user=Depends(get_current_user)):
    r = await db.web_links.delete_one({"user_id": user["user_id"], "link_id": link_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Link non trovato")
    return {"ok": True}


# V50.z73 — Update di un link My Web (Master modifica title/url/icon)
@api_router.put("/web-links/{link_id}")
async def update_web_link(link_id: str, body: WebLinkIn, user=Depends(get_current_user)):
    upd: Dict[str, Any] = {}
    if body.title:
        upd["title"] = body.title.strip()[:120]
    if body.url:
        u = body.url.strip()
        if u and not u.startswith("http://") and not u.startswith("https://"):
            u = "https://" + u
        upd["url"] = u
    if body.icon:
        upd["icon"] = body.icon
    if not upd:
        return {"ok": True, "unchanged": True}
    upd["updated_at"] = utcnow()
    r = await db.web_links.update_one({"user_id": user["user_id"], "link_id": link_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Link non trovato")
    out = await db.web_links.find_one({"user_id": user["user_id"], "link_id": link_id}, {"_id": 0})
    return out


# ---- V50.z58 — Company Web Links (Comunica con l'azienda → Link utili) ----
# Tenant-scoped: il Master configura una volta, tutti gli agenti sotto quel
# Master li vedono nel bottom sheet "Comunica con l'azienda". I link si
# aprono in WebView interna nell'app (non Linking esterno).

class CompanyWebLinkIn(BaseModel):
    title: str
    url: str
    icon: Optional[str] = None
    link_id: Optional[str] = None  # per PUT/DELETE


def _tenant_owner_id(user: Dict[str, Any]) -> str:
    """Il proprietario del tenant (Master). Gli agenti hanno parent_user_id
    valorizzato; i Master lo hanno None e sono loro stessi."""
    return user.get("parent_user_id") or user["user_id"]


@api_router.get("/company-web-links")
async def list_company_web_links(user=Depends(get_current_user)):
    owner = _tenant_owner_id(user)
    items = await db.company_web_links.find(
        {"owner_user_id": owner}, {"_id": 0}
    ).sort("order", 1).to_list(200)
    return {"items": items}


@api_router.post("/company-web-links")
async def create_company_web_link(body: CompanyWebLinkIn, user=Depends(get_current_user)):
    # Solo il Master può modificare
    if user.get("parent_user_id"):
        raise HTTPException(status_code=403, detail="Solo il Master può gestire i Link utili")
    owner = user["user_id"]
    order_max = await db.company_web_links.find_one({"owner_user_id": owner}, sort=[("order", -1)])
    next_order = ((order_max or {}).get("order") or 0) + 1
    u = (body.url or "").strip()
    if u and not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    doc = {
        "link_id": secrets.token_hex(8),
        "owner_user_id": owner,
        "title": (body.title or "").strip()[:80] or "Link",
        "url": u,
        "icon": (body.icon or "🔗").strip()[:8],
        "order": next_order,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.company_web_links.insert_one(doc)
    return {"ok": True, "link": {k: v for k, v in doc.items() if k != "_id"}}


@api_router.put("/company-web-links/{link_id}")
async def update_company_web_link(link_id: str, body: CompanyWebLinkIn, user=Depends(get_current_user)):
    if user.get("parent_user_id"):
        raise HTTPException(status_code=403, detail="Solo il Master può gestire i Link utili")
    u = (body.url or "").strip()
    if u and not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    r = await db.company_web_links.update_one(
        {"owner_user_id": user["user_id"], "link_id": link_id},
        {"$set": {
            "title": (body.title or "").strip()[:80] or "Link",
            "url": u,
            "icon": (body.icon or "🔗").strip()[:8],
            "updated_at": utcnow(),
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Link non trovato")
    return {"ok": True}


@api_router.delete("/company-web-links/{link_id}")
async def delete_company_web_link(link_id: str, user=Depends(get_current_user)):
    if user.get("parent_user_id"):
        raise HTTPException(status_code=403, detail="Solo il Master può gestire i Link utili")
    r = await db.company_web_links.delete_one(
        {"owner_user_id": user["user_id"], "link_id": link_id}
    )
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Link non trovato")
    return {"ok": True}


class ImportMyWebIn(BaseModel):
    """V50.z63 — Se `link_ids` è None/vuoto → importa tutti (comportamento V50.z58).
    Se valorizzato → importa solo i link con quegli id."""
    link_ids: Optional[List[str]] = None


@api_router.post("/company-web-links/import-from-my-web")
async def import_from_my_web(body: Optional[ImportMyWebIn] = None, user=Depends(get_current_user)):
    """V50.z58 — Import "one shot" dei link personali del Master (/web-links)
    verso i Link utili aziendali. V50.z63 — Supporta selezione singola via
    body.link_ids (se assente, importa tutti come prima)."""
    if user.get("parent_user_id"):
        raise HTTPException(status_code=403, detail="Solo il Master può importare i Link utili")
    owner = user["user_id"]
    query: Dict[str, Any] = {"user_id": owner}
    if body and body.link_ids:
        query["link_id"] = {"$in": body.link_ids}
    src = await db.web_links.find(query, {"_id": 0}).sort("order", 1).to_list(200)
    order_max = await db.company_web_links.find_one({"owner_user_id": owner}, sort=[("order", -1)])
    next_order = ((order_max or {}).get("order") or 0) + 1
    added = 0
    skipped_duplicate = 0
    for lk in src:
        # Skip duplicati (stesso URL già presente)
        existing = await db.company_web_links.find_one(
            {"owner_user_id": owner, "url": lk.get("url")}, {"_id": 0}
        )
        if existing:
            skipped_duplicate += 1
            continue
        doc = {
            "link_id": secrets.token_hex(8),
            "owner_user_id": owner,
            "title": (lk.get("title") or "Link")[:80],
            "url": lk.get("url") or "",
            "icon": (lk.get("icon") or "🔗")[:8],
            "order": next_order,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await db.company_web_links.insert_one(doc)
        next_order += 1
        added += 1
    return {
        "ok": True,
        "added": added,
        "skipped_duplicate": skipped_duplicate,
        "source_total": len(src),
    }


# ---- Audio Records (Master recorder) ----
ALLOWED_TARGETS = ("personal", "contact", "group")
_audio_record_hooks: list = []  # V50.z205 — coroutine(doc) eseguite in background dopo la creazione (axon_personal_space: trascrizione)


@api_router.post("/audio-records")
async def create_audio_record(body: AudioRecordIn, user=Depends(get_current_user)):
    if body.target_type not in ALLOWED_TARGETS:
        raise HTTPException(status_code=400, detail=f"target_type non valido: {ALLOWED_TARGETS}")
    b64 = body.audio_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    approx = int(len(b64) * 0.75)
    if approx < 512:
        raise HTTPException(status_code=400, detail="Audio troppo corto")
    if approx > 30 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio troppo grande (max ~30 MB)")

    if body.target_type == "contact":
        if not body.target_id:
            raise HTTPException(status_code=400, detail="target_id (contact_id) richiesto")
        c = await db.contacts.find_one(tenant_scope(user, {"contact_id": body.target_id}))
        if not c:
            raise HTTPException(status_code=404, detail="Contatto non trovato")
    elif body.target_type == "group":
        if not body.target_id:
            raise HTTPException(status_code=400, detail="target_id (group_id) richiesto")
        g = await db.groups.find_one({"group_id": body.target_id, "user_id": tenant_id(user)})
        if not g:
            raise HTTPException(status_code=404, detail="Gruppo non trovato")

    audio_id = f"aud_{uuid.uuid4().hex[:12]}"
    doc = {
        "audio_id": audio_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "target_type": body.target_type,
        "target_id": body.target_id,
        "audio_base64": body.audio_base64,
        "mime": body.mime or "audio/webm",
        "duration_sec": body.duration_sec,
        "size_bytes": approx,
        "title": body.title or None,
        "sphere": body.sphere if body.sphere in ("business", "home") else "unclassified",  # V50.z205
        "transcribe_status": "pending" if body.target_type == "personal" else None,
        "created_at": utcnow(),
    }
    await db.audio_records.insert_one(doc)
    strip_id(doc)
    doc.pop("audio_base64", None)
    for _h in _audio_record_hooks:
        asyncio.create_task(_h(dict(doc)))
    return doc


@api_router.get("/audio-records")
async def list_audio_records(target_type: Optional[str] = None, target_id: Optional[str] = None, sphere: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": tenant_id(user)}
    if target_type:
        if target_type not in ALLOWED_TARGETS:
            raise HTTPException(status_code=400, detail="target_type non valido")
        q["target_type"] = target_type
    if target_id:
        q["target_id"] = target_id
    if sphere:  # V50.z205 — filtro sfera (gli audio storici senza campo contano come "unclassified")
        q["sphere"] = {"$in": [None, "unclassified"]} if sphere == "unclassified" else sphere
    # personal recordings scoped to the creator
    if target_type == "personal" or (target_type is None and not target_id):
        # If listing personal, restrict to created_by
        if target_type == "personal":
            q["created_by"] = user["user_id"]
    items = await db.audio_records.find(q, {"_id": 0, "audio_base64": 0}).sort("created_at", -1).to_list(200)
    for it in items:
        it.setdefault("sphere", "unclassified")
    return {"items": items}


@api_router.get("/audio-records/{audio_id}")
async def get_audio_record(audio_id: str, user=Depends(get_current_user)):
    a = await db.audio_records.find_one({"user_id": tenant_id(user), "audio_id": audio_id}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Audio non trovato")
    # For personal, only creator can access
    if a.get("target_type") == "personal" and a.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    return a


@api_router.put("/audio-records/{audio_id}/title")
async def rename_audio_record(audio_id: str, body: dict, user=Depends(get_current_user)):
    a = await db.audio_records.find_one({"user_id": tenant_id(user), "audio_id": audio_id})
    if not a:
        raise HTTPException(status_code=404, detail="Audio non trovato")
    if not is_owner(user) and a.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    new_title = (body.get("title") or "").strip()[:200]
    await db.audio_records.update_one({"audio_id": audio_id}, {"$set": {"title": new_title or None, "updated_at": utcnow()}})
    return {"ok": True, "title": new_title or None}


@api_router.delete("/audio-records/{audio_id}")
async def delete_audio_record(audio_id: str, user=Depends(get_current_user)):
    a = await db.audio_records.find_one({"user_id": tenant_id(user), "audio_id": audio_id})
    if not a:
        raise HTTPException(status_code=404, detail="Audio non trovato")
    # Only creator (or owner) can delete
    if not is_owner(user) and a.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Solo il creatore può eliminare")
    await db.audio_records.delete_one({"audio_id": audio_id})
    return {"ok": True}


# ---- User Settings (theme / accent / banner / quick actions) ----
# V28.o — Default quick actions (used when user has not customized them).
DEFAULT_QUICK_ACTIONS: List[Dict[str, str]] = [
    {"id": "qa_default_1", "label": "Prossimo appuntamento", "prompt": "Qual è il mio prossimo appuntamento?"},
    {"id": "qa_default_2", "label": "Telefonate di oggi", "prompt": "Quante telefonate ho fatto oggi?"},
    {"id": "qa_default_3", "label": "Clienti senza appuntamento", "prompt": "Mostrami i clienti senza appuntamento futuro"},
    {"id": "qa_default_4", "label": "Ritelefonate urgenti", "prompt": "Quali sono le ritelefonate urgenti da fare oggi?"},
]


def _normalize_quick_actions(raw: Any) -> List[Dict[str, str]]:
    """Ensures every quick action has a stable id + trimmed label/prompt."""
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, str]] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        label = str(it.get("label") or "").strip()
        prompt = str(it.get("prompt") or "").strip()
        if not label or not prompt:
            continue
        qid = str(it.get("id") or "").strip() or f"qa_{uuid.uuid4().hex[:10]}"
        out.append({"id": qid, "label": label[:80], "prompt": prompt[:2000]})
    return out


@api_router.get("/user-settings")
async def get_user_settings(user=Depends(get_current_user)):
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {
        "user_id": user["user_id"], "theme": "light", "accent_color": "#7C3AED", "banner_image_url": None, "assistant_name": "Neo", "assistant_response_mode": "text", "assistant_voice": "nova"
    }
    if not s.get("assistant_name"):
        s["assistant_name"] = "Neo"
    if not s.get("assistant_response_mode"):
        s["assistant_response_mode"] = "text"
    if not s.get("assistant_voice"):
        s["assistant_voice"] = "nova"
    # V29 — Default finestra scadenze
    if not isinstance(s.get("deadlines_window_days"), int) or s.get("deadlines_window_days") <= 0:
        s["deadlines_window_days"] = 60
    # V28.o — Se l'utente non ha personalizzato le azioni rapide, restituiamo i default
    # (senza persistere: l'utente può cominciare da zero o dai preset a sua scelta).
    if not isinstance(s.get("assistant_quick_actions"), list):
        s["assistant_quick_actions"] = list(DEFAULT_QUICK_ACTIONS)
    else:
        s["assistant_quick_actions"] = _normalize_quick_actions(s.get("assistant_quick_actions"))
    s["onboarding_done"] = bool(s.get("onboarding_done"))
    s["tour_voice_muted"] = bool(s.get("tour_voice_muted"))
    return s


@api_router.put("/user-settings")
async def update_user_settings(body: UserSettingsIn, user=Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return {"ok": True}
    # V28.o — Normalize quick_actions (attach ids, trim, drop empties)
    if "assistant_quick_actions" in updates:
        updates["assistant_quick_actions"] = _normalize_quick_actions(updates["assistant_quick_actions"])
    # V29 — Clamp deadlines window in a sane range
    if "deadlines_window_days" in updates:
        try:
            v = int(updates["deadlines_window_days"])
        except Exception:
            v = 60
        updates["deadlines_window_days"] = max(7, min(v, 365))
    updates["updated_at"] = utcnow()
    now = utcnow()
    await db.user_settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": updates, "$setOnInsert": {"user_id": user["user_id"], "created_at": now}},
        upsert=True,
    )
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if isinstance(s.get("assistant_quick_actions"), list):
        s["assistant_quick_actions"] = _normalize_quick_actions(s.get("assistant_quick_actions"))
    return s


# =========================
