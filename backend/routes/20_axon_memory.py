# 20_axon_memory.py — AxonOS: memoria riscritta, teach section, indice Drive
# Estratto da server.py (righe originali 12006-13732). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V50.z51 — MEMORIA AXON RISCRITTA (approvato dall'utente)
# ============================================================================
# Obiettivo: risolvere i 2 problemi noti (Axon "dimentica" le regole in una
# nuova chat, non rispetta le istruzioni insegnate). Struttura:
#  1. PINNED rules → sezione <REGOLE_ASSOLUTE> in cima al system prompt.
#  2. Auto-distillation → job notturno (04:00 Europe/Rome) che comprime le
#     chat degli ultimi 90 giorni in un summary per tenant, salvato in
#     `db.axon_tenant_memory` e iniettato come <MEMORIA_PERSISTENTE>.
#  3. Streaming ack → nel `/api/assistant/stream`, evento `progress` immediato
#     con conferma "sto rispettando le regole insegnate…" (<500ms feedback).
# Priorità in caso di conflitto: PINNED rules > RAG > web (default scelto).
# ============================================================================

AXON_MEMORY_LOOKBACK_DAYS = 90
AXON_MEMORY_MAX_MESSAGES = 200
AXON_MEMORY_MIN_MESSAGES = 20
# V50.z144 — PINNED: TUTTE le regole manuali del Master (cap 40) + le auto-generate più
# rilevanti (cap 6); budget testo per regola 500 char, totale ~14k char.
AXON_PINNED_RULES_MAX = 40
AXON_PINNED_AUTO_MAX = 6
AXON_PINNED_RULES_TEXT_CHARS = 500
AXON_PINNED_TOTAL_CHARS = 14000


async def _build_pinned_rules_section(tenant: str, user_msg: str) -> str:
    """Costruisce il blocco `<REGOLE_ASSOLUTE>` da mettere IN CIMA al system prompt.
    V50.z144 — Le regole di "Insegna ad Axon" sono DIRETTIVE VINCOLANTI (non suggerimenti):
    tutte le regole manuali/pinned del Master (`auto_generated=False`, incl. impegni "da ora
    farò X" e regole distillate) + le auto-generate più rilevanti per il messaggio.
    Nota anti-regressione V50.z53: il blocco chiarisce che le direttive definiscono COME
    rispondere e NON sostituiscono la risposta completa alla domanda dell'utente.
    """
    try:
        rules = await db.ai_teach_rules.find({"user_id": tenant}, {"_id": 0, "files": 0}).to_list(300)
    except Exception as exc:
        logger.warning("[axon-pinned] cannot read ai_teach_rules: %s", exc)
        return ""
    if not rules:
        return ""
    msg_lc = (user_msg or "").lower()
    manual = [r for r in rules if not r.get("auto_generated")]
    auto = [r for r in rules if r.get("auto_generated")]
    manual.sort(key=lambda r: -_rule_relevance_score(r, msg_lc))
    auto.sort(key=lambda r: -_rule_relevance_score(r, msg_lc))
    top = manual[:AXON_PINNED_RULES_MAX] + auto[:AXON_PINNED_AUTO_MAX]
    if not top:
        return ""
    lines: List[str] = [
        "<REGOLE_ASSOLUTE>",
        "DIRETTIVE VINCOLANTI insegnate dal Master tramite «Insegna ad Axon» (incluse le promesse",
        "che tu stesso hai fatto: «da ora in avanti farò X»). NON sono suggerimenti: hanno priorità",
        "ASSOLUTA su RAG, web, memoria, allegati e sulle istruzioni generiche che seguono. Applicale",
        "sempre, in ogni risposta, senza deviare. Se una fonte è in contrasto, vince la direttiva.",
        "IMPORTANTE: le direttive definiscono COME rispondere; devi COMUNQUE rispondere in modo",
        "completo e utile alla domanda dell'utente. Non elencare né citare queste direttive se non",
        "richiesto esplicitamente.",
        "",
    ]
    total = 0
    for idx, r in enumerate(top, 1):
        title = (r.get("title") or "").strip() or "(senza titolo)"
        text = (r.get("text") or "").strip()
        cats = r.get("categories") or ([r.get("category")] if r.get("category") else [])
        cats_txt = ", ".join([c for c in cats if c]) or "Generale"
        block = f"[{idx}] {title}  •  {cats_txt}"
        if text:
            block += f"\n    -> {text[:AXON_PINNED_RULES_TEXT_CHARS]}"
        if total + len(block) > AXON_PINNED_TOTAL_CHARS:
            break
        lines.append(block)
        total += len(block)
    lines.append("</REGOLE_ASSOLUTE>")
    return "\n".join(lines) + "\n\n"


async def _load_tenant_memory_section(tenant: str) -> str:
    """Carica il summary distillato del tenant (aggiornato dal job notturno)
    e lo formatta come `<MEMORIA_PERSISTENTE>` da iniettare nel prompt."""
    try:
        doc = await db.axon_tenant_memory.find_one({"tenant_id": tenant}, {"_id": 0})
    except Exception as exc:
        logger.debug("[axon-memory] load failed: %s", exc)
        return ""
    if not doc:
        return ""
    summary = (doc.get("summary") or "").strip()
    facts = doc.get("facts") or []
    if not summary and not facts:
        return ""
    generated = doc.get("updated_at")
    header = "<MEMORIA_PERSISTENTE>"
    if generated:
        try:
            header += f"  (aggiornata: {generated.strftime('%d/%m/%Y')})"
        except Exception:
            pass
    lines: List[str] = [
        header,
        "Sintesi delle interazioni passate del tenant (compressa automaticamente",
        "ogni notte). Usa questi elementi per personalizzare le risposte e mantenere",
        "coerenza tra chat diverse, senza citarli in modo brusco.",
        "",
    ]
    if summary:
        lines.append(summary[:2500])
    if facts:
        lines.append("")
        lines.append("Fatti chiave da ricordare:")
        for f in facts[:15]:
            f_str = str(f).strip()
            if f_str:
                lines.append(f"- {f_str[:220]}")
    lines.append("</MEMORIA_PERSISTENTE>")
    return "\n".join(lines) + "\n\n"


async def _distill_tenant_memory(tenant: str, messages: List[dict]) -> Optional[dict]:
    """Distilla una lista di messaggi in un summary + facts via Claude Haiku 4.5
    (modello economico). Ritorna {summary, facts} oppure None se la LLM fallisce.
    """
    if len(messages) < AXON_MEMORY_MIN_MESSAGES:
        return None
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return None
    # Costruzione dump compatto (ultimi N, 300 char cad)
    dump_lines: List[str] = []
    for m in messages[-AXON_MEMORY_MAX_MESSAGES:]:
        role = m.get("role") or "user"
        content = (m.get("content") or "").strip().replace("\n", " ")[:300]
        if content:
            dump_lines.append(f"[{role}] {content}")
    dump = "\n".join(dump_lines)
    if not dump:
        return None

    system_msg = (
        "Sei un compressore di memoria per un assistente CRM italiano. Ricevi le "
        "ultime chat di un tenant negli ultimi 90 giorni. Devi produrre un JSON "
        "compatto con 2 campi:\n"
        '  "summary": paragrafo di max 2000 caratteri con i temi ricorrenti, '
        "preferenze, stile di lavoro, argomenti frequenti.\n"
        '  "facts":   array di max 15 stringhe, ciascuna con un FATTO PERSISTENTE '
        "(es. 'Preferisce risposte brevi', 'Ha 3 clienti gas su Trebisacce'). "
        "Ogni fatto max 200 char.\n"
        "Regole: rispondi SOLO con JSON puro (no markdown fence), niente prosa, "
        "niente saluti, niente commenti. Se il dump è troppo povero, ritorna "
        '{"summary":"","facts":[]}.'
    )
    user_prompt = f"CHAT DUMP (formato [ruolo] contenuto):\n{dump[:60000]}"

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=key, session_id=f"distill_{tenant}", system_message=system_msg)
        chat = chat.with_model("anthropic", "claude-haiku-4-5")
        resp = await chat.send_message(UserMessage(text=user_prompt))
        raw = (resp or "").strip()
        # Strip fence se presente
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.startswith("json"):
                raw = raw[4:].strip()
        import json as _json_mod
        try:
            parsed = _json_mod.loads(raw)
        except Exception:
            # Fallback: prova a estrarre il primo blocco {...}
            import re as _re
            m = _re.search(r"\{.*\}", raw, _re.DOTALL)
            if not m:
                return None
            parsed = _json_mod.loads(m.group(0))
        if not isinstance(parsed, dict):
            return None
        summary = (parsed.get("summary") or "").strip()[:2500]
        facts_raw = parsed.get("facts") or []
        facts = [str(f).strip()[:220] for f in facts_raw if str(f).strip()][:15]
        if not summary and not facts:
            return None
        return {"summary": summary, "facts": facts}
    except Exception as exc:
        logger.warning("[axon-memory] distillation LLM error tenant=%s: %s", tenant, exc)
        return None


async def _run_axon_memory_distillation_job() -> Dict[str, Any]:
    """Job notturno: per ogni tenant attivo, comprime le chat degli ultimi 90
    giorni in un summary persistente salvato in `db.axon_tenant_memory`.
    Idempotente (upsert per tenant_id)."""
    started = utcnow()
    since = started - timedelta(days=AXON_MEMORY_LOOKBACK_DAYS)
    try:
        tenants_cur = db.assistant_messages.aggregate([
            {"$match": {"created_at": {"$gte": since}}},
            {"$group": {"_id": "$user_id"}},
        ])
        tenants: List[str] = []
        async for row in tenants_cur:
            tid = row.get("_id")
            if tid:
                tenants.append(str(tid))
    except Exception as exc:
        logger.warning("[axon-memory-job] tenant scan failed: %s", exc)
        return {"ok": False, "error": str(exc)}
    processed = 0
    updated = 0
    skipped = 0
    for tid in tenants:
        try:
            msgs_cur = db.assistant_messages.find(
                {"user_id": tid, "created_at": {"$gte": since}},
                {"_id": 0, "role": 1, "content": 1, "created_at": 1},
            ).sort("created_at", 1).limit(AXON_MEMORY_MAX_MESSAGES)
            msgs = [m async for m in msgs_cur]
            processed += 1
            if len(msgs) < AXON_MEMORY_MIN_MESSAGES:
                skipped += 1
                continue
            distilled = await _distill_tenant_memory(tid, msgs)
            if not distilled:
                skipped += 1
                continue
            await db.axon_tenant_memory.update_one(
                {"tenant_id": tid},
                {"$set": {
                    "tenant_id": tid,
                    "summary": distilled["summary"],
                    "facts": distilled["facts"],
                    "message_count": len(msgs),
                    "lookback_days": AXON_MEMORY_LOOKBACK_DAYS,
                    "updated_at": utcnow(),
                }},
                upsert=True,
            )
            updated += 1
        except Exception as exc:
            logger.warning("[axon-memory-job] tenant=%s error: %s", tid, exc)
            skipped += 1
    duration_s = (utcnow() - started).total_seconds()
    logger.info(
        "[axon-memory-job] processed=%d updated=%d skipped=%d duration=%.1fs",
        processed, updated, skipped, duration_s,
    )
    return {"ok": True, "processed": processed, "updated": updated, "skipped": skipped, "duration_s": duration_s}


