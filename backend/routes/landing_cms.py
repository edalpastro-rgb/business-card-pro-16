# landing_cms.py — V50.z530 — Landing pubblica «Axon Core» + CMS admin
#
# • GET /public/landing (NESSUN login): contenuti (default + override salvati dal CMS) e contatori «posti Founder rimasti»
#   calcolati in tempo reale: limite − account registrati con quel piano (users.plan: builder | professional; gli account
#   senza piano contano come professional — decisione cliente).
# • CMS: singleton Mongo `landing_content` (_id="global"), stesso pattern del libretto. Protezione DOPPIA: Super Admin
#   (36_admin_clients.require_super_admin) + password dedicata LANDING_CMS_PASSWORD (.env) nell'header X-CMS-Password.
#   GET /landing/cms/content · PUT /landing/cms/content · POST /landing/cms/reset · POST /landing/cms/unlock (verifica password).
import copy
import hmac
import os
from typing import Any, Dict, Optional

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, Field

LANDING_DEFAULTS: Dict[str, Any] = {
    "hero": {
        "badge": "🚀 Offerta Lancio: Diventa un Fondatore (Prezzo bloccato per sempre)",
        "title": "L'Intelligenza Artificiale che lavora per te. E custodisce la tua vita.",
        "subtitle": "Scopri l'ecosistema modulare protetto dal GDPR europeo. Fai decollare la tua produttività con il CRM AdvisorOS o custodisci i tuoi ricordi per sempre nel caveau privato di AxonOS. Senza che un solo dato venga mai regalato ai cloud americani.",
        "cta_primary": "Attiva AxonLite (Promo Founder)",
        "cta_secondary": "Scopri AdvisorOS per Professionisti",
    },
    "worlds": {
        "title": "I due mondi",
        "left_kicker": "AdvisorOS",
        "left_title": "Produttività Aziendale senza Limiti",
        "left_text": "Il CRM intelligente progettato per azzerare i tempi morti. Scannerizza documenti fiscali, compila automaticamente il tuo calendario e riassumi le note dei clienti in tempo reale. Un'AI integrata e potenziata sui nostri server privati, libera dai limiti soffocanti dei software tradizionali.",
        "right_kicker": "AxonOS · AxonLite",
        "right_title": "Il Custode della tua Storia e del tuo Studio",
        "right_text": "Un assistente vocale ambientale con microfono sempre aperto e ascolto locale protetto, pensato per conoscerti intimamente giorno dopo giorno. Carica i tuoi libri di testo, i tuoi appunti privati o le tue riflessioni quotidiane in un'area totalmente blindata e isolata dal mondo, creando la tua vera memoria ereditaria digitale.",
    },
    "manifesto": {
        "title": "La tua mente e il tuo lavoro non sono in vendita.",
        "pillars": [
            {"icon": "shield-checkmark", "title": "Privacy Sovrana", "text": "Tutto viene elaborato e protetto su infrastrutture dedicate in Italia (Server Aruba). Nessun dato fa addestramento."},
            {"icon": "wallet", "title": "Zero Costi Nascosti", "text": "Grazie al motore vettoriale proprietario inserito nel Core, carichi e interroghi libri e file fino a 20MB senza spendere patrimoni in token."},
            {"icon": "infinite", "title": "La Memoria ti Segue", "text": "Se chiudi la tua attività lavorativa, l'intelligenza di Core scollega il CRM ma non ti abbandona: tutti i tuoi dati e i tuoi ricordi migrano istantaneamente nella tua app privata AxonOS."},
        ],
    },
    "plans": {
        "title": "Piani Founder",
        "subtitle": "Prezzo bloccato per sempre per i primi 100 di ogni piano.",
        "builder": {
            "badge": "LIMITED FOUNDERS EDITION",
            "name": "Piano Builder Founder",
            "price_old": 25, "price": 19, "limit": 100,
            "features": ["Assistente vocale ambientale", "Area Vita Privata su server italiano", "20MB Knowledge Base (5.000 frammenti vettoriali locali)"],
            "cta": "Blocca il prezzo a 19€",
        },
        "professional": {
            "badge": "PROFESSIONAL FOUNDER",
            "name": "Piano Professional Founder",
            "price_old": 49, "price": 30, "limit": 100,
            "features": ["Tutto il piano Personal incluso", "Ecosistema CRM completo", "Automazione calendario", "Note clienti intelligenti", "Scanner documenti aziendali"],
            "cta": "Blocca il prezzo a 30€",
        },
        "seats_label": "posti rimasti su {limit}",
        "sold_out_label": "Posti Founder esauriti",
    },
    "footer": {"text": "Axon Core · AdvisorOS · AxonOS — Infrastruttura dedicata in Italia, GDPR europeo."},
}


def _landing_merge(base: Any, over: Any) -> Any:
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = _landing_merge(base.get(k), v) if k in base else v
        return out
    return over if over is not None else base


async def _landing_content() -> Dict[str, Any]:
    doc = await db.landing_content.find_one({"_id": "global"}, {"_id": 0, "content": 1, "updated_at": 1, "updated_by": 1})  # noqa: F821
    content = _landing_merge(copy.deepcopy(LANDING_DEFAULTS), (doc or {}).get("content") or {})
    return {"content": content, "is_default": not doc, "updated_at": (doc or {}).get("updated_at"), "updated_by": (doc or {}).get("updated_by")}


