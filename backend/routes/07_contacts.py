# 07_contacts.py — Contatti: CRUD, visibilità, import CSV/Excel, references
# Estratto da server.py (righe originali 2511-4050). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Contacts
# =========================
async def contact_visibility_filter(user: dict) -> Dict[str, Any]:
    """V24: role-based contact visibility filter to be $and-merged with tenant scope.
    - Owner or non-nested admin (top-level tenant admin): see all → return {}.
    - Group manager (admin with parent): see contacts assigned to self OR descendants OR unassigned.
    - Standard member: see only contacts assigned to self.
    """
    if is_owner(user):
        return {}
    role = user.get("role") or "member"
    uid = user["user_id"]
    if role == "admin":
        # Group manager scope: self + descendants + unassigned (orphans)
        descendants = await descendant_user_ids(uid)
        pool = [uid] + descendants
        return {"$or": [
            {"assigned_to_user_id": {"$in": pool}},
            {"assigned_to_user_id": {"$exists": False}},
            {"assigned_to_user_id": None},
        ]}
    # member
    return {"assigned_to_user_id": uid}


@api_router.get("/contacts")
async def list_contacts(area: Optional[str] = None, q: Optional[str] = None, group_id: Optional[str] = None, user=Depends(get_current_user)):
    query: Dict[str, Any] = tenant_scope(user)
    and_clauses: List[Dict[str, Any]] = []
    vis = await contact_visibility_filter(user)
    if vis:
        and_clauses.append(vis)
    if area:
        and_clauses.append({"$or": [{"area": area}, {"additional_areas": area}]})
    if group_id:
        query["group_ids"] = group_id
    if q:
        and_clauses.append({"$or": [
            {"first_name": {"$regex": q, "$options": "i"}},
            {"last_name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            # V28.z — Codice cliente ricercabile dalla barra principale
            {"contact_code": {"$regex": q, "$options": "i"}},
        ]})
    if and_clauses:
        query["$and"] = and_clauses
    items = await db.contacts.find(query, {"_id": 0, "notes": 0, "files": 0, "business_card": 0}).sort([("created_at", -1)]).to_list(1000)
    return {"items": items}


class ContactAssignIn(BaseModel):
    assignee_user_id: Optional[str] = None  # None = unassign


@api_router.put("/contacts/{contact_id}/assign")
async def assign_contact(contact_id: str, body: ContactAssignIn, user=Depends(get_current_user)):
    # Owner: can assign to any tenant member
    # Group manager (admin non-owner): only to self or descendants
    # Member: not allowed
    if user.get("role") == "member":
        raise HTTPException(status_code=403, detail="Non autorizzato")
    existing = await db.contacts.find_one(tenant_scope(user, {"contact_id": contact_id}))
    if not existing:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    assignee = body.assignee_user_id
    if assignee is not None and not is_owner(user):
        # Verify assignee is self or descendant
        allowed = [user["user_id"]] + await descendant_user_ids(user["user_id"])
        if assignee not in allowed:
            raise HTTPException(status_code=403, detail="Puoi assegnare solo ai tuoi collaboratori")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if assignee is None:
        await db.contacts.update_one({"contact_id": contact_id}, {"$unset": {"assigned_to_user_id": ""}, "$set": upd})
    else:
        upd["assigned_to_user_id"] = assignee
        await db.contacts.update_one({"contact_id": contact_id}, {"$set": upd})
    c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "notes": 0, "files": 0})
    return c


AREA_PREFIX_DEFAULT = {"energy": "EN", "network": "NW"}


def _prefix_for_area(area: str, settings: Optional[dict] = None) -> str:
    if area in AREA_PREFIX_DEFAULT:
        return AREA_PREFIX_DEFAULT[area]
    # Try custom_areas
    if settings:
        for a in settings.get("custom_areas") or []:
            if a.get("id") == area:
                p = (a.get("prefix") or a.get("name") or a.get("id") or "")[:2].upper()
                return p or "XX"
    return (area or "XX")[:2].upper()


async def _next_contact_code(user: dict, area: str) -> str:
    """Generate the next sequential code for the user's tenant + area: `<PFX>-0001`."""
    tid = tenant_id(user)
    settings = await db.settings.find_one({"user_id": tid}) or {}
    prefix = _prefix_for_area(area, settings)
    # Find current max seq for this prefix
    last = await db.contacts.find_one(
        {"user_id": tid, "contact_code": {"$regex": f"^{prefix}-\\d+$"}},
        sort=[("contact_code", -1)],
        projection={"contact_code": 1},
    )
    if last and last.get("contact_code"):
        try:
            n = int(last["contact_code"].split("-", 1)[1])
        except Exception:
            n = 0
    else:
        n = 0
    return f"{prefix}-{n + 1:04d}"



# ============================================================================
# V50.z66 — Import CSV / Excel contatti con mappatura colonne
# ============================================================================
CONTACT_FIELD_ALIASES: Dict[str, List[str]] = {
    "first_name": ["nome", "first name", "firstname", "given name", "given_name"],
    "last_name": ["cognome", "last name", "lastname", "surname", "family name", "family_name"],
    "phone": ["telefono", "cellulare", "mobile", "phone", "phone number", "tel"],
    "phone_alt": ["telefono 2", "phone 2", "phone alt", "altro telefono", "secondo telefono"],
    "whatsapp": ["whatsapp", "wa", "whats app"],
    "email": ["email", "mail", "e-mail", "posta", "e mail"],
    "email_alt": ["email 2", "email alt", "altro email", "seconda email"],
    "address": ["indirizzo", "address"],
    "address_street": ["via", "strada", "street"],
    "address_number": ["civico", "numero civico", "number"],
    "address_zip": ["cap", "zip", "postal code", "codice postale"],
    "address_city": ["citta", "citta'", "city", "comune"],
    "address_province": ["provincia", "province", "prov"],
    "birth_date": ["data di nascita", "nato il", "birth date", "birthdate", "compleanno", "birthday"],
    "fiscal_code": ["codice fiscale", "cf", "fiscal code"],
    "vat_number": ["partita iva", "p iva", "piva", "vat", "vat number"],
    "website": ["sito", "sito web", "website", "web"],
    "linkedin": ["linkedin", "in"],
    "instagram": ["instagram", "ig"],
    "facebook": ["facebook", "fb"],
    "telegram": ["telegram", "tg"],
    "energy_ref_name": ["referente energia", "referente"],
    "energy_ref_phone": ["telefono referente", "referente telefono"],
    "energy_ref_email": ["email referente", "referente email"],
    "general_note": ["note", "note generali", "notes", "nota", "descrizione"],
    "tags": ["tag", "tags", "etichette"],
    "contact_code": ["codice", "codice contatto"],
}


def _fuzzy_map_column(col_name: str) -> Optional[str]:
    n = (col_name or "").strip().lower().replace("_", " ").replace(".", " ")
    n = re.sub(r"\s+", " ", n)
    if not n:
        return None
    for canonical, aliases in CONTACT_FIELD_ALIASES.items():
        if n == canonical.replace("_", " "):
            return canonical
        for a in aliases:
            if n == a.lower():
                return canonical
    return None


