/**
 * V50.l — Libretto Informativo AdvisorOS + AxonOS
 * V50.v — Refactor: struttura serializzabile (image_key + image_data_url)
 *
 * Il contenuto di default è statico ma viene sovrascritto dai dati salvati
 * dal Super Master in `GET /api/libretto/content`. Il frontend prova prima
 * il backend, poi il fallback qui sotto.
 */

export type LibrettoTip = { emoji: string; text: string };
export type LibrettoMockup = { title: string; lines: string[] };

export type LibrettoSection = {
  id: string;
  icon: string; // Ionicons name
  emoji: string;
  color: string; // hex tinta della sezione
  title: string;
  subtitle?: string;
  paragraphs: string[];
  tips?: LibrettoTip[];
  mockup?: LibrettoMockup;
  /** Chiave di un asset bundled (mappata in LIBRETTO_IMAGE_MAP). */
  image_key?: string | null;
  /** Data URL (es. `data:image/jpeg;base64,...`) caricato dal Master. */
  image_data_url?: string | null;
  warning?: string | null;
  /** V50.z178 — icone opzionali mostrate sotto l'immagine (es. sezioni Corporate Gym). */
  icons?: { image_key: string; label: string }[];
  /** V50.z178 — immagine orizzontale (banner) invece dello screenshot verticale. */
  image_wide?: boolean;
  /** V50.z182 — frase d'impatto in evidenza (blocco scuro, testo grande). */
  highlight?: string;
  /** V50.z182 — lista visiva con icona grande (Ionicons) a fianco. */
  bullets?: { icon: string; text: string }[];
};

export type LibrettoMeta = {
  title: string;
  subtitle: string;
  version: string;
  footer: string;
};

/** Mappa image_key → require(...) per le immagini bundled default. */
export const LIBRETTO_IMAGE_MAP: Record<string, number> = {
  "01_login": require("@/assets/images/libretto/01_login.jpg"),
  "02_home": require("@/assets/images/libretto/02_home.jpg"),
  "03_contatti": require("@/assets/images/libretto/03_contatti.jpg"),
  "04_chat": require("@/assets/images/libretto/04_chat.jpg"),
  "05_nuovo_contatto": require("@/assets/images/libretto/05_nuovo_contatto.jpg"),
  "06_impostazioni": require("@/assets/images/libretto/06_impostazioni.jpg"),
  "07_biglietto": require("@/assets/images/libretto/07_biglietto.jpg"),
  "08_calendario": require("@/assets/images/libretto/08_calendario.jpg"),
  "09_report": require("@/assets/images/libretto/09_report.jpg"),
  "10_ai_teach": require("@/assets/images/libretto/10_ai_teach.jpg"),
  // Corporate Gym (banner + icone sezioni) — V50.z178
  "11_cgym_banner": require("@/assets/images/libretto/11_cgym_banner.jpg"),
  "cgym_obiezioni": require("@/assets/images/libretto/cgym_obiezioni.png"),
  "cgym_winwin": require("@/assets/images/libretto/cgym_winwin.png"),
};

/** Elenco chiavi disponibili per il selector nell'editor. */
export const LIBRETTO_IMAGE_KEYS = Object.keys(LIBRETTO_IMAGE_MAP);

export const LIBRETTO_META: LibrettoMeta = {
  title: "Libretto Informativo",
  subtitle: "AdvisorOS 2.0 + AxonOS · L'AI che vive dentro i tuoi dati",
  version: "2.0 · Settembre 2026",
  footer: "© AdvisorOS. Documento generato dall'app.",
};

