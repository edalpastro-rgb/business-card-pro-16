# Dockerfile — Axon Core (backend FastAPI di AdvisorOS / Axon Lite) per VPS Ubuntu 24.04 + Docker
# Build context = cartella `backend/` del repo (vedi docker-compose.yml → build.context).
# Include: tutte le dipendenze Python (requirements.txt), ffmpeg (compressione audio/video, segmentazione Whisper),
# Tesseract/Leptonica (OCR locale via tesserocr, dizionari in backend/tessdata), librerie OpenCV headless,
# emergentintegrations (LLM/Whisper/TTS via Emergent LLM Key). Nessuna modifica al codice di Core.

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Europe/Rome

# Dipendenze di sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      tesseract-ocr libtesseract-dev libleptonica-dev pkg-config \
      libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
      libsndfile1 \
      build-essential g++ \
      curl ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Dipendenze Python (layer separato → rebuild veloci). emergentintegrations vive su un indice extra.
# FIX build VPS: la riga `litellm @ …whl#sha256=…` di requirements.txt entra in conflitto con `litellm @ …whl` (stesso URL, senza
# hash) richiesto da emergentintegrations → pip "ResolutionImpossible". Tolgo solo il frammento #sha256 (stesso wheel, stessa versione).
COPY requirements.txt ./
RUN sed -i 's|\(litellm @ [^#]*\)#sha256=[0-9a-f]*|\1|' requirements.txt \
 && pip install --upgrade pip \
 && pip install -r requirements.txt --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/

# Codice Core (server.py + routes/ + workers/ + models/ + tessdata/ + assets/). .dockerignore esclude cache e modelli scaricabili.
COPY . .

# Utente non-root
RUN useradd -m -u 10001 axon && chown -R axon:axon /app/backend
USER axon

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8001/api/health || curl -fsS http://127.0.0.1:8001/api/ || exit 1

# Stesso avvio dell'ambiente Emergent (uvicorn su 0.0.0.0:8001, 1 worker: APScheduler e cache in-process non vanno duplicati)
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--timeout-keep-alive", "75", "--proxy-headers", "--forwarded-allow-ips", "*"]
