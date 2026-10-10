# axon_stress_autofix.py — V50.z508 — AUTOCORREZIONE AUTOMATICA dopo il test notturno di Axon.
# Dopo ogni run notturno concluso: tutte le domande con stato «Fallito» che hanno una correzione suggerita vengono applicate
# da sole (stesse regole di «Applica correzione»: db.axon_prompt_rules), poi le domande corrette vengono RIVERIFICATE una volta
# con le nuove regole attive e si calcola il nuovo punteggio. L'utente riceve UNA sola notifica riepilogativa:
# «Test notturno completato: X correzioni applicate, nuovo punteggio Y%» (in-app + push; allarme prioritario solo se il punteggio
# resta sotto soglia). Impostazione: user_settings.stress_nightly.autofix (default ATTIVO; PUT /axon/stress/nightly {autofix}).
# Isolato: sostituisce _st_nightly_after_finalize (nome risolto a runtime da _st_finalize di axon_stress_test). Endpoint manuale:
# POST /axon/stress/autofix/{run_id} (owner) per lanciare l'autocorrezione su un run esistente.
import asyncio as _af_asyncio

_ST_NIGHTLY_DEFAULT["autofix"] = True  # noqa: F821

_af_prev_norm = _st_nightly_norm  # noqa: F821


def _st_nightly_norm(v: dict, base=None) -> dict:  # noqa: F811
    d = _af_prev_norm(v, base)
    d.setdefault("autofix", True)
    if isinstance(v, dict) and "autofix" in v:
        d["autofix"] = bool(v["autofix"])
    return d


class StressNightlyAutofixIn(StressNightlyIn):  # noqa: F821
    autofix: Optional[bool] = None  # noqa: F821


for _r in list(api_router.routes):  # noqa: F821 — sostituisce PUT /axon/stress/nightly per accettare anche «autofix»
    if getattr(_r, "path", "").endswith("/axon/stress/nightly") and "PUT" in (getattr(_r, "methods", None) or set()):
        api_router.routes.remove(_r)  # noqa: F821


@api_router.put("/axon/stress/nightly")  # noqa: F821
async def stress_nightly_put(body: StressNightlyAutofixIn, user=Depends(get_current_user)):  # noqa: F811, F821
    _st_require_owner(user)  # noqa: F821
    cur = await _st_nightly_settings(user["user_id"])  # noqa: F821
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    new = _st_nightly_norm(patch, base=cur)
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"stress_nightly": new, "updated_at": utcnow()}}, upsert=True)  # noqa: F821
    return await _st_nightly_status(user["user_id"])  # noqa: F821


