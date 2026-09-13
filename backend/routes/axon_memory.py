# axon_memory.py — V50.z192 — BLOCCO 9b: "Cosa sa Axon di me" (memoria visibile e controllabile dall'utente)
#
# MODULO ISOLATO. Collection `axon_user_memory`:
#   { id, user_id, section, text, source: "auto"|"manual", confidence: 0..1, evidence: str|None,
#     created_at, updated_at, edited: bool }
# Sezioni: comunicazione · clienti_chiave · scadenze_ricorrenti · stile_lavoro · argomenti · integrazioni
#
# API (solo l'utente proprietario; nessun dato di altri utenti):
#   GET    /axon/memory                → {sections:[{key,label,icon,intro,items:[...]}], stats, last_analyzed_at}
#   POST   /axon/memory/analyze        → ricalcola le voci automatiche (le voci modificate/manuali restano)
#   POST   /axon/memory                → aggiunge una voce manuale {section, text}
#   PUT    /axon/memory/{id}           → modifica testo (diventa "manual", edited=true)
#   DELETE /axon/memory/{id}           → cancella la voce (viene ricordata in `axon_user_memory_forgotten`
#                                        così l'analisi successiva NON la ripropone)
#   DELETE /axon/memory                → cancella TUTTA la memoria (+ profilo Axon Brain e memorie Neo dell'utente)
# Analisi: euristiche sui dati reali dell'utente (appuntamenti, richiamate, contatti, messaggi chat, integrazioni)
# + Claude Haiku per riformulare in linguaggio semplice preferenze e argomenti (fallback euristico se non disponibile).

from collections import Counter as _AmCounter
from zoneinfo import ZoneInfo as _AmZoneInfo

_AM_TZ = _AmZoneInfo("Europe/Rome")

_AM_SECTIONS = [
    ("comunicazione", "Preferenze di comunicazione", "chatbubble-ellipses", "Come ti piace che Axon ti risponda."),
    ("clienti_chiave", "Clienti chiave", "people", "I contatti con cui lavori più spesso."),
    ("scadenze_ricorrenti", "Scadenze ricorrenti", "calendar", "Ritmi e appuntamenti fissi che Axon ha notato."),
    ("stile_lavoro", "Stile di lavoro", "briefcase", "Come organizzi le tue giornate."),
    ("argomenti", "Argomenti frequenti", "sparkles", "Di cosa parli più spesso con Axon."),
    ("integrazioni", "Integrazioni e dati sincronizzati", "link", "Cosa è collegato al tuo AdvisorOS."),
]
_AM_MODEL = ("anthropic", "claude-haiku-4-5-20251001")
_AM_DAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]


class AmItemIn(BaseModel):
    section: str
    text: str
    sphere: Optional[str] = None  # V50.z205 — business | home (default: euristica testo)


class AmUpdateIn(BaseModel):
    text: str


def _am_dt(v) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _am_out(d: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items() if k != "_id"}


async def _am_forgotten(uid: str) -> set:
    return {d["key"] async for d in db.axon_user_memory_forgotten.find({"user_id": uid}, {"_id": 0, "key": 1})}


def _am_key(section: str, text: str) -> str:
    return section + ":" + re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()[:80]


