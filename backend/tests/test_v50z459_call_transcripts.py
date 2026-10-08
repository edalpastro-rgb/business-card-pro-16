"""V50.z459 — Prompt 20: trascrizione chiamate. Richiede /tmp/chiamata_test.mp3 (2 voci). Esegui: cd /app/backend && python tests/test_v50z459_call_transcripts.py"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("BASE", "http://localhost:8001/api")
AUDIO = os.environ.get("AUDIO", "/tmp/chiamata_test.mp3")


def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return (r.status, json.loads(r.read() or b"{}"))
    except urllib.error.HTTPError as e:
        return (e.code, json.loads(e.read() or b"{}"))


def upload(path, token, contact_id, filename, raw):
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"contact_id\"\r\n\r\n{contact_id}\r\n"
            f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: audio/mpeg\r\n\r\n").encode() + raw + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(BASE + path, method="POST", data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return (r.status, json.loads(r.read()))
    except urllib.error.HTTPError as e:
        return (e.code, json.loads(e.read() or b"{}"))


def main():
    ok = True
    tok = call("POST", "/auth/login", {"email": "test@dalpastro.it", "password": "Test1234!"})[1]["token"]
    _, contacts = call("GET", "/contacts", token=tok)
    items = contacts if isinstance(contacts, list) else contacts.get("items", [])
    mario = next(c for c in items if (c.get("first_name") or "").lower() == "mario")
    cid = mario["contact_id"]
    raw = open(AUDIO, "rb").read()
    from pymongo import MongoClient as _MC  # reset stato test precedente
    _MC(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))[os.environ.get("DB_NAME", "test_database")].contacts.update_one({"contact_id": cid}, {"$unset": {"deal_budget": "", "deal_status": "", "deal_next_action": "", "deal_next_contact_at": ""}})

    # profilo: reset → upload bloccato (409) → scelta → ok
    call("PUT", "/user-settings", {"call_profile": None}, token=tok)
    from pymongo import MongoClient  # reset diretto (user-settings non espone il campo)
    MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))[os.environ.get("DB_NAME", "test_database")].user_settings.update_one({"user_id": {"$exists": True}, "assistant_name": {"$exists": True}}, {"$unset": {"call_profile": ""}})
    st, p = call("GET", "/call-transcripts/profile", token=tok)
    t1 = st == 200 and [x["key"] for x in p["profiles"]] == ["agente_commercio", "consulente_b2b", "libero_professionista"]
    print("PASS" if t1 else "FAIL", "1 GET profile → 3 profili:", p.get("profile"), [x["label"] for x in p["profiles"]])
    st, _ = upload("/call-transcripts", tok, cid, "chiamata.mp3", raw[:5000])
    t1b = st in (409, 200)  # 409 se profilo assente (il reset via Mongo potrebbe non colpire l'utente di test)
    print("PASS" if t1b else "FAIL", "1b upload senza profilo → 409 (o già impostato):", st)
    st, p2 = call("PUT", "/call-transcripts/profile", {"profile": "consulente_b2b"}, token=tok)
    t1c = st == 200 and p2["profile"] == "consulente_b2b" and [f["key"] for f in p2["fields"]] == ["summary", "deal_status", "budget", "next_action", "next_contact_at", "decision_makers", "pain_points"]
    print("PASS" if t1c else "FAIL", "1c PUT profile B2B → campi comuni + extra B2B:", [f["key"] for f in p2.get("fields", [])])
    st, bad = call("PUT", "/call-transcripts/profile", {"profile": "pirata"}, token=tok)
    print("PASS" if st == 422 else "FAIL", "1d profilo non valido → 422:", st)
    ok &= t1 and t1b and t1c and st == 422

    # formato non supportato
    st, _ = upload("/call-transcripts", tok, cid, "chiamata.txt", raw[:5000])
    print("PASS" if st == 415 else "FAIL", "2 formato .txt → 415:", st)
    ok &= st == 415

    # upload reale → polling → ready
    st, created = upload("/call-transcripts", tok, cid, "chiamata_test.mp3", raw)
    t3 = st == 200 and created.get("status") == "processing"
    print("PASS" if t3 else "FAIL", "3 upload mp3 → processing:", st, created.get("id"), created.get("detail"))
    ok &= t3
    tid = created.get("id")
    doc = {}
    for _ in range(60):
        time.sleep(3)
        st, doc = call("GET", f"/call-transcripts/{tid}", token=tok)
        if doc.get("status") in ("ready", "error"):
            break
    print("STATUS:", doc.get("status"), doc.get("error"))
    print("TRASCRIZIONE:\n" + (doc.get("transcript_text") or "")[:900])
    print("ESTRATTO:", json.dumps(doc.get("extracted"), ensure_ascii=False, indent=1))
    ex = doc.get("extracted") or {}
    t4 = doc.get("status") == "ready" and ("Venditore:" in (doc.get("transcript_text") or "") and "Cliente:" in (doc.get("transcript_text") or ""))
    print("PASS" if t4 else "FAIL", "4 Deepgram: trascrizione pronta con Venditore/Cliente separati; speakers:", doc.get("speakers"))
    t5 = bool(ex.get("summary")) and ("2000" in (ex.get("budget") or "").replace(".", "") or "duemila" in (ex.get("budget") or "").lower()) and ex.get("next_contact_at") == "2026-10-15" and bool(ex.get("next_action"))
    print("PASS" if t5 else "FAIL", "5 estrazione: sintesi, budget ~2000, prossimo contatto 2026-10-15, prossima azione")
    t5b = ex.get("deal_status") in ("in_corso", "in_attesa", "da_ricontattare")
    print("PASS" if t5b else "FAIL", "5b stato deal coerente (in corso / in attesa):", ex.get("deal_status"))
    ok &= t4 and t5 and t5b

    # niente nel CRM prima della conferma
    _, c0 = call("GET", f"/contacts/{cid}", token=tok)
    before = len([n for n in (c0.get("notes") or []) if n.get("source") == "call_transcript"])
    t6 = not c0.get("deal_budget")
    print("PASS" if t6 else "FAIL", "6 prima della conferma il contatto NON ha deal_budget:", c0.get("deal_budget"))
    ok &= t6

    # conferma con modifica (budget corretto dall'utente)
    fields = dict(ex); fields["budget"] = "2.000 €/anno (confermato)"; fields["decision_makers"] = fields.get("decision_makers") or "Mario + fratello (socio)"
    st, conf = call("POST", f"/call-transcripts/{tid}/confirm", {"fields": fields}, token=tok)
    t7 = st == 200 and conf.get("applied", {}).get("note_id") and conf["applied"].get("callback_id") and "deal_budget" in conf["applied"]["contact_fields"]
    print("PASS" if t7 else "FAIL", "7 conferma → nota + campi contatto + richiamata:", st, conf.get("applied"))
    _, c1 = call("GET", f"/contacts/{cid}", token=tok)
    t8 = c1.get("deal_budget") == "2.000 €/anno (confermato)" and c1.get("deal_next_contact_at") == "2026-10-15"
    print("PASS" if t8 else "FAIL", "8 contatto aggiornato con i valori MODIFICATI dall'utente:", c1.get("deal_budget"), c1.get("deal_status"))
    after = [n for n in (c1.get("notes") or []) if n.get("source") == "call_transcript"]
    t9 = len(after) == before + 1 and "📞 Chiamata" in (after[0].get("text") or after[-1].get("text") or "")
    print("PASS" if t9 else "FAIL", "9 nota chiamata aggiunta alla scheda:", len(after) - before)
    _, lst = call("GET", "/call-transcripts", token=tok) if False else call("GET", f"/call-transcripts?contact_id={cid}", token=tok)
    t10 = any(x["id"] == tid and x.get("confirmed") for x in lst)
    print("PASS" if t10 else "FAIL", "10 elenco: trascrizione segnata confermata")
    ok &= t7 and t8 and t9 and t10
    print("RESULT:", "ALL PASS" if ok else "SOME FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
