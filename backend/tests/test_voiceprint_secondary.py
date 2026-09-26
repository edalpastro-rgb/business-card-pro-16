"""Blocco 3 — voci secondarie + enforcement (VP_MIN_SPEECH_SEC=20 nel backend per il test rapido)."""
import os, time, requests

BASE = os.environ.get("API", "http://localhost:8001/api")
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "test@dalpastro.it", "password": "Test1234!"}); r.raise_for_status()
s.headers["Authorization"] = f"Bearer {r.json().get('token') or r.json().get('access_token')}"
TEXT = s.get(f"{BASE}/voiceprint/enroll/text").json()["paragraphs"]

def tts(text, voice):
    j = s.post(f"{BASE}/assistant/tts", json={"text": text, "voice": voice}).json(); return j["audio_base64"], j["mime"]

# elimina voci secondarie precedenti
for p in s.get(f"{BASE}/voiceprint/profiles").json()["items"]:
    if p["role"] == "secondary": s.delete(f"{BASE}/voiceprint/profiles/{p['profile_id']}")

st = s.post(f"{BASE}/voiceprint/enroll/start", json={"role": "secondary", "name": "Nicola (collaboratore)"}).json(); sid = st["session_id"]
for para in TEXT[:5]:
    b64, mime = tts(para, "nicola"); q = s.post(f"{BASE}/voiceprint/enroll/chunk", json={"session_id": sid, "audio_base64": b64, "mime": mime}).json()
print("secondary quality", {k: q[k] for k in ("speech_sec", "snr_db", "consistency", "ready")})
f = s.post(f"{BASE}/voiceprint/enroll/finish", json={"session_id": sid}).json(); sec = f["profile"]; print("finish", f["message"], sec["permissions"])

b64, mime = tts("Axon, che appuntamenti ho domani mattina?", "nicola")
v = s.post(f"{BASE}/voiceprint/verify", json={"audio_base64": b64, "mime": mime}).json(); print("verify nicola →", v["match"], v["profile"]["name"] if v["profile"] else None, v["score"])
b64s, mimes = tts("Axon, che appuntamenti ho domani mattina?", "sara")
v = s.post(f"{BASE}/voiceprint/verify", json={"audio_base64": b64s, "mime": mimes}).json(); print("verify sara →", v["match"], v["profile"]["name"] if v["profile"] else None, v["score"])

# transcribe con impronta: nicola riconosciuto → transcript + speaker
t0 = time.time(); t = s.post(f"{BASE}/viola-wake/transcribe", json={"audio_base64": b64, "mime": mime}).json()
print("transcribe nicola →", t.get("transcript"), "| speaker:", (t.get("speaker") or {}).get("name"), f"{round(time.time()-t0,1)}s")

# permessi: crm negato di default → denied; briefing ok → trigger; critico → denied (critical False)
pid = sec["profile_id"]
for cmd in ("che appuntamenti ho con il cliente Rossi", "briefing", "cancella tutti i contatti", "che tempo fa domani"):
    r = s.post(f"{BASE}/viola-wake/route", json={"transcript": cmd, "speaker_profile_id": pid}).json(); print(f"route [{cmd}] →", r["mode"], r.get("category"), r.get("reply") or "")
# accesso totale → crm passa, critico → guard (PIN)
s.patch(f"{BASE}/voiceprint/profiles/{pid}", json={"permissions": {k: True for k in ("briefing", "chat", "crm", "device", "critical")}})
for cmd in ("che appuntamenti ho con il cliente Rossi", "cancella tutti i contatti"):
    r = s.post(f"{BASE}/viola-wake/route", json={"transcript": cmd, "speaker_profile_id": pid}).json(); print(f"route FULL [{cmd}] →", r["mode"], r.get("category"))
# drive: denied per crm quando permesso tolto
s.patch(f"{BASE}/voiceprint/profiles/{pid}", json={"permissions": {"crm": False}})
r = s.post(f"{BASE}/voice/copilot/execute", json={"transcript": "aggiungi una nota a Rossi", "speaker_profile_id": pid, "want_audio": False}).json(); print("drive denied →", r["intent"], r["spoken"])
# pausa → nicola diventa sconosciuto → transcribe silenzioso
s.patch(f"{BASE}/voiceprint/profiles/{pid}", json={"status": "paused"})
t = s.post(f"{BASE}/viola-wake/transcribe", json={"audio_base64": b64, "mime": mime}).json(); print("transcribe nicola (paused) →", t.get("reason"), t.get("silent"), repr(t.get("transcript")))
t = s.post(f"{BASE}/ai/transcribe", json={"audio_base64": b64, "mime": mime, "verify_speaker": True}).json(); print("drive transcribe nicola (paused) →", t.get("reason"), repr(t.get("transcript")))
t = s.post(f"{BASE}/ai/transcribe", json={"audio_base64": b64s, "mime": mimes, "verify_speaker": True}).json(); print("drive transcribe sara →", repr(t.get("transcript")), (t.get("speaker") or {}).get("name"))
s.patch(f"{BASE}/voiceprint/profiles/{pid}", json={"status": "active"})
ev = s.get(f"{BASE}/viola-wake/events?limit=6").json()["items"]; print("events:", [(e["kind"], (e.get("detail") or "")[:50]) for e in ev])
