# 34_alarms_homeassistant.py — Axon Alarms + Home Assistant
# Estratto da server.py (righe originali 23288-24237). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V50.z8 — Axon Alarms (Timer / Sveglie / Promemoria in-app, personali)
# =========================================================================
# Modello unificato per Timer + Sveglie + Promemoria. La schedulazione
# effettiva della notifica avviene lato client via expo-notifications; il
# backend fa da store persistente sincronizzato tra dispositivi. Ogni doc:
#   id (uuid), user_id, kind, label, enabled, note,
#   trigger_at (ISO), weekdays (per ricorrenza sveglia), duration_seconds
#   (per timer), sound_ref (default|<sound_id>), vibrate,
#   created_at, updated_at.
# Suoni personalizzati: doc separato in axon_alarm_sounds con base64.

_AXON_ALARM_KINDS = {"timer", "alarm", "reminder"}


def _validate_hhmm(s: str) -> bool:
    try:
        h, m = s.split(":")
        return 0 <= int(h) <= 23 and 0 <= int(m) <= 59
    except Exception:
        return False


@api_router.get("/axon/alarms")
async def list_axon_alarms(user=Depends(get_current_user)):
    """Ritorna tutte le sveglie/timer/promemoria personali dell'utente."""
    tenant = user["user_id"]
    docs = await db.axon_alarms.find(
        {"user_id": tenant}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return {"items": docs}


@api_router.post("/axon/alarms")
async def create_axon_alarm(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Crea una nuova sveglia/timer/promemoria.

    Payload:
        kind: "timer"|"alarm"|"reminder" (obbligatorio)
        label: str (obbligatorio)
        enabled: bool (default True)
        note: str | None
        sound_ref: "default" | sound_id (default "default")
        vibrate: bool (default True)
        # Timer:
        duration_seconds: int > 0
        # Sveglia:
        time: "HH:MM"
        weekdays: [0..6]  (0=Domenica ... 6=Sabato); [] = one-shot domani
        # Promemoria:
        trigger_at: ISO datetime
    """
    return await _create_axon_alarm_doc(user, payload)


async def _create_axon_alarm_doc(user: dict, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Valida il payload, inserisce il doc in `axon_alarms` e lo ritorna.
    Condiviso tra l'endpoint REST e il comando vocale/testuale di Axon
    (V50.z125 `_maybe_alarm_command`)."""
    tenant = user["user_id"]
    kind = (payload.get("kind") or "").strip().lower()
    if kind not in _AXON_ALARM_KINDS:
        raise HTTPException(status_code=400, detail="kind non valido")
    label = (payload.get("label") or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="label mancante")
    if len(label) > 120:
        label = label[:120]
    note = (payload.get("note") or "").strip() or None
    if note and len(note) > 500:
        note = note[:500]
    sound_ref = (payload.get("sound_ref") or "default").strip() or "default"
    vibrate = bool(payload.get("vibrate", True))
    # V50.z78 — Volume 0-100 (default 100 = massimo). Applicato al player al trigger.
    try:
        volume = int(payload.get("volume", 100))
    except Exception:
        volume = 100
    volume = max(0, min(100, volume))
    now_utc = utcnow()

    doc: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "user_id": tenant,
        "kind": kind,
        "label": label,
        "note": note,
        "enabled": bool(payload.get("enabled", True)),
        "sound_ref": sound_ref,
        "vibrate": vibrate,
        "volume": volume,
        "created_at": now_utc.isoformat(),
        "updated_at": now_utc.isoformat(),
        "last_triggered_at": None,
    }

    if kind == "timer":
        dur = payload.get("duration_seconds")
        if not isinstance(dur, int) or dur <= 0 or dur > 24 * 3600:
            raise HTTPException(status_code=400, detail="duration_seconds non valido")
        doc["duration_seconds"] = dur
        trig = now_utc + timedelta(seconds=dur)
        doc["trigger_at"] = trig.isoformat()

    elif kind == "alarm":
        t = (payload.get("time") or "").strip()
        if not _validate_hhmm(t):
            raise HTTPException(status_code=400, detail="time (HH:MM) non valido")
        weekdays = payload.get("weekdays") or []
        if not isinstance(weekdays, list):
            raise HTTPException(status_code=400, detail="weekdays deve essere una lista")
        weekdays = sorted({int(d) for d in weekdays if isinstance(d, int) and 0 <= d <= 6})
        doc["time"] = t
        doc["weekdays"] = weekdays

    elif kind == "reminder":
        ts_raw = (payload.get("trigger_at") or "").strip()
        try:
            trig_dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="trigger_at non valido (ISO)")
        if trig_dt.tzinfo is None:
            trig_dt = trig_dt.replace(tzinfo=timezone.utc)
        doc["trigger_at"] = trig_dt.isoformat()

    await db.axon_alarms.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/axon/alarms/{alarm_id}")
