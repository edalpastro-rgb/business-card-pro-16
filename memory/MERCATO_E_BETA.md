# AdvisorOS — Scheda comparativa e Piano «Beta sul campo»
_Giugno 2026 — documento strategico (non tecnico). Prezzi e feature dei concorrenti sono indicativi dei listini pubblici 2026 e vanno riverificati prima di usarli in materiale commerciale._

---

## 1. Scheda comparativa — AdvisorOS vs 5 concorrenti

Legenda: ✅ nativo e pronto · 🟡 parziale / a pagamento extra / via integrazione · ❌ assente · n/d non documentato

| Area / Funzione | **AdvisorOS** | Salesforce + Agentforce | HubSpot (Breeze) | Zoho CRM (Zia) | Pipedrive (AI) | vtenext / CRM italiani per agenti |
|---|---|---|---|---|---|---|
| **Target** | Consulente/agente energia & servizi, reti di agenti | Enterprise, utility | PMI marketing-led | PMI generaliste | Reti vendita PMI | PMI/processi, mercato IT |
| **Mobile-first (uso in auto, una mano, voce)** | ✅ progettato così | 🟡 app buona, non voice-first | 🟡 | 🟡 | 🟡 | ❌ |
| **Assistente AI che ESEGUE azioni** (aggiorna trattativa, fissa appuntamento, invia messaggio) | ✅ multi-step con conferma | ✅ (Agentforce, a consumo) | 🟡 Breeze Agents (piani alti) | 🟡 Zia Agents | 🟡 suggerimenti, poche azioni | ❌ |
| **Voce bidirezionale (parla/ascolta, wake-word, solo-testo)** | ✅ Viola wake-word, TTS/STT, mute blindato | 🟡 Agentforce Voice (contact center) | ❌ | ❌ | ❌ | ❌ |
| **Gestione imprevisti** (ricalcolo agenda + messaggi ai clienti) | ✅ | 🟡 flussi da costruire | ❌ | ❌ | ❌ | ❌ |
| **Dati di mercato energia nativi** (PUN, fasce, storico 18 mesi, PDF) | ✅ | ❌ (solo via dati cliente) | ❌ | ❌ | ❌ | ❌ |
| **Trascrizione chiamate → budget/obiezioni/next step nel CRM** | ✅ | ✅ (Einstein Conversation Insights, extra) | 🟡 (Sales Hub Pro+) | 🟡 | 🟡 (add-on) | ❌ |
| **Scanner documenti / bollette / doc. identità** | ✅ offline-ready | 🟡 via app partner | ❌ | 🟡 (card scanner) | ❌ | ❌ |
| **Navigazione guidata dall'AI** (chip verso schermata/pagina manuale) | ✅ | 🟡 help agent | 🟡 | 🟡 | ❌ | ❌ |
| **Onboarding tracciato + solleciti automatici per collaboratori** | ✅ | 🟡 da costruire | 🟡 | 🟡 | ❌ | ❌ |
| **Rubrica telefono come fallback dell'AI** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Privacy: dati sensibili solo on-device, cifrati** | ✅ Spazio Personale | ❌ (tutto cloud) | ❌ | ❌ | ❌ | 🟡 on-prem possibile |
| **Hosting sovrano / VPS proprio, nessun lock-in** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (on-prem) |
| **Antivirus upload + report Master** | ✅ | ✅ (Shield, extra) | 🟡 | 🟡 | n/d | n/d |
| **Multi-tenant Master/consulenti, ruoli, RBAC** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Automazioni/marketing (sequenze email, lead scoring, landing)** | 🟡 base | ✅ | ✅ (punto di forza) | ✅ | ✅ | 🟡 |
| **Ecosistema integrazioni (marketplace, Zapier, API pubbliche)** | 🟡 (Drive, Resend, WhatsApp link, API interne) | ✅ enorme | ✅ | ✅ | ✅ | 🟡 |
| **Reportistica/BI avanzata** | 🟡 statistiche | ✅ | ✅ | ✅ | 🟡 | 🟡 |
| **Manuale in-app con ricerca, FAQ, link dall'AI** | ✅ | 🟡 Trailhead esterno | 🟡 | 🟡 | 🟡 | ❌ |
| **Prezzo indicativo / utente / mese** | da definire (target 25–49 €) | 100–330 € + Agentforce a consumo (~2 $/conversazione) | 20–150 € (Breeze nei piani Pro/Enterprise) | 14–52 € | 14–99 € + add-on AI | 20–60 € |
| **Tempo per essere operativi** | minuti (tour + Axon) | settimane/mesi (partner) | giorni | giorni | ore | giorni/settimane |

### Lettura della tabella
- **Dove vinciamo nettamente**: voce, azioni dell'AI sul campo, dati energia, imprevisti, privacy on-device, sovranità, time-to-value. Nessun concorrente copre queste 6 righe insieme.
- **Dove siamo indietro** (e va detto in trasparenza al cliente): marketing automation, ecosistema integrazioni, BI. Non sono il nostro gioco: il consulente in auto non fa lead scoring; lo fa l'agenzia, che può tenere HubSpot e usare AdvisorOS sul campo (posizionamento «affianca, non sostituisce» verso le reti già strutturate).
- **Il concorrente vero** non è in tabella: il **tool imposto dal fornitore/mandataria**. Si batte con due argomenti: (1) AdvisorOS è del consulente, lo segue anche se cambia mandato; (2) i dati dei suoi clienti non finiscono al fornitore.

