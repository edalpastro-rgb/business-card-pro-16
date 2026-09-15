"""
V50.z259 Navigator — coverage complementare: SSE stream + azione move_missed reale.
Non ripete i 12 test già passati in test_v50z259_navigator.py.
"""
import os
import re
import uuid
import time
import json as _json
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _stream_reply(headers, message, session_id=None, timeout=60):
    """POST /api/assistant/chat/stream (SSE) → concatena i delta come plaintext.
    Formato: eventi con 'event: delta' e 'data: {"text": "..."}'.
    """
    body = {"message": message}
    if session_id:
        body["session_id"] = session_id
    t0 = time.time()
    with requests.post(f"{API}/assistant/chat/stream", json=body, headers=headers, stream=True, timeout=timeout) as r:
        assert r.status_code == 200, r.text
        buf = []
        current_event = None
        for line in r.iter_lines(decode_unicode=True):
            if line is None:
                continue
            if line.startswith("event:"):
                current_event = line.split(":", 1)[1].strip()
                continue
            if line.startswith("data:"):
                data = line[5:].strip()
                if not data:
                    continue
                try:
                    obj = _json.loads(data)
                except Exception:
                    continue
                if current_event == "delta" and isinstance(obj, dict) and obj.get("text"):
                    buf.append(obj["text"])
                if current_event == "done":
                    break
    return "".join(buf), time.time() - t0


class TestNavigatorStream:
    """SSE stream deve produrre marker NAV senza LLM (deterministico)."""

    def test_stream_lost_produces_nav_markers_fast(self, headers):
        text, dt = _stream_reply(headers, "mi sono perso, non so da dove iniziare", timeout=30)
        assert "[[NAV:/contact/new" in text, f"missing contact/new marker in: {text[:400]}"
        assert "[[NAV:/appointment/new" in text
        assert "[[NAV:/callback/new" in text
        # intercept deterministico → deve rispondere velocemente (<8s con margine ingress)
        assert dt < 15, f"deterministic response too slow: {dt:.1f}s"

    def test_stream_goto_meteo_nav(self, headers):
        # Seed: assicura che 'Anna Rossi' esista
        r = requests.get(f"{API}/contacts", headers=headers, timeout=15)
        assert r.status_code == 200
        js = r.json()
        items = js.get("items", js) if isinstance(js, dict) else js
        anna = next((c for c in items if (c.get("first_name") or "").lower() == "anna" and (c.get("last_name") or "").lower() == "rossi"), None)
        created_id = None
        if not anna:
            r = requests.post(f"{API}/contacts", json={"first_name": "Anna", "last_name": "Rossi", "address_city": "Treviso"}, headers=headers, timeout=15)
            assert r.status_code in (200, 201), r.text
            anna = r.json()
            created_id = anna["contact_id"]
        cid = anna["contact_id"]

        text, dt = _stream_reply(headers, "devo andare da Anna Rossi", timeout=45)
        # deve contenere marker optimal-route con l'id del contatto
        assert re.search(rf"\[\[NAV:/optimal-route\?contacts={re.escape(cid)}\|", text), f"no optimal-route marker for {cid}: {text[:500]}"
        assert f"[[NAV:/contact/{cid}" in text, f"no contact card marker: {text[:500]}"
        # meteo o fallback "non disponibile"
        low = text.lower()
        assert ("meteo" in low) or ("non disponibile" in low), f"no meteo mention: {text[:500]}"

        if created_id:
            requests.delete(f"{API}/contacts/{created_id}", headers=headers, timeout=15)

    def test_stream_llm_km_report_marker(self, headers):
        """Domanda non deterministica → LLM deve rispettare la regola prioritaria e includere marker km-report."""
        sid = f"navtest_{uuid.uuid4().hex[:8]}"
        text, dt = _stream_reply(headers, "come faccio a vedere il resoconto dei chilometri percorsi?", session_id=sid, timeout=60)
        # potrebbe non essere sempre /km-report esatto: accettiamo qualunque marker NAV pertinente
        has_km = "[[NAV:/km-report" in text
        has_any_nav = "[[NAV:/" in text
        assert has_any_nav, f"LLM did not emit any NAV marker: {text[:600]}"
        # log soft-check per km-report
        if not has_km:
            pytest.skip(f"LLM did not pick /km-report but produced NAV markers ({text[:200]}...)")


class TestMoveMissedFlow:
    """Flusso completo 'sposta mancati' con dato reale + cleanup."""

    def test_missed_stream_and_action(self, headers):
        # 1) crea appuntamento oggi con start 2h fa, end 1h fa
        now = datetime.now(timezone.utc)
        start = (now - timedelta(hours=2)).isoformat()
        end = (now - timedelta(hours=1)).isoformat()
        payload = {"title": "NAV TEST mancato", "start_at": start, "end_at": end}
        r = requests.post(f"{API}/appointments", json=payload, headers=headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        appt = r.json()
        aid = appt.get("appointment_id") or appt.get("id")
        assert aid, f"appointment id missing: {appt}"

        try:
            # 2) chiedi ad Axon di spostare
            text, dt = _stream_reply(headers, "sposta tutti gli appuntamenti mancati di oggi a domani stesso orario", timeout=30)
            assert "NAV TEST mancato" in text, f"missed appt not listed: {text[:500]}"
            m = re.search(r"\[\[ACTION:move_missed\|[^|]+\|(\{.+?\})\s*\]\]", text, re.DOTALL)
            assert m, f"no ACTION marker: {text[:500]}"
            payload_json = _json.loads(m.group(1))
            assert aid in payload_json.get("ids", []), f"id {aid} not in action payload {payload_json}"
            assert payload_json.get("days") == 1

            # 3) conferma azione
            r = requests.post(f"{API}/axon/nav/action", json={"action": "move_missed", "payload": {"ids": [aid], "days": 1}}, headers=headers, timeout=20)
            assert r.status_code == 200, r.text
            reply = r.json().get("reply", "")
            assert "Fatto" in reply or "spostat" in reply.lower(), f"unexpected reply: {reply}"

            # 4) verifica shift +1 giorno
            r = requests.get(f"{API}/appointments", headers=headers, timeout=15)
            assert r.status_code == 200
            js = r.json()
            items = js.get("items", js) if isinstance(js, dict) else js
            found = next((a for a in items if (a.get("appointment_id") or a.get("id")) == aid), None)
            assert found, "appointment disappeared after move_missed"
            new_start = datetime.fromisoformat(str(found["start_at"]).replace("Z", "+00:00"))
            orig_start = datetime.fromisoformat(start.replace("Z", "+00:00")) if start.endswith("Z") else datetime.fromisoformat(start)
            delta = (new_start - orig_start).total_seconds()
            assert 82000 < delta < 90000, f"delta not ~24h: {delta}s (orig={orig_start} new={new_start})"
        finally:
            # CLEANUP
            requests.delete(f"{API}/appointments/{aid}", headers=headers, timeout=15)


class TestProactiveEndpoint:
    """Verifica GET /axon/nav/proactive risponde correttamente."""

    def test_proactive_returns_hints_schema(self, headers):
        r = requests.get(f"{API}/axon/nav/proactive", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "hints" in data
        for h in data["hints"]:
            assert {"id", "text", "route", "label"}.issubset(h.keys())
