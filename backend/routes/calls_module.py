# calls_module.py — V50.z506 — Modulo «Call»: gestisce gli appuntamenti di tipo TELEFONATA (appointments.is_phone = true).
# • GET /calls/today → call del giorno (Europe/Rome) + call NON spuntate dei giorni precedenti («da fare»), escluse quelle già
#   spostate in ritelefonata; stesso scope (owner = tutto il tenant, collaboratore = solo le proprie).
# • POST /calls/{appointment_id}/reschedule {new_scheduled_at} → la call non effettuata DIVENTA una ritelefonata alla nuova data
#   (STESSO create_callback del form manuale → compare nel modulo Ritelefonate); l'appuntamento resta in Agenda alla data originale
#   marcato moved_to_callback_id / moved_to_callback_at («spostata in ritelefonata») e sparisce dal modulo Call.
# Isolato: usa scope_query (02), create_callback/CallbackIn (09), utcnow.
from datetime import datetime as _cm_dt, timedelta as _cm_td, timezone as _cm_tz
from typing import Optional as _cm_Optional
from zoneinfo import ZoneInfo as _cm_ZoneInfo

_CM_ROME = _cm_ZoneInfo("Europe/Rome")


class CallRescheduleIn(BaseModel):  # noqa: F821
    new_scheduled_at: _cm_dt
    note: str = ""


def _cm_day_bounds(day: _cm_Optional[str]):
    base = utcnow().astimezone(_CM_ROME)  # noqa: F821
    if day:
        try:
            y, m, d = (int(x) for x in day.split("-"))
            base = base.replace(year=y, month=m, day=d)
        except Exception:  # noqa: BLE001
            pass
    d0 = base.replace(hour=0, minute=0, second=0, microsecond=0)
    return d0.astimezone(_cm_tz.utc), (d0 + _cm_td(days=1)).astimezone(_cm_tz.utc)


@api_router.get("/calls/today")  # noqa: F821
async def calls_today(day: _cm_Optional[str] = None, include_done: bool = True, user=Depends(get_current_user)):  # noqa: F821
    start, end = _cm_day_bounds(day)
    q = scope_query(user, {"is_phone": True, "is_broadcast": {"$ne": True}, "moved_to_callback_id": {"$exists": False}})  # noqa: F821
    # call del giorno (fatte e da fare) + arretrate non spuntate (restano «da fare» finché non vengono chiuse o spostate)
    q["$or"] = [{"start_at": {"$gte": start, "$lt": end}}, {"start_at": {"$lt": start}, "done": {"$ne": True}}]
    if not include_done:
        q["done"] = {"$ne": True}
    items = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(500)  # noqa: F821
    for it in items:
        sa = it.get("start_at")
        if isinstance(sa, _cm_dt):
            sa = sa.replace(tzinfo=_cm_tz.utc) if sa.tzinfo is None else sa
            it["overdue"] = bool(sa < start and not it.get("done"))
    return {"items": items, "day": start.astimezone(_CM_ROME).strftime("%Y-%m-%d"),
            "total": len(items), "todo": sum(1 for i in items if not i.get("done")), "done": sum(1 for i in items if i.get("done"))}


@api_router.post("/calls/{appointment_id}/reschedule")  # noqa: F821
async def calls_reschedule(appointment_id: str, body: CallRescheduleIn, user=Depends(get_current_user)):  # noqa: F821
    appointment_id = appointment_id.split("@", 1)[0]
    q = scope_query(user, {"appointment_id": appointment_id})  # noqa: F821
    appt = await db.appointments.find_one(q, {"_id": 0})  # noqa: F821
    if not appt:
        raise HTTPException(status_code=404, detail="Call non trovata")  # noqa: F821
    if appt.get("done"):
        raise HTTPException(status_code=400, detail="La call è già stata effettuata: non si può spostare")  # noqa: F821
    if appt.get("moved_to_callback_id"):
        raise HTTPException(status_code=400, detail="Questa call è già stata spostata in ritelefonata")  # noqa: F821
    when = body.new_scheduled_at
    when = when.replace(tzinfo=_CM_ROME) if when.tzinfo is None else when
    contact = None
    if appt.get("contact_id"):
        contact = await db.contacts.find_one({"user_id": tenant_id(user), "$or": [{"contact_id": appt["contact_id"]}, {"id": appt["contact_id"]}]}, {"_id": 0, "first_name": 1, "last_name": 1, "phone": 1, "phone_alt": 1, "area": 1})  # noqa: F821
    cname = f"{(contact or {}).get('first_name') or ''} {(contact or {}).get('last_name') or ''}".strip()
    title = cname or (appt.get("title") or "Ritelefonata").replace("Telefonata con ", "").strip()
    note = (body.note or "").strip() or f"Da call del {appt['start_at'].astimezone(_CM_ROME).strftime('%d/%m %H:%M') if isinstance(appt.get('start_at'), _cm_dt) else ''}".strip()
    cb = await create_callback(CallbackIn(  # noqa: F821 — STESSO percorso del form «Nuova ritelefonata»
        contact_id=appt.get("contact_id"), title=title, area=appt.get("area") if appt.get("area") in ("energy", "network") else "energy",
        scheduled_at=when.astimezone(_cm_tz.utc), note=note, phone=(contact or {}).get("phone") or appt.get("phone_mobile") or None,
    ), user)
    await db.appointments.update_one({"appointment_id": appointment_id}, {"$set": {  # noqa: F821
        "moved_to_callback_id": cb["callback_id"], "moved_to_callback_at": utcnow(), "moved_to_scheduled_at": when.astimezone(_cm_tz.utc), "updated_at": utcnow()}})  # noqa: F821
    return {"ok": True, "callback": cb, "appointment_id": appointment_id, "moved_to_scheduled_at": when.isoformat()}
