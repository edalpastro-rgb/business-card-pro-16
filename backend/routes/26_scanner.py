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


def _order_quad(pts):
    """Ordina 4 punti in tl, tr, br, bl."""
    import numpy as np
    pts = np.asarray(pts, dtype="float32").reshape(4, 2)
    s = pts.sum(axis=1); diff = np.diff(pts, axis=1).ravel()
    tl = pts[np.argmin(s)]; br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]; bl = pts[np.argmax(diff)]
    return np.array([tl, tr, br, bl], dtype="float32")


def _detect_document_quad(src):
    """V50.z134 — Rilevamento robusto del quadrilatero-documento.

    Ritorna i 4 angoli (tl,tr,br,bl) in coordinate dell'immagine originale, o
    None se nessun documento plausibile. Rispetto alla versione precedente
    (singolo Canny + solo contorni esterni + approx 2%):
    - bordo di padding → contorni chiusi anche se il foglio tocca il bordo foto
    - più mappe di bordi (Canny auto-soglia, Canny fisso, Otsu, adaptive,
      canale saturazione) + chiusura morfologica
    - RETR_LIST + convex hull + più epsilon di approssimazione
    - punteggio = area × rettangolarità, angoli 60°–120°
    - fallback minAreaRect sul contorno più grande (≥ 30% frame)
    """
    import cv2
    import numpy as np

    h0, w0 = src.shape[:2]
    ratio = 900.0 / max(h0, w0)
    small = cv2.resize(src, None, fx=ratio, fy=ratio, interpolation=cv2.INTER_AREA) if ratio < 1 else src.copy()
    ratio = ratio if ratio < 1 else 1.0
    PAD = 12
    small = cv2.copyMakeBorder(small, PAD, PAD, PAD, PAD, cv2.BORDER_CONSTANT, value=(0, 0, 0))
    sh, sw = small.shape[:2]
    frame_area = float(sh * sw)

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    sat = cv2.GaussianBlur(hsv[:, :, 1], (5, 5), 0)
    med = float(np.median(blur))
    lo, hi = int(max(0, 0.66 * med)), int(min(255, 1.33 * med))
    kernel = np.ones((5, 5), np.uint8)

    edge_maps = []
    e1 = cv2.Canny(blur, lo, hi); edge_maps.append(cv2.morphologyEx(cv2.dilate(e1, np.ones((3, 3), np.uint8)), cv2.MORPH_CLOSE, kernel))
    e2 = cv2.Canny(blur, 30, 100); edge_maps.append(cv2.morphologyEx(cv2.dilate(e2, np.ones((3, 3), np.uint8)), cv2.MORPH_CLOSE, kernel))
    e3 = cv2.Canny(blur, 60, 180); edge_maps.append(cv2.dilate(e3, np.ones((3, 3), np.uint8)))
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU); edge_maps.append(cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, kernel))
    adap = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 51, -5); edge_maps.append(cv2.morphologyEx(adap, cv2.MORPH_OPEN, kernel))
    e5 = cv2.Canny(sat, 20, 80); edge_maps.append(cv2.morphologyEx(cv2.dilate(e5, np.ones((3, 3), np.uint8)), cv2.MORPH_CLOSE, kernel))
    # Foglio chiaro: il "bianco" del documento come regione (utile su fondo chiaro)
    bright = cv2.inRange(blur, int(min(250, max(140, med + 15))), 255); edge_maps.append(cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)))
    # V50.z162 — Normalizzazione locale del contrasto (CLAHE): recupera i bordi del
    # foglio in scene con ombre marcate / luce radente / fondo poco contrastato.
    try:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(blur)
        e6 = cv2.Canny(clahe, 40, 120); edge_maps.append(cv2.morphologyEx(cv2.dilate(e6, np.ones((3, 3), np.uint8)), cv2.MORPH_CLOSE, kernel))
        _, otsu2 = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU); edge_maps.append(cv2.morphologyEx(otsu2, cv2.MORPH_CLOSE, kernel))
    except Exception:
        pass

    def _angles_ok(q):
        ok = True
        for i in range(4):
            a = q[i - 1] - q[i]; b = q[(i + 1) % 4] - q[i]
            cosang = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-6))
            ang = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
            if ang < 60 or ang > 120:
                ok = False; break
        return ok

    frame_corners = np.array([[PAD, PAD], [sw - PAD, PAD], [sw - PAD, sh - PAD], [PAD, sh - PAD]], dtype="float32")

    def _is_whole_frame(q):
        # Il bordo di padding crea un contorno = intera foto: NON è un documento.
        return all(np.linalg.norm(q[i] - frame_corners[i]) < 2.5 * PAD for i in range(4))

    def _side_contrasts(q):
        """Contrasto (0-255) tra dentro e fuori lungo ciascun lato: un vero bordo
        documento separa carta e sfondo. None = lato sul bordo foto (ignoto).
        Evita di ritagliare il blocco di testo dentro a un foglio che riempie la foto."""
        cx, cy = q.mean(axis=0)
        out = []
        for i in range(4):
            p1, p2 = q[i], q[(i + 1) % 4]
            mid = (p1 + p2) / 2.0
            n = np.array([cx, cy]) - mid
            nn = np.linalg.norm(n)
            if nn < 1e-3:
                out.append(None); continue
            n = n / nn * 7.0
            diffs = []
            for t in np.linspace(0.08, 0.92, 22):
                p = p1 + (p2 - p1) * t
                pi = p + n; po = p - n
                xi, yi, xo, yo = int(pi[0]), int(pi[1]), int(po[0]), int(po[1])
                if not (PAD <= xi < sw - PAD and PAD <= yi < sh - PAD and PAD <= xo < sw - PAD and PAD <= yo < sh - PAD):
                    continue
                diffs.append(abs(float(blur[yi, xi]) - float(blur[yo, xo])))
            out.append(float(np.median(diffs)) if len(diffs) >= 5 else None)
        return out

    inner_mask = np.zeros((sh, sw), np.uint8)
    inner_mask[PAD:sh - PAD, PAD:sw - PAD] = 255

    def _outside_is_paper(q):
        """True se la zona FUORI dal quadrilatero è almeno altrettanto chiara di
        quella dentro (≥ 200): allora è ancora foglio (es. blocco di testo o
        tabella dentro a un documento che riempie la foto) → niente ritaglio."""
        poly = np.zeros((sh, sw), np.uint8)
        cv2.fillPoly(poly, [np.int32(q)], 255)
        outside = (inner_mask > 0) & (poly == 0)
        inside = poly > 0
        if outside.sum() < 500 or inside.sum() < 500:
            return False
        mo = float(blur[outside].mean()); mi = float(blur[inside].mean())
        # Fuori = margine di carta bianca (più chiaro del contenuto con testo dentro).
        # Una scrivania, anche chiara, è più scura del foglio → non scatta.
        return mo > 200 and mo >= mi + 12

    best = None; best_score = 0.0
    fallback = None; fallback_area = 0.0
    for em in edge_maps:
        contours, _ = cv2.findContours(em, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]
        for c in contours:
            area = cv2.contourArea(c)
            frac = area / frame_area
            if frac < 0.15:
                break
            if frac > 0.985:
                continue
            hull = cv2.convexHull(c)
            peri = cv2.arcLength(hull, True)
            quad = None
            for eps in (0.02, 0.03, 0.04, 0.05, 0.07):
                approx = cv2.approxPolyDP(hull, eps * peri, True)
                if len(approx) == 4:
                    quad = approx.reshape(4, 2).astype("float32"); break
            if quad is None:
                if frac > fallback_area and frac >= 0.30:
                    fallback, fallback_area = hull, frac
                continue
            q = _order_quad(quad)
            if _is_whole_frame(q) or not _angles_ok(q):
                continue
            rect_area = cv2.contourArea(cv2.boxPoints(cv2.minAreaRect(quad)))
            rectangularity = cv2.contourArea(quad) / max(rect_area, 1.0)
            if rectangularity < 0.75:
                continue
            known = [c for c in _side_contrasts(q) if c is not None]
            if known and sum(1 for c in known if c >= 10) < min(2, len(known)):
                continue  # lati senza contrasto: non è il bordo di un documento
            if _outside_is_paper(q):
                continue  # fuori dal quadrilatero c'è ancora carta: il foglio riempie la foto
            contrast = float(np.mean(known)) if known else 0.0
            score = frac * rectangularity * (0.4 + 0.6 * min(1.0, contrast / 40.0))
            if score > best_score:
                best, best_score = q, score
    if best is None and fallback is not None:
        box = _order_quad(cv2.boxPoints(cv2.minAreaRect(fallback)))
        known = [c for c in _side_contrasts(box) if c is not None]
        if not _is_whole_frame(box) and (not known or sum(1 for c in known if c >= 10) >= min(2, len(known))):
            best = box
    if best is None:
        return None
    # Rimuovi padding, torna a coordinate full-res e clampa
    best = (best - PAD) / ratio
    best[:, 0] = np.clip(best[:, 0], 0, w0 - 1)
    best[:, 1] = np.clip(best[:, 1], 0, h0 - 1)
    wA = np.linalg.norm(best[2] - best[3]); wB = np.linalg.norm(best[1] - best[0])
    hA = np.linalg.norm(best[1] - best[2]); hB = np.linalg.norm(best[0] - best[3])
    # V50.z162 — soglia minima proporzionale al frame (i frame live sono 400px)
    min_side = max(60.0, 0.18 * min(w0, h0))
    if max(wA, wB) < min_side or max(hA, hB) < min_side:
        return None
    return best


