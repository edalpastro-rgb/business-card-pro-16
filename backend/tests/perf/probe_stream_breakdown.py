"""probe_stream_breakdown.py — V50.z564 — Manda N domande allo stream locale e stampa la scomposizione TTFT da /api/health.
Uso: cd /app/backend && python tests/perf/probe_stream_breakdown.py
"""
import json
import os
import sys
import time
import urllib.request

BASE = os.environ.get("BASE_URL") or "http://localhost:8001"
QUESTIONS = sys.argv[1:] or ["Che ore sono?", "Dove vedo il PUN?", "Cosa c'è nel listino del CORPORATE CLUB su Drive?", "Come cambio la lingua con cui Axon mi risponde?"]


def req(path, body=None, token=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method="POST" if data else "GET", headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    return urllib.request.urlopen(r, timeout=timeout)


token = json.loads(req("/api/auth/login", {"email": "test@dalpastro.it", "password": "Test1234!"}).read())["token"]
for q in QUESTIONS:
    t0 = time.time(); first = None; ev = ""; n = 0
    with req("/api/assistant/chat/stream", {"message": q, "session_id": f"probe_{int(t0)}", "no_cache": True}, token) as r:
        for raw in r:
            line = raw.decode("utf-8", "ignore").rstrip("\n")
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                if ev == "delta":
                    n += 1
                    if first is None:
                        first = time.time() - t0
                if ev == "done":
                    break
    print(f"«{q}» → TTFT client {first and round(first, 2)}s · {n} delta · totale {round(time.time() - t0, 2)}s")

h = json.loads(req("/api/health").read())
print(json.dumps(h["ttft"], indent=1, ensure_ascii=False))
