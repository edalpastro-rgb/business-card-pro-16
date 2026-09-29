# MIGRATION_GUIDE.md — Axon Core → VPS «Axoncore» (80.211.27.80, Ubuntu 24.04, Docker)

> Pacchetto in `deploy/axon-core/`: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `nginx/conf.d/axon-core.conf`, `scripts/`.
> Nessuna modifica al codice di Core: si impacchetta la cartella `backend/` così com'è.
> Risorse VPS: 2 vCPU · 4 GB RAM · 40 GB → dimensionamento nel compose (Core ≤ 2,5 GB, Mongo cache 0,75 GB).

---

## 0. Cosa migra e cosa no

| Componente | Dove | Note |
|---|---|---|
| Backend FastAPI (Core, tutte le API `/api/*`) | container `axon-core` | uvicorn :8001, 1 worker (APScheduler in-process) |
| MongoDB | container `mongodb` + volume `mongo_data` | i DATI vanno esportati dall'ambiente attuale e importati (step 6) |
| HTTPS | container `nginx` :443 | Let's Encrypt (serve un dominio) o autofirmato (solo IP) |
| LLM / Whisper / TTS / Object Storage / Push / Email | restano servizi Emergent | funzionano da qualsiasi server con `EMERGENT_LLM_KEY` e le chiavi nel `.env` |
| Frontend AdvisorOS e Axon Lite | restano dove sono (Emergent) | cambia SOLO `EXPO_PUBLIC_BACKEND_URL` (step 8) |

⚠️ **HTTPS è obbligatorio**: le app web (Expo) servite in HTTPS non possono chiamare un backend in HTTP (mixed content). Se non hai un dominio, usa il certificato autofirmato SOLO per i test; per la produzione punta un dominio (es. `core.advisoros.it`) all'IP e usa Let's Encrypt.

---

## 1. Preparare il pacchetto (dal job Core su Emergent)

Dal pannello Emergent scarica il codice (o `git clone`), poi in locale:

```bash
# struttura attesa sul VPS: /opt/axon-core/{backend, nginx, docker-compose.yml, .env}
mkdir -p axon-core-pkg && cd axon-core-pkg
cp -r <repo>/backend ./backend
cp <repo>/deploy/axon-core/Dockerfile      ./backend/Dockerfile
cp <repo>/deploy/axon-core/.dockerignore   ./backend/.dockerignore
cp <repo>/deploy/axon-core/docker-compose.yml ./
cp -r <repo>/deploy/axon-core/nginx ./nginx
cp <repo>/deploy/axon-core/.env.example ./.env.example
rm -rf backend/__pycache__ backend/routes/__pycache__ backend/workers/__pycache__ backend/assets/kokoro   # ~340 MB, non servono (KOKORO_DISABLE=1)
tar czf axon-core-pkg.tgz backend nginx docker-compose.yml .env.example
```

Oppure usa lo script pronto: `bash deploy/axon-core/scripts/build_package.sh` (crea `axon-core-pkg.tgz` nella cartella corrente).

## 2. Preparare il VPS (una volta)

```bash
ssh root@80.211.27.80
apt-get update && apt-get -y upgrade
# Docker è già installato: verifica compose v2
docker --version && docker compose version
# Firewall: solo SSH, HTTP, HTTPS
apt-get install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
# Swap 2 GB (consigliato con 4 GB RAM: build pip + ffmpeg)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
mkdir -p /opt/axon-core && exit
```

## 3. Copiare i file via SSH

```bash
scp axon-core-pkg.tgz root@80.211.27.80:/opt/axon-core/
ssh root@80.211.27.80 'cd /opt/axon-core && tar xzf axon-core-pkg.tgz && rm axon-core-pkg.tgz && ls'
# atteso: backend  nginx  docker-compose.yml  .env.example
```

(Alternativa a cartelle: `rsync -avz --exclude __pycache__ --exclude assets/kokoro ./ root@80.211.27.80:/opt/axon-core/`)

## 4. Configurare le variabili d'ambiente

```bash
ssh root@80.211.27.80
cd /opt/axon-core
cp .env.example .env
nano .env
```

