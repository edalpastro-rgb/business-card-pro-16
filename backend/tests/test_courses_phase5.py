"""V50.z300 — Smoke test Fase 5 Area Corsi + Consigliato per te (esegui: python tests/test_courses_phase5.py)."""
import os, sys, json, datetime as dt
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
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    r = requests.post(f"{BASE}/courses", headers=H, json={"title": "Fase5 test", "course_date": tomorrow, "course_time": "9.30", "location": "Sede", "recipients": [sub["user_id"]], "pre_reminders": [1, 7, 99]}, timeout=30)
    assert r.status_code == 200, r.text
    c = r.json(); cid = c["course_id"]
    assert c["course_time"] == "09:30", c["course_time"]
    assert c["pre_reminders"] == [7, 1], c["pre_reminders"]
    print("create OK", cid, c["course_time"], c["pre_reminders"])
    # quiz → attestato NON automatico finché il test non è completato
    r = requests.put(f"{BASE}/courses/{cid}/test", headers=H, json={"questions": [{"text": "2+2?", "type": "mcq", "options": ["3", "4"], "correct": 1}], "reminder_days": 0}, timeout=30); assert r.status_code == 200, r.text
    # sub dice sì
    r = requests.post(f"{BASE}/courses/{cid}/participation", headers=H2, json={"status": "yes"}, timeout=30); assert r.status_code == 200, r.text
    # run reminders → pre1 per sub + creatore
    r = requests.post(f"{BASE}/courses/run-reminders", headers=H, timeout=60); assert r.status_code == 200, r.text
    print("run-reminders", r.json())
    r = requests.get(f"{BASE}/axon-notifications", headers=H2, timeout=30); r.raise_for_status()
    titles = [n.get("title") for n in (r.json().get("items") or r.json() if isinstance(r.json(), dict) else r.json())]
    print("sub notifs:", [t for t in titles if "Fase5" in (t or "")][:5])
    assert any("Corso domani" in (t or "") for t in titles), titles[:10]
    # seconda esecuzione: idempotente
    r = requests.post(f"{BASE}/courses/run-reminders", headers=H, timeout=60); print("run-reminders again", r.json())
    # PUT pre_reminders
    r = requests.put(f"{BASE}/courses/{cid}", headers=H, json={"pre_reminders": [0]}, timeout=30); assert r.status_code == 200 and r.json()["pre_reminders"] == [0], r.text
    # issue-all
    r = requests.post(f"{BASE}/courses/{cid}/certificates/issue-all", headers=H, timeout=30); assert r.status_code == 200, r.text
    print("issue-all", r.json()); assert r.json()["issued"] == 1
    r = requests.get(f"{BASE}/courses/{cid}", headers=H, timeout=30); d = r.json()
    assert d["certificates_issued"] == 1 and d["participants"][0]["certificate_issued"] is True and d["participants"][0]["certificate_eligible"] is True
    r = requests.get(f"{BASE}/courses/{cid}/certificate", headers=H2, timeout=30); assert r.status_code == 200 and r.json()["mime"] == "application/pdf"
    r = requests.post(f"{BASE}/courses/{cid}/certificates/issue-all", headers=H, timeout=30); assert r.json()["issued"] == 0
    # sub non può
    r = requests.post(f"{BASE}/courses/{cid}/certificates/issue-all", headers=H2, timeout=30); assert r.status_code == 403, r.text
    # recommendations
    r = requests.get(f"{BASE}/tour/recommendations", headers=H, timeout=30); assert r.status_code == 200, r.text
    print("recommendations", json.dumps(r.json(), ensure_ascii=False)[:300])
    if r.json()["items"]:
        f = r.json()["items"][0]["id"]
        r2 = requests.post(f"{BASE}/tour/recommendations/dismiss", headers=H, json={"feature": f}, timeout=30); assert r2.status_code == 200
        r3 = requests.get(f"{BASE}/tour/recommendations", headers=H, timeout=30); assert all(i["id"] != f for i in r3.json()["items"])
        print("dismiss OK", f)
    r = requests.post(f"{BASE}/tour/recommendations/dismiss", headers=H, json={"feature": "zzz"}, timeout=30); assert r.status_code == 400
    # cleanup
    requests.delete(f"{BASE}/courses/{cid}", headers=H, timeout=30)
    print("ALL OK")


if __name__ == "__main__":
    main()
