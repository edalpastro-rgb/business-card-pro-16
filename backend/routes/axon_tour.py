# axon_tour.py — V50.z257 — Tour Guidato conversazionale (4 schermate) — modulo ISOLATO
#
# POST /tour/profile {text}     → Axon «elabora» la risposta («cosa fai e cosa ti fa perdere tempo») e sceglie 3-4 funzioni
#                                 del catalogo da «accendere» (JSON via Claude Haiku; fallback euristico). Salva user_settings.tour_profile.
# POST /tour/contact-from-text  → estrae i campi contatto da un testo dettato (riusa _llm_extract_contact di 12_ai_contact_copilot).
# GET  /tour/features           → elenco pulito di tutte le funzioni (solo nomi) per «Scopri tutte le funzioni».

_TOUR_FEATURES: List[Tuple[str, str, str]] = [  # (id, nome, gruppo)
    ("contacts", "Anagrafica clienti", "CRM"), ("map", "Mappa clienti", "CRM"), ("route", "Giro Ottimale", "CRM"), ("km", "Resoconto Km", "CRM"),
    ("visits", "Rilevamento visite (Mappa clienti)", "CRM"), ("calendar", "Calendario e appuntamenti", "CRM"), ("deadlines", "Scadenze contratti", "CRM"),
    ("referrals", "Referenze e passaparola (fonte contatto)", "CRM"), ("reviews", "Recensioni", "CRM"), ("call_log", "Registro chiamate (scheda contatto)", "CRM"),
    ("bills", "Analisi bollette", "Energia"), ("compare", "Confronto offerte (analisi bolletta)", "Energia"), ("pun", "PUN e mercato (widget Home)", "Energia"), ("offers", "Offerte aziendali (analisi bolletta)", "Energia"),
    ("scanner", "Scanner documenti", "Documenti"), ("files", "Master Files", "Documenti"), ("pdf", "Report PDF", "Documenti"), ("business_card", "Biglietto da visita digitale", "Documenti"),
    ("chat", "Chat con Axon (Axon Center)", "AxonOS"), ("voice", "Comandi vocali in auto (Axon Drive)", "AxonOS"), ("notes", "Note vocali", "AxonOS"), ("wake", "Wake word «Hey Axon»", "AxonOS"),
    ("learn", "Insegna ad Axon", "AxonOS"), ("proactive", "Promemoria proattivi", "AxonOS"), ("wizard", "Configurazione guidata", "AxonOS"),
    ("email", "Email e caselle IMAP", "Comunicazioni"), ("whatsapp", "WhatsApp e messaggi (scheda contatto)", "Comunicazioni"), ("birthday", "Auguri di compleanno (Calendario)", "Comunicazioni"),
    ("team", "Team e collaboratori", "Master"), ("kpi", "KPI e statistiche", "Master"), ("gym", "Corporate Gym", "Master"), ("import", "Import contatti", "Master"),
    ("security", "Sicurezza e 2FA", "Impostazioni"), ("custom", "Personalizzazione", "Impostazioni"), ("help", "Help Center", "Impostazioni"),
]
_TOUR_IDS = {f[0] for f in _TOUR_FEATURES}
# V50.z269 — ogni funzione dell'elenco «Tutte le funzioni» deve aprire la pagina corrispondente (mai voci senza link)
_TOUR_FEATURE_ROUTES: Dict[str, str] = {
    "contacts": "/contatti", "map": "/map-clients", "route": "/optimal-route", "km": "/km-report", "visits": "/map-clients",
    "calendar": "/calendario", "deadlines": "/deadlines", "referrals": "/contatti", "reviews": "/reviews-analytics", "call_log": "/contatti",
    "bills": "/bill-quick", "compare": "/bill-quick", "pun": "/home?section=widgets", "offers": "/bill-quick",
    "scanner": "/scanner", "files": "/master-files", "pdf": "/report", "business_card": "/business-card",
    "chat": "/axon-hub", "voice": "/voice-copilot", "notes": "/my-audios", "wake": "/wake-word", "learn": "/ai-teach", "proactive": "/axon-proactive", "wizard": "/setup",
    "email": "/email-accounts", "whatsapp": "/contatti", "birthday": "/calendario",
    "team": "/team", "kpi": "/team-insights", "gym": "/corporate-gym", "import": "/contacts-import",
    "security": "/security", "custom": "/impostazioni?section=branding", "help": "/help-center",
}
_TOUR_KEYWORDS = {
    "bills": ["bollett", "fattur", "energia", "luce", "gas"], "compare": ["confront", "offert", "risparm"], "route": ["giro", "visite", "strada", "km", "auto", "spostament"],
    "calendar": ["appuntament", "agenda", "calendar"], "deadlines": ["scadenz", "rinnov", "contratt"], "notes": ["nota", "appunt", "ricord"],
    "scanner": ["document", "scans", "carta", "pdf"], "email": ["email", "mail"], "whatsapp": ["whatsapp", "messagg"], "referrals": ["referenz", "passaparola", "segnalaz"],
    "contacts": ["client", "anagraf", "contatt", "rubrica"], "voice": ["voce", "vocal", "dett"], "team": ["collaborat", "team", "squadra", "network"], "kpi": ["numer", "statist", "obiettiv", "kpi"],
}


