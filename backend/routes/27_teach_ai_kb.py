# 27_teach_ai_kb.py — Insegna ad Axon (knowledge base Master)
# Estratto da server.py (righe originali 18649-20293). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V27 — "Insegna all'AI" (Master-only knowledge base)
#   - Manual rules per category (luce | gas | telco) with optional PDF files
#   - URL watchlist refreshed via Tavily by frequency (daily/weekly/monthly)
#   - Content is prepended to bill-analysis system prompts as priority context
# =========================================================================

class AiTeachFileIn(BaseModel):
    name: str
    mime: str
    data_base64: str

class AiTeachRuleIn(BaseModel):
    # V28.g — Categorie libere (es. Clienti, Contratti, Comunicazioni, Luce, Gas, Telco, Generale).
    # V28.n — Ora supportiamo MULTI-CATEGORIA. `categories` è la lista canonica; `category`
    # resta per retrocompatibilità (lo espandiamo automaticamente in [category] se `categories` è vuoto).
    category: Optional[str] = None
    categories: List[str] = Field(default_factory=list)
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)
    files: List[AiTeachFileIn] = Field(default_factory=list)
    # V50.z53 — Il flag deve essere sempre esplicito (True per proposte auto,
    # False per regole manuali del Master). Default False = manuale ad alta
    # priorità nella nuova logica PINNED.
    auto_generated: bool = False

class AiTeachRulePatch(BaseModel):
    category: Optional[str] = None
    categories: Optional[List[str]] = None
    title: Optional[str] = None
    text: Optional[str] = None
    files: Optional[List[AiTeachFileIn]] = None

class AiTeachUrlIn(BaseModel):
    url: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    category: Optional[str] = "generic"
    # V28.g — added "manual": no automated refresh; user forces it via "Aggiorna ora"
    frequency: Literal["manual", "daily", "weekly", "monthly"] = "weekly"
    username: Optional[str] = None
    password: Optional[str] = None
    # V49.f — Regole di lettura dell'URL: quali sezioni/sotto-link aprire,
    # quali contenuti estrarre e quali ignorare. Testo libero passato ad Axon
    # come istruzioni durante il fetch/summary.
    reading_rules: Optional[str] = None

class AiTeachUrlPatch(BaseModel):
    url: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    frequency: Optional[Literal["manual", "daily", "weekly", "monthly"]] = None
    username: Optional[str] = None
    password: Optional[str] = None
    reading_rules: Optional[str] = None


def _require_master(user: Dict[str, Any]) -> None:
    """Only owners (Master) can access this feature."""
    if (user.get("role") or "member") != "owner":
        raise HTTPException(status_code=403, detail="Sezione riservata al Master")


def _require_super_master(user: Dict[str, Any]) -> None:
    """V50.v — Super Master gate for cross-tenant / platform-wide features
    (es. Libretto Informativo globale).

    Environment: `SUPER_MASTER_EMAILS` — CSV di email autorizzate
      (case-insensitive). Se non impostata, autorizza qualsiasi owner
      (retro-compatibile per l'MVP).
    """
    import os as _os
    emails_env = (_os.environ.get("SUPER_MASTER_EMAILS") or "").strip()
    email = (user.get("email") or "").strip().lower()
    if emails_env:
        allowed = {e.strip().lower() for e in emails_env.split(",") if e.strip()}
        if email not in allowed:
            raise HTTPException(status_code=403, detail="Sezione riservata al Super Master")
    else:
        # Fallback MVP: qualsiasi owner tenant può modificare
        if (user.get("role") or "member") != "owner":
            raise HTTPException(status_code=403, detail="Sezione riservata al Super Master")


# ─── V50.v — Libretto Informativo: contenuto EDITABILE dal Super Master ──────
# Singleton document nella collection `libretto_content` (`_id = "global"`).
# Struttura: { meta: {...}, sections: [...], updated_at, updated_by }.
# Se il documento non esiste, il GET risponde con `{ sections: [], meta: {} }`
# e il frontend userà il fallback statico (LIBRETTO_SECTIONS) come default.

class LibrettoTip(BaseModel):
    emoji: str = ""
    text: str = ""


class LibrettoMockup(BaseModel):
    title: str = ""
    lines: List[str] = Field(default_factory=list)


class LibrettoSectionIn(BaseModel):
    id: str
    icon: str = "book"
    emoji: str = "📘"
    color: str = "#1C4869"
    title: str
    subtitle: Optional[str] = None
    paragraphs: List[str] = Field(default_factory=list)
    tips: List[LibrettoTip] = Field(default_factory=list)
    mockup: Optional[LibrettoMockup] = None
    warning: Optional[str] = None
    # Immagine: chiave asset bundled (mantiene compatibilità con default)
    # oppure data URL (base64) caricato dal master.
    image_key: Optional[str] = None
    image_data_url: Optional[str] = None


class LibrettoMetaIn(BaseModel):
    title: str = "Libretto Informativo"
    subtitle: str = "AdvisorOS + AxonOS · Guida operativa completa"
    version: str = "1.0"
    footer: str = "© AdvisorOS. Documento generato dall'app."


class LibrettoContentIn(BaseModel):
    meta: LibrettoMetaIn
    sections: List[LibrettoSectionIn]


@api_router.get("/libretto/permission")
async def libretto_permission(user=Depends(get_current_user)):
    """Verifica se l'utente corrente può modificare il libretto (Super Master)."""
    try:
        _require_super_master(user)
        return {"can_edit": True}
    except HTTPException:
        return {"can_edit": False}


@api_router.get("/libretto/content")
async def libretto_get_content(user=Depends(get_current_user)):
    """Ritorna il contenuto del libretto salvato dal Super Master.

    Se non esiste, ritorna un documento vuoto: il frontend userà il default
    statico. Accessibile a QUALSIASI utente autenticato (i clienti leggono).
    """
    doc = await db.libretto_content.find_one({"_id": "global"}, {"_id": 0})
    if not doc:
        return {"meta": None, "sections": [], "is_default": True}
    doc["is_default"] = False
    # Sanitize datetimes to strings
    for k in ("updated_at",):
        v = doc.get(k)
        if v and not isinstance(v, str):
            try:
                doc[k] = v.isoformat()
            except Exception:
                doc[k] = str(v)
    return doc


@api_router.put("/libretto/content")
async def libretto_put_content(body: LibrettoContentIn, user=Depends(get_current_user)):
    """Sostituisce il contenuto del libretto. Solo Super Master."""
    _require_super_master(user)
    if not body.sections:
        raise HTTPException(status_code=400, detail="Almeno una sezione è richiesta")
    # Verifica unicità id sezioni
    ids = [s.id for s in body.sections]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="Gli id delle sezioni devono essere unici")
    doc = {
        "_id": "global",
        "meta": body.meta.model_dump(),
        "sections": [s.model_dump() for s in body.sections],
        "updated_at": utcnow(),
        "updated_by": user.get("email") or user.get("user_id"),
    }
    await db.libretto_content.replace_one({"_id": "global"}, doc, upsert=True)
    return {"ok": True, "sections": len(body.sections), "updated_at": doc["updated_at"].isoformat()}


@api_router.post("/libretto/content/reset")
async def libretto_reset_content(user=Depends(get_current_user)):
    """Ripristina il libretto al default statico (elimina il documento).
    Solo Super Master."""
    _require_super_master(user)
    await db.libretto_content.delete_one({"_id": "global"})
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
# ─── V50.w — AXON BRAIN: memoria distillata + profilo auto-appreso ─────────
# ═══════════════════════════════════════════════════════════════════════════
# Collezioni:
#   axon_brain_profile: {user_id, specialization, tone, style_markers, jargon,
#                        preferences, learning_enabled, last_distilled_at,
#                        updated_at}
#   axon_brain_facts:   {user_id, fact_id, fact, category, importance,
#                        source_session, created_at}

class BrainSettingsIn(BaseModel):
    learning_enabled: Optional[bool] = None
    specialization: Optional[str] = None
    tone: Optional[str] = None
    preferences: Optional[str] = None


async def _load_axon_brain(user_id: str) -> Dict[str, Any]:
    """Carica profilo + fatti stabili appresi da Axon per l'utente."""
    prof = await db.axon_brain_profile.find_one({"user_id": user_id}, {"_id": 0}) or {}
    if prof.get("learning_enabled") is False:
        return {"profile": prof, "facts": [], "enabled": False}
    facts_cur = db.axon_brain_facts.find(
        {"user_id": user_id}, {"_id": 0, "fact_id": 1, "fact": 1, "category": 1, "importance": 1}
    ).sort([("importance", -1), ("created_at", -1)]).limit(40)
    facts = [f async for f in facts_cur]
    return {"profile": prof, "facts": facts, "enabled": True}


def _brain_section_for_prompt(brain: Dict[str, Any]) -> str:
    """Serializza il brain in una sezione compatta da iniettare nel system prompt."""
    if not brain or not brain.get("enabled"):
        return ""
    lines: List[str] = []
    prof = brain.get("profile") or {}
    facts = brain.get("facts") or []
    if not prof and not facts:
        return ""
    lines.append("\n\nCERVELLO AXON (memoria appresa e profilo utente — usa senza citare esplicitamente):")
    if prof.get("specialization"):
        lines.append(f"- Specializzazione: {prof['specialization']}")
    if prof.get("tone"):
        lines.append(f"- Tono preferito: {prof['tone']}")
    if prof.get("preferences"):
        lines.append(f"- Preferenze: {prof['preferences']}")
    if prof.get("jargon"):
        lines.append(f"- Gergo tipico: {prof['jargon']}")
    if prof.get("style_markers"):
        lines.append(f"- Stile: {prof['style_markers']}")
    if facts:
        lines.append("Fatti stabili memorizzati:")
        for f in facts[:20]:
            fact = (f.get("fact") or "").strip()
            cat = f.get("category") or ""
            if fact:
                lines.append(f"  • [{cat}] {fact}" if cat else f"  • {fact}")
    lines.append("Adatta tono, esempi e vocabolario a queste informazioni. Non elencarle mai esplicitamente.")
    return "\n".join(lines) + "\n"