async def _build_pinned_rules_ack_text(tenant: str, user_msg: str) -> str:
    """Costruisce il testo dello 'streaming ack' iniziale citando 2-3 regole
    PINNED più rilevanti. Usato dal streaming endpoint per dare feedback
    immediato all'utente (<500ms)."""
    try:
        rules = await db.ai_teach_rules.find(
            {"user_id": tenant},
            {"_id": 0, "title": 1, "auto_generated": 1, "category": 1, "categories": 1, "text": 1},
        ).to_list(50)
    except Exception:
        return "Ok, sto elaborando la tua richiesta…"
    if not rules:
        return "Ok, sto elaborando la tua richiesta…"
    msg_lc = (user_msg or "").lower()
    rules.sort(key=lambda r: (
        0 if not r.get("auto_generated") else 1,
        -_rule_relevance_score(r, msg_lc),
    ))
    top_titles = [(r.get("title") or "").strip() for r in rules[:3] if (r.get("title") or "").strip()]
    if not top_titles:
        return "Ok, sto elaborando la tua richiesta rispettando le regole insegnate…"
    citations = ", ".join(f'"{t}"' for t in top_titles)
    return f"Ok, sto elaborando la tua richiesta rispettando le regole insegnate ({citations})…"




import time as _time_mod  # V50.z556
from core.response_rules import GME_KEYS_RX as _GME_KEYS_RX, PUN_LIKE_RX as _PUN_LIKE_RX  # V50.z562 — regole protette in backend/core


async def _build_axon_teach_section(tenant: str, user_msg: str) -> str:
    """Prepara il contesto "Insegna ad Axon" da iniettare nella chat.
    Include: titolo/testo delle regole + testo estratto dai file allegati (PDF/xlsx/csv/txt/immagini).
    Le regole vengono ordinate per rilevanza rispetto al messaggio dell'utente,
    con budget di token conservativo (max ~18000 caratteri totali).

    V49.q — Se il messaggio menziona un mese/anno specifico e negli URL
    monitorati esistono PDF pertinenti (es. GME PrezzoMedioFasce), scarica
    dinamicamente il/i PDF, estrae il testo e lo appende alla sezione."""
    try:
        rules = await db.ai_teach_rules.find({"user_id": tenant}, {"_id": 0}).to_list(200)
    except Exception as exc:
        logger.warning("[axon-teach] cannot read ai_teach_rules: %s", exc)
        rules = []

    # V50.z33 — PARALLELIZE i 4 fetcher pesanti (prima sequenziali):
    #  - PDF dinamici URL insegnati
    #  - PDF Google Drive folder
    #  - HTML generico URL insegnati (snapshot + last_summary)
    #  - GME canonical fallback
    # Ogni fetcher può richiedere 1-3s: in sequenza ~10s, in parallelo ~3s.
    # V50.z155 — Timeout duro per fetcher (12s): un URL lento non deve bloccare
    # la risposta di Axon per minuti ("Sto cercando nei documenti…").
    async def _bounded(coro, label: str):
        _b0 = _time_mod.monotonic()
        try:
            return await asyncio.wait_for(coro, timeout=12)
        except asyncio.TimeoutError:
            logger.warning("[axon-teach] fetcher %s timeout (12s) — skipped", label)
            return ""
        except Exception:
            return ""
        finally:
            _core_stream_mark_phase(f"teach.{label}", _time_mod.monotonic() - _b0)  # noqa: F821 — V50.z564 — scomposizione TTFT per fetcher
    async def _s_pdf():
        return await _bounded(_fetch_teach_url_pdfs_for_query(tenant, user_msg), "url-pdf")
    async def _s_drive():
        return await _bounded(_fetch_teach_drive_pdfs_for_query(tenant, user_msg), "drive-index")
    async def _s_html():
        return await _bounded(_fetch_teach_urls_html_generic(tenant, user_msg), "url-html")
    async def _s_canonical():
        return await _bounded(_fetch_gme_pun_canonical(tenant, user_msg), "gme")
    _tt0 = _time_mod.monotonic()
    dyn_pdf_text, dyn_drive_pdf_text, dyn_html_text, canonical_gme_text = await asyncio.gather(
        _s_pdf(), _s_drive(), _s_html(), _s_canonical(),
    )
    if _time_mod.monotonic() - _tt0 >= 1.0:  # V50.z556 — profilo: quale fetcher ha rallentato il prompt
        logger.info("[axon-teach] fetcher lenti (%.2fs) per «%s»: pdf=%d drive=%d html=%d gme=%d car.", _time_mod.monotonic() - _tt0, (user_msg or "")[:50],
                    len(dyn_pdf_text or ""), len(dyn_drive_pdf_text or ""), len(dyn_html_text or ""), len(canonical_gme_text or ""))

    if not rules and not dyn_pdf_text and not dyn_drive_pdf_text and not dyn_html_text and not canonical_gme_text:
        return ""

    msg_lc = (user_msg or "").lower()
    rules.sort(key=lambda r: _rule_relevance_score(r, msg_lc), reverse=True)

    MAX_TOTAL_CHARS = 18000
    MAX_RULES = 8
    PER_FILE_CHARS = 2500
    PER_RULE_TEXT_CHARS = 1500

    out_parts: List[str] = []
    total = 0
    for r in rules[:MAX_RULES]:
        title = (r.get("title") or "").strip()
        text = (r.get("text") or "").strip()
        cats = r.get("categories") or ([r.get("category")] if r.get("category") else [])
        cats_txt = ", ".join([c for c in cats if c]) or "Generale"
        header = f"### Regola: {title or '(senza titolo)'} — Categorie: {cats_txt}"
        block = header
        if text:
            block += "\n" + text[:PER_RULE_TEXT_CHARS]

        files = r.get("files") or []
        file_blocks: List[str] = []
        for f in files[:5]:
            b64 = f.get("data_base64")
            if not b64:
                continue  # metadata-only entry (shouldn't happen server-side)
            name = f.get("name") or "file"
            mime = f.get("mime") or ""
            try:
                extracted = await _extract_attachment_text(_RuleAttachmentShim(name, mime, b64))
            except Exception as exc:
                extracted = f"[Errore lettura {name}: {exc}]"
            snippet = (extracted or "").strip()
            if snippet:
                file_blocks.append(f"--- File: {name} ({mime or 'unknown'}) ---\n{snippet[:PER_FILE_CHARS]}")
        if file_blocks:
            block += "\n\n" + "\n\n".join(file_blocks)

        # Rispetta il budget complessivo
        if total + len(block) > MAX_TOTAL_CHARS:
            remaining = MAX_TOTAL_CHARS - total
            if remaining > 400:
                out_parts.append(block[:remaining] + "\n... (troncato)")
            break
        out_parts.append(block)
        total += len(block)

    if not out_parts and not dyn_pdf_text and not dyn_drive_pdf_text and not dyn_html_text:
        return ""
    header = (
        "\n\nBASE DI CONOSCENZA (Insegna ad Axon — regole e file caricati dal Master, "
        "USA questi contenuti come contesto prioritario quando l'utente menziona documenti, "
        "PDF, GME, Optima o argomenti descritti qui sotto):\n"
    )
    body = "\n\n".join(out_parts) if out_parts else ""
    dyn_block = ""
    if dyn_pdf_text:
        dyn_block = (
            "\n\n### 📥 PDF SCARICATO DINAMICAMENTE dai link monitorati (RICHIESTA DELL'UTENTE)\n"
            + dyn_pdf_text
            + "\n\nQuesto contenuto è FONTE PRIMARIA. Usa questi valori numerici per rispondere; "
            "non cercare altrove e non dire 'dati non disponibili'."
        )
    drive_block = ""
    if dyn_drive_pdf_text:
        drive_block = (
            "\n\n### 📂 GOOGLE DRIVE — INDICE AUTOMATICO DELLE CARTELLE MONITORATE\n"
            + dyn_drive_pdf_text
            + "\n\nHAI ACCESSO a queste cartelle Drive: l'indice viene aggiornato automaticamente "
            "(ogni 30 min e ad ogni nuova cartella collegata). Se l'utente chiede 'hai accesso al Drive?' "
            "o 'che cartella vedi?' rispondi SÌ ed elenca cartelle e file dall'elenco sopra. Il testo dei "
            "file più pertinenti è già incluso: usalo come FONTE PRIMARIA e cita il nome del file. Se il file "
            "richiesto è nell'elenco ma il suo testo non è incluso, dillo e invita a riformulare con il nome "
            "del file (oppure ad allegarlo con l'icona G blu)."
        )
    html_block = ""
    if dyn_html_text:
        html_block = (
            "\n\n### 🌐 CONTENUTO WEB LIVE dagli URL insegnati (letto ora, in tempo reale)\n"
            + dyn_html_text
            + "\n\nQuesto è testo APPENA scaricato dai siti ufficiali che ti sono stati insegnati. "
            "USA questi dati come fonte primaria per rispondere. Se contengono la risposta, cita il "
            "sito da cui viene."
        )
    canonical_block = ""
    if canonical_gme_text:
        canonical_block = (
            "\n\n### 🏦 FONTE CANONICA GME (PUN – Prezzo Medio per Fasce, pagina ufficiale)\n"
            + canonical_gme_text
            + "\n\nQuesti sono i PDF ufficiali del GME letti in tempo reale dalla pagina "
            "`gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce`. "
            "**PRIORITÀ MASSIMA per query PUN/F1/F2/F3**: usa questi numeri anche se altre "
            "sezioni contengono valori diversi o `n/d`. Nome file mostra il mese/anno del dato."
        )
    return (
        header + body + dyn_block + drive_block + html_block + canonical_block
        + "\n\nQuando rispondi, cita esplicitamente il nome del file/regola/sito e il contenuto rilevante."
    )


async def _fetch_gme_pun_canonical(tenant: str, user_msg: str, max_pdfs: int = 18) -> str:
    """V50.z565 — SOLO LETTURA dalla cache MongoDB `gme_pun_cache` (< 50 ms). Nessun download nel preflight della chat:
    i mesi mancanti vengono scaricati dal job in background `_gme_refresh_months` (programmato qui via core.context_cache
    e ogni notte dallo scheduler) e sono disponibili alla domanda successiva.
    V50.z53 — una riga per mese senza scadenza (i prezzi GME chiusi non cambiano); F1/F2/F3 + ore dal PDF, Monorario in codice."""
    msg_lc = (user_msg or "").lower()
    if not msg_lc:
        return ""
    # V50.z556 — confine di parola: «appuntamenti» conteneva «pun» e faceva scaricare i PDF GME (5-6 s) a ogni domanda sull'agenda
    if not _GME_KEYS_RX.search(msg_lc):
        return ""

    requested_months = _parse_gme_months_from_msg(user_msg or "")
    from_cache: Dict[str, dict] = {}
    try:
        q = {"month_key": {"$in": [m["key"] for m in requested_months]}} if requested_months else {}
        docs = await db.gme_pun_cache.find(q, {"_id": 0}).sort("month_key", -1).to_list(50 if requested_months else max_pdfs)
        for d in docs:
            from_cache[d["month_key"]] = d
    except Exception as exc:
        logger.debug("[gme-cache] read failed: %s", exc)

    missing = [m["key"] for m in requested_months if m["key"] not in from_cache] if requested_months else ([] if len(from_cache) >= min(max_pdfs, 12) else ["recent"])
    out = _format_gme_blocks(requested_months, from_cache, {})
    if missing:
        # download in background (deduplicato): la chat non aspetta la rete
        _core_ctx_schedule("gme", {"months": sorted(missing)}, ttl_s=6 * 3600)  # noqa: F821
        out = (out + "\n\n" if out else "") + _core_ctx_pending_note(f"PDF GME per {', '.join(missing)}")  # noqa: F821
    return out


