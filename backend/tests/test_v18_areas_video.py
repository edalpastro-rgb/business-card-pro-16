"""v1.8 backend tests:
- Settings.custom_areas (PUT/GET persistence, shape)
- Contact.additional_areas (POST/GET/PUT)
- GET /api/contacts?area=X matches area OR additional_areas (network + custom_area_id)
- ContactNote kind='video' with video_base64 + video_mime
- Backward compat: contact CRUD without additional_areas still works
- Combined filter ?area=X&q=text ($and internal, no OR conflicts)
- Regression light-touch on /api/bulk/email + /api/bulk/preview + /api/chat/* + /api/groups/* + /api/smtp/*
"""
import os
import uuid
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://business-card-pro-16.preview.emergentagent.com"
).rstrip("/")

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
SUB = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    assert "token" in j
    return j["token"], j["user"]


@pytest.fixture(scope="module")
def owner_auth():
    return _login(OWNER)


@pytest.fixture(scope="module")
def sub_auth():
    return _login(SUB)


@pytest.fixture
def owner_h(owner_auth):
    return {"Authorization": f"Bearer {owner_auth[0]}", "Content-Type": "application/json"}


@pytest.fixture
def sub_h(sub_auth):
    return {"Authorization": f"Bearer {sub_auth[0]}", "Content-Type": "application/json"}


# =========================
# Module-level cleanup registry
# =========================
_CREATED_CONTACTS: list = []


def _cleanup_contacts(headers):
    for cid in list(_CREATED_CONTACTS):
        try:
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=headers, timeout=15)
        except Exception:
            pass
    _CREATED_CONTACTS.clear()


