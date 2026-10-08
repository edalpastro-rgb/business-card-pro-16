# call_transcripts.py — V50.z459 — PROMPT 20: TRASCRIZIONE AUTOMATICA DELLE CHIAMATE (scheda cliente → tab «Chiamate»).
# Flusso: upload audio (mp3/m4a/wav/ogg) → Deepgram (nova-3, it, diarizzazione) → trascrizione «Venditore / Cliente» →
# estrazione strutturata con Anthropic (ANTHROPIC_API_KEY diretta se presente, altrimenti Emergent LLM Key, Claude Sonnet) →
# schermata di conferma con campi precompilati (modificabili) → SOLO dopo la conferma: nota + stato deal + budget +
# prossima azione + richiamata nel CRM. Campo non ricavabile = vuoto (mai inventato).
# Profilo (scelto al primo utilizzo, salvato in user_settings.call_profile): Agente di Commercio | Consulente B2B |
# Libero Professionista → decide campi extra e linguaggio.
import json as _ct_json
import os as _ct_os
import re as _ct_re
import uuid as _ct_uuid
import zoneinfo as _ct_zi
from datetime import datetime as _ct_dt, timezone as _ct_tz
from typing import Any as _ct_Any, Dict as _ct_Dict, List as _ct_List, Optional as _ct_Optional

import httpx as _ct_httpx
from fastapi import File as _CtFile, Form as _CtForm, UploadFile as _CtUploadFile

_CT_ROME = _ct_zi.ZoneInfo("Europe/Rome")
_CT_ALLOWED = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg"}
_CT_MAX_BYTES = 80 * 1024 * 1024
_CT_DEAL_STATUS = ("in_corso", "chiuso_vinto", "chiuso_perso", "da_ricontattare", "in_attesa")
_CT_DEAL_LABEL = {"in_corso": "In corso", "chiuso_vinto": "Chiuso (vinto)", "chiuso_perso": "Chiuso (perso)", "da_ricontattare": "Da ricontattare", "in_attesa": "In attesa del cliente"}

# campi COMUNI (richiesti dal prompt) + campi EXTRA per profilo. type: text | textarea | select | money | date
_CT_COMMON_FIELDS = [
    {"key": "summary", "label": "Sintesi della chiamata", "type": "textarea"},
    {"key": "deal_status", "label": "Stato della trattativa", "type": "select", "options": [{"key": k, "label": v} for k, v in _CT_DEAL_LABEL.items()]},
    {"key": "budget", "label": "Budget dichiarato dal cliente", "type": "money"},
    {"key": "next_action", "label": "Prossima azione concordata", "type": "text"},
    {"key": "next_contact_at", "label": "Data del prossimo contatto", "type": "date"},
]
CALL_PROFILES = {
    "agente_commercio": {
        "label": "Agente di Commercio", "desc": "Vendita diretta: ordini, prodotti, quantità, obiezioni",
        "language": "linguaggio commerciale, diretto e concreto; parla di ordine, prodotti, quantità, prezzo, consegna",
        "extra": [{"key": "products", "label": "Prodotti / quantità di interesse", "type": "text"},
                  {"key": "objections", "label": "Obiezioni emerse", "type": "text"}],
    },
    "consulente_b2b": {
        "label": "Consulente B2B", "desc": "Trattative aziendali: decisori, esigenze, processo d'acquisto",
        "language": "linguaggio consulenziale e professionale; parla di esigenze, decisori, processo decisionale, valore",
        "extra": [{"key": "decision_makers", "label": "Decisori coinvolti", "type": "text"},
                  {"key": "pain_points", "label": "Esigenze / criticità del cliente", "type": "text"}],
    },
    "libero_professionista": {
        "label": "Libero Professionista", "desc": "Incarichi e prestazioni: servizio richiesto, tempi, urgenza",
        "language": "linguaggio professionale e personale; parla di incarico, prestazione, tempi, onorario",
        "extra": [{"key": "service", "label": "Servizio / incarico richiesto", "type": "text"},
                  {"key": "deadline", "label": "Tempi / urgenza", "type": "text"}],
    },
}


def _ct_fields(profile: str) -> _ct_List[dict]:
    return _CT_COMMON_FIELDS + (CALL_PROFILES.get(profile) or {}).get("extra", [])


