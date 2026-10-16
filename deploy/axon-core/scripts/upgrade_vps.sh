#!/usr/bin/env bash
# upgrade_vps.sh — V50.z439 — Aggiorna Axon Core (backend) + AdvisorOS web sul VPS con i pacchetti più recenti.
# Da eseguire SUL VPS come root. Modalità:
#   A) scarica i pacchetti dall'ambiente di sviluppo:  SRC_URL=https://<preview>.emergentagent.com KEY=<AXON_PKG_DOWNLOAD_KEY> bash upgrade_vps.sh
#   B) pacchetti già copiati (scp) in /opt/axon-core/:   bash upgrade_vps.sh
#   C) ROLLBACK al backend di un backup precedente:      ROLLBACK=/opt/axon-core/backend-backup-YYYYMMDD-HHMMSS.tgz bash upgrade_vps.sh
#      (ROLLBACK=list → elenca i backup disponibili; ROLLBACK=last → il backup più recente)
#   D) solo diagnostica (nessuna modifica):              DIAG=1 bash upgrade_vps.sh
# Cosa fa: sostituisce SOLO il codice in /opt/axon-core/backend (il file .env, nginx/conf.d con il dominio, certificati, volumi
# MongoDB/uploads NON vengono toccati), ricostruisce il container axon-core, installa il web (install_web_on_vps.sh) e verifica.
# Prima di ogni sostituzione salva backend-backup-<data>.tgz (ne conserva 5): è lo stato ESATTO del codice precedente.
set -euo pipefail
DEST="${DEST:-/opt/axon-core}"
cd "$DEST"
test -f docker-compose.yml || { echo "ERRORE: $DEST/docker-compose.yml non trovato"; exit 1; }
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"

diag() {
  echo "── DIAGNOSTICA ──────────────────────────────────────────────"
  echo "• versione backend installata: $(cat backend/PKG_VERSION 2>/dev/null || cat backend/DEPLOY_CHANGELOG.md 2>/dev/null | grep -m1 '^| 20' | cut -d'|' -f2-3 || echo '?')"
  echo "• backup disponibili (il più vecchio = codice prima degli aggiornamenti):"; ls -1t backend-backup-*.tgz 2>/dev/null | sed 's/^/    /' || echo "    (nessuno)"
  echo "• container:"; (docker compose ps 2>/dev/null | sed 's/^/    /') || true
  echo "• ultimi errori/avvisi backend (2h):"
  docker compose logs --since 2h axon-core 2>/dev/null | grep -iE "error|traceback|timeout|warn|rules-engine|fallback" | tail -n 25 | cut -c1-220 | sed 's/^/    /' || true
  echo "• tempo di risposta /api/health: $(curl -sk -o /dev/null -w '%{time_total}s (HTTP %{http_code})' https://localhost/api/health 2>/dev/null || echo 'n/d')"
  echo "─────────────────────────────────────────────────────────────"
}

rebuild_and_wait() {
  # V50.z562 — snapshot dell'immagine attuale per il ROLLBACK automatico dello smoke gate
  if docker image inspect axon-core:latest >/dev/null 2>&1; then docker tag axon-core:latest axon-core:prev && echo "→ immagine precedente salvata come axon-core:prev"; fi
  docker compose up -d --build axon-core
  echo "→ attendo l'avvio del backend…"
  for i in $(seq 1 60); do
    if curl -sk -o /dev/null -w '%{http_code}' https://localhost/api/health 2>/dev/null | grep -q '^200$'; then echo "→ backend OK (health 200)"; break; fi
    sleep 3
    [[ $i -eq 60 ]] && { echo "✘ backend non risponde: docker compose logs --tail=100 axon-core"; docker compose logs --tail=60 axon-core; exit 1; }
  done
}

if [[ -n "${DIAG:-}" ]]; then diag; exit 0; fi