# ------------------------------------------------------------------ euristiche
async def _am_heuristics(user: dict) -> List[dict]:
    uid = user["user_id"]
    out: List[dict] = []
    now = utcnow()
    since = now - timedelta(days=120)

    appts = await db.appointments.find({"user_id": uid}, {"_id": 0, "contact_id": 1, "start_at": 1, "created_at": 1, "is_phone": 1, "title": 1}).sort("start_at", -1).limit(400).to_list(400)
    cbs = await db.callbacks.find({"user_id": uid}, {"_id": 0, "contact_id": 1, "scheduled_at": 1, "created_at": 1}).limit(400).to_list(400)
    msgs = await db.assistant_messages.find({"user_id": uid, "role": "user"}, {"_id": 0, "content": 1, "created_at": 1}).sort("created_at", -1).limit(300).to_list(300)

    # --- clienti chiave (interazioni = appuntamenti + richiamate + note)
    cnt: _AmCounter = _AmCounter()
    for a in appts:
        if a.get("contact_id"): cnt[a["contact_id"]] += 2
    for c in cbs:
        if c.get("contact_id"): cnt[c["contact_id"]] += 1
    for cid, n in cnt.most_common(5):
        c = await db.contacts.find_one({"contact_id": cid}, {"_id": 0, "first_name": 1, "last_name": 1, "area": 1})
        if not c:
            continue
        name = f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip() or "Contatto"
        out.append({"section": "clienti_chiave", "text": f"{name} è tra i tuoi contatti più seguiti ({n} interazioni tra appuntamenti e richiamate).",
                    "confidence": min(1.0, 0.5 + n / 20), "evidence": f"{n} interazioni"})

    # --- stile di lavoro: anticipo pianificazione, telefono vs presenza, giorno preferito, fascia oraria
    leads = []
    weekdays: _AmCounter = _AmCounter(); hours: _AmCounter = _AmCounter(); phone = 0
    for a in appts:
        s, c = _am_dt(a.get("start_at")), _am_dt(a.get("created_at"))
        if s and c and s > c:
            leads.append((s - c).total_seconds() / 86400)
        if s:
            rome = s.astimezone(_AM_TZ)
            weekdays[rome.weekday()] += 1; hours[rome.hour] += 1
        if a.get("is_phone"): phone += 1
    if len(leads) >= 3:
        med = sorted(leads)[len(leads) // 2]
        out.append({"section": "stile_lavoro", "text": f"Pianifichi gli appuntamenti con circa {max(1, round(med))} giorn{'o' if round(med) == 1 else 'i'} di anticipo.", "confidence": 0.8, "evidence": f"{len(leads)} appuntamenti"})
    if appts:
        if phone / len(appts) >= 0.6:
            out.append({"section": "stile_lavoro", "text": "Lavori soprattutto al telefono: la maggior parte dei tuoi appuntamenti è una chiamata.", "confidence": 0.7, "evidence": f"{phone}/{len(appts)} telefonici"})
        elif phone / len(appts) <= 0.25:
            out.append({"section": "stile_lavoro", "text": "Preferisci gli incontri di persona: pochi appuntamenti sono telefonici.", "confidence": 0.7, "evidence": f"{phone}/{len(appts)} telefonici"})
        if weekdays:
            d, n = weekdays.most_common(1)[0]
            if n >= 3 and n / len(appts) >= 0.3:
                out.append({"section": "stile_lavoro", "text": f"Il {_AM_DAYS[d]} è il tuo giorno più pieno di appuntamenti.", "confidence": 0.65, "evidence": f"{n} appuntamenti"})
    # fascia oraria dalle chat
    act: _AmCounter = _AmCounter()
    for m in msgs:
        d = _am_dt(m.get("created_at"))
        if d and d > since:
            h = d.astimezone(_AM_TZ).hour
            act["mattina" if 6 <= h < 13 else "pomeriggio" if 13 <= h < 19 else "sera"] += 1
    if sum(act.values()) >= 8:
        band, n = act.most_common(1)[0]
        if n / sum(act.values()) >= 0.5:
            out.append({"section": "comunicazione", "text": f"Usi Axon principalmente {dict(mattina='al mattino', pomeriggio='al pomeriggio', sera='di sera')[band]}.", "confidence": 0.7, "evidence": f"{n}/{sum(act.values())} messaggi"})

    # --- scadenze ricorrenti: richiamate/appuntamenti concentrati a fine/inizio mese; titoli ricorrenti
    dom: _AmCounter = _AmCounter()
    for x in appts + cbs:
        d = _am_dt(x.get("start_at") or x.get("scheduled_at"))
        if d:
            dom["fine mese" if d.day >= 25 else "inizio mese" if d.day <= 5 else "metà mese"] += 1
    tot = sum(dom.values())
    if tot >= 8:
        k, n = dom.most_common(1)[0]
        if k != "metà mese" and n / tot >= 0.45:
            out.append({"section": "scadenze_ricorrenti", "text": f"A {k} concentri molte attività: {n} tra appuntamenti e richiamate cadono in quei giorni.", "confidence": 0.6, "evidence": f"{n}/{tot}"})
    titles: _AmCounter = _AmCounter(re.sub(r"\d+", "", (a.get("title") or "").strip().lower()) for a in appts if a.get("title"))
    for t, n in titles.most_common(3):
        if n >= 3 and len(t) >= 4:
            out.append({"section": "scadenze_ricorrenti", "text": f"«{t.capitalize()}» è un appuntamento che ripeti spesso ({n} volte).", "confidence": 0.6, "evidence": f"{n} volte"})
    gym = await db.cgym_sessions.count_documents({"user_id": uid, "mandatory": True})
    if gym:
        out.append({"section": "scadenze_ricorrenti", "text": f"Hai sessioni Corporate Gym assegnate ({gym}): Axon ti avvisa quando scadono.", "confidence": 0.9, "evidence": f"{gym} sessioni"})

    # --- integrazioni
    integ = []
    if await db.google_drive_credentials.count_documents({"user_id": uid}) or await db.google_drive_connections.count_documents({"user_id": uid}):
        integ.append("Google Drive collegato: Axon può leggere i documenti nelle cartelle che hai scelto.")
    if await db.mail_accounts.count_documents({"user_id": uid}):
        n = await db.mail_accounts.count_documents({"user_id": uid}); integ.append(f"{n} account e-mail collegat{'o' if n == 1 else 'i'} per leggere e proporre azioni CRM dalla posta.")
    if await db.homeassistant_configs.count_documents({"user_id": uid}):
        integ.append("Home Assistant collegato: puoi comandare la domotica dalla chat.")
    if user.get("push_token") or await db.users.count_documents({"user_id": uid, "push_token": {"$exists": True, "$ne": None}}):
        integ.append("Notifiche push attive su questo dispositivo.")
    if await db.quick_unlock_devices.count_documents({"user_id": uid}):
        integ.append("Accesso rapido con impronta / Face ID / PIN attivo su un dispositivo fidato.")
    if user.get("two_factor_enabled"):
        integ.append("Autenticazione a due fattori (app esterna) attiva.")
    ncont = await db.contacts.count_documents({"$or": [{"user_id": uid}, {"assigned_to_user_id": uid}]})
    integ.append(f"Dati che Axon legge in tempo reale: {ncont} contatti, {len(appts)} appuntamenti, {len(cbs)} richiamate." if ncont or appts or cbs else "Axon legge in tempo reale contatti, appuntamenti e richiamate del tuo CRM.")
    for t in integ:
        out.append({"section": "integrazioni", "text": t, "confidence": 1.0, "evidence": None})

    # --- profilo Axon Brain (già appreso) + memorie Neo
    prof = await db.axon_brain_profile.find_one({"user_id": uid}, {"_id": 0})
    if prof:
        for k, lbl in (("tone", "Ti piace un tono"), ("preferences", "Preferenze che hai indicato:"), ("specialization", "La tua specializzazione:")):
            if prof.get(k):
                out.append({"section": "comunicazione" if k != "specialization" else "argomenti", "text": f"{lbl} {str(prof[k]).strip()}.", "confidence": 0.9, "evidence": "Cervello Axon"})
    return out, msgs


async def _am_llm(user_msgs: List[str]) -> List[dict]:
    """Preferenze di comunicazione + argomenti frequenti, riformulati in linguaggio semplice."""
    if len(user_msgs) < 5:
        return []
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return []
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        sysm = ("Analizzi i messaggi che UN utente ha scritto al suo assistente AxonOS (CRM). Deduci, in italiano semplice e rassicurante, "
                "in seconda persona (\"Preferisci…\", \"Chiedi spesso…\"): (a) 2-3 preferenze di comunicazione (brevità, tono, formato liste/tabelle, voce/testo, lingua); "
                "(b) 3-5 argomenti frequenti. Frasi ≤ 110 caratteri, niente nomi di persone o cifre. "
                "Rispondi SOLO JSON: {\"comunicazione\":[\"...\"],\"argomenti\":[\"...\"]}")
        chat = LlmChat(api_key=key, session_id=f"am-{uuid.uuid4().hex[:8]}", system_message=sysm).with_model(*_AM_MODEL)
        txt = "\n".join(f"- {m[:300]}" for m in user_msgs[:120])
        resp = await chat.send_message(UserMessage(text=txt))
        data = _parse_llm_json((resp or "").strip(), fallback_key="raw")
        out = []
        for sec in ("comunicazione", "argomenti"):
            for t in (data.get(sec) or [])[:5]:
                t = str(t).strip()
                if 8 <= len(t) <= 160:
                    out.append({"section": sec, "text": t, "confidence": 0.65, "evidence": f"{len(user_msgs)} messaggi"})
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axon-memory] llm failed: %s", exc)
        return []


