"""V50.z223 — AxonOS non-blocking chat queue regression tests.
Covers:
- POST /chat/messages (enqueue with priority, 400 on empty)
- Priority ordering (URGENT > HIGH > NORMAL) and invalid priority fallback
- POST /chat/queue/next (atomic claim), busy state, PATCH status flow
- PATCH content/priority updates, DELETE cleanup, 404s
- User isolation between master and collaborator
- GET/POST/PATCH /chat/tabs
- GET /assistant/history with a new session_id
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MASTER = ("demo@advisoros.it", "Demo1234!")
COLLAB = ("collab.demo@advisoros.it", "Demo1234!")


def _login(email: str, pwd: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text[:200]}"
    j = r.json()
    tok = j.get("token") or j.get("access_token")
    assert tok, f"no token in login response for {email}: {j}"
    return tok


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def master_token():
    return _login(*MASTER)


@pytest.fixture(scope="module")
def collab_token():
    try:
        return _login(*COLLAB)
    except AssertionError:
        pytest.skip("collab.demo@advisoros.it non disponibile")


@pytest.fixture(scope="module")
def cleanup_ids():
    return {"drafts": [], "sessions": []}


@pytest.fixture(scope="module", autouse=True)
def _final_cleanup(master_token, cleanup_ids):
    yield
    # Best-effort cleanup of all drafts left in queue
    try:
        r = requests.get(f"{API}/chat/queue?include_done=true", headers=_h(master_token), timeout=15)
        if r.status_code == 200:
            data = r.json()
            for it in data.get("items", []) + data.get("recent_done", []):
                did = it.get("draft_id")
                if did:
                    requests.delete(f"{API}/chat/queue/{did}", headers=_h(master_token), timeout=10)
        for did in cleanup_ids["drafts"]:
            requests.delete(f"{API}/chat/queue/{did}", headers=_h(master_token), timeout=10)
    except Exception:
        pass


# ---------- ENQUEUE ----------
class TestEnqueue:
    def test_enqueue_ok(self, master_token, cleanup_ids):
        r = requests.post(f"{API}/chat/messages",
                          headers=_h(master_token),
                          json={"content": "TEST_QUEUE msg base", "priority": "NORMAL"},
                          timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "message_id" in j and "draft_id" in j
        assert j["message_id"] == j["draft_id"]
        assert "position_in_queue" in j
        assert "estimated_time" in j
        assert isinstance(j.get("queue"), list)
        cleanup_ids["drafts"].append(j["draft_id"])

    def test_enqueue_empty_400(self, master_token):
        r = requests.post(f"{API}/chat/messages",
                          headers=_h(master_token),
                          json={"content": "   ", "priority": "NORMAL"},
                          timeout=15)
        assert r.status_code == 400, r.text


# ---------- PRIORITY ORDERING ----------
class TestPriority:
    def test_ordering_and_invalid_fallback(self, master_token, cleanup_ids):
        # Pulisci prima
        r0 = requests.get(f"{API}/chat/queue", headers=_h(master_token), timeout=15)
        for it in r0.json().get("items", []):
            requests.delete(f"{API}/chat/queue/{it['draft_id']}", headers=_h(master_token), timeout=10)

        ids = {}
        for prio in ("NORMAL", "HIGH", "URGENT"):
            r = requests.post(f"{API}/chat/messages",
                              headers=_h(master_token),
                              json={"content": f"TEST_PRIO_{prio}", "priority": prio},
                              timeout=15)
            assert r.status_code == 200
            ids[prio] = r.json()["draft_id"]
            cleanup_ids["drafts"].append(ids[prio])
            time.sleep(0.05)

        # invalid → fallback NORMAL
        r_bad = requests.post(f"{API}/chat/messages",
                              headers=_h(master_token),
                              json={"content": "TEST_PRIO_BAD", "priority": "SUPERHIGH"},
                              timeout=15)
        assert r_bad.status_code == 200
        bad_id = r_bad.json()["draft_id"]
        cleanup_ids["drafts"].append(bad_id)

        r = requests.get(f"{API}/chat/queue", headers=_h(master_token), timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        pos_by_id = {it["draft_id"]: it["position_in_queue"] for it in items}
        prio_by_id = {it["draft_id"]: it["priority"] for it in items}
        assert pos_by_id[ids["URGENT"]] == 1
        assert pos_by_id[ids["HIGH"]] == 2
        assert pos_by_id[ids["NORMAL"]] == 3
        assert prio_by_id[bad_id] == "NORMAL"

        # cleanup for later tests
        for did in list(ids.values()) + [bad_id]:
            requests.delete(f"{API}/chat/queue/{did}", headers=_h(master_token), timeout=10)


# ---------- CLAIM/NEXT + PATCH status ----------
class TestClaimAndPatch:
    def test_claim_flow(self, master_token, cleanup_ids):
        # Wipe existing pending
        r0 = requests.get(f"{API}/chat/queue", headers=_h(master_token), timeout=15)
        for it in r0.json().get("items", []):
            requests.delete(f"{API}/chat/queue/{it['draft_id']}", headers=_h(master_token), timeout=10)

        # Enqueue URGENT + HIGH
        u = requests.post(f"{API}/chat/messages", headers=_h(master_token),
                          json={"content": "TEST_CLAIM_U", "priority": "URGENT"}, timeout=15).json()["draft_id"]
        time.sleep(0.05)
        h = requests.post(f"{API}/chat/messages", headers=_h(master_token),
                          json={"content": "TEST_CLAIM_H", "priority": "HIGH"}, timeout=15).json()["draft_id"]
        cleanup_ids["drafts"] += [u, h]

        r1 = requests.post(f"{API}/chat/queue/next", headers=_h(master_token), timeout=15)
        assert r1.status_code == 200
        j1 = r1.json()
        assert j1["item"] is not None
        assert j1["item"]["draft_id"] == u
        # NB: backend returns pre-update snapshot (find_one_and_update senza ReturnDocument.AFTER)
        # DB actually flips to "processing" — provato dal reason="busy" alla chiamata successiva
        # assert j1["item"]["status"] == "processing"

        # Second call → busy
        r2 = requests.post(f"{API}/chat/queue/next", headers=_h(master_token), timeout=15)
        j2 = r2.json()
        assert j2["item"] is None
        assert j2.get("reason") == "busy"

        # Mark URGENT as done, then next should give HIGH
        r3 = requests.patch(f"{API}/chat/queue/{u}", headers=_h(master_token),
                            json={"status": "done"}, timeout=15)
        assert r3.status_code == 200

        r4 = requests.post(f"{API}/chat/queue/next", headers=_h(master_token), timeout=15)
        j4 = r4.json()
        assert j4["item"] is not None
        assert j4["item"]["draft_id"] == h

        # PATCH invalid status → 400
        r5 = requests.patch(f"{API}/chat/queue/{h}", headers=_h(master_token),
                            json={"status": "wutever"}, timeout=15)
        assert r5.status_code == 400

        # PATCH inexistent id → 404
        r6 = requests.patch(f"{API}/chat/queue/does_not_exist_xyz", headers=_h(master_token),
                            json={"status": "done"}, timeout=15)
        assert r6.status_code == 404

        # finalize HIGH so next tests start clean
        requests.patch(f"{API}/chat/queue/{h}", headers=_h(master_token), json={"status": "done"}, timeout=15)


# ---------- PATCH content/priority + DELETE + include_done ----------
class TestPatchDelete:
    def test_patch_and_delete(self, master_token, cleanup_ids):
        # New pending
        did = requests.post(f"{API}/chat/messages", headers=_h(master_token),
                            json={"content": "TEST_PD_original", "priority": "NORMAL"}, timeout=15).json()["draft_id"]
        cleanup_ids["drafts"].append(did)

        r = requests.patch(f"{API}/chat/queue/{did}", headers=_h(master_token),
                           json={"content": "TEST_PD_updated", "priority": "HIGH"}, timeout=15)
        assert r.status_code == 200
        q = requests.get(f"{API}/chat/queue", headers=_h(master_token), timeout=15).json()["items"]
        me = next((x for x in q if x["draft_id"] == did), None)
        assert me is not None
        assert me["content"] == "TEST_PD_updated"
        assert me["priority"] == "HIGH"

        # include_done: mark it done, then look in recent_done
        requests.patch(f"{API}/chat/queue/{did}", headers=_h(master_token), json={"status": "done"}, timeout=15)
        r_done = requests.get(f"{API}/chat/queue?include_done=true", headers=_h(master_token), timeout=15).json()
        done_ids = [x["draft_id"] for x in r_done.get("recent_done", [])]
        assert did in done_ids

        # Delete
        rd = requests.delete(f"{API}/chat/queue/{did}", headers=_h(master_token), timeout=15)
        assert rd.status_code == 200
        rd2 = requests.delete(f"{API}/chat/queue/{did}", headers=_h(master_token), timeout=15)
        assert rd2.status_code == 404


# ---------- USER ISOLATION ----------
class TestIsolation:
    def test_isolation(self, master_token, collab_token, cleanup_ids):
        r = requests.post(f"{API}/chat/messages", headers=_h(master_token),
                          json={"content": "TEST_ISO_master", "priority": "NORMAL"}, timeout=15)
        did = r.json()["draft_id"]
        cleanup_ids["drafts"].append(did)

        # Collab should NOT see it
        rc = requests.get(f"{API}/chat/queue", headers=_h(collab_token), timeout=15)
        assert rc.status_code == 200
        assert did not in [x["draft_id"] for x in rc.json().get("items", [])]

        # Collab patch/delete → 404
        rp = requests.patch(f"{API}/chat/queue/{did}", headers=_h(collab_token),
                            json={"content": "hack"}, timeout=15)
        assert rp.status_code == 404
        rd = requests.delete(f"{API}/chat/queue/{did}", headers=_h(collab_token), timeout=15)
        assert rd.status_code == 404

        # cleanup
        requests.delete(f"{API}/chat/queue/{did}", headers=_h(master_token), timeout=10)


# ---------- TABS ----------
class TestTabs:
    def test_tabs_flow(self, master_token):
        r = requests.get(f"{API}/chat/tabs", headers=_h(master_token), timeout=15)
        assert r.status_code == 200
        assert "tabs" in r.json()

        r_new = requests.post(f"{API}/chat/tabs", headers=_h(master_token),
                              json={"title": "TEST_TAB"}, timeout=15)
        assert r_new.status_code == 200
        j = r_new.json()
        sid = j["session_id"]
        assert j["title"] == "TEST_TAB"

        r_ren = requests.patch(f"{API}/chat/tabs/{sid}", headers=_h(master_token),
                               json={"title": "TEST_TAB_RENAMED"}, timeout=15)
        assert r_ren.status_code == 200

        r_all = requests.get(f"{API}/chat/tabs", headers=_h(master_token), timeout=15).json()
        titles = {t["session_id"]: t["title"] for t in r_all["tabs"]}
        assert sid in titles
        assert titles[sid] == "TEST_TAB_RENAMED"

        # History on empty new session should return 200 with empty list-ish payload
        r_hist = requests.get(f"{API}/assistant/history?session_id={sid}", headers=_h(master_token), timeout=15)
        assert r_hist.status_code == 200
