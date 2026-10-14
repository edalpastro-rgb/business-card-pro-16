# admin_users.py — V50.z541 — PANNELLO SUPERMASTER «Utenti registrati» (/admin/users)
# Elenco di TUTTI gli utenti (tutti i tenant) con ricerca, stato (verifica email, prova/abbonamento, piano organizzazione),
# ruolo, ultimo accesso e azioni: Elimina · Cambia ruolo · Sposta sotto un altro Master · Assegna piano · Reinvia benvenuto · Verifica email.
# Accesso: solo super_admin (require_super_admin, 36_admin_clients.py). Nessun secondo login: stesso JWT dell'app.
import re as _au_re
from typing import Any as _AuAny, Dict as _AuDict, List as _AuList, Optional as _AuOptional

from pydantic import BaseModel as _AuBaseModel, Field as _AuField

_AU_ROLES = ("owner", "admin", "member", "consultant")
_AU_ROLE_LABEL = {"owner": "Master", "admin": "Manager", "member": "Collaboratore", "consultant": "Consulente"}
_AU_PROJ = {"_id": 0, "user_id": 1, "email": 1, "name": 1, "first_name": 1, "last_name": 1, "role": 1, "super_admin": 1, "parent_user_id": 1,
            "org_plan": 1, "plan": 1, "product": 1, "advisor_tier": 1, "subscription_status": 1, "trial_expires_at": 1, "free_forever": 1,
            "email_verified": 1, "created_at": 1, "last_login": 1, "welcome_email_sent_at": 1, "welcome_email_error": 1, "company": 1, "invited_by": 1}


def _au_out(u: dict, emails: _AuDict[str, str], children: _AuDict[str, int], plans: _AuDict[str, dict], usage: _AuDict[str, int]) -> dict:
    role = u.get("role") or "member"
    is_root = role == "owner" and not u.get("parent_user_id")
    plan = plans.get(u.get("org_plan") or "")
    trial = u.get("trial_expires_at")
    exp = trial.isoformat() if hasattr(trial, "isoformat") else trial
    now = utcnow()  # noqa: F821
    if u.get("free_forever"):
        sub = "free_forever"
    elif u.get("subscription_status") == "active":
        sub = "active"
    elif trial and hasattr(trial, "tzinfo"):
        t = trial if trial.tzinfo else trial.replace(tzinfo=now.tzinfo)
        sub = "trial" if t > now else "expired"
    else:
        sub = u.get("subscription_status") or "—"
    return {
        "user_id": u["user_id"], "email": u.get("email"), "name": u.get("name") or " ".join(x for x in [u.get("first_name"), u.get("last_name")] if x),
        "role": role, "role_label": "Supermaster" if u.get("super_admin") or is_super_admin(u) else _AU_ROLE_LABEL.get(role, role),  # noqa: F821
        "super_admin": bool(u.get("super_admin") or is_super_admin(u)), "is_root_master": is_root,  # noqa: F821
        "parent_user_id": u.get("parent_user_id"), "parent_email": emails.get(u.get("parent_user_id") or ""),
        "children": children.get(u["user_id"], 0),
        "org_plan": u.get("org_plan"), "org_plan_label": (plan or {}).get("label"), "org_max_users": (plan or {}).get("max_users"), "org_used": usage.get(u["user_id"]) if is_root else None,
        "product": u.get("product") or "advisor", "advisor_tier": u.get("advisor_tier") or "test", "company": u.get("company"),
        "subscription": sub, "trial_expires_at": exp, "email_verified": u.get("email_verified", True),
        "created_at": u.get("created_at").isoformat() if hasattr(u.get("created_at"), "isoformat") else u.get("created_at"),
        "last_login": u.get("last_login").isoformat() if hasattr(u.get("last_login"), "isoformat") else u.get("last_login"),
        "welcome_email_sent_at": u.get("welcome_email_sent_at").isoformat() if hasattr(u.get("welcome_email_sent_at"), "isoformat") else u.get("welcome_email_sent_at"),
        "welcome_email_error": u.get("welcome_email_error"),
    }


