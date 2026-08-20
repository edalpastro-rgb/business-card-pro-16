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
