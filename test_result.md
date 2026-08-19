#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: >
  App CRM per Consulente Energetico e Networker (multi-utente, multi-tenant, italiano).
  Iterazione corrente (July 2026): aggiungere Gruppi contatti personalizzabili,
  messaggistica bulk WhatsApp/Telegram/SMS (deep-link sequenziale) + Email (SMTP Aruba),
  chat interna tra utenti del team con condivisione testo/audio/foto/file/link,
  pulsante Condividi (share nativo) su contatti/note/file.

backend:
  - task: "Groups CRUD (custom, per-tenant) + contact.group_ids filter"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added GroupIn/GroupUpdate models, endpoints GET/POST/PUT/DELETE /api/groups + GET /api/groups/{id}/contacts. Contact schema now has group_ids: List[str]. /api/contacts accepts ?group_id= filter. On group delete, references are pulled from contacts."

  - task: "SMTP config per-tenant + real bulk email"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Endpoints GET/PUT /api/smtp/config (password stripped from response), POST /api/smtp/test, POST /api/bulk/email (uses smtplib in threadpool, supports {nome}/{cognome} placeholders, group_id or contact_ids)."

  - task: "Bulk preview (WhatsApp/Telegram/SMS deep-link sequential)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "POST /api/bulk/preview returns ordered list of {contact_id, name, target, skip} for a given channel + group_id/contact_ids. Client uses this to open Linking.openURL sequentially."

  - task: "Team chat channels + messages (text/audio/photo/file/link)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Collections chat_channels + chat_messages. Endpoints for CRUD channels, list/send/delete messages. Direct 1-1 channels are deduped. Read tracking via read_map -> unread_count. Members validated against same tenant."

  - task: "Team roster endpoint for sub-users (/api/team/members)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "New endpoint returns all tenant users minus caller; both owner and sub-user can call it. Enables chat with owner from sub-user account."

  - task: "Contact vCard export"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "low"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "GET /api/contacts/{id}/vcard returns text/plain vCard 3.0. Used by frontend Share button."

