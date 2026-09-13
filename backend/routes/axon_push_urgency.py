# axon_push_urgency.py — V50.z220 — Notifiche a LIVELLI DI URGENZA (Android attivo + iOS-ready) — modulo ISOLATO
#
# Porta nello stack AdvisorOS (FastAPI + Emergent Push relay, payload data-only) il concetto del «NotificationsManager»:
#   urgency ∈ CRITICAL | HIGH | NORMAL
#   • Android: la priorità, il suono, il LED e la vibrazione sono proprietà del CANALE (Android 8+). Il backend sceglie il canale con
#     `channel_id` (`urgent_alerts` = LED rosso + vibrazione lunga + importanza MAX + bypass DND; `standard_alerts` = LED blu, HIGH;
#     `default` = canale storico). I canali sono creati a livello modulo in `src/pushBridge.ts`.
#   • iOS (ready): `sound` (aps.sound: «urgent.wav» se bundlato, altrimenti «default»), `badge` (n. non lette), `category`
#     (URGENT|DEFAULT) e `interruption_level` (time-sensitive per CRITICAL) viaggiano nel payload `data`: il relay Emergent oggi applica
#     `sound`; category/interruption/mutable_content restano pronti per quando il relay li esporrà (o per una build con Notification
#     Service Extension) — l'app li legge da `data` per feedback aptico/haptics locali.
# API helper (Python): send_critical_alert / send_standard_notif / send_normal_notif(recipients, title, body, deeplink=None, **extra).
# Wrapper di send_push: ogni push senza `channel_id` riceve urgenza da `data.urgency` → altrimenti da `kind` (mappa per-tenant modificabile,
# GET/PUT /axon/push/urgency-map) → altrimenti NORMAL. POST /axon/push/test-urgency {urgency} invia un test a se stessi.
# L'utente specificherà quali eventi sono CRITICAL: la mappa di default marca CRITICAL solo `callback_urgent` (già «urgente» oggi).

_APU_LEVELS = ("CRITICAL", "HIGH", "NORMAL")
_APU_CHANNEL = {"CRITICAL": "urgent_alerts", "HIGH": "standard_alerts", "NORMAL": "default"}
_APU_SOUND = {"CRITICAL": "default", "HIGH": "default", "NORMAL": "default"}  # iOS: sostituire con «urgent.wav» quando il file è bundlato in app.json
_APU_LED = {"CRITICAL": "#FF0000", "HIGH": "#0066FF", "NORMAL": None}
_APU_VIBRATION = {"CRITICAL": 1000, "HIGH": 300, "NORMAL": 0}
_APU_CATEGORY = {"CRITICAL": "URGENT", "HIGH": "DEFAULT", "NORMAL": "DEFAULT"}
_APU_INTERRUPTION = {"CRITICAL": "time-sensitive", "HIGH": "active", "NORMAL": "active"}
_APU_COLOR = "#EA580C"  # brand AdvisorOS (accent)

# Urgenza di default per `kind` (AXN_KINDS + kind interni). Modificabile per tenant via PUT /axon/push/urgency-map.
_APU_DEFAULT_KIND_MAP = {
    "callback_urgent": "CRITICAL",
    "cgym_due": "HIGH",
    "credits": "HIGH",
    "weekly_report": "NORMAL",
    "axon_message": "HIGH",
    "reminder": "HIGH",
    "alarm": "CRITICAL",
    "deadline": "HIGH",
    "weather_alert": "CRITICAL",
    "test": "NORMAL",
}


def apu_normalize(level: Optional[str]) -> str:
    l = (level or "").strip().upper()
    return l if l in _APU_LEVELS else "NORMAL"


def apu_payload(title: str, message: str, urgency: str = "NORMAL", deeplink: Optional[str] = None, badge: Optional[int] = None, **extra) -> dict:
    """Costruisce il `data` per send_push con tutti i campi Android + iOS-ready."""
    u = apu_normalize(urgency)
    data: Dict[str, Any] = {
        "title": (title or "")[:120], "message": (message or "")[:600],
        "urgency": u, "channel_id": _APU_CHANNEL[u], "sound": _APU_SOUND[u], "color": _APU_COLOR,
        "category": _APU_CATEGORY[u], "interruption_level": _APU_INTERRUPTION[u], "mutable_content": "1",
        "vibration": str(_APU_VIBRATION[u]), "timestamp": utcnow().isoformat(),
    }
    if _APU_LED[u]:
        data["led_color"] = _APU_LED[u]
    if deeplink:
        data["deeplink"] = deeplink
        data["action_url"] = deeplink
    if badge is not None:
        data["badge"] = badge
    for k, v in extra.items():
        if v is not None:
            data[k] = v
    return data


