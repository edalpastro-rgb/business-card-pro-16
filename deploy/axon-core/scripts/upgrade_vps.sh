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

# 2) Rebuild + restart del solo container backend (MongoDB e nginx restano su)
rebuild_and_wait

# 3) Web (SPA Expo) — install_web_on_vps.sh mantiene il dominio già configurato e ricrea solo nginx
bash "$TMP/axon-web-pkg/install_web_on_vps.sh"

# 4) Pulizia
rm -rf "$TMP" axon-core-pkg.tgz axon-web-pkg.tgz
ls -1t backend-backup-*.tgz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f   # tieni gli ultimi $KEEP_BACKUPS backup
docker image prune -f >/dev/null 2>&1 || true
echo "✔ Aggiornamento completato."
diag
echo "Rollback se serve: ROLLBACK=list bash $DEST/upgrade_vps.sh  →  ROLLBACK=/opt/axon-core/backend-backup-<data>.tgz bash $DEST/upgrade_vps.sh"