def _parse_import_file(filename: str, content: bytes) -> Tuple[List[str], List[Dict[str, str]]]:
    """Parse CSV o Excel → (headers, rows). Max 500 righe."""
    fn = (filename or "").lower()
    if fn.endswith(".xlsx") or fn.endswith(".xls"):
        from openpyxl import load_workbook
        import io as _io
        wb = load_workbook(_io.BytesIO(content), data_only=True, read_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        if not all_rows:
            return [], []
        headers = [str(h or "").strip() for h in all_rows[0]]
        rows = []
        for r in all_rows[1:501]:
            d = {}
            for i, v in enumerate(r):
                if i < len(headers) and headers[i]:
                    d[headers[i]] = "" if v is None else str(v).strip()
            if any(d.values()):
                rows.append(d)
        return headers, rows
    else:
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                text = content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise HTTPException(400, "Encoding CSV non riconosciuto")
        first_line = text.split("\n", 1)[0]
        delim = ";" if first_line.count(";") > first_line.count(",") else ","
        import csv as _csv
        from io import StringIO
        reader = _csv.DictReader(StringIO(text), delimiter=delim)
        headers = [h.strip() for h in (reader.fieldnames or [])]
        rows = []
        for i, r in enumerate(reader):
            if i >= 500:
                break
            d = {h: (r.get(h) or "").strip() for h in headers}
            if any(d.values()):
                rows.append(d)
        return headers, rows


# ─────────────────────────────────────────────────────────────────────────────
# V50.z67 — Campi personalizzati anagrafica contatti
# Il Master (owner) può definire campi custom da aggiungere alla scheda cliente.
# ─────────────────────────────────────────────────────────────────────────────

_ALLOWED_CF_TYPES = {"text", "number", "date", "checkbox"}
_ALLOWED_CF_VISIBILITY = {"master", "all"}


def _slugify_cf_key(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[àáâãä]", "a", s)
    s = re.sub(r"[èéêë]", "e", s)
    s = re.sub(r"[ìíîï]", "i", s)
    s = re.sub(r"[òóôõö]", "o", s)
    s = re.sub(r"[ùúûü]", "u", s)
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s or "campo"


class ContactCustomFieldIn(BaseModel):
    name: str
    type: str  # text | number | date | checkbox
    visibility: str = "all"  # master | all
    order: Optional[int] = None
    required: bool = False


class ContactCustomFieldUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    visibility: Optional[str] = None
    order: Optional[int] = None
    required: Optional[bool] = None


class ContactCustomFieldReorderIn(BaseModel):
    field_ids: List[str]


def _is_cf_value_empty(val: Any) -> bool:
    """Return True if a custom-field value is considered empty/missing."""
    if val is None:
        return True
    if isinstance(val, bool):
        # checkbox: solo False è considerato "vuoto" se required? Interpretiamo required=deve essere True.
        return val is False
    if isinstance(val, str):
        return val.strip() == ""
    if isinstance(val, (list, dict)):
        return len(val) == 0
    return False


async def _validate_required_custom_fields(user: dict, custom_fields: Optional[Dict[str, Any]]) -> None:
    """Raise 400 if any required custom field def is missing/empty in custom_fields."""
    tid = tenant_id(user)
    required_defs = await db.contact_custom_field_defs.find(
        {"user_id": tid, "required": True}, {"_id": 0, "key": 1, "name": 1, "type": 1}
    ).to_list(200)
    if not required_defs:
        return
    cf = custom_fields or {}
    missing = [d["name"] for d in required_defs if _is_cf_value_empty(cf.get(d["key"]))]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Campi obbligatori mancanti: {', '.join(missing)}",
        )


@api_router.get("/contact-custom-fields")
async def list_contact_custom_fields(user=Depends(get_current_user)):
    """List custom field definitions per tenant. Non-master users only see visibility=='all'."""
    q: Dict[str, Any] = {"user_id": tenant_id(user)}
    if not is_admin_or_owner(user):
        q["visibility"] = "all"
    items = await db.contact_custom_field_defs.find(q, {"_id": 0}).sort("order", 1).to_list(200)
    return items


@api_router.post("/contact-custom-fields")
async def create_contact_custom_field(body: ContactCustomFieldIn, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può creare campi personalizzati")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome campo obbligatorio")
    if body.type not in _ALLOWED_CF_TYPES:
        raise HTTPException(status_code=400, detail=f"Tipo non valido (uno tra {sorted(_ALLOWED_CF_TYPES)})")
    if body.visibility not in _ALLOWED_CF_VISIBILITY:
        raise HTTPException(status_code=400, detail=f"Visibilità non valida (uno tra {sorted(_ALLOWED_CF_VISIBILITY)})")
    tid = tenant_id(user)
    base_key = _slugify_cf_key(name)
    # unique key per tenant
    key = base_key
    n = 1
    while await db.contact_custom_field_defs.find_one({"user_id": tid, "key": key}):
        n += 1
        key = f"{base_key}_{n}"
    # order: default = last
    if body.order is None:
        count = await db.contact_custom_field_defs.count_documents({"user_id": tid})
        order = count
    else:
        order = int(body.order)
    doc = {
        "field_id": f"fcf_{uuid.uuid4().hex[:12]}",
        "user_id": tid,
        "created_by": user["user_id"],
        "key": key,
        "name": name,
        "type": body.type,
        "visibility": body.visibility,
        "required": bool(body.required),
        "order": order,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.contact_custom_field_defs.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.put("/contact-custom-fields/{field_id}")
async def update_contact_custom_field(field_id: str, body: ContactCustomFieldUpdate, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può modificare campi personalizzati")
    tid = tenant_id(user)
    existing = await db.contact_custom_field_defs.find_one({"field_id": field_id, "user_id": tid})
    if not existing:
        raise HTTPException(status_code=404, detail="Campo non trovato")
    upd: Dict[str, Any] = {}
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Nome campo non può essere vuoto")
        upd["name"] = n
    if body.type is not None:
        if body.type not in _ALLOWED_CF_TYPES:
            raise HTTPException(status_code=400, detail="Tipo non valido")
        upd["type"] = body.type
    if body.visibility is not None:
        if body.visibility not in _ALLOWED_CF_VISIBILITY:
            raise HTTPException(status_code=400, detail="Visibilità non valida")
        upd["visibility"] = body.visibility
    if body.order is not None:
        upd["order"] = int(body.order)
    if body.required is not None:
        upd["required"] = bool(body.required)
    if not upd:
        return {"ok": True, "unchanged": True}
    upd["updated_at"] = utcnow()
    await db.contact_custom_field_defs.update_one({"field_id": field_id, "user_id": tid}, {"$set": upd})
    out = await db.contact_custom_field_defs.find_one({"field_id": field_id}, {"_id": 0})
    return out


@api_router.delete("/contact-custom-fields/{field_id}")
async def delete_contact_custom_field(field_id: str, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può eliminare campi personalizzati")
    tid = tenant_id(user)
    existing = await db.contact_custom_field_defs.find_one({"field_id": field_id, "user_id": tid})
    if not existing:
        raise HTTPException(status_code=404, detail="Campo non trovato")
    key = existing.get("key")
    await db.contact_custom_field_defs.delete_one({"field_id": field_id, "user_id": tid})
    # Cleanup: rimuovi la key dai contatti del tenant
    if key:
        try:
            await db.contacts.update_many(
                scope_query(user, {}),
                {"$unset": {f"custom_fields.{key}": ""}},
            )
        except Exception:
            pass
    return {"ok": True, "deleted_key": key}


@api_router.post("/contact-custom-fields/reorder")
async def reorder_contact_custom_fields(body: ContactCustomFieldReorderIn, user=Depends(get_current_user)):
    """Reorder custom fields based on the provided list of field_ids (top-to-bottom)."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può riordinare campi personalizzati")
    tid = tenant_id(user)
    seen: set = set()
    order = 0
    for fid in body.field_ids:
        if not fid or fid in seen:
            continue
        seen.add(fid)
        await db.contact_custom_field_defs.update_one(
            {"field_id": fid, "user_id": tid},
            {"$set": {"order": order, "updated_at": utcnow()}},
        )
        order += 1
    return {"ok": True, "reordered": order}


# ─────────────────────────────────────────────────────────────────────────────
# V50.z71 — Geocoding & distance (OpenStreetMap Nominatim, cache 30 giorni)
# ─────────────────────────────────────────────────────────────────────────────

import math as _math
import asyncio as _asyncio
import httpx as _httpx

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_PHOTON_URL = "https://photon.komoot.io/api"
_NOMINATIM_UA = "AdvisorOS-CRM/1.0 (contact: support@advisoros.it)"
_geocode_lock = _asyncio.Lock()
_last_nominatim_call = 0.0


class GeocodeDistancesIn(BaseModel):
    origin: str
    targets: List[str] = Field(default_factory=list)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km."""
    r = 6371.0
    p1 = _math.radians(lat1)
    p2 = _math.radians(lat2)
    dp = _math.radians(lat2 - lat1)
    dl = _math.radians(lon2 - lon1)
    a = _math.sin(dp / 2) ** 2 + _math.cos(p1) * _math.cos(p2) * _math.sin(dl / 2) ** 2
    c = 2 * _math.atan2(_math.sqrt(a), _math.sqrt(1 - a))
    return r * c


async def _geocode_one(query: str) -> Optional[Dict[str, float]]:
    """Geocoding con cache 30gg + fallback multi-provider (Photon primary, Nominatim secondary)."""
    global _last_nominatim_call
    q = (query or "").strip()
    if not q:
        return None
    # Cache lookup (30 giorni)
    try:
        cached = await db.geocode_cache.find_one({"query": q}, {"_id": 0})
    except Exception:
        cached = None
    if cached:
        cached_at = cached.get("cached_at")
        if isinstance(cached_at, datetime):
            # Normalizza timezone: se `cached_at` è naive (letto da Mongo senza tz), assumiamo UTC
            if cached_at.tzinfo is None:
                cached_at = cached_at.replace(tzinfo=timezone.utc)
            age = (utcnow() - cached_at).total_seconds()
        else:
            age = 0
        if age < 30 * 24 * 3600:
            if cached.get("lat") is not None and cached.get("lon") is not None:
                return {"lat": cached["lat"], "lon": cached["lon"]}
            # cached-not-found: V50.z151 — riprova dopo 10 minuti (prima 24h: un'indisponibilità
            # temporanea del provider bloccava per un giorno l'indirizzo appena impostato dall'utente)
            if age < 10 * 60:
                return None

    async def _try_photon() -> Optional[Dict[str, float]]:
        try:
            async with _httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _NOMINATIM_UA}) as client:
                # Photon supporta solo: default/de/en/fr — usiamo default (multilingua/senza filtro)
                r = await client.get(_PHOTON_URL, params={"q": q, "limit": 1})
                if r.status_code != 200:
                    return None
                data = r.json() or {}
                feats = data.get("features") or []
                if not feats:
                    return None
                coords = (feats[0].get("geometry") or {}).get("coordinates") or []
                if len(coords) >= 2:
                    return {"lat": float(coords[1]), "lon": float(coords[0])}  # [lon, lat]
        except Exception:
            return None
        return None

    async def _try_nominatim() -> Optional[Dict[str, float]]:
        global _last_nominatim_call
        async with _geocode_lock:
            import time as _time
            now = _time.time()
            wait = max(0.0, 1.05 - (now - _last_nominatim_call))
            if wait > 0:
                await _asyncio.sleep(wait)
            try:
                async with _httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _NOMINATIM_UA, "Accept-Language": "it"}) as client:
                    r = await client.get(_NOMINATIM_URL, params={"q": q, "format": "json", "limit": 1, "countrycodes": "it"})
                    _last_nominatim_call = _time.time()
                    if r.status_code != 200:
                        return None
                    data = r.json() or []
                    if not data:
                        return None
                    return {"lat": float(data[0].get("lat")), "lon": float(data[0].get("lon"))}
            except Exception:
                return None

    async def _try_openmeteo_geocode() -> Optional[Dict[str, float]]:
        """V50.z151 — Terzo fallback: geocoding Open-Meteo (stesso provider del meteo, sempre
        raggiungibile dove funziona il meteo). Ottimo per città/CAP; per indirizzi con via prova
        progressivamente le parti dopo la virgola e le ultime parole (es. "Via Roma 10, Padova" → "Padova")."""
        parts = [p.strip() for p in re.split(r"[,;]", q) if p.strip()]
        cands: List[str] = [q]
        cands += [p for p in reversed(parts) if p not in cands]
        # ultime 1-2 parole (senza numeri civici / CAP / sigle provincia "PD" o tra parentesi)
        words = [
            w for w in re.sub(r"\([^)]*\)", " ", q).replace(",", " ").split()
            if not re.fullmatch(r"\d+[a-zA-Z]?", w) and not re.fullmatch(r"[A-Z]{2}", w)
        ]
        if words:
            for n in (2, 1):
                cand = " ".join(words[-n:])
                if cand and cand not in cands:
                    cands.append(cand)
            for w in reversed(words):
                if len(w) >= 4 and w not in cands:
                    cands.append(w)
        try:
            async with _httpx.AsyncClient(timeout=8.0) as client:
                for cand in cands[:7]:
                    r = await client.get(
                        "https://geocoding-api.open-meteo.com/v1/search",
                        params={"name": cand, "count": 1, "language": "it", "format": "json"},
                    )
                    if r.status_code != 200:
                        continue
                    res = (r.json() or {}).get("results") or []
                    if res and res[0].get("latitude") is not None:
                        return {"lat": float(res[0]["latitude"]), "lon": float(res[0]["longitude"])}
        except Exception:
            return None
        return None

    # Prova Photon prima (no rate limit stringente), poi fallback Nominatim, poi Open-Meteo (V50.z151)
    result = await _try_photon()
    if not result:
        result = await _try_nominatim()
    if not result:
        result = await _try_openmeteo_geocode()

    # Cache result (anche fallimenti per evitare hammering)
    try:
        if result:
            await db.geocode_cache.update_one(
                {"query": q},
                {"$set": {"query": q, "lat": result["lat"], "lon": result["lon"], "cached_at": utcnow()}},
                upsert=True,
            )
        else:
            await db.geocode_cache.update_one(
                {"query": q},
                {"$set": {"query": q, "lat": None, "lon": None, "cached_at": utcnow()}},
                upsert=True,
            )
    except Exception:
        pass
    return result


