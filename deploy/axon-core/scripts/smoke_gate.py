#!/usr/bin/env python3
"""smoke_gate.py — V50.z562 — SMOKE GATE post-deploy (Accordo di produzione V1423+).

Eseguito da upgrade_vps.sh dopo il rebuild. Exit code 0 = deploy OK; ≠0 = BLOCCA e lo script fa ROLLBACK all'immagine precedente.
Controlli:
  1. /api/health → 200, version == tag del pacchetto (se PKG_TAG), core_integrity == true
  2. NESSUN login: ogni richiesta porta l'header X-Smoke-Test-Secret (= SMOKE_TEST_SECRET del .env); il backend (core/smoke_auth.py),
     solo per richieste da localhost, inietta un JWT interno per l'account SMOKE_EMAIL (nessun OAuth, nessuna password).
     → /api/assistant/chat/stream su 4 domande campione, UNA PER CLASSE (simple, crm, drive, energy):
       TTFT (primo delta) ≤ SMOKE_TTFT_MAX_S (default 2.0, misurato sul server stesso quindi senza rete pubblica)
       streaming fluido: ≥ 3 delta e timestamp crescenti (non tutto in un blocco)
  3. retrieval Drive: /api/google-drive/retrieval-check?q=SMOKE_DRIVE_QUERY (default 01_POWER) → found == true
     (saltato con WARN se l'account non ha Drive collegato: indexed_files == 0 e folders == 0)
Variabili: BASE_URL (default https://localhost), PKG_TAG, SMOKE_EMAIL, SMOKE_TEST_SECRET, SMOKE_DRIVE_QUERY, SMOKE_TTFT_MAX_S, SMOKE_SKIP_DRIVE=1
Senza SMOKE_EMAIL/SMOKE_TEST_SECRET: vengono verificati SOLO gli endpoint pubblici (health, integrità core, manuale pubblico, scomposizione TTFT).
"""
import json
import os
import ssl
import sys
import time
import urllib.request

BASE = (os.environ.get("BASE_URL") or "https://localhost").rstrip("/")
PKG_TAG = os.environ.get("PKG_TAG") or ""
EMAIL = os.environ.get("SMOKE_EMAIL") or ""
SECRET = (os.environ.get("SMOKE_TEST_SECRET") or "").strip()  # V50.z566 — header X-Smoke-Test-Secret (mai password, mai OAuth)
DRIVE_Q = os.environ.get("SMOKE_DRIVE_QUERY") or "01_POWER"
TTFT_MAX = float(os.environ.get("SMOKE_TTFT_MAX_S") or "2.0")
# V50.z565 — UNA domanda per CLASSE: semplice · CRM/agenda · Drive (contenuto file) · listini energetici (GME/PUN).
# Il rollback scatta se UNA QUALSIASI classe supera SMOKE_TTFT_MAX_S (2 s): il preflight legge solo cache Mongo/ChromaDB.
QUESTIONS = [("simple", "Che ore sono?"), ("crm", "Quanti appuntamenti ho domani?"),
             ("drive", f"Cosa c'è scritto nei miei file su Drive riguardo {DRIVE_Q}? Cita il nome del file."),
             ("energy", "Mostrami i listini energia: PUN F1, F2, F3 e monorario dell'ultimo mese disponibile")]
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
FAILS, WARNS = [], []


def _req(path, data=None, token=None, timeout=60):
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None, method="POST" if data is not None else "GET")
    req.add_header("Content-Type", "application/json")
    if token:  # token == "smoke" → header X-Smoke-Test-Secret: il backend inietta il Bearer interno per SMOKE_EMAIL
        req.add_header("X-Smoke-Test-Secret", SECRET)
    return urllib.request.urlopen(req, timeout=timeout, context=CTX)


def check_health():
    try:
        h = json.loads(_req("/api/health", timeout=15).read())
    except Exception as exc:  # noqa: BLE001
        FAILS.append(f"health non raggiungibile: {exc}"); return
    if h.get("status") != "ok":
        FAILS.append(f"health status={h.get('status')}")
    if PKG_TAG and h.get("version") != PKG_TAG:
        FAILS.append(f"versione in esecuzione {h.get('version')} ≠ pacchetto {PKG_TAG}")
    if h.get("core_integrity") is False:
        FAILS.append("core_integrity=false: namespace protetto RIDEFINITO")
    print(f"  health: version={h.get('version')} core_integrity={h.get('core_integrity')} routes={h.get('routes')}")


def stream_probe(token, msg):
    t0 = time.time(); first = None; stamps = []; ev = ""
    with _req("/api/assistant/chat/stream", {"message": msg, "session_id": f"smoke_{int(t0*1000)}", "no_cache": True}, token, timeout=90) as r:
        for raw in r:
            line = raw.decode("utf-8", "ignore").rstrip("\n")
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                if ev == "delta":
                    now = time.time() - t0; stamps.append(now)
                    if first is None:
                        first = now
                if ev == "done":
                    break
    return first, stamps, time.time() - t0


