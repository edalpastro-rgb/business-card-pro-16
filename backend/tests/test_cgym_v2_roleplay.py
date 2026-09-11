"""
Backend tests — Corporate Gym Blocco 2: Voice Role-play (Obiezione TEMPO).
Tests /api/cgym/roleplay/* endpoints.

Endpoints under test:
- POST /api/cgym/roleplay/start
- POST /api/cgym/roleplay/{id}/turn
- POST /api/cgym/roleplay/{id}/finish
- GET  /api/cgym/roleplay/{id}
Regression:
- GET /api/cgym/summary
- GET /api/cgym/sessions
"""
import base64
import os
import time
import pytest
import requests

BASE_URL = "https://business-card-pro-16.preview.emergentagent.com/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
MEMBER = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}

LLM_TIMEOUT = 90  # LLM calls can be slow


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def member_token():
    r = requests.post(f"{BASE_URL}/auth/login", json=MEMBER, timeout=30)
    assert r.status_code == 200, f"member login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# holder for cleanup: sessions created in this run
_created_sessions = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup(owner_token, member_token):
    yield
    # cleanup created cgym_sessions
    for sid, tok in _created_sessions:
        try:
            requests.delete(f"{BASE_URL}/cgym/sessions/{sid}", headers=_auth(tok), timeout=15)
        except Exception:
            pass


# ---------------- Regression: Blocco 1 ----------------
class TestBlocco1Regression:
    def test_summary(self, owner_token):
        r = requests.get(f"{BASE_URL}/cgym/summary", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("due_soon", "today_total", "today_done", "mandatory_pending", "overdue", "server_time"):
            assert k in data, f"missing key {k}"
        assert isinstance(data["due_soon"], list)

    def test_sessions_list(self, owner_token):
        r = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        assert "items" in r.json()


# ---------------- Roleplay START ----------------
class TestRoleplayStart:
    def test_start_without_session_no_tts(self, owner_token):
        r = requests.post(f"{BASE_URL}/cgym/roleplay/start", headers=_auth(owner_token),
                          json={"tts": False}, timeout=LLM_TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("roleplay_id"), "roleplay_id missing"
        assert isinstance(d.get("reply"), str) and len(d["reply"]) > 0
        assert d.get("mood") in ("chiuso", "scettico", "aperto", "convinto"), f"bad mood: {d.get('mood')}"
        assert d.get("turn") == 0
        assert d.get("max_turns") == 5
        assert d.get("ended") is False
        assert d.get("audio_base64") in (None, ""), "audio should be None when tts=false"
        pytest.rp_no_session = d["roleplay_id"]

    def test_start_with_tts_true(self, owner_token):
        r = requests.post(f"{BASE_URL}/cgym/roleplay/start", headers=_auth(owner_token),
                          json={"tts": True}, timeout=LLM_TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("audio_base64"), "audio_base64 should be non-empty when tts=true"
        # verify it decodes
        try:
            raw = base64.b64decode(d["audio_base64"])
            assert len(raw) > 100, "mp3 blob too small"
        except Exception as e:
            pytest.fail(f"audio_base64 not decodable: {e}")

    def test_start_with_own_session_sets_in_corso(self, owner_token):
        # create obiezioni session
        payload = {"type": "obiezioni", "scheduled_at": "2026-12-01T10:00:00Z",
                   "title": "TEST_RP session"}
        r = requests.post(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token),
                          json=payload, timeout=20)
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]
        _created_sessions.append((sid, owner_token))

        # start roleplay linked to session
        r2 = requests.post(f"{BASE_URL}/cgym/roleplay/start", headers=_auth(owner_token),
                           json={"session_id": sid, "tts": False}, timeout=LLM_TIMEOUT)
        assert r2.status_code == 200, r2.text
        pytest.rp_linked = r2.json()["roleplay_id"]
        pytest.rp_linked_session_id = sid

        # verify session status
        r3 = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token), timeout=20)
        assert r3.status_code == 200
        found = next((it for it in r3.json()["items"] if it["session_id"] == sid), None)
        assert found is not None, "linked session not found in list"
        assert found["status"] == "in_corso", f"expected in_corso, got {found['status']}"

    def test_start_with_other_users_session_404(self, owner_token, member_token):
        # owner creates session for himself
        r = requests.post(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token),
                          json={"type": "obiezioni", "scheduled_at": "2026-12-02T10:00:00Z",
                                "title": "TEST_RP owner-only"}, timeout=20)
        assert r.status_code == 200
        sid = r.json()["session_id"]
        _created_sessions.append((sid, owner_token))

        # member tries to start a roleplay for owner's session
        r2 = requests.post(f"{BASE_URL}/cgym/roleplay/start", headers=_auth(member_token),
                           json={"session_id": sid, "tts": False}, timeout=LLM_TIMEOUT)
        assert r2.status_code == 404, f"expected 404, got {r2.status_code}: {r2.text}"


