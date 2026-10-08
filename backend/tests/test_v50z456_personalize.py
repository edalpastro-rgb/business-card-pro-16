"""V50.z456 — «Personalizza Axon»: GET/PUT /axon/personalize, permessi (Super Master / Lite), sezione nel prompt, E2E tono.
Esegui: cd /app/backend && python tests/test_v50z456_personalize.py
"""
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
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            return (r.status, data.decode() if raw else json.loads(data or b"{}"))
    except urllib.error.HTTPError as e:
        return (e.code, json.loads(e.read() or b"{}"))


def login(email, pwd):
    return call("POST", "/auth/login", {"email": email, "password": pwd})[1]["token"]


def stream_reply(tok, msg):
    _, raw = call("POST", "/assistant/chat/stream", {"message": msg, "session_id": None}, token=tok, raw=True)
    out = []
    for l in raw.splitlines():
        if l.startswith("data:"):
            try:
                d = json.loads(l[5:])
            except Exception:
                continue
            if "text" in d and "stage" not in d:
                out.append(d["text"])
    return "".join(out).strip()


def main():
    ok = True
    # ---- unit: testo sezione + inserimento prima del footer di onestà
    src = open(os.path.join(os.path.dirname(__file__), "..", "routes", "axon_personalize.py"), encoding="utf-8").read()
    ns = {}
    exec(src[: src.index("async def _axon_personalize_section")].replace("from typing import Optional as _ap_Optional", "from typing import Optional as _ap_Optional"), ns)
    txt = ns["_axon_personalize_text"]("coach", "disinibito")
    u1 = "<PERSONALIZZAZIONE_AXON" in txt and "PERSONALITÀ: Coach" in txt and "STILE LINGUISTICO: Disinibito" in txt and "REGOLE_ASSOLUTE" in txt
    print("PASS" if u1 else "FAIL", "U1 testo sezione (coach + disinibito) contiene entrambi i selettori e il richiamo alle regole assolute")
    u2 = ns["_axon_personalize_text"](None, None) == "" and "PERSONALITÀ" in ns["_axon_personalize_text"]("monaco", None) and "STILE" not in ns["_axon_personalize_text"]("monaco", None)
    print("PASS" if u2 else "FAIL", "U2 nessuna scelta → sezione vuota; solo personalità → solo PERSONALITÀ")
    u3 = len(ns["AXON_PERSONALITIES"]) == 6 and len(ns["AXON_STYLES"]) == 6
    print("PASS" if u3 else "FAIL", "U3 6 personalità + 6 stili")
    ok &= u1 and u2 and u3

    # ---- API Super Master (test@dalpastro.it è super_admin)
    tok = login("test@dalpastro.it", "Test1234!")
    st, g = call("GET", "/axon/personalize", token=tok)
    a1 = st == 200 and g["allowed"] is True and [p["key"] for p in g["personalities"]] == ["saggio", "coach", "professore", "monaco", "amico", "direttore"] \
        and [p["key"] for p in g["styles"]] == ["formale", "colloquiale", "diretto", "tecnico", "colorito", "disinibito"]
    print("PASS" if a1 else "FAIL", "A1 GET /axon/personalize Super Master → allowed, 6+6 opzioni nell'ordine richiesto")
    saved = (g.get("personality"), g.get("style"))
    st, p = call("PUT", "/axon/personalize", {"personality": "amico", "style": "colorito"}, token=tok)
    a2 = st == 200 and p["personality"] == "amico" and p["style"] == "colorito"
    print("PASS" if a2 else "FAIL", "A2 PUT amico + colorito salvato:", st, p.get("personality"), p.get("style"))
    st, g2 = call("GET", "/axon/personalize", token=tok)
    a3 = g2["personality"] == "amico" and g2["style"] == "colorito"
    print("PASS" if a3 else "FAIL", "A3 GET dopo PUT → persistito nel profilo")
    st, bad = call("PUT", "/axon/personalize", {"personality": "pirata"}, token=tok)
    a4 = st == 422
    print("PASS" if a4 else "FAIL", "A4 PUT personalità non valida → 422:", st)
    _, us = call("GET", "/user-settings", token=tok)
    a5 = us.get("axon_personality") == "amico" and us.get("axon_style") == "colorito"
    print("PASS" if a5 else "FAIL", "A5 salvato in user_settings (axon_personality/axon_style)")
    ok &= a1 and a2 and a3 and a4 and a5

    # ---- E2E: tono Amico + Colorito → usa il nome (Test / Test Owner) o emoji/esclamazioni; dato secco resta tale
    r = stream_reply(tok, "Come posso organizzare meglio la settimana con i miei clienti?")
    lower = r.lower()
    e1 = bool(r) and ("test" in lower or "!" in r or re.search(r"[\U0001F300-\U0001FAFF]", r))
    print("PASS" if e1 else "FAIL", "E1 risposta Amico+Colorito (nome/emoji/esclamazione):", repr(r[:220]))
    r2 = stream_reply(tok, "qual è il numero di telefono di Mario Rossi?")
    e2 = re.sub(r"\D", "", r2).endswith("3479876543") and len(r2.splitlines()) <= 2
    print("PASS" if e2 else "FAIL", "E2 dato secco (telefono) NON alterato dalla personalità:", repr(r2))
    ok &= e1 and e2

    # ---- altro account (sub-user, advisor, non super): isolato e non autorizzato
    tok2 = login("sub1@dalpastro.it", "Sub12345!")
    st, g3 = call("GET", "/axon/personalize", token=tok2)
    i1 = st == 200 and g3["allowed"] is False and g3["personality"] is None
    print("PASS" if i1 else "FAIL", "I1 sub-user (advisor, non Super Master) → allowed=false, nessuna scelta ereditata")
    st, _ = call("PUT", "/axon/personalize", {"personality": "coach"}, token=tok2)
    i2 = st == 403
    print("PASS" if i2 else "FAIL", "I2 PUT da account non autorizzato → 403:", st)
    ok &= i1 and i2

    # ripristino
    call("PUT", "/axon/personalize", {"personality": saved[0], "style": saved[1]}, token=tok)
    print("RESULT:", "ALL PASS" if ok else "SOME FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
