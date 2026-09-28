# wake_samples.py — V50.z390 — RACCOLTA CAMPIONI AUDIO PUBBLICA per il training della wake-word «Axon».
# Pagina pubblica (nessun login, nessun dato personale): /wake-training. Ogni campione è etichettato con parola, ambiente,
# tipo (positive = «Axon» · negative = parole simili), numero progressivo, timestamp e un id di sessione anonimo casuale.
# File su Object Storage (wake-samples/<kind>/<word>/<env>/...) con fallback base64 in Mongo. Pannello Super Master:
# GET /wake-samples/stats (totali per parola × ambiente) · GET /wake-samples/export.zip (tutti gli audio + manifest CSV).
import asyncio as _ws_asyncio
import csv as _ws_csv
import io as _ws_io
import os as _ws_os
import re as _ws_re
import tempfile as _ws_tempfile
import zipfile as _ws_zipfile
from typing import Any, Dict, List, Optional

from fastapi import Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from starlette.background import BackgroundTask

WS_MAX_BYTES = 3 * 1024 * 1024          # un campione «Axon» dura 1-2 s: 3 MB è abbondante
WS_INLINE_MAX = 400 * 1024              # sotto → base64 in Mongo se lo storage non risponde
WS_ENVIRONMENTS = {"casa", "macchina", "aperto", "bar", "sport", "autostrada", "discoteca"}
WS_POSITIVE = {"axon"}
WS_NEGATIVE = {"action", "axel", "accent", "axia", "auction", "acton", "saxon", "faction", "oxygen", "flaxen"}
WS_PRONUNCIATION_TEXT = "Axon. Axon. Axon."


def _ws_slug(v: str) -> str:
    # V50.z398 — anche FRASI («ehi axon» → «ehi_axon»)
    return _ws_re.sub(r"[^a-z0-9_-]+", "", _ws_re.sub(r"\s+", "_", (v or "").strip().lower()))[:60]


# ── V50.z398 — PAROLE/FRASI CONFIGURABILI dal pannello Super Master (più parole attive insieme; il visitatore le registra tutte)
WS_NEG_LABELS = {"action": "Action (EK-shon)", "axel": "Axel (AK-sel)", "accent": "Accent (AK-sent)", "axia": "Axia (AK-sia)", "auction": "Auction (OK-shon)", "acton": "Acton (AK-ton)",
                 "saxon": "Saxon (SAK-son)", "faction": "Faction (FAK-shon)", "oxygen": "Oxygen (OK-si-gen)", "flaxen": "Flaxen (FLAK-sen)"}
WS_MIN_PER_ENV = 10
WS_MAX_PER_ENV = 50


def _ws_default_config() -> dict:
    return {"config_id": "words", "min_per_env": WS_MIN_PER_ENV, "max_per_env": WS_MAX_PER_ENV,
            "positive": [{"word": "axon", "label": "Axon (AK-son)", "active": True}],
            "negative": [{"word": w, "label": WS_NEG_LABELS[w], "active": True} for w in WS_NEG_LABELS]}


async def _ws_config() -> dict:
    doc = await db.wake_config.find_one({"config_id": "words"}, {"_id": 0})  # noqa: F821
    if not doc:
        return _ws_default_config()
    d = _ws_default_config(); d.update(doc)
    return d


def _ws_words(cfg: dict, kind: str, only_active: bool) -> List[dict]:
    return [w for w in (cfg.get(kind) or []) if w.get("word") and (w.get("active", True) or not only_active)]


class WsWordIn(BaseModel):
    word: str
    label: Optional[str] = None
    active: bool = True


class WsConfigIn(BaseModel):
    positive: Optional[List[WsWordIn]] = None
    negative: Optional[List[WsWordIn]] = None
    min_per_env: Optional[int] = None
    max_per_env: Optional[int] = None


class WsVisitIn(BaseModel):
    session_id: str
    event: str = "open"          # open | consent | done
    user_agent: Optional[str] = None
    platform: Optional[str] = None


