# market_conditions.py — V50.z345 — MERCATO: DB condizioni economiche (concorrenti · ufficiali ARERA/GME · la mia ditta) + benchmark.
# • Ogni bolletta concorrente analizzata (luce/gas/telco) alimenta `market_conditions` con: fornitore, commodity, segmento
#   (privato/business), tensione (BT/MT), potenza, fascia di consumo, picco, prezzi (F0/F1/F2/F3 €/kWh, €/Smc), spread,
#   quote fisse/PCV, data fattura. Fonte «competitor». Il Master inserisce a mano le condizioni «official» (ARERA/GME: PUN,
#   PSV, tutela) e «own» (listini della propria ditta). Le VOCI da estrarre/confrontare sono configurabili per commodity.
# • GET /market/benchmark → confronto per fornitore (min/medio/ultimo) su ogni voce + migliore del mercato + delta vs ditta.
# • POST /market/compare {bill_id} → la bolletta di un cliente vs mercato/ditta (usato anche da Axon in chat).
# Dati SOLO del tenant (team). Nessun dato → nessuna domanda all'utente: le sezioni restano vuote.

MARKET_COMMODITIES = ["luce", "gas", "telco"]
MARKET_SOURCES = ["competitor", "own", "official"]
MARKET_DEFAULT_FIELDS: Dict[str, List[Dict[str, Any]]] = {
    "luce": [
        {"key": "prezzo_energia_eur_kwh", "label": "Prezzo energia F0", "unit": "€/kWh", "enabled": True, "lower_is_better": True},
        {"key": "prezzo_f1_eur_kwh", "label": "Prezzo F1", "unit": "€/kWh", "enabled": True, "lower_is_better": True},
        {"key": "prezzo_f2_eur_kwh", "label": "Prezzo F2", "unit": "€/kWh", "enabled": True, "lower_is_better": True},
        {"key": "prezzo_f3_eur_kwh", "label": "Prezzo F3", "unit": "€/kWh", "enabled": True, "lower_is_better": True},
        {"key": "spread_eur_kwh", "label": "Spread", "unit": "€/kWh", "enabled": True, "lower_is_better": True},
        {"key": "quota_fissa_eur_mese", "label": "Quota fissa", "unit": "€/mese", "enabled": True, "lower_is_better": True},
        {"key": "pcv_eur_mese", "label": "PCV / costi fissi", "unit": "€/mese", "enabled": True, "lower_is_better": True},
    ],
    "gas": [
        {"key": "prezzo_gas_eur_smc", "label": "Prezzo materia gas", "unit": "€/Smc", "enabled": True, "lower_is_better": True},
        {"key": "spread_eur_smc", "label": "Spread", "unit": "€/Smc", "enabled": True, "lower_is_better": True},
        {"key": "quota_fissa_eur_mese", "label": "Quota fissa", "unit": "€/mese", "enabled": True, "lower_is_better": True},
    ],
    "telco": [
        {"key": "canone_mensile_eur", "label": "Canone mensile", "unit": "€/mese", "enabled": True, "lower_is_better": True},
        {"key": "costo_attivazione_eur", "label": "Costo attivazione", "unit": "€", "enabled": True, "lower_is_better": True},
    ],
}
MARKET_BANDS_LUCE = [(0, 1500, "0-1.500 kWh"), (1500, 3000, "1.500-3.000 kWh"), (3000, 6000, "3.000-6.000 kWh"), (6000, 15000, "6.000-15.000 kWh"), (15000, 50000, "15.000-50.000 kWh"), (50000, 200000, "50.000-200.000 kWh"), (200000, 10**12, "> 200.000 kWh")]
MARKET_BANDS_GAS = [(0, 500, "0-500 Smc"), (500, 1500, "500-1.500 Smc"), (1500, 5000, "1.500-5.000 Smc"), (5000, 20000, "5.000-20.000 Smc"), (20000, 10**12, "> 20.000 Smc")]


class MarketSettingsIn(BaseModel):
    fields: Dict[str, List[Dict[str, Any]]]