async def _gme_refresh_months(args: Dict[str, Any]) -> str:
    """JOB IN BACKGROUND (core.context_cache refresher «gme»): scarica la pagina GME PrezzoMedioFasce e i PDF dei mesi richiesti
    (`args["months"]` = ["2026-07", …] oppure ["recent"] = ultimi 18 mesi non ancora in cache) → upsert in `gme_pun_cache`.
    Ritorna un riepilogo testuale (solo diagnostica: la chat legge `gme_pun_cache`, non questo testo)."""
    wanted = [k for k in (args.get("months") or []) if k != "recent"]
    max_pdfs = 18
    from_cache: Dict[str, dict] = {}
    try:
        docs = await db.gme_pun_cache.find({}, {"_id": 0, "month_key": 1}).to_list(500)
        from_cache = {d["month_key"]: d for d in docs}
    except Exception as exc:
        logger.debug("[gme-cache] read failed: %s", exc)
    requested_months = []
    for k in wanted:
        try:
            y, mo = k.split("-")
            requested_months.append({"key": k, "year": int(y), "month": int(mo), "month_name": _GME_MONTH_NAMES_REV.get(int(mo), "")})
        except Exception:  # noqa: BLE001
            continue
    if requested_months and all(m["key"] in from_cache for m in requested_months):
        return f"gme: {len(requested_months)} mesi già in cache"

    GME_PAGE = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce"
    _headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
    }
    from urllib.parse import urljoin, urlparse

    async def _dl_pdf(client: httpx.AsyncClient, pu: str) -> Optional[Dict[str, Any]]:
        try:
            r = await client.get(pu, timeout=20)
            if r.status_code != 200 or not r.content:
                return None
            txt = _extract_pdf_text_bytes(r.content) or ""
            txt = re.sub(r"\s{3,}", " ", txt).strip()
            if len(txt) < 30:
                return None
            return {"url": pu, "name": urlparse(pu).path.rsplit("/", 1)[-1] or pu, "text": txt}
        except Exception:
            return None

    downloaded: Dict[str, dict] = {}
    async with httpx.AsyncClient(follow_redirects=True, headers=_headers) as client:
        page = await client.get(GME_PAGE, timeout=20)
        if page.status_code != 200:
            return f"gme: pagina HTTP {page.status_code}"
        hrefs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', page.text or "", flags=re.I)
        seen = set()
        candidates: List[Tuple[str, str, Optional[dict]]] = []  # (url, name, month_dict)
        for h in hrefs:
            full = urljoin(GME_PAGE, h)
            _norm = full.split("?")[0].lower()
            if _norm in seen:
                continue
            seen.add(_norm)
            nm = urlparse(full).path.rsplit("/", 1)[-1] or full
            if "faq" in nm.lower():
                continue
            candidates.append((full, nm, _infer_month_from_filename(nm)))

        wanted_keys = {m["key"] for m in requested_months} if requested_months else None
        to_download: List[Tuple[str, str, Optional[dict]]] = []
        if wanted_keys:
            for (u, n, m) in candidates:
                if m and m["key"] in wanted_keys and m["key"] not in from_cache:
                    to_download.append((u, n, m))
        else:
            seen_months: set = set()
            for (u, n, m) in candidates:
                if not m or m["key"] in seen_months or m["key"] in from_cache:
                    continue
                seen_months.add(m["key"])
                to_download.append((u, n, m))
                if len(to_download) >= max_pdfs:
                    break
        if not to_download:
            return "gme: nessun PDF nuovo da scaricare"

        results = await asyncio.gather(*[_dl_pdf(client, u) for (u, _, _) in to_download], return_exceptions=False)
        for (u, n, m), res in zip(to_download, results):
            if not res or not m:
                continue
            parsed = _parse_gme_pdf_prices(res["text"], m)
            if not parsed:
                continue
            doc = {
                "month_key": m["key"],
                "year": m["year"],
                "month": m["month"],
                "month_name": m["month_name"],
                "source_url": u,
                "source_name": n,
                "F1": parsed["F1"], "F1_hours": parsed["F1_hours"],
                "F2": parsed["F2"], "F2_hours": parsed["F2_hours"],
                "F3": parsed["F3"], "F3_hours": parsed["F3_hours"],
                "monorario": parsed["monorario"],
                "total_hours": parsed["total_hours"],
                "unit": parsed.get("unit") or "€/MWh",
                "extracted_at": utcnow(),
            }
            downloaded[m["key"]] = doc
            try:
                await db.gme_pun_cache.update_one({"month_key": m["key"]}, {"$set": doc}, upsert=True)
            except Exception as exc:
                logger.debug("[gme-cache] upsert failed for %s: %s", m["key"], exc)
    logger.info("[gme-refresh] scaricati %d mesi: %s", len(downloaded), ", ".join(sorted(downloaded)) or "—")
    return f"gme: scaricati {len(downloaded)} mesi ({', '.join(sorted(downloaded))})"


_core_ctx_register("gme", _gme_refresh_months)  # noqa: F821 — V50.z565 — refresher in background (core.context_cache)


# --- V50.z53 helpers: month parsing + PDF price extraction ---

_GME_MONTH_NAMES = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
_GME_MONTH_NAMES_REV = {v: k for k, v in _GME_MONTH_NAMES.items()}


def _parse_gme_months_from_msg(msg: str) -> List[dict]:
    """Estrae {key, year, month, month_name} per ogni mese esplicitamente
    menzionato nel messaggio ('luglio 2026', '07/2026', 'ultimi 18 mesi', ecc.).
    Supporta anche il pattern 'ultimi N mesi'/'tabella 18 mesi'."""
    out: List[dict] = []
    msg_lc = (msg or "").lower()

    # Pattern 1: "luglio 2026", "gennaio 2025" ecc.
    for name, num in _GME_MONTH_NAMES.items():
        for m in re.finditer(rf"\b{name}\s+(\d{{4}})\b", msg_lc):
            y = int(m.group(1))
            key = f"{y:04d}-{num:02d}"
            if not any(o["key"] == key for o in out):
                out.append({"key": key, "year": y, "month": num, "month_name": name})

    # Pattern 2: "07/2026", "7/2026", "07-2026"
    for m in re.finditer(r"\b(\d{1,2})[/\-\.](\d{4})\b", msg_lc):
        mo = int(m.group(1)); y = int(m.group(2))
        if 1 <= mo <= 12 and 2015 <= y <= 2035:
            key = f"{y:04d}-{mo:02d}"
            if not any(o["key"] == key for o in out):
                out.append({"key": key, "year": y, "month": mo, "month_name": _GME_MONTH_NAMES_REV.get(mo, "")})

    # Pattern 3: "ultimi N mesi", "tabella N mesi", "N mesi"
    m_n = re.search(r"\bultim[io]\s+(\d{1,2})\s+mesi\b", msg_lc) or \
          re.search(r"\btabella\s+(?:d[ei]\s+)?(\d{1,2})\s+mesi\b", msg_lc) or \
          re.search(r"\b(\d{1,2})\s+mesi\b", msg_lc)
    if m_n and not out:
        n = min(int(m_n.group(1)), 24)
        today = datetime.utcnow()
        for i in range(n):
            # Torna indietro di i+1 mesi rispetto al mese CORRENTE (l'ultimo chiuso è il mese scorso)
            y = today.year
            mo = today.month - (i + 1)
            while mo <= 0:
                mo += 12
                y -= 1
            key = f"{y:04d}-{mo:02d}"
            if not any(o["key"] == key for o in out):
                out.append({"key": key, "year": y, "month": mo, "month_name": _GME_MONTH_NAMES_REV.get(mo, "")})

    out.sort(key=lambda x: x["key"], reverse=True)
    return out


def _infer_month_from_filename(name: str) -> Optional[dict]:
    """Estrae il mese/anno dal nome file GME. Tipici: 'PrezzoMedioFasce_202607.pdf',
    'PMF_2026_07.pdf', 'luglio-2026.pdf', ecc."""
    n = (name or "").lower()
    # YYYYMM
    m = re.search(r"(20\d{2})[_\-\.]?(0[1-9]|1[0-2])(?!\d)", n)
    if m:
        y = int(m.group(1)); mo = int(m.group(2))
        return {"key": f"{y:04d}-{mo:02d}", "year": y, "month": mo, "month_name": _GME_MONTH_NAMES_REV.get(mo, "")}
    # MMYYYY
    m = re.search(r"(?<!\d)(0[1-9]|1[0-2])[_\-\.]?(20\d{2})(?!\d)", n)
    if m:
        mo = int(m.group(1)); y = int(m.group(2))
        return {"key": f"{y:04d}-{mo:02d}", "year": y, "month": mo, "month_name": _GME_MONTH_NAMES_REV.get(mo, "")}
    # nome mese in italiano
    for name_it, num in _GME_MONTH_NAMES.items():
        if name_it in n:
            m2 = re.search(r"(20\d{2})", n)
            if m2:
                y = int(m2.group(1))
                return {"key": f"{y:04d}-{num:02d}", "year": y, "month": num, "month_name": name_it}
    return None


def _parse_gme_pdf_prices(pdf_text: str, month: dict) -> Optional[dict]:
    """Estrae F1/F2/F3 con relative ore dal testo del PDF GME e calcola il
    Monorario PUN come media ponderata per ore. Ritorna None se non trova i 3
    valori con le loro ore.

    Struttura tipica PDF GME PrezzoMedioFasce (verificata su luglio 2026):
        Luglio 2026
        (253 ore)
        154,20
        (179 ore)
        169,38
        (312 ore)
        152,26
    Le fasce F1, F2, F3 sono in ordine sequenziale dopo il nome del mese.
    """
    # Trova tutte le coppie "(NNN ore) VAL,YY" nell'ordine di apparizione.
    # Il PDF può contenere anche mesi passati; per essere robusti,
    # tagliamo il testo a partire dal nome del mese richiesto se presente.
    month_name = (month or {}).get("month_name", "").capitalize()
    year = (month or {}).get("year")
    t = pdf_text or ""
    if month_name and year:
        idx = t.lower().find(f"{month_name.lower()} {year}")
        if idx >= 0:
            t = t[idx:]
    # Compattiamo il testo per gestire spazi non-break (\xa0) e ritorni a capo
    t_norm = re.sub(r"[\s\xa0]+", " ", t)
    # Trova coppie ordinate: "(N ore) prezzo"
    pattern = re.compile(r"\(\s*(\d{2,4})\s*ore\s*\)\s*([\d]{1,4}[,.]\d{1,4})", re.I)
    triples: List[Tuple[int, float]] = []
    for m in pattern.finditer(t_norm):
        try:
            hours = int(m.group(1))
            price = float(m.group(2).replace(".", "").replace(",", "."))
            if 0 < hours < 800 and 0 < price < 10000:
                triples.append((hours, price))
        except Exception:
            pass
        if len(triples) >= 3:
            break
    if len(triples) < 3:
        return None
    (f1_h, f1_p), (f2_h, f2_p), (f3_h, f3_p) = triples[0], triples[1], triples[2]
    total_h = f1_h + f2_h + f3_h
    if total_h <= 0:
        return None
    monorario = (f1_p * f1_h + f2_p * f2_h + f3_p * f3_h) / total_h
    # Rileva unit: GME usa €/MWh come default. Cerchiamo indizi.
    tl = pdf_text.lower()
    if "€/kwh" in tl or "eur/kwh" in tl or "€/kwh".lower() in tl:
        unit = "€/kWh"
    else:
        unit = "€/MWh"
    return {
        "F1": round(f1_p, 4), "F1_hours": f1_h,
        "F2": round(f2_p, 4), "F2_hours": f2_h,
        "F3": round(f3_p, 4), "F3_hours": f3_h,
        "total_hours": total_h,
        "monorario": round(monorario, 6),
        "unit": unit,
    }


