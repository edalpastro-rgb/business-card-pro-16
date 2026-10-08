"""V50.z477 — Export Cruscotto Beta (CSV + PDF)."""
import os, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")


def _login():
    r = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_export_csv():
    h = _login()
    r = requests.get(f"{BASE}/admin/beta/export.csv?days=14", headers=h, timeout=90)
    assert r.status_code == 200, r.text[:300]
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=" in r.headers.get("content-disposition", "")
    txt = r.content.decode("utf-8-sig")
    assert txt.startswith("AdvisorOS - Cruscotto Beta")
    for sec in ("METRICHE", "FRASI NON CAPITE DA AXON", "SONDAGGIO NPS", "PARTECIPANTI PROGRAMMA", "DIARIO DEL VENERD"):
        assert sec in txt, sec
    assert txt.count("\r\n") >= 20  # intestazione + 10 metriche + sezioni


def test_export_pdf():
    h = _login()
    r = requests.get(f"{BASE}/admin/beta/export.pdf?days=14", headers=h, timeout=120)
    assert r.status_code == 200, r.text[:300]
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"
    assert len(r.content) > 3000


def test_export_requires_auth():
    assert requests.get(f"{BASE}/admin/beta/export.pdf", timeout=20).status_code in (401, 403)
    assert requests.get(f"{BASE}/admin/beta/export.csv", timeout=20).status_code in (401, 403)
