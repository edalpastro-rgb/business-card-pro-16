# axon_self_learning.py — V50.z188 — Blocco 7: Autoapprendimento anonimizzato di AxonOS
#
# MODULO ISOLATO (caricato dopo axon_notifications → usa `_axn_scheduler`, e dopo axon_crm_omniscience →
# avvolge `_build_crm_omniscience_section` in modo NON invasivo per iniettare il contesto appreso).
#
# a) ESTRAZIONE INSIGHT ANONIMIZZATI — job in background ogni 10 min: ogni sessione di chat
#    (`assistant_messages.session_id`) conclusa (ultimo messaggio > 20 min fa) e non ancora analizzata
#    viene (1) pre-anonimizzata con regex (email, telefoni, IBAN, POD/PDR, CF/P.IVA, importi, date,
#    numeri, nomi propri dopo Sig./Dott./cliente…), (2) passata a Claude Haiku che estrae pattern
#    generali (domande frequenti, argomenti ricorrenti, lacune informative) SENZA dati personali,
#    (3) post-anonimizzata di nuovo (difesa in profondità) e (4) unita al knowledge base.
# b) KNOWLEDGE BASE INTERNO — collection `axon_knowledge_base`:
#    { id, tenant_id, category, kind (faq|topic|gap), insight, frequency, first_seen_at, updated_at,
#      enabled, source_sessions:int, reviewed:bool }  — dedupe per similarità Jaccard (≥0.6) → frequency++.
#    Registro sessioni analizzate: `axon_kb_processed_sessions`.
# c) USO NELLE CONVERSAZIONI — sezione "APPRENDIMENTO AXONOS" aggiunta al contesto omnisciente:
#    insight del tenant + insight aggregati cross-tenant con frequency ≥ 3 (solo enabled), scelti per
#    pertinenza con il messaggio; max 8.
# Dashboard Master: GET /axon/kb-insights (filtri), /stats, PUT (modifica/abilita/revisiona), DELETE,
# POST /run (analisi immediata), DELETE /axon/kb-insights (svuota tenant).

from pymongo import ReturnDocument

_OMNI_EXTRA_SECTIONS.append((
    "Autoapprendimento Axon (Master)", "/axon-insights",
    "Knowledge base interno: insight anonimizzati (domande frequenti, argomenti, lacune) estratti in background dalle conversazioni concluse; "
    "il Master li revisiona, modifica, disattiva o cancella. Axon li usa come contesto per rispondere meglio nel tempo."
))

_ASL_SESSION_IDLE_MIN = 20
_ASL_MAX_SESSIONS_PER_TICK = 25
_ASL_MAX_MSGS = 40
_ASL_MIN_USER_MSGS = 1
_ASL_MODEL = ("anthropic", "claude-haiku-4-5-20251001")
_ASL_CATEGORIES = ["Bollette & Tariffe", "Contratti & Attivazioni", "Contatti & CRM", "Agenda & Appuntamenti",
                   "Uso dell'app", "Vendita & Script", "Network & Team", "Corporate Gym", "Altro"]
_ASL_GLOBAL_MIN_FREQ = 3

_ASL_SYSTEM = (
    "Sei l'analista di AxonOS (assistente CRM per consulenti energia/network in Italia). Ricevi una conversazione "
    "GIÀ pseudonimizzata tra un utente e AxonOS. Estrai SOLO pattern generali riutilizzabili:\n"
    "• faq: domande che l'utente pone e che probabilmente porranno anche altri (riformulate in modo generico);\n"
    "• topic: argomenti ricorrenti / esigenze di lavoro;\n"
    "• gap: lacune informative — cose che AxonOS non ha saputo fare/rispondere bene, o dati mancanti nel CRM.\n"
    "REGOLE ASSOLUTE DI ANONIMATO: nessun nome di persona, azienda cliente, fornitore specifico se legato a un cliente, "
    "città, via, numero, importo, data specifica, codice, email, telefono, riferimento a contratti o contatti reali. "
    "Sostituisci con termini generici (\"un cliente\", \"un importo\", \"una data\"). Se un insight non può essere reso "
    "anonimo, scartalo. Massimo 6 insight, ognuno ≤ 200 caratteri, in italiano, utili per migliorare le risposte future.\n"
    f"Categorie ammesse: {', '.join(_ASL_CATEGORIES)}.\n"
    "Rispondi SOLO con JSON: {\"insights\":[{\"category\":\"...\",\"kind\":\"faq|topic|gap\",\"insight\":\"...\"}]}"
)

