/**
 * V50.l — Libretto Informativo AdvisorOS + AxonOS
 *
 * Contenuto strutturato del libretto informativo. Usato sia dalla schermata
 * in-app (`/libretto`) sia dal template HTML per l'export PDF.
 */

export type LibrettoSection = {
  id: string;
  icon: string; // Ionicons name
  emoji: string;
  color: string; // hex tinta della sezione
  title: string;
  subtitle?: string;
  paragraphs: string[];
  tips?: { emoji: string; text: string }[];
  mockup?: {
    title: string;
    lines: string[]; // ogni riga è mostrata come blocco in mono/mock
  };
  /** V50.m — Screenshot reale (require path). Se presente sostituisce il mockup testuale. */
  image?: number;
  warning?: string;
};

export const LIBRETTO_SECTIONS: LibrettoSection[] = [
  {
    id: "intro",
    icon: "book",
    emoji: "📘",
    color: "#1C4869",
    title: "Cos'è AdvisorOS + AxonOS",
    subtitle: "La rete di consulenti energetici, potenziata dall'AI",
    paragraphs: [
      "AdvisorOS è un CRM completo pensato per Consulenti Energetici e Networker italiani, con isolamento multi-tenant, controllo dei ruoli e integrazioni cloud native.",
      "AxonOS è l'assistente AI integrato: risponde in chat, ricorda le informazioni del tuo team, ti aiuta a leggere bollette, a preparare messaggi commerciali e a gestire attività quotidiane senza uscire dall'app.",
      "L'obiettivo di questo libretto è portarti dal primo login all'utilizzo avanzato di ogni funzione, con schermate di esempio e suggerimenti pratici.",
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
    image: require("@/assets/images/libretto/01_login.jpg"),
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
    image: require("@/assets/images/libretto/02_home.jpg"),
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
    image: require("@/assets/images/libretto/03_contatti.jpg"),
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
    image: require("@/assets/images/libretto/05_nuovo_contatto.jpg"),
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
    image: require("@/assets/images/libretto/08_calendario.jpg"),
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
    image: require("@/assets/images/libretto/07_biglietto.jpg"),
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
    title: "8 · AxonOS — Chat AI",
    subtitle: "Il tuo assistente sempre disponibile",
    image: require("@/assets/images/libretto/04_chat.jpg"),
    paragraphs: [
      "AxonOS è la chat integrata: gli fai domande e ti risponde in tempo reale usando il tuo contesto personale (contatti, bollette, appuntamenti, regole aziendali).",
      "Nel campo di input trovi anche il pulsante microfono per parlare invece di scrivere e allegare file da Drive, Dropbox o dal telefono.",
      "AxonOS usa un router intelligente: risposte semplici gestite da Claude Haiku 4.5 (istantaneo), analisi complesse da Sonnet 4.6 (dettagliato).",
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
      { emoji: "🎙️", text: "Modalità Voice Copilot: usa in auto senza mani." },
      { emoji: "🧠", text: "Chiedigli «riassumi la scheda di Mario Rossi» per un briefing rapido." },
    ],
  },
  {
    id: "insegna-axon",
    icon: "school",
    emoji: "🎓",
    color: "#B91C1C",
    title: "9 · Insegna ad Axon",
    subtitle: "Regole, URL sorgente, documenti",
    image: require("@/assets/images/libretto/10_ai_teach.jpg"),
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
    title: "11 · Voice Copilot (modalità auto)",
    subtitle: "Comandi hands-free mentre guidi",
    paragraphs: [
      "Attiva Voice Copilot dal microfono in alto a destra: apri la modalità full-screen dove Axon ti parla e tu rispondi a voce.",
      "Perfetto in auto: chiedi «Ricordami di richiamare Colferai alle 15», «Programma un appuntamento con Bianchi giovedì alle 10», «Riassumi le ultime tre bollette di Rossi».",
    ],
    warning: "Non guardare lo schermo mentre guidi. Voice Copilot funziona a occhi chiusi grazie al feedback vocale.",
    tips: [
      { emoji: "🎧", text: "Meglio con auricolari bluetooth per riconoscimento vocale ottimale." },
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
    image: require("@/assets/images/libretto/09_report.jpg"),
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
    image: require("@/assets/images/libretto/06_impostazioni.jpg"),
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
      "Q: I miei dati sono privati? — Sì, isolamento multi-tenant: nessun altro Master vede i tuoi contatti.\n\nQ: Axon usa i miei dati per addestrarsi? — No. Le conversazioni non alimentano modelli esterni.\n\nQ: Posso disdire in ogni momento? — Sì, dal Profilo → Gestisci abbonamento.\n\nQ: Perde qualcosa se cambio telefono? — No, tutto è in cloud: rifai il login e ritrovi tutto.\n\nQ: Come contatto il supporto? — Tocca il pulsante 🎧 in alto a destra oppure invia una email a support@advisoros.it.",
    ],
  },
];

export const LIBRETTO_META = {
  title: "Libretto Informativo",
  subtitle: "AdvisorOS + AxonOS · Guida operativa completa",
  version: "1.0 · Giugno 2026",
  footer: "© AdvisorOS. Documento generato dall'app.",
};