async def _apu_config(tenant: Optional[str]) -> Tuple[Dict[str, str], List[dict]]:
    """(mappa kind→urgenza, regole personalizzate per parola chiave) del tenant."""
    m = dict(_APU_DEFAULT_KIND_MAP)
    rules: List[dict] = []
    if tenant:
        doc = await db.axon_push_config.find_one({"tenant_id": tenant}, {"_id": 0, "urgency_map": 1, "custom_rules": 1}) or {}
        for k, v in (doc.get("urgency_map") or {}).items():
            m[k] = apu_normalize(v)
        rules = [r for r in (doc.get("custom_rules") or []) if r.get("match")]
    return m, rules


async def _apu_kind_map(tenant: Optional[str]) -> Dict[str, str]:
    return (await _apu_config(tenant))[0]


def _apu_rule_hit(rules: List[dict], title: str, message: str, kind: str) -> Optional[str]:
    """Prima regola personalizzata che matcha (parola chiave in titolo/testo, o kind uguale) → urgenza."""
    hay = f"{title}\n{message}".lower()
    for r in rules:
        m = str(r.get("match") or "").strip().lower()
        if m and (m in hay or m == kind.lower()):
            return apu_normalize(r.get("urgency"))
    return None


async def send_critical_alert(recipients: List[str], title: str, body: str, deeplink: Optional[str] = None, **extra) -> None:
    """Android: canale urgent_alerts (LED rosso, vibrazione 1 s, MAX, bypass DND) · iOS: time-sensitive, badge, suono."""
    await send_push(recipients, apu_payload(title, body, "CRITICAL", deeplink, **extra), idempotency_key=extra.get("idempotency_key"))


async def send_standard_notif(recipients: List[str], title: str, body: str, deeplink: Optional[str] = None, **extra) -> None:
    """Task completati, messaggi team, aggiornamenti: canale standard_alerts (LED blu, HIGH)."""
    await send_push(recipients, apu_payload(title, body, "HIGH", deeplink, **extra), idempotency_key=extra.get("idempotency_key"))


async def send_normal_notif(recipients: List[str], title: str, body: str, deeplink: Optional[str] = None, **extra) -> None:
    await send_push(recipients, apu_payload(title, body, "NORMAL", deeplink, **extra), idempotency_key=extra.get("idempotency_key"))


# ---------------------------------------------------------------------------- wrapper: ogni push esistente riceve canale/urgenza coerenti
_apu_prev_send_push = send_push


async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:  # noqa: F811
    try:
        if isinstance(data, dict) and "channel_id" not in data:
            u = data.get("urgency")
            kind = str(data.get("kind") or "")
            if not u or kind != "test":
                tenant = None
                if recipients:
                    urow = await db.users.find_one({"user_id": recipients[0]}, {"_id": 0, "tenant_id": 1, "user_id": 1})
                    tenant = (urow or {}).get("tenant_id") or (urow or {}).get("user_id")
                kmap, rules = await _apu_config(tenant)
                # priorità: regola personalizzata (parola chiave) > urgenza esplicita > mappa per tipo evento > NORMAL
                u = _apu_rule_hit(rules, str(data.get("title") or ""), str(data.get("message") or ""), kind) or u or kmap.get(kind, "NORMAL")
            enriched = apu_payload(data.get("title", ""), data.get("message", ""), u, data.get("deeplink") or data.get("action_url"), data.get("badge"))
            data = {**enriched, **{k: v for k, v in data.items() if k not in ("title", "message")}, "channel_id": enriched["channel_id"], "urgency": enriched["urgency"]}
    except Exception as exc:  # noqa: BLE001 — mai bloccare la push
        logger.warning("[push-urgency] enrich failed: %s", exc)
    await _apu_prev_send_push(recipients, data, idempotency_key)


# ---------------------------------------------------------------------------- API
class ApuMapIn(BaseModel):
    urgency_map: Optional[Dict[str, str]] = None
    custom_rules: Optional[List[Dict[str, Any]]] = None  # [{id?, label, match, urgency}]


