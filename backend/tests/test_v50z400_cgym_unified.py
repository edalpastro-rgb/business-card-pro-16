# V50.z400 — Corporate Gym unified structure: areas (obiezioni/winwin/trattativa),
# live start openings + 8-block winwin, materials raw endpoint.
import os
import base64
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://business-card-pro-16.preview.emergentagent.com"
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"

# Minimal valid 1-page PDF
MIN_PDF = (
    b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Resources<<>>/Contents 4 0 R>>endobj\n"
    b"4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 50 150 Td (Hello PDF) Tj ET\nendstream endobj\n"
    b"xref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n"
    b"0000000098 00000 n \n0000000178 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n270\n%%EOF"
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def areas(hdr):
    r = requests.get(f"{BASE_URL}/api/cgym/areas", headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    items = data.get("items", [])
    by_key = {a["key"]: a for a in items}
    return by_key


# ── Areas listing ────────────────────────────────────────────────────────────
def test_areas_have_required_keys(areas):
    for k in ("obiezioni", "winwin", "trattativa"):
        assert k in areas, f"missing area key: {k}"


def test_winwin_has_8_blocks(areas):
    ww = areas["winwin"]
    blocks = ww.get("blocks") or []
    assert len(blocks) == 8, f"expected 8 blocks, got {len(blocks)}: {blocks}"
    assert blocks[0].startswith("1 · Telefonata"), f"first block wrong: {blocks[0]}"


# ── Live start openings ──────────────────────────────────────────────────────
def test_live_start_winwin_pronto(areas, hdr):
    ww_id = areas["winwin"]["area_id"]
    r = requests.post(f"{BASE_URL}/api/cgym/live/start", headers=hdr,
                      json={"area_id": ww_id, "training_level": "base"}, timeout=45)
    assert r.status_code == 200, r.text
    j = r.json()
    assert len(j["blocks"]) == 8
    assert j["turns"][0]["text"] == "Pronto?", f"got {j['turns'][0]['text']}"
    # save for turn/finish test
    pytest.winwin_session_id = j["session_id"]


def test_live_start_obiezioni_prego(areas, hdr):
    ob_id = areas["obiezioni"]["area_id"]
    r = requests.post(f"{BASE_URL}/api/cgym/live/start", headers=hdr,
                      json={"area_id": ob_id, "training_level": "base"}, timeout=45)
    assert r.status_code == 200, r.text
    j = r.json()
    assert len(j["blocks"]) == 3, f"expected 3 blocks obiezioni, got {len(j['blocks'])}"
    assert j["turns"][0]["text"] == "Prego, si accomodi. Mi dica.", f"got {j['turns'][0]['text']}"


# ── Live turn + finish for winwin ────────────────────────────────────────────
def test_live_turn_winwin(hdr):
    sid = getattr(pytest, "winwin_session_id", None)
    assert sid, "no winwin session"
    r = requests.post(f"{BASE_URL}/api/cgym/live/{sid}/turn", headers=hdr,
                      json={"text": "Buongiorno, sono Marco di AdvisorOS, la chiamo per fissare un appuntamento di 20 minuti. Va bene martedì alle 10?", "tts": False},
                      timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("ok") is True, j
    assert isinstance(j.get("reply"), str) and len(j["reply"]) > 0


def test_live_finish_winwin(hdr):
    sid = getattr(pytest, "winwin_session_id", None)
    assert sid
    r = requests.post(f"{BASE_URL}/api/cgym/live/{sid}/finish", headers=hdr, timeout=90)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "score" in j, j


# ── Materials raw endpoint ───────────────────────────────────────────────────
def test_materials_raw_and_json(areas, hdr):
    ob_id = areas["obiezioni"]["area_id"]
    b64 = base64.b64encode(MIN_PDF).decode("ascii")
    r = requests.post(f"{BASE_URL}/api/cgym/areas/{ob_id}/materials", headers=hdr,
                      json={"name": "test_v400.pdf", "mime": "application/pdf", "data_base64": b64},
                      timeout=30)
    assert r.status_code == 200, r.text
    mat_id = r.json()["material_id"]
    try:
        # raw=1 → inline
        r2 = requests.get(f"{BASE_URL}/api/cgym/areas/{ob_id}/materials/{mat_id}/content?raw=1",
                          headers=hdr, timeout=30)
        assert r2.status_code == 200
        assert "application/pdf" in r2.headers.get("Content-Type", "")
        cd = r2.headers.get("Content-Disposition", "")
        assert cd.startswith("inline"), f"expected inline, got {cd}"
        assert r2.content[:4] == b"%PDF", "bytes not PDF"

        # raw=1&download=1 → attachment
        r3 = requests.get(f"{BASE_URL}/api/cgym/areas/{ob_id}/materials/{mat_id}/content?raw=1&download=1",
                          headers=hdr, timeout=30)
        assert r3.status_code == 200
        assert r3.headers.get("Content-Disposition", "").startswith("attachment")

        # no raw → JSON
        r4 = requests.get(f"{BASE_URL}/api/cgym/areas/{ob_id}/materials/{mat_id}/content",
                          headers=hdr, timeout=30)
        assert r4.status_code == 200
        j = r4.json()
        assert j.get("mime") == "application/pdf"
        assert j.get("data_base64")

        # unauthenticated raw
        r5 = requests.get(f"{BASE_URL}/api/cgym/areas/{ob_id}/materials/{mat_id}/content?raw=1", timeout=30)
        assert r5.status_code in (401, 403), f"expected auth error, got {r5.status_code}"
    finally:
        requests.delete(f"{BASE_URL}/api/cgym/areas/{ob_id}/materials/{mat_id}", headers=hdr, timeout=30)