def _warp_quad(src, quad):
    """Correzione prospettica a 4 punti (tl,tr,br,bl in coord. full-res)."""
    import cv2
    import numpy as np
    rect = np.asarray(quad, dtype="float32")
    tl, tr, br, bl = rect
    wA = np.linalg.norm(br - bl); wB = np.linalg.norm(tr - tl)
    hA = np.linalg.norm(tr - br); hB = np.linalg.norm(tl - bl)
    maxW = int(max(wA, wB)); maxH = int(max(hA, hB))
    dst = np.array([[0, 0], [maxW - 1, 0], [maxW - 1, maxH - 1], [0, maxH - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(src, M, (maxW, maxH))


def _cv2_scan_document(img_bytes: bytes, enhance: bool, autocrop: bool, grayscale: bool) -> bytes:
    """CamScanner-like pipeline on a single image using OpenCV.
    - EXIF-aware auto-orientation (via PIL)
    - Document edge detection + 4-point perspective warp (autocrop) — V50.z134 `_detect_document_quad`
    - Adaptive contrast + sharpen (enhance)
    - Optional grayscale
    Returns JPEG bytes.
    """
    import cv2  # local import so absent cv2 doesn't crash the app on boot
    import numpy as np
    from PIL import Image, ImageOps

    # Auto-orient via PIL, then convert to CV2 BGR
    pil = Image.open(io.BytesIO(img_bytes))
    pil = ImageOps.exif_transpose(pil).convert("RGB")
    src = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

    warped = src
    if autocrop:
        try:
            quad = _detect_document_quad(src)
            if quad is not None:
                warped = _warp_quad(src, quad)
        except Exception as _e:
            logger.warning("scanner autocrop failed: %s", _e)

    if enhance:
        try:
            # Contrast Limited Adaptive Histogram Equalization on luminance
            lab = cv2.cvtColor(warped, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
            l = clahe.apply(l)
            warped = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
            # Unsharp mask for crisper text
            blur = cv2.GaussianBlur(warped, (0, 0), sigmaX=1.5)
            warped = cv2.addWeighted(warped, 1.5, blur, -0.5, 0)
        except Exception as _e:
            logger.warning("scanner enhance failed: %s", _e)

    if grayscale:
        try:
            g = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
            warped = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
        except Exception:
            pass

    # Encode JPEG
    ok, buf = cv2.imencode(".jpg", warped, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise HTTPException(status_code=500, detail="Impossibile codificare l'immagine")
    return buf.tobytes()


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


@api_router.post("/scanner/manual-crop")
async def scanner_manual_crop(body: ScannerManualCropIn, user=Depends(get_current_user)):
    """Applica una correzione prospettica a 4 punti scelti manualmente dall'utente
    (dopo lo scatto) e restituisce il JPEG ritagliato (+ enhance/grayscale opzionali)."""
    if not body.corners or len(body.corners) != 4:
        raise HTTPException(status_code=400, detail="Servono esattamente 4 angoli")
    try:
        raw = base64.b64decode(
            body.data_base64.split(",")[-1] if body.data_base64.startswith("data:") else body.data_base64
        )
    except Exception:
        raise HTTPException(status_code=400, detail="base64 non valido")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Immagine troppo grande (max 20MB)")
    try:
        import cv2  # type: ignore
        import numpy as np
        from PIL import Image, ImageOps

        pil = Image.open(io.BytesIO(raw))
        pil = ImageOps.exif_transpose(pil).convert("RGB")
        src = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        h, w = src.shape[:2]
        pts = np.array(
            [[min(max(float(p[0]), 0.0), 1.0) * (w - 1), min(max(float(p[1]), 0.0), 1.0) * (h - 1)] for p in body.corners],
            dtype="float32",
        )
        # Ordina: tl (somma min), br (somma max), tr (diff min), bl (diff max)
        s = pts.sum(axis=1)
        d = np.diff(pts, axis=1).reshape(-1)
        tl, br = pts[np.argmin(s)], pts[np.argmax(s)]
        tr, bl = pts[np.argmin(d)], pts[np.argmax(d)]
        rect = np.array([tl, tr, br, bl], dtype="float32")
        maxW = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
        maxH = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
        if maxW < 20 or maxH < 20:
            raise HTTPException(status_code=400, detail="Area di ritaglio troppo piccola")
        dst = np.array([[0, 0], [maxW - 1, 0], [maxW - 1, maxH - 1], [0, maxH - 1]], dtype="float32")
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(src, M, (maxW, maxH))
        ok, buf = cv2.imencode(".jpg", warped, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        if not ok:
            raise HTTPException(status_code=500, detail="Encoding fallito")
        out = buf.tobytes()
        if body.enhance or body.grayscale:
            try:
                out = _cv2_scan_document(out, enhance=body.enhance, autocrop=False, grayscale=body.grayscale)
            except Exception:
                pass
        return {"data_base64": base64.b64encode(out).decode("ascii"), "mime": "image/jpeg", "width": maxW, "height": maxH}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("manual-crop failed: %s", e)
        raise HTTPException(status_code=500, detail="Ritaglio fallito")


class ScannerCornersIn(BaseModel):
    data_base64: str
    mime: str = "image/jpeg"


@api_router.post("/scanner/detect-corners")
async def scanner_detect_corners(body: ScannerCornersIn, user=Depends(get_current_user)):
    """
    Bug 11.b — Live edge detection for the in-app viewfinder.
    Accetta una frame di preview (bassa qualità) e ritorna le 4 coordinate
    (normalized 0..1) del quadrilatero documento se rilevato, altrimenti
    detected=false. Molto veloce: downscale interno a 400px + Canny + approxPolyDP.
    """
    try:
        raw = base64.b64decode(
            body.data_base64.split(",")[-1] if body.data_base64.startswith("data:") else body.data_base64
        )
    except Exception:
        raise HTTPException(status_code=400, detail="base64 non valido")
    # Cap on input size for latency
    if len(raw) > 6 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Frame troppo grande")

    try:
        import cv2  # type: ignore
        import numpy as np
        from PIL import Image, ImageOps

        pil = Image.open(io.BytesIO(raw))
        pil = ImageOps.exif_transpose(pil).convert("RGB")
        arr = np.array(pil)
        h0, w0 = arr.shape[:2]
        # Downscale to max 400px for speed
        target = 400.0
        ratio = target / max(h0, w0) if max(h0, w0) > target else 1.0
        small = cv2.resize(arr, None, fx=ratio, fy=ratio) if ratio < 1 else arr.copy()
        gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)

        # Bug 11.d — Sharpness score = variance of Laplacian (rilevamento
        # motion blur / defocus). Valori tipici: <60 = molto sfocato,
        # 60-120 = borderline, >120 = nitido. Calcolato SULLA GRAYSCALE PRIMA
        # del blur/Canny per non dipendere dal filtro.
        try:
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        except Exception:
            sharpness = 0.0

        # V50.z162 — Stesso detector robusto dell'autocrop (_detect_document_quad:
        # multi-mappa Canny/Otsu/adaptive/CLAHE, hull, contrasto lati). Prima il
        # live usava un singolo Canny + RETR_EXTERNAL → overlay quasi mai agganciato
        # e auto-scatto che non partiva, mentre il ritaglio finale usava un altro
        # algoritmo (incoerenza percepita come "l'edge detection non isola il foglio").
        detected_corners = None
        try:
            quad = _detect_document_quad(cv2.cvtColor(small, cv2.COLOR_RGB2BGR))
        except Exception:
            quad = None
        if quad is not None:
            sh, sw = small.shape[:2]
            detected_corners = [[float(x) / sw, float(y) / sh] for x, y in quad]

        if detected_corners:
            return {"detected": True, "corners": detected_corners, "sharpness": round(sharpness, 2)}
        return {"detected": False, "corners": None, "sharpness": round(sharpness, 2)}
    except Exception as e:
        logger.warning("detect-corners failed: %s", e)
        return {"detected": False, "corners": None, "sharpness": 0.0}


@api_router.post("/scanner/autocrop-preview")
async def scanner_autocrop_preview(body: ScannerPreviewIn, user=Depends(get_current_user)):
    """
    Bug 11 — Live scanner preview.
    Riceve UNA immagine (base64), applica autocrop (+ enhance opzionale, + grayscale
    opzionale) usando la stessa pipeline OpenCV di `_cv2_scan_document`, e
    restituisce la versione ritagliata come base64 JPEG.

    Se il rilevamento del rettangolo documento fallisce, la funzione ritorna
    l'immagine originale (o solo enhanced) con `detected=false`, così il client
    può decidere se mostrare o meno la thumbnail ritagliata.
    """
    try:
        raw = base64.b64decode(
            body.data_base64.split(",")[-1] if body.data_base64.startswith("data:") else body.data_base64
        )
    except Exception:
        raise HTTPException(status_code=400, detail="base64 non valido")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Immagine troppo grande (max 20MB)")

    # First pass: try with autocrop=True to see if a quadrilateral was detected.
    # We reuse `_cv2_scan_document` and detect success by comparing shape sizes.
    detected = False
    sharpness = 0.0
    try:
        import cv2  # type: ignore
        import numpy as np
        from PIL import Image, ImageOps

        pil = Image.open(io.BytesIO(raw))
        pil = ImageOps.exif_transpose(pil).convert("RGB")
        src = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        h0, w0 = src.shape[:2]

        # Bug 11.d — Sharpness score on the FULL-res grayscale for a robust
        # motion-blur detection right after the user shot.
        try:
            gray_full = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY)
            sharpness = float(cv2.Laplacian(gray_full, cv2.CV_64F).var())
        except Exception:
            sharpness = 0.0

        # V50.z134 — stesso detector robusto di _cv2_scan_document
        detected = _detect_document_quad(src) is not None
    except Exception as _e:
        logger.warning("autocrop-preview detection failed: %s", _e)
        detected = False

    # Now produce the processed JPEG bytes (autocrop only when actually detected).
    try:
        out = _cv2_scan_document(raw, enhance=body.enhance, autocrop=detected, grayscale=body.grayscale)
    except Exception as e:
        logger.warning("autocrop-preview processing failed: %s", e)
        out = raw

    b64 = base64.b64encode(out).decode("ascii")
    return {
        "detected": detected,
        "data_base64": b64,
        "mime": "image/jpeg",
        "sharpness": round(sharpness, 2),
    }


@api_router.post("/scanner/merge-pdf")
async def scanner_merge_pdf(body: ScannerMergeIn, user=Depends(get_current_user)):
    """Enhance + merge multiple pages (images or PDFs) into a single PDF.
    Returns { pdf_base64, name, page_count }.
    """
    if not body.pages:
        raise HTTPException(status_code=400, detail="Nessuna pagina fornita")
    if len(body.pages) > 30:
        raise HTTPException(status_code=400, detail="Max 30 pagine per scansione")

    from PIL import Image
    import fitz  # PyMuPDF

    processed_images: List[Image.Image] = []
    for i, pg in enumerate(body.pages):
        try:
            raw = base64.b64decode(pg.data_base64.split(",")[-1] if pg.data_base64.startswith("data:") else pg.data_base64)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Pagina {i + 1}: base64 non valido")
        mime = (pg.mime or "").lower()
        if mime == "application/pdf":
            # Rasterize each PDF page as an image at 200 DPI
            try:
                doc = fitz.open(stream=raw, filetype="pdf")
                for pn in range(doc.page_count):
                    page = doc.load_page(pn)
                    pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                    processed_images.append(img)
                doc.close()
            except Exception as e:
                logger.warning("PDF rasterize fail: %s", e)
                raise HTTPException(status_code=400, detail=f"Pagina {i + 1}: PDF non valido")
        else:
            try:
                out = _cv2_scan_document(raw, enhance=body.enhance, autocrop=(body.autocrop and not pg.already_cropped), grayscale=body.grayscale)
                processed_images.append(Image.open(io.BytesIO(out)).convert("RGB"))
            except HTTPException:
                raise
            except Exception as e:
                logger.warning("scan image fail: %s", e)
                # Fall back to raw image without processing
                try:
                    processed_images.append(Image.open(io.BytesIO(raw)).convert("RGB"))
                except Exception:
                    raise HTTPException(status_code=400, detail=f"Pagina {i + 1}: immagine non valida")

    if not processed_images:
        raise HTTPException(status_code=400, detail="Nessuna pagina elaborabile")

    # Merge into PDF using PIL
    buf = io.BytesIO()
    first, rest = processed_images[0], processed_images[1:]
    first.save(buf, format="PDF", save_all=True, append_images=rest, resolution=150.0)
    pdf_bytes = buf.getvalue()

    safe_name = (body.name or "Scansione").strip() or "Scansione"
    if not safe_name.lower().endswith(".pdf"):
        safe_name += ".pdf"
    return {
        "pdf_base64": base64.b64encode(pdf_bytes).decode(),
        "name": safe_name,
        "page_count": len(processed_images),
    }



# =========================================================================
