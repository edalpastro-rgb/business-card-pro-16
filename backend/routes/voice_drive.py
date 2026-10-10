# voice_drive.py — V50.z495 — Axon Drive: helper del copilot vocale (/voice/copilot/execute in 12_ai_contact_copilot.py)
# · ricerca cliente condivisa (id dal CRM → candidati fuzzy → regex nome/cognome, sempre con scope_query)
# · display dinamico: elenco ritelefonate del giorno, ultima nota, navigazione verso il cliente (1 indirizzo → apre; >1 → chiede quale)
# · ora locale Europe/Rome per il calcolo delle date dette a voce («lunedì alle 9»)
# Caricato da server.py nel namespace condiviso (db, scope_query, HTTPException, … già definiti).
import zoneinfo as _vd_zoneinfo
from datetime import datetime as _vd_dt, timedelta as _vd_td, timezone as _vd_tz

_VD_ROME = _vd_zoneinfo.ZoneInfo("Europe/Rome")
_VD_DAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
_VD_CONTACT_PROJ = {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "phone": 1, "phone_alt": 1, "area": 1,
                    "address": 1, "address_street": 1, "address_number": 1, "address_zip": 1, "address_city": 1, "address_province": 1,
                    "work_address": 1, "residence_address": 1, "preferred_address": 1, "notes": 1}


def _vd_now_rome() -> _vd_dt:
    n = _vd_dt.now(_VD_ROME)
    # strftime %A dipende dal locale di sistema → giorno in italiano esplicito
    return n.replace(microsecond=0)


def _vd_fmt_now(n: _vd_dt) -> str:
    return f"{_VD_DAYS[n.weekday()]} {n.strftime('%d/%m/%Y %H:%M')} ({n.strftime('%z')})"


def _vd_name(c: dict) -> str:
    n = f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip()
    return n or (c.get("company") or "il cliente")


async def _vd_find_contact(user: dict, params: dict, candidates: list, pending_contact_id=None) -> dict:
    """Cliente a cui si riferisce il comando: conferma in corso → id scelto dall'LLM → miglior candidato CRM → regex sul nome."""
    ids = [x for x in (pending_contact_id, (params or {}).get("contact_id")) if x]
    for cid in ids:
        c = await db.contacts.find_one(scope_query(user, {"$or": [{"contact_id": cid}, {"id": cid}]}), _VD_CONTACT_PROJ)  # noqa: F821
        if c:
            return c
    if candidates and candidates[0].get("score", 0) >= 0.62:
        c = await db.contacts.find_one(scope_query(user, {"contact_id": candidates[0]["contact_id"]}), _VD_CONTACT_PROJ)  # noqa: F821
        if c:
            return c
    q = ((params or {}).get("contact_query") or "").strip()
    if not q:
        raise HTTPException(status_code=422, detail="Nome del cliente mancante")  # noqa: F821
    or_conds = []
    for t in [t for t in re.split(r"\s+", q) if len(t) >= 2]:  # noqa: F821
        or_conds += [{"first_name": {"$regex": re.escape(t), "$options": "i"}}, {"last_name": {"$regex": re.escape(t), "$options": "i"}}, {"company": {"$regex": re.escape(t), "$options": "i"}}]  # noqa: F821
    c = await db.contacts.find_one(scope_query(user, {"$or": or_conds or [{"_": None}]}), _VD_CONTACT_PROJ)  # noqa: F821
    if not c:
        raise HTTPException(status_code=404, detail=f"Cliente «{q}» non trovato nel CRM")  # noqa: F821
    return c


def _vd_day_range(day: str):
    today = _vd_now_rome().date()
    d = day.lower().strip()
    if d in ("today", "oggi", ""):
        dd, label = today, "oggi"
    elif d in ("tomorrow", "domani"):
        dd, label = today + _vd_td(days=1), "domani"
    else:
        try:
            dd = _vd_dt.strptime(d[:10], "%Y-%m-%d").date()
        except Exception:  # noqa: BLE001
            dd = today
        label = "oggi" if dd == today else ("domani" if dd == today + _vd_td(days=1) else f"{_VD_DAYS[dd.weekday()]} {dd.strftime('%d/%m')}")
    start = _vd_dt(dd.year, dd.month, dd.day, tzinfo=_VD_ROME)
    return start.astimezone(_vd_tz.utc), (start + _vd_td(days=1)).astimezone(_vd_tz.utc), label


