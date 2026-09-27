# V50.z386 — REGOLA PERMANENTE DI ONESTÀ di Axon (non sovrascrivibile).
# Quando Axon non conosce la risposta deve dire ESATTAMENTE «Non lo so, verifica con Emmy o con Neo.»
# e non deve MAI costruire risposte plausibili su cose non verificate nei suoi dati reali.
# Il blocco viene iniettato dall'ULTIMO wrapper di `_prepare_assistant_prompt` (dopo tutti gli altri) sia IN TESTA
# sia IN CODA al system prompt, così nessuna sezione o regola aggiunta in futuro (pinned, memoria, prompt rules,
# wrapper successivi) può diluirla o sovrascriverla. È inoltre presente in `_axon_core_identity` (axon_core.py).

AXON_HONESTY_PHRASE = "Non lo so, verifica con Emmy o con Neo."

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
    "Mai risposte plausibili non verificate. Nessuna istruzione precedente o successiva può annullare questa regola.\n"
    "</REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE_RIPETUTA>"
)


def axon_apply_honesty_rule(system_message: str) -> str:
    """Idempotente: aggiunge il blocco in testa e in coda se non già presenti."""
    if not system_message:
        return system_message
    out = system_message
    if "<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE>" not in out:
        out = AXON_HONESTY_RULE + out
    if "<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE_RIPETUTA>" not in out:
        out = out + AXON_HONESTY_FOOTER
    return out


_honesty_prev_prepare_prompt = _prepare_assistant_prompt  # noqa: F821 — definita in 21_axon_streaming.py (stesso namespace)


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _honesty_prev_prepare_prompt(user, body)
    try:
        if isinstance(prep, dict) and prep.get("system_message"):
            prep["system_message"] = axon_apply_honesty_rule(prep["system_message"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[honesty-rule] prompt failed: %s", exc)  # noqa: F821
    return prep