class ApuTestIn(BaseModel):
    urgency: str = "CRITICAL"


@api_router.get("/axon/push/urgency-map")
async def apu_map_get(user=Depends(get_current_user)):
    m, rules = await _apu_config(tenant_id(user))
    return {"levels": list(_APU_LEVELS), "channels": _APU_CHANNEL, "urgency_map": m, "custom_rules": rules, "defaults": _APU_DEFAULT_KIND_MAP,
            "dnd_bypass": True,  # scelta utente: le CRITICAL suonano sempre, anche di notte
            "labels": {**AXN_KINDS, "reminder": "Promemoria", "alarm": "Sveglie e timer", "deadline": "Scadenze contratti", "weather_alert": "Allerte meteo", "test": "Test"}}


@api_router.put("/axon/push/urgency-map")
async def apu_map_put(body: ApuMapIn, user=Depends(get_current_user)):
    if (user.get("role") or "owner") not in ("owner", "master", "admin"):
        raise HTTPException(status_code=403, detail="Solo il Master può cambiare le urgenze")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.urgency_map is not None:
        upd["urgency_map"] = {k: apu_normalize(v) for k, v in body.urgency_map.items() if k}
    if body.custom_rules is not None:
        rules = []
        for r in body.custom_rules[:50]:
            match = str(r.get("match") or "").strip()[:80]
            if not match:
                continue
            rules.append({"id": str(r.get("id") or uuid.uuid4().hex[:8]), "label": str(r.get("label") or match)[:80], "match": match, "urgency": apu_normalize(r.get("urgency"))})
        upd["custom_rules"] = rules
    await db.axon_push_config.update_one({"tenant_id": tenant_id(user)}, {"$set": upd}, upsert=True)
    m, rules = await _apu_config(tenant_id(user))
    return {"ok": True, "urgency_map": m, "custom_rules": rules}


@api_router.post("/axon/push/test-urgency")
async def apu_test(body: ApuTestIn, user=Depends(get_current_user)):
    """Invia a se stessi una push del livello scelto (Android: canale dedicato; in anteprima/Expo Go finisce nell'outbox o «not_configured»)."""
    u = apu_normalize(body.urgency)
    title = {"CRITICAL": "⚠️ Test URGENTE AxonOS", "HIGH": "🔔 Test notifica AxonOS", "NORMAL": "Test notifica AxonOS"}[u]
    body_txt = {"CRITICAL": "LED rosso, vibrazione lunga, suono: se lo senti, il canale urgenze funziona.",
                "HIGH": "Canale standard: LED blu, vibrazione breve.", "NORMAL": "Canale default AxonOS."}[u]
    fn = {"CRITICAL": send_critical_alert, "HIGH": send_standard_notif, "NORMAL": send_normal_notif}[u]
    mid = f"msg_test_{uuid.uuid4().hex[:10]}"
    await fn([user["user_id"]], title, body_txt, "/impostazioni", kind="test", idempotency_key=mid)
    return {"ok": True, "urgency": u, "channel_id": _APU_CHANNEL[u], "push_configured": _apb_configured(), "message_id": mid}


_OMNI_EXTRA_SECTIONS.append((
    "Notifiche push a livelli di urgenza", "/impostazioni",
    "Le push AxonOS hanno 3 livelli: CRITICAL (Android: canale «Avvisi urgenti» con LED rosso, vibrazione lunga 500-100-500 ms, importanza massima, "
    "bypass Non disturbare, lockscreen completo; iOS: time-sensitive + badge), HIGH (canale «Notifiche standard», LED blu, vibrazione breve) e NORMAL (canale AxonOS). "
    "Di default sono CRITICAL: ritelefonate urgenti, sveglie/timer, allerte meteo; il Master può cambiare la mappa evento→urgenza (PUT /axon/push/urgency-map). "
    "In Impostazioni → card Notifiche push ci sono «Test URGENTE (LED rosso)» e «Test standard». Su Samsung: Impostazioni → Notifiche → AxonOS → consenti, suoni/vibrazione, "
    "lockscreen «Mostra notifiche complete», Edge Lighting «Fulmine» rosso per il canale Avvisi urgenti, badge app ON. Le push funzionano solo sull'app pubblicata (build), non in Expo Go.",
))
