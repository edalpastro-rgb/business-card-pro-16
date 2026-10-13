# org_plans.py — V50.z541 — PIANI ABBONAMENTO per organizzazione (nuovi iscritti) + limiti utenti + gerarchia
#
# Gerarchia: Supermaster (super_admin) > Master (owner, senza parent) > Manager (admin) > Collaboratore (member/consultant).
# Il piano è del MASTER radice dell'organizzazione (`org_plan` sull'utente radice) e determina quanti utenti TOTALI
# (Master compreso: Manager + Collaboratori di tutti i livelli) può contenere l'organizzazione.
#   • Collaboratore singolo 19€/mese → 1 utente        • Master fino a 10 utenti 50€/mese
#   • Master fino a 50 utenti 100€/mese                • Oltre 50 utenti → richiesta preventivo (nessun limite finché il Supermaster non assegna un piano)
# I piani (etichette, prezzi, limiti) sono MODIFICABILI dal Supermaster: GET/PUT /admin/org-plans (app_settings key "org_plans"),
# letti dal modulo di registrazione via GET /public/org-plans e dal paywall (/billing/plans → acquisto/upgrade del piano via Stripe).
# Limite: `_org_limit_check(user)` viene chiamato prima di creare/invitare un utente (POST /team, POST /invites, POST /invites/{t}/register):
# superato il limite → 402 {code: "plan_limit"} e il Master deve fare upgrade (POST /org/plan/upgrade-request o pagamento).
# Organizzazioni esistenti senza `org_plan` (beta tester) → nessun limite (legacy) finché il Supermaster non assegna un piano.
import uuid as _op_uuid
from typing import Any as _OpAny, Dict as _OpDict, List as _OpList, Optional as _OpOptional

from pydantic import BaseModel as _OpBaseModel, Field as _OpField

ORG_PLAN_DEFAULTS: _OpList[_OpDict[str, _OpAny]] = [
    {"id": "collab", "label": "Collaboratore singolo", "price_month": 19.0, "max_users": 1, "quote": False, "order": 1,
     "desc": "Un solo utente: CRM, Axon e tutte le funzioni operative. Ideale per chi lavora da solo.", "badge": None},
    {"id": "master10", "label": "Master fino a 10 utenti", "price_month": 50.0, "max_users": 10, "quote": False, "order": 2,
     "desc": "Tu + fino a 9 tra Manager e Collaboratori. Team, aree, inviti e statistiche di squadra.", "badge": "Più scelto"},
    {"id": "master50", "label": "Master fino a 50 utenti", "price_month": 100.0, "max_users": 50, "quote": False, "order": 3,
     "desc": "Organizzazioni strutturate: più Manager, ognuno con i propri Collaboratori.", "badge": None},
    {"id": "enterprise", "label": "Oltre 50 utenti", "price_month": None, "max_users": None, "quote": True, "order": 4,
     "desc": "Richiesta preventivo: ti ricontattiamo per un piano su misura.", "badge": "Preventivo"},
]
_ORG_PLAN_FIELDS = ("id", "label", "price_month", "max_users", "quote", "order", "desc", "badge")


async def _org_plans() -> _OpList[_OpDict[str, _OpAny]]:
    doc = await db.app_settings.find_one({"key": "org_plans"}, {"_id": 0})  # noqa: F821
    items = (doc or {}).get("items") or ORG_PLAN_DEFAULTS
    return sorted(items, key=lambda p: (p.get("order") or 99, p.get("id") or ""))


async def _org_plan_by_id(pid: _OpOptional[str]) -> _OpOptional[_OpDict[str, _OpAny]]:
    if not pid:
        return None
    for p in await _org_plans():
        if p.get("id") == pid:
            return p
    return None


async def _org_root_id(user_id: str) -> str:
    """Risale la catena parent_user_id fino al Master radice (max 12 livelli)."""
    cur = user_id
    for _ in range(12):
        u = await db.users.find_one({"user_id": cur}, {"_id": 0, "parent_user_id": 1})  # noqa: F821
        if not u or not u.get("parent_user_id"):
            return cur
        cur = u["parent_user_id"]
    return cur


async def _org_usage(root_id: str) -> int:
    """Utenti totali nell'organizzazione (Master radice compreso)."""
    return 1 + len(await descendant_user_ids(root_id))  # noqa: F821