@api_router.post("/geocode/distances")
async def geocode_distances(body: GeocodeDistancesIn, user=Depends(get_current_user)):
    """
    Return distances (km, arrotondate a 1 decimale) da `origin` a ciascun target.
    Se un target non è geocodificabile → None nella lista.
    """
    origin_coords = await _geocode_one(body.origin)
    distances: List[Optional[float]] = []
    if not origin_coords:
        return {"origin_valid": False, "distances_km": [None] * len(body.targets)}
    for t in body.targets:
        c = await _geocode_one(t)
        if not c:
            distances.append(None)
        else:
            km = _haversine_km(origin_coords["lat"], origin_coords["lon"], c["lat"], c["lon"])
            distances.append(round(km, 1))
    return {"origin_valid": True, "distances_km": distances}


# ─────────────────────────────────────────────────────────────────────────────
# V50.z79 — Meteo (Open-Meteo) + allerte (Protezione Civile / Open-Meteo warnings)
# Cache 1h su collezione weather_cache per non sforare i limiti (10k req/day free)
# ─────────────────────────────────────────────────────────────────────────────

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
_OPEN_METEO_WARN_URL = "https://api.open-meteo.com/v1/forecast"  # con &current_weather + weather_code

_WEATHER_CODE_ICON = {
    # WMO Weather Interpretation Codes → emoji-ish icon key per frontend
    0: {"key": "sunny", "label": "Sereno"},
    1: {"key": "sunny", "label": "Prev. sereno"},
    2: {"key": "partly_cloudy", "label": "Parz. nuvoloso"},
    3: {"key": "cloudy", "label": "Nuvoloso"},
    45: {"key": "fog", "label": "Nebbia"},
    48: {"key": "fog", "label": "Nebbia brinata"},
    51: {"key": "drizzle", "label": "Pioviggine leggera"},
    53: {"key": "drizzle", "label": "Pioviggine"},
    55: {"key": "drizzle", "label": "Pioviggine intensa"},
    61: {"key": "rain", "label": "Pioggia leggera"},
    63: {"key": "rain", "label": "Pioggia"},
    65: {"key": "rain_heavy", "label": "Pioggia intensa"},
    71: {"key": "snow", "label": "Neve leggera"},
    73: {"key": "snow", "label": "Neve"},
    75: {"key": "snow_heavy", "label": "Neve intensa"},
    77: {"key": "snow", "label": "Grani di neve"},
    80: {"key": "rain", "label": "Rovesci leggeri"},
    81: {"key": "rain", "label": "Rovesci"},
    82: {"key": "rain_heavy", "label": "Rovesci violenti"},
    85: {"key": "snow", "label": "Rovesci nevosi"},
    86: {"key": "snow_heavy", "label": "Rovesci nevosi forti"},
    95: {"key": "thunderstorm", "label": "Temporale"},
    96: {"key": "thunderstorm", "label": "Temporale con grandine"},
    99: {"key": "thunderstorm", "label": "Temporale violento"},
}


