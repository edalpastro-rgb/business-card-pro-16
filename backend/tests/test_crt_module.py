"""CRT module (Compilazione CRT) full E2E backend tests — V50.z282+"""
import os
import base64
import time
import requests
import pytest

BASE_URL = "https://business-card-pro-16.preview.emergentagent.com"
API = BASE_URL.rstrip("/") + "/api"
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"

# Seed data — DO NOT DELETE
SEED_PRACTICE = "crt_816f069a80c0"
SEED_CONTACT = "c_9319b9eb3c95"
SEED_BILLS = [f"bill_crt{i}" for i in range(5)]
SEED_TEMPLATE = "ftpl_d4ed4208aa1b"

# Minimal 1x1 PNG (base64)
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert "token" in data, f"no token field, got keys: {list(data.keys())}"
    return data["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_practice_id(headers):
    """Create a throwaway practice for destructive tests"""
    r = requests.post(f"{API}/crt", json={"contact_id": SEED_CONTACT, "services": ["luce", "gas"]}, headers=headers, timeout=30)
    assert r.status_code == 200, r.text[:300]
    pid = r.json()["practice_id"]
    yield pid
    # cleanup
    try:
        requests.delete(f"{API}/crt/{pid}", headers=headers, timeout=10)
    except Exception:
        pass


# ------------------------------- LIST -------------------------------
def test_list_crt(headers):
    r = requests.get(f"{API}/crt", headers=headers, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "items" in j
    assert "doc_types" in j
    # verify seed practice exists
    ids = [it.get("practice_id") for it in j["items"]]
    assert SEED_PRACTICE in ids, f"seed practice missing. got: {ids[:10]}"


def test_seed_practice_get(headers):
    r = requests.get(f"{API}/crt/{SEED_PRACTICE}", headers=headers, timeout=30)
    assert r.status_code == 200, r.text[:300]
    p = r.json()
    for k in ("dossier", "per_service", "available_bills", "available_identity_docs", "filled_forms", "doc_types"):
        assert k in p, f"missing key {k}"
    assert "luce" in p["services"]


# ------------------------------- CREATE -------------------------------
def test_create_practice(created_practice_id, headers):
    r = requests.get(f"{API}/crt/{created_practice_id}", headers=headers, timeout=30)
    assert r.status_code == 200
    p = r.json()
    assert p["contact_id"] == SEED_CONTACT
    assert set(p["services"]) == {"luce", "gas"}
    assert p["status"] == "bozza"


# ------------------------------- SERVICES -------------------------------
def test_service_luce_bills_and_overrides(created_practice_id, headers):
    # Attach 3 bills - one with 8 real months, force supplies
    r = requests.put(
        f"{API}/crt/{created_practice_id}/services/luce",
        json={"bill_ids": SEED_BILLS[:3]},
        headers=headers,
        timeout=60,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["service"] == "luce"
    supplies = body.get("supplies") or []
    assert len(supplies) >= 1, "no supplies after bill attach"
    # Check annual_method categories
    methods = [s.get("annual_method") for s in supplies]
    print(f"annual_methods: {methods}")

    # Test supply override
    sup_id = supplies[0]["supply_id"]
    r2 = requests.put(
        f"{API}/crt/{created_practice_id}/services/luce",
        json={"supply_overrides": {sup_id: {"annual": 5500}}},
        headers=headers,
        timeout=30,
    )
    assert r2.status_code == 200
    updated = r2.json()["supplies"]
    found = [s for s in updated if s["supply_id"] == sup_id]
    assert found and found[0].get("overrides", {}).get("annual") == 5500, "override not persisted"


# ------------------------------- DOSSIER -------------------------------
def test_dossier_referent_manual(created_practice_id, headers):
    r = requests.post(
        f"{API}/crt/{created_practice_id}/dossier/referent",
        json={"manual": {"referent_name": "Mario Rossi", "referent_phone": "3331234567", "referent_email": "mario@example.it"}},
        headers=headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text[:300]
    entry = r.json()["entry"]
    assert entry["manual"]["referent_name"] == "Mario Rossi"


def test_dossier_visura_upload(created_practice_id, headers):
    """AI extraction may return sparse fields — just ensure 200 and no crash."""
    r = requests.post(
        f"{API}/crt/{created_practice_id}/dossier/visura",
        json={"name": "visura_test.png", "mime": "image/png", "data_base64": TINY_PNG_B64},
        headers=headers,
        timeout=120,
    )
    # Accept 200 (AI ran) — reject 500 crash
    assert r.status_code == 200, f"visura upload failed: {r.status_code} {r.text[:300]}"
    j = r.json()
    assert j["doc_type"] == "visura"


# ------------------------------- FILL FORMS -------------------------------
def test_fill_luce_form(created_practice_id, headers):
    r = requests.post(
        f"{API}/crt/{created_practice_id}/services/luce/fill",
        json={"template_id": SEED_TEMPLATE},
        headers=headers,
        timeout=60,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert "forms" in body
    assert body["copies"] >= 1
    assert "rows_per_form" in body

    # Verify GET returns filled_forms
    r2 = requests.get(f"{API}/crt/{created_practice_id}", headers=headers, timeout=30)
    assert r2.status_code == 200
    forms = r2.json().get("filled_forms") or []
    assert len(forms) >= 1


# ------------------------------- MERGE + SHARE -------------------------------
def test_merge_and_share(created_practice_id, headers):
    r = requests.post(
        f"{API}/crt/{created_practice_id}/merge",
        json={"include_dossier": True},
        headers=headers,
        timeout=120,
    )
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body.get("mime") == "application/pdf"
    assert body.get("data_base64")
    assert body.get("name")

    # GET merged
    r2 = requests.get(f"{API}/crt/{created_practice_id}/merged", headers=headers, timeout=30)
    assert r2.status_code == 200
    assert r2.json().get("mime") == "application/pdf"

    # Share link
    r3 = requests.post(f"{API}/crt/{created_practice_id}/share-link", headers=headers, timeout=30)
    assert r3.status_code == 200, r3.text[:300]
    j = r3.json()
    assert "url" in j and "qr_png_base64" in j and "expires_at" in j
    url = j["url"]

    # Public download — no auth
    r4 = requests.get(url, timeout=30)
    assert r4.status_code == 200, f"public download failed: {r4.status_code}"
    assert r4.headers.get("content-type", "").startswith("application/pdf"), r4.headers.get("content-type")


# ------------------------------- STATUS + SETTINGS -------------------------------
def test_status_update(created_practice_id, headers):
    r = requests.put(f"{API}/crt/{created_practice_id}", json={"status": "completa"}, headers=headers, timeout=30)
    assert r.status_code == 200
    assert r.json()["status"] == "completa"


def test_settings_order(headers):
    r = requests.get(f"{API}/crt/settings/order", headers=headers, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "doc_order" in j and isinstance(j["doc_order"], list)
    assert "labels" in j


# ------------------------------- DELETE (last) -------------------------------
def test_delete_practice(headers):
    """Create a fresh practice just for delete test to avoid contaminating cleanup fixture"""
    r = requests.post(f"{API}/crt", json={"contact_id": SEED_CONTACT, "services": ["luce"]}, headers=headers, timeout=30)
    assert r.status_code == 200
    pid = r.json()["practice_id"]
    r2 = requests.delete(f"{API}/crt/{pid}", headers=headers, timeout=30)
    assert r2.status_code == 200
    # Verify gone
    r3 = requests.get(f"{API}/crt/{pid}", headers=headers, timeout=10)
    assert r3.status_code == 404
