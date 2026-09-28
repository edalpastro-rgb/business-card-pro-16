#!/usr/bin/env bash
# build_package.sh — crea axon-core-pkg.tgz (backend + nginx + compose + .env.example) pronto per lo scp sul VPS.
# Uso: bash deploy/axon-core/scripts/build_package.sh   (dalla root del repo Core)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG="$(mktemp -d)/axon-core-pkg"
mkdir -p "$PKG"
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'assets/kokoro' --exclude '.env' --exclude 'tests' "$ROOT/backend/" "$PKG/backend/"
# FIX build VPS: tolgo la riga `litellm @ …#sha256=…` (stesso wheel richiesto da emergentintegrations senza hash → ResolutionImpossible)
grep -v '^litellm @ ' "$PKG/backend/requirements.txt" > "$PKG/backend/requirements.tmp" && mv "$PKG/backend/requirements.tmp" "$PKG/backend/requirements.txt"
cp "$ROOT/deploy/axon-core/Dockerfile" "$PKG/backend/Dockerfile"
cp "$ROOT/deploy/axon-core/.dockerignore" "$PKG/backend/.dockerignore"
cp "$ROOT/deploy/axon-core/docker-compose.yml" "$PKG/"
cp "$ROOT/deploy/axon-core/.env.example" "$PKG/"
cp -r "$ROOT/deploy/axon-core/nginx" "$PKG/nginx"
mkdir -p "$PKG/nginx/certs" "$PKG/nginx/www"
cp "$ROOT/deploy/axon-core/MIGRATION_GUIDE.md" "$PKG/"
OUT="$PWD/axon-core-pkg.tgz"
tar czf "$OUT" -C "$(dirname "$PKG")" axon-core-pkg
echo "Pacchetto creato: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Prossimo passo: scp \"$OUT\" root@80.211.27.80:/opt/axon-core/  → poi segui MIGRATION_GUIDE.md dal punto 3"
