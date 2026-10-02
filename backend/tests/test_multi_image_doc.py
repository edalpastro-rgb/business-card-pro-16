"""V50.z438 — Foto multiple → unico riepilogo. Esegui: python tests/test_multi_image_doc.py"""
import base64, io, json, os, sys, time
import httpx
from PIL import Image, ImageDraw

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def page_png(lines):
    img = Image.new("RGB", (700, 400), "white")
    d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        d.text((30, 30 + i * 40), l, fill="black")
    buf = io.BytesIO(); img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def main():
    with httpx.Client(timeout=180) as c:
        r = c.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}); r.raise_for_status()
        tok = r.json()["token"] if "token" in r.json() else r.json().get("access_token")
        h = {"Authorization": f"Bearer {tok}"}
        atts = [
            {"name": "pagina_1.png", "mime": "image/png", "data_base64": page_png(["FATTURA ENERGIA N. 2026/0451", "Intestatario: Mario Rossi", "POD: IT001E12345678", "Periodo: 01/04/2026 - 30/04/2026"])},
            {"name": "pagina_2.png", "mime": "image/png", "data_base64": page_png(["Dettaglio consumi: 320 kWh", "Spesa materia energia: 58,40 EUR", "Totale da pagare: 97,15 EUR", "Scadenza: 15/06/2026"])},
        ]
        t0 = time.time()
        r = c.post(f"{BASE}/assistant/chat", json={"message": "", "attachments": atts, "merge_images": True, "no_cache": True}, headers=h)
        print("status", r.status_code, f"{time.time()-t0:.1f}s")
        body = r.json()
        reply = body.get("reply") or body.get("content") or json.dumps(body)[:2000]
        print(reply[:1800])
        low = reply.lower()
        ok = r.status_code == 200 and ("97,15" in reply or "97.15" in reply) and ("rossi" in low or "pod" in low)
        print("\nRESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
