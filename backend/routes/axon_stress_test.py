# ============================================================================
# V50.z260 — STRESS TEST AXONOS: valuta la qualità delle risposte di Axon su tutta l'app
# ----------------------------------------------------------------------------
# FASE 1  — 200+ domande realistiche con esito atteso (routes/axon_stress_questions.py)
# FASE 2  — ogni domanda inviata N volte (default 5) in sessioni separate, in momenti
#           diversi (ripetizione r di TUTTE le domande prima della r+1), via il vero
#           endpoint /assistant/chat/stream (intercettori + LLM, cache saltata).
#           Verifiche: deep link corretto · coerenza tra ripetizioni · niente funzioni
#           inventate (trap) · il deep link esiste davvero (validazione route frontend).
# FASE 3  — report: API per la schermata /axon-stress-report + HTML per PDF.
# FASE 4  — correzioni: per ogni fallimento una regola suggerita per il prompt di Axon;
#           «Applica» la salva in db.axon_prompt_rules → iniettata SUBITO nel system
#           prompt (wrapper _prepare_assistant_prompt) + shortcut deterministico.
# ============================================================================
import asyncio as _st_asyncio
import re as _st_re
import os as _st_os
import json as _st_json
import httpx as _st_httpx
from routes.axon_stress_questions import QUESTIONS as _ST_QUESTIONS

_ST_NAV_RX = _st_re.compile(r"\[\[NAV:([^|\]]+)\|([^\]]+)\]\]")
_ST_ACT_RX = _st_re.compile(r"\[\[ACTION:([a-z_]+)\|")
_ST_TRAP_OK = ["non esiste", "non è disponibile", "non e disponibile", "non c'è", "non c'e", "non è possibile", "non e possibile",
               "non posso", "non prevede", "non è prevista", "non supporta", "non ancora", "al momento non", "purtroppo",
               "non è una funzione", "non fa parte", "non include", "non offre", "non ho questa", "non è tra le funzioni", "non rientra"]
_ST_RUNS: dict = {}  # run_id → asyncio.Task (solo processo corrente)


def _st_qid(i: int) -> str:
    return f"q{i + 1:03d}"


def _st_questions() -> list:
    return [dict(id=_st_qid(i), category=c, question=q, expected=exp, flag=f) for i, (c, q, exp, f) in enumerate(_ST_QUESTIONS)]


# ---------------------------------------------------------------------------
# Validazione route: il deep link deve corrispondere a una schermata reale
# ---------------------------------------------------------------------------
# NB: i moduli sono exec-uati con __file__ = server.py (/app/backend) → frontend in ../frontend/app
_ST_FRONT_APP = _st_os.path.normpath(_st_os.path.join(_st_os.path.dirname(_st_os.path.abspath(__file__)), "..", "frontend", "app"))
_ST_ROUTE_CACHE: dict = {"set": None}


def _st_frontend_routes() -> set:
    """Route reali dal file-system di expo-router (fallback: route di APP_MAP)."""
    if _ST_ROUTE_CACHE["set"] is not None:
        return _ST_ROUTE_CACHE["set"]
    routes = set()
    try:
        for root, _dirs, files in _st_os.walk(_ST_FRONT_APP):
            for fn in files:
                if not fn.endswith(".tsx") or fn.startswith("_") or fn.startswith("+"):
                    continue
                rel = _st_os.path.relpath(_st_os.path.join(root, fn), _ST_FRONT_APP)[:-4]
                parts = [p for p in rel.split(_st_os.sep) if not (p.startswith("(") and p.endswith(")"))]
                if parts and parts[-1] == "index":
                    parts = parts[:-1]
                routes.add("/" + "/".join(parts))
    except Exception:
        pass
    if not routes:
        routes = {e["route"].split("?")[0] for e in APP_MAP}  # noqa: F821
    _ST_ROUTE_CACHE["set"] = routes
    return routes


def _st_route_exists(route: str) -> bool:
    path = route.split("?")[0].rstrip("/") or "/"
    known = _st_frontend_routes()
    if path in known:
        return True
    segs = path.strip("/").split("/")
    for k in known:
        ks = k.strip("/").split("/")
        if len(ks) == len(segs) and all(a == b or (a[:1] in "[{" and a[-1:] in "]}") for a, b in zip(ks, segs)):
            return True
    return False


