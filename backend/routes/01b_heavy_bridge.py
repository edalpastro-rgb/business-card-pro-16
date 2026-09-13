# 01b_heavy_bridge.py — V50.z210 — Ponte verso il sottoprocesso `workers/heavy_worker.py` (OpenCV / PyMuPDF / pdfplumber / Pillow)
#
# PERCHÉ: cv2/numpy/fitz/pdfplumber importati «dentro le funzioni» restano caricati per sempre nel processo uvicorn e la RSS cresce fino a
# superare i 512 MB dopo ore di uptime. Ora ogni elaborazione parte in un processo figlio a vita breve che importa le librerie, fa il lavoro,
# restituisce il risultato (JSON, bytes in base64) ed esce. Il processo API non importa MAI quelle librerie.
#
#   await heavy_call("pdf_text", data=pdf_bytes, max_pages=30)        → dict (asincrono, non blocca l'event loop)
#   heavy_call_sync("pdf_page_count", data=pdf_bytes)                 → dict (per il codice sync eseguito nei thread)
# Bytes negli argomenti e nel risultato viaggiano come {"__b64__": …} (gestito qui e nel worker). Errori → HeavyWorkerError.

import asyncio as _hv_asyncio
import base64 as _hv_b64
import json as _hv_json
import subprocess as _hv_subprocess
import sys as _hv_sys
from pathlib import Path as _HvPath

_HV_WORKER = str(_HvPath(__file__).resolve().parent.parent / "workers" / "heavy_worker.py") if "routes" in str(_HvPath(__file__).resolve()) \
    else str(_HvPath(__file__).resolve().parent / "workers" / "heavy_worker.py")
if not _HvPath(_HV_WORKER).exists():   # __file__ è server.py quando i moduli vengono exec()-uiti dal loader
    _HV_WORKER = str(_HvPath("/app/backend/workers/heavy_worker.py"))
_HV_TIMEOUT = 180
_HV_MAX_PARALLEL = 2
_hv_sem = _hv_asyncio.Semaphore(_HV_MAX_PARALLEL)


class HeavyWorkerError(RuntimeError):
    pass


def _hv_enc(v):
    if isinstance(v, (bytes, bytearray)):
        return {"__b64__": _hv_b64.b64encode(bytes(v)).decode("ascii")}
    if isinstance(v, dict):
        return {k: _hv_enc(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_hv_enc(x) for x in v]
    return v


def _hv_dec(v):
    if isinstance(v, dict):
        if "__b64__" in v and len(v) == 1:
            return _hv_b64.b64decode(v["__b64__"])
        return {k: _hv_dec(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_hv_dec(x) for x in v]
    return v


def _hv_parse(out: bytes, err: bytes, rc: int, op: str) -> dict:
    if not out:
        raise HeavyWorkerError(f"worker {op} senza output (rc={rc}): {(err or b'')[-400:].decode('utf-8', 'ignore')}")
    try:
        res = _hv_json.loads(out.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HeavyWorkerError(f"worker {op} output non valido: {exc}")
    if not res.get("ok"):
        raise HeavyWorkerError(res.get("error") or f"worker {op} fallito")
    return _hv_dec(res.get("result") or {})


async def heavy_call(op: str, timeout: float = _HV_TIMEOUT, **args) -> dict:
    payload = _hv_json.dumps({"op": op, "args": _hv_enc(args)}).encode("utf-8")
    async with _hv_sem:
        proc = await _hv_asyncio.create_subprocess_exec(_hv_sys.executable, _HV_WORKER, stdin=_hv_asyncio.subprocess.PIPE,
                                                        stdout=_hv_asyncio.subprocess.PIPE, stderr=_hv_asyncio.subprocess.PIPE)
        try:
            out, err = await _hv_asyncio.wait_for(proc.communicate(payload), timeout=timeout)
        except _hv_asyncio.TimeoutError:
            proc.kill()
            raise HeavyWorkerError(f"worker {op}: timeout dopo {timeout:.0f}s")
    return _hv_parse(out, err, proc.returncode or 0, op)


def heavy_call_sync(op: str, timeout: float = _HV_TIMEOUT, **args) -> dict:
    payload = _hv_json.dumps({"op": op, "args": _hv_enc(args)}).encode("utf-8")
    try:
        p = _hv_subprocess.run([_hv_sys.executable, _HV_WORKER], input=payload, capture_output=True, timeout=timeout)
    except _hv_subprocess.TimeoutExpired:
        raise HeavyWorkerError(f"worker {op}: timeout dopo {timeout:.0f}s")
    return _hv_parse(p.stdout, p.stderr, p.returncode, op)
