# 21_axon_streaming.py — AxonOS: streaming SSE + semantic cache + chat endpoint
# Estratto da server.py (righe originali 13733-15107). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V40 — Streaming + Semantic Cache for Axon AI Assistant
#
# 1) Semantic Cache: global cache keyed by tokenised question. When a new
#    question has Jaccard similarity ≥ SEM_CACHE_JACCARD_THRESHOLD (0.85) to
#    a previously answered question, return the cached reply INSTANTLY (no
#    LLM call). TTL 7 days. Only knowledge-based queries are eligible.
#
# 2) Streaming: /assistant/chat/stream emits Server-Sent Events (SSE) with
#    token-by-token deltas as they arrive from the LLM. Cache hits also
#    stream (chunked) so the UI code path is uniform.
# =========================================================================

SEM_CACHE_JACCARD_THRESHOLD = 0.75  # calibrated for Italian queries (≈ 0.92 embedding cosine)
SEM_CACHE_TTL_DAYS = 7
SEM_CACHE_CANDIDATE_LIMIT = 200  # scan most-recent N entries when matching

_ITALIAN_STOPWORDS = {
    "a","ad","al","alla","alle","agli","allo","ai","e","ed","è","ma","o","od",
    "di","del","dei","della","delle","dello","degli","da","dal","dalla","dalle",
    "dagli","dallo","dai","in","nel","nella","nelle","nello","negli","nei","con",
    "su","sul","sulla","sulle","sullo","sugli","sui","per","tra","fra",
    "il","lo","la","i","gli","le","un","uno","una","un'",
    "che","chi","cui","non","né","sé","si","se","si","sì","no",
    "mi","ti","ci","vi","lo","la","li","le","ne","me","te","se",
    "come","quando","dove","quale","quali","quanto","quanti","quanta","quante",
    "cosa","perché","perche","ecco","allora","poi","anche","già","ancora",
    "molto","poco","tutto","tutti","tutte","tutta","altro","altra","altri","altre",
    "essere","sono","sei","siamo","siete","sia","sia","era","ero","eri","fu","fui",
    "avere","ho","hai","ha","abbiamo","avete","hanno","aveva","avevo","avevi",
    "sarà","sarai","saremo","sarete","saranno","farò","farai","farà","faremo",
    "questo","questa","questi","queste","quello","quella","quelli","quelle",
    "mio","mia","miei","mie","tuo","tua","tuoi","tue","suo","sua","suoi","sue",
    "nostro","nostra","nostri","nostre","vostro","vostra","vostri","vostre",
    "loro","è","fa","sta","va","dà",
    "please","per favore","grazie","ciao",
}

# Tokens that signal a *user-specific* / *live-data* query. When the question
# contains any of these, the semantic cache is bypassed (global cache would
# return stale/wrong data for CRM-bound queries).
_CACHE_SKIP_TOKENS = {
    # Time-bound (dynamic)
    "oggi","ieri","domani","adesso","ora","stasera","stamattina","stanotte","stamane",
    "settimana","mese","anno","stamane","corrente","attuale","attualmente",
    # Personal / CRM-bound
    "mio","mia","miei","mie","io","me","noi","nostro","nostra","nostri","nostre",
    "cliente","clienti","contatto","contatti","referente","referrer","segnalatore",
    "appuntamento","appuntamenti","telefonata","telefonate","chiamata","chiamate",
    "scadenza","scadenze","promemoria","reminder","richiama","ritelefonata","ritelefonate",
    "bolletta","bollette","contratto","contratti","offerta","offerte","proposta","proposte",
    # Weather (dynamic)
    "meteo","tempo","piove","piover","pioggia","nuvoloso","soleggiato","temperatura","previsioni",
    # Quantitative / listing (user-specific)
    "quanti","quante","quanto",
    # V50.z359 — Stato sistema / versioni / novità: dati DINAMICI (changelog, build, backend) → mai dalla cache
    "versione","versioni","novita","novità","changelog","aggiornamento","aggiornamenti","aggiornata","aggiornato","build","backend","release","rilascio","rilasciate","rilasciata",
    "stato","sistema","uptime","deploy","heartbeat","installata","installato","nuovo","nuove","nuova","nuovi","visto","letto","senti","pensi",
}

def _normalize_and_tokenize(text: str) -> Tuple[str, List[str]]:
    """Normalize text and extract a stable token set for semantic cache matching.
    Returns (normalized_string, sorted_unique_tokens_without_stopwords)."""
    import re, unicodedata
    if not text:
        return ("", [])
    # strip diacritics
    s = unicodedata.normalize("NFKD", text)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    # replace non-alnum with space (keep numbers - PUN, ARERA numbers, months)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    tokens = [t for t in s.split() if len(t) > 1 and t not in _ITALIAN_STOPWORDS]
    # deduplicate + stable order
    uniq = sorted(set(tokens))
    return (" ".join(tokens), uniq)


def _jaccard(a: List[str], b: List[str]) -> float:
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def _is_query_cacheable(msg: str, has_attachments: bool, has_history: bool) -> bool:
    """Return True if the question is eligible for the *global* semantic cache.
    We deliberately exclude anything that touches live CRM/weather data since
    the cache is global (shared across tenants)."""
    if has_attachments or has_history:
        return False
    if not msg or len(msg) < 12:  # too short → not worth caching
        return False
    _, tokens = _normalize_and_tokenize(msg)
    if not tokens or len(tokens) < 3:
        return False
    # If any skip-token is present → bypass cache
    if any(t in _CACHE_SKIP_TOKENS for t in tokens):
        return False
    _info = globals().get("_nav_is_info_query"); _topic = globals().get("_RX_INFO_TOPIC"); _time = globals().get("_RX_INFO_TIME")  # V50.z443/z445 — fatti attuali: MAI dalla cache
    if _info and _info(msg) and ((_time and _time.search(msg)) or (_topic and _topic.search(msg))):
        return False
    return True


_AXON_LANG_NAMES = {"it": "italiano", "en": "inglese", "es": "spagnolo", "fr": "francese", "de": "tedesco", "pt": "portoghese", "ro": "rumeno", "uk": "ucraino", "ar": "arabo", "zh": "cinese"}  # V50.z271

async def _semantic_cache_lookup(msg: str, tenant: Optional[str] = None, product: str = "advisor") -> Optional[dict]:
    """Search the semantic cache for a similar previously-answered question.
    V50.k — TENANT-SHARED cache: cerca prima nel cache del tenant (condiviso
    tra tutti i collaboratori dello stesso Master), poi fallback al cache
    globale legacy. Returns the cached doc (with `reply`, `web_sources`, ...)
    on hit, or None on miss. Skips expired entries defensively."""
    _, tokens = _normalize_and_tokenize(msg)
    if not tokens:
        return None
    now = utcnow()
    # V50.z327 — Axon Core: la cache è per prodotto (advisor | lite); le voci legacy senza `product` valgono per advisor
    prod_q = {"product": product} if product != "advisor" else {"product": {"$in": [None, "advisor"]}}
    # First: try tenant-scoped cache (highest priority)
    if tenant:
        cursor = db.axon_semantic_cache.find(
            {"expires_at": {"$gt": now}, "tenant_id": tenant, **prod_q},
            {"_id": 0},
        ).sort("created_at", -1).limit(SEM_CACHE_CANDIDATE_LIMIT)
        best = None
        best_score = 0.0
        async for doc in cursor:
            cand_tokens = doc.get("tokens") or []
            score = _jaccard(tokens, cand_tokens)
            if score >= SEM_CACHE_JACCARD_THRESHOLD and score > best_score:
                best = doc
                best_score = score
        if best is not None:
            best["_similarity"] = round(best_score, 3)
            return best
    # Fallback: legacy global cache (entries without tenant_id)
    cursor = db.axon_semantic_cache.find(
        {"expires_at": {"$gt": now}, "tenant_id": {"$in": [None, ""]}, **prod_q},
        {"_id": 0},
    ).sort("created_at", -1).limit(SEM_CACHE_CANDIDATE_LIMIT)
    best = None
    best_score = 0.0
    async for doc in cursor:
        cand_tokens = doc.get("tokens") or []
        score = _jaccard(tokens, cand_tokens)
        if score >= SEM_CACHE_JACCARD_THRESHOLD and score > best_score:
            best = doc
            best_score = score
    if best is not None:
        best["_similarity"] = round(best_score, 3)
    return best


async def _semantic_cache_save(
    msg: str,
    reply: str,
    used_web_search: bool,
    web_sources: List[dict],
    assistant_name: str,
    tenant: Optional[str] = None,
    product: str = "advisor",
) -> None:
    """Persist a Q/A pair into the semantic cache with TTL.
    V50.k — Salva con `tenant_id` per abilitare cache condiviso tra
    collaboratori dello stesso Master (risposta istantanea alla seconda
    chiamata di qualunque membro del team)."""
    if not reply:
        return
    _, tokens = _normalize_and_tokenize(msg)
    if not tokens:
        return
    now = utcnow()
    expires_at = now + timedelta(days=SEM_CACHE_TTL_DAYS)
    try:
        await db.axon_semantic_cache.insert_one({
            "cache_id": uuid.uuid4().hex,
            "tenant_id": tenant or None,
            "product": product,  # V50.z327 — Axon Core
            "question": msg[:1000],
            "tokens": tokens,
            "reply": reply,
            "used_web_search": bool(used_web_search),
            "web_sources": web_sources or [],
            "assistant_name": assistant_name,
            "created_at": now,
            "expires_at": expires_at,
        })
    except Exception as exc:
        logger.warning("[axon-semcache] save failed: %s", exc)


