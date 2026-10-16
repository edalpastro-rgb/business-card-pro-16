#!/usr/bin/env bash
# upgrade_vps.sh — V50.z439 — Aggiorna Axon Core (backend) + AdvisorOS web sul VPS con i pacchetti più recenti.
# Da eseguire SUL VPS come root. Modalità:
#   A) scarica i pacchetti dall'ambiente di sviluppo:  SRC_URL=https://<preview>.emergentagent.com KEY=<AXON_PKG_DOWNLOAD_KEY> bash upgrade_vps.sh
#   B) pacchetti già copiati (scp) in /opt/axon-core/:   bash upgrade_vps.sh
#   C) ROLLBACK al backend di un backup precedente:      ROLLBACK=/opt/axon-core/backend-backup-YYYYMMDD-HHMMSS.tgz bash upgrade_vps.sh
#      (ROLLBACK=list → elenca i backup disponibili; ROLLBACK=last → il backup più recente)
#   D) solo diagnostica (nessuna modifica):              DIAG=1 bash upgrade_vps.sh
#   E) V50.z570 — ritorno istantaneo al container precedente (blue-green): ROLLBACK=switch bash upgrade_vps.sh
# V50.z570 — BLUE-GREEN ZERO DOWNTIME: il nuovo pacchetto parte nel container inattivo (axon-core-a|b), lo smoke gate lo testa
# dall'interno, nginx fa lo switch atomico (reload graceful) solo se passa; altrimenti il nuovo container viene distrutto.
# Cosa fa: sostituisce SOLO il codice in /opt/axon-core/backend (il file .env, nginx/conf.d con il dominio, certificati, volumi
# MongoDB/uploads NON vengono toccati), ricostruisce il container axon-core, installa il web (install_web_on_vps.sh) e verifica.
# Prima di ogni sostituzione salva backend-backup-<data>.tgz (ne conserva 5): è lo stato ESATTO del codice precedente.
set -euo pipefail
DEST="${DEST:-/opt/axon-core}"
cd "$DEST"
test -f docker-compose.yml || { echo "ERRORE: $DEST/docker-compose.yml non trovato"; exit 1; }
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"

# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# V50.z570 — BLUE-GREEN (zero downtime): due container identici axon-core-a / axon-core-b (docker-compose.yml, anchor x-axon-core).
# nginx punta SEMPRE al container attivo tramite nginx/conf.d/00-upstream.conf. Il nuovo pacchetto viene costruito e avviato nel
# container INATTIVO mentre gli utenti restano su quello attivo; lo smoke gate gira DENTRO il nuovo container (4 classi, TTFT < 2 s,
# integrità core, route ≥ precedenti); se passa → switch atomico dell'upstream con `nginx -s reload` (graceful) e stop del vecchio;
# se fallisce → il nuovo container viene distrutto, nessuno se ne accorge. Nessun flag di skip. Boot leggero e reindex notturno invariati.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
UPSTREAM_FILE="$DEST/nginx/conf.d/00-upstream.conf"

active_color() {   # a | b | legacy (container `axon-core` pre-blue-green) | none
  local up; up="$(sed -n 's/.*server \(axon-core[-a-z]*\):8001.*/\1/p' "$UPSTREAM_FILE" 2>/dev/null | head -1)"
  case "$up" in axon-core-a) echo a;; axon-core-b) echo b;; axon-core) echo legacy;;
    *) if docker ps --format '{{.Names}}' | grep -qx 'axon-core-a'; then echo a; elif docker ps --format '{{.Names}}' | grep -qx 'axon-core-b'; then echo b;
       elif docker ps --format '{{.Names}}' | grep -qx 'axon-core'; then echo legacy; else echo none; fi;; esac
}
inactive_color() { case "$1" in a) echo b;; b) echo a;; *) echo a;; esac; }
svc_health() {    # health JSON letto DENTRO il container (il container inattivo non è raggiungibile da nginx)
  docker compose exec -T "$1" python3 -c 'import urllib.request,sys; print(urllib.request.urlopen("http://127.0.0.1:8001/api/health",timeout=8).read().decode())' 2>/dev/null
}
write_upstream() {  # switch ATOMICO: file temporaneo + mv, poi nginx -t e reload graceful (le connessioni in corso finiscono sul vecchio worker)
  printf '# generato da upgrade_vps.sh (blue-green) — container attivo: %s\nupstream axon_core {\n    server %s:8001;\n    keepalive 32;\n}\n' "$1" "$1" > "$UPSTREAM_FILE.tmp"
  mv -f "$UPSTREAM_FILE.tmp" "$UPSTREAM_FILE"
  if docker ps --format '{{.Names}}' | grep -qx 'axon-nginx'; then
    docker compose exec -T nginx nginx -t >/dev/null 2>&1 || { echo "✘ nginx -t fallito dopo lo switch: ripristino"; return 1; }
    docker compose exec -T nginx nginx -s reload
  else
    docker compose up -d nginx
  fi
}