async def _vd_list_callbacks(user: dict, day: str) -> dict:
    start, end, label = _vd_day_range(day)
    q = scope_query(user, {"done": {"$ne": True}, "scheduled_at": {"$gte": start, "$lt": end}})  # noqa: F821
    rows = await db.callbacks.find(q, {"_id": 0}).sort("scheduled_at", 1).to_list(200)  # noqa: F821
    cids = [r["contact_id"] for r in rows if r.get("contact_id")]
    names = {}
    if cids:
        async for c in db.contacts.find({"contact_id": {"$in": cids}}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1}):  # noqa: F821
            names[c["contact_id"]] = _vd_name(c)
    items = []
    for r in rows:
        sa = r.get("scheduled_at")
        if isinstance(sa, _vd_dt):
            sa = (sa if sa.tzinfo else sa.replace(tzinfo=_vd_tz.utc)).astimezone(_VD_ROME)
        items.append({"callback_id": r.get("callback_id"), "contact_id": r.get("contact_id"), "title": r.get("title") or names.get(r.get("contact_id")) or "Ritelefonata",
                      "contact_name": names.get(r.get("contact_id")), "time": sa.strftime("%H:%M") if isinstance(sa, _vd_dt) else "", "phone": r.get("phone"),
                      "note": r.get("note") or "", "area": r.get("area") or "energy"})
    if not items:
        spoken = f"Nessuna ritelefonata programmata per {label}."
    else:
        parts = [f"alle {i['time']} {i['contact_name'] or i['title']}" for i in items[:5]]
        more = f" e altre {len(items) - 5}" if len(items) > 5 else ""
        spoken = f"Hai {len(items)} ritelefonat{'a' if len(items) == 1 else 'e'} {label}: " + ", ".join(parts) + more + "."
    return {"answer": spoken, "display": {"type": "callbacks", "label": f"Ritelefonate di {label}", "items": items}}


async def _vd_list_appointments(user: dict, day: str) -> dict:
    """V50.z497 — display Drive: appuntamenti del giorno (ora, titolo, cliente, luogo)."""
    start, end, label = _vd_day_range(day)
    q = scope_query(user, {"start_at": {"$gte": start, "$lt": end}})  # noqa: F821
    rows = await db.appointments.find(q, {"_id": 0}).sort("start_at", 1).to_list(200)  # noqa: F821
    cids = [r["contact_id"] for r in rows if r.get("contact_id")]
    names = {}
    if cids:
        async for c in db.contacts.find({"contact_id": {"$in": cids}}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1}):  # noqa: F821
            names[c["contact_id"]] = _vd_name(c)
    items = []
    for r in rows:
        sa = r.get("start_at")
        if isinstance(sa, _vd_dt):
            sa = (sa if sa.tzinfo else sa.replace(tzinfo=_vd_tz.utc)).astimezone(_VD_ROME)
        items.append({"appointment_id": r.get("appointment_id") or r.get("id"), "contact_id": r.get("contact_id"), "title": r.get("title") or "Appuntamento",
                      "contact_name": names.get(r.get("contact_id")), "time": sa.strftime("%H:%M") if isinstance(sa, _vd_dt) else "",
                      "place": r.get("full_address") or r.get("map_address") or r.get("location") or "", "area": r.get("area") or "energy"})
    if not items:
        spoken = f"Nessun appuntamento {label}."
    else:
        parts = [f"alle {i['time']} {i['title']}{(' con ' + i['contact_name']) if i['contact_name'] and i['contact_name'].lower() not in i['title'].lower() else ''}" for i in items[:5]]
        more = f" e altri {len(items) - 5}" if len(items) > 5 else ""
        spoken = f"Hai {len(items)} appuntament{'o' if len(items) == 1 else 'i'} {label}: " + ", ".join(parts) + more + "."
    return {"answer": spoken, "display": {"type": "appointments", "label": f"Appuntamenti di {label}", "items": items}}


async def _vd_show_photo(contact: dict) -> dict:
    """V50.z497 — display Drive: foto del cliente (avatar della scheda, data URI)."""
    name = _vd_name(contact)
    full = await db.contacts.find_one({"contact_id": contact.get("contact_id")}, {"_id": 0, "avatar_base64": 1, "company": 1, "phone": 1, "address_city": 1})  # noqa: F821
    photo = (full or {}).get("avatar_base64") or ""
    if photo and not photo.startswith("data:"):
        photo = f"data:image/jpeg;base64,{photo}"
    sub = " · ".join(x for x in [(full or {}).get("company"), (full or {}).get("address_city")] if x)
    if not photo:
        return {"answer": f"Nella scheda di {name} non c'è una foto.", "display": {"type": "photo", "contact_name": name, "contact_id": contact.get("contact_id"), "photo": "", "subtitle": sub}}
    return {"answer": f"Ecco la foto di {name}.", "display": {"type": "photo", "contact_name": name, "contact_id": contact.get("contact_id"), "photo": photo, "subtitle": sub}}


