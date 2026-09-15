# contact_visits.py — V50.z256 — Rilevamento Visite Clienti (modulo ISOLATO)
#
# • `contact_visits`: visite CONFERMATE {visit_id, user_id(tenant), created_by, contact_id, contact_name, date 'YYYY-MM-DD',
#     at (ISO), km, notes, source: route|gps|manual, stay_minutes, lat, lon, km_entry_id}. Fonte unica per «Storico visite».
# • `visit_candidates`: soste rilevate dal GPS del dispositivo (client-side geofencing: soglia permanenza + raggio da impostazioni)
#     in attesa di conferma (Tempo Reale: popup subito · Fine Giornata: recap alle HH:MM) {cand_id, created_by, contact_id, date,
#     started_at, ended_at, stay_minutes, lat, lon, status pending|confirmed|dismissed}.
# • Km: per visite da Giro Ottimale = leg_km del percorso (POST /geo/km-log, che ora crea anche la visita);
#     per visite spontanee = distanza stradale stimata (linea d'aria × 1.3) dall'ultima visita confermata del giorno
#     (o dalla posizione di partenza inviata dal client) → voce in `geo_km_log` → Resoconto Km.
# • Frequenza ripasso: contacts.revisit_every_days → GET /visits/due (in ritardo) + sezione nel prompt di AxonOS (wrapper a catena).
#
# API: GET /visits/settings · GET /visits/contact/{id} · POST /visits/confirm · DELETE /visits/{id} · GET /visits/summary
#      POST /visits/candidates (batch dal client) · GET /visits/candidates?date= · POST /visits/candidates/{id}/dismiss
#      GET /visits/nearby?lat&lon&radius_m · GET /visits/due

_VD_DEFAULT = {"enabled": False, "stay_minutes": 10, "radius_m": 150, "mode": "both", "recap_time": "18:30"}
_VD_MODES = {"realtime", "evening", "both"}


def _vd_norm(v: Any) -> dict:
    d = dict(_VD_DEFAULT)
    if isinstance(v, dict):
        d["enabled"] = bool(v.get("enabled", d["enabled"]))
        try: d["stay_minutes"] = max(1, min(int(v.get("stay_minutes", d["stay_minutes"])), 120))
        except Exception: pass
        try: d["radius_m"] = max(50, min(int(v.get("radius_m", d["radius_m"])), 1000))
        except Exception: pass
        if v.get("mode") in _VD_MODES: d["mode"] = v["mode"]
        rt = str(v.get("recap_time") or d["recap_time"])
        if re.match(r"^\d{2}:\d{2}$", rt): d["recap_time"] = rt
    return d


async def _vd_settings(uid: str) -> dict:
    s = await db.user_settings.find_one({"user_id": uid}, {"_id": 0, "visit_detection": 1}) or {}
    return _vd_norm(s.get("visit_detection"))


def _cv_out(v: dict) -> dict:
    v = dict(v); v.pop("_id", None)
    for k in ("at", "created_at", "started_at", "ended_at"):
        if hasattr(v.get(k), "isoformat"): v[k] = v[k].isoformat()
    return v


def _cv_contact_name(c: dict) -> str:
    return (f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip() or c.get("company") or "Cliente")


@api_router.get("/visits/settings")
async def visits_settings(user=Depends(get_current_user)):
    return {"visit_detection": await _vd_settings(user["user_id"])}


# ---------------- Visite confermate ----------------
class VisitConfirmIn(BaseModel):
    contact_id: str
    notes: Optional[str] = None
    date: Optional[str] = None            # YYYY-MM-DD locale (default oggi UTC)
    at: Optional[str] = None              # ISO locale dell'arrivo (default ora)
    stay_minutes: Optional[int] = None
    lat: Optional[float] = None           # posizione della sosta (per km spontanei)
    lon: Optional[float] = None
    from_lat: Optional[float] = None      # partenza esplicita (se il client la conosce)
    from_lon: Optional[float] = None
    km: Optional[float] = None            # km espliciti (override)
    source: Optional[str] = "gps"         # gps | manual
    cand_id: Optional[str] = None         # candidato GPS da chiudere