# ---------------- Roleplay TURN ----------------
class TestRoleplayTurn:
    def test_turn_empty_text_no_audio_400(self, owner_token):
        rp = getattr(pytest, "rp_no_session", None)
        assert rp, "start test must run first"
        r = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/turn", headers=_auth(owner_token),
                          json={"text": "", "tts": False}, timeout=LLM_TIMEOUT)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_turn_other_user_404(self, owner_token, member_token):
        rp = getattr(pytest, "rp_no_session", None)
        assert rp
        r = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/turn", headers=_auth(member_token),
                          json={"text": "Salve, mi ascolti un attimo?", "tts": False}, timeout=LLM_TIMEOUT)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"

    def test_turn_valid_text(self, owner_token):
        rp = getattr(pytest, "rp_no_session", None)
        assert rp
        r = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/turn", headers=_auth(owner_token),
                          json={"text": "Capisco che sia occupato. Le rubo solo 3 minuti per capire se posso davvero farle risparmiare.",
                                "tts": False}, timeout=LLM_TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("transcript"), "transcript missing"
        assert isinstance(d.get("reply"), str) and len(d["reply"]) > 0
        assert d.get("mood") in ("chiuso", "scettico", "aperto", "convinto")
        assert d.get("turn") == 1
        assert isinstance(d.get("ended"), bool)

    def test_max_turns_ends(self, owner_token):
        """Fill up to 5 consultant turns → ended must be True after turn 5."""
        # start fresh roleplay
        r = requests.post(f"{BASE_URL}/cgym/roleplay/start", headers=_auth(owner_token),
                          json={"tts": False}, timeout=LLM_TIMEOUT)
        assert r.status_code == 200
        rp = r.json()["roleplay_id"]
        pytest.rp_maxturns = rp

        answers = [
            "Capisco, la tempo è la risorsa più preziosa. Le propongo un check di 5 minuti.",
            "Con 5 minuti posso mostrarle un risparmio medio del 15% sulla bolletta gas.",
            "Se preferisce le mando un riepilogo via email prima. Le va bene domani alle 15?",
            "In alternativa martedì alle 11 in videocall di 10 minuti — è ok?",
            "Perfetto, allora fissiamo martedì alle 11, le confermo via email.",
        ]
        last = None
        for i, txt in enumerate(answers, start=1):
            resp = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/turn", headers=_auth(owner_token),
                                 json={"text": txt, "tts": False}, timeout=LLM_TIMEOUT)
            assert resp.status_code == 200, f"turn {i} failed: {resp.status_code} {resp.text}"
            d = resp.json()
            assert d["turn"] == i, f"turn counter mismatch at {i}: {d['turn']}"
            last = d
            if d.get("ended"):
                break
        assert last is not None
        # after 5 turns ended must be true
        assert last["turn"] == 5 or last.get("ended") is True, \
            f"expected ended by turn 5, got turn={last['turn']} ended={last.get('ended')}"
        if last["turn"] == 5:
            assert last["ended"] is True, "at max_turns ended must be True"

    def test_turn_after_finish_400(self, owner_token):
        """First finish rp_maxturns, then try another turn."""
        rp = getattr(pytest, "rp_maxturns", None)
        assert rp
        # finish
        r = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/finish", headers=_auth(owner_token),
                          timeout=LLM_TIMEOUT)
        assert r.status_code == 200, r.text
        # store session for cleanup
        sid = r.json().get("session_id")
        if sid:
            _created_sessions.append((sid, owner_token))
        # try turn on finished
        r2 = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/turn", headers=_auth(owner_token),
                           json={"text": "ancora una domanda", "tts": False}, timeout=LLM_TIMEOUT)
        assert r2.status_code == 400, f"expected 400, got {r2.status_code}: {r2.text}"


