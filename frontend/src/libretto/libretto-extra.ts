// src/libretto/libretto-extra.ts — V50.z469 — Feature 12/15: nuove sezioni del Libretto (funzioni introdotte nelle ultime
// versioni) + FAQ per sezione. Le sezioni vengono inserite nel Libretto (statico e personalizzato dal Master) dopo «AxonOS Chat».
// Gli ID sono anche le «pagine» che Axon linka con [[NAV:/libretto?section=<id>|…]] (backend axon_help_links.py).
import type { LibrettoSection } from "./libretto-content";

export type LibrettoFaq = { q: string; a: string };

/** FAQ per le sezioni storiche (id → domande). */
export const LIBRETTO_FAQS: Record<string, LibrettoFaq[]> = {
  home: [
    { q: "Posso scegliere quali widget vedere in Home?", a: "Sì: Impostazioni › Personalizza Home (o chiedi ad Axon «configura la dashboard»). Puoi attivare, disattivare e riordinare i widget." },
    { q: "Il widget PUN è cliccabile?", a: "Sì. Toccandolo si apre «Storico PUN» con gli ultimi 18 mesi (F1, F2, F3, monorario) e il bottone per scaricare o condividere il PDF." },
  ],
  contatti: [
    { q: "Come trovo velocemente un cliente?", a: "Usa la barra di ricerca in alto (nome, azienda, telefono, città) oppure chiedi ad Axon «apri la scheda di Mario Rossi»." },
    { q: "Posso chiamare o scrivere su WhatsApp dalla scheda?", a: "Sì: nella scheda contatto trovi i pulsanti Chiama, WhatsApp ed Email accanto ai recapiti." },
  ],
  "nuovo-contatto": [
    { q: "Devo scrivere l'indirizzo a mano?", a: "No: nel campo «Cerca indirizzo» digita almeno 3 lettere e scegli il suggerimento Google: via, civico, CAP, città e provincia si compilano da soli (restano modificabili)." },
    { q: "Posso importare un contatto dalla rubrica del telefono?", a: "Sì, con il pulsante «Dalla rubrica» in alto nel modulo: AdvisorOS chiede il permesso Contatti solo in quel momento." },
  ],
  appuntamenti: [
    { q: "Come imposto la durata?", a: "Nel modulo appuntamento scorri il selettore durata oppure inserisci direttamente l'ora di fine: i due campi sono sincronizzati." },
    { q: "Posso far gestire un imprevisto ad Axon?", a: "Sì: scrivi in chat «mi si è rotta la macchina» o «sono bloccato nel traffico»: Axon ricalcola l'agenda e propone i messaggi da inviare ai clienti." },
  ],
  "axon-chat": [
    { q: "Axon non risponde: cosa succede?", a: "Dopo 10 secondi senza risposta compare «Axon si sta riprendendo, torno subito…»: il sistema si ripristina da solo e la chat riprende. Se il problema persiste il servizio si riavvia automaticamente." },
    { q: "Posso chiedere ad Axon dove si trova una funzione?", a: "Sì: «dove trovo le scadenze?», «come si fa un giro ottimale?». Axon risponde e aggiunge un pulsante che apre la schermata giusta o la pagina del Libretto." },
    { q: "Axon può dirmi il numero di qualcuno che non è in AdvisorOS?", a: "Sì, sull'app mobile: se il nome non è tra i contatti, Axon cerca nella rubrica del telefono (con il tuo permesso) e mostra il numero in chat." },
  ],
  "notifiche-push": [
    { q: "Non ricevo le notifiche: cosa controllo?", a: "Notifiche AxonOS › Preferenze › Stato canale push: se il permesso è negato tocca «Apri impostazioni». Le push funzionano solo sull'app installata (non su web)." },
  ],
  impostazioni: [
    { q: "Posso cambiare personalità e stile di Axon?", a: "Sì (Super Master): Impostazioni › AI & Axon › «Personalizza Axon» per scegliere personalità e stile linguistico del tuo assistente." },
    { q: "Dove trovo la Privacy policy?", a: "Help › Privacy & Termini › Privacy policy: l'informativa completa è consultabile dentro l'app, senza browser." },
  ],
  "team-master": [
    { q: "Come seguo l'onboarding dei nuovi collaboratori?", a: "Pannello Master › Onboarding: vedi lo stato di ogni collaboratore (registrazione, anagrafica, permessi, primo contatto) e i promemoria email inviati automaticamente." },
  ],
  faq: [
    { q: "Dove segnalo un problema o un'idea?", a: "Tab Help: «Segnala un problema» (con allegati e risposta di Axon) e «Invia un consiglio». Le richieste passano al Master se serve." },
  ],
};

