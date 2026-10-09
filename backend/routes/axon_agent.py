# axon_agent.py — V50.z458 — PROMPT 19: AGENTI AUTONOMI MULTI-STEP.
# Un solo comando (testo o voce) → Axon lo scompone in azioni, le esegue IN SEQUENZA verificando ogni esito, e riporta un
# riepilogo. Se un'azione fallisce si FERMA, avvisa e chiede come procedere («salta» / «riprova» / «annulla»).
# Azioni: create_appointment, update_appointment, update_contact_status (trattativa), send_whatsapp (wa.me precompilato, tap
# dell'utente), send_email (precompilata, inviata via Resend al tap «Invia email»), create_callback, create_reminder.
# Agganci: (1) stream chat — `_maybe_agent_command` PRIMA di push/alarm in 22_axon_alarm_commit_teach.py;
#          (2) voce hands-free — stesso `_maybe_agent_command` in /voice/copilot/execute (12_ai_contact_copilot.py);
#          (3) tap sui chip — `_agent_nav_action` da /axon/nav/action (axon_navigator.py).
import json as _ag_json
import re as _ag_re
import uuid as _ag_uuid
import zoneinfo as _ag_zi
from datetime import datetime as _ag_dt, timedelta as _ag_td, timezone as _ag_tz
from typing import Any as _ag_Any, Dict as _ag_Dict, List as _ag_List, Optional as _ag_Optional
from urllib.parse import quote as _ag_quote

_AG_ROME = _ag_zi.ZoneInfo("Europe/Rome")
_AG_ACTIONS = ("create_appointment", "update_appointment", "update_contact_status", "send_whatsapp", "send_email", "create_callback", "create_reminder", "create_contact", "add_note",
               "update_contact", "delete_contact", "delete_appointment", "update_callback", "delete_callback", "call_contact")  # V50.z499/z502 — + modifica/cancella
_AG_STATUS_IT = {"client": "Cliente", "prospect": "Prospect", "collaborator": "Collaboratore"}

# Verbi/oggetti che indicano un'azione eseguibile; serve ≥2 azioni distinte + un connettore per attivare l'agente.
_AG_VERB_RX = _ag_re.compile(
    r"\b(chiud\w*\s+(la\s+)?trattativ\w*|trattativ\w*\s+(chius\w*|vint\w*|pers\w*)|segna\w*\s+(come\s+)?(cliente|chius\w*|vint\w*|pers\w*|prospect)|"
    r"(aggiorn\w*|cambi\w*|imposta\w*|metti\w*)\s+(lo\s+)?stato|diventa\w*\s+cliente|convert\w*\s+in\s+cliente|"
    r"fiss\w*\s+(un\s+|l')?appuntament\w*|(crea|aggiungi|metti|prenota|programma)\w*\s+(un\s+|l')?appuntament\w*|appuntament\w*\s+(con|per)|"
    r"(spost\w*|rimand\w*|anticip\w*|posticip\w*)\s+(l'|il\s+|lo\s+)?appuntament\w*|"
    r"(mand\w*|invi\w*|scriv\w*|gir\w*)\w*\s+(gli|le|un|una|il|la|lo|al|allo|alla)?\s*(whatsapp|messaggio|mail|e-?mail|preventivo|offerta|riepilogo|conferma|promemoria)|"
    r"(mand\w*|invi\w*)(gli|le|ci)\s+(il|un|la|una|lo)\s+\w+|whatsapp|e-?mail\s+(a|per)|"
    r"(crea|imposta|metti|aggiungi|segna)\w*\s+(un\s+|una\s+|il\s+|la\s+)?(promemoria|richiamat\w*|ritelefonat\w*|reminder|callback)|"
    r"ricorda(mi|ti)?\s+di|richiama\w*|ritelefona\w*|promemoria\s+per|"
    r"(crea|aggiungi|inserisci|registra|salva|nuovo)\w*\s+(un\s+|il\s+|nuovo\s+)?(contatto|cliente|prospect|lead)|"
    r"(aggiungi|scrivi|metti|salva|inserisci|crea)\w*\s+(una\s+|la\s+|questa\s+)?nota|nota\s+(su|per|a)\s|"
    r"(cancell\w*|elimin\w*|annull\w*|rimuov\w*|disdic\w*)\s+(l'|il\s+|la\s+|lo\s+|gli\s+|le\s+|quel\w*\s+|tutt\w*\s+)?(appuntament\w*|richiamat\w*|ritelefonat\w*|callback|contatt\w*|client\w*)|"
    r"(modific\w*|aggiorn\w*|cambi\w*|correggi\w*|sostituisc\w*)\s+(il\s+|la\s+|l'|lo\s+)?(numero|telefono|cellulare|email|mail|indirizzo|città|nome|cognome|contatt\w*|azienda)|"
    r"(spost\w*|rimand\w*|anticip\w*|posticip\w*|riprogramm\w*)\s+(la\s+|il\s+)?(richiamat\w*|ritelefonat\w*|callback)|chiam\w*\s+(il\s+|la\s+|lo\s+)?[A-ZÀ-Ý]?\w+|telefon\w*\s+a\s)\b", _ag_re.I)  # V50.z499/z502
