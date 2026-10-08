"""V50.z474 — Beta sul campo: eventi, NPS, cruscotto Master."""
import os, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")


def _login():
    r = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_beta_flow():
    h = _login()
    assert requests.post(f"{BASE}/beta/event", json={"name": "app_open"}, headers=h, timeout=20).json()["ok"]
    assert requests.post(f"{BASE}/beta/event", json={"name": "boh"}, headers=h, timeout=20).status_code == 400
    assert requests.post(f"{BASE}/admin/beta/nps-wave", json={"wave": 99, "active": True, "ask_price": True}, headers=h, timeout=20).json()["ok"]
    st = requests.get(f"{BASE}/beta/nps/status", headers=h, timeout=20).json()
    assert st["show"] is True and st["wave"] == 99 and st["ask_price"] is True
    assert requests.post(f"{BASE}/beta/nps", json={"wave": 99, "score": 11}, headers=h, timeout=20).status_code == 400
    assert requests.post(f"{BASE}/beta/nps", json={"wave": 99, "score": 8, "would_recommend": True, "price_tier": 29, "best": "pytest-best", "worst": ""}, headers=h, timeout=20).json()["ok"]
    assert requests.get(f"{BASE}/beta/nps/status", headers=h, timeout=20).json()["show"] is False
    d = requests.get(f"{BASE}/admin/beta/dashboard?days=14", headers=h, timeout=60)
    assert d.status_code == 200
    j = d.json()
    assert len(j["metrics"]) == 10 and j["summary"]["verdict"] in ("GO", "ITERA", "RIPENSA", "IN CORSO")
    keys = [m["key"] for m in j["metrics"]]
    assert keys == ["activation", "dau", "axon_success", "voice", "appt_time", "stability", "data", "features", "nps", "wtp"]
    assert all(m["status"] in ("ok", "warn", "ko", "nd") for m in j["metrics"])
    assert j["nps_wave"]["responses"] >= 1
    # pulizia: disattiva l'ondata di test
    assert requests.post(f"{BASE}/admin/beta/nps-wave", json={"wave": 1, "active": False, "ask_price": False}, headers=h, timeout=20).json()["ok"]


def test_beta_program_and_diary():
    h = _login()
    assert requests.post(f"{BASE}/admin/beta/start", json={"start_date": "2026-06-01"}, headers=h, timeout=20).json()["ok"]
    p = requests.get(f"{BASE}/beta/program", headers=h, timeout=20).json()
    assert p["enrolled"] and 1 <= p["week"] <= 6 and len(p["mission"]["tasks"]) == 3
    assert requests.post(f"{BASE}/beta/diary", json={"week": p["week"]}, headers=h, timeout=20).status_code == 400
    assert requests.post(f"{BASE}/beta/diary", json={"week": p["week"], "manual": "pytest-manual"}, headers=h, timeout=20).json()["ok"]
    assert requests.get(f"{BASE}/beta/program", headers=h, timeout=20).json()["diary_done"] is True
    a = requests.get(f"{BASE}/admin/beta/program", headers=h, timeout=30).json()
    assert a["tenant_start"] == "2026-06-01" and len(a["missions"]) == 6 and any(d["manual"] == "pytest-manual" for d in a["diaries"])
    assert requests.delete(f"{BASE}/admin/beta/start", headers=h, timeout=20).json()["ok"]
    assert requests.get(f"{BASE}/beta/program", headers=h, timeout=20).json()["enrolled"] is False
