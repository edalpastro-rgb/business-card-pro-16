"""V50.z469 — Feature 7 (rubrica fallback) + Feature 8 (watchdog Axon)."""
import os, json, asyncio, requests

BASE = os.environ.get("TEST_BASE", "http://localhost:8001/api")


def _login():
    r = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _stream_text(h, msg):
    r = requests.post(f"{BASE}/assistant/chat/stream", json={"message": msg}, headers=h, timeout=90, stream=True)
    out = []
    for line in r.iter_lines():
        if line and line.startswith(b"data:"):
            try:
                d = json.loads(line[5:].decode())
                if "text" in d and "stage" not in d:
                    out.append(d["text"])
            except Exception:
                pass
    return "".join(out)


def test_phonebook_marker_when_not_in_crm():
    h = _login()
    t = _stream_text(h, "numero di Zebedeo Mastrangelo")
    assert "[[RUBRICA:Zebedeo Mastrangelo]]" in t
    assert "Non trovo" in t


def test_phonebook_crm_hit_has_no_marker():
    h = _login()
    t = _stream_text(h, "numero di Mario Rossi")
    assert "[[RUBRICA" not in t and "Mario Rossi" in t


def test_phonebook_result_persists_history():
    h = _login()
    r = requests.post(f"{BASE}/assistant/phonebook-result", json={"name": "Zebedeo Mastrangelo", "phone": "+39 333 0000000", "found": True}, headers=h, timeout=20)
    assert r.status_code == 200 and "+39 333 0000000" in r.json()["content"]
    r2 = requests.post(f"{BASE}/assistant/phonebook-result", json={"name": "Nessuno", "found": False, "permission": "denied"}, headers=h, timeout=20)
    assert "Permessi" in r2.json()["content"]


def test_watchdog_status_and_recover():
    h = _login()
    s = requests.get(f"{BASE}/axon/watchdog/status", headers=h, timeout=20).json()
    assert s["first_token_timeout_s"] == 10 and s["heartbeat_age_s"] < 5 and s["restart_scheduled"] is False
    r = requests.post(f"{BASE}/axon/watchdog/recover", json={"reason": "test", "elapsed_ms": 10000}, headers=h, timeout=20).json()
    assert r["ok"] and r["action"] == "soft" and "riprendendo" in r["message"]


def test_wd_llm_stream_retries_then_succeeds():
    """Unit: primo tentativo muto > timeout → 'recovering' → secondo tentativo risponde."""
    import importlib.util, types, sys
    src = open(os.path.join(os.path.dirname(__file__), "..", "routes", "axon_watchdog.py")).read()
    # estrai solo la funzione generatore (il modulo richiede i globali del server)
    start = src.index("async def _wd_llm_stream"); end = src.index("class WdRecoverIn")
    ns = {"_wd_asyncio": asyncio, "_WD_FIRST_TOKEN_S": 0.3, "_WD_RETRY_TOKEN_S": 2.0, "_WD_HARD_RESTART_INCIDENTS": 99, "Optional": __import__("typing").Optional}
    ns["UserMessage"] = lambda text: text
    async def _inc(*a, **k): return 1
    ns["_wd_incident"] = _inc; ns["_wd_schedule_hard_restart"] = lambda *a, **k: None
    exec(src[start:end], ns)
    calls = {"n": 0}

    class _Chat:
        def __init__(self, slow): self.slow = slow
        async def stream_message(self, m):
            if self.slow:
                await asyncio.sleep(5)
            yield "tok1"; yield "tok2"

    def make():
        calls["n"] += 1
        return _Chat(slow=calls["n"] == 1)

    async def run():
        return [x async for x in ns["_wd_llm_stream"](make, "ciao", first_timeout=0.3)]
    out = asyncio.run(run())
    assert out[0] == ("recovering", None) and [e for k, e in out if k == "event"] == ["tok1", "tok2"] and calls["n"] == 2
