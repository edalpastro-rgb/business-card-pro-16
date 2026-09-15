# ============================================================================
# V50.z259 — AxonOS NAVIGATOR: mappa completa dell'app con deep link
# ----------------------------------------------------------------------------
# PARTE 1 — APP_MAP: ogni schermata/sezione con route navigabile + keyword.
# PARTE 2 — Regola prioritaria nel system prompt: "prima cerca la funzione, poi
#           rispondi con [[NAV:<route>|<etichetta>]]"; il frontend rende i
#           marker come pulsanti (AssistantChat → NavChips).
# PARTE 3 — Flussi multi-step deterministici (intercept prima dell'LLM):
#           "devo andare da X", "sposta i mancati a domani", "ho perso il filo",
#           "devo organizzarmi". Azioni confermabili via [[ACTION:id|label|json]].
# PARTE 4 — Comportamenti proattivi: GET /axon/nav/proactive analizza l'uso
#           (giro ottimale, ritelefonate, scanner, GPS visite) e suggerisce.
# PARTE 5 — Linguaggio vago → mapping deterministico + hint per l'LLM.
# ============================================================================
import re as _nav_re
import json as _nav_json
from datetime import timedelta as _nav_td

_NAV_MARK = "[[NAV:{route}|{label}]]"


def _nav(route: str, label: str) -> str:
    return _NAV_MARK.format(route=route, label=label)


def _act(action: str, label: str, payload: dict) -> str:
    return f"[[ACTION:{action}|{label}|{_nav_json.dumps(payload, ensure_ascii=False)}]]"


