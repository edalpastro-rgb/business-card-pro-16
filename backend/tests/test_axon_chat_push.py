"""V50.z184 — test e2e comandi push in chat + consegna server-side promemoria.
Uso: python tests/test_axon_chat_push.py  (backend su localhost:8001)"""
import json, os, sys, time
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"] if "access_token" in r.json() else r.json()["token"]


def chat(tok, msg):
    out = {"text": "", "done": None}
    with httpx.stream("POST", f"{BASE}/assistant/chat/stream", json={"message": msg}, headers={"Authorization": f"Bearer {tok}"}, timeout=90) as r:
        ev = None
        for line in r.iter_lines():
            if line.startswith("event:"):
                ev = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and ev:
                d = json.loads(line.split(":", 1)[1])
                if ev == "delta":
                    out["text"] += d.get("text", "")
                elif ev == "done":
                    out["done"] = d
                    break
                elif ev == "error":
                    out["text"] += f"[ERROR {d}]"
                    break
    return out


def main():
    tok = login()
    h = {"Authorization": f"Bearer {tok}"}
    ok = True

    r = chat(tok, "mandami una notifica di prova")
    print("TEST  →", r["text"][:120].replace("\n", " "), "| cmd:", (r["done"] or {}).get("slash"))
    ok &= (r["done"] or {}).get("slash") == "push_test"

    r = chat(tok, "mandami una notifica: ricordati il caffè con Rossi")
    print("SEND  →", r["text"][:120].replace("\n", " "), "| cmd:", (r["done"] or {}).get("slash"))
    ok &= (r["done"] or {}).get("slash") == "push_send"

    r = chat(tok, "avvisami se ho ritelefonate urgenti")
    print("WATCH →", r["text"][:140].replace("\n", " "), "| cmd:", (r["done"] or {}).get("slash"))
    ok &= (r["done"] or {}).get("slash") == "push_watch"

    r = chat(tok, "quali notifiche push ho attive?")
    print("STATUS→", r["text"][:120].replace("\n", " "), "| cmd:", (r["done"] or {}).get("slash"))
    ok &= (r["done"] or {}).get("slash") == "push_status"

    # promemoria fra ~65s via chat → deve arrivare come notifica AxonOS kind=reminder
    r = chat(tok, "ricordami tra 2 minuti di chiamare il test push")
    print("REMIND→", r["text"][:120].replace("\n", " "), "| cmd:", (r["done"] or {}).get("slash"))
    alarm = (r["done"] or {}).get("alarm")
    ok &= (r["done"] or {}).get("slash") == "alarm_create" and bool(alarm)
    if alarm:
        # timer REST 5s → arming esatto
        t = httpx.post(f"{BASE}/axon/alarms", json={"kind": "timer", "label": "Timer test push", "duration_seconds": 5}, headers=h, timeout=30).json()
        print("TIMER REST creato:", t.get("id"), t.get("trigger_at"))
        time.sleep(12)
        lst = httpx.get(f"{BASE}/axon-notifications?limit=10", headers=h, timeout=30).json()
        kinds = [(n["kind"], n["title"]) for n in lst["items"]]
        print("NOTIFS:", kinds[:6])
        ok &= any(k == "reminder" and "Timer" in ti for k, ti in kinds)
        al = httpx.get(f"{BASE}/axon/alarms", headers=h, timeout=30).json()
        tdoc = next((a for a in al["items"] if a["id"] == t["id"]), None)
        print("timer push_sent_at:", (tdoc or {}).get("push_sent_at"))
        ok &= bool((tdoc or {}).get("push_sent_at"))
        print("attendo il promemoria (≤75s)…")
        deadline = time.time() + 140
        got = False
        while time.time() < deadline and not got:
            time.sleep(5)
            lst = httpx.get(f"{BASE}/axon-notifications?limit=10", headers=h, timeout=30).json()
            got = any(n["kind"] == "reminder" and "Promemoria" in n["title"] for n in lst["items"])
        print("PROMEMORIA consegnato:", got)
        ok &= got
        # nessun doppione
        lst = httpx.get(f"{BASE}/axon-notifications?limit=50", headers=h, timeout=30).json()
        dk = [n.get("dedupe_key") for n in lst["items"] if n["kind"] == "reminder"]
        print("doppioni:", len(dk) - len(set(dk)))
        ok &= len(dk) == len(set(dk))
        # pulizia
        for a in al["items"]:
            if a.get("label") in ("Timer test push",) or "test push" in (a.get("label") or ""):
                httpx.delete(f"{BASE}/axon/alarms/{a['id']}", headers=h, timeout=30)

    print("\nRESULT:", "OK ✅" if ok else "FAIL ❌")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
