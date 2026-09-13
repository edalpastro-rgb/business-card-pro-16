"""V50.z202 — test upload multipart a chunk (routes/axon_uploads.py). Uso: python tests/test_axon_uploads.py
File ~15 MB su Master Files + trascrizione di un audio ~2 minuti (TTS OpenAI → Whisper)."""
import asyncio, base64, io, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from test_axon_media import login, check, BASE  # noqa: E402
import httpx
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')


def big_pdf(mb: float) -> bytes:
    """PDF valido con payload casuale incomprimibile (~mb MB)."""
    from reportlab.pdfgen import canvas
    b = io.BytesIO(); c = canvas.Canvas(b); c.drawString(50, 800, "AdvisorOS test file grande"); c.showPage(); c.save()
    pdf = b.getvalue()
    return pdf + b"\n%" + os.urandom(int(mb * 1024 * 1024))


async def two_minutes_speech() -> bytes:
    from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech
    tts = OpenAITextToSpeech(api_key=os.environ["EMERGENT_LLM_KEY"])
    frase = ("Buongiorno, sono il consulente energetico di AdvisorOS. Oggi analizziamo la bolletta della luce del signor Rossi, "
             "con un consumo annuo di tremila e cinquecento chilowattora e un prezzo dell'energia di zero virgola dodici euro al chilowattora. "
             "Confrontiamo l'offerta attuale con la proposta a prezzo fisso per dodici mesi e calcoliamo il risparmio stimato. ")
    parts = await asyncio.gather(*[tts.generate_speech_base64(text=frase * 3, model="tts-1", voice="nova", response_format="mp3") for _ in range(3)])
    return b"".join(base64.b64decode(p) for p in parts)   # mp3 concatenati (~2 min)


def main():
    tok = login(); h = {"Authorization": f"Bearer {tok}"}; ok = True
    # 1) Master file ~15 MB multipart
    data = big_pdf(15)
    t = time.time()
    r = httpx.post(f"{BASE}/master-files/upload", headers=h, timeout=180, files={"file": ("grande-15mb.pdf", data, "application/pdf")}, data={"category": "files"})
    ok &= check(r.status_code == 200, f"upload 15 MB multipart → {r.status_code} in {time.time() - t:.1f}s {r.text[:100] if r.status_code != 200 else ''}")
    d = r.json() if r.status_code == 200 else {}
    ok &= check(d.get("storage") == "object" and d.get("storage_path") and "data_base64" not in d and d.get("size") == len(data) and len(d.get("sha256", "")) == 64, f"riferimento in Mongo: storage={d.get('storage')} size={d.get('size')} sha={d.get('sha256', '')[:10]}")
    fid = d.get("file_id")
    # 2) contenuto via /content (header) e ?token=
    c = httpx.get(f"{BASE}/master-files/{fid}/content", headers=h, timeout=120)
    c2 = httpx.get(f"{BASE}/master-files/{fid}/content", params={"token": tok}, timeout=120)
    ok &= check(c.status_code == 200 and c.content == data and c2.status_code == 200, f"download contenuto identico ({len(c.content)} byte) header+token")
    lst = httpx.get(f"{BASE}/master-files", headers=h, params={"category": "files"}, timeout=30).json()
    ok &= check(any(i["file_id"] == fid and "data_base64" not in i for i in lst["items"]), "in elenco senza contenuto inline")
    g = httpx.get(f"{BASE}/master-files/{fid}", headers=h, timeout=120).json()
    ok &= check(g.get("content_url") and base64.b64decode(g.get("data_base64", ""))[:5] == b"%PDF-", "GET singolo: content_url + data_base64 lazy (compatibilità viewer)")
    # 3) limite 50 MB
    r = httpx.post(f"{BASE}/master-files/upload", headers=h, timeout=300, files={"file": ("troppo.bin", os.urandom(51 * 1024 * 1024), "application/octet-stream")}, data={"category": "files"})
    ok &= check(r.status_code == 413, f"limite 50 MB → {r.status_code}")
    # 4) legacy JSON base64 → non più inline
    r = httpx.post(f"{BASE}/master-files", headers=h, timeout=60, json={"category": "bills", "name": "legacy.pdf", "mime": "application/pdf", "data_base64": base64.b64encode(big_pdf(0.2)).decode()})
    ok &= check(r.status_code == 200 and r.json().get("storage") == "object", f"endpoint JSON legacy → storage {r.json().get('storage')}")
    fid2 = r.json().get("file_id")
    # 5) trascrizione multipart ~2 minuti
    audio = asyncio.run(two_minutes_speech())
    t = time.time()
    r = httpx.post(f"{BASE}/ai/transcribe/upload", headers=h, timeout=300, files={"file": ("nota.mp3", audio, "audio/mpeg")}, data={"mime": "audio/mpeg"})
    tr = r.json().get("transcript", "") if r.status_code == 200 else r.text
    ok &= check(r.status_code == 200 and "Rossi" in tr and len(tr) > 600, f"trascrizione {round(len(audio) / 1024)} KB in {time.time() - t:.1f}s → {len(tr)} caratteri: {tr[:90]!r}")
    r = httpx.post(f"{BASE}/ai/transcribe/upload", headers=h, timeout=60, files={"file": ("x.mp3", b"abc", "audio/mpeg")})
    ok &= check(r.status_code == 400, f"audio vuoto → {r.status_code}")
    for f in (fid, fid2):
        if f: httpx.delete(f"{BASE}/master-files/{f}", headers=h, timeout=30)
    print("\nRISULTATO:", "TUTTO OK" if ok else "CI SONO ERRORI")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
