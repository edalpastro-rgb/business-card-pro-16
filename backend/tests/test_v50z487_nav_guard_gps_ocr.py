"""V50.z487 — NAV GUARD (link interni di Axon sempre validi) + GPS reale nel prompt + OCR universale documenti."""
import base64
import io
import os

import requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")


def _login():
    r = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _san(h, text):
    r = requests.post(f"{BASE}/axon/nav/sanitize", json={"text": text}, headers=h, timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()["text"]


def test_routes_endpoint_lists_real_screens():
    h = _login()
    r = requests.get(f"{BASE}/axon/nav/routes", headers=h, timeout=20)
    assert r.status_code == 200
    j = r.json()
    for p in ("/permessi", "/setup", "/impostazioni", "/calendario", "/contatti", "/pun-storico", "/privacy-policy"):
        assert p in j["paths"], p
    assert "/contact/" in j["dynamic_prefixes"]
    assert "general" in j["settings_sections"] and "axon" in j["settings_sections"]


def test_invented_settings_section_permessi_goes_to_real_screen():
    h = _login()
    out = _san(h, "Vai qui:\n[[NAV:/impostazioni?section=permessi|Impostazioni → Permessi]]")
    assert "[[NAV:/permessi?standalone=1|Impostazioni → Permessi]]" in out
    assert "section=permessi" not in out


def test_english_and_nested_aliases():
    h = _login()
    out = _san(h, "[[NAV:/settings|Impostazioni]]\n[[NAV:/impostazioni/permessi|Permessi app]]\n[[NAV:/configurazione-guidata|Configurazione guidata]]\n[[NAV:/notifiche|Notifiche]]")
    assert "[[NAV:/impostazioni|Impostazioni]]" in out
    assert "[[NAV:/permessi?standalone=1|Permessi app]]" in out
    assert "[[NAV:/setup|Configurazione guidata]]" in out
    assert "[[NAV:/axon-notifications?tab=prefs|Notifiche]]" in out


def test_valid_routes_untouched_and_placeholder_resolved():
    h = _login()
    txt = "[[NAV:/calendario?view=week|Settimana]]\n[[NAV:/impostazioni?section=assistente|Assistente]]\n[[NAV:/contact/{id}|Scheda]]\n[[NAV:/optimal-route?contacts=abc123|Naviga]]"
    out = _san(h, txt)
    assert "[[NAV:/calendario?view=week|Settimana]]" in out
    assert "[[NAV:/impostazioni?section=axon|Assistente]]" in out
    assert "[[NAV:/contatti|Scheda]]" in out and "{id}" not in out
    assert "[[NAV:/optimal-route?contacts=abc123|Naviga]]" in out


def test_nonexistent_screen_becomes_text_instructions():
    h = _login()
    out = _san(h, "Ecco:\n[[NAV:/videochiamata|Avvia videochiamata]]")
    assert "[[NAV:" not in out
    assert "Avvia videochiamata" in out and "non c'è una schermata dedicata" in out


def test_typo_route_fixed_and_duplicates_removed():
    h = _login()
    out = _san(h, "[[NAV:/impostazion|Impostazioni]]\n[[NAV:/impostazioni|Impostazioni]]")
    assert out.count("[[NAV:") == 1
    assert "[[NAV:/impostazioni|Impostazioni]]" in out


def test_permessi_without_query_gets_standalone():
    h = _login()
    out = _san(h, "[[NAV:/permessi|Permessi]]")
    assert "[[NAV:/permessi?standalone=1|Permessi]]" in out


def test_chat_with_gps_position_knows_where_user_is():
    """client_context.position → Axon usa le coordinate (non dice che non può conoscere la posizione)."""
    h = _login()
    body = {"message": "Scrivimi la mia latitudine e longitudine attuali con 4 decimali, solo quelle.", "no_cache": True,
            "client_context": {"route": "/home", "position": {"lat": 45.7662, "lon": 11.7345, "accuracy_m": 12, "age_s": 3}}}
    r = requests.post(f"{BASE}/assistant/chat", json=body, headers=h, timeout=120)
    assert r.status_code == 200, r.text[:300]
    rep = r.json().get("reply", "")
    assert "45.76" in rep or "45,76" in rep, rep[:300]
    assert "11.73" in rep or "11,73" in rep, rep[:300]


def _fake_business_card_png() -> str:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (900, 520), "white")
    d = ImageDraw.Draw(img)
    try:
        f_big = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 46)
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
    except Exception:
        f_big = f = ImageFont.load_default()
    d.text((50, 60), "Giulia Bianchi", fill="black", font=f_big)
    d.text((50, 130), "Responsabile Commerciale", fill="black", font=f)
    d.text((50, 190), "Energia Veneta S.r.l.", fill="black", font=f)
    d.text((50, 260), "Tel. 347 1234567", fill="black", font=f)
    d.text((50, 310), "giulia.bianchi@energiaveneta.it", fill="black", font=f)
    d.text((50, 360), "Via Roma 10, 36061 Bassano del Grappa (VI)", fill="black", font=f)
    d.text((50, 410), "P.IVA 01234567890", fill="black", font=f)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_documents_ocr_fields_business_card():
    h = _login()
    r = requests.post(f"{BASE}/documents/ocr-fields", json={"image_base64": _fake_business_card_png(), "hint": "any"}, headers=h, timeout=120)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    doc = j["document"]
    assert j["doc_kind"] == "business_card", j["doc_kind"]
    assert doc.get("first_name", "").lower().startswith("giulia") and doc.get("last_name", "").lower().startswith("bianchi")
    assert "347" in doc.get("phone", "").replace(" ", "")
    assert doc.get("email") == "giulia.bianchi@energiaveneta.it"
    assert "roma" in doc.get("address_street", "").lower() or "roma" in doc.get("address", "").lower()
    assert doc.get("vat_number") == "01234567890"
    assert len(j["filled"]) >= 6


def test_documents_ocr_fields_requires_image():
    h = _login()
    r = requests.post(f"{BASE}/documents/ocr-fields", json={"image_base64": ""}, headers=h, timeout=20)
    assert r.status_code == 400