Compila almeno:
- `MONGO_ROOT_PASSWORD` → password lunga casuale (`openssl rand -base64 32`)
- `JWT_SECRET`, `FIELD_ENC_KEY`, `SENSITIVE_ENC_KEY`, `OUTLOOK_TOKEN_ENC_KEY`, `GOOGLE_DRIVE_TOKEN_KEY` → **gli stessi valori dell'ambiente attuale** (backend/.env su Emergent), altrimenti login/token/dati cifrati non saranno più validi
- `EMERGENT_LLM_KEY` (LLM, Whisper, TTS, Object Storage), `TAVILY_API_KEY`, `EMERGENT_PUSH_KEY`, `EMERGENT_EMAIL_KEY`/`RESEND_API_KEY`
- `SUPER_MASTER_EMAILS`
- `APP_PUBLIC_URL` → `https://80.211.27.80` (o `https://core.tuodominio.it`)
- redirect OAuth (`GOOGLE_DRIVE_REDIRECT_URI`, `MS_REDIRECT_URI`, `DROPBOX_REDIRECT_URI`) → nuovo host; **aggiorna gli stessi URL anche nelle console Google / Azure / Dropbox**

```bash
chmod 600 .env
```

## 5. Certificato HTTPS

**A) Con dominio (produzione, consigliato)** — punta il record DNS `A` del dominio a `80.211.27.80`, poi:

```bash
cd /opt/axon-core
sed -i 's/CORE_DOMAIN/core.tuodominio.it/g' nginx/conf.d/axon-core.conf
mkdir -p nginx/certs nginx/www
# certificato temporaneo per far partire nginx
openssl req -x509 -nodes -days 3 -newkey rsa:2048 -keyout nginx/certs/privkey.pem -out nginx/certs/fullchain.pem -subj "/CN=core.tuodominio.it"
docker compose up -d nginx
# Let's Encrypt (webroot condiviso con nginx)
docker run --rm -v /opt/axon-core/nginx/www:/var/www/certbot -v /opt/axon-core/letsencrypt:/etc/letsencrypt certbot/certbot certonly --webroot -w /var/www/certbot -d core.tuodominio.it --agree-tos -m tuamail@dominio.it --non-interactive
cp letsencrypt/live/core.tuodominio.it/fullchain.pem nginx/certs/ && cp letsencrypt/live/core.tuodominio.it/privkey.pem nginx/certs/
docker compose restart nginx
# rinnovo automatico (cron mensile)
echo '0 4 1 * * cd /opt/axon-core && docker run --rm -v /opt/axon-core/nginx/www:/var/www/certbot -v /opt/axon-core/letsencrypt:/etc/letsencrypt certbot/certbot renew --webroot -w /var/www/certbot -q && cp letsencrypt/live/core.tuodominio.it/*.pem nginx/certs/ && docker compose restart nginx' | crontab -
```

**B) Solo IP (test)** — certificato autofirmato (i browser mostreranno un avviso; le app native lo rifiutano → solo per prove):

```bash
cd /opt/axon-core && mkdir -p nginx/certs nginx/www
sed -i 's/ CORE_DOMAIN//g' nginx/conf.d/axon-core.conf
openssl req -x509 -nodes -days 825 -newkey rsa:2048 -keyout nginx/certs/privkey.pem -out nginx/certs/fullchain.pem -subj "/CN=80.211.27.80" -addext "subjectAltName=IP:80.211.27.80"
```

## 6. Avviare i container

```bash
cd /opt/axon-core
docker compose up -d --build          # prima build: 5-10 min (pip + apt). Le successive: secondi.
docker compose ps                     # mongodb healthy · axon-core healthy · nginx up
docker compose logs -f axon-core      # attendi: "Application startup complete."
```

### 6b. Migrare i DATI da MongoDB attuale (consigliato prima di cambiare l'URL nelle app)

Dall'ambiente Emergent (job Core), esporta il database e portalo sul VPS:

```bash
# sull'ambiente attuale (MONGO_URL e DB_NAME da backend/.env)
mongodump --uri="$MONGO_URL" --db="$DB_NAME" --gzip --archive=core-dump.gz
scp core-dump.gz root@80.211.27.80:/opt/axon-core/
# sul VPS: import nel container mongodb (nsFrom = nome DB attuale, nsTo = DB_NAME del .env)
docker cp /opt/axon-core/core-dump.gz axon-mongodb:/tmp/core-dump.gz
docker exec axon-mongodb mongorestore --username axon --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --gzip --archive=/tmp/core-dump.gz --nsFrom='test_database.*' --nsTo='axon_core.*' --drop
docker compose restart axon-core
```

> I file su **Object Storage Emergent** non vanno migrati (restano raggiungibili con la stessa `EMERGENT_LLM_KEY`). I file salvati in base64 dentro Mongo viaggiano con il dump.

## 7. Verificare che Core risponde