# --- Anonimizzazione regex (pre e post) ---------------------------------------------------------
_ASL_RX = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+", re.I), "[email]"),
    (re.compile(r"\bIT\d{2}[A-Z]\d{10}[0-9A-Z]{12}\b", re.I), "[iban]"),
    (re.compile(r"\bIT\d{3}E\d{8}\b|\b\d{14}\b", re.I), "[pod/pdr]"),
    (re.compile(r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b"), "[codice fiscale]"),
    (re.compile(r"\b\d{11}\b"), "[p.iva]"),
    (re.compile(r"(\+39\s?)?\b3\d{2}[\s.-]?\d{6,7}\b|\b0\d{1,3}[\s.-]?\d{5,8}\b"), "[telefono]"),
    (re.compile(r"https?://\S+", re.I), "[link]"),
    (re.compile(r"\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b"), "[data]"),
    (re.compile(r"\b\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(\s+\d{4})?\b", re.I), "[data]"),
    (re.compile(r"(€|eur|euro)\s?\d[\d.,]*|\d[\d.,]*\s?(€|eur|euro)\b", re.I), "[importo]"),
    (re.compile(r"\b(via|viale|piazza|corso|largo|vicolo)\s+[A-ZÀ-Ü][\w' ]{2,40}\s+\d+[a-z]?\b", re.I), "[indirizzo]"),
    (re.compile(r"\b(sig\.?|sig\.ra|signor[ae]?|dott\.?|dottor[e]?|ing\.?|avv\.?|cliente|contatto|il signor|la signora)\s+[A-ZÀ-Ü][a-zà-ü]+(\s+[A-ZÀ-Ü][a-zà-ü]+)?", re.I), r"\1 [nome]"),
    (re.compile(r"\b[A-ZÀ-Ü][\w&'.-]*(?:\s+[A-ZÀ-Ü][\w&'.-]*){0,3}\s+(?:S\.?p\.?A\.?|S\.?r\.?l\.?s?|S\.?n\.?c\.?|S\.?a\.?s\.?|S\.?c\.?a\.?r\.?l\.?|Ltd|GmbH|Inc)\b", re.I), "[azienda]"),
    (re.compile(r"[A-Za-z0-9]+_[A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)?"), "[nome]"),   # TEST_Luca Rossi
    (re.compile(r"\b[A-ZÀ-Ü][a-zà-ü]{2,}\s+[A-ZÀ-Ü][a-zà-ü]{2,}\b"), "[nome]"),   # Nome Cognome
    (re.compile(r"\b\d+(?:[.,]\d+)?\b"), "N"),
]


def _asl_anonymize(text: str) -> str:
    out = text or ""
    for rx, rep in _ASL_RX:
        out = rx.sub(rep, out)
    return re.sub(r"\s{2,}", " ", out).strip()


_ASL_ALLOW_CAPS = {"axonos", "axon", "crm", "master", "corporate", "gym", "drive", "libretto", "agenda", "bolletta", "bollette", "pod", "pdr",
                   "iban", "iva", "ai", "kpi", "pdf", "app", "excel", "google", "outlook", "gmail", "whatsapp", "enel", "eni", "edison",
                   "sorgenia", "a2a", "hera", "iren", "plenitude", "italia", "nord", "sud", "centro", "luce", "gas", "fibra", "telefonia",
                   "fotovoltaico", "network", "team", "statistiche", "cruscotto", "contatti", "home", "help", "scanner", "meteo", "utente",
                   "cliente", "clienti", "n", "advisoros", "neo", "ritelefonata", "ritelefonate", "appuntamento", "appuntamenti", "energia",
                   "arera", "cte", "gse", "spid", "faq", "ok", "pin", "id", "sms", "email", "mail", "pec", "eur", "kwh", "smc", "mwh", "tour",
                   "knowledge", "base", "manuale", "manuali", "script", "banner", "evento", "eventi", "report", "dashboard", "widget", "master",
                   "admin", "owner", "collaboratore", "collaboratori", "consulente", "consulenti", "networker", "networkers", "energy",
                   "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre",
                   "dicembre", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica", "il", "la", "lo", "l", "un",
                   "una", "se", "quando", "come", "cosa", "chi", "dove", "perché", "non", "in", "a", "di", "da", "per", "con", "su", "e"}


def _asl_scrub_caps(text: str) -> str:
    """Post-LLM: ogni parola con iniziale maiuscola NON a inizio frase e non in allowlist → [nome] (difesa in profondità)."""
    out = []
    sentence_start = True
    for tok in re.split(r"(\s+)", text or ""):
        if not tok or tok.isspace():
            out.append(tok); continue
        core = tok.strip(".,;:!?()[]\"'«»")
        low = core.lower()
        is_cap = bool(core) and core[0].isupper() and any(ch.islower() for ch in core[1:]) and low not in _ASL_ALLOW_CAPS
        if is_cap and not sentence_start and not tok.startswith("["):
            out.append(tok.replace(core, "[nome]"))
        else:
            out.append(tok)
        sentence_start = tok.endswith((".", "!", "?", ":", ";"))
    return "".join(out)


def _asl_tokens(s: str) -> set:
    return {w for w in re.findall(r"[a-zà-ü0-9]{3,}", (s or "").lower()) if w not in _ASL_STOP}


_ASL_STOP = {"che", "come", "per", "con", "una", "uno", "del", "della", "dei", "delle", "nel", "nella", "gli", "le", "sul", "sulla",
             "quando", "dove", "quale", "quali", "cosa", "non", "più", "anche", "sono", "essere", "fare", "chiede", "chiedono",
             "utente", "utenti", "axon", "axonos", "app", "vuole", "vogliono", "spesso", "cliente", "clienti", "nome", "questo", "questa"}


def _asl_norm_cat(c: str) -> str:
    c = (c or "").strip()
    for k in _ASL_CATEGORIES:
        if k.lower() == c.lower() or k.split(" ")[0].lower() in c.lower():
            return k
    return "Altro"


async def _asl_llm_extract(convo: str) -> List[dict]:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return []
    chat = LlmChat(api_key=key, session_id=f"asl-{uuid.uuid4().hex[:8]}", system_message=_ASL_SYSTEM).with_model(*_ASL_MODEL)
    resp = await chat.send_message(UserMessage(text=f"CONVERSAZIONE:\n{convo[:12000]}"))
    data = _parse_llm_json((resp or "").strip(), fallback_key="raw")
    items = data.get("insights") if isinstance(data, dict) else None
    out = []
    for it in (items or [])[:6]:
        if not isinstance(it, dict):
            continue
        ins = _asl_scrub_caps(_asl_anonymize(str(it.get("insight") or ""))).strip()
        if len(ins) < 12:
            continue
        kind = str(it.get("kind") or "topic").lower()
        out.append({"category": _asl_norm_cat(str(it.get("category") or "")), "kind": kind if kind in ("faq", "topic", "gap") else "topic",
                    "insight": ins[:220]})
    return out


async def _asl_merge(tid: str, items: List[dict], session_id: str) -> Dict[str, int]:
    """Unisce gli insight al KB del tenant (dedupe Jaccard ≥ 0.6 per categoria)."""
    added = merged = 0
    existing = await db.axon_knowledge_base.find({"tenant_id": tid}, {"_id": 0, "id": 1, "category": 1, "insight": 1}).to_list(3000)
    ex_tok = [(e, _asl_tokens(e["insight"])) for e in existing]
    now = utcnow()
    for it in items:
        t = _asl_tokens(it["insight"])
        best, best_j = None, 0.0
        for e, et in ex_tok:
            if e["category"] != it["category"] or not et or not t:
                continue
            j = len(t & et) / len(t | et)
            if j > best_j:
                best, best_j = e, j
        if best and best_j >= 0.6:
            await db.axon_knowledge_base.update_one({"id": best["id"]}, {"$inc": {"frequency": 1, "source_sessions": 1},
                                                                        "$set": {"updated_at": now}})
            merged += 1
        else:
            doc = {"id": uuid.uuid4().hex, "tenant_id": tid, "category": it["category"], "kind": it["kind"], "insight": it["insight"],
                   "frequency": 1, "source_sessions": 1, "first_seen_at": now, "updated_at": now, "enabled": True, "reviewed": False}
            await db.axon_knowledge_base.insert_one(doc)
            ex_tok.append(({"id": doc["id"], "category": doc["category"], "insight": doc["insight"]}, t))
            added += 1
    return {"added": added, "merged": merged}


async def _asl_tenant_of(uid: str) -> str:
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "parent_user_id": 1})
    return (u or {}).get("parent_user_id") or uid


