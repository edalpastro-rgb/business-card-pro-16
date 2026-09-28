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
    return _ws_re.sub(r"[^a-z0-9_-]+", "", (v or "").strip().lower())[:40]


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
    if (k == "positive" and w not in WS_POSITIVE) or (k == "negative" and w not in WS_NEGATIVE):
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
    return {"ok": True, "sample_id": sample_id, "word": w, "environment": env, "kind": k, "seq": doc["seq"], "created_at": now.isoformat()}


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
    return {"total": total, "total_bytes": total_bytes, "sessions": sessions, "last_at": last["created_at"].isoformat() if last else None,
            "positive": sum(x["total"] for x in words if x["kind"] == "positive"), "negative": sum(x["total"] for x in words if x["kind"] == "negative"),
            "words": words, "by_environment": by_env, "environments": sorted(WS_ENVIRONMENTS),
            "expected_words": {"positive": sorted(WS_POSITIVE), "negative": sorted(WS_NEGATIVE)}}


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
async def ws_export(kind: Optional[str] = None, word: Optional[str] = None, environment: Optional[str] = None,
                    token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """ZIP di tutti i campioni (+ manifest.csv) per il retraining. Auth via header o ?token= (download dal browser)."""
    await _ws_admin(authorization, token)
    q: Dict[str, Any] = {}
    if kind in ("positive", "negative"): q["kind"] = kind
    if word: q["word"] = _ws_slug(word)
    if environment: q["environment"] = _ws_slug(environment)
    rows = await db.wake_samples.find(q, {"_id": 0}).sort("created_at", 1).to_list(100000)  # noqa: F821
    if not rows:
        raise HTTPException(status_code=404, detail="Nessun campione da esportare")
    tmp = _ws_tempfile.NamedTemporaryFile(suffix=".zip", delete=False); tmp.close()
    n = await run_in_threadpool(_ws_build_zip_sync, rows, tmp.name)  # noqa: F821
    fname = f"axon-wake-samples_{utcnow().strftime('%Y%m%d_%H%M')}_{n}.zip"  # noqa: F821
    return FileResponse(tmp.name, media_type="application/zip", filename=fname, background=BackgroundTask(lambda: _ws_os.unlink(tmp.name) if _ws_os.path.exists(tmp.name) else None))


@api_router.delete("/wake-samples/{sample_id}")  # noqa: F821
async def ws_delete(sample_id: str, user=Depends(get_current_user)):  # noqa: F821
    _require_super_master(user)  # noqa: F821
    await db.wake_samples.delete_one({"sample_id": sample_id})  # noqa: F821
    return {"ok": True}