def _format_gme_blocks(requested: List[dict], from_cache: Dict[str, dict], downloaded: Dict[str, dict]) -> str:
    """Formatta l'output finale con SOLO valori precalcolati.
    Se un mese è mancante, scrive 'dati non disponibili'. Se `requested` è
    vuoto ma abbiamo dati (from_cache/downloaded), li mostra tutti."""
    merged: Dict[str, dict] = {}
    merged.update(from_cache)
    merged.update(downloaded)
    if not merged and not requested:
        return ""

    # Se requested è vuoto, mostra tutti quelli in merged (ordinati per key desc)
    keys = [m["key"] for m in requested] if requested else sorted(merged.keys(), reverse=True)

    header = (
        "--- DATI GME (PREZZO MEDIO FASCE) ---\n"
        "Tutti i valori F1/F2/F3 e il Monorario sono ESTRATTI DAL PDF UFFICIALE GME\n"
        "e calcolati in codice come media ponderata per ore. NON stimare né modificare\n"
        "questi valori. Per i mesi contrassegnati 'dati non disponibili', NON riempire\n"
        "la cella con un numero: mostra 'dati non disponibili'.\n"
    )
    blocks: List[str] = [header]
    for k in keys:
        d = merged.get(k)
        if not d:
            # Cerca month info dai requested (o parse dalla key)
            info = next((m for m in requested if m["key"] == k), None)
            if not info:
                y, mo = k.split("-")
                info = {"key": k, "year": int(y), "month": int(mo), "month_name": _GME_MONTH_NAMES_REV.get(int(mo), "")}
            blocks.append(
                f"[{info['month_name'].capitalize()} {info['year']}] dati non disponibili "
                f"(nessun PDF GME pubblicato per questo mese)."
            )
            continue
        blocks.append(
            f"[{d.get('month_name','').capitalize()} {d.get('year')}]  unit={d.get('unit','€/MWh')}\n"
            f"  F1 = {d['F1']}   ({d['F1_hours']} ore)\n"
            f"  F2 = {d['F2']}   ({d['F2_hours']} ore)\n"
            f"  F3 = {d['F3']}   ({d['F3_hours']} ore)\n"
            f"  Monorario PUN = {d['monorario']}   (media ponderata calcolata su {d['total_hours']} ore totali)\n"
            f"  Fonte: {d.get('source_name','')}"
        )
    return "\n\n".join(blocks)


# V49.q — Scarica dinamicamente PDF dai link ai_teach_urls quando il messaggio
# utente menziona un mese/anno + tema PUN/fascia/GME. Utile per il pattern
# "guarda su gme.mercatoelettrico.org e prendi luglio/agosto 2026".
_MONTH_MAP_IT = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}


# ─── V50.z — Fetch GENERICO HTML degli URL insegnati ─────────────────────
# Cache in-memory con TTL 15 min per non spammare i siti.
_TEACH_HTML_CACHE: Dict[str, Dict[str, Any]] = {}
_TEACH_HTML_TTL_S = 15 * 60


def _clean_html_to_text(html: str, max_chars: int = 2000) -> str:
    """Estrae testo pulito da HTML con BeautifulSoup + fallback regex."""
    if not html:
        return ""
    try:
        from bs4 import BeautifulSoup  # type: ignore
        soup = BeautifulSoup(html, "html.parser")
        # Rimuovi tag rumorosi
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "noscript"]):
            tag.decompose()
        # Prendi contenuto principale se identificabile
        main = soup.find("main") or soup.find(id="content") or soup.find(class_="content") or soup.body or soup
        text = main.get_text(separator="\n", strip=True) if main else ""
    except Exception:
        # Fallback naive: strip HTML tags via regex
        text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.S | re.I)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
    # Riduci whitespace multipli
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = text.strip()
    if len(text) > max_chars:
        text = text[:max_chars] + "\n... (contenuto troncato)"
    return text


async def _fetch_teach_urls_html_generic(
    tenant: str, user_msg: str, max_urls: int = 8, per_url_chars: int = 1500
) -> str:
    """V50.z3 — Ora legge SEMPRE dallo snapshot DB (istantaneo).
    Il refresh vero avviene in background da `_run_teach_urls_prefetch_job`
    ogni 30 minuti + rispetta la `frequency` di ogni URL. Se il snapshot
    manca (URL appena aggiunto), fa un solo fetch live sincrono max 1 URL.
    """
    from urllib.parse import urljoin, urlparse  # local import (best-effort)
    try:
        urls_docs = await db.ai_teach_urls.find({"user_id": tenant}, {"_id": 0}).to_list(50)
    except Exception:
        return ""
    if not urls_docs:
        return ""

    msg_lc = (user_msg or "").lower()
    msg_tokens = {t for t in re.findall(r"[a-zàèéìòù]{4,}", msg_lc)}

    def _score(u: Dict[str, Any]) -> int:
        hay = f"{(u.get('url') or '').lower()} {(u.get('title') or u.get('name') or '').lower()}"
        return sum(1 for t in msg_tokens if t in hay)

    urls_docs.sort(key=lambda u: _score(u), reverse=True)
    urls_docs = urls_docs[:max_urls]

    # Snapshot già disponibili (letti in un colpo, no fetch live)
    parts: List[str] = []
    pdf_blocks: List[str] = []
    stale_needing_live: List[Dict[str, Any]] = []
    for u in urls_docs:
        snap = u.get("axon_snapshot") or {}
        html_text = (snap.get("html_text") or "").strip()
        pdfs = snap.get("pdf_texts") or []
        # V50.z28 — Fallback su `last_summary` (fetcher manuale via Tavily) se
        # il snapshot vero è vuoto. Prima Axon leggeva SOLO axon_snapshot,
        # ignorando i contenuti che il refresh manuale dall'UI salvava
        # in `last_summary` (bug ricorrente su URL come www.arera.it).
        if not html_text and not pdfs:
            ls = (u.get("last_summary") or "").strip()
            if ls:
                title = u.get("title") or u.get("name") or u.get("url")
                parts.append(f"--- FONTE: {title} ({u.get('url')}) [refresh manuale: {u.get('last_fetched_at') or '?'}] ---\n{ls[:max(per_url_chars, 4000)]}")
                continue  # non aggiungerlo a stale_needing_live
        if html_text:
            title = u.get("title") or u.get("name") or u.get("url")
            parts.append(f"--- FONTE: {title} ({u.get('url')}) [snapshot: {snap.get('fetched_at') or '?'}] ---\n{html_text[:per_url_chars]}")
        for p in pdfs[:3]:
            name = p.get("name") or "PDF"
            txt = (p.get("text") or "").strip()
            if txt:
                pdf_blocks.append(f"--- PDF SNAPSHOT: {name} (da {u.get('title') or u.get('url')}) ---\n{txt[:3500]}")
        if not html_text and not pdfs:
            stale_needing_live.append(u)

    # V50.z565 — URL nuovo senza snapshot: il download NON avviene più nel preflight della chat; viene programmato in
    # background (_axon_refresh_teach_snapshot) e il contenuto sarà nel prompt dalla domanda successiva.
    if stale_needing_live and not parts and not pdf_blocks:
        u = stale_needing_live[0]
        try:
            asyncio.get_running_loop().create_task(_axon_refresh_teach_snapshot(u))
        except Exception:
            pass
        return _core_ctx_pending_note(f"Contenuto del link insegnato «{u.get('title') or u.get('name') or u.get('url')}»")  # noqa: F821

    if not parts and not pdf_blocks:
        return ""

    out = "\n\n".join(parts)
    if pdf_blocks:
        out += "\n\n### 📎 PDF SCARICATI DALLE FONTI LIVE (contenuto testuale)\n" + "\n\n".join(pdf_blocks)
    return out


