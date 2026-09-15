# bill_analysis_config.py — Configurazione Analisi Fatture (per tenant, modulo ISOLATO)
#
# Pannello «Configura Analisi Fatture» (Master + scheda cliente): campi da estrarre spuntabili per Luce/Gas/Telco,
# campi personalizzati, sezione «Analisi Comparativa» (modello grafico, stile, sezioni, campi da confrontare,
# base del confronto, istruzioni) e richieste manuali aggiuntive in testo libero.
# Tutto ciò che è salvato qui si riflette su TUTTE le analisi (bills cliente, bill-drafts Master, bulk upload)
# e su tutti i confronti fattura ↔ offerta aziendale.
#
# Persistenza: `bill_analysis_configs` { tenant_id, config, updated_at }.
# API: GET /bills/analysis-config → {config, catalog} · PUT /bills/analysis-config {config} → {config, catalog}.
# Helper usati da 13_bills (_llm_analyze_bill_text) e 17_company_offers_docs (_llm_compare_call):
#   _bac_apply_extract_config(tenant, bill_type, display_params) → (params, extra_prompt)
#   _bac_compare_prompt_suffix(tenant, bill_type) → str

_BAC_FIELDS: Dict[str, List[Tuple[str, str, bool]]] = {
    "luce": [
        ("fornitore", "Fornitore", True), ("pod", "POD", True), ("spread", "Spread €/kWh", True),
        ("prezzo_energia", "Prezzo energia €/kWh", True), ("consumi_f1", "Consumi F1 (kWh)", True),
        ("consumi_f2", "Consumi F2 (kWh)", True), ("consumi_f3", "Consumi F3 (kWh)", True),
        ("consumo_annuo", "Consumo totale 12 mesi", True), ("potenza", "Potenza impegnata (kW)", True),
        ("tensione", "Tensione", False), ("costi_fissi", "Costi fissi mensili", True), ("asos", "Oneri ASOS/ARIM", True),
        ("durata_contratto", "Durata contratto", True), ("penale_disdetta", "Penale disdetta", True),
        ("scadenza", "Data scadenza", True), ("importo_totale", "Importo totale", True),
    ],
    "gas": [
        ("fornitore", "Fornitore", True), ("pdr", "PDR", True), ("spread", "Spread €/SMC", True),
        ("prezzo_gas", "Prezzo gas €/SMC", True), ("consumo_annuo_smc", "Consumo annuo SMC", True),
        ("accisa", "Accisa €/SMC", True), ("costi_fissi", "Costi fissi mensili", True),
        ("durata_contratto", "Durata contratto", True), ("penale_disdetta", "Penale disdetta", True),
        ("scadenza", "Data scadenza", True), ("importo_totale", "Importo totale", True),
    ],
    "telco": [
        ("fornitore", "Fornitore", True), ("numero_telefono", "Numero telefono", True), ("costo_mensile", "Costo mensile", True),
        ("costo_annuale", "Costo annuale", True), ("velocita_download", "Velocità download (Mbps)", True),
        ("velocita_upload", "Velocità upload (Mbps)", True), ("servizi_inclusi", "Servizi inclusi", True),
        ("durata_contratto", "Durata contratto", True), ("penale_disdetta", "Penale disdetta", True),
        ("codice_migrazione", "Codice migrazione", False), ("scadenza", "Data scadenza", True),
    ],
}

