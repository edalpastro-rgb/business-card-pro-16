"""V50.z200 — test e2e Axon System Awareness (routes/axon_system_awareness.py). Uso: python tests/test_axon_system.py"""
import os, sys, time, uuid
import httpx

sys.path.insert(0, os.path.dirname(__file__))
from test_axon_media import login, chat, check, BASE  # noqa: E402


def main():
    tok = login(); h = {"Authorization": f"Bearer {tok}"}; ok = True
    dk = f"test-{uuid.uuid4().hex[:6]}"
    r1 = httpx.post(f"{BASE}/axon/system/heartbeat", headers=h, timeout=30, json={"device_key": dk, "platform": "android", "app_version": "1.0.61", "build_number": "61", "js_version": "2.0.0", "device_name": "Test Phone", "app_env": "standalone"}).json()
    r2 = httpx.post(f"{BASE}/axon/system/heartbeat", headers=h, timeout=30, json={"device_key": dk, "platform": "android", "app_version": "1.0.62", "build_number": "62", "js_version": "2.0.0", "device_name": "Test Phone", "app_env": "standalone"}).json()
    ok &= check(r1["ok"] and r2["new_version_detected"] is True and r2["backend_version"], f"heartbeat: {r1['version']} → {r2['version']} rilevato={r2['new_version_detected']} backend={r2['backend_version']}")
    time.sleep(1)
    st = httpx.get(f"{BASE}/axon/system/status", headers=h, timeout=30).json()
    dev = next((d for d in st["devices"] if d["device_key"] == dk), None)
    ok &= check(dev and dev["app_version"] == "1.0.62" and dev.get("previous_version") == "1.0.61 (build 61)", f"device registrato con previous_version={dev and dev.get('previous_version')}")
    ok &= check(st["backend"]["version"] and st["changelog"] and st["jobs"] and any(j["id"] == "axs-flush" for j in st["jobs"]), f"status: backend {st['backend']['version']} · {len(st['changelog'])} righe changelog · {len(st['jobs'])} job")
    ok &= check(any(e["source"] == "deploy" and "backend" in e["title"] for e in st["events"]), "evento deploy/riavvio backend presente")
    ok &= check(any(e["source"] == "client" and "1.0.62" in e["title"] for e in st["events"]), "evento client_update presente")
    pl = httpx.get(f"{BASE}/axon/proactive/items", headers=h, timeout=30).json()
    items = pl.get("items") or pl if isinstance(pl, list) else pl.get("items", [])
    ok &= check(any((i.get("type") == "client_update" and "1.0.62" in (i.get("title") or "")) for i in items), "messaggio proattivo «App aggiornata» emesso (chat + push)")
    # azioni API loggate dal middleware (POST ok)
    httpx.post(f"{BASE}/axon/media", headers=h, timeout=30, json={"kind": "doc", "data_base64": "QUJD"})   # → 400 (warning)
    time.sleep(0.5)
    ev = httpx.get(f"{BASE}/axon/system/events", headers=h, timeout=30, params={"source": "api", "limit": 20}).json()["items"]
    ok &= check(any("POST axon/media" in e["title"] and e["level"] == "warning" for e in ev), "middleware: POST fallito (400) registrato come warning")
    # chat senza LLM
    rep = chat(h, "hai aggiornamenti?")
    ok &= check("1.0.62" in rep and st["backend"]["version"] in rep and "CHANGELOG" in rep, f"chat «hai aggiornamenti?» → {rep[:90]!r}")
    rep = chat(h, "stato sistema")
    ok &= check("Stato sistema" in rep and "eventi backend" in rep.lower(), f"chat «stato sistema» → {rep[:80]!r}")
    cl = httpx.get(f"{BASE}/axon/system/changelog", headers=h, timeout=30).json()
    ok &= check(cl["version"] == st["backend"]["version"] and len(cl["rows"]) > 5, f"changelog endpoint: {cl['version']} · {len(cl['rows'])} righe")
    print("\nRISULTATO:", "TUTTO OK" if ok else "CI SONO ERRORI")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
