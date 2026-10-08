# onboarding_tracking.py — V50.z461 — PROMPT 23: ONBOARDING TRACKING E SEQUENZA DI ATTIVAZIONE.
# Tre checkpoint per ogni consulente: (1) profilo configurato = 3 domande iniziali del tour (user_settings.tour_profile),
# (2) anagrafica salvata (master_profiles: nome+cognome e almeno telefono o email), (3) primo cliente inserito (contacts).
# Data/ora registrate in db.onboarding_progress (una riga per utente, rilevamento automatico: nessuna modifica alle API esistenti).
# Il titolare (super-admin) vede lo stato di tutti in Pannello → «Onboarding consulenti» (GET /admin/onboarding).
# Solleciti automatici (job ogni ora, idempotenti): dopo 3 giorni dalla registrazione → email con link diretto al primo checkpoint
# mancante; dopo 7 giorni, se l'anagrafica manca ancora → seconda email con tono più diretto. Nessun intervento manuale.
import asyncio as _ob_asyncio
import html as _ob_html
import os as _ob_os
from datetime import datetime as _ob_dt, timedelta as _ob_td, timezone as _ob_tz
from typing import Any as _ob_Any, Dict as _ob_Dict, List as _ob_List, Optional as _ob_Optional

_OB_CHECKPOINTS = [
    {"key": "profile", "label": "Profilo configurato", "hint": "3 domande iniziali del tour", "route": "/tour"},
    {"key": "anagrafica", "label": "Anagrafica salvata", "hint": "Nome, cognome, telefono/email", "route": "/anagrafica-master"},
    {"key": "first_contact", "label": "Primo cliente inserito", "hint": "Prima scheda nel CRM", "route": "/contact/new"},
]
_OB_FIRST_AFTER_DAYS = int(_ob_os.environ.get("ONBOARDING_FIRST_REMINDER_DAYS", "3"))
_OB_SECOND_AFTER_DAYS = int(_ob_os.environ.get("ONBOARDING_SECOND_REMINDER_DAYS", "7"))
_OB_JOB_INTERVAL_SEC = int(_ob_os.environ.get("ONBOARDING_JOB_INTERVAL_SEC", "3600"))
_OB_MAX_AGE_DAYS = int(_ob_os.environ.get("ONBOARDING_REMINDER_MAX_AGE_DAYS", "30"))  # solleciti solo ai NUOVI iscritti (no raffica agli account storici al primo deploy)
_OB_SKIP_DOMAINS = ("example.com", "example.org", "test.local", "invalid")
_OB_STATE: _ob_Dict[str, _ob_Any] = {"task": None, "last_run": None, "runs": 0, "emails_sent": 0, "last_error": None}


def _ob_app_url() -> str:
    return (_ob_os.environ.get("APP_PUBLIC_URL") or _ob_os.environ.get("EXPO_PUBLIC_APP_URL") or "https://advisoros.it").rstrip("/")


def _ob_aware(v) -> _ob_Optional[_ob_dt]:
    if isinstance(v, _ob_dt):
        return v.replace(tzinfo=_ob_tz.utc) if v.tzinfo is None else v
    if isinstance(v, str):
        try:
            d = _ob_dt.fromisoformat(v.replace("Z", "+00:00"))
            return d.replace(tzinfo=_ob_tz.utc) if d.tzinfo is None else d
        except Exception:  # noqa: BLE001
            return None
    return None


# ---- rilevamento checkpoint (fonte di verità = dati reali; la riga di progresso memorizza SOLO la prima data vista) ----------
async def _ob_detect(user_doc: dict) -> _ob_Dict[str, _ob_Optional[_ob_dt]]:
    uid = user_doc["user_id"]
    out: _ob_Dict[str, _ob_Optional[_ob_dt]] = {"profile": None, "anagrafica": None, "first_contact": None}
    s = await db.user_settings.find_one({"user_id": uid}, {"tour_profile": 1, "axon_interest_profile": 1}) or {}  # noqa: F821
    tp = s.get("tour_profile") or {}
    if tp.get("text") or tp.get("features") or (s.get("axon_interest_profile") or {}).get("free_answers"):
        out["profile"] = _ob_aware(tp.get("at")) or _ob_aware((s.get("axon_interest_profile") or {}).get("updated_at")) or utcnow()  # noqa: F821
    mp = await db.master_profiles.find_one({"user_id": uid}, {"_id": 0}) or {}  # noqa: F821
    if (mp.get("first_name") or "").strip() and (mp.get("last_name") or "").strip() and ((mp.get("phone") or "").strip() or mp.get("primary_email") or mp.get("emails")):
        out["anagrafica"] = _ob_aware(mp.get("updated_at")) or _ob_aware(mp.get("created_at")) or utcnow()  # noqa: F821
    tid = user_doc.get("parent_user_id") or uid
    c = await db.contacts.find_one({"user_id": tid, "$or": [{"created_by": uid}, {"user_id": uid}]}, {"_id": 0, "created_at": 1}, sort=[("created_at", 1)])  # noqa: F821
    if c:
        out["first_contact"] = _ob_aware(c.get("created_at")) or utcnow()  # noqa: F821
    return out