# ---------------------------------------------------------------------------
# Valutazione di una singola risposta
# ---------------------------------------------------------------------------
def _st_route_matches(found: str, expected: str) -> bool:
    if expected.startswith("ACTION:"):
        return False
    if "?" in expected:
        return found.startswith(expected)
    fp = found.split("?")[0]
    if expected.endswith("/"):
        return fp.startswith(expected)
    return fp == expected or fp.startswith(expected + "/")


def _st_evaluate(q: dict, reply: str) -> dict:
    routes = [r.strip() for r, _ in _ST_NAV_RX.findall(reply or "")]
    actions = _ST_ACT_RX.findall(reply or "")
    broken = [r for r in routes if not _st_route_exists(r)]
    low = (reply or "").lower()
    exp = q["expected"]
    flag = q["flag"]
    matched = None
    for e in exp:
        if e.startswith("ACTION:") and e[7:] in actions:
            matched = e; break
        if any(_st_route_matches(r, e) for r in routes):
            matched = e; break
    if flag == "trap":
        invented = bool(routes) and not any(k in low for k in _ST_TRAP_OK)
        ok = (not invented) and (any(k in low for k in _ST_TRAP_OK) or not routes)
        reason = "" if ok else "Ha proposto una funzione/percorso per qualcosa che non esiste"
    elif flag == "conv":
        ok = matched is not None or (not routes and len(low) > 20)
        reason = "" if ok else "Ha proposto link non pertinenti"
    else:
        ok = matched is not None
        reason = "" if ok else ("Nessun deep link nella risposta" if not routes else "Deep link verso la funzione sbagliata")
    if broken:
        ok = False
        reason = f"Deep link inesistente: {', '.join(broken)}"
    return {"ok": ok, "routes": routes, "actions": actions, "matched": matched, "broken": broken, "reason": reason}


def _st_route_name(route: str) -> str:
    for e in APP_MAP:  # noqa: F821
        if e["route"] == route:
            return e["name"]
    for e in APP_MAP:  # noqa: F821
        if e["route"].split("?")[0] == route.split("?")[0]:
            return e["name"]
    return route


def _st_suggest_correction(q: dict, evals: list) -> dict:
    """Correzione suggerita al prompt (regola precisa e applicabile con un tap)."""
    exp = q["expected"]
    if q["flag"] == "trap":
        rule = (f"Se l'utente chiede qualcosa come «{q['question']}»: questa funzione NON esiste in AdvisorOS. "
                "Dillo chiaramente in una frase, non inventare percorsi né marker [[NAV]]; se esiste un'alternativa vicina, proponila come tale.")
        expected_txt = "Risposta onesta: la funzione non esiste (nessun deep link inventato)."
    else:
        primary = exp[0] if exp else ""
        if primary.startswith("ACTION:"):
            expected_txt = f"Flusso multi-step con conferma [[ACTION:{primary[7:]}|…]]"
            rule = f"Se l'utente chiede qualcosa come «{q['question']}», avvia il flusso «{primary[7:]}» (riepilogo + pulsante di conferma), non una risposta generica."
        else:
            name = _st_route_name(primary)
            expected_txt = f"[[NAV:{primary}|{name}]]"
            alts = ", ".join(f"[[NAV:{e}|{_st_route_name(e)}]]" for e in exp[1:3])
            rule = (f"Se l'utente chiede qualcosa come «{q['question']}» → proponi «{name}» con il marker [[NAV:{primary}|{name}]]"
                    + (f" (alternative accettabili: {alts})" if alts else "") + ". Rispondi in 1-2 frasi + marker, senza descrivere il percorso a parole.")
    return {"expected_text": expected_txt, "rule": rule}


# ---------------------------------------------------------------------------
# Esecuzione run (background)
# ---------------------------------------------------------------------------
async def _st_ask(client, token: str, question: str, session_id: str) -> str:
    base = f"http://127.0.0.1:{_st_os.environ.get('PORT', '8001')}/api/assistant/chat/stream"
    text = ""
    try:
        async with client.stream("POST", base, json={"message": question, "session_id": session_id, "no_cache": True},
                                 headers={"Authorization": f"Bearer {token}"}, timeout=120) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    d = _st_json.loads(line[5:].strip())
                except Exception:
                    continue
                if "text" in d and "stage" not in d:
                    text += d["text"]
    except Exception as e:
        text = f"__ERRORE__ {e}"
    return text


