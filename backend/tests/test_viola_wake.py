"""V50.z315 — Test ViolaWake backend (python tests/test_viola_wake.py)."""
import os
import requests

BASE = os.environ.get("BASE", "http://localhost:8001/api")


def login(email, pwd):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd}, timeout=30); r.raise_for_status()
    return r.json()["token"]


def main():
    H = {"Authorization": f"Bearer {login('test@dalpastro.it', 'Test1234!')}"}
    H2 = {"Authorization": f"Bearer {login('sub1@dalpastro.it', 'Sub12345!')}"}

    # modulo spento → il collaboratore non può accendere l'ascolto
    requests.put(f"{BASE}/viola-wake/module", headers=H, json={"enabled": False}, timeout=30).raise_for_status()
    st = requests.get(f"{BASE}/viola-wake/settings", headers=H2, timeout=30).json()
    assert st["module"]["enabled"] is False and st["is_master"] is False and st["settings"]["enabled"] is False
    assert requests.put(f"{BASE}/viola-wake/settings", headers=H2, json={"enabled": True}, timeout=30).status_code == 403
    assert requests.put(f"{BASE}/viola-wake/module", headers=H2, json={"enabled": True}, timeout=30).status_code == 403  # solo Master

    # Master attiva il modulo → utente accende, cambia opzioni
    r = requests.put(f"{BASE}/viola-wake/module", headers=H, json={"enabled": True, "note": "test"}, timeout=30).json()
    assert r["module"]["enabled"] is True
    r = requests.put(f"{BASE}/viola-wake/settings", headers=H2, json={"enabled": True, "sensitivity": 0.8, "stt_engine": "device", "listen_seconds": 8}, timeout=30).json()
    assert r["settings"] == {**r["settings"], "enabled": True, "sensitivity": 0.8, "stt_engine": "device", "listen_seconds": 8}
    assert requests.put(f"{BASE}/viola-wake/settings", headers=H2, json={"stt_engine": "cloudx"}, timeout=30).status_code == 400
    assert requests.put(f"{BASE}/viola-wake/settings", headers=H2, json={"sensitivity": 1.5}, timeout=30).status_code == 422

    # routing deterministico
    cases = {
        "Viola, che appuntamenti ho domani?": ("chat", None),
        "Ehi Viola briefing": ("trigger", "briefing"),
        "viola controlla tutto": ("trigger", "scan"),
        "Viola com'è andata la settimana": ("trigger", "weekly_report"),
        "Viola annulla": ("cancel", None),
        "cerca sul web il prezzo del PUN": ("chat", None),
    }
    for text, (mode, action) in cases.items():
        r = requests.post(f"{BASE}/viola-wake/route", headers=H2, json={"transcript": text}, timeout=30).json()
        assert r["mode"] == mode and r.get("action") == action, (text, r)
        if mode == "chat":
            assert not r["prompt"].lower().startswith("viola"), r
    print("routing OK")

    # trigger proattivo con source wake_word + eventi
    r = requests.post(f"{BASE}/axon/proactive/trigger", headers=H2, json={"action": "scan", "source": "wake_word"}, timeout=120)
    assert r.status_code == 200 and r.json()["ok"], r.text
    e = requests.post(f"{BASE}/viola-wake/event", headers=H2, json={"kind": "wake", "platform": "android", "engine": "porcupine"}, timeout=30).json()
    assert e["ok"]
    ev = requests.get(f"{BASE}/viola-wake/events?limit=5", headers=H2, timeout=30).json()
    assert ev["total"] >= 1 and ev["items"][0]["kind"] == "wake"

    # modulo spento dal Master → ascolto spento a tutti
    requests.put(f"{BASE}/viola-wake/module", headers=H, json={"enabled": False}, timeout=30).raise_for_status()
    assert requests.get(f"{BASE}/viola-wake/settings", headers=H2, timeout=30).json()["settings"]["enabled"] is False
    # ripristina modulo attivo per i test UI
    requests.put(f"{BASE}/viola-wake/module", headers=H, json={"enabled": True, "note": "test"}, timeout=30).raise_for_status()
    print("ALL OK")


if __name__ == "__main__":
    main()