class TourProfileIn(BaseModel):
    text: Optional[str] = None
    answers: Optional[List[str]] = None  # 3 risposte: cosa fai/perdi tempo · funzione indispensabile · cosa ti aspetti


class TourTextIn(BaseModel):
    text: str


_TOUR_GROUP_MAP = {"CRM": "Contatti", "Energia": "Fatture e Scanner", "Documenti": "Fatture e Scanner", "AxonOS": "AxonOS", "Comunicazioni": "Caselle Mail", "Master": "Master", "Impostazioni": "Profilo"}
_TOUR_TECH_SUBSTR = ("callback", "picker", "landing", "webviewer", "/chat/new", "invita-pick", "setup-config", "info-request-chat", "settings-app", "my-thing", "my-web")
_TOUR_PRETTY = {"/axon-brain": "Cervello Axon (conoscenza)", "/axon-cheatsheet": "Cheat sheet fornitori", "/axon-homeassistant": "Home Assistant", "/axon-insights": "Autoapprendimento Axon", "/axon-media": "Archivio foto, audio e video", "/axon-proactive": "Axon proattivo", "/axon-scripts": "Playbook script di chiamata", "/axon-scripts-import": "Import script", "/axon-stress-report": "Stress Test Axon", "/axon-system": "Stato sistema Axon", "/bug-report": "Segnala bug", "/business-card-stats": "Statistiche biglietto digitale", "/call-script-config": "Configurazione script chiamate", "/corporate-gym/assign": "Corporate Gym · Assegna", "/corporate-gym/coach-panel": "Corporate Gym · Pannello coach", "/corporate-gym/manuals-config": "Corporate Gym · Manuali", "/corporate-gym/obiezioni": "Corporate Gym · Obiezioni", "/corporate-gym/roleplay": "Corporate Gym · Roleplay", "/corporate-gym/stats": "Corporate Gym · Statistiche", "/corporate-gym/win-win": "Corporate Gym · Win-Win", "/event-banners": "Banner eventi", "/help-center-admin": "Richieste cancellazione dati (gestione)", "/info-requests": "Richieste informazioni", "/invita": "Invita", "/invitati": "Invitati", "/libretto-editor": "Editor libretto", "/neo-memory": "Memoria Neo", "/permessi": "Permessi dispositivo", "/reviews-analytics": "Analisi recensioni", "/security": "Sicurezza avanzata", "/security-info": "Info sicurezza", "/wake-word": "Wake word «Hey Axon»"}
_TOUR_TECH_SCREENS = {"/", "/index", "/login", "/register", "/auth", "/tour", "/tour-features", "/setup", "/adv-landing", "/onboarding", "/reset-password", "/verify", "/invite", "/accept-invite", "/privacy", "/terms", "/oauth", "/callback-oauth", "/splash", "/dev", "/debug", "/test", "/test-page", "/not-found", "/+not-found", "/modal", "/sitemap"}


def _tour_all_features() -> Dict[str, List[dict]]:
    """Unione automatica delle funzioni reali: mappa Navigatore (APP_MAP) + capacità AxonOS (_TOUR_FEATURES)
    + schermate presenti nel codebase (file di expo-router) non ancora mappate. Mai un numero a mano."""
    groups: Dict[str, List[dict]] = {}
    seen_routes, seen_names = set(), set()
    try:
        amap = APP_MAP  # noqa: F821 — definita da axon_navigator (stesso namespace)
    except NameError:
        amap = []
    for e in amap:
        key = e["route"]
        if key in seen_routes:
            continue
        seen_routes.add(key); seen_names.add(e["name"].lower())
        r = e["route"]
        if "{id}" in r:  # rotte per singolo contatto → la lista contatti (l'utente sceglie il cliente); altre → pagina senza parametro
            r = "/contatti" if r.startswith("/contact/") else r.split("?")[0]
        groups.setdefault(e["group"], []).append({"id": e["id"], "name": e["name"], "route": r})
    for fid, name, grp in _TOUR_FEATURES:
        if name.lower() in seen_names:
            continue
        seen_names.add(name.lower())
        groups.setdefault(_TOUR_GROUP_MAP.get(grp, grp), []).append({"id": fid, "name": name, "route": _TOUR_FEATURE_ROUTES.get(fid)})
    # schermate reali nel codebase non ancora coperte
    try:
        mapped_paths = {r.split("?")[0] for r in seen_routes}
        for path in sorted(_st_frontend_routes()):  # noqa: F821 — axon_stress_test
            if path in _TOUR_TECH_SCREENS or "[" in path or path in mapped_paths or path.startswith("/admin") or path.startswith("/auth") or any(t in path for t in _TOUR_TECH_SUBSTR):
                continue
            pretty = _TOUR_PRETTY.get(path) or " · ".join(p.replace("-", " ").capitalize() for p in path.strip("/").split("/"))
            if pretty.lower() in seen_names:
                continue
            seen_names.add(pretty.lower())
            groups.setdefault("Altre schermate", []).append({"id": "scr_" + path.strip("/").replace("/", "_"), "name": pretty, "route": path})
    except Exception:
        pass
    return groups


