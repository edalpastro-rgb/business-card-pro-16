# CHANGELOG — AdvisorOS / AxonOS

> ⚠️ **REGOLA PER L'AGENTE**: consultare questo file **prima di ogni modifica**. Tutto ciò che è elencato qui è
> **approvato dall'utente e funzionante**. Non riscrivere, rimuovere o "semplificare" queste funzionalità.
> Ogni nuova modifica va aggiunta in coda alla sezione della propria area E nell'indice cronologico in fondo.
> Dettagli tecnici completi per ogni versione: `/app/memory/PRD.md` (cerca il codice versione, es. `V50.z126`).
>
> Lingua utente: **Italiano**. Test: manuali (screenshot_tool / python / curl) — **NON usare testing_agent** (richiesta utente).
> Bug "nested modal" (modali che si chiudono digitando): richiesta **chiusa dall'utente** (Giu 2026) — non riproporre.

**Stack**: Expo Router SDK 54 (React Native, web + Android APK + iOS) · FastAPI monolite `/app/backend/server.py` (~25k righe) ·
MongoDB · JWT + bcrypt · Emergent LLM Key (Claude Sonnet/Haiku, GPT-5.4-mini, Whisper, TTS) · Tavily · OpenMeteo · OpenCV ·
Emergent Push · Emergent Object Storage · Google Drive / Dropbox OAuth.

**File protetti (NON modificare)**: `metro.config.js`, `package.json` (solo via `yarn expo install`), `.env` (URL/porte),
`EXPO_PACKAGER_PROXY_URL`, `EXPO_PACKAGER_HOSTNAME`, `MONGO_URL`, `EMERGENT_PUSH_KEY`.

---

## 1. Autenticazione, ruoli e multi-tenant
- Login/registrazione JWT + bcrypt, 2FA (codice / backup code), password vault "dati sensibili" con password dedicata (v2.z).
- Ruoli: **Master** (tenant owner) e **Collaboratore**; isolamento dati per `tenant_id`; RBAC su aree, calendario team, file.
- Codice agente / codice cliente; "Promuovi cliente → agente" (v2.ac); Elimina account (v2.ad).
- Landing pubblica advisoros.it (v29.ak, V50.z105/.b con video demo hero), schermata Sicurezza informativa (V50.z106).
- Splash animato di brand (v2.aq), login screen responsive con logo grande (v2.ai), brand identity AdvisorOS + AxonOS (v2.af/ag).
- Onboarding **Tour guidato** al primo avvio, reset per-device (V50.z111, V50.z120); micro-tutorial (V50.o–p).
  **V50.z133**: Home attende `useRootNavigationState().key` + 350ms prima di `router.replace('/libretto?onboarding=1')` (a cold start
  nativo il replace veniva ignorato → tour assente); il flag device `onboarding_done_${user_id}` viene scritto appena il tour è
  mostrato in modalità onboarding (una sola volta per dispositivo, anche uscendo con back/tab bar). Flag server invariato.
  **V50.z136**: intro animata offline `src/WowIntro.tsx` (4 slide: fade/slide/zoom, icone in orbita pulsanti, bolle animate,
  auto-avanzamento 4.2s, "Salta intro"/"Avanti"/"Inizia il tour") mostrata all'inizio del tour (`/libretto?onboarding=1`) — nessun
  video YouTube. Help Center: prima voce **"Rifai il tour guidato"** (V50.z137: bottone pieno viola prominente; reset chiavi locali +
  flag server → riapre intro + tour anche se già completato). **V50.z158**: trigger in `home.tsx` con push/replace alternati + retry su `usePathname` (5×1s); `allowBackup:false` in app.json perché il backup Android ripristinava le chiavi locali su reinstall.
- Credenziali test: `/app/memory/test_credentials.md` (demo@advisoros.it / Demo1234!, collab.demo@advisoros.it).

## 2. Contatti / Anagrafica (CRM)
- Scheda contatto: referenze (conoscenza personale / referenza diretta / da altro contatto, bidirezionali v2.q), compleanno con alert
  0/1/2 gg + messaggio auto + notifica annuale, foto profilo + foto multiple, import da rubrica telefono (expo-contacts).
- Note contatto: testo, vocale, foto, link.
- **Campi personalizzati** (V50.z67/68): required, riordino, mapping in import.
- **Import CSV/Excel** con mapping intelligente (V50.z66); pulsante CSV spostato in posizione richiesta (Giu 2026).
- Indirizzi: Waze + Google Maps sotto ogni indirizzo (V50.z70), indirizzi preferiti ⭐ + distanza da ufficio (V50.z71),
  distanze in batch nella lista (V50.z72), indirizzo strutturato (v2.16).
- Comunicazioni: chiama diretto, script manuale, banner pause/play (v2.32), pacchetto comunicazioni (v2.33), auto-log comunicazioni
  (v2.30), ripristino messaggio WhatsApp negli Script (V50.z69). **Config script telefono/WhatsApp RIMOSSE dalle Impostazioni** (Giu 2026).