async def _landing_seats(content: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    base_q = {"role": "owner", "parent_user_id": {"$in": [None, ""]}}
    builder = await db.users.count_documents({**base_q, "plan": "builder"})  # noqa: F821
    professional = await db.users.count_documents({**base_q, "plan": {"$ne": "builder"}})  # noqa: F821 — senza piano = professional
    out = {}
    for key, taken in (("builder", builder), ("professional", professional)):
        limit = int((content.get("plans", {}).get(key, {}) or {}).get("limit") or 100)
        out[key] = {"limit": limit, "taken": taken, "left": max(0, limit - taken)}
    return out


@api_router.get("/public/landing")  # noqa: F821
async def public_landing():
    data = await _landing_content()
    return {"content": data["content"], "seats": await _landing_seats(data["content"]), "updated_at": data["updated_at"].isoformat() if data.get("updated_at") else None}


# ───────────────────────────── CMS (Super Admin + password dedicata) ─────────────────────────────
def _cms_password_ok(pw: Optional[str]) -> bool:
    expected = (os.environ.get("LANDING_CMS_PASSWORD") or "").strip()
    return bool(expected) and bool(pw) and hmac.compare_digest(expected, (pw or "").strip())


def _cms_can_admin(user: dict) -> bool:
    """V50.z531 — Amministratore del CMS: Super Admin (flag/ADVISOR_SUPER_ADMIN_EMAILS) OPPURE Master radice del workspace
    (role owner senza parent) OPPURE email in SUPER_MASTER_EMAILS — stessa logica del libretto (V50.z290: in produzione il flag
    super_admin non coincideva con l'account del Master e il pannello restava bloccato). La password CMS resta il 2° fattore."""
    try:
        if is_super_admin(user):  # noqa: F821 — 36_admin_clients
            return True
    except Exception:  # noqa: BLE001
        pass
    try:
        _require_super_master(user)  # noqa: F821 — 27_teach_ai_kb (Master radice o SUPER_MASTER_EMAILS)
        return True
    except HTTPException:
        return False


async def _require_cms_admin(user=Depends(get_current_user)):  # noqa: F821
    if not _cms_can_admin(user):
        raise HTTPException(status_code=403, detail="Sezione riservata all'amministratore (Master)")
    return user


@api_router.get("/landing/cms/permission")  # noqa: F821
async def landing_cms_permission(user=Depends(get_current_user)):  # noqa: F821
    return {"can": _cms_can_admin(user), "password_configured": bool((os.environ.get("LANDING_CMS_PASSWORD") or "").strip())}


async def _require_cms(user=Depends(_require_cms_admin), x_cms_password: Optional[str] = Header(default=None, alias="X-CMS-Password")):
    if not (os.environ.get("LANDING_CMS_PASSWORD") or "").strip():
        raise HTTPException(status_code=503, detail="LANDING_CMS_PASSWORD non configurata nel .env del server")
    if not _cms_password_ok(x_cms_password):
        raise HTTPException(status_code=401, detail="Password CMS errata")
    return user


class CmsUnlockIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class CmsContentIn(BaseModel):
    content: Dict[str, Any]


@api_router.post("/landing/cms/unlock")  # noqa: F821
async def landing_cms_unlock(body: CmsUnlockIn, user=Depends(_require_cms_admin)):
    if not (os.environ.get("LANDING_CMS_PASSWORD") or "").strip():
        raise HTTPException(status_code=503, detail="LANDING_CMS_PASSWORD non configurata nel .env del server")
    if not _cms_password_ok(body.password):
        raise HTTPException(status_code=401, detail="Password CMS errata")
    return {"ok": True}


@api_router.get("/landing/cms/content")  # noqa: F821
async def landing_cms_get(user=Depends(_require_cms)):
    data = await _landing_content()
    return {**data, "updated_at": data["updated_at"].isoformat() if data.get("updated_at") else None, "defaults": LANDING_DEFAULTS, "seats": await _landing_seats(data["content"])}


@api_router.put("/landing/cms/content")  # noqa: F821
async def landing_cms_put(body: CmsContentIn, user=Depends(_require_cms)):
    content = body.content or {}
    for key in ("builder", "professional"):
        plan = (content.get("plans") or {}).get(key) or {}
        for f in ("price_old", "price", "limit"):
            if f in plan and plan[f] is not None:
                try:
                    plan[f] = int(plan[f]) if f == "limit" else float(plan[f])
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail=f"Valore non numerico per plans.{key}.{f}")
        if plan.get("limit") is not None and plan["limit"] < 0:
            raise HTTPException(status_code=400, detail="Il limite posti non può essere negativo")
    await db.landing_content.replace_one({"_id": "global"}, {"_id": "global", "content": content, "updated_at": utcnow(), "updated_by": user.get("email") or user.get("user_id")}, upsert=True)  # noqa: F821
    data = await _landing_content()
    return {"ok": True, "content": data["content"], "seats": await _landing_seats(data["content"])}


@api_router.post("/landing/cms/reset")  # noqa: F821
async def landing_cms_reset(user=Depends(_require_cms)):
    await db.landing_content.delete_one({"_id": "global"})  # noqa: F821
    return {"ok": True, "content": LANDING_DEFAULTS}
