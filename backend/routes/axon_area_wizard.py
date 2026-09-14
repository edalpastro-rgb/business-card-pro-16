# axon_area_wizard.py — V50.z227 — Mini-wizard per area (max 3 passi) + profili area + aree personalizzate (modulo ISOLATO)
#
# REGOLA TRASVERSALE: quando un'area richiede dati la PRIMA opzione è «Carica foto, file o PDF» → OCR/AI (riusa `_wt_extract` +
# `_axm_llm_json`) → campi precompilati → conferma/correzione solo di ciò che manca. Ogni file caricato chiede «Dove lo salvo?»
# (personale | lavoro | famiglia) → Master File (category "files", campi `folder` + `area_key`).
# Profili: `axon_area_profiles {user_id, area_key, data, files[], status: incomplete|complete}` → letti da Axon prima di rispondere
# (sezione prompt «PROFILI AREA»); area attiva ma incompleta → Axon aggiunge la riga «Completa la configurazione…» + marker
# `[[CONFIGURA:<key>]]` che il client trasforma nel bottone «Configura ora».
# Scadenze (bollo/assicurazione/aree custom): promemoria automatici a 30/15/7/0 giorni (reminder in `axon_alarms` via `_create_axon_alarm_doc`).

_AW_FOLDERS = ("personale", "lavoro", "famiglia")
_AW_FOLDER_LABEL = {"personale": "Personale", "lavoro": "Lavoro", "famiglia": "Famiglia"}
_AW_DEADLINE_OFFSETS = (30, 15, 7, 0)

# Catalogo extra: Auto/Veicoli (aggiunta al catalogo wizard V50.z214 tramite _WS_AREAS)
_WS_AREAS.insert(13, ("veicoli", "home", "car", "Auto & Veicoli", "Libretto, bollo e assicurazione: scadenze con avvisi automatici.", False, False))
_WS_AREAS.insert(6, ("calendar", "business", "calendar", "Google Calendar", "Appuntamenti sincronizzati con il tuo calendario Google.", False, False))
_WS_AREA_KEYS.update({"veicoli", "calendar"}); _WS_AREA_TITLE.update({"veicoli": "Auto & Veicoli", "calendar": "Google Calendar"})

# Mini-wizard per area (max 3 passi). step.kind: upload (OCR/AI → fields) | fields | choice | link | custom
_AW_WIZARDS: Dict[str, dict] = {
    "veicoli": {"steps": [
        {"id": "libretto", "kind": "upload", "title": "Fotografa il libretto di circolazione", "hint": "AxonOS legge targa, marca e modello e te li propone precompilati.",
         "extract": "libretto", "fields": [{"key": "targa", "label": "Targa"}, {"key": "marca", "label": "Marca"}, {"key": "modello", "label": "Modello"}], "extra_fields": [{"key": "bollo_scadenza", "label": "Scadenza bollo", "type": "date", "deadline": "Bollo auto"}]},
        {"id": "polizza", "kind": "upload", "title": "Carica la foto della polizza assicurativa", "hint": "AxonOS estrae scadenza e importo.",
         "extract": "polizza", "fields": [{"key": "assicurazione_compagnia", "label": "Compagnia"}, {"key": "assicurazione_scadenza", "label": "Scadenza polizza", "type": "date", "deadline": "Assicurazione auto"}, {"key": "assicurazione_importo", "label": "Importo (€)"}]},
    ], "done_note": "Avvisi automatici a 30, 15, 7 giorni e il giorno della scadenza."},
    "mail_crm": {"steps": [{"id": "link", "kind": "link", "title": "Collega il tuo account mail", "route": "/email-accounts", "cta": "Apri collegamento mail"}]},
    "calendar": {"steps": [{"id": "link", "kind": "link", "title": "Autorizza Google Calendar", "route": "/axon-integrations", "cta": "Autorizza con Google"}]},
    "documenti": {"steps": [{"id": "link", "kind": "link", "title": "Scegli la cartella principale di Google Drive", "route": "/google-drive", "cta": "Seleziona cartella"}]},
    "bollette": {"steps": [{"id": "bolletta", "kind": "upload", "title": "Fotografa o carica la bolletta", "hint": "AxonOS estrae POD/PDR, consumi, scadenze e importi.", "extract": "bolletta",
        "fields": [{"key": "fornitore", "label": "Fornitore"}, {"key": "pod_pdr", "label": "POD / PDR"}, {"key": "consumo", "label": "Consumo"}, {"key": "importo", "label": "Importo (€)"}, {"key": "scadenza", "label": "Scadenza", "type": "date"}]}]},
    "spese_biz": {"steps": [{"id": "ricevuta", "kind": "upload", "title": "Carica o fotografa la ricevuta", "hint": "AxonOS estrae importo, data e fornitore.", "extract": "ricevuta",
        "fields": [{"key": "fornitore", "label": "Fornitore"}, {"key": "importo", "label": "Importo (€)"}, {"key": "data", "label": "Data", "type": "date"}]}]},
    "spese_home": {"steps": [{"id": "ricevuta", "kind": "upload", "title": "Carica o fotografa la ricevuta", "hint": "AxonOS estrae importo, data e fornitore.", "extract": "ricevuta",
        "fields": [{"key": "fornitore", "label": "Fornitore"}, {"key": "importo", "label": "Importo (€)"}, {"key": "data", "label": "Data", "type": "date"}]}]},
    "pun": {"steps": [{"id": "contratto", "kind": "choice", "title": "Che contratto hai oggi?", "field": "contratto_tipo", "options": [{"value": "tutelato", "label": "Tutelato"}, {"value": "libero", "label": "Libero"}, {"value": "variabile", "label": "Variabile"}]}]},
}
_AW_CUSTOM_WIZARD = {"steps": [{"id": "custom", "kind": "custom", "title": "Racconta ad AxonOS questa area"}]}

