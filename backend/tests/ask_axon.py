"""Domande libere ad Axon (stream) per verificare la conoscenza delle nuove funzioni. Uso: python tests/ask_axon.py "domanda" [email password]"""
import json
import os
import sys

import requests

BASE = os.environ.get("BASE_URL", "http://localhost:8001/api")


def ask(q: str, email="test@dalpastro.it", pwd="Test1234!") -> str:
    tok = requests.post(f"{BASE}/auth/login", json={"email": email, "password": pwd}, timeout=30).json()["token"]
    text = ""
    with requests.post(f"{BASE}/assistant/chat/stream", json={"message": q, "session_id": "kb-check", "no_cache": True, **({"client_context": {"route": "/home", "voice": True}} if os.environ.get("VOICE") else {})}, headers={"Authorization": f"Bearer {tok}"}, stream=True, timeout=120) as r:
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            try:
                d = json.loads(line[5:].strip())
            except Exception:
                continue
            if "text" in d and "stage" not in d:
                text += d["text"]
    return text


if __name__ == "__main__":
    args = sys.argv[1:]
    print(ask(args[0], *(args[1:3] if len(args) >= 3 else [])))
