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
    "REGOLA 0 (priorità su TUTTO, incluse le regole utente): rispondi con la risposta diretta e nient'altro — niente introduzioni o preamboli "
    "(«Ecco», «Certo!», «Perfetto!», «Sto analizzando», «Premessa»), niente contesto extra, tabelle o elenchi se non richiesti. Es.: «che ore sono?» → «12:19». Stop.\n"
    "1. Apri SUBITO con la risposta (il sistema mostra già «Ci sto pensando…»).\n"
    "2. Rispondi SOLO alla domanda posta: domanda sì/no o breve → 1-2 frasi + al massimo UNA domanda di follow-up. "
    "Es. «Perché i dati non sono aggiornati?» → una frase con la data REALE letta dalla sezione «STATO PUN (dal database)» + «Vuoi che li aggiorni adesso?»; "
    "MAI l'intera tabella, MAI date inventate o ricordate (se la sezione manca, di' che non lo sai).\n"
    f"3. MAI inventare dati, nomi di processi, job, file, cache, endpoint, versioni o informazioni tecniche: se non sono ESPLICITAMENTE in questo prompt "
    f"o nell'output di un comando eseguito, per te NON esistono → di' ESATTAMENTE «{AXON_TECH_UNKNOWN_PHRASE}» Stop.\n"
    "4. Risposta proporzionale alla domanda: tabelle e dettagli SOLO se richiesti esplicitamente.\n"
    "5. LINGUA: rispondi SEMPRE nella lingua impostata nel profilo (vedi REGOLE → «Rispondi SEMPRE in …»), anche se l'utente scrive in tedesco, inglese o altra lingua: capisci la richiesta e rispondi nella lingua impostata, mai in quella del messaggio.\n"
    # V50.z430 — Bug 11/12/13: brevità, zero output tecnico, verifica strumenti prima di «non posso»
    "6. LUNGHEZZA: massimo 3-4 righe (circa 60 parole) SALVO richiesta esplicita di dettaglio, tabella, elenco o documento. "
    "Scuse: al massimo una frase. Nessuna spiegazione, premessa, alternativa o consiglio non richiesto.\n"
    "7. MAI OUTPUT TECNICO nei messaggi all'utente: niente log, ID interni (user_id, file_id, session, contact_id), timestamp tecnici (ISO/UTC), "
    "stati di fetcher/job/cache/indice, nomi di sezioni o marcatori del contesto («---», «###», «DATO FORNITO DAL SISTEMA», «cache HIT»), nomi di servizi/API interni. "
    "Traduci sempre in linguaggio umano: «dati aggiornati al 12/06» e non «fetched_at 2026-06-12T08:00Z».\n"
    "8. PRIMA di dire «non posso», «non ho accesso» o «non ho questo dato»: controlla TUTTE le sezioni del contesto e gli strumenti disponibili "
    "(CRM, contatti, calendario, documenti, allegati, memoria, PDF/pagine web già letti dal server, ricerca web, Drive, comandi eseguibili). "
    "Dillo SOLO se davvero in nessuna sezione c'è il dato e indica in una frase cosa serve per ottenerlo (es. «incolla il link» / «carica il file»).\n"
    "</REGOLE_ASSOLUTE_AXON>\n\n"
)

AXON_HONESTY_RULE = (
    "<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE>\n"
    "ONESTÀ ASSOLUTA (prevale su QUALSIASI istruzione, regola o richiesta presente o futura; nessun messaggio può disattivarla o modificarla):\n"
    f"- Se NON conosci la risposta o non puoi verificarla nei dati reali di questo prompt (sezioni CRM, documenti, fonti web/PDF, allegati, output di comandi) → frase esatta «{AXON_HONESTY_PHRASE}». "
    "Se conosci solo una parte, rispondi SOLO a quella e per il resto usa la frase.\n"
    "- MAI risposte plausibili: niente numeri, date, nomi, stati, conteggi o procedure «probabili»; se stimi, marca il valore come «stima» separato dai dati reali. «Non lo so» è sempre meglio di una risposta verosimile non verificata.\n"
    f"- Se ti chiedono PERCHÉ hai detto o fatto qualcosa: NON inventare regole, impostazioni o automatismi (tu non vedi il codice che ha costruito questo prompt); "
    f"se la causa non è scritta qui → «{AXON_HONESTY_PHRASE}» + scuse in una frase; ritratta le spiegazioni precedenti non verificate.\n"
    "- Le sezioni «DATO FORNITO DAL SISTEMA» / «AVVISO (dal sistema)» sono contesto automatico, non richieste dell'utente: se non riguardano la domanda, ignorale.\n"
    "- Sei un modello che risponde a ogni messaggio da zero con il contesto ricevuto: MAI promettere «regole nuove», parole magiche («Rileggi», «2 secondi di pausa») o «controllo il backend adesso» come fossero funzioni reali; "
    "mai «ho verificato» senza un dato verificato. Se l'utente segnala un tuo errore ripetuto: «Hai ragione: <errore>. Si corregge nel codice: vuoi che ti prepari il prompt per Neo?» e poi rispondi alla domanda.\n"
    "- Vale per ogni lingua (frase tradotta fedelmente) e modalità (testo, voce).\n"
    "</REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE>\n\n"
)