class WeatherPoint(BaseModel):
    lat: float
    lon: float
    date: Optional[str] = None  # ISO date "YYYY-MM-DD"; se None → oggi


class WeatherBatchIn(BaseModel):
    points: List[WeatherPoint]


class WeatherAlertsIn(BaseModel):
    lat: Optional[float] = None
    lon: Optional[float] = None
    # Se lat/lon mancano (GPS negato/web): geocoding di `address`, altrimenti
    # fallback su user_settings.home_address del singolo utente, poi office_address del tenant.
    address: Optional[str] = None


async def _openmeteo_get(client, params: Dict[str, Any], timeout_label: str):
    """V50.z337 — GET Open-Meteo con 1 retry automatico (backoff 5 s) in caso di HTTP 429 (troppe richieste)."""
    r = await client.get(_OPEN_METEO_URL, params=params)
    if r.status_code == 429:
        logger.warning("open-meteo 429 (%s): retry in 5s", timeout_label)
        await _asyncio.sleep(5)
        r = await client.get(_OPEN_METEO_URL, params=params)
    return r


async def _fetch_openmeteo_daily(lat: float, lon: float, date_iso: Optional[str]) -> Optional[Dict[str, Any]]:
    """Cache 1h. Ritorna {weather_code, temp_min, temp_max, temp, icon_key, label} per la data.
    V50.z337 — retry su 429 + se la chiamata fallisce si restituisce comunque il dato in cache anche se scaduto."""
    d = date_iso or utcnow().strftime("%Y-%m-%d")
    cache_key = f"{round(lat,3)},{round(lon,3)}|{d}"
    try:
        cached = await db.weather_cache.find_one({"key": cache_key}, {"_id": 0})
    except Exception:
        cached = None
    stale_data = cached.get("data") if cached else None
    if cached and isinstance(cached.get("cached_at"), datetime):
        ca = cached["cached_at"]
        if ca.tzinfo is None:
            ca = ca.replace(tzinfo=timezone.utc)
        if (utcnow() - ca).total_seconds() < 3600:
            return cached.get("data")
    try:
        async with _httpx.AsyncClient(timeout=8.0) as client:
            r = await _openmeteo_get(client, {
                "latitude": lat, "longitude": lon,
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
                "start_date": d, "end_date": d,
                "timezone": "auto",
            }, "daily")
            if r.status_code != 200:
                logger.warning("open-meteo daily HTTP %s for %s,%s %s", r.status_code, lat, lon, d)
                return stale_data
            j = r.json() or {}
            daily = j.get("daily") or {}
            times = daily.get("time") or []
            if not times:
                return None
            idx = 0
            code = int((daily.get("weather_code") or [0])[idx] or 0)
            tmin = float((daily.get("temperature_2m_min") or [0])[idx] or 0)
            tmax = float((daily.get("temperature_2m_max") or [0])[idx] or 0)
            precip = float((daily.get("precipitation_sum") or [0])[idx] or 0)
            wind = float((daily.get("wind_speed_10m_max") or [0])[idx] or 0)
            meta = _WEATHER_CODE_ICON.get(code, {"key": "cloudy", "label": "Meteo"})
            data = {
                "weather_code": code,
                "temp_min": round(tmin, 1),
                "temp_max": round(tmax, 1),
                "temp": round((tmin + tmax) / 2.0, 1),
                "precipitation_mm": round(precip, 1),
                "wind_kmh": round(wind, 1),
                "icon_key": meta["key"],
                "label": meta["label"],
            }
            try:
                await db.weather_cache.update_one(
                    {"key": cache_key}, {"$set": {"key": cache_key, "data": data, "cached_at": utcnow()}}, upsert=True,
                )
            except Exception:
                pass
            return data
    except Exception as e:
        # V50.z119 — Log esplicito: in produzione un "Meteo non disponibile" dipende
        # quasi sempre da timeout/blocco verso api.open-meteo.com → visibile nei log backend.
        logger.warning("open-meteo daily fetch failed (%s,%s %s): %s", lat, lon, d, e)
        return stale_data


@api_router.post("/weather/forecast-batch")
async def weather_forecast_batch(body: WeatherBatchIn, user=Depends(get_current_user)):
    """Ritorna previsioni per una lista di (lat, lon, date). Cache 1h per punto+data."""
    results = []
    for p in body.points[:100]:
        d = await _fetch_openmeteo_daily(p.lat, p.lon, p.date)
        results.append(d)
    return {"results": results}


@api_router.post("/weather/alerts")
async def weather_alerts(body: WeatherAlertsIn, user=Depends(get_current_user)):
    """Rileva allerte meteo attive per la posizione: usa Open-Meteo (dati 24h)
    + soglie locali per generare eventi di severità (rossa/arancione/gialla).
    Approssima le allerte della Protezione Civile — utile per non appesantire il feed XML."""
    d_today = utcnow().strftime("%Y-%m-%d")
    lat, lon = body.lat, body.lon
    place = "Posizione attuale"
    if lat is None or lon is None:
        candidates: List[str] = []
        if (body.address or "").strip():
            candidates.append(body.address.strip())
        try:
            us = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0, "home_address": 1})
            if us and (us.get("home_address") or "").strip():
                candidates.append(us["home_address"].strip())
        except Exception:
            pass
        try:
            ts = await db.settings.find_one({"user_id": tenant_id(user)}, {"_id": 0, "office_address": 1})
            if ts and (ts.get("office_address") or "").strip():
                candidates.append(ts["office_address"].strip())
        except Exception:
            pass
        for addr in candidates:
            coords = await _geocode_one(addr)
            if coords:
                lat, lon, place = coords["lat"], coords["lon"], addr
                break
        if lat is None or lon is None:
            # V50.z151 — distingui "nessun indirizzo" da "indirizzo non risolvibile" (geocoding fallito)
            return {"alerts": [], "checked_at": utcnow(), "location": None, "weather": None, "place": None,
                    "needs_address": True, "address_error": (candidates[0] if candidates else None)}
    data = await _fetch_openmeteo_daily(lat, lon, d_today)
    alerts: List[Dict[str, Any]] = []
    if not data:
        return {"alerts": alerts, "checked_at": utcnow(), "location": {"lat": lat, "lon": lon}, "weather": None, "place": place}
    code = int(data.get("weather_code") or 0)
    precip = float(data.get("precipitation_mm") or 0)
    wind = float(data.get("wind_kmh") or 0)
    tmax = float(data.get("temp_max") or 0)
    tmin = float(data.get("temp_min") or 0)

    # Regole soglie (soft — aggregate stile Protezione Civile)
    if code in {95, 96, 99}:
        alerts.append({"id": f"thunder_{d_today}", "severity": "orange", "icon": "thunderstorm", "title": "Temporali forti", "detail": data.get("label")})
    if precip >= 40:
        alerts.append({"id": f"rain_{d_today}", "severity": "red" if precip >= 80 else "orange", "icon": "rainy", "title": f"Piogge intense ({precip:.0f} mm)", "detail": "Rischio allagamenti locali"})
    if wind >= 60:
        alerts.append({"id": f"wind_{d_today}", "severity": "red" if wind >= 90 else "orange", "icon": "flash", "title": f"Vento forte ({wind:.0f} km/h)", "detail": "Prestare attenzione"})
    if tmax >= 38:
        alerts.append({"id": f"heat_{d_today}", "severity": "red" if tmax >= 40 else "orange", "icon": "sunny", "title": f"Ondata di calore ({tmax:.0f}°C)", "detail": "Idratarsi ed evitare esposizione diretta"})
    if tmin <= -5:
        alerts.append({"id": f"cold_{d_today}", "severity": "red" if tmin <= -10 else "orange", "icon": "snow", "title": f"Freddo intenso ({tmin:.0f}°C)", "detail": "Rischio gelate"})
    if code in {75, 86}:
        alerts.append({"id": f"snow_{d_today}", "severity": "orange", "icon": "snow", "title": "Nevicate intense", "detail": data.get("label")})

    return {"alerts": alerts, "checked_at": utcnow(), "location": {"lat": lat, "lon": lon}, "weather": data, "place": place}


