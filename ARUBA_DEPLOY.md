# 🚀 Come pubblicare ProSync CRM su Aruba (Guida definitiva)

**Livello richiesto**: nessuna esperienza tecnica pregressa · **Tempo**: 60-90 min la prima volta

Questa guida ti porta dalla situazione attuale (app funzionante sulla preview di Emergent) alla pubblicazione **sul tuo dominio `dalpastro.it`** ospitato su **Aruba**.

---

## 🎯 Scegli la strada che fa per te

Aruba ti offre 3 tipi di prodotti. Ne scegli **uno**:

| Prodotto Aruba | Prezzo | Adatto a | Difficoltà |
|---|---|---|---|
| **A) Aruba Cloud PRO** (VPS) — consigliato | ~5-15€/mese | Server Linux completo dove gira l'app + database | 🟡 media |
| **B) Aruba Hosting Linux Pro** | ~2-4€/mese | Solo il **frontend web** (SPA). Il backend deve girare altrove | 🟢 bassa |
| **C) Aruba Managed Server** | ~30€+/mese | Come A ma gestito da Aruba, meno lavoro tuo | 🟢 bassa |

👉 **Consigliato per te**: **A) Aruba Cloud PRO** (una macchina virtuale Linux) — hai controllo completo, costo basso, e ci stanno sia il backend che eventualmente il frontend web.

---

## 🌐 Scegli come vuoi che appaia l'app

**Opzione 1 — Dominio principale**
- L'app risponde su `dalpastro.it` e le API su `api.dalpastro.it`
- ⚠️ Se `dalpastro.it` ha già un tuo sito web attivo (es. sito vetrina), NON usarlo, usa un sottodominio

**Opzione 2 — Sottodominio dedicato (consigliato)**
- L'app: `crm.dalpastro.it`
- Le API: `api.dalpastro.it`
- Non tocca il tuo sito principale
- **Zero costi extra** (i sottodomini sono gratuiti nel tuo dominio Aruba)

Nel resto della guida useremo l'**Opzione 2 (sottodomini)** perché è più pulita. Sostituisci i nomi con quelli che preferisci.

---

# 📋 CHECKLIST INIZIALE — cosa ti serve prima di partire

- [ ] Accesso al pannello Aruba: https://admin.aruba.it — user + password
- [ ] Accesso al pannello DNS del dominio `dalpastro.it` (di solito è nello stesso pannello Aruba)
- [ ] Un computer con un terminale (Mac: app Terminale; Windows: PowerShell oppure "Windows Terminal")
- [ ] 30€ circa disponibili (VPS Aruba Cloud costa dai 4 ai 15€/mese, primo mese di solito in prova o rimborsabile)
- [ ] 60-90 minuti di tempo tranquillo
- [ ] Le credenziali che chiederò per l'app (te le indico più avanti)

---

# 🖥 STEP 1 — Crea la macchina virtuale su Aruba Cloud