@api_router.get("/admin/users")  # noqa: F821
async def admin_users_list(q: str = "", role: str = "all", status: str = "all", limit: int = 500, user=Depends(require_super_admin)):  # noqa: F821
    rows = await db.users.find({}, _AU_PROJ).sort("created_at", -1).to_list(5000)  # noqa: F821
    emails = {r["user_id"]: r.get("email") for r in rows}
    children: _AuDict[str, int] = {}
    for r in rows:
        p = r.get("parent_user_id")
        if p:
            children[p] = children.get(p, 0) + 1
    plans = {p["id"]: p for p in await _org_plans()}  # noqa: F821
    # utilizzo per Master radice: conteggio sull'intero albero (BFS in memoria)
    by_parent: _AuDict[str, _AuList[str]] = {}
    for r in rows:
        by_parent.setdefault(r.get("parent_user_id") or "", []).append(r["user_id"])
    usage: _AuDict[str, int] = {}
    for r in rows:
        if (r.get("role") == "owner") and not r.get("parent_user_id"):
            n, stack = 0, [r["user_id"]]
            while stack:
                cur = stack.pop()
                n += 1
                stack.extend(by_parent.get(cur, []))
            usage[r["user_id"]] = n
    items = [_au_out(r, emails, children, plans, usage) for r in rows]
    qn = (q or "").strip().lower()
    if qn:
        items = [i for i in items if qn in (i["email"] or "").lower() or qn in (i["name"] or "").lower() or qn in (i.get("company") or "").lower() or qn in (i.get("parent_email") or "").lower()]
    if role and role != "all":
        items = [i for i in items if (role == "superadmin" and i["super_admin"]) or (role == "master" and i["is_root_master"]) or (role == "submaster" and i["role"] == "owner" and i["parent_user_id"])
                 or (role == "manager" and i["role"] == "admin") or (role == "collab" and i["role"] in ("member", "consultant"))]
    if status and status != "all":
        items = [i for i in items if (status == "unverified" and i["email_verified"] is False) or (status == "trial" and i["subscription"] == "trial")
                 or (status == "expired" and i["subscription"] == "expired") or (status == "active" and i["subscription"] in ("active", "free_forever"))
                 or (status == "no_welcome" and not i["welcome_email_sent_at"])]
    counts = {"total": len(rows), "masters": sum(1 for r in rows if r.get("role") == "owner" and not r.get("parent_user_id")), "managers": sum(1 for r in rows if r.get("role") == "admin"),
              "collabs": sum(1 for r in rows if r.get("role") in ("member", "consultant")), "unverified": sum(1 for r in rows if r.get("email_verified") is False)}
    return {"items": items[: max(1, min(limit, 5000))], "counts": counts, "plans": [{"id": p["id"], "label": p["label"], "max_users": p.get("max_users")} for p in plans.values()], "me": user["user_id"]}


class _AdminUserPatch(_AuBaseModel):
    role: _AuOptional[str] = _AuField(default=None, pattern=r"^(owner|admin|member|consultant)$")
    parent_user_id: _AuOptional[str] = None   # "" → rende l'utente Master radice (nessun parent)
    org_plan: _AuOptional[str] = None         # "" → nessun piano (nessun limite)
    free_forever: _AuOptional[bool] = None
    name: _AuOptional[str] = _AuField(default=None, max_length=120)


