"""
Backend tests — Corporate Gym Blocco 5: new role-play scenarios COSTO / DECISORE
(area obiezioni) and WIN-WIN (area winwin, ~45 min integrated negotiation, 30 turns, phases).
Regression check: existing TEMPO scenario still works.

Endpoints under test:
- GET  /api/cgym/roleplay/scenarios       (no LLM)
- POST /api/cgym/roleplay/start           (LLM: 1 call per start; ≤ 4 total)
- POST /api/cgym/roleplay/{id}/turn       (LLM: 1 call each)
- POST /api/cgym/roleplay/{id}/finish     (LLM: 1 call; ≤ 2 total)

Cleans up all cgym_sessions it creates.
"""
import os
import pytest
import requests

BASE_URL = "https://business-card-pro-16.preview.emergentagent.com/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}

LLM_TIMEOUT = 90  # LLM can be slow (start/turn 2-20s, finish ~15s)


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# state shared across tests (kept minimal to respect LLM budget)
_state: dict = {}
_created_sessions: list = []  # list of session_id created by finish


@pytest.fixture(scope="module", autouse=True)
def _cleanup(owner_token):
    yield
    for sid in _created_sessions:
        try:
            requests.delete(f"{BASE_URL}/cgym/sessions/{sid}", headers=_auth(owner_token), timeout=15)
        except Exception:
            pass


