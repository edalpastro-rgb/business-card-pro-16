# Dal Pastro CRM — PRD v1.3

## v1.3 nuove funzioni
### Contatto
- Referenza: 3 opzioni distinte
  - Conoscenza personale
  - Referenza diretta personale
  - Referenza da altro contatto (con picker link a contatto)
- **Compleanno**: campo data + alert 0/1/2 giorni prima + messaggio auto custom + link allegato (yearly repeat via expo-notifications)
- **Foto multiple**: 
  - Foto profilo (avatar) → tap sull'avatar
  - Foto aggiuntive → sezione "Foto contatto" con camera / galleria (salvate come note kind="photo")
- **Import dalla rubrica del telefono** (nativo iOS/Android tramite expo-contacts)
- Waze: pulsante sia sull'header sia nella sezione Indirizzo del cliente

### Note contatto (5 tipi)
1. Testo
2. Vocale (registrazione audio)
3. **Foto** (camera / galleria)
4. **Link** (URL + titolo opzionale)

### Appuntamento
- Tipo appuntamento multi-select: Piano Marketing / Energia / Ant / Dare seguito / Demo prodotti (+ custom da settings)
- **Prodotti** con categorie/sotto-categorie: quando "Demo prodotti" è spuntato, appaiono Artistry / Nutrilite / Home (+ custom)
- Durata, promemoria, ricorrenza, partecipanti, valore € (v1.2)

### Calendario
- Vista giornaliera + filtro per categorie: Tutti / Energia / Network / Compleanni
- I compleanni compaiono automaticamente ogni anno nella data del contatto

### Settings / Impostazioni
- Nome app modificabile (backend model)
- Titolo + colore delle 2 aree (già v1)
- custom_appointment_types (backend, UI da esporre)
- custom_product_categories (backend, UI da esporre)

### Bugfix v1.2 (già chiusi)
- Chrome Translate → translate="no" + lang="it"
- DateTime picker duplicato → sostituito con `<input type="datetime-local">` nativo web

## Stack
- Frontend: Expo Router SDK 54, expo-notifications (yearly triggers per compleanno), expo-contacts, expo-audio, expo-image-picker (camera + galleria), expo-document-picker
- Backend: FastAPI + Mongo + JWT + bcrypt + httpx
- Deploy: Emergent Publish oppure Aruba Cloud (`/app/ARUBA_DEPLOY.md`)

