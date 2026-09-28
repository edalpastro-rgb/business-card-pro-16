# audio_transcripts.py — V50.z389 — FUNZIONALITÀ 4 · TRASCRIZIONE E PULIZIA AUDIO GLOBALE.
# Ogni audio caricato OVUNQUE nell'app (Trattativa ANT, Corsi, Axon Lite/Media, aree future) passa da qui:
#   1) Whisper trascrive (audio lungo: ricodifica mp3 mono 32k + segmenti da 20 min → nessun limite pratico di durata);
#   2) un LLM pulisce il testo: via riempitivi («allora», «cioè», «ehm», «praticamente»…), grammatica corretta,
#      filo logico chiaro in paragrafi — MAI riassume, MAI inventa;
#   3) bozza mostrata a chi ha caricato → «Vuoi modificare qualcosa prima di salvare?» → PUT con publish=true;
#   4) testo pubblicato: SOLO lettura in app per gli utenti del tenant autorizzati; mai scaricabile.
#   L'audio originale resta salvato ma è accessibile SOLO a Master / Super Master (la regola è applicata dai moduli sorgente).
# Uso dai moduli sorgente:  tid_ = await audio_transcript_start(user, raw, mime, name, source_kind, source_id, title)
# Collection: audio_transcripts {transcript_id, tenant_id, source_kind, source_id, title, uploaded_by, status:
#   transcribing|draft|published|failed, raw_text, clean_text, text, error, created_at, updated_at, published_at}
import asyncio as _at_asyncio
import os as _at_os
import subprocess as _at_subprocess
import tempfile as _at_tempfile
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

AT_CHUNK_SEC = 20 * 60          # segmenti Whisper da 20 minuti
AT_WHISPER_MAX = 24 * 1024 * 1024
AT_LLM_CHUNK = 11000            # caratteri per chiamata LLM di pulizia
AT_FILLERS = r"\b(allora|cioè|ehm|ehmm|mmh|praticamente|diciamo|insomma|tipo|okay|ok|niente|quindi niente|come dire|voglio dire|appunto|ecco)\b"

AT_CLEAN_SYSTEM = (
    "Sei un editor professionale italiano. Ricevi la TRASCRIZIONE GREZZA di un audio (formazione, trattativa commerciale, nota vocale). "
    "Restituisci SOLO il testo ripulito, senza titoli, senza commenti, senza markdown.\n"
    "REGOLE ASSOLUTE:\n"
    "1) Rimuovi le parole di contesto e i riempitivi («allora», «cioè», «ehm», «praticamente», «diciamo», «insomma», «tipo», «okay», «niente», ripetizioni, false partenze).\n"
    "2) Correggi gli errori grammaticali, di punteggiatura e di trascrizione (nomi, numeri, termini tecnici plausibili nel contesto).\n"
    "3) Struttura il contenuto in un filo logico chiaro con PARAGRAFI separati da una riga vuota, nell'ordine in cui è stato detto.\n"
    "4) NON riassumere, NON tagliare contenuti, NON aggiungere informazioni non presenti: ogni concetto, dato, numero e nome deve restare.\n"
    "5) Mantieni la prima persona e il registro di chi parla; se ci sono più voci, indica i turni con un trattino iniziale."
)


def _at_is_master(user: dict) -> bool:
    return is_owner(user) or is_admin_or_owner(user)  # noqa: F821 — 02_models


async def _at_can_manage(user: dict) -> bool:
    """Master (tenant root / admin) oppure Manager con collaboratori sotto di sé."""
    if _at_is_master(user):
        return True
    return bool(await db.users.find_one({"parent_user_id": user["user_id"]}, {"_id": 1}))  # noqa: F821


def _at_out(d: Optional[dict], full: bool = False) -> Optional[dict]:
    if not d:
        return None
    hide = {"_id"} if full else {"_id", "raw_text"}
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items() if k not in hide}


