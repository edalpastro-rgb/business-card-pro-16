# 26_scanner.py — Scanner documenti
# Estratto da server.py (righe originali 18109-18648). Caricato da server.py nel
# namespace condiviso: le definizioni di TUTTI i moduli sono visibili qui (nessun import necessario).
# V27 — Document Scanner (multi-page + auto-crop + PDF merge)
# ================================================================
class ScannerPageIn(BaseModel):
    data_base64: str
    mime: str  # image/jpeg | image/png | application/pdf
    # Pagina già ritagliata dall'utente (manuale) o dall'autocrop live: salta l'autocrop server.
    already_cropped: bool = False


class ScannerMergeIn(BaseModel):
    pages: List[ScannerPageIn]
    enhance: bool = True
    autocrop: bool = True  # detect document borders + perspective correction
    grayscale: bool = False
    name: Optional[str] = None


# V50.z210 — Le funzioni OpenCV (_order_quad/_detect_document_quad/_warp_quad/_cv2_scan_document) sono in workers/heavy_ops.py
# ed eseguite in un sottoprocesso (heavy_call): cv2/numpy/PIL/fitz non vengono MAI importati nel processo API.

class ScannerPreviewIn(BaseModel):
    data_base64: str
    mime: str = "image/jpeg"
    enhance: bool = True
    grayscale: bool = False


class ScannerManualCropIn(BaseModel):
    """Ritaglio manuale: 4 angoli in coordinate NORMALIZZATE (0..1) rispetto
    all'immagine originale, ordine libero (vengono riordinati tl,tr,br,bl)."""
    data_base64: str
    corners: List[List[float]]  # [[x,y],[x,y],[x,y],[x,y]] con valori 0..1
    enhance: bool = True
    grayscale: bool = False



def _scan_b64(data_base64: str, limit_mb: int, label: str = "Immagine") -> bytes:
    try:
        raw = base64.b64decode(data_base64.split(",")[-1] if data_base64.startswith("data:") else data_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="base64 non valido")
    if len(raw) > limit_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"{label} troppo grande (max {limit_mb}MB)")
    return raw


@api_router.post("/scanner/manual-crop")
async def scanner_manual_crop(body: ScannerManualCropIn, user=Depends(get_current_user)):
    """Correzione prospettica a 4 punti scelti manualmente → JPEG ritagliato (+ enhance/grayscale). V50.z210: eseguita nel worker."""
    if not body.corners or len(body.corners) != 4:
        raise HTTPException(status_code=400, detail="Servono esattamente 4 angoli")
    raw = _scan_b64(body.data_base64, 20)
    try:
        r = await heavy_call("manual_crop", img=raw, corners=[[float(p[0]), float(p[1])] for p in body.corners], enhance=body.enhance, grayscale=body.grayscale)
    except HeavyWorkerError as e:
        if "troppo piccola" in str(e):
            raise HTTPException(status_code=400, detail="Area di ritaglio troppo piccola")
        logger.warning("manual-crop failed: %s", e)
        raise HTTPException(status_code=500, detail="Ritaglio fallito")
    return {"data_base64": base64.b64encode(r["jpeg"]).decode("ascii"), "mime": "image/jpeg", "width": r["width"], "height": r["height"]}


class ScannerCornersIn(BaseModel):
    data_base64: str
    mime: str = "image/jpeg"


@api_router.post("/scanner/detect-corners")
async def scanner_detect_corners(body: ScannerCornersIn, user=Depends(get_current_user)):
    """Live edge detection per il mirino: 4 angoli normalizzati + sharpness (varianza Laplaciano). V50.z210: nel worker."""
    raw = _scan_b64(body.data_base64, 6, "Frame")
    try:
        return await heavy_call("detect_corners", img=raw, timeout=60)
    except Exception as e:  # noqa: BLE001
        logger.warning("detect-corners failed: %s", e)
        return {"detected": False, "corners": None, "sharpness": 0.0}


@api_router.post("/scanner/autocrop-preview")
async def scanner_autocrop_preview(body: ScannerPreviewIn, user=Depends(get_current_user)):
    """Anteprima: autocrop (solo se il documento è rilevato) + enhance/grayscale → JPEG base64 + detected + sharpness. V50.z210: nel worker."""
    raw = _scan_b64(body.data_base64, 20)
    try:
        r = await heavy_call("autocrop_preview", img=raw, enhance=body.enhance, grayscale=body.grayscale)
        out, detected, sharpness = r["jpeg"], bool(r["detected"]), float(r["sharpness"])
    except Exception as e:  # noqa: BLE001
        logger.warning("autocrop-preview failed: %s", e)
        out, detected, sharpness = raw, False, 0.0
    return {"detected": detected, "data_base64": base64.b64encode(out).decode("ascii"), "mime": "image/jpeg", "sharpness": round(sharpness, 2)}


@api_router.post("/scanner/merge-pdf")
async def scanner_merge_pdf(body: ScannerMergeIn, user=Depends(get_current_user)):
    """Enhance + unione di più pagine (immagini o PDF) in un unico PDF → { pdf_base64, name, page_count }. V50.z210: nel worker."""
    if not body.pages:
        raise HTTPException(status_code=400, detail="Nessuna pagina fornita")
    if len(body.pages) > 30:
        raise HTTPException(status_code=400, detail="Max 30 pagine per scansione")
    pages = []
    for i, pg in enumerate(body.pages):
        try:
            raw = base64.b64decode(pg.data_base64.split(",")[-1] if pg.data_base64.startswith("data:") else pg.data_base64)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Pagina {i + 1}: base64 non valido")
        pages.append({"data": raw, "mime": (pg.mime or "").lower(), "already_cropped": bool(pg.already_cropped)})
    try:
        r = await heavy_call("merge_pdf", pages=pages, enhance=body.enhance, autocrop=body.autocrop, grayscale=body.grayscale, timeout=300)
    except HeavyWorkerError as e:
        msg = str(e)
        if "Pagina" in msg or "Nessuna pagina" in msg:
            raise HTTPException(status_code=400, detail=msg.split(": ", 1)[-1] if msg.startswith("ValueError") else msg)
        logger.warning("merge-pdf failed: %s", e)
        raise HTTPException(status_code=500, detail="Creazione PDF fallita")
    pdf_bytes = r["pdf"]
    safe_name = (body.name or "Scansione").strip().replace("/", "-") or "Scansione"
    if not safe_name.lower().endswith(".pdf"):
        safe_name += ".pdf"
    return {"pdf_base64": base64.b64encode(pdf_bytes).decode(), "name": safe_name, "page_count": r["page_count"]}


# =========================================================================
