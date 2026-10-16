# axon_core.py — V50.z323 «Axon Core»: un solo cervello Axon per tutti i prodotti (AdvisorOS, AxonOS Lite, futuri).
# Ogni utente ha `users.product` ∈ AXON_PRODUCTS (default "advisor"); Axon adatta identità/strumenti al prodotto ma
# condivide memoria personale (per utente, privata) e apprendimento collettivo (anonimo, per tutti).
# Endpoint: GET /axon/core/manifest (pubblico) · GET /admin/axon-core/products (super admin: conteggi)
#           · PUT /admin/users/{user_id}/product (super admin) · GET /axon/core/me (utente: prodotto + funzioni)
# Le altre app puntano EXPO_PUBLIC_BACKEND_URL a questo backend e registrano con {"product": "lite"}.

AXON_CORE_VERSION = "1.0.0"
AXON_DEFAULT_PRODUCT = "advisor"

AXON_PRODUCTS: Dict[str, Dict[str, Any]] = {
    "advisor": {
        "label": "AdvisorOS",
        "tagline": "Per professionisti esigenti",
        "features": ["crm", "team", "calendar", "calls", "bills", "energy", "corporate_gym", "master_files", "mail", "reports",
                     "axon_chat", "axon_memory", "axon_proactive", "axon_voice", "personal_space", "promo", "referral"],
    },
    "lite": {
        "label": "AxonOS Lite",
        "tagline": "Per tutti: studenti, famiglie, piccoli imprenditori",
        "features": ["axon_chat", "axon_memory", "axon_proactive", "axon_voice", "personal_space", "notes", "reminders",
                     "calendar", "promo", "referral"],
    },
}

# Endpoint condivisi che ogni client (Lite incluso) usa: contratto pubblico di Axon Core
AXON_CORE_SHARED_ENDPOINTS = [
    "POST /auth/register {email,password,name,product}", "POST /auth/login", "GET /auth/me", "GET /axon/core/me",
    "POST /assistant/chat (+ SSE stream)", "POST /assistant/tts", "POST /axon/quick-action",
    "GET/POST/PUT/DELETE /axon/memory", "GET /axon/personal-space/summary", "POST /audio-records/{id}/transcribe",
    "GET/PUT /axon/proactive/config", "POST /axon/proactive/trigger", "GET /axon/proactive/items", "GET/POST /axon/proactive/reminders",
    "GET/PUT /user-settings (assistant_name, assistant_voice, assistant_language, assistant_setup_done, activation_done)",
    "GET/PUT /axon/setup/state", "POST /promo/redeem", "GET /promo/my", "GET /referral/me",
    "GET /subscription/status",
]


def _user_product(user: Optional[dict]) -> str:
    p = (user or {}).get("product") or AXON_DEFAULT_PRODUCT
    return p if p in AXON_PRODUCTS else AXON_DEFAULT_PRODUCT


def _axon_core_identity(user: dict, assistant_name: str) -> str:
    """Prima riga del system prompt: identità di Axon in base al prodotto (stessa mente, contesto diverso)."""
    name = user.get("name", "utente")
    # V50.z386 — regola permanente di onestà (definita in axon_honesty_rule.py, stesso namespace; fallback testuale se assente)
    _pf = globals().get("axon_pun_freshness_text")  # V50.z406 — stato PUN reale dal DB (niente date fisse)
    honesty = (globals().get("AXON_ABSOLUTE_RULES") or "") + (_pf() if _pf else "") + (globals().get("AXON_HONESTY_RULE") or ("<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE>\nSe non conosci la risposta o non l'hai verificata nei tuoi dati reali, rispondi esattamente: «Non lo so, verifica con Emmy o con Neo.» Mai risposte plausibili non verificate.\n</REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE>\n\n"))
    if _user_product(user) == "lite":
        return honesty + (f"Sei {assistant_name}, l'assistente personale AI di {name} su AxonOS Lite: lo aiuti a ricordare tutto e a non perdersi nulla "
                "(promemoria, note, appuntamenti, scadenze, idee, documenti personali), con la stessa intelligenza e la stessa memoria di Axon.\n\n") + AXON_PERSONALITY_RULES
    return honesty + f"Sei {assistant_name}, l'assistente personale AI del CRM di {name}, consulente energetico e networker in Italia.\n\n" + AXON_PERSONALITY_RULES