async def _af_apply_all(run: dict, user: dict) -> dict:
    """Applica tutte le correzioni suggerite delle domande FALLITE; poi riverifica ogni domanda corretta 1 volta. Ritorna il riepilogo."""
    items = run.get("items") or []
    tid = tenant_id(user)  # noqa: F821
    applied = []
    for it in items:
        if it.get("outcome") != "failed" or it.get("correction_applied"):
            continue
        q = {"question": it["question"], "expected": it.get("expected") or [], "flag": it.get("flag") or ""}
        corr = it.get("correction") or _st_suggest_correction(q, it.get("reps") or [])  # noqa: F821
        rule_text = (corr.get("rule") or "").strip()
        if not rule_text:
            continue
        doc = {"rule_id": f"pr_{uuid.uuid4().hex[:10]}", "tenant_id": tid, "created_by": user["user_id"],  # noqa: F821
               "question": it["question"], "expected": q["expected"], "flag": q["flag"], "rule": rule_text,
               "source": {"run_id": run["run_id"], "question_id": it["id"], "auto": True}, "created_at": utcnow(), "active": True}  # noqa: F821
        await db.axon_prompt_rules.update_one({"tenant_id": tid, "question": it["question"]}, {"$set": doc}, upsert=True)  # noqa: F821
        await db.axon_stress_runs.update_one({"run_id": run["run_id"], "items.id": it["id"]},  # noqa: F821
                                             {"$set": {"items.$.correction_applied": True, "items.$.correction_auto": True, "items.$.correction": corr}})
        applied.append({**it, "correction": corr})
    _ST_RULES_CACHE.pop(tid, None)  # noqa: F821
    try:
        _dl_invalidate(tid)  # noqa: F821 — la mappa deep link include le correzioni
    except Exception:  # noqa: BLE001
        pass

    s = run.get("summary") or {}
    tested, passed = int(s.get("tested") or 0), int(s.get("passed") or 0)
    reverified_ok = 0
    if applied:
        token = create_jwt(user["user_id"])  # noqa: F821
        sem = _af_asyncio.Semaphore(3)
        async with _st_httpx.AsyncClient() as client:  # noqa: F821
            async def recheck(it):
                nonlocal reverified_ok
                async with sem:
                    reply = await _st_ask(client, token, it["question"], f"autofix_{run['run_id']}_{it['id']}")  # noqa: F821
                    ev = _st_evaluate({"question": it["question"], "expected": it.get("expected") or [], "flag": it.get("flag") or ""}, reply)  # noqa: F821
                    ok = bool(ev.get("ok"))
                    if ok:
                        reverified_ok += 1
                    await db.axon_stress_runs.update_one({"run_id": run["run_id"], "items.id": it["id"]},  # noqa: F821
                                                         {"$set": {"items.$.autofix_recheck": {"ok": ok, "reason": ev.get("reason"), "reply": (reply or "")[:600], "at": utcnow()}}})  # noqa: F821
            await _af_asyncio.gather(*[recheck(it) for it in applied])
    new_pct = round(100 * (passed + reverified_ok) / tested, 1) if tested else float(s.get("pct_passed") or 0)
    out = {"applied": len(applied), "reverified_ok": reverified_ok, "failed_before": int(s.get("failed") or 0), "pct_before": s.get("pct_passed"), "new_pct": new_pct, "at": utcnow()}  # noqa: F821
    await db.axon_stress_runs.update_one({"run_id": run["run_id"]}, {"$set": {"autofix": out}})  # noqa: F821
    logger.info("[STRESS-AUTOFIX] run=%s applicate=%s riverificate_ok=%s nuovo_punteggio=%s%%", run["run_id"], out["applied"], reverified_ok, new_pct)  # noqa: F821
    return out


_af_prev_after_finalize = _st_nightly_after_finalize  # noqa: F821


