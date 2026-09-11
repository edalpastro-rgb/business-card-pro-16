# 36_admin_clients.py — Gestione clienti (super-admin)
# Estratto da server.py (righe originali 25316-25763). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V50.z104 — PROMPT 27: Gestione Clienti AdvisorOS
# =====================================================================
# Un livello di "admin" globale sopra i Master. Il super-admin gestisce
# tutti gli utenti (tier assignment, broadcast, monitoraggio uso).
# Il Master locale mantiene solo la vista dei suoi collaboratori (già in team-insights).

ADVISOR_TIERS = [
    ("paying_business", "Clienti Paganti Business", "#2D7A5A"),
    ("paying_private", "Clienti Paganti Privati", "#22C55E"),
    ("test", "Clienti Test", "#94A3B8"),
    ("axonos_business", "Clienti AxonOS Business", "#8B5CF6"),
    ("axonos_private", "Clienti AxonOS Privati", "#A78BFA"),
]
_ADVISOR_TIER_IDS = {t[0] for t in ADVISOR_TIERS}

# Feature keys tracciate + soglie giorni per il suggerimento "non usato"
ADVISOR_FEATURES: List[dict] = [
    {"key": "contacts", "label": "Contatti CRM", "days_threshold": 14, "video_url": "https://www.youtube.com/results?search_query=advisoros+crm+contatti"},
    {"key": "bills", "label": "Analisi Bollette", "days_threshold": 21, "video_url": "https://www.youtube.com/results?search_query=advisoros+analisi+bollette"},
    {"key": "appointments", "label": "Appuntamenti", "days_threshold": 14, "video_url": "https://www.youtube.com/results?search_query=advisoros+appuntamenti"},
    {"key": "reviews", "label": "Recensioni Cliente", "days_threshold": 30, "video_url": "https://www.youtube.com/results?search_query=advisoros+recensioni"},
    {"key": "leads", "label": "Richieste Info (Lead)", "days_threshold": 30, "video_url": "https://www.youtube.com/results?search_query=advisoros+lead"},
    {"key": "axon_chat", "label": "AxonOS Chat", "days_threshold": 7, "video_url": "https://www.youtube.com/results?search_query=advisoros+axon+chat"},
    {"key": "collaborators", "label": "Collaboratori & Team", "days_threshold": 30, "video_url": "https://www.youtube.com/results?search_query=advisoros+team"},
]


def _super_admin_emails_env() -> set:
    raw = os.environ.get("ADVISOR_SUPER_ADMIN_EMAILS", "").strip()
    if not raw:
        return set()
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_super_admin(user: dict) -> bool:
    if not user:
        return False
    if user.get("super_admin") is True:
        return True
    email = (user.get("email") or "").lower()
    return email in _super_admin_emails_env()


async def require_super_admin(user=Depends(get_current_user)) -> dict:
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="Solo super-admin")
    return user


class AdminTierPatchIn(BaseModel):
    tier: Literal["paying_business", "paying_private", "test", "axonos_business", "axonos_private"]


class AdminBroadcastIn(BaseModel):
    target_tier: str  # id tier oppure "all"
    channels: List[Literal["in_app", "email", "whatsapp"]]
    subject: str = Field(min_length=1, max_length=140)
    body: str = Field(min_length=1, max_length=4000)
    video_url: Optional[str] = None


class AdminTipDismissIn(BaseModel):
    dismissed: bool = True


async def _compute_user_usage(user_id: str) -> Dict[str, Any]:
    """Aggrega uso feature dalle collezioni esistenti (best-effort, ignora errori)."""
    async def safe_count(coll_name: str, q: dict) -> int:
        try:
            return await db[coll_name].count_documents(q)
        except Exception:
            return 0

    async def safe_last(coll_name: str, q: dict, date_field: str) -> Optional[datetime]:
        try:
            d = await db[coll_name].find_one(q, sort=[(date_field, -1)])
            v = (d or {}).get(date_field)
            return v if isinstance(v, datetime) else None
        except Exception:
            return None

    counts: Dict[str, int] = {}
    last_at: Dict[str, Optional[str]] = {}
    # Contatti
    counts["contacts"] = await safe_count("contacts", {"user_id": user_id})
    lc = await safe_last("contacts", {"user_id": user_id}, "created_at")
    last_at["contacts"] = lc.isoformat() if lc else None
    # Bollette
    counts["bills"] = await safe_count("bills", {"user_id": user_id})
    lb = await safe_last("bills", {"user_id": user_id}, "created_at")
    last_at["bills"] = lb.isoformat() if lb else None
    # Appuntamenti
    counts["appointments"] = await safe_count("appointments", {"user_id": user_id})
    la = await safe_last("appointments", {"user_id": user_id}, "created_at")
    last_at["appointments"] = la.isoformat() if la else None
    # Recensioni (contact + review_requests)
    counts["reviews"] = await safe_count("review_requests", {"user_id": user_id})
    lr = await safe_last("review_requests", {"user_id": user_id}, "created_at")
    last_at["reviews"] = lr.isoformat() if lr else None
    # Lead
    counts["leads"] = await safe_count("public_leads", {"user_id": user_id})
    ll = await safe_last("public_leads", {"user_id": user_id}, "created_at")
    last_at["leads"] = ll.isoformat() if ll else None
    # AxonOS chat — probabile collection
    axon_col = None
    for cn in ("assistant_messages", "axon_messages", "chat_messages"):
        if await safe_count(cn, {"user_id": user_id}) > 0:
            axon_col = cn; break
    counts["axon_chat"] = await safe_count(axon_col, {"user_id": user_id}) if axon_col else 0
    if axon_col:
        lm = await safe_last(axon_col, {"user_id": user_id}, "created_at")
        last_at["axon_chat"] = lm.isoformat() if lm else None
    else:
        last_at["axon_chat"] = None
    # Collaboratori
    counts["collaborators"] = await safe_count("users", {"parent_user_id": user_id, "role": "collaborator"})
    last_at["collaborators"] = None  # non tracciamo per ora

    return {"counts": counts, "last_used_at": last_at}