@api_router.post("/weather/forecast")
async def weather_forecast(body: WeatherAlertsIn, user=Depends(get_current_user)):
    """V50.z116 — Previsioni 7 giorni (Open-Meteo) per la pagina Meteo dell'app.
    Stessa risoluzione posizione di /weather/alerts (GPS → home_address → office_address)."""
    lat, lon = body.lat, body.lon
    place = "Posizione attuale"
    if lat is None or lon is None:
        candidates: List[str] = []
        if (body.address or "").strip():
            candidates.append(body.address.strip())
        us = await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0, "home_address": 1})
        if us and (us.get("home_address") or "").strip():
            candidates.append(us["home_address"].strip())
        ts = await db.settings.find_one({"user_id": tenant_id(user)}, {"_id": 0, "office_address": 1})
        if ts and (ts.get("office_address") or "").strip():
            candidates.append(ts["office_address"].strip())
        for addr in candidates:
            coords = await _geocode_one(addr)
            if coords:
                lat, lon, place = coords["lat"], coords["lon"], addr
                break
        if lat is None or lon is None:
            # V50.z151 — se un indirizzo c'era ma il geocoding è fallito, segnalalo al client
            return {"days": [], "place": None, "needs_address": True,
                    "address_error": (candidates[0] if candidates else None)}
    # V50.z337 — Cache 30 min per località (weather_forecast_cache): niente chiamate a Open-Meteo se il dato è fresco;
    # retry con backoff 5 s su HTTP 429; se la chiamata fallisce ma esiste un dato scaduto → lo restituiamo con stale=true.
    fc_key = f"{round(lat, 2)},{round(lon, 2)}"
    try:
        fc_cached = await db.weather_forecast_cache.find_one({"key": fc_key}, {"_id": 0})
    except Exception:
        fc_cached = None
    fc_stale: Optional[Dict[str, Any]] = None
    if fc_cached and isinstance(fc_cached.get("cached_at"), datetime) and isinstance(fc_cached.get("data"), dict):
        ca = fc_cached["cached_at"]
        if ca.tzinfo is None:
            ca = ca.replace(tzinfo=timezone.utc)
        age = (utcnow() - ca).total_seconds()
        fc_stale = {**fc_cached["data"], "place": place, "cached_at": ca.isoformat()}
        if age < 30 * 60:
            return {**fc_stale, "cached": True}
    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=10.0) as client:
            r = await _openmeteo_get(client, {
                "latitude": lat, "longitude": lon,
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max",
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                "forecast_days": 7, "timezone": "auto",
            }, "forecast")
            if r.status_code != 200:
                if fc_stale:
                    return {**fc_stale, "stale": True}
                return {"days": [], "place": place, "error": f"Open-Meteo HTTP {r.status_code}"}
            j = r.json()
    except Exception as e:
        logger.warning("weather forecast failed: %s", e)
        if fc_stale:
            return {**fc_stale, "stale": True}
        return {"days": [], "place": place, "error": "Servizio meteo non raggiungibile"}
    d = j.get("daily") or {}
    days = []
    for i, t in enumerate(d.get("time") or []):
        code = int((d.get("weather_code") or [0])[i] or 0)
        meta = _WEATHER_CODE_ICON.get(code, {"key": "cloudy", "label": "Meteo"})
        days.append({
            "date": t, "weather_code": code, "icon_key": meta["key"], "label": meta["label"],
            "temp_min": (d.get("temperature_2m_min") or [None])[i],
            "temp_max": (d.get("temperature_2m_max") or [None])[i],
            "precipitation_mm": (d.get("precipitation_sum") or [None])[i],
            "precipitation_prob": (d.get("precipitation_probability_max") or [None])[i],
            "wind_kmh": (d.get("wind_speed_10m_max") or [None])[i],
            "uv_index": (d.get("uv_index_max") or [None])[i],
            "sunrise": (d.get("sunrise") or [None])[i],
            "sunset": (d.get("sunset") or [None])[i],
        })
    cur = j.get("current") or {}
    ccode = int(cur.get("weather_code") or 0)
    cmeta = _WEATHER_CODE_ICON.get(ccode, {"key": "cloudy", "label": "Meteo"})
    current = {
        "temp": cur.get("temperature_2m"), "feels_like": cur.get("apparent_temperature"),
        "humidity": cur.get("relative_humidity_2m"), "wind_kmh": cur.get("wind_speed_10m"),
        "icon_key": cmeta["key"], "label": cmeta["label"],
    } if cur else None
    out = {"days": days, "current": current, "location": {"lat": lat, "lon": lon}}
    try:
        await db.weather_forecast_cache.update_one({"key": fc_key}, {"$set": {"key": fc_key, "data": out, "cached_at": utcnow()}}, upsert=True)
    except Exception:
        pass
    return {**out, "place": place}



class WeatherByAddressIn(BaseModel):
    items: List[Dict[str, Any]]  # [{address: str, date: "YYYY-MM-DD"}]


@api_router.post("/weather/forecast-by-address")
async def weather_forecast_by_address(body: WeatherByAddressIn, user=Depends(get_current_user)):
    """Accetta indirizzi liberi + data. Fa geocoding (cached) e poi meteo."""
    out = []
    tid = tenant_id(user)
    for it in body.items[:100]:
        addr = (it.get("address") or "").strip()
        date_iso = (it.get("date") or None)
        place = addr or None
        # V50.z117 — Risoluzione lato server del luogo dell'appuntamento:
        # location → full_address/map_address → indirizzo migliore del contatto collegato.
        if not addr and it.get("appointment_id"):
            a = await db.appointments.find_one(
                {"appointment_id": it["appointment_id"], "$or": [{"tenant_id": tid}, {"user_id": tid}, {"created_by": user["user_id"]}]},
                {"_id": 0, "location": 1, "full_address": 1, "map_address": 1, "address_city": 1, "contact_id": 1, "is_phone": 1},
            )
            if a:
                for k in ("location", "full_address", "map_address", "address_city"):
                    if (a.get(k) or "").strip():
                        addr = a[k].strip(); break
                if not addr and a.get("contact_id"):
                    c = await db.contacts.find_one({"contact_id": a["contact_id"]}, {"_id": 0})
                    if c:
                        addr = _best_addr_for_contact(c) or ""
                place = addr or None
        if not addr:
            out.append(None); continue
        coords = await _geocode_one(addr)
        if not coords:
            out.append(None); continue
        d = await _fetch_openmeteo_daily(coords["lat"], coords["lon"], date_iso)
        if d:
            d = {**d, "place": place}
        out.append(d)
    return {"results": out}


class ContactsDistancesBatchIn(BaseModel):
    origin: str
    contact_ids: Optional[List[str]] = None  # se None, tutti i contatti visibili al chiamante


def _best_addr_for_contact(c: Dict[str, Any]) -> Optional[str]:
    """Seleziona l'indirizzo migliore da un contatto: preferred_address se settato,
    altrimenti il primo disponibile in ordine strutturato > legacy > work > residence."""
    pref = (c.get("preferred_address") or "").strip() or None
    structured = ", ".join([p for p in [
        (c.get("address_street") or "").strip(),
        " ".join([p for p in [(c.get("address_zip") or "").strip(), (c.get("address_city") or "").strip()] if p]).strip(),
        (c.get("address_province") or "").strip(),
    ] if p]).strip()
    legacy = (c.get("address") or "").strip()
    if legacy and legacy == structured:
        legacy = ""  # evita duplicato
    work = (c.get("work_address") or "").strip()
    residence = (c.get("residence_address") or "").strip()
    order_by_kind = {"main": structured, "legacy": legacy, "work": work, "residence": residence}
    if pref and order_by_kind.get(pref):
        return order_by_kind[pref]
    # fallback: primo non vuoto
    for k in ("main", "legacy", "work", "residence"):
        if order_by_kind.get(k):
            return order_by_kind[k]
    return None