class MarketRecordIn(BaseModel):
    source: str = "competitor"          # competitor | own | official
    commodity: str                      # luce | gas | telco
    supplier: str
    offer_name: Optional[str] = ""
    segment: Optional[str] = None       # privato | business
    voltage: Optional[str] = None       # BT | MT
    power_kw: Optional[float] = None
    annual_consumption: Optional[float] = None
    peak_kw: Optional[float] = None
    valid_from: Optional[str] = None    # YYYY-MM-DD
    values: Dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = ""


class MarketCompareIn(BaseModel):
    bill_id: str


def _mk_num(v: Any) -> Optional[float]:
    if v in (None, "", [], {}):
        return None
    try:
        return float(str(v).replace("€", "").replace(",", ".").strip().split()[0])
    except Exception:
        return None


def _mk_band(commodity: str, annual: Optional[float]) -> str:
    if annual is None:
        return "n.d."
    for lo, hi, lbl in (MARKET_BANDS_GAS if commodity == "gas" else MARKET_BANDS_LUCE):
        if lo <= annual < hi:
            return lbl
    return "n.d."


async def _market_fields(tid: str) -> Dict[str, List[Dict[str, Any]]]:
    st = await db.market_settings.find_one({"tenant_id": tid}, {"_id": 0})
    out = {k: [dict(f) for f in v] for k, v in MARKET_DEFAULT_FIELDS.items()}
    if st and isinstance(st.get("fields"), dict):
        for c, lst in st["fields"].items():
            if c in out and isinstance(lst, list):
                out[c] = lst
    return out


def _market_pub(r: dict) -> dict:
    return {k: v for k, v in r.items() if k != "_id"}


async def _market_upsert(tid: str, rec: dict) -> dict:
    rec.setdefault("record_id", f"mk_{uuid.uuid4().hex[:12]}")
    rec["tenant_id"] = tid
    rec["updated_at"] = utcnow()
    rec.setdefault("created_at", utcnow())
    await db.market_conditions.update_one({"record_id": rec["record_id"]}, {"$set": rec}, upsert=True)
    return rec


async def _market_ingest_bill(tid: str, bill: dict, ex: Dict[str, Any]) -> Optional[dict]:
    """Bolletta analizzata → record «competitor» (solo se il fornitore è noto e c'è almeno una voce economica)."""
    commodity = (bill.get("bill_type") or "").lower()
    if commodity not in MARKET_COMMODITIES or not ex:
        return None
    supplier = (ex.get("fornitore") or "").strip()
    if not supplier:
        return None
    fields = (await _market_fields(tid)).get(commodity, [])
    values = {f["key"]: _mk_num(ex.get(f["key"])) for f in fields}
    if commodity == "telco":
        values.setdefault("canone_mensile_eur", _mk_num(ex.get("canone_mensile_eur") or ex.get("canone_mensile")))
    values = {k: v for k, v in values.items() if v is not None}
    if not values:
        return None
    annual = _mk_num(ex.get("consumo_totale_12m_kwh") if commodity == "luce" else ex.get("consumo_totale_12m_smc"))
    if annual is None:
        m = _mk_num(ex.get("consumo_medio_mensile_kwh") if commodity == "luce" else ex.get("consumo_medio_mensile_smc"))
        annual = round(m * 12) if m is not None else None
    tens = (ex.get("tensione") or "").lower()
    seg = (ex.get("tipo_cliente") or "").lower()
    if seg not in ("privato", "business"):
        seg = "business" if (ex.get("partita_iva") or ex.get("vat_number") or (annual or 0) > 15000) else "privato"
    rec = {"record_id": f"mk_{bill.get('bill_id', uuid.uuid4().hex[:12])}", "source": "competitor", "commodity": commodity, "supplier": supplier, "offer_name": ex.get("nome_offerta") or "",
           "segment": seg, "voltage": ("MT" if tens.startswith("med") else "BT") if commodity == "luce" else None,
           "power_kw": _mk_num(ex.get("potenza_impegnata_kw")), "annual_consumption": annual, "band": _mk_band(commodity, annual), "peak_kw": _mk_num(ex.get("picco_potenza_kw")),
           "valid_from": (ex.get("periodo_fattura") or "")[:10] or None, "values": values, "bill_id": bill.get("bill_id"), "contact_id": bill.get("contact_id"), "notes": "Da analisi bolletta"}
    return await _market_upsert(tid, rec)


