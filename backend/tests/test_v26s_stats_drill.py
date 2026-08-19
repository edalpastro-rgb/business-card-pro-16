"""V26.s — Test the 3 bug fixes:
1. Master 'Statistiche di oggi' has same 5 metrics as Report and values match.
2. All 5 numbers are clickable — drill fetches /appointments filtered by area+start+end.
3. Home midnight refresh — /callbacks?day=today excludes yesterday's callbacks.
"""
import os
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def contact_id(headers):
    """Create/reuse a TEST_ contact for appointments."""
    r = requests.get(f"{BASE_URL}/api/contacts", headers=headers, timeout=10)
    assert r.status_code == 200
    for c in r.json().get("items", []):
        if (c.get("first_name") or "").startswith("TEST_V26s"):
            return c["contact_id"]
    r = requests.post(
        f"{BASE_URL}/api/contacts",
        headers=headers,
        json={"first_name": "TEST_V26s", "last_name": "Contact", "phone": "+39 340 1234567", "area": "energy"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["contact_id"]


# =========================
# Fix 1: /reports returns 5 metrics per area
# =========================
class TestReportsMetrics:
    def test_reports_day_has_5_metrics_per_area(self, headers):
        r = requests.get(f"{BASE_URL}/api/reports?period=day", headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "start" in j and "end" in j, "reports must expose start/end for drill"
        assert "stats" in j
        for area in ("energy", "network"):
            assert area in j["stats"], f"missing {area} in stats"
            s = j["stats"][area]
            for k in ("appointments_done", "appointments_total", "phone_done", "contracts", "products"):
                assert k in s, f"missing metric '{k}' in {area}"
                assert isinstance(s[k], int)


# =========================
# Fix 2: drill uses /appointments?start=..&end=..&area=..
# =========================
class TestAppointmentsDrillFilter:
    @pytest.fixture(scope="class")
    def created_ids(self, headers, contact_id):
        """Create 4 appointments today (3 done: 2 in-person + 1 phone, 1 pending)."""
        # Get period range from /reports
        rp = requests.get(f"{BASE_URL}/api/reports?period=day", headers=headers, timeout=10).json()
        start_dt = datetime.fromisoformat(rp["start"])
        # 10:00 today
        base_time = start_dt.replace(hour=10, minute=0, second=0, microsecond=0)
        ids = []
        appts = [
            {"title": "TEST_V26s Done Inperson 1", "is_phone": False, "done": True, "offset": 0},
            {"title": "TEST_V26s Done Inperson 2", "is_phone": False, "done": True, "offset": 30},
            {"title": "TEST_V26s Done Phone",     "is_phone": True,  "done": True, "offset": 60},
            {"title": "TEST_V26s Pending",        "is_phone": False, "done": False, "offset": 120},
        ]
        for a in appts:
            payload = {
                "contact_id": contact_id,
                "title": a["title"],
                "area": "energy",
                "start_at": (base_time + timedelta(minutes=a["offset"])).isoformat(),
                "end_at":   (base_time + timedelta(minutes=a["offset"] + 30)).isoformat(),
                "is_phone": a["is_phone"],
            }
            r = requests.post(f"{BASE_URL}/api/appointments", headers=headers, json=payload, timeout=10)
            assert r.status_code == 200, r.text
            aid = r.json()["appointment_id"]
            ids.append(aid)
            if a["done"]:
                rp = requests.put(f"{BASE_URL}/api/appointments/{aid}", headers=headers, json={"done": True}, timeout=10)
                assert rp.status_code == 200, rp.text
        yield ids
        # cleanup
        for aid in ids:
            requests.delete(f"{BASE_URL}/api/appointments/{aid}", headers=headers, timeout=10)

    def test_appointments_total_matches_report(self, headers, created_ids):
        rp = requests.get(f"{BASE_URL}/api/reports?period=day", headers=headers, timeout=10).json()
        start, end = rp["start"], rp["end"]
        r = requests.get(
            f"{BASE_URL}/api/appointments",
            headers=headers,
            params={"start": start, "end": end, "area": "energy"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # Filter to today TEST_V26s appointments only (may be others too)
        test_items = [x for x in items if x.get("title", "").startswith("TEST_V26s")]
        assert len(test_items) == 4, f"expected 4 test appts, got {len(test_items)}"
        # Verify report stats
        energy = rp["stats"]["energy"]
        # Backend values must be >= test values (there may be other rows)
        assert energy["appointments_total"] >= 4
        assert energy["appointments_done"] >= 3
        assert energy["phone_done"] >= 1

    def test_drill_done_filter(self, headers, created_ids):
        rp = requests.get(f"{BASE_URL}/api/reports?period=day", headers=headers, timeout=10).json()
        r = requests.get(
            f"{BASE_URL}/api/appointments",
            headers=headers,
            params={"start": rp["start"], "end": rp["end"], "area": "energy"},
            timeout=10,
        )
        items = [x for x in r.json()["items"] if x.get("title", "").startswith("TEST_V26s")]
        done = [x for x in items if x.get("done")]
        phone_done = [x for x in items if x.get("done") and x.get("is_phone")]
        assert len(done) == 3
        assert len(phone_done) == 1

    def test_drill_area_filter_isolation(self, headers, created_ids):
        rp = requests.get(f"{BASE_URL}/api/reports?period=day", headers=headers, timeout=10).json()
        r = requests.get(
            f"{BASE_URL}/api/appointments",
            headers=headers,
            params={"start": rp["start"], "end": rp["end"], "area": "network"},
            timeout=10,
        )
        assert r.status_code == 200
        items = [x for x in r.json()["items"] if x.get("title", "").startswith("TEST_V26s")]
        assert len(items) == 0, "network area should not contain TEST_V26s energy items"


# =========================
# Fix 3: /callbacks?day=today excludes yesterday's callbacks
# =========================
class TestCallbacksDayFilter:
    def test_yesterday_callback_excluded_from_today(self, headers):
        yesterday = datetime.now(timezone.utc) - timedelta(days=1)
        yesterday_23 = yesterday.replace(hour=23, minute=0, second=0, microsecond=0)
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Create a callback scheduled yesterday 23:00 UTC
        r = requests.post(
            f"{BASE_URL}/api/callbacks",
            headers=headers,
            json={
                "title": "TEST_V26s Yesterday Callback",
                "area": "energy",
                "scheduled_at": yesterday_23.isoformat(),
                "note": "",
            },
            timeout=10,
        )
        assert r.status_code == 200, r.text
        cid = r.json()["callback_id"]
        try:
            r = requests.get(
                f"{BASE_URL}/api/callbacks",
                headers=headers,
                params={"day": today_str, "include_done": True},
                timeout=10,
            )
            assert r.status_code == 200
            ids = [x["callback_id"] for x in r.json()["items"]]
            assert cid not in ids, "yesterday's callback must NOT appear in today's list"

            # Yesterday query still finds it
            r2 = requests.get(
                f"{BASE_URL}/api/callbacks",
                headers=headers,
                params={"day": yesterday.strftime("%Y-%m-%d"), "include_done": True},
                timeout=10,
            )
            assert r2.status_code == 200
            ids2 = [x["callback_id"] for x in r2.json()["items"]]
            assert cid in ids2
        finally:
            requests.delete(f"{BASE_URL}/api/callbacks/{cid}", headers=headers, timeout=10)