deploy_blue_green() {   # usa $DEST/backend (già aggiornato) → container inattivo → smoke gate → switch → stop del vecchio
  local ACTIVE NEW NEW_SVC OLD_NAME
  ACTIVE="$(active_color)"; NEW="$(inactive_color "$ACTIVE")"; NEW_SVC="axon-core-$NEW"
  case "$ACTIVE" in a|b) OLD_NAME="axon-core-$ACTIVE";; legacy) OLD_NAME="axon-core";; *) OLD_NAME="";; esac
  # migrazione dal conf legacy: l'upstream inline in axon-core.conf va rimosso (altrimenti nginx -t: upstream duplicato)
  if grep -q '^upstream axon_core {' "$DEST/nginx/conf.d/axon-core.conf" 2>/dev/null; then
    sed -i '/^upstream axon_core {/,/^}/d' "$DEST/nginx/conf.d/axon-core.conf" && echo "→ nginx: upstream spostato in 00-upstream.conf (blue-green)"
  fi
  [[ -f "$UPSTREAM_FILE" ]] || write_upstream "${OLD_NAME:-$NEW_SVC}" || true
  echo "→ BLUE-GREEN: attivo=${OLD_NAME:-nessuno} · nuovo=$NEW_SVC"
  PREV_ROUTES="$(curl -sk -m 10 https://localhost/api/health 2>/dev/null | sed -n 's/.*"routes":[ ]*\([0-9]*\).*/\1/p' | head -1)"
  PKG_TAG="$(sed -n 's/.*tag=\([^ ]*\).*/\1/p' backend/PKG_VERSION 2>/dev/null | head -1)"

  docker compose rm -sf "$NEW_SVC" >/dev/null 2>&1 || true
  echo "→ build + avvio di $NEW_SVC in background (gli utenti restano su ${OLD_NAME:-—})…"
  docker compose up -d --build --no-deps "$NEW_SVC"
  for i in $(seq 1 60); do
    if svc_health "$NEW_SVC" | grep -q '"status": *"ok"'; then echo "→ $NEW_SVC OK (health 200)"; break; fi
    sleep 3
    [[ $i -eq 60 ]] && { echo "✘ $NEW_SVC non risponde: lo distruggo, utenti non toccati."; docker compose logs --tail=60 "$NEW_SVC"; docker compose rm -sf "$NEW_SVC" >/dev/null 2>&1; exit 1; }
  done
  RUN_TAG="$(svc_health "$NEW_SVC" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"
  echo "→ versione pacchetto: ${PKG_TAG:-?} · versione nel nuovo container: ${RUN_TAG:-?}"
  if [[ -n "$PKG_TAG" && "$RUN_TAG" != "$PKG_TAG" ]]; then echo "✘ il nuovo container non esegue il pacchetto atteso: distrutto."; docker compose rm -sf "$NEW_SVC" >/dev/null 2>&1; exit 1; fi
  docker compose logs --since 3m "$NEW_SVC" 2>/dev/null | grep -E "\[boot\] Google Drive|\[boot\] core|core-integrity" | tail -n 4 | cut -c1-220 | sed 's/^/    /' || true

  # SMOKE GATE DENTRO IL NUOVO CONTAINER (localhost → core/smoke_auth.py inietta il JWT interno per SMOKE_EMAIL; nessun login/OAuth)
  SMOKE_SCRIPT="$TMP/axon-core-pkg/smoke_gate.py"; [[ -f "$SMOKE_SCRIPT" ]] || SMOKE_SCRIPT="$DEST/smoke_gate.py"
  cp -f "$SMOKE_SCRIPT" "$DEST/smoke_gate.py" 2>/dev/null || true
  _senv() { grep -m1 "^$1=" "$DEST/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'"; }
  docker cp "$SMOKE_SCRIPT" "$NEW_SVC:/tmp/smoke_gate.py"
  sleep 5  # warm-up embedder/modello
  if docker compose exec -T -e BASE_URL="http://127.0.0.1:8001" -e PKG_TAG="$PKG_TAG" -e PREV_ROUTES="${PREV_ROUTES:-0}" \
       -e SMOKE_EMAIL="$(_senv SMOKE_EMAIL)" -e SMOKE_TEST_SECRET="$(_senv SMOKE_TEST_SECRET)" -e SMOKE_DRIVE_QUERY="$(_senv SMOKE_DRIVE_QUERY)" \
       -e SMOKE_TTFT_MAX_S="${SMOKE_TTFT_MAX_S:-$(_senv SMOKE_TTFT_MAX_S)}" "$NEW_SVC" python3 /tmp/smoke_gate.py; then
    echo "✔ SMOKE GATE OK su $NEW_SVC → switch atomico di nginx"
    write_upstream "$NEW_SVC" || { write_upstream "${OLD_NAME:-$NEW_SVC}"; docker compose rm -sf "$NEW_SVC" >/dev/null 2>&1; exit 4; }
    sleep 2
    LIVE="$(curl -sk -m 10 https://localhost/api/health 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"
    if [[ -n "$PKG_TAG" && "$LIVE" != "$PKG_TAG" ]]; then
      echo "✘ dopo lo switch nginx serve ancora $LIVE: torno su ${OLD_NAME:-—} e distruggo $NEW_SVC"; write_upstream "${OLD_NAME:-$NEW_SVC}" || true; docker compose rm -sf "$NEW_SVC" >/dev/null 2>&1; exit 4
    fi
    echo "→ in linea: $LIVE via $NEW_SVC (zero downtime)"
    if [[ -n "$OLD_NAME" && "$OLD_NAME" != "$NEW_SVC" ]]; then
      echo "→ attendo 20 s che gli stream in corso su $OLD_NAME terminino, poi lo fermo (resta disponibile per il rollback: ROLLBACK=switch)"
      sleep 20; docker stop "$OLD_NAME" >/dev/null 2>&1 || true
      [[ "$OLD_NAME" == "axon-core" ]] && { docker rm axon-core >/dev/null 2>&1 || true; docker image rm axon-core:prev >/dev/null 2>&1 || true; }
    fi
  else
    echo "✘✘ SMOKE GATE FALLITO su $NEW_SVC → container nuovo DISTRUTTO, utenti ancora su ${OLD_NAME:-—} senza interruzioni"
    echo "   (il codice nuovo resta in $DEST/backend: correggi e rilancia. La scomposizione TTFT qui sopra dice QUALE fase ha sforato.)"
    docker compose logs --tail=40 "$NEW_SVC" 2>/dev/null | cut -c1-200 | sed 's/^/    /' || true
    docker compose rm -sf "$NEW_SVC" >/dev/null 2>&1 || true
    exit 4
  fi
}