_BAC_COMPARE_FIELDS: Dict[str, List[Tuple[str, str, bool]]] = {
    "luce": [
        ("prezzo_energia", "Prezzo energia €/kWh", True), ("spread", "Spread €/kWh", True), ("tipo_prezzo", "Tipo prezzo (fisso/variabile)", True),
        ("costi_fissi", "Quota fissa / PCV mensile", True), ("asos", "Oneri ASOS/ARIM", False), ("fasce", "Prezzi per fascia F1/F2/F3", True),
        ("costo_annuo", "Costo annuo stimato", True), ("durata_contratto", "Durata contratto", True), ("penale_disdetta", "Penali / vincoli", True),
        ("servizi", "Servizi inclusi / extra", False), ("green", "Energia verde / certificazioni", False),
    ],
    "gas": [
        ("prezzo_gas", "Prezzo gas €/SMC", True), ("spread", "Spread €/SMC", True), ("tipo_prezzo", "Tipo prezzo (fisso/variabile)", True),
        ("costi_fissi", "Quota fissa / QVD mensile", True), ("accisa", "Accise e imposte", False), ("costo_annuo", "Costo annuo stimato", True),
        ("durata_contratto", "Durata contratto", True), ("penale_disdetta", "Penali / vincoli", True), ("servizi", "Servizi inclusi / extra", False),
    ],
    "telco": [
        ("costo_mensile", "Canone mensile", True), ("costo_annuale", "Costo annuale", True), ("velocita", "Velocità download/upload", True),
        ("servizi_inclusi", "Servizi inclusi (minuti, GB, TV)", True), ("attivazione", "Costo attivazione / modem", True),
        ("durata_contratto", "Durata contratto", True), ("penale_disdetta", "Penali / vincoli", True),
    ],
}

_BAC_SECTIONS: List[Tuple[str, str, str]] = [
    ("impronta", "Impronta energetica", "Consumo annuo, profilo e categoria di utilizzo"),
    ("fasce", "Dettaglio fasce F1/F2/F3", "Ripartizione consumi con grafico a barre"),
    ("contratto", "Analisi contratto attuale", "Fornitore, prezzo, criticità e punti di forza"),
    ("proposta", "Offerta aziendale proposta", "Condizioni economiche della tua offerta"),
    ("risparmio", "Calcolo risparmio", "Costo attuale vs nuovo, risparmio annuo/mensile"),
    ("matrice", "Matrice di confronto", "Tabella Parametro · Attuale · Proposta · Delta · Vantaggio"),
    ("executive", "Executive summary", "Verdetto, punti chiave e prossimi passi"),
]
_BAC_LAYOUTS = [
    ("presentazione", "Presentazione", "Slide orizzontali A4, una sezione per pagina"),
    ("dossier", "Dossier compatto", "Documento verticale A4 con le sezioni in sequenza"),
    ("sintesi", "Sintesi 1 pagina", "Solo risparmio, matrice e verdetto"),
]
_BAC_STYLES = [
    ("classico", "Classico", "Navy e beige, elegante", "#1E3A5F", "#F6F2E7", "#EE8B4A"),
    ("moderno", "Moderno", "Blu e bianco, pulito", "#1B6CB0", "#FFFFFF", "#F59E0B"),
    ("energia", "Energia", "Verde e crema, sostenibile", "#166534", "#F3F7F0", "#EA580C"),
    ("minimal", "Minimal", "Grigio antracite, essenziale", "#1F2937", "#FFFFFF", "#6B7280"),
]
_BAC_BASES = [
    ("annuo", "Costo annuo", "Delta e risparmi su 12 mesi"),
    ("mensile", "Costo mensile", "Delta e risparmi su base mensile"),
    ("unitario", "Prezzo unitario", "€/kWh, €/SMC o canone: confronto sui prezzi"),
]
_BAC_MAX_CUSTOM = 30
_BAC_MAX_TXT = 3000


def _bac_default() -> dict:
    return {
        "fields": {bt: {fid: on for fid, _l, on in lst} for bt, lst in _BAC_FIELDS.items()},
        "custom_fields": {bt: [] for bt in _BAC_FIELDS},
        "extra_instructions": "",
        "comparison": {
            "layout": "presentazione",
            "style": "classico",
            "sections": {sid: True for sid, _l, _d in _BAC_SECTIONS},
            "compare_fields": {bt: {fid: on for fid, _l, on in lst} for bt, lst in _BAC_COMPARE_FIELDS.items()},
            "custom_compare_fields": {bt: [] for bt in _BAC_COMPARE_FIELDS},
            "basis": "annuo",
            "instructions": "",
        },
    }


