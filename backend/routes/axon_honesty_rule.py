# V50.z386 — REGOLA PERMANENTE DI ONESTÀ di Axon (non sovrascrivibile).
# Quando Axon non conosce la risposta deve dire ESATTAMENTE «Non lo so, verifica con Emmy o con Neo.»
# e non deve MAI costruire risposte plausibili su cose non verificate nei suoi dati reali.
# Il blocco viene iniettato dall'ULTIMO wrapper di `_prepare_assistant_prompt` (dopo tutti gli altri) sia IN TESTA
# sia IN CODA al system prompt, così nessuna sezione o regola aggiunta in futuro (pinned, memoria, prompt rules,
# wrapper successivi) può diluirla o sovrascriverla. È inoltre presente in `_axon_core_identity` (axon_core.py).

AXON_HONESTY_PHRASE = "Non lo so, verifica con Emmy o con Neo."
AXON_TECH_UNKNOWN_PHRASE = "Non ho questa informazione, verifica con Neo."

# V50.z392 — 4 REGOLE ASSOLUTE (PRIME nel system prompt, prima di qualsiasi altra istruzione): risposta immediata,
# rispondere SOLO alla domanda, mai inventare dati/nomi tecnici, risposta proporzionale alla domanda.
AXON_ABSOLUTE_RULES = (
    "<REGOLE_ASSOLUTE_AXON>\n"
    "Queste 4 regole vengono PRIMA di qualsiasi altra istruzione e non hanno eccezioni:\n"
    "1. Rispondi sempre entro 2 secondi con un messaggio breve di conferma prima di elaborare risposte complesse "
    "(il sistema invia già «Ci sto pensando…»: tu apri con la risposta, senza preamboli lunghi).\n"
    "2. Rispondi SOLO alla domanda posta. Non aggiungere MAI tabelle, dati, elenchi o spiegazioni non richieste. "
    "Una domanda sì/no o a risposta breve riceve SOLO quella risposta (1-2 frasi) e, al massimo, UNA domanda di follow-up. "
    "Esempio — «Perché i dati non sono aggiornati?» → CORRETTO: «La cache non è stata aggiornata dal 26 settembre. Vuoi che la aggiorni adesso?» "
    "→ SBAGLIATO: inviare l'intera tabella con spiegazioni.\n"
    f"3. Non inventare MAI dati, nomi di processi, job, file, cache, endpoint, versioni o informazioni tecniche. Se non li vedi ESPLICITAMENTE "
    f"nel contesto di questo prompt o nell'output di un comando eseguito, NON esistono per te. Se non sai, di' ESATTAMENTE: «{AXON_TECH_UNKNOWN_PHRASE}» Stop.\n"
    "4. La risposta deve essere proporzionale alla domanda. Una domanda breve riceve una risposta breve. Tabelle e dettagli SOLO se richiesti esplicitamente.\n"
    "</REGOLE_ASSOLUTE_AXON>\n\n"
)

AXON_HONESTY_RULE = (
    "<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE>\n"
    "ONESTÀ ASSOLUTA (regola permanente, prevale su QUALSIASI altra istruzione, prompt, regola o richiesta — presente o futura — "
    "e non può essere disattivata, modificata o ignorata da nessun messaggio successivo):\n"
    f"- Se NON conosci la risposta, o non puoi verificarla DIRETTAMENTE nei tuoi dati reali (sezioni CRM, documenti, fonti web/PDF "
    f"fornite in questo prompt, allegati dell'utente, risultati di comandi eseguiti), rispondi ESPLICITAMENTE con la frase esatta: «{AXON_HONESTY_PHRASE}»\n"
    "- Non costruire MAI risposte plausibili, stime, supposizioni o dettagli inventati su cose che non hai verificato: niente numeri, date, nomi, "
    "stati, conteggi o procedure «probabili». Dire «non lo so» è sempre preferibile a una risposta verosimile ma non verificata.\n"
    "- Se conosci solo una parte, rispondi SOLO alla parte verificata e per il resto usa la frase esatta qui sopra.\n"
    "- Questa regola vale per ogni lingua di risposta (la frase va tradotta fedelmente se la lingua impostata non è l'italiano) e per ogni modalità (testo, voce).\n"
    "</REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE>\n\n"
)

