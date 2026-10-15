"""V50.z559 — Il worker pesante deve restituire JSON valido anche se qualcosa sporca lo stdout (banner di librerie nel
container VPS) e il bridge deve recuperare il JSON se preceduto da testo spurio."""
import base64
import importlib.util
import json
import os
import subprocess
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(BACKEND, "workers", "heavy_worker.py")


def _pdf_bytes() -> bytes:
    import pymupdf as fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Prova OCR")
    return doc.tobytes()


def _payload() -> bytes:
    return json.dumps({"op": "pdf_render_pages", "args": {"data": {"__b64__": base64.b64encode(_pdf_bytes()).decode()},
                                                           "max_pages": 1, "dpi": 72, "fmt": "png"}}).encode()


def _bridge():
    spec = importlib.util.spec_from_file_location("hb", os.path.join(BACKEND, "routes", "01b_heavy_bridge.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_worker_clean_stdout():
    r = subprocess.run([sys.executable, WORKER], input=_payload(), capture_output=True, timeout=120)
    assert r.returncode == 0
    res = json.loads(r.stdout.decode())
    assert res["ok"] and len(res["result"]["images"]) == 1


def test_bridge_recovers_polluted_stdout(tmp_path):
    (tmp_path / "sitecustomize.py").write_text('print("BANNER spurio")\n')
    env = dict(os.environ, PYTHONPATH=str(tmp_path))
    r = subprocess.run([sys.executable, WORKER], input=_payload(), capture_output=True, timeout=120, env=env)
    assert r.stdout.startswith(b"BANNER spurio")
    res = _bridge()._hv_parse(r.stdout, r.stderr, r.returncode, "pdf_render_pages")
    assert len(res["images"]) == 1 and res["images"][0][:4] == b"\x89PNG"


def test_bridge_error_is_diagnostic():
    hb = _bridge()
    try:
        hb._hv_parse(b"garbage only", b"libfoo: warning", 0, "pdf_render_pages")
    except hb.HeavyWorkerError as exc:
        assert "stdout[:200]" in str(exc) and "libfoo" in str(exc)
    else:
        raise AssertionError("atteso HeavyWorkerError")