@api_router.get("/tour/features")
async def tour_features(user=Depends(get_current_user)):
    groups = _tour_all_features()
    total = sum(len(v) for v in groups.values())
    return {"total": total, "groups": [{"group": g, "items": items} for g, items in groups.items()]}


def _tour_heuristic(text: str) -> List[str]:
    t = (text or "").lower()
    picks = [fid for fid, kws in _TOUR_KEYWORDS.items() if any(k in t for k in kws)]
    for d in ("chat", "contacts", "calendar", "bills"):
        if len(picks) >= 4: break
        if d not in picks: picks.append(d)
    return picks[:4]


@api_router.post("/tour/profile")
async def tour_profile(body: TourProfileIn, user=Depends(get_current_user)):
    labels = ["Cosa fai e cosa ti fa perdere più tempo", "Funzione indispensabile", "Cosa ti aspetti da AdvisorOS"]
    if body.answers:
        text = "\n".join(f"{labels[i] if i < 3 else 'Altro'}: {(a or '').strip()}" for i, a in enumerate(body.answers[:3]) if (a or "").strip())[:3000]
    else:
        text = (body.text or "").strip()[:2000]
    if not text:
        raise HTTPException(status_code=400, detail="Racconta ad Axon cosa fai")
    names = {fid: name for fid, name, _g in _TOUR_FEATURES}
    picks: List[str] = []
    reply = ""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            catalog = "\n".join(f"- {fid}: {name}" for fid, name, _g in _TOUR_FEATURES)
            chat = LlmChat(api_key=key, session_id=f"tour-{uuid.uuid4().hex[:8]}",
                           system_message=("Sei Axon, assistente di AdvisorOS (CRM per consulenti energia e networker). L'utente ha risposto a 3 domande (cosa fa e cosa gli fa perdere tempo; quale funzione è indispensabile; cosa si aspetta). "
                                           "Scegli da 3 a 4 funzioni dal catalogo che risolvono DAVVERO il suo problema e scrivi UNA frase calda e concreta (max 25 parole, tu/te, italiano) che spiega cosa attivi per lui. "
                                           "Rispondi SOLO con JSON: {\"features\": [\"id\",...], \"reply\": \"...\"}\nCATALOGO:\n" + catalog)).with_model("anthropic", "claude-haiku-4-5-20251001")
            raw = await asyncio.wait_for(chat.send_message(UserMessage(text=text)), timeout=25)
            m = re.search(r"\{.*\}", raw or "", re.S)
            data = _json_stdlib.loads(m.group(0)) if m else {}
            picks = [f for f in (data.get("features") or []) if f in _TOUR_IDS][:4]
            reply = str(data.get("reply") or "").strip()[:300]
        except Exception as exc:  # noqa: BLE001
            logger.warning("[tour] profile LLM failed: %s", exc)
    if len(picks) < 3:
        picks = _tour_heuristic(text)
    if not reply:
        reply = "Ho capito. Ecco cosa attivo per te."
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"tour_profile": {"text": text, "features": picks, "at": utcnow()}}}, upsert=True)
    return {"features": [{"id": f, "name": names[f]} for f in picks], "reply": reply}


@api_router.post("/tour/contact-from-text")
async def tour_contact_from_text(body: TourTextIn, user=Depends(get_current_user)):
    text = (body.text or "").strip()
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="Dimmi almeno nome e un recapito")
    try:
        contact = await _llm_extract_contact(text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[tour] contact extract failed: %s", exc)
        parts = text.split()
        contact = {"first_name": parts[0] if parts else "", "last_name": " ".join(parts[1:3]) if len(parts) > 1 else "", "note_ai": text}
    return {"contact": contact}