frontend:
  - task: "Groups screens (list, create/edit modal, detail with bulk actions)"
    implemented: true
    working: "NA"
    file: "frontend/app/groups/index.tsx + [id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Groups list with color swatches. Group detail shows members + bulk buttons (WhatsApp, Telegram, SMS deep-link sequential + Email SMTP)."

  - task: "Contact form group multi-select + contacts list group filter"
    implemented: true
    working: "NA"
    file: "frontend/app/contact/new.tsx + (tabs)/contatti.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Contact new/edit form has a Gruppi pill multi-select (fetched from /api/groups). Contacts list has a horizontal group filter chips row that filters via ?group_id=. Long-press a group chip navigates to group detail."

  - task: "Team chat tab + create channel + chat detail with all media"
    implemented: true
    working: "NA"
    file: "frontend/app/(tabs)/chat.tsx + chat/new.tsx + chat/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Chat tab lists channels with last message + unread badge. New chat allows multi-select from /api/team/members. Chat detail supports text, audio (expo-audio recording), photo (camera/library), file (DocumentPicker), link. Polling 5s for new messages. Long-press bubble triggers native Share."

  - task: "SMTP config screen"
    implemented: true
    working: "NA"
    file: "frontend/app/smtp.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Form with presets (Aruba, Gmail, Outlook, Custom), save + optional test-send. Only owner can access. Empty password on GET preserves stored one on PUT."

  - task: "Native share buttons on contact/notes/files"
    implemented: true
    working: "NA"
    file: "frontend/src/share.ts + app/contact/[id].tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "shareText + shareDataUri helpers using expo-sharing (native) with web fallback. Share buttons: contact detail header (vCard text), each note item, each file item."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "V38I: Business card OCR endpoint (/api/ai/contact-from-card) — Gemini vision fix (was HTTP 502)"
    - "V38I: Profile branding endpoint (/api/auth/profile with company_name + company_logo_base64)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: "Implementata iterazione feature: Gruppi personalizzabili, bulk email via SMTP Aruba/Gmail configurato per tenant, bulk WhatsApp/Telegram/SMS via deep-link sequenziale, chat interna team con testo/audio/foto/file/link, pulsanti Condividi nativi. Backend include CRUD gruppi, endpoint /api/bulk/email, /api/bulk/preview, /api/chat/channels + /api/chat/channels/{id}/messages, /api/team/members, /api/smtp/config + /api/smtp/test, /api/contacts/{id}/vcard. Credenziali test in /app/memory/test_credentials.md (owner + sub-user). Test SMTP funzionerà solo se le credenziali reali vengono inserite (verificare solo la validazione degli errori: '400 Configurazione SMTP mancante')."
  - agent: "main"
    message: "Follow-up iterazione (V2): Aggiunte al backend: (a) Contact.additional_areas: List[str] per multi-area; (b) Settings.custom_areas per aree custom (id, name, color); (c) ContactNote ora supporta kind='video' (video_base64, video_mime); (d) Filtro /api/contacts?area=X ora matcha area primaria OR additional_areas OR aree custom. Frontend: contatto ristrutturato (Anagrafica Nome/Cognome subito, poi Aree di appartenenza multi-select con Nuova area, poi Gruppi con badge conferma, poi Dati anagrafici, ecc). Nella scheda contatto info tab mostra badge Aree + badge Gruppi. Note contatto: aggiunti pulsanti Registra video / Importa video. Etichetta 'Data di nascita / Compleanno'. Impostazioni: sezione 'Aree contatto personalizzate' + rinominata 'Aree merceologiche / Tipi di appuntamento'."
  - agent: "main"
    message: "Iterazione V3 (feedback puntuale): 1) Note contatto ora hanno anche pulsante 'Allega file' — kind='file' accettato dal backend con file_base64/file_name/file_mime/file_size. 2) Appuntamento form: pill multi-select per tipo appuntamento con 'Nuovo tipo' inline (crea + auto-seleziona) e long-press su tipi custom per Rinominare o Eliminare — persiste in Settings.custom_appointment_types. 3) Sezione Gruppi nel form contatto ora ha 'Nuovo gruppo' inline (crea + auto-assegna) e long-press su un gruppo per Rinominare/Colore/Eliminare. Testato manualmente via screenshot: creato tipo 'Consulenza serale' e gruppo 'Prospect 2026'. Backend: nessun endpoint nuovo, solo aggiornata la Literal di ContactNote.kind."
  - agent: "main"
    message: "Iterazione V4: (a) Backend: ContactNote ora ha campo 'category' Optional Literal['general','email','referral'] — retrocompatibile (default None). (b) Frontend Notes tab: chip selector categoria in cima (Nota semplice / Note generali / Nota email condivisibile / Referenza) — tutte le POST /notes inviano activeCategory. Il badge categoria appare sopra ogni nota (🗂️ Generali / 📧 Email / 👥 Referenza). (c) NUOVA sezione HOME 'Chat & Messaggi': barra ricerca, filtri per area (Tutti/Consulente Energetico/Networker/aree custom), lista di gruppi (con badge Bulk → dettaglio gruppo) e contatti (con pulsanti rapidi WhatsApp/Telegram/Email/Tel). Link 'Chat interna →' verso il tab Chat. Testato manualmente: filtro Networker mostra solo contatti network, ricerca 'Fran' filtra a Franco Rossi."
  - agent: "main"
    message: "Iterazione V5 (esiti appuntamento configurabili): (a) Backend Settings ora ha 'appointment_outcomes' pre-seedato con 6 esiti default (Contratto fatto, Nuovo cliente Consulente Energetico, Nuovo cliente Networker, Rinviato, Non interessato, Da ricontattare) — ognuno con id/name/color/icon/counts_as (usato per statistiche). Appointment ora ha 'outcome_ids: List[str]' (multi-select) e 'rescheduled_to: Optional[str]'. Reports endpoint restituisce anche 'outcomes' con count per outcome_id. Auto-imposta contract_signed=true quando un outcome con counts_as='contract' è selezionato. (b) Frontend appointment detail: quando marchi 'Segna come fatto', appare la sezione 'Esito dell'appuntamento' con multi-select degli esiti dinamici, pulsante '+ Nuovo esito' (modal con nome, colore, tipologia counts_as), long-press per Rinomina/Elimina. Se selezioni un esito con counts_as='rescheduled', appare alert 'Riprogramma appuntamento' che apre /appointment/new pre-compilato con i dati (title/area/location/notes/contact_id/is_phone) e link_dl 'rescheduled_to' sull'appuntamento originale al salvataggio del nuovo. (c) Report screen: nuova sezione 'Esiti appuntamenti' con barre progresso proporzionali e conteggi. Testato via curl+screenshot: creato appuntamento, marcato done=true, selezionati 2 esiti ('Contratto fatto' + 'Nuovo cliente Consulente Energetico') → contract_signed auto-true, report mostra outcomes count."
  - agent: "main"
    message: "Iterazione V6 (media DIRETTAMENTE nel form Nuovo contatto): Sotto ciascuno dei campi 'Nota email condivisibile' e 'Note generali' ora ci sono 4 pulsanti media: Scatta foto (arancione), Importa foto (viola), Allega file (celeste), Registra audio (arancione/rosso quando registra). Gli allegati vengono conservati in state locale (emailAttachments / generalAttachments) e mostrati come chip cliccabili con anteprima e X per rimuovere. Al salvataggio del contatto (submit), gli allegati vengono uploadati come /notes con category='email' o 'general' rispettivamente. Backend nessuna modifica (ContactNote già supporta category e tutti i kind). Testato via curl: upload di photo (email), audio (general), file (general) con category corretta."
  - agent: "main"
    message: "Iterazione V7 (Ricorrenze + esito appuntamento sempre visibile): (a) Backend Contact.anniversaries: List[{name, date}] retrocompatibile. (b) Frontend Nuovo contatto - sezione 'Dati anagrafici' ora include 'Ricorrenze importanti' sotto la data di nascita: nome ricorrenza + calendario data + trash icon, con pulsante 'Aggiungi ricorrenza' per creare multi ricorrenze (Data iscrizione, Anniversario matrimonio, ecc). Le ricorrenze vengono mostrate anche nella scheda contatto (Info tab) come InfoRow con icona calendario. (c) Frontend appointment detail: sezione 'Esito dell'appuntamento' ora sempre visibile (non solo quando done=true), con badge stato 'Da svolgere' (arancione) o 'Fatto' (verde) e hint chiaro. Pill esiti visibili ma disabilitate/opache se appuntamento non ancora fatto. Testato via curl: creato contatto con 2 anniversaries persistite e appointment pending mostra sezione esito disabilitata."

  - agent: "main"
    message: "ROADMAP CONFERMATA CON USER: (a) V8 = Sistema Inviti + Trial estensibile 30gg (owner genera link, invited registra con trial_expires_at, owner può estendere +7/+15/+30/libero, trial scaduto = readonly). Analisi mercato Italia 2026 fatta: prezzo consigliato € 12,90/mese (tra Bigin 7€ e Pipedrive 14-19€), positioning verticale Consulente Energetico + Networker. (b) V9 = 2FA authenticator app (TOTP - Google Authenticator/Authy) — richiede integration_playbook_expert_v2 per playbook standard: pyotp + qrcode + backup codes recovery + enable/disable flow. NON toccare senza playbook."
  - agent: "main"
    message: "Iterazione V8 completata (Sistema Inviti + Trial estensibile): (a) Backend: collection 'invites' con token unico, user model esteso con subscription_status/trial_expires_at/invited_by, endpoint POST/GET/DELETE /api/invites, GET pubblico /api/invites/{token}/info, POST pubblico /api/invites/{token}/register (crea tenant con trial 30gg), PUT /api/users/{uid}/extend-trial (owner-only, +N gg), GET /api/subscription/status. Helper _subscription_state calcola days_left e is_active. (b) Frontend: schermata /invitati (owner) con form nuovo invito + storico inviti con badge stato, pulsanti +7/+15/+30/Custom per estendere; schermata pubblica /invite/[token] con banner trial e form registrazione che restituisce token JWT e reindirizza a home; sulla Home: banner trial di scadenza (≤7gg giallo, ≤3gg rosso) + banner 'scaduto' + pulsante blu 'Invita cliente'; link in Impostazioni. Testato via curl: create/list/register/extend flow completo. Screenshot: home con banner + pagina invitati + pagina pubblica invito verificati."

  - agent: "main"
    message: "Iterazione V19 completata (2FA/TOTP + Trust 24h + PIN/Biometria): (a) Backend: aggiunti pyotp + qrcode + pillow. Nuovi endpoint (tutti sotto /api/auth): POST /2fa/setup/start (auth) → otpauth_uri + qr_code_data_url PNG + secret base32; POST /2fa/setup/confirm (auth) body {code} → attiva 2FA + restituisce 10 backup codes 'XXXXX-XXXXX' hashati (mostrati solo una volta); POST /login/2fa body {temp_token, code} → verifica TOTP o backup code, ritorna JWT+trust_expires_at; POST /2fa/disable body {password|code}; POST /2fa/regenerate-backup-codes body {code}; GET /2fa/status. Modificato POST /auth/login: se two_factor_enabled → ritorna {requires_2fa:true, temp_token} (temp JWT 10min). Login normale ora restituisce trust_expires_at = now+24h. Anti-replay TOTP tramite totp_last_code. UserOut include two_factor_enabled. (b) Frontend: nuovo /security screen (link in Profilo) con setup 2FA (QR, chiave manuale, conferma codice), display backup codes con copy, disable con password, regen con TOTP. Login flow: se requires_2fa → mostra prompt inline con input codice (6 cifre o backup) + verify. Aggiunto AppLock overlay (src/AppLock.tsx) integrato in _layout via LockGate: si attiva quando app-lock è ON e app rimane in background >5min OR al primo caricamento con trust valido. Sblocco con biometria (expo-local-authentication) o PIN 6 cifre (hashato client-side + salvato in SecureStore). Trust 24h salvato in SecureStore; alla scadenza forza logout completo (nuovo TOTP richiesto). (c) TESTATO: 18/18 pytest backend PASSATI (`/app/backend/tests/test_v19_two_factor.py`), inclusi replay prevention (TOTP + backup code), regen invalidation, disable/enable idempotenza. Frontend smoke test: login → prompt 2FA visibile con testID, wrong code → 'Codice 2FA non valido', security screen mostra QR + secret + 10 backup codes correttamente."

  - agent: "main"
    message: "Iterazione V37 completata (FAB Stack + AI Continuous Conversation + Wheel Picker + Multi-import Rubrica):
    (1) **FAB stack** — `AssistantChat.tsx` ora legge `useFabStack().present.calculator`; se il CalculatorFAB è presente sulla stessa schermata (report tab, contact notes/files tab, BillsSection), l'AssistantFAB shifta in alto di 72px per evitare overlap. Verificato visivamente su Report tab: entrambi visibili impilati verticalmente con gap corretto.
    (2) **Modalità Conversazione Continua** — Nuovo pulsante 'headset' nell'header del chat modal AI. Quando attivato: nasconde la input bar normale e mostra un `ConversationPanel` con orb animato (colore/icona in base alla fase: idle/listening/transcribing/thinking/speaking), pulsante Muto e Termina. State machine: ascolto (VAD via AudioContext+AnalyserNode + MediaRecorder, silence detect > 1.5s dopo speech) → trascrizione (POST /api/ai/transcribe) → pensiero (POST /api/assistant/chat) → parlata (TTS con onEnded callback) → torna ad ascoltare. Costanti: SILENCE_MS=1500, MAX_LISTEN_MS=30000, MIN_SPEECH_MS=300, RMS_THRESHOLD=0.02. Il pulsante Muto conserva lo stream/AudioContext (solo pausa listening loop), Termina fa cleanup completo. Forza la risposta vocale (`forceSpeak: true`) indipendentemente da `assistant_response_mode` dell'utente. Verificato: entrare in modalità mostra orb rosso pulsante 'In ascolto…' + due bottoni; mute mostra orb grigio 'Microfono muto' + bottone 'Riprendi'; termina ripristina input bar.
    (3) **Wheel Picker appuntamenti** — Nuovo componente cross-platform `/app/frontend/src/WheelPicker.tsx` (ScrollView + snapToInterval, ITEM_HEIGHT=44, VISIBLE_ITEMS=5) con `Wheel<T>` (opacity/scale fade distance-based, center row highlighted blue) + `WheelPickerModal<T>` (Annulla/Conferma). Integrato in `/app/frontend/app/appointment/new.tsx` sostituendo i pill selectors per **Durata prevista** (17 opzioni 5m→8h) e **Promemoria** (15 opzioni 0→1 settimana prima). Verificato: pulsanti 'hourglass 1 ora ›' e 'bell 15 min prima ›', tap apre modal con wheel scrollabile, centro evidenziato con testo blu grassetto.
    (4) **Import multiplo Rubrica** — `/app/frontend/app/contact/new.tsx` ora ha modal multi-select con: campo ricerca (nome/telefono), toggle 'Seleziona tutti (N)', checkbox per ogni contatto, contatore 'Selezionati: N', footer button dinamico ('Importa contatto' se N≤1, 'Crea N nuovi contatti' se N>1). Se single-select → compila form corrente via `fillFromContact` (comportamento originale preservato). Se multi-select → crea N contatti sequenzialmente via POST /api/contacts con progress {done}/{total}, poi naviga a `/(tabs)/contatti`. Note: solo su native Expo Go / build nativa (Contacts API non disponibile in web).
    (5) TestIDs aggiunti: `assistant-conv-toggle`, `assistant-conv-panel`, `assistant-conv-mute`, `assistant-conv-end`, `ap-duration-picker`, `ap-reminder-picker`, `ap-duration-modal-confirm`, `ap-reminder-modal-confirm`, `phone-import-search`, `phone-import-select-all`, `phone-import-row-{id}`, `phone-import-confirm`."

  - agent: "testing"
    message: "V38I backend testing complete — 10/10 PASSED. (a) OCR endpoint `/api/ai/contact-from-card` now returns 200 with parsed contact from synthetic biz card (Gemini extracts nome/cognome/ruolo/azienda/email/telefono/website correctly). Empty base64 → 400, no auth → 401/403, never 502. (b) Branding endpoints round-trip: PUT /auth/profile with company_name+company_logo_base64 persists, GET /auth/me returns them. Empty string clears logo. additional_emails still works. (c) Regressions: login returns {token,user,trust_expires_at}, /contacts sorted DESC by created_at. **CRITICAL FIX applied by testing agent**: main agent used `ImageContent(image_url=data_url)` but emergentintegrations expects `ImageContent(image_base64=bare_b64)` — every call was silently failing with TypeError caught by the 3-model fallback loop and returning 422. Fixed at server.py:3082-3109 by stripping data URL prefix and passing bare base64. Verified end-to-end. Pytest at /app/backend/tests/test_v38i_ocr_branding.py. Report /app/test_reports/iteration_47.json."

  - agent: "main"
    message: "Iterazione V38K (retry QR reader post-feedback V38J): l'utente ha segnalato che il lettore QR nel preview web/expo Go non riusciva a leggere i QR code nonostante il fix V38J. Refactor completo di `QRScannerModal.tsx`: (1) **Modern native scanner (iOS 16+ / Android Google Code Scanner)**: se `CameraView.isModernBarcodeScannerAvailable` è true, si usa `CameraView.launchScanner({barcodeTypes, isGuidanceEnabled, isPinchToZoomEnabled, isHighlightingEnabled})` che apre il DataScannerViewController nativo (lo stesso della fotocamera di sistema iOS) — gestisce autofocus perfettamente sui biglietti da visita. Il modal RN viene bypassato (`return null`) quando il modern scanner è disponibile. Listener via `CameraView.onModernBarcodeScanned` sottoscritto prima di launchScanner, `dismissScanner` chiamato dopo il match. (2) **Fallback CameraView** (Android < 24 / iOS < 16 / Expo Go): `autofocus='on'`, `zoom={0}` iniziale (rimosso il 0.03 che poteva ridurre il FOV senza aiutare il focus), `active={visible}` per liberare la camera quando il modal chiude, `barcodeTypes` esteso a qr/datamatrix/pdf417/aztec/ean13/code128. Aggiunto **tap-to-focus** via Pressable overlay: tap sullo schermo forza il remount del CameraView (nuovo key) → nuovo ciclo di autofocus. Zoom bar spostata a bottom:90 (0-50% con step 5%), torch toggleabile. (3) **Fallback universale 'Scegli QR dalla galleria'** (blue pulsante a bottom:24, z-index:20): apre ImagePicker su native e decodifica via `scanFromURLAsync` di expo-camera; su web apre input file e decodifica via BarcodeDetector.detect(HTMLImageElement). Risolve il caso in cui il live autofocus non riesce — l'utente può scattare una foto del QR con la fotocamera nativa e caricarla. TestIDs: `qr-tap-focus`, `qr-from-gallery` (nuovo), più esistenti. Screenshot verificato: modal apre correttamente, pulsante 'Scegli QR dalla galleria' visibile sopra warning browser. NOTA IMPORTANTE: la fix del focus native (launchScanner) NON è testabile in preview web / Expo Go pre-build — richiede una build iOS/Android generata via Publish. Il preview web mostrerà solo la fallback UI + warning 'Il tuo browser non supporta il rilevamento QR'."
