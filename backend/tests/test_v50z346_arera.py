# V50.z346 — Backend tests: ARERA/GME Official market data
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "test@dalpastro.it", "password": "Test1234!"}
MEMBER = {"email": "sub1@dalpastro.it", "password": "Sub12345!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token")
    assert token, f"missing token in {data}"
    return token


@pytest.fixture(scope="module")
def owner_headers():
    return {"Authorization": f"Bearer {_login(OWNER)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def member_headers():
    return {"Authorization": f"Bearer {_login(MEMBER)}", "Content-Type": "application/json"}


# --- GET /market/official ---

class TestOfficialList:
    def test_list_luce(self, owner_headers):
        r = requests.get(f"{API}/market/official?commodity=luce", headers=owner_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "indices" in data and "fields" in data and "periods" in data
        idx_ids = [i["id"] for i in data["indices"]]
        assert "gme_pun" in idx_ids and "arera_stg" in idx_ids

    def test_list_gas(self, owner_headers):
        r = requests.get(f"{API}/market/official?commodity=gas", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        idx_ids = [i["id"] for i in r.json()["indices"]]
        assert "gme_psv" in idx_ids and "arera_tutela_gas" in idx_ids

    def test_list_telco(self, owner_headers):
        r = requests.get(f"{API}/market/official?commodity=telco", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        idx_ids = [i["id"] for i in r.json()["indices"]]
        assert "agcom_media" in idx_ids

    def test_invalid_commodity(self, owner_headers):
        r = requests.get(f"{API}/market/official?commodity=xyz", headers=owner_headers, timeout=30)
        assert r.status_code == 400


# --- POST /market/official ---

class TestOfficialSave:
    def test_save_owner_ok_and_update(self, owner_headers):
        # Save first
        payload = {
            "commodity": "luce",
            "index_id": "gme_pun",
            "period": "2026-04",
            "values": {"prezzo_energia_eur_kwh": "0,125", "prezzo_f1_eur_kwh": 0.13},
            "notes": "TEST_delibera_ARERA_v50z346"
        }
        r = requests.post(f"{API}/market/official", json=payload, headers=owner_headers, timeout=30)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["source"] == "official"
        assert rec["official_index"] == "gme_pun"
        assert rec["period"] == "2026-04"
        assert rec["valid_from"] == "2026-04-01"
        assert rec["supplier"] == "GME · PUN"
        assert abs(rec["values"]["prezzo_energia_eur_kwh"] - 0.125) < 1e-6
        rid1 = rec["record_id"]

        # Re-post -> update, same record_id
        payload["values"] = {"prezzo_energia_eur_kwh": "0,130"}
        r2 = requests.post(f"{API}/market/official", json=payload, headers=owner_headers, timeout=30)
        assert r2.status_code == 200
        rec2 = r2.json()
        assert rec2["record_id"] == rid1
        assert abs(rec2["values"]["prezzo_energia_eur_kwh"] - 0.130) < 1e-6

    def test_invalid_period_dash13(self, owner_headers):
        r = requests.post(f"{API}/market/official", json={
            "commodity": "luce", "index_id": "gme_pun", "period": "2026-13",
            "values": {"prezzo_energia_eur_kwh": 0.1}
        }, headers=owner_headers, timeout=30)
        assert r.status_code == 400

    def test_invalid_period_slash(self, owner_headers):
        r = requests.post(f"{API}/market/official", json={
            "commodity": "luce", "index_id": "gme_pun", "period": "2026/05",
            "values": {"prezzo_energia_eur_kwh": 0.1}
        }, headers=owner_headers, timeout=30)
        assert r.status_code == 400

    def test_index_commodity_mismatch(self, owner_headers):
        r = requests.post(f"{API}/market/official", json={
            "commodity": "luce", "index_id": "gme_psv", "period": "2026-05",
            "values": {"prezzo_gas_eur_smc": 0.3}
        }, headers=owner_headers, timeout=30)
        assert r.status_code == 400

    def test_empty_values(self, owner_headers):
        r = requests.post(f"{API}/market/official", json={
            "commodity": "luce", "index_id": "gme_pun", "period": "2026-05",
            "values": {}
        }, headers=owner_headers, timeout=30)
        assert r.status_code == 400

    def test_non_numeric_values(self, owner_headers):
        r = requests.post(f"{API}/market/official", json={
            "commodity": "luce", "index_id": "gme_pun", "period": "2026-05",
            "values": {"prezzo_energia_eur_kwh": "abc"}
        }, headers=owner_headers, timeout=30)
        assert r.status_code == 400

    def test_member_forbidden(self, member_headers):
        r = requests.post(f"{API}/market/official", json={
            "commodity": "luce", "index_id": "gme_pun", "period": "2026-05",
            "values": {"prezzo_energia_eur_kwh": 0.1}
        }, headers=member_headers, timeout=30)
        assert r.status_code == 403


# --- GET /market/official/compare ---

class TestOfficialCompare:
    def test_compare_uses_most_recent_le_period(self, owner_headers):
        # Save 2026-05
        r = requests.post(f"{API}/market/official", json={
            "commodity": "luce", "index_id": "gme_pun", "period": "2026-05",
            "values": {"prezzo_energia_eur_kwh": "0,115"}, "notes": "TEST_may2026"
        }, headers=owner_headers, timeout=30)
        assert r.status_code == 200

        # Ask for 2026-06 -> reference should be 2026-05
        r = requests.get(f"{API}/market/official/compare?commodity=luce&index_id=gme_pun&period=2026-06",
                         headers=owner_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["reference"] is not None
        assert data["reference"]["period"] == "2026-05"

        # summary shape validation
        for f_key, sm in data.get("summary", {}).items():
            for k in ["ref", "avg", "min", "max", "n", "below", "above", "delta_avg"]:
                assert k in sm
        # rows cell shape
        for row in data.get("rows", []):
            for k, c in row["cells"].items():
                for kk in ["value", "ref", "delta", "pct"]:
                    assert kk in c

    def test_compare_default_index(self, owner_headers):
        # No index_id -> should default to first index of commodity (gme_pun for luce)
        r = requests.get(f"{API}/market/official/compare?commodity=luce&period=2026-06",
                         headers=owner_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["index"]["id"] == "gme_pun"

    def test_compare_no_official_returns_null_ref_but_rows(self, owner_headers):
        # Pick a commodity/index that has no official records: agcom_media for far past
        # First, delete any pre-existing official for a marker period. Use very old period likely not present.
        r = requests.get(f"{API}/market/official/compare?commodity=telco&index_id=agcom_media&period=1990-01",
                         headers=owner_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["reference"] is None
        assert isinstance(data["rows"], list)

    def test_compare_invalid_commodity(self, owner_headers):
        r = requests.get(f"{API}/market/official/compare?commodity=xxx", headers=owner_headers, timeout=30)
        assert r.status_code == 400


# --- Integration with /market/benchmark and DELETE /market/records ---

class TestBenchmarkOfficialLinkage:
    def test_benchmark_contains_official(self, owner_headers):
        # Ensure at least one official exists
        requests.post(f"{API}/market/official", json={
            "commodity": "luce", "index_id": "gme_pun", "period": "2026-03",
            "values": {"prezzo_energia_eur_kwh": 0.12}, "notes": "TEST_bench_link"
        }, headers=owner_headers, timeout=30)
        r = requests.get(f"{API}/market/benchmark?commodity=luce", headers=owner_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "official" in data and isinstance(data["official"], list)
        # find our GME · PUN row
        assert any("PUN" in r_.get("supplier", "") or "GME" in r_.get("supplier", "") for r_ in data["official"])

    def test_delete_official_record(self, owner_headers):
        # Create a temp official
        r = requests.post(f"{API}/market/official", json={
            "commodity": "gas", "index_id": "gme_psv", "period": "2026-02",
            "values": {"prezzo_gas_eur_smc": 0.35}, "notes": "TEST_todelete"
        }, headers=owner_headers, timeout=30)
        assert r.status_code == 200
        rid = r.json()["record_id"]
        d = requests.delete(f"{API}/market/records/{rid}", headers=owner_headers, timeout=30)
        assert d.status_code == 200
        # verify gone
        r2 = requests.get(f"{API}/market/official?commodity=gas", headers=owner_headers, timeout=30)
        all_recs = [rec for p in r2.json()["periods"] for rec in p["records"]]
        assert not any(x["record_id"] == rid for x in all_recs)
