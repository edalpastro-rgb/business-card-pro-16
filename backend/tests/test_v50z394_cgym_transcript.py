"""V50.z394 — Trascrizione campione nella pagina area corporate-gym.
Backend regression:
 - GET /api/audio-transcripts?source_kind=cgym_reference as owner returns text for ref cgr_2e8ea56836
 - If draft, publish transcript atr_f6d2ba0e44a4 → PUT {publish:true}
 - Sub-user sees text present
 - cgym live start/finish still returns done with score (evaluate does not break with sample transcripts in prompt)
"""
import os
import requests
import pytest

def _load_env_url():
    for p in ("/app/frontend/.env", "/app/backend/.env"):
        try:
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL=") or line.startswith("EXPO_BACKEND_URL="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except FileNotFoundError:
            continue
    return None

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or _load_env_url()
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
BASE_URL = BASE_URL.rstrip("/") + "/api"

OWNER = ("test@dalpastro.it", "Test1234!")
SUB = ("sub1@dalpastro.it", "Sub12345!")
AREA_ID = "cga_015003b2da"
REF_ID = "cgr_2e8ea56836"
TRANSCRIPT_ID = "atr_f6d2ba0e44a4"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def sub_token():
    return _login(*SUB)


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


# --- OWNER: list transcripts for cgym_reference and (if needed) publish target ---
def test_owner_list_transcripts_and_publish(owner_token):
    r = requests.get(f"{BASE_URL}/audio-transcripts", params={"source_kind": "cgym_reference"}, headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    items = r.json().get("items", [])
    target = next((it for it in items if it.get("source_id") == REF_ID), None)
    assert target is not None, f"transcript for {REF_ID} not found; got {[i.get('source_id') for i in items]}"
    tid = target.get("transcript_id")
    print(f"owner-view target: status={target.get('status')} tid={tid} text_len={len(target.get('text') or '')}")

    if target.get("status") != "published":
        # publish it so sub-user can read it
        pr = requests.put(f"{BASE_URL}/audio-transcripts/{tid}", json={"publish": True}, headers=_hdr(owner_token), timeout=15)
        assert pr.status_code == 200, f"publish failed: {pr.status_code} {pr.text[:200]}"
        assert pr.json().get("status") == "published"

    # verify via GET one that text is present and non-empty
    g = requests.get(f"{BASE_URL}/audio-transcripts/{tid}", headers=_hdr(owner_token), timeout=15)
    assert g.status_code == 200
    body = g.json()
    assert body.get("status") == "published"
    assert (body.get("text") or "").strip(), "transcript text empty after publish"


# --- SUB-USER: list must contain the published transcript with non-empty text ---
def test_sub_user_sees_published_text(sub_token):
    r = requests.get(f"{BASE_URL}/audio-transcripts", params={"source_kind": "cgym_reference"}, headers=_hdr(sub_token), timeout=15)
    assert r.status_code == 200, r.text
    items = r.json().get("items", [])
    target = next((it for it in items if it.get("source_id") == REF_ID), None)
    assert target is not None, f"sub-user missing transcript for {REF_ID}; ids={[i.get('source_id') for i in items]}"
    assert target.get("status") == "published"
    assert (target.get("text") or "").strip(), "sub-user got empty text for published transcript"
    print(f"sub-user reads text len={len(target['text'])}")


# --- BACKEND regression: live start → finish evaluate does not break ---
def test_cgym_live_start_and_finish(owner_token):
    s = requests.post(f"{BASE_URL}/cgym/live/start", json={"area_id": AREA_ID, "training_level": "base"}, headers=_hdr(owner_token), timeout=20)
    assert s.status_code == 200, f"live/start failed: {s.status_code} {s.text[:200]}"
    sid = s.json().get("session_id")
    assert sid, "session_id missing"

    # inject a consultant turn (text mode) so evaluate has content
    t = requests.post(
        f"{BASE_URL}/cgym/live/{sid}/turn",
        json={"text": "Buongiorno, sono un consulente energetico. Le mostro il confronto con la sua bolletta attuale e le spiego i vantaggi della nostra offerta senza costi fissi, con spread ridotto e trasparenza sui parametri ARERA.", "tts": False},
        headers=_hdr(owner_token),
        timeout=60,
    )
    assert t.status_code == 200, f"live/turn failed: {t.status_code} {t.text[:300]}"

    f = requests.post(f"{BASE_URL}/cgym/live/{sid}/finish", json={}, headers=_hdr(owner_token), timeout=120)
    assert f.status_code == 200, f"live/finish failed: {f.status_code} {f.text[:400]}"
    data = f.json()
    print(f"finish resp keys={list(data.keys())}")
    assert data.get("status") == "done", f"unexpected status: {data}"
    # score may be inside the response or nested; accept any presence
    assert ("score" in data) or ("rating" in data) or ("evaluation" in data), f"missing score/rating/evaluation: {data}"