def _at_ffmpeg_sync(raw: bytes, ext: str) -> List[str]:
    """Ricodifica mono mp3 32k (Whisper-friendly, ~14 MB/ora) e, se lungo, segmenta in file da AT_CHUNK_SEC. Ritorna i path (tempdir da rimuovere)."""
    td = _at_tempfile.mkdtemp(prefix="at_")
    src = _at_os.path.join(td, f"in.{ext or 'bin'}")
    with open(src, "wb") as f:
        f.write(raw)
    if not MC_FFMPEG:  # noqa: F821 — media_compress
        return [src]
    pattern = _at_os.path.join(td, "part_%03d.mp3")
    _at_subprocess.run([MC_FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k",  # noqa: F821
                        "-f", "segment", "-segment_time", str(AT_CHUNK_SEC), "-reset_timestamps", "1", pattern],
                       check=True, timeout=1800, stdout=_at_subprocess.DEVNULL, stderr=_at_subprocess.PIPE)
    parts = sorted(_at_os.path.join(td, p) for p in _at_os.listdir(td) if p.startswith("part_"))
    return parts or [src]


async def audio_transcribe_long(raw: bytes, mime: str, name: str) -> str:
    """Whisper su audio di qualsiasi durata (segmenti da 20 min)."""
    ext = _mc_ext(name, mime) or "m4a"  # noqa: F821 — media_compress
    parts = await _at_asyncio.get_event_loop().run_in_executor(None, _at_ffmpeg_sync, raw, ext)
    texts: List[str] = []
    try:
        for p in parts:
            if _at_os.path.getsize(p) > AT_WHISPER_MAX:
                raise HTTPException(status_code=413, detail="Segmento audio troppo grande per la trascrizione")
            texts.append(await _upl_whisper_path(p))  # noqa: F821 — axon_uploads
    finally:
        for p in parts:
            try: _at_os.unlink(p)
            except Exception: pass  # noqa: BLE001
        try: _at_os.rmdir(_at_os.path.dirname(parts[0]))
        except Exception: pass  # noqa: BLE001
    return "\n".join(t for t in texts if t).strip()


def _at_quick_clean(text: str) -> str:
    """Fallback deterministico se l'LLM non risponde: toglie i riempitivi più comuni e sistema gli spazi."""
    import re as _re
    t = _re.sub(AT_FILLERS, "", text, flags=_re.IGNORECASE)
    t = _re.sub(r"\s+([,.;:!?])", r"\1", t); t = _re.sub(r"[ \t]{2,}", " ", t); t = _re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


async def audio_clean_text(raw_text: str) -> str:
    """LLM: riempitivi via, grammatica, paragrafi. Testi lunghi → blocchi da AT_LLM_CHUNK caratteri (spezzati su frase)."""
    text = (raw_text or "").strip()
    if not text:
        return ""
    chunks: List[str] = []
    while len(text) > AT_LLM_CHUNK:
        cut = max(text.rfind(". ", 0, AT_LLM_CHUNK), text.rfind("\n", 0, AT_LLM_CHUNK), int(AT_LLM_CHUNK * 0.7))
        chunks.append(text[:cut + 1]); text = text[cut + 1:]
    chunks.append(text)
    out: List[str] = []
    for i, c in enumerate(chunks):
        try:
            hint = "" if len(chunks) == 1 else f" (Parte {i + 1} di {len(chunks)}: continua il testo, nessuna introduzione.)"
            r = await _cgym_llm(AT_CLEAN_SYSTEM + hint, f"TRASCRIZIONE GREZZA:\n{c}", model="claude-sonnet-4-5")  # noqa: F821 — corporate_gym
            out.append((r or "").strip() or _at_quick_clean(c))
        except Exception as exc:  # noqa: BLE001
            logger.warning("[audio-transcripts] pulizia LLM fallita (blocco %s): %s", i, str(exc)[:200])  # noqa: F821
            out.append(_at_quick_clean(c))
    return "\n\n".join(out).strip()


