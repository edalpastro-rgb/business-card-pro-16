# 04_settings_dashboard.py — Settings, widget Home, PUN GME, Info Requests
# Estratto da server.py (righe originali 1563-1983). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# Settings
# =========================
@api_router.get("/settings")
async def get_settings(user=Depends(get_current_user)):
    tid = tenant_id(user)
    s = await db.settings.find_one({"user_id": tid}, {"_id": 0})
    if not s:
        s = {"user_id": tid, **SettingsModel().model_dump()}
        await db.settings.insert_one(dict(s))
    # Seed default outcomes for tenants that don't have them yet
    if not s.get("appointment_outcomes"):
        s["appointment_outcomes"] = DEFAULT_APPT_OUTCOMES
        await db.settings.update_one({"user_id": tid}, {"$set": {"appointment_outcomes": DEFAULT_APPT_OUTCOMES}})
    if not s.get("call_outcomes"):
        s["call_outcomes"] = DEFAULT_CALL_OUTCOMES
        await db.settings.update_one({"user_id": tid}, {"$set": {"call_outcomes": DEFAULT_CALL_OUTCOMES}})
    else:
        # V26.k migration: ensure "Presa Appuntamento" (call_appointment) is FIRST and renamed
        existing = s["call_outcomes"]
        needs_migration = False
        if not existing or existing[0].get("id") != "call_appointment":
            needs_migration = True
        else:
            # Also migrate if name is still old
            if existing[0].get("name") == "Appuntamento preso":
                needs_migration = True
        if needs_migration:
            # Keep any custom outcomes user added, but ensure call_appointment is first with new name
            keep = [o for o in existing if o.get("id") != "call_appointment"]
            new_head = {"id": "call_appointment", "name": "Presa Appuntamento", "color": "#16A34A", "icon": "calendar"}
            s["call_outcomes"] = [new_head] + keep
            await db.settings.update_one({"user_id": tid}, {"$set": {"call_outcomes": s["call_outcomes"]}})
    if "callback_notify_default_advance_min" not in s:
        s["callback_notify_default_advance_min"] = 10
    if "disable_callback_notifications" not in s:
        s["disable_callback_notifications"] = False
    if not s.get("contact_source_options"):
        s["contact_source_options"] = DEFAULT_SOURCE_OPTIONS
        await db.settings.update_one({"user_id": tid}, {"$set": {"contact_source_options": DEFAULT_SOURCE_OPTIONS}})
    # V27 — Referral / Call script default seeds
    if "wa_referral_template" not in s:
        s["wa_referral_template"] = (
            "Ciao {name}! Volevo consigliarti il mio consulente energia che mi ha "
            "fatto risparmiare in bolletta. È preparato, trasparente e disponibile. "
            "Ti lascio il suo contatto se ti va di sentirlo. 🙂"
        )
        await db.settings.update_one({"user_id": tid}, {"$set": {"wa_referral_template": s["wa_referral_template"]}})
    if "call_script" not in s:
        s["call_script"] = (
            "APERTURA\n"
            "Buongiorno {name}, sono {agent} — la disturbo un attimo?\n\n"
            "SCOPO\n"
            "La chiamo perché aiuto famiglie e aziende a risparmiare in bolletta con un check gratuito.\n\n"
            "AGGANCIO\n"
            "Le posso fare una foto della sua bolletta e in 24h le mostro esattamente quanto può risparmiare — senza impegno.\n\n"
            "CHIUSURA\n"
            "Le va bene se ci vediamo giovedì alle 18:00 o preferisce venerdì mattina?"
        )
        await db.settings.update_one({"user_id": tid}, {"$set": {"call_script": s["call_script"]}})
    return s


@api_router.put("/settings")
async def update_settings(body: SettingsModel, user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può modificare le impostazioni")
    await db.settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": body.model_dump()},
        upsert=True,
    )
    s = await db.settings.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return s


