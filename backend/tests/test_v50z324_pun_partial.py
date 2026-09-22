"""V50.z324 — PUN media parziale del mese corrente (GME Esiti MGP, prezzi orari): fasce ARERA, endpoint, riga 🟡 «parziale 1–N»."""
import os
import requests
from datetime import date

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
SA = ("test@dalpastro.it", "Test1234!")


def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _load_module_funcs():
    """Esegue solo le funzioni pure del modulo (fasce/festivi) senza avviare FastAPI."""
    import re
    src = open("/app/backend/routes/axon_pun_quick.py", encoding="utf-8").read()
    ns = {"timedelta": __import__("datetime").timedelta}
    for name in ("_punq_it_holidays", "_punq_fascia"):
        m = re.search(rf"\ndef {name}\(.*?(?=\n\n\n|\ndef |\nasync def )", src, re.S)
        exec(m.group(0), ns)
    return ns


def test_fasce_arera():
    ns = _load_module_funcs()
    hol = ns["_punq_it_holidays"](2026)
    assert date(2026, 4, 6) in hol  # Pasquetta 2026
    f = ns["_punq_fascia"]
    mon = date(2026, 9, 21)  # lunedì
    assert f(mon, 9, hol) == "F1" and f(mon, 19, hol) == "F1"      # 08–09, 18–19
    assert f(mon, 8, hol) == "F2" and f(mon, 20, hol) == "F2" and f(mon, 23, hol) == "F2"  # 07–08, 19–20, 22–23
    assert f(mon, 24, hol) == "F3" and f(mon, 1, hol) == "F3" and f(mon, 7, hol) == "F3"   # 23–24, 00–01, 06–07
    sat = date(2026, 9, 26)
    assert f(sat, 12, hol) == "F2" and f(sat, 8, hol) == "F2" and f(sat, 24, hol) == "F3" and f(sat, 7, hol) == "F3"
    sun = date(2026, 9, 27)
    assert f(sun, 12, hol) == "F3"
    assert f(date(2026, 12, 25), 12, hol) == "F3"  # festivo


def test_partial_endpoint_and_table():
    sa = login(*SA)
    p = requests.get(f"{BASE}/quick-action/pun/partial", headers=sa, timeout=20).json()
    today = date.today()
    assert p["month_key"] == f"{today.year:04d}-{today.month:02d}"
    if p.get("days"):
        assert p["monorario"] and p["F1"] and p["F2"] and p["F3"] and p["source_kind"] == "gme_esiti_api"
        assert p["total_hours"] == p["F1_hours"] + p["F2_hours"] + p["F3_hours"]
        t = requests.get(f"{BASE}/quick-action/pun-18?months=3", headers=sa, timeout=30).json()
        fc = t["forecast"]
        assert fc["kind"] == "partial" and fc["days"] == p["days"] and "parziale" in fc["basis"]
        assert abs(fc["kwh"]["monorario"] - p["monorario"] / 1000) < 1e-6
        assert f"parziale 1–{p['days']}" in t["table_markdown"].split("\n")[-1]


def test_partial_refresh_master_only():
    sa = login(*SA)
    r = requests.post(f"{BASE}/quick-action/pun/partial/refresh", headers=sa, timeout=90)
    assert r.status_code in (200, 502)  # 502 solo se GME irraggiungibile
    if r.status_code == 200:
        assert r.json()["saved"] is True and r.json()["days"] >= 1
