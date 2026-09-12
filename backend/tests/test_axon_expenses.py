"""V50.z198 — test e2e Blocco 8 Fase 2 (routes/axon_expenses.py). Uso: python tests/test_axon_expenses.py"""
import base64, io, json, os, sys
import httpx

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PWD = "test@dalpastro.it", "Test1234!"


def login():
    r = httpx.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30); r.raise_for_status()
    j = r.json(); return j.get("access_token") or j.get("token")


def receipt_png() -> str:
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (420, 560), "white"); d = ImageDraw.Draw(img)
    lines = ["AUTOGRILL S.p.A.", "Area di servizio Brescia Est", "12/09/2026  13:42", "", "Panino + acqua      7,50", "Caffe'               1,30", "", "TOTALE EUR          8,80",
             "IVA 10% inclusa     0,80", "PAGAMENTO CARTA", "Grazie e arrivederci"]
    y = 30
    for ln in lines:
        d.text((30, y), ln, fill="black"); y += 40
    b = io.BytesIO(); img.save(b, format="PNG"); return base64.b64encode(b.getvalue()).decode()


def statement_pdf() -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    b = io.BytesIO(); c = canvas.Canvas(b, pagesize=A4); y = 800
    rows = ["BANCA ESEMPIO S.p.A. - Estratto conto 01/08/2026 - 31/08/2026", "Saldo iniziale 2.450,00", "01/08/2026 STIPENDIO AGOSTO ACME SRL +2.100,00", "03/08/2026 SUPERMERCATO CONAD -86,40",
            "05/08/2026 CANONE ENEL ENERGIA -112,30", "09/08/2026 CARBURANTE Q8 -70,00", "12/08/2026 ASSICURAZIONE AUTO -240,00", "15/08/2026 RISTORANTE DA MARIO -54,00",
            "20/08/2026 PRELIEVO ATM -200,00", "22/08/2026 NETFLIX -12,99", "28/08/2026 COMMISSIONI BANCARIE -3,50", "Saldo finale 3.770,81"]
    for r in rows:
        c.drawString(50, y, r); y -= 22
    c.showPage(); c.save(); return base64.b64encode(b.getvalue()).decode()


def check(c, label):
    print(("✅" if c else "❌"), label); return bool(c)


