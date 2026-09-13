# axon_setup_wizard.py — V50.z211 — BLOCCO 1: wizard di onboarding «Set Up and Go» — stato + avviso Axon (modulo ISOLATO)
#
# Flusso: ToS → Tour (o skip) → /permessi (nuovo) → /setup (popup WOW «Dai, iniziamo. Sei pronto?» → Set Up and Go | Full and Go | Dopo).
# Stato per utente in `axon_setup_state`: status not_started|deferred|in_progress|completed, mode setup|full, current_step 1..4,
# steps {1..4: {done, skipped}}, core_prefs {}, permissions {location, microphone, camera, contacts}, deferred_at, completed_at, nudges.
# «Dopo»: configurabile in qualsiasi momento da Impostazioni → Configurazione guidata. AxonOS monitora le conversazioni: se la
# configurazione non è completa e la domanda tocca un'area non configurata, chiude con la frase-chiave (il frontend la trasforma in
# avviso con link diretto al wizard). Rate-limit: al massimo un avviso ogni 12 ore (`POST /axon/setup/nudge` dal client quando lo mostra).
# Il contenuto dei 4 step arriva nel BLOCCO 2: qui solo popup, struttura, progress bar, modalità e persistenza.

_SW_STATUSES = ("not_started", "deferred", "in_progress", "completed")
_SW_MODES = ("setup", "full")
_SW_STEPS = (1, 2, 3, 4)
_SW_NUDGE_PHRASE = "Completa la configurazione così la prossima volta posso esserti davvero utile"
_SW_NUDGE_EVERY_H = 12
# Passi per modalità: Set Up and Go = Step 1 + Step 2 + 3 preferenze core (pannello «core» dentro lo step 3); Full and Go = tutti e 4
_SW_MODE_STEPS = {"setup": [1, 2, 3], "full": [1, 2, 3, 4]}

_OMNI_EXTRA_SECTIONS.append((
    "Configurazione guidata «Set Up and Go» (onboarding)", "/setup",
    "Wizard in 4 step con barra di avanzamento: «Set Up and Go» (Step 1 + Step 2 + 3 preferenze core) oppure «Full and Go» (tutti e 4 gli step, "
    "ogni area saltabile senza invalidare il completamento). Chi sceglie «Dopo» può riprenderlo da Impostazioni → Configurazione guidata. "
    "La schermata /permessi (posizione, microfono, fotocamera, contatti) precede il popup di benvenuto.",
))


class SwStateIn(BaseModel):
    status: Optional[str] = None
    mode: Optional[str] = None
    current_step: Optional[int] = None
    step_updates: Optional[Dict[str, Dict[str, bool]]] = None   # {"1": {"done": true} , "4": {"skipped": true}}
    core_prefs: Optional[Dict[str, Any]] = None
    permissions: Optional[Dict[str, str]] = None                # {"location": "granted"|"denied"|"skipped"|"unavailable", ...}
    permissions_done: Optional[bool] = None


def _sw_default(uid: str) -> dict:
    return {"user_id": uid, "status": "not_started", "mode": None, "current_step": 1, "steps": {str(s): {"done": False, "skipped": False} for s in _SW_STEPS},
            "core_prefs": {}, "permissions": {}, "permissions_done": False, "deferred_at": None, "completed_at": None, "started_at": None, "nudges": 0, "last_nudge_at": None,
            "created_at": utcnow(), "updated_at": utcnow()}


def _sw_out(d: dict) -> dict:
    o = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items() if k != "_id"}
    o["mode_steps"] = _SW_MODE_STEPS.get(o.get("mode") or "", _SW_MODE_STEPS["full"])
    o["nudge_phrase"] = _SW_NUDGE_PHRASE
    return o


async def _sw_get(uid: str) -> dict:
    d = await db.axon_setup_state.find_one({"user_id": uid}, {"_id": 0})
    if not d:
        d = _sw_default(uid)
        await db.axon_setup_state.insert_one(dict(d))
        d.pop("_id", None)
    return d


@api_router.get("/axon/setup/state")
async def sw_state(user=Depends(get_current_user)):
    return _sw_out(await _sw_get(user["user_id"]))