# ---------------- Roleplay FINISH ----------------
class TestRoleplayFinish:
    def test_finish_linked_session_saves_score(self, owner_token):
        rp = getattr(pytest, "rp_linked", None)
        sid = getattr(pytest, "rp_linked_session_id", None)
        assert rp and sid
        # do 1 consultant turn so score>0 is possible
        rt = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/turn", headers=_auth(owner_token),
                          json={"text": "Le prometto 3 minuti soltanto, poi decide lei. Le va bene domani alle 10?",
                                "tts": False}, timeout=LLM_TIMEOUT)
        assert rt.status_code == 200, rt.text
        # finish
        r = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/finish", headers=_auth(owner_token),
                          timeout=LLM_TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "finished"
        assert isinstance(d.get("score"), int), f"score not int: {d.get('score')!r}"
        assert 0 <= d["score"] <= 100
        fb = d.get("feedback") or {}
        for k in ("score", "summary", "what_worked", "to_improve", "best_line", "suggested_answer"):
            assert k in fb, f"feedback missing key: {k}"
        assert isinstance(fb["what_worked"], list)
        assert isinstance(fb["to_improve"], list)
        # check cgym_sessions record
        rs = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token), timeout=20)
        found = next((it for it in rs.json()["items"] if it["session_id"] == sid), None)
        assert found is not None, "linked session missing after finish"
        assert found["status"] == "completata", f"session not completata: {found['status']}"
        assert int(found["score"]) == d["score"], f"session score mismatch: {found['score']} vs {d['score']}"
        assert found.get("roleplay_id") == rp

        # idempotent: call finish again
        r2 = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/finish", headers=_auth(owner_token),
                           timeout=LLM_TIMEOUT)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("score") == d["score"], "finish must be idempotent"
        assert d2.get("feedback", {}).get("summary") == fb["summary"], "feedback summary changed"

    def test_finish_zero_turns_score_zero_autosession(self, owner_token):
        """Start fresh, finish immediately (no consultant turns) → score 0 + auto-created cgym_session."""
        r = requests.post(f"{BASE_URL}/cgym/roleplay/start", headers=_auth(owner_token),
                          json={"tts": False}, timeout=LLM_TIMEOUT)
        assert r.status_code == 200
        rp = r.json()["roleplay_id"]
        r2 = requests.post(f"{BASE_URL}/cgym/roleplay/{rp}/finish", headers=_auth(owner_token),
                           timeout=LLM_TIMEOUT)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["score"] == 0, f"expected score 0, got {d['score']}"
        fb = d["feedback"]
        assert fb["score"] == 0
        assert isinstance(fb["summary"], str) and len(fb["summary"]) > 0
        # auto-created session should exist
        sid = d.get("session_id")
        assert sid, "auto-created session_id missing on roleplay after finish"
        _created_sessions.append((sid, owner_token))
        # verify title
        rs = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token), timeout=20)
        found = next((it for it in rs.json()["items"] if it["session_id"] == sid), None)
        assert found is not None, "auto session not found"
        assert found["status"] == "completata"
        assert int(found["score"]) == 0
        assert "Role-play" in (found.get("title") or "")


# ---------------- Roleplay GET ----------------
class TestRoleplayGet:
    def test_get_own(self, owner_token):
        rp = getattr(pytest, "rp_no_session", None)
        assert rp
        r = requests.get(f"{BASE_URL}/cgym/roleplay/{rp}", headers=_auth(owner_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("roleplay_id") == rp
        assert isinstance(d.get("turns"), list)
        assert len(d["turns"]) >= 1

    def test_get_other_user_404(self, owner_token, member_token):
        rp = getattr(pytest, "rp_no_session", None)
        assert rp
        r = requests.get(f"{BASE_URL}/cgym/roleplay/{rp}", headers=_auth(member_token), timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"