async def _ob_sync_user(user_doc: dict) -> dict:
    """Aggiorna db.onboarding_progress per un utente: ogni checkpoint riceve la data della PRIMA rilevazione e non cambia più."""
    uid = user_doc["user_id"]
    prog = await db.onboarding_progress.find_one({"user_id": uid}, {"_id": 0}) or {}  # noqa: F821
    detected = await _ob_detect(user_doc)
    now = utcnow()  # noqa: F821
    cps = dict(prog.get("checkpoints") or {})
    for k, when in detected.items():
        if when and not cps.get(k):
            cps[k] = {"done_at": min(when, now), "detected_at": now}
    registered_at = _ob_aware(user_doc.get("created_at")) or _ob_aware(prog.get("registered_at")) or now
    doc = {"user_id": uid, "tenant_id": user_doc.get("parent_user_id") or uid, "email": user_doc.get("email"), "name": user_doc.get("name") or f"{user_doc.get('first_name') or ''} {user_doc.get('last_name') or ''}".strip(),
           "role": user_doc.get("role") or ("owner" if not user_doc.get("parent_user_id") else "member"), "registered_at": registered_at, "checkpoints": cps,
           "completed": all(cps.get(c["key"]) for c in _OB_CHECKPOINTS), "reminders": prog.get("reminders") or {}, "updated_at": now}
    if doc["completed"] and not prog.get("completed_at"):
        doc["completed_at"] = max(v["done_at"] for v in cps.values())
    await db.onboarding_progress.update_one({"user_id": uid}, {"$set": doc}, upsert=True)  # noqa: F821
    return doc


def _ob_missing(doc: dict) -> _ob_List[dict]:
    return [c for c in _OB_CHECKPOINTS if not (doc.get("checkpoints") or {}).get(c["key"])]


# ---- email di sollecito ---------------------------------------------------------------------------------------------------
def _ob_email_html(body_text: str) -> str:
    import re as _ob_re
    parts = []
    for p in body_text.split("\n\n"):
        esc = _ob_html.escape(p).replace("\n", "<br>")
        esc = _ob_re.sub(r"(https?://[^\s<]+)", r'<a href="\1" style="color:#7C3AED;font-weight:700">\1</a>', esc)
        parts.append(f"<p>{esc}</p>")
    return "".join(parts)


def _ob_first_email(name: str, missing: dict) -> _ob_Dict[str, str]:
    link = f"{_ob_app_url()}{missing['route']}"
    first = (name or "").split(" ")[0] or "ciao"
    subject = f"{first}, ti manca solo un passo: {missing['label'].lower()}"
    body = (f"Ciao {first},\n\nho visto che hai iniziato a configurare AdvisorOS ma ti sei fermato a «{missing['label']}» ({missing['hint']}).\n\n"
            f"Riprendi esattamente da lì con un tap:\n{link}\n\nCi vogliono due minuti e da quel momento Axon può lavorare davvero per te.\n\nA presto,\nAxon · AdvisorOS")
    return {"subject": subject, "text": body, "html": _ob_email_html(body)}


def _ob_second_email(name: str) -> _ob_Dict[str, str]:
    link = f"{_ob_app_url()}/anagrafica-master"
    first = (name or "").split(" ")[0] or "ciao"
    subject = f"{first}, senza anagrafica AdvisorOS resta fermo"
    body = (f"{first},\n\nsono passati 7 giorni e la tua anagrafica non è ancora salvata. Finché manca, Axon non può firmare email, compilare documenti né "
            f"presentarti ai clienti: stai pagando un'auto senza metterci la benzina.\n\nServono 60 secondi, qui:\n{link}\n\n"
            f"Se c'è qualcosa che ti blocca rispondi a questa email e lo risolviamo insieme.\n\nAxon · AdvisorOS")
    return {"subject": subject, "text": body, "html": _ob_email_html(body)}


async def _ob_send_reminders(doc: dict, now: _ob_dt) -> int:
    if doc.get("completed") or not doc.get("email") or doc["email"].rsplit("@", 1)[-1].lower() in _OB_SKIP_DOMAINS:
        return 0
    reg = _ob_aware(doc.get("registered_at")) or now
    age_days = (now - reg).total_seconds() / 86400
    if age_days > _OB_MAX_AGE_DAYS:
        return 0
    rem = dict(doc.get("reminders") or {})
    sent = 0
    missing = _ob_missing(doc)
    if age_days >= _OB_FIRST_AFTER_DAYS and missing and not rem.get("first"):
        m = _ob_first_email(doc.get("name") or "", missing[0])
        try:
            await axon_send_email("info", doc["email"], m["subject"], m["html"], text=m["text"], tid=doc.get("tenant_id"), tag="onboarding_1")  # noqa: F821
            rem["first"] = {"sent_at": now, "checkpoint": missing[0]["key"]}; sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("[onboarding] first reminder failed for %s: %s", doc["email"], exc)  # noqa: F821
    if age_days >= _OB_SECOND_AFTER_DAYS and not (doc.get("checkpoints") or {}).get("anagrafica") and not rem.get("second"):
        m = _ob_second_email(doc.get("name") or "")
        try:
            await axon_send_email("info", doc["email"], m["subject"], m["html"], text=m["text"], tid=doc.get("tenant_id"), tag="onboarding_2")  # noqa: F821
            rem["second"] = {"sent_at": now}; sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("[onboarding] second reminder failed for %s: %s", doc["email"], exc)  # noqa: F821
    if sent:
        await db.onboarding_progress.update_one({"user_id": doc["user_id"]}, {"$set": {"reminders": rem, "updated_at": now}})  # noqa: F821
    return sent