def _bac_catalog() -> dict:
    return {
        "fields": {bt: [{"id": fid, "label": lb, "default_on": on} for fid, lb, on in lst] for bt, lst in _BAC_FIELDS.items()},
        "compare_fields": {bt: [{"id": fid, "label": lb, "default_on": on} for fid, lb, on in lst] for bt, lst in _BAC_COMPARE_FIELDS.items()},
        "sections": [{"id": sid, "label": lb, "desc": d} for sid, lb, d in _BAC_SECTIONS],
        "layouts": [{"id": i, "label": lb, "desc": d} for i, lb, d in _BAC_LAYOUTS],
        "styles": [{"id": i, "label": lb, "desc": d, "primary": p, "bg": bg, "accent": ac} for i, lb, d, p, bg, ac in _BAC_STYLES],
        "bases": [{"id": i, "label": lb, "desc": d} for i, lb, d in _BAC_BASES],
    }


def _bac_str_list(v: Any) -> List[str]:
    if not isinstance(v, list):
        return []
    out: List[str] = []
    for x in v:
        s = str(x or "").strip()[:80]
        if s and s not in out:
            out.append(s)
    return out[:_BAC_MAX_CUSTOM]


def _bac_bool_map(v: Any, catalog: List[Tuple[str, str, bool]], base: Dict[str, bool]) -> Dict[str, bool]:
    out = dict(base)
    if isinstance(v, dict):
        for fid, _l, _on in catalog:
            if fid in v:
                out[fid] = bool(v[fid])
    return out


def _bac_sanitize(raw: Any) -> dict:
    """Unisce il payload utente ai default: solo chiavi note, tipi coerenti, limiti di lunghezza."""
    d = _bac_default()
    if not isinstance(raw, dict):
        return d
    for bt, lst in _BAC_FIELDS.items():
        d["fields"][bt] = _bac_bool_map((raw.get("fields") or {}).get(bt), lst, d["fields"][bt])
        d["custom_fields"][bt] = _bac_str_list((raw.get("custom_fields") or {}).get(bt))
    d["extra_instructions"] = str(raw.get("extra_instructions") or "").strip()[:_BAC_MAX_TXT]
    rc = raw.get("comparison") or {}
    dc = d["comparison"]
    if isinstance(rc, dict):
        if rc.get("layout") in {i for i, _l, _d in _BAC_LAYOUTS}:
            dc["layout"] = rc["layout"]
        if rc.get("style") in {i for i, *_r in _BAC_STYLES}:
            dc["style"] = rc["style"]
        if rc.get("basis") in {i for i, _l, _d in _BAC_BASES}:
            dc["basis"] = rc["basis"]
        dc["sections"] = _bac_bool_map(rc.get("sections"), [(s, l, True) for s, l, _d in _BAC_SECTIONS], dc["sections"])
        for bt, lst in _BAC_COMPARE_FIELDS.items():
            dc["compare_fields"][bt] = _bac_bool_map((rc.get("compare_fields") or {}).get(bt), lst, dc["compare_fields"][bt])
            dc["custom_compare_fields"][bt] = _bac_str_list((rc.get("custom_compare_fields") or {}).get(bt))
        dc["instructions"] = str(rc.get("instructions") or "").strip()[:_BAC_MAX_TXT]
    return d


async def _bac_get(tenant: str) -> dict:
    doc = await db.bill_analysis_configs.find_one({"tenant_id": tenant}, {"_id": 0, "config": 1})
    return _bac_sanitize((doc or {}).get("config"))


class BacIn(BaseModel):
    config: Dict[str, Any]


@api_router.get("/bills/analysis-config")
async def bac_get(user=Depends(get_current_user)):
    return {"config": await _bac_get(tenant_id(user)), "catalog": _bac_catalog()}


@api_router.put("/bills/analysis-config")
async def bac_put(body: BacIn, user=Depends(get_current_user)):
    cfg = _bac_sanitize(body.config)
    t = tenant_id(user)
    await db.bill_analysis_configs.update_one(
        {"tenant_id": t},
        {"$set": {"config": cfg, "updated_at": utcnow(), "updated_by": user["user_id"]}, "$setOnInsert": {"tenant_id": t, "created_at": utcnow()}},
        upsert=True,
    )
    return {"config": cfg, "catalog": _bac_catalog()}


