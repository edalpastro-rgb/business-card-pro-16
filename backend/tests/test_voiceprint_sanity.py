"""Sanity test impronta vocale (V50.z372): genera parlato con Kokoro (2 voci) → enroll «sara» → verify sara vs nicola.
Uso: VP_MIN_SPEECH_SEC=20 nel backend per il test rapido (default 120). python tests/test_voiceprint_sanity.py"""
import base64, os, sys, time, requests

BASE = os.environ.get("API", "http://localhost:8001/api")
EMAIL, PW = "test@dalpastro.it", "Test1234!"

s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW}); r.raise_for_status()
tok = r.json().get("token") or r.json().get("access_token")
s.headers["Authorization"] = f"Bearer {tok}"

TEXT = requests.get(f"{BASE}/voiceprint/enroll/text", headers=s.headers).json()["paragraphs"]

def tts(text, voice):
    r = s.post(f"{BASE}/assistant/tts", json={"text": text, "voice": voice}); r.raise_for_status()
    j = r.json(); return j["audio_base64"], j["mime"]

t0 = time.time(); s.post(f"{BASE}/voiceprint/engine/warmup").raise_for_status(); print("warmup", round(time.time() - t0, 1), "s")
# pulizia profili precedenti
for p in s.get(f"{BASE}/voiceprint/profiles").json()["items"]:
    s.delete(f"{BASE}/voiceprint/profiles/{p['profile_id']}")

st = s.post(f"{BASE}/voiceprint/enroll/start", json={"role": "owner"}).json(); sid = st["session_id"]; print("session", sid)
for i, para in enumerate(TEXT[:6]):
    b64, mime = tts(para, "sara")
    t0 = time.time(); q = s.post(f"{BASE}/voiceprint/enroll/chunk", json={"session_id": sid, "audio_base64": b64, "mime": mime}).json()
    print(f"chunk {i}: speech {q['speech_sec']}s snr {q['snr_db']} cons {q['consistency']} ready {q['ready']} hint={q.get('hint')} ({round(time.time()-t0,1)}s)")
f = s.post(f"{BASE}/voiceprint/enroll/finish", json={"session_id": sid}); print("finish", f.status_code, f.json().get("message") or f.json())
if f.status_code != 200:
    sys.exit(1)

for voice, txt in (("sara", TEXT[8]), ("sara", "Axon, che appuntamenti ho domani mattina?"), ("nicola", TEXT[8]), ("nicola", "Axon, che appuntamenti ho domani mattina?")):
    b64, mime = tts(txt, voice)
    v = s.post(f"{BASE}/voiceprint/verify", json={"audio_base64": b64, "mime": mime}).json()
    print(f"verify {voice:7s} match={v['match']} score={v['score']} thr={v.get('threshold')} speech={v.get('speech_sec')}")

print("status", s.get(f"{BASE}/voiceprint/status").json())
