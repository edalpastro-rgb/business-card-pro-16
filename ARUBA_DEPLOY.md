# Deploy ProSync CRM su Aruba Cloud — Guida step-by-step

Questa guida ti spiega come portare l'app dal preview di Emergent al tuo dominio **dalpastro.it** ospitato su **Aruba Cloud**.

---

## 📋 Cosa ti serve

1. **Aruba Cloud PRO** (VPS Linux) — un piano base a partire da ~5€/mese va bene per iniziare
   - Sistema: Ubuntu 22.04 LTS
   - RAM: minimo 2 GB (consigliato 4 GB)
   - Spazio: minimo 40 GB
2. Dominio **dalpastro.it** (già tuo) con accesso al pannello Aruba per gestire DNS
3. Cellulare con app Aruba per token 2FA
4. Un computer con **terminale SSH** (Mac / Windows PowerShell / iTerm)

**Costi indicativi**: VPS Aruba Cloud PRO ~5-15€/mese · Dominio già tuo · MongoDB Atlas gratuito (500MB) opzionale

---

## 🖥 STEP 1 — Crea il server VPS su Aruba

1. Vai su [https://www.cloud.it/pannello](https://www.cloud.it/pannello) e accedi
2. Menu → **Cloud Server** → **Nuovo Cloud Server PRO**
3. Configura:
   - **Nome**: `prosync-server`
   - **Sistema operativo**: Ubuntu 22.04 LTS
   - **CPU**: 2 vCPU · **RAM**: 4 GB · **Disco**: 80 GB SSD
   - **Password admin**: scegline una robusta e **annotala**
4. Clicca **Crea** → attendi 3-5 minuti
5. Copia l'**indirizzo IP pubblico** del server (esempio: `93.146.xxx.xxx`)

---

## 🌐 STEP 2 — Punta il dominio al server

1. Nel pannello Aruba → **Domini** → seleziona `dalpastro.it` → **Gestione DNS**
2. Aggiungi/modifica questi record:

| Tipo | Nome | Valore | TTL |
|------|------|--------|-----|
| A | `app` | `93.146.xxx.xxx` (IP del VPS) | 3600 |
| A | `api` | `93.146.xxx.xxx` (stesso IP) | 3600 |

Risultato: `app.dalpastro.it` e `api.dalpastro.it` punteranno al tuo server.

⏱ **Attesa propagazione DNS**: 5-30 minuti. Verifica con: `ping app.dalpastro.it`

---

## 🔐 STEP 3 — Connettiti al server via SSH

Da terminale sul tuo computer:
```bash
ssh root@93.146.xxx.xxx
```
(inserisci la password creata al passo 1)

**Aggiorna sistema e installa strumenti base**:
```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose git nginx certbot python3-certbot-nginx ufw
systemctl enable --now docker
```

**Attiva firewall**:
```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

---

## 📦 STEP 4 — Deploya l'app con Docker

1. Crea la cartella del progetto:
```bash
mkdir -p /opt/prosync && cd /opt/prosync
```

2. Copia i file backend dal tuo Emergent (scarica prima il codice con "Save to GitHub" dal pannello Emergent, poi clona qui):
```bash
git clone https://github.com/TUO-USERNAME/prosync-repo.git .
```
(sostituisci con il tuo repo GitHub)

3. Crea `docker-compose.yml` in `/opt/prosync/`:
```yaml
version: "3.9"
services:
  mongodb:
    image: mongo:7
    restart: always
    volumes:
      - ./mongo-data:/data/db
    environment:
      MONGO_INITDB_ROOT_USERNAME: prosync
      MONGO_INITDB_ROOT_PASSWORD: CHANGE_ME_STRONG_PASSWORD
    networks: [prosync]

  backend:
    build: ./backend
    restart: always
    environment:
      MONGO_URL: "mongodb://prosync:CHANGE_ME_STRONG_PASSWORD@mongodb:27017/?authSource=admin"
      DB_NAME: "prosync_prod"
      JWT_SECRET: "GENERA_UNA_STRINGA_LUNGA_RANDOM_QUI_64+_CARATTERI"
    depends_on: [mongodb]
    ports:
      - "127.0.0.1:8001:8001"
    networks: [prosync]

networks:
  prosync:
```

4. Crea `backend/Dockerfile` (se non c'è già):
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
```

5. Avvia lo stack:
```bash
docker-compose up -d --build
docker-compose logs -f backend
```
Verifica che il backend risponda: `curl http://localhost:8001/api/` deve tornare `{"message":"ProSync CRM API","ok":true}`

---

## 🌍 STEP 5 — Configura Nginx come reverse proxy + HTTPS

1. Crea `/etc/nginx/sites-available/prosync`:
```nginx
server {
    server_name api.dalpastro.it;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }

    listen 80;
}
```

2. Attiva:
```bash
ln -s /etc/nginx/sites-available/prosync /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

3. Ottieni certificato HTTPS gratuito Let's Encrypt:
```bash
certbot --nginx -d api.dalpastro.it
```
(rispondi alle domande — inserisci la tua email, accetta i termini)

Ora `https://api.dalpastro.it/api/` funziona con HTTPS. ✅

---

## 📱 STEP 6 — Genera build mobile che punti al tuo server

Nel tuo pannello Emergent:
1. Aggiorna la variabile d'ambiente `EXPO_PUBLIC_BACKEND_URL` a `https://api.dalpastro.it`
2. Clicca **Publish** (in alto a destra) → **Deploy**
3. Poi **Generate iOS/Android build** → segui procedura per app store

Alternativa (build APK diretto senza store):
- Emergent genera un `.apk` che puoi installare direttamente sul tuo Android

---

## 📥 STEP 7 — (Opzionale) Ospita anche il frontend web su Aruba

Se vuoi che `app.dalpastro.it` mostri la versione web dell'app:

1. Sul tuo computer, esporta la build web:
```bash
cd /path/to/prosync/frontend
npx expo export --platform web
```
Questo crea la cartella `dist/`.

2. Trasferiscila sul server:
```bash
scp -r dist/ root@93.146.xxx.xxx:/var/www/prosync-web/
```

3. Aggiungi il vhost Nginx `/etc/nginx/sites-available/prosync-web`:
```nginx
server {
    server_name app.dalpastro.it;
    root /var/www/prosync-web;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    listen 80;
}
```
```bash
ln -s /etc/nginx/sites-available/prosync-web /etc/nginx/sites-enabled/
certbot --nginx -d app.dalpastro.it
systemctl reload nginx
```

---

## 🔒 Consigli sicurezza & manutenzione

- **Backup MongoDB automatico**: aggiungi a crontab `0 3 * * * docker exec prosync_mongodb_1 mongodump --archive --gzip --username prosync --password TUO_PASSWORD > /backup/db-$(date +\%F).gz`
- **Aggiorna Docker images ogni mese**: `docker-compose pull && docker-compose up -d`
- **Monitora spazio disco**: `df -h`
- **Log applicativi**: `docker-compose logs --tail=100 backend`
- **Fail2ban per SSH**: `apt install fail2ban -y`

---

## 🆘 Problemi comuni

| Problema | Soluzione |
|----------|-----------|
| DNS non risolve | Aspetta 30 min; verifica `dig app.dalpastro.it` |
| Certbot fallisce | Assicurati che porta 80 sia aperta e DNS punti al server |
| 502 Bad Gateway | `docker-compose ps` verifica che backend sia UP |
| MongoDB non parte | Controlla `docker-compose logs mongodb`, verifica permessi cartella |
| Build APK non si connette | `EXPO_PUBLIC_BACKEND_URL` deve essere HTTPS con dominio pubblico |

---

## 📞 Riferimenti

- Aruba Cloud panel: https://www.cloud.it/pannello
- Emergent panel: https://app.emergent.sh
- Certbot docs: https://certbot.eff.org

**Tempo totale stimato**: 60-90 minuti la prima volta. Le volte successive per aggiornamenti: 5 min (`git pull && docker-compose up -d --build`).
