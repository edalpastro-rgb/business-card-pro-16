# axon_shared_learning.py — V50.z447 — APPRENDIMENTO COMPORTAMENTALE CROSS-TENANT
# ----------------------------------------------------------------------------------------------------------------------
# 1) RILEVAMENTO: quando un utente CORREGGE Axon («no, non così», «troppo lungo», «ti ho detto di…», «non inventare»…)
#    il wrapper di _prepare_assistant_prompt salva la correzione (ultimo scambio: domanda → risposta di Axon → correzione)
#    in `axon_behavior_corrections`, GIÀ ANONIMIZZATA (email, telefoni, IBAN, CF, importi, date, nomi propri → segnaposto).
# 2) ESTRAZIONE (job ogni 30 min + endpoint manuale): un LLM legge la correzione anonima ed estrae il PATTERN COMPORTAMENTALE
#    generale («quando l'utente chiede un dato secco, rispondi solo con il dato») — scarta le preferenze personali/tenant-specifiche.
# 3) BASE CONDIVISA `axon_shared_behaviors`: regole deduplicate (Jaccard sui token) con support_count e tenant distinti (solo HASH),
#    stato candidate → active (confidence ≥ 0.8 oppure ≥ 2 tenant distinti) → iniettate nel prompt di TUTTI i tenant
#    nella sezione <COMPORTAMENTI_APPRESI>. I dati personali restano nel tenant; il comportamento diventa patrimonio comune.
# 4) GOVERNANCE (Super Master): GET/PATCH/DELETE /axon/shared-learning, POST /axon/shared-learning/run.
# ----------------------------------------------------------------------------------------------------------------------
import hashlib as _asl_hashlib
import re as _asl_re
import json as _asl_json

_ASL_MAX_ACTIVE_IN_PROMPT = 15
_ASL_PROMPT_MAX_CHARS = 1800
_ASL_AUTO_ACTIVE_CONFIDENCE = 0.8
_ASL_AUTO_ACTIVE_TENANTS = 2
_ASL_JOB_INTERVAL_SEC = 30 * 60
_ASL_CACHE: dict = {"at": None, "section": ""}

_ASL_CORRECTION_RX = _asl_re.compile(
    r"^\s*(no[,.!]|non (così|cosi|è questo|era questo|intendevo|ti ho chiesto|volevo|serve|devi|dovevi|hai capito|ho chiesto)|sbagliat[oa]|errat[oa]|"
    r"ti ho (detto|chiesto)|ti avevo (detto|chiesto)|te l'ho (già )?detto|intendevo|volevo dire|troppo (lung[oa]|cort[oa]|prolisso|generic[oa]|tecnic[oa])|"
    r"più (breve|corto|sintetico|preciso|chiaro)|meno (parole|dettagli|emoji)|rispondi (solo|soltanto|brevemente|in italiano)|solo (il|la|i|le) |"
    r"non (inventare|inventarti|dirmi|mostrarmi|ripetere|usare|aggiungere|chiedere|fare domande)|basta (con|emoji|domande|avvisi)|"
    r"smettila|evita (di|le|gli|i)|niente (emoji|tabelle|elenchi|domande|premesse|avvisi)|hai (sbagliato|invertito|dimenticato|ignorato)|"
    r"(questo|quello) (non è|non era) (quello che|ciò che)|ancora (sbagliato|troppo)|perch[eé] (hai|non hai)|dovevi|avresti dovuto|invece di)",
    _asl_re.I,
)
_ASL_CATEGORIES = ("formato", "lunghezza", "tono", "dati", "ricerca_web", "navigazione", "lingua", "voce", "azioni", "altro")


def _asl_hash_tenant(tenant: str) -> str:
    return _asl_hashlib.sha256(("asl|" + (tenant or "")).encode()).hexdigest()[:16]


