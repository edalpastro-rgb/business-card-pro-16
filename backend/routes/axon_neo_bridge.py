# axon_neo_bridge.py — V50.z239 — «Prompt per Neo»: ponte reale tra Axon (assistente in-app) e Neo (agente di sviluppo Emergent).
# Axon NON ha alcun canale diretto verso Neo. Quando l'utente autorizza («invia questo prompt a Neo»), Axon salva il testo
# in Master Files → cartella «Prompt per Neo» (category neo_prompts, stato pending). Neo, dalla chat di sviluppo, legge la
# coda direttamente dal database («leggi i prompt in coda») e marca read/done. Il system prompt vieta ad Axon di dichiarare
# collegamenti inesistenti. Comandi chat: «invia/manda … a Neo», «stato prompt Neo», «cosa ha fatto Neo».

_NEO_CAT = "neo_prompts"
ALLOWED_MASTER_CATS.add(_NEO_CAT)  # abilita la cartella nel POST /master-files e nell'upload

_NEO_SEND_RE = re.compile(
    r"(?:(?:invia|manda|passa|gira|inoltra|trasmetti|spedisci|consegna)\w*\s+(?:(?:questo|questa|il|la|lo|questi|queste|tutto)\s+)?(?:prompt|file|task|richiesta|messaggio|testo|documento|specifica|mega\s*task)?\s*(?:qui\s+sotto\s+|sopra\s+|precedente\s+)?a\s+neo\b"
    r"|autorizz\w*\s+(?:l['’]?\s*)?(?:invio|inoltro|trasmissione)?\s*(?:del\s+prompt\s+|del\s+file\s+)?(?:a|per|verso)\s+neo\b"
    r"|\ba\s+neo\s+(?:per\s+)?(?:lo\s+)?sviluppo\b|\bper\s+neo\b|\bda\s+(?:inviare|mandare|passare)\s+a\s+neo\b)",
    re.IGNORECASE)
_NEO_STATUS_RE = re.compile(r"(?:stato|status|situazione|elenco|lista|quanti|coda|mostra\w*|vedi|vedere)\s+(?:i\s+|le\s+|la\s+|dei\s+|delle\s+|di\s+)?(?:prompt|richieste|task)\s*(?:per|a|di|inviat\w*\s+a)?\s*neo\b|\bcoda\s+(?:di\s+|per\s+)?neo\b|\bneo\s+ha\s+(?:letto|fatto|completato|eseguito)\b|\bcosa\s+ha\s+fatto\s+neo\b|\bprompt\s+(?:per\s+)?neo\s+in\s+coda\b", re.IGNORECASE)
_NEO_STATUS_LABEL = {"pending": "in attesa", "read": "letto da Neo", "done": "completato", "rejected": "non eseguibile"}


def _neo_out(d: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in d.items() if k not in ("_id", "data_base64")}


async def _neo_counts(tid: str) -> Dict[str, int]:
    out = {"pending": 0, "read": 0, "done": 0, "rejected": 0}
    async for r in db.master_files.aggregate([{"$match": {"user_id": tid, "category": _NEO_CAT}}, {"$group": {"_id": "$neo_status", "n": {"$sum": 1}}}]):
        out[r["_id"] or "pending"] = r["n"]
    return out


async def _neo_save_prompt(user: dict, text: str, source: str, origin_note: Optional[str] = None) -> dict:
    tid = tenant_id(user)
    n = await db.master_files.count_documents({"user_id": tid, "category": _NEO_CAT})
    now = utcnow()
    title = f"Prompt per Neo #{n + 1} — {now.strftime('%d/%m %H:%M')}"
    first = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")[:70]
    doc = {
        "file_id": f"mf_{uuid.uuid4().hex[:12]}", "user_id": tid, "created_by": user["user_id"], "category": _NEO_CAT,
        "name": title, "title": (first or title)[:90], "body": text.strip()[:60000], "mime": "text/markdown", "size": len(text),
        "created_at": now, "updated_at": now,
        "neo_status": "pending", "neo_source": source, "neo_origin": origin_note, "neo_seq": n + 1,
        "neo_author": user.get("name") or user.get("email"),
    }
    await db.master_files.insert_one(dict(doc))
    return doc


