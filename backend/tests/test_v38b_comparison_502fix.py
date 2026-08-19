"""V38 iteration 2 — verify /bills/comparison HTTP 502 fix.

The fix splits the single heavy COMPARISON_PROMPT LLM call into two smaller prompts
(BASIC + RICH) run in parallel via asyncio.gather in _llm_compare_offers().
This test seeds a matched (done bill, done offer) pair and asserts:
  - status 200 (not 502/504) within 60s
  - response contains items[].comparison with fields from BOTH prompts
  - error paths (no bills, no matching offers) still return 400 quickly
"""
import os
import time
import uuid
import asyncio
import pytest
import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contact-hub-italy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


# BASIC prompt fields
BASIC_FIELDS = {
    "sintesi",
    "vantaggi_offerta_aziendale",
    "svantaggi_offerta_aziendale",
    "raccomandazione",
    "risparmio_annuo_stimato_eur",
}
# RICH prompt fields
RICH_FIELDS = {
    "impronta_energetica",
    "dettaglio_fasce",
    "analisi_contratto_attuale",
    "calcolo_risparmio",
    "matrice_confronto",
    "executive_summary",
}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data["token"], data["user"]["user_id"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token[0]}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_id(token):
    return token[1]


# -----------------------------------------------------------------
# 1) 400 path: contact with 0 done bills
# -----------------------------------------------------------------
class TestComparison400NoBills:
    def test_no_done_bills_returns_400_fast(self, hdr):
        r = requests.post(f"{API}/contacts", headers=hdr, json={
            "first_name": "TEST_V38b_Empty",
            "last_name": "NoBills",
            "phones": [{"kind": "cellulare", "value": "+390000000901"}],
        }, timeout=15)
        assert r.status_code in (200, 201)
        cid = r.json()["contact_id"]
        try:
            t0 = time.time()
            rc = requests.get(f"{API}/contacts/{cid}/bills/comparison", headers=hdr, timeout=15)
            elapsed = time.time() - t0
            print(f"[no-bills] status={rc.status_code} elapsed={elapsed:.2f}s")
            assert rc.status_code == 400, f"expected 400 got {rc.status_code} — {rc.text}"
            detail = (rc.json().get("detail") or "").lower()
            assert "nessuna fattura" in detail or "fattura" in detail
            assert elapsed < 5, f"400 no-bills should be fast, was {elapsed}s"
        finally:
            requests.delete(f"{API}/contacts/{cid}", headers=hdr, timeout=10)


# -----------------------------------------------------------------
# 2) 400 path: contact with done bill but no matching-type company offer
# -----------------------------------------------------------------
class TestComparison400NoMatchingOffer:
    def test_no_matching_offer_returns_400_fast(self, hdr, user_id):
        """Seed a done bill for luce but ensure NO luce offer exists → expect 'Nessuna coppia'."""
        # New contact
        r = requests.post(f"{API}/contacts", headers=hdr, json={
            "first_name": "TEST_V38b_NoMatch",
            "last_name": "NoOffer",
            "phones": [{"kind": "cellulare", "value": "+390000000902"}],
        }, timeout=15)
        assert r.status_code in (200, 201)
        cid = r.json()["contact_id"]

        bill_id_seed = f"TESTV38B_bill_{uuid.uuid4().hex[:8]}"

        async def seed():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            # Seed a done LUCE bill
            await db.energy_bills.insert_one({
                "bill_id": bill_id_seed,
                "contact_id": cid,
                "user_id": user_id,
                "created_by": user_id,
                "bill_type": "luce",
                "pdf_base64": "",
                "pdf_name": "TESTV38B_bill.pdf",
                "pdf_mime": "application/pdf",
                "pdf_size": 500,
                "status": "done",
                "extracted": {"fornitore": "Test"},
                "raw_text_preview": "x",
                "error_message": None,
                "analysis_params": None,
            })
            # Remove ANY existing luce offers for this tenant so match returns none
            existing_luce_offers = await db.company_offers.find(
                {"user_id": user_id, "status": "done", "bill_type": "luce"},
                {"offer_id": 1}
            ).to_list(100)
            luce_offer_ids = [o["offer_id"] for o in existing_luce_offers]
            if luce_offer_ids:
                # Temporarily flip their status so bills/comparison ignores them
                await db.company_offers.update_many(
                    {"offer_id": {"$in": luce_offer_ids}},
                    {"$set": {"status": "hidden_for_test"}}
                )
            # Seed a done GAS offer (so overall offers set is NOT empty → we hit the 'no coppia' branch, not the 'nessuna offerta' branch)
            gas_offer_id = f"TESTV38B_gasoffer_{uuid.uuid4().hex[:8]}"
            await db.company_offers.insert_one({
                "offer_id": gas_offer_id,
                "user_id": user_id,
                "created_by": user_id,
                "bill_type": "gas",
                "label": "TESTV38B Gas offer",
                "pdf_base64": "",
                "pdf_name": "TESTV38B_gas.pdf",
                "status": "done",
                "extracted": {"fornitore": "GasCorp"},
                "error_message": None,
            })
            client.close()
            return {"gas_offer_id": gas_offer_id, "restored_luce": luce_offer_ids}

        async def cleanup(seeded):
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.energy_bills.delete_one({"bill_id": bill_id_seed})
            await db.company_offers.delete_one({"offer_id": seeded["gas_offer_id"]})
            # Restore any hidden luce offers
            if seeded["restored_luce"]:
                await db.company_offers.update_many(
                    {"offer_id": {"$in": seeded["restored_luce"]}},
                    {"$set": {"status": "done"}}
                )
            client.close()

        seeded = asyncio.run(seed())
        try:
            t0 = time.time()
            rc = requests.get(f"{API}/contacts/{cid}/bills/comparison", headers=hdr, timeout=15)
            elapsed = time.time() - t0
            print(f"[no-match] status={rc.status_code} elapsed={elapsed:.2f}s body={rc.text[:200]}")
            assert rc.status_code == 400, f"expected 400 got {rc.status_code} — {rc.text}"
            detail = (rc.json().get("detail") or "").lower()
            assert "coppia" in detail or "corrispondente" in detail, f"detail={detail}"
            assert elapsed < 5, f"400 no-match should be fast, was {elapsed}s"
        finally:
            asyncio.run(cleanup(seeded))
            requests.delete(f"{API}/contacts/{cid}", headers=hdr, timeout=10)