async def _asl_process_session(session_id: str, user_id: str) -> Dict[str, Any]:
    msgs = await db.assistant_messages.find({"session_id": session_id, "user_id": user_id}, {"_id": 0, "role": 1, "content": 1}) \
        .sort("created_at", 1).limit(_ASL_MAX_MSGS).to_list(_ASL_MAX_MSGS)
    tid = await _asl_tenant_of(user_id)
    rec = {"session_id": session_id, "user_id": user_id, "tenant_id": tid, "processed_at": utcnow(), "messages": len(msgs)}
    user_msgs = [m for m in msgs if m.get("role") == "user" and (m.get("content") or "").strip()]
    if len(user_msgs) < _ASL_MIN_USER_MSGS:
        rec["skipped"] = "no_user_messages"
        await db.axon_kb_processed_sessions.update_one({"session_id": session_id}, {"$set": rec}, upsert=True)
        return rec
    convo = "\n".join(f"{'UTENTE' if m.get('role') == 'user' else 'AXON'}: {_asl_anonymize(str(m.get('content') or '')[:1500])}" for m in msgs)
    try:
        items = await _asl_llm_extract(convo)
        res = await _asl_merge(tid, items, session_id)
        rec.update({"insights": len(items), **res})
    except Exception as exc:  # noqa: BLE001
        rec["error"] = str(exc)[:300]
        logger.warning("[axon-learn] session %s failed: %s", session_id, exc)
    await db.axon_kb_processed_sessions.update_one({"session_id": session_id}, {"$set": rec}, upsert=True)
    return rec


