# axon_geo_routing.py — V50.z240 — FEAT-GEO-001 Fase 1: Mappa Clienti + Giro Ottimale.
# GET /geo/contacts-map?scope=mine|team → contatti geocodificati (cache in contacts.geo {lat,lon,at}); Nominatim/Open-Meteo via _geocode_one
# (riuso 07_contacts), max 12 geocoding nuovi per chiamata (rate-limit OSM 1 req/s), il resto si completa alle chiamate successive.
# POST /geo/optimal-route → nearest-neighbor + 2-opt (Haversine × 1.3 fattore stradale, 45 km/h, sosta 15 min), max 10 tappe.
import math as _geo_math

_GEO_ROAD_FACTOR = 1.3
_GEO_SPEED_KMH = 45.0
_GEO_STOP_MIN = 15
_GEO_MAX_STOPS = 10
_GEO_MAX_NEW_GEOCODES = 12


def _geo_haversine(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    R = 6371.0
    la1, lo1, la2, lo2 = map(_geo_math.radians, (a[0], a[1], b[0], b[1]))
    h = _geo_math.sin((la2 - la1) / 2) ** 2 + _geo_math.cos(la1) * _geo_math.cos(la2) * _geo_math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * _geo_math.asin(_geo_math.sqrt(h))


def _geo_contact_address(c: dict) -> str:
    struct = ", ".join([p for p in [c.get("address_street"), " ".join([x for x in [c.get("address_zip"), c.get("address_city")] if x]).strip(), c.get("address_province")] if p]).strip()
    return struct or (c.get("address") or "").strip() or (c.get("work_address") or "").strip() or (c.get("residence_address") or "").strip()


def _geo_contact_name(c: dict) -> str:
    n = " ".join([x for x in [c.get("first_name"), c.get("last_name")] if x]).strip()
    return n or (c.get("company") or c.get("name") or "Contatto")


def _geo_out_contact(c: dict, geo: dict, members: Dict[str, str]) -> dict:
    return {"contact_id": c["contact_id"], "name": _geo_contact_name(c), "company": c.get("company") or "", "status": c.get("status") or "client",
            "phone": c.get("phone") or c.get("mobile") or "", "email": c.get("email") or "", "address": _geo_contact_address(c),
            "city": c.get("address_city") or "", "area": c.get("area") or "", "lat": geo.get("lat"), "lon": geo.get("lon"),
            "owner_id": c.get("created_by"), "owner_name": members.get(c.get("created_by") or "", "")}


async def _geo_members(tid: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    async for u in db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}):
        out[u["user_id"]] = (u.get("name") or (u.get("email") or "").split("@")[0] or "").strip()
    return out


@api_router.get("/geo/contacts-map")
async def geo_contacts_map(scope: str = "mine", user=Depends(get_current_user)):
    tid = tenant_id(user)
    team = scope == "team" and is_admin_or_owner(user)
    q: Dict[str, Any] = {"user_id": tid}
    if not team:
        q["created_by"] = user["user_id"]
    members = await _geo_members(tid)
    items, pending, new_geocodes = [], 0, 0
    async for c in db.contacts.find(q, {"_id": 0}).limit(600):
        addr = _geo_contact_address(c)
        geo = c.get("geo") or {}
        if not addr:
            items.append(_geo_out_contact(c, {}, members)); continue
        if geo.get("addr") != addr or ("lat" not in geo):
            if new_geocodes >= _GEO_MAX_NEW_GEOCODES:
                pending += 1; items.append(_geo_out_contact(c, {}, members)); continue
            new_geocodes += 1
            coords = await _geocode_one(addr)
            geo = {"addr": addr, "lat": (coords or {}).get("lat"), "lon": (coords or {}).get("lon"), "at": utcnow()}
            await db.contacts.update_one({"contact_id": c["contact_id"]}, {"$set": {"geo": geo}})
        items.append(_geo_out_contact(c, geo, members))
    located = [i for i in items if i["lat"] is not None]
    office = None
    ts = await db.settings.find_one({"user_id": tid}, {"_id": 0, "office_address": 1}) or {}
    if ts.get("office_address"):
        oc = await _geocode_one(ts["office_address"])
        if oc:
            office = {"address": ts["office_address"], **oc}
    return {"items": items, "located": len(located), "without_address": len([i for i in items if not i["address"]]),
            "pending_geocode": pending, "team_allowed": is_admin_or_owner(user), "members": members, "office": office}


