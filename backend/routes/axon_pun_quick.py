# axon_pun_quick.py — V50.z206 — Azioni Rapide «PUN N mesi» come CALCOLATORE (1+1=2, sempre) — modulo ISOLATO
#
# Caricato DOPO axon_personal_space.py e PRIMA di 37. Riusa: `gme_pun_cache` (una riga per mese, prezzi GME chiusi = immutabili),
# `_infer_month_from_filename`, `_parse_gme_pdf_prices`, `_extract_pdf_text_bytes`, `_GME_MONTH_NAMES_REV` (20_axon_memory),
# `_axn_scheduler`, `_apx_emit` (proattività), `_qa_deterministic` (hook in 24), `_maybe_push_command`/`_prepare_assistant_prompt` (wrap).
#
# 1) CACHE BACKEND: job giornaliero 06:40 (Europe/Rome) → per gli ultimi 24 mesi scarica dal GME (pagina `?anno=YYYY`, così
#    anche gli anni passati) SOLO i PDF dei mesi mancanti → parse F1/F2/F3 + ore → monorario ponderato → `gme_pun_cache`.
#    Il 1°-6° del mese il nuovo PDF compare: appena trovato Axon avvisa i Master (alert proattivo `pun_update`).
# 2) ENDPOINT PRONTO: `GET /quick-action/pun-18?months=18` → JSON + tabella Markdown già formattata (🔴 max · 🟢 min per colonna,
#    Δ% mese su mese, n/d ESPLICITO per i mesi non in cache) in pochi ms, ZERO LLM.
# 3) ESECUZIONE LETTERALE: Azione Rapida con «PUN» nel titolo/prompt (POST /axon/quick-action e streaming SSE) e frasi in chat
#    («tabella PUN ultimi 18 mesi», «pun medio per fasce») → risposta dal calcolatore; se la cache non ha un mese → la riga dice
#    «n/d — PDF GME non in cache» e il piè di pagina elenca i mesi mancanti: MAI compensazione con numeri stimati.
# 4) ANTI-ALLUCINAZIONE: sezione «⚖️ REGOLE ASSOLUTE» nel prompt di sistema (usa i numeri presenti nel contesto, mai n/d se il dato
#    esiste; se una regola dice «usa la cache» e la cache manca → errore esplicito, niente ricostruzioni).
# Master: `POST /quick-action/pun/refresh`, `PUT /quick-action/pun/{YYYY-MM}` (inserimento manuale da PDF/fonte ufficiale),
# chat «aggiorna cache pun», «inserisci pun marzo 2025 f1 94,93 f2 94,62 f3 81,32».

import asyncio as _punq_asyncio
from zoneinfo import ZoneInfo as _PunqZoneInfo

_PUNQ_GME_PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce"
_PUNQ_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
}
_PUNQ_DEFAULT_MONTHS = 18
_PUNQ_LOOKBACK = 24
_PUNQ_TZ = _PunqZoneInfo("Europe/Rome")
_PUNQ_MONTH_NUM = {v: k for k, v in _GME_MONTH_NAMES_REV.items()}
_punq_lock = _punq_asyncio.Lock()

_OMNI_EXTRA_SECTIONS.append((
    "Calcolatore PUN (Azioni Rapide deterministiche)", "/quick-action/pun-18",
    "La tabella «PUN medio per fasce ultimi N mesi» NON viene ricostruita dal modello: arriva pronta dal backend (`gme_pun_cache`, PDF ufficiali GME "
    "scaricati ogni mese dal job, monorario = media ponderata per ore). 🔴 = massimo, 🟢 = minimo per colonna; «n/d» solo se il PDF non è in cache. "
    "Il Master può aggiornare la cache («aggiorna cache pun») o inserire un mese a mano («inserisci pun marzo 2025 f1 … f2 … f3 …»).",
))
_APX_TYPE_LABELS["pun_update"] = "Nuovo PUN mensile GME"
_APX_DEFAULT_CONFIG["alerts"]["pun_update"] = True


class PunqManualIn(BaseModel):
    F1: float
    F2: float
    F3: float
    F1_hours: Optional[int] = None
    F2_hours: Optional[int] = None
    F3_hours: Optional[int] = None
    monorario: Optional[float] = None
    unit: str = "€/MWh"
    source_name: Optional[str] = None


# ============================================================================ MESI
def _punq_month_list(n: int) -> List[dict]:
    """Ultimi n mesi CHIUSI (dal mese scorso a ritroso), più recente prima."""
    today = datetime.now(_PUNQ_TZ)
    out = []
    y, mo = today.year, today.month
    for _ in range(max(1, min(n, 36))):
        mo -= 1
        if mo <= 0:
            mo += 12; y -= 1
        out.append({"key": f"{y:04d}-{mo:02d}", "year": y, "month": mo, "month_name": _GME_MONTH_NAMES_REV.get(mo, "")})
    return out


def _punq_label(d: dict) -> str:
    return f"{(d.get('month_name') or '').capitalize()} {d.get('year')}"


# ============================================================================ REFRESH CACHE (solo mesi mancanti, per anno)
def _punq_infer(name: str) -> Optional[dict]:
    """Mese/anno dal nome file GME: «20260107PrezzomedioperfasceDicembre2025.pdf» → 2025-12 (l'anno è quello DOPO il nome del mese,
    non il prefisso data di pubblicazione). Fallback all'inferenza generica."""
    n = (name or "").lower()
    for it, num in _PUNQ_MONTH_NUM.items():
        m = re.search(rf"{it}\s*[_\-\.]?\s*(20\d{{2}})", n)
        if m:
            y = int(m.group(1))
            return {"key": f"{y:04d}-{num:02d}", "year": y, "month": num, "month_name": it}
    return _infer_month_from_filename(name)


