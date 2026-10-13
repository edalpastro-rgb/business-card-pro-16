#!/usr/bin/env bash
# issue_ssl_vps.sh — V50.z538b (fix sed delimitatore) — PROCEDURA UNICA (VPS, nginx in Docker): certificato Let's Encrypt per
#   italianbrain.it + www.italianbrain.it + core.italianbrain.it  (un solo certificato SAN, un solo rinnovo)
# e pubblicazione HTTPS della landing dentro il container nginx di Axon Core.
#
# USO (da root sul VPS, con italianbrain-landing.tgz già estratto in /tmp):
#   EMAIL=tua@mail.it bash /tmp/italianbrain-landing/issue_ssl_vps.sh
# Opzioni: DEST=/opt/axon-core (default) · MODE=webroot (default) | standalone · STAGING=1 (test Let's Encrypt senza limiti di rate)
#
# Cosa fa, in ordine (idempotente: rilanciabile):
#   1. verifica DNS: i 3 domini devono puntare all'IP pubblico del VPS
#   2. copia i file della landing in /var/www/italianbrain e monta la cartella nel container nginx (docker-compose.yml)
#   3. installa nginx/conf.d/italianbrain.conf (80 → ACME + redirect, 443 landing)
#   4. aggiunge core.italianbrain.it al server_name di nginx/conf.d/axon-core.conf
#   5. se mancano i certificati crea un autofirmato temporaneo, poi avvia/ricarica nginx
#   6. certbot (container certbot/certbot) in modalità webroot (o standalone) → ./letsencrypt/live/italianbrain.it/
#   7. copia fullchain/privkey in ./nginx/certs (montata :ro nel container) e ricarica nginx
#   8. installa renew_ssl.sh + cron (lun/gio 04:10) per il rinnovo automatico
#   9. stampa i comandi curl di verifica per ciascun dominio
set -euo pipefail

DEST="${DEST:-/opt/axon-core}"
MODE="${MODE:-webroot}"
EMAIL="${EMAIL:-}"
DOMAINS=(italianbrain.it www.italianbrain.it core.italianbrain.it)
CERT_NAME="italianbrain.it"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBROOT_HOST="/var/www/italianbrain"
STAGING_FLAG=""; [[ "${STAGING:-0}" == "1" ]] && STAGING_FLAG="--staging"

ok()   { echo -e "\033[32m✅ $*\033[0m"; }
warn() { echo -e "\033[33m⚠️  $*\033[0m"; }
die()  { echo -e "\033[31m❌ $*\033[0m"; exit 1; }

[[ $EUID -eq 0 ]] || die "Esegui come root (sudo -i)"
[[ -n "$EMAIL" ]] || die "Serve EMAIL=tua@mail.it (avvisi di scadenza Let's Encrypt)"
[[ -f "$DEST/docker-compose.yml" ]] || die "$DEST/docker-compose.yml non trovato (DEST=$DEST)"
command -v docker >/dev/null || die "docker non trovato"
cd "$DEST"

# ── 1. DNS ───────────────────────────────────────────────────────────────────────────────────────────────────────
PUBLIC_IP="$(curl -4 -s --max-time 8 https://ifconfig.me || curl -4 -s --max-time 8 https://api.ipify.org || true)"
[[ -n "$PUBLIC_IP" ]] || PUBLIC_IP="$(hostname -I | awk '{print $1}')"
echo "IP pubblico VPS: $PUBLIC_IP"
DNS_FAIL=0
for d in "${DOMAINS[@]}"; do
  ip="$(getent ahostsv4 "$d" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [[ "$ip" == "$PUBLIC_IP" ]]; then ok "DNS $d → $ip"; else warn "DNS $d → '${ip:-NESSUNO}' (atteso $PUBLIC_IP)"; DNS_FAIL=1; fi
done
if [[ $DNS_FAIL -eq 1 ]]; then
  die "Correggi i record A nel pannello DNS (Aruba) e attendi la propagazione (5-30 min), poi rilancia. Let's Encrypt fallirebbe."
fi

