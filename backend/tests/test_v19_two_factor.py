"""
V19 - 2FA (TOTP) authentication flow tests
- Login with 2FA off
- Setup start/confirm (with & without valid TOTP)
- Status endpoint
- 2FA login: TOTP, backup codes (reuse blocked), replay prevention, wrong code
- Regenerate backup codes (invalidates old)
- Disable 2FA (password)
- Non-regression: normal login still returns JWT + trust_expires_at
- Cleanup: leaves owner with 2FA disabled
"""
import os
import time
import pytest
import pyotp
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASSWORD = "Test1234!"


def _login(email: str, password: str) -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _ensure_2fa_disabled(token: str):
    """If user has 2FA on, disable via password."""
    r = requests.get(f"{API}/auth/2fa/status", headers=_auth_headers(token), timeout=15)
    if r.status_code == 200 and r.json().get("enabled"):
        d = requests.post(
            f"{API}/auth/2fa/disable",
            headers=_auth_headers(token),
            json={"password": OWNER_PASSWORD},
            timeout=15,
        )
        assert d.status_code == 200, f"Could not disable pre-existing 2FA: {d.status_code} {d.text}"


@pytest.fixture(scope="module")
def clean_state():
    """Ensure owner starts with 2FA disabled. Returns (token, user)."""
    # If 2FA is currently enabled, plain /login returns requires_2fa without token; we can't disable.
    # Workaround: we need a token, but the owner may already have 2FA enabled.
    # We attempt to login. If requires_2fa is returned, this test suite cannot proceed cleanly.
    resp = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert resp.status_code == 200, f"Owner login failed: {resp.status_code} {resp.text}"
    data = resp.json()
    if data.get("requires_2fa"):
        pytest.skip(
            "Owner account has 2FA enabled from a prior session and cannot be disabled without a valid TOTP secret. "
            "Manual cleanup required (disable 2FA in DB) before this suite can run."
        )
    token = data["token"]
    user = data["user"]
    _ensure_2fa_disabled(token)
    yield token, user
    # Teardown: leave 2FA disabled
    # Re-login (2FA may have been re-enabled by tests). If requires_2fa, we can't easily disable — but tests below explicitly disable at end.
    try:
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
        if r.status_code == 200 and not r.json().get("requires_2fa"):
            _ensure_2fa_disabled(r.json()["token"])
    except Exception:
        pass


# --- Non-regression: plain login with 2FA off ---
class TestLoginPlain:
    def test_login_returns_token_and_trust(self, clean_state):
        token, user = clean_state
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and data["token"]
        assert "user" in data
        assert data["user"]["email"] == OWNER_EMAIL
        assert "trust_expires_at" in data
        assert "requires_2fa" not in data or data.get("requires_2fa") is False


