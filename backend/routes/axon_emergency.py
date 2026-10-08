# axon_emergency.py — V50.z460 — PROMPT 22: GESTIONE EMERGENZE E RICALCOLO AGENDA DINAMICO.
# «Mi si è rotta la macchina» / «sono bloccato nel traffico» / «ho un'emergenza» → Axon, in sequenza e in autonomia:
#  1) identifica gli appuntamenti impattati (finestra dedotta dal messaggio; default: da adesso a fine giornata),
#  2) propone per ciascuno il PRIMO slot libero (lun–ven 9:00–18:00, stessa durata, dal giorno stesso se possibile, senza sovrapposizioni),
#  3) redige il messaggio di scuse e rinvio per ogni cliente con il tono della personalità configurata (Personalizza Axon),
#  4) ricalcola la roadmap del giorno con gli impegni rimasti,
#  5) segnala gli effetti a cascata (giorni già carichi, spostamenti ad altro giorno, orari serali),
#  6) SOLO ALLA FINE mostra il riepilogo e chiede UNA conferma: «Ho riorganizzato tutto, confermi?» → tap (chip) o «confermo».
# Alla conferma: appuntamenti spostati + nota, email di scuse inviate via Resend ai clienti con indirizzo, tasto «Apri WhatsApp»
# precompilato per gli altri. «Mario ha rifiutato / è urgente» → notifica PRIORITARIA (canale urgent_alerts, LED rosso, bypass DND).
import json as _em_json
import re as _em_re
import uuid as _em_uuid
import zoneinfo as _em_zi
from datetime import datetime as _em_dt, timedelta as _em_td, timezone as _em_tz
from typing import Any as _em_Any, Dict as _em_Dict, List as _em_List, Optional as _em_Optional
from urllib.parse import quote as _em_quote

_EM_ROME = _em_zi.ZoneInfo("Europe/Rome")
_EM_WORK_START, _EM_WORK_END, _EM_STEP_MIN = 9, 18, 15
_EM_DAYS_IT = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]

_EM_TRIGGER_RX = _em_re.compile(
    r"\b(mi si è rott\w+|si è rott\w+ la (macchina|auto)|(macchina|auto) (rotta|in panne|guasta)|guasto|in panne|incidente|"
    r"bloccat\w+ (nel|in|dal) traffico|traffico bloccat\w*|coda (in autostrada|chilometric\w+)|treno (cancellato|soppresso|in ritardo)|volo (cancellato|in ritardo)|"
    r"emergenza|imprevisto|non riesco ad arrivare|non ce la faccio ad arrivare|non posso (venire|essere|presentarmi)|salta(no)? (tutti )?gli appuntamenti|"
    r"sto male|mi sento male|ho la febbre|sono malat\w+|(sono )?(in|al) pronto soccorso|(sono )?in ospedale|lutto|"
    r"(avrò|ho|sono in) (un )?ritardo di|arriverò (in ritardo|tardi)|sono in ritardo)\b", _em_re.I)
_EM_CONFIRM_RX = _em_re.compile(r"^\s*(sì[,.! ]*)?(confermo|conferma(to)?|ok(ay)?[,.! ]*(confermo|procedi|vai)?|procedi|vai( pure)?|approvo|va bene[,.! ]*(confermo|procedi)?|d'accordo)\s*[.!]*\s*$", _em_re.I)
_EM_REJECT_RX = _em_re.compile(r"^\s*(no[,.! ]*)?(annulla|lascia (stare|perdere)|non (confermo|procedere|spostare)|ferma(ti)?|stop)\b", _em_re.I)
_EM_CLIENT_REFUSAL_RX = _em_re.compile(
    r"\b(ha (rifiutato|detto (di )?no|declinato|disdetto)|rifiuta|non (gli|le) va bene|non (può|puo|riesce)( più)?|vuole (un altro|cambiare)|"
    r"(è|e') urgente|ha urgenza|urgenza|urgente|non accetta|non è d'accordo|insiste|si lamenta|è arrabbiat\w+|chiede di anticipare)\b", _em_re.I)


