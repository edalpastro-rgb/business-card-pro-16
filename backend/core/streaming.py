"""core/streaming.py — V50.z564 — TELEMETRIA DELLO STREAMING (TTFT scomposto) + contratto SSE.

`record(ttft_s, prep_s, deltas, …, llm_first_s, phases)` viene chiamato dall'endpoint stream alla fine di ogni risposta; `stats(window_min)`
restituisce p50/p95 degli ultimi N minuti, le anomalie (soglia 2 s) e la SCOMPOSIZIONE ANALITICA prep (recupero contesto, per fase)
vs gateway LLM (attesa primo token), complessiva e per classe di query, per /api/health, /axon/system/status e la Home.
"""
import contextvars
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

TTFT_ALERT_S = 2.0
_samples: Deque[Dict[str, Any]] = deque(maxlen=2000)
_lock = threading.Lock()

# V50.z564 — raccoglitore delle fasi del preflight della richiesta corrente (dict condiviso con i task figli di asyncio.gather:
# il ContextVar viene copiato nei task ma il dict è lo stesso oggetto, quindi i fetcher annidati — teach.drive, teach.gme… — scrivono qui).
_PHASES: contextvars.ContextVar[Optional[Dict[str, float]]] = contextvars.ContextVar("axon_prep_phases", default=None)


def begin_phases() -> Dict[str, float]:
    """Apre il raccoglitore per la richiesta corrente e lo restituisce (da chiamare all'inizio del preflight)."""
    d: Dict[str, float] = {}
    _PHASES.set(d)
    return d


def mark_phase(name: str, seconds: float) -> None:
    """Registra la durata di una fase (no-op fuori da una richiesta stream)."""
    d = _PHASES.get()
    if d is not None:
        d[name] = round(max(d.get(name, 0.0), float(seconds)), 3)


def sse(event: str, data_json: str) -> str:
    """Formato SSE canonico (contratto): `event: <nome>\\ndata: <json>\\n\\n`."""
    return f"event: {event}\ndata: {data_json}\n\n"


def record(ttft_s: float, prep_s: float = 0.0, deltas: int = 0, total_s: float = 0.0, query_class: str = "", from_cache: bool = False,
           llm_first_s: Optional[float] = None, phases: Optional[Dict[str, float]] = None) -> None:
    """V50.z564 — `prep_s` = preflight COMPLETO (prompt base + wrapper), `llm_first_s` = attesa del primo token dal gateway LLM
    (dall'invio della richiesta al primo delta), `phases` = fasi del preflight in secondi (context, teach.drive, teach.gme, tavily, …).
    Il tempo residuo (cache semantica, insert Mongo) è `ttft - prep - llm_first`."""
    if llm_first_s is None:
        llm_first_s = max(0.0, float(ttft_s) - float(prep_s))
    with _lock:
        _samples.append({"t": time.time(), "ttft": float(ttft_s), "prep": float(prep_s), "llm": float(llm_first_s), "deltas": int(deltas), "total": float(total_s),
                         "class": query_class or "", "cache": bool(from_cache), "phases": {k: round(float(v), 3) for k, v in (phases or {}).items() if v is not None}})


def _pct(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    vs = sorted(values)
    idx = min(len(vs) - 1, max(0, int(round((p / 100.0) * (len(vs) - 1)))))
    return round(vs[idx], 3)


def _breakdown(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Scomposizione analitica di un insieme di risposte: dove va il tempo prima del primo token."""
    ttfts = [r["ttft"] for r in rows]
    preps = [r["prep"] for r in rows]
    llms = [r["llm"] for r in rows]
    others = [max(0.0, r["ttft"] - r["prep"] - r["llm"]) for r in rows]
    agg: Dict[str, List[float]] = {}
    for r in rows:
        for k, v in (r.get("phases") or {}).items():
            agg.setdefault(k, []).append(v)
    phases = {k: {"n": len(v), "avg": round(sum(v) / len(v), 3), "max": round(max(v), 3)} for k, v in agg.items()}
    top = sorted(phases.items(), key=lambda kv: -kv[1]["avg"])[:6]
    p95_prep, p95_llm, p95_other = _pct(preps, 95), _pct(llms, 95), _pct(others, 95)
    bottleneck = ""
    if rows and _pct(ttfts, 95) > TTFT_ALERT_S:
        worst = max((("prep", p95_prep), ("llm", p95_llm), ("other", p95_other)), key=lambda kv: kv[1])[0]
        if worst == "prep":
            bottleneck = "prep (recupero contesto)" + (f" → fase dominante: {top[0][0]} avg {top[0][1]['avg']}s" if top else "")
        elif worst == "llm":
            bottleneck = "gateway LLM (attesa primo token)"
        else:
            bottleneck = "altro (cache semantica / Mongo tra preflight e LLM)"
    return {"n": len(rows), "ttft": {"p50": _pct(ttfts, 50), "p95": _pct(ttfts, 95)},
            "prep": {"p50": _pct(preps, 50), "p95": p95_prep}, "llm_first": {"p50": _pct(llms, 50), "p95": p95_llm}, "other": {"p50": _pct(others, 50), "p95": p95_other},
            "phases": dict(top), "bottleneck": bottleneck}


def stats(window_min: int = 60) -> Dict[str, Any]:
    cutoff = time.time() - window_min * 60
    with _lock:
        rows = [s for s in _samples if s["t"] >= cutoff and not s["cache"]]
    ttfts = [r["ttft"] for r in rows]
    slow = [r for r in rows if r["ttft"] > TTFT_ALERT_S]
    burst = [r for r in rows if r["deltas"] <= 2 and r["total"] > 1.5 and r["total"] - r["ttft"] < 0.05]  # lunga attesa, poi tutto in un colpo
    p95 = _pct(ttfts, 95)
    anomalies: List[str] = []
    if rows and p95 > TTFT_ALERT_S:
        anomalies.append(f"TTFT p95 {p95:.1f}s > {TTFT_ALERT_S:.0f}s negli ultimi {window_min} min ({len(slow)}/{len(rows)} risposte lente)")
    if rows and len(burst) > max(2, len(rows) // 3):
        anomalies.append(f"Streaming non fluido: {len(burst)}/{len(rows)} risposte arrivate in blocco")
    overall = _breakdown(rows)
    by_class = {c: _breakdown([r for r in rows if r["class"] == c]) for c in sorted({r["class"] or "n/d" for r in rows})} if rows else {}
    if overall["bottleneck"]:
        anomalies.append(f"Collo di bottiglia: {overall['bottleneck']} (prep p95 {overall['prep']['p95']}s · LLM p95 {overall['llm_first']['p95']}s)")
    return {"window_min": window_min, "n": len(rows), "p50": _pct(ttfts, 50), "p95": p95, "max": round(max(ttfts), 3) if ttfts else 0.0,
            "slow": len(slow), "threshold_s": TTFT_ALERT_S, "anomalies": anomalies, "ok": not anomalies,
            "breakdown": {k: overall[k] for k in ("prep", "llm_first", "other", "phases", "bottleneck")}, "by_class": by_class}
