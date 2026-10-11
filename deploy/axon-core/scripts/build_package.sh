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
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'assets/kokoro' --exclude 'models/minilm' --exclude 'data' --exclude '.env' --exclude 'tests' "$ROOT/backend/" "$PKG/backend/"
# V50.z481 — CHANGELOG.md e memory/PRD.md dentro backend/ del pacchetto: Axon (axon_system_awareness.py) li legge per la sezione
# «novità»; sul VPS mancavano → warning «No such file or directory» a ogni upgrade.
cp "$ROOT/CHANGELOG.md" "$PKG/backend/CHANGELOG.md"
mkdir -p "$PKG/backend/memory" && cp "$ROOT/memory/PRD.md" "$PKG/backend/memory/PRD.md"
# V50.z508 — manifest delle route reali (frontend/app/**.tsx → route) letto dal backend all'avvio: a ogni deploy Axon riscansiona i deep link
python3 - "$ROOT/frontend/app" "$PKG/backend/routes_manifest.json" "${TAG:-}" <<'PY'
import json, os, sys, datetime
base, out, tag = sys.argv[1], sys.argv[2], sys.argv[3]
routes = set()
for root, _d, files in os.walk(base):
    for fn in files:
        if not fn.endswith(".tsx") or fn.startswith("_") or fn.startswith("+"):
            continue
        rel = os.path.relpath(os.path.join(root, fn), base)[:-4]
        parts = [p for p in rel.split(os.sep) if not (p.startswith("(") and p.endswith(")"))]
        if parts and parts[-1] == "index":
            parts = parts[:-1]
        routes.add("/" + "/".join(parts))
json.dump({"tag": tag, "generated_at": datetime.datetime.utcnow().isoformat() + "Z", "count": len(routes), "routes": sorted(routes)}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"routes_manifest.json: {len(routes)} route (tag {tag})")
PY
# FIX build VPS: tolgo la riga `litellm @ …#sha256=…` (stesso wheel richiesto da emergentintegrations senza hash → ResolutionImpossible)
grep -v '^litellm @ ' "$PKG/backend/requirements.txt" > "$PKG/backend/requirements.tmp" && mv "$PKG/backend/requirements.tmp" "$PKG/backend/requirements.txt"
cp "$ROOT/deploy/axon-core/Dockerfile" "$PKG/backend/Dockerfile"
cp "$ROOT/deploy/axon-core/.dockerignore" "$PKG/backend/.dockerignore"
cp "$ROOT/deploy/axon-core/docker-compose.yml" "$PKG/"
cp "$ROOT/deploy/axon-core/.env.example" "$PKG/"
cp -r "$ROOT/deploy/axon-core/nginx" "$PKG/nginx"
mkdir -p "$PKG/nginx/certs" "$PKG/nginx/www"
cp "$ROOT/deploy/axon-core/MIGRATION_GUIDE.md" "$PKG/"
cp "$ROOT/deploy/axon-core/scripts/upgrade_vps.sh" "$PKG/upgrade_vps.sh"  # V50.z435 — aggiornamento VPS in un comando
# PKG_VERSION: diagnostica leggibile. `litellm_req_lines` conta le righe `^litellm` in requirements.txt DOPO la rimozione voluta
# qui sopra → 0 è il valore ATTESO (litellm arriva come dipendenza di emergentintegrations). `axon_llm_helper` conta le occorrenze
# dell'helper ANTHROPIC_API_KEY (_axon_llm_key/_axon_llm_chat) nei moduli 19/21 così da verificare al volo che il codice sia aggiornato.
_H19=$(grep -c '_axon_llm_' "$PKG/backend/routes/19_axon_assistant_core.py" || true)
_H21=$(grep -c '_axon_llm_' "$PKG/backend/routes/21_axon_streaming.py" || true)
echo "axon-core-pkg $(date -u +%Y-%m-%dT%H:%M:%SZ) tag=$TAG litellm_req_lines=$(grep -c '^litellm' "$PKG/backend/requirements.txt" || true)(atteso 0) axon_llm_helper=19:${_H19},21:${_H21} md5_19=$(md5sum < "$PKG/backend/routes/19_axon_assistant_core.py" | cut -c1-8) md5_21=$(md5sum < "$PKG/backend/routes/21_axon_streaming.py" | cut -c1-8)" > "$PKG/PKG_VERSION"
OUT="$PWD/axon-core-pkg.tgz"
tar czf "$OUT" -C "$(dirname "$PKG")" axon-core-pkg
echo "Pacchetto creato: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Prossimo passo: scp \"$OUT\" root@80.211.27.80:/opt/axon-core/  → poi segui MIGRATION_GUIDE.md dal punto 3"
