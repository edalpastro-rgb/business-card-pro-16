"""V50.z256 — Rilevamento Visite Clienti backend tests.

Endpoints under test:
- GET /api/visits/settings (defaults + clamp/fallback)
- PUT /api/user-settings {visit_detection}
- PUT /api/contacts/{id} {revisit_every_days} + GET /api/visits/due
- POST/DELETE /api/visits/confirm, GET /api/visits/contact/{id}, /api/visits/summary
- POST /api/visits/candidates (dedup), GET, dismiss, confirm with cand_id
- GET /api/visits/nearby
- POST /api/geo/optimal-route + POST /api/geo/km-log integration
- Tenant isolation
"""
import os
import datetime as dt
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"

OWNER = ("test@dalpastro.it", "Test1234!")
SUB   = ("sub1@dalpastro.it", "Sub12345!")
OTHER = ("demo@advisoros.it", "Demo1234!")

# Contatti noti tenant test@dalpastro.it
C_ANNA = "c_343d523c463f"       # Treviso (nessun geo? — usato per Storico Visite)
C_MARCO = "c_3b5435a0569e"      # Milano (con geo)
C_TEST_NUM = "c_7cb0c383e696"   # Milano (con geo — 45.4845,9.1873)


def _login(email, password):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_tok():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def sub_tok():
    return _login(*SUB)


@pytest.fixture(scope="module")
def other_tok():
    return _login(*OTHER)


def _today():
    return dt.datetime.utcnow().strftime("%Y-%m-%d")


