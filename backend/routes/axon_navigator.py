# ============================================================================
# V50.z442 — AxonOS NAVIGATOR (riscritto): classificatore d'intento a 3 vie
# ----------------------------------------------------------------------------
# 1) NAVIGAZIONE ESPLICITA («apri…», «vai a…», «portami…», «dove trovo…», «come faccio a impostare…»)
#    → mappa schermate nel prompt + chip [[NAV:route|label]] / flussi deterministici + azioni [[ACTION]].
# 2) INFORMATIVA / RICERCA GENERALE (chi è, quanto costa, numero di telefono, notizie, definizioni, «cerca…»)
#    → ricerca web generale (Tavily, senza filtro domini) e RISPOSTA DIRETTA: nessuna sezione menu CRM, nessun [[NAV]].
# 3) OPERATIVA CRM / CONVERSAZIONE → prompt CRM normale (snapshot, contatti, agenda) SENZA mappa dell'app.
# La mappa schermate (APP_MAP), gli endpoint /axon/nav/* (chip, azioni, proattivo, mappa) e i flussi multi-step restano:
# vengono usati SOLO nel caso 1. Spariti: template L1 «Apri …» su ogni frase, iniezione della mappa in ogni prompt,
# fallback «frase incompleta / non ho capito».
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
    dict(id="home_ritelefonate", name="Ritelefonate di oggi", route="/home?section=ritelefonate", group="Home", desc="Elenco delle chiamate da fare oggi (ritelefonate) con esito.", kw=["segnarmi che ho chiamato", "ho chiamato", "ritelefonate", "richiamare", "richiamo", "chiamate da fare", "callback", "telefonate"]),
    dict(id="callback_nuova", name="Nuova ritelefonata", route="/callback/new", group="Home", desc="Programma una ritelefonata (chi, quando, motivo).", kw=["imposto ritelefonata", "programmo chiamata", "chiamata per domani", "segnarmi di richiamare", "ricordarmi di chiamare", "richiamare la settimana", "non dimenticare", "nuova ritelefonata", "programma chiamata", "impostare ritelefonata", "ricordami di chiamare"]),
    dict(id="home_appuntamenti", name="Appuntamenti di oggi", route="/home?section=appuntamenti", group="Home", desc="Appuntamenti del giorno con esito e navigazione.", kw=["appuntamenti di oggi", "agenda di oggi", "oggi"]),
    dict(id="home_azioni", name="Azioni rapide", route="/home?section=azioni", group="Home", desc="Pulsanti rapidi personalizzabili (nuovo contatto, appuntamento, scanner…).", kw=["azioni rapide", "scorciatoie", "pulsanti rapidi"]),
    dict(id="quick_actions_config", name="Configura azioni rapide", route="/quick-actions", group="Home", desc="Scegli quali azioni rapide mostrare in Home.", kw=["personalizzo azioni rapide", "personalizzare azioni", "configuro azioni rapide", "configura azioni rapide", "personalizza azioni"]),
    dict(id="home_scadenze", name="Scadenze", route="/home?section=scadenze", group="Home", desc="Scadenze contratti/documenti in arrivo.", kw=["scadenze", "scadenza contratto", "in scadenza", "rinnovi"]),
    dict(id="deadlines", name="Tutte le scadenze", route="/deadlines", group="Home", desc="Lista completa delle scadenze con filtri.", kw=["tutte le scadenze", "elenco scadenze"]),
    dict(id="home_statistiche", name="Dashboard statistiche", route="/home?section=statistiche", group="Home", desc="KPI personali: appuntamenti, esiti, contratti, andamento.", kw=["vedere statistiche", "statistiche", "dashboard", "kpi", "come sto andando", "risultati", "andamento", "numeri"]),
    dict(id="dashboard_config", name="Configura dashboard", route="/dashboard-config", group="Home", desc="Scegli quali widget/statistiche vedere in Home.", kw=["personalizzare dashboard", "personalizzo dashboard", "configuro widget", "widget dashboard", "configurare dashboard", "configura dashboard", "personalizza home", "widget home"]),
    dict(id="home_comunica", name="Comunica con l'Azienda", route="/home?section=comunica", group="Home", desc="Invia una comunicazione/richiesta alla tua azienda (Master).", kw=["scrivo all azienda", "scrivere azienda", "comunicazione azienda", "mando comunicazione", "comunica con l'azienda", "scrivere all'azienda", "contattare azienda", "richiesta azienda"]),
    dict(id="master", name="Interfaccia Master", route="/master", group="Home", desc="Area Master: agenda team, contatti aziendali, contratti, comunicazioni.", kw=["interfaccia master", "master", "area master", "contatti aziendali", "contatti di tutta l azienda", "contatti dell azienda", "clienti di tutta l azienda", "tutti i contatti dell azienda"], master_only=True),
    # ── CONTATTI ──
    dict(id="contatti", name="Contatti", route="/contatti", group="Contatti", desc="Lista clienti e prospect con ricerca e filtri.", kw=["cerco cliente", "cerco un cliente", "cliente per nome", "recupero contatto", "perso un contatto", "contatti", "clienti", "anagrafica", "rubrica", "lista clienti", "cercare cliente"]),
    dict(id="contatto_nuovo", name="Nuovo contatto", route="/contact/new", group="Contatti", desc="Aggiungi un cliente a mano.", kw=["aggiungo contatto", "aggiungo cliente", "registra cliente", "cliente nuovo", "nuovo cliente dove", "scrivo cliente", "beccato cliente", "nuovo contatto", "aggiungi cliente", "nuovo cliente", "inserire cliente", "creare contatto"]),
    dict(id="contatto_scheda", name="Scheda contatto", route="/contact/{id}", group="Contatti", desc="Dettaglio cliente: info, note, file, fatture, audio, chiamate, appuntamenti, visite, referenze.", kw=["scheda cliente", "scheda contatto", "dettaglio cliente"]),
    dict(id="contatto_visite", name="Storico visite del contatto", route="/contact/{id}?tab=visits", group="Contatti", desc="Visite registrate (manuali e GPS) per il cliente.", kw=["storico visite", "visite cliente", "ultima visita", "quando sono stato"]),
    dict(id="contatto_note", name="Note del contatto", route="/contact/{id}?tab=notes", group="Contatti", desc="Note testuali sul cliente.", kw=["note cliente", "appunti cliente", "scrivere nota"]),
    dict(id="contatto_fatture", name="Fatture del contatto", route="/contact/{id}?tab=bills", group="Contatti", desc="Bollette analizzate del cliente (tab Fatture).", kw=["bollette cliente", "fatture cliente", "fatture del cliente"]),
    dict(id="contatto_contratti", name="Contratti del contatto", route="/contact/{id}?tab=contracts", group="Contatti", desc="Sezione Contratti della scheda cliente: contratti associati, stato, scadenze, nuovo contratto.", kw=["contratti cliente", "contratti di un cliente", "contratti del cliente", "vedere i contratti", "contratto cliente"]),
    dict(id="contatto_ripasso", name="Frequenza ripasso", route="/contact/edit/{id}", group="Contatti", desc="Imposta ogni quanti giorni rivisitare il cliente (ripasso).", kw=["frequenza ripasso", "ripasso", "ogni quanto visitare", "rivisitare"]),
    dict(id="mappa_clienti", name="Mappa clienti", route="/map-clients", group="Contatti", desc="Clienti su mappa, filtri per stato/città/area e 'non visitati da'.", kw=["mappa clienti", "clienti sulla mappa", "non visitati", "vicino a me"]),
    dict(id="import_contatti", name="Importa contatti", route="/contacts-import", group="Contatti", desc="Importa contatti da CSV/rubrica.", kw=["importare contatti", "rubrica telefono", "file csv", "csv clienti", "importo clienti", "importa contatti", "import csv", "rubrica telefono"]),
    dict(id="gruppi", name="Gruppi contatti", route="/groups", group="Contatti", desc="Organizza i clienti in gruppi.", kw=["clienti in gruppi", "organizzo clienti", "gruppi clienti", "gruppi", "gruppo clienti", "categorie clienti"]),
    dict(id="leads", name="Lead", route="/leads", group="Contatti", desc="Potenziali clienti da lavorare.", kw=["lead", "potenziali clienti", "prospect"]),
    dict(id="business_card", name="Biglietto da visita digitale", route="/business-card", group="Contatti", desc="Il tuo biglietto da visita digitale da condividere.", kw=["mio biglietto da visita", "biglietto digitale", "condividi contatto"]),
    # ── CALENDARIO ──
    dict(id="calendario", name="Calendario", route="/calendario", group="Calendario", desc="Vista mensile con appuntamenti, ritelefonate, esiti.", kw=["modifico appuntamento", "sbagliato appuntamento", "inserire appuntamento sbagliato", "calendario", "agenda", "appuntamenti", "vista mensile", "mese"]),
    dict(id="calendario_settimana", name="Calendario settimanale", route="/calendario?view=week", group="Calendario", desc="Vista settimanale/giornaliera.", kw=["messo male agenda", "agenda aiutami", "organizzare settimana", "settimana", "vista settimanale", "vista giornaliera", "giornata"]),
    dict(id="calendario_anno", name="Calendario annuale", route="/calendario?view=year", group="Calendario", desc="Vista annuale.", kw=["anno", "vista annuale"]),
    dict(id="appuntamento_nuovo", name="Nuovo appuntamento", route="/appointment/new", group="Calendario", desc="Crea un appuntamento (cliente, data, ora, area).", kw=["pianifico appuntamento", "appuntamento con un cliente", "metti appuntamento calendario", "fisso appuntamento", "fissare incontro", "incontro cliente", "metti appuntamento", "appuntamento in calendario", "agenda il", "in agenda", "nuovo appuntamento", "fissare appuntamento", "prendere appuntamento", "pianifica appuntamento"]),
    dict(id="appuntamenti_mancati", name="Appuntamenti mancati", route="/calendario?view=week", group="Calendario", desc="Appuntamenti passati senza esito: chiedi ad Axon 'sposta i mancati di oggi a domani'.", kw=["appuntamenti mancati", "mancati", "saltati", "non fatti", "riprogrammare"]),
    dict(id="appuntamenti_stats", name="Statistiche appuntamenti", route="/appointment-stats", group="Calendario", desc="Esiti e conversioni degli appuntamenti.", kw=["statistiche appuntamenti", "esiti", "conversioni"]),
    dict(id="ripassi", name="Ripassi in scadenza", route="/map-clients", group="Calendario", desc="Clienti da rivisitare (frequenza ripasso superata): chiedi ad Axon 'chi devo rivisitare'.", kw=["ripassi", "da rivisitare", "ripasso scaduto", "clienti da rivedere"]),
    # ── AXON ──
    dict(id="axon_hub", name="Axon Hub", route="/axon-hub", group="AxonOS", desc="Centro di controllo di Axon: memoria, allarmi, integrazioni, insegnamenti.", kw=["centro controllo axon", "dov e il centro", "centro di controllo", "controllo axon", "axon hub", "centro axon"]),  # V50.z383 — «impostazioni axon» → axon_settings (/impostazioni?section=assistente)
    dict(id="axon_memory", name="Memoria di Axon", route="/axon-memory", group="AxonOS", desc="Cosa Axon ha memorizzato su di te e sui tuoi clienti.", kw=["ti ricordi", "cosa ricordi di me", "memoria axon", "memoria", "cosa ricordi", "memorizzato"]),
    dict(id="ai_teach", name="Insegna ad Axon", route="/ai-teach", group="AxonOS", desc="Insegna regole e conoscenze personalizzate. MOTORE REGOLE ASSOLUTE: ogni regola ha un peso 0-100 (chip Peso 100 massima / 80 alta / 60 normale / 40 bassa); se due regole sono in conflitto (es. «rispondi subito» vs «chiedi conferma») vince quella con peso maggiore, l'altra viene sospesa per quel messaggio; in chat: «quale regola vince per …», «log conflitti regole».", kw=["insegno regola", "peso regola", "priorità regole", "regole assolute", "conflitto regole", "quale regola vince", "ti insegno", "insegnare regola", "cosa da ricordare", "dirti una cosa da ricordare", "insegna", "addestra", "regole axon", "impara"]),
    dict(id="axon_alarms", name="Allarmi e promemoria Axon", route="/axon-alarms", group="AxonOS", desc="Allarmi vocali/promemoria impostati con Axon.", kw=["allarmi", "sveglia", "promemoria axon", "ricordami"]),
    dict(id="axon_alerts", name="Avvisi Axon", route="/axon-alerts", group="AxonOS", desc="Avvisi proattivi (scadenze, clienti trascurati, meteo).", kw=["avvisi", "alert", "notifiche axon"]),
    dict(id="voice_copilot", name="Axon Drive · Copilota vocale", route="/voice-copilot", group="AxonOS", desc="Modalità vocale continua a mani libere (in auto, guidando).", kw=["copilota", "mani libere", "guida", "in auto", "axon drive", "modalità guida"]),
    # V50.z416 — Motore TTS / voce con cui Axon parla → Impostazioni › Assistente (card «Motore vocale di Axon»), NON il copilota
    dict(id="tts_engine", name="Motore vocale di Axon (Dispositivo · Google TTS / Server)", route="/impostazioni?section=assistente", group="Profilo",
         desc="Scegli con quale voce Axon legge le risposte: «Dispositivo · Google TTS» (voce di sistema) oppure «Server AdvisorOS» (Kokoro/OpenAI), con anteprima ▶. Da qui anche voce, lingua e velocità avanzate.",
         kw=["motore vocale", "motore tts", "tts", "google tts", "voce di sistema", "voce del dispositivo", "cambiare voce", "cambia voce", "cambio voce", "voce di axon", "voce axon", "sintesi vocale", "text to speech",
             "voce server", "kokoro", "voce openai", "che voce", "quale voce", "voce femminile", "voce maschile", "velocità voce", "voce più veloce", "voce più lenta", "lingua della voce", "anteprima voce"]),
    dict(id="my_audios", name="I miei audio", route="/my-audios", group="AxonOS", desc="Registrazioni audio e trascrizioni.", kw=["audio", "registrazioni", "trascrizioni", "vocali"]),
    dict(id="chat_team", name="Chat Team", route="/chat", group="AxonOS", desc="Chat interna con collaboratori/azienda.", kw=["chatto colleghi", "chat colleghi", "scrivere colleghi", "chat team", "messaggi team", "chat interna", "scrivere ai collaboratori"]),
    # ── AXON DRIVE ──
    dict(id="giro_ottimale", name="Giro ottimale (Axon Drive)", route="/optimal-route", group="Axon Drive", desc="Seleziona fino a 10 clienti, calcola il percorso migliore, orari stimati, apri navigatore (Google Maps/Waze/Apple).", kw=["itinerario più corto", "itinerario piu corto", "giro dei clienti", "risparmiare tempo spostamenti", "spostamenti", "itinerario corto", "itinerario clienti", "giro clienti", "fammi il giro", "percorso più corto", "giro ottimale", "giro", "percorso", "ottimizza", "axon drive", "itinerario", "tappe", "navigatore"]),
    dict(id="navigazione_cliente", name="Naviga verso un cliente", route="/optimal-route?contacts={id}", group="Axon Drive", desc="Apri Axon Drive con il cliente già selezionato.", kw=["naviga", "portami da", "indicazioni", "come arrivo"]),
    dict(id="resoconto_km", name="Resoconto km", route="/km-report", group="Axon Drive", desc="Km percorsi per visita/periodo, esportabile in PDF.", kw=["resoconto chilometri", "chilometri mese", "quanto ho girato", "girato in macchina", "km percorsi", "traccia di dove sono stato", "km", "chilometri", "resoconto km", "rimborso km", "quanti km"]),
    dict(id="meteo", name="Meteo", route="/meteo", group="Axon Drive", desc="Previsioni meteo per la zona dei clienti.", kw=["tempo dalle parti", "che tempo", "previsioni clienti", "meteo", "che tempo fa", "previsioni", "pioggia"]),
    # ── FATTURE E SCANNER ──
    dict(id="fatture", name="Analisi fatture", route="/bill-quick", group="Fatture e Scanner", desc="Lista fatture analizzate e nuova analisi: fotografa la bolletta, confronto offerte, PDF per il cliente.", kw=["analizzo bolletta", "analisi bolletta", "cliente quanto risparmia", "far vedere risparmio", "pdf fattura", "pdf della fattura", "fatture", "bollette", "analisi fattura", "analizza bolletta", "confronto offerte", "risparmio", "nuova fattura"]),
    dict(id="fatture_config", name="Configurazione analisi fatture", route="/bill-quick?config=1", group="Fatture e Scanner", desc="Campi da estrarre, regole di confronto, preset (Domestico/Business), stile anteprima.", kw=["campi da estrarre", "configuro campi fattura", "preset fatture", "configurazione fatture", "preset", "regole confronto", "campi fattura", "stile confronto"]),
    dict(id="scanner", name="Scanner documenti / OCR", route="/scanner", group="Fatture e Scanner", desc="Scansiona biglietti da visita, documenti e bollette con la fotocamera (OCR).", kw=["cliente dal biglietto", "aggiungo cliente biglietto", "biglietti scrivania", "biglietti da visita", "bigliettino", "foto biglietto", "scattare foto", "scanner documenti", "scanner", "scansiona", "fotografa", "ocr", "biglietto da visita", "documento", "fotocamera"]),
    dict(id="documenti_axon", name="Documenti Axon", route="/documenti-axon", group="Fatture e Scanner", desc="Documenti generati e salvati da Axon.", kw=["documenti axon", "documenti generati", "pdf salvati"]),
    dict(id="mercato", name="Mercato · condizioni economiche concorrenti e benchmark", route="/mercato", group="Fatture e Scanner", desc="DB condizioni economiche (concorrenti, ARERA/GME, la mia ditta) e confronto per fornitore, segmento, tensione e fascia di consumo.", kw=["mercato", "concorrenti", "benchmark", "confronto", "prezzi", "condizioni", "arera", "gme", "pun", "listino", "migliore offerta"]),
    dict(id="master_files", name="Archivio file", route="/master-files", group="Fatture e Scanner", desc="Archivio documenti (listini, moduli, PDF) condivisi dal Master.", kw=["archivio", "file", "documenti", "listini", "moduli", "materiale"]),
    dict(id="google_drive", name="Google Drive", route="/google-drive", group="Fatture e Scanner", desc="Collega e sfoglia il tuo Google Drive.", kw=["google drive", "drive"]),
    dict(id="dropbox", name="Dropbox", route="/dropbox", group="Fatture e Scanner", desc="Collega e sfoglia Dropbox.", kw=["dropbox"]),
    dict(id="spazio_personale", name="Spazio personale", route="/spazio-personale", group="Fatture e Scanner", desc="I tuoi file personali.", kw=["file personali", "tengo file", "miei documenti personali", "spazio personale", "miei file", "cartella personale"]),
    # ── CASELLE MAIL ──
    dict(id="mail_accounts", name="Caselle mail", route="/email-accounts", group="Caselle Mail", desc="Aggiungi caselle email (IMAP/SMTP), posta in arrivo e in uscita, proposte CRM dalle mail.", kw=["mail dove le metto", "le mail", "collegare la mail", "mia mail", "caselle mail", "email", "posta", "in arrivo", "in uscita", "account email", "imap"]),
    dict(id="smtp", name="Configurazione SMTP", route="/smtp", group="Caselle Mail", desc="Server di invio email (SMTP) per inviare PDF e comunicazioni.", kw=["smtp", "server invio", "configurare email", "inviare email"]),
    dict(id="mail_proposals", name="Proposte CRM dalle mail", route="/mail-crm-proposals", group="Caselle Mail", desc="Contatti/appuntamenti suggeriti da Axon leggendo le email.", kw=["leggere email", "email proporre appuntamenti", "legge le mail", "proposte mail", "email in crm", "suggerimenti mail"]),
    dict(id="outlook", name="Outlook", route="/outlook", group="Caselle Mail", desc="Collega Microsoft Outlook.", kw=["outlook", "microsoft"]),
    # ── HELP ──
    dict(id="help", name="Help", route="/help", group="Help", desc="Aiuto: libretto, manuale PDF, segnala bug/idea, privacy, tour.", kw=["help", "aiuto", "supporto", "assistenza"]),
    dict(id="libretto", name="Libretto informativo", route="/libretto", group="Help", desc="Guida a tutte le funzioni dell'app, scaricabile in PDF (manuale).", kw=["libretto", "manuale", "guida", "istruzioni", "scarica manuale", "pdf manuale"]),
    dict(id="faq", name="Domande frequenti (FAQ)", route="/faq", group="Help", desc="Risposte rapide: addestrare Axon con un contratto esempio, ordine pagine, dove si salva il documento, nuovi fornitori, sicurezza dati, collaboratori, briefing pre-appuntamento; link «Scopri di più su AxonOS».", kw=["faq", "domande frequenti", "domande e risposte", "come funziona axon", "briefing pre-appuntamento", "dati al sicuro", "contratto esempio"]),
    dict(id="segnala", name="Segnala bug / idea", route="/help-center", group="Help", desc="Invia un ticket: problema, idea, richiesta privacy.", kw=["cancellazione dati", "cancellare i miei dati", "axon non risponde", "app lenta", "non si genera", "non funziona", "segnala", "bug", "problema", "idea", "suggerimento", "ticket", "non funziona"]),
    dict(id="tour", name="Tour guidato", route="/tour", group="Help", desc="Tour conversazionale iniziale con Axon.", kw=["sono nuovo", "aiutami a iniziare", "nuovo utente", "tour", "tutorial", "onboarding", "rifare il tour"]),
    dict(id="funzioni", name="Tutte le funzioni", route="/tour-features", group="Help", desc="Elenco completo delle funzioni per gruppo.", kw=["tutte le funzioni", "quali funzioni", "funzioni app", "cosa sa fare l app", "tutte le funzioni", "cosa sa fare", "elenco funzioni", "cosa posso fare"]),
    # ── PROFILO / IMPOSTAZIONI ──
    dict(id="impostazioni", name="Profilo e impostazioni", route="/impostazioni", group="Profilo", desc="Hub impostazioni: profilo, preferenze, notifiche, sicurezza, abbonamento, Axon, integrazioni.", kw=["impostazioni", "profilo", "settings", "configurazione", "preferenze"]),
    # V50.z327 — promo + referral (prima Axon inventava «Profilo → Codice amico»)
    dict(id="promo_code", name="Codice promozionale / codice amico", route="/impostazioni?section=billing", group="Profilo", desc="Profilo › Abbonamento e Pagamenti › card «Codice promozionale»: inserisci un codice promo o un codice amico AMICO-… per giorni gratis.", kw=["codice promozionale", "codice promo", "codice sconto", "codice amico", "inserire il codice", "dove inserisco il codice", "riscattare codice", "riscatto codice", "coupon"]),
    dict(id="invita_amico", name="Invita un amico", route="/invita-amico", group="Profilo", desc="Il tuo codice personale e il link da condividere (WhatsApp, link): giorni gratis per te e per chi arriva.", kw=["invita un amico", "invitare un amico", "invita amici", "codice invito", "il mio codice", "link amico", "referral", "programma amici", "giorni gratis"]),
    dict(id="profilo_dati", name="Dati personali", route="/impostazioni?section=general", group="Profilo", desc="Nome, foto, telefono, firma, lingua.", kw=["dati personali", "il mio nome", "foto profilo", "telefono", "firma"]),
    dict(id="preferenze", name="Preferenze generali", route="/impostazioni?section=general", group="Profilo", desc="Lingua, tema, comportamento generale.", kw=["preferenze generali", "lingua", "tema"]),
    dict(id="notifiche", name="Notifiche", route="/axon-notifications?tab=prefs", group="Profilo", desc="Push, promemoria, copie team, livelli di urgenza, orari silenziosi.", kw=["imposto notifiche", "notifiche", "push", "avvisi telefono", "suoni", "non disturbare"]),
    dict(id="sicurezza", name="Sicurezza", route="/impostazioni?section=security", group="Profilo", desc="Password, 2FA, sessioni, PIN.", kw=["cambio password", "sicurezza", "password", "2fa", "autenticazione", "pin", "cambiare password"]),
    # V50.z303 — nuove funzioni (dispositivi, libretto editor, reset dati test, consigliato per te, coda chat, screenshot)
    dict(id="dispositivi", name="Dispositivi collegati", route="/devices", group="Profilo", desc="Registro dispositivi dell'account: massimo 1 telefono + 1 tablet + 1 PC. Un nuovo login sullo stesso tipo di dispositivo disconnette e sospende il precedente (riattivato al logout del nuovo). Elenco «I miei» con rimozione; per il Master: dispositivi del team e log accessi.", kw=["dispositivi", "dispositivi collegati", "quanti dispositivi", "telefono e tablet", "un telefono un tablet un pc", "disconnetti dispositivo", "log accessi", "accessi al mio account", "sessioni dispositivi", "dispositivo sospeso"]),
    dict(id="libretto_editor", name="Editor Libretto illustrativo", route="/libretto-editor", group="Master", desc="Il Master modifica testi, sezioni e mockup del Libretto illustrativo / presentazione AdvisorOS, con anteprima e PDF (anche da Impostazioni → Personalizzazione).", kw=["libretto illustrativo", "editor libretto", "modificare il libretto", "presentazione advisoros", "testi del libretto"], master_only=True),
    dict(id="reset_dati_test", name="Azzera dati di test (Master)", route="/impostazioni", group="Master", desc="Nel hub Impostazioni (in fondo, solo Master): cancella tutti i dati di prova (clienti, appuntamenti, ritelefonate, contratti…) mantenendo account, team, impostazioni e tutto ciò che è stato insegnato ad Axon. Richiede parola di conferma.", kw=["azzera dati", "cancella dati di test", "reset dati", "ripulisci dati di prova", "elimina dati di prova", "master reset", "azzera tutto"], master_only=True),
    dict(id="consigliato_per_te", name="Consigliato per te (Home)", route="/home", group="Home", desc="Card in Home sotto «Interfaccia Master»: scorciatoie alle funzioni a cui hai detto SÌ nel Tour guidato (form interessi); × nasconde una voce, ↻ rifà il tour.", kw=["consigliato per te", "consigliati", "scorciatoie consigliate", "funzioni consigliate", "suggerimenti in home"]),
    dict(id="coda_chat", name="Coda messaggi chat (chat non bloccante)", route="/axon-hub", group="AxonOS", desc="Mentre Axon sta rispondendo l'input resta attivo: il nuovo messaggio va in coda (tasto arancione ⏱) e compare in chat come bolla «⏳ N° in coda · ETA» con Invia ora (urgente, salta la coda), Modifica, Elimina; parte da solo appena Axon finisce. Tab «Coda» per lo storico e le bozze non riuscite (Riprova).", kw=["coda messaggi", "messaggio in coda", "in coda", "invia ora", "chat non bloccante", "scrivere mentre risponde", "input bloccato", "bozze chat"]),
    dict(id="screenshot_axon", name="Screenshot ad Axon (1 tocco)", route="/axon-hub", group="AxonOS", desc="Nel menu allegati della chat: «Screenshot schermata» cattura con un tocco la schermata da cui hai aperto Axon e la allega al messaggio (per segnalare bug o chiedere aiuto su ciò che vedi). Axon sa sempre in quale schermata ti trovi.", kw=["screenshot", "schermata ad axon", "cattura schermata", "foto dello schermo", "mandare uno screenshot", "sai dove sono", "in che schermata sono"]),
    dict(id="abbonamento", name="Abbonamento", route="/impostazioni?section=billing", group="Profilo", desc="Piano attivo, fatturazione, upgrade.", kw=["abbonamento", "piano", "pagamento", "fattura app", "upgrade", "premium"]),
    dict(id="gps_visite", name="Rilevamento GPS visite", route="/impostazioni?section=general", group="Profilo", desc="Attiva il rilevamento automatico delle visite (soglie minuti/metri).", kw=["visite in automatico", "registra visite", "visite automatico", "rilevamento gps", "gps", "visite automatiche", "rilevamento visite", "geolocalizzazione"]),
    dict(id="conferma_visite", name="Modalità conferma visite", route="/impostazioni?section=general", group="Profilo", desc="Popup in tempo reale oppure riepilogo a fine giornata.", kw=["conferma visite", "popup visite", "riepilogo fine giornata", "modalità visite"]),
    dict(id="axon_settings", name="Impostazioni AxonOS · Assistente (nome, lingua, tono, voce)", route="/impostazioni?section=assistente", group="Profilo", desc="Sezione «AI & Axon · Assistente» dentro Impostazioni AxonOS: nome dell'assistente, modalità risposta (testo/voce), tono (1 Istituzionale … 5 Fantasiosa), voce e lingua delle risposte (con anteprima). UNICA route per configurare lingua, tono e voce di Axon.", kw=["impostazioni axonos", "impostazioni axon", "impostazioni assistente", "configurare axon", "configura axon", "nome assistente", "cambio nome assistente", "voce assistente", "configurare voce", "voce axon", "modalità risposta", "cambia nome", "voce", "tono", "tono di axon", "cambia tono", "tono axon", "lingua", "lingua di axon", "cambia lingua", "lingua tono voce", "lingua tono e voce"]),
    dict(id="integrazioni", name="Integrazioni", route="/axon-integrations", group="Profilo", desc="Collega servizi esterni (Drive, Dropbox, Outlook, Home Assistant, Telegram…).", kw=["integrazioni", "collega", "servizi esterni", "telegram", "home assistant"]),
    dict(id="aree", name="Le mie aree", route="/le-mie-aree", group="Profilo", desc="Aree merceologiche degli appuntamenti (Energia, Piano Marketing…).", kw=["aree appuntamenti", "cambio aree", "energia marketing", "aree", "aree merceologiche", "tipo appuntamento", "categorie appuntamento"]),
    dict(id="campi_custom", name="Campi personalizzati", route="/custom-fields", group="Profilo", desc="Campi extra nella scheda contatto.", kw=["campi personalizzati", "campi extra", "campo custom"]),
    dict(id="wizard", name="Wizard configurazione", route="/setup", group="Profilo", desc="Configurazione guidata iniziale (Parla a Neo).", kw=["wizard", "configurazione guidata", "parla a neo", "setup"]),
    dict(id="spese", name="Spese", route="/axon-expenses", group="Profilo", desc="Registro spese e rimborsi.", kw=["spese", "rimborsi", "nota spese", "scontrini"]),
    dict(id="report", name="Report", route="/report", group="Profilo", desc="Report attività e performance.", kw=["report", "resoconto attività", "riepilogo mensile"]),
    # ── MASTER ──
    dict(id="master_agenda", name="Agenda team (Master)", route="/master", group="Master", desc="Agenda di tutti i collaboratori.", kw=["agenda team", "agenda del team", "agenda collaboratori", "agenda team", "appuntamenti collaboratori", "agenda squadra"], master_only=True),
    dict(id="anagrafica_master", name="Anagrafica Master (dati personali, documenti, password)", route="/anagrafica-master", group="Master", desc="I tuoi dati anagrafici, documenti di riconoscimento e password vault cifrato.", kw=["anagrafica master", "i miei dati", "miei dati personali", "password vault", "mie password", "anagrafica personale", "dati titolare"], master_only=True),
    dict(id="contratti", name="Contratti (Master)", route="/master", group="Master", desc="Contratti caricati dai collaboratori, stati e commissioni.", kw=["contratti dei collaboratori", "contratti caricati", "stato contratto", "stato dei contratti", "commissioni", "contratti master"], master_only=True),
    dict(id="contratto_carica", name="Nuovo contratto (carica firmato)", route="/contract/new", group="Contatti", desc="Registra un contratto firmato per un cliente: numero, fornitore, servizio, date inizio/fine, importo/commissione, note e allegato (foto o PDF del contratto). Poi appare nella scheda del contatto (tab Contratti), nelle scadenze e per il Master nel pannello Contratti.", kw=["carico un contratto", "caricare un contratto", "contratto firmato", "registrare un contratto", "inserire un contratto", "nuovo contratto", "aggiungere contratto", "salvare il contratto", "contratto del cliente", "archiviare contratto", "dove metto il contratto"]),
    dict(id="contratto_nuovo", name="Compilazione CRT · pratica contratto (cliente + servizi luce/gas/telco)", route="/crt", group="AxonOS", desc="Consumo annuo: dai kWh/Smc della fattura riportati su 12 mesi (es. 8 mesi di storico → media mensile × 12), correggibile a mano. Pratica contratto multi-servizio (Luce/Gas/Telco insieme): dossier documenti (carta d'identità, CF, visura camerale, IBAN, SDI/PEC, referente, CTE, contratto precedente) letti da Axon; fatture del cliente → una fornitura per POD/PDR con consumo 12 mesi stimato (somma mesi ÷ mesi presenti × 12, min 4 mesi); moduli del fornitore compilati con righe forniture e replica automatica del modulo; verifica/correzione; PDF unico compresso con indice; condivisione via mail/WhatsApp/QR code. Esempi compilati e esempio pratica completa per insegnare ad Axon.", kw=["contratto", "nuovo contratto", "compilazione crt", "crt", "pratica contratto", "compila contratto", "compilo un nuovo contratto", "compilare un contratto", "contratto luce e gas", "nuovo contratto luce", "contratto per un cliente", "moduli contratto", "pod", "pdr", "forniture", "pdf unico", "qr code contratto", "visura camerale", "iban cliente", "cte", "proposta di adesione", "sepa", "consumo annuo", "consumo annuo stimato", "calcolo del consumo annuo", "leggere la visura", "visura camerale ad axon", "dossier documenti", "condividere il contratto", "contratto finale", "storico fattura", "mesi di storico", "elenco pratiche", "le mie pratiche", "stato pratica"], master_only=False),
    # V50.z418 — Axon Lab = area Master di addestramento (regole, modelli moduli fornitore, esempi) + accesso Business; la COMPILAZIONE della pratica è /crt
    dict(id="axon_lab", name="Axon Lab (addestramento Master alla compilazione contratti)", route="/axon-lab", group="Master", desc="Hub Axon Lab: Addestramento Master (regole di compilazione, modelli/moduli del fornitore, esempi compilati, delegati) e Compilazione Business. Per compilare una pratica concreta per un cliente usa invece Compilazione CRT (/crt).", kw=["axon lab", "addestramento contratti", "insegna a compilare", "regole di compilazione", "modelli fornitore", "moduli fornitore", "esempi compilati", "delegati compilazione", "addestramento master contratti", "training contratti"], master_only=False),
    dict(id="voce_lingua_axon", name="Voce e lingua di Axon (Impostazioni AxonOS › Assistente)", route="/impostazioni?section=assistente", group="AxonOS", desc="Scegli la voce con cui Axon parla (anteprima) e la lingua delle risposte: sezione «AI & Axon · Assistente» di Impostazioni AxonOS.", kw=["cambia voce", "cambiare voce", "voce di axon", "voce assistente", "cambia lingua di axon", "cambiare lingua ad axon", "lingua di axon", "lingua assistente", "lingua delle risposte", "lingua in cui risponde", "axon mi risponde", "parla in inglese", "voce maschile", "voce femminile", "voce e lingua"]),
    dict(id="offline_mode", name="Modalità offline e sincronizzazione", route="/offline-sync", group="Impostazioni", desc="L'app funziona anche in modalità aereo/senza rete: navighi con gli ultimi dati scaricati (precaricamento automatico di clienti, agenda, corsi, team…), crei e modifichi clienti, appuntamenti, note e attività; le modifiche restano in coda e vengono inviate al gruppo appena torna la connessione. Pannello con modifiche in attesa, «Sincronizza ora», «Precarica dati», conflitti segnalati al Master. Non disponibili offline: Axon AI/voce, OCR, PDF/PowerPoint, email.", kw=["offline", "modalita aereo", "modalità aereo", "senza rete", "senza connessione", "senza internet", "sincronizza", "sincronizzazione", "modifiche in attesa", "in aereo", "no rete", "manca la rete", "non ho campo", "precarica dati", "cache", "vedono i colleghi", "quando lo vedono", "inserito senza rete", "nessuna connessione", "torno online", "tornato online", "quando torna la connessione", "axon offline", "voce offline", "offline axon", "lavorare offline", "funziona offline", "senza campo", "zona senza campo"]),
    dict(id="area_corsi", name="Area Corsi", route="/courses", group="Master", desc="Cartelle corsi per il team (Master/Manager creano, collaboratori leggono): materiali PDF/foto/audio, lettura tracciata, ✅ Partecipo / ❌ Non partecipo con motivo, lista partecipanti, reminder automatici; dentro ogni corso: Test/Quiz a scelta multipla + risposta aperta, Relazione vocale di fine corso (dettata e organizzata da Axon), Presentazione PowerPoint (.pptx generata dall'AI dai materiali o dettata a voce, oppure scritta a mano), Attestato di partecipazione PDF automatico. Data/ora del corso con promemoria pre-lezione, spunta presenze in aula e rilascio attestati (voci dedicate).", kw=["corsi", "area corsi", "cartella corso", "nuovo corso", "corso di formazione", "formazione team", "partecipo al corso", "materiali corso", "chi ha letto il corso", "partecipanti corso", "test del corso", "quiz corso", "quiz", "relazione fine corso", "relazione vocale", "corsi assegnati", "corso assegnato", "lettura corso", "punteggio test", "punteggio del test", "risultato del test", "risultato test", "esito del test", "test completato", "mio test"]),
    dict(id="area_corsi_nuovo", name="Nuovo corso (Area Corsi)", route="/courses/new", group="Master", desc="Crea una cartella corso: titolo, descrizione, appunti, data/luogo (Maps), destinatari (singoli o tutto il team), reminder, allegati.", kw=["crea corso", "creare un corso", "nuova cartella corso", "creo un corso", "assegnare un corso", "assegna corso", "caricare un corso", "pubblicare un corso"], master_only=True),
    dict(id="area_corsi_dashboard", name="Dashboard Azienda corsi", route="/courses/dashboard", group="Master", desc="Dashboard aziendale della formazione: tutti i corsi con letture, partecipazione %, test completati e punteggio medio; filtri per manager, area/gruppo e periodo; totali per manager e per area.", kw=["dashboard corsi", "dashboard azienda", "dashboard formazione", "statistiche corsi", "andamento corsi", "corsi per manager", "corsi per area", "partecipazione corsi", "punteggio medio test"], master_only=True),
    dict(id="slide_corso", name="Presentazione PowerPoint del corso", route="/courses", group="Master", desc="Nella cartella corso: Axon genera le slide (.pptx) dai materiali caricati o da ciò che il Master detta a voce; oppure il Master le scrive a mano (titolo, punti, note relatore). Scaricabile, aggiungibile ai materiali, visibile ai partecipanti.", kw=["powerpoint", "slide", "presentazione", "genera slide", "slide del corso", "slide corso", "powerpoint corso", "powerpoint del corso", "presentazione corso", "presentazione del corso", "pptx", "detta le slide", "dettare le slide", "slide a voce", "slide dai materiali", "genera powerpoint", "generazione powerpoint", "genera presentazione", "creare presentazione"]),
    dict(id="presenze_corso", name="Presenze in aula (corsi)", route="/courses", group="Master", desc="Nel dettaglio corso il formatore ha la card «📋 Presenze in aula»: spunta chi è presente (gli iscritti ✅ sono pre-selezionati) e salva. Da quel momento l'attestato spetta SOLO ai presenti (anche il rilascio automatico del giorno dopo); il bottone diventa «Rilascia attestati ai presenti» e chi è segnato assente non lo riceve.", kw=["presenze", "presenze corso", "presenze in aula", "spunta presenze", "registro presenze", "segnare i presenti", "chi era presente", "assenti al corso", "foglio presenze"]),
    dict(id="promemoria_corso", name="Promemoria prima della lezione (corsi)", route="/courses", group="Master", desc="Ogni corso ha data e ORA; il formatore sceglie i promemoria automatici 7 / 3 / 1 giorni prima o il giorno stesso (alle 08:45): arrivano a chi partecipa ✅ e a chi non ha ancora risposto (mai a chi ha detto ❌), con ora e luogo; il formatore riceve il riepilogo presenze. Il giorno dopo la lezione: attestati automatici agli idonei, «completa il test» a chi manca, riepilogo «Corso svolto».", kw=["promemoria corso", "promemoria del corso", "promemoria ai partecipanti", "quando arrivano i promemoria", "promemoria automatici del corso", "promemoria lezione", "avviso prima del corso", "ricordare il corso", "ora del corso", "reminder lezione", "giorno prima del corso", "avvisare i partecipanti"]),
    dict(id="attestato_corso", name="Attestato di partecipazione (corsi)", route="/courses", group="Master", desc="Attestato PDF automatico: il collaboratore lo riceve nella cartella corso quando risponde ✅ Partecipo e completa il test (se presente); il Master scarica quello di ogni partecipante (icona 🎓). Con logo/nome azienda, data, luogo, punteggio test, numero attestato. Non viene emesso prima della data del corso; se il formatore ha registrato le PRESENZE spetta solo ai presenti; il giorno dopo la lezione parte in automatico; il formatore può anche premere «Rilascia attestati» per emetterli a tutti i presenti (anche senza test) con notifica «🎓 Attestato pronto».", kw=["attestato", "attestato di partecipazione", "certificato corso", "certificato di partecipazione", "attestato corso", "scarico l attestato", "diploma corso", "attestato pdf"]),
    dict(id="modelli_moduli", name="Modelli moduli (PDF da compilare)", route="/form-templates", group="Master", desc="Carica i PDF dei moduli: Axon rileva i campi e li compila con i dati del cliente da Nuovo Contratto.", kw=["modelli moduli", "modello modulo", "modulo pdf", "compilare modulo", "compila modulo", "moduli precompilati", "autocompilazione moduli", "modulo contratto"], master_only=True),
    dict(id="documenti_riconoscimento", name="Documenti di riconoscimento", route="/anagrafica-master", group="Profilo", desc="Carta d'identità, patente, passaporto, tessera sanitaria: foto fronte/retro, scadenze e avvisi.", kw=["carta d identita", "carta identita", "documento identita", "documento di riconoscimento", "patente", "passaporto", "tessera sanitaria", "scadenza documento", "scadenza carta identita", "scadenza patente"]),
    dict(id="comunicazioni_azienda", name="Comunicazioni azienda (Master)", route="/master", group="Master", desc="Invia comunicazioni/banner ai collaboratori.", kw=["comunicazione collaboratori", "mando comunicazione", "avviso collaboratori", "comunicare ai collaboratori", "comunicazioni", "avviso ai collaboratori", "circolare", "banner"], master_only=True),
    dict(id="team", name="Team", route="/team", group="Master", desc="Gestione collaboratori, ruoli, aree.", kw=["team", "collaboratori", "squadra", "ruoli"], master_only=True),
    dict(id="invita", name="Invita collaboratore", route="/invite-collaborator", group="Master", desc="Invita un nuovo collaboratore.", kw=["invito collaboratore", "invitare collaboratore", "invita", "aggiungi collaboratore", "nuovo collaboratore"], master_only=True),
    dict(id="team_insights", name="Team insights", route="/team-insights", group="Master", desc="Profilo AI e metriche di ogni collaboratore.", kw=["kpi collaboratori", "kpi dei collaboratori", "profilo collaboratore", "team insights", "kpi team"], master_only=True),
    dict(id="viola_wake", name="Impostazioni Wake Word Axon", route="/viola-wake", group="Impostazioni", desc="Ascolto continuo per attivare Axon a voce dicendo «Axon» (wake-word offline, permessi microfono, prova comandi). Voce rinominata da «Viola · comandi vocali» (V50.z417).", kw=["wake word", "wake-word", "parola di attivazione", "attivazione vocale", "ehi axon", "di' axon", "ascolto continuo", "ascolto vocale", "comandi vocali", "viola", "violawake", "attiva ascolto", "microfono sempre attivo", "impostazioni wake word"]),
    # V50.z417 — Addestramento wake-word (raccolta campioni «Axon»): Master → /admin/wake-samples, collaboratori → /wake-training
    dict(id="wake_training", name="Addestramento wake-word Axon", route="/wake-word-training", group="AxonOS", desc="Raccogli campioni vocali «Axon» per addestrare il riconoscimento: parole/frasi personalizzate, statistiche, link condivisibile da inviare ad amici e colleghi.", kw=["addestramento wake word", "addestra axon", "addestramento axon", "campioni vocali", "registra la parola axon", "registrazione wake word", "allenare axon", "training wake word", "link addestramento", "wake samples", "campioni audio axon"]),
    dict(id="confronto_collaboratori", name="Confronto collaboratori", route="/team-compare", group="Master", desc="Confronto KPI fra collaboratori per periodo (30/90/365 gg): classifica con punteggio, grafico per metrica, testa a testa, tabella completa, migliore per metrica.", kw=["confronto collaboratori", "confronta collaboratori", "confronto team", "classifica collaboratori", "classifica", "chi ha fatto più contratti", "miglior collaboratore", "testa a testa", "risultati collaboratori", "paragona collaboratori", "ranking"], master_only=True),
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


