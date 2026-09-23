# PROMPT — job «LandingPage» (advisoros.it) → collegamento al backend AdvisorOS

Incolla TUTTO il testo sotto la riga nel job LandingPage. Prima di incollare sostituisci `<<BACKEND_PROD>>` con l'URL
di produzione del backend AdvisorOS (dopo il Publish di AdvisorOS, es. `https://business-card-pro-16.emergent.host`).
Finché AdvisorOS non è pubblicato puoi usare la preview: `https://business-card-pro-16.preview.emergentagent.com`.

---

Questa landing è il sito pubblico di **AdvisorOS** (dominio principale `https://advisoros.it`; `advisoros.cloud` sarà un redirect).
Il CRM AdvisorOS ha già un backend FastAPI + MongoDB in produzione: **NON creare un database o un backend per i lead**.
Tutti i form della landing devono inviare i dati all'API pubblica di AdvisorOS, che salva il lead nel CRM, lo fa analizzare
dall'assistente Axon e avvisa il titolare.

## 1. Endpoint da usare (già esistente, CORS aperto, nessuna chiave)
`POST <<BACKEND_PROD>>/api/public/demo-request`  — `Content-Type: application/json`

Body:
```json
{
  "full_name": "Mario Rossi",            // obbligatorio, 2–120 caratteri
  "company": "Energia Srl",              // obbligatorio, 1–160 caratteri
  "phone": "+39 333 1234567",            // obbligatorio, 6–40 caratteri
  "email": "mario@azienda.it",           // facoltativo, email valida
  "consent_privacy": true,               // obbligatorio = true, altrimenti 400
  "website": ""                          // HONEYPOT anti-spam: campo nascosto, deve restare VUOTO
}
```
Risposte: `200 {"ok": true, "lead_id": "lead_…"}` · `400 {"detail": "Devi accettare l'informativa privacy"}` ·
`422` validazione (campi mancanti/corti) · `503 {"detail": "Servizio non disponibile"}`.
Non c'è autenticazione. Non inviare altri campi. Metti l'URL base in una variabile d'ambiente pubblica
(es. `NEXT_PUBLIC_ADVISOROS_API` / `VITE_ADVISOROS_API` / `EXPO_PUBLIC_ADVISOROS_API`) = `<<BACKEND_PROD>>`.