def _am_fallback_topics(user_msgs: List[str]) -> List[dict]:
    words: _AmCounter = _AmCounter()
    for m in user_msgs:
        for w in re.findall(r"[a-zà-ü]{5,}", m.lower()):
            if w not in _ASL_STOP and w not in ("axonos", "grazie", "vorrei", "puoi", "potresti", "fammi", "dammi"):
                words[w] += 1
    top = [w for w, n in words.most_common(6) if n >= 3]
    return [{"section": "argomenti", "text": f"Parli spesso di: {', '.join(top)}.", "confidence": 0.5, "evidence": None}] if top else []


async def _am_analyze(user: dict) -> Dict[str, int]:
    uid = user["user_id"]
    heur, msgs = await _am_heuristics(user)
    texts = [str(m.get("content") or "") for m in msgs if (m.get("content") or "").strip()]
    llm = await _am_llm(texts)
    if not llm:
        llm = _am_fallback_topics(texts)
    forgotten = await _am_forgotten(uid)
    keep_manual = await db.axon_user_memory.find({"user_id": uid, "source": "manual"}, {"_id": 0, "section": 1, "text": 1}).to_list(500)
    manual_keys = {_am_key(m["section"], m["text"]) for m in keep_manual}
    await db.axon_user_memory.delete_many({"user_id": uid, "source": "auto"})
    now = utcnow(); n = 0; seen = set()
    for it in heur + llm:
        k = _am_key(it["section"], it["text"])
        if k in forgotten or k in manual_keys or k in seen:
            continue
        seen.add(k)
        await db.axon_user_memory.insert_one({"id": uuid.uuid4().hex, "user_id": uid, "source": "auto", "edited": False, "created_at": now, "updated_at": now, **it})
        n += 1
    await db.users.update_one({"user_id": uid}, {"$set": {"axon_memory_analyzed_at": now}})
    return {"items": n}


