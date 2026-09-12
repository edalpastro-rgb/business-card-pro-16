"""V50.z196 — test e2e Blocco 9 proattività (routes/axon_proactive.py). Uso: python tests/test_axon_proactive.py (~90s)."""
import json, os, sys, time
from datetime import datetime, timedelta, timezone
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30); r.raise_for_status()
    j = r.json(); return j.get("access_token") or j.get("token")


def chat(tok, msg):
    out = {"text": "", "done": None}
    with httpx.stream("POST", f"{BASE}/assistant/chat/stream", json={"message": msg}, headers={"Authorization": f"Bearer {tok}"}, timeout=120) as r:
        ev = None
        for line in r.iter_lines():
            if line.startswith("event:"): ev = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and ev:
                d = json.loads(line.split(":", 1)[1])
                if ev == "delta": out["text"] += d.get("text", "")
                elif ev == "done": out["done"] = d; break
                elif ev == "error": out["text"] += f"[ERROR {d}]"; break
    return out


def check(c, label):
    print(("✅" if c else "❌"), label); return bool(c)


def main():
    tok = login(); h = {"Authorization": f"Bearer {tok}"}; ok = True
    from dotenv import dotenv_values
    from pymongo import MongoClient
    env = dotenv_values(os.path.join(os.path.dirname(__file__), "..", ".env"))
    mdb = MongoClient(env["MONGO_URL"])[env.get("DB_NAME", "test_database")]
    me = httpx.get(f"{BASE}/auth/me", headers=h, timeout=30).json()["user"]

    # 1) config default + PUT
    cfg = httpx.get(f"{BASE}/axon/proactive/config", headers=h, timeout=30).json()
    ok &= check(cfg["briefing_time"] == "07:30" and cfg["max_suggestions_per_day"] == 3 and cfg["is_master"], f"config default: briefing {cfg['briefing_time']}, max sugg {cfg['max_suggestions_per_day']}, inattivi {cfg['inactive_days']}gg")
    cfg = httpx.put(f"{BASE}/axon/proactive/config", headers=h, timeout=30, json={"briefing_time": "7:45", "inactive_days": 21, "alerts": {"goal_progress": False}, "weekly_targets": {"calls": 30}, "team_max_suggestions_per_day": 2}).json()
    ok &= check(cfg["briefing_time"] == "07:45" and cfg["inactive_days"] == 21 and cfg["alerts"]["goal_progress"] is False and cfg["alerts"]["inactive"] is True and cfg["weekly_targets"]["calls"] == 30 and cfg["weekly_targets"]["appointments"] == 5, "PUT config (merge parziale di alerts/targets, orario normalizzato)")
    httpx.put(f"{BASE}/axon/proactive/config", headers=h, timeout=30, json={"briefing_time": "07:30", "inactive_days": 30, "alerts": {"goal_progress": True}, "weekly_targets": {"calls": 20}, "team_max_suggestions_per_day": 3})

    # 2) Preferenze: nuove voci attiva/disattiva per tipo
    prefs = httpx.get(f"{BASE}/axon-notifications/prefs", headers=h, timeout=30).json()
    ok &= check(all(k in prefs["kinds_labels"] for k in ("proactive_briefing", "proactive_suggestion", "proactive_alert", "proactive_weekly")), "AXN_KINDS estesi (toggle in Preferenze AxonOS)")

    # 3) Trigger unico: briefing (source manual / voce)
    t = httpx.post(f"{BASE}/axon/proactive/trigger", headers=h, timeout=60, json={"action": "briefing", "source": "voice"}).json()
    it = t["item"]
    ok &= check(it and it["kind"] == "briefing" and "Briefing di" in t["reply"] and "Obiettivi settimanali" in t["reply"] and it["source"] == "voice", f"trigger briefing (voice) → {it and it['title']}")
    ok &= check(it["deeplink"].startswith("/axon-proactive?item="), f"deeplink {it['deeplink']}")
    hist = httpx.get(f"{BASE}/assistant/history", headers=h, timeout=30).json()
    ok &= check(any((m.get("content") or "").startswith("☀️ **Briefing") for m in hist.get("messages", [])), "briefing già caricato in chat")
    n = mdb.axon_notifications.find_one({"user_id": me["user_id"], "kind": "proactive_briefing"}, sort=[("created_at", -1)])
    ok &= check(n and n.get("push_status") in ("sent", "not_configured", "queued"), f"push via bridge: kind={n and n['kind']} push_status={n and n.get('push_status')}")

    # 4) Report settimanale
    t = httpx.post(f"{BASE}/axon/proactive/trigger", headers=h, timeout=60, json={"action": "weekly_report", "source": "manual"}).json()
    ok &= check(t["item"]["kind"] == "weekly" and "Report settimana" in t["reply"] and "Telefonate" in t["reply"] and "Obiettivi raggiunti" in t["reply"], "trigger report settimanale")

    # 5) Scan suggerimenti/alert (dipende dai dati: accetta 0..n) + anomalia dati importati sintetica
    mdb.axon_imported_data.delete_many({"tenant_id": me["user_id"], "categoria": "TestAnomalia"})
    now = datetime.now(timezone.utc)
    for i, v in enumerate([100, 101, 99, 100, 150]):
        mdb.axon_imported_data.insert_one({"item_id": f"aid_t{i}", "tenant_id": me["user_id"], "user_id": me["user_id"], "categoria": "TestAnomalia", "etichetta": "Indice X", "valore": v, "unita": "€/MWh", "data": f"2026-0{i+1}", "fonte": "test", "created_at": now, "updated_at": now})
    mdb.axon_proactive_log.delete_many({"user_id": me["user_id"], "type": "imported_anomaly"})
    t = httpx.post(f"{BASE}/axon/proactive/trigger", headers=h, timeout=90, json={"action": "scan", "source": "manual"}).json()
    an = mdb.axon_proactive_log.find_one({"user_id": me["user_id"], "type": "imported_anomaly"})
    ok &= check(an and "50%" in an["title"], f"scan → anomalia dati importati rilevata: {an and an['title']}")
    items = httpx.get(f"{BASE}/axon/proactive/items", headers=h, timeout=30, params={"limit": 50}).json()["items"]
    types = sorted({i["type"] for i in items})
    ok &= check(len(items) >= 3, f"log proattivo: {len(items)} voci · tipi {types}")
    home = httpx.get(f"{BASE}/axon/proactive/items", headers=h, timeout=30, params={"home": "true"}).json()["items"]
    ok &= check(len(home) >= 1, f"bubble home: {len(home)}")
    a = httpx.post(f"{BASE}/axon/proactive/items/{home[0]['item_id']}/dismiss", headers=h, timeout=30).json()
    home2 = httpx.get(f"{BASE}/axon/proactive/items", headers=h, timeout=30, params={"home": "true"}).json()["items"]
    ok &= check(a["updated"] == 1 and len(home2) == len(home) - 1, "dismiss bubble")
    mdb.axon_imported_data.delete_many({"tenant_id": me["user_id"], "categoria": "TestAnomalia"})

    # 6) Comandi chat
    c = chat(tok, "briefing di oggi")
    ok &= check((c["done"] or {}).get("slash") == "proactive_briefing" and "Briefing" in c["text"], "chat «briefing di oggi»")
    c = chat(tok, "report della settimana")
    ok &= check((c["done"] or {}).get("slash") == "proactive_weekly", "chat «report della settimana»")

    # 7) Promemoria impostato da AxonOS in chat → harvest (tick 60s) → firing quando scaduto
    due = (datetime.now(timezone.utc) + timedelta(minutes=1)).astimezone()
    due_it = due.strftime("%d/%m/%Y %H:%M")
    mdb.assistant_messages.insert_one({"message_id": f"m_apx_{int(time.time())}", "user_id": me["user_id"], "session_id": "asst_test", "role": "assistant",
                                       "content": f"Perfetto, ci penso io.\n\n📌 Promemoria proattivo: {due_it} — Richiamare Studio Rossi per il rinnovo", "created_at": datetime.now(timezone.utc)})
    print("⏳ attendo harvest + firing (≤ 150 s) …")
    fired = None
    for _ in range(32):
        time.sleep(5)
        fired = mdb.axon_proactive_reminders.find_one({"user_id": me["user_id"], "text": {"$regex": "Studio Rossi"}, "status": "sent"})
        if fired: break
    ok &= check(fired is not None, f"promemoria AxonOS → harvest → notifica alla scadenza (status={fired and fired['status']})")
    rem = mdb.axon_proactive_log.find_one({"user_id": me["user_id"], "type": "custom_reminder"}, sort=[("created_at", -1)])
    ok &= check(rem and "Studio Rossi" in rem["title"], f"log alert custom_reminder: {rem and rem['title']}")

    # 8) Reminders API
    r = httpx.post(f"{BASE}/axon/proactive/reminders", headers=h, timeout=30, json={"text": "Test API", "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}).json()
    d = httpx.delete(f"{BASE}/axon/proactive/reminders/{r['reminder']['reminder_id']}", headers=h, timeout=30).json()
    ok &= check(r["ok"] and d["deleted"] == 1, "reminders API add/delete")

    print("\nRISULTATO:", "TUTTO OK ✅" if ok else "FALLITO ❌")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
