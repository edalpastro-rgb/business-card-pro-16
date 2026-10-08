# axon_phonebook.py — V50.z469 — Feature 7/15: rubrica del telefono come fallback quando Axon non trova un nome in AdvisorOS — ISOLATO
#
# Flusso (privacy by design: la rubrica NON lascia mai il dispositivo, il backend non la vede):
# 1) Chat «numero di Mario Rossi» / «telefono di…» / «chiama…» → intercettazione DETERMINISTICA (zero LLM): cerca in `db.contacts`
#    del tenant (nome/cognome/azienda, fuzzy). Trovato → risposta con il numero. NON trovato → risposta breve + marker
#    `[[RUBRICA:Mario Rossi]]`: l'app lo intercetta, cerca nella rubrica del dispositivo (expo-contacts) e mostra il numero in chat.
# 2) Regola nel prompt: se l'LLM (percorso non deterministico) non trova una persona nei contatti CRM, chiude con lo stesso marker.
# 3) `POST /assistant/phonebook-result {session_id, name, phone, found, permission}` → l'app registra l'esito nella cronologia
#    (messaggio assistant) così Axon «ricorda» il numero nei turni successivi («chiamalo», «mandagli un WhatsApp»).
# Permesso negato / web / non trovato → fallback silenzioso: resta solo «non trovato in AdvisorOS», nessun crash, nessun popup extra.

_PB_MARK_RE = re.compile(r"\[\[RUBRICA:([^\]]{2,80})\]\]")
_PB_ASK_RE = re.compile(
    r"^\s*(?:(?:dammi|cerca|trova|trovami|dimmi|qual\s*[èe']?\s*|mi\s+dai|hai|conosci)\s+)?"
    r"(?:il\s+|lo\s+)?(?:numero|telefono|cellulare|cell|recapito|contatto)\s+(?:di\s+telefono\s+)?(?:di|del|della|dello|dell')\s+(?P<name>[A-Za-zÀ-ÿ' ]{2,60}?)\s*[?.!]*\s*$",
    re.IGNORECASE,
)
_PB_CALL_RE = re.compile(r"^\s*(?:chiama|telefona\s+a|chiamami)\s+(?P<name>[A-Za-zÀ-ÿ' ]{2,60}?)\s*[?.!]*\s*$", re.IGNORECASE)
_PB_STOP = {"me", "mio", "mia", "tuo", "tua", "casa", "ufficio", "cliente", "clienti", "lui", "lei", "loro", "questo", "quello", "oggi", "domani", "subito", "adesso"}


def _pb_phone_of(c: dict) -> Optional[str]:
    for k in ("phone_mobile", "phone", "mobile", "phone_work", "phone_home", "phone_secondary"):
        v = (c.get(k) or "").strip() if isinstance(c.get(k), str) else ""
        if v:
            return v
    for p in (c.get("phones") or []):
        v = p.get("number") if isinstance(p, dict) else p
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


async def _pb_find_contact(user: dict, name: str) -> Optional[dict]:
    toks = [t for t in re.split(r"\s+", name.strip()) if len(t) >= 2 and t.lower() not in _PB_STOP]
    if not toks:
        return None
    conds = []
    for t in toks:
        rx = {"$regex": re.escape(t), "$options": "i"}
        conds.append({"$or": [{"first_name": rx}, {"last_name": rx}, {"company": rx}, {"company_name": rx}, {"name": rx}]})
    q = {"user_id": tenant_id(user), "$and": conds} if len(conds) > 1 else {"user_id": tenant_id(user), **conds[0]}
    c = await db.contacts.find_one(q, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "company_name": 1, "phone": 1, "phone_mobile": 1, "mobile": 1, "phone_work": 1, "phones": 1})
    return c


