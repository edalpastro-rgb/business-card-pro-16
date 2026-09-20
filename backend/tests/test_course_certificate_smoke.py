"""Smoke test V50.z276 — attestato PDF automatico + slide da dettatura. Esegui: python tests/test_course_certificate_smoke.py"""
import base64
import io
import os
import sys

import requests

BASE = os.environ.get("BASE_URL", "http://localhost:8001/api")


def login(email, pwd):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["user"]["user_id"]


def main():
    h, _ = login("test@dalpastro.it", "Test1234!")
    hs, sub_id = login("sub1@dalpastro.it", "Sub12345!")
    c = requests.post(f"{BASE}/courses", json={"title": "Corso Attestato Smoke", "course_date": "2026-06-10", "location": "Padova", "recipients": [sub_id]}, headers=h, timeout=30)
    assert c.status_code == 200, c.text
    cid = c.json()["course_id"]
    try:
        # slide da sola dettatura (nessun materiale)
        r = requests.post(f"{BASE}/courses/{cid}/slides/generate", json={"n_slides": 3, "instructions": ""}, headers=h, timeout=30)
        assert r.status_code == 400, r.text
        r = requests.post(f"{BASE}/courses/{cid}/slides/generate", json={"n_slides": 4, "instructions": "Voglio quattro slide: obiettivi del corso, come si legge una bolletta luce, le voci di spesa principali, come proporre l'offerta al cliente con un esempio pratico."}, headers=h, timeout=180)
        assert r.status_code == 200, r.text
        print("dettatura → slide:", [s["title"] for s in r.json()["slides"]["slides"]])
        # attestato: non idoneo prima
        r = requests.get(f"{BASE}/courses/{cid}/certificate", headers=hs, timeout=30); assert r.status_code == 400, r.text
        d = requests.get(f"{BASE}/courses/{cid}", headers=hs, timeout=30).json(); assert d["my_certificate"]["eligible"] is False and d["has_test"] is False
        # test creato → serve anche il test
        r = requests.put(f"{BASE}/courses/{cid}/test", json={"questions": [{"text": "2+2?", "type": "mcq", "options": ["3", "4"], "correct": 1}], "reminder_days": 0}, headers=h, timeout=30); assert r.status_code == 200
        r = requests.post(f"{BASE}/courses/{cid}/participation", json={"status": "yes"}, headers=hs, timeout=30); assert r.status_code == 200
        d = requests.get(f"{BASE}/courses/{cid}", headers=hs, timeout=30).json(); assert d["my_certificate"]["eligible"] is False and d["has_test"] is True, d["my_certificate"]
        qid = requests.get(f"{BASE}/courses/{cid}/test", headers=hs, timeout=30).json()["questions"][0]["id"]
        r = requests.post(f"{BASE}/courses/{cid}/test/submit", json={"answers": {qid: 1}, "duration_s": 12}, headers=hs, timeout=30); assert r.status_code == 200
        d = requests.get(f"{BASE}/courses/{cid}", headers=hs, timeout=30).json()
        assert d["my_certificate"]["eligible"] is True and d["my_certificate"].get("cert_id", "").startswith("ATT-"), d["my_certificate"]
        print("attestato emesso automaticamente:", d["my_certificate"]["cert_id"])
        # notifica ricevuta dal collaboratore
        n = requests.get(f"{BASE}/axon/notifications", headers=hs, timeout=30)
        if n.status_code == 200:
            items = n.json() if isinstance(n.json(), list) else n.json().get("items", [])
            assert any("Attestato" in (x.get("title") or "") for x in items), [x.get("title") for x in items][:5]
            print("notifica 🎓 ok")
        # PDF collaboratore
        r = requests.get(f"{BASE}/courses/{cid}/certificate", headers=hs, timeout=60); assert r.status_code == 200, r.text
        raw = base64.b64decode(r.json()["data_base64"]); assert raw[:4] == b"%PDF" and len(raw) > 1500
        from pypdf import PdfReader
        txt = PdfReader(io.BytesIO(raw)).pages[0].extract_text()
        assert "ATTESTATO DI PARTECIPAZIONE" in txt and "Corso Attestato Smoke" in txt and "1/1" in txt, txt
        print("pdf ok:", r.json()["name"], len(raw), "bytes")
        # creatore scarica per partecipante + vede il flag
        d = requests.get(f"{BASE}/courses/{cid}", headers=h, timeout=30).json()
        assert d["participants"][0]["certificate_eligible"] is True
        r = requests.get(f"{BASE}/courses/{cid}/certificate", params={"user_id": sub_id}, headers=h, timeout=60); assert r.status_code == 200 and r.json()["cert"]["cert_id"] == d["my_certificate"].get("cert_id", r.json()["cert"]["cert_id"])
        print("ALL OK")
    finally:
        requests.delete(f"{BASE}/courses/{cid}", headers=h, timeout=30)


if __name__ == "__main__":
    sys.exit(main())
