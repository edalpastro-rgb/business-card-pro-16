"""Tests for /api/bills/analysis-config endpoints (GET/PUT/reset + tenant isolation)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}
OTHER = {"email": "demo@advisoros.it", "password": "Demo1234!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, f"no token in login: {r.json()}"
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


@pytest.fixture(autouse=True, scope="module")
def reset_after_tests(owner_token, other_token):
    yield
    # cleanup: leave configs at defaults
    requests.post(f"{API}/bills/analysis-config/reset", headers=_hdr(owner_token), timeout=15)
    requests.post(f"{API}/bills/analysis-config/reset", headers=_hdr(other_token), timeout=15)


# --- Auth ---
def test_get_unauth_returns_401():
    r = requests.get(f"{API}/bills/analysis-config", timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# --- Defaults & catalog shape ---
def test_get_returns_defaults_and_catalog(owner_token):
    # Ensure defaults first
    requests.post(f"{API}/bills/analysis-config/reset", headers=_hdr(owner_token), timeout=15)
    r = requests.get(f"{API}/bills/analysis-config", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "config" in data and "catalog" in data
    cfg, cat = data["config"], data["catalog"]

    # Config defaults
    assert cfg["fields"]["luce"]["pod"] is True
    assert cfg["comparison"]["layout"] == "presentazione"
    assert cfg["comparison"]["style"] == "classico"
    assert cfg["comparison"]["basis"] == "annuo"
    assert cfg["extra_instructions"] == ""

    # Catalog shape
    assert len(cat["fields"]["luce"]) == 16
    assert len(cat["layouts"]) == 3
    assert len(cat["styles"]) == 4
    assert len(cat["bases"]) == 3
    assert len(cat["sections"]) == 7


# --- PUT persistence + sanitization ---
def test_put_persists_and_sanitizes(owner_token):
    payload = {
        "config": {
            "fields": {"luce": {"pod": False, "tensione": True}},
            "custom_fields": {"luce": ["Bonus sociale"]},
            "extra_instructions": "Segnala more",
            "comparison": {
                "layout": "dossier",
                "style": "energia",
                "basis": "mensile",
                "sections": {"fasce": False},
                "custom_compare_fields": {"gas": ["Sconto fedelta"]},
                "instructions": "Evidenzia vincolo",
            },
            "unknown_top_level_key": "IGNORE_ME",
        }
    }
    r = requests.put(f"{API}/bills/analysis-config", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 200, r.text
    saved = r.json()["config"]
    assert saved["fields"]["luce"]["pod"] is False
    assert saved["fields"]["luce"]["tensione"] is True
    assert saved["custom_fields"]["luce"] == ["Bonus sociale"]
    assert saved["extra_instructions"] == "Segnala more"
    assert saved["comparison"]["layout"] == "dossier"
    assert saved["comparison"]["style"] == "energia"
    assert saved["comparison"]["basis"] == "mensile"
    assert saved["comparison"]["sections"]["fasce"] is False
    assert saved["comparison"]["custom_compare_fields"]["gas"] == ["Sconto fedelta"]
    assert saved["comparison"]["instructions"] == "Evidenzia vincolo"
    assert "unknown_top_level_key" not in saved

    # Verify persistence via GET
    r2 = requests.get(f"{API}/bills/analysis-config", headers=_hdr(owner_token), timeout=15)
    assert r2.status_code == 200
    cfg = r2.json()["config"]
    assert cfg["fields"]["luce"]["pod"] is False
    assert cfg["custom_fields"]["luce"] == ["Bonus sociale"]
    assert cfg["comparison"]["layout"] == "dossier"


def test_put_invalid_layout_falls_back_to_default(owner_token):
    # First, current stored layout is 'dossier' from prior test — verify invalid value doesn't overwrite fallback logic
    payload = {"config": {"comparison": {"layout": "xyz", "style": "moderno", "basis": "annuo"}}}
    r = requests.put(f"{API}/bills/analysis-config", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 200
    cfg = r.json()["config"]
    # Invalid 'xyz' should be ignored → defaults to "presentazione"
    assert cfg["comparison"]["layout"] == "presentazione"
    # Valid other values applied
    assert cfg["comparison"]["style"] == "moderno"


# --- Tenant isolation ---
def test_tenant_isolation(owner_token, sub_token, other_token):
    # Owner sets a distinctive config
    payload = {
        "config": {
            "fields": {"luce": {"pod": False}},
            "custom_fields": {"luce": ["Tenant test marker"]},
            "comparison": {"layout": "sintesi"},
        }
    }
    r = requests.put(f"{API}/bills/analysis-config", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 200

    # Sub-user (same tenant) sees same config
    r2 = requests.get(f"{API}/bills/analysis-config", headers=_hdr(sub_token), timeout=15)
    assert r2.status_code == 200
    sub_cfg = r2.json()["config"]
    assert sub_cfg["fields"]["luce"]["pod"] is False
    assert "Tenant test marker" in sub_cfg["custom_fields"]["luce"]
    assert sub_cfg["comparison"]["layout"] == "sintesi"

    # Other tenant sees defaults (or at least not owner's marker)
    r3 = requests.get(f"{API}/bills/analysis-config", headers=_hdr(other_token), timeout=15)
    assert r3.status_code == 200
    other_cfg = r3.json()["config"]
    assert "Tenant test marker" not in other_cfg["custom_fields"].get("luce", [])
    # For a fresh other tenant, defaults should hold (pod=True)
    assert other_cfg["fields"]["luce"]["pod"] is True


# --- Reset ---
def test_reset_returns_defaults_and_persists(owner_token):
    # Set a non-default first
    requests.put(
        f"{API}/bills/analysis-config",
        headers=_hdr(owner_token),
        json={"config": {"fields": {"luce": {"pod": False}}, "extra_instructions": "ABC"}},
        timeout=15,
    )
    # Reset
    r = requests.post(f"{API}/bills/analysis-config/reset", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200
    cfg = r.json()["config"]
    assert cfg["fields"]["luce"]["pod"] is True
    assert cfg["extra_instructions"] == ""

    # GET after reset returns defaults
    r2 = requests.get(f"{API}/bills/analysis-config", headers=_hdr(owner_token), timeout=15)
    assert r2.status_code == 200
    cfg2 = r2.json()["config"]
    assert cfg2["fields"]["luce"]["pod"] is True
    assert cfg2["comparison"]["layout"] == "presentazione"