# ── 2. file landing + mount nel container nginx ─────────────────────────────────────────────────────────────────
mkdir -p "$WEBROOT_HOST" nginx/certs nginx/www nginx/conf.d letsencrypt
for f in index.html style.css og-preview.png og-image.png favicon.svg favicon.png apple-touch-icon.png; do
  [[ -f "$HERE/$f" ]] && install -m 644 "$HERE/$f" "$WEBROOT_HOST/$f"
done
ok "Landing copiata in $WEBROOT_HOST"
if ! grep -q "$WEBROOT_HOST:$WEBROOT_HOST" docker-compose.yml; then
  cp docker-compose.yml "docker-compose.yml.bak-$(date +%Y%m%d-%H%M%S)"
  # aggiunge il volume subito dopo quello della web app (./web:/usr/share/nginx/html:ro) nel servizio nginx
  # (delimitatore '|' perché pattern e sostituzione contengono '/' e '#')
  sed -i -E "s|^([[:space:]]*)- \./web:/usr/share/nginx/html:ro.*|&\n\1- $WEBROOT_HOST:$WEBROOT_HOST:ro   # landing italianbrain.it|" docker-compose.yml
  grep -q "$WEBROOT_HOST:$WEBROOT_HOST" docker-compose.yml || die "Non sono riuscito ad aggiungere il volume in docker-compose.yml: aggiungi a mano sotto nginx.volumes →  - $WEBROOT_HOST:$WEBROOT_HOST:ro"
  ok "Volume $WEBROOT_HOST aggiunto a docker-compose.yml (nginx)"
  NEED_RECREATE=1
else
  ok "Volume landing già presente in docker-compose.yml"
  NEED_RECREATE=0
fi

# ── 3. conf landing ─────────────────────────────────────────────────────────────────────────────────────────────
install -m 644 "$HERE/nginx-italianbrain.conf" nginx/conf.d/italianbrain.conf
ok "nginx/conf.d/italianbrain.conf installata (80 → ACME+redirect · 443 landing · www → apex)"

# ── 4. core.italianbrain.it in axon-core.conf ──────────────────────────────────────────────────────────────────
CORE_CONF="nginx/conf.d/axon-core.conf"
[[ -f "$CORE_CONF" ]] || die "$CORE_CONF non trovato"
if grep -q "core.italianbrain.it" "$CORE_CONF"; then
  ok "core.italianbrain.it già nel server_name di axon-core.conf"
else
  cp "$CORE_CONF" "$CORE_CONF.bak-$(date +%Y%m%d-%H%M%S)"
  sed -i -E 's|^([[:space:]]*server_name[[:space:]]+[^;]*);|\1 core.italianbrain.it;|' "$CORE_CONF"
  grep -q "core.italianbrain.it" "$CORE_CONF" || die "sed su server_name fallito: aggiungi a mano core.italianbrain.it ai due server_name di $CORE_CONF"
  ok "core.italianbrain.it aggiunto ai server_name di axon-core.conf"
fi

# ── 5. certificato temporaneo (solo se manca) + nginx su ─────────────────────────────────────────────────────────
if [[ ! -s nginx/certs/fullchain.pem || ! -s nginx/certs/privkey.pem ]]; then
  openssl req -x509 -nodes -days 3 -newkey rsa:2048 -keyout nginx/certs/privkey.pem -out nginx/certs/fullchain.pem -subj "/CN=italianbrain.it" >/dev/null 2>&1
  warn "Creato certificato autofirmato temporaneo (nginx deve partire per servire la challenge ACME)"
fi
if [[ "$NEED_RECREATE" == "1" ]]; then docker compose up -d --force-recreate nginx; else docker compose up -d nginx; fi
sleep 2
docker compose exec -T nginx nginx -t || die "nginx -t fallito: controlla le conf in nginx/conf.d"
docker compose exec -T nginx nginx -s reload
ok "nginx attivo con le nuove conf"

# ── 6. Let's Encrypt ────────────────────────────────────────────────────────────────────────────────────────────
D_ARGS=(); for d in "${DOMAINS[@]}"; do D_ARGS+=(-d "$d"); done
if [[ "$MODE" == "standalone" ]]; then
  warn "Modalità standalone: fermo nginx per liberare la porta 80 (downtime ~30 s)"
  docker compose stop nginx
  docker run --rm -p 80:80 -v "$DEST/letsencrypt:/etc/letsencrypt" certbot/certbot certonly --standalone \
    --cert-name "$CERT_NAME" "${D_ARGS[@]}" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive --expand $STAGING_FLAG
  docker compose start nginx
