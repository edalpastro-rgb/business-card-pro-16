# offline_sync.py — V50.z279 — MODALITÀ AEREO / OFFLINE (lato server)
# Il client accoda le scritture fatte senza rete e al ritorno online le invia qui una per una (in ordine).
# • Idempotenza: `op_id` già processato → restituisce la risposta salvata (nessun duplicato se il client perde la risposta).
# • Esecuzione: la richiesta originale viene rieseguita internamente (stessa route, stesso token) via ASGITransport.
# • Conflitti («segnala il conflitto al Master»): per PUT/PATCH/DELETE su clienti/appuntamenti, se il documento è stato
#   modificato sul server DOPO la modifica offline (updated_at > queued_at) la scrittura viene comunque applicata
#   (ultima vince) ma viene registrato un conflitto e notificati Master e autore, con deeplink all'elemento.
class OfflineReplayIn(BaseModel):
    op_id: str
    method: Literal["POST", "PUT", "PATCH", "DELETE"]
    path: str
    query: Optional[Dict[str, Any]] = None
    body: Optional[Any] = None
    queued_at: Optional[str] = None
    base_updated_at: Optional[str] = None
    label: Optional[str] = ""


_OFFLINE_CONFLICT_RX = re.compile(r"^/(contacts|appointments|callbacks|deadlines|courses)/([A-Za-z0-9_\-]+)$")
_OFFLINE_COLL = {"contacts": ("contacts", "contact_id", "Cliente", "/contact/{id}"), "appointments": ("appointments", "appointment_id", "Appuntamento", "/agenda"),
                 "callbacks": ("callbacks", "callback_id", "Richiamata", "/callbacks"), "deadlines": ("deadlines", "deadline_id", "Scadenza", "/deadlines"), "courses": ("courses_folders", "course_id", "Corso", "/courses/{id}")}


def _offline_parse_dt(v) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str) and v:
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:  # noqa: BLE001
            return None
    return None


_OFFLINE_IDX_DONE = {"ok": False}


@api_router.post("/offline/replay")
async def offline_replay(body: OfflineReplayIn, request: Request, user=Depends(get_current_user)):
    tenant = tenant_id(user)
    if not _OFFLINE_IDX_DONE["ok"]:
        _OFFLINE_IDX_DONE["ok"] = True
        try:
            await db.offline_ops.create_index("processed_at", expireAfterSeconds=7 * 86400)
            await db.offline_ops.create_index([("tenant_id", 1), ("op_id", 1)])
        except Exception:  # noqa: BLE001
            pass
    prev = await db.offline_ops.find_one({"tenant_id": tenant, "op_id": body.op_id}, {"_id": 0})
    if prev:
        return {"status": prev["status"], "data": prev.get("data"), "conflict": prev.get("conflict", False), "error": prev.get("error"), "replayed": True}
    if body.path.startswith("/offline") or body.path.startswith("/auth"):
        raise HTTPException(status_code=400, detail="Operazione non replicabile")

    # --- rilevamento conflitto (prima di applicare) ---
    conflict = False
    conflict_info: Optional[dict] = None
    m = _OFFLINE_CONFLICT_RX.match(body.path.split("?")[0])
    if m and body.method in ("PUT", "PATCH", "DELETE"):
        coll, id_key, label, route = _OFFLINE_COLL[m.group(1)]
        doc = await db[coll].find_one({id_key: m.group(2)}, {"_id": 0, "updated_at": 1, "updated_by": 1, "first_name": 1, "last_name": 1, "title": 1, "assigned_to_user_id": 1})
        q_at = _offline_parse_dt(body.queued_at)
        srv = _offline_parse_dt((doc or {}).get("updated_at"))
        base = _offline_parse_dt(body.base_updated_at)
        if doc and srv and ((q_at and srv > q_at) or (base and srv > base)):
            conflict = True
            name = f"{doc.get('first_name', '')} {doc.get('last_name', '')}".strip() or doc.get("title") or m.group(2)
            conflict_info = {"entity": label, "name": name, "route": route.replace("{id}", m.group(2)), "server_updated_at": srv, "offline_at": q_at, "fields": sorted((body.body or {}).keys())[:20] if isinstance(body.body, dict) else []}

    # --- esecuzione interna della richiesta originale ---
    q = "&".join(f"{_quote_plus_std(str(k))}={_quote_plus_std(str(v))}" for k, v in (body.query or {}).items() if v is not None and v != "")
    url = f"http://offline-replay/api{body.path}" + (f"?{q}" if q else "")
    headers = {"Authorization": request.headers.get("authorization", ""), "Content-Type": "application/json", "X-Offline-Replay": body.queued_at or "1"}
    status_code, data, err = 500, None, None
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), timeout=60) as client:  # noqa: F821 — app definita in 00_core
            r = await client.request(body.method, url, headers=headers, content=_json_stdlib.dumps(body.body) if body.body is not None else None)
        status_code = r.status_code
        try:
            data = r.json() if r.content else None
        except Exception:  # noqa: BLE001
            data = None
        if status_code >= 400:
            err = (data or {}).get("detail") if isinstance(data, dict) else None
            err = err if isinstance(err, str) else f"Errore {status_code}"
    except Exception as e:  # noqa: BLE001
        err = str(e)[:300]

    ok = 200 <= status_code < 300
    if ok and conflict and conflict_info:
        try:
            await db.offline_conflicts.insert_one({"conflict_id": f"ofc_{uuid.uuid4().hex[:10]}", "tenant_id": tenant, "user_id": user["user_id"], "user_name": user.get("name") or user.get("email"),
                                                   "op_id": body.op_id, "method": body.method, "path": body.path, **conflict_info, "created_at": utcnow()})
            who = user.get("name") or user.get("email")
            title = f"⚠️ Conflitto di modifica: {conflict_info['entity']} {conflict_info['name']}"
            txt = (f"{who} ha modificato «{conflict_info['name']}» offline ({(conflict_info['offline_at'] or utcnow()).astimezone().strftime('%d/%m %H:%M')}), ma nel frattempo l'elemento era stato aggiornato sul server "
                   f"({conflict_info['server_updated_at'].astimezone().strftime('%d/%m %H:%M')}). È stata applicata la versione offline. Campi: {', '.join(conflict_info['fields']) or '—'}. Controlla i dati.")
            for uid in {tenant, user["user_id"]}:
                await axon_notify(uid, tenant, "warning", title, txt, deeplink=conflict_info["route"], dedupe_key=f"offline_conflict_{body.op_id}_{uid}", team_copy=False)
        except Exception as e:  # noqa: BLE001
            logger.warning("[OFFLINE] conflict notify failed: %s", e)

    await db.offline_ops.insert_one({"tenant_id": tenant, "user_id": user["user_id"], "op_id": body.op_id, "method": body.method, "path": body.path, "label": body.label,
                                     "status": status_code, "data": data if ok else None, "error": err, "conflict": bool(ok and conflict), "queued_at": body.queued_at, "processed_at": utcnow()})
    return {"status": status_code, "data": data, "conflict": bool(ok and conflict), "error": err}


@api_router.get("/offline/conflicts")
async def offline_conflicts(user=Depends(get_current_user)):
    """Master: elenco conflitti registrati (ultimi 100). Collaboratore: solo i propri."""
    q: Dict[str, Any] = {"tenant_id": tenant_id(user)}
    if not is_owner(user):
        q["user_id"] = user["user_id"]
    items = await db.offline_conflicts.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"items": items}