## 2. Form «Richiedi la demo» (sostituisce qualsiasi salvataggio locale/DB)
- Campi: Nome e cognome, Azienda, Telefono, Email (opzionale), checkbox privacy («Acconsento a essere ricontattato
  per la demo. I dati sono usati solo per questo scopo e restano in AdvisorOS.»), campo nascosto `website` (honeypot,
  invisibile e mai compilato dall'utente).
- Al submit: disabilita il bottone, POST all'endpoint, poi mostra «Grazie! Ti richiamiamo noi. Nessun impegno.»;
  su 400/422 mostra il `detail`; su errore di rete «Invio non riuscito, riprova o scrivi a info@advisoros.it».
- Non salvare i lead in nessun altro posto (niente Supabase/Mongo/Sheets locali). Se il progetto ha già un DB o una
  tabella "leads" creata in precedenza, rimuovila: la fonte unica è AdvisorOS.

## 3. Link e coerenza con l'app
- CTA «Accedi» / «Entra nell'app» → `<<BACKEND_PROD>>/login` (l'app web AdvisorOS pubblicata).
- Email di contatto: `info@advisoros.it` (commerciale) e `help@advisoros.it` (assistenza). Footer: «© 2026 AdvisorOS · powered by Axon».
- **AxonOS Lite è il diamante, non un'appendice**: subito dopo l'hero una sezione «IL DIAMANTE · AXON» (icona diamante che brilla) con due porte affiancate: **AxonOS Lite — per tutti** (medici, avvocati, geometri, famiglie, studenti: «chi ha una segretaria e chi non l'ha») e **AdvisorOS — per chi gestisce clienti e contratti**. MAI frasi come «non sei un professionista». Pagina `/lite` dedicata: hero «Un assistente che ricorda tutto, organizza il tuo tempo e agisce per te», dialoghi esempio («Axon, dov'ero il 9 settembre sera?» → «Da Costantino, con Laura: era il vostro anniversario»; «Tra una settimana è l'anniversario: dove mi consigli a Verona?» → budget, 3 proposte, prenota lui), sezione «Perché non è replicabile» (mille app senza controllo valgono zero), «Per chi», form «Richiedi accesso anticipato» → demo-request con `company: "AxonOS Lite"`. Prendi come riferimento la pagina `/lite` già presente nell'app AdvisorOS.
- Pagina `/faq` con le stesse 10 domande e risposte usate nell'app (le trovi sotto), design accordion.
- Palette del marchio (uguale allo splash dell'app): navy `#0B1626` sfondo, blu AdvisorOS `#1C4869` → `#2563EB`, arancio «OS» `#F97316` per CTA, ciano Axon `#38BDF8`, testo `#F4F7FB`.

## 4. Dominio
- Pubblica il sito e imposta il dominio personalizzato `advisoros.it` (+ `www.advisoros.it`) dal pannello di deployment;
  fornisci i record DNS da inserire su Aruba. `advisoros.cloud` verrà reindirizzato a `https://advisoros.it` dal registrar.

## 5. Test di accettazione
1. Compilo il form con dati validi → 200 e messaggio di ringraziamento; il lead compare nel CRM AdvisorOS.
2. Privacy non spuntata → messaggio «Devi accettare l'informativa privacy».
3. Honeypot compilato (simulato) → nessun errore mostrato, nessun lead nel CRM.
4. Nessuna chiamata a database locali; nessun segreto nel frontend.

## FAQ (testi ufficiali)
1. **Come carico un contratto esempio per addestrare Axon?** — Vai nella sezione Compilazione CRT, blocco Modelli di addestramento. Clicca "Carica contratto compilato di esempio" e seleziona il file da Drive, Dropbox o dal tuo dispositivo. Axon lo analizza e impara automaticamente la struttura e i campi da compilare.
2. **Posso modificare l'ordine delle pagine nel documento finale?** — Sì. Prima di salvare puoi trascinare le sezioni nell'ordine che preferisci, oppure impostare un ordine predefinito nel pannello Master che si applica automaticamente a ogni nuovo documento.
3. **Dove si salva il documento compilato?** — Al termine della compilazione puoi scegliere: cartella del cliente, database Master, condivisione via email o link, o stampa diretta via WiFi. Puoi salvare in più posti contemporaneamente.
4. **Axon può compilare qualsiasi tipo di contratto?** — Axon funziona con qualsiasi documento PDF che hai caricato come modello. Più esempi compilati gli fornisci, più diventa preciso. Contratti energia, telco, bancari, assicurativi — se hai il modello, Axon lo compila.
5. **Cosa succede se Axon sbaglia a compilare un campo?** — Prima di salvare puoi revisionare e correggere ogni campo manualmente. Axon mostra in anteprima tutto il documento compilato e segnala i campi su cui non è sicuro.
6. **Posso usare AdvisorOS da mobile e desktop contemporaneamente?** — Sì. AdvisorOS è sincronizzato in tempo reale su tutti i dispositivi. Puoi iniziare una pratica da desktop e completarla da mobile senza perdere nulla.
7. **Come aggiungo un nuovo fornitore o modello di contratto?** — Dalla sezione Compilazione CRT, carica il modulo vuoto del nuovo fornitore e un esempio compilato. Axon lo riconosce automaticamente e lo aggiunge ai modelli disponibili.
8. **I dati dei miei clienti sono al sicuro?** — Tutti i dati dei clienti sono crittografati e accessibili solo a te e ai collaboratori che autorizzi. Nessun dato viene condiviso con terze parti.
9. **Posso condividere l'accesso con un collaboratore?** — Sì. Dal pannello Master puoi aggiungere collaboratori con livelli di accesso personalizzati — puoi decidere cosa possono vedere e cosa possono modificare.
10. **Come funziona il briefing pre-appuntamento di Axon?** — Prima di ogni appuntamento in calendario Axon ti invia un riepilogo automatico: chi incontri, cosa ha acquistato in passato, chi lo ha referenziato, le scadenze aperte e i punti da affrontare. Tutto senza che tu debba chiedere nulla.
