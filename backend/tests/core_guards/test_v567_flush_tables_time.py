"""tests/core_guards/test_v567_flush_tables_time.py — V50.z567 — test BLOCCANTI: flush streaming token-per-token, parser tabelle, timestamp ancorato."""
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(HERE, "workers"))


def _src(rel):
    return open(os.path.join(HERE, rel), encoding="utf-8").read()


def test_stream_never_buffers_deltas():
    """Ogni delta LLM deve essere emesso subito: nessun `if not _bare:` davanti a yield sse("delta"), niente ri-emissione in blocco."""
    s = _src("routes/22_axon_alarm_commit_teach.py")
    assert "if not _bare:\n                                yield sse(\"delta\"" not in s
    assert 'yield sse("delta", {"text": _clean})' not in s, "il blocco «dato secco» non deve più riemettere tutto il testo alla fine"
    assert s.count('yield sse("delta", {"text": _piece})') == 1
    assert '" " * 2048' in s, "padding SSE iniziale per il flush degli header"
    assert '"X-Accel-Buffering": "no"' in s


def test_pdf_structured_text_keeps_table_numbers_on_rows():
    import pymupdf as fitz
    import heavy_ops
    doc = fitz.open(); page = doc.new_page()
    rows = [("Fascia consumo", "F1", "F2", "F3"), ("150.000-300.000 kWh", "0,121", "0,115", "0,104"), ("300.000-500.000 kWh", "0,117", "0,111", "0,099")]
    y = 100
    for r in rows:
        x = 50
        for c in r:
            page.insert_text((x, y), c, fontsize=9); x += 130
        y += 18
    for i in range(len(rows) + 1):
        page.draw_line((45, 86 + i * 18), (565, 86 + i * 18))
    for x in (45, 175, 305, 435, 565):
        page.draw_line((x, 86), (x, 86 + len(rows) * 18))
    page.insert_text((50, 200), "Spread 150-300k kWh: 0,0125 €/kWh", fontsize=9)
    r = heavy_ops.pdf_structured_text(doc.tobytes())
    assert r["tables"] >= 1 and r["digits"] > 40
    assert re.search(r"\| 150\.000-300\.000 kWh \| 0,121 \| 0,115 \| 0,104 \|", r["text"]), r["text"]
    assert "0,0125" in r["text"]
    assert "pdf_structured_text" in heavy_ops.OPS


def test_drive_download_uses_structured_parser_and_ocr_guard():
    s = _src("routes/axon_drive_root.py")
    assert 'heavy_call_sync("pdf_structured_text"' in s
    assert "_numbers_missing" in s and "DRIVE_PARSER_VERSION" in s
    assert "max_pages: int = _ADR_OCR_PAGES" in s


def test_no_heavy_drive_work_at_boot_and_low_priority_reindex():
    """V50.z568 — incidente 11:22: il reindex completo NON parte mai all'avvio; gira solo nel job notturno, un file alla volta con pausa,
    embedding a 1 thread, sottoprocessi nice(10), OCR Vision opzionale; riassunti automatici SPENTI di default."""
    adr = _src("routes/axon_drive_root.py")
    assert "_adr_reindex_on_parser_upgrade" not in adr and "@app.on_event(\"startup\")" not in adr
    assert "async def _run_drive_parser_upgrade_nightly" in adr and "_ADR_OCR_TABLES and" in adr
    sched = _src("routes/37_app_startup_scheduler.py")
    assert '_run_drive_parser_upgrade_nightly, "cron", hour=3' in sched
    assert 'await asyncio.sleep(float(os.environ.get("DRIVE_REINDEX_PAUSE_S") or 2.0))' in _src("routes/34_alarms_homeassistant.py")
    e = _src("core/embedding.py")  # tag 2026-10-19 — query live 2 thread, indicizzazione (reindex) istanza separata a 1 thread
    assert 'or 2))' in e and "index_embedder = LocalEmbedder(default_model_dir(), threads=1)" in e
    assert _src("routes/01b_heavy_bridge.py").count("preexec_fn=_hv_low_priority") == 2
    assert '@api_router.get("/google-drive/root-files")' in adr, "endpoint perso durante il refactor (già successo in z568)"
    idle = _src("routes/axon_idle_summary.py")
    assert 'AXON_IDLE_SUMMARY_ENABLED") or "0"' in idle


def test_timestamp_has_exact_weekday_in_rome():
    """venerdì 16/10/2026 09:55 — mai «giovedì»: giorno della settimana calcolato dal datetime in Europe/Rome."""
    ns = {}
    src = _src("routes/19_axon_assistant_core.py")
    fn = src[src.index("def _fmt_dt_it"):]
    fn = fn[:fn.index("\n\n\n")]
    exec("from typing import Optional\nfrom datetime import datetime, timezone\n" + fn, ns)
    out = ns["_fmt_dt_it"](datetime(2026, 10, 16, 7, 55, tzinfo=timezone.utc))
    assert out == "venerdì 16/10/2026 09:55", out
    assert ns["_fmt_dt_it"](datetime(2026, 10, 15, 23, 30, tzinfo=timezone.utc)).startswith("venerdì 16/10/2026 01:30")
    assert "giorno della settimana ESATTO" in _src("routes/21_axon_streaming.py")