diag() {
  echo "── DIAGNOSTICA ──────────────────────────────────────────────"
  echo "• versione backend installata: $(cat backend/PKG_VERSION 2>/dev/null || cat backend/DEPLOY_CHANGELOG.md 2>/dev/null | grep -m1 '^| 20' | cut -d'|' -f2-3 || echo '?')"
  echo "• backup disponibili (il più vecchio = codice prima degli aggiornamenti):"; ls -1t backend-backup-*.tgz 2>/dev/null | sed 's/^/    /' || echo "    (nessuno)"
  echo "• container:"; (docker compose ps 2>/dev/null | sed 's/^/    /') || true
  echo "• ultimi errori/avvisi backend (2h):"
  docker compose logs --since 2h "axon-core-$(active_color 2>/dev/null || echo a)" 2>/dev/null | grep -iE "error|traceback|timeout|warn|rules-engine|fallback" | tail -n 25 | cut -c1-220 | sed 's/^/    /' || true
  echo "• tempo di risposta /api/health: $(curl -sk -o /dev/null -w '%{time_total}s (HTTP %{http_code})' https://localhost/api/health 2>/dev/null || echo 'n/d')"
  echo "─────────────────────────────────────────────────────────────"
}

if [[ -n "${DIAG:-}" ]]; then diag; exit 0; fi