@api_router.post("/settings/areas/reset")
async def reset_areas(user=Depends(get_current_user)):
    """V50.z113 — Azzera aree custom, metadati aree, categorie prodotto (+ sottocategorie)
    e tipi appuntamento personalizzati del tenant per ripartire da zero."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo l'owner può azzerare le aree")
    await db.settings.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "custom_areas": [], "area_meta": {}, "custom_product_categories": [],
            "custom_appointment_types": [], "hidden_appointment_types": [],
        }},
        upsert=True,
    )
    return await db.settings.find_one({"user_id": user["user_id"]}, {"_id": 0})


# =========================
# V50.z81 — Dashboard Home widgets (per-user)
# =========================
DASHBOARD_WIDGET_DEFAULTS = [
    {"id": "weather",             "enabled": True,  "label": "Allerte meteo (solo se attive)", "coming_soon": False},
    {"id": "meteo",               "enabled": True,  "label": "Meteo",                   "coming_soon": False},
    {"id": "appointments_today",  "enabled": True,  "label": "Appuntamenti di oggi",    "coming_soon": False},
    {"id": "pun",                 "enabled": True,  "label": "PUN aggiornato",          "coming_soon": False},
    {"id": "cgym",                "enabled": True,  "label": "Corporate Gym",           "coming_soon": False},  # Blocco 1
]


class DashboardWidgetItem(BaseModel):
    id: str
    enabled: bool = True
    order: int = 0


class DashboardWidgetsIn(BaseModel):
    widgets: List[DashboardWidgetItem]


def _merge_dashboard_widgets(saved: Optional[List[dict]]) -> List[dict]:
    """Merge saved widgets with defaults: preserve saved order+enabled, append new defaults at end."""
    saved = saved or []
    by_id = {w.get("id"): w for w in saved if isinstance(w, dict) and w.get("id")}
    result: List[dict] = []
    for i, s in enumerate(saved):
        if not isinstance(s, dict) or not s.get("id"):
            continue
        # find default meta
        meta = next((d for d in DASHBOARD_WIDGET_DEFAULTS if d["id"] == s.get("id")), None)
        if not meta:
            continue  # skip removed widget ids
        result.append({
            "id": s["id"],
            "enabled": bool(s.get("enabled", meta["enabled"])),
            "order": int(s.get("order", i)),
            "label": meta["label"],
            "coming_soon": meta["coming_soon"],
        })
    # append missing defaults at end
    for i, d in enumerate(DASHBOARD_WIDGET_DEFAULTS):
        if d["id"] not in by_id:
            result.append({
                "id": d["id"],
                "enabled": d["enabled"],
                "order": len(result),
                "label": d["label"],
                "coming_soon": d["coming_soon"],
            })
    # re-normalize order
    result.sort(key=lambda x: x["order"])
    for i, w in enumerate(result):
        w["order"] = i
    return result


@api_router.get("/settings/dashboard-widgets")
async def get_dashboard_widgets(user=Depends(get_current_user)):
    """Return current user's dashboard widget config (per-user, merged with defaults)."""
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"dashboard_widgets": 1, "_id": 0})
    saved = (doc or {}).get("dashboard_widgets")
    return {"widgets": _merge_dashboard_widgets(saved)}


@api_router.put("/settings/dashboard-widgets")
async def update_dashboard_widgets(body: DashboardWidgetsIn, user=Depends(get_current_user)):
    """Save per-user dashboard widget order/visibility. Only known widget ids are persisted."""
    known_ids = {d["id"] for d in DASHBOARD_WIDGET_DEFAULTS}
    clean: List[dict] = []
    seen: set = set()
    for i, w in enumerate(body.widgets):
        if w.id not in known_ids or w.id in seen:
            continue
        seen.add(w.id)
        clean.append({"id": w.id, "enabled": bool(w.enabled), "order": i})
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"dashboard_widgets": clean}},
    )
    return {"widgets": _merge_dashboard_widgets(clean)}