_pb_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").split("\n\nISTRUZIONI OPERATIVE", 1)[0].strip()
    try:
        if txt and len(txt) <= 120:
            m = _PB_ASK_RE.match(txt) or _PB_CALL_RE.match(txt)
            if m:
                name = re.sub(r"\s+", " ", m.group("name")).strip(" '")
                if name and name.lower() not in _PB_STOP:
                    c = await _pb_find_contact(user, name)
                    if c:
                        full = " ".join(x for x in (c.get("first_name"), c.get("last_name")) if x).strip() or c.get("company") or c.get("company_name") or name
                        ph = _pb_phone_of(c)
                        if ph:
                            return {"reply": f"📇 {full}: {ph}", "cmd": "phonebook_crm"}
                        return {"reply": f"📇 {full} è in AdvisorOS ma non ha un numero salvato. Controllo la rubrica del telefono… [[RUBRICA:{full}]]", "cmd": "phonebook_device"}
                    return {"reply": f"Non trovo «{name.title()}» tra i contatti di AdvisorOS. Controllo la rubrica del telefono… [[RUBRICA:{name.title()}]]", "cmd": "phonebook_device"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[phonebook] intercept failed: %s", exc)
    return await _pb_prev_maybe_push_command(msg, user)


_PB_PROMPT_RULE = (
    "📱 RUBRICA DEL TELEFONO (fallback): se l'utente chiede il numero/recapito di una PERSONA che NON compare nei contatti CRM del contesto, "
    "rispondi in UNA frase («Non lo trovo in AdvisorOS, controllo la rubrica del telefono…») e chiudi il messaggio con il marker ESATTO "
    "[[RUBRICA:Nome Cognome]] (nome come scritto dall'utente). L'app cercherà nella rubrica del dispositivo e mostrerà il numero: tu NON inventare numeri. "
    "Se il contatto È nel CRM, dai il numero del CRM e NON usare il marker."
)
_pb_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _pb_prev_prepare_prompt(user, body)
    try:
        if isinstance(prep, dict) and prep.get("query_class") != "simple" and prep.get("system_message"):
            msg = (getattr(body, "message", "") or "").lower()
            if re.search(r"\b(numero|telefono|cellulare|recapito|chiama|telefona|whatsapp|contatt)", msg):
                prep["system_message"] += "\n\n" + _PB_PROMPT_RULE
    except Exception as exc:  # noqa: BLE001
        logger.warning("[phonebook] prompt failed: %s", exc)
    return prep


class PhonebookResultIn(BaseModel):
    session_id: Optional[str] = None
    name: str
    phone: Optional[str] = None
    found: bool = False
    permission: str = "granted"  # granted | denied | unavailable


@api_router.post("/assistant/phonebook-result")
async def phonebook_result(body: PhonebookResultIn, user=Depends(get_current_user)):
    """L'app registra l'esito della ricerca in rubrica nella cronologia chat (così Axon ricorda il numero nei turni successivi)."""
    name = re.sub(r"\s+", " ", body.name or "").strip()[:80]
    phone = re.sub(r"[^\d+ ]", "", body.phone or "").strip()[:32] if body.phone else None
    if body.found and phone:
        content = f"📱 Trovato nella rubrica del telefono: **{name}** · {phone}"
    elif body.permission == "denied":
        content = f"Non ho trovato «{name}» in AdvisorOS (accesso alla rubrica del telefono non consentito: puoi attivarlo da Impostazioni › Permessi)."
    elif body.permission == "unavailable":
        content = f"Non ho trovato «{name}» in AdvisorOS."
    else:
        content = f"Non ho trovato «{name}» né in AdvisorOS né nella rubrica del telefono."
    sid = (body.session_id or "").strip()[:64] or None
    mid = uuid.uuid4().hex[:16]
    await db.assistant_messages.insert_one({"message_id": mid, "user_id": user["user_id"], "session_id": sid, "role": "assistant", "content": content, "created_at": utcnow(), "source": "phonebook"})
    return {"ok": True, "content": content, "message_id": mid}


_OMNI_EXTRA_SECTIONS.append((
    "Rubrica del telefono (fallback contatti)", "/assistant/phonebook-result",
    "Se l'utente chiede il numero di una persona che non è in AdvisorOS, Axon lo cerca nella rubrica del telefono (solo app mobile, con permesso Contatti; "
    "la rubrica non viene mai inviata al server). Permesso negato → si può attivare da Impostazioni › Permessi; su web la ricerca in rubrica non è disponibile.",
))
