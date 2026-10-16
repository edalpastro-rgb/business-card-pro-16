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