# ---------------------------------------------------------------------------
# PARTE 1 — MAPPA COMPLETA (id, nome, route, gruppo, descrizione, keyword)
# ---------------------------------------------------------------------------
APP_MAP: list = [
    # ── HOME ──
    dict(id="home", name="Home", route="/home", group="Home", desc="Panoramica del giorno: promemoria, PUN, ritelefonate, appuntamenti, azioni rapide, scadenze, statistiche.", kw=["home", "inizio", "schermata principale", "panoramica"]),
    dict(id="home_promemoria", name="Promemoria e widget", route="/home?section=widgets", group="Home", desc="Widget in alto nella Home: promemoria, meteo, compleanni, PUN.", kw=["promemoria", "widget", "meteo home", "compleanni"]),
    dict(id="home_pun", name="PUN (prezzo energia)", route="/home?section=widgets", group="Home", desc="Widget PUN medio mensile e per fasce F1/F2/F3.", kw=["pun", "prezzo unico nazionale", "prezzo energia", "fasce"]),
    dict(id="home_ritelefonate", name="Ritelefonate di oggi", route="/home?section=ritelefonate", group="Home", desc="Elenco delle chiamate da fare oggi (ritelefonate) con esito.", kw=["ritelefonate", "richiamare", "richiamo", "chiamate da fare", "callback", "telefonate"]),
    dict(id="callback_nuova", name="Nuova ritelefonata", route="/callback/new", group="Home", desc="Programma una ritelefonata (chi, quando, motivo).", kw=["nuova ritelefonata", "programma chiamata", "impostare ritelefonata", "ricordami di chiamare"]),
    dict(id="home_appuntamenti", name="Appuntamenti di oggi", route="/home?section=appuntamenti", group="Home", desc="Appuntamenti del giorno con esito e navigazione.", kw=["appuntamenti di oggi", "agenda di oggi", "oggi"]),
    dict(id="home_azioni", name="Azioni rapide", route="/home?section=azioni", group="Home", desc="Pulsanti rapidi personalizzabili (nuovo contatto, appuntamento, scanner…).", kw=["azioni rapide", "scorciatoie", "pulsanti rapidi"]),
    dict(id="quick_actions_config", name="Configura azioni rapide", route="/quick-actions", group="Home", desc="Scegli quali azioni rapide mostrare in Home.", kw=["configura azioni rapide", "personalizza azioni"]),
    dict(id="home_scadenze", name="Scadenze", route="/home?section=scadenze", group="Home", desc="Scadenze contratti/documenti in arrivo.", kw=["scadenze", "scadenza contratto", "in scadenza", "rinnovi"]),
    dict(id="deadlines", name="Tutte le scadenze", route="/deadlines", group="Home", desc="Lista completa delle scadenze con filtri.", kw=["tutte le scadenze", "elenco scadenze"]),
    dict(id="home_statistiche", name="Dashboard statistiche", route="/home?section=statistiche", group="Home", desc="KPI personali: appuntamenti, esiti, contratti, andamento.", kw=["statistiche", "dashboard", "kpi", "come sto andando", "risultati", "andamento", "numeri"]),
    dict(id="dashboard_config", name="Configura dashboard", route="/dashboard-config", group="Home", desc="Scegli quali widget/statistiche vedere in Home.", kw=["configura dashboard", "personalizza home", "widget home"]),
    dict(id="home_comunica", name="Comunica con l'Azienda", route="/home?section=comunica", group="Home", desc="Invia una comunicazione/richiesta alla tua azienda (Master).", kw=["comunica con l'azienda", "scrivere all'azienda", "contattare azienda", "richiesta azienda"]),
    dict(id="master", name="Interfaccia Master", route="/master", group="Home", desc="Area Master: agenda team, contatti aziendali, contratti, comunicazioni.", kw=["interfaccia master", "master", "area master"], master_only=True),
    # ── CONTATTI ──
    dict(id="contatti", name="Contatti", route="/contatti", group="Contatti", desc="Lista clienti e prospect con ricerca e filtri.", kw=["contatti", "clienti", "anagrafica", "rubrica", "lista clienti", "cercare cliente"]),
    dict(id="contatto_nuovo", name="Nuovo contatto", route="/contact/new", group="Contatti", desc="Aggiungi un cliente a mano.", kw=["nuovo contatto", "aggiungi cliente", "nuovo cliente", "inserire cliente", "creare contatto"]),
    dict(id="contatto_scheda", name="Scheda contatto", route="/contact/{id}", group="Contatti", desc="Dettaglio cliente: info, note, file, fatture, audio, chiamate, appuntamenti, visite, referenze.", kw=["scheda cliente", "scheda contatto", "dettaglio cliente"]),
    dict(id="contatto_visite", name="Storico visite del contatto", route="/contact/{id}?tab=visits", group="Contatti", desc="Visite registrate (manuali e GPS) per il cliente.", kw=["storico visite", "visite cliente", "ultima visita", "quando sono stato"]),
    dict(id="contatto_note", name="Note del contatto", route="/contact/{id}?tab=notes", group="Contatti", desc="Note testuali sul cliente.", kw=["note cliente", "appunti cliente", "scrivere nota"]),
    dict(id="contatto_contratti", name="Fatture e contratti del contatto", route="/contact/{id}?tab=bills", group="Contatti", desc="Bollette analizzate e contratti associati al cliente.", kw=["contratti cliente", "bollette cliente", "fatture cliente"]),
    dict(id="contatto_ripasso", name="Frequenza ripasso", route="/contact/edit/{id}", group="Contatti", desc="Imposta ogni quanti giorni rivisitare il cliente (ripasso).", kw=["frequenza ripasso", "ripasso", "ogni quanto visitare", "rivisitare"]),
    dict(id="mappa_clienti", name="Mappa clienti", route="/map-clients", group="Contatti", desc="Clienti su mappa, filtri per stato/città/area e 'non visitati da'.", kw=["mappa clienti", "clienti sulla mappa", "non visitati", "vicino a me"]),
    dict(id="import_contatti", name="Importa contatti", route="/contacts-import", group="Contatti", desc="Importa contatti da CSV/rubrica.", kw=["importa contatti", "import csv", "rubrica telefono"]),
    dict(id="gruppi", name="Gruppi contatti", route="/groups", group="Contatti", desc="Organizza i clienti in gruppi.", kw=["gruppi", "gruppo clienti", "categorie clienti"]),
    dict(id="leads", name="Lead", route="/leads", group="Contatti", desc="Potenziali clienti da lavorare.", kw=["lead", "potenziali clienti", "prospect"]),
    dict(id="business_card", name="Biglietto da visita digitale", route="/business-card", group="Contatti", desc="Il tuo biglietto da visita digitale da condividere.", kw=["mio biglietto da visita", "biglietto digitale", "condividi contatto"]),
    # ── CALENDARIO ──
    dict(id="calendario", name="Calendario", route="/calendario", group="Calendario", desc="Vista mensile con appuntamenti, ritelefonate, esiti.", kw=["calendario", "agenda", "appuntamenti", "vista mensile", "mese"]),
    dict(id="calendario_settimana", name="Calendario settimanale", route="/calendario?view=week", group="Calendario", desc="Vista settimanale/giornaliera.", kw=["settimana", "vista settimanale", "vista giornaliera", "giornata"]),
    dict(id="calendario_anno", name="Calendario annuale", route="/calendario?view=year", group="Calendario", desc="Vista annuale.", kw=["anno", "vista annuale"]),
    dict(id="appuntamento_nuovo", name="Nuovo appuntamento", route="/appointment/new", group="Calendario", desc="Crea un appuntamento (cliente, data, ora, area).", kw=["nuovo appuntamento", "fissare appuntamento", "prendere appuntamento", "pianifica appuntamento"]),
    dict(id="appuntamenti_mancati", name="Appuntamenti mancati", route="/calendario?view=week", group="Calendario", desc="Appuntamenti passati senza esito: chiedi ad Axon 'sposta i mancati di oggi a domani'.", kw=["appuntamenti mancati", "mancati", "saltati", "non fatti", "riprogrammare"]),
    dict(id="appuntamenti_stats", name="Statistiche appuntamenti", route="/appointment-stats", group="Calendario", desc="Esiti e conversioni degli appuntamenti.", kw=["statistiche appuntamenti", "esiti", "conversioni"]),
    dict(id="ripassi", name="Ripassi in scadenza", route="/map-clients", group="Calendario", desc="Clienti da rivisitare (frequenza ripasso superata): chiedi ad Axon 'chi devo rivisitare'.", kw=["ripassi", "da rivisitare", "ripasso scaduto", "clienti da rivedere"]),
    # ── AXON ──
    dict(id="axon_hub", name="Axon Hub", route="/axon-hub", group="AxonOS", desc="Centro di controllo di Axon: memoria, allarmi, integrazioni, insegnamenti.", kw=["axon hub", "centro axon", "impostazioni axon"]),
    dict(id="axon_memory", name="Memoria di Axon", route="/axon-memory", group="AxonOS", desc="Cosa Axon ha memorizzato su di te e sui tuoi clienti.", kw=["memoria", "cosa ricordi", "memorizzato"]),
    dict(id="ai_teach", name="Insegna ad Axon", route="/ai-teach", group="AxonOS", desc="Insegna regole e conoscenze personalizzate.", kw=["insegna", "addestra", "regole axon", "impara"]),
    dict(id="axon_alarms", name="Allarmi e promemoria Axon", route="/axon-alarms", group="AxonOS", desc="Allarmi vocali/promemoria impostati con Axon.", kw=["allarmi", "sveglia", "promemoria axon", "ricordami"]),
    dict(id="axon_alerts", name="Avvisi Axon", route="/axon-alerts", group="AxonOS", desc="Avvisi proattivi (scadenze, clienti trascurati, meteo).", kw=["avvisi", "alert", "notifiche axon"]),
    dict(id="voice_copilot", name="Copilota vocale", route="/voice-copilot", group="AxonOS", desc="Modalità vocale continua a mani libere.", kw=["copilota", "vocale", "mani libere", "guida"]),
    dict(id="my_audios", name="I miei audio", route="/my-audios", group="AxonOS", desc="Registrazioni audio e trascrizioni.", kw=["audio", "registrazioni", "trascrizioni", "vocali"]),
    dict(id="chat_team", name="Chat Team", route="/chat", group="AxonOS", desc="Chat interna con collaboratori/azienda.", kw=["chat team", "messaggi team", "chat interna", "scrivere ai collaboratori"]),
    # ── AXON DRIVE ──
    dict(id="giro_ottimale", name="Giro ottimale (Axon Drive)", route="/optimal-route", group="Axon Drive", desc="Seleziona fino a 10 clienti, calcola il percorso migliore, orari stimati, apri navigatore (Google Maps/Waze/Apple).", kw=["giro ottimale", "giro", "percorso", "ottimizza", "axon drive", "itinerario", "tappe", "navigatore"]),
    dict(id="navigazione_cliente", name="Naviga verso un cliente", route="/optimal-route?contacts={id}", group="Axon Drive", desc="Apri Axon Drive con il cliente già selezionato.", kw=["naviga", "portami da", "indicazioni", "come arrivo"]),
    dict(id="resoconto_km", name="Resoconto km", route="/km-report", group="Axon Drive", desc="Km percorsi per visita/periodo, esportabile in PDF.", kw=["km", "chilometri", "resoconto km", "rimborso km", "quanti km"]),
    dict(id="meteo", name="Meteo", route="/meteo", group="Axon Drive", desc="Previsioni meteo per la zona dei clienti.", kw=["meteo", "che tempo fa", "previsioni", "pioggia"]),
    # ── FATTURE E SCANNER ──
    dict(id="fatture", name="Analisi fatture", route="/bill-quick", group="Fatture e Scanner", desc="Lista fatture analizzate e nuova analisi: fotografa la bolletta, confronto offerte, PDF per il cliente.", kw=["fatture", "bollette", "analisi fattura", "analizza bolletta", "confronto offerte", "risparmio", "nuova fattura"]),
    dict(id="fatture_config", name="Configurazione analisi fatture", route="/bill-quick?config=1", group="Fatture e Scanner", desc="Campi da estrarre, regole di confronto, preset (Domestico/Business), stile anteprima.", kw=["configurazione fatture", "preset", "regole confronto", "campi fattura", "stile confronto"]),
    dict(id="scanner", name="Scanner documenti / OCR", route="/scanner", group="Fatture e Scanner", desc="Scansiona biglietti da visita, documenti e bollette con la fotocamera (OCR).", kw=["scanner", "scansiona", "fotografa", "ocr", "biglietto da visita", "documento", "fotocamera"]),
    dict(id="documenti_axon", name="Documenti Axon", route="/documenti-axon", group="Fatture e Scanner", desc="Documenti generati e salvati da Axon.", kw=["documenti axon", "documenti generati", "pdf salvati"]),
    dict(id="master_files", name="Archivio file", route="/master-files", group="Fatture e Scanner", desc="Archivio documenti (listini, moduli, PDF) condivisi dal Master.", kw=["archivio", "file", "documenti", "listini", "moduli", "materiale"]),
    dict(id="google_drive", name="Google Drive", route="/google-drive", group="Fatture e Scanner", desc="Collega e sfoglia il tuo Google Drive.", kw=["google drive", "drive"]),
    dict(id="dropbox", name="Dropbox", route="/dropbox", group="Fatture e Scanner", desc="Collega e sfoglia Dropbox.", kw=["dropbox"]),
    dict(id="spazio_personale", name="Spazio personale", route="/spazio-personale", group="Fatture e Scanner", desc="I tuoi file personali.", kw=["spazio personale", "miei file", "cartella personale"]),
    # ── CASELLE MAIL ──
    dict(id="mail_accounts", name="Caselle mail", route="/email-accounts", group="Caselle Mail", desc="Aggiungi caselle email (IMAP/SMTP), posta in arrivo e in uscita, proposte CRM dalle mail.", kw=["caselle mail", "email", "posta", "in arrivo", "in uscita", "account email", "imap"]),
    dict(id="smtp", name="Configurazione SMTP", route="/smtp", group="Caselle Mail", desc="Server di invio email (SMTP) per inviare PDF e comunicazioni.", kw=["smtp", "server invio", "configurare email", "inviare email"]),
    dict(id="mail_proposals", name="Proposte CRM dalle mail", route="/mail-crm-proposals", group="Caselle Mail", desc="Contatti/appuntamenti suggeriti da Axon leggendo le email.", kw=["proposte mail", "email in crm", "suggerimenti mail"]),
    dict(id="outlook", name="Outlook", route="/outlook", group="Caselle Mail", desc="Collega Microsoft Outlook.", kw=["outlook", "microsoft"]),
    # ── HELP ──
    dict(id="help", name="Help", route="/help", group="Help", desc="Aiuto: libretto, manuale PDF, segnala bug/idea, privacy, tour.", kw=["help", "aiuto", "supporto", "assistenza"]),
    dict(id="libretto", name="Libretto informativo", route="/libretto", group="Help", desc="Guida a tutte le funzioni dell'app, scaricabile in PDF (manuale).", kw=["libretto", "manuale", "guida", "istruzioni", "scarica manuale", "pdf manuale"]),
    dict(id="segnala", name="Segnala bug / idea", route="/help-center", group="Help", desc="Invia un ticket: problema, idea, richiesta privacy.", kw=["segnala", "bug", "problema", "idea", "suggerimento", "ticket", "non funziona"]),
    dict(id="tour", name="Tour guidato", route="/tour", group="Help", desc="Tour conversazionale iniziale con Axon.", kw=["tour", "tutorial", "onboarding", "rifare il tour"]),
    dict(id="funzioni", name="Tutte le funzioni", route="/tour-features", group="Help", desc="Elenco completo delle funzioni per gruppo.", kw=["tutte le funzioni", "cosa sa fare", "elenco funzioni", "cosa posso fare"]),
    # ── PROFILO / IMPOSTAZIONI ──
    dict(id="impostazioni", name="Profilo e impostazioni", route="/impostazioni", group="Profilo", desc="Hub impostazioni: profilo, preferenze, notifiche, sicurezza, abbonamento, Axon, integrazioni.", kw=["impostazioni", "profilo", "settings", "configurazione", "preferenze"]),
    dict(id="profilo_dati", name="Dati personali", route="/impostazioni?section=general", group="Profilo", desc="Nome, foto, telefono, firma, lingua.", kw=["dati personali", "il mio nome", "foto profilo", "telefono", "firma"]),
    dict(id="preferenze", name="Preferenze generali", route="/impostazioni?section=general", group="Profilo", desc="Lingua, tema, comportamento generale.", kw=["preferenze generali", "lingua", "tema"]),
    dict(id="notifiche", name="Notifiche", route="/axon-notifications?tab=prefs", group="Profilo", desc="Push, promemoria, copie team, livelli di urgenza, orari silenziosi.", kw=["notifiche", "push", "avvisi telefono", "suoni", "non disturbare"]),
    dict(id="sicurezza", name="Sicurezza", route="/impostazioni?section=security", group="Profilo", desc="Password, 2FA, sessioni, PIN.", kw=["sicurezza", "password", "2fa", "autenticazione", "pin", "cambiare password"]),
    dict(id="abbonamento", name="Abbonamento", route="/impostazioni?section=billing", group="Profilo", desc="Piano attivo, fatturazione, upgrade.", kw=["abbonamento", "piano", "pagamento", "fattura app", "upgrade", "premium"]),
    dict(id="gps_visite", name="Rilevamento GPS visite", route="/impostazioni?section=general", group="Profilo", desc="Attiva il rilevamento automatico delle visite (soglie minuti/metri).", kw=["rilevamento gps", "gps", "visite automatiche", "rilevamento visite", "geolocalizzazione"]),
    dict(id="conferma_visite", name="Modalità conferma visite", route="/impostazioni?section=general", group="Profilo", desc="Popup in tempo reale oppure riepilogo a fine giornata.", kw=["conferma visite", "popup visite", "riepilogo fine giornata", "modalità visite"]),
    dict(id="axon_settings", name="Impostazioni Axon", route="/impostazioni?section=axon", group="Profilo", desc="Nome assistente, voce, modalità risposta (breve/dettagliata).", kw=["voce axon", "nome assistente", "modalità risposta", "cambia nome", "voce"]),
    dict(id="integrazioni", name="Integrazioni", route="/axon-integrations", group="Profilo", desc="Collega servizi esterni (Drive, Dropbox, Outlook, Home Assistant, Telegram…).", kw=["integrazioni", "collega", "servizi esterni", "telegram", "home assistant"]),
    dict(id="aree", name="Le mie aree", route="/le-mie-aree", group="Profilo", desc="Aree merceologiche degli appuntamenti (Energia, Piano Marketing…).", kw=["aree", "aree merceologiche", "tipo appuntamento", "categorie appuntamento"]),
    dict(id="campi_custom", name="Campi personalizzati", route="/custom-fields", group="Profilo", desc="Campi extra nella scheda contatto.", kw=["campi personalizzati", "campi extra", "campo custom"]),
    dict(id="wizard", name="Wizard configurazione", route="/setup", group="Profilo", desc="Configurazione guidata iniziale (Parla a Neo).", kw=["wizard", "configurazione guidata", "parla a neo", "setup"]),
    dict(id="spese", name="Spese", route="/axon-expenses", group="Profilo", desc="Registro spese e rimborsi.", kw=["spese", "rimborsi", "nota spese", "scontrini"]),
    dict(id="report", name="Report", route="/report", group="Profilo", desc="Report attività e performance.", kw=["report", "resoconto attività", "riepilogo mensile"]),
    # ── MASTER ──
    dict(id="master_agenda", name="Agenda team (Master)", route="/master", group="Master", desc="Agenda di tutti i collaboratori.", kw=["agenda team", "appuntamenti collaboratori", "agenda squadra"], master_only=True),
    dict(id="anagrafica_master", name="Contatti aziendali (Master)", route="/anagrafica-master", group="Master", desc="Anagrafica clienti dell'intera azienda.", kw=["contatti aziendali", "anagrafica master", "clienti azienda"], master_only=True),
    dict(id="contratti", name="Contratti (Master)", route="/master", group="Master", desc="Contratti caricati dai collaboratori, stati e commissioni.", kw=["contratti", "caricare contratto", "stato contratto", "commissioni"], master_only=True),
    dict(id="contratto_nuovo", name="Nuovo contratto", route="/contract/new", group="Master", desc="Carica un nuovo contratto.", kw=["nuovo contratto", "inserire contratto"]),
    dict(id="comunicazioni_azienda", name="Comunicazioni azienda (Master)", route="/master", group="Master", desc="Invia comunicazioni/banner ai collaboratori.", kw=["comunicazioni", "avviso ai collaboratori", "circolare", "banner"], master_only=True),
    dict(id="team", name="Team", route="/team", group="Master", desc="Gestione collaboratori, ruoli, aree.", kw=["team", "collaboratori", "squadra", "ruoli"], master_only=True),
    dict(id="invita", name="Invita collaboratore", route="/invite-collaborator", group="Master", desc="Invita un nuovo collaboratore.", kw=["invita", "aggiungi collaboratore", "nuovo collaboratore"], master_only=True),
    dict(id="team_insights", name="Team insights", route="/team-insights", group="Master", desc="KPI e confronto collaboratori.", kw=["team insights", "kpi team", "confronto collaboratori", "classifica"], master_only=True),
    dict(id="cruscotto", name="Cruscotto", route="/cruscotto", group="Master", desc="Cruscotto direzionale aziendale.", kw=["cruscotto", "direzionale", "andamento azienda"], master_only=True),
    dict(id="corporate_gym", name="Corporate Gym", route="/corporate-gym", group="Master", desc="Formazione e allenamento del team.", kw=["formazione", "corporate gym", "allenamento", "training"], master_only=True),
    dict(id="personalizzazione", name="Personalizzazione aziendale", route="/personalizzazione-aziendale", group="Master", desc="Logo, colori, nome azienda.", kw=["personalizzazione", "logo azienda", "colori", "branding"], master_only=True),
]

