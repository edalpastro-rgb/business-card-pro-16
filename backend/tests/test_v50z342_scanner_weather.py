"""V50.z342 — Test backend per:
- POST /api/scanner/process-page (crop/enhance + compressione ≤500KB + OCR)
- POST /api/scanner/merge-pdf con pagine already_processed / raw (watermark + testo estraibile)
- POST /api/files/pdf-pages (paginazione progressiva)
- POST /api/weather/forecast (cache 30 min) + /api/weather/alerts
- Regressione /scanner/autocrop-preview e /scanner/detect-corners
"""
import base64
import io
import os
import time

import pytest
import requests
from PIL import Image, ImageDraw, ImageFont

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"
FONT_PATH = "/usr/share/fonts/truetype/freefont/FreeSans.ttf"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login {r.status_code}: {r.text}"
    j = r.json()
    assert "token" in j, f"expected `token` field, got: {list(j.keys())}"
    return j["token"]


@pytest.fixture(scope="module")
def api(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def _make_large_page_b64(idx: int = 1) -> str:
    """JPEG 2400x3200 con testo di grandi dimensioni (font 54px)."""
    im = Image.new("RGB", (2400, 3200), "white")
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(FONT_PATH, 54)
    lines = [
        f"DOCUMENTO DI TEST V50.z342 PAGINA {idx}",
        "AdvisorOS Scanner Backend Test",
        "Linea 3 con numeri 12345 67890",
        "Fattura energia elettrica cliente demo",
        "Importo totale 123.45 EUR data 15/01/2026",
        "Consumo 250 kWh periodo dicembre 2025",
        "Riga di testo aggiuntiva per OCR robusto",
    ]
    y = 200
    for line in lines:
        d.text((150, y), line, fill="black", font=font)
        y += 120
    # extra text
    font2 = ImageFont.truetype(FONT_PATH, 44)
    for i in range(15):
        d.text((150, y), f"Linea supplementare numero {i} testo esteso per riempire pagina", fill="black", font=font2)
        y += 90
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(scope="module")
def processed_page(api):
    """Chiama process-page una volta e riusa il risultato."""
    b64 = _make_large_page_b64(1)
    r = api.post(f"{BASE_URL}/api/scanner/process-page",
                 json={"data_base64": b64, "mime": "image/jpeg", "autocrop": False, "enhance": True, "ocr": True},
                 timeout=180)
    assert r.status_code == 200, f"process-page {r.status_code}: {r.text[:400]}"
    return r.json()


# ================================================================ SCANNER
class TestScannerProcessPage:
    def test_process_page_size_and_ocr(self, processed_page):
        j = processed_page
        assert "data_base64" in j and j["data_base64"]
        assert j["mime"] == "image/jpeg"
        assert isinstance(j.get("width"), int) and j["width"] > 0
        assert isinstance(j.get("height"), int) and j["height"] > 0
        assert isinstance(j.get("size"), int)
        assert j["size"] <= 512000, f"page size {j['size']} > 500KB"
        # verifica JPEG effettivo
        raw = base64.b64decode(j["data_base64"])
        assert len(raw) == j["size"]
        im = Image.open(io.BytesIO(raw))
        assert im.format == "JPEG"
        # OCR presente
        ocr = j.get("ocr")
        assert isinstance(ocr, dict), f"ocr non è un dict: {ocr}"
        assert isinstance(ocr.get("text"), str) and len(ocr["text"].strip()) > 0, f"ocr.text vuoto: {ocr!r}"
        assert isinstance(ocr.get("lines"), list) and len(ocr["lines"]) > 0
        assert "conf" in ocr


class TestScannerMergePdf9AlreadyProcessed:
    def test_merge_9_pages(self, api, processed_page):
        pages = [{
            "data_base64": processed_page["data_base64"],
            "mime": "image/jpeg",
            "already_processed": True,
            "ocr": processed_page["ocr"],
        } for _ in range(9)]
        t0 = time.time()
        r = api.post(f"{BASE_URL}/api/scanner/merge-pdf",
                     json={"pages": pages, "name": "Test9", "ocr": True, "enhance": True, "autocrop": False},
                     timeout=60)
        elapsed = time.time() - t0
        assert r.status_code == 200, f"merge {r.status_code}: {r.text[:400]}"
        j = r.json()
        assert j["page_count"] == 9
        pdf = base64.b64decode(j["pdf_base64"])
        assert len(pdf) <= 5 * 1024 * 1024, f"PDF > 5MB: {len(pdf)}"
        assert (j.get("ocr_text") or "").strip(), "ocr_text vuoto"
        assert j.get("text_hash"), "text_hash mancante"
        assert elapsed < 15.0, f"merge lento {elapsed:.1f}s (atteso <10-15s con already_processed)"
        # verifica PDF con pymupdf: 9 pagine + 2 immagini/pagina (contenuto+watermark) + testo
        import pymupdf as fitz
        doc = fitz.open(stream=pdf, filetype="pdf")
        try:
            assert doc.page_count == 9
            total_text = 0
            for pn in range(doc.page_count):
                page = doc.load_page(pn)
                imgs = page.get_images(full=True)
                assert len(imgs) >= 2, f"pagina {pn}: attese 2 immagini (contenuto+watermark), trovate {len(imgs)}"
                txt = page.get_text() or ""
                total_text += len(txt.strip())
            assert total_text > 0, "nessun testo estraibile dal PDF"
        finally:
            doc.close()


class TestScannerMergePdfRawFallback:
    def test_merge_raw_image(self, api):
        b64 = _make_large_page_b64(2)
        pages = [{"data_base64": b64, "mime": "image/jpeg", "already_processed": False, "already_cropped": True} for _ in range(2)]
        r = api.post(f"{BASE_URL}/api/scanner/merge-pdf",
                     json={"pages": pages, "name": "TestRaw", "ocr": False, "enhance": True, "autocrop": False},
                     timeout=120)
        assert r.status_code == 200, f"merge raw {r.status_code}: {r.text[:400]}"
        j = r.json()
        assert j["page_count"] == 2
        pdf = base64.b64decode(j["pdf_base64"])
        import pymupdf as fitz
        doc = fitz.open(stream=pdf, filetype="pdf")
        try:
            assert doc.page_count == 2
            for pn in range(doc.page_count):
                imgs = doc.load_page(pn).get_images(full=True)
                assert len(imgs) >= 2, f"pagina raw {pn}: attese 2 immagini (contenuto+watermark), trovate {len(imgs)}"
        finally:
            doc.close()


class TestScannerRegression:
    def test_autocrop_preview(self, api):
        b64 = _make_large_page_b64(3)
        r = api.post(f"{BASE_URL}/api/scanner/autocrop-preview",
                     json={"data_base64": b64, "mime": "image/jpeg", "enhance": True, "grayscale": False},
                     timeout=60)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "detected" in j and "data_base64" in j

    def test_detect_corners(self, api):
        b64 = _make_large_page_b64(4)
        r = api.post(f"{BASE_URL}/api/scanner/detect-corners",
                     json={"data_base64": b64, "mime": "image/jpeg"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "detected" in j


# ================================================================ PDF pages
class TestPdfPages:
    def test_progressive_load(self, api, processed_page):
        # Build 9-page PDF first
        pages = [{"data_base64": processed_page["data_base64"], "mime": "image/jpeg",
                  "already_processed": True, "ocr": processed_page["ocr"]} for _ in range(9)]
        r = api.post(f"{BASE_URL}/api/scanner/merge-pdf",
                     json={"pages": pages, "name": "Progr", "ocr": False, "autocrop": False}, timeout=60)
        assert r.status_code == 200
        pdf_b64 = r.json()["pdf_base64"]

        # first page
        r1 = api.post(f"{BASE_URL}/api/files/pdf-pages",
                      json={"pdf_base64": pdf_b64, "start": 0, "max_pages": 1, "dpi": 110}, timeout=60)
        assert r1.status_code == 200, r1.text[:300]
        j1 = r1.json()
        assert len(j1["pages"]) == 1
        assert j1["total"] == 9
        assert j1["start"] == 0

        # block of 3 starting at 1
        r2 = api.post(f"{BASE_URL}/api/files/pdf-pages",
                      json={"pdf_base64": pdf_b64, "start": 1, "max_pages": 3, "dpi": 110}, timeout=60)
        assert r2.status_code == 200
        j2 = r2.json()
        assert len(j2["pages"]) == 3
        assert j2["start"] == 1

        # last partial block: start=7 -> 2 pages
        r3 = api.post(f"{BASE_URL}/api/files/pdf-pages",
                      json={"pdf_base64": pdf_b64, "start": 7, "max_pages": 3, "dpi": 110}, timeout=60)
        assert r3.status_code == 200
        j3 = r3.json()
        assert len(j3["pages"]) == 2, f"atteso 2, ottenuto {len(j3['pages'])}"


# ================================================================ WEATHER
class TestWeatherCache:
    def test_forecast_and_cache(self, api):
        payload = {"lat": 45.4, "lon": 11.9}
        # First call
        r1 = api.post(f"{BASE_URL}/api/weather/forecast", json=payload, timeout=30)
        assert r1.status_code == 200, r1.text[:300]
        j1 = r1.json()
        assert isinstance(j1.get("days"), list)
        assert len(j1["days"]) == 7, f"attesi 7 giorni, trovati {len(j1['days'])}"

        # Second call immediately -> cached: true
        r2 = api.post(f"{BASE_URL}/api/weather/forecast", json=payload, timeout=30)
        assert r2.status_code == 200
        j2 = r2.json()
        assert j2.get("cached") is True, f"seconda chiamata non cached: keys={list(j2.keys())}"
        assert len(j2["days"]) == 7

    def test_cache_entry_in_mongo(self):
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            pytest.skip("MONGO_URL/DB_NAME non configurati")

        async def check():
            client = AsyncIOMotorClient(mongo_url)
            try:
                doc = await client[db_name].weather_forecast_cache.find_one({"key": "45.4,11.9"}, {"_id": 0})
                return doc
            finally:
                client.close()

        doc = asyncio.get_event_loop().run_until_complete(check())
        assert doc is not None, "cache entry 45.4,11.9 non trovata in Mongo"
        assert "cached_at" in doc and "data" in doc

    def test_alerts(self, api):
        r = api.post(f"{BASE_URL}/api/weather/alerts", json={"lat": 45.4, "lon": 11.9}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "weather" in j, f"weather mancante: keys={list(j.keys())}"