_NAV_STOP = {"un", "una", "uno", "il", "lo", "la", "i", "gli", "le", "di", "del", "dello", "della", "dei", "degli", "delle", "a", "al", "allo", "alla", "ai", "agli", "alle",
             "da", "dal", "dallo", "dalla", "dai", "dagli", "dalle", "in", "nel", "nello", "nella", "nei", "negli", "nelle", "su", "sul", "sullo", "sulla", "sui", "sugli", "sulle",
             "per", "con", "tra", "fra", "e", "o", "che", "mio", "mia", "miei", "mie", "tuo", "tua", "suo", "sua", "l", "d", "ma", "anche", "come", "dove", "cosa", "posso", "faccio", "voglio", "vorrei", "devo", "si", "fa", "faccio"}
_NAV_SUFFIX_LONG = _nav_re.compile(r"(azione|azioni|amento|amenti|imento|imenti|mente|are|ere|ire|iamo|ano|ono|ete)$")
_NAV_SUFFIX_PART = _nav_re.compile(r"(ato|ata|ati|ate|uto|uta|uti|ute|ito|ita|iti|ite)$")
_NAV_SUFFIX_VOW = _nav_re.compile(r"[aeio]$")


def _nav_stem(w: str) -> str:
    if len(w) <= 3:
        return w
    st = _NAV_SUFFIX_LONG.sub("", w)
    if st != w and len(st) >= 4:
        return st
    st = _NAV_SUFFIX_PART.sub("", w)
    if st != w and len(st) >= 5:
        return st
    st = _NAV_SUFFIX_VOW.sub("", w)
    return st if len(st) >= 3 else w


