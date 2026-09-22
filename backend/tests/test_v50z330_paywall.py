"""V50.z330 — Paywall fine prova: middleware 402, allowlist, piani, Stripe checkout (creazione), richiesta attivazione, sblocco admin."""
import os
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
B = os.environ.get("TEST_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com") + "/api"
EMAIL = f"pw_{uuid.uuid4().hex[:8]}@advisoros-test.com"
PWD = "Paywall123!"
S = {}


def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def h():
    return {"Authorization": f"Bearer {S['token']}"}


def test_01_register_has_trial():
    r = requests.post(B + "/auth/register", json={"email": EMAIL, "password": PWD, "name": "Paywall Tester"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    S["token"] = requests.post(B + "/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30).json()["token"]
    st = requests.get(B + "/subscription/status", headers=h(), timeout=30).json()
    assert st["status"] == "trial" and st["days_left"] == 14, st
    assert requests.get(B + "/contacts", headers=h(), timeout=30).status_code == 200


def test_02_expire_and_gate():
    async def exp():
        await _db().users.update_one({"email": EMAIL}, {"$set": {"trial_expires_at": datetime.now(timezone.utc) - timedelta(days=2)}})
    _run(exp())
    # invalida cache paywall passando da un endpoint che la ricalcola: la cache dura 20 s → forziamo con richiesta status
    st = requests.get(B + "/subscription/status", headers=h(), timeout=30).json()
    assert st["status"] == "expired" and st["is_active"] is False, st
    import time
    deadline = time.time() + 25
    code = None
    while time.time() < deadline:
        code = requests.get(B + "/contacts", headers=h(), timeout=30).status_code
        if code == 402:
            break
        time.sleep(2)
    assert code == 402
    r = requests.post(B + "/assistant/chat", headers=h(), json={"message": "ciao"}, timeout=30)
    assert r.status_code == 402 and r.json()["detail"] == "subscription_expired"


def test_03_allowlist_still_works():
    for path in ["/auth/me", "/subscription/status", "/billing/plans", "/promo/my", "/referral/me", "/user-settings"]:
        r = requests.get(B + path, headers=h(), timeout=30)
        assert r.status_code == 200, (path, r.status_code, r.text[:100])
    p = requests.get(B + "/billing/plans", headers=h(), timeout=30).json()
    assert {x["id"] for x in p["plans"]} == {"mensile", "annuale"} and p["state"]["status"] == "expired" and p["is_owner"] is True


def test_04_checkout_session_created():
    r = requests.post(B + "/billing/checkout", headers=h(), json={"plan": "annuale", "origin_url": "https://example.com"}, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["url"].startswith("https://checkout.stripe.com/") and j["session_id"].startswith("cs_")
    S["sid"] = j["session_id"]
    st = requests.get(B + f"/billing/checkout-status/{j['session_id']}", headers=h(), timeout=60).json()
    assert st["payment_status"] in ("unpaid", "pending") and st["plan"] == "annuale"
    # transazione di un altro tenant → 404
    other = requests.post(B + "/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=30).json()["token"]
    assert requests.get(B + f"/billing/checkout-status/{j['session_id']}", headers={"Authorization": f"Bearer {other}"}, timeout=30).status_code == 404
    assert requests.post(B + "/billing/checkout", headers=h(), json={"plan": "gratis", "origin_url": "https://example.com"}, timeout=30).status_code == 422


def test_05_activation_request_and_admin_grant():
    r = requests.post(B + "/billing/activation-request", headers=h(), json={"note": "test", "plan": "mensile"}, timeout=60)
    assert r.status_code == 200 and r.json()["ok"], r.text
    rid = r.json()["req_id"]
    r2 = requests.post(B + "/billing/activation-request", headers=h(), json={}, timeout=30).json()
    assert r2.get("already") is True
    admin = requests.post(B + "/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=30).json()["token"]
    ah = {"Authorization": f"Bearer {admin}"}
    lst = requests.get(B + "/admin/activation-requests?status=open", headers=ah, timeout=30).json()["items"]
    assert any(x["req_id"] == rid for x in lst)
    g = requests.post(B + f"/admin/activation-requests/{rid}/handle", headers=ah, json={"action": "grant", "days": 45}, timeout=30)
    assert g.status_code == 200 and g.json()["granted"]["days"] == 45, g.text
    st = requests.get(B + "/subscription/status", headers=h(), timeout=30).json()
    assert st["status"] == "active" and 44 <= st["days_left"] <= 45, st
    assert requests.get(B + "/contacts", headers=h(), timeout=30).status_code == 200  # sbloccato subito (cache invalidata)
    assert requests.post(B + f"/admin/activation-requests/{rid}/handle", headers=h(), json={"action": "grant"}, timeout=30).status_code == 403


def test_06_promo_does_not_shrink_unlimited_owner():
    st = requests.get(B + "/subscription/status", headers={"Authorization": "Bearer " + requests.post(B + "/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=30).json()["token"]}, timeout=30).json()
    assert st["status"] == "free_forever", st


def test_99_cleanup():
    async def clean():
        db = _db()
        u = await db.users.find_one({"email": EMAIL}, {"user_id": 1})
        if u:
            await db.users.delete_one({"user_id": u["user_id"]})
            await db.payment_transactions.delete_many({"user_id": u["user_id"]})
            await db.activation_requests.delete_many({"user_id": u["user_id"]})
    _run(clean())
