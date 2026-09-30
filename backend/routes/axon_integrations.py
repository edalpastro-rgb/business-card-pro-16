# axon_integrations.py — V50.z197 — BLOCCO 8 · Fase 1: Integrazioni con un click a DUE SFERE (modulo ISOLATO)
#
# Caricato DOPO 28_google_drive / 29_dropbox / 34_alarms_homeassistant / axon_proactive e PRIMA di 37. Nessuna modifica al core:
# riusa la configurazione OAuth Google già presente (_gd_client_config, _GD_REDIRECT_URI, _gd_fernet, google_oauth_states) e le
# connessioni esistenti Drive/Dropbox/Domotica (solo lettura stato + link alle schermate esistenti).
#
# Sfere: "business" 🔵 (CRM) e "home" 🟢 (personale). Ogni sfera ha la SUA connessione Google (OAuth distinto, account anche diverso):
# un tap «Concedi accesso» = Calendar + Contacts (+ Drive cartella app per Home). I dati sincronizzati sono REFERENZIATI in
# `axon_integration_refs` (id esterni + campi minimi per il contesto), mai duplicati in contacts/appointments.
# Calendar Business bidirezionale: lettura eventi Google → contesto Axon; scrittura appuntamenti CRM → eventi Google (mapping
# appointment_id → event_id in refs). AxonOS indica sempre la sfera (🔵/🟢) e non incrocia i dati senza richiesta esplicita.
#
# Collection: axon_integrations {user_id, sphere, provider:"google", refresh_token_enc, scopes, google_email, created_at, updated_at,
#             last_sync_at, drive_folder_id}, axon_integration_refs {user_id, sphere, provider, kind event|contact, external_id, …, synced_at}.

_AXI_SPHERES = ("business", "home")
_AXI_SCOPES = {
    "business": ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/contacts.readonly", "openid", "https://www.googleapis.com/auth/userinfo.email"],
    "home": ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/contacts.readonly", "https://www.googleapis.com/auth/drive.file", "openid", "https://www.googleapis.com/auth/userinfo.email"],
}
_AXI_TOKEN_CACHE: Dict[str, Dict[str, Any]] = {}
_AXI_SPHERE_LABEL = {"business": "Business", "home": "Home"}
_AXI_SPHERE_ICON = {"business": "🔵", "home": "🟢"}

_OMNI_EXTRA_SECTIONS.append((
    "Integrazioni AxonOS (due sfere)", "/axon-integrations",
    "Impostazioni → Integrazioni AxonOS: sfera 🔵 Business (Google Calendar bidirezionale, Google Contacts, Google Drive, Dropbox) e sfera 🟢 Home "
    "(Domotica, Google Calendar personale, Google Contacts personale, Drive/Dropbox personale). Un tap «Concedi accesso», un tap «Revoca». I dati "
    "sono referenziati, mai duplicati; le due sfere non si mescolano.",
))


class AxiStartIn(BaseModel):
    sphere: str = "business"
    return_url: Optional[str] = None
    android_package: Optional[str] = None
    platform: Optional[str] = None


class AxiExchangeIn(BaseModel):
    code: str
    state: str


class AxiMobileExchangeIn(BaseModel):
    code: str
    code_verifier: str
    redirect_uri: str
    sphere: str = "business"


def _axi_sphere(s: str) -> str:
    if s not in _AXI_SPHERES:
        raise HTTPException(status_code=400, detail="Sfera non valida (business | home)")
    return s


