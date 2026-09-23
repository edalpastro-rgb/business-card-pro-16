# 06_team.py — Team multi-utente
# Estratto da server.py (righe originali 2290-2510). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Team (multi-user)
# =========================
@api_router.get("/team")
async def list_team(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può gestire il team")
    members = await db.users.find(
        {"parent_user_id": user["user_id"]},
        {"_id": 0, "password_hash": 0, "sensitive_password_enc": 0},
    ).to_list(1000)
    return {"items": members}


@api_router.get("/team/members")
async def list_team_members(user=Depends(get_current_user)):
    """Return all users in the current tenant (owner + all sub-users) — usable by owner and sub-users.
    Excludes the current caller.
    """
    tid = tenant_id(user)
    members = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": tid}]},
        {"_id": 0, "password_hash": 0, "sensitive_password_enc": 0, "avatar_base64": 0, "company_logo_base64": 0},  # V50.z345 — niente blob (3 s → <100 ms)
    ).to_list(1000)
    members = [{**m, "has_avatar": bool(m.get("picture"))} for m in members if m.get("user_id") != user["user_id"]]
    return {"items": members}


@api_router.get("/team/{member_id}/avatar")
async def team_member_avatar(member_id: str, user=Depends(get_current_user)):
    """V50.z345 — Avatar di un membro del team (caricato a parte perché pesante). Ritorna picture (URL) o avatar_base64."""
    tid = tenant_id(user)
    m = await db.users.find_one({"user_id": member_id, "$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 0, "picture": 1, "avatar_base64": 1, "name": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    return {"user_id": member_id, "picture": m.get("picture") or m.get("avatar_base64") or None}


async def _is_ancestor_of(caller_user_id: str, target_user_id: str) -> bool:
    """Return True if caller is (transitively) parent of target."""
    if caller_user_id == target_user_id:
        return False
    cur = await db.users.find_one({"user_id": target_user_id}, {"parent_user_id": 1, "_id": 0})
    while cur and cur.get("parent_user_id"):
        if cur["parent_user_id"] == caller_user_id:
            return True
        cur = await db.users.find_one({"user_id": cur["parent_user_id"]}, {"parent_user_id": 1, "_id": 0})
    return False


@api_router.post("/team")
async def invite_member(body: TeamInviteInput, user=Depends(get_current_user)):
    if not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="Solo owner o admin possono invitare utenti")
    if not body.areas:
        raise HTTPException(status_code=400, detail="Assegna almeno un'area")
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email già registrata")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": uid,
        "email": body.email.lower(),
        "name": body.name,
        "password_hash": hash_password(body.password),
        "role": "member",
        "areas": body.areas,
        # Parent = the caller (nested hierarchy). Members created by admins become their children.
        "parent_user_id": user["user_id"],
        "picture": None,
        "created_at": utcnow(),
    }
    await db.users.insert_one(doc)
    strip_id(doc)
    doc.pop("password_hash", None)
    return doc