async def _st_nightly_after_finalize(run: dict):  # noqa: F811
    """Verdetto notturno + AUTOCORREZIONE + UNA sola notifica riepilogativa (sostituisce i messaggi standard quando l'autofix è attivo)."""
    uid = run["user_id"]
    cfg = await _st_nightly_settings(uid)  # noqa: F821
    if not cfg.get("autofix", True):
        return await _af_prev_after_finalize(run)
    s = run.get("summary") or {}
    if not s.get("tested") or (s.get("errors", 0) > s.get("tested", 0)):
        return await _af_prev_after_finalize(run)  # confronto non affidabile: comportamento standard
    user = await db.users.find_one({"user_id": uid}, {"_id": 0})  # noqa: F821
    if not user:
        return await _af_prev_after_finalize(run)
    full = await db.axon_stress_runs.find_one({"run_id": run["run_id"]}, {"_id": 0})  # noqa: F821
    prev = await db.axon_stress_runs.find_one({"user_id": uid, "nightly": True, "status": {"$in": ["done", "stopped"]}, "run_id": {"$ne": run["run_id"]}, "summary.tested": {"$gt": 0}},  # noqa: F821
                                              {"_id": 0, "summary": 1, "autofix": 1}, sort=[("created_at", -1)])
    prev_pct = (prev or {}).get("summary", {}).get("pct_passed") if prev else None
    try:
        fix = await _af_apply_all(full, user)
    except Exception as e:  # noqa: BLE001
        logger.warning("[STRESS-AUTOFIX] failed: %s", e)  # noqa: F821
        return await _af_prev_after_finalize(run)
    pct = s.get("pct_passed", 0)
    new_pct = fix["new_pct"]
    reasons = []
    if new_pct < cfg["threshold_pct"]:
        reasons.append(f"punteggio {new_pct}% sotto la soglia {cfg['threshold_pct']}%")
    if prev_pct is not None and prev_pct - new_pct >= cfg["drop_pct"]:
        reasons.append(f"calo di {round(prev_pct - new_pct, 1)} punti rispetto alla notte precedente ({prev_pct}%)")
    verdict = "alert" if reasons else "ok"
    await db.axon_stress_runs.update_one({"run_id": run["run_id"]}, {"$set": {"nightly_verdict": verdict, "nightly_reasons": reasons, "nightly_prev_pct": prev_pct}})  # noqa: F821
    title = "🧪 Test notturno completato"
    msg = f"Test notturno completato: {fix['applied']} correzioni applicate, nuovo punteggio {new_pct}%"
    detail = f" (prima {pct}%: {s.get('failed', 0)} fallite su {s.get('tested', 0)}; {fix['reverified_ok']} delle corrette ora rispondono bene)." if fix["applied"] else f" (nessuna domanda fallita con correzione disponibile; {s.get('passed', 0)} ok su {s.get('tested', 0)})."
    route = f"/axon-stress-report?run={run['run_id']}"
    try:
        await db.axon_alerts.insert_one({"alert_id": f"aal_{uuid.uuid4().hex[:12]}", "tenant_id": uid, "type": "stress_quality", "title": title, "message": msg + detail,  # noqa: F821
                                         "route": route, "run_id": run["run_id"], "seen": False, "created_at": utcnow()})  # noqa: F821
    except Exception as e:  # noqa: BLE001
        logger.warning("[STRESS-AUTOFIX] alert insert failed: %s", e)  # noqa: F821
    try:
        if reasons:
            await axon_critical_alert(uid, "stress_test", title, msg + detail + " Attenzione: " + "; ".join(reasons) + ".",  # noqa: F821
                                      route=route, dedupe_key=f"stress-{run['run_id']}", voice_text=msg + ".",
                                      extra={"pct": pct, "new_pct": new_pct, "prev_pct": prev_pct, "applied": fix["applied"], "reasons": reasons, "run_id": run["run_id"]})
        else:
            await axon_notify(uid, uid, "axon_message", title, msg + detail, deeplink=route, dedupe_key=f"stress-{run['run_id']}", team_copy=False,  # noqa: F821
                              extra={"pct": pct, "new_pct": new_pct, "applied": fix["applied"], "run_id": run["run_id"]})
    except Exception as e:  # noqa: BLE001
        logger.warning("[STRESS-AUTOFIX] notify failed: %s", e)  # noqa: F821


@api_router.post("/axon/stress/autofix/{run_id}")  # noqa: F821
async def stress_autofix_now(run_id: str, user=Depends(get_current_user)):  # noqa: F821
    """Applica subito tutte le correzioni suggerite delle domande fallite di un run (owner) e riverifica. Utile per provare la funzione."""
    _st_require_owner(user)  # noqa: F821
    run = await db.axon_stress_runs.find_one({"run_id": run_id, "user_id": user["user_id"]}, {"_id": 0})  # noqa: F821
    if not run:
        raise HTTPException(status_code=404, detail="Run non trovato")  # noqa: F821
    if run.get("status") not in ("done", "stopped"):
        raise HTTPException(status_code=409, detail="Il run non è ancora concluso")  # noqa: F821
    fix = await _af_apply_all(run, user)
    return {"ok": True, **{k: v for k, v in fix.items() if k != "at"}, "message": f"Test completato: {fix['applied']} correzioni applicate, nuovo punteggio {fix['new_pct']}%"}


# V50.z508 — Le risposte di cortesia per errore LLM temporaneo («Sono temporaneamente offline, riprova…») NON sono bocciature:
# vanno conteggiate come errori (come «__ERRORE__»), altrimenti il punteggio crolla e l'autofix applica regole inutili.
import re as _af_re

_AF_OFFLINE_RX = _af_re.compile(r"temporaneamente offline|riprova tra qualche minuto|riprova più tardi|servizio momentaneamente non disponibile", _af_re.I)
_af_prev_evaluate = _st_evaluate  # noqa: F821


def _st_evaluate(q: dict, reply: str) -> dict:  # noqa: F811
    if reply and len(reply) < 160 and _AF_OFFLINE_RX.search(reply):
        return {"ok": None, "routes": [], "actions": [], "matched": None, "broken": [], "reason": "Errore LLM temporaneo (Axon offline): non conteggiato", "error": True}
    return _af_prev_evaluate(q, reply)
