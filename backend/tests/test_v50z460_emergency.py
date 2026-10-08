"""V50.z460 — Prompt 22: emergenze + ricalcolo agenda. Esegui: cd /app/backend && python tests/test_v50z460_emergency.py"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
import zoneinfo

BASE = os.environ.get("BASE", "http://localhost:8001/api")
ROME = zoneinfo.ZoneInfo("Europe/Rome")


def call(method, path, body=None, token=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = r.read()
            return (r.status, data.decode() if raw else json.loads(data or b"{}"))
    except urllib.error.HTTPError as e:
        return (e.code, json.loads(e.read() or b"{}"))


def stream(tok, msg):
    _, raw = call("POST", "/assistant/chat/stream", {"message": msg, "session_id": None}, token=tok, raw=True)
    txt, slash = [], None
    for l in raw.splitlines():
        if l.startswith("data:"):
            try:
                d = json.loads(l[5:])
            except Exception:
                continue
            if "text" in d and "stage" not in d:
                txt.append(d["text"])
            if d.get("slash"):
                slash = d["slash"]
    return "".join(txt).strip(), slash


def main():
    ok = True
    tok = call("POST", "/auth/login", {"email": "test@dalpastro.it", "password": "Test1234!"})[1]["token"]
    _, contacts = call("GET", "/contacts", token=tok)
    items = contacts if isinstance(contacts, list) else contacts.get("items", [])
    mario = next(c for c in items if (c.get("first_name") or "").lower() == "mario")
    other = next(c for c in items if c["contact_id"] != mario["contact_id"])
    call("PUT", f"/contacts/{mario['contact_id']}", {"email": "mario.rossi.test@example.com"}, token=tok)
    call("PUT", f"/contacts/{other['contact_id']}", {"email": ""}, token=tok)

    # scenario: è un giorno lavorativo alle 10:00 (simulato: creo appuntamenti OGGI nel futuro + uno domani già occupato)
    now = datetime.now(ROME)
    # appuntamenti impattati: tra 1h e tra 3h da adesso (se oggi è weekend/sera i test usano comunque la finestra → fine giornata)
    a1 = (now + timedelta(hours=1)).replace(second=0, microsecond=0)
    a2 = (now + timedelta(hours=3)).replace(second=0, microsecond=0)
    # occupato domani 9:00-12:00 (così il primo slot libero di domani è dopo le 12 se oggi non c'è spazio)
    tomorrow = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    while tomorrow.weekday() >= 5:
        tomorrow += timedelta(days=1)
    created = []
    for title, start, dur, cid in [("Sopralluogo Mario", a1, 60, mario["contact_id"]), ("Firma contratto", a2, 60, other["contact_id"]), ("Riunione mattutina", tomorrow, 180, None)]:
        st, a = call("POST", "/appointments", {"title": title, "start_at": start.astimezone(timezone.utc).isoformat(), "end_at": (start + timedelta(minutes=dur)).astimezone(timezone.utc).isoformat(), "duration_min": dur, "contact_id": cid, "area": "energy"}, token=tok)
        assert st == 200, (st, a)
        created.append(a["appointment_id"])
    print("creati:", created, "ora:", now.strftime("%a %H:%M"))

    # ---- 1) imprevisto → piano con conferma unica
    r, slash = stream(tok, "Mi si è rotta la macchina, oggi salta tutto, non riesco ad arrivare")
    print("REPLY 1:\n" + r[:1600] + "\n")
    t1 = slash == "emergency_plan" and "Appuntamenti impattati: 2" in r and "[[ACTION:emergency_confirm|" in r and "Roadmap di oggi" in r and "Mario" in r
    print("PASS" if t1 else "FAIL", "1 piano: 2 impattati, slot proposti, roadmap, chip conferma unica")
    t1b = r.count("↳ «") == 2 and "email" in r and "WhatsApp" in r
    print("PASS" if t1b else "FAIL", "1b messaggi di scuse redatti per entrambi; canali email (Mario) e WhatsApp (altro)")
    ok &= t1 and t1b
    m = re.search(r"\[\[ACTION:emergency_confirm\|[^|]+\|(\{.*?\})\]\]", r)
    plan_id = json.loads(m.group(1))["plan_id"] if m else None

    # slot proposti: nel futuro, lun-ven 9-18, non sovrapposti all'appuntamento di domani 9-12
    from pymongo import MongoClient
    db = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))[os.environ.get("DB_NAME", "test_database")]
    plan = db.axon_emergency_plans.find_one({"plan_id": plan_id})
    slots = [it["new_start"].replace(tzinfo=timezone.utc).astimezone(ROME) for it in plan["items"]]
    t2 = all(s.weekday() < 5 and 9 <= s.hour < 18 and s > now for s in slots) and len({s for s in slots}) == 2
    busy_tmrw = (tomorrow, tomorrow + timedelta(hours=3))
    t2b = all(not (s < busy_tmrw[1] and busy_tmrw[0] < s + timedelta(minutes=60)) for s in slots)
    print("PASS" if t2 and t2b else "FAIL", "2 slot: futuri, lun-ven 9-18, distinti, non sovrapposti a «Riunione mattutina»:", [s.strftime("%a %d/%m %H:%M") for s in slots])
    ok &= t2 and t2b

    # ---- 3) nulla cambia prima della conferma
    _, appt = call("GET", f"/appointments/{created[0]}", token=tok)
    orig = appt.get("start_at") if appt else None
    t3 = plan["status"] == "proposed" and (not orig or abs((datetime.fromisoformat(str(orig).replace("Z", "+00:00")) - a1.astimezone(timezone.utc)).total_seconds()) < 120)
    print("PASS" if t3 else "FAIL", "3 prima della conferma: piano proposed, appuntamento invariato")
    ok &= t3

    # ---- 4) conferma via tap (chip)
    st, resp = call("POST", "/axon/nav/action", {"action": "emergency_confirm", "payload": {"plan_id": plan_id}}, token=tok)
    rep = resp.get("reply") or ""
    print("REPLY 4:\n" + rep[:900] + "\n")
    t4 = st == 200 and "email di scuse inviata a mario.rossi.test@example.com" in rep and "[[ACTION:open_whatsapp|" in rep and "spostato a" in rep
    print("PASS" if t4 else "FAIL", "4 conferma: appuntamenti spostati, email inviata a Mario, WhatsApp pronto per l'altro")
    a_new = db.appointments.find_one({"appointment_id": created[0]})
    t4b = a_new and a_new.get("rescheduled_by") == "axon_emergency" and a_new["start_at"].replace(tzinfo=timezone.utc) == plan["items"][0]["new_start"].replace(tzinfo=timezone.utc)
    print("PASS" if t4b else "FAIL", "4b DB: start_at = slot proposto, rescheduled_by=axon_emergency")
    note_ok = any(n.get("source") == "axon_emergency" for n in (db.contacts.find_one({"contact_id": mario["contact_id"]}) or {}).get("notes", []))
    print("PASS" if note_ok else "FAIL", "4c nota «rinviato» sulla scheda di Mario")
    st2, resp2 = call("POST", "/axon/nav/action", {"action": "emergency_confirm", "payload": {"plan_id": plan_id}}, token=tok)
    t4d = st2 == 200 and "Già fatto" in (resp2.get("reply") or "")
    print("PASS" if t4d else "FAIL", "4d doppio tap → idempotente")
    ok &= t4 and bool(t4b) and note_ok and t4d

    # ---- 5) cliente rifiuta → notifica prioritaria
    before = db.axon_notifications.count_documents({"user_id": plan["user_id"], "kind": "callback_urgent"})
    r5, slash5 = stream(tok, "Mario Rossi ha rifiutato il nuovo orario, dice che è urgente")
    print("REPLY 5:", r5[:300])
    after = db.axon_notifications.count_documents({"user_id": plan["user_id"], "kind": "callback_urgent"})
    last = db.axon_notifications.find_one({"user_id": plan["user_id"], "kind": "callback_urgent"}, sort=[("created_at", -1)])
    t5 = slash5 == "emergency_refusal" and "Notifica prioritaria" in r5 and after == before + 1 and "Mario" in (last or {}).get("title", "")
    print("PASS" if t5 else "FAIL", "5 rifiuto → push CRITICAL (kind callback_urgent) + avviso in chat:", (last or {}).get("title"))
    ok &= t5

    # ---- 6) nessun appuntamento impattato
    r6, slash6 = stream(tok, "Ho un'emergenza personale, sono bloccato fino a stasera")
    t6 = slash6 == "emergency_plan" and ("non hai appuntamenti" in r6.lower() or "Appuntamenti impattati" in r6)
    print("PASS" if t6 else "FAIL", "6 seconda emergenza (agenda di oggi ormai vuota) → risposta coerente:", r6[:120])
    ok &= t6

    # ---- 7) frase normale non intercettata
    r7, slash7 = stream(tok, "quanti clienti ho?")
    t7 = slash7 not in ("emergency_plan", "emergency_apply") and bool(r7)
    print("PASS" if t7 else "FAIL", "7 domanda normale non intercettata")
    ok &= t7

    # pulizia
    for aid in created:
        call("DELETE", f"/appointments/{aid}", token=tok)
    db.axon_emergency_plans.delete_many({"user_id": plan["user_id"]})
    call("PUT", f"/contacts/{mario['contact_id']}", {"email": ""}, token=tok)
    print("RESULT:", "ALL PASS" if ok else "SOME FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
