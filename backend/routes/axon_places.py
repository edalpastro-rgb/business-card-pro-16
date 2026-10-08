# axon_places.py — V50.z469 — Feature 6/15: Google Places autocomplete indirizzi — modulo ISOLATO
#
# La chiave `GOOGLE_PLACES_API_KEY` resta SOLO lato server: l'app chiama questi endpoint (bearer utente) e il backend parla con
# Google Places API (New). Usato da: anagrafica contatti (`contact/new`), appuntamenti (`appointment/new`), onboarding/anagrafica Master.
#   GET /places/autocomplete?q=via roma 10 tre&session=<uuid>  → {suggestions:[{place_id, text, main, secondary}], enabled}
#   GET /places/details?place_id=…&session=<uuid>               → {formatted, street, number, zip, city, province, country, lat, lon}
# `session` (token di sessione Places) riduce il costo: autocomplete + details nella stessa sessione = 1 sola fatturazione.

import os as _plc_os
import time as _plc_time

_PLC_KEY = (_plc_os.environ.get("GOOGLE_PLACES_API_KEY") or "").strip()
_PLC_AC_URL = "https://places.googleapis.com/v1/places:autocomplete"
_PLC_DET_URL = "https://places.googleapis.com/v1/places/{pid}"
_plc_cache: Dict[str, Tuple[float, dict]] = {}  # chiave → (ts, payload) — cache 10 min (stesse digitazioni ripetute)
_PLC_CACHE_TTL = 600


def _plc_cached(key: str) -> Optional[dict]:
    hit = _plc_cache.get(key)
    if hit and _plc_time.time() - hit[0] < _PLC_CACHE_TTL:
        return hit[1]
    return None


def _plc_store(key: str, val: dict) -> dict:
    if len(_plc_cache) > 2000:
        _plc_cache.clear()
    _plc_cache[key] = (_plc_time.time(), val)
    return val


def _plc_parse_components(comps: List[dict]) -> dict:
    out = {"street": "", "number": "", "zip": "", "city": "", "province": "", "country": ""}
    locality, admin3 = "", ""
    for c in comps or []:
        types = set(c.get("types") or [])
        long_t, short_t = c.get("longText") or "", c.get("shortText") or ""
        if "route" in types:
            out["street"] = long_t
        elif "street_number" in types:
            out["number"] = long_t
        elif "postal_code" in types:
            out["zip"] = long_t
        elif "locality" in types:
            locality = long_t
        elif "administrative_area_level_3" in types:
            admin3 = long_t
        elif "administrative_area_level_2" in types:
            out["province"] = (short_t or long_t)[:2].upper() if len(short_t or "") <= 3 else (short_t or long_t)
        elif "country" in types:
            out["country"] = short_t or long_t
    out["city"] = locality or admin3
    # Province italiane: Google per le città metropolitane dà «Città Metropolitana di Milano» (shortText «MI») → già gestito; altrove shortText = sigla
    return out


@api_router.get("/places/autocomplete")
async def places_autocomplete(q: str = "", session: str = "", user=Depends(get_current_user)):
    q = (q or "").strip()
    if not _PLC_KEY:
        return {"enabled": False, "suggestions": [], "reason": "GOOGLE_PLACES_API_KEY non configurata"}
    if len(q) < 3:
        return {"enabled": True, "suggestions": []}
    ck = f"ac:{q.lower()}"
    cached = _plc_cached(ck)
    if cached:
        return cached
    body = {"input": q, "languageCode": "it", "regionCode": "IT", "includedRegionCodes": ["it"]}
    if session:
        body["sessionToken"] = session[:64]
    try:
        async with httpx.AsyncClient(timeout=8) as cli:
            r = await cli.post(_PLC_AC_URL, json=body, headers={"X-Goog-Api-Key": _PLC_KEY, "Content-Type": "application/json"})
        if r.status_code != 200:
            logger.warning("[places] autocomplete %s: %s", r.status_code, r.text[:200])
            raise HTTPException(status_code=502, detail="Servizio indirizzi non disponibile")
        sugg = []
        for s in (r.json().get("suggestions") or [])[:6]:
            p = s.get("placePrediction") or {}
            if not p.get("placeId"):
                continue
            sf = p.get("structuredFormat") or {}
            sugg.append({"place_id": p["placeId"], "text": (p.get("text") or {}).get("text") or "", "main": (sf.get("mainText") or {}).get("text") or "", "secondary": (sf.get("secondaryText") or {}).get("text") or ""})
        return _plc_store(ck, {"enabled": True, "suggestions": sugg})
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("[places] autocomplete failed: %s", exc)
        raise HTTPException(status_code=502, detail="Servizio indirizzi non raggiungibile")


@api_router.get("/places/details")
async def places_details(place_id: str, session: str = "", user=Depends(get_current_user)):
    if not _PLC_KEY:
        raise HTTPException(status_code=503, detail="GOOGLE_PLACES_API_KEY non configurata")
    pid = re.sub(r"[^A-Za-z0-9_\-]", "", place_id or "")[:200]
    if not pid:
        raise HTTPException(status_code=400, detail="place_id mancante")
    ck = f"det:{pid}"
    cached = _plc_cached(ck)
    if cached:
        return cached
    params = {"languageCode": "it", "regionCode": "IT"}
    if session:
        params["sessionToken"] = session[:64]
    try:
        async with httpx.AsyncClient(timeout=8) as cli:
            r = await cli.get(_PLC_DET_URL.format(pid=pid), params=params, headers={"X-Goog-Api-Key": _PLC_KEY, "X-Goog-FieldMask": "id,formattedAddress,addressComponents,location"})
        if r.status_code != 200:
            logger.warning("[places] details %s: %s", r.status_code, r.text[:200])
            raise HTTPException(status_code=502, detail="Dettaglio indirizzo non disponibile")
        d = r.json()
        parts = _plc_parse_components(d.get("addressComponents") or [])
        loc = d.get("location") or {}
        out = {"place_id": pid, "formatted": d.get("formattedAddress") or "", **parts, "lat": loc.get("latitude"), "lon": loc.get("longitude")}
        return _plc_store(ck, out)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("[places] details failed: %s", exc)
        raise HTTPException(status_code=502, detail="Servizio indirizzi non raggiungibile")


_OMNI_EXTRA_SECTIONS.append((
    "Autocompletamento indirizzi (Google Places)", "/places/autocomplete",
    "Nei moduli Nuovo contatto, Nuovo appuntamento e Anagrafica Master c'è il campo «Cerca indirizzo»: digitando almeno 3 lettere compaiono i "
    "suggerimenti Google; toccandone uno vengono compilati via, civico, CAP, città e provincia. I campi restano modificabili a mano.",
))
