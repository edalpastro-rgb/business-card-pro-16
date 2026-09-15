# V50.z257 Tour Guidato conversazionale — backend tests
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, data
    return tok


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- GET /tour/features ----------
class TestTourFeatures:
    def test_features_unauthorized(self):
        r = requests.get(f"{API}/tour/features", timeout=15)
        assert r.status_code in (401, 403)

    def test_features_ok(self, hdr):
        r = requests.get(f"{API}/tour/features", headers=hdr, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "groups" in data
        groups = data["groups"]
        assert isinstance(groups, list) and len(groups) >= 6
        names = {g["group"] for g in groups}
        for expected in ["CRM", "Energia", "Documenti", "AxonOS", "Comunicazioni", "Master", "Impostazioni"]:
            assert expected in names, f"Missing group {expected}. Got {names}"
        for g in groups:
            assert isinstance(g["items"], list) and len(g["items"]) > 0
            for it in g["items"]:
                assert "id" in it and "name" in it


# ---------- POST /tour/profile ----------
class TestTourProfile:
    def test_profile_answers(self, hdr):
        payload = {"answers": [
            "Sono consulente energia, perdo tempo con le bollette dei clienti",
            "Confronto offerte",
            "Voglio risparmiare tempo sul giro visite",
        ]}
        r = requests.post(f"{API}/tour/profile", headers=hdr, json=payload, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        feats = data.get("features") or []
        assert 3 <= len(feats) <= 4, f"Expected 3-4 features got {len(feats)}"
        # Get catalog for validation
        cat = requests.get(f"{API}/tour/features", headers=hdr, timeout=15).json()
        valid_ids = {it["id"] for g in cat["groups"] for it in g["items"]}
        for f in feats:
            assert f["id"] in valid_ids
            assert f["name"]
        assert isinstance(data.get("reply"), str) and len(data["reply"]) > 0

    def test_profile_empty_400(self, hdr):
        r = requests.post(f"{API}/tour/profile", headers=hdr, json={"answers": []}, timeout=30)
        assert r.status_code == 400

    def test_profile_legacy_text(self, hdr):
        r = requests.post(f"{API}/tour/profile", headers=hdr,
                          json={"text": "faccio il networker e gestisco collaboratori"}, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("features"), list) and len(data["features"]) >= 3


# ---------- POST /tour/contact-from-text ----------
class TestTourContact:
    def test_contact_extract(self, hdr):
        payload = {"text": "Mario Rossi elettricista di Treviso 333 1234567 mario.rossi@example.com"}
        r = requests.post(f"{API}/tour/contact-from-text", headers=hdr, json=payload, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        c = data.get("contact") or {}
        assert c.get("first_name"), f"first_name missing: {c}"
        assert c.get("phone") or c.get("email"), f"phone/email missing: {c}"

    def test_contact_short_400(self, hdr):
        r = requests.post(f"{API}/tour/contact-from-text", headers=hdr, json={"text": "ab"}, timeout=30)
        assert r.status_code == 400