def _axi_out(d: Optional[dict]) -> Optional[dict]:
    if not d:
        return None
    d = dict(d); d.pop("_id", None); d.pop("refresh_token_enc", None)
    for k, v in list(d.items()):
        if isinstance(v, datetime):
            d[k] = (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat()
    return d


async def _axi_store_tokens(uid: str, sphere: str, tokens: dict) -> dict:
    import httpx  # type: ignore
    refresh = tokens.get("refresh_token")
    old = await db.axon_integrations.find_one({"user_id": uid, "sphere": sphere, "provider": "google"})
    if not refresh:
        if not old:
            raise HTTPException(status_code=400, detail="Nessun refresh_token ricevuto: revoca l'accesso in Google e riprova")
        refresh = _gd_fernet.decrypt(old["refresh_token_enc"].encode()).decode()
    email = None
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get("https://www.googleapis.com/oauth2/v2/userinfo", headers={"Authorization": f"Bearer {tokens.get('access_token')}"})
            if r.status_code == 200:
                email = r.json().get("email")
    except Exception:  # noqa: BLE001
        pass
    doc = {"user_id": uid, "sphere": sphere, "provider": "google", "refresh_token_enc": _gd_fernet.encrypt(refresh.encode()).decode(),
           "scopes": (tokens.get("scope") or "").split() or _AXI_SCOPES[sphere], "google_email": email, "updated_at": utcnow()}
    await db.axon_integrations.update_one({"user_id": uid, "sphere": sphere, "provider": "google"}, {"$set": doc, "$setOnInsert": {"created_at": utcnow()}}, upsert=True)
    _AXI_TOKEN_CACHE.pop(f"{uid}:{sphere}", None)
    asyncio.ensure_future(_axi_sync_user(uid, sphere))
    return {"ok": True, "sphere": sphere, "google_email": email}


async def _axi_access_token(uid: str, sphere: str) -> Optional[str]:
    import httpx  # type: ignore
    key = f"{uid}:{sphere}"; c = _AXI_TOKEN_CACHE.get(key)
    if c and c["expiry"] > utcnow() + timedelta(seconds=60):
        return c["token"]
    row = await db.axon_integrations.find_one({"user_id": uid, "sphere": sphere, "provider": "google"})
    if not row:
        return None
    cfg = _gd_client_config()["web"]
    form = {"client_id": cfg["client_id"], "client_secret": cfg["client_secret"], "grant_type": "refresh_token",
            "refresh_token": _gd_fernet.decrypt(row["refresh_token_enc"].encode()).decode()}
    async with httpx.AsyncClient(timeout=20) as cl:
        r = await cl.post("https://oauth2.googleapis.com/token", data=form)
    if r.status_code != 200:
        logger.warning("[axi] refresh failed %s/%s: %s", uid, sphere, r.text[:120])
        await db.axon_integrations.update_one({"_id": row["_id"]}, {"$set": {"last_error": r.text[:200], "last_error_at": utcnow()}})
        return None
    j = r.json()
    _AXI_TOKEN_CACHE[key] = {"token": j["access_token"], "expiry": utcnow() + timedelta(seconds=int(j.get("expires_in") or 3600))}
    return j["access_token"]


async def _axi_get(uid: str, sphere: str, url: str, params: dict = None) -> Optional[dict]:
    import httpx  # type: ignore
    tok = await _axi_access_token(uid, sphere)
    if not tok:
        return None
    async with httpx.AsyncClient(timeout=25) as cl:
        r = await cl.get(url, params=params or {}, headers={"Authorization": f"Bearer {tok}"})
    if r.status_code >= 300:
        logger.warning("[axi] GET %s → %s %s", url, r.status_code, r.text[:120])
        return None
    return r.json()


async def _axi_post(uid: str, sphere: str, url: str, body: dict, method: str = "POST") -> Optional[dict]:
    import httpx  # type: ignore
    tok = await _axi_access_token(uid, sphere)
    if not tok:
        return None
    async with httpx.AsyncClient(timeout=25) as cl:
        r = await cl.request(method, url, json=body, headers={"Authorization": f"Bearer {tok}"})
    if r.status_code >= 300:
        logger.warning("[axi] %s %s → %s %s", method, url, r.status_code, r.text[:120])
        return None
    return r.json() if r.text else {}


# ============================================================================ OAuth (un tap)
@api_router.post("/axon/integrations/google/start")
async def axi_google_start(body: AxiStartIn, user=Depends(get_current_user)):
    sphere = _axi_sphere(body.sphere)
    if not _gd_configured():
        raise HTTPException(status_code=503, detail="Google non configurato sul server")
    from google_auth_oauthlib.flow import Flow  # type: ignore
    nonce = _secrets.token_urlsafe(32)
    redirect = _sanitize_redirect_uri(_GD_REDIRECT_URI)
    flow = Flow.from_client_config(_gd_client_config(), scopes=_AXI_SCOPES[sphere], state=nonce, redirect_uri=redirect)
    url, _ = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent select_account")
    await db.google_oauth_states.insert_one({"_id": nonce, "user_id": user["user_id"], "purpose": "axi", "sphere": sphere,
                                             "code_verifier": getattr(flow, "code_verifier", None), "redirect_uri": redirect,
                                             "app_return": _oauth_app_return(OAuthStartIn(return_url=body.return_url, android_package=body.android_package, platform=body.platform)),
                                             "expires_at": utcnow(), "created_at": utcnow()})
    return {"authorization_url": url, "sphere": sphere}


@api_router.post("/axon/integrations/oauth/exchange")
async def axi_oauth_exchange(body: AxiExchangeIn):
    """Chiamato dalla pagina di callback PRIMA dello scambio Drive: se lo state non è nostro → {handled: false} (state intatto)."""
    s = await db.google_oauth_states.find_one({"_id": body.state, "purpose": "axi"})
    if not s:
        return {"handled": False}
    await db.google_oauth_states.delete_one({"_id": body.state})
    import httpx  # type: ignore
    cfg = _gd_client_config()["web"]
    form = {"client_id": cfg["client_id"], "client_secret": cfg["client_secret"], "code": body.code, "grant_type": "authorization_code", "redirect_uri": s.get("redirect_uri")}
    if s.get("code_verifier"):
        form["code_verifier"] = s["code_verifier"]
    async with httpx.AsyncClient(timeout=20) as cl:
        r = await cl.post("https://oauth2.googleapis.com/token", data=form)
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Google token exchange failed: {r.text[:200]}")
    out = await _axi_store_tokens(s["user_id"], s["sphere"], r.json())
    return {"handled": True, **out, "redirect": "/axon-integrations"}


@api_router.post("/axon/integrations/google/mobile-exchange")
async def axi_google_mobile_exchange(body: AxiMobileExchangeIn, user=Depends(get_current_user)):
    sphere = _axi_sphere(body.sphere)
    import httpx  # type: ignore
    cfg = _gd_client_config()["web"]
    form = {"client_id": cfg["client_id"], "client_secret": cfg["client_secret"], "code": body.code, "code_verifier": body.code_verifier,
            "grant_type": "authorization_code", "redirect_uri": body.redirect_uri}
    async with httpx.AsyncClient(timeout=20) as cl:
        r = await cl.post("https://oauth2.googleapis.com/token", data=form)
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Google token exchange failed: {r.text[:200]}")
    return await _axi_store_tokens(user["user_id"], sphere, r.json())


@api_router.delete("/axon/integrations/{sphere}/google")
async def axi_google_revoke(sphere: str, user=Depends(get_current_user)):
    """Revoca con un tap: token revocato presso Google + connessione e riferimenti cancellati."""
    sphere = _axi_sphere(sphere)
    row = await db.axon_integrations.find_one({"user_id": user["user_id"], "sphere": sphere, "provider": "google"})
    if row:
        try:
            import httpx  # type: ignore
            async with httpx.AsyncClient(timeout=10) as cl:
                await cl.post("https://oauth2.googleapis.com/revoke", params={"token": _gd_fernet.decrypt(row["refresh_token_enc"].encode()).decode()})
        except Exception:  # noqa: BLE001
            pass
        await db.axon_integrations.delete_one({"_id": row["_id"]})
    await db.axon_integration_refs.delete_many({"user_id": user["user_id"], "sphere": sphere, "provider": "google"})
    _AXI_TOKEN_CACHE.pop(f"{user['user_id']}:{sphere}", None)
    return {"ok": True, "revoked": bool(row)}


# ============================================================================ SYNC referenziata
async def _axi_sync_calendar(uid: str, sphere: str) -> int:
    now = utcnow()
    j = await _axi_get(uid, sphere, "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                       {"timeMin": (now - timedelta(days=1)).isoformat(), "timeMax": (now + timedelta(days=30)).isoformat(), "singleEvents": "true", "orderBy": "startTime", "maxResults": 100})
    if j is None:
        return 0
    seen = []
    for ev in j.get("items") or []:
        if ev.get("status") == "cancelled":
            continue
        st = (ev.get("start") or {}); en = (ev.get("end") or {})
        ref = {"user_id": uid, "sphere": sphere, "provider": "google", "kind": "event", "external_id": ev["id"], "summary": (ev.get("summary") or "(senza titolo)")[:140],
               "start": st.get("dateTime") or st.get("date"), "end": en.get("dateTime") or en.get("date"), "all_day": "date" in st, "location": (ev.get("location") or "")[:160],
               "from_crm": bool((ev.get("extendedProperties") or {}).get("private", {}).get("advisoros_appointment_id")),
               "appointment_id": (ev.get("extendedProperties") or {}).get("private", {}).get("advisoros_appointment_id"), "html_link": ev.get("htmlLink"), "synced_at": now}
        await db.axon_integration_refs.update_one({"user_id": uid, "sphere": sphere, "provider": "google", "kind": "event", "external_id": ev["id"]}, {"$set": ref}, upsert=True)
        seen.append(ev["id"])
    await db.axon_integration_refs.delete_many({"user_id": uid, "sphere": sphere, "provider": "google", "kind": "event", "external_id": {"$nin": seen}, "start": {"$gte": (now - timedelta(days=1)).isoformat()[:10]}})
    return len(seen)


async def _axi_sync_contacts(uid: str, sphere: str) -> int:
    j = await _axi_get(uid, sphere, "https://people.googleapis.com/v1/people/me/connections", {"personFields": "names,emailAddresses,phoneNumbers,organizations", "pageSize": 500, "sortOrder": "LAST_MODIFIED_DESCENDING"})
    if j is None:
        return 0
    n = 0; now = utcnow()
    for p in j.get("connections") or []:
        name = ((p.get("names") or [{}])[0].get("displayName") or "").strip()
        emails = [e.get("value") for e in p.get("emailAddresses") or [] if e.get("value")]
        phones = [x.get("value") for x in p.get("phoneNumbers") or [] if x.get("value")]
        if not name and not emails and not phones:
            continue
        crm_id = None
        if sphere == "business":
            tid_user = await db.users.find_one({"user_id": uid}, {"_id": 0, "parent_user_id": 1})
            tid = (tid_user or {}).get("parent_user_id") or uid
            ors = ([{"email": {"$in": emails}}] if emails else []) + ([{"phone": {"$in": phones}}] if phones else [])
            if ors:
                m = await db.contacts.find_one({"user_id": tid, "$or": ors}, {"_id": 0, "contact_id": 1})
                crm_id = (m or {}).get("contact_id")
        ref = {"user_id": uid, "sphere": sphere, "provider": "google", "kind": "contact", "external_id": p.get("resourceName"), "name": name[:120] or (emails[0] if emails else phones[0]),
               "emails": emails[:3], "phones": phones[:3], "org": ((p.get("organizations") or [{}])[0].get("name") or "")[:120], "crm_contact_id": crm_id, "synced_at": now}
        await db.axon_integration_refs.update_one({"user_id": uid, "sphere": sphere, "provider": "google", "kind": "contact", "external_id": p.get("resourceName")}, {"$set": ref}, upsert=True)
        n += 1
    return n


async def _axi_push_appointments(uid: str) -> int:
    """Business: appuntamenti CRM futuri (propri) → eventi Google Calendar (mapping in refs, nessuna copia nel CRM)."""
    user = await db.users.find_one({"user_id": uid}, {"_id": 0}) or {"user_id": uid, "role": "owner"}
    now = utcnow(); n = 0
    linked = {r["appointment_id"] async for r in db.axon_integration_refs.find({"user_id": uid, "sphere": "business", "kind": "event", "appointment_id": {"$ne": None}}, {"_id": 0, "appointment_id": 1})}
    q = _omni_own(user, {"start_at": {"$gte": now, "$lte": now + timedelta(days=30)}})
    async for a in db.appointments.find(q, {"_id": 0}).limit(100):
        if a.get("appointment_id") in linked or a.get("done"):
            continue
        st = _axn_aware(a.get("start_at")); en = _axn_aware(a.get("end_at")) or st + timedelta(minutes=int(a.get("duration_min") or 60))
        who = ""
        if a.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": a["contact_id"]}, {"first_name": 1, "last_name": 1})
            who = _omni_name(c) if c else ""
        body = {"summary": (a.get("title") or "Appuntamento") + (f" — {who}" if who else ""), "location": a.get("full_address") or a.get("location") or "",
                "description": (a.get("notes") or "")[:1000] + "\n\n[AdvisorOS · sfera Business]", "start": {"dateTime": st.isoformat()}, "end": {"dateTime": en.isoformat()},
                "extendedProperties": {"private": {"advisoros_appointment_id": a["appointment_id"]}}}
        ev = await _axi_post(uid, "business", "https://www.googleapis.com/calendar/v3/calendars/primary/events", body)
        if ev and ev.get("id"):
            await db.axon_integration_refs.update_one({"user_id": uid, "sphere": "business", "provider": "google", "kind": "event", "external_id": ev["id"]},
                                                      {"$set": {"user_id": uid, "sphere": "business", "provider": "google", "kind": "event", "external_id": ev["id"], "summary": body["summary"][:140],
                                                                "start": st.isoformat(), "end": en.isoformat(), "all_day": False, "from_crm": True, "appointment_id": a["appointment_id"], "html_link": ev.get("htmlLink"), "synced_at": utcnow()}}, upsert=True)
            n += 1
    return n


async def _axi_sync_user(uid: str, sphere: str) -> dict:
    out = {"events": 0, "contacts": 0, "pushed": 0}
    try:
        out["events"] = await _axi_sync_calendar(uid, sphere)
        out["contacts"] = await _axi_sync_contacts(uid, sphere)
        if sphere == "business":
            out["pushed"] = await _axi_push_appointments(uid)
        await db.axon_integrations.update_one({"user_id": uid, "sphere": sphere, "provider": "google"}, {"$set": {"last_sync_at": utcnow(), "last_sync": out}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axi] sync %s/%s failed: %s", uid, sphere, exc)
    return out


async def _axi_tick():
    try:
        async for row in db.axon_integrations.find({"provider": "google"}, {"_id": 0, "user_id": 1, "sphere": 1}).limit(2000):
            await _axi_sync_user(row["user_id"], row["sphere"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axi] tick failed: %s", exc)


# ============================================================================ STATUS / DATI
@api_router.get("/axon/integrations/status")
async def axi_status(user=Depends(get_current_user)):
    uid = user["user_id"]; tid = tenant_id(user)
    g = {r["sphere"]: r async for r in db.axon_integrations.find({"user_id": uid, "provider": "google"}, {"_id": 0, "refresh_token_enc": 0})}
    counts: Dict[str, Dict[str, int]] = {s: {"event": 0, "contact": 0} for s in _AXI_SPHERES}
    async for row in db.axon_integration_refs.aggregate([{"$match": {"user_id": uid}}, {"$group": {"_id": {"s": "$sphere", "k": "$kind"}, "n": {"$sum": 1}}}]):
        counts.setdefault(row["_id"]["s"], {})[row["_id"]["k"]] = row["n"]
    drive = await db.google_drive_connections.find_one({"user_id": uid}, {"_id": 0, "google_email": 1, "updated_at": 1})
    dbx = await db.dropbox_connections.find_one({"user_id": uid}, {"_id": 0, "account_email": 1, "email": 1, "updated_at": 1})
    ha = await db.homeassistant_configs.find_one({"user_id": tid}, {"_id": 0, "base_url": 1, "updated_at": 1})

    def gcard(sphere: str, key: str, label: str, desc: str) -> dict:
        row = g.get(sphere)
        return {"key": key, "label": label, "desc": desc, "provider": "google", "connected": bool(row), "account": (row or {}).get("google_email"),
                "last_sync_at": _axi_out(row or {}).get("last_sync_at") if row else None, "one_tap": True, "sphere": sphere,
                "count": counts.get(sphere, {}).get("event" if "calendar" in key else "contact", 0), "configured": _gd_configured()}

    business = [
        gcard("business", "google_calendar", "Google Calendar", "Sincronizzazione bidirezionale: Axon legge gli eventi e scrive gli appuntamenti CRM."),
        gcard("business", "google_contacts", "Google Contacts", "Rubrica Google collegata ai contatti CRM (riferimenti, nessun duplicato)."),
        {"key": "google_drive", "label": "Google Drive", "desc": "Axon salva report, note spese e briefing nella cartella scelta.", "provider": "google_drive", "connected": bool(drive),
         "account": (drive or {}).get("google_email"), "one_tap": False, "manage_route": "/google-drive", "sphere": "business", "configured": _gd_configured()},
        {"key": "dropbox", "label": "Dropbox", "desc": "Cartella aziendale per report e documenti.", "provider": "dropbox", "connected": bool(dbx),
         "account": (dbx or {}).get("account_email") or (dbx or {}).get("email"), "one_tap": False, "manage_route": "/dropbox", "sphere": "business", "configured": True},
        {"key": "bank_statement", "label": "Estratto conto", "desc": "Allega PDF o foto: Axon analizza, categorizza e produce il report. Nessuna connessione alla banca.", "provider": "axon", "connected": True, "one_tap": False, "manage_route": "/axon-expenses?sphere=business", "sphere": "business", "configured": True},
        {"key": "receipts", "label": "Scontrini e nota spese", "desc": "Fotografa lo scontrino: importo, data, categoria nella nota spese del mese. PDF esportabile (Master anche per il team).", "provider": "axon", "connected": True, "one_tap": False, "manage_route": "/axon-expenses?sphere=business", "sphere": "business", "configured": True},
        {"key": "media_archive", "label": "Archivio foto, audio e video", "desc": "Cattura o allega: Axon trascrive audio/video, descrive le foto e rende tutto ricercabile. Chiede «Privata o aziendale?».", "provider": "axon", "connected": True, "one_tap": False, "manage_route": "/axon-media?sphere=business", "sphere": "business", "configured": True},
    ]
    home = [
        {"key": "personal_space", "label": "Spazio Personale", "desc": "My Thing, My Web, I miei audio (con trascrizione), foto/video e spese personali, memoria Home: tutto in un unico posto.", "provider": "axon", "connected": True, "one_tap": False, "manage_route": "/spazio-personale", "sphere": "home", "configured": True},  # V50.z205
        {"key": "homeassistant", "label": "Domotica", "desc": "Casa intelligente: luci, clima, scene con la voce di Axon.", "provider": "homeassistant", "connected": bool(ha),
         "account": (ha or {}).get("base_url"), "one_tap": False, "manage_route": "/axon-homeassistant", "sphere": "home", "configured": True},
        gcard("home", "google_calendar_home", "Google Calendar Home", "Calendario personale, separato da quello professionale (OAuth distinto)."),
        gcard("home", "google_contacts_home", "Google Contacts Home", "Rubrica personale, separata dai contatti CRM."),
        {"key": "google_drive_home", "label": "Drive Home", "desc": "Cartella personale «AxonOS Home» (creata dall'app), separata da quella aziendale.", "provider": "google",
         "connected": bool(g.get("home")) and "https://www.googleapis.com/auth/drive.file" in ((g.get("home") or {}).get("scopes") or []), "account": (g.get("home") or {}).get("google_email"),
         "one_tap": True, "shared_with": "google_calendar_home", "sphere": "home", "configured": _gd_configured()},
        {"key": "personal_expenses", "label": "Spese personali", "desc": "Scontrini con categorie personali: spesa, casa, svago, salute. Separate dalla nota spese Business.", "provider": "axon", "connected": True, "one_tap": False, "manage_route": "/axon-expenses?sphere=home", "sphere": "home", "configured": True},
        {"key": "media_archive_home", "label": "Foto, audio e video personali", "desc": "Ricordi, note vocali e video privati: trascritti e ricercabili, separati dall'archivio Business.", "provider": "axon", "connected": True, "one_tap": False, "manage_route": "/axon-media?sphere=home", "sphere": "home", "configured": True},
    ]
    return {"spheres": {"business": {"label": "Business", "color": "#2563EB", "icon": "🔵", "items": business}, "home": {"label": "Home", "color": "#059669", "icon": "🟢", "items": home}},
            "google_configured": _gd_configured()}


@api_router.post("/axon/integrations/{sphere}/sync")
async def axi_sync_now(sphere: str, user=Depends(get_current_user)):
    sphere = _axi_sphere(sphere)
    if not await db.axon_integrations.find_one({"user_id": user["user_id"], "sphere": sphere, "provider": "google"}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Google non collegato per questa sfera")
    return {"ok": True, "sphere": sphere, **(await _axi_sync_user(user["user_id"], sphere))}


@api_router.get("/axon/integrations/{sphere}/events")
async def axi_events(sphere: str, days: int = 14, user=Depends(get_current_user)):
    sphere = _axi_sphere(sphere); now = utcnow()
    items = [_axi_out(r) async for r in db.axon_integration_refs.find({"user_id": user["user_id"], "sphere": sphere, "kind": "event", "start": {"$gte": now.isoformat()[:10], "$lte": (now + timedelta(days=max(1, min(days, 60)))).isoformat()}}, {"_id": 0}).sort("start", 1).limit(100)]
    return {"sphere": sphere, "items": items}


@api_router.get("/axon/integrations/{sphere}/contacts")
async def axi_contacts(sphere: str, q: Optional[str] = None, limit: int = 50, user=Depends(get_current_user)):
    sphere = _axi_sphere(sphere)
    f: Dict[str, Any] = {"user_id": user["user_id"], "sphere": sphere, "kind": "contact"}
    if q:
        f["$or"] = [{"name": {"$regex": re.escape(q), "$options": "i"}}, {"emails": {"$regex": re.escape(q), "$options": "i"}}, {"phones": {"$regex": re.escape(q), "$options": "i"}}]
    items = [_axi_out(r) async for r in db.axon_integration_refs.find(f, {"_id": 0}).sort("name", 1).limit(max(1, min(limit, 500)))]
    return {"sphere": sphere, "items": items}


# ============================================================================ CONTESTO AXON — sfere separate, indicatore sempre visibile
async def _axi_context_section(uid: str) -> str:
    rows = {r["sphere"]: r async for r in db.axon_integrations.find({"user_id": uid, "provider": "google"}, {"_id": 0, "sphere": 1, "google_email": 1})}
    if not rows:
        return ""
    now = utcnow(); parts = ["🔵🟢 INTEGRAZIONI A DUE SFERE (regola: rispondi nella sfera di cui parla l'utente e indica SEMPRE la sfera con 🔵 Business o 🟢 Home; "
                            "NON incrociare mai dati Business e Home se l'utente non lo chiede esplicitamente):"]
    for sphere in _AXI_SPHERES:
        if sphere not in rows:
            continue
        evs = [r async for r in db.axon_integration_refs.find({"user_id": uid, "sphere": sphere, "kind": "event", "start": {"$gte": now.isoformat()[:10]}}, {"_id": 0, "summary": 1, "start": 1, "from_crm": 1, "location": 1}).sort("start", 1).limit(12)]
        nc = await db.axon_integration_refs.count_documents({"user_id": uid, "sphere": sphere, "kind": "contact"})
        line = f"{_AXI_SPHERE_ICON[sphere]} SFERA {_AXI_SPHERE_LABEL[sphere].upper()} (Google {rows[sphere].get('google_email') or ''}) — contatti Google collegati: {nc}. Prossimi eventi Google Calendar: "
        line += "; ".join(f"{(e.get('start') or '')[:16].replace('T', ' ')} {e.get('summary')}" + (" [da CRM]" if e.get("from_crm") else "") for e in evs) or "nessuno"
        parts.append(line)
    return "\n".join(parts)[:5000]


_axi_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _axi_prev_prepare_prompt(user, body)
    if isinstance(prep, dict) and prep.get("query_class") == "simple":
        return prep  # V50.z413 — domanda semplice (ora/meteo/saluti/domotica): nessuna sezione extra nel prompt
    try:
        sec = await _axi_context_section(user["user_id"])
        if sec and prep.get("system_message"):
            prep["system_message"] = f"{prep['system_message']}\n\n{sec}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axi] context failed: %s", exc)
    return prep


@app.on_event("startup")
async def _axi_start():
    try:
        await db.axon_integrations.create_index([("user_id", 1), ("sphere", 1), ("provider", 1)], unique=True)
        await db.axon_integration_refs.create_index([("user_id", 1), ("sphere", 1), ("kind", 1), ("external_id", 1)], unique=True)
        await db.axon_integration_refs.create_index([("user_id", 1), ("sphere", 1), ("kind", 1), ("start", 1)])
        _axn_scheduler.add_job(_axi_tick, "interval", minutes=30, id="axi-sync-tick", replace_existing=True)
        logger.info("[axi] integrations hub armed (google configured=%s)", _gd_configured())
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axi] start failed: %s", exc)