export const LIBRETTO_SECTIONS: LibrettoSection[] = [
  {
    id: "intro",
    icon: "book",
    emoji: "📘",
    color: "#1C4869",
    title: "AdvisorOS 2.0 + AxonOS",
    subtitle: "AxonOS Brain+ · Il sistema operativo che potenzia il tuo cervello",
    highlight: "AxonOS Brain+ — Non dimentica nulla, non si stanca mai, conosce la tua vita. Il primo CRM dove l'intelligenza artificiale vive dentro i tuoi dati.",
    paragraphs: [
      "AdvisorOS è il sistema operativo per chiunque gestisca relazioni, scadenze e decisioni: consulenti, agenti, studi professionali, agenzie, aziende e privati. Non è un CRM con un chatbot aggiunto. È una piattaforma completa con isolamento multi-tenant, controllo dei ruoli e integrazioni cloud native.",
      "AxonOS è il motore AI nativo: conosce il tuo database in tempo reale, risponde, agisce, ricorda, impara. Non devi spiegargli chi sei ogni volta: ti conosce già.",
      "Questo libretto ti porta dal primo login all'utilizzo avanzato di ogni funzione, con esempi pratici e suggerimenti concreti.",
    ],
    tips: [
      { emoji: "🎯", text: "Segui l'ordine dei capitoli la prima volta." },
      { emoji: "💾", text: "Puoi scaricare questo libretto in PDF dal pulsante in alto." },
    ],
  },
  {
    id: "install",
    icon: "cloud-download",
    emoji: "📲",
    color: "#0F766E",
    title: "1 · Installazione",
    subtitle: "Da Play Store / App Store al primo lancio",
    paragraphs: [
      "AdvisorOS è disponibile su Google Play (Android) e su App Store (iOS). Cerca «AdvisorOS» e installa la versione ufficiale con logo blu/oro. Il download è gratuito.",
      "Alla prima apertura l'app scarica i pacchetti aggiornati (bundle) via OTA: aspetta il caricamento della splash con il logo animato.",
    ],
    mockup: {
      title: "Come si presenta",
      lines: [
        "🟦 Splash blu navy",
        "  ⭐ Logo AdvisorOS + AxonOS animato",
        "  ⏳ «Caricamento aggiornamenti...»",
      ],
    },
    tips: [
      { emoji: "📶", text: "Il primo avvio richiede connessione dati o Wi-Fi." },
      { emoji: "🔋", text: "Su Android puoi abilitare l'installazione automatica degli aggiornamenti dal Play Store." },
    ],
  },
  {
    id: "login",
    icon: "log-in",
    emoji: "🔐",
    color: "#4C1D95",
    title: "2 · Accesso e registrazione",
    subtitle: "Email + password oppure invito Master",
    image_key: "01_login",
    paragraphs: [
      "Se sei un Master, registrati con email e password. Se sei un Agente, riceverai un link di invito dal tuo Master: apriti crea la password personale e sei dentro.",
      "Puoi abilitare l'accesso biometrico (Face ID / Touch ID / Impronta) da Impostazioni → Sicurezza per accedere in un tocco.",
    ],
    tips: [
      { emoji: "🧠", text: "Password consigliata: minimo 10 caratteri, con maiuscole e numeri." },
      { emoji: "🔁", text: "Puoi resettare la password dalla stessa schermata di login." },
    ],
  },
  {
    id: "home",
    icon: "home",
    emoji: "🏠",
    color: "#EA580C",
    title: "3 · Home",
    subtitle: "Il tuo cruscotto operativo del giorno",
    image_key: "02_home",
    paragraphs: [
      "La Home mostra in alto il tuo brand personalizzato (Cognome, Nome, logo agenzia opzionale) e sotto le sezioni operative: appuntamenti di oggi, scadenze in arrivo, ultimi contatti aggiunti e KPI mensili.",
      "Ogni card è tap-friendly: toccala per andare direttamente alla sezione approfondita.",
    ],
    tips: [
      { emoji: "🔄", text: "Trascina verso il basso per aggiornare (pull-to-refresh)." },
    ],
  },
  {
    id: "contatti",
    icon: "people",
    emoji: "👥",
    color: "#1D4ED8",
    title: "4 · Contatti · Anagrafica",
    subtitle: "Il cuore del tuo CRM",
    image_key: "03_contatti",
    paragraphs: [
      "Ogni contatto ha: dati anagrafici, referente/i, aree merceologiche, tag, script personalizzato, note vocali e allegati.",
      "Puoi aggiungere campi personalizzati per adattare l'anagrafica al tuo processo commerciale (Es.: «Vendita fissa», «PV installato», «Data ultimo contratto»).",
    ],
    tips: [
      { emoji: "🎯", text: "Usa le AREE per filtrare rapidamente per servizio." },
      { emoji: "🏷️", text: "I TAG sono liberi e si aggiungono digitando." },
    ],
  },
  {
    id: "nuovo-contatto",
    icon: "person-add",
    emoji: "➕",
    color: "#16A34A",
    title: "5 · Aggiungere un contatto",
    subtitle: "5 modi rapidissimi",
    image_key: "05_nuovo_contatto",
    paragraphs: [
      "Puoi aggiungere un nuovo contatto in cinque modi:",
      "1) Manualmente compilando il form.\n2) Dal biglietto da visita (fotografato: OCR + AI).\n3) Dalla rubrica del telefono (import massivo o singolo).\n4) Da un URL / vCard (incolla e AxonOS riempie i campi).\n5) A voce, dettando i dati ad AxonOS.",
      "Al salvataggio l'app ti chiede se vuoi copiare il contatto anche nella rubrica del telefono. Se il contatto esiste già in rubrica, ti avvisa prima di creare duplicati.",
    ],
    tips: [
      { emoji: "📸", text: "Per il biglietto: buona luce, inquadratura dritta, testo nitido." },
      { emoji: "🗣️", text: "Modalità voce: «Aggiungi Mario Rossi, telefono 335 12 34 567, mail rossi at energia punto it»." },
    ],
  },
  {
    id: "appuntamenti",
    icon: "calendar",
    emoji: "📅",
    color: "#DB2777",
    title: "6 · Appuntamenti & Calendario",
    subtitle: "Prenotazione, promemoria, cronologia",
    image_key: "08_calendario",
    paragraphs: [
      "Dal contatto o dalla tab Calendario puoi creare un appuntamento: data, ora, tipologia (sopralluogo, chiamata, riunione online, ecc.), note e link Meet/Zoom.",
      "Ricevi promemoria push 30 minuti prima e vedi tutti gli appuntamenti passati per ogni contatto.",
      "La tab Calendario mostra vista giornaliera, settimanale e mensile con codice colore per tipo appuntamento.",
    ],
    tips: [
      { emoji: "⏰", text: "Doppio promemoria: 1 ora e 5 minuti prima (configurabile)." },
      { emoji: "🔗", text: "Se metti un link Meet o Zoom lo apri con un tap dalla scheda." },
    ],
  },
  {
    id: "biglietto",
    icon: "card",
    emoji: "💳",
    color: "#0891B2",
    title: "7 · Biglietto da visita digitale",
    subtitle: "Condividi il tuo profilo in un tap",
    image_key: "07_biglietto",
    paragraphs: [
      "Ogni consulente ha un biglietto digitale a due facce: fronte con logo aziendale (che ora occupa l'intero fronte come sfondo) e retro con foto, dati e QR code.",
      "Condividi il biglietto via WhatsApp, email, AirDrop o NFC. Il destinatario può salvarlo direttamente nella sua rubrica.",
      "Le statistiche mostrano quante volte è stato aperto e da quali città.",
    ],
    tips: [
      { emoji: "🖼️", text: "Logo consigliato: 900×567 px (rapporto biglietto standard)." },
      { emoji: "📊", text: "Vai a «Statistiche biglietto» per vedere aperture e provenienza." },
    ],
  },
  {
    id: "axon-chat",
    icon: "sparkles",
    emoji: "🤖",
    color: "#7C3AED",
    title: "8 · AxonOS — L'AI che conosce la tua azienda meglio di chiunque altro",
    subtitle: "Zero allegati. Zero screenshot. Zero attese.",
    image_key: "04_chat",
    paragraphs: [
      "Mentre gli altri CRM ti chiedono allegati e screenshot, AxonOS legge in tempo reale ogni contatto, ogni contratto, ogni appuntamento, ogni richiamata, ogni KPI del tuo team. In 0,03 secondi ha già tutto il contesto.",
      "Tu parli, lui agisce. Zero allegati. Zero screenshot. Zero attese. Come avere un direttore commerciale AI sempre acceso, sempre aggiornato, sempre pronto.",
    ],
    bullets: [
      { icon: "people", text: "Legge tutti i contatti in tempo reale" },
      { icon: "calendar", text: "Conosce ogni appuntamento passato e futuro" },
      { icon: "document-text", text: "Vede contratti, bollette, scadenze" },
      { icon: "stats-chart", text: "Monitora i KPI di ogni collaboratore" },
      { icon: "barbell", text: "Accede a Corporate Gym, regole, impostazioni Master" },
      { icon: "notifications", text: "Ti avvisa autonomamente con notifiche push" },
    ],
    mockup: {
      title: "Slash commands",
      lines: [
        "/aiuto        · elenco comandi",
        "/bolletta     · analizza una bolletta",
        "/scadenze     · elenco scadenze prossime",
        "/pun          · quotazioni PUN aggiornate",
        "/team         · KPI del team",
      ],
    },
    tips: [
      { emoji: "🎙️", text: "Modalità Axon Drive: usa in auto senza mani." },
      { emoji: "🧠", text: "Chiedigli «riassumi la scheda di Mario Rossi» per un briefing rapido." },
    ],
  },
  {
    id: "corporate-gym",
    icon: "barbell",
    emoji: "🏋️",
    color: "#F97316",
    title: "Corporate Gym — La palestra vocale per il tuo team di vendita",
    subtitle: "Nessun corso, nessuna aula, nessun formatore esterno",
    image_key: "11_cgym_banner",
    image_wide: true,
    highlight: "AxonOS interpreta il cliente, il consulente risponde a voce. La formazione che si adatta alla tua azienda, non il contrario.",
    paragraphs: [
      "Nessun corso, nessun aula, nessun formatore esterno. AxonOS interpreta il cliente, il consulente risponde a voce. Ogni sessione viene analizzata, valutata e memorizzata.",
      "Il Master vede i progressi di ogni agente, riceve insight settimanali e può aggiornare gli scenari in tempo reale. Configurabile per qualsiasi settore e qualsiasi tipo di obiezione. La formazione che si adatta alla tua azienda, non il contrario.",
    ],
    icons: [
      { image_key: "cgym_obiezioni", label: "Gym Obiezioni" },
      { image_key: "cgym_winwin", label: "Gym WIN-WIN" },
    ],
  },
  {
    id: "insegna-axon",
    icon: "school",
    emoji: "🎓",
    color: "#B91C1C",
    title: "9 · Insegna ad Axon",
    subtitle: "Regole, URL sorgente, documenti",
    image_key: "10_ai_teach",
    paragraphs: [
      "Da Impostazioni → Insegna ad Axon puoi creare regole personalizzate per rendere Axon esperto del TUO business: linee guida di vendita, script preferiti, terminologia tecnica.",
      "Aggiungi anche URL di siti sorgente (es. autorità energia, il tuo sito) e documenti PDF che Axon leggerà come contesto RAG (embeddings semantici).",
      "Le regole si possono organizzare per categoria e attivare/disattivare al volo.",
    ],
    tips: [
      { emoji: "📝", text: "Una regola tipica: «Rispondi sempre in italiano, tono professionale ma amichevole»." },
      { emoji: "📄", text: "PDF supportati fino a ~50 pagine per documento." },
    ],
  },
  {
    id: "drive-dropbox",
    icon: "cloud",
    emoji: "☁️",
    color: "#0F9D58",
    title: "10 · Google Drive & Dropbox",
    subtitle: "Bollette, contratti e allegati sempre a portata",
    paragraphs: [
      "Collega Google Drive o Dropbox da Impostazioni → Integrazioni. Con Drive puoi anche scegliere una o più cartelle specifiche («Cartelle Axon») dal Google Picker: Axon leggerà SOLO i file al loro interno per rispettare la tua privacy.",
      "In chat, tocca la graffetta 📎 e scegli «Da Google Drive» o «Da Dropbox» per allegare direttamente file al messaggio.",
    ],
    tips: [
      { emoji: "🔒", text: "Scope drive.file: Axon vede solo le cartelle che scegli, non tutto il tuo Drive." },
      { emoji: "🔁", text: "Puoi cambiare cartelle in ogni momento." },
    ],
  },
  {
    id: "voice-copilot",
    icon: "mic",
    emoji: "🚗",
    color: "#F59E0B",
    title: "11 · Axon Drive — Il tuo copilota vocale in macchina",
    subtitle: "Mani sul volante, mente libera, lavoro fatto",
    highlight: "Stai guidando. Non puoi toccare il telefono. Parla ad Axon Drive e lui crea il contatto, aggiunge la nota, programma la richiamata.",
    paragraphs: [
      "Mani sul volante, mente libera, lavoro fatto. Attiva Axon Drive dal microfono in alto a destra o dall'azione rapida in Home: modalità full-screen dove Axon ti parla e tu rispondi a voce.",
      "Perfetto in auto: chiedi «Ricordami di richiamare Colferai alle 15», «Programma un appuntamento con Bianchi giovedì alle 10», «Riassumi le ultime tre bollette di Rossi».",
    ],
    warning: "Non guardare lo schermo mentre guidi. Axon Drive funziona a occhi chiusi grazie al feedback vocale.",
    tips: [
      { emoji: "🎧", text: "Meglio con auricolari bluetooth per riconoscimento vocale ottimale." },
    ],
  },
  {
    id: "notifiche-push",
    icon: "notifications",
    emoji: "🔔",
    color: "#DC2626",
    title: "AxonOS ti trova lui",
    subtitle: "L'AI che lavora anche quando tu non ci sei",
    highlight: "Non devi aprire l'app per sapere cosa succede.",
    paragraphs: [
      "Non devi aprire l'app per sapere cosa succede. AxonOS ti manda notifiche push per sessioni Corporate Gym in scadenza, ritelefonate urgenti, report settimanali Master e avvisi crediti. L'AI che lavora anche quando tu non ci sei.",
      "E puoi comandarle direttamente in chat: «ricordami domani alle 10 di chiamare Rossi» crea un promemoria che AxonOS ti consegna come push dal server, anche ad app chiusa; «avvisami se ho ritelefonate urgenti» attiva il controllo; «mandami una notifica: …» la invia subito.",
    ],
    bullets: [
      { icon: "alarm", text: "Promemoria e timer impostati in chat con Axon" },
      { icon: "barbell", text: "Sessioni Corporate Gym obbligatorie in scadenza" },
      { icon: "call", text: "Ritelefonate urgenti in scadenza" },
      { icon: "stats-chart", text: "Report settimanale Master pronto" },
      { icon: "flash", text: "Avvisi crediti AI al 50%, 80% e 100%" },
    ],
    tips: [
      { emoji: "💬", text: "In chat: «ricordami…», «avvisami se…», «mandami una notifica: …», «notifica di prova»." },
      { emoji: "⚙️", text: "Gestisci i tipi di notifica in Impostazioni → AI & Axon → Notifiche push AxonOS." },
      { emoji: "👥", text: "Il Master riceve anche gli avvisi del team; il collaboratore solo i propri." },
    ],
  },
  {
    id: "team-master",
    icon: "people-circle",
    emoji: "👑",
    color: "#1E40AF",
    title: "12 · Team & Master Dashboard",
    subtitle: "Solo per Master · gerarchia e KPI",
    paragraphs: [
      "Se sei un Master vedi la sezione Master: cruscotto con KPI aggregati di tutta la rete (contratti, appuntamenti, lead nuovi, uso Axon per collaboratore).",
      "Da qui invii inviti, gestisci ruoli, personalizzi lo script telefonata comune, i documenti Axon del team, i banner degli eventi e la brand identity.",
    ],
    tips: [
      { emoji: "🏆", text: "Confronta 2-3 collaboratori side-by-side dalla vista Team Insights (in arrivo)." },
    ],
  },
  {
    id: "my-thing",
    icon: "images",
    emoji: "🖼️",
    color: "#A21CAF",
    title: "13 · My Thing (Gallery personale)",
    subtitle: "Foto, moodboard, materiali brand",
    paragraphs: [
      "My Thing è una gallery privata per raccogliere immagini, sfondi, referenze commerciali. Puoi nasconderle o mostrarle a tuo piacimento.",
      "Utile per: brand guidelines aziendali, esempi di installazione, foto prima/dopo di lavori fatti dai tuoi clienti.",
    ],
  },
  {
    id: "report",
    icon: "bar-chart",
    emoji: "📊",
    color: "#0EA5E9",
    title: "14 · Report",
    subtitle: "Analytics chiari, decisioni migliori",
    image_key: "09_report",
    paragraphs: [
      "La tab Report mostra grafici a barre, torta e trend nel tempo: contratti chiusi, tipologie di appuntamento, area geografica, provenienza lead, uso di Axon.",
      "Puoi filtrare per periodo (7/30/90 giorni, YTD) ed esportare CSV/PDF.",
    ],
  },
  {
    id: "impostazioni",
    icon: "settings",
    emoji: "⚙️",
    color: "#475569",
    title: "15 · Impostazioni",
    subtitle: "Personalizza AdvisorOS a modo tuo",
    image_key: "06_impostazioni",
    paragraphs: [
      "In Impostazioni trovi tutto: profilo, biglietto da visita, integrazioni cloud, aree e categorie personalizzate, gestione team, memoria di Axon, SMTP per invio email, sicurezza biometrica, invito collaboratori.",
    ],
    tips: [
      { emoji: "🎨", text: "Personalizza le aree merceologiche per il tuo settore (energia, telco, assicurazioni, PV)." },
    ],
  },
  {
    id: "consigli",
    icon: "bulb",
    emoji: "💡",
    color: "#CA8A04",
    title: "16 · Consigli d'uso avanzati",
    subtitle: "Diventa un power user",
    paragraphs: [
      "1) Chiedi ad Axon di riassumere le note vocali di un contatto: risparmi 5 minuti a scheda.",
      "2) Usa i tag come mini-CRM: «lead caldo», «da richiamare», «trattativa avanzata».",
      "3) Fissa appuntamenti direttamente dalla chat: «Programma call con Rossi domani ore 11».",
      "4) Programma i richiami: «Ricordami di scrivere a Verdi lunedì mattina».",
      "5) Salva PDF importanti in Drive → Axon li citerà nei riassunti settimanali.",
    ],
  },
  {
    id: "faq",
    icon: "help-circle",
    emoji: "❓",
    color: "#64748B",
    title: "17 · FAQ",
    subtitle: "Le domande più frequenti",
    paragraphs: [
      "Q: I miei dati sono privati? — Sì, isolamento multi-tenant: nessun altro Master vede i tuoi contatti.\n\nQ: Axon usa i miei dati per addestrarsi? — AxonOS utilizza dati aggregati anonimi per migliorare il servizio, senza raccogliere dati sensibili come nomi, cifre o riferimenti personali. Contatti, bollette e documenti restano isolati nel tuo spazio.\n\nQ: Posso disdire in ogni momento? — Sì, dal Profilo → Gestisci abbonamento.\n\nQ: Perde qualcosa se cambio telefono? — No, tutto è in cloud: rifai il login e ritrovi tutto.\n\nQ: Come contatto il supporto? — Tocca il pulsante 🎧 in alto a destra oppure invia una email a support@advisoros.it.",
    ],
  },
  // V50.z189 — PROMPT 3: nuove sezioni di posizionamento (18–21) + chiusura con headline finale
  {
    id: "perche-diverso",
    icon: "flash",
    emoji: "⚡",
    color: "#7C3AED",
    title: "18 · Perché AdvisorOS è diverso",
    subtitle: "AxonOS Brain+ · L'AI è il motore, non un accessorio",
    highlight: "AdvisorOS non è un CRM con un chatbot aggiunto. È il primo sistema gestionale dove l'AI è il motore, non un accessorio.",
    paragraphs: [
      "Salesforce, HubSpot, Pipedrive hanno tutti un assistente AI innestato sopra il database. AxonOS legge il tuo database in tempo reale, agisce dentro il sistema e impara dalle tue interazioni.",
      "Non devi spiegargli chi sei ogni volta: ti conosce già.",
    ],
  },
  {
    id: "per-chi",
    icon: "people",
    emoji: "🧭",
    color: "#0EA5E9",
    title: "19 · Per chi è AdvisorOS",
    subtitle: "Cambia il vocabolario, il motore è lo stesso",
    highlight: "La base di AdvisorOS è stata costruita per consulenti commerciali ma la sua architettura si adatta a qualsiasi professionista che gestisce relazioni, scadenze e documenti.",
    paragraphs: [
      "Esempi concreti:",
    ],
    bullets: [
      { icon: "briefcase", text: "Servizi professionali: avvocati, commercialisti, consulenti del lavoro, notai. Gestione clienti, scadenze fiscali e processuali, archivio documentale, comunicazioni massive." },
      { icon: "medkit", text: "Sanità e benessere: fisioterapisti, psicologi, coach, dentisti, centri estetici. Cartelle clienti, piani di trattamento, richiami automatici, follow-up." },
      { icon: "cart", text: "Commercio e vendita: agenti di commercio, concessionarie, agenzie immobiliari, assicurazioni multi-ramo. Portafoglio clienti, trattative, scadenze, obiettivi." },
      { icon: "school", text: "Formazione: coach aziendali, scuole private, personal trainer, nutrizionisti. Percorsi personalizzati, materiali, sessioni, progressi." },
      { icon: "construct", text: "Artigianato e tecnici: idraulici, elettricisti, architetti, agenzie di comunicazione. Interventi, preventivi, scadenze manutenzione, clienti abituali." },
    ],
    tips: [
      { emoji: "⚙️", text: "In ogni settore cambia solo il vocabolario e i campi. Il motore è lo stesso." },
    ],
  },
  {
    id: "vita-privata",
    icon: "home",
    emoji: "🏠",
    color: "#10B981",
    title: "20 · AdvisorOS per la vita privata",
    subtitle: "Una famiglia è una piccola impresa",
    highlight: "AxonOS non è solo per il lavoro. Una famiglia oggi gestisce scadenze, documenti e impegni come una piccola impresa.",
    paragraphs: [
      "AxonOS legge la circolare della scuola e aggiorna il calendario. Ricorda bollo, revisione, tasse, compleanni. Fotografa lo scontrino e costruisce la nota spese. Legge l'estratto conto e produce un report. Gestisce password, documenti assicurativi, pratiche sanitarie.",
      "Un solo assistente che conosce tutta la tua vita, senza che tu debba spiegargli nulla ogni volta.",
    ],
  },
  {
    id: "vantaggio-tempo",
    icon: "trending-up",
    emoji: "📈",
    color: "#F59E0B",
    title: "21 · Il vantaggio che cresce nel tempo",
    subtitle: "AxonOS Brain+ · La memoria è tua",
    highlight: "Ogni giorno che usi AdvisorOS, AxonOS Brain+ ti conosce meglio: il sistema operativo che potenzia il tuo cervello.",
    paragraphs: [
      "La memoria accumulata nel tuo sistema non va da nessuna parte: è tua. Questo è il motivo per cui chi inizia a usare AdvisorOS non torna indietro.",
      "Il sistema diventa parte del tuo modo di lavorare.",
    ],
  },
  {
    id: "chiusura",
    icon: "rocket",
    emoji: "🚀",
    color: "#0F172A",
    title: "AdvisorOS 2.0",
    subtitle: "AxonOS Brain+ · Il CRM più intelligente per chi lavora sul campo",
    highlight: "AdvisorOS non è il CRM più grande. È il CRM più intelligente per chi lavora sul campo. Ogni giorno che lo usi, diventa più tuo.",
    paragraphs: [
      "Costruito per chi vende ogni giorno — e per agenzie, aziende, studi professionali e privati — potenziato da un'intelligenza che non dorme mai.",
    ],
  },
];