def _em_fmt(d: _em_dt) -> str:
    d = d.astimezone(_EM_ROME)
    return f"{_EM_DAYS_IT[d.weekday()]} {d.strftime('%d/%m')} alle {d.strftime('%H:%M')}"


def _em_aware(v) -> _em_Optional[_em_dt]:
    if isinstance(v, _em_dt):
        return v.replace(tzinfo=_em_tz.utc) if v.tzinfo is None else v
    if isinstance(v, str):
        try:
            d = _em_dt.fromisoformat(v.replace("Z", "+00:00"))
            return d.replace(tzinfo=_em_tz.utc) if d.tzinfo is None else d
        except Exception:  # noqa: BLE001
            return None
    return None


# ---- 1) finestra impattata ------------------------------------------------------------------------------------------------
async def _em_scope(msg: str, now_local: _em_dt) -> _em_Dict[str, _em_Any]:
    """LLM leggero: da quando a quando il consulente non è disponibile + motivo breve. Fallback: adesso → fine giornata."""
    end_today = now_local.replace(hour=23, minute=59, second=0, microsecond=0)
    fallback = {"from": now_local, "to": end_today, "reason": "un imprevisto", "delay_min": None}
    key = os.environ.get("EMERGENT_LLM_KEY")  # noqa: F821
    if not key:
        return fallback
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=key, session_id=f"em-scope-{_em_uuid.uuid4().hex[:8]}",
                       system_message="Estrai da un messaggio di imprevisto di un consulente la finestra in cui NON può tenere appuntamenti. Rispondi SOLO JSON.") \
            .with_model("anthropic", "claude-haiku-4-5")
        prompt = (f"ORA ATTUALE: {now_local.strftime('%Y-%m-%d %H:%M')} ({_EM_DAYS_IT[now_local.weekday()]}, Europe/Rome)\nMESSAGGIO: «{msg.strip()}»\n\n"
                  'JSON: {"from": "YYYY-MM-DDTHH:MM", "to": "YYYY-MM-DDTHH:MM", "delay_min": int|null, "reason": "motivo in 3-6 parole, in terza persona, senza dettagli sanitari"}\n'
                  "Regole: senza indicazioni esplicite from=ORA ATTUALE e to=fine giornata di oggi (23:59); «ritardo di 2 ore» → delay_min=120 e to=ORA+2h; "
                  "«oggi pomeriggio» → from=14:00 di oggi; «domani» → tutta la giornata di domani; «questa settimana»/«fino a venerdì» → fino a venerdì 23:59; mai date nel passato.")
        r = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=25)  # noqa: F821
        txt = (r or "").strip()
        if txt.startswith("```"):
            txt = _em_re.sub(r"^```(?:json)?\n?|\n?```$", "", txt).strip()
        d = _em_json.loads(txt)
        f = _em_dt.fromisoformat(d["from"]).replace(tzinfo=_EM_ROME); t = _em_dt.fromisoformat(d["to"]).replace(tzinfo=_EM_ROME)
        if t <= f:
            t = end_today
        return {"from": max(f, now_local - _em_td(minutes=5)), "to": t, "reason": (d.get("reason") or "un imprevisto").strip()[:60], "delay_min": d.get("delay_min")}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[emergency] scope parse failed: %s", exc)  # noqa: F821
        return fallback


# ---- 2) primo slot libero -------------------------------------------------------------------------------------------------
def _em_overlaps(s1: _em_dt, e1: _em_dt, s2: _em_dt, e2: _em_dt) -> bool:
    return s1 < e2 and s2 < e1


