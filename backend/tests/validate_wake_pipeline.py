"""Validazione pipeline wake-word «Axon» (openWakeWord features + axon.onnx TemporalCNN) con onnxruntime CPU.
Audio di prova: TTS cloud via API (voci diverse) → PCM 16 kHz int16 → melspectrogram → embedding (76×32, passo 8) → score su 9 embedding."""
import base64, os, subprocess, sys, numpy as np, onnxruntime as ort, requests, imageio_ffmpeg

W = "/app/frontend/assets/wake"
mel = ort.InferenceSession(f"{W}/melspectrogram.onnx", providers=["CPUExecutionProvider"])
emb = ort.InferenceSession(f"{W}/embedding_model.onnx", providers=["CPUExecutionProvider"])
clf = ort.InferenceSession(f"{W}/axon.onnx", providers=["CPUExecutionProvider"])
FF = imageio_ffmpeg.get_ffmpeg_exe()
BASE = "http://localhost:8001/api"; s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}); s.headers["Authorization"] = f"Bearer {r.json().get('token') or r.json().get('access_token')}"

def tts_pcm(text, voice):
    p = f"/tmp/wake_{voice}_{abs(hash(text))}.npy"
    if os.path.exists(p): return np.load(p)
    j = s.post(f"{BASE}/assistant/tts", json={"text": text, "voice": voice}).json()
    raw = base64.b64decode(j["audio_base64"]); mp3 = p + ".mp3"; open(mp3, "wb").write(raw)
    out = subprocess.run([FF, "-nostdin", "-loglevel", "error", "-i", mp3, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    sig = np.frombuffer(out, dtype=np.int16); np.save(p, sig); return sig

def melspec(chunk_i16):
    x = chunk_i16.astype(np.float32)[None, :]
    m = mel.run(None, {"input": x})[0].squeeze()  # (frames, 32)
    return m / 10.0 + 2.0

def stream_scores(sig, chunk=1280, n_emb=9):
    """Streaming a blocchi di 80 ms come sul telefono: melspec su (480 campioni precedenti + 1280 nuovi) → 8 frame → 1 embedding (finestra 76) → score su 9 embedding."""
    sig = np.concatenate([np.zeros(16000, np.int16), sig, np.zeros(16000, np.int16)])
    prev = np.zeros(480, np.int16); melbuf = np.zeros((0, 32), np.float32); embbuf = np.zeros((0, 96), np.float32); scores = []
    for i in range(0, len(sig) - chunk + 1, chunk):
        cur = sig[i:i + chunk]
        m = melspec(np.concatenate([prev, cur])); prev = cur[-480:]
        melbuf = np.vstack([melbuf, m])[-76:]
        if melbuf.shape[0] == 76:
            e = emb.run(None, {"input_1": melbuf[None, :, :, None].astype(np.float32)})[0].reshape(1, 96)
            embbuf = np.vstack([embbuf, e])[-n_emb:]
            if embbuf.shape[0] == n_emb:
                scores.append(clf.run(None, {"embeddings": embbuf[None].astype(np.float32)})[0].item())
    return np.array(scores), m.shape[0]

print("mel frames per 1760 campioni:", melspec(np.zeros(1760, np.int16)).shape)
tests = [("Axon", "nova"), ("Axon", "onyx"), ("Axon", "shimmer"), ("Ehi Axon, che ore sono?", "nova"), ("Buongiorno, come stai oggi?", "nova"), ("Il cliente Rossi ha chiamato", "onyx"), ("Assone", "nova"), ("Amazon", "onyx"), ("Sassone", "shimmer")]
for text, voice in tests:
    sc, _ = stream_scores(tts_pcm(text, voice))
    print(f"{text!r:36s} {voice:8s} max score {sc.max():.3f}  (n={len(sc)}, >0.5: {(sc > 0.5).sum()})")
