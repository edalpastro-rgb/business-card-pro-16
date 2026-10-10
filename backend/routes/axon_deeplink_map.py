# axon_deeplink_map.py — V50.z508 — MAPPA ESPLICITA DEI DEEP LINK nelle istruzioni di Axon.
# Quando l'utente chiede come raggiungere/aprire una sezione (il Navigatore è attivo nel prompt), Axon riceve una mappa
# «frase dell'utente → marker [[NAV:route|Nome]]» costruita da: (1) la banca domande dello stress test (route attese),
# (2) le correzioni presenti nel report dell'ULTIMO stress test (domande fallite/incoerenti → marker atteso), messe in evidenza.
# Regola: 1-2 frasi + marker, MAI descrivere il percorso a parole. Cache 10 min per tenant. Isolato: avvolge _prepare_assistant_prompt
# (dopo axon_navigator e axon_stress_test). Endpoint di ispezione: GET /axon/deeplink-map (owner).
import time as _dl_time
from typing import Optional as _dl_Optional

_DL_CACHE: dict = {}  # tenant_id → (ts, text, stats)
_DL_TTL = 600
_DL_MAX_EXAMPLES = 4


def _dl_primary_route(expected: list) -> _dl_Optional[str]:
    if not expected:
        return None
    r = expected[0]
    if not isinstance(r, str) or r.startswith("ACTION:"):
        return None
    return r


async def _dl_build(tid: str) -> tuple:
    """Costruisce la mappa testo + statistiche. Fonte 1: banca domande (flag '' o 'conv'). Fonte 2: ultimo run (correzioni)."""
    by_route: dict = {}   # route → {"name": str, "examples": [str], "failed": [str]}

    def label(route: str) -> str:
        n = _st_route_name(route)  # noqa: F821
        if n != route:
            return n
        return route.strip("/").split("?")[0].replace("/", " · ").replace("-", " ").capitalize() or route

    def add(route: str, q: str, failed: bool):
        if route.endswith("/") or "{" in route:  # route con id (es. /contact/{id}) → si passa dall'elenco
            route = "/contatti" if route.startswith("/contact") else route.rstrip("/")
        e = by_route.setdefault(route, {"name": label(route), "examples": [], "failed": []})
        bucket = e["failed"] if failed else e["examples"]
        if q not in bucket and q not in e["failed"]:
            bucket.append(q)

    # (2) PRIMA le correzioni del report attuale (ultimo run concluso), così hanno priorità negli esempi
    last = await db.axon_stress_runs.find_one({"user_id": tid, "status": {"$in": ["done", "stopped"]}, "summary.tested": {"$gt": 0}},  # noqa: F821
                                              {"_id": 0, "run_id": 1, "items": 1, "created_at": 1}, sort=[("created_at", -1)])
    n_fail = 0
    for it in (last or {}).get("items") or []:
        if it.get("outcome") not in ("failed", "inconsistent") or it.get("flag") not in ("", None, "conv"):
            continue
        r = _dl_primary_route(it.get("expected") or [])
        if r:
            add(r, it["question"], True); n_fail += 1
    # (1) poi la banca domande
    for row in _ST_QUESTIONS:  # noqa: F821
        cat, q, exp, flag = row[0], row[1], row[2], (row[3] if len(row) > 3 else "")
        if flag not in ("", "conv"):
            continue
        r = _dl_primary_route(exp)
        if r:
            add(r, q, False)
    # anche le regole già applicate (axon_prompt_rules) con route attesa: restano nella mappa
    async for rule in db.axon_prompt_rules.find({"tenant_id": tid, "active": True, "flag": {"$in": ["", "conv"]}}, {"_id": 0, "question": 1, "expected": 1}):  # noqa: F821
        r = _dl_primary_route(rule.get("expected") or [])
        if r:
            add(r, rule["question"], True)

    # V50.z508 — solo route REALI (riscansione automatica a ogni deploy: axon_route_rescan) + schermate reali senza esempi
    for r in [r for r in by_route if not _st_route_exists(r)]:  # noqa: F821
        by_route.pop(r, None)
    real = _st_frontend_routes()  # noqa: F821
    extra = sorted(r for r in real if r not in by_route and "[" not in r and r not in ("/", "/index", "/login", "/landing") and not r.startswith("/public") and not r.startswith("/dev"))
    lines = ["🗺️ MAPPA ESPLICITA DEI DEEP LINK (priorità alta). Quando l'utente chiede come raggiungere/aprire/trovare una sezione, la risposta è "
             "1-2 frasi + il marker ESATTO indicato qui sotto (formato [[NAV:<route>|<etichetta>]], in fondo, su una riga). "
             "MAI descrivere il percorso a parole («vai in Impostazioni → …»): il marker diventa un pulsante nell'app. "
             "Le frasi marcate ⚠️ sono quelle sbagliate nell'ultimo stress test: usa ESATTAMENTE il marker indicato."]
    for route in sorted(by_route, key=lambda r: (not by_route[r]["failed"], by_route[r]["name"])):
        e = by_route[route]
        marker = f"[[NAV:{route}|{e['name']}]]"
        ex = [f"⚠️ «{q}»" for q in e["failed"][:_DL_MAX_EXAMPLES]] + [f"«{q}»" for q in e["examples"][: max(1, _DL_MAX_EXAMPLES - len(e["failed"]))]]
        lines.append(f"- {marker} ← " + " · ".join(ex))
    if extra:
        lines.append("ALTRE SCHERMATE REALI (nessun esempio, usa l'etichetta): " + " · ".join(f"[[NAV:{r}|{label(r)}]]" for r in extra))
    text = "\n".join(lines)
    stats = {"routes": len(by_route), "extra_routes": len(extra), "failed_examples": n_fail, "last_run_id": (last or {}).get("run_id"), "chars": len(text)}
    return text, stats