def _em_first_free_slot(earliest: _em_dt, duration_min: int, busy: _em_List[tuple]) -> _em_dt:
    """Primo inizio ≥ earliest (arrotondato ai 15') in lun–ven 9–18 che non si sovrappone a `busy` [(start,end)]."""
    t = earliest.astimezone(_EM_ROME)
    t = t.replace(second=0, microsecond=0)
    if t.minute % _EM_STEP_MIN:
        t += _em_td(minutes=_EM_STEP_MIN - t.minute % _EM_STEP_MIN)
    for _ in range(4000):
        if t.weekday() >= 5 or t.hour < _EM_WORK_START:
            days = 0 if t.weekday() < 5 and t.hour < _EM_WORK_START else (7 - t.weekday()) if t.weekday() >= 5 else 1
            t = (t + _em_td(days=days)).replace(hour=_EM_WORK_START, minute=0)
            continue
        end = t + _em_td(minutes=duration_min)
        if end.hour > _EM_WORK_END or (end.hour == _EM_WORK_END and end.minute > 0) or end.date() != t.date():
            t = (t + _em_td(days=1)).replace(hour=_EM_WORK_START, minute=0)
            continue
        if not any(_em_overlaps(t, end, bs, be) for bs, be in busy):
            return t
        t += _em_td(minutes=_EM_STEP_MIN)
    return earliest


# ---- 3) messaggi di scuse -------------------------------------------------------------------------------------------------
async def _em_draft_messages(user: dict, items: _em_List[dict], reason: str) -> None:
    uname = (user.get("name") or "il suo consulente").strip()
    tone = await _axon_personalize_section(user)  # noqa: F821 — tono della personalità configurata
    for it in items:  # fallback deterministico, poi l'LLM lo rimpiazza se riesce
        it["subject"] = f"Spostamento appuntamento del {it['old_start'].astimezone(_EM_ROME).strftime('%d/%m')}"
        it["email_body"] = (f"Gentile {it['contact_name']},\n\nper {reason} sono costretto a rinviare il nostro appuntamento previsto per {_em_fmt(it['old_start'])}. "
                            f"Le propongo {_em_fmt(it['new_start'])}: se per lei va bene non deve fare nulla, altrimenti mi dica pure un orario alternativo.\n\n"
                            f"Mi scuso per il disagio e la ringrazio per la comprensione.\n\n{uname}")
        it["whatsapp"] = (f"Buongiorno {it['contact_name'].split(' ')[0]}, per {reason} devo rinviare il nostro appuntamento di {_em_fmt(it['old_start'])}. "
                          f"Le propongo {_em_fmt(it['new_start'])}: va bene? Mi scuso per il disagio. {uname}")
    key = os.environ.get("EMERGENT_LLM_KEY")  # noqa: F821
    if not key or not items:
        return
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        system = ("Scrivi i messaggi di scuse e rinvio che il CONSULENTE invia ai suoi clienti: PRIMA PERSONA SINGOLARE come se scrivesse lui («sono costretto a rinviare»), "
                  "firmati con il suo nome; MAI nominare Axon o un assistente. Italiano, dà del Lei al cliente, "
                  "mai dettagli sanitari o personali: motivo generico. Ogni messaggio propone ESATTAMENTE il nuovo orario indicato e chiede conferma. "
                  "Rispondi SOLO JSON." + (("\n\nTONO DA APPLICARE:" + tone) if tone else ""))
        lst = "\n".join(f'- id "{it["appointment_id"]}": cliente {it["contact_name"]}, appuntamento «{it["title"]}» previsto {_em_fmt(it["old_start"])} → proposto {_em_fmt(it["new_start"])}' for it in items)
        prompt = (f"CONSULENTE: {uname}\nMOTIVO (generico): {reason}\n\nAPPUNTAMENTI:\n{lst}\n\n"
                  'JSON: {"<id>": {"subject": "oggetto email", "email_body": "email completa con saluto e firma (max 120 parole)", "whatsapp": "messaggio WhatsApp breve (max 60 parole)"}, ...}')
        chat = LlmChat(api_key=key, session_id=f"em-msg-{_em_uuid.uuid4().hex[:8]}", system_message=system).with_model("anthropic", "claude-sonnet-4-5")
        r = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=45)  # noqa: F821
        txt = (r or "").strip()
        if txt.startswith("```"):
            txt = _em_re.sub(r"^```(?:json)?\n?|\n?```$", "", txt).strip()
        d = _em_json.loads(txt)
        for it in items:
            m = d.get(it["appointment_id"]) or {}
            if m.get("email_body"):
                it["email_body"] = str(m["email_body"]).strip()
            if m.get("subject"):
                it["subject"] = str(m["subject"]).strip()[:120]
            if m.get("whatsapp"):
                it["whatsapp"] = str(m["whatsapp"]).strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[emergency] draft failed (fallback template): %s", exc)  # noqa: F821


