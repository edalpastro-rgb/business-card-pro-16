"""V50.z554 — Manual + Assistant how-to injection tests."""
import os
import re
import json
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/")
EMAIL = "test@dalpastro.it"
PASSWORD = "Test1234!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token")
    assert tok, f"no token: {r.text[:200]}"
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


# ---------------- /api/public/manual ----------------
class TestManualList:
    def test_manual_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/public/manual", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("total", 0) >= 100, f"only {d.get('total')} articles"
        assert len(d.get("categories", [])) >= 3
        for a in d["items"][:5]:
            for k in ("id", "title", "path", "body"):
                assert k in a and a[k], f"missing {k} in {a}"
            assert "route" in a  # may be None

    def test_manual_with_auth(self, session):
        r = session.get(f"{BASE_URL}/api/public/manual", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("total", 0) >= 100
        # route uniqueness index for later nav validation
        self.routes = {a["route"] for a in d["items"] if a.get("route")}


# ---------------- /api/public/manual/search ----------------
QUERIES = [
    ("scanner", True),
    ("nota vocale", True),
    ("landing page", True),
    ("come creo un contatto", True),
    ("calendario appuntamenti", True),
    ("fatture energia", True),
    ("axon lab", True),
]


@pytest.mark.parametrize("q,expect_hits", QUERIES)
def test_manual_search_italian(q, expect_hits):
    r = requests.get(f"{BASE_URL}/api/public/manual/search", params={"q": q, "k": 8}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    items = d.get("items", [])
    if expect_hits:
        assert len(items) >= 1, f"no results for '{q}'"
        scores = [i.get("score", 0) for i in items]
        assert scores == sorted(scores, reverse=True), f"scores not desc for '{q}': {scores}"
        # verify relevance: query token appears in title/body/kw/path
        toks = [t for t in re.findall(r"[a-zàèéìòùA-Z]+", q.lower()) if len(t) >= 3]
        top = items[0]
        blob = " ".join([top.get("title", ""), top.get("path", ""), top.get("body", ""), top.get("kw", "")]).lower()
        assert any(t in blob for t in toks), f"top hit irrelevant for '{q}': {top.get('title')}"


def test_manual_search_empty_query():
    r = requests.get(f"{BASE_URL}/api/public/manual/search", params={"q": ""}, timeout=20)
    assert r.status_code == 200
    assert r.json().get("items") == []


def test_manual_search_nonsense():
    r = requests.get(f"{BASE_URL}/api/public/manual/search", params={"q": "zxqwtyuiopasdfghjkl"}, timeout=20)
    assert r.status_code == 200
    assert isinstance(r.json().get("items"), list)


# ---------------- /api/assistant/chat (how-to injection) ----------------
HOWTO = [
    "Come faccio a creare un nuovo contatto?",
    "Dove trovo lo scanner biglietti da visita?",
    "Come registro una nota vocale su un cliente?",
    "Dove si configura la landing page?",
]

NAV_RE = re.compile(r"\[\[NAV:([^|\]]+)\|([^\]]+)\]\]")


@pytest.fixture(scope="module")
def manual_routes():
    r = requests.get(f"{BASE_URL}/api/public/manual", timeout=20)
    return {a["route"] for a in r.json()["items"] if a.get("route")}


@pytest.mark.parametrize("msg", HOWTO)
def test_assistant_howto_contains_nav(session, msg, manual_routes):
    r = session.post(f"{BASE_URL}/api/assistant/chat", json={"message": msg}, timeout=90)
    assert r.status_code == 200, f"status {r.status_code}: {r.text[:300]}"
    reply = r.json().get("reply", "")
    assert reply, f"empty reply for '{msg}'"
    chips = NAV_RE.findall(reply)
    assert chips, f"NO NAV chip for '{msg}'. Reply head: {reply[:300]}"
    for route, label in chips:
        assert route in manual_routes, f"INVENTED route '{route}' not in manual for msg '{msg}'. Reply: {reply[:400]}"
    # path mention: "Menu →" or "→" or path hint
    assert ("→" in reply) or ("Menu" in reply) or ("Barra" in reply) or ("menu" in reply.lower()), f"No path mention for '{msg}'"


def test_assistant_simple_message(session):
    r = session.post(f"{BASE_URL}/api/assistant/chat", json={"message": "ciao"}, timeout=60)
    assert r.status_code == 200, r.text[:200]
    assert r.json().get("reply")


# ---------------- /api/assistant/chat/stream ----------------
def test_assistant_stream_howto(session):
    url = f"{BASE_URL}/api/assistant/chat/stream"
    with session.post(url, json={"message": "Come faccio a creare un contatto?"}, stream=True, timeout=90) as r:
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        chunks = []
        for i, line in enumerate(r.iter_lines(decode_unicode=True)):
            if line:
                chunks.append(line)
            if i > 400:
                break
        assert chunks, "no SSE data received"
        joined = "\n".join(chunks)
        # look for NAV chip in stream
        assert "NAV:" in joined or len(chunks) > 2, f"stream too short / no NAV: {joined[:400]}"
