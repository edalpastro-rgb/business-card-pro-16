# axon_wizard_sphere.py — V50.z214 — BLOCCO 3 · Step 2 «Sfera» + Step 3 «Aree» del wizard Set Up and Go (modulo ISOLATO)
#
# Step 2: sfera OBBLIGATORIA — business | home | both («Entrambe» attiva entrambi i percorsi nello step 3).
# Step 3: catalogo aree per sfera (icona, descrizione, switch on/off). Le voci `future=True` (CarPlay/Android Auto, domotica,
#         assistenti vocali) sono «interesse futuro»: non implementate, se attivate finiscono in `future_interests` e generano un
#         avviso di setup dedicato in una fase successiva (`setup_alerts`, consumato dal frontend/Axon più avanti).
# Persistenza: nello stesso doc `axon_setup_state` (campi `sphere`, `areas`, `future_interests`, `setup_alerts`) → esce da GET /axon/setup/state.
# Nel prompt Axon: riga sintetica «SFERA/AREE ATTIVE» così Axon sa su cosa concentrarsi (senza ripetere le domande del wizard).

_WS_SPHERES = ("business", "home", "both")

# key, sphere, icon (Ionicons), title, desc, default_on, future
_WS_AREAS = [
    # ── Business
    ("crm",        "business", "people",          "Contatti & Agenda",        "Clienti, appuntamenti, ritelefonate e scadenze.",                 True,  False),
    ("bollette",   "business", "document-text",   "Analisi bollette",         "Luce, gas e telco: lettura AI e confronto con le tue offerte.",   True,  False),
    ("pun",        "business", "trending-up",     "Mercato energia · PUN",    "Prezzi PUN per fascia, tabelle mensili e report pronti.",         True,  False),
    ("mail_crm",   "business", "mail",            "Mail & Auto-CRM",          "Caselle collegate: Axon propone contatti e appuntamenti.",        False, False),
    ("documenti",  "business", "cloud",           "Documenti & Drive",        "Google Drive, Knowledge Base e scanner documenti.",               True,  False),
    ("team",       "business", "git-network",     "Team & collaboratori",     "Inviti, statistiche e Corporate Gym per la squadra.",             False, False),
    ("spese_biz",  "business", "receipt",         "Note spese aziendali",     "Scontrini fotografati → nota spese PDF.",                         False, False),
    # ── Home
    ("my_thing",   "home",     "heart",            "My Thing",                 "Messaggi, immagini, eventi e anniversari personali.",             True,  False),
    ("ricordi",    "home",     "images",           "Foto, audio e ricordi",    "Note vocali, foto e video privati, trascritti e ricercabili.",    True,  False),
    ("spese_home", "home",     "wallet",           "Spese personali",          "Scontrini con categorie: spesa, casa, svago, salute.",            False, False),
    ("meteo",      "home",     "partly-sunny",     "Meteo & allerte",          "Previsioni e avvisi per la tua zona.",                            True,  False),
    ("sveglie",    "home",     "alarm",            "Timer & Sveglie",          "Promemoria, timer e sveglie a voce con Axon.",                    True,  False),
    ("my_web",     "home",     "globe",            "My Web",                   "I tuoi link preferiti, a portata di tap.",                        False, False),
    # ── Interessi futuri (non implementati → avviso di setup dedicato)
    ("carplay",    "both",     "car-sport",        "Axon in auto · CarPlay / Android Auto", "Interesse futuro: ti avviso quando sarà pronto.",    False, True),
    ("domotica",   "both",     "home",             "Domotica avanzata",        "Interesse futuro: scenari casa e dispositivi smart.",             False, True),
    ("assistenti", "both",     "mic-circle",       "Assistenti vocali (Alexa / Google Home)", "Interesse futuro: Axon anche sugli speaker di casa.", False, True),
]
_WS_AREA_KEYS = {a[0] for a in _WS_AREAS}
_WS_AREA_TITLE = {a[0]: a[3] for a in _WS_AREAS}
_WS_FUTURE_KEYS = {a[0] for a in _WS_AREAS if a[6]}


def _ws_catalog(sphere: Optional[str]) -> list:
    out = []
    for key, sph, icon, title, desc, default_on, future in _WS_AREAS:
        if sphere in ("business", "home") and sph not in (sphere, "both"):
            continue
        out.append({"key": key, "sphere": sph, "icon": icon, "title": title, "desc": desc, "default_on": default_on, "future": future})
    return out


class WsSphereAreasIn(BaseModel):
    sphere: Optional[str] = None
    areas: Optional[Dict[str, bool]] = None


