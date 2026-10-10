# 35_reviews_leads.py — Sondaggio qualità + modulo lead pubblico
# Estratto da server.py (righe originali 24238-25315). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V50.z101 — PROMPT 24: Sondaggio qualità post-conversione (Review Requests)
# =====================================================================
# Flusso:
#  1. Master programma una richiesta recensione: canale (whatsapp/email/sms/telegram),
#     data/ora invio, testo personalizzabile.
#  2. Al momento programmato:
#     - Email → invio automatico via SMTP (se configurato).
#     - WhatsApp/SMS/Telegram → status="ready_to_send", il Master apre l'app,
#       clicca deep-link e viene aperto WA/SMS/Telegram con testo precompilato.
#  3. Il cliente riceve URL → apre form pubblico (JWT firmato, valido 30 giorni)
#     → invia stelle + testo + consenso liberatoria.
#  4. Il Master vede la review nella scheda cliente, la approva → visibile
#     nella pagina pubblica shareable dell'agente.

_REVIEW_CHANNELS = ("whatsapp", "email", "sms", "telegram")

class ReviewRequestCreateIn(BaseModel):
    channel: Literal["whatsapp", "email", "sms", "telegram"]
    scheduled_at: str  # ISO 8601
    custom_message: Optional[str] = None
    # Se True: preview immediato senza schedulare (usato per link "invia adesso")
    send_immediately: bool = False


class ReviewSubmitIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str = ""
    consent_publish: bool = False


class ReviewApproveIn(BaseModel):
    approved: bool
    admin_note: Optional[str] = None


class ReviewPublicLinkIn(BaseModel):
    # Placeholder per future opzioni (es. filtro categoria); non richiede body.
    force_regenerate: bool = False


def _build_public_base_url(request: Request) -> str:
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if fwd_proto and fwd_host:
        return f"{fwd_proto}://{fwd_host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def _review_default_message(contact_first_name: str, master_name: str, form_url: str) -> str:
    fn = contact_first_name or "Ciao"
    mn = master_name or "il tuo consulente"
    return (
        f"Ciao {fn}! 👋\n"
        f"Sono {mn}. Ti ringrazio per la fiducia.\n"
        f"Vorrei chiederti pochi secondi per lasciarmi una recensione — "
        f"il tuo feedback è prezioso.\n\n"
        f"👉 {form_url}\n\n"
        f"Grazie di cuore! 🙏"
    )


def _review_token_encode(req_id: str, user_id: str, ttl_days: int = 30) -> str:
    exp_dt = utcnow() + timedelta(days=ttl_days)
    return jwt.encode({
        "kind": "review_form",
        "req_id": req_id,
        "user_id": user_id,
        "exp": int(exp_dt.timestamp()),
    }, JWT_SECRET, algorithm=JWT_ALG)


def _review_token_decode(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=410, detail="Link scaduto")
    except Exception:
        raise HTTPException(status_code=400, detail="Link non valido")
    if payload.get("kind") != "review_form":
        raise HTTPException(status_code=400, detail="Token non compatibile")
    return payload


