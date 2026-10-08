# 19_axon_assistant_core.py — AxonOS: assistente base, web search, memoria persistente, allegati/URL
# Estratto da server.py (righe originali 10942-12005). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# AI Personal Assistant (Neo)
# =========================
# V50.z402 — INTENTO METEO ESPLICITO (prima: sottostringhe come «tempo», «sole», «vento», «caldo» scattavano su «quanto tempo»,
# «console», «evento», «riscaldo» → Axon riceveva dati meteo/«chiedi la città» non richiesti e poi si inventava una regola per
# giustificarsi). Ora servono parole INTERE e un'intenzione meteo chiara: «meteo», «previsioni», «che tempo fa», «piove», «nevica»…
import re as _wx_re
_WEATHER_EXPLICIT_RE = _wx_re.compile(
    r"\b(?:meteo|previsioni?\s+(?:del\s+)?(?:tempo|meteo)|previsioni|che\s+tempo\s+(?:fa|farà|fara|c'è|ce|sarà|sara|trovo)|"
    r"com'?è\s+il\s+tempo|come\s+(?:è|e'|sarà|sara)\s+il\s+tempo|tempo\s+(?:atmosferico|previsto)|"
    r"piove|pioverà|piovera|nevica|nevicherà|nevichera|grandina|"
    r"quanti\s+gradi|che\s+temperatura|temperatura\s+(?:a|in|di|oggi|domani|fuori|esterna)|"
    r"(?:c'è|ce|ci\s+sarà|ci\s+sara|fa|farà|fara)\s+(?:il\s+)?(?:sole|caldo|freddo|vento|nebbia|temporale|neve|pioggia|afa)|"
    r"allerta\s+meteo|bollettino\s+meteo|clima\s+(?:a|in|di)\s+[A-ZÀ-Ú])\b",
    _wx_re.IGNORECASE,
)
# Parole «sensibili» usate SOLO per la seconda fase (estrazione città) dopo che l'intento è esplicito
_WEATHER_KEYWORDS = ["meteo", "previsioni", "previsione", "tempo", "clima", "piove", "nevica", "temperatura", "gradi", "sole", "caldo", "freddo", "vento", "pioggia", "neve", "temporale", "nebbia"]


def _is_explicit_weather_query(text: str) -> bool:
    return bool(text) and bool(_WEATHER_EXPLICIT_RE.search(text))


_WEATHER_CODES_IT = {
    0: "sereno", 1: "prevalentemente sereno", 2: "parzialmente nuvoloso", 3: "coperto",
    45: "nebbia", 48: "nebbia con brina",
    51: "pioviggine leggera", 53: "pioviggine", 55: "pioviggine intensa",
    56: "pioviggine gelata leggera", 57: "pioviggine gelata intensa",
    61: "pioggia leggera", 63: "pioggia", 65: "pioggia intensa",
    66: "pioggia gelata leggera", 67: "pioggia gelata intensa",
    71: "neve leggera", 73: "neve", 75: "neve intensa", 77: "granuli di neve",
    80: "rovesci leggeri", 81: "rovesci", 82: "rovesci intensi",
    85: "rovesci di neve leggeri", 86: "rovesci di neve intensi",
    95: "temporale", 96: "temporale con grandine leggera", 99: "temporale con grandine intensa",
}


def _detect_weather_query(text: str) -> Optional[str]:
    """Return the city name if the message looks like a weather query, else None."""
    if not text or not _is_explicit_weather_query(text):  # V50.z402 — solo intento meteo esplicito
        return None
    import re
    stop_words = {
        "oggi", "domani", "dopodomani", "stamattina", "stanotte", "pomeriggio",
        "sera", "mattina", "adesso", "ora", "questa", "questo", "nel", "nella",
        "dalle", "alle", "verso", "tra", "entro", "settimana", "weekend",
        "prossimo", "prossima", "prossimi", "prossime",
    }
    stop = r"(?:oggi|domani|dopodomani|stamattina|stanotte|pomeriggio|sera|mattina|adesso|ora|questa|questo|nel|nella|dalle|alle|verso|tra|tra\s+\w+|entro|prossim\w+|\?|\.|,|!|$)"
    # V50.z32 — Match diretto: "meteo/tempo/previsioni <City>" (senza preposizione)
    m2 = re.search(
        r"\b(?i:meteo|previsioni|previsione|tempo|clima)\s+(?i:di\s+|a\s+|in\s+|per\s+|su\s+)?([A-ZÀ-Ú][\wÀ-úà-ú'\-]*(?:\s+[A-ZÀ-Ú]?[\wÀ-úà-ú'\-]+){0,2})",  # V50.z402 — «Meteo Roma» anche con maiuscola
        text,
    )
    if m2:
        city = m2.group(1).strip().rstrip(",.;:!?").strip()
        parts = [p for p in city.split() if p.lower() not in stop_words]
        city = " ".join(parts).strip()
        if len(city) >= 2:
            return city
    # Fallback: pattern "a/in/di/per/su <City>"
    m = re.search(
        r"\b(?:a|ad|in|di|per|su)\s+([A-ZÀ-Ú][\wÀ-úà-ú'\-]*(?:\s+(?!" + stop + r"\b)[A-ZÀ-Ú]?[\wÀ-úà-ú'\-]+){0,3})",
        text,
    )
    if m:
        city = m.group(1).strip().rstrip(",.;:!?").strip()
        parts = city.split()
        while parts and parts[-1].lower() in stop_words:
            parts.pop()
        city = " ".join(parts).strip()
        if len(city) >= 2:
            return city
    return "?"  # weather query but no city detected