def main():
    tok = login(); h = {"Authorization": f"Bearer {tok}"}; ok = True
    # 1) scontrino Business
    r = httpx.post(f"{BASE}/axon/expenses/receipt", headers=h, timeout=120, json={"sphere": "business", "data_base64": receipt_png(), "mime": "image/png", "name": "scontrino.png"})
    ok &= check(r.status_code == 200, f"receipt → {r.status_code} {r.text[:120] if r.status_code != 200 else ''}")
    if r.status_code == 200:
        e = r.json()["expense"]
        ok &= check(abs(float(e["amount"]) - 8.80) < 0.5 and e["sphere"] == "business" and e["category"] in ("vitto", "carburante", "trasporti", "altro"), f"estratto: {e['merchant']} · {e['amount']} € · {e['category']} · {e['date']} · file={bool(e.get('file_path'))}")
        eid = e["expense_id"]; month = e["month"]
        # 2) lista mese per sfera + separazione Home
        lst = httpx.get(f"{BASE}/axon/expenses", headers=h, timeout=30, params={"sphere": "business", "month": month}).json()
        ok &= check(any(i["expense_id"] == eid for i in lst["items"]) and lst["total"] >= 8 and lst["can_export_team"], f"nota spese business {month}: {lst['total']} € · team={len(lst['team'])}")
        home = httpx.get(f"{BASE}/axon/expenses", headers=h, timeout=30, params={"sphere": "home", "month": month}).json()
        ok &= check(not any(i["expense_id"] == eid for i in home["items"]) and home["categories"][0] == "spesa", "sfera Home separata (categorie personali)")
        # 3) riclassifica → Home e torna
        u = httpx.put(f"{BASE}/axon/expenses/{eid}", headers=h, timeout=30, json={"sphere": "home", "category": "svago"}).json()
        ok &= check(u["expense"]["sphere"] == "home" and u["expense"]["category"] == "svago", "riclassifica Privato/Business + categoria")
        httpx.put(f"{BASE}/axon/expenses/{eid}", headers=h, timeout=30, json={"sphere": "business", "category": "vitto"})
        # 4) file + PDF
        f = httpx.get(f"{BASE}/axon/expenses/{eid}/file", headers=h, timeout=30)
        ok &= check(f.status_code in (200, 404), f"file scontrino → {f.status_code} ({f.headers.get('content-type')})")
        p = httpx.get(f"{BASE}/axon/expenses/pdf", headers=h, timeout=60, params={"sphere": "business", "month": month})
        ok &= check(p.status_code == 200 and p.headers.get("content-type", "").startswith("application/pdf") and p.content[:4] == b"%PDF", f"PDF nota spese ({len(p.content)} byte)")
        # 5) chat
        out = {"text": "", "done": None}
        with httpx.stream("POST", f"{BASE}/assistant/chat/stream", json={"message": "quanto ho speso questo mese?"}, headers=h, timeout=90) as s:
            ev = None
            for line in s.iter_lines():
                if line.startswith("event:"): ev = line.split(":", 1)[1].strip()
                elif line.startswith("data:") and ev:
                    d = json.loads(line.split(":", 1)[1])
                    if ev == "delta": out["text"] += d.get("text", "")
                    elif ev == "done": out["done"] = d; break
        ok &= check((out["done"] or {}).get("slash") == "expenses_summary" and "Nota spese Business" in out["text"], f"chat → {out['text'][:80]!r}")
        # 6) manuale + delete
        m = httpx.post(f"{BASE}/axon/expenses/manual", headers=h, timeout=30, json={"sphere": "home", "merchant": "Farmacia", "amount": 12.5, "category": "salute"}).json()
        d1 = httpx.delete(f"{BASE}/axon/expenses/{m['expense']['expense_id']}", headers=h, timeout=30).json()
        d2 = httpx.delete(f"{BASE}/axon/expenses/{eid}", headers=h, timeout=30).json()
        ok &= check(m["ok"] and d1["ok"] and d2["ok"], "manuale Home + cancellazioni")
    # 7) estratto conto PDF
    r = httpx.post(f"{BASE}/axon/expenses/statement", headers=h, timeout=180, json={"sphere": "home", "data_base64": statement_pdf(), "mime": "application/pdf", "name": "ec_agosto.pdf"})
    ok &= check(r.status_code == 200, f"statement → {r.status_code} {r.text[:150] if r.status_code != 200 else ''}")
    if r.status_code == 200:
        rep = r.json()["report"]
        ok &= check(len(rep["movements"]) >= 6 and rep["income"] > 2000 and rep["outcome"] > 700 and rep["sphere"] == "home", f"report: {rep.get('bank')} · {rep.get('period')} · entrate {rep['income']} · uscite {rep['outcome']} · {len(rep['movements'])} mov · insight {len(rep['insights'])}")
        lst = httpx.get(f"{BASE}/axon/expenses/statements", headers=h, timeout=30).json()
        ok &= check(any(i["report_id"] == rep["report_id"] for i in lst["items"]) and "movements" not in lst["items"][0], "lista report (senza movimenti)")
        g = httpx.get(f"{BASE}/axon/expenses/statements/{rep['report_id']}", headers=h, timeout=30).json()
        ok &= check(len(g["movements"]) == len(rep["movements"]), "dettaglio report con movimenti")
        httpx.delete(f"{BASE}/axon/expenses/statements/{rep['report_id']}", headers=h, timeout=30)
    print("\nRISULTATO:", "TUTTO OK ✅" if ok else "FALLITO ❌"); sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