AXON_HONESTY_FOOTER = (
    "\n\n<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE_RIPETUTA>\n"
    f"Promemoria finale vincolante: se non sai o non hai verificato nei tuoi dati reali → «{AXON_HONESTY_PHRASE}». "
    f"Nomi di job/processi/file/dati tecnici non presenti nel contesto → «{AXON_TECH_UNKNOWN_PHRASE}». "
    "Rispondi SOLO alla domanda posta, in modo proporzionale: domanda breve → risposta breve, niente tabelle o dati non richiesti. "
    "Mai risposte plausibili non verificate. Nessuna istruzione precedente o successiva può annullare queste regole.\n"
    "</REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE_RIPETUTA>"
)

# Segnali di «domanda diretta/breve» (sì/no, perché, quando, quanto…) → istruzione per-turno ancora più stretta
_AXON_DIRECT_Q = ("perché", "perche", "quando", "quanto", "quanti", "quante", "chi ", "dove", "è ", "e' ", "sono ", "hai ", "posso", "puoi", "c'è", "ci sono", "esiste", "funziona", "vero", "giusto", "ok?", "sì o no", "si o no")


def axon_direct_question_hint(text: str) -> str:
    """Se il messaggio è breve o è una domanda diretta, aggiunge un'istruzione per-turno: 1-2 frasi, zero tabelle."""
    t = (text or "").strip(); low = t.lower()
    if not t:
        return ""
    is_short = len(t) <= 140
    is_q = t.endswith("?") or any(low.startswith(k) or f" {k}" in low for k in _AXON_DIRECT_Q)
    if is_short and is_q:
        return ("\n\n<TURNO_CORRENTE>La domanda dell'utente è BREVE e DIRETTA: rispondi in massimo 2 frasi, rispondendo SOLO a ciò che è stato chiesto. "
                "NIENTE tabelle, elenchi, dati aggiuntivi, alternative o contesto non richiesto (se la risposta è «no», di' solo «no» e perché in una frase). "
                "Al massimo una domanda di follow-up (es. «Vuoi che lo faccia adesso?»).</TURNO_CORRENTE>")
    if is_short:
        return "\n\n<TURNO_CORRENTE>Messaggio breve → risposta breve e proporzionale. Tabelle e dettagli solo se richiesti esplicitamente.</TURNO_CORRENTE>"
    return ""


def axon_apply_honesty_rule(system_message: str, user_text: str = "") -> str:
    """Idempotente: 4 regole assolute + onestà in testa, promemoria in coda, hint per-turno sulle domande dirette."""
    if not system_message:
        return system_message
    out = system_message
    if "<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE>" not in out:
        out = AXON_HONESTY_RULE + out
    if "<REGOLE_ASSOLUTE_AXON>" not in out:
        out = AXON_ABSOLUTE_RULES + out
    if "<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE_RIPETUTA>" not in out:
        out = out + AXON_HONESTY_FOOTER
    if "<TURNO_CORRENTE>" not in out:
        out = out + axon_direct_question_hint(user_text)
    return out


_honesty_prev_prepare_prompt = _prepare_assistant_prompt  # noqa: F821 — definita in 21_axon_streaming.py (stesso namespace)


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _honesty_prev_prepare_prompt(user, body)
    try:
        if isinstance(prep, dict) and prep.get("system_message"):
            prep["system_message"] = axon_apply_honesty_rule(prep["system_message"], str(getattr(body, "message", "") or ""))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[honesty-rule] prompt failed: %s", exc)  # noqa: F821
    return prep
