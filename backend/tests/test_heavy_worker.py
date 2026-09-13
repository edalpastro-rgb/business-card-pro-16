"""V50.z210 — test e2e worker pesante: scanner + PDF fuori dal processo API, RSS piatta. Uso: python tests/test_heavy_worker.py"""
import base64, io, os, subprocess, time
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30); r.raise_for_status()
    j = r.json(); return j.get("access_token") or j.get("token")


def _api_pid() -> str:
    """PID del processo API vero: uvicorn 8001 gira con --reload, il lavoro lo fa il figlio (RSS più alta tra padre e figli)."""
    return subprocess.run(["bash", "-c", "p=$(pgrep -f 'uvicorn server:app.*8001' | head -1); for x in $p $(pgrep -P $p); do echo \"$(ps -o rss= -p $x) $x\"; done | sort -rn | head -1 | awk '{print $2}'"], capture_output=True, text=True).stdout.strip()


def uvicorn_rss_mb() -> float:
    pid = _api_pid()
    out = subprocess.run(["ps", "-o", "rss=", "-p", pid], capture_output=True, text=True).stdout.strip() if pid else ""
    return round(int(out) / 1024, 1) if out else -1


def api_loaded_heavy_libs() -> list:
    """Verifica dal /proc del processo API che cv2/fitz/pdfplumber NON siano mappati."""
    pid = _api_pid()
    out = subprocess.run(["bash", "-c", f"cat /proc/{pid}/maps 2>/dev/null | grep -oE 'cv2|fitz|pymupdf|pdfplumber|pdfium|numpy' | sort -u"], capture_output=True, text=True).stdout.split()
    return out


def make_doc_photo() -> bytes:
    """Foto sintetica: sfondo scuro + «foglio» bianco ruotato, con righe di testo. Generata nel worker per non caricare PIL qui."""
    code = ("import io,sys;from PIL import Image,ImageDraw;im=Image.new('RGB',(900,1200),(40,40,45));d=ImageDraw.Draw(im);"
            "d.polygon([(150,140),(760,170),(730,1060),(120,1030)],fill=(245,245,240));"
            "[d.rectangle([220,260+i*70,650,270+i*70],fill=(60,60,60)) for i in range(9)];b=io.BytesIO();im.save(b,'JPEG',quality=90);sys.stdout.buffer.write(b.getvalue())")
    return subprocess.run(["python", "-c", code], capture_output=True).stdout


def make_pdf() -> bytes:
    code = ("import io,sys;import pymupdf as fitz;d=fitz.open();p=d.new_page();p.insert_text((72,72),'Agosto 2026 PUN F1 174,52 F2 204,35 F3 171,72');"
            "p.insert_text((72,100),'Documento di prova AdvisorOS');sys.stdout.buffer.write(d.tobytes())")
    return subprocess.run(["python", "-c", code], capture_output=True).stdout


def main():
    t = login(); h = {"Authorization": f"Bearer {t}"}; ok = 0
    # warm-up: la PRIMA chat carica lo stack LLM (litellm/tokenizers, ~130 MB una tantum, voluto): la baseline si misura dopo
    httpx.post(f"{BASE}/assistant/chat", json={"message": "Rispondi solo: ok"}, headers=h, timeout=120)
    rss0 = uvicorn_rss_mb(); print(f"RSS uvicorn iniziale: {rss0} MB · lib pesanti mappate: {api_loaded_heavy_libs() or 'nessuna'}")
    photo = make_doc_photo(); pdf = make_pdf(); assert photo[:2] == b"\xff\xd8" and pdf[:4] == b"%PDF"
    b64 = base64.b64encode(photo).decode()

    for i in range(3):   # esercizio ripetuto → la RSS deve restare piatta
        t0 = time.time(); r = httpx.post(f"{BASE}/scanner/detect-corners", json={"data_base64": b64}, headers=h, timeout=120).json()
        assert "detected" in r and "sharpness" in r; dt1 = time.time() - t0
        r = httpx.post(f"{BASE}/scanner/autocrop-preview", json={"data_base64": b64, "enhance": True}, headers=h, timeout=120).json()
        assert r["data_base64"] and base64.b64decode(r["data_base64"])[:2] == b"\xff\xd8"
        r = httpx.post(f"{BASE}/scanner/manual-crop", json={"data_base64": b64, "corners": [[0.15, 0.12], [0.85, 0.14], [0.82, 0.88], [0.13, 0.86]]}, headers=h, timeout=120).json()
        assert r["width"] > 100 and r["height"] > 100
        r = httpx.post(f"{BASE}/scanner/merge-pdf", json={"pages": [{"data_base64": b64, "mime": "image/jpeg"}, {"data_base64": base64.b64encode(pdf).decode(), "mime": "application/pdf"}], "name": "Test worker"}, headers=h, timeout=300).json()
        assert r["page_count"] == 2 and base64.b64decode(r["pdf_base64"])[:4] == b"%PDF", r.get("detail")
        print(f"  giro {i + 1}: scanner ok (detect {dt1 * 1000:.0f} ms, detected={r.get('detected', '-')}) · RSS {uvicorn_rss_mb()} MB")
    ok += 4
    # errore controllato: area troppo piccola → 400
    r = httpx.post(f"{BASE}/scanner/manual-crop", json={"data_base64": b64, "corners": [[0.5, 0.5], [0.501, 0.5], [0.501, 0.501], [0.5, 0.501]]}, headers=h, timeout=60)
    assert r.status_code == 400, r.text; ok += 1; print("5 manual-crop area piccola → 400")
    # PDF in chat (allegato) → testo estratto dal worker → l'assistente lo vede
    r = httpx.post(f"{BASE}/assistant/chat", json={"message": "Riporta ESATTAMENTE la prima riga del PDF allegato, senza commenti.",
                                                   "attachments": [{"name": "prova.pdf", "mime": "application/pdf", "data_base64": base64.b64encode(pdf).decode()}]}, headers=h, timeout=120)
    txt = (r.json().get("reply") or r.json().get("content") or "") if r.status_code == 200 else r.text
    assert "174,52" in txt, txt[:200]; ok += 1; print("6 PDF allegato in chat → testo letto dal worker:", txt[:60].replace("\n", " "))
    # PDF via bridge sync (percorso _extract_pdf_text_bytes usato da GME/Drive): refresh forzato di 24 PDF
    r = httpx.post(f"{BASE}/quick-action/pun/refresh?force=true", headers=h, timeout=300).json(); assert r["missing"] == [] and len(r["added"]) >= 20; ok += 1
    print(f"7 24 PDF GME riparsati via worker sync: {len(r['added'])} ok")
    rss1 = uvicorn_rss_mb(); libs = api_loaded_heavy_libs()
    print(f"RSS uvicorn finale: {rss1} MB (Δ {rss1 - rss0:+.1f} MB) · lib pesanti mappate nel processo API: {libs or 'nessuna'}")
    assert not any(x in ("cv2", "fitz", "pymupdf", "pdfplumber", "pdfium") for x in libs), libs; ok += 1
    assert rss1 - rss0 < 40, "RSS cresciuta troppo"; ok += 1
    print(f"\nTUTTO OK — {ok}/9")


if __name__ == "__main__":
    main()