async def _axon_refresh_teach_snapshot(u_doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Scarica HTML della pagina + primi 3 PDF, estrae testo, salva snapshot
    in `ai_teach_urls.axon_snapshot` e ritorna il snapshot.

    V50.z4 — Usa pdfplumber per estrarre TABELLE strutturate dai PDF
    (essenziale per PUN F1/F2/F3, listini, tariffe). Fallback pypdf.
    V50.z19 — Registra `last_error` con timestamp e motivo quando un fetch
    fallisce (URL senza schema, HTTP ≥400, eccezione), invece di ignorare
    silenziosamente. Così il pannello AI-Teach mostra il problema all'utente.
    """
    from urllib.parse import urljoin, urlparse
    url = (u_doc.get("url") or "").strip()
    # V50.z77 — Il fetch accetta SOLO https://. Se lo schema è mancante o `http://`,
    # registra un errore descrittivo e non tenta la connessione.
    if not url:
        try:
            await db.ai_teach_urls.update_one(
                {"user_id": u_doc.get("user_id"), "url_id": u_doc.get("url_id")},
                {"$set": {"last_error": {
                    "reason": "empty_url",
                    "message": "URL vuoto: impossibile eseguire il fetch",
                    "at": utcnow(),
                }}},
            )
        except Exception:
            pass
        return None
    if not url.startswith("https://"):
        reason = "insecure_scheme" if url.startswith("http://") else "invalid_scheme"
        message = (
            f"URL senza https:// (valore: '{url}'). Rimuovi lo schema http:// oppure salva l'URL con https://."
            if reason == "insecure_scheme"
            else f"URL senza schema http/https (valore: '{url}')."
        )
        try:
            await db.ai_teach_urls.update_one(
                {"user_id": u_doc.get("user_id"), "url_id": u_doc.get("url_id")},
                {"$set": {"last_error": {
                    "reason": reason,
                    "message": message,
                    "at": utcnow(),
                }}},
            )
        except Exception:
            pass
        return None

    async def _extract_pdf_bytes(pdf_bytes: bytes, max_pages: int = 8, max_chars: int = 8000) -> str:
        """Estrae testo + tabelle da un PDF. Prova prima pdfplumber (tabelle),
        fallback pypdf. Ritorna stringa formattata."""
        text_parts: List[str] = []
        # Tentativo 1: pdfplumber — V50.z210: nel sottoprocesso worker (mai nel processo API)
        try:
            t_all = (await heavy_call("pdf_tables_text", data=pdf_bytes, max_pages=max_pages, mode="markdown")).get("text") or ""
            if t_all.strip():
                text_parts.append(t_all)
        except Exception as exc:
            logger.debug("[pdf-extract] pdfplumber failed: %s (fallback pypdf)", exc)
        # Fallback pypdf se il testo è vuoto
        if not text_parts:
            try:
                from io import BytesIO
                try:
                    from pypdf import PdfReader  # type: ignore
                except Exception:
                    from PyPDF2 import PdfReader  # type: ignore
                rdr = PdfReader(BytesIO(pdf_bytes))
                for pg in rdr.pages[:max_pages]:
                    try:
                        t = pg.extract_text() or ""
                        if t.strip():
                            text_parts.append(t.strip())
                    except Exception:
                        pass
            except Exception:
                pass
        out = "\n\n".join(text_parts)
        out = re.sub(r"\n{3,}", "\n\n", out).strip()

        # V50.z7 — Se pdfplumber/pypdf NON hanno estratto testo utile,
        # il PDF è probabilmente SCANSIONATO (immagine). Fallback: Claude Vision.
        if len(out) < 100:
            try:
                key = os.environ.get("EMERGENT_LLM_KEY")
                if key:
                    # V50.z210 — rasterizzazione nel worker (max 3 pagine per non essere lenti)
                    pages_img = (await heavy_call("pdf_render_pages", data=pdf_bytes, max_pages=3, scale=2.0, fmt="jpeg", quality=80)).get("images") or []
                    ocr_parts: List[str] = []
                    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
                    for i, jpg in enumerate(pages_img):
                        try:
                            b64 = _b64.b64encode(jpg).decode()
                            chat = LlmChat(
                                api_key=key,
                                session_id=f"pdf-ocr-{uuid.uuid4().hex[:8]}",
                                system_message="Sei un OCR italiano. Trascrivi ESATTAMENTE tutto il testo visibile nell'immagine. Preserva tabelle in formato Markdown. Nessun commento, solo testo.",
                            ).with_model("anthropic", "claude-haiku-4-5")
                            content = [ImageContent(image_base64=b64, media_type="image/jpeg")]
                            resp = await chat.send_message(UserMessage(text="Trascrivi tutto il testo di questa pagina.", images=content))  # type: ignore
                            if resp and resp.strip():
                                ocr_parts.append(f"[Pagina {i+1} · OCR]\n{resp.strip()}")
                        except Exception as exc_p:
                            logger.debug("[pdf-ocr] page %d failed: %s", i, exc_p)
                    if ocr_parts:
                        out = "\n\n".join(ocr_parts)
                        logger.info("[pdf-ocr] recovered %d pages via Claude Vision", len(ocr_parts))
            except Exception as exc:
                logger.debug("[pdf-ocr] fallback failed: %s", exc)

        return out[:max_chars]

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            r = await client.get(
                url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; AxonBot/1.0; +https://advisoros.it)"},
            )
            if r.status_code >= 400:
                # V50.z19 — Salva errore HTTP invece di ignorarlo silenziosamente
                try:
                    await db.ai_teach_urls.update_one(
                        {"user_id": u_doc.get("user_id"), "url_id": u_doc.get("url_id")},
                        {"$set": {"last_error": {
                            "reason": "http_error",
                            "message": f"HTTP {r.status_code} durante il fetch di {url}",
                            "at": utcnow(),
                        }}},
                    )
                except Exception:
                    pass
                return None
            ctype = (r.headers.get("content-type") or "").lower()
            html_text = ""
            pdf_texts: List[Dict[str, str]] = []
            if "text/html" in ctype or "text/plain" in ctype or "xhtml" in ctype:
                html_text = _clean_html_to_text(r.text, max_chars=3000)
                # Estrai link PDF
                hrefs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', r.text, flags=re.I)
                seen = set()
                pdf_urls = []
                for h in hrefs:
                    full = urljoin(url, h)
                    if full in seen:
                        continue
                    seen.add(full)
                    pdf_urls.append(full)
                    if len(pdf_urls) >= 3:
                        break
                # Scarica i primi 3 PDF (in parallelo)
                async def _dl(pu: str) -> Optional[Dict[str, str]]:
                    try:
                        rr = await client.get(pu, headers={"User-Agent": "Mozilla/5.0"})
                        if rr.status_code >= 400 or not rr.content:
                            return None
                        text = await _extract_pdf_bytes(rr.content, max_pages=6, max_chars=8000)
                        if not text or len(text) < 50:
                            return None
                        return {"url": pu, "name": urlparse(pu).path.rsplit("/", 1)[-1] or pu, "text": text}
                    except Exception:
                        return None
                results = await asyncio.gather(*[_dl(pu) for pu in pdf_urls], return_exceptions=False)
                pdf_texts = [x for x in results if x]
            elif "pdf" in ctype:
                # L'URL punta direttamente a un PDF
                text = await _extract_pdf_bytes(r.content, max_pages=8, max_chars=10000)
                if text.strip():
                    pdf_texts = [{"url": url, "name": urlparse(url).path.rsplit("/", 1)[-1] or url, "text": text}]
            snap = {
                "html_text": html_text,
                "pdf_texts": pdf_texts,
                "fetched_at": utcnow().isoformat(),
            }
            # V50.z20 — Rileva PDF nuovi (mai visti prima) e crea alert in-app.
            # Confronta i "name" dei PDF nel vecchio snapshot con quelli nuovi;
            # se ce ne sono di nuovi, crea un `axon_alerts` per il tenant.
            try:
                prev_snap = u_doc.get("axon_snapshot") or {}
                prev_names = {(p.get("name") or "").strip().lower() for p in (prev_snap.get("pdf_texts") or []) if p.get("name")}
                curr_pdfs = [p for p in pdf_texts if p.get("name")]
                new_pdfs = [p for p in curr_pdfs if (p.get("name") or "").strip().lower() not in prev_names]
                # Considera "nuovi" solo se c'era già uno snapshot precedente
                # (altrimenti il primo fetch di sempre spammerebbe alert per tutti i PDF)
                if prev_snap and new_pdfs:
                    tid = u_doc.get("user_id")
                    src_name = u_doc.get("name") or (urlparse(url).netloc) or "Sorgente Axon"
                    for p in new_pdfs[:3]:
                        try:
                            await db.axon_alerts.insert_one({
                                "alert_id": f"aal_{uuid.uuid4().hex[:12]}",
                                "tenant_id": tid,
                                "type": "new_pdf",
                                "title": f"Nuovo PDF da {src_name}",
                                "message": p.get("name") or "Documento aggiornato",
                                "url_id": u_doc.get("url_id"),
                                "source_url": url,
                                "pdf_url": p.get("url"),
                                "pdf_name": p.get("name"),
                                "seen": False,
                                "created_at": utcnow(),
                            })
                            logger.info("[axon-alert] new_pdf: %s (%s)", p.get("name"), src_name)
                        except Exception as _e:
                            logger.debug("[axon-alert] insert failed: %s", _e)
            except Exception as _e2:
                logger.debug("[axon-alert] detection failed: %s", _e2)
            await db.ai_teach_urls.update_one(
                {"user_id": u_doc.get("user_id"), "url_id": u_doc.get("url_id")},
                {"$set": {"axon_snapshot": snap, "last_fetched_at": utcnow(), "last_error": None}},
            )
            return snap
    except Exception as exc:
        # V50.z19 — Registra l'errore (era solo debug prima).
        logger.warning("[axon-snapshot] failed for %s: %s", url, exc)
        try:
            await db.ai_teach_urls.update_one(
                {"user_id": u_doc.get("user_id"), "url_id": u_doc.get("url_id")},
                {"$set": {"last_error": {
                    "reason": "exception",
                    "message": str(exc)[:400],
                    "at": utcnow(),
                }}},
            )
        except Exception:
            pass
        return None


async def _run_teach_urls_prefetch_job() -> None:
    """Ogni 30 min: aggiorna gli snapshot degli URL insegnati stale
    in base alla frequency (daily/weekly/monthly). Max 20 URL per run.
    """
    try:
        now = utcnow()
        thresholds_hours = {"daily": 24, "weekly": 24 * 7, "monthly": 24 * 30}
        cur = db.ai_teach_urls.find({"active": {"$ne": False}}, {"_id": 0}).limit(200)
        stale: List[Dict[str, Any]] = []
        async for u in cur:
            freq = (u.get("frequency") or "weekly").lower()
            if freq == "manual":
                # Fai solo il primo fetch se non c'è mai stato
                if not u.get("axon_snapshot"):
                    stale.append(u)
                continue
            hrs = thresholds_hours.get(freq, 24 * 7)
            last = u.get("last_fetched_at")
            if not last:
                stale.append(u)
            else:
                if isinstance(last, str):
                    try:
                        last = datetime.fromisoformat(last)
                    except Exception:
                        last = None
                if last:
                    if last.tzinfo is None:
                        last = last.replace(tzinfo=timezone.utc)
                    age_h = (now - last).total_seconds() / 3600
                    if age_h >= hrs:
                        stale.append(u)
        # Aggiorna max 20 URL per run per non caricare troppo
        stale = stale[:20]
        if not stale:
            return
        logger.info("[axon-prefetch] refreshing %d stale teach URLs", len(stale))
        # V50.z19 — Conta separatamente successi e fallimenti
        n_ok = 0
        n_fail = 0
        failures: List[str] = []
        for u in stale:
            try:
                res = await _axon_refresh_teach_snapshot(u)
                if res is not None:
                    n_ok += 1
                else:
                    n_fail += 1
                    failures.append(f"{u.get('name') or u.get('url_id')} ({u.get('url') or 'no-url'})")
            except Exception as exc:
                n_fail += 1
                failures.append(f"{u.get('name') or u.get('url_id')}: {exc}")
                logger.warning("[axon-prefetch] fail %s: %s", u.get("url"), exc)
        # V50.z77 — Log dettagliato: sempre riporta ok/failed separati, elenca fino a 5 errori
        if n_fail == 0:
            logger.info("[axon-prefetch] done: %d success, %d failed (0 errors)", n_ok, n_fail)
        else:
            logger.warning(
                "[axon-prefetch] done: %d success, %d failed — errors: %s%s",
                n_ok,
                n_fail,
                "; ".join(failures[:5]),
                (f" (+{len(failures) - 5} altri)" if len(failures) > 5 else ""),
            )
    except Exception as exc:
        logger.warning("[axon-prefetch] job failed: %s", exc)


# ─── V50.z (legacy — mantenuta ma non più usata direttamente) ────────────
async def _fetch_teach_urls_html_generic_legacy(
    tenant: str, user_msg: str, max_urls: int = 8, per_url_chars: int = 1500
) -> str:
    """Scarica in parallelo il testo HTML degli URL insegnati per il tenant
    e ritorna una sezione formattata da iniettare nel prompt.

    - Sempre attivo (per QUALSIASI messaggio), non solo pattern PUN.
    - Cache 15 min per URL per non stressare i siti.
    - Timeout 6s per URL, in parallelo.
    - Prioritizza URL rilevanti al messaggio (matching parole chiave nell'URL).
    - Best-effort: fallimenti silenziosi.
    - V50.z2: se le pagine contengono link a PDF (max 3 totali), li scarica
      automaticamente e allega il loro testo — copre il caso "aggiorna la
      tabella" senza dover menzionare parole tecniche.
    """
    from urllib.parse import urljoin, urlparse  # local import (best-effort)
    try:
        urls_docs = await db.ai_teach_urls.find({"user_id": tenant}, {"_id": 0}).to_list(50)
    except Exception:
        return ""
    if not urls_docs:
        return ""

    msg_lc = (user_msg or "").lower()
    msg_tokens = {t for t in re.findall(r"[a-zàèéìòù]{4,}", msg_lc)}

    def _score(u: Dict[str, Any]) -> int:
        url_lc = (u.get("url") or "").lower()
        title_lc = (u.get("title") or "").lower()
        hay = f"{url_lc} {title_lc}"
        return sum(1 for t in msg_tokens if t in hay)

    urls_docs.sort(key=lambda u: (
        _score(u),
        -1 if (u.get("active") is not False) else 0,
        (u.get("updated_at") or datetime.min).isoformat() if not isinstance(u.get("updated_at"), str) else (u.get("updated_at") or ""),
    ), reverse=True)
    urls_docs = urls_docs[:max_urls]

    now = time.time()

    async def _fetch(client: "httpx.AsyncClient", u_doc: Dict[str, Any]) -> Optional[Dict[str, str]]:
        url = (u_doc.get("url") or "").strip()
        if not url or not url.startswith(("http://", "https://")):
            return None
        # Cache
        cached = _TEACH_HTML_CACHE.get(url)
        if cached and (now - cached.get("ts", 0)) < _TEACH_HTML_TTL_S:
            return {"url": url, "title": u_doc.get("title") or url, "text": cached["text"]}
        try:
            r = await client.get(
                url,
                timeout=6.0,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (compatible; AxonBot/1.0; +https://advisoros.it)"},
            )
            if r.status_code >= 400:
                return None
            ctype = (r.headers.get("content-type") or "").lower()
            if "text/html" not in ctype and "text/plain" not in ctype and "application/xhtml" not in ctype:
                # Non è HTML → salta (i PDF li gestisce l'altra funzione)
                return None
            text = _clean_html_to_text(r.text, max_chars=per_url_chars)
            if not text or len(text) < 40:
                return None
            _TEACH_HTML_CACHE[url] = {"ts": now, "text": text, "raw_html": r.text[:400_000]}
            return {"url": url, "title": u_doc.get("title") or url, "text": text}
        except Exception as exc:
            logger.debug("[teach-html] failed %s: %s", url, exc)
            return None

    try:
        async with httpx.AsyncClient() as client:
            results = await asyncio.gather(*[_fetch(client, u) for u in urls_docs], return_exceptions=False)
    except Exception as exc:
        logger.warning("[teach-html] gather failed: %s", exc)
        return ""

    valid = [r for r in results if r]
    if not valid:
        return ""

    # V50.z2 — Se le pagine contengono link a PDF (max 3 in totale),
    # scaricali e allega il loro testo. Questo copre casi in cui il messaggio
    # non contiene le parole chiave "PUN/fascia/GME" ma vuole comunque dati
    # aggiornati (es. utente chiede "aggiorna la tabella").
    pdf_blocks: List[str] = []
    try:
        pdf_candidates: List[Dict[str, str]] = []
        seen_pdf = set()
        for item in valid:
            base_url = item["url"]
            # Riprendiamo l'HTML dalla cache per estrarne i link PDF
            cached = _TEACH_HTML_CACHE.get(base_url)
            if not cached or "raw_html" not in cached:
                continue
            hrefs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', cached["raw_html"], flags=re.I)
            for h in hrefs[:6]:  # top 6 per pagina, poi ordiniamo globalmente
                full = urljoin(base_url, h)
                if full in seen_pdf:
                    continue
                seen_pdf.add(full)
                pdf_candidates.append({"url": full, "source_page": item["title"] or base_url})
        # Prendi solo i primi 3 PDF (i siti tipo GME mostrano dal più recente)
        pdf_candidates = pdf_candidates[:3]
        if pdf_candidates:
            async with httpx.AsyncClient(follow_redirects=True, timeout=15) as pclient:
                async def _dl_pdf(cand: Dict[str, str]) -> Optional[str]:
                    try:
                        rr = await pclient.get(
                            cand["url"],
                            headers={"User-Agent": "Mozilla/5.0 (compatible; AxonBot/1.0; +https://advisoros.it)"},
                        )
                        if rr.status_code >= 400 or not rr.content:
                            return None
                        ct = (rr.headers.get("content-type") or "").lower()
                        if "pdf" not in ct and not cand["url"].lower().endswith(".pdf"):
                            return None
                        from io import BytesIO
                        try:
                            from pypdf import PdfReader  # type: ignore
                        except Exception:
                            from PyPDF2 import PdfReader  # type: ignore
                        rdr = PdfReader(BytesIO(rr.content))
                        text = ""
                        for pg in rdr.pages[:6]:  # max 6 pagine per PDF
                            try:
                                text += (pg.extract_text() or "") + "\n"
                            except Exception:
                                pass
                        text = re.sub(r"\n{3,}", "\n\n", text).strip()
                        if not text or len(text) < 50:
                            return None
                        name = urlparse(cand["url"]).path.rsplit("/", 1)[-1] or cand["url"]
                        return f"--- PDF LIVE: {name} (da {cand['source_page']}) ---\n{text[:4000]}"
                    except Exception as exc:
                        logger.debug("[teach-html-pdf] failed %s: %s", cand.get("url"), exc)
                        return None
                pdf_results = await asyncio.gather(*[_dl_pdf(c) for c in pdf_candidates], return_exceptions=False)
                pdf_blocks = [p for p in pdf_results if p]
    except Exception as exc:
        logger.warning("[teach-html-pdf] block failed: %s", exc)

    parts: List[str] = []
    for i, item in enumerate(valid, 1):
        parts.append(
            f"--- FONTE {i}: {item['title']} ({item['url']}) ---\n{item['text']}"
        )
    if pdf_blocks:
        parts.append("\n### 📎 PDF SCARICATI DALLE FONTI LIVE (contenuto testuale)\n" + "\n\n".join(pdf_blocks))
    logger.info("[teach-html] fetched %d/%d pages + %d pdfs for tenant=%s",
                len(valid), len(urls_docs), len(pdf_blocks), tenant)
    return "\n\n".join(parts)


# V49.q — Scarica dinamicamente PDF dai link ai_teach_urls quando il messaggio
# utente menziona un mese/anno + tema PUN/fascia/GME. Utile per il pattern
# "guarda su gme.mercatoelettrico.org e prendi luglio/agosto 2026".
# NB: la costante _MONTH_MAP_IT è ora sopra (dedup).



async def _fetch_teach_url_pdfs_for_query(tenant: str, user_msg: str, max_pdfs: int = 3) -> str:
    """V50.z565 — SOLO LETTURA dalla cache del contesto (core.context_cache, kind «url-pdf», TTL 24 h): la chat non scarica
    più pagine/PDF dei link insegnati. Su miss programma `_teach_url_pdfs_download` in background e ritorna "" (o il testo
    stale se c'è); il job periodico `context-cache-refresh` tiene calde le voci usate di recente."""
    msg_lc = (user_msg or "").lower()
    if not msg_lc or not _PUN_LIKE_RX.search(msg_lc):  # V50.z556 — confine di parola (vedi _GME_KEYS_RX)
        return ""
    months = [m for m in _MONTH_MAP_IT if m in msg_lc]
    for _mnum in re.findall(r"\b(0[1-9]|1[0-2])[/\-\.\s](20\d{2})\b", msg_lc):
        _mnum_int = int(_mnum[0])
        for _mname, _mval in _MONTH_MAP_IT.items():
            if _mval == _mnum_int and _mname not in months:
                months.append(_mname)
    years = sorted(set(re.findall(r"20\d{2}", msg_lc)))
    args = {"tenant": tenant, "months": sorted(months), "years": years, "max_pdfs": max_pdfs}
    res = await _core_ctx_get("url-pdf", args, ttl_s=24 * 3600)  # noqa: F821
    return res.get("text") or ""


async def _teach_url_pdfs_download(args: Dict[str, Any]) -> str:
    """JOB IN BACKGROUND (refresher «url-pdf»): scarica le pagine insegnate (`ai_teach_urls`) e i PDF che corrispondono a
    mesi/anni richiesti (o i più recenti se non specificati) e ritorna il testo estratto da iniettare nel prompt.

    V50.b — PERFORMANCE + MATCHING FIX:
    - Fetch pagine e download PDF PARALLELIZZATI con asyncio.gather; cap 10 pagine per tenant.
    - Regex mese/anno estesa a formati comuni GME: "202607", "07-2026", "07_2026",
      "2026-07", "2026_07", "07.2026", "202607PMF", "PrezzoMedioFasce_202607.pdf".
    """
    tenant = args.get("tenant") or ""
    months: List[str] = list(args.get("months") or [])
    years: List[str] = list(args.get("years") or [])
    max_pdfs = int(args.get("max_pdfs") or 3)
    # V50.z26 — Se manca mese/anno ma il tema è chiaramente PUN/energia, NON
    # tornare vuoto: prendi i PDF più recenti trovati sulla pagina (fallback).
    no_filter = (not months) and (not years)
    try:
        urls = await db.ai_teach_urls.find({"user_id": tenant}, {"_id": 0}).to_list(50)
    except Exception:
        return ""
    if not urls:
        return ""
    # V50.b — cap max 10 URL pages processate per query (era 50). Priorità a URL
    # che contengono "gme" o "pun" nell'indirizzo per query PUN.
    urls_prio = sorted(
        urls,
        key=lambda u: (
            0 if any(k in (u.get("url") or "").lower() for k in ["gme", "pun", "prezzo"]) else 1,
        ),
    )[:10]

    from urllib.parse import urljoin, urlparse

    def _month_match_patterns(m_name: str) -> List[str]:
        """Genera tutti i pattern possibili per un mese nel filename di un PDF GME."""
        mnum = _MONTH_MAP_IT[m_name]
        m2 = f"{mnum:02d}"
        pats = [
            m_name,           # "luglio"
            f"-{m2}-",        # "-07-"
            f"_{m2}_",        # "_07_"
            f".{m2}.",        # ".07."
            f"/{m2}/",        # "/07/"
        ]
        # YYYYMM / MMYYYY combinations con ogni anno menzionato
        for y in years:
            pats.extend([
                f"{y}{m2}",       # "202607"
                f"{m2}{y}",       # "072026"
                f"{y}-{m2}",      # "2026-07"
                f"{y}_{m2}",      # "2026_07"
                f"{y}.{m2}",      # "2026.07"
                f"{m2}-{y}",      # "07-2026"
                f"{m2}_{y}",      # "07_2026"
                f"{m2}.{y}",      # "07.2026"
            ])
        return pats

    # Pre-computa tutti i pattern che accettano il mese
    month_patterns_map: dict = {m: _month_match_patterns(m) for m in months} if months else {}

    async def _fetch_page(client: httpx.AsyncClient, page_url: str) -> Optional[str]:
        try:
            r = await client.get(page_url, timeout=8.0)
            if r.status_code != 200:
                return None
            return r.text or ""
        except Exception:
            return None

    async def _fetch_pdf(client: httpx.AsyncClient, pdf_url: str) -> Optional[tuple]:
        try:
            pr = await client.get(pdf_url, timeout=15.0)
            if pr.status_code != 200 or not pr.content:
                return None
            pdf_bytes = pr.content
            if len(pdf_bytes) > 8 * 1024 * 1024:
                pdf_bytes = pdf_bytes[: 8 * 1024 * 1024]
            txt = _extract_pdf_text_bytes(pdf_bytes) or ""
            txt = txt.strip()
            if not txt:
                return None
            pdf_name = urlparse(pdf_url).path.rsplit("/", 1)[-1] or pdf_url
            return (pdf_name, pdf_url, txt)
        except Exception as exc:
            logger.debug("[teach-pdf] download failed for %s: %s", pdf_url, exc)
            return None

    out_blocks: List[str] = []
    _headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
    }
    async with httpx.AsyncClient(follow_redirects=True, headers=_headers) as client:
        # STEP 1: fetch tutte le pagine in parallelo
        page_urls = [(u.get("url") or "").strip() for u in urls_prio if u.get("url")]
        page_htmls = await asyncio.gather(
            *[_fetch_page(client, pu) for pu in page_urls],
            return_exceptions=False,
        )

        # STEP 2: collezione dei PDF url da scaricare (dedup)
        pdf_urls_all: List[str] = []
        seen_pdfs = set()
        for page_url, html in zip(page_urls, page_htmls):
            if not html:
                continue
            hrefs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', html, flags=re.IGNORECASE)
            if not hrefs:
                continue
            for h in hrefs:
                h_low = h.lower()
                if no_filter:
                    # V50.z26 — Nessun filtro: prendiamo i PDF nell'ordine di
                    # apparizione (le pagine tipo GME li ordinano dal più recente).
                    full = urljoin(page_url, h)
                    if full not in seen_pdfs:
                        seen_pdfs.add(full)
                        pdf_urls_all.append(full)
                else:
                    month_ok = (not months) or any(
                        any(p in h_low for p in month_patterns_map[m])
                        for m in months
                    )
                    year_ok = (not years) or any(y in h_low for y in years)
                    if month_ok and year_ok:
                        full = urljoin(page_url, h)
                        if full not in seen_pdfs:
                            seen_pdfs.add(full)
                            pdf_urls_all.append(full)
                if len(pdf_urls_all) >= max_pdfs * 3:
                    break
            if len(pdf_urls_all) >= max_pdfs * 3:
                break

        # STEP 3: download tutti i PDF selezionati in parallelo (cap max_pdfs*2)
        if pdf_urls_all:
            pdf_results = await asyncio.gather(
                *[_fetch_pdf(client, pu) for pu in pdf_urls_all[: max_pdfs * 2]],
                return_exceptions=False,
            )
            for res in pdf_results:
                if res:
                    pdf_name, pdf_url, txt = res
                    out_blocks.append(
                        f"--- PDF scaricato: {pdf_name} (fonte: {pdf_url}) ---\n{txt[:8000]}"
                    )
                if len(out_blocks) >= max_pdfs:
                    break

    return "\n\n".join(out_blocks)


_core_ctx_register("url-pdf", _teach_url_pdfs_download)  # noqa: F821 — V50.z565 — refresher in background (core.context_cache)



# ─── V50.z7 — Fetch PDF da Drive folders/files in ai_teach_urls ──────────
# Quando l'utente inserisce un link Google Drive (cartella o file singolo)
# come "URL insegnato", Axon lo legge in tempo reale via API Drive OAuth
# dell'utente. Filtra per mese/anno menzionato nella query, altrimenti
# prende i più recenti.
_DRIVE_FOLDER_RE = re.compile(r"drive\.google\.com/drive/folders/([a-zA-Z0-9_\-]+)")
_DRIVE_FILE_RE = re.compile(r"drive\.google\.com/file/d/([a-zA-Z0-9_\-]+)")


def _extract_drive_folder_id(url: str) -> Optional[str]:
    m = _DRIVE_FOLDER_RE.search(url or "")
    return m.group(1) if m else None


def _extract_drive_file_id(url: str) -> Optional[str]:
    m = _DRIVE_FILE_RE.search(url or "")
    return m.group(1) if m else None


async def _drive_index_roots(tenant: str) -> Tuple[List[Dict[str, str]], List[str]]:
    """V50.z155 — Radici dell'indice Drive di un tenant:
    cartelle scelte in Impostazioni → Google Drive (`google_drive_folders`) +
    link drive.google.com inseriti in "Insegna ad Axon" (`ai_teach_urls`).
    Ritorna ([{id, name}], [file_id singoli])."""
    folders: List[Dict[str, str]] = []
    seen: set = set()
    try:
        cur = db.google_drive_folders.find({"user_id": tenant}, {"_id": 0, "folder_id": 1, "folder_name": 1})
        async for d in cur:
            fid = d.get("folder_id")
            if fid and fid not in seen:
                seen.add(fid)
                folders.append({"id": fid, "name": d.get("folder_name") or "Cartella Drive"})
    except Exception:
        pass
    files: List[str] = []
    try:
        urls = await db.ai_teach_urls.find({"user_id": tenant}, {"_id": 0, "url": 1, "title": 1}).to_list(50)
    except Exception:
        urls = []
    for u in urls:
        url = (u.get("url") or "").strip()
        fid = _extract_drive_folder_id(url)
        if fid:
            if fid not in seen:
                seen.add(fid)
                folders.append({"id": fid, "name": u.get("title") or "Cartella insegnata"})
            continue
        fid = _extract_drive_file_id(url)
        if fid:
            files.append(fid)
    return folders, files


_DRIVE_TEACH_STOPWORDS = {
    "the","and","for","con","del","della","dei","delle","dal","dalla",
    "che","una","uno","gli","alla","allo","alle","agli","tra","fra",
    "sul","sulla","sui","sulle","suo","sua","suoi","sue","mio","mia","miei","mie",
    "cosa","come","dove","quando","quanto","quanti","quali","perché",
    "fai","dammi","dimmi","mostrami","fammi","voglio","vorrei","posso","puoi","puo",
    "sintesi","riassunto","tabella","dati","elenco","lista","file","pdf",
    "sono","siamo","sei","fatto","fatta","ecco","così","cosi","molto",
    "drive","google","cartella","cartelle","documento","documenti","vedi","hai","accesso",
}


_DRIVE_SEM_BACKFILL_RUNNING: set = set()


def _schedule_drive_semantic_backfill(tenant: str) -> None:
    """V50.z562 — Popola l'indice semantico ChromaDB dagli snapshot Mongo già esistenti (una volta, in background)."""
    if tenant in _DRIVE_SEM_BACKFILL_RUNNING:
        return
    _DRIVE_SEM_BACKFILL_RUNNING.add(tenant)

    async def _run():
        try:
            rows = await db.drive_snapshots.find({"user_id": tenant}, {"_id": 0, "file_id": 1, "name": 1, "folder_path": 1, "text": 1, "modified_time": 1}).to_list(5000)
            n = 0
            for r in rows:
                if (r.get("text") or "").strip():
                    n += int(await asyncio.to_thread(_core_drive_upsert, tenant, r["file_id"], r.get("name") or r["file_id"], r.get("folder_path") or "", r["text"], r.get("modified_time") or "") or 0)  # noqa: F821
            logger.info("[drive-semantic] backfill tenant %s: %d file, %d chunk", tenant, len(rows), n)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[drive-semantic] backfill failed: %s", exc)
        finally:
            _DRIVE_SEM_BACKFILL_RUNNING.discard(tenant)

    asyncio.create_task(_run())


# tag 2026-10-19 — Regole listino a soglie fisse (richiesta 19/10). Sovrascrivibili senza deploy: db.axon_config {key: "listino_rules", rules: [...]}.
# «418.000» è la fascia 300.000-600.000 (una regola «== 418000» varrebbe per un solo cliente).
_LISTINO_RULES_DEFAULT = [
    {"min": 0, "max": 10000, "offer": "Super Impresa Smart", "spread": "PUN + 0,025 €/kWh", "fixed": "17,90 €/mese", "source": "Super Impresa Suite 1026.pdf, pag. 31"},
    {"min": 300000, "max": 600000, "offer": "Super Impresa Suite — Fascia 300k-600k", "spread": "PUN + 0,012 €/kWh", "fixed": "", "source": "Super Impresa Suite 1026.pdf, pag. 10"},
]


async def _fetch_teach_drive_pdfs_for_query(
    tenant: str, user_msg: str, max_pdfs: int = 4
) -> str:
    """V50.z565 — DRIVE SNAPSHOT LEGGERI. È VIETATO caricare in memoria tutti i testi di `drive_snapshots` del tenant:
    1) metadati soltanto (nome, cartella, data, has_text — mai `text`) per elenco, [ROOT FILES] e fallback lessicale sul nome;
    2) SELEZIONE dei file via ChromaDB (core.drive_retrieval.search, contenuto) + punteggio lessicale sul nome;
    3) UNA sola query Mongo `file_id ∈ selezionati` per estrarre il testo dei soli file scelti (≤ max_pdfs + 2 root).
    V50.z155 — l'indice (`drive_snapshots`) sostituisce le chiamate live all'API Drive; se l'indice è vuoto ma esistono radici,
    avvia il reindex in background e lo dichiara nel prompt. Include la sezione «📁 [ROOT FILES]» (prima in axon_drive_root.py).
    Ritorna "" solo se il tenant non ha Drive collegato né cartelle.
    """
    msg_lc = (user_msg or "").lower()
    folders, single_files = await _drive_index_roots(tenant)
    if not folders and not single_files:
        return ""
    connected = await db.google_drive_connections.find_one({"user_id": tenant}, {"_id": 0, "user_id": 1}) is not None

    # 1) METADATI (senza testo): has_text calcolato lato Mongo
    _m0 = _time_mod.monotonic()
    try:
        snaps = await db.drive_snapshots.aggregate([
            {"$match": {"user_id": tenant}},
            {"$sort": {"modified_time": -1}},
            {"$limit": 2000},
            {"$project": {"_id": 0, "file_id": 1, "name": 1, "folder_path": 1, "modified_time": 1, "mime": 1,
                          "has_text": {"$gt": [{"$strLenCP": {"$ifNull": ["$text", ""]}}, 0]}}},
        ]).to_list(2000)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[drive-teach] metadata query failed: %s", exc)
        snaps = []
    _core_stream_mark_phase("teach.drive.mongo", _time_mod.monotonic() - _m0)  # noqa: F821 — solo metadati (niente testo)

    folder_names = ", ".join(f["name"] for f in folders[:20]) or "—"
    header_lines = [
        f"CARTELLE DRIVE MONITORATE ({len(folders)}): {folder_names}",
        f"FILE INDICIZZATI: {len(snaps)}",
    ]

    if not snaps:
        if connected:
            _schedule_drive_reindex(tenant, reason="index-empty")
            header_lines.append(
                "⚠️ Indice in costruzione (prima indicizzazione avviata ora): i contenuti dei file "
                "saranno disponibili tra pochi minuti. Se l'utente chiede se hai accesso al Drive: "
                "rispondi SÌ (cartelle sopra), spiegando che l'indice si sta ancora popolando."
            )
        else:
            header_lines.append(
                "🔴 Google Drive NON collegato (o sessione scaduta): l'indice non può aggiornarsi. "
                "Invita l'utente a Impostazioni → Google Drive → Collega."
            )
        return "\n".join(header_lines)

    # [ROOT FILES] — tutti i file direttamente nella radice delle cartelle monitorate (elenco completo, solo metadati)
    root_names = [f.get("name") or "" for f in folders]
    by_root: Dict[str, List[dict]] = {}
    for s in snaps:
        if (s.get("folder_path") or "") in root_names:
            by_root.setdefault(s.get("folder_path") or "", []).append(s)
    if by_root:
        sec = ["📁 [ROOT FILES] — file direttamente nella radice delle cartelle monitorate (elenco COMPLETO, indicizzati come tutti gli altri):"]
        for rn in root_names:
            items = sorted(by_root.get(rn) or [], key=lambda r: r.get("name") or "")
            if not items:
                continue
            sec.append(f"  📂 {rn} ({len(items)} file root):")
            for r in items:
                sec.append(f"     • [ROOT] {r.get('name')} (mod. {(r.get('modified_time') or '?')[:10]}{'' if r.get('has_text') else ' · ⚠️ nessun testo estraibile'})")
        header_lines.extend(sec)

    # --- Scoring lessicale sul NOME (metadati) ---------------------------------
    months = [m for m in _MONTH_MAP_IT if m in msg_lc]
    for _mnum in re.findall(r"\b(0[1-9]|1[0-2])[/\-\.\s](20\d{2})\b", msg_lc):
        _mnum_int = int(_mnum[0])
        for _mname, _mval in _MONTH_MAP_IT.items():
            if _mval == _mnum_int and _mname not in months:
                months.append(_mname)
    years = re.findall(r"20\d{2}", msg_lc)
    keywords = [w for w in re.findall(r"[a-zA-Zàèéìòù0-9]{3,}", msg_lc) if w not in _DRIVE_TEACH_STOPWORDS]

    def _my_match(fname: str) -> bool:
        if not months and not years:
            return False
        f_low = (fname or "").lower()
        pats: List[str] = []
        for m in months:
            m2 = f"{_MONTH_MAP_IT[m]:02d}"
            pats.extend([m, f"-{m2}-", f"_{m2}_", f".{m2}.", f" {m2} "])
            for y in years:
                pats.extend([f"{y}{m2}", f"{m2}{y}", f"{y}-{m2}", f"{y}_{m2}", f"{y}.{m2}", f"{m2}-{y}", f"{m2}_{y}", f"{m2}.{y}"])
        if pats and any(p in f_low for p in pats):
            return True
        return bool(not months and years and any(y in f_low for y in years))

    def _score(s: Dict[str, Any]) -> int:
        name = (s.get("name") or "").lower()
        path = (s.get("folder_path") or "").lower()
        sc = 0
        for kw in keywords:
            if kw in name:
                sc += 3
            if kw in path:
                sc += 1
        if _my_match(name):
            sc += 2
        if (s.get("folder_path") or "") in root_names and sc > 0:
            sc += 1  # bonus pertinenza file root
        return sc

    scored = sorted(snaps, key=lambda s: (_score(s), s.get("modified_time") or ""), reverse=True)

    # 2) SELEZIONE: ChromaDB sul CONTENUTO (core.drive_retrieval) + lessicale sul nome come complemento
    _by_id = {s.get("file_id"): s for s in snaps}
    selected: List[str] = []
    _sem_chunks: Dict[str, List[str]] = {}
    try:
        _s0 = _time_mod.monotonic()
        _sem = await asyncio.to_thread(_core_drive_search, tenant, user_msg or "", max_pdfs)  # noqa: F821
        _core_stream_mark_phase("teach.drive.chroma", _time_mod.monotonic() - _s0)  # noqa: F821 — embedding query + ChromaDB
        if not _sem and any(s.get("has_text") for s in snaps):
            _schedule_drive_semantic_backfill(tenant)  # indice semantico vuoto ma snapshot con testo → costruiscilo in background
        selected = [r["file_id"] for r in _sem if r.get("score", 0) >= 0.25 and r["file_id"] in _by_id]
        _sem_chunks = {r["file_id"]: [c for c in (r.get("chunks") or []) if c] for r in _sem}  # V50.z569 — passaggi esatti (chunk completi)
        if _sem:
            header_lines.append("RICERCA SEMANTICA: " + "; ".join(f"{r['name']} ({r['score']:.2f})" for r in _sem[:max_pdfs]))
        # (tag 2026-10-19) rimossa la seconda ricerca ChromaDB «_sem2»: ridondante con la scansione deterministica qui sotto (−1 embedding)
    except Exception as _se:  # noqa: BLE001
        logger.warning("[drive-teach] semantic search failed: %s", _se)
    for s in scored:
        if len(selected) >= max_pdfs + 2:
            break
        if _score(s) > 0 and s.get("has_text") and s.get("file_id") not in selected:
            selected.append(s["file_id"])
    # V50.z578 — consumo numerico nella domanda: scansione DETERMINISTICA di TUTTI i file indicizzati (non solo i 4-6 scelti da ChromaDB).
    # Produzione 17/10: con ~129 listini CORPORATE CLUB la ricerca semantica non selezionava «Super Impresa Suite 1026.pdf» e la fascia
    # 0-10k (9.000 kWh) non arrivava mai al modello. I file che contengono una fascia per il consumo vanno in TESTA ai selezionati
    # (max 3, prima quelli con prezzo nella riga). Solo regex sul testo già in Mongo: nessuna rete, nessun modello.
    _kwh_sel = _core_drive_kwh_in_query(user_msg or "")  # noqa: F821
    if _kwh_sel:
        try:
            _s2 = _time_mod.monotonic()
            _band_hits: List[Any] = []
            async for _r in db.drive_snapshots.find({"user_id": tenant, "$or": [{"has_bands": True}, {"has_bands": {"$exists": False}, "text": {"$regex": "kwh", "$options": "i"}}]}, {"_id": 0, "file_id": 1, "text": 1}):  # tag 2026-10-19 — flag has_bands (snapshot) al posto della regex su tutto il testo; la regex resta solo per gli snapshot non ancora riletti
                _fid = _r.get("file_id")
                if _fid not in _by_id:
                    continue
                _rr = _core_drive_range_rows(_r.get("text") or "", _kwh_sel)  # noqa: F821
                if _rr:
                    _band_hits.append((sum(1 for _x in _rr if re.search(r"€|\bPUN\b|\bPSV\b", _x)), len(_rr), _fid))
            _band_hits.sort(key=lambda h: (h[0], h[1]), reverse=True)
            _pin = [h[2] for h in _band_hits[:3]]
            if _pin:
                selected = _pin + [f for f in selected if f not in _pin]
            _core_stream_mark_phase("teach.drive.fasce_scan", _time_mod.monotonic() - _s2)  # noqa: F821
            logger.info("[drive-fasce] scansione listini: %d file con fasce per %s → in testa: %s", len(_band_hits), _core_drive_format_kwh(_kwh_sel), ", ".join((_by_id.get(f) or {}).get("name") or "?" for f in _pin) or "nessuno")  # noqa: F821
        except Exception as _fe:  # noqa: BLE001
            logger.warning("[drive-fasce] scansione listini fallita: %s", _fe)
    if not selected:
        selected = [s["file_id"] for s in scored[:2] if s.get("has_text")]  # nessuna keyword pertinente: i più recenti con testo

    # Elenco sintetico (nomi) per permettere a Axon di citare cosa esiste
    listing = []
    for s in snaps[:40]:
        p = s.get("folder_path") or ""
        listing.append(f"  • {'[ROOT] ' if p in root_names else ''}{(p + '/') if p else ''}{s.get('name') or '?'}")
    header_lines.append("ELENCO FILE (max 40, più recenti prima):\n" + "\n".join(listing))

    # 3) TESTO dei SOLI file selezionati (una query, max_pdfs + 2 documenti)
    blocks: List[str] = []
    _fasce_risolte: List[Any] = []  # V50.z575 — [(display, rows)]
    _kwh_q = _core_drive_kwh_in_query(user_msg or "")  # noqa: F821 — V50.z573 consumo numerico nella domanda (None se assente)
    _rule_hits: List[Any] = []  # tag 2026-10-19 — regole listino a soglie fisse: se c'è un hit PREVALE (bypass semantico, niente righe-documento)
    if _kwh_q:
        try:
            _rules_doc = await db.axon_config.find_one({"key": "listino_rules"}, {"_id": 0, "rules": 1})
            _rules = (_rules_doc or {}).get("rules") or _LISTINO_RULES_DEFAULT
            _rule_hits = [r for r in _rules if float(r.get("min", 0)) <= _kwh_q <= float(r.get("max", 1e15))]
        except Exception as _re_exc:  # noqa: BLE001
            logger.warning("[drive-fasce] regole listino non lette: %s", _re_exc)
    if selected:
        _t0 = _time_mod.monotonic()
        try:
            rows = await db.drive_snapshots.find({"user_id": tenant, "file_id": {"$in": selected[: max_pdfs + 2]}}, {"_id": 0, "file_id": 1, "text": 1}).to_list(max_pdfs + 2)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[drive-teach] text query failed: %s", exc)
            rows = []
        _core_stream_mark_phase("teach.drive.text", _time_mod.monotonic() - _t0)  # noqa: F821 — testo dei soli file scelti
        text_by_id = {r["file_id"]: (r.get("text") or "").strip() for r in rows}
        if _rule_hits:  # tag 2026-10-19 — BYPASS SEMANTICO: con una regola listino valida i testi dei documenti NON entrano nel prompt
            selected = []  # (il modello non deve poter preferire una riga del PDF alla regola)
        for fid in selected[: max_pdfs + 2]:
            s = _by_id.get(fid) or {}
            txt = text_by_id.get(fid) or ""
            if not txt:
                continue
            p = s.get("folder_path") or ""
            display = f"{p}/{s.get('name')}" if p else (s.get("name") or "documento")
            tag = " [ROOT]" if p in root_names else ""
            # V50.z569 — prima i PASSAGGI PERTINENTI (chunk completi scelti da ChromaDB, anche oltre gli 8.000 caratteri), poi l'inizio del documento
            _ex = [c for c in _sem_chunks.get(fid) or [] if c not in txt[:6000]]
            # V50.z575 — FASCIA RISOLTA: il retrieval risolve MATEMATICAMENTE la fascia PRIMA del modello e la inietta come FATTO
            # già constatato (non come istruzione): il modello legge e cita, nessun calcolo. Log «[drive-fasce] FASCIA RISOLTA» per audit.
            _fascia_block = ""
            if _kwh_q and not _rule_hits:
                _rows = _core_drive_range_rows(txt, _kwh_q)  # noqa: F821
                if _rows:
                    _fascia_block = "".join(f"FASCIA RISOLTA: {r}\n" for r in _rows) + "\n"
                    _fasce_risolte.append((display, _rows))
            _ex_block = ("PASSAGGI PERTINENTI ALLA DOMANDA (testo esatto dal documento, usa QUESTI valori):\n" + "\n…\n".join(_ex) + "\n\nINIZIO DOCUMENTO:\n") if _ex else ""
            if _fascia_block and not _ex:
                _ex_block = "INIZIO DOCUMENTO:\n"
            blocks.append(f"--- File Drive{tag}: {display} (modificato: {s.get('modified_time') or '?'}) ---\n{_fascia_block}{_ex_block}{txt[:6000 if (_ex or _fascia_block) else 8000]}")

    out = "\n".join(header_lines)
    # tag 2026-10-19 — LOOKUP DETERMINISTICO LISTINI (bypass semantico): consumo nella domanda → regole a soglie fisse
    # (db.axon_config key «listino_rules», default _LISTINO_RULES_DEFAULT) → «FASCIA RISOLTA (REGOLA LISTINO)» in TESTA, prima di tutto.
    if _kwh_q and _rule_hits:
        try:
            _hits = _rule_hits
            if _hits:
                _lbl = _core_drive_format_kwh(_kwh_q)  # noqa: F821
                _lines = [f"✅ FASCIA RISOLTA (REGOLA LISTINO) per {_lbl} — corrispondenza matematica a soglie fisse, dato CERTO e PREVALENTE su qualsiasi riga dei documenti: cita offerta, spread, fisso e fonte ESATTAMENTE così come sono qui sotto (pagina inclusa), nessun calcolo, nessuna altra cifra."]
                for r in _hits:
                    _lines.append(f"FASCIA RISOLTA: {r.get('offer')} — consumo {_core_drive_format_kwh(float(r.get('min', 0)))} ÷ {_core_drive_format_kwh(float(r.get('max', 0)))} — Spread {r.get('spread')}"  # noqa: F821
                                  + (f" | Fisso {r['fixed']}" if r.get("fixed") else "") + f" — Fonte: {r.get('source')}")
                out = "\n".join(_lines) + "\n\n" + out
                logger.info("[drive-fasce] regola listino: %s → %s", _lbl, "; ".join(r.get("offer", "") for r in _hits))
        except Exception as _re_exc:  # noqa: BLE001
            logger.warning("[drive-fasce] regole listino non applicate: %s", _re_exc)
    if _kwh_q and _fasce_risolte:
        # In TESTA alla sezione Drive (prima dell'elenco file e dei testi, che possono essere lunghi): fatto già risolto dal sistema
        _kwh_lbl = _core_drive_format_kwh(_kwh_q)  # noqa: F821
        _top = [f"✅ FASCIA RISOLTA DAL SISTEMA per il consumo indicato ({_kwh_lbl}) — dato già verificato matematicamente ({_kwh_lbl} è compreso nell'intervallo): CITALA così com'è, nessun calcolo da fare, non dire «non trovo»."]
        for _disp, _rows in _fasce_risolte:
            for _r in _rows:
                _top.append(f"FASCIA RISOLTA: {_r} — Fonte: {_disp}")
        out = "\n".join(_top) + "\n\n" + out
        logger.info("[drive-fasce] consumo=%s → %s", _kwh_lbl, " || ".join(f"FASCIA RISOLTA: {r[:120]} ({d})" for d, rs in _fasce_risolte for r in rs[:2]))
    elif _kwh_q:
        logger.info("[drive-fasce] consumo=%s → nessuna fascia DA X A Y nei %d file selezionati", _core_drive_format_kwh(_kwh_q), len(selected))  # noqa: F821
    if blocks:
        out += "\n\nCONTENUTO DEI FILE PIÙ PERTINENTI:\n\n" + "\n\n".join(blocks)
    return out



# =========================================================================
