"""V50.z440 — persona «personal» (Super Master) vs «crm». Esegui: python tests/test_axon_persona.py"""
import os, sys, time, json
import httpx

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"
Q = "Cercami il numero di telefono della Farmacia Comunale di Bassano del Grappa"


def ask(c, h, msg):
    t0 = time.time()
    r = c.post(f"{BASE}/assistant/chat", json={"message": msg, "no_cache": True}, headers=h)
    r.raise_for_status()
    b = r.json()
    return (b.get("reply") or ""), b.get("used_web_search"), time.time() - t0


def main():
    with httpx.Client(timeout=180) as c:
        r = c.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}); r.raise_for_status()
        h = {"Authorization": f"Bearer {r.json()['token']}"}
        ok = True
        for persona in ("personal", "crm"):
            r = c.put(f"{BASE}/axon/core/persona", json={"persona": persona}, headers=h); r.raise_for_status()
            g = c.get(f"{BASE}/axon/core/persona", headers=h).json()
            print(f"\n=== persona={g['persona']} (explicit={g['explicit']}) ===")
            reply, web, dt = ask(c, h, Q)
            print(f"web={web} {dt:.1f}s\n{reply[:700]}")
            low = reply.lower()
            refused = "non è il mio campo" in low or "non e' il mio campo" in low
            if persona == "personal" and (refused or not web):
                print("FAIL: personal persona refused or no web search"); ok = False
            if persona == "crm" and not refused:
                print("WARN: crm persona did not refuse (acceptable if it redirected)")
        # ripristina default (nessuna persona esplicita) per il tenant di test
        c.put(f"{BASE}/axon/core/persona", json={"persona": "crm"}, headers=h)
        print("\nRESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
