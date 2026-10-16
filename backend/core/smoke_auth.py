"""core/smoke_auth.py — V50.z566 — TOKEN A CORTO CIRCUITO PER LO SMOKE GATE (solo localhost + segreto).

L'app autentica gli utenti con Google OAuth: lo smoke gate post-deploy non può fare un login email/password (422).
Questo middleware ASGI, se la richiesta (1) arriva da localhost (client diretto o primo hop X-Real-IP/X-Forwarded-For
= 127.0.0.1/::1, cioè `curl https://localhost` dal VPS attraverso nginx) e (2) porta l'header `X-Smoke-Test-Secret`
uguale alla variabile .env SMOKE_TEST_SECRET, risolve l'account SMOKE_EMAIL e INIETTA nella richiesta un
`Authorization: Bearer <JWT interno a breve durata>` emesso dal server stesso — nessun OAuth, nessuna password.
Segreto errato o origine non locale → 403 immediato (loggato). Senza header il middleware è trasparente.
"""
import hmac
import logging
import os
from typing import Awaitable, Callable, Optional

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

_log = logging.getLogger("axon.core.smoke_auth")
HEADER = "x-smoke-test-secret"
_LOOPBACK = {"127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"}


def is_local(scope) -> bool:
    """True se il client diretto è loopback oppure (dietro nginx) il primo hop dichiarato è loopback."""
    client = (scope.get("client") or ("", 0))[0] or ""
    if client in _LOOPBACK:
        return True
    h = Headers(scope=scope)
    hop = (h.get("x-real-ip") or (h.get("x-forwarded-for") or "").split(",")[0]).strip()
    return hop in _LOOPBACK


class SmokeAuthMiddleware:
    def __init__(self, app, resolve_user_id: Callable[[str], Awaitable[Optional[str]]], mint_token: Callable[[str], str],
                 secret_env: str = "SMOKE_TEST_SECRET", email_env: str = "SMOKE_EMAIL", on_user: Optional[Callable[[str], None]] = None):
        self.app = app
        self.resolve = resolve_user_id
        self.mint = mint_token
        self.secret_env = secret_env
        self.email_env = email_env
        self.on_user = on_user
        self._cache: dict = {}
        self.issued = 0

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        presented = headers.get(HEADER)
        if presented is None:
            return await self.app(scope, receive, send)
        secret = (os.environ.get(self.secret_env) or "").strip()
        email = (os.environ.get(self.email_env) or "").strip().lower()
        if not secret or not email or not is_local(scope) or not hmac.compare_digest(presented.strip(), secret):
            _log.warning("[smoke-auth] RIFIUTATO (locale=%s, segreto configurato=%s, email configurata=%s)", is_local(scope), bool(secret), bool(email))
            return await JSONResponse({"detail": "Smoke secret non valido o origine non locale"}, status_code=403)(scope, receive, send)
        user_id = self._cache.get(email)
        if not user_id:
            try:
                user_id = await self.resolve(email)
            except Exception as exc:  # noqa: BLE001
                _log.warning("[smoke-auth] resolve: %s", exc)
                user_id = None
            if not user_id:
                return await JSONResponse({"detail": f"Account smoke «{email}» non trovato"}, status_code=404)(scope, receive, send)
            self._cache[email] = user_id
            if self.on_user:
                self.on_user(user_id)
        token = self.mint(user_id)
        self.issued += 1
        raw = [(k, v) for k, v in scope["headers"] if k.lower() not in (b"authorization", HEADER.encode())]
        raw.append((b"authorization", f"Bearer {token}".encode()))
        scope = dict(scope)
        scope["headers"] = raw
        await self.app(scope, receive, send)
