# ============================================================================
# V50.z488 — Link di navigazione con COORDINATE PRECISE (Waze / Google Maps)
# ----------------------------------------------------------------------------
# POST /geo/resolve-destination {address, origin?: {lat, lon}, label?}
#   → {lat, lon, formatted, place_id, source, waze_url, waze_web_url, gmaps_url}
# La destinazione NON viene più passata come testo: Google Places API (New) `places:searchText` (bias ≤ 50 km dall'origine
# reale dell'utente, regione IT) → lat/lon precisi. Fallback (chiave assente o nessun risultato): _geocode_one (Photon/Nominatim).
# Cache 30 gg in `geocode_cache` (query normalizzata + «|places»).
#   Waze:        waze://?ll=LAT,LNG&navigate=yes        (web fallback https://www.waze.com/ul?ll=LAT,LNG&navigate=yes)
#   Google Maps: https://www.google.com/maps/dir/?api=1&origin=LAT_U,LNG_U&destination=LAT_D,LNG_D&travelmode=driving
# ============================================================================
import re as _nl_re
from typing import Optional as _nl_Optional

_NL_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"


class _NlOrigin(BaseModel):  # noqa: F821
    lat: float
    lon: float


class ResolveDestinationIn(BaseModel):  # noqa: F821
    address: str
    origin: _nl_Optional[_NlOrigin] = None
    label: _nl_Optional[str] = None


def _nl_links(dlat: float, dlon: float, origin: _nl_Optional[_NlOrigin]) -> dict:
    ll = f"{dlat:.6f},{dlon:.6f}"
    gm = f"https://www.google.com/maps/dir/?api=1&destination={ll}&travelmode=driving"
    if origin is not None:
        gm = f"https://www.google.com/maps/dir/?api=1&origin={origin.lat:.6f},{origin.lon:.6f}&destination={ll}&travelmode=driving"
    return {"waze_url": f"waze://?ll={ll}&navigate=yes", "waze_web_url": f"https://www.waze.com/ul?ll={ll}&navigate=yes", "gmaps_url": gm,
            "apple_url": f"https://maps.apple.com/?daddr={ll}&dirflg=d"}