def _ws_ext(mime: str, name: str) -> str:
    m = (mime or "").lower(); n = (name or "").lower()
    for k, e in (("webm", "webm"), ("ogg", "ogg"), ("opus", "ogg"), ("mp4", "m4a"), ("m4a", "m4a"), ("aac", "m4a"), ("wav", "wav"), ("mpeg", "mp3"), ("mp3", "mp3"), ("caf", "caf")):
        if k in m or n.endswith("." + e):
            return e
    return "bin"


class WsSampleIn(BaseModel):
    data_base64: str
    mime: Optional[str] = "audio/webm"
    word: str
    environment: str
    kind: str = "positive"
    seq: int = 0
    session_id: str = ""
    duration_ms: Optional[int] = None


@api_router.post("/public/wake-samples")  # noqa: F821
async def ws_upload(file: UploadFile = File(...), word: str = Form(...), environment: str = Form(...), kind: str = Form("positive"),
                    seq: int = Form(0), session_id: str = Form(""), duration_ms: Optional[int] = Form(None)):
    """Pubblico, senza autenticazione (multipart). Nessun dato personale: solo audio + etichette."""
    raw = await file.read()
    return await _ws_store(raw, (file.content_type or "application/octet-stream").split(";")[0].strip(), file.filename or "", word, environment, kind, seq, session_id, duration_ms)


@api_router.post("/public/wake-samples/b64")  # noqa: F821
async def ws_upload_b64(body: WsSampleIn):
    """Stessa cosa in JSON base64 (usato dalla pagina web/app: registratore expo-audio / MediaRecorder)."""
    b64 = body.data_base64.split(",", 1)[1] if body.data_base64.startswith("data:") else body.data_base64
    try:
        raw = base64.b64decode(b64)  # noqa: F821
    except Exception:
        raise HTTPException(status_code=400, detail="Audio non valido")
    return await _ws_store(raw, (body.mime or "audio/webm").split(";")[0].strip(), "", body.word, body.environment, body.kind, body.seq, body.session_id, body.duration_ms)


async def _ws_store(raw: bytes, mime: str, filename: str, word: str, environment: str, kind: str, seq: int, session_id: str, duration_ms: Optional[int]) -> dict:
    w = _ws_slug(word); env = _ws_slug(environment); k = "negative" if kind == "negative" else "positive"
    if env not in WS_ENVIRONMENTS:
        raise HTTPException(status_code=400, detail="Ambiente non valido")
    cfg = await _ws_config()  # V50.z398 — parole configurabili (accetto anche quelle disattivate da poco: upload in coda)
    allowed = {x["word"] for x in _ws_words(cfg, k, only_active=False)} | (WS_POSITIVE if k == "positive" else WS_NEGATIVE)
    if w not in allowed:
        raise HTTPException(status_code=400, detail="Parola non valida per questo tipo di campione")
    if len(raw) < 800:
        raise HTTPException(status_code=400, detail="Registrazione troppo breve o vuota: tieni premuto e di' «Axon»")
    if len(raw) > WS_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Registrazione troppo lunga (max 3 MB)")
    ext = _ws_ext(mime, filename)
    now = utcnow()  # noqa: F821
    sid = _ws_slug(session_id) or f"anon{uuid.uuid4().hex[:8]}"  # noqa: F821
    sample_id = f"wks_{uuid.uuid4().hex[:12]}"  # noqa: F821
    doc: Dict[str, Any] = {"sample_id": sample_id, "kind": k, "word": w, "environment": env, "seq": max(0, int(seq or 0)), "session_id": sid,
                           "mime": mime, "ext": ext, "size": len(raw), "duration_ms": duration_ms, "created_at": now, "storage_path": None, "data_base64": None}
    path = f"{_STORAGE_APP_NAME}/wake-samples/{k}/{w}/{env}/{now.strftime('%Y%m%dT%H%M%S')}_{sid}_{doc['seq']:03d}.{ext}"  # noqa: F821
    stored = None
    for attempt in range(2):
        try:
            res = await run_in_threadpool(_put_object_sync, path, raw, mime)  # noqa: F821
            if res:
                stored = (res or {}).get("path") or path; break
        except Exception as exc:  # noqa: BLE001
            logger.warning("[wake-samples] store attempt %s failed: %s", attempt + 1, exc)  # noqa: F821
        await _ws_asyncio.sleep(0.4)
    if stored:
        doc["storage_path"] = stored
    elif len(raw) <= WS_INLINE_MAX:
        doc["data_base64"] = base64.b64encode(raw).decode("ascii")  # noqa: F821
    else:
        raise HTTPException(status_code=503, detail="Archivio non disponibile, riprova tra qualche secondo")
    await db.wake_samples.insert_one(dict(doc))  # noqa: F821
    await db.wake_visits.update_one({"session_id": sid}, {"$set": {"last_seen": now}, "$setOnInsert": {"session_id": sid, "first_seen": now, "hits": 0}}, upsert=True)  # noqa: F821  # V50.z398
    return {"ok": True, "sample_id": sample_id, "word": w, "environment": env, "kind": k, "seq": doc["seq"], "created_at": now.isoformat()}


