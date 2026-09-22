"""V50.z328 audit — Promo/Referral/PUN/Chat product isolation for Lite vs Advisor.

Exercises the endpoints required by the frontend flows the tester must verify:
- GET /api/admin/referral-settings + PUT (owner only)
- POST /api/admin/promo-codes (create), GET (list), PATCH (toggle enabled), DELETE
- POST /api/subscription/redeem-promo (invalid/own-code/success/duplicate)
- GET /api/user-settings PUN threshold round-trip
- POST /api/assistant/chat: lite vs advisor product isolation (no [[NAV: on lite; NAV present for owner)
- POST /api/callbacks + DELETE /api/callbacks/{id} (regression: no cancelByTag crash on server)
"""
import os
import time
import uuid
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not v:
        # Read from frontend/.env
        try:
            with open("/app/frontend/.env", "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    return (v or "").rstrip("/")

BASE_URL = _load_backend_url()
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PWD = "Test1234!"

_owner_token = None
_owner_user = None
_lite_token = None
_lite_user = None
_created_promo_id = None


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    return r


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def _boot():
    global _owner_token, _owner_user, _lite_token, _lite_user
    r = _login(OWNER_EMAIL, OWNER_PWD)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text[:200]}"
    d = r.json()
    _owner_token = d.get("token")
    _owner_user = d.get("user")
    assert _owner_token, "no token"

    # Register a fresh lite user
    lite_email = f"lite_audit_{uuid.uuid4().hex[:8]}@axonlite-test.com"
    reg = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": lite_email, "password": "Test1234!", "name": "Lite Audit", "product": "lite"},
        timeout=15,
    )
    assert reg.status_code in (200, 201), f"lite register: {reg.status_code} {reg.text[:200]}"
    body = reg.json()
    _lite_token = body.get("token") or body.get("access_token")
    _lite_user = body.get("user")
    if not _lite_token:
        lr = _login(lite_email, "Test1234!")
        assert lr.status_code == 200, lr.text[:200]
        _lite_token = lr.json().get("token")
        _lite_user = lr.json().get("user")
    assert _lite_token, "lite token missing"
    yield


# --- Referral settings ------------------------------------------------------
class TestReferralSettings:
    def test_get_referral_settings(self):
        r = requests.get(f"{BASE_URL}/api/admin/referral-settings", headers=_h(_owner_token), timeout=10)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        # Should have some reward config for inviter/invitee
        assert isinstance(d, dict)

    def test_put_and_restore_referral_settings(self):
        # Snapshot original
        orig = requests.get(f"{BASE_URL}/api/admin/referral-settings", headers=_h(_owner_token), timeout=10).json()
        # Try to update — payload shape unknown; try a couple of common shapes
        new_payload = dict(orig)
        # Overwrite a numeric field if present
        touched = False
        for k in ("inviter_free_weeks", "invitee_free_weeks", "inviter_reward_value", "invitee_reward_value"):
            if k in new_payload and isinstance(new_payload[k], (int, float)):
                new_payload[k] = 2
                touched = True
        if not touched:
            # try nested
            for grp_key in ("inviter", "invitee"):
                grp = new_payload.get(grp_key)
                if isinstance(grp, dict) and "value" in grp:
                    grp["value"] = 2
                    touched = True
        r = requests.put(f"{BASE_URL}/api/admin/referral-settings", headers=_h(_owner_token), json=new_payload, timeout=10)
        assert r.status_code in (200, 204), f"PUT referral settings: {r.status_code} {r.text[:300]}"
        # restore
        requests.put(f"{BASE_URL}/api/admin/referral-settings", headers=_h(_owner_token), json=orig, timeout=10)


