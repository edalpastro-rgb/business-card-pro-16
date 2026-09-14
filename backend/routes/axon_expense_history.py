# axon_expense_history.py — V50.z229 — Storico spese: selezione/scarto ricevute, chiusura mese → PDF in Master Files (cartella anno/mese),
# archivio report, statistiche (mese vs precedente, vs stesso mese anno prima, per categoria/area, insight comportamentali «dieta di spesa»).
# Modulo ISOLATO, caricato dopo axon_expenses.py. Riusa: _axe_scope/_axe_sphere/_axe_out/_AXE_CATS/_AXE_ICON, _upl_master_store, reportlab.
#
# Stato spesa (`axon_expenses.status`): assente/"open" = da valutare · "discarded" = scartata (non entra nel mese) · "closed" = inclusa in un report.
# `axon_expense_reports {report_id, tenant_id, user_id, sphere, month, year, name, total, count, by_category, file_id, created_at}`.

_AXH_MONTHS_IT = ["", "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]
_AXH_CAT_LABEL = {"spesa": "Spesa alimentare", "casa": "Casa", "svago": "Svago", "salute": "Salute", "trasporti": "Trasporti", "abbigliamento": "Abbigliamento", "altro": "Altro",
                  "carburante": "Carburante", "vitto": "Vitto", "alloggio": "Alloggio", "ufficio": "Ufficio", "telefonia": "Telefonia", "formazione": "Formazione", "rappresentanza": "Rappresentanza"}


def _axh_month_label(month: str) -> str:
    try:
        y, m = month.split("-"); return f"{_AXH_MONTHS_IT[int(m)]} {y}"
    except Exception:  # noqa: BLE001
        return month


def _axh_shift(month: str, delta: int) -> str:
    y, m = int(month[:4]), int(month[5:7]); m += delta
    while m <= 0: m += 12; y -= 1
    while m > 12: m -= 12; y += 1
    return f"{y:04d}-{m:02d}"


class AxhStatusIn(BaseModel):
    status: str  # open | discarded


@api_router.patch("/axon/expenses/{expense_id}/status")
async def axh_status(expense_id: str, body: AxhStatusIn, user=Depends(get_current_user)):
    if body.status not in ("open", "discarded"):
        raise HTTPException(status_code=400, detail="status: open | discarded")
    r = await db.axon_expenses.update_one({"expense_id": expense_id, "tenant_id": tenant_id(user), "user_id": user["user_id"], "status": {"$ne": "closed"}},
                                          {"$set": {"status": body.status, "updated_at": utcnow()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Spesa non trovata o già inclusa in un mese chiuso")
    return {"ok": True}


def _axh_render_pdf(items: List[dict], sphere: str, month: str, owner: str, signature: str = "") -> bytes:
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.pdfgen import canvas as _canvas  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    import io as _io
    buf = _io.BytesIO(); c = _canvas.Canvas(buf, pagesize=A4); W, H = A4; y = H - 20 * mm
    c.setFont("Helvetica-Bold", 16); c.drawString(20 * mm, y, f"Note spese {_axh_month_label(month)} — {'Business' if sphere == 'business' else 'Home'}"); y -= 8 * mm
    c.setFont("Helvetica", 10); c.drawString(20 * mm, y, f"Intestatario: {owner}   ·   Mese chiuso da AxonOS il {utcnow().strftime('%d/%m/%Y')}   ·   {len(items)} spese"); y -= 10 * mm
    c.setFont("Helvetica-Bold", 10)
    for x, h in ((20, "Data"), (45, "Esercente"), (115, "Categoria"), (150, "Pagamento"), (175, "Importo €")):
        c.drawString(x * mm, y, h)
    y -= 3 * mm; c.line(20 * mm, y, 190 * mm, y); y -= 5 * mm; c.setFont("Helvetica", 9.5); tot = 0.0
    for it in items:
        if y < 25 * mm:
            c.showPage(); y = H - 20 * mm; c.setFont("Helvetica", 9.5)
        c.drawString(20 * mm, y, it.get("date") or ""); c.drawString(45 * mm, y, (it.get("merchant") or "")[:38]); c.drawString(115 * mm, y, _AXH_CAT_LABEL.get(it.get("category") or "", it.get("category") or ""))
        c.drawString(150 * mm, y, (it.get("payment") or "-")[:10]); c.drawRightString(190 * mm, y, f"{float(it.get('amount') or 0):.2f}"); tot += float(it.get("amount") or 0); y -= 5.5 * mm
    y -= 3 * mm; c.line(20 * mm, y, 190 * mm, y); y -= 7 * mm; c.setFont("Helvetica-Bold", 12); c.drawRightString(190 * mm, y, f"TOTALE: {tot:.2f} €")
    by_cat: Dict[str, float] = {}
    for it in items:
        by_cat[it["category"]] = by_cat.get(it["category"], 0) + float(it.get("amount") or 0)
    y -= 10 * mm; c.setFont("Helvetica-Bold", 10); c.drawString(20 * mm, y, "Per categoria / area:"); c.setFont("Helvetica", 9.5)
    for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        y -= 5 * mm; c.drawString(25 * mm, y, f"• {_AXH_CAT_LABEL.get(k, k)}: {v:.2f} €  ({(v / tot * 100) if tot else 0:.0f}%)")
    if signature:  # V50.z232 — firma aziendale (Personalizzazione Aziendale)
        c.setFont("Helvetica-Oblique", 8.5); c.drawCentredString(W / 2, 12 * mm, signature[:180])
    c.showPage(); c.save()
    return buf.getvalue()


class AxhCloseIn(BaseModel):
    sphere: str = "home"
    month: Optional[str] = None
    expense_ids: List[str] = []


@api_router.post("/axon/expenses/close-month")
async def axh_close_month(body: AxhCloseIn, user=Depends(get_current_user)):
    """Chiude il mese con le spese SELEZIONATE → PDF «Note spese <Mese Anno>» in I miei file (cartella spese/<anno>/<mese>) + report in archivio."""
    sphere = _axe_sphere(body.sphere); month = (body.month or utcnow().strftime("%Y-%m"))[:7]
    if not body.expense_ids:
        raise HTTPException(status_code=400, detail="Seleziona almeno una spesa")
    q = {"tenant_id": tenant_id(user), "user_id": user["user_id"], "sphere": sphere, "expense_id": {"$in": body.expense_ids}, "status": {"$nin": ["closed", "discarded"]}}
    items = [d async for d in db.axon_expenses.find(q, {"_id": 0}).sort("date", 1)]
    if not items:
        raise HTTPException(status_code=400, detail="Nessuna spesa selezionabile (già chiuse o scartate)")
    owner = user.get("name") or user.get("email") or ""
    pdf = await run_in_threadpool(_axh_render_pdf, items, sphere, month, owner, await _ob_signature(tenant_id(user)))
    name = f"Note spese {_axh_month_label(month)} - {'Business' if sphere == 'business' else 'Home'}.pdf"
    import tempfile as _tf, hashlib as _hl
    with _tf.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(pdf)
    saved = await _upl_master_store(user, "files", name, "application/pdf", tmp.name, len(pdf), _hl.sha256(pdf).hexdigest(), f"Note spese · {month[:4]} · {_AXH_MONTHS_IT[int(month[5:7])]}")
    rid = f"axr_{uuid.uuid4().hex[:10]}"
    await db.master_files.update_one({"file_id": saved["file_id"]}, {"$set": {"folder": "spese", "expense_month": month, "expense_year": month[:4], "report_id": rid, "source": "expense-history"}})
    by_cat: Dict[str, float] = {}
    for it in items:
        by_cat[it["category"]] = round(by_cat.get(it["category"], 0) + float(it["amount"]), 2)
    total = round(sum(float(i["amount"]) for i in items), 2)
    rep = {"report_id": rid, "tenant_id": tenant_id(user), "user_id": user["user_id"], "sphere": sphere, "month": month, "year": month[:4], "name": name, "label": _axh_month_label(month),
           "total": total, "count": len(items), "by_category": by_cat, "file_id": saved["file_id"], "expense_ids": [i["expense_id"] for i in items], "created_at": utcnow()}
    await db.axon_expense_reports.insert_one(dict(rep))
    await db.axon_expenses.update_many({"expense_id": {"$in": rep["expense_ids"]}}, {"$set": {"status": "closed", "report_id": rid, "updated_at": utcnow()}})
    rep.pop("_id", None); rep["created_at"] = rep["created_at"].isoformat()
    return {"ok": True, "report": rep, "file": {"file_id": saved["file_id"], "name": name}}


@api_router.get("/axon/expenses/reports")
async def axh_reports(sphere: Optional[str] = None, user=Depends(get_current_user)):
    q: Dict[str, Any] = {"tenant_id": tenant_id(user), "user_id": user["user_id"]}
    if sphere:
        q["sphere"] = _axe_sphere(sphere)
    years: Dict[str, list] = {}
    async for r in db.axon_expense_reports.find(q, {"_id": 0}).sort("month", -1):
        r["created_at"] = r["created_at"].isoformat() if isinstance(r.get("created_at"), datetime) else r.get("created_at")
        years.setdefault(r["year"], []).append(r)
    return {"years": [{"year": y, "total": round(sum(r["total"] for r in rs), 2), "reports": rs} for y, rs in sorted(years.items(), reverse=True)]}


@api_router.delete("/axon/expenses/reports/{report_id}")
async def axh_report_delete(report_id: str, user=Depends(get_current_user)):
    """Riapre il mese: spese tornano «open», PDF rimosso da I miei file."""
    rep = await db.axon_expense_reports.find_one({"report_id": report_id, "user_id": user["user_id"]}, {"_id": 0})
    if not rep:
        raise HTTPException(status_code=404, detail="Report non trovato")
    await db.axon_expenses.update_many({"expense_id": {"$in": rep.get("expense_ids") or []}}, {"$set": {"status": "open", "updated_at": utcnow()}, "$unset": {"report_id": ""}})
    await db.master_files.delete_one({"file_id": rep.get("file_id"), "user_id": tenant_id(user)})
    await db.axon_expense_reports.delete_one({"report_id": report_id})
    return {"ok": True}


@api_router.get("/axon/expenses/stats")
async def axh_stats(sphere: str = "home", month: Optional[str] = None, user=Depends(get_current_user)):
    """Statistiche: serie 12 mesi, confronto mese precedente / stesso mese anno prima, per categoria (area), insight comportamentali."""
    sphere = _axe_sphere(sphere); month = (month or utcnow().strftime("%Y-%m"))[:7]
    base = {"tenant_id": tenant_id(user), "user_id": user["user_id"], "sphere": sphere, "status": {"$ne": "discarded"}}
    months = [_axh_shift(month, -i) for i in range(11, -1, -1)]
    prev, last_year = _axh_shift(month, -1), _axh_shift(month, -12)
    rows = await db.axon_expenses.aggregate([{"$match": {**base, "month": {"$in": list(set(months + [last_year]))}}},
                                             {"$group": {"_id": {"m": "$month", "c": "$category"}, "t": {"$sum": "$amount"}, "n": {"$sum": 1}}}]).to_list(5000)
    per_month: Dict[str, float] = {m: 0.0 for m in months}; per_month.setdefault(last_year, 0.0)
    cnt_month: Dict[str, int] = {}
    cat_month: Dict[str, Dict[str, float]] = {}
    for r in rows:
        m, c = r["_id"]["m"], r["_id"]["c"] or "altro"
        per_month[m] = round(per_month.get(m, 0) + float(r["t"]), 2); cnt_month[m] = cnt_month.get(m, 0) + int(r["n"])
        cat_month.setdefault(m, {})[c] = round(cat_month.get(m, {}).get(c, 0) + float(r["t"]), 2)
    cur, pv, ly = per_month.get(month, 0.0), per_month.get(prev, 0.0), per_month.get(last_year, 0.0)
    def _delta(a: float, b: float) -> dict:
        return {"abs": round(a - b, 2), "pct": (round((a - b) / b * 100, 1) if b else None), "saving": round(b - a, 2)}
    filled = [per_month[m] for m in months[:-1] if per_month.get(m)]
    avg6 = round(sum([per_month[m] for m in months[-7:-1]]) / max(1, len([m for m in months[-7:-1] if per_month.get(m)])), 2) if any(per_month.get(m) for m in months[-7:-1]) else 0.0
    cats_cur = cat_month.get(month, {}); cats_prev = cat_month.get(prev, {})
    by_cat = sorted([{"category": c, "label": _AXH_CAT_LABEL.get(c, c), "total": v, "share": round(v / cur * 100, 1) if cur else 0.0, "prev": cats_prev.get(c, 0.0),
                      "delta_pct": (round((v - cats_prev[c]) / cats_prev[c] * 100, 1) if cats_prev.get(c) else None)} for c, v in cats_cur.items()], key=lambda x: -x["total"])
    # profilo comportamentale: quota media per categoria negli ultimi 6 mesi (la «dieta» abituale) vs mese corrente
    hist_tot = sum(per_month.get(m, 0) for m in months[-7:-1]) or 0.0
    hist_cat: Dict[str, float] = {}
    for m in months[-7:-1]:
        for c, v in cat_month.get(m, {}).items():
            hist_cat[c] = hist_cat.get(c, 0) + v
    habits = sorted([{"category": c, "label": _AXH_CAT_LABEL.get(c, c), "share_avg": round(v / hist_tot * 100, 1) if hist_tot else 0.0,
                      "share_now": round(cats_cur.get(c, 0) / cur * 100, 1) if cur else 0.0} for c, v in hist_cat.items()], key=lambda x: -x["share_avg"])
    insights: List[str] = []
    ml = _axh_month_label(month)
    if cur and pv:
        d = _delta(cur, pv)
        insights.append(f"{'Risparmio' if d['saving'] > 0 else 'Spesa in più'} di {abs(d['saving']):.2f} € rispetto a {_axh_month_label(prev)} ({d['pct']:+.1f}%).")
    if cur and ly:
        d = _delta(cur, ly)
        insights.append(f"Rispetto a {_axh_month_label(last_year)}: {d['pct']:+.1f}% ({d['abs']:+.2f} €).")
    if by_cat:
        top = by_cat[0]
        insights.append(f"Area principale a {ml}: {top['label']} ({top['share']:.0f}% del totale, {top['total']:.2f} €).")
    for h in habits[:6]:
        if h["share_now"] and h["share_avg"] and abs(h["share_now"] - h["share_avg"]) >= 8:
            insights.append(f"{h['label']}: {h['share_now']:.0f}% del mese contro un'abitudine del {h['share_avg']:.0f}% → {'sopra' if h['share_now'] > h['share_avg'] else 'sotto'} la tua dieta di spesa abituale.")
    if cnt_month.get(month):
        insights.append(f"{cnt_month[month]} spese a {ml}, scontrino medio {cur / cnt_month[month]:.2f} €.")
    if avg6 and cur:
        insights.append(f"Media degli ultimi 6 mesi: {avg6:.2f} € → {ml} è {'sotto' if cur < avg6 else 'sopra'} media del {abs(cur - avg6) / avg6 * 100:.0f}%.")
    return {"sphere": sphere, "sphere_icon": _AXE_ICON[sphere], "month": month, "month_label": ml, "total": cur, "count": cnt_month.get(month, 0),
            "series": [{"month": m, "label": _axh_month_label(m), "total": per_month.get(m, 0.0), "count": cnt_month.get(m, 0)} for m in months],
            "vs_prev": {"month": prev, "label": _axh_month_label(prev), "total": pv, **_delta(cur, pv)},
            "vs_last_year": {"month": last_year, "label": _axh_month_label(last_year), "total": ly, **_delta(cur, ly)},
            "avg_6m": avg6, "by_category": by_cat, "habits": habits, "insights": insights, "has_history": bool(filled)}
