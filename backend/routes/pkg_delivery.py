# V50.z424 — Canale di consegna pacchetti VPS (SOLO ambiente di sviluppo): attivo esclusivamente se AXON_PKG_DOWNLOAD_KEY è
# impostata nell'.env; in produzione (VPS) la variabile non esiste → tutte le richieste rispondono 404. Sostituisce il vecchio
# tmp_pkg_download.py rimosso su richiesta dell'utente dopo la migrazione.
import os as _pd_os
import hmac as _pd_hmac

from fastapi.responses import FileResponse as _PdFileResponse

_PD_DIR = next((d for d in (_pd_os.path.abspath(_pd_os.path.join(_pd_os.path.dirname(_pd_os.path.abspath(__file__)), "..", "deploy", "axon-core")),
                              _pd_os.path.abspath(_pd_os.path.join(_pd_os.path.dirname(_pd_os.path.abspath(__file__)), "..", "..", "deploy", "axon-core")),
                              "/app/deploy/axon-core") if _pd_os.path.isdir(d)), "/app/deploy/axon-core")  # __file__ = server.py (moduli exec'd)
_PD_FILES = {"axon-core-pkg": "axon-core-pkg.tgz", "axon-web-pkg": "axon-web-pkg.tgz", "upgrade-vps": "scripts/upgrade_vps.sh"}  # V50.z435
# V50.z473 — documenti strategici scaricabili (stessa chiave): markdown + versione HTML stampabile (→ Salva come PDF dal browser)
_PD_DOCS = {"mercato-e-beta.md": ("/app/memory/MERCATO_E_BETA.md", "text/markdown; charset=utf-8"), "mercato-e-beta.html": ("/app/memory/MERCATO_E_BETA.html", "text/html; charset=utf-8")}


@api_router.get("/pkg/{name}")  # noqa: F821
async def pkg_download(name: str, key: str = ""):
    secret = _pd_os.environ.get("AXON_PKG_DOWNLOAD_KEY") or ""
    if not secret or not key or not _pd_hmac.compare_digest(key, secret) or (name not in _PD_FILES and name not in _PD_DOCS):
        raise HTTPException(status_code=404, detail="Not found")  # noqa: F821
    if name in _PD_DOCS:
        dpath, dmime = _PD_DOCS[name]
        if not _pd_os.path.exists(dpath):
            raise HTTPException(status_code=404, detail="Documento non trovato")  # noqa: F821
        return _PdFileResponse(dpath, media_type=dmime, filename=name if name.endswith(".md") else None)
    path = _pd_os.path.join(_PD_DIR, _PD_FILES[name])
    if not _pd_os.path.exists(path):
        raise HTTPException(status_code=404, detail="Pacchetto non ancora generato")  # noqa: F821
    return _PdFileResponse(path, media_type="application/gzip", filename=_PD_FILES[name])
