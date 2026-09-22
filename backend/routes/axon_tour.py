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
    # V50.z277 — nuove funzioni nel tour (nomi identici alle voci APP_MAP → dedupe in «Tutte le funzioni»)
    ("courses", "Area Corsi", "Master"), ("courses_dashboard", "Dashboard Azienda corsi", "Master"), ("forms", "Modelli moduli (PDF da compilare)", "Master"),
    ("iddocs", "Documenti di riconoscimento", "Impostazioni"), ("axon_voice", "Voce e lingua di Axon", "AxonOS"), ("offline", "Modalità offline e sincronizzazione", "Impostazioni"), ("crt", "Compilazione CRT (pratica contratto)", "Master"),
    ("security", "Sicurezza e 2FA", "Impostazioni"), ("custom", "Personalizzazione", "Impostazioni"), ("help", "Help Center", "Impostazioni"),
    # V50.z303
    ("devices", "Dispositivi collegati (1 telefono + 1 tablet + 1 PC)", "Impostazioni"), ("rules_engine", "Regole assolute con peso (Insegna ad Axon)", "AxonOS"), ("chat_queue", "Coda messaggi chat (scrivi mentre Axon risponde)", "AxonOS"), ("recommended", "Consigliato per te (Home)", "AxonOS"),
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
    "courses": "/courses", "courses_dashboard": "/courses/dashboard", "forms": "/form-templates", "iddocs": "/anagrafica-master", "axon_voice": "/axon-voice", "offline": "/offline-sync", "crt": "/crt",
    "security": "/security", "custom": "/impostazioni?section=branding", "help": "/help-center",
    "devices": "/devices", "rules_engine": "/ai-teach", "chat_queue": "/axon-hub", "recommended": "/home",
}
_TOUR_KEYWORDS = {
    "courses": ["corso", "corsi", "formazione", "formare", "attestat", "slide", "powerpoint", "quiz", "test ai collaborator"], "forms": ["modul", "compilare", "compilazione", "precompil"],
    "iddocs": ["carta d", "identit", "patente", "passaport", "tessera sanitaria", "scadenza document"], "axon_voice": ["voce di axon", "lingua", "cambiare voce"],
    "crt": ["contratt", "crt", "moduli", "pod", "fornitur", "compilazione"],
    "offline": ["offline", "aereo", "senza rete", "senza connessione", "campo", "viaggi", "in giro", "zone senza"],
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
_TOUR_PRETTY = {"/courses/new": "Area Corsi · Nuovo corso", "/courses/dashboard": "Area Corsi · Dashboard Azienda", "/corporate/new": "New Corporate · Nuova area business", "/axon-brain": "Cervello Axon (conoscenza)", "/axon-cheatsheet": "Cheat sheet fornitori", "/axon-homeassistant": "Home Assistant", "/axon-insights": "Autoapprendimento Axon", "/axon-media": "Archivio foto, audio e video", "/axon-proactive": "Axon proattivo", "/axon-scripts": "Playbook script di chiamata", "/axon-scripts-import": "Import script", "/axon-stress-report": "Stress Test Axon", "/axon-system": "Stato sistema Axon", "/bug-report": "Segnala bug", "/business-card-stats": "Statistiche biglietto digitale", "/call-script-config": "Configurazione script chiamate", "/corporate-gym/assign": "Corporate Gym · Assegna", "/corporate-gym/coach-panel": "Corporate Gym · Pannello coach", "/corporate-gym/manuals-config": "Corporate Gym · Manuali", "/corporate-gym/obiezioni": "Corporate Gym · Obiezioni", "/corporate-gym/roleplay": "Corporate Gym · Roleplay", "/corporate-gym/stats": "Corporate Gym · Statistiche", "/corporate-gym/win-win": "Corporate Gym · Win-Win", "/event-banners": "Banner eventi", "/help-center-admin": "Richieste cancellazione dati (gestione)", "/info-requests": "Richieste informazioni", "/invita": "Invita", "/invitati": "Invitati", "/libretto-editor": "Editor libretto illustrativo", "/devices": "Dispositivi collegati", "/neo-memory": "Memoria Neo", "/permessi": "Permessi dispositivo", "/reviews-analytics": "Analisi recensioni", "/security": "Sicurezza avanzata", "/security-info": "Info sicurezza", "/wake-word": "Wake word «Hey Axon»"}
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
    labels = ["Cosa si aspetta da Axon e cosa gli complica la vita nel lavoro quotidiano", "Funzione indispensabile", "Cosa ti aspetti da AdvisorOS"]
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
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"tour_profile": {"text": text, "features": picks, "at": utcnow()},
                                                                              # V50.z284 — le risposte libere alimentano il profilo interessi usato da Axon
                                                                              "axon_interest_profile.free_answers": [(a or "").strip()[:600] for a in (body.answers or [text]) if (a or "").strip()][:6],
                                                                              "axon_interest_profile.updated_at": utcnow()}}, upsert=True)
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


