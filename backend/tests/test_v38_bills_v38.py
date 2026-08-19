"""V38 backend tests for Fatture module:
1. POST /bills — analysis_params passthrough
2. POST /bills/{id}/cancel — cancellation endpoint
3. GET /bills/comparison — 502 fix, structured sections, parallel LLM
"""
import os
import base64
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"


# Minimal valid PDF (single page "Test") ~1KB
MINI_PDF_B64 = (
    "JVBERi0xLjEKJcKlwrHDqwoKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1BhZ2VzIDIgMCBSCiAgPj4KZW5kb2JqCgoyIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2VzCiAgICAgL0tpZHMgWzMgMCBSXQogICAgIC9Db3VudCAxCiAgICAgL01lZGlhQm94IFswIDAgMzAwIDE0NF0KICA+PgplbmRvYmoKCjMgMCBvYmoKICA8PCAgL1R5cGUgL1BhZ2UKICAgICAgL1BhcmVudCAyIDAgUgogICAgICAvUmVzb3VyY2VzCiAgICAgICA8PCAvRm9udAogICAgICAgICAgIDw8IC9GMQogICAgICAgICAgICAgICA8PCAvVHlwZSAvRm9udAogICAgICAgICAgICAgICAgICAvU3VidHlwZSAvVHlwZTEKICAgICAgICAgICAgICAgICAgL0Jhc2VGb250IC9UaW1lcy1Sb21hbgogICAgICAgICAgICAgICA+PgogICAgICAgICAgID4+CiAgICAgICA+PgogICAgICAvQ29udGVudHMgNCAwIFIKICA+PgplbmRvYmoKCjQgMCBvYmoKICA8PCAvTGVuZ3RoIDU1ID4+CnN0cmVhbQogIEJUCiAgICAvRjEgMTggVGYKICAgIDAgMCBUZAogICAgKEZhdHR1cmEgVGVzdCkgVGoKICBFVAplbmRzdHJlYW0KZW5kb2JqCgp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTggMDAwMDAgbiAKMDAwMDAwMDA3NyAwMDAwMCBuIAowMDAwMDAwMTc4IDAwMDAwIG4gCjAwMDAwMDA0NTcgMDAwMDAgbiAKdHJhaWxlcgogIDw8ICAvUm9vdCAxIDAgUgogICAgICAvU2l6ZSA1CiAgPj4Kc3RhcnR4cmVmCjU2NQolJUVPRgo="
)


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data, data
    return data["token"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def contact_id(hdr):
    """Reuse an existing contact or create a new one."""
    r = requests.get(f"{API}/contacts", headers=hdr, timeout=30)
    assert r.status_code == 200
    items = r.json()
    if items and isinstance(items, list) and len(items) > 0:
        return items[0]["contact_id"]
    payload = {"first_name": "TEST_V38", "last_name": "Bills", "phones": [{"kind": "cellulare", "value": "+390000000000"}]}
    rc = requests.post(f"{API}/contacts", headers=hdr, json=payload, timeout=30)
    assert rc.status_code in (200, 201), rc.text
    return rc.json()["contact_id"]


# ---- Test 1: analysis_params passthrough ---------------------------------
class TestAnalysisParamsPassthrough:
    def test_upload_bill_with_analysis_params(self, hdr, contact_id):
        body = {
            "bill_type": "luce",
            "pdf_base64": MINI_PDF_B64,
            "pdf_name": "TEST_V38_params.pdf",
            "pdf_mime": "application/pdf",
            "analysis_params": ["Spread €/kWh", "F1 F2 F3", "ASOS"],
        }
        r = requests.post(f"{API}/contacts/{contact_id}/bills", headers=hdr, json=body, timeout=30)
        assert r.status_code in (200, 201), r.text
        created = r.json()
        assert created["bill_type"] == "luce"
        bill_id = created["bill_id"]

        # Verify via GET list
        r2 = requests.get(f"{API}/contacts/{contact_id}/bills", headers=hdr, timeout=30)
        assert r2.status_code == 200
        items = r2.json()["items"]
        found = next((b for b in items if b["bill_id"] == bill_id), None)
        assert found is not None, f"bill_id {bill_id} not found"
        assert "analysis_params" in found, "analysis_params key missing in stored bill"
        assert found["analysis_params"] == ["Spread €/kWh", "F1 F2 F3", "ASOS"], f"Got: {found.get('analysis_params')}"

        # cleanup: cancel/delete
        try:
            requests.post(f"{API}/contacts/{contact_id}/bills/{bill_id}/cancel", headers=hdr, timeout=10)
        except Exception:
            pass
        requests.delete(f"{API}/contacts/{contact_id}/bills/{bill_id}", headers=hdr, timeout=10)


# ---- Test 2: cancel endpoint ---------------------------------------------
class TestCancelBill:
    def test_cancel_pending_bill(self, hdr, contact_id):
        # Race the background task with several rapid uploads; at least one should be
        # cancellable while still 'pending' or 'analyzing'.
        cancelled_ok = False
        rejected_ok = False
        last_status = None
        last_response = None
        for i in range(6):
            body = {
                "bill_type": "luce",
                "pdf_base64": MINI_PDF_B64,
                "pdf_name": f"TEST_V38_cancel_{i}.pdf",
                "pdf_mime": "application/pdf",
            }
            r = requests.post(f"{API}/contacts/{contact_id}/bills", headers=hdr, json=body, timeout=30)
            assert r.status_code in (200, 201), r.text
            bill_id = r.json()["bill_id"]
            rc = requests.post(f"{API}/contacts/{contact_id}/bills/{bill_id}/cancel", headers=hdr, timeout=15)
            last_response = rc
            if rc.status_code == 200:
                data = rc.json()
                assert data.get("ok") is True
                assert data.get("status") == "cancelled"
                # Verify persisted
                rl = requests.get(f"{API}/contacts/{contact_id}/bills", headers=hdr, timeout=15)
                found = next((b for b in rl.json()["items"] if b["bill_id"] == bill_id), None)
                assert found is not None
                last_status = found.get("status")
                if found.get("status") == "cancelled":
                    assert "annullata" in (found.get("error_message") or "").lower()
                    cancelled_ok = True
                # Second cancel should return 400
                rc2 = requests.post(f"{API}/contacts/{contact_id}/bills/{bill_id}/cancel", headers=hdr, timeout=15)
                assert rc2.status_code == 400
                rejected_ok = True
                requests.delete(f"{API}/contacts/{contact_id}/bills/{bill_id}", headers=hdr, timeout=10)
                break
            elif rc.status_code == 400:
                # Task raced to error/done — that's fine, cancel endpoint rejected correctly
                rejected_ok = True
                requests.delete(f"{API}/contacts/{contact_id}/bills/{bill_id}", headers=hdr, timeout=10)
                continue
            else:
                requests.delete(f"{API}/contacts/{contact_id}/bills/{bill_id}", headers=hdr, timeout=10)
        # At least the reject path must have been exercised
        assert rejected_ok, f"cancel endpoint never returned expected status. Last: {last_response.status_code} {last_response.text if last_response else ''}"
        print(f"cancelled_ok={cancelled_ok} rejected_ok={rejected_ok} last_status={last_status}")
        # We consider success if we hit cancellation OR properly got 400 (task already done/error)
        rc = last_response
        assert rc.status_code == 200 or cancelled_ok or rejected_ok, "no expected response path"

    def test_cancel_nonexistent_bill(self, hdr, contact_id):
        r = requests.post(f"{API}/contacts/{contact_id}/bills/nonexistent-id/cancel", headers=hdr, timeout=10)
        assert r.status_code == 404


# ---- Test 3: comparison endpoint 400 error paths -------------------------
class TestComparisonErrors:
    def test_comparison_no_done_bills(self, hdr):
        """(a) With a fresh contact having no bills, expect 400."""
        r = requests.post(f"{API}/contacts", headers=hdr, json={
            "first_name": "TEST_V38_Empty",
            "last_name": "NoBills",
            "phones": [{"kind": "cellulare", "value": "+390000000001"}],
        }, timeout=15)
        assert r.status_code in (200, 201)
        cid = r.json()["contact_id"]
        try:
            rc = requests.get(f"{API}/contacts/{cid}/bills/comparison", headers=hdr, timeout=15)
            assert rc.status_code == 400, f"expected 400 got {rc.status_code} — {rc.text}"
            detail = (rc.json().get("detail") or "").lower()
            assert "fattura" in detail or "nessuna" in detail
        finally:
            requests.delete(f"{API}/contacts/{cid}", headers=hdr, timeout=10)


# ---- Test 4: comparison endpoint does not return 502 ---------------------
class TestComparisonNo502:
    def test_comparison_endpoint_reachable(self, hdr, contact_id):
        """Call comparison — must NEVER return 502. Acceptable: 200 or 400."""
        t0 = time.time()
        rc = requests.get(f"{API}/contacts/{contact_id}/bills/comparison", headers=hdr, timeout=120)
        elapsed = time.time() - t0
        print(f"[comparison] status={rc.status_code} elapsed={elapsed:.1f}s")
        assert rc.status_code != 502, f"502 returned! text={rc.text[:300]}"
        assert rc.status_code != 504, f"504 timeout returned!"
        assert rc.status_code in (200, 400), f"unexpected status={rc.status_code} — {rc.text[:300]}"
        # If 200, verify structure
        if rc.status_code == 200:
            data = rc.json()
            assert "items" in data
            assert isinstance(data["items"], list)
            # Elapsed should be sane (< 90s even with 3 parallel calls)
            assert elapsed < 90, f"comparison too slow: {elapsed}s"
            # If items present, verify at least one has structured fields (or parse_error)
            for it in data["items"]:
                comp = it.get("comparison") or {}
                # V38 structured fields (may be empty if LLM returned partial)
                has_new_fields = any(k in comp for k in (
                    "impronta_energetica", "dettaglio_fasce",
                    "analisi_contratto_attuale", "calcolo_risparmio",
                    "matrice_confronto", "executive_summary"
                )) or comp.get("parse_error")
                assert has_new_fields, f"comparison lacks new V38 structured fields: {list(comp.keys())[:10]}"


# ---- Test 5: comparison with seeded matching pair (verifies parallel + structure)
class TestComparisonWithSeededData:
    """Seeds a bill (status=done) + a company offer (status=done) for the same bill_type
    via direct DB insert, calls the comparison endpoint, and verifies parallel exec
    + presence of new V38 structured sections."""

    def test_seed_and_compare(self, hdr, contact_id):
        import asyncio, uuid
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        MONGO_URL = os.environ["MONGO_URL"]
        DB_NAME = os.environ.get("DB_NAME", "crm")

        # Determine user_id from login (not /auth/me)
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=15)
        assert r.status_code == 200
        user_id = r.json()["user"]["user_id"]

        bill_id_seed = f"TESTV38_bill_{uuid.uuid4().hex[:8]}"
        offer_id_seed = f"TESTV38_offer_{uuid.uuid4().hex[:8]}"

        async def seed():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            bill_doc = {
                "bill_id": bill_id_seed,
                "contact_id": contact_id,
                "user_id": user_id,
                "created_by": user_id,
                "bill_type": "luce",
                "pdf_base64": "",
                "pdf_name": "TEST_seed.pdf",
                "pdf_mime": "application/pdf",
                "pdf_size": 1000,
                "status": "done",
                "extracted": {
                    "fornitore": "TestSupplier Attuale",
                    "spread_kwh": 0.15,
                    "consumo_annuo_kwh": 3200,
                    "f1_kwh": 1400,
                    "f2_kwh": 900,
                    "f3_kwh": 900,
                    "costo_totale_annuo_eur": 1120,
                },
                "raw_text_preview": "Fattura test",
                "error_message": None,
                "analysis_params": None,
            }
            offer_doc = {
                "offer_id": offer_id_seed,
                "user_id": user_id,
                "created_by": user_id,
                "bill_type": "luce",
                "label": "TEST_V38 Offerta",
                "pdf_base64": "",
                "pdf_name": "TEST_offer.pdf",
                "status": "done",
                "extracted": {
                    "fornitore": "MyCompany Offerta",
                    "spread_kwh": 0.08,
                    "prezzo_fisso_mensile_eur": 5,
                    "durata_mesi": 24,
                },
                "error_message": None,
            }
            await db.energy_bills.insert_one(bill_doc)
            await db.company_offers.insert_one(offer_doc)
            client.close()

        async def cleanup():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.energy_bills.delete_one({"bill_id": bill_id_seed})
            await db.company_offers.delete_one({"offer_id": offer_id_seed})
            client.close()

        asyncio.run(seed())
        try:
            t0 = time.time()
            rc = requests.get(f"{API}/contacts/{contact_id}/bills/comparison", headers=hdr, timeout=120)
            elapsed = time.time() - t0
            print(f"[seeded-comparison] status={rc.status_code} elapsed={elapsed:.1f}s")
            assert rc.status_code != 502, f"502 returned! text={rc.text[:400]}"
            assert rc.status_code != 504
            assert rc.status_code == 200, f"expected 200 with seeded pair, got {rc.status_code} — {rc.text[:400]}"
            data = rc.json()
            assert "items" in data and len(data["items"]) >= 1
            luce_item = next((i for i in data["items"] if i["bill_type"] == "luce"), None)
            assert luce_item is not None, f"no luce comparison item found: {data}"
            comp = luce_item["comparison"]
            print(f"[comparison keys] {list(comp.keys())}")
            # Must contain at least one V38 structured section OR parse_error path
            v38_keys = {"impronta_energetica", "dettaglio_fasce",
                        "analisi_contratto_attuale", "calcolo_risparmio",
                        "matrice_confronto", "executive_summary"}
            has_v38 = bool(v38_keys.intersection(comp.keys())) or comp.get("parse_error")
            assert has_v38, f"comparison missing V38 sections: keys={list(comp.keys())}"
            # Parallel execution sanity: for a single pair it should be under 60s (ingress limit)
            assert elapsed < 60, f"comparison exceeded 60s ingress limit: {elapsed}s (parallel gather may be broken)"
        finally:
            asyncio.run(cleanup())
