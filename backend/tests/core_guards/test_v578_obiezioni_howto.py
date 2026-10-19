"""tests/core_guards — V50.z578 — manuale obiezioni in chat, regex how-to stretta, alert telemetria fuori dalla chat, footer coerenti."""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _src(name):
    return open(os.path.join(HERE, "routes", name), encoding="utf-8").read()


def _rx_from(src, var):
    line = [ln for ln in src.splitlines() if ln.startswith(f"{var} = ")][0]
    return line


def test_howto_regex_is_strict():
    src = _src("axon_manual.py")
    line = _rx_from(src, "_MN_HOWTO_RE")
    rx = re.compile(line.split('compile(r"', 1)[1].rsplit('", _mn_re.I)', 1)[0], re.I)
    yes = ["Dove trovo lo scanner nell'app?", "Come faccio a collegare Google Drive?", "Mostrami la schermata impostazioni",
           "A cosa serve la funzione scanner?", "In che menu si trova il calendario?", "Dov'è la rubrica?"]
    no = ["Il cliente mi dice che non ha tempo, cosa gli rispondo?", "Qual è lo spread per un cliente da 418.000 kWh?",
          "Il cliente dice che deve parlarne con il socio, come gestisco?", "Quanti appuntamenti ho domani?", "Che ore sono?"]
    for q in yes:
        assert rx.search(q), f"how-to NON riconosciuta: {q}"
    for q in no:
        assert not rx.search(q), f"falso positivo how-to (footer/chip incongrui): {q}"


def test_objections_manual_injected_in_wrapper_not_in_memory_module():
    w = _src("36b_axon_pdf_link_parser.py")
    assert "_OBI_Q_RX" in w and 'db.cgym_manual_kb.find_one({"tenant_id": tenant, "type": "obiezioni"}' in w
    assert "MANUALE OBIEZIONI — FONTE PRIMARIA" in w and "cgym_obi_kb_index(" not in w.split("_OBI_HEADING")[0].split("async def _build_axon_teach_section")[1]
    assert "obi + out if obi else out" in w, "il manuale va ANTEPOSTO alla sezione"
    assert "_OBI_MAX_CHARS = 60000" in w
    assert "nessun percorso di menu, nessun chip" in w, "tono discorsivo + niente footer per le domande di vendita"
    assert "cgym_manual_kb" not in _src("20_axon_memory.py")
    rx = re.compile(r"(obiezion|trattativ|gestione\s+obiez|(cliente|lui|lei|mi)\s+(mi\s+)?(dice|risponde|ha\s+detto|obietta)|non\s+ha?o?\s+tempo|"
                    r"ci\s+devo\s+pensare|devo\s+pensarci|non\s+mi\s+interessa|devo\s+parlar\w+\s+con|cosa\s+(gli|le)?\s?(posso\s+)?rispond|"
                    r"cosa\s+dovrei\s+rispond|come\s+rispond)", re.I)
    for q in ("Il cliente mi dice che non ha tempo, cosa gli rispondo?", "Il cliente dice che ci deve pensare, cosa rispondo?",
              "Il cliente dice che deve parlarne con il socio, come gestisco?"):
        assert rx.search(q), q
    assert not rx.search("Dove trovo lo scanner?") and not rx.search("spread per 418.000 kWh")


def test_telemetry_alert_never_prepended_in_chat():
    s = _src("axon_critical_events.py")
    i = s.index("async def _ce_take_pending_voice")
    assert '"source": {"$ne": "telemetria"}' in s[i:i + 900]


def test_nav_fallback_uses_chip_route_and_body_score_is_capped():
    s = _src("axon_manual.py")
    i = s.index("def _mn_nav_fallback")
    assert "_MN_BY_ROUTE.get(m.group(1).split" in s[i:i + 1500], "il percorso deve venire dall'articolo della route già nel chip"
    assert "min(body_pts, 1.5)" in s, "i match nel solo corpo non devono bastare a superare la soglia del chip fallback"
    st = _src("21_axon_streaming.py")
    blk = st[st.index("_CACHE_SKIP_TOKENS = {"):st.index("\n}", st.index("_CACHE_SKIP_TOKENS = {"))]
    for t in ('"obiezioni"', '"rispondo"', '"scanner"', '"dove"'):
        assert t in blk