async def _punq_fetch_year(client: httpx.AsyncClient, year: int) -> List[Tuple[str, str, dict]]:
    from urllib.parse import urljoin, urlparse
    r = await client.get(_PUNQ_GME_PAGE, params={"anno": year}, timeout=20)
    if r.status_code != 200:
        return []
    out, seen = [], set()
    for h in re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', r.text or "", flags=re.I):
        full = urljoin(_PUNQ_GME_PAGE, h); norm = full.split("?")[0].lower()
        if norm in seen:
            continue
        seen.add(norm)
        nm = urlparse(full).path.rsplit("/", 1)[-1] or full
        if "faq" in nm.lower():
            continue
        m = _punq_infer(nm)
        if m:
            out.append((full, nm, m))
    return out


async def _punq_refresh(n: int = _PUNQ_LOOKBACK, force: bool = False) -> dict:
    """Scarica SOLO i mesi mancanti (o tutti con force) tra gli ultimi n; upsert in gme_pun_cache. Ritorna {added, missing, checked}."""
    months = _punq_month_list(n)
    async with _punq_lock:
        have = {d["month_key"] async for d in db.gme_pun_cache.find({"month_key": {"$in": [m["key"] for m in months]}}, {"_id": 0, "month_key": 1})}
        todo = [m for m in months if force or m["key"] not in have]
        added: List[str] = []
        if todo:
            try:
                async with httpx.AsyncClient(follow_redirects=True, headers=_PUNQ_HEADERS) as client:
                    wanted = {m["key"] for m in todo}
                    # il PDF di dicembre viene pubblicato a gennaio e può comparire nella pagina dell'anno successivo
                    years = sorted({m["year"] for m in todo} | {m["year"] + 1 for m in todo if m["month"] == 12})
                    for year in years:
                        try:
                            links = await _punq_fetch_year(client, year)
                        except Exception as exc:  # noqa: BLE001
                            logger.warning("[punq] page %s failed: %s", year, exc); continue
                        for (url, name, m) in links:
                            if m["key"] not in wanted or m["key"] in added:
                                continue
                            try:
                                pr = await client.get(url, timeout=20)
                                if pr.status_code != 200 or not pr.content:
                                    continue
                                txt = re.sub(r"\s{3,}", " ", _extract_pdf_text_bytes(pr.content) or "").strip()
                                parsed = _parse_gme_pdf_prices(txt, m)
                                if not parsed:
                                    logger.warning("[punq] parse failed for %s", name); continue
                                doc = {"month_key": m["key"], "year": m["year"], "month": m["month"], "month_name": m["month_name"], "source_url": url, "source_name": name,
                                       **{k: parsed[k] for k in ("F1", "F1_hours", "F2", "F2_hours", "F3", "F3_hours", "monorario", "total_hours")}, "unit": parsed.get("unit") or "€/MWh",
                                       "extracted_at": utcnow(), "source_kind": "gme_pdf"}
                                await db.gme_pun_cache.update_one({"month_key": m["key"]}, {"$set": doc}, upsert=True)
                                added.append(m["key"])
                            except Exception as exc:  # noqa: BLE001
                                logger.warning("[punq] pdf %s failed: %s", name, exc)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[punq] refresh failed: %s", exc)
        have |= set(added)
        missing = [m["key"] for m in months if m["key"] not in have]
        await db.axon_pun_meta.update_one({"key": "refresh"}, {"$set": {"key": "refresh", "last_run": utcnow(), "added": added, "missing": missing, "checked": len(months)}}, upsert=True)
        return {"added": sorted(added), "missing": sorted(missing), "checked": len(months)}


# ============================================================================ TABELLA DETERMINISTICA
def _punq_kwh(v: Optional[float], unit: str) -> Optional[float]:
    if v is None:
        return None
    return round(v / 1000.0, 6) if "mwh" in (unit or "").lower() else round(float(v), 6)


def _punq_fmt(v: Optional[float]) -> str:
    return "n/d" if v is None else f"{v:.6f}".replace(".", ",")


