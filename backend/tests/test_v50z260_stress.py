"""V50.z260 — Stress test AxonOS: API run/report/correzioni (owner)."""
import os
import time
import requests

BASE = os.environ.get("BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"


def _tok(email="test@dalpastro.it", pwd="Test1234!"):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    r.raise_for_status()
    d = r.json()
    return d.get("token") or d.get("access_token")


H = {"Authorization": f"Bearer {_tok()}"}


def test_questions_catalog():
    r = requests.get(f"{BASE}/axon/stress/questions", headers=H, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 200
    cats = d["categories"]
    for c in ["contatti", "vaghe", "informali", "typo", "trap", "flussi", "ripetizioni", "config", "problemi"]:
        assert c in cats, c
    assert requests.get(f"{BASE}/axon/stress/questions", timeout=30).status_code == 401


def test_run_stop_report_and_correction():
    # run piccolo: 3 domande deterministiche × 2 ripetizioni
    r = requests.post(f"{BASE}/axon/stress/run", json={"reps": 2, "limit": 3, "categories": ["flussi"]}, headers=H, timeout=30)
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    assert r.json()["total"] == 6
    # doppio avvio → 409 finché è in corso (oppure già finito: allora salta)
    r2 = requests.post(f"{BASE}/axon/stress/run", json={"reps": 1, "limit": 1}, headers=H, timeout=30)
    assert r2.status_code in (409, 200)
    if r2.status_code == 200:
        requests.post(f"{BASE}/axon/stress/runs/{r2.json()['run_id']}/stop", headers=H, timeout=30)
    # attesa completamento
    for _ in range(60):
        d = requests.get(f"{BASE}/axon/stress/runs/{run_id}", headers=H, timeout=30).json()
        if d["status"] in ("done", "stopped", "error"):
            break
        time.sleep(3)
    assert d["status"] == "done", d.get("error")
    s = d["summary"]
    assert s["tested"] == 3 and s["passed"] + s["failed"] + s["inconsistent"] == 3
    assert abs(s["pct_passed"] + s["pct_failed"] + s["pct_inconsistent"] - 100) < 0.5
    for it in d["items"]:
        assert len(it["reps"]) == 2
        assert it["outcome"] in ("passed", "failed", "inconsistent")
        for rep in it["reps"]:
            assert "reply" in rep and isinstance(rep["ok"], bool)
    # filtro per esito
    d_f = requests.get(f"{BASE}/axon/stress/runs/{run_id}?outcome=passed", headers=H, timeout=30).json()
    assert all(it["outcome"] == "passed" for it in d_f["items"])
    # lista run
    runs = requests.get(f"{BASE}/axon/stress/runs", headers=H, timeout=30).json()["runs"]
    assert any(x["run_id"] == run_id for x in runs)
    # HTML per PDF
    h = requests.get(f"{BASE}/axon/stress/runs/{run_id}/report-html", headers=H, timeout=30).json()["html"]
    assert "<table" in h and "Report Stress Test AxonOS" in h and d["items"][0]["question"] in h
    # correzione: applicabile anche su un item (usa il suggerimento calcolato al volo)
    qid = d["items"][0]["id"]
    a = requests.post(f"{BASE}/axon/stress/corrections/apply", json={"run_id": run_id, "question_id": qid}, headers=H, timeout=30)
    assert a.status_code == 200 and a.json()["rule"]
    rule_id = a.json()["rule_id"]
    lst = requests.get(f"{BASE}/axon/stress/corrections", headers=H, timeout=30).json()["items"]
    assert any(x["rule_id"] == rule_id for x in lst)
    d2 = requests.get(f"{BASE}/axon/stress/runs/{run_id}", headers=H, timeout=30).json()
    assert next(i for i in d2["items"] if i["id"] == qid)["correction_applied"] is True
    # cleanup regola
    assert requests.delete(f"{BASE}/axon/stress/corrections/{rule_id}", headers=H, timeout=30).status_code == 200
    assert requests.delete(f"{BASE}/axon/stress/corrections/{rule_id}", headers=H, timeout=30).status_code == 404


def test_correction_takes_effect_immediately():
    # regola su domanda deterministica NON coperta dagli intercettori → shortcut identico + iniezione prompt
    r = requests.post(f"{BASE}/axon/stress/run", json={"reps": 1, "limit": 1, "categories": ["ripetizioni"]}, headers=H, timeout=30)
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    for _ in range(40):
        d = requests.get(f"{BASE}/axon/stress/runs/{run_id}", headers=H, timeout=30).json()
        if d["status"] != "running":
            break
        time.sleep(3)
    it = d["items"][0]
    a = requests.post(f"{BASE}/axon/stress/corrections/apply", json={"run_id": run_id, "question_id": it["id"]}, headers=H, timeout=30)
    rule_id = a.json()["rule_id"]
    try:
        rr = requests.post(f"{BASE}/assistant/chat", json={"message": it["question"], "session_id": f"ruletest_{int(time.time())}"}, headers=H, timeout=90)
        assert rr.status_code == 200
        reply = rr.json()["reply"]
        assert f"[[NAV:{it['expected'][0]}|" in reply
    finally:
        requests.delete(f"{BASE}/axon/stress/corrections/{rule_id}", headers=H, timeout=30)


def test_stop_run():
    r = requests.post(f"{BASE}/axon/stress/run", json={"reps": 3, "limit": 40}, headers=H, timeout=30)
    if r.status_code == 409:
        return
    run_id = r.json()["run_id"]
    time.sleep(2)
    s = requests.post(f"{BASE}/axon/stress/runs/{run_id}/stop", headers=H, timeout=30)
    assert s.status_code == 200
    for _ in range(30):
        d = requests.get(f"{BASE}/axon/stress/runs/{run_id}", headers=H, timeout=30).json()
        if d["status"] in ("stopped", "done"):
            break
        time.sleep(2)
    assert d["status"] in ("stopped", "done")
    assert "summary" in d and d["summary"] is not None


def test_nightly_settings_and_status():
    # V50.z261 — test notturno: GET/PUT impostazioni, normalizzazione, stato ultimo run
    d0 = requests.get(f"{BASE}/axon/stress/nightly", headers=H, timeout=30).json()
    assert {"settings", "last", "previous", "running"} <= set(d0)
    orig = d0["settings"]
    d = requests.put(f"{BASE}/axon/stress/nightly", json={"enabled": True, "hour": 4, "mode": "full", "reps": 2, "threshold_pct": 90, "drop_pct": 5}, headers=H, timeout=30).json()
    assert d["settings"] == {"enabled": True, "hour": 4, "mode": "full", "reps": 2, "threshold_pct": 90, "drop_pct": 5}
    # valori fuori range → ignorati (restano i precedenti)
    d = requests.put(f"{BASE}/axon/stress/nightly", json={"hour": 30, "mode": "boh", "reps": 99}, headers=H, timeout=30).json()
    assert d["settings"]["hour"] == 4 and d["settings"]["mode"] == "full" and d["settings"]["reps"] == 2
    if d["last"]:
        assert d["last"]["nightly"] is True and d["last"]["nightly_verdict"] in ("ok", "alert")
    # ripristino
    requests.put(f"{BASE}/axon/stress/nightly", json=orig, headers=H, timeout=30)
    assert requests.get(f"{BASE}/axon/stress/nightly", timeout=30).status_code == 401