# ── V50.z398 — config pubblica + tracciamento anonimo aperture (solo session_id casuale + piattaforma, nessun dato personale)
@api_router.get("/public/wake-samples/config")  # noqa: F821
async def ws_public_config():
    cfg = await _ws_config()
    return {"positive": [{"word": x["word"], "label": x.get("label") or x["word"]} for x in _ws_words(cfg, "positive", True)],
            "negative": [{"word": x["word"], "label": x.get("label") or x["word"]} for x in _ws_words(cfg, "negative", True)],
            "min_per_env": int(cfg.get("min_per_env") or WS_MIN_PER_ENV), "max_per_env": int(cfg.get("max_per_env") or WS_MAX_PER_ENV), "environments": sorted(WS_ENVIRONMENTS)}


@api_router.post("/public/wake-samples/visit")  # noqa: F821
async def ws_public_visit(body: WsVisitIn):
    sid = _ws_slug(body.session_id)
    if not sid:
        raise HTTPException(status_code=400, detail="session_id mancante")
    now = utcnow()  # noqa: F821
    ev = body.event if body.event in ("open", "consent", "done") else "open"
    upd: Dict[str, Any] = {"$set": {"last_seen": now}, "$setOnInsert": {"session_id": sid, "first_seen": now}, "$inc": {"hits": 1 if ev == "open" else 0}}
    if ev == "consent":
        upd["$set"]["consent_at"] = now
    if ev == "done":
        upd["$set"]["completed_at"] = now
    if body.platform:
        upd["$set"]["platform"] = body.platform[:20]
    if body.user_agent:
        upd["$set"]["user_agent"] = body.user_agent[:200]
    await db.wake_visits.update_one({"session_id": sid}, upd, upsert=True)  # noqa: F821
    return {"ok": True}


@api_router.get("/public/wake-samples/pronunciation")  # noqa: F821
async def ws_pronunciation():
    """MP3 con la pronuncia corretta di «Axon» (TTS OpenAI, voce italiana neutra), generato una volta e messo in cache."""
    cached = await db.wake_assets.find_one({"asset_id": "pronunciation_axon"}, {"_id": 0, "data_base64": 1, "mime": 1})  # noqa: F821
    if not cached:
        try:
            out = await openai_tts(WS_PRONUNCIATION_TEXT, "alloy", 0.9, "it")  # noqa: F821 — 01d_kokoro_tts
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Audio pronuncia non disponibile: {str(exc)[:120]}")
        cached = {"data_base64": out["audio_base64"], "mime": out.get("mime") or "audio/mpeg"}
        await db.wake_assets.update_one({"asset_id": "pronunciation_axon"}, {"$set": {**cached, "updated_at": utcnow()}}, upsert=True)  # noqa: F821
    return Response(content=base64.b64decode(cached["data_base64"]), media_type=cached.get("mime") or "audio/mpeg",  # noqa: F821
                    headers={"Cache-Control": "public, max-age=86400", "Content-Disposition": "inline"})


