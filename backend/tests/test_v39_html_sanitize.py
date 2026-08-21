"""V39 — Verify that _build_analysis_html sanitizes AI-produced HTML tags.

The AI sometimes returns strings with raw <br>, <p>, <li> tags. If the code
escapes them naively they leak into the rendered analysis as visible text
(e.g. "&lt;br&gt;"). The fix introduces a local `_sanitize_ai(text)` helper
inside `_build_analysis_html` (backend) and mirrored `sanitizeAi`/
`sanitizeAiText` helpers on the frontend.

This suite exercises the backend rendering path with representative payloads
and verifies that the produced HTML:
  1. Does NOT contain visible tags encoded as HTML entities (e.g. &lt;br&gt;)
  2. Does NOT execute scripts (the <script> tag is stripped, not embedded)
  3. Preserves the actual textual content of the extracted fields
  4. Decodes basic HTML entities (&nbsp; → space, etc.)
  5. Handles empty / None / edge-case inputs without crashing
"""
import os
import sys
import pytest

# Ensure the backend package importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from server import _build_analysis_html  # noqa: E402


# Common defaults used by _build_analysis_html
DEFAULTS = dict(bt_label="Luce", bt_color="#EA580C", doc_base="test", params=[])


# ---------------------- Core sanitiser expectations ----------------------

class TestSanitizeCore:
    """The rendered HTML must never contain visible/escaped AI-tag artefacts."""

    def test_br_tag_is_stripped_in_fornitore(self):
        html = _build_analysis_html(
            {"fornitore": "Enel<br>Energia"}, **DEFAULTS
        )
        assert "&lt;br&gt;" not in html
        assert "&lt;br/&gt;" not in html
        # The literal characters "Enel" and "Energia" survive
        assert "Enel" in html
        assert "Energia" in html

    def test_paragraph_tags_stripped_from_offerta(self):
        html = _build_analysis_html(
            {"nome_offerta": "<p>Intro</p><p>Fine</p>"}, **DEFAULTS
        )
        assert "&lt;p&gt;" not in html
        assert "&lt;/p&gt;" not in html
        assert "Intro" in html
        assert "Fine" in html

    def test_script_tag_stripped_no_xss(self):
        payload = {"fornitore": "Test<script>alert(1)</script>fine"}
        html = _build_analysis_html(payload, **DEFAULTS)
        # No live <script> tag injected in the output (XSS-safe)
        assert "<script" not in html
        assert "</script>" not in html
        # And no escaped-visible remnant either
        assert "&lt;script&gt;" not in html
        # The textual content around the tag survives
        assert "Test" in html
        assert "fine" in html
        # NOTE: The sanitiser strips only the tags; the body ("alert(1)") if
        # any survives as plain (escape()'d) text. That is XSS-safe. If the
        # requirement is to strip the tag body too, that is a separate fix.

    def test_html_entities_decoded_in_ai_content(self):
        # Use a distinctive marker so we can grep only the AI-controlled span
        payload = {"fornitore": "MARKERA&nbsp;A&amp;B&nbsp;MARKERB"}
        html = _build_analysis_html(payload, **DEFAULTS)
        # Locate the AI value in the rendered HTML — between MARKERA and MARKERB
        assert "MARKERA" in html and "MARKERB" in html
        start = html.index("MARKERA")
        end = html.index("MARKERB") + len("MARKERB")
        span = html[start:end]
        # After sanitiser: '&nbsp;' → ' ', '&amp;' → '&'; then esc() re-encodes '&' → '&amp;'
        assert "&nbsp;" not in span, f"&nbsp; leaked in AI span: {span!r}"
        # The surviving text should contain "A&amp;B" and space-normalised context
        assert "A&amp;B" in span

    def test_empty_string_is_safe(self):
        html = _build_analysis_html({"fornitore": ""}, **DEFAULTS)
        assert isinstance(html, str) and "<html" in html.lower()

    def test_none_value_is_safe(self):
        # Passing None as a value should not crash (goes through the (None,'',[]) skip)
        html = _build_analysis_html(
            {"fornitore": None, "note_ai": None}, **DEFAULTS
        )
        assert isinstance(html, str) and "<html" in html.lower()