def _nav_tokens(text: str) -> list:
    return [_nav_stem(w) for w in _nav_norm(text).split() if w not in _NAV_STOP]


_NAV_VOCAB_CACHE: dict = {"set": None}


def _nav_vocab() -> set:
    if _NAV_VOCAB_CACHE["set"] is None:
        v = set()
        for e in APP_MAP:
            for kw in e["kw"]:
                v.update(_nav_tokens(kw))
        _NAV_VOCAB_CACHE["set"] = v
    return _NAV_VOCAB_CACHE["set"]


def _nav_tok_eq(a: str, b: str) -> bool:
    """a = token keyword, b = token messaggio. Fuzzy solo se b è un refuso (non nel vocabolario)."""
    if a == b:
        return True
    if min(len(a), len(b)) < 4 or abs(len(a) - len(b)) > 1 or b in _nav_vocab():
        return False
    import difflib as _dl
    return _dl.SequenceMatcher(None, a, b).ratio() >= 0.8


def _nav_kw_hit(kw_tokens: list, msg_tokens: list) -> bool:
    return bool(kw_tokens) and all(any(_nav_tok_eq(k, m) for m in msg_tokens) for k in kw_tokens)


def _nav_score(e: dict, msg_tokens: list) -> int:
    score = 0
    for kw in e["kw"]:
        kt = _nav_tokens(kw)
        if _nav_kw_hit(kt, msg_tokens):
            score += 3 + 2 * len(kt)
    return score