# =====================================================================================
# V50.z284 — FORM SPUNTABILE DEGLI INTERESSI (tour, schermata 2) + PROFILO INTERESSI usato da Axon
#   GET  /tour/interest-questions            → 20 domande Sì/No base (round 1)
#   POST /tour/interest-questions/next       → altre 20 domande NUOVE (LLM, fallback set statico) evitando ripetizioni
#   POST /tour/interest-profile              → salva user_settings.axon_interest_profile + risposta «cosa attivo per te»
#   _axon_interest_section(user_id)          → blocco per il system prompt di Axon (personalizzazione + suggerimenti proattivi)
# =====================================================================================
_INTEREST_Q_ROUND1: List[Tuple[str, str]] = [  # (feature_id, domanda)
    ("offline", "Ti piacerebbe un CRM che funzioni anche offline (in aereo o dove non c'è rete) e sincronizzi tutto al ritorno della connessione?"),
    ("km", "Vai spesso dai clienti in auto? Ti servirebbe sapere in anticipo quanti km percorri in un giorno e avere il resoconto mensile?"),
    ("route", "Ti aiuterebbe un giro visite ottimizzato che mette in ordine i clienti da vedere nella stessa giornata?"),
    ("map", "Vuoi vedere i tuoi clienti su una mappa per organizzarti per zona?"),
    ("bills", "Analizzi bollette luce, gas o telefono dei clienti? Vorresti che Axon le leggesse ed estraesse i dati in automatico?"),
    ("compare", "Ti serve confrontare la bolletta attuale del cliente con le offerte della tua azienda e stimare il risparmio?"),
    ("crt", "Compili contratti (CRT) con i moduli PDF del fornitore? Vorresti che venissero precompilati in automatico da fatture e documenti?"),
    ("scanner", "Fotografi spesso documenti (carte d'identità, visure, fatture)? Ti serve uno scanner che li ritagli e li legga?"),
    ("business_card", "Raccogli biglietti da visita? Vorresti trasformarli in contatti con una foto (fronte e retro)?"),
    ("calendar", "Gestisci molti appuntamenti? Ti serve un'agenda con promemoria e richiami da fare?"),
    ("deadlines", "Hai contratti con scadenze o rinnovi da tenere sotto controllo con avvisi in anticipo?"),
    ("whatsapp", "Comunichi con i clienti via WhatsApp o SMS? Ti piacerebbe inviare messaggi (anche a gruppi) direttamente dalla scheda cliente?"),
    ("email", "Usi la posta elettronica per lavoro? Vuoi collegare le tue caselle e scrivere ai clienti dall'app?"),
    ("voice", "Guidi molto? Ti servirebbe parlare con Axon a voce in auto (note, appuntamenti, chiamate) senza toccare il telefono?"),
    ("notes", "Preferisci registrare note vocali sui clienti invece di scrivere?"),
    ("team", "Hai collaboratori o una rete? Vuoi assegnare clienti, vedere i loro risultati e chattare con il team?"),
    ("kpi", "Ti interessa un cruscotto con numeri e obiettivi (chiamate, appuntamenti, contratti) tuoi e del team?"),
    ("courses", "Formi collaboratori o clienti? Ti servono corsi con slide generate dalla dettatura, quiz e attestati PDF?"),
    ("referrals", "Lavori con il passaparola? Vuoi tracciare chi ti ha segnalato ogni cliente?"),
    ("proactive", "Vuoi che Axon ti avvisi da solo (compleanni, clienti trascurati, scadenze) senza che glielo chieda?"),
]
_INTEREST_Q_ROUND2: List[Tuple[str, str]] = [
    ("birthday", "Ti piacerebbe che Axon scrivesse e inviasse gli auguri di compleanno personalizzati ai clienti?"),
    ("reviews", "Raccogli recensioni? Ti serve analizzarle e capire cosa pensano davvero i clienti?"),
    ("pun", "Segui il PUN e il mercato dell'energia? Vuoi un widget in Home con i prezzi aggiornati?"),
    ("offers", "Vuoi caricare le offerte della tua azienda così Axon le usa nei confronti e nelle proposte?"),
    ("files", "Ti serve un archivio file condiviso (Master Files) per documenti e listini con i collaboratori?"),
    ("pdf", "Vuoi generare report PDF (attività, KPI, analisi) da inviare a clienti o alla direzione?"),
    ("chat", "Useresti una chat con Axon per chiedere informazioni sui tuoi clienti e sui tuoi dati?"),
    ("wake", "Ti piacerebbe attivare Axon con la voce dicendo «Hey Axon»?"),
    ("learn", "Vuoi insegnare ad Axon regole, listini e documenti della tua azienda così risponde come vuoi tu?"),
    ("wizard", "Preferisci una configurazione guidata passo-passo delle tue aree di lavoro?"),
    ("import", "Hai già una rubrica o un file Excel di contatti da importare?"),
    ("gym", "Ti interessa allenare le tecniche di vendita (roleplay, gestione obiezioni) con Axon come coach?"),
    ("forms", "Usi spesso moduli PDF da compilare (SEPA, deleghe)? Vuoi caricarli come modelli riutilizzabili?"),
    ("iddocs", "Vuoi che Axon legga i documenti d'identità dei clienti e ti avvisi quando scadono?"),
    ("axon_voice", "Vorresti scegliere la voce di Axon, la velocità di lettura e la lingua in cui ti risponde?"),
    ("security", "Ti serve un accesso protetto con verifica in due passaggi (2FA)?"),
    ("custom", "Vuoi personalizzare colori, logo e banner dell'app con il tuo brand?"),
    ("call_log", "Registri l'esito delle telefonate (occupato, richiamare, appuntamento preso) per ogni cliente?"),
    ("visits", "Vuoi che le visite ai clienti vengano rilevate automaticamente dal GPS quando ti fermi da loro?"),
    ("help", "Ti piacerebbe un Help Center dentro l'app con guide e assistenza rapida?"),
]