# ------------------------------------------------------------------ API
@api_router.get("/axon/memory")
async def am_get(user=Depends(get_current_user)):
    uid = user["user_id"]
    if not await db.axon_user_memory.count_documents({"user_id": uid}) and not user.get("axon_memory_analyzed_at"):
        try:
            await _am_analyze(user)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[axon-memory] first analyze failed: %s", exc)
    items = await db.axon_user_memory.find({"user_id": uid}, {"_id": 0}).sort([("section", 1), ("confidence", -1)]).to_list(500)
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "axon_memory_analyzed_at": 1})
    secs = []
    for key, label, icon, intro in _AM_SECTIONS:
        secs.append({"key": key, "label": label, "icon": icon, "intro": intro, "items": [_am_out(i) for i in items if i.get("section") == key]})
    forgotten = await db.axon_user_memory_forgotten.count_documents({"user_id": uid})
    last = (u or {}).get("axon_memory_analyzed_at")
    return {"sections": secs, "stats": {"total": len(items), "manual": sum(1 for i in items if i.get("source") == "manual"), "forgotten": forgotten},
            "last_analyzed_at": last.isoformat() if isinstance(last, datetime) else last}


@api_router.post("/axon/memory/analyze")
async def am_analyze(user=Depends(get_current_user)):
    return await _am_analyze(user)