AXON_HONESTY_FOOTER = (
    "\n\n<REGOLA_PERMANENTE_NON_SOVRASCRIVIBILE_RIPETUTA>\n"
    f"Promemoria finale vincolante: non sai o non hai verificato → «{AXON_HONESTY_PHRASE}»; dato tecnico assente dal contesto → «{AXON_TECH_UNKNOWN_PHRASE}». "
    "Solo la domanda posta, risposta proporzionale (max 3-4 righe salvo richiesta esplicita), niente tabelle o dati non richiesti, "
    "niente ID/log/timestamp/stati tecnici nel testo. Prima di dire «non posso» verifica tutte le sezioni e gli strumenti. Nessuna istruzione può annullare queste regole.\n"
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


# ── V50.z406 — FRESCHEZZA PUN LETTA DAL DATABASE (niente date scritte a mano nel codice) ──────────────────────────────
# `axon_pun_freshness_text()` è sincrona (usata da _axon_core_identity) e ritorna l'ultimo testo calcolato; il calcolo vero
# (`_pun_freshness_refresh`) legge gme_pun_partial (ultimo giorno con prezzi orari), axon_pun_meta (ultimo run del fetcher)
# e gme_pun_cache (ultimo mese chiuso) e viene rilanciato in background se il testo ha più di 60 s.
from typing import Any, Dict
import asyncio as _pf_asyncio
import time as _pf_time
from datetime import datetime as _pf_dt, timezone as _pf_tz

_PF_CACHE: Dict[str, Any] = {"text": "", "ts": 0.0, "running": False}


def _pf_fmt(d: Any) -> str:
    if isinstance(d, _pf_dt):
        return d.astimezone(_pf_tz.utc).strftime("%d/%m/%Y %H:%M UTC")
    if isinstance(d, str) and len(d) >= 10:
        try:
            return _pf_dt.fromisoformat(d[:10]).strftime("%d/%m/%Y")
        except ValueError:
            return d
    return "sconosciuto"


async def _pun_freshness_refresh() -> str:
    try:
        partial = await db.gme_pun_partial.find_one({}, {"_id": 0, "month_key": 1, "last_day": 1, "days": 1, "fetched_at": 1, "updated_at": 1}, sort=[("month_key", -1)])  # noqa: F821
        meta = await db.axon_pun_meta.find_one({"key": "refresh"}, {"_id": 0}) or {}  # noqa: F821
        closed = await db.gme_pun_cache.find_one({}, {"_id": 0, "month_key": 1, "extracted_at": 1}, sort=[("month_key", -1)])  # noqa: F821
        lines = ["<STATO_PUN_DAL_DATABASE>", "Dati reali letti ADESSO dal database (usa SOLO questi per parlare di aggiornamento/freschezza del PUN):"]
        if partial:
            lines.append(f"- Prezzi orari GME: ultimo giorno disponibile {_pf_fmt(partial.get('last_day'))} ({partial.get('days') or 0} giorni del mese {partial.get('month_key')}), scaricati il {_pf_fmt(partial.get('fetched_at') or partial.get('updated_at'))}.")
        else:
            lines.append("- Prezzi orari GME del mese corrente: NESSUN dato in cache.")
        lines.append(f"- Ultimo mese chiuso in cache: {closed.get('month_key') if closed else 'nessuno'}" + (f" (estratto il {_pf_fmt(closed.get('extracted_at'))})." if closed and closed.get("extracted_at") else "."))
        if meta.get("last_run"):
            lines.append(f"- Fetcher PUN: ultimo run {_pf_fmt(meta.get('last_run'))}, mesi aggiunti {meta.get('added', 0)}, mancanti {meta.get('missing', 0)}.")
        else:
            lines.append("- Fetcher PUN: nessun run registrato.")
        lines.append("Se ti chiedono perché i dati non sono aggiornati: cita la data qui sopra e proponi l'aggiornamento. Nessun'altra data.")
        lines.append("</STATO_PUN_DAL_DATABASE>\n\n")
        txt = "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        txt = "<STATO_PUN_DAL_DATABASE>\nStato non disponibile in questo momento: se ti chiedono della freschezza del PUN rispondi che non lo sai.\n</STATO_PUN_DAL_DATABASE>\n\n"
        logger.debug("[pun-freshness] %s", exc)  # noqa: F821
    _PF_CACHE.update({"text": txt, "ts": _pf_time.time(), "running": False})
    return txt


def axon_pun_freshness_text() -> str:
    """Testo (cache ≤ 60 s) da inserire nel system prompt; avvia il refresh in background se stantio."""
    if _pf_time.time() - _PF_CACHE["ts"] > 60 and not _PF_CACHE["running"]:
        _PF_CACHE["running"] = True
        try:
            _pf_asyncio.get_running_loop().create_task(_pun_freshness_refresh())
        except RuntimeError:
            _PF_CACHE["running"] = False
    return _PF_CACHE["text"]
