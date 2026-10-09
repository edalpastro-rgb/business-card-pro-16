"""V50.z491 — Anteprima duplicati + unione per le importazioni (cartella/Drive/CSV) + contact_ids nella risposta."""
import os
import uuid

import requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")


def _login():
    r = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _mk_contact(h, **kw):
    body = {"first_name": "Dup", "last_name": f"Test{uuid.uuid4().hex[:6]}", "area": "energy", **kw}
    r = requests.post(f"{BASE}/contacts", json=body, headers=h, timeout=20)
    assert r.status_code in (200, 201), r.text[:300]
    return r.json()


def _del(h, cid):
    requests.delete(f"{BASE}/contacts/{cid}", headers=h, timeout=20)


def test_csv_check_duplicates_by_phone_and_email():
    h = _login()
    phone = "333" + uuid.uuid4().hex[:7].translate(str.maketrans("abcdef", "123456"))
    email = f"dup{uuid.uuid4().hex[:6]}@example.it"
    c = _mk_contact(h, phone=phone, email=email)
    try:
        rows = [{"Nome": "Altro", "Cognome": "Nome", "Tel": phone}, {"Nome": "Mai", "Cognome": "Visto", "Email": email}, {"Nome": "Nessuno", "Cognome": "Nuovo", "Tel": "3339999999"}]
        mapping = {"Nome": "first_name", "Cognome": "last_name", "Tel": "phone", "Email": "email"}
        r = requests.post(f"{BASE}/contacts/import/check-duplicates", json={"rows": rows, "mapping": mapping}, headers=h, timeout=30)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        by_row = {d["row"]: d for d in j["duplicates"]}
        assert 2 in by_row and by_row[2]["existing"]["contact_id"] == c["contact_id"] and "phone" in by_row[2]["match"]
        assert 3 in by_row and "email" in by_row[3]["match"]
        assert j["total_rows"] == 3
    finally:
        _del(h, c["contact_id"])


def test_csv_execute_skip_and_merge_strategies_and_contact_ids():
    h = _login()
    phone = "334" + uuid.uuid4().hex[:7].translate(str.maketrans("abcdef", "123456"))
    c = _mk_contact(h, phone=phone)
    created = []
    try:
        rows = [{"Nome": "Mario", "Cognome": "Unito", "Tel": phone, "Email": "mario.unito@example.it"}]
        mapping = {"Nome": "first_name", "Cognome": "last_name", "Tel": "phone", "Email": "email"}
        # skip → nessun contatto creato
        r = requests.post(f"{BASE}/contacts/import/execute", json={"rows": rows, "mapping": mapping, "default_area": "energy", "duplicate_strategy": "skip"}, headers=h, timeout=30)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j["imported"] == 0 and j["skipped_duplicates"] == 1 and j["contact_ids"] == []
        # merge → email compilata sul contatto esistente, nessuna nuova scheda, contact_ids = [esistente]
        r = requests.post(f"{BASE}/contacts/import/execute", json={"rows": rows, "mapping": mapping, "default_area": "energy", "duplicate_strategy": "merge"}, headers=h, timeout=30)
        j = r.json()
        assert j["imported"] == 0 and j["merged"] == 1 and j["contact_ids"] == [c["contact_id"]]
        g = requests.get(f"{BASE}/contacts/{c['contact_id']}", headers=h, timeout=20).json()
        assert g.get("email") == "mario.unito@example.it"
        assert g.get("first_name") == "Dup"  # campo già compilato NON sovrascritto
        # create → nuova scheda e contact_ids con 1 id nuovo
        r = requests.post(f"{BASE}/contacts/import/execute", json={"rows": rows, "mapping": mapping, "default_area": "energy", "duplicate_strategy": "create"}, headers=h, timeout=30)
        j = r.json()
        assert j["imported"] == 1 and len(j["contact_ids"]) == 1 and j["contact_ids"][0] != c["contact_id"]
        created = j["contact_ids"]
    finally:
        _del(h, c["contact_id"])
        for cid in created:
            _del(h, cid)


def test_folder_session_duplicates_endpoint():
    h = _login()
    vat = "0" + uuid.uuid4().hex[:10].translate(str.maketrans("abcdef", "123456"))
    c = _mk_contact(h, company="Energia Dup Srl", vat_number=vat)
    try:
        s = requests.post(f"{BASE}/contacts/import-folder/session", json={}, headers=h, timeout=20)
        assert s.status_code == 200, s.text[:300]
        sid = s.json()["session_id"]
        r = requests.post(f"{BASE}/contacts/import-folder/{sid}/duplicates", json={"fields": {"company": "ENERGIA DUP S.R.L.", "vat_number": vat}}, headers=h, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()["duplicates"]
        assert d and d[0]["contact_id"] == c["contact_id"]
        assert "vat_number" in d[0]["match"] and "company" in d[0]["match"]
        r = requests.post(f"{BASE}/contacts/import-folder/{sid}/duplicates", json={"fields": {"company": "Qualcosa di Inesistente Snc"}}, headers=h, timeout=30)
        assert r.json()["duplicates"] == []
    finally:
        _del(h, c["contact_id"])