async def _org_plan_state(user: dict) -> _OpDict[str, _OpAny]:
    root_id = await _org_root_id(user["user_id"])
    root = await db.users.find_one({"user_id": root_id}, {"_id": 0, "org_plan": 1, "email": 1, "name": 1}) or {}  # noqa: F821
    plan = await _org_plan_by_id(root.get("org_plan"))
    used = await _org_usage(root_id)
    max_users = plan.get("max_users") if plan else None
    return {"root_user_id": root_id, "root_email": root.get("email"), "plan": plan, "plan_id": root.get("org_plan"),
            "used": used, "max_users": max_users, "left": (None if max_users is None else max(0, int(max_users) - used)),
            "over_limit": bool(max_users is not None and used > int(max_users)), "is_root": root_id == user["user_id"]}


async def _org_limit_check(user: dict, adding: int = 1) -> None:
    """Blocca (402 plan_limit) se l'organizzazione dell'utente non può accogliere `adding` utenti in più. Super admin esente."""
    if is_super_admin(user):  # noqa: F821
        return
    st = await _org_plan_state(user)
    if st["max_users"] is None:
        return
    if st["used"] + adding > int(st["max_users"]):
        label = (st["plan"] or {}).get("label") or "attuale"
        raise HTTPException(status_code=402, detail={  # noqa: F821
            "code": "plan_limit", "message": f"Limite del piano «{label}» raggiunto: {st['used']}/{st['max_users']} utenti. Passa al piano superiore per aggiungere altri utenti.",
            "used": st["used"], "max_users": st["max_users"], "plan_id": st["plan_id"]})


def _org_public_plan(p: _OpDict[str, _OpAny]) -> _OpDict[str, _OpAny]:
    return {k: p.get(k) for k in _ORG_PLAN_FIELDS}


@api_router.get("/public/org-plans")  # noqa: F821
async def public_org_plans():
    return {"items": [_org_public_plan(p) for p in await _org_plans()]}


@api_router.get("/org/plan")  # noqa: F821
async def org_plan_mine(user=Depends(get_current_user)):  # noqa: F821
    st = await _org_plan_state(user)
    plans = [_org_public_plan(p) for p in await _org_plans()]
    cur = st["plan"] or {}
    cur_max = cur.get("max_users")
    upgrades = [p for p in plans if p["id"] != st["plan_id"] and (p["quote"] or p["max_users"] is None or cur_max is None or (p["max_users"] or 0) > (cur_max or 0))] if st["plan_id"] else plans
    return {**st, "plans": plans, "upgrades": upgrades, "super_admin": is_super_admin(user)}  # noqa: F821


class _OrgUpgradeIn(_OpBaseModel):
    plan_id: str = _OpField(min_length=1, max_length=40)
    note: _OpOptional[str] = _OpField(default=None, max_length=600)


@api_router.post("/org/plan/upgrade-request")  # noqa: F821
async def org_plan_upgrade_request(body: _OrgUpgradeIn, user=Depends(get_current_user)):  # noqa: F821
    if not is_owner(user):  # noqa: F821
        raise HTTPException(status_code=403, detail="Solo il Master può richiedere l'upgrade del piano")  # noqa: F821
    target = await _org_plan_by_id(body.plan_id)
    if not target:
        raise HTTPException(status_code=400, detail="Piano non valido")  # noqa: F821
    st = await _org_plan_state(user)
    recent = await db.activation_requests.find_one({"tenant_id": st["root_user_id"], "status": "open", "kind": "org_plan_upgrade", "plan": body.plan_id}, {"_id": 0, "req_id": 1})  # noqa: F821
    if recent:
        return {"ok": True, "already": True, "req_id": recent["req_id"], "message": "Richiesta già inviata: ti ricontattiamo al più presto."}
    req_id = f"actreq_{_op_uuid.uuid4().hex[:10]}"
    doc = {"req_id": req_id, "kind": "org_plan_upgrade", "tenant_id": st["root_user_id"], "user_id": user["user_id"], "email": user.get("email"), "name": user.get("name"),
           "plan": body.plan_id, "plan_label": target.get("label"), "from_plan": st["plan_id"], "used": st["used"], "max_users": st["max_users"],
           "note": (body.note or "").strip() or None, "status": "open", "created_at": utcnow()}  # noqa: F821
    await db.activation_requests.insert_one(doc)  # noqa: F821
    _send = globals().get("axon_send_email")
    admins = sorted(_super_admin_emails_env()) or [BILLING_SUPPORT_EMAIL]  # noqa: F821
    if _send:
        html = (f"<p>Richiesta di <b>upgrade piano</b>{' (preventivo)' if target.get('quote') else ''}.</p><ul><li><b>Master:</b> {user.get('name') or ''} &lt;{user.get('email')}&gt;</li>"
                f"<li><b>Piano attuale:</b> {(st['plan'] or {}).get('label') or '—'} · utenti {st['used']}/{st['max_users'] or '∞'}</li>"
                f"<li><b>Piano richiesto:</b> {target.get('label')}</li><li><b>Nota:</b> {doc['note'] or '—'}</li></ul>"
                f"<p>Assegna il piano da Pannello Master → Utenti registrati (/admin/users).</p>")
        for a in admins:
            try:
                await _send("info", a, f"[AxonOS] Upgrade piano — {user.get('name') or user.get('email')} → {target.get('label')}", html, tag="org_plan_upgrade")
            except Exception as e:  # noqa: BLE001
                logging.getLogger("org_plans").warning("upgrade-request mail failed: %s", str(e)[:120])  # noqa: F821
    return {"ok": True, "req_id": req_id, "quote": bool(target.get("quote")),
            "message": "Richiesta inviata: ti ricontattiamo per il preventivo." if target.get("quote") else "Richiesta inviata. Puoi anche completare subito l'upgrade dalla sezione Abbonamento."}


