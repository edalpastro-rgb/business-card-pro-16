"""core/response_rules.py — V50.z562 — REGOLE DI RISPOSTA protette (classificazione del messaggio).

Qualunque modulo che decide «cosa scaricare / cosa cercare sul web / quanto contesto caricare» DEVE passare da qui.
Test bloccanti nel build: tests/core/test_response_rules.py (es. «appuntamenti» NON deve attivare il download GME).
"""
import re

# Download PDF/dati GME (PUN, fasce) — SOLO a confine di parola: «appuntamenti» conteneva «pun» (bug V50.z556).
GME_KEYS_RX = re.compile(r"\b(pun|fascia|fasce|f1|f2|f3|prezzo ?medio|gme|mercatoelettrico|monorario)\b|€/[mk]wh", re.I)
PUN_LIKE_RX = re.compile(r"\b(pun|fascia|fasce|f1|f2|f3|prezzo ?medio|gme|mercato ?elettrico|arera|[mk]wh|bollett[ae]|tariff[ae]|listino energia)\b|€/[mk]wh", re.I)

# Domande che il modello risolve da solo: NIENTE ricerca web (Tavily costava 4-5 s di attesa prima del primo token).
LLM_SELF_RX = re.compile(
    r"\b(quanto fa|calcola|converti|convertimi|traduci|traducimi|come si dice|come si scrive|significato di|definizione di|sinonim[oi]|contrario di|"
    r"quanti giorni (mancano|ci sono|passano)|che giorno (della settimana )?(è|era|sarà|cade)|barzelletta|indovinello|curiosità|quanto è \d|radice quadrata|percentuale di)\b", re.I)
# …a meno che chieda attualità/prezzi (allora il web serve davvero)
LLM_SELF_WEB_OVERRIDE_RX = re.compile(r"\b(oggi|ieri|attual\w*|ultim\w*|in tempo reale|aggiornat\w*|notizi\w*|news|prezzo|costa|borsa)\b", re.I)

# Parole che indicano una domanda sui DOCUMENTI/DRIVE (il retrieval semantico deve girare, mai classe «simple»)
DRIVE_DOC_RX = re.compile(r"\b(drive|cartell\w*|listin\w*|pdf|file|documento|documenti|allegat\w*|book|catalogo|brochure|scheda tecnica|offert\w*|tariff\w*)\b", re.I)


def wants_gme_download(msg: str) -> bool:
    return bool(GME_KEYS_RX.search((msg or "").lower()))


def is_pun_like(msg: str) -> bool:
    return bool(PUN_LIKE_RX.search((msg or "").lower()))


def llm_can_answer_without_web(msg: str) -> bool:
    """True → la domanda è autosufficiente (matematica, traduzioni, definizioni…): niente Tavily."""
    return bool(LLM_SELF_RX.search(msg or "")) and not LLM_SELF_WEB_OVERRIDE_RX.search(msg or "")


def is_drive_doc_query(msg: str) -> bool:
    return bool(DRIVE_DOC_RX.search(msg or ""))
