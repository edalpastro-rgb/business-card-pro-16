"""Tests for /api/bills/analysis-presets endpoints (V83 - Saved Presets).

Covers:
- GET /bills/analysis-config now returns {config, catalog, presets:[], active_preset_id:null}
- POST /bills/analysis-presets creates + sanitizes config
- POST with same name (case-insensitive) upserts (no duplicates)
- Empty name → 400
- GET /bills/analysis-presets returns {items}
- POST apply → sets active_preset_id + applies config
- PUT /bills/analysis-config with preset_id:null resets active_preset_id
- DELETE preset ok; unknown id → 404; apply unknown → 404
- Tenant isolation: owner presets visible to sub (same tenant), NOT to other tenant
"""
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}
OTHER = {"email": "demo@advisoros.it", "password": "Demo1234!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER)


@pytest.fixture(scope="module")
def sub_token():
    return _login(SUB)


@pytest.fixture(scope="module")
def other_token():
    return _login(OTHER)


def _clear_all_presets(tok):
    r = requests.get(f"{API}/bills/analysis-presets", headers=_hdr(tok), timeout=15)
    if r.status_code == 200:
        for p in r.json().get("items", []):
            requests.delete(f"{API}/bills/analysis-presets/{p['preset_id']}", headers=_hdr(tok), timeout=15)


@pytest.fixture(autouse=True, scope="module")
def cleanup(owner_token, other_token):
    _clear_all_presets(owner_token)
    _clear_all_presets(other_token)
    requests.post(f"{API}/bills/analysis-config/reset", headers=_hdr(owner_token), timeout=15)
    requests.post(f"{API}/bills/analysis-config/reset", headers=_hdr(other_token), timeout=15)
    yield
    _clear_all_presets(owner_token)
    _clear_all_presets(other_token)
    requests.post(f"{API}/bills/analysis-config/reset", headers=_hdr(owner_token), timeout=15)
    requests.post(f"{API}/bills/analysis-config/reset", headers=_hdr(other_token), timeout=15)


# --- GET analysis-config bundle shape ---
def test_get_bundle_includes_presets_and_active_preset_id(owner_token):
    r = requests.get(f"{API}/bills/analysis-config", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "config" in data
    assert "catalog" in data
    assert "presets" in data
    assert isinstance(data["presets"], list)
    assert data["presets"] == []
    assert "active_preset_id" in data
    assert data["active_preset_id"] is None


# --- Create preset + sanitization ---
def test_create_preset_sanitizes_config(owner_token):
    body = {"name": "Business", "config": {"comparison": {"layout": "dossier"}, "unknown_top": "x"}}
    r = requests.post(f"{API}/bills/analysis-presets", headers=_hdr(owner_token), json=body, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    p = data["preset"]
    assert p["name"] == "Business"
    assert p["config"]["comparison"]["layout"] == "dossier"
    # sanitized defaults for others
    assert p["config"]["comparison"]["style"] == "classico"
    assert p["config"]["comparison"]["basis"] == "annuo"
    assert p["config"]["fields"]["luce"]["pod"] is True
    assert "unknown_top" not in p["config"]
    assert isinstance(data["items"], list) and len(data["items"]) == 1


def test_create_same_name_case_insensitive_updates(owner_token):
    # 'business' should hit existing 'Business'
    body = {"name": "business", "config": {"comparison": {"layout": "sintesi"}}}
    r = requests.post(f"{API}/bills/analysis-presets", headers=_hdr(owner_token), json=body, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    # Items length must stay 1
    assert len(data["items"]) == 1, data["items"]
    # Layout updated to sintesi
    assert data["preset"]["config"]["comparison"]["layout"] == "sintesi"
    # Name updated to 'business' (input) — spec says update in place
    assert data["preset"]["name"].lower() == "business"


def test_create_empty_name_returns_400(owner_token):
    r = requests.post(f"{API}/bills/analysis-presets", headers=_hdr(owner_token), json={"name": "  "}, timeout=15)
    assert r.status_code == 400, r.text


# --- List / Apply / Deactivate ---
def test_list_presets_returns_items(owner_token):
    r = requests.get(f"{API}/bills/analysis-presets", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)
    assert len(data["items"]) >= 1


def test_apply_preset_sets_active_and_config(owner_token):
    # Ensure 'Business' preset has layout dossier
    body = {"name": "Business", "config": {"comparison": {"layout": "dossier"}}}
    rc = requests.post(f"{API}/bills/analysis-presets", headers=_hdr(owner_token), json=body, timeout=15)
    assert rc.status_code == 200
    pid = rc.json()["preset"]["preset_id"]

    r = requests.post(f"{API}/bills/analysis-presets/{pid}/apply", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["active_preset_id"] == pid
    assert data["config"]["comparison"]["layout"] == "dossier"
    assert "catalog" in data and "presets" in data


def test_put_config_with_preset_id_null_resets_active(owner_token):
    body = {"config": {"comparison": {"layout": "presentazione"}}, "preset_id": None}
    r = requests.put(f"{API}/bills/analysis-config", headers=_hdr(owner_token), json=body, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["active_preset_id"] is None


# --- Delete ---
def test_delete_preset_ok_and_unknown_404(owner_token):
    # Create a throwaway preset
    rc = requests.post(f"{API}/bills/analysis-presets", headers=_hdr(owner_token),
                       json={"name": "TEST_ToDelete", "config": {}}, timeout=15)
    assert rc.status_code == 200
    pid = rc.json()["preset"]["preset_id"]

    r = requests.delete(f"{API}/bills/analysis-presets/{pid}", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    assert "items" in data
    # Confirm gone
    ids = [p["preset_id"] for p in data["items"]]
    assert pid not in ids

    # Delete again → 404
    r2 = requests.delete(f"{API}/bills/analysis-presets/{pid}", headers=_hdr(owner_token), timeout=15)
    assert r2.status_code == 404


def test_apply_unknown_preset_404(owner_token):
    r = requests.post(f"{API}/bills/analysis-presets/bap_unknown_xxx/apply",
                      headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 404


# --- Tenant isolation ---
def test_tenant_isolation_presets(owner_token, sub_token, other_token):
    # Create marker preset on owner
    body = {"name": "TEST_TenantMarker", "config": {"comparison": {"layout": "dossier"}}}
    rc = requests.post(f"{API}/bills/analysis-presets", headers=_hdr(owner_token), json=body, timeout=15)
    assert rc.status_code == 200
    pid = rc.json()["preset"]["preset_id"]

    # Sub-user same tenant sees it
    r_sub = requests.get(f"{API}/bills/analysis-presets", headers=_hdr(sub_token), timeout=15)
    assert r_sub.status_code == 200
    sub_ids = [p["preset_id"] for p in r_sub.json()["items"]]
    assert pid in sub_ids, f"sub tenant should see owner preset, got {sub_ids}"

    # Other tenant does NOT see it
    r_other = requests.get(f"{API}/bills/analysis-presets", headers=_hdr(other_token), timeout=15)
    assert r_other.status_code == 200
    other_ids = [p["preset_id"] for p in r_other.json()["items"]]
    assert pid not in other_ids, f"other tenant should not see owner preset, got {other_ids}"

    # Other tenant cannot delete owner preset
    r_del = requests.delete(f"{API}/bills/analysis-presets/{pid}", headers=_hdr(other_token), timeout=15)
    assert r_del.status_code == 404

    # Other tenant cannot apply owner preset
    r_ap = requests.post(f"{API}/bills/analysis-presets/{pid}/apply", headers=_hdr(other_token), timeout=15)
    assert r_ap.status_code == 404
