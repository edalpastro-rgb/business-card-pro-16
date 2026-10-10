# 14_deadlines_axon_analysis.py — Scadenze contratti, analisi Axon interazioni, profilo comportamentale
# Estratto da server.py (righe originali 7075-7688). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V29 — Scadenze contratti (deadlines)
# Le bollette LUCE/GAS/TELCO estraggono già `data_attivazione`, `data_scadenza`
# e `durata_contratto_mesi`. Ricaviamo le scadenze in modo derivato senza
# duplicare il dato in DB, così se l'utente rianalizza una bolletta le
# scadenze si aggiornano automaticamente.
# =========================


def _parse_italian_date(raw: Any):
    """Parse a date-like string commonly found in Italian bills.
    Accepts DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD.MM.YYYY (also with 2-digit year).
    Returns a datetime.date or None."""
    from datetime import date as _date
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    s = str(raw).strip()
    if not s:
        return None
    s = s.replace(".", "/").replace("-", "/").replace(" ", "")
    parts = [p for p in s.split("/") if p]
    if len(parts) != 3:
        return None
    try:
        # Detect order: if first component is 4-digit → YYYY/MM/DD, else DD/MM/YYYY
        if len(parts[0]) == 4:
            y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        else:
            d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
        if y < 100:
            y += 2000 if y < 70 else 1900
        return _date(y, m, d)
    except Exception:
        return None


def _add_months(d, months: int):
    """Add N months to a date, clamping the day if the target month is shorter."""
    if not d or not months:
        return d
    import calendar as _cal
    total = d.month - 1 + int(months)
    y = d.year + total // 12
    m = total % 12 + 1
    last_day = _cal.monthrange(y, m)[1]
    return d.replace(year=y, month=m, day=min(d.day, last_day))


def _deadline_status(days_left: Optional[int]) -> str:
    if days_left is None:
        return "unknown"
    if days_left < 0:
        return "expired"
    if days_left <= 30:
        return "critical"
    if days_left <= 90:
        return "warning"
    return "ok"


def _compute_bill_deadline(bill: dict) -> Optional[dict]:
    """Return {activation_date, expiry_date (iso), days_left, status, source}
    for a bill, or None if no dates can be derived."""
    ext = (bill or {}).get("extracted") or {}
    if not isinstance(ext, dict):
        return None
    activation = _parse_italian_date(ext.get("data_attivazione"))
    explicit_expiry = _parse_italian_date(ext.get("data_scadenza"))
    duration_m = ext.get("durata_contratto_mesi")
    try:
        duration_m = int(duration_m) if duration_m else None
    except Exception:
        duration_m = None

    expiry = explicit_expiry
    source = "data_scadenza" if explicit_expiry else None
    if not expiry and activation:
        # Fallback: attivazione + durata_contratto_mesi. Se manca la durata, 12 mesi.
        months = duration_m if (duration_m and duration_m > 0) else 12
        expiry = _add_months(activation, months)
        source = "calcolata"
    # V50.z153 — Data scadenza impostata manualmente dall'utente: ha priorità
    # su quella letta/calcolata dalla bolletta.
    ovr = (bill or {}).get("deadline_override") or {}
    manual_expiry = _parse_italian_date(ovr.get("expiry_date")) if isinstance(ovr, dict) else None
    if manual_expiry:
        expiry = manual_expiry
        source = "manuale"
    if not expiry:
        return None
    from datetime import date as _date
    today = _date.today()
    days_left = (expiry - today).days
    return {
        "activation_date": activation.isoformat() if activation else None,
        "expiry_date": expiry.isoformat(),
        "days_left": days_left,
        "status": _deadline_status(days_left),
        "source": source or "data_scadenza",
        "duration_months": duration_m,
        "dismissed": bool((bill or {}).get("deadline_dismissed")),
    }


def _bill_deadline_entry(bill: dict) -> Optional[dict]:
    """Enriched deadline dict including bill metadata."""
    d = _compute_bill_deadline(bill)
    if not d:
        return None
    ext = bill.get("extracted") or {}
    return {
        "bill_id": bill.get("bill_id"),
        "contact_id": bill.get("contact_id"),
        "bill_type": bill.get("bill_type"),
        "pdf_name": bill.get("pdf_name"),
        "fornitore": ext.get("fornitore"),
        "nome_offerta": ext.get("nome_offerta"),
        **d,
    }


