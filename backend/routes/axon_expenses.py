# axon_expenses.py — V50.z198 — BLOCCO 8 · Fase 2: Scontrini / Nota spese per sfera + Estratto conto (modulo ISOLATO)
#
# Caricato DOPO axon_integrations.py e PRIMA di 37. Nessuna modifica al core. Riusa: LlmChat/ImageContent (Gemini flash vision),
# _extract_attachment_text (PDF → testo), _put_object_sync/_get_object_sync (Object Storage), _maybe_push_command (comandi chat a catena).
#
# (a) SCONTRINI → NOTA SPESE: `POST /axon/expenses/receipt {sphere, data_base64, mime, name}` → foto/PDF → Gemini estrae
#     {esercente, importo, data, categoria, iva, pagamento} con le categorie della sfera (Business: carburante, vitto, alloggio, trasporti,
#     ufficio, telefonia, formazione, rappresentanza, altro · Home: spesa, casa, svago, salute, trasporti, abbigliamento, altro) → riga in
#     `axon_expenses` {sphere, month YYYY-MM, …}; immagine su Object Storage (`expenses/{tenant}/{id}`). Nota spese del mese per sfera:
#     `GET /axon/expenses?sphere&month`, modifica/cancella, **PDF** `GET /axon/expenses/pdf?sphere&month[&user_id]` (reportlab; il Master può
#     esportare la nota spese di ogni collaboratore dalla dashboard). Sfere MAI mescolate: ogni query è filtrata per sphere.
# (b) ESTRATTO CONTO: `POST /axon/expenses/statement {sphere, data_base64, mime, name}` → PDF/foto → LLM categorizza i movimenti →
#     `axon_statement_reports` {sphere, periodo, entrate, uscite, saldo, per_categoria[], movimenti[] (max 300), insight} → Sezione Report
#     (`GET /axon/expenses/statements`, `GET /{id}`). Nessuna connessione diretta alla banca.
# Chat: «quanto ho speso questo mese?» / «nota spese di settembre» (per sfera: default Business; «personali/casa» → Home).

import json as _axe_json

_AXE_MODEL = ("gemini", "gemini-3-flash-preview")
_AXE_TEXT_MODEL = ("anthropic", "claude-haiku-4-5-20251001")
_AXE_CATS = {
    "business": ["carburante", "vitto", "alloggio", "trasporti", "ufficio", "telefonia", "formazione", "rappresentanza", "altro"],
    "home": ["spesa", "casa", "svago", "salute", "trasporti", "abbigliamento", "altro"],
}
_AXE_MAX_BYTES = 8 * 1024 * 1024
_AXE_SPHERES = ("business", "home")
_AXE_ICON = {"business": "🔵", "home": "🟢"}

_OMNI_EXTRA_SECTIONS.append((
    "Nota spese e Estratto conto (Integrazioni · Fase 2)", "/axon-expenses",
    "Fotografa uno scontrino (o allega PDF): Axon riconosce esercente, importo, data e categoria e lo aggiunge alla nota spese del mese della sfera "
    "(🔵 Business: carburante, vitto, alloggio… · 🟢 Home: spesa, casa, svago, salute). PDF esportabile (il Master anche per i collaboratori). "
    "Estratto conto: allega PDF/foto, Axon categorizza i movimenti e produce il report in Sezione Report. Nessun collegamento alla banca.",
))


class AxeFileIn(BaseModel):
    sphere: str = "business"
    data_base64: str
    mime: Optional[str] = None
    name: Optional[str] = None
    note: Optional[str] = None


class AxeExpensePatch(BaseModel):
    merchant: Optional[str] = None
    amount: Optional[float] = None
    date: Optional[str] = None
    category: Optional[str] = None
    note: Optional[str] = None
    sphere: Optional[str] = None


class AxeManualIn(BaseModel):
    sphere: str = "business"
    merchant: str
    amount: float
    date: Optional[str] = None
    category: Optional[str] = None
    note: Optional[str] = None


def _axe_sphere(s: Optional[str]) -> str:
    s = (s or "business").lower()
    if s not in _AXE_SPHERES:
        raise HTTPException(status_code=400, detail="Sfera non valida (business | home)")
    return s