- **Scadenze contratti** (v2.ac) — sezione nascosta automaticamente se vuota; pagina `/deadlines` (fix Unmatched Route).
  **V50.z138**: nel banner SCADENZE della Home il chip attivo mostra una × e, toccato, chiude la vista ("Filtro chiuso · tocca un
  intervallo…"); un tap su qualsiasi intervallo la riapre.
  **V50.z153**: ogni card scadenza ha un'icona ⋯ → foglio azioni: *Disattiva avviso* (flag `deadline_dismissed` sulla bolletta,
  sparisce da Home/`/deadlines`/conteggi), *Nuova data scadenza* (`deadline_override.expiry_date`, `source: "manuale"`, riattiva
  l'avviso), *Sostituisci bolletta* (apre `/contact/{id}?tab=bills`; nuova bolletta o rianalisi resettano dismiss/override).
  Componente condiviso `src/DeadlineActionsSheet.tsx` (nessun Pressable backdrop, cfr. V50.z59-fix2).
- Allegati dalle mail collegati al contatto (V50.z25), analisi Axon automatiche per contatto (v2.ah), cronologia cliente.
- Analizza fatture in anagrafica (V50.g) + versione Master con parity (V50.z76).
- **CRM · Aree ridisegnato** (V50.z113–115): gerarchia a 3 livelli **Area › Categoria › Sottocategoria** in `AreasManager.tsx`,
  permessi per area sui collaboratori, picker sottocategorie in scheda contatto e calendario (`area_subcategories`).
- Gestione Clienti AdvisorOS (V50.z104), Modulo Lead + configurazione esigenze (V50.z103/.b), sondaggio qualità post-conversione
  (V50.z101.b), recensioni analytics + auto-follow-up scheduler (V50.z102).

## 3. Appuntamenti e Calendario
- Tipi multi-select (Piano Marketing / Energia / Ant / Dare seguito / Demo prodotti / **Personale** + custom), prodotti con
  categorie, durata, promemoria, ricorrenza, partecipanti, valore €.
- Auto-link contatto da scheda, "Collega/Cambia contatto" nel dettaglio (V38W); **Modifica appuntamento** abilitata; link "Vai al contatto".
  **V50.z138 dettaglio appuntamento**: chip "Esito dell'appuntamento" sempre cliccabili anche con stato "Da svolgere" (registrare un esito
  segna automaticamente l'appuntamento come Fatto e cancella il reminder); chip "Dopo l'appuntamento (dettagli)" robusti a
  `outcome_tags` mancante (causa dei chip bianchi/non reattivi su Android), sfondo grigio visibile, minHeight 40, ripple Android.
- Vista giornaliera, filtri categoria, compleanni annuali, **Calendario Team** (I miei / Team / Tutti, privacy per collaboratori).
  **V50.z152 — Compleanni che si chiudono**: il promemoria compleanno (virtuale, 09:00) sparisce automaticamente 24h dopo
  l'orario e ha un bottone **"Visto ✓"** sulla card che lo chiude subito (id `bday_<contact>_<anno>` in AsyncStorage
  `calendar_birthdays_seen_v1`, per dispositivo). L'anno successivo il compleanno ricompare (id diverso).
- Pallini colorati per tipo + **legenda colori** (Giu 2026). Fix mapping tipo "Personale".
- **Fix orario 08:15→06:15** (V50.z110 lato editor; **V50.z127 root cause backend**: `start_at`/`end_at` letti da Mongo erano datetime naive
  serializzati senza fuso → il client li leggeva come ora locale. Ora `_aware_utc_times()` forza `+00:00` su list/get/put/calendar-team).
- **Condivisione appuntamento col cliente** WhatsApp/Email + reminder automatico (V50.z80), "Invia dettagli" in creazione (v2.14).
  **V50.z135**: `AppointmentShareActions` (usato sia nel modal post-creazione sia nel **dettaglio appuntamento**) ha il testo del
  messaggio **personalizzabile** ("Personalizza messaggio" → TextInput multilinea, "Ripristina"); il modal "Appuntamento creato" ha
  footer fisso con "Chiudi senza inviare" sempre visibile (card maxHeight 88%, safe-area bottom, KeyboardAvoidingView, contenuto in ScrollView).
- **Meteo negli appuntamenti**: icona/tooltip meteo accanto agli eventi in calendario e nel dettaglio con consigli (V50.z117),
  basato sull'indirizzo del contatto (OpenMeteo, `POST /api/weather/appointments`).
- Timer chiamata → barra compatta globale (v2.r), timer in background (v2.ae).

## 4. Home / Dashboard / Master
- Home V27 redesign, header animato/collapsable con immagine locale (V29.aq/ar), home compatta + PUN riorganizzato (V50.z87).
- **Dashboard configurabile** (V50.z81): widget riordinabili; widget PUN Live & Richieste Info (V50.z82); widget Sveglia (V50.z10);
  **Widget Meteo & Allerte** + banner allerte separato + pagina `/meteo` 7 giorni (V50.z79, z116).
  **V50.z132**: il widget Meteo (`WeatherWidget`) è visibile SOLO con allerte attive; le condizioni correnti stanno nella mini-icona
  `HeaderWeatherBadge` (sole/pioggia/neve + °C) in basso a sinistra sul banner AdvisorOS (tap → `/meteo`); il widget
  **V50.z148**: `getWeatherCoords()` ha timeout 6s su `getCurrentPositionAsync` (Accuracy.Low) e 20s sulla richiesta permesso —
  su Android (GPS a freddo / reinstallazione senza last-known) la promise non risolveva e il badge non compariva mai; il badge
  ritenta 1 volta la chiamata `/weather/alerts` dopo 4s se la rete non è pronta al cold start.
  **V50.z150 — Widget "Meteo" nella zona widget Home** (id `meteo` in `DASHBOARD_WIDGET_DEFAULTS`, attivabile/ordinabile da
  `/dashboard-config`): `DashboardWidgetsSection` renderizza `<WeatherWidget alwaysVisible />` → card SEMPRE visibile con
  temperatura **attuale** (`weather.temp`, fallback `temp_max`), "min · max", condizioni, località (stessa fonte `/weather/alerts`
  + `getWeatherCoords` dell'icona header), pill "N allerte" / "Nessuna allerta", tap → `/meteo`. Il `WeatherWidget` senza prop
  mantiene il comportamento z132 (solo con allerte). L'header badge mostra anch'esso la temp attuale.
  **V50.z151 — Geocoding robusto** (`_geocode_one`): Photon → Nominatim → **Open-Meteo Geocoding** (nuovo 3° fallback, stesso
  provider del meteo: candidati = stringa intera, parti dopo virgola, ultime 1-2 parole, singole parole ≥4 char, esclusi civici/CAP/
  sigle provincia → "Via Roma 10, Padova" ⇒ "Padova"); negative-cache ridotta da 24h a 10 min. `/weather/forecast` e `/weather/alerts`
  ritornano `address_error` (l'indirizzo che non è stato risolto) oltre a `needs_address`; `/meteo` mostra "Indirizzo non
  riconosciuto … prova solo città e provincia" + "Correggi indirizzo" + "Riprova"; errore PUT indirizzo ora visibile (Alert).
  "Appuntamenti di oggi" è renderizzato SOTTO la sezione Ritelefonate (`DashboardWidgetsSection` con props `only`/`exclude`).
- Widget sotto "Interfaccia Master" (V50.z120). Banner My Thing con font/size/colore personalizzabili (v2.31). Banner Evento Master
  con range date, descrizione, audio, copertina PDF (v2.10, v2.18, v2.11). **Banner Gas colore BLU** (Giu 2026).
- **Interfaccia Master**: griglia bottoni stile Optima categorizzati per colore con header categorie (V50.z34/40/41), drawer laterale
  6 categorie (V50.z35), avatar menu snellito (V50.z52), Cruscotto Master unificato + notifica proposte (v45), Anagrafica Master &
  Password Vault (V50.z42), Hub Impostazioni (V50.z50). Statistiche biglietto da visita (v2.28).
- **Edge Panel** Samsung-style con shortcut personalizzabili (V50.z15, fix z38). Calcolatrice FAB draggable + ridimensionabile
  (V50.z6, z14). SupportFab (V50.d). Bottone Caselle mail su Home (V50.z25).
- Team Insights / profilo comportamentale collaboratori (v44, v2.aj). Report con intestazione configurabile (v2.17).

## 5. AxonOS — Assistente AI (chat)
- Chat modale via **FAB trascinabile** (V50.z100; fix touch Android hitSlop Giu 2026; **V50.z131** tap gestito da `Pressable` interna +
  PanResponder solo per il drag, guard anti doppio-fire — fix FAB muto in Contatti), header con logo, dropdown modalità
  (testo / voce / entrambi), Nuova chat, Annunci, Audio (v2.ao/ap).
- **Streaming SSE** (`POST /api/assistant/chat/stream`, v40): eventi `progress` / `meta` / `delta` / `done` / `error`; client XHR
  onprogress su nativo, ReadableStream su web (`assistantStream.ts`). Watchdog 90s con errore visibile (V50.z121).
  **V50.z142 — ACK immediato**: il primo evento dello stream è `progress {stage:"ack", text:"Sto ragionando…"}` emesso PRIMA di
  qualsiasi await (intercept slash/quick-action/sveglie, preflight, LLM) → visibile in <1s (misurato 8ms locale, 0.34s via ingress)
  indipendentemente dal modello; il client imposta lo stesso testo localmente all'invio come fallback di rete.
- **Voce in streaming** (V50.z112, `sentenceSpeaker.ts`): frasi sintetizzate e riprodotte man mano; barge-in VAD (v2.u); microfono
  con Whisper `/api/ai/transcribe`; copilot vocale auto (V50.o–p); TTS OpenAI voci selezionabili.
- Router modello Haiku/Sonnet (V50.k), cache semantica tenant-shared (v40, V50.k), cache Tavily 15 min + semantica (V50.z36/37),
  preflight parallelo RAG + Tavily + Teach + GME (V50.z33), Tavily Extract API + cache DB URL (V50.z89/z91).
- **Azioni rapide** personalizzabili (v2.o, pill compatta v2.an, Stop v2.an): cache server-side 7 gg `axon_qa_cache`; intercept
  istantanei "Prossimo appuntamento" / "Clienti senza appuntamento" (V50.z31);
  **V50.z126 — azioni rapide in streaming SSE** (`quick_label`, `cache_only`, heartbeat progress ogni 6s) — fix 60s+ senza output.
- **Slash commands** `/aiuto /bolletta /scadenze /pun /team` (V50.l–n).
- **Comandi Timer/Sveglie/Promemoria in linguaggio naturale** (V50.z125): "imposta timer 15 minuti", "sveglia domani alle 7",
  "ricordami di chiamare Mario stasera", "quali sveglie ho?" → crea in `axon_alarms`, notifica locale schedulata dal client.
- Meteo in chat (città) + fix parser (V50.z32). Intent energia → ricerca web con fonti (V38T).
- **Grafici e tabelle in chat**: parser segmenti, `ChatChartExport` con fullscreen (V50.z109), `ChatTableExport` export PDF/PNG
  (v2.p, v2.t), **Error Boundary** su grafici/tabelle (V50.z121) — mai schermata bianca.
  **V50.z140 — Tabelle a schermo intero + Header tabella**: tap sulla tabella (o bottone "Schermo intero") → Modal fullscreen con
  tutte le righe, scroll verticale+orizzontale, colonne a larghezza adattiva, footer FISSO PDF / Immagine / Chiudi. Header tabella
  (logo + nome azienda) configurato dal Master in Impostazioni → card "AI & Axon · Header tabella" (`table_header_name`,
  `table_header_logo_base64` su `users`, `PUT /auth/profile`); `GET /api/table-header` risolve l'header del tenant (fallback al
  Branding aziendale se vuoto) → mostrato in testa alla tabella in chat, nel fullscreen, nel PDF (expo-print HTML) e nel PNG
  (view-shot nativo / canvas web). Cache client 30s + `invalidateTableBrandHeader()` al salvataggio.
- Allegati: upload file/foto/scanner dalla chat (V50.z85), drag-and-drop desktop (v2.v), processing avanzato allegati (V50.z90),
  anteprima allegati in-app (V50.z24).
- Feedback 👍/👎 self-learning + few-shot dinamico (v41), "Salva come regola" / "Salva nei file Master" a fine risposta (v2.y, V38T),
  regole auto-estratte da chat notturne (v43), memoria persistente Axon riscritta (V50.z51, endpoint `/assistant/memory`).
  **V50.z129 — cattura immediata impegni**: se la risposta di Axon contiene "da ora in avanti / d'ora in poi / da adesso / da questo
  momento + verbo al futuro" la frase viene salvata subito in `ai_teach_rules` (`auto_generated=True`, `source=chat_commitment`,
  dedup su `text_norm`) senza attendere il job notturno delle 04:00 (`_auto_capture_commitment_rules`, hook in chat + chat/stream).
  **V50.z130 — distillazione regole on-demand**: se il messaggio utente ha intento didattico (`_TEACH_INTENT_RE`: ricorda che, impara,
  quando ti chiedo, usa sempre, non usare mai, da ora in poi…) la lezione viene distillata subito da Claude Haiku in una regola
  `ai_teach_rules` (`source=chat_teach`, categoria tra quelle standard, dedup titolo/testo) → persiste dalla risposta successiva.
  Hook unico `_post_reply_learning` (impegni z129 → poi lezione z130). Trigger manuale Master `POST /axon/teach/distill-now {session_id?}`.
  **V50.z143 — "Distilla conversazione in regole"** (Insegna ad Axon › Regole › bottone viola "Distilla chat", solo Master):
  modal `src/DistillConversationModal.tsx` con 2 modalità — **Incolla testo** (chat storica da WhatsApp/email/altro) o **Chat storica**
  (elenco sessioni da `GET /api/assistant/sessions`) → `POST /api/axon/teach/distill-conversation {text?|session_id?, max_rules}` →
  Claude (`_llm_extract_lessons`, JSON `{rules:[{title,category,text}]}`, chunking ~11k×3) → salvate come regole **PINNED**
  (`auto_generated=False`, `source=conversation_distill`, dedup titolo/testo + titoli/testi esistenti nel prompt). Il modal mostra le
  regole create; la lista Regole si ricarica.
- **Insegna ad Axon** (v2.34): regole + file/URL allegati, multi-categoria (v2.n), tab compatti (V50.i), PDF extraction e URL refresh
  (v2.ab), auto-suggest deep-link canonici (V50.z29). Fix ricorrenti: Axon legge i file delle regole (v2.ak, V29.at),
  ricerca PDF GME / tabelle PUN / dual-storage (V50.z26/27/28), validazione prefetch GME (V50.z77).
- **RAG documenti Master** (v42): chunk + retrieval per tenant; **Knowledge Base personale** da pagine WebView con auto-search
  (V50.z92, V50.z100). Axon Drive re-index (V50.z85, V50.z8-9).
  **V50.z155 — Indice Drive usato DAVVERO da Axon**: `_drive_index_roots(tenant)` (cartelle Impostazioni→Drive + link Drive
  "Insegna ad Axon") → `_reindex_drive_files_for_user` (BFS ricorsivo in thread `_drive_walk_and_collect`, testo via
  `_drive_download_text` incl. export Google Docs/Sheets, snapshot in `drive_snapshots` con `folder_path`, stato in
  `drive_index_meta`, lock `_DRIVE_REINDEX_RUNNING`, `_schedule_drive_reindex` fire-and-forget dopo OAuth / add-remove cartella /
  `POST /google-drive/reindex` / indice vuoto). `_fetch_teach_drive_pdfs_for_query` legge SOLO dall'indice (elenco cartelle + file +
  testo dei 4 più pertinenti per keyword/mese/anno). Prompt: sezione "GOOGLE DRIVE — INDICE AUTOMATICO" + regola "hai DUE canali";
  `GET /google-drive/reindex/status` esteso (folders, running, meta). Frontend: card "Indice Axon" in `/google-drive`.
  **V50.z144 — Knowledge Base Axon completa** (`/documenti-axon`, Master): oltre ai PDF ora **voci testuali** FAQ / Dati / Nota
  (`POST /master-docs {kind:"text", category, content}`) e file TXT/MD/CSV; **modifica** (`PUT /master-docs/{id}` — rinomina,
  categoria, contenuto con re-chunk/re-index), dettaglio `GET /master-docs/{id}`, elimina. UI: filtri per categoria, badge, icone
  per tipo, tap/matita → editor (`src/KbEntryEditorModal.tsx`), FAB "Nuova voce" + "Carica file", link "Regole" → Insegna ad Axon.
  Retrieval automatico pre-risposta invariato (token prefilter + embeddings, `_retrieve_master_doc_chunks`), estratti etichettati
  con la categoria per le voci testuali.
  **PINNED riattivate**: `<REGOLE_ASSOLUTE>` ora IN CIMA al system prompt (stream e non-stream) come DIRETTIVE VINCOLANTI: tutte
  le regole manuali del Master (cap 40, 500 char) + 6 auto-generate più rilevanti; wording anti-regressione z53 ("rispondi comunque
  in modo completo"). Gli impegni "da ora farò X" (z129) vengono salvati con `auto_generated=False, pinned=True` → PINNED.
  MEMORIA_PERSISTENTE resta disattivata.
- Semantic cache "istantanea" badge, badge web, "Nuovo aggiornamento: data" su azioni rapide.
- Fix input chat coperto da tastiera Android (V50.z12, V50.z39), input riorganizzato (V50.h).

## 6. Timer, Sveglie, Promemoria (Axon Alarms)
- CRUD `GET/POST/PUT/DELETE /api/axon/alarms` (kind timer | alarm | reminder), suoni custom base64 + preset, volume 0-100,
  vibrazione (V50.z8, V50.z78). Schermata `/axon-alarms` con toggle 12h/24h, TimePicker fix, anteprima suono (V50.z10, z13).
- Notifiche locali via `alarmNotifs.ts` (canale Android `axon-alarms`), tap notifica → apre la schermata; widget Home prossima
  sveglia entro 12h. Bottone "Sveglie" nella griglia Master (V50.z13). Comandi vocali/testuali via chat (V50.z125, vedi §5).

## 7. Scanner documenti e Bollette
- Scanner live `LiveCameraScanner.tsx`: autofocus continuo, rilevamento bordi live, anti-motion blur, scatto automatico con toggle
  Auto/Manuale, auto-crop (V29C/D/E, V29.ar).
- **V50.z134 — Autocrop robusto** (`_detect_document_quad` condiviso da `merge-pdf` e `autocrop-preview`): padding anti-bordo, 7 mappe
  (Canny auto/fisso, Otsu, adaptive, saturazione, regione chiara), convex hull + multi-epsilon, punteggio area×rettangolarità×contrasto
  lati, filtri "intera foto" / "fuori è ancora carta", fallback minAreaRect. Test sintetici 6/6 (IoU 0.83–0.99), nessun falso
  ritaglio su foto senza documento o su foglio che riempie la foto. "Foto singola" → `cameraType: back` (fotocamera posteriore).
- **Multi-pagina** (v2.s, V50.z86) con step di revisione, **ritaglio manuale 4 angoli** `ManualCropEditor.tsx` +
  `POST /api/scanner/autocrop-preview` (OpenCV) (Giu 2026), nome file custom (V50.z88), scanner standalone (V50.z50) e da chat Axon.
- **V50.z194 — Stato visibile durante elaborazioni lunghe + Persistenza dati importati** (moduli isolati, hook minimi).
  **(2) STATO PRIMA**: il server emetteva già eventi SSE `progress` (ack/preflight/cache/thinking) mostrati come testo piccolo nella bolla
  "typing"; dopo `meta` il testo tornava generico ("Neo sta scrivendo…") con bolla assistente vuota per 6-15 s (Sonnet) → percepito come
  silenzio; nessun messaggio contestuale (GME, tabella, PDF). **DOPO**: `src/axonProgress.tsx` (`useAxonProgress`, `progressHint` pura,
  `AxonProgressBubble`): dopo **3 s** senza primo delta compare in chat una bolla intermedia di Axon con frase contestuale — Excel/CSV
  «Sto analizzando la tabella, ci vogliono circa 15 secondi…», PDF «Sto leggendo il PDF…», immagine, PUN/GME/prezzi «Sto cercando i dati su
  GME…», meteo, ricerca web/ARERA, bollette/scadenze, CRM; fase server `thinking` → «Sto scrivendo la risposta…»/«Sto analizzando in
  profondità…», `cache` → testo server; fallback «Elaborazione in corso…» → 10 s «Ci sto lavorando…» → 20 s «Analisi complessa in corso…»;
  mostra «{nome} sta lavorando · N s». Scompare al primo carattere della risposta (`onFirstDelta`) o a fine/errore (`stop`). Hook in
  `AssistantChat.tsx`: `prog.start` in `send()`, `prog.onServer` in onProgress, `prog.onFirstDelta` in onDelta, `prog.stop` in finally;
  render: bolla intermedia al posto della bolla typing quando visibile.
  **(3) STATO PRIMA**: i file caricati in chat venivano letti solo nella conversazione corrente (sezione ALLEGATI nel prompt); nessuna
  memoria dei valori → ricaricare il file ogni volta. **DOPO**: `backend/routes/axon_imported_data.py` (dopo `axon_push_bridge.py`):
  wrapper `_build_attachments_section_advanced` (utente via ContextVar impostata dal wrapper di `_prepare_assistant_prompt`) → se
  l'allegato è PDF/XLSX/XLS/CSV/TXT con ≥ 8 valori numerici crea `axon_import_pending` {status extracting} + task background Claude Haiku
  (`claude-haiku-4-5-20251001`) che estrae {categoria, fonte, descrizione, righe[{etichetta, valore, unita, data}]} (≤150) e aggiunge al
  prompt l'istruzione di chiudere con «**Vuoi che memorizzi questi dati per uso futuro?**». Conferma SENZA LLM (wrapper di
  `_maybe_push_command`, a catena dopo apb): «sì/ok/memorizza/salva…» → upsert in **`axon_imported_data`** {tenant_id (CONDIVISI CON IL
  TEAM), user_id, categoria, fonte, etichetta, valore, unita, data, note} chiave (tenant, categoria, etichetta, data); «no/scarta…» → declined;
  i «sì/no» generici valgono solo se l'ULTIMA risposta di Axon conteneva la domanda (niente falsi positivi); «quali dati hai memorizzato?»
  → riepilogo per categoria. Iniezione in OGNI chat: wrapper `_prepare_assistant_prompt` aggiunge al system message «📦 DATI IMPORTATI
  MEMORIZZATI DAL TEAM» (≤ 6000 caratteri, per categoria/fonte/data). API: `GET /axon/imported-data` (items + categories + pending),
  `POST` (manuale), `PUT/DELETE /{item_id}` (autore o Master), `DELETE ?categoria=` (bulk), `POST /pending/{id}/confirm|decline`.
  Frontend: `src/ImportConfirmChips.tsx` — pulsanti «Sì, memorizza» / «No grazie» sotto l'ultima risposta che contiene la domanda (inviano
  frasi esplicite intercettate dal server); `src/ImportedDataSection.tsx` in `app/axon-memory.tsx` (Profilo → Memoria AxonOS → **Dati
  importati**: categorie espandibili, righe etichetta·data·valore unità, modifica inline valore/unità/data, cancella riga o categoria).
  Mappa app: sezione "Dati importati (Memoria AxonOS)" in `_OMNI_EXTRA_SECTIONS`. Test `backend/tests/test_axon_imported_data.py` ✅
  (upload CSV PUN → domanda; «Sì, memorizza i dati» → 32 valori; nuova chat senza file → «112,9 €/MWh»; lista; «sì» fuori contesto non
  intercettato; PUT/DELETE/POST/bulk; percorso «no»).