# ---- pianificazione completa ----------------------------------------------------------------------------------------------
async def _em_build_plan(msg: str, user: dict) -> _em_Dict[str, _em_Any]:
    now = utcnow()  # noqa: F821
    now_local = now.astimezone(_EM_ROME)
    scope = await _em_scope(msg, now_local)
    tid = tenant_id(user)  # noqa: F821
    q = _omni_own(user, {"done": {"$ne": True}})  # noqa: F821
    all_appts = [a async for a in db.appointments.find(q, {"_id": 0}).sort("start_at", 1)]  # noqa: F821
    for a in all_appts:
        a["_s"] = _em_aware(a.get("start_at")); a["_e"] = _em_aware(a.get("end_at")) or (a["_s"] + _em_td(minutes=int(a.get("duration_min") or 60)) if a["_s"] else None)
    all_appts = [a for a in all_appts if a["_s"]]
    impacted = [a for a in all_appts if scope["from"] <= a["_s"] <= scope["to"] and a["_s"] >= now - _em_td(minutes=5)]
    others = [a for a in all_appts if a not in impacted and a["_e"] and a["_e"] >= now]
    plan: _em_Dict[str, _em_Any] = {"plan_id": f"emp_{_em_uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "tenant_id": tid, "message": msg, "reason": scope["reason"],
                                    "window": {"from": scope["from"].isoformat(), "to": scope["to"].isoformat()}, "items": [], "cascade": [], "roadmap": [], "status": "proposed",
                                    "created_at": now, "updated_at": now}
    if not impacted:
        return plan
    busy = [(a["_s"], a["_e"]) for a in others]
    earliest = max(scope["to"], now) if not scope.get("delay_min") else now + _em_td(minutes=int(scope["delay_min"]))
    contact_ids = [a.get("contact_id") for a in impacted if a.get("contact_id")]
    contacts = {c["contact_id"]: c async for c in db.contacts.find({"contact_id": {"$in": contact_ids}}, {"_id": 0, "contact_id": 1, "first_name": 1, "last_name": 1, "company": 1, "email": 1, "phone": 1, "phone_alt": 1})} if contact_ids else {}  # noqa: F821
    for a in impacted:
        dur = int(a.get("duration_min") or max(15, int(((a["_e"] or a["_s"]) - a["_s"]).total_seconds() // 60) or 60))
        new_start = _em_first_free_slot(earliest, dur, busy)
        busy.append((new_start, new_start + _em_td(minutes=dur)))
        c = contacts.get(a.get("contact_id") or "") or {}
        cname = f"{c.get('first_name') or ''} {c.get('last_name') or ''}".strip() or c.get("company") or (a.get("title") or "Cliente")
        phone_digits = _em_re.sub(r"\D", "", str(c.get("phone") or c.get("phone_alt") or a.get("phone_mobile") or ""))
        if phone_digits.startswith("00"):
            phone_digits = phone_digits[2:]
        if len(phone_digits) in (9, 10) and phone_digits[:1] in "03":
            phone_digits = "39" + phone_digits
        it = {"appointment_id": a["appointment_id"], "title": a.get("title") or "Appuntamento", "contact_id": a.get("contact_id"), "contact_name": cname,
              "email": (c.get("email") or a.get("email") or "").strip() or None, "phone": phone_digits if 10 <= len(phone_digits) <= 15 else None,
              "old_start": a["_s"], "new_start": new_start, "duration_min": dur}
        plan["items"].append(it)
        # effetti a cascata
        same_day = [o for o in others if o["_s"].astimezone(_EM_ROME).date() == new_start.astimezone(_EM_ROME).date()]
        if new_start.astimezone(_EM_ROME).date() != a["_s"].astimezone(_EM_ROME).date():
            plan["cascade"].append(f"«{it['title']}» passa a un altro giorno ({_em_fmt(new_start)})" + (f": quel giorno hai già {len(same_day)} impegn{'o' if len(same_day) == 1 else 'i'}" if same_day else ""))
        elif same_day:
            plan["cascade"].append(f"«{it['title']}» si incastra tra gli impegni di giornata ({len(same_day)} già in agenda)")
        if new_start.astimezone(_EM_ROME).hour >= 17:
            plan["cascade"].append(f"«{it['title']}» finisce a ridosso delle 18:00 ({_em_fmt(new_start)})")
    await _em_draft_messages(user, plan["items"], scope["reason"])
    # roadmap del giorno con gli impegni rimasti (oggi, non impattati) + i nuovi slot di oggi
    today = now_local.date()
    road = [(o["_s"], o.get("title") or "Appuntamento", "") for o in others if o["_s"].astimezone(_EM_ROME).date() == today and o["_e"] >= now]
    road += [(it["new_start"], it["title"], " (rinviato)") for it in plan["items"] if it["new_start"].astimezone(_EM_ROME).date() == today]
    cbs = [cb async for cb in db.callbacks.find(_omni_own(user, {"done": {"$ne": True}}), {"_id": 0, "title": 1, "scheduled_at": 1})]  # noqa: F821
    for cb in cbs:
        s = _em_aware(cb.get("scheduled_at"))
        if s and s.astimezone(_EM_ROME).date() == today and s >= now:
            road.append((s, f"📞 {cb.get('title') or 'Richiamata'}", ""))
    plan["roadmap"] = [f"{s.astimezone(_EM_ROME).strftime('%H:%M')} · {t}{tag}" for s, t, tag in sorted(road, key=lambda x: x[0])]
    return plan


def _em_report(plan: dict) -> str:
    items = plan["items"]
    w_from, w_to = _em_aware(plan["window"]["from"]), _em_aware(plan["window"]["to"])
    if not items:
        return (f"🚨 Ho capito: {plan['reason']}. Tra le {w_from.astimezone(_EM_ROME).strftime('%H:%M')} e le {w_to.astimezone(_EM_ROME).strftime('%H:%M del %d/%m')} "
                "non hai appuntamenti in agenda: nessun cliente da avvisare. Pensa solo a te.")
    lines = [f"🚨 Imprevisto registrato ({plan['reason']}). Ho riorganizzato l'agenda così:", "", f"**Appuntamenti impattati: {len(items)}**"]
    for i, it in enumerate(items, 1):
        ch = "✉️ email" if it.get("email") else ("💬 WhatsApp" if it.get("phone") else "⚠️ nessun recapito")
        lines.append(f"{i}. **{it['contact_name']}** — «{it['title']}»: da {_em_fmt(_em_aware(it['old_start']))} → **{_em_fmt(_em_aware(it['new_start']))}** · avviso via {ch}")
        lines.append(f"   ↳ «{' '.join(str(it.get('whatsapp') or '').split())[:160]}…»")
    lines.append("")
    lines.append("**Roadmap di oggi (dopo il ricalcolo):**")
    lines += [f"• {r}" for r in plan["roadmap"]] if plan["roadmap"] else ["• Nessun altro impegno per oggi."]
    if plan["cascade"]:
        lines.append("")
        lines.append("**Effetti a cascata:**")
        lines += [f"• {c}" for c in plan["cascade"]]
    lines.append("")
    lines.append("Alla conferma sposto gli appuntamenti, invio le email di scuse e ti preparo i WhatsApp da toccare. Nessuna modifica manuale.")
    lines.append(f"\n[[ACTION:emergency_confirm|✅ Ho riorganizzato tutto, confermi?|{_em_json.dumps({'plan_id': plan['plan_id']})}]]")
    return "\n".join(lines)


def _em_wa_chip(it: dict) -> str:
    url = f"https://wa.me/{it['phone']}?text={_em_quote(str(it.get('whatsapp') or ''))}"
    return f"[[ACTION:open_whatsapp|💬 WhatsApp a {it['contact_name']}|{_em_json.dumps({'url': url, 'contact_id': it.get('contact_id')}, ensure_ascii=False)}]]"


async def _em_apply(plan: dict, user: dict) -> str:
    """Conferma unica: sposta appuntamenti + nota, invia email, prepara WhatsApp."""
    now = utcnow()  # noqa: F821
    tid = tenant_id(user)  # noqa: F821
    out = ["✅ Fatto. Ecco cosa ho eseguito:"]
    chips = []
    sent = 0
    for it in plan["items"]:
        old_s, new_s = _em_aware(it["old_start"]), _em_aware(it["new_start"])
        await db.appointments.update_one({"appointment_id": it["appointment_id"], "user_id": tid}, {"$set": {  # noqa: F821
            "start_at": new_s, "end_at": new_s + _em_td(minutes=int(it["duration_min"])), "updated_at": now,
            "rescheduled_from": old_s, "rescheduled_reason": plan.get("reason"), "rescheduled_by": "axon_emergency"}})
        if it.get("contact_id"):
            await db.contacts.update_one({"contact_id": it["contact_id"], "user_id": tid}, {"$push": {"notes": {  # noqa: F821
                "id": str(_em_uuid.uuid4()), "kind": "text", "category": "general", "created_at": now, "source": "axon_emergency", "created_by": user["user_id"],
                "text": f"Appuntamento «{it['title']}» rinviato da {_em_fmt(old_s)} a {_em_fmt(new_s)} per {plan.get('reason')} (gestione imprevisto Axon)"}}})
        line = f"• {it['contact_name']}: appuntamento spostato a **{_em_fmt(new_s)}**"
        if it.get("email"):
            try:
                html = "<p>" + "</p><p>".join(_em_re.sub(r"[<>]", "", p).replace("\n", "<br>") for p in str(it["email_body"]).split("\n\n")) + "</p>"
                await axon_send_email("info", it["email"], it["subject"], html, text=it["email_body"], reply_to=user.get("email"), tid=tid, tag="axon_emergency")  # noqa: F821
                line += f" · ✉️ email di scuse inviata a {it['email']}"; sent += 1
            except Exception as exc:  # noqa: BLE001
                line += f" · ⚠️ email NON inviata ({str(exc)[:60]})"
                if it.get("phone"):
                    chips.append(_em_wa_chip(it))
        elif it.get("phone"):
            line += " · 💬 WhatsApp pronto (tocca sotto)"
            chips.append(_em_wa_chip(it))
        else:
            line += " · ⚠️ nessun recapito in scheda: avvisalo tu"
        out.append(line)
    if plan["roadmap"]:
        out.append("")
        out.append("**La tua giornata ora:** " + " → ".join(plan["roadmap"]))
    out.append("")
    out.append("Se un cliente rifiuta il nuovo orario o ha urgenza, scrivimelo (es. «Mario ha rifiutato») e ti avviso con priorità.")
    if chips:
        out.append("\n" + "\n".join(chips))
    await db.axon_emergency_plans.update_one({"plan_id": plan["plan_id"]}, {"$set": {"status": "applied", "applied_at": now, "emails_sent": sent, "updated_at": now}})  # noqa: F821
    return "\n".join(out)


# ---- rifiuto / urgenza del cliente → notifica prioritaria ------------------------------------------------------------------
async def _em_client_refusal(msg: str, user: dict) -> _em_Optional[dict]:
    if not _EM_CLIENT_REFUSAL_RX.search(msg):
        return None
    since = utcnow() - _em_td(days=7)  # noqa: F821
    plan = await db.axon_emergency_plans.find_one({"user_id": user["user_id"], "status": "applied", "applied_at": {"$gte": since}}, {"_id": 0}, sort=[("applied_at", -1)])  # noqa: F821
    if not plan or not plan.get("items"):
        return None
    low = msg.lower()
    hit = None
    for it in plan["items"]:
        toks = [t for t in it["contact_name"].lower().split() if len(t) > 2]
        if any(t in low for t in toks):
            hit = it; break
    if not hit:
        return None
    urgent = bool(_em_re.search(r"urgen", low))
    title = f"🚨 {hit['contact_name']}: {'URGENZA' if urgent else 'ha rifiutato il nuovo orario'}"
    body = f"Appuntamento «{hit['title']}» riproposto per {_em_fmt(_em_aware(hit['new_start']))}. Richiamalo subito per concordare un'alternativa."
    try:
        await axon_notify(user["user_id"], tenant_id(user), "callback_urgent", title, body, deeplink=f"/contact/{hit.get('contact_id')}" if hit.get("contact_id") else "/calendario",  # noqa: F821
                          dedupe_key=f"em_refusal_{plan['plan_id']}_{hit['appointment_id']}_{int(utcnow().timestamp() // 600)}", extra={"urgency": "CRITICAL", "source": "axon_emergency"}, team_copy=False)  # noqa: F821
    except Exception as exc:  # noqa: BLE001
        logger.warning("[emergency] priority notify failed: %s", exc)  # noqa: F821
    reply = (f"🚨 **Notifica prioritaria inviata.** {hit['contact_name']} {'segnala un' + chr(39) + 'urgenza sul' if urgent else 'non accetta il'} nuovo orario ({_em_fmt(_em_aware(hit['new_start']))}).\n"
             f"Lo richiami tu ora oppure dimmi un orario e lo risposto io.")
    if hit.get("phone"):
        wa = "https://wa.me/" + str(hit["phone"])
        reply += f"\n[[ACTION:open_whatsapp|💬 Scrivi a {hit['contact_name']}|{_em_json.dumps({'url': wa, 'contact_id': hit.get('contact_id')})}]]"
    return {"reply": reply, "cmd": "emergency_refusal"}


# ---- intercettore condiviso chat + voce -----------------------------------------------------------------------------------
async def _maybe_emergency_command(msg: str, user: dict) -> _em_Optional[dict]:
    try:
        t = (msg or "").strip()
        if not t or len(t) > 600:
            return None
        pending = await db.axon_emergency_plans.find_one({"user_id": user["user_id"], "status": "proposed", "created_at": {"$gte": utcnow() - _em_td(minutes=30)}}, {"_id": 0}, sort=[("created_at", -1)])  # noqa: F821
        if pending and pending.get("items"):
            if _EM_CONFIRM_RX.match(t):
                return {"reply": await _em_apply(pending, user), "cmd": "emergency_apply", "plan_id": pending["plan_id"]}
            if _EM_REJECT_RX.match(t):
                await db.axon_emergency_plans.update_one({"plan_id": pending["plan_id"]}, {"$set": {"status": "rejected", "updated_at": utcnow()}})  # noqa: F821
                return {"reply": "Ok, non tocco nulla: l'agenda resta com'è.", "cmd": "emergency_reject"}
        refusal = await _em_client_refusal(t, user)
        if refusal:
            return refusal
        if not _EM_TRIGGER_RX.search(t):
            return None
        plan = await _em_build_plan(t, user)
        await db.axon_emergency_plans.insert_one(dict(plan))  # noqa: F821
        plan.pop("_id", None)
        return {"reply": _em_report(plan), "cmd": "emergency_plan", "plan_id": plan["plan_id"], "impacted": len(plan["items"])}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[emergency] failed: %s", exc)  # noqa: F821
        return None


async def _emergency_nav_action(action: str, payload: dict, user: dict) -> _em_Optional[str]:
    if action != "emergency_confirm":
        return None
    plan = await db.axon_emergency_plans.find_one({"plan_id": payload.get("plan_id"), "user_id": user["user_id"]}, {"_id": 0})  # noqa: F821
    if not plan:
        raise HTTPException(status_code=404, detail="Piano non trovato")  # noqa: F821
    if plan.get("status") == "applied":
        return "Già fatto: questo piano era stato confermato."
    if plan.get("status") != "proposed":
        raise HTTPException(status_code=409, detail="Piano non più valido")  # noqa: F821
    return await _em_apply(plan, user)