async def _fetch_weather(city: str) -> Optional[dict]:
    """Fetch weather via wttr.in (no key required, Italian localized). Falls back to Open-Meteo on failure."""
    from urllib.parse import quote
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as hx:
            r = await hx.get(
                f"https://wttr.in/{quote(city)}",
                params={"format": "j1", "lang": "it"},
                headers={"User-Agent": "curl/8.0"},
            )
            if r.status_code == 200 and r.text.strip().startswith("{"):
                data = r.json()
                cur_list = data.get("current_condition") or []
                weather_days = data.get("weather") or []
                area = (data.get("nearest_area") or [{}])[0]

                resolved = ""
                try:
                    resolved = area.get("areaName", [{}])[0].get("value", "")
                    reg = area.get("region", [{}])[0].get("value", "")
                    country = area.get("country", [{}])[0].get("value", "")
                    if reg:
                        resolved += f", {reg}"
                    if country:
                        resolved += f" ({country})"
                except Exception:
                    resolved = city

                current = {}
                if cur_list:
                    c = cur_list[0]
                    desc_it = ""
                    try:
                        desc_it = c.get("lang_it", [{}])[0].get("value") or c.get("weatherDesc", [{}])[0].get("value", "")
                    except Exception:
                        desc_it = ""
                    current = {
                        "condizione": desc_it or "sconosciuta",
                        "temp_c": _to_num(c.get("temp_C")),
                        "percepita_c": _to_num(c.get("FeelsLikeC")),
                        "umidita_pct": _to_num(c.get("humidity")),
                        "vento_kmh": _to_num(c.get("windspeedKmph")),
                        "pioggia_mm": _to_num(c.get("precipMM")),
                        "cielo_pct_nuvole": _to_num(c.get("cloudcover")),
                    }

                # Group hourly buckets — wttr.in provides 8 slots (every 3h) per day
                hourly = []
                prossimi_giorni = []
                today = datetime.now().strftime("%Y-%m-%d")
                for day in weather_days[:3]:
                    d_date = day.get("date")
                    prossimi_giorni.append({
                        "giorno": d_date,
                        "max_c": _to_num(day.get("maxtempC")),
                        "min_c": _to_num(day.get("mintempC")),
                        "prob_pioggia_max_pct": max(
                            [_to_num(h.get("chanceofrain")) or 0 for h in (day.get("hourly") or [])],
                            default=0,
                        ),
                        "sunrise": (day.get("astronomy") or [{}])[0].get("sunrise"),
                        "sunset": (day.get("astronomy") or [{}])[0].get("sunset"),
                    })
                    for h in day.get("hourly") or []:
                        # h.time is "0","300","600","900","1200","1500","1800","2100"
                        try:
                            t = int(h.get("time", "0"))
                            hh = t // 100
                            slot = f"{d_date} {hh:02d}:00"
                        except Exception:
                            slot = f"{d_date}"
                        desc = ""
                        try:
                            desc = h.get("lang_it", [{}])[0].get("value") or h.get("weatherDesc", [{}])[0].get("value", "")
                        except Exception:
                            pass
                        hourly.append({
                            "ora": slot,
                            "temp_c": _to_num(h.get("tempC")),
                            "prob_pioggia_pct": _to_num(h.get("chanceofrain")),
                            "condizione": desc or "?",
                        })

                # Trim hourly to next ~24h from now
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
                hourly = [h for h in hourly if h["ora"] >= now_str.split(":")[0]]
                if len(hourly) > 12:
                    hourly = hourly[:12]

                return {
                    "citta_richiesta": city,
                    "localita_trovata": resolved or city,
                    "fonte": "wttr.in",
                    "aggiornato_alle": today,
                    "adesso": current,
                    "prossime_ore": hourly,
                    "prossimi_giorni": prossimi_giorni,
                }
    except Exception:
        pass

    # Fallback: Open-Meteo
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as hx:
            g = await hx.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "language": "it", "format": "json"},
            )
            gj = g.json() if g.status_code == 200 else {}
            results = gj.get("results") or []
            if not results:
                return {"error": f"città '{city}' non trovata"}
            loc = results[0]
            lat, lon = loc.get("latitude"), loc.get("longitude")
            resolved = f"{loc.get('name','')}"
            if loc.get("admin1"):
                resolved += f", {loc['admin1']}"
            if loc.get("country"):
                resolved += f" ({loc['country']})"

            w = await hx.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat, "longitude": lon,
                    "current": "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,relative_humidity_2m",
                    "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                    "timezone": "Europe/Rome", "forecast_days": 3,
                },
            )
            if w.status_code != 200:
                return {"error": "meteo non disponibile"}
            wj = w.json()
            cur = wj.get("current") or {}
            return {
                "citta_richiesta": city, "localita_trovata": resolved, "fonte": "open-meteo",
                "adesso": {
                    "condizione": _WEATHER_CODES_IT.get(cur.get("weather_code"), "sconosciuta"),
                    "temp_c": cur.get("temperature_2m"),
                    "percepita_c": cur.get("apparent_temperature"),
                    "vento_kmh": cur.get("wind_speed_10m"),
                    "pioggia_mm": cur.get("precipitation"),
                    "umidita_pct": cur.get("relative_humidity_2m"),
                },
            }
    except Exception as e:
        return {"error": f"errore recupero meteo: {e}"}


def _to_num(v):
    try:
        if v is None or v == "":
            return None
        return float(v) if "." in str(v) else int(v)
    except Exception:
        try:
            return float(v)
        except Exception:
            return None


def _fmt_dt_it(dt: Optional[datetime]) -> str:
    if not dt:
        return ""
    try:
        return dt.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(dt)


async def _build_assistant_context(user: dict) -> dict:
    """Fetch a compact snapshot of the user's CRM data to feed to the LLM."""
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    week_end = today_start + timedelta(days=7)

    tid = tenant_id(user)
    uid = user["user_id"]
    vis = await contact_visibility_filter(user)

    # Base query for user-scoped data (appointments/calls/callbacks: creator or assignee)
    def _own(extra: Dict[str, Any] = None) -> Dict[str, Any]:
        base = {"user_id": tid}
        if not is_owner(user):
            base["$or"] = [{"created_by": uid}, {"assignee_user_id": uid}, {"broadcast_to_user_ids": uid}]
        if extra:
            base.update(extra)
        return base

    # Upcoming appointments (next 7 days)
    appts_cursor = db.appointments.find(
        _own({"start_at": {"$gte": today_start, "$lte": week_end}}),
        {"_id": 0, "appointment_id": 1, "title": 1, "start_at": 1, "end_at": 1, "contact_id": 1, "location": 1, "area": 1, "notes": 1},
    ).sort("start_at", 1).limit(15)
    upcoming_appts = []
    async for a in appts_cursor:
        cname = None
        if a.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": a["contact_id"]}, {"first_name": 1, "last_name": 1, "phone_mobile": 1})
            if c:
                cname = f"{c.get('first_name','')} {c.get('last_name','')}".strip()
        upcoming_appts.append({
            "id": a.get("appointment_id"),
            "titolo": a.get("title") or "",
            "quando": _fmt_dt_it(a.get("start_at")),
            "cliente": cname,
            "luogo": a.get("location") or "",
            "area": a.get("area") or "",
            "note": (a.get("notes") or "")[:200],
        })

    # Today's call logs
    calls_today = await db.call_logs.count_documents(_own({"created_at": {"$gte": today_start, "$lt": today_end}}))
    # Aggregate by outcome
    outcome_agg = db.call_logs.aggregate([
        {"$match": _own({"created_at": {"$gte": today_start, "$lt": today_end}})},
        {"$group": {"_id": "$outcome_id", "count": {"$sum": 1}}},
    ])
    calls_by_outcome: Dict[str, int] = {}
    async for row in outcome_agg:
        calls_by_outcome[row["_id"] or "sconosciuto"] = row["count"]

    # Active/pending callbacks (not done, sorted by priority/next_at)
    cb_cursor = db.callbacks.find(
        _own({"$or": [{"done": False}, {"done": {"$exists": False}}]}),
        {"_id": 0, "callback_id": 1, "title": 1, "next_at": 1, "phone": 1, "priority": 1, "contact_id": 1, "notes": 1},
    ).sort([("priority", -1), ("next_at", 1)]).limit(20)
    callbacks_list = []
    async for cb in cb_cursor:
        cname = None
        if cb.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": cb["contact_id"]}, {"first_name": 1, "last_name": 1})
            if c:
                cname = f"{c.get('first_name','')} {c.get('last_name','')}".strip()
        callbacks_list.append({
            "id": cb.get("callback_id"),
            "titolo": cb.get("title") or "",
            "quando": _fmt_dt_it(cb.get("next_at")),
            "telefono": cb.get("phone") or "",
            "priorita": cb.get("priority") or "normale",
            "cliente": cname,
            "note": (cb.get("notes") or "")[:150],
        })

    # Contacts summary
    contacts_query = tenant_scope(user)
    if vis:
        contacts_query = {"$and": [contacts_query, vis]}
    total_contacts = await db.contacts.count_documents(contacts_query)
    recent_cursor = db.contacts.find(contacts_query, {
        "_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "phone_mobile": 1, "phone_work": 1, "email": 1, "city": 1, "area": 1,
    }).sort("created_at", -1).limit(5)  # V50.z421 — 15 → 5 (l elenco completo è in DATI COMPLETI CRM)
    recent_contacts = [c async for c in recent_cursor]

    # Contacts without any appointment scheduled (future)
    # Efficient: get contact_ids referenced by future appointments, then contacts NOT in that set
    future_appt_contact_ids = set()
    async for a in db.appointments.find(_own({"start_at": {"$gte": today_start}}), {"contact_id": 1}):
        if a.get("contact_id"):
            future_appt_contact_ids.add(a["contact_id"])
    orphan_query = dict(contacts_query)
    orphan_query["contact_id"] = {"$nin": list(future_appt_contact_ids)}
    orphan_count = await db.contacts.count_documents(orphan_query)
    orphan_cursor = db.contacts.find(orphan_query, {
        "_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "phone_mobile": 1, "phone_work": 1,
    }).sort("last_name", 1).limit(5)
    orphans_sample = [c async for c in orphan_cursor]

    # Contracts (last 30 days)
    since = today_start - timedelta(days=30)
    contracts_cursor = db.contracts.find(
        _own({"created_at": {"$gte": since}}),
        {"_id": 0, "contract_id": 1, "title": 1, "amount": 1, "status": 1, "created_at": 1, "contact_id": 1, "area": 1},
    ).sort("created_at", -1).limit(8)
    recent_contracts = []
    async for ct in contracts_cursor:
        cname = None
        if ct.get("contact_id"):
            c = await db.contacts.find_one({"contact_id": ct["contact_id"]}, {"first_name": 1, "last_name": 1})
            if c:
                cname = f"{c.get('first_name','')} {c.get('last_name','')}".strip()
        recent_contracts.append({
            "id": ct.get("contract_id"),
            "titolo": ct.get("title") or "",
            "importo": ct.get("amount"),
            "stato": ct.get("status") or "",
            "creato": _fmt_dt_it(ct.get("created_at")),
            "cliente": cname,
            "area": ct.get("area") or "",
        })
    contracts_total = await db.contracts.count_documents(_own({}))

    return {
        "ora_attuale": _fmt_dt_it(now),
        "utente": {
            "nome": user.get("name") or "",
            "email": user.get("email") or "",
            "ruolo": user.get("role") or "member",
        },
        "appuntamenti_prossimi_7gg": upcoming_appts,
        "telefonate_oggi": {"totale": calls_today, "per_esito": calls_by_outcome},
        "ritelefonate_attive": callbacks_list,
        "clienti": {
            "totale": total_contacts,
            "recenti": recent_contacts,
            "senza_appuntamento_futuro_totale": orphan_count,
            "senza_appuntamento_futuro_esempio": orphans_sample,
        },
        "contratti": {
            "totale": contracts_total,
            "ultimi_30_giorni": recent_contracts,
        },
    }


