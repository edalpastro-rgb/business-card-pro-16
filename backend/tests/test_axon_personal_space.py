"""V50.z205 — test e2e Blocco 8 Fase 4 (routes/axon_personal_space.py). Uso: python tests/test_axon_personal_space.py"""
import base64, io, os, time
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30); r.raise_for_status()
    j = r.json(); return j.get("access_token") or j.get("token")


def audio_wav() -> str:
    import math, struct, wave
    b = io.BytesIO(); w = wave.open(b, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    frames = b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(24000))
    w.writeframes(frames); w.close(); return base64.b64encode(b.getvalue()).decode()


def chat(h, message: str) -> str:
    import json
    text = ""; ev = None
    with httpx.stream("POST", f"{BASE}/assistant/chat/stream", json={"message": message}, headers=h, timeout=90) as s:
        for line in s.iter_lines():
            if line.startswith("event:"): ev = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and ev:
                d = json.loads(line.split(":", 1)[1])
                if ev == "delta": text += d.get("text", "")
                elif ev == "done": break
    return text


def main():
    t = login(); h = {"Authorization": f"Bearer {t}"}; ok = 0

    # 1) riepilogo
    s = httpx.get(f"{BASE}/axon/personal-space/summary", headers=h, timeout=30); s.raise_for_status(); s = s.json()
    assert s["sphere"]["key"] == "home" and "audios" in s and "memory" in s; ok += 1; print("1 summary ok", {k: s[k] for k in ("web_links", "audios", "memory")})

    # 2) audio personale → trascrizione automatica (hook) + sfera
    r = httpx.post(f"{BASE}/audio-records", json={"target_type": "personal", "audio_base64": audio_wav(), "mime": "audio/wav", "duration_sec": 1.5, "title": "Test pspace"}, headers=h, timeout=60); r.raise_for_status()
    aid = r.json()["audio_id"]; assert r.json().get("sphere") == "unclassified" and r.json().get("transcribe_status") == "pending"; ok += 1; print("2 audio creato", aid)
    st = None
    for _ in range(40):
        lst = httpx.get(f"{BASE}/audio-records?target_type=personal", headers=h, timeout=30).json()["items"]
        me = next(i for i in lst if i["audio_id"] == aid); st = me.get("transcribe_status")
        if st in ("ready", "error"): break
        time.sleep(2)
    assert st == "ready", st; assert me.get("summary"); ok += 1; print("3 trascrizione automatica ok:", me.get("summary"))
    r = httpx.put(f"{BASE}/audio-records/{aid}/sphere", json={"sphere": "home"}, headers=h, timeout=30); r.raise_for_status(); assert r.json()["sphere"] == "home"; ok += 1
    lst = httpx.get(f"{BASE}/audio-records?target_type=personal&sphere=home", headers=h, timeout=30).json()["items"]
    assert any(i["audio_id"] == aid for i in lst); ok += 1; print("4-5 sfera + filtro ok")
    f = httpx.get(f"{BASE}/audio-records/{aid}/file?token={t}", timeout=30); assert f.status_code == 200 and len(f.content) > 1000; ok += 1; print("6 file bytes ok", len(f.content))
    r = httpx.post(f"{BASE}/audio-records/{aid}/transcribe", headers=h, timeout=30); r.raise_for_status(); ok += 1; print("7 retranscribe ok")
    time.sleep(1)
    httpx.delete(f"{BASE}/audio-records/{aid}", headers=h, timeout=30)

    # 3) memoria: tag sfera su ogni voce + override
    m = httpx.get(f"{BASE}/axon/memory", headers=h, timeout=90).json()
    items = [i for sec in m["sections"] for i in sec["items"]]
    assert items and all(i.get("sphere") in ("business", "home") for i in items); ok += 1; print("8 tutte le voci hanno sphere", len(items))
    r = httpx.post(f"{BASE}/axon/memory", json={"section": "stile_lavoro", "text": "TEST pspace: la domenica non lavoro, sto in famiglia", "sphere": "home"}, headers=h, timeout=30); r.raise_for_status()
    it = r.json(); assert it["sphere"] == "home"; ok += 1
    r = httpx.put(f"{BASE}/axon/memory/{it['id']}/sphere", json={"sphere": "business"}, headers=h, timeout=30); r.raise_for_status(); assert r.json()["sphere"] == "business"; ok += 1; print("9-10 add con sfera + toggle ok")
    r = httpx.put(f"{BASE}/axon/memory/{it['id']}/sphere", json={"sphere": "unclassified"}, headers=h, timeout=30); assert r.status_code == 400; ok += 1
    httpx.delete(f"{BASE}/axon/memory/{it['id']}", headers=h, timeout=30)
    # analyze → voci nuove taggate
    httpx.post(f"{BASE}/axon/memory/analyze", headers=h, timeout=120)
    m = httpx.get(f"{BASE}/axon/memory", headers=h, timeout=90).json()
    items = [i for sec in m["sections"] for i in sec["items"]]
    assert all(i.get("sphere") in ("business", "home") for i in items); ok += 1; print("11-12 analyze mantiene i tag")

    # 4) integrazioni: card Spazio Personale in sfera Home
    st = httpx.get(f"{BASE}/axon/integrations/status", headers=h, timeout=30).json()
    assert any(i["key"] == "personal_space" and i["manage_route"] == "/spazio-personale" for i in st["spheres"]["home"]["items"]); ok += 1; print("13 card integrazioni ok")

    # 5) chat
    txt = chat(h, "cosa c'è nel mio spazio personale?")
    assert "Spazio Personale" in txt and "My Web" in txt, txt[:200]; ok += 1; print("14 chat ok:", txt[:120].replace("\n", " | "))
    print(f"\nTUTTO OK — {ok}/14")


if __name__ == "__main__":
    main()