async def _asl_find_pending(tenant: Optional[str] = None, idle_min: int = _ASL_SESSION_IDLE_MIN, limit: int = _ASL_MAX_SESSIONS_PER_TICK) -> List[dict]:
    cutoff = utcnow() - timedelta(minutes=idle_min)
    match: Dict[str, Any] = {"session_id": {"$exists": True, "$ne": None}}
    if tenant:
        uids = [u["user_id"] async for u in db.users.find({"$or": [{"user_id": tenant}, {"parent_user_id": tenant}]}, {"_id": 0, "user_id": 1})]
        match["user_id"] = {"$in": uids}
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$session_id", "user_id": {"$first": "$user_id"}, "last": {"$max": "$created_at"}, "n": {"$sum": 1}}},
        {"$match": {"last": {"$lt": cutoff}, "n": {"$gte": 2}}},
        {"$sort": {"last": -1}},
        {"$limit": 400},
    ]
    cands = await db.assistant_messages.aggregate(pipeline).to_list(400)
    done = {d["session_id"] async for d in db.axon_kb_processed_sessions.find({"session_id": {"$in": [c["_id"] for c in cands]}}, {"_id": 0, "session_id": 1})}
    return [{"session_id": c["_id"], "user_id": c["user_id"]} for c in cands if c["_id"] not in done][:limit]