- **V50.z193 — Fix notifiche push autonome: bridge persistente AxonOS → Push Service** — nuovo modulo isolato
  `backend/routes/axon_push_bridge.py` (dopo `axon_chat_push.py`, prima di 37) + `src/pushBridge.ts` + `src/PushStatusCard.tsx`.
  **STATO PRIMA**: il server inviava già i push in autonomia (`axon_notify` → `send_push`, scheduler 10 min, promemoria server-side),
  ma (a) `send_push` inghiottiva ogni errore → `push_sent=True` anche senza consegna, nessun log/esito, nessun retry; (b) nessuna
  traccia dello stato del telefono (token registrato? permesso negato? Firebase?); (c) Android: canale `default` creato solo lazy
  in `notifications.ts` (non a livello modulo) → push data-only ad app chiusa a rischio; (d) **causa radice dei "push solo ad app
  aperta"**: manca `google-services.json` + `android.googleServicesFile` in `app.json` → `getDevicePushTokenAsync()` fallisce in
  silenzio → `/register-push` mai chiamato → il push service non ha alcun dispositivo; le notifiche si vedevano solo dall'inbox
  in-app/notifiche locali. In dev `EMERGENT_PUSH_KEY=placeholder` (impostata solo al Publish).
  **STATO DOPO**: (1) wrapper `send_push` per nome nel namespace (stessa firma, stesso `_push_client`): esito reale in `axon_push_log`
  {status sent|not_configured|rejected|failed|queued, http_status, error, attempt, source}, `push_status` truthful sulla notifica in
  `axon_notifications`, **outbox `axon_push_outbox` con retry a backoff 1/2/5/10/30/60 min** (job `apb-outbox-tick` 60s su
  `_axn_scheduler`) su 5xx/429/timeout. (2) `push_devices` {user_id, platform, registered, permission, can_ask_again, token_hint (ultimi 6),
  error, app_env standalone|expo_go|dev, registered_at, last_seen_at, last_delivered_at, **last_failed_at**, last_push_status,
  last_nudge_at} alimentata da `POST /axon/push/device` (client dopo ogni tentativo). (3) `GET /axon/push/status` → `level`
  ok|warn|off + `summary` in linguaggio semplice (mai token/HTTP), `last_test_label` "Test inviato alle HH:MM — Consegnato/Ricevuto/Non
  consegnato"; `GET /axon/push/log`. (4) Test programmato `POST /axon/push/test-scheduled {minutes}` → `axon_push_tests` (arming esatto
  + tick di recupero 60s, riavvio-safe) → `axon_notify` kind axon_message con `data.test_id`; `POST /axon/push/tests/{id}/ack` dal
  telefono (listener received/tap) → "Ricevuto sul telefono ✅". (5) Chat: wrapper di `_maybe_push_command` → «il mio telefono riceve le
  notifiche?» / «mi arrivano le push?» → risposta semplice (`cmd push_diag`); «programma un test push tra 2 minuti» (`push_test_scheduled`);
  i comandi esistenti (manda/avvisami/ricordami…) restano all'originale. (6) Nudge permesso negato: `POST /axon/push/nudge` inserisce
  un messaggio **in chat AxonOS** (non popup) max 1/settimana (throttle client `pushNudgeAt` + server). Frontend: `pushBridge.ts` crea il
  canale Android `default` (MAX) a livello modulo, `syncPushDevice` = `registerForPush` con retry 3× (2s/6s/15s) + cattura errore reale del
  token + report al server; `<PushBridgeSync userId>` nel layout (avvio, foreground ≤1/30 min, ack test); card **"Stato canale push"** in
  Notifiche AxonOS → Preferenze (stato, ultima consegna/problema, esito test, «Test push tra 2 minuti», «Apri impostazioni» se negato,
  «Ricollega»). Test `backend/tests/test_axon_push_bridge.py` ✅ (device report/nudge/diag/no falsi positivi/log/test programmato 2 min
  puntuale/ack). **FATTO (V50.z194b)**: `frontend/google-services.json` fornito dall'utente (Firebase project `advisoros-a406d`, package
  `com.emergent.consulenteapp.zkleir`) + `"googleServicesFile": "./google-services.json"` in `expo.android` di `app.json`. Ora serve
  Publish → nuova build Android: il telefono otterrà il token FCM e i push arriveranno anche ad app chiusa.

- **V50.z192 — BLOCCO 9b: Memoria visibile AxonOS «Cosa sa Axon di me»** — nuovo modulo isolato `backend/routes/axon_memory.py`
  (collection `axon_user_memory` {section, text, source auto|manual, confidence, evidence}; `axon_user_memory_forgotten` = voci cancellate/
  modificate che l'analisi NON ripropone). Analisi = euristiche sui dati reali (clienti più seguiti da appuntamenti+richiamate, anticipo
  pianificazione, telefono vs presenza, giorno più pieno, fascia oraria d'uso, concentrazione fine/inizio mese, titoli ricorrenti, Gym,
  integrazioni: Drive/e-mail/Home Assistant/push/accesso rapido/2FA + volumi CRM, profilo Cervello Axon) + Claude Haiku per preferenze di
  comunicazione e argomenti frequenti in linguaggio semplice (fallback keyword). API `GET/POST/DELETE /axon/memory`, `POST /axon/memory/analyze`,
  `PUT/DELETE /axon/memory/{id}`; DELETE totale cancella anche `axon_brain_profile` e `neo_memory` dell'utente. La memoria visibile è
  iniettata nel contesto Axon (wrap non invasivo di `_build_crm_omniscience_section`, dopo axon_self_learning). Frontend `app/axon-memory.tsx`
  (6 sezioni, ogni voce modificabile/cancellabile, «+» per aggiungere, «Analizza di nuovo», «Cancella tutta la memoria» con conferma,
  testi rassicuranti) + `src/AxonMemoryEntryCard.tsx` in Profilo (tab Impostazioni, in alto), voce in Axon Center e hub Master.
- **V50.z191 — Splash screen e branding: loghi impilati + «Il tuo "Tuttunizzatore"»** — nuovo modulo isolato `src/Tuttunizzatore.tsx`
  (`TuttunizzatoreTagline`: virgolette doppie sempre presenti, "Tutto" arancione Brain+ #F97316, resto bianco/navy; `BrandLogosBlock`:
  logo AdvisorOS → logo AxonOS sotto al 60% → tagline; `tuttunizzatoreHtml()` per il PDF). Applicato a: **splash animato**
  (`AnimatedSplash.tsx`: rimossi "CRM per consulenti e network" e "powered by AxonOS", logo AxonOS 124×32 ≈60%, tagline sotto i loghi;
  stili inutilizzati rimossi), **copertina del Tour/Libretto** (app + PDF: loghi in colonna, AxonOS 60%, tagline), **ultima schermata
  del Tour** (blocco brand su fondo navy in coda alla sezione "chiusura", app + PDF) — riconoscimento per id → vale anche per i libretti
  personalizzati del Master.