def _interest_items(pairs: List[Tuple[str, str]], round_no: int) -> List[dict]:
    return [{"id": f"q{round_no}_{i + 1}", "feature": fid, "text": q} for i, (fid, q) in enumerate(pairs)]


class InterestAnswerIn(BaseModel):
    id: str
    text: str
    answer: Optional[bool] = None  # None = saltata (V50.z295)
    feature: Optional[str] = None
    note: Optional[str] = None  # V50.z295 — precisazione dell'utente («2 settimane no, oltre un mese sì»)


class InterestNextIn(BaseModel):
    answers: List[InterestAnswerIn]
    round: int = 1  # round appena completato → genera round+1


class InterestProfileIn(BaseModel):
    answers: List[InterestAnswerIn]
    free_answers: Optional[List[str]] = None  # risposte libere (voce/testo) già date nel tour


@api_router.get("/tour/interest-questions")
async def tour_interest_questions(user=Depends(get_current_user)):
    return {"round": 1, "questions": _interest_items(_INTEREST_Q_ROUND1, 1)}


@api_router.post("/tour/interest-questions/next")
async def tour_interest_questions_next(body: InterestNextIn, user=Depends(get_current_user)):
    nxt = max(2, int(body.round) + 1)
    asked_texts = {a.text.strip().lower() for a in body.answers}
    asked_features = {a.feature for a in body.answers if a.feature}
    yes = [a.text + (f" (nota: {a.note.strip()})" if a.note and a.note.strip() else "") for a in body.answers if a.answer is True][:40]
    no = [a.text + (f" (nota: {a.note.strip()})" if a.note and a.note.strip() else "") for a in body.answers if a.answer is False][:40]
    questions: List[dict] = []
    key = os.environ.get("EMERGENT_LLM_KEY")
    if key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            catalog = "\n".join(f"- {fid}: {name}" for fid, name, _g in _TOUR_FEATURES)
            chat = LlmChat(api_key=key, session_id=f"tour-iq-{uuid.uuid4().hex[:8]}",
                           system_message=("Sei Axon, assistente di AdvisorOS (CRM per consulenti energia/telco e networker). Devi proporre 20 NUOVE domande Sì/No, in italiano, "
                                           "brevi (max 25 parole), concrete e con il 'tu', per capire di cosa ha bisogno l'utente e quali funzioni gli servono. "
                                           "Approfondisci le aree a cui ha detto SÌ (casi d'uso specifici, scorciatoie, automazioni), non ripetere le domande già poste e non insistere su aree a cui ha detto NO. "
                                           "Ogni domanda va collegata a UNA funzione del catalogo (campo feature = id). Rispondi SOLO con JSON: {\"questions\": [{\"feature\": \"id\", \"text\": \"...\"}, ...]}\nCATALOGO:\n" + catalog)).with_model("anthropic", "claude-haiku-4-5-20251001")
            prompt = "DOMANDE GIÀ POSTE (non ripeterle):\n" + "\n".join(f"- {t}" for t in sorted(asked_texts)) + "\n\nHA DETTO SÌ A:\n" + "\n".join(f"- {t}" for t in yes) + "\n\nHA DETTO NO A:\n" + "\n".join(f"- {t}" for t in no)
            raw = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=40)
            m = re.search(r"\{.*\}", raw or "", re.S)
            data = _json_stdlib.loads(m.group(0)) if m else {}
            seen = set(asked_texts)
            for it in data.get("questions") or []:
                fid = str(it.get("feature") or "").strip()
                txt = str(it.get("text") or "").strip()
                if not txt or txt.lower() in seen or fid not in _TOUR_IDS:
                    continue
                seen.add(txt.lower())
                questions.append({"id": f"q{nxt}_{len(questions) + 1}", "feature": fid, "text": txt[:220]})
                if len(questions) >= 20:
                    break
        except Exception as exc:  # noqa: BLE001
            logger.warning("[tour] interest next-round LLM failed: %s", exc)
    if len(questions) < 20:  # fallback: set statico, saltando funzioni già chieste
        pool = [(f, q) for f, q in _INTEREST_Q_ROUND2 + _INTEREST_Q_ROUND1 if f not in asked_features and q.lower() not in asked_texts]
        for f, q in pool:
            if len(questions) >= 20:
                break
            if any(x["text"].lower() == q.lower() for x in questions):
                continue
            questions.append({"id": f"q{nxt}_{len(questions) + 1}", "feature": f, "text": q})
    return {"round": nxt, "questions": questions}


