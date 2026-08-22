# Dal Pastro CRM — PRD v1.3

## v2.20 Feature — File upload: formati unificati + validazione (Feb 2026)
### 🎯 Richiesta utente
Ovunque nell'app sia possibile caricare un file, accettare tutti i formati comuni (PDF, immagini JPG/PNG/GIF/WEBP/HEIC, documenti TXT/DOC/DOCX, fogli XLS/XLSX/CSV) con validazione chiara se il formato non è supportato. Segnalare le sezioni dove manca completamente.

### ✅ Nuovo helper centralizzato `/app/frontend/src/utils/filePicker.ts`
- `COMMON_FILE_MIME_TYPES` — 23 MIME types (PDF, 8 image, 6 doc/text, 5 spreadsheet, 2 slide, JSON)
- `COMMON_FILE_EXTS` — 24 estensioni per fallback validazione (Android/iOS a volte riportano MIME vuoto o `application/octet-stream`)
- `COMMON_FILE_LABEL` — stringa human-readable per messaggi d'errore
- `validateCommonFile(asset)` — ritorna null se ok, o messaggio errore IT
- `pickCommonFile({multiple?})` — wrapper `DocumentPicker.getDocumentAsync` con validazione + ritorna `{asset, error}`

### ✅ Punti aggiornati (5 pickers)
1. **`/app/frontend/app/chat/[id].tsx`** — allegato chat: era `*/*` senza validazione → ora accetta solo comuni + notify errore
2. **`/app/frontend/app/contact/[id].tsx`** — file cliente: era solo PDF+image → ora tutti i formati comuni
3. **`/app/frontend/app/contact/[id].tsx`** (note attachment): era `*/*` → validato
4. **`/app/frontend/app/contact/new.tsx`** — allegato in creazione contatto (email + generic): era `*/*` → validato
5. **`/app/frontend/app/appointment/new.tsx`** — note attachment appuntamento: era `*/*` → validato

### ✅ Punti già ok (non modificati)
- `bill-quick.tsx` — PDF only intenzionale (fatture)
- `event-banners.tsx` — PDF (programma) + audio only intenzionali
- `master-files.tsx` — già ha lista ampia formati specifica per categoria

### 📋 Sezioni SENZA possibilità di allegare file (segnalate come richiesto, non modificate)
- **`/app/frontend/app/callback/new.tsx` + `[id].tsx`** — Richiami/callback: nessun allegato (utile per foto documento POD?)
- **`/app/frontend/app/appointment/[id].tsx`** — Vista appuntamento: non permette di AGGIUNGERE nuovi allegati dopo creazione (solo la new.tsx ha il picker)
- **`/app/frontend/app/corporate/new.tsx`** — Contratto corporate: solo dati testuali
- **`/app/frontend/app/contract/new.tsx`** — Contratto: solo dati testuali (potrebbe voler allegare copia contratto firmato)
- **`/app/frontend/app/groups/[id].tsx`** — Dettaglio gruppo contatti: no file
- **`/app/frontend/app/neo-memory.tsx`** — Memoria AI (probabilmente non applicabile)

### ✅ Verifica (senza testing agent)
- Lint pulito su tutti i 5 file modificati + nuovo utility ✅
- Expo restart senza errori ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.19 Feature — Calendario: riordino UI + backlog persistente + statistiche (Feb 2026)
### 🎯 Richieste utente
1) Vista predefinita = **Mese**
2) Sposta filtri categoria + visibilità **SOTTO** il calendario (per non coprire la griglia)
3) Rimuovi il pulsante "Tutti" duplicato (era in scope + area filter)
4) Sotto il calendario, elenco persistente di tutti gli appuntamenti miei non completati (oggi + arretrati) — restano visibili finché non vengono segnati come fatti o riprogrammati
5) Appuntamenti completati visibili solo fino a mezzanotte del giorno stesso
6) Sezione statistiche appuntamenti: fatti/non fatti per me, gruppo, e per ogni collaboratore

### ✅ Backend (`/app/backend/server.py`)
- Nuovo endpoint `GET /api/appointments/stats?range_days=30`
  - Aggregazione MongoDB `$group` per `created_by` con conteggi total/done
  - RBAC: owner/admin vedono tutti i membri del tenant; member vede solo se stesso
  - Ritorna `{range_days, mine, group, per_user[]}` con ranking per total desc

### ✅ Frontend
`/app/frontend/app/(tabs)/calendario.tsx`:
1. **Default view = "month"** (era "week") — 1 riga cambiata
2. **Filtri riposizionati**: rimosso il blocco scope + area + membri dall'header; inseriti DENTRO la ScrollView interna, subito DOPO `MonthGrid` (o WeekView/YearGrid) → la griglia calendario resta sempre visibile in cima
3. **Rimossa duplicazione "Tutti"**: scope tab "Tutti" rinominato → **"Io + Team"** (mantenendo semantica: mine=solo io, team=solo altri, all=entrambi). Il "Tutti" nell'area filter (categoria) resta invariato → una sola etichetta "Tutti" visibile
4. **Backlog persistente** (`backlogItems` memoized):
   - Filtra `items` per `kind === "appt" && is_mine !== false && !done`
   - Solo eventi con `start_at <= fine di oggi (23:59:59)` → include oggi + tutti gli arretrati
   - Rispetta l'area filter attivo
   - Ordinato per data ascendente (più vecchi in alto)
   - Card colorata: giallo per oggi, rosso per arretrati ("N giorni fa")
   - Header con conteggio + hint "Restano visibili finché non li segni come fatti o riprogrammi"
5. **Completati filtrati a mezzanotte**: implicito nel `dayItems` esistente (`sameDay` esclude passato); nel backlog il filtro `!done` esclude già i completati; se un evento è completato entro le 23:59 di oggi resta comunque nel day view della data corrispondente
6. **Link statistiche**: bottone "Statistiche appuntamenti" chevron-forward sotto i filtri → naviga a `/appointment-stats`

**Nuova schermata `/app/frontend/app/appointment-stats.tsx`**:
- Range selector (7g / 30g / 3mesi / 6mesi / 1anno)
- 2 KPI card: **I miei** (blu) e **Gruppo** (viola) con total + badge done/undone + % completati
- Search filter per nome collaboratore
- Lista per collaboratore con nome, ruolo, total, badge ✓/✗, progress bar %

### ✅ Verifica end-to-end (senza testing agent)
- Backend `/appointments/stats?range_days=30` → 200 OK, ritorna mine/group/per_user con 4 righe reali ✅
- Fix: `datetime.timedelta` → `timedelta` (import già esistente)
- Lint pulito ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.18 Feature — Banner Evento: range date + descrizione + audio (Feb 2026)
### 🎯 Richieste utente
1) Range date: aggiungere data fine opzionale + selettore nativo calendario/orologio (DateTimePicker) per data inizio e fine.
2) Aggiungere campo testo libero "Descrizione evento".
3) Aggiungere allegato audio (registrazione o upload mp3/m4a/wav) condivisibile con la locandina PDF.

### ✅ Backend (`/app/backend/server.py`)
`EventBannerIn` + `EventBannerUpdate` estesi con:
- `event_end_at: Optional[datetime]` — data/ora fine evento (opzionale)
- `description: Optional[str]` — descrizione libera
- `audio_base64` + `audio_mime` + `audio_name` — allegato audio

**Endpoint nuovi**:
- `GET /api/event-banners/{id}/audio` — restituisce l'audio (lazy, RBAC via `_event_visible_to_user`)

**Endpoint modificati**:
- `POST /api/event-banners` — persiste i nuovi campi
- `PUT /api/event-banners/{id}` — whitelist campi nullable estesa a `audio_*`, `event_end_at`, `description` per consentirne il clear via `null`
- `GET /api/event-banners/{id}` — proietta OUT `audio_base64` (per performance) e aggiunge flag `has_audio: bool`
- `GET /api/event-banners/active` — proietta OUT anche `audio_base64` per rispose leggere

### ✅ Frontend (`/app/frontend/app/event-banners.tsx`)
- Import di `@react-native-community/datetimepicker@8.4.4` + `expo-audio@1.1.1`
- **DateTimePicker nativo** su iOS/Android per Data inizio, Ora inizio, Data fine, Ora fine — tap sui campi apre picker calendario/orologio; su web fallback a TextInput con formato IT `GG.MM.AAAA` (parseItalianDateTime esistente)
- **Data fine opzionale** con bottone ✕ per resettare; validazione: se presente, deve essere > data inizio (altrimenti `notify("Range non valido")`)
- **Campo Descrizione** TextInput multiline, max 1000 char
- **Audio recording** (solo native): `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`, permesso runtime via `AudioModule.requestRecordingPermissionsAsync()`, timer contatore secondi live, stop → base64 encode → salva come `registrazione-{timestamp}.m4a` (audio/mp4)
- **Audio upload** (native+web): DocumentPicker `audio/*` accetta mp3/m4a/wav/aac/ogg — max 20 MB
- **Playback dell'audio caricato**: `useAudioPlayer(dataUri)` con toggle play/pause + rewind, `seekTo(0)` prima di ogni play
- **Clear audio** con conferma → pause player + audio=null
- In `openEdit()` se `has_audio: true` → fetch dedicato `/event-banners/{id}/audio` per pre-caricare in editing

### ✅ Verifica end-to-end (senza testing agent)
- Create con event_end_at + description + audio → 200 OK ✅
- GET evento: `has_audio: true`, `audio_base64` NOT in main response ✅
- GET `/audio` endpoint: ritorna name/mime/data_base64 correttamente ✅
- Update con `audio_base64: null` → `has_audio: false` ✅ (dopo fix whitelist)
- Lint pulito ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent. Test audio recording richiede build reale (native only, non funziona in Expo Go Web preview).