def _nav_match(msg: str, user: dict, limit: int = 3) -> list:
    """Keyword scoring: ritorna le voci APP_MAP più pertinenti al messaggio."""
    mt = _nav_tokens(msg)
    master = _nav_is_master(user)
    scored = []
    for e in APP_MAP:
        if e.get("master_only") and not master:
            continue
        score = _nav_score(e, mt)
        if score:
            scored.append((score, e))
    scored.sort(key=lambda x: -x[0])
    return [e for _, e in scored[:limit]]


def _nav_is_master(user: dict) -> bool:
    return not user.get("parent_user_id") and (user.get("role") or "member") == "owner"

_RX_OPEN_SCREEN = _nav_re.compile(r"\b(apri|aprire|aprimi|portami|vai (a|su|in|al|alla)|mostrami la schermata|dove (trovo|si trova|sta)|come (apro|arrivo|entro))\b", _nav_re.I)


# V50.z304 — PROMPT CORREZIONE DEFINITIVA (21/09): stile risposta hardcoded
_RX_WAIT = _nav_re.compile(r"^(?=.*\b(?:aspett\w*|attimo|momento|secondo|minuto|attendi|attendere|fermo|fermati|stop|forse|lascia stare|ci penso|aspé|aspe)\b)\W*(?:(?:aspett\w*|un attimo|un momento|un secondo|un minuto|attendi|attendere|fermo|fermati|stop|forse|controllo|verifico|guardo|vedo|ci penso|penso|io|dai|dammi|lascia stare|ok|okay|no|si|sì|momento|attimo|aspé|aspe|poi ti dico|ti dico|dopo|un po|prima|che)\W*){1,7}$", _nav_re.I)
_RX_TABLE_ONLY = _nav_re.compile(r"\b(solo (la )?tabella|tabella|tabelle|listino|storico pun|storico prezzi|serie storica|elenco in tabella|in formato tabella|tabellare)\b", _nav_re.I)
_RX_DIRECT_Q = _nav_re.compile(r"^(hai |sei |puoi |riesci |ce l'hai|c'[èe] |esiste |funziona |[èe] (pronto|pronta|fatto|fatta|vero|corretto|giusto|aggiornat)|ti ricordi|ricordi |confermi|sai |conosci |hai (letto|capito|visto|ricevuto|fatto|aggiornato|salvato|inviato))", _nav_re.I)
_RX_SEARCH_NEED = _nav_re.compile(r"\b(aggiornat\w* (a |ad )?oggi|di oggi|oggi|adesso|ora per ora|ultimi dati|dati aggiornati|in tempo reale|live|gme|futures|prezzo attuale|quotazion\w*|cerca sul web|ricerca web|sul web|online)\b", _nav_re.I)