async def _distill_axon_brain(user_id: str, session_id: str) -> Dict[str, Any]:
    """Analizza gli ultimi messaggi della sessione e distilla fatti stabili + aggiorna profilo.
    Chiamata via BackgroundTasks dopo ogni risposta assistant (nono blocca la UX).
    """
    prof = await db.axon_brain_profile.find_one({"user_id": user_id}) or {}
    if prof.get("learning_enabled") is False:
        return {"skipped": "learning_disabled"}
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return {"skipped": "no_key"}
    # Prendi ultimi 20 messaggi della sessione
    msgs_cur = db.assistant_messages.find(
        {"user_id": user_id, "session_id": session_id},
        {"_id": 0, "role": 1, "content": 1}
    ).sort("created_at", -1).limit(20)
    msgs = [m async for m in msgs_cur]
    if len(msgs) < 4:  # troppi pochi per distillare
        return {"skipped": "not_enough_messages"}
    msgs.reverse()
    convo = "\n".join([f"{m['role']}: {(m.get('content') or '')[:500]}" for m in msgs])
    # Fatti già noti (per evitare duplicati)
    existing = [f async for f in db.axon_brain_facts.find({"user_id": user_id}, {"_id": 0, "fact": 1}).limit(50)]
    existing_txt = "\n".join([f"- {e.get('fact')}" for e in existing])
    system = (
        "Sei un analista che estrae UN JSON strutturato con FATTI STABILI e un PROFILO "
        "COMPORTAMENTALE su un consulente energetico italiano, basandoti su una "
        "conversazione. NON estrarre dati sensibili di clienti (email, telefoni, importi "
        "specifici). Estrai solo pattern generali su come lavora il consulente, "
        "specializzazioni, tono, gergo, preferenze.\n\n"
        "OUTPUT (JSON compatto, senza markdown):\n"
        '{"profile":{"specialization":"<max 100 char, o null>","tone":"<max 60 char, o null>",'
        '"jargon":"<max 100 char, o null>","preferences":"<max 200 char, o null>",'
        '"style_markers":"<max 100 char, o null>"},'
        '"new_facts":[{"fact":"<max 140 char, dichiarativo>","category":"<preferenze|specializzazione|clienti|processo|obiezioni|altro>","importance":<1-5>}]}\n\n'
        "REGOLE:\n"
        "- 'new_facts' MAX 5, solo se DAVVERO stabili e non già presenti tra i fatti noti.\n"
        "- Se non c'è nulla di nuovo da estrarre, ritorna new_facts:[].\n"
        "- Ogni campo del profilo che non riesci a determinare deve essere null.\n"
    )
    user_prompt = (
        f"FATTI GIÀ NOTI (non ripeterli):\n{existing_txt or 'nessuno'}\n\n"
        f"CONVERSAZIONE:\n{convo}\n\n"
        "Estrai il JSON."
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=key,
            session_id=f"brain-distill-{uuid.uuid4().hex[:8]}",
            system_message=system,
        ).with_model("anthropic", "claude-haiku-4-5")
        raw = await chat.send_message(UserMessage(text=user_prompt))
        # Trova JSON nella risposta
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return {"skipped": "no_json"}
        data = _json_stdlib.loads(m.group(0))
        # Salva profilo
        p = data.get("profile") or {}
        upd = {"user_id": user_id, "updated_at": utcnow()}
        for k in ("specialization", "tone", "jargon", "preferences", "style_markers"):
            v = (p.get(k) or "").strip() if isinstance(p.get(k), str) else None
            if v and v.lower() not in ("null", "none", ""):
                upd[k] = v[:200]
        upd["last_distilled_at"] = utcnow()
        await db.axon_brain_profile.update_one(
            {"user_id": user_id},
            {"$set": upd, "$setOnInsert": {"created_at": utcnow(), "learning_enabled": True}},
            upsert=True,
        )
        # Salva nuovi fatti (deduplica su testo)
        new_facts = data.get("new_facts") or []
        existing_norms = {(e.get("fact") or "").strip().lower() for e in existing}
        added = 0
        for nf in new_facts[:5]:
            fact = (nf.get("fact") or "").strip()
            if not fact or fact.lower() in existing_norms:
                continue
            await db.axon_brain_facts.insert_one({
                "user_id": user_id,
                "fact_id": uuid.uuid4().hex[:16],
                "fact": fact[:200],
                "category": (nf.get("category") or "altro")[:30],
                "importance": max(1, min(5, int(nf.get("importance") or 3))),
                "source_session": session_id,
                "created_at": utcnow(),
            })
            existing_norms.add(fact.lower())
            added += 1
        return {"ok": True, "profile_updated": bool(upd), "facts_added": added}
    except Exception as e:
        logger.warning("[brain] distill failed: %s", e)
        return {"error": str(e)}


@api_router.get("/axon/brain")
async def axon_brain_get(user=Depends(get_current_user)):
    brain = await _load_axon_brain(user["user_id"])
    return {
        "profile": brain.get("profile") or {},
        "facts": brain.get("facts") or [],
        "learning_enabled": brain.get("profile", {}).get("learning_enabled") is not False,
    }


