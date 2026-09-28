"""V50.z389 — Backend testing for Audio Transcripts + ANT 3 levels + upload speed + courses light."""
import base64
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or "https://business-card-pro-16.preview.emergentagent.com"
API = f"{BASE_URL}/api"

OWNER = ("test@dalpastro.it", "Test1234!")
SUB = ("sub1@dalpastro.it", "Sub12345!")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "token" in d
    return d["token"]


@pytest.fixture(scope="module")
def owner_headers():
    return {"Authorization": f"Bearer {_login(*OWNER)}"}


@pytest.fixture(scope="module")
def sub_headers():
    return {"Authorization": f"Bearer {_login(*SUB)}"}


# --- login ---
def test_login_owner_and_sub():
    for creds in (OWNER, SUB):
        r = requests.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=30)
        assert r.status_code == 200 and "token" in r.json()


# --- ANT live 3 levels ---
@pytest.fixture(scope="module")
def area_id(owner_headers):
    r = requests.get(f"{API}/cgym/areas", headers=owner_headers, timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    assert items
    return items[0]["area_id"]


def test_cgym_live_full_flow_esperto(owner_headers, area_id):
    r = requests.post(f"{API}/cgym/live/start", headers=owner_headers,
                      json={"area_id": area_id, "training_level": "esperto"}, timeout=90)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("training_level") == "esperto"
    sid = d["session_id"]

    text = ("Allora, ehm, la nostra offerta costa 5 euro al mese e le regalo un iPhone "
            "se firma subito, guardi la prego mi aiuti a fare il numero")
    r2 = requests.post(f"{API}/cgym/live/{sid}/turn", headers=owner_headers,
                       json={"text": text, "tts": False}, timeout=90)
    assert r2.status_code == 200, r2.text
    t = r2.json()
    assert t.get("ok") is True
    assert isinstance(t.get("distacco"), int) and 0 <= t["distacco"] <= 100
    assert t.get("distacco_color") in ("verde", "blu", "rosso")
    assert isinstance(t.get("interventions"), list)
    assert t.get("action") in ("continue", "repeat", "correct", "next_block", "all_done")

    r3 = requests.post(f"{API}/cgym/live/{sid}/finish", headers=owner_headers, timeout=120)
    assert r3.status_code == 200, r3.text
    fd = r3.json()
    assert fd.get("status") == "done"
    p = fd.get("params") or {}
    for k in ("tono", "obiezioni", "invito_azione", "distacco", "dati", "filo_logico"):
        assert k in p, f"missing key {k}"
    assert fd.get("distacco_color") in ("verde", "blu", "rosso")
    assert fd.get("training_level") == "esperto"


# --- Audio ref upload + transcript ---
@pytest.fixture(scope="module")
def tts_mp3(owner_headers):
    r = requests.post(f"{API}/ai/tts", headers=owner_headers,
                      json={"text": ("Allora, buongiorno, cioè, ehm, praticamente la nostra offerta luce e gas "
                                     "le fa risparmiare duecento euro all anno, quindi niente se vuole firmiamo oggi")},
                      timeout=120)
    assert r.status_code == 200, r.text
    b64 = r.json().get("audio_base64")
    assert b64
    return base64.b64decode(b64)


def test_ref_upload_fast_and_kind(owner_headers, sub_headers, area_id, tts_mp3):
    t0 = time.time()
    files = {"file": ("qa.mp3", tts_mp3, "audio/mpeg")}
    data = {"title": "Test QA audio"}
    r = requests.post(f"{API}/cgym/areas/{area_id}/references", headers=owner_headers,
                      files=files, data=data, timeout=60)
    elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 15, f"upload too slow: {elapsed}s"
    d = r.json()
    assert d.get("kind") == "audio"
    assert d.get("compressing") is True
    assert d.get("ref_id")
    assert d.get("transcript_id")

    pytest.ref_id = d["ref_id"]
    pytest.transcript_id = d["transcript_id"]

    # ref appears in list
    lr = requests.get(f"{API}/cgym/areas/{area_id}/references", headers=owner_headers, timeout=30)
    assert lr.status_code == 200
    assert any(x["ref_id"] == d["ref_id"] for x in lr.json()["items"])


def test_transcript_polls_to_draft(owner_headers):
    tid = pytest.transcript_id
    deadline = time.time() + 120
    status = None
    while time.time() < deadline:
        r = requests.get(f"{API}/audio-transcripts/{tid}", headers=owner_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        status = d.get("status")
        if status in ("draft", "failed"):
            break
        time.sleep(5)
    assert status == "draft", f"final status {status}"
    # raw contains fillers, clean doesn't
    raw = (d.get("raw_text") or "").lower()
    text = (d.get("text") or "").lower()
    assert "ehm" in raw or "cioè" in raw or "allora" in raw
    assert "ehm" not in text


def test_sub_cannot_read_draft(sub_headers):
    r = requests.get(f"{API}/audio-transcripts/{pytest.transcript_id}", headers=sub_headers, timeout=30)
    assert r.status_code == 403


def test_owner_publishes_and_sub_reads(owner_headers, sub_headers):
    tid = pytest.transcript_id
    r = requests.put(f"{API}/audio-transcripts/{tid}", headers=owner_headers,
                     json={"text": "testo modificato QA", "publish": True}, timeout=60)
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "published"

    r2 = requests.get(f"{API}/audio-transcripts/{tid}", headers=sub_headers, timeout=30)
    assert r2.status_code == 200
    d = r2.json()
    assert d.get("status") == "published"
    assert d.get("text") == "testo modificato QA"
    assert d.get("can_edit") is False
    assert "raw_text" not in d

    lr = requests.get(f"{API}/audio-transcripts?source_kind=cgym_reference", headers=sub_headers, timeout=30)
    assert lr.status_code == 200
    for it in lr.json()["items"]:
        assert it.get("status") == "published"


def test_reference_link_master_only(owner_headers, sub_headers):
    ref = pytest.ref_id
    rs = requests.post(f"{API}/cgym/references/{ref}/link", headers=sub_headers, timeout=30)
    assert rs.status_code == 403
    ro = requests.post(f"{API}/cgym/references/{ref}/link", headers=owner_headers, timeout=30)
    assert ro.status_code == 200
    assert ro.json().get("url")


def test_unpublish_hides_from_sub(owner_headers, sub_headers):
    tid = pytest.transcript_id
    r = requests.post(f"{API}/audio-transcripts/{tid}/unpublish", headers=owner_headers, timeout=30)
    assert r.status_code == 200
    r2 = requests.get(f"{API}/audio-transcripts/{tid}", headers=sub_headers, timeout=30)
    assert r2.status_code == 403


def test_cleanup_reference(owner_headers, area_id):
    r = requests.delete(f"{API}/cgym/references/{pytest.ref_id}", headers=owner_headers, timeout=30)
    assert r.status_code == 200


# --- courses fast + light ---
def test_courses_list_fast(owner_headers):
    t0 = time.time()
    r = requests.get(f"{API}/courses", headers=owner_headers, timeout=30)
    e = time.time() - t0
    assert r.status_code == 200, r.text
    assert e < 5, f"courses list slow: {e}s"
    d = r.json()
    assert "items" in d
    assert "can_manage" in d


def test_course_detail_light(owner_headers):
    r = requests.get(f"{API}/courses", headers=owner_headers, timeout=30)
    items = r.json().get("items") or []
    if not items:
        pytest.skip("no courses")
    cid = items[0].get("course_id") or items[0].get("id")
    r2 = requests.get(f"{API}/courses/{cid}", headers=owner_headers, timeout=30)
    assert r2.status_code == 200
    d = r2.json()
    for f in (d.get("files") or []):
        assert "data_b64" not in f
        assert "data_base64" not in f


# --- non-audio ref rejected ---
def test_ref_non_audio_video_rejected(owner_headers, area_id):
    files = {"file": ("x.txt", b"hello world, this is a plain text with more than 1000 bytes " * 50, "text/plain")}
    r = requests.post(f"{API}/cgym/areas/{area_id}/references", headers=owner_headers,
                      files=files, data={"title": "text"}, timeout=30)
    assert r.status_code == 400
    assert "audio o video" in r.text.lower() or "audio" in r.text.lower()