@api_router.post("/contacts/distances-batch")
async def contacts_distances_batch(body: ContactsDistancesBatchIn, user=Depends(get_current_user)):
    """
    Ritorna distanze in km da `origin` all'indirizzo principale (preferred o primo disponibile)
    di ciascun contatto. Usa la stessa cache geocoding di /geocode/distances.
    Response: {"origin_valid": bool, "distances": {"<contact_id>": km|null, ...}}
    """
    origin_coords = await _geocode_one(body.origin)
    if not origin_coords:
        return {"origin_valid": False, "distances": {}}
    # Filtro sul tenant + eventuale lista contact_ids (rispetta assignment per collaboratori)
    q = await contact_visibility_filter(user)
    if body.contact_ids:
        q["contact_id"] = {"$in": body.contact_ids}
    cursor = db.contacts.find(
        q,
        {"_id": 0, "contact_id": 1, "preferred_address": 1, "address": 1, "address_street": 1,
         "address_zip": 1, "address_city": 1, "address_province": 1, "work_address": 1, "residence_address": 1},
    ).limit(500)
    contacts = await cursor.to_list(500)
    distances: Dict[str, Optional[float]] = {}
    for c in contacts:
        cid = c.get("contact_id")
        if not cid:
            continue
        addr = _best_addr_for_contact(c)
        if not addr:
            distances[cid] = None
            continue
        coords = await _geocode_one(addr)
        if not coords:
            distances[cid] = None
        else:
            km = _haversine_km(origin_coords["lat"], origin_coords["lon"], coords["lat"], coords["lon"])
            distances[cid] = round(km, 1)
    return {"origin_valid": True, "distances": distances}








@api_router.post("/contacts/import/preview")
async def contacts_import_preview(file: UploadFile = File(...), user=Depends(get_current_user)):
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "File troppo grande (max 5MB)")
    try:
        headers, rows = _parse_import_file(file.filename or "", content)
    except Exception as e:
        raise HTTPException(400, f"Errore lettura file: {str(e)[:200]}")
    if not headers or not rows:
        raise HTTPException(400, "File vuoto o senza intestazioni")
    standard_fields = sorted([
        "first_name", "last_name", "phone", "phone_alt", "whatsapp", "email", "email_alt",
        "address", "address_street", "address_number", "address_zip", "address_city",
        "address_province", "work_address", "residence_address", "birth_date",
        "fiscal_code", "vat_number", "website", "linkedin", "instagram", "facebook",
        "telegram", "energy_ref_name", "energy_ref_phone", "energy_ref_email",
        "general_note", "tags", "contact_code",
    ])
    # V50.z68 — Includi anche i campi personalizzati definiti dal Master (tenant)
    tid = tenant_id(user)
    cf_defs = await db.contact_custom_field_defs.find(
        {"user_id": tid}, {"_id": 0, "key": 1, "name": 1, "type": 1, "required": 1}
    ).sort("order", 1).to_list(200)
    custom_fields_defs = [{"key": d["key"], "name": d["name"], "type": d.get("type") or "text", "required": bool(d.get("required"))} for d in cf_defs]
    cf_by_name = {d["name"].strip().lower(): d for d in custom_fields_defs}

    def _map_col(h: str) -> Optional[str]:
        std = _fuzzy_map_column(h)
        if std:
            return std
        # Prova match diretto sui custom fields (case-insensitive nome/key)
        n = (h or "").strip().lower()
        if n in cf_by_name:
            return f"cf:{cf_by_name[n]['key']}"
        for d in custom_fields_defs:
            if n == d["key"].lower():
                return f"cf:{d['key']}"
        return None

    auto_mapping = {h: _map_col(h) for h in headers}
    unmapped = [h for h, v in auto_mapping.items() if not v]
    return {
        "headers": headers, "row_count": len(rows), "preview_rows": rows[:5],
        "auto_mapping": auto_mapping, "unmapped_columns": unmapped,
        "standard_fields": standard_fields,
        "custom_fields": custom_fields_defs,  # NEW
        "rows": rows,
    }


class ContactsImportExecuteIn(BaseModel):
    rows: List[Dict[str, str]]
    mapping: Dict[str, str]
    default_area: str = "energy"


@api_router.post("/contacts/import/execute")
async def contacts_import_execute(body: ContactsImportExecuteIn, user=Depends(get_current_user)):
    imported = 0
    errors: List[Dict[str, Any]] = []
    ignored_columns = [c for c, t in body.mapping.items() if t == "ignore"]
    custom_columns = [c for c, t in body.mapping.items() if t.startswith("custom:")]
    cf_columns = [c for c, t in body.mapping.items() if t.startswith("cf:")]
    # V50.z68 — Carica defs custom del tenant per casting per tipo + validazione required
    tid = tenant_id(user)
    cf_defs_list = await db.contact_custom_field_defs.find(
        {"user_id": tid}, {"_id": 0, "key": 1, "name": 1, "type": 1, "required": 1}
    ).to_list(200)
    cf_defs_by_key = {d["key"]: d for d in cf_defs_list}
    required_defs = [d for d in cf_defs_list if d.get("required")]

    def _cast_cf(val: str, ftype: str) -> Any:
        v = (val or "").strip()
        if v == "":
            return None
        if ftype == "number":
            try:
                return float(v.replace(",", "."))
            except Exception:
                return None
        if ftype == "checkbox":
            return v.lower() in {"1", "true", "yes", "si", "sì", "y", "vero"}
        return v  # text | date

    for idx, row in enumerate(body.rows):
        try:
            payload: Dict[str, Any] = {"area": body.default_area}
            custom_fields: Dict[str, Any] = {}
            for col, val in row.items():
                target = body.mapping.get(col, "ignore")
                if target == "ignore" or val is None or val == "":
                    continue
                if target.startswith("cf:"):
                    key = target[len("cf:"):].strip()
                    if key and key in cf_defs_by_key:
                        casted = _cast_cf(val, cf_defs_by_key[key].get("type") or "text")
                        if casted is not None:
                            custom_fields[key] = casted
                elif target.startswith("custom:"):
                    fname = target[len("custom:"):].strip()
                    if fname:
                        custom_fields[fname] = val
                elif target == "tags":
                    payload["tags"] = [t.strip() for t in re.split(r"[,;]", val) if t.strip()]
                else:
                    payload[target] = val
            has_min = payload.get("first_name") or payload.get("last_name") or payload.get("phone") or payload.get("email")
            if not has_min:
                errors.append({"row": idx + 2, "error": "Riga senza nome/telefono/email"})
                continue
            # V50.z68 — Validazione required su questa riga (fail-per-row, non abortire tutto)
            missing_req = [d["name"] for d in required_defs if _is_cf_value_empty(custom_fields.get(d["key"]))]
            if missing_req:
                errors.append({"row": idx + 2, "error": f"Campi obbligatori mancanti: {', '.join(missing_req)}"})
                continue
            if not payload.get("first_name"):
                payload["first_name"] = payload.get("last_name") or payload.get("email") or "Contatto"
            cid = f"c_{uuid.uuid4().hex[:12]}"
            doc = {
                "contact_id": cid, "user_id": tenant_id(user),
                "created_by": user["user_id"],
                "assigned_to_user_id": user["user_id"],
                **payload, "custom_fields": custom_fields,
                "notes": [], "files": [],
                "imported_at": utcnow(), "created_at": utcnow(), "updated_at": utcnow(),
            }
            doc["contact_code"] = doc.get("contact_code") or await _next_contact_code(user, body.default_area)
            await db.contacts.insert_one(doc)
            imported += 1
        except Exception as e:
            errors.append({"row": idx + 2, "error": str(e)[:120]})
    return {
        "ok": True, "imported": imported, "ignored_columns": ignored_columns,
        "custom_columns": custom_columns + cf_columns, "errors": errors, "total_rows": len(body.rows),
    }