else
  docker run --rm -v "$DEST/nginx/www:/var/www/certbot" -v "$DEST/letsencrypt:/etc/letsencrypt" certbot/certbot certonly --webroot -w /var/www/certbot \
    --cert-name "$CERT_NAME" "${D_ARGS[@]}" --email "$EMAIL" --agree-tos --no-eff-email --non-interactive --expand $STAGING_FLAG
fi
[[ -s "letsencrypt/live/$CERT_NAME/fullchain.pem" ]] || die "Certificato non emesso: leggi l'output di certbot qui sopra"
ok "Certificato emesso: letsencrypt/live/$CERT_NAME/ (SAN: ${DOMAINS[*]})"

# ── 7. installa nel mount di nginx e ricarica ────────────────────────────────────────────────────────────────────
cp -L "letsencrypt/live/$CERT_NAME/fullchain.pem" nginx/certs/fullchain.pem
cp -L "letsencrypt/live/$CERT_NAME/privkey.pem"   nginx/certs/privkey.pem
chmod 644 nginx/certs/fullchain.pem; chmod 600 nginx/certs/privkey.pem
docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload
ok "nginx ricaricato con il certificato Let's Encrypt"

# ── 8. rinnovo automatico ───────────────────────────────────────────────────────────────────────────────────────
cat > renew_ssl.sh <<EOF
#!/usr/bin/env bash
# renew_ssl.sh — rinnovo Let's Encrypt (webroot) + copia in nginx/certs + reload nginx. Installato da issue_ssl_vps.sh
set -e; cd "$DEST"
docker run --rm -v "$DEST/nginx/www:/var/www/certbot" -v "$DEST/letsencrypt:/etc/letsencrypt" certbot/certbot renew --webroot -w /var/www/certbot -q
cp -L "letsencrypt/live/$CERT_NAME/fullchain.pem" nginx/certs/fullchain.pem
cp -L "letsencrypt/live/$CERT_NAME/privkey.pem"   nginx/certs/privkey.pem
chmod 644 nginx/certs/fullchain.pem; chmod 600 nginx/certs/privkey.pem
docker compose exec -T nginx nginx -s reload
EOF
chmod +x renew_ssl.sh
CRON_LINE="10 4 * * 1,4 $DEST/renew_ssl.sh >> /var/log/renew_ssl.log 2>&1"
( crontab -l 2>/dev/null | grep -v "renew_ssl.sh" ; echo "$CRON_LINE" ) | crontab -
ok "Cron rinnovo installato: $CRON_LINE"

# ── 9. verifiche ────────────────────────────────────────────────────────────────────────────────────────────────
echo
echo "════════════════ VERIFICHE (lancia uno alla volta) ════════════════"
echo "# 1) italianbrain.it — landing in HTTPS (atteso: HTTP/2 200 + text/html)"
echo "curl -sI https://italianbrain.it | head -5"
echo
echo "# 2) www.italianbrain.it — redirect all'apex (atteso: 301 → https://italianbrain.it/)"
echo "curl -sI https://www.italianbrain.it | head -3"
echo
echo "# 3) core.italianbrain.it — backend Axon Core (atteso: 'Axon Core online')"
echo "curl -s https://core.italianbrain.it/axon-core-status"
echo
echo "# 4) HTTP → HTTPS e certificato (atteso: issuer Let's Encrypt, SAN con i 3 domini)"
echo "curl -sI http://italianbrain.it | head -3"
echo "echo | openssl s_client -servername italianbrain.it -connect italianbrain.it:443 2>/dev/null | openssl x509 -noout -issuer -ext subjectAltName -dates"
echo
echo "# 5) anteprima OG dinamica via landing (atteso: 200 image/png)"
echo "curl -sI https://italianbrain.it/og-preview.png | head -3"
echo "═══════════════════════════════════════════════════════════════════"
ok "FINE. Se un browser mostra ancora 'non sicuro', apri una finestra anonima (cache del vecchio certificato)."
