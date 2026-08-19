"""V38I backend tests:
1. Business card OCR bug fix (/api/ai/contact-from-card) — no more 502
2. Profile branding fields (company_name, company_logo_base64) round-trip
3. Regression: login shape + contacts list shape
"""
import base64
import io
import os
import pytest
import requests

# Load public backend URL from frontend/.env (single source of truth)
def _load_backend_url():
    env_path = "/app/frontend/.env"
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found")

BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    # V38I regression sanity
    assert "token" in data, "Login response must include 'token'"
    assert "user" in data
    assert "trust_expires_at" in data
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


def _make_business_card_jpeg_b64():
    """Generate a synthetic business card JPEG (400x250) via PIL."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (400, 250), color="white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
    except Exception:
        font = ImageFont.load_default()
        font_small = ImageFont.load_default()
    d.text((20, 20), "Mario Rossi", fill="black", font=font)
    d.text((20, 55), "CEO", fill="#444444", font=font_small)
    d.text((20, 90), "Acme SRL", fill="black", font=font_small)
    d.text((20, 130), "mario@acme.it", fill="black", font=font_small)
    d.text((20, 160), "+39 335 1234567", fill="black", font=font_small)
    d.text((20, 190), "www.acme.it", fill="black", font=font_small)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# =========================
# 1) Business Card OCR
# =========================
class TestBusinessCardOCR:
    def test_unauthenticated_returns_401(self):
        r = requests.post(f"{API}/ai/contact-from-card",
                          json={"image_base64": "abc", "mime": "image/jpeg"},
                          timeout=30)
        # Accept 401 or 403 (auth-missing)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text[:200]}"

    def test_empty_image_returns_400(self, auth_headers):
        r = requests.post(f"{API}/ai/contact-from-card",
                          json={"image_base64": "", "mime": "image/jpeg"},
                          headers=auth_headers, timeout=30)
        assert r.status_code == 400, f"Expected 400 for empty image, got {r.status_code}: {r.text[:200]}"
        assert "mancante" in r.text.lower() or "immagine" in r.text.lower()

    def test_valid_card_returns_200_or_422_never_502(self, auth_headers):
        b64 = _make_business_card_jpeg_b64()
        data_url = f"data:image/jpeg;base64,{b64}"
        r = requests.post(f"{API}/ai/contact-from-card",
                          json={"image_base64": data_url, "mime": "image/jpeg"},
                          headers=auth_headers, timeout=120)
        # Critical assertion: no more 502
        assert r.status_code != 502, f"REGRESSION: still 502! body={r.text[:500]}"
        assert r.status_code in (200, 422), f"Unexpected status {r.status_code}: {r.text[:500]}"
        if r.status_code == 200:
            data = r.json()
            assert "contact" in data, f"Response missing 'contact' key: {data}"
            assert isinstance(data["contact"], dict), f"'contact' must be dict, got {type(data['contact'])}"
            print(f"OCR contact extracted: {data['contact']}")
        else:
            # 422 acceptable if LLM quota exhausted / image unreadable
            print(f"OCR returned 422 (acceptable fallback): {r.text[:300]}")

    def test_bare_base64_no_data_url_prefix(self, auth_headers):
        """Ensure server auto-prefixes data URL if only bare base64 is provided."""
        b64 = _make_business_card_jpeg_b64()
        r = requests.post(f"{API}/ai/contact-from-card",
                          json={"image_base64": b64, "mime": "image/jpeg"},
                          headers=auth_headers, timeout=120)
        assert r.status_code != 502
        assert r.status_code in (200, 422), f"Unexpected {r.status_code}: {r.text[:300]}"


# =========================
# 2) Profile Branding
# =========================
# 1x1 transparent PNG
TINY_PNG_B64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="


class TestProfileBranding:
    def test_set_company_branding(self, auth_headers):
        payload = {
            "company_name": "Dal Pastro Consulting Test",
            "company_logo_base64": TINY_PNG_B64,
        }
        r = requests.put(f"{API}/auth/profile", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code == 200, f"PUT profile failed: {r.status_code} {r.text}"
        data = r.json()
        assert "user" in data
        u = data["user"]
        assert u.get("company_name") == "Dal Pastro Consulting Test", f"company_name mismatch: {u}"
        assert u.get("company_logo_base64") == TINY_PNG_B64, "company_logo_base64 not echoed"

    def test_get_me_persists_branding(self, auth_headers):
        r = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        u = r.json()["user"]
        assert u.get("company_name") == "Dal Pastro Consulting Test"
        assert u.get("company_logo_base64") == TINY_PNG_B64
        # Regression: additional_emails still there
        assert "additional_emails" in u
        assert isinstance(u["additional_emails"], list)

    def test_clear_logo_via_empty_string(self, auth_headers):
        r = requests.put(f"{API}/auth/profile",
                         json={"company_logo_base64": ""},
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200, f"clear logo failed: {r.status_code} {r.text}"
        u = r.json()["user"]
        # Empty string treated as "cleared"
        assert u.get("company_logo_base64") in ("", None), f"Logo not cleared: {u.get('company_logo_base64')!r}"
        # company_name must still be intact
        assert u.get("company_name") == "Dal Pastro Consulting Test"

        # Confirm via GET /me
        r2 = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        u2 = r2.json()["user"]
        assert u2.get("company_logo_base64") in ("", None)

    def test_additional_emails_roundtrip_regression(self, auth_headers):
        emails = ["backup1@dalpastro.it", "backup2@dalpastro.it"]
        r = requests.put(f"{API}/auth/profile",
                         json={"additional_emails": emails},
                         headers=auth_headers, timeout=30)
        assert r.status_code == 200
        u = r.json()["user"]
        assert set(u.get("additional_emails", [])) == set(emails)

        r2 = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        assert set(r2.json()["user"].get("additional_emails", [])) == set(emails)


# =========================
# 3) Regression sanity
# =========================
class TestRegressions:
    def test_login_response_shape(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "token" in j and "user" in j and "trust_expires_at" in j
        # NOT 'access_token'
        assert "access_token" not in j

    def test_contacts_list_shape(self, auth_headers):
        r = requests.get(f"{API}/contacts", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "items" in j and isinstance(j["items"], list)
        # sanity: sort desc by created_at, so first item created_at >= last
        if len(j["items"]) >= 2:
            first = j["items"][0].get("created_at", "")
            last = j["items"][-1].get("created_at", "")
            assert first >= last, f"Not sorted desc: {first!r} < {last!r}"
