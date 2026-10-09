# axon_dates_it.py — V50.z506 — Date relative in ITALIANO calcolate in modo DETERMINISTICO (fuso Europe/Rome), non più
# delegate all'LLM: «oggi», «domani», «dopodomani», «lunedì…domenica» (= PROSSIMA occorrenza futura), «martedì prossimo»,
# «13 ottobre», «13/10», «tra 3 giorni», «tra 2 settimane» + orario «alle 10:30», «alle 10 e mezza», «alle 9», «ore 15».
# Usato da axon_agent (create/update appuntamenti e richiamate) e dal copilota vocale (Axon Drive) per CORREGGERE la data
# proposta dall'LLM: se nella frase c'è un'espressione di data riconoscibile, vince il calcolo deterministico.
import re as _adi_re
from datetime import datetime as _adi_dt, timedelta as _adi_td
from typing import Optional as _adi_Optional
from zoneinfo import ZoneInfo as _adi_ZoneInfo

ADI_ROME = _adi_ZoneInfo("Europe/Rome")
_ADI_WEEKDAYS = {"lunedi": 0, "martedi": 1, "mercoledi": 2, "giovedi": 3, "venerdi": 4, "sabato": 5, "domenica": 6}
_ADI_MONTHS = {"gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6, "luglio": 7, "agosto": 8,
               "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12}
_ADI_NUM_WORDS = {"un": 1, "una": 1, "uno": 1, "due": 2, "tre": 3, "quattro": 4, "cinque": 5, "sei": 6, "sette": 7, "otto": 8, "nove": 9, "dieci": 10,
                  "undici": 11, "dodici": 12, "tredici": 13, "quattordici": 14, "quindici": 15, "sedici": 16, "diciassette": 17, "diciotto": 18,
                  "diciannove": 19, "venti": 20, "ventuno": 21, "ventidue": 22, "ventitre": 23, "mezzogiorno": 12, "mezzanotte": 0}


def _adi_norm(text: str) -> str:
    t = (text or "").lower()
    for a, b in (("à", "a"), ("è", "e"), ("é", "e"), ("ì", "i"), ("í", "i"), ("ò", "o"), ("ó", "o"), ("ù", "u"), ("ú", "u")):
        t = t.replace(a, b)
    return " " + _adi_re.sub(r"\s+", " ", t) + " "


def it_parse_time(text: str) -> _adi_Optional[tuple]:
    """«alle 10:30» / «alle 10.30» / «alle 10 e 30» / «alle 10 e mezza» / «alle 9» / «ore 15» / «alle nove e un quarto» → (h, m) o None."""
    t = _adi_norm(text)
    m = _adi_re.search(r"\b(?:alle|all'|ore|h|per le|verso le|intorno alle)\s*(\d{1,2})\s*(?:[:.,]\s*(\d{2})|e\s+(mezz[ao]|un quarto|tre quarti|\d{1,2}))?\b", t)
    if not m:
        m2 = _adi_re.search(r"\b(?:alle|ore|per le|verso le)\s+(" + "|".join(_ADI_NUM_WORDS) + r")\b(?:\s+e\s+(mezz[ao]|un quarto|tre quarti|\d{1,2}))?", t)
        if not m2:
            m3 = _adi_re.search(r"\b(\d{1,2})[:.](\d{2})\b", t)  # «13 ottobre 10:30»
            if m3 and 0 <= int(m3.group(1)) <= 23:
                return int(m3.group(1)), int(m3.group(2))
            return None
        h = _ADI_NUM_WORDS[m2.group(1)]
        frac = m2.group(2)
    else:
        h = int(m.group(1))
        frac = m.group(2) or m.group(3)
    if h > 23:
        return None
    mnt = 0
    if frac:
        mnt = 30 if frac.startswith("mezz") else 15 if frac == "un quarto" else 45 if frac == "tre quarti" else int(frac)
    # «alle 3 del pomeriggio» / «di sera» → 24h; «alle 10» di default mattina (resta 10)
    if h < 12 and _adi_re.search(r"\b(del pomeriggio|di pomeriggio|di sera|della sera|stasera|pomeriggio)\b", t) and h <= 11 and h >= 1:
        h += 12
    return h, min(59, mnt)


def it_parse_day(text: str, now: _adi_dt) -> _adi_Optional[_adi_dt]:
    """Giorno (00:00 Europe/Rome) indicato nella frase, oppure None se non c'è alcuna espressione di data riconoscibile."""
    t = _adi_norm(text)
    now = now.astimezone(ADI_ROME)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if _adi_re.search(r"\bdopodomani\b", t):
        return today + _adi_td(days=2)
    if _adi_re.search(r"\bdomani\b", t):
        return today + _adi_td(days=1)
    if _adi_re.search(r"\b(oggi|stasera|stamattina|stamane|oggi pomeriggio)\b", t):
        return today
    # «13 ottobre», «il 13 di ottobre», «13/10», «13-10-2026»
    m = _adi_re.search(r"\b(\d{1,2})\s*(?:di\s+)?(" + "|".join(_ADI_MONTHS) + r")(?:\s+(\d{4}))?\b", t)
    if m:
        d, mo = int(m.group(1)), _ADI_MONTHS[m.group(2)]
        y = int(m.group(3)) if m.group(3) else today.year
        try:
            cand = today.replace(year=y, month=mo, day=d)
        except ValueError:
            return None
        if not m.group(3) and cand < today:
            cand = cand.replace(year=y + 1)
        return cand
    m = _adi_re.search(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", t)
    if m and not _adi_re.search(r"\b\d{1,2}[/-]\d{1,2}\s*[:.]\d{2}", t):
        d, mo = int(m.group(1)), int(m.group(2))
        y = int(m.group(3)) if m.group(3) else today.year
        if y < 100:
            y += 2000
        try:
            cand = today.replace(year=y, month=mo, day=d)
        except ValueError:
            return None
        if not m.group(3) and cand < today:
            cand = cand.replace(year=y + 1)
        return cand
    # «tra 3 giorni», «fra due settimane», «tra un mese»
    m = _adi_re.search(r"\b(tra|fra)\s+(\d{1,2}|" + "|".join(k for k in _ADI_NUM_WORDS if k not in ("mezzogiorno", "mezzanotte")) + r")\s+(giorn\w|settiman\w|mes\w)\b", t)
    if m:
        n = int(m.group(2)) if m.group(2).isdigit() else _ADI_NUM_WORDS[m.group(2)]
        unit = m.group(3)
        days = n if unit.startswith("giorn") else n * 7 if unit.startswith("settiman") else n * 30
        return today + _adi_td(days=days)
    # giorno della settimana → PROSSIMA occorrenza (oggi compreso solo se «oggi»/ora futura non specificato: si usa il prossimo giorno
    # STRETTAMENTE successivo a oggi, salvo che il giorno sia oggi e l'orario eventuale sia ancora nel futuro)
    m = _adi_re.search(r"\b(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b(\s+prossim[oa])?", t)
    if m:
        wd = _ADI_WEEKDAYS[m.group(1)]
        delta = (wd - today.weekday()) % 7
        if delta == 0:
            hm = it_parse_time(text)
            same_day_ok = hm is not None and (hm[0], hm[1]) > (now.hour, now.minute)
            if not same_day_ok or m.group(2):
                delta = 7
        elif m.group(2) and delta < 7 and _adi_re.search(r"\bprossim[oa]\b", t) and delta <= 2 and False:
            delta += 7  # (disattivato: «martedì prossimo» = il primo martedì a venire, come nell'uso comune)
        return today + _adi_td(days=delta)
    return None


def it_resolve_datetime(text: str, now: _adi_dt, default_hour: int = 10, default_minute: int = 0) -> _adi_Optional[_adi_dt]:
    """Data+ora (Europe/Rome) espressa nella frase; None se non c'è nessuna indicazione di giorno. L'orario, se assente, è il default."""
    day = it_parse_day(text, now)
    if day is None:
        return None
    hm = it_parse_time(text)
    h, mnt = hm if hm else (default_hour, default_minute)
    return day.replace(hour=h, minute=mnt)


def it_fix_datetime(text: str, llm_dt: _adi_Optional[_adi_dt], now: _adi_dt) -> _adi_Optional[_adi_dt]:
    """Corregge la data proposta dall'LLM con quella deterministica se la frase contiene un'espressione di data.
    Se la frase ha il giorno ma non l'orario, tiene l'orario dell'LLM (se c'è). Altrimenti restituisce llm_dt invariato."""
    day = it_parse_day(text, now)
    if day is None:
        return llm_dt
    hm = it_parse_time(text)
    if hm:
        return day.replace(hour=hm[0], minute=hm[1])
    if llm_dt is not None:
        l = llm_dt.astimezone(ADI_ROME) if llm_dt.tzinfo else llm_dt.replace(tzinfo=ADI_ROME)
        return day.replace(hour=l.hour, minute=l.minute)
    return day.replace(hour=10, minute=0)


def it_fmt_datetime(d: _adi_dt) -> str:
    """«martedì 13 ottobre alle 10:30» (Europe/Rome)."""
    d = d.astimezone(ADI_ROME) if d.tzinfo else d.replace(tzinfo=ADI_ROME)
    wd = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"][d.weekday()]
    mo = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"][d.month - 1]
    return f"{wd} {d.day} {mo} alle {d.strftime('%H:%M')}"
