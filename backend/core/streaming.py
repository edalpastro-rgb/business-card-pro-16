"""core/streaming.py — V50.z562 — TELEMETRIA DELLO STREAMING (TTFT) + contratto SSE.

`record(ttft_s, prep_s, deltas, …)` viene chiamato dall'endpoint stream alla fine di ogni risposta; `stats(window_min)`
restituisce p50/p95 degli ultimi N minuti e le anomalie (soglia 2 s) per /axon/system/status e per la Home.
"""
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List

TTFT_ALERT_S = 2.0
_samples: Deque[Dict[str, Any]] = deque(maxlen=2000)
_lock = threading.Lock()


def sse(event: str, data_json: str) -> str:
    """Formato SSE canonico (contratto): `event: <nome>\\ndata: <json>\\n\\n`."""
    return f"event: {event}\ndata: {data_json}\n\n"


def record(ttft_s: float, prep_s: float = 0.0, deltas: int = 0, total_s: float = 0.0, query_class: str = "", from_cache: bool = False) -> None:
    with _lock:
        _samples.append({"t": time.time(), "ttft": float(ttft_s), "prep": float(prep_s), "deltas": int(deltas), "total": float(total_s),
                         "class": query_class or "", "cache": bool(from_cache)})


def _pct(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    vs = sorted(values)
    idx = min(len(vs) - 1, max(0, int(round((p / 100.0) * (len(vs) - 1)))))
    return round(vs[idx], 3)


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
    return {"window_min": window_min, "n": len(rows), "p50": _pct(ttfts, 50), "p95": p95, "max": round(max(ttfts), 3) if ttfts else 0.0,
            "slow": len(slow), "threshold_s": TTFT_ALERT_S, "anomalies": anomalies, "ok": not anomalies}