async def _nl_places_search(address: str, origin: _nl_Optional[_NlOrigin]) -> _nl_Optional[dict]:
    key = (os.environ.get("PLACES_API_KEY") or os.environ.get("GOOGLE_PLACES_API_KEY") or "").strip()  # noqa: F821
    if not key:
        return None
    body: dict = {"textQuery": address, "languageCode": "it", "regionCode": "IT", "maxResultCount": 1}
    if origin is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": origin.lat, "longitude": origin.lon}, "radius": 50000.0}}
    try:
        async with httpx.AsyncClient(timeout=8) as cli:  # noqa: F821
            r = await cli.post(_NL_SEARCH_URL, json=body, headers={"X-Goog-Api-Key": key, "Content-Type": "application/json",
                                                                    "X-Goog-FieldMask": "places.id,places.formattedAddress,places.location,places.displayName"})
        if r.status_code != 200:
            logger.warning("[nav-links] places searchText %s: %s", r.status_code, r.text[:200])  # noqa: F821
            return None
        places = r.json().get("places") or []
        if not places:
            return None
        p = places[0]
        loc = p.get("location") or {}
        if loc.get("latitude") is None or loc.get("longitude") is None:
            return None
        return {"lat": float(loc["latitude"]), "lon": float(loc["longitude"]), "formatted": p.get("formattedAddress") or address,
                "place_id": p.get("id") or "", "source": "google_places"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[nav-links] places searchText failed: %s", exc)  # noqa: F821
        return None


async def _nl_geocoding_api(address: str, origin: _nl_Optional[_NlOrigin]) -> _nl_Optional[dict]:
    """Fallback 2: Google Geocoding API (classica) — richiede che sia abilitata sulla stessa chiave."""
    key = (os.environ.get("PLACES_API_KEY") or os.environ.get("GOOGLE_PLACES_API_KEY") or "").strip()  # noqa: F821
    if not key:
        return None
    params = {"address": address, "region": "it", "language": "it", "key": key}
    if origin is not None:
        d = 0.25  # ~25 km di bias
        params["bounds"] = f"{origin.lat - d},{origin.lon - d}|{origin.lat + d},{origin.lon + d}"
    try:
        async with httpx.AsyncClient(timeout=8) as cli:  # noqa: F821
            r = await cli.get("https://maps.googleapis.com/maps/api/geocode/json", params=params)
        j = r.json() if r.status_code == 200 else {}
        if j.get("status") != "OK" or not j.get("results"):
            if j.get("status") not in (None, "ZERO_RESULTS"):
                logger.warning("[nav-links] geocoding API %s: %s", j.get("status"), (j.get("error_message") or "")[:160])  # noqa: F821
            return None
        g = j["results"][0]
        loc = (g.get("geometry") or {}).get("location") or {}
        if loc.get("lat") is None:
            return None
        return {"lat": float(loc["lat"]), "lon": float(loc["lng"]), "formatted": g.get("formatted_address") or address, "place_id": g.get("place_id") or "", "source": "google_geocoding"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[nav-links] geocoding API failed: %s", exc)  # noqa: F821
        return None


@api_router.get("/geo/google-apis-status")  # noqa: F821
async def geo_google_apis_status(user=Depends(get_current_user)):  # noqa: F821
    """Diagnostica: quali API Google sono abilitate sulla chiave PLACES_API_KEY (Places New, Geocoding, Directions legacy, Routes)."""
    key = (os.environ.get("PLACES_API_KEY") or os.environ.get("GOOGLE_PLACES_API_KEY") or "").strip()  # noqa: F821
    out = {"key_configured": bool(key), "places_new": None, "geocoding": None, "directions_legacy": None, "routes": None, "notes": []}
    if not key:
        out["notes"].append("PLACES_API_KEY assente: destinazioni risolte con OpenStreetMap (meno precise).")
        return out
    async with httpx.AsyncClient(timeout=8) as cli:  # noqa: F821
        try:
            r = await cli.post(_NL_SEARCH_URL, json={"textQuery": "Piazza Duomo 1 Milano", "languageCode": "it", "regionCode": "IT", "maxResultCount": 1}, headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.location"})
            out["places_new"] = r.status_code == 200 and bool(r.json().get("places"))
        except Exception:
            out["places_new"] = False
        try:
            r = await cli.get("https://maps.googleapis.com/maps/api/geocode/json", params={"address": "Piazza Duomo 1 Milano", "key": key})
            st = r.json().get("status")
            out["geocoding"] = st == "OK"
            if st not in ("OK", None):
                out["notes"].append(f"Geocoding API: {st} — {(r.json().get('error_message') or '')[:140]}")
        except Exception:
            out["geocoding"] = False
        try:
            r = await cli.get("https://maps.googleapis.com/maps/api/directions/json", params={"origin": "45.4642,9.19", "destination": "45.4842,9.20", "key": key})
            st = r.json().get("status")
            out["directions_legacy"] = st == "OK"
            if st not in ("OK", None):
                out["notes"].append(f"Directions API: {st} — {(r.json().get('error_message') or '')[:140]}")
        except Exception:
            out["directions_legacy"] = False
        try:
            r = await cli.post("https://routes.googleapis.com/directions/v2:computeRoutes", json={"origin": {"location": {"latLng": {"latitude": 45.4642, "longitude": 9.19}}}, "destination": {"location": {"latLng": {"latitude": 45.4842, "longitude": 9.20}}}, "travelMode": "DRIVE"}, headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters"})
            out["routes"] = r.status_code == 200
            if r.status_code != 200:
                out["notes"].append(f"Routes API: HTTP {r.status_code} — {(r.json().get('error', {}).get('message') or '')[:140]}")
        except Exception:
            out["routes"] = False
    if out["places_new"]:
        out["notes"].insert(0, "Places API (New) attiva: le destinazioni vengono risolte in lat/lon precisi (è l'API usata dai link Waze/Google Maps).")
    else:
        out["notes"].insert(0, "Places API (New) NON risponde: abilitarla in Google Cloud Console → API e servizi → Libreria → «Places API (New)».")
    return out


@api_router.post("/geo/resolve-destination")  # noqa: F821
async def geo_resolve_destination(body: ResolveDestinationIn, user=Depends(get_current_user)):  # noqa: F821
    address = _nl_re.sub(r"\s+", " ", (body.address or "").strip())
    if len(address) < 4:
        raise HTTPException(status_code=400, detail="Indirizzo mancante")  # noqa: F821
    ck = f"{address.lower()}|places"
    hit = None
    try:
        hit = await db.geocode_cache.find_one({"query": ck}, {"_id": 0})  # noqa: F821
    except Exception:
        hit = None
    res = None
    if hit and hit.get("lat") is not None and hit.get("lon") is not None:
        res = {"lat": float(hit["lat"]), "lon": float(hit["lon"]), "formatted": hit.get("formatted") or address, "place_id": hit.get("place_id") or "", "source": hit.get("source") or "cache"}
    if res is None:
        res = await _nl_places_search(address, body.origin)
        if res is None:
            res = await _nl_geocoding_api(address, body.origin)
        if res is None:
            co = await _geocode_one(address)  # noqa: F821 — Photon / Nominatim con cache
            if co:
                res = {"lat": float(co["lat"]), "lon": float(co["lon"]), "formatted": address, "place_id": "", "source": "osm"}
        if res is None:
            raise HTTPException(status_code=404, detail="Indirizzo non trovato: controlla via, civico e città")  # noqa: F821
        try:
            await db.geocode_cache.update_one({"query": ck}, {"$set": {"query": ck, "lat": res["lat"], "lon": res["lon"], "formatted": res["formatted"], "place_id": res["place_id"], "source": res["source"], "cached_at": utcnow()}}, upsert=True)  # noqa: F821
        except Exception:
            pass
    out = {**res, "address": address, **_nl_links(res["lat"], res["lon"], body.origin)}
    if body.origin is not None:
        out["distance_km"] = round(_haversine_km(body.origin.lat, body.origin.lon, res["lat"], res["lon"]), 1)  # noqa: F821
    return out