@api_router.get("/admin/tiers-meta")
async def admin_tiers_meta(user=Depends(require_super_admin)):
    return {
        "tiers": [{"id": t[0], "label": t[1], "color": t[2]} for t in ADVISOR_TIERS],
        "features": ADVISOR_FEATURES,
    }


@api_router.get("/admin/customers")
async def list_admin_customers(tier: str = "all", user=Depends(require_super_admin)):
    q: Dict[str, Any] = {}
    if tier and tier != "all":
        if tier not in _ADVISOR_TIER_IDS:
            raise HTTPException(status_code=400, detail="Tier non valido")
        q["advisor_tier"] = tier
    docs = await db.users.find(
        q,
        {"_id": 0, "user_id": 1, "email": 1, "first_name": 1, "last_name": 1,
         "role": 1, "advisor_tier": 1, "created_at": 1, "last_login": 1, "parent_user_id": 1}
    ).sort("last_login", -1).to_list(2000)
    # Assign default tier "test" if missing
    for d in docs:
        d.setdefault("advisor_tier", "test")
    return {"items": docs}


@api_router.get("/admin/customers/counts")
async def admin_customers_counts(user=Depends(require_super_admin)):
    counts: Dict[str, int] = {}
    total = 0
    for t in ADVISOR_TIERS:
        tid = t[0]
        c = await db.users.count_documents({"advisor_tier": tid})
        counts[tid] = c
        total += c
    # Utenti senza tier assegnato → conta come test
    no_tier = await db.users.count_documents({"advisor_tier": {"$exists": False}})
    counts["test"] = counts.get("test", 0) + no_tier
    return {"counts": counts, "total": total + no_tier}


