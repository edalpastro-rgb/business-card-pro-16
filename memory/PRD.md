# Dal Pastro CRM — PRD

## Overview
Mobile CRM (React Native / Expo, SDK 54) per un professionista con due ruoli distinti: Consulente Energetico + Networker. Interfaccia italiana, palette azzurro corporate, branding "Dal Pastro CRM".

## Auth
- Email/Password (JWT, 30 giorni)
- Google OAuth (Emergent-managed session, 7 giorni)
- Endpoint: /api/auth/register, /api/auth/login, /api/auth/google-session, /api/auth/me, /api/auth/logout, /api/auth/profile

## Contatti (v1.2)
Campi: nome, cognome, telefono principale + secondario + WhatsApp, email principale + secondaria, indirizzo (via/CAP/città/provincia separati + campo legacy), data di nascita, codice fiscale, partita IVA, website, LinkedIn, Instagram, Facebook, area (energy/network), origine (personal/referral), referred_by_contact_id, note referenza/email/generali, avatar_base64, tags[], note testuali/vocali, file PDF/JPG.

## Appuntamenti (v1.2)
Campi: titolo, contact_id principale, partecipanti multipli, area, start_at, duration_min, is_phone, luogo, note, reminder_minutes (0/5/15/30/60/1440), recurrence (none/weekly/monthly/yearly), value_amount, esiti area-specifici, outcome_notes, products_sold, contract_signed.

## Ritelefonate
Come v1. Notifica locale al programmato.

## Report giorno/settimana/mese/anno per area
Come v1: app. fatti/totali, telefonate fatte, contratti, prodotti.

## Impostazioni
- Avatar personale
- Titolo + colore aree personalizzabili
- Gestione Team (owner only): invita membri con aree specifiche

## Team multi-utente
Owner vede tutto il tenant, sub-user vede solo i propri record. Area enforcement server-side.

## Notifiche locali
expo-notifications. Personalizzabile per appuntamento (0/5/15/30/60/1440 min prima). Cancellazione automatica su done/delete/reschedule.

## Sync calendario
- Google Calendar: link URL-based (apre calendario esterno con evento precompilato)
- Outlook: idem
- .ics: file universale scaricabile
- **Full-OAuth bidirezionale**: pianificato per iterazione futura (richiede credenziali Google Cloud + Microsoft Azure fornite dall'utente)

## Deploy
Guida completa in `/app/ARUBA_DEPLOY.md` — VPS Aruba Cloud PRO + Docker + Nginx + Let's Encrypt.

## Bugfix v1.2
- Chrome Translate: aggiunto `translate="no"` e `lang="it"` globali per prevenire ri-traduzione automatica dei testi italiani
- Datetime picker web: sostituito input ISO grezzo con `<input type="datetime-local">` nativo
- Restyling home: gradiente hero, badge circolari colorati sulle stat card, avatar utente
- Anagrafica contatti riorganizzata in sezioni chiare (Anagrafica, Contatti, Indirizzo, Classificazione, Note)
- Rebranding: "ProSync CRM" → "Dal Pastro CRM" ovunque