def _axe_out(d: dict) -> dict:
    d = dict(d); d.pop("_id", None)
    for k in ("created_at", "updated_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    return d


def _axe_bare_b64(b64: str) -> str:
    return b64.split(",", 1)[1] if b64.startswith("data:") else b64


def _axe_month(date_str: Optional[str]) -> str:
    try:
        return datetime.strptime((date_str or "")[:10], "%Y-%m-%d").strftime("%Y-%m")
    except Exception:
        return utcnow().strftime("%Y-%m")


async def _axe_llm_json(system: str, text: str, b64: Optional[str], mime: Optional[str]) -> dict:
    """Immagine → Gemini vision; testo → Haiku. Ritorna dict (fallback {})."""
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="EMERGENT_LLM_KEY mancante")
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
    if b64:
        chat = LlmChat(api_key=key, session_id=f"axe-{uuid.uuid4().hex[:8]}", system_message=system).with_model(*_AXE_MODEL)
        resp = await chat.send_message(UserMessage(text=text, file_contents=[ImageContent(image_base64=_axe_bare_b64(b64))]))
    else:
        chat = LlmChat(api_key=key, session_id=f"axe-{uuid.uuid4().hex[:8]}", system_message=system).with_model(*_AXE_TEXT_MODEL)
        resp = await chat.send_message(UserMessage(text=text))
    return _parse_llm_json((resp or "").strip(), fallback_key="raw") or {}


async def _axe_prepare_input(body: AxeFileIn) -> Tuple[Optional[str], str, bytes, str]:
    """Ritorna (image_b64 | None, testo estratto, bytes, mime)."""
    import base64 as _b64
    raw = _b64.b64decode(_axe_bare_b64(body.data_base64))
    if not raw or len(raw) > _AXE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File vuoto o troppo grande (max 8 MB)")
    mime = (body.mime or "").lower() or ("application/pdf" if (body.name or "").lower().endswith(".pdf") else "image/jpeg")
    if "pdf" in mime:
        att = AssistantAttachmentIn(name=body.name or "documento.pdf", mime="application/pdf", data_base64=_axe_bare_b64(body.data_base64))
        text = await _extract_attachment_text(att)
        return None, (text or "")[:20000], raw, mime
    return _axe_bare_b64(body.data_base64), "", raw, mime


# ============================================================================ (a) SCONTRINI
@api_router.post("/axon/expenses/receipt")
async def axe_receipt(body: AxeFileIn, user=Depends(get_current_user)):
    sphere = _axe_sphere(body.sphere)
    img, text, raw, mime = await _axe_prepare_input(body)
    cats = _AXE_CATS[sphere]
    system = (f"Sei il modulo scontrini di AxonOS ({'sfera Business, spese di lavoro di un consulente' if sphere == 'business' else 'sfera Home, spese personali'}). "
              "Leggi lo scontrino/ricevuta italiana e rispondi SOLO con JSON: {\"esercente\": str, \"importo\": numero totale pagato (punto decimale), \"valuta\": \"EUR\", "
              "\"data\": \"YYYY-MM-DD\" (se assente usa la data odierna), \"categoria\": una tra " + _axe_json.dumps(cats) + ", \"iva\": numero o null, \"pagamento\": \"carta|contanti|altro|null\", "
              "\"descrizione\": \"max 80 caratteri\", \"affidabilita\": 0-1}. Se non è uno scontrino: {\"errore\": \"motivo\"}.")
    data = await _axe_llm_json(system, text or "Estrai i dati da questo scontrino.", img, mime)
    if data.get("errore") or data.get("importo") in (None, ""):
        raise HTTPException(status_code=422, detail=f"Non riconosco uno scontrino: {data.get('errore') or 'importo assente'}")
    try:
        amount = round(float(str(data.get("importo")).replace(",", ".")), 2)
    except Exception:
        raise HTTPException(status_code=422, detail="Importo non leggibile")
    date = str(data.get("data") or utcnow().strftime("%Y-%m-%d"))[:10]
    cat = str(data.get("categoria") or "altro").lower()
    cat = cat if cat in cats else "altro"
    eid = f"axe_{uuid.uuid4().hex[:10]}"; tid = tenant_id(user)
    path = None
    try:
        ext = "pdf" if "pdf" in mime else "jpg"
        res = await run_in_threadpool(_put_object_sync, f"expenses/{tid}/{eid}.{ext}", raw, mime)
        path = (res or {}).get("path") or (f"expenses/{tid}/{eid}.{ext}" if res else None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axe] store failed: %s", exc)
    doc = {"expense_id": eid, "tenant_id": tid, "user_id": user["user_id"], "user_name": user.get("name") or user.get("email"), "sphere": sphere, "merchant": str(data.get("esercente") or "Esercente")[:120],
           "amount": amount, "currency": "EUR", "date": date, "month": _axe_month(date), "category": cat, "vat": data.get("iva"), "payment": data.get("pagamento"),
           "description": str(data.get("descrizione") or "")[:160], "confidence": data.get("affidabilita"), "note": (body.note or "")[:300] or None,
           "file_path": path, "file_mime": mime, "source": "receipt", "created_at": utcnow(), "updated_at": utcnow()}
    await db.axon_expenses.insert_one(dict(doc))
    tot = await _axe_month_total(tid, user, sphere, doc["month"])
    return {"ok": True, "expense": _axe_out(doc), "month_total": tot, "sphere_icon": _AXE_ICON[sphere],
            "reply": f"{_AXE_ICON[sphere]} Aggiunto alla nota spese {sphere.title()} di {doc['month']}: **{doc['merchant']}** · {amount:.2f} € · {cat} · {date}. Totale mese: {tot:.2f} €."}


