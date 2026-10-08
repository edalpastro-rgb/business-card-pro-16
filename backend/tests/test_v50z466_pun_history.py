"""V50.z469 — Feature 5: Storico PUN (GET /pun/history, /pun/history/pdf)."""
import os, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")


def _login():
    r = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_pun_history_json_and_pdf():
    h = _login()
    r = requests.get(f"{BASE}/pun/history?months=18", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["months"] == 18 and d["unit"] == "€/kWh"
    assert len(d["rows"]) in (18, 19)  # 18 chiusi (+ riga mese corrente se disponibile)
    for row in d["rows"]:
        assert {"month_key", "label", "available", "F1", "F2", "F3", "monorario", "kind"} <= set(row)
    r2 = requests.get(f"{BASE}/pun/history/pdf?months=18", headers=h, timeout=60)
    assert r2.status_code == 200, r2.text[:200]
    assert r2.headers["content-type"].startswith("application/pdf")
    assert r2.content[:5] == b"%PDF-" and len(r2.content) > 1500
    assert requests.get(f"{BASE}/pun/history", timeout=20).status_code == 401
