"""Backend tests for V26.l bugfixes:
- Callback creation with contact_id (used by Home row tap)
- My Thing image CRUD (used by Home banner slideshow)
"""
import os
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://consulente-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    if data.get("requires_2fa"):
        pytest.skip("Test account has 2FA enabled - cannot proceed")
    token = data.get("token")
    assert token, f"No token in response: {data}"
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_contact(auth_headers):
    payload = {"first_name": "TEST_CB", "last_name": "Row", "phone": "+391112223344", "area": "energy"}
    r = requests.post(f"{API}/contacts", json=payload, headers=auth_headers, timeout=15)
    assert r.status_code in (200, 201), r.text
    contact = r.json()
    cid = contact.get("contact_id") or contact.get("id")
    assert cid
    yield cid
    requests.delete(f"{API}/contacts/{cid}", headers=auth_headers, timeout=10)


# --- Callback flow (Home row tap -> contact) ---
class TestCallbackRow:
    def test_create_callback_linked_to_contact(self, auth_headers, test_contact):
        now = datetime.now(timezone.utc) + timedelta(minutes=30)
        payload = {
            "title": "TEST_CB_ROW",
            "area": "energy",
            "scheduled_at": now.isoformat(),
            "contact_id": test_contact,
            "phone": "+391112223344",
            "note": "test row tap",
        }
        r = requests.post(f"{API}/callbacks", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        cb = r.json()
        cb_id = cb.get("callback_id") or cb.get("id")
        assert cb_id
        assert cb.get("contact_id") == test_contact
        # verify GET
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r2 = requests.get(f"{API}/callbacks?day={today}&include_done=true", headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        items = r2.json().get("items", [])
        found = [x for x in items if (x.get("callback_id") or x.get("id")) == cb_id]
        assert found, "Created callback not returned by /callbacks GET"
        assert found[0].get("contact_id") == test_contact
        # cleanup
        requests.delete(f"{API}/callbacks/{cb_id}", headers=auth_headers, timeout=10)

    def test_toggle_callback_done(self, auth_headers, test_contact):
        now = datetime.now(timezone.utc) + timedelta(minutes=45)
        r = requests.post(f"{API}/callbacks", json={
            "title": "TEST_CB_TOGGLE", "area": "energy",
            "scheduled_at": now.isoformat(), "contact_id": test_contact,
        }, headers=auth_headers, timeout=15)
        assert r.status_code in (200, 201)
        cb_id = r.json().get("callback_id") or r.json().get("id")
        # toggle done
        r2 = requests.put(f"{API}/callbacks/{cb_id}", json={"done": True}, headers=auth_headers, timeout=15)
        assert r2.status_code in (200, 204), r2.text
        # verify persisted
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r3 = requests.get(f"{API}/callbacks?day={today}&include_done=true", headers=auth_headers, timeout=15)
        items = r3.json().get("items", [])
        found = [x for x in items if (x.get("callback_id") or x.get("id")) == cb_id]
        assert found and found[0].get("done") is True
        requests.delete(f"{API}/callbacks/{cb_id}", headers=auth_headers, timeout=10)


# --- My Thing images (banner slideshow) ---
def _tiny_png_data_uri(color_hex: str) -> str:
    # Solid 2x2 PNG as data URI. Use different tiny payloads per color for uniqueness.
    # Instead of building real PNG per color, just embed a known 1x1 PNG and vary a note in item title.
    # But test wants distinct image_base64 values. So we vary the payload trailing bytes via a marker.
    import base64
    # 1x1 transparent PNG
    b = bytes.fromhex("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C63F8CF0000000300010000000AA36FBC0000000049454E44AE426082")
    # Append color hex bytes so the base64 differs per color (still valid data URI even if not-a-perfect PNG)
    return "data:image/png;base64," + base64.b64encode(b + color_hex.encode()).decode()


class TestMyThingImages:
    created_ids = []

    def test_create_3_images(self, auth_headers):
        colors = ["FF0000", "00FF00", "0000FF"]
        for c in colors:
            payload = {"kind": "image", "title": f"TEST_MT_{c}", "image_base64": _tiny_png_data_uri(c)}
            r = requests.post(f"{API}/my-thing", json=payload, headers=auth_headers, timeout=15)
            assert r.status_code in (200, 201), r.text
            item = r.json()
            item = item.get("item", item)
            iid = item.get("item_id") or item.get("id")
            assert iid
            TestMyThingImages.created_ids.append(iid)
        assert len(TestMyThingImages.created_ids) == 3

    def test_list_images(self, auth_headers):
        r = requests.get(f"{API}/my-thing?kind=image", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        items = r.json().get("items", [])
        our = [i for i in items if (i.get("item_id") or i.get("id")) in TestMyThingImages.created_ids]
        assert len(our) == 3
        # each has image_base64
        for i in our:
            assert i.get("image_base64", "").startswith("data:image/")

    def test_delete_images(self, auth_headers):
        for iid in TestMyThingImages.created_ids:
            r = requests.delete(f"{API}/my-thing/{iid}", headers=auth_headers, timeout=10)
            assert r.status_code in (200, 204), r.text
        TestMyThingImages.created_ids.clear()