async def _st_run(run_id: str, user: dict, reps: int, qs: list):
    token = create_jwt(user["user_id"])  # noqa: F821
    sem = _st_asyncio.Semaphore(3)
    try:
        async with _st_httpx.AsyncClient() as client:
            for rep in range(1, reps + 1):
                async def one(q):
                    async with sem:
                        run_doc = await db.axon_stress_runs.find_one({"run_id": run_id}, {"_id": 0, "status": 1})  # noqa: F821
                        if not run_doc or run_doc.get("status") == "stopped":
                            return
                        sid = f"stress_{run_id}_{q['id']}_r{rep}"
                        reply = await _st_ask(client, token, q["question"], sid)
                        ev = _st_evaluate(q, reply)
                        await db.axon_stress_runs.update_one({"run_id": run_id, "items.id": q["id"]}, {  # noqa: F821
                            "$push": {"items.$.reps": {"rep": rep, "reply": reply[:1500], "ok": ev["ok"], "routes": ev["routes"], "actions": ev["actions"], "reason": ev["reason"], "at": utcnow()}},  # noqa: F821
                            "$inc": {"done": 1}, "$set": {"updated_at": utcnow()},  # noqa: F821
                        })
                await _st_asyncio.gather(*[one(q) for q in qs])
                run_doc = await db.axon_stress_runs.find_one({"run_id": run_id}, {"_id": 0, "status": 1})  # noqa: F821
                if not run_doc or run_doc.get("status") == "stopped":
                    break
        await _st_finalize(run_id)
    except Exception as e:
        logger.exception("[STRESS] run failed: %s", e)
        await db.axon_stress_runs.update_one({"run_id": run_id}, {"$set": {"status": "error", "error": str(e), "updated_at": utcnow()}})  # noqa: F821
    finally:
        _ST_RUNS.pop(run_id, None)


async def _st_finalize(run_id: str):
    run = await db.axon_stress_runs.find_one({"run_id": run_id}, {"_id": 0})  # noqa: F821
    if not run:
        return
    passed = failed = inconsistent = 0
    items = run.get("items") or []
    for it in items:
        reps = it.get("reps") or []
        if not reps:
            it["outcome"] = "skipped"; continue
        oks = [r["ok"] for r in reps]
        if all(oks):
            it["outcome"] = "passed"; passed += 1
        elif not any(oks):
            it["outcome"] = "failed"; failed += 1
        else:
            it["outcome"] = "inconsistent"; inconsistent += 1
        if it["outcome"] != "passed":
            q = {"question": it["question"], "expected": it["expected"], "flag": it["flag"]}
            it["correction"] = _st_suggest_correction(q, reps)
    tested = passed + failed + inconsistent
    summary = {"tested": tested, "passed": passed, "failed": failed, "inconsistent": inconsistent,
               "pct_passed": round(100 * passed / tested, 1) if tested else 0,
               "pct_failed": round(100 * failed / tested, 1) if tested else 0,
               "pct_inconsistent": round(100 * inconsistent / tested, 1) if tested else 0}
    status = "stopped" if run.get("status") == "stopped" else "done"
    await db.axon_stress_runs.update_one({"run_id": run_id}, {"$set": {"items": items, "summary": summary, "status": status, "finished_at": utcnow(), "updated_at": utcnow()}})  # noqa: F821


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
class StressRunIn(BaseModel):
    reps: int = 5
    limit: Optional[int] = None          # None = tutte le domande
    categories: Optional[List[str]] = None


def _st_require_owner(user: dict):
    if user.get("parent_user_id") or (user.get("role") or "member") != "owner":
        raise HTTPException(status_code=403, detail="Strumento riservato al Master/Owner")


@api_router.get("/axon/stress/questions")
async def stress_questions(user=Depends(get_current_user)):
    _st_require_owner(user)
    qs = _st_questions()
    cats: dict = {}
    for q in qs:
        cats[q["category"]] = cats.get(q["category"], 0) + 1
    return {"total": len(qs), "categories": cats, "items": qs}


