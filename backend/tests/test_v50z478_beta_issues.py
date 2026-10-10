"""V50.z478 — Cruscotto Beta › Segnalazioni ed errori (GET /admin/beta/issues, POST /admin/beta/tickets/{id}/status)
+ fix collisione `_ob_out` (GET /org/branding 500) + fix contatti legacy senza contact_id (GET /deadlines/upcoming 500).
Esegui: cd /app/backend && python -m pytest tests/test_v50z478_beta_issues.py -q
"""
import os
import pytest
import requests

B = (os.environ.get("TEST_BASE_URL") or "http://localhost:8001") + "/api"


@pytest.fixture(scope="module")
def H():
    r = requests.post(B + "/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


@pytest.fixture(scope="module")
def Hsub():
    r = requests.post(B + "/auth/login", json={"email": "sub1@dalpastro.it", "password": "Sub12345!"}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_branding_and_deadlines_no_500(H, Hsub):
    for h in (H, Hsub):
        for p in ("/org/branding", "/deadlines/upcoming", "/onboarding/me"):
            r = requests.get(B + p, headers=h, timeout=30)
            assert r.status_code == 200, (p, r.status_code, r.text[:200])


def test_issues_payload(H):
    r = requests.get(B + "/admin/beta/issues?days=42", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d) >= {"days", "scope", "tickets", "errors", "watchdog"}
    assert set(d["tickets"]["counts"]) == {"open", "escalated", "resolved"}
    assert isinstance(d["errors"]["groups"], list)
    assert "by_kind" in d["watchdog"]


def test_ticket_triage_roundtrip(H):
    t = requests.post(B + "/support/tickets", json={"text": "Test z478: segnalazione di prova dal cruscotto beta", "checks": []}, headers=H, timeout=60).json()
    tid = t["ticket_id"]
    r = requests.post(B + f"/admin/beta/tickets/{tid}/status", json={"status": "resolved", "note": "verificato"}, headers=H, timeout=30)
    assert r.status_code == 200 and r.json()["status"] == "resolved"
    d = requests.get(B + "/admin/beta/issues?days=42&status=resolved", headers=H, timeout=30).json()
    it = next(i for i in d["tickets"]["items"] if i["ticket_id"] == tid)
    assert it["note"] == "verificato" and it["status"] == "resolved"
    r = requests.post(B + f"/admin/beta/tickets/{tid}/status", json={"status": "open"}, headers=H, timeout=30)
    assert r.status_code == 200
    d = requests.get(B + "/admin/beta/issues?days=42&status=open", headers=H, timeout=30).json()
    assert any(i["ticket_id"] == tid for i in d["tickets"]["items"])
    assert requests.post(B + f"/admin/beta/tickets/{tid}/status", json={"status": "boh"}, headers=H, timeout=30).status_code == 400
    assert requests.post(B + "/admin/beta/tickets/stkt_nope/status", json={"status": "open"}, headers=H, timeout=30).status_code == 404


def test_sub_user_forbidden(Hsub):
    assert requests.get(B + "/admin/beta/issues", headers=Hsub, timeout=30).status_code == 403


def test_export_includes_issues(H):
    r = requests.get(B + "/admin/beta/export.csv?days=42", headers=H, timeout=60)
    assert r.status_code == 200 and "SEGNALAZIONI BUG" in r.text and "ERRORI BACKEND" in r.text
    r = requests.get(B + "/admin/beta/export.pdf?days=42", headers=H, timeout=90)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
