"""tests/core_guards — tag 2026-10-19 (lucchetto) — lookup listino = RAG BLOCCATO COMPLETAMENTE.
Con un consumo kWh che colpisce una regola `listino_rules`: nessun fetcher (Drive/ChromaDB/embedding/KB/RAG/web/memorie),
prompt = identità statica + ora + blocco lookup; i wrapper axon_*.py non possono aggiungere contesto (ripristino in 22 e non-stream)."""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _src(name):
    return open(os.path.join(HERE, "routes", name), encoding="utf-8").read()


def _func(src, name):
    i = src.index(f"async def {name}(")
    j = src.find("\nasync def ", i + 10)
    j2 = src.find("\n@api_router", i + 10)
    ends = [x for x in (j, j2) if x > 0]
    return src[i:min(ends) if ends else len(src)]


def test_lock_runs_before_every_fetcher_and_returns_minimal_prompt():
    s = _src("21_axon_streaming.py")
    f = _func(s, "_prepare_assistant_prompt")
    lock = f.index("_lk_kwh, _lk_hits = await _listino_rule_hits(msg)")
    for fetcher in ("_axon_query_class(msg", "_build_assistant_context(user)", "_retrieve_master_doc_chunks(", "_load_neo_memories(",
                    "_build_axon_teach_section(", "_core_ctx_get(\"tavily\"", "_build_kb_section(", "_build_personal_kb_section(",
                    "_build_crm_omniscience_section(", "_build_pinned_rules_section(", "assistant_feedback.find(", "_load_axon_brain(",
                    "_load_scripts_index(", "_cheatsheet_section_for_prompt(", "asyncio.gather("):
        assert f.index(fetcher) > lock, f"il lucchetto deve precedere {fetcher}"
    blk = f[f.rindex("if not body.attachments:", 0, lock):f.index("# V50.b — PARALLELIZE", lock)]
    assert "return {" in blk and '"query_class": "listino"' in blk and '"listino_lock": _lk_sm' in blk and '"has_rag_context": False' in blk
    assert "_axon_static_block(user, assistant_name, assistant_language)" in blk and "_listino_lock_section(_lk_kwh, _lk_hits)" in blk
    assert blk.startswith("if not body.attachments:"), "con allegati (bolletta da analizzare) il lucchetto non scatta"
    assert "_core_drive_search" not in blk and "chroma" not in blk.lower() and "drive_snapshots" not in blk


def test_lock_is_restored_after_wrappers_in_stream_and_non_stream():
    s22 = _src("22_axon_alarm_commit_teach.py")
    i = s22.index('msg = prep["msg"]')
    assert 'prep["system_message"] = prep["listino_lock"]' in s22[i:i + 400]
    assert i < s22.index("_make_chat()") and i < s22.index("_pick_axon_model(")
    assert 'prep.get("query_class") in ("simple", "listino")' in s22
    s21 = _src("21_axon_streaming.py")
    assert 'system_message = prep.get("listino_lock") or prep["system_message"]' in s21


def test_lock_section_content_and_rules_helper():
    w = _src("20_axon_memory.py")
    assert "async def _listino_rule_hits(" in w and "def _listino_lock_section(" in w and "def _listino_rule_lines(" in w
    h = w[w.index("async def _listino_rule_hits("):w.index("def _listino_rule_lines(")]
    assert "db.axon_config.find_one" in h and "_LISTINO_RULES_DEFAULT" in h
    assert "_core_drive_search" not in h and "drive_snapshots" not in h, "il lookup non tocca Drive/ChromaDB"
    sec = w[w.index("def _listino_lock_section("):w.index("async def _fetch_teach_drive_pdfs_for_query(")]
    for must in ("LOOKUP LISTINO — RISPOSTA FINALE DEL SISTEMA", "FASCIA RISOLTA (REGOLA LISTINO)", "NON MODIFICABILE",
                 "«non trovo»", "ricaricare/riallegare il PDF", "Materia Prima (spread)", "oneri variabili"):
        assert must in sec, must
    # il builder delle righe espone anche gli oneri e non calcola nulla
    import types
    ns = {"_core_drive_format_kwh": lambda v: f"{int(v):,}".replace(",", ".") + " kWh", "List": list}
    exec(w[w.index("def _listino_rule_lines("):w.index("def _listino_lock_section(")], ns)
    rules = eval(w[w.index("_LISTINO_RULES_DEFAULT = ["):w.index("]\n", w.index("_LISTINO_RULES_DEFAULT = [")) + 1].split("= ", 1)[1])
    lines = ns["_listino_rule_lines"]([r for r in rules if r["min"] <= 418000 <= r["max"]])
    assert len(lines) == 1 and "PUN + 0,008 €/kWh" in lines[0] and "Oneri variabili 0,0044 €/kWh" in lines[0] and "pag. 6" in lines[0]
    lines9 = ns["_listino_rule_lines"]([r for r in rules if r["min"] <= 9000 <= r["max"]])
    assert "Super Impresa Smart" in lines9[0] and "0,025" in lines9[0] and "Fisso 17,90 €/mese" in lines9[0] and "pag. 31" in lines9[0] and "Oneri" not in lines9[0]
    assert isinstance(ns["_listino_rule_lines"], types.FunctionType)


def test_kwh_queries_never_hit_semantic_cache():
    s = _src("21_axon_streaming.py")
    f = _func(s, "_semantic_cache_lookup")  # solo per avere il contesto del file; la regola è in _is_query_cacheable
    assert f
    i = s.index("def _is_query_cacheable(")
    assert re.search(r"if _core_drive_kwh_in_query\(msg\).*\n\s+return False", s[i:i + 1500])
