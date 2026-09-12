# axon_imported_data.py — V50.z194 — Persistenza strutturata dei dati importati da PDF/Excel/CSV (modulo ISOLATO)
#
# Caricato nel namespace condiviso DOPO `axon_push_bridge.py` (avvolge `_maybe_push_command` già avvolto da apb),
# dopo 19/21 (avvolge `_build_attachments_section_advanced` e `_prepare_assistant_prompt`) e PRIMA di 37.
# Nessuna riscrittura del codice esistente: wrapper per nome + nuove collection/endpoint.
#
# Flusso:
#   1) L'utente carica in chat un PDF/Excel/CSV con valori numerici (PUN, tariffe, futures…).
#      `_build_attachments_section_advanced` (wrapper) rileva la struttura → crea `axon_import_pending` {status extracting}
#      + task in background (Claude Haiku) che estrae righe {etichetta, valore, unita, data} + categoria/fonte,
#      e aggiunge al prompt l'istruzione di chiudere la risposta con «Vuoi che memorizzi questi dati per uso futuro?».
#   2) L'utente risponde «sì» (testo o pulsante rapido) → `_maybe_push_command` (wrapper) intercetta SENZA LLM:
#      righe salvate in `axon_imported_data` (condivise con tutto il TEAM: chiave tenant_id) con upsert su
#      (tenant, categoria, etichetta, data). «no» → scartate. Comando «quali dati hai memorizzato?» → riepilogo.
#   3) `_prepare_assistant_prompt` (wrapper) inietta in OGNI conversazione successiva la sezione
#      «📦 DATI IMPORTATI MEMORIZZATI» (≤ 6000 caratteri) → nessun bisogno di ricaricare il file.
#   4) API per Profilo → Memoria AxonOS → «Dati importati»: GET/POST/PUT/DELETE /axon/imported-data[…].
#
# Collection: axon_imported_data { item_id, tenant_id, user_id, categoria, fonte, etichetta, valore, unita, data,
#                                  note, created_at, updated_at }
#             axon_import_pending { pending_id, tenant_id, user_id, session_hint, fonte, files[], status
#                                   extracting|ready|empty|saved|declined|failed, categoria, descrizione, rows[], created_at }

import contextvars as _aid_cv

_AID_USER: "_aid_cv.ContextVar[Optional[dict]]" = _aid_cv.ContextVar("aid_user", default=None)
_AID_TASKS: Dict[str, "asyncio.Task"] = {}
_AID_MODEL = ("anthropic", "claude-haiku-4-5-20251001")
_AID_PENDING_TTL = timedelta(minutes=45)
_AID_MAX_ROWS = 150
_AID_DATA_EXT = (".pdf", ".xlsx", ".xls", ".csv", ".txt", ".json")
_AID_NUM_RE = re.compile(r"(?<![A-Za-z])[-+]?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:€|eur|%|€/kwh|€/mwh|c€/kwh|kwh|mwh|smc|€/smc)?", re.IGNORECASE)
_AID_QUESTION = "Vuoi che memorizzi questi dati per uso futuro?"
_AID_LLM_INSTRUCTION = (
    "\n\n📦 ISTRUZIONE MEMORIZZAZIONE DATI (AxonOS): l'allegato contiene DATI STRUTTURATI (tabelle / valori numerici). "
    "Dopo aver risposto alla richiesta dell'utente, chiudi SEMPRE la risposta con una riga separata contenente ESATTAMENTE la domanda: "
    f"«{_AID_QUESTION}» (l'utente può rispondere sì o no; se dice sì i dati restano disponibili nelle prossime conversazioni senza ricaricare il file)."
)

_OMNI_EXTRA_SECTIONS.append((
    "Dati importati (Memoria AxonOS)", "/axon-memory",
    "Quando l'utente carica PDF/Excel/CSV con valori (PUN, tariffe, futures, listini) Axon chiede «Vuoi che memorizzi questi dati per uso futuro?»: "
    "se sì li salva in una tabella condivisa con il team (categoria, fonte, valore, data, unità) e li usa nelle conversazioni successive senza ricaricare il file. "
    "L'utente li vede/modifica/cancella in Profilo → Memoria AxonOS → Dati importati; in chat: «quali dati hai memorizzato?».",
))