_NAV_BY_ID = {e["id"]: e for e in APP_MAP}

# PARTE 5 — mapping linguaggio vago → id funzione (hint per l'LLM)
VAGUE_MAP = [
    ("mi sono perso / non so da dove iniziare", ["contatto_nuovo", "appuntamento_nuovo", "callback_nuova", "axon_hub"]),
    ("voglio sapere come sto andando", ["home_statistiche"]),
    ("devo richiamare qualcuno", ["home_ritelefonate", "callback_nuova"]),
    ("dove metto i documenti", ["master_files", "scanner", "fatture"]),
    ("devo andare da un cliente", ["navigazione_cliente", "meteo"]),
    ("ho perso il filo con alcuni clienti", ["mappa_clienti", "giro_ottimale"]),
    ("devo organizzarmi", ["calendario_settimana", "ripassi", "giro_ottimale"]),
    ("come faccio a impostare X", ["impostazioni"]),
]


def _nav_norm(s: str) -> str:
    s = (s or "").lower()
    s = _nav_re.sub(r"[àá]", "a", s); s = _nav_re.sub(r"[èé]", "e", s); s = _nav_re.sub(r"[ìí]", "i", s)
    s = _nav_re.sub(r"[òó]", "o", s); s = _nav_re.sub(r"[ùú]", "u", s)
    return _nav_re.sub(r"[^a-z0-9 ]+", " ", s)