_AG_CONNECTOR_RX = _ag_re.compile(r"\b(e|ed|poi|dopo|quindi|inoltre|infine|successivamente)\b|[,;]")
_AG_RESUME_RX = {
    "skip": _ag_re.compile(r"^\s*(salta\w*|skip|vai avanti|continua|procedi|prosegui|passa (alla|oltre)|avanti)\b", _ag_re.I),
    "retry": _ag_re.compile(r"^\s*(riprova\w*|ritenta\w*|retry|rifai|riprovaci)\b", _ag_re.I),
    "cancel": _ag_re.compile(r"^\s*(annulla\w*|cancella tutto|stop|basta|lascia (stare|perdere)|ferma\w*|interrompi)\b", _ag_re.I),
}


def _agent_looks_multistep(msg: str) -> bool:
    t = (msg or "").strip()
    if not t or len(t) > 700 or "?" in t[-3:]:
        return False
    hits = {m.group(0).lower()[:14] for m in _AG_VERB_RX.finditer(t)}
    if len(hits) >= 2 and bool(_AG_CONNECTOR_RX.search(t)):
        return True
    # V50.z499 — BUG STRUTTURALE: un comando con UNA sola azione («crea un appuntamento con Rossi domani alle 10», «programma una
    # richiamata a Zanini lunedì», «crea contatto Mario Rossi», «aggiungi nota su Rossi…») non entrava nell'agente e finiva all'LLM
    # conversazionale, che rispondeva «Fatto» senza scrivere nulla. Ora basta un verbo d'azione in forma imperativa.
    return len(hits) >= 1 and bool(_ag_re.match(r"^\s*(axon[,!]?\s+)?(per favore\s+)?(crea|fissa|prenota|programma|imposta|metti|aggiungi|inserisci|registra|salva|segna|scrivi|manda|invia|ricorda|richiama|ritelefona|sposta|rimanda|anticipa|posticipa|riprogramma|chiudi|aggiorna|cambia|converti|nuovo|nuova|cancella|elimina|annulla|rimuovi|disdici|modifica|correggi|sostituisci|chiama|telefona)\w*\b", t, _ag_re.I))


# ---- pianificazione (LLM) ------------------------------------------------------------------------------------------------
async def _agent_contact_names(user: dict, limit: int = 60) -> _ag_List[str]:
    try:
        q = await _omni_contact_query(user)  # noqa: F821
        out = []
        async for c in db.contacts.find(q, {"_id": 0, "first_name": 1, "last_name": 1, "company": 1}).sort("updated_at", -1).limit(limit):  # noqa: F821
            n = f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip()
            if c.get("company"):
                n = f"{n} ({c['company']})" if n else c["company"]
            if n:
                out.append(n)
        return out
    except Exception:  # noqa: BLE001
        return []