# =========================
# V50.z82 — PUN GME (widget home)
# =========================
@api_router.get("/pun/latest")
async def get_latest_pun(user=Depends(get_current_user)):
    """Restituisce l'ultimo mese disponibile nella cache GME con fasce F1/F2/F3.
    Include delta% per ciascuna fascia (F1, F2, F3) rispetto al mese precedente
    + `month_short` in italiano (es. "AGO") da mostrare dentro il badge F1.
    """
    doc = await db.gme_pun_cache.find_one(
        {},
        {"_id": 0},
        sort=[("year", -1), ("month", -1)],
    )
    prev = None
    if doc:
        prev = await db.gme_pun_cache.find_one(
            {"$or": [
                {"year": doc["year"], "month": {"$lt": doc["month"]}},
                {"year": {"$lt": doc["year"]}},
            ]},
            {"_id": 0, "monorario": 1, "F1": 1, "F2": 1, "F3": 1, "month_key": 1},
            sort=[("year", -1), ("month", -1)],
        )
    if not doc:
        return {"available": False}
    # V50.z327 — se il mese corrente ha già dati parziali (job giornaliero GME, gme_pun_partial), il widget mostra QUELLO
    # (etichetta «parziale · N gg») e il delta è rispetto all'ultimo mese chiuso — prima restava fermo al mese precedente fino a fine mese.
    partial = None
    try:
        _now = utcnow()
        partial = await db.gme_pun_partial.find_one({"month_key": f"{_now.year:04d}-{_now.month:02d}", "days": {"$gte": 1}}, {"_id": 0})
    except Exception:
        partial = None
    if partial and (partial.get("year"), partial.get("month")) > (doc.get("year"), doc.get("month")):
        prev, doc = doc, {**partial, "month_name": None, "partial": True}
    def _delta(cur, old):
        try:
            if cur is None or old is None or old == 0: return None
            return round(((cur - old) / old) * 100.0, 2)
        except Exception:
            return None
    delta_pct = _delta(doc.get("monorario"), (prev or {}).get("monorario"))
    delta_f1 = _delta(doc.get("F1"), (prev or {}).get("F1"))
    delta_f2 = _delta(doc.get("F2"), (prev or {}).get("F2"))
    delta_f3 = _delta(doc.get("F3"), (prev or {}).get("F3"))
    # Nome mese abbreviato in italiano
    _IT_SHORT = ["GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC"]
    m = int(doc.get("month") or 0)
    month_short = _IT_SHORT[m - 1] if 1 <= m <= 12 else ""
    return {
        "available": True,
        "month_key": doc.get("month_key"),
        "month_name": doc.get("month_name"),
        "month_short": month_short,
        "year": doc.get("year"),
        "F1": doc.get("F1"),
        "F2": doc.get("F2"),
        "F3": doc.get("F3"),
        "monorario": doc.get("monorario"),
        "unit": doc.get("unit") or "€/MWh",
        "source_url": doc.get("source_url"),
        "prev_month_key": (prev or {}).get("month_key"),
        "delta_pct": delta_pct,
        "delta_f1_pct": delta_f1,
        "delta_f2_pct": delta_f2,
        "delta_f3_pct": delta_f3,
        "partial": bool(doc.get("partial")),
        "partial_days": doc.get("days") if doc.get("partial") else None,
        "partial_updated_at": (doc.get("updated_at").isoformat() if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at")) if doc.get("partial") else None,
    }


# =========================
# V50.z82 — Info Requests (richieste info dai collaboratori al Master)
# =========================
class InfoRequestIn(BaseModel):
    subject: str = Field(min_length=2, max_length=200)
    body: str = Field(min_length=2, max_length=4000)
    # V50.z83 — Richiesta collegabile a un contatto/cliente (cronologia in scheda)
    contact_id: Optional[str] = None


class InfoRequestUpdate(BaseModel):
    status: Literal["pending", "resolved"]


class InfoRequestMessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


def _info_req_out(doc: dict) -> dict:
    def _iso(v):
        if isinstance(v, datetime): return v.isoformat()
        return v
    msgs = []
    for m in (doc.get("messages") or []):
        msgs.append({
            "author_id": m.get("author_id"),
            "author_name": m.get("author_name"),
            "author_role": m.get("author_role"),
            "text": m.get("text") or "",
            "attachment": m.get("attachment"),
            "at": _iso(m.get("at")),
        })
    return {
        "request_id": doc.get("request_id"),
        "subject": doc.get("subject"),
        "body": doc.get("body"),
        "status": doc.get("status") or "pending",
        "created_by": doc.get("created_by"),
        "created_by_name": doc.get("created_by_name"),
        "contact_id": doc.get("contact_id"),
        "created_at": _iso(doc.get("created_at")),
        "resolved_at": _iso(doc.get("resolved_at")),
        "updated_at": _iso(doc.get("updated_at") or doc.get("created_at")),
        "master_last_seen_at": _iso(doc.get("master_last_seen_at")),
        "collaborator_last_seen_at": _iso(doc.get("collaborator_last_seen_at")),
        "messages": msgs,
    }


def _info_req_unread_for(doc: dict, user: dict) -> bool:
    """Nuovo messaggio non ancora letto dall'utente corrente?"""
    updated = doc.get("updated_at") or doc.get("created_at")
    if not updated:
        return False
    if is_owner(user):
        seen = doc.get("master_last_seen_at")
    else:
        # Solo il creatore vede come "unread"
        if doc.get("created_by") != user["user_id"]:
            return False
        seen = doc.get("collaborator_last_seen_at")
    if not seen:
        # Master: unread se la richiesta NON è stata creata dal Master stesso
        if is_owner(user) and doc.get("created_by") == user["user_id"]:
            return False
        return True
    try:
        return updated > seen
    except Exception:
        return False


@api_router.post("/info-requests")
async def create_info_request(body: InfoRequestIn, user=Depends(get_current_user)):
    """Qualsiasi utente del tenant può inviare una richiesta info. Il Master la vede in home."""
    tid = tenant_id(user)
    # Verifica contact_id se presente
    if body.contact_id:
        c = await db.contacts.find_one({"user_id": tid, "contact_id": body.contact_id}, {"_id": 0, "contact_id": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Contatto non trovato")
    now = utcnow()
    doc = {
        "request_id": f"ir_{uuid.uuid4().hex[:12]}",
        "user_id": tid,
        "created_by": user["user_id"],
        "created_by_name": user.get("name") or user.get("email") or "",
        "subject": body.subject.strip(),
        "body": body.body.strip(),
        "contact_id": body.contact_id,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
        "resolved_at": None,
        "master_last_seen_at": now if is_owner(user) else None,
        "collaborator_last_seen_at": now if not is_owner(user) else None,
        "messages": [],
    }
    await db.info_requests.insert_one(doc)
    # V50.z84 — Push al Master (solo se creata da un collaboratore)
    try:
        if not is_owner(user) and tid != user["user_id"]:
            preview = (body.body.strip()[:120] + ("…" if len(body.body.strip()) > 120 else ""))
            await send_push(
                recipients=[tid],
                data={
                    "title": f"Nuova richiesta: {body.subject.strip()[:60]}",
                    "message": f"da {user.get('name') or 'Collaboratore'} — {preview}",
                    "action_url": f"/info-request-chat?id={doc['request_id']}",
                },
                idempotency_key=f"ireq-new-{doc['request_id']}",
            )
    except Exception as e:
        logger.warning(f"push on create info-request failed: {e}")
    return _info_req_out(doc)


@api_router.get("/info-requests")
async def list_info_requests(status: Optional[str] = None, contact_id: Optional[str] = None, user=Depends(get_current_user)):
    """Master vede tutte le richieste del tenant; sub-user vedono solo le proprie."""
    tid = tenant_id(user)
    q: Dict[str, Any] = {"user_id": tid}
    if not is_owner(user):
        q["created_by"] = user["user_id"]
    if status in ("pending", "resolved"):
        q["status"] = status
    if contact_id:
        q["contact_id"] = contact_id
    docs = await db.info_requests.find(q, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return {"items": [{**_info_req_out(d), "unread": _info_req_unread_for(d, user)} for d in docs]}


@api_router.get("/info-requests/count")
async def count_info_requests(user=Depends(get_current_user)):
    """Conta le richieste visibili + le non lette dall'utente corrente."""
    tid = tenant_id(user)
    q: Dict[str, Any] = {"user_id": tid}
    if not is_owner(user):
        q["created_by"] = user["user_id"]
    all_docs = await db.info_requests.find(q, {"_id": 0}).to_list(1000)
    pending = sum(1 for d in all_docs if (d.get("status") or "pending") == "pending")
    unread = sum(1 for d in all_docs if _info_req_unread_for(d, user))
    return {"pending": pending, "unread": unread}


@api_router.get("/info-requests/{request_id}")
async def get_info_request(request_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    d = await db.info_requests.find_one({"user_id": tid, "request_id": request_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if not is_owner(user) and d.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    return {**_info_req_out(d), "unread": _info_req_unread_for(d, user)}


@api_router.put("/info-requests/{request_id}")
async def update_info_request(request_id: str, body: InfoRequestUpdate, user=Depends(get_current_user)):
    """Solo il Master può segnare come risolta."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può aggiornare le richieste")
    tid = tenant_id(user)
    existing = await db.info_requests.find_one({"user_id": tid, "request_id": request_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    now = utcnow()
    update = {"status": body.status, "resolved_at": now if body.status == "resolved" else None, "updated_at": now}
    await db.info_requests.update_one({"request_id": request_id}, {"$set": update})
    updated = await db.info_requests.find_one({"request_id": request_id}, {"_id": 0})
    return _info_req_out(updated)


@api_router.delete("/info-requests/{request_id}")
async def delete_info_request(request_id: str, user=Depends(get_current_user)):
    """Master può eliminare; il creatore può eliminare la propria richiesta."""
    tid = tenant_id(user)
    existing = await db.info_requests.find_one({"user_id": tid, "request_id": request_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if not is_owner(user) and existing.get("created_by") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.info_requests.delete_one({"request_id": request_id})
    return {"ok": True}


# =========================
