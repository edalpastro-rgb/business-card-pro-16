#!/usr/bin/env bash
# install_web_on_vps.sh — installa AdvisorOS web su nginx del VPS (eseguire DENTRO la cartella estratta axon-web-pkg/).
# Cosa fa: copia ./web in /opt/axon-core/web, aggiorna nginx conf (mantenendo il dominio già impostato) e docker-compose.yml,
# poi ricrea solo il container nginx. Backend e MongoDB NON vengono toccati.
set -euo pipefail
DEST="${DEST:-/opt/axon-core}"
HERE="$(cd "$(dirname "$0")" && pwd)"

test -f "$DEST/docker-compose.yml" || { echo "ERRORE: $DEST/docker-compose.yml non trovato (DEST=$DEST)"; exit 1; }
test -f "$HERE/web/index.html" || { echo "ERRORE: web/index.html mancante nel pacchetto"; exit 1; }

# 1) Dominio già configurato nella conf attuale (CORE_DOMAIN fu sostituito durante la migrazione).
#    V50.z539 — il server_name può contenere più host (IP, core.axonos.cloud, core.italianbrain.it): prendo il primo dominio
#    "principale" ignorando IP e core.italianbrain.it (già presente nel template), così nessun dominio viene perso.
CUR="$DEST/nginx/conf.d/axon-core.conf"
NAMES="$(grep -m1 -oE 'server_name [^;]+' "$CUR" | cut -d' ' -f2- || true)"
DOMAIN=""
for n in $NAMES; do
  [[ "$n" =~ ^[0-9.]+$ || "$n" == "CORE_DOMAIN" || "$n" == "core.italianbrain.it" ]] && continue
  DOMAIN="$n"; break
done
[[ -z "$DOMAIN" ]] && DOMAIN="core.axonos.cloud"
echo "→ dominio: $DOMAIN (+ core.italianbrain.it)"

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

# 3) nginx: V50.z570 — reload graceful (zero downtime) se il container è già su; recreate solo al primo avvio.
cd "$DEST"
if [[ ! -f "$DEST/nginx/conf.d/00-upstream.conf" ]]; then
  # bootstrap blue-green: upstream verso il container attivo (legacy `axon-core` se ancora in esecuzione, altrimenti axon-core-a)
  UP="axon-core-a"; docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'axon-core' && UP="axon-core"
  printf '# generato da upgrade_vps.sh (blue-green) — container attivo\nupstream axon_core {\n    server %s:8001;\n    keepalive 32;\n}\n' "$UP" > "$DEST/nginx/conf.d/00-upstream.conf"
fi
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'axon-nginx' && docker compose exec -T nginx nginx -t >/dev/null 2>&1; then
  docker compose exec -T nginx nginx -s reload && echo "→ nginx ricaricato (reload graceful, nessuna interruzione)"
else
  docker compose up -d --force-recreate nginx
fi
sleep 3
echo "→ verifica:"
curl -sk -o /dev/null -w "  https://$DOMAIN/            → %{http_code} (atteso 200)\n" "https://$DOMAIN/"
curl -sk -o /dev/null -w "  https://$DOMAIN/wake-training → %{http_code} (atteso 200)\n" "https://$DOMAIN/wake-training"
curl -sk -o /dev/null -w "  https://$DOMAIN/api/        → %{http_code} (atteso 200)\n" "https://$DOMAIN/api/"
curl -sk "https://$DOMAIN/wake-training" | grep -q '<div id="root"' && echo "  ✔ pagina web servita (index.html SPA)" || echo "  ✘ index.html non servito — controlla: docker compose logs nginx"