async def _ob_run_once() -> _ob_Dict[str, int]:
    now = utcnow()  # noqa: F821
    users = [u async for u in db.users.find({"email": {"$exists": True}}, {"_id": 0, "password_hash": 0})]  # noqa: F821
    synced = sent = 0
    for u in users:
        try:
            doc = await _ob_sync_user(u)
            synced += 1
            sent += await _ob_send_reminders(doc, now)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[onboarding] sync failed for %s: %s", u.get("user_id"), exc)  # noqa: F821
    _OB_STATE.update({"last_run": now.isoformat(), "runs": _OB_STATE["runs"] + 1, "emails_sent": _OB_STATE["emails_sent"] + sent})
    return {"synced": synced, "emails_sent": sent}


async def _ob_job_loop():
    await _ob_asyncio.sleep(90)
    while True:
        try:
            await _ob_run_once()
        except Exception as exc:  # noqa: BLE001
            _OB_STATE["last_error"] = str(exc)[:200]
            logger.warning("[onboarding] job failed: %s", exc)  # noqa: F821
        await _ob_asyncio.sleep(_OB_JOB_INTERVAL_SEC)


async def _ob_startup():
    try:
        if _OB_STATE["task"] is None:
            _OB_STATE["task"] = _ob_asyncio.create_task(_ob_job_loop(), name="onboarding_tracking_job")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[onboarding] startup failed: %s", exc)  # noqa: F821


app.add_event_handler("startup", _ob_startup)  # noqa: F821


# ---- API ------------------------------------------------------------------------------------------------------------------
def _ob_out(d: dict) -> dict:
    cps = {}
    for c in _OB_CHECKPOINTS:
        v = (d.get("checkpoints") or {}).get(c["key"])
        cps[c["key"]] = {"done": bool(v), "done_at": (_ob_aware(v["done_at"]).isoformat() if v and v.get("done_at") else None), "label": c["label"], "route": c["route"]}
    rem = d.get("reminders") or {}
    return {"user_id": d["user_id"], "name": d.get("name"), "email": d.get("email"), "role": d.get("role"), "tenant_id": d.get("tenant_id"),
            "registered_at": (_ob_aware(d.get("registered_at")).isoformat() if d.get("registered_at") else None), "completed": bool(d.get("completed")),
            "completed_at": (_ob_aware(d.get("completed_at")).isoformat() if d.get("completed_at") else None), "checkpoints": cps,
            "done_count": sum(1 for v in cps.values() if v["done"]),
            "reminders": {k: {"sent_at": _ob_aware(v.get("sent_at")).isoformat() if v.get("sent_at") else None, "checkpoint": v.get("checkpoint")} for k, v in rem.items()},
            "next_missing": next((c["key"] for c in _ob_missing(d)), None)}


@api_router.get("/admin/onboarding")  # noqa: F821
async def admin_onboarding(refresh: int = 0, user=Depends(require_super_admin)):  # noqa: F821 — 36_admin_clients.py
    """Stato di avanzamento onboarding di TUTTI i consulenti (titolare). refresh=1 ricalcola subito dai dati reali."""
    if refresh:
        await _ob_run_once()
    rows = [d async for d in db.onboarding_progress.find({}, {"_id": 0}).sort("registered_at", -1)]  # noqa: F821
    out = [_ob_out(d) for d in rows]
    tot = len(out)
    return {"checkpoints": _OB_CHECKPOINTS, "rules": {"first_reminder_days": _OB_FIRST_AFTER_DAYS, "second_reminder_days": _OB_SECOND_AFTER_DAYS},
            "stats": {"total": tot, "completed": sum(1 for r in out if r["completed"]), "stuck": sum(1 for r in out if not r["completed"]),
                      "by_checkpoint": {c["key"]: sum(1 for r in out if r["checkpoints"][c["key"]]["done"]) for c in _OB_CHECKPOINTS},
                      "reminders_sent": sum(len(r["reminders"]) for r in out)},
            "job": {k: v for k, v in _OB_STATE.items() if k != "task"}, "items": out}


@api_router.get("/onboarding/me")  # noqa: F821
async def onboarding_me(user=Depends(get_current_user)):  # noqa: F821
    u = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})  # noqa: F821
    return _ob_out(await _ob_sync_user(u or user))