def _nav_match(msg: str, user: dict, limit: int = 3) -> list:
    """Keyword scoring: ritorna le voci APP_MAP più pertinenti al messaggio."""
    m = " " + _nav_norm(msg) + " "
    master = _nav_is_master(user)
    scored = []
    for e in APP_MAP:
        if e.get("master_only") and not master:
            continue
        score = 0
        for kw in e["kw"]:
            k = _nav_norm(kw).strip()
            if k and f" {k} " in m:
                score += 3 + len(k.split())
        for w in _nav_norm(e["name"]).split():
            if len(w) > 3 and f" {w} " in m:
                score += 1
        if score:
            scored.append((score, e))
    scored.sort(key=lambda x: -x[0])
    return [e for _, e in scored[:limit]]


def _nav_is_master(user: dict) -> bool:
    return not user.get("parent_user_id") and (user.get("role") or "member") == "owner"


def _nav_prompt_section(user: dict, msg: str) -> str:
    master = _nav_is_master(user)
    lines = [
        "🧭 NAVIGATORE APP — REGOLA PRIORITARIA",
        "Quando l'utente fa una domanda o descrive un bisogno: PRIMA controlla se una funzione dell'app (elenco sotto) lo risolve.",
        "Se sì → rispondi con 1-2 frasi che spiegano cosa fa la funzione e aggiungi il deep link nel formato ESATTO [[NAV:<route>|<etichetta breve>]] (uno per riga, in fondo, max 3). L'app lo trasforma in un pulsante che porta direttamente alla schermata.",
        "NON descrivere il percorso a parole (es. 'vai in Impostazioni → Generale'): usa sempre il marker. Se la route contiene {id}, sostituiscilo con il contact_id reale se lo conosci, altrimenti usa la lista (/contatti).",
        "Solo se NESSUNA funzione corrisponde al bisogno, rispondi in modo conversazionale senza marker.",
        "Bisogni vaghi/indiretti → interpreta e proponi la funzione: " + "; ".join(f"«{v}» → {', '.join(_NAV_BY_ID[i]['name'] for i in ids if i in _NAV_BY_ID)}" for v, ids in VAGUE_MAP) + ".",
        "«Come faccio a impostare/configurare X» → cerca X nell'elenco e porta direttamente alla configurazione.",
        "",
        "ELENCO SCHERMATE (nome · route · a cosa serve):",
    ]
    cur = None
    for e in APP_MAP:
        if e.get("master_only") and not master:
            continue
        if e["group"] != cur:
            cur = e["group"]; lines.append(f"[{cur}]")
        lines.append(f"- {e['name']} · {e['route']} · {e['desc']}")
    hints = _nav_match(msg, user)
    if hints:
        lines.append("")
        lines.append("SUGGERIMENTI PER QUESTO MESSAGGIO (probabile funzione cercata): " + " ".join(_nav(h["route"], h["name"]) for h in hints))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Wrapper del prompt: aggiunge la sezione NAVIGATORE al system message