@api_router.post("/contacts")
async def create_contact(body: ContactIn, user=Depends(get_current_user)):
    check_area_allowed(user, body.area)
    cid = f"c_{uuid.uuid4().hex[:12]}"
    payload = body.model_dump()
    # V50.z68 — Validazione campi custom obbligatori
    await _validate_required_custom_fields(user, payload.get("custom_fields"))
    # Auto-assign contact_code if not provided
    if not payload.get("contact_code"):
        payload["contact_code"] = await _next_contact_code(user, body.area)
    # V24: auto-assign to creator if not explicitly assigned
    if not payload.get("assigned_to_user_id"):
        payload["assigned_to_user_id"] = user["user_id"]
    doc = {
        "contact_id": cid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **payload,
        "notes": [],
        "files": [],
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.contacts.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.get("/contacts/{contact_id}/referrals")
async def get_contact_referrals(contact_id: str, user=Depends(get_current_user)):
    """Returns contacts referred BY this contact (reverse lookup on referred_by_contact_id)."""
    # Ensure contact belongs to tenant
    parent = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not parent:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    referrals = await db.contacts.find(
        scope_query(user, {"referred_by_contact_id": contact_id}),
        {"_id": 0, "notes": 0, "files": 0, "business_card": 0},
    ).sort("created_at", -1).to_list(500)
    # And the "referred by" info for parent
    referred_by = None
    if parent.get("referred_by_contact_id"):
        referred_by = await db.contacts.find_one(
            scope_query(user, {"contact_id": parent["referred_by_contact_id"]}),
            {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "contact_code": 1, "area": 1},
        )
    return {"referred_by": referred_by, "referrals": referrals}


# =========================================================================
# V28.q — References (bidirectional peer links)
# Contact A e B si "referenziano" a vicenda: aggiungere B come referenza di A
# aggiunge automaticamente A come referenza di B (e viceversa in rimozione).
# =========================================================================


@api_router.get("/contacts/{contact_id}/references")
async def get_contact_references(contact_id: str, user=Depends(get_current_user)):
    """Returns the list of contacts linked as peer references (bidirectional)."""
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    ref_ids = c.get("reference_contact_ids") or []
    if not ref_ids:
        return {"items": []}
    # Fetch summaries (avoid heavy fields)
    cursor = db.contacts.find(
        scope_query(user, {"contact_id": {"$in": list(ref_ids)}}),
        {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "avatar_base64": 1, "area": 1, "contact_code": 1, "status": 1},
    )
    items = [c async for c in cursor]
    # Preserve requested order
    id_index = {rid: i for i, rid in enumerate(ref_ids)}
    items.sort(key=lambda x: id_index.get(x.get("contact_id"), 9999))
    return {"items": items}


@api_router.post("/contacts/{contact_id}/references/{ref_id}")
async def add_contact_reference(contact_id: str, ref_id: str, user=Depends(get_current_user)):
    """Link ref_id as a peer reference of contact_id. Bidirectional (also updates ref_id)."""
    if contact_id == ref_id:
        raise HTTPException(status_code=400, detail="Non puoi collegare un contatto a se stesso")
    # Ensure both contacts belong to this tenant / visibility scope
    a = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0, "contact_id": 1, "reference_contact_ids": 1})
    b = await db.contacts.find_one(scope_query(user, {"contact_id": ref_id}), {"_id": 0, "contact_id": 1, "reference_contact_ids": 1})
    if not a or not b:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    now = utcnow()
    # Use $addToSet for idempotency + symmetry
    await db.contacts.update_one({"contact_id": contact_id}, {"$addToSet": {"reference_contact_ids": ref_id}, "$set": {"updated_at": now}})
    await db.contacts.update_one({"contact_id": ref_id}, {"$addToSet": {"reference_contact_ids": contact_id}, "$set": {"updated_at": now}})
    return {"ok": True}


@api_router.delete("/contacts/{contact_id}/references/{ref_id}")
async def remove_contact_reference(contact_id: str, ref_id: str, user=Depends(get_current_user)):
    """Unlink ref_id from contact_id references. Bidirectional."""
    a = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0, "contact_id": 1})
    b = await db.contacts.find_one(scope_query(user, {"contact_id": ref_id}), {"_id": 0, "contact_id": 1})
    if not a or not b:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    now = utcnow()
    await db.contacts.update_one({"contact_id": contact_id}, {"$pull": {"reference_contact_ids": ref_id}, "$set": {"updated_at": now}})
    await db.contacts.update_one({"contact_id": ref_id}, {"$pull": {"reference_contact_ids": contact_id}, "$set": {"updated_at": now}})
    return {"ok": True}


