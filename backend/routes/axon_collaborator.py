# axon_collaborator.py — V50.z419 — «Axon da assistente a COLLABORATORE»
# FIX 2 — Comando deterministico «copiami tutta la conversazione» → trascrizione completa della sessione corrente (utente + Axon, con orari).
# FIX 3 — Briefing spontaneo all'apertura: analisi deterministica dei dati (contratti chiusi → riconoscimento discreto, ritelefonate
#         scadute, appuntamenti di oggi, PUN sopra soglia, lead fermi) → `axon_briefings`. Nessun popup: il pallino cambia colore
#         (livello 1), una riga in chat «Ho qualcosa da dirti, quando vuoi» (livello 2), Axon inizia lui (livello 3, autorizzato dal cliente).
#         Livello di iniziativa in user_settings.axon_initiative (1|2|3, default 1). Funziona con 10 o 1000 clienti: sono regole sui dati.
# VISIONE — Regole di REGISTRO nel prompt: domanda diretta → risposta diretta; ragionamento ad alta voce → ascolta, non interrompe,
#         chiede «Vuoi un feedback o stavi solo pensando?»; riconoscimento discreto dei risultati; iniziativa proporzionata alla fiducia.
import re as _col_re
from datetime import timedelta as _col_td
from typing import Any, Dict, List, Optional

from fastapi import Depends
from pydantic import BaseModel

AXON_COLLABORATOR_RULES = (
    "<REGISTRO_CONVERSAZIONE>\n"
    "Sei un COLLABORATORE di fiducia, non uno strumento: il cliente spesso lavora da solo e si confronta con te come con un collega.\n"
    "• Domanda diretta → risposta diretta (REGOLA 0). • Se il cliente sta RAGIONANDO AD ALTA VOCE (frasi lunghe, dubbi, «boh», «non so se», "
    "«sto pensando», nessuna domanda esplicita): NON interrompere con soluzioni; rifletti in una frase quello che hai capito e chiedi "
    "«Vuoi un feedback o stavi solo pensando?». Non ogni messaggio richiede una risposta immediata.\n"
    "• Riconosci i risultati in modo DISCRETO, mai invadente («Ottimo lavoro, bel risultato.» e basta). • Se noti un'opportunità o un problema nei dati che hai "
    "in contesto, dillo con una riga: «Ho qualcosa da dirti, quando vuoi.» e aspetta: il cliente decide se e quando ascoltare.\n"
    "• Se il cliente chiede la trascrizione/copia della conversazione, il sistema la fornisce in modo deterministico: non riassumere, non inventare messaggi.\n"
    "</REGISTRO_CONVERSAZIONE>\n\n"
)

# ---------------------------------------------------------------- prompt: regole di registro (dopo le REGOLE ASSOLUTE)
_col_prev_prepare = _prepare_assistant_prompt  # noqa: F821


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _col_prev_prepare(user, body)
    if isinstance(prep, dict) and isinstance(prep.get("system_message"), str):
        sm = prep["system_message"]
        marker = "</REGOLE_ASSOLUTE_AXON>\n\n"
        prep["system_message"] = sm.replace(marker, marker + AXON_COLLABORATOR_RULES, 1) if marker in sm else AXON_COLLABORATOR_RULES + sm
    return prep


# ---------------------------------------------------------------- FIX 2: trascrizione deterministica
_COL_RX_TRANSCRIPT = _col_re.compile(
    r"\b(copia(mi)?|esporta(mi)?|dammi|mostra(mi)?|scrivi(mi)?|riporta(mi)?)\b.{0,40}\b(tutta la |l'intera |la )?(conversazione|chat|cronologia|trascrizione)\b|"
    r"\b(trascrizione|cronologia|storico) (completa |completo )?(della |di questa )?(conversazione|chat|sessione)\b", _col_re.I)

_col_prev_qa_intercept = _maybe_quick_action_intercept  # noqa: F821


