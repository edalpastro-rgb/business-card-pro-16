# axon_pun_history.py — V50.z469 — Feature 5/15: «Storico PUN» (widget Home cliccabile) — modulo ISOLATO
#
# Caricato DOPO axon_pun_quick.py. Riusa `_punq_table` (cache `gme_pun_cache`, mesi chiusi, riga 🟡 mese corrente) e reportlab.
# 1) `GET /pun/history?months=18` → righe pronte per la schermata app (Mese · F1 · F2 · F3 · monorario in €/kWh, + mese corrente parziale).
# 2) `GET /pun/history/pdf?months=18` → PDF A4 (reportlab) generato lato server: usato dal web (download affidabile) e come
#    fallback; su nativo la app genera lo stesso PDF con expo-print (funziona anche offline con i dati già caricati).

import io as _punh_io


def _punh_rows(t: dict) -> List[dict]:
    rows = []
    for r in reversed(t["rows"]):  # cronologico: dal più vecchio al più recente
        k = r.get("kwh") or {}
        rows.append({"month_key": r["month_key"], "label": r["label"], "available": bool(r["available"]), "F1": k.get("F1"), "F2": k.get("F2"), "F3": k.get("F3"),
                     "monorario": k.get("monorario"), "delta_pct": r.get("delta_pct"), "is_max": r.get("is_max") or [], "is_min": r.get("is_min") or [], "kind": "closed"})
    fc = t.get("forecast")
    if fc:
        k = fc.get("kwh") or {}
        rows.append({"month_key": fc["month_key"], "label": fc["label"], "available": True, "F1": k.get("F1"), "F2": k.get("F2"), "F3": k.get("F3"), "monorario": k.get("monorario"),
                     "delta_pct": None, "is_max": [], "is_min": [], "kind": fc.get("kind") or "forecast", "basis": fc.get("basis"), "days": fc.get("days")})
    return rows


@api_router.get("/pun/history")
async def punh_history(months: int = _PUNQ_DEFAULT_MONTHS, user=Depends(get_current_user)):
    n = max(1, min(months, 36))
    t = await _punq_table(n)
    return {"months": n, "unit": "€/kWh", "rows": _punh_rows(t), "missing": t.get("missing") or [], "cache_updated_at": t.get("cache_updated_at"),
            "generated_at": t.get("generated_at"), "source": "GME — Prezzo medio per fasce (PDF ufficiali mensili) · mese corrente: media parziale esiti MGP"}