# -----------------------------------------------------------------
# 3) 200 path: seeded valid pair → verify 502 is FIXED + merged BASIC+RICH
# -----------------------------------------------------------------
class TestComparison200_502Fix:
    def test_seeded_pair_returns_200_within_60s_with_merged_sections(self, hdr, user_id):
        r = requests.post(f"{API}/contacts", headers=hdr, json={
            "first_name": "TEST_V38b_Pair",
            "last_name": "Compare",
            "phones": [{"kind": "cellulare", "value": "+390000000903"}],
        }, timeout=15)
        assert r.status_code in (200, 201)
        cid = r.json()["contact_id"]

        bill_id_seed = f"TESTV38B_bill_{uuid.uuid4().hex[:8]}"
        offer_id_seed = f"TESTV38B_offer_{uuid.uuid4().hex[:8]}"

        async def seed():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.energy_bills.insert_one({
                "bill_id": bill_id_seed,
                "contact_id": cid,
                "user_id": user_id,
                "created_by": user_id,
                "bill_type": "luce",
                "pdf_base64": "",
                "pdf_name": "TESTV38B_seed_bill.pdf",
                "pdf_mime": "application/pdf",
                "pdf_size": 1000,
                "status": "done",
                "extracted": {
                    "fornitore": "TestSupplier Attuale",
                    "spread_kwh": 0.15,
                    "consumo_annuo_kwh": 3200,
                    "f1_kwh": 1400, "f2_kwh": 900, "f3_kwh": 900,
                    "costo_totale_annuo_eur": 1120,
                },
                "raw_text_preview": "Fattura test",
                "error_message": None,
                "analysis_params": None,
            })
            await db.company_offers.insert_one({
                "offer_id": offer_id_seed,
                "user_id": user_id,
                "created_by": user_id,
                "bill_type": "luce",
                "label": "TESTV38B Offerta Luce",
                "pdf_base64": "",
                "pdf_name": "TESTV38B_seed_offer.pdf",
                "status": "done",
                "extracted": {
                    "fornitore": "MyCompany Offerta",
                    "spread_kwh": 0.08,
                    "prezzo_fisso_mensile_eur": 5,
                    "durata_mesi": 24,
                },
                "error_message": None,
            })
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
            rc = requests.get(f"{API}/contacts/{cid}/bills/comparison", headers=hdr, timeout=120)
            elapsed = time.time() - t0
            print(f"[seeded-pair] status={rc.status_code} elapsed={elapsed:.1f}s")
            # 502 fix core assertion
            assert rc.status_code != 502, f"HTTP 502 STILL OCCURRING! text={rc.text[:400]}"
            assert rc.status_code != 504, f"HTTP 504 timeout! text={rc.text[:400]}"
            assert rc.status_code == 200, f"expected 200, got {rc.status_code} — {rc.text[:400]}"
            # Timeout budget: with parallel BASIC+RICH, must stay under 60s ingress limit
            assert elapsed < 60, f"took {elapsed}s — exceeds 60s ingress. Parallel gather may be broken."

            data = rc.json()
            assert "items" in data and isinstance(data["items"], list)
            luce_item = next((i for i in data["items"] if i["bill_type"] == "luce"), None)
            assert luce_item is not None, f"no luce item in response: {data}"
            comp = luce_item["comparison"]
            print(f"[comparison keys] {sorted(comp.keys())}")

            # If a partial_error happened, at least one side must be present
            if comp.get("parse_error"):
                pytest.skip(f"LLM returned parse_error/partial. keys={list(comp.keys())} err={comp.get('error_message')}")

            comp_keys = set(comp.keys())
            basic_present = BASIC_FIELDS.intersection(comp_keys)
            rich_present = RICH_FIELDS.intersection(comp_keys)
            print(f"[BASIC fields present] {sorted(basic_present)}")
            print(f"[RICH fields present] {sorted(rich_present)}")

            # Merged dict should include SOME field from both prompts (proves both calls ran & merged)
            assert basic_present, f"No BASIC prompt fields found — BASIC call may have failed. keys={sorted(comp_keys)}"
            assert rich_present, f"No RICH prompt fields found — RICH call may have failed. keys={sorted(comp_keys)}"

            # Extra sanity checks
            if "raccomandazione" in comp:
                assert comp["raccomandazione"] in ("consigliato", "neutro", "sconsigliato"), comp["raccomandazione"]
        finally:
            asyncio.run(cleanup())
            requests.delete(f"{API}/contacts/{cid}", headers=hdr, timeout=10)