@api_router.get("/contacts/{contact_id}/deadlines")
async def contact_deadlines(contact_id: str, user=Depends(get_current_user)):
    """List all derived deadlines for a single contact (from its analysed bills)."""
    await _ensure_contact_owned(contact_id, user)
    items = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id, "status": "done"},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(200)
    out: List[dict] = []
    for it in items:
        entry = _bill_deadline_entry(it)
        if entry and not entry.get("dismissed"):
            out.append(entry)
    # Sort by days_left ascending (expired/critical first)
    out.sort(key=lambda x: (x.get("days_left") is None, x.get("days_left") or 999999))
    counts = {"expired": 0, "critical": 0, "warning": 0, "ok": 0}
    for d in out:
        counts[d.get("status", "ok")] = counts.get(d.get("status", "ok"), 0) + 1
    return {"items": out, "counts": counts}


@api_router.get("/deadlines/upcoming")
async def upcoming_deadlines(days: Optional[int] = None, user=Depends(get_current_user)):
    """Upcoming deadlines across all visible contacts, within `days` days from today.
    If `days` is not provided, falls back to user_settings.deadlines_window_days (default 60).
    Includes already expired items (days_left < 0) so users can act on overdue contracts."""
    settings = await db.user_settings.find_one({"user_id": user["user_id"]}, {"deadlines_window_days": 1}) or {}
    if not days or days <= 0:
        days = int(settings.get("deadlines_window_days") or 60)
    days = max(7, min(int(days), 365))

    # Only bills belonging to contacts the user can see
    tid = tenant_id(user)
    vis = await contact_visibility_filter(user)
    contact_query: Dict[str, Any] = {"user_id": tid}
    if vis:
        contact_query.update(vis)
    contacts = await db.contacts.find(
        contact_query,
        {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "contact_code": 1, "phone": 1},
    ).to_list(5000)
    cmap = {c["contact_id"]: c for c in contacts if c.get("contact_id")}
    if not cmap:
        return {"items": [], "counts": {"expired": 0, "critical": 0, "warning": 0, "ok": 0}, "days": days}

    bills = await db.energy_bills.find(
        {"user_id": tid, "contact_id": {"$in": list(cmap.keys())}, "status": "done"},
        {"_id": 0, "pdf_base64": 0},
    ).to_list(20000)

    out: List[dict] = []
    for b in bills:
        entry = _bill_deadline_entry(b)
        if not entry or entry.get("dismissed"):
            continue
        dl = entry.get("days_left")
        if dl is None:
            continue
        # Include expired (dl < 0) and upcoming within window
        if dl > days:
            continue
        c = cmap.get(entry.get("contact_id")) or {}
        entry["contact"] = {
            "contact_id": c.get("contact_id"),
            "first_name": c.get("first_name"),
            "last_name": c.get("last_name"),
            "contact_code": c.get("contact_code"),
            "phone": c.get("phone"),
        }
        out.append(entry)

    out.sort(key=lambda x: x.get("days_left") if x.get("days_left") is not None else 999999)
    counts = {"expired": 0, "critical": 0, "warning": 0, "ok": 0}
    for d in out:
        counts[d.get("status", "ok")] = counts.get(d.get("status", "ok"), 0) + 1
    return {"items": out, "counts": counts, "days": days}


# V50.z153 — Gestione avviso scadenza per singola bolletta:
#   • dismiss  → l'avviso sparisce da Home / Scadenze / conteggi
#   • expiry   → nuova data scadenza manuale, l'avviso si riattiva
#   • una nuova bolletta (o la rianalisi) riattiva automaticamente l'avviso
class DeadlineExpiryIn(BaseModel):
    expiry_date: str  # DD/MM/YYYY oppure YYYY-MM-DD


async def _get_owned_bill_for_deadline(bill_id: str, user) -> dict:
    b = await db.energy_bills.find_one(
        {"user_id": tenant_id(user), "bill_id": bill_id},
        {"_id": 0, "pdf_base64": 0},
    )
    if not b:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    if b.get("contact_id"):
        await _ensure_contact_owned(b["contact_id"], user)
    return b


