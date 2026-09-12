"""V50.z197 — test e2e Blocco 8 Fase 1 (routes/axon_integrations.py). Uso: python tests/test_axon_integrations.py"""
import os, sys
from datetime import datetime, timezone
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30); r.raise_for_status()
    j = r.json(); return j.get("access_token") or j.get("token")


def check(c, label):
    print(("✅" if c else "❌"), label); return bool(c)


def main():
    tok = login(); h = {"Authorization": f"Bearer {tok}"}; ok = True
    from dotenv import dotenv_values
    from pymongo import MongoClient
    env = dotenv_values(os.path.join(os.path.dirname(__file__), "..", ".env"))
    mdb = MongoClient(env["MONGO_URL"])[env.get("DB_NAME", "test_database")]
    me = httpx.get(f"{BASE}/auth/me", headers=h, timeout=30).json()["user"]; uid = me["user_id"]

    # 1) status: due sfere, card attese
    st = httpx.get(f"{BASE}/axon/integrations/status", headers=h, timeout=30).json()
    bkeys = [i["key"] for i in st["spheres"]["business"]["items"]]; hkeys = [i["key"] for i in st["spheres"]["home"]["items"]]
    ok &= check(st["google_configured"] and "google_calendar" in bkeys and "dropbox" in bkeys and "homeassistant" in hkeys and "google_calendar_home" in hkeys, f"status: business {bkeys} · home {hkeys}")
    ok &= check(st["spheres"]["business"]["icon"] == "🔵" and st["spheres"]["home"]["icon"] == "🟢", "indicatori sfera distinti")

    # 2) OAuth start per sfera → state con purpose axi; scopes calendar+contacts (+drive.file per home)
    r = httpx.post(f"{BASE}/axon/integrations/google/start", headers=h, timeout=30, json={"sphere": "home"}).json()
    url = r["authorization_url"]
    ok &= check("calendar" in url and "contacts.readonly" in url and "drive.file" in url and r["sphere"] == "home", "start home → URL con scope calendar+contacts+drive.file")
    state = url.split("state=")[1].split("&")[0]
    sdoc = mdb.google_oauth_states.find_one({"_id": state})
    ok &= check(sdoc and sdoc.get("purpose") == "axi" and sdoc.get("sphere") == "home", "state salvato con purpose=axi, sphere=home")
    r2 = httpx.post(f"{BASE}/axon/integrations/google/start", headers=h, timeout=30, json={"sphere": "business"}).json()
    ok &= check("drive.file" not in r2["authorization_url"] and "calendar" in r2["authorization_url"], "start business → scope calendar+contacts (senza drive.file)")
    bad = httpx.post(f"{BASE}/axon/integrations/google/start", headers=h, timeout=30, json={"sphere": "x"})
    ok &= check(bad.status_code == 400, "sfera non valida → 400")

    # 3) exchange: state non nostro → handled False (state Drive intatto); state nostro con code finto → errore Google 400 e state consumato
    mdb.google_oauth_states.insert_one({"_id": "drive_state_test", "user_id": uid, "created_at": datetime.now(timezone.utc)})
    e1 = httpx.post(f"{BASE}/axon/integrations/oauth/exchange", timeout=30, json={"code": "abc", "state": "drive_state_test"}).json()
    ok &= check(e1 == {"handled": False} and mdb.google_oauth_states.find_one({"_id": "drive_state_test"}), "state Drive → handled=false e non consumato")
    mdb.google_oauth_states.delete_one({"_id": "drive_state_test"})
    e2 = httpx.post(f"{BASE}/axon/integrations/oauth/exchange", timeout=30, json={"code": "fake", "state": state})
    ok &= check(e2.status_code == 400 and not mdb.google_oauth_states.find_one({"_id": state}), "state axi con code finto → 400 Google, state consumato")

    # 4) connessione simulata (refresh token finto) → status connected, refs referenziati, contesto, sync fallisce in modo pulito, revoca
    from cryptography.fernet import Fernet
    f = Fernet(env["GOOGLE_DRIVE_TOKEN_KEY"].encode()) if env.get("GOOGLE_DRIVE_TOKEN_KEY") else None
    if f:
        now = datetime.now(timezone.utc)
        mdb.axon_integrations.update_one({"user_id": uid, "sphere": "home", "provider": "google"}, {"$set": {"user_id": uid, "sphere": "home", "provider": "google", "refresh_token_enc": f.encrypt(b"fake").decode(),
                                          "scopes": ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/contacts.readonly", "https://www.googleapis.com/auth/drive.file"], "google_email": "casa@example.com", "updated_at": now}, "$setOnInsert": {"created_at": now}}, upsert=True)
        mdb.axon_integration_refs.update_one({"user_id": uid, "sphere": "home", "provider": "google", "kind": "event", "external_id": "ev_test"}, {"$set": {"user_id": uid, "sphere": "home", "provider": "google", "kind": "event", "external_id": "ev_test", "summary": "Dentista", "start": (now.replace(microsecond=0)).isoformat().replace("+00:00", "Z"), "end": None, "all_day": False, "from_crm": False, "synced_at": now}}, upsert=True)
        st = httpx.get(f"{BASE}/axon/integrations/status", headers=h, timeout=30).json()
        home = {i["key"]: i for i in st["spheres"]["home"]["items"]}; biz = {i["key"]: i for i in st["spheres"]["business"]["items"]}
        ok &= check(home["google_calendar_home"]["connected"] and home["google_drive_home"]["connected"] and home["google_calendar_home"]["account"] == "casa@example.com" and not biz["google_calendar"]["connected"], "sfera Home collegata (Calendar+Contacts+Drive), Business NON toccata")
        ev = httpx.get(f"{BASE}/axon/integrations/home/events", headers=h, timeout=30).json()
        ok &= check(any(e["summary"] == "Dentista" for e in ev["items"]), "eventi Home referenziati leggibili")
        evb = httpx.get(f"{BASE}/axon/integrations/business/events", headers=h, timeout=30).json()
        ok &= check(evb["items"] == [], "eventi Business separati (vuoti)")
        sy = httpx.post(f"{BASE}/axon/integrations/home/sync", headers=h, timeout=60).json()
        ok &= check(sy["ok"] and sy["events"] == 0, f"sync con token finto fallisce in modo pulito: {sy}")
        sb = httpx.post(f"{BASE}/axon/integrations/business/sync", headers=h, timeout=30)
        ok &= check(sb.status_code == 404, "sync Business senza connessione → 404")
        rv = httpx.delete(f"{BASE}/axon/integrations/home/google", headers=h, timeout=30).json()
        st = httpx.get(f"{BASE}/axon/integrations/status", headers=h, timeout=30).json()
        ok &= check(rv["revoked"] and not [i for i in st["spheres"]["home"]["items"] if i["provider"] == "google" and i["connected"]] and mdb.axon_integration_refs.count_documents({"user_id": uid, "sphere": "home"}) == 0, "revoca un tap → connessione e riferimenti cancellati")
    else:
        print("⚠️ GOOGLE_TOKEN_KEY assente: salto la connessione simulata")

    print("\nRISULTATO:", "TUTTO OK ✅" if ok else "FALLITO ❌"); sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
