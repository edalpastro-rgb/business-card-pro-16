# ProSync CRM — PRD

## Overview
Mobile CRM (React Native / Expo, SDK 54) per un professionista con due ruoli distinti: Consulente Energetico + Networker. Interfaccia italiana, palette azzurro corporate.

## Auth
- Email/Password (JWT, 30 giorni)
- Google OAuth (Emergent-managed session, 7 giorni)
- Endpoint: /api/auth/register, /api/auth/login, /api/auth/google-session, /api/auth/me, /api/auth/logout

## Core Features
1. **Contatti**: CRUD con area (energy/network), origine (personal/referral), note (referral, email condivisibile, generali), note testuali/vocali collegate, file PDF/JPG (base64 in Mongo).
2. **Calendario**: appuntamenti color-coded per area, flag telefonico, done checkbox, rinvio data/ora.
3. **Ritelefonate**: lista giornaliera per area, spuntabili.
4. **Post-appuntamento**: outcomes area-specifici (Energia: non_interessato/contratto_fatto/richiamare; Network: 9 tag multi-select). Note dettagliate + prodotti venduti.
5. **Report**: giorno/settimana/mese/anno per area (appuntamenti fatti, contratti, prodotti, telefonate).
6. **Impostazioni**: personalizzazione titolo + colore delle 2 aree.
7. **Waze**: link diretto all'indirizzo del contatto/appuntamento.
8. **WhatsApp / Chiama / Email**: link diretti da scheda contatto.

## Non incluso (v1)
- Comandi vocali AI (skip per scelta utente)
- Notifiche push native (solo in-app / locali)
- Sincronizzazione Google Calendar / Outlook (opt-in — pianificata prossima iterazione)

## v1.1 (aggiunta)
- **Multi-utente**: owner invita membri via `/api/team` con areas specifiche. Sub-user vede solo i propri record (contatti/appuntamenti/callback creati da lui). Owner vede tutti i record del tenant.
- **Notifiche locali**: promemoria appuntamento (15 min prima + all'ora) e ritelefonata (all'ora), gestiti via expo-notifications. Cancellati automaticamente su done/delete/reschedule.
- **Deploy Aruba**: guida in `/app/ARUBA_DEPLOY.md`

## Stack
- Frontend: Expo Router, expo-audio, expo-document-picker, expo-file-system, @react-native-community/datetimepicker, expo-linear-gradient, expo-secure-store
- Backend: FastAPI, motor (MongoDB), bcrypt, PyJWT, httpx
- Storage: MongoDB (file base64)
