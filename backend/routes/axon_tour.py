# axon_tour.py — V50.z257 — Tour Guidato conversazionale (4 schermate) — modulo ISOLATO
#
# POST /tour/profile {text}     → Axon «elabora» la risposta («cosa fai e cosa ti fa perdere tempo») e sceglie 3-4 funzioni
#                                 del catalogo da «accendere» (JSON via Claude Haiku; fallback euristico). Salva user_settings.tour_profile.
# POST /tour/contact-from-text  → estrae i campi contatto da un testo dettato (riusa _llm_extract_contact di 12_ai_contact_copilot).
# GET  /tour/features           → elenco pulito di tutte le funzioni (solo nomi) per «Scopri tutte le funzioni».

_TOUR_FEATURES: List[Tuple[str, str, str]] = [  # (id, nome, gruppo)
    ("contacts", "Anagrafica clienti", "CRM"), ("map", "Mappa clienti", "CRM"), ("route", "Giro Ottimale", "CRM"), ("km", "Resoconto Km", "CRM"),
    ("visits", "Rilevamento visite", "CRM"), ("calendar", "Calendario e appuntamenti", "CRM"), ("deadlines", "Scadenze contratti", "CRM"),
    ("referrals", "Referenze e passaparola", "CRM"), ("reviews", "Recensioni", "CRM"), ("call_log", "Registro chiamate", "CRM"),
    ("bills", "Analisi bollette", "Energia"), ("compare", "Confronto offerte", "Energia"), ("pun", "PUN e mercato", "Energia"), ("offers", "Offerte aziendali", "Energia"),
    ("scanner", "Scanner documenti", "Documenti"), ("files", "Master Files", "Documenti"), ("pdf", "Report PDF", "Documenti"), ("business_card", "Biglietto da visita digitale", "Documenti"),
    ("chat", "Chat con Axon", "AxonOS"), ("voice", "Comandi vocali", "AxonOS"), ("notes", "Note vocali", "AxonOS"), ("wake", "Wake word «Hey Axon»", "AxonOS"),
    ("learn", "Insegna ad Axon", "AxonOS"), ("proactive", "Promemoria proattivi", "AxonOS"), ("wizard", "Configurazione guidata", "AxonOS"),
    ("email", "Email e caselle IMAP", "Comunicazioni"), ("whatsapp", "WhatsApp e messaggi", "Comunicazioni"), ("birthday", "Auguri automatici", "Comunicazioni"),
    ("team", "Team e collaboratori", "Master"), ("kpi", "KPI e statistiche", "Master"), ("gym", "Corporate Gym", "Master"), ("import", "Import contatti", "Master"),
    ("security", "Sicurezza e 2FA", "Impostazioni"), ("custom", "Personalizzazione", "Impostazioni"), ("help", "Help Center", "Impostazioni"),
]
_TOUR_IDS = {f[0] for f in _TOUR_FEATURES}
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


@api_router.get("/tour/features")
async def tour_features(user=Depends(get_current_user)):
    groups: Dict[str, List[dict]] = {}
    for fid, name, grp in _TOUR_FEATURES:
        groups.setdefault(grp, []).append({"id": fid, "name": name})
    return {"groups": [{"group": g, "items": items} for g, items in groups.items()]}


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
