#!/usr/bin/env bash
# build_web_package.sh — export web di AdvisorOS (Expo, SPA) + nginx conf + docker-compose aggiornati → axon-web-pkg.tgz
# Uso: bash deploy/axon-core/scripts/build_web_package.sh [--skip-export]   (dalla root del repo)
# Il frontend viene compilato con EXPO_PUBLIC_BACKEND_URL=https://core.axonos.cloud (stesso dominio di nginx sul VPS).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DIST="$ROOT/deploy/axon-core/web-dist"
CORE_URL="${CORE_URL:-https://core.axonos.cloud}"

if [[ "${1:-}" != "--skip-export" ]]; then
  echo "→ expo export --platform web (EXPO_PUBLIC_BACKEND_URL=$CORE_URL)…"
  (cd "$ROOT/frontend" && EXPO_PUBLIC_BACKEND_URL="$CORE_URL" CI=1 npx expo export --platform web --output-dir "$DIST")
fi
test -f "$DIST/index.html" || { echo "ERRORE: $DIST/index.html mancante"; exit 1; }

PKG="$(mktemp -d)/axon-web-pkg"
mkdir -p "$PKG/web" "$PKG/nginx/conf.d"
cp -r "$DIST"/. "$PKG/web/"
cp "$ROOT/deploy/axon-core/nginx/conf.d/axon-core.conf" "$PKG/nginx/conf.d/axon-core.conf"
cp "$ROOT/deploy/axon-core/docker-compose.yml" "$PKG/docker-compose.yml"
cp "$ROOT/deploy/axon-core/scripts/install_web_on_vps.sh" "$PKG/install_web_on_vps.sh"
echo "axon-web-pkg $(date -u +%Y-%m-%dT%H:%M:%SZ) backend=$CORE_URL" > "$PKG/PKG_VERSION"

OUT="$ROOT/deploy/axon-core/axon-web-pkg.tgz"
tar czf "$OUT" -C "$(dirname "$PKG")" axon-web-pkg
echo "Pacchetto creato: $OUT ($(du -h "$OUT" | cut -f1))"