async def _dl_map(tid: str) -> tuple:
    now = _dl_time.time()
    hit = _DL_CACHE.get(tid)
    if hit and now - hit[0] < _DL_TTL:
        return hit[1], hit[2]
    text, stats = await _dl_build(tid)
    _DL_CACHE[tid] = (now, text, stats)
    return text, stats


def _dl_invalidate(tid: _dl_Optional[str] = None) -> None:
    if tid:
        _DL_CACHE.pop(tid, None)
    else:
        _DL_CACHE.clear()


_dl_prev_prepare = _prepare_assistant_prompt  # noqa: F821


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _dl_prev_prepare(user, body)
    try:
        sm = prep.get("system_message") if isinstance(prep, dict) else None
        # Solo quando il Navigatore è attivo (l'utente ha chiesto di aprire/trovare una sezione): niente rumore nelle altre risposte
        if isinstance(sm, str) and "🧭 NAVIGATORE APP" in sm and "🗺️ MAPPA ESPLICITA DEI DEEP LINK" not in sm:
            text, _ = await _dl_map(tenant_id(user))  # noqa: F821
            prep["system_message"] = sm + "\n\n" + text
    except Exception as e:  # noqa: BLE001
        logger.warning("[deeplink-map] injection failed: %s", e)  # noqa: F821
    return prep


@api_router.get("/axon/deeplink-map")  # noqa: F821
async def axon_deeplink_map(refresh: bool = False, probe: str = "", user=Depends(get_current_user)):  # noqa: F821
    """Ispezione della mappa deep link iniettata nel prompt (owner/Master). ?probe=<frase> → come viene classificata la frase."""
    _st_require_owner(user)  # noqa: F821
    tid = tenant_id(user)  # noqa: F821
    if refresh:
        _dl_invalidate(tid)
    text, stats = await _dl_map(tid)
    out = {"stats": stats, "text": text}
    if probe:
        out["probe"] = {"message": probe, "intent": _nav_intent(probe), "base_intent": _dl_prev_intent(probe), "mapped_question": _dl_is_mapped_question(probe),
                        "howto": bool(_DL_HOWTO_RX.search(probe)), "info_query": bool(_nav_is_info_query(probe)), "creative": bool(_nav_is_creative(probe))}  # noqa: F821
    return out