@api_router.get("/public/wake-samples/counts")  # noqa: F821
async def ws_public_counts():
    """Contatore pubblico aggregato (nessun dettaglio): usato per la frase «Sei il contributo n. …»."""
    total = await db.wake_samples.count_documents({})  # noqa: F821
    sessions = len(await db.wake_samples.distinct("session_id"))  # noqa: F821
    return {"total": total, "sessions": sessions}


# ── Pannello Super Master ────────────────────────────────────────────────────────────────────────────────────────
async def _ws_admin(authorization: Optional[str], token: Optional[str]) -> dict:
    user = await get_current_user(authorization=authorization or (f"Bearer {token}" if token else None))  # noqa: F821
    _require_super_master(user)  # noqa: F821 — 27_teach_ai_kb
    return user


@api_router.get("/wake-samples/access")  # noqa: F821
async def ws_access(user=Depends(get_current_user)):  # noqa: F821
    """V50.z398 — la card «Addestramento wake-word» nel pannello Master mostra il bottone del pannello solo al Super Master."""
    try:
        _require_super_master(user)  # noqa: F821
        return {"is_super_master": True}
    except HTTPException:
        return {"is_super_master": False}


@api_router.get("/wake-samples/config")  # noqa: F821
async def ws_config_get(user=Depends(get_current_user)):  # noqa: F821
    _require_super_master(user)  # noqa: F821
    cfg = await _ws_config()
    return {k: v for k, v in cfg.items() if k != "config_id"}


@api_router.put("/wake-samples/config")  # noqa: F821
async def ws_config_put(body: WsConfigIn, user=Depends(get_current_user)):  # noqa: F821
    """V50.z398 — Il Super Master aggiunge/spunta/disattiva parole o frasi da raccogliere (positive = wake-word, negative = simili)."""
    _require_super_master(user)  # noqa: F821
    cfg = await _ws_config()
    for kind in ("positive", "negative"):
        items = getattr(body, kind)
        if items is None:
            continue
        seen: set = set(); out: List[dict] = []
        for it in items:
            w = _ws_slug(it.word)
            if not w or w in seen:
                continue
            seen.add(w); out.append({"word": w, "label": (it.label or it.word).strip()[:80], "active": bool(it.active)})
        if kind == "positive" and not any(x["active"] for x in out):
            raise HTTPException(status_code=400, detail="Serve almeno una parola/frase wake-word attiva")
        cfg[kind] = out
    if body.min_per_env is not None:
        cfg["min_per_env"] = max(1, min(200, int(body.min_per_env)))
    if body.max_per_env is not None:
        cfg["max_per_env"] = max(cfg["min_per_env"], min(500, int(body.max_per_env)))
    cfg["updated_at"] = utcnow(); cfg["updated_by"] = user["user_id"]  # noqa: F821
    await db.wake_config.update_one({"config_id": "words"}, {"$set": cfg}, upsert=True)  # noqa: F821
    return {k: v for k, v in cfg.items() if k not in ("config_id", "_id")}