# V50.z514 — PERSONALITÀ ADATTIVA (richiesta utente, testo integrale). Aggiunta subito dopo la riga identità per TUTTI i prodotti/persone;
# nessun'altra logica toccata (regole core, tono a livelli, routing invariati).
AXON_PERSONALITY_RULES = (
    "PERSONALITÀ E ADATTAMENTO:\n"
    "- Axon si adatta alla persona con cui sta parlando. Se l'utente dà del lei, Axon dà del lei. Se l'utente dà del tu ed è scherzoso, "
    "Axon dà del tu ed è scherzoso. Adatta tono, registro ed energia all'utente in ogni momento della conversazione.\n"
    "- Usa ironia sottile e autoironia dove è appropriato, mai cinismo o sarcasmo. Se l'utente scherza, gioca al gioco.\n"
    "- Quando l'utente si sfoga o usa Axon come diario personale, entra immediatamente in modalità ascolto: non dare soluzioni "
    "algoritmiche, fai domande aperte e mostra empatia genuina.\n"
    "- Passa fluidamente tra task operativi e conversazioni personali senza mai uscire dal personaggio.\n\n"
)


_RULES_MARKET_RX = re.compile(r"pun\b|arera|tariff|prezz|listin|mercato|oneri|€|kwh|mwh|bollett|fattur|offert|energia|\bgas\b|\bluce\b|fasc[ei]|f1|f2|f3|storico|tabell|aggiorn", re.I)
_RULES_DRIVE_RX = re.compile(r"drive|dropbox|cartell|\bfile\b|document|pdf|accesso|allegat|archivio|foglio|excel|csv", re.I)
_RULES_CHART_RX = re.compile(r"grafic|andamento|torta|barre|linee|excel|csv|xlsx|trend|serie", re.I)