```bash
# dal VPS
curl -k https://localhost/nginx-health                 # ok
curl -k https://localhost/api/health                   # {"status":"ok",...} (o /api/)
# da fuori
curl -k https://80.211.27.80/api/health
curl -k https://80.211.27.80/api/public/wake-samples/counts        # endpoint pubblico → {"total":..,"sessions":..}
# login (credenziali reali) e una chiamata autenticata
TOKEN=$(curl -sk -X POST https://80.211.27.80/api/auth/login -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -sk -H "Authorization: Bearer $TOKEN" https://80.211.27.80/api/auth/me
# streaming Axon (deve arrivare subito "event: progress … Ci sto pensando…")
curl -skN -X POST https://80.211.27.80/api/assistant/chat/stream -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"message":"ciao"}' | head -5
```

Controlli utili: `docker stats` (RAM Core < 2,5 GB), `docker compose logs --tail=200 axon-core | grep -i error`.

## 8. Puntare AdvisorOS e Axon Lite al nuovo Core

In **entrambi** i job frontend su Emergent (AdvisorOS e Axon Lite) → file `frontend/.env`:

```
EXPO_PUBLIC_BACKEND_URL=https://core.tuodominio.it     # oppure https://80.211.27.80 (solo con certificato valido)
```

Il codice frontend costruisce già gli URL come `${EXPO_PUBLIC_BACKEND_URL}/api/...`, quindi non serve altro. Poi:
1. **Publish** di AdvisorOS e di Axon Lite (il web si aggiorna subito).
2. **Nuove build Android/iOS** (l'URL è compilato nell'app nativa).
3. Aggiornare le variabili di Core che rimandano al frontend (`APP_PUBLIC_URL`, `EXPO_PUBLIC_APP_URL`, `GOOGLE_DRIVE_FRONTEND_URL`, `OUTLOOK_APP_RETURN_URL`) se cambiano anche i domini delle app.
4. Console OAuth (Google Cloud, Azure AD, Dropbox): aggiungere i nuovi redirect URI di Core (`https://<core>/api/...`).

## 9. Operatività

```bash
docker compose logs -f axon-core                 # log live
docker compose restart axon-core                 # riavvio
docker compose pull mongodb && docker compose up -d  # aggiornare Mongo
# aggiornare Core (nuovo pacchetto):  copia backend/ → docker compose up -d --build
# backup Mongo giornaliero (cron 03:30) → /opt/axon-core/backups/ (14 giorni)
mkdir -p /opt/axon-core/backups
(crontab -l 2>/dev/null; echo '30 3 * * * docker exec axon-mongodb mongodump --username axon --password "'"$MONGO_ROOT_PASSWORD"'" --authenticationDatabase admin --gzip --archive=/tmp/b.gz && docker cp axon-mongodb:/tmp/b.gz /opt/axon-core/backups/mongo-$(date +\%F).gz && find /opt/axon-core/backups -mtime +14 -delete') | crontab -
```

## 10. Rollback

Le app puntano a Core tramite `EXPO_PUBLIC_BACKEND_URL`: per tornare indietro basta rimettere l'URL precedente nei due job frontend e ripubblicare. L'ambiente Emergent di Core resta acceso finché la migrazione non è validata (tenere entrambi per almeno una settimana; i dati scritti sul VPS dopo lo switch NON sono sul vecchio ambiente).

---

### Checklist finale
- [ ] `.env` completo (chiavi identiche a produzione, password Mongo nuova)
- [ ] certificato valido (dominio + Let's Encrypt)
- [ ] `docker compose ps` → 3 servizi healthy
- [ ] `/api/health` OK da esterno · login OK · streaming Axon OK
- [ ] dump Mongo importato (conteggio utenti/contatti coerente)
- [ ] `EXPO_PUBLIC_BACKEND_URL` aggiornato in AdvisorOS e Axon Lite → Publish + build
- [ ] redirect OAuth aggiornati nelle console

## 11. AdvisorOS web sullo stesso dominio (link pubblici + desktop) — V50.z405
nginx serve l'export web di Expo (SPA) da `/opt/axon-core/web`: `https://core.axonos.cloud/wake-training`, `/public-review/...`, `/public-lead/...` e l'app intera da desktop. `/api/` resta sul backend.
```bash
cd /opt/axon-core
wget -O axon-web-pkg.tgz "https://business-card-pro-16.preview.emergentagent.com/api/download/axon-web-pkg?key=o6pnNc0Kyh1mn8P2R9Pz0K-8"
tar xzf axon-web-pkg.tgz && bash axon-web-pkg/install_web_on_vps.sh
```
Aggiornamento futuro del frontend: `bash deploy/axon-core/scripts/build_web_package.sh` nel repo → ripetere i 3 comandi sopra.
