# axon_stt_chunks.py — V50.z575 — TRASCRIZIONE A SEGMENTI DURANTE LA REGISTRAZIONE (STT incrementale).
# Prima: l'app inviava l'intero audio DOPO lo stop → 20-30 s di attesa (whisper.cpp sul VPS lavora ~1x tempo reale) prima che
# il messaggio vocale comparisse in chat. Ora il client ruota il registratore ogni ~5 s e invia ogni segmento appena chiuso a
# POST /ai/transcribe/chunk {session_id, index, audio_base64, mime, final}: il server lo trascrive SUBITO in background (stessa
# catena provider di /ai/transcribe: whisper.cpp locale → Deepgram → OpenAI Whisper), mentre l'utente continua a parlare.
# Allo stop l'ultimo segmento arriva con final=true: il server attende solo i segmenti ancora in corso (di norma l'ultimo, breve)
# e restituisce il testo completo in ordine → attesa percepita ≈ trascrizione di 5 s di audio, non di tutto il messaggio.
# Sessioni in memoria (processo singolo), scadenza 10 min; max 2 trascrizioni locali in parallelo (CPU del VPS condivisa con la chat).
import asyncio as _sc_asyncio
import time as _sc_time
from typing import Dict as _sc_Dict

_SC_SESSIONS: _sc_Dict[str, dict] = {}
_SC_SEM = _sc_asyncio.Semaphore(2)
_SC_TTL_S = 600
_SC_STATS = {"sessions": 0, "chunks": 0, "final_wait_ms_last": 0}


class STTChunkIn(BaseModel):  # noqa: F821
    session_id: str
    index: int
    audio_base64: str = ""
    mime: Optional[str] = "audio/m4a"  # noqa: F821
    final: bool = False


def _sc_prune() -> None:
    now = _sc_time.time()
    for sid in [s for s, v in _SC_SESSIONS.items() if now - v["ts"] > _SC_TTL_S]:
        for t in _SC_SESSIONS[sid]["tasks"].values():
            t.cancel()
        _SC_SESSIONS.pop(sid, None)


async def _sc_transcribe_one(body: STTChunkIn, user: dict) -> str:
    async with _SC_SEM:
        try:
            out = await ai_transcribe(AIVoiceIn(audio_base64=body.audio_base64, mime=body.mime or "audio/m4a"), user)  # noqa: F821 — route corrente (/ai/transcribe, wrap whisper.cpp → cloud)
            return (out or {}).get("transcript") or ""
        except Exception as e:  # noqa: BLE001
            logger.warning("[stt-chunk] segmento %s/%d fallito: %s", body.session_id[:8], body.index, str(e)[:160])  # noqa: F821
            return ""


@api_router.post("/ai/transcribe/chunk")  # noqa: F821
async def ai_transcribe_chunk(body: STTChunkIn, user=Depends(get_current_user)):  # noqa: F821
    """Segmento audio autonomo (file completo con header) → trascrizione in background. final=true → testo completo della sessione."""
    _sc_prune()
    sid = (body.session_id or "").strip()[:64]
    if not sid:
        raise HTTPException(status_code=400, detail="session_id mancante")  # noqa: F821
    sess = _SC_SESSIONS.get(sid)
    if sess is None:
        sess = _SC_SESSIONS[sid] = {"user_id": user["user_id"], "tasks": {}, "ts": _sc_time.time(), "t0": _sc_time.time()}
        _SC_STATS["sessions"] += 1
    if sess["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="sessione di un altro utente")  # noqa: F821
    sess["ts"] = _sc_time.time()
    b64 = body.audio_base64 or ""
    if len(b64) >= 700 and body.index not in sess["tasks"]:   # < ~500 byte = segmento vuoto (rotazione a vuoto): ignorato
        sess["tasks"][body.index] = _sc_asyncio.create_task(_sc_transcribe_one(body, user))
        _SC_STATS["chunks"] += 1
    if not body.final:
        return {"ok": True, "session_id": sid, "queued": len(sess["tasks"]), "done": sum(1 for t in sess["tasks"].values() if t.done())}
    # FINAL: attende i segmenti in corso (in ordine), compone il testo, chiude la sessione
    t0 = _sc_time.time()
    texts = []
    for idx in sorted(sess["tasks"]):
        try:
            texts.append(await _sc_asyncio.wait_for(_sc_asyncio.shield(sess["tasks"][idx]), timeout=max(5.0, 95.0 - (_sc_time.time() - t0))))
        except Exception as e:  # noqa: BLE001
            logger.warning("[stt-chunk] attesa segmento %d: %s", idx, str(e)[:120])  # noqa: F821
    _SC_SESSIONS.pop(sid, None)
    transcript = " ".join(t.strip() for t in texts if t and t.strip())
    _SC_STATS["final_wait_ms_last"] = int((_sc_time.time() - t0) * 1000)
    logger.info("[stt-chunk] sessione %s: %d segmenti, attesa finale %d ms, %d car.", sid[:8], len(texts), _SC_STATS["final_wait_ms_last"], len(transcript))  # noqa: F821
    return {"transcript": transcript, "chunks": len(texts), "final_wait_ms": _SC_STATS["final_wait_ms_last"], "language": "it"}


@api_router.get("/ai/transcribe/chunk/status")  # noqa: F821
async def ai_transcribe_chunk_status(user=Depends(get_current_user)):  # noqa: F821
    _sc_prune()
    return {"open_sessions": len(_SC_SESSIONS), **_SC_STATS}