_RX_MOTIVATE = _nav_re.compile(r"\b(motiva\w*|motivazion\w*|argomenta\w*|giustifica\w*|e perch[éè]|perch[éè]\s*\?|spiega(mi)? (il )?perch[éè]|spiegami (come|cosa|se)|[èe] vero che|giusto\?|corretto\?|sbagliat\w*\?)", _nav_re.I)
_RX_CHOICE_REQ = _nav_re.compile(r"\b((due|tre|quattro|2|3|4) (opzioni|scelte|alternative|possibilit\w*|strade|proposte)|opzioni? a\)|a\) e b\)|come pulsanti|con i pulsanti|dammi le (due|tre) scelte|proponimi|quale preferisco|cosa mi consigli tra|meglio .* o )", _nav_re.I)


def _nav_style_rules(msg: str) -> str:
    """Blocco STILE RISPOSTA (sempre) + direttive condizionali in base al messaggio."""
    t = (msg or "").strip()
    lines = [
        "",
        "⚡ STILE RISPOSTA (VINCOLANTE):",
        "1) Prima riga = risposta secca (verbo + oggetto, 1-2 frasi); contesto, dettagli, tabelle e proposte SOLO dopo, in un paragrafo separato.",
        "2) SCELTE E AZIONI: opzioni una per riga come «A) …», «B) …» (max 5) oppure parole-azione in maiuscolo tra virgolette («ORA» / «DOPO» / «MODIFICA» / «CANCELLA» / «INVIA»): l'app le rende pulsanti cliccabili. Mai descrivere una scelta senza questo formato.",
        "3) FONTI: priorità 🌐 LIVE > 📥 PDF allegato > 📂 DRIVE > 📄 MASTER FILES > 🔍 WEB; cita la fonte usata in coda con la sua icona. Dato non di oggi → «Aggiornato al <data>. Lo aggiorno da GME/web?». Ricerca fallita → «Non ho trovato <cosa> in <fonte>. Vuoi che <alternativa>?». Mai dati vecchi spacciati per attuali.",
        "4) Niente disclaimer, riepiloghi di ciò che l'utente ha appena scritto o cortesie ripetute. Applica sempre ciò che il Master ti ha insegnato senza chiedere di ripeterlo.",
    ]
    if _RX_TABLE_ONLY.search(t) and "?" not in t.replace("??", "?").rstrip("?") and len(t.split()) <= 14:
        lines.append("🔒 RICHIESTA «SOLO TABELLA» RILEVATA: l'output è ESCLUSIVAMENTE la tabella Markdown (intestazione + righe). ZERO testo prima, ZERO testo dopo, ZERO note/fonti/disclaimer/legenda. Dati mancanti → `n/d` nella cella. Nessuna frase del tipo «Ecco la tabella».")
    elif _RX_DIRECT_Q.search(t) and len(t.split()) <= 12:
        lines.append("🔒 DOMANDA DIRETTA RILEVATA: prima riga = SOLO «Sì, …» / «No, …» / il dato richiesto (max 12 parole). Poi, se serve davvero, UNA frase di contesto o UNA domanda con opzioni A)/B).")
    if _RX_CHOICE_REQ.search(t):
        lines.append("🔒 SCELTE RICHIESTE: l'utente vuole opzioni cliccabili → una riga di contesto (max 1) e poi le opzioni come «A) …», «B) …» (eventualmente «C) …»), UNA PER RIGA, chiudendo con «Quale preferisci?». Mai rispondere senza le lettere A)/B).")
    if _RX_SEARCH_NEED.search(t):
        lines.append("🔒 DATO AGGIORNATO RICHIESTO: verifica la data del dato che usi e dichiarala nella prima riga («Dati GME del <data>»). Se non è odierno, proponi «A) Aggiorno da GME ora  B) Uso l'ultimo disponibile».")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLASSIFICATORE D'INTENTO
# ---------------------------------------------------------------------------
_RX_NAV_EXPLICIT = _nav_re.compile(
    r"\b(apri|aprire|aprimi|apriamo|portami|vai (a|su|in|al|alla|nel|nella)|andiamo (a|su|in)|mostrami (la )?(schermata|sezione|pagina)|"
    r"dove (trovo|si trova|sta|vedo|imposto|configuro|attivo|cambio|modifico)|in che (sezione|schermata|menu)|quale (sezione|schermata|menu)|"
    r"come (apro|arrivo|entro|accedo)|come (faccio|posso|si fa) (a |per )?(impostare|configurare|attivare|disattivare|cambiare|modificare|settare|abilitare|personalizzare|aprire|arrivare|trovare)|"
    r"fammi vedere (la |il |lo |le |i )?(schermata|sezione|pagina|calendario|contatti|impostazioni|statistiche|dashboard|cruscotto|scanner|mappa))\b",
    _nav_re.I,
)
_RX_INFO_GENERAL = _nav_re.compile(
    r"\b(chi (è|e'|era|sono) |cos'?[èe] |cosa (è|e'|sono|significa|vuol dire) |che cos'?[èe] |quanto cost\w*|prezz[oi] (di|del|della|dello)|"
    r"numero (di )?telefono|telefono (di|del|della|dello)|recapit\w* (di|del|della)|indirizz\w* (di|del|della|dello)|orari\w* (di|del|della|dello)|"
    r"dove (si trova|è|e'|sta) (la|il|lo|l'|un|una) |sito (web )?(di|del|della)|recension\w*|notizi\w*|ultime news|news (su|di)|cosa (è )?successo|"
    r"cerca(mi)? (su internet|online|sul web|in rete|il numero|l'indirizzo|informazioni|notizie)|trova(mi)? (il numero|l'indirizzo|informazioni|il sito)|"
    r"ricerca (web|online|su internet)|su (internet|google|wikipedia)|significato di|definizione di|traduci|quanti abitanti|capitale (di|del|della)|"
    r"quando (è nato|è morto|è stato|è stata|si gioca|inizia|finisce|apre|chiude) |risultat\w* (di|della|del) |classifica|"
    r"come (si fa|si prepara|si cucina|si calcola|si converte|si arriva|si raggiunge) |ricetta|voli? (per|da)|treni? (per|da)|farmaci\w* (di turno|aperta)|"
    r"meteo|che tempo fa|previsioni|convert\w* .* in |quanto fa |quanti (km|chilometri|metri|euro|dollari))",
    _nav_re.I,
)
_RX_CRM_WORDS = _nav_re.compile(
    r"\b(client\w*|contatt\w*|appuntament\w*|agenda|calendario|ritelefonat\w*|richiam\w*|pratic\w*|contratt\w*|bollett\w*|fattur\w*|pod|pdr|"
    r"offert\w*|preventiv\w*|visit\w*|giro|team|collaborator\w*|master|scadenz\w*|"
    r"promemoria|sveglia|timer|nota|note|memoria|ricordati|ricordami)\b",
    _nav_re.I,
)  # V50.z446 — tolti pun/arera/tariffe/energia/luce/gas: sono fatti di MERCATO (→ informativi), non dati interni del CRM


_RX_INFO_TOPIC = _nav_re.compile(
    r"\b(borsa|borse|mercat[oi]|piazza affari|ftse|mib|nasdaq|dow jones|s&p|wall street|azion[ei]|titol[oi]|obbligazion\w*|btp|spread|bitcoin|crypto|ethereum|"
    r"cambio|euro ?dollaro|dollaro|sterlina|oro|petrolio|brent|inflazione|bce|fed|tassi|quotazion\w*|notizi\w*|news|cronaca|politica|governo|elezion\w*|"
    r"sciopero|traffico|incidente|terremoto|allerta|partita|serie a|champions|campionato|risultat[oi]|classifica|olimpiadi|formula 1|motogp|"
    r"prezzo|prezzi|costa|costano|offerte|sconti|uscita|lancio|film|concerto|evento|festival|sondagg\w*|"
    r"pun|ipex|gme|mgp|arera|energia elettrica|borsa (dell'|dell’|del |di )?(energia|gas)|enel|terna|a2a|snam|italgas|hera|titoli energetici|mercato (elettrico|energetico|del gas|dell'energia)|prezzo (unico nazionale|dell'energia|del gas)|kwh|mwh|smc)\b", _nav_re.I)  # V50.z446
_RX_INFO_TIME = _nav_re.compile(r"\b(oggi|ieri|stamattina|stasera|adesso|ora|attual\w*|ultim[aeio]\w*|in tempo reale|live|aggiornat\w*|com'?[èe] andat[ao]|come (è|e') andat[ao]|cosa (è )?success[oa]|che (è )?success[oa]|novità|recent\w*|questa settimana|questo mese|\d{4})\b", _nav_re.I)