# ---------------------------------------------------------------------------
_nav_prev_prepare = _prepare_assistant_prompt  # noqa: F821 — definita nei moduli precedenti


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _nav_prev_prepare(user, body)
    try:
        msg = getattr(body, "message", None) or (body.get("message") if isinstance(body, dict) else "") or ""
        section = _nav_prompt_section(user, msg)
        pro = await _nav_proactive_hints(user)
        if pro:
            section += "\n\nSUGGERIMENTO PROATTIVO (menzionalo solo se pertinente alla conversazione, con il suo marker): " + pro[0]["text"] + " " + _nav(pro[0]["route"], pro[0]["label"])
        if isinstance(prep, dict) and isinstance(prep.get("system_message"), str):
            prep["system_message"] = prep["system_message"] + "\n\n" + section
    except Exception as e:
        logger.warning("[NAV] prompt section failed: %s", e)
    return prep


# ---------------------------------------------------------------------------
# PARTE 3 + 5 — Intercettori deterministici (prima dell'LLM)
# ---------------------------------------------------------------------------
_RX_LOST = _nav_re.compile(r"\b(mi sono pers[oa]|non so (da dove|come) (iniziare|cominciare|partire|muovermi)|da dove (inizio|comincio|parto)|come (si usa|funziona) (l app|l'app|advisoros|questa app)|cosa (posso|so) fare (qui|con l'app|con l app))\b", _nav_re.I)
_RX_KPI = _nav_re.compile(r"\b(come sto andando|come (vanno|stanno andando) (le cose|gli affari|le vendite|i miei numeri)|(i miei|le mie) (numeri|risultati|kpi|statistiche)|voglio sapere come (sto|vado))\b", _nav_re.I)
_RX_CALLBACK = _nav_re.compile(r"\b(devo|dovrei|voglio|chi devo|ho da) richiamare\b|\bda richiamare\b|\bmostra(mi)? le ritelefonate\b|\bdove (sono|trovo|vedo) le ritelefonate\b", _nav_re.I)
_RX_DOCS = _nav_re.compile(r"\bdove (metto|carico|salvo|archivio|trovo|vedo|tengo) (i |le |la |il |un |una )?(documenti|file|pdf|bollette|fatture|contratti|listini|moduli)\b", _nav_re.I)
_RX_HOWTO = _nav_re.compile(r"\b(come (faccio|posso|si fa) (a |per )?(impostare|configurare|attivare|disattivare|cambiare|modificare|settare|abilitare|personalizzare)|dove (imposto|configuro|attivo|cambio|modifico|trovo l impostazione|trovo l'impostazione))\s+(?P<x>.{2,80})", _nav_re.I)
_RX_GOTO = _nav_re.compile(r"^\s*(devo|dovrei|vado|andro|andrò|sto andando|voglio andare|passo|passero|passerò|devo passare|devo andare|dovrei andare|dovrei passare)\s+(andare\s+|passare\s+)?(da|dal|dalla|dallo|dai|a trovare|a casa di|in ufficio da|dal cliente|dalla cliente)\s+(?P<name>[a-zA-ZÀ-ÿ'’\. ]{2,60})\s*[\.\!\?]*\s*$", _nav_re.I)
_RX_MISSED = _nav_re.compile(r"\b(sposta|spostare|spostami|rimanda|rimandare|riprogramma|riprogrammare|posticipa)\b.*\bappuntament\w*\b.*\b(mancat\w*|pers\w*|saltat\w*|non fatt\w*|non svolt\w*)\b|\bappuntament\w*\s+mancat\w*\b.*\b(sposta|rimanda|domani|riprogramma)\w*", _nav_re.I)
_RX_LOSTTOUCH = _nav_re.compile(r"\b(perso il filo|perso di vista|persi di vista|non (vedo|visito|sento|seguo) da (tanto|molto|tempo|un pezzo|mesi)|clienti (trascurati|dimenticati|abbandonati|che non visito)|chi non (visito|vedo|sento) da (tempo|mesi|tanto)|clienti non visitati)\b", _nav_re.I)
_RX_ORGANIZE = _nav_re.compile(r"\b(devo|voglio|vorrei|aiutami a|come faccio a|come posso) organizzar(mi|e)\b|\borganizzarmi meglio\b|\bmettere ordine\b|\bpianificare (la|questa) (settimana|giornata)\b|\bcome organizzo (la|questa) (settimana|giornata)\b", _nav_re.I)

_GENERIC_CLIENT = {"un cliente", "cliente", "il cliente", "un mio cliente", "qualcuno", "un cliente oggi", "una cliente"}


def _nav_reply(text: str) -> dict:
    return {"reply": text, "used_web_search": False, "nav": True}


def _nav_days_since(iso) -> "int | None":
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (utcnow() - dt).days
    except Exception:
        return None


def _nav_own(user: dict, extra: dict = None) -> dict:
    """Query appuntamenti/ritelefonate dell'utente: user_id = tenant; non-owner → solo propri/assegnati."""
    base = {"user_id": tenant_id(user)}  # noqa: F821
    if not is_owner(user):  # noqa: F821
        base["$or"] = [{"created_by": user["user_id"]}, {"assignee_user_id": user["user_id"]}, {"broadcast_to_user_ids": user["user_id"]}]
    if extra:
        base.update(extra)
    return base


def _nav_dt(v) -> "datetime | None":
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _nav_hhmm(v) -> str:
    dt = _nav_dt(v)
    return dt.strftime("%H:%M") if dt else ""


def _nav_cname(c: dict) -> str:
    n = f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip()
    return n or (c.get("company") or "Contatto")


async def _nav_find_contact(user: dict, name: str):
    q = await _omni_contact_query(user)  # noqa: F821
    name = _nav_re.sub(r"\b(il|la|lo|sig\.?|signor|signora|dott\.?|cliente)\b", " ", name, flags=_nav_re.I).strip()
    toks = [t for t in _nav_re.split(r"\s+", name) if len(t) >= 2]
    if not toks:
        return None
    ors = []
    for t in toks:
        rx = {"$regex": _nav_re.escape(t), "$options": "i"}
        ors += [{"first_name": rx}, {"last_name": rx}, {"company": rx}]
    q = {"$and": [q, {"$or": ors}]}
    best, best_score = None, 0
    async for c in db.contacts.find(q, {"_id": 0}).limit(25):  # noqa: F821
        hay = _nav_norm(_nav_cname(c) + " " + (c.get("company") or ""))
        score = sum(1 for t in toks if _nav_norm(t) in hay)
        if score > best_score:
            best, best_score = c, score
    return best