def _punh_render_pdf(rows: List[dict], n: int, updated: Optional[str], owner: str, signature: str = "") -> bytes:
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.pdfgen import canvas as _canvas  # type: ignore
    from reportlab.lib.units import mm  # type: ignore
    from reportlab.lib import colors as _colors  # type: ignore
    buf = _punh_io.BytesIO(); c = _canvas.Canvas(buf, pagesize=A4); W, H = A4; y = H - 20 * mm

    def fmt(v):
        return "n/d" if v is None else f"{v:.4f}".replace(".", ",")

    def header():
        nonlocal y
        y = H - 20 * mm
        c.setFont("Helvetica-Bold", 16); c.drawString(20 * mm, y, f"Storico PUN — ultimi {n} mesi (€/kWh)"); y -= 7 * mm
        c.setFont("Helvetica", 9.5); c.setFillColor(_colors.HexColor("#64748B"))
        c.drawString(20 * mm, y, f"Fonte: GME, Prezzo medio per fasce (PDF ufficiali) · Dati aggiornati al {updated or '—'} · Generato da AdvisorOS il {utcnow().strftime('%d/%m/%Y')} per {owner}")
        c.setFillColor(_colors.black); y -= 9 * mm
        c.setFillColor(_colors.HexColor("#1B2B4B")); c.rect(20 * mm, y - 2.5 * mm, 170 * mm, 8 * mm, fill=1, stroke=0); c.setFillColor(_colors.white); c.setFont("Helvetica-Bold", 9.5)
        for x, h in ((22, "Mese"), (70, "Monorario"), (100, "F1"), (128, "F2"), (156, "F3"), (182, "Δ mese")):
            (c.drawString if h == "Mese" else c.drawRightString)((x + (0 if h == "Mese" else 14)) * mm, y, h)
        c.setFillColor(_colors.black); y -= 9 * mm; c.setFont("Helvetica", 9.5)

    header()
    for r in rows:
        if y < 25 * mm:
            c.showPage(); header()
        tint = {"partial": "#FEF9C3", "forecast": "#FEF9C3", "provisional": "#FEF9C3"}.get(r.get("kind") or "")
        if not tint and "monorario" in (r.get("is_max") or []): tint = "#FEE2E2"
        if not tint and "monorario" in (r.get("is_min") or []): tint = "#DCFCE7"
        if tint:
            c.setFillColor(_colors.HexColor(tint)); c.rect(20 * mm, y - 2 * mm, 170 * mm, 6.5 * mm, fill=1, stroke=0); c.setFillColor(_colors.black)
        lab = r["label"] + (" (parziale)" if r.get("kind") == "partial" else " (previsione)" if r.get("kind") == "forecast" else " (provvisorio)" if r.get("kind") == "provisional" else "")
        c.setFont("Helvetica-Bold" if r.get("kind") not in (None, "closed") else "Helvetica", 9.5); c.drawString(22 * mm, y, lab[:34])
        if not r["available"]:
            c.setFillColor(_colors.HexColor("#94A3B8")); c.drawString(70 * mm, y, "n/d — PDF GME non in cache"); c.setFillColor(_colors.black)
        else:
            for x, k in ((84, "monorario"), (114, "F1"), (142, "F2"), (170, "F3")):
                c.drawRightString(x * mm, y, fmt(r.get(k)))
            d = r.get("delta_pct")
            c.drawRightString(196 * mm, y, "—" if d is None else f"{'+' if d > 0 else ''}{str(d).replace('.', ',')}%")
        y -= 6.5 * mm
    y -= 4 * mm; c.setFont("Helvetica-Oblique", 8.5); c.setFillColor(_colors.HexColor("#64748B"))
    c.drawString(20 * mm, y, "Legenda: rosso = mese più caro (monorario) · verde = mese più economico · giallo = mese corrente (media parziale GME, non definitiva).")
    y -= 4.5 * mm; c.drawString(20 * mm, y, "Fasce ARERA: F1 lun–ven 8–19 · F2 lun–ven 7–8 e 19–23, sabato 7–23 · F3 notte, domeniche e festivi. Prezzi all'ingrosso, IVA e oneri esclusi.")
    if signature:
        c.drawCentredString(W / 2, 12 * mm, signature[:180])
    c.showPage(); c.save()
    return buf.getvalue()


@api_router.get("/pun/history/pdf")
async def punh_history_pdf(months: int = _PUNQ_DEFAULT_MONTHS, user=Depends(get_current_user)):
    n = max(1, min(months, 36))
    t = await _punq_table(n)
    rows = _punh_rows(t)
    upd = t.get("cache_updated_at")
    try:
        upd_s = datetime.fromisoformat(upd).astimezone(_PUNQ_TZ).strftime("%d/%m/%Y") if upd else None
    except Exception:  # noqa: BLE001
        upd_s = upd
    sig = ""
    try:
        sig = await _ob_signature(tenant_id(user)) or ""
    except Exception:  # noqa: BLE001
        pass
    pdf = _punh_render_pdf(rows, n, upd_s, user.get("name") or user.get("email") or "", sig)
    fname = f"Storico_PUN_{n}_mesi_{utcnow().strftime('%Y%m%d')}.pdf"
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})


_OMNI_EXTRA_SECTIONS.append((
    "Storico PUN (schermata app)", "/pun/history",
    "Il widget PUN nella Home è cliccabile: apre la schermata «Storico PUN» (route app `/pun-storico`) con la tabella degli ultimi 18 mesi "
    "(Mese · Monorario · F1 · F2 · F3 in €/kWh, dati GME dalla cache backend, mese corrente parziale) e il bottone «Scarica PDF» / «Condividi». "
    "Se l'utente chiede dove vedere lo storico PUN o come scaricarlo in PDF, indica il widget PUN della Home → Storico PUN → PDF.",
))