_AW_EXTRACT_PROMPTS = {
    "libretto": ("targa, marca, modello, anno_immatricolazione, telaio", "un libretto di circolazione (carta di circolazione) italiano"),
    "polizza": ("assicurazione_compagnia, assicurazione_scadenza (data ISO AAAA-MM-GG), assicurazione_importo (numero €), targa", "una polizza assicurativa auto"),
    "bolletta": ("fornitore, pod_pdr, consumo (con unità), importo (numero €), scadenza (data ISO), periodo", "una bolletta luce/gas/telco"),
    "ricevuta": ("fornitore, importo (numero €), data (data ISO), categoria", "una ricevuta/scontrino"),
    "generic": ("titolo, data (ISO), importo, scadenza (ISO), note", "un documento"),
}


def _aw_all_fields(spec: dict) -> List[dict]:
    out: List[dict] = []
    for s in spec.get("steps", []):
        out += s.get("fields") or []
        out += s.get("extra_fields") or []
        if s.get("kind") == "choice":
            out.append({"key": s["field"], "label": s["title"]})
    return out


def _aw_status(key: str, spec: Optional[dict], prof: Optional[dict], is_custom: bool) -> str:
    """complete | incomplete | na (area senza mini-wizard)."""
    if not spec:
        return "na"
    if prof and prof.get("status") == "complete":
        return "complete"
    return "incomplete"


async def _aw_custom_areas(uid: str) -> List[dict]:
    return [d async for d in db.axon_custom_areas.find({"user_id": uid}, {"_id": 0}).sort("created_at", 1)]


async def _aw_profiles(uid: str) -> Dict[str, dict]:
    return {d["area_key"]: d async for d in db.axon_area_profiles.find({"user_id": uid}, {"_id": 0})}


def _aw_out(d: dict) -> dict:
    o = dict(d)
    for k in ("updated_at", "created_at"):
        if isinstance(o.get(k), datetime):
            o[k] = o[k].isoformat()
    return o


@api_router.get("/axon/areas/config")
async def aw_config(user=Depends(get_current_user)):
    uid = user["user_id"]
    st = await db.axon_setup_state.find_one({"user_id": uid}, {"_id": 0, "sphere": 1, "areas": 1}) or {}
    on = st.get("areas") or {}
    profs = await _aw_profiles(uid)
    out = []
    for key, sph, icon, title, desc, default_on, future in _WS_AREAS:
        spec = _AW_WIZARDS.get(key)
        p = profs.get(key)
        out.append({"key": key, "sphere": sph, "icon": icon, "title": title, "desc": desc, "future": future, "custom": False,
                    "on": bool(on.get(key, False)), "wizard": spec, "status": _aw_status(key, spec, p, False), "profile": _aw_out(p) if p else None})
    for c in await _aw_custom_areas(uid):
        p = profs.get(c["area_key"])
        out.append({"key": c["area_key"], "sphere": "both", "icon": "sparkles", "title": c["name"], "desc": (c.get("desc") or "")[:120], "future": False, "custom": True,
                    "on": True, "wizard": _AW_CUSTOM_WIZARD, "status": "complete", "profile": _aw_out(p) if p else None, "custom_area": _aw_out(c)})
    return {"sphere": st.get("sphere"), "areas": out, "folders": [{"key": f, "label": _AW_FOLDER_LABEL[f]} for f in _AW_FOLDERS]}


