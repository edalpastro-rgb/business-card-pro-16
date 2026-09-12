"""V50.z199 — test e2e Blocco 8 Fase 3 (routes/axon_media.py). Uso: python tests/test_axon_media.py"""
import base64, io, os, time
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30); r.raise_for_status()
    j = r.json(); return j.get("access_token") or j.get("token")


def photo_png() -> str:
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (480, 320), "white"); d = ImageDraw.Draw(img)
    d.rectangle((20, 20, 460, 300), outline="black", width=3)
    for i, ln in enumerate(["CONTATORE GAS", "Matricola 00123456", "Lettura 04521 mc", "Cliente: Rossi Mario"]):
        d.text((40, 50 + i * 50), ln, fill="black")
    b = io.BytesIO(); img.save(b, format="PNG"); return base64.b64encode(b.getvalue()).decode()


def audio_wav() -> str:
    """WAV sintetico 1.5 s (tono): Whisper non riconosce parlato → status ready con 'Nessun parlato'."""
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


def check(c, label):
    print(("✅" if c else "❌"), label); return bool(c)


def wait_ready(h, mid, secs=90):
    for _ in range(secs // 3):
        d = httpx.get(f"{BASE}/axon/media/{mid}", headers=h, timeout=30).json()
        if d.get("status") != "processing":
            return d
        time.sleep(3)
    return d


def main():
    tok = login(); h = {"Authorization": f"Bearer {tok}"}; ok = True
    # 1) foto senza sfera → ask_sphere
    r = httpx.post(f"{BASE}/axon/media", headers=h, timeout=60, json={"kind": "photo", "data_base64": photo_png(), "mime": "image/png", "name": "IMG_001.png"})
    ok &= check(r.status_code == 200 and r.json()["ask_sphere"] is True and r.json()["media"]["sphere"] == "unclassified", f"upload foto → {r.status_code} ask_sphere={r.json().get('ask_sphere')}")
    pid = r.json()["media"]["media_id"]
    # 2) elaborazione background foto (Gemini vision)
    d = wait_ready(h, pid)
    ok &= check(d["status"] == "ready" and (d.get("description") or d.get("ocr_text")), f"foto elaborata: title={d.get('title')!r} tags={d.get('tags')} ocr={bool(d.get('ocr_text'))} sugg={d.get('suggested_sphere')}")
    # 3) ricerca full-text prima della classificazione (sfera unclassified)
    s = httpx.get(f"{BASE}/axon/media", headers=h, timeout=30, params={"sphere": "unclassified", "q": "contatore"}).json()
    ok &= check(any(i["media_id"] == pid for i in s["items"]), f"ricerca 'contatore' in Non classificato → {len(s['items'])} risultati")
    # 4) classificazione → business; sparisce da unclassified, appare in business, non in home
    u = httpx.put(f"{BASE}/axon/media/{pid}", headers=h, timeout=30, json={"sphere": "business"}).json()
    ok &= check(u["media"]["sphere"] == "business" and "reply" in u["media"], f"classifica → business: {u['media'].get('reply')}")
    b = httpx.get(f"{BASE}/axon/media", headers=h, timeout=30, params={"sphere": "business"}).json()
    hm = httpx.get(f"{BASE}/axon/media", headers=h, timeout=30, params={"sphere": "home"}).json()
    un = httpx.get(f"{BASE}/axon/media", headers=h, timeout=30, params={"sphere": "unclassified"}).json()
    ok &= check(any(i["media_id"] == pid for i in b["items"]) and not any(i["media_id"] == pid for i in hm["items"]) and not any(i["media_id"] == pid for i in un["items"]), f"sfere separate (counts={b['counts']})")
    # 5) file originale (header + token)
    f = httpx.get(f"{BASE}/axon/media/{pid}/file", headers=h, timeout=30)
    f2 = httpx.get(f"{BASE}/axon/media/{pid}/file", params={"token": tok}, timeout=30)
    ok &= check(f.status_code == 200 and f.headers.get("content-type", "").startswith("image") and f2.status_code == 200, f"file: {f.status_code}/{f2.status_code} {f.headers.get('content-type')}")
    # 6) audio con sfera home → nessuna domanda; Whisper + status
    r = httpx.post(f"{BASE}/axon/media", headers=h, timeout=60, json={"kind": "audio", "data_base64": audio_wav(), "mime": "audio/wav", "name": "nota.wav", "sphere": "home", "duration_sec": 1.5})
    ok &= check(r.status_code == 200 and r.json().get("ask_sphere") is False and r.json().get("media", {}).get("sphere") == "home", f"upload audio home → {r.status_code} ask_sphere={r.json().get('ask_sphere')} {r.text[:120] if r.status_code != 200 else ''}")
    aid = r.json()["media"]["media_id"]
    d = wait_ready(h, aid)
    ok &= check(d["status"] in ("ready", "error"), f"audio elaborato: status={d['status']} transcript={(d.get('transcript') or '')[:40]!r} summary={(d.get('summary') or d.get('error') or '')[:60]!r}")
    # 7) chat: classificazione rapida dell'ultimo non classificato + ricerca
    r = httpx.post(f"{BASE}/axon/media", headers=h, timeout=60, json={"kind": "photo", "data_base64": photo_png(), "mime": "image/png", "name": "IMG_002.png"})
    pid2 = r.json()["media"]["media_id"]
    rep = chat(h, "privata")
    d2 = httpx.get(f"{BASE}/axon/media/{pid2}", headers=h, timeout=30).json()
    ok &= check(d2["sphere"] == "home", f"chat «privata» → ultimo elemento classificato home ({rep[:90]!r})")
    rep = chat(h, "cerca nelle foto aziendali contatore")
    ok &= check("Archivio media" in rep and "🔵" in rep, f"chat ricerca foto business → {rep[:100]!r}")
    # 8) hub integrazioni: card in entrambe le sfere
    st = httpx.get(f"{BASE}/axon/integrations/status", headers=h, timeout=30).json()
    keys_b = [i["key"] for i in st["spheres"]["business"]["items"]]; keys_h = [i["key"] for i in st["spheres"]["home"]["items"]]
    ok &= check("media_archive" in keys_b and "media_archive_home" in keys_h, "card Archivio media in Business e Home")
    # 9) reprocess + delete
    rp = httpx.post(f"{BASE}/axon/media/{aid}/reprocess", headers=h, timeout=30)
    ok &= check(rp.status_code == 200, "reprocess audio")
    wait_ready(h, aid)
    for mid in (pid, aid, pid2):
        httpx.delete(f"{BASE}/axon/media/{mid}", headers=h, timeout=30)
    g = httpx.get(f"{BASE}/axon/media/{pid}", headers=h, timeout=30)
    ok &= check(g.status_code == 404, "delete → 404")
    # 10) validazioni
    bad = httpx.post(f"{BASE}/axon/media", headers=h, timeout=30, json={"kind": "doc", "data_base64": "QUJD"})
    ok &= check(bad.status_code == 400, f"kind non valido → {bad.status_code}")
    print("\nRISULTATO:", "TUTTO OK" if ok else "CI SONO ERRORI")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
