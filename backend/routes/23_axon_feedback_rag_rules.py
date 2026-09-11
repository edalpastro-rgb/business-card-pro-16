# 23_axon_feedback_rag_rules.py — AxonOS: feedback, RAG documenti Master, proposte regole
# Estratto da server.py (righe originali 16034-17168). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V41 — Feedback 👍/👎 su risposte Axon (self-learning loop)
#
# Flow:
#  1) Ogni risposta assistant ha un `message_id` (stringa 16-char hex). Il client
#     lo riceve nell'endpoint meta/done (streaming) o nel body JSON (non-stream).
#  2) L'utente tocca 👍 o 👎 sulla bubble. Se 👎, un modal permette di scegliere
#     una motivazione (impreciso / troppo lungo / non pertinente / altro) e un
#     commento libero opzionale.
#  3) Il client fa POST /api/assistant/feedback con {message_id, rating, reason?, comment?}.
#  4) Il feedback viene salvato in db.assistant_feedback + effetti collaterali:
#     - Se 👎 e la risposta era nella semantic cache → invalida quella cache entry
#       (evita di riproporre risposte non gradite).
#     - Se 👍 e la risposta NON era in cache → marca la voce come "gold" per
#       future statistiche/few-shot.
#  5) L'endpoint è idempotente su (user_id, message_id): un secondo POST aggiorna
#     il rating esistente (per permettere all'utente di cambiare idea).
# =========================================================================

class AssistantFeedbackIn(BaseModel):
    message_id: str
    rating: Literal["up", "down"]
    reason: Optional[str] = None  # short tag (e.g. "impreciso", "troppo_lungo", "non_pertinente", "altro")
    comment: Optional[str] = None  # free-text feedback


@api_router.post("/assistant/feedback")
async def assistant_feedback(body: AssistantFeedbackIn, user=Depends(get_current_user)):
    """Persist a thumbs-up/down feedback for an assistant message.
    Idempotent on (user_id, message_id): re-posting updates the existing record."""
    mid = (body.message_id or "").strip()
    if not mid:
        raise HTTPException(status_code=400, detail="message_id richiesto")
    if body.rating not in ("up", "down"):
        raise HTTPException(status_code=400, detail="rating deve essere 'up' o 'down'")

    # Look up the assistant message (must belong to the requesting user)
    msg_doc = await db.assistant_messages.find_one(
        {"message_id": mid, "user_id": user["user_id"], "role": "assistant"},
        {"_id": 0, "message_id": 1, "session_id": 1, "content": 1, "created_at": 1},
    )
    if not msg_doc:
        raise HTTPException(status_code=404, detail="Messaggio non trovato o non tuo")

    session_id = msg_doc.get("session_id")
    reply_text = msg_doc.get("content") or ""

    # Retrieve the immediately-preceding user message (same session, just before this one)
    # so we know which question this feedback refers to.
    prior = await db.assistant_messages.find_one(
        {
            "user_id": user["user_id"],
            "session_id": session_id,
            "role": "user",
            "created_at": {"$lte": msg_doc.get("created_at")},
        },
        {"_id": 0, "content": 1, "created_at": 1},
        sort=[("created_at", -1)],
    )
    question_text = (prior or {}).get("content") or ""

    now = utcnow()
    reason = (body.reason or "").strip()[:60] or None
    comment = (body.comment or "").strip()[:2000] or None

    # Upsert on (user_id, message_id) so users can flip 👍↔👎
    await db.assistant_feedback.update_one(
        {"user_id": user["user_id"], "message_id": mid},
        {
            "$set": {
                "user_id": user["user_id"],
                "tenant_id": tenant_id(user),
                "message_id": mid,
                "session_id": session_id,
                "question": question_text[:2000],
                "reply": reply_text[:5000],
                "rating": body.rating,
                "reason": reason,
                "comment": comment,
                "updated_at": now,
            },
            "$setOnInsert": {
                "feedback_id": uuid.uuid4().hex,
                "created_at": now,
            },
        },
        upsert=True,
    )

    # Side-effect: on 👎, invalidate any matching semantic-cache entry so this
    # answer isn't served again to anyone. Only invalidate if it looks like a
    # semantic-cache candidate (short-cut by matching question tokens).
    if body.rating == "down" and question_text:
        try:
            _, q_tokens = _normalize_and_tokenize(question_text)
            if q_tokens:
                # Fetch a few candidates + delete those with high similarity
                cursor = db.axon_semantic_cache.find(
                    {"expires_at": {"$gt": now}},
                    {"_id": 0, "cache_id": 1, "tokens": 1, "reply": 1},
                ).sort("created_at", -1).limit(SEM_CACHE_CANDIDATE_LIMIT)
                to_delete: List[str] = []
                async for c in cursor:
                    score = _jaccard(q_tokens, c.get("tokens") or [])
                    # Match by token similarity + reply must equal cached reply
                    if score >= SEM_CACHE_JACCARD_THRESHOLD and (c.get("reply") or "") == reply_text:
                        to_delete.append(c.get("cache_id"))
                if to_delete:
                    await db.axon_semantic_cache.delete_many({"cache_id": {"$in": to_delete}})
                    logger.info("[axon-feedback] invalidated %d cache entries after 👎", len(to_delete))
        except Exception as exc:
            logger.warning("[axon-feedback] cache invalidation failed: %s", exc)

    return {"ok": True, "message_id": mid, "rating": body.rating}