async def _cv_insert_visit(user: dict, contact: dict, *, date: str, at: Any, km: float, notes: str, source: str,
                           stay_minutes: Optional[int], lat: Optional[float], lon: Optional[float], km_entry_id: Optional[str]) -> dict:
    v = {
        "visit_id": f"vis_{uuid.uuid4().hex[:10]}", "user_id": tenant_id(user), "created_by": user["user_id"],
        "contact_id": contact["contact_id"], "contact_name": _cv_contact_name(contact), "date": date, "at": at,
        "km": round(float(km or 0), 1), "notes": (notes or "").strip()[:1000], "source": source, "stay_minutes": stay_minutes,
        "lat": lat, "lon": lon, "km_entry_id": km_entry_id, "created_at": utcnow(),
    }
    await db.contact_visits.insert_one(dict(v))
    await db.contacts.update_one({"contact_id": contact["contact_id"]}, {"$set": {"last_visit_at": at if isinstance(at, str) else utcnow().isoformat(), "last_visit_date": date}})
    return v


@api_router.post("/visits/confirm")
async def visits_confirm(body: VisitConfirmIn, user=Depends(get_current_user)):
    """Conferma una visita spontanea/GPS: crea la visita, calcola i km (stima stradale) e li registra nel Resoconto Km."""
    tid = tenant_id(user)
    c = await db.contacts.find_one({"contact_id": body.contact_id, "user_id": tid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contatto non trovato")
    date = body.date if body.date and re.match(r"^\d{4}-\d{2}-\d{2}$", body.date) else utcnow().strftime("%Y-%m-%d")
    at = body.at or utcnow().isoformat()
    geo = c.get("geo") or {}
    lat = body.lat if body.lat is not None else geo.get("lat")
    lon = body.lon if body.lon is not None else geo.get("lon")
    # Km: esplicito → dal punto di partenza indicato → dall'ultima visita confermata del giorno (stessa persona) → 0
    km = float(body.km) if body.km is not None else 0.0
    if body.km is None and lat is not None and lon is not None:
        origin = None
        if body.from_lat is not None and body.from_lon is not None:
            origin = (body.from_lat, body.from_lon)
        else:
            prev = await db.contact_visits.find({"created_by": user["user_id"], "date": date, "lat": {"$ne": None}, "at": {"$lt": at}}, {"_id": 0, "lat": 1, "lon": 1, "at": 1}).sort("at", -1).to_list(1)
            if prev and prev[0].get("lat") is not None:
                origin = (prev[0]["lat"], prev[0]["lon"])
        if origin:
            km = round(_geo_haversine(origin, (lat, lon)) * _GEO_ROAD_FACTOR, 1)
    km_entry_id = None
    if km > 0:
        entry = {
            "entry_id": f"km_{uuid.uuid4().hex[:10]}", "user_id": tid, "created_by": user["user_id"], "date": date,
            "route_id": None, "seq": None, "contact_id": c["contact_id"], "contact_name": _cv_contact_name(c),
            "address": _geo_contact_address(c), "origin_label": "Visita rilevata" if body.source == "gps" else "Visita manuale",
            "km": km, "created_at": utcnow(),
        }
        await db.geo_km_log.insert_one(dict(entry)); km_entry_id = entry["entry_id"]
    v = await _cv_insert_visit(user, c, date=date, at=at, km=km, notes=body.notes or "", source=body.source or "gps",
                               stay_minutes=body.stay_minutes, lat=lat, lon=lon, km_entry_id=km_entry_id)
    if body.cand_id:
        await db.visit_candidates.update_one({"cand_id": body.cand_id, "created_by": user["user_id"]}, {"$set": {"status": "confirmed", "visit_id": v["visit_id"]}})
    return {"visit": _cv_out(v)}


@api_router.delete("/visits/{visit_id}")
async def visits_delete(visit_id: str, user=Depends(get_current_user)):
    v = await db.contact_visits.find_one({"visit_id": visit_id, "created_by": user["user_id"]}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Visita non trovata")
    await db.contact_visits.delete_one({"visit_id": visit_id})
    if v.get("km_entry_id"):
        await db.geo_km_log.delete_one({"entry_id": v["km_entry_id"]})
    await _cv_recompute_last_visit(v["contact_id"])
    return {"ok": True}


async def _cv_recompute_last_visit(contact_id: str) -> None:
    last = await db.contact_visits.find({"contact_id": contact_id}, {"_id": 0, "at": 1, "date": 1}).sort("at", -1).to_list(1)
    if last:
        await db.contacts.update_one({"contact_id": contact_id}, {"$set": {"last_visit_at": last[0]["at"], "last_visit_date": last[0].get("date")}})
    else:
        await db.contacts.update_one({"contact_id": contact_id}, {"$unset": {"last_visit_at": "", "last_visit_date": ""}})


@api_router.get("/visits/contact/{contact_id}")
async def visits_by_contact(contact_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user)
    items = await db.contact_visits.find({"user_id": tid, "contact_id": contact_id}, {"_id": 0}).sort("at", -1).to_list(300)
    c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "revisit_every_days": 1, "last_visit_at": 1})
    return {"items": [_cv_out(v) for v in items], "total_km": round(sum(float(v.get("km") or 0) for v in items), 1),
            "revisit_every_days": (c or {}).get("revisit_every_days"), "last_visit_at": (c or {}).get("last_visit_at")}


@api_router.get("/visits/summary")
async def visits_summary(user=Depends(get_current_user)):
    """Ultima visita per contatto (tenant) → filtro «non visitati da» e pallino arancione nel Giro Ottimale."""
    tid = tenant_id(user)
    out: Dict[str, dict] = {}
    async for v in db.contact_visits.find({"user_id": tid}, {"_id": 0, "contact_id": 1, "at": 1}).sort("at", -1):
        cid = v["contact_id"]
        if cid not in out:
            out[cid] = {"last_at": v["at"], "count": 0}
        out[cid]["count"] += 1
    return {"by_contact": out}


@api_router.get("/visits/due")
async def visits_due(user=Depends(get_current_user)):
    """Clienti con «Frequenza ripasso» impostata e ultima visita più vecchia della cadenza (o mai visitati)."""
    return {"items": await _cv_due_list(tenant_id(user), 50)}


async def _cv_due_list(tid: str, limit: int) -> List[dict]:
    now = utcnow()
    out: List[dict] = []
    async for c in db.contacts.find({"user_id": tid, "revisit_every_days": {"$gt": 0}}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "revisit_every_days": 1, "last_visit_at": 1, "address_city": 1}):
        every = int(c.get("revisit_every_days") or 0)
        last = c.get("last_visit_at")
        days_since = None
        if last:
            try:
                dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
                days_since = (now - dt).days
            except Exception:
                days_since = None
        overdue = days_since is None or days_since >= every
        if overdue:
            out.append({"contact_id": c["contact_id"], "name": _cv_contact_name(c), "city": c.get("address_city") or "", "every_days": every,
                        "days_since": days_since, "overdue_days": (days_since - every) if days_since is not None else None})
    out.sort(key=lambda x: -(x["overdue_days"] if x["overdue_days"] is not None else 10_000))
    return out[:limit]


