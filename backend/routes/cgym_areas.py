# cgym_areas.py — V50.z365 — Corporate Gym: AREE DINAMICHE + materiali + registrazione trattativa reale + sessione live con Axon +
# valutazioni nel tempo. (modulo ISOLATO; usa _cgym_llm/_cgym_llm_json/_cgym_tts_b64/ai_transcribe di corporate_gym e
# media_auto_compress di media_compress; Object Storage via _put_object_sync/_get_object_sync)
#
# Aree (`cgym_areas`, per tenant): «Gym Obiezioni», «Gym WIN-WIN» (builtin, rotte storiche) + «Trattativa Completa» costruita a
# blocchi dal manuale (telefonata→rapport, chi sono, analisi 1° livello, mercato energia, patto di squadra, chiusura). Tutte
# rinominabili + logo modificabile (Master). Per ogni area: MATERIALI (PDF/immagini del Master, apribili/scaricabili dai consulenti),
# REGISTRAZIONE TRATTATIVA REALE (audio/video del Master, compressa ffmpeg → Object Storage/DB, SOLO riproduzione in app, mai download),
# SESSIONE LIVE con Axon-cliente a turni (STT Whisper → LLM → TTS Kokoro): per ogni turno TONO del consulente
# (green = rapport/obiezione · blue = spiegazione · red = distacco/incalzare) + segmenti per il grafico, rilevazione ESITAZIONE
# → ripeti il blocco finché è fluido → blocco successivo. Fine sessione (o analisi di una registrazione del consulente): punteggio
# 0-100 → OSCENO (<40) / MEDIOCRE (<60) / DOVERE (<80) / ECCELLENTE, feedback consulente + report Manager, storico per
# consulente×area (`cgym_live_sessions`).

CGA_MAX_MATERIAL = 14 * 1024 * 1024  # oltre → Object Storage
CGA_RATING_STEPS = ((80, "ECCELLENTE"), (60, "DOVERE"), (40, "MEDIOCRE"), (0, "OSCENO"))
CGA_TONES = {"green": "Rapport / obiezione", "blue": "Spiegazione", "red": "Distacco / incalzare"}

CGA_DEFAULT_AREAS = [
    {"key": "obiezioni", "name": "Gym Obiezioni", "color": "#DC2626", "route": "/corporate-gym/obiezioni", "builtin": True, "order": 1,
     "description": "Role-play sulle obiezioni: tempo, costo, decisore.", "blocks": ["Obiezione TEMPO", "Obiezione COSTO", "Obiezione DECISORE"],
     "image": "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/3efe302090d947e78e18f1eda6137539_obbiezioni%20logo2_0.png"},
    {"key": "winwin", "name": "Gym WIN-WIN", "color": "#0F9D58", "route": "/corporate-gym/win-win", "builtin": True, "order": 2,
     "description": "Trattativa completa in 8 blocchi, dalla telefonata alla chiusura.",
     "blocks": ["1 · Telefonata di presa appuntamento", "2 · Rapport", "3 · Chi sono", "4 · Analisi primo livello", "5 · Spiegazione mercato energia", "6 · K-meno", "7 · Patto di squadra", "8 · Chiusura e invito all'azione"],  # V50.z400 — = CGYM_WW_BLOCKS (MOD 5)
     "image": "https://customer-assets-rejwkqb3.emergentagent.net/wingman/96afd50f-e973-4b52-8752-8e66a92b8a17/attachments/7644430fa87e47c2a2b4b8a139f64318_logo%20winwin.png"},
    {"key": "trattativa", "name": "Trattativa Completa", "color": "#0EA5E9", "route": None, "builtin": True, "order": 3,
     "description": "Dalla telefonata alla chiusura, a blocchi come nel manuale.",
     "blocks": ["Dalla telefonata al rapport con il cliente", "Spiegazione: chi sono", "Analisi di primo livello", "Spiegazione del mercato energia",
                "Patto di squadra", "Chiusura"], "image": None},
]


def cga_rating(score: Optional[float]) -> Optional[str]:
    if score is None:
        return None
    for th, lab in CGA_RATING_STEPS:
        if score >= th:
            return lab
    return "OSCENO"


def _cga_out(d: Optional[dict]) -> Optional[dict]:
    if not d:
        return None
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items() if k not in ("_id", "data_base64")}


