# axon_wizard_complete.py — V50.z216 — BLOCCO 5 · Completamento wizard e comportamento post-invio (modulo ISOLATO)
#
# • GET /axon/setup/completion → messaggio personalizzato di AxonOS (nome utente, tono coerente con il livello: «Set Up and Go» asciutto e
#   veloce, «Full and Go» completo e caloroso) + numeri (aree attive, proposte confermate, fatti appresi, file) + job in corso.
# • GET /axon/setup/config → tutto ciò che serve a Profilo → «La mia configurazione Set Up» (/setup-config): stato, sfera, aree con
#   on/off, anagrafica, Parla a Neo (input, proposte, job, file), memoria. POST /axon/setup/reopen {step} → riapre lo step nel wizard.
# • Dove vanno i dati: anagrafica → `master_profiles` (MongoDB, = pagina Anagrafica), file → Object Storage (Master Files), preferenze/fatti →
#   `axon_user_memory` (memoria AxonOS), sfera/aree → `axon_setup_state`. Nessun riavvio: Axon legge il DB a ogni risposta.
# • Axon SA rispondere a «dove sono finiti i miei dati», «posso modificare la configurazione», «devo riavviare l'app», «quanto ci vuole»
#   (sezione nel prompt + voce in _OMNI_EXTRA_SECTIONS).

_WC_MODE_LABEL = {"setup": "Set Up and Go", "full": "Full and Go"}

_OMNI_EXTRA_SECTIONS.append((
    "La mia configurazione Set Up (Profilo)", "/setup-config",
    "Riepilogo modificabile in ogni momento di tutto ciò che il wizard «Set Up and Go» ha raccolto: livello scelto, sfera (Business/Home/Entrambe), "
    "aree attive con switch, anagrafica (→ pagina Anagrafica), «Parla a Neo» (testi, file, audio, proposte da confermare), fatti appresi (→ Memoria AxonOS). "
    "Ogni modifica si sincronizza con AxonOS automaticamente, senza riavviare l'app. Da qui si può riaprire qualsiasi step del wizard.",
))


def _wc_first_name(user: dict, prof: dict) -> str:
    fn = (prof.get("first_name") or "").strip()
    if fn:
        return fn.split()[0].capitalize()
    nm = (user.get("name") or "").strip()
    return nm.split()[0].capitalize() if nm else ""


def _wc_message(name: str, mode: str, areas_on: int, accepted: int, facts: int, files: int, running: int) -> str:
    hi = f"{name}, " if name else ""
    if mode == "setup":
        msg = f"{hi}fatto. Essenziale, veloce, come volevi. Ho attivato {areas_on} aree"
        msg += f" e salvato {accepted} dati confermati." if accepted else "."
        if running:
            msg += " Sto ancora leggendo i tuoi file: continua pure, ti avviso io."
        else:
            msg += " Da adesso lavoro con te: chiedimi quello che ti serve."
        return msg
    msg = f"{hi}grazie per il tempo che mi hai dedicato: ora ti conosco davvero. Ho attivato {areas_on} aree"
    parts = []
    if accepted:
        parts.append(f"{accepted} dati confermati in anagrafica")
    if facts:
        parts.append(f"{facts} cose imparate su di te")
    if files:
        parts.append(f"{files} file letti e archiviati")
    if parts:
        msg += ", con " + ", ".join(parts)
    msg += "."
    if running:
        msg += " Sto ancora leggendo i tuoi file in background: puoi usare l'app, appena finisco ti propongo cosa ho trovato."
    else:
        msg += " Ogni cosa che mi hai raccontato la ritrovi in Profilo → «La mia configurazione Set Up», modificabile quando vuoi."
    return msg