# V50.k — Router modello: sceglie Haiku (veloce, 1-2s) vs Sonnet 4.5 (potente,
# 6-8s) in base a lunghezza/keyword/allegati. Zero LLM call, solo euristica.
_HEAVY_KEYWORDS = {
    "tabella", "tabelle", "confronta", "confronto", "analizza", "analisi",
    "calcola", "calcolo", "riepiloga", "riepilogo", "elenca", "elenco",
    "listino", "listini", "pun", "f1", "f2", "f3", "monorario",
    "bolletta", "bollette", "fattura", "fatture", "contratto", "contratti",
    "scadenza", "scadenze", "delibera", "arera", "gme",
    "cluster", "insights", "profilo", "profilazione",
    "genera", "crea report", "esporta", "confronto",
}


# V50.z413 — CONTESTO CONDIZIONALE: classe della domanda → cosa mettere nel prompt e quale modello usare.
#   "simple": ora/data, meteo, saluti/ringraziamenti, domotica, «chi sei», ripeti/leggi, sì/no brevi → prompt minimo
#             (identità + regole + ora, NIENTE snapshot CRM, omniscienza, KB/RAG, teach, script, navigatore) + Haiku 4.5.
#   "crm":    nomi/clienti/contatti/appuntamenti/numeri → contesto CRM completo, modello via _pick_axon_model.
#   "full":   analisi, contratti, documenti, allegati → tutto + Sonnet 4.5.
import re as _qc_re
_QC_SIMPLE_RX = _qc_re.compile(
    r"^(ciao|buongiorno|buonasera|buonanotte|salve|hey|ehi|ok|okay|grazie|grazie mille|perfetto|bene|va bene|d'accordo|"
    r"sì|si|no|esatto|certo|ottimo|bravo|brava|a dopo|a presto|arrivederci)\b[\s!.,]*$|"
    r"\b(che or[ae] (sono|è|e)|che giorno è|che data è|in che (giorno|mese|anno) siamo|quanto manca a|"
    r"che tempo fa|meteo|previsioni|piove|pioverà|nevica|temperatura fuori|gradi ci sono)\b|"
    r"\b(accendi|spegni|abbassa|alza|apri|chiudi) (la |le |il |lo |i |gli |l')?(luce|luci|lampad|termostato|riscaldamento|tapparell|tenda|tende|musica|tv|televisore|volume|allarme|caldaia|condizionat)|"
    r"\b(chi sei|come ti chiami|cosa sai fare|cosa puoi fare|come stai|sei sveglio|ci sei|mi senti|ripeti|ripetilo|leggi di nuovo|"
    r"parla più (piano|forte|lentamente|veloce)|racconta(mi)? una barzelletta|dimmi una curiosità)\b",
    _qc_re.I)
_QC_CRM_HINTS = {"cliente", "clienti", "contatto", "contatti", "appuntamento", "appuntamenti", "agenda", "calendario", "ritelefon", "richiam",
                 "contratto", "contratti", "bolletta", "fattura", "pun", "listino", "offerta", "preventivo", "scadenz", "lead", "provvigion",
                 "pratica", "pratiche", "kpi", "vendite", "fatturato", "documento", "documenti", "pdf", "drive", "tabella", "storico", "cerca", "trova"}


def _axon_query_class(msg: str, has_attachments: bool) -> str:
    txt = (msg or "").strip()
    low = txt.lower()
    if has_attachments or len(txt) > 320:
        return "full"
    if len(txt) <= 120 and _QC_SIMPLE_RX.search(low) and not any(k in low for k in _QC_CRM_HINTS):
        return "simple"
    return "crm"


def _pick_axon_model(msg: str, has_attachments: bool, has_rag_context: bool, has_web: bool) -> str:
    """Ritorna 'haiku' o 'sonnet' basato su euristica veloce.
    V50.z26 — Preferiamo Haiku 4.5 anche per query pesanti quando i dati sono
    già nel contesto (RAG teach snapshot / tavily) perché servono solo per
    FORMATTARE una tabella, non per ragionare. Haiku 4.5 emette il primo
    token in <1s vs 4-6s di Sonnet 4.5 → risposta streaming subito visibile.
    Sonnet resta forzato solo per: allegati (analisi documenti), messaggi
    lunghi (>320 char = domanda complessa), o keyword di ANALISI/RAGIONAMENTO.
    """
    if has_attachments:
        return "sonnet"
    txt = (msg or "").strip().lower()
    if len(txt) > 320:
        return "sonnet"
    # Solo keyword di ragionamento profondo, NON di formattazione:
    # "tabella", "pun", "f1/f2/f3", "listino" → basta Haiku (formattazione).
    # "analizza", "confronta", "cluster", "insights" → serve Sonnet.
    _REASONING = {"analizza", "analisi", "confronta", "confronto", "cluster",
                  "insights", "profilazione", "riepiloga", "riepilogo",
                  "calcola percentuale", "trend", "previsione", "spiegami"}
    if any(k in txt for k in _REASONING):
        return "sonnet"
    return "haiku"


