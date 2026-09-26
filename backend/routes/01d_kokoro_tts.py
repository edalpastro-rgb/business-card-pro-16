# 01d_kokoro_tts.py — V50.z347 — VOCE LOCALE DI AXON: Kokoro-82M (Apache 2.0) via onnxruntime sul server, zero costi cloud.
# • Modello fp32 (~325 MB) + voci (~28 MB) scaricati al primo avvio in assets/kokoro (non in git) e caricati UNA volta in
#   processo (onnxruntime rilascia il GIL → inferenza in thread, max 2 in parallelo). ~1,7 s per 6 s di audio su 4 thread.
# • Uscita MP3 (lameenc, 48 kbps mono 24 kHz) in base64 → stesso contratto di /assistant/tts (audio_base64 + mime).
# • Motore per utente: user_settings.assistant_tts_engine = "local" (Kokoro, default) | "cloud" (OpenAI via Emergent).
#   Fallback automatico a OpenAI se il modello non è pronto, la lingua non è supportata da Kokoro o la sintesi fallisce.
# • Voci Kokoro esposte all'app: «sara» (F) e «nicola» (M); le voci OpenAI (nova, onyx…) vengono mappate per genere.

import time as _kk_time

KOKORO_DIR = Path(__file__).resolve().parent.parent / "assets" / "kokoro"
KOKORO_FILES = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}
KOKORO_THREADS = 4
KOKORO_LANGS = {"it": "it", "en": "en-us", "es": "es", "fr": "fr-fr", "pt": "pt-br", "zh": "cmn", "hi": "hi", "ja": "ja"}
# (F, M) per lingua — se manca il genere si usa l'altro
KOKORO_VOICES_BY_LANG = {"it": ("if_sara", "im_nicola"), "en": ("af_heart", "am_michael"), "es": ("ef_dora", "em_alex"), "fr": ("ff_siwis", "ff_siwis"),
                         "pt": ("pf_dora", "pm_alex"), "zh": ("zf_xiaobei", "zm_yunjian"), "hi": ("hf_alpha", "hm_omega"), "ja": ("jf_alpha", "jm_kumo")}
KOKORO_APP_VOICES = {"sara": "F", "nicola": "M"}                     # voci «locali» scelte nell'app
OPENAI_VOICES = {"alloy": "F", "ash": "M", "coral": "F", "echo": "M", "fable": "F", "nova": "F", "onyx": "M", "sage": "F", "shimmer": "F"}
_kk_log = logging.getLogger("kokoro")
_kk_state: Dict[str, Any] = {"model": None, "ready": False, "loading": False, "error": None, "loaded_at": None, "gen_count": 0, "gen_ms_total": 0.0}
_kk_sem = asyncio.Semaphore(2)
_kk_lock = asyncio.Lock()


def _kk_download(name: str, url: str) -> None:
    dest = KOKORO_DIR / name
    if dest.exists() and dest.stat().st_size > 1_000_000:
        return
    KOKORO_DIR.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    _kk_log.info("[kokoro] download %s …", name)
    with httpx.stream("GET", url, follow_redirects=True, timeout=600) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    tmp.replace(dest)
    _kk_log.info("[kokoro] %s pronto (%d MB)", name, dest.stat().st_size >> 20)


def _kk_load_sync() -> None:
    for name, url in KOKORO_FILES.items():
        _kk_download(name, url)
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    so = ort.SessionOptions()
    so.intra_op_num_threads = KOKORO_THREADS
    so.log_severity_level = 3
    sess = ort.InferenceSession(str(KOKORO_DIR / "kokoro-v1.0.onnx"), so, providers=["CPUExecutionProvider"])
    model = Kokoro.from_session(sess, str(KOKORO_DIR / "voices-v1.0.bin"))
    model.create("Pronto.", voice="if_sara", lang="it")  # warm-up
    _kk_state.update({"model": model, "ready": True, "error": None, "loaded_at": utcnow().isoformat()})


KOKORO_DISABLED = os.environ.get("KOKORO_DISABLE") == "1"  # V50.z373 — produzione (limite 1 GiB): niente modello locale, Axon usa la voce cloud


async def kokoro_ensure() -> bool:
    """Carica (e se serve scarica) il modello una sola volta. Ritorna True se pronto."""
    if _kk_state["ready"]:
        return True
    if KOKORO_DISABLED:
        _kk_state["error"] = "voce locale disattivata su questo server (KOKORO_DISABLE=1): in uso la voce cloud"
        return False
    async with _kk_lock:
        if _kk_state["ready"]:
            return True
        if _kk_state["loading"]:
            return False
        _kk_state["loading"] = True
        try:
            await asyncio.to_thread(_kk_load_sync)
            _kk_log.info("[kokoro] modello caricato")
        except Exception as exc:  # noqa: BLE001
            _kk_state["error"] = str(exc)[:300]
            _kk_log.warning("[kokoro] caricamento fallito: %s", exc)
        finally:
            _kk_state["loading"] = False
    return bool(_kk_state["ready"])


