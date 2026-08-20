"""Seed a fresh contact + bill for V38G UI test."""
import base64
import json
import time

import requests

BASE_URL = "https://business-card-pro-16.preview.emergentagent.com"

r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"})
token = r.json()["token"]
h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Create contact
cr = requests.post(
    f"{BASE_URL}/api/contacts",
    json={"first_name": "TEST_V38G_UI", "last_name": "AutoSaveUI", "phone": "+3900000ZZ", "area": "energy"},
    headers=h,
)
cid = cr.json()["contact_id"]
print("CONTACT_ID=", cid)

pdf_bytes = (
    b"%PDF-1.1\n"
    b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n"
    b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n"
    b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n"
    b"4 0 obj<< /Length 55 >>stream\nBT /F1 12 Tf 20 50 Td (Bolletta luce test V38G) Tj ET\nendstream endobj\n"
    b"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n"
    b"xref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000058 00000 n \n0000000110 00000 n \n0000000210 00000 n \n0000000305 00000 n \n"
    b"trailer<< /Size 6 /Root 1 0 R >>\nstartxref\n370\n%%EOF\n"
)
b64 = base64.b64encode(pdf_bytes).decode()

# Upload bill
br = requests.post(
    f"{BASE_URL}/api/contacts/{cid}/bills",
    json={"bill_type": "luce", "pdf_base64": b64, "pdf_name": "fattura-ui.pdf", "pdf_mime": "application/pdf"},
    headers=h,
    timeout=60,
)
print("BILL_STATUS=", br.status_code)

# Poll until terminal
for i in range(24):
    time.sleep(2.5)
    g = requests.get(f"{BASE_URL}/api/contacts/{cid}/bills", headers=h).json()
    items = g.get("items", [])
    if items and items[0].get("status") in ("done", "error"):
        print("BILL_TERMINAL=", items[0]["status"])
        break

# Save token+cid so playwright can use them
with open("/app/test_reports/v38g_state.json", "w") as f:
    json.dump({"token": token, "cid": cid}, f)

print("DONE — state saved to /app/test_reports/v38g_state.json")
