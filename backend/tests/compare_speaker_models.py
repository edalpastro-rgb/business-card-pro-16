"""Confronto modelli speaker sherpa-onnx: stessa voce vs voce diversa (audio Kokoro sara/nicola + voci cloud se disponibili)."""
import os, base64, subprocess, glob, requests, numpy as np, sherpa_onnx, imageio_ffmpeg, sys

BASE = "http://localhost:8001/api"
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}); r.raise_for_status()
s.headers["Authorization"] = f"Bearer {r.json().get('token') or r.json().get('access_token')}"
TEXT = s.get(f"{BASE}/voiceprint/enroll/text").json()["paragraphs"]
FF = imageio_ffmpeg.get_ffmpeg_exe()
CACHE = "/tmp/vpcmp"; os.makedirs(CACHE, exist_ok=True)

def pcm(voice, i, text):
    p = f"{CACHE}/{voice}_{i}.npy"
    if os.path.exists(p): return np.load(p)
    j = s.post(f"{BASE}/assistant/tts", json={"text": text, "voice": voice}).json()
    raw = base64.b64decode(j["audio_base64"]); mp3 = f"{CACHE}/{voice}_{i}.mp3"; open(mp3, "wb").write(raw)
    out = subprocess.run([FF, "-nostdin", "-loglevel", "error", "-i", mp3, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    sig = np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0; np.save(p, sig); return sig

VOICES = sys.argv[1:] or ["sara", "nicola"]
clips = {v: [pcm(v, i, TEXT[i]) for i in range(6)] for v in VOICES}

def emb(ex, sig):
    st = ex.create_stream(); st.accept_waveform(16000, np.ascontiguousarray(sig, dtype=np.float32)); st.input_finished()
    e = np.asarray(ex.compute(st), dtype=np.float32); return e / (np.linalg.norm(e) + 1e-9)

for m in sorted(glob.glob("/app/backend/models/speaker/*.onnx")):
    try:
        ex = sherpa_onnx.SpeakerEmbeddingExtractor(sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=m, num_threads=1, provider="cpu"))
        E = {v: [emb(ex, c) for c in clips[v]] for v in VOICES}
        same, diff = [], []
        for v in VOICES:
            for i in range(len(E[v])):
                for j in range(i + 1, len(E[v])): same.append(float(E[v][i] @ E[v][j]))
        for a in range(len(VOICES)):
            for b in range(a + 1, len(VOICES)):
                for x in E[VOICES[a]]:
                    for y in E[VOICES[b]]: diff.append(float(x @ y))
        print(f"{os.path.basename(m):60s} same min/mean {min(same):.2f}/{np.mean(same):.2f} | diff max/mean {max(diff):.2f}/{np.mean(diff):.2f} | gap {min(same)-max(diff):+.2f} dim {ex.dim}")
    except Exception as e:
        print(os.path.basename(m), "ERR", str(e)[:100])