# ---------- Settings ----------
class TestVisitDetectionSettings:
    def test_defaults_after_reset(self, owner_tok):
        # reset to defaults first
        r = requests.put(f"{BASE_URL}/user-settings", headers=_h(owner_tok),
                         json={"visit_detection": {"enabled": False, "stay_minutes": 10, "radius_m": 150, "mode": "both", "recap_time": "18:30"}}, timeout=15)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/visits/settings", headers=_h(owner_tok), timeout=15).json()
        vd = g["visit_detection"]
        assert vd == {"enabled": False, "stay_minutes": 10, "radius_m": 150, "mode": "both", "recap_time": "18:30"}

    def test_put_and_read_back(self, owner_tok):
        payload = {"enabled": True, "stay_minutes": 15, "radius_m": 200, "mode": "realtime", "recap_time": "19:00"}
        r = requests.put(f"{BASE_URL}/user-settings", headers=_h(owner_tok), json={"visit_detection": payload}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/visits/settings", headers=_h(owner_tok), timeout=15).json()
        assert g["visit_detection"] == payload

    def test_invalid_mode_falls_back_to_both(self, owner_tok):
        r = requests.put(f"{BASE_URL}/user-settings", headers=_h(owner_tok),
                         json={"visit_detection": {"enabled": True, "stay_minutes": 15, "radius_m": 200, "mode": "xyz", "recap_time": "19:00"}}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/visits/settings", headers=_h(owner_tok), timeout=15).json()
        assert g["visit_detection"]["mode"] == "both"

    def test_stay_minutes_clamped_to_120(self, owner_tok):
        r = requests.put(f"{BASE_URL}/user-settings", headers=_h(owner_tok),
                         json={"visit_detection": {"enabled": True, "stay_minutes": 999, "radius_m": 200, "mode": "both", "recap_time": "19:00"}}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/visits/settings", headers=_h(owner_tok), timeout=15).json()
        assert g["visit_detection"]["stay_minutes"] == 120

    def test_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/visits/settings", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Revisit & due ----------
class TestRevisitEveryDaysAndDue:
    def test_set_revisit_and_due(self, owner_tok):
        # Delete any visits for C_ANNA today so due list is clean
        j = requests.get(f"{BASE_URL}/visits/contact/{C_ANNA}", headers=_h(owner_tok), timeout=15).json()
        for v in j.get("items", []):
            requests.delete(f"{BASE_URL}/visits/{v['visit_id']}", headers=_h(owner_tok), timeout=15)
        r = requests.put(f"{BASE_URL}/contacts/{C_ANNA}", headers=_h(owner_tok),
                         json={"revisit_every_days": 60}, timeout=15)
        assert r.status_code in (200, 204), r.text
        # verify persistence via GET /contacts/{id}
        g = requests.get(f"{BASE_URL}/contacts/{C_ANNA}", headers=_h(owner_tok), timeout=15).json()
        assert g.get("revisit_every_days") == 60
        # /visits/due returns items with our contact IF overdue (days_since None or >= every).
        # Note: last_visit_at may persist from prior runs; only assert structure + endpoint.
        due = requests.get(f"{BASE_URL}/visits/due", headers=_h(owner_tok), timeout=15).json()
        assert isinstance(due.get("items"), list)

    def test_cleanup_revisit(self, owner_tok):
        # leave it 60 for now, cleaned at end
        pass


# ---------- Visits confirm/delete/summary ----------
class TestVisitsConfirmDeleteSummary:
    created_visit_id = None
    km_entry_id = None

    def test_manual_confirm(self, owner_tok):
        r = requests.post(f"{BASE_URL}/visits/confirm", headers=_h(owner_tok),
                          json={"contact_id": C_ANNA, "notes": "TEST_manual", "source": "manual", "km": 12.5}, timeout=15)
        assert r.status_code == 200, r.text
        v = r.json()["visit"]
        assert v["km"] == 12.5
        assert v["km_entry_id"]
        assert v["source"] == "manual"
        TestVisitsConfirmDeleteSummary.created_visit_id = v["visit_id"]
        TestVisitsConfirmDeleteSummary.km_entry_id = v["km_entry_id"]

    def test_get_by_contact(self, owner_tok):
        r = requests.get(f"{BASE_URL}/visits/contact/{C_ANNA}", headers=_h(owner_tok), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert len(j["items"]) >= 1
        assert any(v["visit_id"] == TestVisitsConfirmDeleteSummary.created_visit_id for v in j["items"])
        assert j["total_km"] >= 12.5
        assert j["last_visit_at"]

    def test_km_log_contains_entry(self, owner_tok):
        r = requests.get(f"{BASE_URL}/geo/km-log", headers=_h(owner_tok), timeout=15)
        assert r.status_code == 200
        entries = r.json().get("items", [])
        found = [e for e in entries if e.get("entry_id") == TestVisitsConfirmDeleteSummary.km_entry_id]
        assert found, "km-log entry not found"
        assert found[0]["km"] == 12.5
        assert found[0]["contact_name"]

    def test_summary_has_contact(self, owner_tok):
        r = requests.get(f"{BASE_URL}/visits/summary", headers=_h(owner_tok), timeout=15).json()
        assert C_ANNA in r["by_contact"], r
        assert r["by_contact"][C_ANNA]["count"] >= 1

    def test_due_no_longer_lists_visited(self, owner_tok):
        r = requests.get(f"{BASE_URL}/visits/due", headers=_h(owner_tok), timeout=15).json()
        ids = [d["contact_id"] for d in r["items"]]
        assert C_ANNA not in ids, f"C_ANNA still in due after visit today: {ids}"

    def test_gps_source_computes_km_haversine(self, owner_tok):
        r = requests.post(f"{BASE_URL}/visits/confirm", headers=_h(owner_tok),
                          json={"contact_id": C_TEST_NUM, "source": "gps", "from_lat": 45.4642, "from_lon": 9.19, "notes": "TEST_gps"}, timeout=15)
        assert r.status_code == 200, r.text
        v = r.json()["visit"]
        assert v["km"] > 0, "km should be > 0 via haversine × 1.3"
        # cleanup this GPS visit
        requests.delete(f"{BASE_URL}/visits/{v['visit_id']}", headers=_h(owner_tok), timeout=15)

    def test_confirm_unknown_contact(self, owner_tok):
        r = requests.post(f"{BASE_URL}/visits/confirm", headers=_h(owner_tok),
                          json={"contact_id": "c_NOTEXIST", "source": "manual", "km": 1.0}, timeout=15)
        assert r.status_code == 404

    def test_delete_visit_cascades_kmlog(self, owner_tok):
        vid = TestVisitsConfirmDeleteSummary.created_visit_id
        assert vid
        r = requests.delete(f"{BASE_URL}/visits/{vid}", headers=_h(owner_tok), timeout=15)
        assert r.status_code == 200
        # km-log entry removed
        entries = requests.get(f"{BASE_URL}/geo/km-log", headers=_h(owner_tok), timeout=15).json().get("items", [])
        assert not any(e.get("entry_id") == TestVisitsConfirmDeleteSummary.km_entry_id for e in entries)
        # delete again → 404
        r2 = requests.delete(f"{BASE_URL}/visits/{vid}", headers=_h(owner_tok), timeout=15)
        assert r2.status_code == 404


# ---------- Candidates ----------
class TestVisitCandidates:
    cand_id = None
    cand_id2 = None

    def test_add_candidate_dedup(self, owner_tok):
        import random
        today = _today()
        # unique started_at so we don't collide with any prior run's candidate
        _hh = random.randint(1, 23)
        _mm = random.randint(0, 59)
        started = f"{today}T{_hh:02d}:{_mm:02d}:33"
        started2 = f"{today}T{_hh:02d}:{_mm:02d}:44"
        TestVisitCandidates._started = started
        TestVisitCandidates._started2 = started2
        payload = [{
            "contact_id": C_ANNA, "started_at": started,
            "stay_minutes": 14, "lat": 45.66, "lon": 12.24, "date": today,
        }]
        r = requests.post(f"{BASE_URL}/visits/candidates", headers=_h(owner_tok), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        assert len(created) == 1
        TestVisitCandidates.cand_id = created[0]["cand_id"]
        # dedup
        r2 = requests.post(f"{BASE_URL}/visits/candidates", headers=_h(owner_tok), json=payload, timeout=15)
        assert r2.status_code == 200
        assert len(r2.json()["created"]) == 0

    def test_list_pending(self, owner_tok):
        today = _today()
        r = requests.get(f"{BASE_URL}/visits/candidates", headers=_h(owner_tok), params={"date": today}, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(x["cand_id"] == TestVisitCandidates.cand_id for x in items)

    def test_dismiss_and_confirm(self, owner_tok):
        # Add a second candidate to confirm
        today = _today()
        r = requests.post(f"{BASE_URL}/visits/candidates", headers=_h(owner_tok),
                          json=[{"contact_id": C_MARCO, "started_at": TestVisitCandidates._started2, "stay_minutes": 20, "lat": 45.46, "lon": 9.19, "date": today}], timeout=15)
        assert r.status_code == 200
        cand2 = r.json()["created"][0]
        TestVisitCandidates.cand_id2 = cand2["cand_id"]

        # Dismiss cand1
        d = requests.post(f"{BASE_URL}/visits/candidates/{TestVisitCandidates.cand_id}/dismiss", headers=_h(owner_tok), timeout=15)
        assert d.status_code == 200

        # Confirm cand2 via visits/confirm with cand_id
        c = requests.post(f"{BASE_URL}/visits/confirm", headers=_h(owner_tok),
                          json={"contact_id": C_MARCO, "cand_id": TestVisitCandidates.cand_id2, "source": "gps", "km": 0}, timeout=15)
        assert c.status_code == 200, c.text
        v = c.json()["visit"]

        # Verify candidate statuses via status=all
        r_all = requests.get(f"{BASE_URL}/visits/candidates", headers=_h(owner_tok), params={"date": _today(), "status": "all"}, timeout=15).json()
        statuses = {x["cand_id"]: x["status"] for x in r_all["items"]}
        assert statuses.get(TestVisitCandidates.cand_id) == "dismissed"
        assert statuses.get(TestVisitCandidates.cand_id2) == "confirmed"

        # Pending count = 0
        r_pending = requests.get(f"{BASE_URL}/visits/candidates", headers=_h(owner_tok), params={"date": _today()}, timeout=15).json()
        pending_ids = [x["cand_id"] for x in r_pending["items"]]
        assert TestVisitCandidates.cand_id not in pending_ids
        assert TestVisitCandidates.cand_id2 not in pending_ids

        # cleanup created visit
        requests.delete(f"{BASE_URL}/visits/{v['visit_id']}", headers=_h(owner_tok), timeout=15)


# ---------- Nearby ----------
class TestNearby:
    def test_nearby_radius_500_finds_test_numero(self, owner_tok):
        r = requests.get(f"{BASE_URL}/visits/nearby", headers=_h(owner_tok),
                         params={"lat": 45.4845, "lon": 9.1873, "radius_m": 500}, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(x["contact_id"] == C_TEST_NUM for x in items), f"expected {C_TEST_NUM} in nearby: {items}"
        entry = next(x for x in items if x["contact_id"] == C_TEST_NUM)
        assert "distance_m" in entry

    def test_nearby_radius_50_may_be_empty(self, owner_tok):
        r = requests.get(f"{BASE_URL}/visits/nearby", headers=_h(owner_tok),
                         params={"lat": 45.0, "lon": 9.0, "radius_m": 50}, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json()["items"], list)


# ---------- Route flow ----------
class TestOptimalRouteFlow:
    route_id = None
    entry_id = None
    leg_seq = None
    leg_km = None
    leg_contact = None

    def test_create_route_and_km_log(self, owner_tok):
        payload = {
            "origin_lat": 45.4642, "origin_lon": 9.19,
            "contact_ids": [C_MARCO, C_TEST_NUM],
        }
        r = requests.post(f"{BASE_URL}/geo/optimal-route", headers=_h(owner_tok), json=payload, timeout=60)
        assert r.status_code == 200, r.text
        route = r.json()
        rid = route.get("route_id") or (route.get("route") or {}).get("route_id")
        if not rid and "route" in route:
            route = route["route"]
            rid = route.get("route_id")
        assert rid, f"no route_id in {route}"
        TestOptimalRouteFlow.route_id = rid
        legs = route.get("legs") or []
        assert legs, f"no legs in route {route}"
        leg = legs[0]
        TestOptimalRouteFlow.leg_seq = int(leg.get("seq"))
        TestOptimalRouteFlow.leg_km = float(leg.get("leg_km") or 0)
        TestOptimalRouteFlow.leg_contact = leg.get("contact_id")

        r2 = requests.post(f"{BASE_URL}/geo/km-log", headers=_h(owner_tok),
                           json={"route_id": rid, "seq": TestOptimalRouteFlow.leg_seq}, timeout=30)
        assert r2.status_code == 200, r2.text
        entry = r2.json()["entry"]
        assert "visit_id" in entry, f"km-log entry missing visit_id: {entry}"
        TestOptimalRouteFlow.entry_id = entry["entry_id"]

    def test_leg_creates_visit(self, owner_tok):
        cid = TestOptimalRouteFlow.leg_contact
        assert cid
        r = requests.get(f"{BASE_URL}/visits/contact/{cid}", headers=_h(owner_tok), timeout=15).json()
        matching = [v for v in r["items"] if v.get("source") == "route" and v.get("km_entry_id") == TestOptimalRouteFlow.entry_id]
        assert matching, f"expected route visit for {cid}: {r}"
        assert matching[0]["km"] == round(TestOptimalRouteFlow.leg_km, 1)

    def test_delete_km_entry_cascades(self, owner_tok):
        r = requests.delete(f"{BASE_URL}/geo/km-log/{TestOptimalRouteFlow.entry_id}", headers=_h(owner_tok), timeout=15)
        assert r.status_code == 200
        # Visit removed
        cid = TestOptimalRouteFlow.leg_contact
        v = requests.get(f"{BASE_URL}/visits/contact/{cid}", headers=_h(owner_tok), timeout=15).json()
        assert not any(x.get("km_entry_id") == TestOptimalRouteFlow.entry_id for x in v["items"])


# ---------- Tenant isolation ----------
class TestTenantIsolation:
    created_visit_id = None

    def test_create_owner_visit_sub_sees_it(self, owner_tok, sub_tok, other_tok):
        r = requests.post(f"{BASE_URL}/visits/confirm", headers=_h(owner_tok),
                          json={"contact_id": C_MARCO, "notes": "TEST_iso", "source": "manual", "km": 3.3}, timeout=15)
        assert r.status_code == 200, r.text
        vid = r.json()["visit"]["visit_id"]
        TestTenantIsolation.created_visit_id = vid

        # Sub user (same tenant) should see it
        s = requests.get(f"{BASE_URL}/visits/contact/{C_MARCO}", headers=_h(sub_tok), timeout=15).json()
        assert any(v["visit_id"] == vid for v in s["items"]), "sub-user (same tenant) should see owner's visit"

        # Demo (other tenant) → empty for this contact
        o = requests.get(f"{BASE_URL}/visits/contact/{C_MARCO}", headers=_h(other_tok), timeout=15).json()
        assert not any(v.get("visit_id") == vid for v in o.get("items", []))

    def test_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/visits/contact/{C_MARCO}", timeout=15)
        assert r.status_code in (401, 403)

    def test_cleanup(self, owner_tok):
        if TestTenantIsolation.created_visit_id:
            requests.delete(f"{BASE_URL}/visits/{TestTenantIsolation.created_visit_id}", headers=_h(owner_tok), timeout=15)


# ---------- Final cleanup ----------
class TestZCleanup:
    def test_reset(self, owner_tok):
        # unset revisit_every_days on C_ANNA (send 0/null via update)
        requests.put(f"{BASE_URL}/contacts/{C_ANNA}", headers=_h(owner_tok), json={"revisit_every_days": 0}, timeout=15)
        # reset visit_detection defaults
        r = requests.put(f"{BASE_URL}/user-settings", headers=_h(owner_tok),
                         json={"visit_detection": {"enabled": False, "stay_minutes": 10, "radius_m": 150, "mode": "both", "recap_time": "18:30"}}, timeout=15)
        assert r.status_code == 200
        # remove any leftover visits from tests today for c_anna/c_marco/c_test_num
        for cid in (C_ANNA, C_MARCO, C_TEST_NUM):
            j = requests.get(f"{BASE_URL}/visits/contact/{cid}", headers=_h(owner_tok), timeout=15).json()
            for v in j.get("items", []):
                if (v.get("notes") or "").startswith("TEST_") or v.get("notes") == "TEST_manual":
                    requests.delete(f"{BASE_URL}/visits/{v['visit_id']}", headers=_h(owner_tok), timeout=15)