@api_router.patch("/admin/users/{uid}")  # noqa: F821
async def admin_users_patch(uid: str, body: _AdminUserPatch, user=Depends(require_super_admin)):  # noqa: F821
    target = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})  # noqa: F821
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato")  # noqa: F821
    upd: _AuDict[str, _AuAny] = {}
    unset: _AuDict[str, _AuAny] = {}
    if body.role is not None:
        upd["role"] = body.role
    if body.parent_user_id is not None:
        if body.parent_user_id == "":
            upd["parent_user_id"] = None
            upd.setdefault("role", "owner")  # un utente senza parent è per definizione un Master radice
        else:
            if body.parent_user_id == uid:
                raise HTTPException(status_code=400, detail="Un utente non può essere parent di sé stesso")  # noqa: F821
            parent = await db.users.find_one({"user_id": body.parent_user_id}, {"_id": 0, "user_id": 1, "role": 1})  # noqa: F821
            if not parent:
                raise HTTPException(status_code=404, detail="Master/Manager di destinazione non trovato")  # noqa: F821
            if parent["role"] not in ("owner", "admin"):
                raise HTTPException(status_code=400, detail="Si può assegnare un utente solo sotto un Master o un Manager")  # noqa: F821
            if body.parent_user_id in await descendant_user_ids(uid):  # noqa: F821
                raise HTTPException(status_code=400, detail="Ciclo nella gerarchia: la destinazione è già sotto questo utente")  # noqa: F821
            # limite del piano dell'organizzazione di destinazione (l'intero sottoalbero spostato conta)
            moving = 1 + len(await descendant_user_ids(uid))  # noqa: F821
            await _org_limit_check(parent | {"user_id": parent["user_id"]}, adding=moving)  # noqa: F821
            upd["parent_user_id"] = body.parent_user_id
            if (body.role or target.get("role")) == "owner" and not body.role:
                upd["role"] = "admin"  # un Master spostato sotto un altro diventa Manager, salvo ruolo esplicito
    if body.org_plan is not None:
        if body.org_plan == "":
            unset["org_plan"] = ""
        else:
            if not await _org_plan_by_id(body.org_plan):  # noqa: F821
                raise HTTPException(status_code=400, detail="Piano non valido")  # noqa: F821
            upd["org_plan"] = body.org_plan
    if body.free_forever is not None:
        upd["free_forever"] = body.free_forever
    if body.name is not None and body.name.strip():
        upd["name"] = body.name.strip()
    if not upd and not unset:
        raise HTTPException(status_code=400, detail="Nessuna modifica")  # noqa: F821
    ops: _AuDict[str, _AuAny] = {}
    if upd:
        ops["$set"] = {**upd, "updated_at": utcnow(), "updated_by_admin": user.get("email")}  # noqa: F821
    if unset:
        ops["$unset"] = unset
    await db.users.update_one({"user_id": uid}, ops)  # noqa: F821
    if "role" in upd or "parent_user_id" in upd:  # ruolo/gerarchia cambiati → l'utente rientra con una sessione nuova
        await db.user_sessions.delete_many({"user_id": uid})  # noqa: F821
    fresh = await db.users.find_one({"user_id": uid}, _AU_PROJ)  # noqa: F821
    return {"ok": True, "user": _au_out(fresh, {}, {}, {p["id"]: p for p in await _org_plans()}, {})}  # noqa: F821


@api_router.delete("/admin/users/{uid}")  # noqa: F821
async def admin_users_delete(uid: str, cascade: bool = False, user=Depends(require_super_admin)):  # noqa: F821
    if uid == user["user_id"]:
        raise HTTPException(status_code=400, detail="Non puoi eliminare il tuo stesso account da qui")  # noqa: F821
    target = await db.users.find_one({"user_id": uid}, {"_id": 0, "user_id": 1, "email": 1, "super_admin": 1, "parent_user_id": 1})  # noqa: F821
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato")  # noqa: F821
    if target.get("super_admin") or is_super_admin(target):  # noqa: F821
        raise HTTPException(status_code=403, detail="Non è possibile eliminare un Supermaster")  # noqa: F821
    kids = await descendant_user_ids(uid)  # noqa: F821
    if kids and not cascade:
        raise HTTPException(status_code=409, detail={"code": "has_children", "children": len(kids),  # noqa: F821
                            "message": f"L'utente ha {len(kids)} utenti sotto di sé: spostali prima (Cambia Master) oppure conferma l'eliminazione a cascata."})
    ids = [uid] + (kids if cascade else [])
    r = await db.users.delete_many({"user_id": {"$in": ids}})  # noqa: F821
    await db.user_sessions.delete_many({"user_id": {"$in": ids}})  # noqa: F821
    await db.settings.delete_many({"user_id": {"$in": ids}})  # noqa: F821
    logging.getLogger("admin_users").warning("[admin-users] %s ha eliminato %d utenti (%s)", user.get("email"), r.deleted_count, target.get("email"))  # noqa: F821
    return {"ok": True, "deleted": r.deleted_count, "ids": ids}


