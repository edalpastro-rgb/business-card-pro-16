"""V26.d — Master Voice Recorder fixes tests.

Covers:
- Multi-target save: same audio, multiple destinations create independent records
- Rename endpoint (PUT /audio-records/{id}/title) — success + auth + 404
- "I miei audio" listing scoped to personal + created_by == current user
"""
import os
import base64
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"


def _login(email="test@dalpastro.it", pwd="Test1234!"):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": pwd},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


DUMMY_AUDIO = base64.b64encode(b"OggS" + b"\x00" * 2048).decode()


@pytest.fixture(scope="module")
def tok():
    return _login()


@pytest.fixture(scope="module")
def contact_id(tok):
    r = requests.get(f"{BASE_URL}/api/contacts", headers=_h(tok), timeout=15)
    r.raise_for_status()
    items = r.json().get("items") or []
    if not items:
        pytest.skip("no contacts available")
    return items[0]["contact_id"]


@pytest.fixture(scope="module")
def group_id(tok):
    r = requests.post(
        f"{BASE_URL}/api/groups",
        headers=_h(tok),
        json={"name": "V26d Test Group", "area": "energy", "color": "#7C3AED"},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"cannot create group: {r.status_code}")
    gid = r.json()["group_id"]
    yield gid
    requests.delete(f"{BASE_URL}/api/groups/{gid}", headers=_h(tok), timeout=15)


class TestMultiTargetSave:
    """Bug fix #1 — multi-destination save simulated with N parallel POSTs."""

    def test_multi_target_save_creates_independent_records(self, tok, contact_id, group_id):
        title = "TEST_v26d_multi"
        created = []
        payloads = [
            {"target_type": "personal", "target_id": None},
            {"target_type": "contact", "target_id": contact_id},
            {"target_type": "group", "target_id": group_id},
        ]
        try:
            for p in payloads:
                body = {
                    "target_type": p["target_type"],
                    "audio_base64": DUMMY_AUDIO,
                    "mime": "audio/webm",
                    "title": title,
                    "duration_sec": 3,
                }
                if p["target_id"]:
                    body["target_id"] = p["target_id"]
                r = requests.post(
                    f"{BASE_URL}/api/audio-records",
                    headers=_h(tok),
                    json=body,
                    timeout=15,
                )
                assert r.status_code == 200, f"{p}: {r.status_code} {r.text}"
                data = r.json()
                assert data["audio_id"].startswith("aud_")
                assert data["target_type"] == p["target_type"]
                assert data.get("target_id") == p["target_id"]
                assert data["title"] == title
                created.append(data["audio_id"])

            # 3 independent audio_ids
            assert len(set(created)) == 3

            # Verify each is listed under its own target
            # Personal
            r = requests.get(
                f"{BASE_URL}/api/audio-records?target_type=personal",
                headers=_h(tok),
                timeout=15,
            )
            assert r.status_code == 200
            personal_ids = [x["audio_id"] for x in r.json()["items"]]
            assert created[0] in personal_ids

            # Contact
            r = requests.get(
                f"{BASE_URL}/api/audio-records?target_type=contact&target_id={contact_id}",
                headers=_h(tok),
                timeout=15,
            )
            contact_ids = [x["audio_id"] for x in r.json()["items"]]
            assert created[1] in contact_ids

            # Group
            r = requests.get(
                f"{BASE_URL}/api/audio-records?target_type=group&target_id={group_id}",
                headers=_h(tok),
                timeout=15,
            )
            group_ids = [x["audio_id"] for x in r.json()["items"]]
            assert created[2] in group_ids
        finally:
            for aid in created:
                requests.delete(
                    f"{BASE_URL}/api/audio-records/{aid}",
                    headers=_h(tok),
                    timeout=15,
                )


