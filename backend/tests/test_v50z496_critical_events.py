"""V50.z496 — Allarme prioritario eventi critici: banner (active list), push/campanella, voce alla prima interazione (chat + stream).
cd /app/backend && python -m pytest tests/test_v50z496_critical_events.py -q"""
import os, requests, pytest

B = os.environ.get("B", "http://localhost:8001/api")


@pytest.fixture(scope="module")
def H():
    tok = requests.post(f"{B}/auth/login", json={"email": "demo@advisoros.it", "password": "Demo1234!"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    # pulizia: chiudo eventuali eventi aperti
    for ev in requests.get(f"{B}/axon/critical-events/active", headers=h).json()["items"]:
        requests.post(f"{B}/axon/critical-events/{ev['event_id']}/dismiss", headers=h)
    return h


def test_trigger_banner_push_and_bell(H):
    ev = requests.post(f"{B}/axon/critical-events/test", headers=H, json={"message": "Stress test notturno: prestazioni Axon calate al 44.9%, era 95%. Richiede attenzione.", "route": "/axon-stress-report"}).json()
    assert ev["event_id"].startswith("cev_") and ev["dismissed"] is False and ev["announced"] is False
    act = requests.get(f"{B}/axon/critical-events/active", headers=H).json()["items"]
    assert any(a["event_id"] == ev["event_id"] for a in act)
    # campanella: notifica kind system_critical con urgenza CRITICAL
    notifs = requests.get(f"{B}/axon-notifications", headers=H).json()["items"]
    n = next(x for x in notifs if (x.get("data") or {}).get("critical_event_id") == ev["event_id"])
    assert n["kind"] == "system_critical" and n["data"]["urgency"] == "CRITICAL" and n["data"]["deeplink"] == "/axon-stress-report"


def test_voice_prefix_on_first_chat_then_not_again(H):
    r = requests.post(f"{B}/assistant/chat", headers=H, json={"message": "Che ore sono?"}, timeout=120)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["reply"].startswith("⚠️ Attenzione:"), j["reply"][:200]
    assert "Vuoi che ti mostri i dettagli?" in j["reply"] and "[[NAV:/axon-stress-report|Vedi dettagli]]" in j["reply"]
    assert j.get("critical_event_id")
    # seconda interazione: nessun prefisso
    r2 = requests.post(f"{B}/assistant/chat", headers=H, json={"message": "Che ore sono?"}, timeout=120)
    assert not r2.json()["reply"].startswith("⚠️ Attenzione:")
    # il banner resta finché non lo chiudo a mano
    act = requests.get(f"{B}/axon/critical-events/active", headers=H).json()["items"]
    assert any(a["event_id"] == j["critical_event_id"] for a in act)


def test_stream_prefix_and_dismiss(H):
    ev = requests.post(f"{B}/axon/critical-events/test", headers=H, json={"message": "Anomalia critica di prova", "route": "/axon-system", "source": "test2"}).json()
    with requests.post(f"{B}/assistant/chat/stream", headers=H, json={"message": "Ciao"}, stream=True, timeout=120) as r:
        body = b"".join(r.iter_content(chunk_size=None)).decode("utf-8", "ignore")
    assert "event: delta" in body
    first_delta = body.split("event: delta", 1)[1][:400]
    assert "Attenzione" in first_delta and "Vuoi che ti mostri i dettagli?" in first_delta, first_delta
    # chiusura manuale → sparisce dai banner attivi
    assert requests.post(f"{B}/axon/critical-events/{ev['event_id']}/dismiss", headers=H).json()["ok"]
    act = requests.get(f"{B}/axon/critical-events/active", headers=H).json()["items"]
    assert not any(a["event_id"] == ev["event_id"] for a in act)
    for a in act:
        requests.post(f"{B}/axon/critical-events/{a['event_id']}/dismiss", headers=H)