_RX_INFO_QUESTION = _nav_re.compile(
    r"^\s*(axon[,!]?\s*)?(qual[ie]?\s+(è|e'|sono|era|erano)|quali\s+sono|quando\s+(è|e'|sarà|sara|inizia|finisce|scade|esce|cade)|dove\s+(è|e'|si\s+trova|si\s+tiene|si\s+gioca)|"
    r"perch[eé]\s|come\s+(funziona|funzionano|si\s+(calcola|fa|usa|ottiene|richiede|chiama|dice))|quant[oiae]\s+(è|e'|sono|costa|costano|vale|valgono|dura|pesa|misura|guadagna)|"
    r"che\s+cos[a']?\s*[èe']|cos'?[èe]\s|chi\s+(è|e'|era|sono|ha)|esiste|conviene|è\s+vero\s+che|differenza\s+tra|significa|vuol\s+dire|cosa\s+(prevede|dice|succede|cambia)\s)", _nav_re.I)


_RX_DATA_REQUEST = _nav_re.compile(
    r"\b(numero (di )?(telefono|cellulare|fisso|verde)|telefono|cellulare|recapito|indirizzo( email| mail| pec)?|e-?mail|pec|orari\w*( di apertura)?|"
    r"partita iva|p\.? ?iva|codice fiscale|iban|pod|pdr|sito web|a che ora|quando (apre|chiude|scade)|data di (nascita|scadenza)|cap\b|prefisso)\b", _nav_re.I)


def _nav_is_info_query(msg: str) -> bool:
    """Domanda informativa / di ricerca generale (NON navigazione, NON dato del CRM)."""
    t = (msg or "").strip()
    if not t or _RX_NAV_EXPLICIT.search(t):
        return False
    # V50.z445 — argomenti «fatti attuali» (borsa, mercati, notizie, sport, prezzi…) sono informativi ANCHE senza «oggi/ieri» o «?»
    # V50.z449 — domande di conoscenza generale («qual è…», «come funziona…», «quanto costa…») senza riferimenti al CRM → ricerca diretta
    general_q = bool(_RX_INFO_QUESTION.search(t)) and not _RX_CRM_WORDS.search(t) and not _nav_is_creative(t) and len(t.split()) <= 40
    if not _RX_INFO_GENERAL.search(t) and not _RX_INFO_TOPIC.search(t) and not general_q:
        return False
    # «numero di telefono di Mario Rossi» con Mario Rossi nel CRM → lo decide l'AI con i dati CRM (PRIORITÀ CRM), ma la ricerca
    # web resta disponibile come fallback: qui basta che non sia una domanda SOLO interna (agenda, pratiche, PUN…)
    internal_only = _RX_CRM_WORDS.search(t) and not _nav_re.search(r"\b(numero|telefono|indirizz\w*|orari\w*|sito|chi [èe]|cerca\w*|trova\w*|notizi\w*|recension\w*|meteo|prezz\w*|quanto cost\w*)\b", t, _nav_re.I)
    return not internal_only


def _nav_intent(msg: str) -> str:
    """'navigate' | 'info' | 'crm' (CRM operativo o conversazione: nessuna mappa, nessun marker)."""
    t = (msg or "").strip()
    if not t:
        return "crm"
    if _RX_NAV_EXPLICIT.search(t) and not _nav_is_creative(t):
        return "navigate"
    if _nav_is_info_query(t):
        return "info"
    return "crm"


# ---------------------------------------------------------------------------
# SEZIONI DEL PROMPT
# ---------------------------------------------------------------------------
def _nav_prompt_section(user: dict, msg: str) -> str:
    """Mappa dell'app + regola dei deep link: SOLO quando l'utente chiede esplicitamente di aprire/trovare una sezione."""
    master = _nav_is_master(user)
    lines = [
        "🧭 NAVIGATORE APP (l'utente ha chiesto ESPLICITAMENTE di aprire/trovare una sezione dell'app)",
        "Rispondi con 1-2 frasi su cosa fa la funzione + deep link nel formato ESATTO [[NAV:<route>|<etichetta breve>]] (uno per riga, in fondo, max 3; l'app lo rende pulsante). "
        "MAI descrivere il percorso a parole («vai in Impostazioni → Generale»). Route con {id} → contact_id reale se lo conosci, altrimenti /contatti. "
        "LINGUA / TONO / VOCE / NOME di Axon → [[NAV:/impostazioni?section=assistente|Impostazioni AxonOS · Assistente]]. "
        "Funzione inesistente (tema scuro, firma digitale, pagare bollette, saldo conto, prenotare voli, videochiamate, SMS massivi) → «Questa funzione non è disponibile in AdvisorOS.»",
        "Bisogni vaghi → " + "; ".join(f"«{v}» → {', '.join(_NAV_BY_ID[i]['name'] for i in ids if i in _NAV_BY_ID)}" for v, ids in VAGUE_MAP) + ".",
        "",
        "ELENCO SCHERMATE (nome · route; descrizione completa solo per le pertinenti):",
    ]
    hints = _nav_match(msg, user, limit=6) if msg else []
    hint_ids = {h["id"] for h in hints}
    cur = None
    for e in APP_MAP:
        if e.get("master_only") and not master:
            continue
        if e["group"] != cur:
            cur = e["group"]; lines.append(f"[{cur}]")
        lines.append(f"- {e['name']} · {e['route']} · {e['desc']}" if e["id"] in hint_ids else f"- {e['name']} · {e['route']}")
    if hints:
        lines.append("")
        lines.append("SUGGERIMENTI PER QUESTO MESSAGGIO: " + " ".join(_nav(h["route"], h["name"]) for h in hints))
    return "\n".join(lines)


_NAV_INFO_SECTION = (
    "\n\n🔎 DOMANDA INFORMATIVA / RICERCA GENERALE (questa istruzione PREVALE sul blocco PRODOTTO e su «domande fuori contesto»): "
    "l'utente vuole un'informazione, non una funzione dell'app. Rispondi DIRETTAMENTE con il dato richiesto usando la sezione RICERCA WEB AGGIORNATA "
    "(cita la fonte in coda) e, se la domanda riguarda una persona/azienda presente nel CRM, PRIMA i dati del CRM. "
    "VIETATO: marker [[NAV:…]]/[[ACTION:…]], rimandare alle funzioni dell'app, «Non è il mio campo». "
    "Se la ricerca non ha trovato nulla, dillo in UNA riga («Non ho trovato <cosa> online») senza inventare.\n"
)
_NAV_NO_MARKER_SECTION = (
    "\n\nNAVIGAZIONE: l'utente NON ha chiesto di aprire una sezione dell'app → nessun marker [[NAV:…]] in questa risposta "
    "(i deep link si usano solo quando chiede esplicitamente «apri / vai a / dove trovo»).\n"
)

_nav_prev_prepare = _prepare_assistant_prompt  # noqa: F821 — definita nei moduli precedenti

def _nav_position_section(ctx: Optional[dict]) -> str:
    """V50.z291 — Sezione «POSIZIONE ATTUALE»: route del client → voce della mappa app (nome, gruppo, descrizione)."""
    if not isinstance(ctx, dict):
        return ""
    route = str(ctx.get("route") or "").strip()
    if not route:
        return ""
    path = route.split("?")[0].rstrip("/") or "/"
    params = ctx.get("params") if isinstance(ctx.get("params"), dict) else {}
    title = str(ctx.get("title") or "").strip()
    hit = None
    for e in APP_MAP:  # match esatto, poi per prefisso (route dinamiche tipo /contact/abc)
        if (e.get("route") or "").split("?")[0].rstrip("/") == path:
            hit = e; break
    if not hit:
        cands = [e for e in APP_MAP if path.startswith((e.get("route") or "").split("?")[0].rstrip("/") + "/") and len(e.get("route") or "") > 1]
        hit = max(cands, key=lambda e: len(e.get("route") or ""), default=None)
    name = hit["name"] if hit else (title or path)
    desc = f" — {hit['desc']}" if hit and hit.get("desc") else ""
    grp = f" [{hit['group']}]" if hit and hit.get("group") else ""
    prm = (" · parametri: " + ", ".join(f"{k}={str(v)[:40]}" for k, v in list(params.items())[:6])) if params else ""
    return ("\n\n📍 POSIZIONE ATTUALE DELL'UTENTE (in tempo reale, dal client): schermata «" + name + "»" + grp + " · route " + route[:160] + prm + desc + ".\n"
            "REGOLE: (1) quando chiede aiuto, indicazioni o segnala un problema, parti da QUESTA schermata («qui dove sei, tocca…»); "
            "(2) NON rimandarlo alla schermata in cui si trova già e non chiedergli dove si trova; (3) se la soluzione è altrove, indica il percorso da qui con il marker NAV; "
            "(4) se segnala un bug, riferiscilo a questa schermata e route nella descrizione del problema.")


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _nav_prev_prepare(user, body)
    if not (isinstance(prep, dict) and isinstance(prep.get("system_message"), str)):
        return prep
    try:
        msg = getattr(body, "message", None) or (body.get("message") if isinstance(body, dict) else "") or ""
        ctx = getattr(body, "client_context", None) or (body.get("client_context") if isinstance(body, dict) else None) or (user.get("_client_ctx") if isinstance(user, dict) else None)
        lite = _user_product(user) == "lite"  # noqa: F821 — Lite non ha le schermate AdvisorOS
        intent = "crm" if lite else _nav_intent(msg)
        voice_block = ""
        if isinstance(ctx, dict) and ctx.get("voice"):  # V50.z305 — VOCE BREVE (in testa e in coda al prompt)
            voice_block = ("🔊 REGOLA ASSOLUTA PESO 100 — MODALITÀ VOCE: l'utente ha PARLATO e la risposta verrà LETTA ad alta voce. "
                           "Rispondi come al telefono: massimo 3 frasi brevi (≤ 60 parole totali), linguaggio naturale. VIETATO: tabelle Markdown, elenchi, titoli #, grassetti, emoji, link. "
                           "Se la risposta avrebbe bisogno di una tabella (PUN, listini, storici): di' a voce solo i 2-3 numeri chiave in una frase. "
                           "Questa regola prevale su qualsiasi altra regola di formato (anche quelle insegnate dal Master) finché l'utente parla a voce.\n\n")
        section = ""
        if intent == "navigate":
            section = "\n\n" + _nav_prompt_section(user, msg) + _nav_position_section(ctx)
            pro = await _nav_proactive_hints(user)
            if pro:
                section += "\n\nSUGGERIMENTO PROATTIVO (solo se pertinente, con il suo marker): " + pro[0]["text"] + " " + _nav(pro[0]["route"], pro[0]["label"])
        elif intent == "info":
            section = _NAV_INFO_SECTION + (_nav_position_section(ctx) if not lite else "")
        else:
            section = ("" if lite else _NAV_NO_MARKER_SECTION) + (_nav_position_section(ctx) if not lite else "")
        if not lite and prep.get("query_class") != "simple":
            section += "\n" + _nav_style_rules(msg)
        # V50.z452 — RISPOSTE MINIMALISTE: richiesta di un dato secco → istruzione + tetto di token; voce → tetto di token
        is_data_req = bool(_RX_DATA_REQUEST.search(msg)) and not _nav_is_creative(msg)
        if is_data_req:
            section += ("\n\n📌 RICHIESTA DI UN DATO: rispondi SOLO con il dato richiesto (es. «Il numero è 0424 123456.»). Se non lo hai → una sola riga "
                        "(«Non ho trovato il numero di X.»). VIETATO: elenchi, alternative, spiegazioni, «vuoi che…?», premesse, emoji.\n")
            prep["max_tokens"] = 70
            prep["data_request"] = True  # V50.z453 — lo stream mostra SOLO il dato: niente fonte/link/chip
        if voice_block:
            prep["max_tokens"] = min(prep.get("max_tokens") or 180, 180)
        prep["system_message"] = voice_block + prep["system_message"] + section + ("\n\n" + voice_block if voice_block else "")
        prep["nav_intent"] = intent
        try:  # telemetria dimensione prompt
            await db.axon_prompt_size.update_one({"_id": "last"}, {"$set": {"total": len(prep["system_message"]), "navigator": len(section), "query_class": prep.get("query_class") or "crm", "nav_intent": intent, "at": utcnow()}}, upsert=True)
        except Exception:  # noqa: BLE001
            pass
    except Exception as e:
        logger.warning("[NAV] prompt section failed: %s", e)
    return prep