def _aw_parse_date(v: Any) -> Optional[datetime]:
    s = str(v or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s[:10], fmt)
        except ValueError:
            continue
    return None


async def _aw_schedule_deadline(user: dict, area_key: str, label: str, date_val: Any) -> int:
    """Promemoria a 30/15/7/0 giorni (ore 09:00 Europe/Rome ≈ 07:00Z) — sostituisce quelli precedenti della stessa scadenza."""
    d = _aw_parse_date(date_val)
    if not d:
        return 0
    await db.axon_alarms.delete_many({"user_id": user["user_id"], "area_key": area_key, "deadline_label": label})
    n = 0
    now = datetime.now(timezone.utc)
    for off in _AW_DEADLINE_OFFSETS:
        trig = datetime(d.year, d.month, d.day, 7, 0, tzinfo=timezone.utc) - timedelta(days=off)
        if trig <= now:
            continue
        when = "oggi" if off == 0 else f"tra {off} giorni"
        try:
            doc = await _create_axon_alarm_doc(user, {"kind": "reminder", "label": f"{label}: scade {when} ({d.strftime('%d/%m/%Y')})", "trigger_at": trig.isoformat(), "note": f"Area {_WS_AREA_TITLE.get(area_key, area_key)}"})
            await db.axon_alarms.update_one({"id": doc.get("id"), "user_id": user["user_id"]}, {"$set": {"area_key": area_key, "deadline_label": label}})
            n += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("[area-wizard] reminder failed: %s", exc)
    return n


class AwProfileIn(BaseModel):
    data: Dict[str, Any] = {}
    complete: Optional[bool] = None