### Frase di posizionamento
> **«Il consulente che parla con il suo CRM mentre guida.»** — AdvisorOS: il primo assistente operativo mobile per consulenti energia e servizi, con i prezzi dell'energia dentro e i dati che restano tuoi.

---

## 2. Piano «Beta sul campo» — 6 settimane

**Obiettivo**: passare da «MVP avanzato» a «prodotto affidabile» misurando l'uso reale, non le feature.

### 2.1 Chi
- **12–20 consulenti** in 2–3 reti diverse (almeno una non vostra), mix Android/iOS (≥60 % Android: è dove i bug nativi emergono).
- 1 **Master** per rete che usi pannello, onboarding e report.
- Patto chiaro: uso quotidiano per 6 settimane, 10 minuti di feedback a settimana, accesso gratuito + 3 mesi omaggio al rilascio.

### 2.2 Cosa misurare (metriche di successo, soglie obiettivo)

| # | Metrica | Come si misura | Soglia obiettivo fine beta |
|---|---|---|---|
| 1 | **Attivazione**: % utenti che completano i 3 checkpoint onboarding entro 48 h | pannello Onboarding (già esistente) | ≥ 80 % |
| 2 | **Uso giornaliero (DAU/WAU)** | sessioni per utente, giorni attivi su 5 lavorativi | ≥ 3 giorni/settimana per il 70 % |
| 3 | **Comandi Axon riusciti** | % richieste completate senza correzione/ripetizione (log chat + «Insegna ad Axon») | ≥ 85 % |
| 4 | **Voce**: % interazioni vocali sul totale e tasso di errore STT | log stream (voice flag) | ≥ 30 % vocali, errori < 10 % |
| 5 | **Tempo per fissare un appuntamento** | dall'inizio comando al salvataggio | < 20 s via Axon (vs > 60 s manuale) |
| 6 | **Crash & errori nativi** | report bug Help + watchdog log + crash su device | 0 crash bloccanti dalla settimana 3; < 1 incidente watchdog/utente/settimana |
| 7 | **Dati inseriti**: contatti, appuntamenti, note vocali per utente/settimana | DB | trend crescente; ≥ 10 contatti nuovi/utente nelle prime 2 settimane |
| 8 | **Feature usate almeno 1 volta** (PUN, scanner, trascrizione, imprevisti) | eventi | ogni feature ≥ 50 % degli utenti; sotto il 20 % → candidata a taglio/ridisegno |
| 9 | **NPS / «lo consiglieresti?»** | sondaggio in-app settimana 3 e 6 | NPS ≥ 40; ≥ 70 % «sì» |
| 10 | **Disponibilità a pagare** | domanda diretta settimana 6 con 3 fasce di prezzo | ≥ 50 % sceglie una fascia ≥ 25 €/mese |

### 2.3 Calendario
| Settimana | Attività | Output |
|---|---|---|
| 0 | Build Android/iOS, VPS aggiornato, ClamAV attivo, Places attivo; checklist «pronto per beta»; gruppo WhatsApp/Telegram beta | Build distribuite, 2 referenti per rete |
| 1 | Onboarding assistito (15 min a testa), tour, primi 10 contatti | Metriche 1, 7 |
| 2 | Uso libero + «missione della settimana» (es. 5 appuntamenti via voce) | Metriche 2, 3, 4, 5 |
| 3 | Primo sondaggio NPS; sessione 1:1 con i 3 utenti meno attivi (perché?) | Lista bug P0/P1, metrica 9 |
| 4 | Rilascio correttivo; «missione» su imprevisti e trascrizione chiamate | Metrica 8 |
| 5 | Stress test: tenant con 500+ contatti importati; Master usa report antivirus/onboarding | Performance, bug Master |
| 6 | Sondaggio finale + prezzo; retrospettiva; decisione go/no-go pubblico | Metriche 9, 10; roadmap 90 gg |

### 2.4 Regole operative
- **Un solo canale bug**: il modulo «Segnala un problema» nell'Help (allegati + risposta Axon) → il Master vede tutto; niente screenshot sparsi su WhatsApp.
- **Rilascio settimanale fisso** (es. venerdì): pacchetti + upgrade VPS + build. Nessun hotfix in mezzo salvo P0.
- **Freeze feature**: durante la beta si correggono bug e si rifiniscono le feature esistenti; le nuove idee vanno in backlog con il nome di chi le ha chieste.
- **Diario del consulente** (3 domande il venerdì, 2 minuti): cosa ti ha fatto risparmiare tempo? cosa ti ha fatto arrabbiare? cosa hai fatto a mano che Axon avrebbe potuto fare?

### 2.5 Criterio go/no-go (fine settimana 6)
- **GO** se: metriche 1, 3, 6, 9 raggiunte e almeno 6 su 10 complessive.
- **ITERA** se: metrica 3 < 85 % o 6 non raggiunta → altre 3 settimane solo su affidabilità Axon/Android.
- **RIPENSA** se: metrica 2 < 2 giorni/settimana per la maggioranza → il problema è di abitudine/valore percepito, non tecnico: rivedere onboarding e proposta di valore prima di investire in marketing.

### 2.6 Cosa serve da parte tua per partire
1. Lista dei 12–20 consulenti e dei Master di rete.
2. Fasce di prezzo da testare (proposta: 19 / 29 / 49 €).
3. Via libera a: strumentazione eventi d'uso (già in gran parte presente nei log), sondaggio in-app NPS (da costruire: 1 schermata), cruscotto «Beta» nel pannello Master che raggruppa le 10 metriche (da costruire: 1 endpoint + 1 schermata).