@api_router.post("/axon/memory")
async def am_add(body: AmItemIn, user=Depends(get_current_user)):
    if body.section not in {s[0] for s in _AM_SECTIONS}:
        raise HTTPException(status_code=400, detail="Sezione non valida")
    text = body.text.strip()
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="Testo troppo corto")
    now = utcnow()
    doc = {"id": uuid.uuid4().hex, "user_id": user["user_id"], "section": body.section, "text": text[:300], "source": "manual", "edited": True,
           "confidence": 1.0, "evidence": "Aggiunto da te", "created_at": now, "updated_at": now,
           "sphere": body.sphere if body.sphere in ("business", "home") else _ps_guess_memory_sphere(body.section, text)}
    await db.axon_user_memory.insert_one(doc)
    if body.sphere in ("business", "home"):
        await db.axon_user_memory_sphere.update_one({"user_id": user["user_id"], "key": _am_key(body.section, text)},
                                                    {"$set": {"user_id": user["user_id"], "key": _am_key(body.section, text), "sphere": body.sphere, "at": now}}, upsert=True)
    await db.axon_user_memory_forgotten.delete_one({"user_id": user["user_id"], "key": _am_key(body.section, text)})
    return _am_out(doc)


@api_router.put("/axon/memory/{item_id}")
async def am_update(item_id: str, body: AmUpdateIn, user=Depends(get_current_user)):
    text = body.text.strip()
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="Testo troppo corto")
    old = await db.axon_user_memory.find_one({"id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Voce non trovata")
    # la versione automatica precedente non deve ricomparire alla prossima analisi
    await db.axon_user_memory_forgotten.update_one({"user_id": user["user_id"], "key": _am_key(old["section"], old["text"])},
                                                   {"$set": {"user_id": user["user_id"], "key": _am_key(old["section"], old["text"]), "at": utcnow()}}, upsert=True)
    r = await db.axon_user_memory.find_one_and_update({"id": item_id, "user_id": user["user_id"]},
                                                      {"$set": {"text": text[:300], "source": "manual", "edited": True, "confidence": 1.0, "evidence": "Modificato da te", "updated_at": utcnow()}},
                                                      return_document=ReturnDocument.AFTER)
    return _am_out(r)


@api_router.delete("/axon/memory/{item_id}")
async def am_delete(item_id: str, user=Depends(get_current_user)):
    old = await db.axon_user_memory.find_one({"id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Voce non trovata")
    await db.axon_user_memory.delete_one({"id": item_id})
    await db.axon_user_memory_forgotten.update_one({"user_id": user["user_id"], "key": _am_key(old["section"], old["text"])},
                                                   {"$set": {"user_id": user["user_id"], "key": _am_key(old["section"], old["text"]), "at": utcnow()}}, upsert=True)
    return {"ok": True}


@api_router.delete("/axon/memory")
async def am_delete_all(user=Depends(get_current_user)):
    uid = user["user_id"]
    r1 = await db.axon_user_memory.delete_many({"user_id": uid})
    r2 = await db.axon_brain_profile.delete_many({"user_id": uid})
    r3 = await db.neo_memory.delete_many({"user_id": uid})
    await db.axon_user_memory_forgotten.delete_many({"user_id": uid})
    await db.users.update_one({"user_id": uid}, {"$set": {"axon_memory_analyzed_at": utcnow(), "axon_memory_cleared_at": utcnow()}})
    return {"ok": True, "deleted": r1.deleted_count, "brain_profile": r2.deleted_count, "neo_memories": r3.deleted_count}


# La memoria visibile è anche ciò che Axon usa: sezione nel contesto omnisciente (wrap non invasivo, dopo axon_self_learning)
_am_orig_omni = _build_crm_omniscience_section


async def _build_crm_omniscience_section(user: dict, msg: str) -> str:  # noqa: F811
    base = await _am_orig_omni(user, msg)
    try:
        items = await db.axon_user_memory.find({"user_id": user["user_id"]}, {"_id": 0, "section": 1, "text": 1, "sphere": 1}).limit(40).to_list(40)
        if not items:
            return base
        lab = {k: l for k, l, _, _ in _AM_SECTIONS}
        ico = {"business": "🔵", "home": "🟢"}
        lines = "\n".join(f"- {ico.get(i.get('sphere'), '')}[{lab.get(i['section'], i['section'])}] {i['text']}" for i in items)
        return f"{base}\n\n=== COSA SAI DI QUESTO UTENTE (memoria visibile in Profilo → Memoria AxonOS; rispetta le preferenze; 🔵 = sfera Business, 🟢 = sfera Home/privata: non mescolarle) ===\n{lines}"
    except Exception:
        return base
