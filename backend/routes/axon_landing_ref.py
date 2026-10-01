# V50.z422 — «Condividi Landing Page» (sezione Master): link personalizzato https://landing.axonos.cloud?ref=<CODICE_AGENTE>
# e risoluzione PUBBLICA del ref → solo nome e cognome dell'advisor (per «Ti ha invitato: Mario Rossi» nella hero della landing).
# Il ref è il codice agente (users.agent_code, leggibile); se l'advisor non ne ha uno si usa user_id. Nessun altro dato esposto.
import os as _lr_os
import re as _lr_re

LANDING_PUBLIC_URL = (_lr_os.environ.get("LANDING_PUBLIC_URL") or "https://landing.axonos.cloud").rstrip("/")
_LR_REF_RX = _lr_re.compile(r"^[A-Za-z0-9_\-\.]{2,64}$")


def _lr_ref_for(user: dict) -> str:
    code = (user.get("agent_code") or "").strip()
    return code if code and _LR_REF_RX.match(code) else user["user_id"]


@api_router.get("/me/landing-link")  # noqa: F821
async def lr_my_landing_link(user=Depends(get_current_user)):  # noqa: F821
    """Link landing personalizzato dell'advisor loggato (ref = codice agente, fallback user_id)."""
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "agent_code": 1, "name": 1, "user_id": 1}) or user  # noqa: F821
    ref = _lr_ref_for(doc)
    return {"ref": ref, "url": f"{LANDING_PUBLIC_URL}?ref={ref}", "name": doc.get("name") or user.get("name") or "", "has_agent_code": bool(doc.get("agent_code"))}


@api_router.get("/public/advisor/{ref}")  # noqa: F821
async def lr_public_advisor(ref: str):
    """Pubblico (landing): ref → nome dell'advisor. 404 se sconosciuto; mai altri campi."""
    ref = (ref or "").strip()
    if not _LR_REF_RX.match(ref):
        raise HTTPException(status_code=404, detail="Advisor non trovato")  # noqa: F821
    rx = _lr_re.compile(f"^{_lr_re.escape(ref)}$", _lr_re.I)
    doc = await db.users.find_one({"$or": [{"agent_code": rx}, {"user_id": ref}]}, {"_id": 0, "name": 1})  # noqa: F821
    if not doc or not doc.get("name"):
        raise HTTPException(status_code=404, detail="Advisor non trovato")  # noqa: F821
    return {"name": str(doc["name"]).strip()[:80]}