class GeoRouteIn(BaseModel):
    contact_ids: List[str] = Field(min_length=1, max_length=_GEO_MAX_STOPS)
    origin_lat: Optional[float] = None
    origin_lon: Optional[float] = None
    origin_address: Optional[str] = None
    return_to_origin: bool = True


def _geo_route_len(order: List[int], d: List[List[float]], back: bool) -> float:
    tot = sum(d[order[i]][order[i + 1]] for i in range(len(order) - 1))
    return tot + (d[order[-1]][0] if back else 0.0)


def _geo_optimize(d: List[List[float]], back: bool) -> List[int]:
    """Nearest-neighbor da 0 (partenza) + 2-opt. Indici 1..n = tappe."""
    n = len(d) - 1
    order, left = [0], set(range(1, n + 1))
    while left:
        cur = order[-1]
        nxt = min(left, key=lambda j: d[cur][j])
        order.append(nxt); left.remove(nxt)
    improved = True
    while improved and n > 2:
        improved = False
        for i in range(1, n):
            for j in range(i + 1, n + 1):
                cand = order[:i] + order[i:j + 1][::-1] + order[j + 1:]
                if _geo_route_len(cand, d, back) + 1e-9 < _geo_route_len(order, d, back):
                    order, improved = cand, True
    return order


@api_router.post("/geo/optimal-route")
async def geo_optimal_route(body: GeoRouteIn, user=Depends(get_current_user)):
    tid = tenant_id(user)
    origin: Optional[Dict[str, Any]] = None
    if body.origin_lat is not None and body.origin_lon is not None:
        origin = {"lat": body.origin_lat, "lon": body.origin_lon, "label": "Posizione attuale"}
    else:
        addr = (body.origin_address or "").strip()
        if not addr:
            ts = await db.settings.find_one({"user_id": tid}, {"_id": 0, "office_address": 1}) or {}
            addr = ts.get("office_address") or ""
        if not addr:
            raise HTTPException(status_code=400, detail="Nessun punto di partenza: attiva il GPS, imposta l'indirizzo ufficio in Impostazioni o scrivi un indirizzo")
        oc = await _geocode_one(addr)
        if not oc:
            raise HTTPException(status_code=400, detail=f"Indirizzo di partenza non trovato: {addr}")
        origin = {**oc, "label": addr}
    members = await _geo_members(tid)
    stops, skipped = [], []
    async for c in db.contacts.find({"user_id": tid, "contact_id": {"$in": body.contact_ids}}, {"_id": 0}):
        addr = _geo_contact_address(c)
        geo = c.get("geo") or {}
        if addr and (geo.get("addr") != addr or geo.get("lat") is None):
            coords = await _geocode_one(addr)
            geo = {"addr": addr, "lat": (coords or {}).get("lat"), "lon": (coords or {}).get("lon"), "at": utcnow()}
            await db.contacts.update_one({"contact_id": c["contact_id"]}, {"$set": {"geo": geo}})
        out = _geo_out_contact(c, geo, members)
        (stops if out["lat"] is not None else skipped).append(out)
    if not stops:
        raise HTTPException(status_code=400, detail="Nessuno dei contatti selezionati ha un indirizzo geocodificabile")
    pts = [(origin["lat"], origin["lon"])] + [(s["lat"], s["lon"]) for s in stops]
    d = [[_geo_haversine(a, b) * _GEO_ROAD_FACTOR for b in pts] for a in pts]
    order = _geo_optimize(d, body.return_to_origin)
    legs, tot_km, tot_min, prev = [], 0.0, 0, 0
    for seq, idx in enumerate(order[1:], start=1):
        km = d[prev][idx]; mins = int(round(km / _GEO_SPEED_KMH * 60))
        tot_km += km; tot_min += mins
        legs.append({**stops[idx - 1], "seq": seq, "leg_km": round(km, 1), "leg_min": mins, "cum_km": round(tot_km, 1), "cum_min": tot_min})
        prev = idx
    ret = None
    if body.return_to_origin:
        km = d[prev][0]; mins = int(round(km / _GEO_SPEED_KMH * 60)); tot_km += km; tot_min += mins
        ret = {"leg_km": round(km, 1), "leg_min": mins}
    doc = {"route_id": f"rt_{uuid.uuid4().hex[:10]}", "user_id": tid, "created_by": user["user_id"], "created_at": utcnow(),
           "origin": origin, "legs": legs, "return": ret, "skipped": skipped, "total_km": round(tot_km, 1), "drive_min": tot_min,
           "stop_min": _GEO_STOP_MIN * len(legs), "total_min": tot_min + _GEO_STOP_MIN * len(legs)}
    await db.geo_routes.insert_one(dict(doc))
    doc.pop("_id", None); doc["created_at"] = doc["created_at"].isoformat()
    return doc