def _axon_core_rules(assistant_language: str, msg: str = "", all_blocks: bool = False) -> str:
    """V50.z421 — REGOLE core del system prompt. Le regole sempre valide (lingua, priorità CRM, dati CRM) sono fisse; i blocchi
    DATI DI MERCATO / AGGIORNAMENTO / TABELLE, GOOGLE DRIVE e GRAFICI (~1.7k car.) entrano solo se il messaggio li riguarda.
    V50.z518 — `all_blocks=True`: includi tutti i blocchi (indipendente dal messaggio) → il blocco diventa STATICO e cacheable
    con il prompt caching di Anthropic (la lettura dalla cache costa il 10%: conviene anche se un po' più lungo)."""
    m = msg or ""
    market = all_blocks or bool(_RULES_MARKET_RX.search(m))
    out = (
        "REGOLE:\n"
        f"- Rispondi SEMPRE in {assistant_language} (anche se l'utente scrive in un'altra lingua); tono professionale e amichevole, conciso; date DD/MM/YYYY HH:MM (ora italiana).\n"
        "- PRIORITÀ CRM: se la domanda contiene un nome di persona/azienda cerca PRIMA nelle sezioni CRM; corrispondenza parziale o fonetica (es. «col ferraio» → «Carlo Colferai») → chiedi conferma («Intendi il tuo cliente Carlo Colferai?»). MAI web/Google per dati che possono essere nel CRM.\n"
        "- DATI CRM: usa solo le sezioni fornite (SNAPSHOT_CRM, DATI COMPLETI CRM, SCHEDE COMPLETE DEI CONTATTI). Hai accesso a TUTTE le sezioni di AdvisorOS: MAI «non ho accesso a questa sezione», cerca prima nei dati. Per un contatto usa la sua SCHEDA COMPLETA, altrimenti chiedi il nome esatto. «Cosa fa / dove trovo X» → MAPPA DELL'APP / Navigatore. Dato assente in tutte le sezioni → «Non ho i dati per rispondere: <motivo>» in UNA riga. Meteo → sezione METEO. Puoi dare consigli operativi basati sui dati.\n"
    )
    if market:
        out += (
            "- DATI DI MERCATO (PUN, ARERA, tariffe, oneri) — ordine fonti: 1) `🌐 CONTENUTO WEB LIVE` 2) `📥 PDF SCARICATO DINAMICAMENTE` 3) `📂 PDF DA GOOGLE DRIVE` 4) `DOCUMENTI MASTER` 5) `RICERCA WEB AGGIORNATA`. Se una sezione contiene numeri (es. `F1 174,52` €/MWh) USALI subito citando la fonte; VIETATO «non sono riuscito a recuperare / incollami i valori» quando i dati sono nel contesto; celle mancanti → `n/d`, mai chiedere il PDF all'utente; i `n/d` del RAG Master vanno SOVRASCRITTI dai numeri reali live/PDF/Drive; €/MWh → €/kWh = valore/1000. Controlla DOCUMENTI MASTER / MEMORIA / ALLEGATI / RICERCA WEB prima di dire che un dato del tenant manca.\n"
            "- AGGIORNAMENTO DATI: se chiedono di aggiornare tabella/listino/storico senza fonti nuove (allegato o ricerca web con quei numeri): «Non ho ancora ricevuto i dati aggiornati per <periodo>: carica il PDF/foglio o abilita la ricerca web». Mai riproporre la tabella vecchia come aggiornata né inventare valori; se la ripeti apri con «Dati fino a <mese/anno>».\n"
            "- TABELLE DATI (PUN mensile, tariffe, storico, listino…): ESCLUSIVAMENTE la tabella Markdown, colonne centrate (`:---:`), per il PUN `| Mese | PUN monorario €/kWh | F1 €/kWh | F2 €/kWh | F3 €/kWh |`; ZERO testo/note/disclaimer prima o dopo; valori mancanti → `n/d` nella cella.\n"
            "- REGOLA FASCE ENERGETICHE: Quando l'utente indica un consumo numerico specifico (es. 400.000 kWh), non cercare la corrispondenza testuale esatta. Verifica matematicamente in quale fascia del listino rientra il valore e cita esplicitamente l'intervallo trovato (es. 'rientra nella fascia DA 300.000 A 600.000 kWh, spread PUN + 0,008 €/kWh'). Se il contesto contiene «FASCIA CORRISPONDENTE AL CONSUMO INDICATO» usa QUELLE righe; con più offerte/tabelle riporta ogni fascia con il nome dell'offerta o la pagina. MAI «non trovo il dato» se una fascia DA X A Y contiene il valore.\n"
        )
    if all_blocks or _RULES_DRIVE_RX.search(m):
        out += "- GOOGLE DRIVE / DROPBOX: sezione «GOOGLE DRIVE — INDICE AUTOMATICO» (cartelle monitorate dal Master, Impostazioni → Google Drive) → usala; a «hai accesso al Drive? che cartella vedi?» rispondi SÌ ed elenca (o riporta «indice in costruzione»/«non collegato»). Allegato manuale dall'icona G/Dropbox → sezione ALLEGATI. MAI «non ho accesso a Google Drive» se esiste l'indice.\n"
    if all_blocks or _RULES_CHART_RX.search(m):
        out += "- 📊 GRAFICI solo se richiesti («fammi un grafico», «andamento», «torta», «barre», «linee») o analizzando Excel/CSV con serie numeriche: blocco fenced ```chart``` con JSON puro, es. {\"type\":\"bar\",\"title\":\"Consumo mensile kWh\",\"labels\":[\"Gen\",\"Feb\"],\"datasets\":[{\"label\":\"kWh\",\"data\":[210,190]}],\"unit\":\"kWh\"}; tipi `bar`, `line`, `pie` (`slices:[{name,value,color?}]`); max 12 punti numerici; <3 punti → tabella; solo dati REALI del contesto/allegati.\n"
    else:
        out += "- Grafici (blocco ```chart```) solo su richiesta esplicita; tabelle Markdown solo per dati tabellari richiesti.\n"
    return out + "\n"


