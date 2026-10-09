"""V50.z495 — Axon Drive: richiamata vocale salvata come quella manuale + nuovi intent (ritelefonate, ultima nota, navigazione).
Esecuzione: cd /app/backend && python -m pytest tests/test_v50z495_voice_drive.py -q  (usa l'LLM reale: ~20-40 s)"""
import os, datetime, requests, pytest

B = os.environ.get("B", "http://localhost:8001/api")


@pytest.fixture(scope="module")
def ctx():
    tok = requests.post(f"{B}/auth/login", json={"email": "demo@advisoros.it", "password": "Demo1234!"}).json()["token"]
    H = {"Authorization": f"Bearer {tok}"}
    items = requests.get(f"{B}/contacts", headers=H).json()["items"]
    c = next(x for x in items if x.get("last_name") == "Bianchi")
    # indirizzi per il test navigazione (2 → deve chiedere quale)
    requests.put(f"{B}/contacts/{c['contact_id']}", headers=H, json={"address": "Via Roma 10, 35100 Padova", "work_address": "Corso Milano 5, Padova"}).raise_for_status()
    return H, c


def _exec(H, text, **extra):
    r = requests.post(f"{B}/voice/copilot/execute", headers=H, json={"transcript": text, "want_audio": False, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_schedule_call_saved_like_manual(ctx):
    H, c = ctx
    name = f"{c['first_name']} {c['last_name']}"
    j = _exec(H, f"programma una richiamata a {name} lunedì alle 9:00")
    assert j["intent"] == "schedule_call", j
    cbid = j["extra"]["callback_id"]
    assert cbid.startswith("cb_")
    cb = requests.get(f"{B}/callbacks/{cbid}", headers=H).json()  # prima: 404 (mancava callback_id)
    assert cb["contact_id"] == c["contact_id"] and cb["done"] is False and cb["area"] in ("energy", "network") and cb["title"]
    sa = datetime.datetime.fromisoformat(cb["scheduled_at"].replace("Z", "+00:00"))
    sa_local = (sa if sa.tzinfo else sa.replace(tzinfo=datetime.timezone.utc)).astimezone(datetime.timezone(datetime.timedelta(hours=2)))
    assert sa_local.weekday() == 0 and sa_local.hour == 9, sa_local
    assert sa_local.date() > datetime.date.today()
    # visibile nella Home (GET /callbacks?day=) e nella scheda (GET /callbacks?contact_id=)
    day = sa_local.date().isoformat()
    home = requests.get(f"{B}/callbacks", headers=H, params={"day": day}).json()["items"]
    assert any(x["callback_id"] == cbid for x in home)
    card = requests.get(f"{B}/callbacks", headers=H, params={"contact_id": c["contact_id"]}).json()["items"]
    assert any(x["callback_id"] == cbid for x in card)
    requests.delete(f"{B}/callbacks/{cbid}", headers=H)


def test_add_note_in_contact_notes(ctx):
    H, c = ctx
    j = _exec(H, f"aggiungi nota su {c['last_name']}: vuole il preventivo luce entro venerdì")
    assert j["intent"] == "add_note", j
    full = requests.get(f"{B}/contacts/{c['contact_id']}", headers=H).json()
    assert any("preventivo" in (n.get("text") or "").lower() for n in full.get("notes", [])), "nota non nella scheda"
    j2 = _exec(H, f"leggimi l'ultima nota su {c['last_name']}")
    assert j2["intent"] == "read_note", j2
    assert j2["extra"]["display"]["type"] == "note" and "preventivo" in j2["extra"]["display"]["text"].lower()


def test_list_callbacks_today(ctx):
    H, c = ctx
    now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)
    cb = requests.post(f"{B}/callbacks", headers=H, json={"contact_id": c["contact_id"], "title": "Test oggi", "area": "energy", "scheduled_at": now.isoformat()}).json()
    j = _exec(H, "mostrami le ritelefonate di oggi")
    assert j["intent"] == "list_callbacks", j
    d = j["extra"]["display"]
    assert d["type"] == "callbacks" and any(i["callback_id"] == cb["callback_id"] for i in d["items"])
    assert "Bianchi" in j["spoken"]
    requests.delete(f"{B}/callbacks/{cb['callback_id']}", headers=H)


def test_navigate_two_addresses_then_pick(ctx):
    H, c = ctx
    j = _exec(H, f"portami da {c['last_name']}")
    assert j["intent"] == "navigate_to", j
    d = j["extra"]["display"]
    assert d["type"] == "navigate_choice" and len(d["options"]) == 2
    assert j["extra"]["pending_nav_contact_id"] == c["contact_id"]
    j2 = _exec(H, "quello di lavoro con waze", pending_nav_contact_id=c["contact_id"])
    d2 = j2["extra"]["display"]
    assert d2["type"] == "navigate" and "Corso Milano" in d2["address"] and d2["nav_app"] == "waze"
    # un solo indirizzo → apre direttamente
    requests.put(f"{B}/contacts/{c['contact_id']}", headers=H, json={"work_address": ""}).raise_for_status()
    j3 = _exec(H, f"dammi le indicazioni per {c['first_name']} {c['last_name']}")
    assert j3["extra"]["display"]["type"] == "navigate" and "Via Roma" in j3["extra"]["display"]["address"]
