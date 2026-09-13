# axon_quick_reply.py — V50.z207 — Risposte rapide ✅ Sì / ❌ No / ❓ Forse alle domande chiuse di AxonOS (modulo ISOLATO)
#
# Frontend `src/axon-quick-reply.tsx`: sotto l'ultima risposta di Axon che termina con una domanda chiusa compaiono 3 pulsanti; il tap
# (1) registra la scelta qui (`POST /axon/quick-reply` → `axon_quick_replies`), (2) invia il testo («Sì» / «No» / «Forse, aspetta un
# momento») come normale messaggio in chat → il flusso continua senza digitare. Questo modulo aggiunge al prompt di sistema, quando il
# messaggio dell'utente è una risposta brevissima (sì/no/forse), l'istruzione di interpretarla come risposta all'ULTIMA domanda posta
# e proseguire (senza richiedere conferma). Nessuna modifica al core: wrap a catena di `_prepare_assistant_prompt`.

_QR_ANSWER_RE = re.compile(r"^\s*(✅\s*)?(s[ìi]|ok|va bene|certo|procedi|confermo)\s*[.!]?\s*$|^\s*(❌\s*)?(no|non ora|annulla|lascia stare)\s*[.!]?\s*$|^\s*(❓\s*)?(forse|aspetta|un momento|forse,? aspetta( un momento)?|non so)\s*[.!]?\s*$", re.IGNORECASE)


class QuickReplyIn(BaseModel):
    answer: str            # yes | no | maybe
    text: str
    question: Optional[str] = None
    message_id: Optional[str] = None


@api_router.post("/axon/quick-reply")
async def axon_quick_reply(body: QuickReplyIn, user=Depends(get_current_user)):
    ans = (body.answer or "").lower().strip()
    if ans not in ("yes", "no", "maybe"):
        raise HTTPException(status_code=400, detail="answer deve essere yes | no | maybe")
    doc = {"reply_id": f"qr_{uuid.uuid4().hex[:10]}", "user_id": user["user_id"], "tenant_id": tenant_id(user), "answer": ans, "text": (body.text or "")[:120],
           "question": (body.question or "")[:400] or None, "message_id": body.message_id, "created_at": utcnow()}
    await db.axon_quick_replies.insert_one(dict(doc))
    doc.pop("_id", None); doc["created_at"] = doc["created_at"].isoformat()
    return {"ok": True, "reply": doc, "send_text": doc["text"]}


_qr_prev_prepare_prompt = _prepare_assistant_prompt


async def _prepare_assistant_prompt(user: dict, body) -> dict:  # noqa: F811
    prep = await _qr_prev_prepare_prompt(user, body)
    try:
        msg = (getattr(body, "message", "") or "").strip()
        if msg and len(msg) <= 40 and _QR_ANSWER_RE.match(msg) and prep.get("system_message"):
            kind = "AFFERMATIVA (sì)" if re.match(r"^\s*(✅\s*)?(s[ìi]|ok|va bene|certo|procedi|confermo)", msg, re.IGNORECASE) else ("NEGATIVA (no)" if re.match(r"^\s*(❌\s*)?(no|non ora|annulla|lascia)", msg, re.IGNORECASE) else "SOSPESA (forse / aspetta)")
            prep["system_message"] += (
                f"\n\n🔘 RISPOSTA RAPIDA: l'utente ha risposto «{msg}» — risposta {kind} all'ULTIMA domanda chiusa che gli hai posto nella conversazione. "
                "Interpretala così e prosegui il flusso senza chiedere di nuovo conferma: se affermativa esegui/conferma l'azione proposta; se negativa non farla e chiudi con una riga; "
                "se sospesa, resta in attesa dicendo che riprenderai quando vuole (non insistere)."
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quick-reply] prompt failed: %s", exc)
    return prep


@app.on_event("startup")
async def _qr_start():
    try:
        await db.axon_quick_replies.create_index([("user_id", 1), ("created_at", -1)])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[quick-reply] start failed: %s", exc)