def _ct_profiles_payload(profile: _ct_Optional[str]) -> dict:
    return {"profile": profile if profile in CALL_PROFILES else None,
            "profiles": [{"key": k, "label": v["label"], "desc": v["desc"]} for k, v in CALL_PROFILES.items()],
            "fields": _ct_fields(profile) if profile in CALL_PROFILES else []}


async def _ct_user_profile(user: dict) -> _ct_Optional[str]:
    s = await db.user_settings.find_one({"user_id": user["user_id"]}, {"call_profile": 1}) or {}  # noqa: F821
    p = s.get("call_profile")
    return p if p in CALL_PROFILES else None


# ---- Deepgram -------------------------------------------------------------------------------------------------------------
async def _ct_deepgram(raw: bytes, mime: str) -> _ct_Dict[str, _ct_Any]:
    key = _ct_os.environ.get("DEEPGRAM_API_KEY") or ""
    if not key:
        raise RuntimeError("DEEPGRAM_API_KEY non configurata sul server")
    params = {"model": _ct_os.environ.get("DEEPGRAM_MODEL", "nova-3"), "language": "it", "diarize": "true", "utterances": "true", "smart_format": "true", "punctuate": "true"}
    async with _ct_httpx.AsyncClient(timeout=_ct_httpx.Timeout(240.0)) as client:
        r = await client.post("https://api.deepgram.com/v1/listen", params=params, headers={"Authorization": f"Token {key}", "Content-Type": mime}, content=raw)
    if r.status_code >= 400:
        raise RuntimeError(f"Deepgram HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    segs: _ct_List[dict] = []
    for u in (data.get("results") or {}).get("utterances") or []:
        t = (u.get("transcript") or "").strip()
        if t:
            segs.append({"speaker": int(u.get("speaker") or 0), "start": u.get("start"), "end": u.get("end"), "text": t})
    if not segs:  # fallback: parole raggruppate per speaker
        ch = (data.get("results") or {}).get("channels") or []
        words = ((ch[0].get("alternatives") or [{}])[0]).get("words", []) if ch else []
        cur = None
        for w in words:
            sp = int(w.get("speaker") or 0); tx = w.get("punctuated_word") or w.get("word") or ""
            if cur is None or cur["speaker"] != sp:
                if cur: segs.append(cur)
                cur = {"speaker": sp, "start": w.get("start"), "end": w.get("end"), "text": tx}
            else:
                cur["text"] += " " + tx; cur["end"] = w.get("end")
        if cur: segs.append(cur)
    meta = data.get("metadata") or {}
    return {"segments": segs, "duration": meta.get("duration"), "speakers": sorted({s["speaker"] for s in segs})}


# ---- estrazione strutturata (Anthropic) -------------------------------------------------------------------------------------
async def _ct_llm(system: str, prompt: str) -> str:
    direct = _ct_os.environ.get("ANTHROPIC_API_KEY") or ""
    if direct:  # chiave Anthropic diretta → litellm
        import litellm as _ct_litellm
        r = await _ct_litellm.acompletion(model="anthropic/claude-sonnet-4-5", api_key=direct, max_tokens=1500, temperature=0,
                                          messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}])
        return (r.choices[0].message.content or "").strip()
    key = _ct_os.environ.get("EMERGENT_LLM_KEY") or ""
    if not key:
        raise RuntimeError("Nessuna chiave LLM configurata (ANTHROPIC_API_KEY o EMERGENT_LLM_KEY)")
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(api_key=key, session_id=f"call-extract-{_ct_uuid.uuid4().hex[:8]}", system_message=system).with_model("anthropic", "claude-sonnet-4-5")
    return ((await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=90)) or "").strip()  # noqa: F821