async def _agent_plan(msg: str, user: dict) -> _ag_Optional[dict]:
    key = os.environ.get("EMERGENT_LLM_KEY")  # noqa: F821
    if not key:
        return None
    now = utcnow().astimezone(_AG_ROME)  # noqa: F821
    names = await _agent_contact_names(user)
    uname = (user.get("name") or "").strip()
    system = (
        "Sei il PIANIFICATORE di Axon, assistente di un CRM italiano per consulenti. Scomponi UN comando complesso (anche da trascrizione "
        "vocale, con possibili errori) in una SEQUENZA ordinata di azioni eseguibili. Rispondi SOLO con JSON valido, senza testo attorno.\n"
        "AZIONI AMMESSE e parametri:\n"
        "- update_contact_status: {status: 'client'|'prospect'|'collaborator', note: str} — «chiudi la trattativa», «segna come cliente», «è diventato cliente» → status 'client', note 'Trattativa chiusa'; «trattativa persa» → status 'prospect', note 'Trattativa persa'.\n"
        "- create_appointment: {title: str, start_at: 'YYYY-MM-DDTHH:MM' (ora locale Europe/Rome), duration_min: int (default 60), location: str, is_phone: bool}\n"
        "- update_appointment: {new_start_at: 'YYYY-MM-DDTHH:MM', match: str|null (parola del titolo se indicata)} — «sposta l'appuntamento con X a venerdì alle 15».\n"
        "- send_whatsapp: {message: str} — testo completo pronto da inviare, in italiano, cordiale, firmato con il nome del consulente se noto.\n"
        "- send_email: {subject: str, body: str} — email completa (saluto, corpo, firma). «mandagli il preventivo» → email che accompagna il preventivo (dì che è allegato/segue), NON inventare cifre.\n"
        "- create_callback: {scheduled_at: 'YYYY-MM-DDTHH:MM', title: str, note: str} — «richiamalo tra 30 giorni», «ritelefonata». Senza orario usa 10:00.\n"
        "- create_reminder: {label: str (max 60), trigger_at: 'YYYY-MM-DDTHH:MM'} — «ricordami di…», «promemoria per…» NON legato a una telefonata al cliente. Se il promemoria è per RICHIAMARE un cliente usa create_callback.\n"
        "- create_contact: {first_name: str, last_name: str, phone: str, email: str, city: str, company: str, area: 'energy'|'network'} — «crea contatto Mario Rossi 333 1234567 Milano»; 'contact' = null (il contatto NON esiste ancora).\n"
        "- add_note: {text: str} — «aggiungi nota su Rossi: vuole il preventivo» → 'contact' = Rossi, text = il contenuto della nota (senza il nome).\n"
        "- update_contact: {phone?: str, email?: str, city?: str, company?: str, first_name?: str, last_name?: str, address?: str} — «cambia il numero di Rossi in 333…», «aggiorna l'email di Bianchi». Solo i campi detti.\n"
        "- delete_contact: {} — «elimina il contatto Rossi», «cancella Bianchi dalla rubrica».\n"
        "- delete_appointment: {match: str|null (parola del titolo), day: 'YYYY-MM-DD'|null} — «cancella l'appuntamento con Rossi (di domani)».\n"
        "- update_callback: {new_scheduled_at: 'YYYY-MM-DDTHH:MM'} — «sposta la richiamata di Rossi a venerdì alle 15», «rimanda la ritelefonata di Bianchi a lunedì».\n"
        "- delete_callback: {} — «cancella la richiamata di Rossi», «annulla la ritelefonata a Bianchi».\n"
        "- call_contact: {} — «chiama Rossi», «telefona a Bianchi» → avvia la telefonata (il telefono compone il numero).\n"
        "REGOLE: mantieni l'ordine indicato dall'utente; ogni azione che riguarda una persona ha 'contact' = nome come lo ha detto l'utente "
        "(risolvi su un nome dell'elenco CRM se evidente, es. «Mario» → «Mario Rossi» se è l'unico Mario); date relative calcolate dall'ORA ATTUALE; "
        "orari sempre nel futuro; nessuna azione fuori elenco (se l'utente chiede altro, mettila in 'unsupported'). Se manca un dato "
        "indispensabile (es. quale cliente) e non è deducibile, compila 'clarify' con UNA domanda e lascia steps vuoto."
    )
    prompt = (
        f"ORA ATTUALE (Europe/Rome): {now.strftime('%Y-%m-%d %H:%M')} ({['lunedì','martedì','mercoledì','giovedì','venerdì','sabato','domenica'][now.weekday()]})\n"
        f"CONSULENTE: {uname or 'n.d.'}\n"
        f"CONTATTI CRM (nomi): {', '.join(names) if names else '(nessuno)'}\n\n"
        f"COMANDO: «{msg.strip()}»\n\n"
        'Rispondi con: {"steps": [{"action": "...", "contact": "Nome Cognome"|null, "label": "descrizione breve in italiano (max 70 caratteri)", "params": {...}}], '
        '"unsupported": ["richiesta non eseguibile"...], "clarify": null|"domanda"}'
    )
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=key, session_id=f"agent-plan-{_ag_uuid.uuid4().hex[:8]}", system_message=system).with_model("anthropic", "claude-sonnet-4-5")
        r = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=40)  # noqa: F821
        txt = (r or "").strip()
        if txt.startswith("```"):
            txt = _ag_re.sub(r"^```(?:json)?\n?|\n?```$", "", txt).strip()
        plan = _ag_json.loads(txt)
        steps = [s for s in (plan.get("steps") or []) if isinstance(s, dict) and s.get("action") in _AG_ACTIONS][:8]
        plan["steps"] = steps
        return plan
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axon-agent] plan failed: %s", exc)  # noqa: F821
        return None


# ---- esecuzione -----------------------------------------------------------------------------------------------------------
def _ag_cname(c: dict) -> str:
    n = f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip()
    return n or (c.get("company") or "il contatto")


def _ag_local(s: str) -> _ag_Optional[_ag_dt]:
    try:
        d = _ag_dt.fromisoformat((s or "").strip())
        return d.replace(tzinfo=_AG_ROME) if d.tzinfo is None else d
    except Exception:  # noqa: BLE001
        return None


def _ag_fmt(d: _ag_dt) -> str:
    return d.astimezone(_AG_ROME).strftime("%d/%m/%Y alle %H:%M")


def _ag_phone(c: dict) -> _ag_Optional[str]:
    cands = [c.get("phone"), c.get("phone_alt")] + [p.get("number") for p in (c.get("phones") or []) if isinstance(p, dict)]
    for raw in cands:
        digits = _ag_re.sub(r"\D", "", str(raw or ""))
        if digits.startswith("00"):
            digits = digits[2:]
        if len(digits) in (9, 10) and digits[0] in "03":
            digits = "39" + digits
        if 10 <= len(digits) <= 15:
            return digits
    return None


class _AgentStepError(Exception):
    pass