# ---------------- Candidati GPS (soste rilevate dal dispositivo) ----------------
class VisitCandidateIn(BaseModel):
    contact_id: str
    started_at: str
    ended_at: Optional[str] = None
    stay_minutes: int
    lat: Optional[float] = None
    lon: Optional[float] = None
    date: Optional[str] = None


@api_router.post("/visits/candidates")
async def visits_candidates_add(body: List[VisitCandidateIn], user=Depends(get_current_user)):
    """Il client invia le soste rilevate (≥ soglia permanenza, entro il raggio). Dedup: stesso contatto+giorno+started_at."""
    uid = user["user_id"]; tid = tenant_id(user)
    created: List[dict] = []
    for b in body[:50]:
        date = b.date if b.date and re.match(r"^\d{4}-\d{2}-\d{2}$", b.date) else utcnow().strftime("%Y-%m-%d")
        if await db.visit_candidates.find_one({"created_by": uid, "contact_id": b.contact_id, "date": date, "started_at": b.started_at}):
            continue
        c = await db.contacts.find_one({"contact_id": b.contact_id}, {"_id": 0, "first_name": 1, "last_name": 1, "company": 1, "address_city": 1})
        cand = {"cand_id": f"vc_{uuid.uuid4().hex[:10]}", "user_id": tid, "created_by": uid, "contact_id": b.contact_id,
                "contact_name": _cv_contact_name(c or {}), "city": (c or {}).get("address_city") or "", "date": date,
                "started_at": b.started_at, "ended_at": b.ended_at, "stay_minutes": int(b.stay_minutes), "lat": b.lat, "lon": b.lon,
                "status": "pending", "created_at": utcnow()}
        await db.visit_candidates.insert_one(dict(cand)); created.append(_cv_out(cand))
    return {"created": created}