async def _ct_extract(segments: _ct_List[dict], profile: str, contact_name: str, seller_name: str) -> _ct_Dict[str, _ct_Any]:
    prof = CALL_PROFILES[profile]
    fields = _ct_fields(profile)
    now = utcnow().astimezone(_CT_ROME)  # noqa: F821
    raw_lines = "\n".join(f"[S{s['speaker']}] {s['text']}" for s in segments)[:24000]
    def _typ(f: dict) -> str:
        if f["type"] == "select":
            return '"in_corso"|"chiuso_vinto"|"chiuso_perso"|"da_ricontattare"|"in_attesa"|null'
        return '"YYYY-MM-DD"|null' if f["type"] == "date" else "string|null"
    schema = ", ".join('"%s": %s' % (f["key"], _typ(f)) for f in fields)
    system = (
        f"Sei Axon, assistente CRM per un {prof['label'].lower()} italiano. Analizzi la trascrizione di una telefonata di vendita tra il venditore "
        f"({seller_name or 'il venditore'}) e il cliente ({contact_name or 'il cliente'}) e ne estrai dati strutturati. Usa {prof['language']}. "
        "REGOLE ASSOLUTE: (1) compila un campo SOLO se il dato è detto esplicitamente nella trascrizione, altrimenti null — MAI inventare, stimare o dedurre "
        "cifre, date, nomi; (2) la data del prossimo contatto SOLO se menzionata esplicitamente (converti espressioni relative come «la settimana prossima» "
        "solo se c'è un giorno preciso; altrimenti null); (3) budget = cifra o fascia DETTA dal cliente, come testo (es. «circa 1.500 €/anno»); "
        "(4) sintesi: 3-5 frasi, fatti e accordi, senza giudizi. Rispondi SOLO con JSON valido."
    )
    prompt = (
        f"OGGI: {now.strftime('%Y-%m-%d')} (Europe/Rome)\n\nTRASCRIZIONE (S0/S1 = parlanti anonimi della diarizzazione):\n{raw_lines}\n\n"
        f'Rispondi con: {{"seller_speaker": 0|1|null (quale S è il venditore, se riconoscibile), {schema}}}'
    )
    txt = await _ct_llm(system, prompt)
    if txt.startswith("```"):
        txt = _ct_re.sub(r"^```(?:json)?\n?|\n?```$", "", txt).strip()
    data = _ct_json.loads(txt)
    out: _ct_Dict[str, _ct_Any] = {}
    for f in fields:
        v = data.get(f["key"])
        if f["type"] == "select":
            out[f["key"]] = v if v in _CT_DEAL_STATUS else None
        elif f["type"] == "date":
            out[f["key"]] = v if isinstance(v, str) and _ct_re.match(r"^\d{4}-\d{2}-\d{2}$", v) else None
        else:
            out[f["key"]] = (str(v).strip() or None) if v not in (None, "", []) else None
    ss = data.get("seller_speaker")
    out["_seller_speaker"] = int(ss) if isinstance(ss, (int, float)) and int(ss) in (0, 1) else None
    return out


def _ct_render_transcript(segments: _ct_List[dict], seller_speaker: _ct_Optional[int]) -> str:
    def lab(sp: int) -> str:
        if seller_speaker is None:
            return f"Parlante {sp + 1}"
        return "Venditore" if sp == seller_speaker else "Cliente"
    return "\n".join(f"{lab(s['speaker'])}: {s['text']}" for s in segments)


async def _ct_process(tid: str, raw: bytes) -> None:
    """Audio tenuto SOLO in memoria per la durata dell'elaborazione (mai salvato nel DB)."""
    doc = await db.call_transcripts.find_one({"id": tid}, {"_id": 0})  # noqa: F821
    if not doc:
        return
    try:
        dg = await _ct_deepgram(raw, doc.get("mime") or "audio/mpeg")
        await db.call_transcripts.update_one({"id": tid}, {"$set": {"segments": dg["segments"], "duration_sec": dg.get("duration"), "speakers": dg["speakers"], "stage": "extracting"}})  # noqa: F821
        if not dg["segments"]:
            raise RuntimeError("Deepgram non ha riconosciuto parlato nell'audio")
        extracted = await _ct_extract(dg["segments"], doc["profile"], doc.get("contact_name") or "", doc.get("seller_name") or "")
        seller = extracted.pop("_seller_speaker", None)
        await db.call_transcripts.update_one({"id": tid}, {"$set": {  # noqa: F821
            "extracted": extracted, "seller_speaker": seller, "transcript_text": _ct_render_transcript(dg["segments"], seller),
            "status": "ready", "stage": "ready", "updated_at": utcnow()}})  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[call-transcripts] %s failed: %s", tid, exc)  # noqa: F821
        await db.call_transcripts.update_one({"id": tid}, {"$set": {"status": "error", "stage": "error", "error": str(exc)[:300], "updated_at": utcnow()}})  # noqa: F821


# ---- API ------------------------------------------------------------------------------------------------------------------
class CallProfileIn(BaseModel):  # noqa: F821
    profile: str


class CallConfirmIn(BaseModel):  # noqa: F821
    fields: _ct_Dict[str, _ct_Any]


def _ct_public(d: dict) -> dict:
    d.pop("_id", None)
    return d