@api_router.post("/tour/interest-profile")
async def tour_interest_profile(body: InterestProfileIn, user=Depends(get_current_user)):
    names = {fid: name for fid, name, _g in _TOUR_FEATURES}
    yes_f: List[str] = []
    no_f: List[str] = []
    notes = [f"«{a.text[:120]}» → {a.note.strip()[:300]}" for a in body.answers if a.note and a.note.strip()][:40]
    for a in body.answers:
        if not a.feature or a.feature not in _TOUR_IDS or a.answer is None:
            continue
        if a.answer and a.feature not in yes_f:
            yes_f.append(a.feature)
        elif not a.answer and a.feature not in no_f and a.feature not in yes_f:
            no_f.append(a.feature)
    no_f = [f for f in no_f if f not in yes_f]
    free = [str(t).strip() for t in (body.free_answers or []) if str(t).strip()][:6]
    # sintesi «bisogni» (LLM, fallback testuale)
    summary = ""
    reply = ""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if key and (yes_f or free or notes):
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            chat = LlmChat(api_key=key, session_id=f"tour-ip-{uuid.uuid4().hex[:8]}",
                           system_message=("Sei Axon, assistente di AdvisorOS. Ricevi le risposte di un utente a un questionario Sì/No sulle funzioni e alcune risposte libere. "
                                           "Scrivi: (1) 'summary': profilo dei bisogni in 3-5 frasi brevi in terza persona (cosa fa, cosa gli complica la vita, cosa cerca), utile a un assistente per personalizzare le risposte; "
                                           "(2) 'reply': UNA frase calda e concreta (max 25 parole, tu/te) che spiega cosa attivi per lui. Rispondi SOLO con JSON: {\"summary\": \"...\", \"reply\": \"...\"}")).with_model("anthropic", "claude-haiku-4-5-20251001")
            prompt = "RISPOSTE LIBERE:\n" + "\n".join(f"- {t}" for t in free) + "\n\nINTERESSATO A:\n" + "\n".join(f"- {names.get(f, f)}" for f in yes_f) + "\n\nNON INTERESSATO A:\n" + "\n".join(f"- {names.get(f, f)}" for f in no_f) + "\n\nNOTE/PRECISAZIONI DELL'UTENTE (importanti: definiscono soglie e preferenze):\n" + "\n".join(f"- {n}" for n in notes)
            raw = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=30)
            m = re.search(r"\{.*\}", raw or "", re.S)
            data = _json_stdlib.loads(m.group(0)) if m else {}
            summary = str(data.get("summary") or "").strip()[:900]
            reply = str(data.get("reply") or "").strip()[:300]
        except Exception as exc:  # noqa: BLE001
            logger.warning("[tour] interest profile LLM failed: %s", exc)
    if not summary:
        summary = ("Interessato a: " + ", ".join(names.get(f, f) for f in yes_f[:12])) if yes_f else "Nessuna area di interesse dichiarata."
    if not reply:
        reply = "Ho capito. Ecco cosa attivo per te."
    picks = yes_f[:6] if yes_f else _tour_heuristic(" ".join(free))
    profile = {
        "yes_features": yes_f, "no_features": no_f, "free_answers": free, "summary": summary, "notes": notes,
        "answers": [{"id": a.id, "text": a.text[:220], "answer": a.answer, "feature": a.feature, "note": (a.note or "").strip()[:300] or None} for a in body.answers][:400],
        "updated_at": utcnow(),
    }
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"axon_interest_profile": profile}}, upsert=True)
    return {"features": [{"id": f, "name": names[f]} for f in picks if f in names], "reply": reply, "yes_count": len(yes_f), "no_count": len(no_f)}