def check_stream(token):
    for cls, q in QUESTIONS:
        try:
            first, stamps, total = stream_probe(token, q)
        except Exception as exc:  # noqa: BLE001
            FAILS.append(f"stream [{cls}] «{q}»: errore {exc}"); continue
        ok_ttft = first is not None and first <= TTFT_MAX
        # «in blocco» = lunga attesa poi tutto insieme; le risposte deterministiche istantanee (1 delta in <1 s) sono legittime
        fluid = (len(stamps) >= 3 and len(set(round(s, 2) for s in stamps)) >= 2) or total < 1.0
        print(f"  stream [{cls}] «{q}»: TTFT={first and round(first,2)}s deltas={len(stamps)} total={round(total,2)}s → {'OK' if ok_ttft and fluid else 'KO'}")
        if first is None:
            FAILS.append(f"stream [{cls}] «{q}»: nessun delta")
        elif not ok_ttft:
            FAILS.append(f"stream [{cls}] «{q}»: TTFT {first:.2f}s > {TTFT_MAX}s → classe {cls} fuori soglia")
        if first is not None and not fluid:
            FAILS.append(f"stream [{cls}] «{q}»: non fluido ({len(stamps)} delta, tutti allo stesso istante)")


def check_drive(token):
    if os.environ.get("SMOKE_SKIP_DRIVE") == "1":
        WARNS.append("retrieval Drive saltato (SMOKE_SKIP_DRIVE=1)"); return
    try:
        st = json.loads(_req("/api/google-drive/reindex/status", token=token, timeout=20).read())
        if not st.get("folders") and not st.get("indexed_files"):
            WARNS.append("account smoke senza Drive collegato: retrieval non verificato"); return
        rc = json.loads(_req(f"/api/google-drive/retrieval-check?q={urllib.request.quote(DRIVE_Q)}", token=token, timeout=30).read())
        print(f"  drive «{DRIVE_Q}»: found={rc.get('found')} semantic={[(s['name'], s['score']) for s in rc.get('semantic', [])][:3]} indexed={rc.get('indexed_files')} chunks={rc.get('semantic_chunks')}")
        if not rc.get("found"):
            FAILS.append(f"retrieval Drive «{DRIVE_Q}»: nessun file con testo trovato")
    except Exception as exc:  # noqa: BLE001
        FAILS.append(f"retrieval Drive: errore {exc}")


def check_public():
    """Endpoint pubblici (senza autenticazione): manuale pubblico raggiungibile, telemetria presente in /api/health."""
    try:
        m = json.loads(_req("/api/public/manual/search?q=axon", timeout=15).read())
        n = len(m.get("items") or []) if isinstance(m, dict) else len(m)
        print(f"  pubblico: /api/public/manual/search → {n} voci")
    except Exception as exc:  # noqa: BLE001
        FAILS.append(f"endpoint pubblico manuale non raggiungibile: {exc}")


def print_breakdown():
    """V50.z564 — dopo le sonde stampa la SCOMPOSIZIONE del TTFT misurata dal server (prep per fase vs gateway LLM):
    se il gate fallisce si vede subito QUALE fase ha mangiato i secondi, senza aprire i log Docker."""
    try:
        t = json.loads(_req("/api/health", timeout=15).read()).get("ttft") or {}
        b = t.get("breakdown") or {}
        if not b:
            return
        print(f"  scomposizione TTFT (server, {t.get('n')} risposte/{t.get('window_min')} min): prep p95={b['prep']['p95']}s · gateway LLM p95={b['llm_first']['p95']}s · altro p95={b['other']['p95']}s")
        if b.get("phases"):
            print("  fasi più lente: " + " · ".join(f"{k} {v['avg']}s (max {v['max']}s)" for k, v in b["phases"].items()))
        if b.get("bottleneck"):
            print("  ⚠ collo di bottiglia: " + b["bottleneck"])
        for c, bc in (t.get("by_class") or {}).items():
            print(f"    classe {c}: n={bc['n']} TTFT p95={bc['ttft']['p95']}s = prep {bc['prep']['p95']}s + LLM {bc['llm_first']['p95']}s" + (f" → {bc['bottleneck']}" if bc.get("bottleneck") else ""))
    except Exception as exc:  # noqa: BLE001
        print(f"  (scomposizione TTFT non disponibile: {exc})")


def main() -> int:
    print(f"▶ SMOKE GATE su {BASE} (tag atteso: {PKG_TAG or '—'})")
    check_health()
    check_public()
    if EMAIL and SECRET:
        try:  # verifica che il corto circuito funzioni (403 = segreto diverso tra .env host e container; 404 = SMOKE_EMAIL inesistente)
            me = json.loads(_req("/api/auth/me", token="smoke", timeout=20).read())
            me = me.get("user") or me; print(f"  smoke auth: ok → {me.get('email') or me.get('user_id')} (JWT interno iniettato dal server)")
        except Exception as exc:  # noqa: BLE001
            FAILS.append(f"smoke auth (X-Smoke-Test-Secret) rifiutata: {exc}")
        else:
            check_stream("smoke")
            check_drive("smoke")
    else:
        WARNS.append("SMOKE_EMAIL/SMOKE_TEST_SECRET assenti nel .env: streaming (4 classi) e Drive NON verificati — solo endpoint pubblici")
    print_breakdown()
    for w in WARNS:
        print("  ⚠ " + w)
    if FAILS:
        print("✘ SMOKE GATE FALLITO:"); [print("   - " + f) for f in FAILS]
        return 2
    print("✔ SMOKE GATE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