_KK_MD = [(re.compile(r"```.*?```", re.S), " "), (re.compile(r"`([^`]*)`"), r"\1"), (re.compile(r"!\[[^\]]*\]\([^)]*\)"), " "), (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),
          (re.compile(r"https?://\S+"), " link "), (re.compile(r"^\s{0,3}#{1,6}\s*", re.M), ""), (re.compile(r"^\s*[-*•]\s+", re.M), ""), (re.compile(r"[*_~|>]+"), ""),
          (re.compile(r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF]"), " "), (re.compile(r"[ \t]{2,}"), " ")]


def kokoro_clean_text(text: str) -> str:
    """Markdown/emoji → testo parlabile."""
    t = text or ""
    for rx, rep in _KK_MD:
        t = rx.sub(rep, t)
    return t.strip()


def kokoro_pick_voice(voice_key: Optional[str], lang: str) -> Optional[str]:
    """Voce Kokoro per (voce app, lingua). None se la lingua non è supportata."""
    if lang not in KOKORO_LANGS:
        return None
    vk = (voice_key or "").lower()
    gender = KOKORO_APP_VOICES.get(vk) or OPENAI_VOICES.get(vk) or "F"
    f, m = KOKORO_VOICES_BY_LANG[lang]
    return m if gender == "M" else f


def _kk_synth_sync(text: str, voice: str, lang: str, speed: float) -> bytes:
    import numpy as np
    import lameenc
    samples, sr = _kk_state["model"].create(text, voice=voice, speed=speed, lang=KOKORO_LANGS[lang])
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(int(sr))
    enc.set_channels(1)
    enc.set_quality(5)
    return bytes(enc.encode(pcm)) + bytes(enc.flush())


async def kokoro_tts(text: str, voice_key: Optional[str], lang: str, speed: float) -> Optional[Dict[str, Any]]:
    """Sintesi locale. None → il chiamante usa il fallback cloud."""
    voice = kokoro_pick_voice(voice_key, lang)
    if not voice:
        return None
    clean = kokoro_clean_text(text)
    if not clean:
        return None
    if not _kk_state["ready"]:
        if _kk_state["loading"]:
            return None
        if not await kokoro_ensure():
            return None
    t0 = _kk_time.monotonic()
    try:
        async with _kk_sem:
            mp3 = await asyncio.to_thread(_kk_synth_sync, clean, voice, lang, min(2.0, max(0.5, speed or 1.0)))
    except Exception as exc:  # noqa: BLE001
        _kk_log.warning("[kokoro] sintesi fallita (%s): %s", voice, exc)
        return None
    ms = (_kk_time.monotonic() - t0) * 1000
    _kk_state["gen_count"] += 1
    _kk_state["gen_ms_total"] += ms
    return {"audio_base64": base64.b64encode(mp3).decode("ascii"), "mime": "audio/mpeg", "voice": voice, "engine": "kokoro", "gen_ms": int(ms)}


# V50.z383 — Lingua della VOCE = lingua delle risposte (user_settings.assistant_language, default italiano).
# tts-1 non accetta la lingua e sulle frasi brevi «indovina» (accento/lingua sbagliati): usiamo gpt-4o-mini-tts con
# istruzioni esplicite sulla lingua; se non disponibile → tts-1 (stessa voce). Un solo motore per richiesta.
TTS_LANG_NAMES = {"it": "italiano", "en": "inglese", "es": "spagnolo", "fr": "francese", "de": "tedesco", "pt": "portoghese", "ro": "rumeno", "uk": "ucraino", "ar": "arabo", "zh": "cinese", "hi": "hindi", "ja": "giapponese"}


def _openai_tts_sync(key: str, text: str, voice: str, speed: float, lang: str) -> bytes:
    from litellm import speech
    from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech
    client = OpenAITextToSpeech(api_key=key)  # stessa configurazione proxy Emergent della libreria
    base = {"input": text, "voice": voice, "api_key": key}
    if client._is_emergent_key(key):
        base.update({"api_base": client.emergent_proxy_url, "custom_llm_provider": "openai"})
        if client.custom_headers:
            base["extra_headers"] = client.custom_headers
    lang_name = TTS_LANG_NAMES.get(lang, "italiano")
    pace = "leggermente più veloce del normale" if speed > 1.1 else ("leggermente più lento del normale" if speed < 0.9 else "naturale")
    instructions = (f"Leggi il testo esattamente così com'è, in {lang_name}, con pronuncia e intonazione da madrelingua {lang_name}. "
                    f"Non tradurre, non aggiungere nulla. Ritmo {pace}, tono professionale e cordiale.")
    try:
        r = speech(model="openai/gpt-4o-mini-tts", instructions=instructions, **base)
    except Exception as exc:  # noqa: BLE001 — modello non disponibile sul proxy → tts-1 classico
        _kk_log.warning("[tts] gpt-4o-mini-tts non disponibile (%s): fallback tts-1", str(exc)[:120])
        if speed != 1.0:
            base["speed"] = speed
        r = speech(model="openai/tts-1", **base)
    return r.content if hasattr(r, "content") else (r.read() if hasattr(r, "read") else bytes(r))


async def openai_tts(text: str, voice_key: Optional[str], speed: float, lang: str = "it") -> Dict[str, Any]:
    """Cloud (OpenAI via Emergent). Voci «locali» mappate per genere. La lingua segue le impostazioni dell'assistente."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY non configurato")
    vk = (voice_key or "").lower()
    if vk not in OPENAI_VOICES:
        vk = "onyx" if KOKORO_APP_VOICES.get(vk) == "M" else "nova"
    audio = await asyncio.to_thread(_openai_tts_sync, key, text[:4000], vk, min(2.0, max(0.5, speed or 1.0)), (lang or "it").lower())
    return {"audio_base64": base64.b64encode(audio).decode("ascii"), "mime": "audio/mpeg", "voice": vk, "engine": "openai", "lang": lang}


async def axon_tts_generate(user: dict, text: str, voice: Optional[str] = None, speed: Optional[float] = None) -> Dict[str, Any]:
    """Punto unico TTS: legge impostazioni utente (voce, lingua, velocità, motore) → Kokoro locale o OpenAI con fallback."""
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Testo mancante")
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"assistant_voice": 1, "assistant_speech_rate": 1, "assistant_language": 1, "assistant_tts_engine": 1}) or {}
    vk = (voice or "").strip().lower() or (s.get("assistant_voice") or "sara").lower()
    if vk not in OPENAI_VOICES and vk not in KOKORO_APP_VOICES:
        vk = "sara"
    try:
        spd = min(2.0, max(0.5, float(speed if speed is not None else (s.get("assistant_speech_rate") or 1.0))))
    except (TypeError, ValueError):
        spd = 1.0
    lang = (s.get("assistant_language") or "it").lower()
    engine = (s.get("assistant_tts_engine") or "local").lower()
    # V50.z383 — KOKORO_DISABLE=1 → UN SOLO motore (cloud OpenAI), qualunque sia la preferenza utente: mai due sintetizzatori.
    if engine != "cloud" and not KOKORO_DISABLED:
        out = await kokoro_tts(text[:4000], vk, lang, spd)
        if out:
            out["speed"] = spd
            return out
    try:
        out = await openai_tts(text, vk, spd, lang)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Errore TTS: {exc}")
    out["speed"] = spd
    return out


@api_router.get("/tts/engine")
async def tts_engine_status(user=Depends(get_current_user)):
    """Stato del motore vocale locale (per la schermata Voce di Axon)."""
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"assistant_tts_engine": 1}) or {}
    n = _kk_state["gen_count"]
    return {"engine": "cloud" if KOKORO_DISABLED else (s.get("assistant_tts_engine") or "local"), "local_ready": bool(_kk_state["ready"]), "local_loading": bool(_kk_state["loading"]), "local_error": _kk_state["error"], "local_disabled": KOKORO_DISABLED,
            "loaded_at": _kk_state["loaded_at"], "generations": n, "avg_ms": int(_kk_state["gen_ms_total"] / n) if n else None,
            "files": {k: (KOKORO_DIR / k).exists() for k in KOKORO_FILES}, "languages": sorted(KOKORO_LANGS), "cloud_available": bool(os.environ.get("EMERGENT_LLM_KEY"))}


@api_router.post("/tts/engine/warmup")
async def tts_engine_warmup(user=Depends(get_current_user)):
    """Avvia (se serve) download + caricamento del modello locale senza bloccare la richiesta."""
    if not _kk_state["ready"] and not _kk_state["loading"]:
        _kk_state["error"] = None
        asyncio.create_task(kokoro_ensure())
    return {"local_ready": bool(_kk_state["ready"]), "local_loading": bool(_kk_state["loading"]) or not _kk_state["ready"]}


@app.on_event("startup")
async def _kokoro_startup_warmup():
    if os.environ.get("KOKORO_DISABLE") == "1":
        return
    asyncio.create_task(kokoro_ensure())