# ── E) V50.z570 — ROLLBACK=switch: torna istantaneamente al container precedente (fermato dopo l'ultimo switch) ──────────
if [[ "${ROLLBACK:-}" == "switch" ]]; then
  CUR="$(active_color)"
  if [[ "$CUR" == "legacy" ]]; then   # V50.z571 — dal container pre-blue-green si torna al colore che esiste (fermato), non a un `a` inventato
    PREV="$(docker ps -a --format '{{.Names}}' | grep -xE 'axon-core-[ab]' | head -1)"
    [[ -n "$PREV" ]] || { echo "ERRORE: nessun container axon-core-a/b disponibile per lo switch (attivo: axon-core legacy)"; exit 1; }
  else
    PREV="axon-core-$(inactive_color "$CUR")"
  fi
  docker start "$PREV" >/dev/null 2>&1 || { echo "ERRORE: container $PREV non disponibile"; exit 1; }
  for i in $(seq 1 30); do svc_health "$PREV" | grep -q '"status": *"ok"' && break; sleep 2; done
  write_upstream "$PREV" && echo "✔ nginx riportato su $PREV (versione: $(svc_health "$PREV" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p'))"
  sleep 20
  case "$CUR" in a|b) docker stop "axon-core-$CUR" >/dev/null 2>&1 || true;; legacy) docker stop axon-core >/dev/null 2>&1 || true;; esac
  exit 0
fi

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
  TMP_RB="$TMP"; TMP="$(mktemp -d)"; deploy_blue_green; rm -rf "$TMP" "$TMP_RB"
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
  # V50.z571 — PRE-CHECK: se il nuovo compose non è valido (es. depends_on su un servizio inesistente) lo si scopre QUI, con il
  # vecchio file ripristinato e la produzione intatta, invece di un errore criptico dentro deploy_blue_green.
  if ! COMPOSE_ERR="$(docker compose config -q 2>&1)"; then
    echo "✘ docker-compose.yml del pacchetto NON valido: $COMPOSE_ERR"
    cp "docker-compose.backup-$STAMP.yml" docker-compose.yml
    echo "   → ripristinato il compose precedente; nessun container toccato. Correggi il pacchetto e rilancia."; exit 1
  fi
  docker compose up -d clamav 2>/dev/null && echo "→ antivirus ClamAV avviato (prime firme: 2-5 min; stato: GET /api/admin/upload-guard/status)" || true
fi
docker compose config -q >/dev/null 2>&1 || { echo "✘ docker-compose.yml non valido: $(docker compose config -q 2>&1 | head -2)"; exit 1; }

# 2) BLUE-GREEN: nuovo pacchetto nel container inattivo → smoke gate interno → switch nginx atomico (zero downtime)
if [[ "${SKIP_SMOKE_GATE:-}" == "1" ]]; then echo "⚠ SKIP_SMOKE_GATE non è più supportato: il gate blue-green è sempre attivo (regola V50.z564)."; fi
deploy_blue_green

# 3) Web (SPA Expo) — install_web_on_vps.sh mantiene il dominio già configurato e ricrea solo nginx
bash "$TMP/axon-web-pkg/install_web_on_vps.sh"

# 4) Pulizia
rm -rf "$TMP" axon-core-pkg.tgz axon-web-pkg.tgz
ls -1t backend-backup-*.tgz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f   # tieni gli ultimi $KEEP_BACKUPS backup
docker image prune -f >/dev/null 2>&1 || true
echo "✔ Aggiornamento completato."
diag
echo "Rollback se serve: ROLLBACK=list bash $DEST/upgrade_vps.sh  →  ROLLBACK=/opt/axon-core/backend-backup-<data>.tgz bash $DEST/upgrade_vps.sh"