@api_router.post("/deadlines/{bill_id}/dismiss")
async def dismiss_deadline(bill_id: str, user=Depends(get_current_user)):
    await _get_owned_bill_for_deadline(bill_id, user)
    await db.energy_bills.update_one(
        {"bill_id": bill_id},
        {"$set": {"deadline_dismissed": True, "deadline_dismissed_at": utcnow(), "deadline_dismissed_by": user["user_id"]}},
    )
    return {"ok": True, "dismissed": True}


@api_router.put("/deadlines/{bill_id}/expiry")
async def set_deadline_expiry(bill_id: str, body: DeadlineExpiryIn, user=Depends(get_current_user)):
    b = await _get_owned_bill_for_deadline(bill_id, user)
    d = _parse_italian_date(body.expiry_date)
    if not d:
        raise HTTPException(status_code=400, detail="Data non valida. Usa il formato GG/MM/AAAA")
    await db.energy_bills.update_one(
        {"bill_id": bill_id},
        {
            "$set": {"deadline_override": {"expiry_date": d.isoformat(), "set_at": utcnow(), "set_by": user["user_id"]}},
            "$unset": {"deadline_dismissed": "", "deadline_dismissed_at": "", "deadline_dismissed_by": ""},
        },
    )
    b["deadline_override"] = {"expiry_date": d.isoformat()}
    b.pop("deadline_dismissed", None)
    return {"ok": True, "deadline": _bill_deadline_entry(b)}



# =========================
# V29.g — Analisi Axon per interazione
# Dopo ogni interazione con un contatto (chiamata, nota, messaggio) Axon
# genera automaticamente un riassunto intelligente e lo archivia nel profilo.
# I riassunti si accumulano (nessuna sovrascrittura), sono derivati e possono
# essere rigenerati riprocessando l'interazione sorgente.
# =========================

_TONE_NORMALIZE = {
    "positive": "positive", "positivo": "positive",
    "neutral": "neutral", "neutro": "neutral",
    "skeptical": "skeptical", "scettico": "skeptical",
    "interested": "interested", "interessato": "interested",
    "negative": "negative", "negativo": "negative",
}


async def _axon_analyze_interaction_bg(
    tenant: str,
    user_id: str,
    contact_id: str,
    interaction_type: str,
    interaction_ref_id: Optional[str],
    interaction_summary: str,
    contact_ctx: Optional[dict] = None,
):
    """Fire-and-forget: chiama Claude per estrarre tono/argomenti/obiezioni/next_step
    e salva su `axon_analyses`. Non solleva mai eccezioni al chiamante."""
    try:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
        except Exception as e:
            logger.warning("[axon-analyze] emergentintegrations not available: %s", e)
            return
        key = os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            logger.warning("[axon-analyze] EMERGENT_LLM_KEY missing")
            return
        if not interaction_summary or not interaction_summary.strip():
            return

        ctx = contact_ctx or {}
        contact_name = " ".join([ctx.get("first_name") or "", ctx.get("last_name") or ""]).strip() or "il cliente"
        area = ctx.get("area") or "energy"

        system = (
            "Sei Axon, l'assistente CRM di un consulente energetico e networker italiano. "
            "Analizza l'interazione fornita e restituisci ESCLUSIVAMENTE JSON valido, "
            "senza testo prima o dopo, con questa struttura:\n"
            "{\n"
            "  \"tone\": one of [\"positive\", \"neutral\", \"skeptical\", \"interested\", \"negative\"],\n"
            "  \"topics\": [3-5 argomenti brevi in italiano],\n"
            "  \"objections\": [0-4 obiezioni rilevate, o [] se nessuna],\n"
            "  \"next_step\": una singola frase in italiano che dice al consulente il prossimo passo consigliato,\n"
            "  \"summary\": una frase riassuntiva dell'interazione in italiano\n"
            "}\n"
            "Non aggiungere spiegazioni. Ogni topic e obiezione deve essere di 2-6 parole. "
            "Se l'interazione e' troppo breve per essere analizzata, restituisci tono \"neutral\", "
            "topics vuoto, obiezioni vuote, next_step con un suggerimento generico."
        )
        prompt = (
            f"Contatto: {contact_name} (area: {area}).\n"
            f"Tipo interazione: {interaction_type}.\n"
            f"Contenuto:\n\"\"\"\n{interaction_summary[:4000]}\n\"\"\"\n\n"
            "Rispondi con il JSON."
        )
        chat = LlmChat(
            api_key=key,
            session_id=f"axon-a-{uuid.uuid4().hex[:8]}",
            system_message=system,
        ).with_model("anthropic", "claude-haiku-4-5")
        try:
            raw = await chat.send_message(UserMessage(text=prompt))
        except Exception as e:
            logger.warning("[axon-analyze] LLM error: %s", e)
            return
        data = _parse_llm_json(raw or "", fallback_key="summary")
        if not isinstance(data, dict):
            return
        tone_raw = str(data.get("tone") or "neutral").strip().lower()
        tone = _TONE_NORMALIZE.get(tone_raw, "neutral")
        topics = data.get("topics") or []
        objections = data.get("objections") or []
        next_step = str(data.get("next_step") or "").strip()
        summary = str(data.get("summary") or "").strip()
        if not isinstance(topics, list): topics = []
        if not isinstance(objections, list): objections = []
        topics = [str(t).strip() for t in topics if str(t or "").strip()][:8]
        objections = [str(t).strip() for t in objections if str(t or "").strip()][:6]

        doc = {
            "analysis_id": f"aa_{uuid.uuid4().hex[:12]}",
            "user_id": tenant,
            "created_by": user_id,
            "contact_id": contact_id,
            "interaction_type": interaction_type,
            "interaction_ref_id": interaction_ref_id,
            "interaction_snippet": interaction_summary[:400],
            "tone": tone,
            "topics": topics,
            "objections": objections,
            "next_step": next_step or None,
            "summary": summary or None,
            "created_at": utcnow(),
        }
        await db.axon_analyses.insert_one(doc)
        # V29.i — Fase 2: rigenera il profilo comportamentale aggregato dopo ogni analisi
        try:
            await _axon_build_profile_bg(tenant=tenant, user_id=user_id, contact_id=contact_id, contact_ctx=ctx)
        except Exception as e2:
            logger.warning("[axon-profile] build failed: %s", e2)
    except Exception as e:
        logger.exception("[axon-analyze] unexpected failure: %s", e)


