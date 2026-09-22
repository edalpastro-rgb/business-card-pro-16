# 10_invites_groups_smtp_bulk.py — Inviti/trial, gruppi, SMTP, invii massivi
# Estratto da server.py (righe originali 4798-5421). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Invites & Trial subscription
# =========================
class InviteIn(BaseModel):
    trial_days: int = 30
    note: str = ""
    role: Optional[str] = None  # "basic" | "manager" | "master_figlio" (mapped to member/admin/owner)
    collaborator_name: Optional[str] = None  # display name of the invited collaborator
    assign_parent_user_id: Optional[str] = None  # V27 — assign new collaborator under an existing team member (must be tenant member)
    # V27 — Contact linkage: invite an existing contact from the rubrica.
    # If contact_id is provided, the invite is bound to that contact and status is updated on registration.
    # If contact_id is None but contact_quick fields are provided, a new contact is created on the fly.
    contact_id: Optional[str] = None
    contact_quick_first_name: Optional[str] = None
    contact_quick_last_name: Optional[str] = None
    contact_quick_email: Optional[str] = None
    contact_quick_phone: Optional[str] = None
    contact_intent: Optional[Literal["prospect", "collaborator"]] = None  # what the invite is FOR


class InviteRegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=100)


class ExtendTrialIn(BaseModel):
    add_days: int = Field(ge=1, le=3650)