@api_router.post("/axon/expenses/manual")
async def axe_manual(body: AxeManualIn, user=Depends(get_current_user)):
    sphere = _axe_sphere(body.sphere); date = (body.date or utcnow().strftime("%Y-%m-%d"))[:10]
    cat = (body.category or "altro").lower(); cat = cat if cat in _AXE_CATS[sphere] else "altro"
    doc = {"expense_id": f"axe_{uuid.uuid4().hex[:10]}", "tenant_id": tenant_id(user), "user_id": user["user_id"], "user_name": user.get("name") or user.get("email"), "sphere": sphere,
           "merchant": body.merchant.strip()[:120], "amount": round(float(body.amount), 2), "currency": "EUR", "date": date, "month": _axe_month(date), "category": cat,
           "note": (body.note or "")[:300] or None, "source": "manual", "created_at": utcnow(), "updated_at": utcnow()}
    await db.axon_expenses.insert_one(dict(doc))
    return {"ok": True, "expense": _axe_out(doc)}


def _axe_scope(user: dict, sphere: str, month: Optional[str], target_user: Optional[str]) -> dict:
    q: Dict[str, Any] = {"tenant_id": tenant_id(user), "sphere": sphere}
    if sphere == "home" or not is_admin_or_owner(user):
        q["user_id"] = user["user_id"]                       # Home: sempre e solo le proprie; collaboratore: solo le proprie
    elif target_user:
        q["user_id"] = target_user                           # Master: nota spese di un collaboratore
    if month:
        q["month"] = month
    return q