# ---------------------------------------------------------------------------
# PARTE 3 + 5 — Intercettori deterministici (prima dell'LLM)
# ---------------------------------------------------------------------------
_RX_LOST = _nav_re.compile(r"\b(mi sono pers[oa]|non so (da dove|come) (iniziare|cominciare|partire|muovermi)|da dove (inizio|comincio|parto)|come (si usa|funziona) (l app|l'app|advisoros|questa app)|cosa (posso|so) fare (qui|con l'app|con l app))\b", _nav_re.I)
_RX_KPI = _nav_re.compile(r"\b(come sto andando|come (vanno|stanno andando) (le cose|gli affari|le vendite|i miei numeri)|(i miei|le mie) (numeri|risultati|kpi|statistiche)|voglio sapere come (sto|vado)|se sto lavorando bene|sto lavorando bene|come sto lavorando)\b", _nav_re.I)
_RX_CALLBACK = _nav_re.compile(r"\b(devo|dovrei|voglio|chi devo|ho da) richiamare\b|\bda richiamare\b|\bmostra(mi)? le ritelefonate\b|\bdove (sono|trovo|vedo) le ritelefonate\b", _nav_re.I)
_RX_DOCS = _nav_re.compile(r"\bdove (metto|carico|salvo|archivio|trovo|vedo|tengo) (i |le |la |il |un |una )?(documenti|file|pdf|bollette|fatture|contratti|listini|moduli)\b", _nav_re.I)
_RX_HOWTO = _nav_re.compile(r"\b(come (faccio|posso|si fa) (a |per )?(impostare|configurare|attivare|disattivare|cambiare|modificare|settare|abilitare|personalizzare)|dove (imposto|configuro|attivo|cambio|modifico|trovo l impostazione|trovo l'impostazione))\s+(?P<x>.{2,80})", _nav_re.I)
_RX_GOTO = _nav_re.compile(r"^\s*(devo|dovrei|vado|andro|andrò|sto andando|voglio andare|passo|passero|passerò|devo passare|devo andare|dovrei andare|dovrei passare)\s+(andare\s+|passare\s+)?(da|dal|dalla|dallo|dai|a trovare|a casa di|in ufficio da|dal cliente|dalla cliente)\s+(?P<name>[a-zA-ZÀ-ÿ'’\. ]{2,60}?)\s*(?:[,;:].{0,60})?[\.\!\?]*\s*$", _nav_re.I)
_RX_MISSED = _nav_re.compile(r"\b(sposta|spostare|spostami|rimanda|rimandare|riprogramma|riprogrammare|posticipa)\b.*\bappuntament\w*\b.*\b(mancat\w*|pers\w*|saltat\w*|non fatt\w*|non svolt\w*)\b|\bappuntament\w*\s+mancat\w*\b.*\b(sposta|rimanda|domani|riprogramma)\w*", _nav_re.I)
_RX_LOSTTOUCH = _nav_re.compile(r"\b(perso il filo|perso di vista|persi di vista|non (vedo|visito|sento|seguo) da (tanto|molto|tempo|un pezzo|mesi)|clienti (trascurati|dimenticati|abbandonati|che non visito)|chi non (visito|vedo|sento) da (tempo|mesi|tanto)|clienti non visitati)\b", _nav_re.I)
_RX_ORGANIZE = _nav_re.compile(r"\b(devo|voglio|vorrei|aiutami a|come faccio a|come posso) organizzar(mi|e)\b|\borganizzarmi meglio\b|\bmettere ordine\b|\bpianificare (la|questa) (settimana|giornata)\b|\bcome organizzo (la|questa) (settimana|giornata)\b", _nav_re.I)

_RX_TRAP = _nav_re.compile(r"\b(tema scuro|dark mode|modalit[àa] scura|firm\w* digital\w*|pagare? (le |la )?bollett\w*|saldo (del )?conto|conto corrente|prenot\w* (un |il )?(volo|voli|hotel|treno)|negozio (per |di |online|gadget)|gadget aziendal\w*|fatture (emesse|che ho emesso|della mia azienda)|videochiamat\w*|videoconferenz\w*|sms (massiv\w*|a tutti)|traduzione automatica|modalit[àa] offline|registratore di cassa)\b", _nav_re.I)
_RX_BILL_FLOW = _nav_re.compile(r"\b(leggi|analizza|analizzare|controlla|guarda|confronta|confronto|conviene|risparmi\w*|fotografa)\b.*\b(fattur\w*|bollett\w*|offert\w*|luce|gas)\b|\b(fattur\w*|bollett\w*)\b.*\b(conviene|analizz\w*|confront\w*|leggi)\b", _nav_re.I)
_RX_CONTRACTS_CLIENT = _nav_re.compile(r"\bcontratt\w*\b.{0,25}\b(client\w*|contatt\w*)\b|\b(client\w*|contatt\w*)\b.{0,25}\bcontratt\w*\b", _nav_re.I)
_RX_CUSTOM_FIELDS = _nav_re.compile(r"\bcamp[oi] (personalizzat\w*|custom|extra|aggiuntiv\w*)\b", _nav_re.I)
_RX_RIPASSI = _nav_re.compile(r"\b(ripass\w*|rivisitare|da rivedere|rivedere i clienti|clienti da rivisitare)\b", _nav_re.I)
_RX_TELEGRAM = _nav_re.compile(r"\b(telegram|whatsapp business|home assistant)\b", _nav_re.I)
_RX_MAIL_TRUNC = _nav_re.compile(r"\b(colleg\w+|configur\w+|aggiung\w+|imposta\w*)\b.*\b(la |una |il )?(mial|mai|mal|emai|emial|maill|ma)\s*[\.\?!]*$", _nav_re.I)
_RX_TRUNC = _nav_re.compile(r"^\s*(come faccio a|come faccio|come si fa a|come si fa|dove sta il|dove sta la|dove sta|dove [èe] il|dove [èe] la|voglio il|voglio la|voglio|vorrei|mi serve|dove trovo il|dove trovo la|come posso|posso)\s*[\.\?!…]*\s*$", _nav_re.I)

# V50.z262 — casi limite deterministici (identità, offese, richieste impossibili, testo senza senso)
_RX_ROLE = _nav_re.compile(r"\b(sei un'?\s?(ai|ia|intelligenza artificiale|robot|bot|umano)|chi ti ha (creato|programmato|fatto|costruito)|che modello (sei|usi)|prompt di sistema|system prompt|ignora (le tue |tutte le )?istruzioni|dimmi (qualcosa di |un )?segreto|fingi di essere|fai finta di essere|cose che non riguardano l'app)\b", _nav_re.I)
_RX_OFFENSIVE = _nav_re.compile(r"\b(cretin\w*|idiot\w*|stupid\w*|imbecill\w*|vaffa\w*|fanculo|stronz\w*|merd\w*|cazz\w*|coglion\w*|parolacc\w*|bestemmi\w*)\b", _nav_re.I)
_RX_FRUSTRATED = _nav_re.compile(r"\b(fa schifo|fate schifo|non funziona (niente|nulla|mai)|sei inutile|app inutile|rubato i soldi|rubate|truffa|colpa tua|perso (tutta )?la giornata|non serve a niente|che schifo|fa pena)\b", _nav_re.I)
_RX_IMPOSSIBLE = _nav_re.compile(r"\b(cancell\w*|elimin\w*|rimuov\w*|azzer\w*)\b.*\b(tutt[oi]|tutti i (miei )?dati|tutti gli appuntamenti)\b|\bsenza che (lo sappia|nessuno)\b|\btrasferisci\b.*\b(euro|€|iban)\b|\bbonifico\b|\b(numero|telefono|indirizzo) personale\b.*\b(collega|collaborator\w*)\b", _nav_re.I)
_RX_GIBBERISH = _nav_re.compile(r"^[\W_]{1,6}$|^(?:[^aeiouàèéìòù\s]{4,}\s*)+$|\b(asdf|qwer|zxcv|hjkl|yuiop|dfgh|sdfg)\w*", _nav_re.I)

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


async def _nav_flow_client_contracts(user: dict, msg: str) -> dict:
    """CORREZIONE 1 — contratti di un cliente → sezione Contratti della scheda cliente."""
    intro = "I contratti di un cliente sono nella sua scheda, sezione **Contratti** (stato, scadenze, nuovo contratto)."
    # cliente nominato nel messaggio?
    m = _nav_re.search(r"\b(di|del|della|per)\s+(?P<name>[A-Z][a-zA-ZÀ-ÿ']+(?:\s+[A-Z][a-zA-ZÀ-ÿ']+)?)", msg)
    if m:
        c = await _nav_find_contact(user, m.group("name"))
        if c:
            return _nav_reply(intro + "\n" + _nav(f"/contact/{c['contact_id']}?tab=contracts", f"📄 Contratti di {_nav_cname(c)}"))
    q = {"user_id": tenant_id(user)}  # noqa: F821
    if not is_owner(user):  # noqa: F821
        q["created_by"] = user["user_id"]
    ids = await db.contracts.distinct("contact_id", q)  # noqa: F821
    ids = [i for i in ids if i][:3]
    marks = []
    for cid in ids:
        c = await db.contacts.find_one({"contact_id": cid}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1})  # noqa: F821
        if c:
            marks.append(_nav(f"/contact/{cid}?tab=contracts", f"📄 Contratti di {_nav_cname(c)}"))
    marks.append(_nav("/contatti", "👥 Scegli il cliente → tab Contratti"))
    return _nav_reply(intro + "\n" + "\n".join(marks[:3]))


async def _nav_flow_ripassi(user: dict) -> dict:
    try:
        due = await _cv_due_list(tenant_id(user), 10)  # noqa: F821
    except Exception:
        due = []
    if not due:
        return _nav_reply("Nessun ripasso in scadenza: tutti i clienti con frequenza di ripasso sono stati visitati in tempo. 👍\n" + _nav("/calendario?view=week", "📅 Calendario settimana") + "\n" + _nav("/optimal-route", "🗺️ Giro ottimale"))
    lines = [f"Hai {len(due)} client{'e' if len(due) == 1 else 'i'} da rivisitare (ripasso scaduto):"]
    for d in due:
        od = d.get("overdue_days")
        lines.append(f"• {d['name']}" + (f" · {d['city']}" if d.get("city") else "") + (f" — in ritardo di {od} gg" if od is not None else " — mai visitato"))
    ids = ",".join(d["contact_id"] for d in due[:10])
    lines.append(_nav(f"/optimal-route?contacts={ids}", "🗺️ Giro ottimale per i ripassi"))
    lines.append(_nav("/calendario?view=week", "📅 Pianifica nel calendario"))
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
    if "modul" in m:  # V50.z277 — moduli PDF da compilare → Modelli moduli
        return _nav_reply("I moduli aziendali (contratti, deleghe, privacy…) si caricano in **Modelli moduli**: Axon rileva i campi e li compila con i dati del cliente; il PDF compilato è pronto per stampa e firma.\n"
                          + _nav("/form-templates", "📝 Modelli moduli") + "\n" + _nav("/axon-lab", "🧪 Axon Lab"))
    if "cors" in m or "attestat" in m or "slide" in m:  # V50.z277 — materiali/attestati/slide dei corsi → Area Corsi
        return _nav_reply("I materiali dei corsi (PDF, foto, audio, PowerPoint) e gli attestati di partecipazione sono nella cartella del corso in **Area Corsi**.\n"
                          + _nav("/courses", "🎓 Area Corsi"))
    if "contratt" in m:  # V50.z309 — contratti firmati/dei collaboratori → Nuovo contratto (+ pannello Master, + CRT per compilarne uno)
        return _nav_reply("Un contratto firmato lo registri da **Nuovo contratto** (dati, importo/commissione, foto o PDF): finisce nella scheda del cliente, nelle scadenze e nel pannello **Contratti (Master)**. Per compilare una pratica da zero usa **Compilazione CRT**.\n"
                          + _nav("/contract/new", "📝 Nuovo contratto") + "\n" + _nav("/master", "📋 Contratti (Master)") + "\n" + _nav("/crt", "🧾 Compilazione CRT"))
    if any(k in m for k in ["bollett", "fattur"]):
        return _nav_reply("Le bollette si fotografano e analizzano in **Analisi fatture**; restano poi nella scheda del cliente (tab Fatture).\n"
                          + _nav("/bill-quick", "🧾 Analisi fatture") + "\n" + _nav("/scanner", "📷 Scanner"))
    return _nav_reply("I documenti condivisi dall'azienda sono nell'**Archivio file**; i tuoi file personali nello **Spazio personale**; per digitalizzare un foglio usa lo **Scanner**.\n"
                      + _nav("/master-files", "🗂️ Archivio file") + "\n" + _nav("/spazio-personale", "📁 Spazio personale") + "\n" + _nav("/scanner", "📷 Scanner"))


