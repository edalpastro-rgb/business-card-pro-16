"""
Backend tests — Corporate Gym Blocco 4: Master statistics dashboard.

Endpoints under test:
- GET   /api/cgym/stats?days=
- POST  /api/cgym/stats/agent-feedback/{agent_id}?force=
- GET   /api/cgym/stats/agent-feedback/{agent_id}
- POST  /api/cgym/stats/weekly-report?force=
- GET   /api/cgym/stats/weekly-report
Regression:
- GET  /api/cgym/summary
- GET  /api/cgym/sessions
"""
import os
import time
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
MEMBER = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}

# LLM endpoints take 15-25s; allow generous margin
LLM_TIMEOUT = 120


# ---------------- fixtures ----------------
def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, f"owner login: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def member_token():
    r = requests.post(f"{BASE_URL}/auth/login", json=MEMBER, timeout=30)
    assert r.status_code == 200, f"member login: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_me(owner_token):
    r = requests.get(f"{BASE_URL}/auth/me", headers=_auth(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("user") or d


@pytest.fixture(scope="module")
def member_me(member_token):
    r = requests.get(f"{BASE_URL}/auth/me", headers=_auth(member_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("user") or d


# ---------------- GET /api/cgym/stats ----------------
class TestCgymStats:
    """Master statistics dashboard endpoint"""

    @pytest.mark.parametrize("days", [7, 30, 90])
    def test_stats_days_variants(self, owner_token, days):
        r = requests.get(f"{BASE_URL}/cgym/stats", params={"days": days}, headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        js = r.json()
        # top-level keys
        for k in ("days", "generated_at", "team", "agents"):
            assert k in js, f"missing key {k}"
        assert js["days"] == days
        # team keys
        team = js["team"]
        for k in ("agents", "active_agents", "assigned_total", "assigned_done", "completion_rate",
                  "completed_total", "overdue", "avg_score", "roleplays", "weekly", "weaknesses", "strengths"):
            assert k in team, f"team missing {k}"
        assert isinstance(team["weekly"], list)
        assert isinstance(team["weaknesses"], list)
        assert isinstance(team["strengths"], list)
        # agents sorted by avg_score desc; rank starting at 1
        agents = js["agents"]
        assert isinstance(agents, list)
        assert len(agents) >= 1
        for i, a in enumerate(agents):
            assert a["rank"] == i + 1, f"agent[{i}] rank {a['rank']} != {i+1}"
            for k in ("user_id", "name", "completed_total", "assigned_total", "assigned_done",
                      "overdue", "roleplays", "avg_score", "last_score", "best_score", "trend",
                      "completion_rate", "convinto_rate", "timeline", "strengths", "weaknesses", "by_type"):
                assert k in a, f"agent missing {k}"
            assert isinstance(a["timeline"], list)
            assert isinstance(a["strengths"], list)
            assert isinstance(a["weaknesses"], list)
            assert isinstance(a["by_type"], dict)
        # sorted by avg_score desc (None avg_score sorted to bottom due to -1 fallback)
        prev = None
        for a in agents:
            score = a["avg_score"] if a["avg_score"] is not None else -1
            if prev is not None:
                assert score <= prev, f"agents not sorted desc by avg_score: {agents}"
            prev = score

    def test_stats_days_clamp_low(self, owner_token):
        # days=1 should clamp to 7
        r = requests.get(f"{BASE_URL}/cgym/stats", params={"days": 1}, headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["days"] == 7

    def test_stats_days_clamp_high(self, owner_token):
        # days=9999 should clamp to 365
        r = requests.get(f"{BASE_URL}/cgym/stats", params={"days": 9999}, headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["days"] == 365

    def test_stats_member_forbidden(self, member_token):
        r = requests.get(f"{BASE_URL}/cgym/stats", params={"days": 30}, headers=_auth(member_token), timeout=30)
        assert r.status_code == 403, f"expected 403 for member, got {r.status_code}"


# ---------------- Consistency check: session created by owner → completed by sub → stats reflect it ----------------
class TestCgymStatsConsistency:
    """Owner creates session for sub → sub completes with score 70 → stats show it"""

    _session_id = None

    def test_consistency_session_flow(self, owner_token, member_token, member_me):
        sub_id = member_me["user_id"]
        # 1) Owner creates a session for sub
        scheduled_at = datetime.now(timezone.utc).isoformat()
        payload = {
            "user_id": sub_id,
            "type": "obiezioni",
            "title": "TEST_stats_consistency",
            "scheduled_at": scheduled_at,
            "mandatory": False,
        }
        r = requests.post(f"{BASE_URL}/cgym/sessions", json=payload, headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, f"create session: {r.status_code} {r.text}"
        sess = r.json()
        session_id = sess.get("session_id")
        assert session_id
        TestCgymStatsConsistency._session_id = session_id

        try:
            # 2) Sub PATCH completata with score 70
            upd = {"status": "completata", "score": 70}
            r = requests.patch(f"{BASE_URL}/cgym/sessions/{session_id}", json=upd,
                               headers=_auth(member_token), timeout=30)
            assert r.status_code == 200, f"patch: {r.status_code} {r.text}"
            updated = r.json()
            assert updated["status"] == "completata"
            assert float(updated["score"]) == 70.0

            # 3) Stats reflect the session
            r = requests.get(f"{BASE_URL}/cgym/stats", params={"days": 30},
                             headers=_auth(owner_token), timeout=30)
            assert r.status_code == 200
            stats = r.json()
            sub_agent = next((a for a in stats["agents"] if a["user_id"] == sub_id), None)
            assert sub_agent is not None, "sub agent missing in stats.agents"
            assert sub_agent["assigned_total"] >= 1, f"assigned_total={sub_agent['assigned_total']}"
            assert sub_agent["assigned_done"] >= 1, f"assigned_done={sub_agent['assigned_done']}"
            # avg_score reflects 70 (may be 70.0 if only score, else >= 0 and <= 100 generally)
            assert sub_agent["avg_score"] is not None
            # If only one score, avg should equal 70. If historic scores exist, at least last_score should be 70
            assert sub_agent["last_score"] == 70.0 or sub_agent["avg_score"] == 70.0
        finally:
            # 4) Cleanup: delete the session
            rd = requests.delete(f"{BASE_URL}/cgym/sessions/{session_id}",
                                 headers=_auth(owner_token), timeout=30)
            assert rd.status_code in (200, 204), f"cleanup delete: {rd.status_code} {rd.text}"


# ---------------- POST /api/cgym/stats/agent-feedback/{agent_id} ----------------
class TestCgymAgentFeedback:
    """Personal AxonOS feedback (LLM ~15-25s, cache 24h)"""

    _first_report_id = None

    def test_agent_feedback_owner_success(self, owner_token, owner_me):
        """POST feedback for owner user_id — first call generates (LLM)"""
        agent_id = owner_me["user_id"]
        r = requests.post(f"{BASE_URL}/cgym/stats/agent-feedback/{agent_id}",
                          headers=_auth(owner_token), timeout=LLM_TIMEOUT)
        assert r.status_code == 200, f"agent-feedback: {r.status_code} {r.text[:400]}"
        js = r.json()
        assert "content" in js
        assert "generated_at" in js
        assert "report_id" in js
        c = js["content"]
        for k in ("character", "where_to_improve", "corrective_actions", "strengths",
                  "encouragement", "suggested_focus"):
            assert k in c, f"content missing {k}"
        assert isinstance(c["where_to_improve"], list)
        assert isinstance(c["corrective_actions"], list)
        assert isinstance(c["strengths"], list)
        TestCgymAgentFeedback._first_report_id = js["report_id"]

    def test_agent_feedback_cache_hit(self, owner_token, owner_me):
        """Second call without force → same report_id (24h cache)"""
        assert TestCgymAgentFeedback._first_report_id is not None, "prev test must pass"
        agent_id = owner_me["user_id"]
        r = requests.post(f"{BASE_URL}/cgym/stats/agent-feedback/{agent_id}",
                          headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        js = r.json()
        assert js["report_id"] == TestCgymAgentFeedback._first_report_id, \
            f"cache miss: {js['report_id']} != {TestCgymAgentFeedback._first_report_id}"

    def test_agent_feedback_get_last_cached(self, owner_token, owner_me):
        """GET returns the last cached report"""
        agent_id = owner_me["user_id"]
        r = requests.get(f"{BASE_URL}/cgym/stats/agent-feedback/{agent_id}",
                         headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        js = r.json()
        assert js.get("content") is not None
        assert js.get("report_id") == TestCgymAgentFeedback._first_report_id

    def test_agent_feedback_sub_get_own(self, member_token, member_me):
        """Sub GET own id → 200 (content may be null if never generated)"""
        agent_id = member_me["user_id"]
        r = requests.get(f"{BASE_URL}/cgym/stats/agent-feedback/{agent_id}",
                         headers=_auth(member_token), timeout=30)
        assert r.status_code == 200, r.text
        # content may be null
        js = r.json()
        assert "content" in js

    def test_agent_feedback_sub_get_owner_forbidden(self, member_token, owner_me):
        """Sub GET owner id → 403"""
        r = requests.get(f"{BASE_URL}/cgym/stats/agent-feedback/{owner_me['user_id']}",
                        headers=_auth(member_token), timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_agent_feedback_sub_post_forbidden(self, member_token, member_me):
        """Sub POST → 403"""
        r = requests.post(f"{BASE_URL}/cgym/stats/agent-feedback/{member_me['user_id']}",
                          headers=_auth(member_token), timeout=30)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_agent_feedback_unknown_agent_404(self, owner_token):
        """Unknown agent_id POST as owner → 404"""
        r = requests.post(f"{BASE_URL}/cgym/stats/agent-feedback/nonexistent-agent-xxx",
                          headers=_auth(owner_token), timeout=30)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# ---------------- POST /api/cgym/stats/weekly-report ----------------
class TestCgymWeeklyReport:
    """Weekly team report (cache per ISO week; LLM ~20s)"""

    _first_report_id = None
    _first_week = None

    def test_weekly_report_owner_success(self, owner_token):
        r = requests.post(f"{BASE_URL}/cgym/stats/weekly-report",
                          headers=_auth(owner_token), timeout=LLM_TIMEOUT)
        assert r.status_code == 200, f"weekly-report: {r.status_code} {r.text[:400]}"
        js = r.json()
        assert "week" in js
        assert "content" in js
        assert "report_id" in js
        # week format YYYY-Www
        assert "-W" in js["week"], f"bad week format: {js['week']}"
        c = js["content"]
        for k in ("headline", "team_gaps", "highlights", "agents_to_watch",
                  "new_scenarios", "manual_updates", "next_week_plan"):
            assert k in c, f"weekly content missing {k}"
        assert isinstance(c["team_gaps"], list)
        assert isinstance(c["highlights"], list)
        assert isinstance(c["agents_to_watch"], list)
        assert isinstance(c["new_scenarios"], list)
        assert isinstance(c["manual_updates"], list)
        # new_scenarios items shape (may be empty, but if present validate)
        for sc in c["new_scenarios"]:
            assert isinstance(sc, dict)
            # tolerant: not all keys strictly required, but at least one common
            assert any(k in sc for k in ("title", "objection", "why"))
        TestCgymWeeklyReport._first_report_id = js["report_id"]
        TestCgymWeeklyReport._first_week = js["week"]

    def test_weekly_report_cache_hit(self, owner_token):
        """Second call → same report_id (cache per ISO week)"""
        assert TestCgymWeeklyReport._first_report_id is not None
        r = requests.post(f"{BASE_URL}/cgym/stats/weekly-report",
                          headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        js = r.json()
        assert js["report_id"] == TestCgymWeeklyReport._first_report_id, \
            f"cache miss: {js['report_id']} != {TestCgymWeeklyReport._first_report_id}"
        assert js["week"] == TestCgymWeeklyReport._first_week

    def test_weekly_report_get(self, owner_token):
        """GET returns latest cached weekly report"""
        r = requests.get(f"{BASE_URL}/cgym/stats/weekly-report",
                         headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        js = r.json()
        assert js.get("content") is not None
        assert js.get("report_id") == TestCgymWeeklyReport._first_report_id

    def test_weekly_report_sub_forbidden(self, member_token):
        """Sub → 403 on POST and GET"""
        rp = requests.post(f"{BASE_URL}/cgym/stats/weekly-report",
                           headers=_auth(member_token), timeout=30)
        assert rp.status_code == 403, f"expected 403 POST, got {rp.status_code}"
        rg = requests.get(f"{BASE_URL}/cgym/stats/weekly-report",
                          headers=_auth(member_token), timeout=30)
        assert rg.status_code == 403, f"expected 403 GET, got {rg.status_code}"


# ---------------- Regression ----------------
class TestCgymRegression:
    """Ensure earlier endpoints still work"""

    def test_summary_owner(self, owner_token):
        r = requests.get(f"{BASE_URL}/cgym/summary", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text

    def test_summary_member(self, member_token):
        r = requests.get(f"{BASE_URL}/cgym/summary", headers=_auth(member_token), timeout=30)
        assert r.status_code == 200, r.text

    def test_sessions_owner(self, owner_token):
        r = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text

    def test_sessions_member(self, member_token):
        r = requests.get(f"{BASE_URL}/cgym/sessions", headers=_auth(member_token), timeout=30)
        assert r.status_code == 200, r.text