async def _axe_month_total(tid: str, user: dict, sphere: str, month: str) -> float:
    agg = await db.axon_expenses.aggregate([{"$match": _axe_scope(user, sphere, month, None)}, {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]).to_list(1)
    return round(float(agg[0]["t"]) if agg else 0.0, 2)


@api_router.get("/axon/expenses")
async def axe_list(sphere: str = "business", month: Optional[str] = None, user_id: Optional[str] = None, user=Depends(get_current_user)):
    sphere = _axe_sphere(sphere); month = month or utcnow().strftime("%Y-%m")
    q = _axe_scope(user, sphere, month, user_id)
    items = [_axe_out(d) async for d in db.axon_expenses.find(q, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).limit(500)]
    by_cat: Dict[str, float] = {}
    for it in items:
        by_cat[it["category"]] = round(by_cat.get(it["category"], 0) + float(it["amount"]), 2)
    total = round(sum(float(i["amount"]) for i in items), 2)
    months = await db.axon_expenses.distinct("month", {k: v for k, v in q.items() if k != "month"})
    team = []
    if sphere == "business" and is_admin_or_owner(user):
        async for r in db.axon_expenses.aggregate([{"$match": {"tenant_id": tenant_id(user), "sphere": "business", "month": month}}, {"$group": {"_id": "$user_id", "name": {"$first": "$user_name"}, "t": {"$sum": "$amount"}, "n": {"$sum": 1}}}]):
            team.append({"user_id": r["_id"], "name": r.get("name"), "total": round(float(r["t"]), 2), "count": r["n"]})
    return {"sphere": sphere, "sphere_icon": _AXE_ICON[sphere], "month": month, "items": items, "total": total, "by_category": by_cat, "categories": _AXE_CATS[sphere],
            "months": sorted(months, reverse=True)[:24], "team": team, "can_export_team": sphere == "business" and is_admin_or_owner(user)}


@api_router.put("/axon/expenses/{expense_id}")
async def axe_update(expense_id: str, body: AxeExpensePatch, user=Depends(get_current_user)):
    it = await db.axon_expenses.find_one({"expense_id": expense_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not it or (it["user_id"] != user["user_id"] and not (is_admin_or_owner(user) and it["sphere"] == "business")):
        raise HTTPException(status_code=404, detail="Spesa non trovata")
    upd: Dict[str, Any] = {"updated_at": utcnow()}
    if body.merchant is not None: upd["merchant"] = body.merchant.strip()[:120]
    if body.amount is not None: upd["amount"] = round(float(body.amount), 2)
    if body.date is not None: upd["date"] = body.date[:10]; upd["month"] = _axe_month(body.date)
    if body.note is not None: upd["note"] = body.note.strip()[:300] or None
    sphere = _axe_sphere(body.sphere) if body.sphere else it["sphere"]
    if body.sphere is not None and it["user_id"] == user["user_id"]: upd["sphere"] = sphere  # riclassifica Privato/Business
    if body.category is not None:
        c = body.category.lower(); upd["category"] = c if c in _AXE_CATS[sphere] else "altro"
    await db.axon_expenses.update_one({"expense_id": expense_id}, {"$set": upd})
    return {"ok": True, "expense": _axe_out({**it, **upd})}


@api_router.delete("/axon/expenses/{expense_id}")
async def axe_delete(expense_id: str, user=Depends(get_current_user)):
    it = await db.axon_expenses.find_one({"expense_id": expense_id, "tenant_id": tenant_id(user)}, {"_id": 0})
    if not it or (it["user_id"] != user["user_id"] and not (is_admin_or_owner(user) and it["sphere"] == "business")):
        raise HTTPException(status_code=404, detail="Spesa non trovata")
    await db.axon_expenses.delete_one({"expense_id": expense_id})
    return {"ok": True}


@api_router.get("/axon/expenses/{expense_id}/file")
async def axe_file(expense_id: str, user=Depends(get_current_user)):
    it = await db.axon_expenses.find_one({"expense_id": expense_id, "tenant_id": tenant_id(user)}, {"_id": 0, "file_path": 1, "file_mime": 1, "user_id": 1, "sphere": 1})
    if not it or not it.get("file_path") or (it["user_id"] != user["user_id"] and not (is_admin_or_owner(user) and it["sphere"] == "business")):
        raise HTTPException(status_code=404, detail="File non trovato")
    got = await run_in_threadpool(_get_object_sync, it["file_path"])
    if not got:
        raise HTTPException(status_code=404, detail="File non disponibile")
    from fastapi.responses import Response as _Resp
    return _Resp(content=got[0], media_type=it.get("file_mime") or got[1] or "image/jpeg")


@api_router.get("/axon/expenses/pdf")
async def axe_pdf(sphere: str = "business", month: Optional[str] = None, user_id: Optional[str] = None, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    """Nota spese del mese in PDF (reportlab). Il Master può esportare quella di un collaboratore (?user_id=). Auth via header o ?token= (webviewer mobile)."""
    user = await get_current_user(authorization=authorization or (f"Bearer {token}" if token else None))
    sphere = _axe_sphere(sphere); month = month or utcnow().strftime("%Y-%m")
    q = _axe_scope(user, sphere, month, user_id)
    items = [d async for d in db.axon_expenses.find(q, {"_id": 0}).sort("date", 1).limit(500)]
    owner = items[0].get("user_name") if items else (user.get("name") or user.get("email"))
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.pdfgen import canvas as _canvas  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    import io as _io
    buf = _io.BytesIO(); c = _canvas.Canvas(buf, pagesize=A4); W, H = A4; y = H - 20 * mm
    c.setFont("Helvetica-Bold", 16); c.drawString(20 * mm, y, f"Nota spese {sphere.title()} — {month}"); y -= 8 * mm
    c.setFont("Helvetica", 10); c.drawString(20 * mm, y, f"Intestatario: {owner or ''}   ·   Generata da AxonOS il {utcnow().strftime('%d/%m/%Y')}   ·   Sfera: {'Business (lavoro)' if sphere == 'business' else 'Home (personale)'}"); y -= 10 * mm
    c.setFont("Helvetica-Bold", 10)
    for x, h in ((20, "Data"), (45, "Esercente"), (115, "Categoria"), (150, "Pagamento"), (175, "Importo €")):
        c.drawString(x * mm, y, h)
    y -= 3 * mm; c.line(20 * mm, y, 190 * mm, y); y -= 5 * mm; c.setFont("Helvetica", 9.5); tot = 0.0
    for it in items:
        if y < 25 * mm:
            c.showPage(); y = H - 20 * mm; c.setFont("Helvetica", 9.5)
        c.drawString(20 * mm, y, it.get("date") or ""); c.drawString(45 * mm, y, (it.get("merchant") or "")[:38]); c.drawString(115 * mm, y, it.get("category") or "")
        c.drawString(150 * mm, y, (it.get("payment") or "-")[:10]); c.drawRightString(190 * mm, y, f"{float(it.get('amount') or 0):.2f}"); tot += float(it.get("amount") or 0); y -= 5.5 * mm
    y -= 3 * mm; c.line(20 * mm, y, 190 * mm, y); y -= 7 * mm; c.setFont("Helvetica-Bold", 12); c.drawRightString(190 * mm, y, f"TOTALE: {tot:.2f} €")
    _sig = await _ob_signature(tenant_id(user))  # V50.z233 — firma aziendale (Personalizzazione Aziendale)
    if _sig:
        c.setFont("Helvetica-Oblique", 8.5); c.drawCentredString(W / 2, 12 * mm, _sig[:180])
    by_cat: Dict[str, float] = {}
    for it in items:
        by_cat[it["category"]] = by_cat.get(it["category"], 0) + float(it.get("amount") or 0)
    y -= 10 * mm; c.setFont("Helvetica-Bold", 10); c.drawString(20 * mm, y, "Per categoria:"); c.setFont("Helvetica", 9.5)
    for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        y -= 5 * mm; c.drawString(25 * mm, y, f"• {k}: {v:.2f} €")
    c.showPage(); c.save()
    from fastapi.responses import Response as _Resp
    return _Resp(content=buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="nota-spese-{sphere}-{month}.pdf"'})


# ============================================================================ (b) ESTRATTO CONTO
@api_router.post("/axon/expenses/statement")
async def axe_statement(body: AxeFileIn, user=Depends(get_current_user)):
    sphere = _axe_sphere(body.sphere)
    img, text, raw, mime = await _axe_prepare_input(body)
    if not img and len(text.strip()) < 40:
        raise HTTPException(status_code=422, detail="Il PDF non contiene testo leggibile: prova con una foto nitida delle pagine")
    cats = _AXE_CATS[sphere] + ["stipendio/entrate", "tasse", "assicurazioni", "finanziamenti", "utenze", "commissioni bancarie", "prelievi", "bonifici"]
    system = ("Sei il modulo estratto conto di AxonOS. Analizza l'estratto conto bancario italiano (testo o immagine) SENZA inventare movimenti. Rispondi SOLO JSON: "
              "{\"banca\": str|null, \"periodo\": \"es. 01/08/2026 – 31/08/2026\", \"saldo_iniziale\": num|null, \"saldo_finale\": num|null, \"entrate\": num, \"uscite\": num, "
              "\"movimenti\": [{\"data\": \"YYYY-MM-DD\", \"descrizione\": str ≤ 80, \"importo\": num (negativo = uscita), \"categoria\": una tra " + _axe_json.dumps(cats) + "}] (max 300), "
              "\"per_categoria\": [{\"categoria\": str, \"totale\": num, \"n\": int}], \"insight\": [\"3-5 osservazioni utili in italiano, brevi\"], \"anomalie\": [\"addebiti ricorrenti/duplicati/insoliti\"]}")
    data = await _axe_llm_json(system, text or "Analizza questo estratto conto.", img, mime)
    movs = [m for m in (data.get("movimenti") or []) if isinstance(m, dict)][:300]
    if not movs and not data.get("entrate") and not data.get("uscite"):
        raise HTTPException(status_code=422, detail="Non riconosco un estratto conto in questo file")
    rid = f"axs_{uuid.uuid4().hex[:10]}"; tid = tenant_id(user)
    path = None
    try:
        ext = "pdf" if "pdf" in mime else "jpg"
        res = await run_in_threadpool(_put_object_sync, f"statements/{tid}/{rid}.{ext}", raw, mime)
        path = (res or {}).get("path") or (f"statements/{tid}/{rid}.{ext}" if res else None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axe] statement store failed: %s", exc)
    ent = float(data.get("entrate") or sum(float(m.get("importo") or 0) for m in movs if float(m.get("importo") or 0) > 0))
    usc = abs(float(data.get("uscite") or sum(float(m.get("importo") or 0) for m in movs if float(m.get("importo") or 0) < 0)))
    doc = {"report_id": rid, "tenant_id": tid, "user_id": user["user_id"], "user_name": user.get("name") or user.get("email"), "sphere": sphere, "bank": data.get("banca"), "period": data.get("periodo"),
           "opening": data.get("saldo_iniziale"), "closing": data.get("saldo_finale"), "income": round(ent, 2), "outcome": round(usc, 2), "net": round(ent - usc, 2), "movements": movs,
           "by_category": data.get("per_categoria") or [], "insights": (data.get("insight") or [])[:6], "anomalies": (data.get("anomalie") or [])[:6], "file_path": path, "file_mime": mime,
           "name": body.name, "created_at": utcnow()}
    await db.axon_statement_reports.insert_one(dict(doc))
    out = _axe_out(doc)
    out["reply"] = (f"{_AXE_ICON[sphere]} **Estratto conto analizzato** ({doc.get('bank') or 'banca'}, {doc.get('period') or 'periodo n/d'}): entrate {ent:.2f} € · uscite {usc:.2f} € · saldo netto {ent - usc:+.2f} €. "
                    f"{len(movs)} movimenti categorizzati. Report salvato in Sezione Report → Estratti conto.")
    return {"ok": True, "report": out}


@api_router.get("/axon/expenses/statements")
async def axe_statements(sphere: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"tenant_id": tenant_id(user), "user_id": user["user_id"]}
    if sphere:
        q["sphere"] = _axe_sphere(sphere)
    items = [_axe_out({k: v for k, v in d.items() if k != "movements"}) async for d in db.axon_statement_reports.find(q, {"_id": 0}).sort("created_at", -1).limit(50)]
    return {"items": items}


@api_router.get("/axon/expenses/statements/{report_id}")
async def axe_statement_get(report_id: str, user=Depends(get_current_user)):
    d = await db.axon_statement_reports.find_one({"report_id": report_id, "tenant_id": tenant_id(user), "user_id": user["user_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Report non trovato")
    return _axe_out(d)


@api_router.delete("/axon/expenses/statements/{report_id}")
async def axe_statement_del(report_id: str, user=Depends(get_current_user)):
    r = await db.axon_statement_reports.delete_one({"report_id": report_id, "tenant_id": tenant_id(user), "user_id": user["user_id"]})
    return {"ok": True, "deleted": r.deleted_count}


# ============================================================================ CHAT «quanto ho speso questo mese?»
_AXE_CHAT_RE = re.compile(r"\b(quanto ho speso|nota spese|spese (di|del) (questo )?mese|totale spese|riepilogo spese)\b", re.IGNORECASE)
_axe_prev_maybe_push_command = _maybe_push_command


async def _maybe_push_command(msg: str, user: dict) -> Optional[dict]:  # noqa: F811
    txt = (msg or "").strip()
    try:
        if txt and len(txt) <= 120 and _AXE_CHAT_RE.search(txt):
            sphere = "home" if re.search(r"\b(personal\w*|casa|private?|home)\b", txt, re.IGNORECASE) else "business"
            month = utcnow().strftime("%Y-%m")
            mm = re.search(r"\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b", txt, re.IGNORECASE)
            if mm:
                mi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"].index(mm.group(1).lower()) + 1
                month = f"{utcnow().year}-{mi:02d}"
            r = await axe_list(sphere, month, None, user)
            if not r["items"]:
                return {"reply": f"{_AXE_ICON[sphere]} Nessuna spesa {sphere.title()} registrata per {month}. Fotografa uno scontrino e lo aggiungo io alla nota spese.", "cmd": "expenses_summary"}
            cats = " · ".join(f"{k} {v:.2f} €" for k, v in sorted(r["by_category"].items(), key=lambda kv: -kv[1]))
            return {"reply": f"{_AXE_ICON[sphere]} **Nota spese {sphere.title()} · {month}**: **{r['total']:.2f} €** su {len(r['items'])} scontrini.\n{cats}\n\nPDF ed elenco completo in *Sezione Report → Nota spese*.", "cmd": "expenses_summary"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axe] chat failed: %s", exc)
    return await _axe_prev_maybe_push_command(msg, user)


@app.on_event("startup")
async def _axe_start():
    try:
        await db.axon_expenses.create_index([("tenant_id", 1), ("sphere", 1), ("month", 1), ("user_id", 1)])
        await db.axon_expenses.create_index([("expense_id", 1)], unique=True)
        await db.axon_statement_reports.create_index([("tenant_id", 1), ("user_id", 1), ("created_at", -1)])
        logger.info("[axe] expenses module armed")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[axe] start failed: %s", exc)