# ───────────── CMS Supermaster: piani modificabili senza toccare il codice ─────────────
class _OrgPlanIn(_OpBaseModel):
    id: str = _OpField(min_length=2, max_length=40, pattern=r"^[a-z0-9_-]+$")
    label: str = _OpField(min_length=2, max_length=80)
    price_month: _OpOptional[float] = _OpField(default=None, ge=0, le=100000)
    max_users: _OpOptional[int] = _OpField(default=None, ge=1, le=100000)
    quote: bool = False
    order: int = _OpField(default=99, ge=0, le=999)
    desc: _OpOptional[str] = _OpField(default=None, max_length=300)
    badge: _OpOptional[str] = _OpField(default=None, max_length=30)


class _OrgPlansIn(_OpBaseModel):
    items: _OpList[_OrgPlanIn] = _OpField(min_length=1, max_length=12)


@api_router.get("/admin/org-plans")  # noqa: F821
async def admin_org_plans_get(user=Depends(require_super_admin)):  # noqa: F821
    doc = await db.app_settings.find_one({"key": "org_plans"}, {"_id": 0})  # noqa: F821
    return {"items": await _org_plans(), "defaults": ORG_PLAN_DEFAULTS, "customized": bool(doc), "updated_at": (doc or {}).get("updated_at")}


@api_router.put("/admin/org-plans")  # noqa: F821
async def admin_org_plans_put(body: _OrgPlansIn, user=Depends(require_super_admin)):  # noqa: F821
    items = [p.model_dump() for p in body.items]
    ids = [p["id"] for p in items]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="Id piano duplicati")  # noqa: F821
    for p in items:
        if not p["quote"] and p["price_month"] is None:
            raise HTTPException(status_code=400, detail=f"Piano «{p['label']}»: indica il prezzo mensile oppure segna «preventivo»")  # noqa: F821
    await db.app_settings.update_one({"key": "org_plans"}, {"$set": {"key": "org_plans", "items": items, "updated_at": utcnow(), "updated_by": user.get("email")}}, upsert=True)  # noqa: F821
    return {"ok": True, "items": await _org_plans()}


@api_router.post("/admin/org-plans/reset")  # noqa: F821
async def admin_org_plans_reset(user=Depends(require_super_admin)):  # noqa: F821
    await db.app_settings.delete_one({"key": "org_plans"})  # noqa: F821
    return {"ok": True, "items": ORG_PLAN_DEFAULTS}


# ───────────── Ponte verso il paywall (/billing/*): i piani acquistabili sono i piani organizzazione mensili ─────────────
async def _org_billing_plans() -> _OpDict[str, _OpDict[str, _OpAny]]:
    out: _OpDict[str, _OpDict[str, _OpAny]] = {}
    for p in await _org_plans():
        if p.get("quote") or p.get("price_month") is None:
            continue
        out[p["id"]] = {"id": p["id"], "label": p["label"], "amount": float(p["price_month"]), "currency": "eur", "days": 30,
                        "desc": (p.get("desc") or "") + (f" · fino a {p['max_users']} utenti" if p.get("max_users") else ""), "badge": p.get("badge"), "max_users": p.get("max_users")}
    return out
