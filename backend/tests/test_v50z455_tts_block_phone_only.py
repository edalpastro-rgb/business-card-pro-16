"""V50.z455 — (1) «Solo testo» blocca il TTS lato server; (2) richiesta di un numero di telefono → risposta = solo il numero.
Esegui: cd /app/backend && python tests/test_v50z455_tts_block_phone_only.py
"""
import json
import os
import sys
import urllib.request

BASE = os.environ.get("BASE", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def call(method, path, body=None, token=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        return data.decode() if raw else json.loads(data or b"{}")


def main():
    ok = True
    tok = call("POST", "/auth/login", {"email": EMAIL, "password": PWD})["token"]
    saved = call("GET", "/user-settings", token=tok).get("assistant_response_mode")

    # ---- (1) TTS bloccato in Solo testo
    call("PUT", "/user-settings", {"assistant_response_mode": "text"}, token=tok)
    r = call("POST", "/assistant/tts", {"text": "Ci sto pensando"}, token=tok)
    t1 = r.get("audio_base64") == "" and r.get("muted") is True
    print(("PASS" if t1 else "FAIL"), "1a /assistant/tts in Solo testo → nessun audio:", {k: r.get(k) for k in ("engine", "muted", "reason")})
    r2 = call("POST", "/ai/tts", {"text": "Ciao"}, token=tok)
    t1b = r2.get("audio_base64") == "" and r2.get("muted") is True
    print(("PASS" if t1b else "FAIL"), "1b /ai/tts in Solo testo → nessun audio")
    r3 = call("POST", "/assistant/tts", {"text": "Prova voce", "force": True}, token=tok)
    t1c = bool(r3.get("audio_base64"))
    print(("PASS" if t1c else "FAIL"), "1c /assistant/tts force=true (test voce Impostazioni) → audio generato:", r3.get("engine"), len(r3.get("audio_base64") or ""))
    call("PUT", "/user-settings", {"assistant_response_mode": "both"}, token=tok)
    r4 = call("POST", "/assistant/tts", {"text": "Prova voce"}, token=tok)
    t1d = bool(r4.get("audio_base64"))
    print(("PASS" if t1d else "FAIL"), "1d /assistant/tts in Voce+Testo → audio generato:", r4.get("engine"))
    ok &= t1 and t1b and t1c and t1d

    # ---- (2) numero di telefono → solo il numero (unit sulla funzione + E2E streaming)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import re as _wx_re  # noqa: F401
    from typing import List, Optional  # noqa: F401
    src = open(os.path.join(os.path.dirname(__file__), "..", "routes", "19_axon_assistant_core.py"), encoding="utf-8").read()
    start = src.index("_RX_PHONE_REQUEST ="); end = src.index("# ============", src.index("def _axon_phone_only_reply"))
    ns = {"_wx_re": _wx_re, "List": List, "Optional": Optional}
    exec(src[start:end].replace("await db.user_settings", "db.user_settings"), ns)
    fn = ns["_axon_phone_only_reply"]
    reply = "Il numero di telefono di Mario Rossi è **+39 335 123 4567**.\n\nFonte: scheda CRM 🌐 https://x.it\n[[NAV:/contact/1|Apri scheda]]\nVuoi che lo chiami?"
    t2a = fn("qual è il numero di telefono di Mario Rossi?", reply) == "+39 335 123 4567"
    print(("PASS" if t2a else "FAIL"), "2a numero richiesto → solo il numero:", repr(fn("qual è il numero di telefono di Mario Rossi?", reply)))
    t2b = fn("qual è il numero di telefono di Mario Rossi?", "Non ho il numero di Mario Rossi nel CRM.") is None
    print(("PASS" if t2b else "FAIL"), "2b numero richiesto ma assente → None (risposta invariata)")
    t2c = fn("scrivimi una mail per Mario", "Chiamami al 02 1234567") is None
    print(("PASS" if t2c else "FAIL"), "2c nessuna richiesta di telefono → None")
    t2d = fn("cellulare di Enel?", "Servizio clienti Enel: 800 900 860 (numero verde) oppure 02 9999 9999 dall'estero. Fonte: enel.it") == "800 900 860\n02 9999 9999"
    print(("PASS" if t2d else "FAIL"), "2d più numeri → uno per riga, niente fonti:", repr(fn("cellulare di Enel?", "Servizio clienti Enel: 800 900 860 (numero verde) oppure 02 9999 9999 dall'estero. Fonte: enel.it")))
    ok &= t2a and t2b and t2c and t2d

    # E2E: streaming con un contatto reale del CRM
    contacts = call("GET", "/contacts", token=tok)
    cs = [c for c in (contacts if isinstance(contacts, list) else contacts.get("items", [])) if (c.get("phone") or c.get("mobile"))]
    if cs:
        c = cs[0]
        name = f"{c.get('first_name', '')} {c.get('last_name', '')}".strip() or c.get("company") or c.get("name")
        raw = call("POST", "/assistant/chat/stream", {"message": f"qual è il numero di telefono di {name}?", "session_id": None}, token=tok, raw=True)
        deltas = "".join(json.loads(l[5:]).get("text", "") for l in raw.splitlines() if l.startswith("data:") and '"text"' in l)
        done = [json.loads(l[5:]) for l in raw.splitlines() if l.startswith("data:") and '"message_id"' in l]
        digits = _wx_re.sub(r"\D", "", deltas)
        exp = _wx_re.sub(r"\D", "", (c.get("phone") or c.get("mobile") or ""))
        t2e = len(deltas.splitlines()) <= 3 and "http" not in deltas.lower() and "fonte" not in deltas.lower() and (not done or not done[0].get("web_sources"))
        print(("PASS" if t2e else "FAIL"), f"2e E2E stream «numero di telefono di {name}» → risposta: {deltas!r} (atteso contiene {exp[-6:] if exp else '?'}; web_sources={done[0].get('web_sources') if done else None})")
        ok &= t2e
    else:
        print("SKIP 2e — nessun contatto con telefono nel CRM di test")

    call("PUT", "/user-settings", {"assistant_response_mode": saved or "text"}, token=tok)
    print("RESULT:", "ALL PASS" if ok else "SOME FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
