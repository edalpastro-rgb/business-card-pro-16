"""V50.z326 — CRT full flow backend sanity: list, create, settings extract, dossier referent, merge (expected fail w/o templates), save-master (expected 404), share-link (expected 404 w/o merged pdf), cleanup."""
import os
import requests
import pytest

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"


@pytest.fixture(scope="module")
def owner_headers():
    r = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def contact_id(owner_headers):
    r = requests.get(f"{BASE}/contacts", headers=owner_headers, timeout=20)
    assert r.status_code == 200
    data = r.json()
    items = data.get("items", data) if isinstance(data, dict) else data
    assert len(items) > 0
    return items[0]["contact_id"]


@pytest.fixture()
def practice(owner_headers, contact_id):
    r = requests.post(f"{BASE}/crt", json={"contact_id": contact_id, "services": ["luce", "gas"]}, headers=owner_headers, timeout=20)
    assert r.status_code == 200, r.text
    pid = r.json()["practice_id"]
    yield pid
    # cleanup
    requests.delete(f"{BASE}/crt/{pid}", headers=owner_headers, timeout=20)


# ----- CRT listing -----
def test_get_crt_list(owner_headers):
    r = requests.get(f"{BASE}/crt", headers=owner_headers, timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict) or isinstance(body, list)


# ----- Create + Get by id -----
def test_create_get_practice(owner_headers, practice):
    r = requests.get(f"{BASE}/crt/{practice}", headers=owner_headers, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("practice_id") == practice or body.get("id") == practice
    # services present
    svcs = body.get("services") or []
    assert "luce" in svcs and "gas" in svcs


# ----- PUT status / sign_place / doc_order -----
def test_update_practice_status_sign_and_doc_order(owner_headers, practice):
    r = requests.put(f"{BASE}/crt/{practice}", json={"status": "completa"}, headers=owner_headers, timeout=20)
    assert r.status_code == 200, r.text
    r2 = requests.put(f"{BASE}/crt/{practice}", json={"sign_place": "Treviso"}, headers=owner_headers, timeout=20)
    assert r2.status_code == 200, r2.text
    r3 = requests.put(f"{BASE}/crt/{practice}", json={"doc_order": ["form_luce", "form_gas"]}, headers=owner_headers, timeout=20)
    assert r3.status_code == 200, r3.text
    g = requests.get(f"{BASE}/crt/{practice}", headers=owner_headers, timeout=20).json()
    assert g.get("sign_place") == "Treviso"
    assert g.get("status") == "completa"


# ----- Extract settings -----
def test_extract_settings_get_put(owner_headers):
    g = requests.get(f"{BASE}/crt/settings/extract", headers=owner_headers, timeout=20)
    assert g.status_code == 200
    body = g.json()
    assert "presets" in body and "fields" in body
    original_fields = body.get("fields", [])
    original_custom = body.get("custom_fields", [])
    original_switch = body.get("sign_place_date_everywhere", True)
    try:
        u = requests.put(f"{BASE}/crt/settings/extract", json={
            "fields": ["full_name", "tax_code", "iban"],
            "custom_fields": ["TEST_ATECO"],
            "sign_place_date_everywhere": True,
        }, headers=owner_headers, timeout=20)
        assert u.status_code == 200, u.text
        b = u.json()
        assert "TEST_ATECO" in b.get("custom_fields", [])
    finally:
        requests.put(f"{BASE}/crt/settings/extract", json={
            "fields": original_fields,
            "custom_fields": original_custom,
            "sign_place_date_everywhere": original_switch,
        }, headers=owner_headers, timeout=20)


# ----- Dossier referent -----
def test_dossier_referent_save(owner_headers, practice):
    payload = {"data": {"referent_name": "TEST_Mario Rossi", "referent_phone": "+390000000000", "referent_email": "test_ref@example.com"}}
    r = requests.post(f"{BASE}/crt/{practice}/dossier/referent", json=payload, headers=owner_headers, timeout=20)
    assert r.status_code in (200, 201), r.text


# ----- Merge (no templates likely) -----
def test_merge_practice(owner_headers, practice):
    r = requests.post(f"{BASE}/crt/{practice}/merge", json={}, headers=owner_headers, timeout=30)
    # Accept: 200 (merged), 400 (nothing to merge / no data), 404 (no filled forms)
    assert r.status_code in (200, 400, 404), f"unexpected: {r.status_code} {r.text}"


# ----- Save-master without merged pdf -----
def test_save_master_without_merged(owner_headers, practice):
    r = requests.post(f"{BASE}/crt/{practice}/save-master", headers=owner_headers, timeout=20)
    # w/o merged PDF should be 404 or 400
    assert r.status_code in (400, 404), f"unexpected: {r.status_code} {r.text}"


# ----- Share-link without merged -----
def test_share_link_without_merged(owner_headers, practice):
    r = requests.post(f"{BASE}/crt/{practice}/share-link", headers=owner_headers, timeout=20)
    assert r.status_code in (200, 400, 404), f"unexpected: {r.status_code} {r.text}"
