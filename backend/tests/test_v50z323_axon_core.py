"""V50.z323 — Axon Core: manifest pubblico, users.product (advisor default / lite alla registrazione), /axon/core/me,
admin conteggi e cambio prodotto, chat Axon funzionante per un utente Lite (stesso cervello, identità Lite)."""
import os
import uuid
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
SA = ("test@dalpastro.it", "Test1234!")


def login(email, pw):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _cleanup(email):
    from pymongo import MongoClient
    from dotenv import dotenv_values
    env = dotenv_values("/app/backend/.env")
    db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]
    u = db.users.find_one({"email": email})
    if u:
        for c in ("settings", "user_settings", "axon_setup_state", "assistant_messages"):
            db[c].delete_many({"user_id": u["user_id"]})
        db.users.delete_one({"user_id": u["user_id"]})


def test_manifest_public():
    r = requests.get(f"{BASE}/axon/core/manifest", timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == "Axon Core" and {p["id"] for p in d["products"]} == {"advisor", "lite"}
    assert any("/promo/redeem" in e for e in d["shared_endpoints"]) and "private" in d["data_model"]


def test_existing_users_are_advisor():
    sa = login(*SA)
    me = requests.get(f"{BASE}/auth/me", headers=sa, timeout=20).json()["user"]
    assert me["product"] == "advisor"
    assert requests.get(f"{BASE}/axon/core/me", headers=sa, timeout=20).json()["product"] == "advisor"
    counts = requests.get(f"{BASE}/admin/axon-core/products", headers=sa, timeout=20).json()["items"]
    assert {c["id"] for c in counts} == {"advisor", "lite"} and next(c for c in counts if c["id"] == "advisor")["users"] >= 1


def test_lite_registration_and_chat():
    sa = login(*SA)
    email = f"pyt_lite_{uuid.uuid4().hex[:6]}@example.com"
    try:
        r = requests.post(f"{BASE}/auth/register", json={"email": email, "password": "Lite12345!", "name": "Lite Tester", "product": "lite"}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["product"] == "lite"
        h = {"Authorization": f"Bearer {r.json()['token']}"}
        me = requests.get(f"{BASE}/axon/core/me", headers=h, timeout=20).json()
        assert me["product"] == "lite" and "crm" not in me["features"] and "axon_memory" in me["features"]
        # elenco clienti super admin espone il prodotto
        lst = requests.get(f"{BASE}/admin/customers", headers=sa, timeout=20).json()["items"]
        row = next(x for x in lst if x["email"] == email)
        assert row["product"] == "lite"
        # chat Axon (stesso cervello) risponde a un utente Lite
        chat = requests.post(f"{BASE}/assistant/chat", json={"message": "Ciao! In una frase: che tipo di app sto usando e cosa puoi fare per me?"}, headers=h, timeout=90)
        assert chat.status_code == 200, chat.text
        reply = (chat.json().get("reply") or chat.json().get("content") or str(chat.json())).lower()
        assert len(reply) > 10
        print("LITE REPLY:", reply[:300])
        # cambio prodotto lato super admin
        uid = row["user_id"]
        assert requests.put(f"{BASE}/admin/users/{uid}/product", json={"product": "advisor"}, headers=sa, timeout=20).json()["product"] == "advisor"
        assert requests.get(f"{BASE}/axon/core/me", headers=h, timeout=20).json()["product"] == "advisor"
        # registrazione senza product → advisor
        email2 = f"pyt_adv_{uuid.uuid4().hex[:6]}@example.com"
        r2 = requests.post(f"{BASE}/auth/register", json={"email": email2, "password": "Adv12345!", "name": "Adv Tester"}, timeout=20)
        assert r2.json()["user"]["product"] == "advisor"
        _cleanup(email2)
    finally:
        _cleanup(email)
