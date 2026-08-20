"""V38V — Business card public HTML + vCard endpoint + link_title/visual_effect fields
+ PCV also for gas + regression tests.
"""
import os
import base64
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def business_card(headers):
    """Ensure a business card exists with populated fields, return the card dict."""
    payload = {
        "display_name": "TEST V38V DalPastro",
        "role": "Consulente Energetico",
        "company": "Dal Pastro Consulting",
        "phone": "+393331234567",
        "email": "test@dalpastro.it",
        "website": "https://example.com",
        "address": "Via Roma 1, Venezia",
        "note": "Biglietto di test V38V",
        "link_title": "Biglietto V38V",
        "visual_effect": "shimmer",
    }
    r = requests.put(f"{API}/master/business-card", headers=headers, json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- (1) Business Card fields: link_title + visual_effect ----------
class TestBusinessCardFields:
    def test_put_link_title_and_visual_effect(self, headers, business_card):
        assert business_card.get("link_title") == "Biglietto V38V"
        assert business_card.get("visual_effect") == "shimmer"
        assert business_card.get("card_id")

    def test_get_returns_new_fields(self, headers, business_card):
        r = requests.get(f"{API}/master/business-card", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("link_title") == "Biglietto V38V"
        assert d.get("visual_effect") == "shimmer"

    def test_visual_effect_invalid_rejected(self, headers):
        r = requests.put(
            f"{API}/master/business-card",
            headers=headers,
            json={"visual_effect": "invalid_effect"},
            timeout=15,
        )
        assert r.status_code == 400, f"Expected 400 but got {r.status_code}: {r.text}"

    def test_visual_effect_border_ok(self, headers):
        r = requests.put(
            f"{API}/master/business-card",
            headers=headers,
            json={"visual_effect": "border"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("visual_effect") == "border"
        # Restore to shimmer for next tests
        requests.put(
            f"{API}/master/business-card",
            headers=headers,
            json={"visual_effect": "shimmer"},
            timeout=15,
        )

    def test_link_title_max_length(self, headers):
        # 201 chars — should be rejected (max 200)
        long = "x" * 201
        r = requests.put(
            f"{API}/master/business-card",
            headers=headers,
            json={"link_title": long},
            timeout=15,
        )
        # Reset link_title regardless of outcome (for downstream tests)
        try:
            requests.put(
                f"{API}/master/business-card",
                headers=headers,
                json={"link_title": "Biglietto V38V"},
                timeout=15,
            )
        except Exception:
            pass
        # Should be validation error 400/422
        assert r.status_code in (400, 422), f"Expected 400/422 got {r.status_code}: {r.text[:200]}"


# ---------- (2) Public HTML endpoint ----------
class TestPublicHtmlEndpoint:
    def test_public_html_content_type(self, business_card):
        card_id = business_card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{card_id}", timeout=15)
        assert r.status_code == 200, r.text[:500]
        ct = r.headers.get("content-type", "").lower()
        assert "text/html" in ct, f"Expected text/html, got {ct}"

    def test_public_html_contains_link_title(self, business_card):
        card_id = business_card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{card_id}", timeout=15)
        assert r.status_code == 200
        body = r.text
        # link_title text should appear in the page
        assert "Biglietto V38V" in body, "link_title not found in HTML"

    def test_public_html_contains_shimmer_effect(self, business_card):
        card_id = business_card["card_id"]
        # ensure shimmer active
        r = requests.get(f"{API}/master/business-card/public/{card_id}", timeout=15)
        body = r.text
        assert ("@keyframes bc-shimmer" in body) or ("bc-shimmer" in body), \
            "shimmer keyframes not found in HTML"

    def test_public_html_contains_save_banner(self, business_card):
        card_id = business_card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{card_id}", timeout=15)
        body = r.text
        assert 'id="save-banner"' in body, "save-banner element not found"
        assert "Salva in rubrica" in body, "'Salva in rubrica' text not found"

    def test_public_html_contains_qr_image(self, business_card):
        card_id = business_card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{card_id}", timeout=15)
        body = r.text
        assert "api.qrserver.com" in body, "QR image (api.qrserver.com) not found"

    def test_public_html_contains_clickable_contacts(self, business_card):
        card_id = business_card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{card_id}", timeout=15)
        body = r.text
        assert "tel:" in body, "tel: link not found"
        assert "mailto:" in body, "mailto: link not found"

    def test_public_html_not_found(self):
        r = requests.get(f"{API}/master/business-card/public/nonexistent-card-id-xyz", timeout=15)
        assert r.status_code == 404
        ct = r.headers.get("content-type", "").lower()
        assert "text/html" in ct, f"Expected HTML error, got {ct}"

    def test_public_html_border_effect(self, headers, business_card):
        card_id = business_card["card_id"]
        # switch to border
        requests.put(
            f"{API}/master/business-card",
            headers=headers,
            json={"visual_effect": "border"},
            timeout=15,
        )
        r = requests.get(f"{API}/master/business-card/public/{card_id}", timeout=15)
        body = r.text
        assert ("bc-border-spin" in body) or ("border" in body.lower()), \
            "border-glow effect not found"
        # restore
        requests.put(
            f"{API}/master/business-card",
            headers=headers,
            json={"visual_effect": "shimmer"},
            timeout=15,
        )


# ---------- (3) vCard endpoint ----------
class TestVCardEndpoint:
    def test_vcard_content_type(self, business_card):
        card_id = business_card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{card_id}.vcf", timeout=15)
        assert r.status_code == 200, r.text[:300]
        ct = r.headers.get("content-type", "").lower()
        assert "text/vcard" in ct, f"Expected text/vcard, got {ct}"

    def test_vcard_disposition_attachment(self, business_card):
        card_id = business_card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{card_id}.vcf", timeout=15)
        cd = r.headers.get("content-disposition", "").lower()
        assert "attachment" in cd, f"Expected Content-Disposition attachment, got {cd}"
        assert ".vcf" in cd, "filename should end with .vcf"

    def test_vcard_body_structure(self, business_card):
        card_id = business_card["card_id"]
        r = requests.get(f"{API}/master/business-card/public/{card_id}.vcf", timeout=15)
        body = r.text
        assert body.startswith("BEGIN:VCARD"), f"missing BEGIN:VCARD, got: {body[:80]}"
        assert "VERSION:3.0" in body
        assert "FN:" in body
        assert "TEL" in body and "CELL" in body, "TEL;TYPE=CELL not found"
        assert "END:VCARD" in body

    def test_vcard_not_found_json(self):
        r = requests.get(f"{API}/master/business-card/public/nonexistent-id-xyz.vcf", timeout=15)
        assert r.status_code == 404
        # Should be JSON detail
        try:
            data = r.json()
            assert "detail" in data
        except Exception:
            pytest.fail(f"Expected JSON error, got: {r.text[:200]}")


# ---------- (4) Bill drafts: PCV also for gas ----------
def _tiny_pdf_b64():
    pdf = (b"%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
           b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n"
           b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\n"
           b"xref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000060 00000 n\n0000000110 00000 n\ntrailer<< /Root 1 0 R /Size 4 >>\nstartxref\n180\n%%EOF")
    return base64.b64encode(pdf).decode()


class TestPcvForGas:
    def test_gas_draft_with_pcv_marker(self, headers):
        payload = {
            "bill_type": "gas",
            "pdf_base64": _tiny_pdf_b64(),
            "pdf_name": "TEST_v38v_gas_pcv.pdf",
            "pdf_mime": "application/pdf",
            "label": "TEST-V38V-gas-pcv",
            "analysis_params": ["__verifica_pcv_annullato__=1", "Costo materia prima gas"],
        }
        r = requests.post(f"{API}/bill-drafts", headers=headers, json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        draft_id = d.get("draft_id")
        assert draft_id
        params = d.get("analysis_params") or []
        assert "__verifica_pcv_annullato__=1" in params, \
            f"PCV marker not accepted for gas: {params}"
        # verify persisted
        gr = requests.get(f"{API}/bill-drafts/{draft_id}", headers=headers, timeout=15)
        assert gr.status_code == 200
        assert "__verifica_pcv_annullato__=1" in (gr.json().get("analysis_params") or [])
        # cleanup
        requests.delete(f"{API}/bill-drafts/{draft_id}", headers=headers, timeout=15)


# ---------- (5) Regression ----------
class TestRegression:
    def test_login_ok(self):
        r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
        assert r.status_code == 200
        assert "token" in r.json()

    def test_list_contacts(self, headers):
        r = requests.get(f"{API}/contacts", headers=headers, timeout=15)
        assert r.status_code == 200

    def test_master_files(self, headers):
        r = requests.get(f"{API}/master-files", headers=headers, timeout=15)
        assert r.status_code == 200

    def test_get_business_card(self, headers):
        r = requests.get(f"{API}/master/business-card", headers=headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("card_id")
