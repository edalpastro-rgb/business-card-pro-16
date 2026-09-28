# tmp_pkg_download.py — V50.z399 — ENDPOINT TEMPORANEO: serve il pacchetto Axon Core (deploy/axon-core/axon-core-pkg.tgz) per lo
# scaricamento diretto dal VPS via wget. Protetto da chiave fissa (?key=). DA RIMUOVERE (togliere da MODULES) dopo la migrazione.
import os as _tpd_os

from fastapi import HTTPException
from fastapi.responses import FileResponse

TPD_PATH = "/app/deploy/axon-core/axon-core-pkg.tgz"
TPD_KEY = "AUg0w8i-GDCWSl7coTK0vFoN"


@api_router.get("/download/axon-core-pkg")  # noqa: F821
async def tpd_download(key: str = ""):
    if key != TPD_KEY:
        raise HTTPException(status_code=403, detail="Chiave non valida")
    if not _tpd_os.path.exists(TPD_PATH):
        raise HTTPException(status_code=404, detail="Pacchetto non trovato: esegui deploy/axon-core/scripts/build_package.sh")
    return FileResponse(TPD_PATH, media_type="application/gzip", filename="axon-core-pkg.tgz")