async def _agent_exec_step(user: dict, step: dict, contact: _ag_Optional[dict]) -> _ag_Dict[str, _ag_Any]:
    """Esegue UNA azione e ne VERIFICA l'esito. Ritorna {"text": riga di riepilogo, "chip": marker|None}. Solleva _AgentStepError."""
    action = step["action"]
    p = step.get("params") or {}
    tid = tenant_id(user)  # noqa: F821
    now = utcnow()  # noqa: F821
    cname = _ag_cname(contact) if contact else None

    if action == "update_contact_status":
        if not contact:
            raise _AgentStepError("non ho capito a quale contatto si riferisce")
        status = p.get("status") if p.get("status") in _AG_STATUS_IT else "client"
        note = (p.get("note") or "").strip()
        await db.contacts.update_one({"contact_id": contact["contact_id"], "user_id": tid}, {"$set": {"status": status, "updated_at": now}})  # noqa: F821
        chk = await db.contacts.find_one({"contact_id": contact["contact_id"], "user_id": tid}, {"_id": 0, "status": 1})  # noqa: F821
        if not chk or chk.get("status") != status:
            raise _AgentStepError("l'aggiornamento dello stato non risulta salvato")
        if note:  # nota visibile nel tab «Note» della scheda (array contacts.notes, formato ContactNote)
            await db.contacts.update_one({"contact_id": contact["contact_id"], "user_id": tid}, {"$push": {"notes": {  # noqa: F821
                "id": str(_ag_uuid.uuid4()), "kind": "text", "category": "general", "text": f"{note} (Axon, {now.astimezone(_AG_ROME).strftime('%d/%m/%Y')})",
                "created_at": now, "source": "axon_agent", "created_by": user["user_id"]}}})
        return {"text": f"{note or 'Stato aggiornato'} per {cname}: stato → **{_AG_STATUS_IT[status]}**", "chip": None}

    if action == "create_contact":
        fn = (p.get("first_name") or "").strip(); ln = (p.get("last_name") or "").strip()
        if not fn and not ln:
            raise _AgentStepError("manca il nome del nuovo contatto")
        # V50.z499 — STESSA funzione del form «Nuovo contatto» (07_contacts.create_contact): contact_id, contact_code, created_by, dedup…
        created = await create_contact(ContactIn(  # noqa: F821
            first_name=fn or ln, last_name=ln if fn else "", phone=(p.get("phone") or "").strip(), email=(p.get("email") or "").strip(),
            address_city=(p.get("city") or "").strip(), company=(p.get("company") or "").strip(),
            area=p.get("area") if p.get("area") in ("energy", "network") else "energy",
        ), user)
        if not await db.contacts.find_one({"contact_id": created["contact_id"]}, {"_id": 0, "contact_id": 1}):  # noqa: F821
            raise _AgentStepError("il contatto non risulta salvato")
        return {"text": f"Nuovo contatto **{fn} {ln}**".strip() + (f" · {p.get('phone')}" if p.get("phone") else "") + f" [[NAV:/contact/{created['contact_id']}|Apri scheda]]", "chip": None}

    if action == "add_note":
        if not contact:
            raise _AgentStepError("non ho capito a quale contatto aggiungere la nota")
        text = (p.get("text") or "").strip()
        if not text:
            raise _AgentStepError("manca il testo della nota")
        # V50.z499 — STESSA funzione della scheda (07_contacts.add_note → contacts.notes[])
        bg = BackgroundTasks()  # noqa: F821
        note = await add_note(contact["contact_id"], ContactNote(kind="text", text=text), bg, user)  # noqa: F821
        for t in bg.tasks:
            try:
                asyncio.create_task(t()) if asyncio.iscoroutinefunction(t.func) else t.func(*t.args, **t.kwargs)  # noqa: F821
            except Exception:  # noqa: BLE001
                pass
        chk = await db.contacts.find_one({"contact_id": contact["contact_id"], "notes.id": note.get("id")}, {"_id": 0, "contact_id": 1})  # noqa: F821
        if not chk:
            raise _AgentStepError("la nota non risulta salvata")
        return {"text": f"Nota aggiunta a {cname}: «{text[:90]}»", "chip": None}

    if action == "update_contact":
        if not contact:
            raise _AgentStepError("non ho capito quale contatto modificare")
        fields = {}
        for k_src, k_dst in (("phone", "phone"), ("email", "email"), ("city", "address_city"), ("company", "company"), ("first_name", "first_name"), ("last_name", "last_name"), ("address", "address")):
            v = (p.get(k_src) or "").strip() if isinstance(p.get(k_src), str) else None
            if v:
                fields[k_dst] = v
        if not fields:
            raise _AgentStepError("non ho capito cosa modificare (numero, email, città, azienda, nome…)")
        # V50.z502 — STESSA funzione del form «Modifica contatto» (07_contacts.update_contact)
        await update_contact(contact["contact_id"], ContactUpdate(**fields), user)  # noqa: F821
        chk = await db.contacts.find_one({"contact_id": contact["contact_id"]}, {"_id": 0, **{k: 1 for k in fields}})  # noqa: F821
        if not chk or any((chk.get(k) or "") != v for k, v in fields.items()):
            raise _AgentStepError("la modifica non risulta salvata")
        return {"text": f"Contatto {cname} aggiornato: " + ", ".join(f"{k.replace('address_city', 'città')} → {v}" for k, v in fields.items()) + f" [[NAV:/contact/{contact['contact_id']}|Apri scheda]]", "chip": None}

    if action == "delete_contact":
        if not contact:
            raise _AgentStepError("non ho capito quale contatto eliminare")
        await delete_contact(contact["contact_id"], user)  # noqa: F821 — stessa funzione del cestino della scheda
        if await db.contacts.find_one({"contact_id": contact["contact_id"]}, {"_id": 0, "contact_id": 1}):  # noqa: F821
            raise _AgentStepError("il contatto risulta ancora presente")
        return {"text": f"Contatto **{cname}** eliminato", "chip": None}

    if action == "delete_appointment":
        if not contact:
            raise _AgentStepError("non ho capito di quale cliente è l'appuntamento")
        q = {"contact_id": contact["contact_id"], "user_id": tid, "done": {"$ne": True}}
        day = (p.get("day") or "").strip()
        if day:
            try:
                d0 = _ag_dt.strptime(day[:10], "%Y-%m-%d").replace(tzinfo=_AG_ROME)
                q["start_at"] = {"$gte": d0.astimezone(_ag_tz.utc), "$lt": (d0 + _ag_td(days=1)).astimezone(_ag_tz.utc)}
            except Exception:  # noqa: BLE001
                pass
        match = (p.get("match") or "").strip()
        if match:
            q["title"] = {"$regex": _ag_re.escape(match), "$options": "i"}
        appts = await db.appointments.find(q, {"_id": 0, "appointment_id": 1, "title": 1, "start_at": 1}).sort("start_at", 1).to_list(5)  # noqa: F821
        if not appts and (match or day):  # il filtro (titolo/giorno) suggerito dall'LLM era troppo stretto → solo per cliente
            q.pop("title", None); q.pop("start_at", None)
            appts = await db.appointments.find(q, {"_id": 0, "appointment_id": 1, "title": 1, "start_at": 1}).sort("start_at", 1).to_list(5)  # noqa: F821
        if not appts:
            raise _AgentStepError(f"non trovo appuntamenti aperti con {cname}")
        if len(appts) > 1:
            raise _AgentStepError(f"{cname} ha {len(appts)} appuntamenti: dimmi quale (giorno o titolo)")
        a = appts[0]
        await delete_appointment(a["appointment_id"], user)  # noqa: F821 — stessa funzione del calendario
        if await db.appointments.find_one({"appointment_id": a["appointment_id"]}, {"_id": 0, "appointment_id": 1}):  # noqa: F821
            raise _AgentStepError("l'appuntamento risulta ancora presente")
        return {"text": f"Appuntamento «{a.get('title')}» con {cname} cancellato", "chip": None}

    if action in ("update_callback", "delete_callback"):
        if not contact:
            raise _AgentStepError("non ho capito di quale cliente è la richiamata")
        cbs = await db.callbacks.find({"contact_id": contact["contact_id"], "user_id": tid, "done": {"$ne": True}}, {"_id": 0, "callback_id": 1, "title": 1, "scheduled_at": 1}).sort("scheduled_at", 1).to_list(5)  # noqa: F821
        if not cbs:
            raise _AgentStepError(f"non trovo richiamate aperte per {cname}")
        cb = cbs[0]
        if action == "delete_callback":
            await delete_callback(cb["callback_id"], user)  # noqa: F821 — stessa funzione del cestino
            if await db.callbacks.find_one({"callback_id": cb["callback_id"]}, {"_id": 0, "callback_id": 1}):  # noqa: F821
                raise _AgentStepError("la richiamata risulta ancora presente")
            return {"text": f"Richiamata a {cname} cancellata" + (f" (ne restano {len(cbs) - 1})" if len(cbs) > 1 else ""), "chip": None}
        when = _ag_local(p.get("new_scheduled_at"))
        if not when:
            raise _AgentStepError("manca la nuova data della richiamata")
        if when <= now.astimezone(_AG_ROME):
            raise _AgentStepError(f"la data indicata ({_ag_fmt(when)}) è già passata")
        await update_callback(cb["callback_id"], CallbackUpdate(scheduled_at=when.astimezone(_ag_tz.utc)), user)  # noqa: F821 — stessa funzione del form
        chk = await db.callbacks.find_one({"callback_id": cb["callback_id"]}, {"_id": 0, "scheduled_at": 1})  # noqa: F821
        if not chk:
            raise _AgentStepError("la modifica non risulta salvata")
        return {"text": f"Richiamata a {cname} spostata a **{_ag_fmt(when)}**", "chip": None}

    if action == "call_contact":
        if not contact:
            raise _AgentStepError("non ho capito chi chiamare")
        num = (contact.get("phone") or contact.get("phone_alt") or "").strip()
        if not num:
            raise _AgentStepError(f"{cname} non ha un numero di telefono in scheda")
        tel = _ag_re.sub(r"[^\d+]", "", num)
        return {"text": f"Chiamo {cname} al {num} [[NAV:tel:{tel}|📞 Chiama {cname}]]", "chip": None, "call": {"phone": num, "tel": tel, "contact_name": cname, "contact_id": contact["contact_id"]}}

    if action == "create_appointment":
        start = _ag_local(p.get("start_at"))
        if not start:
            raise _AgentStepError("manca la data/ora dell'appuntamento")
        if start <= now.astimezone(_AG_ROME):
            raise _AgentStepError(f"la data indicata ({_ag_fmt(start)}) è già passata")
        dur = int(p.get("duration_min") or 60)
        title = (p.get("title") or "").strip() or (f"Appuntamento con {cname}" if cname else "Appuntamento")
        # V50.z499 — STESSA funzione del form «Nuovo appuntamento» (08_calendar.create_appointment): id, created_by, broadcast, indirizzo…
        created = await create_appointment(AppointmentIn(  # noqa: F821
            contact_id=contact["contact_id"] if contact else None, title=title, area=(contact or {}).get("area") if (contact or {}).get("area") in ("energy", "network") else "energy",
            start_at=start.astimezone(_ag_tz.utc), end_at=(start + _ag_td(minutes=dur)).astimezone(_ag_tz.utc), duration_min=dur, is_phone=bool(p.get("is_phone")),
            phone_mobile=(contact or {}).get("phone") or "", email=(contact or {}).get("email") or "", location=(p.get("location") or "").strip(),
            full_address=(p.get("location") or "").strip() or (contact or {}).get("address") or "", notes=(p.get("note") or "").strip(),
        ), user)
        aid = created["appointment_id"]
        if not await db.appointments.find_one({"appointment_id": aid}, {"_id": 0, "appointment_id": 1}):  # noqa: F821
            raise _AgentStepError("l'appuntamento non risulta salvato")
        return {"text": f"Appuntamento «{title}» il {_ag_fmt(start)}" + (f" ({doc['location']})" if doc["location"] else ""), "chip": None}

    if action == "update_appointment":
        new_start = _ag_local(p.get("new_start_at"))
        if not new_start:
            raise _AgentStepError("manca la nuova data/ora")
        q = _omni_own(user, {"done": False})  # noqa: F821
        if contact:
            q["contact_id"] = contact["contact_id"]
        if p.get("match"):
            q["title"] = {"$regex": _ag_re.escape(str(p["match"])), "$options": "i"}
        appt = await db.appointments.find_one(q, {"_id": 0}, sort=[("start_at", 1)])  # noqa: F821
        if not appt:
            raise _AgentStepError(f"non ho trovato un appuntamento da spostare{' con ' + cname if cname else ''}")
        dur = int(appt.get("duration_min") or 60)
        await db.appointments.update_one({"appointment_id": appt["appointment_id"]},  # noqa: F821
                                         {"$set": {"start_at": new_start.astimezone(_ag_tz.utc), "end_at": (new_start + _ag_td(minutes=dur)).astimezone(_ag_tz.utc), "updated_at": now}})
        chk = await db.appointments.find_one({"appointment_id": appt["appointment_id"]}, {"_id": 0, "start_at": 1})  # noqa: F821
        chk_dt = chk.get("start_at") if chk else None
        if not chk_dt or abs(((chk_dt.replace(tzinfo=_ag_tz.utc) if chk_dt.tzinfo is None else chk_dt) - new_start).total_seconds()) > 60:
            raise _AgentStepError("lo spostamento non risulta salvato")
        return {"text": f"Appuntamento «{appt.get('title')}» spostato al {_ag_fmt(new_start)}", "chip": None}

    if action == "send_whatsapp":
        if not contact:
            raise _AgentStepError("non ho capito a quale contatto inviare il messaggio")
        phone = _ag_phone(contact)
        if not phone:
            raise _AgentStepError(f"{cname} non ha un numero di telefono in scheda")
        message = (p.get("message") or "").strip()
        if not message:
            raise _AgentStepError("non sono riuscito a preparare il testo del messaggio")
        url = f"https://wa.me/{phone}?text={_ag_quote(message)}"
        chip = f"[[ACTION:open_whatsapp|💬 Apri WhatsApp per {cname}|{_ag_json.dumps({'url': url, 'contact_id': contact['contact_id']}, ensure_ascii=False)}]]"
        return {"text": f"Messaggio WhatsApp per {cname} pronto — tocca «Apri WhatsApp» qui sotto per inviarlo", "chip": chip, "preview": message}

    if action == "send_email":
        if not contact:
            raise _AgentStepError("non ho capito a quale contatto inviare l'email")
        to = (contact.get("email") or contact.get("email_alt") or "").strip()
        if not to or "@" not in to:
            raise _AgentStepError(f"{cname} non ha un indirizzo email in scheda")
        subject = (p.get("subject") or "").strip() or "Informazioni"
        body_txt = (p.get("body") or "").strip()
        if not body_txt:
            raise _AgentStepError("non sono riuscito a preparare il testo dell'email")
        payload = {"contact_id": contact["contact_id"], "to": to, "subject": subject, "body": body_txt}
        chip = f"[[ACTION:send_email|✉️ Invia email a {cname}|{_ag_json.dumps(payload, ensure_ascii=False)}]]"
        return {"text": f"Email «{subject}» per {cname} ({to}) pronta — tocca «Invia email» qui sotto per spedirla", "chip": chip, "preview": body_txt}

    if action == "create_callback":
        when = _ag_local(p.get("scheduled_at"))
        if not when:
            raise _AgentStepError("manca la data della richiamata")
        if when <= now.astimezone(_AG_ROME):
            raise _AgentStepError(f"la data indicata ({_ag_fmt(when)}) è già passata")
        title = (p.get("title") or "").strip() or (f"Richiamare {cname}" if cname else "Richiamata")
        # V50.z499 — STESSA funzione del form «Nuova ritelefonata» (09_callbacks.create_callback)
        created = await create_callback(CallbackIn(  # noqa: F821
            contact_id=contact["contact_id"] if contact else None, title=title, area=(contact or {}).get("area") if (contact or {}).get("area") in ("energy", "network") else "energy",
            scheduled_at=when.astimezone(_ag_tz.utc), note=(p.get("note") or "").strip(), phone=(contact or {}).get("phone") or None,
        ), user)
        cbid = created["callback_id"]
        if not await db.callbacks.find_one({"callback_id": cbid}, {"_id": 0, "callback_id": 1}):  # noqa: F821
            raise _AgentStepError("la richiamata non risulta salvata")
        return {"text": f"Richiamata «{title}» il {_ag_fmt(when)}", "chip": None}

    if action == "create_reminder":
        when = _ag_local(p.get("trigger_at"))
        if not when:
            raise _AgentStepError("manca la data/ora del promemoria")
        if when <= now.astimezone(_AG_ROME) + _ag_td(seconds=30):
            raise _AgentStepError(f"l'orario indicato ({_ag_fmt(when)}) è già passato")
        label = (p.get("label") or "Promemoria").strip()[:60]
        doc = await _create_axon_alarm_doc(user, {"kind": "reminder", "label": label, "trigger_at": when.astimezone(_ag_tz.utc).isoformat()})  # noqa: F821
        if not doc or not doc.get("id"):
            raise _AgentStepError("il promemoria non risulta salvato")
        return {"text": f"Promemoria «{label}» per il {_ag_fmt(when)}", "chip": None}

    raise _AgentStepError("azione non supportata")