async def _nav_flow_goto(user: dict, name: str) -> dict:
    clean = name.strip().lower().rstrip(".!? ")
    if clean in _GENERIC_CLIENT:
        return _nav_reply(
            "Da quale cliente devi andare? Dimmi il nome (es. «devo andare da Rossi») e ti preparo meteo della zona e navigazione. "
            "Oppure scegli direttamente dalla lista:\n"
            + _nav("/optimal-route", "🚗 Apri Axon Drive") + "\n" + _nav("/contatti", "👥 Scegli il cliente"))
    c = await _nav_find_contact(user, name)
    if not c:
        return _nav_reply(f"Non trovo «{name.strip()}» in anagrafica. Controlla il nome oppure aggiungilo:\n" + _nav("/contatti", "👥 Cerca nei contatti") + "\n" + _nav("/contact/new", "➕ Nuovo contatto"))
    cname = _nav_cname(c)
    city = (c.get("address_city") or "").strip()
    addr = ", ".join(x for x in [c.get("address_street"), city] if x)
    lines = [f"Perfetto, andiamo da **{cname}**" + (f" ({addr})." if addr else ".")]
    alert = False
    if city:
        try:
            w = await _fetch_weather(city)  # noqa: F821
        except Exception:
            w = None
        if w and not w.get("error"):
            cur = w.get("adesso") or {}
            days = w.get("prossimi_giorni") or []
            today = days[0] if days else {}
            cond = cur.get("condizione") or ""
            temp = cur.get("temp_c")
            prob = today.get("prob_pioggia_max_pct") or 0
            lines.append(f"🌤️ Meteo a {city}: {cond}" + (f", {temp}°C" if temp is not None else "") + (f", probabilità pioggia oggi {int(prob)}%" if prob else "") + ".")
            cl = _nav_norm(cond)
            alert = prob >= 70 or any(k in cl for k in ["temporale", "neve", "grandine", "nebbia fitta", "pioggia forte", "burrasca"])
            if alert:
                lines.append("⚠️ Allerta meteo: valuta di spostare l'appuntamento.")
        else:
            lines.append(f"(Meteo per {city} non disponibile al momento.)")
    else:
        lines.append("Il contatto non ha una città: aggiungila in scheda per avere meteo e navigazione precisa.")
    marks = [_nav(f"/optimal-route?contacts={c['contact_id']}", f"🚗 Naviga verso {cname}")]
    if alert:
        appt = await db.appointments.find_one(_nav_own(user, {"contact_id": c["contact_id"], "start_at": {"$gte": utcnow()}, "done": {"$ne": True}}), {"_id": 0, "appointment_id": 1}, sort=[("start_at", 1)])  # noqa: F821
        marks.append(_nav(f"/appointment/{appt['appointment_id']}" if appt else "/calendario", "📅 Sposta l'appuntamento"))
    marks.append(_nav(f"/contact/{c['contact_id']}", "📇 Apri la scheda"))
    return _nav_reply("\n".join(lines) + "\n" + "\n".join(marks))


async def _nav_missed_today(user: dict) -> list:
    now = utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    q = _nav_own(user, {"start_at": {"$gte": day_start, "$lt": now}, "done": {"$ne": True}, "is_broadcast": {"$ne": True}})
    out = []
    async for a in db.appointments.find(q, {"_id": 0, "appointment_id": 1, "title": 1, "start_at": 1, "end_at": 1, "contact_id": 1}).sort("start_at", 1):  # noqa: F821
        end = _nav_dt(a.get("end_at"))
        if end and end > now:
            continue  # ancora in corso
        out.append(a)
    return out


async def _nav_flow_missed(user: dict) -> dict:
    missed = await _nav_missed_today(user)
    if not missed:
        return _nav_reply("Oggi non ho appuntamenti mancati da spostare: tutti quelli passati hanno un esito. 👍\n" + _nav("/calendario?view=week", "📅 Apri la settimana"))
    lines = [f"Ho trovato **{len(missed)}** appuntament{'o' if len(missed) == 1 else 'i'} di oggi senza esito. Li sposto a domani allo stesso orario:"]
    for a in missed:
        lines.append(f"• {_nav_hhmm(a.get('start_at'))} — {a.get('title') or 'Appuntamento'}")
    lines.append("Tocca il pulsante per confermare:")
    lines.append(_act("move_missed", f"✅ Sì, sposta {len(missed)} a domani", {"ids": [a["appointment_id"] for a in missed], "days": 1}))
    lines.append(_nav("/calendario?view=week", "📅 Prima guardo il calendario"))
    return _nav_reply("\n".join(lines))


async def _nav_stale_contacts(user: dict, min_days: int = 90, limit: int = 10) -> list:
    q = await _omni_contact_query(user)  # noqa: F821
    out = []
    async for c in db.contacts.find(q, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "address_city": 1, "last_visit_at": 1, "created_at": 1, "status": 1}).limit(2000):  # noqa: F821
        if (c.get("status") or "").lower() in {"perso", "lost", "chiuso"}:
            continue
        d = _nav_days_since(c.get("last_visit_at"))
        if d is None:
            dc = _nav_days_since(c.get("created_at"))
            if dc is not None and dc < min_days:
                continue  # cliente nuovo, mai visitato ma recente
            out.append((10_000, c))
        elif d >= min_days:
            out.append((d, c))
    out.sort(key=lambda x: -x[0])
    return [(d, c) for d, c in out[:limit]]


async def _nav_flow_losttouch(user: dict) -> dict:
    stale = await _nav_stale_contacts(user)
    if not stale:
        return _nav_reply("Ottimo: non ho clienti senza visite da oltre 90 giorni. Se vuoi controllare a colpo d'occhio:\n" + _nav("/map-clients", "📍 Mappa clienti"))
    lines = [f"Ecco i clienti che non visiti da più tempo ({len(stale)} oltre i 90 giorni):"]
    for d, c in stale:
        when = "mai visitato" if d >= 10_000 else f"{d} giorni"
        city = f" · {c['address_city']}" if c.get("address_city") else ""
        lines.append(f"• {_nav_cname(c)}{city} — {when}")
    ids = ",".join(c["contact_id"] for _, c in stale[:10])
    lines.append("Se vuoi, costruisco subito il giro ottimale per rivederli:")
    lines.append(_nav(f"/optimal-route?contacts={ids}", "🗺️ Costruisci il giro ottimale"))
    lines.append(_nav("/map-clients", "📍 Vedi sulla mappa"))
    return _nav_reply("\n".join(lines))