@api_router.get("/assistant/feedback/{message_id}")
async def assistant_feedback_get(message_id: str, user=Depends(get_current_user)):
    """Return the current feedback for a specific assistant message (or 404)."""
    doc = await db.assistant_feedback.find_one(
        {"user_id": user["user_id"], "message_id": message_id},
        {"_id": 0, "message_id": 1, "rating": 1, "reason": 1, "comment": 1, "created_at": 1, "updated_at": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Nessun feedback per questo messaggio")
    return doc


@api_router.get("/assistant/feedback/stats/summary")
async def assistant_feedback_stats(user=Depends(get_current_user)):
    """Return per-user feedback aggregates (last 30 days by default)."""
    since = utcnow() - timedelta(days=30)
    ups = await db.assistant_feedback.count_documents(
        {"user_id": user["user_id"], "rating": "up", "updated_at": {"$gte": since}}
    )
    downs = await db.assistant_feedback.count_documents(
        {"user_id": user["user_id"], "rating": "down", "updated_at": {"$gte": since}}
    )
    total = ups + downs
    return {
        "ups": ups,
        "downs": downs,
        "total": total,
        "satisfaction_rate": round((ups / total) * 100.0, 1) if total else None,
        "window_days": 30,
    }



# =========================================================================
# V42 — RAG Documenti Master (Axon leggi i PDF caricati dal Master)
#
# Il Master può caricare PDF (contratti, listini, brochure, formazioni) da
# una sezione "Documenti Axon" in Impostazioni. Ogni PDF viene:
#  1) Estratto (pypdf, primi 50 pagine)
#  2) Chunkizzato in blocchi ~500 parole con overlap ~50
#  3) Ogni chunk viene tokenizzato (via `_normalize_and_tokenize`) e salvato
#     in `db.master_doc_chunks` con `user_id`+`tenant_id`+`doc_id`.
#
# Al momento di rispondere a una query, `_retrieve_master_doc_chunks`:
#  - Tokenizza la query
#  - Cerca i chunks del tenant con Jaccard ≥ RAG_MIN_SIMILARITY (0.05)
#  - Ritorna top-K (default 3) chunks con relativo doc_name e page_number
# I chunks vengono iniettati nel system prompt in una sezione dedicata.
#
# Modello dati:
#  - db.master_documents: {doc_id, user_id, tenant_id, name, mime, size,
#    total_pages, total_chunks, created_at}
#  - db.master_doc_chunks: {chunk_id, doc_id, user_id, tenant_id, chunk_index,
#    page_range, content, tokens, created_at}
# =========================================================================

RAG_CHUNK_WORDS = 500        # ~ 350-400 tokens for Italian text
RAG_CHUNK_OVERLAP = 50       # word overlap between consecutive chunks
RAG_MAX_PAGES = 50           # cap pages per PDF (safety)
RAG_MIN_SIMILARITY = 0.05    # Jaccard threshold on query↔chunk tokens
RAG_TOP_K = 3                # chunks injected per query
RAG_MAX_PDF_BYTES = 20 * 1024 * 1024  # 20MB


def _chunk_text_by_words(text: str, size: int = RAG_CHUNK_WORDS, overlap: int = RAG_CHUNK_OVERLAP) -> List[str]:
    """Split a long text into overlapping word-chunks. Preserves original
    whitespace/newlines within each chunk when possible (splits on whitespace
    but re-joins with single space)."""
    if not text:
        return []
    words = text.split()
    if not words:
        return []
    chunks: List[str] = []
    step = max(1, size - overlap)
    i = 0
    while i < len(words):
        chunk_words = words[i:i + size]
        if not chunk_words:
            break
        chunks.append(" ".join(chunk_words))
        i += step
    return chunks


def _extract_pdf_pages(pdf_base64: str, max_pages: int = RAG_MAX_PAGES) -> List[Tuple[int, str]]:
    """Extract per-page text as `[(page_number, text), ...]`.
    page_number is 1-indexed. Skips pages that fail extraction."""
    b64 = pdf_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF base64 non valido: {e}")
    if len(raw) > RAG_MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail=f"PDF troppo grande (max {RAG_MAX_PDF_BYTES // (1024*1024)}MB)")
    pages: List[Tuple[int, str]] = []
    try:
        from pypdf import PdfReader
        from io import BytesIO
        reader = PdfReader(BytesIO(raw))
        for i, page in enumerate(reader.pages[:max_pages], start=1):
            try:
                t = (page.extract_text() or "").strip()
            except Exception:
                t = ""
            if t:
                pages.append((i, t))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Impossibile leggere PDF: {e}")
    return pages


class MasterDocIn(BaseModel):
    name: str
    mime: Optional[str] = "application/pdf"
    data_base64: Optional[str] = None
    # V50.z144 — Knowledge base: voci testuali (FAQ / dati ricorrenti / note) oltre ai PDF
    kind: Optional[str] = None           # "pdf" | "text" (auto-rilevato se assente)
    content: Optional[str] = None        # testo della voce (kind=text)
    category: Optional[str] = None       # "Documento" | "FAQ" | "Dati" | "Nota"


class MasterDocUpdateIn(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None


MASTER_DOC_CATEGORIES = ("Documento", "FAQ", "Dati", "Nota")
MASTER_DOC_TEXT_MAX_CHARS = 60000


def _require_master_docs_owner(user: dict, action: str = "gestire") -> None:
    if user.get("parent_user_id") or (user.get("role") or "member") != "owner":
        raise HTTPException(status_code=403, detail=f"Solo il Master può {action} la knowledge base di Axon")


def _decode_text_file_b64(data_base64: str) -> str:
    """V50.z144 — Decodifica un file di testo (txt/md/csv) in base64."""
    b64 = data_base64.split(",", 1)[1] if data_base64.startswith("data:") else data_base64
    try:
        raw = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File base64 non valido: {e}")
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("utf-8", errors="ignore")


def _build_master_doc_chunks(doc_id: str, uid: str, tid: str, pages: List[Tuple[int, str]], now) -> List[dict]:
    """Chunk ogni pagina/paragrafo e indicizza i token (usato da create + update)."""
    chunk_docs: List[dict] = []
    chunk_idx = 0
    for page_no, page_text in pages:
        page_chunks = _chunk_text_by_words(page_text)
        if not page_chunks:
            continue
        for c_text in page_chunks:
            _, tokens = _normalize_and_tokenize(c_text)
            if not tokens:
                continue
            chunk_docs.append({
                "chunk_id": uuid.uuid4().hex,
                "doc_id": doc_id,
                "user_id": uid,
                "tenant_id": tid,
                "chunk_index": chunk_idx,
                "page_number": page_no,
                "content": c_text[:4000],
                "tokens": tokens,
                "created_at": now,
            })
            chunk_idx += 1
    return chunk_docs


def _text_to_pages(title: str, content: str) -> List[Tuple[int, str]]:
    """Voce testuale → 'pagine' logiche (blocchi separati da riga vuota, ~1500 char) col titolo
    in testa a ogni blocco così il retrieval token/embedding aggancia anche il titolo."""
    content = (content or "").strip()
    if not content:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
    pages: List[Tuple[int, str]] = []
    buf = ""
    for p in paras:
        if buf and len(buf) + len(p) > 1500:
            pages.append((len(pages) + 1, f"{title}\n{buf}".strip()))
            buf = p
        else:
            buf = (buf + "\n\n" + p) if buf else p
    if buf:
        pages.append((len(pages) + 1, f"{title}\n{buf}".strip()))
    return pages


@api_router.post("/master-docs")
async def create_master_doc(body: MasterDocIn, user=Depends(get_current_user)):
    """Knowledge base Axon (MASTER-only): PDF, file di testo (txt/md/csv) o voce testuale
    (FAQ / dati ricorrenti / nota). Estrae il testo, lo divide in chunk e indicizza i token
    per il retrieval automatico prima di ogni risposta."""
    _require_master_docs_owner(user, "caricare documenti in")
    name = (body.name or "").strip()[:200]
    if not name:
        raise HTTPException(status_code=400, detail="Nome/titolo richiesto")
    mime = (body.mime or "").lower()
    kind = (body.kind or "").lower()
    if not kind:
        kind = "text" if (body.content and not body.data_base64) else "pdf"
    category = (body.category or "").strip()
    if category not in MASTER_DOC_CATEGORIES:
        category = "Documento" if kind == "pdf" else "Nota"

    tid = tenant_id(user)
    uid = user["user_id"]
    doc_id = uuid.uuid4().hex
    now = utcnow()
    approx_size = 0
    content_text: Optional[str] = None

    if kind == "text":
        content_text = (body.content or "").strip()
        if not content_text and body.data_base64:
            content_text = _decode_text_file_b64(body.data_base64).strip()
        if len(content_text) < 10:
            raise HTTPException(status_code=400, detail="Testo troppo breve (min 10 caratteri)")
        content_text = content_text[:MASTER_DOC_TEXT_MAX_CHARS]
        approx_size = len(content_text.encode("utf-8"))
        mime = mime or "text/plain"
        pages = _text_to_pages(name, content_text)
    else:
        if not body.data_base64:
            raise HTTPException(status_code=400, detail="File richiesto")
        is_pdf = "pdf" in mime or name.lower().endswith(".pdf")
        is_textfile = any(name.lower().endswith(ext) for ext in (".txt", ".md", ".csv")) or mime.startswith("text/")
        if not is_pdf and not is_textfile:
            raise HTTPException(status_code=400, detail="Formati supportati: PDF, TXT, MD, CSV oppure voce testuale")
        b64 = body.data_base64.split(",", 1)[1] if body.data_base64.startswith("data:") else body.data_base64
        approx_size = int(len(b64) * 3 / 4)
        if is_pdf:
            mime = mime or "application/pdf"
            pages = _extract_pdf_pages(body.data_base64)
            if not pages:
                raise HTTPException(status_code=400, detail="Il PDF non contiene testo estraibile (potrebbe essere scannerizzato)")
        else:
            kind = "text"
            mime = mime or "text/plain"
            content_text = _decode_text_file_b64(body.data_base64).strip()[:MASTER_DOC_TEXT_MAX_CHARS]
            if len(content_text) < 10:
                raise HTTPException(status_code=400, detail="Il file di testo è vuoto")
            pages = _text_to_pages(name, content_text)

    chunk_docs = _build_master_doc_chunks(doc_id, uid, tid, pages, now)
    if not chunk_docs:
        raise HTTPException(status_code=400, detail="Nessun testo utile trovato")

    doc = {
        "doc_id": doc_id,
        "user_id": uid,
        "tenant_id": tid,
        "name": name,
        "mime": mime,
        "kind": kind,
        "category": category,
        "size": approx_size,
        "total_pages": len(pages),
        "total_chunks": len(chunk_docs),
        "created_at": now,
        "updated_at": now,
    }
    if content_text is not None:
        doc["content"] = content_text
    await db.master_documents.insert_one(doc)
    try:
        await db.master_doc_chunks.insert_many(chunk_docs, ordered=False)
    except Exception as exc:
        logger.warning("[master-docs] chunk insert failed: %s", exc)
        await db.master_documents.delete_one({"doc_id": doc_id})
        raise HTTPException(status_code=500, detail="Salvataggio chunks fallito")

    return {
        "doc_id": doc_id,
        "name": name,
        "kind": kind,
        "category": category,
        "total_pages": len(pages),
        "total_chunks": len(chunk_docs),
        "size": approx_size,
        "created_at": now.isoformat(),
    }


@api_router.put("/master-docs/{doc_id}")
async def update_master_doc(doc_id: str, body: MasterDocUpdateIn, user=Depends(get_current_user)):
    """V50.z144 — Aggiorna una voce della knowledge base (MASTER-only): rinomina / categoria per
    tutti; per le voci testuali anche il contenuto (re-chunk + re-index, embeddings ricalcolati lazy)."""
    _require_master_docs_owner(user, "modificare")
    tid = tenant_id(user)
    doc = await db.master_documents.find_one({"doc_id": doc_id, "tenant_id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    upd: dict = {"updated_at": utcnow()}
    if body.name is not None:
        nm = body.name.strip()[:200]
        if not nm:
            raise HTTPException(status_code=400, detail="Nome/titolo richiesto")
        upd["name"] = nm
    if body.category is not None:
        if body.category not in MASTER_DOC_CATEGORIES:
            raise HTTPException(status_code=400, detail=f"Categoria non valida ({', '.join(MASTER_DOC_CATEGORIES)})")
        upd["category"] = body.category
    reindexed = False
    if body.content is not None:
        if (doc.get("kind") or "pdf") != "text":
            raise HTTPException(status_code=400, detail="Il contenuto è modificabile solo per le voci testuali")
        content_text = body.content.strip()[:MASTER_DOC_TEXT_MAX_CHARS]
        if len(content_text) < 10:
            raise HTTPException(status_code=400, detail="Testo troppo breve (min 10 caratteri)")
        title = upd.get("name") or doc.get("name") or ""
        pages = _text_to_pages(title, content_text)
        chunk_docs = _build_master_doc_chunks(doc_id, doc.get("user_id") or user["user_id"], tid, pages, upd["updated_at"])
        if not chunk_docs:
            raise HTTPException(status_code=400, detail="Nessun testo utile trovato")
        await db.master_doc_chunks.delete_many({"doc_id": doc_id})
        await db.master_doc_chunks.insert_many(chunk_docs, ordered=False)
        upd.update({"content": content_text, "size": len(content_text.encode("utf-8")),
                    "total_pages": len(pages), "total_chunks": len(chunk_docs)})
        reindexed = True
    elif "name" in upd and (doc.get("kind") or "pdf") == "text" and doc.get("content"):
        # Il titolo è parte dei chunk testuali → re-index leggero
        pages = _text_to_pages(upd["name"], doc["content"])
        chunk_docs = _build_master_doc_chunks(doc_id, doc.get("user_id") or user["user_id"], tid, pages, upd["updated_at"])
        if chunk_docs:
            await db.master_doc_chunks.delete_many({"doc_id": doc_id})
            await db.master_doc_chunks.insert_many(chunk_docs, ordered=False)
            upd.update({"total_pages": len(pages), "total_chunks": len(chunk_docs)})
            reindexed = True
    await db.master_documents.update_one({"doc_id": doc_id}, {"$set": upd})
    out = await db.master_documents.find_one({"doc_id": doc_id}, {"_id": 0})
    for k in ("created_at", "updated_at"):
        if hasattr(out.get(k), "isoformat"):
            out[k] = out[k].isoformat()
    out["reindexed"] = reindexed
    return out



@api_router.get("/master-docs")
async def list_master_docs(user=Depends(get_current_user)):
    """List all Axon docs for the Master's tenant. Both Master and members can list;
    only Master can upload/delete (uses `assistant` intelligence for everyone)."""
    tid = tenant_id(user)
    cursor = db.master_documents.find(
        {"tenant_id": tid},
        {"_id": 0, "content": 0},  # V50.z144 — il contenuto testuale si legge da GET /master-docs/{id}
    ).sort("created_at", -1)
    items = [d async for d in cursor]
    # Serialize dates
    for it in items:
        it.setdefault("kind", "pdf")
        it.setdefault("category", "Documento")
        for k in ("created_at", "updated_at"):
            v = it.get(k)
            if hasattr(v, "isoformat"):
                it[k] = v.isoformat()
    return {"items": items, "total": len(items)}


@api_router.get("/master-docs/{doc_id}")
async def get_master_doc(doc_id: str, user=Depends(get_current_user)):
    """V50.z144 — Dettaglio voce knowledge base (incluso il testo per le voci testuali)."""
    tid = tenant_id(user)
    doc = await db.master_documents.find_one({"doc_id": doc_id, "tenant_id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    doc.setdefault("kind", "pdf")
    doc.setdefault("category", "Documento")
    for k in ("created_at", "updated_at"):
        if hasattr(doc.get(k), "isoformat"):
            doc[k] = doc[k].isoformat()
    return doc


@api_router.delete("/master-docs/{doc_id}")
async def delete_master_doc(doc_id: str, user=Depends(get_current_user)):
    """Delete a doc + its chunks. MASTER-only."""
    if user.get("parent_user_id") or (user.get("role") or "member") != "owner":
        raise HTTPException(status_code=403, detail="Solo il Master può eliminare documenti Axon")
    tid = tenant_id(user)
    doc = await db.master_documents.find_one({"doc_id": doc_id, "tenant_id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    await db.master_documents.delete_one({"doc_id": doc_id})
    r = await db.master_doc_chunks.delete_many({"doc_id": doc_id})
    return {"ok": True, "deleted_chunks": r.deleted_count}


# =========================================================================
# V43 — Auto-Extract Rule Proposals for "Insegna ad Axon"
#
# A nightly job scans the previous 48h of Axon chats per tenant, identifies
# recurring patterns / procedural questions / customer objections, and asks
# Claude Sonnet 5 to draft 3-5 rule proposals. Each proposal is saved as
# "pending" in db.axon_rule_proposals; the Master reviews and accepts/rejects
# them from the /ai-teach page. Accepted proposals convert into real
# `ai_teach_rules` entries so the assistant follows them from the next
# conversation onwards.
# =========================================================================

RULE_PROPOSAL_TENANT_MIN_MSGS = 6  # skip tenants with too little data
RULE_PROPOSAL_LOOKBACK_HOURS = 48
RULE_PROPOSAL_MAX_PENDING = 15     # cap pending proposals per tenant
RULE_PROPOSAL_MAX_PER_RUN = 5      # cap new proposals per run per tenant

_RULE_PROPOSAL_CATEGORIES = [
    "Clienti", "Contratti", "Comunicazioni", "Luce", "Gas", "Telco",
    "Obiezioni", "Procedure", "Generale",
]


async def _analyze_chats_for_rules(
    assistant_name: str,
    messages: List[dict],
    already_pending_titles: List[str],
    existing_rule_titles: List[str],
) -> List[dict]:
    """Ask the LLM to distil rule proposals from a conversation dump.
    Each proposal has: {title, category, text, evidence (short quote)}."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key or not messages:
        return []

    # Build a compact dialog dump
    lines: List[str] = []
    for m in messages[-60:]:  # last 60 messages max
        role = "USER" if m.get("role") == "user" else assistant_name.upper()
        content = (m.get("content") or "").replace("\n", " ").strip()
        if not content:
            continue
        lines.append(f"[{role}] {content[:400]}")
    dialog = "\n".join(lines)
    if len(dialog) < 200:
        return []

    avoid_titles = list(set([t for t in (already_pending_titles + existing_rule_titles) if t]))
    cats_csv = ", ".join(_RULE_PROPOSAL_CATEGORIES)

    system_prompt = (
        "Sei un analista specializzato nel migliorare le risposte di un assistente AI (Axon) "
        "per consulenti energetici in Italia. Il tuo compito è ANALIZZARE una serie di chat "
        f"reali degli ultimi 2 giorni e proporre da 1 a {RULE_PROPOSAL_MAX_PER_RUN} REGOLE nuove, "
        "concrete e utili da aggiungere alla base di conoscenza \"Insegna ad Axon\".\n\n"
        "CRITERI PER PROPORRE UNA REGOLA:\n"
        "- Deve emergere un pattern RICORRENTE (domanda simile ripetuta, obiezione tipica, "
        "  procedura interna, definizione tecnica poco conosciuta).\n"
        "- NON proporre nulla su dati CRM specifici (nomi clienti, appuntamenti singoli).\n"
        "- NON duplicare regole già esistenti (te ne fornirò l'elenco titoli).\n"
        "- La regola deve essere ISTRUTTIVA per l'assistente: 'quando ti chiedono X, rispondi con Y'.\n"
        "- Titoli brevi (max 60 char), text 2-6 righe.\n"
        "- Categoria SEMPRE una tra: " + cats_csv + ".\n\n"
        "OUTPUT: JSON puro (nessun markdown, no ```). Formato ESATTO:\n"
        "{\n"
        "  \"proposals\": [\n"
        "    {\"title\": \"...\", \"category\": \"...\", \"text\": \"...\", \"evidence\": \"citazione breve\"},\n"
        "  ]\n"
        "}\n"
        "Se nessun pattern chiaro emerge, restituisci {\"proposals\": []}."
    )

    user_prompt = (
        "Regole già esistenti (NON duplicare): " + (", ".join(avoid_titles[:30]) or "nessuna") + "\n\n"
        "=== CHAT DEGLI ULTIMI 2 GIORNI ===\n"
        f"{dialog[:15000]}"
    )

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        session = f"rule_proposals_{uuid.uuid4().hex[:8]}"
        chat = LlmChat(api_key=key, session_id=session, system_message=system_prompt).with_model(
            "anthropic", "claude-sonnet-5"
        )
        reply = await chat.send_message(UserMessage(text=user_prompt))
    except Exception as exc:
        logger.warning("[rule-proposals] LLM call failed: %s", exc)
        return []

    # Robust JSON parsing (strip possible code fences even though we asked not to)
    txt = (reply or "").strip()
    if txt.startswith("```"):
        txt = txt.strip("`")
        if txt.lower().startswith("json"):
            txt = txt[4:].strip()
    import json as _json
    try:
        data = _json.loads(txt)
    except Exception:
        # try to find a JSON block
        import re as _re
        m = _re.search(r"\{[\s\S]*\}", txt)
        if not m:
            logger.warning("[rule-proposals] LLM did not return JSON")
            return []
        try:
            data = _json.loads(m.group(0))
        except Exception as exc:
            logger.warning("[rule-proposals] JSON parse failed: %s", exc)
            return []
    props = data.get("proposals") if isinstance(data, dict) else None
    if not isinstance(props, list):
        return []
    out: List[dict] = []
    for p in props[:RULE_PROPOSAL_MAX_PER_RUN]:
        if not isinstance(p, dict):
            continue
        title = str(p.get("title") or "").strip()[:200]
        text = str(p.get("text") or "").strip()
        category = str(p.get("category") or "Generale").strip()
        evidence = str(p.get("evidence") or "").strip()[:400]
        if not title or not text or len(text) < 30:
            continue
        if category not in _RULE_PROPOSAL_CATEGORIES:
            category = "Generale"
        out.append({
            "title": title,
            "category": category,
            "text": text,
            "evidence": evidence,
        })
    return out


async def _run_rule_proposals_job() -> Dict[str, Any]:
    """Cron entrypoint. Iterates every tenant with recent chat activity and
    persists new rule proposals. Idempotent-friendly (skips titles already
    pending / accepted). Safe to call manually via /axon/rule-proposals/run-now.
    """
    started = utcnow()
    since = started - timedelta(hours=RULE_PROPOSAL_LOOKBACK_HOURS)
    stats = {"started_at": started.isoformat(), "tenants_scanned": 0, "proposals_created": 0}

    # Find tenants with recent chat activity (unique user_ids)
    active_users = await db.assistant_messages.distinct(
        "user_id", {"created_at": {"$gte": since}}
    )
    for uid in active_users:
        # Determine tenant_id from the user record
        user_doc = await db.users.find_one({"user_id": uid}, {"_id": 0, "parent_user_id": 1, "user_id": 1})
        if not user_doc:
            continue
        tid = user_doc.get("parent_user_id") or user_doc.get("user_id")
        if not tid:
            continue

        # Cap pending backlog per tenant
        pending_count = await db.axon_rule_proposals.count_documents(
            {"tenant_id": tid, "status": "pending"}
        )
        if pending_count >= RULE_PROPOSAL_MAX_PENDING:
            continue

        # Pull all messages in the window for that tenant
        tenant_users = await db.users.distinct(
            "user_id", {"$or": [{"user_id": tid}, {"parent_user_id": tid}]}
        )
        cursor = db.assistant_messages.find(
            {"user_id": {"$in": tenant_users}, "created_at": {"$gte": since}},
            {"_id": 0, "role": 1, "content": 1, "created_at": 1},
        ).sort("created_at", 1)
        msgs = [m async for m in cursor]
        if len(msgs) < RULE_PROPOSAL_TENANT_MIN_MSGS:
            continue

        stats["tenants_scanned"] += 1

        # Compute avoid-titles = pending + accepted + existing ai_teach_rules
        pending_docs = await db.axon_rule_proposals.find(
            {"tenant_id": tid, "status": {"$in": ["pending", "accepted"]}},
            {"_id": 0, "title": 1},
        ).to_list(200)
        pending_titles = [p.get("title") for p in pending_docs if p.get("title")]
        rules_docs = await db.ai_teach_rules.find(
            {"user_id": tid},
            {"_id": 0, "title": 1},
        ).to_list(200)
        existing_titles = [r.get("title") for r in rules_docs if r.get("title")]

        # Resolve Master assistant name for prompt
        try:
            master = await db.users.find_one({"user_id": tid}, {"_id": 0})
            asst_name = await _get_assistant_name(master or {"user_id": tid})
        except Exception:
            asst_name = "Axon"

        try:
            proposals = await _analyze_chats_for_rules(
                assistant_name=asst_name,
                messages=msgs,
                already_pending_titles=pending_titles,
                existing_rule_titles=existing_titles,
            )
        except Exception as exc:
            logger.warning("[rule-proposals] analysis failed for tenant %s: %s", tid, exc)
            proposals = []

        # Persist (with dedupe on case-insensitive title within tenant)
        existing_ci = set(t.lower() for t in pending_titles + existing_titles if t)
        for p in proposals:
            if p["title"].lower() in existing_ci:
                continue
            existing_ci.add(p["title"].lower())
            await db.axon_rule_proposals.insert_one({
                "proposal_id": uuid.uuid4().hex,
                "tenant_id": tid,
                "title": p["title"],
                "category": p["category"],
                "text": p["text"],
                "evidence": p["evidence"],
                "source_message_count": len(msgs),
                "status": "pending",
                "created_at": utcnow(),
                "updated_at": utcnow(),
            })
            stats["proposals_created"] += 1

    stats["finished_at"] = utcnow().isoformat()
    logger.info("[rule-proposals] job done: %s", stats)
    return stats


# ---- Endpoints ---------------------------------------------------------

@api_router.get("/axon/rule-proposals")
async def list_rule_proposals(status: str = "pending", user=Depends(get_current_user)):
    """List rule proposals (default: pending) for the current tenant. Master-only."""
    _require_master(user)
    tid = tenant_id(user)
    if status not in ("pending", "accepted", "rejected", "all"):
        raise HTTPException(status_code=400, detail="status non valido")
    q: Dict[str, Any] = {"tenant_id": tid}
    if status != "all":
        q["status"] = status
    cursor = db.axon_rule_proposals.find(q, {"_id": 0}).sort("created_at", -1).limit(100)
    items = [d async for d in cursor]
    # Serialize dates
    for it in items:
        for k in ("created_at", "updated_at"):
            v = it.get(k)
            if hasattr(v, "isoformat"):
                it[k] = v.isoformat()
    # Stats footer
    counts = {
        "pending": await db.axon_rule_proposals.count_documents({"tenant_id": tid, "status": "pending"}),
        "accepted": await db.axon_rule_proposals.count_documents({"tenant_id": tid, "status": "accepted"}),
        "rejected": await db.axon_rule_proposals.count_documents({"tenant_id": tid, "status": "rejected"}),
    }
    return {"items": items, "total": len(items), "counts": counts}


@api_router.post("/axon/rule-proposals/{proposal_id}/accept")
async def accept_rule_proposal(proposal_id: str, user=Depends(get_current_user)):
    """Convert a pending proposal into a real ai_teach_rules entry. Master-only.
    The proposal is marked `accepted` (not deleted) so we can display history."""
    _require_master(user)
    tid = tenant_id(user)
    prop = await db.axon_rule_proposals.find_one(
        {"proposal_id": proposal_id, "tenant_id": tid},
        {"_id": 0},
    )
    if not prop:
        raise HTTPException(status_code=404, detail="Proposta non trovata")
    if prop.get("status") == "accepted":
        raise HTTPException(status_code=400, detail="Proposta già accettata")

    # Create real rule
    rid = f"aitr_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    cat = prop.get("category") or "Generale"
    rule_doc = {
        "rule_id": rid,
        "user_id": tid,  # tenant scope
        "created_by": user["user_id"],
        "categories": [cat],
        "category": cat,
        "title": prop.get("title") or "Regola",
        "text": prop.get("text") or "",
        "files": [],
        "auto_generated": True,
        "source_proposal_id": proposal_id,
        "created_at": now,
        "updated_at": now,
    }
    await db.ai_teach_rules.insert_one(rule_doc)

    await db.axon_rule_proposals.update_one(
        {"proposal_id": proposal_id, "tenant_id": tid},
        {"$set": {"status": "accepted", "accepted_rule_id": rid, "updated_at": now}},
    )
    return {"ok": True, "rule_id": rid}


@api_router.post("/axon/rule-proposals/{proposal_id}/reject")
async def reject_rule_proposal(proposal_id: str, user=Depends(get_current_user)):
    """Mark a proposal as rejected. Master-only."""
    _require_master(user)
    tid = tenant_id(user)
    r = await db.axon_rule_proposals.update_one(
        {"proposal_id": proposal_id, "tenant_id": tid, "status": "pending"},
        {"$set": {"status": "rejected", "updated_at": utcnow()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Proposta non trovata o già gestita")
    return {"ok": True}


@api_router.get("/axon/rule-proposals/count-pending")
async def count_pending_rule_proposals(user=Depends(get_current_user)):
    """V45 — Lightweight endpoint to power the "red dot" badge on the
    "Insegna ad Axon" entry point. Non-Master users always see 0."""
    if user.get("parent_user_id") or (user.get("role") or "member") != "owner":
        return {"pending": 0}
    tid = tenant_id(user)
    n = await db.axon_rule_proposals.count_documents({"tenant_id": tid, "status": "pending"})
    return {"pending": n}


@api_router.post("/axon/rule-proposals/run-now")
async def run_rule_proposals_now(user=Depends(get_current_user)):
    """Manually trigger the rule-proposal analysis for the current user's tenant.
    Useful for testing without waiting for the nightly cron. Master-only."""
    _require_master(user)
    tid = tenant_id(user)
    since = utcnow() - timedelta(hours=RULE_PROPOSAL_LOOKBACK_HOURS)
    pending_count = await db.axon_rule_proposals.count_documents({"tenant_id": tid, "status": "pending"})
    if pending_count >= RULE_PROPOSAL_MAX_PENDING:
        return {"ok": False, "reason": f"Massimo {RULE_PROPOSAL_MAX_PENDING} proposte in coda già raggiunto"}

    tenant_users = await db.users.distinct(
        "user_id", {"$or": [{"user_id": tid}, {"parent_user_id": tid}]}
    )
    cursor = db.assistant_messages.find(
        {"user_id": {"$in": tenant_users}, "created_at": {"$gte": since}},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", 1)
    msgs = [m async for m in cursor]
    if len(msgs) < RULE_PROPOSAL_TENANT_MIN_MSGS:
        return {"ok": False, "reason": f"Non abbastanza chat negli ultimi {RULE_PROPOSAL_LOOKBACK_HOURS}h (minimo {RULE_PROPOSAL_TENANT_MIN_MSGS} messaggi)"}

    pending_docs = await db.axon_rule_proposals.find(
        {"tenant_id": tid, "status": {"$in": ["pending", "accepted"]}},
        {"_id": 0, "title": 1},
    ).to_list(200)
    pending_titles = [p.get("title") for p in pending_docs if p.get("title")]
    rules_docs = await db.ai_teach_rules.find({"user_id": tid}, {"_id": 0, "title": 1}).to_list(200)
    existing_titles = [r.get("title") for r in rules_docs if r.get("title")]

    try:
        asst_name = await _get_assistant_name(user)
    except Exception:
        asst_name = "Axon"

    proposals = await _analyze_chats_for_rules(
        assistant_name=asst_name,
        messages=msgs,
        already_pending_titles=pending_titles,
        existing_rule_titles=existing_titles,
    )
    created = 0
    existing_ci = set(t.lower() for t in pending_titles + existing_titles if t)
    for p in proposals:
        if p["title"].lower() in existing_ci:
            continue
        existing_ci.add(p["title"].lower())
        await db.axon_rule_proposals.insert_one({
            "proposal_id": uuid.uuid4().hex,
            "tenant_id": tid,
            "title": p["title"],
            "category": p["category"],
            "text": p["text"],
            "evidence": p["evidence"],
            "source_message_count": len(msgs),
            "status": "pending",
            "created_at": utcnow(),
            "updated_at": utcnow(),
        })
        created += 1
    return {"ok": True, "proposals_created": created, "analyzed_messages": len(msgs)}


# V50.z51 — Endpoint admin per gestire la memoria distillata del tenant.
@api_router.get("/axon/tenant-memory")
async def get_axon_tenant_memory(user=Depends(get_current_user)):
    """Ritorna il summary distillato del tenant (Master-only). Se non esiste
    ancora, ritorna vuoto (il job notturno lo genera automaticamente)."""
    _require_master(user)
    tid = tenant_id(user)
    doc = await db.axon_tenant_memory.find_one({"tenant_id": tid}, {"_id": 0})
    if not doc:
        return {"exists": False, "summary": "", "facts": [], "updated_at": None}
    return {
        "exists": True,
        "summary": doc.get("summary") or "",
        "facts": doc.get("facts") or [],
        "message_count": doc.get("message_count") or 0,
        "lookback_days": doc.get("lookback_days") or AXON_MEMORY_LOOKBACK_DAYS,
        "updated_at": doc.get("updated_at"),
    }


@api_router.post("/axon/tenant-memory/run-now")
async def run_axon_memory_now(user=Depends(get_current_user)):
    """Trigger manuale del job di distillazione per il tenant corrente
    (Master-only). Utile per verificare senza aspettare il cron delle 04:00."""
    _require_master(user)
    tid = tenant_id(user)
    since = utcnow() - timedelta(days=AXON_MEMORY_LOOKBACK_DAYS)
    msgs_cur = db.assistant_messages.find(
        {"user_id": tid, "created_at": {"$gte": since}},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1},
    ).sort("created_at", 1).limit(AXON_MEMORY_MAX_MESSAGES)
    msgs = [m async for m in msgs_cur]
    if len(msgs) < AXON_MEMORY_MIN_MESSAGES:
        return {"ok": False, "reason": f"Servono almeno {AXON_MEMORY_MIN_MESSAGES} messaggi negli ultimi {AXON_MEMORY_LOOKBACK_DAYS}gg (attuali: {len(msgs)})"}
    distilled = await _distill_tenant_memory(tid, msgs)
    if not distilled:
        return {"ok": False, "reason": "Distillazione LLM fallita o output vuoto"}
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
    return {
        "ok": True,
        "summary": distilled["summary"],
        "facts": distilled["facts"],
        "message_count": len(msgs),
    }


@api_router.delete("/axon/tenant-memory")
async def delete_axon_tenant_memory(user=Depends(get_current_user)):
    """Cancella la memoria distillata del tenant (Master-only). Verrà
    rigenerata al prossimo cron notturno."""
    _require_master(user)
    tid = tenant_id(user)
    r = await db.axon_tenant_memory.delete_one({"tenant_id": tid})
    return {"ok": True, "deleted": r.deleted_count}





# V50.l — RAG semantico con embeddings OpenAI text-embedding-3-small.
# Migliora drasticamente il retrieve quando l'utente scrive con parole
# diverse rispetto al contenuto dei documenti (sinonimi, forme flesse,
# rimescolamento). Embeddings sono cachati nel chunk (`embedding` field)
# così il costo di embed è pagato UNA VOLTA per chunk (all'ingestion o al
# primo retrieve). Query embedding è calcolato al volo (~50ms).
_EMBEDDING_MODEL = "text-embedding-3-small"
_EMBEDDING_DIM = 1536  # dimensione output text-embedding-3-small
_EMBEDDING_URL = "https://integrations.emergentagent.com/llm/openai/v1/embeddings"


async def _axon_embed(text: str) -> Optional[List[float]]:
    """Ritorna il vettore embedding di `text` via OpenAI proxy Emergent.
    Best-effort: se il proxy fallisce o la chiave manca, ritorna None e il
    caller cadrà nel fallback Jaccard."""
    text = (text or "").strip()
    if not text:
        return None
    key = os.getenv("EMERGENT_LLM_KEY", "")
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.post(
                _EMBEDDING_URL,
                headers={"Authorization": f"Bearer {key}"},
                json={"model": _EMBEDDING_MODEL, "input": text[:8000]},
            )
        if r.status_code != 200:
            return None
        data = r.json().get("data") or []
        if not data:
            return None
        emb = data[0].get("embedding")
        if not emb or len(emb) != _EMBEDDING_DIM:
            return None
        return emb
    except Exception as exc:
        logger.debug("[axon-embed] failed: %s", exc)
        return None


def _cosine_sim(a: List[float], b: List[float]) -> float:
    """Similitudine coseno tra due vettori (assunti pre-normalizzati o meno)."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na ** 0.5 * nb ** 0.5)


async def _retrieve_master_doc_chunks(
    tenant: str,
    query: str,
    top_k: int = RAG_TOP_K,
    min_sim: float = RAG_MIN_SIMILARITY,
) -> List[dict]:
    """Retrieve top-K most relevant chunks for a query, scoped to a tenant.
    V50.l — Uso embeddings semantici come primary + Jaccard come fallback.
    Se `embedding` non è ancora presente sul chunk, viene calcolato una
    tantum e persistito (lazy compute) durante il primo retrieve rilevante.
    """
    _, q_tokens = _normalize_and_tokenize(query)
    if not q_tokens:
        return []

    # STEP 1: Prefiltro Jaccard classico (pre-scoring veloce su indice tokens)
    cursor = db.master_doc_chunks.find(
        {"tenant_id": tenant, "tokens": {"$in": q_tokens}},
        {"_id": 0, "chunk_id": 1, "doc_id": 1, "content": 1, "tokens": 1,
         "page_number": 1, "embedding": 1},
    ).limit(500)  # safety cap on candidates
    prelim: List[dict] = []
    async for c in cursor:
        jsim = _jaccard(q_tokens, c.get("tokens") or [])
        c["_jscore"] = jsim
        prelim.append(c)

    if not prelim:
        return []

    # STEP 2: Query embedding (async, best-effort)
    q_emb = await _axon_embed(query)

    # STEP 3: Se ho l'embedding query, riordino i top candidati per cosine sim.
    # Per limitare il costo, calcolo embeddings dei chunk mancanti solo sui
    # top-40 per jaccard (non su tutti i 500). Lazy compute + persist.
    if q_emb:
        prelim.sort(key=lambda x: x.get("_jscore", 0.0), reverse=True)
        candidates = prelim[:40]
        # Chunk senza embedding → embed in parallelo e persist
        missing = [c for c in candidates if not c.get("embedding")]
        if missing:
            async def _embed_and_save(chunk: dict) -> None:
                emb = await _axon_embed(chunk.get("content") or "")
                if emb:
                    chunk["embedding"] = emb
                    try:
                        await db.master_doc_chunks.update_one(
                            {"chunk_id": chunk["chunk_id"]},
                            {"$set": {"embedding": emb}},
                        )
                    except Exception:
                        pass
            await asyncio.gather(*[_embed_and_save(c) for c in missing[:12]])

        # Cosine sim vs query embedding
        for c in candidates:
            emb = c.get("embedding")
            if emb:
                c["_score"] = _cosine_sim(q_emb, emb)
            else:
                # Chunk senza embedding (skippato per limite budget) → usa jaccard scalato
                c["_score"] = max(0.0, c.get("_jscore", 0.0) * 0.5)
        # Soglia semantica più permissiva (0.35 su cosine ≈ semanticamente rilevante)
        scored = [c for c in candidates if c.get("_score", 0.0) >= 0.35]
        scored.sort(key=lambda x: x.get("_score", 0.0), reverse=True)
        top = scored[:top_k]
    else:
        # Fallback: pura Jaccard con soglia originale
        scored = [c for c in prelim if c.get("_jscore", 0.0) >= min_sim]
        for c in scored:
            c["_score"] = c.get("_jscore", 0.0)
        scored.sort(key=lambda x: x.get("_score", 0.0), reverse=True)
        top = scored[:top_k]

    if not top:
        return []

    # Cleanup + enrich con doc name
    for c in top:
        c.pop("embedding", None)
        c.pop("_jscore", None)
    doc_ids = list({c["doc_id"] for c in top})
    doc_map: Dict[str, dict] = {}
    docs_cursor = db.master_documents.find(
        {"doc_id": {"$in": doc_ids}, "tenant_id": tenant},
        {"_id": 0, "doc_id": 1, "name": 1, "kind": 1, "category": 1},
    )
    async for d in docs_cursor:
        doc_map[d["doc_id"]] = d
    for c in top:
        d = doc_map.get(c["doc_id"]) or {}
        c["doc_name"] = d.get("name") or "?"
        c["doc_kind"] = d.get("kind") or "pdf"           # V50.z144
        c["doc_category"] = d.get("category") or "Documento"
    return top


# =========================================================================
