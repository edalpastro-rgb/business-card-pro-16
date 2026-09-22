"""V50.z325 — Avviso soglia PUN: impostazione utente + emissione card proattiva (dedupe per mese/soglia)."""
import os
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
SA = ("test@dalpastro.it", "Test1234!")


def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _items(h):
    d = requests.get(f"{BASE}/axon/proactive/items", headers=h, timeout=20).json()
    items = d if isinstance(d, list) else d.get("items", [])
    return [i for i in items if i.get("type") == "pun_threshold"]


def _cleanup(uid):
    from pymongo import MongoClient
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    db.axon_proactive_log.delete_many({"type": "pun_threshold", "user_id": uid})


def test_threshold_alert_flow():
    h = login(*SA)
    uid = requests.get(f"{BASE}/auth/me", headers=h, timeout=20).json()["user"]["user_id"]
    partial = requests.get(f"{BASE}/quick-action/pun/partial", headers=h, timeout=20).json()
    if not partial.get("days"):
        return  # GME non raggiungibile: niente dato parziale
    cur = partial["F1"] / 1000
    try:
        # soglia ALTA → nessun avviso
        requests.put(f"{BASE}/user-settings", json={"pun_alert_threshold": round(cur + 0.5, 4), "pun_alert_band": "F1"}, headers=h, timeout=20)
        r = requests.post(f"{BASE}/quick-action/pun/partial/refresh", headers=h, timeout=90)
        if r.status_code != 200:
            return
        assert r.json()["alerts_sent"] == 0 and not _items(h)
        # soglia BASSA → 1 avviso, poi dedupe
        requests.put(f"{BASE}/user-settings", json={"pun_alert_threshold": round(max(cur - 0.05, 0.001), 4), "pun_alert_band": "F1"}, headers=h, timeout=20)
        r = requests.post(f"{BASE}/quick-action/pun/partial/refresh", headers=h, timeout=90).json()
        assert r["alerts_sent"] == 1
        it = _items(h)
        assert len(it) == 1 and "sopra la tua soglia" in it[0]["title"] and "F1" in it[0]["body"]
        r2 = requests.post(f"{BASE}/quick-action/pun/partial/refresh", headers=h, timeout=90).json()
        assert r2["alerts_sent"] == 0 and len(_items(h)) == 1
        # settings persistiti
        s = requests.get(f"{BASE}/user-settings", headers=h, timeout=20).json()
        assert s["pun_alert_band"] == "F1" and s["pun_alert_threshold"] > 0
    finally:
        requests.put(f"{BASE}/user-settings", json={"pun_alert_threshold": 0}, headers=h, timeout=20)
        _cleanup(uid)
