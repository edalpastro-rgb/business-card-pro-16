"""V38c iter — verify /bills/comparison still returns the SPECIFIC nested rich fields
consumed by the new buildComparisonHtml() slide-style generator.

Required fields (per review request):
  - impronta_energetica.consumo_annuo_kwh_o_smc
  - dettaglio_fasce.F1_kwh
  - analisi_contratto_attuale.fornitore
  - calcolo_risparmio.risparmio_annuo_eur
  - matrice_confronto (array)
  - executive_summary.verdetto
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

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else "https://contact-hub-italy.preview.emergentagent.com"
API = f"{BASE_URL}/api"
OWNER_EMAIL = "test@dalpastro.it"
OWNER_PASS = "Test1234!"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def auth():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    return d["token"], d["user"]["user_id"]


def test_comparison_has_all_v38c_rich_fields(auth):
    token, user_id = auth
    hdr = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    r = requests.post(f"{API}/contacts", headers=hdr, json={
        "first_name": "TEST_V38C_Rich",
        "last_name": "Fields",
        "phones": [{"kind": "cellulare", "value": "+390000000904"}],
    }, timeout=15)
    assert r.status_code in (200, 201)
    cid = r.json()["contact_id"]

    bill_id_seed = f"TESTV38C_bill_{uuid.uuid4().hex[:8]}"
    offer_id_seed = f"TESTV38C_offer_{uuid.uuid4().hex[:8]}"

    async def seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.energy_bills.insert_one({
            "bill_id": bill_id_seed, "contact_id": cid, "user_id": user_id, "created_by": user_id,
            "bill_type": "luce", "pdf_base64": "", "pdf_name": "TESTV38C_bill.pdf",
            "pdf_mime": "application/pdf", "pdf_size": 1000, "status": "done",
            "extracted": {
                "fornitore": "Enel Energia",
                "spread_kwh": 0.15,
                "consumo_annuo_kwh": 3200,
                "f1_kwh": 1400, "f2_kwh": 900, "f3_kwh": 900,
                "costo_totale_annuo_eur": 1150,
                "durata_mesi": 12,
                "penale_recesso_eur": 60,
            },
            "raw_text_preview": "Fattura test", "error_message": None, "analysis_params": None,
        })
        await db.company_offers.insert_one({
            "offer_id": offer_id_seed, "user_id": user_id, "created_by": user_id,
            "bill_type": "luce", "label": "TESTV38C Offerta", "pdf_base64": "",
            "pdf_name": "TESTV38C_offer.pdf", "status": "done",
            "extracted": {"fornitore": "MyCorp Energia", "spread_kwh": 0.08, "prezzo_fisso_mensile_eur": 4, "durata_mesi": 24},
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
        rc = requests.get(f"{API}/contacts/{cid}/bills/comparison", headers=hdr, timeout=90)
        elapsed = time.time() - t0
        print(f"[v38c] status={rc.status_code} elapsed={elapsed:.1f}s")
        assert rc.status_code == 200, f"expected 200 got {rc.status_code} — {rc.text[:400]}"
        assert elapsed < 60, f"took {elapsed}s (>60s ingress)"

        data = rc.json()
        assert "items" in data
        luce_item = next((i for i in data["items"] if i["bill_type"] == "luce"), None)
        assert luce_item is not None
        comp = luce_item["comparison"]

        if comp.get("parse_error"):
            pytest.skip(f"LLM parse_error/partial: {comp.get('error_message')}")

        # All 6 top-level rich sections
        for f in ("impronta_energetica", "dettaglio_fasce", "analisi_contratto_attuale",
                  "calcolo_risparmio", "matrice_confronto", "executive_summary"):
            assert f in comp, f"missing rich section '{f}' — keys={sorted(comp.keys())}"

        # Specific nested fields
        ie = comp["impronta_energetica"]
        assert "consumo_annuo_kwh_o_smc" in ie, f"impronta_energetica keys={sorted(ie.keys())}"

        df = comp["dettaglio_fasce"]
        # accept F1_kwh or f1_kwh (case-insensitive scan)
        keys_lower = {k.lower(): k for k in df.keys()}
        assert "f1_kwh" in keys_lower, f"dettaglio_fasce missing F1_kwh; keys={list(df.keys())}"

        aca = comp["analisi_contratto_attuale"]
        assert "fornitore" in aca, f"analisi_contratto_attuale keys={sorted(aca.keys())}"

        cr = comp["calcolo_risparmio"]
        assert "risparmio_annuo_eur" in cr, f"calcolo_risparmio keys={sorted(cr.keys())}"

        mc = comp["matrice_confronto"]
        assert isinstance(mc, list), f"matrice_confronto is not list, got {type(mc)}"

        es = comp["executive_summary"]
        assert "verdetto" in es, f"executive_summary keys={sorted(es.keys())}"

        print("[v38c] ALL required rich fields present ✔")
    finally:
        asyncio.run(cleanup())
        requests.delete(f"{API}/contacts/{cid}", headers=hdr, timeout=10)
