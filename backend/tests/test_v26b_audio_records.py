"""V26.b — Audio Records (Master voice recorder) tests."""
import os, base64, pytest, requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL


def _login(email="test@dalpastro.it", pwd="Test1234!"):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pwd}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


DUMMY_AUDIO = base64.b64encode(b"OggS" + b"\x00" * 2048).decode()


@pytest.fixture(scope="module")
def tok(): return _login()


@pytest.fixture(scope="module")
def contact_id(tok):
    r = requests.get(f"{BASE_URL}/api/contacts", headers=_h(tok), timeout=15)
    return r.json()["items"][0]["contact_id"]


class TestAudioRecords:
    def test_auth_required(self):
        r = requests.post(f"{BASE_URL}/api/audio-records", json={"target_type":"personal","audio_base64":DUMMY_AUDIO}, timeout=15)
        assert r.status_code == 401

    def test_invalid_target(self, tok):
        r = requests.post(f"{BASE_URL}/api/audio-records", headers=_h(tok),
                          json={"target_type":"nope","audio_base64":DUMMY_AUDIO}, timeout=15)
        assert r.status_code == 400

    def test_missing_target_id_for_contact(self, tok):
        r = requests.post(f"{BASE_URL}/api/audio-records", headers=_h(tok),
                          json={"target_type":"contact","audio_base64":DUMMY_AUDIO}, timeout=15)
        assert r.status_code == 400

    def test_nonexistent_contact(self, tok):
        r = requests.post(f"{BASE_URL}/api/audio-records", headers=_h(tok),
                          json={"target_type":"contact","target_id":"c_ffffffffffff","audio_base64":DUMMY_AUDIO}, timeout=15)
        assert r.status_code == 404

    def test_too_small_audio(self, tok):
        r = requests.post(f"{BASE_URL}/api/audio-records", headers=_h(tok),
                          json={"target_type":"personal","audio_base64":"AAAA"}, timeout=15)
        assert r.status_code == 400

    def test_personal_create_get_delete(self, tok):
        r = requests.post(f"{BASE_URL}/api/audio-records", headers=_h(tok),
                          json={"target_type":"personal","audio_base64":DUMMY_AUDIO,"mime":"audio/webm","title":"Test personale"}, timeout=15)
        assert r.status_code == 200
        aid = r.json()["audio_id"]
        assert r.json().get("audio_base64") is None  # not returned
        # Get includes audio
        r = requests.get(f"{BASE_URL}/api/audio-records/{aid}", headers=_h(tok), timeout=15)
        assert r.status_code == 200
        assert r.json()["audio_base64"]
        # List
        r = requests.get(f"{BASE_URL}/api/audio-records?target_type=personal", headers=_h(tok), timeout=15)
        assert any(x["audio_id"] == aid for x in r.json()["items"])
        # Delete
        r = requests.delete(f"{BASE_URL}/api/audio-records/{aid}", headers=_h(tok), timeout=15)
        assert r.status_code == 200

    def test_contact_target(self, tok, contact_id):
        r = requests.post(f"{BASE_URL}/api/audio-records", headers=_h(tok),
                          json={"target_type":"contact","target_id":contact_id,"audio_base64":DUMMY_AUDIO,"mime":"audio/webm"}, timeout=15)
        assert r.status_code == 200
        aid = r.json()["audio_id"]
        # Filter list by contact
        r = requests.get(f"{BASE_URL}/api/audio-records?target_type=contact&target_id={contact_id}", headers=_h(tok), timeout=15)
        assert any(x["audio_id"] == aid for x in r.json()["items"])
        requests.delete(f"{BASE_URL}/api/audio-records/{aid}", headers=_h(tok))

    def test_group_target(self, tok):
        # Create a group first
        r = requests.post(f"{BASE_URL}/api/groups", headers=_h(tok),
                          json={"name":"Audio Test Group","area":"energy","color":"#7C3AED"}, timeout=15)
        if r.status_code != 200:
            pytest.skip(f"cannot create group: {r.status_code}")
        gid = r.json()["group_id"]
        r = requests.post(f"{BASE_URL}/api/audio-records", headers=_h(tok),
                          json={"target_type":"group","target_id":gid,"audio_base64":DUMMY_AUDIO}, timeout=15)
        assert r.status_code == 200
        aid = r.json()["audio_id"]
        # Cleanup
        requests.delete(f"{BASE_URL}/api/audio-records/{aid}", headers=_h(tok))
        requests.delete(f"{BASE_URL}/api/groups/{gid}", headers=_h(tok))

    def test_nonexistent_group(self, tok):
        r = requests.post(f"{BASE_URL}/api/audio-records", headers=_h(tok),
                          json={"target_type":"group","target_id":"g_ffff","audio_base64":DUMMY_AUDIO}, timeout=15)
        assert r.status_code == 404