async def update_axon_alarm(alarm_id: str, payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Aggiorna una sveglia esistente. Non consente di cambiare `kind`."""
    tenant = user["user_id"]
    existing = await db.axon_alarms.find_one({"id": alarm_id, "user_id": tenant})
    if not existing:
        raise HTTPException(status_code=404, detail="Sveglia non trovata")
    updates: Dict[str, Any] = {"updated_at": utcnow().isoformat()}
    if "label" in payload:
        lbl = (payload.get("label") or "").strip()
        if not lbl:
            raise HTTPException(status_code=400, detail="label vuota")
        updates["label"] = lbl[:120]
    if "note" in payload:
        nt = (payload.get("note") or "").strip() or None
        updates["note"] = nt[:500] if nt else None
    if "enabled" in payload:
        updates["enabled"] = bool(payload["enabled"])
    if "sound_ref" in payload:
        updates["sound_ref"] = (payload.get("sound_ref") or "default").strip() or "default"
    if "vibrate" in payload:
        updates["vibrate"] = bool(payload["vibrate"])
    # V50.z78 — Volume 0-100
    if "volume" in payload:
        try:
            vol = int(payload["volume"])
        except Exception:
            vol = 100
        updates["volume"] = max(0, min(100, vol))

    kind = existing["kind"]
    if kind == "timer" and "duration_seconds" in payload:
        dur = payload.get("duration_seconds")
        if not isinstance(dur, int) or dur <= 0 or dur > 24 * 3600:
            raise HTTPException(status_code=400, detail="duration_seconds non valido")
        updates["duration_seconds"] = dur
        updates["trigger_at"] = (utcnow() + timedelta(seconds=dur)).isoformat()
    elif kind == "alarm":
        if "time" in payload:
            t = (payload.get("time") or "").strip()
            if not _validate_hhmm(t):
                raise HTTPException(status_code=400, detail="time (HH:MM) non valido")
            updates["time"] = t
        if "weekdays" in payload:
            wd = payload.get("weekdays") or []
            if not isinstance(wd, list):
                raise HTTPException(status_code=400, detail="weekdays lista")
            updates["weekdays"] = sorted({int(d) for d in wd if isinstance(d, int) and 0 <= d <= 6})
    elif kind == "reminder" and "trigger_at" in payload:
        ts_raw = (payload.get("trigger_at") or "").strip()
        try:
            trig_dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except Exception:
            raise HTTPException(status_code=400, detail="trigger_at non valido")
        if trig_dt.tzinfo is None:
            trig_dt = trig_dt.replace(tzinfo=timezone.utc)
        updates["trigger_at"] = trig_dt.isoformat()

    await db.axon_alarms.update_one({"id": alarm_id, "user_id": tenant}, {"$set": updates})
    doc = await db.axon_alarms.find_one({"id": alarm_id, "user_id": tenant}, {"_id": 0})
    return doc


@api_router.post("/axon/alarms/{alarm_id}/toggle")
async def toggle_axon_alarm(alarm_id: str, user=Depends(get_current_user)):
    tenant = user["user_id"]
    existing = await db.axon_alarms.find_one({"id": alarm_id, "user_id": tenant})
    if not existing:
        raise HTTPException(status_code=404, detail="Sveglia non trovata")
    new_val = not bool(existing.get("enabled", True))
    await db.axon_alarms.update_one(
        {"id": alarm_id, "user_id": tenant},
        {"$set": {"enabled": new_val, "updated_at": utcnow().isoformat()}},
    )
    return {"id": alarm_id, "enabled": new_val}


@api_router.delete("/axon/alarms/{alarm_id}")
async def delete_axon_alarm(alarm_id: str, user=Depends(get_current_user)):
    tenant = user["user_id"]
    res = await db.axon_alarms.delete_one({"id": alarm_id, "user_id": tenant})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sveglia non trovata")
    return {"ok": True, "id": alarm_id}


# ─── Suoni personalizzati (upload mp3 base64) ──────────────────────────
# NB: iOS non supporta suoni notifica custom senza bundling nativo. Su
# Android si può usare qualsiasi suono. In-app la riproduzione avviene
# via expo-audio quando l'app è in foreground → funziona su entrambi.

_MAX_SOUND_SIZE_B64 = 2_000_000  # ~1.5 MB base64 (mp3 ~30s)


@api_router.get("/axon/alarm-sounds")
async def list_axon_alarm_sounds(user=Depends(get_current_user)):
    tenant = user["user_id"]
    docs = await db.axon_alarm_sounds.find(
        {"user_id": tenant}, {"_id": 0, "data_base64": 0}
    ).sort("created_at", -1).to_list(50)
    return {"items": docs}


@api_router.get("/axon/alarm-sounds/{sound_id}/data")
async def get_axon_alarm_sound_data(sound_id: str, user=Depends(get_current_user)):
    """Ritorna il base64 del suono (per download+cache sul device)."""
    tenant = user["user_id"]
    doc = await db.axon_alarm_sounds.find_one(
        {"id": sound_id, "user_id": tenant}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Suono non trovato")
    return doc


@api_router.post("/axon/alarm-sounds")
async def upload_axon_alarm_sound(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Carica un suono mp3/wav/aac personalizzato (max ~1.5MB).

    Payload: {name, mime, data_base64}
    """
    tenant = user["user_id"]
    name = (payload.get("name") or "").strip() or "Suono personalizzato"
    mime = (payload.get("mime") or "audio/mpeg").strip()
    data_b64 = payload.get("data_base64") or ""
    if not isinstance(data_b64, str) or not data_b64:
        raise HTTPException(status_code=400, detail="data_base64 mancante")
    # Pulizia data URL prefix
    if data_b64.startswith("data:"):
        try:
            data_b64 = data_b64.split(",", 1)[1]
        except Exception:
            pass
    if len(data_b64) > _MAX_SOUND_SIZE_B64:
        raise HTTPException(status_code=400, detail="Suono troppo grande (max ~1.5MB)")
    allowed_mime = ("audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/mp4", "audio/x-m4a")
    if mime not in allowed_mime:
        # accetta comunque ma normalizza
        mime = "audio/mpeg"

    now_iso = utcnow().isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": tenant,
        "name": name[:80],
        "mime": mime,
        "data_base64": data_b64,
        "size_bytes": len(data_b64) * 3 // 4,
        "created_at": now_iso,
    }
    await db.axon_alarm_sounds.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("data_base64", None)  # non ritornarlo qui
    return doc


