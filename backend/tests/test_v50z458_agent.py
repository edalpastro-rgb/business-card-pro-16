"""V50.z458 — Prompt 19: agente multi-step. Esegui: cd /app/backend && python tests/test_v50z458_agent.py"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("BASE", "http://localhost:8001/api")


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
        if not l.startswith("data:"):
            continue
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
    # contatto di prova con telefono+email
    _, contacts = call("GET", "/contacts", token=tok)
    items = contacts if isinstance(contacts, list) else contacts.get("items", [])
    mario = next((c for c in items if (c.get("first_name") or "").lower() == "mario" and (c.get("last_name") or "").lower() == "rossi"), None)
    assert mario, "Mario Rossi mancante nel CRM di test"
    cid = mario["contact_id"]
    call("PUT", f"/contacts/{cid}", {"status": "prospect", "email": "mario.rossi.test@example.com"}, token=tok)

    # ---- 1) comando complesso completo (3 azioni)
    r, slash = stream(tok, "Chiudi la trattativa con Mario Rossi, mandagli il preventivo via email e crea un promemoria per richiamarlo tra 30 giorni")
    print("REPLY 1:\n" + r[:900] + "\n")
    t1 = slash == "agent_run" and "3 azioni su 3" in r and r.count("✅") == 3 and "[[ACTION:send_email|" in r
    print("PASS" if t1 else "FAIL", "1 piano 3/3 eseguito con chip email")
    _, c = call("GET", f"/contacts/{cid}", token=tok)
    t1b = c.get("status") == "client"
    print("PASS" if t1b else "FAIL", "1b stato contatto → client:", c.get("status"))
    _, cbs = call("GET", "/callbacks", token=tok)
    cbs_l = cbs if isinstance(cbs, list) else cbs.get("items", [])
    mine = [x for x in cbs_l if x.get("contact_id") == cid and not x.get("done")]
    t1c = len(mine) >= 1
    print("PASS" if t1c else "FAIL", "1c richiamata creata per Mario:", [(x.get("title"), str(x.get("scheduled_at"))[:16]) for x in mine][:2])
    ok &= t1 and t1b and t1c

    # ---- 2) tap «Invia email» → Resend
    m = re.search(r"\[\[ACTION:send_email\|[^|]+\|(\{.*?\})\]\]", r, re.S)
    payload = json.loads(m.group(1)) if m else {}
    st, resp = call("POST", "/axon/nav/action", {"action": "send_email", "payload": payload}, token=tok)
    t2 = st == 200 and "inviata" in (resp.get("reply") or "").lower()
    print("PASS" if t2 else "FAIL", "2 tap Invia email →", st, (resp.get("reply") or resp.get("detail") or "")[:120])
    ok &= t2

    # ---- 3) fallimento → stop + «come procedo?» → «salta» riprende
    call("PUT", f"/contacts/{cid}", {"email": ""}, token=tok)
    r3, slash3 = stream(tok, "Fissa un appuntamento con Mario Rossi domani alle 15 in ufficio, poi mandagli una email di conferma e infine ricordami di preparare la pratica dopodomani alle 9")
    print("REPLY 3:\n" + r3[:900] + "\n")
    t3 = slash3 == "agent_run" and "Mi sono fermato all'azione 2 di 3" in r3 and "❌" in r3 and "⏸️" in r3 and "Come procedo?" in r3
    print("PASS" if t3 else "FAIL", "3 stop al passo 2 (email mancante) con domanda")
    r4, slash4 = stream(tok, "salta")
    print("REPLY 4:\n" + r4[:600] + "\n")
    t4 = slash4 == "agent_skip" and "⏭️" in r4 and r4.count("✅") == 2 and "Come procedo" not in r4
    print("PASS" if t4 else "FAIL", "4 «salta» → passo 3 eseguito, riepilogo finale")
    ok &= t3 and t4

    # ---- 5) WhatsApp chip + messaggio singolo NON intercettato
    r5, slash5 = stream(tok, "Manda un whatsapp a Mario Rossi per ringraziarlo dell'incontro e sposta l'appuntamento con lui a dopodomani alle 16")
    print("REPLY 5:\n" + r5[:700] + "\n")
    t5 = slash5 == "agent_run" and "[[ACTION:open_whatsapp|" in r5 and "wa.me/393479876543" in r5 and "spostato" in r5.lower()
    print("PASS" if t5 else "FAIL", "5 chip WhatsApp (wa.me precompilato) + appuntamento spostato")
    r6, slash6 = stream(tok, "quanti clienti ho?")
    t6 = slash6 not in ("agent_run", "agent_skip") and bool(r6)
    print("PASS" if t6 else "FAIL", "6 domanda semplice → NON intercettata dall'agente:", repr(r6[:60]))
    ok &= t5 and t6

    # ---- 7) voce hands-free: stesso agente
    st, v = call("POST", "/voice/copilot/execute", {"transcript": "segna Mario Rossi come cliente e crea un promemoria per richiamarlo tra 7 giorni", "want_audio": False}, token=tok)
    t7 = st == 200 and v.get("intent") == "agent" and "[[" not in (v.get("spoken") or "") and "✅" in (v.get("spoken") or "")
    print("PASS" if t7 else "FAIL", "7 voce → intent agent, riepilogo parlato senza marker:", st, (v.get("spoken") or v.get("detail") or "")[:160])
    ok &= t7

    # pulizia
    call("PUT", f"/contacts/{cid}", {"status": "prospect", "email": ""}, token=tok)
    print("RESULT:", "ALL PASS" if ok else "SOME FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
