# V50.z365 — Corporate Gym dynamic areas + Master compress-all
import base64
import io
import os
import time
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"
MASTER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


def _login(sess, creds):
    r = sess.post(f"{BASE_URL}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    sess.headers.update({"Authorization": f"Bearer {tok}"})
    return r.json()


@pytest.fixture(scope="module")
def master():
    s = requests.Session()
    _login(s, MASTER)
    return s


@pytest.fixture(scope="module")
def sub():
    s = requests.Session()
    try:
        _login(s, SUB)
        return s
    except AssertionError:
        pytest.skip("sub-user unavailable")


# ---------- CGYM AREAS ----------
class TestCgymAreas:
    def test_list_seeds_three(self, master):
        r = master.get(f"{BASE_URL}/cgym/areas", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["is_master"] is True
        items = d["items"]
        keys = [a["key"] for a in items]
        assert "obiezioni" in keys and "winwin" in keys and "trattativa" in keys
        tratt = next(a for a in items if a["key"] == "trattativa")
        assert len(tratt.get("blocks") or []) == 6
        pytest._cgym_trattativa_id = tratt["area_id"]
        pytest._cgym_obiezioni_id = next(a for a in items if a["key"] == "obiezioni")["area_id"]

    def test_patch_master_ok(self, master):
        aid = pytest._cgym_trattativa_id
        r = master.patch(f"{BASE_URL}/cgym/areas/{aid}", json={"name": "Trattativa Completa TEST"}, timeout=20)
        assert r.status_code == 200
        # rename back
        master.patch(f"{BASE_URL}/cgym/areas/{aid}", json={"name": "Trattativa Completa"}, timeout=20)

    def test_patch_sub_forbidden(self, master, sub):
        aid = pytest._cgym_trattativa_id
        r = sub.patch(f"{BASE_URL}/cgym/areas/{aid}", json={"name": "hack"}, timeout=20)
        assert r.status_code == 403

    def test_create_and_delete_custom(self, master):
        r = master.post(f"{BASE_URL}/cgym/areas", json={"name": "TEST Area Custom", "blocks": ["B1", "B2"]}, timeout=20)
        assert r.status_code == 200
        aid = r.json()["area_id"]
        # delete custom OK
        r2 = master.delete(f"{BASE_URL}/cgym/areas/{aid}", timeout=20)
        assert r2.status_code == 200

    def test_delete_builtin_400(self, master):
        r = master.delete(f"{BASE_URL}/cgym/areas/{pytest._cgym_trattativa_id}", timeout=20)
        assert r.status_code == 400


# ---------- CGYM MATERIALS ----------
class TestCgymMaterials:
    def test_material_add_list_content_delete(self, master):
        aid = pytest._cgym_trattativa_id
        pdf = b"%PDF-1.4\n%TEST\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
        b64 = base64.b64encode(pdf).decode()
        r = master.post(f"{BASE_URL}/cgym/areas/{aid}/materials",
                        json={"name": "TEST_mat.pdf", "mime": "application/pdf", "data_base64": b64}, timeout=30)
        assert r.status_code == 200, r.text
        mid = r.json()["material_id"]
        rL = master.get(f"{BASE_URL}/cgym/areas/{aid}/materials", timeout=15)
        assert rL.status_code == 200
        assert any(m["material_id"] == mid for m in rL.json()["items"])
        rC = master.get(f"{BASE_URL}/cgym/areas/{aid}/materials/{mid}/content", timeout=15)
        assert rC.status_code == 200 and rC.json().get("data_base64")
        rD = master.delete(f"{BASE_URL}/cgym/areas/{aid}/materials/{mid}", timeout=15)
        assert rD.status_code == 200


# ---------- CGYM REFERENCES ----------
class TestCgymReferences:
    def _wav(self, sz_kb=60):
        import struct, wave
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
            n = sz_kb * 1024 // 2
            w.writeframes(struct.pack("<" + "h" * n, *([0] * n)))
        return buf.getvalue()

    def test_ref_upload_link_stream(self, master):
        aid = pytest._cgym_trattativa_id
        data = self._wav(60)
        files = {"file": ("test.wav", data, "audio/wav")}
        r = master.post(f"{BASE_URL}/cgym/areas/{aid}/references",
                        files=files, data={"title": "TEST_ref"}, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["kind"] == "audio"
        rid = r.json()["ref_id"]
        pytest._cgym_ref_id = rid
        rL = master.post(f"{BASE_URL}/cgym/references/{rid}/link", timeout=15)
        assert rL.status_code == 200
        url = rL.json()["url"]
        rS = requests.get(url, timeout=30)
        assert rS.status_code == 200
        assert "inline" in rS.headers.get("Content-Disposition", "").lower()

    def test_ref_delete(self, master):
        r = master.delete(f"{BASE_URL}/cgym/references/{pytest._cgym_ref_id}", timeout=15)
        assert r.status_code == 200


# ---------- CGYM LIVE ----------
class TestCgymLive:
    def test_live_flow(self, master):
        aid = pytest._cgym_obiezioni_id
        r = master.post(f"{BASE_URL}/cgym/live/start", json={"area_id": aid}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        sid = d["session_id"]
        assert d["turns"][0]["role"] == "client"
        pytest._cgym_sid = sid

        # hesitation turn
        r2 = master.post(f"{BASE_URL}/cgym/live/{sid}/turn",
                         json={"text": "Ehm... cioè... sì", "tts": False}, timeout=120)
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["action"] == "repeat"
        assert d2["hesitation"] is True

        # fluent long turn
        fluent = ("Buongiorno, la ringrazio del tempo. Sono un consulente energia e mi occupo di aiutare aziende come la sua "
                  "a ridurre i costi e migliorare le condizioni contrattuali. Vorrei farle qualche domanda per capire meglio "
                  "il suo profilo di consumo e valutare se possiamo offrirle qualcosa di realmente vantaggioso.")
        r3 = master.post(f"{BASE_URL}/cgym/live/{sid}/turn",
                         json={"text": fluent, "tts": False}, timeout=120)
        assert r3.status_code == 200, r3.text
        d3 = r3.json()
        assert d3["action"] in ("next_block", "continue", "all_done")
        assert d3["tone"] in ("green", "blue", "red")
        assert isinstance(d3.get("tone_segments"), list) and len(d3["tone_segments"]) >= 1

    def test_finish_and_ratings(self, master):
        sid = pytest._cgym_sid
        r = master.post(f"{BASE_URL}/cgym/live/{sid}/finish", timeout=180)
        assert r.status_code == 200, r.text
        d = r.json()
        assert 0 <= d["score"] <= 100
        assert d["rating"] in ("OSCENO", "MEDIOCRE", "DOVERE", "ECCELLENTE")
        assert "good" in d["feedback"] and "redo" in d["feedback"]
        assert d.get("manager_report")

        rR = master.get(f"{BASE_URL}/cgym/ratings", timeout=30)
        assert rR.status_code == 200
        assert "items" in rR.json()


# ---------- COMPRESS ALL ----------
class TestCompressAll:
    def test_status_master(self, master):
        r = master.get(f"{BASE_URL}/admin/compress-all/status", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["running"] in (True, False)
        assert isinstance(d.get("db_bytes"), int)
        assert d.get("ffmpeg") is True

    def test_status_sub_forbidden(self, sub):
        r = sub.get(f"{BASE_URL}/admin/compress-all/status", timeout=20)
        assert r.status_code == 403

    def test_start_sub_forbidden(self, sub):
        r = sub.post(f"{BASE_URL}/admin/compress-all", timeout=20)
        assert r.status_code == 403

    def test_start_and_poll(self, master):
        r = master.post(f"{BASE_URL}/admin/compress-all", timeout=30)
        # can be 409 if a job is already running
        assert r.status_code in (200, 409), r.text
        # Poll up to 3 minutes
        deadline = time.time() + 180
        last = None
        while time.time() < deadline:
            s = master.get(f"{BASE_URL}/admin/compress-all/status", timeout=30).json()
            last = s.get("last")
            if last and last.get("status") == "done":
                break
            time.sleep(5)
        assert last and last.get("status") == "done", f"last={last}"
        assert isinstance(last.get("before_bytes"), int)
        assert isinstance(last.get("after_bytes"), int)
        assert isinstance(last.get("saved_bytes"), int)


# ---------- COMPRESSION HOOK ON CONTACT FILE ----------
class TestCompressionHook:
    def test_large_jpeg_stored_smaller(self, master):
        # create contact
        r = master.post(f"{BASE_URL}/contacts", json={"first_name": "TEST_CMP", "last_name": "Zulu"}, timeout=20)
        assert r.status_code in (200, 201), r.text
        cid = r.json()["contact_id"] if "contact_id" in r.json() else r.json().get("id")
        pytest._cmp_cid = cid

        # large JPEG with noise (uncompressible) to ensure >300KB
        import random
        random.seed(42)
        px = bytes(random.randint(0, 255) for _ in range(2500 * 1800 * 3))
        im = Image.frombytes("RGB", (2500, 1800), px)
        buf = io.BytesIO(); im.save(buf, "JPEG", quality=95)
        raw = buf.getvalue()
        assert len(raw) > 300 * 1024, f"raw={len(raw)}"
        b64 = base64.b64encode(raw).decode()

        rF = master.post(f"{BASE_URL}/contacts/{cid}/files",
                         json={"name": "TEST_big.jpg", "mime": "image/jpeg", "data_base64": b64}, timeout=60)
        assert rF.status_code in (200, 201), rF.text
        fid = rF.json().get("file_id") or rF.json().get("id")
        pytest._cmp_fid = fid

        rG = master.get(f"{BASE_URL}/contacts/{cid}", timeout=30)
        assert rG.status_code == 200
        files = rG.json().get("files") or []
        stored = next((f for f in files if (f.get("file_id") or f.get("id")) == fid), None)
        assert stored is not None, files
        stored_b64 = stored.get("data_base64") or ""
        stored_bytes = len(stored_b64) * 3 // 4
        assert stored_bytes < len(raw) * 0.8, f"expected compression: raw={len(raw)} stored={stored_bytes}"

    def test_cleanup(self, master):
        cid = getattr(pytest, "_cmp_cid", None)
        if cid:
            master.delete(f"{BASE_URL}/contacts/{cid}", timeout=20)
