# axon_route_rescan.py — V50.z508 — RISCANSIONE AUTOMATICA DELLE ROUTE a ogni aggiornamento dell'app.
# A ogni avvio del backend (= ogni deploy/riavvio del container) il sistema rilegge l'elenco REALE delle schermate:
#   • in produzione dal manifest `backend/routes_manifest.json` generato da build_package.sh scansionando frontend/app/**.tsx
#     (il container non ha i sorgenti del frontend);
#   • in sviluppo direttamente dal file-system di expo-router (frontend/app).
# Confronta con l'ultima scansione salvata (db.axon_route_manifest), registra le route aggiunte/rimosse, aggiorna in place:
#   _NAV_REAL_PATHS (nav guard: validazione/riparazione dei marker), _ST_ROUTE_CACHE (stress test), mappa deep link (cache),
# e avvisa i Master se qualcosa è cambiato. Endpoint: GET /axon/routes/manifest · POST /axon/routes/rescan (owner).
import json as _rr_json
import os as _rr_os
from datetime import datetime as _rr_dt

_RR_MANIFEST = _rr_os.path.normpath(_rr_os.path.join(_rr_os.path.dirname(_rr_os.path.abspath(__file__)), "..", "routes_manifest.json"))
_RR_STATE: dict = {"routes": None, "source": None, "tag": None, "scanned_at": None, "added": [], "removed": []}


def _rr_scan_fs() -> set:
    routes = set()
    base = _ST_FRONT_APP  # noqa: F821
    for root, _dirs, files in _rr_os.walk(base):
        for fn in files:
            if not fn.endswith(".tsx") or fn.startswith("_") or fn.startswith("+"):
                continue
            rel = _rr_os.path.relpath(_rr_os.path.join(root, fn), base)[:-4]
            parts = [p for p in rel.split(_rr_os.sep) if not (p.startswith("(") and p.endswith(")"))]
            if parts and parts[-1] == "index":
                parts = parts[:-1]
            routes.add("/" + "/".join(parts))
    return routes


def _rr_load() -> tuple:
    """(routes:set, source:str, tag:str|None) — manifest del pacchetto se presente (produzione), altrimenti file-system (sviluppo)."""
    fs = _rr_scan_fs()
    if fs:
        return fs, "filesystem", None
    if _rr_os.path.exists(_RR_MANIFEST):
        try:
            with open(_RR_MANIFEST, encoding="utf-8") as f:
                m = _rr_json.load(f)
            return set(m.get("routes") or []), "manifest", m.get("tag")
        except Exception as e:  # noqa: BLE001
            logger.warning("[route-rescan] manifest non leggibile: %s", e)  # noqa: F821
    return {e["route"].split("?")[0] for e in APP_MAP}, "app_map", None  # noqa: F821


def _rr_apply(routes: set) -> None:
    """Aggiorna in place le strutture usate dal nav guard, dallo stress test e dalla mappa deep link."""
    dyn = {"/" + r.strip("/").split("/[")[0] + "/" for r in routes if "[" in r}  # /contact/[id] → prefisso /contact/
    static = {r for r in routes if "[" not in r}
    _NAV_REAL_PATHS.clear(); _NAV_REAL_PATHS.update(static)  # noqa: F821
    _NAV_REAL_PATHS.update(p.rstrip("/") for p in dyn)  # noqa: F821 — anche il prefisso nudo è una schermata valida (es. /contact)
    _ST_ROUTE_CACHE["set"] = set(static) | {p.rstrip("/") for p in dyn}  # noqa: F821
    try:
        _dl_invalidate()  # noqa: F821
    except Exception:  # noqa: BLE001
        pass


async def _rr_rescan(reason: str = "startup") -> dict:
    routes, source, tag = _rr_load()
    prev = await db.axon_route_manifest.find_one({}, {"_id": 0}, sort=[("scanned_at", -1)])  # noqa: F821
    prev_set = set((prev or {}).get("routes") or [])
    added = sorted(routes - prev_set) if prev else []
    removed = sorted(prev_set - routes) if prev else []
    _rr_apply(routes)
    _RR_STATE.update({"routes": sorted(routes), "source": source, "tag": tag, "scanned_at": utcnow(), "added": added, "removed": removed})  # noqa: F821
    changed = bool(added or removed) or not prev
    if changed:
        await db.axon_route_manifest.insert_one({"routes": sorted(routes), "source": source, "tag": tag, "reason": reason, "added": added, "removed": removed, "scanned_at": utcnow()})  # noqa: F821
    logger.info("[route-rescan] %s: %d route (%s%s) +%d −%d", reason, len(routes), source, f", tag {tag}" if tag else "", len(added), len(removed))  # noqa: F821
    if prev and (added or removed):
        # avviso ai Master: la mappa deep link di Axon è stata aggiornata
        try:
            msg = f"Aggiornamento app rilevato: mappa deep link di Axon riscansionata ({len(routes)} schermate)." + (f" Nuove: {', '.join(added[:6])}." if added else "") + (f" Rimosse: {', '.join(removed[:6])}." if removed else "")
            async for owner in db.users.find({"$or": [{"parent_user_id": None}, {"parent_user_id": {"$exists": False}}], "role": {"$in": ["master", "owner", "admin", None]}}, {"_id": 0, "user_id": 1}).limit(20):  # noqa: F821
                await axon_notify(owner["user_id"], owner["user_id"], "axon_message", "🗺️ Deep link Axon aggiornati", msg, deeplink="/axon-stress-report",  # noqa: F821
                                  dedupe_key=f"route-rescan-{tag or _RR_STATE['scanned_at'].strftime('%Y%m%d%H%M')}", team_copy=False)
        except Exception as e:  # noqa: BLE001
            logger.warning("[route-rescan] notify failed: %s", e)  # noqa: F821
    return {"routes": len(routes), "source": source, "tag": tag, "added": added, "removed": removed, "changed": changed}


@app.on_event("startup")  # noqa: F821
async def _rr_startup():
    try:
        await _rr_rescan("startup")
    except Exception as e:  # noqa: BLE001
        logger.warning("[route-rescan] startup failed: %s", e)  # noqa: F821


@api_router.get("/axon/routes/manifest")  # noqa: F821
async def axon_routes_manifest(user=Depends(get_current_user)):  # noqa: F821
    _st_require_owner(user)  # noqa: F821
    return {**_RR_STATE, "manifest_file": _RR_MANIFEST if _rr_os.path.exists(_RR_MANIFEST) else None}


@api_router.post("/axon/routes/rescan")  # noqa: F821
async def axon_routes_rescan(user=Depends(get_current_user)):  # noqa: F821
    _st_require_owner(user)  # noqa: F821
    return await _rr_rescan("manual")