@api_router.get("/call-transcripts/profile")  # noqa: F821
async def call_profile_get(user=Depends(get_current_user)):  # noqa: F821
    return _ct_profiles_payload(await _ct_user_profile(user))


@api_router.put("/call-transcripts/profile")  # noqa: F821
async def call_profile_put(body: CallProfileIn, user=Depends(get_current_user)):  # noqa: F821
    if body.profile not in CALL_PROFILES:
        raise HTTPException(status_code=422, detail="Profilo non valido")  # noqa: F821
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"call_profile": body.profile, "updated_at": utcnow()}}, upsert=True)  # noqa: F821
    return _ct_profiles_payload(body.profile)


@api_router.post("/call-transcripts")  # noqa: F821
async def call_transcript_create(file: _CtUploadFile = _CtFile(...), contact_id: str = _CtForm(...), user=Depends(get_current_user)):  # noqa: F821
    profile = await _ct_user_profile(user)
    if not profile:
        raise HTTPException(status_code=409, detail="Scegli prima il tuo profilo (Agente di Commercio, Consulente B2B o Libero Professionista)")  # noqa: F821
    name = file.filename or "chiamata"
    ext = _ct_os.path.splitext(name)[1].lower()
    if ext not in _CT_ALLOWED:
        raise HTTPException(status_code=415, detail="Formato non supportato: usa mp3, m4a, wav o ogg")  # noqa: F821
    raw = await file.read(_CT_MAX_BYTES + 1)
    if len(raw) > _CT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File troppo grande (max 80 MB)")  # noqa: F821
    if len(raw) < 1000:
        raise HTTPException(status_code=400, detail="File audio vuoto o troppo corto")  # noqa: F821
    cq = await _omni_contact_query(user)  # noqa: F821
    contact = await db.contacts.find_one({"$and": [cq, {"contact_id": contact_id}]}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1})  # noqa: F821
    if not contact:
        raise HTTPException(status_code=404, detail="Contatto non trovato")  # noqa: F821
    mime = (file.content_type if file.content_type in _CT_ALLOWED.values() else None) or _CT_ALLOWED[ext]
    tid = f"ct_{_ct_uuid.uuid4().hex[:12]}"
    cname = f"{contact.get('first_name') or ''} {contact.get('last_name') or ''}".strip() or contact.get("company") or ""
    doc = {"id": tid, "user_id": user["user_id"], "tenant_id": tenant_id(user), "contact_id": contact_id, "contact_name": cname, "seller_name": user.get("name") or "",  # noqa: F821
           "profile": profile, "filename": name, "mime": mime, "size_bytes": len(raw), "status": "processing", "stage": "transcribing", "confirmed": False,
           "created_at": utcnow(), "updated_at": utcnow()}  # noqa: F821
    await db.call_transcripts.insert_one(doc)  # noqa: F821
    asyncio.create_task(_ct_process(tid, raw))  # noqa: F821
    return _ct_public(dict(doc))


@api_router.get("/call-transcripts")  # noqa: F821
async def call_transcript_list(contact_id: str, user=Depends(get_current_user)):  # noqa: F821
    cur = db.call_transcripts.find({"tenant_id": tenant_id(user), "contact_id": contact_id}, {"_id": 0, "segments": 0}).sort("created_at", -1).limit(50)  # noqa: F821
    return [d async for d in cur]


@api_router.get("/call-transcripts/{tid}")  # noqa: F821
async def call_transcript_get(tid: str, user=Depends(get_current_user)):  # noqa: F821
    d = await db.call_transcripts.find_one({"id": tid, "tenant_id": tenant_id(user)}, {"_id": 0})  # noqa: F821
    if not d:
        raise HTTPException(status_code=404, detail="Trascrizione non trovata")  # noqa: F821
    d["fields"] = _ct_fields(d.get("profile") or "")
    return d


