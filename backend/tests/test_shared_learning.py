"""V50.z447 — apprendimento comportamentale cross-tenant. Esegui: python tests/test_shared_learning.py"""
import os, sys, time, json
import httpx

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def main():
    c = httpx.Client(timeout=180)
    tok = c.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    sid = f"asst_test_asl_{int(time.time())}"
    # 1) domanda + risposta (non-stream) nella stessa sessione
    r1 = c.post(f"{BASE}/assistant/chat", json={"message": "Dammi il numero di telefono di Mario Rossi, via Roma 12, 0424 123456, mario.rossi@example.com", "session_id": sid, "no_cache": True}, headers=h).json()
    sid = r1.get("session_id") or sid
    # 2) correzione dell'utente
    r2 = c.post(f"{BASE}/assistant/chat", json={"message": "No, troppo lungo: quando chiedo un numero di telefono rispondi solo con il numero, niente premesse.", "session_id": sid, "no_cache": True}, headers=h).json()
    time.sleep(2)
    # 3) la correzione deve essere registrata e anonimizzata
    corr = c.get(f"{BASE}/axon/shared-learning/corrections?limit=5", headers=h)
    if corr.status_code == 403:
        print("FAIL: l'utente di test non è Super Master (serve super_admin=true o email in SUPER_MASTER_EMAILS)"); sys.exit(1)
    rows = corr.json()["corrections"]
    mine = [x for x in rows if "numero di telefono" in (x.get("user_correction") or "").lower()]
    print("correzioni registrate:", len(rows), "| mia:", bool(mine))
    if not mine:
        print("FAIL: correzione non registrata"); sys.exit(1)
    m = mine[0]
    pii_leak = any(tok in json.dumps(m, ensure_ascii=False) for tok in ("Mario Rossi", "0424 123456", "mario.rossi@example.com", "via Roma 12"))
    print("anonimizzata (nessuna PII):", not pii_leak, "| tenant_id esposto:", "tenant_id" in m)
    print("  question:", m["user_question"][:120])
    # 4) estrazione pattern
    run = c.post(f"{BASE}/axon/shared-learning/run", headers=h).json()
    print("job:", run)
    lst = c.get(f"{BASE}/axon/shared-learning", headers=h).json()
    beh = [b for b in lst["behaviors"] if b.get("status") in ("active", "candidate")]
    print("behaviors:", lst["stats"], "| prompt chars:", lst["prompt_section_chars"])
    for b in beh[:5]:
        print(f"  [{b['status']}] ({b['category']}, conf {b['confidence']}, tenants {b['tenants']}) {b['rule']}")
    ok = (not pii_leak) and ("tenant_id" not in m) and run.get("learned", 0) >= 1 and lst["prompt_section_chars"] > 0
    print("\nRESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
