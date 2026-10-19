"""tests/core_guards — tag 2026-10-19 (maps) — NAVIGAZIONE VERSO UN LUOGO = link esterni Google Maps / Waze (marker [[LINK:url|label]]),
MAI [[NAV:/optimal-route…]] (pagina interna «Giro Ottimale») salvo richiesta esplicita di Giro Ottimale / Axon Drive."""
import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.dirname(HERE)


def _src(rel):
    return open(os.path.join(ROOT, rel), encoding="utf-8").read()


def _nav_ns():
    """Esegue solo la parte «pura» di axon_navigator (helper link + regex) in un namespace isolato."""
    import types
    s = _src("backend/routes/axon_navigator.py")
    seg = s[s.index("_NAV_MARK = "):s.index("# ---------------------------------------------------------------------------\n# PARTE 1")]
    ns = {"_nav_re": re}
    exec(seg, ns)
    rx = s[s.index("_RX_GOTO = "):s.index("_RX_MISSED = ")]
    exec(rx, ns)
    assert isinstance(ns["_maps_links"], types.FunctionType)
    return ns


def test_maps_links_exact_format_and_url_encoding():
    ns = _nav_ns()
    out = ns["_maps_links"]("Via Roma 12, Vicenza")
    lines = out.split("\n")
    assert lines[0] == "[[LINK:https://www.google.com/maps/search/?q=Via%20Roma%2012%2C%20Vicenza|🗺️ Apri in Google Maps]]"
    assert lines[1] == "[[LINK:https://waze.com/ul?q=Via%20Roma%2012%2C%20Vicenza|🚘 Apri in Waze]]"
    assert "optimal-route" not in out and "[[NAV:" not in out


def test_place_regex_vs_explicit_giro():
    ns = _nav_ns()
    go, giro = ns["_RX_GO_PLACE"], ns["_RX_GIRO_EXPLICIT"]
    for q in ("portami da Rossi", "naviga verso Via Roma 12 Vicenza", "indicazioni per la farmacia", "devo andare da Bianchi", "portami in farmacia",
              "come arrivo da Zanini", "cerca una farmacia aperta e portami lì"):
        assert go.search(q) and not giro.search(q), q
    for q in ("apri il giro ottimale", "fammi il giro dei clienti di Treviso", "apri Axon Drive", "qual è l'itinerario più corto"):
        assert giro.search(q), q
    assert not go.search("portami nelle impostazioni"), "schermata dell'app, non un luogo"
    strong = ns["_RX_PLACE_STRONG"]
    for q in ("portami in farmacia", "naviga verso Via Roma 12 Vicenza", "indicazioni per l'ospedale", "come arrivo alla stazione"):
        assert strong.search(q), q
    for q in ("portami nelle impostazioni", "portami da Rossi", "apri il calendario"):
        assert not strong.search(q), q


def test_go_contact_regex_captures_name():
    ns = _nav_ns()
    rx = ns["_RX_GO_CONTACT"]
    for q, name in (("Portami da Rossi", "Rossi"), ("naviga verso Mario Bianchi", "Mario Bianchi"), ("indicazioni per Zanini", "Zanini"),
                    ("devo andare da Anna Rossi, che tempo fa?", "Anna Rossi"), ("come arrivo da Zanini?", "Zanini")):
        m = rx.match(q)
        assert m and m.group("name").strip() == name, (q, m and m.group("name"))
    assert not rx.match("portami in farmacia")  # luogo generico → AI con sezione maps


def test_goto_flow_and_intercept_use_maps_links_not_optimal_route():
    s = _src("backend/routes/axon_navigator.py")
    f = s[s.index("async def _nav_flow_goto("):s.index("async def _nav_missed_today(")]
    assert "optimal-route" not in f, "la navigazione verso un cliente non apre più Giro Ottimale"
    assert "_maps_links(addr)" in f and "_best_addr_for_contact(c)" in f and "Completa l'indirizzo" in f
    i = s.index("async def _nav_intercept(")
    body = s[i:s.index('if _nav_intent(t) != "navigate":', i)]
    assert "_RX_GO_CONTACT.match(t)" in body and "_nav_contact_strict(user, nm)" in body and "not _RX_GIRO_EXPLICIT.search(t)" in body
    assert "if _RX_PLACE_STRONG.search(t) and not _RX_GIRO_EXPLICIT.search(t):\n            return None" in body, "luogo fisico → mai template «Apri X»"
    p = s[s.index("async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811"):]
    assert "if not lite and _RX_GO_PLACE.search(msg) and not _RX_GIRO_EXPLICIT.search(msg):" in p and "section += _NAV_MAPS_SECTION" in p
    assert "navigazione_cliente" not in s, "voce APP_MAP /optimal-route?contacts={id} rimossa"
    assert "VIETATO il marker [[NAV:/optimal-route" in s
    g = _src("backend/routes/axon_nav_guard.py")
    assert "[[NAV:/optimal-route?contacts=<contact_id>" not in g and "[[LINK:https://www.google.com/maps/search/?q=" in g and "[[LINK:https://waze.com/ul?q=" in g


def test_frontend_renders_link_chips_externally():
    chips = _src("frontend/src/NavChips.tsx")
    assert "LINK_RX = /\\[\\[LINK:(https?:\\/\\/[^|\\]\\s]+)\\|([^\\]]+)\\]\\]/g" in chips
    assert 'kind: "link"' in chips and 'c.kind === "link"' in chips and "onNavigate(c.url)" in chips
    assert '.replace(ACT_RX, "").replace(LINK_RX, "").replace(NAV_RX, "")' in chips
    chat = _src("frontend/src/AssistantChat.tsx")
    i = chat.index("const navigateTo = (route: string) => {")
    blk = chat[i:i + 1200]
    assert "/^https?:\\/\\//i.test(route)" in blk and "Linking.openURL(route)" in blk and 'window.open(route, "_blank", "noopener")' in blk
    assert blk.index("/^https?:") < blk.index("stopGeneration()"), "il link esterno non chiude la chat né interrompe lo stream"
    for rel in ("frontend/src/utils/sentenceSpeaker.ts", "frontend/src/axon-choice-buttons.tsx"):
        assert "(NAV|LINK|" in _src(rel), rel


def test_manual_and_stress_bank_updated():
    m = _src("backend/routes/axon_manual_data.py")
    assert "Navigazione con Axon: link diretti Google Maps / Waze" in m and "https://waze.com/ul?q=INDIRIZZO" in m and "https://www.google.com/maps/search/?q=INDIRIZZO" in m
    q = _src("backend/routes/axon_stress_questions.py")
    assert "/optimal-route?contacts=" not in q
    assert '("vaghe", "Devo andare da Anna Rossi", ["/contact/"], "flow")' in q