async def _cga_seed(tid: str) -> None:
    if await db.cgym_areas.count_documents({"tenant_id": tid}) == 0:
        now = utcnow()
        await db.cgym_areas.insert_many([{**a, "area_id": f"cga_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "logo_b64": None, "created_at": now, "updated_at": now} for a in CGA_DEFAULT_AREAS])


async def _cga_area(tid: str, area_id: str) -> dict:
    a = await db.cgym_areas.find_one({"tenant_id": tid, "area_id": area_id})
    if not a:
        raise HTTPException(status_code=404, detail="Area non trovata")
    return a


def _cga_master(user: dict) -> None:
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master")


class CgaAreaIn(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    blocks: Optional[List[str]] = None
    logo_b64: Optional[str] = None   # data URI o base64 (PNG/JPG) — compressa
    color: Optional[str] = None
    icon: Optional[str] = None       # V50.z408 — icona Ionicons scelta dalla libreria (alternativa al logo)


class CgaMaterialIn(BaseModel):
    name: str
    mime: str = "application/pdf"
    data_base64: str


class CgaLiveStartIn(BaseModel):
    area_id: str
    block_idx: int = 0
    training_level: Optional[str] = None  # V50.z387 — base | medio | esperto (scelto dal consulente prima di iniziare)


class CgaLiveTurnIn(BaseModel):
    audio_base64: Optional[str] = None
    mime: Optional[str] = "audio/m4a"
    text: Optional[str] = None
    tts: bool = True


class CgaRecordingIn(BaseModel):
    area_id: str
    audio_base64: str
    mime: str = "audio/m4a"
    title: Optional[str] = None
    training_level: Optional[str] = None  # V50.z387 — base | medio | esperto


# V50.z387 — ADDESTRAMENTO A TRE LIVELLI + parametri Manuale Unico (tono, obiezioni, invito all'azione, distacco)
CGA_LEVELS = {
    "base": "LIVELLO BASE: Axon ascolta per il 90% del tempo e interviene SOLO su errori GRAVI di dati o uscite TOTALI dal tema. Ignora imprecisioni minori.",
    "medio": "LIVELLO MEDIO: Axon interviene circa al 50%: corregge dati inventati, dati errati e la perdita del filo logico. Non interviene su sfumature di stile.",
    "esperto": "LIVELLO ESPERTO: Axon interviene su OGNI errore, OGNI uscita dal filo logico e OGNI imprecisione rispetto alla presentazione di riferimento.",
}


def _cga_level(v: Optional[str]) -> str:
    v = (v or "base").strip().lower()
    return v if v in CGA_LEVELS else "base"


def cga_distacco_color(score: int) -> str:
    """VERDE = distacco corretto · BLU = troppo coinvolto emotivamente · ROSSO = distacco completamente perso."""
    return "verde" if score >= 70 else ("blu" if score >= 40 else "rosso")


async def _cga_manual_excerpt(tid: str) -> str:
    """Manuale Unico (Master Files) = riferimento assoluto per ogni trattativa; estratto testo se disponibile."""
    try:
        doc = await db.master_files.find_one({"tenant_id": tid, "name": {"$regex": "manuale\\s*unico", "$options": "i"}},
                                             {"extracted_text": 1, "text": 1, "summary": 1, "name": 1})
        if doc:
            txt = (doc.get("extracted_text") or doc.get("text") or doc.get("summary") or "")
            return f"\n\nMANUALE UNICO «{doc.get('name')}» (riferimento ASSOLUTO):\n{str(txt)[:6000]}" if txt else f"\n\nMANUALE UNICO «{doc.get('name')}» presente in Master Files (testo non estratto)."
    except Exception:  # noqa: BLE001
        pass
    return ""


# ── Aree ─────────────────────────────────────────────────────────────────────────────────────────────────────────
@api_router.get("/cgym/areas")
async def cga_list(user=Depends(get_current_user)):
    tid = tenant_id(user); await _cga_seed(tid)
    areas = await db.cgym_areas.find({"tenant_id": tid}).sort("order", 1).to_list(100)
    out = []
    for a in areas:
        aid = a["area_id"]
        mine = await db.cgym_live_sessions.find({"tenant_id": tid, "user_id": user["user_id"], "area_id": aid, "status": "done"}, {"score": 1}).sort("finished_at", -1).to_list(1)
        out.append({**_cga_out(a),
                    "materials": await db.cgym_area_materials.count_documents({"tenant_id": tid, "area_id": aid}),
                    "references": await db.cgym_area_references.count_documents({"tenant_id": tid, "area_id": aid}),
                    "my_sessions": await db.cgym_live_sessions.count_documents({"tenant_id": tid, "user_id": user["user_id"], "area_id": aid, "status": "done"}),
                    "my_last_rating": cga_rating((mine or [{}])[0].get("score")) if mine else None})
    return {"items": out, "is_master": is_owner(user), "tones": CGA_TONES}


@api_router.post("/cgym/areas")
async def cga_create(body: CgaAreaIn, user=Depends(get_current_user)):
    _cga_master(user); tid = tenant_id(user); await _cga_seed(tid)
    name = (body.name or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Nome area troppo corto")
    n = await db.cgym_areas.count_documents({"tenant_id": tid})
    a = {"area_id": f"cga_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "key": re.sub(r"[^a-z0-9]+", "_", name.lower())[:30], "name": name, "color": body.color or "#7C3AED",
         "route": None, "builtin": False, "order": n + 1, "description": (body.description or "").strip()[:300], "blocks": [b.strip()[:120] for b in (body.blocks or []) if b.strip()][:20],
         "image": None, "logo_b64": None, "icon": (re.sub(r"[^a-z0-9-]", "", body.icon.lower())[:40] or None) if body.icon else None, "created_at": utcnow(), "updated_at": utcnow()}
    if body.logo_b64:
        a["logo_b64"], _ = await media_auto_compress_b64(body.logo_b64, "image/png", "logo.png", "cgym-area-logo")  # noqa: F821
    await db.cgym_areas.insert_one(dict(a))
    return _cga_out(a)


@api_router.patch("/cgym/areas/{area_id}")
async def cga_update(area_id: str, body: CgaAreaIn, user=Depends(get_current_user)):
    _cga_master(user); tid = tenant_id(user); await _cga_area(tid, area_id)
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.name is not None:
        if len(body.name.strip()) < 2:
            raise HTTPException(status_code=400, detail="Nome area troppo corto")
        upd["name"] = body.name.strip()[:60]
    if body.description is not None:
        upd["description"] = body.description.strip()[:300]
    if body.blocks is not None:
        upd["blocks"] = [b.strip()[:120] for b in body.blocks if b.strip()][:20]
    if body.color:
        upd["color"] = body.color
    if body.icon is not None:  # V50.z408
        upd["icon"] = re.sub(r"[^a-z0-9-]", "", body.icon.lower())[:40] or None
        if upd["icon"]:
            upd["logo_b64"] = None; upd["image"] = None
    if body.logo_b64 is not None:
        upd["logo_b64"] = (await media_auto_compress_b64(body.logo_b64, "image/png", "logo.png", "cgym-area-logo"))[0] if body.logo_b64 else None  # noqa: F821
        if body.logo_b64:
            upd["image"] = None
    await db.cgym_areas.update_one({"tenant_id": tid, "area_id": area_id}, {"$set": upd})
    return _cga_out(await _cga_area(tid, area_id))


@api_router.delete("/cgym/areas/{area_id}")
async def cga_delete(area_id: str, user=Depends(get_current_user)):
    _cga_master(user); tid = tenant_id(user); a = await _cga_area(tid, area_id)
    if a.get("builtin"):
        raise HTTPException(status_code=400, detail="Le aree di base non si eliminano (puoi rinominarle)")
    await db.cgym_areas.delete_one({"tenant_id": tid, "area_id": area_id})
    await db.cgym_area_materials.delete_many({"tenant_id": tid, "area_id": area_id})
    await db.cgym_area_references.delete_many({"tenant_id": tid, "area_id": area_id})
    return {"ok": True}


# ── Materiali di riferimento (Master carica · consulenti aprono/scaricano) ───────────────────────────────────────
@api_router.get("/cgym/areas/{area_id}/materials")
async def cga_materials(area_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user); await _cga_area(tid, area_id)
    rows = await db.cgym_area_materials.find({"tenant_id": tid, "area_id": area_id}, {"data_base64": 0}).sort("created_at", -1).to_list(200)
    return {"items": [_cga_out(r) for r in rows]}


@api_router.post("/cgym/areas/{area_id}/materials")
async def cga_material_add(area_id: str, body: CgaMaterialIn, user=Depends(get_current_user)):
    _cga_master(user); tid = tenant_id(user); await _cga_area(tid, area_id)
    b64, info = await media_auto_compress_b64(body.data_base64, body.mime, body.name, "cgym-material")  # noqa: F821
    pure = b64.split(",", 1)[1] if b64.startswith("data:") else b64
    size = len(pure) * 3 // 4
    m = {"material_id": f"cgm_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "area_id": area_id, "name": body.name[:120], "mime": info.get("mime") or body.mime, "size": size,
         "compressed": info.get("compressed", False), "uploaded_by": user["user_id"], "created_at": utcnow(), "storage_path": None, "data_base64": None}
    if size > CGA_MAX_MATERIAL:
        path = f"cgym/{tid}/materials/{m['material_id']}"
        res = await asyncio.get_event_loop().run_in_executor(None, _put_object_sync, path, base64.b64decode(pure), m["mime"])  # noqa: F821
        if not res:
            raise HTTPException(status_code=413, detail="File troppo grande e Object Storage non disponibile")
        m["storage_path"] = (res or {}).get("path") or path
    else:
        m["data_base64"] = pure
    await db.cgym_area_materials.insert_one(dict(m))
    return _cga_out(m)


async def _cga_blob(row: dict) -> Tuple[bytes, str]:
    if row.get("data_base64"):
        return base64.b64decode(row["data_base64"]), row.get("mime") or "application/octet-stream"
    got = await asyncio.get_event_loop().run_in_executor(None, _get_object_sync, row["storage_path"])  # noqa: F821
    if not got:
        raise HTTPException(status_code=404, detail="Contenuto non disponibile")
    return got[0], row.get("mime") or got[1]


@api_router.get("/cgym/areas/{area_id}/materials/{material_id}/content")
async def cga_material_content(area_id: str, material_id: str, raw: Optional[str] = None, download: Optional[str] = None, user=Depends(get_current_user)):
    tid = tenant_id(user)
    row = await db.cgym_area_materials.find_one({"tenant_id": tid, "area_id": area_id, "material_id": material_id})
    if not row:
        raise HTTPException(status_code=404, detail="Materiale non trovato")
    want_raw = (raw or "").lower() in ("1", "true", "yes")
    raw, mime = await _cga_blob(row)
    if want_raw:  # V50.z400 — bytes grezzi per il visualizzatore PDF interno / download
        disp = "attachment" if (download or "").lower() in ("1", "true", "yes") else "inline"
        safe = re.sub(r'[\r\n"]', "_", row["name"])
        return Response(content=raw, media_type=mime, headers={"Content-Disposition": f"{disp}; filename=\"{safe.encode('ascii', 'ignore').decode() or 'file'}\"", "Cache-Control": "no-store"})
    return {"name": row["name"], "mime": mime, "data_base64": base64.b64encode(raw).decode("ascii")}


@api_router.delete("/cgym/areas/{area_id}/materials/{material_id}")
async def cga_material_del(area_id: str, material_id: str, user=Depends(get_current_user)):
    _cga_master(user); tid = tenant_id(user)
    await db.cgym_area_materials.delete_one({"tenant_id": tid, "area_id": area_id, "material_id": material_id})
    return {"ok": True}


# ── Registrazione trattativa reale (Master carica · consulenti SOLO riproducono in app) ─────────────────────────
@api_router.get("/cgym/areas/{area_id}/references")
async def cga_references(area_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user); await _cga_area(tid, area_id)
    rows = await db.cgym_area_references.find({"tenant_id": tid, "area_id": area_id}, {"data_base64": 0}).sort("created_at", -1).to_list(50)
    return {"items": [_cga_out(r) for r in rows]}


@api_router.post("/cgym/areas/{area_id}/references")
async def cga_reference_add(area_id: str, file: UploadFile = File(...), title: Optional[str] = Form(None), notes: Optional[str] = Form(None), user=Depends(get_current_user)):
    _cga_master(user); tid = tenant_id(user); await _cga_area(tid, area_id)
    raw = await file.read()
    if len(raw) < 1000:
        raise HTTPException(status_code=400, detail="File vuoto")
    mime = file.content_type or "application/octet-stream"; name = file.filename or "trattativa"
    kind = mc_kind(mime, name, raw)  # noqa: F821
    if kind not in ("audio", "video"):
        raise HTTPException(status_code=400, detail="Serve una registrazione audio o video")
    # V50.z388 — BUG «Network request failed» / audio che non compare: la compressione ffmpeg di un file lungo poteva durare
    # minuti tenendo aperta la richiesta → timeout del proxy → nulla salvato. Ora: salvo SUBITO l'originale e rispondo,
    # la compressione silenziosa avviene in background e sostituisce il file (stesso ref_id) appena pronta.
    r = {"ref_id": f"cgr_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "area_id": area_id, "title": (title or name)[:120], "notes": (notes or "")[:500], "kind": kind,
         "mime": mime, "size": len(raw), "original_size": len(raw), "uploaded_by": user["user_id"], "created_at": utcnow(), "storage_path": None, "data_base64": None,
         "compressing": True}
    await _cga_store_reference_blob(r, raw)
    await db.cgym_area_references.insert_one(dict(r))
    asyncio.create_task(_cga_compress_reference_bg(r["ref_id"], tid, raw, mime, name))
    # V50.z389 — FUNZ. 4: ogni audio caricato → trascrizione Whisper + pulizia LLM → bozza da confermare (audio_transcripts.py)
    if kind == "audio":
        try:
            r["transcript_id"] = await audio_transcript_start(user, raw, mime, name, "cgym_reference", r["ref_id"], r["title"])  # noqa: F821
            await db.cgym_area_references.update_one({"ref_id": r["ref_id"]}, {"$set": {"transcript_id": r["transcript_id"]}})
        except Exception as exc:  # noqa: BLE001
            logger.warning("[cgym-reference] avvio trascrizione fallito: %s", exc)
    return _cga_out(r)


async def _cga_store_reference_blob(r: dict, out: bytes) -> None:
    """Grande → Object Storage (stesso path per ref_id, sovrascrivibile) · piccolo → base64 in Mongo."""
    if len(out) > CGA_MAX_MATERIAL:
        path = f"cgym/{r['tenant_id']}/references/{r['ref_id']}"
        res = await asyncio.get_event_loop().run_in_executor(None, _put_object_sync, path, out, r["mime"])  # noqa: F821
        if not res:
            raise HTTPException(status_code=413, detail="Registrazione troppo grande e Object Storage non disponibile")
        r["storage_path"] = (res or {}).get("path") or path; r["data_base64"] = None
    else:
        r["data_base64"] = base64.b64encode(out).decode("ascii"); r["storage_path"] = None
    r["size"] = len(out)


async def _cga_compress_reference_bg(ref_id: str, tid: str, raw: bytes, mime: str, name: str) -> None:
    upd: dict = {"compressing": False}
    try:
        out, info = await media_auto_compress(raw, mime, name, "cgym-reference", allow_container_change=True)  # noqa: F821
        if info.get("compressed") and len(out) < len(raw):
            r = {"ref_id": ref_id, "tenant_id": tid, "mime": info.get("mime") or mime}
            await _cga_store_reference_blob(r, out)
            upd.update({"mime": r["mime"], "size": r["size"], "storage_path": r["storage_path"], "data_base64": r["data_base64"], "compressed": True})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cgym-reference] compressione background %s fallita: %s", ref_id, str(exc)[:200])
    await db.cgym_area_references.update_one({"ref_id": ref_id, "tenant_id": tid}, {"$set": upd})


@api_router.post("/cgym/references/{ref_id}/link")
async def cga_reference_link(ref_id: str, request: Request, user=Depends(get_current_user)):
    """Link firmato (2 h) per la sola riproduzione in app: inline, nessun download.
    V50.z389 — l'AUDIO originale è accessibile SOLO a Master/Super Master: gli altri leggono la trascrizione pubblicata."""
    tid = tenant_id(user)
    row = await db.cgym_area_references.find_one({"tenant_id": tid, "ref_id": ref_id}, {"data_base64": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Registrazione non trovata")
    if row.get("kind") == "audio" and not is_owner(user) and not is_admin_or_owner(user):
        raise HTTPException(status_code=403, detail="L'audio originale è riservato al Master: leggi la trascrizione")
    exp = utcnow() + timedelta(hours=2)
    token = jwt.encode({"kind": "cgym_ref", "tenant_id": tid, "ref_id": ref_id, "user_id": user["user_id"], "exp": int(exp.timestamp())}, JWT_SECRET, algorithm=JWT_ALG)
    return {"url": f"{_cgym_man_base_url(request)}/api/public/cgym-ref/{token}", "mime": row.get("mime"), "kind": row.get("kind"), "expires_at": exp.isoformat()}  # noqa: F821


@api_router.get("/public/cgym-ref/{token}")
async def cga_reference_stream(token: str):
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if p.get("kind") != "cgym_ref":
            raise ValueError("kind")
    except Exception:
        raise HTTPException(status_code=401, detail="Link non valido o scaduto")
    row = await db.cgym_area_references.find_one({"tenant_id": p["tenant_id"], "ref_id": p["ref_id"]})
    if not row:
        raise HTTPException(status_code=404, detail="Registrazione non trovata")
    raw, mime = await _cga_blob(row)
    return Response(content=raw, media_type=mime, headers={"Content-Disposition": "inline", "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff"})


@api_router.delete("/cgym/references/{ref_id}")
async def cga_reference_del(ref_id: str, user=Depends(get_current_user)):
    _cga_master(user)
    await db.cgym_area_references.delete_one({"tenant_id": tenant_id(user), "ref_id": ref_id})
    await db.audio_transcripts.delete_many({"tenant_id": tenant_id(user), "source_kind": "cgym_reference", "source_id": ref_id})
    return {"ok": True}


# ── Sessione LIVE con Axon-cliente ───────────────────────────────────────────────────────────────────────────────
def _cga_client_system(area: dict, block: str, level: str = "base") -> str:
    return (f"Sei un CLIENTE italiano (titolare di una piccola azienda) in una trattativa reale con un consulente energia/telco di AdvisorOS. "
            f"Area di allenamento: «{area['name']}». Blocco in corso: «{block}». Recita il cliente in modo realistico e sintetico (max 2-3 frasi), "
            "con dubbi e obiezioni plausibili ma senza esagerare. Non fare il coach: resta nel personaggio. "
            "Dopo la tua battuta, restituisci SOLO JSON: {\"reply\": \"battuta del cliente\", \"tone\": \"green|blue|red\", "
            "\"tone_segments\": [{\"tone\": \"green|blue|red\", \"pct\": 0-100}], \"hesitation\": true|false, \"hesitation_reason\": \"...\", "
            "\"block_done\": true|false, \"hint\": \"consiglio breve per il consulente\", \"distacco\": 0-100, "
            "\"issues\": [{\"tipo\": \"dati|tema|filo_logico|imprecisione|tono|obiezione|invito|distacco\", \"gravita\": \"grave|media|lieve\", \"correzione\": \"cosa dire/fare invece, 1 frase\"}]}. "
            "TONE = tono usato dal CONSULENTE nell'ultimo intervento: green = rapport/empatia/gestione obiezione, blue = spiegazione/informazione, "
            "red = distacco/incalzare per creare emozione. tone_segments = suddivisione dell'intervento in ordine (somma 100). "
            "hesitation = true se il consulente esita, si contraddice, usa riempitivi (ehm, cioè, allora…), è troppo breve o confuso rispetto al blocco. "
            "block_done = true se il consulente ha coperto in modo fluido l'obiettivo del blocco. "
            "DISTACCO (0-100) = quanto il consulente mantiene il giusto distacco emotivo e professionale nell'ultimo intervento: "
            "≥70 corretto, 40-69 troppo coinvolto emotivamente (si giustifica, insegue il cliente, si scusa troppo), <40 distacco completamente perso (supplica, si agita, subisce). "
            "ISSUES = errori del consulente nell'ultimo intervento (lista vuota se nessuno): grave = dato inventato/errato o uscita totale dal tema; "
            "media = perdita del filo logico, obiezione ignorata, invito all'azione mancato; lieve = imprecisione o sfumatura di stile/tono. "
            f"Contesto valutazione: {CGA_LEVELS.get(level, CGA_LEVELS['base'])}")


# V50.z388 — soglie di intervento di Axon in sessione live per livello: BASE solo errori gravi · MEDIO gravi+medi · ESPERTO tutti
CGA_LEVEL_SEVERITY = {"base": {"grave"}, "medio": {"grave", "media"}, "esperto": {"grave", "media", "lieve"}}
CGA_ISSUE_TYPES = {"dati", "tema", "filo_logico", "imprecisione", "tono", "obiezione", "invito", "distacco"}


def _cga_pick_interventions(level: str, issues: Any) -> List[dict]:
    allowed = CGA_LEVEL_SEVERITY.get(level, CGA_LEVEL_SEVERITY["base"])
    out: List[dict] = []
    for x in (issues or []) if isinstance(issues, list) else []:
        if not isinstance(x, dict):
            continue
        sev = str(x.get("gravita") or "lieve").lower(); tipo = str(x.get("tipo") or "imprecisione").lower()
        if sev in allowed and tipo in CGA_ISSUE_TYPES and x.get("correzione"):
            out.append({"tipo": tipo, "gravita": sev, "correzione": str(x["correzione"])[:220]})
    return out[:3]


def _cga_tone_fallback(text: str) -> str:
    t = (text or "").lower()
    if re.search(r"\bcapisco\b|\bcomprendo\b|\bgiusto\b|\bd'accordo\b|\bcome sta\b|\bfamiglia\b|\bgrazie\b", t):
        return "green"
    if re.search(r"\bsubito\b|\bora\b|\boggi\b|\bperd\w+\b|\brischi\w*\b|\bdecid\w+\b|\bultim\w+\b", t):
        return "red"
    return "blue"


async def _cga_session(tid: str, sid: str, user: dict) -> dict:
    s = await db.cgym_live_sessions.find_one({"tenant_id": tid, "session_id": sid})
    if not s or (s["user_id"] != user["user_id"] and not is_owner(user)):
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    return s


@api_router.post("/cgym/live/start")
async def cga_live_start(body: CgaLiveStartIn, user=Depends(get_current_user)):
    tid = tenant_id(user); area = await _cga_area(tid, body.area_id)
    blocks = area.get("blocks") or ["Trattativa"]
    bi = max(0, min(body.block_idx, len(blocks) - 1))
    # V50.z397 — Apertura DETERMINISTICA (niente LLM: risposta immediata, regola dei 2 s): il cliente è nel suo ufficio e accoglie
    # (MOD 4 «Prego, si accomodi»); nell'area ANT Axon è ESAMINATORE tecnico e invita a iniziare la spiegazione del blocco (MOD 6).
    if _r2_is_ant(area):  # noqa: F821 — corporate_gym_rules_v2
        opening = f"Buongiorno. Sono pronto ad ascoltarla: mi spieghi «{blocks[bi]}» come farebbe con un cliente. Prego, cominci."
    elif _r2_area_kind(area) == "winwin":  # noqa: F821 — V50.z400 blocco 1 = telefonata
        opening = "Pronto?"
    else:
        opening = "Prego, si accomodi. Mi dica."
    s = {"session_id": f"cgl_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "user_id": user["user_id"], "user_name": user.get("name"), "area_id": area["area_id"], "area_name": area["name"],
         "blocks": blocks, "block_idx": bi, "repeats": 0, "status": "live", "source": "live", "training_level": _cga_level(body.training_level), "turns": [{"role": "client", "text": opening, "block_idx": bi, "ts": utcnow()}],
         "started_at": utcnow(), "finished_at": None, "score": None, "rating": None, "feedback": None, "manager_report": None}
    await db.cgym_live_sessions.insert_one(dict(s))
    audio = await _cgym_tts_b64(opening, None, user)  # noqa: F821
    return {**_cga_out(s), "audio_base64": audio}


@api_router.post("/cgym/live/{session_id}/turn")
async def cga_live_turn(session_id: str, body: CgaLiveTurnIn, user=Depends(get_current_user)):
    tid = tenant_id(user); s = await _cga_session(tid, session_id, user)
    if s["status"] != "live":
        raise HTTPException(status_code=400, detail="Sessione già conclusa")
    text = (body.text or "").strip()
    if not text and body.audio_base64:
        try:
            r = await ai_transcribe(AIVoiceIn(audio_base64=body.audio_base64, mime=body.mime or "audio/m4a"), user)  # noqa: F821
            text = (r.get("transcript") or "").strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[cga] stt failed: %s", exc)
    if not text:
        return {"ok": False, "reason": "no_speech", "message": "Non ho sentito nulla: riprova parlando più vicino al microfono."}
    area = await _cga_area(tid, s["area_id"]); blocks = s["blocks"]; bi = s["block_idx"]
    level = _cga_level(s.get("training_level"))
    hist = "\n".join(f"{'CONSULENTE' if t['role'] == 'consultant' else 'CLIENTE'}: {t['text']}" for t in s["turns"][-8:])
    data: dict = {}
    try:
        raw = await _cgym_llm(_cga_client_system(area, blocks[bi], level), f"Dialogo finora:\n{hist}\nCONSULENTE (ultimo intervento da valutare): {text}\n\nRispondi come cliente e compila il JSON.")  # noqa: F821
        data = _cgym_llm_json(raw)  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cga] turn llm failed: %s", exc)
    tone = data.get("tone") if data.get("tone") in CGA_TONES else _cga_tone_fallback(text)
    segs = [x for x in (data.get("tone_segments") or []) if isinstance(x, dict) and x.get("tone") in CGA_TONES] or [{"tone": tone, "pct": 100}]
    hes = bool(data.get("hesitation")) or len(text.split()) < 4
    done = bool(data.get("block_done")) and not hes
    reply = (data.get("reply") or "Mmh, non mi è chiaro. Me lo può rispiegare?").strip()
    # V50.z388 — DISTACCO in tempo reale (verde/blu/rosso) + interventi di Axon filtrati per livello (BASE/MEDIO/ESPERTO)
    try:
        distacco = max(0, min(100, int(round(float(data.get("distacco"))))))
    except Exception:
        distacco = 70 if tone != "green" else 60
    distacco_color = cga_distacco_color(distacco)
    interventions = _cga_pick_interventions(level, data.get("issues"))
    turns = [{"role": "consultant", "text": text, "tone": tone, "tone_segments": segs, "hesitation": hes, "hesitation_reason": data.get("hesitation_reason") or None, "hint": data.get("hint") or None,
              "distacco": distacco, "distacco_color": distacco_color, "interventions": interventions, "block_idx": bi, "ts": utcnow()}]
    upd: Dict[str, Any] = {}
    action = "continue"
    if hes:
        action = "repeat"; upd["repeats"] = s.get("repeats", 0) + 1
        reply = f"{reply} — [AXON] Fermiamoci un attimo: su «{blocks[bi]}» ho sentito un'esitazione ({data.get('hesitation_reason') or 'poco fluido'}). Ripeti questo blocco con calma, poi riprendiamo."
    elif interventions:
        action = "correct"
        reply = f"{reply} — [AXON] Un attimo: {interventions[0]['correzione']}" + (f" Inoltre: {interventions[1]['correzione']}" if len(interventions) > 1 else "") + " Riprendi da qui."
    elif done and bi + 1 < len(blocks):
        action = "next_block"; upd["block_idx"] = bi + 1
        reply = f"{reply} — [AXON] Blocco «{blocks[bi]}» fluido, ottimo. Passiamo a «{blocks[bi + 1]}»."
    elif done:
        action = "all_done"
        reply = f"{reply} — [AXON] Hai completato tutti i blocchi. Puoi chiudere la sessione per il feedback."
    turns.append({"role": "client", "text": reply, "block_idx": upd.get("block_idx", bi), "ts": utcnow()})
    push: Dict[str, Any] = {"turns": {"$each": turns}}
    if interventions:
        push["live_interventions"] = {"$each": [{**x, "quando": text[:120], "block": blocks[bi]} for x in interventions]}
    await db.cgym_live_sessions.update_one({"session_id": session_id}, {"$push": push, "$set": upd})
    audio = await _cgym_tts_b64(reply.replace("[AXON]", "").strip(), None, user) if body.tts else None  # noqa: F821
    return {"ok": True, "transcript": text, "reply": reply, "audio_base64": audio, "tone": tone, "tone_segments": segs, "hesitation": hes,
            "hesitation_reason": data.get("hesitation_reason"), "hint": data.get("hint"), "action": action, "block_idx": upd.get("block_idx", bi), "blocks": blocks,
            "distacco": distacco, "distacco_color": distacco_color, "interventions": interventions, "training_level": level}


async def _cga_evaluate(s: dict) -> dict:
    convo = "\n".join(f"{'CONSULENTE' if t['role'] == 'consultant' else 'CLIENTE'}: {t['text']}" for t in s["turns"])
    tones = [t.get("tone") for t in s["turns"] if t["role"] == "consultant" and t.get("tone")]
    tone_mix = {k: round(100 * tones.count(k) / max(1, len(tones))) for k in CGA_TONES}
    level = _cga_level(s.get("training_level"))
    manual = await _cga_manual_excerpt(s.get("tenant_id") or "")
    # V50.z394 — le TRASCRIZIONI delle «Trattative reali (campione)» dell'area (pubblicate dal Master) sono il benchmark
    # concreto per Axon quando valuta la registrazione del consulente («Analizza una mia registrazione») o la sessione live.
    samples = ""
    try:
        refs = await db.cgym_area_references.find({"tenant_id": s.get("tenant_id"), "area_id": s.get("area_id"), "kind": "audio"}, {"_id": 0, "ref_id": 1, "title": 1}).to_list(20)
        if refs:
            trs = await db.audio_transcripts.find({"tenant_id": s.get("tenant_id"), "source_kind": "cgym_reference", "source_id": {"$in": [r["ref_id"] for r in refs]}, "status": "published", "text": {"$ne": None}}, {"_id": 0, "source_id": 1, "text": 1}).to_list(20)
            by_ref = {t["source_id"]: t["text"] for t in trs}
            parts = [f"— «{r.get('title') or 'Campione'}»:\n{by_ref[r['ref_id']][:6000]}" for r in refs if by_ref.get(r["ref_id"])]
            if parts:
                samples = "\n\nTRATTATIVE REALI CAMPIONE (trascrizioni caricate dal Master — usale come modello di riferimento per confrontare tono, gestione obiezioni, invito all'azione e distacco):\n" + "\n\n".join(parts)[:14000]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cga] sample transcripts skip: %s", exc)
    system = ("Sei il coach vendite di AdvisorOS. Valuta la trattativa del CONSULENTE (non del cliente) sull'area «{a}» con blocchi: {b}. "
              + CGA_LEVELS[level] + " Il MANUALE UNICO è il riferimento assoluto per tono, gestione obiezioni, invito all'azione e distacco. "
              "Valuta anche: TONO (coerente col manuale? troppo aggressivo/passivo/corretto), OBIEZIONI (affrontate con tecniche e temi del manuale?), "
              "INVITO ALL'AZIONE (lanciato nei momenti giusti e col linguaggio corretto?), DISTACCO (distacco emotivo e professionale mantenuto?). "
              "Rispondi SOLO JSON: {{\"score\": 0-100, \"good\": [\"...\"], \"redo\": [\"...\"], \"per_block\": [{{\"block\": \"...\", \"score\": 0-100, \"note\": \"...\"}}], "
              "\"params\": {{\"tono\": 0-100, \"obiezioni\": 0-100, \"invito_azione\": 0-100, \"distacco\": 0-100, \"dati\": 0-100, \"filo_logico\": 0-100}}, "
              "\"tono_giudizio\": \"corretto|troppo aggressivo|troppo passivo\", "
              "\"interventions\": [{{\"quando\": \"frase o momento\", \"tipo\": \"dati|tema|filo_logico|imprecisione|tono|obiezione|invito|distacco\", \"correzione\": \"...\"}}] (SOLO gli interventi previsti dal livello scelto), "
              "\"manager_report\": \"3-5 frasi per il Manager: livello, aree critiche, se serve un intervento diretto di persona e su cosa\", "
              "\"summary\": \"1 frase per il consulente\"}}. Scala: <40 OSCENO, 40-59 MEDIOCRE, 60-79 DOVERE (minimo richiesto), ≥80 ECCELLENTE. Sii concreto e onesto.").format(a=s["area_name"], b=" · ".join(s["blocks"]))
    data: dict = {}
    try:
        data = _cgym_llm_json(await _cgym_llm(system, f"Ripetizioni richieste da Axon per esitazione: {s.get('repeats', 0)}. Mix toni consulente: {tone_mix}.{manual}{samples}\n\nTRASCRIZIONE:\n{convo}", model="claude-sonnet-4-5"))  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cga] evaluate failed: %s", exc)
    try:
        score = max(0, min(100, int(round(float(data.get("score"))))))
    except Exception:
        n_c = len([t for t in s["turns"] if t["role"] == "consultant"])
        score = max(10, min(70, 30 + n_c * 5 - s.get("repeats", 0) * 8))
    params: dict = {}
    for k in ("tono", "obiezioni", "invito_azione", "distacco", "dati", "filo_logico"):
        try:
            params[k] = max(0, min(100, int(round(float((data.get("params") or {}).get(k))))))
        except Exception:
            params[k] = score
    live_iv = [x for x in (s.get("live_interventions") or []) if isinstance(x, dict)]
    return {"score": score, "rating": cga_rating(score), "tone_mix": tone_mix,
            "training_level": level, "params": params, "distacco_color": cga_distacco_color(params["distacco"]),
            "tono_giudizio": str(data.get("tono_giudizio") or ""),
            "interventions": (live_iv + [x for x in (data.get("interventions") or []) if isinstance(x, dict)])[:20],
            "feedback": {"summary": data.get("summary") or "", "good": [str(x) for x in (data.get("good") or [])][:6], "redo": [str(x) for x in (data.get("redo") or [])][:6],
                         "per_block": [x for x in (data.get("per_block") or []) if isinstance(x, dict)][:12]},
            "manager_report": data.get("manager_report") or "Report non disponibile."}


@api_router.post("/cgym/live/{session_id}/finish")
async def cga_live_finish(session_id: str, user=Depends(get_current_user)):
    tid = tenant_id(user); s = await _cga_session(tid, session_id, user)
    if s["status"] == "done":
        return _cga_out(s)
    if not any(t["role"] == "consultant" for t in s["turns"]):
        raise HTTPException(status_code=400, detail="Parla almeno una volta prima di chiudere la sessione")
    ev = await _cga_evaluate(s)
    upd = {**ev, "status": "done", "finished_at": utcnow(), "duration_sec": int((utcnow().replace(tzinfo=None) - s["started_at"].replace(tzinfo=None)).total_seconds())}
    await db.cgym_live_sessions.update_one({"session_id": session_id}, {"$set": upd})
    return _cga_out({**s, **upd})


@api_router.post("/cgym/live/from-recording")
async def cga_from_recording(body: CgaRecordingIn, user=Depends(get_current_user)):
    """Il consulente carica una sua trattativa registrata → trascrizione Whisper → stessa valutazione della sessione live."""
    tid = tenant_id(user); area = await _cga_area(tid, body.area_id)
    try:
        r = await ai_transcribe(AIVoiceIn(audio_base64=body.audio_base64, mime=body.mime or "audio/m4a"), user)  # noqa: F821
        text = (r.get("transcript") or "").strip()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Trascrizione non riuscita: {exc}")
    if len(text) < 20:
        raise HTTPException(status_code=400, detail="Registrazione troppo breve o senza voce")
    s = {"session_id": f"cgl_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "user_id": user["user_id"], "user_name": user.get("name"), "area_id": area["area_id"], "area_name": area["name"],
         "blocks": area.get("blocks") or ["Trattativa"], "block_idx": 0, "repeats": 0, "status": "live", "source": "recording", "title": (body.title or "Registrazione")[:120], "training_level": _cga_level(body.training_level),
         "turns": [{"role": "consultant", "text": text, "tone": _cga_tone_fallback(text), "block_idx": 0, "ts": utcnow()}], "started_at": utcnow(), "finished_at": None}
    ev = await _cga_evaluate(s)
    s.update({**ev, "status": "done", "finished_at": utcnow(), "duration_sec": 0})
    await db.cgym_live_sessions.insert_one(dict(s))
    return _cga_out(s)


@api_router.post("/cgym/live/from-recording/upload")
async def cga_from_recording_upload(file: UploadFile = File(...), area_id: str = Form(...), title: Optional[str] = Form(None), training_level: Optional[str] = Form(None), user=Depends(get_current_user)):
    """V50.z397 — BUG Drive «Network request failed»: la registrazione del consulente arriva in MULTIPART (niente base64 in JSON,
    nessun limite 25 MB) e la trascrizione Whisper (segmenti ffmpeg, qualsiasi durata) + valutazione avvengono in BACKGROUND:
    rispondo subito con la sessione in stato `processing`, l'app fa polling su GET /cgym/live/{id} finché è `done` (o `error`)."""
    tid = tenant_id(user); area = await _cga_area(tid, area_id)
    raw = await file.read()
    if len(raw) < 1000:
        raise HTTPException(status_code=400, detail="File vuoto o non leggibile: se viene da Google Drive verifica che sia disponibile offline")
    mime = file.content_type or "audio/m4a"; name = file.filename or "registrazione"
    if mc_kind(mime, name, raw) not in ("audio", "video"):  # noqa: F821
        raise HTTPException(status_code=400, detail="Serve una registrazione audio o video")
    s = {"session_id": f"cgl_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "user_id": user["user_id"], "user_name": user.get("name"), "area_id": area["area_id"], "area_name": area["name"],
         "blocks": area.get("blocks") or ["Trattativa"], "block_idx": 0, "repeats": 0, "status": "processing", "source": "recording", "title": (title or name)[:120],
         "training_level": _cga_level(training_level), "turns": [], "started_at": utcnow(), "finished_at": None, "score": None, "rating": None, "error": None}
    await db.cgym_live_sessions.insert_one(dict(s))
    asyncio.create_task(_cga_from_recording_bg(s, raw, mime, name))
    return _cga_out(s)


async def _cga_from_recording_bg(s: dict, raw: bytes, mime: str, name: str) -> None:
    sid = s["session_id"]
    try:
        text = (await audio_transcribe_long(raw, mime, name)).strip()  # noqa: F821 — audio_transcripts
        if len(text) < 20:
            raise ValueError("Registrazione troppo breve o senza voce")
        s["turns"] = [{"role": "consultant", "text": text, "tone": _cga_tone_fallback(text), "block_idx": 0, "ts": utcnow()}]
        ev = await _cga_evaluate(s)
        s.update({**ev, "status": "done", "finished_at": utcnow(), "duration_sec": 0})
        await db.cgym_live_sessions.update_one({"session_id": sid}, {"$set": {k: v for k, v in s.items() if k != "_id"}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[cgym-recording] analisi fallita %s: %s", sid, exc)
        await db.cgym_live_sessions.update_one({"session_id": sid}, {"$set": {"status": "error", "error": f"Analisi non riuscita: {str(exc)[:200]}", "finished_at": utcnow()}})


@api_router.get("/cgym/live/{session_id}")
async def cga_live_get(session_id: str, user=Depends(get_current_user)):
    return _cga_out(await _cga_session(tenant_id(user), session_id, user))


# ── Valutazioni nel tempo (consulente: proprie · Master: tutto il team) ─────────────────────────────────────────
@api_router.get("/cgym/ratings")
async def cga_ratings(user_id: Optional[str] = None, area_id: Optional[str] = None, user=Depends(get_current_user)):
    tid = tenant_id(user)
    q: Dict[str, Any] = {"tenant_id": tid, "status": "done"}
    if not is_owner(user):
        q["user_id"] = user["user_id"]
    elif user_id:
        q["user_id"] = user_id
    if area_id:
        q["area_id"] = area_id
    rows = await db.cgym_live_sessions.find(q, {"turns": 0}).sort("finished_at", 1).to_list(3000)
    members = {m["user_id"]: m for m in await db.users.find({"$or": [{"user_id": tid}, {"parent_user_id": tid}]}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(2000)}
    groups: Dict[Tuple[str, str], dict] = {}
    for r in rows:
        k = (r["user_id"], r["area_id"])
        g = groups.setdefault(k, {"user_id": r["user_id"], "user_name": (members.get(r["user_id"]) or {}).get("name") or r.get("user_name") or r["user_id"][-6:],
                                  "area_id": r["area_id"], "area_name": r["area_name"], "history": []})
        g["history"].append({"session_id": r["session_id"], "date": (r.get("finished_at") or r["started_at"]).isoformat(), "score": r.get("score"), "rating": r.get("rating"), "source": r.get("source")})
    out = []
    for g in groups.values():
        sc = [h["score"] for h in g["history"] if h["score"] is not None]
        last = sc[-1] if sc else None; prev = sc[-2] if len(sc) > 1 else None
        avg = round(sum(sc) / len(sc)) if sc else None
        out.append({**g, "last_score": last, "last_rating": cga_rating(last), "avg_score": avg, "avg_rating": cga_rating(avg), "trend": (last - prev) if (last is not None and prev is not None) else None,
                    "needs_intervention": bool(sc) and (last < 60 or (avg is not None and avg < 50))})
    out.sort(key=lambda g: (g["last_score"] if g["last_score"] is not None else 999))
    return {"items": out, "scale": [{"min": th, "label": lab} for th, lab in CGA_RATING_STEPS], "is_master": is_owner(user)}