async def _asl_tick(tenant: Optional[str] = None, idle_min: int = _ASL_SESSION_IDLE_MIN) -> Dict[str, int]:
    pend = await _asl_find_pending(tenant, idle_min)
    tot = {"sessions": 0, "insights": 0, "added": 0, "merged": 0}
    for p in pend:
        r = await _asl_process_session(p["session_id"], p["user_id"])
        tot["sessions"] += 1
        for k in ("insights", "added", "merged"):
            tot[k] += int(r.get(k) or 0)
    if tot["sessions"]:
        logger.info("[axon-learn] tick: %s", tot)
    return tot


async def _asl_scheduled():
    try:
        await _asl_tick()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axon-learn] tick failed: %s", exc)


@app.on_event("startup")
async def _asl_start():
    try:
        await db.axon_knowledge_base.create_index([("tenant_id", 1), ("category", 1), ("frequency", -1)])
        await db.axon_kb_processed_sessions.create_index("session_id", unique=True)
        _axn_scheduler.add_job(_asl_scheduled, "interval", minutes=10, id="axon-self-learning", replace_existing=True)
        logger.info("[axon-learn] self-learning job armed (every 10 min)")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axon-learn] start failed: %s", exc)


# --- c) Contesto nelle conversazioni --------------------------------------------------------------
async def _asl_context_section(tid: str, msg: str, limit: int = 5) -> str:  # V50.z421 — 8 → 5
    mt = _asl_tokens(msg)
    own = await db.axon_knowledge_base.find({"tenant_id": tid, "enabled": True}, {"_id": 0}).sort("frequency", -1).limit(300).to_list(300)
    glob = await db.axon_knowledge_base.find({"tenant_id": {"$ne": tid}, "enabled": True, "frequency": {"$gte": _ASL_GLOBAL_MIN_FREQ}}, {"_id": 0}) \
        .sort("frequency", -1).limit(150).to_list(150)
    if not own and not glob:
        return ""

    def score(d: dict, bonus: float) -> float:
        t = _asl_tokens(d["insight"] + " " + d["category"])
        rel = len(t & mt) / (len(mt) or 1) if mt else 0
        return rel * 10 + min(d.get("frequency", 1), 10) * 0.3 + (1.0 if d.get("kind") == "gap" else 0) + bonus

    ranked = sorted([(score(d, 1.0), d) for d in own] + [(score(d, 0.0), d) for d in glob], key=lambda x: -x[0])
    chosen = [d for s, d in ranked if s > 0.5][:limit] or [d for s, d in ranked[:4]]
    lines = [f"- [{d['category']} · {d['kind']} · ×{d.get('frequency', 1)}] {str(d['insight'])[:160]}" for d in chosen]
    return ("\n\n=== APPRENDIMENTO AXONOS (insight anonimizzati da conversazioni precedenti; usali per anticipare bisogni, "
            "colmare lacune note e rispondere in modo più pertinente; NON citarli come fonte) ===\n" + "\n".join(lines))


_asl_orig_omni_section = _build_crm_omniscience_section


async def _build_crm_omniscience_section(user: dict, msg: str) -> str:  # noqa: F811
    base = await _asl_orig_omni_section(user, msg)
    try:
        extra = await _asl_context_section(tenant_id(user), msg or "")
    except Exception as exc:  # noqa: BLE001
        logger.debug("[axon-learn] context failed: %s", exc)
        extra = ""
    return f"{base}{extra}"


# --- Dashboard Master ------------------------------------------------------------------------------
class AslUpdateIn(BaseModel):
    insight: Optional[str] = None
    category: Optional[str] = None
    kind: Optional[str] = None
    enabled: Optional[bool] = None
    reviewed: Optional[bool] = None


def _asl_out(d: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items() if k != "_id"}


