# 15_cte_quick_bills.py — CTE comparativa + Quick Bill Analysis
# Estratto da server.py (righe originali 7689-8919). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# v2.12 (Feb 2026) — CTE Comparativa (multi-bill upload + comparative report)
# Consultant uploads several PDFs at once for a client. Backend enqueues each
# as an energy_bill, background task analyses them, then a dedicated endpoint
# builds a comparative HTML report with SVG charts + AI verdict.
# =========================

class BulkBillItem(BaseModel):
    bill_type: str  # luce | gas | telco
    pdf_base64: str
    pdf_name: Optional[str] = None
    pdf_mime: Optional[str] = "application/pdf"


class BulkBillsIn(BaseModel):
    bills: List[BulkBillItem] = Field(default_factory=list)


@api_router.post("/contacts/{contact_id}/bills/bulk-upload")
async def bulk_upload_bills(contact_id: str, body: BulkBillsIn, background: BackgroundTasks, user=Depends(get_current_user)):
    """v2.12 — Upload N bills for a contact in a single request. Each bill
    is created as pending and analysed asynchronously (mirrors create_bill)."""
    await _ensure_contact_owned(contact_id, user)
    if not body.bills:
        raise HTTPException(status_code=400, detail="Nessuna fattura fornita")
    if len(body.bills) > 20:
        raise HTTPException(status_code=400, detail="Massimo 20 fatture per volta")
    created: List[dict] = []
    for item in body.bills:
        if item.bill_type not in BILL_TYPES:
            continue
        b64 = item.pdf_base64
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        approx_size = int(len(b64) * 0.75)
        if approx_size > 12 * 1024 * 1024:
            continue  # skip oversized silently — user gets a partial success
        bill_id = f"bill_{uuid.uuid4().hex[:12]}"
        doc = {
            "bill_id": bill_id,
            "contact_id": contact_id,
            "user_id": tenant_id(user),
            "created_by": user["user_id"],
            "bill_type": item.bill_type,
            "pdf_base64": item.pdf_base64,
            "pdf_name": item.pdf_name or f"fattura-{item.bill_type}.pdf",
            "pdf_mime": item.pdf_mime or "application/pdf",
            "pdf_size": approx_size,
            "status": "pending",
            "extracted": None,
            "error_message": None,
            "analysis_params": None,
            "created_at": utcnow(),
            "analyzed_at": None,
        }
        await db.energy_bills.insert_one(doc)
        background.add_task(_analyze_bill_task, bill_id)
        created.append({"bill_id": bill_id, "bill_type": item.bill_type, "pdf_name": doc["pdf_name"]})
    return {"ok": True, "created": created, "count": len(created)}


def _fmt_eur(n: Any) -> str:
    try:
        v = float(n)
        return f"€ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "—"