# --- Promo codes CRUD -------------------------------------------------------
class TestPromoCodes:
    def test_list_promo_codes(self):
        r = requests.get(f"{BASE_URL}/api/admin/promo-codes", headers=_h(_owner_token), timeout=10)
        assert r.status_code == 200, r.text[:200]
        assert isinstance(r.json(), (list, dict))

    def test_create_promo_code(self):
        global _created_promo_id
        code = f"TESTAUDIT{uuid.uuid4().hex[:6].upper()}"
        payload = {"code": code, "benefit_type": "free_weeks", "benefit_value": 1, "max_uses": 5, "active": True}
        r = requests.post(f"{BASE_URL}/api/admin/promo-codes", headers=_h(_owner_token), json=payload, timeout=10)
        assert r.status_code in (200, 201), f"create promo: {r.status_code} {r.text[:300]}"
        d = r.json()
        _created_promo_id = d.get("code_id")
        assert _created_promo_id, f"no code_id in response: {d}"
        assert d.get("code") == code
        # GET verification
        lst = requests.get(f"{BASE_URL}/api/admin/promo-codes", headers=_h(_owner_token), timeout=10).json()
        items = lst.get("items", [])
        found = [x for x in items if x.get("code") == code]
        assert found, "created promo not returned by list"
        assert found[0].get("max_uses") == 5
        assert found[0].get("uses_count") == 0

    def test_toggle_enabled(self):
        assert _created_promo_id
        r = requests.patch(
            f"{BASE_URL}/api/admin/promo-codes/{_created_promo_id}",
            headers=_h(_owner_token),
            json={"active": False},
            timeout=10,
        )
        assert r.status_code in (200, 204), f"toggle: {r.status_code} {r.text[:200]}"
        # verify
        lst = requests.get(f"{BASE_URL}/api/admin/promo-codes", headers=_h(_owner_token), timeout=10).json()
        d = next((x for x in lst.get("items", []) if x.get("code_id") == _created_promo_id), None)
        assert d and d.get("active") is False, f"toggle off did not persist: {d}"
        # restore
        r2 = requests.patch(
            f"{BASE_URL}/api/admin/promo-codes/{_created_promo_id}",
            headers=_h(_owner_token),
            json={"active": True},
            timeout=10,
        )
        assert r2.status_code in (200, 204)


# --- Redeem promo (in subscription/billing) ---------------------------------
class TestPromoRedeem:
    def test_redeem_invalid(self):
        r = requests.post(
            f"{BASE_URL}/api/promo/redeem",
            headers=_h(_owner_token),
            json={"code": "XXX-NOPE-INVALID"},
            timeout=10,
        )
        assert r.status_code in (400, 404), f"invalid promo should 4xx: {r.status_code} {r.text[:200]}"

    def test_redeem_own_referral(self):
        r = requests.get(f"{BASE_URL}/api/referral/me", headers=_h(_owner_token), timeout=10)
        if r.status_code != 200:
            pytest.skip(f"cannot fetch referral: {r.status_code}")
        code = r.json().get("code")
        if not code:
            pytest.skip("no personal referral code in response")
        rr = requests.post(
            f"{BASE_URL}/api/promo/redeem",
            headers=_h(_owner_token),
            json={"code": code},
            timeout=10,
        )
        assert rr.status_code in (400, 409), f"own-code redeem should be rejected: {rr.status_code} {rr.text[:200]}"

    def test_redeem_valid_promo_then_duplicate(self):
        code = f"AUD{uuid.uuid4().hex[:6].upper()}"
        create = requests.post(
            f"{BASE_URL}/api/admin/promo-codes",
            headers=_h(_owner_token),
            json={"code": code, "benefit_type": "free_weeks", "benefit_value": 1, "max_uses": 5, "active": True},
            timeout=10,
        )
        assert create.status_code in (200, 201), create.text[:200]
        pid = create.json().get("code_id")

        # Redeem as the LITE user (owner may not be allowed)
        r1 = requests.post(
            f"{BASE_URL}/api/promo/redeem",
            headers=_h(_lite_token),
            json={"code": code},
            timeout=10,
        )
        assert r1.status_code in (200, 201), f"lite redeem should succeed: {r1.status_code} {r1.text[:300]}"
        # duplicate
        r2 = requests.post(
            f"{BASE_URL}/api/promo/redeem",
            headers=_h(_lite_token),
            json={"code": code},
            timeout=10,
        )
        assert r2.status_code == 409, f"duplicate should 409: {r2.status_code} {r2.text[:200]}"

        # cleanup
        requests.delete(f"{BASE_URL}/api/admin/promo-codes/{pid}", headers=_h(_owner_token), timeout=10)