# ---------------------- Notes rendering ----------------------

class TestNotesRendering:
    def test_note_ai_string_with_br_becomes_bullets(self):
        payload = {
            "note_ai": "Attenzione:<br>Nota importante<p>Extra</p>",
        }
        html = _build_analysis_html(payload, **DEFAULTS)
        assert "&lt;br&gt;" not in html
        assert "&lt;p&gt;" not in html
        # All 3 items should appear rendered somewhere in the note bullet list
        assert "Attenzione:" in html
        assert "Nota importante" in html
        assert "Extra" in html
        # The bullet <li> elements come from OUR code (not from the AI), so
        # they must remain as live tags for rendering.
        assert "<li" in html

    def test_note_ai_list_items_stripped(self):
        payload = {
            "note_ai": ["Nota 1<br>continua", "Nota 2"],
        }
        html = _build_analysis_html(payload, **DEFAULTS)
        assert "&lt;br&gt;" not in html
        # Item text visible
        assert "Nota 1" in html
        assert "continua" in html
        assert "Nota 2" in html


# ---------------------- KV table + list flatten ----------------------

class TestKvFlatten:
    def test_primitive_string_stripped_in_kv_row(self):
        payload = {"tipo_offerta": "Fisso<br>12 mesi"}
        html = _build_analysis_html(payload, **DEFAULTS)
        assert "&lt;br&gt;" not in html
        assert "Fisso" in html and "12 mesi" in html

    def test_list_of_primitives_stripped(self):
        # Any non-special key that is a primitive-list flows through
        # `", ".join(_sanitize_ai(x) for x in v)`.
        payload = {"vantaggi": ["Prezzo<br>basso", "Bonus<p>extra</p>"]}
        html = _build_analysis_html(payload, **DEFAULTS)
        assert "&lt;br&gt;" not in html
        assert "&lt;p&gt;" not in html
        assert "Prezzo" in html
        assert "basso" in html
        assert "Bonus" in html
        assert "extra" in html

    def test_dict_value_flatten_sanitized(self):
        payload = {"dettagli": {"campo1": "val<br>uno", "campo2": "due"}}
        html = _build_analysis_html(payload, **DEFAULTS)
        assert "&lt;br&gt;" not in html
        assert "val" in html and "uno" in html and "due" in html


# ---------------------- Integration ----------------------

class TestIntegrationSample:
    def test_full_extracted_sample_renders_cleanly(self):
        payload = {
            "fornitore": "Enel<br>Energia",
            "nome_offerta": "<p>Placet Fisso 12</p>",
            "note_ai": ["Nota 1<br>continua", "<p>Nota 2</p>"],
            "tipo_offerta": "Fisso",
        }
        html = _build_analysis_html(payload, **DEFAULTS)
        # No leaked escaped tags anywhere
        for bad in ("&lt;br&gt;", "&lt;p&gt;", "&lt;/p&gt;", "&lt;li&gt;"):
            assert bad not in html, f"Leaked artefact: {bad}"
        # Text content survives
        for token in ("Enel", "Energia", "Placet Fisso 12", "Nota 1", "continua", "Nota 2"):
            assert token in html, f"Missing content: {token}"


# ---------------------- Regression ----------------------

class TestRegression:
    def test_no_html_input_still_renders(self):
        payload = {
            "fornitore": "Enel Energia",
            "nome_offerta": "Placet Fisso",
            "note_ai": ["Buon prezzo", "Contratto standard"],
        }
        html = _build_analysis_html(payload, **DEFAULTS)
        assert "Enel Energia" in html
        assert "Placet Fisso" in html
        assert "Buon prezzo" in html

    def test_parse_error_banner_still_rendered(self):
        payload = {"parse_error": True, "error_message": "AI KO"}
        html = _build_analysis_html(payload, **DEFAULTS)
        assert "Analisi non riuscita" in html
        assert "AI KO" in html

    def test_utf8_emojis_preserved(self):
        payload = {"fornitore": "Enel ⚡", "note_ai": ["Nota 🚀 finita"]}
        html = _build_analysis_html(payload, **DEFAULTS)
        assert "⚡" in html
        assert "🚀" in html
