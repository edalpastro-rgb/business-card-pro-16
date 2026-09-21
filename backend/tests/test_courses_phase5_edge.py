"""V50.z300 edge: verify recipient 'no' skipped in pre-reminder + invalid course_time normalized to empty."""
import os
import datetime as dt
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("BASE_URL") or "https://business-card-pro-16.preview.emergentagent.com"
API = BASE.rstrip("/") + "/api"


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    r.raise_for_status()
    return r.json()["token"], r.json()["user"]


@pytest.fixture(scope="module")
def owner():
    tok, u = _login("test@dalpastro.it", "Test1234!")
    return {"tok": tok, "H": {"Authorization": f"Bearer {tok}"}, "u": u}


@pytest.fixture(scope="module")
def sub():
    tok, u = _login("sub1@dalpastro.it", "Sub12345!")
    return {"tok": tok, "H": {"Authorization": f"Bearer {tok}"}, "u": u}


# --- course_time / pre_reminders normalization ---
def test_create_course_time_normalization(owner, sub):
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    r = requests.post(f"{API}/courses", headers=owner["H"], json={
        "title": "TEST_edge_time",
        "course_date": tomorrow,
        "course_time": "9.30",
        "location": "Sede",
        "recipients": [sub["u"]["user_id"]],
        "pre_reminders": [1, 7, 99],
    }, timeout=30)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["course_time"] == "09:30"
    assert c["pre_reminders"] == [7, 1]
    cid = c["course_id"]

    # PUT invalid time -> empty
    r = requests.put(f"{API}/courses/{cid}", headers=owner["H"], json={"course_time": "25:99"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["course_time"] == ""

    # PUT pre_reminders [0]
    r = requests.put(f"{API}/courses/{cid}", headers=owner["H"], json={"pre_reminders": [0]}, timeout=30)
    assert r.status_code == 200
    assert r.json()["pre_reminders"] == [0]

    # cleanup
    requests.delete(f"{API}/courses/{cid}", headers=owner["H"], timeout=30)


# --- recipient 'no' must NOT receive pre-lesson reminder ---
def test_recipient_no_excluded_from_prereminder(owner, sub):
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    r = requests.post(f"{API}/courses", headers=owner["H"], json={
        "title": "TEST_edge_no",
        "course_date": tomorrow,
        "course_time": "10:00",
        "location": "Sede",
        "recipients": [sub["u"]["user_id"]],
        "pre_reminders": [1],
    }, timeout=30)
    assert r.status_code == 200
    cid = r.json()["course_id"]

    # sub answers 'no'
    r = requests.post(f"{API}/courses/{cid}/participation", headers=sub["H"], json={"status": "no"}, timeout=30)
    assert r.status_code == 200, r.text

    # snapshot sub notifs BEFORE
    r = requests.get(f"{API}/axon-notifications", headers=sub["H"], timeout=30)
    r.raise_for_status()
    data = r.json()
    items = data.get("items") if isinstance(data, dict) else data
    before_titles = [n.get("title") or "" for n in (items or [])]
    before_count_edge = sum(1 for t in before_titles if "TEST_edge_no" in t)

    # run reminders
    r = requests.post(f"{API}/courses/run-reminders", headers=owner["H"], timeout=60)
    assert r.status_code == 200, r.text
    print("run-reminders result:", r.json())

    # sub notifs AFTER
    r = requests.get(f"{API}/axon-notifications", headers=sub["H"], timeout=30)
    r.raise_for_status()
    data = r.json()
    items = data.get("items") if isinstance(data, dict) else data
    after_titles = [n.get("title") or "" for n in (items or [])]
    after_count_edge = sum(1 for t in after_titles if "TEST_edge_no" in t)

    assert after_count_edge == before_count_edge, (
        f"Sub with status='no' received a pre-reminder for TEST_edge_no. "
        f"before={before_count_edge} after={after_count_edge} sample={after_titles[:5]}"
    )

    # cleanup
    requests.delete(f"{API}/courses/{cid}", headers=owner["H"], timeout=30)


# --- tour recommendations dismiss invalid feature ---
def test_recommendations_dismiss_invalid(owner):
    r = requests.get(f"{API}/tour/recommendations", headers=owner["H"], timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data and "has_profile" in data

    r = requests.post(f"{API}/tour/recommendations/dismiss", headers=owner["H"],
                      json={"feature": "zzz"}, timeout=30)
    assert r.status_code == 400, r.text


# --- issue-all: sub cannot ---
def test_issue_all_forbidden_for_sub(owner, sub):
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    r = requests.post(f"{API}/courses", headers=owner["H"], json={
        "title": "TEST_edge_issue",
        "course_date": tomorrow,
        "recipients": [sub["u"]["user_id"]],
    }, timeout=30)
    assert r.status_code == 200
    cid = r.json()["course_id"]

    r = requests.post(f"{API}/courses/{cid}/certificates/issue-all", headers=sub["H"], timeout=30)
    assert r.status_code == 403, r.text

    requests.delete(f"{API}/courses/{cid}", headers=owner["H"], timeout=30)
