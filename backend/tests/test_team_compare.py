"""V50.z310 — Smoke test Confronto collaboratori (esegui: python tests/test_team_compare.py)."""
import os, datetime as dt
import requests

BASE = os.environ.get("BASE", "http://localhost:8001/api")


def login(email, pwd):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd}, timeout=30); r.raise_for_status()
    return r.json()["token"], r.json()["user"]


def main():
    tok, owner = login("test@dalpastro.it", "Test1234!")
    H = {"Authorization": f"Bearer {tok}"}
    tok2, sub = login("sub1@dalpastro.it", "Sub12345!")
    H2 = {"Authorization": f"Bearer {tok2}"}

    before = requests.get(f"{BASE}/team-insights/compare", params={"period": "30"}, headers=H, timeout=60).json()
    me0 = next(m for m in before["members"] if m["user_id"] == sub["user_id"])["kpi"]

    # il collaboratore crea: 1 contatto, 1 contratto, 1 appuntamento svolto con contratto firmato, 1 chiamata
    r = requests.post(f"{BASE}/contacts", headers=H2, json={"first_name": "Cmp", "last_name": f"Test{dt.datetime.now().strftime('%H%M%S')}", "phone": "3330000000", "area": "network"}, timeout=30)
    assert r.status_code == 200, r.text
    contact_id = r.json().get("contact_id")
    r = requests.post(f"{BASE}/contracts", headers=H2, json={"contact_id": contact_id, "contract_number": "CMP-1", "contract_type": "luce", "supplier": "Test", "amount_eur": 1200, "status": "active"}, timeout=30)
    assert r.status_code == 200, r.text
    start = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)).isoformat()
    r = requests.post(f"{BASE}/appointments", headers=H2, json={"title": "Cmp appuntamento", "start_at": start, "contact_id": contact_id, "area": "network"}, timeout=30)
    assert r.status_code == 200, r.text
    aid = r.json()["appointment_id"]
    r = requests.put(f"{BASE}/appointments/{aid}", headers=H2, json={"done": True, "contract_signed": True, "products_sold": 2}, timeout=30)
    assert r.status_code == 200, r.text
    r = requests.post(f"{BASE}/calls/log", headers=H2, json={"contact_id": contact_id, "phone": "3330000000", "channel": "phone", "duration_sec": 180}, timeout=30)
    assert r.status_code == 200, r.text

    after = requests.get(f"{BASE}/team-insights/compare", params={"period": "30"}, headers=H, timeout=60).json()
    me = next(m for m in after["members"] if m["user_id"] == sub["user_id"])
    k = me["kpi"]
    assert k["contacts_new"] == me0["contacts_new"] + 1, (k, me0)
    assert k["contracts"] == me0["contracts"] + 1 and k["contracts_amount"] >= me0["contracts_amount"] + 1200, k
    assert k["appts"] == me0["appts"] + 1 and k["appts_done"] == me0["appts_done"] + 1 and k["products_sold"] == me0["products_sold"] + 2, k
    assert k["calls"] == me0["calls"] + 1 and k["call_minutes"] >= me0["call_minutes"] + 3, k
    assert after["best"]["contracts"] == sub["user_id"] or k["contracts"] <= after["team_avg"]["contracts"] * len(after["members"]), after["best"]
    assert me["rank"] == 1 and me["score"] > 0, (me["rank"], me["score"])
    assert set(after["team_avg"]) == {m["key"] for m in after["metrics"]}
    print("KPI OK", {x: k[x] for x in ("contacts_new", "contracts", "contracts_amount", "appts_done", "products_sold", "calls", "call_minutes", "conversion_pct")}, "rank", me["rank"], "score", me["score"])

    for p, code in (("90", 200), ("365", 200), ("all", 200), ("7", 400)):
        r = requests.get(f"{BASE}/team-insights/compare", params={"period": p}, headers=H, timeout=60)
        assert r.status_code == code, (p, r.status_code, r.text)
    assert requests.get(f"{BASE}/team-insights/compare", headers=H2, timeout=30).status_code == 403
    print("periods + 403 OK")
    # il dettaglio /team-insights/{uid} non è intercettato da /compare
    assert requests.get(f"{BASE}/team-insights/{sub['user_id']}", headers=H, timeout=120).status_code == 200
    print("ALL OK")


if __name__ == "__main__":
    main()
