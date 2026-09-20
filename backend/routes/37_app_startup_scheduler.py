# 37_app_startup_scheduler.py — include_router, CORS, startup/shutdown, scheduler APScheduler
# Estratto da server.py (righe originali 25764-26213). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.contacts.create_index([("user_id", 1), ("contact_id", 1)])
    await db.appointments.create_index([("user_id", 1), ("start_at", 1)])
    await db.callbacks.create_index([("user_id", 1), ("scheduled_at", 1)])
    await db.users.create_index("parent_user_id")
    await db.invites.create_index("invite_token", unique=True)
    await db.invites.create_index("created_by")
    await db.groups.create_index([("user_id", 1), ("group_id", 1)], unique=True)
    await db.smtp_configs.create_index("user_id", unique=True)
    await db.chat_channels.create_index([("user_id", 1), ("member_user_ids", 1)])
    await db.chat_channels.create_index("channel_id", unique=True)
    await db.chat_messages.create_index([("channel_id", 1), ("created_at", 1)])
    await db.my_thing.create_index([("owner_user_id", 1), ("kind", 1), ("active", 1)])
    await db.contacts.create_index([("user_id", 1), ("contact_code", 1)])
    await db.contacts.create_index([("user_id", 1), ("referred_by_contact_id", 1)])
    await db.contacts.create_index([("user_id", 1), ("assigned_to_user_id", 1)])
    await db.energy_bills.create_index([("user_id", 1), ("contact_id", 1)])
    await db.energy_bills.create_index("bill_id", unique=True)
    await db.company_offers.create_index([("user_id", 1), ("bill_type", 1)])
    await db.company_offers.create_index("offer_id", unique=True)
    await db.contracts.create_index([("user_id", 1), ("created_at", -1)])
    await db.contracts.create_index("contract_id", unique=True)
    await db.web_links.create_index([("user_id", 1), ("order", 1)])
    await db.web_links.create_index("link_id", unique=True)
    await db.user_settings.create_index("user_id", unique=True)
    await db.audio_records.create_index([("user_id", 1), ("target_type", 1), ("target_id", 1)])
    await db.audio_records.create_index("audio_id", unique=True)
    await db.assistant_messages.create_index([("user_id", 1), ("session_id", 1), ("created_at", 1)])
    # V50.z51 — Memoria tenant distillata (una entry per tenant_id).
    try:
        await db.axon_tenant_memory.create_index("tenant_id", unique=True)
    except Exception:
        pass
    # V50.z53 — Cache GME PUN per mese (persistente, senza scadenza).
    try:
        await db.gme_pun_cache.create_index("month_key", unique=True)
    except Exception:
        pass
    # V50.z58 — Company Web Links (tenant-scoped)
    try:
        await db.company_web_links.create_index([("owner_user_id", 1), ("order", 1)])
        await db.company_web_links.create_index([("owner_user_id", 1), ("link_id", 1)], unique=True)
    except Exception:
        pass
    # V29.ag — Cache azioni rapide Axon (una entry per (user, label))
    await db.axon_qa_cache.create_index([("user_id", 1), ("label", 1)], unique=True)
    # V50.z101 — Review requests + reviews (PROMPT 24 sondaggio qualità post-conversione)
    try:
        await db.review_requests.create_index("req_id", unique=True)
        await db.review_requests.create_index([("user_id", 1), ("contact_id", 1)])
        await db.review_requests.create_index([("status", 1), ("scheduled_at", 1)])
        await db.reviews.create_index("review_id", unique=True)
        await db.reviews.create_index([("user_id", 1), ("contact_id", 1)])
        await db.reviews.create_index([("user_id", 1), ("approved", 1), ("submitted_at", -1)])
    except Exception:
        pass
    # V50.z103 — Public leads (PROMPT 25: modulo lead con AxonOS)
    try:
        await db.public_leads.create_index("lead_id", unique=True)
        await db.public_leads.create_index([("user_id", 1), ("status", 1), ("created_at", -1)])
    except Exception:
        pass
    # V50.z104 — Admin AdvisorOS (PROMPT 27)
    try:
        await db.admin_tips.create_index("tip_id", unique=True)
        await db.admin_tips.create_index([("user_id", 1), ("dismissed", 1), ("created_at", -1)])
        await db.admin_broadcasts.create_index("broadcast_id", unique=True)
        await db.admin_broadcasts.create_index([("sent_by", 1), ("created_at", -1)])
    except Exception:
        pass
    # V40 — Semantic cache for Axon assistant (global). Note: we intentionally
    # do NOT use a MongoDB TTL index to hard-delete records at startup — the
    # `_semantic_cache_lookup` function already filters `expires_at > now` at
    # query time, so expired entries are simply ignored. A separate manual
    # cleanup can be triggered if the collection ever grows too large.
    # If a legacy TTL index exists (from v40 pre-45c), drop it silently before
    # recreating the plain index.
    try:
        _existing = await db.axon_semantic_cache.index_information()
        for _name, _info in _existing.items():
            _keys = _info.get("key") or []
            if _keys and _keys[0][0] == "expires_at" and "expireAfterSeconds" in _info:
                await db.axon_semantic_cache.drop_index(_name)
                logger.info("[startup] dropped legacy TTL index %s on axon_semantic_cache", _name)
    except Exception as _exc:
        logger.warning("[startup] TTL-index cleanup failed: %s", _exc)
    await db.axon_semantic_cache.create_index("expires_at")
    await db.axon_semantic_cache.create_index([("created_at", -1)])
    await db.axon_semantic_cache.create_index("tokens")  # multikey index for token pre-filter
    # V41 — Feedback 👍/👎 sulle risposte dell'assistente
    await db.assistant_feedback.create_index([("user_id", 1), ("message_id", 1)], unique=True)
    await db.assistant_feedback.create_index([("user_id", 1), ("updated_at", -1)])
    await db.assistant_feedback.create_index([("rating", 1), ("updated_at", -1)])
    # Non-unique index on message_id in assistant_messages (per V41 message-level lookup)
    await db.assistant_messages.create_index("message_id")
    # V42 — RAG Documenti Master
    await db.master_documents.create_index([("tenant_id", 1), ("created_at", -1)])
    await db.master_documents.create_index("doc_id", unique=True)
    await db.master_doc_chunks.create_index([("tenant_id", 1), ("tokens", 1)])
    await db.master_doc_chunks.create_index("doc_id")
    await db.master_doc_chunks.create_index("chunk_id", unique=True)
    # V43 — Rule proposals (auto-extracted from chat)
    await db.axon_rule_proposals.create_index([("tenant_id", 1), ("status", 1), ("created_at", -1)])
    await db.axon_rule_proposals.create_index("proposal_id", unique=True)
    # V44 — Team member behavioural profiles (cached 24h)
    await db.team_member_profiles.create_index([("tenant_id", 1), ("user_id", 1)], unique=True)
    # V24 migration: back-fill assigned_to_user_id from created_by for legacy contacts
    try:
        result = await db.contacts.update_many(
            {"assigned_to_user_id": {"$exists": False}, "created_by": {"$exists": True}},
            [{"$set": {"assigned_to_user_id": "$created_by"}}],
        )
        if result.modified_count:
            logger.info(f"V24 migration: assigned {result.modified_count} legacy contacts to their creator")
    except Exception as e:
        logger.warning(f"V24 legacy contact assignment migration skipped: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        _birthday_scheduler.shutdown(wait=False)
    except Exception:
        pass
    client.close()


# =========================
# V38I — Birthday cron scheduler (APScheduler)
# =========================
from apscheduler.schedulers.asyncio import AsyncIOScheduler  # noqa: E402

_birthday_scheduler = AsyncIOScheduler(timezone="Europe/Rome")


async def _run_birthday_job():
    """Daily job: for each contact whose birthday_auto_send=True and today matches
    birth_date (MM-DD), generate a fresh AI message (or reuse this year's) and send
    via SMTP. Uses birthday_sender_email as From, birthday_recipient_email as To."""
    logger.info("Running daily birthday scheduler…")
    today = datetime.now(timezone.utc).date()
    year = today.year
    # Iterate users
    async for user_doc in db.users.find({}, {"user_id": 1, "email": 1, "additional_emails": 1, "company_name": 1}):
        tid = user_doc["user_id"]
        smtp_cfg = await db.smtp_configs.find_one({"user_id": tid}, {"_id": 0})
        if not smtp_cfg or not smtp_cfg.get("host"):
            continue
        contacts = await db.contacts.find(
            {"user_id": tid, "birthday_auto_send": True, "birth_date": {"$exists": True, "$ne": ""}},
            {"contact_id": 1, "first_name": 1, "last_name": 1, "birth_date": 1,
             "birthday_recipient_email": 1, "birthday_sender_email": 1,
             "email": 1, "email_alt": 1, "is_active_client": 1},
        ).to_list(2000)
        for c in contacts:
            bd = str(c.get("birth_date") or "").strip()
            if not bd:
                continue
            # Support DD/MM/YYYY, DD-MM-YYYY, ISO YYYY-MM-DD
            try:
                if "/" in bd:
                    parts = bd.split("/")
                    day, month = int(parts[0]), int(parts[1])
                elif "-" in bd and len(bd) >= 8:
                    p = bd.split("-")
                    if len(p[0]) == 4:  # ISO
                        day, month = int(p[2]), int(p[1])
                    else:
                        day, month = int(p[0]), int(p[1])
                else:
                    continue
            except Exception:
                continue
            if day != today.day or month != today.month:
                continue
            # Skip if already sent this year
            already = await db.birthday_messages.find_one({
                "user_id": tid, "contact_id": c["contact_id"], "year": year, "sent": True,
            })
            if already:
                continue
            # Fetch or generate the message
            existing = await db.birthday_messages.find_one({
                "user_id": tid, "contact_id": c["contact_id"], "year": year,
            }, sort=[("created_at", -1)])
            message = existing.get("message") if existing else None
            if not message:
                try:
                    from emergentintegrations.llm.chat import LlmChat, UserMessage as _UM
                    key = os.environ.get("EMERGENT_LLM_KEY", "")
                    if not key:
                        continue
                    is_active = bool(c.get("is_active_client"))
                    first_name = c.get("first_name") or "Cliente"
                    system = (
                        "Sei un consulente energetico italiano che scrive messaggi di auguri "
                        "di compleanno personalizzati. Caldo, sincero, personale, 3-6 frasi, ~500 chars, "
                        "firmato 'Il tuo Consulente'."
                    )
                    prompt = (
                        f"Genera il messaggio di auguri di compleanno {year} per {first_name}."
                        + (" Cliente attivo: ringrazialo per la fiducia e invitalo a contattarti." if is_active else "")
                    )
                    chat = LlmChat(api_key=key, session_id=f"bday-cron-{c['contact_id']}-{year}",
                                   system_message=system).with_model("anthropic", "claude-sonnet-5")
                    resp = await chat.send_message(_UM(text=prompt))
                    message = (resp or "").strip().strip('"').strip("'")
                    if message:
                        await db.birthday_messages.insert_one({
                            "user_id": tid, "contact_id": c["contact_id"], "year": year,
                            "message": message, "is_active_client": is_active, "created_at": utcnow(),
                        })
                except Exception as e:
                    logger.warning(f"birthday gen failed for {c.get('contact_id')}: {e}")
                    continue
            # Pick recipient / sender
            to_email = c.get("birthday_recipient_email") or c.get("email") or c.get("email_alt")
            if not to_email:
                continue
            sender_override = c.get("birthday_sender_email")
            cfg_copy = dict(smtp_cfg)
            if sender_override:
                cfg_copy["sender_email"] = sender_override
            subject = f"Buon compleanno, {c.get('first_name') or ''}!"
            try:
                await asyncio.to_thread(_send_smtp_email, cfg_copy, to_email, subject, message, None)
                await db.birthday_messages.update_one(
                    {"user_id": tid, "contact_id": c["contact_id"], "year": year},
                    {"$set": {"sent": True, "sent_at": utcnow(), "sent_to": to_email}},
                    upsert=True,
                )
                logger.info(f"birthday sent to {to_email} for contact {c['contact_id']}")
            except Exception as e:
                logger.warning(f"birthday send failed for {to_email}: {e}")






@app.on_event("startup")
async def _start_scheduler():
    # Run daily at 09:00 Europe/Rome
    try:
        _birthday_scheduler.add_job(_run_birthday_job, "cron", hour=9, minute=0, id="birthday-job", replace_existing=True)
        # V43 — Nightly rule proposal extractor (03:00 Europe/Rome)
        _birthday_scheduler.add_job(
            _run_rule_proposals_job, "cron", hour=3, minute=0,
            id="rule-proposals-job", replace_existing=True,
        )
        # V50.z3 — Pre-fetch periodico degli URL insegnati (ogni 30 min)
        # Aggiorna snapshot HTML + PDF nei tempi indicati dalla frequency.
        # Così Axon risponde ISTANTANEAMENTE senza scaricare live.
        _birthday_scheduler.add_job(
            _run_teach_urls_prefetch_job, "interval", minutes=30,
            id="teach-urls-prefetch", replace_existing=True,
        )
        # V50.z24 — Auto-CRM scan tick (ogni minuto: valuta chi è in scadenza)
        _birthday_scheduler.add_job(
            _run_auto_crm_tick, "interval", minutes=1,
            id="auto-crm-tick", replace_existing=True,
        )
        # V50.z51 — Distillazione notturna memoria tenant (04:00 Europe/Rome).
        # Comprime le chat degli ultimi 90 giorni in un summary persistente
        # iniettato come <MEMORIA_PERSISTENTE> nel system prompt.
        _birthday_scheduler.add_job(
            _run_axon_memory_distillation_job, "cron", hour=4, minute=0,
            id="axon-memory-distillation", replace_existing=True,
        )
        # V50.z85 — Drive re-indexing (ogni 30 min): scarica testo dei PDF/text
        # dai file delle cartelle Drive salvate e li mette in cache locale
        # per RAG istantaneo nelle chat AxonOS anche in nuove sessioni.
        _birthday_scheduler.add_job(
            _run_drive_reindex_job, "interval", minutes=30,
            id="drive-reindex", replace_existing=True,
        )
        # V50.z101 — Dispatch review requests programmate (ogni 5 min)
        _birthday_scheduler.add_job(
            _run_review_requests_dispatch_job, "interval", minutes=5,
            id="review-requests-dispatch", replace_existing=True,
        )
        # V50.z102 — Follow-up automatico recensioni (ogni ora, sollecito dopo 3 giorni)
        _birthday_scheduler.add_job(
            _run_review_followup_job, "interval", hours=1,
            id="review-followup", replace_existing=True,
        )
        # V50.z104 — Auto-tips AdvisorOS (ogni 12 ore, PROMPT 27)
        _birthday_scheduler.add_job(
            _run_advisor_tips_job, "interval", hours=12,
            id="advisor-tips", replace_existing=True,
        )
        # V50.z228 — Rinnovo automatico scadenze ricorrenti aree (bollo, polizza, aree custom): ogni giorno 08:30
        _birthday_scheduler.add_job(
            _aw_rollover_job, "cron", hour=8, minute=30,
            id="area-deadline-rollover", replace_existing=True,
        )
        # V50.z267 — Scadenze documenti di riconoscimento (email 90gg, popup 30gg): ogni giorno 09:15
        _birthday_scheduler.add_job(
            _iddoc_expiry_job, "cron", hour=9, minute=15,
            id="identity-docs-expiry", replace_existing=True,
        )
        # V50.z273 — Reminder Area Corsi (non letto / non ha risposto): ogni giorno 08:45
        _birthday_scheduler.add_job(
            _courses_reminder_job, "cron", hour=8, minute=45,
            id="courses-reminders", replace_existing=True,
        )
        _birthday_scheduler.start()
        logger.info("Birthday scheduler started (daily 09:00 Europe/Rome)")
        logger.info("Rule-proposals scheduler started (daily 03:00 Europe/Rome)")
        logger.info("Teach-URLs prefetch scheduler started (every 30 minutes)")
        logger.info("Auto-CRM scheduler tick started (every 1 minute)")
        logger.info("Axon memory distillation scheduler started (daily 04:00 Europe/Rome)")
        logger.info("Drive re-index scheduler started (every 30 minutes)")
        logger.info("Review requests dispatch scheduler started (every 5 minutes)")
        logger.info("Review auto-follow-up scheduler started (every 1 hour)")
        logger.info("Advisor auto-tips scheduler started (every 12 hours)")
    except Exception as e:
        logger.warning(f"birthday scheduler start failed: {e}")


@app.on_event("startup")
async def _seed_demo_user():
    """
    V29.ac — Seed idempotente dell'utente demo `demo@advisoros.it` con 3 clienti
    di esempio. Se l'utente esiste già lo lascia intatto. Se esiste ma non ha
    contatti, li reinserisce così l'app è sempre popolata al primo login demo.
    """
    try:
        # V45c — Demo/reviewer account seed. Credentials must come from env
        # variables — no source fallbacks. Set `DEMO_SEED_DISABLED=1` in .env
        # to skip this seed entirely in production. If env vars are missing
        # the seed is a no-op (safer default than shipping known creds).
        if os.environ.get("DEMO_SEED_DISABLED", "").strip() in ("1", "true", "yes"):
            return
        DEMO_EMAIL = (os.environ.get("DEMO_SEED_EMAIL") or "").strip().lower()
        DEMO_PASSWORD = os.environ.get("DEMO_SEED_PASSWORD") or ""
        if not DEMO_EMAIL or not DEMO_PASSWORD:
            logger.info("[demo-seed] skipped (DEMO_SEED_EMAIL/DEMO_SEED_PASSWORD not set)")
            return
        existing = await db.users.find_one({"email": DEMO_EMAIL})
        if existing:
            user_id = existing["user_id"]
        else:
            user_id = f"user_demo_{uuid.uuid4().hex[:8]}"
            await db.users.insert_one({
                "user_id": user_id,
                "email": DEMO_EMAIL,
                "name": "Emanuele Demo",
                "password_hash": hash_password(DEMO_PASSWORD),
                "role": "owner",
                "areas": ["energy", "network"],
                "picture": None,
                "created_at": utcnow(),
            })
            await db.settings.insert_one({
                "user_id": user_id,
                **SettingsModel().model_dump(),
            })
            logger.info(f"[seed] demo user {DEMO_EMAIL} creato (user_id={user_id})")

        # Popola i contatti demo solo se il tenant è vuoto
        existing_count = await db.contacts.count_documents({"user_id": user_id})
        if existing_count > 0:
            return

        demo_contacts = [
            {
                "first_name": "Marco", "last_name": "Bianchi", "contact_code": "E-0001",
                "phone": "+39 340 1234567", "email": "marco.bianchi@example.it",
                "address_street": "Via Roma", "address_number": "12",
                "address_zip": "20121", "address_city": "Milano", "address_province": "MI",
                "fiscal_code": "BNCMRC80A01F205X", "birth_date": "1980-01-01",
                "area": "energy", "additional_areas": ["network"],
                "source": "personal", "status": "client",
                "customer_types": {"energy": "business"},
                "general_note": "Cliente storico, gestisce 2 P.IVA (studio dentistico + immobiliare). Preferisce comunicazioni via WhatsApp.",
                "tags": ["VIP", "Milano"],
            },
            {
                "first_name": "Laura", "last_name": "Rossi", "contact_code": "E-0002",
                "phone": "+39 333 9876543", "email": "laura.rossi@example.it",
                "address_street": "Corso Vittorio Emanuele", "address_number": "45",
                "address_zip": "10121", "address_city": "Torino", "address_province": "TO",
                "fiscal_code": "RSSLRA85B41L219A", "birth_date": "1985-02-01",
                "area": "network", "additional_areas": [],
                "source": "personal", "status": "prospect",
                "customer_types": {"network": "private"},
                "general_note": "Consulente marketing freelance interessata al piano commissioni. Da richiamare la prossima settimana per approfondimento.",
                "tags": ["Torino", "Marketing"],
            },
            {
                "first_name": "Giuseppe", "last_name": "Verdi", "contact_code": "E-0003",
                "phone": "+39 349 5551234", "email": "g.verdi@example.it",
                "address_street": "Piazza del Duomo", "address_number": "8",
                "address_zip": "50122", "address_city": "Firenze", "address_province": "FI",
                "fiscal_code": "VRDGPP75E15D612Y", "birth_date": "1975-05-15",
                "area": "energy", "additional_areas": [],
                "source": "personal", "status": "collaborator",
                "customer_types": {"energy": "private"},
                "general_note": "Ex cliente diventato collaboratore. Porta in media 3 referenze/mese. Vive a Firenze centro.",
                "tags": ["Firenze", "Top Referrer"],
            },
        ]

        for c in demo_contacts:
            cid = f"c_demo_{uuid.uuid4().hex[:10]}"
            doc = {
                "contact_id": cid,
                "user_id": user_id,
                "created_by": user_id,
                "assigned_to_user_id": user_id,
                **c,
                "phone_alt": "", "whatsapp": "", "email_alt": "",
                "address": "", "work_address": "", "residence_address": "",
                "birthday_alert_days_before": 1, "birthday_auto_send": False,
                "birthday_message": "", "birthday_message_photo": None, "birthday_message_link": None,
                "birthday_sender_email": None, "birthday_recipient_email": None,
                "is_active_client": c.get("status") == "client",
                "anniversaries": [], "vat_number": "", "website": "",
                "linkedin": "", "instagram": "", "facebook": "", "telegram": "",
                "referred_by_contact_id": None, "referral_type": None,
                "referral_note": "", "email_note": "",
                "group_ids": [], "reference_contact_ids": [],
                "notes": [
                    {"note_id": f"n_{uuid.uuid4().hex[:8]}", "content": "Prima chiamata conoscitiva — ha mostrato interesse.", "created_at": utcnow().isoformat()},
                ],
                "files": [],
                "created_at": utcnow(),
                "updated_at": utcnow(),
            }
            await db.contacts.insert_one(doc)

        logger.info(f"[seed] {len(demo_contacts)} contatti demo creati per {DEMO_EMAIL}")
    except Exception as e:
        logger.warning(f"[seed] demo user seeding failed: {e}")


# Manual trigger endpoint (Owner only) — useful for testing
@api_router.post("/admin/birthday/run-now")
async def run_birthday_now(user=Depends(get_current_user)):
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Solo Owner")
    await _run_birthday_job()
    return {"ok": True}
