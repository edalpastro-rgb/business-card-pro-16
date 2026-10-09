"""V50.z499 — Axon chat: ogni azione passa dalle funzioni standard e viene DAVVERO salvata (appuntamento, richiamata, contatto, nota).
cd /app/backend && python -m pytest tests/test_v50z499_axon_actions.py -q   (LLM reale, ~1-2 min)"""
import os, re, json, datetime, requests, pytest

B = os.environ.get("B", "http://localhost:8001/api")


@pytest.fixture(scope="module")
def H():
    tok = requests.post(f"{B}/auth/login", json={"email": "demo@advisoros.it", "password": "Demo1234!"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def chat(H, msg):
    with requests.post(f"{B}/assistant/chat/stream", headers=H, json={"message": msg}, stream=True, timeout=150) as r:
        body = b"".join(r.iter_content(chunk_size=None)).decode("utf-8", "ignore")
    text = "".join(json.loads(l[5:].strip()).get("text", "") for l in body.splitlines() if l.startswith("data:") and '"text"' in l)
    return body, text


def test_create_contact_via_chat(H):
    body, text = chat(H, "crea contatto Giulia Verdi 3339876543 Verona energia")
    items = requests.get(f"{B}/contacts", headers=H).json()["items"]
    c = [x for x in items if x.get("last_name") == "Verdi" and x.get("first_name") == "Giulia"]
    assert c, text[:300]
    assert c[0]["contact_id"].startswith("c_") and c[0].get("phone")
    requests.delete(f"{B}/contacts/{c[0]['contact_id']}", headers=H)


def test_add_note_via_chat(H):
    body, text = chat(H, "aggiungi nota su Bianchi: vuole il contratto gas entro fine mese")
    c = next(x for x in requests.get(f"{B}/contacts", headers=H).json()["items"] if x["last_name"] == "Bianchi")
    full = requests.get(f"{B}/contacts/{c['contact_id']}", headers=H).json()
    assert any("contratto gas" in (n.get("text") or "").lower() for n in full.get("notes", [])), text[:300]


def test_create_appointment_via_chat(H):
    body, text = chat(H, "crea un appuntamento con Marco Bianchi domani alle 10 in ufficio")
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    appts = requests.get(f"{B}/appointments", headers=H, params={"from": tomorrow, "to": tomorrow}).json()
    appts = appts.get("items", appts) if isinstance(appts, dict) else appts
    mine = [a for a in appts if "bianchi" in (a.get("title") or "").lower() or a.get("contact_id") == next(x for x in requests.get(f"{B}/contacts", headers=H).json()["items"] if x["last_name"] == "Bianchi")["contact_id"]]
    assert mine, text[:300]
    assert mine[0]["appointment_id"].startswith("a_") and mine[0].get("created_by")
    for a in mine:
        requests.delete(f"{B}/appointments/{a['appointment_id']}", headers=H)


def test_create_callback_via_chat(H):
    body, text = chat(H, "programma una richiamata a Marco Bianchi lunedì alle 9")
    cbs = requests.get(f"{B}/callbacks", headers=H).json()["items"]
    c = next(x for x in requests.get(f"{B}/contacts", headers=H).json()["items"] if x["last_name"] == "Bianchi")
    mine = [cb for cb in cbs if cb.get("contact_id") == c["contact_id"]]
    assert mine, text[:300]
    assert mine[0]["callback_id"].startswith("cb_") and mine[0]["done"] is False
    for cb in mine:
        requests.delete(f"{B}/callbacks/{cb['callback_id']}", headers=H)
