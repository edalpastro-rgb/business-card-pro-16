#!/usr/bin/env bash
# install_web_on_vps.sh — installa AdvisorOS web su nginx del VPS (eseguire DENTRO la cartella estratta axon-web-pkg/).
# Cosa fa: copia ./web in /opt/axon-core/web, aggiorna nginx conf (mantenendo il dominio già impostato) e docker-compose.yml,
# poi ricrea solo il container nginx. Backend e MongoDB NON vengono toccati.
set -euo pipefail
DEST="${DEST:-/opt/axon-core}"
HERE="$(cd "$(dirname "$0")" && pwd)"

test -f "$DEST/docker-compose.yml" || { echo "ERRORE: $DEST/docker-compose.yml non trovato (DEST=$DEST)"; exit 1; }
test -f "$HERE/web/index.html" || { echo "ERRORE: web/index.html mancante nel pacchetto"; exit 1; }

# 1) Dominio già configurato nella conf attuale (CORE_DOMAIN fu sostituito durante la migrazione)
CUR="$DEST/nginx/conf.d/axon-core.conf"
DOMAIN="$(grep -m1 -oE 'server_name [^;]+' "$CUR" | awk '{print $NF}' || true)"
[[ -z "$DOMAIN" || "$DOMAIN" == "CORE_DOMAIN" ]] && DOMAIN="core.axonos.cloud"
echo "→ dominio: $DOMAIN"

# 2) Backup + copia file
STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$CUR" "$CUR.bak-$STAMP"
cp "$DEST/docker-compose.yml" "$DEST/docker-compose.yml.bak-$STAMP"
sed "s/CORE_DOMAIN/$DOMAIN/g" "$HERE/nginx/conf.d/axon-core.conf" > "$CUR"
cp "$HERE/docker-compose.yml" "$DEST/docker-compose.yml"
rm -rf "$DEST/web.new"; cp -r "$HERE/web" "$DEST/web.new"
rm -rf "$DEST/web.old"; [[ -d "$DEST/web" ]] && mv "$DEST/web" "$DEST/web.old"
mv "$DEST/web.new" "$DEST/web"
echo "→ web copiato in $DEST/web ($(du -sh "$DEST/web" | cut -f1))"

# 3) Riavvio nginx (solo nginx)
cd "$DEST"
docker compose up -d --force-recreate nginx
sleep 3
echo "→ verifica:"
curl -sk -o /dev/null -w "  https://$DOMAIN/            → %{http_code} (atteso 200)\n" "https://$DOMAIN/"
curl -sk -o /dev/null -w "  https://$DOMAIN/wake-training → %{http_code} (atteso 200)\n" "https://$DOMAIN/wake-training"
curl -sk -o /dev/null -w "  https://$DOMAIN/api/        → %{http_code} (atteso 200)\n" "https://$DOMAIN/api/"
curl -sk "https://$DOMAIN/wake-training" | grep -q '<div id="root"' && echo "  ✔ pagina web servita (index.html SPA)" || echo "  ✘ index.html non servito — controlla: docker compose logs nginx"