@api_router.post("/contacts/{contact_id}/review-request")
async def create_review_request(contact_id: str, body: ReviewRequestCreateIn,
                                request: Request, user=Depends(get_current_user)):
    tid = tenant_id(user)
    c = await db.contacts.find_one({"user_id": tid, "contact_id": contact_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")

    # Parse scheduled_at
    try:
        sched_dt = datetime.fromisoformat(body.scheduled_at.replace("Z", "+00:00"))
        if sched_dt.tzinfo is None:
            sched_dt = sched_dt.replace(tzinfo=timezone.utc)
        else:
            sched_dt = sched_dt.astimezone(timezone.utc)
    except Exception:
        raise HTTPException(status_code=422, detail="scheduled_at deve essere ISO 8601 (es. 2026-07-15T09:00:00Z)")

    # Se send_immediately → schedule now
    if body.send_immediately:
        sched_dt = utcnow()

    req_id = f"revq_{uuid.uuid4().hex[:12]}"
    token = _review_token_encode(req_id, tid, ttl_days=30)
    base = _build_public_base_url(request)
    # Frontend page (Expo Router serve /public-review/[token])
    form_url = f"{base}/public-review/{token}"
    api_url = f"{base}/api/public/review-form/{token}"

    contact_name = " ".join([c.get("first_name") or "", c.get("last_name") or ""]).strip() or "il cliente"
    master_doc = await db.users.find_one({"user_id": tid}, {"_id": 0, "first_name": 1, "last_name": 1, "email": 1})
    master_name = " ".join([(master_doc or {}).get("first_name") or "", (master_doc or {}).get("last_name") or ""]).strip() or ((master_doc or {}).get("email") or "il tuo consulente")

    default_msg = _review_default_message(c.get("first_name") or "", master_name, form_url)
    message_body = (body.custom_message.strip() if body.custom_message and body.custom_message.strip() else default_msg)
    # Auto-inject link se il messaggio custom non lo contiene già
    if form_url not in message_body:
        message_body = f"{message_body}\n\n👉 {form_url}"

    doc = {
        "req_id": req_id,
        "user_id": tid,
        "contact_id": contact_id,
        "contact_name": contact_name,
        "contact_phone": c.get("whatsapp") or c.get("phone") or "",
        "contact_email": c.get("email") or "",
        "contact_telegram": c.get("telegram") or "",
        "channel": body.channel,
        "scheduled_at": sched_dt,
        "custom_message": message_body,
        "form_url": form_url,
        "api_url": api_url,
        "token": token,
        "status": "pending",
        "created_by": user["user_id"],
        "created_at": utcnow(),
        "sent_at": None,
        "responded_at": None,
    }
    await db.review_requests.insert_one(doc)

    # Se già in passato e canale email → prova a inviare subito
    if body.send_immediately and body.channel == "email":
        try:
            await _send_review_email_request(doc)
        except Exception as exc:
            logger.warning(f"[review-request] immediate email failed: {exc}")

    resp = {k: v for k, v in doc.items() if k != "_id"}
    return resp


@api_router.get("/contacts/{contact_id}/review-requests")
async def list_review_requests_by_contact(contact_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    docs = await db.review_requests.find(
        {"user_id": tid, "contact_id": contact_id},
        {"_id": 0}
    ).sort("scheduled_at", -1).to_list(200)
    return {"items": docs}


@api_router.delete("/review-requests/{req_id}")
async def cancel_review_request(req_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.review_requests.find_one({"req_id": req_id, "user_id": tid}, {"_id": 0, "status": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if r.get("status") in ("responded",):
        raise HTTPException(status_code=400, detail="Impossibile cancellare: già risposta")
    await db.review_requests.update_one({"req_id": req_id}, {"$set": {"status": "cancelled"}})
    return {"ok": True}


@api_router.post("/review-requests/{req_id}/mark-sent")
async def mark_review_request_sent(req_id: str, user=Depends(get_current_user)):
    """Chiamato dal frontend dopo che il Master ha cliccato il deep-link WA/SMS/Telegram."""
    tid = tenant_id(user)
    r = await db.review_requests.update_one(
        {"req_id": req_id, "user_id": tid, "status": {"$in": ["pending", "ready_to_send"]}},
        {"$set": {"status": "sent", "sent_at": utcnow()}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Richiesta non trovabile o già inviata")
    return {"ok": True}


@api_router.get("/public/review-form/{token}")
async def public_review_form_info(token: str):
    """Ritorna metadati per il form pubblico (contact/master name, canale, status)."""
    payload = _review_token_decode(token)
    req_id = payload["req_id"]
    r = await db.review_requests.find_one({"req_id": req_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if r.get("status") == "cancelled":
        raise HTTPException(status_code=410, detail="Richiesta cancellata dal consulente")
    # Se già risposta → mostra thank-you
    already_responded = r.get("status") == "responded"
    return {
        "req_id": req_id,
        "contact_name": r.get("contact_name") or "",
        "channel": r.get("channel"),
        "status": r.get("status"),
        "already_responded": already_responded,
    }


@api_router.post("/public/review-form/{token}")
async def public_review_submit(token: str, body: ReviewSubmitIn):
    payload = _review_token_decode(token)
    req_id = payload["req_id"]
    user_id = payload["user_id"]
    r = await db.review_requests.find_one({"req_id": req_id, "user_id": user_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if r.get("status") == "cancelled":
        raise HTTPException(status_code=410, detail="Richiesta cancellata")
    # Non permettiamo doppia risposta
    existing = await db.reviews.find_one({"req_id": req_id}, {"_id": 0, "review_id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="Recensione già inviata per questa richiesta")

    review_id = f"rev_{uuid.uuid4().hex[:12]}"
    review = {
        "review_id": review_id,
        "req_id": req_id,
        "user_id": user_id,
        "contact_id": r.get("contact_id"),
        "contact_name": r.get("contact_name") or "",
        "rating": int(body.rating),
        "text": (body.text or "").strip(),
        "consent_publish": bool(body.consent_publish),
        "submitted_at": utcnow(),
        "approved": None,
        "approved_at": None,
        "approved_by": None,
        "admin_note": None,
    }
    await db.reviews.insert_one(review)
    await db.review_requests.update_one(
        {"req_id": req_id},
        {"$set": {"status": "responded", "responded_at": utcnow()}},
    )
    return {"ok": True, "review_id": review_id}


@api_router.get("/contacts/{contact_id}/reviews")
async def list_reviews_by_contact(contact_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    docs = await db.reviews.find(
        {"user_id": tid, "contact_id": contact_id},
        {"_id": 0}
    ).sort("submitted_at", -1).to_list(200)
    return {"items": docs}


@api_router.get("/reviews")
async def list_reviews(status: str = "all", user=Depends(get_current_user)):
    """Lista tutte le review del tenant. status: all|pending|approved|rejected."""
    tid = tenant_id(user)
    q: Dict[str, Any] = {"user_id": tid}
    if status == "pending":
        q["approved"] = None
    elif status == "approved":
        q["approved"] = True
    elif status == "rejected":
        q["approved"] = False
    docs = await db.reviews.find(q, {"_id": 0}).sort("submitted_at", -1).to_list(500)
    return {"items": docs}


@api_router.patch("/reviews/{review_id}/approve")
async def approve_review(review_id: str, body: ReviewApproveIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.reviews.find_one({"user_id": tid, "review_id": review_id}, {"_id": 0, "review_id": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Recensione non trovata")
    await db.reviews.update_one(
        {"review_id": review_id},
        {"$set": {
            "approved": bool(body.approved),
            "approved_at": utcnow(),
            "approved_by": user["user_id"],
            "admin_note": (body.admin_note or None),
        }},
    )
    return {"ok": True, "approved": bool(body.approved)}


@api_router.delete("/reviews/{review_id}")
async def delete_review(review_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.reviews.delete_one({"user_id": tid, "review_id": review_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Recensione non trovata")
    return {"ok": True}


@api_router.get("/reviews/analytics")
async def reviews_analytics(user=Depends(get_current_user)):
    """V50.z102 — Dashboard: media stelle, trend mensile 12 mesi, top clienti,
    distribuzione stelle, tasso risposta."""
    tid = tenant_id(user)
    # Fetch tutte le review approvate + pending + rejected (con data)
    all_reviews = await db.reviews.find(
        {"user_id": tid},
        {"_id": 0, "review_id": 1, "rating": 1, "approved": 1, "text": 1,
         "contact_id": 1, "contact_name": 1, "submitted_at": 1, "consent_publish": 1}
    ).to_list(5000)

    approved = [r for r in all_reviews if r.get("approved") is True]
    pending = [r for r in all_reviews if r.get("approved") is None]
    rejected = [r for r in all_reviews if r.get("approved") is False]

    avg = None
    if approved:
        avg = round(sum(int(r.get("rating") or 0) for r in approved) / len(approved), 2)

    # Distribuzione stelle (solo approvate)
    distribution = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
    for r in approved:
        rate = str(int(r.get("rating") or 0))
        if rate in distribution:
            distribution[rate] += 1

    # Trend mensile 12 mesi (approvate + pending — tutto quello che ha submitted_at)
    from collections import defaultdict as _dd
    now = utcnow()
    months = []
    for i in range(11, -1, -1):
        y = now.year
        m = now.month - i
        while m <= 0:
            m += 12
            y -= 1
        months.append(f"{y}-{m:02d}")
    monthly_counts: dict = _dd(lambda: {"count": 0, "total": 0, "approved": 0})
    for r in all_reviews:
        sub = r.get("submitted_at")
        if not sub:
            continue
        try:
            key = f"{sub.year}-{sub.month:02d}"
        except Exception:
            continue
        if key not in monthly_counts and key not in months:
            continue
        monthly_counts[key]["count"] += 1
        monthly_counts[key]["total"] += int(r.get("rating") or 0)
        if r.get("approved") is True:
            monthly_counts[key]["approved"] += 1
    monthly_trend = []
    for mk in months:
        agg = monthly_counts.get(mk, {"count": 0, "total": 0, "approved": 0})
        cnt = agg["count"]
        monthly_trend.append({
            "month": mk,
            "count": cnt,
            "approved": agg["approved"],
            "avg": round(agg["total"] / cnt, 2) if cnt else 0,
        })

    # Top clienti (approvate, rating desc, poi date desc). Max 6.
    top = sorted(approved, key=lambda r: (int(r.get("rating") or 0), r.get("submitted_at") or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)[:6]
    top_clients = []
    for r in top:
        text = (r.get("text") or "").strip()
        top_clients.append({
            "contact_id": r.get("contact_id"),
            "contact_name": r.get("contact_name") or "Cliente",
            "rating": int(r.get("rating") or 0),
            "excerpt": (text[:180] + ("…" if len(text) > 180 else "")) if text else "",
            "submitted_at": (r.get("submitted_at").isoformat() if r.get("submitted_at") else None),
        })

    # Tasso risposta: recensioni ricevute / richieste totali (non cancelled)
    total_requests = await db.review_requests.count_documents({"user_id": tid, "status": {"$ne": "cancelled"}})
    response_rate = None
    if total_requests > 0:
        response_rate = round(len(all_reviews) / total_requests * 100, 1)

    # Requests aggregati per stato
    req_by_status: dict = {"pending": 0, "ready_to_send": 0, "sent": 0, "responded": 0, "cancelled": 0}
    async for r in db.review_requests.find({"user_id": tid}, {"_id": 0, "status": 1}):
        s = r.get("status") or "pending"
        req_by_status[s] = req_by_status.get(s, 0) + 1

    return {
        "average_rating": avg,
        "total_reviews": len(all_reviews),
        "total_approved": len(approved),
        "total_pending": len(pending),
        "total_rejected": len(rejected),
        "distribution": distribution,
        "monthly_trend": monthly_trend,
        "top_clients": top_clients,
        "response_rate_pct": response_rate,
        "total_requests": total_requests,
        "requests_by_status": req_by_status,
    }


@api_router.post("/reviews/public-link")
async def get_public_reviews_link(body: ReviewPublicLinkIn, request: Request, user=Depends(get_current_user)):
    """Ritorna (e se necessario crea) lo slug pubblico permanente per la pagina recensioni del tenant."""
    tid = tenant_id(user)
    settings = await db.user_settings.find_one({"user_id": tid}, {"_id": 0, "reviews_public_slug": 1}) or {}
    slug = settings.get("reviews_public_slug")
    if not slug or body.force_regenerate:
        slug = f"rev-{uuid.uuid4().hex[:16]}"
        await db.user_settings.update_one(
            {"user_id": tid},
            {"$set": {"reviews_public_slug": slug, "user_id": tid}},
            upsert=True,
        )
    base = _build_public_base_url(request)
    return {
        "slug": slug,
        "public_url": f"{base}/public-reviews/{slug}",
        "api_url": f"{base}/api/public/reviews/{slug}",
    }


@api_router.get("/public/reviews/{slug}")
async def public_reviews_list(slug: str):
    """Pagina pubblica: elenca le recensioni approvate del tenant con consent_publish=True."""
    st = await db.user_settings.find_one({"reviews_public_slug": slug}, {"_id": 0, "user_id": 1})
    if not st:
        raise HTTPException(status_code=404, detail="Pagina non trovata")
    tid = st.get("user_id")
    master = await db.users.find_one({"user_id": tid}, {"_id": 0, "first_name": 1, "last_name": 1, "email": 1})
    master_name = " ".join([(master or {}).get("first_name") or "", (master or {}).get("last_name") or ""]).strip() or ((master or {}).get("email") or "Consulente")
    reviews = await db.reviews.find(
        {"user_id": tid, "approved": True, "consent_publish": True},
        {"_id": 0, "rating": 1, "text": 1, "submitted_at": 1, "contact_name": 1}
    ).sort("submitted_at", -1).to_list(200)

    # Anonymizza: solo primo nome + iniziale cognome
    def _short(name: str) -> str:
        parts = (name or "").strip().split()
        if not parts:
            return "Cliente"
        first = parts[0]
        last_i = (parts[1][0] + ".") if len(parts) >= 2 and parts[1] else ""
        return (first + " " + last_i).strip()

    out = []
    total_rating = 0
    for r in reviews:
        total_rating += int(r.get("rating") or 0)
        out.append({
            "rating": int(r.get("rating") or 0),
            "text": r.get("text") or "",
            "date": (r.get("submitted_at").isoformat() if r.get("submitted_at") else None),
            "author": _short(r.get("contact_name") or ""),
        })
    avg = round(total_rating / len(out), 2) if out else None
    return {
        "master_name": master_name,
        "reviews": out,
        "count": len(out),
        "average_rating": avg,
    }


# -------- Sending helpers ----------
async def _send_review_email_request(req_doc: dict, is_followup: bool = False) -> bool:
    """Invia email di richiesta recensione via SMTP del tenant, se configurato.
    Se is_followup=True usa un tono più cortese/promemoria."""
    tid = req_doc.get("user_id")
    to_email = (req_doc.get("contact_email") or "").strip()
    if not to_email:
        return False
    cfg = await db.smtp_configs.find_one({"user_id": tid}, {"_id": 0})
    if not cfg or not cfg.get("host"):
        return False
    if is_followup:
        subject = f"Piccolo promemoria — grazie in anticipo {req_doc.get('contact_name') or ''}".strip(" —")
        body_text = (
            f"Ciao {(req_doc.get('contact_name') or '').split(' ')[0] or ''} 👋\n"
            f"Ti ho scritto qualche giorno fa per chiederti una veloce recensione.\n"
            f"Se hai un minuto (davvero, bastano 30 secondi) puoi farlo qui:\n\n"
            f"👉 {req_doc.get('form_url', '')}\n\n"
            f"Se non ti va, nessun problema — non ti disturberò più. Grazie ancora!"
        )
    else:
        subject = f"Un secondo per una recensione? — {req_doc.get('contact_name') or ''}".strip(" —")
        body_text = req_doc.get("custom_message") or ""
    form_url = req_doc.get("form_url") or ""
    body_html = f"""<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
<p style="font-size:16px;line-height:1.5;white-space:pre-wrap">{body_text}</p>
<p style="margin-top:24px"><a href="{form_url}" style="background:#8B5CF6;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Lascia la recensione</a></p>
<p style="color:#888;font-size:12px;margin-top:32px">Se il pulsante non funziona, apri questo link:<br/><a href="{form_url}">{form_url}</a></p>
</body></html>"""
    try:
        await asyncio.to_thread(_send_smtp_email, cfg, to_email, subject, body_text, body_html)
        return True
    except Exception as exc:
        logger.warning(f"[review-request] email send failed for req {req_doc.get('req_id')}: {exc}")
        return False


async def _run_review_requests_dispatch_job() -> None:
    """Ogni 5 min: processa review_requests con scheduled_at scaduto.
    - channel=email → invia via SMTP e status=sent.
    - channel=whatsapp|sms|telegram → status=ready_to_send (il Master vedrà pulsante deep-link).
    """
    try:
        cutoff = utcnow()
        pending = await db.review_requests.find({
            "status": "pending",
            "scheduled_at": {"$lte": cutoff},
        }).to_list(500)
        for r in pending:
            ch = r.get("channel")
            try:
                if ch == "email":
                    sent = await _send_review_email_request(r)
                    if sent:
                        await db.review_requests.update_one(
                            {"req_id": r["req_id"]},
                            {"$set": {"status": "sent", "sent_at": utcnow()}},
                        )
                    else:
                        # Nessun SMTP → fallback a ready_to_send perché il Master possa
                        # aprire il client mail manualmente (mailto:) o riprogrammare.
                        await db.review_requests.update_one(
                            {"req_id": r["req_id"]},
                            {"$set": {"status": "ready_to_send"}},
                        )
                else:
                    await db.review_requests.update_one(
                        {"req_id": r["req_id"]},
                        {"$set": {"status": "ready_to_send"}},
                    )
            except Exception as exc:
                logger.warning(f"[review-dispatch] {r.get('req_id')} failed: {exc}")
    except Exception as exc:
        logger.warning(f"[review-dispatch-job] failed: {exc}")


async def _run_review_followup_job() -> None:
    """V50.z102 — Ogni ora: se una richiesta è stata inviata ≥3 giorni fa e il
    cliente non ha ancora risposto (nessuna review associata), invia un secondo
    sollecito educato.
    - Email: seconda email tono cortese (auto)
    - WA/SMS/Telegram: nuova entry status=ready_to_send (Master la vedrà con badge sollecito)
    - Solo un sollecito per richiesta (follow_up_sent=True).
    """
    try:
        cutoff = utcnow() - timedelta(days=3)
        candidates = await db.review_requests.find({
            "status": {"$in": ["sent", "ready_to_send"]},
            "sent_at": {"$lte": cutoff, "$ne": None},
            "$or": [{"follow_up_sent": {"$exists": False}}, {"follow_up_sent": False}],
        }).to_list(500)
        for r in candidates:
            req_id = r.get("req_id")
            # Se c'è già una review, skip
            existing_rev = await db.reviews.find_one({"req_id": req_id}, {"_id": 0, "review_id": 1})
            if existing_rev:
                await db.review_requests.update_one(
                    {"req_id": req_id}, {"$set": {"follow_up_sent": True, "follow_up_at": utcnow()}}
                )
                continue
            ch = r.get("channel")
            try:
                if ch == "email":
                    sent_ok = await _send_review_email_request(r, is_followup=True)
                    await db.review_requests.update_one(
                        {"req_id": req_id},
                        {"$set": {
                            "follow_up_sent": True,
                            "follow_up_at": utcnow(),
                            # Se non c'è SMTP, forziamo ready_to_send per il fallback manuale
                            **({} if sent_ok else {"status": "ready_to_send", "follow_up_manual": True}),
                        }}
                    )
                else:
                    # Riporta a ready_to_send per far vedere al Master il "Sollecita ora"
                    await db.review_requests.update_one(
                        {"req_id": req_id},
                        {"$set": {
                            "status": "ready_to_send",
                            "follow_up_sent": True,
                            "follow_up_at": utcnow(),
                        }}
                    )
            except Exception as exc:
                logger.warning(f"[review-followup] {req_id} failed: {exc}")
    except Exception as exc:
        logger.warning(f"[review-followup-job] failed: {exc}")


# =====================================================================
# V50.z103 — PROMPT 25: Modulo Lead pubblico con AxonOS
# =====================================================================
# Flusso:
#  1. Master ottiene link pubblico (slug permanente) da condividere.
#  2. Chiunque compila il form pubblico (nome, email, tel, checkbox esigenze,
#     testo libero, privacy).
#  3. Al submit AxonOS (Claude Sonnet 5) genera una risposta personalizzata
#     con le "soluzioni AdvisorOS" più adatte.
#  4. Master riceve notifica push, vede il lead, può regenerare/modificare
#     la risposta e inviarla via email o WhatsApp/SMS/Telegram (deep-link).

LEAD_NEEDS_FIXED = [
    {"id": "luce", "label": "Fornitura Luce", "emoji": "💡"},
    {"id": "gas", "label": "Fornitura Gas", "emoji": "🔥"},
    {"id": "fibra", "label": "Fibra / Internet", "emoji": "📶"},
    {"id": "fotovoltaico", "label": "Fotovoltaico / Batterie", "emoji": "☀️"},
    {"id": "networker", "label": "Consulenza / Collaborazione rete", "emoji": "🤝"},
]

_LEAD_NEED_IDS_DEFAULT = {n["id"] for n in LEAD_NEEDS_FIXED}


async def _get_tenant_lead_needs(tid: str) -> List[dict]:
    """Ritorna le esigenze configurate dal tenant o i default fissi.
    Ogni voce: {id, label, emoji}."""
    st = await db.user_settings.find_one({"user_id": tid}, {"_id": 0, "lead_needs": 1}) or {}
    custom = st.get("lead_needs")
    if isinstance(custom, list) and len(custom) > 0:
        out: List[dict] = []
        for n in custom:
            if not isinstance(n, dict):
                continue
            nid = str(n.get("id") or "").strip()
            label = str(n.get("label") or "").strip()
            emoji = str(n.get("emoji") or "").strip() or "•"
            if nid and label:
                out.append({"id": nid, "label": label, "emoji": emoji})
        if out:
            return out
    return list(LEAD_NEEDS_FIXED)


class LeadNeedItem(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=80)
    emoji: str = ""


class LeadNeedsConfigIn(BaseModel):
    needs: List[LeadNeedItem]


class LeadSubmitIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    needs: List[str] = Field(default_factory=list)
    free_text: str = ""
    consent_privacy: bool


class LeadReplyIn(BaseModel):
    channel: Literal["email", "whatsapp", "sms", "telegram"]
    text: Optional[str] = None  # Se None usa axon_reply_text


class LeadRegenerateIn(BaseModel):
    style: Optional[str] = None  # "friendly" | "professional" | "short"


class LeadStatusIn(BaseModel):
    status: Literal["new", "analyzed", "approved", "replied", "archived"]


def _lead_labels_for_needs(needs: List[str], all_needs: Optional[List[dict]] = None) -> List[str]:
    """Mappa gli id in label. Se all_needs è passato, usa quelli (tenant custom),
    altrimenti usa i default fissi."""
    pool = all_needs or LEAD_NEEDS_FIXED
    return [n["label"] for n in pool if n["id"] in (needs or [])]


async def _generate_axon_lead_reply(lead: dict, master_name: str, style: str = "friendly") -> str:
    """Genera una risposta personalizzata via Claude Sonnet 5 con `emergentintegrations`.
    Ritorna il testo (max ~800 caratteri) pronto da inviare via email/WhatsApp."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        # Fallback statico se manca la chiave
        return await _lead_fallback_reply(lead, master_name)

    # Usa needs del tenant (custom o default)
    tenant_needs = await _get_tenant_lead_needs(lead.get("user_id", ""))
    need_labels = _lead_labels_for_needs(lead.get("needs") or [], all_needs=tenant_needs)
    needs_txt = ", ".join(need_labels) if need_labels else "non specificate"
    free_text = (lead.get("free_text") or "").strip() or "(nessun messaggio aggiuntivo)"
    first_name = ((lead.get("full_name") or "").split(" ")[0]) or "amico"

    style_txt = "amichevole ma professionale"
    if style == "professional":
        style_txt = "professionale e formale (Lei/formale)"
    elif style == "short":
        style_txt = "amichevole, MOLTO breve (max 4 righe)"

    system = (
        "Sei AxonOS, l'assistente AI di un consulente italiano (energia + networker AdvisorOS). "
        "Ricevi la richiesta di un potenziale cliente arrivata da un form pubblico. "
        f"Scrivi una risposta IN ITALIANO, tono {style_txt}, che:\n"
        "1) Ringrazi per la richiesta e usi il nome del lead.\n"
        "2) Mostri comprensione delle esigenze indicate (max 2 frasi).\n"
        "3) Proponga la soluzione AdvisorOS più adatta per ogni esigenza (bullet compatti). "
        "Le nostre soluzioni tipiche sono: analisi bolletta gratuita, migliori tariffe Luce/Gas "
        "in convenzione, fibra domestica business/consumer, impianti fotovoltaici chiavi in mano "
        "con batteria, collaborazione come networker con formazione e supporto costante.\n"
        "4) Proponga un breve appuntamento (call/WhatsApp/incontro).\n"
        "5) Firma con il nome del consulente.\n"
        "Non inventare prezzi specifici, non promettere risparmi numerici certi. Max 1400 caratteri. "
        "Formato piatto adatto sia a email sia a WhatsApp (niente markdown)."
    )
    user_msg = (
        f"NOME CONSULENTE: {master_name}\n"
        f"LEAD: {lead.get('full_name')}\n"
        f"EMAIL: {lead.get('email') or 'n/d'}\n"
        f"TELEFONO: {lead.get('phone') or 'n/d'}\n"
        f"ESIGENZE INDICATE: {needs_txt}\n"
        f"MESSAGGIO LIBERO:\n{free_text}\n\n"
        f"Scrivi la risposta pronta da inviare (senza intestazioni tipo 'Oggetto:' o 'A:')."
    )
    try:
        chat = LlmChat(
            api_key=key,
            session_id=f"lead-reply-{uuid.uuid4().hex[:8]}",
            system_message=system,
        ).with_model("anthropic", "claude-haiku-4-5")
        resp = await chat.send_message(UserMessage(text=user_msg))
        text = (str(resp) or "").strip()
        # Cap dimensione per sicurezza
        if len(text) > 1600:
            text = text[:1600].rstrip() + "…"
        return text or await _lead_fallback_reply(lead, master_name)
    except Exception as exc:
        logger.warning(f"[axon-lead-reply] LLM failed: {exc}")
        return await _lead_fallback_reply(lead, master_name)


async def _lead_fallback_reply(lead: dict, master_name: str) -> str:
    first_name = ((lead.get("full_name") or "").split(" ")[0]) or "Ciao"
    tenant_needs = await _get_tenant_lead_needs(lead.get("user_id", ""))
    need_labels = _lead_labels_for_needs(lead.get("needs") or [], all_needs=tenant_needs)
    needs_line = (
        "Ho visto che ti interessano: " + ", ".join(need_labels).lower() + ".\n"
        if need_labels else ""
    )
    return (
        f"Ciao {first_name}, grazie per la tua richiesta!\n\n"
        f"{needs_line}"
        "Ti propongo di sentirci per capire meglio la tua situazione e darti un preventivo/consulenza "
        "gratuita. Se preferisci, possiamo fissare una call oppure scambiarci qualche messaggio su WhatsApp — "
        "come ti è più comodo.\n\n"
        f"A presto,\n{master_name}"
    )


@api_router.get("/leads/needs-config")
async def get_lead_needs_config(user=Depends(get_current_user)):
    """Ritorna la configurazione esigenze del tenant (custom o default fissi) +
    flag `is_default` per indicare se il tenant sta usando i default."""
    tid = tenant_id(user)
    st = await db.user_settings.find_one({"user_id": tid}, {"_id": 0, "lead_needs": 1}) or {}
    custom = st.get("lead_needs")
    is_default = not (isinstance(custom, list) and len(custom) > 0)
    needs = await _get_tenant_lead_needs(tid)
    return {"needs": needs, "is_default": is_default, "defaults": LEAD_NEEDS_FIXED}


@api_router.put("/leads/needs-config")
async def put_lead_needs_config(body: LeadNeedsConfigIn, user=Depends(get_current_user)):
    """Salva la lista esigenze custom del tenant. Vincoli: min 1, max 12 voci,
    id unici, id in slug-format (a-z0-9-)."""
    tid = tenant_id(user)
    if len(body.needs) < 1:
        raise HTTPException(status_code=400, detail="Almeno 1 esigenza richiesta")
    if len(body.needs) > 12:
        raise HTTPException(status_code=400, detail="Massimo 12 esigenze")
    seen: set = set()
    cleaned: List[dict] = []
    for n in body.needs:
        nid = re.sub(r"[^a-z0-9-]", "", (n.id or "").lower().strip())[:40]
        if not nid:
            raise HTTPException(status_code=400, detail=f"ID non valido: '{n.id}' (usa solo a-z, 0-9, -)")
        if nid in seen:
            raise HTTPException(status_code=400, detail=f"ID duplicato: '{nid}'")
        seen.add(nid)
        label = (n.label or "").strip()[:80]
        emoji = (n.emoji or "").strip()[:8] or "•"
        cleaned.append({"id": nid, "label": label, "emoji": emoji})
    await db.user_settings.update_one(
        {"user_id": tid},
        {"$set": {"lead_needs": cleaned, "user_id": tid}},
        upsert=True,
    )
    return {"ok": True, "needs": cleaned}


@api_router.post("/leads/needs-config/reset")
async def reset_lead_needs_config(user=Depends(get_current_user)):
    """Ripristina le 5 esigenze default (rimuove il custom)."""
    tid = tenant_id(user)
    await db.user_settings.update_one(
        {"user_id": tid},
        {"$unset": {"lead_needs": ""}},
    )
    return {"ok": True, "needs": LEAD_NEEDS_FIXED}


@api_router.post("/leads/public-link")
async def get_lead_public_link(request: Request, user=Depends(get_current_user)):
    """Ritorna (creando se manca) lo slug pubblico permanente per il form lead del tenant."""
    tid = tenant_id(user)
    settings = await db.user_settings.find_one({"user_id": tid}, {"_id": 0, "lead_public_slug": 1}) or {}
    slug = settings.get("lead_public_slug")
    if not slug:
        slug = f"lead-{uuid.uuid4().hex[:16]}"
        await db.user_settings.update_one(
            {"user_id": tid},
            {"$set": {"lead_public_slug": slug, "user_id": tid}},
            upsert=True,
        )
    base = _build_public_base_url(request)
    return {
        "slug": slug,
        "public_url": f"{base}/public-lead/{slug}",
        "api_url": f"{base}/api/public/lead-form/{slug}",
    }


@api_router.get("/public/lead-form/{slug}")
async def public_lead_form_meta(slug: str):
    """Ritorna nome master + esigenze da mostrare nel form pubblico. Nessun auth."""
    st = await db.user_settings.find_one({"lead_public_slug": slug}, {"_id": 0, "user_id": 1})
    if not st:
        raise HTTPException(status_code=404, detail="Pagina non trovata")
    tid = st.get("user_id")
    master = await db.users.find_one({"user_id": tid}, {"_id": 0, "first_name": 1, "last_name": 1, "email": 1})
    master_name = " ".join([(master or {}).get("first_name") or "", (master or {}).get("last_name") or ""]).strip() or ((master or {}).get("email") or "Consulente")
    needs = await _get_tenant_lead_needs(tid)
    return {
        "master_name": master_name,
        "needs": needs,
    }


@api_router.post("/public/lead-form/{slug}")
async def public_lead_submit(slug: str, body: LeadSubmitIn):
    """Riceve un lead pubblico, salva su DB, genera risposta AxonOS in background."""
    if not body.consent_privacy:
        raise HTTPException(status_code=400, detail="Devi accettare l'informativa privacy")
    st = await db.user_settings.find_one({"lead_public_slug": slug}, {"_id": 0, "user_id": 1})
    if not st:
        raise HTTPException(status_code=404, detail="Pagina non trovata")
    tid = st.get("user_id")

    # Filtra needs solo su ID validi (tenant custom o default)
    tenant_needs = await _get_tenant_lead_needs(tid)
    valid_ids = {n["id"] for n in tenant_needs} or _LEAD_NEED_IDS_DEFAULT
    valid_needs = [n for n in (body.needs or []) if n in valid_ids]

    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    doc = {
        "lead_id": lead_id,
        "user_id": tid,
        "full_name": body.full_name.strip(),
        "email": (body.email or "").strip().lower() or None,
        "phone": (body.phone or "").strip() or None,
        "needs": valid_needs,
        "free_text": (body.free_text or "").strip(),
        "consent_privacy": True,
        "created_at": utcnow(),
        "status": "new",
        "axon_reply_text": None,
        "axon_generated_at": None,
        "master_reply_text": None,
        "master_reply_channel": None,
        "master_replied_at": None,
    }
    await db.public_leads.insert_one(doc)

    # Genera reply Axon (best-effort, se fallisce lo status resta 'new')
    try:
        master = await db.users.find_one({"user_id": tid}, {"_id": 0, "first_name": 1, "last_name": 1, "email": 1})
        master_name = " ".join([(master or {}).get("first_name") or "", (master or {}).get("last_name") or ""]).strip() or ((master or {}).get("email") or "il tuo consulente")
        reply_text = await _generate_axon_lead_reply(doc, master_name, style="friendly")
        await db.public_leads.update_one(
            {"lead_id": lead_id},
            {"$set": {"axon_reply_text": reply_text, "axon_generated_at": utcnow(), "status": "analyzed"}},
        )
    except Exception as exc:
        logger.warning(f"[lead-submit] axon reply failed for {lead_id}: {exc}")

    # Push notification al master (best-effort, riutilizza infrastruttura esistente)
    try:
        await _send_lead_push_notification(tid, doc)
    except Exception as exc:
        logger.debug(f"[lead-submit] push failed: {exc}")

    return {"ok": True, "lead_id": lead_id}


async def _send_lead_push_notification(tid: str, lead: dict) -> None:
    """Invia notifica push al master per nuovo lead. Best-effort."""
    try:
        tokens = await db.push_tokens.find({"user_id": tid}, {"_id": 0, "token": 1}).to_list(20)
    except Exception:
        tokens = []
    if not tokens:
        return
    tenant_needs = await _get_tenant_lead_needs(tid)
    try:
        from emergent_push import send_push  # potrebbe non esistere in questa env
    except Exception:
        # Fallback: usa Expo push HTTP diretto (già usato altrove nel codebase)
        try:
            body_text = (lead.get("full_name") or "Nuovo lead") + (
                " · " + ", ".join(_lead_labels_for_needs(lead.get("needs") or [], all_needs=tenant_needs)[:2])
                if lead.get("needs") else ""
            )
            payload = {
                "to": [t["token"] for t in tokens if t.get("token")],
                "title": "🆕 Nuova richiesta info",
                "body": body_text[:120],
                "data": {"deeplink": f"/leads/{lead.get('lead_id')}", "tag": "lead_new"},
                "sound": "default",
                "priority": "high",
            }
            async with httpx.AsyncClient(timeout=8) as c:
                await c.post("https://exp.host/--/api/v2/push/send", json=payload)
        except Exception:
            pass


@api_router.get("/leads")
async def list_leads(status: str = "all", user=Depends(get_current_user)):
    tid = tenant_id(user)
    q: Dict[str, Any] = {"user_id": tid}
    if status and status != "all":
        q["status"] = status
    docs = await db.public_leads.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": docs}


@api_router.get("/leads/count")
async def leads_count(user=Depends(get_current_user)):
    """Conteggi per badge navigation."""
    tid = tenant_id(user)
    total = await db.public_leads.count_documents({"user_id": tid})
    new_or_analyzed = await db.public_leads.count_documents({"user_id": tid, "status": {"$in": ["new", "analyzed"]}})
    return {"total": total, "unread": new_or_analyzed}


@api_router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    doc = await db.public_leads.find_one({"user_id": tid, "lead_id": lead_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Lead non trovato")
    return doc


@api_router.post("/leads/{lead_id}/regenerate-axon")
async def regenerate_lead_reply(lead_id: str, body: LeadRegenerateIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    lead = await db.public_leads.find_one({"user_id": tid, "lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead non trovato")
    master = await db.users.find_one({"user_id": tid}, {"_id": 0, "first_name": 1, "last_name": 1, "email": 1})
    master_name = " ".join([(master or {}).get("first_name") or "", (master or {}).get("last_name") or ""]).strip() or ((master or {}).get("email") or "il tuo consulente")
    style = (body.style or "friendly")
    if style not in ("friendly", "professional", "short"):
        style = "friendly"
    reply_text = await _generate_axon_lead_reply(lead, master_name, style=style)
    await db.public_leads.update_one(
        {"lead_id": lead_id},
        {"$set": {"axon_reply_text": reply_text, "axon_generated_at": utcnow(), "status": "analyzed"}},
    )
    return {"ok": True, "axon_reply_text": reply_text}


class LeadAxonEditIn(BaseModel):
    axon_reply_text: str


@api_router.patch("/leads/{lead_id}/axon-reply")
async def edit_lead_axon_reply(lead_id: str, body: LeadAxonEditIn, user=Depends(get_current_user)):
    """Master modifica manualmente la bozza AxonOS prima di approvarla."""
    tid = tenant_id(user)
    r = await db.public_leads.update_one(
        {"user_id": tid, "lead_id": lead_id},
        {"$set": {"axon_reply_text": (body.axon_reply_text or "").strip(), "status": "analyzed"}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead non trovato")
    return {"ok": True}


@api_router.patch("/leads/{lead_id}/approve")
async def approve_lead_reply(lead_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.public_leads.update_one(
        {"user_id": tid, "lead_id": lead_id},
        {"$set": {"status": "approved", "approved_at": utcnow(), "approved_by": user["user_id"]}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead non trovato")
    return {"ok": True}


@api_router.post("/leads/{lead_id}/reply")
async def send_lead_reply(lead_id: str, body: LeadReplyIn, user=Depends(get_current_user)):
    """Invia la risposta al lead. Per email → SMTP auto. Per WA/SMS/Telegram → il
    frontend gestirà il deep-link, ma qui registriamo l'invio ai fini della history."""
    tid = tenant_id(user)
    lead = await db.public_leads.find_one({"user_id": tid, "lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead non trovato")
    text = (body.text or "").strip() or lead.get("axon_reply_text") or ""
    if not text:
        raise HTTPException(status_code=400, detail="Nessun testo da inviare")

    sent_via_backend = False
    if body.channel == "email":
        to_email = (lead.get("email") or "").strip()
        if not to_email:
            raise HTTPException(status_code=400, detail="Lead senza email")
        cfg = await db.smtp_configs.find_one({"user_id": tid}, {"_id": 0})
        if cfg and cfg.get("host"):
            try:
                master = await db.users.find_one({"user_id": tid}, {"_id": 0, "first_name": 1, "last_name": 1})
                master_name = " ".join([(master or {}).get("first_name") or "", (master or {}).get("last_name") or ""]).strip() or "AdvisorOS"
                subject = f"Risposta alla tua richiesta — {master_name}"
                body_html = f"""<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px"><p style="font-size:15px;line-height:1.6;white-space:pre-wrap">{text}</p></body></html>"""
                await asyncio.to_thread(_send_smtp_email, cfg, to_email, subject, text, body_html)
                sent_via_backend = True
            except Exception as exc:
                logger.warning(f"[lead-reply-email] {lead_id} failed: {exc}")

    await db.public_leads.update_one(
        {"lead_id": lead_id},
        {"$set": {
            "status": "replied",
            "master_reply_text": text,
            "master_reply_channel": body.channel,
            "master_replied_at": utcnow(),
            "master_reply_sent_via_backend": sent_via_backend,
        }},
    )
    return {"ok": True, "sent_via_backend": sent_via_backend, "channel": body.channel}


@api_router.patch("/leads/{lead_id}/status")
async def set_lead_status(lead_id: str, body: LeadStatusIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.public_leads.update_one(
        {"user_id": tid, "lead_id": lead_id},
        {"$set": {"status": body.status}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead non trovato")
    return {"ok": True}


@api_router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    r = await db.public_leads.delete_one({"user_id": tid, "lead_id": lead_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lead non trovato")
    return {"ok": True}


# =====================================================================


# =========================================================================
# V50.z314 — RICHIESTA DEMO dalla landing pubblica → lead per il proprietario della piattaforma
# (env DEMO_LEAD_OWNER_EMAIL, altrimenti il Master più anziano) + avviso in Home (bubble proattiva),
# in chat Axon e push. Il lead compare in «Richieste Info (Lead)» con source="landing_demo".
# =========================================================================
class DemoRequestIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    company: str = Field(min_length=1, max_length=160)
    phone: str = Field(min_length=6, max_length=40)
    email: Optional[EmailStr] = None
    consent_privacy: bool = True
    website: str = ""  # honeypot anti-spam: deve restare vuoto


async def _demo_lead_owner() -> Optional[dict]:
    email = (os.environ.get("DEMO_LEAD_OWNER_EMAIL") or "").strip().lower()
    proj = {"_id": 0, "password_hash": 0, "sensitive_password_enc": 0}
    if email:
        u = await db.users.find_one({"email": email}, proj)
        if u:
            return u
    return await db.users.find_one({"role": "owner", "parent_user_id": None}, proj, sort=[("created_at", 1)])


@api_router.post("/public/demo-request")
async def public_demo_request(body: DemoRequestIn):
    if body.website.strip():
        return {"ok": True}  # bot: fingiamo successo senza salvare
    if not body.consent_privacy:
        raise HTTPException(status_code=400, detail="Devi accettare l'informativa privacy")
    owner = await _demo_lead_owner()
    if not owner:
        raise HTTPException(status_code=503, detail="Servizio non disponibile")
    tid = owner["user_id"]
    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    company = body.company.strip()
    doc = {
        "lead_id": lead_id, "user_id": tid, "source": "landing_demo",
        "full_name": body.full_name.strip(), "company": company,
        "email": (body.email or "").strip().lower() or None, "phone": body.phone.strip(),
        "needs": [], "free_text": f"Richiesta DEMO dalla landing pubblica · Azienda: {company}",
        "consent_privacy": True, "created_at": utcnow(), "status": "new",
        "axon_reply_text": None, "axon_generated_at": None,
        "master_reply_text": None, "master_reply_channel": None, "master_replied_at": None,
    }
    await db.public_leads.insert_one(doc)
    try:
        master_name = " ".join([owner.get("first_name") or "", owner.get("last_name") or ""]).strip() or owner.get("name") or owner.get("email") or "il tuo consulente"
        reply_text = await _generate_axon_lead_reply(doc, master_name, style="friendly")
        await db.public_leads.update_one({"lead_id": lead_id}, {"$set": {"axon_reply_text": reply_text, "axon_generated_at": utcnow(), "status": "analyzed"}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[demo-request] axon reply failed for %s: %s", lead_id, exc)
    try:
        contact_line = doc["phone"] + (f" · {doc['email']}" if doc.get("email") else "")
        await _apx_emit(owner, "alert", "lead_demo",
                        f"🆕 Richiesta demo: {doc['full_name']} ({company})",
                        f"{doc['full_name']} · {company} · Tel. {contact_line}. Chiede una demo di AdvisorOS dalla landing.",
                        f"🆕 **Nuova richiesta demo dalla landing**\n\n• Nome: {doc['full_name']}\n• Azienda: {company}\n• Telefono: {doc['phone']}"
                        + (f"\n• Email: {doc['email']}" if doc.get("email") else "") + "\n\nLa trovi in Richieste Info (Lead). Vuoi che prepari il messaggio di risposta?",
                        dedupe_key=f"lead_demo:{lead_id}",
                        actions=[{"label": "Apri il lead", "route": "/leads"}, {"label": "Prepara la risposta", "prompt": f"Prepara un messaggio WhatsApp breve per {doc['full_name']} di {company} che ha chiesto una demo di AdvisorOS: proponi due orari."}],
                        source="landing", extra={"lead_id": lead_id}, push=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[demo-request] notify failed: %s", exc)
    # V50.z336 — email: conferma al lead (info@) + notifica interna al Master (emanuele@)
    _hook = globals().get("_email_on_demo_request")
    if _hook:
        try:
            await _hook(doc, owner)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[demo-request] email hook failed: %s", exc)
    return {"ok": True, "lead_id": lead_id}