@api_router.get("/visits/candidates")
async def visits_candidates_list(date: Optional[str] = None, status: str = "pending", user=Depends(get_current_user)):
    q: Dict[str, Any] = {"created_by": user["user_id"]}
    if status != "all": q["status"] = status
    if date and re.match(r"^\d{4}-\d{2}-\d{2}$", date): q["date"] = date
    items = await db.visit_candidates.find(q, {"_id": 0}).sort("started_at", 1).to_list(200)
    return {"items": [_cv_out(x) for x in items]}


@api_router.post("/visits/candidates/{cand_id}/dismiss")
async def visits_candidates_dismiss(cand_id: str, user=Depends(get_current_user)):
    r = await db.visit_candidates.update_one({"cand_id": cand_id, "created_by": user["user_id"]}, {"$set": {"status": "dismissed"}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Sosta non trovata")
    return {"ok": True}


@api_router.get("/visits/nearby")
async def visits_nearby(lat: float, lon: float, radius_m: Optional[int] = None, user=Depends(get_current_user)):
    """Clienti geocodificati entro il raggio (default: impostazioni utente). Più clienti → tutti, ordinati per distanza."""
    tid = tenant_id(user)
    r_m = radius_m or (await _vd_settings(user["user_id"]))["radius_m"]
    out: List[dict] = []
    async for c in db.contacts.find({"user_id": tid, "geo.lat": {"$ne": None}}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "geo": 1, "address_city": 1}):
        g = c.get("geo") or {}
        if g.get("lat") is None or g.get("lon") is None: continue
        d_m = _geo_haversine((lat, lon), (g["lat"], g["lon"])) * 1000
        if d_m <= r_m:
            out.append({"contact_id": c["contact_id"], "name": _cv_contact_name(c), "city": c.get("address_city") or "", "distance_m": int(d_m), "lat": g["lat"], "lon": g["lon"]})
    out.sort(key=lambda x: x["distance_m"])
    return {"items": out[:10], "radius_m": r_m}


# ---------------- Wrapper a catena: promemoria ripasso nel prompt di AxonOS ----------------
_cv_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _cv_prev_prepare_prompt(user, body)
    try:
        if prep.get("system_message"):
            due = await _cv_due_list(tenant_id(user), 8)
            if due:
                rows = "; ".join(f"{d['name']}" + (f" ({d['city']})" if d['city'] else "") + (f" — ripasso ogni {d['every_days']} gg, " + (f"ultima visita {d['days_since']} gg fa" if d['days_since'] is not None else "mai visitato")) for d in due)
                prep["system_message"] += ("\n\n🔁 RIPASSI CLIENTI IN RITARDO (frequenza ripasso impostata nella scheda; visite confermate dal Rilevamento Visite / Giro Ottimale): "
                                           + rows + ". Se pertinente, proponi proattivamente di pianificarli (Giro Ottimale) o di fissare un appuntamento; non elencarli tutti a ogni messaggio.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[contact_visits] prompt suffix failed: %s", exc)
    return prep