@api_router.post("/call-transcripts/{tid}/confirm")  # noqa: F821
async def call_transcript_confirm(tid: str, body: CallConfirmIn, user=Depends(get_current_user)):  # noqa: F821
    """SOLO qui i dati entrano nel CRM: nota sulla scheda, stato/budget/prossima azione sul contatto, richiamata se c'è la data."""
    d = await db.call_transcripts.find_one({"id": tid, "tenant_id": tenant_id(user)}, {"_id": 0, "segments": 0})  # noqa: F821
    if not d:
        raise HTTPException(status_code=404, detail="Trascrizione non trovata")  # noqa: F821
    if d.get("status") != "ready":
        raise HTTPException(status_code=409, detail="Trascrizione non ancora pronta")  # noqa: F821
    fields = _ct_fields(d.get("profile") or "")
    vals: _ct_Dict[str, _ct_Any] = {}
    for f in fields:
        v = body.fields.get(f["key"])
        if f["type"] == "select":
            vals[f["key"]] = v if v in _CT_DEAL_STATUS else None
        elif f["type"] == "date":
            vals[f["key"]] = v if isinstance(v, str) and _ct_re.match(r"^\d{4}-\d{2}-\d{2}$", v) else None
        else:
            vals[f["key"]] = (str(v).strip()[:2000] or None) if v not in (None, "") else None
    now = utcnow()  # noqa: F821
    tid_t = tenant_id(user)  # noqa: F821
    applied: _ct_Dict[str, _ct_Any] = {}
    # 1) nota sulla scheda
    lines = [f"📞 Chiamata del {d['created_at'].astimezone(_CT_ROME).strftime('%d/%m/%Y %H:%M') if isinstance(d.get('created_at'), _ct_dt) else ''} (trascritta da Axon)"]
    for f in fields:
        v = vals.get(f["key"])
        if v:
            lines.append(f"• {f['label']}: {_CT_DEAL_LABEL.get(v, v) if f['type'] == 'select' else v}")
    note_doc = {"id": str(_ct_uuid.uuid4()), "kind": "text", "category": "general", "text": "\n".join(lines), "created_at": now,
                "source": "call_transcript", "call_transcript_id": tid, "created_by": user["user_id"]}
    await db.contacts.update_one({"contact_id": d["contact_id"], "user_id": tid_t}, {"$push": {"notes": note_doc}})  # noqa: F821 — note visibili nel tab «Note»
    applied["note_id"] = note_doc["id"]
    # 2) campi sul contatto
    upd: _ct_Dict[str, _ct_Any] = {"updated_at": now, "last_call_at": now}
    if vals.get("deal_status"):
        upd["deal_status"] = vals["deal_status"]
        if vals["deal_status"] == "chiuso_vinto":
            upd["status"] = "client"
    if vals.get("budget"):
        upd["deal_budget"] = vals["budget"]
    if vals.get("next_action"):
        upd["deal_next_action"] = vals["next_action"]
    if vals.get("next_contact_at"):
        upd["deal_next_contact_at"] = vals["next_contact_at"]
    await db.contacts.update_one({"contact_id": d["contact_id"], "user_id": tid_t}, {"$set": upd})  # noqa: F821
    applied["contact_fields"] = [k for k in upd if k not in ("updated_at", "last_call_at")]
    # 3) richiamata se c'è una data esplicita
    if vals.get("next_contact_at"):
        try:
            when = _ct_dt.strptime(vals["next_contact_at"], "%Y-%m-%d").replace(hour=10, minute=0, tzinfo=_CT_ROME)
            contact = await db.contacts.find_one({"contact_id": d["contact_id"]}, {"_id": 0, "phone": 1, "area": 1}) or {}  # noqa: F821
            cb = {"callback_id": f"cb_{_ct_uuid.uuid4().hex[:12]}", "user_id": tid_t, "created_by": user["user_id"], "contact_id": d["contact_id"],
                  "title": f"Ricontattare {d.get('contact_name') or 'il cliente'}", "area": contact.get("area") or "energy", "scheduled_at": when.astimezone(_ct_tz.utc),
                  "note": vals.get("next_action") or "", "phone": contact.get("phone"), "notify": True, "notify_advance_min": None, "done": False, "created_at": now, "source": "call_transcript"}
            await db.callbacks.insert_one(cb)  # noqa: F821
            applied["callback_id"] = cb["callback_id"]
        except Exception as exc:  # noqa: BLE001
            logger.warning("[call-transcripts] callback failed: %s", exc)  # noqa: F821
    await db.call_transcripts.update_one({"id": tid}, {"$set": {"confirmed": True, "confirmed_at": now, "confirmed_fields": vals, "applied": applied, "updated_at": now}})  # noqa: F821
    return {"ok": True, "applied": applied, "fields": vals}


@api_router.delete("/call-transcripts/{tid}")  # noqa: F821
async def call_transcript_delete(tid: str, user=Depends(get_current_user)):  # noqa: F821
    r = await db.call_transcripts.delete_one({"id": tid, "tenant_id": tenant_id(user)})  # noqa: F821
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Trascrizione non trovata")  # noqa: F821
    return {"ok": True}