class AidItemIn(BaseModel):
    categoria: str
    etichetta: str
    valore: float
    unita: Optional[str] = None
    data: Optional[str] = None
    fonte: Optional[str] = None
    note: Optional[str] = None


class AidItemPatch(BaseModel):
    categoria: Optional[str] = None
    etichetta: Optional[str] = None
    valore: Optional[float] = None
    unita: Optional[str] = None
    data: Optional[str] = None
    fonte: Optional[str] = None
    note: Optional[str] = None


def _aid_out(d: dict) -> dict:
    d = dict(d); d.pop("_id", None)
    for k in ("created_at", "updated_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    return d


def _aid_is_data_file(att) -> bool:
    name = (getattr(att, "name", "") or "").lower()
    mime = (getattr(att, "mime", "") or "").lower()
    return name.endswith(_AID_DATA_EXT) or "pdf" in mime or "spreadsheet" in mime or "excel" in mime or mime in ("text/csv", "text/plain")


def _aid_looks_structured(section: str) -> bool:
    """Almeno 8 valori numerici (con decimali/unità) nel testo estratto → probabile tabella dati."""
    if not section:
        return False
    hits = [m for m in _AID_NUM_RE.findall(section[:20000]) if re.search(r"[.,]\d|€|%|kwh|mwh|smc", m, re.IGNORECASE)]
    return len(hits) >= 8


def _aid_fmt_val(v) -> str:
    try:
        f = float(v)
        return f"{f:.4f}".rstrip("0").rstrip(".") if abs(f) < 1000 else f"{f:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return str(v)


# ============================================================================ 1) RILEVAMENTO + ESTRAZIONE
async def _aid_extract(pending_id: str, user: dict, section: str, files: List[str]) -> None:
    """Background: Claude Haiku estrae le righe strutturate dal testo degli allegati."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    status, upd = "failed", {}
    try:
        if not key:
            raise RuntimeError("EMERGENT_LLM_KEY mancante")
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        sysm = (
            "Sei il modulo di estrazione dati strutturati di AxonOS (CRM per consulenti energia in Italia). Ricevi il testo estratto da uno o più file "
            "(PDF/Excel/CSV): PUN, prezzi GME, futures, tariffe, listini, indici, consumi. Estrai le righe numeriche utili da memorizzare per usi futuri. "
            "Rispondi SOLO JSON (nessun testo attorno) con questo schema: "
            "{\"strutturato\": true|false, \"categoria\": \"PUN|Tariffe|Futures|Listino|Indici|Consumi|Altro (una parola/breve)\", "
            "\"fonte\": \"ente o documento (es. GME, ARERA, nome file)\", \"descrizione\": \"1 frase ≤ 120 caratteri\", "
            "\"righe\": [{\"etichetta\": \"cosa misura (es. PUN medio F1)\", \"valore\": numero (usa il punto decimale), \"unita\": \"€/MWh|€/kWh|%|€|kWh|…\", "
            "\"data\": \"YYYY-MM-DD | YYYY-MM | YYYY | vuoto\"}]}. "
            f"Massimo {_AID_MAX_ROWS} righe, privilegia serie temporali e valori chiave; niente duplicati; se non ci sono valori strutturati: strutturato=false, righe=[]."
        )
        chat = LlmChat(api_key=key, session_id=f"aid-{pending_id}", system_message=sysm).with_model(*_AID_MODEL)
        resp = await chat.send_message(UserMessage(text=f"File: {', '.join(files)}\n\n{section[:14000]}"))
        data = _parse_llm_json((resp or "").strip(), fallback_key="raw")
        rows: List[dict] = []
        for r in (data.get("righe") or [])[:_AID_MAX_ROWS]:
            try:
                val = float(str(r.get("valore")).replace(",", "."))
            except Exception:
                continue
            et = str(r.get("etichetta") or "").strip()[:120]
            if not et:
                continue
            rows.append({"etichetta": et, "valore": val, "unita": str(r.get("unita") or "").strip()[:20] or None,
                         "data": str(r.get("data") or "").strip()[:10] or None})
        status = "ready" if rows and data.get("strutturato", True) else "empty"
        upd = {"categoria": str(data.get("categoria") or "Altro").strip()[:40] or "Altro", "fonte": str(data.get("fonte") or files[0]).strip()[:120],
               "descrizione": str(data.get("descrizione") or "").strip()[:200], "rows": rows}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[aid] extraction failed %s: %s", pending_id, exc)
        upd = {"error": str(exc)[:200]}
    await db.axon_import_pending.update_one({"pending_id": pending_id}, {"$set": {"status": status, "extracted_at": utcnow(), **upd}})
    _AID_TASKS.pop(pending_id, None)
    logger.info("[aid] pending %s → %s (%d righe)", pending_id, status, len(upd.get("rows") or []))


_aid_orig_build_attachments = _build_attachments_section_advanced


async def _build_attachments_section_advanced(msg: str, attachments: List) -> str:  # noqa: F811
    section = await _aid_orig_build_attachments(msg, attachments)
    user = _AID_USER.get()
    if not user or not attachments or not section:
        return section
    files = [a.name for a in attachments if _aid_is_data_file(a)][:5]
    if not files or not _aid_looks_structured(section):
        return section
    try:
        pid = f"aip_{uuid.uuid4().hex[:10]}"
        await db.axon_import_pending.insert_one({"pending_id": pid, "tenant_id": tenant_id(user), "user_id": user["user_id"], "files": files,
                                                 "fonte": files[0], "status": "extracting", "rows": [], "created_at": utcnow()})
        _AID_TASKS[pid] = asyncio.create_task(_aid_extract(pid, user, section, files))
        return section + _AID_LLM_INSTRUCTION
    except Exception as exc:  # noqa: BLE001
        logger.warning("[aid] pending create failed: %s", exc)
        return section


# ============================================================================ 3) CONTESTO NELLE CONVERSAZIONI
async def _aid_context_section(tid: str, limit_chars: int = 6000) -> str:
    cur = db.axon_imported_data.find({"tenant_id": tid}, {"_id": 0}).sort([("categoria", 1), ("data", -1), ("updated_at", -1)]).limit(400)
    groups: Dict[str, List[dict]] = {}
    async for it in cur:
        groups.setdefault(it.get("categoria") or "Altro", []).append(it)
    if not groups:
        return ""
    lines = ["📦 DATI IMPORTATI MEMORIZZATI DAL TEAM (da file caricati e confermati dall'utente: usali come dati già noti, "
             "SENZA chiedere di ricaricare il file; cita categoria e fonte quando li usi):"]
    for cat, items in groups.items():
        fonti = sorted({(i.get("fonte") or "") for i in items if i.get("fonte")})
        last = max((i.get("updated_at") or i.get("created_at") for i in items), default=None)
        head = f"• {cat} — fonte: {', '.join(fonti)[:120] or 'n/d'}" + (f" (aggiornato {_fmt_dt_it(_axn_aware(last))[:10]})" if last else "") + ":"
        vals = "; ".join(f"{(i.get('data') + ' ') if i.get('data') else ''}{i.get('etichetta')} = {_aid_fmt_val(i.get('valore'))}{(' ' + i['unita']) if i.get('unita') else ''}" for i in items[:80])
        lines.append(f"{head} {vals}")
    text = "\n".join(lines)
    return text[:limit_chars] + ("\n[…elenco troncato: chiedi una categoria specifica per il dettaglio]" if len(text) > limit_chars else "")


_aid_orig_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    tok = _AID_USER.set(user)
    try:
        prep = await _aid_orig_prepare_prompt(user, body)
    finally:
        _AID_USER.reset(tok)
    try:
        sec = await _aid_context_section(tenant_id(user))
        if sec and prep.get("system_message"):
            prep["system_message"] = f"{prep['system_message']}\n\n{sec}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[aid] context inject failed: %s", exc)
    return prep


# ============================================================================ 2) CONFERMA IN CHAT (senza LLM)
_AID_YES_RE = re.compile(r"^\s*(?:axon[,:\s]*|neo[,:\s]*)?(s[iì]+\b|ok\b|okay\b|certo\b|va bene\b|memorizza\w*\b|salva\w*\b|confermo\b|d'accordo\b|perfetto\b|assolutamente\b|procedi\b|ricorda\w*\b)", re.IGNORECASE)
_AID_NO_RE = re.compile(r"^\s*(?:axon[,:\s]*|neo[,:\s]*)?(no\b|non\s+(?:memorizz|salv|serv|ora)|niente\b|lascia\s+stare|scarta\w*\b|meglio\s+di\s+no|per\s+ora\s+no)", re.IGNORECASE)
_AID_LIST_RE = re.compile(r"(quali|che|cosa|quanti)\b.{0,30}\b(dati|valori)\b.{0,30}\b(memorizzat\w*|salvat\w*|importat\w*)|\bdati\s+importati\b|\bmemoria\s+dati\b", re.IGNORECASE)


async def _aid_latest_pending(uid: str) -> Optional[dict]:
    return await db.axon_import_pending.find_one(
        {"user_id": uid, "status": {"$in": ["extracting", "ready", "empty", "failed"]}, "created_at": {"$gte": utcnow() - _AID_PENDING_TTL}},
        {"_id": 0}, sort=[("created_at", -1)])


async def _aid_save_rows(user: dict, pend: dict) -> int:
    tid = tenant_id(user); now = utcnow(); n = 0
    for r in pend.get("rows") or []:
        key = {"tenant_id": tid, "categoria": pend.get("categoria") or "Altro", "etichetta": r["etichetta"], "data": r.get("data")}
        res = await db.axon_imported_data.update_one(key, {
            "$set": {"valore": r["valore"], "unita": r.get("unita"), "fonte": pend.get("fonte"), "updated_at": now, "user_id": user["user_id"], "pending_id": pend["pending_id"]},
            "$setOnInsert": {"item_id": f"aid_{uuid.uuid4().hex[:10]}", "created_at": now, "note": pend.get("descrizione")}}, upsert=True)
        n += 1 if (res.upserted_id is not None or res.modified_count) else 0
    return n


async def _aid_maybe_import_command(msg: str, user: dict) -> Optional[dict]:
    txt = (msg or "").strip()
    if not txt or len(txt) > 160:
        return None
    if _AID_LIST_RE.search(txt):
        tid = tenant_id(user)
        cats = await db.axon_imported_data.aggregate([{"$match": {"tenant_id": tid}}, {"$group": {"_id": "$categoria", "n": {"$sum": 1}, "fonti": {"$addToSet": "$fonte"}, "last": {"$max": "$updated_at"}}}, {"$sort": {"_id": 1}}]).to_list(50)
        if not cats:
            return {"reply": "📦 Non ho ancora dati importati memorizzati. Carica un PDF o un Excel con valori (PUN, tariffe, futures…) e, quando te lo chiedo, rispondi «sì» per memorizzarli.", "cmd": "import_list"}
        lines = [f"• **{c['_id']}** — {c['n']} valor{'e' if c['n'] == 1 else 'i'} · fonte: {', '.join([f for f in c['fonti'] if f][:3]) or 'n/d'}" for c in cats]
        return {"reply": "📦 **Dati importati memorizzati (condivisi con il team):**\n" + "\n".join(lines) + "\n\nLi vedi e li modifichi in *Profilo → Memoria AxonOS → Dati importati*. Chiedimi pure, ad esempio, «qual è il PUN di agosto memorizzato?».", "cmd": "import_list"}
    pend = await _aid_latest_pending(user["user_id"])
    if not pend:
        return None
    explicit = re.search(r"memorizz|salva|scarta|non\s+salv", txt, re.IGNORECASE)
    if not explicit:
        # «sì»/«ok»/«no» generici: valgono solo se l'ULTIMA risposta di Axon conteneva la domanda di memorizzazione
        last = await db.assistant_messages.find_one({"user_id": user["user_id"], "role": "assistant"}, {"_id": 0, "content": 1}, sort=[("created_at", -1)])
        if not last or "memorizzi questi dati" not in (last.get("content") or ""):
            return None
    if _AID_NO_RE.match(txt):
        await db.axon_import_pending.update_one({"pending_id": pend["pending_id"]}, {"$set": {"status": "declined", "decided_at": utcnow()}})
        return {"reply": "👍 Va bene, non memorizzo questi dati: restano disponibili solo in questa conversazione. Se cambi idea, ricarica il file e rispondi «sì».", "cmd": "import_declined"}
    if not _AID_YES_RE.match(txt):
        return None
    if pend["status"] == "extracting":
        task = _AID_TASKS.get(pend["pending_id"])
        if task:
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=25)
            except Exception:  # noqa: BLE001
                pass
        pend = await db.axon_import_pending.find_one({"pending_id": pend["pending_id"]}, {"_id": 0}) or pend
    if pend["status"] in ("empty", "failed") or not pend.get("rows"):
        await db.axon_import_pending.update_one({"pending_id": pend["pending_id"]}, {"$set": {"status": "declined", "decided_at": utcnow()}})
        return {"reply": f"📦 Ho riletto «{pend.get('fonte') or 'il file'}» ma non ho trovato valori strutturati (numeri con data/unità) da memorizzare. Se vuoi, indicami la tabella o i valori da salvare e li aggiungo a mano.", "cmd": "import_empty"}
    if pend["status"] == "extracting":
        return {"reply": "⏳ Sto ancora estraendo i valori dal file: riprova tra qualche secondo rispondendo di nuovo «sì».", "cmd": "import_wait"}
    n = await _aid_save_rows(user, pend)
    await db.axon_import_pending.update_one({"pending_id": pend["pending_id"]}, {"$set": {"status": "saved", "decided_at": utcnow(), "saved": n}})
    rows = pend["rows"]
    preview = "\n".join(f"• {(r.get('data') + ' · ') if r.get('data') else ''}{r['etichetta']}: **{_aid_fmt_val(r['valore'])}{(' ' + r['unita']) if r.get('unita') else ''}**" for r in rows[:5])
    more = f"\n• … e altri {len(rows) - 5}" if len(rows) > 5 else ""
    return {"reply": (f"📦 Memorizzati **{len(rows)}** dati · categoria **{pend.get('categoria')}** · fonte {pend.get('fonte')}.\n{preview}{more}\n\n"
                      "Da ora li conosco in ogni conversazione, senza ricaricare il file (condivisi con il tuo team). "
                      "Li trovi in *Profilo → Memoria AxonOS → Dati importati*, dove puoi correggerli o cancellarli."),
            "cmd": "import_saved", "imported": {"categoria": pend.get("categoria"), "count": len(rows)}}


_aid_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    try:
        r = await _aid_maybe_import_command(msg, user)
        if r:
            return r
    except Exception as exc:  # noqa: BLE001
        logger.warning("[aid] import command failed: %s", exc)
    return await _aid_prev_maybe_push_command(msg, user)


# ============================================================================ 4) API (Memoria AxonOS → Dati importati)
def _aid_can_edit(user: dict, it: dict) -> bool:
    return is_admin_or_owner(user) or it.get("user_id") == user["user_id"]


@api_router.get("/axon/imported-data")
async def aid_list(categoria: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if categoria:
        q["categoria"] = categoria
    items = [_aid_out(d) async for d in db.axon_imported_data.find(q, {"_id": 0}).sort([("categoria", 1), ("data", -1), ("etichetta", 1)]).limit(2000)]
    cats: Dict[str, dict] = {}
    for it in items:
        c = cats.setdefault(it["categoria"], {"categoria": it["categoria"], "count": 0, "fonti": set(), "last": None})
        c["count"] += 1
        if it.get("fonte"):
            c["fonti"].add(it["fonte"])
        c["last"] = max(c["last"] or "", it.get("updated_at") or "")
    pend = await _aid_latest_pending(user["user_id"])
    return {"items": items, "categories": [{**c, "fonti": sorted(c["fonti"])} for c in cats.values()], "total": len(items),
            "can_edit_all": is_admin_or_owner(user), "pending": _aid_out(pend) if pend and pend["status"] in ("extracting", "ready") else None}


@api_router.post("/axon/imported-data")
async def aid_add(body: AidItemIn, user=Depends(get_current_user)):
    now = utcnow()
    doc = {"item_id": f"aid_{uuid.uuid4().hex[:10]}", "tenant_id": tenant_id(user), "user_id": user["user_id"], "categoria": body.categoria.strip()[:40] or "Altro",
           "etichetta": body.etichetta.strip()[:120], "valore": float(body.valore), "unita": (body.unita or "").strip()[:20] or None,
           "data": (body.data or "").strip()[:10] or None, "fonte": (body.fonte or "").strip()[:120] or "inserito a mano", "note": (body.note or "").strip()[:200] or None,
           "created_at": now, "updated_at": now}
    await db.axon_imported_data.insert_one(dict(doc))
    return {"ok": True, "item": _aid_out(doc)}


@api_router.put("/axon/imported-data/{item_id}")
async def aid_update(item_id: str, body: AidItemPatch, user=Depends(get_current_user)):
    it = await db.axon_imported_data.find_one({"item_id": item_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Dato non trovato")
    if not _aid_can_edit(user, it):
        raise HTTPException(status_code=403, detail="Solo chi ha importato il dato o il Master può modificarlo")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    for k in ("categoria", "etichetta", "unita", "data", "fonte", "note"):
        v = getattr(body, k)
        if v is not None:
            upd[k] = v.strip()[:120] or None
    if body.valore is not None:
        upd["valore"] = float(body.valore)
    await db.axon_imported_data.update_one({"item_id": item_id}, {"$set": upd})
    return {"ok": True, "item": _aid_out({**it, **upd})}


@api_router.delete("/axon/imported-data/{item_id}")
async def aid_delete(item_id: str, user=Depends(get_current_user)):
    it = await db.axon_imported_data.find_one({"item_id": item_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Dato non trovato")
    if not _aid_can_edit(user, it):
        raise HTTPException(status_code=403, detail="Solo chi ha importato il dato o il Master può cancellarlo")
    await db.axon_imported_data.delete_one({"item_id": item_id})
    return {"ok": True}


@api_router.delete("/axon/imported-data")
async def aid_delete_bulk(categoria: Optional[str] = None, user=Depends(get_current_user)):
    """Cancella un'intera categoria (o tutto, senza `categoria`). Collaboratore: solo i dati importati da lui."""
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if categoria:
        q["categoria"] = categoria
    if not is_admin_or_owner(user):
        q["user_id"] = user["user_id"]
    r = await db.axon_imported_data.delete_many(q)
    return {"ok": True, "deleted": r.deleted_count}


@api_router.post("/axon/imported-data/pending/{pending_id}/{decision}")
async def aid_pending_decide(pending_id: str, decision: str, user=Depends(get_current_user)):
    """Alternativa REST ai pulsanti rapidi: decision ∈ confirm | decline."""
    pend = await db.axon_import_pending.find_one({"pending_id": pending_id, "user_id": user["user_id"]}, {"_id": 0})
    if not pend:
        raise HTTPException(status_code=404, detail="Import non trovato")
    r = await _aid_maybe_import_command("sì" if decision == "confirm" else "no", user)
    return {"ok": True, "reply": (r or {}).get("reply"), "cmd": (r or {}).get("cmd")}


@app.on_event("startup")
async def _aid_start():
    try:
        await db.axon_imported_data.create_index([("tenant_id", 1), ("categoria", 1), ("etichetta", 1), ("data", 1)])
        await db.axon_imported_data.create_index([("item_id", 1)], unique=True)
        await db.axon_import_pending.create_index([("user_id", 1), ("created_at", -1)])
        logger.info("[aid] imported-data module armed")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[aid] start failed: %s", exc)