def _asl_anonymize(text: str) -> str:
    """Scrub deterministico PRIMA di qualsiasi uso cross-tenant: niente PII nel job LLM né nella base condivisa."""
    t = text or ""
    t = _asl_re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "[EMAIL]", t)
    t = _asl_re.sub(r"https?://\S+", "[URL]", t)
    t = _asl_re.sub(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b", "[IBAN]", t)
    t = _asl_re.sub(r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b", "[CF]", t, flags=_asl_re.I)
    t = _asl_re.sub(r"\bIT\d{3}E\d{8,9}\b|\b\d{14}\b", "[POD]", t)
    t = _asl_re.sub(r"(\+?\d[\d\s./-]{7,}\d)", "[TELEFONO]", t)
    t = _asl_re.sub(r"\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b", "[DATA]", t)
    t = _asl_re.sub(r"\d+(?:[.,]\d+)?\s?(?:€|eur|euro|%|kwh|mwh|smc)\b", "[VALORE]", t, flags=_asl_re.I)
    t = _asl_re.sub(r"\b(?:sig\.?|sig\.ra|dott\.?|ing\.?|avv\.?|signor[ae]?)\s+[A-ZÀ-Ý][\wà-ÿ'-]+(?:\s+[A-ZÀ-Ý][\wà-ÿ'-]+)?", "[NOME]", t)
    t = _asl_re.sub(r"(?<![.!?]\s)(?<!^)\b[A-ZÀ-Ý][a-zà-ÿ'-]{2,}\s+[A-ZÀ-Ý][a-zà-ÿ'-]{2,}\b", "[NOME]", t)  # Nome Cognome dentro la frase
    t = _asl_re.sub(r"\b(?:via|viale|piazza|corso|largo|vicolo)\s+[A-ZÀ-Ýa-zà-ÿ'\s]{3,40}?\s+\d+[a-z]?\b", "[INDIRIZZO]", t, flags=_asl_re.I)
    t = _asl_re.sub(r"\b\d{3,}\b", "[N]", t)
    return t.strip()


# ---------------------------------------------------------------------------------------------------------------------
# 1) RILEVAMENTO CORREZIONI (wrapper del prompt, nessuna latenza: salvataggio in background)
# ---------------------------------------------------------------------------------------------------------------------
async def _asl_record_correction(user: dict, session_id: str, correction_msg: str) -> None:
    try:
        tenant = tenant_id(user)  # noqa: F821
        cur = db.assistant_messages.find({"session_id": session_id, "user_id": user["user_id"]}, {"role": 1, "content": 1}).sort("created_at", -1).limit(4)
        hist = [h async for h in cur]
        hist.reverse()
        last_ai = next((h for h in reversed(hist) if h.get("role") == "assistant"), None)
        if not last_ai:
            return
        idx = hist.index(last_ai)
        prev_user = next((h for h in reversed(hist[:idx]) if h.get("role") == "user"), None)
        doc = {
            "correction_id": f"corr_{uuid.uuid4().hex[:12]}",
            "tenant_id": tenant,                       # proprietà del tenant (per audit locale), MAI usata cross-tenant
            "tenant_hash": _asl_hash_tenant(tenant),   # unica chiave usata nella base condivisa
            "user_question": _asl_anonymize((prev_user or {}).get("content") or "")[:600],
            "axon_reply": _asl_anonymize(last_ai.get("content") or "")[:900],
            "user_correction": _asl_anonymize(correction_msg)[:400],
            "status": "pending",
            "created_at": utcnow(),
        }
        await db.axon_behavior_corrections.insert_one(doc)
        logger.info("[shared-learning] correzione registrata (%s) «%s»", doc["correction_id"], doc["user_correction"][:60])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[shared-learning] record failed: %s", exc)


async def _asl_prompt_section() -> str:
    """Sezione <COMPORTAMENTI_APPRESI> (cache 5 min): regole attive, ordinate per supporto × confidenza."""
    now = utcnow()
    if _ASL_CACHE["at"] and (now - _ASL_CACHE["at"]).total_seconds() < 300:
        return _ASL_CACHE["section"]
    try:
        rows = await db.axon_shared_behaviors.find({"status": "active"}, {"_id": 0, "rule": 1, "category": 1, "support_count": 1, "confidence": 1}).to_list(200)
    except Exception:  # noqa: BLE001
        rows = []
    rows.sort(key=lambda r: -(float(r.get("confidence") or 0) * (1 + (r.get("support_count") or 1))))
    lines, total = [], 0
    for r in rows[:_ASL_MAX_ACTIVE_IN_PROMPT]:
        line = f"- [{r.get('category') or 'altro'}] {(r.get('rule') or '').strip()}"
        if total + len(line) > _ASL_PROMPT_MAX_CHARS:
            break
        lines.append(line); total += len(line)
    section = ""
    if lines:
        section = ("\n\n<COMPORTAMENTI_APPRESI>\nPattern di comportamento appresi dalle correzioni degli utenti di TUTTA la piattaforma (anonimi, senza dati personali). "
                   "Applicali sempre, salvo contrasto con le REGOLE_ASSOLUTE o con le direttive del Master di questo tenant (che prevalgono):\n"
                   + "\n".join(lines) + "\n</COMPORTAMENTI_APPRESI>\n")
    _ASL_CACHE.update({"at": now, "section": section})
    return section


_asl_prev_prepare = _prepare_assistant_prompt  # noqa: F821


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _asl_prev_prepare(user, body)
    try:
        msg = (getattr(body, "message", None) or (body.get("message") if isinstance(body, dict) else "") or "").strip()
        if isinstance(prep, dict) and isinstance(prep.get("system_message"), str):
            section = await _asl_prompt_section()
            if section:
                prep["system_message"] += section
            if msg and len(msg) <= 400 and _ASL_CORRECTION_RX.search(msg) and prep.get("history_len", 0) > 0 and prep.get("session_id"):
                asyncio.create_task(_asl_record_correction(user, prep["session_id"], msg))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[shared-learning] prompt hook failed: %s", exc)
    return prep


# Percorso NON-stream (/assistant/chat non passa da _prepare_assistant_prompt): stesso rilevamento, poi delega all'endpoint originale
_asl_orig_chat = None
for _r in list(api_router.routes):
    if getattr(_r, "path", "").endswith("/assistant/chat") and "POST" in (getattr(_r, "methods", None) or set()):
        _asl_orig_chat = _r.endpoint
        api_router.routes.remove(_r)
        break

if _asl_orig_chat is not None:
    @api_router.post("/assistant/chat")
    async def assistant_chat(body: AssistantChatIn, user=Depends(get_current_user)):  # noqa: F811
        try:
            msg = (body.message or "").strip()
            if msg and len(msg) <= 400 and body.session_id and _ASL_CORRECTION_RX.search(msg):
                asyncio.create_task(_asl_record_correction(user, body.session_id, msg))
        except Exception:  # noqa: BLE001
            pass
        return await _asl_orig_chat(body, user)


# ---------------------------------------------------------------------------------------------------------------------
# 2) ESTRAZIONE DEL PATTERN (LLM) + 3) DEDUP NELLA BASE CONDIVISA
# ---------------------------------------------------------------------------------------------------------------------
_ASL_EXTRACT_SYSTEM = (
    "Sei l'analista comportamentale di Axon, un assistente AI. Ricevi UNO scambio anonimizzato: domanda utente → risposta di Axon → "
    "CORREZIONE dell'utente. Devi estrarre il PATTERN COMPORTAMENTALE GENERALE che Axon dovrebbe adottare per non ripetere l'errore, "
    "valido per QUALSIASI utente della piattaforma. Rispondi SOLO con JSON valido:\n"
    '{"generalizable": true|false, "rule": "<regola imperativa, 1 frase, max 200 caratteri, in italiano, senza nomi/numeri/dati specifici>", '
    '"category": "formato|lunghezza|tono|dati|ricerca_web|navigazione|lingua|voce|azioni|altro", "confidence": 0.0-1.0, "reason": "<max 120 caratteri>"}\n'
    "generalizable=TRUE per correzioni su COME Axon risponde: formato, lunghezza, tono, premesse/avvisi, emoji, elenchi/tabelle, ordine delle informazioni, "
    "domande di follow-up, lingua, precisione dei dati, uso della ricerca web, invenzioni. Esempi validi: «quando l'utente chiede un dato secco (numero, "
    "indirizzo, importo) rispondi solo con il dato, senza premesse»; «non aggiungere domande di follow-up non richieste»; «se non hai il dato, dillo in una riga».\n"
    "generalizable=FALSE solo se la correzione riguarda un CONTENUTO specifico del tenant o della persona: nomignoli («chiamami [NOME]»), fornitori/listini/"
    "clienti propri, fatti puntuali, oppure se è uno sfogo senza indicazione («sbagliato» e basta) o ambigua. "
    "Mai includere segnaposto come [NOME]/[TELEFONO] nella regola. La regola descrive un COMPORTAMENTO (come rispondere), non un contenuto."
)


async def _asl_extract(corr: dict) -> Optional[dict]:
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        key = os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            return None
        chat = LlmChat(api_key=key, session_id=f"asl_{uuid.uuid4().hex[:8]}", system_message=_ASL_EXTRACT_SYSTEM).with_model("anthropic", "claude-haiku-4-5")
        txt = (f"DOMANDA UTENTE: {corr.get('user_question') or '(n/d)'}\n\nRISPOSTA DI AXON: {corr.get('axon_reply') or '(n/d)'}\n\n"
               f"CORREZIONE DELL'UTENTE: {corr.get('user_correction')}")
        raw = str(await chat.send_message(UserMessage(text=txt)) or "")
        m = _asl_re.search(r"\{.*\}", raw, _asl_re.S)
        data = _asl_json.loads(m.group(0)) if m else None
        if not isinstance(data, dict):
            return None
        data["rule"] = _asl_anonymize(str(data.get("rule") or ""))[:220].strip()
        data["category"] = data.get("category") if data.get("category") in _ASL_CATEGORIES else "altro"
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence") or 0)))
        if "[" in data["rule"] or len(data["rule"]) < 12:
            data["generalizable"] = False
        return data
    except Exception as exc:  # noqa: BLE001
        logger.warning("[shared-learning] extract failed: %s", exc)
        return None


def _asl_tokens(text: str) -> set:
    stop = {"il", "lo", "la", "i", "gli", "le", "un", "una", "di", "a", "da", "in", "con", "su", "per", "tra", "fra", "e", "o", "non", "che", "se", "del", "della", "dei", "delle", "al", "alla", "ai", "alle", "quando", "sempre", "mai", "solo", "deve", "devi", "axon"}
    return {w for w in _asl_re.findall(r"[a-zà-ÿ]{3,}", (text or "").lower()) if w not in stop}


async def _asl_upsert_behavior(data: dict, corr: dict) -> str:
    rule = data["rule"]; toks = _asl_tokens(rule)
    existing = await db.axon_shared_behaviors.find({"status": {"$ne": "rejected"}}, {"behavior_id": 1, "rule": 1, "tenant_hashes": 1, "support_count": 1, "confidence": 1, "status": 1}).to_list(500)
    best, best_j = None, 0.0
    for b in existing:
        bt = _asl_tokens(b.get("rule") or "")
        j = len(toks & bt) / max(1, len(toks | bt))
        if j > best_j:
            best, best_j = b, j
    now = utcnow()
    if best and best_j >= 0.55:
        hashes = set(best.get("tenant_hashes") or []) | {corr["tenant_hash"]}
        support = int(best.get("support_count") or 1) + 1
        conf = round(min(1.0, max(float(best.get("confidence") or 0), data["confidence"]) + 0.05), 2)
        status = best.get("status")
        if status == "candidate" and (conf >= _ASL_AUTO_ACTIVE_CONFIDENCE or len(hashes) >= _ASL_AUTO_ACTIVE_TENANTS):
            status = "active"
        await db.axon_shared_behaviors.update_one({"behavior_id": best["behavior_id"]}, {"$set": {"tenant_hashes": sorted(hashes), "support_count": support, "confidence": conf, "status": status, "updated_at": now}, "$push": {"correction_ids": {"$each": [corr["correction_id"]], "$slice": -50}}})
        _ASL_CACHE["at"] = None
        return best["behavior_id"]
    bid = f"beh_{uuid.uuid4().hex[:12]}"
    await db.axon_shared_behaviors.insert_one({
        "behavior_id": bid, "rule": rule, "category": data["category"], "confidence": data["confidence"], "reason": (data.get("reason") or "")[:160],
        "support_count": 1, "tenant_hashes": [corr["tenant_hash"]], "correction_ids": [corr["correction_id"]],
        "status": "active" if data["confidence"] >= _ASL_AUTO_ACTIVE_CONFIDENCE else "candidate", "source": "auto", "created_at": now, "updated_at": now,
    })
    _ASL_CACHE["at"] = None
    return bid


async def _asl_process_pending(limit: int = 20) -> dict:
    out = {"processed": 0, "learned": 0, "discarded": 0, "failed": 0}
    rows = await db.axon_behavior_corrections.find({"status": "pending"}, {"_id": 0}).sort("created_at", 1).limit(limit).to_list(limit)
    for corr in rows:
        out["processed"] += 1
        data = await _asl_extract(corr)
        if not data:
            out["failed"] += 1
            await db.axon_behavior_corrections.update_one({"correction_id": corr["correction_id"]}, {"$set": {"status": "failed", "processed_at": utcnow()}})
            continue
        if not data.get("generalizable"):
            out["discarded"] += 1
            await db.axon_behavior_corrections.update_one({"correction_id": corr["correction_id"]}, {"$set": {"status": "tenant_only", "reason": (data.get("reason") or "")[:160], "processed_at": utcnow()}})
            continue
        bid = await _asl_upsert_behavior(data, corr)
        out["learned"] += 1
        await db.axon_behavior_corrections.update_one({"correction_id": corr["correction_id"]}, {"$set": {"status": "learned", "behavior_id": bid, "processed_at": utcnow()}})
    if out["processed"]:
        logger.info("[shared-learning] job: %s", out)
    return out


_ASL_STATE: dict = {"task": None, "started_at": None, "last_run": None, "next_run": None, "runs": 0, "last_result": None}


async def _asl_job_loop():
    _ASL_STATE["next_run"] = utcnow() + timedelta(seconds=120)
    await asyncio.sleep(120)
    while True:
        try:
            _ASL_STATE["last_result"] = await _asl_process_pending()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[shared-learning] job loop error: %s", exc)
            _ASL_STATE["last_result"] = {"error": str(exc)[:200]}
        _ASL_STATE["last_run"] = utcnow(); _ASL_STATE["runs"] += 1
        _ASL_STATE["next_run"] = utcnow() + timedelta(seconds=_ASL_JOB_INTERVAL_SEC)
        await asyncio.sleep(_ASL_JOB_INTERVAL_SEC)


# ---------------------------------------------------------------------------------------------------------------------
# 4) GOVERNANCE — Super Master
# ---------------------------------------------------------------------------------------------------------------------
def _asl_require_super_master(user: dict) -> None:
    if not _axon_is_super_master(user):  # noqa: F821 — axon_persona.py
        raise HTTPException(status_code=403, detail="Solo il Super Master gestisce la base comportamentale condivisa")


class SharedBehaviorPatch(BaseModel):
    status: Optional[Literal["active", "candidate", "rejected"]] = None
    rule: Optional[str] = None
    category: Optional[str] = None


@api_router.get("/axon/shared-learning/status")
async def asl_status(user=Depends(get_current_user)):
    """V50.z450 — verifica operativa: modulo caricato, task dei 30 min vivo, ultimo/prossimo giro."""
    _asl_require_super_master(user)
    t = _ASL_STATE.get("task")
    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return {"module_loaded": True, "job_scheduled": bool(t) and not t.done(), "job_task_done": bool(t) and t.done(),
            "job_error": (str(t.exception())[:200] if (t and t.done() and not t.cancelled() and t.exception()) else None),
            "interval_min": _ASL_JOB_INTERVAL_SEC // 60, "started_at": iso(_ASL_STATE.get("started_at")), "last_run": iso(_ASL_STATE.get("last_run")),
            "next_run": iso(_ASL_STATE.get("next_run")), "runs": _ASL_STATE.get("runs"), "last_result": _ASL_STATE.get("last_result"),
            "pending_corrections": await db.axon_behavior_corrections.count_documents({"status": "pending"}),
            "active_behaviors": await db.axon_shared_behaviors.count_documents({"status": "active"})}


@api_router.get("/axon/shared-learning")
async def asl_list(status: Optional[str] = None, user=Depends(get_current_user)):
    _asl_require_super_master(user)
    q = {"status": status} if status else {}
    rows = await db.axon_shared_behaviors.find(q, {"_id": 0}).sort([("status", 1), ("support_count", -1)]).to_list(500)
    for r in rows:
        r["tenants"] = len(r.pop("tenant_hashes", []) or [])
        r.pop("correction_ids", None)
    stats = {s: await db.axon_shared_behaviors.count_documents({"status": s}) for s in ("active", "candidate", "rejected")}
    corr = {s: await db.axon_behavior_corrections.count_documents({"status": s}) for s in ("pending", "learned", "tenant_only", "failed")}
    return {"behaviors": rows, "stats": stats, "corrections": corr, "prompt_section_chars": len(await _asl_prompt_section())}


@api_router.get("/axon/shared-learning/corrections")
async def asl_corrections(status: Optional[str] = None, limit: int = 50, user=Depends(get_current_user)):
    _asl_require_super_master(user)
    q = {"status": status} if status else {}
    rows = await db.axon_behavior_corrections.find(q, {"_id": 0, "tenant_id": 0}).sort("created_at", -1).limit(min(limit, 200)).to_list(200)
    return {"corrections": rows}  # già anonimizzate; tenant solo come hash


@api_router.post("/axon/shared-learning/run")
async def asl_run(limit: int = 30, user=Depends(get_current_user)):
    _asl_require_super_master(user)
    return await _asl_process_pending(limit=min(limit, 100))


@api_router.post("/axon/shared-learning")
async def asl_create(body: SharedBehaviorPatch, user=Depends(get_current_user)):
    _asl_require_super_master(user)
    if not body.rule or len(body.rule.strip()) < 12:
        raise HTTPException(status_code=400, detail="rule troppo corta")
    now = utcnow(); bid = f"beh_{uuid.uuid4().hex[:12]}"
    await db.axon_shared_behaviors.insert_one({"behavior_id": bid, "rule": _asl_anonymize(body.rule.strip())[:220], "category": body.category if body.category in _ASL_CATEGORIES else "altro",
                                               "confidence": 1.0, "support_count": 1, "tenant_hashes": [], "correction_ids": [], "status": body.status or "active", "source": "super_master", "created_at": now, "updated_at": now})
    _ASL_CACHE["at"] = None
    return {"ok": True, "behavior_id": bid}


@api_router.patch("/axon/shared-learning/{behavior_id}")
async def asl_patch(behavior_id: str, body: SharedBehaviorPatch, user=Depends(get_current_user)):
    _asl_require_super_master(user)
    upd = {"updated_at": utcnow()}
    if body.status:
        upd["status"] = body.status
    if body.rule:
        upd["rule"] = _asl_anonymize(body.rule.strip())[:220]
    if body.category in _ASL_CATEGORIES:
        upd["category"] = body.category
    r = await db.axon_shared_behaviors.update_one({"behavior_id": behavior_id}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="behavior non trovato")
    _ASL_CACHE["at"] = None
    return {"ok": True}


@api_router.delete("/axon/shared-learning/{behavior_id}")
async def asl_delete(behavior_id: str, user=Depends(get_current_user)):
    _asl_require_super_master(user)
    r = await db.axon_shared_behaviors.delete_one({"behavior_id": behavior_id})
    _ASL_CACHE["at"] = None
    return {"ok": bool(r.deleted_count)}


async def _asl_startup():
    try:
        await db.axon_behavior_corrections.create_index([("status", 1), ("created_at", 1)])
        await db.axon_behavior_corrections.create_index("correction_id", unique=True)
        await db.axon_shared_behaviors.create_index("behavior_id", unique=True)
        await db.axon_shared_behaviors.create_index([("status", 1), ("support_count", -1)])
        _ASL_STATE["task"] = asyncio.create_task(_asl_job_loop(), name="axon_shared_learning_job")
        _ASL_STATE["started_at"] = utcnow()
        logger.info("[shared-learning] attivo: job ogni %d min, auto-active conf≥%.2f o ≥%d tenant", _ASL_JOB_INTERVAL_SEC // 60, _ASL_AUTO_ACTIVE_CONFIDENCE, _ASL_AUTO_ACTIVE_TENANTS)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[shared-learning] startup failed: %s", exc)


app.add_event_handler("startup", _asl_startup)