async def _nav_flow_organize(user: dict) -> dict:
    now = utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + _nav_td(days=1)
    n_today = await db.appointments.count_documents(_nav_own(user, {"start_at": {"$gte": day_start, "$lt": day_end}}))  # noqa: F821
    n_week = await db.appointments.count_documents(_nav_own(user, {"start_at": {"$gte": now, "$lt": day_start + _nav_td(days=7)}}))  # noqa: F821
    n_cb = await db.callbacks.count_documents(_nav_own(user, {"done": {"$ne": True}, "scheduled_at": {"$lt": day_end}}))  # noqa: F821
    try:
        due = await _cv_due_list(tenant_id(user), 10)  # noqa: F821
    except Exception:
        due = []
    lines = ["Ti aiuto a fare ordine. Ecco il quadro:"]
    lines.append(f"• Oggi: {n_today} appuntament{'o' if n_today == 1 else 'i'} · prossimi 7 giorni: {n_week}")
    lines.append(f"• Ritelefonate da fare: {n_cb}")
    if due:
        lines.append(f"• Ripassi in scadenza: {len(due)} client{'e' if len(due) == 1 else 'i'} da rivisitare (" + ", ".join(d["name"] for d in due[:4]) + ("…" if len(due) > 4 else "") + ")")
    else:
        lines.append("• Ripassi in scadenza: nessuno 👍")
    lines.append(_nav("/calendario?view=week", "📅 Apri la settimana"))
    if due:
        ids = ",".join(d["contact_id"] for d in due[:10])
        lines.append(_nav(f"/optimal-route?contacts={ids}", "🗺️ Giro ottimale per i ripassi"))
    if n_cb:
        lines.append(_nav("/home?section=ritelefonate", "📞 Ritelefonate di oggi"))
    return _nav_reply("\n".join(lines))


def _nav_flow_lost() -> dict:
    return _nav_reply(
        "Tranquillo, si parte da qui. Questi sono i 4 pilastri di AdvisorOS:\n"
        "1️⃣ Aggiungi i tuoi clienti\n2️⃣ Pianifica un appuntamento\n3️⃣ Programma le ritelefonate\n4️⃣ Parla con me per tutto il resto\n"
        + _nav("/contact/new", "➕ Aggiungi un cliente") + "\n"
        + _nav("/appointment/new", "📅 Pianifica un appuntamento") + "\n"
        + _nav("/callback/new", "📞 Imposta una ritelefonata") + "\n"
        + _nav("/tour-features", "🧭 Tutte le funzioni"))


async def _nav_flow_callbacks(user: dict) -> dict:
    day_end = utcnow().replace(hour=0, minute=0, second=0, microsecond=0) + _nav_td(days=1)
    cbs = await db.callbacks.find(_nav_own(user, {"done": {"$ne": True}, "scheduled_at": {"$lt": day_end}}), {"_id": 0, "contact_id": 1, "scheduled_at": 1, "note": 1}).sort("scheduled_at", 1).to_list(8)  # noqa: F821
    if cbs:
        lines = [f"Hai {len(cbs)} ritelefonat{'a' if len(cbs) == 1 else 'e'} da fare:"]
        for cb in cbs:
            c = await db.contacts.find_one({"contact_id": cb.get("contact_id")}, {"_id": 0, "first_name": 1, "last_name": 1, "company": 1}) if cb.get("contact_id") else None  # noqa: F821
            who = _nav_cname(c) if c else ""
            lines.append(f"• {_nav_hhmm(cb.get('scheduled_at'))} {who} — {cb.get('note') or ''}".rstrip(" —"))
    else:
        lines = ["Non hai ritelefonate in sospeso per oggi."]
    lines.append(_nav("/home?section=ritelefonate", "📞 Apri le ritelefonate"))
    lines.append(_nav("/callback/new", "➕ Nuova ritelefonata"))
    return _nav_reply("\n".join(lines))


def _nav_flow_docs(msg: str) -> dict:
    m = _nav_norm(msg)
    if any(k in m for k in ["bollett", "fattur", "contratt"]):
        return _nav_reply("Le bollette si fotografano e analizzano in **Analisi fatture**; restano poi nella scheda del cliente (tab Fatture). I contratti li carichi da **Nuovo contratto**.\n"
                          + _nav("/bill-quick", "🧾 Analisi fatture") + "\n" + _nav("/scanner", "📷 Scanner") + "\n" + _nav("/contract/new", "📄 Nuovo contratto"))
    return _nav_reply("I documenti condivisi dall'azienda sono nell'**Archivio file**; i tuoi file personali nello **Spazio personale**; per digitalizzare un foglio usa lo **Scanner**.\n"
                      + _nav("/master-files", "🗂️ Archivio file") + "\n" + _nav("/spazio-personale", "📁 Spazio personale") + "\n" + _nav("/scanner", "📷 Scanner"))


def _nav_flow_howto(user: dict, x: str) -> "dict | None":
    hits = _nav_match(x, user, limit=3)
    if not hits:
        return None
    top = hits[0]
    txt = f"**{top['name']}** — {top['desc']}\n" + _nav(top["route"], f"⚙️ Apri {top['name']}")
    for h in hits[1:]:
        txt += "\n" + _nav(h["route"], h["name"])
    return _nav_reply(txt)


async def _nav_intercept(msg: str, user: dict):
    """Intercettore NAVIGATORE (flussi multi-step + linguaggio vago). None se non matcha."""
    try:
        t = (msg or "").strip()
        if not (3 <= len(t) <= 220):
            return None
        m = _RX_GOTO.match(t)
        if m:
            return await _nav_flow_goto(user, m.group("name"))
        if _RX_MISSED.search(t):
            return await _nav_flow_missed(user)
        if _RX_LOSTTOUCH.search(t):
            return await _nav_flow_losttouch(user)
        if _RX_ORGANIZE.search(t):
            return await _nav_flow_organize(user)
        if _RX_LOST.search(t):
            return _nav_flow_lost()
        if _RX_KPI.search(t):
            txt = "Ecco dove vedi come stai andando: la dashboard in Home riassume appuntamenti, esiti e contratti."
            txt += "\n" + _nav("/home?section=statistiche", "📊 Dashboard statistiche") + "\n" + _nav("/appointment-stats", "📈 Esiti appuntamenti")
            if _nav_is_master(user):
                txt += "\n" + _nav("/cruscotto", "🏢 Cruscotto aziendale")
            return _nav_reply(txt)
        if _RX_CALLBACK.search(t):
            return await _nav_flow_callbacks(user)
        if _RX_DOCS.search(t):
            return _nav_flow_docs(t)
        hm = _RX_HOWTO.search(t)
        if hm:
            return _nav_flow_howto(user, hm.group("x"))
    except Exception as e:
        logger.warning("[NAV] intercept failed: %s", e)
    return None


_nav_prev_push = _maybe_push_command  # noqa: F821


async def _maybe_push_command(msg: str, user: dict):  # noqa: F811
    """Stream: prova prima il Navigatore, poi la catena precedente (push/neo)."""
    r = await _nav_intercept(msg, user)
    if r:
        return r
    return await _nav_prev_push(msg, user)


# Endpoint non-stream /assistant/chat: ri-registrato per applicare lo stesso intercettore
_nav_orig_chat = None
for _r in list(api_router.routes):
    if getattr(_r, "path", "").endswith("/assistant/chat") and "POST" in (getattr(_r, "methods", None) or set()):
        _nav_orig_chat = _r.endpoint
        api_router.routes.remove(_r)
        break