@api_router.delete("/axon/alarm-sounds/{sound_id}")
async def delete_axon_alarm_sound(sound_id: str, user=Depends(get_current_user)):
    tenant = user["user_id"]
    res = await db.axon_alarm_sounds.delete_one({"id": sound_id, "user_id": tenant})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Suono non trovato")
    # Reset alarms che usavano questo suono → torna a default
    await db.axon_alarms.update_many(
        {"user_id": tenant, "sound_ref": sound_id},
        {"$set": {"sound_ref": "default", "updated_at": utcnow().isoformat()}},
    )
    return {"ok": True, "id": sound_id}


# =========================================================================
# V50.z9 — Home Assistant Integration (domotica open-source)
# =========================================================================
# L'utente configura URL + Long-Lived Access Token della propria istanza HA
# (self-hosted, gratis). Il backend fa da proxy sicuro: il token è cifrato
# a riposo con Fernet (stessa chiave di Drive) e mai esposto al client.
# Endpoint HA supportati:
#   • GET /api/states          → list entities
#   • POST /api/services/<domain>/<service>  → azioni
# Dominii tipici: light, switch, cover, lock, climate, scene.

_HA_SUPPORTED_DOMAINS = {
    "light", "switch", "cover", "lock", "scene", "climate", "fan",
    "media_player", "vacuum", "input_boolean", "button",
}


def _ha_encrypt(token: str) -> str:
    if not _gd_fernet:
        raise HTTPException(status_code=500, detail="Chiave di cifratura non configurata (GOOGLE_DRIVE_TOKEN_KEY)")
    return _gd_fernet.encrypt(token.encode()).decode()


def _ha_decrypt(enc: str) -> str:
    if not _gd_fernet:
        raise HTTPException(status_code=500, detail="Chiave di cifratura non configurata")
    return _gd_fernet.decrypt(enc.encode()).decode()


async def _ha_get_config(tenant: str) -> Optional[Dict[str, Any]]:
    return await db.homeassistant_configs.find_one({"user_id": tenant}, {"_id": 0})


async def _ha_request(
    tenant: str, method: str, path: str,
    json_body: Optional[Dict[str, Any]] = None,
    timeout: float = 8.0,
) -> Tuple[int, Any]:
    """Effettua una chiamata autenticata all'istanza HA dell'utente.
    Ritorna (status_code, parsed_body).
    """
    cfg = await _ha_get_config(tenant)
    if not cfg:
        raise HTTPException(status_code=400, detail="Home Assistant non configurato")
    base_url = (cfg.get("base_url") or "").rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="URL istanza HA mancante")
    try:
        token = _ha_decrypt(cfg["access_token_enc"])
    except Exception:
        raise HTTPException(status_code=500, detail="Impossibile decifrare il token HA")

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    url = f"{base_url}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            resp = await client.request(method, url, headers=headers, json=json_body)
            try:
                data = resp.json()
            except Exception:
                data = resp.text
            return resp.status_code, data
    except httpx.RequestError as exc:
        logger.warning("[ha] request %s %s failed: %s", method, path, exc)
        raise HTTPException(status_code=502, detail=f"Errore connessione HA: {exc}")


