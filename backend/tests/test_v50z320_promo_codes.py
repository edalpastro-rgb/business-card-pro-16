"""V50.z320 — Codici promozionali: CRUD super admin + riscatto + limiti (max usi, scadenza, doppio uso)."""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
SA = ("test@dalpastro.it", "Test1234!")      # super_admin: true
USER = ("demo@advisoros.it", "Demo1234!")    # utente normale (owner di un altro tenant)
COLLAB = ("collab.demo@advisoros.it", "Demo1234!")


def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def sa():
    return login(*SA)


@pytest.fixture(scope="module")
def usr():
    return login(*USER)


@pytest.fixture(scope="module")
def code_name():
    return "PYT" + uuid.uuid4().hex[:6].upper()


def test_non_admin_forbidden(usr):
    assert requests.get(f"{BASE}/admin/promo-codes", headers=usr, timeout=20).status_code == 403


def test_create_list_patch(sa, code_name):
    r = requests.post(f"{BASE}/admin/promo-codes", json={"code": code_name.lower(), "description": "test", "benefit_type": "free_weeks", "benefit_value": 2, "expires_at": "31/12/2099", "max_uses": 1}, headers=sa, timeout=20)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["code"] == code_name and d["status"] == "active" and d["max_uses"] == 1 and d["benefit_summary"] == "2 settimane gratuite"
    assert d["expires_at"].startswith("2099-12-31")
    # duplicato
    assert requests.post(f"{BASE}/admin/promo-codes", json={"code": code_name, "benefit_type": "credits", "benefit_value": 5}, headers=sa, timeout=20).status_code == 409
    # data invalida
    assert requests.post(f"{BASE}/admin/promo-codes", json={"code": "BADDATE1", "benefit_type": "credits", "benefit_value": 5, "expires_at": "99/99/2026"}, headers=sa, timeout=20).status_code == 400
    lst = requests.get(f"{BASE}/admin/promo-codes", headers=sa, timeout=20).json()
    assert any(i["code"] == code_name for i in lst["items"]) and len(lst["benefits"]) == 4
    p = requests.patch(f"{BASE}/admin/promo-codes/{d['code_id']}", json={"description": "aggiornata", "clear_expires": True}, headers=sa, timeout=20)
    assert p.status_code == 200 and p.json()["description"] == "aggiornata" and p.json()["expires_at"] is None


def test_redeem_flow(sa, usr, code_name):
    me_before = requests.get(f"{BASE}/subscription/status", headers=usr, timeout=20).json()
    r = requests.post(f"{BASE}/promo/redeem", json={"code": f" {code_name.lower()} "}, headers=usr, timeout=20)
    assert r.status_code == 200, r.text
    assert "esteso fino al" in r.json()["message"] or "illimitato" in r.json()["message"]
    # doppio uso → 409
    assert requests.post(f"{BASE}/promo/redeem", json={"code": code_name}, headers=usr, timeout=20).status_code == 409
    # max_uses=1 raggiunto → un altro utente riceve 410
    col = login(*COLLAB)
    assert requests.post(f"{BASE}/promo/redeem", json={"code": code_name}, headers=col, timeout=20).status_code == 410
    # riepilogo lato admin
    items = requests.get(f"{BASE}/admin/promo-codes", headers=sa, timeout=20).json()["items"]
    mine = next(i for i in items if i["code"] == code_name)
    assert mine["uses_count"] == 1 and mine["status"] == "exhausted"
    cid = mine["code_id"]
    red = requests.get(f"{BASE}/admin/promo-codes/{cid}/redemptions", headers=sa, timeout=20).json()
    assert len(red["items"]) == 1 and red["items"][0]["email"] == USER[0] and red["items"][0]["redeemed_at"]
    my = requests.get(f"{BASE}/promo/my", headers=usr, timeout=20).json()
    assert any(i["code"] == code_name for i in my["items"])
    if me_before.get("status") != "free_forever":
        after = requests.get(f"{BASE}/subscription/status", headers=usr, timeout=20).json()
        assert after.get("expires_at")
    # cleanup
    assert requests.delete(f"{BASE}/admin/promo-codes/{cid}", headers=sa, timeout=20).status_code == 204
    assert requests.get(f"{BASE}/admin/promo-codes/{cid}/redemptions", headers=sa, timeout=20).status_code == 404


def test_invalid_expired_disabled(sa, usr):
    assert requests.post(f"{BASE}/promo/redeem", json={"code": "NOPE-XYZ-000"}, headers=usr, timeout=20).status_code == 404
    r = requests.post(f"{BASE}/admin/promo-codes", json={"code": "EXP" + uuid.uuid4().hex[:5].upper(), "benefit_type": "credits", "benefit_value": 10, "expires_at": "01/01/2020"}, headers=sa, timeout=20)
    cid = r.json()["code_id"]
    assert r.json()["status"] == "expired"
    assert requests.post(f"{BASE}/promo/redeem", json={"code": r.json()["code"]}, headers=usr, timeout=20).status_code == 410
    requests.patch(f"{BASE}/admin/promo-codes/{cid}", json={"active": False, "clear_expires": True}, headers=sa, timeout=20)
    assert requests.post(f"{BASE}/promo/redeem", json={"code": r.json()["code"]}, headers=usr, timeout=20).status_code == 404
    requests.delete(f"{BASE}/admin/promo-codes/{cid}", headers=sa, timeout=20)


def test_credits_and_premium(sa, usr):
    c1 = requests.post(f"{BASE}/admin/promo-codes", json={"code": "CRD" + uuid.uuid4().hex[:5].upper(), "benefit_type": "credits", "benefit_value": 25}, headers=sa, timeout=20).json()
    before = requests.get(f"{BASE}/promo/my", headers=usr, timeout=20).json()["promo_credits"]
    r = requests.post(f"{BASE}/promo/redeem", json={"code": c1["code"]}, headers=usr, timeout=20)
    assert r.status_code == 200 and "25 crediti" in r.json()["message"]
    assert requests.get(f"{BASE}/promo/my", headers=usr, timeout=20).json()["promo_credits"] == before + 25
    c2 = requests.post(f"{BASE}/admin/promo-codes", json={"code": "PRM" + uuid.uuid4().hex[:5].upper(), "benefit_type": "premium", "benefit_value": 1, "premium_days": 14}, headers=sa, timeout=20).json()
    assert c2["benefit_summary"] == "Funzioni premium per 14 giorni"
    r = requests.post(f"{BASE}/promo/redeem", json={"code": c2["code"]}, headers=usr, timeout=20)
    assert r.status_code == 200 and "premium attive fino al" in r.json()["message"]
    assert requests.get(f"{BASE}/promo/my", headers=usr, timeout=20).json()["premium_until"]
    for c in (c1, c2):
        requests.delete(f"{BASE}/admin/promo-codes/{c['code_id']}", headers=sa, timeout=20)
