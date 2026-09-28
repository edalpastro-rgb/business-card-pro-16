# corporate_gym_config.py — V50.z203 — Pannello Master Coach: personalizzazione role-play e fasi di sessione (modulo ISOLATO)
#
# Caricato DOPO corporate_gym.py / corporate_gym_manuals.py. Ridefinisce `_cgym_scenario_for(tid, key)` (hook in corporate_gym.py):
# il motore del role-play (persona, max_turns, duration_min, fasi) usa lo scenario EFFETTIVO = default + override del Master Coach.
# Se il Master non modifica nulla, il consulente vede esattamente i valori di default attuali.
#
# Collection `cgym_scenario_configs` { tenant_id, scenario_key, overrides: {label, description, image_url, duration_min, max_turns,
#   tips[] (checklist obiettivi), customer:{name, role, company}, manual_ref:{kind folder|file, id, name}},
#   phases: [{id, name, minutes_to, manual_ref?}] | null (null = fasi di default), updated_by, updated_at }
# API: GET /cgym/config/scenarios (tutti, merged, can_edit) · GET/PUT/DELETE /cgym/config/scenarios/{key} (PUT/DELETE solo Master)
#      GET /cgym/config/scenarios/{key}/phases (per il consulente durante la sessione)

_CGC_DEFAULT_UI = {   # default identici a CGYM_SCENARIO_META del frontend (src/corporate-gym/api.ts)
    "tempo": {"customer": {"name": "Marco Bianchi", "role": "titolare", "company": "officina meccanica, 6 dipendenti (Vicenza)"}, "image_url": None,
              "description": "Hai appena proposto un'analisi delle bollette: il cliente non ha tempo e rimanda. Gestisci l'obiezione come faresti al telefono.",
              "tips": ["Riconosci l'obiezione senza contrastarla", "Quantifica il tempo che chiedi e il beneficio", "Proponi uno slot preciso e breve"]},
    "costo": {"customer": {"name": "Giuseppe", "role": "titolare", "company": "bar-pasticceria"}, "image_url": None,
              "description": "La proposta gli sembra cara e il fornitore attuale promette un prezzo migliore: chiede subito uno sconto.",
              "tips": ["Chiedi cosa sta confrontando davvero", "Sposta dal prezzo unitario al costo totale annuo e al valore", "Niente sconti immediati: concessioni solo in cambio di qualcosa"]},
    "decisore": {"customer": {"name": "Laura", "role": "responsabile amministrativa", "company": "studio dentistico"}, "image_url": None,
                 "description": "\"Devo parlarne con il dottore, non decido io.\" Rispetta il suo ruolo e porta la trattativa al decisore senza scavalcarla.",
                 "tips": ["Capisci come si decide davvero: chi, quando, con quali criteri", "Aiutala a presentare la proposta (sintesi e numeri)", "Proponi un incontro a tre con data e ora"]},
    "winwin": {"customer": {"name": "Elena Rossi", "role": "direttrice acquisti", "company": "PMI con 3 supermercati in Veneto (≈180.000 €/anno di energia)"}, "image_url": None,
               "description": "Sessione completa da 45 minuti: trattativa integrata sul contratto di fornitura (prezzo, durata, pagamento, servizi, green). Elena chiede il prezzo più basso e uscita libera, ma ha interessi nascosti da scoprire.",
               "tips": ["Fase 1-2: clima e domande aperte per scoprire gli interessi reali", "Fase 3: crea opzioni e pacchetti, allarga la torta oltre il prezzo", "Fase 4: scambia concessioni (\"se... allora\"), mai regali", "Fase 5: sintesi e accordo concreto su prezzo, durata, pagamento"]},
}
_CGC_OVERRIDE_KEYS = ("label", "description", "image_url", "duration_min", "max_turns", "tips", "customer", "manual_ref")


class CgcManualRef(BaseModel):
    kind: str = "folder"          # folder | file
    id: str
    name: Optional[str] = None
    mime: Optional[str] = None


