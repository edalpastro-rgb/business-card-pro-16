"""V50.z194 — test e2e dati importati (routes/axon_imported_data.py).
Uso: python tests/test_axon_imported_data.py  (backend su localhost:8001)."""
import base64, json, os, sys, time
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"

CSV = """Mese;PUN medio (EUR/MWh);F1;F2;F3
2026-01;118,45;131,20;122,10;104,30
2026-02;109,80;120,55;113,40;98,10
2026-03;101,25;112,90;104,70;90,15
2026-04;95,60;106,30;98,20;85,40
2026-05;92,10;103,80;95,10;82,60
2026-06;98,75;110,20;101,30;88,90
2026-07;107,30;119,60;110,80;95,20
2026-08;112,90;125,40;116,20;99,70
"""


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j.get("token")


def chat(tok, msg, attachments=None, session_id=None):
    out = {"text": "", "done": None, "meta": None}
    body = {"message": msg, "attachments": attachments or []}
    if session_id:
        body["session_id"] = session_id
    with httpx.stream("POST", f"{BASE}/assistant/chat/stream", json=body, headers={"Authorization": f"Bearer {tok}"}, timeout=180) as r:
        ev = None
        for line in r.iter_lines():
            if line.startswith("event:"):
                ev = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and ev:
                d = json.loads(line.split(":", 1)[1])
                if ev == "delta":
                    out["text"] += d.get("text", "")
                elif ev == "meta":
                    out["meta"] = d
                elif ev == "done":
                    out["done"] = d
                    break
                elif ev == "error":
                    out["text"] += f"[ERROR {d}]"
                    break
    return out


def check(cond, label):
    print(("✅" if cond else "❌"), label)
    return bool(cond)


def main():
    tok = login()
    h = {"Authorization": f"Bearer {tok}"}
    ok = True
    # pulizia categoria di test
    httpx.delete(f"{BASE}/axon/imported-data", headers=h, params={"categoria": "PUN"}, timeout=30)

    # 1) Upload CSV con dati strutturati → risposta deve chiudere con la domanda
    att = [{"name": "pun_2026.csv", "mime": "text/csv", "data_base64": base64.b64encode(CSV.encode()).decode()}]
    c = chat(tok, "Dammi una lettura rapida di questo andamento del PUN", attachments=att)
    sid = (c["done"] or {}).get("session_id") or (c["meta"] or {}).get("session_id")
    ok &= check("memorizzi questi dati" in c["text"].lower(), f"risposta con domanda di memorizzazione (len {len(c['text'])})")
    time.sleep(2)
    lst = httpx.get(f"{BASE}/axon/imported-data", headers=h, timeout=30).json()
    pend = lst.get("pending")
    ok &= check(pend and pend["status"] in ("extracting", "ready"), f"pending creato: {pend and pend['status']} · fonte {pend and pend.get('fonte')}")

    # 2) «no» generico su domanda diversa NON deve essere intercettato (ultima risposta contiene la domanda → qui SÌ intercetta: test del NO)
    # → prima verifichiamo il percorso NO con una seconda pending? Manteniamo semplice: conferma con pulsante rapido.
    c2 = chat(tok, "Sì, memorizza i dati", session_id=sid)
    ok &= check((c2["done"] or {}).get("slash") == "import_saved", f"conferma → {c2['text'][:110]!r}")
    lst = httpx.get(f"{BASE}/axon/imported-data", headers=h, timeout=30).json()
    ok &= check(lst["total"] >= 8, f"axon_imported_data: {lst['total']} valori · categorie {[c['categoria'] for c in lst['categories']]}")
    ok &= check(any(i.get("data", "").startswith("2026-08") and abs(float(i["valore"]) - 112.9) < 0.01 or abs(float(i["valore"]) - 112.9) < 0.01 for i in lst["items"]), "valore agosto 112,90 presente")
    cat = lst["items"][0]["categoria"]

    # 3) Conversazione NUOVA senza file: Axon deve usare i dati memorizzati
    c3 = chat(tok, f"Senza ricaricare file: qual è il PUN medio di agosto 2026 che hai memorizzato? Rispondi solo con il numero e l'unità.")
    ok &= check("112" in c3["text"], f"contesto iniettato → {c3['text'][:120]!r}")

    # 4) Comando lista
    c4 = chat(tok, "quali dati hai memorizzato?")
    ok &= check((c4["done"] or {}).get("slash") == "import_list" and cat in c4["text"], f"lista → {c4['text'][:100]!r}")

    # 5) «sì» generico SENZA domanda pendente nell'ultima risposta → NON intercettato (passa alla LLM / altri comandi)
    c5 = chat(tok, "sì")
    ok &= check((c5["done"] or {}).get("slash") not in ("import_saved", "import_declined", "import_empty"), f"«sì» fuori contesto non intercettato (slash={(c5['done'] or {}).get('slash')})")

    # 6) API modifica / cancella
    it = lst["items"][0]
    u = httpx.put(f"{BASE}/axon/imported-data/{it['item_id']}", headers=h, json={"valore": 999.5, "unita": "€/MWh"}, timeout=30).json()
    ok &= check(u["ok"] and u["item"]["valore"] == 999.5, "PUT valore")
    d = httpx.delete(f"{BASE}/axon/imported-data/{it['item_id']}", headers=h, timeout=30).json()
    ok &= check(d["ok"], "DELETE singolo")
    a = httpx.post(f"{BASE}/axon/imported-data", headers=h, json={"categoria": "Tariffe", "etichetta": "Spread test", "valore": 0.012, "unita": "€/kWh", "data": "2026-09"}, timeout=30).json()
    ok &= check(a["ok"], "POST manuale")
    db_ = httpx.delete(f"{BASE}/axon/imported-data", headers=h, params={"categoria": "Tariffe"}, timeout=30).json()
    ok &= check(db_["deleted"] >= 1, "DELETE categoria")

    # 7) Percorso NO: nuovo upload + rifiuto
    c6 = chat(tok, "Analizza", attachments=att)
    ok &= check("memorizzi questi dati" in c6["text"].lower(), "2° upload → domanda ripetuta")
    c7 = chat(tok, "No, non memorizzare i dati", session_id=(c6["done"] or {}).get("session_id"))
    ok &= check((c7["done"] or {}).get("slash") == "import_declined", f"rifiuto → {c7['text'][:80]!r}")

    print("\nRISULTATO:", "TUTTO OK ✅" if ok else "FALLITO ❌")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