# ── C) ROLLBACK ────────────────────────────────────────────────────────────────
if [[ -n "${ROLLBACK:-}" ]]; then
  if [[ "$ROLLBACK" == "list" ]]; then ls -1t backend-backup-*.tgz 2>/dev/null || echo "(nessun backup)"; exit 0; fi
  if [[ "$ROLLBACK" == "last" ]]; then ROLLBACK="$(ls -1t backend-backup-*.tgz 2>/dev/null | head -1)"; fi
  test -f "$ROLLBACK" || { echo "ERRORE: backup $ROLLBACK non trovato (ROLLBACK=list per l'elenco)"; exit 1; }
  TMP="$(mktemp -d)"; tar xzf "$ROLLBACK" -C "$TMP"
  test -f "$TMP/backend/server.py" || { echo "ERRORE: $ROLLBACK non contiene backend/server.py"; exit 1; }
  STAMP="$(date +%Y%m%d-%H%M%S)"; tar czf "backend-backup-$STAMP.tgz" backend && echo "→ backup dello stato attuale: backend-backup-$STAMP.tgz"
  rsync -a --delete --exclude '.env' --exclude 'assets/kokoro' "$TMP/backend/" "$DEST/backend/"
  echo "→ backend ripristinato da $ROLLBACK"
  rebuild_and_wait
  rm -rf "$TMP"
  echo "✔ Rollback completato (il web e MongoDB non sono stati toccati)."; diag; exit 0
fi

if [[ -n "${SRC_URL:-}" && -n "${KEY:-}" ]]; then
  echo "→ download pacchetti da $SRC_URL"
  curl -fSL --progress-bar -o axon-core-pkg.tgz "$SRC_URL/api/pkg/axon-core-pkg?key=$KEY"
  curl -fSL --progress-bar -o axon-web-pkg.tgz  "$SRC_URL/api/pkg/axon-web-pkg?key=$KEY"
fi
test -f axon-core-pkg.tgz || { echo "ERRORE: axon-core-pkg.tgz mancante in $DEST (copialo con scp o usa SRC_URL/KEY)"; exit 1; }
test -f axon-web-pkg.tgz  || { echo "ERRORE: axon-web-pkg.tgz mancante in $DEST"; exit 1; }

TMP="$(mktemp -d)"
tar xzf axon-core-pkg.tgz -C "$TMP"
tar xzf axon-web-pkg.tgz  -C "$TMP"
echo "→ versione pacchetto: $(cat "$TMP/axon-core-pkg/PKG_VERSION" 2>/dev/null || echo '?')"

# 1) Backend: backup + sostituzione codice (il .env di compose sta in $DEST/.env, non in backend/)
#    --exclude assets/kokoro: i modelli TTS locali (se presenti sul VPS) non vengono cancellati dal --delete
STAMP="$(date +%Y%m%d-%H%M%S)"
if [[ -d backend ]]; then tar czf "backend-backup-$STAMP.tgz" backend && echo "→ backup: $DEST/backend-backup-$STAMP.tgz"; fi
rsync -a --delete --exclude '.env' --exclude 'assets/kokoro' "$TMP/axon-core-pkg/backend/" "$DEST/backend/"
cp "$TMP/axon-core-pkg/PKG_VERSION" backend/PKG_VERSION 2>/dev/null || true
echo "→ backend aggiornato"
# V50.z469 — docker-compose.yml aggiornato dal pacchetto (nuovo servizio `clamav` per l'antivirus upload): backup del precedente
if [[ -f "$TMP/axon-core-pkg/docker-compose.yml" ]] && ! cmp -s "$TMP/axon-core-pkg/docker-compose.yml" docker-compose.yml; then
  cp docker-compose.yml "docker-compose.backup-$STAMP.yml" && cp "$TMP/axon-core-pkg/docker-compose.yml" docker-compose.yml
  echo "→ docker-compose.yml aggiornato (backup: docker-compose.backup-$STAMP.yml)"
  docker compose up -d clamav 2>/dev/null && echo "→ antivirus ClamAV avviato (prime firme: 2-5 min; stato: GET /api/admin/upload-guard/status)" || true
fi

# 2) Rebuild + restart del solo container backend (MongoDB e nginx restano su)
rebuild_and_wait

# V50.z560 — VERIFICA: la versione che il backend DICHIARA di eseguire (GET /api/health → version) deve coincidere con il tag del pacchetto
PKG_TAG="$(sed -n 's/.*tag=\([^ ]*\).*/\1/p' backend/PKG_VERSION 2>/dev/null | head -1)"
# V50.z568 — numero di route API della versione in esecuzione PRIMA dell'upgrade: lo smoke gate fallisce se il nuovo ne espone di meno
PREV_ROUTES="$(curl -sk -m 10 https://localhost/api/health 2>/dev/null | sed -n 's/.*"routes":[ ]*\([0-9]*\).*/\1/p' | head -1)"
RUN_TAG="$(curl -sk https://localhost/api/health 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"
echo "→ versione pacchetto: ${PKG_TAG:-?} · versione in esecuzione: ${RUN_TAG:-?}"
if [[ -n "$PKG_TAG" && "$RUN_TAG" != "$PKG_TAG" ]]; then
  echo "✘ ATTENZIONE: il container esegue ancora codice vecchio. Forzo la ricreazione del container…"
  docker compose up -d --build --force-recreate axon-core
  sleep 8
  RUN_TAG="$(curl -sk https://localhost/api/health 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"
  echo "→ versione in esecuzione dopo la ricreazione: ${RUN_TAG:-?}"