1. Vai su **https://www.cloud.it** e accedi con le credenziali Aruba
2. Nel menu clicca **Cloud Server → Compra un nuovo Cloud Server → PRO**
3. Configura così:
   - **Nome server**: `prosync`
   - **Datacenter**: scegli quello geograficamente più vicino (per l'Italia va bene "Arezzo IT2" o "Bergamo IT3")
   - **Sistema operativo**: `Ubuntu Server 22.04 LTS`
   - **CPU**: 2 vCPU
   - **RAM**: 4 GB (puoi ridurre a 2 GB per risparmiare, ma consiglio 4)
   - **Storage**: 80 GB SSD
   - **Backup automatico**: attivalo, costa poco e ti salva la vita se sbagli
   - **Password amministratore**: creane una robusta (min 12 caratteri, con numeri e simboli). **ANNOTALA SUBITO** in un posto sicuro
4. Clicca **Crea**. Attendi 3-5 minuti che Aruba prepari il server
5. Torna a **Cloud Server → i tuoi server → prosync**: **copia l'indirizzo IP pubblico** (es. `93.146.100.55`). Da qui in poi lo chiamerò `TUO_IP`

✅ **Ora hai un server Linux tuo, con un IP pubblico.**

---

# 🌐 STEP 2 — Configura i sottodomini (crm + api)

1. Nel pannello Aruba vai a **Domini** → clicca su `dalpastro.it` → **Gestione DNS**
2. Nella sezione **Record DNS** clicca "Aggiungi record"
3. Aggiungi due record di tipo **A**:

| Tipo | Nome (sottodominio) | Valore (IP) | TTL |
|------|--------------------|-----|-----|
| A | `crm` | `TUO_IP` (es. `93.146.100.55`) | 3600 |
| A | `api` | `TUO_IP` (stesso IP) | 3600 |

4. **Salva**. Aruba di solito propaga i DNS in 5-30 minuti (a volte fino a 2 ore)

5. Verifica che funzioni: dal tuo terminale scrivi
   ```bash
   ping crm.dalpastro.it
   ```
   Se ti risponde dal tuo IP, sei a posto. Se dà "unknown host", aspetta ancora.

✅ **Ora `crm.dalpastro.it` e `api.dalpastro.it` puntano al tuo server.**

---

# 🔌 STEP 3 — Collegati al server via SSH

Dal terminale del tuo computer:

**Su Mac / Linux**:
```bash
ssh root@TUO_IP
```

**Su Windows** (PowerShell):
```powershell
ssh root@TUO_IP
```

Ti chiederà "Are you sure you want to continue?" → digita `yes` e invio.
Poi ti chiederà la **password admin** creata allo step 1 → incollala (attenzione: quando incolli la password NON si vede nulla, è normale, premi invio).

Se vedi il prompt `root@prosync:~#` sei dentro. 🎉

---

# 🛠 STEP 4 — Installa gli strumenti di base sul server

Copia-incolla questo blocco intero nel terminale collegato al server e premi invio:

```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose git nginx certbot python3-certbot-nginx ufw curl
systemctl enable --now docker
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

Ci vogliono 3-5 minuti. Quando ha finito, sei pronto per l'app.

---

# 📥 STEP 5 — Porta il codice dell'app sul server

Nel pannello Emergent (dove stai chattando ora con me), in alto a destra clicca **"Save to GitHub"** e crea un repository GitHub (se non ne hai già uno).

Poi sul server:

```bash
cd /opt
git clone https://github.com/TUO-USERNAME/TUO-REPO.git prosync
cd prosync
ls -la
```

Sostituisci `TUO-USERNAME/TUO-REPO` con l'URL del tuo repository GitHub. Se il repo è privato, GitHub ti chiederà username + Personal Access Token (crealo su https://github.com/settings/tokens).

---

# 🐳 STEP 6 — Configura e avvia Docker

Crea il file di configurazione principale:

```bash
cd /opt/prosync
nano docker-compose.yml
```

Copia dentro questo contenuto (attento a cambiare le password segnate ⚠️):

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
      MONGO_INITDB_ROOT_PASSWORD: CAMBIA_QUESTA_PASSWORD_DB   # ⚠️ scegli password robusta
    networks: [prosync-net]

  backend:
    build: ./backend
    restart: always
    environment:
      MONGO_URL: "mongodb://prosync:CAMBIA_QUESTA_PASSWORD_DB@mongodb:27017/?authSource=admin"   # ⚠️ stessa password sopra
      DB_NAME: "prosync_prod"
      JWT_SECRET: "GENERA_STRINGA_RANDOM_LUNGA_64_CARATTERI_QUI"   # ⚠️ vedi sotto come generarla
    depends_on: [mongodb]
    ports:
      - "127.0.0.1:8001:8001"
    networks: [prosync-net]

networks:
  prosync-net:
```

Salva con **Ctrl+O**, invio, **Ctrl+X**.

**Genera un JWT_SECRET random**:
```bash
openssl rand -hex 32
```
Copia l'output e sostituisci `GENERA_STRINGA_RANDOM_LUNGA_64_CARATTERI_QUI` nel file (riapri con `nano docker-compose.yml`).

**Crea il Dockerfile del backend** (se non c'è già):
```bash
nano backend/Dockerfile
```
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
```

**Avvia tutto**:
```bash
docker-compose up -d --build
```

La prima volta ci mette 5-10 minuti per scaricare e costruire tutto. Poi verifica:
```bash
docker-compose ps
curl http://localhost:8001/api/
```

Se vedi `{"message":"ProSync CRM API","ok":true}` sei riuscito. 🎉

---

# 🌍 STEP 7 — Rendi visibile l'API dall'esterno (Nginx + HTTPS)

**Configura Nginx per api.dalpastro.it**:

```bash
nano /etc/nginx/sites-available/prosync-api
```
```nginx
server {
    server_name api.dalpastro.it;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 80;
}
```

Attiva:
```bash
ln -s /etc/nginx/sites-available/prosync-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

**Ottieni certificato HTTPS gratuito** (Let's Encrypt):
```bash
certbot --nginx -d api.dalpastro.it
```
Ti chiede la tua email → mettila. Accetta le condizioni.
Certbot configura HTTPS automaticamente. Ora prova nel browser: `https://api.dalpastro.it/api/` → deve rispondere in JSON.

---

# 📱 STEP 8 — Configura la app perché usi il tuo server

**Nel pannello Emergent** (dove chatti con me):
1. Vai a **Deployments → Environment Variables** (oppure chiedimelo, lo aggiorno io)
2. Modifica `EXPO_PUBLIC_BACKEND_URL` da `https://business-card-pro-16.preview.emergentagent.com` a `https://api.dalpastro.it`
3. Clicca **Publish** in alto a destra → Deploy
4. Emergent rigenera la build. Poi genera **APK Android / IPA iOS** da "Build"

Da questo momento le build che scaricano gli utenti punteranno al tuo server Aruba, non più al preview di Emergent.

---

# 🎉 (Opzionale) STEP 9 — Ospita anche la versione web su `crm.dalpastro.it`

Se vuoi che la app sia usabile anche da browser:

**Sul tuo computer**:
```bash
cd path/to/prosync/frontend
npx expo export --platform web
```
Crea la cartella `dist/`. Trasferiscila sul server:
```bash
scp -r dist/ root@TUO_IP:/var/www/prosync-web/
```

**Sul server**:
```bash
nano /etc/nginx/sites-available/prosync-web
```
```nginx
server {
    server_name crm.dalpastro.it;
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
certbot --nginx -d crm.dalpastro.it
systemctl reload nginx
```

Ora `https://crm.dalpastro.it` mostra la web app.

---

# 🔒 Manutenzione ordinaria (una volta al mese)

**Aggiorna sistema operativo**:
```bash
ssh root@TUO_IP
apt update && apt upgrade -y
reboot
```

**Aggiorna l'app quando faccio modifiche**:
```bash
ssh root@TUO_IP
cd /opt/prosync
git pull
docker-compose up -d --build
```

**Backup del database** (crea un file compresso):
```bash
docker exec $(docker ps -qf name=mongodb) mongodump --archive --gzip \
  --username prosync --password TUA_PASSWORD_DB > /root/backup-$(date +%F).gz
```
Aggiungi in cron (`crontab -e`) per farlo automaticamente ogni notte:
```
0 3 * * * docker exec $(docker ps -qf name=mongodb) mongodump --archive --gzip --username prosync --password TUA_PASSWORD_DB > /root/backup-$(date +\%F).gz
```

---

# 🆘 Problemi comuni e soluzioni

| Sintomo | Causa | Soluzione |
|---|---|---|
| `ping crm.dalpastro.it` dà "unknown host" | DNS non ancora propagato | Aspetta 30 min. Verifica con `dig crm.dalpastro.it` |
| `certbot` fallisce con "connection refused" | Firewall blocca porta 80 | `ufw allow 'Nginx Full'` e riprova |
| Nginx dà "502 Bad Gateway" | Backend Docker è giù | `docker-compose ps` e `docker-compose logs backend` |
| App mobile non riesce a connettersi | URL sbagliata o HTTP invece di HTTPS | `EXPO_PUBLIC_BACKEND_URL` deve iniziare per `https://` |
| MongoDB non parte | Password contiene caratteri speciali non escapati | Usa solo lettere/numeri per la password DB |
| Rimane senza spazio disco | Log Docker cresciuti | `docker system prune -a --volumes` |

---

# 💰 Costi indicativi mensili

| Voce | Costo |
|---|---|
| Aruba Cloud PRO 2vCPU/4GB/80GB | ~7-9€/mese |
| Backup automatico Aruba | ~2€/mese |
| Dominio dalpastro.it | già tuo (~10€/anno) |
| Certificato HTTPS Let's Encrypt | **gratuito** |
| **Totale** | **~10-12€/mese** |

---

# 📞 Se ti blocchi

- Aruba supporto: 0575 05050 · pannello ticket https://admin.aruba.it
- Documentazione Docker: https://docs.docker.com
- Documentazione Nginx: https://nginx.org/en/docs/
- **Chiedi a me nella chat Emergent**: posso guidarti passo per passo su ogni singolo step

**Tempo prima volta**: 60-90 min. **Aggiornamenti successivi**: 5 min (`git pull && docker-compose up -d --build`).