# V50.z291 — Neo NON può leggere il database dell'app pubblicata: il testo va copiato e incollato nella chat di sviluppo.
_NEO_HOWTO = ("Non ho un canale diretto con Neo (l'agente di sviluppo Emergent) e Neo non può leggere il database dell'app pubblicata: il prompt è **salvato in Master Files → Prompt per Neo** con stato *in attesa*. "
              "Per farlo eseguire: **copia il testo del prompt** (te lo mostro con «stato prompt Neo» oppure aprilo in Master Files → Prompt per Neo → Copia) e **incollalo nella chat di sviluppo Emergent**. "
              "Quando Neo l'ha eseguito, dimmi «prompt Neo #N completato» e lo segno come fatto.")


_neo_prev_push_cmd = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").strip()
    if txt and (re.search(r"\bneo\b", txt, re.IGNORECASE) or re.search(r"\bprompt\w*\s+(?:ancora\s+)?in\s+coda\b", txt, re.IGNORECASE)):
        try:
            # V50.z306 — «cancella/azzera/elimina/svuota (tutti i) prompt per Neo / la coda Neo» → cancellazione REALE su database
            # (prima l'AI diceva «coda azzerata» senza farlo: i prompt restavano «in attesa»).
            mc = re.match(r"^\W*(?:ok\s+|allora\s+|per favore\s+|axon\s+|neo\s+)?(cancell\w*|azzer\w*|elimin\w*|svuot\w*|pulisc\w*|rimuov\w*|butta\w*)\b", txt, re.IGNORECASE)
            if mc and len(txt) <= 120 and re.search(r"\b(prompt|coda|richieste|task)\b", txt, re.IGNORECASE):
                tid = tenant_id(user)
                only_seq = re.search(r"#\s*(\d+)", txt)
                q = {"user_id": tid, "category": _NEO_CAT}
                if only_seq:
                    q["neo_seq"] = int(only_seq.group(1))
                elif not re.search(r"\b(tutt[oi]|tutte|anche i completati|completati)\b", txt, re.IGNORECASE):
                    q["neo_status"] = {"$in": ["pending", "read", None]}  # default: solo quelli non completati
                r = await db.master_files.delete_many(q)
                c = await _neo_counts(tid)
                left = sum(c.values())
                return {"reply": f"🗑️ Cancellati **{r.deleted_count}** prompt per Neo (verificato a database). Rimasti: **{c['pending']}** in attesa · {c['done']} completati · {left} totali." + ("" if left else " La coda è vuota."), "cmd": "neo_clear"}
            # V50.z306 — «scrivi/prepara/crea un prompt per Neo» SENZA testo → NON salvare nulla: lo prepara l'AI e lo mostra qui
            if re.search(r"\b(scriv\w*|prepar\w*|cre\w*|redig\w*|compon\w*|fammi|buttami gi[uù])\b[^.]{0,40}\bprompt\b", txt, re.IGNORECASE) and len(txt) < 160 and not re.search(r"\b(salva\w*|invia\w*|manda\w*)\s+(questo|quello|il prompt che)", txt, re.IGNORECASE):
                return None
            # V50.z291 — «prompt Neo #3 completato / eseguito / fatto» → marca done (o «letto» → read)
            md = re.search(r"prompt\s+(?:per\s+)?neo\s+#?\s*(\d+)\s+(?:è\s+stato\s+|e\s+stato\s+)?(completat\w*|eseguit\w*|fatt\w*|lett\w*|chius\w*)", txt, re.IGNORECASE)
            if md:
                seq = int(md.group(1)); st = "read" if md.group(2).lower().startswith("lett") else "done"
                r = await db.master_files.update_one({"user_id": tenant_id(user), "category": _NEO_CAT, "neo_seq": seq}, {"$set": {"neo_status": st, "neo_note": f"Segnato dall'utente il {utcnow().strftime('%d/%m %H:%M')}", "updated_at": utcnow()}})
                if r.matched_count:
                    return {"reply": f"✅ Prompt per Neo #{seq} segnato come **{_NEO_STATUS_LABEL[st]}**.", "cmd": "neo_mark"}
                return {"reply": f"Non trovo il prompt per Neo #{seq}. Chiedimi «stato prompt Neo» per l'elenco.", "cmd": "neo_mark"}
            if _NEO_STATUS_RE.search(txt) and not _NEO_SEND_RE.search(txt):
                tid = tenant_id(user)
                c = await _neo_counts(tid)
                items = [_neo_out(d) async for d in db.master_files.find({"user_id": tid, "category": _NEO_CAT}, {"_id": 0, "data_base64": 0}).sort("created_at", -1).limit(6)]
                if not items:
                    return {"reply": "📭 Nessun prompt per Neo in coda. Scrivimi «invia questo prompt a Neo» seguito dal testo (o dopo che te l'ho preparato) e lo salvo in Master Files → Prompt per Neo.", "cmd": "neo_status"}
                lines = [f"• #{d.get('neo_seq')} {d.get('title')} — *{_NEO_STATUS_LABEL.get(d.get('neo_status') or 'pending')}*" + (f" · nota Neo: {d['neo_note']}" if d.get("neo_note") else "") for d in items]
                # V50.z291 — testo integrale dei prompt in attesa, pronto da copiare/incollare nella chat di sviluppo Emergent
                pend = [d for d in items if (d.get("neo_status") or "pending") == "pending"][:3]
                blocks = "".join(f"\n\n**Prompt #{d.get('neo_seq')} — copia e incolla a Neo:**\n```\n{(d.get('body') or '')[:2500]}\n```" for d in pend)
                return {"reply": f"📋 **Prompt per Neo** — {c['pending']} in attesa · {c['read']} letti · {c['done']} completati\n\n" + "\n".join(lines) + blocks + "\n\n" + ("Neo non legge il database dell'app: copia il testo qui sopra e incollalo nella chat di sviluppo Emergent; poi dimmi «prompt Neo #N completato»." if c["pending"] else "Tutto letto da Neo ✅"), "cmd": "neo_status"}
            m = _NEO_SEND_RE.search(txt)
            if m:
                rest = (txt[:m.start()] + txt[m.end():]).strip(" \n:,.;-–—")
                origin = None
                # V50.z306 — «per Neo» senza verbo di invio e senza testo (es. «azzera la coda dei prompt per Neo», «domanda per Neo…»)
                # NON è un ordine di salvataggio: mai salvare l'ultimo messaggio di Axon di propria iniziativa.
                has_verb = re.search(r"\b(invia|manda|passa|gira|inoltra|trasmetti|spedisci|consegna|autorizz)\w*", txt, re.IGNORECASE)
                if not has_verb and len(rest) < 40:
                    return None
                if len(rest) >= 40:
                    content = rest
                    source = "chat_user"
                else:
                    last = await db.assistant_messages.find_one({"user_id": user["user_id"], "role": "assistant"}, sort=[("created_at", -1)])
                    content = (last or {}).get("content") or ""
                    if len(content.strip()) < 20:
                        return {"reply": "✍️ Dimmi cosa inviare: scrivi «invia questo prompt a Neo» seguito dal testo del prompt, oppure fammelo preparare e poi dimmi «invialo a Neo». " + _NEO_HOWTO, "cmd": "neo_ask"}
                    source = "chat_assistant"
                    origin = "ultimo messaggio preparato da Axon"
                    if len(rest) >= 12:
                        content = f"{rest}\n\n---\n{content}"
                doc = await _neo_save_prompt(user, content, source, origin)
                c = await _neo_counts(tenant_id(user))
                return {"reply": f"📤 **Salvato: {doc['name']}** ({len(content)} caratteri{', ' + origin if origin else ''}).\n\n{_NEO_HOWTO}\n\nIn coda ora: **{c['pending']}** in attesa.", "cmd": "neo_saved", "neo_file_id": doc["file_id"]}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[neo-bridge] command failed: %s", exc)
    return await _neo_prev_push_cmd(msg, user)


