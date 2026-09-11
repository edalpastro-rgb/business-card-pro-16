"""AdvisorOS backend — entrypoint (uvicorn server:app).

V50.z161 — Refactoring del monolite (26k righe) in moduli per area funzionale
sotto `routes/` (vedi `routes/__init__.py` → MODULES). Zero breaking changes:
i moduli vengono eseguiti IN ORDINE in questo stesso namespace globale, quindi
ogni funzione/modello/costante resta visibile a tutti gli altri esattamente
come nel file unico (stesso ordine di registrazione delle route, stessi
side-effect a import time, stessi nomi `app`, `api_router`, `db`, ...).

Come lavorare sui moduli:
  • modificare/aggiungere codice nel file `routes/NN_<area>.py` pertinente;
  • nuovo modulo → creare il file e aggiungerlo a `routes/__init__.py::MODULES`
    nella posizione corretta (dopo i moduli di cui usa le definizioni,
    prima di `37_app_startup_scheduler.py` che fa `app.include_router`);
  • le tracce d'errore riportano il file del modulo reale (compile con filename).
"""
import os as _os

_ROUTES_DIR = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "routes")


def _load_modules(namespace: dict) -> None:
    from routes import MODULES
    for _name in MODULES:
        _path = _os.path.join(_ROUTES_DIR, _name)
        with open(_path, encoding="utf-8") as _fh:
            _code = compile(_fh.read(), _path, "exec")
        exec(_code, namespace)


_load_modules(globals())