async def _get_assistant_name(user: dict) -> str:
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"assistant_name": 1}) or {}
    name = (s.get("assistant_name") or "").strip()
    return name or "Neo"


# ============================================================
# V50.z467 — GESTIONE ERRORI LLM (timeout, 500, crediti esauriti, connessione): MAI un errore tecnico in chat.
# Axon risponde come messaggio normale (testo + TTS): AXON_OFFLINE_MSG. L'errore reale finisce solo nei log.
# ============================================================
AXON_OFFLINE_MSG = "Sono temporaneamente offline, riprova tra qualche minuto."


def _axon_llm_failure(where: str, exc: Exception) -> str:
    """Logga l'errore tecnico e restituisce la frase amichevole da mostrare/leggere all'utente."""
    logger.warning("[axon-llm] %s: %s: %s", where, type(exc).__name__, str(exc)[:300])
    return AXON_OFFLINE_MSG


# ============================================================
# V50.z455 — FIX SERVER-SIDE (richiesta utente)
#  1) «Solo testo» = NESSUN audio generato dal backend: ogni sintesi vocale (axon_tts_generate → /assistant/tts, /ai/tts,
#     Viola/voice-copilot, Corporate Gym) legge user_settings.assistant_response_mode e, se "text", NON produce audio.
#     Il frontend riceve audio_base64 vuoto + muted=true (nessuna eccezione → nessun fallback alla voce di sistema).
#  2) Richiesta di un NUMERO DI TELEFONO → la risposta è SOLO il numero (niente fonti, link, chip, testo di contorno).
# ============================================================
_RX_PHONE_REQUEST = _wx_re.compile(
    r"\b(numero (di |del |della |dello |dell')?(telefono|cellulare|fisso|verde|tel\.?)|telefono|cellulare|recapito telefonico|"
    r"(come|dove) (lo |la |li |le )?(chiamo|contatto|telefono|raggiungo)|(a )?che numero|chiamare|telefonare)\b", _wx_re.I)
_RX_PHONE_NUMBER = _wx_re.compile(r"(?:(?:\+|00)39[\s.\-]?)?(?:0\d{1,3}|3\d{2}|80[03])[\s.\-]?\d{2,4}(?:[\s.\-]?\d{2,4}){1,2}\b")


async def _axon_text_only_mode(user: dict) -> bool:
    """True se l'utente ha scelto «Solo testo» (default): il backend non deve produrre audio."""
    try:
        s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"assistant_response_mode": 1}) or {}
    except Exception:  # noqa: BLE001 — in dubbio, silenzio
        return True
    return (s.get("assistant_response_mode") or "text") == "text"


def _axon_is_phone_request(msg: str) -> bool:
    return bool(msg) and bool(_RX_PHONE_REQUEST.search(msg))


def _axon_phone_only_reply(msg: str, reply: str) -> Optional[str]:
    """Se l'utente ha chiesto un numero di telefono e la risposta ne contiene almeno uno → restituisce SOLO il numero
    (o i numeri, uno per riga, max 3). None se non applicabile (nessun numero trovato → la risposta resta com'è)."""
    if not _axon_is_phone_request(msg):
        return None
    txt = _wx_re.sub(r"\*\*|__|`", "", reply or "")
    out: List[str] = []
    for m in _RX_PHONE_NUMBER.finditer(txt):
        raw = m.group(0).strip()
        digits = _wx_re.sub(r"\D", "", raw)
        if len(digits) < 6 or len(digits) > 13:
            continue
        if any(_wx_re.sub(r"\D", "", o) == digits for o in out):
            continue
        out.append(raw)
        if len(out) >= 3:
            break
    return "\n".join(out) if out else None




# ============================================================
# V38T — Neo web-search (Tavily) + persistent memory
# ============================================================
_ENERGY_KEYWORDS = [
    # Wholesale energy market
    "pun", "gme", "mgp", "gse", "mercato elettrico", "mercato del gas",
    "psv", "ttf", "ipex", "spot", "borsa elettrica",
    # V50.z446 — «borsa dell'energia (elettrica)», «borsa energia», «borsa del gas», «energia elettrica», «prezzo dell'energia», «mercato energetico»
    "borsa del gas", "borsa gas", "energia elettrica", "prezzo dell'energia",
    "prezzo dell’energia", "prezzo energia", "prezzo del gas", "prezzo gas", "mercato energetico", "mercato dell'energia", "mercato dell’energia",
    "mercato energia", "prezzo unico nazionale", "zonale", "prezzi zonali", "mgp", "mercato del giorno prima",
    # Regulator + specifics
    "arera", "delibera", "delibere", "autorità energia",
    "oneri di sistema", "oneri generali", "componente asos", "arim",
    # Tariffs / bill terms
    "tariffa", "tariffe", "quota energia", "quota potenza", "quota fissa",
    "spesa materia energia", "spesa materia gas", "trasporto e gestione",
    # Adjacent lookup topics
    "cip 6", "certificati bianchi", "titoli di efficienza",
    "conguaglio", "aggiornamento trimestrale", "aggiornamento mensile",
    "regolatorio", "normativa energia",
]