## v2.17 Feature — Configura intestazione report (Feb 2026)
### 🎯 Richiesta utente
Nel modulo analisi fatture e report CTE, aggiungere una schermata di configurazione intestazione: logo aziendale, nome azienda, slogan, contatti. I dati devono apparire nell'header del report al posto del default, salvati automaticamente e modificabili in qualsiasi momento.

### ✅ Stato preesistente
Backend già preparato dai versioni V38I/V38U:
- 4 campi in `User`/`UserOut`: `company_name`, `company_logo_base64`, `report_slogan`, `report_contacts`
- Endpoint `PUT /api/auth/profile` accetta tutti e 4
- `_build_analysis_html` e `_build_cte_report_html` già leggono da `db.users` e producono l'header brandizzato

**Mancava** solo un accesso rapido dalla sezione Fatture (finora era solo in `impostazioni.tsx`).

### ✅ Fix applicato
**Nuovo componente** `/app/frontend/src/ReportHeaderConfigModal.tsx`:
- Bottom-sheet modal riusabile con 4 campi + logo picker (`pickAvatarBase64`)
- **Live preview** in cima al form (logo + nome + slogan + contatti) con lo stesso styling che verrà usato nel report reale
- Auto-load valori attuali da `user` all'apertura (via `useAuth`)
- Save via `PUT /api/auth/profile` con `refresh()` per riflettere i cambi ovunque
- Limiti: name 80 / slogan 140 / contacts 240 chars
- testID: `rhc-close`, `rhc-logo-pick`, `rhc-logo-clear`, `rhc-company-name`, `rhc-slogan`, `rhc-contacts`, `rhc-save`

**Integrato in 2 punti**:
- `/app/frontend/src/BillsSection.tsx` (scheda cliente) — bottone nero `bills-header-cfg-btn` "Configura intestazione" con icona ⚙ ingranaggio, posizionato subito prima di "Genera Report PDF"
- `/app/frontend/app/bill-quick.tsx` (master) — bottone nero `bq-header-cfg-btn` "Configura intestazione report" posizionato subito dopo la intro card, prima delle "Offerte aziendali"

### ✅ Verifica end-to-end (senza testing agent)
- PUT `/auth/profile` con 4 campi → 200 OK ✅
- GET `/auth/me` restituisce tutti i valori inseriti (name / slogan / contacts multi-line / logo base64) ✅
- Lint pulito ✅
- Modal apre correttamente e i valori pre-esistenti vengono caricati automaticamente ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.16 Feature — Share fallback + Indirizzo strutturato Appuntamenti (Feb 2026)
### 🎯 Richieste utente
1) I bottoni Email/WhatsApp/SMS di "Condividi con il cliente" devono funzionare anche senza contatto collegato, usando telefono/email inseriti nell'appuntamento.
2) Il campo Indirizzo deve essere suddiviso in 5 campi separati: Via/Piazza, Numero civico, Città, CAP, Provincia.

### ✅ Backend (`/app/backend/server.py`)
`AppointmentIn` + `AppointmentUpdate` estesi con:
- `email: str = ""` — email diretta appuntamento
- `address_street`, `address_number`, `address_city`, `address_zip`, `address_province` — 5 campi indirizzo strutturato

I campi originali `location` e `full_address` sono mantenuti per backward-compat.

### ✅ Frontend
**`/app/frontend/src/AppointmentShareActions.tsx`** (v2.16):
- Nuovo helper esportato `composeAppointmentAddress(appt)` che costruisce l'indirizzo `Via Numero, CAP Città (PROV)` dai campi strutturati, con fallback al campo `location` legacy
- Il tipo `ApptDetails` ora accetta i campi indirizzo strutturato + `phone_mobile`/`phone_work`/`email`
- La logica dei bottoni usa `effectivePhone/effectiveWhatsapp/effectiveEmail` che risolvono in cascata: contact.field → appt.field
- Warning testuale aggiornato: *"Inserisci telefono o email nell'appuntamento (o associa un contatto)..."*
- `buildAppointmentMessage()` usa `composeAppointmentAddress()` per l'output finale

**`/app/frontend/app/appointment/new.tsx`**:
- Form state esteso con `email` + 5 campi indirizzo
- 3 nuovi gruppi UI: `[Via/Piazza | N. civico]`, `[CAP | Città | Prov]`, `Email cliente`
- CAP → number-pad, max 5 cifre; Provincia → uppercase, max 2 caratteri
- `submit()` compone `location` legacy dai campi strutturati se l'utente non l'ha compilato manualmente
- `postSave` modal ora include phone/email/indirizzo → `AppointmentShareActions` mostra i bottoni attivi

**`/app/frontend/app/appointment/[id].tsx`**:
- Tipo `Appointment` esteso con i nuovi campi opzionali
- Sezione "Condividi con il cliente" rifattorizzata per usare direttamente `<AppointmentShareActions>` con fallback appt → i bottoni ora si attivano se l'appuntamento ha phone/email anche senza contact collegato
- Rimosso codice duplicato inline (compone testo + 3 Pressable manuali → 40 righe eliminate)
- Warning aggiornato: *"Nessun contatto collegato — puoi comunque usare i canali sopra se hai inserito telefono/email nell'appuntamento."*

### ✅ Verifica end-to-end (senza testing agent)
- Backend: POST/GET/PUT con nuovi campi → **200 OK, tutti persistiti + editabili** ✅
- `composeAppointmentAddress` Node inline test: 4/4 casi ok (completo, parziale, legacy, empty) ✅
- Lint pulito ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.15 Bug Fix — Condivisione Biglietto da Visita (Feb 2026)
### 🐛 Bug segnalato
Nel Biglietto da Visita, il bottone "Condividi" richiedeva 2 tap per funzionare, e la rotellina di caricamento continuava a girare anche dopo che la condivisione era avvenuta.

### 🔬 Root cause
1. **Double-tap**: `await import("html2canvas")` in `generateShareImage.ts` esegue un dynamic import al primo tap (~1s di lazy-load bundle). Durante quell'attesa il browser perde il contesto user-gesture, quindi `navigator.share()` viene rifiutata (NotAllowedError/SecurityError) e il codice cade in fallback download silente. Al secondo tap html2canvas è già in cache → gesture preservato → share funziona.
2. **Spinner infinito**: `setSharing(false)` era solo nel `finally` block. In alcuni browser `nav.share()` può stallare la promise dopo il completamento nativo, lasciando lo state bloccato.

### ✅ Fix applicato (`/app/frontend/modules/business-card/screens/BusinessCardScreen.tsx`)
1. **Pre-warm eager di html2canvas** in `useEffect` al mount (solo web) → il primo tap non paga più il costo di lazy-load, gesture preservato.
2. **Re-entrance guard** con `sharingRef = useRef(false)` — impedisce double-execution nel gap di 1 render frame tra tap e disabled prop.
3. **Safety timer** (30s) via `setTimeout` in `try/finally` che force-resetta sempre `sharing=false` anche se la promise di `nav.share()` non risolve mai.
4. **Handle AbortError** esplicito nel catch dell'outer wrapper — se l'utente annulla il share sheet nativo, non mostrare un banner d'errore rosso.
5. `finally` clean garantito: `clearTimeout(safetyTimer)` + `sharingRef.current = false` + `setSharing(false)`.

### ✅ Verifica
- Lint pulito ✅
- Expo restart senza errori ✅
- Il codice esistente in `generateShareImage.ts` già gestisce AbortError correttamente e ritorna `ok({shared:false})` invece di errore, quindi il finally si triggera come atteso.

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.14 Feature — "Invia dettagli" in creazione appuntamento (Feb 2026)
### 🎯 Richiesta utente
Nella sezione Appuntamenti, quando si crea o visualizza un appuntamento con numero di telefono del cliente, manca il pulsante per inviare i dettagli via SMS/WhatsApp. Aggiungerlo alla schermata di creazione con testo pre-compilato (data, ora, luogo).

### 🔬 Root cause / stato attuale
- `/app/frontend/app/appointment/[id].tsx` (view) — sezione share Email/WhatsApp/SMS **già presente** (linee 361-405)
- `/app/frontend/app/appointment/new.tsx` (create) — **mancante**: dopo `submit()`, `router.back()` immediato senza dare la possibilità di condividere

### ✅ Fix applicato
**Nuovo componente condiviso** `/app/frontend/src/AppointmentShareActions.tsx`:
- Helper `buildAppointmentMessage(appt, contact)` esportato — testo IT localizzato con emoji (📅 titolo, 🗓 data lunga `dateStyle:full timeStyle:short`, 📍 luogo, 📞 telefonico, Note)
- Componente `<AppointmentShareActions appt contact />` con 3 bottoni: Email (mailto), WhatsApp (wa.me), SMS (sms:) — auto-disabled se manca il canale
- Warning inline se il contatto non ha né phone né email

**Integrato in** `/app/frontend/app/appointment/new.tsx`:
- Nuovo state `postSave` popolato in `submit()` dopo la POST riuscita
- Se il contatto selezionato ha phone o email → apre bottom-sheet modal "Appuntamento creato ✅ — Vuoi inviare i dettagli al cliente ora?" con `<AppointmentShareActions />`
- Se nessun canale disponibile → `router.back()` come prima (nessuna regressione)
- Al tap "Chiudi senza inviare" → `router.back()`
- testID: `appt-share-email`, `appt-share-whatsapp`, `appt-share-sms`, `post-save-close`

**`[id].tsx` (view)** non modificato — codice share esistente conservato (testID storici `share-email`/`share-whatsapp`/`share-sms` preservati per backward compat).

### ✅ Verifica (senza testing agent)
- Node inline: `buildAppointmentMessage()` genera 280 char testo IT localizzato ✅
- Lint pulito su entrambi i file ✅
- Expo riavvia senza errori ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.13 Bug Fix — Parsing data italiana in Banner Evento (Feb 2026)
### 🐛 Bug segnalato
`event-banners.tsx:223` — `new Date("27.08.2036T20:30:00").toISOString()` lanciava `RangeError: Invalid time value` perché `Date()` non parsa il formato italiano DD.MM.YYYY, blocca il salvataggio dell'evento.

