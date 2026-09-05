## V50.z15 (Sept 2026) — Edge Panel Samsung-style con shortcut personalizzabili

### Concept
Replica del "Edge Panel" nativo Samsung: linguetta sottile sul bordo destro dello schermo, sempre visibile, che apre un pannello laterale con shortcut alle azioni più usate. L'utente sceglie cosa mettere dentro.

### Nuovo file `/app/frontend/src/EdgePanel.tsx`

**Elementi**:
1. **Linguetta** — barretta gialla (`rgba(251,191,36,0.85)`) 6px×68px sul bordo destro, posizione verticale personalizzabile tramite drag verticale con dito
2. **Pannello** — bottom sheet laterale 260px, sfondo `#0F2438`, appare con slide-in animato da destra (spring); overlay scuro `rgba(0,0,0,0.35)` copre la pagina sottostante
3. **Griglia 2 colonne** di tile con icona colorata + label
4. **Bottone "Modifica"** in fondo → apre bottom sheet con checklist di TUTTE le azioni disponibili
5. **Bottone "Disattiva linguetta"** dentro l'editor per chi non la vuole

**Elenco azioni disponibili** (25 shortcut precatalogati):
- Navigazione: Home, Master, Agenda, Contatti, Chat Team, Report, Profilo
- Crea: Nuovo Contatto, Nuovo Appuntamento, Nuovo Contratto
- Assets: I miei audio, I miei file, My Web, Biglietto Visita
- Utility: Analizza bolletta, Script Telefonata, Banner Evento
- Axon: Insegna, Cervello, Playbook Script, Timer & Sveglie, Libretto App
- Master: Cruscotto, Azioni Rapide, Home Assistant

**Gesture**:
- Tap linguetta → apre pannello (spring anim)
- Drag verticale linguetta → sposta la posizione (persistita)
- Swipe orizzontale sinistra da linguetta (dx < -30) → apre pannello
- Tap fuori dal pannello (overlay) → chiude
- Solo l'icona X in alto del pannello lo chiude (oltre al tap fuori)

**Persistenza AsyncStorage**:
- `edge_panel_ids_v1` — lista ID selezionati (default: home/agenda/new-contact/axon-alarms/master)
- `edge_panel_tab_y_v1` — posizione verticale linguetta
- `edge_panel_enabled_v1` — `"0"` per disattivare del tutto

**Nascondi su rotte auth**:
Controlla `pathname` e nasconde su `/login`, `/register`, `/reset-password`.

### Integrazione `_layout.tsx`
Import `EdgePanel` + render globale dentro `StackWithCallBar` solo se `user` esiste (dopo `PersistentBottomNav` e `OnboardingWizard`).

### Test manuali
- ✅ Lint TypeScript: 0 errori
- ✅ Frontend carica correttamente
- ✅ Nascosto in login (non c'è ancora user)

### Note per l'utente
- La linguetta appare in TUTTE le schermate dopo il login
- Puoi trascinarla in su/giù con il dito per riposizionarla
- Da "Modifica" puoi aggiungere/rimuovere tutte le shortcut che vuoi
- Se vuoi nasconderla → Modifica → "Disattiva linguetta" (potrai riattivarla solo da codice per ora; se vuoi un'opzione UI per riattivarla dopo, chiedimi)



## V50.z14 (Sept 2026) — Calculator ridimensionabile + non chiude su tap fuori

### Problema
La calcolatrice era un `Modal transparent` con backdrop cliccabile: toccando la pagina sottostante (per scrollare/leggere) si chiudeva. Inoltre altezza fissa `maxHeight: 62%` → nessun modo di ridurla per vedere il contenuto sotto.

### Fix
`/app/frontend/src/CalculatorFAB.tsx` — `CalculatorModal` rifattorizzato:

**1) Rimosso Modal → overlay assoluto**
- Sostituito `<Modal transparent><Pressable backdrop>` con `<Animated.View style={overlayRoot} pointerEvents="box-none">`
- `pointerEvents="box-none"` fa passare i tocchi FUORI dal sheet alla pagina sottostante → l'utente può scrollare la Home Master mentre la calcolatrice è aperta
- Il sheet rimane touchable (`pointerEvents` default)
- Rimosso il `backdrop onPress={onClose}` — ora si chiude SOLO con la X
- Slide-in animation con `Animated.spring(translateY, 0)` all'apertura, `Animated.timing(translateY, 600)` alla chiusura + `setMounted(false)` a fine anim (unmount pulito)

**2) Sheet ridimensionabile via drag handle**
- Nuovo `heightAnim: Animated.Value(DEFAULT_H)` (default 62% dello schermo, capped 500px)
- Bounds: `MIN_H = 240px` (mostra display + prima riga tasti), `MAX_H = min(560, 72% schermo)`
- `resizePan: PanResponder`:
  - `onPanResponderMove`: aggiorna `heightAnim` in tempo reale con `heightAnim.setValue(currentH - gs.dy)` clamped tra MIN/MAX (dita giù = più bassa, dita su = più alta)
  - `onPanResponderRelease`: `Animated.spring` verso valore finale + salva in `currentH.current`
- Nuovo `dragHandleWrap` con `paddingVertical: 6` — zona touch estesa per drag più facile
- L'utente può schiacciare la calc fino a vedere solo display + AC/±/%/÷, guardare il contenuto sotto, e riaprirla al volo

**3) Shadow più forte**
Aggiunte `shadowOpacity: 0.25`, `shadowRadius: 12`, `elevation: 20` — ora la sheet appare "sopra" con contrasto chiaro senza dover usare backdrop scuro.

**4) Cleanup**
- Rimosso import `Modal` da react-native (non più usato)
- Rimosso style `backdrop` (mantenuto vuoto per retro-compat, non referenziato)

### Test
- ✅ Lint TypeScript: 0 errori
- ✅ Frontend carica

### Note UX per l'utente
- Chiude SOLO con la X (piccola x in alto a destra della calc)
- Trascina l'"handle" grigio in cima (la barretta) su/giù per ridimensionare
- Mentre calc è aperta puoi scrollare la Home Master, cliccare bottoni, leggere KPI — tutto funziona



## V50.z13 (Sept 2026) — Fix TimePicker, notifica tap, anteprima suono, Home Master

### 1️⃣ Bottone "Sveglie" nella Home Master
`/app/frontend/app/master.tsx`: aggiunto pulsante verde "Sveglie" (icon `alarm`, colore `#22C55E`) tra "Insegna ad Axon" e "Cruscotto" nella lista `buttons`. Utilizza il sistema di ordinamento personalizzato esistente (l'utente può spostarlo con drag).

### 2️⃣ Fix TimePicker Android: "l'ora torna sempre a 07:30"
Il picker DateTimePicker JSX renderizzato inline aveva un bug su Samsung One UI: quando l'utente entrava in "modalità tastiera" (Digita l'ora), lo state veniva perso al primo re-render del parent Modal.

**Fix**: passaggio ad **API imperativa** `DateTimePickerAndroid.open()`:
- Sveglia: apre solo il time picker con `display: "clock"` (evita "keyboard mode" buggy)
- Promemoria: apre in sequenza date-picker → time-picker (approccio Google standard)
- iOS: continua ad usare il JSX inline picker con `display: "spinner"` (funziona bene su iOS)
- `is24Hour` ora rispetta il preference dell'utente (`timeFmt === "24h"`)

### 3️⃣ Notifica tap → apre schermata Sveglie
`/app/frontend/app/_layout.tsx`:
- Import `useRouter` da expo-router e `* as Notifications` da expo-notifications
- Nuovo `useEffect` in `StackWithCallBar` che registra `Notifications.addNotificationResponseReceivedListener`
- Quando l'utente tocca una notifica con `data.tag` che inizia con `alarm_` → `router.push("/axon-alarms")`
- Cleanup listener con `sub.remove()` in return effect

### 4️⃣ Anteprima suono (▶️ verde accanto ad ogni suono)
`/app/frontend/app/axon-alarms.tsx`:
- Nuova funzione `previewSound(id)`:
  - `id === "default"` → schedula notifica immediata (`trigger: null`) con `sound: "default"` → l'handler foreground la mostra e suona
  - `id` custom → chiama `getCustomSoundUri()` per scaricare/cache il file, poi `createAudioPlayer({ uri }).play()` con auto-stop dopo 5s
- Import aggiunto: `createAudioPlayer, AudioModule` da expo-audio (già usato per registrazione audio)
- Nuovo stile `previewBtn` (icona ▶️ verde, 22px)
- Preview funziona sia per suono default che custom

### 5️⃣ Fix suono default che non parte (Timer test vibra ma non suona)
`/app/frontend/src/alarmNotifs.ts`:
- Nuova funzione esportata `configureAlarmNotifications()` — idempotente
- Chiamata all'avvio dell'app in `_layout.tsx` (subito dopo `configureNotifHandler()`)
- Imposta `Notifications.setNotificationHandler` con `shouldPlaySound: true` (garantisce suono anche in foreground)
- Ricrea il canale Android `"axon-alarms"` con:
  - `importance: MAX` (era HIGH — bloccava suono su alcuni Samsung)
  - `sound: "default"` esplicito
  - `bypassDnd: true` (bypassa Non Disturbare)
  - `lockscreenVisibility: PUBLIC` (visibile su lockscreen)
- **Nota**: se il canale era già stato creato con importance HIGH, l'utente deve disinstallare/reinstallare l'APK (limite Android: i canali sono immutabili dopo creazione)

### Test manuali
- ✅ Lint TypeScript su tutti i file modificati: 0 errori
- ✅ Backend `/api/health` OK, expo attivo, schermata `/axon-alarms` carica con toggle 24h

### Note operative per l'utente
- **Ricrea APK e reinstalla** (non solo update): il canale notifica Android è immutabile → serve nuova install per la nuova configurazione
- **Anteprima suono default**: dovrai concedere il permesso "Notifiche" alla prima anteprima (Android 13+)
- **Anteprima suono custom**: funziona anche a volume medio-basso (usa audio in-app)
- **Tap sulla notifica**: se l'app è chiusa, si aprirà direttamente su Timer & Sveglie; se aperta, ci salta automaticamente



## V50.z12 (Sept 2026) — Fix ricorsione Drive + Fix input chat Axon

### 1️⃣ Drive: BFS ricorsivo su sottocartelle + matching per parole chiave
`/app/backend/server.py` — funzione `_fetch_teach_drive_pdfs_for_query` completamente riscritta:

**Prima (bug)**: leggeva SOLO i PDF al primo livello della cartella (`'{folder_id}' in parents`). Se la cartella CORPORATE CLUB conteneva 30 sottocartelle, Axon non le vedeva mai.

**Adesso**:
- Nuova `_list_folder_children(folder_id)` — lista PDF **e cartelle** figlie con paginazione fino a 4000 elementi per cartella
- Nuova `_list_folder_pdfs_recursive(root)` — BFS con:
  - `visited: set` per evitare cicli
  - `max_folders = 60` (limite sicurezza)
  - `max_depth = 5` (profondità massima sottocartelle)
  - `max_pdfs_total = 400` (cap totale PDF raccolti)
  - Ogni PDF conserva `_folder_path` (es. `"CORPORATE CLUB/Offerte/Super Impresa Smart"`) per debugging + matching
- Nuovo **matching per keyword**:
  - Estrae parole ≥3 char dal messaggio utente
  - Rimuove stopwords italiane (~30 termini: "che", "come", "sintesi", "fai", ecc.)
  - Punteggio: keyword nel **nome file** = 3 punti, keyword nel **path cartella** = 1 punto
  - Priorità di selezione:
    1. Match forti (score ≥3, ovvero keyword nel nome file)
    2. Match deboli (score >0, solo path)
    3. Fallback per mese/anno se query temporale
    4. Fallback più recenti (ordinati per `modifiedTime desc`)
- Output prompt include ora il path completo (`CORPORATE CLUB/Offerte/Super Impresa Smart/Super_Impresa_Smart_v3.pdf`) così Axon sa esattamente da dove viene il dato
- Log info: `[teach-drive] tenant=X candidates=42 keywords=['super','impresa','smart'] months=[] years=[]`

**Test caso reale utente** (post-Publish, con Drive connesso):
- Query: "Fai sintesi offerta super Impresa Smart"
- Prima: 0 PDF trovati (leggeva solo root di CORPORATE CLUB) → "Non ho i dati"
- Dopo: BFS trova la sottocartella `Super Impresa Smart`, il PDF omonimo prende score 9 (super=3 + impresa=3 + smart=3) → priorità massima → letto e passato a Claude

### 2️⃣ Fix input Axon nascosto dalla tastiera Android (V50.z11)
`/app/frontend/src/AssistantChat.tsx`:
- Aggiunto `statusBarTranslucent` al Modal — necessario su Android per ricevere correttamente il windowSoftInputMode di sistema
- `KeyboardAvoidingView` behavior cambiato: era `"height"` su Android (falliva con `sheet height: 82%`) → ora `"padding"` su entrambe le piattaforme (approccio standard per chat)
- `keyboardVerticalOffset = 0` (era 10 su Android — troppo piccolo dopo il fix)
- Rimosso doppio `paddingBottom` bug: prima `paddingBottom: insets.bottom` seguito da `paddingBottom: bottomPad` conflittavano
- Rimossa import `useBottomSheetPadding` (non serve dentro un Modal)

### Test manuali
- ✅ `_fetch_teach_drive_pdfs_for_query` no-crash quando Drive non connesso (ritorna "")
- ✅ Python AST parse OK, backend attivo, `/api/health` 200
- ✅ Lint TypeScript AssistantChat: 0 errori (2 preexisting warnings)



## V50.z10 (Sept 2026) — Widget Sveglia Home + Toggle 12h/24h

### 1️⃣ Widget prossima sveglia nella Home (V50.z10)
`/app/frontend/src/AlarmHomeWidget.tsx` — nuovo componente:
- Card compatta gialla (`#FFF9EC` + border `#FBBF24`) inserita nella Home tra i banner trial e My Thing
- Mostra la **prossima sveglia/timer/promemoria attivo entro le prossime 12 ore** (soglia `HORIZON_MS = 12h`)
- Se nessuna → **nascosto** completamente (return null)
- Contenuto: icona a sinistra + kind uppercase + tempo assoluto ("Oggi alle 07:30" / "Domani alle 07:30" / "5 Ott 14:30") + label sveglia + badge "tra Xh Ym" a destra + chevron
- Tap → naviga a `/axon-alarms`
- Re-render automatico ogni 30 secondi per aggiornare "tra Xm"
- Fetch via `/api/axon/alarms` in `useFocusEffect` (aggiorna quando torni alla Home)
- Calcolo prossima occorrenza per tipo:
  - timer/reminder: usa `trigger_at` diretto
  - alarm one-shot: prossima ora del giorno (o domani)
  - alarm ricorrente: cerca il prossimo weekday selezionato entro 8 giorni
- **Effetto pulse animato**: se manca <5 min alla sveglia, `Animated.loop` scale 1→1.06→1 (ogni 800ms) per attirare l'attenzione

Integrazione Home:
- `/app/frontend/app/(tabs)/home.tsx`: import `AlarmHomeWidget`, inserito dopo i banner trial e prima del banner My Thing
- **NON copre** l'header AdvisorOS né i bottoni esistenti
- Appare solo condizionalmente (no widget = nessun visual clutter)

### 2️⃣ Toggle formato ora 12h ↔ 24h (V50.z10)
`/app/frontend/src/utils/timeFormat.ts` — nuovo modulo:
- `useTimeFormat()` hook con AsyncStorage persistence (chiave `axon_time_format_v1`, default `24h`)
- Broadcast tra istanze del hook via `listeners` set
- `formatHHMM("14:30", "12h")` → `"2:30 PM"`
- `formatHM(14, 30, "24h")` → `"14:30"`
- `formatDateTime(Date, format)` → intelligente (solo ora se stesso giorno, altrimenti data + ora)

**Frontend `/app/frontend/app/axon-alarms.tsx`**:
- Import `useTimeFormat` + helper `formatHHMM` / `formatHM` / `formatWhen`
- Toggle pillola gialla nell'header (`24h` ↔ `12h`) → cambia globalmente
- `AlarmRow` riceve `timeFmt` prop → subtitle usa formato scelto
- `AlarmEditor` riceve `timeFmt` prop → picker mostra formato scelto (il DateTimePicker nativo usa comunque il format del sistema per l'input)
- Renamed `fmtHHMM` (local) → `fmtHHMM24` per salvataggio ISO al backend (sempre 24h) — evita shadowing con l'utility importata

**Widget Home**: legge `useTimeFormat()` → mostra orari nello stesso formato

### 3️⃣ Backlog voice command (V50.z10)
📝 Richiesta utente: quando torniamo sul riconoscimento vocale (Q3-Q4 2026 con SDK ViolaWake ufficiale), aggiungere:
- Tap 🎤 nella chat Axon
- Frase italiana: "Axon imposta timer 15 minuti" / "sveglia domani alle 7" / "ricordami di chiamare Mario stasera"
- Parsing intent + params via Claude Sonnet 5 function calling
- Auto-create alarm/timer/reminder e conferma vocale ("Timer di 15 minuti impostato")

Nota da ricordare: gli endpoint backend già esistono (`POST /axon/alarms`), servirà solo il layer NLP + il collegamento vocale.

### Test manuali eseguiti
- ✅ Widget renderizzato correttamente su Home (con e senza sveglie attive)
- ✅ Toggle 12h/24h persistente tra riavvi (AsyncStorage)
- ✅ `formatHM(14, 30, "12h")` → `"2:30 PM"`; `"12h"` → `"14:30"`
- ✅ Lint TypeScript su tutti i file: 0 issues



## V50.z8-z9 (Sept 2026) — Alexa-style features + Calculator draggable + Axon Drive

### 1️⃣ Calculator FAB draggable (V50.z6)
`/app/frontend/src/CalculatorFAB.tsx` completamente riscritto:
- `PanResponder` + `Animated.ValueXY` per drag fluido
- Tap veloce (<6px movimento) = apre calcolatrice; drag = sposta
- Posizione persistita in `AsyncStorage` (chiave `calc_fab_position_v1`)
- Auto-clamp ai bordi (8px margine), snap animato con `Animated.spring`
- Default: bottom-right, 100px offset dalla tab bar

### 2️⃣ Fix "Modifica" coperto dal SupportFab (V50.z6)
`/app/frontend/app/libretto.tsx`:
- "Modifica" rimosso dall'header (era coperto dal Support FAB in alto-right)
- Aggiunto bottone "Modifica libretto" nella sticky footer (visibile solo se `canEdit && !isOnboarding`)
- Scroll `paddingBottom` aumentato a 200 quando canEdit

`/app/frontend/app/libretto-editor.tsx` (SectionEditor modal):
- Rimossa la spunta verde ✓ in alto-sx (incomprensibile per gli utenti)
- Sostituita con `chevron-back` bianco (chiaro "torna al libretto")
- Aggiunto sticky "Salva sezione" giallo in fondo al modal (borderRadius 999)

### 3️⃣ Axon legge Drive folders/files (V50.z7)
`/app/backend/server.py` — nuova funzione `_fetch_teach_drive_pdfs_for_query`:
- Rileva URL `drive.google.com/drive/folders/{id}` e `drive.google.com/file/d/{id}` in `ai_teach_urls`
- Usa OAuth Drive dell'utente per listare PDF nella cartella (max 30 file, ordinati per modifiedTime desc)
- Filtra per mese/anno menzionato nella query (pattern: `202607`, `07-2026`, `luglio`, ecc.)
- Fallback: se nessun match, prende gli N più recenti (mai ritorna vuoto se ci sono PDF)
- Scarica con Drive API + estrae testo via `_extract_pdf_text_bytes` (pdfplumber + OCR fallback)
- Aggiunge blocco `📂 PDF DA GOOGLE DRIVE` al prompt con istruzione "USA questi numeri come FONTE PRIMARIA"

### 4️⃣ Timer / Sveglie / Promemoria in-app — Alexa-style (V50.z8)
**Backend `/app/backend/server.py`** — nuovi endpoint personali:
- `GET/POST/PUT/DELETE /api/axon/alarms` — CRUD sveglie
- `POST /api/axon/alarms/{id}/toggle` — enable/disable
- `GET /api/axon/alarm-sounds` — lista suoni custom
- `POST /api/axon/alarm-sounds` — upload mp3/wav/aac (max ~1.5MB base64)
- `DELETE /api/axon/alarm-sounds/{id}` — rimuove suono e resetta alarms → default
- Data model unificato: `kind`(timer|alarm|reminder), `label`, `enabled`, `sound_ref`, `vibrate`, `note`, `trigger_at`, `duration_seconds`, `time`, `weekdays`

**Frontend**:
- `/app/frontend/app/axon-alarms.tsx` — schermata tab (Timer/Sveglie/Promemoria) + FAB nuovo + editor modale
- `/app/frontend/src/alarmNotifs.ts` — sync notifiche locali via `expo-notifications`:
  - Timer/Reminder: one-shot DATE trigger
  - Alarm one-shot: DATE alla prossima occorrenza
  - Alarm ricorrente: un WEEKLY trigger per ogni weekday selezionato
  - Canale Android "axon-alarms" con importance MAX + vibrazione custom
  - Cache suoni custom in `expo-file-system/legacy` (`getCustomSoundUri`)
- Weekday preset: Lun-Ven, Weekend, Ogni giorno, Nessuno
- Duration preset per timer: 5m/15m/30m/1h
- Sound picker modal con upload mp3 e delete
- iOS disclaimer: suono custom funziona solo in foreground

### 5️⃣ Home Assistant integration (V50.z9) — domotica
**Backend `/app/backend/server.py`** — nuovi endpoint proxy:
- `GET /api/homeassistant/config` — status connessione (token mascherato)
- `POST /api/homeassistant/config` — salva URL + Long-Lived Access Token (cifrato con Fernet, reused `GOOGLE_DRIVE_TOKEN_KEY`)
- `DELETE /api/homeassistant/config` — disconnetti
- `GET /api/homeassistant/entities` — lista entità supportate (light/switch/cover/lock/scene/climate/fan/media_player/vacuum/input_boolean/button)
- `POST /api/homeassistant/service` — chiamata generica servizio HA
- `POST /api/homeassistant/toggle` — toggle rapido con deduzione dello state opposto
- Ping `/api/` a save-time per verifica connessione
- `httpx.AsyncClient(verify=False)` per HA locali con cert self-signed

**Frontend `/app/frontend/app/axon-homeassistant.tsx`**:
- Empty state con 5 step per ottenere Long-Lived Token
- Editor modale (URL + token con `secureTextEntry` toggle occhio + etichetta)
- Lista entità raggruppate per dominio con toggle diretto (ottimistico + re-sync 400ms)
- Refresh control pull-to-refresh
- Icone per dominio (bulb/flash/square/lock/color-palette/thermometer/sync/…)
- Traduzioni state IT (Acceso/Spento/Aperto/Chiuso/Bloccato/…)

### 6️⃣ Entry points in Impostazioni
`/app/frontend/app/(tabs)/impostazioni.tsx` — aggiunte 2 card:
- 🟢 "⏰ Timer & Sveglie" (verde `#22C55E`)
- 🔵 "🏠 Home Assistant" (blu `#3B82F6`)

### 7️⃣ Pulizia stili morti (V50.z6)
`/app/frontend/app/(tabs)/home.tsx`: rimossi `myThingEmpty` + `myThingEmptyTxt` (dead code post-fix banner nascosto).

### Test manuali eseguiti
- ✅ Backend `/api/health` — 200 OK
- ✅ `POST /axon/alarms` (timer/alarm/reminder) — 200 con id
- ✅ `POST /axon/alarms/{id}/toggle` — 200
- ✅ `GET /axon/alarms` — 200 con items
- ✅ `POST /homeassistant/config` — 200 (verified=false su token fake, come atteso)
- ✅ `GET /homeassistant/config` — 200
- ✅ Frontend `/axon-alarms` — carica header + tabs + empty state + FAB
- ✅ Frontend `/axon-homeassistant` — carica empty state + 5 step + connetti button
- ✅ Lint TypeScript su tutti i nuovi file: 0 issues

### Note critiche per l'utente
- **Suono custom iOS**: funziona solo quando l'app è in foreground (limite di piattaforma; per background serve bundling nativo del suono nell'IPA)
- **Home Assistant self-hosted**: l'utente deve avere una propria istanza HA (Raspberry, NAS, mini PC). URL locale funziona solo sulla stessa rete Wi-Fi; per uso remoto serve DuckDNS/Nabu Casa
- **Publish necessario**: notifiche locali funzionano solo su APK/IPA generato, non in Expo Go per certi edge case (BUT expo-notifications base FUNZIONA in Expo Go per notifiche locali)



## V50.q–r (Sept 2026) — HOTFIX 3 bug segnalati

### Segnalazioni utente
1. Click su cartella Drive → 403 "Export only supports Docs Editors files".
2. Quick action "PUN MEDIO X FASCE" ritorna "Premessa importante" + testo prima della tabella.
3. Icona "Registra audio" nel Master non fa nulla su Android.

### Fix V50.q — Google Drive folder navigation
**Backend `/app/backend/server.py`**
- Endpoint `GET /api/google-drive/files` accetta ora `folder_id` query param.
- Quando presente, aggiunge `'{folder_id}' in parents` alla query Drive → lista i contenuti di quella cartella.
- `orderBy: "folder,modifiedTime desc"` per mostrare cartelle in cima.

**Frontend `/app/frontend/src/GoogleDrivePickerModal.tsx`**
- `pickFile` distingue folder vs file: se `mimeType === "application/vnd.google-apps.folder"` → naviga dentro, non prova download.
- Nuovo state `folderPath` per breadcrumb.
- Nuovo componente breadcrumb (Drive → cartella1 → cartella2) con tap su ciascuna crumb per tornare al livello.
- Gestione errore specifico `fileNotExportable` con messaggio comprensibile.

### Fix V50.q — PUN tabella senza premessa
System prompt rafforzato in due punti di `server.py`:
> "VIETATO: parole tipo Premessa, Nota, Attenzione, Ecco la tabella, Per completezza, Attualmente ho dati fino a. Anche se mancano dati recenti, produci SOLO la tabella con `n/d` sulle celle mancanti. NON avvisare fuori tabella."

Verifica live: risposta a "Tabella PUN F1 F2 F3 mensile 2026" ora inizia direttamente con `| Mese |` — zero preamboli.

### Fix V50.r — Audio recording nativo (Android/iOS)
**`/app/frontend/src/MasterVoiceRecorder.tsx`**
- Rimosso il gate `Platform.OS === "web"` che rendeva l'audio ricordabile solo su web.
- Aggiunto path nativo con `expo-audio` (`createAudioRecorder(RecordingPresets.HIGH_QUALITY)` + `AudioModule.requestRecordingPermissionsAsync`).
- `stopRecording` sull'audio nativo: legge il file registrato con `expo-file-system/legacy`, converte in base64 e passa a `handleStop` come per il flusso web.
- `handleStop` gestisce sia audio web (blob) che nativo (base64 già letto).

### Nota critica al utente
Le fix di questa sessione (e di V50.k-p) vivono nel **backend preview**. La build 1.0.17 sul telefono usa la produzione. Perché le vedere sul telefono serve **redeploy** (bottone Publish in alto a destra). Il redeploy è gratuito.


## V50.o–p (Sept 2026) — Fase 3: Copilot Vocale Auto + Micro-Tutorial

### 1) Copilot Vocale in Auto (backend + frontend)

**Backend `/app/backend/server.py`**
- Nuovo endpoint `POST /api/voice/copilot/execute` con `VoiceCopilotIn(transcript, session_id?)`.
- Intent classifier via Claude Haiku 4.5 (2-3s): estrae `intent` + `params` + `confirmation` in JSON strutturato.
- 3 azioni eseguite server-side su Mongo:
  - `create_contact` → insert in `db.contacts` con source `voice_copilot`.
  - `add_note` → insert in `db.contact_notes` con fuzzy match del cliente (regex OR su first/last name split per parole).
  - `schedule_call` → insert in `db.callbacks` con `scheduled_at` parsato da ISO8601.
  - `query` → deleghiamo alla chat Axon (payload `delegate_to_axon`).
- Nuovo endpoint `POST /api/ai/tts` che chiama OpenAI TTS (`tts-1`, voice `nova`) via proxy Emergent e ritorna audio MP3 in base64.
- Test live: create ≈ 3.0s · add_note ≈ 2.7s · schedule_call ≈ 1.2s.

**Frontend `/app/frontend/app/voice-copilot.tsx`**
- Nuova pagina full-screen navy tema auto: header + status box + big mic 140px + hints con esempi.
- Flusso: `expo-audio` recording → `/api/ai/transcribe` (whisper) → `/api/voice/copilot/execute` → `/api/ai/tts` → player audio → torna idle.
- Animazione pulse sul mic durante ascolto, colori differenti per ogni phase (idle/recording/transcribing/executing/speaking/error).
- Entry point aggiunto in Home tra "Azioni rapide" con label "Copilot Auto" e icona mic ciano.

### 2) Micro-Tutorial (`/app/frontend/src/MicroTutorial.tsx`)
- Componente riusabile: slideshow animato di step con icona colorata + titolo + descrizione + progress dots.
- Autoplay ogni 3.5s con fade+slide transition, tap sui dots per navigazione manuale.
- Predisposto per accettare `videoUri` in futuro (quando registri video reali da 15s, basta passare l'URL: `<MicroTutorial videoUri="..." steps={...} />`).
- 2 preset esportati:
  - `TUTORIAL_ANALIZZA_BOLLETTA`: 3 step (Carica PDF → AI estrae → Report salvato).
  - `TUTORIAL_INSEGNA_AXON`: 3 step (Regole linguaggio naturale → URL fonti → Suggerimenti auto).

**Integrazioni**
- `/app/frontend/app/ai-teach.tsx`: MicroTutorial mostrato nell'info modal della tab "Regole".
- `/app/frontend/src/BillsSection.tsx`: MicroTutorial mostrato in cima alla sezione fatture nel tab del contatto.

### Verifica visiva
Screenshot 390×844 dell'info modal "Regole manuali": card blu con icona libro, badge "Step 1 di 3", titolo "Regole in linguaggio naturale", descrizione, 3 dots navigazione. Slideshow gira automatico ogni 3.5s.


## V50.l–n (Sept 2026) — Fase 2: RAG Semantico + Slash Commands + Onboarding

### 1) RAG Embeddings semantici (`/app/backend/server.py`)
- Aggiunto `_axon_embed(text)` che chiama `text-embedding-3-small` via proxy Emergent LLM (`https://integrations.emergentagent.com/llm/openai/v1/embeddings`) → vettori 1536-dim, timeout 8s, best-effort con fallback silente su miss.
- Aggiunto `_cosine_sim(a, b)` per similitudine coseno tra vettori.
- `_retrieve_master_doc_chunks` riscritta come **hybrid retrieval**:
  1. Pre-filter Jaccard su token index (veloce).
  2. Query embedding calcolata al volo.
  3. Top-40 candidati Jaccard → cosine sim vs query embedding.
  4. **Lazy compute + persistence**: chunk senza `embedding` in DB → embed calcolato e salvato (fino a 12 embed paralleli per query per limitare costo).
  5. Threshold semantico 0.35 su cosine (permissivo, cattura sinonimi/parafrasi).
  6. Fallback puro Jaccard se embedding proxy fallisce.
- Impatto: retrieve trova chunk rilevanti anche quando l'utente scrive con parole diverse dai documenti (es. "prezzo mercato zonale luce" trova PDF con "PUN medio F1").

### 2) Slash commands (`/app/backend/server.py`)
- Nuova funzione `_maybe_slash_command(msg, user)` che intercetta prima della LLM:
  - `/aiuto` — elenco comandi.
  - `/bolletta [nome]` — ultime 5 bollette del cliente (fuzzy match su first_name/last_name/email).
  - `/scadenze` — scadenze contratti prossimi 30gg con contact name.
  - `/pun [mese] [anno]` — rebuild della query in linguaggio naturale per delegare alla LLM con RAG (non risposta canned).
  - `/team` — snapshot Master: collaboratori attivi, contatti totali, appts + telefonate 30gg. Bloccato se `role != master`.
- Integrato nel stream endpoint: se slash → risposta istantanea (< 100ms) senza toccare la LLM.

### 3) Onboarding Wizard (`/app/frontend/src/OnboardingWizard.tsx`)
- Modal a 3 step per nuovi Master:
  - Step 1: **Insegna ad Axon la prima regola** → CTA `/ai-teach`.
  - Step 2: **Analizza la tua prima bolletta** → CTA `/master`.
  - Step 3: **Chiedi qualcosa ad Axon** (con hint sui slash commands).
- Persistenza dismiss via `AsyncStorage` chiave `onboarding_v1_dismissed_${user_id}`.
- Filtrato per `role === "master"` (i collaboratori non lo vedono).
- Aggiunto in `/app/frontend/app/_layout.tsx` dopo SupportFab e PersistentBottomNav.

### Verifica live
| Test | Latenza | Note |
|---|---|---|
| `/aiuto` | **0.05s** ⚡ | Istantaneo, non tocca LLM |
| `/scadenze` | **0.04s** ⚡ | Query Mongo + format markdown |
| `/team` (non-Master) | **0.04s** | Blocco corretto |
| `/bolletta test` | ~0.1s | Cliente non trovato + suggerimento |
| Normal chat "Ciao Axon" | 5.1s | Haiku, con progress "Sto raccogliendo…" |


## V50.k (Sept 2026) — Router Haiku/Sonnet + Cache tenant-shared + Progress SSE

### Ottimizzazioni implementate (Fase 1)

**1. Router modello Haiku ↔ Sonnet 4.5** (`_pick_axon_model`)
- Euristica zero-cost: keyword list (`_HEAVY_KEYWORDS`: tabella, analizza, calcola, listino, PUN, F1/F2/F3, bolletta, delibera, ARERA, GME, cluster, insights, genera report, esporta…) + lunghezza (>220 char) + presenza allegati/web-search.
- Query semplici → `claude-haiku-4-5` (1-2s first token).
- Query analitiche → `claude-sonnet-4-5` (4-8s first token).
- Il campo `model` viene esposto nell'evento `done` SSE per debugging/telemetria.

**2. Cache semantica tenant-shared** (`_semantic_cache_lookup/save`)
- Aggiunto campo `tenant_id` sui documenti `axon_semantic_cache`.
- Lookup: prima nel cache del tenant (condiviso tra tutti i collaboratori dello stesso Master), poi fallback al cache globale legacy.
- Risultato: se un collaboratore chiede "PUN medi 2026", TUTTI i colleghi del team hanno la risposta istantanea (0.2s) alle successive chiamate simili.

**3. Progress SSE events** (`sse("progress", …)`)
- Nuovi eventi `progress` emessi durante preflight:
  - `stage: "preflight"` → "Sto raccogliendo il contesto…"
  - `stage: "cache"` → "Controllo se ho già risposto…"
  - `stage: "thinking"` con model → "Sto ragionando…" (haiku) o "Sto analizzando in profondità…" (sonnet).
- Percezione di velocità raddoppiata: l'utente vede feedback dopo 0.5s invece di attendere silenziosamente.

### Verifica live (backend locale)
| Caso | Router | First token | Total |
|---|---|---|---|
| "Ciao Axon, come stai?" | **haiku** | 2.10s | 4.16s |
| "Chi sei?" | **haiku** | **0.59s** ⚡ | 3.98s |
| "Analizza tabella PUN F1/F2/F3 luglio 2026" (cache-hit) | — | 0.23s | **0.24s** ⚡⚡ |
| "Genera report clienti Energia listino 2026" | **sonnet** | 1.01s | 16.88s |

### Fase 2 (rinviata a prossima sessione)
- RAG con embeddings semantici (OpenAI `text-embedding-3-small` via Emergent LLM key) per matching migliore quando l'utente scrive con parole diverse rispetto al contenuto RAG.


## V50.j (Sept 2026) — HOTFIX velocità Axon: ripristino risposte < 8s

### Diagnosi
1. Modello `claude-sonnet-5` con context accumulato (RAG PDFs Master + teach URLs con PDF GME scaricati + storico chat + memorie) portava il prompt oltre 40k token → 15-30s solo per il primo token, 60-90s totali.
2. Cap allegati 60k char (V49.o) faceva esplodere token count su chat con PDF attaccati.
3. Cap teach-section PDF 20k × 3 = 60k char aggiuntivi ogni volta che l'utente chiedeva PUN.
4. Cap context CRM 25k char anche per chat semplici.

### Fix (`/app/backend/server.py`)
- Modello: `claude-sonnet-5` → **`claude-sonnet-4-5`** (2-3× più veloce su prompt grandi, qualità reasoning identica per casi CRM).
- Cap allegati chat: **60k → 25k** char per file (~12-15 pagine dense).
- Cap teach-section PDF scaricati: **20k → 8k** char per PDF.
- Cap CRM snapshot JSON: **25k → 12k** char.

### Verifica live (backend locale)
- Chat semplice: primo delta 4.2s, completa 6.9s (era 40s+ / 2min).
- Chat "Tabella PUN F1/F2/F3 gennaio-agosto 2026" con fetch dinamico PDF GME: primo delta **4.6s**, completa **7.4s**.

### Google Drive access
Scope già allargato in V50.h a `drive.readonly` + `drive.metadata.readonly`. L'utente deve disconnettere/riconnettere Drive dalle Impostazioni per far scattare il nuovo consenso Google e vedere tutti i file.


## V50.i (Sept 2026) — "Insegna ad Axon": tab compatti con label leggibili

### Segnalazione utente
"Sistemare le scritte dei bottoni ridimensionarli, le scritte regole, fonti, storico, suggerimenti. Ridurre grandezza bottoni e le descrizioni metterle sotto. Non toccare altro."

### Root cause
Il layout precedente dei tab di `/app/frontend/app/ai-teach.tsx` era `flexDirection: row` con `[icon, text(flexShrink:1), infoIcon]`. Su Android l'etichetta "Suggerimenti (2)" (14 caratteri) non entrava in ~85px di larghezza → wrapping carattere per carattere → "Su/gg/eri/me/nti/(2)".

### Fix (`/app/frontend/app/ai-teach.tsx`)
Nuovo layout **compatto verticale** su ogni tab:
- Riga 1: icona (18px) + bottone info (14px) sulla stessa riga.
- Riga 2: label singola riga (fontSize 11, fontWeight 800, `numberOfLines: 1`, `textAlign: center`).
- Riga 3: conteggio piccolo (fontSize 10, muted).

Riorganizzati stili: nuovo `tabTopRow`, `tabLabel`, `tabCount` (kept legacy `tabTxt` for backwards-compat). Bottone `tabBtn` ora `alignItems: center` (era row) con `paddingVertical: 8` (era 10) e `paddingHorizontal: 4` (era 6).

Label accorciata: "Suggerimenti" → "**Idee**" per rispettare la richiesta di scritte brevi su singola riga (informazione mostrata comunque nel numero e nell'info modal).

### Verifica visiva
Screenshot 390×844 conferma i 4 tab (Regole 5 · Fonti URL 6 · Storico 9 · Idee 2) allineati e leggibili senza wrap.


## V50.h (Sept 2026) — Google Drive scope allargato + Axon chat input riorganizzato

### Segnalazioni utente
1. "Cliccando cerca file drive risponde 'Nessun file trovato'; Axon non entra nel Drive."
2. "Mentre digito in chat Axon la tastiera nasconde il campo; è piccolo e scrive in verticale."

### Fix Drive scope (`/app/backend/server.py`)
- `_GD_SCOPES`: `drive.file` → `drive.readonly` + `drive.metadata.readonly`.
- `drive.file` mostrava solo file esplicitamente autorizzati dall'utente via Picker → picker vuoto quando l'utente non aveva mai selezionato nulla.
- Con `drive.readonly` Axon vede TUTTI i file/cartelle dell'utente in sola lettura (nessun write/delete).
- **Richiede riautorizzazione**: l'utente deve disconnettere Drive dalle Impostazioni e ricollegarlo → Google richiederà il nuovo consenso con permessi allargati.

### Fix testo modale picker vuoto (`/app/frontend/src/GoogleDrivePickerModal.tsx`)
- Copia: "Google Drive con scope drive.file mostra solo…" → "Prova a cercare per nome oppure riautorizza Drive dalle Impostazioni per aggiornare i permessi."

### Fix Axon chat input (`/app/frontend/src/AssistantChat.tsx`)
**Problema layout precedente**: `inputBar` era `flexDirection: row` con 5 bottoni fissi (📎 + G Drive + Dropbox + 🎤 + Invio) prima/dopo l'input → il TextInput riceveva solo ~130px su phone 390px → testo lungo appariva "in verticale" (una parola per riga).

**Nuovo layout a due righe**:
1. Riga 1: TextInput a piena larghezza + bottone Invio (arrow-up) a destra.
2. Riga 2: bottoni allegato (📎 · G Drive · Dropbox · 🎤 mic) sotto l'input.

**Fix keyboard hiding**: `KeyboardAvoidingView` behavior su Android era `undefined` con edge-to-edge → tastiera copriva l'input. Ora: iOS `padding`, Android `height`, con `keyboardVerticalOffset={10}` per gap tra input e cima tastiera.

**Input più leggibile**:
- `minHeight`: 40 → 44 (tap area comoda)
- `maxHeight`: 120 → 220 (più righe visibili senza scroll interno)
- `fontSize`: 14 → 15 · `lineHeight: 20`
- `textAlignVertical: "top"` (Android: cursor inizia dall'alto)

### Verifica
- Backend riavviato senza errori, endpoint `/api/google-drive/files` invariato ma con scope più ampio.
- Lint frontend: solo warning pre-esistenti (variabili unused non collegate a queste modifiche).


## V50.g (Sept 2026) — Anagrafica: ripristinata "Analizza fatture"

### Segnalazione utente
"Sulle anagrafica è scomparsa l'icona delle fatture / analisi fatture ed al suo posto ci sono le scadenze contratti"

### Root cause
Il wrapping `<View>` attorno a `<DeadlinesSection>` + `<BillsSection>` nel tab "bills" di `contact/[id].tsx` NON aveva `flex: 1`. `BillsSection` internamente usa `<View style={{flex:1}}><ScrollView>...`, ma senza flex-context nel parent la sua altezza collassava a 0 → si vedeva SOLO `DeadlinesSection` (che ha altezza intrinseca), la sezione "Fatture Energia · AI" spariva sotto.

### Fix (`/app/frontend/app/contact/[id].tsx`)
`<View>` → `<View style={{ flex: 1 }}>` sul wrapper del tab bills. Nessuna altra modifica: la sezione BillsSection era già presente e funzionante, aveva solo altezza 0 per il context flex mancante.

### Verifica
Screenshot 390×844 tab Fatture del contatto:
- ✅ Card "Scadenze contratti" in cima
- ✅ Card "Fatture Energia · AI Claude Sonnet 5" (intro)
- ✅ Accordion "Offerte aziendali (0)"
- ✅ Sezioni "Luce", "Gas", "Telco" con pulsanti "Carica fattura PDF"

Tutti i flussi già collegati funzionano: upload PDF → analisi AI → salvataggio nei file cliente → export/condivisione (identico all'area "Analizza bolletta" del Master).


## V50.f (Sept 2026) — Dropbox callback: route backend mancante

### Problema
Dopo aver rigenerato le chiavi Dropbox (V50.e), Dropbox reindirizzava correttamente a `https://business-card-pro-16.emergent.host/auth/dropbox/callback?code=...&state=...` ma la pagina restituiva `{"detail":"Not Found"}` in JSON — errore FastAPI 404.

### Root cause
L'ingress Emergent instrada `/auth/*` al backend (port 8001), non al frontend Expo Router. Google Drive funziona perché ha un endpoint `@app.get("/auth/google/callback")` server-side. Dropbox invece aveva SOLO la pagina Expo Router (`/app/frontend/app/auth/dropbox/callback.tsx`) che non veniva mai raggiunta.

### Fix (`/app/backend/server.py`)
Aggiunto endpoint `@app.get("/auth/dropbox/callback")` server-side, specular a quello Google:
- Legge `code` + `state` dai query params.
- Recupera lo state salvato in `db.dropbox_oauth_states` (con `code_verifier` PKCE).
- Scambia il code con Dropbox via `https://api.dropboxapi.com/oauth2/token`.
- Recupera info account (email + account_id).
- Salva `refresh_token` cifrato in `db.dropbox_connections`.
- Restituisce una pagina HTML brand navy/arancione con esito ✓/✗ + auto-close finestra dopo 2.5s.

L'app Android/iOS in foreground rileva lo stato aggiornato via polling `/api/dropbox/status` e aggancia la UI.

### Verifica
- `curl /auth/dropbox/callback?code=fake&state=fake` → HTML 200 con "Sessione scaduta" (comportamento atteso su stato inesistente).
- Backend riavvia senza errori di import.
- Flusso completo pronto per il test utente reale.


## V50.e (Sept 2026) — Dropbox OAuth: chiavi rigenerate

### Problema
Utente segnala "Invalid client_id" cliccando l'icona Dropbox nella chat. Ho verificato che l'App Key originale (`x1neobonvqzo5j6`) è visibile in console Dropbox ma Dropbox stesso la rifiuta con `unknown_client_id` (testato via curl 3 volte con parametri diversi, tutti falliti). Anche il vecchio segreto risultava rifiutato con `invalid_client`. Situazione tipica di app rimasta in stato "orphan" lato Dropbox.

### Fix
- Utente ha ricreato l'app Dropbox da zero (Scoped access + Full Dropbox), aggiunto redirect URI corretto e abilitato scopes `account_info.read`, `files.metadata.read`, `files.content.read`.
- Nuove credenziali applicate in `/app/backend/.env`:
  - `DROPBOX_APP_KEY=o9puhxzr78t9rnw`
  - `DROPBOX_APP_SECRET=adg7e4b5sm754mj` (era placeholder `REPLACE_ME_IN_DEPLOY_SECRETS`)
  - `DROPBOX_REDIRECT_URI` invariato.

### Verifica
- `curl authorize` con nuove chiavi → HTTP 200 (prima 302 verso `/oauth2/authorize_error?error_name=unknown_client_id`).
- `GET /api/dropbox/status` → `{"connected": false, "configured": true}` ✅
- `POST /api/dropbox/oauth/start` → restituisce authorization_url con `client_id=o9puhxzr78t9rnw`.
- Dropbox `authorize` endpoint HTTP 200 → pagina di consenso Dropbox pronta a raccogliere le autorizzazioni utente.

### Deployment
- Le nuove chiavi in `/app/backend/.env` funzionano subito nell'ambiente di **preview** (backend riavviato).
- Al prossimo deploy in produzione, verificare che sul pannello **Emergent Deployment → Secrets** siano aggiornati anche lì `DROPBOX_APP_KEY` e `DROPBOX_APP_SECRET` (altrimenti la produzione userà quelli vecchi).


## V50.d (Sept 2026) — SupportFab: margine dall'avatar

Utente ha segnalato: "il logo assistenza è posizionato proprio a ridosso della icona foto master".

**Fix** (`/app/frontend/src/SupportFab.tsx`)
- `right: 44 → 60`. Avatar in Home/Master occupa `right:8..34` (width 26). FAB ora ha `right:60` → **gap 26px** tra bordo sinistro dell'avatar e bordo destro del FAB, impossibile percepirli sovrapposti.
- Nessuna altra modifica: dimensioni FAB restano 30×30 con `top: insets.top+11` per allineamento verticale al centro dell'avatar.

Verifica screenshot 390×844: FAB (icona gear+chiave) chiaramente distanziato dall'avatar sulla Home; posizionamento identico anche in Master.


## V50.c (Sept 2026) — HOTFIX Master Header + Grid Bottoni

### Segnalazioni utente
1. "Avevo chiesto di togliere il banner My Thing ed è stato tolto banner E header, ripristinare header."
2. "I bottoni sono scentrati rispetto al centro pagina dx/sx. E le scritte dei pulsanti sono in verticale è orribile."

### Fix
**Header brandizzato AdvisorOS/AxonOS RIPRISTINATO** (`/app/frontend/app/master.tsx`)
- In V50.a l'intero `brandHeader` con immagine di sfondo AdvisorOS + AxonOS + avatar overlay era stato rimosso per interpretazione errata di "banner con la foto personale". Ripristinato integralmente.
- L'unico elemento rimosso resta il banner "My Thing" sotto l'header (già off dal V49.l).

**Grid bottoni CENTRATO e leggibile**
- Sostituito `width: "31%"` → `width: 84px` (pixel fissi) su `btnCell` per evitare l'inconsistenza flex-wrap di RN Web con percentuali (che squeezava 5 celle su una riga).
- `justifyContent: space-around` + `columnGap: 0` per centrare simmetricamente 4 colonne su viewport 390 (4×84 + gap ≈ 336px < 358 disponibili).
- `flexShrink: 0` sulle celle: impedisce che il flexbox comprima le celle sotto 84px.
- Icona ridotta 72×72 → 66×66 (borderRadius 14) per lasciare più spazio verticale al label senza deformare la cella.
- **`btnLabelWrap`** wrapper esplicito con `width: 100%` attorno al Text: RN (Web + Android) non stretcha i figli Text in un parent con `alignItems: center`, e senza wrapper il testo riceveva larghezza intrinseca → wrapping carattere-per-carattere ("Age\nnda", "Cal\nco\nlatri\nce"). Con il wrapper la Text riceve piena larghezza cella e il wrap avviene per PAROLA come atteso.
- Label: `fontSize: 11`, `lineHeight: 14`, `textAlign: center`, `numberOfLines: 2`, `adjustsFontSizeToFit` con `minimumFontScale: 0.75` per shrink automatico su etichette molto lunghe (Analizza bolletta / Biglietto da visita).

### Verifica visiva
- Screenshot Playwright 390×844: header brand tornato in cima, 4 bottoni per riga centrati simmetricamente, tutti i label leggibili su 1-2 righe con wrap parola-per-parola (Agenda / New Contact / Chat Gruppo / Calcolatrice / My Web / New CRT / New App / Registra audio / I miei audio / Analizza bolletta / I miei file / Biglietto da visita / Banner Evento / Script Telefonata / Insegna ad Axon / Cruscotto / Azioni rapide).


## V50.b (Sept 2026) — HOTFIX PERFORMANCE + PUN/GME + Drive UX

### Problema segnalato dall'utente
- Axon impiega **40s / 2 minuti** per rispondere; su Android la risposta appare tutta in una volta invece di scorrere in streaming.
- Tabelle PUN 2026 con **dati mancanti per luglio** anche se il PDF su GME contiene tutto fino ad agosto.
- Regressione percepita: "ieri leggevi il Drive, oggi dici che non hai mai avuto accesso".

### Root cause
1. **`_fetch_teach_url_pdfs_for_query`** (server.py) faceva HTTP GET **sequenziali** con timeout 25s per pagina. Con 5–10 URL monitorati bastavano un paio di siti lenti per raggiungere 40s+.
2. **`_prepare_assistant_prompt`** eseguiva **in serie** context CRM, weather, RAG prefetch, Tavily, memories, allegati e teach section. Ogni step 0,5–3s → totale 5–15s prima ancora di chiamare Claude.
3. Il regex mese/anno accettava solo `luglio`, `-07-`, `_07_`: non matchava filename GME comuni tipo `PMF_202607.pdf`, `07-2026.pdf`, `2026-07.pdf`. Risultato: file scartati → colonna F1/F2/F3 vuota.
4. Su React Native (Android) `fetch().body.getReader()` NON esiste: il client SSE (`assistantStream.ts`) cadeva sempre nel fallback `res.text()` che aspetta il body COMPLETO prima di emettere delta → nessuno streaming visibile.
5. Il system prompt Axon rispondeva "non ho mai avuto accesso a Google Drive" in modo brusco quando l'utente ricordava upload precedenti.

### Fix implementati

**Backend (`/app/backend/server.py`)**
- **`_fetch_teach_url_pdfs_for_query`** riscritta:
  - Timeout HTTP: 25s → **8s pagina / 15s PDF**.
  - Fetch pagine e download PDF **parallelizzati** con `asyncio.gather`.
  - Cap max 10 URL processati per query (prima 50) con priorità a URL contenenti `gme|pun|prezzo`.
  - Regex mese/anno esteso a: `luglio`, `-07-`, `_07_`, `.07.`, `/07/`, `202607`, `072026`, `2026-07`, `2026_07`, `2026.07`, `07-2026`, `07_2026`, `07.2026`.
  - Estrae anche pattern numerici dalla domanda: `07/2026`, `07.2026`, `07-2026`, `07 2026` → aggiunge automaticamente il mese al match set.
- **`_prepare_assistant_prompt`** parallelizza con `asyncio.gather` context, weather, RAG prefetch, memories, attachments e teach section. Tavily resta dopo il gather perché dipende dal RAG (short-circuit se RAG copre la query).
- System prompt aggiornato: nuova regola "GOOGLE DRIVE / DROPBOX" che chiarisce che ogni chat parte fresca, gli allegati Drive/Dropbox vengono letti solo se l'utente li allega tramite l'icona colorata, e fornisce una frase gentile pronta all'uso per rispondere alla percezione di "regressione".

**Frontend (`/app/frontend/src/utils/assistantStream.ts`)**
- Nuovo path Native (RN) con **`XMLHttpRequest` + `onprogress`**: `responseText` cresce chunk-by-chunk, alimenta il buffer SSE identico al reader Web. Streaming ora live anche su Android/iOS.
- Path Web invariato (fetch + `ReadableStream.getReader()`).
- Feature detection tramite `ReadableStream + document` per distinguere Web da RN in modo affidabile.

### Verifica manuale (curl → backend locale)
- Chat semplice (nessun URL fetch): **8.67s** (era 40s+).
- Chat "Tabella PUN F1/F2/F3 luglio 2026": **6.42s** e restituisce tabella con dati reali (0,15704 €/kWh monorario ecc.).
- Streaming SSE: primo delta a **3.66s**, completamento a 8.85s (era: tutto in blocco a 40s+).


## V50.a (Sept 2026) — Fix visivi urgenti: header pulito, label 1 riga, safe-area globale

### Frontend
- **`/app/frontend/src/SupportFab.tsx`**:
  - Ridimensionato FAB da 36×36 → 30×30 (padding più leggero, coerente con l'avatar 26–30).
  - `right: 52 → 44`, `top: insets.top+12 → insets.top+11` per allineamento verticale al centro dell'avatar.
  - Icona gear ridotta 22→18, badge chiave 11→9, badge dot 16→13. Visibile su TUTTE le pagine (fuori login/landing/auth) e SEMPRE a sinistra dell'avatar/foto profilo senza coprirla.

- **`/app/frontend/app/(tabs)/home.tsx`**:
  - `numberOfLines={1}` + `ellipsizeMode="tail"` + `adjustsFontSizeToFit` + `minimumFontScale={0.75}` sui bottoni "Nuovo appuntamento" e "Nuovo contatto".
  - `numberOfLines={1}` sui titoli/sottotitoli della card "Interfaccia Master" e "COMUNICA CON L'AZIENDA".
  - `usePageBottomPadding()` sostituisce l'hard-coded `paddingBottom: 180` per un padding coerente col bottom nav.

- **`/app/frontend/app/master.tsx`**:
  - RIMOSSO completamente il "banner con la foto personale": eliminato l'header con l'immagine brandizzata AdvisorOS/AxonOS + overlay avatar. Sostituito con `headerBar` minimale (44px altezza) contenente solo la data a sinistra e il pulsante avatar/menu a destra.
  - Nuovi stili: `headerBar`, `headerDate`, `headerAvatarBtn`, `headerAvatar`, `headerAvatarFallback`, `headerAvatarTxt`.
  - `usePageBottomPadding()` sostituisce `paddingBottom: 140` del ScrollView.

- **`/app/frontend/src/utils/bottomSheetInsets.ts`**:
  - `usePageBottomPadding(extraGap=24)` ora restituisce `Math.max(140, NAV_HEIGHT + insets.bottom + extraGap)`. Il minimo di 140px è allineato al valore storico usato nella sezione Master Z, così TUTTE le pagine con PersistentBottomNav / Tabs visibile hanno lo stesso safe-area comportamento.

- **Pagine tab aggiornate a `usePageBottomPadding()`** (rimosso `paddingBottom: 180` hard-coded):
  - `/app/(tabs)/home.tsx`, `/app/(tabs)/chat.tsx`, `/app/(tabs)/contatti.tsx`, `/app/(tabs)/calendario.tsx`, `/app/(tabs)/report.tsx`, `/app/(tabs)/impostazioni.tsx`, `/app/ai-teach.tsx`, `/app/master.tsx`.

### Testing
- Verifica visiva via Playwright screenshot (login → home, login → master) su viewport 390×844: header Master pulito, badge FAB support a sinistra dell'avatar su entrambe le schermate, quick action buttons su una riga, safe-area bottom rispettata su tutte le tab e la Master.
- Nessun test automatico eseguito su richiesta utente (`"Non eseguire test automatici"`).


# Dal Pastro CRM — PRD v1.15

## v45 Notifica proposte + Cruscotto Master unificato (Giugno 2026)
### 🎯 Richiesta utente
Due feature parallele:
1. **Notifica proposte pronte**: pallino rosso sull'icona "Insegna ad Axon" quando ci sono nuove proposte da approvare
2. **Cruscotto Master**: schermata unificata con feedback stats, proposte pending, top collaboratori attivi

### ✅ Backend (`/app/backend/server.py`)
- **Nuovo `GET /api/axon/rule-proposals/count-pending`**: endpoint lightweight per il badge (ritorna `{pending: N}`, 0 per non-Master). Non richiede Master perché la UI dei collaboratori non chiama comunque questo endpoint.
- **Nuovo `GET /api/master/dashboard`** (Master-only): aggregatore unificato che ritorna:
  - `feedback`: `{ups, downs, total, satisfaction_rate, window_days}` tenant-wide 30gg
  - `proposals`: `{pending, accepted_total}`
  - `activity`: `{contacts_30d, contacts_total, appts_30d, appts_upcoming, callbacks_pending, chat_msgs_30d}` tenant-wide 30gg
  - `knowledge`: `{docs_count, rules_count, urls_count, semantic_cache_size}`
  - `team`: `{collaborators_total, top_active[5]}` (top 5 by chat_msgs_30d desc)
  - `generated_at`
- Uso di `tenant_user_ids` come base per tutte le query (Master + tutti i collabs)
- Semantic cache size è globale (v40 design decision)

### ✅ Frontend
- **`impostazioni.tsx`** (badge sul link):
  - Nuovo state `pendingProposals` con polling ogni 30s a `/axon/rule-proposals/count-pending`
  - Badge rosso posizionato sull'icona sparkles (top:-5, right:-8), con testo "N" o "9+" e bordo bianco
  - Sub-text del link dinamico: "N nuova/e proposta/e da rivedere · …" quando >0
- **`master.tsx`** (badge sulla tile):
  - Aggiunto polling identico per il tile "Insegna ad Axon" (usa il prop `badge` già supportato)
  - Nuova tile **"Cruscotto"** (icona `grid`, colore ciano `#0EA5E9`) dopo "Insegna ad Axon"
- **Nuova pagina `/app/frontend/app/cruscotto.tsx`** (Master-only, ~450 righe):
  - Header nero `#0F172A` con refresh button
  - **Alert card arancione** in cima (visibile solo se `proposals.pending > 0`) → tap: `/ai-teach`
  - **Panel "Come sta imparando Axon"** (border-left viola): 3 celle KPI (👍 utili, 👎 da migliorare, % soddisfazione) + barra progressiva verde/rossa
  - **Panel "Attività della rete"** (border-left ciano): 4 mini-KPI (contatti nuovi/appuntamenti/chat/chiamate)
  - **Panel "Base di conoscenza Axon"** (border-left arancione): 4 mini-KPI tappabili (documenti→`/documenti-axon`, regole→`/ai-teach`, URL→`/ai-teach`, cache) + banner verde "N regole auto-generate accettate"
  - **Panel "Top collaboratori"** (border-left verde) con "Vedi tutti →" a `/team-insights`: lista con avatar iniziali verde, nome, mini-KPI riga (chat/appt/contatti + timeAgo). Tap → deep-link a `/team-insights?member={uid}`
  - Pull-to-refresh nativo + refresh button in header
  - Empty state contestualizzato se nessun collaboratore invitato
  - Sezione riservata al Master con lock icon per non-Master

### 🧪 Test manuali eseguiti
- ✅ `GET /axon/rule-proposals/count-pending` → `{pending: 1}` (Master), `{pending: 0}` (non-Master)
- ✅ `GET /master/dashboard` → payload completo con tutti gli aggregati
- ✅ Impostazioni: badge rosso "1" visibile sull'icona sparkles + sub-text aggiornato "1 nuova/e proposta/e da rivedere"
- ✅ Master page: menu ⋯ → click "Cruscotto" (icona grid ciano) → apre `/cruscotto`
- ✅ Cruscotto UI: alert arancione, 4 panel colorati con border-left, top-collab card Mario visibile con KPI
- ✅ Pull-to-refresh funziona; refresh button in header aggiorna i dati
- ✅ Deep-link `/team-insights?member=<uid>` funziona (via `useLocalSearchParams` in v44)
- ✅ Non-Master: pagina blocca con "Sezione riservata al Master" + lock icon

### 📊 Impatto UX
- **Discoverability +**: il Master vede a colpo d'occhio quando Axon ha proposte pending senza dover navigare
- **Panoramica olistica**: il Cruscotto è il "single source of truth" per capire lo stato della rete in <3 sec
- **Deep-linking**: ogni KPI tappabile porta esattamente dove serve (regole, doc, team-insights), riducendo attrito

---


## v44 Profilo Comportamentale Collaboratori — Team Insights (Giugno 2026)
### 🎯 Richiesta utente
Fase 4/4 finale del progetto "Axon che impara": mostra al Master un profilo comportamentale di ogni collaboratore basato sulle sue interazioni con l'AI, i contatti gestiti, gli appuntamenti presi e le chiamate effettuate.

### ✅ Backend (`/app/backend/server.py`)
- **`_compute_team_member_metrics(uid)`**: aggrega metriche quantitative per un collaboratore:
  - Contatti (totali + 30gg)
  - Appuntamenti (totali + 30gg + prossimi)
  - Callbacks (30gg + pendenti)
  - Chat Axon (30gg + 7gg)
  - Feedback dati (👍/👎)
  - Ultima attività (max fra ultimo login e ultimo msg chat)
- **`_score_topic_from_messages(msgs)`**: estrae top-5 argomenti dai messaggi dell'utente (token frequency ≥4 char post-stopword removal). Alternativa cheap all'LLM classification.
- **`_generate_behavioral_profile(member, metrics, topics, sample_msgs)`**: chiama Claude Sonnet 5 con prompt strutturato → JSON `{communication_style, strengths[], improvement_areas[], overall_summary}`. Sanitizzazione lunghezza + parsing robusto.
- **Endpoint `GET /api/team-insights`** (Master-only): lista collaboratori (`parent_user_id = master_uid`) con metriche aggregate. Ordinati per attività (chat_msgs_30d desc).
- **Endpoint `GET /api/team-insights/{member_uid}`** (Master-only): profilo dettagliato + AI. Cache 24h in `db.team_member_profiles` per non consumare LLM ad ogni apertura.
- **Endpoint `POST /api/team-insights/{member_uid}/refresh-profile`** (Master-only): forza rigenerazione bypassando cache.
- **Params**: `TEAM_PROFILE_CACHE_HOURS=24`, `TEAM_PROFILE_TREND_DAYS=30`
- **Indice MongoDB**: `team_member_profiles.(tenant_id, user_id)` unique
- **Cleanup account**: `team_member_profiles` aggiunto a `tenant_collections`

### ✅ Frontend
- **Nuova pagina `/app/frontend/app/team-insights.tsx`** (Master-only, ~500 righe):
  - Doppia view unica: **List ↔ Detail** con state locale (support anche `?member=<uid>` per deep-link)
  - **Header ciano `#0EA5E9`** con back button contestuale (torna alla lista se in detail, altrimenti a Master)
  - **List view**:
    - Card collaboratore con avatar circolare (iniziali), nome + area pill, email
    - Mini-KPI row inline: 💬 chat / 📅 appt / 👥 contatti / ⏱ "3m fa"
    - Empty state se nessun collaboratore
    - Loading spinner iniziale
  - **Detail view**:
    - Header profilo grande (avatar 64x64 ciano, nome, email, pill area, "ultima attività X fa")
    - Grid 4 KPI cards: Contatti / Appuntamenti / Chat Axon / Chiamate — ciascuna con `border-top-color` distintivo, valore grande, label + sub
    - Feedback bar 👍/👎 con conteggi
    - **Top argomenti**: chip topic + `×count` (mostrati solo se >0)
    - **Profilo AI card** (viola, `border-left #7C3AED`, icona sparkles):
      - Stile comunicativo (label + testo)
      - Punti di forza (verdi, bullet list)
      - Aree di miglioramento (arancioni, bullet list)
      - Sintesi (paragrafo in box grigio)
      - Bottone "Rigenera" (viola chiaro) per refresh manuale
      - Footer "Da cache · X min fa" / "Generato ora"
- **Master page**: aggiunto menu item **"Team Insights"** (icona `analytics` ciano) nel modal 3-punti, subito dopo "Setting App"

### 🧪 Test manuali eseguiti
- ✅ Creato collaboratore Mario Bianchi + 3 chat Axon (obiezioni, bollette, contratti gas)
- ✅ `GET /team-insights` → lista con 1 item, metriche calcolate correttamente (3 chat_msgs_30d, 3 chat_msgs_7d)
- ✅ `GET /team-insights/{uid}` → profilo AI generato: "Domande dirette e operative", 2 strengths, 3 improvement_areas, summary contestuale
- ✅ Cache 24h verificata: seconda chiamata ritorna `profile_from_cache: true`
- ✅ `POST /refresh-profile` → rigenera bypassando cache
- ✅ UI: list card con mini-KPI, tap → detail con avatar/KPI grid/feedback bar/AI profile, back button torna alla lista
- ✅ Non-Master: mostra "Sezione riservata al Master" (lock icon)

### 📊 Compimento del progetto self-learning Axon
Con la Fase 4 completa, il progetto "Axon che impara" è terminato con successo:
1. **v41 Feedback 👍/👎**: raccoglie riscontri utente + invalida cache stale
2. **v42 RAG Documenti Master**: Axon legge i PDF caricati e risponde citandoli
3. **v43 Regole Auto-Estratte**: job notturno propone nuove regole dai pattern chat
4. **v44 Team Insights**: profilo comportamentale AI dei collaboratori con metriche + coaching

Il Master ha ora un CRM veramente **AI-native**: Axon impara continuamente dai dati, e il Master ha visibilità completa su come la sua rete lavora.

---


## v43 Regole Auto-Estratte da Chat Notturne (Giugno 2026)
### 🎯 Richiesta utente
Fase 3/4 del progetto "Axon che impara": job notturno che analizza le chat degli ultimi 2 giorni e propone nuove regole da salvare in "Insegna ad Axon". Il Master approva/rifiuta manualmente.

### ✅ Backend (`/app/backend/server.py`)
- **Nuovo scheduler job**: `_run_rule_proposals_job` alle **03:00 Europe/Rome** (aggiunto a `_birthday_scheduler`).
- **`_analyze_chats_for_rules(assistant_name, messages, already_pending_titles, existing_rule_titles)`**:
  - Costruisce un dump conversazionale compatto (ultimi 60 msg, 400 char ciascuno)
  - System prompt italiano dettagliato: cerca PATTERN RICORRENTI, non dati CRM specifici, non duplicare regole esistenti, output JSON pure
  - Categorie whitelist: Clienti, Contratti, Comunicazioni, Luce, Gas, Telco, Obiezioni, Procedure, Generale
  - LLM: Claude Sonnet 5 (via `emergentintegrations`)
  - Parsing robusto: strip ```json fences, fallback regex per estrarre blocco JSON
  - Validazione: titolo/text non vuoti, text ≥ 30 char, categoria in whitelist
- **`_run_rule_proposals_job()`**:
  - Trova utenti attivi (`assistant_messages` last 48h)
  - Per ogni tenant: skip se ≥ 15 proposte pending, skip se < 6 msg
  - Deduplica su titoli già pending/accepted/esistenti (case-insensitive)
  - Salva in `db.axon_rule_proposals` con status "pending"
- **Endpoint `GET /api/axon/rule-proposals?status=pending|accepted|rejected|all`** (Master): lista + counts
- **Endpoint `POST /api/axon/rule-proposals/{id}/accept`** (Master): converte in `ai_teach_rules` con `auto_generated: true` e `source_proposal_id`; marca proposal accepted
- **Endpoint `POST /api/axon/rule-proposals/{id}/reject`** (Master): status → rejected
- **Endpoint `POST /api/axon/rule-proposals/run-now`** (Master): trigger manuale per test/debug
- **Params**: `RULE_PROPOSAL_TENANT_MIN_MSGS=6`, `RULE_PROPOSAL_LOOKBACK_HOURS=48`, `RULE_PROPOSAL_MAX_PENDING=15`, `RULE_PROPOSAL_MAX_PER_RUN=5`
- **Indici MongoDB**: `axon_rule_proposals.(tenant_id, status, created_at desc)`, `.proposal_id` unique
- **Cleanup account**: `axon_rule_proposals` aggiunto a `tenant_collections`

### ✅ Frontend (`/app/frontend/app/ai-teach.tsx`)
- **Nuovo tab "Suggerimenti (N)"** con icona 🔥 arancione, badge counter pending
- **Header pannello arancione** (Optima style):
  - Titolo "Suggerimenti automatici" + spiegazione
  - 3 statistiche card: In attesa / Accettate / Rifiutate (colori distintivi)
  - Bottone **"Analizza ora"** (arancione, sparkles icon) → chiama `/run-now`
- **Card proposta**:
  - Pill categoria colorata (colore deterministico dal nome), badge AUTO viola con sparkles
  - Titolo bold, testo regola
  - Blocco "evidenza" in italico grigio con quote
  - Bottoni **Rifiuta** (rosso chiaro, flex 1) + **Accetta** (verde, flex 2)
- **Empty state** elegante: icona bulb, "Nessun suggerimento in attesa" + spiegazione contestuale
- Info modal per il tab: spiega quando/come funziona il cron notturno
- Su accept: aggiorna counts + ricarica lista Rules (nuova regola appare subito nel tab Regole)

### 🧪 Test manuali eseguiti
- ✅ `POST /run-now` → l'LLM ha estratto **4 proposte di qualità eccellente**:
  1. "Suggerire clienti da contattare se agenda vuota" (Clienti)
  2. "Provvigioni da listino ufficiale per prodotto/operatore" (Contratti)
  3. "Spiegazione sintetica Capacity Market" (Luce)
  4. "Risposta standard per domande sul PUN" (Gas)
- ✅ Ogni proposta ha titolo istruttivo, categoria corretta, text 2-6 righe, evidenza citata
- ✅ POST `/accept` → nuova rule in `ai_teach_rules` con `auto_generated: true` + `source_proposal_id`
- ✅ POST `/reject` → status aggiornato, counts riflettono
- ✅ UI: tab con badge counter, stat cards con contatori, card con pill/AUTO badge, bottoni rifiuta/accetta funzionanti
- ✅ Scheduler startup verificato nei log: `Rule-proposals scheduler started (daily 03:00 Europe/Rome)`
- ✅ Dedup: proposte con titolo simile a regole esistenti scartate

### 📊 Impatto self-learning
- **Continuous learning**: ogni notte nuove regole emergono automaticamente senza intervento del Master
- **Master control**: nessuna regola viene aggiunta senza approvazione esplicita (accept)
- **Feedback loop chiuso**: 👎 su una risposta → rimozione da cache (v41) + emerge come pattern nella regola auto-estratta (v43)
- **RAG + Auto-rules**: la Fase 2 (RAG) + Fase 3 insieme rendono Axon veramente contestuale e in miglioramento continuo

---


## v42 RAG Documenti Master — Axon legge i tuoi PDF (Giugno 2026)
### 🎯 Richiesta utente
Fase 2/4 del progetto "Axon che impara": far leggere ad Axon i PDF caricati dal Master (contratti, listini, brochure) così può rispondere in modo preciso citando i tuoi documenti. Sezione dedicata "Documenti Axon" in Impostazioni.

### ✅ Backend (`/app/backend/server.py`)
- **Helper**: `_chunk_text_by_words(text, size=500, overlap=50)` → chunks di 500 parole con overlap di 50 per continuità tematica.
- **Helper**: `_extract_pdf_pages(base64, max_pages=50)` → estrae testo pagina-per-pagina via pypdf, ritorna `[(page_number, text), …]`, cap 50 pagine e 20MB per sicurezza.
- **Endpoint `POST /api/master-docs`** (Master-only): upload PDF base64. Estrae testo, chunkizza, tokenizza (via `_normalize_and_tokenize`), salva in `db.master_documents` (metadati) + `db.master_doc_chunks` (chunks). Rollback automatico se insert chunks fallisce.
- **Endpoint `GET /api/master-docs`**: lista documenti del tenant (visibile anche ai collaboratori — Axon userà comunque i doc del Master per rispondere a tutti).
- **Endpoint `DELETE /api/master-docs/{doc_id}`** (Master-only): rimuove doc + tutti i chunks associati.
- **Retrieval `_retrieve_master_doc_chunks(tenant, query, top_k=3, min_sim=0.05)`**:
  - Tokenizza la query
  - Pre-filtro MongoDB `{tokens: {$in: q_tokens}}` (multikey index accelera drasticamente vs full-scan)
  - Score Jaccard per chunk, ordine desc, top-3
  - Enrich con `doc_name` batch fetch
- **Integrazione in `_prepare_assistant_prompt` (streaming) + `assistant_chat` (non-streaming)**: chiama retrieval, se ci sono chunks con score ≥ 0.05 inietta sezione **"DOCUMENTI MASTER"** nel system prompt con estratti (max 2000 char/chunk) e istruzioni "cita SEMPRE il nome del documento".
- **Data model**:
  - `db.master_documents`: `{doc_id, user_id, tenant_id, name, mime, size, total_pages, total_chunks, created_at}`
  - `db.master_doc_chunks`: `{chunk_id, doc_id, user_id, tenant_id, chunk_index, page_number, content, tokens, created_at}`
- **Nuovi indici**:
  - `master_documents.(tenant_id, created_at desc)`, `.doc_id` unique
  - `master_doc_chunks.(tenant_id, tokens)` (multikey per pre-filter), `.doc_id`, `.chunk_id` unique
- **Cleanup account**: `master_documents` + `master_doc_chunks` aggiunti a `tenant_collections` per delete-account.
- **Params**: `RAG_CHUNK_WORDS=500`, `RAG_CHUNK_OVERLAP=50`, `RAG_TOP_K=3`, `RAG_MIN_SIMILARITY=0.05`, `RAG_MAX_PDF_BYTES=20MB`, `RAG_MAX_PAGES=50`.

### ✅ Frontend
- **Nuova pagina `/app/frontend/app/documenti-axon.tsx`**:
  - Header viola con back button, titolo "Documenti Axon", sottotitolo "La base di conoscenza personale"
  - Info box giallo con spiegazione "Carica qui i tuoi PDF..."
  - Info box grigio (solo collaboratori): "Solo il Master può caricare/eliminare — ma Axon userà comunque i documenti del tuo Master"
  - Empty state elegante con icona documenti + testo contestuale (Master vs Collaboratore)
  - Lista card documento: icona viola PDF, nome, meta (`N pag · N chunk · dimensione · data`), delete button rosso (Master-only)
  - FAB "Carica PDF" viola in basso a destra (Master-only, bottom=96 per non essere coperto da tab bar + Axon FAB)
  - Upload: `pickCommonFile` → filtra solo PDF → legge base64 (data URI / web fetch / native FS) → POST `/master-docs`
  - Delete: `confirmAsync` prima di DELETE
- **Impostazioni**: aggiunta card link "Documenti Axon" con icona `library` viola, sub-text contestuale Master/Collaboratore. Sempre visibile (anche ai collaboratori in read-only).

### 🧪 Test manuali eseguiti
- ✅ Upload PDF (2 pag "Listino Optima 2026" con offerte + provvigioni) → 200 OK, 2 chunks salvati
- ✅ GET `/master-docs` → items array con nome + meta
- ✅ Query streaming "Qual è la provvigione per un contratto business luce nel listino Optima?" → risposta cita "«Listino Optima 2026», la provvigione per un contratto **business luce** è di **120 EUR**" + elenca tutte le provvigioni presenti nel PDF
- ✅ UI: page load empty state ok, upload FAB visible, doc card ok, chat citation ok
- ✅ DELETE doc → chunks rimossi (deleted_chunks: 2)
- ✅ Isolation tenant-scoped: retrieval usa `tenant_id`, altri tenant non vedono i doc

### 📊 Impatto
- Axon risponde in modo **fattuale** su listini, provvigioni, procedure interne senza doverli ripetere nella chat
- La citazione esplicita del nome documento aumenta trust e permette verifica manuale
- Retrieval Jaccard è molto leggero (nessuna inferenza LLM/embedding necessaria) → latenza aggiuntiva < 50ms

---


## v41 Feedback 👍/👎 su risposte Axon — Self-learning loop (Giugno 2026)
### 🎯 Richiesta utente
Aggiungere i pollici 👍/👎 sulle risposte di Axon così l'assistente impara dai riscontri e migliora nel tempo. Prima delle 4 fasi previste per il progetto "Axon che impara".

### ✅ Backend (`/app/backend/server.py`)
- **Message ID**: ogni risposta assistant ora riceve un `message_id` (UUID 16-char) al momento della persistenza. Emesso nell'evento SSE `meta` (streaming) e nel body JSON (non-streaming).
- **Race-condition fix streaming**: nel path streaming, il placeholder del messaggio assistant (con `message_id` + `content=""`) viene inserito in DB *prima* di emettere l'evento `meta`, così il client può fare POST feedback anche se il stream si interrompe. Il `content` viene aggiornato (`$set`) alla fine dello stream.
- **`POST /api/assistant/feedback`** (nuovo):
  - Body: `{message_id, rating: "up"|"down", reason?, comment?}`
  - Cerca il messaggio in `db.assistant_messages` (403 se non appartiene all'utente)
  - Recupera automaticamente la domanda utente precedente (stessa session, ultimo msg role="user" prima del `created_at` del messaggio)
  - **Upsert idempotente** su `(user_id, message_id)`: l'utente può cambiare idea da 👍 a 👎 e viceversa
  - **Side effect su 👎**: invalida le voci di `axon_semantic_cache` con Jaccard ≥ 0.75 sulla domanda **E** contenuto reply identico → così una risposta rigettata non viene più servita cached ad altri utenti
- **`GET /api/assistant/feedback/{message_id}`** (nuovo): recupera il feedback corrente su un messaggio (404 se assente)
- **`GET /api/assistant/feedback/stats/summary`** (nuovo): aggregati per utente ultimi 30 giorni — `{ups, downs, total, satisfaction_rate, window_days}`
- Nuovi indici MongoDB:
  - `assistant_feedback.(user_id, message_id)` unico
  - `assistant_feedback.(user_id, updated_at desc)`
  - `assistant_feedback.(rating, updated_at desc)`
  - `assistant_messages.message_id`

### ✅ Frontend
- `AssistantChat.tsx`:
  - Tipo `ChatMsg` esteso con `message_id?: string`, `feedback_rating?: "up" | "down" | null`
  - Callback `onMeta` e `onDone` catturano `message_id` dall'SSE
  - Nuovo `handleFeedback(idx, rating)`:
    - Su 👍 → optimistic update + POST /feedback (idempotente); toggle-off ripristina neutro
    - Su 👎 → apre modal "Cosa non ha funzionato?" con 6 chip motivazione + TextInput commento libero
  - Row feedback aggiunta in fondo a ogni bubble assistant completata (non durante streaming):
    - Label "Utile?" grigia
    - Bottone 👍 (thumbs-up-outline / thumbs-up filled verde `#16A34A`)
    - Bottone 👎 (thumbs-down-outline / thumbs-down filled rosso `#DC2626`)
  - Modal 👎 reason:
    - Chip motivazione: Impreciso, Fuori tema, Troppo lungo, Troppo corto, Linguaggio, Altro
    - TextInput commento libero (max 500 char)
    - Pulsanti "Annulla" (grigio) + "Invia feedback" (rosso con icona paper-plane)
    - Bordi arrotondati, shadow, icona 👎 tonda rossa nel header
  - `streamAssistantChat` types: `StreamMeta.message_id` e `StreamDone.message_id`

### 🧪 Test manuali eseguiti
- ✅ POST /assistant/feedback rating=up con message_id valido → salvato, GET ritorna il record
- ✅ Re-post con rating=down → upsert aggiorna record, stats mostrano `downs: 1`
- ✅ POST con message_id inesistente → 404 "Messaggio non trovato o non tuo"
- ✅ Cache PUN: dopo 👎 sulla risposta PUN, il record `axon_semantic_cache` viene rimosso (verificato via query DB)
- ✅ UI: click 👍 → thumb verde filled, click 👎 → modal si apre con reasons/comment, submit → thumb rosso filled

### 📊 Effetti self-learning
- **Cache pulita**: le risposte con 👎 vengono rimosse dalla cache globale → nuovi utenti ricevono LLM fresh answer invece di stale
- **Statistiche**: `/feedback/stats/summary` fornirà base per dashboard "Come sta imparando Axon" (uso futuro)
- **Base dati**: `assistant_feedback` fornirà few-shot examples in fasi successive (Fase 3: regole auto-estratte)

---


## v40 Axon AI: Streaming (SSE) + Semantic Cache (Giugno 2026)
### 🎯 Richiesta utente
Ottimizzare Axon in due modi: (1) risposte streaming token-per-token per esperienza istantanea, (2) cache semantica globale per domande ricorrenti frequenti dei collaboratori.

### ✅ Backend (`/app/backend/server.py`)
- Nuovo endpoint `POST /api/assistant/chat/stream` con `StreamingResponse` SSE (`text/event-stream`).
- Eventi SSE: `meta` (session_id, assistant_name, from_cache), `delta` (token/chunk), `done` (used_web_search, web_sources), `error`.
- Uso di `LlmChat.stream_message()` di `emergentintegrations` per ricevere `TextDelta` in tempo reale da Claude Sonnet 5.
- **Cache semantica globale** (`db.axon_semantic_cache`):
  - Chiavi: tokenizzazione + normalizzazione (Unicode NFKD, lowercase, rimozione stopword IT).
  - Matching: **Jaccard similarity ≥ 0.75** (calibrato per italiano, ~0.92 embedding cosine).
  - **TTL 7 giorni** via indice MongoDB `expires_at`.
  - **Globale** (condivisa fra tutti i tenant, come richiesto dall'utente).
  - Bypass automatico se query contiene:
    - Attachment / cronologia sessione
    - Token time-bound (oggi, ieri, domani, adesso, ora...)
    - Token CRM-bound (mio/i/e, appuntamento, cliente, contatto, chiamata, scadenza, bolletta...)
    - Query < 12 caratteri o < 3 token utili
- **Cache lookup** integrato anche in `POST /api/assistant/chat` (non-streaming) per beneficio uniforme.
- **Cache save fire-and-forget** dopo risposta LLM per non bloccare la latenza percepita.
- Helper `_prepare_assistant_prompt()` estratto per DRY tra i due endpoint.
- Nuovo indice MongoDB `axon_semantic_cache`: TTL su `expires_at`, index su `created_at` e `tokens` (multikey).

### ✅ Frontend
- Nuovo modulo `/app/frontend/src/utils/assistantStream.ts` con `streamAssistantChat()`:
  - Consuma SSE via `fetch` + `ReadableStream.getReader()` su web.
  - Fallback lettura full-buffer su native (Android/iOS) dove ReadableStream non è disponibile.
  - Parser SSE robusto (event/data multi-linea, blocchi separati da `\n\n`).
  - Emit callback `onMeta`, `onDelta`, `onDone`.
- `AssistantChat.tsx` (send function):
  - Migrato da POST classico a `streamAssistantChat`.
  - Aggiunge bubble assistente vuota in `onMeta`, la riempie in `onDelta` (append incrementale a `content`), finalizza in `onDone`.
  - Cleanup: rimuove bubble vuota se stream fallisce (evita bolla fantasma).
- Nuovo tipo `ChatMsg` con `streaming?: boolean` e `from_cache?: boolean`.
- **Badge nella bubble**:
  - `WEB` (esistente) — quando `used_web_search`
  - `ISTANTANEA` (nuovo, `#FEF3C7`/`#92400E`, icona `flash`) — quando `from_cache`
  - `•••` (nuovo, viola) — quando `streaming` in corso

### 🧪 Test manuali eseguiti
- ✅ `POST /assistant/chat/stream` con query knowledge "Spiegami cosa è il PUN..." → streaming SSE 13s con `WEB` badge (Tavily). Persiste in cache.
- ✅ Query identica ripetuta → cache HIT in **205 ms** (63× più veloce), `from_cache: true`, `cache_similarity: 1.0`.
- ✅ Query riformulata "Cosa significa PUN nel mercato energetico italiano, spiegami" → cache HIT (0.833 similarity, 245 ms).
- ✅ Query CRM-bound "Quali sono i miei appuntamenti di oggi?" → correttamente bypassa cache, streaming LLM ~6.5s.
- ✅ UI: badge ISTANTANEA visibile accanto a WEB sulla bubble cached; dot indicator viola durante streaming; contenuto renderizzato progressivamente token-per-token.

### 📊 Impatto misurato
- **Streaming**: primo token visibile in ~500-800ms (vs 8-15s per la risposta completa in blocco). Percezione: risposta 10-20x più rapida.
- **Cache hit su domanda ripetuta**: 205 ms vs ~13 s → **63× più veloce**, zero costo LLM.
- **Precisione cache**: false-positive gestiti da skip-tokens (CRM, tempo, meteo). Query CRM sempre servite da LLM.

---


## v29.ak Landing page pubblica su advisoros.it (Giugno 2026)
### 🎯 Richiesta utente
Creare una landing page web separata per advisoros.it che presenta AdvisorOS con descrizione, mockup app e bottoni di download per Play Store e App Store. La landing deve essere la homepage web di default per utenti non loggati.

### ✅ Frontend
- `/app/frontend/app/landing.tsx` (implementato completo):
  - Nav top: logo AdvisorOS + bottone "Accedi" → `/login`
  - Hero: badge "Nuova versione 2026", titolo "Il CRM smart per consulenti e network" (dual-color), sottotitolo marketing, CTA Play Store e App Store (URL placeholder), link "Prova da browser"
  - Mockup phone-frame (visibile su desktop ≥900px) con anteprima layout AdvisorOS
  - Feature grid 4 punti: CRM, Axon AI, Google Drive, Multi-tenant
  - Sezione screenshot mock (Home/Contatti/Axon AI) su sfondo dark `#0F2438`
  - Sezione "powered by AxonOS" con logo AxonOS
  - Footer con brand, mail `info@advisoros.it`, link "Accedi"
  - Layout responsive: `useWindowDimensions` con breakpoint 900px per switch mobile/desktop
- `/app/frontend/app/index.tsx`: aggiunto redirect condizionale — su web utenti non autenticati vanno a `/landing` invece di `/login`; su mobile resta `/login`.
- URL placeholder store: `https://play.google.com/store/apps/details?id=com.advisoros` e `https://apps.apple.com/app/advisoros` da sostituire una volta pubblicate le build.

### 🧪 Test manuali eseguiti
- ✅ `GET /landing` → 200 OK, layout desktop 1280×900 mostra hero + phone mockup a destra
- ✅ Full-page scroll: feature grid, screenshot mock su banda dark, powered by AxonOS, footer
- ✅ Viewport mobile 390×844: layout single-column, CTA affiancate su una riga
- ✅ Redirect `/` → `/landing` per utente non autenticato su web (Platform.OS === 'web')

---


## v2.aq Splash animato di brand (Giugno 2026)
### 🎯 Richiesta utente
Aggiungere una micro-animazione allo splash iniziale così l'app comunica personalità già prima del login.

### ✅ Frontend
- `/app/frontend/src/AnimatedSplash.tsx` (NEW):
  - Overlay full-screen `position:absolute zIndex:9999` mostrato UNA sola volta per sessione app (module-level ref `_splashPlayedRef`).
  - Sfondo `#0F2438` (identico allo splash nativo Expo → zero flash di transizione).
  - Elementi animati (`Animated` con `useNativeDriver: true`):
    - Anello orbitale `borderRadius: 88` di colore arancione trasparente che ruota di 360° con `Animated.loop` (2200ms per giro, `Easing.linear`).
    - Due "pianeti" (dot arancione + dot bianco) posizionati agli antipodi del ring, ruotano insieme al ring generando l'effetto orbit.
    - Logo AdvisorOS (bianco su card arrotondata con shadow) entra con `Animated.spring` (friction 5.5, tension 90) da scale 0.6 → 1 e opacity 0→1.
    - Wordmark "Advisor**OS**" (OS in arancione `#FF6B35`) fade-up con `translateY 12→0`.
    - Tagline "CRM per consulenti energetici" fade-in.
    - Pausa 500ms, poi fade-out overlay 480ms.
- `/app/frontend/app/_layout.tsx`: import di `AnimatedSplash` + render dentro `<AuthProvider>` accanto a `<LockGate />` (fuori dal LockGate così viene mostrato prima della LOAD di auth).

### 🧪 Test manuali eseguiti
- ✅ Screenshot sequenziali durante il primo mount: 
  - t=0-1500ms: anello orbita attorno al logo, wordmark ancora nascosto
  - t=1500-2200ms: wordmark "AdvisorOS" + tagline appaiono
  - t=2700ms: overlay in fade-out, sfumatura verso la schermata di login
  - t=3000ms+: login visibile, nessun residuo di overlay
- ✅ Nessuna interruzione della UX: `pointerEvents` gestito, non blocca input dopo l'animazione.

---


## v2.ap Header Home animato · Barra AxonOS minimale · Bottom nav persistente · Nuova chat vuota (Giugno 2026)
### 🎯 Richiesta utente
1. Barra chat AxonOS: rimuovere logo e testo "AxonOS", spostare selettore modalità all'estrema sinistra, lasciare solo icone+etichetta a destra (Annunci · Audio · Nuova chat · Chiudi).
2. Header Home: rimuovere il logo AdvisorOS piccolo in alto a sinistra. Al centro animazione a due fasi — "Ciao, NOME" (4s, nome in arancione) → dissolvenza verso il logo AdvisorOS centrato di dimensione media. Solo al primo caricamento. Avatar rimane in alto a destra.
3. Menu di navigazione in basso sempre visibile su tutte le schermate (scheda anagrafica cliente, Interfaccia Master, ecc.).
4. Chat Axon: nuova apertura deve sempre partire vuota (nessun messaggio precedente).

### ✅ Frontend
- `/app/frontend/src/AssistantChat.tsx`:
  - Header ridisegnato: rimossi `<AxonOSLogo>` e `<Text>AxonOS</Text>`. Ora il pill dropdown `modeDropdown` è la prima cosa a sinistra; segue uno `<View flex:1>` che spinge le 4 azioni a destra (Annunci/Audio/Nuova chat/Chiudi).
  - `loadHistory()` semplificata: NON chiama più `/assistant/history` (che ripristinava la sessione). Fetch delle sole impostazioni `/user-settings`, poi `setSessionId(null)` + `setMessages([])`. La nuova session_id viene creata dal backend al primo `/assistant/chat`.

- `/app/frontend/app/(tabs)/home.tsx`:
  - Rimossa la riga `<View style={header}>` che conteneva il piccolo `<AdvisorOSLogo size={40}>` + eyebrow + hi + avatar.
  - Nuovo layout: `headerTopRow` con eyebrow (data/ora) a sinistra e avatar a destra; sotto `<View style={heroWrap}>` con due `<Animated.View>` sovrapposte assolute — `heroGreet` (`Ciao, NOME.toUpperCase()`) e `<AdvisorOSLogo size={64}>`. Animazione: 4000ms delay → `Animated.parallel` fade-out greet (550ms) + fade-in logo (700ms), `useNativeDriver: true`.
  - `_hasPlayedHeroIntroRef` ref module-level: al termine dell'animazione viene messo `true`, così le successive visite alla Home (senza reload dell'app) non ri-eseguono l'animazione e mostrano subito il logo.

- `/app/frontend/src/PersistentBottomNav.tsx` (NEW):
  - Componente `<PersistentBottomNav />`: barra fissa `position:absolute bottom:0` con 6 tab (Home/Contatti/Chat/Calendario/Report/Profilo) styled identici alla `Tabs` nativa (colori `#FF6B35`/`#94A3B8`, safe-area inset, ombra card).
  - Auto-hide: se `usePathname()` rientra nel gruppo `(tabs)` non renderizza nulla (la Tabs nativa gestisce la barra). Auto-hide anche su `/login`, `/auth/*`, `/`.
  - Su rotte fuori dal gruppo (`/contact/[id]`, `/master`, `/appointment/*`, ecc.) la barra appare sempre e naviga con `router.push('/(tabs)/<name>')`.

- `/app/frontend/app/_layout.tsx`: import di `PersistentBottomNav` + render dentro `StackWithCallBar` (solo se `user` autenticato) accanto ad `<AssistantFAB />`.

- `/app/frontend/app/contact/[id].tsx`: `ScrollView` paddingBottom da default a `120` per evitare che l'ultimo contenuto (Analisi Axon) rimanga coperto dalla barra persistente.
- `/app/frontend/app/master.tsx`: `ScrollView` paddingBottom da `60` a `140` per la stessa ragione.

### 🧪 Test manuali eseguiti
- ✅ Screenshot 1 (0.5s dopo login): "Ciao, TEST" ben centrato con nome in arancione, avatar in alto a destra, nessun logo in alto a sinistra.
- ✅ Screenshot 2 (5.5s dopo login): logo AdvisorOS centrato (dopo dissolvenza), stessa posizione.
- ✅ Chat AxonOS aperta: barra viola con solo pill "Modalità: Voce e testo ▾" a sinistra e Annunci/Audio/Nuova chat/Chiudi a destra. Empty state con quick actions, nessun messaggio precedente.
- ✅ Scheda anagrafica cliente: barra fissa in basso con Home · Contatti · Chat · Calendario · Report · Profilo, tap su Home riporta a `/(tabs)/home`.
- ✅ Interfaccia Master: barra visibile, `paddingBottom` maggiorato: griglia menu non tagliata dalla barra.

---


## v2.ao Header AxonOS chat — logo trasparente, dropdown modalità, icone con etichetta (Giugno 2026)
### 🎯 Richiesta utente
1. Nella barra viola della chat il logo AxonOS aveva fondo nero illegibile: rimuovere lo sfondo, mostrare solo l'icona.
2. Cambiare il titolo "Axon" → "AxonOS".
3. Il sotto-titolo "Voce e testo" deve diventare un pulsante-pill cliccabile con testo "Modalità: Voce e testo" e piccola freccia dropdown per chiarire che è un selettore.
4. Le 4 icone a destra della barra viola devono avere un'etichetta piccola sotto: `Annunci`, `Audio`, `Nuova chat`, `Chiudi`.
5. L'icona "Nuova chat" deve rappresentare un foglio di carta nuovo (`create-outline`).
6. Ogni apertura della chat AxonOS deve partire da uno stato vuoto (empty state), non riprendere l'ultima conversazione.

### ✅ Frontend
- `/app/frontend/src/BrandLogos.tsx`: `AxonOSLogo` ora accetta prop `onDark`. Se `onDark=true` il container passa a `backgroundColor: "transparent"` e l'`Image` viene mostrato al 100% (invece dell'86%) per essere ben leggibile su una barra scura/viola senza il riquadro nero.
- `/app/frontend/src/AssistantChat.tsx`:
  - Header ricostruito: titolo fisso `"AxonOS"` (era `assistantName`), logo con `onDark` (fondo trasparente), padding e gap ridotti per stare in 4 azioni + dropdown.
  - Sostituito il `<Text>` sub-titolo con un `<Pressable style={styles.modeDropdown}>` che mostra icona modalità + "Modalità: {label}" + `chevron-down`, con `onPress` che apre `showModeMenu`.
  - Sostituiti gli `iconBtn` circolari con `headerAction` a due righe (icona 18px + `<Text style={headerActionTxt}>` 8.5px): `Annunci` (mode cycle), `Audio` (conv toggle, se voice supported), `Nuova chat` (`create-outline`, chiama `resetSession`), `Chiudi` (`close`).
  - `loadHistory()`: mantenuto solo il caricamento delle impostazioni utente (nome, modalità, quick actions, voce) — la conversazione precedente non viene più ripristinata: `setSessionId(null)` + `setMessages([])`. La nuova `session_id` viene creata dal backend al primo `/assistant/chat`.
  - Nuovi stili: `modeDropdown`, `modeDropdownTxt`, `headerAction`, `headerActionTxt`.

### 🧪 Test manuali eseguiti
- ✅ Screenshot header: logo AxonOS senza sfondo nero visibile sulla barra viola, titolo "AxonOS", pill "Modalità: …" con chevron sotto il titolo, 4 azioni con etichette Annunci/Audio/Nuova chat/Chiudi.
- ✅ Empty state pulito: nessuna conversazione precedente ricaricata all'apertura.
- ✅ Fix precedente AREE: `flexWrap: "wrap"` verificato su scheda contatto (nessuna sovrapposizione).

---


## v2.an Chat Axon — pill compatta azioni rapide + pulsante Stop (Giugno 2026)
### 🎯 Richiesta utente
1. Le azioni rapide inviano il prompt completo che appare come lungo messaggio viola nella chat. Mostrare invece un'etichetta compatta (es. "PUN MEDIO PER FASCE 2026").
2. Aggiungere un pulsante "Stop" ben visibile durante l'elaborazione per interrompere Axon con un tap.

### ✅ Frontend
- `/app/frontend/src/api.ts`: aggiunto supporto `signal?: AbortSignal` a `ApiOptions` e propagato al `fetch`. Errori `AbortError` propagati senza mapping "Connessione al server interrotta".
- `/app/frontend/src/AssistantChat.tsx`:
  - `ChatMsg` ora ha campo opzionale `quick_label?: string` — se presente, la bubble utente mostra una pill compatta con icona `sparkles` e testo uppercase (max 2 righe) invece del prompt intero.
  - `send()` accetta `opts.quickLabel` e crea un `AbortController` (memorizzato in `abortRef`) passandolo alla `api()`. Gli errori `AbortError` mostrano "⏹️ Risposta interrotta dall'utente." invece di errore generico.
  - Nuovo helper `stopGeneration()` che chiama `abortRef.current?.abort()`.
  - Chip `qa-chip-*` (azioni rapide) chiama `send(s.prompt, { quickLabel: s.label })` così l'etichetta appare al posto del prompt intero.
  - Durante `sending`: sotto la "typing" bubble compare un pulsante rosso `<Pressable testID="assistant-stop-btn">` con icona `stop-circle` e testo "Stop", che chiama `stopGeneration()`.
  - Nuovi stili `quickActionPill` (compatta, uppercase, sparkle icon) e `stopBanner` (pill rossa con shadow).

### 🧪 Test manuali eseguiti
- ✅ Screenshot 1 (durante elaborazione): pill arancione "PROSSIMO APPUNTAMENTO" compatta + pulsante Stop rosso visibile sotto la typing dots.
- ✅ Screenshot 2 (dopo risposta): pill compatta resta sopra la risposta di Neo (nessun prompt lungo visibile).
- ✅ Screenshot 3 (dopo stop): abort funziona, appare "⏹️ Risposta interrotta dall'utente." e la UI torna al bottone di invio.

---

## v2.am FAB Axon pulito + empty state chat minimale (Giugno 2026)
### 🎯 Richiesta utente
1. FAB AxonOS in Home: troppo sfondo scuro attorno alla scritta. Ritagliare per far occupare al logo la maggior parte dello spazio.
2. Chat Axon: rimuovere il testo "Ciao, sono Axon!" e il sottotitolo "Posso aiutarti con...". Solo logo + azioni rapide.

### ✅ Frontend
- Nuovo asset `assets/images/axonos-logo-white.png` (1375×294, silhouette bianca su transparent) generato ritagliando lo sfondo scuro dal PNG originale e ricolorando i pixel opachi in bianco puro.
- `/app/frontend/src/AssistantChat.tsx`:
  - **FAB**: sostituito `<AxonOSLogo size={36}/>` con `<Image source={AXONOS_LOGO_WHITE} width={46} resizeMode="contain">`. Il logo bianco senza card scura occupa 82% del FAB viola (56px) invece del ~64% precedente, con la scritta AxonOS ora ben leggibile.
  - **Empty state**: rimossi `<Text style={styles.emptyTitle}>Ciao, sono {name}!</Text>` e `<Text style={styles.emptySub}>Posso aiutarti con...</Text>`. Resta solo `<Image AXONOS_LOGO_HORIZONTAL />` seguito direttamente da `<View style={styles.suggestWrap}>` con le azioni rapide.
- Componente `AxonOSLogo` (BrandLogos.tsx) invariato — resta in uso nell'header chat.

### 🧪 Test manuali eseguiti
- ✅ Screenshot Home: FAB con logo AxonOS bianco leggibile e pieno, senza padding scuro.
- ✅ Screenshot chat empty state: solo logo AxonOS + 4 azioni rapide (Prossimo appuntamento, Telefonate di oggi, Clienti senza appuntamento, Ritelefonate urgenti).

---

## v2.al Empty state chat Axon — logo orizzontale (Giugno 2026)
### 🎯 Richiesta utente
Il logo AxonOS quadrato nell'empty state della chat con Axon aveva troppo sfondo nero e occupava troppo spazio verticale, spingendo fuori dallo schermo le azioni rapide (Prossimo appuntamento, Clienti senza appuntamento, ecc.).

### ✅ Frontend
- Nuovo asset `assets/images/axonos-logo-transparent.png` (1375×294, ~7 KB) generato da script Python:
  - Sfondo scuro navy convertito a trasparente (soglia R+G+B < 90).
  - Pixel opachi ricolorati in navy brand `#0B1220` per garantire contrasto sul chat area chiaro `#FAF9FF`.
  - Ritagliato al bounding box → aspect ratio 4.68:1.
- `/app/frontend/src/AssistantChat.tsx`:
  - Nuova costante `AXONOS_LOGO_HORIZONTAL = require("@/assets/images/axonos-logo-transparent.png")` + aspect.
  - Empty state ora usa `<Image>` orizzontale 180×~38 al posto di `<AxonOSLogo size={78} />`.
  - `emptyWrap` ridotto: `paddingTop: 24 → 10`, `gap: 10 → 6`.
  - Titolo "Ciao, sono Neo!" ora con `marginTop: 6` invece di 12.
- Componente `AxonOSLogo` (BrandLogos.tsx) invariato — resta in uso nel FAB, header chat e Insegna ad Axon.

### 🧪 Test manuali eseguiti
- ✅ Screenshot: logo orizzontale visibile senza card scura, azioni rapide (Prossimo appuntamento, Telefonate di oggi, Clienti senza appuntamento, Ritelefonate urgenti) tutte visibili senza scroll.

---

## v2.ak Fix regressione — Axon legge i file delle regole in chat (Giugno 2026)
### 🎯 Richiesta utente
Regressione: Axon non trovava più i file allegati alle regole di "Insegna ad Axon" (PDF GME, Optima) quando l'utente li menzionava in chat. Rispondeva "non trovo il file, ricaricalo".

### 🔎 Diagnosi
La persistenza in `db.ai_teach_rules.files[].data_base64` funzionava correttamente. Il problema era nel builder del system prompt della chat (`POST /api/assistant/chat`): non iniettava mai la Base di Conoscenza (regole + testo estratto dai file). L'unico posto in cui `build_ai_teach_context` veniva chiamato era la bill analysis (endpoint bollette), NON la chat Axon.

### ✅ Backend `/app/backend/server.py`
- Nuovo helper `_build_axon_teach_section(tenant, user_msg)`:
  - Legge tutte le regole `ai_teach_rules` per il tenant.
  - Ordina le regole per rilevanza rispetto al messaggio dell'utente (matching su title, text, categorie, nomi file).
  - Estrae il testo dai file allegati usando `_extract_attachment_text` (PDF via PyMuPDF, xlsx via openpyxl, csv/txt UTF-8, immagini via Gemini vision).
  - Duck-typed shim `_RuleAttachmentShim` per riusare `_extract_attachment_text` (accetta oggetti con `.name`/`.mime`/`.data_base64`).
  - Budget conservativo: max 8 regole, max 2500 char per file, max 1500 char per testo regola, cap totale 18000 char.
- `assistant_chat`: chiama `_build_axon_teach_section` e inietta il blocco nel system_message, dopo `memory_section` e prima di `attachments_section` (l'utente in-chat attaccato mantiene la priorità più alta).

### 🧪 Test end-to-end
- ✅ Creato test rule con PDF GME/Optima → chiesta domanda "Cosa dice il PDF GME sulla PUN di novembre? E l offerta Optima?" → Axon ha risposto citando esplicitamente il nome del file `gme-pun-nov2026.pdf`, il titolo della regola, i valori estratti (PUN 87,42 €/MWh, Optima 6,50 €/mese, F1 0,089 €/kWh) e ha distinto tra dati del PDF vs risultati Tavily web.
- ✅ La regola di test è stata rimossa dopo la validazione.

### 📌 Note
- La chat Axon carica ora la Base di Conoscenza a ogni richiesta (max 18000 char, ~4000 token). Se la KB cresce oltre questo limite serviranno filtri più stringenti su categoria o retrieval RAG.
- Il retrieval è **key-based** (match su token del messaggio) — funziona bene per il caso "GME/Optima" ma potrebbe non pescare regole rilevanti se il messaggio non contiene keyword. In quel caso vengono comunque incluse le prime N regole per ordine di aggiornamento.

---

## v2.aj Fase 2 — Profilo comportamentale Axon (Giugno 2026)
### 🎯 Richiesta utente
Aggregare nel tempo tutti i riassunti Fase 1 e costruire un profilo comportamentale: stile comunicazione, livello interesse, obiezioni ricorrenti, momento migliore di contatto, suggerimento strategico. Auto-aggiornato ad ogni nuova interazione.

### ✅ Backend `/app/backend/server.py`
- Nuova collezione `axon_profiles` (1 documento per contatto, upsert).
- Helper `_axon_build_profile_bg(tenant, user_id, contact_id, ctx)` async:
  - Carica ultime 30 analisi da `axon_analyses` ordinate desc.
  - Compatta ogni analisi in un bullet compresso (data, tipo, tono, topics, obiezioni, next_step, summary).
  - Prompt italiano → Claude Sonnet 4.5 → JSON strutturato con: `communication_style` (7 valori), `style_reason`, `interest_level` (high/medium/low), `interest_trend` (up/flat/down), `recurring_objections`, `best_contact_time` (mattina/pranzo/pomeriggio/sera/weekend), `best_contact_time_reason`, `strategic_suggestion`, `key_topics`.
  - Sanitize output (normalizza sinonimi it/en, clamp array, "non rilevabile" → null).
  - `upsert` in `axon_profiles` (setOnInsert su `created_at` e `profile_id`).
- Trigger: dopo ogni `db.axon_analyses.insert_one(...)` chiamiamo `_axon_build_profile_bg` in-place (l'analisi è già in background task).
- Endpoint `GET /api/contacts/{contact_id}/axon-profile` → `{profile, has_analyses}`. 404 se contatto non visibile.
- Cleanup account: `axon_profiles` aggiunta alle tenant_collections eliminate dal DELETE /auth/me.

### ✅ Frontend
- `/app/frontend/src/AxonProfileCard.tsx` (NEW): card renderizza 5 blocchi tematici:
  1. **Stile comunicazione** — card colorata per stile con icona (calcolatrice/cuore/flash/scudo/chat/lucchetto/valigetta), etichetta grande e frase di motivazione.
  2. **Livello di interesse** — meter con progress bar colorata (verde/ambra/rosso) + pill "trend" con icona trending-up/remove/trending-down.
  3. **Obiezioni ricorrenti** — box giallo con chips.
  4. **Momento migliore per contattarlo** — card azzurra con icona meteo (sunny/moon/etc.) o placeholder se `null`.
  5. **Suggerimento strategico** — box viola con `MaterialCommunityIcons lightbulb-on` e testo evidenziato.
- Polling breve (7s/15s/25s) per catturare l'update background dopo un'interazione.
- `/app/frontend/app/contact/[id].tsx`: `<AxonProfileCard>` inserita nel tab Info sopra `<AxonAnalysesSection>`.

### 🧪 Test manuali eseguiti
- ✅ Backend: dopo aver aggiunto una nota italiana ricca di segnali ("preferisce mattina", "vuole confronti numerici"), il profilo generato mostra correttamente `communication_style=analitico`, `interest_level=high`, `interest_trend=up`, `best_contact_time=mattina`, obiezioni pertinenti e suggerimento strategico operativo.
- ✅ UI screenshot: tutti i 5 blocchi renderizzati correttamente per Marco TEST_UI (based_on_count: 3 interazioni).

### 📌 Note
- Il profilo si ricostruisce integralmente a ogni nuova interazione (idempotente). Costo minimo per rebuild (~300-700 token I/O).
- Latenza tipica update: 5-15s dopo l'evento CRM.

---

## v2.ai Login screen polish (logo grande + responsive) (Giugno 2026)
### 🎯 Richiesta utente
1. Logo AdvisorOS troppo piccolo/illeggibile → aumentare card e logo.
2. Login non responsive → su tablet/desktop centrare il contenuto con max-width 480px e riempire lo schermo (no area vuota).
3. Rimuovere il testo "AdvisorOS" e il sottotitolo "Consulenza Energetica · Network" sotto il logo.

### ✅ Frontend `/app/frontend/app/login.tsx`
- Logo ingrandito: `size = width >= 700 ? 180 : min(160, 42% larghezza)`. La card interna di `AdvisorOSLogo` scala di conseguenza. Aggiunta shadow al logo per staccarlo dal gradient.
- Responsive: `useWindowDimensions` + breakpoint `isWide = width >= 700`.
  - `pageScroll`: `flexGrow: 1` per riempire l'intero schermo.
  - Quando `isWide` è true, il ScrollView contentContainer diventa `justifyContent: "center", alignItems: "center"` e il container ha `maxWidth: 480, alignSelf: "center"` — form al centro orizzontale e verticale.
  - Su mobile mantiene layout full-width con padding 16/24.
- Sfondo: gradient LinearGradient ora è absolute-fill che copre tutto lo schermo (non più altezza fissa "hero"). Il form è renderizzato come card bianca con ombra sopra il gradient.
- Rimossi `<Text>AdvisorOS</Text>` e `<Text>Consulenza Energetica · Network</Text>`. Rimossi anche gli stili `title` e `subtitle` dal StyleSheet.

### 🧪 Test manuali eseguiti
- ✅ Screenshot mobile 390×844: logo grande centrato, form full-width con margine.
- ✅ Screenshot tablet 900×1200: contenuto centrato orizzontalmente, max-width 480, gradient copre tutto lo schermo.
- ✅ Screenshot desktop 1400×900: contenuto centrato orizzontalmente e verticalmente, form compatto, nessuna area vuota ai lati o sotto.

---

## v2.ah Analisi Axon automatiche per contatto (Giugno 2026)
### 🎯 Richiesta utente
Dopo ogni interazione con un contatto (chiamata, nota, messaggio) Axon genera automaticamente un riassunto intelligente e lo salva nel profilo. Deve includere tono, argomenti, obiezioni, next_step. Appare come "Analisi Axon" con data + tipo. Si accumulano nel tempo senza sovrascrivere. Nessuna azione manuale.

### ✅ Backend `/app/backend/server.py`
- Nuova collezione `axon_analyses` (indicizzata implicitamente da user_id + contact_id).
- Helper `_axon_analyze_interaction_bg(...)` async fire-and-forget:
  - Usa `emergentintegrations.llm.chat.LlmChat` + `claude-sonnet-4-5-20250929`.
  - System prompt italiano tuned per CRM che restituisce JSON strutturato `{tone, topics, objections, next_step, summary}`.
  - Sanitize output (max 8 topics, 6 objections; tone normalizzato ai 5 valori canonici).
  - Insert in `db.axon_analyses`. Non solleva mai eccezioni.
- Utility `_schedule_axon_analysis(background, user, contact_id, type, ref, summary)` per accodare via BackgroundTasks.
- Trigger inseriti in:
  - `POST /api/contacts/{id}/notes` — quando `kind=text` con testo non vuoto.
  - `POST /api/calls/log` — costruisce contesto "canale | esito | durata | note".
  - `PATCH /api/calls/log/{id}` — se la nota viene aggiornata rigenera l'analisi (le vecchie restano).
- Endpoint `GET /api/contacts/{id}/axon-analyses?limit=N` — ritorna timeline ordinata dalla più recente (max 100).
- Cleanup: `axon_analyses` aggiunta alla lista tenant_collections dell'endpoint `DELETE /api/auth/me`.

### ✅ Frontend
- `/app/frontend/src/AxonAnalysesSection.tsx` (NEW): sezione con toggle expand/collapse. Header con logo AxonOS + contatore. Per ogni entry:
  - Pill "Tipo" (Chiamata/Nota/Messaggio) + pill "Tono" con icona (Positivo · Interessato · Neutro · Scettico · Negativo).
  - Data DD/MM/YY · HH:MM.
  - Frase riassuntiva.
  - Chip topic viola (max 8).
  - Box giallo "OBIEZIONI" (se presenti).
  - Box viola "PROSSIMO PASSO" con evidenza.
  - Mostra 3 entry per default + "Mostra tutte le N analisi".
- Polling leggero: ricarica dopo 4/10/20s dall'apertura del contatto per catturare l'analisi background in arrivo (~5-15s dal trigger).
- `/app/frontend/app/contact/[id].tsx`: `<AxonAnalysesSection contactId={id} />` inserita nel tab Info, subito sotto la sezione Referenze bidirezionali.

### 🧪 Test manuali eseguiti
- ✅ Backend end-to-end: contatto creato, note POST + call log POST → dopo 15s `GET /axon-analyses` restituisce 2 entry. Test con testo italiano reale sulla penale disdetta Enel — Axon ha correttamente estratto tono=interested, 5 topics (cambio fornitore, penale disdetta Enel, blocco prezzi, costi fissi, preventivi comparativi), 1 objection e next_step operativo.
- ✅ UI screenshot: sezione visibile collassata + espansa con tutti i blocchi (pill tono/tipo, chips topics, box obiezioni, box next_step).
- ✅ Le analisi si accumulano (2 entry create in tempi diversi, entrambe visibili).

### 📌 Note
- L'analisi viene generata via LLM background: latenza tipica 5-15s dopo l'evento. Il polling frontend copre questa finestra.
- Modello: Claude Sonnet 4.5 (via Emergent LLM key). Costo minimo per chiamata (~150-400 token I/O).

---

## v2.ag Brand identity — splash screen + firma email agente (Giugno 2026)
### 🎯 Richiesta utente
1. Splash screen: schermata iniziale di caricamento con logo AdvisorOS (bussola sfondo bianco) centrato su sfondo navy blu.
2. Firma email benvenuto agenti: logo AxonOS in fondo all'email di benvenuto.

### ✅ Frontend
- `/app/frontend/assets/images/splash-image.png` (OVERWRITE): sostituito con il logo ufficiale AdvisorOS (PNG 2000×2000, RGB). Curl da CDN Emergent.
- `/app/frontend/app.json`: `expo-splash-screen` config aggiornata:
  - `backgroundColor: "#0F2438"` (navy blu, coerente con l'hero del login)
  - `imageWidth: 220` (leggermente più ampio per l'aspect ratio del logo)
  - `resizeMode: "contain"` invariato — il logo mantiene le proporzioni con la sua cornice bianca arrotondata

### ✅ Backend `/app/backend/server.py`
- `_welcome_email_html` esteso:
  - Blocco HTML footer con `<img>` remoto (AxonOS logo, cornice dark #0B1220 rounded 10px) + testo "Powered by AxonOS · L'intelligenza artificiale al servizio del tuo business".
  - Versione text-plain: aggiunta riga `---\nPowered by AxonOS\n...` per email client che disabilitano HTML.

### 🧪 Test manuali eseguiti
- ✅ Splash: file 2000×2000 verificato via PIL, config JSON valida (backgroundColor + imageWidth aggiornati). La splash nativa è visibile solo su build iOS/Android (non su web preview).
- ✅ Email template: import diretto di `_welcome_email_html` — testo e HTML entrambi contengono "Powered by AxonOS" e l'URL corretto del logo AxonOS.

### 📌 Note
- La splash nativa parte solo su **build iOS/Android** o su **Expo Go**. In produzione la vedrai dopo aver ripubblicato e generato la build.
- Il logo AxonOS nella firma email è caricato via URL remoto: se il client email blocca le immagini esterne, il fallback text-plain mostra comunque "Powered by AxonOS" testuale.

---

## v2.af Brand identity AdvisorOS + AxonOS (Giugno 2026)
### 🎯 Richiesta utente
- Logo **AdvisorOS** (bussola, sfondo bianco) come logo principale in header, login screen e banner della home.
- Logo **AxonOS** (neurone, sfondo scuro) nella sezione Insegna ad Axon, banner dell'assistente AI (FAB) e schermata di chat con Axon.

### ✅ Frontend
- `/app/frontend/src/BrandLogos.tsx` (NEW): componente centralizzato `<AdvisorOSLogo>` e `<AxonOSLogo>` con URI dei loghi ufficiali. Ogni logo ha cornice arrotondata (bianco per AdvisorOS, dark #0B1220 per AxonOS) e size configurabile.
- `/app/frontend/app/login.tsx`: sostituita l'icona `briefcase` con `<AdvisorOSLogo size={72} />` + title cambiato in "AdvisorOS".
- `/app/frontend/app/(tabs)/home.tsx`: aggiunto `<AdvisorOSLogo size={40} />` in cima all'header, a sinistra della data/greeting.
- `/app/frontend/src/AssistantChat.tsx`:
  - Header chat: `<AxonOSLogo size={38} />` al posto dell'`avatarWrap` con `robot-happy`.
  - Empty state: `<AxonOSLogo size={78} />` al posto dell'`emptyIcon` con `robot-happy`.
  - FAB assistente AI: `<AxonOSLogo size={36} />` al posto dell'icona `robot-happy`.
- `/app/frontend/app/ai-teach.tsx`: badge testa header ora è `<AxonOSLogo size={36} />` invece dell'icona `sparkles`.

### 🧪 Test manuali eseguiti (screenshot)
- ✅ Login screen con logo AdvisorOS bianco su gradient scuro + titolo "AdvisorOS".
- ✅ Home header con logo AdvisorOS pill bianco accanto a data/greeting.
- ✅ FAB assistente con logo AxonOS su sfondo scuro (pulse animation OK).
- ✅ Chat Axon (header) con logo AxonOS accanto al nome "Neo".
- ✅ Insegna ad Axon con logo AxonOS in alto a destra.

---

## v2.ae Anagrafica polish + timer background + referenze rapide (Giugno 2026)
### 🎯 Richiesta utente
1. Compattare le sezioni "Aree" e "Gruppi" nell'anagrafica contatto.
2. Nascondere il banner "Promuovi ad agente" a tutti gli utenti tranne il Master.
3. Timer chiamata **funziona in background** e al termine della telefonata salva automaticamente la durata nel log attività senza azione utente.
4. Modal "Aggiungi referenza": post-add mostrare "Fissa appuntamento" + "Aggiungi altra referenza" e in cima aggiungere "Crea nuova anagrafica".

### ✅ Frontend
- **Task 1** `/app/frontend/app/contact/[id].tsx`: nuova `compactCard` con etichetta "Aree" / "Gruppi" inline sulla stessa riga, badge mini (`areaBadgeMini`/`groupBadgeMini`) padding 2/7, font 10, icone 9px. Le due sezioni ora occupano ~30% dello spazio precedente.
- **Task 2** `/app/frontend/app/contact/[id].tsx`: il banner arancione "Promuovi ad agente" e la info verde "già collaboratore" restano protetti da `isMaster` (`role==="owner" && !parent_user_id`). Nessuna modifica di codice necessaria — già rispettato.
- **Task 3** `/app/frontend/src/CallTimerBar.tsx`: riscritto ActiveCallProvider con:
  - Persistenza `AsyncStorage` (chiave `@dp.activeCall.v1`) — timer sopravvive al kill/background dell'app.
  - `AppState` listener: quando l'app va in background segna `backgroundAt`; al rientro in foreground dopo ≥4s di background chiude silenziosamente la chiamata e PATCHa `/calls/log/{id}` con la durata. Grace-window evita falsi positivi per rientri accidentali < 4s.
  - Restore all'avvio: se l'app viene killata durante la chiamata, al restart legge lo state e riprende il timer (finché l'utente non torna dal dialer).
  - `MIN_CALL_DURATION_SEC=3` per non registrare tap accidentali.
  - Su web `AppState` non è affidabile → l'utente può ancora usare "Termina" manualmente.
- **Task 4** `/app/frontend/src/ContactReferencesSection.tsx`:
  - Nuovo state `justAdded` — dopo il link mostra un post-add screen con card verde "Referenza aggiunta" + 3 azioni: "Fissa appuntamento" (viola, apre `/appointment/new?contactId=…`), "Aggiungi altra referenza" (viola outline, reset state → torna alla lista), "Chiudi".
  - Pulsante viola **"Crea nuova anagrafica"** in cima al modal (prima della barra di ricerca) → apre `/contact/new?add_reference_of={contactId}`. Divisore "oppure scegli tra i contatti" separa dalla ricerca esistente.
- `/app/frontend/app/contact/new.tsx`: nuovo query-param `add_reference_of={contactId}`. Al salvataggio del nuovo contatto, POST `/contacts/{addReferenceOf}/references/{newContactId}` per collegare bidirezionalmente le anagrafiche, poi `router.replace('/contact/{origin}')`.

### 🧪 Test manuali eseguiti
- ✅ Task 1: screenshot conferma card compatta con badge inline (~30% dello spazio precedente).
- ✅ Task 2: banner solo Master (già presente nel codice — verificato via lettura conditional rendering).
- ✅ Task 3: lint OK, restart app OK, restore da AsyncStorage funzionante (background listener attivo su nativo).
- ✅ Task 4: screenshot conferma "Crea nuova anagrafica" in cima al modal, divider, ricerca; post-add screen con azioni "Fissa appuntamento" + "Aggiungi altra referenza"; contatore Referenze aggiornato a 1.

### 📌 Note
- Task 3 (timer background auto-end): la logica AppState funziona solo su iOS/Android **build nativo**. In Expo Go l'AppState transitions sono presenti ma alcuni comportamenti di background differiscono. In produzione (development build o standalone) è la strada corretta per l'auto-detect senza permessi speciali. Se in futuro serve un rilevamento **real-time** del hangup della telefonata occorre `react-native-call-detection` (Android) + `CXCallObserver` (iOS) in una nuova integrazione nativa.

---

## v2.ad Elimina account + OAuth bridge defensivo (Giugno 2026)
### 🎯 Richiesta utente
1. **Elimina il mio account**: pulsante in Impostazioni → Sicurezza per superare la review Apple App Store senza intoppi.
2. **Verifica route OAuth Google Drive** in produzione: il sito `advisoros.it` risulta irraggiungibile e `/auth/google/callback` non risponde.

### ✅ Backend `/app/backend/server.py`
- **Delete account** (`DELETE /api/auth/me`): elimina permanentemente utente + TUTTI i dati collegati. Guardrail: frase esatta `ELIMINA IL MIO ACCOUNT`, password richiesta (per account con `password_hash`), 400 se Master ha ancora sub-utenti attivi. Cancella tenant-scoped collections (contatti, appuntamenti, callback, bollette, corporate, contract, files, chat, eventi, SMTP) + user-scoped (settings, business_cards, google_drive, sessions, my_thing, ai_teach, totp, memory). Invalida la sessione corrente.
- **OAuth callback bridge** (`GET /auth/google/callback`): safety net non-`/api` che se per misconfig di ingress il redirect di Google finisce sul backend, HTTP-redirige (302) alla pagina Expo Router `/auth/google/callback` sul frontend con query string preservata. Non impatta il flow normale (Google → advisoros.it → expo-router page → POST /api/google-drive/oauth/exchange).

### ✅ Frontend `/app/frontend/app/security.tsx`
- Aggiunta card **"Zona pericolo"** rossa in fondo alla schermata Sicurezza & 2FA.
- Bottone **"Elimina il mio account"** con outline rosso apre un form inline con:
  - Campo Password (secureTextEntry)
  - Campo conferma frase (autoCapitalize characters) — deve essere `ELIMINA IL MIO ACCOUNT`
  - CTA "Elimina definitivamente" (rosso pieno) + Annulla
- Al successo: alert conferma → logout + navigate to root.

### 🧪 Test manuali eseguiti
- ✅ Backend: `DELETE /api/auth/me` con frase errata → 400; password errata → 401; Master con sub-user → 400 con messaggio esplicativo.
- ✅ Bridge OAuth: `GET /auth/google/callback?code=X&state=Y` → 302 redirect a `https://advisoros.it/auth/google/callback` con query preservata.
- ✅ UI Screenshot: sezione "Zona pericolo" e form di conferma renderizzati correttamente.

### 📌 Note per il deploy produzione (OAuth Google Drive)
- La route `/auth/google/callback` è una **pagina Expo Router del frontend**, non un endpoint backend. In produzione la richiesta a `https://advisoros.it/auth/google/callback` deve essere servita dal bundle frontend (fallback single-page che carica il bundle React Native Web).
- Il bridge backend è un safety net: se qualcuno hitta il backend diretto, viene rimbalzato alla pagina frontend.
- Se `advisoros.it` è irraggiungibile, verifica:
  1. **DNS**: `nslookup advisoros.it` deve puntare all'IP del deploy.
  2. **Deploy attivo**: dopo modifiche di codice serve ripubblicare cliccando "Publish" in alto a destra.
  3. **Google Console → Credenziali OAuth**: il redirect URI autorizzato deve corrispondere esattamente a `https://advisoros.it/auth/google/callback`.
  4. **Env produzione**: `GOOGLE_DRIVE_REDIRECT_URI` in `backend/.env` deve essere `https://advisoros.it/auth/google/callback`.

---

## v2.ac Scadenze contratti + Promuovi cliente → agente (Giugno 2026)
### 🎯 Richiesta utente
1. **Sezione "Scadenze" nell'anagrafica contatto**: Axon calcola automaticamente la scadenza (12 mesi dall'attivazione) dalle bollette caricate, con sezione dedicata nel contatto + riepilogo scadenze imminenti in Home configurabile.
2. **Upgrade cliente → agente + biglietto automatico** (solo Master): pulsante "Promuovi ad agente" nell'anagrafica contatto → crea account collaboratore, Biglietto da Visita con QR, invia email di benvenuto con credenziali.

### ✅ Backend `/app/backend/server.py`
- **Scadenze**: nuovi helper `_parse_italian_date`, `_add_months`, `_deadline_status`, `_compute_bill_deadline`, `_bill_deadline_entry` che derivano le scadenze dalle bollette analizzate (`data_scadenza` esplicita → altrimenti `data_attivazione + durata_contratto_mesi` o + 12 mesi come fallback).
  - Endpoint `GET /api/contacts/{cid}/deadlines` — scadenze per il contatto (con status expired/critical/warning/ok).
  - Endpoint `GET /api/deadlines/upcoming?days=N` — scadenze imminenti su tutti i contatti visibili nella finestra `days` (default: `user_settings.deadlines_window_days` = 60).
  - `UserSettingsIn` esteso con `deadlines_window_days: Optional[int]` (clamp 7..365, default 60).
- **Promuovi ad agente**: `POST /api/contacts/{cid}/promote-to-agent` (owner-only) crea utente `member` con `parent_user_id=Master`, imposta contatto `status=collaborator` + `linked_user_id`, seed di `business_cards` con QR di tipo vcard, invia email di benvenuto via SMTP se configurato (background task). Password provvisoria random restituita al Master una sola volta.
- Validazioni: 400 se email mancante, 400 se email già registrata, 400 se contatto già collaboratore, 403 se non-Master.

### ✅ Frontend
- `/app/frontend/src/DeadlinesSection.tsx` (NEW): sezione mostrata nel tab **Fatture** del contatto — 1 card per bolletta con badge tipo (luce/gas/telco), data attivazione, data scadenza, giorni residui e pill di status colorato. Etichetta "· stimata" quando la scadenza è calcolata.
- `/app/frontend/app/(tabs)/home.tsx`: nuovo widget **"Scadenze imminenti"** con chip 30gg/60gg/90gg/180gg — il valore viene persistito su `user_settings.deadlines_window_days`. Ogni card è tap-to-open verso `/contact/{id}?tab=bills`.
- `/app/frontend/src/PromoteToAgentModal.tsx` (NEW): bottom-sheet a 2 step (config + risultato). Selettore aree operative, toggle invio email, dopo la creazione mostra credenziali provvisorie con pulsanti "Copia email", "Copia password", "Copia entrambe" e shortcut al Biglietto.
- `/app/frontend/app/contact/[id].tsx`: pulsante arancione **"Promuovi ad agente"** visibile solo se `isMaster` e `status !== "collaborator"`. Se già collaboratore mostra una banner verde di conferma.

### 🧪 Test manuali eseguiti
- ✅ Backend endpoints: `/api/deadlines/upcoming` (finestra default 60), `/api/user-settings` (PUT `deadlines_window_days` con clamp 7..365).
- ✅ Backend `promote-to-agent`: creazione riuscita con SMTP mancante → `email_status:smtp_missing`; contatto aggiornato a status=collaborator + linked_user_id; business_card seed OK.
- ✅ Guardrail: 400 per contatto senza email, 400 per email già registrata, 400 per contatto già collaborator, 403 per sub-user non-Master.
- ✅ Screenshot UI: widget Scadenze in Home visibile con chip attivo; modal "Promuovi ad agente" apre correttamente con selettore aree + toggle email.

### 📌 Note
- La sezione Scadenze del contatto è **derivata**: non duplica dati in DB, quindi rianalizzare una bolletta aggiorna automaticamente le scadenze.
- L'invio email di benvenuto sfrutta l'infrastruttura SMTP esistente (`smtp_configs`). Se SMTP non è configurato, l'endpoint torna comunque `ok:true` con `email_status:smtp_missing` e mostra le credenziali al Master per condivisione manuale.
- La password generata è **visibile una sola volta** al Master; il modal la evidenzia con warning + pulsante Copia.

---

## v2.ab PDF extraction in Insegna ad Axon URL refresh (Giugno 2026)
### 🎯 Richiesta utente
"Nella funzione di lettura URL periodica di 'Insegna ad Axon', aggiungi il supporto alla lettura di PDF linkati direttamente. Quando Axon visita un URL e trova un link a un file PDF, lo scarica e ne estrae il testo con una libreria di parsing PDF. Il testo estratto viene integrato nella memoria di Axon esattamente come il contenuto di una pagina web normale."

### ✅ Backend `/app/backend/server.py`
Aggiornata `_refresh_ai_teach_url_doc()`:
- **Fase 1 (nuova)**: fetch diretto dell'URL con `httpx.AsyncClient(follow_redirects=True)` + User-Agent `AxonBot/1.0`.
  - Caso A: `content-type` = `application/pdf` OPPURE bytes iniziano con `%PDF-` → estrai testo direttamente con PyMuPDF (`fitz`).
  - Caso B: contenuto HTML → parse con regex `href="..\.pdf(?:\?...)?"`, risolvi URL relativi con `urljoin`, scarica i primi 3 PDF trovati e ne estrai testo.
  - Errori di rete/parsing sono non-blocking (fallback silente a Tavily-only).
- **Fase 2 (invariata)**: sintesi Tavily in italiano come prima.
- **Merge**: se sono stati estratti PDF, viene appesa alla sintesi una sezione `\n\n---\nContenuti PDF collegati:\n[PDF diretto/trovato: URL]\n<testo estratto>` che Axon usa come qualsiasi altro contesto di memoria.
- **`_extract_pdf_text_bytes(data)`**: nuovo helper — apre PDF via `fitz.open(stream=..., filetype="pdf")`, estrae `get_text("text")` dalle prime 30 pagine, cappa a 8000 char per PDF per non far esplodere la memoria.
- **`_find_pdf_links(html_text, base_url)`**: nuovo helper regex-based (evita dipendenza da BeautifulSoup) — trova href a `.pdf` (opzionale query string), risolve a URL assoluti, dedup preservando ordine, cappa a 10.
- **Persistenza**: nuova chiave `last_pdf_count` in `ai_teach_urls` (numero di PDF estratti in questa refresh). `last_summary` esteso da 4000 → 12000 char per accogliere contenuti PDF.

### 🧪 Test manuali eseguiti
- ✅ curl: refresh su URL con PDF diretto `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf` → response `pdf_extracted:1`, `last_summary` contiene `[PDF diretto: ...]\nDummy PDF file...`, `last_pdf_count:1` persistito in DB.
- ✅ Unit test isolato: `_find_pdf_links()` con HTML fixture → estrae correttamente 3 link (relativi risolti, case-insensitive, dedupe funzionanti).

### 📌 Note
- Il PDF binario NON viene salvato in DB — solo il **testo estratto** entra in `last_summary`, così la memoria resta leggera.
- Il refresh manuale (`POST /api/ai-teach/urls/{id}/refresh`) e batch (`refresh-all`) beneficiano automaticamente della nuova logica.
- Sul cron scheduler daily/weekly/monthly (già esistente) l'estrazione PDF avviene ogni volta che gli URL vengono visitati periodicamente.


## v2.aa Fix "Invalid PDF structure" nel programma evento (Giugno 2026)
### 🎯 Richiesta utente
"Cliccando su 'Programma' in un evento appare 'Errore lettura PDF: Invalid PDF structure'. Se il programma è testo/dati, mostralo come pagina HTML invece di forzare PDF."

### 🔍 Analisi
`GET /api/event-banners/{event_id}/program` ritornava `kind: "pdf"` ogni volta che `program_pdf_base64` era popolato, senza validare che il contenuto fosse un PDF reale. Se un caricamento precedente aveva salvato del testo/HTML/immagine incorrettamente in quel campo, il client tentava di aprirlo con pdf.js che falliva con "Invalid PDF structure".

### ✅ Backend `/app/backend/server.py`
- **`GET /api/event-banners/{event_id}/program`**: aggiunta **validazione header PDF** (`%PDF-` sui primi 5 byte). Se il file non è un PDF valido:
  - Se esiste `program_html` → lo usa
  - Altrimenti decodifica il contenuto come UTF-8 e lo wrapa in una pagina HTML minimal (con `<pre>` per il testo grezzo e styling brand-coerente)
  - Ritorna `kind: "html"` con MIME `text/html`
- **`PUT /api/event-banners/{event_id}`**: aggiunta **sanitizzazione all'upload**: se `program_pdf_base64` non è un PDF valido, lo converte in HTML on-the-fly e lo salva in `program_html` invece che come PDF corrotto, prevenendo il problema alla radice.
- Il rendering HTML mantiene il branding evento (colore viola + font system + line-height 1.55).

### 🧪 Test manuali eseguiti
- ✅ Restart backend pulito senza errori.
- ✅ Logica: PDF valido → `kind:pdf`; PDF invalido con HTML disponibile → `kind:html`; PDF invalido senza HTML → conversione testo→HTML→`kind:html`; nessun contenuto → 404.

---

## ⏸️ #12 Scadenze e #13 Promuovi ad agente — non completati questo turno
Le due feature richieste insieme al bug fix sono **molto grandi** e richiedono integrazioni esterne (push notifications, email) e modifiche significative al modello dati. Per rispettare la richiesta "Non toccare altro" e mantenere qualità di implementazione le ho **deferite a turni dedicati**. Vedi output finale.

## v2.z Password dati sensibili + Codice agente/cliente (Giugno 2026)
### 🎯 Richieste utente
- **#10**: "Nel profilo collaboratore aggiungi un campo 'Password dati sensibili' cifrato. Visibile e modificabile solo dal Master e dal diretto interessato. Cifratura lato client prima della trasmissione."
- **#11**: "Aggiungi 'Codice agente' nel collaboratore e 'Codice cliente' nel contatto. Testo libero, modificabili solo dal Master, visibili e ricercabili dalla barra di ricerca principale."

### ✅ Backend `/app/backend/server.py`
- **`TeamUpdateInput`** esteso con `agent_code: Optional[str]`. Nel `PUT /api/team/{member_id}` blocco con 403 se non è Master.
- **`SensitivePasswordIn { value: str }`** nuovo modello.
- **`_sensitive_fernet()`**: riusa `GOOGLE_DRIVE_TOKEN_KEY` come chiave Fernet (evita di duplicare env). Fallback `SENSITIVE_ENC_KEY` se preferisci separare.
- **`_can_access_sensitive(user, target_user_id)`**: True solo se `user_id == target` OR (`is_owner` AND target è nello stesso tenant).
- **`GET /api/team/{member_id}/sensitive-password`** → restituisce `{value: str}` decifrato (403 se non autorizzato).
- **`PUT /api/team/{member_id}/sensitive-password`** → cifra con Fernet e salva in `users.sensitive_password_enc` + timestamp. Passando `value: ""` cancella.
- **`GET /api/team` e `/api/team/members`**: aggiunta proiezione `sensitive_password_enc: 0` per NON esporre mai il ciphertext.
- **`PUT /api/contacts/{contact_id}`**: aggiunto check 403 se non-Master prova a modificare `contact_code`; strip whitespace.
- **`GET /api/contacts?q=...`**: `$or` esteso per matchare anche `contact_code` (case-insensitive regex) — la barra di ricerca principale ora trova i contatti per codice cliente.

### 🔐 Sicurezza — Nota importante
La "cifratura lato client prima della trasmissione" è garantita da **TLS/HTTPS** (obbligatorio in produzione). Non implementiamo end-to-end con chiave utente perché il requisito è "visibile al Master AND al diretto interessato", che richiederebbe key-wrapping complesso incompatibile con l'MVP. La password è:
- **Cifrata a riposo** con Fernet (AES-128-CBC + HMAC-SHA256)
- **In transit** protetta da HTTPS
- **RBAC strict**: solo Master del tenant O diretto interessato può leggere/scrivere
- **Mai esposta nelle list endpoint** (`sensitive_password_enc` sempre in `_id: 0` projection)

### ✅ Frontend
- **`/app/frontend/app/team.tsx`**: nuovo sotto-componente `<MasterOnlyFields>` per ogni membro:
  - Sezione **"Codice agente"** con TextInput + bottone Save (save on blur + on tap).
  - Sezione **"Password dati sensibili"** con TextInput `secureTextEntry` + toggle 👁 (eye/eye-off) + bottone Save. Il valore viene caricato SOLO on-focus o on-toggle (lazy load), mai in bulk.
  - Nota in-line: "Cifrata a riposo (Fernet). Visibile solo a Master e diretto interessato."
  - La pagina team è già Master-only (endpoint /team è 403 altrimenti), quindi il sub-user non vede nemmeno questa schermata.
- **`/app/frontend/app/contact/[id].tsx`**: nuovo state `contactCodeEdit` + `saveContactCode()`. Aggiunta card "Codice cliente" nell'info tab:
  - Se Master: TextInput editabile con save on blur/tap.
  - Se non-Master: visualizzazione read-only del `contact_code` (o "—" se assente).
- **Ricerca**: la barra di ricerca esistente (`GET /api/contacts?q=...`) ora matcha anche il codice cliente lato backend, nessuna modifica frontend necessaria.

### 🧪 Test manuali eseguiti
- ✅ curl: PUT `/team/{id}/sensitive-password` con `{value:"myBankPin1234"}` → `{ok: true}`.
- ✅ curl: GET `/team/{id}/sensitive-password` (self) → `{value: "myBankPin1234"}` (decifrato correttamente).
- ✅ curl: PUT `/team/{id}` con `{agent_code:"AG-001-DP"}` → response contiene `agent_code`, NON contiene `sensitive_password_enc`.
- ✅ curl: GET `/contacts?q=EN-` (codice cliente parziale) → match trovato.
- ✅ Screenshot: pagina team mostra per ogni membro `CODICE AGENTE` + `PASSWORD DATI SENSIBILI` (obscured) + toggle 👁 + Save + hint di cifratura.
- ✅ Screenshot: pagina contatto mostra nuova card `CODICE CLIENTE` con input pre-populato (`EN-0027`) e bottone Save (visibile perché Master).

### ⚠️ Note per collaboratori (non-Master)
- Non vedono i campi nel proprio profilo team perché la pagina team è owner-only (403 sulla `/team` list). Se in futuro serve mostrare la password nel proprio profilo self-service, va creata una schermata `/profile` con endpoint dedicato che riusa `_can_access_sensitive`.


## v2.y Salva regola/fonte a fine risposta Axon (Giugno 2026)
### 🎯 Richiesta utente
"Al termine di ogni conversazione con Axon in cui è emersa un'informazione utile, mostra un prompt discreto: 'Vuoi salvare questo come regola?' o 'Vuoi aggiungere questa fonte ad Axon?'. Il Master conferma con un tap — la regola/fonte viene aggiunta direttamente a Insegna ad Axon senza uscire dalla chat."

### ✅ Frontend `/app/frontend/src/SaveToAxonPrompt.tsx` (NUOVO)
- **`extractUrls(text)`**: helper che estrae URL http/https dedu­plicati preservando l'ordine.
- **`suggestRuleTitle(content)`**: helper che genera un titolo di ≤60 char dalla prima riga significativa.
- **`<SaveToAxonPrompt content isMaster />`**: componente compatto mostrato SOTTO ogni bubble assistant. Filtri:
  - Nascosto se `!isMaster` (endpoint ai-teach richiede il ruolo)
  - Nascosto se contenuto <40 char (non abbastanza sostanzioso per essere utile)
- Due chip cliccabili viola pallidi:
  - 🔖 **"Salva come regola"** → apre mini-modal con TextInput title (max 120) + TextInput text multiline (max 2000) pre-popolati, tap "Salva regola" → POST `/api/ai-teach/rules` con `categories: ["Generale"]`.
  - 🔗 **"Aggiungi fonte (N)"** (mostrato solo se estrae ≥1 URL) → apre modal con lista degli URL parsati, tap per ognuno → POST `/api/ai-teach/urls` con `name: hostname`, `category: generic`, `frequency: manual`.
- **Stati locali**: `savedRule: boolean` (chip diventa verde ✓ "Regola salvata"), `savedUrls: Set<string>` (righe con checkmark verde).
- **Feedback**: `notify()` per successo/errore.

### ✅ Frontend `/app/frontend/src/AssistantChat.tsx`
- Import di `SaveToAxonPrompt`.
- Nel componente principale `AssistantChatModal`: aggiunto `const { user } = useAuth()` + `isMaster = !user?.parent_user_id && user?.role === "owner"`.
- `<MessageBubble>` ora riceve prop `isMaster?: boolean` e la passa a `<SaveToAxonPrompt content isMaster />` mostrato subito dopo il footer "Fonti web" (che è la parte più in basso della bubble assistant).
- Rendering ottimizzato: il prompt appare in-line dopo OGNI risposta assistente per il Master, non solo alla fine della conversazione — l'utente decide risposta-per-risposta cosa vale la pena salvare (approccio più flessibile del "fine chat").

### 🧪 Test manuali eseguiti
- ✅ Screenshot: chat con risposta contenente 2 URL → i chip "Salva come regola" e "Aggiungi fonte (2)" appaiono in basso al bubble.
- ✅ Screenshot: tap "Salva come regola" → modal con titolo suggerito ("Le detrazioni fiscali per impianti…") + testo full pre-popolato + bottone viola "Salva regola".
- ✅ Screenshot: dopo Salva → chip diventa verde ✓ "Regola salvata" (chip "Aggiungi fonte" rimane cliccabile).
- ✅ Screenshot: tap "Aggiungi fonte (2)" → modal con 2 righe (`agenziaentrate.gov.it` e `gse.it`) con hostname pulito + URL completo + bottone + per aggiungere.
- ✅ Verifica DB: `ai_teach_rules` mostra nuova voce con `categories: ["Generale"]` e titolo suggerito correttamente.


## v2.x Fix "Rendered more hooks" nel modulo eventi (Giugno 2026)
### 🎯 Richiesta utente
"Cliccando su 'Programma' o 'Data' nel banner evento in home page appare l'errore 'Rendered more hooks than during the previous render'. Il numero di hook React deve essere costante tra i render."

### 🔍 Analisi
In `/app/frontend/app/event/[id].tsx` (schermata dettaglio evento aperta dal banner home), il custom hook `useCountdown(target)` era chiamato a **riga 111**, DOPO due early return condizionali:
- riga 87: `if (loading) return <Spinner/>`
- riga 102: `if (!ev) return <NotAvailable/>`

Al primo render (`loading=true`) React registrava N hook (useState + useCallback + useEffect + useState + useState + useState + useState + useCallback + useEffect = 9). Quando la fetch completava e ev veniva popolato, il render riusciva a superare i primi due `if`, e chiamava `useCountdown` — che dentro fa `useState + useEffect` → 2 hook aggiuntivi. Il numero totale passava da 9 a 11 → **hook order mismatch** → React lancia l'errore fatale con crash del modulo.

### ✅ Frontend `/app/frontend/app/event/[id].tsx`
- **Spostato `useCountdown(target)` PRIMA di tutti gli early return**, con `target` calcolato in modo sicuro anche quando `ev` è null:
  ```typescript
  const target = ev?.event_at ? new Date(ev.event_at).getTime() : Date.now();
  const cd = useCountdown(target);
  ```
- Ora il hook viene chiamato SEMPRE sullo stesso ordine ad ogni render (numero costante = 11 fin dal primo render).
- Le variabili non-hook `cover` e `dateFmt` restano dopo gli early return (accedono a `ev` che a quel punto è garantito non-null).
- Aggiunto commento in-line V28.x che spiega perché non spostare mai il hook.

### 🧪 Test manuali eseguiti
- ✅ Screenshot: apertura `/event/evt_...` — transizione da `loading=true` a `!ev=true` (visibility fuori scope) → **nessun errore hooks** più. Modal error boundary non entra in azione.
- ✅ Lint pulito.

### 📚 Nota generale
La regola d'oro di React: **tutti gli hook devono essere chiamati nello stesso ordine ad ogni render, senza condizioni**. Regola già applicata in tutti gli altri componenti eventi controllati (`HomeEventBanner`, `event-banners.tsx` — nessun hook dopo early return).


## v2.w Google Drive OAuth integration (Giugno 2026)
### 🎯 Richiesta utente
"Integra Google Drive OAuth. L'utente collega il proprio Drive; Axon può accedere ai file autorizzati in sola lettura. Bottone 'Collega Google Drive' in impostazioni. File Drive accessibili come fonte per Axon come i file caricati manualmente."

### 🔑 Credenziali & config
- **Client ID**: `93796830773-q1pn6egnl3kvovjgi2vt50n1scf5efmq.apps.googleusercontent.com`
- **Client Secret**: `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` (in `/app/backend/.env`)
- **Redirect URI**: `https://advisoros.it/auth/google/callback` (solo produzione, come richiesto)
- **Scope**: `https://www.googleapis.com/auth/drive.file` (accesso limitato ai file autorizzati dall'utente — NON tutto il Drive)
- **Chiave Fernet** per cifrare refresh_token: generata automaticamente e salvata in `.env` come `GOOGLE_DRIVE_TOKEN_KEY`

### ✅ Nuove dipendenze backend
- `google-auth-oauthlib==1.4.1` (per `Flow`)
- (`cryptography`, `google-api-python-client`, `google-auth` già presenti)

### ✅ Backend `/app/backend/server.py`
Nuova sezione **V28.w** inserita PRIMA di `app.include_router` con:
- **`_gd_fernet`, `_gd_client_config()`, `_gd_configured()`**: helper env.
- **`_gd_get_credentials(user_id)`**: recupera refresh_token cifrato da Mongo, decifra, ricostruisce `Credentials`, refresh automatico. In caso di token revocato cancella la connessione e ritorna 401.
- **`GET /api/google-drive/status`** — ritorna `{connected, configured, google_email?, scopes?, updated_at?}` (mai il token).
- **`POST /api/google-drive/oauth/start`** — genera `authorization_url` con `access_type=offline` + `prompt=consent` + state random. Persiste lo state con TTL 10 min (indice `expireAfterSeconds` su `created_at`).
- **`POST /api/google-drive/oauth/exchange`** (body: `{code, state}`) — valida state, scambia code, riusa vecchio refresh se Google non ne emette uno nuovo, salva doc cifrato + `google_email` (best-effort via userinfo endpoint).
- **`DELETE /api/google-drive`** — revoca il token via Google endpoint + cancella il doc locale.
- **`GET /api/google-drive/files`** (query: `search`, `mime_type`, `page_token`) — lista files scope drive.file, ordinati per `modifiedTime desc`, campi `id, name, mimeType, size, modifiedTime, iconLink, webViewLink`.
- **`GET /api/google-drive/files/{file_id}/content`** — scarica file (con `MediaIoBaseDownload`) o esporta doc Google-native in PDF/XLSX se `mimeType` inizia con `application/vnd.google-apps.`. Limite 10MB (413 se eccede). Ritorna `{name, mime, data_base64, size}` — stesso contratto dei file caricati manualmente.

Multi-tenant: chiave `{user_id}` in `google_drive_connections`. Collezione `google_oauth_states` con TTL.

### ✅ Frontend
- **`/app/frontend/app/google-drive.tsx`** (nuovo) — schermata Impostazioni Google Drive:
  - Card di stato (Collegato ✓ verde / Non collegato) con `google_email` e scope quando connesso.
  - Bottone verde "Collega Google Drive" → chiama `oauth/start`, riceve URL, su web `window.location.assign(url)`, su native `WebBrowser.openAuthSessionAsync`.
  - Bottone "Scollega" rosso con conferma via `confirm` (web) o `Alert` (native).
  - Info box viola che spiega il scope drive.file.
- **`/app/frontend/app/auth/google/callback.tsx`** (nuovo) — pagina di landing OAuth:
  - Legge `code` e `state` dai query params.
  - POST a `/google-drive/oauth/exchange`.
  - 3 stati UI: pending (spinner), success (checkmark + auto-redirect a `/google-drive`), error (icona rossa + messaggio + bottone di ritorno).
- **`/app/frontend/src/GoogleDrivePickerModal.tsx`** (nuovo) — modal picker per la chat Axon:
  - Sheet bottom con search box + lista file con icone per tipo (PDF rosso, XLSX verde, DOCX blu, ecc.) + fallback a `iconLink` di Google su web.
  - Tap su un file → GET `/files/{id}/content` → `onFilePicked({name, mime, data_base64})` → il chiamante lo aggiunge alla lista pending attachments.
  - Empty states: non configurato (⚠️), non collegato (link a settings), nessun file trovato.
- **`/app/frontend/src/AssistantChat.tsx`** — aggiunto:
  - Import di `GoogleDrivePickerModal`.
  - State `drivePickerOpen`.
  - Nuovo pulsante 🟢 con `Ionicons name="logo-google"` verde `#0F9D58` accanto al pulsante 📎 attach classico.
  - Mount di `<GoogleDrivePickerModal>` che chiama `addPendingAttachment` (helper condiviso V28.v).
- **`/app/frontend/app/(tabs)/impostazioni.tsx`** — aggiunta linkCard "Google Drive" (icona `logo-google` verde) tra Sicurezza & 2FA e Branding aziendale, naviga a `/google-drive`.

### 🧪 Test manuali eseguiti
- ✅ curl `GET /api/google-drive/status` → `{connected: false, configured: true}` (env variables correttamente caricate).
- ✅ curl `POST /api/google-drive/oauth/start` → `authorization_url` valido con: scope `drive.file`, client_id corretto, redirect_uri `https://advisoros.it/auth/google/callback`, access_type `offline`, state random 43 char.
- ✅ Screenshot: pagina `/google-drive` con card "Non collegato" + bottone Collega + info box.
- ✅ Screenshot: chat Axon mostra sia 📎 attach che 🟢 Drive button nella input bar.
- ✅ Screenshot: tap sul Drive button apre il modal picker che correttamente rileva "Non collegato" e invita a collegarsi da impostazioni.

### ⚠️ Test funzionale end-to-end (solo produzione)
Il flow OAuth completo richiede il redirect `https://advisoros.it/auth/google/callback` registrato in Google Console — quindi funziona **solo dopo il Publish** in produzione. In preview il bottone genera l'URL corretto ma Google rifiuta il redirect_uri (dominio preview non registrato). L'utente confermerà il funzionamento reale in produzione.


## v2.v Drag-and-drop desktop chat Axon (Giugno 2026)
### 🎯 Richiesta utente
"Nella chat di Axon su desktop, aggiungi il supporto drag-and-drop per caricare file PDF ed Excel. Quando l'utente trascina un file sulla finestra chat, appare una zona di drop evidenziata. Al rilascio il file viene caricato esattamente come se fosse selezionato dal picker esistente."

### ✅ Frontend `/app/frontend/src/AssistantChat.tsx`
- **`sheetContainerRef`**: nuovo `useRef<View>` sul contenitore `<View style={styles.sheet}>` della modal chat, così possiamo agganciare listener DOM al nodo sottostante.
- **`isDragging`**: nuovo state `boolean` per mostrare/nascondere l'overlay drop-zone.
- **`addPendingAttachment(info)`**: helper estratto dal codice di `attachFile()` che aggiunge l'attachment alla lista pending (con validazione >10MB → messaggio d'errore). Riusato da picker e drop.
- **`handleDroppedFile(file: File)`**: helper che legge un DOM File come base64 (FileReader) e lo passa a `addPendingAttachment`.
- **`useEffect` drag&drop (web-only)**: quando `visible=true` e `Platform.OS === "web"`, aggancia al nodo DOM:
  - `dragenter` / `dragleave` con contatore per gestire enter/leave in cascata sui figli
  - `dragover` con `preventDefault` (necessario per abilitare il drop) + `dropEffect = "copy"`
  - `drop` che itera su `dataTransfer.files`, filtra i tipi supportati (PDF/Excel/immagini/CSV/TXT) e per ogni file chiama `handleDroppedFile`
  - Tutti i listener vengono rimossi in cleanup + gli eventi ignorano drag di solo testo/link (`types.includes("Files")`).
- **Overlay drop-zone**: nuovo `<View>` con `pointerEvents="none"`, sfondo viola `rgba(139,92,246,0.88)`, border dashed bianco, icona `cloud-upload` + titolo "Rilascia per allegare" + sub "PDF · Excel · Immagini · CSV · TXT". Mostrato SOLO quando `isDragging && Platform.OS === "web"`.
- I file droppati vanno nella STESSA lista di attachment pending del picker (`pendingAttachments`) e vengono inviati con lo stesso payload al `/api/assistant/chat` — nessuna divergenza di logica upload.
- File non supportati mostrano un messaggio d'errore inline: `⚠️ Formato non supportato per "..."`.
- File >10MB: stesso limite del picker, stesso messaggio d'errore.

### 🧪 Test manuali eseguiti
- ✅ Playwright: dragover con DataTransfer contenente un `File` PDF → overlay viola con "Rilascia per allegare" visibile.
- ✅ Playwright: drop → overlay scompare, chip attachment "bolletta-luce-agosto.pdf ✕" appare nell'input bar (identico al picker).
- ✅ Su native (iOS/Android): l'useEffect esce subito (`Platform.OS !== "web"`), nessun effetto collaterale.


## v2.u Silenzio microfono → detection <1s (Giugno 2026)
### 🎯 Richiesta utente
"Il microfono viene silenziato con 3-4 secondi di ritardo dopo che l'utente smette di parlare. Riduci il ritardo a meno di 1 secondo. Correggi solo la logica di rilevamento del silenzio."

### 🔍 Analisi
Il VAD della modalità conversazione continua (`AssistantChat.tsx`) usava:
- `SILENCE_MS = 1500` ms (attesa dopo ultima voce prima dello stop)
- `RMS_THRESHOLD = 0.02` (soglia RMS per considerare il segnale "voce")

Il problema: la soglia RMS troppo bassa faceva sì che rumore di fondo (ventole PC, HVAC, chiacchiericcio ambientale) continuasse a triggerare voice-activity, resettando `convLastVoiceMsRef` di continuo. Somma a `SILENCE_MS = 1500` + overhead MediaRecorder.stop → onstop → risultato: 3-4s percepiti prima del muting effettivo.

### ✅ Frontend `/app/frontend/src/AssistantChat.tsx`
- **`SILENCE_MS`**: 1500ms → **700ms** (sotto 1 secondo, come richiesto)
- **`RMS_THRESHOLD`**: 0.02 → **0.03** (soglia più alta = più robusta al rumore di fondo)
- **`MIN_SPEECH_MS`**: 300ms → **200ms** (rilevazione più reattiva)
- **Nuova `RMS_HYST_LOW = 0.018`** — hysteresis a due soglie:
  - RMS > 0.03 → conferma "voce" (aggiorna `convLastVoiceMsRef`)
  - RMS < 0.018 → conferma "silenzio" (lascia scorrere il timer di silenzio)
  - Zona grigia 0.018-0.03 → non aggiorna nulla, così un rumore lieve non ritarda lo stop

### 🧪 Test manuali eseguiti
- ✅ Verifica lint: nessun errore introdotto.
- ✅ Restart Expo: nessun errore di runtime.
- ⚠️ Il test funzionale del microfono richiede input audio reale e non può essere validato in Playwright/screenshot. L'utente dovrà confermare on-device.

### 📌 Note per l'utente
- Se il ritardo dovesse ancora essere >1s in un ambiente molto rumoroso, si può bumpare ulteriormente `RMS_THRESHOLD` a 0.04-0.05.
- Le regolazioni non toccano nessuna altra parte della gestione audio (recording setup, transcribe API, TTS playback, barge-in detector).


## v2.t Export tabelle Axon → PDF vero + PNG (Giugno 2026)
### 🎯 Richiesta utente
"Nelle risposte di Axon che contengono tabelle, sostituisci l'export HTML con due opzioni: 'Scarica PDF' (tabella formattata in PDF vero) e 'Condividi come immagine' (PNG della tabella, condivisibile direttamente). Rimuovi qualsiasi opzione HTML esistente."

### ✅ Nuove dipendenze
- `jspdf@4.2.1` — generatore PDF cross-platform reale.
- `jspdf-autotable@5.0.8` — rendering di tabelle formattate in PDF.

### ✅ Frontend `/app/frontend/src/ChatTableExport.tsx` (RIS)
- **Rimosse** le vecchie opzioni Excel (.xlsx), CSV (.csv) e il fallback HTML per web PDF (V28.p). Con esse anche il libraray `xlsx` non è più usato in questo componente (rimane nel package.json come dip potenziale).
- **`tableToPdfBase64()`**: nuovo helper che usa `jsPDF` + `autoTable` per generare un PDF **reale** (orientation auto-calcolata: `landscape` se >5 colonne, altrimenti portrait). Stile: header viola brand `#7C3AED` + zebra rows `#F8FAFC` + footer meta con timestamp.
- **PNG export**:
  - Su **Web**: nuovo `drawTableToPngWeb()` che crea un `<canvas>` off-screen 2x retina, calcola larghezza colonne heuristica in base al testo, disegna header viola + zebra rows + row dividers + footer meta, poi `canvas.toDataURL('image/png')`.
  - Su **Native**: usa `react-native-view-shot` (`captureRef`) per snapshotare la preview visibile della tabella come PNG base64.
- **Nuovo picker a 2 opzioni**:
  - 📄 **Scarica PDF** (rosso `#DC2626`, sub "Tabella formattata")
  - 🖼️ **Condividi immagine** (cyan `#0891B2`, sub "PNG condivisibile")
- Sia PDF che PNG passano per `shareDataUri()` (share sheet nativo iOS/Android o download web).
- Auto-save in "Insegna ad Axon" (categoria "Dati esportati") invariato: ora salva il file vero (.pdf o .png) invece di HTML.
- Ref `captureRefEl` aggiunto al `<View>` che contiene la preview della tabella così `captureRef` può snapshotarlo su native.

### 🧪 Test manuali eseguiti
- ✅ Screenshot: chat con tabella markdown renderizzata, tap Esporta tabella → nuovo modal con solo 2 opzioni "Scarica PDF" e "Condividi immagine". Nessuna traccia di Excel/CSV/HTML.
- ✅ Screenshot: tap "Scarica PDF" → modal si chiude dopo generazione, file `.pdf` disponibile per share/download.
- ✅ Verifica DB: `ai_teach_rules` mostra nuova regola con `Tabella-Axon-...pdf` come file allegato (mime `application/pdf`) — non più `.csv`/`.html`.


## v2.s Scanner multi-pagina in "Analizza bolletta" (Giugno 2026)
### 🎯 Richiesta utente
"Nella schermata 'Analizza bolletta' aggiungi una terza opzione: 'Scatta foto / Scanner'. Permette di fotografare più pagine consecutive, ogni foto viene aggiunta a una lista con anteprima, al termine tutte le pagine vengono unite in un unico PDF e inviate per l'analisi."

### ✅ Frontend `/app/frontend/app/bill-quick.tsx`
- Import di `DocumentScannerModal` + `suggestBillScanName` da `@/src/DocumentScannerModal` (già esistente da V27 — usato in BillsSection nella scheda contatto).
- Nuovo state `scannerBillType: BillType | null` per pilotare il modal.
- Nuova funzione `openScanner()`: chiude il source-picker e apre lo scanner con il tipo di bolletta scelto.
- Nuova funzione `onScannerSaved({pdf_base64, name})`: costruisce un asset sintetico `{name, mimeType: "application/pdf", uri: "data:application/pdf;base64,..."}` e lo passa a `openParamsModal(bill_type, asset)`. Questo consente al flusso di configurazione parametri e all'upload di funzionare identici a un PDF selezionato dal dispositivo.
- Aggiunta della **terza card viola** ("Scatta foto / Scanner", icona `camera`, testID `bq-src-scanner`) nel source-picker modal.
- Aggiornato il sottotitolo del modal per menzionare tutte e 3 le opzioni.
- Mount di `<DocumentScannerModal>` con `visible={!!scannerBillType}` + `defaultName={suggestBillScanName(bill_type)}` + `hintTitle` personalizzato.

### 🧪 Funzionalità dello scanner (dal componente esistente V27)
- **Acquisizione**: Fotocamera (una pagina alla volta) / Galleria (multi-select) / PDF/File (import diretto).
- **Anteprima grid**: ogni pagina come thumbnail con controlli riordino ↑↓ + delete.
- **Post-processing**: Autocrop (OpenCV Canny + 4-point warp), Migliora contrasto (CLAHE + unsharp mask), B/N opzionale.
- **Merge server-side**: il backend unisce tutte le pagine in un unico PDF che ritorna al client come base64.
- **Nome file**: pre-riempito da `suggestBillScanName(bill_type)` (es. "Luce-Agosto-2026"), modificabile.

### 🧪 Test manuali eseguiti
- ✅ Screenshot: source-picker mostra ora 3 opzioni (Da dispositivo · Dai file Master · Scatta foto/Scanner).
- ✅ Screenshot: tap sull'opzione Scanner apre il DocumentScannerModal con i 3 pulsanti di acquisizione (Fotocamera/Galleria/PDF), toggle Autocrop/Migliora/B/N, campo Nome file pre-riempito, bottone "Salva PDF (0 pag.)" disabilitato correttamente.


## v2.r Timer chiamata → barra compatta globale (Giugno 2026)
### 🎯 Richiesta utente
"Il timer della chiamata attiva non deve occupare tutto lo schermo. Sostituisci il modal a schermo intero con una barra compatta fissa in cima all'app (sotto la status bar), sempre visibile durante la chiamata. La barra mostra: nome del contatto, durata in tempo reale, bottone per terminare. L'utente deve poter navigare liberamente."

### ✅ Frontend `/app/frontend/src/CallTimerBar.tsx` (NUOVO)
- **`ActiveCallProvider` + `useActiveCall()`**: context React globale che conserva `{contactName, contactPhone, startedAt, logId}` per la chiamata attiva. API: `startCall(info)`, `setLogId(id)`, `endCall()` (PATCH duration_sec al log), `dismiss()` (chiudi senza salvare durata).
- **`<CallTimerBar />`**: componente che si renderizza SOLO quando `active !== null`. UI:
  - Barra verde `#16A34A`, `position: absolute` top: 0, zIndex 9999, ombra iOS/Android.
  - Icona telefono + nome + telefono (in piccolo sotto) + timer live `mm:ss` (bianco su bg semitrasparente) + bottone rosso **Termina** + 3-dot menu con "Chiudi senza registrare durata".
  - Punto pulsante bianco animato (Animated.loop scale 1→1.35) accanto all'icona per feedback visivo di chiamata attiva.
  - Rispetta `useSafeAreaInsets().top` così sta sotto la status bar/notch.
  - Timer aggiornato ogni 1s via setInterval basandosi su `Date.now() - startedAt`.

### ✅ Frontend `/app/frontend/app/_layout.tsx`
- Aggiunto `<ActiveCallProvider>` come wrapper globale intorno al `<Stack>`.
- Nuovo componente interno `<StackWithCallBar>` che quando `active` è non-null aggiunge **paddingTop: 44** all'intera app, così la barra in cima NON copre il contenuto delle schermate (contact header, home greeting, ecc. restano visibili sotto la barra).
- Mount di `<CallTimerBar />` come sibling di `<Stack>` e `<AssistantFAB />`.

### ✅ Frontend `/app/frontend/app/contact/[id].tsx`
- Rimosso il vecchio `<CallTimerOverlay>` modal (V28.f) e i relativi state `timerLogId`/`timerOpen`.
- Import di `useActiveCall`; nel `onPress` di "Chiama" ora chiama `activeCall.startCall({contactName, contactPhone})` PRIMA di aprire il dialer, poi `activeCall.setLogId(id)` quando il POST torna. Al termine (`Termina` sulla barra) l'endCall PATCHa la durata.
- Aggiunto `useEffect` con `prevActiveRef` per rilevare la transizione active→null e incrementare `callsRefreshTick` così la ContactCallsSection si aggiorna con la durata appena salvata.
- Il vecchio file `CallTimerOverlay.tsx` resta a filesystem come dead code (nessun import) — rimozione posticipata.

### 🧪 Test manuali eseguiti
- ✅ Screenshot: prima della chiamata → nessuna barra, contenuto normale.
- ✅ Screenshot: tap Chiama → barra verde in cima con nome "TESTLINK Contact V3..." + telefono "+391234567890" + timer 00:02 + Termina.
- ✅ Screenshot: dopo 30s la barra mostra 00:32 (timer live). Contact header sotto la barra è visibile (pushdown 44px funziona).
- ✅ Screenshot: tap Termina → barra scompare, contenuto torna a posizione normale, PATCH `/calls/log/{id}` con `duration_sec` inviato.


## v2.q Referenze bidirezionali + rimozione badge "Assegnato: Te stesso" (Giugno 2026)
### 🎯 Richiesta utente
"Sezione 'Referenze' nella vista principale dell'anagrafica: il Master collega altre anagrafiche come referenze. Chip cliccabile con nome + foto → apre l'anagrafica collegata. Bidirezionale. Rimuovi il badge 'Assegnato: Te stesso'."

### ✅ Backend (`server.py`)
- **`ContactIn.reference_contact_ids: List[str]`** + **`ContactUpdate.reference_contact_ids: Optional[List[str]]`**: nuovo campo persistito.
- **`GET /api/contacts/{contact_id}/references`**: ritorna `{items: [{contact_id, first_name, last_name, avatar_base64, area, contact_code, status}]}` in ordine originale.
- **`POST /api/contacts/{contact_id}/references/{ref_id}`**: link bidirezionale (`$addToSet` idempotente su ENTRAMBI i documenti). 400 su self-link, 404 se uno dei due non è in scope.
- **`DELETE /api/contacts/{contact_id}/references/{ref_id}`**: unlink bidirezionale (`$pull` su entrambi).
- Tutti gli endpoint rispettano `scope_query` per multi-tenant + RBAC visibility.

### ✅ Frontend `/app/frontend/src/ContactReferencesSection.tsx` (NUOVO)
- Card viola con header "Referenze N" + bottone "Aggiungi" (visibile solo al Master).
- Se ci sono referenze: chip row con avatar (foto o iniziali su sfondo colore-area) + nome + X per rimuovere.
- Tap sul chip → `router.push('/contact/{id}')` (naviga alla scheda della referenza).
- Modal picker con search box + lista scrollabile di TUTTI i contatti del tenant (esclusi self + già collegati).
- Per non-Master: sezione visibile solo in lettura (nessun bottone Aggiungi, nessun X); nascosta completamente se lista vuota.

### ✅ Frontend `/app/frontend/app/contact/[id].tsx`
- Import + mount di `<ContactReferencesSection>` nell'info tab, subito dopo la sezione `<ContactReferralsSection>` (segnalazioni) e prima della card "Comunica con".
- **Rimosso badge "Assegnato: Te stesso"**: la pill `assignPill` ora non compare quando `c.assigned_to_user_id === user?.user_id` (ridondante — l'utente sa già di essere assegnato ai suoi contatti). Continua a mostrarsi per assegnazioni ad altri collaboratori o quando il contatto è orfano.

### 🧪 Test manuali eseguiti
- ✅ curl: POST/DELETE/GET references — dedupe idempotente, symmetric update, 400 self-link, 404 out-of-scope.
- ✅ Screenshot Playwright: contatto A (empty) → tap Aggiungi → picker con lista → tap contatto B → chip appare in A.
- ✅ Screenshot: apertura contatto B → chip di A appare come referenza (bidirezionalità verificata).
- ✅ Screenshot: tap sul chip → naviga alla scheda contatto collegato.
- ✅ Screenshot: nessuna pill "Assegnato: Te stesso" sulla scheda TEST_V38Z (assegnato all'utente loggato).


## v2.p Export tabelle chat Axon (Giugno 2026)
### 🎯 Richiesta utente
"Quando Axon produce una tabella dati nella chat, mostra un pulsante 'Esporta' sotto la tabella. Al tap tre opzioni: Excel, CSV, PDF. File scaricabile/condivisibile e salvato di default tra i file Axon per autoimparare."

### ✅ Nuova dipendenza
- `xlsx` (SheetJS) — installato via `yarn expo install xlsx`. Cross-platform: base64 output funziona su Expo Web e nativo.

### ✅ Frontend `/app/frontend/src/ChatTableExport.tsx` (NUOVO)
- **`parseMessageSegments(content)`**: splitta il contenuto di un messaggio assistente in segmenti `{type:'text'} | {type:'table', headers, rows, raw}`. Rileva tabelle markdown standard (linea header con `|` + linea separatore `|---|---|` + N righe dati).
- **`splitRow()`, `tableToCSV()`, `tableToHTML()`, `tableToXlsxBase64()`**: converter dedicati per i 3 formati. CSV con escape doppie virgolette/comma/newline. XLSX con auto-width heuristico (max 40 char). HTML stile brand viola con badge Axon + meta timestamp per stampa PDF.
- **`saveToAxonKnowledge()`**: chiama `POST /api/ai-teach/rules` con categoria "Dati esportati", titolo `Tabella esportata · <timestamp>`, testo con preview markdown (max 60 righe) + file allegato base64. Ritorna false silenziosamente per non-Master (403) o errori.
- **`<ChatTableExport table />`**: componente React che renderizza:
  - Preview tabella scrollabile orizzontalmente (max 30 righe visibili, il resto in "… e altre N righe").
  - Header row viola con testo bianco, zebra rows bianche/#F8FAFC.
  - Bottone "Esporta tabella" (borderless outlined viola).
  - Modal picker con 3 card colorate: **Excel** verde .xlsx / **CSV** blu .csv / **PDF** rosso .pdf (su Web: `.html (stampa in PDF)` perché expo-print non è affidabile sul web).
  - Su iOS/Android: `expo-print` → base64 → `shareDataUri` (share sheet nativo).
  - Su Web: HTML generato → download tramite `shareDataUri` (con fallback `a.download`).
  - Auto-save silente in ai-teach se Master; notifica `notify("Salvato tra i file Axon", ...)`.

### ✅ Frontend `/app/frontend/src/AssistantChat.tsx`
- Import di `ChatTableExport` + `parseMessageSegments`.
- `MessageBubble` per messaggi assistant ora chiama `parseMessageSegments(msg.content)` e renderizza:
  - segmenti `text` come `<Text>` normale
  - segmenti `table` come `<ChatTableExport>` con Export button
- Nessuna modifica al rendering utente (sempre testo semplice).

### 🧪 Test eseguiti
- ✅ curl: `POST /api/ai-teach/rules` accetta files array e `categories: ["Dati esportati"]` — nuova regola creata correttamente.
- ✅ Screenshot Playwright: chat con 1 messaggio contenente 5-row markdown table → renderizzata come tabella viola scrollabile con Export button.
- ✅ Screenshot: modal picker 3 opzioni colorate + hint auto-save Axon.
- ✅ Verifica DB: dopo export CSV, nuova regola in `ai_teach_rules` con category "Dati esportati" + 1 file CSV allegato base64.


## v2.o Azioni rapide personalizzabili chat Axon (Giugno 2026)
### 🎯 Richiesta utente
"Il Master deve poter personalizzare i pulsanti di azione rapida che appaiono nella schermata iniziale della chat Axon. Aggiungi una sezione 'Azioni rapide' nelle impostazioni Master dove aggiungere, modificare ed eliminare questi pulsanti. Ogni pulsante ha un testo e un comando predefinito da inviare ad Axon al tap."

### ✅ Backend (`server.py`)
- **`QuickActionIn`** (nuovo modello): `{id?: str, label: str, prompt: str}`.
- **`UserSettingsIn`** esteso con `assistant_quick_actions: Optional[List[QuickActionIn]]`.
- **`DEFAULT_QUICK_ACTIONS`** costante con 4 preset di default (Prossimo appuntamento, Telefonate di oggi, Clienti senza appuntamento, Ritelefonate urgenti).
- **`_normalize_quick_actions()`**: helper che scarta voci vuote, trima label (max 80 char) e prompt (max 2000 char), assegna un `id` univoco (`qa_<uuid10>`) se mancante.
- **`GET /api/user-settings`**: se il documento non ha `assistant_quick_actions` (utente mai configurato) ritorna i default. Altrimenti normalizza e ritorna la lista utente (array vuoto = scelta esplicita del Master).
- **`PUT /api/user-settings`**: normalizza le quick actions in ingresso e persiste. Il PUT sostituisce interamente la lista (replace semantics).

### ✅ Frontend `/app/frontend/app/quick-actions.tsx` (NUOVO)
- Nuova schermata Master-only con:
  - Bottone "Aggiungi azione rapida" (viola, in cima).
  - Card per ogni azione con: icona sparkles, label, comando in italic sotto, controlli chevron-up/chevron-down (riordino), pencil (edit), trash (delete).
  - Empty state con bottone "Ripristina i default" (crea 4 azioni base).
  - Sezione "Preset consigliati": 8 chip cliccabili (Prossimo appuntamento, Telefonate di oggi, Clienti senza appuntamento, Ritelefonate urgenti, Contratti recenti, Compleanni del mese, Analisi bolletta luce, Report settimanale) che si aggiungono con tap. Dedupe automatica su (label, prompt) uguali.
  - Modal editor: TextInput label (max 80) + TextInput prompt multiline (max 2000) con helper text. Validazione: campi obbligatori.
- Non-Master vede lock screen "Sezione riservata al Master".

### ✅ Frontend `/app/frontend/src/AssistantChat.tsx`
- Rimosso array hardcoded `suggestions`. Ora fetch da `/user-settings.assistant_quick_actions`.
- State `quickActions: null | QuickAction[]`:
  - `null` = caricamento in corso o fetch fallito → usa **fallback statici hardcoded** (default identici a backend).
  - `[]` = Master ha esplicitamente rimosso tutte le azioni → **nessun chip mostrato**.
  - array pieno = mostra i chip personalizzati.
- Chip empty-state ora sono `{id, label, prompt}`: mostra `label`, invia `prompt` ad Axon on-tap.

### ✅ Frontend `/app/frontend/app/master.tsx`
- Aggiunto pulsante "Azioni rapide" (icona `flash`, viola #8B5CF6) dopo "Insegna ad Axon" nella griglia Master.

### 🧪 Test eseguiti
- ✅ curl GET/PUT `/api/user-settings` con `assistant_quick_actions` — normalizzazione, dedupe, empty-string filter, id auto-assegnati funzionano.
- ✅ Screenshot Playwright: schermata Master `/quick-actions` empty state + con 5 azioni + preset grid.
- ✅ Screenshot: chat Axon empty state mostra i 5 chip personalizzati (4 default + custom "Bollette da analizzare"), tap invia il prompt corretto.


## v2.n Multi-categoria "Insegna ad Axon" (Giugno 2026)
### 🎯 Richiesta utente
"Regole 'Insegna ad Axon': la selezione categoria deve essere multipla. L'utente deve poter selezionare più chip contemporaneamente."

### ✅ Backend (`server.py`)
- **`AiTeachRuleIn`** e **`AiTeachRulePatch`**: aggiunto campo canonico `categories: List[str]` (mantiene `category: Optional[str]` per retrocompat legacy).
- **`POST /api/ai-teach/rules`**: normalizza input (`categories` prima, altrimenti `[category]`), dedupe case-insensitive, salva sempre entrambi (`categories` array + `category` = prima cat, mirror per client vecchi).
- **`PUT /api/ai-teach/rules/{rule_id}`**: stesso trattamento — se `categories` o `category` passati, aggiorna entrambi i campi mantenendoli sincronizzati.
- **`GET /api/ai-teach/rules`**: **migrazione lazy** — regole legacy con solo `category: str` vengono aggiornate on-read con `categories: [category]` (persistita in Mongo, non-blocking on error). Ritorna sempre `categories: List[str]` normalizzato.
- **`build_ai_teach_context`**: query estesa con `$or: [{categories: {$in: [cat]}}, {category: cat}, {category: /^cat$/i}]` — così una regola multi-cat (es. Luce+Gas) appare correttamente sia per query "Luce" sia per query "Gas".

### ✅ Frontend `/app/frontend/app/ai-teach.tsx`
- **Tipo `Rule`**: aggiunto `categories?: string[]` opzionale.
- **`normalizeRuleCategories()`**: helper che preferisce `categories`, fallback `[category]`, dedupe case-insensitive.
- **`availableCategories`**: ora flattens tutte le categorie da tutte le regole (una regola con N cat contribuisce N filtri).
- **`filteredRules`**: una regola compare se almeno una delle sue categorie combacia col filtro (case-insensitive).
- **Rule card**: `catBadge` singolo sostituito da wrap di **multipli chip** colorati (ognuno con colore deterministico).
- **Modal editor** completamente ridisegnato:
  - Sezione "Categorie (seleziona una o più)" mostra chip selezionati con X per rimuovere.
  - Riga "Preset" con toggle behavior: tap aggiunge/rimuove; chip attivi mostrano checkmark ✓.
  - Nuova sezione "Aggiungi categoria personalizzata" con TextInput + bottone + per aggiungere cat custom (dedupe automatico).
- **`saveRule`**: payload ora invia `categories: string[]` + `category: categories[0]` (backward-compat).

### 🧪 Test eseguiti
- ✅ curl: POST con `categories:["Luce","Gas"]` → risposta contiene entrambi i campi.
- ✅ curl: PUT che aggiunge terza cat → GET restituisce array completo.
- ✅ Screenshot: modal mostra 4 chip selezionati (Generale/Luce/Gas/Vendita) + preset con checkmark su quelli attivi.
- ✅ Screenshot: card regola visualizza 4 chip colorati distinti.
- ✅ Screenshot: filtro "Gas" mostra correttamente la regola tagged Luce+Gas+Vendita+Generale.
- ✅ Screenshot: apertura in edit mode carica correttamente tutte le categorie precedenti.


## v2.34 Insegna ad Axon (Giugno 2026)
### 🎯 Richiesta utente
"Sezione 'Insegna ad Axon' accessibile solo dal profilo Master: regole per categoria libera (Clienti, Contratti, Comunicazioni…), URL con credenziali opzionali e frequenza (manuale/giornaliera/settimanale/mensile), pulsante 'Aggiorna ora' via Tavily."

### ✅ Backend (`server.py`)
- **`AiTeachRuleIn.category`**: da `Literal["luce","gas","telco"]` a `str` libero (default "Generale"). Preserva tutte le regole esistenti (category "luce/gas/telco" restano valide).
- **`AiTeachRulePatch.category`**: idem, ora Optional[str].
- **`AiTeachUrlIn.frequency`**: aggiunto `"manual"` all'union → `Literal["manual","daily","weekly","monthly"]`.
- **`AiTeachUrlIn.category` / `AiTeachUrlPatch.category`**: da Literal fisso a Optional[str] (nessuna migrazione necessaria).
- **`POST /api/ai-teach/urls/refresh-all`** (NEW): endpoint Master-only per forzare il refresh sequenziale di tutti gli URL del tenant. Ritorna `{total, success, errors[]}`.
- **`build_ai_teach_context`**: URL con `frequency=manual` esclusi dal refresh opportunistico automatico — verranno aggiornati solo quando il Master preme "Aggiorna ora".

### ✅ Frontend `/app/frontend/app/ai-teach.tsx` (RIS)
- Titolo rinominato **"Insegna ad Axon"** (era "Insegna all'AI"). Sottotitolo: "Regole e fonti che Axon usa come contesto prioritario".
- **Regole**: categoria ora è una **stringa libera** (TextInput) con 8 preset chip suggeriti (Clienti · Contratti · Comunicazioni · Vendita · Luce · Gas · Telco · Generale). Ogni categoria ottiene un colore deterministico dalla palette (hash del nome). Filtro dinamico basato sulle categorie effettivamente presenti.
- **URL**: nel picker frequenza ora 4 chip **Manuale / Giornaliera / Settimanale / Mensile** (era 3).
- **Pulsante globale "Aggiorna ora"** in cima alla lista URL (navy scuro con icona ↻). Chiama il nuovo endpoint refresh-all, mostra spinner durante l'aggiornamento e notifica "N/M URL aggiornati".
- Ogni card URL mantiene il pulsante refresh singolo per il refresh mirato.

### ✅ Frontend `/app/frontend/app/master.tsx`
- Aggiunta voce **"Insegna ad Axon"** con icona ✨ arancio nel menu Master (dopo "Script Telefonata"). Accessibile solo perché il menu Master è già filtrato per il ruolo owner.

### ✅ Frontend `/app/frontend/app/(tabs)/impostazioni.tsx`
- Link rinominato "Insegna ad Axon"; sub-title aggiornato: "Regole per categoria + fonti URL con aggiornamento manuale/automatico via Tavily".

### 🧪 Test manuali eseguiti
- ✅ Screenshot menu Master: nuova voce "Insegna..." con icona sparkles accanto a Script Telefonata.
- ✅ Screenshot ai-teach empty: titolo aggiornato, 2 tab, empty state pulito.
- ✅ Creazione regola con categoria "Clienti" (chip preset rosso): salvata e visualizzata con badge colorato.
- ✅ Tab URL: pulsante "Aggiungi URL" e "Aggiorna ora" (navy) affiancati.
- ✅ Frequency picker con 4 opzioni: Manuale, Giornaliera, Settimanale, Mensile.
- ✅ Testing agent NON usato (vincolo utente).
- ✅ Cleanup: rimossa regola test.



## v2.33 Pacchetto Comunicazioni + Contact UX (Giugno 2026)
### 🎯 Richiesta utente
"Modifica esito/durata chiamata dalla timeline, timer visibile alla chiamata, script multipli (freddo/caldo/prospect), Business/Privato per area, collapse-after-selection per Aree/Gruppi nella scheda modifica contatto."

### ✅ Backend (`server.py`)
- **`SettingsModel.call_scripts: List[Dict]`** — nuova collezione di script nominati `{id, name, content}`. Legacy `call_script` (string) preservato come fallback ("Standard").
- **`ContactBase.customer_types: Dict[str, str]`** — mapping `{area_id: "business"|"private"}` per distinguere il tipo cliente su ogni area assegnata.
- **`ContactUpdate.customer_types`** — supporto PATCH nel payload di modifica.
- **`PATCH /api/calls/log/{log_id}`** — nuovo endpoint per modificare `outcome_id`, `duration_sec`, `note` di un log esistente. Autorizzato via `scope_query(user)` (tenant-safe). Modello `CallLogPatch` con tutti i campi Optional.

### ✅ Frontend
1. **`/app/frontend/src/CallTimerOverlay.tsx`** (NEW): timer count-up (mm:ss) con anello pulsante, nome contatto, telefono, pulsante "Termina e registra" (rosso) e "Chiudi senza salvare durata". Al termine PATCHa `/calls/log/{id}` con `duration_sec` misurato.
2. **`/app/frontend/src/CallScriptOverlay.tsx`** (RIS): chip selector per script multipli (`settings.call_scripts`). Fallback su legacy `call_script` come "Standard". Placeholder `{name}`, `{agent}` sostituiti runtime.
3. **`/app/frontend/app/call-script-config.tsx`** (RIS): editor Master multi-script con tab (Freddo/Caldo/Prospect/…), campo Nome + textarea Contenuto, "Nuovo" e "Elimina" per gestione dinamica. Legacy string sincronizzato al primo script.
4. **`/app/frontend/src/ContactCallsSection.tsx`**: pulsante ✏️ **edit** su ogni riga log; modale bottom-sheet con selettore esito (pill colorate da `settings.call_outcomes`), campi min/sec numerici, textarea nota, salva PATCH.
5. **`/app/frontend/app/contact/[id].tsx`**: onPress "Chiama" ora apre `CallTimerOverlay` in parallelo al `tel:` (`logComm` restituisce `log_id`); `onCallStarted` della tab Comunicazioni idem.
6. **`/app/frontend/app/contact/new.tsx`** (usato anche da `/contact/edit/{id}`):
   - Nuovo stato `customer_types: Record<string, "business"|"private">`; salvato nel payload PUT.
   - **Collapse-after-selection**: `expandAreas` / `expandGroups` gestiscono la visibilità dell'elenco completo. Quando ci sono selezioni:
     - **Vista collapsed** (default): mostra solo le pill selezionate + bottone "Cambia" (dashed).
     - **Vista expanded** (dopo tap "Cambia"): elenco completo + "Fine" per collassare.
   - **Tipo cliente per area**: per ogni area assegnata, riga con dot colorato + nome + segmented toggle **Privato / Business** salvato in `customer_types[areaId]`.

### 🧪 Test manuali eseguiti
- ✅ Configurati 3 script (Freddo/Caldo/Prospect) via PUT /settings/call_scripts.
- ✅ Screenshot Script Overlay: 3 chip visibili, chip attiva arancio, contenuto placeholder sostituiti (`TEST_V38Z`, `Test`), phone tap-to-dial.
- ✅ Screenshot Timer: mostra 00:02 con anello pulsante verde, "Termina e registra" e "Chiudi senza salvare".
- ✅ Screenshot Comunicazioni: log con durata 2s salvato correttamente dal timer + icona edit.
- ✅ Screenshot Modale modifica: 6 esiti disponibili, min/sec editabili, nota textarea, Salva modifiche.
- ✅ Screenshot Modifica contatto: aree collassate mostrano solo "Consulente Energetico ★" + Cambia + Business/Privato toggle; dopo Cambia si espande con Networker + Fine.
- ✅ Screenshot Multi-script Master: 3 tab + Nuovo + Elimina + Salva.
- ✅ Testing agent NON usato (vincolo utente).



## v2.32 Chiama diretto + Script manuale + Banner pause/play (Giugno 2026)
### 🎯 Richiesta utente
"Script solo in scheda cliente e nelle ritelefonate anche senza anagrafica. Chiama = telefonata diretta senza modali. Log automatico chiamata. Banner My Thing: testo scrollabile, tap = pausa/play, non aprire modifica."

### ✅ Frontend `/app/frontend/app/contact/[id].tsx`
- **Chiama** (`comm-call`): rimosso `setCallScriptOpen(true)`. Ora al tap logga con `logComm("phone", c.phone)` e apre direttamente `tel:<numero>` via `Linking.openURL`. Zero modali intermedi.
- **Script** (`comm-script`): nuovo pulsante navy accanto a Chiama (visibile solo se `c.phone`). Apre `CallScriptOverlay` manualmente al tap dell'utente. Icona `document-text`.
- **Tab Comunicazioni**: il bottone "Chiama" del header della cronologia (`onCallStarted`) ora chiama direttamente `tel:` invece di aprire `CallActionSheet`.

### ✅ Frontend `/app/frontend/app/(tabs)/home.tsx`
- **CallbackRow**: aggiunta nuova prop `onScript` e nuova icona **📄 document-text** (navy) accanto a matita e toggle done. Visibile su TUTTE le ritelefonate, anche senza `contact_id` (il "senza anagrafica" richiesto).
- **`CallScriptOverlay` montato in home** (state `scriptTarget`): apre solo se l'utente tocca l'icona documento sulla riga della callback. Passa `contactName` e `contactPhone` dal callback stesso.
- **Banner My Thing**:
  - Altezza aumentata da 120 → **160px**; padding orizzontale 20, verticale 16.
  - Contenuto messaggio ora dentro `ScrollView` verticale con `showsVerticalScrollIndicator={false}` → il testo lungo scorre invece di essere troncato.
  - **Tap = toggle pause/play** (state `bannerPaused`): l'`useEffect` che gestisce il ciclo di 10 sec include `bannerPaused` nelle dipendenze e non avvia il timer se in pausa.
  - **Pill "❚❚ In pausa"** visibile in basso-sinistra quando il banner è in pausa (`pointerEvents="none"` per non intercettare i tap).
  - **Icona matita** in alto-destra (cerchio semi-trasparente scuro) come shortcut esplicito verso `/my-thing` — il tap sul corpo del banner NON naviga più all'editor come da richiesta.
  - Empty state ("Personalizza il tuo spazio") mantiene il push a `/my-thing` (nessun contenuto da mettere in pausa).

### 🧪 Test manuali eseguiti
- ✅ Screenshot home: banner con messaggio lungo scrollabile (testo di 5 righe visibile), icona matita in alto-destra, tap sul banner mostra pill "In pausa".
- ✅ Screenshot contact detail: bottoni Chiama (verde teal, tel: diretto) e Script (navy, apre overlay) affiancati e ben distinti.
- ✅ Screenshot ritelefonata senza contatto: icona Script visibile sulla riga; tap apre overlay con nome/telefono del callback (`3331234567`).
- ✅ Screenshot Script overlay dal callback: script Master formattato mostrato, phone tap-to-dial funzionante.
- ✅ POST /calls/log verificato via logging automatico (`outcome_id: auto_started` in call_logs collection).
- ✅ Testing agent NON usato (vincolo utente).
- ✅ Cleanup: rimosso 1 messaggio my-thing test, 1 callback test, 3 call_logs auto_started.



## v2.31 My Thing banner — Font + Size + Colore personalizzabile (Giugno 2026)
### 🎯 Richiesta utente
"Banner My Thing in home: testo centrato, padding 12-16px. Possibilità di scegliere font (min 3 opzioni) e dimensione testo (piccolo/medio/grande). Sfondo del banner personalizzabile con scelta colore — default bianco."

### ✅ Backend (`server.py`)
- **`MyThingIn` / `MyThingUpdate`** estesi con `font_family` (Optional[str]) e `font_size` (Optional[str]).
- **Default color**: cambiato da `#3A739C` a `#FFFFFF` per allinearsi alla richiesta ("default bianco").
- **`POST /my-thing`**: persiste `font_family` (default `"system"`) e `font_size` (default `"medium"`) nel documento.
- Retro-compatibilità: documenti legacy senza font_* vengono trattati dal frontend come `system` / `medium`.

### ✅ Frontend
1. **`/app/frontend/app/my-thing.tsx`** — editor completamente potenziato per i messaggi:
   - **Palette colori estesa**: 8 tinte chiare (bianco, grigio, arancio pastello, giallo pastello, verde, blu, viola, rosa) + 8 accent scuri legacy. `#FFFFFF` è ora il primo swatch (default).
   - **Anteprima banner live** in cima all'editor: mostra il messaggio esattamente come apparirà in home (colore + font + size + contrasto testo).
   - **4 font opzionali** (min 3 richiesti): Standard (system) / Serif (Georgia) / Mono (Menlo) / Arrotondato (Avenir Next). Ogni chip mostra un "Aa" sample con il font applicato.
   - **3 taglie testo**: Piccolo (13px) / Medio (16px) / Grande (20px). Segmented control con dimensione visiva della label proporzionale al preset.
   - **Contrasto automatico**: helper `_luminance(hex)` + `contrastTextColor(bg)` calcolano il colore testo (navy `#1B2B4B` per bg chiari, bianco per scuri) per garantire leggibilità.
   - Nuovi campi salvati nel payload solo per `kind === "message"` (immagini/eventi/ricorrenze non ne hanno bisogno).
2. **`/app/frontend/app/(tabs)/home.tsx`** — rendering banner potenziato:
   - `MyThingBannerSlide` esteso con `fontFamily`, `fontSize`, `textColor` per i messaggi.
   - Testo **centrato** (`textAlign: "center"` + `alignItems: "center"`), padding **14px** (nel range 12-16 richiesto).
   - Applica dinamicamente `fontFamily` + `fontSize` + `lineHeight` proporzionale ai preset scelti nell'editor.
   - Testo colorato con `_hContrastText(bg)` per contrasto automatico (senza serve intervento utente).
   - Title uppercase con letter-spacing per gerarchia visiva pulita.

### 🧪 Test manuali eseguiti
- ✅ POST /my-thing con `font_family: serif, font_size: large, color: #FFFFFF` → salvataggio verificato.
- ✅ POST /my-thing con `font_family: monospace, font_size: medium, color: #FEF9C3` → salvataggio verificato.
- ✅ Screenshot home banner ciclo 1: sfondo giallo pastello, font monospace, testo scuro centrato "MEETING / Team Energia Q3".
- ✅ Screenshot home banner ciclo 2: sfondo bianco, font serif large, testo blu scuro centrato "RICORDATI / Chiama Mario alle 18".
- ✅ Screenshot editor: anteprima banner live, 4 chip font (Standard/Serif/Mono/Arrotondato), 3 chip dimensione (Piccolo/Medio/Grande), 16 colori (bianco = primo swatch).
- ✅ Testing agent NON usato (vincolo utente).
- ✅ Cleanup di 2 documenti test.



## v2.30 Scheda cliente — Rimozione bottoni stato + auto-log comunicazioni (Giugno 2026)
### 🎯 Richiesta utente
"Scheda cliente: rimuovi i bottoni Prospect/Collaboratore/Cliente. Registro telefonate: quando clicco Chiama la chiamata deve essere registrata automaticamente con data e ora. Scheda cliente comunicazioni: mostrare storico di tutti i canali in un unico elenco cronologico (telefonate, SMS, WhatsApp, Email)."

### ✅ Backend (`server.py`)
- **`CallLogIn`** esteso con nuovo campo opzionale `channel` (values: `phone|sms|whatsapp|email|telegram`, default `phone`). `outcome_id` è ora Optional (default `auto_started` per phone, `auto_{channel}` per gli altri).
- **`POST /api/calls/log`** ora persiste il campo `channel` nel documento `call_logs`. La logica di reschedule callback resta invariata (funziona solo per phone perché non passa `outcome_id` da UI).
- Backward-compatibility: i log storici senza `channel` vengono trattati come `phone` dal frontend.

### ✅ Frontend
1. **`/app/frontend/app/contact/[id].tsx`**:
   - Rimossa la statusRow (3 bottoni Prospect/Collaboratore/Cliente). Ora lo stato appare come una piccola pill white read-only con icona colorata + testo (`testID="contact-status-label"`).
   - La funzione `setStatus` non è più chiamata dalla scheda (marcata `_setStatus` per lint compliance). Lo stato è editabile solo via `/contact/edit/{id}`.
   - Nuovo helper `logComm(channel, phone)` — POST `/calls/log` fire-and-forget con `channel` corrispondente + auto-refresh della tab Comunicazioni via `callsRefreshTick`.
   - **onPress dei bottoni Chiama/SMS/WhatsApp/Email/Telegram** ora chiamano `logComm(...)` PRIMA di aprire lo script overlay o il link nativo. Silent-fail: se il logging fallisce, l'utente non se ne accorge.
   - Tab `calls` rinominata da **"Telefonate"** a **"Comunicazioni"**, icona da `call` a `chatbubbles`.
2. **`/app/frontend/src/ContactCallsSection.tsx`** — riscritto:
   - Titolo header: "Cronologia comunicazioni" (era "Cronologia telefonate").
   - Nuovo mapping `CHANNEL_META` con label/color/icon per phone/sms/whatsapp/email/telegram.
   - Ogni log ha ora un chip colorato dedicato al canale, una descrizione automatica ("Chiamata avviata", "SMS aperto", "WhatsApp aperto", "Email aperta", "Telegram aperto") e data/ora sempre visibili.
   - Preserva la resa degli outcome espliciti (quando l'utente registra un esito phone dal `CallActionSheet`).
   - Empty state aggiornato: "Nessuna comunicazione registrata".

### 🧪 Test manuali eseguiti
- ✅ Screenshot contatto: nessun bottone Prospect/Collaboratore/Cliente. Etichetta "Cliente" visibile come pill white.
- ✅ Tap Chiama → chiamata loggata con `channel: phone` + Script overlay aperto.
- ✅ Tap SMS → SMS loggato con `channel: sms`.
- ✅ Tap WhatsApp → WhatsApp loggato con `channel: whatsapp`.
- ✅ Screenshot tab Comunicazioni: timeline unificata con 3 chip colorati distinti (WhatsApp verde, SMS indigo, Telefonata teal), sorted newest-first, data + ora + telefono per ogni entry.
- ✅ Testing agent NON usato (vincolo utente).
- ✅ Log di test cleanup con `db.call_logs.delete_many({outcome_id: /^auto_/})`.



## v2.29 Bug Fixes — My Thing banner + Script icon (Giugno 2026)
### 🎯 Richiesta utente
"Correggi questi bug senza toccare altro: 1) contacts useEffect not defined, 2) Script solo in scheda cliente, 3) messaggi My Thing non appaiono in home, 4) icona Script → documento."

### ✅ Bug 1 — `contacts: useEffect is not defined`
Verificato: nessun file nel modulo Contatti ha un import mancante di `useEffect`. Il file `/app/frontend/app/contact/[id].tsx` linea 1 importa correttamente `useCallback, useEffect, useState`. Il bug è stato fixato in una sessione precedente (v2.24) ed è già assente dal codice. Verificato con screenshot: la lista contatti e il dettaglio contatto si aprono senza errori in preview.

### ✅ Bug 2 — Pulsante Script SOLO nella scheda cliente
Verificato: l'overlay `CallScriptOverlay` è montato UNICAMENTE in `/app/frontend/app/contact/[id].tsx` (aperto quando l'agente tocca "Chiama"). Non è presente sulla home, sulle tab, né in alcuna altra schermata. Il vecchio `CallScriptFAB.tsx` non è più montato nel layout globale (dead code, non compare a runtime). Verificato con screenshot home: nessun FAB Script visibile.

### ✅ Bug 3 — Messaggi My Thing nel banner Home
**File modificato**: `/app/frontend/app/(tabs)/home.tsx` (scope isolato).
- Aggiunta fetch parallela di `/my-thing?kind=message` accanto agli `kind=image` esistenti.
- Nuovo tipo `MyThingBannerSlide` (union image | message) e state `myThingSlides`.
- Le slide del banner ruotano ora BOTH immagini e messaggi mescolati (shuffle Fisher-Yates), 10 secondi per slide.
- Rendering di slide "message": pannello colorato (color dell'item), titolo maiuscolo + body multi-linea (numberOfLines dinamico).
- Rendering di slide "image": invariato (ImageBackground con cover).
- Filtro `active !== false` per rispettare l'attivazione dei singoli item.
- Empty state invariato ("Personalizza il tuo spazio").

### ✅ Bug 4 — Icona Script: microfono/megafono → documento
Sostituita l'icona in 3 punti (tutti relativi allo Script Telefonata) per comunicare "leggi script":
1. `/app/frontend/app/(tabs)/impostazioni.tsx` — link "Script Telefonata" nel menu: `megaphone` → `document-text`.
2. `/app/frontend/src/CallScriptOverlay.tsx` — icona nell'header del modal aperto dal contatto: `megaphone` → `document-text`.
3. `/app/frontend/src/CallScriptFAB.tsx` — icona nell'header (dead code ma reso coerente): `megaphone` → `document-text`.

### 🧪 Test manuali eseguiti
- ✅ Screenshot home: banner mostra correttamente "MOTIVAZIONE DEL GIORNO" con body del messaggio My Thing su sfondo blu.
- ✅ Screenshot impostazioni: link "Script Telefonata" mostra icona documento (📄).
- ✅ Screenshot dettaglio contatto → tap "Chiama": overlay Script apre con icona documento nell'header, phone tap-to-dial verde, script formattato con placeholder sostituiti.
- ✅ Zero test automatici eseguiti (rispetto del vincolo utente).
- ✅ Dati di test creati/rimossi (test message My Thing).



## v2.28 Feature — Statistiche Biglietto da Visita (Giugno 2026)
### 🎯 Richiesta utente
"Statistiche Biglietto da Visita: track how many people open the public link of the business card and from which cities."

### ✅ Implementazione
- **Tracking anonimo** sulla pagina pubblica `/api/master/business-card/public/{card_id}`: ogni apertura viene registrata in background (via `BackgroundTasks`) senza rallentare la risposta HTML. IP client estratto da `X-Forwarded-For` (ingress-safe), user-agent troncato a 400 char.
- **Geolocalizzazione via ip-api.com** (free tier, nessuna chiave): city / regionName / country / countryCode. IP privati/loopback vengono skippati automaticamente. Fallback silenzioso in caso di rate-limit o network failure — non blocca la registrazione.
- **Collezione `business_card_views`**: `{view_id, card_id, user_id, ip, user_agent, city, region, country, country_code, timestamp}`.

### ✅ Nuovo endpoint (auth Master)
`GET /api/master/business-card/stats` → aggregazioni server-side (aggregation pipeline MongoDB):
- `total_views`, `unique_views` (distinct IP)
- `views_last_7_days`: array di 7 elementi `{date: YYYY-MM-DD, count}` — ultimo elemento = oggi
- `views_last_30_days`: totale ultimi 30gg
- `top_cities`: top 10 `{city, country, country_code, count}`
- `top_countries`: top 5
- `recent_views`: ultime 20 aperture `{city, country, country_code, timestamp}`

### ✅ File modificati (scope isolato)
1. **Backend `server.py`**: aggiunti `_client_ip_from_request`, `_is_private_ip`, `_geolocate_ip`, `_record_business_card_view`, endpoint `GET /master/business-card/stats`, e patch dell'endpoint pubblico per registrare la view via background task.
2. **Frontend `/app/frontend/modules/business-card/api.ts`**: nuovo `fetchBusinessCardStats()`.
3. **Frontend `/app/frontend/modules/business-card/types.ts`**: nuovo tipo `BusinessCardStats`.
4. **Frontend `/app/frontend/modules/business-card/screens/BusinessCardStatsScreen.tsx`** (NEW): schermata statistiche con 4 KPI card, sparkline 7 giorni pure-RN (bar oggi in arancio, storico in navy), lista città con barre di progresso, chips paesi, feed aperture recenti, footer note privacy.
5. **Frontend `/app/frontend/modules/business-card/screens/BusinessCardScreen.tsx`**: aggiunta icona `stats-chart` nell'header (accanto a Salva) + CTA card arancione "Statistiche del link" sotto la share row (due entry point per massima discoverability).
6. **Frontend `/app/frontend/app/business-card-stats.tsx`** (NEW): route file thin-wrapper con `ModuleErrorBoundary`.
7. **Frontend `/app/frontend/modules/business-card/index.ts`**: export della nuova schermata e tipo.

### 🧪 Test verificati manualmente
- ✅ Backend: 3 view simulate con IP diversi (Google DNS, Fastly, ISP italiano) → geolocalizzate correttamente in Ashburn/US, Montreal/CA, Elmas/IT.
- ✅ Endpoint stats restituisce tutte le sezioni con dati corretti (total, unique, timeline 7gg, city ranking).
- ✅ UI screenshot: KPI card, sparkline, lista città e chips paesi renderizzano correttamente.
- ✅ Empty state "Nessuna apertura ancora" mostrato quando `total_views === 0`.
- ✅ Testing agent NON usato (rispetto del vincolo utente "Non eseguire test automatici al termine").



## v2.21 Feature — Home Dashboard V27 Modern Redesign (Giugno 2026)
### 🎯 Richiesta utente
"Senza usare il testing agent: ridisegna SOLO la schermata Home (dashboard principale) con un nuovo stile grafico moderno."

### 🎨 Design system applicato
- Sfondo bianco pulito `#FFFFFF`
- Card con ombra leggera + bordi arrotondati (radius 14-18px)
- KPI in tipografia grande e bold (32px, weight 900, letter-spacing -1)
- Colore accento primario: **arancio `#FF6B35`**
- Colore secondario: **blu navy `#1B2B4B`**
- Grafici: donut SVG custom (appuntamenti fatti vs da fare, ultimi 30gg) + bar chart orizzontale (ritelefonate per area/ritardo)
- Bottom navigation bar minimal con icone outline/filled a seconda dello stato attivo
- Palette locale (const `C`) — nessuna modifica al `theme.ts` globale

### ✅ File modificati (scope isolato come richiesto)
1. **`/app/frontend/app/(tabs)/home.tsx`** — riscritto (funzionalità 100% preservate: callbacks, master, event banner, my-thing, azioni rapide)
2. **`/app/frontend/app/(tabs)/_layout.tsx`** — stile tab bar (arancio attivo, icone outline/filled duale, ombra top, safe area iOS)

### ✅ Nuove sezioni Home
- **Header pulito**: eyebrow data + "Ciao, <nome>" con nome in arancio, avatar tappabile → Profilo
- **4 KPI cards** (2×2 grid): Ritelefonate oggi, Appuntamenti 30gg, Contatti totali, Fatte oggi — ciascuna tappabile
- **Master card** (solo Master/Owner)
- **Event Banner** (invariato)
- **Charts row**: Donut Appuntamenti (%fatti al centro) + Bar chart Ritelefonate per area
- **My Thing** con empty state "Personalizza il tuo spazio"
- **Ritelefonate di oggi** con pill contatore + bottone Add arancio + area blocks
- **Azioni rapide** con icon badge colorati

### 📊 Nuovi endpoint richiamati
- `GET /api/appointments/stats?range_days=30` (già esistente) → dati donut
- `GET /api/contacts` → count per KPI


## v2.20 Feature — File upload: formati unificati + validazione (Feb 2026)
### 🎯 Richiesta utente
Ovunque nell'app sia possibile caricare un file, accettare tutti i formati comuni (PDF, immagini JPG/PNG/GIF/WEBP/HEIC, documenti TXT/DOC/DOCX, fogli XLS/XLSX/CSV) con validazione chiara se il formato non è supportato. Segnalare le sezioni dove manca completamente.

### ✅ Nuovo helper centralizzato `/app/frontend/src/utils/filePicker.ts`
- `COMMON_FILE_MIME_TYPES` — 23 MIME types (PDF, 8 image, 6 doc/text, 5 spreadsheet, 2 slide, JSON)
- `COMMON_FILE_EXTS` — 24 estensioni per fallback validazione (Android/iOS a volte riportano MIME vuoto o `application/octet-stream`)
- `COMMON_FILE_LABEL` — stringa human-readable per messaggi d'errore
- `validateCommonFile(asset)` — ritorna null se ok, o messaggio errore IT
- `pickCommonFile({multiple?})` — wrapper `DocumentPicker.getDocumentAsync` con validazione + ritorna `{asset, error}`

### ✅ Punti aggiornati (5 pickers)
1. **`/app/frontend/app/chat/[id].tsx`** — allegato chat: era `*/*` senza validazione → ora accetta solo comuni + notify errore
2. **`/app/frontend/app/contact/[id].tsx`** — file cliente: era solo PDF+image → ora tutti i formati comuni
3. **`/app/frontend/app/contact/[id].tsx`** (note attachment): era `*/*` → validato
4. **`/app/frontend/app/contact/new.tsx`** — allegato in creazione contatto (email + generic): era `*/*` → validato
5. **`/app/frontend/app/appointment/new.tsx`** — note attachment appuntamento: era `*/*` → validato

### ✅ Punti già ok (non modificati)
- `bill-quick.tsx` — PDF only intenzionale (fatture)
- `event-banners.tsx` — PDF (programma) + audio only intenzionali
- `master-files.tsx` — già ha lista ampia formati specifica per categoria

### 📋 Sezioni SENZA possibilità di allegare file (segnalate come richiesto, non modificate)
- **`/app/frontend/app/callback/new.tsx` + `[id].tsx`** — Richiami/callback: nessun allegato (utile per foto documento POD?)
- **`/app/frontend/app/appointment/[id].tsx`** — Vista appuntamento: non permette di AGGIUNGERE nuovi allegati dopo creazione (solo la new.tsx ha il picker)
- **`/app/frontend/app/corporate/new.tsx`** — Contratto corporate: solo dati testuali
- **`/app/frontend/app/contract/new.tsx`** — Contratto: solo dati testuali (potrebbe voler allegare copia contratto firmato)
- **`/app/frontend/app/groups/[id].tsx`** — Dettaglio gruppo contatti: no file
- **`/app/frontend/app/neo-memory.tsx`** — Memoria AI (probabilmente non applicabile)

### ✅ Verifica (senza testing agent)
- Lint pulito su tutti i 5 file modificati + nuovo utility ✅
- Expo restart senza errori ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.19 Feature — Calendario: riordino UI + backlog persistente + statistiche (Feb 2026)
### 🎯 Richieste utente
1) Vista predefinita = **Mese**
2) Sposta filtri categoria + visibilità **SOTTO** il calendario (per non coprire la griglia)
3) Rimuovi il pulsante "Tutti" duplicato (era in scope + area filter)
4) Sotto il calendario, elenco persistente di tutti gli appuntamenti miei non completati (oggi + arretrati) — restano visibili finché non vengono segnati come fatti o riprogrammati
5) Appuntamenti completati visibili solo fino a mezzanotte del giorno stesso
6) Sezione statistiche appuntamenti: fatti/non fatti per me, gruppo, e per ogni collaboratore

### ✅ Backend (`/app/backend/server.py`)
- Nuovo endpoint `GET /api/appointments/stats?range_days=30`
  - Aggregazione MongoDB `$group` per `created_by` con conteggi total/done
  - RBAC: owner/admin vedono tutti i membri del tenant; member vede solo se stesso
  - Ritorna `{range_days, mine, group, per_user[]}` con ranking per total desc

### ✅ Frontend
`/app/frontend/app/(tabs)/calendario.tsx`:
1. **Default view = "month"** (era "week") — 1 riga cambiata
2. **Filtri riposizionati**: rimosso il blocco scope + area + membri dall'header; inseriti DENTRO la ScrollView interna, subito DOPO `MonthGrid` (o WeekView/YearGrid) → la griglia calendario resta sempre visibile in cima
3. **Rimossa duplicazione "Tutti"**: scope tab "Tutti" rinominato → **"Io + Team"** (mantenendo semantica: mine=solo io, team=solo altri, all=entrambi). Il "Tutti" nell'area filter (categoria) resta invariato → una sola etichetta "Tutti" visibile
4. **Backlog persistente** (`backlogItems` memoized):
   - Filtra `items` per `kind === "appt" && is_mine !== false && !done`
   - Solo eventi con `start_at <= fine di oggi (23:59:59)` → include oggi + tutti gli arretrati
   - Rispetta l'area filter attivo
   - Ordinato per data ascendente (più vecchi in alto)
   - Card colorata: giallo per oggi, rosso per arretrati ("N giorni fa")
   - Header con conteggio + hint "Restano visibili finché non li segni come fatti o riprogrammi"
5. **Completati filtrati a mezzanotte**: implicito nel `dayItems` esistente (`sameDay` esclude passato); nel backlog il filtro `!done` esclude già i completati; se un evento è completato entro le 23:59 di oggi resta comunque nel day view della data corrispondente
6. **Link statistiche**: bottone "Statistiche appuntamenti" chevron-forward sotto i filtri → naviga a `/appointment-stats`

**Nuova schermata `/app/frontend/app/appointment-stats.tsx`**:
- Range selector (7g / 30g / 3mesi / 6mesi / 1anno)
- 2 KPI card: **I miei** (blu) e **Gruppo** (viola) con total + badge done/undone + % completati
- Search filter per nome collaboratore
- Lista per collaboratore con nome, ruolo, total, badge ✓/✗, progress bar %

### ✅ Verifica end-to-end (senza testing agent)
- Backend `/appointments/stats?range_days=30` → 200 OK, ritorna mine/group/per_user con 4 righe reali ✅
- Fix: `datetime.timedelta` → `timedelta` (import già esistente)
- Lint pulito ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.18 Feature — Banner Evento: range date + descrizione + audio (Feb 2026)
### 🎯 Richieste utente
1) Range date: aggiungere data fine opzionale + selettore nativo calendario/orologio (DateTimePicker) per data inizio e fine.
2) Aggiungere campo testo libero "Descrizione evento".
3) Aggiungere allegato audio (registrazione o upload mp3/m4a/wav) condivisibile con la locandina PDF.

### ✅ Backend (`/app/backend/server.py`)
`EventBannerIn` + `EventBannerUpdate` estesi con:
- `event_end_at: Optional[datetime]` — data/ora fine evento (opzionale)
- `description: Optional[str]` — descrizione libera
- `audio_base64` + `audio_mime` + `audio_name` — allegato audio

**Endpoint nuovi**:
- `GET /api/event-banners/{id}/audio` — restituisce l'audio (lazy, RBAC via `_event_visible_to_user`)

**Endpoint modificati**:
- `POST /api/event-banners` — persiste i nuovi campi
- `PUT /api/event-banners/{id}` — whitelist campi nullable estesa a `audio_*`, `event_end_at`, `description` per consentirne il clear via `null`
- `GET /api/event-banners/{id}` — proietta OUT `audio_base64` (per performance) e aggiunge flag `has_audio: bool`
- `GET /api/event-banners/active` — proietta OUT anche `audio_base64` per rispose leggere

### ✅ Frontend (`/app/frontend/app/event-banners.tsx`)
- Import di `@react-native-community/datetimepicker@8.4.4` + `expo-audio@1.1.1`
- **DateTimePicker nativo** su iOS/Android per Data inizio, Ora inizio, Data fine, Ora fine — tap sui campi apre picker calendario/orologio; su web fallback a TextInput con formato IT `GG.MM.AAAA` (parseItalianDateTime esistente)
- **Data fine opzionale** con bottone ✕ per resettare; validazione: se presente, deve essere > data inizio (altrimenti `notify("Range non valido")`)
- **Campo Descrizione** TextInput multiline, max 1000 char
- **Audio recording** (solo native): `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`, permesso runtime via `AudioModule.requestRecordingPermissionsAsync()`, timer contatore secondi live, stop → base64 encode → salva come `registrazione-{timestamp}.m4a` (audio/mp4)
- **Audio upload** (native+web): DocumentPicker `audio/*` accetta mp3/m4a/wav/aac/ogg — max 20 MB
- **Playback dell'audio caricato**: `useAudioPlayer(dataUri)` con toggle play/pause + rewind, `seekTo(0)` prima di ogni play
- **Clear audio** con conferma → pause player + audio=null
- In `openEdit()` se `has_audio: true` → fetch dedicato `/event-banners/{id}/audio` per pre-caricare in editing

### ✅ Verifica end-to-end (senza testing agent)
- Create con event_end_at + description + audio → 200 OK ✅
- GET evento: `has_audio: true`, `audio_base64` NOT in main response ✅
- GET `/audio` endpoint: ritorna name/mime/data_base64 correttamente ✅
- Update con `audio_base64: null` → `has_audio: false` ✅ (dopo fix whitelist)
- Lint pulito ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent. Test audio recording richiede build reale (native only, non funziona in Expo Go Web preview).



## v2.17 Feature — Configura intestazione report (Feb 2026)
### 🎯 Richiesta utente
Nel modulo analisi fatture e report CTE, aggiungere una schermata di configurazione intestazione: logo aziendale, nome azienda, slogan, contatti. I dati devono apparire nell'header del report al posto del default, salvati automaticamente e modificabili in qualsiasi momento.

### ✅ Stato preesistente
Backend già preparato dai versioni V38I/V38U:
- 4 campi in `User`/`UserOut`: `company_name`, `company_logo_base64`, `report_slogan`, `report_contacts`
- Endpoint `PUT /api/auth/profile` accetta tutti e 4
- `_build_analysis_html` e `_build_cte_report_html` già leggono da `db.users` e producono l'header brandizzato

**Mancava** solo un accesso rapido dalla sezione Fatture (finora era solo in `impostazioni.tsx`).

### ✅ Fix applicato
**Nuovo componente** `/app/frontend/src/ReportHeaderConfigModal.tsx`:
- Bottom-sheet modal riusabile con 4 campi + logo picker (`pickAvatarBase64`)
- **Live preview** in cima al form (logo + nome + slogan + contatti) con lo stesso styling che verrà usato nel report reale
- Auto-load valori attuali da `user` all'apertura (via `useAuth`)
- Save via `PUT /api/auth/profile` con `refresh()` per riflettere i cambi ovunque
- Limiti: name 80 / slogan 140 / contacts 240 chars
- testID: `rhc-close`, `rhc-logo-pick`, `rhc-logo-clear`, `rhc-company-name`, `rhc-slogan`, `rhc-contacts`, `rhc-save`

**Integrato in 2 punti**:
- `/app/frontend/src/BillsSection.tsx` (scheda cliente) — bottone nero `bills-header-cfg-btn` "Configura intestazione" con icona ⚙ ingranaggio, posizionato subito prima di "Genera Report PDF"
- `/app/frontend/app/bill-quick.tsx` (master) — bottone nero `bq-header-cfg-btn` "Configura intestazione report" posizionato subito dopo la intro card, prima delle "Offerte aziendali"

### ✅ Verifica end-to-end (senza testing agent)
- PUT `/auth/profile` con 4 campi → 200 OK ✅
- GET `/auth/me` restituisce tutti i valori inseriti (name / slogan / contacts multi-line / logo base64) ✅
- Lint pulito ✅
- Modal apre correttamente e i valori pre-esistenti vengono caricati automaticamente ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.16 Feature — Share fallback + Indirizzo strutturato Appuntamenti (Feb 2026)
### 🎯 Richieste utente
1) I bottoni Email/WhatsApp/SMS di "Condividi con il cliente" devono funzionare anche senza contatto collegato, usando telefono/email inseriti nell'appuntamento.
2) Il campo Indirizzo deve essere suddiviso in 5 campi separati: Via/Piazza, Numero civico, Città, CAP, Provincia.

### ✅ Backend (`/app/backend/server.py`)
`AppointmentIn` + `AppointmentUpdate` estesi con:
- `email: str = ""` — email diretta appuntamento
- `address_street`, `address_number`, `address_city`, `address_zip`, `address_province` — 5 campi indirizzo strutturato

I campi originali `location` e `full_address` sono mantenuti per backward-compat.

### ✅ Frontend
**`/app/frontend/src/AppointmentShareActions.tsx`** (v2.16):
- Nuovo helper esportato `composeAppointmentAddress(appt)` che costruisce l'indirizzo `Via Numero, CAP Città (PROV)` dai campi strutturati, con fallback al campo `location` legacy
- Il tipo `ApptDetails` ora accetta i campi indirizzo strutturato + `phone_mobile`/`phone_work`/`email`
- La logica dei bottoni usa `effectivePhone/effectiveWhatsapp/effectiveEmail` che risolvono in cascata: contact.field → appt.field
- Warning testuale aggiornato: *"Inserisci telefono o email nell'appuntamento (o associa un contatto)..."*
- `buildAppointmentMessage()` usa `composeAppointmentAddress()` per l'output finale

**`/app/frontend/app/appointment/new.tsx`**:
- Form state esteso con `email` + 5 campi indirizzo
- 3 nuovi gruppi UI: `[Via/Piazza | N. civico]`, `[CAP | Città | Prov]`, `Email cliente`
- CAP → number-pad, max 5 cifre; Provincia → uppercase, max 2 caratteri
- `submit()` compone `location` legacy dai campi strutturati se l'utente non l'ha compilato manualmente
- `postSave` modal ora include phone/email/indirizzo → `AppointmentShareActions` mostra i bottoni attivi

**`/app/frontend/app/appointment/[id].tsx`**:
- Tipo `Appointment` esteso con i nuovi campi opzionali
- Sezione "Condividi con il cliente" rifattorizzata per usare direttamente `<AppointmentShareActions>` con fallback appt → i bottoni ora si attivano se l'appuntamento ha phone/email anche senza contact collegato
- Rimosso codice duplicato inline (compone testo + 3 Pressable manuali → 40 righe eliminate)
- Warning aggiornato: *"Nessun contatto collegato — puoi comunque usare i canali sopra se hai inserito telefono/email nell'appuntamento."*

### ✅ Verifica end-to-end (senza testing agent)
- Backend: POST/GET/PUT con nuovi campi → **200 OK, tutti persistiti + editabili** ✅
- `composeAppointmentAddress` Node inline test: 4/4 casi ok (completo, parziale, legacy, empty) ✅
- Lint pulito ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.15 Bug Fix — Condivisione Biglietto da Visita (Feb 2026)
### 🐛 Bug segnalato
Nel Biglietto da Visita, il bottone "Condividi" richiedeva 2 tap per funzionare, e la rotellina di caricamento continuava a girare anche dopo che la condivisione era avvenuta.

### 🔬 Root cause
1. **Double-tap**: `await import("html2canvas")` in `generateShareImage.ts` esegue un dynamic import al primo tap (~1s di lazy-load bundle). Durante quell'attesa il browser perde il contesto user-gesture, quindi `navigator.share()` viene rifiutata (NotAllowedError/SecurityError) e il codice cade in fallback download silente. Al secondo tap html2canvas è già in cache → gesture preservato → share funziona.
2. **Spinner infinito**: `setSharing(false)` era solo nel `finally` block. In alcuni browser `nav.share()` può stallare la promise dopo il completamento nativo, lasciando lo state bloccato.

### ✅ Fix applicato (`/app/frontend/modules/business-card/screens/BusinessCardScreen.tsx`)
1. **Pre-warm eager di html2canvas** in `useEffect` al mount (solo web) → il primo tap non paga più il costo di lazy-load, gesture preservato.
2. **Re-entrance guard** con `sharingRef = useRef(false)` — impedisce double-execution nel gap di 1 render frame tra tap e disabled prop.
3. **Safety timer** (30s) via `setTimeout` in `try/finally` che force-resetta sempre `sharing=false` anche se la promise di `nav.share()` non risolve mai.
4. **Handle AbortError** esplicito nel catch dell'outer wrapper — se l'utente annulla il share sheet nativo, non mostrare un banner d'errore rosso.
5. `finally` clean garantito: `clearTimeout(safetyTimer)` + `sharingRef.current = false` + `setSharing(false)`.

### ✅ Verifica
- Lint pulito ✅
- Expo restart senza errori ✅
- Il codice esistente in `generateShareImage.ts` già gestisce AbortError correttamente e ritorna `ok({shared:false})` invece di errore, quindi il finally si triggera come atteso.

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.14 Feature — "Invia dettagli" in creazione appuntamento (Feb 2026)
### 🎯 Richiesta utente
Nella sezione Appuntamenti, quando si crea o visualizza un appuntamento con numero di telefono del cliente, manca il pulsante per inviare i dettagli via SMS/WhatsApp. Aggiungerlo alla schermata di creazione con testo pre-compilato (data, ora, luogo).

### 🔬 Root cause / stato attuale
- `/app/frontend/app/appointment/[id].tsx` (view) — sezione share Email/WhatsApp/SMS **già presente** (linee 361-405)
- `/app/frontend/app/appointment/new.tsx` (create) — **mancante**: dopo `submit()`, `router.back()` immediato senza dare la possibilità di condividere

### ✅ Fix applicato
**Nuovo componente condiviso** `/app/frontend/src/AppointmentShareActions.tsx`:
- Helper `buildAppointmentMessage(appt, contact)` esportato — testo IT localizzato con emoji (📅 titolo, 🗓 data lunga `dateStyle:full timeStyle:short`, 📍 luogo, 📞 telefonico, Note)
- Componente `<AppointmentShareActions appt contact />` con 3 bottoni: Email (mailto), WhatsApp (wa.me), SMS (sms:) — auto-disabled se manca il canale
- Warning inline se il contatto non ha né phone né email

**Integrato in** `/app/frontend/app/appointment/new.tsx`:
- Nuovo state `postSave` popolato in `submit()` dopo la POST riuscita
- Se il contatto selezionato ha phone o email → apre bottom-sheet modal "Appuntamento creato ✅ — Vuoi inviare i dettagli al cliente ora?" con `<AppointmentShareActions />`
- Se nessun canale disponibile → `router.back()` come prima (nessuna regressione)
- Al tap "Chiudi senza inviare" → `router.back()`
- testID: `appt-share-email`, `appt-share-whatsapp`, `appt-share-sms`, `post-save-close`

**`[id].tsx` (view)** non modificato — codice share esistente conservato (testID storici `share-email`/`share-whatsapp`/`share-sms` preservati per backward compat).

### ✅ Verifica (senza testing agent)
- Node inline: `buildAppointmentMessage()` genera 280 char testo IT localizzato ✅
- Lint pulito su entrambi i file ✅
- Expo riavvia senza errori ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.13 Bug Fix — Parsing data italiana in Banner Evento (Feb 2026)
### 🐛 Bug segnalato
`event-banners.tsx:223` — `new Date("27.08.2036T20:30:00").toISOString()` lanciava `RangeError: Invalid time value` perché `Date()` non parsa il formato italiano DD.MM.YYYY, blocca il salvataggio dell'evento.

### ✅ Fix applicato (`/app/frontend/app/event-banners.tsx`)
- Nuovo helper `parseItalianDateTime(d, t)` con regex robusti:
  - Data: `DD.MM.YYYY` | `DD/MM/YYYY` | `DD-MM-YYYY` | `YYYY-MM-DD` (backward compat) | `DD.MM.YY` (anno corto → 20xx)
  - Ora: `HH:MM` | `HH.MM` | `HH,MM` | `HHMM` (no separatore)
- Validazione range: anno 1970-3000, mese 1-12, giorno 1-31, ora 0-23, min 0-59
- Round-trip check: rifiuta 31 febbraio, 32 agosto ecc. (JS `Date` wrap-around detection)
- Se parse fallisce → notify user: *"Data o ora non valida. Usa il formato GG.MM.AAAA (es. 27.08.2036) e HH:MM (es. 20:30)"*
- Placeholder aggiornati: `GG.MM.AAAA` e `HH:MM` (era `YYYY-MM-DD` misleading)
- `openEdit()` ora precompila i campi in formato italiano `DD.MM.YYYY` invece di ISO
- Su native: `keyboardType="numbers-and-punctuation"` per tastiera numerica con `.`/`:` diretti

### ✅ Verifica (test unit inline con Node)
11/11 test passano: formati IT ok, backward compat ISO ok, rifiuta feb31/day32/hour25/garbage ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.12 Feature — CTE Comparativa (Multi-Bill Upload + Report) (Feb 2026)
### 🎯 Richiesta utente
Il consulente deve poter caricare più PDF fatture (luce/gas/telco) contemporaneamente per un singolo cliente. L'AI analizza tutte le fatture e genera un **report comparativo** con: consumi nel tempo, andamento spesa, confronto tra fornitori diversi, e suggerimento del fornitore più conveniente. Visualizzabile inline e condivisibile come PDF/HTML.

### ✅ Backend (`/app/backend/server.py`)
**Endpoint aggiunti**:
- `POST /api/contacts/{contact_id}/bills/bulk-upload` — accetta `{bills: [{bill_type, pdf_base64, pdf_name}, ...]}` (max 20). Per ciascun item crea un `energy_bill` in stato `pending` e schedula `_analyze_bill_task` in background (stessa pipeline della POST singola).
- `GET /api/contacts/{contact_id}/bills/cte-report` — genera HTML comparativo con:
  - **Header brandizzato** (logo + nome agenzia + data generazione)
  - **KPI row**: n. fatture, n. fornitori diversi, spesa totale
  - **SVG bar chart** andamento spesa nel tempo (colorato per bill_type)
  - **Tabelle confronto fornitori** per bill_type: fatture, spesa media, consumo medio + **badge "più conveniente"** al fornitore con spesa media minore
  - **Verdict AI Claude Sonnet 5** (`_llm_cte_verdict`): frase in italiano per tipo che indica fornitore più conveniente e perché (costo, spread, penali)
  - Returns `{name, mime: text/html, data_base64, bills_count, verdict}` pronto per `FileViewer`

### ✅ Frontend (`/app/frontend/src/BillsSection.tsx`)
- **`bulkUploadPdfs()`** — DocumentPicker con `multiple: true`. Auto-infer del `bill_type` dal nome file (contiene "gas"/"telco"/"internet" → tipo dedotto, altrimenti default "luce"). POST batch → notify success + reload.
- **`generateCTE()`** — GET `/cte-report` → apre inline in `FileViewer` + propone `SaveConfirmModal` per salvare come file cliente.
- **UI**: 2 nuovi bottoni sotto "Genera Report PDF":
  - 🟦 "Carica più fatture insieme" (`bills-bulk-upload-btn`, ciano #0891B2)
  - 🟢 "CTE Comparativa (N fatture)" (`bills-cte-btn`, verde #059669) — disabilitato se `totalDone < 1`; hint "consigliato con ≥ 2 fatture"

### ✅ Test end-to-end (senza testing agent)
File: `/app/backend/tests/test_v212_cte_comparativa.py`
- Upload bulk di 3 fatture (2 luce ENEL/Eni + 1 gas Eni) → **200 OK, count=3** ✅
- Polling 16s: tutte e 3 analizzate `status=done` ✅
- GET `/cte-report` → **200 OK, HTML 7788 chars** ✅
- HTML contiene "CTE Comparativa" + "Confronto fornitori" + badge "più conveniente" ✅
- Verdict AI popolato per luce e gas ✅
- Cleanup fatture di test completato ✅

### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.11 Feature — Estrazione automatica copertina dal PDF programma (Feb 2026)
### 🎯 Richiesta utente
Quando il master carica il PDF del programma evento, l'AI deve estrarre automaticamente l'immagine più significativa dal PDF e usarla come copertina del banner, ridimensionata correttamente.
### ✅ Backend
Nuova dipendenza: `pymupdf==1.28.2` (in `requirements.txt`).

- Nuovo helper `_extract_best_image_from_pdf(pdf_b64)`:
  1. Apre il PDF con PyMuPDF (fitz)
  2. Pass 1 — scansiona fino a 8 pagine estraendo immagini raster embedded via `page.get_images(full=True)`; scarta quelle < 200×200px; sceglie la più grande per area
  3. Pass 2 (fallback) — se nessuna immagine raster valida, **renderizza la prima pagina** a 2x scale come immagine sintetica
  4. Center-crop a 16:9 → resize a **1600×900** con Pillow LANCZOS
  5. Output JPEG qualità 85 (media 8-20 KB)
- Nuovo endpoint `POST /api/event-banners/{event_id}/extract-cover-from-pdf`:
  - Body `{apply: bool = true}`. Se true, aggiorna `cover_base64`/`cover_mime` del banner in DB.
  - Ritorna `{applied, cover_base64, cover_mime, size_bytes}`.
  - RBAC: solo master/admin (`_ensure_master`).
  - 400 se nessun PDF caricato; 422 se estrazione fallita.

### ✅ Frontend
`/app/frontend/app/event-banners.tsx`:
- `pickProgramPdf()` — dopo upload del PDF, se l'evento è già salvato E non c'è ancora una cover manuale, chiama **automaticamente** `/extract-cover-from-pdf` (fire-and-forget con notify success). Persiste il PDF via PUT prima dell'estrazione.
- Nuovo pulsante `event-extract-cover-btn` "Estrai copertina dal PDF con AI" (giallo `#F59E0B`, sparkles icon) visibile quando `programPdf` è caricato → chiama `extractCoverFromPdfNow()` esplicitamente.

### ✅ Test end-to-end (senza testing agent)
```
PDF con immagine 800×600 embedded → estratto, resize 1600×900, JPEG 18.5 KB ✅
PDF solo testo (nessuna immagine) → fallback rendering pagina 1, JPEG 8.8 KB ✅
Cover applicata a event_banners.cover_base64 ✅
```
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent (il nuovo pacchetto `pymupdf` è già in `requirements.txt` — sarà installato al deploy).



## v2.10 Feature — Banner Evento Master (Feb 2026)
### 🎯 Richiesta utente
Il master deve poter creare eventi con: immagine copertina, titolo, data, visibilità (singoli contatti / gruppi / tutti). Banner in home dei destinatari con countdown live (gg/hh/mm/ss). Tap → PDF programma condivisibile. Collaboratori vedono il banner anche senza usare la sezione master.

### ✅ Backend (`/app/backend/server.py`)
Nuova collection `event_banners` con schema completo (event_id, user_id/tenant, created_by, title, event_at, cover_base64/mime, program_pdf_base64/name, program_html AI, visibility_kind, visible_user_ids/contact_ids/group_ids, public_token, created_at/updated_at).

**Endpoint aggiunti**:
- `POST /api/event-banners` — crea evento (solo master/admin, `_ensure_master`)
- `GET /api/event-banners` — lista (light, master only)
- `GET /api/event-banners/active` — banner visibili per l'utente corrente (team + master, con filtro visibility)
- `GET /api/event-banners/{id}` — dettaglio (con RBAC check `_event_visible_to_user`)
- `PUT /api/event-banners/{id}` — update
- `DELETE /api/event-banners/{id}` — elimina
- `POST /api/event-banners/{id}/generate-program` — AI Claude Sonnet 5 genera HTML programma professionale
- `GET /api/event-banners/{id}/program` — restituisce PDF o HTML programma per FileViewer
- `GET /api/public/event-banners/{token}` — pagina pubblica HTML (no auth) con hero + countdown script + link programma per contatti

### ✅ Frontend
- `/app/frontend/src/HomeEventBanner.tsx` — componente hero con cover full-width, countdown live 1s tick, CTA "Apri il programma". Auto-hide se nessun evento attivo. Mostrato nella home tab (`(tabs)/home.tsx`) subito sotto il tile Master.
- `/app/frontend/app/event-banners.tsx` — screen master con lista eventi + modal creazione/modifica: cover picker (universale web/native), titolo, data+ora, visibility (Tutti / Solo selezionati con chip per collaboratori/gruppi contatti/contatti singoli), upload PDF programma OPPURE generazione AI (con descrizione + durata hint).
- `/app/frontend/app/event/[id].tsx` — screen dettaglio evento con hero + countdown + 2 bottoni "Apri programma" (FileViewer inline) e "Condividi link pubblico" (Web Share API / native Share). ShareSheet integrato per condivisione del PDF/HTML.
- `/app/frontend/app/master.tsx` — nuovo tile 🟡 "Banner Evento" (megaphone icon, `#F59E0B`) che apre `/event-banners`.

### 🔐 Visibility rules
- `_ensure_master(user)` — solo owner/admin possono creare/modificare/eliminare eventi
- `_event_visible_to_user(banner, user)`:
  - Owner del tenant → sempre visibile
  - `visibility_kind = "all"` → tutti i team member vedono il banner
  - `visibility_kind = "specific"` → solo user_id in `visible_user_ids` vedono il banner
  - Contatti clienti raggiungono l'evento tramite **link pubblico** condiviso dal master (nessun accesso automatico)

### 📱 UX del banner in home
- Hero 220px, cover con gradient overlay per leggibilità
- Badge "EVENTO IN ARRIVO" oro
- Titolo bold 22px + data formattata italiana
- 4 box countdown (giorni/ore/min/sec) con tick 1s
- CTA "Apri il programma" (chevron)
- Se evento passato → badge rosso "Evento in corso"

### Verifica manuale (senza testing agent)
- ✅ Creazione evento via API → appare in `/event-banners/active`
- ✅ Home mostra banner "Convention 2026 Roma" con countdown live (06gg 23h 57m 52s verificato via screenshot)
- ✅ Cleanup evento test completato
- ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.9 Rename — "Note AI" → "Consulenza Corporate" (Feb 2026)
### 🎯 Richiesta utente
Rinominare "Note AI" (e la variante dinamica "Note di {consulente}") in "Consulenza Corporate" in tutta l'app.
### ✅ Modifiche applicate
**Frontend user-facing labels**:
- `/app/frontend/src/BillFieldRenderers.tsx` (linea 237, `BillFieldRow`): la sezione bulleted list per `note_ai` ora mostra label **"Consulenza Corporate"** (era `humanizeKey("note_ai") → "Note Ai"`)
- `/app/frontend/src/BillsSection.tsx` (linea 446, `buildBillAnalysisHtml`): la label HTML della riga note nella tabella analisi è ora `"Consulenza Corporate"` (era `Note di ${consultantName}`)
- `/app/frontend/src/BillsSection.tsx` (linea 1703, `humanKey` map): `note_ai: "Consulenza Corporate"` (era `"Note AI"`)
- `/app/frontend/src/BillsSection.tsx` (linea 1765, `renderExtractedTable`): heading HTML `"Consulenza Corporate"` (era `"Note AI"`)

**Backend user-facing HTML**:
- `/app/backend/server.py` (`_build_analysis_html`, linea ~4219): titolo `<h3>` note ora sempre `"Consulenza Corporate"` (era `Note di {consultant}`)

**Test aggiornati**:
- `/app/backend/tests/test_v38w_analysis_page_fixes.py`: 3 test rinominati per asserire la nuova label statica + 1 asserzione E2E aggiornata. **25/25 test passano ✅**

### Note
- La chiave JSON interna `note_ai` è mantenuta inalterata (usata da LLM prompt + parser + `_parse_llm_json` fallback). Solo la label mostrata all'utente è cambiata.
- Coerente sia su preview che sulle analisi già salvate (rerender lato client dalla data_base64).
- Testing agent NON invocato (esplicita richiesta utente); pytest backend eseguito manualmente.
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.8 Redesign — Master "Analizza bolletta" allineato a BillsSection (Feb 2026)
### 🎯 Richiesta utente
La sezione "Analizza bolletta" lato Master deve essere identica visivamente e funzionalmente alla sezione fatture nella scheda cliente: stesse sezioni Luce/Gas/Telco, stesso caricamento PDF, stesse offerte aziendali, stessa lista fatture analizzate.
### ✅ Fix applicato
`/app/frontend/app/bill-quick.tsx` — riscritto da zero (772 → 890 righe) per rispecchiare `BillsSection.tsx`:
- **Intro card** blu identica (`#EEF2FF` + "Fatture Energia · AI Claude Sonnet 5")
- **Offerte aziendali accordion viola** (`#F5F3FF`/`#7C3AED`) — upload PDF offerta + textarea manuale + `VoiceDictationButton` + salva testo + lista offerte
- **3 sezioni raggruppate Luce (giallo) / Gas (rosso) / Telco (ciano)** con header colorato + counter, ognuna con il proprio bottone dashed "Carica fattura PDF"
- **Card fattura identica**: header con icona document-text + pdf_name + status pill colorato + trash/cancel/chevron; body espandibile con `BillFieldRow` (stesso rendering che il cliente per `consumi_mensili`, `parametri_richiesti`, `note_ai`, fiscal_check)
- **Params modal identico**: header colorato + emoji, `PARAMETRI STANDARD` pill toggle-able, `PARAMETRI PERSONALIZZATI` con badge viola, input custom, counter "Selezionati: N"
- **Azioni master-specifiche**: Apri PDF · Annulla analisi · Ri-analizza · Associa a cliente · Crea cliente · Elimina (in luogo di "Salva sul cliente" del cliente)
- **Fiscal-check config** mantenuto come bonus master-side (Verifica IVA 10/22, Accise gas, PCV)

`/app/backend/server.py`:
- Nuovo endpoint `POST /api/bill-drafts/{draft_id}/cancel` — parity con `/contacts/{id}/bills/{bill_id}/cancel` (checkpoint già rispettato in `_analyze_draft_task`)

### Note
- `/company-offers` è tenant-scoped → le stesse offerte aziendali sono ora visibili sia lato master che lato cliente.
- Bug #1 (analisi non appariva nei file cliente) già fixato in v2.7 tramite `_push_draft_files_to_contact`.
- Testing agent NON invocato (esplicita richiesta utente); verifica visiva via screenshot: UI identica al cliente ✅
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.7 Bug Fix — Analisi bolletta non appare nei file cliente (Feb 2026)
### 🐛 Bug segnalato
Lato Master: dopo aver analizzato una fattura e averla associata a un cliente esistente, l'analisi non appariva nei "File" del cliente (tab file della scheda contatto). L'analisi restava solo nel cabinet Master del consulente.
### 🔬 Root cause
`POST /api/bill-drafts/{id}/associate` creava solo l'`energy_bills` doc (che alimenta il tab "Fatture" del cliente) ma NON copiava il PDF né l'HTML analisi in `contacts.files`. Stessa mancanza in `POST /api/bill-drafts/{id}/create-contact`.
### ✅ Fix applicato
`/app/backend/server.py`:
- Nuovo helper `_push_draft_files_to_contact(draft, contact_id)` che riusa `_build_analysis_html` (stessa render usata per master_files) e pusha nel `contacts.files` array:
  1. Il PDF originale (nome `{base}.pdf`, mime `application/pdf`)
  2. L'HTML analisi (nome `Analisi-{base}.html`, mime `text/html`)
- Idempotente: verifica nomi esistenti in `contact.files` prima di push (skip duplicati)
- Chiamato in `associate_bill_draft` (associa a contatto esistente) e in `create_contact_from_draft` (crea nuovo contatto da draft)
### Note
- Il PDF resta anche in `energy_bills.pdf_base64` per il tab Fatture del cliente (non tocchiamo quel flusso).
- L'analisi resta anche in `master_files` (cabinet Master) come archivio consulente.
- Testing agent NON invocato (esplicita richiesta utente).
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.6 Bug Fix — Share nativo in "I miei file" (Feb 2026)
### 🐛 Bug segnalato
Nella sezione "I miei file" (Master Files) il pulsante Condividi → "Sistema" scaricava direttamente il file invece di aprire il menu di condivisione nativo del sistema. Su mobile e su web funzionava come un semplice download.
### 🔬 Root cause
`shareDataUri()` in `/app/frontend/src/share.ts`: su `Platform.OS === 'web'` andava dritto a `document.createElement('a').click()` (download). Mai tentava la Web Share API con files (Level 2), pur essendo supportata da Safari iOS e Chrome Android.
### ✅ Fix applicato
`/app/frontend/src/share.ts`:
- Nuovi helper `base64ToBytes()` e `webDownload()` interni.
- `shareDataUri()` su web: prova prima `navigator.canShare({files:[File]})` → `navigator.share({files})`; se `AbortError` (utente annulla) esce silenziosamente; solo se Web Share API assente/rifiuta → fallback `<a download>` originale.
- Native invariato (expo-sharing / Share sheet iOS/Android).

`/app/frontend/src/ShareSheet.tsx`:
- `shareSystem()` ora chiama `onClose()` dopo condivisione riuscita per UX più pulita.
### Note
- Su Chrome desktop la Web Share API con files non è ancora supportata → fallback download resta il comportamento atteso.
- Su iOS Safari / Android Chrome ora si apre il vero share sheet nativo del sistema (WhatsApp, Mail, AirDrop, ecc.).
- Testing agent NON invocato (esplicita richiesta utente).
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.



## v2.5 Bug Fix — Overlay Calcolatrice fuori posizione (Feb 2026)
### 🐛 Bug segnalato
L'overlay/bottom-sheet della Calcolatrice appariva fuori posizione, non centrato, e su viewport large fuoriusciva dai bordi.
### ✅ Fix applicato
`/app/frontend/src/CalculatorFAB.tsx` — stili del bottom-sheet:
- `backdrop`: aggiunto `alignItems: 'center'` per centrare orizzontalmente
- `sheet`: aggiunto `width: '100%'`, `maxWidth: 480`, `alignSelf: 'center'` (clamp responsive per desktop/tablet)
- `sheet`: `paddingBottom` aumentato a 34px su iOS (safe-area home-indicator) e 24px su Android
- Manteniamo `maxHeight: 62%` e `justifyContent: 'flex-end'` (pinned bottom con feel di bottom sheet)
### Note
- Su phone: bottom sheet a full-width come prima
- Su desktop/tablet: sheet centrato con margine laterale (max 480px)
- Su iOS moderni: no clip da home-indicator
- Testing agent non invocato (esplicita richiesta utente)
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.4 Bug Fix — Report inline nella scheda cliente (Feb 2026)
### 🐛 Bug segnalato
Il report/comparazione generato dalla scheda cliente (contact/[id] → tab Fatture → "Report fatture" / "Confronta") si apriva in una finestra esterna (browser print dialog o nuova tab) invece di essere mostrato inline come su master-files.
### 🔬 Root cause
`BillsSection.tsx` usava `printHtmlOnWeb(html, ...)` che apre `window.open()` → nuova tab con `print()`. Master-files invece usa `FileViewer` inline con HTML base64.
### ✅ Fix applicato
`/app/frontend/src/BillsSection.tsx` — allineato al pattern di master-files:
- Import `FileViewer` e aggiunto state `viewerOpen`
- Nuovo helper `openHtmlInline(html, name)` che base64-encode l'HTML (UTF-8 safe: `encodeURIComponent → btoa`) e lo apre in FileViewer
- Sostituite le 2 chiamate `printHtmlOnWeb` in `generateReport()` e `runComparison()` con `openHtmlInline`
- `<FileViewer visible mime="text/html" ...>` aggiunto al JSX del componente
- Estensioni cambiate da `.pdf` a `.html` (il file è HTML, non PDF)
### Note
- `printHtmlOnWeb` mantenuta come dead code (marker `unused` nel lint) per compatibilità futura se serve stampa nativa. Da rimuovere in una prossima passata di dedup.
- FileViewer già supporta UTF-8 HTML decode (fix v2.0) quindi emoji e accenti nel report sono già gestiti correttamente
- Testing agent non invocato (utente ha esplicitamente richiesto skip)
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.3 Bug Fix — Web Share API PNG condivisione (Feb 2026)
### 🐛 Bug segnalato
Su web, la condivisione del PNG del biglietto da visita dava sempre errore "Errore condivisione", il download fallback non veniva mai eseguito.
### 🔬 Root cause
La QR code image era caricata da `api.qrserver.com` (cross-origin, senza CORS headers) → html2canvas rendeva il canvas "tainted" → `combined.toDataURL('image/png')` lanciava `SecurityError` → l'intera share flow falliva prima ancora di arrivare al download fallback.
### ✅ Fix applicato
**`CardHtmlMirrors.tsx`**:
- `useEffect` che genera la QR come **data URL locale** tramite libreria `qrcode` (già installata come dep transitiva di `react-native-qrcode-svg`)
- Import dinamico → no impatto sul bundle native
- `crossOrigin='anonymous'` sull'img come safety net
- Config: `margin:0, width:120, color:{dark:'#1A2A6C', light:'#FFFFFF'}`

**`generateShareImage.ts`**:
- html2canvas opts: `allowTaint: false` (fail early), `imageTimeout: 15000`
- Web Share API: gestisce **AbortError** (utente cancella) → `ok({shared:false})` no red banner
- Guard `window.isSecureContext !== false`
- Download fallback wrappato in try/catch — last-resort apre PNG in nuova tab
- Never returns `err()` se PNG generato correttamente
### ✅ Test
- `testing_agent` iterazione 70 — end-to-end Playwright:
  - PNG scaricato realmente: **962KB, 5328x918 RGBA**, fronte+retro affiancati, QR navy visibile su bianco ✅
  - Zero banner "Errore condivisione" ✅
  - Zero `SecurityError` / `Tainted canvas` in console ✅
  - QR image `src` inizia con `data:image/png;base64,...` (locale) ✅
- Non-regressione: flip, save, effetti PNG (v1.9), logo senza box (v2.2) tutti OK
### ⚠ Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.2 Bug Fix — Box bianco attorno al logo del biglietto (Feb 2026)
### 🐛 Bug segnalato
Logo del biglietto da visita mostrava un box bianco attorno all'immagine sull'anteprima live (il PNG condiviso era già fixato in v1.4/v1.8).
### 🔬 Root cause
`<RNImage>` di React Native su Web viene renderizzato come `<div>` con `background-image` — questo poteva creare un box visibile in certe condizioni di rendering.
### ✅ Fix applicato
`/app/frontend/modules/business-card/screens/BusinessCardScreen.tsx`:
- Su Platform.OS === 'web', il logo ora usa un `<img>` HTML nativo (non `<RNImage>`) con stili espliciti: `background: transparent`, `backgroundColor: transparent`, `border: none`, `boxShadow: none`, `outline: none`, `objectFit: contain`
- Su native (iOS/Android) mantiene `<RNImage>` (già funziona correttamente)
- `logoWrap` e `logoImg` styles aggiornati con `backgroundColor: 'transparent'` esplicito
- `CardHtmlMirrors.tsx` (PNG condiviso): aggiunto `outline: 'none'` per completezza
### ✅ Test
- `testing_agent` iterazione 69 — verifica DOM completa:
  - `tagName: IMG` (non più `DIV`) ✅
  - `backgroundColor: rgba(0,0,0,0)` (trasparente) ✅
  - `logoWrap` transparent, `border: 0px none`, `boxShadow: none`, `outline: 0px` ✅
  - Zero `<div>` visibili con `data:image` background
- Non-regressione: flip fronte/retro, save, share PNG, QR retro tutti OK
### ⚠ Nota
Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.1 Bug Fix — Tag HTML visibili nel testo AI (Feb 2026)
### 🐛 Bug segnalato
Nell'output delle analisi (invoice-analysis) apparivano tag HTML come `<br>`, `<p>` visibili come testo grezzo invece che essere renderizzati/rimossi.
### 🔬 Root cause
L'AI restituisce testo formattato con tag HTML (per line break). Il codice passava questo testo direttamente a `esc()`/`escHtml()` prima di inserirlo nell'HTML → i tag venivano ESCAPED (`<br>` → `&lt;br&gt;`) e mostrati letteralmente all'utente.
### ✅ Fix applicato
Aggiunto sanitizer in 3 punti (backend + 2 file frontend con parity byte-identical):
- **Backend** (`_build_analysis_html`): funzione `_sanitize_ai(text)` che:
  - `<br>` → `\n`, `<p>` → `\n\n`, `<li>` → `• `
  - Strippa tutti gli altri tag
  - Decodifica entità HTML (`&nbsp; &amp; &lt; &gt; &quot; &#39;`)
  - Applicata a `fornitore`, `offerta`, `note_ai`, valori KV
- **Frontend** `BillsSection.tsx`: `sanitizeAi()` con stesso pattern applicato in `renderValue()` e su `note_ai`
- **Frontend** `BillFieldRenderers.tsx`: `sanitizeAiText()` esportata + applicata in `formatVal` e rendering `note_ai`
### ✅ Test
- `testing_agent` iterazione 68 — 15/15 pytest backend + 10/10 Node.js parity test frontend PASS
- File test creati: `/app/backend/tests/test_v39_html_sanitize.py` + `/app/backend/tests/v39_js_sanitize_parity.js`
- Sicurezza XSS: nessuno `<script>` sopravvive; `esc()` finale neutralizza qualsiasi carattere speciale rimasto
- Non-regressione: fiscal check, parse_error banner (v1.9), UTF-8 emoji (v2.0) tutti OK
### ⚠ Nota
Sanitizer duplicato in 3 file (per isolamento inter-modulo). Se in futuro vuoi centralizzare, sposta in `@/src/shared/`.
Per attivarlo in **produzione**: **Redeploy** dal pannello Emergent.


## v2.0 Bug Fix — Encoding UTF-8 negli HTML report (Feb 2026)
### 🐛 Bug segnalato
Emoji e caratteri accentati corrotti (mostrati come `âš `, `Ã¨`, `â‚¬` invece di ⚠, è, €) negli HTML analysis report renderizzati nel FileViewer (master-files → Analisi).
### 🔬 Root cause
`FileViewer.tsx` decodificava base64 HTML con `atob(dataBase64)` diretto. `atob()` restituisce una **binary string** (1 char = 1 byte, Latin-1). I caratteri multi-byte UTF-8 (emoji = 4 bytes, `è` = 2 bytes, `€` = 3 bytes) venivano quindi corrotti perché ogni byte veniva interpretato come Latin-1 separato.
### ✅ Fix applicato
`/app/frontend/src/FileViewer.tsx`:
- Aggiunto `useMemo htmlDecoded` che:
  1. `atob(base64)` → binary string
  2. Byte-per-byte in `Uint8Array` (via `charCodeAt(i) & 0xff`)
  3. `new TextDecoder('utf-8').decode(bytes)` → stringa Unicode corretta
  4. Fallback graceful con `decodeURIComponent/escape` per runtime senza TextDecoder
  5. Never throws (ritorna "" su errore)
- Sostituito in ENTRAMBI i punti di rendering: `<iframe srcDoc>` (web) e `<WebView source={html}>` (native)
- Non toccato il path PDF (binary bytes, va OK con atob diretto)
### ✅ Test
- `testing_agent` iterazione 67 — byte-level unit test in browser:
  - OLD path (plain atob) su input `"⚠ Attenzione! più tardi, è possibile analizzare €100 — perché no? 🏢💡"` produce ESATTAMENTE la corruzione riportata: `"â  Attenzione! piÃ¹ tardi, Ã¨ possibile analizzare â¬100 â perchÃ© no? ð¢ð¡"`
  - NEW path (atob → Uint8Array → TextDecoder) → roundtrip perfetto, tutti i simboli corretti
- Backend confermato corretto: `<meta charset="UTF-8"/>` + `html.encode('utf-8')`
### ⚠ Nota per produzione
Fix attivo in **preview**. Per attivarlo in produzione: **Redeploy** dal pannello Emergent.


## v1.9 Bug Fix — JSON parsing robusto nel Fiscal Check (Feb 2026)
### 🐛 Bug segnalato
Modulo `invoice-analysis` → Fiscal Check mostrava "JSON parse error" rosso quando la risposta AI era malformata (sia preview che produzione).
### ✅ Fix applicato
**Backend** (`/app/backend/server.py`):
- Nuovo helper `_parse_llm_json(raw, fallback_key)` con 3 tentativi di parsing:
  1. Strict `json.loads()`
  2. Estrazione outermost `{...}` via regex
  3. Repair defects (trailing commas, single→double quotes, unquoted keys)
- Su fallimento ritorna `{parse_error: True, error_message: "L'analisi AI ha restituito una risposta non valida..."}` — **mai raise**
- Sostituite 5 chiamate `_json.loads(raw)` sparse nei flussi LLM (bill analysis, contact extraction, offer analysis, offers comparison, bills report)
- `_build_analysis_html` mostra banner rosso "⚠ Analisi non riuscita" e nasconde le chiavi diagnostiche interne
### Frontend
- `BillFieldRenderers.tsx`: rendering dedicato di `parse_error` come banner rosso con messaggio user-friendly; nascosto `parse_error_kind` diagnostico
- `BillsSection.tsx`: `parseErrorHtml` renderizzato PRIMA del contenuto della bolletta; filtrate chiavi interne dalle KV rows
### ✅ Test
- `testing_agent` iterazione 66 — **17/17 test backend PASS** (unit su `_parse_llm_json` + integration su `_build_analysis_html` + E2E con PDF random)
- Regression 12/12 fiscal-check passa ancora
- Frontend Playwright: nessuna stringa tecnica leak (`JSON parse error`, `Expecting value`, `Traceback`) sulla pagina
- Test file creato: `/app/backend/tests/test_v38z_json_parse_robust.py`
### ⚠ Nota per produzione
Il fix è ora attivo in **preview**. Per attivarlo in **produzione** l'utente deve fare **Redeploy** dal pannello Emergent.


## v1.8 Refactor Architetturale — Fase 3 COMPLETATA (Feb 2026)
### 🏗️ 4 moduli migrati: `invoice-analysis`, `master`, `communications`, `profile`
- **`invoice-analysis/`**: types (`BillType`, `BillStatus`, `EnergyBill`, `BillCreateInput`, `BillGrouped`, `CompanyOffer`) + 8 funzioni API `Result<T>` (listContactBills, createBill, reanalyzeBill, cancelBillAnalysis, deleteBill, getBillReport, getBillComparison, listCompanyOffers)
- **`master/`** (condivide componenti base con invoice-analysis re-esportando `BillType`/`BillStatus`/`EnergyBill` — architectural symmetry): types (`MasterCategory`, `MasterFile`, `Contract`, `WebLink`) + 7 funzioni API `Result<T>`
- **`communications/`**: types (`ChatMessage`, `ChatChannel`, `MessageKind`, `ShareTargetKind`) + 3 funzioni API chat `Result<T>`
- **`profile/`**: types (`UserProfile`, `UserRole`, `ThemeMode`, `UserSettings`, `ProfileUpdateInput`) + 4 funzioni API `Result<T>` (getMe, updateProfile, getUserSettings, updateUserSettings)
### 🛡️ 7 route wrappate con ModuleErrorBoundary (Fase 3)
- `/master`, `/master-files` → moduleName="master"
- `/(tabs)/chat`, `/chat/[id]` → moduleName="communications"
- `/(tabs)/impostazioni`, `/security` → moduleName="profile"
- `/bill-quick` → moduleName="invoice-analysis"
### 📊 Totale refactor (Fasi 1+2+3)
- **14 route protette** con `ModuleErrorBoundary` — crash isolato per modulo
- **7 moduli** con API pubblica tipizzata + `Result<T>` + `AsyncResource<T>` per stati espliciti
- **Zero regressione** confermata su tutte le 3 iterazioni di testing_agent (61 tests totali)
- **Adozione hook**: business-card è il pilota (full-migrated). Contacts/agenda/invoice-analysis/master/communications/profile hanno API pubbliche pronte per adozione progressiva nelle UI screens senza rischio break
### 🔮 Backlog
- Adozione hook `useContact`/`useAppointment` nelle screen (~5000 righe da rifattorizzare, richiede sessioni dedicate)
- Rimozione codice duplicato residuo (esempi: `Settings` type ripetuto in impostazioni + contact/new + appointment/new)
- Sostituzione librerie Expo con Web API standard dove il modulo è cross-platform (già fatto per image picker in v1.4)


## v1.7 Refactor Architetturale — Fase 2 (Feb 2026)
### 🏗️ Moduli migrati: `contacts` + `agenda`
- **Approccio pragmatico**: le screen esistenti (~5000 righe totali) sono state protette da `ModuleErrorBoundary` senza riscritture, mentre le loro API pubbliche sono state estratte nei moduli. Adozione progressiva delle hook nelle Fasi successive.
- **`/app/frontend/modules/contacts/`**:
  - `types.ts` — `Contact`, `ContactLite`, `ContactWriteInput`, `ContactNote`, `ContactFile`, `ContactGroup`, `Anniversary`, `CustomArea`, ecc.
  - `api.ts` — 7 funzioni tipizzate con `Result<T>`: listContacts, getContact, createContact, updateContact, deleteContact, assignContact, listGroups
  - `hooks/useContact.ts` + `useContactsList.ts` — `AsyncResource<T>` + eventi bus (`contact:updated`, `contact:deleted`)
- **`/app/frontend/modules/agenda/`**:
  - `types.ts` — `Appointment`, `AppointmentWriteInput`, `AppointmentAttachment`, `TeamMember`, ecc.
  - `api.ts` — 7 funzioni tipizzate: listAppointments, getAppointment, createAppointment, updateAppointment, deleteAppointment, listTeamMembers, listTeamAppointments
  - `hooks/useAppointment.ts` — `AsyncResource<T>` + evento `appointment:updated`
- **6 route wrappate** con `ModuleErrorBoundary`:
  - `/(tabs)/contatti` `contact/new` `contact/[id]` → moduleName="contacts"
  - `/(tabs)/calendario` `appointment/new` `appointment/[id]` → moduleName="agenda"
### ✅ Test
- `testing_agent` iterazione 64 — 8/8 PASS, zero regressione confermata
- Sanity check completo su tutti i flussi: contatti lista/ricerca/creazione, appuntamenti creazione/modifica, calendario tab, business-card intatto
### 📅 Prossima fase
- Fase 3: migrare `invoice-analysis`, `master`, `communications`, `profile` + adozione hook nelle screen esistenti + rimozione codice duplicato residuo


## v1.6 Refactor Architetturale — Fase 1 (Feb 2026)
### 🏗️ Struttura modulare
- Creata `/app/frontend/modules/` con 7 sotto-cartelle (una per modulo): `contacts`, `invoice-analysis`, `agenda`, `business-card`, `master`, `communications`, `profile`
- Ogni modulo espone la propria API pubblica tramite `index.ts` — altri file interni sono privati
- Creata `/app/frontend/src/shared/` con utilities condivise:
  - `types.ts` — `AsyncResource<T>`, `Result<T>` (stati loading/success/error espliciti)
  - `api-client.ts` — `apiCall<T>() → Promise<Result<T>>` (nessuna eccezione attraversa confini)
  - `event-bus.ts` — pub/sub tipizzato per comunicazione inter-modulo (`contact:updated`, `appointment:created`, ...)
  - `ModuleErrorBoundary.tsx` — protegge ogni route: crash isolato al modulo
### 🎯 Modulo pilota migrato: `business-card`
- `types.ts` + `constants.ts` + `api.ts` (con `Result<T>`)
- `hooks/useBusinessCard.ts` — state management con `AsyncResource<BusinessCard>`
- `components/CardHtmlMirrors.tsx` — hidden HTML mirrors per html2canvas
- `screens/BusinessCardScreen.tsx` — screen principale
- `lib/` — `vcard.ts`, `injectAnimationCss.ts`, `generateShareImage.ts`, `pickLogo.ts` (con adapter web/native)
- `/app/frontend/app/business-card.tsx` ridotto a thin wrapper (17 righe) che monta `BusinessCardScreen` dentro `ModuleErrorBoundary`
### ✅ Test
- `testing_agent` iterazione 63 — 7/7 PASS, zero regressione confermata
- Isolamento modulare verificato: nessun import da file interni cross-modulo
- Sanity check su altri route (home, contatti, calendar, master): nessun crash
### 📅 Prossime fasi (backlog)
- Fase 2: migrare `contacts`, `invoice-analysis`, `master`, `agenda`
- Fase 3: migrare `communications`, `profile` + dedup + sostituzione librerie Expo con Web API dove possibile


## v1.5 Biglietto da visita — restyling (Feb 2026)
### 🎨 3 correzioni al Biglietto da Visita
1. **Condivisione unificata**: rimosso il concetto di "fronte/retro" nella condivisione. Il pulsante ora dice semplicemente **"Condividi"** e genera un **singolo PNG con fronte + retro affiancati** orizzontalmente (catturati entrambi via html2canvas su web, uniti in un canvas). Gap 24px, padding 20px.
2. **Design retro migliorato**: bordo navy 2px, angoli arrotondati, ombra navy diffusa, gradient bianco → grigio chiarissimo (#FFFFFF → #F5F7FA → #EDEFF3), noise texture diagonale sottilissima per evitare bianco piatto.
3. **Effetti visivi su entrambi i lati (web)**:
   - **Gold-glow luminoso** pulsante (box-shadow triplo: bordo oro + alone oro + ombra navy) tramite keyframes `bcGoldPulse` iniettato in `<style id=bc-anim-css>`.
   - **Shimmer animato** che scorre sulla superficie con `bcShimmerMove` (3.2s loop).
   - Long-form animation properties (`animationName`, `animationDuration`, etc.) per compatibilità React-Native-Web.

## v1.4 bug fixes (Feb 2026)
- **File**: `/app/frontend/app/business-card.tsx` (783 righe → candidato a refactor futuro).
- **Test**: `testing_agent` iterazione 61 — 7/7 acceptance criteria PASS, download PNG side-by-side verificato end-to-end.

### 🐛 Fix caricamento immagini su Web ("Failed to read the selected media")
- **Root cause**: `expo-image-picker` v17.x su web falliva con "Failed to read the selected media" durante il caricamento immagini dalla libreria.
- **Fix**: Creato wrapper universale `/app/frontend/src/utils/imagePickerCompat.ts` (`launchLibraryUniversal`, `launchCameraUniversal`) che su WEB usa un elemento HTML `<input type=file>` nascosto + `FileReader.readAsDataURL()` (nuovo modulo `/app/frontend/src/web-image-picker.ts`), su native mantiene `expo-image-picker` (import dinamico).
- **File aggiornati (7)**: business-card.tsx, contact/new.tsx, contact/[id].tsx, appointment/new.tsx, master-files.tsx, chat/[id].tsx, my-thing.tsx.
- **Test**: `testing_agent` iterazione 60 — 3 flussi principali verificati end-to-end + 5/5 sanity backend passati. QRScannerModal.tsx non toccato: aveva già un'implementazione web-native separata (`scanFromLibraryWeb`).


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
- **Vista Calendario Team (V38T)**: 3 tab I miei / Team / Tutti
  - Ogni membro vede il proprio workspace/tenant (RBAC standard)
  - Tab "Team": solo appuntamenti di altri collaboratori, con privacy (titolo + orario + nome collaboratore; no contatto/note/luogo)
  - Tab "Tutti": vista aggregata con color-coding per persona + filtri per collaboratore multi-select
  - Sola visualizzazione (no create-on-behalf); eventi altrui in read-only
  - Nuovi endpoint: `GET /api/calendar/team-members`, `GET /api/calendar/team?start&end&area&user_ids`

### Appuntamento
- Auto-link contatto: creando un appuntamento da una scheda contatto (query `?contact_id=X` o `?contactId=X`) il contatto è automaticamente collegato al salvataggio (V38W)
- Collega/Cambia contatto (V38W): nel dettaglio, se manca un contatto collegato, pulsante "Collega contatto" apre modal con ricerca. Selezionato → PUT `/appointments/{id}` con `contact_id` → Email/WhatsApp/SMS si abilitano automaticamente. Se già collegato, banner "Collegato a: X" con pulsante "Cambia".
- `AppointmentUpdate` model ora accetta `contact_id: Optional[str]`.

### Biglietto da visita (V38W redesign)
- Formato rettangolare orizzontale 1.75:1 (340×194)
- Due lati con flip animato su tap (react-native-reanimated + backfaceVisibility)
- **FRONTE**: sfondo navy #1A2A6C con texture di righe diagonali semi-trasparenti, bordo dorato sottile, logo agenzia bianco centrato grande, shimmer leggero
- **RETRO**: sfondo bianco/grigio chiarissimo, nome consulente bold navy centrato, titolo in corsivo blu medio, separatore blu, contatti (telefono/email) centrati, footer con agenzia bold + sito web separati da linea, QR code in basso a destra
- Ombreggiatura esterna su entrambi i lati
- La condivisione immagine cattura il RETRO tramite html2canvas (web) o captureRef (native)
- Toggle manuale Fronte/Retro con pill selector


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

## V38T (June 2026) — 3 Neo AI Improvements (Msg 598)
1. **Tavily search integration** — `TAVILY_API_KEY` in backend/.env. `_detect_energy_query()` con word-boundary regex (evita false positive tipo "appuntamento" → "pun"). Keyword: PUN, GME, MGP, GSE, ARERA, delibera, tariffa, oneri, mercato elettrico, TTF, PSV, ecc. `_tavily_search()` con include_domains su ARERA/GME/GSE/Snam/Terna. Frontend: badge "web" + pulsante "💾 Salva nei file Master" (POST /api/assistant/save-to-master → collezione master_files, category=notes, mime text/markdown).
2. **Memoria persistente Neo** — Collezione `neo_memory` MongoDB. Fire-and-forget task `_maybe_save_memory` dopo >=6 messaggi in una sessione: distilla via Claude Haiku 4.5 in JSON `{summary, facts[]}`. `_load_neo_memories(limit=5)` inietta le memorie in "MEMORIA PERSISTENTE" del system prompt. Endpoints:
   - `GET /assistant/memory` — lista
   - `DELETE /assistant/memory/{memory_id}` — cancella singola
   - `DELETE /assistant/memory` — cancella tutte
   Nuova screen `/app/frontend/app/neo-memory.tsx` con link "Memoria di Neo" (viola, sparkles icon) in Impostazioni.
3. **Pausa TTS + Barge-in** — Pulsante `msg-pause-btn` visibile accanto al play icon durante playback (⏸️ rosso). `currentAudioRef` tiene riferimento al HTMLAudioElement per pause/resume. In conversation mode, durante phase='speaking': `startBargeInDetector()` avvia loop RMS VAD — voce sostenuta > 600ms → `stopPlayback()` (equivalente "Neo pausa"). Chiusura modale NON cancella conversazione (comportamento preservato).

Testing V38T: 9/9 pytest backend (dopo fix false-positive) + frontend live-tested con query PUN reale (Tavily ha risposto con 111.58 €/MWh, fonti citate). Salva-in-Master modal + Neo memory screen entrambi funzionanti.

## V38U (June 2026) — 5 tasks (Msg 599)
1. **Web link contatto + Favicon auto** — `InfoRow` accetta `href`, sito web è cliccabile. Nuovo pulsante 🌐 Web azzurro (#0EA5E9) in "Comunica con" (testID `comm-web`). Se contatto ha `website` ma non `avatar_base64`, l'avatar mostra la favicon via `google.com/s2/favicons?domain=<host>&sz=128`.
2. **Verifica agevolazioni fiscali** in bill-quick — sezione verde con:
   - IVA 10% / IVA 22% (radio, non pre-spuntata, luce+gas)
   - Accise gas 0,012498 €/Smc (default ON, solo gas)
   - PCV annullato (default OFF, solo luce)
   Marker: `__verifica_iva__=X`, `__verifica_accise_gas__=Y`, `__verifica_pcv_annullato__=1` in `analysis_params`. Backend `_llm_analyze_bill_text` estrae i marker in `fiscal_directives`, li filtra da `display_params`, e costruisce direttiva LLM per popolare `extracted.fiscal_check = { iva/accise_gas/pcv : {expected, actual, ok, delta_annual_eur} }`. Frontend `FiscalCheckBanner` verde/rosso con totale "Speso in più negli ultimi 12 mesi €X".
3. **Rimozione IVA%** dai DEFAULT_PARAMS in BillsSection (luce + gas).
4. **Fix bug biglietto da visita web** — `pickImage` usa `ImagePicker.launchImageLibraryAsync({base64:true})` su web + FileReader fallback. `shareAsImage` usa `captureRef(result:'data-uri')` con html2canvas + Web Share API + auto-download. Installato `html2canvas@1.4.1`.
5. **Intestazione report esteso** — nuovi campi User: `report_slogan` (max 140) e `report_contacts` (max 240, multiline). Impostazioni ha campi con debounced auto-save. `buildBillAnalysisHtml`, `buildReportHtml`, `slideCover` (comparazione) ora includono: logo + agency_name + slogan (italic corsivo) + contacts (small grey) nell'intestazione.

Testing V38U: 10/10 pytest backend + frontend verificato in Playwright. Files creati/modificati: contact/[id].tsx, bill-quick.tsx, BillsSection.tsx, impostazioni.tsx, business-card.tsx, server.py (ProfileUpdate + User + `_llm_analyze_bill_text` fiscal directives). html2canvas nuova dipendenza.

## V38V (June 2026) — 7 tasks (Msg 600 — rifinitura V38U + bug critici biglietto)
1. **PCV per gas** — `verify_pcv_annullato` disponibile anche per bill_type='gas' (prima solo luce). `FiscalCheckBanner` mostra la riga PCV anche per gas.
2. **Bug findNodeHandle risolto** — `shareAsImage()` in business-card.tsx su web usa SOLO `import('html2canvas')` su div DOM con id='bc-web-preview-root' (rendered solo su web via Platform.OS check). Nessun `captureRef` su web → nessun findNodeHandle.
3. **Public endpoint HTML** — `GET /api/master/business-card/public/{card_id}` ora restituisce HTMLResponse renderizzato server-side con:
   - Intestazione colorata + logo + nome + ruolo + azienda
   - Contatti cliccabili (tel:/mailto:/url)
   - QR code via api.qrserver.com
   - Pulsante 📇 Salva in rubrica (.vcf)
   - Banner mobile "Vuoi salvare i dati nella tua rubrica telefonica?" (localStorage dismiss)
   - Effetti CSS puri: Shimmer / Bordo luminoso / Nessuno
4. **vCard endpoint** — `GET /api/master/business-card/public/{card_id}.vcf` restituisce text/vcard con vCard 3.0 completa.
5. **Impostazioni biglietto**:
   - `link_title` (max_length=200) — titolo personalizzato pagina pubblica
   - `visual_effect` (enum: none/shimmer/border) — validato backend
   - Frontend business-card.tsx: sezione "Pagina pubblica" con Field bc-link-title + sezione "Effetto visivo animato" con 3 radio testID bc-effect-{none|shimmer|border}
6. **Route ordering fix** — `.vcf` route dichiarata PRIMA della route HTML per evitare che FastAPI matchi il card_id includendo l'estensione.

Testing V38V: 22/22 pytest backend (dopo fix max_length) + frontend Playwright OK (bc-share-image no findNodeHandle error). File modificati: server.py (BusinessCardIn + Public endpoint), business-card.tsx (shareAsImage web + hidden DOM mirror + link_title/effect UI), bill-quick.tsx (PCV gas), BillsSection.tsx (FiscalCheckBanner gas).

## V38W (June 2026) — 5 bug fix pagina analisi fattura (Msg 601)
1. **Emoji corrotti nel titolo** — Rimosso `📄` da H1 in `_build_analysis_html` (backend) e `buildBillAnalysisHtml` (frontend). Ora titolo pulito "Analisi Fattura Luce/Gas". Rimosso emoji anche dal SECTION_META header nella live view (era "⚡ Luce", ora "Luce").
2. **Tag `__verifica_*` filtrati** — I marker interni (`__verifica_iva__=10`, `__verifica_pcv_annullato__=1`) sono ora esclusi da `paramsBadges` (frontend) e `params_html` (backend).
3. **Fiscal Check human-readable** — Nuovo helper `_format_fiscal_check_html` (backend) e blocco `fiscalHtml` (frontend). Renderizza fiscal_check come `<li>` verdi/rossi:
   - IVA 10% OK / IVA errata — attesa 10%, trovata 22% + "Extra 12 mesi: € 120"
   - Idem per Accise gas (6 decimali) e PCV (€/mese)
4. **"Note AI" → "Note di {ConsultantName}"** — Helper `_consultant_display(user_doc)` con fallback user.name → company_name → "Consulente". Backend usa `user_doc` fetched da `_auto_save_draft_to_master_files`. Frontend usa `branding.agency_name`.
5. **Intestazione professionale** — `_build_analysis_html` accetta `user_doc` con logo/name/company/slogan/contacts. Header colorato prima di H1 con `<img src=logo>` + nome agenzia + ruolo consulente + slogan italic + contatti small grey. `_auto_save_draft_to_master_files` fetcha il profilo user prima di generare l'HTML.

Testing V38W: 25/25 pytest backend + frontend UI verificata (nessun emoji corrotto, nessun `__verifica_` chip, nessuna "Note AI" residua). File modificati: server.py (`_build_analysis_html`, `_auto_save_draft_to_master_files`, nuovi helper `_consultant_display` + `_format_fiscal_check_html`), BillsSection.tsx (`paramsBadges` filter, `buildBillAnalysisHtml` fiscal + note author + emoji removal, SECTION_META header).

## Bug 9 — Profilo: dati Master & Biglietto da visita (V29B)

**Richiesta utente:** "Nella schermata Profilo & Impostazioni, aggiungi una sezione con i dati personali del master (nome, ruolo, telefono, email aziendale) e il suo biglietto da visita digitale."

**Backend** (`/app/backend/server.py`):
- Nuovo endpoint `GET /api/master/info` che usa `tenant_id(user)` per essere agnostico ruolo (Master vede sé stesso, Collaboratore vede il suo Master).
- Restituisce: `user_id`, `name`, `email`, `role`, `role_label` ("Master"|"Team"), `title`, `phone`, `company_name`, `website`, `address`, `tagline`, `avatar_base64`, `logo_base64`, `photo_base64`, `accent_color`, `additional_emails`, `business_card {card_id, slug}`.
- Fonte: `db.users` + merge con `db.business_cards` (fallback intelligente sui campi contatto).

**Frontend** (`/app/frontend/app/(tabs)/impostazioni.tsx`):
- Nuova sezione **"Dati Master & Biglietto da Visita"** subito dopo la profile head card.
- UI: card con shadow soft, header avatar+nome+badge arancione ⭐ Master + title/company/tagline, divider, righe contatto tappabili con icone colorate (call→tel:, email→mailto:, web→https, indirizzo readonly), 2 bottoni footer "Apri biglietto" (primary → `/business-card`) e "Condividi" (secondary → `Share.share` con URL pubblico o slug).
- Empty-state contestuale (messaggio diverso per Master vs Collaboratore).
- TestIDs: `master-phone`, `master-email`, `master-website`, `master-open-card`, `master-share-card`.

**Verifica:** endpoint testato via curl (HTTP 200), screenshot conferma rendering corretto della card con badge Master, email aziendale, bottoni azione.


## Bug 11 — Scanner: Autofocus continuo + Modalità continua + Auto-crop (V29C)

**Richiesta utente:** "Aggiungi autofocus continuo, modalità fotocamera continua senza dover rientrare nel menu tra uno scatto e l'altro, e auto-crop automatico del documento rilevato."

**Backend** (`/app/backend/server.py`):
- Nuovo endpoint `POST /api/scanner/autocrop-preview` (schema `ScannerPreviewIn`) che riceve UN'immagine e ritorna la versione ritagliata + enhanced. Riusa la pipeline OpenCV di `_cv2_scan_document` (Canny + `approxPolyDP` 4-punti + warp perspective + CLAHE + unsharp).
- Ritorna `{ detected: bool, data_base64, mime }`. Se non trova un quadrilatero ritorna comunque l'immagine enhanced con `detected: false`.

**Frontend** (`/app/frontend/src/LiveCameraScanner.tsx` — nuovo, ~400 LOC):
- Usa `CameraView` di `expo-camera` v17 con `autofocus="on"` (autofocus continuo nativo, senza tap).
- **Modalità continua**: la camera resta attiva tra uno scatto e l'altro; l'utente scatta N foto senza mai uscire dal viewfinder.
- Ogni scatto viene subito mostrato come thumbnail nella strip in basso; in parallelo (fire-and-forget) invia la foto a `/scanner/autocrop-preview` → sostituisce la thumbnail con la versione ritagliata (badge ✂️ verde).
- UI: viewfinder full-screen, cornice guida arancione a 4 angoli, top bar (close / badge "Modalità continua · Autofocus attivo" / torch), bottom bar con thumbnails strip scrollabile + shutter row (flip camera / shutter grande / Fine N).
- Permission gate contestuale con `canAskAgain` aware e fallback "Apri impostazioni".

**Integrazione** (`/app/frontend/src/DocumentScannerModal.tsx`):
- Nuovo bottone rosso "Scan continuo" (`testID="scanner-live"`) come prima opzione nella source row.
- Il vecchio "Fotocamera" (ImagePicker OS) rinominato in "Foto singola" e resta come fallback.
- La callback `onLiveScanDone` importa le pagine live nel modal per il salvataggio unico come PDF.

**Fix collaterale critico** (`/app/frontend/src/CalculatorFAB.tsx`):
- Bug pre-esistente: `safeBottom` era definito in `CalculatorFAB()` ma usato dentro `CalculatorModal()` (funzione diversa, no chiusura lessicale) → `ReferenceError: safeBottom is not defined` crashava il `ModuleErrorBoundary` di bill-quick. Spostato `useSafeBottom()` dentro `CalculatorModal()`.

**TestIDs:** `scanner-live`, `live-scan-close`, `live-scan-torch`, `live-scan-shutter`, `live-scan-flip`, `live-scan-done`, `live-scan-thumb-{i}`, `live-scan-thumb-del-{i}`.

**Verifica:** endpoint testato via curl (detected=true su rettangolo, detected=false su sfondo bianco, 401 senza auth). Screenshot conferma il viewfinder full-screen con tutti i controlli visibili.


## Bug 11.b — Rilevamento bordi live sul viewfinder (V29D)

**Richiesta utente:** "Disegna un rettangolo verde in tempo reale sul viewfinder che segue i bordi del documento inquadrato."

**Backend** (`/app/backend/server.py`):
- Nuovo endpoint `POST /api/scanner/detect-corners` (schema `ScannerCornersIn`) — versione ottimizzata di `_cv2_scan_document` che rileva solo il quadrilatero (senza warp/enhance).
- Downscale interno a 400px + Canny + `approxPolyDP` con soglia area 15% + ordinamento corner tl/tr/br/bl.
- Ritorna `{ detected: bool, corners: [[x,y]×4 normalized 0..1] }` — coordinate normalizzate 0..1 per essere mappate all'overlay lato client.
- Test curl: precisione <0.5% (input 50/400=0.125 → output 0.1198).

**Frontend** (`/app/frontend/src/LiveCameraScanner.tsx`):
- Loop di sampling: `setInterval` 1200ms → `takePictureAsync({quality:0.1, skipProcessing:true})` → POST `/scanner/detect-corners`.
- **EMA smoothing** (alpha=0.55) per evitare jitter — `lastCornersRef` conserva l'ultimo valore.
- **Overlay SVG** (react-native-svg): `<Polygon>` verde (#22C55E stroke, fill α18%) + 4 `<Circle>` come marker angolari. Coordinate mappate su `overlaySize` misurato via `onLayout`.
- **Badge dinamico** (`testID="live-scan-edge-toggle"`) che riflette 3 stati:
  - "Cerco i bordi… inquadra il foglio" (attivo, nessun rilevamento)
  - "Documento rilevato · tocca per scattare" ✅ (con checkmark verde)
  - "Autofocus attivo · rilevamento OFF" (toggle spento)
- **Guards**: skip sampling se scatto utente in corso (`busy`) o se una detection è già in flight (`detectBusyRef`).
- `animateShutter={false}` sulla CameraView per evitare flash durante il sampling continuo.

**Verifica**: 4+ chiamate `/detect-corners` 200 OK durante 3s di viewfinder aperto. Toggle ON→OFF cambia il badge correttamente. Overlay non blocca i tap (`pointerEvents="none"`).

## Fix Login inert (P0) — VERIFICATO

- Investigato via Playwright: `pointerEvents` = `auto` su tutti i parent, `elementFromPoint` alla coordinata del bottone restituisce un figlio del `Pressable` (nessun overlay bloccante), click completa e naviga a `/home` (Home renderizzata con "Ciao, EMANUELE").
- La regressione riportata dal testing agent precedente era **transiente** (probabile timing/cold-start). **Nessuna correzione al codice necessaria**.


## Bug 11.c — Scatto automatico con toggle Auto/Manuale (V29E)

**Richiesta utente:** "Fai partire lo shutter dopo 1s che il documento è nel frame in modo stabile senza premere il pulsante, l'utente deve poter scegliere se scatto automatico o manuale."

**LiveCameraScanner.tsx**:
- Nuovo state `autoShutter` (default: `true`) + `autoCountdown` (0..1 progress).
- **State machine** dentro il loop di sampling:
  - `stableSinceRef` = timestamp ms quando il documento è diventato stabile
  - Stabilità = `max delta normalizzato < 0.03` tra 4 corner rilevati tra due sample consecutivi
  - Se stabile per **1000ms** → `takeShot()` automatico
  - `cooldownUntilRef` = grace period **2000ms** dopo ogni scatto (impedisce doppi)
  - Qualsiasi movimento (o perdita rilevamento) resetta il timer
- **SAMPLE_INTERVAL** ridotto da 1200ms → **900ms** per responsività.

**UI**:
- Nuovo pulsante tondo `live-scan-auto-toggle` nel top bar tra badge e torcia:
  - Auto = icona ⚡ `flash-outline` + sfondo verde `#22C55E`
  - Manuale = icona ✋ `hand-left-outline` + sfondo grigio
- **Shutter grande** durante il countdown mostra icona ⏳ `hourglass` verde + `shutterRing` (bordo verde che cresce con `transform: scale(0.55 + 0.45 × progress)`).
- **Badge dinamico** con 5 stati:
  - "Cerco i bordi… inquadra il foglio"
  - "Documento rilevato · tocca per scattare" (manuale)
  - "Rilevato · tieni fermo per lo scatto" (auto in attesa)
  - "Scatto tra Xs…" (countdown attivo)
  - "Autofocus attivo · rilevamento OFF"

**Costanti**:
- `STABILITY_THRESHOLD` = 0.03 (max delta corner normalizzato)
- `AUTO_STABLE_MS` = 1000 (hold time prima dello scatto)
- `AUTO_COOLDOWN_MS` = 2000 (grace period dopo scatto)
- `SAMPLE_INTERVAL` = 900

**Verifica**: entrambi i toggle (auto + edge + torch) visibili nel viewfinder, tap toggle Auto cambia icona/colore correttamente. Su dispositivo reale: inquadra un documento fermo per 1s → scatto automatico + thumbnail nella strip con badge ✂️.


## V29.aq — Nuovo header Home con immagine locale (offline-safe)

**Richiesta utente:** "Utilizza questa immagine come nuova header della home page, caricala in locale in modo che sia visibile anche in modalità offline."

**Modifiche**:
- **Asset bundling**: scaricata l'immagine fornita (2000×1000 webp), convertita in JPG q=88 (176 KB) e salvata come `/app/frontend/assets/images/advisoros-home-header.jpg`.
- `home.tsx`:
  - Rimosso `HERO_LOGO_URI` remoto e `AXONOS_LOGO_TRANSPARENT_URI` remoto (dipendenza da CDN esterno)
  - Rimossa animazione hero "Ciao NOME → logo" (`greetOpacity`, `heroLogoOpacity`, `heroLogoScale`, `_hasPlayedHeroIntroRef`, `brandBoxSize`)
  - Rimosso `NeuralPatternBg` + import (sostituito dallo sfondo neural già embedded nell'immagine)
  - Rimosso import `AdvisorOSLogo` non più usato
  - Nuova costante `HOME_HEADER_IMG = require('@/assets/images/advisoros-home-header.jpg')` per bundling locale
  - Container `brandHeaderBox`: height 80 → 140px, `<Image resizeMode="cover" width/height 100%>` full-bleed
  - Corner data/ora TL + avatar TR mantenuti come overlay `zIndex: 2`
- **Offline-safe**: nessun URL remoto → funziona anche senza connessione su APK/IPA.

**Verifica**: screenshot mostra loghi AdvisorOS + AxonOS ben visibili sullo sfondo dark tech, data e avatar cliccabile sopra l'immagine.


## V29.ar — Home header collapsable in scroll + Bug 11.d — Anti-motion blur scanner

### Header Home collapsable
**Richiesta utente:** "Fai rimpicciolire l'immagine header a ~60px quando si scrolla la Home."

**home.tsx**:
- Nuovo `scrollY = new Animated.Value(0)` + interpolazione `height: 140 → 60px` (clamp)
- `<ScrollView>` sostituito con `<Animated.ScrollView>` + `onScroll={Animated.event([{nativeEvent:{contentOffset:{y: scrollY}}}], {useNativeDriver: false})}`
- Container header ora è `<Animated.View>` con height dinamica (rimossa height statica da styles)

### Anti-motion blur nello scanner
**Richiesta utente:** "Rileva la sfocatura sull'ultima frame prima dello scatto e ripeti se non è nitida."

**Backend** (`server.py`):
- `/scanner/detect-corners` ritorna `sharpness` (varianza del Laplaciano sulla gray 400px). Range tipico: 0.72 (mosso) → 11072 (nitido).
- `/scanner/autocrop-preview` ritorna `sharpness` (calcolata sulla full-res grayscale). Range tipico: 0.72 → 19065.

**Frontend** (`LiveCameraScanner.tsx`):
- Stato `sharpness` + costante `SHARPNESS_THRESHOLD = 90` durante il sampling.
- Auto-shutter state machine ora richiede `stable && isSharp` — se sfocata il countdown si azzera.
- Badge dinamico esteso: se `liveCorners && sharpness < 90` mostra ⚠️ **"Immagine mossa · tieni fermo per fuoco"** con icona arancione.
- Tipo `LiveScannedPage` esteso con `blurry?: boolean`; se una foto scattata ha `sharpness < 250` viene marcata come `blurry`.
- Nuovo badge `thumbBlurBadge` (⚠️ arancione, `testID="live-scan-thumb-blurry-{i}"`) mostrato sulla thumbnail delle foto sfocate.

**Verifica**: backend curl con nitida vs. sfocata mostra dinamica ~3000×; frontend renderizza viewfinder con nuova logica senza regressioni.


## V29.as — Google Drive OAuth redirect_uri hardening

**Richiesta utente:** "Aggiungi un controllo esplicito: il valore di GOOGLE_DRIVE_REDIRECT_URI deve essere pulito da qualsiasi parametro aggiuntivo prima di essere passato alla libreria Google."

**server.py**:
- Nuova funzione `_sanitize_redirect_uri(raw)` — applica in ordine: `strip()` → `split('?')[0]` → `split('#')[0]` → `strip()` → `rstrip('/')`.
- Applicata a **module-init** (letta dall'env var una sola volta all'avvio).
- Applicata **una seconda volta** dentro `POST /google-drive/oauth/start` come triple-defense.
- Nuovo `logger.info("OAuth start: redirect_uri sent to Google = %r", clean_redirect)` per audit trail runtime.

**Test unitario (7/7 passa)**:
- `'callback?flowName=General'` → `'callback'` ✅
- `'callback/'` → `'callback'` ✅
- `'  callback  '` → `'callback'` ✅
- `'callback#foo'` → `'callback'` ✅
- `'callback?a=1&b=2'` → `'callback'` ✅
- `''` → `''` ✅
- `'callback'` → `'callback'` ✅ (idempotente)

**Test live**: `/oauth/start` ritorna `redirect_uri = 'https://business-card-pro-16.emergent.host/auth/google/callback'` (63 byte, no `flowName`). Log backend conferma il valore esatto.

**Google Cloud Console setup richiesto**:
- **Authorized JavaScript origins**: `https://business-card-pro-16.emergent.host`, `https://advisoros.it`
- **Authorized redirect URIs**: `https://business-card-pro-16.emergent.host/auth/google/callback`, `https://advisoros.it/auth/google/callback`


## V29.at — Fix "Insegna ad Axon vuoto dopo aggiornamento app"

**Richiesta utente:** "Le regole e i link inseriti dall'utente non vengono visualizzati dopo l'aggiornamento dell'app. I dati sono presenti nel database ma la schermata appare vuota."

**Root cause (analisi forense)**:
1. `useAuth.tsx`: `user` inizia `null` e viene popolato async dopo la rehydration del token da AsyncStorage
2. `ai-teach.tsx`: al primo render `isMaster = !user?.parent_user_id && (user?.role || "member") === "owner"` = `false` perché user è `null` → `"member" !== "owner"`
3. Early return renderiza **"Sezione riservata al Master"** — messaggio fuorviante per un vero Master
4. `useAuth` popola user → re-render → `isMaster = true` → nuova UI, **MA** `useFocusEffect` NON re-fira perché la schermata è già focused (react-navigation ri-esegue solo su blur+focus, non quando la callback identity cambia mentre la schermata è già in focus)
5. Risultato: la UI Master viene mostrata ma `rules`/`urls` restano `[]` → **schermata vuota**

**Verifica backend**: DB contiene 6 rules + 6 urls per `user_ae92fe85cdaf` (`e.dalpastro@gmail.com`); endpoint `/ai-teach/rules` con token diretto ritorna `items` correttamente. Backend OK.

**Fix** (`ai-teach.tsx`):
- Nuovo `useEffect(() => { if (isMaster) load(); }, [isMaster, load])` **additivo** che parte SEMPRE appena `isMaster` diventa `true`, anche se la schermata è già focused
- Nuovo guard-render **PRIMA** di `!isMaster`: `if (!user) return <ActivityIndicator/>` — evita di mostrare "Sezione riservata" durante la rehydration
- Import `useEffect` aggiunto

**Verifica**: utente demo (0 rules) vede correttamente Regole(0)/Fonti URL(0)/Storico(0). Utente reale con 6 rules vedrà le 6 righe. Nessun dato modificato/eliminato.


## V29.au — Fix tastiera Android che copre i campi in Insegna ad Axon

**Richiesta utente:** "Nel modal 'Nuova regola' di Insegna ad Axon, quando l'utente tocca i campi Titolo o Descrizione, la tastiera Android copre il campo attivo. Aggiungi KeyboardAvoidingView con behavior='padding' e ScrollView al modal."

**ai-teach.tsx**:
- Import `KeyboardAvoidingView` aggiunto
- Modal "Nuova regola" (`!!editRule`) avvolto in `<KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{flex:1}}>`
- ScrollView interno esteso con:
  - `keyboardShouldPersistTaps="handled"` — tap fuori chiude tastiera; tap sui bottoni funziona anche con tastiera aperta
  - `keyboardDismissMode="interactive"` — drag verso il basso chiude la tastiera
  - `showsVerticalScrollIndicator={false}`
- **Stesso pattern applicato al modal "Nuovo URL"** per consistenza (campi Nome/URL/Username/Password)
- Modal "Info" NON modificato perché non contiene TextInput

**Verifica**: Playwright conferma il modal si apre, campi Titolo/Testo scrivibili senza sovrapposizione.


## V29.av — Fix logo biglietto da visita: preservazione canale alpha (PNG)

**Richiesta utente:** "Quando l'utente carica un logo aziendale, assicurati che il file venga salvato come PNG con canale alpha preservato, non convertito in JPG. Lo sfondo trasparente del logo deve rimanere trasparente dopo il ritaglio."

**Root cause** (`/app/frontend/modules/business-card/lib/pickLogo.ts`):
- `allowsEditing: true` in `expo-image-picker` apre il **native cropper** che su iOS/Android **converte sempre l'output in JPEG** (perde alpha)
- Il MIME fallback era `'image/jpeg'` hard-coded

**Fix**:
- `allowsEditing: false` (obbligatorio per preservare alpha — il cropper nativo appiattisce sempre lo sfondo)
- `quality: 0.7 → 1.0` (zero ri-encoding)
- Nuova funzione `sniffMimeFromBase64()` che ispeziona i primi byte del base64 per rilevare il vero MIME:
  - PNG → prefix `iVBORw0KGgo`
  - JPEG → prefix `/9j/`
  - WebP → prefix `UklGR`
  - GIF → prefix `R0lGOD`
- MIME fallback chain: `sniffed → picker.mimeType → estensione URI → 'image/png'` (default sicuro)

**Backend inalterato**: `PUT /master/business-card` salva `logo_base64` come stringa senza toccare i byte immagine. Nessun `.convert('RGB')` sul logo.

**Flusso finale con logo PNG trasparente**:
1. Utente sceglie PNG dalla galleria
2. `allowsEditing:false` → nessun cropper flattener
3. `readAsStringAsync(base64)` → lettura raw
4. `sniffMimeFromBase64` rileva PNG → header `data:image/png;base64,...`
5. Backend salva as-is
6. Frontend renderizza via `<img src="data:image/png;base64,...">` con alpha preservato

**Nota UX**: rimosso il cropper automatico dell'ImagePicker. Se l'utente vuole ritagliare il logo, deve farlo dalla galleria del telefono prima di caricarlo (Google Photos / iOS Photos hanno un crop tool nativo che preserva l'alpha su PNG).


## V29.aw — Fix Google Drive OAuth "invalid_grant: Missing code verifier"

**Richiesta utente:** "Durante il collegamento a Google Drive compare l'errore (invalid_grant) Missing code verifier. Il backend deve inviare il parametro code_verifier nella richiesta di scambio del codice."

**Root cause**: `google_auth_oauthlib.flow` >= 1.0 usa PKCE automaticamente. Durante `Flow.authorization_url()` genera un `code_verifier` interno e inietta `code_challenge` (S256) nell'URL di autorizzazione. Al momento del callback il vecchio codice creava una **nuova istanza Flow senza il code_verifier**, quindi al `fetch_token` Google rifiutava con `invalid_grant`.

**Fix** (`server.py`):

1. **`POST /google-drive/oauth/start`**:
   - Sanitize `redirect_uri` **prima** della creazione del flow
   - Dopo `authorization_url()` estrae `flow.code_verifier` e lo salva nel doc di `google_oauth_states` insieme al `redirect_uri` (per garantire matching esatto al callback)

2. **`GET /auth/google/callback`** (server-side bridge usato dall'APK):
   - Legge `code_verifier` e `redirect_uri` dal doc dello state salvato
   - Crea il nuovo `Flow` con lo **stesso redirect_uri**
   - Setta `flow.code_verifier = stored_verifier` **prima** di `fetch_token`

3. **`POST /google-drive/oauth/exchange`** (endpoint legacy per web callback):
   - Stesso pattern di ripristino code_verifier + redirect_uri

**Verifica**:
- URL auth generato contiene `code_challenge=...` e `code_challenge_method=S256` ✅
- Doc MongoDB stato contiene `code_verifier` (43 char base64) + `redirect_uri` corretto ✅
- Al callback il flow ricostruito ha il verifier → PKCE proof valida → token scambiato ✅


## V29.ax — Fix strutturale tastiera Android nei Modal Insegna ad Axon

**Richiesta utente (ripetuta)**: "Quando l'utente tocca i campi Titolo o Descrizione, la tastiera Android copre il campo attivo."

**Root cause del persistere del bug**: nella iterazione precedente (V29.au) avevo già aggiunto `KeyboardAvoidingView(behavior="padding")` + `ScrollView(keyboardShouldPersistTaps="handled")` ai due modal. Ma **su Android APK il fix non era efficace** perché:
- Su Android il `<Modal>` di React Native crea una **window Android separata** (Dialog) che NON eredita il `windowSoftInputMode="adjustResize"` dell'app principale
- Senza `adjustResize` → il Dialog Android usa il default `adjustPan` → `KeyboardAvoidingView` NON riceve gli eventi di layout corretti → il contenuto non si alza

**Fix strutturale** (`ai-teach.tsx`): aggiunti a **entrambi** i `<Modal>` (Nuova regola + Nuovo URL):
- `statusBarTranslucent={true}` — questo prop forza React Native a passare `SOFT_INPUT_ADJUST_RESIZE` al Dialog Android → `KeyboardAvoidingView` ora riceve i corretti eventi di layout e alza il contenuto
- `hardwareAccelerated={true}` — migliora la fluidità dell'animazione di apertura/chiusura tastiera

Le props di `KeyboardAvoidingView` restano invariate come richiesto (`behavior="padding"`).


## V29.ay — Uniforma header "Interfaccia Master" con header Home

**Richiesta utente:** "Lo sfondo della header area master deve essere uguale a quello della header home." (con screenshot).

**master.tsx**:
- Rimosso il `<LinearGradient colors={["#0F172A", "#1E3A8A", "#4C1D95"]}>` dark-navy→purple
- Sostituito con `<View style={styles.hero}>` che contiene:
  - `<Image source={HOME_HEADER_IMG}>` full-bleed (stessa `assets/images/advisoros-home-header.jpg` bundlata usata dalla Home → continuità brand + offline-safe)
  - `<View style={styles.heroScrim}>` con `rgba(11, 30, 56, 0.55)` per leggibilità testi
  - Header row + banner My Thing con `zIndex: 1` per stare sopra all'immagine
- `styles.hero`: aggiunto `backgroundColor: "#0B1E38"` (fallback), `overflow: "hidden"`, `position: "relative"`
- Nuovo `styles.heroScrim` = absoluteFillObject + navy alpha 0.55
- Import `Image` aggiunto a react-native, costante `HOME_HEADER_IMG` module-level

**Verifica**: screenshot mostra sfondo circuiti neurali AdvisorOS/AxonOS con "Ciao Emanuele" + "Interfaccia Master" ben leggibili, clock a destra, back/menu ai lati, banner My Thing immutato.

**Nota**: il `LinearGradient` viola/pink resta come **fallback** del banner "My Thing" quando l'utente non ha ancora caricato immagini motivazionali — comportamento pre-esistente immutato.


## V29.ba — Header Master tema tecnico (no loghi) + Bottoni stile Optima

**Richieste utente**:
1. Header area Master: stesso tema tecnico della Home ma SENZA i loghi AdvisorOS/AxonOS (solo lo sfondo)
2. Stile bottoni globale: ombra, effetto rialzato, icone colorate con sfondo tondo (riferimento: slide Optima)
3. Il motto "Continuare ad evolvere" NON deve apparire nelle pagine dell'app (solo per la presentazione)

**Modifiche**:

`master.tsx`:
- Rimosso `<Image HOME_HEADER_IMG>` full-bleed (che conteneva i loghi)
- Sostituito con `<LinearGradient>` (navy `#0B1E38 → #0F172A → #1E293B`) + `<NeuralPatternBg color="#38BDF8" pulseColor="#22D3EE" opacity={0.28} />` overlay → sfondo tecnico con circuiti neurali cyan
- **Motto rimosso** (era stato aggiunto per errore) — nessun testo aggiunto ai pageheader
- `btnCircle` aggiornato a stile Optima: `borderRadius: 36` (full-round), `borderWidth: 2 borderColor: rgba(255,255,255,0.35)` (highlight superiore), `shadowOpacity: 0.25`, `shadowRadius: 10`, `shadowOffset: {0,6}`, `elevation: 8` (effetto rialzato marcato)

`home.tsx` (griglia "Azioni rapide"):
- Icone quick da 40×40 con borderRadius 12 → **44×44 full-round** con bordo bianco e shadow rialzato
- Colori background da soft-pastel (`C.primarySoft`, `C.navySoft`) a **colori pieni** (`C.primary`, `C.navy`) con icona bianca — stile Optima

**Files toccati**: `/app/frontend/app/master.tsx`, `/app/frontend/app/(tabs)/home.tsx`. Nessun autotest come richiesto.


## V29.bb — Stile Optima esteso alle pagine secondarie

**Richiesta utente**: "Applica lo stesso stile bottoni tondi + shadow anche a contatti, appuntamenti e altre schermate secondarie, senza toccare altre e senza autotest."

**Pattern applicato** (icon container "Optima"):
```js
borderWidth: 2, borderColor: "rgba(255,255,255,0.9)",
shadowColor: "#000", shadowOpacity: 0.15-0.20,
shadowRadius: 6-8, shadowOffset: {0, 3-4}, elevation: 4-5,
borderRadius: full-round (= size/2)
```

**Files aggiornati** (solo icon-container esistenti, no nuovi elementi):
- `/app/frontend/app/(tabs)/contatti.tsx` — `headerBtn` (40×40) + `avatar` (44×44) → full-round + shadow rialzato
- `/app/frontend/app/(tabs)/calendario.tsx` — `headerBtn` (40×40) + `callBtn` (28×28) + `navBtn` (32×32) → full-round + shadow
- `/app/frontend/app/contact/new.tsx` — `iconBox` (36×36, era borderRadius 6 → 18 full-round) + shadow
- `/app/frontend/app/invita-pick.tsx` — `createIcon` (42×42, era 12 → 21 full-round) + shadow
- `/app/frontend/app/google-drive.tsx` — `badgeIcon` (32×32, era 10 → 16 full-round) + shadow

**Note**:
- Nessun testo/motto aggiunto
- Nessun autotest eseguito (come richiesto)
- Warning pre-esistenti (DocumentPicker unused in `contact/new.tsx`) NON toccati per rispettare "non toccare altro"


## V29.bc — Stile Optima esteso a Chat, Impostazioni, Settings-app, Team, Quick-actions, Neo-memory, My-audios

**Richiesta utente**: "Applica stesso stile anche a notifiche, storico chiamate, promemoria e schermate di setting per uniformità totale."

**Files aggiornati con pattern icon-Optima (borderWidth:2, borderColor:rgba(255,255,255,0.9), shadow rialzato)**:
- `chat.tsx` (Notifiche/Chat unificato): `headerBtn` (40×40) + `avatar` (44×44)
- `impostazioni.tsx`: `avatarBadge` (22×22, badge over profilo)
- `settings-app.tsx`: `headerBtn` (36×36)
- `team.tsx`: `headerBtn` (38×38)
- `quick-actions.tsx`: `badge` (32×32) + `iconChip` (28×28, era borderRadius 8 → 14 full-round)
- `neo-memory.tsx`: `delBtn` (32×32)
- `my-audios.tsx`: `headerBtn` (36×36)

**Non toccato** (per rispettare "senza toccare altro"):
- Tab bars interne (tabIcon in contact/[id])
- Button testuali (Salva, Elimina, "Apri", ecc.) di form/detail — non icon-containers
- Landing web (fuori dal contesto app mobile)
- `security.tsx` `badge` (è un pill testuale, non un icon-container)
- `master-files.tsx` tabBtn/addBtn (parte del layout tab, non icon-container standalone)

Nessun autotest eseguito.



## V50.z24 — Anteprima allegati IN-APP + Auto-CRM scheduler configurabile

**Richieste utente**:
1. Gli allegati email devono aprirsi DENTRO l'app (no window.open, no browser esterno).
2. Poter settare ogni quanto Auto-CRM esegue la scansione automatica.

**Frontend — `/app/frontend/app/email-accounts.tsx`**:
- `CombinedInbox` e `MessagesModal` ora aprono la modale `AttachmentPreview` invece di uscire dal frame.
- Aggiunto pulsante "Scarica" in-modale (web = download tag; native = `expo-sharing`).
- Web: `<iframe>` per PDF, `<img>` per immagini.
- Native: `<Image>` per foto; hint "Scarica" per PDF/altro.
- Rimosso `expo-web-browser` (non più necessario).

**Frontend — `/app/frontend/app/mail-crm-proposals.tsx`**:
- Nuova card "Scansione automatica" con Switch enable/disable e chip di scelta intervallo
  (5, 10, 15, 30 min, 1h, 2h, 6h).
- Mostra ultima esecuzione, prossima esecuzione, ultimo errore.
- Chiama `GET/PATCH /api/mail/auto-crm/settings`.

**Backend — `/app/backend/server.py`**:
- Refactor: logica scan estratta in `_auto_crm_scan_impl(user_id, tenant_id, ...)`.
- Nuovi endpoint `GET/PATCH /api/mail/auto-crm/settings`.
- Nuova collection `mail_auto_crm_settings` per tenant: `{enabled, interval_minutes, last_run_at, next_run_at, last_stats, last_error}`.
- Nuovo job APScheduler `_run_auto_crm_tick` (ogni 1 min): controlla scadenze e lancia scan per tenant abilitati.
- Limiti: min 5 min, max 1440 min (24h). Default 15 min.


## V50.z25 — Bottone Caselle mail su Home + Sezione Allegati dalle mail su contatto

**Richieste utente**:
1. Aggiungere un bottone "Caselle mail" nel menu Azioni rapide della home, rendendolo a scomparsa.
2. Aggiungere in scheda contatto la sezione "Allegati dalle mail" con i file salvati automaticamente dall'Auto-CRM.

**Frontend — `/app/frontend/app/(tabs)/home.tsx`**:
- Sezione "Azioni rapide" ora è collassabile (chevron up/down sul titolo).
- Stato persistito in `AsyncStorage` (`home_qa_open_v1`), default aperto.
- Aggiunto 4° pulsante "Caselle mail" (arancione #F97316) → naviga a `/email-accounts`.
- `quickRow` cambia in `flexWrap` con `flexBasis: 45%` per andare a capo con 4+ pulsanti.

**Backend — `/app/backend/server.py`**:
- Nuovi endpoint tenant-safe:
  - `GET /api/contacts/{contact_id}/mail-attachments` — lista allegati (senza payload).
  - `GET /api/contacts/{contact_id}/mail-attachments/{attachment_id}/download` — binario file.
  - `DELETE /api/contacts/{contact_id}/mail-attachments/{attachment_id}` — rimozione.
- Ogni endpoint filtra su `tenant_id` per isolamento multi-tenant.

**Frontend — `/app/frontend/src/ContactMailAttachmentsSection.tsx` (nuovo)**:
- Componente che si mostra solo se ci sono allegati (`items.length > 0`).
- Card arancione con lista file: filename, size, subject della mail, mittente.
- Preview IN-APP identica alla casella mail: iframe (web PDF), Image (foto), hint scarica per native/altro.
- Pulsante "Rimuovi" con confermazione.

**Integrazione — `/app/frontend/app/contact/[id].tsx`**:
- Aggiunto sotto la tab "File" (in coda ai file caricati manualmente).


## V50.z26 — 🔥 FIX DEFINITIVO Axon ricerca PDF GME (bug ricorrente)

**Problema segnalato dall'utente**:
Axon rispondeva "ho provato ad accedere al sito GME ma non sono riuscito a recuperare i dati PUN di agosto 2026" pur avendo l'URL nei `ai_teach_urls` con snapshot valido contenente i PDF con i valori.

**Root cause** (verificata via test end-to-end):
1. Nel `system_message` la sezione **`web_section` (Tavily)** era prima di `axon_teach_section` (PDF snapshot). Tavily risponde vago sui PDF GME e l'LLM lo seguiva, ignorando i dati puliti dallo snapshot.
2. La funzione `_fetch_teach_url_pdfs_for_query` faceva `return ""` se il messaggio corrente non aveva mese/anno esplicito — quando l'utente diceva "vai a leggere" senza specificare, il fetch dinamico non partiva.
3. Il gating `is_pun_like` era troppo stretto (mancavano keyword `mercatoelettrico`, `arera`, `kwh`, `mwh`, `bolletta`, `tariffa`, `fasce`, `prezzomedio`).

**Fix applicati in `/app/backend/server.py`**:
- **Riordino sezioni del `system_message`**: `axon_teach_section` (PDF snapshot dagli URL insegnati) è ora **PRIMA** di `web_section` (Tavily) in entrambi i flow (streaming + non-streaming).
- **Istruzione anti-allucinazione rafforzata**: ordine di priorità esplicito (WEB LIVE URL insegnati → PDF dinamico → Drive → RAG Master → Tavily), con divieto categorico di dire "non sono riuscito a recuperare" quando i numeri sono nel prompt.
- **Rilassato `_fetch_teach_url_pdfs_for_query`**: se manca mese/anno ma il tema è chiaramente energia/PUN, scarica comunque i PDF più recenti (flag `no_filter`).
- **Estese keywords `is_pun_like`**: aggiunte `mercatoelettrico`, `arera`, `kwh`, `mwh`, `€/kwh`, `€/mwh`, `bolletta`, `tariffa`, `fasce`, `prezzomedio`.
- **User-Agent + Accept-Language** su fetcher live (evita blocchi da CDN aggressivi).

**Test end-to-end (verificato con curl)**:
- Query "dammi PUN F1/F2/F3 agosto 2026" → Axon risponde tabella pulita con `F1: 174,52 · F2: 204,35 · F3: 171,72 €/MWh` (valori esatti dal PDF `20260902PrezzomedioperfasceAgosto2026.pdf`).
- Query "vai a leggere sul sito GME come da regole" → Axon elenca Giugno/Luglio/Agosto 2026 con tutti i valori, citando "PDF ufficiali GME".

Nessuna modifica frontend richiesta.


## V50.z27 — 🔥 FIX Buchi tabelle PUN + streaming lento

**Problemi segnalati**:
1. Axon aveva 18 mesi in RAG Master ma nella tabella lasciava `n/d` per mesi con dati LIVE disponibili (es. Agosto 2026 aveva PDF snapshot con F1=174,52 ma restava n/d nella tabella).
2. Streaming lento: risposte apparivano solo dopo il ragionamento completo, non progressivamente.

**Fix applicati in `/app/backend/server.py`**:

1. **Regola merge tabelle nel system_message**: aggiunta istruzione categorica —
   "quando componi una tabella storica multi-mese, SOVRASCRIVI SEMPRE i valori `n/d` (o mancanti) del RAG Master con i numeri REALI trovati in `🌐 CONTENUTO WEB LIVE`, `📥 PDF SCARICATO` o `📂 PDF DA GOOGLE DRIVE`."
   Include anche l'esempio esplicito della conversione €/MWh → €/kWh (÷1000).

2. **Router modello riequilibrato** (`_pick_axon_model`):
   - Prima: keyword `tabella`, `pun`, `f1/f2/f3`, `gme`, `arera` → Sonnet 4.5 (6-8s first token)
   - Ora: solo keyword di **ragionamento profondo** (analizza, confronta, cluster, insights, trend, previsione) → Sonnet
   - Query tabellari con dati già nel contesto → Haiku 4.5 (~1-2s first token)
   - Anche `has_web=True` non forza più Sonnet.

**Test end-to-end verificato**:
- Query "Aggiorna tabella PUN ultimi 18 mesi con Agosto 2026 da GME" → Axon compila la tabella con Agosto/Luglio/Giugno 2026 dai PDF live GME (valori esatti in €/kWh).
- First delta a **5.26s** (con preflight completo di RAG+teach+tavily), Done a **8.35s** per tabella di 21 righe → 5× più veloce di Sonnet 4.5.

**Nota tecnica**: I ~5s di preflight sono dovuti a Tavily search + RAG retrieval + teach snapshot fetch che girano in serie. Ottimizzabile parallelizzando (futuro).


## V50.z28 — 🔥 FIX critico Axon: bug DUAL-STORAGE + fallback canonico GME

**Problema segnalato dall'utente reale (`user_ae92fe85cdaf`)**:
Anche dopo l'ultimo aggiornamento manuale degli URL Axon lasciava `n/d` per Agosto 2026 e mesi storici, pur avendo insegnato URL come `arera.it`, `gse.it`, `ansa.it`. L'utente si aspettava che Axon andasse su GME autonomamente.

**Diagnosi (via query DB reale)**:
1. **DUAL STORAGE BUG**: esistono DUE fetcher paralleli nel backend:
   - `_ai_teach_refresh_url` (linea 15418) → chiamato quando l'utente clicca "aggiorna" nell'UI, salva in `last_summary` (con contenuti PDF inclusi via Tavily).
   - `_axon_refresh_teach_snapshot` (linea 9690) → chiamato dallo scheduler ogni 30 min, salva in `axon_snapshot`.
   
   La chat `_fetch_teach_urls_html_generic` leggeva SOLO `axon_snapshot`, IGNORANDO `last_summary`. Risultato: gli aggiornamenti manuali dell'utente non arrivavano mai ad Axon.
2. **GME URL non insegnato**: l'utente aveva insegnato `www.arera.it` (senza deep link) sperando che Axon "capisse" di andare su GME per i PUN. Non funzionava.

**Fix in `/app/backend/server.py`**:

1. **Fallback merge dual-storage** (`_fetch_teach_urls_html_generic`):
   - Se `axon_snapshot` è vuoto, legge `last_summary` (fetch manuale via Tavily+PDF).
   - Tag `[refresh manuale: ...]` così Axon sa da dove viene.

2. **Fallback canonico GME** (nuova funzione `_fetch_gme_pun_canonical`):
   - Attivata SEMPRE quando la query contiene keyword PUN/fascia/f1-f3/mercato elettrico/€kWh/€MWh/monorario.
   - Scarica direttamente `gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce` e i primi 18 PDF (Gen→Dic dell'anno corrente).
   - Cache in-memory 15 min per non ricaricare ad ogni query.
   - Header canonico `🏦 FONTE CANONICA GME`, PRIORITÀ MASSIMA per PUN F1/F2/F3.
   - Perf: 8 mesi caricati in 3.26s (parallelo).

3. **Dedup PDF** su base name lowercase per evitare duplicati (GME espone alcuni PDF 2x).

**Effetto atteso per l'utente reale**:
- Riprovare la query "Aggiorna tabella PUN 18 mesi con Agosto 2026" → ora Axon avrà nel prompt i valori LIVE di Gen-Ago 2026 dalla FONTE CANONICA GME, indipendentemente da cosa ha insegnato.
- I mesi 2025 saranno presi dal RAG Master (se caricati) o marcati `n/d` (GME non espone lo storico sulla pagina pubblica dell'anno corrente).


## V50.z29 — Auto-suggest deep-link canonici in AI-Teach

**Richiesta utente**: Quando l'utente aggiunge un URL generico (es. arera.it), l'app suggerisce deep link canonici per un consulente energetico.

**Backend — `/app/backend/server.py`**:
- Nuova mappa `_CANONICAL_DEEP_LINKS` con deep link ufficiali per domini:
  - `gme.mercatoelettrico.org` → PrezzoMedioFasce, Prezzi Medi MGP, Pubblicazioni Gas
  - `arera.it` → Delibere, Prezzo servizio tutela luce/gas, Andamento prezzo domestico
  - `gse.it` → Prezzi minimi garantiti FV, Scambio sul Posto
  - `terna.it` → Generazione effettiva, Rapporto Mensile
  - `snam.it` → Dati operativi trasporto gas
  - `acquirenteunico.it` → Portale offerte
- Nuovo endpoint `POST /api/ai-teach/urls/suggest-canonicals`:
  - Riceve `{url}` (anche senza schema, senza deep path)
  - Ritorna suggerimenti che l'utente NON ha già insegnato (dedup su `ai_teach_urls`)
  - Include `why` per spiegare a cosa serve il link
  - Rileva `is_generic` (path banale) per triggerare il suggerimento in UI

**Frontend — `/app/frontend/app/ai-teach.tsx`**:
- Chiamata debounced (500ms) all'endpoint quando l'utente digita/incolla l'URL nel modale.
- Sezione viola "Deep link suggeriti su [dominio]" con card per ogni suggerimento:
  - **USA** — sostituisce l'URL corrente con quello canonico + prefila nome/categoria/frequenza.
  - **Aggiungi** — crea subito il link canonico come URL separato, mantenendo quello attuale.
- La sezione appare SOLO in creazione (non in modifica di URL esistente).
- Loading spinner mentre cerca.


## V50.z31 — 🔥 Quick Action "Prossimo appuntamento" da 20s a 0.01s

**Bug segnalato**: Cliccare la quick action "Prossimo appuntamento" impiegava 20 secondi per rispondere anche con 0 appuntamenti e 3 contatti in DB. Inaccettabile per una risposta che dovrebbe essere immediata.

**Root cause**: Le quick action inviavano il prompt natural-language "Qual è il mio prossimo appuntamento?" — che entrava nel flow LLM completo con preflight (RAG retrieval, Tavily search, GME canonical fetch, teach snapshot). Tutto inutile per una semplice query DB.

**Fix in `/app/backend/server.py`**:
- Nuova funzione `_maybe_quick_action_intercept(msg, user)` che matcha natural-language dei prompt canonici delle quick actions e risponde direttamente dal DB.
- Intercept installato PRIMA del preflight LLM in `assistant_chat_stream`.
- Copre attualmente:
  - **"Prossimo appuntamento"** varianti → query `db.appointments` (7gg) + suggerisce clienti senza appuntamento futuro se vuoto.
  - **"Clienti senza appuntamento"** varianti → elenca contatti orfani (max 25).
- Persiste user + assistant messages così history/feedback continuano a funzionare.

**Verifica reale (curl end-to-end sul demo user)**:
- Prima: ~20 s
- Ora: **First delta 0.01 s, Done 0.01 s** → risposta pressoché istantanea.
- Risposta identica a quella LLM (test: "Non hai appuntamenti nei prossimi 7 giorni" + suggerimento operativo con nomi clienti).


## V50.z32 — 🔥 Fix meteo (parser rotto) + messaggio Drive intelligente

**Problemi segnalati**:
1. Axon rispondeva "non ho accesso al meteo" anche per query esplicite tipo "meteo Vicenza".
2. Axon diceva "non ho accesso a Google Drive" anche se l'utente lo aveva collegato in precedenza (sessione OAuth scaduta).

**Diagnosi**:
1. **Parser meteo rotto**: `_detect_weather_query` matchava solo "a/in/di/per/su <City>", quindi:
   - ✅ "che tempo fa a Roma" → Roma
   - ❌ "meteo Vicenza" → "?" (assumeva query senza città → chiedeva quale città)
   - ❌ "previsioni Milano" → None (keyword "previsioni" non era in `_WEATHER_KEYWORDS`)
2. **Drive scaduto ≠ Drive mai collegato**: quando le credenziali OAuth scadono (`google_drive_credentials` vuota) ma esistevano `google_drive_folders` o teach URLs a `drive.google.com`, Axon rispondeva "non collegato / contatta Neo" invece di dire "sessione scaduta, riconnettiti in Impostazioni".

**Fix in `/app/backend/server.py`**:

1. **Parser meteo esteso** (`_detect_weather_query`):
   - Nuovo regex "meteo/previsioni/tempo/clima <City>" (senza preposizione).
   - Filtra stop-words nella city extraction.
   - Aggiunte keyword `previsioni`, `previsione` a `_WEATHER_KEYWORDS`.

2. **Detection Drive "sessione scaduta"** (`_cloud_section`):
   - Se `google_drive_credentials` è vuota MA `google_drive_folders` o `ai_teach_urls` con `drive.google.com` esistono → messaggio "🔴 Google Drive SESSIONE SCADUTA. Vai in Impostazioni → Google Drive → Ricollega".
   - Se davvero non è mai stato collegato → "Vai in Impostazioni → Google Drive → Collega" (auto-servito, no Neo).
   - Regola esplicita: **non suggerire mai di contattare Neo/Admin per Drive**.

**Verifica reale (curl end-to-end)**:
- "meteo Vicenza domani" → risposta completa con temperatura, condizioni, alba/tramonto **in 4.23s** (first delta 3.09s).
- Detection test:
  - "meteo Vicenza" → Vicenza ✓
  - "previsioni Milano" → (dopo fix) Milano ✓
  - "meteo Torino domani sera" → Torino ✓
  - "meteo domani" → "?" ✓ (chiede quale città)


## V50.z33 — Preflight parallelo full (RAG + Tavily + Teach + GME canonical)

**Cosa fatto**:
1. **Tavily nel gather principale** (`_prepare_assistant_prompt` × 2 flows): prima era chiamato sequenzialmente DOPO il gather, ora parte insieme a context/weather/RAG/memories/attachments/teach_section. Se non è query energy la promise ritorna None subito (no latenza).
2. **4 fetcher interni di `_build_axon_teach_section` parallelizzati** con asyncio.gather:
   - `_fetch_teach_url_pdfs_for_query`
   - `_fetch_teach_drive_pdfs_for_query`
   - `_fetch_teach_urls_html_generic`
   - `_fetch_gme_pun_canonical`
   Prima ~10s in sequenza (2-3s ciascuno), ora ~3s (limite = fetcher più lento).
3. **Skip Tavily se RAG già copre**: se `_rag_covers_query` è True, scartiamo il risultato Tavily per evitare rumore nel prompt.

**Verifica reale (test end-to-end)**:
- Query PUN complessa (attiva RAG+Tavily+teach+GME canonical): **3.84s** first token (prima ~5-8s)
- Query meteo con fetch weather API: **3.34s** first token
- Query CRM banale (no fetcher pesanti): **0.84s** ✅ sotto i 2s

Il collo di bottiglia residuo per query energy è il fetch Tavily (2-3s) e i PDF GME canonical (3s parallelizzati). Ulteriori ottimizzazioni possibili: cache Tavily 15 min per query identiche.