@api_router.get("/wake-samples/sessions")  # noqa: F821
async def ws_sessions(user=Depends(get_current_user)):  # noqa: F821
    """V50.z398 — Lista per visitatore (sessione anonima): primo accesso, ultimo, campioni, stato completato/parziale/solo_visualizzato."""
    _require_super_master(user)  # noqa: F821
    cfg = await _ws_config()
    n_pos_words = max(1, len(_ws_words(cfg, "positive", True)))
    required = int(cfg.get("min_per_env") or WS_MIN_PER_ENV) * len(WS_ENVIRONMENTS) * n_pos_words
    agg = await db.wake_samples.aggregate([  # noqa: F821
        {"$group": {"_id": "$session_id", "total": {"$sum": 1}, "bytes": {"$sum": "$size"}, "first": {"$min": "$created_at"}, "last": {"$max": "$created_at"},
                    "positive": {"$sum": {"$cond": [{"$eq": ["$kind", "positive"]}, 1, 0]}}, "negative": {"$sum": {"$cond": [{"$eq": ["$kind", "negative"]}, 1, 0]}},
                    "environments": {"$addToSet": "$environment"}, "words": {"$addToSet": "$word"}}},
    ]).to_list(20000)
    by_sid = {r["_id"]: r for r in agg}
    visits = {v["session_id"]: v for v in await db.wake_visits.find({}, {"_id": 0}).to_list(20000)}  # noqa: F821
    iso = lambda d: d.isoformat() if hasattr(d, "isoformat") else None  # noqa: E731
    out: List[dict] = []
    for sid in set(by_sid) | set(visits):
        a = by_sid.get(sid) or {}; v = visits.get(sid) or {}
        total = int(a.get("total") or 0)
        if v.get("completed_at") or (total and int(a.get("positive") or 0) >= required):
            status = "completato"
        elif total:
            status = "parziale"
        else:
            status = "solo_visualizzato"
        opened = v.get("first_seen") or a.get("first")
        out.append({"session_id": sid, "opened_at": iso(opened), "last_seen": iso(v.get("last_seen") or a.get("last")), "completed_at": iso(v.get("completed_at")),
                    "consent_at": iso(v.get("consent_at")), "platform": v.get("platform"), "hits": int(v.get("hits") or 0),
                    "total": total, "positive": int(a.get("positive") or 0), "negative": int(a.get("negative") or 0), "bytes": int(a.get("bytes") or 0),
                    "environments": sorted(a.get("environments") or []), "words": sorted(a.get("words") or []), "status": status, "required": required})
    out.sort(key=lambda x: x["opened_at"] or "", reverse=True)
    return {"items": out, "required_per_session": required, "total_samples": sum(x["total"] for x in out),
            "counts": {"completato": sum(1 for x in out if x["status"] == "completato"), "parziale": sum(1 for x in out if x["status"] == "parziale"),
                       "solo_visualizzato": sum(1 for x in out if x["status"] == "solo_visualizzato")}}


@api_router.get("/wake-samples/stats")  # noqa: F821
async def ws_stats(user=Depends(get_current_user)):  # noqa: F821
    _require_super_master(user)  # noqa: F821
    rows = await db.wake_samples.aggregate([  # noqa: F821
        {"$group": {"_id": {"kind": "$kind", "word": "$word", "environment": "$environment"}, "n": {"$sum": 1}, "bytes": {"$sum": "$size"}, "last": {"$max": "$created_at"}}},
    ]).to_list(2000)
    by_word: Dict[str, Dict[str, Any]] = {}
    by_env: Dict[str, int] = {e: 0 for e in sorted(WS_ENVIRONMENTS)}
    total = 0; total_bytes = 0
    for r in rows:
        k = r["_id"]; w = k["word"]; e = k["environment"]
        d = by_word.setdefault(w, {"word": w, "kind": k["kind"], "total": 0, "environments": {x: 0 for x in sorted(WS_ENVIRONMENTS)}})
        d["total"] += r["n"]; d["environments"][e] = d["environments"].get(e, 0) + r["n"]
        by_env[e] = by_env.get(e, 0) + r["n"]; total += r["n"]; total_bytes += r.get("bytes") or 0
    sessions = len(await db.wake_samples.distinct("session_id"))  # noqa: F821
    last = await db.wake_samples.find_one({}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])  # noqa: F821
    words = sorted(by_word.values(), key=lambda x: (x["kind"] != "positive", x["word"]))
    cfg = await _ws_config()  # V50.z398 — parole dalla configurazione
    return {"total": total, "total_bytes": total_bytes, "sessions": sessions, "last_at": last["created_at"].isoformat() if last else None,
            "positive": sum(x["total"] for x in words if x["kind"] == "positive"), "negative": sum(x["total"] for x in words if x["kind"] == "negative"),
            "words": words, "by_environment": by_env, "environments": sorted(WS_ENVIRONMENTS),
            "expected_words": {"positive": [x["word"] for x in _ws_words(cfg, "positive", False)], "negative": [x["word"] for x in _ws_words(cfg, "negative", False)]}}