def _subscription_state(user: dict) -> Dict[str, Any]:
    """Compute the subscription state (owner + trial + expiry) for a user."""
    if user.get("parent_user_id"):
        # sub-user inherits from parent
        return {"status": "sub_user", "expires_at": None, "days_left": None, "is_active": True}
    status_str = user.get("subscription_status") or "active"
    # Free-forever bypass trial logic
    if status_str == "free_forever":
        return {"status": "free_forever", "expires_at": None, "days_left": None, "is_active": True}
    exp = user.get("trial_expires_at")
    days_left = None
    if exp:
        if isinstance(exp, str):
            try: exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            except Exception: exp = None
        if exp:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            days_left = int(-(-(exp - utcnow()).total_seconds() // 86400))  # V50.z329 — per eccesso: giorno 1 → 14
            if status_str == "trial" and days_left < 0:
                status_str = "expired"
    return {
        "status": status_str,
        "expires_at": exp.isoformat() if isinstance(exp, datetime) else None,
        "days_left": days_left,
        "is_active": status_str in ("active", "trial") and (days_left is None or days_left >= 0),
    }


@api_router.get("/subscription/status")
async def get_subscription_status(user=Depends(get_current_user)):
    # Refresh from DB in case of updates
    tid = tenant_id(user)
    parent = await db.users.find_one({"user_id": tid}, {"_id": 0, "password_hash": 0}) or user
    state = _subscription_state(parent)
    return state


@api_router.post("/invites")
async def create_invite(body: InviteIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può creare inviti")
    tok = uuid.uuid4().hex[:20]
    # Normalize role (Basic/Manager/Master figlio → member/admin/owner)
    role_map = {
        "basic": "member",
        "manager": "admin",
        "master_figlio": "owner",
        "member": "member",
        "admin": "admin",
        "owner": "owner",
    }
    invite_role = role_map.get((body.role or "").lower(), "member") if body.role else None
    tid = tenant_id(user)
    # V27 — Validate assign_parent_user_id: must be a member of the current tenant
    assign_parent_user_id: Optional[str] = None
    if body.assign_parent_user_id and invite_role in ("member", "admin"):
        target = await db.users.find_one(
            {"user_id": body.assign_parent_user_id, "$or": [{"user_id": tid}, {"parent_user_id": tid}]},
            {"_id": 0, "user_id": 1}
        )
        if not target:
            raise HTTPException(status_code=400, detail="Collaboratore di destinazione non valido")
        assign_parent_user_id = body.assign_parent_user_id

    # V27 — Contact linkage: bind to existing contact or create one on the fly
    contact_id_final: Optional[str] = None
    if body.contact_id:
        ct = await db.contacts.find_one({"contact_id": body.contact_id, "user_id": tid}, {"_id": 0, "contact_id": 1})
        if not ct:
            raise HTTPException(status_code=400, detail="Contatto non valido")
        contact_id_final = body.contact_id
    elif body.contact_quick_first_name or body.contact_quick_email or body.contact_quick_phone:
        fn = (body.contact_quick_first_name or "").strip()
        ln = (body.contact_quick_last_name or "").strip()
        em = (body.contact_quick_email or "").strip().lower()
        ph = (body.contact_quick_phone or "").strip()
        if not (fn or em or ph):
            raise HTTPException(status_code=400, detail="Servono almeno nome, email o telefono per creare il contatto")
        cid = f"contact_{uuid.uuid4().hex[:12]}"
        intent_status = body.contact_intent or ("collaborator" if invite_role else "prospect")
        contact_doc = {
            "contact_id": cid,
            "user_id": tid,
            "assigned_to_user_id": user["user_id"],
            "created_by": user["user_id"],
            "first_name": fn or (em.split("@")[0] if em else "—"),
            "last_name": ln,
            "email": em,
            "phone": ph,
            "area": "energy",
            "additional_areas": [],
            "source": "personal",
            "status": intent_status,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await db.contacts.insert_one(contact_doc)
        contact_id_final = cid
    # Sync contact status to the invite intent immediately (visible in rubrica even before registration)
    if contact_id_final and body.contact_intent:
        await db.contacts.update_one(
            {"contact_id": contact_id_final, "user_id": tid},
            {"$set": {"status": body.contact_intent, "updated_at": utcnow()}}
        )

    doc = {
        "invite_token": tok,
        "created_by": user["user_id"],
        "trial_days": body.trial_days,
        "note": body.note,
        "invite_role": invite_role,  # role to assign upon acceptance
        "collaborator_name": (body.collaborator_name or "").strip() or None,
        "assign_parent_user_id": assign_parent_user_id,  # V27 — override parent at registration
        "contact_id": contact_id_final,  # V27 — linked contact
        "contact_intent": body.contact_intent,  # V27 — prospect|collaborator
        "created_at": utcnow(),
        "used_at": None,
        "used_by_user_id": None,
    }
    await db.invites.insert_one(doc)
    strip_id(doc)
    return doc


@api_router.get("/invites")
async def list_invites(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    items = await db.invites.find({"created_by": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Enrich with invited user info + subscription state
    for inv in items:
        if inv.get("used_by_user_id"):
            u = await db.users.find_one({"user_id": inv["used_by_user_id"]}, {"_id": 0, "password_hash": 0})
            if u:
                # V50.z321 — coesistenza con i codici promozionali: elenco codici riscattati dall'invitato
                promos = await db.promo_redemptions.find({"user_id": u["user_id"]}, {"_id": 0, "code": 1, "benefit_summary": 1, "redeemed_at": 1}).sort("redeemed_at", -1).to_list(20)
                inv["invited_user"] = {
                    "user_id": u["user_id"],
                    "name": u.get("name"),
                    "email": u.get("email"),
                    "subscription": _subscription_state(u),
                    "promo_codes": [{"code": p["code"], "benefit_summary": p.get("benefit_summary"), "redeemed_at": p["redeemed_at"].isoformat() if isinstance(p.get("redeemed_at"), datetime) else p.get("redeemed_at")} for p in promos],
                }
    return {"items": items}


@api_router.delete("/invites/{token}")
async def delete_invite(token: str, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.invites.delete_one({"invite_token": token, "created_by": user["user_id"]})
    return {"ok": True}


@api_router.get("/invites/{token}/info")
async def invite_info(token: str):
    """Public endpoint: get invite info before registering."""
    inv = await db.invites.find_one({"invite_token": token}, {"_id": 0, "created_by": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invito non trovato")
    if inv.get("used_at"):
        raise HTTPException(status_code=410, detail="Questo invito è già stato utilizzato")
    return {"trial_days": inv["trial_days"], "note": inv.get("note", "")}


@api_router.post("/invites/{token}/register")
async def register_via_invite(token: str, body: InviteRegisterIn):
    """Public endpoint: register a new tenant using an invite token."""
    inv = await db.invites.find_one({"invite_token": token})
    if not inv:
        raise HTTPException(status_code=404, detail="Invito non trovato")
    if inv.get("used_at"):
        raise HTTPException(status_code=410, detail="Invito già utilizzato")
    # Check email uniqueness
    existing = await db.users.find_one({"email": body.email.lower().strip()})
    if existing:
        raise HTTPException(status_code=409, detail="Email già registrata")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    trial_days = int(inv.get("trial_days") or 30)
    trial_expires_at = utcnow() + timedelta(days=trial_days)
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    now = utcnow()
    # Support role-based invites (Basic/Manager/Master figlio)
    invite_role = inv.get("invite_role")  # "member" | "admin" | "owner" | None
    creator_id = inv.get("created_by")
    # V27 — Optional override: assign under an existing team member instead of directly under master
    assign_parent_override = inv.get("assign_parent_user_id")
    if invite_role == "member":
        role = "member"
        parent_user_id = assign_parent_override or creator_id
    elif invite_role == "admin":
        role = "admin"
        parent_user_id = assign_parent_override or creator_id
    elif invite_role == "owner":
        role = "owner"
        parent_user_id = creator_id  # sub-master (Master figlio) — separate tenant with lineage
    else:
        # Default legacy behavior: new independent owner
        role = "owner"
        parent_user_id = None
    user_doc = {
        "user_id": uid,
        "email": body.email.lower().strip(),
        "password_hash": pw_hash,
        "name": body.name,
        "role": role,
        "areas": ["energy", "network"],
        "parent_user_id": parent_user_id,
        "subscription_status": "trial",
        "trial_expires_at": trial_expires_at,
        "created_at": now,
        "invited_by": inv["created_by"],
    }
    await db.users.insert_one(user_doc)
    # Mark invite used
    await db.invites.update_one(
        {"invite_token": token},
        {"$set": {"used_at": now, "used_by_user_id": uid}},
    )
    # V27 — Update linked contact status + link to registered user
    inv_contact_id = inv.get("contact_id")
    inv_intent = inv.get("contact_intent") or ("collaborator" if invite_role else "prospect")
    if inv_contact_id and inv["created_by"]:
        # Update inside the inviter's tenant (creator is a master, so its user_id IS the tenant_id)
        await db.contacts.update_one(
            {"contact_id": inv_contact_id, "user_id": inv["created_by"]},
            {"$set": {
                "status": inv_intent,
                "linked_user_id": uid,  # V27 — link the newly-registered user back to the master's rubrica entry
                "email": body.email.lower().strip() or None,
                "updated_at": now,
            }}
        )
    token_jwt = jwt.encode({"sub": uid, "email": user_doc["email"]}, JWT_SECRET, algorithm=JWT_ALG)
    return {
        "token": token_jwt,
        "user": {"user_id": uid, "email": user_doc["email"], "name": user_doc["name"], "role": user_doc["role"], "areas": user_doc["areas"]},
        "subscription": _subscription_state(user_doc),
    }


@api_router.put("/users/{user_id}/extend-trial")
async def extend_trial(user_id: str, body: ExtendTrialIn, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    # Ensure the target user was invited by this owner
    target = await db.users.find_one({"user_id": user_id, "invited_by": user["user_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato o non invitato da te")
    exp = target.get("trial_expires_at") or utcnow()
    if isinstance(exp, str):
        try: exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        except Exception: exp = utcnow()
    if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)
    # If already expired, start from now
    base = exp if exp > utcnow() else utcnow()
    new_exp = base + timedelta(days=body.add_days)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"trial_expires_at": new_exp, "subscription_status": "trial"}},
    )
    fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"user_id": user_id, "subscription": _subscription_state(fresh), "trial_expires_at": new_exp.isoformat()}


@api_router.put("/users/{user_id}/free-forever")
async def set_free_forever(user_id: str, user=Depends(get_current_user)):
    """Owner marks an invited user as Free Sempre (indefinite free access)."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    target = await db.users.find_one({"user_id": user_id, "invited_by": user["user_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato o non invitato da te")
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"subscription_status": "free_forever"}, "$unset": {"trial_expires_at": ""}},
    )
    fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"user_id": user_id, "subscription": _subscription_state(fresh)}


class RevokeFreeForeverIn(BaseModel):
    mode: Literal["trial", "expired"] = "trial"
    trial_days: int = 30


@api_router.put("/users/{user_id}/revoke-free-forever")
async def revoke_free_forever(user_id: str, body: RevokeFreeForeverIn, user=Depends(get_current_user)):
    """Owner revokes Free Sempre and moves user back to trial (or marks expired to force upgrade)."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    target = await db.users.find_one({"user_id": user_id, "invited_by": user["user_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato o non invitato da te")
    if body.mode == "expired":
        upd = {"subscription_status": "expired", "trial_expires_at": utcnow() - timedelta(days=1)}
    else:
        new_exp = utcnow() + timedelta(days=max(1, int(body.trial_days)))
        upd = {"subscription_status": "trial", "trial_expires_at": new_exp}
    await db.users.update_one({"user_id": user_id}, {"$set": upd})
    fresh = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"user_id": user_id, "subscription": _subscription_state(fresh)}


# =========================
# Groups (custom, per-tenant)
# =========================
class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = "#1B6CB0"
    description: str = ""


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None


@api_router.get("/groups")
async def list_groups(user=Depends(get_current_user)):
    q = {"user_id": tenant_id(user)}
    items = await db.groups.find(q, {"_id": 0}).sort("name", 1).to_list(1000)
    # Attach member_count
    for g in items:
        g["member_count"] = await db.contacts.count_documents({
            "user_id": tenant_id(user),
            "group_ids": g["group_id"],
        })
    return {"items": items}


@api_router.post("/groups")
async def create_group(body: GroupIn, user=Depends(get_current_user)):
    gid = f"g_{uuid.uuid4().hex[:12]}"
    doc = {
        "group_id": gid,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        **body.model_dump(),
        "created_at": utcnow(),
    }
    await db.groups.insert_one(doc)
    strip_id(doc)
    doc["member_count"] = 0
    return doc


@api_router.put("/groups/{group_id}")
async def update_group(group_id: str, body: GroupUpdate, user=Depends(get_current_user)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    r = await db.groups.update_one(
        {"user_id": tenant_id(user), "group_id": group_id},
        {"$set": upd},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Gruppo non trovato")
    g = await db.groups.find_one({"group_id": group_id}, {"_id": 0})
    return g


@api_router.delete("/groups/{group_id}")
async def delete_group(group_id: str, user=Depends(get_current_user)):
    await db.groups.delete_one({"user_id": tenant_id(user), "group_id": group_id})
    # Remove reference from all contacts
    await db.contacts.update_many(
        {"user_id": tenant_id(user), "group_ids": group_id},
        {"$pull": {"group_ids": group_id}},
    )
    return {"ok": True}


@api_router.get("/groups/{group_id}/contacts")
async def group_contacts(group_id: str, user=Depends(get_current_user)):
    q = scope_query(user, {"group_ids": group_id})
    items = await db.contacts.find(
        q,
        {"_id": 0, "notes": 0, "files": 0, "business_card": 0},
    ).sort("last_name", 1).to_list(2000)
    return {"items": items}


# =========================
# SMTP config (per-tenant)
# =========================
class SmtpConfig(BaseModel):
    host: str = ""
    port: int = 465
    username: str = ""
    password: str = ""
    sender_name: str = ""
    sender_email: str = ""
    use_ssl: bool = True


class SmtpConfigOut(BaseModel):
    host: str = ""
    port: int = 465
    username: str = ""
    sender_name: str = ""
    sender_email: str = ""
    use_ssl: bool = True
    configured: bool = False


@api_router.get("/smtp/config", response_model=SmtpConfigOut)
async def get_smtp_config(user=Depends(get_current_user)):
    doc = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not doc:
        return SmtpConfigOut()
    return SmtpConfigOut(
        host=doc.get("host", ""),
        port=doc.get("port", 465),
        username=doc.get("username", ""),
        sender_name=doc.get("sender_name", ""),
        sender_email=doc.get("sender_email", ""),
        use_ssl=doc.get("use_ssl", True),
        configured=bool(doc.get("password")),
    )


@api_router.put("/smtp/config", response_model=SmtpConfigOut)
async def put_smtp_config(body: SmtpConfig, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può modificare le impostazioni email")
    tid = tenant_id(user)
    existing = await db.smtp_configs.find_one({"user_id": tid}, {"_id": 0}) or {}
    upd = body.model_dump()
    # If password is empty, keep existing
    if not upd.get("password"):
        upd["password"] = existing.get("password", "")
    upd["user_id"] = tid
    upd["updated_at"] = utcnow()
    await db.smtp_configs.update_one({"user_id": tid}, {"$set": upd}, upsert=True)
    return SmtpConfigOut(
        host=upd.get("host", ""),
        port=upd.get("port", 465),
        username=upd.get("username", ""),
        sender_name=upd.get("sender_name", ""),
        sender_email=upd.get("sender_email", ""),
        use_ssl=upd.get("use_ssl", True),
        configured=bool(upd.get("password")),
    )


def _send_smtp_email(cfg: dict, to_email: str, subject: str, body_text: str, body_html: Optional[str] = None):
    """Blocking send via SMTP. To be run in a threadpool."""
    sender_email = cfg.get("sender_email") or cfg.get("username")
    sender_name = cfg.get("sender_name") or sender_email
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((sender_name, sender_email))
    msg["To"] = to_email
    msg.attach(MIMEText(body_text or "", "plain", "utf-8"))
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))
    host = cfg["host"]
    port = int(cfg.get("port") or 465)
    use_ssl = bool(cfg.get("use_ssl", True))
    if use_ssl:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as server:
            server.login(cfg["username"], cfg["password"])
            server.sendmail(sender_email, [to_email], msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            try:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            except Exception:
                pass
            server.login(cfg["username"], cfg["password"])
            server.sendmail(sender_email, [to_email], msg.as_string())


class SmtpTestInput(BaseModel):
    to_email: EmailStr


@api_router.post("/smtp/test")
async def smtp_test(body: SmtpTestInput, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    cfg = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not cfg or not cfg.get("password") or not cfg.get("host"):
        raise HTTPException(status_code=400, detail="Configurazione SMTP mancante")
    try:
        await asyncio.get_event_loop().run_in_executor(
            None,
            _send_smtp_email,
            cfg,
            body.to_email,
            "Test invio Dal Pastro CRM",
            "Questa è una email di prova. Se la ricevi, la configurazione SMTP funziona correttamente.",
            None,
        )
    except Exception as e:
        logger.exception("SMTP test failed")
        raise HTTPException(status_code=400, detail=f"Errore invio: {e}")
    return {"ok": True}


# =========================
# Bulk messaging
# =========================
class BulkEmailInput(BaseModel):
    contact_ids: List[str] = Field(default_factory=list)
    group_id: Optional[str] = None
    subject: str
    body_text: str
    body_html: Optional[str] = None


@api_router.post("/bulk/email")
async def bulk_email(body: BulkEmailInput, user=Depends(get_current_user)):
    cfg = await db.smtp_configs.find_one({"user_id": tenant_id(user)}, {"_id": 0})
    if not cfg or not cfg.get("password") or not cfg.get("host"):
        raise HTTPException(status_code=400, detail="Configurazione SMTP non presente. Configura le credenziali email dalle Impostazioni.")
    q: Dict[str, Any] = scope_query(user)
    if body.group_id:
        q["group_ids"] = body.group_id
    elif body.contact_ids:
        q["contact_id"] = {"$in": body.contact_ids}
    else:
        raise HTTPException(status_code=400, detail="Nessun destinatario specificato")
    contacts = await db.contacts.find(q, {"_id": 0, "email": 1, "email_alt": 1, "first_name": 1, "last_name": 1, "contact_id": 1}).to_list(2000)
    sent, failed = [], []
    for c in contacts:
        to = (c.get("email") or c.get("email_alt") or "").strip()
        if not to:
            failed.append({"contact_id": c["contact_id"], "reason": "Email mancante"})
            continue
        try:
            personalized = body.body_text.replace("{nome}", c.get("first_name", "")).replace("{cognome}", c.get("last_name", ""))
            html = body.body_html.replace("{nome}", c.get("first_name", "")).replace("{cognome}", c.get("last_name", "")) if body.body_html else None
            await asyncio.get_event_loop().run_in_executor(
                None,
                _send_smtp_email,
                cfg,
                to,
                body.subject,
                personalized,
                html,
            )
            sent.append({"contact_id": c["contact_id"], "email": to})
        except Exception as e:
            logger.exception(f"SMTP send failed for {to}")
            failed.append({"contact_id": c["contact_id"], "email": to, "reason": str(e)[:200]})
    return {"sent_count": len(sent), "failed_count": len(failed), "sent": sent, "failed": failed}


class BulkPreviewInput(BaseModel):
    contact_ids: List[str] = Field(default_factory=list)
    group_id: Optional[str] = None
    channel: Literal["whatsapp", "telegram", "sms"]


@api_router.post("/bulk/preview")
async def bulk_preview(body: BulkPreviewInput, user=Depends(get_current_user)):
    """Return ordered list of recipients with deep-link phone/telegram to open sequentially from the client."""
    q: Dict[str, Any] = scope_query(user)
    if body.group_id:
        q["group_ids"] = body.group_id
    elif body.contact_ids:
        q["contact_id"] = {"$in": body.contact_ids}
    else:
        raise HTTPException(status_code=400, detail="Nessun destinatario")
    contacts = await db.contacts.find(
        q,
        {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "phone": 1, "whatsapp": 1, "telegram": 1},
    ).sort("last_name", 1).to_list(2000)
    out = []
    for c in contacts:
        entry = {
            "contact_id": c["contact_id"],
            "name": f"{c.get('first_name', '')} {c.get('last_name', '')}".strip(),
        }
        if body.channel == "whatsapp":
            phone = (c.get("whatsapp") or c.get("phone") or "").strip()
            entry["target"] = phone
            entry["skip"] = not phone
        elif body.channel == "sms":
            phone = (c.get("phone") or "").strip()
            entry["target"] = phone
            entry["skip"] = not phone
        else:  # telegram
            t = (c.get("telegram") or "").strip()
            entry["target"] = t
            entry["skip"] = not t
        out.append(entry)
    return {"items": out}


# =========================
