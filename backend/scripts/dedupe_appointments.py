#!/usr/bin/env python3
"""dedupe_appointments.py — V50.z506 — Elimina gli appuntamenti DUPLICATI ESATTI (stesso tenant, stesso contatto, stessa data/ora,
stesso titolo normalizzato), tenendo il più vecchio. Di default è una PROVA (--dry-run implicito): mostra cosa farebbe.
Uso sul VPS (dentro il container o con MONGO_URL/DB_NAME nell'ambiente):
    python3 scripts/dedupe_appointments.py            # solo elenco
    python3 scripts/dedupe_appointments.py --apply    # elimina davvero
Opzionale: --contact "zanini" per limitare a un nome contenuto nel titolo."""
import argparse, os, sys
from collections import defaultdict
from pymongo import MongoClient

ap = argparse.ArgumentParser()
ap.add_argument("--apply", action="store_true", help="elimina davvero (altrimenti solo anteprima)")
ap.add_argument("--contact", default="", help="filtra per testo contenuto nel titolo (es. zanini)")
args = ap.parse_args()

url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
name = os.environ.get("DB_NAME") or "test_database"
db = MongoClient(url)[name]
q = {}
if args.contact:
    q["title"] = {"$regex": args.contact, "$options": "i"}
groups = defaultdict(list)
for a in db.appointments.find(q, {"appointment_id": 1, "user_id": 1, "contact_id": 1, "start_at": 1, "title": 1, "created_at": 1, "done": 1}).sort("created_at", 1):
    key = (a.get("user_id"), a.get("contact_id") or (a.get("title") or "").strip().lower(), a.get("start_at"), (a.get("title") or "").strip().lower())
    groups[key].append(a)
dups = {k: v for k, v in groups.items() if len(v) > 1}
if not dups:
    print("Nessun duplicato trovato."); sys.exit(0)
to_delete = []
for k, v in dups.items():
    keep, extra = v[0], v[1:]
    print(f"\n• «{keep.get('title')}» {keep.get('start_at')} — tengo {keep['appointment_id']} (creato {keep.get('created_at')})")
    for e in extra:
        print(f"    elimino {e['appointment_id']} (creato {e.get('created_at')}, fatto={e.get('done')})")
        to_delete.append(e["appointment_id"])
if args.apply:
    r = db.appointments.delete_many({"appointment_id": {"$in": to_delete}})
    print(f"\nEliminati {r.deleted_count} duplicati.")
else:
    print(f"\nANTEPRIMA: {len(to_delete)} duplicati da eliminare. Rilancia con --apply per procedere.")
