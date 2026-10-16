"""tests/core_guards/test_super_impresa_table.py — V50.z569 — CERTIFICAZIONE LOCALE sul PDF reale «Super Impresa Suite 1026.pdf»:
il parser tabelle deve restituire ESATTAMENTE «DA 150.000 A 300.000 kWh | PUN + 0,01 €/kWh» e il retrieval deve consegnare al prompt
il chunk che la contiene per la domanda «qual è lo spread per fascia 150-300k kWh?»."""
import os
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(HERE, "workers"))
FIX = os.path.join(HERE, "tests", "perf", "fixtures", "super_impresa_suite_1026.pdf")
ROW = "DA 150.000 A 300.000 kWh | PUN + 0,01 €/kWh"
QUESTION = "qual è lo spread per fascia 150-300k kWh?"

pytestmark = pytest.mark.skipif(not os.path.exists(FIX), reason="fixture PDF assente")


def test_structured_parser_extracts_exact_table_row():
    import heavy_ops
    data = open(FIX, "rb").read()
    new = heavy_ops.pdf_structured_text(data)
    assert new["tables"] >= 1 and new["page_count"] == 35
    assert ROW in new["text"], "riga della tabella spread NON estratta come testo strutturato"
    old = heavy_ops.pdf_text(data, max_pages=30, max_chars=8000)["text"]
    assert ROW not in old, "(controllo di regressione: il parser vecchio non la estraeva come riga unica)"


def test_retrieval_delivers_chunk_with_exact_row():
    import chromadb
    import heavy_ops
    from core import drive_retrieval, embedding
    emb = embedding.LocalEmbedder(embedding.default_model_dir())
    if not emb.available:
        pytest.skip("MiniLM assente")
    drive_retrieval.configure(emb.embed, client=chromadb.EphemeralClient())
    text = heavy_ops.pdf_structured_text(open(FIX, "rb").read())["text"]
    assert drive_retrieval.upsert_file("cert", "sis", "Super Impresa Suite 1026.pdf", "CORPORATE CLUB", text, "2026-10-01") > 0
    res = drive_retrieval.search("cert", QUESTION, 4)
    assert res and res[0]["name"] == "Super Impresa Suite 1026.pdf"
    chunks = res[0]["chunks"]
    assert any(ROW in c for c in chunks), "nessuno dei chunk pertinenti contiene la riga esatta → il prompt non la vedrebbe"


# ───────── V50.z573 — FASCE ENERGETICHE: «400.000 kWh» deve agganciare «DA 300.000 A 600.000 kWh | PUN + 0,008 €/kWh» ─────────
ROW_400K = "DA 300.000 A 600.000 kWh | PUN + 0,008 €/kWh"


@pytest.mark.parametrize("msg,expected", [
    ("spread per cliente 400.000 kWh", 400000), ("un cliente che consuma 400000 kwh", 400000), ("450 MWh annui", 450000),
    ("0,4 GWh l'anno", 400000), ("impianto da 50 kW", None), ("quanti appuntamenti ho domani?", None), ("spread fascia 150-300k kWh", None),
])
def test_consumption_detection_in_query(msg, expected):
    from core import drive_retrieval
    assert drive_retrieval.consumption_kwh_in_query(msg) == expected


def test_range_rows_math_match_on_real_pdf():
    import heavy_ops
    from core import drive_retrieval
    text = heavy_ops.pdf_structured_text(open(FIX, "rb").read())["text"]
    rows = drive_retrieval.range_rows_for_value(text, 400000)
    assert rows and all(ROW_400K in r for r in rows), rows
    assert all(r.startswith("[pag.") for r in rows), "ogni riga deve portare la pagina di provenienza"
    assert any(ROW in r for r in drive_retrieval.range_rows_for_value(text, 150000))   # estremo incluso
    assert any("superiori a 600.000 kWh" in r for r in drive_retrieval.range_rows_for_value(text, 2_000_000))  # fascia aperta
    assert drive_retrieval.range_rows_for_value(text, 10000) == []


def test_system_rule_fasce_energetiche_in_market_block():
    """La regola tassativa richiesta dall'utente deve stare nel blocco DATI DI MERCATO (e quindi nel blocco statico cacheabile)."""
    import re
    src = open(os.path.join(HERE, "routes", "axon_core.py"), encoding="utf-8").read()
    assert "REGOLA FASCE ENERGETICHE" in src
    assert "non cercare la corrispondenza testuale esatta" in src and "Verifica matematicamente in quale fascia" in src
    assert re.search(r"if market:.*REGOLA FASCE ENERGETICHE", src, re.S), "deve stare nel blocco `market`"
    w = open(os.path.join(HERE, "routes", "20_axon_memory.py"), encoding="utf-8").read()
    assert "FASCIA CORRISPONDENTE AL CONSUMO INDICATO" in w and "_core_drive_range_rows(txt, _kwh_q)" in w