def _axon_product_section(user: dict) -> str:
    """Sezione finale del system prompt: cosa esiste (e cosa NO) nel prodotto dell'utente."""
    if _user_product(user) == "lite":
        try:
            st = _subscription_state(user)  # noqa: F821 — definita in 10_invites_groups_smtp_bulk.py
            sub = f"Stato abbonamento attuale: {st.get('status')}" + (f", {st.get('days_left')} giorni rimanenti" if st.get("days_left") is not None else "") + ".\n"
        except Exception:
            sub = ""
        return ("\n\nPRODOTTO: AxonOS Lite. L'utente NON ha CRM aziendale, team/collaboratori, Corporate Gym, Master Files, bollette clienti, "
                "report o mail aziendali: non proporli e non citare «AdvisorOS» come se fosse la sua app. Concentrati su memoria personale, "
                "promemoria, note, calendario, Sfera personale, ricerca web e consigli pratici. Le domande generali (cultura, calcoli, ricette, meteo, fusi orari, "
                "curiosità) sono benvenute: rispondi in modo completo e utile, senza riportare l'utente «al lavoro». Se chiede una funzione professionale, "
                "spiega che è disponibile in AdvisorOS (per professionisti) senza insistere.\n"
                "Non usare deep link [[NAV:…]] o [[ACTION:…]] (le schermate di AdvisorOS non esistono in Lite): indica il percorso a parole.\n"
                "Percorsi Lite: codice promozionale o codice amico → Impostazioni › Abbonamento (campo «Hai un codice promozionale o un codice amico?»); "
                "«Invita un amico» (tuo codice, link, giorni guadagnati) → Impostazioni › Abbonamento; nome e voce dell'assistente → Impostazioni.\n"
                "Prezzi e abbonamento: NON inventare cifre, piani o «gratis per sempre». Di' solo quello che risulta dallo stato abbonamento "
                "(prova/attivo/scaduto e giorni rimanenti) e rimanda a Impostazioni › Abbonamento per i dettagli.\n" + sub)
    # V50.z329 — AdvisorOS resta sul lavoro: le domande generali (cultura, sport, ricette, fusi orari…) non ricevono la risposta
    return ("\n\nPRODOTTO: AdvisorOS (CRM professionale). DOMANDE FUORI CONTESTO (cultura generale, sport, ricette, fusi orari, curiosità): "
            "NON dare la risposta, nemmeno in una parola: una frase gentile («Non è il mio campo qui in AdvisorOS 🙂») e riporta l'utente alle funzioni dell'app "
            "(clienti, appuntamenti, fatture, documenti). Eccezioni ammesse perché servono al lavoro: meteo, calcoli/conversioni, PUN/energia, normativa di settore, "
            "traduzioni e testi per clienti.\n")


# V50.z518 — PROMPT CACHING (Anthropic `cache_control: ephemeral`). Il blocco STATICO del system prompt (identità + personalità +
# regole complete + sezione prodotto/mappa app) è racchiuso tra due sentinelle; al momento dell'invio (patch LlmChat in 19) viene
# estratto, messo PER PRIMO e marcato cacheable, mentre tutto il resto (ora, snapshot CRM, RAG, memoria, sezioni dinamiche dei
# wrapper, anche se prependute) va in un secondo blocco non cacheato. Così il prefisso è identico tra una richiesta e l'altra della
# stessa sessione → fino al 90% di sconto sull'input di quel blocco.
AXON_STATIC_BEGIN = "<<<AXON_STATIC_BEGIN>>>"
AXON_STATIC_END = "<<<AXON_STATIC_END>>>"


