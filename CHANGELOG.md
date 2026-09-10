# CHANGELOG — AdvisorOS / AxonOS

> ⚠️ **REGOLA PER L'AGENTE**: consultare questo file **prima di ogni modifica**. Tutto ciò che è elencato qui è
> **approvato dall'utente e funzionante**. Non riscrivere, rimuovere o "semplificare" queste funzionalità.
> Ogni nuova modifica va aggiunta in coda alla sezione della propria area E nell'indice cronologico in fondo.
> Dettagli tecnici completi per ogni versione: `/app/memory/PRD.md` (cerca il codice versione, es. `V50.z126`).
>
> Lingua utente: **Italiano**. Test: manuali (screenshot_tool / python / curl) — **NON usare testing_agent** (richiesta utente).
> Bug "nested modal" (modali che si chiudono digitando): l'utente ha detto di **lasciarlo stare** — non toccare senza conferma.

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
  flag server → riapre intro + tour anche se già completato).
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
- **Insegna ad Axon** (v2.34): regole + file/URL allegati, multi-categoria (v2.n), tab compatti (V50.i), PDF extraction e URL refresh
  (v2.ab), auto-suggest deep-link canonici (V50.z29). Fix ricorrenti: Axon legge i file delle regole (v2.ak, V29.at),
  ricerca PDF GME / tabelle PUN / dual-storage (V50.z26/27/28), validazione prefetch GME (V50.z77).
- **RAG documenti Master** (v42): chunk + retrieval per tenant; **Knowledge Base personale** da pagine WebView con auto-search
  (V50.z92, V50.z100). Axon Drive re-index (V50.z85, V50.z8-9).
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

## 8. File, Drive e Mail
- I miei file / Master Files: upload con formati unificati e validazione (v2.20), share nativo (v2.6), report inline (v2.4).
- **Google Drive OAuth** (v2.w): redirect_uri hardening, PKCE code verifier fix (V29.as/aw), scope allargato (V50.h), fix ricorsione
  (V50.z12), **fix redirect deep link `frontend://` su APK Android** (V50.z110). Dropbox OAuth + callback backend (V50.e/f).
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

## 11. Impostazioni
- Nome app, nome assistente, voce TTS, modalità risposta, azioni rapide, tipi appuntamento e categorie prodotto custom,
  aree (vedi §2), formato ora 12h/24h, dashboard widget, edge panel, sicurezza/2FA, tema Optima esteso a tutte le pagine (V29.bb/bc).
- **Header tabella** (V50.z140, solo Master): logo + nome azienda in testa alle tabelle AxonOS esportate (vedi §5).

## 12. Stile / UX globale
- **REGOLA MODAL (V50.z135, richiesta utente)**: in ogni modal il pulsante di chiusura/azione primaria sta in un footer FISSO fuori
  dallo ScrollView, card con `maxHeight` (~88% viewport) + padding safe-area bottom + KeyboardAvoidingView: deve essere sempre
  visibile senza scorrere. Applicare a ogni nuovo modal e quando si tocca un modal esistente.
- Stile Optima: header tecnico senza loghi, bottoni categorizzati, safe-area globale, label 1 riga (V50.a/c, V29.ba–bc).
- Bottom nav persistente, barra AxonOS minimale (v2.ap). Keyboard-avoiding fix nei modal Insegna ad Axon (V29.au/ax).
- Menu laterale (`DrawerMenu.tsx`): **V50.z131** rimosso link morto "Note" (`/notes`, pagina inesistente); "Business Cards" →
  "Biglietto da visita" collegato a `/business-card`. Mapping colori in `menuCategories.ts` aggiornato.
- Regola: nessuna schermata bianca — error boundary su moduli chart/table, timeout visibili.

## 13. Infrastruttura / Backend
- Refactor architetturale fasi 1-3 (v1.6–1.8). Scheduler APScheduler: auto-CRM tick, review auto-follow-up (1h), advisor auto-tips
  (12h), reminder appuntamenti cliente. Cache semantica con embedding. Deploy Emergent Publish o Aruba (`/app/ARUBA_DEPLOY.md`).
- Endpoint chiave: `/api/assistant/chat/stream`, `/api/axon/quick-action`, `/api/axon/alarms`, `/api/weather/dashboard`,
  `/api/weather/appointments`, `/api/scanner/autocrop-preview`, `/api/axon/teach/distill-now`, `/api/settings`, `/api/user-settings`, `/api/calendar/team`.

---

## Backlog approvato (non ancora implementato)
- Cancellazione/disattivazione sveglie a voce ("cancella il timer").
- Confronto collaboratori (KPI a confronto).
- Registro chiamate Android `READ_CALL_LOG` (solo APK sideload).
- Bug nested modal — **solo su richiesta esplicita dell'utente**.

---

## Indice cronologico (più recente in alto)
| Versione | Data | Contenuto |
|---|---|---|
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