@api_router.get("/axon/setup/areas")
async def ws_areas(sphere: Optional[str] = None, user=Depends(get_current_user)):
    if sphere is not None and sphere not in _WS_SPHERES:
        raise HTTPException(status_code=400, detail="sphere non valida")
    return {"sphere": sphere, "areas": _ws_catalog(sphere)}


@api_router.put("/axon/setup/sphere-areas")
async def ws_save(body: WsSphereAreasIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    cur = await _sw_get(uid)
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.sphere is not None:
        if body.sphere not in _WS_SPHERES:
            raise HTTPException(status_code=400, detail="sphere: business | home | both")
        upd["sphere"] = body.sphere
    if body.areas is not None:
        bad = [k for k in body.areas if k not in _WS_AREA_KEYS]
        if bad:
            raise HTTPException(status_code=400, detail=f"aree sconosciute: {', '.join(bad)}")
        areas = {k: bool(v) for k, v in body.areas.items()}
        upd["areas"] = areas
        future = sorted(k for k, v in areas.items() if v and k in _WS_FUTURE_KEYS)
        upd["future_interests"] = future
        prev = {a.get("key") for a in (cur.get("setup_alerts") or [])}
        alerts = [a for a in (cur.get("setup_alerts") or []) if a.get("key") in future]
        for k in future:
            if k not in prev:
                alerts.append({"key": k, "title": _WS_AREA_TITLE[k], "kind": "future_interest", "created_at": utcnow(), "seen": False})
        upd["setup_alerts"] = alerts
    if body.sphere is None and body.areas is None:
        raise HTTPException(status_code=400, detail="nessun dato")
    await db.axon_setup_state.update_one({"user_id": uid}, {"$set": upd})
    return _sw_out(await _sw_get(uid))


# ============================================================================ Axon: sfera e aree attive nel prompt
_ws_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _ws_prev_prepare_prompt(user, body)
    try:
        if not prep.get("system_message"):
            return prep
        st = await db.axon_setup_state.find_one({"user_id": user["user_id"]}, {"_id": 0, "sphere": 1, "areas": 1, "future_interests": 1})
        if not st or not st.get("sphere"):
            return prep
        sph = {"business": "Business", "home": "Home", "both": "Business + Home"}[st["sphere"]]
        on = [_WS_AREA_TITLE[k] for k, v in (st.get("areas") or {}).items() if v and k in _WS_AREA_TITLE and k not in _WS_FUTURE_KEYS]
        fut = [_WS_AREA_TITLE[k] for k in (st.get("future_interests") or []) if k in _WS_AREA_TITLE]
        line = f"\n\n🎯 SFERA SCELTA DALL'UTENTE (wizard): {sph}."
        if on:
            line += f" AREE ATTIVE: {', '.join(on)}."
        if fut:
            line += f" INTERESSI FUTURI (non ancora disponibili, non proporli come funzionanti): {', '.join(fut)}."
        line += " Non richiedere mai queste scelte: sono già salvate."
        prep["system_message"] += line
    except Exception as exc:  # noqa: BLE001
        logger.warning("[wizard-sphere] prompt failed: %s", exc)
    return prep


# ============================================================================ V50.z219 — Avviso «Interessi futuri» (chat + Impostazioni)
@api_router.get("/axon/setup/alerts")
async def ws_alerts(user=Depends(get_current_user)):
    st = await db.axon_setup_state.find_one({"user_id": user["user_id"]}, {"_id": 0, "setup_alerts": 1, "future_interests": 1}) or {}
    alerts = [{**a, "created_at": a["created_at"].isoformat() if isinstance(a.get("created_at"), datetime) else a.get("created_at")} for a in (st.get("setup_alerts") or [])]
    return {"alerts": alerts, "unseen": sum(1 for a in alerts if not a.get("seen")), "future_interests": st.get("future_interests") or []}


@api_router.post("/axon/setup/alerts/seen")
async def ws_alerts_seen(user=Depends(get_current_user)):
    """«Ok, ricevuto»: segna visti tutti gli avvisi di setup (restano elencati in Impostazioni/configurazione)."""
    st = await db.axon_setup_state.find_one({"user_id": user["user_id"]}, {"_id": 0, "setup_alerts": 1}) or {}
    alerts = [{**a, "seen": True, "seen_at": a.get("seen_at") or utcnow()} for a in (st.get("setup_alerts") or [])]
    await db.axon_setup_state.update_one({"user_id": user["user_id"]}, {"$set": {"setup_alerts": alerts, "updated_at": utcnow()}})
    return {"ok": True, "count": len(alerts)}