@api_router.post("/axon/stress/run")
async def stress_run(body: StressRunIn, user=Depends(get_current_user)):
    _st_require_owner(user)
    if await db.axon_stress_runs.find_one({"user_id": user["user_id"], "status": "running"}, {"_id": 0, "run_id": 1}):
        raise HTTPException(status_code=409, detail="C'è già uno stress test in corso")
    reps = max(1, min(int(body.reps or 5), 10))
    qs = _st_questions()
    if body.categories:
        qs = [q for q in qs if q["category"] in set(body.categories)]
    if body.limit:
        qs = qs[: max(1, int(body.limit))]
    if not qs:
        raise HTTPException(status_code=400, detail="Nessuna domanda selezionata")
    run_id = f"st_{uuid.uuid4().hex[:10]}"
    doc = {"run_id": run_id, "user_id": user["user_id"], "status": "running", "reps": reps, "total": len(qs) * reps, "done": 0,
           "created_at": utcnow(), "updated_at": utcnow(),
           "items": [{**q, "reps": [], "outcome": None, "correction": None, "correction_applied": False} for q in qs]}
    await db.axon_stress_runs.insert_one(doc)
    _ST_RUNS[run_id] = _st_asyncio.create_task(_st_run(run_id, user, reps, qs))
    return {"run_id": run_id, "total": doc["total"], "questions": len(qs), "reps": reps}