async def _at_run(transcript_id: str, raw: bytes, mime: str, name: str) -> None:
    upd: Dict[str, Any] = {}
    try:
        raw_text = await audio_transcribe_long(raw, mime, name)
        if len(raw_text) < 5:
            raise RuntimeError("Nessuna voce riconosciuta nell'audio")
        clean = await audio_clean_text(raw_text)
        upd = {"status": "draft", "raw_text": raw_text[:400000], "clean_text": clean[:400000], "text": clean[:400000], "error": None}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[audio-transcripts] %s fallita: %s", transcript_id, str(exc)[:300])  # noqa: F821
        upd = {"status": "failed", "error": str(getattr(exc, "detail", None) or exc)[:300]}
    upd["updated_at"] = utcnow()  # noqa: F821
    await db.audio_transcripts.update_one({"transcript_id": transcript_id}, {"$set": upd})  # noqa: F821
    # notifica a chi ha caricato: bozza pronta da rivedere
    try:
        d = await db.audio_transcripts.find_one({"transcript_id": transcript_id}, {"_id": 0, "uploaded_by": 1, "tenant_id": 1, "title": 1})  # noqa: F821
        if d and upd.get("status") == "draft":
            await axon_notify(d["uploaded_by"], d["tenant_id"], "reminder", "📝 Trascrizione pronta", f"«{d.get('title') or 'audio'}»: rivedila e conferma il salvataggio.", deeplink=f"/audio-transcript/{transcript_id}", dedupe_key=f"atr-ready-{transcript_id}")  # noqa: F821
    except Exception:  # noqa: BLE001
        pass


async def audio_transcript_start(user: dict, raw: bytes, mime: str, name: str, source_kind: str, source_id: str, title: Optional[str] = None) -> str:
    """Crea il record e avvia trascrizione+pulizia in background. Ritorna transcript_id (da salvare sulla sorgente)."""
    tid = tenant_id(user)  # noqa: F821
    d = {"transcript_id": f"atr_{uuid.uuid4().hex[:12]}", "tenant_id": tid, "source_kind": source_kind, "source_id": source_id, "title": (title or name or "Audio")[:160],  # noqa: F821
         "audio_name": (name or "")[:160], "audio_mime": mime, "audio_size": len(raw), "uploaded_by": user["user_id"], "status": "transcribing",
         "raw_text": None, "clean_text": None, "text": None, "error": None, "created_at": utcnow(), "updated_at": utcnow(), "published_at": None}  # noqa: F821
    await db.audio_transcripts.insert_one(dict(d))  # noqa: F821
    _at_asyncio.create_task(_at_run(d["transcript_id"], raw, mime, name))
    return d["transcript_id"]


async def _at_get(transcript_id: str, user: dict) -> dict:
    d = await db.audio_transcripts.find_one({"transcript_id": transcript_id, "tenant_id": tenant_id(user)})  # noqa: F821
    if not d:
        raise HTTPException(status_code=404, detail="Trascrizione non trovata")
    return d


def _at_can_edit(d: dict, user: dict) -> bool:
    return d.get("uploaded_by") == user["user_id"] or _at_is_master(user)


class AtUpdateIn(BaseModel):
    text: Optional[str] = None
    title: Optional[str] = None
    publish: bool = False


@api_router.get("/audio-transcripts")  # noqa: F821
async def at_list(source_kind: Optional[str] = None, source_id: Optional[str] = None, status: Optional[str] = None, user=Depends(get_current_user)):  # noqa: F821
    """Lista: chi carica / Master vede anche bozze e fallite; gli altri utenti SOLO le pubblicate (testo in sola lettura)."""
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}  # noqa: F821
    if source_kind: q["source_kind"] = source_kind
    if source_id: q["source_id"] = source_id
    if status: q["status"] = status
    master = _at_is_master(user)
    if not master:
        q["$or"] = [{"status": "published"}, {"uploaded_by": user["user_id"]}]
    rows = await db.audio_transcripts.find(q, {"raw_text": 0, "clean_text": 0}).sort("created_at", -1).to_list(200)  # noqa: F821
    items = []
    for r in rows:
        o = _at_out(r) or {}
        o["can_edit"] = _at_can_edit(r, user)
        if r.get("status") != "published" and not o["can_edit"]:
            o["text"] = None
        items.append(o)
    return {"items": items, "is_master": master}


