"""V50.z461 — Prompt 23: onboarding tracking. Esegui: cd /app/backend && set -a && . ./.env && set +a && python tests/test_v50z461_onboarding.py"""
import asyncio
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("BASE", "http://localhost:8001/api")


def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return (r.status, json.loads(r.read() or b"{}"))
    except urllib.error.HTTPError as e:
        return (e.code, json.loads(e.read() or b"{}"))


def main():
    ok = True
    from pymongo import MongoClient
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    tok = call("POST", "/auth/login", {"email": "test@dalpastro.it", "password": "Test1234!"})[1]["token"]
    tok_sub = call("POST", "/auth/login", {"email": "sub1@dalpastro.it", "password": "Sub12345!"})[1]["token"]

    # utenti sintetici: A registrato 4 gg fa senza nulla (→ 1° sollecito), B registrato 8 gg fa con profilo ma senza anagrafica (→ 1° + 2°), C completo
    now = datetime.now(timezone.utc)
    owner = db.users.find_one({"email": "test@dalpastro.it"})
    tid = owner["user_id"]
    synth = [("user_ob_test_a", "delivered+oba@resend.dev", "Anna Test", now - timedelta(days=4)), ("user_ob_test_b", "delivered+obb@resend.dev", "Bruno Test", now - timedelta(days=8)), ("user_ob_test_c", "delivered+obc@resend.dev", "Carla Test", now - timedelta(days=10))]
    for uid, em, nm, reg in synth:
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": em, "name": nm, "parent_user_id": tid, "role": "member", "created_at": reg, "password_hash": "x"}}, upsert=True)
        db.onboarding_progress.delete_one({"user_id": uid}); db.user_settings.delete_one({"user_id": uid}); db.master_profiles.delete_one({"user_id": uid})
        db.contacts.delete_many({"created_by": uid})
    db.user_settings.insert_one({"user_id": "user_ob_test_b", "tour_profile": {"text": "Vendo energia", "features": ["pun"], "at": (now - timedelta(days=7)).isoformat()}})
    db.user_settings.insert_one({"user_id": "user_ob_test_c", "tour_profile": {"text": "B2B", "features": [], "at": (now - timedelta(days=9)).isoformat()}})
    db.master_profiles.insert_one({"user_id": "user_ob_test_c", "first_name": "Carla", "last_name": "Test", "phone": "3331234567", "updated_at": now - timedelta(days=9)})
    db.contacts.insert_one({"contact_id": "c_ob_test_c", "user_id": tid, "created_by": "user_ob_test_c", "first_name": "Cliente", "last_name": "Uno", "status": "prospect", "created_at": now - timedelta(days=8), "updated_at": now})

    # 1) permessi
    st, _ = call("GET", "/admin/onboarding", token=tok_sub)
    print("PASS" if st == 403 else "FAIL", "1 sub-user → 403 su /admin/onboarding:", st)
    ok &= st == 403

    # 2) ricalcolo + job (refresh=1 esegue sync + solleciti)
    st, data = call("GET", "/admin/onboarding?refresh=1", token=tok)
    rows = {r["user_id"]: r for r in data.get("items", [])}
    a, b, c = rows.get("user_ob_test_a"), rows.get("user_ob_test_b"), rows.get("user_ob_test_c")
    t2 = st == 200 and a and b and c and [x["key"] for x in data["checkpoints"]] == ["profile", "anagrafica", "first_contact"]
    print("PASS" if t2 else "FAIL", "2 GET /admin/onboarding (super-admin) → 3 checkpoint, utenti presenti:", st, bool(a), bool(b), bool(c))
    ok &= bool(t2)
    if not t2:
        print(json.dumps(data, ensure_ascii=False)[:500]); sys.exit(1)
    t3 = a["done_count"] == 0 and a["next_missing"] == "profile" and not a["completed"]
    print("PASS" if t3 else "FAIL", "3 A: 0/3, fermo a «profilo»")
    t4 = b["checkpoints"]["profile"]["done"] and b["checkpoints"]["profile"]["done_at"] and not b["checkpoints"]["anagrafica"]["done"] and b["next_missing"] == "anagrafica"
    print("PASS" if t4 else "FAIL", "4 B: profilo fatto con data/ora, fermo ad «anagrafica»:", b["checkpoints"]["profile"]["done_at"])
    t5 = c["completed"] and c["done_count"] == 3 and c["completed_at"] and c["checkpoints"]["first_contact"]["done_at"]
    print("PASS" if t5 else "FAIL", "5 C: 3/3 completo con completed_at:", c["completed_at"])
    ok &= bool(t3 and t4 and t5)

    # 6) solleciti: A → 1° (link /tour), B → 1° (link /anagrafica-master) + 2°, C → nessuno; idempotenti al secondo giro
    t6 = a["reminders"].get("first", {}).get("checkpoint") == "profile" and "second" not in a["reminders"]
    print("PASS" if t6 else "FAIL", "6 A (4 gg): 1° sollecito su profilo, nessun 2°:", a["reminders"])
    t7 = b["reminders"].get("first", {}).get("checkpoint") == "anagrafica" and b["reminders"].get("second", {}).get("sent_at")
    print("PASS" if t7 else "FAIL", "7 B (8 gg, senza anagrafica): 1° + 2° sollecito:", list(b["reminders"].keys()))
    t8 = not c["reminders"]
    print("PASS" if t8 else "FAIL", "8 C completo: nessun sollecito")
    ok &= bool(t6 and t7 and t8)
    sent_before = data["stats"]["reminders_sent"]
    st, data2 = call("GET", "/admin/onboarding?refresh=1", token=tok)
    t9 = data2["stats"]["reminders_sent"] == sent_before
    print("PASS" if t9 else "FAIL", "9 secondo ricalcolo → nessuna email duplicata:", sent_before, data2["stats"]["reminders_sent"])
    ok &= t9

    # 10) stats + /onboarding/me del titolare
    t10 = data2["stats"]["by_checkpoint"]["profile"] >= 2 and data2["rules"] == {"first_reminder_days": 3, "second_reminder_days": 7}
    print("PASS" if t10 else "FAIL", "10 stats per checkpoint + regole 3/7 gg:", data2["stats"]["by_checkpoint"], data2["rules"])
    st, me = call("GET", "/onboarding/me", token=tok)
    t11 = st == 200 and "checkpoints" in me and me["user_id"] == tid
    print("PASS" if t11 else "FAIL", "11 /onboarding/me del titolare:", me.get("done_count"), me.get("next_missing"))
    ok &= bool(t10 and t11)

    # pulizia
    for uid, *_ in synth:
        db.users.delete_one({"user_id": uid}); db.onboarding_progress.delete_one({"user_id": uid}); db.user_settings.delete_one({"user_id": uid}); db.master_profiles.delete_one({"user_id": uid})
    db.contacts.delete_many({"contact_id": "c_ob_test_c"})
    print("RESULT:", "ALL PASS" if ok else "SOME FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
