#!/usr/bin/env bash
# upgrade_vps.sh — V50.z435 — Aggiorna Axon Core (backend) + AdvisorOS web sul VPS con i pacchetti più recenti.
# Da eseguire SUL VPS come root. Due modalità:
#   A) scarica i pacchetti dall'ambiente di sviluppo:  SRC_URL=https://<preview>.emergentagent.com KEY=<AXON_PKG_DOWNLOAD_KEY> bash upgrade_vps.sh
#   B) pacchetti già copiati (scp) in /opt/axon-core/:   bash upgrade_vps.sh
# Cosa fa: sostituisce SOLO il codice in /opt/axon-core/backend (il file .env, nginx/conf.d con il dominio, certificati, volumi
# MongoDB/uploads NON vengono toccati), ricostruisce il container axon-core, installa il web (install_web_on_vps.sh) e verifica.
set -euo pipefail
DEST="${DEST:-/opt/axon-core}"
cd "$DEST"
test -f docker-compose.yml || { echo "ERRORE: $DEST/docker-compose.yml non trovato"; exit 1; }

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

# 1) Backend: backup leggero + sostituzione codice (il .env di compose sta in $DEST/.env, non in backend/)
STAMP="$(date +%Y%m%d-%H%M%S)"
if [[ -d backend ]]; then tar czf "backend-backup-$STAMP.tgz" backend && echo "→ backup: $DEST/backend-backup-$STAMP.tgz"; fi
rsync -a --delete --exclude '.env' "$TMP/axon-core-pkg/backend/" "$DEST/backend/"
echo "→ backend aggiornato"

# 2) Rebuild + restart del solo container backend (MongoDB e nginx restano su)
docker compose up -d --build axon-core
echo "→ attendo l'avvio del backend…"
for i in $(seq 1 60); do
  if curl -sk -o /dev/null -w '%{http_code}' https://localhost/api/health 2>/dev/null | grep -q '^200$'; then echo "→ backend OK (health 200)"; break; fi
  sleep 3
  [[ $i -eq 60 ]] && { echo "✘ backend non risponde: docker compose logs --tail=100 axon-core"; docker compose logs --tail=60 axon-core; exit 1; }
done

# 3) Web (SPA Expo) — install_web_on_vps.sh mantiene il dominio già configurato e ricrea solo nginx
bash "$TMP/axon-web-pkg/install_web_on_vps.sh"

# 4) Pulizia
rm -rf "$TMP" axon-core-pkg.tgz axon-web-pkg.tgz
ls -1t backend-backup-*.tgz 2>/dev/null | tail -n +4 | xargs -r rm -f   # tieni gli ultimi 3 backup
docker image prune -f >/dev/null 2>&1 || true
echo "✔ Aggiornamento completato. Controlli: docker compose ps · docker compose logs --tail=100 axon-core | grep -i error"