fi
docker compose logs --since 3m axon-core 2>/dev/null | grep -E "\[boot\] Google Drive|\[boot\] core|core-integrity" | tail -n 4 | cut -c1-220 | sed 's/^/    /' || true

# V50.z562 — SMOKE GATE + ROLLBACK AUTOMATICO (Accordo di produzione V1423+)
# V50.z565 — 4 domande post-rebuild, UNA PER CLASSE (simple · crm · drive · energy/listini): se UNA classe supera i 2 s di TTFT → rollback.
# V50.z566 — NESSUN login: le 4 query portano l'header X-Smoke-Test-Secret (SMOKE_TEST_SECRET del .env, letto anche dal container via
# env_file) e il backend inietta un JWT interno per SMOKE_EMAIL solo per richieste da localhost (core/smoke_auth.py). Niente OAuth/password.
# Legge SMOKE_EMAIL / SMOKE_TEST_SECRET / SMOKE_DRIVE_QUERY / SMOKE_TTFT_MAX_S dal .env di compose ($DEST/.env).
SMOKE_SCRIPT="$TMP/axon-core-pkg/smoke_gate.py"; [[ -f "$SMOKE_SCRIPT" ]] || SMOKE_SCRIPT="$DEST/smoke_gate.py"
if [[ "${SKIP_SMOKE_GATE:-0}" == "1" ]]; then
  echo "⚠⚠ SKIP_SMOKE_GATE=1: smoke gate e rollback automatico DISATTIVATI per questo deploy (regola V50.z564: NON usarlo in produzione)."
fi
if [[ -f "$SMOKE_SCRIPT" && "${SKIP_SMOKE_GATE:-0}" != "1" ]]; then
  cp -f "$SMOKE_SCRIPT" "$DEST/smoke_gate.py" 2>/dev/null || true
  _senv() { grep -m1 "^$1=" "$DEST/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'"; }
  sleep 5  # warm-up del modello/embedder
  if BASE_URL="https://localhost" PKG_TAG="$PKG_TAG" PREV_ROUTES="${PREV_ROUTES:-0}" SMOKE_EMAIL="$(_senv SMOKE_EMAIL)" SMOKE_TEST_SECRET="$(_senv SMOKE_TEST_SECRET)" \
     SMOKE_DRIVE_QUERY="$(_senv SMOKE_DRIVE_QUERY)" SMOKE_TTFT_MAX_S="${SMOKE_TTFT_MAX_S:-$(_senv SMOKE_TTFT_MAX_S)}" \
     python3 "$SMOKE_SCRIPT"; then
    docker image rm axon-core:prev >/dev/null 2>&1 || true
  else
    echo "✘✘ SMOKE GATE FALLITO → ROLLBACK IMMEDIATO all'immagine precedente"
    if docker image inspect axon-core:prev >/dev/null 2>&1; then
      docker tag axon-core:prev axon-core:latest
      docker compose up -d --no-build --force-recreate axon-core
      sleep 8
      echo "→ versione dopo il rollback: $(curl -sk https://localhost/api/health 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"
      echo "   (il codice nuovo resta in $DEST/backend: correggi e rilancia. La scomposizione TTFT qui sopra dice QUALE fase ha sforato.)"
    else
      echo "   nessuna immagine precedente disponibile: container lasciato com'è, CONTROLLA i log."
    fi
    exit 4
  fi
fi

# 3) Web (SPA Expo) — install_web_on_vps.sh mantiene il dominio già configurato e ricrea solo nginx
bash "$TMP/axon-web-pkg/install_web_on_vps.sh"

# 4) Pulizia
rm -rf "$TMP" axon-core-pkg.tgz axon-web-pkg.tgz
ls -1t backend-backup-*.tgz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f   # tieni gli ultimi $KEEP_BACKUPS backup
docker image prune -f >/dev/null 2>&1 || true
echo "✔ Aggiornamento completato."
diag
echo "Rollback se serve: ROLLBACK=list bash $DEST/upgrade_vps.sh  →  ROLLBACK=/opt/axon-core/backend-backup-<data>.tgz bash $DEST/upgrade_vps.sh"