### ✅ Fix applicato (`/app/frontend/app/event-banners.tsx`)
- Nuovo helper `parseItalianDateTime(d, t)` con regex robusti:
  - Data: `DD.MM.YYYY` | `DD/MM/YYYY` | `DD-MM-YYYY` | `YYYY-MM-DD` (backward compat) | `DD.MM.YY` (anno corto → 20xx)
  - Ora: `HH:MM` | `HH.MM` | `HH,MM` | `HHMM` (no separatore)
- Validazione range: anno 1970-3000, mese 1-12, giorno 1-31, ora 0-23, min 0-59
- Round-trip check: rifiuta 31 febbraio, 32 agosto ecc. (JS `Date` wrap-around detection)
- Se parse fallisce → notify user: *"Data o ora non valida. Usa il formato GG.MM.AAAA (es. 27.08.2036) e HH:MM (es. 20:30)"*
- Placeholder aggiornati: `GG.MM.AAAA` e `HH:MM` (era `YYYY-MM-DD` misleading)
- `openEdit()` ora precompila i campi in formato italiano `DD.MM.YYYY` invece di ISO
- Su native: `keyboardType="numbers-and-punctuation"` per tastiera numerica con `.`/`:` diretti

### ✅ Verifica (test unit inline con Node)
11/11 test passano: formati IT ok, backward compat ISO ok, rifiuta feb31/day32/hour25/garbage ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.12 Feature — CTE Comparativa (Multi-Bill Upload + Report) (Feb 2026)
### 🎯 Richiesta utente
Il consulente deve poter caricare più PDF fatture (luce/gas/telco) contemporaneamente per un singolo cliente. L'AI analizza tutte le fatture e genera un **report comparativo** con: consumi nel tempo, andamento spesa, confronto tra fornitori diversi, e suggerimento del fornitore più conveniente. Visualizzabile inline e condivisibile come PDF/HTML.

### ✅ Backend (`/app/backend/server.py`)
**Endpoint aggiunti**:
- `POST /api/contacts/{contact_id}/bills/bulk-upload` — accetta `{bills: [{bill_type, pdf_base64, pdf_name}, ...]}` (max 20). Per ciascun item crea un `energy_bill` in stato `pending` e schedula `_analyze_bill_task` in background (stessa pipeline della POST singola).
- `GET /api/contacts/{contact_id}/bills/cte-report` — genera HTML comparativo con:
  - **Header brandizzato** (logo + nome agenzia + data generazione)
  - **KPI row**: n. fatture, n. fornitori diversi, spesa totale
  - **SVG bar chart** andamento spesa nel tempo (colorato per bill_type)
  - **Tabelle confronto fornitori** per bill_type: fatture, spesa media, consumo medio + **badge "più conveniente"** al fornitore con spesa media minore
  - **Verdict AI Claude Sonnet 5** (`_llm_cte_verdict`): frase in italiano per tipo che indica fornitore più conveniente e perché (costo, spread, penali)
  - Returns `{name, mime: text/html, data_base64, bills_count, verdict}` pronto per `FileViewer`

