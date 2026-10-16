"""seed_drive_probe.py — V50.z565 — dati Drive SINTETICI per verificare in locale «snapshot leggeri» (metadati → ChromaDB → testo dei soli
file scelti). Uso: python tests/perf/seed_drive_probe.py [--clean]. Tenant: test@dalpastro.it."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from core import drive_retrieval, embedding  # noqa: E402

FILES = [
    ("f_power", "01_POWER.pdf", "CORPORATE CLUB", "Potenza impegnata 6 kW, potenza disponibile 6,6 kW. Contatore trifase. Fornitura luce uso domestico residente. " * 30),
    ("f_listino", "Listino_CORPORATE_CLUB_2026.pdf", "CORPORATE CLUB", "CORPORATE CLUB listino 2026: quota annuale 1.200 euro, servizi inclusi consulenza energia gas luce telefonia, sconto 10% per i soci fondatori. " * 30),
    ("f_gas", "Contratto_gas_Rossi.pdf", "CORPORATE CLUB/Clienti", "Contratto fornitura gas naturale cliente Mario Rossi PDR 0123456789 consumo annuo 1.100 smc tariffa fissa 0,45 euro/smc. " * 30),
    ("f_empty", "Scansione_senza_testo.pdf", "CORPORATE CLUB", ""),
]


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    u = await db.users.find_one({"email": "test@dalpastro.it"}, {"user_id": 1})
    tenant = u["user_id"]
    if "--clean" in sys.argv:
        await db.drive_snapshots.delete_many({"user_id": tenant, "file_id": {"$in": [f[0] for f in FILES]}})
        await db.google_drive_folders.delete_many({"user_id": tenant, "folder_id": "probe_root"})
        for f in FILES:
            drive_retrieval.delete_file(tenant, f[0])
        print("pulito"); return
    await db.google_drive_folders.update_one({"user_id": tenant, "folder_id": "probe_root"}, {"$set": {"folder_name": "CORPORATE CLUB"}}, upsert=True)
    emb = embedding.LocalEmbedder(embedding.default_model_dir())
    drive_retrieval.configure(emb.embed)
    for fid, name, folder, text in FILES:
        await db.drive_snapshots.update_one({"user_id": tenant, "file_id": fid}, {"$set": {"name": name, "folder_path": folder, "modified_time": "2026-09-01T10:00:00Z", "mime": "application/pdf", "text": text}}, upsert=True)
        if text:
            drive_retrieval.upsert_file(tenant, fid, name, folder, text, "2026-09-01")
    print("tenant", tenant, "snapshots", await db.drive_snapshots.count_documents({"user_id": tenant}), "chunk chroma", drive_retrieval.count(tenant))


asyncio.run(main())
