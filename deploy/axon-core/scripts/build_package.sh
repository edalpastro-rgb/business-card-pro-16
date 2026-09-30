#!/usr/bin/env bash
# build_package.sh — crea axon-core-pkg.tgz (backend + nginx + compose + .env.example) pronto per lo scp sul VPS.
# Uso: bash deploy/axon-core/scripts/build_package.sh ["descrizione modifiche principali"]   (dalla root del repo Core)
# V50.z420 — se passi una descrizione, viene aggiunta IN CIMA a backend/DEPLOY_CHANGELOG.md una riga «| data | tag | descrizione |»
#            (data Europe/Rome, tag D<anno>.<mese>.<giorno>[-HHMM]) → Axon la legge nel prompt (sezione CHANGELOG DEPLOY).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DESC="${1:-}"
if [ -n "$DESC" ]; then
  CL="$ROOT/backend/DEPLOY_CHANGELOG.md"
  DAY="$(TZ=Europe/Rome date +%Y-%m-%d)"
  TAG="D$(TZ=Europe/Rome date +%Y.%m.%d)"
  # più deploy nello stesso giorno → tag con orario per distinguerli
  if grep -q "^| $DAY " "$CL" 2>/dev/null; then TAG="$TAG-$(TZ=Europe/Rome date +%H%M)"; fi
  ROW="| $DAY | $TAG | $(printf '%s' "$DESC" | tr '|' '·' | tr -d '\n') |"
  python3 - "$CL" "$ROW" <<'PY'
import sys
path, row = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8").read().split("\n")
for i, l in enumerate(lines):
    if l.strip().startswith("|---"):
        lines.insert(i + 1, row); break
else:
    lines += ["", "| Data | Tag | Descrizione |", "|---|---|---|", row]
open(path, "w", encoding="utf-8").write("\n".join(lines))
print("DEPLOY_CHANGELOG.md ← " + row)
PY
fi
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
echo "axon-core-pkg $(date -u +%Y-%m-%dT%H:%M:%SZ) litellm_lines=$(grep -c '^litellm' "$PKG/backend/requirements.txt" || true)" > "$PKG/PKG_VERSION"
OUT="$PWD/axon-core-pkg.tgz"
tar czf "$OUT" -C "$(dirname "$PKG")" axon-core-pkg
echo "Pacchetto creato: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Prossimo passo: scp \"$OUT\" root@80.211.27.80:/opt/axon-core/  → poi segui MIGRATION_GUIDE.md dal punto 3"