class TestRenameEndpoint:
    """Bug fix #2 — PUT /audio-records/{id}/title."""

    def test_rename_success_flow(self, tok):
        # 1) Create
        r = requests.post(
            f"{BASE_URL}/api/audio-records",
            headers=_h(tok),
            json={
                "target_type": "personal",
                "audio_base64": DUMMY_AUDIO,
                "mime": "audio/webm",
                "title": "Nome iniziale",
            },
            timeout=15,
        )
        assert r.status_code == 200
        aid = r.json()["audio_id"]
        try:
            # 2) Rename
            r = requests.put(
                f"{BASE_URL}/api/audio-records/{aid}/title",
                headers=_h(tok),
                json={"title": "Nome nuovo"},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert data.get("ok") is True
            assert data.get("title") == "Nome nuovo"

            # 3) GET verifies persistence
            r = requests.get(
                f"{BASE_URL}/api/audio-records/{aid}",
                headers=_h(tok),
                timeout=15,
            )
            assert r.status_code == 200
            assert r.json()["title"] == "Nome nuovo"
        finally:
            requests.delete(
                f"{BASE_URL}/api/audio-records/{aid}",
                headers=_h(tok),
                timeout=15,
            )

    def test_rename_requires_auth(self, tok):
        # Create one so we have a real id
        r = requests.post(
            f"{BASE_URL}/api/audio-records",
            headers=_h(tok),
            json={
                "target_type": "personal",
                "audio_base64": DUMMY_AUDIO,
                "title": "TEST_v26d_auth",
            },
            timeout=15,
        )
        assert r.status_code == 200
        aid = r.json()["audio_id"]
        try:
            r = requests.put(
                f"{BASE_URL}/api/audio-records/{aid}/title",
                json={"title": "Hacker"},
                timeout=15,
            )
            assert r.status_code == 401
        finally:
            requests.delete(
                f"{BASE_URL}/api/audio-records/{aid}",
                headers=_h(tok),
                timeout=15,
            )

    def test_rename_404_when_audio_not_found(self, tok):
        r = requests.put(
            f"{BASE_URL}/api/audio-records/aud_ffffffffffff/title",
            headers=_h(tok),
            json={"title": "Ghost"},
            timeout=15,
        )
        assert r.status_code == 404


class TestPersonalListing:
    """Bug fix #3 — 'I miei audio' listing scoped correctly."""

    def test_personal_listing_excludes_contact_and_group_records(self, tok, contact_id, group_id):
        created = {}
        try:
            # Personal
            r = requests.post(
                f"{BASE_URL}/api/audio-records",
                headers=_h(tok),
                json={
                    "target_type": "personal",
                    "audio_base64": DUMMY_AUDIO,
                    "title": "TEST_v26d_personal",
                },
                timeout=15,
            )
            assert r.status_code == 200
            created["personal"] = r.json()["audio_id"]

            # Contact
            r = requests.post(
                f"{BASE_URL}/api/audio-records",
                headers=_h(tok),
                json={
                    "target_type": "contact",
                    "target_id": contact_id,
                    "audio_base64": DUMMY_AUDIO,
                    "title": "TEST_v26d_contact",
                },
                timeout=15,
            )
            assert r.status_code == 200
            created["contact"] = r.json()["audio_id"]

            # Group
            r = requests.post(
                f"{BASE_URL}/api/audio-records",
                headers=_h(tok),
                json={
                    "target_type": "group",
                    "target_id": group_id,
                    "audio_base64": DUMMY_AUDIO,
                    "title": "TEST_v26d_group",
                },
                timeout=15,
            )
            assert r.status_code == 200
            created["group"] = r.json()["audio_id"]

            # List personal — must include only the personal one, exclude contact/group
            r = requests.get(
                f"{BASE_URL}/api/audio-records?target_type=personal",
                headers=_h(tok),
                timeout=15,
            )
            assert r.status_code == 200
            items = r.json()["items"]
            ids = {x["audio_id"] for x in items}
            assert created["personal"] in ids
            assert created["contact"] not in ids
            assert created["group"] not in ids

            # All items in personal listing must have target_type == personal
            for it in items:
                assert it["target_type"] == "personal"
        finally:
            for aid in created.values():
                requests.delete(
                    f"{BASE_URL}/api/audio-records/{aid}",
                    headers=_h(tok),
                    timeout=15,
                )