_neo_prev_prepare_prompt = _prepare_assistant_prompt
_NEO_TOPIC_RX = __import__("re").compile(r"\bneo\b|emmy|prompt|sviluppat|sviluppo|emergent|\bbug\b|segnal|errore|non funziona|correggi|codice")


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _neo_prev_prepare_prompt(user, body)
    if isinstance(prep, dict) and prep.get("query_class") == "simple":
        return prep  # V50.z413 — domanda semplice (ora/meteo/saluti/domotica): nessuna sezione extra nel prompt
    try:
        if prep.get("system_message"):
            c = await _neo_counts(tenant_id(user))
            msg_low = str(getattr(body, "message", "") or "").lower()
            # V50.z421 — consolidamento prompt: blocco completo (~1.6k car.) solo se il messaggio parla di Neo/prompt/sviluppo/bug;
            # altrimenti una riga di promemoria (la regola «nessun canale diretto» resta sempre presente).
            if not _NEO_TOPIC_RX.search(msg_low):
                prep["system_message"] += (
                    f"\n\n🔗 NEO (agente di sviluppo Emergent, distinto da te anche se «Neo» può essere il tuo nome): NON hai alcun canale diretto con lui — mai «lo invio a Neo». "
                    f"Per segnalazioni l'utente scrive «invia questo prompt a Neo» (salvato in Master Files → «Prompt per Neo», poi lo copia lui nella chat di sviluppo). Coda reale: {c['pending']} in attesa, {c['done']} completati."
                )
                return prep
            prep["system_message"] += (
                "\n\n🔗 NEO (AGENTE DI SVILUPPO EMERGENT) — REGOLA VINCOLANTE: tu NON hai NESSUN canale diretto con Neo, né via Teams, email, file o API. "
                "Non dire MAI «lo invio io a Neo», «glielo passo», «l'ho mandato a Neo» o simili: sarebbe falso. Il flusso reale è: l'utente ti dice «invia questo prompt a Neo» → il prompt viene salvato in "
                "Master Files → cartella «Prompt per Neo» (stato: in attesa) → l'utente COPIA il testo del prompt (da «stato prompt Neo» o da Master Files) e lo INCOLLA nella chat di sviluppo Emergent → dopo l'esecuzione dice «prompt Neo #N completato». "
                "Neo NON può leggere il database dell'app pubblicata: non dire mai che «Neo lo legge dal database». "
                "Se ti chiedono di inviare qualcosa a Neo, spiega questo flusso e invita a scrivere «invia questo prompt a Neo» (con il testo) per salvarlo. "
                "Nota: «Neo» può essere anche il tuo nome predefinito; se l'utente parla di Neo come sviluppatore, non confonderlo con te. "
                f"STATO REALE coda prompt per Neo (letto ADESSO dal database, prevale su qualsiasi numero citato dall'utente o detto in precedenza): {c['pending']} in attesa, {c['read']} letti, {c['done']} completati. "
                "Se l'utente cita un numero diverso, dì che il dato reale è questo e che l'informazione precedente era sbagliata; non inventare mai conteggi. "
                "Comandi deterministici disponibili: «stato prompt Neo» (elenco + testi da copiare), «cancella tutti i prompt per Neo» / «cancella il prompt Neo #N» (cancellazione reale), «prompt Neo #N completato». "
                "Se l'utente chiede «scrivi/prepara un prompt per Neo», PREPARA il testo del prompt qui in chat (titolo, problema, comportamento atteso, file/schermate) SENZA salvarlo: lo salverà lui con «invia questo prompt a Neo»."
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[neo-bridge] prompt failed: %s", exc)
    return prep


# ---- API (Master Files tab + strumenti di Neo) ----
class NeoPromptIn(BaseModel):
    text: str = Field(min_length=10, max_length=60000)


class NeoPromptPatch(BaseModel):
    status: Optional[Literal["pending", "read", "done", "rejected"]] = None
    note: Optional[str] = Field(default=None, max_length=600)


@api_router.get("/neo-bridge/prompts")
async def neo_prompts_list(status: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": tenant_id(user), "category": _NEO_CAT}
    if status:
        q["neo_status"] = status
    items = [_neo_out(d) async for d in db.master_files.find(q, {"_id": 0, "data_base64": 0}).sort("created_at", -1).limit(100)]
    return {"items": items, "counts": await _neo_counts(tenant_id(user))}


@api_router.post("/neo-bridge/prompts")
async def neo_prompts_create(body: NeoPromptIn, user=Depends(get_current_user)):
    doc = await _neo_save_prompt(user, body.text, "manual")
    return _neo_out(doc)


@api_router.delete("/neo-bridge/prompts")
async def neo_prompts_delete_all(scope: str = "pending", user=Depends(get_current_user)):
    """V50.z309 — «Cancella tutti» da Master Files → Prompt per Neo. scope=pending (default: in attesa+letti) | done | all."""
    q: Dict[str, Any] = {"user_id": tenant_id(user), "category": _NEO_CAT}
    if scope == "pending":
        q["neo_status"] = {"$in": ["pending", "read", None]}
    elif scope == "done":
        q["neo_status"] = "done"
    r = await db.master_files.delete_many(q)
    return {"ok": True, "deleted": r.deleted_count, "counts": await _neo_counts(tenant_id(user))}


@api_router.patch("/neo-bridge/prompts/{file_id}")
async def neo_prompts_patch(file_id: str, body: NeoPromptPatch, user=Depends(get_current_user)):
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.status:
        upd["neo_status"] = body.status
        upd[f"neo_{body.status}_at"] = utcnow()
    if body.note is not None:
        upd["neo_note"] = body.note.strip()
    r = await db.master_files.update_one({"file_id": file_id, "user_id": tenant_id(user), "category": _NEO_CAT}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Prompt non trovato")
    return _neo_out(await db.master_files.find_one({"file_id": file_id}, {"_id": 0, "data_base64": 0}))