# ── V50.z241 — Fase 3: distanze «da te» (GPS) o «dall'ufficio» per scheda contatto e agenda ─────────────────────────
class GeoDistTarget(BaseModel):
    id: str
    contact_id: Optional[str] = None
    address: Optional[str] = None


class GeoDistancesFromIn(BaseModel):
    origin_lat: Optional[float] = None
    origin_lon: Optional[float] = None
    targets: List[GeoDistTarget] = Field(default_factory=list, max_length=60)


@api_router.post("/geo/distances-from")
async def geo_distances_from(body: GeoDistancesFromIn, user=Depends(get_current_user)):
    """Origine = GPS (origin_lat/lon) se presente, altrimenti indirizzo ufficio del tenant.
    Ogni target: coordinate del contatto (cache contacts.geo o geocoding dell'indirizzo migliore) oppure `address` libero.
    Risposta: {origin: {kind: gps|office, label} | None, results: {id: {km, min} | None}}."""
    tid = tenant_id(user)
    origin: Optional[Dict[str, Any]] = None
    if body.origin_lat is not None and body.origin_lon is not None:
        origin = {"kind": "gps", "label": "da te", "lat": body.origin_lat, "lon": body.origin_lon}
    else:
        ts = await db.settings.find_one({"user_id": tid}, {"_id": 0, "office_address": 1}) or {}
        if ts.get("office_address"):
            oc = await _geocode_one(ts["office_address"])
            if oc:
                origin = {"kind": "office", "label": "dall'ufficio", **oc}
    if not origin:
        return {"origin": None, "results": {}}
    results: Dict[str, Optional[Dict[str, Any]]] = {}
    cids = [t.contact_id for t in body.targets if t.contact_id]
    contacts: Dict[str, dict] = {}
    if cids:
        async for c in db.contacts.find({"user_id": tid, "contact_id": {"$in": cids}}, {"_id": 0}):
            contacts[c["contact_id"]] = c
    new_geocodes = 0
    for t in body.targets:
        coords: Optional[Dict[str, float]] = None
        c = contacts.get(t.contact_id or "")
        if c:
            addr = _best_addr_for_contact(c) or _geo_contact_address(c)
            geo = c.get("geo") or {}
            if addr and geo.get("addr") == addr and geo.get("lat") is not None:
                coords = {"lat": geo["lat"], "lon": geo["lon"]}
            elif addr and new_geocodes < _GEO_MAX_NEW_GEOCODES:
                new_geocodes += 1
                coords = await _geocode_one(addr)
                await db.contacts.update_one({"contact_id": c["contact_id"]}, {"$set": {"geo": {"addr": addr, "lat": (coords or {}).get("lat"), "lon": (coords or {}).get("lon"), "at": utcnow()}}})
        elif (t.address or "").strip() and new_geocodes < _GEO_MAX_NEW_GEOCODES:
            new_geocodes += 1
            coords = await _geocode_one(t.address.strip())
        if not coords or coords.get("lat") is None:
            results[t.id] = None
            continue
        km = _geo_haversine((origin["lat"], origin["lon"]), (coords["lat"], coords["lon"])) * _GEO_ROAD_FACTOR
        results[t.id] = {"km": round(km, 1), "min": int(round(km / _GEO_SPEED_KMH * 60))}
    return {"origin": {"kind": origin["kind"], "label": origin["label"]}, "results": results}