@api_router.put("/team/{member_id}")
async def update_member(member_id: str, body: TeamUpdateInput, user=Depends(get_current_user)):
    # Owner can update anyone in tenant; admins can update their own descendants
    if is_owner(user):
        can = True
    else:
        can = await _is_ancestor_of(user["user_id"], member_id)
    if not can:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    # V28.z — Solo il Master può modificare `agent_code`
    if "agent_code" in upd and not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può modificare il codice agente")
    if "agent_code" in upd:
        upd["agent_code"] = (upd["agent_code"] or "").strip() or None
    r = await db.users.update_one({"user_id": member_id}, {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    m = await db.users.find_one({"user_id": member_id}, {"_id": 0, "password_hash": 0, "sensitive_password_enc": 0})
    return m


# V28.z — Sensitive password (Fernet-encrypted at rest). Read/write RBAC: Master OR self only.
def _sensitive_fernet():
    """Reuses GOOGLE_DRIVE_TOKEN_KEY as the app secret (a Fernet key). Safer would be a
    dedicated env var; per MVP semplice riusiamo la chiave già presente."""
    from cryptography.fernet import Fernet
    key = os.getenv("GOOGLE_DRIVE_TOKEN_KEY") or os.getenv("SENSITIVE_ENC_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="Chiave di cifratura non configurata")
    return Fernet(key.encode() if isinstance(key, str) else key)


async def _can_access_sensitive(user: dict, target_user_id: str) -> bool:
    """Master (owner of tenant) o il diretto interessato."""
    if user.get("user_id") == target_user_id:
        return True
    if not is_owner(user):
        return False
    # Master only for members of their own tenant
    tid = tenant_id(user)
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "user_id": 1, "parent_user_id": 1})
    if not target:
        return False
    target_tenant = target.get("parent_user_id") or target.get("user_id")
    return target_tenant == tid


@api_router.get("/team/{member_id}/sensitive-password")
async def get_sensitive_password(member_id: str, user=Depends(get_current_user)):
    if not await _can_access_sensitive(user, member_id):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    row = await db.users.find_one({"user_id": member_id}, {"_id": 0, "sensitive_password_enc": 1})
    if not row or not row.get("sensitive_password_enc"):
        return {"value": ""}
    try:
        f = _sensitive_fernet()
        plain = f.decrypt(row["sensitive_password_enc"].encode()).decode()
    except Exception:
        raise HTTPException(status_code=500, detail="Impossibile decifrare la password")
    return {"value": plain}


@api_router.put("/team/{member_id}/sensitive-password")
async def set_sensitive_password(member_id: str, body: SensitivePasswordIn, user=Depends(get_current_user)):
    if not await _can_access_sensitive(user, member_id):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    f = _sensitive_fernet()
    enc = f.encrypt((body.value or "").encode()).decode() if body.value else None
    await db.users.update_one({"user_id": member_id}, {"$set": {"sensitive_password_enc": enc, "sensitive_password_updated_at": utcnow()}})
    return {"ok": True}


@api_router.delete("/team/{member_id}")
async def delete_member(member_id: str, user=Depends(get_current_user)):
    if is_owner(user):
        can = True
    else:
        can = await _is_ancestor_of(user["user_id"], member_id)
    if not can:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    r = await db.users.delete_one({"user_id": member_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    await db.user_sessions.delete_many({"user_id": member_id})
    return {"ok": True}


class RoleInput(BaseModel):
    role: Literal["admin", "member", "owner"]


@api_router.put("/team/{member_id}/role")
async def set_member_role(member_id: str, body: RoleInput, user=Depends(get_current_user)):
    """Promote/demote a member to owner (Master figlio), admin (Manager) or member (Basic).
    Only owner OR an ancestor admin can change roles of a descendant.
    """
    if is_owner(user):
        can = True
    else:
        can = await _is_ancestor_of(user["user_id"], member_id)
    if not can:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    target = await db.users.find_one({"user_id": member_id})
    if not target:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    # Cannot change your own role or the top-level tenant owner's role
    if target.get("user_id") == user["user_id"]:
        raise HTTPException(status_code=400, detail="Non puoi modificare il tuo ruolo")
    if target.get("role") == "owner" and not target.get("parent_user_id"):
        raise HTTPException(status_code=400, detail="Impossibile modificare il ruolo del proprietario principale")
    await db.users.update_one({"user_id": member_id}, {"$set": {"role": body.role}})
    return {"user_id": member_id, "role": body.role}


@api_router.get("/team/hierarchy")
async def team_hierarchy(user=Depends(get_current_user)):
    """Return the team as a tree rooted at the tenant owner."""
    tid = tenant_id(user)
    users = await db.users.find(
        {"$or": [{"user_id": tid}, {"parent_user_id": {"$exists": True, "$ne": None}}]},
        {"_id": 0, "password_hash": 0, "totp_secret": 0, "backup_codes": 0},
    ).to_list(2000)
    # Filter to tenant only
    tenant_users = []
    for u in users:
        if u.get("user_id") == tid:
            tenant_users.append(u)
        else:
            # Walk up to check tenant membership
            cur = u
            while cur.get("parent_user_id"):
                if cur["parent_user_id"] == tid:
                    tenant_users.append(u)
                    break
                cur = await db.users.find_one({"user_id": cur["parent_user_id"]}, {"parent_user_id": 1, "user_id": 1, "_id": 0})
                if not cur: break
    # Build tree
    by_id: Dict[str, Dict[str, Any]] = {u["user_id"]: {**u, "children": []} for u in tenant_users}
    root = None
    for uid, node in by_id.items():
        pid = node.get("parent_user_id")
        if pid and pid in by_id:
            by_id[pid]["children"].append(node)
        elif uid == tid:
            root = node
    return {"root": root, "flat": tenant_users}




# =========================