/** Risolve la fonte immagine per una sezione. */
/** V50.z182 — Sezioni statiche "2.0" da integrare nei libretti personalizzati salvati dal Master che non le contengono. */
const _LIBRETTO_NEW_SECTIONS: { id: string; after: string[] }[] = [
  { id: "corporate-gym", after: ["axon-chat"] },
  { id: "notifiche-push", after: ["voice-copilot", "corporate-gym", "axon-chat"] },
  { id: "perche-diverso", after: ["faq", "consigli"] },
  { id: "per-chi", after: ["perche-diverso", "faq"] },
  { id: "vita-privata", after: ["per-chi", "perche-diverso", "faq"] },
  { id: "vantaggio-tempo", after: ["vita-privata", "per-chi", "faq"] },
  { id: "chiusura", after: [] },
];

/** Inserisce le sezioni 2.0 mancanti (Corporate Gym dopo AxonOS, Notifiche push dopo Axon Drive, Chiusura in coda). Non tocca le esistenti. */
export function withCorporateGymSection(sections: LibrettoSection[]): LibrettoSection[] {
  if (!Array.isArray(sections)) return sections;
  const out = [...sections];
  for (const spec of _LIBRETTO_NEW_SECTIONS) {
    if (out.some((s) => s.id === spec.id)) continue;
    const sec = LIBRETTO_SECTIONS.find((s) => s.id === spec.id);
    if (!sec) continue;
    let idx = -1;
    for (const a of spec.after) {
      idx = out.findIndex((s) => s.id === a);
      if (idx >= 0) break;
    }
    if (idx >= 0) out.splice(idx + 1, 0, sec);
    else if (spec.id === "chiusura") out.push(sec);
    else {
      const c = out.findIndex((s) => s.id === "consigli" || s.id === "faq");
      out.splice(c >= 0 ? c : out.length, 0, sec);
    }
  }
  return out;
}

export function resolveSectionImage(section: LibrettoSection): number | { uri: string } | null {
  if (section.image_data_url && section.image_data_url.startsWith("data:")) {
    return { uri: section.image_data_url };
  }
  if (section.image_key && LIBRETTO_IMAGE_MAP[section.image_key]) {
    return LIBRETTO_IMAGE_MAP[section.image_key];
  }
  return null;
}
