"""V50.z259 — Navigatore AxonOS: deep link, flussi multi-step, azioni, proattività."""
import os
import re
import requests

BASE = os.environ.get("BACKEND_URL", "https://business-card-pro-16.preview.emergentagent.com").rstrip("/") + "/api"
EMAIL = os.environ.get("TEST_EMAIL", "test@dalpastro.it")
PWD = os.environ.get("TEST_PASSWORD", "Test1234!")

NAV_RX = re.compile(r"\[\[NAV:([^|\]]+)\|([^\]]+)\]\]")
ACT_RX = re.compile(r"\[\[ACTION:([a-z_]+)\|([^|\]]+)\|(\{.*?\})\]\]")


def _tok():
    r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PWD}, timeout=30)
    r.raise_for_status()
    d = r.json()
    return d.get("access_token") or d.get("token")


H = {"Authorization": f"Bearer {_tok()}"}


def chat(msg):
    r = requests.post(f"{BASE}/assistant/chat", json={"message": msg}, headers=H, timeout=90)
    assert r.status_code == 200, r.text
    return r.json().get("reply", "")


def test_map_endpoint():
    r = requests.get(f"{BASE}/axon/nav/map", headers=H, timeout=30)
    assert r.status_code == 200
    items = r.json()["items"]
    ids = {i["id"] for i in items}
    assert len(items) >= 60
    for need in ["home_ritelefonate", "giro_ottimale", "resoconto_km", "scanner", "fatture", "smtp", "libretto", "gps_visite", "abbonamento", "master"]:
        assert need in ids, need
    assert requests.get(f"{BASE}/axon/nav/map", timeout=30).status_code == 401


def test_flow_lost():
    reply = chat("mi sono perso, non so da dove iniziare")
    links = NAV_RX.findall(reply)
    routes = [r for r, _ in links]
    assert "/contact/new" in routes and "/appointment/new" in routes and "/callback/new" in routes


def test_flow_kpi():
    reply = chat("voglio sapere come sto andando")
    assert "/home?section=statistiche" in [r for r, _ in NAV_RX.findall(reply)]


def test_flow_callbacks():
    reply = chat("devo richiamare qualcuno")
    assert "/home?section=ritelefonate" in [r for r, _ in NAV_RX.findall(reply)]


def test_flow_docs():
    reply = chat("dove metto i documenti?")
    routes = [r for r, _ in NAV_RX.findall(reply)]
    assert "/master-files" in routes and "/scanner" in routes
    reply2 = chat("dove metto le bollette?")
    assert "/bill-quick" in [r for r, _ in NAV_RX.findall(reply2)]


def test_flow_howto():
    reply = chat("come faccio a impostare il rilevamento gps delle visite?")
    assert "/impostazioni?section=general" in [r for r, _ in NAV_RX.findall(reply)]


def test_flow_goto_generic():
    reply = chat("devo andare da un cliente")
    routes = [r for r, _ in NAV_RX.findall(reply)]
    assert "/optimal-route" in routes


def test_flow_goto_unknown():
    reply = chat("devo andare da Zxqwertyuiop")
    assert "Non trovo" in reply
    assert "/contatti" in [r for r, _ in NAV_RX.findall(reply)]


def test_flow_losttouch():
    reply = chat("ho perso il filo con alcuni clienti")
    routes = [r for r, _ in NAV_RX.findall(reply)]
    assert any(r.startswith("/optimal-route") or r == "/map-clients" for r in routes)


def test_flow_organize():
    reply = chat("devo organizzarmi meglio")
    assert "Ritelefonate da fare" in reply
    assert "/calendario?view=week" in [r for r, _ in NAV_RX.findall(reply)]


def test_flow_missed_and_action():
    reply = chat("sposta tutti gli appuntamenti mancati di oggi a domani stesso orario")
    acts = ACT_RX.findall(reply)
    if acts:
        assert acts[0][0] == "move_missed"
    else:
        assert "mancati" in reply.lower() or "esito" in reply.lower()
    # action endpoint con id inesistente → 0 spostati, nessun errore
    r = requests.post(f"{BASE}/axon/nav/action", json={"action": "move_missed", "payload": {"ids": ["appt_nope"], "days": 1}}, headers=H, timeout=30)
    assert r.status_code == 200 and "0 appuntamenti" in r.json()["reply"]
    r = requests.post(f"{BASE}/axon/nav/action", json={"action": "boh", "payload": {}}, headers=H, timeout=30)
    assert r.status_code == 400


def test_proactive_track_dismiss():
    r = requests.get(f"{BASE}/axon/nav/proactive", headers=H, timeout=30)
    assert r.status_code == 200 and "hints" in r.json()
    for h in r.json()["hints"]:
        assert {"id", "text", "route", "label"} <= set(h)
    r = requests.post(f"{BASE}/axon/nav/track", json={"feature": "pytest_feature"}, headers=H, timeout=30)
    assert r.status_code == 200
    assert requests.post(f"{BASE}/axon/nav/track", json={"feature": ""}, headers=H, timeout=30).status_code == 400
    r = requests.post(f"{BASE}/axon/nav/proactive/dismiss", json={"id": "pytest_hint"}, headers=H, timeout=30)
    assert r.status_code == 200
