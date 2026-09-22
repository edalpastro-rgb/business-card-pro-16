"""V50.z326 — Autocompilazione CRT (4 blocchi): campi da estrarre (GET/PUT /crt/settings/extract, solo Master) + save-master (404 senza PDF)."""
import os, requests
BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
def login(e, p):
    r = requests.post(f"{BASE}/auth/login", json={"email": e, "password": p}, timeout=20); assert r.status_code == 200; return {"Authorization": f"Bearer {r.json()['token']}"}
def test_extract_settings_and_save_master():
    h = login("test@dalpastro.it", "Test1234!")
    g = requests.get(f"{BASE}/crt/settings/extract", headers=h, timeout=20).json()
    assert len(g["presets"]) >= 10 and isinstance(g["fields"], list)
    u = requests.put(f"{BASE}/crt/settings/extract", json={"fields": ["full_name", "tax_code", "iban"], "custom_fields": [" ATECO "], "sign_place_date_everywhere": False}, headers=h, timeout=20).json()
    assert u["fields"] == ["full_name", "tax_code", "iban"] and u["custom_fields"] == ["ATECO"] and u["sign_place_date_everywhere"] is False
    g2 = requests.get(f"{BASE}/crt/settings/extract", headers=h, timeout=20).json()
    assert g2["fields"] == ["full_name", "tax_code", "iban"] and g2["custom_fields"] == ["ATECO"]
    collab = login("collab.demo@advisoros.it", "Demo1234!")
    assert requests.put(f"{BASE}/crt/settings/extract", json={"fields": ["iban"]}, headers=collab, timeout=20).status_code == 403
    cid = (requests.get(f"{BASE}/contacts", headers=h, timeout=20).json()); cid = (cid.get("items", cid) if isinstance(cid, dict) else cid)[0]["contact_id"]
    pid = requests.post(f"{BASE}/crt", json={"contact_id": cid, "services": ["luce"]}, headers=h, timeout=20).json()["practice_id"]
    try:
        assert requests.post(f"{BASE}/crt/{pid}/save-master", headers=h, timeout=20).status_code == 404
    finally:
        requests.delete(f"{BASE}/crt/{pid}", headers=h, timeout=20)
        requests.put(f"{BASE}/crt/settings/extract", json={"fields": ["full_name", "tax_code", "vat_number", "address", "iban"], "custom_fields": [], "sign_place_date_everywhere": True}, headers=h, timeout=20)
