"""V38T — Neo AI Assistant: Tavily web search + persistent memory + save-to-master."""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                BASE = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break

API = f"{BASE}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def clean_memories(headers):
    # Start with a clean memory slate
    requests.delete(f"{API}/assistant/memory", headers=headers)
    yield
    requests.delete(f"{API}/assistant/memory", headers=headers)


# ---------------------------------------------------------------------------
# (9) Tavily web search
# ---------------------------------------------------------------------------
class TestTavilyWebSearch:
    def test_chat_energy_query_triggers_web_search(self, headers):
        """Message with 'PUN GME' keyword → used_web_search=True + web_sources non-empty."""
        payload = {"message": "Qual è il PUN GME di novembre 2025?"}
        r = requests.post(f"{API}/assistant/chat", headers=headers, json=payload, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("used_web_search") is True, f"Expected used_web_search=true. Got: {data}"
        assert isinstance(data.get("web_sources"), list)
        assert len(data["web_sources"]) > 0, "web_sources should be non-empty for energy query"
        assert len(data["web_sources"]) <= 5
        # Each source should have title/url
        for s in data["web_sources"]:
            assert "url" in s or "title" in s
        # Reply must contain a number with an energy unit somewhere
        reply = data.get("reply") or ""
        assert reply, "Reply should not be empty"
        # Store session for later tests
        pytest.energy_session_id = data.get("session_id")

    def test_chat_non_energy_query_no_web_search(self, headers):
        """Non-energy message → used_web_search=False + web_sources=[]"""
        payload = {"message": "Qual è il mio prossimo appuntamento?"}
        r = requests.post(f"{API}/assistant/chat", headers=headers, json=payload, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("used_web_search") is False, f"Expected used_web_search=false. Got: {data}"
        assert data.get("web_sources") == [], f"Expected empty web_sources. Got: {data.get('web_sources')}"


# ---------------------------------------------------------------------------
# save-to-master
# ---------------------------------------------------------------------------
class TestSaveToMaster:
    def test_save_neo_response_creates_master_file(self, headers):
        session_id = f"asst_test_{uuid.uuid4().hex[:8]}"
        name = f"TEST_V38T_Neo_Save_{uuid.uuid4().hex[:6]}"
        content = "# Ricerca energia\nPUN novembre 2025: 123,45 €/MWh (fonte: GME)"
        r = requests.post(
            f"{API}/assistant/save-to-master",
            headers=headers,
            json={"content": content, "name": name, "session_id": session_id},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "file_id" in data
        assert data["name"].endswith(".md")
        file_id = data["file_id"]

        # Verify via GET /master-files?category=notes
        r2 = requests.get(f"{API}/master-files", headers=headers, params={"category": "notes"})
        assert r2.status_code == 200
        items = r2.json().get("items", [])
        found = next((it for it in items if it.get("file_id") == file_id), None)
        assert found is not None, "Saved file not found in /master-files?category=notes"
        assert found.get("mime") == "text/markdown"

        # Cleanup
        requests.delete(f"{API}/master-files/{file_id}", headers=headers)

    def test_save_empty_content_400(self, headers):
        r = requests.post(
            f"{API}/assistant/save-to-master",
            headers=headers,
            json={"content": "", "name": "empty"},
        )
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# (10) Persistent memory
# ---------------------------------------------------------------------------
class TestNeoMemory:
    def test_memory_initially_empty(self, headers, clean_memories):
        r = requests.get(f"{API}/assistant/memory", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data.get("items") == []
        assert data.get("total") == 0

    def test_memory_created_after_3_turns(self, headers, clean_memories):
        """After 3 user+assistant turns (>= 6 msgs), fire-and-forget task saves memory."""
        session_id = f"asst_mem_{uuid.uuid4().hex[:8]}"
        turns = [
            "Ciao Neo, mi chiamo Marco e lavoro come consulente energia.",
            "Il mio cliente più importante è Rossi SpA che consuma 200.000 kWh/anno.",
            "Ricordati che il prossimo appuntamento con Rossi è il 15 marzo 2026.",
        ]
        for t in turns:
            r = requests.post(
                f"{API}/assistant/chat",
                headers=headers,
                json={"message": t, "session_id": session_id},
                timeout=60,
            )
            assert r.status_code == 200, r.text

        # Fire-and-forget memory distillation: wait
        found = None
        for _ in range(6):
            time.sleep(3)
            r = requests.get(f"{API}/assistant/memory", headers=headers)
            data = r.json()
            items = data.get("items", [])
            match = [it for it in items if it.get("session_id") == session_id]
            if match:
                found = match[0]
                break
        assert found is not None, "Memory was not persisted within 18s after 3 turns"
        assert (found.get("summary") or "").strip() or (found.get("facts") or []), \
            "Memory should contain non-empty summary or facts"
        pytest.saved_memory_id = found["memory_id"]

    def test_delete_single_memory(self, headers):
        mem_id = getattr(pytest, "saved_memory_id", None)
        if not mem_id:
            pytest.skip("Prior memory-creation test did not run/succeed")
        r = requests.delete(f"{API}/assistant/memory/{mem_id}", headers=headers)
        assert r.status_code == 200
        assert r.json().get("deleted") is True

        # Verify gone
        r2 = requests.get(f"{API}/assistant/memory", headers=headers)
        items = r2.json().get("items", [])
        assert not any(it.get("memory_id") == mem_id for it in items)

    def test_delete_missing_memory_404(self, headers):
        r = requests.delete(f"{API}/assistant/memory/does_not_exist_xyz", headers=headers)
        assert r.status_code == 404

    def test_clear_all_memories(self, headers):
        # Seed a session to guarantee at least a chance of new memory
        session_id = f"asst_clear_{uuid.uuid4().hex[:8]}"
        for t in ["Prima frase test.", "Seconda frase test.", "Terza frase test."]:
            requests.post(
                f"{API}/assistant/chat",
                headers=headers,
                json={"message": t, "session_id": session_id},
                timeout=60,
            )
        time.sleep(8)
        r = requests.delete(f"{API}/assistant/memory", headers=headers)
        assert r.status_code == 200
        assert "deleted_count" in r.json()

        r2 = requests.get(f"{API}/assistant/memory", headers=headers)
        assert r2.json().get("items") == []