def _nav_flow_howto(user: dict, x: str) -> "dict | None":
    hits = _nav_match(x, user, limit=3)  # x = messaggio completo (verbo incluso)
    if not hits:
        return None
    top = hits[0]
    txt = f"**{top['name']}** — {top['desc']}\n" + _nav(top["route"], f"⚙️ Apri {top['name']}")
    for h in hits[1:]:
        txt += "\n" + _nav(h["route"], h["name"])
    return _nav_reply(txt)




# ---------------------------------------------------------------------------
# INTERCETTORE (prima dell'LLM): guardie di sicurezza + flussi SOLO con intento esplicito
# ---------------------------------------------------------------------------
_RX_NAV_MARK = _nav_re.compile(r"[ \t]*\[\[(NAV|ACTION):[^\]]*\][ \t]*\n?")
_RX_CREATIVE = _nav_re.compile(
    r"(\b(scriv\w*|redig\w*|compon\w*|traduc\w*|riformul\w*|riscriv\w*|correggi (il|la|questo|questa)|sintetizz\w*|invent\w*|prepara(mi)? (un|una|il|la) (discorso|mail|email|testo|messaggio|post|script))\b"
    r"|\b\d+\s*(parole|righe|versi|frasi|punti|paragrafi)\b|\bdiscorso\b|\bpoesia\b|\bslogan\b)", _nav_re.I)
_RX_GREETING = _nav_re.compile(r"\b(grazie|bravo|brava|ottimo lavoro|complimenti|buongiorno|buonasera|buonanotte|ciao|ehi|hey)\b", _nav_re.I)


_RX_THINKING_ALOUD = _nav_re.compile(
    r"^\s*(axon[,!]?\s*)?(ci sto pensando|sto pensando|fammi pensare|lasciami pensare|ci penso|ci devo pensare|devo pensarci|un attimo che penso|"
    r"sto riflettendo|mi sto organizzando|sto guardando|sto leggendo|sto controllando|vediamo|dunque|allora|mmm+|ehm+|uhm+)[\s.!…,]*$", _nav_re.I)


def _nav_is_creative(t: str) -> bool:
    return bool(_RX_CREATIVE.search(t or ""))


def _nav_is_conversation(msg: str) -> bool:
    """Tutto ciò che non è navigazione esplicita è «conversazione» per il Navigatore: niente marker."""
    return _nav_intent(msg) != "navigate"


_RX_SEARCH_OFFER = _nav_re.compile(
    r"(?i)(?:(?<=^)|(?<=[.!?\n])|(?<=[.!?]\s))\s*(vuoi|desideri|preferisci|posso|devo|ti va)\s+(che\s+)?(io\s+)?(cerchi|cerco|cercare|controlli|controllo|controllare|verifichi|verifico|verificare|approfondisca|approfondisco|"
    r"attivi|attivo|faccia|faccio|fare|effettui|effettuo|avvii|avvio|lanci|lancio|provi|provo)[^\n?]{0,120}?(ricerca|cerc\w*|online|web|internet|aggiornat\w*|dati|fonti|gme|borsa)[^\n?]{0,80}?\?[ \t]*")


def _nav_bare_datum(reply: str) -> str:
    """V50.z453 — risposta a una richiesta di dato secco: solo il dato. Via marker, grassetti, righe «Fonte/Fonti/🌐/http», max 2 righe."""
    txt = _RX_NAV_MARK.sub("\n", reply or "")
    txt = _nav_re.sub(r"\*\*|__|`", "", txt)
    lines = []
    for ln in txt.splitlines():
        l = ln.strip()
        if not l:
            continue
        if _nav_re.match(r"^(fonte|fonti|source|sources)\b", l, _nav_re.I) or "http://" in l or "https://" in l or l.startswith(("🌐", "📎", "🔗")):
            continue
        l = _nav_re.sub(r"\s*\((?:fonte|fonti|source)[^)]*\)\s*$", "", l, flags=_nav_re.I)
        lines.append(l)
        if len(lines) >= 2:
            break
    return _nav_strip_search_offers("\n".join(lines).strip()) or (reply or "").strip()


def _nav_strip_search_offers(reply: str) -> str:
    """V50.z449 — rimuove frasi tipo «Vuoi che cerchi online?» / «Vuoi che attivi la ricerca web?» (regola assoluta 10)."""
    if not reply or "?" not in reply:
        return reply
    out = _RX_SEARCH_OFFER.sub("", reply)
    return _nav_re.sub(r"\n{3,}", "\n\n", out).strip() if out != reply else reply


def _nav_strip_if_conversation(msg: str, reply: str) -> str:
    """Zero marker nelle risposte quando l'utente non ha chiesto di aprire una sezione (anche se il modello li ha aggiunti)."""
    reply = _nav_strip_search_offers(reply)
    if reply and _nav_is_conversation(msg) and ("[[NAV:" in reply or "[[ACTION:" in reply):
        logger.info("[NAV] marker rimossi: nessuna richiesta di navigazione «%s»", (msg or "")[:60])
        return _RX_NAV_MARK.sub("\n", reply).strip()
    return reply


def _nav_template_reply(msg: str, user: dict) -> Optional[dict]:
    """Template «Apri X» SOLO con intento esplicito e match netto su una voce della mappa."""
    t = (msg or "").strip()
    if not _RX_NAV_EXPLICIT.search(t) or len(_nav_norm(t).split()) > 30:
        return None
    mt = _nav_tokens(t)
    master = _nav_is_master(user)
    best, best_score, second = None, 0, 0
    for e in APP_MAP:
        if (e.get("master_only") and not master) or "{id}" in e["route"]:
            continue
        score = _nav_score(e, mt)
        if score > best_score:
            best, best_score, second = e, score, best_score
        elif score > second:
            second = score
    if not best or best_score < 5 or (best_score == second and best_score < 9):
        return None  # ambiguo → lo decide l'AI con la mappa nel prompt
    return _nav_reply(f"**{best['name']}** — {best['desc']}\n" + _nav(best["route"], best.get("label") or f"Apri {best['name']}"))


async def _nav_intercept(msg: str, user: dict):
    """None = lascia rispondere l'AI (con la sezione giusta nel prompt)."""
    try:
        t = (msg or "").strip()
        if not (1 <= len(t) <= 220):
            return None
        if _RX_WAIT.match(t) or _RX_THINKING_ALOUD.match(t):  # V50.z448 — «aspetta» / «ci sto pensando»: non è una domanda → NESSUNA risposta
            return _nav_reply("")
        # guardie di sicurezza (sempre)
        if _RX_IMPOSSIBLE.search(t) and not _nav_re.search(r"\bneo\b|\bprompt", t, _nav_re.I):
            return _nav_reply("Non posso eseguire questa operazione: è irreversibile o riguarda dati di altre persone e non è consentita dall'assistente. Se vuoi cancellare i tuoi dati, la richiesta ufficiale si fa dall'Help Center.\n" + _nav("/help-center?deletion=1", "🛟 Richiesta cancellazione dati"))
        if _RX_TRAP.search(t) and not _nav_is_info_query(t):
            return _nav_reply("Questa funzione non è disponibile in AdvisorOS.")
        if _nav_intent(t) != "navigate":
            return None  # informativa / CRM / conversazione → AI (con ricerca web se informativa)
        # flussi deterministici con intento esplicito
        if _RX_BILL_FLOW.search(t):
            return _nav_reply("Analisi fattura: fotografa o carica la bolletta, Axon estrae i dati e confronta le offerte luce/gas.\n" + _nav("/bill-quick", "🧾 Analisi fattura e confronto offerte"))
        if _RX_CUSTOM_FIELDS.search(t):
            return _nav_reply("I campi personalizzati della scheda cliente si configurano qui.\n" + _nav("/custom-fields", "🧩 Campi personalizzati"))
        if _RX_TELEGRAM.search(t):
            return _nav_reply("I servizi esterni si collegano dalla sezione Integrazioni.\n" + _nav("/axon-integrations", "🔌 Integrazioni"))
        if _RX_RIPASSI.search(t):
            return await _nav_flow_ripassi(user)
        m = _RX_GOTO.match(t)
        if m:
            return await _nav_flow_goto(user, m.group("name"))
        if _RX_MISSED.search(t):
            return await _nav_flow_missed(user)
        if _RX_LOSTTOUCH.search(t):
            return await _nav_flow_losttouch(user)
        if _RX_ORGANIZE.search(t):
            return await _nav_flow_organize(user)
        if _RX_CALLBACK.search(t):
            return await _nav_flow_callbacks(user)
        if _RX_DOCS.search(t):
            return _nav_flow_docs(t)
        hm = _RX_HOWTO.search(t)
        if hm:
            r = _nav_flow_howto(user, t)
            if r:
                return r
        return _nav_template_reply(t, user)
    except Exception as e:
        logger.warning("[NAV] intercept failed: %s", e)
    return None


_nav_prev_push = _maybe_push_command  # noqa: F821
_NAV_NOLINK_OK = ("OK!", "Questa funzione non è disponibile", "Non posso eseguire")


async def _maybe_push_command(msg: str, user: dict):  # noqa: F811
    """Stream: prima il Navigatore (solo navigazione esplicita / guardie), poi la catena precedente (push/neo)."""
    r = None if _user_product(user) == "lite" else await _nav_intercept(msg, user)  # noqa: F821
    if r:
        rep = r.get("reply") or ""
        if "[[NAV:" not in rep and "[[ACTION:" not in rep and not rep.startswith(_NAV_NOLINK_OK):
            r["missing_deeplink"] = True
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
        user["_client_ctx"] = body.client_context  # V50.z291
        r = None if _user_product(user) == "lite" else await _nav_intercept(body.message or "", user)  # noqa: F821
        if r and r.get("reply") == "":  # V50.z448 — silenzio voluto (utente sta pensando): nessun messaggio salvato, nessuna bolla
            return {"session_id": body.session_id or "", "message_id": "", "reply": "", "used_web_search": False, "web_sources": [], "nav": True, "silent": True}
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
        out = await _nav_orig_chat(body, user)
        if isinstance(out, dict) and out.get("reply"):
            out["reply"] = _nav_strip_if_conversation(body.message or "", out["reply"])
            _phone = _axon_phone_only_reply(body.message or "", out["reply"])  # noqa: F821 — V50.z455: numero di telefono → SOLO il numero
            if _phone:
                out["reply"] = _phone; out["web_sources"] = []; out["used_web_search"] = False
            elif _RX_DATA_REQUEST.search(body.message or "") and not _nav_is_creative(body.message or ""):  # V50.z453 — solo il dato
                out["reply"] = _nav_bare_datum(out["reply"]); out["web_sources"] = []; out["used_web_search"] = False
        return out


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
    elif body.action in ("send_email", "open_whatsapp"):  # V50.z458 — chip dell'agente multi-step (axon_agent.py)
        reply = await _agent_nav_action(body.action, body.payload or {}, user)  # noqa: F821
        if reply is None:
            raise HTTPException(status_code=400, detail="Azione non riconosciuta")
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

