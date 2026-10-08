"""V50.z487 extras — SSE NAV marker in stream, sanitize combo request, routes."""
import json
import os

import requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")


def _login():
    r = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_sanitize_combo_four_markers_as_requested():
    """Review spec: 4 markers, first three remapped, 4th becomes text."""
    h = _login()
    txt = ("[[NAV:/impostazioni?section=permessi|Impostazioni → Permessi]] "
           "[[NAV:/settings|Impostazioni]] "
           "[[NAV:/configurazione-guidata|Config]] "
           "[[NAV:/videochiamata|Video]]")
    r = requests.post(f"{BASE}/axon/nav/sanitize", json={"text": txt}, headers=h, timeout=30)
    assert r.status_code == 200, r.text[:300]
    out = r.json()["text"]
    assert "[[NAV:/permessi?standalone=1|Impostazioni → Permessi]]" in out
    assert "[[NAV:/impostazioni|Impostazioni]]" in out
    assert "[[NAV:/setup|Config]]" in out
    # 4th → no NAV, text explanation present
    assert "[[NAV:/videochiamata" not in out
    assert "non c'è una schermata dedicata" in out
    assert "Video" in out


def test_routes_endpoint_has_core_paths():
    h = _login()
    r = requests.get(f"{BASE}/axon/nav/routes", headers=h, timeout=20)
    assert r.status_code == 200
    j = r.json()
    for p in ("/permessi", "/setup", "/pun-storico"):
        assert p in j["paths"], f"missing path {p}"


def test_sse_stream_contains_valid_nav_marker_for_permessi():
    """SSE: ask about app permissions → stream should include a NAV marker to /permessi (sanitized)."""
    h = _login()
    body = {
        "message": "Dove trovo i permessi dell'app per il GPS? Rispondi includendo il link alla schermata.",
        "no_cache": True,
        "client_context": {"route": "/home"},
    }
    collected = ""
    with requests.post(f"{BASE}/assistant/chat/stream", json=body, headers=h, timeout=120, stream=True) as r:
        assert r.status_code == 200, r.text[:300]
        for raw in r.iter_lines(decode_unicode=True):
            if not raw:
                continue
            line = raw if isinstance(raw, str) else raw.decode("utf-8", "ignore")
            if line.startswith("data:"):
                payload = line[5:].strip()
                if not payload:
                    continue
                try:
                    obj = json.loads(payload)
                except Exception:
                    continue
                # typical SSE schema: {"delta": "..."} or {"text": "..."} or {"done": true}
                if isinstance(obj, dict):
                    for k in ("delta", "text", "content"):
                        v = obj.get(k)
                        if isinstance(v, str):
                            collected += v
                    if obj.get("done") or obj.get("event") == "done":
                        break
    # Must contain a NAV marker pointing to the permessi screen (or none at all, but then test is soft)
    # Review requires: contains [[NAV:/permessi?standalone=1|...]] marker
    assert "[[NAV:/permessi?standalone=1" in collected, f"collected={collected[:600]!r}"
    # No invalid routes
    invalid = ("/settings", "/configurazione-guidata", "/impostazioni?section=permessi")
    for bad in invalid:
        assert f"[[NAV:{bad}" not in collected, f"invalid route leaked: {bad}"
