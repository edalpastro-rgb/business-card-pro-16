# Dockerfile — Axon Core (backend FastAPI di AdvisorOS / Axon Lite) per VPS Ubuntu 24.04 + Docker
# Build context = cartella `backend/` del repo (vedi docker-compose.yml → build.context).
# Include: tutte le dipendenze Python (requirements.txt), ffmpeg (compressione audio/video, segmentazione Whisper),
# Tesseract/Leptonica (OCR locale via tesserocr, dizionari in backend/tessdata), librerie OpenCV headless,
# emergentintegrations (LLM/Whisper/TTS via Emergent LLM Key). Nessuna modifica al codice di Core.

# ── Stage 1 — V50.z520: compila whisper.cpp v1.7.5 (binario STATICO whisper-cli) e scarica il modello small ────────────────
FROM python:3.11-slim AS whisper-build
ARG WHISPER_CPP_TAG=v1.7.5
ARG WHISPER_MODEL=small
RUN apt-get update && apt-get install -y --no-install-recommends build-essential g++ cmake git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${WHISPER_CPP_TAG} https://github.com/ggml-org/whisper.cpp /src/whisper.cpp \
 && cmake -S /src/whisper.cpp -B /src/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DGGML_NATIVE=OFF \
 && cmake --build /src/whisper.cpp/build --config Release -j"$(nproc)" --target whisper-cli \
 && install -m 0755 /src/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli \
 && /usr/local/bin/whisper-cli --help >/dev/null 2>&1 || true \
 && mkdir -p /opt/whisper/models \
 && curl -fL --retry 5 --retry-delay 5 -o /opt/whisper/models/ggml-${WHISPER_MODEL}.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin \
 && test -s /opt/whisper/models/ggml-${WHISPER_MODEL}.bin

# ── Stage 2 — immagine finale ────────────────────────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Europe/Rome

# Dipendenze di sistema (ffmpeg è OBBLIGATORIO: conversione audio → WAV 16 kHz mono per whisper-cli)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      tesseract-ocr tesseract-ocr-ita tesseract-ocr-eng libtesseract-dev libleptonica-dev pkg-config \
      libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
      libsndfile1 libgomp1 \
      build-essential g++ \
      curl ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version | head -n 1

# V50.z520 — WHISPER.CPP LOCALE: binario in /usr/local/bin (nel PATH → `which whisper-cli` funziona) + modello in /opt/whisper/models.
# Il backend (routes/axon_stt_local.py) legge WHISPER_CPP_BIN / WHISPER_CPP_MODEL: con AXON_STT_PROVIDER=auto usa il motore
# locale se presenti, altrimenti Deepgram/OpenAI. Nessuna modifica alla logica applicativa.
COPY --from=whisper-build /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-build /opt/whisper/models/ /opt/whisper/models/
ENV WHISPER_CPP_BIN=/usr/local/bin/whisper-cli \
    WHISPER_CPP_MODEL=/opt/whisper/models/ggml-small.bin \
    AXON_STT_PROVIDER=auto
# Verifica in build: binario eseguibile, modello presente, ffmpeg disponibile → la build FALLISCE se manca qualcosa
RUN test -x /usr/local/bin/whisper-cli && test -s /opt/whisper/models/ggml-small.bin && command -v ffmpeg >/dev/null \
 && ls -la /usr/local/bin/whisper-cli /opt/whisper/models/ggml-small.bin

# V50.z529 — KNOWLEDGE BASE PERSONALE (RAG locale): modello di embedding all-MiniLM-L6-v2 in formato ONNX (~90 MB) + tokenizer,
# eseguito con onnxruntime nel processo API (nessuna API esterna, nessun PyTorch). I vettori stanno in ChromaDB (persistente nel
# volume `core_kb` → /app/backend/data). Il backend (routes/axon_knowledge_base.py) legge AXON_EMBED_MODEL_DIR / AXON_KB_DIR.
ARG EMBED_MODEL_REPO=sentence-transformers/all-MiniLM-L6-v2
RUN mkdir -p /opt/axon-models/minilm \
 && curl -fL --retry 5 --retry-delay 5 -o /opt/axon-models/minilm/model.onnx \
      https://huggingface.co/${EMBED_MODEL_REPO}/resolve/main/onnx/model.onnx \
 && curl -fL --retry 5 --retry-delay 5 -o /opt/axon-models/minilm/tokenizer.json \
      https://huggingface.co/${EMBED_MODEL_REPO}/resolve/main/tokenizer.json \
 && test -s /opt/axon-models/minilm/model.onnx && test -s /opt/axon-models/minilm/tokenizer.json \
 && ls -la /opt/axon-models/minilm
ENV AXON_EMBED_MODEL_DIR=/opt/axon-models/minilm \
    AXON_KB_DIR=/app/backend/data/chroma \
    ANONYMIZED_TELEMETRY=False

WORKDIR /app/backend

# Dipendenze Python (layer separato → rebuild veloci). emergentintegrations vive su un indice extra.
# NB: la riga `litellm @ …whl#sha256=…` viene RIMOSSA da requirements.txt in build_package.sh (conflitto con lo stesso wheel
# senza hash richiesto da emergentintegrations → pip "ResolutionImpossible"); litellm 1.80.0 arriva da emergentintegrations.
COPY requirements.txt ./
RUN pip install --upgrade pip \
 && pip install -r requirements.txt --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/

# Codice Core (server.py + routes/ + workers/ + models/ + tessdata/ + assets/). .dockerignore esclude cache e modelli scaricabili.
COPY . .

# Utente non-root (V50.z529: /app/backend/data è il mount del volume core_kb → ChromaDB deve poterci scrivere)
RUN useradd -m -u 10001 axon && mkdir -p /app/backend/data && chown -R axon:axon /app/backend
USER axon

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8001/api/health || curl -fsS http://127.0.0.1:8001/api/ || exit 1

# Stesso avvio dell'ambiente Emergent (uvicorn su 0.0.0.0:8001, 1 worker: APScheduler e cache in-process non vanno duplicati)
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--timeout-keep-alive", "75", "--proxy-headers", "--forwarded-allow-ips", "*"]
