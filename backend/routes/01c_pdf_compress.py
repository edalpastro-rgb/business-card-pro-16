# 01c_pdf_compress.py — V50.z345 — COMPRESSIONE AUTOMATICA dei PDF dopo ogni upload/creazione (archivi DB più leggeri).
# Motore interno PyMuPDF (workers/heavy_ops.compress_pdf, in sottoprocesso): solo le immagini vengono ricampionate e
# ricompresse; testo, OCR, campi modulo e vettori restano identici. Mai peggiora: se non c'è guadagno resta l'originale.
# Usato da: master-files (JSON + multipart), file contatto, bollette (singola/bulk), Knowledge Base, Axon Lab archivio.

PDF_COMPRESS_MIN_BYTES = 300 * 1024  # sotto 300 KB non vale la pena


def _is_pdf_payload(mime: str, name: str, raw: bytes) -> bool:
    return ((mime or "").lower() == "application/pdf" or (name or "").lower().endswith(".pdf")) and raw[:5] == b"%PDF-"


async def pdf_auto_compress(raw: bytes, mime: str = "application/pdf", name: str = "", label: str = "") -> Tuple[bytes, Dict[str, Any]]:
    """Ritorna (bytes_finali, info). info = {before, after, ratio, compressed: bool}."""
    if not raw or len(raw) < PDF_COMPRESS_MIN_BYTES or not _is_pdf_payload(mime, name, raw):
        return raw, {"before": len(raw or b""), "after": len(raw or b""), "ratio": 1.0, "compressed": False}
    try:
        r = await heavy_call("compress_pdf", pdf=raw, timeout=180)
        out = r.get("pdf") or raw
        info = {"before": r.get("before", len(raw)), "after": len(out), "ratio": r.get("ratio", 1.0), "compressed": len(out) < len(raw)}
        if info["compressed"]:
            logger.info("[pdf-compress] %s %s: %d KB → %d KB (%.0f%%)", label, name[:40], info["before"] // 1024, info["after"] // 1024, info["ratio"] * 100)
        return out, info
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pdf-compress] fallita (%s): %s", name, exc)
        return raw, {"before": len(raw), "after": len(raw), "ratio": 1.0, "compressed": False}


async def pdf_auto_compress_b64(b64: str, mime: str = "application/pdf", name: str = "", label: str = "") -> Tuple[str, Dict[str, Any]]:
    """Variante per payload base64 (con o senza prefisso data:)."""
    if not b64:
        return b64, {"before": 0, "after": 0, "ratio": 1.0, "compressed": False}
    pure = b64.split(",", 1)[1] if b64.startswith("data:") else b64
    try:
        raw = base64.b64decode(pure)
    except Exception:
        return b64, {"before": 0, "after": 0, "ratio": 1.0, "compressed": False}
    out, info = await pdf_auto_compress(raw, mime, name, label)
    if not info["compressed"]:
        return b64, info
    return base64.b64encode(out).decode("ascii"), info
