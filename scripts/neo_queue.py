#!/usr/bin/env python3
"""V50.z239 — Strumento per Neo (agente di sviluppo): legge/marca la coda «Prompt per Neo» salvata da Axon in master_files.
Uso:
  python3 /app/scripts/neo_queue.py list [pending|read|done|all]     # elenco (default: pending)
  python3 /app/scripts/neo_queue.py show <file_id|#seq>              # testo completo
  python3 /app/scripts/neo_queue.py read <file_id|#seq> [nota]        # marca «letto da Neo»
  python3 /app/scripts/neo_queue.py done <file_id|#seq> [nota]        # marca «completato»
  python3 /app/scripts/neo_queue.py reject <file_id|#seq> [motivo]    # marca «non eseguibile»
"""
import os, sys
from datetime import datetime, timezone
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]
CAT = "neo_prompts"


def _find(ref: str):
    if ref.startswith("#"):
        return db.master_files.find_one({"category": CAT, "neo_seq": int(ref[1:])})
    return db.master_files.find_one({"category": CAT, "file_id": ref})


def main(argv):
    cmd = (argv[1] if len(argv) > 1 else "list").lower()
    if cmd == "list":
        st = argv[2] if len(argv) > 2 else "pending"
        q = {"category": CAT} if st == "all" else {"category": CAT, "neo_status": st}
        rows = list(db.master_files.find(q, {"_id": 0}).sort("created_at", 1))
        if not rows:
            print(f"(nessun prompt {st})"); return
        for d in rows:
            u = db.users.find_one({"user_id": d.get("created_by")}, {"email": 1}) or {}
            print(f"#{d.get('neo_seq')} [{d.get('neo_status')}] {d['file_id']} · {d['created_at']:%d/%m %H:%M} · {u.get('email','?')} · {d.get('title')}" + (f" · nota: {d['neo_note']}" if d.get("neo_note") else ""))
        return
    ref = argv[2]
    d = _find(ref)
    if not d:
        print("non trovato"); sys.exit(1)
    if cmd == "show":
        print(f"=== #{d.get('neo_seq')} {d.get('name')} [{d.get('neo_status')}] fonte={d.get('neo_source')} {d.get('neo_origin') or ''}\n")
        print(d.get("body") or ""); return
    status = {"read": "read", "done": "done", "reject": "rejected"}.get(cmd)
    if not status:
        print(__doc__); sys.exit(1)
    note = " ".join(argv[3:]).strip()
    upd = {"neo_status": status, f"neo_{status}_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}
    if note:
        upd["neo_note"] = note[:600]
    db.master_files.update_one({"file_id": d["file_id"]}, {"$set": upd})
    print(f"#{d.get('neo_seq')} → {status}" + (f" ({note})" if note else ""))


if __name__ == "__main__":
    main(sys.argv)