class CgcPhaseIn(BaseModel):
    id: Optional[str] = None
    name: str
    minutes_to: Optional[float] = None   # fine fase (minuti dall'inizio); se assente → suddivisione uniforme della durata
    manual_ref: Optional[CgcManualRef] = None


class CgcCustomerIn(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    company: Optional[str] = None


class CgcScenarioPatch(BaseModel):
    model_answer: Optional[str] = None      # V50.z396 — solo custom: risposta modello (riservata al Master)
    label: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    duration_min: Optional[float] = None
    max_turns: Optional[int] = None
    tips: Optional[List[str]] = None
    customer: Optional[CgcCustomerIn] = None
    manual_ref: Optional[CgcManualRef] = None
    clear_manual_ref: bool = False
    phases: Optional[List[CgcPhaseIn]] = None     # lista completa (aggiungi/rimuovi/rinomina/riordina); [] = nessuna fase
    reset_phases: bool = False                    # torna alle fasi di default
    # solo scenari custom:
    objection: Optional[str] = None
    persona: Optional[str] = None
    opening_hint: Optional[str] = None
    eval_criteria: Optional[str] = None
    voice: Optional[str] = None
    area: Optional[str] = None


# ============================================================================ V50.z204 — SCENARI CUSTOM (creati dal Master Coach)
# Collection `cgym_custom_scenarios` { tenant_id, key "custom_<id>", area obiezioni|winwin, label, objection, persona, opening_hint,
#   eval_criteria, voice, duration_min, max_turns, description, image_url, tips[], customer{}, manual_ref, phases[], created_by, updated_at }
_CGC_CUSTOM_PREFIX = "custom_"


class CgcCustomScenarioIn(BaseModel):
    area: str = "obiezioni"                 # obiezioni | winwin
    label: str
    objection: Optional[str] = None         # obiezione / tema della trattativa (in una riga)
    persona: Optional[str] = None           # chi è il cliente simulato e come si comporta (istruzioni all'AI)
    opening_hint: Optional[str] = None      # come apre il cliente
    eval_criteria: Optional[str] = None     # criteri di valutazione finale
    model_answer: Optional[str] = None      # V50.z396 — RISPOSTA MODELLO (solo Master): Axon la usa come riferimento per valutare il consulente
    voice: Optional[str] = None
    duration_min: Optional[float] = None
    max_turns: Optional[int] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    tips: Optional[List[str]] = None
    customer: Optional[CgcCustomerIn] = None
    manual_ref: Optional[CgcManualRef] = None
    phases: Optional[List[CgcPhaseIn]] = None


def _cgc_is_custom(key: str) -> bool:
    return key.startswith(_CGC_CUSTOM_PREFIX)


async def _cgc_custom(tid: str, key: str) -> Optional[dict]:
    return await db.cgym_custom_scenarios.find_one({"tenant_id": tid, "key": key}, {"_id": 0})


def _cgc_custom_persona(doc: dict) -> str:
    c = doc.get("customer") or {}
    ident = f"Ti chiami {c.get('name') or 'Cliente'}" + (f", sei {c['role']}" if c.get("role") else "") + (f" di {c['company']}" if c.get("company") else "") + "."
    base = (doc.get("persona") or "").strip() or f"Sei un cliente reale di un consulente energetico. Tema: {doc.get('objection') or doc.get('label')}. Resta nel ruolo, realistico, mai un consulente."
    return f"{ident} {base}\nRegole: resta SEMPRE nel personaggio, risposte brevi e realistiche (max 3 frasi), non dare consigli al consulente, non uscire dal ruolo."


def _cgc_custom_scenario(doc: dict) -> dict:
    """Trasforma il documento custom nella stessa forma di CGYM_SCENARIOS (usata dal motore)."""
    area = doc.get("area") if doc.get("area") in ("obiezioni", "winwin") else "obiezioni"
    sc = {"area": area, "label": doc["label"], "objection": doc.get("objection") or doc["label"], "max_turns": int(doc.get("max_turns") or (30 if area == "winwin" else CGYM_RP_MAX_TURNS)),
          "duration_min": float(doc.get("duration_min") or (45 if area == "winwin" else 5)), "voice": doc.get("voice") or "onyx", "persona": _cgc_custom_persona(doc),
          "opening_hint": doc.get("opening_hint") or f"Apri tu la conversazione come farebbe il cliente: presenta subito il tema «{doc.get('objection') or doc['label']}».",
          "eval_criteria": doc.get("eval_criteria") or "Valuta: ascolto e rispetto del ruolo, capacità di riformulare l'obiezione, valore e numeri concreti, chiusura con prossimo passo preciso.",
          "custom": True, "model_answer": (doc.get("model_answer") or "").strip() or None}
    if doc.get("phases"):
        sc["phases"] = [(float(p.get("minutes_to") or 0), p["name"]) for p in doc["phases"] if p.get("name")]
    return sc


def _cgc_custom_out(doc: dict) -> dict:
    sc = _cgc_custom_scenario(doc)
    return {"key": doc["key"], "area": sc["area"], "label": sc["label"], "objection": sc["objection"], "description": doc.get("description") or "", "image_url": doc.get("image_url"),
            "duration_min": sc["duration_min"], "max_turns": sc["max_turns"], "tips": list(doc.get("tips") or []), "customer": dict(doc.get("customer") or {}), "manual_ref": doc.get("manual_ref"),
            "phases": list(doc.get("phases") or []), "voice": sc["voice"], "persona": doc.get("persona") or "", "opening_hint": doc.get("opening_hint") or "", "eval_criteria": doc.get("eval_criteria") or "", "model_answer": doc.get("model_answer") or "",
            "is_customized": True, "is_custom": True, "customized_fields": [], "updated_at": doc.get("updated_at").isoformat() if isinstance(doc.get("updated_at"), datetime) else None}


def _cgc_default_phases(key: str) -> List[dict]:
    if CGYM_SCENARIOS[key]["area"] != "winwin":
        return []
    return [{"id": f"p{i + 1}", "name": name, "minutes_to": lim, "manual_ref": None} for i, (lim, name) in enumerate(CGYM_WW_PHASES)]


def _cgc_defaults(key: str) -> dict:
    base = CGYM_SCENARIOS[key]; ui = _CGC_DEFAULT_UI.get(key, {})
    return {"key": key, "area": base["area"], "label": base["label"], "objection": base["objection"], "description": ui.get("description") or "", "image_url": ui.get("image_url"),
            "duration_min": base.get("duration_min", 5), "max_turns": base.get("max_turns", CGYM_RP_MAX_TURNS), "tips": list(ui.get("tips") or []),
            "customer": dict(ui.get("customer") or {}), "manual_ref": None, "phases": _cgc_default_phases(key), "voice": base.get("voice", "onyx")}


def _cgc_merge(key: str, cfg: Optional[dict]) -> dict:
    d = _cgc_defaults(key); ov = (cfg or {}).get("overrides") or {}
    for k in _CGC_OVERRIDE_KEYS:
        if ov.get(k) is not None and ov.get(k) != "" and ov.get(k) != []:
            d[k] = ov[k] if k != "customer" else {**d["customer"], **{kk: vv for kk, vv in ov[k].items() if vv}}
    if cfg and cfg.get("phases") is not None:
        d["phases"] = cfg["phases"]
    d["is_customized"] = bool(ov) or (cfg is not None and cfg.get("phases") is not None)
    d["customized_fields"] = [k for k in _CGC_OVERRIDE_KEYS if ov.get(k) not in (None, "", [])] + (["phases"] if cfg and cfg.get("phases") is not None else [])
    d["updated_at"] = cfg.get("updated_at").isoformat() if cfg and isinstance(cfg.get("updated_at"), datetime) else None
    return d


def _cgc_persona(key: str, merged: dict) -> str:
    """Persona effettiva: se il Master ha cambiato nome/ruolo/azienda del cliente simulato, il personaggio li adotta."""
    base = CGYM_SCENARIOS[key]["persona"]
    dflt = _CGC_DEFAULT_UI.get(key, {}).get("customer") or {}
    cust = merged.get("customer") or {}
    if all(cust.get(k) == dflt.get(k) for k in ("name", "role", "company")):
        return base
    return (f"IDENTITÀ DEL PERSONAGGIO (impostata dal Master Coach, prevale su nomi/ruoli/aziende citati sotto): ti chiami {cust.get('name') or dflt.get('name')}, "
            f"sei {cust.get('role') or dflt.get('role')} di {cust.get('company') or dflt.get('company')}. Presentati e firma SEMPRE con questo nome.\n\n" + base)


async def _cgc_config(tid: str, key: str) -> Optional[dict]:
    return await db.cgym_scenario_configs.find_one({"tenant_id": tid, "scenario_key": key}, {"_id": 0})


async def _cgym_scenario_for(tid: str, key: str) -> dict:  # noqa: F811 — hook del motore role-play
    if _cgc_is_custom(key):
        doc = await _cgc_custom(tid, key)
        if not doc:
            raise HTTPException(status_code=404, detail="Scenario personalizzato non trovato")
        return _cgc_custom_scenario(doc)
    if key not in CGYM_SCENARIOS:
        raise HTTPException(status_code=404, detail="Scenario non valido")
    base = CGYM_SCENARIOS[key]
    cfg = await _cgc_config(tid, key)
    if not cfg:
        return base
    m = _cgc_merge(key, cfg)
    sc = dict(base)
    sc.update({"label": m["label"], "duration_min": m["duration_min"], "max_turns": int(m["max_turns"]), "persona": _cgc_persona(key, m)})
    if m.get("phases"):
        sc["phases"] = [(float(p.get("minutes_to") or 0), p["name"]) for p in m["phases"] if p.get("name")]
    elif cfg.get("phases") == []:
        sc["phases"] = []
    return sc


@api_router.get("/cgym/config/scenarios")
async def cgc_scenarios(user=Depends(get_current_user)):
    tid = tenant_id(user)
    cfgs = {c["scenario_key"]: c async for c in db.cgym_scenario_configs.find({"tenant_id": tid}, {"_id": 0})}
    customs = [_cgc_hide(_cgc_custom_out(d), user) async for d in db.cgym_custom_scenarios.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", 1)]
    return {"items": [_cgc_merge(k, cfgs.get(k)) for k in CGYM_SCENARIOS] + customs, "can_edit": is_owner(user)}


def _cgc_hide(out: dict, user: dict) -> dict:
    """V50.z396 — consulenti/utenti normali NON vedono risposta modello, istruzioni al cliente simulato e criteri (solo Master)."""
    if is_owner(user):
        return out
    return {**out, "model_answer": "", "persona": "", "eval_criteria": "", "opening_hint": ""}


@api_router.get("/cgym/config/scenarios/{key}")
async def cgc_scenario_get(key: str, user=Depends(get_current_user)):
    if _cgc_is_custom(key):
        doc = await _cgc_custom(tenant_id(user), key)
        if not doc:
            raise HTTPException(status_code=404, detail="Scenario personalizzato non trovato")
        out = _cgc_hide(_cgc_custom_out(doc), user)
        return {**out, "defaults": out, "can_edit": is_owner(user)}
    if key not in CGYM_SCENARIOS:
        raise HTTPException(status_code=404, detail="Scenario non valido")
    return {**_cgc_merge(key, await _cgc_config(tenant_id(user), key)), "defaults": _cgc_defaults(key), "can_edit": is_owner(user)}


def _cgc_norm_phases(key: str, phases: List[CgcPhaseIn], duration_min: float) -> List[dict]:
    out = []
    n = len(phases)
    for i, p in enumerate(phases):
        name = (p.name or "").strip()[:80]
        if not name:
            continue
        mt = p.minutes_to if p.minutes_to is not None else round(duration_min * (i + 1) / max(1, n), 1)
        out.append({"id": (p.id or f"p{uuid.uuid4().hex[:6]}"), "name": name, "minutes_to": float(mt), "manual_ref": p.manual_ref.model_dump() if p.manual_ref else None})
    # ordine = ordine della lista; minuti non decrescenti
    last = 0.0
    for p in out:
        if p["minutes_to"] < last:
            p["minutes_to"] = last
        last = p["minutes_to"]
    return out


@api_router.put("/cgym/config/scenarios/{key}")
async def cgc_scenario_put(key: str, body: CgcScenarioPatch, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master Coach può personalizzare i role-play")
    tid = tenant_id(user)
    if _cgc_is_custom(key):
        doc = await _cgc_custom(tid, key)
        if not doc:
            raise HTTPException(status_code=404, detail="Scenario personalizzato non trovato")
        upd: Dict[str, Any] = {"updated_at": utcnow()}
        for f in ("label", "description", "image_url", "duration_min", "max_turns", "objection", "persona", "opening_hint", "eval_criteria", "voice", "area", "model_answer"):
            v = getattr(body, f, None)
            if v is not None: upd[f] = v
        if body.tips is not None: upd["tips"] = [t.strip()[:200] for t in body.tips if t.strip()][:12]
        if body.customer is not None: upd["customer"] = {k: (v or "").strip()[:120] or None for k, v in body.customer.model_dump().items()}
        if body.clear_manual_ref: upd["manual_ref"] = None
        elif body.manual_ref is not None: upd["manual_ref"] = body.manual_ref.model_dump()
        if body.phases is not None: upd["phases"] = _cgc_norm_phases(key, body.phases, float(upd.get("duration_min") or doc.get("duration_min") or 5))
        await db.cgym_custom_scenarios.update_one({"tenant_id": tid, "key": key}, {"$set": upd})
        out = _cgc_custom_out({**doc, **upd})
        return {**out, "defaults": out, "can_edit": True}
    if key not in CGYM_SCENARIOS:
        raise HTTPException(status_code=404, detail="Scenario non valido")
    cfg = await _cgc_config(tid, key) or {"tenant_id": tid, "scenario_key": key, "overrides": {}, "phases": None}
    ov = dict(cfg.get("overrides") or {})
    if body.label is not None: ov["label"] = body.label.strip()[:80] or None
    if body.description is not None: ov["description"] = body.description.strip()[:1500] or None
    if body.image_url is not None: ov["image_url"] = body.image_url.strip()[:500] or None
    if body.duration_min is not None: ov["duration_min"] = max(1.0, min(180.0, float(body.duration_min)))
    if body.max_turns is not None: ov["max_turns"] = max(1, min(100, int(body.max_turns)))
    if body.tips is not None: ov["tips"] = [t.strip()[:200] for t in body.tips if t.strip()][:12] or None
    if body.customer is not None: ov["customer"] = {k: (v or "").strip()[:120] or None for k, v in body.customer.model_dump().items()}
    if body.clear_manual_ref: ov["manual_ref"] = None
    elif body.manual_ref is not None: ov["manual_ref"] = body.manual_ref.model_dump()
    ov = {k: v for k, v in ov.items() if v is not None}
    dflt = _cgc_defaults(key)   # valori uguali ai default NON sono personalizzazioni (il consulente vede i default correnti)
    ov = {k: v for k, v in ov.items() if not (k in dflt and (v == dflt[k] or (k == "customer" and {kk: vv for kk, vv in v.items() if vv} == dflt["customer"])))}
    phases = cfg.get("phases")
    if body.reset_phases:
        phases = None
    elif body.phases is not None:
        phases = _cgc_norm_phases(key, body.phases, float(ov.get("duration_min") or CGYM_SCENARIOS[key].get("duration_min", 5)))
        dp = _cgc_default_phases(key)
        if [(p["name"], p["minutes_to"], p.get("manual_ref")) for p in phases] == [(p["name"], float(p["minutes_to"]), p.get("manual_ref")) for p in dp]:
            phases = None   # identiche ai default → nessuna personalizzazione
    doc = {"tenant_id": tid, "scenario_key": key, "overrides": ov, "phases": phases, "updated_by": user["user_id"], "updated_at": utcnow()}
    await db.cgym_scenario_configs.update_one({"tenant_id": tid, "scenario_key": key}, {"$set": doc}, upsert=True)
    return {**_cgc_merge(key, doc), "defaults": _cgc_defaults(key), "can_edit": True}


@api_router.delete("/cgym/config/scenarios/{key}")
async def cgc_scenario_reset(key: str, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master Coach può ripristinare i role-play")
    if _cgc_is_custom(key):
        r = await db.cgym_custom_scenarios.delete_one({"tenant_id": tenant_id(user), "key": key})
        if not r.deleted_count:
            raise HTTPException(status_code=404, detail="Scenario personalizzato non trovato")
        return {"ok": True, "deleted": key}
    await db.cgym_scenario_configs.delete_one({"tenant_id": tenant_id(user), "scenario_key": key})
    return {**_cgc_merge(key, None), "defaults": _cgc_defaults(key), "can_edit": True}


@api_router.post("/cgym/config/custom")
async def cgc_custom_create(body: CgcCustomScenarioIn, user=Depends(get_current_user)):
    """Master Coach: crea un role-play completamente nuovo (compare nella sezione Gym della sua area per tutti i consulenti)."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master Coach può creare nuovi role-play")
    label = (body.label or "").strip()[:80]
    if len(label) < 3:
        raise HTTPException(status_code=400, detail="Titolo troppo corto")
    tid = tenant_id(user)
    if await db.cgym_custom_scenarios.count_documents({"tenant_id": tid}) >= 30:
        raise HTTPException(status_code=400, detail="Massimo 30 role-play personalizzati")
    key = f"{_CGC_CUSTOM_PREFIX}{uuid.uuid4().hex[:8]}"
    area = body.area if body.area in ("obiezioni", "winwin") else "obiezioni"
    doc = {"tenant_id": tid, "key": key, "area": area, "label": label, "objection": (body.objection or "").strip()[:200] or None, "persona": (body.persona or "").strip()[:3000] or None,
           "opening_hint": (body.opening_hint or "").strip()[:600] or None, "eval_criteria": (body.eval_criteria or "").strip()[:1500] or None, "model_answer": (body.model_answer or "").strip()[:3000] or None, "voice": body.voice or ("nova" if area == "winwin" else "onyx"),
           "duration_min": max(1.0, min(180.0, float(body.duration_min or (45 if area == "winwin" else 5)))), "max_turns": max(1, min(100, int(body.max_turns or (30 if area == "winwin" else CGYM_RP_MAX_TURNS)))),
           "description": (body.description or "").strip()[:1500] or None, "image_url": (body.image_url or "").strip()[:500] or None,
           "tips": [t.strip()[:200] for t in (body.tips or []) if t.strip()][:12], "customer": {k: (v or "").strip()[:120] or None for k, v in (body.customer.model_dump() if body.customer else {}).items()},
           "manual_ref": body.manual_ref.model_dump() if body.manual_ref else None, "phases": [], "created_by": user["user_id"], "created_at": utcnow(), "updated_at": utcnow()}
    if body.phases:
        doc["phases"] = _cgc_norm_phases(key, body.phases, doc["duration_min"])
    await db.cgym_custom_scenarios.insert_one(dict(doc))
    out = _cgc_custom_out(doc)
    return {**out, "defaults": out, "can_edit": True}


@app.on_event("startup")
async def _cgc_start():
    try:
        await db.cgym_scenario_configs.create_index([("tenant_id", 1), ("scenario_key", 1)], unique=True)
        await db.cgym_custom_scenarios.create_index([("tenant_id", 1), ("key", 1)], unique=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cgc] index failed: %s", exc)
