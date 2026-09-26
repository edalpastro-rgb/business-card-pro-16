# media_compress.py — V50.z364 — COMPRESSIONE GLOBALE (regola architetturale permanente)
# Tutto il materiale caricato in QUALSIASI sezione (CRT, schede clienti, Corporate Gym, Knowledge Base, Master Files, bollette…)
# viene compresso PRIMA del salvataggio nel DB: PDF (PyMuPDF, worker), immagini (Pillow: ricampionamento ≤ 2000 px + ricodifica
# nello STESSO formato), audio/video (ffmpeg via imageio-ffmpeg: AAC 96k / H.264 720p CRF 26, stesso contenitore). Mai peggiora.
# Punto unico: `media_auto_compress(_b64)`; le funzioni storiche `pdf_auto_compress(_b64)` (usate da tutti gli upload) vengono
# ridefinite qui → ogni sezione esistente e futura eredita la regola senza modifiche. Retroattivo: `POST /admin/compress-all`
# (Master) → job in background che scandisce le collezioni, trova i blob base64 (magic bytes), li ricomprime e aggiorna il campo;
# `GET /admin/compress-all/status` → memoria prima/dopo/liberata. Ripetibile.

import io as _mc_io
import os as _mc_os
import shutil as _mc_shutil
import subprocess as _mc_subprocess
import tempfile as _mc_tempfile
import asyncio as _mc_asyncio

try:
    import imageio_ffmpeg as _mc_iio
    MC_FFMPEG: Optional[str] = _mc_iio.get_ffmpeg_exe()
except Exception:  # noqa: BLE001
    MC_FFMPEG = _mc_shutil.which("ffmpeg")