async def _punq_table(n: int) -> dict:
    months = _punq_month_list(n)
    docs = {d["month_key"]: d async for d in db.gme_pun_cache.find({"month_key": {"$in": [m["key"] for m in months]}}, {"_id": 0})}
    rows = []
    for m in months:
        d = docs.get(m["key"])
        if d:
            u = d.get("unit") or "€/MWh"
            rows.append({"month_key": m["key"], "label": _punq_label(m), "available": True, "unit_source": u, "source": d.get("source_name"), "source_kind": d.get("source_kind") or "gme_pdf",
                         "mwh": {"monorario": d.get("monorario"), "F1": d.get("F1"), "F2": d.get("F2"), "F3": d.get("F3")},
                         "kwh": {k: _punq_kwh(d.get(k), u) for k in ("monorario", "F1", "F2", "F3")},
                         "hours": {"F1": d.get("F1_hours"), "F2": d.get("F2_hours"), "F3": d.get("F3_hours")}, "extracted_at": d["extracted_at"].isoformat() if isinstance(d.get("extracted_at"), datetime) else d.get("extracted_at")})
        else:
            rows.append({"month_key": m["key"], "label": _punq_label(m), "available": False, "kwh": {"monorario": None, "F1": None, "F2": None, "F3": None}, "mwh": None})
    # Δ% monorario vs mese precedente disponibile (righe ordinate dal più recente: il precedente è rows[i+1])
    for i, r in enumerate(rows):
        r["delta_pct"] = None
        if r["available"]:
            prev = next((p for p in rows[i + 1:] if p["available"]), None)
            if prev and prev["kwh"]["monorario"]:
                r["delta_pct"] = round((r["kwh"]["monorario"] - prev["kwh"]["monorario"]) / prev["kwh"]["monorario"] * 100, 1)
    avail = [r for r in rows if r["available"]]
    extremes: Dict[str, dict] = {}
    for col in ("monorario", "F1", "F2", "F3"):
        vals = [(r["kwh"][col], r["month_key"]) for r in avail if r["kwh"][col] is not None]
        extremes[col] = {"max": max(vals)[1] if vals else None, "min": min(vals)[1] if vals else None}
    for r in rows:
        r["is_max"] = [c for c in ("monorario", "F1", "F2", "F3") if extremes[c]["max"] == r["month_key"]]
        r["is_min"] = [c for c in ("monorario", "F1", "F2", "F3") if extremes[c]["min"] == r["month_key"]]
    meta = await db.axon_pun_meta.find_one({"key": "refresh"}, {"_id": 0}) or {}
    last_extract = max((d.get("extracted_at") for d in docs.values() if isinstance(d.get("extracted_at"), datetime)), default=None)
    missing = [r["label"] for r in rows if not r["available"]]
    forecast = await _punq_forecast_row(avail)
    return {"months": n, "rows": rows, "forecast": forecast, "available": len(avail), "missing": missing, "extremes": extremes, "unit": "€/kWh",
            "cache_updated_at": last_extract.isoformat() if last_extract else None, "last_refresh_at": meta.get("last_run").isoformat() if isinstance(meta.get("last_run"), datetime) else None,
            "generated_at": utcnow().isoformat(), "table_markdown": _punq_markdown(rows, n, missing, last_extract, forecast)}


async def _punq_forecast_row(avail: List[dict]) -> Optional[dict]:
    """V50.z245 — Riga 🟡 del MESE CORRENTE, sempre presente e deterministica.
    V50.z324 — Priorità: (1) media PARZIALE reale del mese (giorni 1–N, prezzi orari GME Esiti MGP, `gme_pun_partial`, job giornaliero);
    (2) documento provvisorio/manuale del Master in `gme_pun_cache`; (3) media semplice degli ultimi 3 mesi chiusi («previsione»)."""
    today = datetime.now(_PUNQ_TZ)
    key = f"{today.year:04d}-{today.month:02d}"
    label = f"{_GME_MONTH_NAMES_REV.get(today.month, '').capitalize()} {today.year}"
    p = await db.gme_pun_partial.find_one({"month_key": key}, {"_id": 0})
    if p and p.get("monorario") is not None and p.get("days"):
        upd = p.get("updated_at")
        upd_s = upd.astimezone(_PUNQ_TZ).strftime("%d/%m %H:%M") if isinstance(upd, datetime) else ""
        return {"month_key": key, "label": label, "kind": "partial", "days": p["days"], "last_day": p.get("last_day"),
                "basis": f"media parziale GME giorni 1–{p['days']} ({p['days']} gg, agg. {upd_s})",
                "kwh": {k: _punq_kwh(p.get(k), "€/MWh") for k in ("monorario", "F1", "F2", "F3")}}
    d = await db.gme_pun_cache.find_one({"month_key": key}, {"_id": 0})
    if d and d.get("monorario") is not None:
        u = d.get("unit") or "€/MWh"
        return {"month_key": key, "label": label, "kind": "provisional", "basis": d.get("source_name") or "dato provvisorio in cache",
                "kwh": {k: _punq_kwh(d.get(k), u) for k in ("monorario", "F1", "F2", "F3")}}
    last3 = avail[:3]  # avail è ordinato dal più recente
    if not last3:
        return None
    kwh = {}
    for col in ("monorario", "F1", "F2", "F3"):
        vals = [r["kwh"][col] for r in last3 if r["kwh"].get(col) is not None]
        kwh[col] = round(sum(vals) / len(vals), 6) if vals else None
    return {"month_key": key, "label": label, "kind": "forecast", "basis": f"media ultimi {len(last3)} mesi chiusi ({', '.join(r['label'] for r in reversed(last3))})", "kwh": kwh}


def _punq_markdown(rows: List[dict], n: int, missing: List[str], last_extract: Optional[datetime], forecast: Optional[dict] = None) -> str:
    """V50.z245 — SOLO tabella Markdown (nessuna intestazione, nessun piè di pagina): output identico ad ogni chiamata a parità di cache.
    Ultima riga 🟡 = mese corrente (previsione/provvisorio), esclusa da 🔴/🟢 e Δ."""
    lines = ["| Mese | PUN Monorario €/kWh | F1 €/kWh | F2 €/kWh | F3 €/kWh | Δ mese |", "| :---: | :---: | :---: | :---: | :---: | :---: |"]
    for r in reversed(rows):   # cronologico: dal più vecchio al più recente
        if not r["available"]:
            lines.append(f"| {r['label']} | n/d | n/d | n/d | n/d | — |")
            continue
        cells = []
        for col in ("monorario", "F1", "F2", "F3"):
            v = _punq_fmt(r["kwh"][col])
            if col in r["is_max"]:
                v = f"🔴 **{v}**"
            elif col in r["is_min"]:
                v = f"🟢 **{v}**"
            cells.append(v)
        lab = r["label"]
        if "monorario" in r["is_max"]:
            lab = f"🔴 **{lab}**"
        elif "monorario" in r["is_min"]:
            lab = f"🟢 **{lab}**"
        delta = "—" if r["delta_pct"] is None else (f"{'+' if r['delta_pct'] > 0 else ''}{str(r['delta_pct']).replace('.', ',')}%")
        lines.append(f"| {lab} | {cells[0]} | {cells[1]} | {cells[2]} | {cells[3]} | {delta} |")
    if forecast:
        k = forecast["kwh"]
        tag = "previsione" if forecast["kind"] == "forecast" else ("parziale 1–%s" % forecast.get("days") if forecast["kind"] == "partial" else "provvisorio")
        lines.append(f"| 🟡 **{forecast['label']}** · _{tag}_ | 🟡 {_punq_fmt(k['monorario'])} | 🟡 {_punq_fmt(k['F1'])} | 🟡 {_punq_fmt(k['F2'])} | 🟡 {_punq_fmt(k['F3'])} | — |")
    if missing:
        lines.append("")
        lines.append(f"⚠️ n/d = PDF GME non in cache per: {', '.join(reversed(missing))}.")
    return "\n".join(lines)