# =====================================================================================
# V50.z308 — PRIMO AVVIO IN 3 DOMANDE (tap): ruolo · cosa vendi · quanti clienti → profilo interessi + funzioni attivate.
# Il form completo (20 domande Sì/No, round illimitati) resta OPZIONALE («Profilo completo»). Nessun suggerimento «durante l'uso».
# =====================================================================================
_QUICK_MAP = {
    "role": {"master": ["team", "kpi", "courses", "courses_dashboard", "custom"], "consulente": ["contacts", "calendar", "route", "visits", "referrals"], "backoffice": ["files", "pdf", "forms", "deadlines", "scanner"]},
    "sells": {"luce_gas": ["pun", "bills", "compare", "offers", "crt"], "telefonia": ["offers", "compare", "contacts"], "fotovoltaico": ["bills", "pdf", "calendar", "offers"], "altro": ["offers", "contacts", "calendar"]},
    "clients": {"lt50": ["business_card", "import", "wizard", "chat"], "50_300": ["map", "deadlines", "birthday", "reviews"], "gt300": ["import", "km", "team", "kpi"]},
}
_QUICK_LABEL = {"master": "titolare/Master", "consulente": "consulente", "backoffice": "back office", "luce_gas": "luce e gas", "telefonia": "telefonia e internet", "fotovoltaico": "fotovoltaico ed efficienza", "altro": "altri servizi", "lt50": "meno di 50 clienti", "50_300": "tra 50 e 300 clienti", "gt300": "oltre 300 clienti"}


