# geo_km_log.py — V50.z253 — «Resoconto Km» (modulo ISOLATO)
#
# Registra i km di ogni visita completata nel Giro Ottimale (spunta «Visita completata» su una tappa o sul rientro):
# i km sono quelli calcolati dal percorso (leg_km salvato in `geo_routes`), NON dal GPS reale.
# Totali per giorno / settimana (lun–dom) / mese; export PDF lato client (expo-print) per note spese.
# Persistenza: `geo_km_log` { entry_id, user_id (tenant), created_by, date 'YYYY-MM-DD', route_id, seq (0 = rientro),
#                             contact_id, contact_name, address, origin_label, km, created_at }.
# API: POST /geo/km-log {route_id, seq, date?} · DELETE /geo/km-log/{entry_id} · GET /geo/km-log?month=YYYY-MM|route_id=…

_KML_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class KmLogIn(BaseModel):
    route_id: str
    seq: int  # 1..n = tappa, 0 = rientro al punto di partenza
    date: Optional[str] = None  # YYYY-MM-DD locale del dispositivo (default: oggi UTC)


def _kml_out(e: dict) -> dict:
    e = dict(e)
    e.pop("_id", None)
    ca = e.get("created_at")
    if hasattr(ca, "isoformat"):
        e["created_at"] = ca.isoformat()
    return e


def _kml_week_range(today: str) -> Tuple[str, str]:
    d = datetime.strptime(today, "%Y-%m-%d").date()
    start = d - timedelta(days=d.weekday())
    return start.isoformat(), (start + timedelta(days=6)).isoformat()


@api_router.post("/geo/km-log")
async def kml_add(body: KmLogIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    route = await db.geo_routes.find_one({"user_id": tid, "route_id": body.route_id}, {"_id": 0})
    if not route:
        raise HTTPException(status_code=404, detail="Giro non trovato")
    if body.seq == 0:
        ret = route.get("return")
        if not ret:
            raise HTTPException(status_code=400, detail="Questo giro non prevede il rientro")
        km, contact_id, name, address = float(ret.get("leg_km") or 0), None, "Rientro", (route.get("origin") or {}).get("label") or ""
    else:
        leg = next((l for l in route.get("legs") or [] if int(l.get("seq") or -1) == body.seq), None)
        if not leg:
            raise HTTPException(status_code=404, detail="Tappa non trovata")
        km, contact_id, name = float(leg.get("leg_km") or 0), leg.get("contact_id"), leg.get("name") or leg.get("company") or "Cliente"
        address = ", ".join([x for x in [leg.get("address"), leg.get("city")] if x])
    date = body.date if body.date and _KML_DATE_RE.match(body.date) else utcnow().strftime("%Y-%m-%d")
    existing = await db.geo_km_log.find_one({"created_by": user["user_id"], "route_id": body.route_id, "seq": body.seq}, {"_id": 0})
    if existing:
        return {"entry": _kml_out(existing), "created": False}
    entry = {
        "entry_id": f"km_{uuid.uuid4().hex[:10]}", "user_id": tid, "created_by": user["user_id"], "date": date,
        "route_id": body.route_id, "seq": body.seq, "contact_id": contact_id, "contact_name": name, "address": address,
        "origin_label": (route.get("origin") or {}).get("label") or "", "km": round(km, 1), "created_at": utcnow(),
    }
    await db.geo_km_log.insert_one(dict(entry))
    # V50.z256 — la tappa completata è una visita confermata (Storico visite + ultima visita del contatto)
    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0})
        if c:
            try:
                v = await _cv_insert_visit(user, c, date=date, at=utcnow().isoformat(), km=km, notes="", source="route", stay_minutes=None,
                                           lat=(c.get("geo") or {}).get("lat"), lon=(c.get("geo") or {}).get("lon"), km_entry_id=entry["entry_id"])
                await db.geo_km_log.update_one({"entry_id": entry["entry_id"]}, {"$set": {"visit_id": v["visit_id"]}})
                entry["visit_id"] = v["visit_id"]
            except Exception as exc:  # noqa: BLE001
                logger.warning("km-log → visit failed: %s", exc)
    return {"entry": _kml_out(entry), "created": True}


@api_router.delete("/geo/km-log/{entry_id}")
async def kml_delete(entry_id: str, user=Depends(get_current_user)):
    r = await db.geo_km_log.delete_one({"created_by": user["user_id"], "entry_id": entry_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Voce non trovata")
    # V50.z256 — rimuove anche la visita collegata e ricalcola l'ultima visita del contatto
    async for v in db.contact_visits.find({"km_entry_id": entry_id}, {"_id": 0, "contact_id": 1}):
        await db.contact_visits.delete_many({"km_entry_id": entry_id})
        await _cv_recompute_last_visit(v["contact_id"])
    return {"ok": True}


@api_router.get("/geo/km-log")
async def kml_list(month: Optional[str] = None, route_id: Optional[str] = None, today: Optional[str] = None, user=Depends(get_current_user)):
    """month=YYYY-MM (default: mese corrente) → voci del mese + totali oggi/settimana/mese + per giorno.
    route_id=… → solo le voci di quel giro (per mostrare le spunte «completata» nel Giro Ottimale)."""
    uid = user["user_id"]
    if route_id:
        items = await db.geo_km_log.find({"created_by": uid, "route_id": route_id}, {"_id": 0}).to_list(200)
        return {"items": [_kml_out(e) for e in items]}
    today_s = today if today and _KML_DATE_RE.match(today) else utcnow().strftime("%Y-%m-%d")
    month_s = month if month and re.match(r"^\d{4}-\d{2}$", month) else today_s[:7]
    items = await db.geo_km_log.find({"created_by": uid, "date": {"$regex": f"^{month_s}"}}, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(2000)
    by_day: Dict[str, Dict[str, Any]] = {}
    for e in items:
        d = by_day.setdefault(e["date"], {"date": e["date"], "km": 0.0, "visits": 0})
        d["km"] = round(d["km"] + float(e.get("km") or 0), 1)
        d["visits"] += 1
    ws, we = _kml_week_range(today_s)
    # settimana e oggi possono cadere fuori dal mese selezionato → query dedicate (sempre riferite a «oggi»)
    week_items = await db.geo_km_log.find({"created_by": uid, "date": {"$gte": ws, "$lte": we}}, {"_id": 0, "km": 1, "date": 1}).to_list(500)
    cur_month_items = await db.geo_km_log.find({"created_by": uid, "date": {"$regex": f"^{today_s[:7]}"}}, {"_id": 0, "km": 1}).to_list(2000)
    totals = {
        "today_km": round(sum(float(e.get("km") or 0) for e in week_items if e.get("date") == today_s), 1),
        "today_visits": sum(1 for e in week_items if e.get("date") == today_s),
        "week_km": round(sum(float(e.get("km") or 0) for e in week_items), 1),
        "week_visits": len(week_items),
        "month_km": round(sum(float(e.get("km") or 0) for e in cur_month_items), 1),
        "month_visits": len(cur_month_items),
        "selected_month_km": round(sum(float(e.get("km") or 0) for e in items), 1),
        "selected_month_visits": len(items),
        "week_start": ws, "week_end": we, "today": today_s,
    }
    return {"month": month_s, "items": [_kml_out(e) for e in items], "by_day": sorted(by_day.values(), key=lambda x: x["date"], reverse=True), "totals": totals}
