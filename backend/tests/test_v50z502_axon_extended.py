"""V50.z502 — Axon: azioni estese (modifica/cancella contatto, appuntamento, richiamata) + «chiama X» (chat e Axon Drive).
cd /app/backend && python -m pytest tests/test_v50z502_axon_extended.py -q   (LLM reale)"""
import os, json, datetime, requests, pytest

B = os.environ.get("B", "http://localhost:8001/api")


@pytest.fixture(scope="module")
def ctx():
    tok = requests.post(f"{B}/auth/login", json={"email": "demo@advisoros.it", "password": "Demo1234!"}).json()["token"]
    H = {"Authorization": f"Bearer {tok}"}
    c = requests.post(f"{B}/contacts", headers=H, json={"first_name": "Luca", "last_name": "Testoni", "phone": "+39 345 0000001", "area": "energy"}).json()
    yield H, c
    requests.delete(f"{B}/contacts/{c['contact_id']}", headers=H)


def chat(H, msg):
    with requests.post(f"{B}/assistant/chat/stream", headers=H, json={"message": msg}, stream=True, timeout=150) as r:
        body = b"".join(r.iter_content(chunk_size=None)).decode("utf-8", "ignore")
    return "".join(json.loads(l[5:].strip()).get("text", "") for l in body.splitlines() if l.startswith("data:") and '"text"' in l)


def test_update_contact_phone(ctx):
    H, c = ctx
    text = chat(H, "cambia il numero di Luca Testoni in 3471112233")
    full = requests.get(f"{B}/contacts/{c['contact_id']}", headers=H).json()
    assert "3471112233" in (full.get("phone") or "").replace(" ", ""), text[:300]


def test_callback_move_then_delete(ctx):
    H, c = ctx
    nxt = datetime.datetime.now() + datetime.timedelta(days=2)
    cb = requests.post(f"{B}/callbacks", headers=H, json={"contact_id": c["contact_id"], "title": "Richiamare Luca", "area": "energy", "scheduled_at": nxt.replace(hour=10, minute=0).isoformat()}).json()
    text = chat(H, "sposta la richiamata di Luca Testoni a venerdì prossimo alle 15")
    got = requests.get(f"{B}/callbacks/{cb['callback_id']}", headers=H).json()
    assert got["scheduled_at"] != cb["scheduled_at"], text[:300]
    text = chat(H, "cancella la richiamata di Luca Testoni")
    assert requests.get(f"{B}/callbacks/{cb['callback_id']}", headers=H).status_code == 404, text[:300]


def test_delete_appointment(ctx):
    H, c = ctx
    nxt = (datetime.datetime.now() + datetime.timedelta(days=3)).replace(hour=11, minute=0)
    a = requests.post(f"{B}/appointments", headers=H, json={"contact_id": c["contact_id"], "title": "Sopralluogo Testoni", "area": "energy", "start_at": nxt.isoformat()}).json()
    text = chat(H, "cancella l'appuntamento con Luca Testoni")
    assert requests.get(f"{B}/appointments/{a['appointment_id']}", headers=H).status_code == 404, text[:300]


def test_call_from_drive_and_chat(ctx):
    H, c = ctx
    j = requests.post(f"{B}/voice/copilot/execute", headers=H, json={"transcript": "chiama Luca Testoni", "want_audio": False}, timeout=120).json()
    d = (j.get("extra") or {}).get("display") or {}
    assert d.get("type") == "call" and d.get("tel", "").endswith("3471112233"), j
    text = chat(H, "chiama Luca Testoni")
    assert "[[NAV:tel:" in text, text[:300]


def test_delete_contact_last(ctx):
    H, c = ctx
    text = chat(H, "elimina il contatto Luca Testoni")
    assert requests.get(f"{B}/contacts/{c['contact_id']}", headers=H).status_code == 404, text[:300]