# =========================
# Settings.custom_areas
# =========================
class TestSettingsCustomAreas:
    def test_get_settings_has_custom_areas_field(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/settings", headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "custom_areas" in j, f"Settings must expose custom_areas: {j.keys()}"
        assert isinstance(j["custom_areas"], list)

    def test_put_settings_persists_custom_areas(self, owner_h):
        # Read current settings, add a custom area, PUT, verify GET
        r0 = requests.get(f"{BASE_URL}/api/settings", headers=owner_h, timeout=15)
        assert r0.status_code == 200
        current = r0.json()
        current.pop("_id", None)
        current.pop("user_id", None)

        new_area_id = f"TEST_V18_ca_{uuid.uuid4().hex[:8]}"
        new_area = {"id": new_area_id, "name": "TEST_V18_Assicurazioni", "color": "#8E44AD"}
        # Filter out any stale TEST_V18_ areas from previous runs to keep list clean
        current["custom_areas"] = [a for a in (current.get("custom_areas") or [])
                                   if not str(a.get("id", "")).startswith("TEST_V18_")] + [new_area]

        r = requests.put(f"{BASE_URL}/api/settings", headers=owner_h, json=current, timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert any(a.get("id") == new_area_id and a.get("name") == "TEST_V18_Assicurazioni"
                   for a in saved.get("custom_areas", [])), f"PUT did not return new area: {saved.get('custom_areas')}"

        # Verify persistence via fresh GET
        r2 = requests.get(f"{BASE_URL}/api/settings", headers=owner_h, timeout=15)
        assert r2.status_code == 200
        j2 = r2.json()
        assert any(a.get("id") == new_area_id for a in j2.get("custom_areas", [])), "custom_area not persisted after GET"

        # Store for later tests
        pytest.custom_area_id = new_area_id

    def test_sub_user_cannot_put_settings(self, sub_h):
        # PUT is owner-only; sub-user gets 403
        body = {"energy_title": "x", "network_title": "y", "custom_areas": []}
        r = requests.put(f"{BASE_URL}/api/settings", headers=sub_h, json=body, timeout=15)
        assert r.status_code == 403, r.text


# =========================
# Contact.additional_areas
# =========================
class TestContactAdditionalAreas:
    @classmethod
    def teardown_class(cls):
        token, _ = _login(OWNER)
        _cleanup_contacts({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    def test_create_contact_with_additional_areas(self, owner_h):
        custom_id = getattr(pytest, "custom_area_id", None)
        assert custom_id, "custom_area_id fixture from previous test not set"
        payload = {
            "first_name": "TEST_V18_Multi",
            "last_name": "Areas",
            "phone": "3330000018",
            "area": "energy",
            "additional_areas": ["network", custom_id],
        }
        r = requests.post(f"{BASE_URL}/api/contacts", headers=owner_h, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        cid = j.get("contact_id") or j.get("id")
        assert cid, f"missing contact id: {j}"
        _CREATED_CONTACTS.append(cid)
        assert j.get("additional_areas") == ["network", custom_id], j.get("additional_areas")
        pytest.contact_multi_id = cid

    def test_get_single_contact_returns_additional_areas(self, owner_h):
        cid = getattr(pytest, "contact_multi_id", None)
        assert cid
        r = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "additional_areas" in j
        custom_id = getattr(pytest, "custom_area_id")
        assert set(j["additional_areas"]) == {"network", custom_id}

    def test_update_contact_additional_areas(self, owner_h):
        cid = getattr(pytest, "contact_multi_id", None)
        assert cid
        custom_id = getattr(pytest, "custom_area_id")
        # Replace additional_areas with just custom_id
        r = requests.put(
            f"{BASE_URL}/api/contacts/{cid}",
            headers=owner_h,
            json={"additional_areas": [custom_id]},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        # Re-fetch and verify
        r2 = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("additional_areas") == [custom_id]

    def test_backward_compat_contact_without_additional_areas(self, owner_h):
        payload = {
            "first_name": "TEST_V18_Legacy",
            "last_name": "NoAdd",
            "phone": "3330000019",
            "area": "energy",
        }
        r = requests.post(f"{BASE_URL}/api/contacts", headers=owner_h, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        cid = j.get("contact_id")
        _CREATED_CONTACTS.append(cid)
        # additional_areas should default to []
        assert j.get("additional_areas") == [], j.get("additional_areas")

        # Update area only, no additional_areas — still works
        r2 = requests.put(
            f"{BASE_URL}/api/contacts/{cid}",
            headers=owner_h,
            json={"area": "network"},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        r3 = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        assert r3.status_code == 200
        assert r3.json().get("area") == "network"
        assert r3.json().get("additional_areas") == []


# =========================
# GET /contacts?area=X matches primary area OR additional_areas
# =========================
class TestAreaFilter:
    contact_energy_only_id: str | None = None
    contact_network_only_id: str | None = None
    contact_energy_plus_network_id: str | None = None
    contact_energy_plus_custom_id: str | None = None

    @classmethod
    def teardown_class(cls):
        token, _ = _login(OWNER)
        _cleanup_contacts({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    def _create(self, headers, name, area, additional_areas=None):
        payload = {
            "first_name": name,
            "last_name": "Filter",
            "phone": "3330001000",
            "area": area,
            "additional_areas": additional_areas or [],
        }
        r = requests.post(f"{BASE_URL}/api/contacts", headers=headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        cid = r.json()["contact_id"]
        _CREATED_CONTACTS.append(cid)
        return cid

    def test_setup_seed_contacts(self, owner_h):
        custom_id = getattr(pytest, "custom_area_id")
        TestAreaFilter.contact_energy_only_id = self._create(owner_h, "TEST_V18_EnergyOnly", "energy")
        TestAreaFilter.contact_network_only_id = self._create(owner_h, "TEST_V18_NetworkOnly", "network")
        TestAreaFilter.contact_energy_plus_network_id = self._create(
            owner_h, "TEST_V18_EnergyPlusNetwork", "energy", ["network"]
        )
        TestAreaFilter.contact_energy_plus_custom_id = self._create(
            owner_h, "TEST_V18_EnergyPlusCustom", "energy", [custom_id]
        )

    def test_filter_by_network_includes_additional_areas(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/contacts?area=network", headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        ids = {c["contact_id"] for c in r.json()["items"]}
        # Must include native network-only AND energy contact with 'network' in additional_areas
        assert TestAreaFilter.contact_network_only_id in ids
        assert TestAreaFilter.contact_energy_plus_network_id in ids
        # energy-only must NOT match
        assert TestAreaFilter.contact_energy_only_id not in ids

    def test_filter_by_custom_area_id(self, owner_h):
        custom_id = getattr(pytest, "custom_area_id")
        r = requests.get(f"{BASE_URL}/api/contacts?area={custom_id}", headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        ids = {c["contact_id"] for c in r.json()["items"]}
        assert TestAreaFilter.contact_energy_plus_custom_id in ids
        assert TestAreaFilter.contact_energy_only_id not in ids
        assert TestAreaFilter.contact_network_only_id not in ids

    def test_filter_by_energy_still_works(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/contacts?area=energy", headers=owner_h, timeout=15)
        assert r.status_code == 200, r.text
        ids = {c["contact_id"] for c in r.json()["items"]}
        assert TestAreaFilter.contact_energy_only_id in ids
        assert TestAreaFilter.contact_energy_plus_network_id in ids  # area=energy, plus network in add
        assert TestAreaFilter.contact_energy_plus_custom_id in ids
        assert TestAreaFilter.contact_network_only_id not in ids

    def test_combined_area_and_q_filter(self, owner_h):
        # ?area=network&q=EnergyPlusNetwork — must match only contact_energy_plus_network_id
        r = requests.get(
            f"{BASE_URL}/api/contacts?area=network&q=EnergyPlusNetwork",
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        ids = {c["contact_id"] for c in items}
        assert TestAreaFilter.contact_energy_plus_network_id in ids
        # Must NOT return energy-only or network-only that don't match name
        assert TestAreaFilter.contact_energy_only_id not in ids
        assert TestAreaFilter.contact_network_only_id not in ids

    def test_combined_area_and_q_no_match(self, owner_h):
        r = requests.get(
            f"{BASE_URL}/api/contacts?area=network&q=EnergyOnly",  # EnergyOnly has area=energy, no add
            headers=owner_h,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        ids = {c["contact_id"] for c in r.json()["items"]}
        assert TestAreaFilter.contact_energy_only_id not in ids


# =========================
# ContactNote kind='video'
# =========================
class TestContactNoteVideo:
    @classmethod
    def teardown_class(cls):
        token, _ = _login(OWNER)
        _cleanup_contacts({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    def test_create_video_note(self, owner_h):
        # Create fresh contact
        r = requests.post(
            f"{BASE_URL}/api/contacts",
            headers=owner_h,
            json={"first_name": "TEST_V18_VideoNote", "last_name": "X", "phone": "3339999018", "area": "energy"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        cid = r.json()["contact_id"]
        _CREATED_CONTACTS.append(cid)

        # Post a video note
        body = {
            "kind": "video",
            "video_base64": "data:video/mp4;base64,AAAA",
            "video_mime": "video/mp4",
            "duration_ms": 3200,
        }
        r2 = requests.post(f"{BASE_URL}/api/contacts/{cid}/notes", headers=owner_h, json=body, timeout=15)
        assert r2.status_code == 200, r2.text
        note = r2.json()
        assert note["kind"] == "video"
        assert note["video_base64"].startswith("data:video/mp4;base64,")
        assert note["video_mime"] == "video/mp4"
        assert "id" in note

        # Verify via GET single contact — notes list contains the video note
        r3 = requests.get(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
        assert r3.status_code == 200
        notes = r3.json().get("notes", [])
        assert any(n.get("kind") == "video" and n.get("video_mime") == "video/mp4" for n in notes), notes


# =========================
# Regression: existing endpoints still respond
# =========================
class TestRegressionEndpointsRespond:
    def test_groups_list_ok(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/groups", headers=owner_h, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_smtp_config_get_ok(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/smtp/config", headers=owner_h, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "configured" in j
        assert "password" not in j, "SMTP GET must NOT return password field"

    def test_bulk_preview_whatsapp_ok(self, owner_h):
        # need at least 1 contact — create a phone-having contact if needed
        payload = {"first_name": "TEST_V18_Bulk", "last_name": "Prev", "phone": "393334445566", "whatsapp": "393334445566", "area": "energy"}
        cr = requests.post(f"{BASE_URL}/api/contacts", headers=owner_h, json=payload, timeout=15)
        assert cr.status_code == 200
        cid = cr.json()["contact_id"]
        _CREATED_CONTACTS.append(cid)
        try:
            r = requests.post(
                f"{BASE_URL}/api/bulk/preview",
                headers=owner_h,
                json={"channel": "whatsapp", "contact_ids": [cid], "message": "Ciao {nome}"},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            j = r.json()
            assert "items" in j
            assert len(j["items"]) == 1
            assert j["items"][0].get("skip") in (False, True)  # existence check only
        finally:
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
            if cid in _CREATED_CONTACTS:
                _CREATED_CONTACTS.remove(cid)

    def test_bulk_email_response_shape(self, owner_h):
        # SMTP is expected populated (fake credentials from prior iteration) OR unconfigured — both acceptable.
        # Create a contact with email
        payload = {"first_name": "TEST_V18_Mail", "last_name": "T", "phone": "3331112222", "email": "TEST_V18_dest@example.com", "area": "energy"}
        cr = requests.post(f"{BASE_URL}/api/contacts", headers=owner_h, json=payload, timeout=15)
        assert cr.status_code == 200
        cid = cr.json()["contact_id"]
        _CREATED_CONTACTS.append(cid)
        try:
            r = requests.post(
                f"{BASE_URL}/api/bulk/email",
                headers=owner_h,
                json={"contact_ids": [cid], "subject": "TEST", "body_text": "Ciao {nome}", "body_html": "<p>Ciao {nome}</p>"},
                timeout=30,
            )
            # If SMTP not configured we accept 400; if configured (even with fake creds) we accept 200
            assert r.status_code in (200, 400), r.text
            if r.status_code == 200:
                j = r.json()
                assert "sent_count" in j and "failed_count" in j
        finally:
            requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=owner_h, timeout=15)
            if cid in _CREATED_CONTACTS:
                _CREATED_CONTACTS.remove(cid)

    def test_chat_channels_list_ok(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/chat/channels", headers=owner_h, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()

    def test_team_members_ok(self, owner_h):
        r = requests.get(f"{BASE_URL}/api/team/members", headers=owner_h, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json() or isinstance(r.json(), list)
