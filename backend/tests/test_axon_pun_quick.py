"""V50.z206 — test e2e calcolatore PUN (routes/axon_pun_quick.py). Uso: python tests/test_axon_pun_quick.py"""
import json, os, time
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30); r.raise_for_status()
    j = r.json(); return j.get("access_token") or j.get("token")


def chat(h, message: str, quick_label: str = None) -> str:
    text = ""; ev = None; body = {"message": message}
    if quick_label: body["quick_label"] = quick_label
    with httpx.stream("POST", f"{BASE}/assistant/chat/stream", json=body, headers=h, timeout=90) as s:
        for line in s.iter_lines():
            if line.startswith("event:"): ev = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and ev:
                d = json.loads(line.split(":", 1)[1])
                if ev == "delta": text += d.get("text", "")
                elif ev == "done": break
    return text


def main():
    t = login(); h = {"Authorization": f"Bearer {t}"}; ok = 0
    # 1) endpoint pronto, veloce
    t0 = time.time(); j = httpx.get(f"{BASE}/quick-action/pun-18", headers=h, timeout=30).json(); dt = time.time() - t0
    assert dt < 0.5 and j["months"] == 18 and len(j["rows"]) == 18, dt; ok += 1; print(f"1 GET pun-18 in {dt*1000:.0f} ms, disponibili {j['available']}/18, mancanti {j['missing']}")
    md = j["table_markdown"]; assert "🔴" in md and "🟢" in md and "| Mese |" in md; ok += 1
    ago = [r for r in j["rows"] if r["month_key"] == "2026-08"][0]
    assert ago["kwh"]["F1"] == 0.17452 and ago["kwh"]["F2"] == 0.20435 and ago["kwh"]["F3"] == 0.17172, ago["kwh"]; ok += 1; print("2-3 markdown + valori Agosto 2026 = PDF GME (174,52 / 204,35 / 171,72)")
    # 2) azione rapida POST → deterministica (nessun LLM), anche con prompt "libero" dell'utente
    prompt = "Accedi ai dati gme e alla tua memoria estrai i dati aggiornati con lettura pdf tutti i pun medi per fascia degli ultimi 12 mesi, evidenziato in rosso i PUN piu alti"
    t0 = time.time(); r = httpx.post(f"{BASE}/axon/quick-action", json={"label": "PUN MEDIO PER FASCE 2026", "prompt": prompt}, headers=h, timeout=30).json(); dt = time.time() - t0
    assert r.get("deterministic") and "ultimi 12 mesi" in r["reply"] and dt < 1.0, (dt, r.get("reply", "")[:100]); ok += 1; print(f"4 POST /axon/quick-action deterministico in {dt*1000:.0f} ms (12 mesi dal prompt)")
    r = httpx.post(f"{BASE}/axon/quick-action", json={"label": "PUN 18 mesi", "prompt": "Tabella PUN", "cache_only": True}, headers=h, timeout=30).json()
    assert r.get("deterministic") and "ultimi 18 mesi" in r["reply"]; ok += 1; print("5 cache_only → tabella subito (nessun miss)")
    # 3) streaming SSE con quick_label (prompt arricchito) e frase libera in chat
    t0 = time.time(); txt = chat(h, prompt, quick_label="PUN MEDIO PER FASCE 2026"); dt = time.time() - t0
    assert "PUN medio per fasce" in txt and "0,204350" in txt, txt[:200]; ok += 1; print(f"6 SSE quick_label → tabella in {dt:.1f}s")
    txt = chat(h, "dammi la tabella pun ultimi 6 mesi")
    assert "ultimi 6 mesi" in txt and txt.count("| ") > 6; ok += 1; print("7 chat libera «tabella pun ultimi 6 mesi» ok")
    # 4) non intercettare domande concettuali
    from_hook = httpx.post(f"{BASE}/axon/quick-action", json={"label": "Spiegazione", "prompt": "spiega cos'è il PUN in bolletta", "cache_only": True}, headers=h, timeout=30).json()
    assert not from_hook.get("deterministic"); ok += 1; print("8 «spiega cos'è il PUN» NON intercettato")
    # 5) Master: inserimento manuale + refresh
    r = httpx.put(f"{BASE}/quick-action/pun/2019-01", json={"F1": 70.1, "F2": 68.2, "F3": 60.3, "F1_hours": 250, "F2_hours": 180, "F3_hours": 314}, headers=h, timeout=30); r.raise_for_status()
    assert abs(r.json()["monorario"] - ((70.1*250+68.2*180+60.3*314)/744)) < 1e-4; ok += 1; print("9 PUT manuale con ore → monorario ponderato")
    txt = chat(h, "inserisci pun gennaio 2019 f1 0,0701 f2 0,0682 f3 0,0603")
    assert "salvato in cache" in txt and "€/kWh" in txt; ok += 1; print("10 chat inserimento manuale ok")
    txt = chat(h, "aggiorna cache pun")
    assert "Cache PUN aggiornata" in txt; ok += 1; print("11 chat refresh ok:", txt[:90])
    r = httpx.post(f"{BASE}/quick-action/pun/refresh", headers=h, timeout=120).json(); assert r["checked"] == 24 and r["missing"] == []; ok += 1; print("12 refresh API: 24/24 mesi in cache")
    print(f"\nTUTTO OK — {ok}/12")


if __name__ == "__main__":
    main()