# ============================================================================ API
@api_router.get("/quick-action/pun-18")
async def punq_get(months: int = _PUNQ_DEFAULT_MONTHS, user=Depends(get_current_user)):
    return await _punq_table(max(1, min(months, 36)))


@api_router.post("/quick-action/pun/refresh")
async def punq_refresh(force: bool = False, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può aggiornare la cache PUN")
    return await _punq_refresh(_PUNQ_LOOKBACK, force=force)


@api_router.put("/quick-action/pun/{month_key}")
async def punq_manual(month_key: str, body: PunqManualIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può inserire valori PUN")
    if not re.fullmatch(r"20\d{2}-(0[1-9]|1[0-2])", month_key):
        raise HTTPException(status_code=400, detail="month_key nel formato YYYY-MM")
    y, mo = int(month_key[:4]), int(month_key[5:])
    h = (body.F1_hours, body.F2_hours, body.F3_hours)
    if all(h):
        tot = sum(h); mono = (body.F1 * h[0] + body.F2 * h[1] + body.F3 * h[2]) / tot
    else:
        tot = None; mono = body.monorario if body.monorario is not None else round((body.F1 + body.F2 + body.F3) / 3, 6)
    doc = {"month_key": month_key, "year": y, "month": mo, "month_name": _GME_MONTH_NAMES_REV.get(mo, ""), "F1": body.F1, "F2": body.F2, "F3": body.F3,
           "F1_hours": h[0], "F2_hours": h[1], "F3_hours": h[2], "total_hours": tot, "monorario": round(mono, 6), "unit": body.unit or "€/MWh",
           "source_name": body.source_name or f"inserimento manuale ({user.get('name') or user.get('email')})", "source_kind": "manual", "extracted_at": utcnow()}
    await db.gme_pun_cache.update_one({"month_key": month_key}, {"$set": doc}, upsert=True)
    return {"ok": True, "month_key": month_key, "monorario": doc["monorario"], "note": "monorario ponderato per ore" if tot else "monorario = valore indicato o media semplice (ore non fornite)"}


# ============================================================================ HOOK AZIONI RAPIDE (POST /axon/quick-action) — esecuzione letterale
_PUNQ_TRIGGER_RE = re.compile(r"\bpun\b", re.IGNORECASE)
_PUNQ_TABLE_HINT_RE = re.compile(r"\b(tabella|mesi|mese|fasce|fascia|medi[oa]?|storico|ultim[io]|andamento|monorario|f1|f2|f3)\b", re.IGNORECASE)
_PUNQ_EXCLUDE_RE = re.compile(r"\b(bolletta|fattura|contratto|offerta|spiega\w*|cos'?[èe]|che cos|perch[éè]|significa|differenza|calcola\w* il costo|preventivo)\b", re.IGNORECASE)
_PUNQ_N_RE = re.compile(r"\b(?:ultim[io]\s+)?(\d{1,2})\s+mesi\b", re.IGNORECASE)
_PUNQ_REFRESH_RE = re.compile(r"\b(aggiorna|ricarica|rinfresca|refresh)\w*\b.*\b(cache|archivio|tabella|dati)?\b.*\bpun\b|\bpun\b.*\b(aggiorna|ricarica|refresh)\w*\b.*\b(cache|archivio)\b", re.IGNORECASE)
# V50.z392 — una DOMANDA («Perché…?», «Come si chiama il job che aggiorna il PUN?», «È aggiornato?») NON è un comando:
# va all'AI che risponde SOLO alla domanda. I comandi (refresh/inserimento/tabella) scattano solo su frasi imperative.
_PUNQ_QUESTION_RE = re.compile(r"\?\s*$|^\s*(perch[eé]|come mai|come si chiama|come funziona|cosa|chi|quando|dove|quale|qual|[èe]\s|sono\s|esiste|c'[èe]|ci sono)\b", re.IGNORECASE)
_PUNQ_INSERT_RE = re.compile(r"\b(inserisci|aggiungi|salva|registra)\s+(?:il\s+)?pun\s+(?:di\s+)?([a-zà-ù]+)\s+(20\d{2})\b.*?\bf1\s*[:=]?\s*([\d.,]+).*?\bf2\s*[:=]?\s*([\d.,]+).*?\bf3\s*[:=]?\s*([\d.,]+)", re.IGNORECASE | re.DOTALL)


def _punq_strip(msg: str) -> str:
    return (msg or "").split("\n\nISTRUZIONI OPERATIVE", 1)[0].strip()


def _punq_wants_table(label: str, prompt: str) -> Optional[int]:
    """Ritorna il numero di mesi se la richiesta è una tabella PUN, altrimenti None."""
    txt = f"{label or ''} {_punq_strip(prompt)}"
    if not _PUNQ_TRIGGER_RE.search(txt) or _PUNQ_EXCLUDE_RE.search(txt) or not _PUNQ_TABLE_HINT_RE.search(txt):
        return None
    m = _PUNQ_N_RE.search(txt)
    n = int(m.group(1)) if m else (12 if re.search(r"\b(12 mesi|un anno|ultimo anno)\b", txt, re.IGNORECASE) else _PUNQ_DEFAULT_MONTHS)
    return max(1, min(n, 36))


async def _qa_deterministic(label: str, prompt: str, user: dict) -> Optional[dict]:  # noqa: F811 — hook di 24
    n = _punq_wants_table(label, prompt)
    if n is None:
        return None
    # V50.z245 — Azione Rapida = link fisso «PUN 18 mesi»: il numero di mesi lo decide solo l'etichetta del bottone
    # (es. «PUN 12 mesi»), MAI il testo libero del prompt (che può contenere numeri incidentali). Default 18.
    ml = _PUNQ_N_RE.search(label or "")
    n = max(1, min(int(ml.group(1)), 36)) if ml else _PUNQ_DEFAULT_MONTHS
    t = await _punq_table(n)
    return {"reply": t["table_markdown"], "updated_at": t["cache_updated_at"] or t["generated_at"], "from_cache": True, "cache_age_days": 0.0, "deterministic": True, "missing": t["missing"]}


def _punq_num(s: str) -> float:
    s = s.strip()
    return float(s.replace(".", "").replace(",", ".")) if ("," in s and s.count(",") == 1) else float(s.replace(",", "."))


_punq_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = _punq_strip(msg)
    try:
        if txt and len(txt) <= 1200 and _PUNQ_TRIGGER_RE.search(txt) and not _PUNQ_QUESTION_RE.search(txt):
            if is_owner(user):
                mi = _PUNQ_INSERT_RE.search(txt)
                if mi:
                    mo = _PUNQ_MONTH_NUM.get(mi.group(2).lower())
                    if mo:
                        key = f"{int(mi.group(3)):04d}-{mo:02d}"
                        vals = [_punq_num(mi.group(i)) for i in (4, 5, 6)]
                        unit = "€/kWh" if max(vals) < 5 else "€/MWh"
                        body = PunqManualIn(F1=vals[0], F2=vals[1], F3=vals[2], unit=unit)
                        r = await punq_manual(key, body, user)
                        return {"reply": f"✅ PUN {mi.group(2).capitalize()} {mi.group(3)} salvato in cache ({unit}): F1 {mi.group(4)} · F2 {mi.group(5)} · F3 {mi.group(6)} · monorario {str(r['monorario']).replace('.', ',')} ({r['note']}). Fonte: inserimento manuale.", "cmd": "pun_manual"}
                if _PUNQ_REFRESH_RE.search(txt) and len(txt) <= 160:
                    r = await _punq_refresh(_PUNQ_LOOKBACK)
                    return {"reply": f"🔄 Cache PUN aggiornata: {len(r['added'])} mesi nuovi{(' (' + ', '.join(r['added']) + ')') if r['added'] else ''}; mancanti su {r['checked']}: {', '.join(r['missing']) if r['missing'] else 'nessuno'}.", "cmd": "pun_refresh"}
            n = _punq_wants_table("", txt)
            if n is not None and len(txt) <= 1200:
                t = await _punq_table(n)
                ctx = user.get("_client_ctx") if isinstance(user, dict) else None
                if isinstance(ctx, dict) and ctx.get("voice"):  # V50.z305 — VOCE BREVE: niente tabella letta ad alta voce
                    rows = []
                    for ln in (t["table_markdown"] or "").split("\n"):
                        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
                        if len(cells) >= 2 and re.search(r"\d", cells[1]) and "previsione" not in ln.lower() and "parziale" not in ln.lower() and ":---" not in ln and "Mese" not in cells[0]:
                            rows.append((re.sub(r"[*🟢🔴🟡_]", "", cells[0]).strip(), re.sub(r"[*🟢🔴🟡_]", "", cells[1]).strip()))
                    last = rows[-3:]
                    if last:
                        trend = ""
                        try:
                            a, b = float(last[0][1].replace(",", ".")), float(last[-1][1].replace(",", "."))
                            trend = ", in salita" if b > a * 1.02 else ", in calo" if b < a * 0.98 else ", stabile"
                        except Exception:  # noqa: BLE001
                            pass
                        spoken = "PUN monorario degli ultimi mesi: " + ", ".join(f"{m} {v} euro al chilowattora" for m, v in last) + trend + ". Vuoi la tabella completa in chat?"
                        return {"reply": spoken, "cmd": "pun_table_voice"}
                return {"reply": t["table_markdown"], "cmd": "pun_table"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[punq] chat failed: %s", exc)
    return await _punq_prev_maybe_push_command(msg, user)


# ============================================================================ REGOLE ASSOLUTE (anti-allucinazione) nel prompt di sistema
_PUNQ_ABSOLUTE_RULES = (
    "⚖️ REGOLE ASSOLUTE (prevalgono su tutto il resto):\n"
    "1) ESECUZIONE LETTERALE: se l'utente o una regola dice «segui la regola X» / «usa la cache» / «prendi dall'archivio», esegui ALLA LETTERA, zero interpretazioni. "
    "Se la fonte indicata manca (cache/archivio/file non trovato) → fermati e scrivi esplicitamente «Cache non trovata» (o «Archivio non trovato») spiegando cosa manca: "
    "NON compensare ricostruendo da zero, NON usare dati parziali o stimati al posto della fonte richiesta.\n"
    "2) DATI PRESENTI = DATI USATI: se nel contesto (sezione DATI GME, PDF allegati, dati importati, regole con tabelle) ci sono numeri reali per ciò che ti viene chiesto, "
    "DEVI usarli tal quali. È VIETATO scrivere «n/d», «non disponibile» o «da verificare» quando il numero esiste nel contesto. Scrivi «n/d» SOLO se il dato non c'è davvero.\n"
    "3) MAI INVENTARE NUMERI: nessuna stima, media o interpolazione spacciata per dato ufficiale; se stimi, marca il valore come «stima» separatamente dai dati reali.\n"
    "4) Tabelle PUN/fasce: se il contesto contiene la sezione «DATI GME», la tabella si costruisce SOLO da quei valori (🔴 massimo, 🟢 minimo per colonna)."
)
_punq_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _punq_prev_prepare_prompt(user, body)
    if isinstance(prep, dict) and prep.get("query_class") == "simple":
        return prep  # V50.z413 — domanda semplice (ora/meteo/saluti/domotica): nessuna sezione extra nel prompt
    try:
        if prep.get("system_message"):
            prep["system_message"] = f"{_PUNQ_ABSOLUTE_RULES}\n\n{prep['system_message']}"
            # Conversazione sul PUN in corso (messaggio breve tipo «Sì», «procedi», «e agosto?») → i valori reali vanno SEMPRE nel contesto
            msg = (getattr(body, "message", "") or "").strip()
            inject = bool(_PUNQ_TRIGGER_RE.search(msg))
            if not inject and len(msg) <= 60:
                last = await db.assistant_messages.find_one({"user_id": user["user_id"], "role": "assistant"}, {"_id": 0, "content": 1}, sort=[("created_at", -1)])
                inject = bool(last and _PUNQ_TRIGGER_RE.search(last.get("content") or ""))
            if inject:
                t = await _punq_table(_PUNQ_DEFAULT_MONTHS)
                prep["system_message"] += ("\n\n--- DATI GME (calcolatore PUN, valori REALI dalla cache backend) ---\nSe devi mostrare o citare PUN/fasce usa SOLO questi valori, "
                                           "riportando la tabella così com'è (non ricalcolare, non arrotondare, non inventare mesi):\n" + t["table_markdown"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[punq] prompt failed: %s", exc)
    return prep


# ============================================================================ JOB GIORNALIERO + AVVISO NUOVO MESE
async def _punq_daily_tick() -> dict:
    r = await _punq_refresh(_PUNQ_LOOKBACK)
    if r["added"]:
        try:
            owners = await db.users.find({"role": "owner", "$or": [{"parent_user_id": None}, {"parent_user_id": {"$exists": False}}]}, {"_id": 0}).to_list(200)
            # V50.z231 — Avviso SOLO per il mese GME più recente davvero nuovo (niente valanga di 18 card al primo popolamento della cache)
            recent_cut = (utcnow().replace(day=1) - timedelta(days=62)).strftime("%Y-%m")
            notify_keys = sorted(k for k in r["added"] if k >= recent_cut)[-1:]
            for u in owners:
                for key in notify_keys:
                    d = await db.gme_pun_cache.find_one({"month_key": key}, {"_id": 0})
                    if not d:
                        continue
                    lab = _punq_label(d); mono = _punq_fmt(_punq_kwh(d.get("monorario"), d.get("unit") or "€/MWh"))
                    await _apx_emit(u, "alert", "pun_update", f"⚡ PUN {lab} disponibile", f"Monorario {mono} €/kWh — tabella aggiornata",
                                    f"⚡ **Nuovo PUN GME {lab}**: monorario **{mono} €/kWh** (F1 {_punq_fmt(_punq_kwh(d.get('F1'), d.get('unit')))} · F2 {_punq_fmt(_punq_kwh(d.get('F2'), d.get('unit')))} · F3 {_punq_fmt(_punq_kwh(d.get('F3'), d.get('unit')))}). "
                                    f"La tabella «PUN 18 mesi» è già aggiornata in cache: chiedimela quando vuoi.",
                                    f"pun_update:{key}", [{"label": "Tabella PUN 18 mesi", "prompt": "Tabella PUN medio per fasce ultimi 18 mesi"}], "scheduler", {"month_key": key})
        except Exception as exc:  # noqa: BLE001
            logger.warning("[punq] notify failed: %s", exc)
    return r


# ============================================================================ V50.z324 — MEDIA PARZIALE MESE CORRENTE (GME Esiti MGP, prezzi orari)
# Fonte pubblica: pagina «Esiti › MGP › PUN» di gme.mercatoelettrico.org → API DNN GetMEPrezzi (Granularita=h, Zona=PUN) con cookie +
# anti-forgery token della pagina. Fasce ARERA: F1 lun–ven 08–19 · F2 lun–ven 07–08 e 19–23, sab 07–23 · F3 lun–sab 23–07, domeniche e festivi.
# Collezione `gme_pun_partial` (separata da `gme_pun_cache`: il PDF ufficiale del mese chiuso NON viene mai bloccato dal dato parziale).
_PUNQ_ESITI_PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Esiti/Elettricita/MGP/Esiti/PUN"
_PUNQ_ESITI_API = "https://gme.mercatoelettrico.org/DesktopModules/GmeEsitiPrezziME/API/item/GetMEPrezzi"


def _punq_it_holidays(year: int) -> set:
    from dateutil.easter import easter as _easter
    from datetime import date as _date
    e = _easter(year)
    fixed = [(1, 1), (1, 6), (4, 25), (5, 1), (6, 2), (8, 15), (11, 1), (12, 8), (12, 25), (12, 26)]
    return {_date(year, m, d) for m, d in fixed} | {e, e + timedelta(days=1)}


def _punq_fascia(day, hour_1based: int, holidays: set) -> str:
    """hour_1based: 1 = 00:00–01:00 … 24 = 23:00–24:00."""
    if day in holidays or day.weekday() == 6:
        return "F3"
    h0 = hour_1based - 1  # ora di inizio
    if day.weekday() == 5:  # sabato
        return "F2" if 7 <= h0 < 23 else "F3"
    if 8 <= h0 < 19:
        return "F1"
    if h0 == 7 or 19 <= h0 < 23:
        return "F2"
    return "F3"


async def _punq_fetch_esiti_hourly(start: str, end: str) -> List[dict]:
    """Prezzi orari PUN [{df: 20260901, h: 1..24, p: €/MWh}] tra due date YYYYMMDD (inclusive)."""
    async with httpx.AsyncClient(timeout=40, follow_redirects=True, headers=_PUNQ_HEADERS) as cli:
        page = await cli.get(_PUNQ_ESITI_PAGE)
        page.raise_for_status()
        m_tok = re.search(r'__RequestVerificationToken"[^>]*value="([^"]+)"', page.text)
        m_tab = re.search(r'"TabId":(\d+)', page.text)
        m_mod = re.search(r'"ModuleId":(\d+)', page.text)
        if not m_tok:
            raise RuntimeError("anti-forgery token non trovato nella pagina GME Esiti")
        hdr = {"RequestVerificationToken": m_tok.group(1), "TabId": m_tab.group(1) if m_tab else "48", "ModuleId": m_mod.group(1) if m_mod else "530",
               "Referer": _PUNQ_ESITI_PAGE, "Accept": "application/json"}
        r = await cli.get(_PUNQ_ESITI_API, headers=hdr, params={"DataInizio": start, "DataFine": end, "Granularita": "h", "Mercato": "MGP", "Zona": "PUN", "Tipologia": "PUN"})
        r.raise_for_status()
        data = r.json()
        return [x for x in data if isinstance(x, dict) and x.get("p") is not None and x.get("df") and x.get("h")]


async def _punq_partial_refresh(year: Optional[int] = None, month: Optional[int] = None) -> dict:
    """Scarica i prezzi orari del mese (giorni 1–N pubblicati, incluso il day-ahead) e salva la media parziale monorario/F1/F2/F3 in `gme_pun_partial`."""
    from datetime import date as _date
    today = datetime.now(_PUNQ_TZ)
    y, m = year or today.year, month or today.month
    key = f"{y:04d}-{m:02d}"
    last_dom = (datetime(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1)).day
    rows = await _punq_fetch_esiti_hourly(f"{y:04d}{m:02d}01", f"{y:04d}{m:02d}{last_dom:02d}")
    if not rows:
        return {"month_key": key, "days": 0, "saved": False}
    hol = _punq_it_holidays(y)
    acc = {"monorario": [0.0, 0], "F1": [0.0, 0], "F2": [0.0, 0], "F3": [0.0, 0]}
    days = set()
    for x in rows:
        df = str(x["df"]); day = _date(int(df[:4]), int(df[4:6]), int(df[6:8]))
        days.add(day)
        band = _punq_fascia(day, int(x["h"]), hol)
        for k in ("monorario", band):
            acc[k][0] += float(x["p"]); acc[k][1] += 1
    doc = {"month_key": key, "year": y, "month": m, "days": len(days), "first_day": min(days).isoformat(), "last_day": max(days).isoformat(),
           "total_hours": acc["monorario"][1], "unit": "€/MWh", "source_kind": "gme_esiti_api", "source_url": _PUNQ_ESITI_PAGE, "updated_at": utcnow()}
    for k, (s, n) in acc.items():
        doc[k] = round(s / n, 6) if n else None
        doc[f"{k}_hours"] = n
    await db.gme_pun_partial.update_one({"month_key": key}, {"$set": doc}, upsert=True)
    logger.info("[punq] partial %s: %s gg, monorario %.2f €/MWh", key, doc["days"], doc["monorario"] or 0)
    return {**doc, "saved": True}


async def _punq_threshold_alerts(doc: dict) -> int:
    """V50.z325 — Avviso soglia: per ogni utente con `pun_alert_threshold` (€/kWh) impostato, se la media parziale del mese
    (fascia scelta, default monorario) SUPERA la soglia → card proattiva + messaggio in chat, una sola volta per mese/soglia (dedupe)."""
    sent = 0
    key = doc.get("month_key"); label = f"{_GME_MONTH_NAMES_REV.get(int(doc.get('month') or 0), '').capitalize()} {doc.get('year')}"
    async for st in db.user_settings.find({"pun_alert_threshold": {"$gt": 0}}, {"_id": 0, "user_id": 1, "pun_alert_threshold": 1, "pun_alert_band": 1, "pun_alert_bands": 1}):
      # V50.z410 — più fasce selezionabili: un avviso per ciascuna fascia sopra soglia
      bands_sel = [b for b in (st.get("pun_alert_bands") or [st.get("pun_alert_band")]) if b in ("monorario", "F1", "F2", "F3")] or ["monorario"]
      for band in bands_sel:
        raw = doc.get(band)
        if raw is None:
            continue
        val = round(float(raw) / 1000.0, 6)  # €/MWh → €/kWh
        thr = float(st["pun_alert_threshold"])
        if val <= thr:
            continue
        user = await db.users.find_one({"user_id": st["user_id"]}, {"_id": 0})
        if not user:
            continue
        band_lbl = "monorario" if band == "monorario" else band
        title = f"⚡ PUN {label} sopra la tua soglia"
        body = f"Media parziale {band_lbl} giorni 1–{doc.get('days')}: {_punq_fmt(val)} €/kWh (soglia {_punq_fmt(thr)})"
        chat = (f"⚡ **Attenzione PUN**: la media parziale {band_lbl} di **{label}** (giorni 1–{doc.get('days')}) è **{_punq_fmt(val)} €/kWh**, "
                f"sopra la soglia che hai impostato ({_punq_fmt(thr)} €/kWh). Monorario {_punq_fmt(_punq_kwh(doc.get('monorario'), '€/MWh'))} · "
                f"F1 {_punq_fmt(_punq_kwh(doc.get('F1'), '€/MWh'))} · F2 {_punq_fmt(_punq_kwh(doc.get('F2'), '€/MWh'))} · F3 {_punq_fmt(_punq_kwh(doc.get('F3'), '€/MWh'))}. "
                f"Vuoi la tabella completa o avvisare i tuoi clienti?")
        try:
            r = await _apx_emit(user, "alert", "pun_threshold", title, body, chat, f"pun_threshold:{key}:{band}:{thr}",
                                [{"label": "Tabella PUN 18 mesi", "prompt": "Tabella PUN medio per fasce ultimi 18 mesi"}], "scheduler",
                                {"month_key": key, "band": band, "value": val, "threshold": thr})
            if r:
                sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("[punq] threshold alert failed for %s: %s", st["user_id"], exc)
    return sent


async def _punq_partial_tick() -> dict:
    try:
        r = await _punq_partial_refresh()
        if r.get("saved"):
            r["alerts_sent"] = await _punq_threshold_alerts(r)
        return r
    except Exception as exc:  # noqa: BLE001
        logger.warning("[punq] partial refresh failed: %s", exc)
        return {"saved": False, "error": str(exc)}


@api_router.post("/quick-action/pun/partial/refresh")
async def punq_partial_refresh_now(user=Depends(get_current_user)):
    if user.get("parent_user_id"):
        raise HTTPException(status_code=403, detail="Solo il Master può aggiornare il dato parziale")
    r = await _punq_partial_tick()
    if not r.get("saved"):
        raise HTTPException(status_code=502, detail=f"GME non raggiungibile: {r.get('error') or 'nessun dato'}")
    return r


@api_router.get("/quick-action/pun/partial")
async def punq_partial_get(user=Depends(get_current_user)):
    today = datetime.now(_PUNQ_TZ)
    d = await db.gme_pun_partial.find_one({"month_key": f"{today.year:04d}-{today.month:02d}"}, {"_id": 0})
    if d and isinstance(d.get("updated_at"), datetime):
        d["updated_at"] = d["updated_at"].isoformat()
    return d or {"month_key": f"{today.year:04d}-{today.month:02d}", "days": 0}


@app.on_event("startup")
async def _punq_start():
    try:
        await db.axon_pun_meta.create_index([("key", 1)], unique=True)
        _axn_scheduler.add_job(_punq_daily_tick, "cron", day=1, hour=7, minute=0, id="punq-monthly", replace_existing=True)      # 1° del mese: aggiornamento tabella
        _axn_scheduler.add_job(_punq_daily_tick, "cron", hour=6, minute=40, id="punq-daily", replace_existing=True)             # recupero: il PDF GME esce tra il 1° e il 6°
        # V50.z324 — media PARZIALE del mese corrente ogni giorno: 08:00 UTC (richiesta utente) + 13:30 Roma (dopo pubblicazione esiti day-ahead ~12:55)
        _axn_scheduler.add_job(_punq_partial_tick, "cron", hour=8, minute=0, timezone="UTC", id="punq-partial-daily", replace_existing=True)
        _axn_scheduler.add_job(_punq_partial_tick, "cron", hour=13, minute=30, id="punq-partial-afternoon", replace_existing=True)

        async def _boot():
            await _punq_asyncio.sleep(20)
            # V50.z231 — bonifica una tantum: le card «Nuovo PUN mensile GME» arretrate (backfill) vengono chiuse, resta solo la più recente per utente
            try:
                async for row in db.axon_proactive_log.aggregate([{"$match": {"type": "pun_update", "dismissed_at": None}}, {"$sort": {"month_key": -1}},
                                                                  {"$group": {"_id": "$user_id", "keep": {"$first": "$item_id"}, "ids": {"$push": "$item_id"}}}]):
                    stale = [i for i in row["ids"] if i != row["keep"]]
                    if stale:
                        await db.axon_proactive_log.update_many({"item_id": {"$in": stale}}, {"$set": {"dismissed_at": utcnow(), "dismiss_reason": "pun_backfill_cleanup"}})
            except Exception as exc:  # noqa: BLE001
                logger.warning("[punq] backfill cleanup failed: %s", exc)
            r = await _punq_daily_tick()
            logger.info("[punq] boot refresh: %s", r)
            await _punq_partial_tick()  # V50.z324 — dato parziale mese corrente subito disponibile al boot
        _punq_asyncio.create_task(_boot())
        logger.info("[punq] PUN calculator armed")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[punq] start failed: %s", exc)