# V50.z448 — «borsa dell'energia» / «titoli energetici» = QUOTAZIONI AZIONARIE a Piazza Affari (Enel, Terna, A2A, Snam, Italgas, Eni, Hera…),
# NON il mercato elettrico GME/PUN: niente fonti istituzionali energia, ricerca generale con query arricchita.
_RX_ENERGY_STOCKS = re.compile(
    r"borsa\s+(dell'|dell’|dell |della |del |di |sull'|sull’)?\s*energia|titol[oi]\s+energetic\w*|azion[ei]\s+(energetic\w*|enel|terna|a2a|snam|italgas|eni|hera|erg)\b|"
    r"\b(enel|terna|a2a|snam|italgas|hera|erg)\b.*\b(borsa|azion\w*|titol\w*|quotazion\w*|chiusura|rialzo|ribasso)\b|"
    r"\b(borsa|azion\w*|titol\w*|quotazion\w*|chiusura|rialzo|ribasso)\b.*\b(enel|terna|a2a|snam|italgas|hera|erg)\b|"
    r"(comparto|settore|titoli)\s+(energia|energetico|utilities|utility)", re.I)
_ENERGY_STOCKS_QUERY = "quotazioni oggi Piazza Affari titoli energetici Enel Terna A2A Snam Italgas Eni Hera chiusura rialzo ribasso"


def _is_energy_stocks_query(text: str) -> bool:
    return bool(text) and bool(_RX_ENERGY_STOCKS.search(text))


def _detect_energy_query(text: str) -> bool:
    """True when the message mentions Italian energy market data that
    warrants a live Tavily search (PUN, ARERA delibere, tariffs, oneri…).

    V38T-fix — Use word-boundary regex so "appuntamento" doesn't match "pun".
    V50.z448 — «borsa dell'energia» (titoli azionari) NON è mercato elettrico → False (va in ricerca generale finanziaria).
    """
    if not text:
        return False
    if _is_energy_stocks_query(text):
        return False
    lower = text.lower()
    import re as _re
    for kw in _ENERGY_KEYWORDS:
        # Multi-word phrases → use simple substring (they can't collide)
        if " " in kw:
            if kw in lower:
                return True
            continue
        # Single-word keywords → require word boundaries
        if _re.search(rf"\b{_re.escape(kw)}\b", lower):
            return True
    return False


async def _tavily_search(query: str, max_results: int = 5, country: Optional[str] = None, general: bool = False) -> Optional[dict]:
    """V38T — Query the Tavily search API. Returns a compact answer block or None.

    V50.z36 — Cache in-memory 15 min per query identiche.
    V50.z37 — Cache SEMANTICA: query simili (embedding cosine > 0.88) tornano
    la stessa risposta senza chiamare Tavily. Es. 'PUN agosto 2026' e 'Costo
    PUN mese di agosto 2026' condividono la stessa cache hit.
    """
    key = (os.environ.get("TAVILY_API_KEY") or "").strip()
    if not key:
        logger.error("[tavily] TAVILY_API_KEY mancante/vuota nel .env → ricerca web NON eseguita per «%s»", (query or "")[:80])  # V50.z444 — mai silenzioso
        return None

    global _TAVILY_CACHE  # noqa: PLW0603
    try:
        _TAVILY_CACHE  # type: ignore[name-defined]
    except NameError:
        _TAVILY_CACHE = {}  # {cache_key: (ts, result, embedding|None, raw_query)}
    q_norm = (query or "").strip().lower()
    if not q_norm:
        return None
    cache_key = f"{q_norm}|{max_results}|{country or ''}{'|g' if general else ''}"  # V50.z440 — ricerca generale separata
    now_ts = datetime.utcnow()

    # Fast path: exact match
    hit = _TAVILY_CACHE.get(cache_key)
    if hit:
        ts, cached, _emb, _raw = hit
        if (now_ts - ts).total_seconds() < 900:
            return cached

    # Semantic match: cerca la query più simile tra quelle in cache non scadute
    # Usa embedding solo se non-trivial (>= 12 caratteri e almeno 2 parole).
    q_embedding: Optional[List[float]] = None
    if len(q_norm) >= 12 and len(q_norm.split()) >= 2:
        try:
            q_embedding = await _axon_embed(query)
        except Exception:
            q_embedding = None
    if q_embedding:
        SIM_THRESHOLD = 0.88   # bilanciato: 0.90 troppo stretto, 0.85 troppo largo
        best_sim = 0.0
        best_result = None
        for k, (ts, cached, emb, _raw) in _TAVILY_CACHE.items():
            if not emb:
                continue
            # Filtra su max_results/country matching per non mescolare varianti
            if not k.endswith(f"|{max_results}|{country or ''}"):
                continue
            if (now_ts - ts).total_seconds() >= 900:
                continue
            sim = _cosine_sim(q_embedding, emb)
            if sim > best_sim:
                best_sim = sim
                best_result = cached
        if best_sim >= SIM_THRESHOLD and best_result:
            logger.info("[tavily-cache] semantic HIT sim=%.3f", best_sim)
            return best_result

    # Sweep opportunistico
    if len(_TAVILY_CACHE) > 200:
        stale = [k for k, (t, _, _, _) in _TAVILY_CACHE.items() if (now_ts - t).total_seconds() > 1800]
        for k in stale:
            _TAVILY_CACHE.pop(k, None)

    try:
        payload: Dict[str, Any] = {
            "api_key": key,
            "query": query,
            "search_depth": "advanced",
            "include_answer": True,
            "include_raw_content": False,
            "max_results": max_results,
        }
        if not general:  # V50.z440 — persona «assistente personale»: ricerca web su tutto il web, non solo fonti energia
            payload["include_domains"] = [
                "arera.it", "mercatoelettrico.org", "gse.it",
                "gme.it", "snam.it", "terna.it", "acquirente-unico.it",
                "borsaitaliana.it", "governo.it", "gazzettaufficiale.it",
            ]
        if country:
            payload["country"] = country
        async with httpx.AsyncClient(timeout=15) as hx:
            r = await hx.post(
                "https://api.tavily.com/search",
                json=payload,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},  # V50.z444 — auth anche via header (api_key nel body è legacy)
            )
            if r.status_code >= 400:
                logger.error("[tavily] HTTP %s per «%s»: %s", r.status_code, (query or "")[:80], (r.text or "")[:200])
            r.raise_for_status()
            try:
                logger.info("[tavily] OK «%s» general=%s → %d risultati", (query or "")[:70], general, len((r.json() or {}).get("results") or []))  # V50.z445
            except Exception:  # noqa: BLE001
                pass
            data = r.json()
            result = {
                "answer": data.get("answer") or "",
                "results": [
                    {
                        "title": it.get("title") or "",
                        "url": it.get("url") or "",
                        "content": (it.get("content") or "")[:600],
                    } for it in (data.get("results") or [])[:max_results]
                ],
                "query": query,
            }
            if result.get("answer") or result.get("results"):
                _TAVILY_CACHE[cache_key] = (now_ts, result, q_embedding, query)
            return result
    except Exception as e:
        logger.warning("tavily search failed for %s: %s", query, e)
        return None


async def _load_neo_memories(user_id: str, limit: int = 5) -> List[dict]:
    """Return the user's most recent persistent memories (for injection)."""
    cursor = db.neo_memory.find(
        {"user_id": user_id},
        {"_id": 0, "memory_id": 1, "summary": 1, "facts": 1, "created_at": 1},
    ).sort("created_at", -1).limit(limit)
    return [m async for m in cursor]