class QuickStartIn(BaseModel):
    role: str
    sells: List[str] = Field(default_factory=list)
    clients: str


@api_router.post("/tour/quick-start")
async def tour_quick_start(body: QuickStartIn, user=Depends(get_current_user)):
    names = {fid: name for fid, name, _g in _TOUR_FEATURES}
    picks: List[str] = []
    for f in _QUICK_MAP["role"].get(body.role, []) + [x for s_ in body.sells for x in _QUICK_MAP["sells"].get(s_, [])] + _QUICK_MAP["clients"].get(body.clients, []):
        if f in names and f not in picks:
            picks.append(f)
    if not picks:
        raise HTTPException(status_code=400, detail="Risposte non valide")
    row = await db.user_settings.find_one({"user_id": user["user_id"]}, {"axon_interest_profile": 1}) or {}
    prof = row.get("axon_interest_profile") or {}
    yes_f = list(prof.get("yes_features") or [])
    for f in picks:
        if f not in yes_f:
            yes_f.append(f)
    summary = f"Primo avvio: {_QUICK_LABEL.get(body.role, body.role)}, vende {', '.join(_QUICK_LABEL.get(s_, s_) for s_ in body.sells) or 'n/d'}, {_QUICK_LABEL.get(body.clients, body.clients)}."
    prof.update({"yes_features": yes_f, "quick": {"role": body.role, "sells": body.sells, "clients": body.clients}, "summary": (summary + " " + str(prof.get("summary") or "")).strip()[:600], "updated_at": utcnow()})
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"axon_interest_profile": prof}}, upsert=True)
    reply = f"Sei {_QUICK_LABEL.get(body.role, body.role)} e vendi {', '.join(_QUICK_LABEL.get(s_, s_) for s_ in body.sells) or 'vari servizi'}: ti ho preparato la Home con le funzioni giuste. Il profilo completo (20 domande) lo puoi fare quando vuoi."
    return {"features": [{"id": f, "name": names[f]} for f in picks[:8]], "reply": reply}


# =====================================================================================
# V50.z300 — CARD «CONSIGLIATO PER TE» (Home): scorciatoie alle funzioni a cui l'utente ha detto SÌ nel tour
#   GET  /tour/recommendations           → fino a 8 funzioni (yes_features del form, fallback tour_profile.features), meno quelle nascoste
#   POST /tour/recommendations/dismiss   → nasconde una funzione dalla card (user_settings.recommendations_dismissed)
# =====================================================================================
class RecommendationDismissIn(BaseModel):
    feature: str