- **V50.z190 — Brain+ Branding (claim ufficiale AxonOS)** — nuovo modulo isolato `src/BrainPlus.tsx`: componente `<BrainPlus>` ("AxonOS — Brain+",
  "+" SEMPRE arancione CTA #F97316, ×1.45 e bold; "Brain" bianco su sfondo scuro / navy #1B2B4B su chiaro; tagline opzionale «Il sistema
  operativo che potenzia il tuo cervello.»), `brainPlusHtml()` per l'export PDF, costanti `BRAIN_PLUS_*` e `BRAIN_PLUS_SECTION_IDS`
  (intro, perche-diverso, vantaggio-tempo, chiusura → vale anche per i libretti personalizzati del Master, riconoscimento per id).
  Applicato in: copertina Libretto/Tour (app + PDF), sezioni 1/18/21/chiusura (app + PDF), slide AxonOS del WowIntro (prima presentazione),
  hero della landing pubblica. Testi: sottotitoli/highlight delle 4 sezioni ora accompagnano il nome con il claim ("AxonOS Brain+ — Non
  dimentica nulla, non si stanca mai, conosce la tua vita."), sincronizzati in `axon_app_map.json`. Nessuna occorrenza di "secondo cervello"
  esisteva nel codice (verificato). AxonOS resta il nome del prodotto, Brain+ il claim.
- **V50.z189 — PROMPT 3: Fix + copy + posizionamento Tour Guidato (Libretto)** — `src/libretto/libretto-content.ts` + copia Axon
  `routes/axon_app_map.json`: (1) sezione 11 già "Axon Drive"; ripuliti gli ultimi riferimenti testuali "Voice Copilot / modalità auto"
  (commenti/log in `voice-copilot.tsx`, `_layout.tsx`). (2) FAQ 17 allineata: «AxonOS utilizza dati aggregati anonimi per migliorare il
  servizio, senza raccogliere dati sensibili come nomi, cifre o riferimenti personali». (3) Intro: target ampliato (consulenti commerciali +
  agenzie, aziende, studi professionali, privati). (4) Nuove sezioni 18 «Perché AdvisorOS è diverso», 19 «Per chi è AdvisorOS» (5 bullet
  settoriali + tip «cambia solo il vocabolario…»), 20 «AdvisorOS per la vita privata», 21 «Il vantaggio che cresce nel tempo» — testi
  dell'utente verbatim; aggiunte a `_LIBRETTO_NEW_SECTIONS` così compaiono anche nei libretti personalizzati salvati dal Master.
  (5) Chiusura: headline finale «AdvisorOS non è il CRM più grande. È il CRM più intelligente per chi lavora sul campo. Ogni giorno che lo
  usi, diventa più tuo.» + sottotitolo/paragrafo con il nuovo target. Landing/WowIntro non toccati (fuori scope Tour).
- **V50.z188 — PROMPT 2 Blocco 7: Autoapprendimento anonimizzato di AxonOS** — nuovo modulo isolato `backend/routes/axon_self_learning.py`
  (dopo `auth_quick_unlock.py`). (a) Job in background ogni 10 min (`_axn_scheduler`): ogni sessione chat conclusa (ultimo messaggio >20 min,
  ≥2 messaggi, non ancora in `axon_kb_processed_sessions`) viene pre-anonimizzata via regex (email, telefono, IBAN, POD/PDR, CF, P.IVA,
  importi, date, indirizzi, "Sig. Nome", Nome Cognome, aziende SpA/Srl, numeri) → Claude Haiku estrae max 6 pattern generali
  (faq | topic | gap) in 9 categorie → post-scrub regex + `_asl_scrub_caps` (ogni maiuscola non a inizio frase e non in allowlist → [nome]).
  (b) Collection `axon_knowledge_base` {id, tenant_id, category, kind, insight, frequency, source_sessions, first_seen_at, updated_at,
  enabled, reviewed}; dedupe Jaccard ≥0.6 per categoria → frequency++. (c) Wrap non invasivo di `_build_crm_omniscience_section`: sezione
  "APPRENDIMENTO AXONOS" con max 8 insight (tenant + aggregati cross-tenant con frequency ≥3, solo enabled) scelti per pertinenza col messaggio.
  Dashboard Master `app/axon-insights.tsx` (voce "🎓 Autoapprendimento" in Axon Center): statistiche, filtri categoria/tipo/ricerca,
  revisione ✓, modifica testo (ri-anonimizzato), disattiva (eye-off), elimina, svuota tutto, «Analizza ora» (`POST /axon/kb-insights/run`).
  API: GET/PUT/DELETE `/axon/kb-insights[/{id}]`, GET `/stats`, POST `/run` (solo Master/Admin). Test reale: 25 sessioni → 45 insight, 0 leak
  dopo scrub (caso "TEST_Luca Rossi"/"Rossi SpA" coperto).
- **V50.z187 — PROMPT 1 Batch 5 (punti 4–7)** —
  (4) **Edge Panel (menu slide laterale) per area e colore come il Master**: nuovo `src/edgePanelCategories.tsx` (mappa id/route →
  categoria `MENU_CATEGORIES`, colore del bottone = colore dell'area, `groupEdgeActions` nell'ordine delle aree, `EdgeCategoryHeader`
  = stesso header badge+etichetta+linea del Master; "Utility" per Sveglia/Meteo/Libretto/Profilo). `EdgePanel.tsx`: griglia e checklist
  "Modifica" raggruppate con header; i colori casuali del catalogo non sono più usati.
  (5) **Privacy**: Help Center nuova sezione "Utilizzo dei dati delle conversazioni" (dati aggregati e anonimizzati per migliorare AxonOS,
  nessun dato sensibile: nomi, cifre, telefoni, indirizzi, e-mail rimossi; tenant isolato), rimosso "formazione del chatbot" dai registri;
  Libretto FAQ (Q "Axon usa i miei dati per addestrarsi?") allineata in `libretto-content.ts` e `axon_app_map.json`.
  (6) **Accesso rapido al login** (impronta / Face ID / PIN) — backend isolato `routes/auth_quick_unlock.py` (dispositivo fidato:
  `device_id` + secret 48B in SecureStore, server salva solo SHA-256; `/auth/quick-unlock/enroll|login|devices`, scadenza 180 gg, max 5
  dispositivi, revoca) + frontend `src/quickUnlock/QuickUnlockCard.tsx` (card «Bentornato» in `login.tsx` con Impronta/Face ID e PIN
  locale, proposta di attivazione una volta dopo il primo login, riga Attiva/Disattiva in Sicurezza). `auth.tsx`: `loginWithSession`
  additiva. La 2FA TOTP (Google Authenticator, pyotp) e il blocco app PIN/biometria esistevano già (Sicurezza → /security).
  (7) **Bottom bar safe-area uniforme**: `RootInsetsProbe` (in `_layout`, dentro SafeAreaProvider) misura l'inset bottom alla radice e
  `useNavBarBottomInset`/`useSafeBottom` lo usano come minimo → Tabs nativa e PersistentBottomNav hanno lo stesso padding su tutte le
  pagine (riferimento: Help), anche dove `useSafeAreaInsets().bottom` vale 0 dentro Stack/Tabs.
- **V50.z186 — PROMPT 1 Batch 5: stop vocale, audio in background, tastiera (moduli isolati)** —
  (1) **Stop vocale nativo** `src/voice/useNativeBargeIn.ts`: su Android/iOS mentre Axon parla resta acceso un recorder di servizio con
  metering; voce utente (> −22 dB e > rumore/eco +8 dB per ~450 ms) → pausa IMMEDIATA della voce, poi registra fino al silenzio e trascrive:
  parola di stop («stop», «basta», «fermati», «zitto», «aspetta»…) → stop definitivo; frase nuova (≥3 parole, non eco del TTS) → stop + invio
  come domanda; vuoto/eco (≥60% parole uguali alla frase in riproduzione) → riprende. `SentenceSpeaker` esteso in modo additivo con
  `pause()/resume()/speakingText` (player nativo mantenuto, fallback timer ri-armato). Agganci: `AssistantChat.tsx` (`speakerRef`, hook
  attivo con playingIdx≠null e mic libero) e `voice-copilot.tsx` (Axon Drive: `ttsPlayerRef` + `stopSpeaking`). Il detector web V38T resta.
  (2) **Audio in background** `src/voice/voiceAudioMode.ts` (`ensureVoiceAudioMode`: allowsRecording + allowsBackgroundRecording +
  shouldPlayInBackground + duckOthers; `releaseVoiceAudioMode` alla chiusura chat); `app.json`: plugin `expo-audio` con
  `enableBackgroundRecording: true` (foreground service microfono Android + notifica persistente), `UIBackgroundModes: ["audio"]`,
  permessi FOREGROUND_SERVICE / FOREGROUND_SERVICE_MICROPHONE. Verificato con `expo config --type introspect`. **Richiede nuova build nativa.**
  (3) **Tastiera Android** `src/keyboard/AndroidKeyboardPadding.tsx` (`useAndroidKeyboardHeight` + wrapper): con edge-to-edge
  `softwareKeyboardLayoutMode: resize` non ridimensiona più la finestra → paddingBottom dinamico = altezza tastiera attorno allo `<Stack>`
  in `_layout.tsx` (tutte le schermate) e dentro i Modal full-screen con campi lunghi: `libretto-editor.tsx` (Copertina + Sezione),
  `axon-scripts.tsx` (Incolla + Editor), `event-banners.tsx` (Modifica evento). iOS/web invariati.
  (4) Fix collaterale Axon Drive: `api.post(...)`/`notify.warning|error` non esistevano (TypeError a runtime) → `api(path,{method:"POST",body})`,
  `notify(titolo, msg)`. Voce e barge-in verificabili SOLO su build nativa (APK/IPA), non in Expo Go/web.
- **V50.z185 — Knowledge Base Axon: PDF visibile + campi non coperti dalla tastiera (Android)** — (1) nuovo modulo isolato
  `backend/routes/master_docs_files.py`: il PDF caricato in `POST /master-docs` viene salvato anche su Emergent Object Storage
  (`file_path`/`file_size`, hook `_mdf_store_pdf` in 23); `POST /master-docs/{id}/link` (JWT 12h) → `GET /public/master-doc/{token}[?download=1]`
  (inline/attachment); `GET /master-docs/{id}/text` = testo estratto per pagina dai chunk (sempre disponibile). (2) `src/KbEntryEditorModal.tsx`:
  per i PDF box "File PDF caricato" con **Apri PDF** (web nuova scheda · iOS WebView · Android viewer Google Docs), **Scarica** (cache + share sheet)
  e **Testo estratto** (vista interna al modal, "Torna alla modifica"); PDF caricati PRIMA di questa versione → nessun file originale: avviso +
  testo estratto (ricaricare il PDF per aprirlo). (3) Tastiera Android dentro Modal transparent (pattern V50.z39): listener
  `keyboardDidShow/Hide` → `marginBottom: kbHeight` + maxHeight ridotta sulla card, così Titolo/Contenuto e footer Salva restano visibili.
  Nessun'altra modifica alla pagina `documenti-axon.tsx`.
- **V50.z184 — AxonOS invia push in autonomia dalla chat** — nuovo modulo isolato `backend/routes/axon_chat_push.py`
  (dopo `axon_notifications.py` in `routes/__init__.py::MODULES`). (1) **Consegna server-side di promemoria e timer** creati in chat
  («ricordami domani alle 10 di chiamare Rossi», «timer 15 minuti») o dalla pagina Timer & Sveglie: al `trigger_at` il server invia il push
  (nuovo kind `reminder` in `AXN_KINDS`, deeplink `/axon-alarms`) anche ad app chiusa / telefono cambiato. Precisione: arming esatto
  in-process (`call_later`, wrap non invasivo di `_create_axon_alarm_doc`) + tick di recupero ogni 60s sullo scheduler `_axn_scheduler`;
  claim atomico su `axon_alarms.push_sent_at` → nessun doppione; scaduti da >6h (server fermo) marcati `push_skipped`. Le SVEGLIE (HH:MM)
  restano notifiche locali (DnD/suono). (2) **Comandi chat senza LLM** `_maybe_push_command`, agganciato in `22_axon_alarm_commit_teach.py`
  PRIMA di `_maybe_alarm_command`: «mandami una notifica di prova», «mandami una notifica: testo», Master «manda una notifica a Mario: testo»,
  «avvisami se/quando ho ritelefonate urgenti | scadenze | sessioni gym | crediti» (riattiva la categoria + controllo immediato + esito),
  «quali notifiche push ho attive». (3) Mappa app Axon: sezione "Notifiche push AxonOS" aggiunta a `_OMNI_EXTRA_SECTIONS`.
  Frontend: `src/pushRegister.ts` espone `isPushRegistered()`; `src/alarmNotifs.ts` NON schedula la notifica locale per reminder/timer se il
  token push è registrato (evita doppione, il server consegna); `AxnKind` + icona `alarm` per `reminder`; Libretto sezione notifiche aggiornata.
  Test: `backend/tests/test_axon_chat_push.py` (5 comandi + timer REST 5s + promemoria chat 2 min consegnati, 0 doppioni) ✅.
- **V50.z183 — Motto "il CRM che si evolve con te" in stile evoluzione** — nuovo `src/EvolutionMotto.tsx` (lettere su baseline
  comune, ogni lettera più grande e più alta della precedente, colore grigio→blu vivido, blocco finale "con te" grande/staccato/arancio con
  bagliore; auto-fit alla larghezza; prop `dark`). Inserito nella copertina del Libretto (`app/libretto.tsx`, variante dark, sotto i loghi)
  e nella landing `/landing` al posto della scritta testuale. Approvato dall'utente su anteprima. Nessun'altra modifica.
- **V50.z182 — Libretto Informativo + Presentazione 2.0 (posizionamento di eccellenza)** — `src/libretto/libretto-content.ts`,
  `app/libretto.tsx`, `app/adv-landing.tsx` (solo testi/UI). Nuovi campi `highlight` (blocco scuro, testo grande) e `bullets[]` (lista con
  icona grande) resi in app e nel PDF. Intro → headline "Il primo CRM dove l'intelligenza artificiale vive dentro i tuoi dati. Non ti chiede
  niente. Sa già tutto."; **8 · AxonOS** riscritto ("L'AI che conosce la tua azienda meglio di chiunque altro" + 6 bullet); **Corporate Gym**
  riscritto ("La palestra vocale per il tuo team di vendita") e SPOSTATO subito dopo AxonOS (icone Gym Obiezioni/WIN-WIN); **11 · Axon Drive**
  riscritto ("Il tuo copilota vocale in macchina"); nuova sezione **"AxonOS ti trova lui"** (notifiche push, 4 bullet) dopo Axon Drive;
  nuova **Chiusura** "AdvisorOS 2.0 non è un CRM con un chatbot…" in coda. `withCorporateGymSection()` ora integra tutte le sezioni 2.0
  mancanti nei libretti personalizzati (Gym dopo AxonOS, Push dopo Axon Drive, Chiusura in coda). Badge già dinamico (V50.z179).
  Landing `/adv-landing`: hero/slogan/finalCta/footer riscritti + 4 gruppi funzioni in testa (AxonOS, Corporate Gym, Axon Drive, Push).
  `axon_app_map.json` rigenerato (21 sezioni) → Axon conosce il nuovo posizionamento.
- **V50.z181 — Notifiche push native AxonOS** — modulo isolato `backend/routes/axon_notifications.py` (scheduler proprio ogni 10 min,
  riusa `send_push` Emergent di 05, `cgym_weekly_report`, `_bill_deadline_entry`). Collection `axon_notifications` (per destinatario,
  dedupe_key idempotente) + `axon_notification_prefs`. Casi: **cgym_due** (sessione obbligatoria entro 24h / scaduta ≤12h),
  **callback_urgent** (priorità alta/urgente entro 60 min / scaduta ≤6h), **credits** (richieste AxonOS del mese vs piano — default 1000,
  modificabile dal Master — al 50/80/100%, una volta per soglia/mese), **weekly_report** (lunedì ≥08:00 Europe/Rome: genera/recupera il report
  Gym e avvisa il Master), **axon_message** (autonomi: scadenze contratto da bollette ≤3gg o scadute ≤7gg → al consulente del contatto; +
  `POST /axon-notifications/send` per invii programmatici/Master; `POST /test`). Visibilità: collaboratore solo le sue; Master riceve copia
  "[Team · Nome]" (disattivabile). Push payload: title/message/deeplink/**badge** (n. non lette) — il tap usa il deeplink già gestito in
  `_layout`. API: `GET /axon-notifications[?unread_only]`, `/unread-count`, `POST /{id}/read`, `/read-all`, `DELETE /{id}`, `GET/PUT /prefs`,
  `POST /run-checks` (Master, test). Frontend: `app/axon-notifications.tsx` (lista + Preferenze: interruttore generale, per tipo, Master:
  copie team + piano crediti, "Invia notifica di prova"), `src/axonNotifications.ts` (API + `useAxnUnread`: poll 60s/foreground/push →
  `setBadgeCountAsync`), `src/AxnDrawerBadge.tsx` (badge rosso nel drawer + `AxnBadgeSync` nel layout), voce drawer "Notifiche Axon",
  link in Impostazioni → AI & Axon. Test `backend/tests/test_axon_notifications.py` (7 blocchi) ✅ + check cgym/callback simulati ✅.
  NOTA: push nativo attivo solo nella build pubblicata (EMERGENT_PUSH_KEY impostata dal deploy; in dev = placeholder → solo in-app).
- **V50.z180 — Axon vede TUTTA l'app ("accesso a ogni riga")** — nuovo modulo isolato `backend/routes/axon_crm_omniscience.py`
  + `axon_app_map.json` (generato dal Libretto), agganciato in `21_axon_streaming.py` (stream e non-stream: `_safe_omni` nel gather,
  sezione `{omni_section}` dopo SNAPSHOT_CRM, regole di sistema aggiornate: "hai accesso a tutte le sezioni, non dire mai 'non ho accesso'").
  Prima Axon riceveva solo uno snapshot ristretto (15 contatti recenti, appuntamenti 7gg, richiamate, contratti 30gg). Ora il prompt include:
  **MAPPA DELL'APP** (tutte le sezioni con percorso e cosa fanno — Libretto + menu), **DATI COMPLETI CRM** (contatti: totale, per stato/area/
  città, elenco compatto fino a 250; appuntamenti −30/+60gg con esiti/contratti; ritelefonate aperte; telefonate oggi/7/30gg + esiti + ultime 20;
  contratti con stato/importi; scadenze da bollette; bollette; note recenti; gruppi; team con KPI per membro (Master/Admin); Corporate Gym
  sessioni/punteggi/report/manuali; My Thing; audio; biglietto (visite/lead/recensioni); caselle mail; Master Files; documenti e offerte azienda;
  documenti RAG; KB; regole insegnate; link; sveglie; chat; Drive; inviti; impostazioni tenant) e **SCHEDE COMPLETE DEI CONTATTI CITATI**
  (ricerca per nome/azienda/email/telefono/codice/città/tag sulle parole del messaggio → fino a 3 dossier: tutti i campi, note embedded +
  contact_notes, file, appuntamenti, ritelefonate, telefonate, contratti, bollette con scadenza, profilo Axon, analisi Axon, gruppi, segnalato da).
  Visibilità rispettata (tenant + `contact_visibility_filter` + ownership per i collaboratori). Budget 32k caratteri con troncamento progressivo;
  costruzione ~0.03s. Verificato: Master/collaboratore, stream e non-stream (domande su contatti, team, Gym, sezioni app).
- **V50.z179 — Libretto: badge versione dinamico** (`src/libretto/appVersion.ts`, `app/libretto.tsx`, `app.json`). Badge da
  "1.0 · Giugno 2026" → "**2.0 · Settembre 2026**" e reso automatico: versione = `Application.nativeApplicationVersion` (build installata;
  fallback `Constants.expoConfig.version` su web/Expo Go, "x.y.0" mostrata come "x.y"), data = `getLastUpdateTimeAsync()` su Android /
  `getInstallationTimeAsync()` su iOS (mese/anno in italiano; su web fallback alla data in `LIBRETTO_META.version`). Il badge dinamico
  prevale anche sul libretto personalizzato dal Master e finisce nella copertina del PDF. `app.json` version 1.0.16 → **2.0.0**
  (versionCode gestito dalla pipeline di build). Nota: cambio di `app.json` richiede cache Metro pulita in dev (`.metro-cache`).
- **V50.z178 — Tour guidato: step Corporate Gym** (`src/libretto/libretto-content.ts`, `app/libretto.tsx`; step esistenti INTATTI).
  Nuova sezione `corporate-gym` ("Corporate Gym — Formazione vocale per il tuo team", testo fornito dall'utente) inserita dopo il blocco
  AxonOS/funzioni e PRIMA della chiusura (16 · Consigli, 17 · FAQ). Immagine = banner Corporate Gym bundled
  (`assets/images/libretto/11_cgym_banner.jpg`, nuovo campo `image_wide` → resa orizzontale) + due icone sezione con etichetta
  (`cgym_obiezioni.png` "Gym Obiezioni", `cgym_winwin.png` "Gym WIN-WIN"; nuovo campo opzionale `icons[]` in `LibrettoSection`).
  `withCorporateGymSection()` aggiunge lo step anche ai libretti personalizzati salvati dal Master (`/libretto/content`) se manca.
- **V50.z177 — Axon Drive (ex "Copilot Vocale · Modalità Auto")** — rinominato ovunque (drawer "Axon Drive" + icona auto a fianco,
  header pagina con icona auto, azione rapida Home, Libretto/tour, wake-word). Pagina `app/voice-copilot.tsx` ridisegnata SOLO UI
  (logica registrazione/trascrizione/execute/TTS invariata): sfondo interno auto notturno (`assets/images/axon-drive-bg.jpg`, generato con
  Nano Banana) + gradiente, grande volante centrale (MaterialCommunityIcons `steering`), titolo "Parla con Axon mentre guidi", stato colorato,
  esempi in primo piano con icona e testo grande (🧑 Crea un contatto · 📝 Aggiungi una nota · 📞 Programma una richiamata · 💬 Chiedi qualcosa
  ad Axon), microfono centrale 140px con bordo/glow. Route `/voice-copilot` invariata (link esistenti funzionano).
- **V50.z176 — Scanner: rilevamento bordi robusto agli oggetti sul tavolo** (`backend/routes/26_scanner.py::_detect_document_quad`,
  nessun altro file). Bug APK 1.0.55: dalla 2ª foto il foglio, circondato da telefono/penne/altri fogli, non veniva ritagliato (l'algoritmo
  premiava l'area → sceglieva l'inviluppo foglio+oggetti o il quasi-intero-frame). Ora ogni candidato riceve un punteggio di
  "somiglianza a un documento" INDIPENDENTE dall'area — `fill` (interno uniforme dopo chiusura morfologica che cancella il testo),
  `edge_support` (quota del perimetro su bordi reali), gradino di luminanza dentro/fuori sui lati (scarta tabelle/blocchi dentro al foglio,
  robusto alle ombre), rettangolarità ≥ 0.80, aspetto ≤ 3:1, ≥ 3 lati sul bordo foto = frame → scartato — e solo poi il più grande vince.
  Candidati extra: segmentazione "carta" (chiaro + poco saturo) e **separazione dei fogli che si toccano** (erosione → componenti →
  ri-dilatazione: la pagina già scansionata appoggiata accanto alla successiva non "fonde" più il rettangolo). Kernel scalati per i frame
  live 400px. Stateless (nessuna memoria tra scatti; il reset lato app c'è già da V50.z166). Se fallisce → `detected=false`, foto
  originale + badge "Bordi non rilevati" (flusso non bloccato, come prima). Benchmark sintetico `backend/tests/scanner_bench.py`
  (documento + 3-7 oggetti attorno, ombre, tavoli colorati): 53/60 → 59/60 (IoU ≥ 0,85), fogli adiacenti 21/25 → 25/25, foglio su tavolo
  chiaro/che tocca il bordo/intero frame invariati; detector 94 ms a 1200×1600, 28 ms su frame live.
- **V50.z166 — Scanner: autocrop indipendente per ogni scatto + suono regolabile** (`LiveCameraScanner.tsx`, nessun altro file):
  (1) **mutex fotocamera** `runExclusiveCapture`: campionamento live e scatto vero non chiamano mai `takePictureAsync` in parallelo
  (su Android il 2° scatto poteva ricevere il frame 0.1 del campionamento o restare appeso → autocrop "a intermittenza" dalla 2ª foto);
  `shotPendingRef` ferma il campionamento appena l'utente tocca lo scatto; timeout 6s (sample) / 20s (scatto) → nulla resta bloccato;
  (2) **reset rilevamento a ogni scatto** (`resetDetection`): i corner EMA della pagina precedente non "trascinano" più il frame verde;
  il loop riparte pulito; (3) **campionamento in pausa mentre un autocrop è in corso** (`processingCount > 0`, badge "Ritaglio pagina in
  corso… attendi") → tutta la banda alla richiesta principale; (4) **autocrop per pagina con AbortController**: 3 tentativi, backoff
  1,2/2,4s, timeout 45s ciascuno; su fallimento rete la pagina è marcata `autocrop_failed` e il badge in anteprima diventa "Ritaglio non
  riuscito (rete) · tocca per riprovare" (riesegue solo quella pagina); (5) **suono di scatto** a 3 stati persistiti (`scanner_shutter_sound_v1`):
  🔉 Basso (default, click `assets/sounds/shutter-soft.wav` via expo-audio vol. 0.3, `shutterSound:false` Android), 🔇 Muto, 🔊 Sistema
  (`shutterSound:true`). Su iOS il suono di sistema non è disattivabile via API (policy Apple). Flusso multi-pagina confermato: dopo
  "Usa questa" si resta nello scanner (3 scatti consecutivi in test web, ognuno processato indipendentemente).
- **V50.z139 — Foto singola = fotocamera in-app + permessi robusti**: "Foto singola" NON usa più `ImagePicker.launchCameraAsync`
  (nessun autofocus, nessun crop, loop permessi) ma `LiveCameraScanner` in modalità `singleShot` (autofocus continuo, rilevamento
  bordi live, autocrop via `/scanner/autocrop-preview` PRIMA di restituire la pagina; "Usa questa" attende il ritaglio, poi chiude e
  aggiunge 1 pagina già ritagliata → `already_cropped` al merge-pdf, niente doppio ritaglio). Permessi expo-camera: `getPermission`
  rilettura SEMPRE all'apertura (stato hook stale), richiesta solo se necessaria e con timeout 12s + rilettura (bug Android 16 /
  patch 2025-09: `requestPermission` non risolve se già concesso → schermata "Serve l'accesso" infinita), rilettura al ritorno in
  foreground, link "Ho già concesso il permesso · ricontrolla", "Apri impostazioni" se `canAskAgain=false`. Anteprima post-scatto a
  schermo intero (prima era confinata nella barra inferiore). Autocrop asincrono aggiorna la pagina per `id` (non per indice).
- Analisi bolletta (cliente + Master allineati, v2.8), CTE comparativa multi-bolletta + report (v2.12), Fiscal Check con JSON
  parsing robusto (v1.9), auto-save bozze nei file Master (V38Q), 5 bug fix pagina analisi fattura (V38W).

## 7b. Corporate Gym (modulo isolato — Blocco 1, Giu 2026, V50.z168)
- **Backend** `routes/corporate_gym.py` (caricato PRIMA di `37_app_startup_scheduler.py` in `routes/__init__.py::MODULES`),
  collection `cgym_sessions` (session_id, tenant_id, user_id assegnatario, assigned_by, type obiezioni|winwin, title, scheduled_at,
  status assegnata|in_corso|completata, mandatory, score, created_at/completed_at). Endpoint: `GET/POST /api/cgym/sessions`
  (scope=mine|team; team solo Titolare/Admin; assegnare ad altri solo Titolare/Admin, membri del tenant), `PATCH/DELETE
  /api/cgym/sessions/{id}`, `GET /api/cgym/summary` (due_soon 7gg, today_total/today_done Europe/Rome, mandatory_pending, overdue),
  `GET /api/cgym/team-overview` (Titolare/Admin). Widget `cgym` aggiunto a `DASHBOARD_WIDGET_DEFAULTS`.
- **Frontend** `app/corporate-gym/{index,obiezioni,win-win}.tsx` + `src/corporate-gym/{api,CgymHeaderBanner,CgymSubsection,CgymWidget,CgymAlertStrip}`.
  Index: banner header (immagine fornita dall'utente via URL), tile Gym Obiezioni / Gym WIN-WIN (placeholder "Allenamento
  interattivo in arrivo" + conteggi), "Le mie sessioni" (Da fare/Completate; inizia/completa/riapri/elimina), sheet "Nuova
  sessione" (tipo, giorno, ora, titolo, obbligatoria, assegnatario per Titolare/Admin da `/team/members`), "Quadro team" (Titolare/Admin).
- **Blocco 2 — Role-play vocale Obiezione TEMPO (V50.z170)**: backend (stesso `corporate_gym.py`, collection `cgym_roleplays`):
  `POST /api/cgym/roleplay/start` (persona "Marco Bianchi" officina, battuta di apertura LLM claude-haiku-4-5 + TTS via funzione interna
  `assistant_tts`, voce onyx), `POST /api/cgym/roleplay/{id}/turn` (audio → STT interno `ai_transcribe`, oppure `text`; risposta cliente
  JSON {reply, mood chiuso|scettico|aperto|convinto, end}; max 5 turni), `POST /api/cgym/roleplay/{id}/finish` (valutazione claude-sonnet-5:
  score 0-100, summary, what_worked, to_improve, best_line, suggested_answer; salva in cgym_sessions: sessione collegata → completata+score,
  altrimenti nuova sessione "Role-play Obiezione TEMPO"; idempotente), `GET /api/cgym/roleplay/{id}`. AxonOS NON modificato (solo chiamate interne).
  Frontend `app/corporate-gym/roleplay.tsx` (intro con permesso microfono contestuale + fallback "Rispondo scrivendo" + Apri impostazioni;
  live con bolle, mood cliente, mic tap-to-talk max 60s, stato; risultati con score ring/feedback/risposta ideale; Rifai / Torna al Gym),
  `src/corporate-gym/voice.ts` (MediaRecorder web / expo-audio native, playback con fine via playbackStatusUpdate). Entry: card in
  Gym Obiezioni (`cgym-sub-start-roleplay`) e bottone mic sulle sessioni di tipo obiezioni (`cgym-start-<id>` → roleplay?session_id=).
  Controlli tenuti sopra la PersistentBottomNav e a sinistra della colonna FAB (calcolatrice/AxonOS). Test backend 15/15 (`tests/test_cgym_v2_roleplay.py`).
- **Blocco 3 — Assegnazioni Master (V50.z171)**: backend collection `cgym_assignments`: `POST /api/cgym/assignments` (Titolare/Admin;
  target team|users, type, per_day 1/2/3 → slot 09 / 09-15 / 09-13-17 Europe/Rome, due_date YYYY-MM-DD inclusa, title; genera sessioni
  obbligatorie con `assignment_id` per ogni collaboratore/giorno/slot, max 300), `GET /api/cgym/assignments` (avanzamento totale e per
  collaboratore, flag overdue), `DELETE /api/cgym/assignments/{id}` (rimuove piano + sessioni NON completate). `GET /cgym/summary` esteso con
  `assigned_total/assigned_done/assigned_pending` (sessioni con assigned_by ≠ me). Frontend `app/corporate-gym/assign.tsx` (chip destinatari
  "Tutto il team"/singoli, tipo con icone ufficiali, frequenza, scadenza rapida o GG/MM/AAAA, anteprima "N × giorni × freq = sessioni",
  lista piani con barra avanzamento, dettaglio per collaboratore, elimina); pulsante "Assegna sessioni al team" nella card Quadro team
  (`cgym-assign-open`). Collaboratori: widget Home riga "Assegnate dal Master: done/total" + barra; drawer voce Corporate Gym con badge
  "done/total" (`CgymDrawerBadge`, `DrawerItem.badge` opzionale in `DrawerMenu.tsx`); striscia arancione attiva anche con sessioni
  assegnate non completate (`max(mandatory_pending, assigned_pending)`); nelle righe sessione etichetta "· dal Master".
- **Blocco 4 — Dashboard statistiche Master (V50.z172)**: backend `GET /api/cgym/stats?days=7|30|90` (Titolare/Admin; aggrega cgym_sessions +
  cgym_roleplays: per agente completate/assegnate/in ritardo, media-ultimo-migliore score, trend (terzo finale vs iniziale), timeline score,
  tasso completamento, tasso "cliente convinto", forze/debolezze classificate su 5 criteri — ascolto, riformulazione, valore, chiusura, tono —
  dai feedback dei role-play; team: KPI, media per settimana ISO, forze/lacune, classifica). AxonOS (claude-sonnet-5, cache in `cgym_ai_reports`):
  `POST/GET /api/cgym/stats/agent-feedback/{agent_id}` (carattere, dove migliorare, azioni correttive, punti di forza, incoraggiamento, focus;
  cache 24h, `force=true` rigenera; l'agente può leggere il proprio via GET) e `POST/GET /api/cgym/stats/weekly-report` (headline, lacune team,
  highlights, agenti da seguire, nuovi scenari proposti, aggiornamenti manuale vendite, piano prossima settimana; cache per settimana ISO).
  Frontend `app/corporate-gym/stats.tsx` (solo Master): range 7/30/90, KPI, LineChart score nel tempo (team per settimana o agente selezionato),
  BarChart confronto agenti, forze/lacune team, card Report settimanale (Genera/Rigenera), card per agente (rank, media, trend, tag forze/debolezze,
  Feedback personale AxonOS Genera/Rigenera). Entry: bottone "Statistiche" nella card Quadro team (`cgym-stats-open`). Grafici: react-native-chart-kit (già in uso).
- **Blocco 5 — Obiezioni COSTO e DECISORE + Gym WIN-WIN (V50.z173)**: `CGYM_SCENARIOS` esteso (tempo, costo, decisore → area obiezioni,
  5 turni, ~5 min; winwin → area winwin, 30 turni, 45 min). Persone: Giuseppe Ferraro bar-pasticceria (COSTO: prezzo vs costo totale, niente
  sconti regalati), Laura Conti studio dentistico (DECISORE: rispetto del ruolo, processo decisionale, incontro a tre), Elena Rossi direttrice
  acquisti PMI 3 supermercati (WIN-WIN: trattativa integrata su prezzo/durata/pagamento/servizi/green con interessi nascosti; regole a 5 fasi
  temporizzate, concessioni solo in scambio, fine solo con accordo su prezzo+durata+pagamento o allo scadere dei 45 min). Prompt turno generico
  (`{rules}`, canale telefonata/videocall, 2 o 4 frasi) e valutazione con `eval_criteria` per scenario (WIN-WIN: esplorazione interessi, creazione
  valore, gestione concessioni, equilibrio/relazione, chiusura e tempo). Nuovo `GET /api/cgym/roleplay/scenarios`; `start` accetta
  `scenario` tempo|costo|decisore|winwin e restituisce area/duration_min/started_at; `turn` restituisce `phase` (WIN-WIN); `finish` salva la
  sessione con `type` = area. Frontend: `CGYM_SCENARIO_META` (label, cliente, descrizione, tips, durata), `roleplay.tsx` parametrico
  (`?scenario=`; intro per scenario; per WIN-WIN timer 45:00 conto alla rovescia + fase nella barra live, bolle con nome cliente); sottosezioni:
  Gym Obiezioni con 3 card TEMPO/COSTO/DECISORE, Gym WIN-WIN con card "Trattativa WIN-WIN · 45 min" (placeholder rimosso); pulsante mic sulle
  sessioni (obiezioni→tempo, winwin→winwin). Report settimanale elenca gli scenari disponibili dinamicamente.
- **V50.z174 fix**: `CgymTileIcon` (`fill`, contain, centrata), `CgymHeaderBanner` (ratio reale, contain, mai tagliato), `CgymWidget` ritorna null senza sessioni attive/in scadenza/assegnate; `CgymMyFeedbackCard` (feedback personale AxonOS per il collaboratore, Genera/Aggiorna; `POST /cgym/stats/agent-feedback/{me}` consentito al collaboratore per sé).
- **V50.z175 Manuali Google Drive (AxonOS gestore manuali)** — modulo isolato `backend/routes/corporate_gym_manuals.py`
  (collection `cgym_manuals_config`), `src/corporate-gym/manualsApi.ts`, `src/corporate-gym/CgymManualButton.tsx`,
  `app/corporate-gym/manuals-config.tsx`. Il **Master** (solo `is_owner`) configura UNA volta la cartella Drive principale
  "Corporate Gym"; le sottocartelle **Obiezioni** / **WIN-WIN** sono riconosciute per nome (obiezioni/obbiezioni, win-win/winwin/win win)
  e ri-risolte automaticamente se create dopo. Tutti i membri del tenant leggono i manuali con le **credenziali Drive del Master**
  (`_gd_get_credentials(tenant_id)`): non serve Drive personale. Bottone **"Leggi Manuale"** in Gym Obiezioni / Gym WIN-WIN → sheet
  AxonOS con elenco PDF (+ Google Docs/Slides esportati in PDF) letto LIVE da Drive, ricerca per nome, **Apri** (web: nuova scheda;
  iOS: WebView; Android: WebView + viewer Google Docs) e **Scarica** (nativo: cache + share sheet). Link firmato JWT `kind=cgym_manual`
  12h servito da `GET /public/cgym-manual/{token}` (legge da Drive ad ogni richiesta → sempre l'ultima versione, `Cache-Control: no-store`,
  max 40MB; `?download=1` → attachment). API: `GET/PUT/DELETE /cgym/manuals/config`, `GET /cgym/manuals/{obiezioni|winwin}?q=`,
  `POST /cgym/manuals/{type}/files/{file_id}/link`. Il link è consentito solo per file dentro root/sottocartella (403 altrimenti).
  Entry Master in Gym home: "Manuali · cartella Google Drive" (viola AxonOS). Test: `backend/tests/test_cgym_manuals.py` (Drive simulato).
- **Punti di aggancio (1 riga ciascuno)**: bottone "Corporate Gym" in `master.tsx` (categoria Team #EAB308), voce drawer
  `DrawerMenu.tsx` (team), `DashboardWidgetsSection.tsx` (`w.id === "cgym"`), `dashboard-config.tsx` reset list,
  `home.tsx` `<CgymAlertStrip/>` sotto `HomeTipsBanner`.
- **Striscia arancione** (`CgymAlertStrip`): sottile (26px), visibile SOLO con sessioni obbligatorie non completate; tap → /corporate-gym;
  X la nasconde per la sessione app (riappare se il numero cambia); sparisce da sola al completamento (ricarica su focus Home).
- Test: pytest 21/21 (`backend/tests/test_cgym_v1.py`), UI verificata (strip show/X/auto-hide, widget progress, team overview).

## 8. File, Drive e Mail
- I miei file / Master Files: upload con formati unificati e validazione (v2.20), share nativo (v2.6), report inline (v2.4).
- **Google Drive OAuth** (v2.w): redirect_uri hardening, PKCE code verifier fix (V29.as/aw), scope allargato (V50.h), fix ricorsione
  (V50.z12), **fix redirect deep link `frontend://` su APK Android** (V50.z110). Dropbox OAuth + callback backend (V50.e/f).
  **V50.z154**: ritorno automatico nell'app dalla pagina di callback (Google + Dropbox): `src/utils/oauthReturn.ts` →
  `buildOAuthReturn(path, provider)` invia `{return_url, android_package, platform}` a `/oauth/start` (salvati nello state e nella
  connessione Drive `app_return`); helper backend `_oauth_return_links` + `_oauth_return_page_html` generano deep-link e
  `intent://` Android (bottone "Apri AdvisorOS" + auto-redirect). Il vecchio rilevamento UA `"android;"` non matchava mai gli
  Android reali ("Android 14;") → veniva usato il link web HTTPS e l'utente restava nel browser.
  **V50.z128 `_gd_get_credentials`**: cache in-memory access token (`_GD_TOKEN_CACHE`, invalidata su riconnessione), refresh con
  3 tentativi/backoff su errori transitori (→ 503, connessione conservata), connessione rimossa SOLO su `invalid_grant` confermato (→ 401).
- Caselle mail: Auto-CRM scheduler configurabile che aggancia mail ai contatti, estrae firme via LLM e propone aggiornamenti
  (V50.z24), allegati mail su contatto (V50.z25).
- Emergent Object Storage per immagini/file.

## 9. Navigazione Web interna
- `InAppWebViewer` + route `(tabs)/webviewer` con tab bar visibile, helper `openInAppLink()` (V50.z107), migrazione link legacy
  (V50.z108), fallback "Sito non accessibile in modalità interna" → browser esterno. My Web con link modificabili (V50.z73/74).
- Estrazione contenuti pagina + salvataggio target/KB (V50.z92).

## 10. Comunicazioni Master ↔ Cliente
- Richieste Info con thread chat, notifica Master via Axon, cronologia cliente (V50.z83); **Push Notifications Emergent** + allegati
  chat (V50.z84) — funzionano solo su build nativa con `google-services.json`.
- Biglietto da visita: formato orizzontale con flip fronte/retro, QR, condivisione PNG/PDF (V38W, v2.15, v2.3, V29.av alpha PNG),
  statistiche (v2.28). Firma email agente (v2.ag).
- Eventi Master: banner con programma PDF, fix "Invalid PDF structure" e "Rendered more hooks" (v2.aa, v2.x).
- **Comunica con l'azienda** (`src/CompanyContactSheet.tsx`, sheet dalla Home, V49): nome/email/numeri di servizio (`/settings`
  `communica_azienda_*`), documenti aziendali PDF + estrazione contatti AI, link utili. **V50.z145**: "Modifica" (Master) consente
  SOLO di correggere/eliminare i contatti esistenti (etichetta, numero) + nome/email — rimosso "Aggiungi" in edit-mode; nuovo bottone
  separato **"+ Aggiungi contatto"** in view-mode con form inline (etichetta + numero, dedup numero) indipendente dal PDF.

## 11. Impostazioni
- Nome app, nome assistente, voce TTS, modalità risposta, azioni rapide, tipi appuntamento e categorie prodotto custom,
  aree (vedi §2), formato ora 12h/24h, dashboard widget, edge panel, sicurezza/2FA, tema Optima esteso a tutte le pagine (V29.bb/bc).
- **Header tabella** (V50.z140, solo Master): logo + nome azienda in testa alle tabelle AxonOS esportate (vedi §5).
- **Esporta/condividi chat** (V50.z160): header ⋯ Altro (Condividi conversazione · Esporta PDF · Copia tutto) + azioni per messaggio Copia · Condividi · PDF — `src/utils/chatExport.ts` (`conversationToText`, `shareText` via RN Share / navigator.share, `copyText` expo-clipboard, `exportConversationPdf` expo-print → expo-sharing).

## 12. Stile / UX globale
- **REGOLA MODAL (V50.z135, richiesta utente)**: in ogni modal il pulsante di chiusura/azione primaria sta in un footer FISSO fuori
  dallo ScrollView, card con `maxHeight` (~88% viewport) + padding safe-area bottom + KeyboardAvoidingView: deve essere sempre
  visibile senza scorrere. Applicare a ogni nuovo modal e quando si tocca un modal esistente.
- Stile Optima: header tecnico senza loghi, bottoni categorizzati, safe-area globale, label 1 riga (V50.a/c, V29.ba–bc).
- Bottom nav persistente, barra AxonOS minimale (v2.ap). Keyboard-avoiding fix nei modal Insegna ad Axon (V29.au/ax).
  **V50.z141 — Bottom bar**: la voce "Report" è sostituita da **"Help"** (icona `help-circle`) che apre la guida / tour guidato
  (`/libretto`; `listeners.tabPress` + `preventDefault` in `(tabs)/_layout.tsx`, fallback screen `(tabs)/help.tsx` con Guida rapida /
  Rifai il tour / Help Center). `report` resta nel gruppo (tabs) con `href: null` (rotta `/report` invariata) ed è raggiungibile
  dal menu laterale come **"Statistiche"** (Team & Insights) e dall'Edge Panel. `PersistentBottomNav` allineata (tab Help attivo su
  `/libretto` e `/help*`, nascosta su `/report` dove c'è la Tabs nativa).
  **V50.z149**: nell'Edge Panel (pannello laterale DESTRO, shortcut personalizzabili in AsyncStorage `edge_panel_ids_v1`) "report"
  (Statistiche) è ora tra i `DEFAULT_IDS` e viene aggiunto una-tantum alle selezioni già salvate (flag `edge_panel_report_added_v1`);
  l'utente può comunque toglierlo da "Modifica".
  **V50.z147**: rimosso da `app/_layout.tsx` il `<SupportFab />` (bottone Help/Support Center in alto a destra su tutte le pagine,
  V49.j/k) perché ridondante col tab Help. Il componente `src/SupportFab.tsx` (sheet assistenza AI + ticket) resta nel codice ma
  non è più montato.
- Menu laterale (`DrawerMenu.tsx`): **V50.z131** rimosso link morto "Note" (`/notes`, pagina inesistente); "Business Cards" →
  "Biglietto da visita" collegato a `/business-card`. Mapping colori in `menuCategories.ts` aggiornato.
- Regola: nessuna schermata bianca — error boundary su moduli chart/table, timeout visibili.

## 13. Infrastruttura / Backend
- **V50.z146 — Permesso CAMERA hardcoded nel manifest Android**: plugin locale `frontend/plugins/withCameraPermission.js`
  (`withAndroidManifest`, idempotente) forza `<uses-permission android.permission.CAMERA/>` + `<uses-feature android.hardware.camera
  / .autofocus required=false>`; `expo-build-properties` installato (~1.0.10) e registrato; prop `android.permissions:["CAMERA"]` sul
  plugin `expo-camera`. `expo.android.permissions` continua a includere `CAMERA`. Verificato con `expo config --type introspect`.
  Richiede nuova build APK.
- Refactor architetturale fasi 1-3 (v1.6–1.8). Scheduler APScheduler: auto-CRM tick, review auto-follow-up (1h), advisor auto-tips
  (12h), reminder appuntamenti cliente. Cache semantica con embedding. Deploy Emergent Publish o Aruba (`/app/ARUBA_DEPLOY.md`).
- Endpoint chiave: `/api/assistant/chat/stream`, `/api/axon/quick-action`, `/api/axon/alarms`, `/api/weather/dashboard`,
  `/api/weather/appointments`, `/api/scanner/autocrop-preview`, `/api/axon/teach/distill-now`, `/api/settings`, `/api/user-settings`, `/api/calendar/team`.

---

## Backlog approvato (non ancora implementato)
- Cancellazione/disattivazione sveglie a voce ("cancella il timer").
- Confronto collaboratori (KPI a confronto).
- Registro chiamate Android `READ_CALL_LOG` (solo APK sideload).
- ~~Bug nested modal~~ — **chiuso dall'utente (Giu 2026): non più da trattare.**

---

## Architettura backend (V50.z161 — split del monolite)

`backend/server.py` è ora solo l'**entrypoint** (`uvicorn server:app`): esegue in ordine i moduli elencati in
`backend/routes/__init__.py::MODULES` nel proprio namespace globale. Semantica identica al file unico: ogni
funzione/modello/costante è visibile da tutti i moduli senza import, ordine di registrazione route preservato.
Regole: modificare il modulo dell'area (`routes/07_contacts.py`, `routes/08_calendar.py`, `routes/21_axon_streaming.py`, `routes/28_google_drive.py`, …);
nuovo modulo → file in `routes/` + voce in `MODULES` nella posizione giusta (prima di `37_app_startup_scheduler.py`, che fa `app.include_router`).
I numeri nel nome indicano SOLO l'ordine di caricamento. Backup del monolite originale: non conservato nel repo (git history).

## Indice cronologico (più recente in alto)
| Versione | Data | Contenuto |
|---|---|---|
| V50.z194 | Set 2026 | Stato visibile >3 s durante elaborazioni lunghe (bolla intermedia contestuale: tabella/PDF/GME/meteo/web, `src/axonProgress.tsx`) + Persistenza dati importati da PDF/Excel/CSV su conferma «Vuoi che memorizzi questi dati per uso futuro?» (`routes/axon_imported_data.py`, `axon_imported_data` condivisa col team, iniettata nelle chat, pulsanti rapidi, sezione «Dati importati» in Memoria AxonOS) |
| V50.z193 | Set 2026 | Fix push autonome: bridge persistente AxonOS → Push Service (`routes/axon_push_bridge.py`: wrapper `send_push` con esito reale + outbox retry backoff, `push_devices` con `last_failed_at`, `GET /axon/push/status` in linguaggio semplice, test programmato a N minuti + ack dal telefono, nudge in chat se permesso negato; `src/pushBridge.ts` canale Android default a livello modulo + registrazione con retry; card «Stato canale push»). Causa radice: manca `google-services.json` (da fornire) |
| V50.z192 | Set 2026 | Blocco 9b «Cosa sa Axon di me»: `routes/axon_memory.py` + `app/axon-memory.tsx` (Profilo → Memoria AxonOS: preferenze, clienti chiave, scadenze, stile, argomenti, integrazioni; modifica/cancella/analizza/cancella tutto) |
| V50.z191 | Set 2026 | Splash/branding: AdvisorOS + AxonOS (60%) impilati, via "CRM per consulenti e network" e "powered by AxonOS", tagline «Il tuo "Tuttunizzatore"» (splash, copertina e chiusura Tour/Libretto app+PDF, libretti Master) |
| V50.z190 | Set 2026 | Claim ufficiale "AxonOS — Brain+" (`src/BrainPlus.tsx`, "+" arancione più grande bold) in copertina/sezioni 1-18-21-chiusura del Libretto (app+PDF), libretti Master, WowIntro, landing |
| V50.z189 | Set 2026 | Tour Guidato: FAQ privacy allineata, target ampliato, sezioni 18–21 (Perché diverso / Per chi / Vita privata / Vantaggio nel tempo), headline finale, riferimenti "Voice Copilot" → Axon Drive |
| V50.z188 | Set 2026 | Blocco 7: autoapprendimento anonimizzato AxonOS (`axon_self_learning.py`: estrazione insight in background, `axon_knowledge_base`, contesto nelle chat, dashboard Master `/axon-insights`) |
| V50.z187 | Set 2026 | Batch 5 (4–7): Edge Panel per area/colore come Master, privacy Help/FAQ (dati aggregati), accesso rapido login impronta/Face ID/PIN (`auth_quick_unlock.py`, `QuickUnlockCard`), inset bottom radice uniforme (`RootInsetsProbe`) |
| V50.z186 | Set 2026 | Batch 5: stop vocale nativo (barge-in + parole di stop, pause/resume SentenceSpeaker), audio/registrazione in background (plugin expo-audio, UIBackgroundModes), padding tastiera Android globale + Modal lunghi; fix `api.post` Axon Drive |
| V50.z185 | Set 2026 | Knowledge Base: PDF originale su Object Storage + Apri/Scarica/Testo estratto nel modal di modifica; fix campi coperti dalla tastiera Android (`master_docs_files.py`, `KbEntryEditorModal.tsx`) |
| V50.z184 | Set 2026 | AxonOS invia push in autonomia dalla chat: consegna server-side promemoria/timer (kind `reminder`, arming esatto + tick 60s, no doppioni) + comandi «mandami una notifica…», «avvisami se…», «notifica di prova», «quali notifiche ho attive» (`routes/axon_chat_push.py`) |
| V50.z183 | Set 2026 | Motto evolutivo "il CRM che si evolve con te" (`EvolutionMotto`) in copertina Libretto e landing |
| V50.z182 | Set 2026 | Libretto + Presentazione 2.0: headline, AxonOS/Corporate Gym/Axon Drive riscritti, nuove sezioni Notifiche push e Chiusura, blocchi highlight + bullet con icone (app e PDF), landing aggiornata |
| V50.z181 | Set 2026 | Notifiche push AxonOS (Gym obbligatorie, richiamate urgenti, crediti 50/80/100%, report settimanale, messaggi critici): inbox + preferenze + badge icona/drawer, copie [Team] al Master, modulo isolato `axon_notifications.py` |
| V50.z180 | Set 2026 | Axon omnisciente: prompt con mappa dell'app + dati completi di tutte le sezioni + schede complete dei contatti citati (`axon_crm_omniscience.py`), visibilità rispettata |
| V50.z179 | Set 2026 | Libretto: badge versione dinamico (versione app reale + data ultimo aggiornamento build), app.json → 2.0.0, badge "2.0 · Settembre 2026" |
| V50.z178 | Giu 2026 | Tour guidato/Libretto: nuovo step "Corporate Gym — Formazione vocale per il tuo team" (banner + icone Gym Obiezioni/WIN-WIN) prima di Consigli/FAQ; step esistenti invariati; integrato anche nei libretti personalizzati |
| V50.z177 | Giu 2026 | Axon Drive: rinomina globale di "Copilot Vocale · Modalità Auto" (drawer+icona auto, header, Home, libretto) e redesign UI della pagina (sfondo interno auto, volante centrale, esempi grandi con icona, mic prominente); nessuna modifica funzionale |
| V50.z176 | Giu 2026 | Scanner: `_detect_document_quad` sceglie il "documento principale" tra oggetti sul tavolo con punteggio di somiglianza a documento (fill senza testo, bordi reali, gradino dentro/fuori, rettangolarità, aspetto) prima della dimensione; segmentazione carta + separazione fogli adiacenti; benchmark 59/60 (era 53/60) |
| V50.z175 | Giu 2026 | Corporate Gym · Manuali Google Drive gestiti da AxonOS: il Master configura la cartella principale (sottocartelle Obiezioni/WIN-WIN per nome), "Leggi Manuale" nelle due sezioni elenca i PDF letti live dal Drive del Master (ricerca per nome, Apri/Scarica via link firmato 12h `/public/cgym-manual/{token}`), sempre ultima versione; solo il Master modifica il percorso |
| V50.z174 | Giu 2026 | Corporate Gym fix: icone tile/header intere e centrate (`CgymTileIcon` prop `fill` + resizeMode contain; banner header con aspect ratio reale via Image.getSize, contain); widget Home nascosto se nessuna sessione oggi/in scadenza 7gg/assegnata pendente; card "Il tuo feedback AxonOS" nella Gym home per ogni collaboratore (`CgymMyFeedbackCard`; backend agent-feedback POST consentito anche per il proprio user_id) |
| V50.z173 | Giu 2026 | Corporate Gym Blocco 5: obiezioni COSTO e DECISORE + Gym WIN-WIN (trattativa integrata vocale 45 min a 5 fasi, timer, score/feedback, salvataggio in cgym_sessions type winwin); `GET /api/cgym/roleplay/scenarios` |
| V50.z172 | Giu 2026 | Corporate Gym Blocco 4: dashboard statistiche Master (`/corporate-gym/stats`, `/api/cgym/stats`), feedback personale AxonOS per agente e report settimanale (lacune, scenari, manuale vendite) con cache `cgym_ai_reports` |
| V50.z171 | Giu 2026 | Corporate Gym Blocco 3: assegnazioni Master (agente/team, tipo, 1-3 al giorno, scadenza → sessioni generate), piani con avanzamento, badge drawer done/total, widget riga assegnate, striscia attiva su assegnate non completate |
| V50.z170 | Giu 2026 | Corporate Gym Blocco 2: role-play vocale Obiezione TEMPO (AxonOS = cliente via LLM+TTS interni, consulente a voce/STT o testo, score+feedback, salvataggio in cgym_sessions) — `/corporate-gym/roleplay` |
| V50.z169 | Giu 2026 | Corporate Gym: tile Gym Obiezioni / Gym WIN-WIN con icone ufficiali (immagini utente via URL, `CGYM_TYPE_META[].image`, componente `CgymTileIcon` con fallback Ionicons) anche nell'header delle sottosezioni. Nessun'altra modifica |
| V50.z168 | Giu 2026 | Corporate Gym Blocco 1 (modulo isolato): backend `routes/corporate_gym.py` + `cgym_sessions`, pagine `/corporate-gym` (+ obiezioni, win-win), widget Home `cgym`, striscia arancione obbligatorie, voce Master + drawer |
| V50.z167 | Giu 2026 | Batch 4: bottom nav uniforme — nuovo hook condiviso `useNavBarBottomInset()` (`src/hooks/useSafeBottom.tsx`: max(insets.bottom, initialWindowMetrics.bottom, 20)) usato sia dalla Tabs nativa `(tabs)/_layout.tsx` (Home & tab) sia da `PersistentBottomNav` → stesso padding-bottom su tutte le schermate (in Home insets.bottom=0 dentro lo Stack Android edge-to-edge → barra attaccata alla navigation bar) |
| V50.z166 | Giu 2026 | Scanner (job d664abc6): mutex fotocamera sample/scatto + timeout, reset rilevamento a ogni scatto, campionamento in pausa durante l'autocrop, autocrop per pagina con 3 tentativi/AbortController/45s + badge "riprova", suono scatto Basso/Muto/Sistema persistito (click soft expo-audio) |
| V50.z165 | Giu 2026 | Batch 3: scanner "Foto singola" resta nello scanner dopo "Usa questa" (strip + "Fine (N)" anche in single, si esce solo con Fine); foto ridimensionata a 1800px con expo-image-manipulator prima dell'upload autocrop (velocità/affidabilità) + 1 retry; **safe-bottom globale**: `useSafeBottom`/`useBottomSheetPadding`/`usePageBottomPadding` con fallback `initialWindowMetrics.insets.bottom` (dentro i Modal Android insets=0) e min Android 24; `useInsetsSafe()` applicato a 15 componenti/modal che usavano `insets.bottom` diretto; bill-quick "Avvia analisi AI" con paddingBottom |
| V50.z164 | Giu 2026 | Batch 2: (1) indirizzo appuntamento — `composeAppointmentAddress` dà priorità a `location` (campo modificato nella scheda) sui campi strutturati copiati dal contatto → banner/condivisione mostrano l'indirizzo aggiornato; (2) **PDF parser AxonOS** modulo isolato `routes/36b_axon_pdf_link_parser.py`: link .pdf nel messaggio → download (15MB, 25s), testo + righe numeriche (formato IT), cache 6h, sezione "PDF DAL LINK" nel prompt tramite wrap non invasivo di `_build_axon_teach_section`; endpoint `POST /axon/pdf-link/parse` |
| V50.z163 | Giu 2026 | Pagina Meteo: card "Cerca meteo per città" (temporanea): `/weather/forecast {address}` senza toccare user-settings; banner "Stai consultando: X · Torna alla mia posizione"; allerte nascoste durante la consultazione; errore se località non trovata (rilevato via `place` ≠ query); stato locale → tornando in Home si ripristina il default |
| V50.z162 | Giu 2026 | PROMPT 1 bug-fix: (1) scanner live `detect-corners` usa lo stesso detector robusto dell'autocrop + mappa CLAHE (ombre/luce radente) + soglia min proporzionale; (2) scatto singolo: stop campionamento in anteprima/dopo il 1° scatto, guard in takeShot, `shutterSound:false` sul sampling; (3) widget Meteo Home nascosto senza allerte (badge header resta); (4) "Meteo" nelle scorciatoie Edge Panel; (5) paddingBottom 140 su 28 schermate scrollabili (script, escluse sheet/login/landing); (6) modal "Salva come regola" scrollabile + KeyboardAvoiding, bottone Salva sempre visibile |
| V50.z161 | Giu 2026 | **Refactoring server.py** (26.212 righe) → 38 moduli per area funzionale in `backend/routes/NN_<area>.py`; `server.py` è un loader di 30 righe che li esegue in ordine nello stesso namespace (zero breaking changes: 416 route identiche, stessi nomi/startup/middleware, tracce d'errore con file reale). Ordine in `routes/__init__.py::MODULES` |
| V50.z160 | Giu 2026 | AxonOS chat esportabile/condivisibile: header "⋯ Altro" → Condividi conversazione (share sheet nativo: WhatsApp/gruppi/mail/social), Esporta PDF (expo-print+expo-sharing), Copia tutto; su ogni messaggio azioni Copia · Condividi · PDF (`src/utils/chatExport.ts`) |
| V50.z159 | Giu 2026 | Home: tap sulla card Scadenze apriva l'Edge Panel → hitSlop sinistro linguetta 16→4 e ⋯ non più a filo bordo; orologio header ri-sincronizzato al rientro in foreground (AppState) e al focus (ora locale del dispositivo) |
| V50.z158 | Giu 2026 | Tour primo avvio (APK 1.0.50 ancora assente): apertura con `push` alternato a `replace`, verifica `usePathname` e fino a 5 tentativi (1s), nessun blocco su navReady; `android.allowBackup: false` (il backup automatico Android ripristinava AsyncStorage al reinstall → flag `onboarding_done_*` già "1" → nessun tour) |
| V50.z157 | Giu 2026 | Meteo: badge header SEMPRE visibile (Home + Master; senza dati mostra nuvola + "Meteo" → /meteo per impostare la località; refresh al focus) — prima `return null` senza GPS/indirizzo (APK senza permesso posizione). "Meteo" aggiunto alle Utility della Master |
| V50.z156 | Giu 2026 | Scanner: riga "Diagnostica" nella schermata permesso fotocamera (stato reale + richiedibile) per distinguere "permesso negato" da "permesso assente nella build". Config Android RIVERIFICATA con `expo prebuild` locale: il manifest generato contiene CAMERA/RECORD_AUDIO/CONTACTS/LOCATION → se l'APK 1.0.49 non li ha, è la pipeline di build (escalation supporto). Fix collaterale: `yarn.lock` aggiornato con `expo-build-properties` (mancava → possibile fallimento install in CI) |
| V50.z155 | Giu 2026 | **Axon + Google Drive: accesso REALE alle cartelle monitorate.** Root cause: l'indice `drive_snapshots` non veniva mai passato all'AI (solo i link Drive di "Insegna ad Axon" venivano letti, con BFS live sull'API ad ogni domanda → 30-120s) e il prompt diceva ad Axon "vedi SOLO ciò che l'utente allega". Ora: indexer ricorsivo in thread (PDF/TXT/CSV/Google Docs/Sheets, sottocartelle, 300 file), avvio automatico dopo OAuth/scelta cartella + job 30 min, chat legge dall'indice in ms, prompt riscritto (2 copie) + fix `folder_name` ("?"), timeout 12s per fetcher, card "Indice Axon" + "Aggiorna indice ora" nella pagina Google Drive |
| V50.z154 | Giu 2026 | OAuth Google Drive/Dropbox su APK: ritorno automatico nell'app. Il client invia `return_url` (deep-link) + `android_package` a `/oauth/start`; la pagina di callback usa `intent://…#Intent;scheme=frontend;package=…;end` (Chrome/Samsung Internet) + scheme fallback; rimosso il check UA "android;" (mai vero → link web). Dropbox: returnUrl del custom tab ora è il deep-link (non più https) |
| V50.z153 | Giu 2026 | Scadenze: icona ⋯ su ogni card (Home + /deadlines) → "Disattiva avviso" (server-side, sparisce da liste e conteggi), "Nuova data scadenza" (override manuale, riattiva), "Sostituisci bolletta" (apre tab Bollette; nuova bolletta/rianalisi riattiva). API `POST /deadlines/{bill_id}/dismiss`, `PUT /deadlines/{bill_id}/expiry` |
| V50.z152 | Giu 2026 | Calendario: promemoria compleanno si chiude 24h dopo o con "Visto ✓" (persistito sul dispositivo) |
| V50.z151 | Giu 2026 | Meteo: geocoding con 3° fallback Open-Meteo (città/CAP anche da indirizzi con via), negative-cache 10 min, messaggio "Indirizzo non riconosciuto" + Riprova, errore salvataggio visibile |
| V50.z150 | Giu 2026 | Home: widget "Meteo" della zona widget SEMPRE visibile (temp attuale, min/max, condizioni, località); header badge mostra temp attuale |
| V50.z149 | Giu 2026 | Edge Panel (menu laterale destro): "Statistiche" tra i default + migrazione una-tantum per selezioni salvate |
| V50.z148 | Giu 2026 | Fix regressione icona meteo header (APK 1.0.48): timeout 6s su getCurrentPositionAsync + retry API nel badge |
| V50.z147 | Giu 2026 | Rimosso il bottone Help/Support Center dalle top header di tutte le pagine (SupportFab non montato) — ridondante col tab Help |
| V50.z146 | Giu 2026 | Android: permesso CAMERA hardcoded via config plugin locale + expo-build-properties; uses-feature camera required=false (serve nuova build) |
| V50.z145 | Giu 2026 | Comunica con l'azienda: "Modifica" solo per contatti esistenti; nuovo "+ Aggiungi contatto" manuale (form inline) |
| V50.z144 | Giu 2026 | Knowledge Base Axon: voci FAQ/Dati/Nota + TXT/MD/CSV, modifica/rinomina, filtri; PINNED riattivate in cima al prompt; impegni "da ora farò X" PINNED |
| V50.z143 | Giu 2026 | Insegna ad Axon: "Distilla chat" → Claude estrae regole da conversazione incollata/storica e le salva PINNED |
| V50.z142 | Giu 2026 | Chat Axon: ack SSE immediato "Sto ragionando…" come primo evento (<1s), fallback locale nel client |
| V50.z141 | Giu 2026 | Bottom bar: "Report" → "Help" (apre guida/tour); "Statistiche" nel menu laterale (Team & Insights) e Edge Panel |
| V50.z140 | Giu 2026 | Chat: tabella a schermo intero (tap/bottone), Impostazioni "Header tabella" (logo + nome) su tabelle chat/PDF/PNG |
| V50.z139 | Giu 2026 | Scanner: "Foto singola" con fotocamera in-app (autofocus + autocrop prima del ritorno), fix loop permessi Android 16, anteprima full-screen |
| V50.z138 | Giu 2026 | Home: chiusura filtro Scadenze; dettaglio appuntamento: esiti sempre cliccabili (auto-Fatto), chip dettagli fix Android |
| V50.z137 | Giu 2026 | Help Center: bottone prominente "Rifai il tour guidato" (funziona anche dopo completamento) |
| V50.z136 | Giu 2026 | Intro animata offline nel tour (WowIntro) + "Rivedi tour guidato" in Help Center |
| V50.z135 | Giu 2026 | Modal "Appuntamento creato": chiusura sempre visibile; testo invio dettagli personalizzabile (creazione + dettaglio) |
| V50.z134 | Giu 2026 | Scanner: autocrop robusto (nuovo detector OpenCV) + Foto singola sempre fotocamera posteriore |
| V50.z133 | Giu 2026 | Tour onboarding: attesa navigator pronto + flag device al primo mostrare (una volta per dispositivo) |
| V50.z132 | Giu 2026 | Home: widget meteo solo con allerte, mini-icona meteo sul banner, Appuntamenti di oggi sotto Ritelefonate |
| V50.z131 | Giu 2026 | FAB Axon: tap via Pressable (fix Contatti); drawer: rimosso "Note", "Business Cards" → `/business-card` |
| V50.z130 | Giu 2026 | Distillazione regole on-demand: lezioni in chat → ai_teach_rules immediate + `POST /axon/teach/distill-now` |
| V50.z129 | Giu 2026 | Cattura automatica impegni Axon ("da ora farò X") → ai_teach_rules immediata |
| V50.z128 | Giu 2026 | Google Drive: token cache + retry transitori + rimozione connessione solo su invalid_grant |
| V50.z127 | Giu 2026 | Fix orario appuntamenti: datetime UTC espliciti (+00:00) nelle risposte appuntamenti/calendario |
| V50.z126 | Giu 2026 | Azioni rapide in streaming SSE + heartbeat preflight + `cache_only` |
| V50.z125 | Giu 2026 | Comandi Timer/Sveglie/Promemoria in linguaggio naturale via chat Axon; fix import `notify` |
| V50.z121 | Giu 2026 | Error Boundary grafici/tabelle, timeout visibile, fix decimali chart |
| V50.z113–z120 | Giu 2026 | CRM Aree 3 livelli, permessi aree, meteo widget/pagina/appuntamenti, tour per-device |
| V50.z110–z112 | Giu 2026 | Fix orario appuntamenti, OAuth Drive APK, tour ripristinato, voce in streaming |
| Giu 2026 (fix UI) | Giu 2026 | Tipo "Personale", Scadenze route, FAB Android, CSV, legenda calendario, Gas blu, scanner ritaglio manuale, script rimossi |
| V50.z107–z109 | Giu 2026 | WebView interna app-wide, migrazione link legacy, grafici fullscreen |
| V50.z100–z106 | Giu 2026 | KB auto-search, FAB draggable, sondaggio, recensioni, lead, gestione clienti, landing, sicurezza |
| V50.z80–z92 (PROMPT 16–21) | Giu 2026 | Condivisione appuntamento, dashboard configurabile, richieste info, push, scanner multipagina, Tavily extract, KB WebView |
| V50.z66–z79 | Set 2026* | Import CSV/Excel, campi custom, Waze/Maps, preferiti, distanze, My Web, WebView, fatture Master, GME fix, sveglia volume, meteo |
| V50.z50–z52 | Set 2026* | Utility sveglia + scanner + hub impostazioni, memoria Axon rewrite, avatar menu |
| V50.z24–z42 | — | Anteprima allegati, mail auto-CRM, fix GME/PUN, quick action istantanee, meteo, preflight parallelo, menu categorizzati, cache Tavily, edge panel fix, password vault |
| V50.z8–z15 | Set 2026* | Axon Alarms, calculator draggable, Axon Drive, widget sveglia, 12h/24h, fix Drive/chat input, edge panel |
| V50.a–r | Set 2026* | Fix visivi, performance, PUN/GME, Dropbox, Drive scope, Insegna ad Axon tab, router Haiku/Sonnet, RAG semantico, slash, onboarding, copilot vocale |
| v40–v45 | Giu 2026 | Streaming SSE + cache semantica, feedback, RAG Master, regole notturne, team insights, cruscotto |
| v29.ak, V29.aq–bc | — | Landing, header home, scanner live, Drive OAuth fix, tastiera Android, stile Optima |
| V38Q–V38W | Giu 2026 | Master files, PDF/UI fix, Neo AI, biglietto redesign, analisi fattura |
| v2.0–v2.aq | Feb–Giu 2026 | Bug fix vari, banner evento, CTE, biglietto, Insegna ad Axon, azioni rapide, export tabelle, scanner multipagina, Drive, brand, splash |
| v1.3–v1.9 | Feb 2026 | Funzioni base contatti/appuntamenti/calendario, biglietto restyling, refactor fasi 1-3, fiscal check |

\* Le date "Set 2026" nel PRD sono etichette di versione storiche; il mese corrente di sviluppo è Giugno 2026.