@api_router.post("/axon/stress/runs/{run_id}/stop")
async def stress_stop(run_id: str, user=Depends(get_current_user)):
    _st_require_owner(user)
    r = await db.axon_stress_runs.update_one({"run_id": run_id, "user_id": user["user_id"], "status": "running"}, {"$set": {"status": "stopped", "updated_at": utcnow()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Run non trovato o già terminato")
    if run_id not in _ST_RUNS:  # processo riavviato: finalizza subito con i dati raccolti
        await _st_finalize(run_id)
    return {"ok": True}


def _st_run_head(run: dict) -> dict:
    return {k: run.get(k) for k in ("run_id", "status", "reps", "total", "done", "created_at", "finished_at", "summary", "error")}


@api_router.get("/axon/stress/runs")
async def stress_runs(user=Depends(get_current_user)):
    _st_require_owner(user)
    out = []
    async for r in db.axon_stress_runs.find({"user_id": user["user_id"]}, {"_id": 0, "items": 0}).sort("created_at", -1).limit(20):
        # run "running" orfano (processo riavviato) → finalizza con quanto raccolto
        if r.get("status") == "running" and r["run_id"] not in _ST_RUNS:
            await db.axon_stress_runs.update_one({"run_id": r["run_id"]}, {"$set": {"status": "stopped"}})
            await _st_finalize(r["run_id"])
            r = await db.axon_stress_runs.find_one({"run_id": r["run_id"]}, {"_id": 0, "items": 0})
        out.append(_st_run_head(r))
    return {"runs": out}


@api_router.get("/axon/stress/runs/{run_id}")
async def stress_run_detail(run_id: str, outcome: Optional[str] = None, user=Depends(get_current_user)):
    _st_require_owner(user)
    run = await db.axon_stress_runs.find_one({"run_id": run_id, "user_id": user["user_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run non trovato")
    items = run.get("items") or []
    if run.get("status") == "running" or not run.get("summary"):
        # anteprima live: esito + riepilogo provvisori sulle ripetizioni fatte finora
        cnt = {"passed": 0, "failed": 0, "inconsistent": 0}
        for it in items:
            reps = it.get("reps") or []
            if reps:
                oks = [r["ok"] for r in reps]
                it["outcome"] = "passed" if all(oks) else ("failed" if not any(oks) else "inconsistent")
                cnt[it["outcome"]] += 1
        tested = sum(cnt.values())
        run["summary"] = {"tested": tested, **cnt, **{f"pct_{k}": (round(100 * v / tested, 1) if tested else 0) for k, v in cnt.items()}}
    if outcome:
        items = [it for it in items if it.get("outcome") == outcome]
    head = _st_run_head(run)
    head["items"] = items
    return head


class StressApplyIn(BaseModel):
    run_id: str
    question_id: str
    rule: Optional[str] = None  # testo modificato dall'utente (opzionale)


@api_router.post("/axon/stress/corrections/apply")
async def stress_apply(body: StressApplyIn, user=Depends(get_current_user)):
    _st_require_owner(user)
    run = await db.axon_stress_runs.find_one({"run_id": body.run_id, "user_id": user["user_id"]}, {"_id": 0, "items": 1})
    if not run:
        raise HTTPException(status_code=404, detail="Run non trovato")
    it = next((i for i in run["items"] if i["id"] == body.question_id), None)
    if not it:
        raise HTTPException(status_code=404, detail="Domanda non trovata")
    corr = it.get("correction") or _st_suggest_correction(it, it.get("reps") or [])
    rule_text = (body.rule or corr["rule"]).strip()
    doc = {"rule_id": f"pr_{uuid.uuid4().hex[:10]}", "tenant_id": tenant_id(user), "created_by": user["user_id"],  # noqa: F821
           "question": it["question"], "expected": it["expected"], "flag": it["flag"], "rule": rule_text,
           "source": {"run_id": body.run_id, "question_id": body.question_id}, "created_at": utcnow(), "active": True}
    await db.axon_prompt_rules.update_one({"tenant_id": doc["tenant_id"], "question": it["question"]}, {"$set": doc}, upsert=True)
    await db.axon_stress_runs.update_one({"run_id": body.run_id, "items.id": body.question_id}, {"$set": {"items.$.correction_applied": True, "items.$.correction": {**corr, "rule": rule_text}}})
    _ST_RULES_CACHE.pop(doc["tenant_id"], None)
    return {"ok": True, "rule": doc["rule"], "rule_id": doc["rule_id"]}


@api_router.get("/axon/stress/corrections")
async def stress_corrections(user=Depends(get_current_user)):
    _st_require_owner(user)
    items = await db.axon_prompt_rules.find({"tenant_id": tenant_id(user), "active": True}, {"_id": 0}).sort("created_at", -1).to_list(200)  # noqa: F821
    return {"items": items}


@api_router.delete("/axon/stress/corrections/{rule_id}")
async def stress_correction_delete(rule_id: str, user=Depends(get_current_user)):
    _st_require_owner(user)
    r = await db.axon_prompt_rules.delete_one({"rule_id": rule_id, "tenant_id": tenant_id(user)})  # noqa: F821
    _ST_RULES_CACHE.pop(tenant_id(user), None)  # noqa: F821
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Regola non trovata")
    return {"ok": True}


# ---------------------------------------------------------------------------
# FASE 4 — Applicazione immediata: regole nel system prompt + shortcut deterministico
# ---------------------------------------------------------------------------
_ST_RULES_CACHE: dict = {}


async def _st_rules(tid: str) -> list:
    if tid in _ST_RULES_CACHE:
        return _ST_RULES_CACHE[tid]
    rules = await db.axon_prompt_rules.find({"tenant_id": tid, "active": True}, {"_id": 0, "question": 1, "expected": 1, "flag": 1, "rule": 1}).sort("created_at", -1).to_list(80)  # noqa: F821
    _ST_RULES_CACHE[tid] = rules
    return rules


_st_prev_prepare = _prepare_assistant_prompt  # noqa: F821


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _st_prev_prepare(user, body)
    try:
        rules = await _st_rules(tenant_id(user))  # noqa: F821
        if rules and isinstance(prep, dict) and isinstance(prep.get("system_message"), str):
            sec = "📚 REGOLE APPRESE DAGLI STRESS TEST (priorità alta, applicale sempre):\n" + "\n".join(f"- {r['rule']}" for r in rules)
            prep["system_message"] += "\n\n" + sec
    except Exception as e:
        logger.warning("[STRESS] rules injection failed: %s", e)
    return prep


_st_prev_intercept = _nav_intercept  # noqa: F821


async def _nav_intercept(msg: str, user: dict):  # noqa: F811
    """Shortcut: domanda (quasi) identica a una regola applicata → risposta deterministica con il deep link atteso."""
    try:
        rules = await _st_rules(tenant_id(user))  # noqa: F821
        if rules:
            m = _nav_norm(msg).strip()  # noqa: F821
            for r in rules:
                if r.get("flag") == "trap" or not r.get("expected"):
                    continue
                if _nav_norm(r["question"]).strip() == m:  # noqa: F821
                    primary = r["expected"][0]
                    if primary.startswith("ACTION:"):
                        break  # i flussi passano dagli intercettori normali
                    marks = "\n".join(_nav(e, _st_route_name(e)) for e in r["expected"][:3] if not e.startswith("ACTION:"))  # noqa: F821
                    return _nav_reply(f"Ecco la funzione giusta: **{_st_route_name(primary)}**.\n{marks}")  # noqa: F821
    except Exception as e:
        logger.warning("[STRESS] rule shortcut failed: %s", e)
    return await _st_prev_intercept(msg, user)


# ---------------------------------------------------------------------------
# FASE 3 — HTML per il PDF (impaginato con tabelle)
# ---------------------------------------------------------------------------
def _st_esc(s) -> str:
    return (str(s) if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


@api_router.get("/axon/stress/runs/{run_id}/report-html")
async def stress_report_html(run_id: str, user=Depends(get_current_user)):
    _st_require_owner(user)
    run = await db.axon_stress_runs.find_one({"run_id": run_id, "user_id": user["user_id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run non trovato")
    s = run.get("summary") or {}
    items = run.get("items") or []
    lab = {"passed": "✅ Passato", "failed": "❌ Fallito", "inconsistent": "⚠️ Incoerente", "skipped": "— Non testato", None: "—"}
    rows = []
    for it in items:
        reps = it.get("reps") or []
        first = reps[0]["reply"] if reps else ""
        corr = (it.get("correction") or {})
        rows.append(f"<tr><td>{_st_esc(it['id'])}</td><td>{_st_esc(it['category'])}</td><td>{_st_esc(it['question'])}</td>"
                    f"<td>{lab.get(it.get('outcome'))}<br><small>{sum(1 for r in reps if r['ok'])}/{len(reps)} ok</small></td>"
                    f"<td class='small'>{_st_esc(first[:400])}</td><td class='small'>{_st_esc(corr.get('expected_text') or ', '.join(it.get('expected') or []) or ('funzione inesistente' if it.get('flag') == 'trap' else ''))}</td>"
                    f"<td class='small'>{_st_esc(corr.get('rule') or '')}{' <b>(applicata)</b>' if it.get('correction_applied') else ''}</td></tr>")
    when = run.get("created_at")
    when_s = when.strftime("%d/%m/%Y %H:%M") if hasattr(when, "strftime") else str(when or "")
    html = f"""<!doctype html><html><head><meta charset='utf-8'><title>Stress Test AxonOS</title>
<style>body{{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;margin:24px;font-size:12px}}
h1{{color:#4C1D95;margin:0 0 4px}} .sub{{color:#6B7280;margin-bottom:16px}}
.kpi{{display:flex;gap:12px;margin:12px 0 18px}} .kpi div{{flex:1;border:1px solid #E5E7EB;border-radius:10px;padding:10px;text-align:center}}
.kpi b{{display:block;font-size:20px}} table{{width:100%;border-collapse:collapse;page-break-inside:auto}}
th{{background:#EDE9FE;color:#4C1D95;text-align:left;padding:6px;border:1px solid #DDD6FE;font-size:11px}}
td{{padding:6px;border:1px solid #E5E7EB;vertical-align:top;font-size:11px}} tr{{page-break-inside:avoid}} .small{{font-size:10px;color:#374151}}</style></head><body>
<h1>Report Stress Test AxonOS</h1><div class='sub'>Run {_st_esc(run_id)} · {when_s} · {run.get('reps')} ripetizioni per domanda · stato: {_st_esc(run.get('status'))}</div>
<div class='kpi'><div><b>{s.get('tested', 0)}</b>Domande testate</div><div><b>{s.get('pct_passed', 0)}%</b>Corrette</div><div><b>{s.get('pct_failed', 0)}%</b>Fallite</div><div><b>{s.get('pct_inconsistent', 0)}%</b>Incoerenti</div></div>
<table><thead><tr><th>ID</th><th>Area</th><th>Domanda</th><th>Esito</th><th>Risposta Axon (1ª ripetizione)</th><th>Atteso</th><th>Correzione suggerita</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
</body></html>"""
    return {"html": html}