def _agent_report(run: dict) -> str:
    steps = run["steps"]
    n = len(steps)
    done_n = sum(1 for s in steps if s.get("status") == "done")
    failed_idx = next((i for i, s in enumerate(steps) if s.get("status") == "failed"), None)
    lines: _ag_List[str] = []
    if run.get("status") == "cancelled":
        lines.append(f"⏹️ Sequenza annullata: {done_n} azion{'e' if done_n == 1 else 'i'} su {n} già eseguit{'a' if done_n == 1 else 'e'}.")
    elif failed_idx is not None:
        lines.append(f"⚠️ Mi sono fermato all'azione {failed_idx + 1} di {n}.")
    else:
        skipped = sum(1 for s in steps if s.get("status") == "skipped")
        lines.append(f"🤖 Fatto: {done_n} azion{'e' if done_n == 1 else 'i'} su {n} eseguit{'a' if done_n == 1 else 'e'}" + (f" ({skipped} saltat{'a' if skipped == 1 else 'e'})." if skipped else "."))
    chips: _ag_List[str] = []
    for i, s in enumerate(steps, 1):
        st = s.get("status")
        icon = {"done": "✅", "failed": "❌", "skipped": "⏭️", "pending": "⏸️"}.get(st, "⏸️")
        txt = s.get("result") or s.get("label") or s["action"]
        if st == "pending":
            txt = f"{s.get('label') or s['action']} (non eseguita)"
        lines.append(f"{i}. {icon} {txt}")
        if st == "done" and s.get("preview"):
            _pv = " ".join(str(s["preview"]).split())
            lines.append(f"   ↳ «{_pv[:200]}{'…' if len(_pv) > 200 else ''}»")
        if st == "done" and s.get("chip"):
            chips.append(s["chip"])
    if run.get("unsupported"):
        lines.append("ℹ️ Non eseguibile da me: " + "; ".join(str(u) for u in run["unsupported"][:3]))
    if failed_idx is not None and run.get("status") == "awaiting":
        lines.append("\nCome procedo? Rispondi **«salta»** per passare alla successiva, **«riprova»** dopo aver sistemato il dato, oppure **«annulla»**.")
    if chips:
        lines.append("\n" + "\n".join(chips))
    return "\n".join(lines)