async def _prepare_assistant_prompt(
    user: dict, body: "AssistantChatIn"
) -> dict:
    """Build the full prompt payload for an assistant chat request.
    Returns a dict with system_message, user_prompt, session_id, assistant_name,
    used_web_search, web_sources, history_len, msg, has_attachments."""
    msg = (body.message or "").strip()
    if not msg and body.attachments:
        # V50.z437 — Bug B: allegato (foto/documento) inviato SENZA testo → prima 400 «Messaggio vuoto» e l'app ripiegava su una
        # risposta non pertinente. Ora la richiesta implicita è «analizza l'allegato».
        msg = _implicit_attachment_prompt(body.attachments, body.merge_images is not False)  # V50.z438 — foto multiple → unico documento
    if not msg:
        raise HTTPException(status_code=400, detail="Messaggio vuoto")
    if len(msg) > 4000:
        raise HTTPException(status_code=400, detail="Messaggio troppo lungo (max 4000 caratteri)")

    key = _axon_llm_key("anthropic")  # V50.z511 — ANTHROPIC_API_KEY diretta (litellm) se presente, altrimenti EMERGENT_LLM_KEY
    if not key:
        raise HTTPException(status_code=500, detail="Nessuna chiave LLM configurata (ANTHROPIC_API_KEY o EMERGENT_LLM_KEY)")

    assistant_name = await _get_assistant_name(user)
    # V50.z271 — lingua scelta dall'utente (pagina «Voce e lingua di Axon»)
    _lang_row = await db.user_settings.find_one({"user_id": user["user_id"]}, {"assistant_language": 1}) or {}
    assistant_language = _AXON_LANG_NAMES.get((_lang_row.get("assistant_language") or "it").lower(), "italiano")
    session_id = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"

    # Load recent conversation history from DB (last 12 messages)
    hist_cursor = db.assistant_messages.find(
        {"user_id": user["user_id"], "session_id": session_id},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", -1).limit(12)
    history = [h async for h in hist_cursor]
    history.reverse()

    # V50.b — PARALLELIZE preflight I/O per ridurre drasticamente il tempo di
    # prompt-building. Prima queste operazioni erano sequenziali (context →
    # weather → RAG prefetch → tavily → memories → attachments → teach section),
    # con ogni step che poteva impiegare 1-5s. Ora vengono lanciate insieme.
    weather_city = _detect_weather_query(msg)
    _tenant_id_val = tenant_id(user)

    # V50.z413 — classe della domanda: per «simple» i costruttori pesanti (snapshot CRM, omniscienza, KB, RAG, teach) NON girano
    query_class = _axon_query_class(msg, bool(body.attachments))
    _simple = query_class == "simple"

    async def _safe_context():
        if _simple:
            return {"ora_attuale": _fmt_dt_it(utcnow()), "utente": {"nome": user.get("name") or user.get("email") or ""}}  # noqa: F821
        try:
            return await _build_assistant_context(user)
        except Exception as e:
            return {"error": f"Impossibile caricare i dati CRM: {e}"}

    async def _safe_weather():
        if weather_city and weather_city != "?":
            try:
                return await _fetch_weather(weather_city)
            except Exception:
                return None
        return None

    async def _safe_rag_prefetch():
        if _simple:
            return []
        try:
            return await _retrieve_master_doc_chunks(_tenant_id_val, msg)
        except Exception:
            return []

    async def _safe_memories():
        if _simple:
            return []
        try:
            return await _load_neo_memories(user["user_id"], limit=5)
        except Exception:
            return []

    async def _safe_attachments():
        return await _build_attachments_section_advanced(msg, body.attachments or [], merge_images=body.merge_images is not False)

    async def _safe_teach_section():
        if _simple:
            return ""
        try:
            return await _build_axon_teach_section(_tenant_id_val, msg)
        except Exception as exc:
            logger.warning("[axon-teach] section build failed: %s", exc)
            return ""

    # V50.z33 — Tavily nel gather principale (prima era sequenziale dopo).
    # Se non è una query energy, ritorna None subito (nessuna latenza).
    _needs_energy = _detect_energy_query(msg)
    _needs_tavily = _needs_energy or _axon_wants_general_web(user, msg)  # noqa: F821 — V50.z440 axon_persona.py
    logger.info("[web-search] «%s» → energy=%s info=%s persona=%s tavily=%s", (msg or "")[:70], _needs_energy,  # V50.z445 — decisione sempre tracciata
                bool(globals().get("_nav_is_info_query") and _nav_is_info_query(msg)), _axon_persona(user), "SI" if _needs_tavily else "NO")  # noqa: F821
    async def _safe_tavily():
        if not _needs_tavily:
            return None
        try:
            res = await _tavily_search_smart(msg, _needs_energy)
            if not res:
                logger.warning("[tavily] nessun risultato/ricerca non eseguita per «%s» (chiave mancante o errore: vedi log [tavily])", (msg or "")[:80])
            return res
        except Exception as exc:  # noqa: BLE001
            logger.error("[tavily] eccezione per «%s»: %s", (msg or "")[:80], exc)
            return None

    # V50.kb — Ricerca automatica nella Knowledge Base personale (pagine web salvate dall'utente).
    async def _safe_kb():
        if _simple:
            return ""
        try:
            return await _build_kb_section(_tenant_id_val, msg)
        except Exception as exc:
            logger.debug("[axon-kb] section build failed: %s", exc)
            return ""

    # V50.z180 — Axon vede TUTTE le sezioni dell'app (dati completi + schede dei contatti citati + mappa app)
    async def _safe_omni():
        if _simple:
            return ""
        try:
            return await _build_crm_omniscience_section(user, msg)
        except Exception as exc:
            logger.warning("[axon-omni] section failed: %s", exc)
            return ""

    context, weather_ctx, _prefetch_rag_chunks, memories, attachments_section, axon_teach_section, web_search_ctx, kb_section, omni_section = await asyncio.gather(
        _safe_context(),
        _safe_weather(),
        _safe_rag_prefetch(),
        _safe_memories(),
        _safe_attachments(),
        _safe_teach_section(),
        _safe_tavily(),
        _safe_kb(),
        _safe_omni(),
    )

    # V50.z51 — PINNED rules + tenant memory (rewrite architettura memoria).
    # Recuperate in parallelo per non aggiungere latenza al preflight.
    try:
        _pinned_section, _tenant_mem_section = await asyncio.gather(
            _build_pinned_rules_section(_tenant_id_val, msg),
            _load_tenant_memory_section(_tenant_id_val),
        )
    except Exception:
        _pinned_section, _tenant_mem_section = "", ""

    _msg_low = (msg or "").lower()
    _is_table_query = any(k in _msg_low for k in ["tabella", "per fascia", "f1", "f2", "f3", "monorario", "media pun", "pun medi"])
    _rag_covers_query = bool(_prefetch_rag_chunks) and (_is_table_query or ("pun" in _msg_low))

    # Se il RAG copre la query, scarta Tavily (evita rumore) e disattiva flag web.
    used_web_search = False
    if _rag_covers_query:
        web_search_ctx = None
    elif web_search_ctx and (web_search_ctx.get("answer") or web_search_ctx.get("results")):
        used_web_search = True
    else:
        web_search_ctx = None

    # V42 — RAG on Master documents (per-tenant knowledge base)
    rag_section = ""
    try:
        # V49.p — Riusa i chunk già prefetched (evita doppia query Mongo).
        _prefetched = locals().get("_prefetch_rag_chunks")
        rag_chunks = _prefetched if _prefetched else await _retrieve_master_doc_chunks(tenant_id(user), msg)
        if rag_chunks:
            rag_section = (
                "\n\nDOCUMENTI MASTER (base di conoscenza personale del Master — usa questi estratti "
                "come FONTE PRIMARIA. Se contengono i dati richiesti (es. tabelle PUN, listini, "
                "valori per fascia F1/F2/F3), RISPONDI CON QUEI DATI senza cercare altrove e senza "
                "dichiarare che i dati mancano):\n"
            )
            for i, c in enumerate(rag_chunks, 1):
                dname = c.get("doc_name") or "?"
                pg = c.get("page_number") or 0
                score = c.get("_score", 0.0)
                content = (c.get("content") or "")[:2000]
                # V50.z144 — voci testuali (FAQ/Dati/Nota) mostrano la categoria invece della pagina
                _where = f"pagina {pg}" if (c.get("doc_kind") or "pdf") == "pdf" else (c.get("doc_category") or "Nota")
                rag_section += (
                    f"\n--- Estratto {i} da \"{dname}\" ({_where}, rilevanza {score:.2f}) ---\n"
                    f"{content}\n"
                )
            rag_section += (
                "\nCita il nome del documento quando produci prosa (es. «Listino Optima 2026»). "
                "Quando produci una TABELLA, NON aggiungere note sulle fonti — solo la tabella pura.\n"
            )
    except Exception as exc:
        logger.warning("[axon-rag] retrieval failed: %s", exc)
        rag_section = ""


    import json as _json
    ctx_json = _json.dumps(context, ensure_ascii=False, default=str)
    if len(ctx_json) > 25000:
        ctx_json = ctx_json[:12000] + "\n... (dati troncati)"

    weather_section = ""
    if weather_ctx is not None:
        weather_section = (
            "\n\nMETEO (dati aggiornati, timezone Europe/Rome — DATO FORNITO DAL SISTEMA perché il messaggio dell'utente contiene una richiesta meteo esplicita; "
            "se in realtà l'utente NON ha chiesto del meteo, IGNORA questa sezione e non parlarne):\n"
            f"{_json.dumps(weather_ctx, ensure_ascii=False, default=str)}\n"
            "Usa questi dati per rispondere in modo naturale alla domanda meteo. "
            "Se l'utente chiede un momento specifico (oggi pomeriggio, domani mattina, ecc.) "
            "cita la temperatura, la condizione (es. sereno, pioggia leggera) e la probabilità di pioggia se rilevante.\n"
        )
    elif weather_city == "?":
        weather_section = (
            "\n\nAVVISO (dal sistema): il messaggio contiene una richiesta meteo esplicita senza città. "
            "SOLO se l'utente sta davvero chiedendo del meteo, chiedi per quale città; altrimenti ignora questo avviso.\n"
        )

    web_section = ""
    if _needs_tavily and not used_web_search and not _rag_covers_query:  # V50.z444 — ricerca necessaria ma fallita/assente: Axon NON deve attingere alla memoria
        web_section = ("\n\nRICERCA WEB AGGIORNATA: NON DISPONIBILE per questa domanda (servizio di ricerca non configurato o nessun risultato). "
                       "Per fatti attuali (borsa, prezzi, notizie, sport, eventi) rispondi ESATTAMENTE «Non ho dati aggiornati su questo.» e fermati.\n")
    if web_search_ctx and used_web_search:
        web_section = (
            "\n\nRICERCA WEB AGGIORNATA (dati reali dal mercato energetico italiano):\n"
            f"Query utente: {web_search_ctx.get('query')}\n"
            f"Risposta sintetizzata (Tavily): {web_search_ctx.get('answer') or 'nessuna sintesi'}\n"
            "Fonti primarie (usa questi contenuti come base per la tua risposta):\n"
        )
        for i, r in enumerate(web_search_ctx.get("results", [])[:5], 1):
            web_section += f"[{i}] {r.get('title')} — {r.get('url')}\n{r.get('content')}\n\n"
        web_section += (
            "REGOLE per usare questi dati:\n"
            "- Cita i numeri esatti (€/MWh, €/kWh, mesi, delibere ARERA con numero e data).\n"
            "- NON rimandare l'utente a siti esterni. Rispondi TU con la risposta.\n"
            "- Se i dati sono aggiornati a un mese specifico, dillo (es. 'PUN novembre 2026').\n"
            "- Se la ricerca non ha trovato dati precisi, dillo apertamente.\n"
        )

    memory_section = ""
    if memories:
        memory_section = "\n\nMEMORIA PERSISTENTE (contesto delle conversazioni precedenti):\n"
        for m in memories[:3]:  # V50.z421 — consolidamento: 3 memorie, sintesi ≤220 car., max 4 fatti ≤120 car.
            memory_section += f"- {str(m.get('summary', ''))[:220]}\n"
            for f in (m.get("facts") or [])[:4]:
                memory_section += f"  • {str(f)[:120]}\n"
        memory_section += "Usa la memoria per personalizzare, senza citare «ricordo che…» se non utile.\n"

    # V49.n — Few-shot dinamico basato sui feedback 👍/👎 del tenant.
    # Carica gli ultimi 5 esempi con 👍 (best answers da imitare) e gli ultimi
    # 2 con 👎 (anti-esempi da evitare). Iniezione leggera, solo Q+A troncati.
    few_shot_section = ""
    try:
        if _simple:
            raise StopIteration  # V50.z413 — nessun few-shot per domande semplici
        _fs_tid = tenant_id(user)
        _fs_ups_cur = db.assistant_feedback.find(
            {"tenant_id": _fs_tid, "rating": "up"},
            {"_id": 0, "question": 1, "reply": 1},
        ).sort("created_at", -1).limit(5)
        _fs_downs_cur = db.assistant_feedback.find(
            {"tenant_id": _fs_tid, "rating": "down"},
            {"_id": 0, "question": 1, "reply": 1, "comment": 1},
        ).sort("created_at", -1).limit(2)
        _fs_ups = [d async for d in _fs_ups_cur]
        _fs_downs = [d async for d in _fs_downs_cur]
        if _fs_ups or _fs_downs:
            _fs_lines: List[str] = ["\n\nESEMPI DI RISPOSTE (feedback storico del tenant):"]
            if _fs_ups:
                _fs_lines.append("👍 Esempi apprezzati — imita QUESTO stile/tono/dettaglio:")
                for _fs_i, _fs_ex in enumerate(_fs_ups, 1):
                    _fs_q = (_fs_ex.get("question") or "").strip()[:180]
                    _fs_a = (_fs_ex.get("reply") or "").strip()[:280]
                    if _fs_q and _fs_a:
                        _fs_lines.append(f"  {_fs_i}) Domanda: {_fs_q}")
                        _fs_lines.append(f"     Risposta ottima: {_fs_a}")
            if _fs_downs:
                _fs_lines.append("👎 Esempi NON apprezzati — evita QUESTI pattern:")
                for _fs_i, _fs_ex in enumerate(_fs_downs, 1):
                    _fs_q = (_fs_ex.get("question") or "").strip()[:180]
                    _fs_a = (_fs_ex.get("reply") or "").strip()[:220]
                    _fs_cm = (_fs_ex.get("comment") or "").strip()[:120]
                    if _fs_q and _fs_a:
                        _fs_lines.append(f"  {_fs_i}) Domanda: {_fs_q}")
                        _fs_lines.append(f"     Risposta da NON riprodurre: {_fs_a}")
                        if _fs_cm:
                            _fs_lines.append(f"     Motivo del 👎: {_fs_cm}")
            _fs_lines.append("Applica il TONO e la STRUTTURA degli esempi 👍; evita difetti di quelli 👎.")
            few_shot_section = "\n".join(_fs_lines) + "\n"
    except Exception as _fs_exc:
        logger.debug("[few-shot] skipped: %s", _fs_exc)
        few_shot_section = ""

    system_message = (
        _axon_core_identity(user, assistant_name) +  # V50.z323 — Axon Core: identità per prodotto (advisor | lite)
        # V50.z309 — REGOLE CORE CONSOLIDATE (stesso comportamento, ~60% più corte: eliminati doppioni e ripetizioni)
        _axon_core_rules(assistant_language, msg) +  # V50.z421 — regole core: blocchi mercato/Drive/tabelle/grafici solo se pertinenti al messaggio
        f"ORA ATTUALE: {context.get('ora_attuale', '')}\n\n"
        "SNAPSHOT_CRM (JSON):\n"
        f"{ctx_json}\n"
        f"{omni_section}"
        f"{weather_section}"
        f"{axon_teach_section}"
        f"{rag_section}"
        f"{kb_section}"
        f"{memory_section}"
        f"{web_section}"
        f"{few_shot_section}"
        f"{attachments_section}"
    )

    # V50.w — Iniezione Axon Brain (memoria distillata + profilo appreso)
    try:
        _brain = await _load_axon_brain(user["user_id"])
        _brain_section = _brain_section_for_prompt(_brain)
    except Exception:
        _brain_section = ""
    try:
        _scripts_section = await _load_scripts_index(tenant_id(user))
    except Exception:
        _scripts_section = ""
    try:
        _cheat_section = await _cheatsheet_section_for_prompt(user["user_id"])
    except Exception:
        _cheat_section = ""
    # V50.z8 — Elenca cartelle Drive collegate + connessioni cloud attive.
    # Axon deve sapere di essere COLLEGATO al Drive del Master.
    _cloud_section = ""
    try:
        # V50.z155 — Collaboratori: le connessioni cloud sono del Master (tenant)
        _cloud_q = {"user_id": {"$in": list({user["user_id"], tenant_id(user)})}}
        _drive_folders = await db.google_drive_folders.find(
            _cloud_q, {"_id": 0, "folder_name": 1, "folder_id": 1}
        ).to_list(30)
        _dropbox_ok = await db.dropbox_credentials.find_one(_cloud_q) is not None
        _drive_ok = await db.google_drive_connections.find_one(_cloud_q) is not None
        # V50.z54 — Sessione scaduta detection: attiva SOLO se ci sono cartelle
        # in `google_drive_folders`. Rimosso il proxy su `ai_teach_urls` che
        # causava falsi positivi "sessione scaduta" quando l'utente aveva mai
        # aggiunto un link drive.google.com a "Insegna ad Axon".
        _drive_had_before = (not _drive_ok) and (len(_drive_folders) > 0)
        lines = ["\n\nCLOUD & DRIVE COLLEGATI AL MASTER (usa queste info se l'utente chiede 'a cosa hai accesso'):"]
        if _drive_ok:
            if _drive_folders:
                _idx_cnt = await db.drive_snapshots.count_documents(_cloud_q)
                lines.append(f"- ✅ Google Drive COLLEGATO. Cartelle Axon monitorate ({len(_drive_folders)}), file indicizzati: {_idx_cnt}:")
                for f in _drive_folders[:20]:
                    lines.append(f"    • {f.get('folder_name') or f.get('name') or '?'}")
                lines.append("  → HAI ACCESSO a queste cartelle: l'indice automatico (sezione 'GOOGLE DRIVE — INDICE AUTOMATICO') contiene elenco e testo dei file. In più l'utente può allegare singoli file con l'icona G blu.")
            else:
                lines.append("- ⚠️ Google Drive collegato ma NESSUNA cartella Axon configurata. Dì all'utente di andare in Impostazioni → Google Drive → Scegli cartella.")
        elif _drive_had_before:
            lines.append(
                "- 🔴 Google Drive SESSIONE SCADUTA (era collegato prima). L'utente deve RICONNETTERSI: "
                "dì ESATTAMENTE 'Il tuo collegamento Google Drive è scaduto. Vai in **Impostazioni → Google Drive → Ricollega** "
                "(basta un tap). Le tue cartelle monitorate vengono ripristinate automaticamente dopo il nuovo login.' "
                "**NON dire 'non ho accesso'** – dì che è scaduto e va rinnovato."
            )
        else:
            lines.append(
                "- ❌ Google Drive NON ANCORA COLLEGATO. Se l'utente chiede file, dì: "
                "'Vai in **Impostazioni → Google Drive → Collega** per darmi accesso alle tue cartelle.'"
            )
        lines.append(f"- {'✅' if _dropbox_ok else '❌'} Dropbox {'collegato' if _dropbox_ok else 'non collegato'}.")
        lines.append(
            "REGOLA: non dire mai 'non ho accesso a Drive' senza qualifica. Se scaduto dì 'sessione scaduta, "
            "vai in Impostazioni per riconnettermi'. Se mai collegato spiega come collegarlo. **Non suggerire mai** "
            "di 'contattare Neo/Admin' per Drive – è auto-servito dall'utente in 2 tap."
        )
        _cloud_section = "\n".join(lines) + "\n"
    except Exception:
        _cloud_section = ""
    if _simple:  # V50.z413 — domanda semplice: niente brain/script/cheat/cloud/few-shot (restano identità, regole, ora, meteo/web se rilevati)
        _brain_section = _scripts_section = _cheat_section = _cloud_section = ""
    system_message = system_message + _brain_section + _scripts_section + _cheat_section + _cloud_section
    # V50.z284 — profilo interessi (form spuntabile + risposte libere del tour) → personalizzazione e suggerimenti proattivi
    try:
        system_message += await _axon_interest_section(user["user_id"])  # noqa: F821 — definita in axon_tour.py (stesso namespace)
    except Exception:
        pass
    system_message += _axon_product_section(user)  # V50.z323 — Axon Core: cosa esiste/non esiste nel prodotto dell'utente

    # V50.z144 — PINNED rules RIATTIVATE e messe IN CIMA al system prompt come
    # direttive vincolanti (<REGOLE_ASSOLUTE>). Il rollback V50.z53 riguardava la
    # coppia PINNED + MEMORIA_PERSISTENTE con wording che portava a risposte vuote:
    # il nuovo blocco impone di rispondere COMUNQUE in modo completo.
    # MEMORIA_PERSISTENTE resta NON iniettata.
    if _pinned_section:
        system_message = _pinned_section + system_message
    try:  # V50.z308 — telemetria dimensioni sezioni (db.axon_prompt_size.sections) per il consolidamento del prompt
        _sizes = {"base_core": len(system_message) - len(_brain_section) - len(_scripts_section) - len(_cheat_section) - len(_cloud_section) - len(_pinned_section or ""),
                  "brain": len(_brain_section), "scripts": len(_scripts_section), "cheat": len(_cheat_section), "cloud": len(_cloud_section), "pinned": len(_pinned_section or "")}
        await db.axon_prompt_size.update_one({"_id": "last"}, {"$set": {"sections": _sizes}}, upsert=True)
        if os.environ.get("AXON_PROMPT_DUMP"):  # V50.z421 — dump del prompt finale per l'analisi del consolidamento (solo dev)
            with open(os.environ["AXON_PROMPT_DUMP"], "w", encoding="utf-8") as _fh:
                _fh.write(system_message)
    except Exception:  # noqa: BLE001
        pass

    if history:
        convo_text = ""
        for h in history[-6:]:  # V50.z413 — 10 → 6 messaggi, max 600 caratteri ciascuno
            role = "Utente" if h["role"] == "user" else assistant_name
            _c = h.get("content") or ""
            convo_text += f"{role}: {_c[:600] + ('…' if len(_c) > 600 else '')}\n"
        user_prompt = (
            f"Conversazione precedente:\n{convo_text}\n"
            f"---\nNuovo messaggio dell'utente: {msg}"
        )
    else:
        user_prompt = msg

    web_sources = [
        {"title": r.get("title"), "url": r.get("url")}
        for r in (web_search_ctx.get("results", []) if web_search_ctx else [])
    ][:5] if used_web_search else []

    return {
        "msg": msg,
        "query_class": query_class,  # V50.z413
        "session_id": session_id,
        "assistant_name": assistant_name,
        "system_message": system_message,
        "user_prompt": user_prompt,
        "history_len": len(history),
        "has_attachments": bool(body.attachments),
        "has_rag_context": bool(_prefetch_rag_chunks) or bool(axon_teach_section.strip()),
        "used_web_search": used_web_search,
        "web_sources": web_sources,
        "api_key": key,
    }


@api_router.post("/assistant/chat")
async def assistant_chat(body: AssistantChatIn, user=Depends(get_current_user)):
    """Personal AI assistant. Uses Claude Sonnet 5 via Emergent LLM Key.
    Fetches user's CRM snapshot and answers questions in Italian.
    """
    msg = (body.message or "").strip()
    if not msg and body.attachments:
        # V50.z437 — Bug B: allegato (foto/documento) inviato SENZA testo → prima 400 «Messaggio vuoto» e l'app ripiegava su una
        # risposta non pertinente. Ora la richiesta implicita è «analizza l'allegato».
        msg = _implicit_attachment_prompt(body.attachments, body.merge_images is not False)  # V50.z438 — foto multiple → unico documento
    if not msg:
        raise HTTPException(status_code=400, detail="Messaggio vuoto")
    if len(msg) > 4000:
        raise HTTPException(status_code=400, detail="Messaggio troppo lungo (max 4000 caratteri)")

    key = _axon_llm_key("anthropic")  # V50.z511 — ANTHROPIC_API_KEY diretta (litellm) se presente, altrimenti EMERGENT_LLM_KEY
    if not key:
        raise HTTPException(status_code=500, detail="Nessuna chiave LLM configurata (ANTHROPIC_API_KEY o EMERGENT_LLM_KEY)")

    assistant_name = await _get_assistant_name(user)
    # V50.z271 — lingua scelta dall'utente (pagina «Voce e lingua di Axon»)
    _lang_row = await db.user_settings.find_one({"user_id": user["user_id"]}, {"assistant_language": 1}) or {}
    assistant_language = _AXON_LANG_NAMES.get((_lang_row.get("assistant_language") or "it").lower(), "italiano")
    session_id = body.session_id or f"asst_{user['user_id']}_{uuid.uuid4().hex[:10]}"

    # Load recent conversation history from DB (last 12 messages)
    hist_cursor = db.assistant_messages.find(
        {"user_id": user["user_id"], "session_id": session_id},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", -1).limit(12)
    history = [h async for h in hist_cursor]
    history.reverse()

    # V40 — Semantic cache lookup (fast path). Only for cacheable knowledge
    # queries: no attachments, no prior history, no live-data tokens.
    cache_eligible = _is_query_cacheable(msg, bool(body.attachments), bool(history))
    if cache_eligible:
        cached = await _semantic_cache_lookup(msg, tenant=tenant_id(user), product=_axon_cache_product(user))  # noqa: F821 — V50.z327
        if cached:
            # Persist both user & assistant messages for continuity
            now = utcnow()
            assistant_message_id = uuid.uuid4().hex[:16]
            await db.assistant_messages.insert_many([
                {"user_id": user["user_id"], "session_id": session_id, "role": "user", "content": msg, "created_at": now},
                {
                    "message_id": assistant_message_id,
                    "user_id": user["user_id"], "session_id": session_id,
                    "role": "assistant", "content": cached["reply"], "created_at": utcnow(),
                },
            ])
            return {
                "session_id": session_id,
                "message_id": assistant_message_id,
                "reply": cached["reply"],
                "assistant_name": assistant_name,
                "used_web_search": bool(cached.get("used_web_search")),
                "web_sources": cached.get("web_sources") or [],
                "from_cache": True,
                "cache_similarity": cached.get("_similarity", 1.0),
            }

    # Build CRM context snapshot
    try:
        context = await _build_assistant_context(user)
    except Exception as e:
        context = {"error": f"Impossibile caricare i dati CRM: {e}"}
    # V50.z180 — dati completi di tutte le sezioni + schede contatti citati
    try:
        omni_section = await _build_crm_omniscience_section(user, msg)
    except Exception as exc:
        logger.warning("[axon-omni] section failed (non-stream): %s", exc)
        omni_section = ""

    # Detect weather intent and prefetch data if a city is mentioned
    weather_ctx: Optional[dict] = None
    weather_city = _detect_weather_query(msg)
    if weather_city and weather_city != "?":
        weather_ctx = await _fetch_weather(weather_city)

    # V38T — Detect energy market intent and prefetch data via Tavily
    web_search_ctx: Optional[dict] = None
    used_web_search = False
    _needs_energy = _detect_energy_query(msg)
    _needs_tavily = _needs_energy or _axon_wants_general_web(user, msg)  # noqa: F821 — V50.z440 axon_persona.py
    logger.info("[web-search] (non-stream) «%s» → energy=%s tavily=%s", (msg or "")[:70], _needs_energy, "SI" if _needs_tavily else "NO")  # V50.z445
    if _needs_tavily:
        try:
            web_search_ctx = await _tavily_search_smart(msg, _needs_energy)
        except Exception as exc:  # noqa: BLE001
            logger.error("[tavily] eccezione (non-stream) per «%s»: %s", (msg or "")[:80], exc); web_search_ctx = None
        if web_search_ctx and (web_search_ctx.get("answer") or web_search_ctx.get("results")):
            used_web_search = True
        else:
            logger.warning("[tavily] nessun risultato/ricerca non eseguita (non-stream) per «%s»", (msg or "")[:80])

    # V38T — Load persistent memories for this user
    memories = await _load_neo_memories(user["user_id"], limit=5)

    # V28.l — Extract text from any attachments (unified helper V50.z90)
    attachments_section = await _build_attachments_section_advanced(msg, body.attachments or [], merge_images=body.merge_images is not False)

    # V29.k — FIX REGRESSIONE: base di conoscenza "Insegna ad Axon" (regole + file estratti).
    # Prima gli allegati alle regole (PDF GME, Optima, ecc.) non venivano letti nella chat.
    axon_teach_section = ""
    try:
        axon_teach_section = await _build_axon_teach_section(tenant_id(user), msg)
    except Exception as exc:
        logger.warning("[axon-teach] section build failed: %s", exc)
        axon_teach_section = ""

    # V50.kb — Knowledge Base personale (pagine WebView salvate).
    kb_section = ""
    try:
        kb_section = await _build_kb_section(tenant_id(user), msg)
    except Exception as exc:
        logger.debug("[axon-kb] section build failed: %s", exc)
        kb_section = ""

    # V42 — RAG on Master documents (per-tenant knowledge base)
    rag_section = ""
    try:
        # V49.p — Riusa i chunk già prefetched (evita doppia query Mongo).
        _prefetched = locals().get("_prefetch_rag_chunks")
        rag_chunks = _prefetched if _prefetched else await _retrieve_master_doc_chunks(tenant_id(user), msg)
        if rag_chunks:
            rag_section = (
                "\n\nDOCUMENTI MASTER (base di conoscenza personale del Master — usa questi estratti "
                "come FONTE PRIMARIA. Se contengono i dati richiesti (es. tabelle PUN, listini, "
                "valori per fascia F1/F2/F3), RISPONDI CON QUEI DATI senza cercare altrove e senza "
                "dichiarare che i dati mancano):\n"
            )
            for i, c in enumerate(rag_chunks, 1):
                dname = c.get("doc_name") or "?"
                pg = c.get("page_number") or 0
                score = c.get("_score", 0.0)
                content = (c.get("content") or "")[:2000]
                # V50.z144 — voci testuali (FAQ/Dati/Nota) mostrano la categoria invece della pagina
                _where = f"pagina {pg}" if (c.get("doc_kind") or "pdf") == "pdf" else (c.get("doc_category") or "Nota")
                rag_section += (
                    f"\n--- Estratto {i} da \"{dname}\" ({_where}, rilevanza {score:.2f}) ---\n"
                    f"{content}\n"
                )
            rag_section += (
                "\nCita il nome del documento quando produci prosa (es. «Listino Optima 2026»). "
                "Quando produci una TABELLA, NON aggiungere note sulle fonti — solo la tabella pura.\n"
            )
    except Exception as exc:
        logger.warning("[axon-rag] retrieval failed: %s", exc)
        rag_section = ""


    import json as _json
    ctx_json = _json.dumps(context, ensure_ascii=False, default=str)
    # Trim if too large (Claude Sonnet accepts a lot but let's be safe)
    if len(ctx_json) > 25000:
        ctx_json = ctx_json[:12000] + "\n... (dati troncati)"

    weather_section = ""
    if weather_ctx is not None:
        weather_section = (
            "\n\nMETEO (dati aggiornati, timezone Europe/Rome — DATO FORNITO DAL SISTEMA perché il messaggio dell'utente contiene una richiesta meteo esplicita; "
            "se in realtà l'utente NON ha chiesto del meteo, IGNORA questa sezione e non parlarne):\n"
            f"{_json.dumps(weather_ctx, ensure_ascii=False, default=str)}\n"
            "Usa questi dati per rispondere in modo naturale alla domanda meteo. "
            "Se l'utente chiede un momento specifico (oggi pomeriggio, domani mattina, ecc.) "
            "cita la temperatura, la condizione (es. sereno, pioggia leggera) e la probabilità di pioggia se rilevante.\n"
        )
    elif weather_city == "?":
        weather_section = (
            "\n\nAVVISO (dal sistema): il messaggio contiene una richiesta meteo esplicita senza città. "
            "SOLO se l'utente sta davvero chiedendo del meteo, chiedi per quale città; altrimenti ignora questo avviso.\n"
        )

    # V38T — Inject web-search results when energy topic detected
    web_section = ""
    if _needs_tavily and not used_web_search:  # V50.z444 — vedi sopra (percorso non-stream)
        web_section = ("\n\nRICERCA WEB AGGIORNATA: NON DISPONIBILE per questa domanda (servizio di ricerca non configurato o nessun risultato). "
                       "Per fatti attuali (borsa, prezzi, notizie, sport, eventi) rispondi ESATTAMENTE «Non ho dati aggiornati su questo.» e fermati.\n")
    if web_search_ctx and used_web_search:
        web_section = (
            "\n\nRICERCA WEB AGGIORNATA (dati reali dal mercato energetico italiano):\n"
            f"Query utente: {web_search_ctx.get('query')}\n"
            f"Risposta sintetizzata (Tavily): {web_search_ctx.get('answer') or 'nessuna sintesi'}\n"
            "Fonti primarie (usa questi contenuti come base per la tua risposta):\n"
        )
        for i, r in enumerate(web_search_ctx.get("results", [])[:5], 1):
            web_section += f"[{i}] {r.get('title')} — {r.get('url')}\n{r.get('content')}\n\n"
        web_section += (
            "REGOLE per usare questi dati:\n"
            "- Cita i numeri esatti (€/MWh, €/kWh, mesi, delibere ARERA con numero e data).\n"
            "- NON rimandare l'utente a siti esterni. Rispondi TU con la risposta.\n"
            "- Se i dati sono aggiornati a un mese specifico, dillo (es. 'PUN novembre 2026').\n"
            "- Se la ricerca non ha trovato dati precisi, dillo apertamente.\n"
        )

    # V38T — Inject long-term memory
    memory_section = ""
    if memories:
        memory_section = "\n\nMEMORIA PERSISTENTE (contesto delle conversazioni precedenti):\n"
        for m in memories[:3]:  # V50.z421 — consolidamento: 3 memorie, sintesi ≤220 car., max 4 fatti ≤120 car.
            memory_section += f"- {str(m.get('summary', ''))[:220]}\n"
            for f in (m.get("facts") or [])[:4]:
                memory_section += f"  • {str(f)[:120]}\n"
        memory_section += "Usa la memoria per personalizzare, senza citare «ricordo che…» se non utile.\n"

    # V49.n — Few-shot dinamico basato sui feedback 👍/👎 del tenant.
    # Carica gli ultimi 5 esempi con 👍 (best answers da imitare) e gli ultimi
    # 2 con 👎 (anti-esempi da evitare). Iniezione leggera, solo Q+A troncati.
    few_shot_section = ""
    try:
        _fs_tid = tenant_id(user)
        _fs_ups_cur = db.assistant_feedback.find(
            {"tenant_id": _fs_tid, "rating": "up"},
            {"_id": 0, "question": 1, "reply": 1},
        ).sort("created_at", -1).limit(5)
        _fs_downs_cur = db.assistant_feedback.find(
            {"tenant_id": _fs_tid, "rating": "down"},
            {"_id": 0, "question": 1, "reply": 1, "comment": 1},
        ).sort("created_at", -1).limit(2)
        _fs_ups = [d async for d in _fs_ups_cur]
        _fs_downs = [d async for d in _fs_downs_cur]
        if _fs_ups or _fs_downs:
            _fs_lines: List[str] = ["\n\nESEMPI DI RISPOSTE (feedback storico del tenant):"]
            if _fs_ups:
                _fs_lines.append("👍 Esempi apprezzati — imita QUESTO stile/tono/dettaglio:")
                for _fs_i, _fs_ex in enumerate(_fs_ups, 1):
                    _fs_q = (_fs_ex.get("question") or "").strip()[:180]
                    _fs_a = (_fs_ex.get("reply") or "").strip()[:280]
                    if _fs_q and _fs_a:
                        _fs_lines.append(f"  {_fs_i}) Domanda: {_fs_q}")
                        _fs_lines.append(f"     Risposta ottima: {_fs_a}")
            if _fs_downs:
                _fs_lines.append("👎 Esempi NON apprezzati — evita QUESTI pattern:")
                for _fs_i, _fs_ex in enumerate(_fs_downs, 1):
                    _fs_q = (_fs_ex.get("question") or "").strip()[:180]
                    _fs_a = (_fs_ex.get("reply") or "").strip()[:220]
                    _fs_cm = (_fs_ex.get("comment") or "").strip()[:120]
                    if _fs_q and _fs_a:
                        _fs_lines.append(f"  {_fs_i}) Domanda: {_fs_q}")
                        _fs_lines.append(f"     Risposta da NON riprodurre: {_fs_a}")
                        if _fs_cm:
                            _fs_lines.append(f"     Motivo del 👎: {_fs_cm}")
            _fs_lines.append("Applica il TONO e la STRUTTURA degli esempi 👍; evita difetti di quelli 👎.")
            few_shot_section = "\n".join(_fs_lines) + "\n"
    except Exception as _fs_exc:
        logger.debug("[few-shot] skipped: %s", _fs_exc)
        few_shot_section = ""

    system_message = (
        _axon_core_identity(user, assistant_name) +  # V50.z323 — Axon Core: identità per prodotto (advisor | lite)
        # V50.z309 — REGOLE CORE CONSOLIDATE (stesso comportamento, ~60% più corte: eliminati doppioni e ripetizioni)
        _axon_core_rules(assistant_language, msg) +  # V50.z421 — regole core: blocchi mercato/Drive/tabelle/grafici solo se pertinenti al messaggio
        f"ORA ATTUALE: {context.get('ora_attuale', '')}\n\n"
        "SNAPSHOT_CRM (JSON):\n"
        f"{ctx_json}\n"
        f"{omni_section}"
        f"{weather_section}"
        f"{axon_teach_section}"
        f"{rag_section}"
        f"{kb_section}"
        f"{memory_section}"
        f"{web_section}"
        f"{few_shot_section}"
        f"{attachments_section}"
    )

    # V50.w — Iniezione Axon Brain (memoria distillata + profilo appreso)
    try:
        _brain = await _load_axon_brain(user["user_id"])
        _brain_section = _brain_section_for_prompt(_brain)
    except Exception:
        _brain_section = ""
    try:
        _scripts_section = await _load_scripts_index(tenant_id(user))
    except Exception:
        _scripts_section = ""
    try:
        _cheat_section = await _cheatsheet_section_for_prompt(user["user_id"])
    except Exception:
        _cheat_section = ""
    # V50.z8 — Elenca cartelle Drive collegate + connessioni cloud attive.
    # Axon deve sapere di essere COLLEGATO al Drive del Master.
    _cloud_section = ""
    try:
        # V50.z155 — Collaboratori: le connessioni cloud sono del Master (tenant)
        _cloud_q = {"user_id": {"$in": list({user["user_id"], tenant_id(user)})}}
        _drive_folders = await db.google_drive_folders.find(
            _cloud_q, {"_id": 0, "folder_name": 1, "folder_id": 1}
        ).to_list(30)
        _dropbox_ok = await db.dropbox_credentials.find_one(_cloud_q) is not None
        _drive_ok = await db.google_drive_connections.find_one(_cloud_q) is not None
        # V50.z54 — Sessione scaduta detection: attiva SOLO se ci sono cartelle
        # in `google_drive_folders`. Rimosso il proxy su `ai_teach_urls` che
        # causava falsi positivi "sessione scaduta" quando l'utente aveva mai
        # aggiunto un link drive.google.com a "Insegna ad Axon".
        _drive_had_before = (not _drive_ok) and (len(_drive_folders) > 0)
        lines = ["\n\nCLOUD & DRIVE COLLEGATI AL MASTER (usa queste info se l'utente chiede 'a cosa hai accesso'):"]
        if _drive_ok:
            if _drive_folders:
                _idx_cnt = await db.drive_snapshots.count_documents(_cloud_q)
                lines.append(f"- ✅ Google Drive COLLEGATO. Cartelle Axon monitorate ({len(_drive_folders)}), file indicizzati: {_idx_cnt}:")
                for f in _drive_folders[:20]:
                    lines.append(f"    • {f.get('folder_name') or f.get('name') or '?'}")
                lines.append("  → HAI ACCESSO a queste cartelle: l'indice automatico (sezione 'GOOGLE DRIVE — INDICE AUTOMATICO') contiene elenco e testo dei file. In più l'utente può allegare singoli file con l'icona G blu.")
            else:
                lines.append("- ⚠️ Google Drive collegato ma NESSUNA cartella Axon configurata. Dì all'utente di andare in Impostazioni → Google Drive → Scegli cartella.")
        elif _drive_had_before:
            lines.append(
                "- 🔴 Google Drive SESSIONE SCADUTA (era collegato prima). L'utente deve RICONNETTERSI: "
                "dì ESATTAMENTE 'Il tuo collegamento Google Drive è scaduto. Vai in **Impostazioni → Google Drive → Ricollega** "
                "(basta un tap). Le tue cartelle monitorate vengono ripristinate automaticamente dopo il nuovo login.' "
                "**NON dire 'non ho accesso'** – dì che è scaduto e va rinnovato."
            )
        else:
            lines.append(
                "- ❌ Google Drive NON ANCORA COLLEGATO. Se l'utente chiede file, dì: "
                "'Vai in **Impostazioni → Google Drive → Collega** per darmi accesso alle tue cartelle.'"
            )
        lines.append(f"- {'✅' if _dropbox_ok else '❌'} Dropbox {'collegato' if _dropbox_ok else 'non collegato'}.")
        lines.append(
            "REGOLA: non dire mai 'non ho accesso a Drive' senza qualifica. Se scaduto dì 'sessione scaduta, "
            "vai in Impostazioni per riconnettermi'. Se mai collegato spiega come collegarlo. **Non suggerire mai** "
            "di 'contattare Neo/Admin' per Drive – è auto-servito dall'utente in 2 tap."
        )
        _cloud_section = "\n".join(lines) + "\n"
    except Exception:
        _cloud_section = ""
    system_message = system_message + _brain_section + _scripts_section + _cheat_section + _cloud_section
    # V50.z284 — profilo interessi (form spuntabile + risposte libere del tour) → personalizzazione e suggerimenti proattivi
    try:
        system_message += await _axon_interest_section(user["user_id"])  # noqa: F821 — definita in axon_tour.py (stesso namespace)
    except Exception:
        pass
    system_message += _axon_product_section(user)  # V50.z323 — Axon Core: cosa esiste/non esiste nel prodotto dell'utente
    try:
        system_message += await _axon_personalize_section(user)  # noqa: F821 — V50.z456 axon_personalize.py: personalità + stile scelti dall'utente
    except Exception:  # noqa: BLE001
        pass

    # V50.z360 — «Stato sistema» + CHANGELOG dinamico anche nel percorso NON-stream (ViolaWake): stessa sezione dello stream.
    try:
        await _axs_flush()  # noqa: F821 — definita in axon_system_awareness.py (stesso namespace)
        _axs_sec_ns = await _axs_context_section(user, msg)  # noqa: F821
        if _axs_sec_ns:
            system_message = f"{system_message}\n\n{_axs_sec_ns}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axs] context (non-stream) failed: %s", exc)

    # V50.z487 — GPS reale del telefono (client_context.position) + permessi dispositivo anche nell'endpoint non-stream (voce / Viola)
    try:
        _ng_gps_fn = globals().get("_nav_gps_section")
        _ng_perm_fn = globals().get("_nav_permissions_section")
        _ng_sec = ((await _ng_gps_fn(user, body.client_context, msg)) if _ng_gps_fn else "") + (_ng_perm_fn(body.client_context) if _ng_perm_fn else "")
        if _ng_sec:
            system_message = f"{system_message}{_ng_sec}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[nav-guard] gps/permissions (non-stream) failed: %s", exc)

    # V50.z144 — PINNED rules in cima anche nell'endpoint non-streaming (stesso blocco dello stream).
    try:
        _pinned_section_ns = await _build_pinned_rules_section(tenant_id(user), msg)
    except Exception:
        _pinned_section_ns = ""
    if _pinned_section_ns:
        system_message = _pinned_section_ns + system_message

    from emergentintegrations.llm.chat import UserMessage
    chat = _axon_llm_chat(system_message, session_id, model="claude-haiku-4-5")  # V50.z511 — stessa chiave risolta sopra (`key`)
    _rx_data = globals().get("_RX_DATA_REQUEST")  # V50.z452 — dato secco / voce → risposta minimalista (tetto token)
    if (_rx_data and _rx_data.search(msg or "")) or (isinstance(body.client_context, dict) and body.client_context.get("voice")):
        chat = chat.with_params(max_tokens=150)

    # Replay history so multi-turn works (LlmChat keeps internal state but we start fresh each request)
    # We prepend history summary to the current user message for continuity
    if history:
        convo_text = ""
        for h in history[-6:]:  # V50.z413 — 10 → 6 messaggi, max 600 caratteri ciascuno
            role = "Utente" if h["role"] == "user" else assistant_name
            _c = h.get("content") or ""
            convo_text += f"{role}: {_c[:600] + ('…' if len(_c) > 600 else '')}\n"
        user_prompt = (
            f"Conversazione precedente:\n{convo_text}\n"
            f"---\nNuovo messaggio dell'utente: {msg}"
        )
    else:
        user_prompt = msg

    try:
        reply = await chat.send_message(UserMessage(text=user_prompt))
    except Exception as e:
        reply = _axon_llm_failure("chat", e)  # noqa: F821 — V50.z467: risposta normale, letta anche dal TTS

    reply_text = (reply or "").strip() or "Non ho ricevuto una risposta. Riprova."

    now = utcnow()
    # V41 — Assign an ID to the assistant message so the client can attach feedback later.
    assistant_message_id = uuid.uuid4().hex[:16]
    # Persist both messages
    await db.assistant_messages.insert_many([
        {"user_id": user["user_id"], "session_id": session_id, "role": "user", "content": msg, "created_at": now},
        {
            "message_id": assistant_message_id,
            "user_id": user["user_id"], "session_id": session_id,
            "role": "assistant", "content": reply_text, "created_at": utcnow(),
        },
    ])

    # V38T — Fire-and-forget memory distillation (does not block the response)
    try:
        asyncio.create_task(_maybe_save_memory(user["user_id"], session_id, assistant_name))
    except Exception:
        pass

    # V50.z129/z130 — Apprendimento immediato: impegni di Axon + lezioni dell'utente → ai_teach_rules
    try:
        asyncio.create_task(_post_reply_learning(user, msg, reply_text))
    except Exception:
        pass

    # V50.w — Fire-and-forget Axon Brain distillation ogni ~8 messaggi
    try:
        _count = await db.assistant_messages.count_documents({"user_id": user["user_id"], "session_id": session_id})
        if _count >= 8 and _count % 8 == 0:
            asyncio.create_task(_distill_axon_brain(user["user_id"], session_id))
    except Exception:
        pass

    # V40 — Save to semantic cache if eligible (fire-and-forget)
    if cache_eligible:
        web_sources_out = [
            {"title": r.get("title"), "url": r.get("url")}
            for r in (web_search_ctx.get("results", []) if web_search_ctx else [])
        ][:5] if used_web_search else []
        try:
            asyncio.create_task(_semantic_cache_save(
                msg=msg,
                reply=reply_text,
                used_web_search=used_web_search,
                web_sources=web_sources_out,
                assistant_name=assistant_name,
                tenant=tenant_id(user),
                product=_axon_cache_product(user),  # noqa: F821 — V50.z327
            ))
        except Exception:
            pass

    return {
        "session_id": session_id,
        "message_id": assistant_message_id,
        "reply": reply_text,
        "assistant_name": assistant_name,
        "used_web_search": used_web_search,
        "web_sources": [
            {"title": r.get("title"), "url": r.get("url")}
            for r in (web_search_ctx.get("results", []) if web_search_ctx else [])
        ][:5] if used_web_search else [],
        "from_cache": False,
    }