# ---------------------------------------------------------------------------
# V50.z508 — RICONOSCIMENTO «come raggiungo una sezione»: il gate del Navigatore (_RX_NAV_EXPLICIT) era troppo stretto:
# «Come aggiungo un contatto?», «Dove vedo le fatture?», «Devo richiamare qualcuno» finivano nel ramo CRM (nessun marker) e Axon
# descriveva il percorso a parole. Ora: domanda simile a una della mappa (banca + correzioni) o «come/dove + verbo di funzione»
# → intent 'navigate' → sezione Navigatore + mappa deep link → risposta 1-2 frasi + marker.
import difflib as _dl_difflib
import re as _dl_re

_DL_WORD_RX = _dl_re.compile(r"[a-zà-ù0-9]+")
_DL_STOP = {"come", "dove", "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "di", "del", "della", "dei", "delle", "a", "al", "alla", "ai", "in", "per",
            "con", "su", "mi", "mio", "mia", "miei", "mie", "che", "si", "fa", "faccio", "posso", "devo", "voglio", "vorrei", "e", "è", "o", "da", "non", "ho", "c", "l"}
_DL_HOWTO_RX = _dl_re.compile(
    r"^\s*(come|dove|in che modo|c'?è un modo per|è possibile|si può|posso|vorrei|voglio|devo)\b.{0,40}?\b(aggiung\w*|cre\w*|cerc\w*|trov\w*|ved\w*|guard\w*|cambi\w*|impost\w*|configur\w*|"
    r"personalizz\w*|import\w*|export\w*|esport\w*|analizz\w*|attiv\w*|disattiv\w*|modific\w*|elimin\w*|cancell\w*|gestisc\w*|scriv\w*|invi\w*|caric\w*|salv\w*|rifacc\w*|"
    r"registr\w*|colleg\w*|programm\w*|controll\w*|consult\w*|stamp\w*|scaric\w*|condivid\w*|segnal\w*|contatt\w*|richiam\w*|chiam\w*|scan\w*|fotograf\w*|"
    r"prenot\w*|fiss\w*|organizz\w*|pianific\w*|monitor\w*|archivi\w*|allegh\w*|allegar\w*|rinnov\w*|firm\w*|insegn\w*|addestr\w*|aggiorn\w*|ripristin\w*)\b", _dl_re.I)
_DL_INDEX: list = []  # [(tokens:set, text:str)]


def _dl_tokens(t: str) -> set:
    return {w for w in _DL_WORD_RX.findall((t or "").lower()) if w not in _DL_STOP and len(w) > 1}


def _dl_build_index() -> None:
    global _DL_INDEX
    idx = []
    for row in _ST_QUESTIONS:  # noqa: F821
        q, exp, flag = row[1], row[2], (row[3] if len(row) > 3 else "")
        if flag not in ("", "conv") or not exp or str(exp[0]).startswith("ACTION:"):
            continue
        idx.append((_dl_tokens(q), q.lower()))
    _DL_INDEX = idx


_dl_build_index()


def _dl_is_mapped_question(msg: str) -> bool:
    t = (msg or "").strip().lower()
    if not t or len(t) > 160:
        return False
    toks = _dl_tokens(t)
    if not toks:
        return False
    for itoks, iq in _DL_INDEX:
        if not itoks:
            continue
        jac = len(toks & itoks) / len(toks | itoks)
        if jac >= 0.6 or (jac >= 0.45 and _dl_difflib.SequenceMatcher(None, t, iq).ratio() >= 0.72):
            return True
    return False


_dl_prev_intent = _nav_intent  # noqa: F821


def _nav_intent(msg: str) -> str:  # noqa: F811
    r = _dl_prev_intent(msg)
    if r == "navigate":
        return r
    try:
        if _nav_is_creative(msg):  # noqa: F821
            return r
        if _dl_is_mapped_question(msg):
            return "navigate"
        if r == "crm" and _DL_HOWTO_RX.search(msg or "") and not _nav_is_info_query(msg):  # noqa: F821
            return "navigate"
    except Exception as e:  # noqa: BLE001
        logger.warning("[deeplink-map] intent override failed: %s", e)  # noqa: F821
    return r