async def _maybe_save_memory(user_id: str, session_id: str, assistant_name: str) -> None:
    """After a chat exchange, decide whether to distill the session into a
    long-lived memory row. We only save when the session has >= 6 messages
    (3 user + 3 assistant) AND has not already been persisted in the last
    10 minutes for this session_id."""
    total = await db.assistant_messages.count_documents({
        "user_id": user_id, "session_id": session_id,
    })
    if total < 6:
        return
    recent = await db.neo_memory.find_one({
        "user_id": user_id, "session_id": session_id,
        "created_at": {"$gte": utcnow() - timedelta(minutes=10)},
    })
    if recent:
        return
    # Collect last 12 turns
    cursor = db.assistant_messages.find(
        {"user_id": user_id, "session_id": session_id},
        {"_id": 0, "role": 1, "content": 1},
    ).sort("created_at", -1).limit(12)
    msgs = [m async for m in cursor]
    msgs.reverse()
    if not msgs:
        return
    convo = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in msgs)
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=key,
            session_id=f"memory_{session_id}",
            system_message=(
                "Sei un motore di distillazione della memoria per un CRM italiano. "
                "Ricevi una conversazione tra un utente (Consulente Energia) e l'assistente "
                f"{assistant_name}. Estrai i FATTI DUREVOLI: clienti menzionati, decisioni prese, "
                "analisi svolte, preferenze utente. Ignora scambi triviali (saluti, chiarimenti).\n"
                "Rispondi in JSON PURO nel formato:\n"
                "{\"summary\": \"riassunto in 1-2 frasi (max 200 caratteri)\", "
                "\"facts\": [\"fatto 1 conciso\", \"fatto 2 conciso\", ...]}\n"
                "Se la conversazione è banale (solo saluti/chiarimenti) rispondi "
                "{\"summary\": \"\", \"facts\": []}. "
                "Massimo 8 fatti, ciascuno < 120 caratteri."
            ),
        ).with_model("anthropic", "claude-haiku-4-5")
        raw = await chat.send_message(UserMessage(text=convo))
        raw_clean = (raw or "").strip()
        # LLM sometimes wraps JSON in code fences
        if raw_clean.startswith("```"):
            raw_clean = raw_clean.strip("`")
            if raw_clean.startswith("json"):
                raw_clean = raw_clean[4:]
            raw_clean = raw_clean.strip()
        parsed = _json_stdlib.loads(raw_clean)
        summary = (parsed.get("summary") or "").strip()
        facts = [str(f).strip() for f in (parsed.get("facts") or []) if str(f).strip()]
        if not summary and not facts:
            return
        await db.neo_memory.insert_one({
            "memory_id": f"mem_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "session_id": session_id,
            "summary": summary[:220],
            "facts": facts[:8],
            "created_at": utcnow(),
            "updated_at": utcnow(),
        })
    except Exception as e:
        logger.warning("_maybe_save_memory failed: %s", e)



# V28.l — Estrae testo da un allegato inviato in chat (PDF, immagini, TXT/CSV, Excel).
async def _extract_attachment_text(att: "AssistantAttachmentIn") -> str:
    """Best-effort text extraction. Never raises to caller.

    - PDF (application/pdf): via PyMuPDF (fitz), tutti i testi delle pagine.
    - Immagini (image/*): via Gemini vision se disponibile, altrimenti [Immagine allegata].
    - Excel (.xlsx / spreadsheet mime): via openpyxl in modalità read-only.
    - CSV / TXT / JSON / Markdown: decodifica UTF-8 diretta.
    - Altri: [Formato non supportato].
    """
    import base64 as _b64
    try:
        raw = _b64.b64decode(att.data_base64, validate=False)
    except Exception as exc:
        return f"[Impossibile decodificare {att.name}: {exc}]"
    mime = (att.mime or "").lower()
    name = (att.name or "").lower()

    # PDF
    if mime == "application/pdf" or name.endswith(".pdf"):
        try:
            # V50.z210 — PyMuPDF nel sottoprocesso worker (mai nel processo API). Cap 60k char, tronca sulla pagina che supera il limite.
            text_out = (await heavy_call("pdf_text", data=raw, max_pages=0, max_chars=60000)).get("text") or ""
            # V50.z7 — Fallback OCR con Claude Vision se PyMuPDF non estrae testo
            # (PDF scansionato / immagine). Max 5 pagine per non essere lento.
            if len(text_out) < 100:
                try:
                    key = os.environ.get("EMERGENT_LLM_KEY")
                    if key:
                        pages_img = (await heavy_call("pdf_render_pages", data=raw, max_pages=5, scale=2.0, fmt="jpeg", quality=80)).get("images") or []
                        ocr_parts: List[str] = []
                        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
                        for i, jpg in enumerate(pages_img):
                            try:
                                b64 = _b64.b64encode(jpg).decode()
                                chat = LlmChat(
                                    api_key=key,
                                    session_id=f"pdf-ocr-att-{uuid.uuid4().hex[:8]}",
                                    system_message="Sei un OCR italiano. Trascrivi ESATTAMENTE tutto il testo visibile. Preserva tabelle in Markdown. Solo testo, nessun commento.",
                                ).with_model("anthropic", "claude-haiku-4-5")
                                content = [ImageContent(image_base64=b64, media_type="image/jpeg")]
                                resp = await chat.send_message(UserMessage(text="Trascrivi tutto il testo di questa pagina.", images=content))  # type: ignore
                                if resp and resp.strip():
                                    ocr_parts.append(f"[Pagina {i+1} · OCR Vision]\n{resp.strip()}")
                            except Exception as exc_p:
                                logger.debug("[att-pdf-ocr] page %d failed: %s", i, exc_p)
                        if ocr_parts:
                            text_out = "\n\n".join(ocr_parts)
                            logger.info("[att-pdf-ocr] recovered %d pages via Vision (name=%s)", len(ocr_parts), att.name)
                except Exception as exc:
                    logger.debug("[att-pdf-ocr] fallback failed: %s", exc)
            return text_out or "[PDF senza testo estraibile — controlla se è scansionato/protetto]"
        except Exception as exc:
            return f"[Errore lettura PDF: {exc}]"

    # Excel .xlsx / .xls
    if name.endswith(".xlsx") or "spreadsheet" in mime or "excel" in mime or name.endswith(".xls"):
        try:
            import io as _io
            # V50.z89 — Fallback per .xls (formato legacy Excel 97-2003) via xlrd
            if name.endswith(".xls") and not name.endswith(".xlsx"):
                try:
                    import xlrd  # type: ignore
                    wb = xlrd.open_workbook(file_contents=raw)
                    out = []
                    for sh_name in wb.sheet_names()[:6]:
                        sh = wb.sheet_by_name(sh_name)
                        out.append(f"### Foglio: {sh_name}")
                        for i in range(min(sh.nrows, 200)):
                            row = sh.row_values(i)
                            cells = [str(c) if c is not None else "" for c in row]
                            if any(cells):
                                out.append(" | ".join(cells))
                        if sh.nrows > 200:
                            out.append("... (righe successive omesse)")
                    return "\n".join(out) if out else "[Excel vuoto]"
                except Exception as exc_xls:
                    return f"[Errore lettura .xls legacy: {exc_xls}]"
            from openpyxl import load_workbook
            wb = load_workbook(filename=_io.BytesIO(raw), read_only=True, data_only=True)
            out = []
            for sh in wb.sheetnames[:6]:
                ws = wb[sh]
                out.append(f"### Foglio: {sh}")
                for i, row in enumerate(ws.iter_rows(values_only=True)):
                    if i > 200:
                        out.append("... (righe successive omesse)")
                        break
                    cells = [str(c) if c is not None else "" for c in row]
                    if any(cells):
                        out.append(" | ".join(cells))
            wb.close()
            return "\n".join(out) if out else "[Excel vuoto]"
        except Exception as exc:
            return f"[Errore lettura Excel: {exc}]"

    # V50.z89 — CSV strutturato come tabella Markdown (rende molto meglio al LLM)
    if name.endswith(".csv") or mime in ("text/csv", "application/csv"):
        try:
            import csv as _csv
            text = raw.decode("utf-8-sig", errors="replace")
            # Auto-detect separatore ; , \t | dalle prime righe
            sample = text[:4096]
            try:
                dialect = _csv.Sniffer().sniff(sample, delimiters=",;\t|")
                sep = dialect.delimiter
            except Exception:
                sep = "," if sample.count(",") >= sample.count(";") else ";"
            rows = list(_csv.reader(text.splitlines(), delimiter=sep))
            if not rows:
                return "[CSV vuoto]"
            out = [f"### CSV ({len(rows)} righe, separatore='{sep}')"]
            # Prime max 200 righe come pipe-table
            for i, r in enumerate(rows[:200]):
                out.append(" | ".join((c or "").strip() for c in r))
            if len(rows) > 200:
                out.append(f"... ({len(rows) - 200} righe successive omesse)")
            return "\n".join(out)
        except Exception as exc:
            return f"[Errore lettura CSV: {exc}]"

    # Testo semplice / JSON / Markdown
    if mime.startswith("text/") or name.endswith((".txt", ".csv", ".json", ".md", ".log", ".yml", ".yaml")):
        try:
            return raw.decode("utf-8", errors="replace")
        except Exception as exc:
            return f"[Errore decodifica testo: {exc}]"

    # Immagini — analizza tramite Gemini se disponibile, altrimenti descrizione minima
    if mime.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp")):
        try:
            # Riutilizziamo la vision helper già esistente per l'analisi bollette
            from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
            key = os.environ.get("EMERGENT_LLM_KEY")
            if not key:
                return f"[Immagine {att.name} ({len(raw)} byte) — LLM vision non configurato]"
            chat = LlmChat(
                api_key=key, session_id=f"attach_{uuid.uuid4().hex[:8]}",
                system_message="Sei un assistente che descrive immagini in modo dettagliato in italiano. Estrai testo (OCR) e descrivi grafici, tabelle, dati numerici e contesto generale.",
            ).with_model("gemini", "gemini-2.5-flash")
            msg = UserMessage(
                text=f"Analizza questa immagine ('{att.name}') e descrivine il contenuto in italiano. Se contiene testo, riportalo. Se contiene numeri/tabelle, elencali.",
                file_contents=[ImageContent(image_base64=att.data_base64)],
            )
            resp = await chat.send_message(msg)
            return (str(resp) or "").strip() or f"[Immagine {att.name} — nessun contenuto estratto]"
        except Exception as exc:
            return f"[Immagine {att.name} — analisi non disponibile: {exc}]"

    return f"[File {att.name} — tipo {mime or 'sconosciuto'} non supportato per estrazione testo]"