@api_router.get("/axon/setup/completion")
async def wc_completion(user=Depends(get_current_user)):
    uid = user["user_id"]
    st = await _sw_get(uid)
    prof = await db.master_profiles.find_one({"user_id": uid}, {"_id": 0, "first_name": 1}) or {}
    talk = st.get("talk") or {}
    areas_on = sum(1 for k, v in (st.get("areas") or {}).items() if v and k not in _WS_FUTURE_KEYS)
    accepted = sum(1 for p in (talk.get("proposals") or []) if p.get("status") == "accepted")
    facts = sum(1 for f in (talk.get("facts") or []) if f.get("status") == "accepted")
    files = sum(1 for i in (talk.get("inputs") or []) if i.get("kind") == "file")
    running = sum(1 for j in (talk.get("jobs") or []) if j.get("status") == "running")
    name = _wc_first_name(user, prof)
    mode = st.get("mode") or "full"
    return {"first_name": name, "mode": mode, "mode_label": _WC_MODE_LABEL.get(mode, "Full and Go"),
            "message": _wc_message(name, mode, areas_on, accepted, facts, files, running),
            "stats": {"areas_on": areas_on, "accepted": accepted, "facts": facts, "files": files, "future_interests": len(st.get("future_interests") or [])},
            "running_jobs": running, "redirect_seconds": 6}


@api_router.get("/axon/setup/config")
async def wc_config(user=Depends(get_current_user)):
    uid = user["user_id"]
    st = await _sw_get(uid)
    prof = await db.master_profiles.find_one({"user_id": uid}, {"_id": 0, "credentials": 0}) or {}
    talk = st.get("talk") or {}
    areas = st.get("areas") or {}
    catalog = [{**a, "on": bool(areas.get(a["key"], False))} for a in _ws_catalog(st.get("sphere") or None)]
    mem_n = await db.axon_user_memory.count_documents({"user_id": uid})
    files = [{"file_id": i.get("file_id"), "name": i.get("name"), "size": i.get("size"), "at": i["at"].isoformat() if isinstance(i.get("at"), datetime) else i.get("at")}
             for i in (talk.get("inputs") or []) if i.get("kind") == "file"]
    return {
        "state": _sw_out(st) | {"talk": None},
        "mode_label": _WC_MODE_LABEL.get(st.get("mode") or "", None),
        "anagrafica": {k: prof.get(k) for k in ("first_name", "last_name", "birth_date", "tax_id", "phone", "emails", "primary_email", "address", "address_second", "address_relative", "primary_address")},
        "areas": catalog,
        "talk": {"inputs": len(talk.get("inputs") or []), "files": files,
                 "proposals_pending": sum(1 for p in (talk.get("proposals") or []) if p.get("status") == "pending"),
                 "proposals_accepted": sum(1 for p in (talk.get("proposals") or []) if p.get("status") == "accepted"),
                 "facts_accepted": sum(1 for f in (talk.get("facts") or []) if f.get("status") == "accepted"),
                 "jobs_running": sum(1 for j in (talk.get("jobs") or []) if j.get("status") == "running")},
        "memory_items": mem_n,
        "where": [
            {"icon": "id-card", "title": "Anagrafica", "text": "Nome, contatti e indirizzi sono nel tuo profilo (MongoDB) e nella pagina Anagrafica.", "route": "/anagrafica-master"},
            {"icon": "cloud-done", "title": "File", "text": "I file caricati sono su Object Storage, elencati nei Master Files.", "route": "/master-files"},
            {"icon": "bulb", "title": "Memoria AxonOS", "text": "Preferenze e cose apprese vivono nella memoria di AxonOS: le vedi e le correggi lì.", "route": "/axon-memory"},
        ],
    }


class WcReopenIn(BaseModel):
    step: int


@api_router.post("/axon/setup/reopen")
async def wc_reopen(body: WcReopenIn, user=Depends(get_current_user)):
    if body.step not in _SW_STEPS:
        raise HTTPException(status_code=400, detail="step 1..4")
    st = await _sw_get(user["user_id"])
    upd = {"status": "in_progress", "current_step": body.step, "updated_at": utcnow()}
    if not st.get("mode") or (body.step == 4 and st.get("mode") == "setup"):
        upd["mode"] = "full"
    await db.axon_setup_state.update_one({"user_id": user["user_id"]}, {"$set": upd})
    return _sw_out(await _sw_get(user["user_id"]))