@api_router.get("/axon/kb-insights")
async def asl_list(category: Optional[str] = None, kind: Optional[str] = None, q: Optional[str] = None,
                   only_disabled: bool = False, limit: int = 200, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    f: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if category:
        f["category"] = category
    if kind:
        f["kind"] = kind
    if only_disabled:
        f["enabled"] = False
    if q:
        f["insight"] = {"$regex": re.escape(q.strip()), "$options": "i"}
    items = await db.axon_knowledge_base.find(f, {"_id": 0}).sort([("frequency", -1), ("updated_at", -1)]).limit(min(limit, 500)).to_list(500)
    return {"items": [_asl_out(d) for d in items], "categories": _ASL_CATEGORIES}


@api_router.get("/axon/kb-insights/stats")
async def asl_stats(user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    tid = tenant_id(user)
    total = await db.axon_knowledge_base.count_documents({"tenant_id": tid})
    disabled = await db.axon_knowledge_base.count_documents({"tenant_id": tid, "enabled": False})
    by_cat = await db.axon_knowledge_base.aggregate([{"$match": {"tenant_id": tid}}, {"$group": {"_id": "$category", "n": {"$sum": 1}, "freq": {"$sum": "$frequency"}}},
                                                     {"$sort": {"n": -1}}]).to_list(50)
    by_kind = await db.axon_knowledge_base.aggregate([{"$match": {"tenant_id": tid}}, {"$group": {"_id": "$kind", "n": {"$sum": 1}}}]).to_list(10)
    sessions = await db.axon_kb_processed_sessions.count_documents({"tenant_id": tid})
    last = await db.axon_kb_processed_sessions.find({"tenant_id": tid}, {"_id": 0, "processed_at": 1}).sort("processed_at", -1).limit(1).to_list(1)
    pending = len(await _asl_find_pending(tid, limit=500))
    return {"total": total, "disabled": disabled, "sessions_analyzed": sessions, "sessions_pending": pending,
            "last_run_at": last[0]["processed_at"].isoformat() if last and isinstance(last[0].get("processed_at"), datetime) else None,
            "by_category": [{"category": b["_id"], "count": b["n"], "frequency": b["freq"]} for b in by_cat],
            "by_kind": {b["_id"]: b["n"] for b in by_kind}, "global_shared": await db.axon_knowledge_base.count_documents({"enabled": True, "frequency": {"$gte": _ASL_GLOBAL_MIN_FREQ}})}


@api_router.post("/axon/kb-insights/run")
async def asl_run(idle_min: int = 0, user=Depends(get_current_user)):
    """Analizza subito le sessioni concluse del tenant (idle_min=0 → anche quelle appena chiuse)."""
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    return await _asl_tick(tenant_id(user), idle_min=max(0, idle_min))


@api_router.put("/axon/kb-insights/{insight_id}")
async def asl_update(insight_id: str, body: AslUpdateIn, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.insight is not None:
        txt = _asl_scrub_caps(_asl_anonymize(body.insight.strip()))[:220]
        if len(txt) < 8:
            raise HTTPException(status_code=400, detail="Testo troppo corto")
        upd["insight"] = txt
    if body.category is not None:
        upd["category"] = _asl_norm_cat(body.category)
    if body.kind in ("faq", "topic", "gap"):
        upd["kind"] = body.kind
    if body.enabled is not None:
        upd["enabled"] = bool(body.enabled)
    if body.reviewed is not None:
        upd["reviewed"] = bool(body.reviewed)
    r = await db.axon_knowledge_base.find_one_and_update({"id": insight_id, "tenant_id": tenant_id(user)}, {"$set": upd}, return_document=ReturnDocument.AFTER)
    if not r:
        raise HTTPException(status_code=404, detail="Insight non trovato")
    return _asl_out(r)


@api_router.delete("/axon/kb-insights/{insight_id}")
async def asl_delete(insight_id: str, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    r = await db.axon_knowledge_base.delete_one({"id": insight_id, "tenant_id": tenant_id(user)})
    return {"ok": True, "deleted": r.deleted_count}


@api_router.delete("/axon/kb-insights")
async def asl_delete_all(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")
    r = await db.axon_knowledge_base.delete_many({"tenant_id": tenant_id(user)})
    return {"ok": True, "deleted": r.deleted_count}