MC_MIN_IMAGE = 120 * 1024
MC_MIN_AV = 700 * 1024
MC_IMG_MAX_SIDE = 2000
_MC_IMG_EXT = ("jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "heic", "heif")
_MC_AUDIO_EXT = ("m4a", "aac", "mp4a", "mp3", "ogg", "oga", "opus", "caf", "wav")
_MC_VIDEO_EXT = ("mp4", "m4v", "mov")


def _mc_ext(name: str, mime: str) -> str:
    e = (name or "").rsplit(".", 1)[-1].lower() if "." in (name or "") else ""
    if not e and mime and "/" in mime:
        e = mime.split("/", 1)[1].split(";")[0].lower()
        e = {"jpeg": "jpg", "mpeg": "mp3", "x-m4a": "m4a", "quicktime": "mov", "x-wav": "wav", "vnd.wave": "wav"}.get(e, e)
    return e


def mc_kind(mime: str, name: str, raw: bytes) -> str:
    """pdf | image | audio | video | other — decisione su MIME/estensione confermata dai magic bytes quando possibile."""
    mime = (mime or "").lower(); e = _mc_ext(name, mime); h = raw[:16] if raw else b""
    if h[:5] == b"%PDF-":
        return "pdf"
    if h[:3] == b"\xff\xd8\xff" or h[:8] == b"\x89PNG\r\n\x1a\n" or h[:4] == b"RIFF" and raw[8:12] == b"WEBP" or h[:2] == b"BM":
        return "image"
    if h[:4] == b"RIFF" and raw[8:12] == b"WAVE" or h[:3] == b"ID3" or h[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2") or h[:4] == b"OggS":
        return "audio"
    if raw[4:8] == b"ftyp":
        brand = raw[8:12]
        if brand in (b"M4A ", b"M4B ") or mime.startswith("audio/") or e in _MC_AUDIO_EXT:
            return "audio"
        return "video"
    if mime.startswith("image/") or e in _MC_IMG_EXT:
        return "image"
    if mime.startswith("audio/") or e in _MC_AUDIO_EXT:
        return "audio"
    if mime.startswith("video/") or e in _MC_VIDEO_EXT:
        return "video"
    return "other"


def _mc_image_sync(raw: bytes) -> Tuple[bytes, str]:
    from PIL import Image, ImageOps
    im = Image.open(_mc_io.BytesIO(raw)); fmt = (im.format or "JPEG").upper()
    im = ImageOps.exif_transpose(im)
    w, h = im.size; m = max(w, h)
    if m > MC_IMG_MAX_SIDE:
        s = MC_IMG_MAX_SIDE / m; im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    out = _mc_io.BytesIO()
    if fmt == "PNG":
        if im.mode not in ("RGBA", "LA", "P", "RGB", "L"):
            im = im.convert("RGBA")
        im.save(out, "PNG", optimize=True); return out.getvalue(), "image/png"
    if fmt == "WEBP":
        im.save(out, "WEBP", quality=80, method=6); return out.getvalue(), "image/webp"
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.save(out, "JPEG", quality=82, optimize=True, progressive=True); return out.getvalue(), "image/jpeg"


def _mc_av_sync(raw: bytes, kind: str, ext: str) -> Tuple[bytes, str]:
    """Stesso contenitore in uscita (niente cambio MIME): m4a/mp4/aac→AAC 96k, mp3→64k, ogg/opus→Opus 48k, mp4/mov→H.264 720p."""
    if not MC_FFMPEG:
        raise RuntimeError("ffmpeg non disponibile")
    if kind == "audio":
        if ext in ("mp3",):
            oext, codec, mime = "mp3", ["-c:a", "libmp3lame", "-b:a", "64k"], "audio/mpeg"
        elif ext in ("ogg", "oga", "opus"):
            oext, codec, mime = "ogg", ["-c:a", "libopus", "-b:a", "48k"], "audio/ogg"
        elif ext == "wav":
            raise RuntimeError("wav: cambio contenitore richiesto (solo job retroattivo)")
        else:
            oext, codec, mime = "m4a", ["-c:a", "aac", "-b:a", "96k"], "audio/mp4"
        args = ["-vn"] + codec
    else:
        oext, mime = "mp4", "video/mp4"
        args = ["-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"]
    with _mc_tempfile.TemporaryDirectory() as td:
        src = _mc_os.path.join(td, f"in.{ext or 'bin'}"); dst = _mc_os.path.join(td, f"out.{oext}")
        with open(src, "wb") as f:
            f.write(raw)
        _mc_subprocess.run([MC_FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", src, *args, dst], check=True, timeout=900,
                           stdout=_mc_subprocess.DEVNULL, stderr=_mc_subprocess.PIPE)
        with open(dst, "rb") as f:
            return f.read(), mime


_mc_pdf_only_compress = pdf_auto_compress  # noqa: F821 — 01c_pdf_compress (PyMuPDF)


async def media_auto_compress(raw: bytes, mime: str = "", name: str = "", label: str = "", allow_container_change: bool = False) -> Tuple[bytes, Dict[str, Any]]:
    """Ritorna (bytes_finali, info) — info = {before, after, ratio, compressed, kind, mime}. Mai peggiora."""
    n = len(raw or b"")
    base = {"before": n, "after": n, "ratio": 1.0, "compressed": False, "kind": "other", "mime": mime}
    if not raw:
        return raw, base
    kind = mc_kind(mime, name, raw); base["kind"] = kind
    try:
        if kind == "pdf":
            out, info = await _mc_pdf_only_compress(raw, "application/pdf", name, label)
            return out, {**base, **info, "mime": "application/pdf"}
        if kind == "image":
            if n < MC_MIN_IMAGE:
                return raw, base
            out, omime = await _mc_asyncio.get_event_loop().run_in_executor(None, _mc_image_sync, raw)
        elif kind in ("audio", "video"):
            if n < MC_MIN_AV or not MC_FFMPEG:
                return raw, base
            ext = _mc_ext(name, mime)
            if ext == "wav" and allow_container_change:
                ext = "m4a"
            out, omime = await _mc_asyncio.get_event_loop().run_in_executor(None, _mc_av_sync, raw, kind, ext)
        else:
            return raw, base
        if len(out) >= n * 0.97:
            return raw, base
        logger.info("[media-compress] %s %s %s: %d KB → %d KB (%.0f%%)", label, kind, (name or "")[:40], n // 1024, len(out) // 1024, len(out) * 100 / n)
        return out, {**base, "after": len(out), "ratio": len(out) / n, "compressed": True, "mime": omime}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[media-compress] %s fallita (%s %s): %s", kind, label, name, str(exc)[:200])
        return raw, base


async def media_auto_compress_b64(b64: str, mime: str = "", name: str = "", label: str = "") -> Tuple[str, Dict[str, Any]]:
    if not b64:
        return b64, {"before": 0, "after": 0, "ratio": 1.0, "compressed": False, "kind": "other", "mime": mime}
    prefix = ""; pure = b64
    if b64.startswith("data:") and "," in b64:
        prefix, pure = b64.split(",", 1); prefix += ","
    try:
        raw = base64.b64decode(pure)
    except Exception:
        return b64, {"before": 0, "after": 0, "ratio": 1.0, "compressed": False, "kind": "other", "mime": mime}
    out, info = await media_auto_compress(raw, mime, name, label)
    if not info["compressed"]:
        return b64, info
    return prefix + base64.b64encode(out).decode("ascii"), info


# ── REGOLA GLOBALE: ogni chiamata storica `pdf_auto_compress(_b64)` (master-files, contatti, bollette, KB, Axon Lab, upload…)
#    ora comprime PDF + immagini + audio + video. Nome mantenuto per compatibilità.
pdf_auto_compress = media_auto_compress  # noqa: F811
pdf_auto_compress_b64 = media_auto_compress_b64  # noqa: F811


# ── Retroattivo: «Comprimi tutto» ────────────────────────────────────────────────────────────────────────────────
_MC_SKIP_COLLECTIONS = {"compress_jobs", "axon_system_events", "assistant_messages", "axon_stress_runs", "axon_semantic_cache",
                        "axon_proactive_log", "axon_notifications", "email_events", "axon_client_versions", "sessions"}
_MC_MIN_BLOB = 100 * 1024
_MC_STATE: Dict[str, Any] = {"running": False}


def _mc_walk(node: Any, path: str, out: List[Tuple[str, str, dict]]) -> None:
    """Trova (path_puntato, valore_b64, contesto_fratelli) per ogni stringa lunga che sembra un blob base64."""
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{path}.{k}" if path else k
            if isinstance(v, str) and len(v) >= _MC_MIN_BLOB * 4 // 3 and not v.lstrip().startswith(("http", "{", "[", "<")):
                out.append((p, v, node))
            elif isinstance(v, (dict, list)):
                _mc_walk(v, p, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _mc_walk(v, f"{path}.{i}", out)


async def _mc_db_size() -> int:
    try:
        st = await db.command("dbStats")
        return int(st.get("dataSize") or 0)
    except Exception:  # noqa: BLE001
        return 0


async def _mc_run_job(job_id: str) -> None:
    _MC_STATE["running"] = True
    saved = 0; items = 0; scanned = 0
    try:
        for coll in await db.list_collection_names():
            if coll in _MC_SKIP_COLLECTIONS or coll.startswith("system."):
                continue
            async for doc in db[coll].find({}, {"_id": 1}):
                full = await db[coll].find_one({"_id": doc["_id"]})
                if not full:
                    continue
                scanned += 1
                blobs: List[Tuple[str, str, dict]] = []
                _mc_walk({k: v for k, v in full.items() if k != "_id"}, "", blobs)
                if not blobs:
                    continue
                sets: Dict[str, Any] = {}
                for path, val, ctx in blobs:
                    prefix = ""; pure = val
                    if val.startswith("data:") and "," in val:
                        prefix, pure = val.split(",", 1); prefix += ","
                    try:
                        raw = base64.b64decode(pure, validate=False)
                    except Exception:
                        continue
                    mime = str(ctx.get("mime") or ctx.get("mime_type") or ctx.get("content_type") or (prefix[5:-8] if prefix else "") or "")
                    name = str(ctx.get("name") or ctx.get("filename") or ctx.get("file_name") or ctx.get("title") or "")
                    out, info = await media_auto_compress(raw, mime, name, f"{coll}:{path}", allow_container_change=True)
                    if not info["compressed"]:
                        continue
                    sets[path] = prefix + base64.b64encode(out).decode("ascii")
                    if info.get("mime") and info["mime"] != mime and "mime" in ctx:
                        sets[path.rsplit(".", 1)[0] + ".mime" if "." in path else "mime"] = info["mime"]
                    saved += info["before"] - info["after"]; items += 1
                if sets:
                    await db[coll].update_one({"_id": doc["_id"]}, {"$set": sets})
                await db.compress_jobs.update_one({"job_id": job_id}, {"$set": {"items": items, "saved_bytes": saved, "scanned": scanned, "current": coll, "updated_at": utcnow()}})
        after = await _mc_db_size()
        await db.compress_jobs.update_one({"job_id": job_id}, {"$set": {"status": "done", "items": items, "saved_bytes": saved, "scanned": scanned,
                                                                       "after_bytes": after, "finished_at": utcnow(), "current": None}})
        logger.info("[media-compress] job %s: %d file ricompressi, %d MB liberati", job_id, items, saved // (1024 * 1024))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[media-compress] job %s fallito: %s", job_id, exc)
        await db.compress_jobs.update_one({"job_id": job_id}, {"$set": {"status": "error", "error": str(exc)[:300], "finished_at": utcnow()}})
    finally:
        _MC_STATE["running"] = False


def _mc_job_out(j: Optional[dict]) -> Optional[dict]:
    if not j:
        return None
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in j.items() if k != "_id"}


@api_router.post("/admin/compress-all")
async def admin_compress_all(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può avviare la compressione globale")
    if _MC_STATE["running"]:
        raise HTTPException(status_code=409, detail="Compressione già in corso")
    before = await _mc_db_size()
    job = {"job_id": f"mc_{uuid.uuid4().hex[:10]}", "status": "running", "started_by": user["user_id"], "before_bytes": before, "after_bytes": None,
           "saved_bytes": 0, "items": 0, "scanned": 0, "current": None, "created_at": utcnow(), "updated_at": utcnow(), "finished_at": None, "ffmpeg": bool(MC_FFMPEG)}
    await db.compress_jobs.insert_one(dict(job))
    _mc_asyncio.create_task(_mc_run_job(job["job_id"]))
    return _mc_job_out(job)


@api_router.get("/admin/compress-all/status")
async def admin_compress_all_status(user=Depends(get_current_user)):
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo Master")
    last = await db.compress_jobs.find_one({}, sort=[("created_at", -1)])
    return {"running": _MC_STATE["running"], "db_bytes": await _mc_db_size(), "ffmpeg": bool(MC_FFMPEG), "last": _mc_job_out(last)}