# ---------------- 1. GET scenarios ----------------
class TestScenariosEndpoint:
    def test_scenarios_list_contains_all_four(self, owner_token):
        r = requests.get(f"{BASE_URL}/cgym/roleplay/scenarios", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        items = r.json().get("items")
        assert isinstance(items, list) and len(items) >= 4, f"expected >=4 items, got {items}"
        by_key = {it["key"]: it for it in items}
        for k in ("tempo", "costo", "decisore", "winwin"):
            assert k in by_key, f"scenario key missing: {k}"
            it = by_key[k]
            assert isinstance(it.get("label"), str) and it["label"]
            assert isinstance(it.get("objection"), str) and it["objection"]
            assert "max_turns" in it and "duration_min" in it and "area" in it
        # area assignments
        for k in ("tempo", "costo", "decisore"):
            assert by_key[k]["area"] == "obiezioni", f"{k} area should be obiezioni, got {by_key[k]['area']}"
            assert by_key[k]["max_turns"] == 5, f"{k} max_turns should be 5"
            assert by_key[k]["duration_min"] == 5, f"{k} duration_min should be 5"
        # winwin
        ww = by_key["winwin"]
        assert ww["area"] == "winwin"
        assert ww["max_turns"] == 30
        assert ww["duration_min"] == 45


# ---------------- 2. Invalid scenario → 422 ----------------
class TestInvalidScenario:
    def test_start_invalid_scenario_422(self, owner_token):
        r = requests.post(
            f"{BASE_URL}/cgym/roleplay/start",
            headers=_auth(owner_token),
            json={"scenario": "xyz", "tts": False},
            timeout=30,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"


# ---------------- 3. START — costo (obiezioni) ----------------
class TestStartCosto:
    def test_start_costo(self, owner_token):
        r = requests.post(
            f"{BASE_URL}/cgym/roleplay/start",
            headers=_auth(owner_token),
            json={"scenario": "costo", "tts": False},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("roleplay_id"), "roleplay_id missing"
        _state["rp_costo"] = d["roleplay_id"]
        assert d.get("scenario") == "costo"
        assert d.get("area") == "obiezioni", f"area should be obiezioni, got {d.get('area')}"
        assert d.get("max_turns") == 5
        assert d.get("duration_min") == 5
        assert d.get("ended") is False
        assert d.get("turn") == 0
        # ISO started_at
        started = d.get("started_at") or ""
        assert isinstance(started, str) and ("T" in started), f"started_at not ISO: {started!r}"
        # italian reply mentioning cost/price
        reply = (d.get("reply") or "").lower()
        assert len(reply) > 0
        # Look for any price/cost related italian keyword
        cost_kw = ("cost", "prezz", "car", "econom", "sconto", "€", "eur", "spend")
        assert any(k in reply for k in cost_kw), f"reply doesn't mention price/cost: {d.get('reply')!r}"


# ---------------- 4. START — decisore (obiezioni) ----------------
class TestStartDecisore:
    def test_start_decisore(self, owner_token):
        r = requests.post(
            f"{BASE_URL}/cgym/roleplay/start",
            headers=_auth(owner_token),
            json={"scenario": "decisore", "tts": False},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("roleplay_id")
        _state["rp_decisore"] = d["roleplay_id"]
        assert d.get("area") == "obiezioni"
        assert d.get("max_turns") == 5
        assert d.get("duration_min") == 5
        assert d.get("ended") is False
        # italian reply about needing to consult partner/dottore/socio
        reply = (d.get("reply") or "").lower()
        assert len(reply) > 0
        decisore_kw = ("socio", "dottor", "marito", "titolar", "decid", "parlarne", "le faccio sapere", "sentir")
        assert any(k in reply for k in decisore_kw), f"reply doesn't mention decisore: {d.get('reply')!r}"


# ---------------- 5. START — winwin (area winwin, 30 turns, 45 min, phase '1 ·') ----------------
class TestWinwinFlow:
    def test_start_winwin(self, owner_token):
        r = requests.post(
            f"{BASE_URL}/cgym/roleplay/start",
            headers=_auth(owner_token),
            json={"scenario": "winwin", "tts": False},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("roleplay_id")
        _state["rp_winwin"] = d["roleplay_id"]
        assert d.get("area") == "winwin", f"area should be winwin, got {d.get('area')}"
        assert d.get("max_turns") == 30
        assert d.get("duration_min") == 45
        assert d.get("ended") is False
        assert isinstance(d.get("reply"), str) and len(d["reply"]) > 0

    def test_winwin_one_turn_phase_1(self, owner_token):
        rp = _state.get("rp_winwin")
        assert rp, "start winwin must run first"
        r = requests.post(
            f"{BASE_URL}/cgym/roleplay/{rp}/turn",
            headers=_auth(owner_token),
            json={
                "text": "Buongiorno Elena. Prima di entrare nei numeri, vorrei capire quali sono le priorità e i vincoli del suo budget quest'anno.",
                "tts": False,
            },
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("turn") == 1
        assert d.get("ended") is False, f"winwin shouldn't end at turn 1: {d}"
        phase = d.get("phase")
        assert isinstance(phase, str) and phase.startswith("1 ·"), f"phase should start with '1 ·', got {phase!r}"
        assert d.get("max_turns") == 30

    def test_winwin_finish_saves_session(self, owner_token):
        rp = _state.get("rp_winwin")
        assert rp
        r = requests.post(
            f"{BASE_URL}/cgym/roleplay/{rp}/finish",
            headers=_auth(owner_token),
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "finished"
        assert isinstance(d.get("score"), int), f"score should be int, got {d.get('score')!r}"
        assert 0 <= d["score"] <= 100
        fb = d.get("feedback") or {}
        assert isinstance(fb.get("what_worked"), list), "what_worked should be a list"
        assert isinstance(fb.get("to_improve"), list), "to_improve should be a list"
        sid = d.get("session_id")
        assert sid, "session_id missing after finish"
        _created_sessions.append(sid)
        # verify saved session record
        rs = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token), timeout=20)
        assert rs.status_code == 200
        found = next((it for it in rs.json().get("items", []) if it["session_id"] == sid), None)
        assert found is not None, f"winwin session {sid} not found in list"
        assert found.get("type") == "winwin", f"expected type winwin, got {found.get('type')!r}"
        assert found.get("title") == "Role-play Trattativa WIN-WIN", f"unexpected title: {found.get('title')!r}"


# ---------------- 6. COSTO finish → saved session type obiezioni + title 'Role-play Obiezione COSTO' ----------------
class TestCostoFinish:
    def test_costo_one_turn_then_finish(self, owner_token):
        rp = _state.get("rp_costo")
        assert rp, "start costo must run first"
        # one text turn
        rt = requests.post(
            f"{BASE_URL}/cgym/roleplay/{rp}/turn",
            headers=_auth(owner_token),
            json={
                "text": "Capisco. Le propongo di confrontare non il prezzo al kWh ma il costo totale annuo: le mostro i numeri in 5 minuti.",
                "tts": False,
            },
            timeout=LLM_TIMEOUT,
        )
        assert rt.status_code == 200, rt.text
        # finish
        r = requests.post(
            f"{BASE_URL}/cgym/roleplay/{rp}/finish",
            headers=_auth(owner_token),
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "finished"
        sid = d.get("session_id")
        assert sid, "session_id missing after finish"
        _created_sessions.append(sid)
        # verify saved session type/title
        rs = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token), timeout=20)
        assert rs.status_code == 200
        found = next((it for it in rs.json().get("items", []) if it["session_id"] == sid), None)
        assert found is not None, f"costo session {sid} not found"
        assert found.get("type") == "obiezioni", f"expected type obiezioni, got {found.get('type')!r}"
        assert found.get("title") == "Role-play Obiezione COSTO", f"unexpected title: {found.get('title')!r}"


# ---------------- 7. Regression: tempo scenario still works (start only, cheap) ----------------
class TestTempoRegression:
    def test_start_tempo_label(self, owner_token):
        r = requests.post(
            f"{BASE_URL}/cgym/roleplay/start",
            headers=_auth(owner_token),
            json={"scenario": "tempo", "tts": False},
            timeout=LLM_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("scenario") == "tempo"
        assert d.get("area") == "obiezioni"
        assert d.get("max_turns") == 5
        assert d.get("duration_min") == 5
        # label returned by start payload
        assert d.get("scenario_label") == "Obiezione TEMPO", f"unexpected label: {d.get('scenario_label')!r}"