@api_router.get("/contacts/{contact_id}")
async def get_contact(contact_id: str, user=Depends(get_current_user)):
    c = await db.contacts.find_one(tenant_scope(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    # V24: enforce role-based visibility
    role = user.get("role") or "member"
    if not is_owner(user):
        assignee = c.get("assigned_to_user_id")
        if role == "admin":
            allowed = [user["user_id"]] + await descendant_user_ids(user["user_id"])
            if assignee and assignee not in allowed:
                raise HTTPException(status_code=404, detail="Contatto non trovato")
        else:  # member
            if assignee != user["user_id"]:
                raise HTTPException(status_code=404, detail="Contatto non trovato")
    return c


@api_router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, body: ContactUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "area" in upd:
        check_area_allowed(user, upd["area"])
    # V28.z — Solo il Master può modificare `contact_code` (codice cliente)
    if "contact_code" in upd and not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può modificare il codice cliente")
    if "contact_code" in upd:
        upd["contact_code"] = (upd["contact_code"] or "").strip() or None
    # V50.z68 — Se sto aggiornando custom_fields, valida i required
    if "custom_fields" in upd:
        # Merge with existing to validate the final state (evita che update parziale rompa required già valorizzati)
        existing = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0, "custom_fields": 1})
        current_cf = (existing or {}).get("custom_fields") or {}
        merged_cf = {**current_cf, **(upd["custom_fields"] or {})}
        await _validate_required_custom_fields(user, merged_cf)
    upd["updated_at"] = utcnow()
    r = await db.contacts.update_one(scope_query(user, {"contact_id": contact_id}), {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
    return c


@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, user=Depends(get_current_user)):
    await db.contacts.delete_one(scope_query(user, {"contact_id": contact_id}))
    return {"ok": True}


@api_router.post("/contacts/{contact_id}/notes")
async def add_note(contact_id: str, body: ContactNote, background: BackgroundTasks, user=Depends(get_current_user)):
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    note = body.model_dump()
    await db.contacts.update_one({"contact_id": contact_id}, {"$push": {"notes": note}})
    # V29.g — Trigger analisi Axon (fire-and-forget) sulla nota testuale
    note_txt = (note.get("text") or "").strip()
    if note_txt and note.get("kind") in (None, "text"):
        _schedule_axon_analysis(
            background=background,
            user=user,
            contact_id=contact_id,
            interaction_type="note",
            interaction_ref_id=note.get("id"),
            interaction_summary=note_txt,
        )
    return note


@api_router.delete("/contacts/{contact_id}/notes/{note_id}")
async def delete_note(contact_id: str, note_id: str, user=Depends(get_current_user)):
    await db.contacts.update_one(
        scope_query(user, {"contact_id": contact_id}),
        {"$pull": {"notes": {"id": note_id}}},
    )
    return {"ok": True}


@api_router.post("/contacts/{contact_id}/files")
async def add_file(contact_id: str, body: ContactFile, user=Depends(get_current_user)):
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    f = body.model_dump()
    # V50.z345 — compressione automatica PDF (testo/OCR intatti) → scheda cliente più leggera
    if f.get("data_base64"):
        f["data_base64"], _ci = await pdf_auto_compress_b64(f["data_base64"], f.get("mime") or "", f.get("name") or "", "contact-file")
        if _ci.get("compressed"):
            f["size"] = _ci["after"]; f["compressed_from"] = _ci["before"]
    await db.contacts.update_one({"contact_id": contact_id}, {"$push": {"files": f}})
    f_light = {k: v for k, v in f.items() if k != "data_base64"}
    return f_light


@api_router.delete("/contacts/{contact_id}/files/{file_id}")
async def delete_file(contact_id: str, file_id: str, user=Depends(get_current_user)):
    await db.contacts.update_one(
        scope_query(user, {"contact_id": contact_id}),
        {"$pull": {"files": {"id": file_id}}},
    )
    return {"ok": True}


# ---- V38F: Shareable public link for contact files ----
class RenameFileIn(BaseModel):
    name: str

@api_router.patch("/contacts/{contact_id}/files/{file_id}")
async def rename_file(contact_id: str, file_id: str, body: RenameFileIn, user=Depends(get_current_user)):
    new_name = (body.name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Nome file non valido")
    r = await db.contacts.update_one(
        scope_query(user, {"contact_id": contact_id, "files.id": file_id}),
        {"$set": {"files.$.name": new_name}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="File non trovato")
    return {"ok": True, "name": new_name}


@api_router.post("/contacts/{contact_id}/files/{file_id}/share-link")
async def create_file_share_link(contact_id: str, file_id: str, request: Request, user=Depends(get_current_user)):
    """Create a signed URL to publicly serve the file for a limited time (24h).
    Any auth-related caller (owner/admin/member) with visibility to the contact can create the token."""
    c = await db.contacts.find_one(
        scope_query(user, {"contact_id": contact_id, "files.id": file_id}),
        {"contact_id": 1, "files.$": 1},
    )
    if not c or not c.get("files"):
        raise HTTPException(status_code=404, detail="File non trovato")
    f = c["files"][0]
    exp_dt = utcnow() + timedelta(hours=24)
    token = jwt.encode({
        "kind": "cfile",
        "contact_id": contact_id,
        "file_id": file_id,
        "user_id": user["user_id"],
        "exp": int(exp_dt.timestamp()),
    }, JWT_SECRET, algorithm=JWT_ALG)
    # Build the absolute URL using forwarded proxy headers when available
    # (behind Kubernetes ingress request.base_url points at the internal cluster host).
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_proto and fwd_host:
        base = f"{fwd_proto}://{fwd_host}"
    else:
        base = str(request.base_url).rstrip("/")
    base = base.rstrip("/")
    url = f"{base}/api/public/files/{token}"
    return {"url": url, "expires_at": exp_dt.isoformat(), "name": f.get("name"), "mime": f.get("mime")}


@api_router.get("/public/files/{token}")
async def public_file(token: str):
    """Public download endpoint for signed contact-file tokens. No auth required."""
    from fastapi.responses import Response as FastAPIResponse
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link scaduto")
    except Exception:
        raise HTTPException(status_code=400, detail="Link non valido")
    if payload.get("kind") != "cfile":
        raise HTTPException(status_code=400, detail="Token non compatibile")
    contact_id = payload.get("contact_id")
    file_id = payload.get("file_id")
    c = await db.contacts.find_one(
        {"contact_id": contact_id, "files.id": file_id},
        {"files.$": 1},
    )
    if not c or not c.get("files"):
        raise HTTPException(status_code=404, detail="File non trovato")
    f = c["files"][0]
    import base64 as _b64
    try:
        data = _b64.b64decode(f.get("data_base64") or "")
    except Exception:
        raise HTTPException(status_code=500, detail="File corrotto")
    mime = f.get("mime") or "application/octet-stream"
    name = f.get("name") or "download"
    return FastAPIResponse(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{name}"'},
    )


@api_router.post("/master-files/{file_id}/share-link")
async def create_master_file_share_link(file_id: str, request: Request, user=Depends(get_current_user)):
    """V38R — Create a signed URL for a master file (any category).
    Used by ShareSheet 'Copia link' channel."""
    f = await db.master_files.find_one({"user_id": tenant_id(user), "file_id": file_id})
    if not f:
        raise HTTPException(status_code=404, detail="File non trovato")
    exp_dt = utcnow() + timedelta(hours=24)
    token = jwt.encode({
        "kind": "mfile",
        "file_id": file_id,
        "user_id": tenant_id(user),
        "exp": int(exp_dt.timestamp()),
    }, JWT_SECRET, algorithm=JWT_ALG)
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_proto and fwd_host:
        base = f"{fwd_proto}://{fwd_host}"
    else:
        base = str(request.base_url).rstrip("/")
    base = base.rstrip("/")
    url = f"{base}/api/public/master-files/{token}"
    return {"url": url, "expires_at": exp_dt.isoformat(), "name": f.get("name"), "mime": f.get("mime")}


@api_router.get("/public/master-files/{token}")
async def public_master_file(token: str):
    """V38R — Public download endpoint for signed master-file tokens."""
    from fastapi.responses import Response as FastAPIResponse
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link scaduto")
    except Exception:
        raise HTTPException(status_code=400, detail="Link non valido")
    if payload.get("kind") != "mfile":
        raise HTTPException(status_code=400, detail="Token non compatibile")
    file_id = payload.get("file_id")
    user_id = payload.get("user_id")
    f = await db.master_files.find_one({"user_id": user_id, "file_id": file_id})
    if not f:
        raise HTTPException(status_code=404, detail="File non trovato")
    import base64 as _b64
    try:
        data = _b64.b64decode(f.get("data_base64") or "")
    except Exception:
        raise HTTPException(status_code=500, detail="File corrotto")
    mime = f.get("mime") or "application/octet-stream"
    name = f.get("name") or "download"
    return FastAPIResponse(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{name}"'},
    )



# V38I — Email a contact file as attachment via SMTP
class EmailAttachmentIn(BaseModel):
    to_email: EmailStr
    subject: Optional[str] = None
    message: Optional[str] = None
    sender_email: Optional[str] = None  # override sender (if user has additional_emails)


@api_router.post("/contacts/{contact_id}/files/{file_id}/email-attachment")
async def email_file_attachment(contact_id: str, file_id: str, body: EmailAttachmentIn, user=Depends(get_current_user)):
    """Send the contact file to `to_email` as a real SMTP attachment.
    Uses the caller's SMTP config (must be configured in Settings)."""
    c = await db.contacts.find_one(
        scope_query(user, {"contact_id": contact_id, "files.id": file_id}),
        {"first_name": 1, "last_name": 1, "files.$": 1},
    )
    if not c or not c.get("files"):
        raise HTTPException(status_code=404, detail="File non trovato")
    f = c["files"][0]
    cfg = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not cfg or not cfg.get("host"):
        raise HTTPException(status_code=400, detail="SMTP non configurato. Vai in Impostazioni → SMTP.")
    # If a sender override is supplied and it belongs to the user's allowed emails, honor it
    if body.sender_email:
        u = await db.users.find_one({"user_id": tenant_id(user)}, {"email": 1, "additional_emails": 1})
        allowed = {(u or {}).get("email")} | set((u or {}).get("additional_emails") or [])
        if body.sender_email in allowed:
            cfg = dict(cfg)
            cfg["sender_email"] = body.sender_email
    import base64 as _b64
    try:
        attachment_bytes = _b64.b64decode(f.get("data_base64") or "")
    except Exception:
        raise HTTPException(status_code=500, detail="File corrotto")
    subject = body.subject or f"File condiviso: {f.get('name')}"
    text = body.message or f"Ti condivido in allegato il file: {f.get('name')}."
    try:
        await asyncio.to_thread(
            _send_smtp_email_with_attachment,
            cfg, body.to_email, subject, text, None,
            attachment_bytes, f.get("name") or "file", f.get("mime") or "application/octet-stream",
        )
    except Exception as e:
        logger.exception(f"email attachment failed: {e}")
        raise HTTPException(status_code=500, detail=f"Errore invio email: {str(e)[:200]}")
    return {"ok": True, "sent_to": body.to_email}


def _send_smtp_email_with_attachment(cfg: dict, to_email: str, subject: str, body_text: str, body_html: Optional[str],
                                      attachment_bytes: bytes, attachment_name: str, attachment_mime: str):
    """Blocking send via SMTP including a real binary attachment."""
    from email.mime.base import MIMEBase
    from email import encoders
    sender_email = cfg.get("sender_email") or cfg.get("username")
    sender_name = cfg.get("sender_name") or sender_email
    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = formataddr((sender_name, sender_email))
    msg["To"] = to_email
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(body_text or "", "plain", "utf-8"))
    if body_html:
        alt.attach(MIMEText(body_html, "html", "utf-8"))
    msg.attach(alt)
    part = MIMEBase(*(attachment_mime.split("/", 1) if "/" in attachment_mime else ("application", "octet-stream")))
    part.set_payload(attachment_bytes)
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f'attachment; filename="{attachment_name}"')
    msg.attach(part)
    host = cfg["host"]
    port = int(cfg.get("port") or 465)
    use_ssl = bool(cfg.get("use_ssl", True))
    if use_ssl:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=45) as server:
            server.login(cfg["username"], cfg["password"])
            server.sendmail(sender_email, [to_email], msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=45) as server:
            server.ehlo()
            try:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            except Exception:
                pass
            server.login(cfg["username"], cfg["password"])
            server.sendmail(sender_email, [to_email], msg.as_string())


# =========================