async def _agent_run(run: dict, user: dict, start_index: int) -> dict:
    """Esegue i passi da start_index; si ferma al primo errore (status awaiting)."""
    steps = run["steps"]
    contacts_cache: _ag_Dict[str, _ag_Optional[dict]] = {}
    for i in range(start_index, len(steps)):
        s = steps[i]
        if s.get("status") in ("done", "skipped"):
            continue
        contact = None
        cname = (s.get("contact") or "").strip()
        try:
            if cname:
                if cname.lower() not in contacts_cache:
                    contacts_cache[cname.lower()] = await _nav_find_contact(user, cname)  # noqa: F821 — axon_navigator.py
                contact = contacts_cache[cname.lower()]
                if not contact:
                    raise _AgentStepError(f"non trovo «{cname}» tra i tuoi contatti")
            res = await _agent_exec_step(user, s, contact)
            s.update({"status": "done", "result": res["text"], "chip": res.get("chip"), "preview": res.get("preview"), "contact_id": (contact or {}).get("contact_id")})
        except _AgentStepError as e:
            s.update({"status": "failed", "error": str(e), "result": f"{s.get('label') or s['action']}: {e}"})
            run["status"] = "awaiting"
            break
        except Exception as e:  # noqa: BLE001
            logger.warning("[axon-agent] step %s failed: %s", s.get("action"), e)  # noqa: F821
            s.update({"status": "failed", "error": str(e), "result": f"{s.get('label') or s['action']}: errore interno ({str(e)[:80]})"})
            run["status"] = "awaiting"
            break
    else:
        run["status"] = "done"
    run["updated_at"] = utcnow()  # noqa: F821
    await db.axon_agent_runs.update_one({"run_id": run["run_id"]}, {"$set": {k: v for k, v in run.items() if k != "_id"}}, upsert=True)  # noqa: F821
    return run


