"""Test v2.12 CTE Comparativa: bulk upload + comparative report."""
import base64, io, os, sys, time
import requests
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

BASE = "http://localhost:8001/api"
tok = requests.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}

# 1) Get or create a contact
r = requests.get(f"{BASE}/contacts", headers=H)
items = r.json().get("items", [])
if items:
    cid = items[0]["contact_id"]
    print(f"Using existing contact: {cid}")
else:
    r = requests.post(f"{BASE}/contacts", headers=H, json={"first_name": "Test", "last_name": "CTE", "area": "energy"})
    cid = r.json()["contact_id"]
    print(f"Created contact: {cid}")

def mkpdf(title: str, supplier: str, amount: str, kwh: str) -> str:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 18); c.drawString(70, 780, title)
    c.setFont("Helvetica", 12)
    c.drawString(70, 740, f"Fornitore: {supplier}")
    c.drawString(70, 720, f"POD: IT001E12345678")
    c.drawString(70, 700, f"Consumo annuo: {kwh} kWh")
    c.drawString(70, 680, f"Importo totale: € {amount}")
    c.drawString(70, 660, f"Prezzo energia: 0,12 EUR/kWh")
    c.drawString(70, 640, f"Spread: 0,015 EUR/kWh")
    c.drawString(70, 620, f"Costi fissi: 6,50 EUR/mese")
    c.drawString(70, 600, f"IVA: 10%")
    c.drawString(70, 580, f"Data emissione: 15/03/2026")
    c.showPage(); c.save()
    return base64.b64encode(buf.getvalue()).decode()

# 2) Bulk upload 3 bills (2 diverse fornitori luce + 1 gas)
bills = [
    {"bill_type": "luce", "pdf_base64": mkpdf("Fattura Luce ENEL", "ENEL Energia", "142.50", "3200"), "pdf_name": "enel-luce.pdf"},
    {"bill_type": "luce", "pdf_base64": mkpdf("Fattura Luce ENI", "Eni Plenitude", "118.30", "3200"), "pdf_name": "eni-luce.pdf"},
    {"bill_type": "gas",  "pdf_base64": mkpdf("Fattura Gas ENI",  "Eni Plenitude", "234.80",  "890"), "pdf_name": "eni-gas.pdf"},
]
r = requests.post(f"{BASE}/contacts/{cid}/bills/bulk-upload", headers=H, json={"bills": bills})
print("bulk-upload:", r.status_code, r.json())
assert r.status_code == 200 and r.json()["count"] == 3

# 3) Poll until all analyzed (max 60s)
for i in range(60):
    time.sleep(2)
    r = requests.get(f"{BASE}/contacts/{cid}/bills", headers=H)
    grp = r.json().get("grouped", {})
    flat = grp.get("luce", []) + grp.get("gas", []) + grp.get("telco", [])
    done = sum(1 for b in flat if b.get("status") == "done")
    print(f"[{i*2:2}s] done: {done}/{len(flat)}", "statuses:", [b.get("status") for b in flat[-3:]])
    if done >= 3:
        break

# 4) Fetch CTE report
r = requests.get(f"{BASE}/contacts/{cid}/bills/cte-report", headers=H)
print("cte-report:", r.status_code)
if r.status_code == 200:
    d = r.json()
    print(f"  name={d['name']}, bills_count={d['bills_count']}, mime={d['mime']}")
    print(f"  verdict={d.get('verdict')}")
    html = base64.b64decode(d["data_base64"]).decode("utf-8")
    # Sanity checks
    assert "CTE Comparativa" in html
    assert "ENEL" in html or "Eni" in html
    assert "Confronto fornitori" in html
    assert "più conveniente" in html or len(d["verdict"]) > 0
    print(f"  ✅ HTML size: {len(html)} chars, contains supplier comparison + AI verdict")
    # Save for visual verification
    with open("/tmp/cte_out.html", "w") as f:
        f.write(html)
    print(f"  Saved to /tmp/cte_out.html")
else:
    print(f"  Error: {r.text}")

# Cleanup — delete the created bills to keep tests clean
r = requests.get(f"{BASE}/contacts/{cid}/bills", headers=H)
grp = r.json().get("grouped", {})
for arr in grp.values():
    for b in arr:
        if b.get("pdf_name") in ("enel-luce.pdf", "eni-luce.pdf", "eni-gas.pdf"):
            requests.delete(f"{BASE}/contacts/{cid}/bills/{b['bill_id']}", headers=H)
print("cleanup ✅")