/** Nuove sezioni (V50.z456–z466). Inserite dopo «axon-chat» (o prima di «consigli» se manca). */
export const LIBRETTO_EXTRA_SECTIONS: (LibrettoSection & { faqs?: LibrettoFaq[] })[] = [
  {
    // V50.z561 — REGOLA PERMANENTE: ogni funzione nuova o modificata viene registrata nel Manuale d'uso (backend
    // axon_manual_data.py) che alimenta questa voce, la pagina /manuale, la Mappa completa (admin) e il contesto di Axon.
    id: "manuale-duso", icon: "book", emoji: "📘", color: "#7C3AED", title: "Manuale d'uso: tutte le funzioni",
    subtitle: "Ogni voce di menu, pagina e azione: cosa fa, come si usa, link diretto",
    paragraphs: [
      "Il Manuale d'uso elenca TUTTE le funzioni dell'app, raggruppate per categoria (Schermate principali, CRM Core, AI & Axon, Comunicazioni, Anagrafica & DB Master, Team & Insights, Amministrazione, Pannello Master, Pagine pubbliche). Per ogni funzione trovi: nome, descrizione breve, «Come si usa» passo-passo e il pulsante «Apri» che porta alla pagina giusta.",
      "È sempre aggiornato: ogni volta che una funzione viene aggiunta o modificata, la sua voce viene creata o aggiornata nello stesso momento, e Axon la impara subito. Per questo puoi chiedere in chat «come faccio a…» o «dove trovo…»: Axon risponde con il percorso di menu e un pulsante che apre la schermata.",
      "Il Master e il Super Master hanno anche la «Mappa completa dell'app» nel Pannello Master: l'intero elenco in un'unica pagina, con ricerca e copia in testo.",
    ],
    tips: [
      { emoji: "🔎", text: "Aiuto → «Manuale completo dell'app»: digita «scanner», «nota vocale», «frequenza Drive»… e la voce giusta compare subito." },
      { emoji: "💬", text: "In chat: «dove trovo le scadenze?», «come collego Google Drive?» → percorso + pulsante di apertura." },
    ],
    links: [
      { label: "Apri il Manuale d'uso", href: "/manuale", icon: "book-outline" },
      { label: "Mappa completa dell'app (admin)", href: "/admin/app-map", icon: "map-outline" },
    ],
    faqs: [
      { q: "Il Manuale è diverso dal Libretto?", a: "Il Libretto racconta l'app per scenari e sezioni illustrate; il Manuale d'uso è l'elenco completo e sistematico di ogni funzione con il link diretto. Si completano: Axon usa entrambi." },
      { q: "Chi aggiorna il Manuale?", a: "Il team di sviluppo, obbligatoriamente a ogni nuova funzione o modifica (anche fix tecnici): la voce nasce insieme alla funzione." },
    ],
  },
  {
    id: "storico-pun", icon: "flash", emoji: "⚡", color: "#D97706", title: "Storico PUN",
    subtitle: "Dal widget Home alla tabella 18 mesi, con PDF",
    paragraphs: [
      "Il widget PUN della Home mostra F1, F2, F3 del mese corrente (media parziale GME aggiornata ogni giorno). Toccandolo si apre «Storico PUN»: una tabella degli ultimi 18 mesi chiusi con monorario e fasce in €/kWh, il mese più caro in rosso, il più economico in verde e il mese corrente in giallo.",
      "Con il bottone PDF scarichi o condividi la tabella (su telefono tramite il foglio di condivisione, su web come download). I dati arrivano dai PDF ufficiali GME: se un mese manca nella cache viene indicato «n/d», mai stimato.",
    ],
    tips: [{ emoji: "💬", text: "In chat: «tabella PUN ultimi 18 mesi» produce la stessa tabella; il Master può dire «aggiorna cache PUN»." }],
    faqs: [
      { q: "Perché un mese è «n/d»?", a: "Il PDF ufficiale GME di quel mese non è ancora in cache. Il job notturno riprova ogni giorno; il Master può forzare con «aggiorna cache PUN»." },
      { q: "Il mese corrente è definitivo?", a: "No: è la media parziale dei giorni pubblicati (riga gialla). Diventa definitivo quando GME pubblica il PDF mensile." },
    ],
  },
  {
    id: "indirizzi-google", icon: "location", emoji: "📍", color: "#2563EB", title: "Indirizzi con Google",
    subtitle: "Autocompletamento in contatti, appuntamenti e anagrafica",
    paragraphs: [
      "Nei moduli Nuovo contatto, Nuovo appuntamento e Anagrafica Master c'è il campo «Cerca indirizzo»: digita almeno 3 lettere e scegli tra i suggerimenti Google. Via, civico, CAP, città e provincia vengono compilati automaticamente e restano modificabili.",
    ],
    faqs: [{ q: "E se non compaiono suggerimenti?", a: "Puoi sempre compilare i campi a mano. Il servizio è attivo quando il Master ha configurato la chiave Google Places sul server." }],
  },
  {
    id: "trascrizione-chiamate", icon: "mic-circle", emoji: "🎙️", color: "#7C3AED", title: "Trascrizione chiamate",
    subtitle: "Dalla registrazione al riepilogo nel CRM",
    paragraphs: [
      "Nella scheda contatto › Chiamate puoi caricare o registrare una chiamata: Axon la trascrive (riconoscendo chi parla), estrae riepilogo, budget, obiezioni e prossimi passi e li salva come nota del contatto, pronti per il follow-up.",
    ],
    faqs: [{ q: "Quali formati sono accettati?", a: "Audio m4a, mp3, wav, ogg fino a 25 MB. Su Android la registrazione dall'app è già nel formato giusto." }],
  },
  {
    id: "agente-autonomo", icon: "git-branch", emoji: "🤖", color: "#0891B2", title: "Axon agente multi-step",
    subtitle: "Un solo comando, più azioni concatenate",
    paragraphs: [
      "Scrivi «chiudi la trattativa con Rossi, mandagli il preventivo e richiamalo tra 30 giorni»: Axon scompone la richiesta in passi, li esegue in ordine (aggiorna la trattativa, prepara il messaggio, programma la ritelefonata) e ti mostra l'esito di ciascuno. Se un passo non riesce ti chiede come procedere: salta, riprova o annulla.",
    ],
    faqs: [{ q: "Posso fermarlo a metà?", a: "Sì: rispondi «annulla» alla domanda «Come procedo?» oppure premi Stop nella chat." }],
  },
  {
    id: "imprevisti", icon: "alert-circle", emoji: "🚨", color: "#DC2626", title: "Gestione imprevisti",
    subtitle: "Agenda ricalcolata e clienti avvisati",
    paragraphs: [
      "«Mi si è rotta la macchina», «sono fermo dal medico fino alle 12»: Axon ricalcola l'agenda del giorno (sposta, accorcia o rimanda gli appuntamenti) e prepara i messaggi per i clienti coinvolti via email o WhatsApp. Niente parte senza il tuo «confermo».",
    ],
    faqs: [{ q: "Cosa succede se un cliente rifiuta il nuovo orario?", a: "Scrivi «Mario ha rifiutato»: Axon propone alternative e aggiorna l'agenda." }],
  },
  {
    id: "rubrica-telefono", icon: "call", emoji: "📱", color: "#16A34A", title: "Rubrica del telefono",
    subtitle: "Quando il nome non è in AdvisorOS",
    paragraphs: [
      "Chiedi «numero di Luca Bianchi»: se Luca non è tra i tuoi contatti, Axon lo cerca nella rubrica del telefono (solo app mobile, con il permesso Contatti) e mostra il numero in chat con il pulsante per chiamare. La rubrica non viene mai inviata al server: si cerca solo il nome richiesto.",
    ],
    faqs: [{ q: "Ho negato il permesso: come lo riattivo?", a: "Impostazioni › Permessi › Contatti › «Apri impostazioni». Senza permesso Axon risponde solo con i contatti di AdvisorOS." }],
  },
  {
    id: "personalizza-axon", icon: "color-palette", emoji: "🎭", color: "#9333EA", title: "Personalizza Axon",
    subtitle: "Personalità e stile (Super Master)",
    paragraphs: [
      "Dalle impostazioni AI & Axon il Super Master sceglie personalità (es. diretta, empatica, formale) e stile linguistico dell'assistente; la scelta vale per l'account e si riflette in ogni risposta di Axon.",
    ],
  },
  {
    id: "spazio-personale", icon: "lock-closed", emoji: "🔐", color: "#0F172A", title: "Spazio Personale (Super Master)",
    subtitle: "Anagrafica cifrata solo sul dispositivo",
    paragraphs: [
      "Famiglia, case, contatti d'emergenza e documenti personali del Super Master vivono in uno spazio protetto da PIN o impronta/volto. I dati sono cifrati e restano SOLO sul dispositivo: nessuna sincronizzazione con il server. Un interruttore decide se Axon può consultarli quando glielo chiedi.",
    ],
    faqs: [
      { q: "Se cambio telefono ritrovo lo Spazio Personale?", a: "No: per scelta di sicurezza i dati non lasciano mai il dispositivo. Esportali prima dal menu dello Spazio Personale." },
      { q: "Axon vede questi dati?", a: "Solo se attivi «Condividi con Axon» e solo per rispondere alle tue domande in quel momento." },
    ],
  },
  {
    id: "sicurezza-upload", icon: "shield-checkmark", emoji: "🛡️", color: "#475569", title: "Sicurezza dei file caricati",
    subtitle: "Formati consentiti e antivirus",
    paragraphs: [
      "I file caricati (documenti, allegati, scansioni) sono accettati solo nei formati JPG, PNG e PDF (audio per le trascrizioni) con limiti di dimensione; sul server ogni file viene analizzato dall'antivirus prima di essere salvato. Un file sospetto viene rifiutato con un messaggio chiaro.",
    ],
  },
];

const EXTRA_AFTER = ["axon-chat", "corporate-gym", "insegna-axon"];

/** Inserisce le sezioni nuove (se mancanti) e aggancia le FAQ alle sezioni storiche. Non tocca i testi esistenti. */
export function withExtraSections(sections: LibrettoSection[]): LibrettoSection[] {
  if (!Array.isArray(sections)) return sections;
  const out = sections.map((s) => (LIBRETTO_FAQS[s.id] && !(s as any).faqs ? { ...s, faqs: LIBRETTO_FAQS[s.id] } : s)) as LibrettoSection[];
  const missing = LIBRETTO_EXTRA_SECTIONS.filter((e) => !out.some((s) => s.id === e.id));
  if (!missing.length) return out;
  let idx = -1;
  for (const a of EXTRA_AFTER) { idx = out.findIndex((s) => s.id === a); if (idx >= 0) break; }
  if (idx < 0) { const c = out.findIndex((s) => s.id === "consigli" || s.id === "faq"); idx = (c >= 0 ? c : out.length) - 1; }
  out.splice(idx + 1, 0, ...missing);
  return out;
}