@api_router.post("/bills/analysis-config/reset")
async def bac_reset(user=Depends(get_current_user)):
    await db.bill_analysis_configs.delete_one({"tenant_id": tenant_id(user)})
    return {"config": _bac_default(), "catalog": _bac_catalog()}


def _bac_labels(cfg: dict, bt: str) -> Tuple[List[str], List[str]]:
    """→ (etichette spuntate + personalizzate, etichette deselezionate) per il tipo fattura."""
    on: List[str] = []
    off: List[str] = []
    flags = (cfg.get("fields") or {}).get(bt) or {}
    for fid, label, default_on in _BAC_FIELDS.get(bt, []):
        (on if flags.get(fid, default_on) else off).append(label)
    on.extend((cfg.get("custom_fields") or {}).get(bt) or [])
    return on, off


async def _bac_apply_extract_config(tenant: str, bill_type: str, display_params: List[str]) -> Tuple[List[str], str]:
    """Applica la configurazione salvata all'estrazione: se l'utente non ha scelto parametri per questa analisi
    usa quelli spuntati nel pannello; aggiunge sempre i campi deselezionati (bassa priorità) e le richieste manuali."""
    bt = bill_type if bill_type in _BAC_FIELDS else "luce"
    cfg = await _bac_get(tenant)
    on, off = _bac_labels(cfg, bt)
    params = list(display_params) if display_params else on
    extra = ""
    if off and not display_params:
        extra += "\n\nCAMPI DESELEZIONATI DALL'UTENTE (bassa priorità, puoi ometterli se non immediatamente leggibili): " + ", ".join(off[:30]) + "."
    instr = (cfg.get("extra_instructions") or "").strip()
    if instr:
        extra += "\n\nRICHIESTE AGGIUNTIVE DELL'UTENTE (rispettale sempre, in aggiunta allo schema JSON; se producono dati nuovi mettili in 'parametri_richiesti'):\n" + instr
    return params, extra


async def _bac_compare_prompt_suffix(tenant: str, bill_type: str) -> str:
    """Testo da appendere al system prompt del confronto fattura ↔ offerta aziendale."""
    bt = bill_type if bill_type in _BAC_COMPARE_FIELDS else "luce"
    cfg = await _bac_get(tenant)
    cmp = cfg.get("comparison") or {}
    flags = (cmp.get("compare_fields") or {}).get(bt) or {}
    fields = [label for fid, label, default_on in _BAC_COMPARE_FIELDS[bt] if flags.get(fid, default_on)]
    fields.extend((cmp.get("custom_compare_fields") or {}).get(bt) or [])
    basis = cmp.get("basis") or "annuo"
    basis_txt = {
        "annuo": "COSTO ANNUO (12 mesi): esprimi delta e risparmi su base annua",
        "mensile": "COSTO MENSILE: esprimi delta e risparmi su base mensile (compila comunque risparmio_annuo_stimato_eur = mensile × 12)",
        "unitario": "PREZZO UNITARIO (€/kWh, €/SMC o canone): il confronto si concentra sui prezzi unitari e sulle quote fisse (compila comunque risparmio_annuo_stimato_eur)",
    }.get(basis, "")
    sections_on = [label for sid, label, _d in _BAC_SECTIONS if (cmp.get("sections") or {}).get(sid, True)]
    out = "\n\nCONFIGURAZIONE CONFRONTO DEFINITA DALL'UTENTE (vincolante):"
    if fields:
        out += "\n- Parametri da confrontare, in quest'ordine: " + ", ".join(fields[:40]) + ". Includi ciascuno come riga di `matrice_confronto` quando i dati lo permettono (se un dato manca in una delle due offerte scrivi 'N.D.' nella cella, non omettere la riga)."
    if basis_txt:
        out += "\n- Base del confronto: " + basis_txt + "."
    if sections_on:
        out += "\n- Sezioni che verranno mostrate nel report: " + ", ".join(sections_on) + ". Concentra la qualità dei dati su queste."
    instr = (cmp.get("instructions") or "").strip()
    if instr:
        out += "\n- Istruzioni aggiuntive dell'utente: " + instr
    return out