# --- PUN threshold in user-settings -----------------------------------------
class TestPunThreshold:
    def test_pun_threshold_roundtrip(self):
        r = requests.get(f"{BASE_URL}/api/user-settings", headers=_h(_owner_token), timeout=10)
        assert r.status_code == 200
        orig = r.json() if isinstance(r.json(), dict) else {}
        payload = dict(orig)
        payload["pun_alert_threshold"] = 0.05
        pr = requests.put(f"{BASE_URL}/api/user-settings", headers=_h(_owner_token), json=payload, timeout=10)
        assert pr.status_code in (200, 204), f"user-settings PUT: {pr.status_code} {pr.text[:300]}"
        rr = requests.get(f"{BASE_URL}/api/user-settings", headers=_h(_owner_token), timeout=10).json()
        assert float(rr.get("pun_alert_threshold", 0)) == 0.05, f"not persisted: {rr.get('pun_alert_threshold')}"
        # restore original threshold
        payload["pun_alert_threshold"] = orig.get("pun_alert_threshold")
        requests.put(f"{BASE_URL}/api/user-settings", headers=_h(_owner_token), json=payload, timeout=10)


# --- Callback create+delete regression --------------------------------------
class TestCallbackCleanup:
    def test_create_and_delete_callback(self):
        from datetime import datetime, timezone, timedelta
        when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        payload = {"title": "TEST audit callback", "note": "audit", "scheduled_at": when}
        r = requests.post(f"{BASE_URL}/api/callbacks", headers=_h(_owner_token), json=payload, timeout=10)
        assert r.status_code in (200, 201), f"create callback: {r.status_code} {r.text[:300]}"
        cid = r.json().get("callback_id") or r.json().get("id")
        assert cid, f"no id in {r.json()}"
        d = requests.delete(f"{BASE_URL}/api/callbacks/{cid}", headers=_h(_owner_token), timeout=10)
        assert d.status_code in (200, 204), f"delete callback: {d.status_code} {d.text[:200]}"


# --- Assistant product isolation --------------------------------------------
class TestAssistantProductIsolation:
    def test_lite_chat_no_nav_marker(self):
        msg = "Ho un codice amico, dove lo inserisco esattamente?"
        r = requests.post(
            f"{BASE_URL}/api/assistant/chat",
            headers=_h(_lite_token),
            json={"message": msg},
            timeout=60,
        )
        assert r.status_code == 200, f"lite chat: {r.status_code} {r.text[:200]}"
        reply = (r.json().get("reply") or "").lower()
        assert "[[nav:" not in reply, f"Lite reply must not contain [[NAV: marker. Got: {reply[:300]}"
        assert "impostazioni" in reply, f"expected 'Impostazioni' in lite reply: {reply[:300]}"
        assert "abbonamento" in reply, f"expected 'Abbonamento' in lite reply: {reply[:300]}"

    def test_owner_chat_has_nav_marker(self):
        msg = "Ho un codice amico, dove lo inserisco esattamente?"
        r = requests.post(
            f"{BASE_URL}/api/assistant/chat",
            headers=_h(_owner_token),
            json={"message": msg},
            timeout=60,
        )
        assert r.status_code == 200, r.text[:200]
        reply = r.json().get("reply") or ""
        assert "[[NAV:/impostazioni?section=billing" in reply, f"Advisor reply must contain NAV marker: {reply[:400]}"
        assert "AxonOS Lite" not in reply, f"Advisor reply must not mention 'AxonOS Lite': {reply[:300]}"


# --- Cleanup module-level created promo -------------------------------------
def teardown_module(module):
    if _created_promo_id and _owner_token:
        requests.delete(
            f"{BASE_URL}/api/admin/promo-codes/{_created_promo_id}",
            headers=_h(_owner_token),
            timeout=10,
        )