### ✅ Frontend (`/app/frontend/src/BillsSection.tsx`)
- **`bulkUploadPdfs()`** — DocumentPicker con `multiple: true`. Auto-infer del `bill_type` dal nome file (contiene "gas"/"telco"/"internet" → tipo dedotto, altrimenti default "luce"). POST batch → notify success + reload.
- **`generateCTE()`** — GET `/cte-report` → apre inline in `FileViewer` + propone `SaveConfirmModal` per salvare come file cliente.
- **UI**: 2 nuovi bottoni sotto "Genera Report PDF":
  - 🟦 "Carica più fatture insieme" (`bills-bulk-upload-btn`, ciano #0891B2)
  - 🟢 "CTE Comparativa (N fatture)" (`bills-cte-btn`, verde #059669) — disabilitato se `totalDone < 1`; hint "consigliato con ≥ 2 fatture"

### ✅ Test end-to-end (senza testing agent)
File: `/app/backend/tests/test_v212_cte_comparativa.py`
- Upload bulk di 3 fatture (2 luce ENEL/Eni + 1 gas Eni) → **200 OK, count=3** ✅
- Polling 16s: tutte e 3 analizzate `status=done` ✅
- GET `/cte-report` → **200 OK, HTML 7788 chars** ✅
- HTML contiene "CTE Comparativa" + "Confronto fornitori" + badge "più conveniente" ✅
- Verdict AI popolato per luce e gas ✅
- Cleanup fatture di test completato ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.11 Feature — Estrazione automatica copertina dal PDF programma (Feb 2026)
### 🎯 Richiesta utente
Quando il master carica il PDF del programma evento, l'AI deve estrarre automaticamente l'immagine più significativa dal PDF e usarla come copertina del banner, ridimensionata correttamente.
### ✅ Backend
Nuova dipendenza: `pymupdf==1.28.2` (in `requirements.txt`).

- Nuovo helper `_extract_best_image_from_pdf(pdf_b64)`:
  1. Apre il PDF con PyMuPDF (fitz)
  2. Pass 1 — scansiona fino a 8 pagine estraendo immagini raster embedded via `page.get_images(full=True)`; scarta quelle < 200×200px; sceglie la più grande per area
  3. Pass 2 (fallback) — se nessuna immagine raster valida, **renderizza la prima pagina** a 2x scale come immagine sintetica
  4. Center-crop a 16:9 → resize a **1600×900** con Pillow LANCZOS
  5. Output JPEG qualità 85 (media 8-20 KB)
- Nuovo endpoint `POST /api/event-banners/{event_id}/extract-cover-from-pdf`:
  - Body `{apply: bool = true}`. Se true, aggiorna `cover_base64`/`cover_mime` del banner in DB.
  - Ritorna `{applied, cover_base64, cover_mime, size_bytes}`.
  - RBAC: solo master/admin (`_ensure_master`).
  - 400 se nessun PDF caricato; 422 se estrazione fallita.

### ✅ Frontend
`/app/frontend/app/event-banners.tsx`:
- `pickProgramPdf()` — dopo upload del PDF, se l'evento è già salvato E non c'è ancora una cover manuale, chiama **automaticamente** `/extract-cover-from-pdf` (fire-and-forget con notify success). Persiste il PDF via PUT prima dell'estrazione.
- Nuovo pulsante `event-extract-cover-btn` "Estrai copertina dal PDF con AI" (giallo `#F59E0B`, sparkles icon) visibile quando `programPdf` è caricato → chiama `extractCoverFromPdfNow()` esplicitamente.

### ✅ Test end-to-end (senza testing agent)
```
PDF con immagine 800×600 embedded → estratto, resize 1600×900, JPEG 18.5 KB ✅
PDF solo testo (nessuna immagine) → fallback rendering pagina 1, JPEG 8.8 KB ✅
Cover applicata a event_banners.cover_base64 ✅
```
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent (il nuovo pacchetto `pymupdf` è già in `requirements.txt` — sarà installato al deploy).



## v2.10 Feature — Banner Evento Master (Feb 2026)
### 🎯 Richiesta utente
Il master deve poter creare eventi con: immagine copertina, titolo, data, visibilità (singoli contatti / gruppi / tutti). Banner in home dei destinatari con countdown live (gg/hh/mm/ss). Tap → PDF programma condivisibile. Collaboratori vedono il banner anche senza usare la sezione master.

### ✅ Backend (`/app/backend/server.py`)
Nuova collection `event_banners` con schema completo (event_id, user_id/tenant, created_by, title, event_at, cover_base64/mime, program_pdf_base64/name, program_html AI, visibility_kind, visible_user_ids/contact_ids/group_ids, public_token, created_at/updated_at).

**Endpoint aggiunti**:
- `POST /api/event-banners` — crea evento (solo master/admin, `_ensure_master`)
- `GET /api/event-banners` — lista (light, master only)
- `GET /api/event-banners/active` — banner visibili per l'utente corrente (team + master, con filtro visibility)
- `GET /api/event-banners/{id}` — dettaglio (con RBAC check `_event_visible_to_user`)
- `PUT /api/event-banners/{id}` — update
- `DELETE /api/event-banners/{id}` — elimina
- `POST /api/event-banners/{id}/generate-program` — AI Claude Sonnet 5 genera HTML programma professionale
- `GET /api/event-banners/{id}/program` — restituisce PDF o HTML programma per FileViewer
- `GET /api/public/event-banners/{token}` — pagina pubblica HTML (no auth) con hero + countdown script + link programma per contatti

### ✅ Frontend
- `/app/frontend/src/HomeEventBanner.tsx` — componente hero con cover full-width, countdown live 1s tick, CTA "Apri il programma". Auto-hide se nessun evento attivo. Mostrato nella home tab (`(tabs)/home.tsx`) subito sotto il tile Master.
- `/app/frontend/app/event-banners.tsx` — screen master con lista eventi + modal creazione/modifica: cover picker (universale web/native), titolo, data+ora, visibility (Tutti / Solo selezionati con chip per collaboratori/gruppi contatti/contatti singoli), upload PDF programma OPPURE generazione AI (con descrizione + durata hint).
- `/app/frontend/app/event/[id].tsx` — screen dettaglio evento con hero + countdown + 2 bottoni "Apri programma" (FileViewer inline) e "Condividi link pubblico" (Web Share API / native Share). ShareSheet integrato per condivisione del PDF/HTML.
- `/app/frontend/app/master.tsx` — nuovo tile 🟡 "Banner Evento" (megaphone icon, `#F59E0B`) che apre `/event-banners`.

### 🔐 Visibility rules
- `_ensure_master(user)` — solo owner/admin possono creare/modificare/eliminare eventi
- `_event_visible_to_user(banner, user)`:
  - Owner del tenant → sempre visibile
  - `visibility_kind = "all"` → tutti i team member vedono il banner
  - `visibility_kind = "specific"` → solo user_id in `visible_user_ids` vedono il banner
  - Contatti clienti raggiungono l'evento tramite **link pubblico** condiviso dal master (nessun accesso automatico)

### 📱 UX del banner in home
- Hero 220px, cover con gradient overlay per leggibilità
- Badge "EVENTO IN ARRIVO" oro
- Titolo bold 22px + data formattata italiana
- 4 box countdown (giorni/ore/min/sec) con tick 1s
- CTA "Apri il programma" (chevron)
- Se evento passato → badge rosso "Evento in corso"

### Verifica manuale (senza testing agent)
- ✅ Creazione evento via API → appare in `/event-banners/active`
- ✅ Home mostra banner "Convention 2026 Roma" con countdown live (06gg 23h 57m 52s verificato via screenshot)
- ✅ Cleanup evento test completato
- ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.9 Rename — "Note AI" → "Consulenza Corporate" (Feb 2026)
### 🎯 Richiesta utente
Rinominare "Note AI" (e la variante dinamica "Note di {consulente}") in "Consulenza Corporate" in tutta l'app.
### ✅ Modifiche applicate
**Frontend user-facing labels**:
- `/app/frontend/src/BillFieldRenderers.tsx` (linea 237, `BillFieldRow`): la sezione bulleted list per `note_ai` ora mostra label **"Consulenza Corporate"** (era `humanizeKey("note_ai") → "Note Ai"`)
- `/app/frontend/src/BillsSection.tsx` (linea 446, `buildBillAnalysisHtml`): la label HTML della riga note nella tabella analisi è ora `"Consulenza Corporate"` (era `Note di ${consultantName}`)
- `/app/frontend/src/BillsSection.tsx` (linea 1703, `humanKey` map): `note_ai: "Consulenza Corporate"` (era `"Note AI"`)
- `/app/frontend/src/BillsSection.tsx` (linea 1765, `renderExtractedTable`): heading HTML `"Consulenza Corporate"` (era `"Note AI"`)

**Backend user-facing HTML**:
- `/app/backend/server.py` (`_build_analysis_html`, linea ~4219): titolo `<h3>` note ora sempre `"Consulenza Corporate"` (era `Note di {consultant}`)

**Test aggiornati**:
- `/app/backend/tests/test_v38w_analysis_page_fixes.py`: 3 test rinominati per asserire la nuova label statica + 1 asserzione E2E aggiornata. **25/25 test passano ✅**

### Note
- La chiave JSON interna `note_ai` è mantenuta inalterata (usata da LLM prompt + parser + `_parse_llm_json` fallback). Solo la label mostrata all'utente è cambiata.
- Coerente sia su preview che sulle analisi già salvate (rerender lato client dalla data_base64).
- Testing agent NON invocato (esplicita richiesta utente); pytest backend eseguito manualmente.
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.8 Redesign — Master "Analizza bolletta" allineato a BillsSection (Feb 2026)
### 🎯 Richiesta utente
La sezione "Analizza bolletta" lato Master deve essere identica visivamente e funzionalmente alla sezione fatture nella scheda cliente: stesse sezioni Luce/Gas/Telco, stesso caricamento PDF, stesse offerte aziendali, stessa lista fatture analizzate.
### ✅ Fix applicato
`/app/frontend/app/bill-quick.tsx` — riscritto da zero (772 → 890 righe) per rispecchiare `BillsSection.tsx`:
- **Intro card** blu identica (`#EEF2FF` + "Fatture Energia · AI Claude Sonnet 5")
- **Offerte aziendali accordion viola** (`#F5F3FF`/`#7C3AED`) — upload PDF offerta + textarea manuale + `VoiceDictationButton` + salva testo + lista offerte
- **3 sezioni raggruppate Luce (giallo) / Gas (rosso) / Telco (ciano)** con header colorato + counter, ognuna con il proprio bottone dashed "Carica fattura PDF"
- **Card fattura identica**: header con icona document-text + pdf_name + status pill colorato + trash/cancel/chevron; body espandibile con `BillFieldRow` (stesso rendering che il cliente per `consumi_mensili`, `parametri_richiesti`, `note_ai`, fiscal_check)
- **Params modal identico**: header colorato + emoji, `PARAMETRI STANDARD` pill toggle-able, `PARAMETRI PERSONALIZZATI` con badge viola, input custom, counter "Selezionati: N"
- **Azioni master-specifiche**: Apri PDF · Annulla analisi · Ri-analizza · Associa a cliente · Crea cliente · Elimina (in luogo di "Salva sul cliente" del cliente)
- **Fiscal-check config** mantenuto come bonus master-side (Verifica IVA 10/22, Accise gas, PCV)

`/app/backend/server.py`:
- Nuovo endpoint `POST /api/bill-drafts/{draft_id}/cancel` — parity con `/contacts/{id}/bills/{bill_id}/cancel` (checkpoint già rispettato in `_analyze_draft_task`)

### Note
- `/company-offers` è tenant-scoped → le stesse offerte aziendali sono ora visibili sia lato master che lato cliente.
- Bug #1 (analisi non appariva nei file cliente) già fixato in v2.7 tramite `_push_draft_files_to_contact`.
- Testing agent NON invocato (esplicita richiesta utente); verifica visiva via screenshot: UI identica al cliente ✅
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.7 Bug Fix — Analisi bolletta non appare nei file cliente (Feb 2026)
### 🐛 Bug segnalato
Lato Master: dopo aver analizzato una fattura e averla associata a un cliente esistente, l'analisi non appariva nei "File" del cliente (tab file della scheda contatto). L'analisi restava solo nel cabinet Master del consulente.
### 🔬 Root cause
`POST /api/bill-drafts/{id}/associate` creava solo l'`energy_bills` doc (che alimenta il tab "Fatture" del cliente) ma NON copiava il PDF né l'HTML analisi in `contacts.files`. Stessa mancanza in `POST /api/bill-drafts/{id}/create-contact`.
### ✅ Fix applicato
`/app/backend/server.py`:
- Nuovo helper `_push_draft_files_to_contact(draft, contact_id)` che riusa `_build_analysis_html` (stessa render usata per master_files) e pusha nel `contacts.files` array:
  1. Il PDF originale (nome `{base}.pdf`, mime `application/pdf`)
  2. L'HTML analisi (nome `Analisi-{base}.html`, mime `text/html`)
- Idempotente: verifica nomi esistenti in `contact.files` prima di push (skip duplicati)
- Chiamato in `associate_bill_draft` (associa a contatto esistente) e in `create_contact_from_draft` (crea nuovo contatto da draft)
### Note
- Il PDF resta anche in `energy_bills.pdf_base64` per il tab Fatture del cliente (non tocchiamo quel flusso).
- L'analisi resta anche in `master_files` (cabinet Master) come archivio consulente.
- Testing agent NON invocato (esplicita richiesta utente).
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.6 Bug Fix — Share nativo in "I miei file" (Feb 2026)
### 🐛 Bug segnalato
Nella sezione "I miei file" (Master Files) il pulsante Condividi → "Sistema" scaricava direttamente il file invece di aprire il menu di condivisione nativo del sistema. Su mobile e su web funzionava come un semplice download.
### 🔬 Root cause
`shareDataUri()` in `/app/frontend/src/share.ts`: su `Platform.OS === 'web'` andava dritto a `document.createElement('a').click()` (download). Mai tentava la Web Share API con files (Level 2), pur essendo supportata da Safari iOS e Chrome Android.
### ✅ Fix applicato
`/app/frontend/src/share.ts`:
- Nuovi helper `base64ToBytes()` e `webDownload()` interni.
- `shareDataUri()` su web: prova prima `navigator.canShare({files:[File]})` → `navigator.share({files})`; se `AbortError` (utente annulla) esce silenziosamente; solo se Web Share API assente/rifiuta → fallback `<a download>` originale.
- Native invariato (expo-sharing / Share sheet iOS/Android).

`/app/frontend/src/ShareSheet.tsx`:
- `shareSystem()` ora chiama `onClose()` dopo condivisione riuscita per UX più pulita.
### Note
- Su Chrome desktop la Web Share API con files non è ancora supportata → fallback download resta il comportamento atteso.
- Su iOS Safari / Android Chrome ora si apre il vero share sheet nativo del sistema (WhatsApp, Mail, AirDrop, ecc.).
- Testing agent NON invocato (esplicita richiesta utente).
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.5 Bug Fix — Overlay Calcolatrice fuori posizione (Feb 2026)
### 🐛 Bug segnalato
L'overlay/bottom-sheet della Calcolatrice appariva fuori posizione, non centrato, e su viewport large fuoriusciva dai bordi.
### ✅ Fix applicato
`/app/frontend/src/CalculatorFAB.tsx` — stili del bottom-sheet:
- `backdrop`: aggiunto `alignItems: 'center'` per centrare orizzontalmente
- `sheet`: aggiunto `width: '100%'`, `maxWidth: 480`, `alignSelf: 'center'` (clamp responsive per desktop/tablet)
- `sheet`: `paddingBottom` aumentato a 34px su iOS (safe-area home-indicator) e 24px su Android
- Manteniamo `maxHeight: 62%` e `justifyContent: 'flex-end'` (pinned bottom con feel di bottom sheet)
### Note
- Su phone: bottom sheet a full-width come prima
- Su desktop/tablet: sheet centrato con margine laterale (max 480px)
- Su iOS moderni: no clip da home-indicator
- Testing agent non invocato (esplicita richiesta utente)
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.4 Bug Fix — Report inline nella scheda cliente (Feb 2026)
### 🐛 Bug segnalato
Il report/comparazione generato dalla scheda cliente (contact/[id] → tab Fatture → "Report fatture" / "Confronta") si apriva in una finestra esterna (browser print dialog o nuova tab) invece di essere mostrato inline come su master-files.
### 🔬 Root cause
`BillsSection.tsx` usava `printHtmlOnWeb(html, ...)` che apre `window.open()` → nuova tab con `print()`. Master-files invece usa `FileViewer` inline con HTML base64.
### ✅ Fix applicato
`/app/frontend/src/BillsSection.tsx` — allineato al pattern di master-files:
- Import `FileViewer` e aggiunto state `viewerOpen`
- Nuovo helper `openHtmlInline(html, name)` che base64-encode l'HTML (UTF-8 safe: `encodeURIComponent → btoa`) e lo apre in FileViewer
- Sostituite le 2 chiamate `printHtmlOnWeb` in `generateReport()` e `runComparison()` con `openHtmlInline`
- `<FileViewer visible mime="text/html" ...>` aggiunto al JSX del componente
- Estensioni cambiate da `.pdf` a `.html` (il file è HTML, non PDF)
### Note
- `printHtmlOnWeb` mantenuta come dead code (marker `unused` nel lint) per compatibilità futura se serve stampa nativa. Da rimuovere in una prossima passata di dedup.
- FileViewer già supporta UTF-8 HTML decode (fix v2.0) quindi emoji e accenti nel report sono già gestiti correttamente
- Testing agent non invocato (utente ha esplicitamente richiesto skip)
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.3 Bug Fix — Web Share API PNG condivisione (Feb 2026)
### 🐛 Bug segnalato
Su web, la condivisione del PNG del biglietto da visita dava sempre errore "Errore condivisione", il download fallback non veniva mai eseguito.
### 🔬 Root cause
La QR code image era caricata da `api.qrserver.com` (cross-origin, senza CORS headers) → html2canvas rendeva il canvas "tainted" → `combined.toDataURL('image/png')` lanciava `SecurityError` → l'intera share flow falliva prima ancora di arrivare al download fallback.
### ✅ Fix applicato
**`CardHtmlMirrors.tsx`**:
- `useEffect` che genera la QR come **data URL locale** tramite libreria `qrcode` (già installata come dep transitiva di `react-native-qrcode-svg`)
- Import dinamico → no impatto sul bundle native
- `crossOrigin='anonymous'` sull'img come safety net
- Config: `margin:0, width:120, color:{dark:'#1A2A6C', light:'#FFFFFF'}`

**`generateShareImage.ts`**:
- html2canvas opts: `allowTaint: false` (fail early), `imageTimeout: 15000`
- Web Share API: gestisce **AbortError** (utente cancella) → `ok({shared:false})` no red banner
- Guard `window.isSecureContext !== false`
- Download fallback wrappato in try/catch — last-resort apre PNG in nuova tab
- Never returns `err()` se PNG generato correttamente
### ✅ Test
- `testing_agent` iterazione 70 — end-to-end Playwright:
  - PNG scaricato realmente: **962KB, 5328x918 RGBA**, fronte+retro affiancati, QR navy visibile su bianco ✅
  - Zero banner "Errore condivisione" ✅
  - Zero `SecurityError` / `Tainted canvas` in console ✅
  - QR image `src` inizia con `data:image/png;base64,...` (locale) ✅
- Non-regressione: flip, save, effetti PNG (v1.9), logo senza box (v2.2) tutti OK
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.2 Bug Fix — Box bianco attorno al logo del biglietto (Feb 2026)
### 🐛 Bug segnalato
Logo del biglietto da visita mostrava un box bianco attorno all'immagine sull'anteprima live (il PNG condiviso era già fixato in v1.4/v1.8).
### 🔬 Root cause
`<RNImage>` di React Native su Web viene renderizzato come `<div>` con `background-image` — questo poteva creare un box visibile in certe condizioni di rendering.
### ✅ Fix applicato
`/app/frontend/modules/business-card/screens/BusinessCardScreen.tsx`:
- Su Platform.OS === 'web', il logo ora usa un `<img>` HTML nativo (non `<RNImage>`) con stili espliciti: `background: transparent`, `backgroundColor: transparent`, `border: none`, `boxShadow: none`, `outline: none`, `objectFit: contain`
- Su native (iOS/Android) mantiene `<RNImage>` (già funziona correttamente)
- `logoWrap` e `logoImg` styles aggiornati con `backgroundColor: 'transparent'` esplicito
- `CardHtmlMirrors.tsx` (PNG condiviso): aggiunto `outline: 'none'` per completezza
### ✅ Test
- `testing_agent` iterazione 69 — verifica DOM completa:
  - `tagName: IMG` (non più `DIV`) ✅
  - `backgroundColor: rgba(0,0,0,0)` (trasparente) ✅
  - `logoWrap` transparent, `border: 0px none`, `boxShadow: none`, `outline: 0px` ✅
  - Zero `<div>` visibili con `data:image` background
- Non-regressione: flip fronte/retro, save, share PNG, QR retro tutti OK
### ⚠ Nota
Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.1 Bug Fix — Tag HTML visibili nel testo AI (Feb 2026)
### 🐛 Bug segnalato
Nell'output delle analisi (invoice-analysis) apparivano tag HTML come `<br>`, `<p>` visibili come testo grezzo invece che essere renderizzati/rimossi.
### 🔬 Root cause
L'AI restituisce testo formattato con tag HTML (per line break). Il codice passava questo testo direttamente a `esc()`/`escHtml()` prima di inserirlo nell'HTML → i tag venivano ESCAPED (`<br>` → `&lt;br&gt;`) e mostrati letteralmente all'utente.
### ✅ Fix applicato
Aggiunto sanitizer in 3 punti (backend + 2 file frontend con parity byte-identical):
- **Backend** (`_build_analysis_html`): funzione `_sanitize_ai(text)` che:
  - `<br>` → `\n`, `<p>` → `\n\n`, `<li>` → `• `
  - Strippa tutti gli altri tag
  - Decodifica entità HTML (`&nbsp; &amp; &lt; &gt; &quot; &#39;`)
  - Applicata a `fornitore`, `offerta`, `note_ai`, valori KV
- **Frontend** `BillsSection.tsx`: `sanitizeAi()` con stesso pattern applicato in `renderValue()` e su `note_ai`
- **Frontend** `BillFieldRenderers.tsx`: `sanitizeAiText()` esportata + applicata in `formatVal` e rendering `note_ai`
### ✅ Test
- `testing_agent` iterazione 68 — 15/15 pytest backend + 10/10 Node.js parity test frontend PASS
- File test creati: `/app/backend/tests/test_v39_html_sanitize.py` + `/app/backend/tests/v39_js_sanitize_parity.js`
- Sicurezza XSS: nessuno `<script>` sopravvive; `esc()` finale neutralizza qualsiasi carattere speciale rimasto
- Non-regressione: fiscal check, parse_error banner (v1.9), UTF-8 emoji (v2.0) tutti OK
### ⚠ Nota
Sanitizer duplicato in 3 file (per isolamento inter-modulo). Se in futuro vuoi centralizzare, sposta in `@/src/shared/`.
Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.0 Bug Fix — Encoding UTF-8 negli HTML report (Feb 2026)
### 🐛 Bug segnalato
Emoji e caratteri accentati corrotti (mostrati come `âš `, `Ã¨`, `â‚¬` invece di ⚠, è, €) negli HTML analysis report renderizzati nel FileViewer (master-files → Analisi).
### 🔬 Root cause
`FileViewer.tsx` decodificava base64 HTML con `atob(dataBase64)` diretto. `atob()` restituisce una **binary string** (1 char = 1 byte, Latin-1). I caratteri multi-byte UTF-8 (emoji = 4 bytes, `è` = 2 bytes, `€` = 3 bytes) venivano quindi corrotti perché ogni byte veniva interpretato come Latin-1 separato.
### ✅ Fix applicato
`/app/frontend/src/FileViewer.tsx`:
- Aggiunto `useMemo htmlDecoded` che:
  1. `atob(base64)` → binary string
  2. Byte-per-byte in `Uint8Array` (via `charCodeAt(i) & 0xff`)
  3. `new TextDecoder('utf-8').decode(bytes)` → stringa Unicode corretta
  4. Fallback graceful con `decodeURIComponent/escape` per runtime senza TextDecoder
  5. Never throws (ritorna "" su errore)
- Sostituito in ENTRAMBI i punti di rendering: `<iframe srcDoc>` (web) e `<WebView source={html}>` (native)
- Non toccato il path PDF (binary bytes, va OK con atob diretto)
### ✅ Test
- `testing_agent` iterazione 67 — byte-level unit test in browser:
  - OLD path (plain atob) su input `"⚠ Attenzione! più tardi, è possibile analizzare €100 — perché no? 🏢💡"` produce ESATTAMENTE la corruzione riportata: `"â  Attenzione! piÃ¹ tardi, Ã¨ possibile analizzare â¬100 â perchÃ© no? ð¢ð¡"`
  - NEW path (atob → Uint8Array → TextDecoder) → roundtrip perfetto, tutti i simboli corretti
- Backend confermato corretto: `<meta charset="UTF-8"/>` + `html.encode('utf-8')`
### ⚠ Nota per produzione
Fix attivo in **preview**. Per attivarlo in produzione: **Redeploy** dal pannello Emergent.


## v1.9 Bug Fix — JSON parsing robusto nel Fiscal Check (Feb 2026)
### 🐛 Bug segnalato
Modulo `invoice-analysis` → Fiscal Check mostrava "JSON parse error" rosso quando la risposta AI era malformata (sia preview che produzione).
### ✅ Fix applicato
**Backend** (`/app/backend/server.py`):
- Nuovo helper `_parse_llm_json(raw, fallback_key)` con 3 tentativi di parsing:
  1. Strict `json.loads()`
  2. Estrazione outermost `{...}` via regex
  3. Repair defects (trailing commas, single→double quotes, unquoted keys)
- Su fallimento ritorna `{parse_error: True, error_message: "L'analisi AI ha restituito una risposta non valida..."}` — **mai raise**
- Sostituite 5 chiamate `_json.loads(raw)` sparse nei flussi LLM (bill analysis, contact extraction, offer analysis, offers comparison, bills report)
- `_build_analysis_html` mostra banner rosso "⚠ Analisi non riuscita" e nasconde le chiavi diagnostiche interne
### Frontend
- `BillFieldRenderers.tsx`: rendering dedicato di `parse_error` come banner rosso con messaggio user-friendly; nascosto `parse_error_kind` diagnostico
- `BillsSection.tsx`: `parseErrorHtml` renderizzato PRIMA del contenuto della bolletta; filtrate chiavi interne dalle KV rows
### ✅ Test
- `testing_agent` iterazione 66 — **17/17 test backend PASS** (unit su `_parse_llm_json` + integration su `_build_analysis_html` + E2E con PDF random)
- Regression 12/12 fiscal-check passa ancora
- Frontend Playwright: nessuna stringa tecnica leak (`JSON parse error`, `Expecting value`, `Traceback`) sulla pagina
- Test file creato: `/app/backend/tests/test_v38z_json_parse_robust.py`
### ⚠ Nota per produzione
Il fix è ora attivo in **preview**. Per attivarlo in **produzione** l'utente deve fare **Redeploy** dal pannello Emergent.


## v1.8 Refactor Architetturale — Fase 3 COMPLETATA (Feb 2026)
### 🏗️ 4 moduli migrati: `invoice-analysis`, `master`, `communications`, `profile`
- **`invoice-analysis/`**: types (`BillType`, `BillStatus`, `EnergyBill`, `BillCreateInput`, `BillGrouped`, `CompanyOffer`) + 8 funzioni API `Result<T>` (listContactBills, createBill, reanalyzeBill, cancelBillAnalysis, deleteBill, getBillReport, getBillComparison, listCompanyOffers)
- **`master/`** (condivide componenti base con invoice-analysis re-esportando `BillType`/`BillStatus`/`EnergyBill` — architectural symmetry): types (`MasterCategory`, `MasterFile`, `Contract`, `WebLink`) + 7 funzioni API `Result<T>`
- **`communications/`**: types (`ChatMessage`, `ChatChannel`, `MessageKind`, `ShareTargetKind`) + 3 funzioni API chat `Result<T>`
- **`profile/`**: types (`UserProfile`, `UserRole`, `ThemeMode`, `UserSettings`, `ProfileUpdateInput`) + 4 funzioni API `Result<T>` (getMe, updateProfile, getUserSettings, updateUserSettings)
### 🛡️ 7 route wrappate con ModuleErrorBoundary (Fase 3)
- `/master`, `/master-files` → moduleName="master"
- `/(tabs)/chat`, `/chat/[id]` → moduleName="communications"
- `/(tabs)/impostazioni`, `/security` → moduleName="profile"
- `/bill-quick` → moduleName="invoice-analysis"
### 📊 Totale refactor (Fasi 1+2+3)
- **14 route protette** con `ModuleErrorBoundary` — crash isolato per modulo
- **7 moduli** con API pubblica tipizzata + `Result<T>` + `AsyncResource<T>` per stati espliciti
- **Zero regressione** confermata su tutte le 3 iterazioni di testing_agent (61 tests totali)
- **Adozione hook**: business-card è il pilota (full-migrated). Contacts/agenda/invoice-analysis/master/communications/profile hanno API pubbliche pronte per adozione progressiva nelle UI screens senza rischio break
### 🔮 Backlog
- Adozione hook `useContact`/`useAppointment` nelle screen (~5000 righe da rifattorizzare, richiede sessioni dedicate)
- Rimozione codice duplicato residuo (esempi: `Settings` type ripetuto in impostazioni + contact/new + appointment/new)
- Sostituzione librerie Expo con Web API standard dove il modulo è cross-platform (già fatto per image picker in v1.4)


## v1.7 Refactor Architetturale — Fase 2 (Feb 2026)
### 🏗️ Moduli migrati: `contacts` + `agenda`
- **Approccio pragmatico**: le screen esistenti (~5000 righe totali) sono state protette da `ModuleErrorBoundary` senza riscritture, mentre le loro API pubbliche sono state estratte nei moduli. Adozione progressiva delle hook nelle Fasi successive.
- **`/app/frontend/modules/contacts/`**:
  - `types.ts` — `Contact`, `ContactLite`, `ContactWriteInput`, `ContactNote`, `ContactFile`, `ContactGroup`, `Anniversary`, `CustomArea`, ecc.
  - `api.ts` — 7 funzioni tipizzate con `Result<T>`: listContacts, getContact, createContact, updateContact, deleteContact, assignContact, listGroups
  - `hooks/useContact.ts` + `useContactsList.ts` — `AsyncResource<T>` + eventi bus (`contact:updated`, `contact:deleted`)
- **`/app/frontend/modules/agenda/`**:
  - `types.ts` — `Appointment`, `AppointmentWriteInput`, `AppointmentAttachment`, `TeamMember`, ecc.
  - `api.ts` — 7 funzioni tipizzate: listAppointments, getAppointment, createAppointment, updateAppointment, deleteAppointment, listTeamMembers, listTeamAppointments
  - `hooks/useAppointment.ts` — `AsyncResource<T>` + evento `appointment:updated`
- **6 route wrappate** con `ModuleErrorBoundary`:
  - `/(tabs)/contatti` `contact/new` `contact/[id]` → moduleName="contacts"
  - `/(tabs)/calendario` `appointment/new` `appointment/[id]` → moduleName="agenda"
### ✅ Test
- `testing_agent` iterazione 64 — 8/8 PASS, zero regressione confermata
- Sanity check completo su tutti i flussi: contatti lista/ricerca/creazione, appuntamenti creazione/modifica, calendario tab, business-card intatto
### 📅 Prossima fase
- Fase 3: migrare `invoice-analysis`, `master`, `communications`, `profile` + adozione hook nelle screen esistenti + rimozione codice duplicato residuo


## v1.6 Refactor Architetturale — Fase 1 (Feb 2026)
### 🏗️ Struttura modulare
- Creata `/app/frontend/modules/` con 7 sotto-cartelle (una per modulo): `contacts`, `invoice-analysis`, `agenda`, `business-card`, `master`, `communications`, `profile`
- Ogni modulo espone la propria API pubblica tramite `index.ts` — altri file interni sono privati
- Creata `/app/frontend/src/shared/` con utilities condivise:
  - `types.ts` — `AsyncResource<T>`, `Result<T>` (stati loading/success/error espliciti)
  - `api-client.ts` — `apiCall<T>() → Promise<Result<T>>` (nessuna eccezione attraversa confini)
  - `event-bus.ts` — pub/sub tipizzato per comunicazione inter-modulo (`contact:updated`, `appointment:created`, ...)
  - `ModuleErrorBoundary.tsx` — protegge ogni route: crash isolato al modulo
### 🎯 Modulo pilota migrato: `business-card`
- `types.ts` + `constants.ts` + `api.ts` (con `Result<T>`)
- `hooks/useBusinessCard.ts` — state management con `AsyncResource<BusinessCard>`
- `components/CardHtmlMirrors.tsx` — hidden HTML mirrors per html2canvas
- `screens/BusinessCardScreen.tsx` — screen principale
- `lib/` — `vcard.ts`, `injectAnimationCss.ts`, `generateShareImage.ts`, `pickLogo.ts` (con adapter web/native)
- `/app/frontend/app/business-card.tsx` ridotto a thin wrapper (17 righe) che monta `BusinessCardScreen` dentro `ModuleErrorBoundary`
### ✅ Test
- `testing_agent` iterazione 63 — 7/7 PASS, zero regressione confermata
- Isolamento modulare verificato: nessun import da file interni cross-modulo
- Sanity check su altri route (home, contatti, calendar, master): nessun crash
### 📅 Prossime fasi (backlog)
- Fase 2: migrare `contacts`, `invoice-analysis`, `master`, `agenda`
- Fase 3: migrare `communications`, `profile` + dedup + sostituzione librerie Expo con Web API dove possibile


## v1.5 Biglietto da visita — restyling (Feb 2026)
### 🎨 3 correzioni al Biglietto da Visita
1. **Condivisione unificata**: rimosso il concetto di "fronte/retro" nella condivisione. Il pulsante ora dice semplicemente **"Condividi"** e genera un **singolo PNG con fronte + retro affiancati** orizzontalmente (catturati entrambi via html2canvas su web, uniti in un canvas). Gap 24px, padding 20px.
2. **Design retro migliorato**: bordo navy 2px, angoli arrotondati, ombra navy diffusa, gradient bianco → grigio chiarissimo (#FFFFFF → #F5F7FA → #EDEFF3), noise texture diagonale sottilissima per evitare bianco piatto.
3. **Effetti visivi su entrambi i lati (web)**:
   - **Gold-glow luminoso** pulsante (box-shadow triplo: bordo oro + alone oro + ombra navy) tramite keyframes `bcGoldPulse` iniettato in `<style id=bc-anim-css>`.
   - **Shimmer animato** che scorre sulla superficie con `bcShimmerMove` (3.2s loop).
   - Long-form animation properties (`animationName`, `animationDuration`, etc.) per compatibilità React-Native-Web.

## v1.4 bug fixes (Feb 2026)
- **File**: `/app/frontend/app/business-card.tsx` (783 righe → candidato a refactor futuro).
- **Test**: `testing_agent` iterazione 61 — 7/7 acceptance criteria PASS, download PNG side-by-side verificato end-to-end.

### 🐛 Fix caricamento immagini su Web ("Failed to read the selected media")
- **Root cause**: `expo-image-picker` v17.x su web falliva con "Failed to read the selected media" durante il caricamento immagini dalla libreria.
- **Fix**: Creato wrapper universale `/app/frontend/src/utils/imagePickerCompat.ts` (`launchLibraryUniversal`, `launchCameraUniversal`) che su WEB usa un elemento HTML `<input type=file>` nascosto + `FileReader.readAsDataURL()` (nuovo modulo `/app/frontend/src/web-image-picker.ts`), su native mantiene `expo-image-picker` (import dinamico).
- **File aggiornati (7)**: business-card.tsx, contact/new.tsx, contact/[id].tsx, appointment/new.tsx, master-files.tsx, chat/[id].tsx, my-thing.tsx.
- **Test**: `testing_agent` iterazione 60 — 3 flussi principali verificati end-to-end + 5/5 sanity backend passati. QRScannerModal.tsx non toccato: aveva già un'implementazione web-native separata (`scanFromLibraryWeb`).


## v1.3 nuove funzioni
### Contatto
- Referenza: 3 opzioni distinte
  - Conoscenza personale
  - Referenza diretta personale
  - Referenza da altro contatto (con picker link a contatto)
- **Compleanno**: campo data + alert 0/1/2 giorni prima + messaggio auto custom + link allegato (yearly repeat via expo-notifications)
- **Foto multiple**: 
  - Foto profilo (avatar) → tap sull'avatar
  - Foto aggiuntive → sezione "Foto contatto" con camera / galleria (salvate come note kind="photo")
- **Import dalla rubrica del telefono** (nativo iOS/Android tramite expo-contacts)
- Waze: pulsante sia sull'header sia nella sezione Indirizzo del cliente

### Note contatto (5 tipi)
1. Testo
2. Vocale (registrazione audio)
3. **Foto** (camera / galleria)
4. **Link** (URL + titolo opzionale)

### Appuntamento
- Tipo appuntamento multi-select: Piano Marketing / Energia / Ant / Dare seguito / Demo prodotti (+ custom da settings)
- **Prodotti** con categorie/sotto-categorie: quando "Demo prodotti" è spuntato, appaiono Artistry / Nutrilite / Home (+ custom)
- Durata, promemoria, ricorrenza, partecipanti, valore € (v1.2)

### Calendario
- Vista giornaliera + filtro per categorie: Tutti / Energia / Network / Compleanni
- I compleanni compaiono automaticamente ogni anno nella data del contatto
- **Vista Calendario Team (V38T)**: 3 tab I miei / Team / Tutti
  - Ogni membro vede il proprio workspace/tenant (RBAC standard)
  - Tab "Team": solo appuntamenti di altri collaboratori, con privacy (titolo + orario + nome collaboratore; no contatto/note/luogo)
  - Tab "Tutti": vista aggregata con color-coding per persona + filtri per collaboratore multi-select
  - Sola visualizzazione (no create-on-behalf); eventi altrui in read-only
  - Nuovi endpoint: `GET /api/calendar/team-members`, `GET /api/calendar/team?start&end&area&user_ids`

### Appuntamento
- Auto-link contatto: creando un appuntamento da una scheda contatto (query `?contact_id=X` o `?contactId=X`) il contatto è automaticamente collegato al salvataggio (V38W)
- Collega/Cambia contatto (V38W): nel dettaglio, se manca un contatto collegato, pulsante "Collega contatto" apre modal con ricerca. Selezionato → PUT `/appointments/{id}` con `contact_id` → Email/WhatsApp/SMS si abilitano automaticamente. Se già collegato, banner "Collegato a: X" con pulsante "Cambia".
- `AppointmentUpdate` model ora accetta `contact_id: Optional[str]`.

### Biglietto da visita (V38W redesign)
- Formato rettangolare orizzontale 1.75:1 (340×194)
- Due lati con flip animato su tap (react-native-reanimated + backfaceVisibility)
- **FRONTE**: sfondo navy #1A2A6C con texture di righe diagonali semi-trasparenti, bordo dorato sottile, logo agenzia bianco centrato grande, shimmer leggero
- **RETRO**: sfondo bianco/grigio chiarissimo, nome consulente bold navy centrato, titolo in corsivo blu medio, separatore blu, contatti (telefono/email) centrati, footer con agenzia bold + sito web separati da linea, QR code in basso a destra
- Ombreggiatura esterna su entrambi i lati
- La condivisione immagine cattura il RETRO tramite html2canvas (web) o captureRef (native)
- Toggle manuale Fronte/Retro con pill selector


### Settings / Impostazioni
- Nome app modificabile (backend model)
- Titolo + colore delle 2 aree (già v1)
- custom_appointment_types (backend, UI da esporre)
- custom_product_categories (backend, UI da esporre)

### Bugfix v1.2 (già chiusi)
- Chrome Translate → translate="no" + lang="it"
- DateTime picker duplicato → sostituito con `<input type="datetime-local">` nativo web

## Stack
- Frontend: Expo Router SDK 54, expo-notifications (yearly triggers per compleanno), expo-contacts, expo-audio, expo-image-picker (camera + galleria), expo-document-picker
- Backend: FastAPI + Mongo + JWT + bcrypt + httpx
- Deploy: Emergent Publish oppure Aruba Cloud (`/app/ARUBA_DEPLOY.md`)

## V38Q (June 2026) — 5 Task Msg 595
1. **Master Files - Carica file**: DocumentPicker filtrato per documenti (PDF/Word/Excel/PPT/txt/csv/zip/rtf/json). Il picker foto/video resta su pulsante separato "Foto" con 4 opzioni (camera-photo/camera-video/library-photo/library-video).
2. **Auto-save Master bill drafts**: helper `_auto_save_draft_to_master_files(draft)` chiamato dopo status='done' in `_analyze_draft_task`. Salva `master_files` category='bills' con name='Analisi-{pdf_name}'. Idempotente.
3. **Fix duplicati share analisi**: guard `analysisSavedRef` in `BillsSection.tsx` ora settata PRIMA dell'await (risolve race condition).
4. **SVG chart nei report HTML**: `buildBillAnalysisHtml` intercetta `consumi_mensili_kwh/smc` e li rende come SVG bar chart embedded (usa `renderConsumiSvg` con grid + label + valori sopra le barre).
5. **Master Digital Business Card** (NUOVA FEATURE):
   - Backend: collection `business_cards` (1 doc per tenant), schema `BusinessCardIn` con 15 campi (display_name/title/company/phone/email/website/address/tagline/logo_base64/photo_base64/accent_color/qr_type/qr_content/demo_app_link/social_links).
   - Endpoints: `GET/PUT /api/master/business-card` (auth, upsert con card_id auto-generato) + `GET /api/master/business-card/public/{card_id}` (NO AUTH per QR scan).
   - Frontend: `/app/frontend/app/business-card.tsx` (~300 LOC) con preview live (bordo colorato accent + QR + avatar/logo), form Contenuti/Logo/QR type radio (4 tipi: app/website/text/vcard)/Colore accento (8 swatches), pulsanti "Condividi come immagine" (react-native-view-shot + expo-sharing) e "Condividi link" (Share.share con URL pubblico + Clipboard).
   - Master screen ora ha tile "Biglietto da visita" viola (#7C3AED).
   - Testing: 12/12 backend pytest + Playwright smoke ✅ (iteration 51).

## V38R (June 2026) — FASE 1: Fix critici PDF/UI (Msg 596)
1. **PDF Inline Viewer**: `FileViewer.tsx` ora usa `URL.createObjectURL(Blob)` su web per PDF/HTML (evita dialog Apri/Scarica su file > 2MB). Aggiunto CalculatorFAB dentro il modal (accessibile durante la visualizzazione).
2. **SaveConfirmModal**: Nuovo componente `/app/frontend/src/SaveConfirmModal.tsx`. Prima di salvare una fattura/analisi/report/comparazione, appare modal con nome default `{ContactName} - {Type} - YYYY-MM-DD_HH-MM`. Utente può modificare + cliccare Salva. Sostituisce il vecchio auto-save silenzioso.
3. **Layout responsive** in `BillsSection.tsx` e `BillFieldRenderers.tsx`: `kvVal` usa `flexShrink: 1, flexWrap: "wrap"`, `paramSubBox` ha `overflow: hidden`. Il ConsumptionBarChart rimane in ScrollView horizontal.
4. **Master Files 'Analisi' tab**: Backend `ALLOWED_MASTER_CATS` estesa con `analisi`. `_auto_save_draft_to_master_files` ora salva DUE documenti: (a) raw PDF in `bills` (dimensione originale), (b) HTML analisi generato via `_build_analysis_html` in `analisi` (con banner colorato bill_type + tabella KV + SVG bar chart + note_ai). Frontend aggiunge 5° tab verde con hint "Generate automaticamente dalle bollette".
5. **Data+ora + Universal Share**: `master-files.tsx` mostra `dd/mm/YYYY · HH:MM` invece che solo la data. Ogni item card (esclusi Note) ha pulsante Share (`master-files-share-{id}`) che apre ShareSheet. Anche i contact files mostrano data+ora ora.
6. **Nuovo endpoint backend**: `POST /api/master-files/{file_id}/share-link` (auth) + `GET /api/public/master-files/{token}` (no auth) per condividere qualsiasi file Master via link firmato JWT 24h.

Testing V38R: 12/12 pytest backend + Playwright OK. File toccati: server.py, FileViewer.tsx, SaveConfirmModal.tsx (nuovo), BillsSection.tsx, BillFieldRenderers.tsx, ShareSheet.tsx, master-files.tsx, contact/[id].tsx.

## V38S (June 2026) — 8 UI/UX Improvements (Msg 597)
1. **PDF.js viewer embedded**: `FileViewer.tsx` ora usa PDF.js caricato via CDN (`cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/`) dentro `<iframe srcDoc>` (web) o `<WebView source={{html}}>` (native). Rendering canvas + toolbar Prev/Next/Zoom+-. Non più dialog Apri/Scarica del browser su mobile Chrome/Android.
2. **Calculator bottom sheet**: `CalculatorFAB` maxHeight ridotto da 90% a 62%, drag handle aggiunto in cima, backdrop 50% opacità — così il contenuto dietro (analisi/PDF) rimane visibile.
3. **'I miei audio' rimosso** dal menu tre puntini nel Master screen (era doppione, il tile principale nella griglia rimane).
4. **'Failed to fetch' friendlier**: `api.ts` con try/catch che converte `TypeError: Failed to fetch` / `Network request failed` in "Connessione al server interrotta. Verifica la rete e riprova."
5. **Logo aziendale nei report**: `buildBillAnalysisHtml` ora ha header con logo + agency name. Il logo viene anche automaticamente riutilizzato dal biglietto da visita (GET /master/business-card seed da `user.company_logo_base64`).
6. **Pulsante verde 'Aggiungi Appuntamento'** in `/calendario`: sostituisce FAB rotondo. testID `cal-add-btn`, colore #16A34A.
7. **Pulsante verde 'Aggiungi Telefonata'** in `/home` (Ritelefonate) e `/appointment/[id]` (Programma ritelefonata). testID `add-callback-btn`.
8. **Tipi appuntamento con colori** (SOSTITUISCONO i vecchi):
   - Energy #DC2626, Telefonata #EA580C, Personale #16A34A, Riunione #2563EB, Promemoria #F59E0B, Altro #6B7280
   - Pill con pallino colorato in `/appointment/new`
   - `apptTypeColor()` esportato + usato in `calendario.tsx` (vista giornaliera + settimanale + mensile dots)

Testing V38S: 11/11 pytest backend + code review frontend OK.

## V38T (June 2026) — 3 Neo AI Improvements (Msg 598)
1. **Tavily search integration** — `TAVILY_API_KEY` in backend/.env. `_detect_energy_query()` con word-boundary regex (evita false positive tipo "appuntamento" → "pun"). Keyword: PUN, GME, MGP, GSE, ARERA, delibera, tariffa, oneri, mercato elettrico, TTF, PSV, ecc. `_tavily_search()` con include_domains su ARERA/GME/GSE/Snam/Terna. Frontend: badge "web" + pulsante "💾 Salva nei file Master" (POST /api/assistant/save-to-master → collezione master_files, category=notes, mime text/markdown).
2. **Memoria persistente Neo** — Collezione `neo_memory` MongoDB. Fire-and-forget task `_maybe_save_memory` dopo >=6 messaggi in una sessione: distilla via Claude Haiku 4.5 in JSON `{summary, facts[]}`. `_load_neo_memories(limit=5)` inietta le memorie in "MEMORIA PERSISTENTE" del system prompt. Endpoints:
   - `GET /assistant/memory` — lista
   - `DELETE /assistant/memory/{memory_id}` — cancella singola
   - `DELETE /assistant/memory` — cancella tutte
   Nuova screen `/app/frontend/app/neo-memory.tsx` con link "Memoria di Neo" (viola, sparkles icon) in Impostazioni.
3. **Pausa TTS + Barge-in** — Pulsante `msg-pause-btn` visibile accanto al play icon durante playback (⏸️ rosso). `currentAudioRef` tiene riferimento al HTMLAudioElement per pause/resume. In conversation mode, durante phase='speaking': `startBargeInDetector()` avvia loop RMS VAD — voce sostenuta > 600ms → `stopPlayback()` (equivalente "Neo pausa"). Chiusura modale NON cancella conversazione (comportamento preservato).

Testing V38T: 9/9 pytest backend (dopo fix false-positive) + frontend live-tested con query PUN reale (Tavily ha risposto con 111.58 €/MWh, fonti citate). Salva-in-Master modal + Neo memory screen entrambi funzionanti.

## V38U (June 2026) — 5 tasks (Msg 599)
1. **Web link contatto + Favicon auto** — `InfoRow` accetta `href`, sito web è cliccabile. Nuovo pulsante 🌐 Web azzurro (#0EA5E9) in "Comunica con" (testID `comm-web`). Se contatto ha `website` ma non `avatar_base64`, l'avatar mostra la favicon via `google.com/s2/favicons?domain=<host>&sz=128`.
2. **Verifica agevolazioni fiscali** in bill-quick — sezione verde con:
   - IVA 10% / IVA 22% (radio, non pre-spuntata, luce+gas)
   - Accise gas 0,012498 €/Smc (default ON, solo gas)
   - PCV annullato (default OFF, solo luce)
   Marker: `__verifica_iva__=X`, `__verifica_accise_gas__=Y`, `__verifica_pcv_annullato__=1` in `analysis_params`. Backend `_llm_analyze_bill_text` estrae i marker in `fiscal_directives`, li filtra da `display_params`, e costruisce direttiva LLM per popolare `extracted.fiscal_check = { iva/accise_gas/pcv : {expected, actual, ok, delta_annual_eur} }`. Frontend `FiscalCheckBanner` verde/rosso con totale "Speso in più negli ultimi 12 mesi €X".
3. **Rimozione IVA%** dai DEFAULT_PARAMS in BillsSection (luce + gas).
4. **Fix bug biglietto da visita web** — `pickImage` usa `ImagePicker.launchImageLibraryAsync({base64:true})` su web + FileReader fallback. `shareAsImage` usa `captureRef(result:'data-uri')` con html2canvas + Web Share API + auto-download. Installato `html2canvas@1.4.1`.
5. **Intestazione report esteso** — nuovi campi User: `report_slogan` (max 140) e `report_contacts` (max 240, multiline). Impostazioni ha campi con debounced auto-save. `buildBillAnalysisHtml`, `buildReportHtml`, `slideCover` (comparazione) ora includono: logo + agency_name + slogan (italic corsivo) + contacts (small grey) nell'intestazione.

Testing V38U: 10/10 pytest backend + frontend verificato in Playwright. Files creati/modificati: contact/[id].tsx, bill-quick.tsx, BillsSection.tsx, impostazioni.tsx, business-card.tsx, server.py (ProfileUpdate + User + `_llm_analyze_bill_text` fiscal directives). html2canvas nuova dipendenza.

## V38V (June 2026) — 7 tasks (Msg 600 — rifinitura V38U + bug critici biglietto)
1. **PCV per gas** — `verify_pcv_annullato` disponibile anche per bill_type='gas' (prima solo luce). `FiscalCheckBanner` mostra la riga PCV anche per gas.
2. **Bug findNodeHandle risolto** — `shareAsImage()` in business-card.tsx su web usa SOLO `import('html2canvas')` su div DOM con id='bc-web-preview-root' (rendered solo su web via Platform.OS check). Nessun `captureRef` su web → nessun findNodeHandle.
3. **Public endpoint HTML** — `GET /api/master/business-card/public/{card_id}` ora restituisce HTMLResponse renderizzato server-side con:
   - Intestazione colorata + logo + nome + ruolo + azienda
   - Contatti cliccabili (tel:/mailto:/url)
   - QR code via api.qrserver.com
   - Pulsante 📇 Salva in rubrica (.vcf)
   - Banner mobile "Vuoi salvare i dati nella tua rubrica telefonica?" (localStorage dismiss)
   - Effetti CSS puri: Shimmer / Bordo luminoso / Nessuno
4. **vCard endpoint** — `GET /api/master/business-card/public/{card_id}.vcf` restituisce text/vcard con vCard 3.0 completa.
5. **Impostazioni biglietto**:
   - `link_title` (max_length=200) — titolo personalizzato pagina pubblica
   - `visual_effect` (enum: none/shimmer/border) — validato backend
   - Frontend business-card.tsx: sezione "Pagina pubblica" con Field bc-link-title + sezione "Effetto visivo animato" con 3 radio testID bc-effect-{none|shimmer|border}
6. **Route ordering fix** — `.vcf` route dichiarata PRIMA della route HTML per evitare che FastAPI matchi il card_id includendo l'estensione.

Testing V38V: 22/22 pytest backend (dopo fix max_length) + frontend Playwright OK (bc-share-image no findNodeHandle error). File modificati: server.py (BusinessCardIn + Public endpoint), business-card.tsx (shareAsImage web + hidden DOM mirror + link_title/effect UI), bill-quick.tsx (PCV gas), BillsSection.tsx (FiscalCheckBanner gas).

## V38W (June 2026) — 5 bug fix pagina analisi fattura (Msg 601)
1. **Emoji corrotti nel titolo** — Rimosso `📄` da H1 in `_build_analysis_html` (backend) e `buildBillAnalysisHtml` (frontend). Ora titolo pulito "Analisi Fattura Luce/Gas". Rimosso emoji anche dal SECTION_META header nella live view (era "⚡ Luce", ora "Luce").
2. **Tag `__verifica_*` filtrati** — I marker interni (`__verifica_iva__=10`, `__verifica_pcv_annullato__=1`) sono ora esclusi da `paramsBadges` (frontend) e `params_html` (backend).
3. **Fiscal Check human-readable** — Nuovo helper `_format_fiscal_check_html` (backend) e blocco `fiscalHtml` (frontend). Renderizza fiscal_check come `<li>` verdi/rossi:
   - IVA 10% OK / IVA errata — attesa 10%, trovata 22% + "Extra 12 mesi: € 120"
   - Idem per Accise gas (6 decimali) e PCV (€/mese)
4. **"Note AI" → "Note di {ConsultantName}"** — Helper `_consultant_display(user_doc)` con fallback user.name → company_name → "Consulente". Backend usa `user_doc` fetched da `_auto_save_draft_to_master_files`. Frontend usa `branding.agency_name`.
5. **Intestazione professionale** — `_build_analysis_html` accetta `user_doc` con logo/name/company/slogan/contacts. Header colorato prima di H1 con `<img src=logo>` + nome agenzia + ruolo consulente + slogan italic + contatti small grey. `_auto_save_draft_to_master_files` fetcha il profilo user prima di generare l'HTML.

Testing V38W: 25/25 pytest backend + frontend UI verificata (nessun emoji corrotto, nessun `__verifica_` chip, nessuna "Note AI" residua). File modificati: server.py (`_build_analysis_html`, `_auto_save_draft_to_master_files`, nuovi helper `_consultant_display` + `_format_fiscal_check_html`), BillsSection.tsx (`paramsBadges` filter, `buildBillAnalysisHtml` fiscal + note author + emoji removal, SECTION_META header).