if _nav_orig_chat is not None:
    @api_router.post("/assistant/chat")
    async def assistant_chat(body: AssistantChatIn, user=Depends(get_current_user)):  # noqa: F811
        r = await _nav_intercept(body.message or "", user)
        if r and r.get("reply") is not None:
            sid = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"
            mid = uuid.uuid4().hex[:16]
            try:
                await db.assistant_messages.insert_many([
                    {"user_id": user["user_id"], "session_id": sid, "role": "user", "content": body.message or "", "created_at": utcnow()},
                    {"message_id": mid, "user_id": user["user_id"], "session_id": sid, "role": "assistant", "content": r["reply"], "created_at": utcnow()},
                ])
            except Exception:
                pass
            return {"session_id": sid, "message_id": mid, "reply": r["reply"], "used_web_search": False, "web_sources": [], "nav": True}
        return await _nav_orig_chat(body, user)


# ---------------------------------------------------------------------------
# Azioni confermabili (frontend → POST /axon/nav/action)
# ---------------------------------------------------------------------------
class NavActionIn(BaseModel):
    action: str
    payload: dict = {}
    session_id: Optional[str] = None


@api_router.post("/axon/nav/action")
async def nav_action(body: NavActionIn, user=Depends(get_current_user)):
    if body.action == "move_missed":
        ids = [str(i) for i in (body.payload.get("ids") or [])][:50]
        days = int(body.payload.get("days") or 1)
        moved = 0
        async for a in db.appointments.find(_nav_own(user, {"appointment_id": {"$in": ids}}), {"_id": 0, "appointment_id": 1, "start_at": 1, "end_at": 1}):
            upd = {}
            for k in ("start_at", "end_at"):
                dt = _nav_dt(a.get(k))
                if dt:
                    upd[k] = dt + _nav_td(days=days)
            if upd:
                upd["updated_at"] = utcnow()
                await db.appointments.update_one({"appointment_id": a["appointment_id"]}, {"$set": upd})
                moved += 1
        reply = f"✅ Fatto: ho spostato {moved} appuntament{'o' if moved == 1 else 'i'} a domani allo stesso orario.\n" + _nav("/calendario?view=week", "📅 Vedi la settimana")
    else:
        raise HTTPException(status_code=400, detail="Azione non riconosciuta")
    if body.session_id:
        try:
            await db.assistant_messages.insert_one({"user_id": user["user_id"], "session_id": body.session_id, "role": "assistant", "content": reply, "created_at": utcnow()})
        except Exception:
            pass
    return {"reply": reply}


# ---------------------------------------------------------------------------
# PARTE 4 — Comportamenti proattivi
# ---------------------------------------------------------------------------
class NavTrackIn(BaseModel):
    feature: str


@api_router.post("/axon/nav/track")
async def nav_track(body: NavTrackIn, user=Depends(get_current_user)):
    f = (body.feature or "").strip()[:80]
    if not f:
        raise HTTPException(status_code=400, detail="feature mancante")
    await db.feature_usage.update_one({"user_id": user["user_id"], "feature": f}, {"$inc": {"count": 1}, "$set": {"last_at": utcnow().isoformat()}}, upsert=True)
    return {"ok": True}


_NAV_HINT_COOLDOWN_DAYS = 14


async def _nav_proactive_hints(user: dict) -> list:
    uid = user["user_id"]
    us = await db.user_settings.find_one({"user_id": uid}, {"_id": 0, "nav_hints_dismissed": 1, "visit_detection": 1}) or {}
    dismissed = us.get("nav_hints_dismissed") or {}

    def _ok(hid: str) -> bool:
        d = _nav_days_since(dismissed.get(hid))
        return d is None or d >= _NAV_HINT_COOLDOWN_DAYS

    cq = await _omni_contact_query(user)  # noqa: F821
    n_contacts = await db.contacts.count_documents(cq)
    n_with_addr = await db.contacts.count_documents({"$and": [cq, {"address_city": {"$nin": [None, ""]}}]}) if n_contacts else 0
    used = {u["feature"] async for u in db.feature_usage.find({"user_id": uid}, {"_id": 0, "feature": 1})}
    hints = []
    if n_with_addr >= 3 and "optimal_route" not in used and _ok("route"):
        if await db.geo_routes.count_documents({"created_by": uid}) == 0:
            hints.append(dict(id="route", text="Ho notato che pianifichi gli appuntamenti uno per uno. Sapevi che puoi ottimizzare tutto il giro in un tap?", route="/optimal-route", label="🗺️ Prova il Giro ottimale"))
    if _ok("callbacks"):
        n_appts = await db.appointments.count_documents(_nav_own(user))
        if n_appts >= 1 and await db.callbacks.count_documents(_nav_own(user)) == 0:
            hints.append(dict(id="callbacks", text="Hai appuntamenti ma nessuna ritelefonata programmata. Vuoi che ti aiuti a impostarle?", route="/callback/new", label="📞 Imposta una ritelefonata"))
    if n_contacts >= 1 and "scanner" not in used and _ok("scanner"):
        hints.append(dict(id="scanner", text="Puoi aggiungere clienti fotografando il loro biglietto da visita. Vuoi provare?", route="/scanner", label="📷 Apri lo Scanner"))
    if n_with_addr >= 3 and not (us.get("visit_detection") or {}).get("enabled") and _ok("gps"):
        hints.append(dict(id="gps", text="Posso registrare automaticamente le visite ai clienti tramite GPS. Vuoi attivarlo?", route="/impostazioni?section=general", label="📍 Attiva rilevamento visite"))
    return hints


@api_router.get("/axon/nav/proactive")
async def nav_proactive(user=Depends(get_current_user)):
    return {"hints": await _nav_proactive_hints(user)}


class NavDismissIn(BaseModel):
    id: str


@api_router.post("/axon/nav/proactive/dismiss")
async def nav_proactive_dismiss(body: NavDismissIn, user=Depends(get_current_user)):
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {f"nav_hints_dismissed.{body.id}": utcnow().isoformat()}}, upsert=True)
    return {"ok": True}


@api_router.get("/axon/nav/map")
async def nav_map(user=Depends(get_current_user)):
    master = _nav_is_master(user)
    return {"items": [{k: e[k] for k in ("id", "name", "route", "group", "desc")} for e in APP_MAP if master or not e.get("master_only")]}


# ---------------------------------------------------------------------------
# Una tantum: le risposte in cache semantica precedenti al Navigatore non hanno
# i deep link → si invalidano al primo avvio (flag in app_meta).
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def _nav_startup():
    try:
        flag = await db.app_meta.find_one({"key": "nav_semcache_purged_v1"})
        if not flag:
            res = await db.axon_semantic_cache.update_many({}, {"$set": {"expires_at": utcnow()}})
            await db.app_meta.update_one({"key": "nav_semcache_purged_v1"}, {"$set": {"at": utcnow(), "count": res.modified_count}}, upsert=True)
            logger.info("[NAV] semantic cache invalidated (%s entries)", res.modified_count)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[NAV] startup failed: %s", exc)
