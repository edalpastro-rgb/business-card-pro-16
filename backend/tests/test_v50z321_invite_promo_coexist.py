"""V50.z321 — Coesistenza «Invita Cliente» (trial da invito) + codici promozionali.
Flusso: owner crea invito (trial 10 gg) → nuovo utente si registra col token → riscatta un codice promo (2 settimane)
→ trial = 10 + 14 gg, invited_by conservato, l'invito mostra i codici promo, il codice mostra «invitato da»."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
SA = ("test@dalpastro.it", "Test1234!")  # owner + super_admin


def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def sa():
    return login(*SA)


def test_invite_plus_promo_coexist(sa):
    tag = uuid.uuid4().hex[:6]
    inv = requests.post(f"{BASE}/invites", json={"trial_days": 10, "note": f"pytest {tag}"}, headers=sa, timeout=20)
    assert inv.status_code in (200, 201), inv.text
    token = inv.json()["invite_token"]
    email = f"pyt_inv_{tag}@example.com"
    reg = requests.post(f"{BASE}/invites/{token}/register", json={"name": "Pyt Invitato", "email": email, "password": "Pyt12345!"}, timeout=20)
    assert reg.status_code in (200, 201), reg.text
    new_h = login(email, "Pyt12345!")
    st0 = requests.get(f"{BASE}/subscription/status", headers=new_h, timeout=20).json()
    assert st0["status"] == "trial" and 8 <= (st0["days_left"] or 0) <= 10

    code = requests.post(f"{BASE}/admin/promo-codes", json={"code": f"COEX{tag.upper()}", "benefit_type": "free_weeks", "benefit_value": 2}, headers=sa, timeout=20).json()
    r = requests.post(f"{BASE}/promo/redeem", json={"code": code["code"]}, headers=new_h, timeout=20)
    assert r.status_code == 200, r.text
    st1 = requests.get(f"{BASE}/subscription/status", headers=new_h, timeout=20).json()
    assert st1["status"] == "trial" and 22 <= st1["days_left"] <= 24, st1  # 10 + 14 gg (additivo, non sostitutivo)

    # Pannello Master «Invita Cliente»: l'invitato mostra i codici promo riscattati
    lst = requests.get(f"{BASE}/invites", headers=sa, timeout=20).json()["items"]
    mine = next(i for i in lst if i["invite_token"] == token)
    assert mine["invited_user"]["email"] == email
    assert [p["code"] for p in mine["invited_user"]["promo_codes"]] == [code["code"]]
    assert mine["invited_user"]["subscription"]["days_left"] == st1["days_left"]

    # Pannello «Codici Promozionali»: il riscatto mostra da quale invito arriva l'utente
    red = requests.get(f"{BASE}/admin/promo-codes/{code['code_id']}/redemptions", headers=sa, timeout=20).json()
    assert red["items"][0]["email"] == email and red["items"][0]["invited_by_email"] == SA[0]
    assert red["items"][0]["subscription"]["status"] == "trial"

    # extend-trial dell'owner continua a funzionare in modo additivo dopo il promo
    ext = requests.put(f"{BASE}/users/{reg.json().get('user', {}).get('user_id') or mine['invited_user']['user_id']}/extend-trial", json={"add_days": 5}, headers=sa, timeout=20)
    assert ext.status_code == 200, ext.text
    assert ext.json()["subscription"]["days_left"] == st1["days_left"] + 5

    # cleanup
    requests.delete(f"{BASE}/admin/promo-codes/{code['code_id']}", headers=sa, timeout=20)
    requests.delete(f"{BASE}/invites/{token}", headers=sa, timeout=20)
    from pymongo import MongoClient
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    uid = mine["invited_user"]["user_id"]
    db.users.delete_one({"user_id": uid})
    db.user_settings.delete_many({"user_id": uid})
    db.axon_setup_state.delete_many({"user_id": uid})
    db.promo_redemptions.delete_many({"user_id": uid})
