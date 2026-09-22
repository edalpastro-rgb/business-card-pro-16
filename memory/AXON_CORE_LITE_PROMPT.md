# PROMPT — AxonOS Lite → Axon Core (da incollare nel job AxonOS Lite)

## Contesto
AxonOS Lite NON deve più avere un proprio backend/cervello Axon. Esiste un solo **Axon Core**: il backend di AdvisorOS,
già in produzione, che serve tutti i prodotti. Lite diventa **solo un'interfaccia** che parla con Axon Core.
Così Axon impara da tutti i clienti (Advisor + Lite) e ogni miglioramento è disponibile ovunque una volta sola.

**Backend condiviso (Axon Core):** `https://business-card-pro-16.emergent.host` (poi dominio definitivo di AdvisorOS)
**Manifest pubblico (verifica sempre prima):** `GET {BACKEND}/api/axon/core/manifest` → prodotti, endpoint condivisi, modello dati.

## Cosa fare in AxonOS Lite
1. **Puntare al backend condiviso**: `EXPO_PUBLIC_BACKEND_URL={BACKEND}`; tutte le chiamate usano `{BACKEND}/api/...` con
   `Authorization: Bearer <token>`. Il backend FastAPI di Lite non va più usato per Axon (può restare solo come proxy/vuoto).
2. **Registrazione con prodotto**: `POST /api/auth/register {email, password, name, product: "lite"}`.
   Login `POST /api/auth/login {email, password}` → `{token, user}`; `GET /api/auth/me` → `user.product === "lite"`.
   Google: `POST /api/auth/google/session {session_id, product: "lite"}`.
3. **Identità e funzioni**: `GET /api/axon/core/me` → `{product:"lite", label, features[]}`; mostra solo le funzioni presenti in
   `features` (axon_chat, axon_memory, axon_proactive, axon_voice, personal_space, notes, reminders, calendar, promo, referral).
4. **Chat Axon**: `POST /api/assistant/chat {message, session_id?, attachments?}` (stream SSE dello stesso endpoint per la
   digitazione live). Axon sa già che l'utente è Lite: identità «assistente personale AxonOS Lite», niente CRM/team.
   TTS: `POST /api/assistant/tts {text}`. Nome/voce/lingua: `GET/PUT /api/user-settings {assistant_name, assistant_voice,
   assistant_language, assistant_setup_done, activation_done, onboarding_done}`.
5. **Memoria personale** (privata per utente): `GET/POST /api/axon/memory`, `PUT/DELETE /api/axon/memory/{item_id}`,
   `POST /api/axon/memory/analyze`; Sfera personale `GET /api/axon/personal-space/summary`, audio `POST /api/audio-records/{id}/transcribe`.
6. **Proattività / promemoria**: `GET/PUT /api/axon/proactive/config`, `POST /api/axon/proactive/trigger`,
   `GET /api/axon/proactive/items`, `POST /api/axon/proactive/items/{id}/{action}`, `GET/POST /api/axon/proactive/reminders`,
   `DELETE /api/axon/proactive/reminders/{id}`.
7. **Codici promozionali + Invita un amico** (stessa logica e stessi testID di AdvisorOS):
   - Onboarding, dopo nome+voce e PRIMA delle 3 domande di profilazione: campo «Hai un codice promozionale o un codice amico?»
     facoltativo, «Salta, non ho un codice» → `POST /api/promo/redeem {code}` (accetta promo E codici `AMICO-…`).
     Errori: 404 «Codice non valido», 410 scaduto/esaurito/programma disattivo, 409 già usato, 400 proprio codice.
   - Impostazioni › Abbonamento: stesso campo + storico `GET /api/promo/my` + card «Invita un amico» da `GET /api/referral/me`
     → `{code, share_path:"/login?ref=CODE", share_text, reward_inviter.summary, reward_invitee.summary, friends_count,
     days_earned, friends[]}` con pulsanti WhatsApp / Condividi / Link (link = origine app Lite + share_path).
   - Link amico: `/login?ref=CODE` → salva in AsyncStorage `pending_referral_code_v1`, apri registrazione, precompila nell'onboarding.
   - La gestione (creazione codici, premi referral) resta SOLO nel pannello Super Admin di AdvisorOS: in Lite non serve.
8. **Abbonamento/prova**: `GET /api/subscription/status` → `{status: trial|active|expired|free_forever, days_left, expires_at}`.
9. **Setup guidato**: `GET/PUT /api/axon/setup/state`.

## Regole
- Non reimplementare logica Axon in Lite (prompt, memoria, regole, cache): vive solo in Axon Core.
- Tutti i dati dell'utente restano nel suo spazio privato (per `user_id`), mai condivisi con altri utenti/prodotti.
- Se serve un endpoint che non esiste in Axon Core, NON crearlo in Lite: segnalarlo a Neo di AdvisorOS che lo aggiunge al Core.
- Testare con un utente registrato con `product: "lite"` e verificare che `GET /api/axon/core/me` risponda `lite`.
