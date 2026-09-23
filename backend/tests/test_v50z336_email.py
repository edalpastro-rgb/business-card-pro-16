"""V50.z336 — Email Resend advisoros.it: config (mascherata), 3 mittenti, test invio (fallback Emergent), eventi, hook demo-request/register/ticket."""
import os
import uuid
import asyncio

import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
B = os.environ.get("TEST_BACKEND_URL", "http://localhost:8001") + "/api"
OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
S = {}


def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def h():
    return {"Authorization": f"Bearer {S['token']}"}


def test_01_login_owner():
    r = requests.post(f"{B}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    S["token"] = r.json()["token"]


def test_02_config_masked_and_senders():
    r = requests.get(f"{B}/email/config", headers=h(), timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["domain"] == "advisoros.it"
    kinds = {s["kind"]: s for s in j["senders"]}
    assert kinds["info"]["address"] == "info@advisoros.it"
    assert kinds["help"]["address"] == "help@advisoros.it"
    assert kinds["master"]["address"] == "emanuele@advisoros.it"
    assert kinds["master"]["env"] == "SENDER_EMANUELE"
    # la chiave non deve MAI comparire in chiaro
    raw = os.environ.get("RESEND_API_KEY", "")
    if raw and not j["resend_key_configured"]:
        assert "placeholder" in raw
    assert raw not in r.text or raw == "" or j["resend_key_configured"] is False
    assert j["provider"] in ("resend", "emergent", "smtp_only")


def test_03_config_requires_auth():
    r = requests.get(f"{B}/email/config", timeout=30)
    assert r.status_code in (401, 403)


def test_04_test_send_and_event_logged():
    r = requests.post(f"{B}/email/test", headers=h(), json={"kind": "help", "to": OWNER["email"]}, timeout=60)
    assert r.status_code in (200, 502), r.text
    if r.status_code == 200:
        j = r.json()
        assert j["ok"] is True and j["provider"] in ("resend", "emergent", "smtp")
    ev = requests.get(f"{B}/email/events?limit=5", headers=h(), timeout=30)
    assert ev.status_code == 200
    items = ev.json()["items"]
    assert items and items[0]["kind"] == "help" and items[0]["sender"] == "help@advisoros.it"


def test_05_test_send_validation():
    r = requests.post(f"{B}/email/test", headers=h(), json={"kind": "info", "to": "not-an-email"}, timeout=30)
    assert r.status_code == 422
    r = requests.post(f"{B}/email/test", headers=h(), json={"kind": "boh", "to": "a@b.it"}, timeout=30)
    assert r.status_code == 422


def test_06_demo_request_hook_logs_master_notification():
    lead_mail = f"lead_{uuid.uuid4().hex[:6]}@advisoros-test.com"
    r = requests.post(f"{B}/public/demo-request", json={"full_name": "Mario Test", "company": "ACME", "email": lead_mail, "phone": "3330000000", "consent_privacy": True, "website": ""}, timeout=60)
    assert r.status_code == 200, r.text

    async def _check():
        db = _db()
        conf = await db.email_events.find_one({"tag": "lead_confirm", "to": lead_mail})
        master = await db.email_events.find_one({"tag": "lead_demo", "kind": "master"}, sort=[("created_at", -1)])
        return conf, master

    conf, master = _run(_check())
    assert conf is not None and conf["sender"] == "info@advisoros.it"
    assert master is not None and master["to"] == "emanuele@advisoros.it"


def test_07_register_hook_notifies_master():
    email = f"reg_{uuid.uuid4().hex[:6]}@advisoros-test.com"
    r = requests.post(f"{B}/auth/register", json={"email": email, "password": "Register123!", "name": "Reg Test"}, timeout=60)
    assert r.status_code == 200, r.text

    async def _check():
        return await _db().email_events.find_one({"tag": "register", "subject": {"$regex": "Reg Test"}})

    ev = _run(_check())
    assert ev is not None and ev["kind"] == "master"


def test_08_support_ticket_hook():
    r = requests.post(f"{B}/support/tickets", headers=h(), json={"text": "Test ticket email hook V50.z336", "checks": [], "attachments": []}, timeout=90)
    assert r.status_code == 200, r.text
    tid = r.json().get("ticket_id")

    async def _check():
        db = _db()
        inbox = await db.email_events.find_one({"tag": "support_inbox", "subject": {"$regex": tid}})
        ack = await db.email_events.find_one({"tag": "support_ack", "subject": {"$regex": tid}})
        return inbox, ack

    inbox, ack = _run(_check())
    assert inbox is not None and inbox["to"] == "help@advisoros.it"
    assert ack is not None and ack["sender"] == "help@advisoros.it"
