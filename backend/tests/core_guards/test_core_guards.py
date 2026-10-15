"""tests/core — V50.z562 — TEST BLOCCANTI DEL BUILD (build_package.sh li esegue PRIMA di creare il .tgz).
Nessun server necessario: importano direttamente il package protetto backend/core."""
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from core import response_rules as rr  # noqa: E402
from core import streaming  # noqa: E402
from core import drive_retrieval as dr  # noqa: E402
from core.embedding import embedder  # noqa: E402


# ───────────── Regole di risposta: parole chiave che NON devono far scattare download/web estranei ─────────────
@pytest.mark.parametrize("msg", [
    "Quanti appuntamenti ho domani?", "Sposta l'appuntamento con Rossi", "quanti appuntamenti questa settimana",
    "mostrami il cruscotto", "Quanti clienti ho in totale?", "che ore sono",
])
def test_gme_download_not_triggered_by_everyday_words(msg):
    assert rr.wants_gme_download(msg) is False, f"«{msg}» NON deve scaricare i PDF GME"
    assert rr.is_pun_like(msg) is False


@pytest.mark.parametrize("msg", ["tabella PUN di marzo", "prezzo medio F1 2025", "quanto costa in €/kWh", "pun monorario ottobre"])
def test_gme_download_triggered_by_real_energy_queries(msg):
    assert rr.wants_gme_download(msg) is True


@pytest.mark.parametrize("msg", ["Quanto fa 12 per 8?", "Traduci in inglese: buongiorno", "Converti 5 km in miglia", "Quanti giorni mancano a Natale?", "significato di resilienza"])
def test_no_web_search_for_self_contained_questions(msg):
    assert rr.llm_can_answer_without_web(msg) is True


@pytest.mark.parametrize("msg", ["Quanto costa oggi il gas?", "Traduci le ultime notizie di oggi", "prezzo attuale del PUN"])
def test_web_allowed_when_topicality_requested(msg):
    assert rr.llm_can_answer_without_web(msg) is False


def test_drive_doc_queries_detected():
    assert rr.is_drive_doc_query("Cosa c'è nel listino 01_POWER della cartella CORPORATE CLUB?")
    assert not rr.is_drive_doc_query("che ore sono")


# ───────────── Telemetria TTFT ─────────────
def test_ttft_stats_percentiles_and_anomaly():
    streaming._samples.clear()
    for v in [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 3.5]:
        streaming.record(v, 0.3, 20, v + 1.0, "crm")
    st = streaming.stats(60)
    assert st["n"] == 10 and st["p50"] <= 1.0 and st["p95"] >= 3.0
    assert st["anomalies"], "p95 > 2s deve produrre un'anomalia"
    streaming._samples.clear()
    for v in [0.5, 0.6, 0.7]:
        streaming.record(v, 0.2, 15, 1.5, "simple")
    assert streaming.stats(60)["ok"] is True


def test_sse_contract():
    assert streaming.sse("delta", '{"text":"ciao"}') == 'event: delta\ndata: {"text":"ciao"}\n\n'


# ───────────── Retrieval Drive semantico (ChromaDB in memoria + MiniLM reale se presente) ─────────────
def _bow_embed(texts):
    import hashlib
    import math
    out = []
    for t in texts:
        v = [0.0] * 256
        for w in t.lower().replace("_", " ").split():
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 256] += 1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        out.append([x / n for x in v])
    return out


@pytest.fixture()
def drive_index():
    import chromadb
    client = chromadb.EphemeralClient()
    dr.configure(embedder.embed if embedder.available else _bow_embed, client)
    yield client
    dr._client = None


POWER_TEXT = ("LISTINO 01_POWER — Offerta luce per aziende CORPORATE CLUB. Potenza impegnata da 15 kW a 100 kW, prezzo energia indicizzato "
              "PUN + spread 0,012 €/kWh, quota fissa 12 €/mese per POD, fasce F1 F2 F3, durata 12 mesi, nessun deposito cauzionale.")
GAS_TEXT = ("LISTINO GAS CASA — Offerta gas per clienti domestici: prezzo PSV + 0,09 €/Smc, quota fissa 8 €/mese per PDR, "
            "riscaldamento autonomo, bolletta mensile, attivazione gratuita.")
BOOK_TEXT = ("PRIMA STAMPA BOOK COMMERCIALE — presentazione dell'azienda, valori, team di consulenti, storia dal 2010, sedi di Vicenza e Padova, "
             "servizi di consulenza energetica e assicurativa.")


def test_semantic_search_finds_file_by_content(drive_index):
    t = "tenant_test"
    assert dr.upsert_file(t, "f1", "01_POWER.pdf", "CORPORATE CLUB", POWER_TEXT, "2026-06-01") >= 1
    assert dr.upsert_file(t, "f2", "02_GAS_CASA.pdf", "CORPORATE CLUB", GAS_TEXT, "2026-06-01") >= 1
    assert dr.upsert_file(t, "f3", "PRIMA STAMPA BOOK COMMERCIALE.pdf", "CORPORATE CLUB", BOOK_TEXT, "2026-06-01") >= 1
    assert dr.count(t) >= 3
    # 1) parola nel NOME
    res = dr.search(t, "cosa c'è nel listino 01_POWER?", k=3)
    assert res and res[0]["name"] == "01_POWER.pdf"
    # 2) parole SOLO nel CONTENUTO (nessuna nel nome): è il caso che prima falliva
    res = dr.search(t, "offerta luce aziende potenza impegnata kW spread energia", k=3)
    assert res and res[0]["name"] == "01_POWER.pdf", [r["name"] for r in res]
    res = dr.search(t, "quota fissa per PDR e prezzo PSV del gas domestico", k=3)
    assert res and res[0]["name"] == "02_GAS_CASA.pdf", [r["name"] for r in res]
    # 3) delete → sparisce
    dr.delete_file(t, "f1")
    assert all(r["name"] != "01_POWER.pdf" for r in dr.search(t, "listino 01_POWER potenza impegnata", k=3))


def test_semantic_search_is_tenant_isolated(drive_index):
    dr.upsert_file("tenant_a", "fa", "01_POWER.pdf", "CORPORATE CLUB", POWER_TEXT)
    assert dr.search("tenant_b", "listino 01_POWER", k=3) == []


def test_chunking_keeps_overlap():
    chunks = dr.chunk_text("x" * 2000)
    assert len(chunks) == 3 and all(len(c) <= dr.CHUNK_CHARS for c in chunks)