@api_router.get("/market/settings")
async def market_settings_get(user=Depends(get_current_user)):
    return {"fields": await _market_fields(tenant_id(user)), "commodities": MARKET_COMMODITIES, "sources": MARKET_SOURCES}


@api_router.put("/market/settings")
async def market_settings_put(body: MarketSettingsIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master configura le voci di confronto")
    fields: Dict[str, List[Dict[str, Any]]] = {}
    for c, lst in body.fields.items():
        if c not in MARKET_COMMODITIES:
            continue
        clean = []
        for f in lst:
            key = re.sub(r"[^a-z0-9_]", "_", str(f.get("key") or f.get("label") or "").strip().lower())[:60]
            if not key:
                continue
            clean.append({"key": key, "label": str(f.get("label") or key)[:80], "unit": str(f.get("unit") or "")[:20], "enabled": bool(f.get("enabled", True)), "lower_is_better": bool(f.get("lower_is_better", True))})
        fields[c] = clean
    await db.market_settings.update_one({"tenant_id": tenant_id(user)}, {"$set": {"tenant_id": tenant_id(user), "fields": fields, "updated_at": utcnow()}}, upsert=True)
    return {"fields": await _market_fields(tenant_id(user))}


@api_router.get("/market/records")
async def market_records(commodity: Optional[str] = None, source: Optional[str] = None, supplier: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if commodity: q["commodity"] = commodity
    if source: q["source"] = source
    if supplier: q["supplier"] = {"$regex": re.escape(supplier), "$options": "i"}
    items = await db.market_conditions.find(q, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return {"items": items}


@api_router.post("/market/records")
async def market_record_create(body: MarketRecordIn, user=Depends(get_current_user)):
    if body.commodity not in MARKET_COMMODITIES or body.source not in MARKET_SOURCES:
        raise HTTPException(status_code=400, detail="commodity/source non validi")
    if body.source in ("own", "official") and not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master inserisce listini ditta e dati ufficiali")
    values = {k: _mk_num(v) for k, v in (body.values or {}).items()}
    values = {k: v for k, v in values.items() if v is not None}
    if not values:
        raise HTTPException(status_code=400, detail="Inserisci almeno una voce economica")
    rec = {"source": body.source, "commodity": body.commodity, "supplier": body.supplier.strip()[:120] or ("La mia ditta" if body.source == "own" else "ARERA/GME"), "offer_name": (body.offer_name or "")[:120],
           "segment": body.segment, "voltage": body.voltage, "power_kw": body.power_kw, "annual_consumption": body.annual_consumption, "band": _mk_band(body.commodity, body.annual_consumption), "peak_kw": body.peak_kw,
           "valid_from": body.valid_from, "values": values, "notes": (body.notes or "")[:300], "created_by": user["user_id"]}
    return _market_pub(await _market_upsert(tenant_id(user), rec))


@api_router.delete("/market/records/{record_id}")
async def market_record_delete(record_id: str, user=Depends(get_current_user)):
    r = await db.market_conditions.delete_one({"record_id": record_id, "tenant_id": tenant_id(user)})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Record non trovato")
    return {"ok": True}


def _market_bench(records: List[dict], fields: List[dict]) -> Dict[str, Any]:
    """Aggregati per fornitore (min/avg/last per voce) + migliore del mercato per voce + righe ditta/ufficiali."""
    keys = [f["key"] for f in fields if f.get("enabled", True)]
    by_sup: Dict[str, Dict[str, Any]] = {}
    for r in sorted(records, key=lambda x: str(x.get("valid_from") or x.get("updated_at") or "")):
        k = f"{r['source']}::{r['supplier']}"
        g = by_sup.setdefault(k, {"source": r["source"], "supplier": r["supplier"], "n": 0, "offers": set(), "values": {kk: {"min": None, "sum": 0.0, "n": 0, "last": None} for kk in keys}, "last_date": None})
        g["n"] += 1
        if r.get("offer_name"): g["offers"].add(r["offer_name"])
        g["last_date"] = r.get("valid_from") or g["last_date"]
        for kk in keys:
            v = (r.get("values") or {}).get(kk)
            if v is None: continue
            s = g["values"][kk]
            s["min"] = v if s["min"] is None else min(s["min"], v); s["sum"] += v; s["n"] += 1; s["last"] = v
    rows = []
    for g in by_sup.values():
        vals = {kk: {"min": s["min"], "avg": round(s["sum"] / s["n"], 4) if s["n"] else None, "last": s["last"], "n": s["n"]} for kk, s in g["values"].items()}
        rows.append({"source": g["source"], "supplier": g["supplier"], "n": g["n"], "offers": sorted(g["offers"])[:5], "last_date": g["last_date"], "values": vals})
    best: Dict[str, Any] = {}
    for f in fields:
        kk = f["key"]
        cands = [(r["values"][kk]["last"], r) for r in rows if r["source"] == "competitor" and r["values"].get(kk, {}).get("last") is not None]
        if cands:
            v, r = (min if f.get("lower_is_better", True) else max)(cands, key=lambda x: x[0])
            best[kk] = {"value": v, "supplier": r["supplier"]}
    own = [r for r in rows if r["source"] == "own"]
    official = [r for r in rows if r["source"] == "official"]
    competitors = sorted([r for r in rows if r["source"] == "competitor"], key=lambda r: -r["n"])
    return {"fields": [f for f in fields if f.get("enabled", True)], "competitors": competitors, "own": own, "official": official, "best": best, "records": len(records)}


@api_router.get("/market/benchmark")
async def market_benchmark(commodity: str = "luce", segment: Optional[str] = None, voltage: Optional[str] = None, band: Optional[str] = None, user=Depends(get_current_user)):
    tid = tenant_id(user)
    q: Dict[str, Any] = {"tenant_id": tid, "commodity": commodity}
    if segment: q["segment"] = segment
    if voltage: q["voltage"] = voltage
    if band: q["band"] = band
    recs = await db.market_conditions.find(q, {"_id": 0}).to_list(2000)
    # ditta/ufficiali: se non ci sono record con quel filtro, usa quelli generici (senza segmento/tensione)
    if segment or voltage or band:
        extra = await db.market_conditions.find({"tenant_id": tid, "commodity": commodity, "source": {"$in": ["own", "official"]}}, {"_id": 0}).to_list(200)
        seen = {r["record_id"] for r in recs}
        recs += [r for r in extra if r["record_id"] not in seen]
    fields = (await _market_fields(tid)).get(commodity, [])
    out = _market_bench(recs, fields)
    out["bands"] = [b[2] for b in (MARKET_BANDS_GAS if commodity == "gas" else MARKET_BANDS_LUCE)]
    out["filters"] = {"commodity": commodity, "segment": segment, "voltage": voltage, "band": band}
    return out


@api_router.post("/market/compare")
async def market_compare(body: MarketCompareIn, user=Depends(get_current_user)):
    """Bolletta di un cliente vs mercato (stesso segmento/tensione/fascia) e vs listino ditta → delta annuo stimato per voce."""
    tid = tenant_id(user)
    bill = await db.energy_bills.find_one({"bill_id": body.bill_id, "user_id": tid}, {"_id": 0, "pdf_base64": 0})
    if not bill or bill.get("status") != "done":
        raise HTTPException(status_code=404, detail="Bolletta non trovata o non analizzata")
    ex = bill.get("extracted") or {}
    commodity = bill.get("bill_type")
    rec = await _market_ingest_bill(tid, bill, ex) or {}
    bench = await market_benchmark(commodity, rec.get("segment"), rec.get("voltage"), rec.get("band"), user)
    annual = rec.get("annual_consumption") or 0
    fields = bench["fields"]
    lines = []
    for f in fields:
        kk = f["key"]; mine = (rec.get("values") or {}).get(kk)
        if mine is None: continue
        best = bench["best"].get(kk)
        own = next((r["values"][kk]["last"] for r in bench["own"] if r["values"].get(kk, {}).get("last") is not None), None)
        per_year = annual if f["unit"] in ("€/kWh", "€/Smc") else 12 if "mese" in f["unit"] else 1
        lines.append({"key": kk, "label": f["label"], "unit": f["unit"], "bill": mine,
                      "best_market": best, "delta_best_year": round((mine - best["value"]) * per_year, 2) if best else None,
                      "own": own, "delta_own_year": round((mine - own) * per_year, 2) if own is not None else None})
    return {"bill_id": body.bill_id, "supplier": ex.get("fornitore"), "commodity": commodity, "segment": rec.get("segment"), "voltage": rec.get("voltage"), "band": rec.get("band"), "annual_consumption": annual,
            "lines": lines, "competitors": len(bench["competitors"]), "has_own": bool(bench["own"]), "has_official": bool(bench["official"])}


@api_router.post("/market/ingest-all")
async def market_ingest_all(user=Depends(get_current_user)):
    """Ricostruisce il DB dalle bollette già analizzate del team (una tantum / manutenzione)."""
    tid = tenant_id(user)
    n = 0
    async for b in db.energy_bills.find({"user_id": tid, "status": "done"}, {"_id": 0, "pdf_base64": 0}):
        if await _market_ingest_bill(tid, b, b.get("extracted") or {}):
            n += 1
    return {"ingested": n}


# ─── V50.z346 — DATI UFFICIALI ARERA / GME (inserimento manuale mensile + confronto automatico vs concorrenti) ───
# Il Master inserisce per ogni mese (YYYY-MM) i valori di riferimento degli indici ufficiali (PUN, STG/tutela, PSV…).
# Un record per (indice, commodity, mese): re-inserire lo stesso mese aggiorna il valore. Fonte «official» → alimenta
# anche il benchmark generale. GET /market/official/compare → ogni concorrente vs il riferimento più recente ≤ mese scelto.
MARKET_OFFICIAL_INDICES: Dict[str, List[Dict[str, str]]] = {
    "luce": [
        {"id": "gme_pun", "label": "GME · PUN", "hint": "Prezzo Unico Nazionale medio mensile (F0 / F1 / F2 / F3)"},
        {"id": "arera_stg", "label": "ARERA · STG / Tutela", "hint": "Servizio a Tutele Graduali e vulnerabili: prezzo energia, spread, quota fissa, PCV"},
    ],
    "gas": [
        {"id": "gme_psv", "label": "GME · PSV", "hint": "Punto di Scambio Virtuale: prezzo medio mensile €/Smc"},
        {"id": "arera_tutela_gas", "label": "ARERA · Tutela vulnerabili", "hint": "Prezzo materia gas, spread e quota fissa del servizio di tutela"},
    ],
    "telco": [
        {"id": "agcom_media", "label": "AGCOM · Media mercato", "hint": "Canone medio e costo attivazione rilevati dall'Autorità"},
    ],
}
_OFF_INDEX_BY_ID = {i["id"]: (c, i) for c, lst in MARKET_OFFICIAL_INDICES.items() for i in lst}


class MarketOfficialIn(BaseModel):
    commodity: str
    index_id: str
    period: str                          # YYYY-MM
    values: Dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = ""


def _off_period_ok(p: str) -> bool:
    return bool(re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", p or ""))


@api_router.get("/market/official")
async def market_official_list(commodity: str = "luce", user=Depends(get_current_user)):
    if commodity not in MARKET_COMMODITIES:
        raise HTTPException(status_code=400, detail="commodity non valida")
    tid = tenant_id(user)
    recs = await db.market_conditions.find({"tenant_id": tid, "commodity": commodity, "source": "official", "official_index": {"$exists": True}}, {"_id": 0}).sort("period", -1).to_list(600)
    periods: Dict[str, List[dict]] = {}
    for r in recs:
        periods.setdefault(r.get("period") or "n.d.", []).append(r)
    return {"indices": MARKET_OFFICIAL_INDICES[commodity], "fields": [f for f in (await _market_fields(tid)).get(commodity, []) if f.get("enabled", True)],
            "periods": [{"period": p, "records": lst} for p, lst in sorted(periods.items(), key=lambda x: x[0], reverse=True)]}


@api_router.post("/market/official")
async def market_official_save(body: MarketOfficialIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master inserisce i dati ufficiali ARERA/GME")
    idx = _OFF_INDEX_BY_ID.get(body.index_id)
    if not idx or idx[0] != body.commodity:
        raise HTTPException(status_code=400, detail="Indice ufficiale non valido per questa commodity")
    if not _off_period_ok(body.period):
        raise HTTPException(status_code=400, detail="Periodo non valido: usa il formato AAAA-MM")
    values = {k: _mk_num(v) for k, v in (body.values or {}).items()}
    values = {k: v for k, v in values.items() if v is not None}
    if not values:
        raise HTTPException(status_code=400, detail="Inserisci almeno un valore")
    tid = tenant_id(user)
    rec = {"record_id": f"mk_off_{tid[:8]}_{body.commodity}_{body.index_id}_{body.period}", "source": "official", "commodity": body.commodity, "supplier": idx[1]["label"],
           "official_index": body.index_id, "period": body.period, "offer_name": body.period, "segment": None, "voltage": None, "power_kw": None, "annual_consumption": None, "band": "n.d.",
           "valid_from": f"{body.period}-01", "values": values, "notes": (body.notes or "")[:300], "created_by": user["user_id"]}
    return _market_pub(await _market_upsert(tid, rec))


@api_router.get("/market/official/compare")
async def market_official_compare(commodity: str = "luce", index_id: Optional[str] = None, period: Optional[str] = None,
                                  segment: Optional[str] = None, voltage: Optional[str] = None, band: Optional[str] = None, user=Depends(get_current_user)):
    """Concorrenti (ultima rilevazione per fornitore) vs riferimento ufficiale più recente ≤ periodo scelto → delta assoluto e %."""
    if commodity not in MARKET_COMMODITIES:
        raise HTTPException(status_code=400, detail="commodity non valida")
    tid = tenant_id(user)
    index_id = index_id or MARKET_OFFICIAL_INDICES[commodity][0]["id"]
    q_off: Dict[str, Any] = {"tenant_id": tid, "commodity": commodity, "source": "official", "official_index": index_id}
    if period and _off_period_ok(period):
        q_off["period"] = {"$lte": period}
    ref = await db.market_conditions.find_one(q_off, {"_id": 0}, sort=[("period", -1)])
    fields = [f for f in (await _market_fields(tid)).get(commodity, []) if f.get("enabled", True)]
    q_c: Dict[str, Any] = {"tenant_id": tid, "commodity": commodity, "source": "competitor"}
    if segment: q_c["segment"] = segment
    if voltage: q_c["voltage"] = voltage
    if band: q_c["band"] = band
    comp = await db.market_conditions.find(q_c, {"_id": 0}).to_list(2000)
    bench = _market_bench(comp, fields)
    ref_vals: Dict[str, float] = (ref or {}).get("values") or {}
    rows, summary = [], {}
    for f in fields:
        kk = f["key"]; rv = ref_vals.get(kk)
        vals = [r["values"][kk]["last"] for r in bench["competitors"] if r["values"].get(kk, {}).get("last") is not None]
        if not vals and rv is None:
            continue
        summary[kk] = {"ref": rv, "avg": round(sum(vals) / len(vals), 4) if vals else None, "min": min(vals) if vals else None, "max": max(vals) if vals else None, "n": len(vals),
                       "below": sum(1 for v in vals if rv is not None and v < rv), "above": sum(1 for v in vals if rv is not None and v > rv),
                       "delta_avg": round(sum(vals) / len(vals) - rv, 4) if vals and rv is not None else None}
    for r in bench["competitors"]:
        cells = {}
        for f in fields:
            kk = f["key"]; cv = r["values"].get(kk, {}).get("last"); rv = ref_vals.get(kk)
            if cv is None:
                continue
            d = round(cv - rv, 4) if rv is not None else None
            cells[kk] = {"value": cv, "ref": rv, "delta": d, "pct": round(d / rv * 100, 1) if d is not None and rv else None}
        rows.append({"supplier": r["supplier"], "n": r["n"], "last_date": r.get("last_date"), "offers": r["offers"], "cells": cells})
    return {"commodity": commodity, "index": _OFF_INDEX_BY_ID.get(index_id, (None, {}))[1], "period_requested": period,
            "reference": ({"period": ref.get("period"), "values": ref_vals, "supplier": ref.get("supplier"), "notes": ref.get("notes")} if ref else None),
            "fields": fields, "summary": summary, "rows": rows, "competitors": len(rows)}
