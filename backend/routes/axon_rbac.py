# axon_rbac.py — V50.z436 — Ruolo «Consulente» (consultant) + matrice permessi centralizzata `can(user, azione)`
#
# Ruoli: owner (Master, nessun parent) · owner con parent (Master figlio) · admin (manager) · member (collaboratore) ·
#        consultant (V50.z436: solo operativo sui PROPRI dati, nessuna area di amministrazione/configurazione).
# Unico punto di verità lato API: `can(user, action)` + dipendenza `require_can(action)`; il middleware `_rbac_guard`
# blocca per il consultant TUTTE le rotte di amministrazione anche se conosce l'URL (403 «Funzione riservata…»).
# La visibilità dei dati del consultant è quella del member (contatti assegnati a sé, pratiche/agenda/entità create da sé):
# vedi 07_contacts.contact_visibility_filter (ramo non-admin), 02_models.scope_query (created_by), 08_calendar, crt_practices.
# Frontend speculare: src/useRole.ts (stessa matrice).

from fastapi.responses import JSONResponse as _RbacJSONResponse

ROLE_CONSULTANT = "consultant"
ROLES = ("owner", "admin", "member", ROLE_CONSULTANT)

# Azioni OPERATIVE (tutti i ruoli)
_RBAC_OPERATIVE = {
    "contacts.own", "calendar.own", "calendar.add_personal", "axon.chat", "scanner.use", "practices.own", "documents.own",
    "bills.own", "settings.personal", "settings.axon_basic",  # nome con cui Axon si rivolge, voce, ascolto costante
}
# Azioni da collaboratore/manager (NON consultant)
_RBAC_STAFF = _RBAC_OPERATIVE | {
    "settings.tts_advanced", "contacts.export", "bug_reports", "help.tickets", "team.view", "libretto.read",
}
# Azioni di AMMINISTRAZIONE / CONFIGURAZIONE (Master; alcune anche admin)
_RBAC_ADMIN = {
    "master_panel", "team.manage", "invites", "settings.tenant", "smtp", "branding", "axon_center", "scanner.config", "team_insights",
    "crm_areas", "custom_fields", "gdpr", "stress_test", "voiceprint", "form_templates", "contacts.all", "calendar.all",
}
_RBAC_ADMIN_ROLE_EXTRA = {"team.manage", "invites", "contacts.all", "calendar.all", "custom_fields", "crm_areas"}  # manager (admin)

_RBAC_MATRIX = {
    "owner": _RBAC_STAFF | _RBAC_ADMIN,
    "admin": _RBAC_STAFF | _RBAC_ADMIN_ROLE_EXTRA,
    "member": _RBAC_STAFF,
    ROLE_CONSULTANT: _RBAC_OPERATIVE,
}


def is_consultant(user: Optional[dict]) -> bool:
    return bool(user) and (user.get("role") or "member") == ROLE_CONSULTANT


def can(user: Optional[dict], action: str) -> bool:
    """Unico punto di verità per i permessi. Super-admin di piattaforma: tutto (+ 'admin_platform')."""
    if not user:
        return False
    _isa = globals().get("is_super_admin")
    if _isa and _isa(user):
        return True
    if action == "admin_platform":
        return False
    role = user.get("role") or "member"
    if role == "owner" and user.get("parent_user_id") and action in ("stress_test",):
        return False  # Master figlio: niente strumenti di piattaforma
    return action in _RBAC_MATRIX.get(role, _RBAC_OPERATIVE)


def require_can(action: str, detail: str = "Funzione riservata ad altri ruoli"):
    async def _dep(user=Depends(get_current_user)):
        if not can(user, action):
            raise HTTPException(status_code=403, detail=detail)
        return user
    return _dep


# ── Middleware: blocco rotte di amministrazione per il consultant (anche via URL diretto) ──────────────────────────
# (prefisso dopo /api, metodi bloccati: "*" = tutti, "W" = solo scritture PUT/POST/PATCH/DELETE)
_RBAC_DENY_CONSULTANT = [
    ("/admin", "*"), ("/team", "*"), ("/team-insights", "*"), ("/invites", "*"), ("/groups", "*"), ("/master", "*"), ("/master-files", "*"),
    ("/master-docs", "*"), ("/smtp", "*"), ("/email/config", "*"), ("/email/test", "*"), ("/email/events", "*"), ("/org/branding", "*"),
    ("/axon/teach", "*"), ("/axon/rule-proposals", "*"), ("/axon/tenant-memory", "*"), ("/axon/stress", "*"), ("/ai-teach", "*"),
    ("/voiceprint", "*"), ("/wake-samples", "*"), ("/viola-wake/module", "*"), ("/form-templates", "W"), ("/crt/settings", "*"),
    ("/crt/dossier-example", "*"), ("/contact-custom-fields", "W"), ("/settings", "W"), ("/libretto", "W"), ("/support/tickets", "*"),
    ("/help-center/data-deletion-requests", "*"), ("/bulk", "*"), ("/users", "W"), ("/lab", "*"), ("/cgym", "W"), ("/event-banners", "W"),
    ("/promo", "W"), ("/referral", "W"), ("/scanner/config", "*"), ("/voice-devices", "W"), ("/homeassistant", "W"), ("/integrations", "W"),
    ("/webhook", "*"), ("/jobs", "*"), ("/billing", "W"), ("/subscription", "W"), ("/reports", "*"), ("/courses-dashboard", "*"),
    ("/tips", "W"), ("/table-header", "W"), ("/quick-action", "W"),
]
_RBAC_WRITE = {"PUT", "POST", "PATCH", "DELETE"}
_rbac_role_cache: Dict[str, Tuple[float, str]] = {}


async def _rbac_role_from_request(request) -> Optional[str]:
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    now_ts = time.time()
    hit = _rbac_role_cache.get(token)
    if hit and now_ts - hit[0] < 60:
        return hit[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload.get("sub")
    except Exception:
        sess = await db.user_sessions.find_one({"token": token}, {"user_id": 1})
        uid = sess.get("user_id") if sess else None
    if not uid:
        return None
    u = await db.users.find_one({"user_id": uid}, {"role": 1})
    role = (u or {}).get("role") or "member"
    if len(_rbac_role_cache) > 5000:
        _rbac_role_cache.clear()
    _rbac_role_cache[token] = (now_ts, role)
    return role


@app.middleware("http")
async def _rbac_guard(request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        rel = path[4:]
        method = request.method.upper()
        for prefix, mode in _RBAC_DENY_CONSULTANT:
            if (rel == prefix or rel.startswith(prefix + "/")) and (mode == "*" or method in _RBAC_WRITE):
                role = await _rbac_role_from_request(request)
                if role == ROLE_CONSULTANT:
                    return _RbacJSONResponse(status_code=403, content={"detail": "Funzione riservata al Master o ai manager: il profilo Consulente è solo operativo."})
                break
    return await call_next(request)


@api_router.get("/me/permissions")
async def my_permissions(user=Depends(get_current_user)):
    """Matrice permessi dell'utente corrente (specchio di src/useRole.ts)."""
    all_actions = sorted(_RBAC_STAFF | _RBAC_ADMIN | {"admin_platform"})
    return {"role": user.get("role") or "member", "is_consultant": is_consultant(user), "can": {a: can(user, a) for a in all_actions}}