async def _agent_resume(msg: str, user: dict) -> _ag_Optional[dict]:
    """Risposta dell'utente a «Come procedo?» (entro 30 min): salta / riprova / annulla."""
    t = (msg or "").strip()
    if not t or len(t) > 60:
        return None
    verb = next((k for k, rx in _AG_RESUME_RX.items() if rx.search(t)), None)
    if not verb:
        return None
    since = utcnow() - _ag_td(minutes=30)  # noqa: F821
    run = await db.axon_agent_runs.find_one({"user_id": user["user_id"], "status": "awaiting", "updated_at": {"$gte": since}}, {"_id": 0}, sort=[("updated_at", -1)])  # noqa: F821
    if not run:
        return None
    idx = next((i for i, s in enumerate(run["steps"]) if s.get("status") == "failed"), None)
    if idx is None:
        return None
    if verb == "cancel":
        run["status"] = "cancelled"
        run["steps"][idx]["status"] = "skipped"
        run["steps"][idx]["result"] = f"{run['steps'][idx].get('label') or run['steps'][idx]['action']} (annullata)"
        run["updated_at"] = utcnow()  # noqa: F821
        await db.axon_agent_runs.update_one({"run_id": run["run_id"]}, {"$set": run})  # noqa: F821
        return {"reply": _agent_report(run), "cmd": "agent_cancel"}
    if verb == "skip":
        run["steps"][idx]["status"] = "skipped"
        run["steps"][idx]["result"] = f"{run['steps'][idx].get('label') or run['steps'][idx]['action']} (saltata)"
        run["status"] = "running"
        run = await _agent_run(run, user, idx + 1)
    else:  # retry
        run["steps"][idx]["status"] = "pending"
        run["steps"][idx].pop("error", None); run["steps"][idx].pop("result", None)
        run["status"] = "running"
        run = await _agent_run(run, user, idx)
    return {"reply": _agent_report(run), "cmd": "agent_" + verb}


