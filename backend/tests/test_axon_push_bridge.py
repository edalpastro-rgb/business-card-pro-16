"""V50.z193 — test e2e bridge push AxonOS (routes/axon_push_bridge.py).
Uso: python tests/test_axon_push_bridge.py  (backend su localhost:8001). Dura ~2.5 min (test programmato a 2 minuti)."""
import json, os, sys, time
from datetime import datetime, timezone
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"
TEST_MINUTES = int(os.environ.get("TEST_MINUTES", "2"))


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j.get("token")


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


def check(cond, label):
    print(("✅" if cond else "❌"), label)
    return bool(cond)


def main():
    tok = login()
    h = {"Authorization": f"Bearer {tok}"}
    ok = True
    from dotenv import dotenv_values
    from pymongo import MongoClient
    env = dotenv_values(os.path.join(os.path.dirname(__file__), "..", ".env"))
    mdb = MongoClient(env["MONGO_URL"])[env.get("DB_NAME", "test_database")]
    me = httpx.get(f"{BASE}/auth/me", headers=h, timeout=30).json()["user"]

    # 1) Stato iniziale
    st = httpx.get(f"{BASE}/axon/push/status", headers=h, timeout=30).json()
    ok &= check("summary" in st and st["level"] in ("ok", "warn", "off"), f"status → level={st['level']} · {st['summary'][:80]}")

    # 2) Report dispositivo: Android senza Firebase (caso reale attuale)
    r = httpx.post(f"{BASE}/axon/push/device", headers=h, timeout=30, json={
        "platform": "android", "registered": False, "permission": "granted", "can_ask_again": True,
        "error": "Default FirebaseApp is not initialized in this process", "app_env": "standalone", "app_version": "2.0.0"}).json()
    ok &= check(r["level"] == "off" and "Firebase" in r["summary"], f"device(no Firebase) → {r['summary'][:90]}")
    ok &= check(r["devices"][0].get("last_failed_at"), "push_devices.last_failed_at impostato")

    # 3) Report dispositivo: permesso negato → summary semplice
    r = httpx.post(f"{BASE}/axon/push/device", headers=h, timeout=30, json={
        "platform": "android", "registered": False, "permission": "denied", "can_ask_again": False, "app_env": "standalone"}).json()
    ok &= check(r["level"] == "off" and "negato" in r["summary"], f"device(denied) → {r['summary'][:90]}")

    # 4) Nudge in chat (1a volta ok, 2a volta skipped) — azzera il throttle di run precedenti
    mdb.push_devices.update_many({"user_id": me["user_id"]}, {"$unset": {"last_nudge_at": ""}})
    n1 = httpx.post(f"{BASE}/axon/push/nudge", headers=h, timeout=30).json()
    n2 = httpx.post(f"{BASE}/axon/push/nudge", headers=h, timeout=30).json()
    ok &= check(n1.get("skipped") is False and n2.get("skipped") is True, "nudge: 1° inserito in chat, 2° saltato (7 giorni)")
    hist = httpx.get(f"{BASE}/assistant/history", headers=h, timeout=30).json()
    ok &= check(any("disattivate" in (m.get("content") or "") for m in hist.get("messages", [])), "nudge visibile nella cronologia chat (ultima sessione)")

    # 5) Report dispositivo registrato
    r = httpx.post(f"{BASE}/axon/push/device", headers=h, timeout=30, json={
        "platform": "android", "registered": True, "permission": "granted", "can_ask_again": True, "token_hint": "abc123", "app_env": "standalone"}).json()
    ok &= check(r["devices"][0]["registered"] and r["devices"][0].get("registered_at"), f"device(registered) → level={r['level']} · {r['summary'][:80]}")

    # 6) Comando chat diagnostica (linguaggio semplice, nessun termine tecnico)
    c = chat(tok, "il mio telefono riceve le notifiche?")
    ok &= check((c["done"] or {}).get("slash") == "push_diag" and c["text"].startswith("📲"), f"chat diag → {c['text'][:100]!r}")
    ok &= check(not any(w in c["text"].lower() for w in ("token", "http", "endpoint", "fcm")), "chat diag senza termini tecnici")
    c2 = chat(tok, "mandami una notifica: arrivo domani")
    ok &= check((c2["done"] or {}).get("slash") == "push_send", "«mandami una notifica: arrivo domani» → resta comando invio (no falso positivo diag)")

    # 7) Wrapper send_push → log + push_status sulla notifica
    t = httpx.post(f"{BASE}/axon-notifications/test", headers=h, timeout=30).json()
    log = httpx.get(f"{BASE}/axon/push/log", headers=h, timeout=30).json()["items"]
    ok &= check(log and log[0]["status"] in ("sent", "not_configured") and log[0]["notif_id"] == t["notification"]["notif_id"], f"axon_push_log → {log[0]['status']} (attempt {log[0]['attempt']})")

    # 7b) Outbox: item in retry inserito direttamente (simula provider 5xx al 1° tentativo) → il tick lo riprende entro 60s
    try:
        item_id = "apo_test_" + str(int(time.time()))
        mdb.axon_push_outbox.insert_one({"item_id": item_id, "recipients": [me["user_id"]], "data": {"title": "Outbox test", "message": "retry", "kind": "axon_message"},
                                         "idempotency_key": None, "status": "pending", "attempts": 1, "next_at": datetime.now(timezone.utc), "last_error": "HTTP 503", "created_at": datetime.now(timezone.utc)})
        print("⏳ attendo il tick outbox (≤ 65s) …")
        final = None
        for _ in range(14):
            time.sleep(5)
            it = mdb.axon_push_outbox.find_one({"item_id": item_id})
            if it and it["status"] not in ("pending", "sending"):
                final = it; break
        ok &= check(final and final["attempts"] == 2 and final["status"] in ("sent", "not_configured"), f"outbox ripreso dal tick → status={final and final['status']} attempts={final and final['attempts']}")
        ok &= check(mdb.axon_push_log.find_one({"source": "outbox", "attempt": 2, "title": "Outbox test"}), "axon_push_log registra il tentativo outbox")
    except Exception as exc:  # noqa: BLE001
        ok &= check(False, f"outbox test non eseguibile: {exc}")

    # 8) Test programmato a N minuti — via chat, poi attesa
    c3 = chat(tok, f"programma un test push tra {TEST_MINUTES} minuti")
    ok &= check((c3["done"] or {}).get("slash") == "push_test_scheduled", f"chat → {c3['text'][:90]!r}")
    st = httpx.get(f"{BASE}/axon/push/status", headers=h, timeout=30).json()
    lt = st["last_test"]
    ok &= check(lt and lt["status"] == "scheduled" and lt["minutes"] == TEST_MINUTES, f"test programmato: {st['last_test_label']}")
    sched = datetime.fromisoformat(lt["scheduled_at"])
    print(f"⏳ attendo lo sparo del server alle {sched.astimezone().strftime('%H:%M:%S')} …")
    fired = None
    deadline = time.time() + TEST_MINUTES * 60 + 45
    while time.time() < deadline:
        time.sleep(5)
        st = httpx.get(f"{BASE}/axon/push/status", headers=h, timeout=30).json()
        if st["last_test"]["status"] != "scheduled":
            fired = st["last_test"]; break
    ok &= check(fired is not None, f"test sparato dal server: {st['last_test_label']}")
    if fired:
        delta = (datetime.fromisoformat(fired["fired_at"]) - sched).total_seconds()
        ok &= check(-2 <= delta <= 20, f"puntualità: {delta:+.1f}s rispetto all'orario programmato")
        ok &= check(fired["status"] in ("sent", "not_configured", "queued"), f"esito provider: {fired['status']} (in dev = not_configured atteso)")
        lst = httpx.get(f"{BASE}/axon-notifications", headers=h, timeout=30).json()["items"]
        ok &= check(any((x.get("data") or {}).get("test_id") == fired["test_id"] for x in lst), "notifica in-app del test creata")
        # 9) ack dal telefono
        a = httpx.post(f"{BASE}/axon/push/tests/{fired['test_id']}/ack", headers=h, timeout=30).json()
        st = httpx.get(f"{BASE}/axon/push/status", headers=h, timeout=30).json()
        ok &= check(a["updated"] == 1 and st["last_test"]["status"] == "delivered" and "Ricevuto" in st["last_test_label"], f"ack → {st['last_test_label']}")
        ok &= check(st["level"] == "ok" and ("consegnata" in st["summary"] or "ricevuta" in st["summary"]), f"summary dopo ack → {st['summary'][:90]}")

    print("\nRISULTATO:", "TUTTO OK ✅" if ok else "FALLITO ❌")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