async def _tavily_search_smart(query: str, energy: bool) -> Optional[dict]:
    """V50.z446 — energia + fatto attuale («borsa dell'energia oggi», «PUN di oggi»): fonti istituzionali (ARERA/GME) E web generale
    (quotidiani/portali con il dato del giorno) in parallelo, risultati uniti (istituzionali prima). Altrimenti una sola ricerca."""
    _info = globals().get("_nav_is_info_query")
    if _is_energy_stocks_query(query):  # V50.z448 — borsa dell'energia = azioni energetiche Piazza Affari
        return await _tavily_search(f"{query} — {_ENERGY_STOCKS_QUERY}", general=True)
    if not energy:
        return await _tavily_search(query, general=True)
    if not (_info and _info(query)):
        return await _tavily_search(query)
    # V50.z452 — UNA SOLA ricerca per richiesta (prima: 2 in parallelo): generale con hint alle fonti istituzionali
    return await _tavily_search(f"{query} (GME PUN ARERA dati ufficiali oggi)", max_results=6, general=True)


# V50.z438 — Foto multiple → UNICO documento
_MAX_CHAT_ATTACHMENTS = 10


def _is_image_attachment(att) -> bool:
    mime = (getattr(att, "mime", "") or "").lower()
    name = (getattr(att, "name", "") or "").lower()
    return mime.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp", ".heic"))


def _implicit_attachment_prompt(attachments: List, merge_images: bool = True) -> str:
    """Richiesta implicita quando l'utente invia allegati SENZA testo (Bug B + foto multiple)."""
    atts = list(attachments or [])[:_MAX_CHAT_ATTACHMENTS]
    images = [a for a in atts if _is_image_attachment(a)]
    if merge_images and len(images) >= 2 and len(images) == len(atts):
        return (
            f"Le {len(images)} foto allegate sono pagine dello STESSO documento. Leggile insieme, in ordine, e crea UN UNICO riepilogo "
            "del documento: tipo di documento, intestatario/controparti, dati chiave (importi, date, codici, POD/PDR), punti salienti. "
            "Non descrivere le foto una per una."
        )
    names = ", ".join((a.name or "allegato") for a in atts[:5])
    return f"Analizza l'allegato ({names}) e descrivi in modo preciso cosa contiene: testo, dati, importi, nomi, date e tutto ciò che è utile."