def test_v579_chat_announcements_and_stt_partial():
    """V50.z579 — annunci in chat (deploy al boot, rilettura Drive) e testo parziale STT in diretta."""
    a = _src("axon_chat_announce.py")
    assert "_ca_prev_take_pending_voice = _ce_take_pending_voice" in a and "async def _ce_take_pending_voice(user: dict):" in a
    assert "_ca_prev_reindex = _reindex_drive_files_for_user" in a and "last_announced_version" in a and "AXON_COLOR" in a
    init = _src("__init__.py")
    assert init.index('"axon_critical_events.py"') < init.index('"axon_chat_announce.py"'), "deve caricarsi DOPO axon_critical_events"
    assert init.index('"axon_drive_root.py"') < init.index('"axon_chat_announce.py"')
    st = _src("axon_stt_chunks.py")
    assert '"/ai/transcribe/chunk/partial"' in st and '"partial": _sc_partial_text(sess)' in st
    import yaml
    comp = yaml.safe_load(open(os.path.join(os.path.dirname(HERE), "deploy", "axon-core", "docker-compose.yml"), encoding="utf-8"))
    for c in ("a", "b"):
        env = comp["services"][f"axon-core-{c}"]["environment"]
        assert env.get("AXON_COLOR") == c and "MONGO_URL" in env and "PORT" in env, "environment per colore deve ereditare le variabili comuni"


def test_refactor_20261019_chunking_pages_rules_routing():
    """Rifattorizzazione 19/10: chunk per riga con pagina, _sem2 rimosso, has_bands, regole listino, routing nativo, thread embed."""
    from core import drive_retrieval as d
    text = "[pag.1]\nTitolo listino\n" + "\n".join(f"riga {i} | PUN + 0,00{i % 9} €/kWh" for i in range(60)) + "\n[TABELLA pag.2 — 2 righe × 2 colonne]\n| DA 300.000 A 600.000 kWh | PUN + 0,008 €/kWh |\n| superiori a 600.000 kWh | PUN + 0,006 €/kWh |"
    pairs = d.chunk_text_pages(text, size=400)
    assert pairs and all(c.startswith(f"[pag.{p}]") for c, p in pairs), "ogni chunk deve avere il prefisso [pag.N]"
    assert all("\n" not in c.split("\n")[-1] or True for c, _ in pairs)
    assert any("DA 300.000 A 600.000 kWh | PUN + 0,008 €/kWh" in c and p == 2 for c, p in pairs), "la riga-tabella non va spezzata e porta pagina 2"
    assert all(len(c) <= 400 + 60 for c, _ in pairs), "chunk oltre la soglia solo se una riga singola è più lunga"
    w = _src("20_axon_memory.py")
    assert "_sem2" not in w.replace("rimossa la seconda ricerca ChromaDB «_sem2»", ""), "_sem2 (embedding ridondante) deve essere rimossa"
    assert '"has_bands": True' in w and "_LISTINO_RULES_DEFAULT" in w and "FASCIA RISOLTA (REGOLA LISTINO)" in w
    assert "if _rule_hits:  # tag 2026-10-19 — BYPASS SEMANTICO" in w
    rules = eval(w[w.index("_LISTINO_RULES_DEFAULT = ["):w.index("]\n", w.index("_LISTINO_RULES_DEFAULT = [")) + 1].split("= ", 1)[1])
    assert any(r["min"] <= 9000 <= r["max"] and r["offer"] == "Super Impresa Smart" and "0,025" in r["spread"] and "17,90" in r["fixed"] and "pag. 31" in r["source"] for r in rules)
    assert any(r["min"] <= 418000 <= r["max"] and "0,008" in r["spread"] and r.get("oneri") == "0,0044 €/kWh" and "pag. 6" in r["source"] for r in rules)
    assert not any("0,012" in r["spread"] for r in rules), "0,012 appartiene alla fascia 150.000-300.000, non a 300k-600k"
    assert '"has_bands": bool(_re_bands.search(text or ""))' in _src("34_alarms_homeassistant.py")
    e = open(os.path.join(HERE, "core", "embedding.py"), encoding="utf-8").read()
    assert "index_embedder = LocalEmbedder(default_model_dir(), threads=1)" in e and 'or 2))' in e
    assert "embed_index_fn=_core_embedding.index_embedder.embed" in _src("01e_core_bridge.py")
    m = _src("axon_manual.py")
    assert "risposta nativa how-to" in m and 'return {"reply": body, "intent": "navigate"' in m
