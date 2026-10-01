# V50.z424 — Canale di consegna pacchetti VPS (SOLO ambiente di sviluppo): attivo esclusivamente se AXON_PKG_DOWNLOAD_KEY è
# impostata nell'.env; in produzione (VPS) la variabile non esiste → tutte le richieste rispondono 404. Sostituisce il vecchio
# tmp_pkg_download.py rimosso su richiesta dell'utente dopo la migrazione.
import os as _pd_os
import hmac as _pd_hmac

from fastapi.responses import FileResponse as _PdFileResponse

_PD_DIR = next((d for d in (_pd_os.path.abspath(_pd_os.path.join(_pd_os.path.dirname(_pd_os.path.abspath(__file__)), "..", "deploy", "axon-core")),
                              _pd_os.path.abspath(_pd_os.path.join(_pd_os.path.dirname(_pd_os.path.abspath(__file__)), "..", "..", "deploy", "axon-core")),
                              "/app/deploy/axon-core") if _pd_os.path.isdir(d)), "/app/deploy/axon-core")  # __file__ = server.py (moduli exec'd)
_PD_FILES = {"axon-core-pkg": "axon-core-pkg.tgz", "axon-web-pkg": "axon-web-pkg.tgz"}


@api_router.get("/pkg/{name}")  # noqa: F821
async def pkg_download(name: str, key: str = ""):
    secret = _pd_os.environ.get("AXON_PKG_DOWNLOAD_KEY") or ""
    if not secret or not key or not _pd_hmac.compare_digest(key, secret) or name not in _PD_FILES:
        raise HTTPException(status_code=404, detail="Not found")  # noqa: F821
    path = _pd_os.path.join(_PD_DIR, _PD_FILES[name])
    if not _pd_os.path.exists(path):
        raise HTTPException(status_code=404, detail="Pacchetto non ancora generato")  # noqa: F821
    return _PdFileResponse(path, media_type="application/gzip", filename=_PD_FILES[name])
