"""V50.z322 — «Invita un amico»: codice personale, riscatto via /promo/redeem, premi a entrambi, limiti, admin settings/list."""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
SA = ("test@dalpastro.it", "Test1234!")


def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _cleanup_user(email):
    from pymongo import MongoClient
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    u = db.users.find_one({"email": email})
    if u:
        for c in ("user_settings", "axon_setup_state", "promo_redemptions"):
            db[c].delete_many({"user_id": u["user_id"]})
        db.referrals.delete_many({"$or": [{"invitee_user_id": u["user_id"]}, {"inviter_user_id": u["user_id"]}]})
        db.users.delete_one({"user_id": u["user_id"]})


@pytest.fixture(scope="module")
def sa():
    return login(*SA)


@pytest.fixture(scope="module")
def two_users(sa):
    """Due nuovi owner registrati tramite invito (trial 10 gg): A invita, B arriva."""
    users = []
    for tag in ("a", "b"):
        inv = requests.post(f"{BASE}/invites", json={"trial_days": 10, "note": "pytest ref"}, headers=sa, timeout=20).json()
        email = f"pyt_ref_{tag}_{uuid.uuid4().hex[:5]}@example.com"
        r = requests.post(f"{BASE}/invites/{inv['invite_token']}/register", json={"name": f"Ref {tag.upper()}", "email": email, "password": "Pyt12345!"}, timeout=20)
        assert r.status_code in (200, 201), r.text
        users.append((email, login(email, "Pyt12345!"), inv["invite_token"]))
    yield users
    for email, _, token in users:
        requests.delete(f"{BASE}/invites/{token}", headers=sa, timeout=20)
        _cleanup_user(email)


def test_settings_default_and_update(sa):
    st = requests.get(f"{BASE}/admin/referral-settings", headers=sa, timeout=20).json()
    assert st["enabled"] is True and st["inviter"]["summary"] and len(st["benefits"]) == 4
    up = requests.put(f"{BASE}/admin/referral-settings", json={"inviter": {"benefit_type": "free_weeks", "benefit_value": 1}, "invitee": {"benefit_type": "free_weeks", "benefit_value": 2}}, headers=sa, timeout=20)
    assert up.status_code == 200 and up.json()["invitee"]["summary"] == "2 settimane gratuite"


def test_referral_flow(sa, two_users):
    (email_a, ha, _), (email_b, hb, _) = two_users
    me_a = requests.get(f"{BASE}/referral/me", headers=ha, timeout=20).json()
    code = me_a["code"]
    assert code.startswith("AMICO-REF-") and me_a["friends_count"] == 0 and me_a["share_path"] == f"/login?ref={code}"
    assert requests.get(f"{BASE}/referral/me", headers=ha, timeout=20).json()["code"] == code  # stabile
    # auto-referral vietato
    assert requests.post(f"{BASE}/promo/redeem", json={"code": code}, headers=ha, timeout=20).status_code == 400
    # B riscatta il codice di A (minuscolo/spazi tollerati)
    r = requests.post(f"{BASE}/promo/redeem", json={"code": f" {code.lower()} "}, headers=hb, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "referral" and "Ref A" in r.json()["benefit_summary"]
    st_b = requests.get(f"{BASE}/subscription/status", headers=hb, timeout=20).json()
    assert 22 <= st_b["days_left"] <= 24, st_b  # 10 + 14 (invitee = 2 settimane)
    st_a = requests.get(f"{BASE}/subscription/status", headers=ha, timeout=20).json()
    assert 15 <= st_a["days_left"] <= 17, st_a  # 10 + 7 (inviter = 1 settimana)
    # B non può usare un secondo codice amico
    me_b = requests.get(f"{BASE}/referral/me", headers=hb, timeout=20).json()
    assert me_b["referred_by"] is True
    assert requests.post(f"{BASE}/promo/redeem", json={"code": code}, headers=hb, timeout=20).status_code == 409
    # statistiche di A
    me_a2 = requests.get(f"{BASE}/referral/me", headers=ha, timeout=20).json()
    assert me_a2["friends_count"] == 1 and me_a2["days_earned"] == 7 and me_a2["friends"][0]["email"] == email_b
    # codice inesistente
    assert requests.post(f"{BASE}/promo/redeem", json={"code": "AMICO-NESSUNO-0000"}, headers=hb, timeout=20).status_code == 404
    # B può ANCHE usare un codice promo (coesistenza)
    promo = requests.post(f"{BASE}/admin/promo-codes", json={"code": "REFX" + uuid.uuid4().hex[:5].upper(), "benefit_type": "credits", "benefit_value": 5}, headers=sa, timeout=20).json()
    assert requests.post(f"{BASE}/promo/redeem", json={"code": promo["code"]}, headers=hb, timeout=20).status_code == 200
    requests.delete(f"{BASE}/admin/promo-codes/{promo['code_id']}", headers=sa, timeout=20)
    # registro admin
    lst = requests.get(f"{BASE}/admin/referrals", headers=sa, timeout=20).json()
    row = next(x for x in lst["items"] if x["invitee"]["email"] == email_b)
    assert row["inviter"]["email"] == email_a and row["code"] == code and row["invitee_reward"] == "2 settimane gratuite"
    assert any(l["email"] == email_a and l["count"] == 1 for l in lst["leaderboard"])


def test_disabled_program(sa, two_users):
    (_, ha, _), _ = two_users
    requests.put(f"{BASE}/admin/referral-settings", json={"enabled": False}, headers=sa, timeout=20)
    code = requests.get(f"{BASE}/referral/me", headers=ha, timeout=20).json()["code"]
    inv = requests.post(f"{BASE}/invites", json={"trial_days": 10}, headers=sa, timeout=20).json()
    email_c = f"pyt_ref_c_{uuid.uuid4().hex[:5]}@example.com"
    requests.post(f"{BASE}/invites/{inv['invite_token']}/register", json={"name": "Ref C", "email": email_c, "password": "Pyt12345!"}, timeout=20)
    hc = login(email_c, "Pyt12345!")
    assert requests.post(f"{BASE}/promo/redeem", json={"code": code}, headers=hc, timeout=20).status_code == 410
    requests.put(f"{BASE}/admin/referral-settings", json={"enabled": True, "invitee": {"benefit_type": "free_weeks", "benefit_value": 1}}, headers=sa, timeout=20)
    requests.delete(f"{BASE}/invites/{inv['invite_token']}", headers=sa, timeout=20)
    _cleanup_user(email_c)