def _num(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        return float(x)
    except Exception:
        s = str(x).replace(".", "").replace(",", ".").strip()
        try:
            return float("".join(ch for ch in s if ch.isdigit() or ch in ".-"))
        except Exception:
            return None


def _build_cte_report_html(contact: dict, bills: List[dict], ai_verdict: dict, branding: dict) -> str:
    """v2.12 — Build a comparative HTML report with SVG charts.
    - Trend spesa nel tempo (bar per bill sorted by created_at)
    - Confronto fornitori per bill_type (table)
    - AI verdict per bill_type
    """
    def esc(s):
        return (str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

    section_meta = {
        "luce": ("Luce", "#F59E0B", "💡"),
        "gas": ("Gas", "#DC2626", "🔥"),
        "telco": ("Telco", "#0891B2", "📞"),
    }

    # Enrich bills with numeric spend + consumption
    enriched: List[dict] = []
    for b in bills:
        ex = b.get("extracted") or {}
        totale = _num(ex.get("importo_totale") or ex.get("importo_totale_eur"))
        consumo = _num(ex.get("consumo_annuo") or ex.get("consumo_annuo_smc") or ex.get("consumo_totale_12_mesi"))
        fornitore = str(ex.get("fornitore") or "—").strip() or "—"
        enriched.append({
            **b,
            "fornitore": fornitore,
            "totale": totale,
            "consumo": consumo,
            "when": b.get("created_at"),
        })

    # SVG bar chart: spesa nel tempo (max 20 bars)
    def spend_chart():
        items = [x for x in enriched if x["totale"] is not None]
        items = sorted(items, key=lambda x: str(x.get("when") or ""))[-20:]
        if not items:
            return ""
        W, H, PL, PR, PT, PB = 700, 220, 46, 12, 20, 60
        chart_w = W - PL - PR
        chart_h = H - PT - PB
        max_v = max((x["totale"] for x in items), default=0) or 1
        bar_w = max(6, (chart_w / len(items)) - 6)
        y_ticks = [0, 0.25, 0.5, 0.75, 1]
        grid = "".join(
            f'<line x1="{PL}" y1="{PT + chart_h - chart_h*t}" x2="{W-PR}" y2="{PT + chart_h - chart_h*t}" stroke="#E5E7EB" stroke-width="1"/>'
            f'<text x="{PL-4}" y="{PT + chart_h - chart_h*t + 3}" font-size="9" fill="#6B7280" text-anchor="end">{int(max_v*t)}</text>'
            for t in y_ticks
        )
        bars = ""
        for i, x in enumerate(items):
            v = x["totale"]
            h = (v / max_v) * chart_h
            bx = PL + i * (bar_w + 6)
            by = PT + chart_h - h
            color = section_meta.get(x.get("bill_type", ""), ("", "#6366F1", ""))[1]
            label_short = (x.get("fornitore") or "—")[:10]
            when = ""
            try:
                when = (x.get("when") or "").strftime("%m/%y") if hasattr(x.get("when"), "strftime") else str(x.get("when"))[:7]
            except Exception:
                when = str(x.get("when"))[:7]
            bars += (
                f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bar_w:.1f}" height="{h:.1f}" fill="{color}" rx="3"/>'
                f'<text x="{bx + bar_w/2:.1f}" y="{by-3:.1f}" font-size="8" fill="#374151" text-anchor="middle">€{int(v)}</text>'
                f'<text x="{bx + bar_w/2:.1f}" y="{H - PB + 12}" font-size="8" fill="#6B7280" text-anchor="middle">{esc(label_short)}</text>'
                f'<text x="{bx + bar_w/2:.1f}" y="{H - PB + 24}" font-size="8" fill="#94A3B8" text-anchor="middle">{esc(when)}</text>'
            )
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 {W} {H}">{grid}{bars}</svg>'

    # Supplier comparison table per bill_type
    supplier_tables = ""
    for bt, (lbl, color, emoji) in section_meta.items():
        rows_bt = [x for x in enriched if x.get("bill_type") == bt]
        if not rows_bt:
            continue
        # Group by supplier
        by_sup: Dict[str, dict] = {}
        for r in rows_bt:
            sup = r["fornitore"] or "—"
            agg = by_sup.setdefault(sup, {"count": 0, "totali": [], "consumi": []})
            agg["count"] += 1
            if r["totale"] is not None:
                agg["totali"].append(r["totale"])
            if r["consumo"] is not None:
                agg["consumi"].append(r["consumo"])
        rows_html = ""
        best_sup = None
        best_spesa = None
        for sup, agg in by_sup.items():
            avg = sum(agg["totali"]) / len(agg["totali"]) if agg["totali"] else None
            if avg is not None and (best_spesa is None or avg < best_spesa):
                best_spesa = avg
                best_sup = sup
        for sup, agg in by_sup.items():
            avg = sum(agg["totali"]) / len(agg["totali"]) if agg["totali"] else None
            cons_avg = sum(agg["consumi"]) / len(agg["consumi"]) if agg["consumi"] else None
            is_best = sup == best_sup and len(by_sup) > 1
            badge = ' <span style="background:#DCFCE7;color:#166534;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:800;margin-left:6px;">più conveniente</span>' if is_best else ""
            rows_html += (
                f'<tr><td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-weight:700;color:#0F172A;font-size:12px;">{esc(sup)}{badge}</td>'
                f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px;">{agg["count"]}</td>'
                f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px;">{_fmt_eur(avg) if avg is not None else "—"}</td>'
                f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px;">{("%.0f" % cons_avg) if cons_avg is not None else "—"}</td>'
                '</tr>'
            )
        supplier_tables += (
            f'<h3 style="color:{color};font-size:16px;margin:22px 0 8px;">{emoji} {lbl} — {len(rows_bt)} fatture</h3>'
            f'<table style="width:100%;border-collapse:collapse;background:#FFF;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">'
            f'<thead><tr style="background:#F8FAFC;"><th style="text-align:left;padding:8px 10px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">Fornitore</th>'
            f'<th style="text-align:left;padding:8px 10px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">Fatture</th>'
            f'<th style="text-align:left;padding:8px 10px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">Spesa media</th>'
            f'<th style="text-align:left;padding:8px 10px;font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">Consumo medio</th></tr></thead>'
            f'<tbody>{rows_html}</tbody></table>'
        )

    # AI verdict per bill_type
    verdict_blocks = ""
    for bt, (lbl, color, emoji) in section_meta.items():
        v = (ai_verdict or {}).get(bt)
        if not v:
            continue
        verdict_blocks += (
            f'<div style="background:{color}18;border-left:4px solid {color};padding:12px 14px;border-radius:8px;margin-top:10px;">'
            f'<div style="font-weight:800;color:{color};font-size:13px;margin-bottom:4px;">{emoji} {lbl}</div>'
            f'<div style="font-size:12px;color:#0F172A;line-height:1.5;">{esc(v)}</div></div>'
        )
    verdict_html = f'<h2 style="font-size:18px;color:#1E3A5F;margin-top:26px;">Suggerimento AI — Fornitore più conveniente</h2>{verdict_blocks}' if verdict_blocks else ""

    contact_name = f"{contact.get('first_name','')} {contact.get('last_name','')}".strip() or "Cliente"
    agency = esc(branding.get("agency_name") or "")
    logo_b64 = branding.get("logo_base64") or ""
    logo_html = f'<img src="data:image/png;base64,{logo_b64}" style="height:48px;object-fit:contain;"/>' if logo_b64 else ""
    generated_at = utcnow().strftime("%d/%m/%Y ore %H:%M")

    html = f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CTE Comparativa — {esc(contact_name)}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; margin: 0; padding: 0; background: #F8FAFC; }}
  .wrap {{ max-width: 900px; margin: 0 auto; padding: 22px 20px 48px; background: #FFF; }}
  header {{ display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #1E3A5F; padding-bottom: 12px; margin-bottom: 18px; }}
  header h1 {{ font-size: 22px; margin: 0; color: #1E3A5F; }}
  header .sub {{ font-size: 12px; color: #64748B; margin-top: 2px; }}
  .chart-card {{ background: #FFF; border-radius: 12px; padding: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); margin-top: 16px; }}
  h2 {{ font-size: 18px; color: #1E3A5F; margin: 26px 0 10px; }}
  .kpi-row {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0; }}
  .kpi {{ background: #EEF2FF; border-radius: 10px; padding: 12px; text-align: center; }}
  .kpi .n {{ font-size: 22px; font-weight: 800; color: #1E3A5F; }}
  .kpi .l {{ font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: .4px; margin-top: 2px; }}
</style></head><body>
<div class="wrap">
  <header>
    {logo_html}
    <div>
      <h1>CTE Comparativa</h1>
      <div class="sub">Cliente: <strong>{esc(contact_name)}</strong> · Generato il {generated_at}{(' · ' + agency) if agency else ''}</div>
    </div>
  </header>

  <div class="kpi-row">
    <div class="kpi"><div class="n">{len(bills)}</div><div class="l">Fatture analizzate</div></div>
    <div class="kpi"><div class="n">{len({x['fornitore'] for x in enriched if x['fornitore'] != '—'})}</div><div class="l">Fornitori diversi</div></div>
    <div class="kpi"><div class="n">{_fmt_eur(sum(x['totale'] or 0 for x in enriched))}</div><div class="l">Spesa totale</div></div>
  </div>

  <h2>Andamento spesa nel tempo</h2>
  <div class="chart-card">{spend_chart() or '<div style="color:#94A3B8;font-style:italic;text-align:center;padding:22px;">Nessun dato importo disponibile.</div>'}</div>

  <h2>Confronto fornitori</h2>
  {supplier_tables or '<div style="color:#94A3B8;font-style:italic;">Nessun dato per il confronto.</div>'}

  {verdict_html}
</div></body></html>"""
    return html


async def _llm_cte_verdict(bills: List[dict]) -> dict:
    """Ask Claude to pick the most convenient supplier per bill_type based on
    analysed data. Returns {luce: str, gas: str, telco: str} — one sentence each."""
    if not bills:
        return {}
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return {}
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return {}
    # Compact bill summary
    summary = []
    for b in bills:
        ex = b.get("extracted") or {}
        summary.append({
            "bill_type": b.get("bill_type"),
            "fornitore": ex.get("fornitore"),
            "importo_totale": ex.get("importo_totale"),
            "consumo": ex.get("consumo_annuo") or ex.get("consumo_annuo_smc"),
            "prezzo_energia": ex.get("prezzo_energia") or ex.get("prezzo_gas"),
            "spread": ex.get("spread"),
            "costi_fissi": ex.get("costi_fissi"),
            "durata_contratto": ex.get("durata_contratto"),
            "penale_disdetta": ex.get("penale_disdetta"),
        })
    import json as _j
    system = (
        "Sei un consulente energetico italiano. Analizza le fatture fornite e per ciascun tipo "
        "(luce/gas/telco) SCRIVI UNA SOLA FRASE in italiano che indichi il fornitore più conveniente "
        "e il perché (es. costo minore, spread inferiore, penale disdetta ridotta). Se il tipo ha una "
        "sola fattura, indica solo il fornitore attuale e le sue caratteristiche. Restituisci JSON: "
        "{\"luce\": \"...\", \"gas\": \"...\", \"telco\": \"...\"}. Ometti chiavi senza dati."
    )
    prompt = f"Fatture analizzate:\n{_j.dumps(summary, ensure_ascii=False, default=str)}\n\nRispondi con il JSON."
    chat = LlmChat(api_key=key, session_id=f"cte-{uuid.uuid4().hex[:6]}", system_message=system).with_model("anthropic", "claude-sonnet-4-5-20250929")
    try:
        raw = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("CTE LLM err: %s", e)
        return {}
    data = _parse_llm_json(raw or "", fallback_key="luce")
    data.pop("parse_error", None); data.pop("error_message", None); data.pop("parse_error_kind", None)
    return {k: v for k, v in data.items() if k in ("luce", "gas", "telco") and isinstance(v, str)}


@api_router.get("/contacts/{contact_id}/bills/cte-report")
async def cte_comparative_report(contact_id: str, user=Depends(get_current_user)):
    """v2.12 — Generate a comparative HTML report ("CTE") across all analysed
    bills of a contact. Returns {name, mime, data_base64} ready for FileViewer."""
    contact = await _ensure_contact_owned(contact_id, user)
    bills = await db.energy_bills.find(
        {"user_id": tenant_id(user), "contact_id": contact_id, "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", 1).to_list(200)
    if not bills:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile. Carica e attendi l'analisi di almeno una fattura.")
    # Branding
    u = await db.users.find_one({"user_id": tenant_id(user)}, {"_id": 0, "name": 1, "company_name": 1, "company_logo_base64": 1}) or {}
    branding = {
        "agency_name": (u.get("company_name") or u.get("name") or "").strip(),
        "logo_base64": (u.get("company_logo_base64") or "").strip(),
    }
    verdict = await _llm_cte_verdict(bills)
    html = _build_cte_report_html(contact, bills, verdict, branding)
    import base64 as _b64
    name = f"CTE-Comparativa-{(contact.get('last_name') or contact.get('first_name') or 'cliente')}.html"
    return {
        "name": name,
        "mime": "text/html",
        "data_base64": _b64.b64encode(html.encode("utf-8")).decode("ascii"),
        "bills_count": len(bills),
        "verdict": verdict,
    }


# =========================
# Quick Bill Analysis (Drafts, V38N)
# Allow analyzing a bill PDF WITHOUT selecting a contact first. Useful for
# on-the-spot analysis at a customer meeting: upload PDF → AI extract → later
# associate to an existing contact or create a new one from extracted data.
# =========================

class QuickBillIn(BaseModel):
    bill_type: str  # luce | gas | telco
    pdf_base64: str
    pdf_name: Optional[str] = None
    pdf_mime: Optional[str] = "application/pdf"
    analysis_params: Optional[List[str]] = None
    label: Optional[str] = None  # optional user-friendly label (e.g. "Prospect via Roma")

async def _auto_save_draft_to_master_files(draft: dict):
    """V38Q — Persist a completed bill-draft into the Master's file cabinet.
    V38R (June 2026): Save TWO separate documents:
      - The RAW PDF in category='bills' (original fattura, same size as upload)
      - A generated HTML ANALISI report in category='analisi' (contains the
        extracted structured data + note_ai + consumption chart — much smaller
        than the PDF, distinctly rendered).
    V38W: fetch consultant profile for a professional header (logo + name).
    Both saves are idempotent: skip when a doc with the same name exists.
    """
    try:
        pdf_name = draft.get("pdf_name") or "fattura.pdf"
        base = pdf_name[:-4] if pdf_name.lower().endswith(".pdf") else pdf_name
        # 1) Save the raw PDF into 'bills' — original file, unchanged
        bill_name = f"{base}.pdf"
        exists_bill = await db.master_files.find_one({
            "user_id": draft.get("user_id"),
            "category": "bills",
            "name": bill_name,
        })
        if not exists_bill:
            b64 = draft.get("pdf_base64") or ""
            if b64.startswith("data:"):
                b64 = b64.split(",", 1)[1]
            approx_size = int(len(b64) * 0.75) if b64 else 0
            await db.master_files.insert_one({
                "file_id": f"mf_{uuid.uuid4().hex[:12]}",
                "user_id": draft.get("user_id"),
                "created_by": draft.get("created_by") or draft.get("user_id"),
                "category": "bills",
                "name": bill_name,
                "title": None,
                "body": None,
                "mime": draft.get("pdf_mime") or "application/pdf",
                "data_base64": b64,
                "size": approx_size,
                "created_at": utcnow(),
                "updated_at": utcnow(),
                "source": "bill-draft",
                "source_draft_id": draft.get("draft_id"),
            })
        # 2) Build & save the ANALISI HTML in 'analisi' — human-readable
        analysis_name = f"Analisi-{base}.html"
        exists_ana = await db.master_files.find_one({
            "user_id": draft.get("user_id"),
            "category": "analisi",
            "name": analysis_name,
        })
        if not exists_ana:
            extracted = draft.get("extracted") or {}
            bill_type = (draft.get("bill_type") or "luce").lower()
            # V38W — Plain-text labels (no emoji: cleaner + no charset artifacts)
            label_map = {"luce": ("Luce", "#EA580C"), "gas": ("Gas", "#F59E0B"), "telco": ("Telefono/Internet", "#0891B2")}
            bt_label, bt_color = label_map.get(bill_type, ("Fattura", "#6366F1"))
            # V38W — Fetch consultant profile for professional header + Note author
            user_doc = await db.users.find_one({"user_id": draft.get("user_id")}, {
                "_id": 0, "name": 1, "company_name": 1, "company_logo_base64": 1,
                "report_slogan": 1, "report_contacts": 1,
            }) or {}
            html = _build_analysis_html(
                extracted, bt_label, bt_color, base,
                draft.get("analysis_params") or [],
                user_doc,
            )
            html_b64 = base64.b64encode(html.encode("utf-8")).decode("ascii")
            await db.master_files.insert_one({
                "file_id": f"mf_{uuid.uuid4().hex[:12]}",
                "user_id": draft.get("user_id"),
                "created_by": draft.get("created_by") or draft.get("user_id"),
                "category": "analisi",
                "name": analysis_name,
                "title": f"Analisi {bt_label}",
                "body": None,
                "mime": "text/html",
                "data_base64": html_b64,
                "size": len(html.encode("utf-8")),
                "created_at": utcnow(),
                "updated_at": utcnow(),
                "source": "bill-draft",
                "source_draft_id": draft.get("draft_id"),
                "bill_type": bill_type,
            })
    except Exception as e:
        logger.warning("_auto_save_draft_to_master_files err: %s", e)


def _consultant_display(user_doc: dict) -> str:
    """V38W — Prefer user.name, else company_name, else initials."""
    name = (user_doc or {}).get("name") or ""
    if name.strip():
        return name.strip()
    comp = (user_doc or {}).get("company_name") or ""
    if comp.strip():
        return comp.strip()
    return "Consulente"


def _format_fiscal_check_html(fc: dict) -> str:
    """V38W — Render fiscal_check dict as human-readable rows (never JSON)."""
    if not fc or not isinstance(fc, dict):
        return ""
    from html import escape as esc
    rows = []
    def _num(v, digits=2):
        try:
            return f"{float(v):,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")
        except Exception:
            return "—"
    def _row(label, entry, digits, unit=""):
        if not isinstance(entry, dict):
            return None
        ok = bool(entry.get("ok"))
        exp = entry.get("expected")
        act = entry.get("actual")
        delta = entry.get("delta_annual_eur")
        color = "#059669" if ok else "#DC2626"
        bg = "#ECFDF5" if ok else "#FEF2F2"
        border = "#A7F3D0" if ok else "#FCA5A5"
        if ok:
            text = f"{esc(label)} {_num(exp, digits)}{unit} OK"
        else:
            text = f"{esc(label)} errata — attesa {_num(exp, digits)}{unit}, trovata {_num(act, digits)}{unit}"
        delta_txt = ""
        if not ok and isinstance(delta, (int, float)) and delta:
            delta_txt = f"<span style='color:#DC2626;font-weight:700;'>· Extra 12 mesi: € {_num(delta, 0)}</span>"
        return f"<li style='padding:6px 10px;background:{bg};border:1px solid {border};border-radius:6px;margin-bottom:6px;color:{color};font-size:12px;'>{text} {delta_txt}</li>"
    if fc.get("iva"):
        r = _row("IVA", fc["iva"], 0, "%")
        if r: rows.append(r)
    if fc.get("accise_gas"):
        r = _row("Accise gas", fc["accise_gas"], 6, " €/Smc")
        if r: rows.append(r)
    if fc.get("pcv"):
        r = _row("PCV / Costi fissi", fc["pcv"], 2, " €/mese")
        if r: rows.append(r)
    if not rows:
        return ""
    return "<h3 style='color:#0F172A;font-size:14px;margin:16px 0 6px;'>Verifica agevolazioni fiscali</h3><ul style='padding:0;margin:0;list-style:none;'>" + "".join(rows) + "</ul>"


def _build_analysis_html(extracted: dict, bt_label: str, bt_color: str, doc_base: str, params: list, user_doc: dict = None) -> str:
    """Render a compact HTML analysis report from the extracted fields.
    Includes a monthly consumption SVG bar chart when present.
    V38W: professional header + fiscal_check rendering + note author personalization + emoji-free titles.
    V2.1 (bugfix): sanitizes AI-generated text to strip HTML tags that would otherwise
    leak into the rendered report as visible <br>/<p> text.
    """
    from html import escape as esc
    import re as _re_local

    def _sanitize_ai(text) -> str:
        """Strip HTML tags from AI text while preserving semantic line breaks.
        - <br> / <br/> → newline
        - </p>         → double newline (paragraph break)
        - <p ...>      → removed
        - <li ...>     → "• "
        - </li>        → newline
        - all other tags → removed
        - HTML entities (&nbsp; &amp; &lt; &gt; &quot; &#39;) → their literal form
        """
        if text is None:
            return ""
        s = str(text)
        # Preserve semantic breaks BEFORE stripping
        s = _re_local.sub(r"<\s*br\s*/?\s*>", "\n", s, flags=_re_local.IGNORECASE)
        s = _re_local.sub(r"</\s*p\s*>", "\n\n", s, flags=_re_local.IGNORECASE)
        s = _re_local.sub(r"<\s*p(?:\s[^>]*)?>", "", s, flags=_re_local.IGNORECASE)
        s = _re_local.sub(r"</\s*li\s*>", "\n", s, flags=_re_local.IGNORECASE)
        s = _re_local.sub(r"<\s*li(?:\s[^>]*)?>", "• ", s, flags=_re_local.IGNORECASE)
        # Strip anything else that looks like a tag
        s = _re_local.sub(r"<[^>]+>", "", s)
        # Decode common HTML entities so the plain text isn't littered with them
        s = (s.replace("&nbsp;", " ")
               .replace("&amp;", "&")
               .replace("&lt;", "<")
               .replace("&gt;", ">")
               .replace("&quot;", '"')
               .replace("&#39;", "'")
               .replace("&apos;", "'"))
        # Collapse >=3 blank lines to 2
        s = _re_local.sub(r"\n{3,}", "\n\n", s)
        return s.strip()

    user_doc = user_doc or {}
    generated = datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")
    fornitore = esc(_sanitize_ai(extracted.get("fornitore") or "—"))
    offerta = esc(_sanitize_ai(extracted.get("nome_offerta") or extracted.get("tipo_offerta") or "Offerta non specificata"))
    consultant = _consultant_display(user_doc)
    company = (user_doc.get("company_name") or "").strip()
    logo = (user_doc.get("company_logo_base64") or "").strip()
    slogan = (user_doc.get("report_slogan") or "").strip()
    contacts = (user_doc.get("report_contacts") or "").strip()

    # V38W — Professional header
    header_html = ""
    if consultant or logo or company:
        logo_html = f'<img src="{esc(logo)}" alt="Logo" style="max-height:56px;max-width:120px;object-fit:contain;"/>' if logo else ""
        agency_line = esc(company or consultant)
        role_line = esc(consultant) if company and consultant and company != consultant else ""
        header_html = f"""
        <div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:2px solid {bt_color};margin-bottom:16px;">
          {logo_html}
          <div style="flex:1;">
            <div style="font-size:15px;font-weight:800;color:#1F2937;">{agency_line}</div>
            {f'<div style="font-size:12px;color:#475569;margin-top:2px;">{role_line}</div>' if role_line else ""}
            {f'<div style="font-size:11px;font-style:italic;color:#64748B;margin-top:3px;">{esc(slogan)}</div>' if slogan else ""}
            {f'<div style="font-size:10px;color:#94A3B8;margin-top:3px;">{esc(contacts)}</div>' if contacts else ""}
          </div>
        </div>
        """

    # SVG chart from consumi_mensili
    chart_html = ""
    for k in ("consumi_mensili_kwh", "consumi_mensili_smc"):
        v = extracted.get(k)
        if not v:
            continue
        unit = "kWh" if k.endswith("kwh") else "SMC"
        points = _normalize_monthly(v)
        if points:
            chart_html = _svg_bar_chart(points, unit, bt_color)
            break

    # Consulenza Corporate (was "Note AI" / "Note di {consultant}")
    notes_html = ""
    note_val = extracted.get("note_ai")
    if note_val:
        if isinstance(note_val, str):
            # V2.1 — sanitize AI text first (strip <br>/<p> etc.), then split
            sanitized = _sanitize_ai(note_val)
            items = [x.strip().lstrip("-•* ") for x in sanitized.splitlines() if x.strip()]
        elif isinstance(note_val, list):
            items = [_sanitize_ai(x) for x in note_val if _sanitize_ai(x)]
        else:
            items = []
        if items:
            note_title = "Consulenza Corporate"
            notes_html = f"<h3 style='color:#0F172A;font-size:14px;margin:16px 0 6px;'>{note_title}</h3><ul style='padding-left:20px;margin:0;color:#334155;font-size:12px;'>" + "".join(f"<li style='margin-bottom:4px;'>{esc(it)}</li>" for it in items) + "</ul>"

    # V38W — Fiscal check rendered as readable rows (never JSON)
    fiscal_html = _format_fiscal_check_html(extracted.get("fiscal_check") or {})

    # V38Z — Clear parse-error banner (never expose broken JSON to the user)
    parse_error_html = ""
    if extracted.get("parse_error"):
        msg = extracted.get("error_message") or (
            "L'analisi AI ha restituito una risposta non valida. "
            "Riprova più tardi o contatta il supporto se il problema persiste."
        )
        parse_error_html = (
            "<div style='background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;"
            "padding:12px;margin:12px 0;color:#7F1D1D;font-size:12px;line-height:1.5;'>"
            "<div style='font-weight:800;color:#991B1B;margin-bottom:4px;'>&#9888; Analisi non riuscita</div>"
            f"{esc(str(msg))}</div>"
        )

    # Standard KV table — skip internal keys and fiscal_check
    rows = []
    for k, v in extracted.items():
        if v in (None, "", []):
            continue
        if k in ("consumi_mensili_kwh", "consumi_mensili_smc", "note_ai",
                 "parametri_richiesti", "raw_text_preview", "fiscal_check",
                 "parse_error", "parse_error_kind", "error_message"):
            continue
        if isinstance(v, dict) and "ok" in v and ("expected" in v or "actual" in v):
            # V38X — fiscal-check-shaped sub-entry rendered readable, never JSON
            ok = bool(v.get("ok"))
            def _fmt(n):
                try: return f"{float(n):,.6f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")
                except Exception: return "—"
            if ok:
                v_str = f"{_fmt(v.get('expected'))} OK"
            else:
                delta = v.get("delta_annual_eur")
                d_txt = f" · Extra 12 mesi: € {_fmt(delta)}" if isinstance(delta, (int, float)) and delta else ""
                v_str = f"errata — attesa {_fmt(v.get('expected'))}, trovata {_fmt(v.get('actual'))}{d_txt}"
        elif isinstance(v, (list, dict)):
            # V38X — Instead of raw JSON, flatten as "k: v · k: v"
            if isinstance(v, list) and all(not isinstance(x, (list, dict)) for x in v):
                v_str = ", ".join(_sanitize_ai(x) for x in v)
            elif isinstance(v, dict):
                v_str = " · ".join(f"{esc(str(kk).replace('_', ' ').title())}: {_sanitize_ai(vv)}" for kk, vv in v.items())
            else:
                v_str = f"{len(v)} elementi"
        else:
            # V2.1 — strip AI-generated HTML tags before rendering
            v_str = _sanitize_ai(v)
        label = k.replace("_", " ").title()
        rows.append(f"<tr><td style='padding:8px 10px;background:#F8FAFC;font-weight:700;color:#475569;font-size:11px;border-bottom:1px solid #E2E8F0;width:40%;'>{esc(label)}</td><td style='padding:8px 10px;color:#0F172A;font-size:12px;border-bottom:1px solid #E2E8F0;word-break:break-word;'>{esc(v_str)}</td></tr>")
    table_html = f"<table style='width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-top:12px;'>{''.join(rows)}</table>" if rows else "<p style='color:#94A3B8;font-style:italic;'>Nessun dato estratto.</p>"

    # V38W — Filter internal `__verifica_*` markers before rendering user-visible pills
    params_html = ""
    if params:
        clean_params = [p for p in params if not (isinstance(p, str) and p.startswith("__verifica_"))]
        if clean_params:
            pills = "".join(f"<span style='display:inline-block;padding:3px 9px;border-radius:12px;background:#EDE9FE;color:#5B21B6;font-size:10px;font-weight:700;margin:2px;'>{esc(str(p))}</span>" for p in clean_params)
            params_html = f"<div style='margin:14px 0 6px;'><div style='font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6B7280;margin-bottom:6px;'>Parametri prioritari</div>{pills}</div>"

    return f"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Analisi Fattura {esc(bt_label)} - {esc(doc_base)}</title>
<style>
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A;margin:16px;background:#F8FAFC;}}
  .banner{{background:linear-gradient(135deg,{bt_color},{bt_color}CC);color:#FFF;padding:14px 18px;border-radius:10px;margin-bottom:14px;}}
  .banner-title{{font-size:17px;font-weight:900;margin:0;}}
  .banner-sub{{font-size:11px;opacity:0.92;margin-top:3px;}}
  h1{{color:{bt_color};margin:0 0 4px;font-size:20px;}}
  .subtitle{{color:#6B7280;font-size:11px;margin-bottom:14px;}}
  .footer{{margin-top:22px;padding-top:12px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center;}}
</style>
</head>
<body>
  {header_html}
  <h1>Analisi Fattura {esc(bt_label)}</h1>
  <div class="subtitle"><b>Documento:</b> {esc(doc_base)} &nbsp;·&nbsp; <b>Analizzata:</b> {esc(generated)}</div>
  <div class="banner">
    <div class="banner-title">{fornitore}</div>
    <div class="banner-sub">{offerta}</div>
  </div>
  {params_html}
  {parse_error_html}
  {fiscal_html}
  {table_html}
  {"<h3 style='color:#0F172A;font-size:14px;margin:16px 0 6px;'>Consumi mensili</h3>" + chart_html if chart_html else ""}
  {notes_html}
  <div class="footer">Report generato da {esc(consultant)} · Dal Pastro CRM</div>
</body>
</html>"""


def _normalize_monthly(v):
    """Return a list of {mese, value} tuples from various input shapes."""
    months = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"]
    if isinstance(v, list):
        out = []
        for i, it in enumerate(v):
            if isinstance(it, (int, float)):
                out.append({"mese": months[i] if i < 12 else str(i+1), "value": float(it)})
            elif isinstance(it, dict):
                mese = str(it.get("mese") or it.get("month") or (months[i] if i < 12 else str(i+1)))[:3].lower()
                val = it.get("kwh") or it.get("smc") or it.get("value") or it.get("consumo") or 0
                try:
                    out.append({"mese": mese, "value": float(val)})
                except Exception:
                    pass
        return out
    if isinstance(v, dict):
        out = []
        for k, val in v.items():
            lk = k.lower()[:3]
            if lk in months:
                try:
                    out.append({"mese": lk, "value": float(val)})
                except Exception:
                    pass
        # sort by month order
        out.sort(key=lambda x: months.index(x["mese"]) if x["mese"] in months else 99)
        return out
    return []


def _svg_bar_chart(points: list, unit: str, color: str) -> str:
    """Return an inline SVG bar chart for the given monthly consumption points."""
    if not points:
        return ""
    width = 520
    height = 220
    padL, padR, padT, padB = 42, 12, 16, 40
    chart_w = width - padL - padR
    chart_h = height - padT - padB
    max_v = max([p["value"] for p in points] + [1])
    bar_gap = 6
    bar_w = (chart_w / len(points)) - bar_gap
    y_ticks = [0, 0.25, 0.5, 0.75, 1.0]
    grid = "".join(
        f'<line x1="{padL}" y1="{padT + chart_h - chart_h*t}" x2="{width-padR}" y2="{padT + chart_h - chart_h*t}" stroke="#E5E7EB" stroke-width="1"/>'
        f'<text x="{padL-6}" y="{padT + chart_h - chart_h*t + 3}" font-size="9" fill="#6B7280" text-anchor="end">{int(max_v*t)}</text>'
        for t in y_ticks
    )
    bars = []
    for i, p in enumerate(points):
        h = (p["value"] / max_v) * chart_h if max_v > 0 else 0
        x = padL + i * (bar_w + bar_gap)
        y = padT + chart_h - h
        label = p.get("mese", "").capitalize()
        val_txt = str(int(p["value"])) if p["value"] > 0 else ""
        bars.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{h:.1f}" fill="{color}" rx="3"/>'
            f'<text x="{x + bar_w/2:.1f}" y="{y - 3:.1f}" font-size="9" fill="#374151" text-anchor="middle">{val_txt}</text>'
            f'<text x="{x + bar_w/2:.1f}" y="{height - padB + 14}" font-size="10" fill="#4B5563" text-anchor="middle">{label}</text>'
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="{height}" '
        f'viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet" '
        f'style="max-width:100%;background:#FFF;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">'
        f'{grid}{"".join(bars)}'
        f'<text x="{width - padR}" y="{height - 4}" font-size="9" fill="#6B7280" text-anchor="end">Unità: {unit}</text>'
        f'</svg>'
    )




async def _analyze_draft_task(draft_id: str):
    """Background analysis task for bill drafts (mirrors _analyze_bill_task)."""
    draft = await db.bill_drafts.find_one({"draft_id": draft_id})
    if not draft:
        return
    try:
        curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {"status": "analyzing"}})
        text = _extract_pdf_text(draft["pdf_base64"])
        if not text or len(text.strip()) < 30:
            curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
            if curr and curr.get("status") != "cancelled":
                await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {
                    "status": "error",
                    "error_message": "PDF vuoto o non leggibile (potrebbe essere scansione senza OCR).",
                    "analyzed_at": utcnow(),
                }})
            return
        curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        extracted = await _llm_analyze_bill_text(
            draft.get("bill_type") or "luce", text, draft.get("analysis_params") or None, tenant=draft.get("user_id")
        )
        curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
        if curr and curr.get("status") == "cancelled":
            return
        await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {
            "status": "done",
            "extracted": extracted,
            "error_message": None,
            "analyzed_at": utcnow(),
        }})
        # V38Q — auto-save the analyzed bill PDF into the Master's file
        # cabinet (category=bills), unless a copy is already there.
        try:
            fresh = await db.bill_drafts.find_one({"draft_id": draft_id})
            if fresh:
                await _auto_save_draft_to_master_files(fresh)
        except Exception as e:
            logger.warning("draft auto-save to master-files failed: %s", e)
    except Exception as e:
        logger.exception("draft analysis err %s", e)
        curr = await db.bill_drafts.find_one({"draft_id": draft_id}, {"status": 1})
        if curr and curr.get("status") != "cancelled":
            await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {
                "status": "error",
                "error_message": str(e)[:500],
                "analyzed_at": utcnow(),
            }})


@api_router.post("/bill-drafts")
async def create_bill_draft(body: QuickBillIn, background: BackgroundTasks, user=Depends(get_current_user)):
    if body.bill_type not in BILL_TYPES:
        raise HTTPException(status_code=400, detail=f"bill_type non valido: usa {BILL_TYPES}")
    b64 = body.pdf_base64
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    approx_size = int(len(b64) * 0.75)
    if approx_size > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="PDF troppo grande (max ~12 MB)")
    draft_id = f"bdft_{uuid.uuid4().hex[:12]}"
    doc = {
        "draft_id": draft_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": body.bill_type,
        "pdf_base64": body.pdf_base64,
        "pdf_name": body.pdf_name or f"fattura-{body.bill_type}.pdf",
        "pdf_mime": body.pdf_mime or "application/pdf",
        "pdf_size": approx_size,
        "label": (body.label or "").strip() or None,
        "status": "pending",
        "extracted": None,
        "error_message": None,
        "analysis_params": body.analysis_params or None,
        "contact_id": None,
        "created_at": utcnow(),
        "analyzed_at": None,
    }
    await db.bill_drafts.insert_one(doc)
    background.add_task(_analyze_draft_task, draft_id)
    strip_id(doc)
    doc.pop("pdf_base64", None)
    return doc


@api_router.get("/bill-drafts")
async def list_bill_drafts(user=Depends(get_current_user)):
    items = await db.bill_drafts.find(
        {"user_id": tenant_id(user), "contact_id": None},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(200)
    return {"items": items}


@api_router.get("/bill-drafts/{draft_id}")
async def get_bill_draft(draft_id: str, user=Depends(get_current_user)):
    d = await db.bill_drafts.find_one(
        {"user_id": tenant_id(user), "draft_id": draft_id},
        {"_id": 0, "pdf_base64": 0},
    )
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    return d


@api_router.get("/bill-drafts/{draft_id}/pdf")
async def get_bill_draft_pdf(draft_id: str, user=Depends(get_current_user)):
    d = await db.bill_drafts.find_one(
        {"user_id": tenant_id(user), "draft_id": draft_id},
        {"_id": 0},
    )
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    return {"pdf_base64": d.get("pdf_base64"), "pdf_name": d.get("pdf_name"), "pdf_mime": d.get("pdf_mime")}


@api_router.delete("/bill-drafts/{draft_id}")
async def delete_bill_draft(draft_id: str, user=Depends(get_current_user)):
    r = await db.bill_drafts.delete_one({"user_id": tenant_id(user), "draft_id": draft_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    return {"ok": True}


@api_router.post("/bill-drafts/{draft_id}/reanalyze")
async def reanalyze_bill_draft(draft_id: str, background: BackgroundTasks, user=Depends(get_current_user)):
    d = await db.bill_drafts.find_one({"user_id": tenant_id(user), "draft_id": draft_id})
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {"status": "pending", "error_message": None}})
    background.add_task(_analyze_draft_task, draft_id)
    return {"ok": True}


@api_router.post("/bill-drafts/{draft_id}/cancel")
async def cancel_bill_draft(draft_id: str, user=Depends(get_current_user)):
    """v2.8 — Cancel a running/pending draft analysis. Parity with the
    contact-side /contacts/{id}/bills/{bill_id}/cancel endpoint."""
    d = await db.bill_drafts.find_one({"user_id": tenant_id(user), "draft_id": draft_id}, {"_id": 0, "status": 1})
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    st = d.get("status")
    if st not in ("pending", "analyzing"):
        raise HTTPException(status_code=400, detail=f"Impossibile annullare: stato attuale '{st}'")
    await db.bill_drafts.update_one({"draft_id": draft_id}, {"$set": {
        "status": "cancelled",
        "error_message": "Analisi annullata dall'utente",
        "analyzed_at": utcnow(),
    }})
    return {"ok": True, "status": "cancelled"}


# ─────────────────────────────────────────────────────────────────────────────
# V50.z76 — Master "Analizza fattura": endpoints paralleli su bill_drafts
# Allineamento con /contacts/{id}/bills/*: reportistica, confronto offerte e
# CTE comparativa lavorano ora anche sui drafts (senza contatto associato).
# ─────────────────────────────────────────────────────────────────────────────

@api_router.get("/bill-drafts-report")
async def bill_drafts_report(user=Depends(get_current_user)):
    """Report AI su tutti i drafts analizzati (done) del Master. Nessun contatto richiesto."""
    items = await db.bill_drafts.find(
        {"user_id": tenant_id(user), "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", -1).to_list(200)
    if not items:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile")
    grouped: Dict[str, List[Dict[str, Any]]] = {"luce": [], "gas": [], "telco": []}
    for it in items:
        bt = it.get("bill_type") or "luce"
        grouped.setdefault(bt, []).append({
            "pdf_name": it.get("pdf_name"),
            "extracted": it.get("extracted") or {},
        })
    ai_suggestions = await _llm_bill_suggestions(grouped)
    # Anagrafica "vuota" ma coerente con contatto (per riusare buildReportHtml lato FE)
    return {
        "contact": None,
        "grouped": grouped,
        "ai_suggestions": ai_suggestions,
        "generated_at": utcnow(),
    }


@api_router.get("/bill-drafts-comparison")
async def bill_drafts_comparison(
    draft_id: Optional[str] = None,
    offer_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Confronto fatture (drafts) vs offerte aziendali. Se non specificati id → confronta l'ultima
    draft `done` per bill_type con l'ultima offerta `done` per stesso tipo."""
    drafts = await db.bill_drafts.find(
        {"user_id": tenant_id(user), "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", -1).to_list(200)
    offers = await db.company_offers.find(
        {"user_id": tenant_id(user), "status": "done"},
        {"_id": 0, "pdf_base64": 0},
    ).sort("created_at", -1).to_list(50)
    if not drafts:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile")
    if not offers:
        raise HTTPException(status_code=400, detail="Nessuna offerta aziendale analizzata disponibile")

    async def _safe_compare(bill_ex: dict, offer_ex: dict, bt: str) -> dict:
        try:
            return await _llm_compare_offers(bill_ex or {}, offer_ex or {}, bt, tenant=tenant_id(user))
        except Exception as e:
            logger.exception(f"comparison failed for bill_type={bt}: {e}")
            return {
                "parse_error": True,
                "error_message": f"Impossibile completare il confronto: {str(e)[:200]}",
                "sintesi": [f"Errore durante l'elaborazione AI ({bt}). Riprova più tardi."],
                "raccomandazione": "neutro",
            }

    # Ids specifici → confronto singolo
    if draft_id and offer_id:
        draft = next((b for b in drafts if b.get("draft_id") == draft_id), None)
        offer = next((o for o in offers if o.get("offer_id") == offer_id), None)
        if not draft or not offer:
            raise HTTPException(status_code=404, detail="Draft o offerta non trovata")
        comparison = await _safe_compare(draft.get("extracted") or {}, offer.get("extracted") or {}, draft.get("bill_type") or "luce")
        return {
            "contact": None,
            "bill_type": draft.get("bill_type") or "luce",
            "bill": {"pdf_name": draft.get("pdf_name"), "extracted": draft.get("extracted") or {}},
            "offer": {"label": offer.get("label"), "pdf_name": offer.get("pdf_name"), "extracted": offer.get("extracted") or {}},
            "comparison": comparison,
            "generated_at": utcnow(),
        }

    # Automatico: raggruppa ultime draft/offer per bill_type comuni
    comparisons: List[Dict[str, Any]] = []
    seen_types: set = set()
    for d in drafts:
        bt = d.get("bill_type") or "luce"
        if bt in seen_types:
            continue
        offer = next((o for o in offers if o.get("bill_type") == bt), None)
        if not offer:
            continue
        seen_types.add(bt)
        comp = await _safe_compare(d.get("extracted") or {}, offer.get("extracted") or {}, bt)
        comparisons.append({
            "bill_type": bt,
            "bill": {"pdf_name": d.get("pdf_name"), "extracted": d.get("extracted") or {}},
            "offer": {"label": offer.get("label"), "pdf_name": offer.get("pdf_name"), "extracted": offer.get("extracted") or {}},
            "comparison": comp,
        })
    if not comparisons:
        raise HTTPException(status_code=400, detail="Nessuna fornitura confrontabile trovata (serve almeno una draft e un'offerta dello stesso tipo)")
    return {"contact": None, "comparisons": comparisons, "generated_at": utcnow()}


@api_router.get("/bill-drafts-cte-report")
async def bill_drafts_cte_report(user=Depends(get_current_user)):
    """CTE comparativa multi-fattura sui drafts del Master."""
    drafts = await db.bill_drafts.find(
        {"user_id": tenant_id(user), "status": "done"},
        {"_id": 0, "pdf_base64": 0, "raw_text_preview": 0},
    ).sort("created_at", 1).to_list(200)
    if not drafts:
        raise HTTPException(status_code=400, detail="Nessuna fattura analizzata disponibile. Carica e attendi l'analisi di almeno una fattura.")
    u = await db.users.find_one({"user_id": tenant_id(user)}, {"_id": 0, "name": 1, "company_name": 1, "company_logo_base64": 1}) or {}
    branding = {
        "agency_name": (u.get("company_name") or u.get("name") or "").strip(),
        "logo_base64": (u.get("company_logo_base64") or "").strip(),
    }
    # Adatta i drafts al formato atteso da _build_cte_report_html (che vuole `bill_id`)
    bills_adapted = []
    for d in drafts:
        bd = dict(d)
        bd["bill_id"] = d.get("draft_id")  # alias per compatibilità con _build_cte_report_html
        bills_adapted.append(bd)
    verdict = await _llm_cte_verdict(bills_adapted)
    # Pseudo-contatto per non modificare _build_cte_report_html
    pseudo_contact = {"first_name": "", "last_name": "Analisi Master", "contact_code": "", "phone": "", "email": ""}
    html = _build_cte_report_html(pseudo_contact, bills_adapted, verdict, branding)
    import base64 as _b64
    name = "CTE-Comparativa-Master.html"
    return {
        "name": name,
        "mime": "text/html",
        "data_base64": _b64.b64encode(html.encode("utf-8")).decode("ascii"),
        "bills_count": len(bills_adapted),
        "verdict": verdict,
    }




class DraftAssociateIn(BaseModel):
    contact_id: str


async def _push_draft_files_to_contact(draft: dict, contact_id: str):
    """v2.7 (Feb 2026) — When a bill-draft is associated to a contact, mirror
    the RAW PDF and the ANALISI HTML into the contact's files section so they
    show up in the client card under "File". Idempotent (skip existing names).
    """
    try:
        pdf_name_src = draft.get("pdf_name") or "fattura.pdf"
        base = pdf_name_src[:-4] if pdf_name_src.lower().endswith(".pdf") else pdf_name_src
        # Fetch current file names to skip duplicates
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "files": 1}) or {}
        existing_names = {(f or {}).get("name") for f in (c.get("files") or [])}
        new_files: List[dict] = []

        # 1) RAW PDF → contact.files
        pdf_name = f"{base}.pdf"
        if pdf_name not in existing_names:
            b64 = draft.get("pdf_base64") or ""
            if b64.startswith("data:"):
                b64 = b64.split(",", 1)[1]
            approx_size = draft.get("pdf_size") or int(len(b64) * 0.75) if b64 else 0
            new_files.append({
                "id": str(uuid.uuid4()),
                "name": pdf_name,
                "mime": draft.get("pdf_mime") or "application/pdf",
                "data_base64": b64,
                "size": approx_size,
                "created_at": utcnow(),
            })

        # 2) ANALISI HTML → contact.files (same render used for master_files)
        analysis_name = f"Analisi-{base}.html"
        if analysis_name not in existing_names:
            extracted = draft.get("extracted") or {}
            bill_type = (draft.get("bill_type") or "luce").lower()
            label_map = {"luce": ("Luce", "#EA580C"), "gas": ("Gas", "#F59E0B"), "telco": ("Telefono/Internet", "#0891B2")}
            bt_label, bt_color = label_map.get(bill_type, ("Fattura", "#6366F1"))
            user_doc = await db.users.find_one({"user_id": draft.get("user_id")}, {
                "_id": 0, "name": 1, "company_name": 1, "company_logo_base64": 1,
                "report_slogan": 1, "report_contacts": 1,
            }) or {}
            html = _build_analysis_html(
                extracted, bt_label, bt_color, base,
                draft.get("analysis_params") or [],
                user_doc,
            )
            html_b64 = base64.b64encode(html.encode("utf-8")).decode("ascii")
            new_files.append({
                "id": str(uuid.uuid4()),
                "name": analysis_name,
                "mime": "text/html",
                "data_base64": html_b64,
                "size": len(html.encode("utf-8")),
                "created_at": utcnow(),
            })

        if new_files:
            await db.contacts.update_one(
                {"contact_id": contact_id},
                {"$push": {"files": {"$each": new_files}}, "$set": {"updated_at": utcnow()}},
            )
    except Exception as e:
        logger.warning("_push_draft_files_to_contact err: %s", e)


@api_router.post("/bill-drafts/{draft_id}/associate")
async def associate_bill_draft(draft_id: str, body: DraftAssociateIn, user=Depends(get_current_user)):
    """Move a draft's PDF + extracted data into the target contact's energy_bills
    then delete the draft. Returns the newly-created bill_id."""
    d = await db.bill_drafts.find_one({"user_id": tenant_id(user), "draft_id": draft_id})
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    await _ensure_contact_owned(body.contact_id, user)
    bill_id = f"bill_{uuid.uuid4().hex[:12]}"
    bill_doc = {
        "bill_id": bill_id,
        "contact_id": body.contact_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": d.get("bill_type") or "luce",
        "pdf_base64": d.get("pdf_base64"),
        "pdf_name": d.get("pdf_name"),
        "pdf_mime": d.get("pdf_mime"),
        "pdf_size": d.get("pdf_size"),
        "status": d.get("status") or "done",
        "extracted": d.get("extracted"),
        "error_message": d.get("error_message"),
        "analysis_params": d.get("analysis_params"),
        "created_at": d.get("created_at") or utcnow(),
        "analyzed_at": d.get("analyzed_at"),
    }
    await db.energy_bills.insert_one(bill_doc)
    # v2.7 — also mirror PDF + Analisi HTML into contact.files
    await _push_draft_files_to_contact(d, body.contact_id)
    await db.bill_drafts.delete_one({"draft_id": draft_id})
    strip_id(bill_doc)
    bill_doc.pop("pdf_base64", None)
    return {"ok": True, "bill_id": bill_id, "contact_id": body.contact_id, "bill": bill_doc}


@api_router.post("/bill-drafts/{draft_id}/create-contact")
async def create_contact_from_draft(draft_id: str, user=Depends(get_current_user)):
    """Create a new contact from the extracted bill data, then associate the
    draft's bill to it. Returns {contact_id, bill_id}."""
    d = await db.bill_drafts.find_one({"user_id": tenant_id(user), "draft_id": draft_id})
    if not d:
        raise HTTPException(status_code=404, detail="Bozza non trovata")
    extracted = d.get("extracted") or {}
    if not extracted:
        raise HTTPException(status_code=400, detail="La bozza non ha ancora dati estratti. Attendi il completamento dell'analisi.")
    # Try to map common bill fields → contact fields
    holder = extracted.get("intestatario") or extracted.get("cliente") or extracted.get("holder") or ""
    holder = str(holder).strip()
    first_name = holder
    last_name = ""
    if holder and " " in holder:
        parts = holder.split()
        first_name = parts[0]
        last_name = " ".join(parts[1:])
    if not first_name:
        first_name = f"Bolletta {d.get('bill_type','luce').title()}"
    addr = extracted.get("indirizzo_fornitura") or extracted.get("indirizzo") or ""
    contact_id = f"c_{uuid.uuid4().hex[:12]}"
    contact_doc = {
        "contact_id": contact_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "assigned_to_user_id": user["user_id"],
        "first_name": first_name,
        "last_name": last_name,
        "phone": str(extracted.get("telefono") or extracted.get("phone") or ""),
        "email": str(extracted.get("email") or ""),
        "address_street": str(addr) if isinstance(addr, str) else "",
        "fiscal_code": str(extracted.get("codice_fiscale") or ""),
        "vat_number": str(extracted.get("partita_iva") or ""),
        "area": "energy",
        "additional_areas": [],
        "source": "personal",
        "tags": ["da-bolletta"],
        "group_ids": [],
        "general_note": f"Cliente creato automaticamente dall'analisi di una bolletta {d.get('bill_type','luce')}.",
        "email_note": "",
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.contacts.insert_one(contact_doc)
    # Now associate the draft
    bill_id = f"bill_{uuid.uuid4().hex[:12]}"
    bill_doc = {
        "bill_id": bill_id,
        "contact_id": contact_id,
        "user_id": tenant_id(user),
        "created_by": user["user_id"],
        "bill_type": d.get("bill_type") or "luce",
        "pdf_base64": d.get("pdf_base64"),
        "pdf_name": d.get("pdf_name"),
        "pdf_mime": d.get("pdf_mime"),
        "pdf_size": d.get("pdf_size"),
        "status": d.get("status") or "done",
        "extracted": d.get("extracted"),
        "error_message": d.get("error_message"),
        "analysis_params": d.get("analysis_params"),
        "created_at": d.get("created_at") or utcnow(),
        "analyzed_at": d.get("analyzed_at"),
    }
    await db.energy_bills.insert_one(bill_doc)
    # v2.7 — also mirror PDF + Analisi HTML into contact.files
    await _push_draft_files_to_contact(d, contact_id)
    await db.bill_drafts.delete_one({"draft_id": draft_id})
    return {"ok": True, "contact_id": contact_id, "bill_id": bill_id}


# =========================