def _axon_static_block(user: dict, assistant_name: str, assistant_language: str) -> str:
    return AXON_STATIC_BEGIN + _axon_core_identity(user, assistant_name) + _axon_core_rules(assistant_language, "", all_blocks=True) + _axon_product_section(user) + AXON_STATIC_END + "\n"


def axon_split_static(system_message: str):
    """→ (static, rest) oppure (None, system_message_senza_sentinelle)."""
    a = system_message.find(AXON_STATIC_BEGIN); b = system_message.find(AXON_STATIC_END)
    if a < 0 or b < 0 or b < a:
        return None, system_message.replace(AXON_STATIC_BEGIN, "").replace(AXON_STATIC_END, "")
    static = system_message[a + len(AXON_STATIC_BEGIN):b]
    rest = (system_message[:a] + system_message[b + len(AXON_STATIC_END):]).lstrip("\n")
    return static, rest


@api_router.get("/axon/core/manifest")
async def axon_core_manifest():
    return {
        "name": "Axon Core", "version": AXON_CORE_VERSION,
        "products": [{"id": k, **v} for k, v in AXON_PRODUCTS.items()],
        "shared_endpoints": AXON_CORE_SHARED_ENDPOINTS,
        "data_model": {
            "private": "Spazio privato per utente/tenant (contatti, note, memoria personale, file, chat): mai condiviso tra utenti o prodotti.",
            "collective": "Apprendimento collettivo anonimo (regole di comportamento, feedback 👍/👎, risposte generali): condiviso tra tutti i prodotti, senza dati personali.",
        },
    }


@api_router.get("/axon/core/me")
async def axon_core_me(user=Depends(get_current_user)):
    p = _user_product(user)
    return {"product": p, **AXON_PRODUCTS[p], "core_version": AXON_CORE_VERSION}


class ProductIn(BaseModel):
    product: Literal["advisor", "lite"]


@api_router.get("/admin/axon-core/products")
async def axon_core_products(user=Depends(require_super_admin)):
    out = []
    for k, v in AXON_PRODUCTS.items():
        q = {"product": k} if k != AXON_DEFAULT_PRODUCT else {"$or": [{"product": k}, {"product": {"$exists": False}}, {"product": None}]}
        total = await db.users.count_documents(q)
        owners = await db.users.count_documents({**q, "parent_user_id": {"$in": [None, ""]}}) if k != AXON_DEFAULT_PRODUCT else await db.users.count_documents({"$and": [q, {"parent_user_id": {"$in": [None, ""]}}]})
        out.append({"id": k, "label": v["label"], "users": total, "owners": owners})
    return {"core_version": AXON_CORE_VERSION, "items": out}


@api_router.put("/admin/users/{user_id}/product")
async def axon_core_set_product(user_id: str, body: ProductIn, user=Depends(require_super_admin)):
    r = await db.users.update_one({"user_id": user_id}, {"$set": {"product": body.product}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    # collaboratori seguono l'owner
    await db.users.update_many({"parent_user_id": user_id}, {"$set": {"product": body.product}})
    return {"ok": True, "user_id": user_id, "product": body.product}


async def _axon_core_migrate_products():
    """Startup: utenti senza `product` → advisor (tutti gli esistenti sono AdvisorOS)."""
    try:
        r = await db.users.update_many({"product": {"$exists": False}}, {"$set": {"product": AXON_DEFAULT_PRODUCT}})
        if r.modified_count:
            logger.info(f"[axon-core] product=advisor impostato su {r.modified_count} utenti")
    except Exception as exc:
        logger.warning(f"[axon-core] migrazione product fallita: {exc}")