async def _maybe_quick_action_intercept(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    if msg and _COL_RX_TRANSCRIPT.search(msg) and len(msg) <= 160:
        # sessione corrente = la più recente dell'utente (il comando arriva dalla stessa chat)
        last = await db.assistant_messages.find_one({"user_id": user["user_id"]}, {"_id": 0, "session_id": 1}, sort=[("created_at", -1)])  # noqa: F821
        sid = (last or {}).get("session_id")
        rows = [m async for m in db.assistant_messages.find({"user_id": user["user_id"], "session_id": sid}, {"_id": 0, "role": 1, "content": 1, "created_at": 1}).sort("created_at", 1).limit(500)] if sid else []  # noqa: F821
        name = (await db.user_settings.find_one({"user_id": user["user_id"]}, {"_id": 0, "assistant_name": 1}) or {}).get("assistant_name") or "Axon"  # noqa: F821
        if not rows:
            return {"reply": "In questa sessione non ci sono ancora messaggi da copiare.", "deterministic": True}
        lines = [f"📋 Conversazione completa · {len(rows)} messaggi\n"]
        for m in rows:
            c0 = (m.get("content") or "").strip()
            if c0.startswith("📋 Conversazione completa") or (m.get("role") == "user" and _COL_RX_TRANSCRIPT.search(c0) and len(c0) <= 160):
                continue  # niente ricorsione: il comando stesso e le trascrizioni precedenti restano fuori
            ts = m.get("created_at")
            ts_s = _fmt_dt_it(ts) if ts else ""  # noqa: F821
            who = "Tu" if m.get("role") == "user" else name
            lines.append(f"[{ts_s}] {who}: {(m.get('content') or '').strip()}")
        return {"reply": "\n".join(lines)[:60000], "deterministic": True}
    return await _col_prev_qa_intercept(msg, user)


# ---------------------------------------------------------------- FIX 3: briefing spontaneo
async def _col_build_briefing(user: dict) -> Dict[str, Any]:
    uid = user["user_id"]; tid = tenant_id(user); now = utcnow()  # noqa: F821
    own = {"user_id": tid}
    since = now - _col_td(hours=36)
    items: List[Dict[str, str]] = []
    # 1) contratti chiusi di recente → riconoscimento discreto
    ctr = await db.contracts.find({**own, "created_at": {"$gte": since}}, {"_id": 0, "title": 1, "amount": 1}).sort("created_at", -1).to_list(5)  # noqa: F821
    if ctr:
        tot = sum(float(c.get("amount") or 0) for c in ctr)
        items.append({"kind": "win", "text": f"Ottimo lavoro: {len(ctr)} contratt{'o' if len(ctr) == 1 else 'i'} chius{'o' if len(ctr) == 1 else 'i'} nelle ultime 36 ore" + (f" ({tot:,.0f} €)".replace(",", ".") if tot else "") + ". Bel risultato."})
    # 2) ritelefonate scadute
    overdue = await db.callbacks.count_documents({**own, "$or": [{"done": False}, {"done": {"$exists": False}}], "next_at": {"$lt": now}})  # noqa: F821
    if overdue:
        items.append({"kind": "todo", "text": f"{overdue} ritelefonat{'a' if overdue == 1 else 'e'} in ritardo: vuoi che te le riordini per priorità?", "route": "/home?section=ritelefonate"})
    # 3) appuntamenti di oggi
    d0 = now.replace(hour=0, minute=0, second=0, microsecond=0); d1 = d0 + _col_td(days=1)
    appts = await db.appointments.count_documents({**own, "start_at": {"$gte": d0, "$lt": d1}})  # noqa: F821
    if appts:
        items.append({"kind": "today", "text": f"Oggi hai {appts} appuntament{'o' if appts == 1 else 'i'} in agenda.", "route": "/calendario"})
    # 4) PUN sopra soglia (impostazione utente)
    us = await db.user_settings.find_one({"user_id": uid}, {"_id": 0, "pun_alert_threshold": 1, "pun_alert_bands": 1, "pun_alert_band": 1}) or {}  # noqa: F821
    thr = float(us.get("pun_alert_threshold") or 0)
    if thr > 0:
        p = await db.gme_pun_partial.find_one({}, {"_id": 0, "monorario": 1, "F1": 1, "F2": 1, "F3": 1, "month_key": 1}, sort=[("month_key", -1)])  # noqa: F821
        bands = [b for b in (us.get("pun_alert_bands") or [us.get("pun_alert_band") or "monorario"]) if b in ("monorario", "F1", "F2", "F3")]
        for b in bands:
            v = (p or {}).get(b)
            if v is not None and float(v) / 1000.0 > thr:
                items.append({"kind": "market", "text": f"PUN {b} del mese sopra la tua soglia ({float(v) / 1000.0:.3f} €/kWh): potrebbe essere il momento di contattare i clienti con contratti a prezzo variabile.", "route": "/home?section=widgets"})
                break
    # 5) lead senza follow-up da 7+ giorni
    stale = await db.leads.count_documents({**own, "status": {"$nin": ["won", "lost", "chiuso", "perso"]}, "updated_at": {"$lt": now - _col_td(days=7)}}) if "leads" in await db.list_collection_names() else 0  # noqa: F821
    if stale:
        items.append({"kind": "pipeline", "text": f"{stale} lead fermi da oltre una settimana: un messaggio breve può riattivarli.", "route": "/leads"})
    text = ("\n".join(f"• {it['text']}" for it in items)) if items else ""
    return {"items": items, "text": text, "has_items": bool(items), "generated_at": now}


class ColInitiativeIn(BaseModel):
    level: int  # 1 = colore pallino · 2 = riga in chat · 3 = Axon inizia lui


@api_router.get("/axon/briefing")  # noqa: F821
async def col_get_briefing(user=Depends(get_current_user)):  # noqa: F821
    """Briefing spontaneo del giorno (rigenerato se più vecchio di 3 ore). `seen` = il cliente l'ha già letto."""
    uid = user["user_id"]; now = utcnow()  # noqa: F821
    us = await db.user_settings.find_one({"user_id": uid}, {"_id": 0, "axon_initiative": 1}) or {}  # noqa: F821
    level = int(us.get("axon_initiative") or 1)
    cur = await db.axon_briefings.find_one({"user_id": uid}, {"_id": 0}, sort=[("generated_at", -1)])  # noqa: F821
    if not cur or (now - cur["generated_at"].replace(tzinfo=cur["generated_at"].tzinfo or now.tzinfo)) > _col_td(hours=3):
        b = await _col_build_briefing(user)
        same = cur and cur.get("text") == b["text"]
        cur = {"user_id": uid, **b, "seen": bool(cur.get("seen")) if same else False}
        await db.axon_briefings.update_one({"user_id": uid}, {"$set": cur}, upsert=True)  # noqa: F821
    return {"level": level, "has_new": bool(cur.get("has_items")) and not cur.get("seen"), "seen": bool(cur.get("seen")),
            "items": cur.get("items") or [], "text": cur.get("text") or "", "generated_at": cur.get("generated_at"),
            "teaser": "Ho qualcosa da dirti, quando vuoi." if cur.get("has_items") else ""}


@api_router.post("/axon/briefing/seen")  # noqa: F821
async def col_briefing_seen(user=Depends(get_current_user)):  # noqa: F821
    await db.axon_briefings.update_one({"user_id": user["user_id"]}, {"$set": {"seen": True, "seen_at": utcnow()}})  # noqa: F821
    return {"ok": True}


@api_router.put("/axon/briefing/level")  # noqa: F821
async def col_set_level(body: ColInitiativeIn, user=Depends(get_current_user)):  # noqa: F821
    lvl = 1 if body.level < 1 else 3 if body.level > 3 else int(body.level)
    await db.user_settings.update_one({"user_id": user["user_id"]}, {"$set": {"axon_initiative": lvl}}, upsert=True)  # noqa: F821
    return {"ok": True, "level": lvl}