@api_router.post("/admin/users/{uid}/welcome-email")  # noqa: F821
async def admin_users_resend_welcome(uid: str, user=Depends(require_super_admin)):  # noqa: F821
    target = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})  # noqa: F821
    if not target:
        raise HTTPException(status_code=404, detail="Utente non trovato")  # noqa: F821
    _welcome = globals().get("_welcome_email_send")
    if not _welcome:
        raise HTTPException(status_code=503, detail="Modulo email di benvenuto non disponibile")  # noqa: F821
    await db.users.update_one({"user_id": uid}, {"$unset": {"welcome_email_sent_at": "", "welcome_email_error": ""}})  # noqa: F821
    try:
        res = await _welcome(target)
    except Exception as e:  # noqa: BLE001
        err = str(e)[:200]
        await db.users.update_one({"user_id": uid}, {"$set": {"welcome_email_error": err}})  # noqa: F821
        raise HTTPException(status_code=502, detail=f"Invio fallito: {err}")  # noqa: F821
    if res is None:
        raise HTTPException(status_code=400, detail="Email di benvenuto disattivata nel CMS (Pannello → Email di benvenuto) o utente senza email")  # noqa: F821
    return {"ok": True, "result": res}


@api_router.post("/admin/users/{uid}/verify-email")  # noqa: F821
async def admin_users_force_verify(uid: str, user=Depends(require_super_admin)):  # noqa: F821
    r = await db.users.update_one({"user_id": uid}, {"$set": {"email_verified": True, "email_verified_at": utcnow(), "email_verified_by_admin": user.get("email")}, "$unset": {"email_verify": ""}})  # noqa: F821
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Utente non trovato")  # noqa: F821
    return {"ok": True}


@api_router.get("/admin/users/parents")  # noqa: F821
async def admin_users_parents(user=Depends(require_super_admin)):  # noqa: F821
    """Elenco Master e Manager (destinazioni possibili per «Sposta sotto…»)."""
    rows = await db.users.find({"role": {"$in": ["owner", "admin"]}}, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1, "parent_user_id": 1}).sort("email", 1).to_list(5000)  # noqa: F821
    return {"items": [{**r, "role_label": _AU_ROLE_LABEL.get(r.get("role"), r.get("role")), "is_root": r.get("role") == "owner" and not r.get("parent_user_id")} for r in rows]}


@app.on_event("startup")  # noqa: F821
async def _au_bootstrap_super_admin():
    """V50.z544 — Bootstrap Supermaster: se NESSUN super admin è configurato (né ADVISOR_SUPER_ADMIN_EMAILS/SUPER_MASTER_EMAILS
    né flag `super_admin` su un utente), il Master radice registrato per PRIMO diventa super_admin (è il titolare della
    piattaforma). Così il pannello Supermaster non resta mai inaccessibile in produzione. Logga l'operazione."""
    try:
        if _super_admin_emails_env():
            return
        if await db.users.count_documents({"super_admin": True}) > 0:  # noqa: F821
            return
        first = await db.users.find({"role": "owner", "parent_user_id": None}, {"_id": 0, "user_id": 1, "email": 1}).sort("created_at", 1).limit(1).to_list(1)  # noqa: F821
        if not first:
            first = await db.users.find({"role": "owner"}, {"_id": 0, "user_id": 1, "email": 1}).sort("created_at", 1).limit(1).to_list(1)  # noqa: F821
        if first:
            await db.users.update_one({"user_id": first[0]["user_id"]}, {"$set": {"super_admin": True, "super_admin_bootstrap_at": utcnow()}})  # noqa: F821
            logging.getLogger("admin_users").warning("[admin-users] bootstrap Supermaster: %s è ora super_admin (nessuna email configurata in .env)", first[0].get("email"))  # noqa: F821
    except Exception as e:  # noqa: BLE001
        logging.getLogger("admin_users").warning("[admin-users] bootstrap super admin fallito: %s", e)  # noqa: F821
