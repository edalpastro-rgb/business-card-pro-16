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
    - "Groups CRUD (custom, per-tenant) + contact.group_ids filter"
    - "SMTP config per-tenant + real bulk email"
    - "Bulk preview (WhatsApp/Telegram/SMS deep-link sequential)"
    - "Team chat channels + messages (text/audio/photo/file/link)"
    - "Groups screens (list, create/edit modal, detail with bulk actions)"
    - "Contact form group multi-select + contacts list group filter"
    - "Team chat tab + create channel + chat detail with all media"
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