async def _maybe_agent_command(msg: str, user: dict) -> _ag_Optional[dict]:
    """Intercettore condiviso chat + voce. Ritorna {"reply","cmd"} oppure None (non è un comando multi-step)."""
    try:
        resumed = await _agent_resume(msg, user)
        if resumed:
            return resumed
        if not _agent_looks_multistep(msg):
            return None
        plan = await _agent_plan(msg, user)
        if not plan:
            return None
        if plan.get("clarify") and not plan.get("steps"):
            return {"reply": f"🤖 {plan['clarify']}", "cmd": "agent_clarify"}
        if not plan.get("steps"):
            return None
        # V50.z499 — prima: «una sola azione → la gestiscono gli intercettori/LLM normali» → l'LLM diceva «Fatto» senza salvare.
        # Ora anche UNA sola azione viene eseguita qui, con scrittura reale e verifica.
        run = {"run_id": f"agr_{_ag_uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "tenant_id": tenant_id(user), "message": msg,  # noqa: F821
               "steps": [{"action": s["action"], "contact": s.get("contact"), "label": (s.get("label") or "").strip()[:90], "params": s.get("params") or {}, "status": "pending"} for s in plan["steps"]],
               "unsupported": [str(u) for u in (plan.get("unsupported") or [])][:3], "status": "running", "created_at": utcnow(), "updated_at": utcnow()}  # noqa: F821
        run = await _agent_run(run, user, 0)
        return {"reply": _agent_report(run), "cmd": "agent_run", "agent_run_id": run["run_id"], "agent_status": run["status"]}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axon-agent] failed: %s", exc)  # noqa: F821
        return None


# ---- tap sui chip (da /axon/nav/action) ----------------------------------------------------------------------------------
async def _agent_nav_action(action: str, payload: dict, user: dict) -> _ag_Optional[str]:
    if action == "open_whatsapp":
        return "💬 WhatsApp aperto con il messaggio precompilato: controlla e premi Invia."
    if action == "send_email":
        to = (payload.get("to") or "").strip()
        subject = (payload.get("subject") or "Informazioni").strip()
        body_txt = (payload.get("body") or "").strip()
        if not to or "@" not in to or not body_txt:
            raise HTTPException(status_code=400, detail="Email incompleta (destinatario o testo mancante)")  # noqa: F821
        html = "<p>" + "</p><p>".join(_ag_re.sub(r"[<>]", "", para).replace("\n", "<br>") for para in body_txt.split("\n\n")) + "</p>"
        try:
            res = await axon_send_email("info", to, subject, html, text=body_txt, reply_to=user.get("email"), tid=tenant_id(user), tag="axon_agent")  # noqa: F821
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Invio email non riuscito: {exc}")  # noqa: F821
        try:
            if payload.get("contact_id"):
                await db.contacts.update_one({"contact_id": payload["contact_id"], "user_id": tenant_id(user)}, {"$push": {"notes": {  # noqa: F821
                    "id": str(_ag_uuid.uuid4()), "kind": "text", "category": "email", "text": f"Email inviata da Axon: «{subject}»", "created_at": utcnow(),  # noqa: F821
                    "source": "axon_agent", "created_by": user["user_id"]}}})
        except Exception:  # noqa: BLE001
            pass
        return f"✅ Email «{subject}» inviata a {to}" + (f" (via {res.get('provider')})." if isinstance(res, dict) and res.get("provider") else ".")
    return None