@api_router.get("/tour/recommendations")
async def tour_recommendations(user=Depends(get_current_user)):
    row = await db.user_settings.find_one({"user_id": user["user_id"]}, {"axon_interest_profile": 1, "tour_profile": 1, "recommendations_dismissed": 1}) or {}
    prof = row.get("axon_interest_profile") or {}
    tour = row.get("tour_profile") or {}
    hidden = set(row.get("recommendations_dismissed") or [])
    names = {fid: (name, grp) for fid, name, grp in _TOUR_FEATURES}
    picks: List[str] = []
    for f in list(prof.get("yes_features") or []) + list(tour.get("features") or []):
        if f in names and f not in picks and f not in hidden and _TOUR_FEATURE_ROUTES.get(f):
            picks.append(f)
    has_profile = bool(prof.get("yes_features") or tour.get("features"))
    items = [{"id": f, "name": names[f][0], "group": names[f][1], "route": _TOUR_FEATURE_ROUTES[f]} for f in picks[:8]]
    return {"has_profile": has_profile, "items": items, "summary": str(prof.get("summary") or "")[:300]}


@api_router.post("/tour/recommendations/dismiss")
async def tour_recommendations_dismiss(body: RecommendationDismissIn, user=Depends(get_current_user)):
    if body.feature not in _TOUR_IDS:
        raise HTTPException(status_code=400, detail="Funzione sconosciuta")
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$addToSet": {"recommendations_dismissed": body.feature}}, upsert=True)
    return {"ok": True}


async def _axon_interest_section(user_id: str) -> str:
    """Blocco per il system prompt di Axon: profilo interessi (form + risposte libere del tour) → risposte personalizzate e suggerimenti proattivi."""
    try:
        row = await db.user_settings.find_one({"user_id": user_id}, {"axon_interest_profile": 1, "tour_profile": 1}) or {}
    except Exception:
        return ""
    prof = row.get("axon_interest_profile") or {}
    tour = row.get("tour_profile") or {}
    if not prof and not tour:
        return ""
    names = {fid: name for fid, name, _g in _TOUR_FEATURES}
    lines = ["\n\nPROFILO INTERESSI DELL'UTENTE (dichiarato nel tour guidato — usalo per personalizzare ogni risposta):"]
    free = list(prof.get("free_answers") or [])
    if not free and tour.get("text"):
        free = [str(tour.get("text"))[:600]]
    if free:
        lines.append("- Cosa fa / cosa gli complica la vita / cosa si aspetta: " + " | ".join(str(t)[:300] for t in free[:4]))
    if prof.get("summary"):
        lines.append("- Sintesi bisogni: " + str(prof["summary"])[:900])
    if prof.get("notes"):
        lines.append("- PRECISAZIONI dell'utente (soglie/preferenze da rispettare alla lettera): " + " | ".join(str(n)[:200] for n in prof["notes"][:12]))
    yes_f = [f for f in (prof.get("yes_features") or []) if f in names] or [f for f in (tour.get("features") or []) if f in names]
    if yes_f:
        lines.append("- INTERESSATO A (funzione → percorso): " + "; ".join(f"{names[f]} → {_TOUR_FEATURE_ROUTES.get(f, '/')}" for f in yes_f[:16]))
    no_f = [f for f in (prof.get("no_features") or []) if f in names]
    if no_f:
        lines.append("- NON interessato a: " + ", ".join(names[f] for f in no_f[:16]))
    lines.append(
        "REGOLE: (1) adatta tono, esempi e priorità a questo profilo; (2) quando è pertinente al messaggio, proponi PROATTIVAMENTE al massimo UNA scorciatoia o funzione correlata "
        "tra quelle di interesse, indicando il percorso nell'app (es. «Ho visto che usi la Mappa clienti: vuoi sapere in anticipo quanti km percorri in un giorno? Apri Resoconto Km»); "
        "(3) mai insistere: se l'utente declina, non riproporla nella stessa conversazione; (4) non proporre funzioni marcate NON interessato salvo richiesta esplicita."
    )
    return "\n".join(lines) + "\n"
