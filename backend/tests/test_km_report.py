# V50.z253 Resoconto Km — backend tests
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"

OWNER = ("test@dalpastro.it", "Test1234!")
SUB = ("sub1@dalpastro.it", "Sub12345!")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def owner_token():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def sub_token():
    return _login(*SUB)


@pytest.fixture(scope="module")
def geocoded_contact_ids(owner_token):
    r = requests.get(f"{BASE_URL}/geo/contacts-map?scope=mine", headers=_auth(owner_token), timeout=60)
    assert r.status_code == 200, r.text
    items = [i for i in r.json().get("items", []) if i.get("lat") is not None]
    assert len(items) >= 2, f"Need at least 2 geocoded contacts, got {len(items)}"
    return [items[0]["contact_id"], items[1]["contact_id"]]


@pytest.fixture(scope="module")
def route(owner_token, geocoded_contact_ids):
    payload = {
        "contact_ids": geocoded_contact_ids,
        "origin_address": "Piazza Duomo, Milano",
        "return_to_origin": True,
    }
    r = requests.post(f"{BASE_URL}/geo/optimal-route", headers=_auth(owner_token), json=payload, timeout=90)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("route_id")
    assert len(data.get("legs") or []) == 2
    for leg in data["legs"]:
        assert "seq" in leg and "leg_km" in leg
    assert (data.get("return") or {}).get("leg_km") is not None
    return data


# Track created entries to clean up at the end
_created_entry_ids = []


class TestKmLogAdd:
    def test_add_seq1(self, owner_token, route):
        r = requests.post(f"{BASE_URL}/geo/km-log", headers=_auth(owner_token), json={
            "route_id": route["route_id"], "seq": 1, "date": "2026-09-15"
        }, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] is True
        e = data["entry"]
        assert e["km"] == route["legs"][0]["leg_km"]
        assert e["contact_name"]
        assert e["date"] == "2026-09-15"
        _created_entry_ids.append(e["entry_id"])

    def test_add_seq1_idempotent(self, owner_token, route):
        r = requests.post(f"{BASE_URL}/geo/km-log", headers=_auth(owner_token), json={
            "route_id": route["route_id"], "seq": 1, "date": "2026-09-15"
        }, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["created"] is False
        # entry_id same as first
        assert data["entry"]["entry_id"] == _created_entry_ids[0]

    def test_add_seq0_return(self, owner_token, route):
        r = requests.post(f"{BASE_URL}/geo/km-log", headers=_auth(owner_token), json={
            "route_id": route["route_id"], "seq": 0, "date": "2026-09-15"
        }, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["created"] is True
        e = data["entry"]
        assert e["km"] == route["return"]["leg_km"]
        assert e["contact_name"] == "Rientro"
        _created_entry_ids.append(e["entry_id"])

    def test_add_seq99_not_found(self, owner_token, route):
        r = requests.post(f"{BASE_URL}/geo/km-log", headers=_auth(owner_token), json={
            "route_id": route["route_id"], "seq": 99
        }, timeout=30)
        assert r.status_code == 404

    def test_add_unknown_route(self, owner_token):
        r = requests.post(f"{BASE_URL}/geo/km-log", headers=_auth(owner_token), json={
            "route_id": "rt_unknownxxx", "seq": 1
        }, timeout=30)
        assert r.status_code == 404

    def test_route_without_return_seq0(self, owner_token, geocoded_contact_ids):
        # Create route without return
        r = requests.post(f"{BASE_URL}/geo/optimal-route", headers=_auth(owner_token), json={
            "contact_ids": geocoded_contact_ids,
            "origin_address": "Piazza Duomo, Milano",
            "return_to_origin": False,
        }, timeout=90)
        assert r.status_code == 200
        rid = r.json()["route_id"]
        r2 = requests.post(f"{BASE_URL}/geo/km-log", headers=_auth(owner_token), json={
            "route_id": rid, "seq": 0
        }, timeout=30)
        assert r2.status_code == 400


class TestKmLogList:
    def test_by_route_id(self, owner_token, route):
        r = requests.get(f"{BASE_URL}/geo/km-log?route_id={route['route_id']}", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 2

    def test_month_current_totals(self, owner_token, route):
        r = requests.get(f"{BASE_URL}/geo/km-log?month=2026-09&today=2026-09-15", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        expected_sum = round(route["legs"][0]["leg_km"] + route["return"]["leg_km"], 1)
        totals = data["totals"]
        assert totals["today_km"] == expected_sum
        assert totals["week_km"] == expected_sum
        assert totals["selected_month_km"] == expected_sum
        assert totals["week_start"] == "2026-09-14"
        assert totals["week_end"] == "2026-09-20"
        by_day = data["by_day"]
        assert len(by_day) >= 1
        day = next((d for d in by_day if d["date"] == "2026-09-15"), None)
        assert day is not None
        assert day["visits"] == 2

    def test_month_other_still_today(self, owner_token, route):
        r = requests.get(f"{BASE_URL}/geo/km-log?month=2026-08&today=2026-09-15", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["items"] == []
        expected_sum = round(route["legs"][0]["leg_km"] + route["return"]["leg_km"], 1)
        assert data["totals"]["today_km"] == expected_sum

    def test_unauth(self):
        r = requests.get(f"{BASE_URL}/geo/km-log", timeout=30)
        assert r.status_code in (401, 403)


class TestKmLogDelete:
    def test_delete_and_404(self, owner_token):
        assert _created_entry_ids, "Need entries created earlier"
        eid = _created_entry_ids[0]
        r = requests.delete(f"{BASE_URL}/geo/km-log/{eid}", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["ok"] is True
        r2 = requests.delete(f"{BASE_URL}/geo/km-log/{eid}", headers=_auth(owner_token), timeout=30)
        assert r2.status_code == 404
        _created_entry_ids.pop(0)


class TestKmLogPerUser:
    def test_sub_isolation(self, sub_token, owner_token, route):
        # Sub cannot see owner's entries
        r = requests.get(f"{BASE_URL}/geo/km-log?route_id={route['route_id']}", headers=_auth(sub_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["items"] == []
        # But sub can log on the same tenant route
        r2 = requests.post(f"{BASE_URL}/geo/km-log", headers=_auth(sub_token), json={
            "route_id": route["route_id"], "seq": 1, "date": "2026-09-15"
        }, timeout=30)
        assert r2.status_code == 200
        eid = r2.json()["entry"]["entry_id"]
        # cleanup
        requests.delete(f"{BASE_URL}/geo/km-log/{eid}", headers=_auth(sub_token), timeout=30)


@pytest.fixture(scope="module", autouse=True)
def _final_cleanup(owner_token):
    yield
    # Delete any remaining entries created by owner
    r = requests.get(f"{BASE_URL}/geo/km-log?month=2026-09&today=2026-09-15", headers=_auth(owner_token), timeout=30)
    if r.status_code == 200:
        for e in r.json().get("items", []):
            requests.delete(f"{BASE_URL}/geo/km-log/{e['entry_id']}", headers=_auth(owner_token), timeout=30)
