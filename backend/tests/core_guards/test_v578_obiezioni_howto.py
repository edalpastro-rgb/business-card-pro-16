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
