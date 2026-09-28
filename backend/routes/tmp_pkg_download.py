# tmp_pkg_download.py — V50.z399 — ENDPOINT TEMPORANEO: serve il pacchetto Axon Core (deploy/axon-core/axon-core-pkg.tgz) per lo
# scaricamento diretto dal VPS via wget. Protetto da chiave fissa (?key=). DA RIMUOVERE (togliere da MODULES) dopo la migrazione.
import os as _tpd_os

from fastapi import HTTPException
from fastapi.responses import FileResponse

TPD_PATH = "/app/deploy/axon-core/axon-core-pkg.tgz"
TPD_KEY = "o6pnNc0Kyh1mn8P2R9Pz0K-8"


@api_router.get("/download/axon-core-pkg")  # noqa: F821
async def tpd_download(key: str = ""):
    if key != TPD_KEY:
        raise HTTPException(status_code=403, detail="Chiave non valida")
    if not _tpd_os.path.exists(TPD_PATH):
        raise HTTPException(status_code=404, detail="Pacchetto non trovato: esegui deploy/axon-core/scripts/build_package.sh")
    return FileResponse(TPD_PATH, media_type="application/gzip", filename="axon-core-pkg.tgz",
                        headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "Expires": "0"})


@api_router.get("/download/axon-core-pkg/info")  # noqa: F821
async def tpd_info(key: str = ""):
    """Verifica: sha256 + dimensione + data del pacchetto attualmente servito."""
    if key != TPD_KEY:
        raise HTTPException(status_code=403, detail="Chiave non valida")
    if not _tpd_os.path.exists(TPD_PATH):
        raise HTTPException(status_code=404, detail="Pacchetto non trovato")
    import hashlib, datetime
    h = hashlib.sha256()
    with open(TPD_PATH, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    st = _tpd_os.stat(TPD_PATH)
    return {"sha256": h.hexdigest(), "size": st.st_size, "modified_utc": datetime.datetime.utcfromtimestamp(st.st_mtime).isoformat() + "Z"}