def _ws_build_zip_sync(rows: List[dict], zpath: str) -> int:
    n = 0
    with _ws_zipfile.ZipFile(zpath, "w", compression=_ws_zipfile.ZIP_STORED) as zf:
        man = _ws_io.StringIO(); wr = _ws_csv.writer(man)
        wr.writerow(["file", "sample_id", "kind", "word", "environment", "seq", "session_id", "mime", "size", "duration_ms", "created_at"])
        for r in rows:
            raw: Optional[bytes] = None
            if r.get("storage_path"):
                try:
                    got = _get_object_sync(r["storage_path"])  # noqa: F821
                    raw = got[0] if got else None
                except Exception:  # noqa: BLE001
                    raw = None
            if raw is None and r.get("data_base64"):
                raw = base64.b64decode(r["data_base64"])  # noqa: F821
            if not raw:
                continue
            ts = r["created_at"].strftime("%Y%m%dT%H%M%S") if hasattr(r.get("created_at"), "strftime") else "na"
            arc = f"{r['kind']}/{r['word']}/{r['environment']}/{ts}_{r.get('session_id', 'anon')}_{int(r.get('seq') or 0):03d}_{r['sample_id']}.{r.get('ext') or 'bin'}"
            zf.writestr(arc, raw); n += 1
            wr.writerow([arc, r["sample_id"], r["kind"], r["word"], r["environment"], r.get("seq"), r.get("session_id"), r.get("mime"), r.get("size"), r.get("duration_ms"),
                         r["created_at"].isoformat() if hasattr(r.get("created_at"), "isoformat") else ""])
        zf.writestr("manifest.csv", man.getvalue())
    return n


@api_router.get("/wake-samples/export.zip")  # noqa: F821
async def ws_export(kind: Optional[str] = None, word: Optional[str] = None, environment: Optional[str] = None, session_id: Optional[str] = None,
                    token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """ZIP di tutti i campioni (+ manifest.csv) per il retraining. Auth via header o ?token= (download dal browser)."""
    await _ws_admin(authorization, token)
    q: Dict[str, Any] = {}
    if kind in ("positive", "negative"): q["kind"] = kind
    if word: q["word"] = _ws_slug(word)
    if environment: q["environment"] = _ws_slug(environment)
    if session_id: q["session_id"] = _ws_slug(session_id)  # V50.z398 — ZIP per visitatore
    rows = await db.wake_samples.find(q, {"_id": 0}).sort("created_at", 1).to_list(100000)  # noqa: F821
    if not rows:
        raise HTTPException(status_code=404, detail="Nessun campione da esportare")
    tmp = _ws_tempfile.NamedTemporaryFile(suffix=".zip", delete=False); tmp.close()
    n = await run_in_threadpool(_ws_build_zip_sync, rows, tmp.name)  # noqa: F821
    fname = f"axon-wake-samples_{(session_id + '_') if session_id else ''}{utcnow().strftime('%Y%m%d_%H%M')}_{n}.zip"  # noqa: F821
    return FileResponse(tmp.name, media_type="application/zip", filename=fname, background=BackgroundTask(lambda: _ws_os.unlink(tmp.name) if _ws_os.path.exists(tmp.name) else None))


@api_router.delete("/wake-samples/{sample_id}")  # noqa: F821
async def ws_delete(sample_id: str, user=Depends(get_current_user)):  # noqa: F821
    _require_super_master(user)  # noqa: F821
    await db.wake_samples.delete_one({"sample_id": sample_id})  # noqa: F821
    return {"ok": True}
