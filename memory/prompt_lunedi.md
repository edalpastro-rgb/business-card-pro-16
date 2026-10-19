# PROMPT SALVATO PER LUNEDÌ — 4 modifiche (revisionato il 16/10, nomi corretti sul codice reale)

Apply ONLY these 4 changes, nothing else. Do not touch core/drive_retrieval.py or the energy price band logic.

(1) Objections manual in chat. In routes/36b_axon_pdf_link_parser.py, inside the wrapper function `_build_axon_teach_section(tenant, user_msg)`
(nome REALE con underscore iniziale, riga ~192; avvolge `_axon_build_teach_section_orig`): if user_msg matches this regex (re.I):
(obiezion|trattativ|gestione\s+obiez|(cliente|lui|lei|mi)\s+(mi\s+)?(dice|risponde|ha\s+detto|obietta)|non\s+ha?o?\s+tempo|ci\s+devo\s+pensare|devo\s+pensarci|non\s+mi\s+interessa|devo\s+parlar\w+\s+con|cosa\s+(gli|le)?\s?(posso\s+)?rispond|cosa\s+dovrei\s+rispond|come\s+rispond)
then read db.cgym_manual_kb.find_one({"tenant_id": tenant, "type": "obiezioni"}) and PREPEND its full "text" field to the returned section
(cap di sicurezza consigliato: 60.000 caratteri — oggi il flusso esistente in corporate_gym_rules_v2.py tronca con t[:limit]; un manuale
intero senza limite può gonfiare il prompt e il TTFT oltre i 2 s dello smoke gate), under the heading
"MANUALE OBIEZIONI — FONTE PRIMARIA: rispondi con lo script del manuale per l'obiezione citata, citandolo; non improvvisare."
Do not call cgym_obi_kb_index (né l'helper che ne restituisce il testo in corporate_gym_rules_v2.py). Do this in the wrapper, not in
20_axon_memory.py, because that function has early returns.

(2) Footers. In routes/axon_manual.py, replace `_MN_HOWTO_RE` (nome REALE, riga ~148; usata in 3 punti: 156, 187, 214) with exactly this regex (re.I):
\b(dove\s+(si\s+)?(trov|vedo|apro|imposto|attivo|cambio|modifico|registro|aggiungo|creo)|dov'[eè]\s+(la|il|lo|l')|in\s+che\s+(menu|schermata|sezione|pagina)|come\s+(si\s+)?(fa(ccio)?\s+(a|ad)\s+|apro|attivo|disattivo|imposto|configuro|modifico|cambio|aggiungo|creo|registro|trovo|uso|collego|carico|esporto)|come\s+funziona\s+(la|il|lo|l')\s?(app|funzione|schermata|sezione|menu|scanner|landing|cms|calendario|agenda|rubrica)|(apri|aprimi|mostrami|portami)\s+(la|il|lo|l'|le|i)?\s?(schermata|pagina|sezione|menu|impostazioni|calendario|agenda|scanner|landing|cms)|a\s+cosa\s+serve\s+(la|il|lo|l')\s?(funzione|schermata|sezione|pulsante|tasto|menu))

(3) Alerts in chat. In routes/axon_critical_events.py, in `_ce_take_pending_voice` (nome REALE, riga ~101), add "source": {"$ne": "telemetria"}
to the find() filter (il campo `source` esiste: l'alert lentezza è creato con source "telemetria" a riga ~249). The slowness alert stays as
the Home banner and push only. (Facoltativo: marcare comunque announced=True gli eventi telemetria, così non restano pendenti per sempre.)

(4) Discursive tone for objection answers. When Axon answers a question about objections or sales scripts, it must respond as a knowledgeable
colleague speaking directly to the salesperson, not as a formatted manual. Instead of bullet points or numbered lists, Axon gives the
salesperson the exact phrases to say, in natural flowing text. Example: instead of "1. STROKES: say «Certo, è comprensibile…»", Axon says
"Rispondi al cliente dicendo: «Certo [NOME], è comprensibile che tu abbia poco tempo, ci può stare… nel dettaglio, qual è l'aspetto sul quale
vorresti pensarci?» Poi ascolta la risposta." Apply this as a system instruction in the objection response flow — suggerimento: metterla
nello stesso heading del punto (1), con la clausola «questa istruzione prevale sulle regole di formattazione (tabelle/elenchi/titoli) per le
risposte sulle obiezioni».

Then: restart the backend in preview and test these 4 questions; clear the semantic answer cache (in locale `axon_semantic_cache.delete_many({})`;
sul VPS la purge al boot rimuove solo listini/Drive/negative → aggiungere i token «obiezion», «rispond», «scanner», «dove» a _CACHE_SKIP_TOKENS
o fare una purge completa una tantum in questa versione); prepare ONE single Core package and give me the VPS update command.
Do not say it's fixed until https://core.axonos.cloud/api/health shows the new version (verificabile con curl dal preview, è pubblico).

Test questions:
"Il cliente mi dice che non ha tempo, cosa gli rispondo?" → risposta discorsiva con le frasi pronte, nessun elenco.
"Il cliente dice che ci deve pensare, cosa rispondo?" → stesso formato discorsivo.
"Dove trovo lo scanner?" → deve apparire il percorso menu.
Un messaggio vocale breve → il testo deve apparire in pochi secondi (NON testabile dal preview senza microfono: verifica su dispositivo reale dopo il deploy).

Prerequisito per i test locali del punto (1): nel DB del preview deve esistere `cgym_manual_kb` {tenant_id: <tenant test>, type: "obiezioni"} con `text`
(oggi il tenant smoke test@dalpastro.it potrebbe non averlo → va caricato un manuale di prova o indicizzato con cgym_obi_kb_index una volta).
