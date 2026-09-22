# V50.z314 — Landing public demo-request + Axon proactive bubble tests
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    if data.get("requires_2fa"):
        pytest.skip("owner has 2FA enabled")
    return data["token"]


@pytest.fixture
def auth_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


# ---------- Public demo-request ----------
class TestPublicDemoRequest:
    def test_success_creates_lead(self):
        payload = {
            "full_name": "Test Demo Agent",
            "company": "Agenzia Test",
            "phone": "+39 320 1112233",
            "email": "demo@test.it",
            "consent_privacy": True,
        }
        r = requests.post(f"{BASE_URL}/api/public/demo-request", json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        assert j.get("ok") is True
        assert j.get("lead_id", "").startswith("lead_")

    def test_validation_short_name(self):
        r = requests.post(f"{BASE_URL}/api/public/demo-request", json={
            "full_name": "L", "company": "Az", "phone": "+39 320 1112233", "consent_privacy": True,
        }, timeout=15)
        assert r.status_code == 422

    def test_validation_short_phone(self):
        r = requests.post(f"{BASE_URL}/api/public/demo-request", json={
            "full_name": "Test Demo Agent", "company": "Az", "phone": "12", "consent_privacy": True,
        }, timeout=15)
        assert r.status_code == 422

    def test_consent_false_rejected(self):
        r = requests.post(f"{BASE_URL}/api/public/demo-request", json={
            "full_name": "Test Demo Agent", "company": "Az", "phone": "+39 320 1112233", "consent_privacy": False,
        }, timeout=15)
        assert r.status_code == 400

    def test_honeypot_ignored(self, auth_headers):
        # Send with honeypot filled; must return 200 OK but NOT save a lead
        marker = "HONEY_TEST_XYZ_UNIQUE"
        r = requests.post(f"{BASE_URL}/api/public/demo-request", json={
            "full_name": marker, "company": "ShouldNotSave", "phone": "+39 320 9999999",
            "consent_privacy": True, "website": "http://spam.example",
        }, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j.get("ok") is True
        assert "lead_id" not in j  # no lead created
        # Verify not present in owner leads
        rl = requests.get(f"{BASE_URL}/api/leads", headers=auth_headers, timeout=15)
        assert rl.status_code == 200
        items = rl.json().get("items", [])
        assert not any(it.get("full_name") == marker for it in items), "Honeypot lead was saved!"


# ---------- Owner-side verification ----------
class TestOwnerLeadsAndAxon:
    def test_lead_visible_to_owner(self, auth_headers):
        rl = requests.get(f"{BASE_URL}/api/leads", headers=auth_headers, timeout=15)
        assert rl.status_code == 200
        items = rl.json().get("items", [])
        matching = [it for it in items if it.get("full_name") == "Test Demo Agent" and it.get("company") == "Agenzia Test"]
        assert matching, "Test Demo Agent lead not found in owner /api/leads"
        lead = matching[0]
        assert lead.get("source") == "landing_demo"
        assert lead.get("status") in ("new", "analyzed")
        assert (lead.get("free_text") or "").startswith("Richiesta DEMO dalla landing pubblica")

    def test_axon_proactive_item_present(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/axon/proactive/items?home=true", headers=auth_headers, timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        items = data.get("items") if isinstance(data, dict) else data
        assert items is not None, f"unexpected shape: {data}"
        demo_items = [it for it in items if it.get("type") == "lead_demo"]
        assert demo_items, "no lead_demo type in proactive items"
        # at least one contains Test Demo Agent / Agenzia Test in body/message
        blob = " ".join([str(it.get("body") or "") + " " + str(it.get("message") or "") + " " + str(it.get("title") or "") for it in demo_items])
        assert "Test Demo Agent" in blob, f"'Test Demo Agent' not in bubble bodies: {blob[:400]}"
        assert "Agenzia Test" in blob, f"'Agenzia Test' not in bubble bodies: {blob[:400]}"
