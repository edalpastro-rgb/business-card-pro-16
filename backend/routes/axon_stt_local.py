# axon_stt_local.py — V50.z519 — WHISPER.CPP LOCALE (modello small): trascrizione INTERNA senza API esterne.
#   • Binario e modello arrivano con l'immagine Docker del VPS (deploy/axon-core/Dockerfile: build whisper.cpp + ggml-small.bin).
#   • Env: WHISPER_CPP_BIN (default /opt/whisper.cpp/build/bin/whisper-cli), WHISPER_CPP_MODEL (default /opt/whisper.cpp/models/ggml-small.bin),
#          WHISPER_CPP_THREADS (default: cpu_count, max 8), AXON_STT_PROVIDER = local | cloud | auto (default auto = locale se disponibile,
#          altrimenti Deepgram/OpenAI come prima).
#   • Pipeline: qualunque formato → ffmpeg → WAV 16 kHz mono → whisper-cli -l it -nt -otxt → testo. Timeout 90 s; su errore → fallback cloud.
#   • Integrazione: avvolge `_upl_whisper_path` (axon_uploads: /ai/transcribe/upload, multipart) e `ai_transcribe` (12: /ai/transcribe,
#     base64) — ENTRAMBE provano prima il motore locale. GET /ai/stt/status → stato del motore (per diagnostica Master).
import asyncio as _sl_asyncio
import os as _sl_os
import shutil as _sl_shutil
import tempfile as _sl_tempfile
import time as _sl_time

_SL_BIN = _sl_os.environ.get("WHISPER_CPP_BIN") or "/opt/whisper.cpp/build/bin/whisper-cli"
_SL_MODEL = _sl_os.environ.get("WHISPER_CPP_MODEL") or "/opt/whisper.cpp/models/ggml-small.bin"
_SL_THREADS = str(min(8, max(1, int(_sl_os.environ.get("WHISPER_CPP_THREADS") or (_sl_os.cpu_count() or 2)))))
_SL_STATS = {"ok": 0, "fail": 0, "last_ms": None, "last_error": None}


def _stt_local_available() -> bool:
    prov = (_sl_os.environ.get("AXON_STT_PROVIDER") or "auto").lower()
    if prov == "cloud":
        return False
    return _sl_os.path.isfile(_SL_BIN) and _sl_os.access(_SL_BIN, _sl_os.X_OK) and _sl_os.path.isfile(_SL_MODEL)


async def _stt_local_transcribe(path: str, lang: str = "it") -> str:
    """Trascrive il file audio `path` con whisper.cpp. Solleva RuntimeError su errore (il chiamante fa fallback cloud)."""
    t0 = _sl_time.time()
    work = _sl_tempfile.mkdtemp(prefix="axon-stt-")
    wav = _sl_os.path.join(work, "in.wav")
    base = _sl_os.path.join(work, "out")
    try:
        ff = _sl_shutil.which("ffmpeg") or "ffmpeg"
        p = await _sl_asyncio.create_subprocess_exec(ff, "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav,
                                                     stdout=_sl_asyncio.subprocess.DEVNULL, stderr=_sl_asyncio.subprocess.PIPE)
        _, err = await _sl_asyncio.wait_for(p.communicate(), timeout=60)
        if p.returncode != 0 or not _sl_os.path.isfile(wav):
            raise RuntimeError(f"ffmpeg: {(err or b'').decode(errors='ignore')[:200]}")
        p = await _sl_asyncio.create_subprocess_exec(_SL_BIN, "-m", _SL_MODEL, "-f", wav, "-l", lang, "-t", _SL_THREADS, "-nt", "-otxt", "-of", base,
                                                     "-np", stdout=_sl_asyncio.subprocess.DEVNULL, stderr=_sl_asyncio.subprocess.PIPE)
        _, err = await _sl_asyncio.wait_for(p.communicate(), timeout=90)
        txt_path = base + ".txt"
        if p.returncode != 0 or not _sl_os.path.isfile(txt_path):
            raise RuntimeError(f"whisper-cli rc={p.returncode}: {(err or b'').decode(errors='ignore')[-200:]}")
        with open(txt_path, encoding="utf-8", errors="ignore") as fh:
            text = " ".join(line.strip() for line in fh if line.strip())
        _SL_STATS["ok"] += 1; _SL_STATS["last_ms"] = int((_sl_time.time() - t0) * 1000)
        return text.strip()
    except Exception as e:  # noqa: BLE001
        _SL_STATS["fail"] += 1; _SL_STATS["last_error"] = str(e)[:300]
        raise
    finally:
        _sl_shutil.rmtree(work, ignore_errors=True)