@api_router.put("/axon/brain/settings")
async def axon_brain_settings(body: BrainSettingsIn, user=Depends(get_current_user)):
    upd: Dict[str, Any] = {"user_id": user["user_id"], "updated_at": utcnow()}
    if body.learning_enabled is not None:
        upd["learning_enabled"] = bool(body.learning_enabled)
    for k in ("specialization", "tone", "preferences"):
        v = getattr(body, k)
        if v is not None:
            upd[k] = (v or "").strip()[:200]
    await db.axon_brain_profile.update_one(
        {"user_id": user["user_id"]},
        {"$set": upd, "$setOnInsert": {"created_at": utcnow()}},
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/axon/brain/facts/{fact_id}")
async def axon_brain_delete_fact(fact_id: str, user=Depends(get_current_user)):
    r = await db.axon_brain_facts.delete_one({"user_id": user["user_id"], "fact_id": fact_id})
    return {"deleted": r.deleted_count}


@api_router.post("/axon/brain/reset")
async def axon_brain_reset(user=Depends(get_current_user)):
    await db.axon_brain_facts.delete_many({"user_id": user["user_id"]})
    await db.axon_brain_profile.delete_one({"user_id": user["user_id"]})
    return {"ok": True}


@api_router.post("/axon/brain/refresh")
async def axon_brain_refresh(session_id: Optional[str] = None, user=Depends(get_current_user)):
    """Forza una distillazione immediata dalla sessione corrente."""
    if not session_id:
        # Prendi la sessione più recente
        last = await db.assistant_messages.find_one(
            {"user_id": user["user_id"]},
            {"_id": 0, "session_id": 1},
            sort=[("created_at", -1)],
        )
        if not last:
            raise HTTPException(status_code=400, detail="Nessuna sessione recente")
        session_id = last["session_id"]
    r = await _distill_axon_brain(user["user_id"], session_id)
    return r


# ═══════════════════════════════════════════════════════════════════════════
# ─── V50.w — AXON SCRIPT BANK: libreria di script vincenti ─────────────────
# ═══════════════════════════════════════════════════════════════════════════
# Collection: axon_scripts
#   {user_id, script_id, category, title, content, tags, times_used,
#    created_at, updated_at}
#
# Categorie suggerite: apertura_chiamata, email_freddo, gestione_obiezione,
# closing, follow_up, primo_incontro, altro

class ScriptIn(BaseModel):
    category: str = "altro"
    title: str
    content: str
    tags: List[str] = Field(default_factory=list)


class ScriptUpdate(BaseModel):
    category: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None


@api_router.get("/axon/scripts")
async def axon_scripts_list(category: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": tenant_id(user)}
    if category:
        q["category"] = category
    cur = db.axon_scripts.find(q, {"_id": 0}).sort([("times_used", -1), ("updated_at", -1)])
    return {"scripts": [s async for s in cur]}


@api_router.post("/axon/scripts")
async def axon_scripts_create(body: ScriptIn, user=Depends(get_current_user)):
    doc = {
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "script_id": uuid.uuid4().hex[:16],
        "category": (body.category or "altro").strip()[:40],
        "title": body.title.strip()[:120],
        "content": body.content.strip()[:4000],
        "tags": [t.strip()[:30] for t in body.tags if t.strip()][:8],
        "times_used": 0,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.axon_scripts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/axon/scripts/{script_id}")
async def axon_scripts_update(script_id: str, body: ScriptUpdate, user=Depends(get_current_user)):
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.category is not None: upd["category"] = body.category.strip()[:40]
    if body.title is not None: upd["title"] = body.title.strip()[:120]
    if body.content is not None: upd["content"] = body.content.strip()[:4000]
    if body.tags is not None: upd["tags"] = [t.strip()[:30] for t in body.tags if t.strip()][:8]
    r = await db.axon_scripts.update_one(
        {"user_id": tenant_id(user), "script_id": script_id},
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Script non trovato")
    return {"ok": True}


@api_router.delete("/axon/scripts/{script_id}")
async def axon_scripts_delete(script_id: str, user=Depends(get_current_user)):
    r = await db.axon_scripts.delete_one({"user_id": tenant_id(user), "script_id": script_id})
    return {"deleted": r.deleted_count}


@api_router.post("/axon/scripts/{script_id}/use")
async def axon_scripts_use(script_id: str, user=Depends(get_current_user)):
    r = await db.axon_scripts.update_one(
        {"user_id": tenant_id(user), "script_id": script_id},
        {"$inc": {"times_used": 1}, "$set": {"last_used_at": utcnow()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Script non trovato")
    return {"ok": True}


# ─── V50.w — Import massivo Script da cartella Google Drive ────────────────

class ScriptImportDriveIn(BaseModel):
    folder_id: str
    folder_name: Optional[str] = None
    default_category: Optional[str] = None  # se None, Axon la determina


async def _download_drive_file_bytes(service, file_id: str) -> Optional[Dict[str, Any]]:
    """Scarica un file Drive; ritorna {name, mime, data_base64, size} o None."""
    from googleapiclient.errors import HttpError  # type: ignore
    from googleapiclient.http import MediaIoBaseDownload  # type: ignore
    from io import BytesIO
    try:
        meta = service.files().get(fileId=file_id, fields="id,name,mimeType,size").execute()
    except HttpError:
        return None
    mime = meta.get("mimeType", "") or ""
    out = BytesIO()
    try:
        if mime.startswith("application/vnd.google-apps."):
            if mime.endswith("document"):
                export_mime = "application/pdf"; out_ext = ".pdf"
            elif mime.endswith("spreadsheet"):
                export_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; out_ext = ".xlsx"
            elif mime.endswith("presentation"):
                export_mime = "application/pdf"; out_ext = ".pdf"
            else:
                export_mime = "text/plain"; out_ext = ".txt"
            req = service.files().export_media(fileId=file_id, mimeType=export_mime)
            display_name = f"{meta.get('name','file')}{out_ext}"
            display_mime = export_mime
        else:
            req = service.files().get_media(fileId=file_id)
            display_name = meta.get("name", "file")
            display_mime = mime or "application/octet-stream"
        downloader = MediaIoBaseDownload(out, req, chunksize=1024 * 1024)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        raw = out.getvalue()
        if len(raw) > 15 * 1024 * 1024:  # skip file > 15MB
            return None
        return {
            "name": display_name,
            "mime": display_mime,
            "data_base64": _b64.b64encode(raw).decode(),
            "size": len(raw),
        }
    except Exception as e:
        logger.warning("[import-drive] download failed for %s: %s", file_id, e)
        return None


async def _llm_split_document_into_scripts(text: str, source_name: str, default_category: Optional[str] = None) -> List[Dict[str, Any]]:
    """Chiama Claude Sonnet 5 per dividere un documento in N script strutturati."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key or not (text or "").strip():
        return []
    text_trunc = (text or "").strip()[:15000]
    cat_hint = ""
    if default_category:
        cat_hint = f"\n\nCATEGORIA DA USARE PER TUTTI GLI SCRIPT (se sensata): {default_category}"
    system = (
        "Sei un analista di materiale formativo per consulenti energetici italiani. "
        "Ricevi UN documento (che può contenere UN singolo script o N script separati) e lo "
        "trasformi in una lista di script pronti all'uso in un CRM.\n\n"
        "REGOLE:\n"
        "- Identifica se il documento contiene UN singolo modello di messaggio/script "
        "oppure N script distinti (numerati, con sottotitoli, o separati per contesto).\n"
        "- Massimo 10 script per documento.\n"
        "- Ogni script deve essere autonomo e utilizzabile (email/messaggio/discorso pronto).\n"
        "- Categorie valide: apertura_chiamata | email_freddo | gestione_obiezione | closing "
        "| follow_up | primo_incontro | altro. Deduci la categoria dal contenuto.\n"
        "- content max 3000 caratteri, title max 100, tags max 5 parole chiave.\n"
        "- Ignora indice/copertine/introduzioni non actionable.\n\n"
        "OUTPUT (JSON array, SENZA markdown, SENZA testo prima/dopo):\n"
        '[{"title":"...","category":"apertura_chiamata|email_freddo|gestione_obiezione|closing|follow_up|primo_incontro|altro","content":"...","tags":["parola1","parola2"]}]\n'
        "Se il documento non contiene materiale utile, ritorna []."
        f"{cat_hint}"
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=key,
            session_id=f"script-import-{uuid.uuid4().hex[:8]}",
            system_message=system,
        ).with_model("anthropic", "claude-sonnet-5")
        raw = await chat.send_message(UserMessage(
            text=f"Nome file: {source_name}\n\nCONTENUTO:\n{text_trunc}\n\nEstrai gli script in JSON array."
        ))
        # Trova array nella risposta
        m = re.search(r"\[.*\]", raw or "", re.S)
        if not m:
            return []
        data = _json_stdlib.loads(m.group(0))
        if not isinstance(data, list):
            return []
        out: List[Dict[str, Any]] = []
        valid_cats = {"apertura_chiamata", "email_freddo", "gestione_obiezione", "closing", "follow_up", "primo_incontro", "altro"}
        for s in data[:10]:
            title = (s.get("title") or "").strip()[:100]
            content = (s.get("content") or "").strip()[:3000]
            if not title or not content:
                continue
            cat = (s.get("category") or default_category or "altro").strip().lower()
            if cat not in valid_cats:
                cat = default_category or "altro"
            tags = [t.strip()[:30] for t in (s.get("tags") or []) if t and isinstance(t, str)][:5]
            out.append({"title": title, "category": cat, "content": content, "tags": tags})
        return out
    except Exception as e:
        logger.warning("[import-drive] llm split failed: %s", e)
        return []


class ScriptImportTextIn(BaseModel):
    text: str
    source_name: str = "manuale"
    default_category: Optional[str] = None


class ScriptImportFileIn(BaseModel):
    name: str
    mime: str
    data_base64: str
    default_category: Optional[str] = None


@api_router.post("/axon/scripts/import/text")
async def axon_scripts_import_text(body: ScriptImportTextIn, user=Depends(get_current_user)):
    """Importa script dividendo un testo grezzo incollato. Usa Claude per split."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Testo vuoto")
    scripts = await _llm_split_document_into_scripts(text, body.source_name, body.default_category)
    if not scripts:
        return {"scripts_imported": 0, "errors": [{"file": body.source_name, "error": "Nessuno script rilevato"}]}
    tid = tenant_id(user)
    for s in scripts:
        await db.axon_scripts.insert_one({
            "user_id": tid, "created_by": user["user_id"],
            "script_id": uuid.uuid4().hex[:16],
            "category": s["category"], "title": s["title"], "content": s["content"],
            "tags": s.get("tags") or [], "times_used": 0,
            "source": {"origin": "text_paste", "name": body.source_name},
            "created_at": utcnow(), "updated_at": utcnow(),
        })
    return {"scripts_imported": len(scripts), "errors": []}


@api_router.post("/axon/scripts/import/file")
async def axon_scripts_import_file(body: ScriptImportFileIn, user=Depends(get_current_user)):
    """Importa script da un file locale (base64). Estrae testo + split AI."""
    class _Att:
        def __init__(self, name, mime, data_base64):
            self.name = name; self.mime = mime; self.data_base64 = data_base64
    try:
        text = await _extract_attachment_text(_Att(body.name, body.mime, body.data_base64))  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Impossibile estrarre testo: {e}")
    if not text or (text.startswith("[") and text.endswith("]")):
        raise HTTPException(status_code=400, detail="Il file non contiene testo estraibile")
    scripts = await _llm_split_document_into_scripts(text, body.name, body.default_category)
    if not scripts:
        return {"scripts_imported": 0, "errors": [{"file": body.name, "error": "Nessuno script rilevato"}]}
    tid = tenant_id(user)
    for s in scripts:
        await db.axon_scripts.insert_one({
            "user_id": tid, "created_by": user["user_id"],
            "script_id": uuid.uuid4().hex[:16],
            "category": s["category"], "title": s["title"], "content": s["content"],
            "tags": s.get("tags") or [], "times_used": 0,
            "source": {"origin": "file_upload", "name": body.name, "mime": body.mime},
            "created_at": utcnow(), "updated_at": utcnow(),
        })
    return {"scripts_imported": len(scripts), "errors": []}


@api_router.post("/axon/scripts/import/drive")
async def axon_scripts_import_drive(body: ScriptImportDriveIn, user=Depends(get_current_user)):
    """Importa in massa script da una cartella Google Drive.
    Legge tutti i file supportati (PDF, DOCX, TXT, Google Docs/Sheets/Slides),
    chiede a Claude di dividerli in script strutturati e li salva nel Playbook.
    """
    if not _gd_configured():
        raise HTTPException(status_code=503, detail="Google Drive non configurato")
    from googleapiclient.discovery import build  # type: ignore
    try:
        creds = await _gd_get_credentials(user["user_id"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Credenziali Drive non valide: {e}")
    service = build("drive", "v3", credentials=creds, cache_discovery=False)

    # Lista file (non cartelle) dentro la cartella
    supported_mimes_prefix = (
        "application/pdf",
        "application/vnd.google-apps.document",
        "application/vnd.google-apps.spreadsheet",
        "application/vnd.google-apps.presentation",
        "application/vnd.openxmlformats-officedocument",
        "text/",
        "application/msword",
        "application/rtf",
    )
    q = (
        f"'{body.folder_id}' in parents and trashed = false and "
        "mimeType != 'application/vnd.google-apps.folder'"
    )
    try:
        r = service.files().list(
            q=q, spaces="drive",
            fields="files(id,name,mimeType,size)",
            pageSize=100, orderBy="name",
            supportsAllDrives=True, includeItemsFromAllDrives=True, corpora="user",
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore Drive: {e}")
    files = r.get("files") or []
    supported = [
        f for f in files
        if any((f.get("mimeType") or "").startswith(p) for p in supported_mimes_prefix)
    ]
    if not supported:
        return {"files_processed": 0, "scripts_imported": 0, "errors": [], "message": "Nessun file supportato nella cartella"}

    scripts_imported = 0
    errors: List[Dict[str, str]] = []
    tid = tenant_id(user)

    # Costruisci un modello leggero per _extract_attachment_text (usa lo stesso helper)
    class _Att:
        def __init__(self, name, mime, data_base64):
            self.name = name; self.mime = mime; self.data_base64 = data_base64

    processed = 0
    for f in supported[:30]:  # max 30 file per chiamata
        fname = f.get("name") or "file"
        try:
            blob = await _download_drive_file_bytes(service, f["id"])
            if not blob:
                errors.append({"file": fname, "error": "Download fallito o file troppo grande"})
                continue
            att = _Att(blob["name"], blob["mime"], blob["data_base64"])
            text = await _extract_attachment_text(att)  # type: ignore
            if not text or text.startswith("[") and text.endswith("]"):
                errors.append({"file": fname, "error": "Testo non estraibile"})
                continue
            scripts = await _llm_split_document_into_scripts(text, fname, body.default_category)
            if not scripts:
                errors.append({"file": fname, "error": "Nessuno script rilevato"})
                continue
            # Salva ognuno
            for s in scripts:
                doc = {
                    "user_id": tid,
                    "created_by": user["user_id"],
                    "script_id": uuid.uuid4().hex[:16],
                    "category": s["category"],
                    "title": s["title"],
                    "content": s["content"],
                    "tags": s.get("tags") or [],
                    "times_used": 0,
                    "source": {"drive_file_id": f["id"], "drive_file_name": fname, "folder_name": body.folder_name or None},
                    "created_at": utcnow(),
                    "updated_at": utcnow(),
                }
                await db.axon_scripts.insert_one(doc)
                scripts_imported += 1
            processed += 1
        except Exception as e:
            errors.append({"file": fname, "error": str(e)[:200]})

    return {
        "files_processed": processed,
        "files_total_supported": len(supported),
        "scripts_imported": scripts_imported,
        "errors": errors[:20],
    }


async def _load_scripts_index(user_id_or_tenant: str) -> str:
    """Ritorna un elenco compatto (solo titolo+categoria) degli script del tenant,
    per iniezione nel system prompt."""
    try:
        cur = db.axon_scripts.find(
            {"user_id": user_id_or_tenant},
            {"_id": 0, "script_id": 1, "title": 1, "category": 1, "times_used": 1}
        ).sort("times_used", -1).limit(30)
        items = [s async for s in cur]
        if not items:
            return ""
        lines = ["\n\nPLAYBOOK SCRIPT DEL CONSULENTE (indice — usali quando l'utente chiede un modello di messaggio, apertura chiamata, email, obiezione, closing):"]
        for s in items:
            lines.append(f"  • [{s.get('category','altro')}] {s.get('title','')} (id: {s.get('script_id')})")
        lines.append("Se l'utente chiede uno script/messaggio simile a uno di questi, cita brevemente il titolo e proponi il contenuto adattato. Se vuole crearne uno nuovo, guidalo (categoria, titolo, contenuto).")
        return "\n".join(lines) + "\n"
    except Exception:
        return ""


# ═══════════════════════════════════════════════════════════════════════════
# ─── V50.w — AXON CHEAT SHEET BOLLETTE: fornitori/prezzi auto-appreso ──────
# ═══════════════════════════════════════════════════════════════════════════
# Collection: axon_bill_cheatsheet
#   {user_id, supplier_norm, bill_type, samples: [{price_kwh, price_smc,
#     price_pcv, canone, extracted_at}], last_updated}

def _norm_supplier(s: Optional[str]) -> str:
    if not s: return ""
    v = str(s).strip().lower()
    # rimuovi società, s.p.a., etc.
    v = re.sub(r"\b(s\.?p\.?a\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|società|group|italia|italy)\b", "", v)
    v = re.sub(r"[^a-z0-9 ]", "", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v[:60]


async def _update_bill_cheatsheet(user_id: str, bill_type: str, extracted: Dict[str, Any]) -> None:
    """Aggiorna la mini-statistica di prezzi visti dall'utente. Best-effort, non blocca."""
    try:
        supplier = _norm_supplier(extracted.get("fornitore") or extracted.get("supplier"))
        if not supplier:
            return
        sample: Dict[str, Any] = {"extracted_at": utcnow()}
        # Estrai prezzi noti in modo tollerante
        for k_src, k_dst in [
            ("prezzo_kwh", "price_kwh"),
            ("prezzo_smc", "price_smc"),
            ("prezzo_luce_kwh", "price_kwh"),
            ("prezzo_gas_smc", "price_smc"),
            ("pcv", "pcv"),
            ("canone_mensile", "canone"),
        ]:
            v = extracted.get(k_src)
            if v is None: continue
            try:
                sample[k_dst] = float(str(v).replace(",", ".").replace("€", "").strip())
            except Exception:
                pass
        if len(sample) <= 1:
            return  # nessun prezzo estratto
        await db.axon_bill_cheatsheet.update_one(
            {"user_id": user_id, "supplier_norm": supplier, "bill_type": bill_type},
            {
                "$push": {"samples": {"$each": [sample], "$slice": -30}},  # tieni ultimi 30
                "$set": {"last_updated": utcnow()},
                "$setOnInsert": {
                    "user_id": user_id, "supplier_norm": supplier, "bill_type": bill_type,
                    "created_at": utcnow(),
                }
            },
            upsert=True,
        )
    except Exception as e:
        logger.debug("[cheatsheet] update failed: %s", e)


def _cheatsheet_stats(samples: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calcola medie per ogni prezzo dai samples."""
    out: Dict[str, Any] = {"count": len(samples or [])}
    for key in ("price_kwh", "price_smc", "pcv", "canone"):
        vals = [s.get(key) for s in (samples or []) if isinstance(s.get(key), (int, float))]
        if vals:
            out[f"avg_{key}"] = round(sum(vals) / len(vals), 4)
            out[f"min_{key}"] = round(min(vals), 4)
            out[f"max_{key}"] = round(max(vals), 4)
    return out


@api_router.get("/axon/cheatsheet/bills")
async def axon_cheatsheet_bills(user=Depends(get_current_user)):
    cur = db.axon_bill_cheatsheet.find({"user_id": user["user_id"]}, {"_id": 0})
    out: List[Dict[str, Any]] = []
    async for row in cur:
        samples = row.get("samples") or []
        stats = _cheatsheet_stats(samples)
        out.append({
            "supplier": row.get("supplier_norm"),
            "bill_type": row.get("bill_type"),
            "count": stats.get("count", 0),
            "avg_price_kwh": stats.get("avg_price_kwh"),
            "avg_price_smc": stats.get("avg_price_smc"),
            "avg_pcv": stats.get("avg_pcv"),
            "avg_canone": stats.get("avg_canone"),
            "min_price_kwh": stats.get("min_price_kwh"),
            "max_price_kwh": stats.get("max_price_kwh"),
            "last_updated": (row.get("last_updated") or "").isoformat() if row.get("last_updated") and not isinstance(row.get("last_updated"), str) else row.get("last_updated"),
        })
    out.sort(key=lambda x: (x.get("bill_type") or "", -(x.get("count") or 0)))
    return {"rows": out}


@api_router.delete("/axon/cheatsheet/bills")
async def axon_cheatsheet_bills_reset(user=Depends(get_current_user)):
    r = await db.axon_bill_cheatsheet.delete_many({"user_id": user["user_id"]})
    return {"deleted": r.deleted_count}


async def _cheatsheet_section_for_prompt(user_id: str) -> str:
    """Sezione compatta cheat sheet fornitori da iniettare nel prompt (solo se ci sono dati)."""
    try:
        cur = db.axon_bill_cheatsheet.find(
            {"user_id": user_id}, {"_id": 0, "supplier_norm": 1, "bill_type": 1, "samples": 1}
        ).limit(30)
        rows = [r async for r in cur]
        if not rows:
            return ""
        lines = ["\n\nCHEAT SHEET FORNITORI/PREZZI (basato sulle bollette che HAI GIÀ analizzato — usa questi per confronti veloci):"]
        for r in rows[:20]:
            stats = _cheatsheet_stats(r.get("samples") or [])
            n = stats.get("count", 0)
            price_kwh = stats.get("avg_price_kwh")
            price_smc = stats.get("avg_price_smc")
            pcv = stats.get("avg_pcv")
            parts = []
            if price_kwh is not None: parts.append(f"€/kWh medio {price_kwh}")
            if price_smc is not None: parts.append(f"€/Smc medio {price_smc}")
            if pcv is not None: parts.append(f"PCV medio {pcv}")
            if parts:
                lines.append(f"  • {r.get('supplier_norm','?')} [{r.get('bill_type','?')}] n={n} · {' · '.join(parts)}")
        return "\n".join(lines) + "\n"
    except Exception:
        return ""


async def _legacy_owner_ids(user: dict) -> List[str]:
    """V49.e — Return every historical `user_id` that likely belonged to the
    current owner: any other users in the DB that share the exact email.

    Purpose: recover legacy rules/urls (Insegna ad Axon) attributed to a
    previous incarnation of the same account (e.g. re-registration after a
    tenant wipe, migration from v1.0.x). Non-blocking: on error returns [].
    """
    try:
        email = (user.get("email") or "").strip().lower()
        if not email:
            return []
        cur = db.users.find(
            {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}},
            {"user_id": 1, "_id": 0},
        )
        ids: List[str] = []
        async for u in cur:
            uid = u.get("user_id")
            if uid and uid != user.get("user_id"):
                ids.append(uid)
        return ids
    except Exception as exc:
        logger.warning("[ai-teach] legacy owner lookup failed: %s", exc)
        return []


@api_router.get("/ai-teach/rules")
async def ai_teach_list_rules(user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    uid = user["user_id"]
    # V47.1 — Broaden the read filter to also match LEGACY documents from
    # v1.0.10 that may have been stored under `user_id == uid` (the master's
    # own user_id, which equals `tid` for a top-level owner but not for
    # historical rows that pre-date the tenant_id refactor) or under alternate
    # ownership fields (`owner_id`, `created_by`). Any legacy match is
    # lazily rewritten to the canonical `user_id: tid` so subsequent reads
    # are fast and the CREATE/DELETE contracts remain unchanged.
    or_clauses: List[dict] = [{"user_id": tid}]
    if uid and uid != tid:
        or_clauses.append({"user_id": uid})
    or_clauses.append({"owner_id": tid})
    if uid and uid != tid:
        or_clauses.append({"owner_id": uid})
    or_clauses.append({"created_by": uid, "user_id": {"$exists": False}})
    # V49.e — Anche ogni altro user_id che condivide la stessa email (utenti
    # re-registrati / migrazioni pre-tenant): includiamo sia `user_id` sia
    # `created_by` sia `owner_id` in tutte le sue varianti storiche.
    legacy_ids = await _legacy_owner_ids(user)
    for lid in legacy_ids:
        or_clauses.append({"user_id": lid})
        or_clauses.append({"owner_id": lid})
        or_clauses.append({"created_by": lid, "user_id": {"$exists": False}})
    query = {"$or": or_clauses}
    # V28.n — Lazy migration: rules with only `category` (str) get `categories: [category]`.
    # We update in-place so subsequent reads/writes are consistent.
    cur = db.ai_teach_rules.find(query).sort("updated_at", -1)
    items = []
    async for r in cur:
        r.pop("_id", None)
        # V47.1 — If this row was matched via a legacy ownership field, rewrite
        # `user_id` to the canonical tenant id so future reads can drop the $or
        # clauses if we ever tighten the filter. Non-blocking, best-effort.
        if r.get("user_id") != tid and r.get("rule_id"):
            try:
                await db.ai_teach_rules.update_one(
                    {"rule_id": r["rule_id"]},
                    {"$set": {"user_id": tid}},
                )
                r["user_id"] = tid
            except Exception:
                pass
        # Normalize categories field: prefer `categories` array; fallback to legacy `category` string.
        cats = r.get("categories")
        if not isinstance(cats, list) or not cats:
            legacy = (r.get("category") or "").strip()
            cats = [legacy] if legacy else ["Generale"]
            # Persist the migration (best-effort, non-blocking on error)
            try:
                await db.ai_teach_rules.update_one(
                    {"rule_id": r.get("rule_id"), "user_id": tid},
                    {"$set": {"categories": cats}},
                )
            except Exception:
                pass
        # Deduplicate while preserving order
        seen = set(); norm = []
        for c in cats:
            key = (c or "").strip()
            if not key: continue
            if key.lower() in seen: continue
            seen.add(key.lower()); norm.append(key)
        r["categories"] = norm or ["Generale"]
        # Keep `category` mirrored to first element for backward-compat with older clients
        r["category"] = r["categories"][0]
        # Strip file base64 from list (keep only metadata) — client fetches full file separately when needed
        r["files"] = [{"name": f.get("name"), "mime": f.get("mime"), "size": f.get("size", 0)} for f in (r.get("files") or [])]
        items.append(r)
    return {"items": items}


@api_router.post("/ai-teach/rules")
async def ai_teach_create_rule(body: AiTeachRuleIn, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    rid = f"aitr_{uuid.uuid4().hex[:12]}"
    files = []
    for f in body.files:
        raw = f.data_base64.split(",")[-1] if f.data_base64.startswith("data:") else f.data_base64
        try:
            size = len(base64.b64decode(raw))
        except Exception:
            size = 0
        files.append({"name": f.name, "mime": f.mime, "data_base64": raw, "size": size})
    # V28.n — Normalize multi-category. Prefer `categories` list; fall back to legacy single `category`.
    raw_cats: List[str] = []
    if body.categories:
        raw_cats = [c for c in body.categories if isinstance(c, str)]
    elif body.category:
        raw_cats = [body.category]
    seen = set(); cats: List[str] = []
    for c in raw_cats:
        key = (c or "").strip()
        if not key: continue
        if key.lower() in seen: continue
        seen.add(key.lower()); cats.append(key)
    if not cats:
        cats = ["Generale"]
    doc = {
        "rule_id": rid,
        "user_id": tid,
        "created_by": user["user_id"],
        # Store BOTH: canonical `categories` list + mirrored `category` (first) for backward-compat
        "categories": cats,
        "category": cats[0],
        "title": body.title.strip(),
        "text": body.text.strip(),
        "files": files,
        # V50.z53 — Sempre esplicito: True = proposta auto (bassa priorità),
        # False = regola manuale (alta priorità PINNED).
        "auto_generated": bool(body.auto_generated),
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.ai_teach_rules.insert_one(doc)
    doc.pop("_id", None)
    doc["files"] = [{"name": f["name"], "mime": f["mime"], "size": f["size"]} for f in files]
    return doc


@api_router.put("/ai-teach/rules/{rule_id}")
async def ai_teach_update_rule(rule_id: str, body: AiTeachRulePatch, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    patch: Dict[str, Any] = {"updated_at": utcnow()}
    # V28.n — Handle multi-category updates. `categories` is canonical; `category` mirrored.
    if body.categories is not None or body.category is not None:
        raw_cats: List[str] = []
        if body.categories is not None:
            raw_cats = [c for c in body.categories if isinstance(c, str)]
        elif body.category is not None:
            raw_cats = [body.category]
        seen = set(); cats: List[str] = []
        for c in raw_cats:
            key = (c or "").strip()
            if not key: continue
            if key.lower() in seen: continue
            seen.add(key.lower()); cats.append(key)
        if not cats:
            cats = ["Generale"]
        patch["categories"] = cats
        patch["category"] = cats[0]
    if body.title is not None: patch["title"] = body.title.strip()
    if body.text is not None: patch["text"] = body.text.strip()
    if body.files is not None:
        norm = []
        for f in body.files:
            raw = f.data_base64.split(",")[-1] if f.data_base64.startswith("data:") else f.data_base64
            try: size = len(base64.b64decode(raw))
            except Exception: size = 0
            norm.append({"name": f.name, "mime": f.mime, "data_base64": raw, "size": size})
        patch["files"] = norm
    r = await db.ai_teach_rules.update_one({"rule_id": rule_id, "user_id": tid}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Regola non trovata")
    return {"ok": True}


@api_router.delete("/ai-teach/rules/{rule_id}")
async def ai_teach_delete_rule(rule_id: str, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    r = await db.ai_teach_rules.delete_one({"rule_id": rule_id, "user_id": tid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Regola non trovata")
    return {"ok": True}


@api_router.get("/ai-teach/urls")
async def ai_teach_list_urls(user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    uid = user["user_id"]
    # V47.1 — Broaden legacy ownership match, same rationale as rules above.
    or_clauses: List[dict] = [{"user_id": tid}]
    if uid and uid != tid:
        or_clauses.append({"user_id": uid})
    or_clauses.append({"owner_id": tid})
    if uid and uid != tid:
        or_clauses.append({"owner_id": uid})
    or_clauses.append({"created_by": uid, "user_id": {"$exists": False}})
    # V49.e — Match anche vecchi user_id che condividevano la stessa email
    legacy_ids = await _legacy_owner_ids(user)
    for lid in legacy_ids:
        or_clauses.append({"user_id": lid})
        or_clauses.append({"owner_id": lid})
        or_clauses.append({"created_by": lid, "user_id": {"$exists": False}})
    cur = db.ai_teach_urls.find({"$or": or_clauses}).sort("updated_at", -1)
    items = []
    async for r in cur:
        r.pop("_id", None)
        # V47.1 — Rewrite legacy user_id to tenant id (lazy migration).
        if r.get("user_id") != tid and r.get("url_id"):
            try:
                await db.ai_teach_urls.update_one(
                    {"url_id": r["url_id"]},
                    {"$set": {"user_id": tid}},
                )
                r["user_id"] = tid
            except Exception:
                pass
        # Mask password on list
        if r.get("password"):
            r["password_masked"] = True
            r.pop("password", None)
        items.append(r)
    return {"items": items}


@api_router.post("/ai-teach/urls")
async def ai_teach_create_url(body: AiTeachUrlIn, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    uid_ = f"aitu_{uuid.uuid4().hex[:12]}"
    # V50.z77 — Normalizzazione URL stringente: promuove sempre a https://
    #  - `esempio.com`         → `https://esempio.com`
    #  - `http://esempio.com`  → `https://esempio.com` (auto-upgrade)
    #  - `https://esempio.com` → invariato
    raw_url = (body.url or "").strip()
    if raw_url:
        if raw_url.startswith("http://"):
            raw_url = "https://" + raw_url[len("http://"):]
        elif not raw_url.startswith("https://"):
            raw_url = "https://" + raw_url.lstrip("/")
    doc = {
        "url_id": uid_,
        "user_id": tid,
        "created_by": user["user_id"],
        "url": raw_url,
        "name": body.name.strip(),
        "category": body.category or "generic",
        "frequency": body.frequency,
        "username": (body.username or "").strip() or None,
        "password": (body.password or "").strip() or None,
        "reading_rules": (body.reading_rules or "").strip() or None,
        "last_fetched_at": None,
        "last_summary": "",
        "last_error": None,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.ai_teach_urls.insert_one(doc)
    doc.pop("_id", None)
    if doc.get("password"): doc["password_masked"] = True; doc.pop("password", None)
    return doc


# V50.z29 — Suggerimenti deep link canonici per URL generici.
# Quando l'utente aggiunge www.arera.it o www.gme.it senza specificare la
# pagina, suggeriamo le pagine ufficiali più utili per un consulente energetico
# (PUN, delibere, dati storici, ecc.). L'utente può aggiungerle con un tap.
_CANONICAL_DEEP_LINKS: Dict[str, List[Dict[str, str]]] = {
    "gme.mercatoelettrico.org": [
        {"url": "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce",
         "name": "GME – Prezzo Medio per Fasce (PUN F1/F2/F3)",
         "category": "prezzi_energia", "frequency": "daily",
         "why": "Contiene i PDF mensili con PUN F1/F2/F3 in €/MWh. Fonte ufficiale."},
        {"url": "https://gme.mercatoelettrico.org/it-it/Home/Esiti/Elettricita/MGP/Esiti/PrezziMedi",
         "name": "GME – Prezzi Medi MGP", "category": "prezzi_energia", "frequency": "daily",
         "why": "Prezzi medi mensili del Mercato del Giorno Prima."},
        {"url": "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/Gas",
         "name": "GME – Pubblicazioni Gas (PSV, MGP-GAS)", "category": "gas", "frequency": "monthly",
         "why": "Prezzi mensili e trimestrali del mercato gas."},
    ],
    "arera.it": [
        {"url": "https://www.arera.it/atti-e-provvedimenti/delibere",
         "name": "ARERA – Delibere", "category": "normative", "frequency": "daily",
         "why": "Tutte le delibere ARERA aggiornate. Fondamentale per aggiornamenti tariffe."},
        {"url": "https://www.arera.it/prezzi-e-tariffe/elettricita/prezzo-energia-elettrica-servizio-tutela",
         "name": "ARERA – Prezzo servizio tutela luce", "category": "prezzi_energia", "frequency": "weekly",
         "why": "Prezzo del servizio di maggior tutela (PE) aggiornato trimestralmente."},
        {"url": "https://www.arera.it/prezzi-e-tariffe/gas/prezzi-vendita-condizioni-tutela",
         "name": "ARERA – Prezzo gas tutela", "category": "gas", "frequency": "weekly",
         "why": "Prezzi gas del servizio di tutela aggiornati mensilmente."},
        {"url": "https://www.arera.it/dati-e-statistiche/dettaglio/andamento-del-prezzo-dellenergia-elettrica-per-il-consumatore-domestico-tipo-in-maggior-tutela",
         "name": "ARERA – Andamento prezzo luce domestico", "category": "prezzi_energia", "frequency": "monthly",
         "why": "Serie storica del prezzo elettrico per famiglia tipo."},
    ],
    "gse.it": [
        {"url": "https://www.gse.it/servizi-per-te/fotovoltaico/ritiro-dedicato/prezzi-minimi-garantiti",
         "name": "GSE – Prezzi minimi garantiti fotovoltaico", "category": "rinnovabili", "frequency": "monthly",
         "why": "Prezzi minimi garantiti per impianti FV in Ritiro Dedicato."},
        {"url": "https://www.gse.it/servizi-per-te/fotovoltaico/scambio-sul-posto",
         "name": "GSE – Scambio sul Posto", "category": "rinnovabili", "frequency": "monthly",
         "why": "Regole e contributi Scambio sul Posto fotovoltaico."},
    ],
    "terna.it": [
        {"url": "https://www.terna.it/it/sistema-elettrico/transparency-report/actual-generation",
         "name": "Terna – Generazione elettrica effettiva", "category": "sistema_elettrico", "frequency": "daily",
         "why": "Dati giornalieri di produzione per fonte."},
        {"url": "https://download.terna.it/terna/Rapporto_Mensile_giugno_25.pdf",
         "name": "Terna – Rapporto Mensile sistema elettrico", "category": "sistema_elettrico", "frequency": "monthly",
         "why": "Report mensile con consumo, produzione, mix energetico."},
    ],
    "snam.it": [
        {"url": "https://www.snam.it/it/trasporto/dati-operativi-business/",
         "name": "Snam – Dati operativi trasporto gas", "category": "gas", "frequency": "daily",
         "why": "Volumi giornalieri di trasporto gas."},
    ],
    "acquirenteunico.it": [
        {"url": "https://www.acquirenteunico.it/portale-consumatori",
         "name": "Acquirente Unico – Portale offerte", "category": "prezzi_energia", "frequency": "weekly",
         "why": "Portale offerte luce/gas ufficiale (ex trovaofferte)."},
    ],
    "mercatolibero.eu": [
        {"url": "https://www.mercatolibero.eu",
         "name": "Portale Mercato Libero", "category": "prezzi_energia", "frequency": "weekly", "why": "Confronto offerte del mercato libero."},
    ],
}


@api_router.post("/ai-teach/urls/suggest-canonicals")
async def ai_teach_suggest_canonicals(body: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Ritorna deep-link canonici suggeriti in base al dominio dell'URL inserito.
    Es. input `https://www.arera.it` → suggerisce delibere, prezzo tutela luce/gas, andamento storico.
    """
    _require_master(user)
    raw = (body.get("url") or "").strip()
    if not raw:
        return {"suggestions": [], "domain": None}
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw.lstrip("/")
    try:
        from urllib.parse import urlparse
        p = urlparse(raw)
        host = (p.netloc or "").lower()
        # Rimuovi www.
        if host.startswith("www."):
            host = host[4:]
    except Exception:
        return {"suggestions": [], "domain": None}

    # Determina se l'URL è "generico" (solo host o path banale)
    path = (p.path or "").strip("/").lower()
    is_generic = len(path) < 4 or path in {"", "it", "it-it", "home", "index.html", "index.htm"}

    # Trova match diretto sul dominio (o sottodominio)
    matched_domain = None
    for domain in _CANONICAL_DEEP_LINKS.keys():
        if host == domain or host.endswith("." + domain):
            matched_domain = domain
            break

    if not matched_domain:
        # Nessuna suggerimento canonico noto per questo dominio
        return {"suggestions": [], "domain": host, "is_generic": is_generic}

    # Escludi suggerimenti che l'utente ha già insegnato (matching esatto URL)
    tid = tenant_id(user)
    existing_urls = {u.get("url", "").rstrip("/").lower() async for u in db.ai_teach_urls.find(
        {"user_id": tid}, {"_id": 0, "url": 1}
    )}
    all_suggestions = _CANONICAL_DEEP_LINKS[matched_domain]
    fresh = [s for s in all_suggestions if s["url"].rstrip("/").lower() not in existing_urls]
    return {
        "suggestions": fresh,
        "domain": matched_domain,
        "is_generic": is_generic,
        "total": len(all_suggestions),
        "already_added": len(all_suggestions) - len(fresh),
    }





@api_router.put("/ai-teach/urls/{url_id}")
async def ai_teach_update_url(url_id: str, body: AiTeachUrlPatch, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    patch: Dict[str, Any] = {"updated_at": utcnow()}
    for field in ["url", "name", "category", "frequency", "username", "password", "reading_rules"]:
        v = getattr(body, field, None)
        if v is not None:
            val = (v.strip() if isinstance(v, str) else v) or None
            # V50.z77 — Normalizzazione URL stringente: promuove sempre a https://
            if field == "url" and isinstance(val, str) and val:
                if val.startswith("http://"):
                    val = "https://" + val[len("http://"):]
                elif not val.startswith("https://"):
                    val = "https://" + val.lstrip("/")
            patch[field] = val
    # V50.z19 — Se aggiorniamo l'URL, resettiamo last_error (nuovo tentativo)
    if "url" in patch:
        patch["last_error"] = None
    r = await db.ai_teach_urls.update_one({"url_id": url_id, "user_id": tid}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="URL non trovato")
    return {"ok": True}


@api_router.delete("/ai-teach/urls/{url_id}")
async def ai_teach_delete_url(url_id: str, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    r = await db.ai_teach_urls.delete_one({"url_id": url_id, "user_id": tid})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="URL non trovato")
    return {"ok": True}


async def _ai_teach_refresh_url(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch a monitored URL via Tavily (if configured) and update last_summary.

    V28.k — Il riepilogo deve essere sempre in italiano.
    V28.ab — Se l'URL è un PDF diretto o la pagina contiene link a PDF, li scarichiamo
    e ne estraiamo il testo con PyMuPDF; il testo estratto si integra nella memoria di
    Axon come qualunque altra pagina.
    """
    try:
        summary = ""
        pdf_text_blocks: List[str] = []
        # V28.k — Query in italiano: Tavily genera l'answer nella lingua della query
        name = (doc.get("name") or "").strip()
        url = (doc.get("url") or "").strip()

        # V28.ab — Fase 1: prova a fetchare direttamente l'URL per rilevare PDF o link a PDF
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                head_resp = await client.get(url, headers={"User-Agent": "AxonBot/1.0 (+advisoros.it)"})
                ct = (head_resp.headers.get("content-type") or "").lower()
                body = head_resp.content or b""
                # Caso 1: l'URL stesso è un PDF
                if "application/pdf" in ct or body[:5] == b"%PDF-":
                    txt = _extract_pdf_text_bytes(body)
                    if txt:
                        pdf_text_blocks.append(f"[PDF diretto: {url}]\n{txt}")
                # Caso 2: HTML — cerchiamo link a PDF nella pagina
                elif "text/html" in ct or body[:15].lower().lstrip().startswith(b"<!doctype") or body[:6].lower().startswith(b"<html"):
                    try:
                        page_text = body.decode(head_resp.encoding or "utf-8", errors="replace")
                    except Exception:
                        page_text = body.decode("utf-8", errors="replace")
                    pdf_links = _find_pdf_links(page_text, base_url=str(head_resp.url))
                    for pdf_url in pdf_links[:3]:  # max 3 PDF per pagina
                        try:
                            pr = await client.get(pdf_url, headers={"User-Agent": "AxonBot/1.0"})
                            if (pr.headers.get("content-type") or "").lower().startswith("application/pdf") or (pr.content or b"")[:5] == b"%PDF-":
                                txt = _extract_pdf_text_bytes(pr.content or b"")
                                if txt:
                                    pdf_text_blocks.append(f"[PDF trovato: {pdf_url}]\n{txt}")
                        except Exception:
                            continue  # skip PDF failed
        except Exception:
            # network/parsing errors non-blocking: la sintesi Tavily può comunque partire
            pass

        # Fase 2: sintesi Tavily della pagina come prima
        # V49.f — Se il Master ha indicato "Regole di lettura" per questo URL,
        # le passiamo a Tavily come istruzioni extra così l'AI concentra la
        # sintesi solo sui contenuti richiesti (sezioni/sotto-link) ignorando
        # ciò che il Master ha marcato come da escludere.
        reading_rules = (doc.get("reading_rules") or "").strip()
        rules_hint = ""
        if reading_rules:
            rules_hint = (
                f"\nIstruzioni del Master su cosa estrarre / ignorare:\n"
                f"{reading_rules[:800]}\n"
            )
        it_query = (
            f"Riassumi in italiano i contenuti principali di questa pagina. "
            f"Rispondi SEMPRE in italiano, in prosa chiara, max 6 frasi. "
            f"Pagina: {name} {url}"
            f"{rules_hint}"
        ).strip()
        res = await _tavily_search(it_query, max_results=4, country="italy")
        if res:
            summary = (res.get("answer") or "").strip()
            for it in (res.get("results") or [])[:3]:
                if it.get("content"):
                    summary += f"\n- {it.get('title') or ''}: {it.get('content')}"
        elif not pdf_text_blocks:
            summary = f"[Tavily non configurato o non disponibile] URL: {doc.get('url')}"

        # V28.ab — Merge testo PDF estratto nella sintesi finale (integrato come memoria)
        if pdf_text_blocks:
            merged = "\n\n---\nContenuti PDF collegati:\n" + "\n\n".join(pdf_text_blocks)
            summary = (summary or "").strip() + merged

        # V50.z236 — Novità rilevate: confronto con la sintesi precedente
        now = utcnow()
        changes = await _ai_teach_detect_changes(doc, summary)
        upd: Dict[str, Any] = {"$set": {
            "last_fetched_at": now,
            "last_summary": summary[:12000],  # V28.ab — spazio in più per i PDF estratti
            "last_pdf_count": len(pdf_text_blocks),
            "last_error": None,
            "last_changes": {**changes, "at": now},
        }}
        if changes.get("status") == "changed":
            upd["$push"] = {"changes_log": {"$each": [{**changes, "at": now}], "$slice": -10}}
        await db.ai_teach_urls.update_one({"url_id": doc["url_id"]}, upd)
        return {"ok": True, "summary_len": len(summary), "pdf_extracted": len(pdf_text_blocks), "changes": {**changes, "at": now}}
    except Exception as e:
        await db.ai_teach_urls.update_one(
            {"url_id": doc["url_id"]},
            {"$set": {"last_error": str(e)[:400]}},
        )
        return {"ok": False, "error": str(e)}


def _norm_summary(s: str) -> str:
    import re as _re
    return _re.sub(r"\s+", " ", (s or "")).strip().lower()


async def _ai_teach_detect_changes(doc: Dict[str, Any], new_summary: str) -> Dict[str, Any]:
    """V50.z236 — Confronta la nuova sintesi con `last_summary` precedente.
    Ritorna {status: first|unchanged|changed, text?: str, prev_at?: datetime}.
    Se cambiata, chiede a Claude un elenco in italiano delle novità sostanziali
    (ignora riformulazioni). Best-effort: mai bloccante."""
    prev = (doc.get("last_summary") or "").strip()
    prev_at = doc.get("last_fetched_at")
    if not prev or prev.startswith("[Tavily non configurato"):
        return {"status": "first"}
    if _norm_summary(prev) == _norm_summary(new_summary):
        return {"status": "unchanged", "prev_at": prev_at}
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return {"status": "changed", "text": "Contenuto della fonte modificato rispetto all'ultimo aggiornamento.", "prev_at": prev_at}
    system = (
        "Sei Axon, assistente di consulenti energetici italiani. Ricevi la sintesi PRECEDENTE e quella NUOVA "
        "della stessa fonte web monitorata. Elenca SOLO le novità sostanziali (nuovi dati, prezzi, date, delibere, "
        "scadenze, sezioni aggiunte o rimosse). Ignora riformulazioni, cambi di ordine o dettagli irrilevanti.\n"
        "OUTPUT: in italiano, max 5 punti elenco brevi (ognuno inizia con '• '), max 350 caratteri totali, "
        "senza introduzione né conclusione. Se non ci sono novità sostanziali rispondi esattamente: NESSUNA_NOVITA"
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=key, session_id=f"url-diff-{uuid.uuid4().hex[:8]}", system_message=system).with_model("anthropic", "claude-sonnet-5")
        raw = await chat.send_message(UserMessage(
            text=f"FONTE: {doc.get('name') or ''} {doc.get('url') or ''}\n\nPRECEDENTE:\n{prev[:6000]}\n\nNUOVA:\n{(new_summary or '')[:6000]}"
        ))
        txt = (raw or "").strip()
        if not txt or "NESSUNA_NOVITA" in txt.upper():
            return {"status": "unchanged", "prev_at": prev_at}
        return {"status": "changed", "text": txt[:600], "prev_at": prev_at}
    except Exception as e:
        return {"status": "changed", "text": f"Contenuto modificato rispetto all'ultimo aggiornamento (dettaglio non disponibile: {str(e)[:80]}).", "prev_at": prev_at}


def _history_entry(doc: Dict[str, Any], res: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """V50.z236 — Voce storico con flag novità."""
    entry: Dict[str, Any] = {"url_id": doc.get("url_id"), "name": doc.get("name") or "", "url": doc.get("url") or ""}
    ch = (res or {}).get("changes") or {}
    if ch.get("status") == "changed":
        entry["changed"] = True
        entry["changes"] = (ch.get("text") or "")[:600]
    elif ch.get("status") == "first":
        entry["first_fetch"] = True
    return entry


# V28.ab — Helper: estrae testo da bytes PDF via PyMuPDF (fitz già installato per bill analysis).
def _extract_pdf_text_bytes(data: bytes) -> str:
    """Estrae testo dai primi ~30 pagine di un PDF (cap ~8000 char). Restituisce stringa vuota se fallisce.
    V50.z210: PyMuPDF gira nel sottoprocesso worker (heavy_call_sync), mai nel processo API."""
    if not data or data[:5] != b"%PDF-":
        return ""
    try:
        return heavy_call_sync("pdf_text", data=data, max_pages=30, max_chars=8000).get("text") or ""
    except Exception:
        return ""


# V28.ab — Helper: estrae link PDF assoluti da HTML (parser semplice via regex, no BS4 dep).
def _find_pdf_links(html_text: str, base_url: str) -> List[str]:
    import re as _re
    from urllib.parse import urljoin
    if not html_text:
        return []
    # href="..." o href='...' che finiscono in .pdf (opzionale query string)
    pattern = _re.compile(r"""href\s*=\s*['"]([^'"]+\.pdf(?:\?[^'"]*)?)['"]""", _re.IGNORECASE)
    matches = pattern.findall(html_text)
    seen = set()
    out: List[str] = []
    for m in matches:
        full = urljoin(base_url, m)
        if full not in seen:
            seen.add(full)
            out.append(full)
        if len(out) >= 10:
            break
    return out


def _history_public(r: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not r:
        return None
    r.pop("_id", None)
    return r


# V50.z235 — "AGGIORNA TUTTO" sequenziale dal tab Storico: il client crea un run vuoto,
# poi chiama /urls/{id}/refresh?run_id=... per ogni fonte (progress bar lato client).
@api_router.post("/ai-teach/refresh-runs/start")
async def ai_teach_refresh_run_start(user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    urls = []
    async for d in db.ai_teach_urls.find({"user_id": tid}).sort("name", 1):
        urls.append({"url_id": d.get("url_id"), "name": d.get("name") or "", "url": d.get("url") or ""})
    run = {
        "run_id": f"aitr_{uuid.uuid4().hex[:12]}",
        "user_id": tid,
        "started_at": utcnow(),
        "mode": "manual_all",
        "total": len(urls),
        "success_count": 0,
        "failure_count": 0,
        "successes": [],
        "failures": [],
        "in_progress": True,
    }
    if not urls:
        raise HTTPException(status_code=400, detail="Nessuna fonte URL da aggiornare")
    await db.ai_teach_refresh_history.insert_one(dict(run))
    run.pop("_id", None)
    return {"run": run, "urls": urls}


@api_router.post("/ai-teach/refresh-runs/{run_id}/finish")
async def ai_teach_refresh_run_finish(run_id: str, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    await db.ai_teach_refresh_history.update_one(
        {"run_id": run_id, "user_id": tid}, {"$set": {"in_progress": False, "finished_at": utcnow()}}
    )
    return {"run": _history_public(await db.ai_teach_refresh_history.find_one({"run_id": run_id, "user_id": tid}))}


# V50.z235 — "Aggiorna ora" su una voce dello Storico: ri-esegue le stesse fonti di quel run
# e aggiorna la voce in place (badge X/Y OK + timestamp).
@api_router.post("/ai-teach/refresh-history/{run_id}/rerun")
async def ai_teach_refresh_run_rerun(run_id: str, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    run = await db.ai_teach_refresh_history.find_one({"run_id": run_id, "user_id": tid})
    if not run:
        raise HTTPException(status_code=404, detail="Voce storico non trovata")
    url_ids = [e.get("url_id") for e in (run.get("successes") or []) + (run.get("failures") or []) if e.get("url_id")]
    if run.get("mode") == "manual_all" or not url_ids:
        query: Dict[str, Any] = {"user_id": tid}
    else:
        query = {"user_id": tid, "url_id": {"$in": url_ids}}
    total = 0
    successes: List[Dict[str, str]] = []
    failures: List[Dict[str, str]] = []
    async for doc in db.ai_teach_urls.find(query):
        total += 1
        res = await _ai_teach_refresh_url(doc)
        entry = _history_entry(doc, res)
        if res.get("ok"):
            successes.append(entry)
        else:
            failures.append({**entry, "error": (res.get("error") or "errore")[:200]})
    await db.ai_teach_refresh_history.update_one(
        {"run_id": run_id, "user_id": tid},
        {"$set": {
            "started_at": utcnow(),
            "total": total,
            "success_count": len(successes),
            "failure_count": len(failures),
            "successes": successes,
            "failures": failures,
            "in_progress": False,
        }, "$inc": {"rerun_count": 1}},
    )
    return {"run": _history_public(await db.ai_teach_refresh_history.find_one({"run_id": run_id, "user_id": tid}))}


@api_router.post("/ai-teach/urls/{url_id}/refresh")
async def ai_teach_refresh_url(url_id: str, run_id: Optional[str] = None, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    doc = await db.ai_teach_urls.find_one({"url_id": url_id, "user_id": tid})
    if not doc:
        raise HTTPException(status_code=404, detail="URL non trovato")
    res = await _ai_teach_refresh_url(doc)
    entry = _history_entry(doc, res)
    ok = bool(res.get("ok"))
    # V50.z235 — Step di un run "AGGIORNA TUTTO": accoda il risultato al run condiviso
    if run_id:
        upd: Dict[str, Any] = {"$inc": {"success_count" if ok else "failure_count": 1}}
        if ok:
            upd["$push"] = {"successes": entry}
        else:
            upd["$push"] = {"failures": {**entry, "error": (res.get("error") or "errore")[:200]}}
        r = await db.ai_teach_refresh_history.update_one({"run_id": run_id, "user_id": tid}, upd)
        if r.matched_count:
            run = await db.ai_teach_refresh_history.find_one({"run_id": run_id, "user_id": tid})
            return {**res, "run": _history_public(run), "last_fetched_at": doc.get("last_fetched_at")}
    # V28.j — Record a single-URL run in the refresh history
    await db.ai_teach_refresh_history.insert_one({
        "run_id": f"aitr_{uuid.uuid4().hex[:12]}",
        "user_id": tid,
        "started_at": utcnow(),
        "mode": "manual_single",
        "total": 1,
        "success_count": 1 if ok else 0,
        "failure_count": 0 if ok else 1,
        "successes": [entry] if ok else [],
        "failures": [] if ok else [{**entry, "error": (res.get("error") or "errore")[:200]}],
    })
    return res


# V28.g — Force refresh of ALL monitored URLs (regardless of frequency)
@api_router.post("/ai-teach/urls/refresh-all")
async def ai_teach_refresh_all_urls(user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    cur = db.ai_teach_urls.find({"user_id": tid})
    total = 0
    ok = 0
    successes: List[Dict[str, str]] = []
    failures: List[Dict[str, str]] = []
    async for doc in cur:
        total += 1
        res = await _ai_teach_refresh_url(doc)
        entry = _history_entry(doc, res)
        if res.get("ok"):
            ok += 1
            successes.append(entry)
        else:
            failures.append({**entry, "error": (res.get("error") or "errore")[:200]})
    # V28.j — Persist a history record for the Master's "Storico aggiornamenti" tab
    await db.ai_teach_refresh_history.insert_one({
        "run_id": f"aitr_{uuid.uuid4().hex[:12]}",
        "user_id": tid,
        "started_at": utcnow(),
        "mode": "manual_all",
        "total": total,
        "success_count": ok,
        "failure_count": len(failures),
        "successes": successes,
        "failures": failures,
    })
    return {"ok": True, "total": total, "success": ok, "errors": [f"{f['name']}: {f['error']}" for f in failures[:10]]}


# V28.j — Refresh history: cronologia esecuzioni "Aggiorna ora"
@api_router.get("/ai-teach/refresh-history")
async def ai_teach_refresh_history(limit: int = 30, user=Depends(get_current_user)):
    _require_master(user)
    tid = tenant_id(user)
    cur = db.ai_teach_refresh_history.find({"user_id": tid}).sort("started_at", -1).limit(max(1, min(limit, 100)))
    items = []
    async for r in cur:
        r.pop("_id", None)
        items.append(r)
    return {"items": items}


def _changes_hint(u: Dict[str, Any]) -> str:
    """V50.z236 — Novità rilevate all'ultimo refresh, passate ad Axon come contesto."""
    ch = u.get("last_changes") or {}
    if ch.get("status") != "changed" or not ch.get("text"):
        return ""
    at = ch.get("at")
    when = at.strftime("%d/%m/%Y") if hasattr(at, "strftime") else ""
    return f"\n  NOVITÀ RILEVATE {when}: {ch.get('text')[:400]}"


async def build_ai_teach_context(tenant: str, category: str) -> str:
    """Build a compact block that will be prepended to bill-analysis system prompts.
    Refreshes stale monitored URLs opportunistically (best-effort).
    """
    now = utcnow()
    # V28.n — Manual rules matching this category. We match on both the new
    # `categories` array AND the legacy `category` string for backward-compat.
    # A rule tagged with multiple categories (e.g. Luce+Gas) appears for each of them.
    cat_lc = (category or "").lower()
    rules_cur = db.ai_teach_rules.find({
        "user_id": tenant,
        "$or": [
            {"categories": {"$in": [category]}},
            {"category": category},
            # Also match case-insensitive on legacy `category` for safety
            {"category": {"$regex": f"^{cat_lc}$", "$options": "i"}} if cat_lc else {"category": category},
        ],
    }).limit(30)
    rules_text_parts: List[str] = []
    async for r in rules_cur:
        title = (r.get("title") or "").strip()
        text = (r.get("text") or "").strip()
        if title or text:
            rules_text_parts.append(f"- {title}: {text}"[:800])
    # URLs (all categories + generic — but prefer matching category)
    url_parts: List[str] = []
    stale_ids: List[Dict[str, Any]] = []
    thresholds = {"daily": 1, "weekly": 7, "monthly": 30}
    urls_cur = db.ai_teach_urls.find({"user_id": tenant, "$or": [{"category": category}, {"category": "generic"}, {"category": None}]}).limit(30)
    async for u in urls_cur:
        last = u.get("last_fetched_at")
        freq = u.get("frequency") or "weekly"
        # V28.g — "manual" freq skips opportunistic refresh entirely
        if freq == "manual":
            summary = (u.get("last_summary") or "").strip()
            if summary:
                url_parts.append(f"[{u.get('name') or u.get('url')}]: {summary[:600]}" + _changes_hint(u))
            continue
        freq_days = thresholds.get(freq, 7)
        stale = (not last) or ((now - last).days >= freq_days)
        if stale:
            stale_ids.append(u)
        summary = (u.get("last_summary") or "").strip()
        if summary:
            url_parts.append(f"[{u.get('name') or u.get('url')}]: {summary[:600]}" + _changes_hint(u))
    # Best-effort refresh of a couple of stale URLs (don't block on all)
    auto_successes: List[Dict[str, str]] = []
    auto_failures: List[Dict[str, str]] = []
    for u in stale_ids[:3]:
        try:
            r = await _ai_teach_refresh_url(u)
            entry = _history_entry(u, r)
            if r.get("ok"):
                auto_successes.append(entry)
            else:
                auto_failures.append({**entry, "error": (r.get("error") or "errore")[:200]})
        except Exception as exc:
            auto_failures.append({
                "url_id": u.get("url_id"), "name": u.get("name") or "", "url": u.get("url") or "",
                "error": str(exc)[:200],
            })
    # V28.j — Persist an "automatic" history record when the opportunistic
    # refresh actually did something.
    if auto_successes or auto_failures:
        try:
            await db.ai_teach_refresh_history.insert_one({
                "run_id": f"aitr_{uuid.uuid4().hex[:12]}",
                "user_id": tenant,
                "started_at": utcnow(),
                "mode": "automatic",
                "total": len(auto_successes) + len(auto_failures),
                "success_count": len(auto_successes),
                "failure_count": len(auto_failures),
                "successes": auto_successes,
                "failures": auto_failures,
            })
        except Exception:
            pass
    blocks: List[str] = []
    if rules_text_parts:
        blocks.append("REGOLE MASTER (usa PRIORITARIAMENTE, sono la fonte più autorevole):\n" + "\n".join(rules_text_parts))
    if url_parts:
        blocks.append("FONTI WEB MONITORATE (aggiornate automaticamente):\n" + "\n".join(url_parts))
    return ("\n\n".join(blocks)).strip()



# Include router & CORS
# =========================================================================