@api_router.get("/admin/customers/{cust_id}")
async def get_admin_customer(cust_id: str, user=Depends(require_super_admin)):
    doc = await db.users.find_one(
        {"user_id": cust_id},
        {"_id": 0, "password": 0, "password_hash": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    doc.setdefault("advisor_tier", "test")
    usage = await _compute_user_usage(cust_id)
    doc["usage"] = usage
    return doc


@api_router.patch("/admin/customers/{cust_id}/tier")
async def patch_admin_customer_tier(cust_id: str, body: AdminTierPatchIn, user=Depends(require_super_admin)):
    r = await db.users.update_one(
        {"user_id": cust_id},
        {"$set": {"advisor_tier": body.tier}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    return {"ok": True, "tier": body.tier}


@api_router.post("/admin/customers/{cust_id}/tier-suggest")
async def admin_customer_tier_suggest(cust_id: str, user=Depends(require_super_admin)):
    """AI suggerisce il tier basato su usage + storico. Best-effort, se fallisce
    ritorna una regola euristica."""
    doc = await db.users.find_one({"user_id": cust_id}, {"_id": 0, "email": 1, "role": 1, "created_at": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    usage = await _compute_user_usage(cust_id)
    counts = usage.get("counts", {})
    total = sum(counts.values())
    # Euristica: >100 uso → paying_business; 20-100 → paying_private; <20 → test
    if total > 100:
        heur = "paying_business"
    elif total > 20:
        heur = "paying_private"
    else:
        heur = "test"

    ai_reason = None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        key = os.environ.get("EMERGENT_LLM_KEY")
        if key:
            chat = LlmChat(
                api_key=key,
                session_id=f"tier-suggest-{cust_id}",
                system_message=(
                    "Sei un analista di customer success. Ricevi il livello di uso di una piattaforma CRM "
                    "e devi suggerire una delle 5 categorie: paying_business, paying_private, test, "
                    "axonos_business, axonos_private. Rispondi SOLO con un JSON: "
                    '{"tier":"<id>","reason":"<1 frase>"}.'
                ),
            ).with_model("anthropic", "claude-sonnet-4-5-20250929")
            um = UserMessage(text=(
                f"USER_EMAIL: {doc.get('email')}\nROLE: {doc.get('role')}\n"
                f"USAGE: {json.dumps(counts)}\nTOTAL_ACTIONS: {total}\n"
                f"Suggerisci il tier corretto."
            ))
            r = await chat.send_message(um)
            import re as _re
            m = _re.search(r'\{[^}]+\}', str(r))
            if m:
                parsed = json.loads(m.group(0))
                if parsed.get("tier") in _ADVISOR_TIER_IDS:
                    return {"suggested": parsed["tier"], "reason": parsed.get("reason") or "AI suggerisce basandosi sull'utilizzo", "source": "ai"}
                ai_reason = parsed.get("reason")
    except Exception as exc:
        logger.debug(f"[tier-suggest] AI failed: {exc}")

    return {"suggested": heur, "reason": ai_reason or f"Basato su {total} azioni totali", "source": "heuristic"}


# --- Auto-tips ---
async def _generate_axon_tip(user_email: str, feature_label: str, video_url: str) -> str:
    """Genera testo consiglio via Claude. Fallback statico."""
    fallback = (
        f"Ciao, vedo che non utilizzi mai l'area {feature_label}. "
        f"Potrebbe aiutarti a risparmiare tempo e organizzare meglio il lavoro. "
        f"Guarda come funziona: {video_url}"
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        key = os.environ.get("EMERGENT_LLM_KEY")
        if not key:
            return fallback
        chat = LlmChat(
            api_key=key,
            session_id=f"tip-{uuid.uuid4().hex[:6]}",
            system_message=(
                "Sei AxonOS. Scrivi un consiglio breve (max 4 righe) in italiano nel formato: "
                "'CONSIGLI UTILIZZO - Ciao, vedo che non utilizzi mai l\\'area [X]. Potrebbe aiutarti a "
                "ottenere [beneficio] perché [1 frase spiegazione]. Guarda come funziona: [link video]'. "
                "Tono amichevole, mai commerciale invasivo."
            ),
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
        um = UserMessage(text=f"FEATURE: {feature_label}\nLINK: {video_url}\nGENERA il consiglio.")
        r = await chat.send_message(um)
        text = (str(r) or "").strip()
        return text[:600] if text else fallback
    except Exception:
        return fallback


async def _run_advisor_tips_job() -> None:
    """Ogni 12h: per ogni user attivo (last_login negli ultimi 60 giorni),
    controlla feature non usate e crea admin_tips (idempotente per (user, feature))."""
    try:
        cutoff_active = utcnow() - timedelta(days=60)
        users = await db.users.find(
            {"$or": [{"last_login": {"$gte": cutoff_active}}, {"created_at": {"$gte": cutoff_active}}]},
            {"_id": 0, "user_id": 1, "email": 1, "created_at": 1}
        ).to_list(500)
        for u in users:
            uid = u.get("user_id")
            if not uid:
                continue
            try:
                usage = await _compute_user_usage(uid)
                counts = usage.get("counts", {})
                for feat in ADVISOR_FEATURES:
                    k = feat["key"]
                    if counts.get(k, 0) > 0:
                        continue  # Feature usata → nessun tip
                    # Non ripetere se un tip esiste già non-dismissed
                    existing = await db.admin_tips.find_one({
                        "user_id": uid, "feature": k, "dismissed": {"$ne": True}
                    }, {"_id": 0, "tip_id": 1})
                    if existing:
                        continue
                    text = await _generate_axon_tip(u.get("email", ""), feat["label"], feat["video_url"])
                    await db.admin_tips.insert_one({
                        "tip_id": f"tip_{uuid.uuid4().hex[:12]}",
                        "user_id": uid,
                        "feature": k,
                        "feature_label": feat["label"],
                        "video_url": feat["video_url"],
                        "message": text,
                        "kind": "auto",
                        "created_at": utcnow(),
                        "dismissed": False,
                        "read": False,
                    })
            except Exception as exc:
                logger.debug(f"[advisor-tips] user {uid} failed: {exc}")
    except Exception as exc:
        logger.warning(f"[advisor-tips-job] failed: {exc}")


# --- Tips per utente finale (mostrato in home) ---
@api_router.get("/tips/home")
async def get_home_tips(user=Depends(get_current_user)):
    """Ritorna i tips non-dismissed per l'utente corrente da mostrare in home."""
    docs = await db.admin_tips.find(
        {"user_id": user["user_id"], "dismissed": {"$ne": True}},
        {"_id": 0}
    ).sort("created_at", -1).limit(5).to_list(5)
    return {"items": docs}


@api_router.post("/tips/{tip_id}/dismiss")
async def dismiss_tip(tip_id: str, body: AdminTipDismissIn, user=Depends(get_current_user)):
    r = await db.admin_tips.update_one(
        {"tip_id": tip_id, "user_id": user["user_id"]},
        {"$set": {"dismissed": bool(body.dismissed), "read": True}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tip non trovato")
    return {"ok": True}


# --- Broadcasts ---
@api_router.post("/admin/broadcasts")
async def create_admin_broadcast(body: AdminBroadcastIn, user=Depends(require_super_admin)):
    """Crea broadcast e distribuisce ai target. Per email: SMTP sistema. Per WA:
    ritorna lista utenti target con URL wa.me pre-composti."""
    from urllib.parse import quote
    target_tier = body.target_tier or "all"
    q: Dict[str, Any] = {}
    if target_tier != "all":
        if target_tier not in _ADVISOR_TIER_IDS:
            raise HTTPException(status_code=400, detail="Tier non valido")
        q["advisor_tier"] = target_tier
    users = await db.users.find(q, {"_id": 0, "user_id": 1, "email": 1, "phone": 1, "first_name": 1, "last_name": 1}).to_list(5000)

    broadcast_id = f"bc_{uuid.uuid4().hex[:12]}"
    channels = list(dict.fromkeys(body.channels or []))
    if not channels:
        channels = ["in_app"]

    delivered = {"in_app": 0, "email": 0, "whatsapp_ready": 0}
    wa_targets: List[Dict[str, str]] = []

    # System SMTP config (usa quella del super-admin)
    sys_smtp = None
    if "email" in channels:
        sys_smtp = await db.smtp_configs.find_one({"user_id": user["user_id"]}, {"_id": 0})

    for u in users:
        uid = u.get("user_id")
        if not uid:
            continue
        if "in_app" in channels:
            try:
                await db.admin_tips.insert_one({
                    "tip_id": f"tip_{uuid.uuid4().hex[:12]}",
                    "user_id": uid,
                    "feature": "broadcast",
                    "feature_label": body.subject,
                    "video_url": body.video_url or "",
                    "message": body.body,
                    "kind": "broadcast",
                    "broadcast_id": broadcast_id,
                    "created_at": utcnow(),
                    "dismissed": False,
                    "read": False,
                })
                delivered["in_app"] += 1
            except Exception:
                pass
        if "email" in channels and u.get("email") and sys_smtp and sys_smtp.get("host"):
            try:
                video_block = ""
                if body.video_url:
                    video_block = f'<p><a href="{body.video_url}">Vedi il video</a></p>'
                html = (
                    '<html><body style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">'
                    f'<h2 style="color:#111">{body.subject}</h2>'
                    f'<p style="white-space:pre-wrap;line-height:1.5">{body.body}</p>'
                    f'{video_block}'
                    '</body></html>'
                )
                await asyncio.to_thread(_send_smtp_email, sys_smtp, u["email"], body.subject, body.body, html)
                delivered["email"] += 1
            except Exception as exc:
                logger.debug(f"[broadcast-email] {uid} failed: {exc}")
        if "whatsapp" in channels and u.get("phone"):
            phone = "".join(c for c in u.get("phone", "") if c.isdigit())
            if phone:
                text = body.body + (f"\n\n📺 {body.video_url}" if body.video_url else "")
                wa_targets.append({
                    "user_id": uid,
                    "name": " ".join([u.get("first_name") or "", u.get("last_name") or ""]).strip() or u.get("email", ""),
                    "phone": phone,
                    "wa_url": f"https://wa.me/{phone}?text={quote(text)}",
                })
        if "whatsapp" in channels:
            delivered["whatsapp_ready"] = len(wa_targets)

    await db.admin_broadcasts.insert_one({
        "broadcast_id": broadcast_id,
        "sent_by": user["user_id"],
        "target_tier": target_tier,
        "channels": channels,
        "subject": body.subject,
        "body": body.body,
        "video_url": body.video_url,
        "created_at": utcnow(),
        "targets_count": len(users),
        "delivered": delivered,
    })
    return {
        "ok": True,
        "broadcast_id": broadcast_id,
        "targets_count": len(users),
        "delivered": delivered,
        "wa_targets": wa_targets,
    }


@api_router.get("/admin/broadcasts")
async def list_admin_broadcasts(user=Depends(require_super_admin)):
    docs = await db.admin_broadcasts.find({"sent_by": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"items": docs}


@api_router.get("/admin/me")
async def admin_me(user=Depends(get_current_user)):
    """Endpoint leggero per il frontend: dice se l'utente è super_admin."""
    return {"super_admin": is_super_admin(user), "email": user.get("email")}