# ============================================================================ Axon sa spiegare cosa succede dopo il wizard
_wc_prev_prepare_prompt = _prepare_assistant_prompt
_WC_FAQ_RE = re.compile(r"(privacy|cifrat|crittograf|terze parti|addestr|dove\s+(sono|son|è|e.)\s+(finit|andat|salvat)|dove\s+(trovo|vedo|stanno)\s+(i miei dati|i dati|i file|le mie info)|posso\s+(modificare|cambiare)\s+(la\s+)?config|"
                        r"modificare\s+(la\s+)?(configurazione|set ?up|wizard)|riavvi(are|o)\s+l'?app|devo\s+riavviare|quanto\s+(ci\s+)?(vuole|manca|tempo)|"
                        r"sta(i)?\s+(ancora\s+)?legg|elaborazion|set ?up\s+and\s+go|configurazione\s+guidata)", re.I)


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _wc_prev_prepare_prompt(user, body)
    if isinstance(prep, dict) and prep.get("query_class") == "simple":
        return prep  # V50.z413 — domanda semplice (ora/meteo/saluti/domotica): nessuna sezione extra nel prompt
    try:
        if not prep.get("system_message"):
            return prep
        msg = (getattr(body, "message", None) or "") if body is not None else ""
        st = await db.axon_setup_state.find_one({"user_id": user["user_id"]}, {"_id": 0, "status": 1, "talk.jobs": 1, "talk.proposals": 1}) or {}
        jobs = ((st.get("talk") or {}).get("jobs") or [])
        running = [j for j in jobs if j.get("status") == "running"]
        pend = sum(1 for p in ((st.get("talk") or {}).get("proposals") or []) if p.get("status") == "pending")
        if not (_WC_FAQ_RE.search(msg) or running or st.get("status") == "completed"):
            return prep
        sec = ("\n\n📦 DOPO IL WIZARD «SET UP AND GO» (sai rispondere con precisione a: dove sono finiti i miei dati / posso modificare la configurazione / "
               "devo riavviare l'app / quanto ci vuole):\n"
               "• DOVE SONO I DATI: anagrafica (nome, mail principale, telefono, indirizzi, CF) → profilo utente su MongoDB = pagina «Anagrafica»; file e audio caricati → "
               "Object Storage, elencati in «Master Files»; preferenze e cose apprese → «Memoria AxonOS»; sfera e aree → la tua configurazione. Niente è andato perso.\n"
               "• MODIFICARE: sempre possibile, da Profilo → «La mia configurazione Set Up» (/setup-config): tutti i campi sono modificabili in qualsiasi momento e ogni "
               "modifica si sincronizza con me automaticamente. Da lì si può riaprire qualunque step del wizard.\n"
               "• RIAVVIO APP: NON necessario, mai. Leggo i dati aggiornati a ogni risposta.\n"
               "• TEMPI: testo libero → pochi secondi; file e audio → elaborazione in background (in genere 10-60 secondi, i PDF lunghi o gli audio di diversi minuti "
               "possono richiedere un paio di minuti); l'utente può navigare subito, l'indicatore «AxonOS sta leggendo i tuoi file…» scompare al termine.\n"
               "• PRIVACY: i dati restano nell'account AdvisorOS dell'utente; non condivisi con terze parti, non venduti, non usati per addestrare modelli AI esterni; "
               "accessibili solo all'utente e ai collaboratori autorizzati. Codice fiscale, data di nascita, indirizzi e telefono del profilo sono cifrati a livello di campo nel database "
               "(cifratura trasparente: l'utente li vede in chiaro). Privacy policy: https://advisoros.it/privacy\n")
        if running:
            sec += f"• STATO ADESSO: sto ancora leggendo {len(running)} file/audio ({', '.join(str(j.get('name')) for j in running[:3])}). Dillo se te lo chiedono.\n"
        elif jobs:
            sec += "• STATO ADESSO: nessuna elaborazione in corso, tutti i file sono stati letti.\n"
        if pend:
            sec += f"• PROPOSTE IN SOSPESO: {pend} dati estratti attendono un tap di conferma in Profilo → La mia configurazione Set Up → Parla a Neo.\n"
        prep["system_message"] += sec
    except Exception as exc:  # noqa: BLE001
        logger.warning("[wizard-complete] prompt failed: %s", exc)
    return prep