@api_router.put("/axon/areas/{key}/profile")
async def aw_profile_save(key: str, body: AwProfileIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    is_custom = key.startswith("custom_")
    spec = _AW_CUSTOM_WIZARD if is_custom else _AW_WIZARDS.get(key)
    if not is_custom and key not in _WS_AREA_KEYS:
        raise HTTPException(status_code=404, detail="Area sconosciuta")
    cur = await db.axon_area_profiles.find_one({"user_id": uid, "area_key": key}, {"_id": 0}) or {}
    data = {**(cur.get("data") or {}), **{k: (v.strip() if isinstance(v, str) else v) for k, v in (body.data or {}).items() if v not in (None, "")}}
    # scadenze → promemoria automatici
    reminders = 0
    for f in _aw_all_fields(spec or {}):
        if f.get("deadline") and f["key"] in (body.data or {}):
            reminders += await _aw_schedule_deadline(user, key, f["deadline"], data.get(f["key"]))
    required = [f["key"] for f in _aw_all_fields(spec or {}) if f.get("type") != "date" or f.get("deadline")]
    missing = [k for k in required if not data.get(k)]
    status = "complete" if body.complete or (spec and not missing) else "incomplete"
    upd = {"data": data, "status": status, "updated_at": utcnow()}
    await db.axon_area_profiles.update_one({"user_id": uid, "area_key": key}, {"$set": upd, "$setOnInsert": {"created_at": utcnow(), "files": []}}, upsert=True)
    # attiva l'area se non lo è già (mini-wizard = area in uso)
    if not is_custom:
        await db.axon_setup_state.update_one({"user_id": uid}, {"$set": {f"areas.{key}": True, "updated_at": utcnow()}}, upsert=True)
    return {"ok": True, "status": status, "missing": missing, "data": data, "reminders_created": reminders}


@api_router.post("/axon/areas/{key}/extract")
async def aw_extract(key: str, file: UploadFile = File(...), kind: str = Form("generic"), folder: str = Form("personale"), user=Depends(get_current_user)):
    """Carica foto/file/PDF → OCR+AI → campi proposti. Il file viene SEMPRE salvato nei Master Files (cartella scelta)."""
    if folder not in _AW_FOLDERS:
        raise HTTPException(status_code=400, detail="folder: personale | lavoro | famiglia")
    if kind not in _AW_EXTRACT_PROMPTS:
        kind = "generic"
    nm = (file.filename or f"file-{int(utcnow().timestamp())}").strip()[:200]
    mime = (file.content_type or "application/octet-stream").split(";")[0].strip()
    ext = _upl_ext(nm, mime)
    tmp_path, size, sha = await _upl_stream_to_temp(file, _UPL_MASTER_MAX, "." + ext)
    try:
        text, image_b64 = await _wt_extract(tmp_path, ext, mime)
    except HTTPException:
        try: os.unlink(tmp_path)
        except Exception: pass  # noqa: BLE001
        raise
    fields_hint, what = _AW_EXTRACT_PROMPTS[kind]
    system = (f"Sei AxonOS. Leggi {what} e restituisci SOLO JSON: {{\"fields\": {{...}}, \"confidence\": {{campo: 0-1}}, \"missing\": [campi non leggibili]}}. "
              f"Campi da estrarre: {fields_hint}. Valori come stringhe; date in formato AAAA-MM-GG; importi solo numero con punto decimale. Se un campo non è leggibile NON inventarlo: mettilo in missing.")
    fields: Dict[str, Any] = {}; missing: List[str] = []; confidence: Dict[str, Any] = {}
    try:
        data = await asyncio.wait_for(_axm_llm_json(system, (f"Testo estratto:\n{text[:6000]}" if text.strip() else "Solo immagine allegata."), image_b64), timeout=75)
        fields = {str(k): str(v).strip() for k, v in (data.get("fields") or {}).items() if v not in (None, "", "null")}
        missing = [str(m) for m in (data.get("missing") or [])]
        confidence = data.get("confidence") or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[area-wizard] extract llm failed: %s", exc)
        missing = ["*"]
    # file SEMPRE salvato (cartella scelta), mai perso
    saved = await _upl_master_store(user, "files", nm, mime, tmp_path, size, sha, None)
    await db.master_files.update_one({"file_id": saved["file_id"]}, {"$set": {"folder": folder, "area_key": key, "source": "area-wizard"}})
    await db.axon_area_profiles.update_one({"user_id": user["user_id"], "area_key": key},
                                           {"$push": {"files": {"file_id": saved["file_id"], "name": nm, "folder": folder, "kind": kind, "at": utcnow()}},
                                            "$setOnInsert": {"created_at": utcnow(), "status": "incomplete", "data": {}}, "$set": {"updated_at": utcnow()}}, upsert=True)
    return {"fields": fields, "missing": missing, "confidence": confidence, "file": {"file_id": saved["file_id"], "name": nm, "folder": folder, "folder_label": _AW_FOLDER_LABEL[folder]},
            "ocr_ok": bool(fields)}


class AwCustomIn(BaseModel):
    name: str
    desc: Optional[str] = ""
    sites: Optional[List[str]] = None
    track_deadlines: bool = False
    deadlines: Optional[List[Dict[str, str]]] = None  # [{label, date}]


@api_router.post("/axon/areas/custom")
async def aw_custom_create(body: AwCustomIn, user=Depends(get_current_user)):
    return await _aw_custom_upsert(user, None, body)


@api_router.put("/axon/areas/custom/{key}")
async def aw_custom_update(key: str, body: AwCustomIn, user=Depends(get_current_user)):
    return await _aw_custom_upsert(user, key, body)


async def _aw_custom_upsert(user: dict, key: Optional[str], body: AwCustomIn) -> dict:
    uid = user["user_id"]
    name = (body.name or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Nome area troppo corto")
    sites = []
    for s in (body.sites or [])[:3]:
        s = (s or "").strip()
        if not s:
            continue
        if not s.startswith(("http://", "https://")):
            s = "https://" + s
        sites.append(s[:300])
    deadlines = [{"label": (d.get("label") or "Scadenza").strip()[:80], "date": (d.get("date") or "").strip()[:10]} for d in (body.deadlines or []) if _aw_parse_date(d.get("date"))][:10]
    key = key or f"custom_{uuid.uuid4().hex[:8]}"
    if not key.startswith("custom_"):
        raise HTTPException(status_code=400, detail="chiave non valida")
    doc = {"user_id": uid, "area_key": key, "name": name[:60], "desc": (body.desc or "").strip()[:1500], "sites": sites, "track_deadlines": bool(body.track_deadlines), "deadlines": deadlines if body.track_deadlines else [], "updated_at": utcnow()}
    await db.axon_custom_areas.update_one({"user_id": uid, "area_key": key}, {"$set": doc, "$setOnInsert": {"created_at": utcnow()}}, upsert=True)
    reminders = 0
    if body.track_deadlines:
        for d in deadlines:
            reminders += await _aw_schedule_deadline(user, key, d["label"], d["date"])
    await db.axon_area_profiles.update_one({"user_id": uid, "area_key": key}, {"$set": {"data": {"name": name, "desc": doc["desc"], "sites": sites, "deadlines": doc["deadlines"]}, "status": "complete", "updated_at": utcnow()}, "$setOnInsert": {"created_at": utcnow(), "files": []}}, upsert=True)
    return {"ok": True, "area": _aw_out(doc), "reminders_created": reminders}


@api_router.delete("/axon/areas/custom/{key}")
async def aw_custom_delete(key: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    r = await db.axon_custom_areas.delete_one({"user_id": uid, "area_key": key})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Area non trovata")
    await db.axon_area_profiles.delete_one({"user_id": uid, "area_key": key})
    await db.axon_alarms.delete_many({"user_id": uid, "area_key": key})
    return {"ok": True}


# ============================================================================ Axon legge i profili area prima di rispondere
_AW_AREA_HINTS = {"veicoli": ("auto", "macchina", "veicolo", "bollo", "assicurazione", "targa", "libretto"), "bollette": ("bolletta", "bollette", "pod", "pdr", "fornitore"),
                  "pun": ("pun", "contratto", "tutelato", "mercato libero", "variabile"), "spese_biz": ("nota spese", "note spese", "ricevuta", "scontrino", "rimborso"),
                  "spese_home": ("spesa", "spese", "scontrino", "ricevuta"), "mail_crm": ("mail", "email", "casella"), "documenti": ("drive", "cartella", "documenti"), "calendar": ("calendario", "calendar")}
_aw_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _aw_prev_prepare_prompt(user, body)
    try:
        if not prep.get("system_message"):
            return prep
        uid = user["user_id"]
        profs = await _aw_profiles(uid)
        customs = await _aw_custom_areas(uid)
        st = await db.axon_setup_state.find_one({"user_id": uid}, {"_id": 0, "areas": 1}) or {}
        on = st.get("areas") or {}
        lines = []
        for key, p in profs.items():
            data = {k: v for k, v in (p.get("data") or {}).items() if v and k not in ("desc",)}
            if data:
                lines.append(f"- {_WS_AREA_TITLE.get(key) or next((c['name'] for c in customs if c['area_key'] == key), key)} [{p.get('status')}]: " + "; ".join(f"{k}={v}" for k, v in list(data.items())[:12]))
        for c in customs:
            dl = ", ".join(f"{d['label']} {d['date']}" for d in (c.get("deadlines") or []))
            lines.append(f"- AREA PERSONALIZZATA «{c['name']}»: {c.get('desc') or '-'}" + (f" · FONTI WEB DA USARE PER LE RICERCHE: {', '.join(c['sites'])}" if c.get("sites") else "") + (f" · scadenze monitorate: {dl}" if dl else ""))
        msg = (getattr(body, "message", "") or "").lower()
        incomplete = [k for k in _AW_WIZARDS if on.get(k) and (profs.get(k) or {}).get("status") != "complete" and any(h in msg for h in _AW_AREA_HINTS.get(k, ()))]
        if lines:
            prep["system_message"] += "\n\n📁 PROFILI AREA DELL'UTENTE (leggili prima di rispondere su queste aree; sono già confermati, non richiederli):\n" + "\n".join(lines)
        if incomplete:
            k = incomplete[0]
            prep["system_message"] += (f"\n\n⚠️ L'area «{_WS_AREA_TITLE.get(k, k)}» è attiva ma la configurazione NON è completa. Rispondi normalmente e poi, come ULTIMA riga, aggiungi esattamente: "
                                       f"\"Completa la configurazione così posso aiutarti meglio. [[CONFIGURA:{k}]]\"")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[area-wizard] prompt failed: %s", exc)
    return prep