## V38Q (June 2026) — 5 Task Msg 595
1. **Master Files - Carica file**: DocumentPicker filtrato per documenti (PDF/Word/Excel/PPT/txt/csv/zip/rtf/json). Il picker foto/video resta su pulsante separato "Foto" con 4 opzioni (camera-photo/camera-video/library-photo/library-video).
2. **Auto-save Master bill drafts**: helper `_auto_save_draft_to_master_files(draft)` chiamato dopo status='done' in `_analyze_draft_task`. Salva `master_files` category='bills' con name='Analisi-{pdf_name}'. Idempotente.
3. **Fix duplicati share analisi**: guard `analysisSavedRef` in `BillsSection.tsx` ora settata PRIMA dell'await (risolve race condition).
4. **SVG chart nei report HTML**: `buildBillAnalysisHtml` intercetta `consumi_mensili_kwh/smc` e li rende come SVG bar chart embedded (usa `renderConsumiSvg` con grid + label + valori sopra le barre).
5. **Master Digital Business Card** (NUOVA FEATURE):
   - Backend: collection `business_cards` (1 doc per tenant), schema `BusinessCardIn` con 15 campi (display_name/title/company/phone/email/website/address/tagline/logo_base64/photo_base64/accent_color/qr_type/qr_content/demo_app_link/social_links).
   - Endpoints: `GET/PUT /api/master/business-card` (auth, upsert con card_id auto-generato) + `GET /api/master/business-card/public/{card_id}` (NO AUTH per QR scan).
   - Frontend: `/app/frontend/app/business-card.tsx` (~300 LOC) con preview live (bordo colorato accent + QR + avatar/logo), form Contenuti/Logo/QR type radio (4 tipi: app/website/text/vcard)/Colore accento (8 swatches), pulsanti "Condividi come immagine" (react-native-view-shot + expo-sharing) e "Condividi link" (Share.share con URL pubblico + Clipboard).
   - Master screen ora ha tile "Biglietto da visita" viola (#7C3AED).
   - Testing: 12/12 backend pytest + Playwright smoke ✅ (iteration 51).

## V38R (June 2026) — FASE 1: Fix critici PDF/UI (Msg 596)
1. **PDF Inline Viewer**: `FileViewer.tsx` ora usa `URL.createObjectURL(Blob)` su web per PDF/HTML (evita dialog Apri/Scarica su file > 2MB). Aggiunto CalculatorFAB dentro il modal (accessibile durante la visualizzazione).
2. **SaveConfirmModal**: Nuovo componente `/app/frontend/src/SaveConfirmModal.tsx`. Prima di salvare una fattura/analisi/report/comparazione, appare modal con nome default `{ContactName} - {Type} - YYYY-MM-DD_HH-MM`. Utente può modificare + cliccare Salva. Sostituisce il vecchio auto-save silenzioso.
3. **Layout responsive** in `BillsSection.tsx` e `BillFieldRenderers.tsx`: `kvVal` usa `flexShrink: 1, flexWrap: "wrap"`, `paramSubBox` ha `overflow: hidden`. Il ConsumptionBarChart rimane in ScrollView horizontal.
4. **Master Files 'Analisi' tab**: Backend `ALLOWED_MASTER_CATS` estesa con `analisi`. `_auto_save_draft_to_master_files` ora salva DUE documenti: (a) raw PDF in `bills` (dimensione originale), (b) HTML analisi generato via `_build_analysis_html` in `analisi` (con banner colorato bill_type + tabella KV + SVG bar chart + note_ai). Frontend aggiunge 5° tab verde con hint "Generate automaticamente dalle bollette".
5. **Data+ora + Universal Share**: `master-files.tsx` mostra `dd/mm/YYYY · HH:MM` invece che solo la data. Ogni item card (esclusi Note) ha pulsante Share (`master-files-share-{id}`) che apre ShareSheet. Anche i contact files mostrano data+ora ora.
6. **Nuovo endpoint backend**: `POST /api/master-files/{file_id}/share-link` (auth) + `GET /api/public/master-files/{token}` (no auth) per condividere qualsiasi file Master via link firmato JWT 24h.

Testing V38R: 12/12 pytest backend + Playwright OK. File toccati: server.py, FileViewer.tsx, SaveConfirmModal.tsx (nuovo), BillsSection.tsx, BillFieldRenderers.tsx, ShareSheet.tsx, master-files.tsx, contact/[id].tsx.

## V38S (June 2026) — 8 UI/UX Improvements (Msg 597)
1. **PDF.js viewer embedded**: `FileViewer.tsx` ora usa PDF.js caricato via CDN (`cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/`) dentro `<iframe srcDoc>` (web) o `<WebView source={{html}}>` (native). Rendering canvas + toolbar Prev/Next/Zoom+-. Non più dialog Apri/Scarica del browser su mobile Chrome/Android.
2. **Calculator bottom sheet**: `CalculatorFAB` maxHeight ridotto da 90% a 62%, drag handle aggiunto in cima, backdrop 50% opacità — così il contenuto dietro (analisi/PDF) rimane visibile.
3. **'I miei audio' rimosso** dal menu tre puntini nel Master screen (era doppione, il tile principale nella griglia rimane).
4. **'Failed to fetch' friendlier**: `api.ts` con try/catch che converte `TypeError: Failed to fetch` / `Network request failed` in "Connessione al server interrotta. Verifica la rete e riprova."
5. **Logo aziendale nei report**: `buildBillAnalysisHtml` ora ha header con logo + agency name. Il logo viene anche automaticamente riutilizzato dal biglietto da visita (GET /master/business-card seed da `user.company_logo_base64`).
6. **Pulsante verde 'Aggiungi Appuntamento'** in `/calendario`: sostituisce FAB rotondo. testID `cal-add-btn`, colore #16A34A.
7. **Pulsante verde 'Aggiungi Telefonata'** in `/home` (Ritelefonate) e `/appointment/[id]` (Programma ritelefonata). testID `add-callback-btn`.
8. **Tipi appuntamento con colori** (SOSTITUISCONO i vecchi):
   - Energy #DC2626, Telefonata #EA580C, Personale #16A34A, Riunione #2563EB, Promemoria #F59E0B, Altro #6B7280
   - Pill con pallino colorato in `/appointment/new`
   - `apptTypeColor()` esportato + usato in `calendario.tsx` (vista giornaliera + settimanale + mensile dots)

Testing V38S: 11/11 pytest backend + code review frontend OK.
