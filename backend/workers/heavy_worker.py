"""workers/heavy_worker.py — V50.z210 — Sottoprocesso a vita breve per le operazioni pesanti.

Protocollo (stdin → stdout, JSON): {"op": "...", "args": {...}} dove i bytes sono codificati come {"__b64__": "..."}
(anche dentro liste/dict). Risposta: {"ok": true, "result": {...}} oppure {"ok": false, "error": "..."}.
Il processo importa cv2/fitz/pdfplumber/PIL, esegue UNA operazione, scrive il risultato ed esce: la memoria torna al sistema.
"""
import base64
import json
import os
import sys
import traceback


def _decode(v):
    if isinstance(v, dict):
        if "__b64__" in v and len(v) == 1:
            return base64.b64decode(v["__b64__"])
        return {k: _decode(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_decode(x) for x in v]
    return v


def _encode(v):
    if isinstance(v, (bytes, bytearray)):
        return {"__b64__": base64.b64encode(bytes(v)).decode("ascii")}
    if isinstance(v, dict):
        return {k: _encode(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_encode(x) for x in v]
    return v


def main() -> int:
    # V50.z559 — PROTOCOLLO BLINDATO: qualunque cosa venga stampata su stdout durante import/elaborazione (banner di librerie
    # native, warning di MuPDF/Leptonica/OpenCV, print di debug) finisce su STDERR; il JSON di risposta viene scritto sul
    # descrittore stdout ORIGINALE. Prima, nel container VPS, una riga spuria in testa allo stdout rompeva il parse
    # («worker pdf_render_pages output non valido: Expecting value: line 1 column 1») e l'OCR dei PDF Drive falliva sempre.
    real_stdout_fd = os.dup(1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    try:
        req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        from heavy_ops import OPS  # import qui: è il sottoprocesso a pagare il costo
        fn = OPS.get(req.get("op") or "")
        if not fn:
            raise ValueError(f"op sconosciuta: {req.get('op')}")
        result = fn(**_decode(req.get("args") or {}))
        out = {"ok": True, "result": _encode(result)}
    except Exception as exc:  # noqa: BLE001
        out = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()[-2000:]}
    sys.stderr.flush()
    payload = json.dumps(out).encode("utf-8")
    view = memoryview(payload)
    while view:
        n = os.write(real_stdout_fd, view)
        view = view[n:]
    os.close(real_stdout_fd)
    return 0


if __name__ == "__main__":
    sys.exit(main())