# =========================================================================
# V40 — Streaming endpoint (Server-Sent Events)
# =========================================================================

class AssistantChatStreamIn(AssistantChatIn):
    # V50.z126 — Se presente, la richiesta è un'azione rapida: il prompt viene
    # arricchito con le istruzioni operative e la risposta finale salvata in
    # axon_qa_cache (stessa cache di POST /axon/quick-action).
    quick_label: Optional[str] = None


# V50.m — Slash commands: intercettati prima della LLM per risposte istantanee
# a query strutturate. Formato: /comando [argomenti].
# Comandi disponibili:
#   /aiuto           → mostra tutti i comandi disponibili
#   /bolletta [nome] → riepilogo ultime bollette del cliente (nome fuzzy match)
#   /scadenze        → prossime scadenze contratti (30gg)
#   /pun [mese] [anno] → PUN medi per fascia (delega a chat normale con RAG)
#   /team            → snapshot performance team (solo Master)
async def _maybe_slash_command(msg: str, user: dict) -> Optional[dict]:
    """Se `msg` inizia con /, esegui il comando e ritorna un dict con `reply`
    e opzionale `session_id`. Altrimenti ritorna None e la chat procede
    normalmente attraverso la LLM."""
    txt = (msg or "").strip()
    if not txt.startswith("/"):
        return None
    parts = txt.split(None, 1)
    cmd = parts[0].lower().lstrip("/")
    arg = parts[1].strip() if len(parts) > 1 else ""
    tenant = tenant_id(user)

    if cmd in ("aiuto", "help", "?"):
        reply = (
            "🎯 **Comandi rapidi Axon**\n\n"
            "• `/bolletta [nome]` — Riepilogo ultime bollette del cliente (matching fuzzy).\n"
            "• `/scadenze` — Prossime scadenze contratti nei 30 giorni.\n"
            "• `/pun [mese] [anno]` — PUN medi per fascia F1/F2/F3.\n"
            "• `/team` — Snapshot performance team (solo Master).\n"
            "• `/aiuto` — Questo elenco.\n\n"
            "💡 *Suggerimento*: puoi anche chiedere in linguaggio naturale — i comandi slash sono solo scorciatoie per andare veloce."
        )
        return {"reply": reply, "cmd": "aiuto"}

    if cmd == "bolletta":
        if not arg:
            return {"reply": "Uso: `/bolletta [nome cliente]`\nEsempio: `/bolletta Mario Rossi`", "cmd": "bolletta"}
        # Fuzzy match by first_name/last_name/email
        q_low = arg.lower()
        contact = await db.contacts.find_one({
            "tenant_id": tenant,
            "$or": [
                {"first_name": {"$regex": q_low, "$options": "i"}},
                {"last_name": {"$regex": q_low, "$options": "i"}},
                {"email": {"$regex": q_low, "$options": "i"}},
            ],
        }, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "email": 1})
        if not contact:
            return {"reply": f"❌ Nessun cliente trovato per '**{arg}**'. Prova con nome/cognome/email parziali.", "cmd": "bolletta"}
        bills = await db.contact_bills.find(
            {"contact_id": contact["id"], "tenant_id": tenant},
            {"_id": 0, "kind": 1, "supplier": 1, "pod": 1, "pdr": 1, "created_at": 1, "extracted": 1},
        ).sort("created_at", -1).limit(5).to_list(5)
        header = f"📋 **Ultime bollette di {contact.get('first_name','')} {contact.get('last_name','')}**\n\n"
        if not bills:
            return {"reply": header + "_Nessuna bolletta caricata per questo cliente._", "cmd": "bolletta"}
        lines = []
        for b in bills:
            kind = (b.get("kind") or "?").capitalize()
            sup = b.get("supplier") or "n/d"
            ident = b.get("pod") or b.get("pdr") or "-"
            dt = b.get("created_at")
            dt_str = dt.strftime("%d/%m/%Y") if dt else "?"
            lines.append(f"• **{kind}** · {sup} · {ident} · {dt_str}")
        return {"reply": header + "\n".join(lines), "cmd": "bolletta"}

    if cmd == "scadenze":
        from datetime import timedelta as _td
        now = utcnow()
        limit_date = now + _td(days=30)
        rows = await db.contact_bills.find(
            {"tenant_id": tenant, "extracted.scadenza_pagamento": {"$gte": now, "$lte": limit_date}},
            {"_id": 0, "contact_id": 1, "kind": 1, "supplier": 1, "extracted": 1},
        ).limit(30).to_list(30)
        if not rows:
            return {"reply": "✅ **Nessuna scadenza contratto nei prossimi 30 giorni.**", "cmd": "scadenze"}
        # Enrich contact names
        cids = list({r["contact_id"] for r in rows if r.get("contact_id")})
        cmap: dict = {}
        async for c in db.contacts.find({"id": {"$in": cids}, "tenant_id": tenant}, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1}):
            cmap[c["id"]] = f"{c.get('first_name','')} {c.get('last_name','')}".strip()
        lines = [f"⏰ **Scadenze contratti prossimi 30gg** ({len(rows)}):\n"]
        for r in rows[:15]:
            due = r.get("extracted", {}).get("scadenza_pagamento")
            due_str = due.strftime("%d/%m/%Y") if due else "?"
            name = cmap.get(r.get("contact_id"), "?")
            kind = (r.get("kind") or "?").capitalize()
            sup = r.get("supplier") or ""
            lines.append(f"• **{due_str}** · {name} · {kind} {sup}")
        return {"reply": "\n".join(lines), "cmd": "scadenze"}

    if cmd == "pun":
        # Delega alla chat normale con query costruita per Axon
        args = arg.split()
        month = args[0] if args else ""
        year = args[1] if len(args) > 1 else "2026"
        rebuild = f"Dammi la tabella PUN F1 F2 F3 e monorario per {month or 'tutti i mesi disponibili'} {year}, solo dati in formato tabella"
        return {"reply": None, "cmd": "pun", "rebuild_msg": rebuild}

    if cmd == "team":
        role = (user.get("role") or "").lower()
        if role != "master":
            return {"reply": "🔒 Comando riservato ai Master.", "cmd": "team"}
        # Snapshot: numero collaboratori, appuntamenti 30gg, contatti totali, telefonate 30gg
        from datetime import timedelta as _td
        now = utcnow()
        thirty = now - _td(days=30)
        collaborators = await db.users.count_documents({"tenant_id": tenant, "role": {"$in": ["collaborator", "user"]}})
        appts = await db.appointments.count_documents({"tenant_id": tenant, "created_at": {"$gte": thirty}})
        contacts = await db.contacts.count_documents({"tenant_id": tenant})
        calls = await db.callbacks.count_documents({"tenant_id": tenant, "created_at": {"$gte": thirty}}) if hasattr(db, "callbacks") else 0
        reply = (
            f"👥 **Team snapshot (30gg)**\n\n"
            f"• Collaboratori attivi: **{collaborators}**\n"
            f"• Contatti totali: **{contacts}**\n"
            f"• Appuntamenti creati: **{appts}**\n"
            f"• Telefonate: **{calls}**\n\n"
            f"_Vai in **Team Insights** per profili individuali e confronti._"
        )
        return {"reply": reply, "cmd": "team"}

    return {"reply": f"❓ Comando `/{cmd}` non riconosciuto. Digita `/aiuto` per l'elenco.", "cmd": "unknown"}


