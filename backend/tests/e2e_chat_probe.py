import json, sys, time, urllib.request

BASE = "http://127.0.0.1:8001"
H = {"X-Smoke-Test-Secret": "dev-smoke-secret-local", "Content-Type": "application/json"}


def ask(q, session_id=None, ctx=None):
    body = {"message": q, "no_cache": True}
    if session_id:
        body["session_id"] = session_id
    if ctx:
        body["client_context"] = ctx
    req = urllib.request.Request(BASE + "/api/assistant/chat/stream", data=json.dumps(body).encode(), headers=H, method="POST")
    t0 = time.time(); first = None; text = []; sid = None
    with urllib.request.urlopen(req, timeout=120) as r:
        ev = None
        for raw in r:
            line = raw.decode("utf-8", "ignore").rstrip("\n")
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:") and ev:
                d = json.loads(line[5:].strip() or "{}")
                if ev == "delta" and d.get("text"):
                    if first is None:
                        first = time.time() - t0
                    text.append(d["text"])
                elif ev == "meta":
                    sid = d.get("session_id")
                elif ev == "done":
                    break
    return "".join(text), first, time.time() - t0, sid


if __name__ == "__main__":
    for q in sys.argv[1:]:
        txt, ttft, tot, sid = ask(q)
        print(f"\n=== {q}\nTTFT={ttft and round(ttft, 2)}s total={round(tot, 2)}s\n{txt}\n")