@api_router.put("/axon/setup/state")
async def sw_update(body: SwStateIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    cur = await _sw_get(uid)
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.mode is not None:
        if body.mode not in _SW_MODES:
            raise HTTPException(status_code=400, detail="mode non valido")
        upd["mode"] = body.mode
    if body.status is not None:
        if body.status not in _SW_STATUSES:
            raise HTTPException(status_code=400, detail="status non valido")
        upd["status"] = body.status
        if body.status == "deferred":
            upd["deferred_at"] = utcnow()
        if body.status == "in_progress" and not cur.get("started_at"):
            upd["started_at"] = utcnow()
        if body.status == "completed":
            upd["completed_at"] = utcnow()
    if body.current_step is not None:
        if body.current_step not in _SW_STEPS:
            raise HTTPException(status_code=400, detail="current_step 1..4")
        upd["current_step"] = body.current_step
    if body.step_updates:
        for k, v in body.step_updates.items():
            if k not in {str(s) for s in _SW_STEPS}:
                raise HTTPException(status_code=400, detail=f"step {k} non valido")
            for f in ("done", "skipped"):
                if f in v:
                    upd[f"steps.{k}.{f}"] = bool(v[f])
    if body.core_prefs is not None:
        for k, v in body.core_prefs.items():
            upd[f"core_prefs.{str(k)[:40]}"] = v
    if body.permissions is not None:
        for k, v in body.permissions.items():
            if k in ("location", "microphone", "camera", "contacts"):
                upd[f"permissions.{k}"] = str(v)[:20]
    if body.permissions_done is not None:
        upd["permissions_done"] = bool(body.permissions_done)
    await db.axon_setup_state.update_one({"user_id": uid}, {"$set": upd})
    return _sw_out(await _sw_get(uid))


@api_router.post("/axon/setup/nudge")
async def sw_nudge(user=Depends(get_current_user)):
    """Il client ha mostrato l'avviso «Completa la configurazione…»: rate-limit 12 h."""
    await db.axon_setup_state.update_one({"user_id": user["user_id"]}, {"$set": {"last_nudge_at": utcnow()}, "$inc": {"nudges": 1}}, upsert=True)
    return {"ok": True}


@api_router.post("/axon/setup/reset")
async def sw_reset(user=Depends(get_current_user)):
    """Ricomincia da capo (Impostazioni → Configurazione guidata → Ripeti)."""
    await db.axon_setup_state.delete_one({"user_id": user["user_id"]})
    return _sw_out(await _sw_get(user["user_id"]))


# ============================================================================ AXON: avviso in chat quando la configurazione manca
_sw_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _sw_prev_prepare_prompt(user, body)
    try:
        if not prep.get("system_message"):
            return prep
        st = await db.axon_setup_state.find_one({"user_id": user["user_id"]}, {"_id": 0, "status": 1, "last_nudge_at": 1, "steps": 1})
        status = (st or {}).get("status") or "not_started"
        if status == "completed":
            return prep
        last = (st or {}).get("last_nudge_at")
        if isinstance(last, datetime) and (utcnow() - last) < timedelta(hours=_SW_NUDGE_EVERY_H):
            return prep
        prep["system_message"] += (
            f"\n\n🧭 CONFIGURAZIONE INIZIALE NON COMPLETATA (stato: {status}). L'utente ha rimandato il wizard «Set Up and Go». "
            "Rispondi normalmente con ciò che puoi. SOLO SE la richiesta non può essere soddisfatta bene perché manca una configurazione "
            "(integrazioni Google/Drive non collegate, preferenze non impostate, dati del profilo/azienda/zona assenti, orari o obiettivi non definiti), "
            f"chiudi la risposta con una riga separata che contiene ESATTAMENTE questa frase: «{_SW_NUDGE_PHRASE}». "
            "Non usare la frase se la risposta è completa. Non spiegare il wizard: il link lo aggiunge l'app."
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[setup-wizard] prompt failed: %s", exc)
    return prep


@app.on_event("startup")
async def _sw_start():
    try:
        await db.axon_setup_state.create_index([("user_id", 1)], unique=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[setup-wizard] start failed: %s", exc)
