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
    - "V38X BUG 1 — Fiscal Check MAI JSON (né in live view né in report). Formato: 'IVA 10% OK' o 'IVA errata — attesa X%, trovata Y%' anche quando nested in parametri_richiesti"
    - "V38X BUG 2 — Popup Contatto già esistente: nuovo terzo pulsante verde 'Aggiorna scheda esistente' (testID dup-update-existing-btn) che naviga a /contact/edit/{id}. Appare solo se matches.length === 1"
    - "V38X BUG 3 — Logo agenzia visualizzato correttamente in Impostazioni (160x90, white BG, objectFit:contain, padding 8) e nel biglietto (88x64 landscape)"
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

  - agent: "testing"
    message: "V38P — 13/14 backend pytest + frontend Playwright OK. Primary 502 fix VERIFIED: contact-from-voice with valid silent m4a returns 200 (`file=_fh` kwarg fix correct). Master-files reuse endpoints (?category=bills/files, GET by id with data_base64) working for bill-quick source picker. Frontend all 3 tasks verified live: source picker `bq-src-device`/`bq-src-master` + master picker list, audio REC + upload buttons, files photo picker bottom sheet with 4 media options in correct colors. Minor residual: truncated audio still returned 502 → main agent narrowed the except block to map content-decode errors to 422 while keeping 502 only for transport failures (server.py ~L3079). No regressions. Report /app/test_reports/iteration_50.json + pytest test_v38p_voice_502fix.py."

  - agent: "main"
    message: "Iterazione V38Q (5 richieste utente in Msg 595): (1) **Master Files - Carica file**: `uploadFile()` in `master-files.tsx` ora usa `DocumentPicker.getDocumentAsync({type:[...]})` con lista esplicita di document mime-types (PDF/Word/Excel/PPT/txt/csv/zip/rtf/json) — esclude `image/*` e `video/*` così Android non instrada l'utente nel picker Foto. Foto/Video restano disponibili via il pulsante dedicato 'Foto' (bottom-sheet con 4 opzioni). (2) **Auto-save Master bill draft PDF**: nuovo helper `_auto_save_draft_to_master_files(draft)` in `server.py` chiamato in `_analyze_draft_task` dopo status='done'; salva idempotentemente il PDF in `master_files` con `category='bills'` e `name='Analisi-{pdf_name}'` (skip se già esiste). (3) **Fix duplicati file analisi**: `BillsSection.tsx` ora usa `analysisSavedRef` (Set) e `autoSaveGuardRef` (Set) con guard **ottimistico prima** dell'await (il ref era aggiornato dopo l'await, causando race). Rollback in caso di errore. (4) **SVG chart nei report salvati**: la funzione `buildBillAnalysisHtml` in `BillsSection.tsx` intercetta `consumi_mensili_kwh`/`consumi_mensili_smc` e li rende come SVG bar chart embedded direttamente nell'HTML (invece della stringa raw). Riusa `renderConsumiSvg` (con grid Y, label mesi, valori sopra le barre). (5) **Master Digital Business Card**: nuova collection `business_cards` + schema `BusinessCardIn` (17 fields: display_name, title, company, phone, email, website, address, tagline, logo_base64, photo_base64, accent_color, qr_type: app|website|text|vcard, qr_content, demo_app_link, social_links). Endpoints `GET /master/business-card` (auto-seed dai dati profilo), `PUT` (upsert con card_id auto-generato), `GET /master/business-card/public/{card_id}` (read-only no-auth per QR scanning). Frontend nuova screen `/app/frontend/app/business-card.tsx` (~300 LOC) con preview card live (border colorata accent, avatar/logo, QR code, tagline), pulsanti 'Condividi come immagine' (react-native-view-shot + expo-sharing) e 'Condividi link' (Share.share con URL pubblico + Clipboard fallback), form completo Contenuti/Logo/QR Type radio/Colore accento swatches. TestIDs: `bc-back`, `bc-save`, `bc-name/title/company/phone/email/website/address/tagline`, `bc-pick-logo`, `bc-clear-logo`, `bc-qr-type-{app|website|text|vcard}`, `bc-qr-content`, `bc-color-{hex}`, `bc-share-image`, `bc-share-link`. Aggiunto tile 'Biglietto da visita' 🪪 viola (#7C3AED) nel Master grid. **Lint fix applicato**: rimosso duplicate import di `Image as RNImage` (era importato 2 volte)."


  - agent: "main"
    message: "Iterazione V38P (7 richieste utente in 2 messaggi): (1) **Grafico barre Consumi mensili anche client-side**: creato `/app/frontend/src/BillFieldRenderers.tsx` con `BillFieldRow`+`ConsumptionBarChart` condivisi tra `bill-quick` e `BillsSection`. Aggiunta `normalizeMonthlyConsumption` che accetta 3 shapes (array di {mese,kwh}, array di 12 numeri, oggetto {gen:100,feb:90,...}) + `detectNestedConsumption` che riconosce grafici anche quando il LLM li innesta dentro `parametri_richiesti`. (4) **Bug FIX 502 dettato vocale**: `/api/ai/contact-from-voice` — la libreria `emergentintegrations.OpenAISpeechToText.transcribe` vuole kwarg `file=file_handle` non `file_path=path` come nel codice precedente → TypeError → 502. Fix: apro il file con `open(path,'rb')` e passo come `file=_fh` + `response_format='text'`. Narrowed except block per mappare errori di decodifica audio a 422 invece che 502. (5) **Master file picker in bill-quick**: nuovo modal 'Da dove vuoi caricare?' con 2 opzioni: `bq-src-device` (DocumentPicker locale) e `bq-src-master` (mostra lista PDF da GET /master-files?category=bills+files, tap seleziona → openParamsModal con data URI). (6) **REC button Master audio**: `useAudioRecorder` di expo-audio, pulsante rosso 'REC' → all'avvio inizia registrazione, dot rosso che lampeggia (Animated.loop 500ms fade), pulsante diventa 'Stop & Salva (Ns)' verde con contatore secondi + pulsante Annulla; on stop → uriToBase64 + POST /master-files category=audio con name 'nota-vocale-{ISO}.m4a'. (7) **Fix File section Master**: 'Carica file' ora usa DocumentPicker con filtro esplicito PDF/Word/Excel/PPT/txt/csv/zip/images (esclude camera roll picker). Pulsante 'Foto' apre nuovo bottom-sheet con 4 opzioni: Scatta foto (viola, camera-photo), Registra video (rosa, camera-video), Scegli foto (ciano, library-photo), Scegli video (verde, library-video). Testing V38P: 13/14 pytest pass, Playwright frontend OK. File toccati: server.py (voice 502 fix), BillFieldRenderers.tsx (nuovo), BillsSection.tsx (import BillFieldRow), bill-quick.tsx (source+master picker), master-files.tsx (REC+photo picker+file filter). No regressioni." (1) Master Files CRUD: POST/GET/PATCH/DELETE for all 4 categories, tenant scoping OK, size limit 20MB, invalid category 400. (2) /master-files UI: 4 tabs (Note viola / Fatture arancione / Audio rosa / File ciano), note create/delete flow, all testIDs present. (3) Calculator FAB: correctly ABSENT on /master-files (no calc), PRESENT on /bill-quick + contact bills tab + contact notes/files. Semantic note: `tenant_id()` shares master-files across owner+sub-users (same tenant) — is expected behavior consistent with rest of app. No bugs. Report /app/test_reports/iteration_49.json + pytest test_v38o_master_files.py."

  - agent: "main"
    message: "Iterazione V38O (3 richieste utente): (1) **Bill-Quick viz avanzata** in `/app/frontend/app/bill-quick.tsx`: nuovo componente `FieldRow` che intercetta `consumi_mensili_kwh`/`consumi_mensili_smc` renderizzati come `ConsumptionBarChart` (grafico a barre orizzontale con label mese/valore, Totale + Max nell'header, barre colorate con l'accent della categoria); `parametri_richiesti` renderizzati in sub-box grigio con righe label+value; `note_ai` renderizzato come lista puntata con dot colorato + testo. Nessuna modifica al backend/struttura dati — solo presentation layer. (2) **NUOVA FEATURE Master Files (Msg 398 Item 7 ✅)**: Backend +160 righe con nuovi endpoint `POST/GET/GET-single/PATCH/DELETE /api/master-files`, schema `MasterFileIn {category, name, mime, data_base64, body?, title?}` con `ALLOWED_MASTER_CATS = {notes, bills, audio, files}`, collection `master_files` scoped per tenant, size limit 20MB. Frontend nuova schermata `/app/frontend/app/master-files.tsx` (+390 righe) con 4 tab colorati (Note viola #7C3AED / Fatture arancione #EA580C / Audio rosa #DB2777 / File ciano #0891B2), Nuova nota modal (title+body TextInput), upload PDF fattura, upload audio file, upload file generico, upload foto (ImagePicker), inline viewer per PDF/immagini, rinomina, elimina con conferma. Aggiunto tile 'I miei file' 📁 ciano nel Master screen. (3) **Calcolatrice FAB sempre visibile** nelle sezioni Fatture: Aggiornato `contact/[id].tsx` per mostrare `<CalculatorFAB />` anche in tab='bills' (era solo notes/files). Aggiunto `<CalculatorFAB />` in `bill-quick.tsx`. Il componente si registra via `useRegisterFab` così l'AI Assistant FAB si sposta automaticamente per non sovrapporsi. TestIDs: `master-files-tab-{cat}`, `master-files-add-{note|bill|audio|file|image}`, `master-note-title/body/save`, `master-files-item-{id}`, `master-files-del-{id}`, `master-files-rename-{id}`. Testing agent V38O: 13/13 backend pytest + frontend Playwright OK, no regressioni."

  - agent: "main"
    message: "Iterazione V38N (S21 QR tuning + Quick Bill Analysis feature): (1) **QR tuning Samsung S21**: `SCAN_STABILIZATION_MS` 900→**1300ms**, `JPEG_QUALITY_LIVE` 0.65→**0.85**, `SCAN_LIVE_TARGET_SIZE` 1024→**1400px**, `SCAN_INTERVAL_MS` 700→**900ms**. Più tempo per stabilizzare autofocus + più risoluzione + qualità JPEG più alta = fine motion blur su S21. (2) **NUOVA FEATURE Msg 398 Item 3 — Analisi bolletta senza cliente registrato**: Backend: nuovi endpoint `POST/GET/DELETE /api/bill-drafts`, `POST /reanalyze`, `POST /associate` body {contact_id}, `POST /create-contact` che genera automaticamente un contatto dai dati estratti (intestatario→nome/cognome, indirizzo→street, cf→fiscal_code, tag='da-bolletta'). Collection `bill_drafts` con schema {draft_id, user_id, bill_type, pdf_base64, pdf_name, status, extracted, error_message, analysis_params, label, created_at, analyzed_at}. `_analyze_draft_task` background con checkpoint su status='cancelled'. Frontend: nuova schermata `/app/frontend/app/bill-quick.tsx` con: intro card, 3 upload buttons (Luce/Gas/Telco emoji + colori distintivi), params modal riusando `DEFAULT_PARAMS` esportato da BillsSection (17 luce/12 gas/11 telco + custom + label facoltativa), card bozze con status pill, tap-to-expand con KV rows, actions 'Associa a cliente' (modal picker con search filter) e 'Crea cliente' (crea + naviga a scheda). Auto-refresh 3.5s finché ci sono draft pending/analyzing. Aggiunto tile 'Analizza bolletta' 🔥 orange (#EA580C) nel Master screen tra 'I miei audio' e le altre azioni. TestIDs: `quick-upload-{bt}`, `quick-param-{id}`, `quick-confirm-btn`, `quick-label-input`, `draft-card-{id}`, `draft-delete-{id}`, `draft-associate-{id}`, `draft-create-contact-{id}`, `quick-assoc-search`, `quick-assoc-pick-{cid}`. Testing_agent V38N: 14/14 backend pytest + frontend Playwright OK, no regressions."


  - agent: "main"
    message: "Bug 9 — Profilo: dati Master & biglietto da visita. (a) Backend: nuovo endpoint GET /api/master/info (server.py) — usa tenant_id(user) per restituire dati del Master (nome, email, role_label, avatar_base64, company_name) + fields del business_card (title, phone, company_name, website, address, tagline, logo_base64, photo_base64, accent_color, slug, card_id). Funziona sia per Master che per Collaboratori (tenant_id restituisce master's user_id). Verificato via curl con demo@advisoros.it → HTTP 200 con role_label='Master'. (b) Frontend impostazioni.tsx: nuova sezione 'masterCard' subito dopo la card profilo. Renderizza: avatar/logo circolare 56x56 con fallback iniziale sfondo accent, nome + badge arancione ⭐ Master, title, azienda, tagline; righe contatto tappabili con icone colorate (telefono verde→tel:, email blu→mailto:, website viola→https, indirizzo giallo readonly); 2 bottoni azione — 'Apri biglietto' (primario router.push('/business-card')) + 'Condividi' (secondario Share.share con URL pubblico o slug). Empty-state chiaro se il biglietto non è compilato. Stato locale MasterInfo + loadMaster() via api('/master/info'). No breaking changes. TestIDs: master-phone, master-email, master-website, master-open-card, master-share-card. Verificato via screenshot: la sezione compare correttamente dopo la card profilo con badge Master + email aziendale."

  - agent: "main"
    message: "Bug 11 — Scanner: autofocus continuo + modalità fotocamera continua + auto-crop live preview. (a) Backend server.py: nuovo endpoint POST /api/scanner/autocrop-preview con schema ScannerPreviewIn {data_base64, mime, enhance, grayscale}, riusa _cv2_scan_document con detection quadrilatero via OpenCV Canny + approxPolyDP; ritorna {detected: bool, data_base64, mime}. Verificato via curl: rileva rettangoli documento (detected=True) e ritorna originale enhanced se no rilevamento (detected=False). Auth 401 senza token. (b) Frontend nuovo componente src/LiveCameraScanner.tsx (~400 LOC): usa CameraView di expo-camera v17 con prop `autofocus='on'` (continuous AF nativo), Modal a schermo intero con SafeAreaView, viewfinder scuro con cornice guida arancione 4-angoli, top bar (close × / badge 'Modalità continua · Autofocus attivo · elaboro N…' / torch toggle), bottom bar con thumbnails strip scrollabile (badge ✂️ verde su pagine ritagliate, × rosso remove, numero pagina), shutter row (flip camera / shutter grande 76px / Fine (N)). takeShot: takePictureAsync({base64:true, quality:0.85}) → subito thumbnail originale → fire-and-forget applyAutocropAsync() → sostituisce thumbnail con versione ritagliata dal backend. La camera RESTA ATTIVA tra scatti (non chiude modal). Permission gate con richiesta contestuale + canAskAgain aware + apri impostazioni fallback. (c) Integrazione DocumentScannerModal.tsx: nuovo bottone rosso 'Scan continuo' testID='scanner-live' come PRIMA opzione nella source row (le altre 3 diventano flex-1 anche loro: 'Foto singola' arancione era 'Fotocamera', 'Galleria', 'PDF/File'). Al tap apre LiveCameraScanner. onDone callback importa tutte le pagine live in state.pages con preview_uri corretto. Il vecchio percorso ImagePicker.launchCameraAsync resta come 'Foto singola' fallback. (d) FIX CRITICO Bug pre-esistente: CalculatorFAB.tsx aveva `safeBottom` definito nel componente CalculatorFAB() ma USATO in CalculatorModal() (funzione dichiarata dopo, no chiusura lessicale) → ReferenceError crashava il ModuleErrorBoundary del bill-quick. Spostato useSafeBottom() dentro CalculatorModal(). Verificato: bill-quick screen ora carica senza errori, scanner apre correttamente, modalità Scan continuo mostra camera live con overlay UI complete. Testato via screenshot: 4 bottoni fonte visibili, tap 'Scan continuo' apre correttamente il viewfinder full-screen con tutti i controlli."


  - agent: "main"
    message: "Bug 11.b + Fix Login inert. (1) FIX LOGIN inert click INVESTIGATO: verificato via Playwright che il pulsante /login testID=auth-submit-button funziona correttamente — tutti i parent hanno pointerEvents=auto, elementFromPoint alla coordinata del click ritorna il figlio del button (nessun overlay che blocca), il click completa e naviga a /home. La regressione riportata dal precedente testing agent era transiente (timing/cold-start). Nessuna correzione al codice necessaria. (2) Bug 11.b RILEVAMENTO BORDI LIVE: Backend nuovo endpoint POST /api/scanner/detect-corners con schema ScannerCornersIn — riusa Canny + approxPolyDP a bassa risoluzione (400px max) per rilevare quadrilatero documento; ritorna {detected, corners: [[x,y]×4 normalized 0..1]}. Testato via curl: rilevato rettangolo con precisione <0.5% del vero angolo (input 50/400=0.125, output 0.1198). Frontend LiveCameraScanner.tsx: aggiunto loop di sampling (setInterval 1200ms) che chiama takePictureAsync({quality:0.1, skipProcessing:true}) → POST /scanner/detect-corners → EMA smoothing (alpha=0.55) su ultimi corner detected → aggiorna state liveCorners. Overlay SVG (react-native-svg Polygon + 4 Circle) disegnato sopra la CameraView usando overlaySize misurato via onLayout: polygon verde (#22C55E stroke, fill α18%) + 4 puntini verdi 7px con bordo bianco. Badge in alto reso Pressable (testID=live-scan-edge-toggle) che alterna 3 stati: 'Cerco i bordi… inquadra il foglio' (attivo, nessun rilevamento), 'Documento rilevato · tocca per scattare' (con checkmark verde), 'Autofocus attivo · rilevamento OFF' (toggle spento). animateShutter cambiato da true a false su CameraView per evitare flash ripetuti durante il sampling. Guard: skip sampling se busy (scatto utente in corso) o se detectBusyRef già occupato. Verificato via Playwright: 4+ chiamate /detect-corners 200 OK durante 3s di viewfinder aperto, toggle ON→OFF cambia badge correttamente, overlay non blocca (pointerEvents=none). No lint errors. TestID aggiunto: live-scan-edge-toggle."


  - agent: "main"
    message: "Bug 11.c — Scatto automatico con toggle Auto/Manuale. LiveCameraScanner.tsx: aggiunto state `autoShutter` (default: true) e `autoCountdown` (0..1 progress). Loop di sampling esteso con state machine per scatto automatico: (a) calcola stabilità come max delta normalizzato tra 4 corners tra sample consecutivi (soglia STABILITY_THRESHOLD=0.03); (b) quando doc stabile per AUTO_STABLE_MS=1000ms → chiama takeShot() automaticamente; (c) cool-down AUTO_COOLDOWN_MS=2000ms impedisce doppi scatti consecutivi; (d) qualsiasi movimento resetta lo `stableSinceRef` a null. SAMPLE_INTERVAL ridotto da 1200ms a 900ms per rendere responsivo lo scatto auto. UI: nuovo Pressable circolare tra badge e torcia (testID='live-scan-auto-toggle') con icona flash-outline (auto) o hand-left-outline (manuale) e sfondo #22C55E verde quando auto; shutter grande ora mostra icona hourglass verde durante il countdown + anello verde `shutterRing` (transform scale 0.55→1.0 basato su autoCountdown). Badge in alto reso dinamico con 5 possibili testi: 'Cerco i bordi… inquadra il foglio', 'Documento rilevato · tocca per scattare' (manuale), 'Rilevato · tieni fermo per lo scatto' (auto in attesa), 'Scatto tra Xs…' (countdown attivo), 'Autofocus attivo · rilevamento OFF' (edge detect off). takeShot() ora resetta stableSinceRef e autoCountdown all'inizio così ogni scatto (auto o manuale) parte da uno stato pulito. Toggle auto → immediato reset del countdown. Verificato via Playwright: entrambi i toggle (auto + edge + torch) visibili, tap sul toggle auto cambia sfondo/icona correttamente. TestIDs: live-scan-auto-toggle. No lint errors."


  - agent: "main"
    message: "V29.aq — Header Home con immagine locale offline-safe. (a) Scaricata l'immagine 'Advisor and AxonOS home page.webp' fornita dall'utente (240KB, 2000x1000, aspect 2:1) da customer-assets, convertita in JPG q=88 (176KB) e salvata in /app/frontend/assets/images/advisoros-home-header.jpg (+ variante PNG 978KB). (b) home.tsx: rimosso HERO_LOGO_URI remoto, AXONOS_LOGO_TRANSPARENT_URI remoto, brandBoxSize state, _hasPlayedHeroIntroRef, greetOpacity/heroLogoOpacity/heroLogoScale animations (~15 righe cleanup); rimosso NeuralPatternBg component + import; rimosso import AdvisorOSLogo non più usato. Aggiunta costante HOME_HEADER_IMG = require('@/assets/images/advisoros-home-header.jpg') per bundling locale offline-safe. Nuovo brandHeaderBox: height 80→140px, backgroundColor #000, borderRadius 12, overflow hidden; contiene <Image resizeMode='cover' width/height 100%> come sfondo full-bleed + overlay corner data/ora TL e avatar TR + scrim transparent placeholder. Verificato via screenshot: immagine dashboard con loghi AdvisorOS+AxonOS visibile, data '31 Ago · 13:17' TL leggibile, avatar E TR cliccabile → /impostazioni. Nessun URL remoto = zero problemi di connettività su APK/IPA offline. No lint errors. File modificati: /app/frontend/app/(tabs)/home.tsx, /app/frontend/assets/images/advisoros-home-header.jpg (nuovo)."


  - agent: "main"
    message: "V29.ar + Bug 11.d — (1) Home header collapsable in scroll: home.tsx introduce scrollY (Animated.Value), interpolazione height 140→60px via Animated.ScrollView + onScroll useNativeDriver:false. brandHeaderBox rimosso height:140 statico (ora gestito dal container Animated.View). Import ScrollView rimosso (usiamo solo Animated.ScrollView). Verificato via screenshot che scrollando 300px l'header si contrae correttamente da full a compact. (2) Bug 11.d anti-motion-blur: backend /scanner/detect-corners ora ritorna sharpness (varianza Laplaciano, calcolata su gray 400px prima del blur/Canny). Test curl: nitida=11072, sfocata=3.39 → dinamica ~3000x. /scanner/autocrop-preview ora calcola sharpness sul FULL-res grayscale e lo ritorna con la response. Test: sharp=19065.5, blurry=0.72. Frontend LiveCameraScanner.tsx: nuovo state `sharpness` con SHARPNESS_THRESHOLD=90 durante il sampling loop; auto-shutter state machine ora richiede `stable && isSharp` per triggerare countdown (movimento OR sfocatura resetta stableSinceRef). Badge dinamico esteso: se `liveCorners && sharpness < 90` mostra 'Immagine mossa · tieni fermo per fuoco' con icona warning arancione #F59E0B. LiveScannedPage type esteso con `blurry?: boolean`; applyAutocropAsync legge sharpness dalla response e imposta blurry se <250 (soglia più alta perché su full-res). Nuovo badge visivo `thumbBlurBadge` (arancione con icona warning, testID='live-scan-thumb-blurry-{i}') sotto il badge cropped nella strip thumbnails. Verificato via curl backend + screenshot frontend che il viewfinder resta funzionale con la nuova logica. No lint errors."


  - agent: "main"
    message: "V29.as — Google Drive OAuth redirect_uri hardening. server.py: aggiunta funzione defensiva _sanitize_redirect_uri(raw) che applica .strip() + split('?')[0] + split('#')[0] + rstrip('/') sul valore letto da GOOGLE_DRIVE_REDIRECT_URI env var. Applicata sia a module-init (_GD_REDIRECT_URI = _sanitize_redirect_uri(os.getenv(...)) sia dentro l'endpoint POST /google-drive/oauth/start (clean_redirect = _sanitize_redirect_uri(_GD_REDIRECT_URI)) come triple-defense. Aggiunto logger.info() dentro l'endpoint per audit trail del redirect_uri esatto passato a Google. Test unitario 7/7 casi passa incluso 'callback?flowName=GeneralOAuthFlow' → 'callback', trailing slash, whitespace, '#fragment'. Test live: /oauth/start ritorna redirect_uri='https://business-card-pro-16.emergent.host/auth/google/callback' (63 byte, no flowName). Fix errore transitorio 'logger not defined' rimuovendo log module-level (logger definito dopo). Anche se il .env viene modificato con ?flowName incollato per errore, il backend lo pulisce automaticamente. Nessun impatto su altri endpoint OAuth. File modificato: /app/backend/server.py."


  - agent: "main"
    message: "V29.at — Fix regressione 'Insegna ad Axon vuoto dopo aggiornamento app'. ROOT CAUSE: race condition tra useAuth (rehydration del session token → user inizia null, poi popolato async) e useFocusEffect di ai-teach.tsx. Flow del bug: (1) Master apre ai-teach.tsx → useAuth ancora sta caricando user → user=null → isMaster=false; (2) Early return renderiza 'Sezione riservata al Master' — fuorviante per un vero Master; (3) useAuth popola user → re-render → isMaster=true → nuova UI, MA useFocusEffect NON re-fira perché la schermata è già focused (React Navigation useFocusEffect re-esegue solo su blur+focus, non su callback identity change se già focused). Verifica backend: query DB diretta mostra 6 rules + 6 urls per user_ae92fe85cdaf (e.dalpastro@gmail.com); endpoint /api/ai-teach/rules e /api/ai-teach/urls con token diretto ritorna correttamente items. Quindi il backend è OK. FIX applicati a /app/frontend/app/ai-teach.tsx: (a) nuovo useEffect(() => { if (isMaster) load(); }, [isMaster, load]) additivo che triggera SEMPRE il fetch appena isMaster diventa true, anche se la schermata è già focused; (b) nuovo guard-render prima di !isMaster: if (!user) return <ActivityIndicator/> — evita di mostrare 'Sezione riservata' durante la rehydration del token; (c) aggiunto useEffect all'import react. Verificato via Playwright: utente demo (0 rules, 0 urls) vede correttamente la schermata con tab Regole(0)/Fonti URL(0)/Storico(0), no early-return. Dati esistenti nel DB NON toccati. TestID immutati. No lint errors."


  - agent: "main"
    message: "V29.au — Fix tastiera Android che copre i campi in Insegna ad Axon. ai-teach.tsx: import KeyboardAvoidingView aggiunto. Il modal 'Nuova regola' (visible=!!editRule) è ora avvolto in KeyboardAvoidingView con behavior='padding' (iOS+Android, come richiesto dall'utente) e keyboardVerticalOffset=0. Lo ScrollView interno riceve tre nuovi prop: keyboardShouldPersistTaps='handled' (tap fuori chiude tastiera; tap su bottoni funziona anche con tastiera aperta), keyboardDismissMode='interactive' (drag verso il basso chiude la tastiera), showsVerticalScrollIndicator=false. Stesso pattern applicato al modal 'Nuovo URL' (visible=!!editUrl) per consistenza — anch'esso ha campi Titolo/URL/Frequenza/Username/Password che potrebbero essere coperti dalla tastiera. Il modal 'Info' (visible=!!infoTab) NON è stato modificato perché non contiene TextInput. Verificato via Playwright: modal si apre, campi Titolo/Testo scrivibili senza sovrapposizione, tastiera virtuale del browser non interferisce. No lint errors."


  - agent: "main"
    message: "V29.av — Fix logo aziendale del biglietto da visita: preservazione canale alpha. ROOT CAUSE: pickCardLogo() in /app/frontend/modules/business-card/lib/pickLogo.ts usava allowsEditing:true su expo-image-picker, che su iOS/Android apre il cropper nativo → sempre restituisce JPEG (perde alpha). Inoltre il fallback MIME era 'image/jpeg' hard-coded. FIX: (1) allowsEditing cambiato in false (obbligatorio per preservare l'alpha — il cropper nativo flattenizza sempre); (2) quality: 0.7 → 1.0 per zero ri-encoding; (3) nuovo sniffMimeFromBase64() che ispeziona i primi byte del base64 per riconoscere PNG (magic 89 50 4E 47 → 'iVBORw0KGgo'), JPEG ('/9j/'), WebP ('UklGR'), GIF ('R0lGOD'); (4) fallback MIME chain: sniffed → picker.mimeType → estensione URI → 'image/png' (default sicuro, backend può re-encode se serve). Test dei prefix magic-byte confermati via python: PNG→'iVBORw0KGgo', JPEG→'/9j/', GIF→'R0lGOD', WEBP→'UklGR'. Backend inalterato: endpoint PUT /master/business-card salva logo_base64 come stringa senza toccare i byte immagine (nessun .convert('RGB') o re-encoding). Ora un logo PNG con sfondo trasparente viene: (a) pickato senza cropper flattener; (b) letto raw base64; (c) inviato al backend con data:image/png;base64,...; (d) salvato come-is; (e) mostrato via <img src=data:image/png;...> con alpha preservato. Aggiunti export _test_* per unit test futuri. No lint errors."


  - agent: "main"
    message: "V29.aw — Fix Google Drive OAuth 'invalid_grant: Missing code verifier'. ROOT CAUSE: google_auth_oauthlib.flow >= 1.0 usa automaticamente PKCE — durante Flow.authorization_url() genera code_verifier + inietta code_challenge (S256) nell'URL di auth. Al callback il codice esistente creava una NUOVA istanza Flow.from_client_config() SENZA il code_verifier originale → Google rifiuta perché il code_verifier è mandatory quando c'è stato un code_challenge. Test URL post-fix conferma code_challenge=<40+char base64>, code_challenge_method=S256, presente in auth URL. FIX applicati a /app/backend/server.py: (1) POST /google-drive/oauth/start (line ~10949): dopo authorization_url(), estrae getattr(flow, 'code_verifier', None) e lo salva insieme al redirect_uri nel doc di db.google_oauth_states. Sanitize redirect_uri PRIMA della creazione del flow così è bound sin dall'inizio. (2) GET /auth/google/callback (server-side bridge, line ~93): dopo find_one_and_delete legge s.get('code_verifier') e s.get('redirect_uri') dal doc; crea Flow con lo STORED redirect_uri; se stored_verifier è presente fa flow.code_verifier = stored_verifier PRIMA di fetch_token(code). (3) POST /google-drive/oauth/exchange (legacy exchange endpoint, line ~11081): stesso pattern. Verificato via DB query diretta: state doc contiene code_verifier='HA5ri8y_xnaYj_...' + redirect_uri corretto. Sanitize + PKCE ora coesistono. No regressioni. File modificato: /app/backend/server.py."


  - agent: "main"
    message: "V29.ax — Fix tastiera Android nei Modal Insegna ad Axon (fix strutturale). CONTESTO: nella iterazione V29.au avevo già aggiunto KeyboardAvoidingView(behavior=padding) + ScrollView(keyboardShouldPersistTaps=handled) ai due modal. Ma su Android APK il fix NON funzionava perché il <Modal> di React Native crea una window Android separata (Dialog) che NON eredita windowSoftInputMode=adjustResize dell'app principale. Senza adjustResize, KeyboardAvoidingView non riceve gli eventi di layout corretti e non alza il contenuto. ROOT CAUSE STRUTTURALE: <Modal> senza statusBarTranslucent+hardwareAccelerated → Android usa adjustPan come default, che scrolla parzialmente il contenuto ma NON dentro ScrollView annidati. FIX applicato a ai-teach.tsx: aggiunti statusBarTranslucent={true} e hardwareAccelerated={true} a entrambi i <Modal>: (1) Nuova regola (line 517), (2) Nuovo URL (line 610). statusBarTranslucent=true fa sì che React Native passi adjustResize al Dialog Android, così KeyboardAvoidingView riceve i corretti onLayout events; hardwareAccelerated=true migliora fluidità durante l'apertura tastiera. Le props KeyboardAvoidingView invariate come da richiesta utente (behavior='padding'). No lint errors. File modificato: /app/frontend/app/ai-teach.tsx."


  - agent: "main"
    message: "V29.ay — Uniforma header 'Interfaccia Master' con header Home. master.tsx: rimosso il <LinearGradient colors={['#0F172A', '#1E3A8A', '#4C1D95']}> che generava il gradiente dark-navy→purple; sostituito con <View style={styles.hero}> contenente: (1) <Image source={require('@/assets/images/advisoros-home-header.jpg')} resizeMode='cover' style={absoluteFill}> — stessa immagine bundlata offline-safe usata dalla Home per continuità brand; (2) <View style={styles.heroScrim}> con backgroundColor='rgba(11, 30, 56, 0.55)' navy-scrim per garantire leggibilità di 'Ciao NOME', 'Interfaccia Master', clock e bottoni; (3) header row + banner My Thing con zIndex:1 per stare sopra image+scrim. Import Image aggiunto a react-native; costante HOME_HEADER_IMG dichiarata module-level. Styles.hero aggiornato con backgroundColor #0B1E38 (fallback sotto image), overflow hidden, position relative + nuovo styles.heroScrim (absoluteFillObject alpha 0.55). Verificato via Playwright su /master: sfondo circuiti neurali blu visibile, testi ben leggibili, ora/data allineate, banner My Thing sotto immutato. LinearGradient rimane utilizzato solo nel bannerFallback del My Thing (quando non ci sono immagini utente) — che è comportamento esistente immutato. No lint errors. Nessun URL remoto, tutto bundlato."


  - agent: "main"
    message: "V40 — Streaming SSE + Cache semantica globale per Axon AI Assistant. Backend (server.py): (1) nuovo endpoint POST /api/assistant/chat/stream con StreamingResponse (text/event-stream) — usa LlmChat.stream_message() di emergentintegrations per Claude Sonnet 5. Eventi: meta (session_id, assistant_name, from_cache), delta (chunk), done (used_web_search, web_sources), error. (2) Cache semantica globale db.axon_semantic_cache: normalizzazione Unicode NFKD + lowercase + rimozione stopword italiane + tokenizzazione; matching Jaccard ≥ 0.75 (calibrato per italiano ≈ 0.92 embedding); TTL 7 giorni via indice MongoDB expires_at (expireAfterSeconds=0). Bypass automatico se query contiene: attachment, cronologia sessione, token time-bound (oggi/ieri/adesso/ora/domani...), token CRM-bound (mio/i/e, appuntamento, cliente, contatto, chiamata, scadenza, bolletta), meteo, o < 12 caratteri / < 3 token. (3) Cache lookup + save integrato anche in POST /api/assistant/chat (non-streaming) per parità. (4) Helper _prepare_assistant_prompt() estratto per DRY. (5) Nuovi indici: axon_semantic_cache.expires_at (TTL), .created_at (-1), .tokens (multikey). Frontend: (1) nuovo /app/frontend/src/utils/assistantStream.ts con streamAssistantChat() — consuma SSE via fetch+ReadableStream.getReader su web, fallback full-buffer su native, parser SSE robusto. (2) AssistantChat.tsx send() migrato a streaming: onMeta inserisce bubble vuota, onDelta appende chunk incrementalmente al content, onDone finalizza. Cleanup bubble fantasma su errore. (3) Nuovo tipo ChatMsg con streaming?: boolean e from_cache?: boolean. (4) Badge nella bubble: WEB (esistente) + ISTANTANEA (nuovo, #FEF3C7/#92400E, icona flash — quando from_cache) + dot indicator viola (quando streaming). Test manuali: query 'Spiegami cosa è il PUN...' → primo stream 13s con web_search=true; identica ripetuta → cache HIT in 205 ms (63× più veloce, similarity 1.0); riformulata 'Cosa significa PUN nel mercato energetico italiano' → cache HIT 245 ms (similarity 0.833); 'Quali sono i miei appuntamenti di oggi?' → correttamente bypassa cache, stream LLM ~6.5s. UI screenshot conferma: bubble streaming con dot viola durante scrittura, badge ISTANTANEA visibile su cache hit, badge WEB in combinazione. No lint errors."



  - agent: "main"
    message: "V50.z258 — Tour Guidato conversazionale: test E2E completo. Backend 7/7 pytest (/app/backend/tests/test_v50z257_tour.py, report iteration_86.json). Frontend verificato via Playwright con login UI reale: step1→step2 (3 risposte scritte, tour-reply + funzioni accese)→step3 (contatto 'Giulia Verdi' estratto da testo e salvato in anagrafica)→step4→tour-finish→/home. Fix UX: in step 2 lo ScrollView ora scorre in fondo quando arriva la risposta di Axon e a ogni funzione che si accende (prima la lista funzioni restava sotto la piega). Contatto di test eliminato."

  - agent: "main"
    message: "V50.z259 — NAVIGATORE AXONOS (backend/routes/axon_navigator.py + frontend/src/NavChips.tsx). (1) APP_MAP: ~85 schermate/sezioni con route+keyword, GET /axon/nav/map. (2) Regola prioritaria nel system prompt (wrapper _prepare_assistant_prompt): funzione esistente → [[NAV:route|label]] (frontend → pulsanti deep link), hint per messaggio via keyword. (3) Flussi multi-step deterministici (wrapper _maybe_push_command + /assistant/chat ri-registrato): 'devo andare da X' (meteo città + Axon Drive preselezionato + sposta appuntamento se allerta), 'sposta appuntamenti mancati di oggi a domani' ([[ACTION:move_missed|…|json]] → POST /axon/nav/action), 'ho perso il filo' (clienti 90+ gg + giro ottimale), 'devo organizzarmi' (calendario settimana + ripassi + ritelefonate). (4) Proattività: GET /axon/nav/proactive (giro ottimale mai usato, nessuna ritelefonata, scanner mai usato, GPS visite off) → card in chat con Apri/Non ora (POST /axon/nav/proactive/dismiss, cooldown 14gg); POST /axon/nav/track da scanner/optimal-route/nav click. (5) Linguaggio vago: 'mi sono perso', 'come sto andando', 'devo richiamare', 'dove metto i documenti', 'come faccio a impostare X'. Deep link param aggiunti: /home?section=…, /optimal-route?contacts=…, /calendario?view=…, /contact/{id}?tab=…, /bill-quick?config=1. TTS ignora i marker. Cache semantica invalidata una tantum. Test: backend/tests/test_v50z259_navigator.py (12 pass)."

  - agent: "main"
    message: "V50.z260 — STRESS TEST AXONOS (backend/routes/axon_stress_test.py + axon_stress_questions.py; frontend/app/axon-stress-report.tsx; link in Profilo → 'Strumenti di sviluppo' testID settings-group-devtools, solo owner). 211 domande in 19 categorie (dirette, vaghe, informali, typo, trap, flussi, ripetizioni, config, problemi) con esito atteso. POST /axon/stress/run {reps,limit,categories} → job in background: ogni ripetizione pone TUTTE le domande (sessioni separate, momenti diversi) al vero /assistant/chat/stream con no_cache; valuta deep link corretto, coerenza tra ripetizioni, trap (funzioni inventate), esistenza reale della route (scan di frontend/app). GET /axon/stress/runs, /runs/{id}?outcome=, /runs/{id}/stop, /runs/{id}/report-html (PDF via expo-print), POST /corrections/apply → regola in db.axon_prompt_rules iniettata subito nel system prompt + shortcut deterministico; GET/DELETE /corrections. UI: KPI (testate/%corrette/%fallite/%incoerenti), filtri Tutti/Passati/Falliti/Incoerenti, dettaglio ripetizioni + risposta attesa + correzione suggerita + «Applica correzione», «Esporta PDF» in header, progress + Ferma. Test: backend/tests/test_v50z260_stress.py (4 pass)."

  - agent: "main"
    message: "V50.z261 — TEST NOTTURNO (in axon_stress_test.py, fondo file). Impostazioni per owner user_settings.stress_nightly {enabled(default off), hour 1-5 Europe/Rome, mode quick(~57 domande bilanciate/ruotanti)|full, reps, threshold_pct, drop_pct}; GET/PUT /axon/stress/nightly, POST /axon/stress/nightly/run-now. Scheduler APScheduler ogni 10 min (max 1 run/giorno per owner). A fine run notturno (wrapper _st_finalize): confronto con la notte precedente → se % corrette < soglia o calo ≥ drop → db.axon_alerts type stress_quality con route /axon-stress-report?run=<id> + send_push al Master. UI: card '🌙 Test notturno' in /axon-stress-report (toggle, ora, campione, ripetizioni/soglia/calo, ultimo esito, 'Prova ora'); axon-alerts apre il deep link `route`; ?run= apre il run specifico. Verificato: run-now con soglia 100% → verdict alert + avviso creato; pytest test_nightly_settings_and_status pass."

  - agent: "main"
    message: "V50.z262 — CORREZIONI STRESS TEST + categoria 'sbagliate'. (1) Contratti cliente: nuovo tab 'Contratti' nella scheda contatto (frontend/src/ContactContractsSection.tsx, /contact/{id}?tab=contracts, GET /contracts filtrato per contact_id) + intercetto deterministico _RX_CONTRACTS_CLIENT (cliente nominato → deep link diretto; altrimenti clienti con contratti + /contatti). (2) Analisi fattura conversazionale: _RX_BILL_FLOW ('leggi questa fattura…', 'confronto offerte luce e gas') → /bill-quick. (3) Trap: _RX_TRAP → risposta fissa «Questa funzione non è disponibile in AdvisorOS.» + regola nel prompt. (4) Deterministici: campi personalizzati → /custom-fields; ripassi → _nav_flow_ripassi (lista _cv_due_list + giro ottimale + calendario settimana); Telegram/Home Assistant → /axon-integrations; 'sto lavorando bene' → KPI. (5) Typo troncato 'come collego la mial' → «Vuoi collegare la tua casella mail? Se sì, vai qui.» + /smtp + /email-accounts; frasi troncate ('come faccio a', 'dove sta il') → richiesta di completare; gibberish/'?' → non ho capito. Casi limite deterministici: identità/prompt injection (_RX_ROLE), offese (_RX_OFFENSIVE), richieste impossibili (_RX_IMPOSSIBLE → rifiuto + Help Center). Prompt: sezione CASI LIMITE (offtopic, aggressivi, troncati, altre lingue, offensivi, ruolo, impossibili). Stress test: nuova categoria 'sbagliate' (35 domande, flag guard:<tipo>, 5° elemento = parole proibite) con valutazione dedicata; gestione errori LLM (event error → outcome 'error', contatore, stop automatico dopo 6 errori consecutivi, banner budget in UI, nightly non avvisa se troppi errori). NOTA: durante i test la chiave LLM ha raggiunto 'Daily spend limit reached' → le domande LLM (offtopic, altre lingue, aggressive) non sono state validate: rilanciare il test quando il budget è ricaricato."

  - agent: "main"
    message: "V50.z263 — SISTEMA A DUE LIVELLI (axon_navigator.py). Livello 1 deterministico: _nav_template_reply → per ogni domanda mappata risposta template fissa «**Nome** — descrizione + [[NAV:route|Apri Nome]]»; matching per token con stemming italiano (_nav_stem: suffissi lunghi/participi/vocale finale), stopword, fuzzy 1 refuso solo per parole fuori vocabolario (_nav_tok_eq), punteggio 3+2·token per frase keyword, tie → ordine APP_MAP; esclusione domande sui dati (_RX_DATA_Q: quanti/quante/a che ora/chi è…) e richiesta di intento (_RX_NAV_INTENT) o frase multi-token. Keyword arricchite (~100). _nav_flow_howto ora usa il messaggio completo. Nuovi deterministici: frustrazione (_RX_FRUSTRATED), frequenza ripasso, 'cancellare tutto'. Guard: risposta L1 senza deep link → log '[NAV] risposta L1 senza deep link' + flag missing_deeplink; stress test segnala '⚠️ Nessun deep link per una domanda mappata (errore Livello 1)'. Livello 2 (AI) solo per domande non mappate, con mappa+regole nel prompt. RISULTATI stress test completo ×3 (run st_7a4304982c): 230/230 domande deterministiche PASSATE, 0 fallite, 0 incoerenti (prima 78,2% incoerenti); 16 domande richiedono l'AI (fuori contesto, altre lingue, 3 domande sui dati) → 'Errore LLM' perché il budget giornaliero della chiave è esaurito; poi run st_0cca2b74cf trap+sbagliate ×3: 39/39 passate, 8 solo-AI."

  - agent: "main"
    message: "V50.z264 — Tour: (1) /tour-features mostra in cima il numero reale di funzioni (testID tour-features-total) calcolato dal backend GET /tour/features → total = unione automatica APP_MAP (Navigatore) + capacità AxonOS (_TOUR_FEATURES) + schermate reali dal file-system expo-router non ancora mappate (esclusi schermi tecnici); attualmente 142; le voci con route sono tappabili. (2) Schermata 2: intro vocale+testuale di Axon (testID tour-intro) → frase di raccordo 'Più sei preciso…' (tour-lead-in) → prima domanda parte automaticamente a fine audio (onEnded di playAudioBase64; fallback a tempo 26s/7s); link 'Vai alle domande' (tour-intro-skip). Verificato via Playwright."

  - agent: "main"
    message: "V50.z300 — AREA CORSI Fase 5 (courses.py: course_time, pre_reminders, job pre-lezione/post-lezione, POST /courses/{id}/certificates/issue-all; courses/new.tsx + courses/[id].tsx) + Card «Consigliato per te» in Home (src/RecommendedForYou.tsx, GET /tour/recommendations, POST /tour/recommendations/dismiss). Backend verificato con tests/test_courses_phase5.py (tutto OK, incluso post-lezione: sub «📝 Completa il test», owner «🎓 Corso svolto»). Home card verificata via screenshot. Corso demo crs_1d62c3820bd1 creato per i test frontend (da eliminare)."

  - agent: "main"
    message: "V50.z301 — Prompt Neo #9 (chat non bloccante): verificato attivo; fix coda bloccata da bozza `processing` orfana (_cq_unstick 150 s), bozze in coda ora visibili inline in chat (src/ChatQueueInline.tsx: pos/ETA, Invia ora, Modifica, Elimina), sendingRef anti-race, testo ripristinato se enqueue fallisce. E2E web OK (3 messaggi durante risposta lunga → coda → svuotata)."

  - agent: "main"
    message: "V50.z302 — (1) Richieste creative ad Axon → AI invece del template L1 (_nav_is_creative in axon_navigator.py; verificato con tests/ask_axon.py). (2) Presenze corso: PUT /courses/{id}/attendance, eligibilità attestato solo ai presenti (e non prima della data del corso), UI card «📋 Presenze in aula» in courses/[id].tsx. Backend verificato via script (futuro → non idoneo; assente → issue-all 0; presente → 1 + PDF 200; sub 403). UI verificata via screenshot (Salva presenze → Presenze salvate → «Rilascia attestati ai presenti (1/1)»)."

  - agent: "main"
    message: "V50.z303 — Aggiornata la conoscenza di Axon (APP_MAP navigator, sezioni omniscience, catalogo tour) con Fase 5 corsi, presenze, dispositivi, regole con peso, coda chat, screenshot, consigliato per te, reset dati, libretto editor, prompt Neo; link verificati via scan delle route expo-router (0 rotti); cache semantica svuotata. Verifica con tests/ask_axon.py OK."

  - agent: "main"
    message: "V50.z304 — Prompt correzione definitiva: «aspetta»→«OK!» deterministico, blocco STILE RISPOSTA vincolante (+ direttive solo-tabella / domanda diretta / dato aggiornato), avviso ⚠️ CONFLITTO obbligatorio nel rules engine, pulsanti automatici A)/B)/ORA (src/axon-choice-buttons.tsx in AssistantChat). Backend verificato con tests/ask_axon.py; parser pulsanti testato con 6 casi (tsx). Da verificare visivamente in app i pulsanti su una risposta con opzioni A)/B)."

  - agent: "main"
    message: "V50.z305 — Stress test categoria «stile» (16 domande: aspetta/solo tabella/sì-no/scelte A)B)/motivazioni su domande strane e doppie) con valutatore dedicato, by_category nel summary, resoconto notturno sempre inviato (alert Home) e card «Regole di stile» nel report; run stile 16/16, regressione 70 domande 98,6%. Voce breve: client_context.voice → prompt voce in testa, TTS senza tabelle, PUN parlato. Verificato via API/stream."

  - agent: "main"
    message: "V50.z306 — Fix da log utente: domande perché/meta → AI (no template/ops), Neo bridge (cancellazione reale coda, no salvataggi indesiderati, conteggio reale nel prompt), bolla «Un attimo, ci ragiono…» entro 0,7 s, evaluator yesno rilassato. Verificato via stream + stress parziale (trap/offline/stile ok; 2 fallimenti crt pre-esistenti: «Dove compilo un nuovo contratto luce e gas» → template contratti/AI, «consumo annuo 8 mesi» → link Calendario)."

  - agent: "main"
    message: "V50.z308 — Primo avvio ridotto a 3 domande a tocco (POST /tour/quick-start) + form 20 domande opzionale; screenshot OK (tour-opt-*). Consolidamento prompt: 72.8k → 52.7k caratteri (−28%) via elenco navigatore compatto + mappa omniscienza per pertinenza; stress 60 domande 98,3% invariato."

  - agent: "main"
    message: "V50.z309 — Prompt core consolidato (72.8k → 43.6k, −40%), stress 70 mappate 100% + 61/61 su fatture/crt/master/contatti/documenti/stile. Master Files Prompt per Neo: Cancella tutti/Pulisci completati (DELETE /neo-bridge/prompts?scope=) e stato toccabile; verificato endpoint. Fix contratti (firmato → /contract/new, compilo → /crt, di Rossi → scheda cliente)."

  - agent: "main"
    message: "V50.z310 — CONFRONTO COLLABORATORI: GET /team-insights/compare?period=30|90|365|all (Master-only) + app/team-compare.tsx (classifica, barre per metrica, testa a testa, tabella; link da Master grid/hub e Team Insights). tests/test_team_compare.py OK. V50.z311 — refactor AssistantChat.tsx: FAB → src/AssistantFAB.tsx, bolle → src/assistant/ChatBubbles.tsx, stili → chatStyles.ts, audio → utils/audioPlayback.ts (spostamenti meccanici, nessuna modifica logica). Verificato E2E web: FAB → chat → 'aspetta' → 'OK!'."

  - agent: "main"
    message: "V50.z312-z314 — Landing pubblica riprogettata (app/landing.tsx + src/landing/*: palette marchio navy/arancio/blu, orb Axon, aurora, mantra IA-aggiunta vs Axon-nel-CRM, demo animata 15 s AppDemoPlayer, modularità interattiva, modulo Richiedi demo). Backend POST /public/demo-request (35_reviews_leads.py) → lead source=landing_demo + bubble Home via _apx_emit(type lead_demo). index.tsx: landing al primo avvio su mobile (AsyncStorage landing_seen_v1). Testing agent iteration_93: tutto PASS."

  - agent: "main"
    message: "V50.z315 — ViolaWake: backend routes/viola_wake.py (settings/module/route/event/events) testato con tests/test_viola_wake.py; SDK src/violawake (Porcupine native + expo-speech-recognition, stub web), provider in _layout, pill di stato, schermata /viola-wake (link Impostazioni→Integrazioni). Su web/anteprima: stato «Non disponibile qui», ma modulo/impostazioni/test comando scritto funzionano (briefing → risposta parlata via TTS; comando libero → chat Axon con forceSpeak). Ascolto reale solo su build nativa con AccessKey Picovoice."

  - agent: "main"
    message: "V50.z317 — PDF tabella: export chat → solo tabella (buildTablesOnlyHtml + printHtmlWeb, niente window.print della pagina); schermo intero → fitTableLayout per 1 pagina A4. Testing agent iteration_96: 3/3 PASS."

  - agent: "main"
    message: "V50.z318 — Attivazione AxonOS: step obbligatorio nome+voce nel tour, onda di energia 3 s + vibrazione doppia + TTS «Ciao, sono {nome}. Sono pronto.», comandi locali «fai l'effetto» / «dove sei» / «trova il mio telefono» / «stop» (chat + ViolaWake). Overlay mirror dentro il Modal chat. Testing agent iteration_97 PASS."

  - agent: "main"
    message: "V50.z320 — Codici promozionali: backend routes/axon_promo_codes.py (GET/POST/PATCH/DELETE /admin/promo-codes (super admin), GET /admin/promo-codes/{id}/redemptions, POST /promo/redeem, GET /promo/my, job promo-premium-expiry 00:20). Frontend: app/admin/promo-codes.tsx (lista, crea, dettaglio con utilizzi, attiva/disattiva, elimina), src/PromoCodeField.tsx (campo onboarding saltabile + card Impostazioni›Abbonamento), tour.tsx step promo dopo nome+voce, master.tsx tile «Codici Promozionali» (super admin). pytest tests/test_v50z320_promo_codes.py 5/5."

  - agent: "main"
    message: "V50.z321-z322 — Coesistenza promo↔inviti (GET /invites → promo_codes per invitato; redemptions → invited_by_email) + «Invita un amico»: routes/axon_referral.py (GET /referral/me, GET/PUT /admin/referral-settings, GET /admin/referrals; riscatto via /promo/redeem fallback AMICO-…), src/ReferralCard.tsx, app/invita-amico.tsx, login ?ref= → pending_referral_code_v1 → prefill PromoCodeField. pytest test_v50z321 + test_v50z322 6/6 (+5 promo)."