async def _extract_multi_image_document(images: List) -> str:
    """UNA sola chiamata vision con tutte le foto come pagine dello stesso documento → trascrizione/riepilogo unificato."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        key = os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            return f"[{len(images)} immagini — LLM vision non configurato]"
        names = ", ".join((a.name or f"pagina {i+1}") for i, a in enumerate(images))
        chat = LlmChat(
            api_key=key, session_id=f"attach_multi_{uuid.uuid4().hex[:8]}",
            system_message=(
                "Sei un lettore di documenti italiano. Ricevi PIÙ FOTO che sono PAGINE DELLO STESSO DOCUMENTO (in ordine). "
                "Trattale come un unico documento: trascrivi il testo rilevante pagina per pagina (OCR fedele, tabelle in Markdown), "
                "poi produci una sezione finale 'RIEPILOGO UNICO DEL DOCUMENTO' con tipo documento, intestatario/controparti, "
                "dati chiave (importi, date, codici, POD/PDR, scadenze) e punti salienti. Non descrivere le foto separatamente."
            ),
        ).with_model("gemini", "gemini-2.5-flash")
        msg = UserMessage(
            text=f"Documento composto da {len(images)} pagine/foto ({names}). Leggile tutte insieme e produci trascrizione + RIEPILOGO UNICO.",
            file_contents=[ImageContent(image_base64=a.data_base64) for a in images],
        )
        resp = await chat.send_message(msg)
        return (str(resp) or "").strip() or f"[{len(images)} immagini — nessun contenuto estratto]"
    except Exception as exc:
        logger.warning("[att-multi-image] failed (%d images): %s", len(images), exc)
        return f"[Documento multipagina ({len(images)} foto) — analisi non disponibile: {exc}]"


# =========================
# V50.z90 — Attachment/URL processing avanzato per chat AxonOS
#   1) Auto-fetch URL nel messaggio via Tavily Extract
#   2) Riepilogo automatico file > 10k caratteri (via LLM)
#   3) Modalità confronto attiva se 2+ file tabellari (CSV/XLSX)
# =========================
_URL_RE = re.compile(r'https?://[^\s<>"\'`\)\]]+', re.IGNORECASE)


async def _tavily_extract_url(url: str) -> Optional[str]:
    """Estrae il testo pulito di una URL via Tavily Extract API con cache DB (TTL 24h).
    None se fallisce."""
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        return None
    # V50.z91 — Cache DB per non richiamare Tavily se lo stesso link torna
    import hashlib
    url_norm = url.strip().rstrip('/').lower()
    url_key = hashlib.sha256(url_norm.encode("utf-8")).hexdigest()
    _CACHE_TTL_HOURS = 24
    try:
        cached = await db.url_extract_cache.find_one({"url_key": url_key}, {"_id": 0})
        if cached and cached.get("fetched_at"):
            fetched = cached["fetched_at"]
            # Motor legge datetime come TZ-naive → forza UTC-aware per il confronto
            if isinstance(fetched, datetime):
                if fetched.tzinfo is None:
                    fetched = fetched.replace(tzinfo=timezone.utc)
                age_h = (utcnow() - fetched).total_seconds() / 3600.0
                if age_h < _CACHE_TTL_HOURS:
                    logger.debug(f"[axon-url-extract] cache HIT for {url_norm} (age {age_h:.1f}h)")
                    title = cached.get("title") or ""
                    content = cached.get("content") or ""
                    return f"### {title}\n{content}" if title else content
    except Exception as exc:
        logger.debug(f"[axon-url-extract] cache read failed: {exc}")

    try:
        async with _httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.tavily.com/extract",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"urls": [url]},
            )
            if resp.status_code >= 400:
                return None
            data = resp.json()
            results = data.get("results") or []
            if not results:
                return None
            r0 = results[0]
            content = r0.get("raw_content") or r0.get("content") or ""
            title = r0.get("title") or ""
            if not content:
                return None
            if len(content) > 8000:
                content = content[:8000] + "\n\n[... contenuto troncato ...]"
            # Salva cache
            try:
                await db.url_extract_cache.update_one(
                    {"url_key": url_key},
                    {"$set": {
                        "url_key": url_key,
                        "url": url_norm,
                        "title": title,
                        "content": content,
                        "fetched_at": utcnow(),
                    }},
                    upsert=True,
                )
            except Exception as exc:
                logger.debug(f"[axon-url-extract] cache write failed: {exc}")
            return f"### {title}\n{content}" if title else content
    except Exception as exc:
        logger.debug(f"[axon-url-extract] {url} failed: {exc}")
        return None


# V50.z430 — Bug 14: fetch DIRETTO di qualsiasi URL pubblica (fallback quando Tavily manca/fallisce):
# HTML → testo pulito (BeautifulSoup), PDF (anche senza estensione .pdf) → testo via _extract_pdf_text_bytes.
_DIRECT_FETCH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AdvisorOS-Axon/1.0"
_DIRECT_FETCH_MAX = 12 * 1024 * 1024


def _html_to_text(html: str) -> tuple[str, str]:
    """Ritorna (titolo, testo) da HTML grezzo."""
    try:
        from bs4 import BeautifulSoup  # type: ignore
        soup = BeautifulSoup(html, "html.parser")
        for t in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe"]):
            t.decompose()
        title = (soup.title.get_text(" ", strip=True) if soup.title else "") or ""
        main = soup.find("main") or soup.find("article") or soup.body or soup
        text = main.get_text("\n", strip=True)
    except Exception:
        title = ""
        text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return title.strip(), text


async def _direct_fetch_url(url: str) -> Optional[str]:
    """Scarica una URL pubblica e ne restituisce il testo (HTML o PDF). None se non raggiungibile/leggibile."""
    try:
        async with _httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers={"User-Agent": _DIRECT_FETCH_UA, "Accept": "text/html,application/pdf,*/*;q=0.8"}) as client:
            async with client.stream("GET", url) as r:
                if r.status_code >= 400:
                    return None
                ctype = (r.headers.get("content-type") or "").lower()
                buf = bytearray()
                async for chunk in r.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > _DIRECT_FETCH_MAX:
                        break
        data = bytes(buf)
        if not data:
            return None
        if "pdf" in ctype or data[:5] == b"%PDF-":
            text = await asyncio.to_thread(_extract_pdf_text_bytes, data) or ""  # noqa: F821 — 27_teach_ai_kb.py
            title = url.rsplit("/", 1)[-1]
        elif "html" in ctype or "xml" in ctype or data[:1000].lower().find(b"<html") >= 0:
            title, text = _html_to_text(data.decode(r.encoding or "utf-8", errors="ignore"))
        elif ctype.startswith("text/") or "json" in ctype:
            title, text = "", data.decode("utf-8", errors="ignore")
        else:
            return None
        text = (text or "").strip()
        if len(text) < 40:
            return None
        if len(text) > 8000:
            text = text[:8000] + "\n\n[... contenuto troncato ...]"
        return f"### {title}\n{text}" if title else text
    except Exception as exc:
        logger.debug(f"[axon-url-direct] {url} failed: {exc}")
        return None


async def _summarize_long_text(text: str, source_name: str) -> str:
    """Riassume un file lungo (>10k caratteri) con Claude Haiku via emergentintegrations.
    Fallback: prime 8000 caratteri troncati."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
        key = os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            raise RuntimeError("no key")
        chat = LlmChat(
            api_key=key,
            session_id=f"summarize-{uuid.uuid4().hex[:8]}",
            system_message=(
                "Sei un riassuntore esperto per un CRM energia italiano. Ricevi il contenuto di un file allegato. "
                "Produci un riassunto strutturato in ITALIANO con: 1) Tipo di documento (bolletta/contratto/tabella prezzi/ecc.), "
                "2) Dati chiave (numeri, date, importi, POD/PDR, controparti), 3) Punti salienti. "
                "Se è una tabella, riporta le prime 5-10 righe come esempio. Max 2500 caratteri."
            ),
        ).with_model("anthropic", "claude-haiku-4-5")
        # Cap input a 60k char per non far esplodere il token count
        content = text[:60000]
        resp = await chat.send_message(UserMessage(
            text=f"File: {source_name}\n\n---INIZIO CONTENUTO---\n{content}\n---FINE CONTENUTO---\n\nProduci il riassunto strutturato richiesto."
        ))
        return (str(resp) or "").strip() or text[:8000]
    except Exception as exc:
        logger.debug(f"[axon-summarize] {source_name} failed: {exc}")
        return text[:8000] + "\n\n[... contenuto troncato — riassunto non disponibile ...]"