# V50.z31 — Intercept natural-language per le Quick Actions (senza `/`).
# I prompt canonici tipo "Qual è il mio prossimo appuntamento?" arrivavano nel
# flow LLM completo (preflight + Tavily + RAG + GME canonical) impiegando 20s.
# Ora rispondiamo direttamente in <1s con dati dal DB.
async def _maybe_quick_action_intercept(msg: str, user: dict) -> Optional[dict]:
    """Se il messaggio matcha un prompt canonico di quick-action, risponde
    istantaneamente senza toccare la LLM. Ritorna None se non c'è match."""
    txt = (msg or "").strip().lower().rstrip("?!.")
    if not txt or len(txt) > 120:
        return None
    tenant = tenant_id(user)
    uid_ = user["user_id"]

    # ── Prossimo appuntamento ──────────────────────────────
    trigger_next_appt = {
        "qual è il mio prossimo appuntamento",
        "qual e il mio prossimo appuntamento",
        "prossimo appuntamento",
        "mio prossimo appuntamento",
        "che appuntamento ho",
        "quando ho il prossimo appuntamento",
        "prossimi appuntamenti",
    }
    if any(t in txt for t in trigger_next_appt):
        from datetime import timedelta as _td
        now = utcnow()
        # 7 giorni davanti
        end = now + _td(days=7)
        appts = await db.appointments.find(
            {"user_id": uid_, "start_date": {"$gte": now, "$lte": end}},
            {"_id": 0, "start_date": 1, "title": 1, "contact_name": 1, "location": 1, "phone": 1},
        ).sort("start_date", 1).limit(3).to_list(3)
        if not appts:
            # Suggerisci clienti senza appt (max 4 nomi)
            orphans = await db.contacts.find(
                {"user_id": uid_},
                {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "name": 1},
            ).limit(50).to_list(50)
            names = []
            for c in orphans:
                # Verifica no future appt
                nxt = await db.appointments.find_one(
                    {"user_id": uid_, "contact_id": c.get("contact_id"), "start_date": {"$gte": now}},
                    {"_id": 0, "start_date": 1},
                )
                if not nxt:
                    nm = c.get("name") or f"{c.get('first_name','')} {c.get('last_name','')}".strip()
                    if nm:
                        names.append(nm)
                if len(names) >= 4:
                    break
            reply = "Non hai appuntamenti programmati nei prossimi 7 giorni."
            if names:
                reply += f"\n\n**Suggerimento operativo**: hai {len(names)} clienti senza appuntamenti futuri fissati ({', '.join(names)}). Considera di contattarli per pianificare nuovi incontri."
            return {"reply": reply, "cmd": "qa_next_appt"}
        # C'è almeno un appuntamento
        lines = ["📅 **Prossimi appuntamenti (7 giorni)**\n"]
        for a in appts:
            when = a.get("start_date")
            when_s = when.strftime("%a %d/%m %H:%M") if when else "?"
            title = a.get("title") or a.get("contact_name") or "Appuntamento"
            loc = a.get("location")
            phone = a.get("phone")
            row = f"• **{when_s}** — {title}"
            if loc: row += f" · 📍 {loc}"
            if phone: row += f" · ☎ {phone}"
            lines.append(row)
        return {"reply": "\n".join(lines), "cmd": "qa_next_appt"}

    # ── Clienti senza appuntamento futuro ──────────────────
    if "senza appuntament" in txt and ("clienti" in txt or "contatt" in txt or "mostr" in txt):
        now = utcnow()
        orphans = await db.contacts.find(
            {"user_id": uid_},
            {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "name": 1, "phone": 1},
        ).limit(200).to_list(200)
        result: List[str] = []
        for c in orphans:
            nxt = await db.appointments.find_one(
                {"user_id": uid_, "contact_id": c.get("contact_id"), "start_date": {"$gte": now}},
                {"_id": 0, "start_date": 1},
            )
            if not nxt:
                nm = c.get("name") or f"{c.get('first_name','')} {c.get('last_name','')}".strip()
                if nm:
                    ph = c.get("phone") or ""
                    result.append(f"• {nm}" + (f" · ☎ {ph}" if ph else ""))
            if len(result) >= 25:
                break
        if not result:
            return {"reply": "✅ Tutti i clienti hanno un appuntamento futuro pianificato.", "cmd": "qa_orphans"}
        reply = f"📋 **Clienti senza appuntamento futuro** ({len(result)})\n\n" + "\n".join(result)
        return {"reply": reply, "cmd": "qa_orphans"}

    return None


# =========================================================================