@api_router.get("/audio-transcripts/{transcript_id}")  # noqa: F821
async def at_get(transcript_id: str, user=Depends(get_current_user)):  # noqa: F821
    d = await _at_get(transcript_id, user)
    can_edit = _at_can_edit(d, user)
    if d.get("status") != "published" and not can_edit:
        raise HTTPException(status_code=403, detail="Trascrizione non ancora pubblicata")
    o = _at_out(d, full=can_edit) or {}
    o["can_edit"] = can_edit
    return o


@api_router.put("/audio-transcripts/{transcript_id}")  # noqa: F821
async def at_update(transcript_id: str, body: AtUpdateIn, user=Depends(get_current_user)):  # noqa: F821
    """Chi ha caricato (o il Master) modifica il testo e/o conferma → publish=true rende il testo leggibile agli utenti autorizzati."""
    d = await _at_get(transcript_id, user)
    if not _at_can_edit(d, user):
        raise HTTPException(status_code=403, detail="Solo chi ha caricato l'audio o il Master può modificare la trascrizione")
    if d.get("status") == "transcribing":
        raise HTTPException(status_code=409, detail="Trascrizione ancora in corso")
    upd: Dict[str, Any] = {"updated_at": utcnow()}  # noqa: F821
    if body.text is not None:
        upd["text"] = body.text.strip()[:400000]
    if body.title:
        upd["title"] = body.title.strip()[:160]
    if body.publish:
        if not (upd.get("text") or d.get("text")):
            raise HTTPException(status_code=400, detail="Testo vuoto: non posso pubblicare")
        upd["status"] = "published"; upd["published_at"] = utcnow(); upd["published_by"] = user["user_id"]  # noqa: F821
    await db.audio_transcripts.update_one({"transcript_id": transcript_id}, {"$set": upd})  # noqa: F821
    o = _at_out({**d, **upd}, full=True) or {}
    o["can_edit"] = True
    return o


@api_router.post("/audio-transcripts/{transcript_id}/unpublish")  # noqa: F821
async def at_unpublish(transcript_id: str, user=Depends(get_current_user)):  # noqa: F821
    d = await _at_get(transcript_id, user)
    if not _at_can_edit(d, user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.audio_transcripts.update_one({"transcript_id": transcript_id}, {"$set": {"status": "draft", "published_at": None, "updated_at": utcnow()}})  # noqa: F821
    return {"ok": True}


@api_router.post("/audio-transcripts/{transcript_id}/retry")  # noqa: F821
async def at_retry(transcript_id: str, user=Depends(get_current_user)):  # noqa: F821
    """Ripete SOLO la pulizia LLM partendo dalla trascrizione grezza (se c'è); altrimenti segnala che serve ricaricare l'audio."""
    d = await _at_get(transcript_id, user)
    if not _at_can_edit(d, user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    if not d.get("raw_text"):
        raise HTTPException(status_code=400, detail="Trascrizione grezza assente: ricarica l'audio")
    clean = await audio_clean_text(d["raw_text"])
    await db.audio_transcripts.update_one({"transcript_id": transcript_id}, {"$set": {"clean_text": clean, "text": clean, "status": "draft", "error": None, "updated_at": utcnow()}})  # noqa: F821
    return _at_out({**d, "clean_text": clean, "text": clean, "status": "draft"}, full=True)


@api_router.delete("/audio-transcripts/{transcript_id}")  # noqa: F821
async def at_delete(transcript_id: str, user=Depends(get_current_user)):  # noqa: F821
    d = await _at_get(transcript_id, user)
    if not _at_can_edit(d, user):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    await db.audio_transcripts.delete_one({"transcript_id": transcript_id})  # noqa: F821
    return {"ok": True}