# --- 2FA setup start / confirm ---
class TestTwoFASetup:
    def test_setup_start_returns_uri_qr_secret(self, clean_state):
        token, _ = clean_state
        r = requests.post(f"{API}/auth/2fa/setup/start", headers=_auth_headers(token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "otpauth_uri" in data and data["otpauth_uri"].startswith("otpauth://totp/")
        assert "qr_code_data_url" in data and data["qr_code_data_url"].startswith("data:image/png;base64,")
        assert "secret" in data and len(data["secret"]) >= 16
        pytest.shared_secret = data["secret"]

    def test_setup_confirm_invalid_code(self, clean_state):
        token, _ = clean_state
        # Must have started setup already
        assert getattr(pytest, "shared_secret", None)
        r = requests.post(
            f"{API}/auth/2fa/setup/confirm",
            headers=_auth_headers(token),
            json={"code": "000000"},
            timeout=15,
        )
        assert r.status_code == 400, f"Expected 400 for invalid code, got {r.status_code} {r.text}"

    def test_setup_confirm_valid_returns_backup_codes(self, clean_state):
        token, _ = clean_state
        secret = pytest.shared_secret
        code = pyotp.TOTP(secret).now()
        r = requests.post(
            f"{API}/auth/2fa/setup/confirm",
            headers=_auth_headers(token),
            json={"code": code},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        codes = data.get("backup_codes")
        assert isinstance(codes, list) and len(codes) == 10
        for c in codes:
            assert len(c) == 11 and c[5] == "-", f"Bad backup code format: {c}"
        pytest.backup_codes = codes

    def test_status_after_enable(self, clean_state):
        token, _ = clean_state
        r = requests.get(f"{API}/auth/2fa/status", headers=_auth_headers(token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["enabled"] is True
        assert d["backup_codes_remaining"] == 10
        assert d["enabled_at"] is not None


# --- Login flow with 2FA enabled ---
class TestTwoFALogin:
    def test_login_returns_requires_2fa(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("requires_2fa") is True
        assert "temp_token" in d and d["temp_token"]
        assert "token" not in d
        pytest.temp_token_1 = d["temp_token"]

    def test_login_2fa_wrong_code_401(self):
        r = requests.post(
            f"{API}/auth/login/2fa",
            json={"temp_token": pytest.temp_token_1, "code": "000000"},
            timeout=15,
        )
        assert r.status_code == 401, f"Expected 401 for wrong TOTP, got {r.status_code} {r.text}"

    def test_login_2fa_valid_totp(self):
        secret = pytest.shared_secret
        # Ensure we don't reuse the previous test's TOTP code (from setup confirm). Wait until next 30s window.
        # Simple approach: sleep until we get a fresh code
        prev_code = pyotp.TOTP(secret).now()
        # Wait for a new interval
        for _ in range(40):
            time.sleep(1)
            new_code = pyotp.TOTP(secret).now()
            if new_code != prev_code:
                break
        r = requests.post(
            f"{API}/auth/login/2fa",
            json={"temp_token": pytest.temp_token_1, "code": new_code},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "token" in d and d["token"]
        assert "user" in d and d["user"]["email"] == OWNER_EMAIL
        assert "trust_expires_at" in d
        assert d.get("used_backup_code") in (False, None)
        pytest.jwt_after_2fa = d["token"]
        pytest.used_totp_code = new_code

    def test_totp_replay_prevention(self):
        # Get a fresh temp token
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
        temp2 = r.json()["temp_token"]
        # Reuse the same TOTP code as previous test -> should be rejected
        r2 = requests.post(
            f"{API}/auth/login/2fa",
            json={"temp_token": temp2, "code": pytest.used_totp_code},
            timeout=15,
        )
        assert r2.status_code == 401, f"Replay should be blocked, got {r2.status_code} {r2.text}"

    def test_login_2fa_with_backup_code(self):
        # Fresh temp token
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
        temp3 = r.json()["temp_token"]
        backup = pytest.backup_codes[0]
        r2 = requests.post(
            f"{API}/auth/login/2fa",
            json={"temp_token": temp3, "code": backup},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d.get("used_backup_code") is True
        assert "token" in d and d["token"]
        assert "trust_expires_at" in d
        pytest.consumed_backup = backup

    def test_backup_code_cannot_be_reused(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
        temp4 = r.json()["temp_token"]
        r2 = requests.post(
            f"{API}/auth/login/2fa",
            json={"temp_token": temp4, "code": pytest.consumed_backup},
            timeout=15,
        )
        assert r2.status_code == 401, f"Consumed backup code should be rejected, got {r2.status_code}"

    def test_status_backup_count_decreased(self):
        # Use JWT from earlier 2FA login
        token = pytest.jwt_after_2fa
        r = requests.get(f"{API}/auth/2fa/status", headers=_auth_headers(token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["enabled"] is True
        # One backup code consumed
        assert d["backup_codes_remaining"] == 9, d


# --- Regenerate backup codes ---
class TestRegenerateBackup:
    def test_regenerate_with_valid_totp(self):
        token = pytest.jwt_after_2fa
        secret = pytest.shared_secret
        # Wait for a fresh window (to avoid reusing the earlier totp code)
        prev = pytest.used_totp_code
        for _ in range(40):
            time.sleep(1)
            c = pyotp.TOTP(secret).now()
            if c != prev:
                break
        r = requests.post(
            f"{API}/auth/2fa/regenerate-backup-codes",
            headers=_auth_headers(token),
            json={"code": c},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        new_codes = r.json().get("backup_codes")
        assert isinstance(new_codes, list) and len(new_codes) == 10
        pytest.new_backup_codes = new_codes
        pytest.regen_used_totp = c

    def test_old_backup_codes_invalidated(self):
        # An old (still-unused) backup code should now fail
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
        temp5 = r.json()["temp_token"]
        old_unused = pytest.backup_codes[1]  # index 0 was consumed earlier
        r2 = requests.post(
            f"{API}/auth/login/2fa",
            json={"temp_token": temp5, "code": old_unused},
            timeout=15,
        )
        assert r2.status_code == 401, f"Old backup code should be invalidated, got {r2.status_code}"

    def test_status_backup_reset_to_10(self):
        token = pytest.jwt_after_2fa
        r = requests.get(f"{API}/auth/2fa/status", headers=_auth_headers(token), timeout=15)
        assert r.status_code == 200
        assert r.json()["backup_codes_remaining"] == 10


# --- Disable 2FA ---
class TestDisable:
    def test_disable_with_password(self):
        token = pytest.jwt_after_2fa
        r = requests.post(
            f"{API}/auth/2fa/disable",
            headers=_auth_headers(token),
            json={"password": OWNER_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_status_after_disable(self):
        token = pytest.jwt_after_2fa
        r = requests.get(f"{API}/auth/2fa/status", headers=_auth_headers(token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["enabled"] is False
        assert d["backup_codes_remaining"] == 0

    def test_login_no_longer_requires_2fa(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("requires_2fa") in (None, False)
        assert "token" in d and d["token"]
        assert "trust_expires_at" in d