@api_router.get("/homeassistant/config")
async def ha_get_config(user=Depends(get_current_user)):
    """Ritorna la config HA dell'utente (token mascherato)."""
    tenant = user["user_id"]
    cfg = await _ha_get_config(tenant)
    if not cfg:
        return {"connected": False}
    return {
        "connected": True,
        "base_url": cfg.get("base_url"),
        "verified": cfg.get("verified", False),
        "last_verified_at": cfg.get("last_verified_at"),
        "label": cfg.get("label"),
    }


@api_router.post("/homeassistant/config")
async def ha_save_config(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Salva URL + Long-Lived Access Token della propria istanza HA."""
    tenant = user["user_id"]
    base_url = (payload.get("base_url") or "").strip().rstrip("/")
    token = (payload.get("access_token") or "").strip()
    label = (payload.get("label") or "").strip() or "Casa"

    if not base_url or not (base_url.startswith("http://") or base_url.startswith("https://")):
        raise HTTPException(status_code=400, detail="base_url deve iniziare con http:// o https://")
    if not token or len(token) < 20:
        raise HTTPException(status_code=400, detail="Access token non valido")

    enc = _ha_encrypt(token)

    # Verifica connessione con un ping /api/
    verified = False
    verify_err: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=6.0, verify=False) as client:
            resp = await client.get(
                f"{base_url}/api/",
                headers={"Authorization": f"Bearer {token}"},
            )
            verified = 200 <= resp.status_code < 300
            if not verified:
                verify_err = f"HTTP {resp.status_code}"
    except httpx.RequestError as exc:
        verify_err = str(exc)

    now_iso = utcnow().isoformat()
    doc = {
        "user_id": tenant,
        "base_url": base_url,
        "access_token_enc": enc,
        "label": label[:60],
        "verified": verified,
        "last_verified_at": now_iso if verified else None,
        "last_error": verify_err,
        "updated_at": now_iso,
        "created_at": now_iso,
    }
    existing = await db.homeassistant_configs.find_one({"user_id": tenant})
    if existing:
        # keep created_at
        doc["created_at"] = existing.get("created_at", now_iso)
        await db.homeassistant_configs.replace_one({"user_id": tenant}, doc)
    else:
        await db.homeassistant_configs.insert_one(doc)
    return {
        "connected": True,
        "base_url": base_url,
        "verified": verified,
        "last_verified_at": doc["last_verified_at"],
        "label": doc["label"],
        "last_error": verify_err,
    }


@api_router.delete("/homeassistant/config")
async def ha_delete_config(user=Depends(get_current_user)):
    tenant = user["user_id"]
    await db.homeassistant_configs.delete_one({"user_id": tenant})
    return {"connected": False}


@api_router.get("/homeassistant/entities")
async def ha_list_entities(user=Depends(get_current_user)):
    """Elenca le entità supportate (light/switch/cover/…)."""
    tenant = user["user_id"]
    status_code, data = await _ha_request(tenant, "GET", "/api/states")
    if status_code >= 400 or not isinstance(data, list):
        raise HTTPException(status_code=502, detail=f"HA errore ({status_code})")
    items: List[Dict[str, Any]] = []
    for st in data:
        eid = st.get("entity_id") or ""
        if not eid or "." not in eid:
            continue
        domain = eid.split(".", 1)[0]
        if domain not in _HA_SUPPORTED_DOMAINS:
            continue
        attrs = st.get("attributes") or {}
        items.append({
            "entity_id": eid,
            "domain": domain,
            "state": st.get("state"),
            "friendly_name": attrs.get("friendly_name") or eid,
            "icon": attrs.get("icon"),
            "supported_features": attrs.get("supported_features"),
            "brightness": attrs.get("brightness"),
            "current_position": attrs.get("current_position"),
        })
    # Ordina per dominio + nome
    items.sort(key=lambda x: (x["domain"], x["friendly_name"].lower()))
    return {"items": items}


@api_router.post("/homeassistant/service")
async def ha_call_service(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Chiama un servizio HA arbitrario.
    Payload: {domain, service, entity_id, extra: {...}}
    Esempi:
      light.turn_on / light.turn_off / cover.open_cover / cover.close_cover / lock.lock
    """
    tenant = user["user_id"]
    domain = (payload.get("domain") or "").strip()
    service = (payload.get("service") or "").strip()
    entity_id = (payload.get("entity_id") or "").strip()
    extra = payload.get("extra") or {}
    if domain not in _HA_SUPPORTED_DOMAINS:
        raise HTTPException(status_code=400, detail=f"dominio non supportato: {domain}")
    if not service:
        raise HTTPException(status_code=400, detail="service mancante")
    body: Dict[str, Any] = {}
    if entity_id:
        body["entity_id"] = entity_id
    body.update({k: v for k, v in extra.items() if isinstance(k, str)})
    status_code, data = await _ha_request(
        tenant, "POST", f"/api/services/{domain}/{service}", json_body=body
    )
    if status_code >= 400:
        raise HTTPException(status_code=502, detail=f"HA errore ({status_code}): {data}")
    return {"ok": True, "response": data}


@api_router.post("/homeassistant/toggle")
async def ha_toggle(payload: Dict[str, Any] = Body(...), user=Depends(get_current_user)):
    """Toggle rapido su light/switch/cover/lock. Il backend deduce il servizio
    dallo stato corrente."""
    tenant = user["user_id"]
    entity_id = (payload.get("entity_id") or "").strip()
    if "." not in entity_id:
        raise HTTPException(status_code=400, detail="entity_id non valido")
    domain = entity_id.split(".", 1)[0]
    if domain not in _HA_SUPPORTED_DOMAINS:
        raise HTTPException(status_code=400, detail=f"dominio non supportato: {domain}")

    # Prendi stato attuale per dedurre l'azione inversa
    sc, cur = await _ha_request(tenant, "GET", f"/api/states/{entity_id}")
    if sc >= 400 or not isinstance(cur, dict):
        raise HTTPException(status_code=502, detail=f"HA stato ({sc})")
    state = (cur.get("state") or "").lower()

    if domain in ("light", "switch", "input_boolean", "fan"):
        service = "turn_off" if state in ("on", "true") else "turn_on"
    elif domain == "cover":
        service = "close_cover" if state in ("open", "opening") else "open_cover"
    elif domain == "lock":
        service = "unlock" if state == "locked" else "lock"
    elif domain == "media_player":
        service = "media_pause" if state in ("playing",) else "media_play"
    else:
        service = "toggle"

    sc2, resp = await _ha_request(
        tenant, "POST", f"/api/services/{domain}/{service}",
        json_body={"entity_id": entity_id},
    )
    if sc2 >= 400:
        raise HTTPException(status_code=502, detail=f"HA azione ({sc2}): {resp}")
    return {"ok": True, "service": service, "new_state_hint": service}


# V50.z85 — Drive re-indexing: cache testo dei file Drive per RAG in AxonOS
_DRIVE_REINDEX_RUNNING: set = set()


def _schedule_drive_reindex(user_id: str, reason: str = "") -> None:
    """V50.z155 — Avvia il reindex in background (fire-and-forget) se non già in corso."""
    if not user_id or user_id in _DRIVE_REINDEX_RUNNING:
        return
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(_reindex_drive_files_for_user(user_id, max_files=300))
        logger.info("[drive-reindex] scheduled user=%s reason=%s", user_id, reason)
    except Exception as e:
        logger.warning("[drive-reindex] cannot schedule user=%s: %s", user_id, e)


def _drive_walk_and_collect(creds, root_folders: List[Dict[str, str]], single_files: List[str],
                            max_folders: int = 80, max_depth: int = 6, max_files: int = 300) -> Tuple[List[Dict[str, Any]], int]:
    """SYNC (eseguita in thread): BFS ricorsiva sulle cartelle radice.
    Ritorna (files, folders_scanned). Ogni file ha `_folder_path` e `_root_id`."""
    from googleapiclient.discovery import build  # type: ignore
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    MIME_FOLDER = "application/vnd.google-apps.folder"
    WANT = (
        "mimeType = 'application/pdf' or mimeType contains 'text/' or mimeType = 'application/json' or "
        "mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or "
        f"mimeType = '{MIME_FOLDER}'"
    )
    files: List[Dict[str, Any]] = []
    visited: set = set()
    queue: List[Tuple[str, int, str, str]] = []
    for rf in root_folders:
        if rf["id"] not in visited:
            visited.add(rf["id"])
            queue.append((rf["id"], 0, rf.get("name") or "", rf["id"]))
    scanned = 0
    while queue and scanned < max_folders and len(files) < max_files:
        fid, depth, path, root_id = queue.pop(0)
        scanned += 1
        page_token = None
        for _ in range(3):
            try:
                res = service.files().list(
                    q=f"'{fid}' in parents and trashed = false and ({WANT})",
                    pageSize=500, orderBy="folder,modifiedTime desc",
                    fields="nextPageToken, files(id,name,mimeType,size,modifiedTime,parents)",
                    pageToken=page_token,
                ).execute()
            except Exception as e:
                logger.warning("[drive-reindex] list %s failed: %s", fid, e)
                break
            for ch in res.get("files", []) or []:
                mt = ch.get("mimeType") or ""
                if mt == MIME_FOLDER:
                    if ch["id"] not in visited and depth < max_depth:
                        visited.add(ch["id"])
                        queue.append((ch["id"], depth + 1, f"{path}/{ch.get('name') or ''}" if path else (ch.get("name") or ""), root_id))
                else:
                    ch["_folder_path"] = path
                    ch["_root_id"] = root_id
                    files.append(ch)
                    if len(files) >= max_files:
                        break
            page_token = res.get("nextPageToken")
            if not page_token or len(files) >= max_files:
                break
    for sfid in single_files[:20]:
        try:
            meta = service.files().get(fileId=sfid, fields="id,name,mimeType,size,modifiedTime,parents").execute()
            meta["_folder_path"] = ""
            meta["_root_id"] = sfid
            files.append(meta)
        except Exception as e:
            logger.warning("[drive-reindex] meta %s failed: %s", sfid, e)
    return files, scanned


def _drive_download_text(creds, f: Dict[str, Any]) -> str:
    """SYNC (thread): scarica/esporta un file e ne estrae il testo (max 100k char)."""
    from googleapiclient.discovery import build  # type: ignore
    from googleapiclient.http import MediaIoBaseDownload  # type: ignore
    from io import BytesIO
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    mt = f.get("mimeType") or ""
    fid = f["id"]
    if mt == "application/vnd.google-apps.document":
        req = service.files().export_media(fileId=fid, mimeType="text/plain"); mt = "text/plain"
    elif mt == "application/vnd.google-apps.spreadsheet":
        req = service.files().export_media(fileId=fid, mimeType="text/csv"); mt = "text/csv"
    else:
        req = service.files().get_media(fileId=fid)
    buf = BytesIO()
    dl = MediaIoBaseDownload(buf, req, chunksize=1024 * 1024)
    done = False
    while not done:
        _, done = dl.next_chunk()
    data = buf.getvalue()[: 12 * 1024 * 1024]
    text = ""
    if mt == "application/pdf":
        try: text = _extract_pdf_text_bytes(data) or ""
        except Exception: text = ""
    else:
        try: text = data.decode("utf-8", errors="ignore")
        except Exception: text = ""
    return re.sub(r"\s{3,}", " ", text or "").strip()[:100000]


async def _reindex_drive_files_for_user(user_id: str, max_files: int = 300) -> Dict[str, int]:
    """V50.z155 — Re-indicizza RICORSIVAMENTE le cartelle Drive monitorate
    (Impostazioni → Google Drive) + i link Drive di "Insegna ad Axon".
    Tutte le chiamate Google girano in thread (non bloccano l'event loop).
    Salva testo in `drive_snapshots`, stato in `drive_index_meta`.
    """
    stats = {"scanned": 0, "updated": 0, "skipped": 0, "failed": 0, "removed": 0}
    if user_id in _DRIVE_REINDEX_RUNNING:
        return stats
    _DRIVE_REINDEX_RUNNING.add(user_id)
    started = utcnow()
    err_msg = None
    try:
        row = await db.google_drive_connections.find_one({"user_id": user_id})
        if not row:
            return stats
        roots, single_files = await _drive_index_roots(user_id)
        if not roots and not single_files:
            return stats
        await db.drive_index_meta.update_one(
            {"user_id": user_id}, {"$set": {"status": "running", "started_at": started}}, upsert=True
        )
        creds = await _gd_get_credentials(user_id)
        files, folders_scanned = await asyncio.to_thread(_drive_walk_and_collect, creds, roots, single_files, 80, 6, max_files)
        current_ids = set()
        for f in files:
            fid = f["id"]
            current_ids.add(fid)
            stats["scanned"] += 1
            existing = await db.drive_snapshots.find_one({"user_id": user_id, "file_id": fid}, {"_id": 0, "modified_time": 1, "folder_path": 1})
            if existing and existing.get("modified_time") == f.get("modifiedTime"):
                if existing.get("folder_path") != f.get("_folder_path"):
                    await db.drive_snapshots.update_one({"user_id": user_id, "file_id": fid}, {"$set": {"folder_path": f.get("_folder_path") or ""}})
                stats["skipped"] += 1
                continue
            try:
                text = await asyncio.to_thread(_drive_download_text, creds, f)
                await db.drive_snapshots.update_one(
                    {"user_id": user_id, "file_id": fid},
                    {"$set": {
                        "user_id": user_id, "file_id": fid,
                        "name": f.get("name") or fid, "mime": f.get("mimeType") or "",
                        "size": int(f.get("size") or 0), "modified_time": f.get("modifiedTime"),
                        "parents": f.get("parents") or [], "folder_path": f.get("_folder_path") or "",
                        "root_id": f.get("_root_id"), "text": text, "indexed_at": utcnow(),
                    }},
                    upsert=True,
                )
                stats["updated"] += 1
            except Exception as e:
                stats["failed"] += 1
                logger.debug(f"[drive-reindex] {fid} failed: {e}")
        # Rimuovi dall'indice i file non più presenti nelle cartelle (solo se la scansione ha prodotto qualcosa)
        if folders_scanned > 0 or single_files:
            r = await db.drive_snapshots.delete_many({"user_id": user_id, "file_id": {"$nin": list(current_ids)}})
            stats["removed"] = int(r.deleted_count or 0)
    except HTTPException as e:
        err_msg = str(e.detail)
        logger.warning(f"[drive-reindex] user {user_id} auth/config error: {e.detail}")
    except Exception as e:
        err_msg = str(e)[:300]
        logger.warning(f"[drive-reindex] user {user_id} failed: {e}")
    finally:
        _DRIVE_REINDEX_RUNNING.discard(user_id)
        try:
            cnt = await db.drive_snapshots.count_documents({"user_id": user_id})
            await db.drive_index_meta.update_one(
                {"user_id": user_id},
                {"$set": {"status": "error" if err_msg else "ok", "error": err_msg, "last_run_at": utcnow(),
                          "duration_s": (utcnow() - started).total_seconds(), "files_count": cnt, "stats": stats}},
                upsert=True,
            )
        except Exception:
            pass
    return stats


async def _run_drive_reindex_job() -> None:
    """Job periodico: reindicizza i file Drive per tutti gli utenti connessi."""
    try:
        cur = db.google_drive_connections.find({}, {"user_id": 1, "_id": 0})
        n_users = 0
        totals = {"scanned": 0, "updated": 0, "skipped": 0, "failed": 0}
        async for row in cur:
            uid = row.get("user_id")
            if not uid:
                continue
            n_users += 1
            s = await _reindex_drive_files_for_user(uid, max_files=300)
            for k in totals: totals[k] += s.get(k, 0)
        if n_users:
            logger.info(f"[drive-reindex] users={n_users} scanned={totals['scanned']} updated={totals['updated']} skipped={totals['skipped']} failed={totals['failed']}")
    except Exception as e:
        logger.warning(f"[drive-reindex] job failed: {e}")


@api_router.post("/google-drive/reindex")
async def google_drive_manual_reindex(user=Depends(get_current_user)):
    """V50.z155 — Avvia un reindex on-demand in background (può durare minuti);
    lo stato è consultabile su GET /google-drive/reindex/status."""
    running = user["user_id"] in _DRIVE_REINDEX_RUNNING
    if not running:
        _schedule_drive_reindex(user["user_id"], reason="manual")
    return {"ok": True, "started": not running, "running": True}


@api_router.get("/google-drive/reindex/status")
async def google_drive_reindex_status(user=Depends(get_current_user)):
    """Restituisce quanti file sono indicizzati e quando è avvenuto l'ultimo update."""
    cnt = await db.drive_snapshots.count_documents({"user_id": user["user_id"]})
    latest = await db.drive_snapshots.find_one(
        {"user_id": user["user_id"]},
        {"_id": 0, "name": 1, "indexed_at": 1, "modified_time": 1},
        sort=[("indexed_at", -1)],
    )
    meta = await db.drive_index_meta.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    for k in ("last_run_at", "started_at"):
        if isinstance(meta.get(k), datetime):
            meta[k] = meta[k].isoformat()
    folders_cnt = await db.google_drive_folders.count_documents({"user_id": user["user_id"]})
    return {
        "indexed_files": cnt,
        "folders": folders_cnt,
        "running": user["user_id"] in _DRIVE_REINDEX_RUNNING,
        "meta": meta,
        "latest_file": (latest or {}).get("name"),
        "latest_indexed_at": (latest or {}).get("indexed_at").isoformat() if latest and isinstance(latest.get("indexed_at"), datetime) else (latest or {}).get("indexed_at"),
    }


# V50.z89 — Tavily Extract API (raccoglie il testo pulito di una URL specifica)
class TavilyExtractIn(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    include_images: bool = False


@api_router.post("/axon/web-extract")
async def axon_web_extract(body: TavilyExtractIn, user=Depends(get_current_user)):
    """Scarica il contenuto testuale pulito di una URL via Tavily Extract API.
    Utile quando AxonOS deve leggere una pagina specifica invece di fare una
    ricerca generica. Ritorna `{url, title, content, images}` o errore.
    """
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Tavily non configurato")
    url = body.url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL deve iniziare con http:// o https://")
    try:
        async with _httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                "https://api.tavily.com/extract",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"urls": [url], "include_images": bool(body.include_images)},
            )
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Tavily extract error {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
            results = data.get("results") or []
            if not results:
                return {"available": False, "url": url}
            r0 = results[0]
            content = r0.get("raw_content") or r0.get("content") or ""
            # Trim per non far esplodere il context
            if len(content) > 40000:
                content = content[:40000] + "\n\n[... contenuto troncato ...]"
            return {
                "available": True,
                "url": r0.get("url") or url,
                "title": r0.get("title"),
                "content": content,
                "images": r0.get("images") or [],
                "response_time": data.get("response_time"),
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Tavily extract failed: {exc}")


@api_router.get("/axon/tavily-status")
async def axon_tavily_status(user=Depends(get_current_user)):
    """Diagnostica: verifica che Tavily sia configurato e raggiungibile."""
    key = os.environ.get("TAVILY_API_KEY")
    return {"configured": bool(key), "key_prefix": (key[:8] + "…") if key else None}


# V50.z92 — Estrazione contenuti da WebView e salvataggio in KB / scheda cliente / analisi
class WebpageSaveIn(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    target: Literal["kb", "contact", "instant"]
    contact_id: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=500)


@api_router.post("/axon/webpage-save")
async def axon_webpage_save(body: WebpageSaveIn, user=Depends(get_current_user)):
    """Estrae contenuto pulito dalla URL via Tavily e lo salva in base al target.
    - kb: inserisce in db.axon_kb (tenant-scoped, usato da RAG Axon).
    - contact: aggiunge una nota alla scheda contatto.
    - instant: restituisce il contenuto senza persisterlo (client lo passa alla chat).
    """
    tid = tenant_id(user)
    url_norm = body.url.strip()
    if not (url_norm.startswith("http://") or url_norm.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL deve iniziare con http:// o https://")

    # Estrai contenuto (usa cache DB introdotta in V50.z91)
    content = await _tavily_extract_url(url_norm)
    if not content:
        raise HTTPException(status_code=502, detail="Impossibile estrarre il contenuto della pagina")

    # Ricava un titolo semplice dal contenuto (# heading in prima riga se presente)
    title = url_norm
    first_line = content.split("\n", 1)[0].strip()
    if first_line.startswith("### "):
        title = first_line[4:].strip() or url_norm

    if body.target == "kb":
        doc = {
            "kb_id": f"kb_{uuid.uuid4().hex[:12]}",
            "user_id": tid,
            "created_by": user["user_id"],
            "url": url_norm,
            "title": title,
            "content": content,
            "note": (body.note or "").strip() or None,
            "source": "webview",
            "created_at": utcnow(),
        }
        await db.axon_kb.insert_one(doc)
        return {"ok": True, "target": "kb", "kb_id": doc["kb_id"], "title": title, "preview": content[:400]}

    if body.target == "contact":
        if not body.contact_id:
            raise HTTPException(status_code=400, detail="contact_id richiesto per target=contact")
        c = await db.contacts.find_one({"user_id": tid, "contact_id": body.contact_id}, {"_id": 0, "contact_id": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Contatto non trovato")
        note_text = (
            f"🌐 Da WebView Axon · {title}\n"
            f"URL: {url_norm}\n\n"
            + (f"Nota utente: {body.note.strip()}\n\n" if (body.note or "").strip() else "")
            + content[:6000]
        )
        note_doc = {
            "note_id": f"n_{uuid.uuid4().hex[:12]}",
            "text": note_text,
            "created_by": user["user_id"],
            "source": "webview_axon",
            "created_at": utcnow(),
        }
        await db.contacts.update_one(
            {"user_id": tid, "contact_id": body.contact_id},
            {"$push": {"notes": note_doc}},
        )
        return {"ok": True, "target": "contact", "contact_id": body.contact_id, "title": title, "preview": content[:400]}

    # instant: non salvo, client userà `content` come contesto per la chat
    return {"ok": True, "target": "instant", "title": title, "content": content, "preview": content[:400]}


# V50.z91 — URL Extract cache admin
@api_router.get("/axon/url-cache/status")
async def axon_url_cache_status(user=Depends(get_current_user)):
    """Diagnostica: conteggio URL in cache + più recente."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può leggere lo stato cache")
    n = await db.url_extract_cache.count_documents({})
    latest = await db.url_extract_cache.find_one(
        {}, {"_id": 0, "url": 1, "title": 1, "fetched_at": 1},
        sort=[("fetched_at", -1)],
    )
    return {
        "cached_urls": n,
        "latest_url": (latest or {}).get("url"),
        "latest_title": (latest or {}).get("title"),
        "latest_fetched_at": (latest or {}).get("fetched_at").isoformat() if latest and isinstance(latest.get("fetched_at"), datetime) else (latest or {}).get("fetched_at"),
    }


@api_router.delete("/axon/url-cache")
async def axon_url_cache_purge(user=Depends(get_current_user), older_than_hours: Optional[int] = None):
    """Svuota la cache URL. Se `older_than_hours` fornito, elimina solo entry più vecchie."""
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Solo il Master può svuotare la cache")
    q: Dict[str, Any] = {}
    if older_than_hours and older_than_hours > 0:
        cutoff = utcnow() - timedelta(hours=older_than_hours)
        q["fetched_at"] = {"$lt": cutoff}
    result = await db.url_extract_cache.delete_many(q)
    return {"deleted": result.deleted_count}


# =====================================================================