async def _fetch_contact_ctx(user: dict, contact_id: str) -> Optional[dict]:
    """Recupera un piccolo dict con dati anagrafici per contestualizzare l'LLM."""
    try:
        return await db.contacts.find_one(
            scope_query(user, {"contact_id": contact_id}),
            {"_id": 0, "first_name": 1, "last_name": 1, "area": 1, "contact_id": 1},
        )
    except Exception:
        return None


def _schedule_axon_analysis(
    background: Optional[BackgroundTasks],
    user: dict,
    contact_id: str,
    interaction_type: str,
    interaction_ref_id: Optional[str],
    interaction_summary: str,
):
    """Utility che accoda l'analisi asincrona sull'evento CRM."""
    if not background:
        return
    if not interaction_summary or not interaction_summary.strip():
        return

    async def _run():
        ctx = await _fetch_contact_ctx(user, contact_id)
        await _axon_analyze_interaction_bg(
            tenant=tenant_id(user),
            user_id=user["user_id"],
            contact_id=contact_id,
            interaction_type=interaction_type,
            interaction_ref_id=interaction_ref_id,
            interaction_summary=interaction_summary,
            contact_ctx=ctx,
        )

    background.add_task(_run)


@api_router.get("/contacts/{contact_id}/axon-analyses")
async def list_axon_analyses(
    contact_id: str,
    limit: int = 20,
    user=Depends(get_current_user),
):
    """Ritorna la timeline "Analisi Axon" per un contatto, dalla piu' recente."""
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0, "contact_id": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    limit = max(1, min(int(limit or 20), 100))
    items = await db.axon_analyses.find(
        {"user_id": tenant_id(user), "contact_id": contact_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return {"items": items}


# =========================
# V29.i — Fase 2: Profilo comportamentale Axon
# Aggrega N analisi (Fase 1) e sintetizza un profilo aggiornato del cliente:
# stile comunicazione, livello interesse, obiezioni ricorrenti, momento migliore
# di contatto, suggerimento strategico. Upsert su axon_profiles.
# =========================

_STYLE_NORMALIZE = {
    "analitico": "analitico", "analytical": "analitico",
    "emotivo": "emotivo", "emotional": "emotivo",
    "diretto": "diretto", "direct": "diretto",
    "cauto": "cauto", "cautious": "cauto",
    "espansivo": "espansivo", "expansive": "espansivo", "socievole": "espansivo",
    "riservato": "riservato", "reserved": "riservato",
    "pragmatico": "pragmatico", "pragmatic": "pragmatico",
}
_INTEREST_NORMALIZE = {
    "high": "high", "alto": "high",
    "medium": "medium", "medio": "medium",
    "low": "low", "basso": "low",
}
_TIME_NORMALIZE = {
    "mattina": "mattina", "morning": "mattina",
    "pranzo": "pranzo", "midday": "pranzo",
    "pomeriggio": "pomeriggio", "afternoon": "pomeriggio",
    "sera": "sera", "serata": "sera", "evening": "sera",
    "weekend": "weekend",
}


async def _axon_build_profile_bg(
    tenant: str,
    user_id: str,
    contact_id: str,
    contact_ctx: Optional[dict] = None,
):
    """Aggrega le ultime analisi per il contatto e (ri)genera il profilo comportamentale.
    Idempotente: sovrascrive il documento in `axon_profiles` con la sintesi corrente.
    Non solleva mai eccezioni al chiamante."""
    try:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
        except Exception as e:
            logger.warning("[axon-profile] emergentintegrations not available: %s", e)
            return
        key = os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            logger.warning("[axon-profile] EMERGENT_LLM_KEY missing")
            return

        analyses = await db.axon_analyses.find(
            {"user_id": tenant, "contact_id": contact_id},
            {"_id": 0, "created_at": 1, "interaction_type": 1, "tone": 1,
             "topics": 1, "objections": 1, "next_step": 1, "summary": 1},
        ).sort("created_at", -1).to_list(30)
        if not analyses:
            return

        ctx = contact_ctx or {}
        contact_name = " ".join([ctx.get("first_name") or "", ctx.get("last_name") or ""]).strip() or "il cliente"
        area = ctx.get("area") or "energy"

        # Compatto un bullet per ogni analisi (dalla più recente alla più vecchia)
        bullets: List[str] = []
        for a in analyses[:20]:
            try:
                dt = a.get("created_at")
                if hasattr(dt, "strftime"):
                    ds = dt.strftime("%d/%m/%Y %H:%M")
                else:
                    ds = str(dt or "")[:16]
            except Exception:
                ds = ""
            bullets.append(
                f"- [{ds}] tipo={a.get('interaction_type')} tono={a.get('tone')}"
                + (f" topics={', '.join(a.get('topics') or [])}" if a.get('topics') else "")
                + (f" obiezioni={', '.join(a.get('objections') or [])}" if a.get('objections') else "")
                + (f" nextStep={a.get('next_step')}" if a.get('next_step') else "")
                + (f" | {a.get('summary')}" if a.get('summary') else "")
            )
        interactions_txt = "\n".join(bullets)

        system = (
            "Sei Axon, l'assistente CRM di un consulente energetico e networker italiano. "
            "Ti fornisco lo storico delle analisi delle interazioni di un contatto: "
            "sintetizza un PROFILO COMPORTAMENTALE aggiornato del cliente. "
            "Rispondi ESCLUSIVAMENTE con JSON valido nel seguente schema, senza testo prima o dopo:\n"
            "{\n"
            "  \"communication_style\": one of [\"analitico\", \"emotivo\", \"diretto\", \"cauto\", \"espansivo\", \"riservato\", \"pragmatico\"],\n"
            "  \"style_reason\": frase italiana breve (max 18 parole) che spiega perché,\n"
            "  \"interest_level\": one of [\"high\", \"medium\", \"low\"],\n"
            "  \"interest_trend\": one of [\"up\", \"flat\", \"down\"],\n"
            "  \"recurring_objections\": [0-5 obiezioni ricorrenti in italiano, 2-6 parole ciascuna],\n"
            "  \"best_contact_time\": one of [\"mattina\", \"pranzo\", \"pomeriggio\", \"sera\", \"weekend\", \"non rilevabile\"],\n"
            "  \"best_contact_time_reason\": frase italiana breve (max 15 parole),\n"
            "  \"strategic_suggestion\": una singola frase italiana (max 40 parole) con il prossimo passo strategico consigliato al consulente,\n"
            "  \"key_topics\": [3-6 argomenti di interesse ricorrenti]\n"
            "}\n"
            "Regole: se un dato non è deducibile dalle interazioni, usa \"non rilevabile\" per best_contact_time e stringa vuota per style_reason/best_contact_time_reason. "
            "Non ripetere pari-pari il testo delle singole interazioni: sintetizza."
        )
        prompt = (
            f"Contatto: {contact_name} (area: {area}).\n"
            f"Numero interazioni analizzate: {len(analyses)}.\n"
            f"Storico (dalla più recente):\n{interactions_txt}\n\n"
            "Genera il JSON del profilo."
        )
        chat = LlmChat(
            api_key=key,
            session_id=f"axon-p-{uuid.uuid4().hex[:8]}",
            system_message=system,
        ).with_model("anthropic", "claude-haiku-4-5")
        try:
            raw = await chat.send_message(UserMessage(text=prompt))
        except Exception as e:
            logger.warning("[axon-profile] LLM error: %s", e)
            return
        data = _parse_llm_json(raw or "", fallback_key="strategic_suggestion")
        if not isinstance(data, dict):
            return

        style_raw = str(data.get("communication_style") or "").strip().lower()
        style = _STYLE_NORMALIZE.get(style_raw, "pragmatico")
        interest_raw = str(data.get("interest_level") or "").strip().lower()
        interest = _INTEREST_NORMALIZE.get(interest_raw, "medium")
        trend_raw = str(data.get("interest_trend") or "flat").strip().lower()
        trend = trend_raw if trend_raw in ("up", "flat", "down") else "flat"
        best_time_raw = str(data.get("best_contact_time") or "").strip().lower()
        best_time = _TIME_NORMALIZE.get(best_time_raw, None)
        # Also accept the explicit italian "non rilevabile"
        if not best_time and "rilev" in best_time_raw:
            best_time = None

        rec_objs = data.get("recurring_objections") or []
        if not isinstance(rec_objs, list): rec_objs = []
        rec_objs = [str(o).strip() for o in rec_objs if str(o or "").strip()][:6]

        key_topics = data.get("key_topics") or []
        if not isinstance(key_topics, list): key_topics = []
        key_topics = [str(t).strip() for t in key_topics if str(t or "").strip()][:8]

        style_reason = str(data.get("style_reason") or "").strip()
        best_time_reason = str(data.get("best_contact_time_reason") or "").strip()
        suggestion = str(data.get("strategic_suggestion") or "").strip()

        now = utcnow()
        doc = {
            "user_id": tenant,
            "contact_id": contact_id,
            "communication_style": style,
            "style_reason": style_reason,
            "interest_level": interest,
            "interest_trend": trend,
            "recurring_objections": rec_objs,
            "best_contact_time": best_time,   # None se non rilevabile
            "best_contact_time_reason": best_time_reason,
            "strategic_suggestion": suggestion,
            "key_topics": key_topics,
            "based_on_count": len(analyses),
            "last_analysis_at": analyses[0].get("created_at"),
            "updated_at": now,
            "updated_by": user_id,
        }
        await db.axon_profiles.update_one(
            {"user_id": tenant, "contact_id": contact_id},
            {"$set": doc, "$setOnInsert": {"created_at": now, "profile_id": f"ap_{uuid.uuid4().hex[:12]}"}},
            upsert=True,
        )
    except Exception as e:
        logger.exception("[axon-profile] unexpected failure: %s", e)


@api_router.get("/contacts/{contact_id}/axon-profile")
async def get_axon_profile(contact_id: str, user=Depends(get_current_user)):
    """Ritorna il profilo comportamentale Axon corrente per il contatto (Fase 2).
    Se non esiste ancora perché non ci sono analisi, torna {profile: null, has_analyses: bool}."""
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), {"_id": 0, "contact_id": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    tid = tenant_id(user)
    prof = await db.axon_profiles.find_one({"user_id": tid, "contact_id": contact_id}, {"_id": 0})
    has_any = await db.axon_analyses.count_documents({"user_id": tid, "contact_id": contact_id}) > 0
    return {"profile": prof, "has_analyses": has_any}








# =========================