async def _search_axon_kb(user_id: str, query: str, top_k: int = 3) -> List[dict]:
    """Ricerca keyword-based nella KB del tenant.
    Score = title×5 + note×3 + content×1 (cap 5). Ritorna top_k con score>0."""
    if not user_id or not query:
        return []
    _STOP = {"come", "cosa", "dove", "quando", "perché", "quale", "quali", "sono", "questo", "questa", "quello", "quella", "molto", "poco", "bene", "male", "prendi", "cerca", "puoi", "voglio", "vorrei", "posso"}
    words = [w.lower() for w in re.findall(r"[A-Za-zÀ-ÿ0-9]{4,}", query or "") if w.lower() not in _STOP][:8]
    if not words:
        return []
    docs = await db.axon_kb.find(
        {"user_id": user_id},
        {"_id": 0, "kb_id": 1, "url": 1, "title": 1, "content": 1, "note": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(500)
    scored: List[dict] = []
    for d in docs:
        title = (d.get("title") or "").lower()
        note = (d.get("note") or "").lower()
        content = (d.get("content") or "").lower()
        score = 0
        matched: List[str] = []
        for w in words:
            ht = title.count(w); hn = note.count(w); hc = content.count(w)
            if ht or hn or hc:
                score += ht * 5 + hn * 3 + min(hc, 5)
                matched.append(w)
        if score > 0:
            d["_score"] = score
            d["_matched"] = matched
            scored.append(d)
    scored.sort(key=lambda x: x["_score"], reverse=True)
    return scored[:top_k]


async def _build_kb_section(user_id: str, msg: str) -> str:
    """Costruisce una sezione RAG con fonti KB rilevanti per la domanda."""
    results = await _search_axon_kb(user_id, msg, top_k=3)
    if not results:
        return ""
    parts: List[str] = []
    for r in results:
        title = r.get("title") or r.get("url") or "Fonte"
        url = r.get("url") or ""
        note = (r.get("note") or "").strip()
        content = r.get("content") or ""
        excerpt = content[:1800]
        if r.get("_matched"):
            first_term = r["_matched"][0]
            idx = content.lower().find(first_term)
            if idx >= 0:
                start = max(0, idx - 200)
                excerpt = content[start:start + 1800]
        parts.append(
            f"--- 📚 KB: {title} ---\n"
            f"URL: {url}\n"
            + (f"Nota: {note}\n" if note else "")
            + f"Rilevanza: {r['_score']} · Match: {', '.join(r.get('_matched', []))}\n\n"
            + excerpt
        )
    return (
        "\n\nFONTI KB RILEVANTI (pagine web salvate in precedenza dall'utente in Knowledge Base — "
        "usale come contesto autorevole; quando citi dati specifici, menziona il titolo della fonte):\n"
        + "\n\n".join(parts)
        + "\n\n"
    )


async def _build_attachments_section_advanced(msg: str, attachments: List, merge_images: bool = True) -> str:
    """Costruisce la sezione ALLEGATI arricchita:
    - Auto-fetch URL trovate nel messaggio
    - Riassunto automatico per file > 10k caratteri
    - Tag CONFRONTO se 2+ file tabellari (CSV/XLSX)
    - V50.z438 — 2+ immagini con merge_images → UNA sola analisi vision come documento multipagina
    """
    parts: List[str] = []
    tabular_names: List[str] = []
    merged_doc_pages = 0

    # --- 1) URL auto-fetch (max 2 URL per messaggio) ---
    url_matches = _URL_RE.findall(msg or "")[:2]
    seen_urls: set = set()
    for u in url_matches:
        u_clean = u.rstrip('.,;:!?)"\']')
        if u_clean in seen_urls:
            continue
        seen_urls.add(u_clean)
        _pdf_in = globals().get("_axon_pdf_links_in")
        if _pdf_in and u_clean in _pdf_in(u_clean):
            continue  # link PDF espliciti: già scaricati e letti dal parser PDF (36b)
        # V50.z430 — Bug 14: Tavily → fallback fetch diretto (HTML/PDF); se entrambi falliscono Axon lo dice chiaramente
        extract = await _tavily_extract_url(u_clean) or await _direct_fetch_url(u_clean)
        if extract:
            parts.append(f"CONTENUTO DELLA PAGINA {u_clean} (letta ora dal server; usala per rispondere, non citare questa intestazione):\n{extract}")
        else:
            parts.append(f"PAGINA {u_clean}: non raggiungibile o senza testo leggibile (sito protetto/dinamico). Dillo all'utente in una frase e chiedi di incollare il testo o caricare il file.")

    # --- 2) Attachments con riassunto per file grandi ---
    atts = list(attachments or [])[:_MAX_CHAT_ATTACHMENTS]
    # V50.z438 — Foto multiple = pagine dello stesso documento → una sola chiamata vision, un solo testo
    images = [a for a in atts if _is_image_attachment(a)]
    if merge_images and len(images) >= 2:
        merged_doc_pages = len(images)
        merged = await _extract_multi_image_document(images)
        names = ", ".join((a.name or "foto") for a in images)
        parts.append(f"--- DOCUMENTO MULTIPAGINA ({merged_doc_pages} foto: {names}) · analizzato come UN UNICO documento ---\n{merged[:30000]}")
        atts = [a for a in atts if not _is_image_attachment(a)]
    for att in atts:
        try:
            extracted = await _extract_attachment_text(att)
        except Exception as exc:
            extracted = f"[Errore lettura {att.name}: {exc}]"
        if not extracted:
            continue
        name_lower = (att.name or "").lower()
        mime_lower = (att.mime or "").lower()
        is_tabular = name_lower.endswith((".csv", ".xlsx", ".xls")) or "spreadsheet" in mime_lower or "excel" in mime_lower or mime_lower in ("text/csv",)
        if is_tabular:
            tabular_names.append(att.name)
        # Riepilogo auto se > 10k
        if len(extracted) > 10000:
            summary = await _summarize_long_text(extracted, att.name)
            parts.append(
                f"--- File: {att.name} ({att.mime or 'unknown'}) · {len(extracted)} caratteri · RIEPILOGO AUTOMATICO ---\n{summary}\n\n"
                f"[Nota: il file è stato riassunto automaticamente. Contenuto integrale disponibile su richiesta.]"
            )
        else:
            parts.append(f"--- File: {att.name} ({att.mime or 'unknown'}) ---\n{extracted[:25000]}")

    if not parts:
        return ""

    header = "\n\nALLEGATI / LINK CARICATI DALL'UTENTE (analizzali come CONTESTO PRINCIPALE della domanda):\n"
    if merged_doc_pages >= 2:
        header += (
            f"\n📄 DOCUMENTO UNICO: le {merged_doc_pages} foto allegate sono PAGINE DELLO STESSO DOCUMENTO. "
            "Produci UN SOLO riepilogo coerente del documento (non una descrizione per ogni foto); se l'utente ha fatto una domanda, "
            "rispondi usando l'intero documento.\n"
        )
    footer = (
        "\n\nQuando rispondi, cita esplicitamente il contenuto rilevante (numeri, clausole, valori, date, nomi) "
        "e menziona il nome del file/URL da cui provengono."
    )
    # --- 3) Modalità confronto se 2+ file tabellari ---
    if len(tabular_names) >= 2:
        header += (
            "\n⚡ MODALITÀ CONFRONTO ATTIVA: sono presenti " + str(len(tabular_names)) +
            " file tabellari (" + ", ".join(tabular_names) + "). "
            "Se l'utente non specifica diversamente, produci un CONFRONTO strutturato riga-per-riga / colonna-per-colonna "
            "evidenziando differenze principali, dati comuni e valori chiave. Restituisci una tabella Markdown finale con le differenze salienti.\n"
        )

    return header + "\n\n".join(parts) + footer


# V29.k — Costruisce il blocco "Insegna ad Axon" per la chat Axon.
# REGRESSIONE FIX: i file allegati alle regole (PDF GME, Optima, ecc.) ora vengono
# effettivamente letti e iniettati nel system prompt della chat, così Axon può citarli
# invece di dire "non trovo il file, ricaricalo".
class _RuleAttachmentShim:
    """Duck-typed shim compatibile con `_extract_attachment_text` (che accetta
    un oggetto con .name / .mime / .data_base64)."""
    __slots__ = ("name", "mime", "data_base64")

    def __init__(self, name: str, mime: Optional[str], data_base64: str):
        self.name = name or ""
        self.mime = mime or ""
        self.data_base64 = data_base64 or ""


def _rule_relevance_score(rule: dict, msg_lc: str) -> int:
    """Scoring semplice per prioritizzare regole rilevanti al messaggio utente.
    Match su title, text, categories e nomi file (senza estensione)."""
    if not msg_lc:
        return 0
    score = 0
    tokens = [t for t in msg_lc.replace(",", " ").replace(".", " ").split() if len(t) >= 3]
    haystacks = [
        (rule.get("title") or "").lower(),
        (rule.get("text") or "")[:2000].lower(),
        " ".join(rule.get("categories") or [rule.get("category") or ""]).lower(),
    ]
    for f in (rule.get("files") or []):
        haystacks.append((f.get("name") or "").lower())
    for h in haystacks:
        for t in tokens:
            if t in h:
                score += 2 if h == haystacks[0] else 1
    return score


# ============================================================================