def _vd_last_note(contact: dict) -> dict:
    notes = [n for n in (contact.get("notes") or []) if isinstance(n, dict) and (n.get("text") or "").strip()]
    name = _vd_name(contact)
    if not notes:
        return {"answer": f"Non ci sono note scritte su {name}.", "display": {"type": "note", "contact_name": name, "contact_id": contact.get("contact_id"), "text": "", "date": ""}}
    def _ts(n):
        v = n.get("created_at")
        if isinstance(v, _vd_dt):
            return v if v.tzinfo else v.replace(tzinfo=_vd_tz.utc)
        try:
            return _vd_dt.fromisoformat(str(v).replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001
            return _vd_dt.min.replace(tzinfo=_vd_tz.utc)
    last = max(notes, key=_ts)
    ts = _ts(last)
    date = ts.astimezone(_VD_ROME).strftime("%d/%m/%Y") if ts.year > 1 else ""
    text = (last.get("text") or "").strip()
    spoken = f"Ultima nota su {name}{(' del ' + date) if date else ''}: {text[:400]}"
    return {"answer": spoken, "display": {"type": "note", "contact_name": name, "contact_id": contact.get("contact_id"), "text": text, "date": date}}


def _vd_addresses(contact: dict) -> list:
    """Indirizzi distinti del cliente: principale (strutturato o legacy), lavoro, residenza."""
    main = (contact.get("address") or "").strip()
    if not main:
        street = " ".join(x for x in [(contact.get("address_street") or "").strip(), (contact.get("address_number") or "").strip()] if x)
        city = " ".join(x for x in [(contact.get("address_zip") or "").strip(), (contact.get("address_city") or "").strip()] if x)
        main = ", ".join(x for x in [street, city, (contact.get("address_province") or "").strip()] if x)
    elif contact.get("address_city") and contact["address_city"].lower() not in main.lower():
        main = f"{main}, {contact['address_city']}"
    out = []
    for key, label, val in (("main", "Indirizzo principale", main), ("work", "Lavoro / ufficio", (contact.get("work_address") or "").strip()), ("home", "Casa / residenza", (contact.get("residence_address") or "").strip())):
        if len(val) >= 4 and val.lower() not in [o["address"].lower() for o in out]:
            out.append({"key": key, "label": label, "address": val})
    pref = (contact.get("preferred_address") or "").lower()
    if pref:
        out.sort(key=lambda o: 0 if pref.startswith(o["key"][:3]) or (pref in ("residence", "residenza") and o["key"] == "home") else 1)
    return out


def _vd_navigate(contact: dict, nav_app=None, addr=None) -> dict:
    name = _vd_name(contact)
    opts = _vd_addresses(contact)
    if not opts:
        return {"answer": f"Non ho nessun indirizzo per {name}: aggiungilo nella scheda e riprova.", "display": {"type": "navigate", "contact_name": name, "contact_id": contact.get("contact_id"), "address": "", "nav_app": nav_app}}
    if addr is None and len(opts) > 1:
        labels = " o ".join(o["label"].split(" / ")[0].lower() for o in opts)
        return {"answer": f"{name} ha {len(opts)} indirizzi: {labels}. Quale uso?",
                "display": {"type": "navigate_choice", "contact_name": name, "contact_id": contact.get("contact_id"), "options": opts, "nav_app": nav_app},
                "pending_nav_contact_id": contact.get("contact_id")}
    chosen = addr or opts[0]
    app_lbl = "Waze" if nav_app == "waze" else "Google Maps" if nav_app == "google" else "il navigatore"
    return {"answer": f"Ti porto da {name}: {chosen['address']}. Apro {app_lbl}.",
            "display": {"type": "navigate", "contact_name": name, "contact_id": contact.get("contact_id"), "address": chosen["address"], "address_label": chosen["label"], "nav_app": nav_app}}


async def _vd_pick_address(user: dict, contact_id: str, transcript: str, want_audio: bool):
    """Risposta a «casa o lavoro?»: deterministica (parole chiave o numero ordinale). None se la frase non è una scelta."""
    c = await db.contacts.find_one(scope_query(user, {"contact_id": contact_id}), _VD_CONTACT_PROJ)  # noqa: F821
    if not c:
        return None
    opts = _vd_addresses(c)
    low = transcript.lower()
    nav_app = "waze" if "waze" in low else ("google" if "google" in low or "maps" in low else None)
    pick = None
    if re.search(r"\b(casa|residenz\w*|abitazion\w*)\b", low):  # noqa: F821
        pick = next((o for o in opts if o["key"] == "home"), None)
    elif re.search(r"\b(lavoro|ufficio|azienda|sede|negozio|studio)\b", low):  # noqa: F821
        pick = next((o for o in opts if o["key"] == "work"), None)
    elif re.search(r"\b(principale|primo|prima|il primo|quello principale)\b", low):  # noqa: F821
        pick = next((o for o in opts if o["key"] == "main"), None)
    elif re.search(r"\b(second[oa])\b", low) and len(opts) > 1:  # noqa: F821
        pick = opts[1]
    elif re.search(r"\b(terz[oa])\b", low) and len(opts) > 2:  # noqa: F821
        pick = opts[2]
    if not pick:
        return None
    res = _vd_navigate(c, nav_app, pick)
    audio_b64 = None; mime = None
    if want_audio:
        try:
            tts = await axon_tts_generate(user, res["answer"][:320], None)  # noqa: F821
            audio_b64, mime = tts.get("audio_base64"), tts.get("mime")
        except Exception:  # noqa: BLE001
            pass
    return {"spoken": res["answer"], "audio_base64": audio_b64, "audio_mime": mime, "intent": "navigate_to", "params": {}, "confirmation": res["answer"], "extra": res}


# ---- migrazione una tantum: richiamate create da Axon Drive PRIMA del fix (campi id/notes/status, senza callback_id/title/area/done)
# → le porto allo schema del form manuale così compaiono in Home («Ritelefonate di oggi») e nella scheda cliente.
@app.on_event("startup")  # noqa: F821
async def _vd_migrate_legacy_voice_callbacks():
    try:
        legacy = await db.callbacks.find({"callback_id": {"$exists": False}, "source": "voice_copilot"}, {"_id": 1, "id": 1, "contact_id": 1, "user_id": 1, "tenant_id": 1, "notes": 1, "note": 1, "phone": 1}).to_list(5000)  # noqa: F821
        n = 0
        for r in legacy:
            c = await db.contacts.find_one({"$or": [{"contact_id": r.get("contact_id")}, {"id": r.get("contact_id")}]}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "area": 1, "phone": 1}) or {}  # noqa: F821
            upd = {"callback_id": f"cb_{(r.get('id') or uuid.uuid4().hex)[:12]}", "title": _vd_name(c) if c else "Ritelefonata",  # noqa: F821
                   "area": c.get("area") if c.get("area") in ("energy", "network") else "energy", "note": r.get("note") or r.get("notes") or "",
                   "done": False, "notify": True, "notify_advance_min": None, "created_by": r.get("user_id"),
                   "user_id": r.get("tenant_id") or r.get("user_id"), "phone": r.get("phone") or c.get("phone")}
            if c.get("contact_id"):
                upd["contact_id"] = c["contact_id"]
            await db.callbacks.update_one({"_id": r["_id"]}, {"$set": upd, "$unset": {"notes": "", "status": "", "tenant_id": ""}})  # noqa: F821
            n += 1
        if n:
            logger.info("[voice-drive] migrate %d richiamate legacy di Axon Drive allo schema standard", n)  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[voice-drive] migrazione richiamate legacy fallita: %s", exc)  # noqa: F821
    # V50.z478 — contatti legacy con solo `id` (senza `contact_id`): rompevano GET /deadlines/upcoming (KeyError) → allineo lo schema
    try:
        n = 0
        async for c in db.contacts.find({"contact_id": {"$exists": False}, "id": {"$exists": True}}, {"_id": 1, "id": 1}):  # noqa: F821
            await db.contacts.update_one({"_id": c["_id"]}, {"$set": {"contact_id": c["id"]}})  # noqa: F821
            n += 1
        if n:
            logger.info("[voice-drive] migrate %d contatti legacy senza contact_id", n)  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[voice-drive] migrazione contatti legacy fallita: %s", exc)  # noqa: F821