# ── wrap 1: multipart (/ai/transcribe/upload) ──────────────────────────────────────────────────────────────────────────────
_sl_orig_upl_whisper_path = _upl_whisper_path  # noqa: F821 — axon_uploads.py


async def _upl_whisper_path(path: str) -> str:  # noqa: F811
    if _stt_local_available():
        try:
            return await _stt_local_transcribe(path)
        except Exception as e:  # noqa: BLE001
            logger.warning("[stt-local] whisper.cpp fallito (%s) → fallback cloud", str(e)[:160])  # noqa: F821
    return await _sl_orig_upl_whisper_path(path)


# ── wrap 2: base64 (/ai/transcribe — Axon Drive, chat vocale, dettatura): pattern del progetto = rimuovo la route e la ri-registro
_sl_orig_ai_transcribe = None
for _r in list(api_router.routes):  # noqa: F821
    if getattr(_r, "path", "").endswith("/ai/transcribe") and "POST" in (getattr(_r, "methods", None) or set()):
        _sl_orig_ai_transcribe = _r.endpoint
        api_router.routes.remove(_r)  # noqa: F821
        break


if _sl_orig_ai_transcribe is not None:
    @api_router.post("/ai/transcribe")  # noqa: F821
    async def ai_transcribe(body: AIVoiceIn, user=Depends(get_current_user)):  # noqa: F811, F821
        if _stt_local_available():
            path = None
            try:
                b64 = body.audio_base64.split(",", 1)[1] if body.audio_base64.startswith("data:") else body.audio_base64
                audio_bytes = base64.b64decode(b64)  # noqa: F821
                if 1024 <= len(audio_bytes) <= 25 * 1024 * 1024:
                    ext = _sniff_audio_ext(audio_bytes, (body.mime or "").lower())  # noqa: F821
                    with _sl_tempfile.NamedTemporaryFile(suffix=ext or ".bin", delete=False) as tmp:
                        tmp.write(audio_bytes); path = tmp.name
                    vp_task = _sl_asyncio.create_task(vp_verify_for_user(user, audio_bytes, body.mime)) if getattr(body, "verify_speaker", False) else None  # noqa: F821
                    text = await _stt_local_transcribe(path)
                    out = {"transcript": text, "language": "it", "model": "whisper.cpp-small-local", "provider": "local"}
                    if vp_task is not None:  # stessa semantica dell'endpoint originale (voce sconosciuta → transcript vuoto)
                        vp = await vp_task
                        if vp is not None and not vp.get("match"):
                            return {"transcript": "", "reason": "unknown_voice", "silent": True, "speaker": None, "score": vp.get("score"), "language": "it", "model": out["model"]}
                        out["speaker"] = (vp or {}).get("profile"); out["speaker_score"] = (vp or {}).get("score")
                    return out
            except Exception as e:  # noqa: BLE001
                logger.warning("[stt-local] whisper.cpp fallito (%s) → fallback cloud", str(e)[:160])  # noqa: F821
            finally:
                if path:
                    try: _sl_os.unlink(path)
                    except Exception: pass
        return await _sl_orig_ai_transcribe(body, user)


@api_router.get("/ai/stt/status")  # noqa: F821
async def ai_stt_status(user=Depends(get_current_user)):  # noqa: F821
    return {"provider": "local" if _stt_local_available() else ("deepgram" if _sl_os.environ.get("DEEPGRAM_API_KEY") else "openai-whisper"),
            "local_available": _stt_local_available(), "bin": _SL_BIN, "model": _SL_MODEL, "threads": _SL_THREADS,
            "mode": (_sl_os.environ.get("AXON_STT_PROVIDER") or "auto"), "stats": _SL_STATS}
