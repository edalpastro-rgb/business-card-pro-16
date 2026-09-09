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
- Vista giornaliera, filtri categoria, compleanni annuali, **Calendario Team** (I miei / Team / Tutti, privacy per collaboratori).
- Pallini colorati per tipo + **legenda colori** (Giu 2026). Fix mapping tipo "Personale".
- **Fix orario 08:15→06:15** (V50.z110 lato editor; **V50.z127 root cause backend**: `start_at`/`end_at` letti da Mongo erano datetime naive
  serializzati senza fuso → il client li leggeva come ora locale. Ora `_aware_utc_times()` forza `+00:00` su list/get/put/calendar-team).
- **Condivisione appuntamento col cliente** WhatsApp/Email + reminder automatico (V50.z80), "Invia dettagli" in creazione (v2.14).
- **Meteo negli appuntamenti**: icona/tooltip meteo accanto agli eventi in calendario e nel dettaglio con consigli (V50.z117),
  basato sull'indirizzo del contatto (OpenMeteo, `POST /api/weather/appointments`).
- Timer chiamata → barra compatta globale (v2.r), timer in background (v2.ae).

## 4. Home / Dashboard / Master
- Home V27 redesign, header animato/collapsable con immagine locale (V29.aq/ar), home compatta + PUN riorganizzato (V50.z87).
- **Dashboard configurabile** (V50.z81): widget riordinabili; widget PUN Live & Richieste Info (V50.z82); widget Sveglia (V50.z10);
  **Widget Meteo & Allerte** sempre visibile + banner allerte separato + pagina `/meteo` 7 giorni (V50.z79, z116).
- Widget sotto "Interfaccia Master" (V50.z120). Banner My Thing con font/size/colore personalizzabili (v2.31). Banner Evento Master
  con range date, descrizione, audio, copertina PDF (v2.10, v2.18, v2.11). **Banner Gas colore BLU** (Giu 2026).
- **Interfaccia Master**: griglia bottoni stile Optima categorizzati per colore con header categorie (V50.z34/40/41), drawer laterale
  6 categorie (V50.z35), avatar menu snellito (V50.z52), Cruscotto Master unificato + notifica proposte (v45), Anagrafica Master &
  Password Vault (V50.z42), Hub Impostazioni (V50.z50). Statistiche biglietto da visita (v2.28).
- **Edge Panel** Samsung-style con shortcut personalizzabili (V50.z15, fix z38). Calcolatrice FAB draggable + ridimensionabile
  (V50.z6, z14). SupportFab (V50.d). Bottone Caselle mail su Home (V50.z25).
- Team Insights / profilo comportamentale collaboratori (v44, v2.aj). Report con intestazione configurabile (v2.17).

## 5. AxonOS — Assistente AI (chat)
- Chat modale via **FAB trascinabile** (V50.z100; fix touch Android hitSlop Giu 2026), header con logo, dropdown modalità
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
- Allegati: upload file/foto/scanner dalla chat (V50.z85), drag-and-drop desktop (v2.v), processing avanzato allegati (V50.z90),
  anteprima allegati in-app (V50.z24).
- Feedback 👍/👎 self-learning + few-shot dinamico (v41), "Salva come regola" / "Salva nei file Master" a fine risposta (v2.y, V38T),
  regole auto-estratte da chat notturne (v43), memoria persistente Axon riscritta (V50.z51, endpoint `/assistant/memory`).
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
- **Multi-pagina** (v2.s, V50.z86) con step di revisione, **ritaglio manuale 4 angoli** `ManualCropEditor.tsx` +
  `POST /api/scanner/autocrop-preview` (OpenCV) (Giu 2026), nome file custom (V50.z88), scanner standalone (V50.z50) e da chat Axon.
- Analisi bolletta (cliente + Master allineati, v2.8), CTE comparativa multi-bolletta + report (v2.12), Fiscal Check con JSON
  parsing robusto (v1.9), auto-save bozze nei file Master (V38Q), 5 bug fix pagina analisi fattura (V38W).

## 8. File, Drive e Mail
- I miei file / Master Files: upload con formati unificati e validazione (v2.20), share nativo (v2.6), report inline (v2.4).
- **Google Drive OAuth** (v2.w): redirect_uri hardening, PKCE code verifier fix (V29.as/aw), scope allargato (V50.h), fix ricorsione
  (V50.z12), **fix redirect deep link `frontend://` su APK Android** (V50.z110). Dropbox OAuth + callback backend (V50.e/f).
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

## 12. Stile / UX globale
- Stile Optima: header tecnico senza loghi, bottoni categorizzati, safe-area globale, label 1 riga (V50.a/c, V29.ba–bc).
- Bottom nav persistente, barra AxonOS minimale (v2.ap). Keyboard-avoiding fix nei modal Insegna ad Axon (V29.au/ax).
- Regola: nessuna schermata bianca — error boundary su moduli chart/table, timeout visibili.

## 13. Infrastruttura / Backend
- Refactor architetturale fasi 1-3 (v1.6–1.8). Scheduler APScheduler: auto-CRM tick, review auto-follow-up (1h), advisor auto-tips
  (12h), reminder appuntamenti cliente. Cache semantica con embedding. Deploy Emergent Publish o Aruba (`/app/ARUBA_DEPLOY.md`).
- Endpoint chiave: `/api/assistant/chat/stream`, `/api/axon/quick-action`, `/api/axon/alarms`, `/api/weather/dashboard`,
  `/api/weather/appointments`, `/api/scanner/autocrop-preview`, `/api/settings`, `/api/user-settings`, `/api/calendar/team`.

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
