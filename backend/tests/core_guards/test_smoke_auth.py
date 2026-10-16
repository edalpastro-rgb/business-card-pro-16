"""tests/core_guards/test_smoke_auth.py — V50.z566 — token a corto circuito dello smoke gate: solo localhost + segreto, mai password/OAuth."""
import asyncio

from core import smoke_auth


def _scope(headers, client=("127.0.0.1", 1234), method="POST", path="/api/assistant/chat/stream"):
    return {"type": "http", "method": method, "path": path, "client": client, "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()], "query_string": b""}


def _mw(monkeypatch, secret="s3cret", email="smoke@axon.it"):
    monkeypatch.setenv("SMOKE_TEST_SECRET", secret)
    monkeypatch.setenv("SMOKE_EMAIL", email)
    seen = {"auth": None, "calls": 0, "exempt": []}

    async def app(scope, receive, send):
        seen["calls"] += 1
        seen["auth"] = dict((k, v) for k, v in scope["headers"]).get(b"authorization")
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def resolve(e):
        return "uid-smoke" if e == "smoke@axon.it" else None

    mw = smoke_auth.SmokeAuthMiddleware(app, resolve, lambda uid: f"JWT-{uid}", on_user=lambda uid: seen["exempt"].append(uid))
    return mw, seen


async def _call(mw, scope):
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(m):
        sent.append(m)
    await mw(scope, receive, send)
    return sent[0]["status"]


def test_header_from_localhost_injects_internal_bearer(monkeypatch):
    mw, seen = _mw(monkeypatch)
    st = asyncio.run(_call(mw, _scope({"X-Smoke-Test-Secret": "s3cret"})))
    assert st == 200 and seen["auth"] == b"Bearer JWT-uid-smoke" and seen["exempt"] == ["uid-smoke"]


def test_header_behind_nginx_uses_first_hop(monkeypatch):
    mw, seen = _mw(monkeypatch)
    st = asyncio.run(_call(mw, _scope({"X-Smoke-Test-Secret": "s3cret", "X-Real-IP": "127.0.0.1"}, client=("172.18.0.5", 40000))))
    assert st == 200 and seen["auth"] == b"Bearer JWT-uid-smoke"


def test_wrong_secret_or_remote_origin_is_403_and_never_reaches_app(monkeypatch):
    mw, seen = _mw(monkeypatch)
    assert asyncio.run(_call(mw, _scope({"X-Smoke-Test-Secret": "wrong"}))) == 403
    assert asyncio.run(_call(mw, _scope({"X-Smoke-Test-Secret": "s3cret", "X-Real-IP": "80.211.27.80"}, client=("172.18.0.5", 1)))) == 403
    assert seen["calls"] == 0


def test_without_header_is_transparent(monkeypatch):
    mw, seen = _mw(monkeypatch)
    st = asyncio.run(_call(mw, _scope({"Authorization": "Bearer user-token"})))
    assert st == 200 and seen["auth"] == b"Bearer user-token" and seen["exempt"] == []


def test_unknown_smoke_email_is_404(monkeypatch):
    mw, seen = _mw(monkeypatch, email="nessuno@axon.it")
    assert asyncio.run(_call(mw, _scope({"X-Smoke-Test-Secret": "s3cret"}))) == 404 and seen["calls"] == 0
