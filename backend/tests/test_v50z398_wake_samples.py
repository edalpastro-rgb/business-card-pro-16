"""V50.z398 wake-samples panel + public config/visit tests."""
import os
import base64
import struct
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


def _make_wav(duration_ms=200, freq=440, rate=16000):
    """Generate a minimal valid WAV file >800 bytes."""
    import math
    n_samples = int(rate * duration_ms / 1000)
    data = b"".join(struct.pack("<h", int(16000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n_samples))
    size = len(data)
    header = b"RIFF" + struct.pack("<I", 36 + size) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", size)
    return header + data


@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=OWNER, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="session")
def sub_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=SUB, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"sub login failed: {r.status_code} {r.text[:120]}")
    return r.json()["token"]


# ── Public config (no auth) ─────────────────────────────────────────────
def test_public_config_no_auth():
    r = requests.get(f"{BASE_URL}/api/public/wake-samples/config", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert isinstance(d.get("positive"), list) and len(d["positive"]) >= 1
    assert any(w["word"] == "axon" for w in d["positive"])
    assert isinstance(d.get("negative"), list)
    assert isinstance(d.get("min_per_env"), int)
    assert isinstance(d.get("max_per_env"), int)
    assert isinstance(d.get("environments"), list) and "casa" in d["environments"]


# ── Public visit flow ───────────────────────────────────────────────────
def test_public_visit_open_consent_done(owner_token):
    sid = f"wtestvisit{int(time.time())}"
    for ev in ("open", "consent", "done"):
        r = requests.post(f"{BASE_URL}/api/public/wake-samples/visit",
                          json={"session_id": sid, "event": ev, "platform": "web"}, timeout=15)
        assert r.status_code == 200, f"{ev}: {r.text}"
        assert r.json().get("ok") is True

    # Owner sessions list must contain this session as completato
    r = requests.get(f"{BASE_URL}/api/wake-samples/sessions",
                     headers={"Authorization": f"Bearer {owner_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "items" in d and isinstance(d.get("total_samples"), int)
    assert "counts" in d
    match = next((x for x in d["items"] if x["session_id"] == sid), None)
    assert match is not None, f"session {sid} not found in items"
    assert match["status"] == "completato"
    assert match["completed_at"] is not None
    assert match["opened_at"] is not None


# ── Access endpoint ─────────────────────────────────────────────────────
def test_access_owner_super_master(owner_token):
    r = requests.get(f"{BASE_URL}/api/wake-samples/access",
                     headers={"Authorization": f"Bearer {owner_token}"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("is_super_master") is True


def test_access_sub_user_returns_false(sub_token):
    r = requests.get(f"{BASE_URL}/api/wake-samples/access",
                     headers={"Authorization": f"Bearer {sub_token}"}, timeout=15)
    assert r.status_code == 200, f"expected 200 (no leak), got {r.status_code}: {r.text}"
    assert r.json().get("is_super_master") is False


def test_access_unauthenticated_401():
    r = requests.get(f"{BASE_URL}/api/wake-samples/access", timeout=15)
    assert r.status_code == 401, r.status_code


# ── Config PUT (add positive, invalid all-inactive, min_per_env, restore) ──
def test_config_put_add_ehi_axon_then_restore(owner_token):
    H = {"Authorization": f"Bearer {owner_token}"}

    # Add 'ehi axon' alongside 'axon'
    body = {"positive": [{"word": "axon", "label": "Axon (AK-son)", "active": True},
                         {"word": "ehi axon", "label": "Ehi Axon", "active": True}],
            "min_per_env": 12}
    r = requests.put(f"{BASE_URL}/api/wake-samples/config", json=body, headers=H, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    pos_words = [x["word"] for x in d["positive"]]
    assert "ehi_axon" in pos_words, f"got {pos_words}"
    assert d["min_per_env"] == 12

    # Public config now lists both
    r2 = requests.get(f"{BASE_URL}/api/public/wake-samples/config", timeout=15)
    words2 = [x["word"] for x in r2.json()["positive"]]
    assert "axon" in words2 and "ehi_axon" in words2

    # All positive inactive -> 400
    bad = {"positive": [{"word": "axon", "label": "Axon", "active": False}]}
    r3 = requests.put(f"{BASE_URL}/api/wake-samples/config", json=bad, headers=H, timeout=15)
    assert r3.status_code == 400, f"expected 400 got {r3.status_code}: {r3.text}"

    # Restore
    restore = {"positive": [{"word": "axon", "label": "Axon (AK-son)", "active": True}],
               "min_per_env": 10}
    r4 = requests.put(f"{BASE_URL}/api/wake-samples/config", json=restore, headers=H, timeout=15)
    assert r4.status_code == 200, r4.text
    dr = r4.json()
    assert [x["word"] for x in dr["positive"]] == ["axon"]
    assert dr["min_per_env"] == 10


# ── b64 upload flow + parziale + zip export + delete ────────────────────
def test_b64_upload_ehi_axon_then_zip_and_delete(owner_token):
    H = {"Authorization": f"Bearer {owner_token}"}

    # First activate 'ehi axon'
    body = {"positive": [{"word": "axon", "label": "Axon (AK-son)", "active": True},
                         {"word": "ehi axon", "label": "Ehi Axon", "active": True}]}
    r = requests.put(f"{BASE_URL}/api/wake-samples/config", json=body, headers=H, timeout=15)
    assert r.status_code == 200, r.text

    try:
        wav = _make_wav(duration_ms=400)
        assert len(wav) > 800
        b64 = base64.b64encode(wav).decode("ascii")
        sid = f"wtestb64{int(time.time())}"
        payload = {"data_base64": b64, "mime": "audio/wav", "word": "ehi axon",
                   "environment": "casa", "kind": "positive", "seq": 0, "session_id": sid}
        r_up = requests.post(f"{BASE_URL}/api/public/wake-samples/b64", json=payload, timeout=30)
        assert r_up.status_code == 200, r_up.text
        upd = r_up.json()
        assert upd["ok"] and upd["word"] == "ehi_axon"
        sample_id = upd["sample_id"]

        # Sessions list — this session should be 'parziale' with total=1
        r_s = requests.get(f"{BASE_URL}/api/wake-samples/sessions", headers=H, timeout=30)
        assert r_s.status_code == 200
        items = r_s.json()["items"]
        m = next((x for x in items if x["session_id"] == sid), None)
        assert m is not None and m["status"] == "parziale" and m["total"] == 1

        # ZIP for that session via token query
        r_zip = requests.get(f"{BASE_URL}/api/wake-samples/export.zip",
                             params={"session_id": sid, "token": owner_token}, timeout=60)
        assert r_zip.status_code == 200, r_zip.text[:200]
        assert r_zip.headers.get("content-type", "").startswith("application/zip")
        assert len(r_zip.content) > 100

        # Cleanup: delete
        r_del = requests.delete(f"{BASE_URL}/api/wake-samples/{sample_id}", headers=H, timeout=15)
        assert r_del.status_code == 200
    finally:
        # Restore to default (axon only, min 10)
        restore = {"positive": [{"word": "axon", "label": "Axon (AK-son)", "active": True}],
                   "min_per_env": 10}
        requests.put(f"{BASE_URL}/api/wake-samples/config", json=restore, headers=H, timeout=15)


# ── stats regression ────────────────────────────────────────────────────
def test_stats_returns_expected_words(owner_token):
    r = requests.get(f"{BASE_URL}/api/wake-samples/stats",
                     headers={"Authorization": f"Bearer {owner_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "expected_words" in d
    assert "positive" in d["expected_words"] and "axon" in d["expected_words"]["positive"]
    assert "by_environment" in d and "words" in d
