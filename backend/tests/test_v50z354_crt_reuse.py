"""V50.z354 — CRT Compilation: doc auto-save to contact profile + reuse + parallel fill + sign date validation."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"

PRACTICE_ID_HINT = "lab_22ab6a9929a0"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def practice(hdr):
    r = requests.get(f"{API}/lab/practices", headers=hdr, timeout=30)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    items = r.json().get("items") or []
    assert items, "no practices found"
    # Prefer hinted one
    chosen = next((p for p in items if p.get("practice_id") == PRACTICE_ID_HINT), items[0])
    return chosen


# -------- Docs upload + auto-save to contact profile --------

def test_get_practice_detail(hdr, practice):
    pid = practice["practice_id"]
    r = requests.get(f"{API}/lab/practices/{pid}", headers=hdr, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "modules" in j and isinstance(j["modules"], list)
    assert "docs" in j and isinstance(j["docs"], dict)
    for m in j["modules"]:
        assert "trained" in m
    for k, e in j["docs"].items():
        assert "status" in e


def test_post_sdi_manual_and_profile_snapshot(hdr, practice):
    pid = practice["practice_id"]
    r = requests.post(
        f"{API}/lab/practices/{pid}/docs/sdi",
        headers=hdr,
        json={"manual": {"sdi_code": "ABC1234"}},
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    entry = r.json().get("entry") or {}
    assert entry.get("status") == "uploaded"
    assert (entry.get("extracted") or {}).get("sdi_code") == "ABC1234"

    # contact should now have crt_docs.sdi
    cid = practice["contact_id"]
    r2 = requests.get(f"{API}/contacts/{cid}", headers=hdr, timeout=30)
    assert r2.status_code == 200
    cj = r2.json()
    crt_docs = cj.get("crt_docs") or {}
    assert "sdi" in crt_docs, f"crt_docs.sdi missing on contact — keys: {list(crt_docs.keys())}"
    assert (crt_docs["sdi"].get("extracted") or {}).get("sdi_code") == "ABC1234"


def test_contacts_list_no_crt_docs(hdr):
    r = requests.get(f"{API}/contacts", headers=hdr, timeout=30)
    assert r.status_code == 200
    j = r.json()
    items = j if isinstance(j, list) else j.get("items", [])
    for it in items:
        assert "crt_docs" not in it, f"crt_docs leaking in list on contact {it.get('contact_id')}"


def test_new_practice_reuses_sdi_from_profile(hdr, practice):
    cid = practice["contact_id"]
    r = requests.post(f"{API}/lab/practices", headers=hdr, json={"contact_id": cid}, timeout=60)
    assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
    p = r.json()
    new_pid = p["practice_id"]
    try:
        sdi = (p.get("docs") or {}).get("sdi") or {}
        assert sdi.get("status") == "uploaded", f"expected uploaded, got {sdi.get('status')} — {sdi}"
        reused = sdi.get("reused_from") or ""
        assert reused.startswith("Profilo cliente"), f"reused_from={reused!r}"
    finally:
        rd = requests.delete(f"{API}/lab/practices/{new_pid}", headers=hdr, timeout=30)
        assert rd.status_code == 200


# -------- Fill (parallel: compression + fill) --------

def test_fill_all_trained(hdr, practice):
    pid = practice["practice_id"]
    r0 = requests.get(f"{API}/lab/practices/{pid}", headers=hdr, timeout=30)
    modules = r0.json().get("modules") or []
    trained_ids = [m["template_id"] for m in modules if m.get("trained")]
    if not trained_ids:
        pytest.skip("no trained modules — cannot exercise fill")
    r = requests.post(f"{API}/lab/practices/{pid}/fill", headers=hdr, json={"template_ids": trained_ids}, timeout=180)
    assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
    j = r.json()
    assert isinstance(j.get("forms"), list)
    assert len(j["forms"]) == len(trained_ids), f"expected {len(trained_ids)} forms, got {len(j['forms'])}"
    assert isinstance(j.get("errors"), list)
    assert j["errors"] == [], f"errors: {j['errors']}"
    comp = j.get("compression") or {}
    assert "docs" in comp and "saved_bytes" in comp, f"missing compression stats: {comp}"


def test_fill_invalid_template_returns_400(hdr, practice):
    pid = practice["practice_id"]
    r = requests.post(f"{API}/lab/practices/{pid}/fill", headers=hdr, json={"template_ids": ["nope"]}, timeout=60)
    assert r.status_code == 400, f"expected 400, got {r.status_code} — {r.text[:200]}"


# -------- Sign date validation --------

def test_sign_valid_ddmmyyyy(hdr, practice):
    pid = practice["practice_id"]
    r = requests.put(
        f"{API}/lab/practices/{pid}/sign",
        headers=hdr,
        json={"sign_date": "15/09/2026", "sign_place": "Milano"},
        timeout=30,
    )
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    j = r.json()
    assert j.get("sign_date") == "2026-09-15"
    assert j.get("sign_place") == "Milano"
    assert j.get("forms_updated", -1) >= 0


def test_sign_invalid_iso_format(hdr, practice):
    """Backend spec: PUT sign with '2026-09-15' should be 400 per problem statement."""
    pid = practice["practice_id"]
    r = requests.put(
        f"{API}/lab/practices/{pid}/sign",
        headers=hdr,
        json={"sign_date": "2026-09-15"},
        timeout=30,
    )
    # NB: backend regex accepts YYYY-MM-DD, so likely returns 200 — that's a spec deviation.
    assert r.status_code == 400, f"backend accepted ISO date (status={r.status_code}); expected 400"


def test_sign_invalid_calendar_date(hdr, practice):
    """PUT sign_date='31/02/2026' — impossible calendar date, should be 400."""
    pid = practice["practice_id"]
    r = requests.put(
        f"{API}/lab/practices/{pid}/sign",
        headers=hdr,
        json={"sign_date": "31/02/2026"},
        timeout=30,
    )
    assert r.status_code == 400, f"backend accepted impossible date (status={r.status_code}); expected 400"
