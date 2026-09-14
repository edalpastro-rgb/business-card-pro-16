# workers/heavy_ops.py — V50.z210 — Libreria PURA delle operazioni pesanti (OpenCV, PyMuPDF, pdfplumber, Pillow, pypdfium2).
# Importata SOLO dal sottoprocesso `heavy_worker.py`: il processo API (uvicorn) non carica mai queste librerie, così la RSS resta piatta.
import base64
import io
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, ImageOps

logger = logging.getLogger("heavy_ops")


# ============================================================================ SCANNER (OpenCV) — spostato da routes/26_scanner.py
def _order_quad(pts):
    """Ordina 4 punti in tl, tr, br, bl."""
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

    V50.z176 — "documento principale" tra oggetti sul tavolo: ogni candidato è
    valutato per somiglianza a un documento (interno uniforme senza testo, lati su
    bordi reali, gradino di luminanza dentro/fuori, rettangolarità, aspetto ≤ 3:1)
    e solo poi per dimensione; candidati extra dalla segmentazione "carta" con
    separazione dei fogli che si toccano (erosione). Stateless: ogni chiamata
    riparte da zero (nessuna memoria tra scatti).
    """

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

    # ------------------------------------------------------------------
    # V50.z176 — Selezione "documento principale" robusta agli oggetti sul tavolo.
    # Ogni candidato (quadrilatero) riceve un punteggio di "somiglianza a un
    # documento" indipendente dall'area:
    #   fill       = uniformità dell'interno (carta: pixel vicini alla mediana, bassa saturazione)
    #   edge_sup   = quota del perimetro appoggiata su bordi reali dell'immagine
    #   rect       = rettangolarità (area / area del min-rect)
    #   contrast   = contrasto dentro/fuori sui lati
    # e solo DOPO viene premiato il più grande. Così l'inviluppo "foglio+telefono"
    # (interno non uniforme, lati inventati) o il quasi-intero-frame (tavolo con
    # oggetti) perdono contro il foglio vero. In più, candidati dalla segmentazione
    # "carta" (chiaro + poco saturo) per scene con tavoli colorati/scuri.
    # ------------------------------------------------------------------
    # Scala dei kernel: 1.0 a 900px (autocrop), ~0.45 sui frame live a 400px
    S_ = max(0.4, min(1.0, max(sh, sw) / 924.0))

    def _ks(v, odd=True):
        k = max(3, int(round(v * S_)))
        return k + 1 if odd and k % 2 == 0 else k

    gx = cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3)
    gmag = cv2.magnitude(gx, gy)
    gmax = cv2.dilate(gmag, np.ones((5, 5), np.uint8))  # max locale: tolleranza ±2px sul bordo
    sat_small = hsv[:, :, 1]

    def _edge_support(q):
        """Media (0..1) della quota di campioni su bordo reale per lato; lati sul
        bordo foto → ignorati (None). Ritorna (support, n_lati_su_bordo_foto)."""
        sups = []; on_frame = 0
        for i in range(4):
            p1, p2 = q[i], q[(i + 1) % 4]
            hit = tot = 0; framed = 0
            for t in np.linspace(0.05, 0.95, 36):
                p = p1 + (p2 - p1) * t
                x, y = int(round(p[0])), int(round(p[1]))
                if not (0 <= x < sw and 0 <= y < sh):
                    continue
                if x < PAD + 4 or y < PAD + 4 or x >= sw - PAD - 4 or y >= sh - PAD - 4:
                    framed += 1; continue
                tot += 1
                if gmax[y, x] >= 22.0:
                    hit += 1
            if framed >= 18:
                on_frame += 1; sups.append(None)
            elif tot >= 8:
                sups.append(hit / tot)
            else:
                sups.append(None)
        known = [v for v in sups if v is not None]
        return (float(np.mean(known)) if known else 0.5), on_frame

    # Sfondo "senza testo": sfocatura larga → il testo sparisce, restano carta/tavolo/oggetti
    # Chiusura morfologica (max→min, 17px @900px): cancella i tratti scuri sottili (testo, righe di
    # tabella) e conserva le zone scure estese (tavolo, telefono, oggetti).
    _k_txt = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (_ks(17), _ks(17)))
    bg_l = cv2.morphologyEx(blur, cv2.MORPH_CLOSE, _k_txt).astype(np.float32)
    bg_s = cv2.morphologyEx(sat_small, cv2.MORPH_OPEN, _k_txt)  # loghi/colori piccoli via, oggetti colorati restano

    def _fill_ratio(q):
        """Quota dell'interno (esclusa una cornice di 13px) il cui SFONDO è uniforme:
        luminanza entro ±22% della mediana interna e saturazione bassa. Il testo è
        rimosso dalla sfocatura larga, le ombre graduali passano; tavolo/oggetti
        inclusi in un inviluppo troppo largo fanno crollare il valore."""
        poly = np.zeros((sh, sw), np.uint8)
        cv2.fillPoly(poly, [np.int32(q)], 255)
        er = cv2.erode(poly, np.ones((_ks(27), _ks(27)), np.uint8))
        idx = er > 0
        n = int(idx.sum())
        if n < 400:
            return 0.0
        vals = bg_l[idx]
        p90 = float(np.percentile(vals, 90))
        # "carta" = non molto più scuro del bianco-carta (testo denso/ombre tollerati) e poco saturo
        ok = (vals >= 0.62 * p90) & (bg_s[idx] < 110)
        return float(ok.mean())

    def _ring_is_paper(q):
        """Robusto alle ombre: misura il GRADINO di luminanza dello sfondo senza testo
        (bg_l) attraverso ogni lato (±12px). Se lungo i lati noti lo sfondo è continuo
        (gradino mediano < 10), il candidato è una tabella/blocco dentro a un foglio
        più grande (o comunque non il bordo di un documento) → scarta."""
        cx, cy = q.mean(axis=0)
        steps = []
        for i in range(4):
            p1, p2 = q[i], q[(i + 1) % 4]
            mid = (p1 + p2) / 2.0
            n = np.array([cx, cy]) - mid
            nn = np.linalg.norm(n)
            if nn < 1e-3:
                continue
            n = n / nn * max(5.0, 12.0 * S_)
            side = []
            for t in np.linspace(0.1, 0.9, 17):
                p = p1 + (p2 - p1) * t
                pi = p + n; po = p - n
                xi, yi, xo, yo = int(pi[0]), int(pi[1]), int(po[0]), int(po[1])
                if not (PAD <= xi < sw - PAD and PAD <= yi < sh - PAD and PAD <= xo < sw - PAD and PAD <= yo < sh - PAD):
                    continue
                side.append(abs(float(bg_l[yi, xi]) - float(bg_l[yo, xo])))
            if len(side) >= 6:
                steps.append(float(np.median(side)))
        if not steps:
            return False
        # Servono almeno 2 lati (o tutti quelli noti) con un vero gradino (≥ 14):
        # altrimenti dentro e fuori è lo stesso materiale.
        real = sum(1 for v in steps if v >= 14.0)
        return real < min(2, len(steps))

    def _score_candidate(q):
        if _is_whole_frame(q) or not _angles_ok(q):
            return None
        area_q = cv2.contourArea(np.float32(q))
        frac_q = area_q / frame_area
        if frac_q < 0.12 or frac_q > 0.93:
            return None
        (_, (rw, rh), _) = cv2.minAreaRect(np.float32(q))
        rect_area = float(rw * rh)
        rectangularity = area_q / max(rect_area, 1.0)
        if rectangularity < 0.80:
            return None
        if min(rw, rh) < 1 or max(rw, rh) / max(1.0, min(rw, rh)) > 3.0:
            return None  # strisce: non è un documento
        sup, on_frame = _edge_support(q)
        if on_frame >= 3:
            return None  # praticamente l'intero frame
        if sup < 0.45:
            return None  # lati non appoggiati a bordi reali (inviluppo inventato)
        known = [c for c in _side_contrasts(q) if c is not None]
        if known and sum(1 for c in known if c >= 10) < min(2, len(known)):
            return None
        if _outside_is_paper(q) or _ring_is_paper(q):
            return None
        fill = _fill_ratio(q)
        if fill < 0.62:
            return None
        contrast = float(np.mean(known)) if known else 20.0
        quality = fill * (0.35 + 0.65 * sup) * rectangularity * (0.5 + 0.5 * min(1.0, contrast / 40.0))
        # Premio dimensione solo a parità di qualità (saturato oltre il 40% del frame)
        return quality * (0.55 + 0.45 * min(1.0, frac_q / 0.40))

    def _quads_from_contour(c):
        hull = cv2.convexHull(c)
        peri = cv2.arcLength(hull, True)
        out = []
        for eps in (0.015, 0.02, 0.03, 0.04, 0.05, 0.07, 0.09):
            approx = cv2.approxPolyDP(hull, eps * peri, True)
            if len(approx) == 4:
                out.append(_order_quad(approx.reshape(4, 2).astype("float32")))
                break
        # Sempre anche il min-rect: robusto quando un oggetto tocca il foglio (l'hull
        # diventa un pentagono ma il rettangolo minimo resta ~ il foglio).
        out.append(_order_quad(cv2.boxPoints(cv2.minAreaRect(hull))))
        return out

    candidates = []
    for em in edge_maps:
        contours, _ = cv2.findContours(em, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]
        for c in contours:
            frac = cv2.contourArea(c) / frame_area
            if frac < 0.10:
                break
            if frac > 0.985:
                continue
            candidates.extend(_quads_from_contour(c))
    # Segmentazione "carta": regioni chiare e poco sature (foglio su tavolo colorato/scuro)
    try:
        paper = ((blur > max(110, min(200, med + 10))) & (sat_small < 80)).astype(np.uint8) * 255
        paper = cv2.morphologyEx(paper, cv2.MORPH_OPEN, np.ones((_ks(7), _ks(7)), np.uint8))
        paper = cv2.morphologyEx(paper, cv2.MORPH_CLOSE, np.ones((_ks(15), _ks(15)), np.uint8))
        pc, _ = cv2.findContours(paper, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in sorted(pc, key=cv2.contourArea, reverse=True)[:4]:
            if cv2.contourArea(c) / frame_area >= 0.10:
                candidates.extend(_quads_from_contour(c))
        # Fogli che si toccano (es. la pagina già scansionata appoggiata accanto alla
        # successiva): erosione forte → le regioni si separano → ogni componente viene
        # ri-dilatata singolarmente e proposta come candidato.
        for er_px in (_ks(11), _ks(21)):
            k_er = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (er_px, er_px))
            eroded = cv2.erode(paper, k_er)
            n_lbl, lbl = cv2.connectedComponents(eroded)
            if n_lbl <= 1 or n_lbl > 12:
                continue
            for li in range(1, n_lbl):
                comp = (lbl == li).astype(np.uint8) * 255
                if comp.sum() / 255.0 / frame_area < 0.08:
                    continue
                comp = cv2.dilate(comp, k_er)
                cc, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                for c in cc:
                    if cv2.contourArea(c) / frame_area >= 0.10:
                        candidates.extend(_quads_from_contour(c))
    except Exception:
        pass

    best = None; best_score = 0.0
    seen = []
    for q in candidates:
        # dedup (stesso quadrilatero da mappe diverse)
        if any(np.abs(q - s_).max() < 4.0 for s_ in seen):
            continue
        seen.append(q)
        sc = _score_candidate(q)
        if sc is not None and sc > best_score:
            best, best_score = q, sc
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
        raise RuntimeError("Impossibile codificare l'immagine")
    return buf.tobytes()



def _load_bgr(img_bytes: bytes):
    pil = ImageOps.exif_transpose(Image.open(io.BytesIO(img_bytes))).convert("RGB")
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def scan_document(img: bytes, enhance: bool = True, autocrop: bool = True, grayscale: bool = False) -> Dict[str, Any]:
    return {"jpeg": _cv2_scan_document(img, enhance, autocrop, grayscale)}


def manual_crop(img: bytes, corners: List[List[float]], enhance: bool = True, grayscale: bool = False) -> Dict[str, Any]:
    src = _load_bgr(img)
    h, w = src.shape[:2]
    pts = np.array([[min(max(float(p[0]), 0.0), 1.0) * (w - 1), min(max(float(p[1]), 0.0), 1.0) * (h - 1)] for p in corners], dtype="float32")
    s = pts.sum(axis=1); d = np.diff(pts, axis=1).reshape(-1)
    tl, br = pts[np.argmin(s)], pts[np.argmax(s)]; tr, bl = pts[np.argmin(d)], pts[np.argmax(d)]
    rect = np.array([tl, tr, br, bl], dtype="float32")
    maxW = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl))); maxH = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    if maxW < 20 or maxH < 20:
        raise ValueError("Area di ritaglio troppo piccola")
    dst = np.array([[0, 0], [maxW - 1, 0], [maxW - 1, maxH - 1], [0, maxH - 1]], dtype="float32")
    warped = cv2.warpPerspective(src, cv2.getPerspectiveTransform(rect, dst), (maxW, maxH))
    ok, buf = cv2.imencode(".jpg", warped, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not ok:
        raise RuntimeError("Encoding fallito")
    out = buf.tobytes()
    if enhance or grayscale:
        try:
            out = _cv2_scan_document(out, enhance=enhance, autocrop=False, grayscale=grayscale)
        except Exception:  # noqa: BLE001
            pass
    return {"jpeg": out, "width": maxW, "height": maxH}


def detect_corners(img: bytes) -> Dict[str, Any]:
    pil = ImageOps.exif_transpose(Image.open(io.BytesIO(img))).convert("RGB")
    arr = np.array(pil); h0, w0 = arr.shape[:2]
    ratio = 400.0 / max(h0, w0) if max(h0, w0) > 400.0 else 1.0
    small = cv2.resize(arr, None, fx=ratio, fy=ratio) if ratio < 1 else arr.copy()
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    try:
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:  # noqa: BLE001
        sharpness = 0.0
    try:
        quad = _detect_document_quad(cv2.cvtColor(small, cv2.COLOR_RGB2BGR))
    except Exception:  # noqa: BLE001
        quad = None
    if quad is not None:
        sh, sw = small.shape[:2]
        return {"detected": True, "corners": [[float(x) / sw, float(y) / sh] for x, y in quad], "sharpness": round(sharpness, 2)}
    return {"detected": False, "corners": None, "sharpness": round(sharpness, 2)}


def autocrop_preview(img: bytes, enhance: bool = True, grayscale: bool = False) -> Dict[str, Any]:
    detected = False; sharpness = 0.0
    try:
        src = _load_bgr(img)
        try:
            sharpness = float(cv2.Laplacian(cv2.cvtColor(src, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
        except Exception:  # noqa: BLE001
            sharpness = 0.0
        detected = _detect_document_quad(src) is not None
    except Exception as exc:  # noqa: BLE001
        logger.warning("autocrop-preview detection failed: %s", exc)
    try:
        out = _cv2_scan_document(img, enhance=enhance, autocrop=detected, grayscale=grayscale)
    except Exception as exc:  # noqa: BLE001
        logger.warning("autocrop-preview processing failed: %s", exc)
        out = img
    return {"detected": detected, "jpeg": out, "sharpness": round(sharpness, 2)}


# ============================================================================ OCR LOCALE (Tesseract via tesserocr, dizionari in backend/tessdata)
_TESSDATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tessdata")
_OCR_MAX_SIDE = 1800  # px: buon compromesso precisione/velocità (~0,5-1,5 s per pagina)


def _ocr_prepare(img: Image.Image) -> Image.Image:
    g = ImageOps.exif_transpose(img).convert("L")
    w, h = g.size
    if max(w, h) > _OCR_MAX_SIDE:
        r = _OCR_MAX_SIDE / float(max(w, h))
        g = g.resize((max(1, int(w * r)), max(1, int(h * r))), Image.LANCZOS)
    return g


def ocr_images(images: List[Image.Image], lang: str = "ita+eng", detect_orientation: bool = True) -> Dict[str, Any]:
    """V50.z246 — OCR locale con Tesseract (nessun servizio esterno). Ritorna testo per pagina, confidenza media e le rotazioni
    applicate (gradi) per raddrizzare pagine acquisite al contrario: se la confidenza a 0° è bassa si prova a 180° e si tiene
    il risultato migliore (niente OSD: il modello osd «fast» abortisce il processo nativo). Se tesserocr manca → available=False."""
    try:
        import tesserocr as _t
    except Exception as exc:  # noqa: BLE001
        logger.warning("tesserocr non disponibile: %s", exc)
        return {"available": False, "texts": [""] * len(images), "confs": [], "rotations": [0] * len(images)}
    texts: List[str] = []; confs: List[float] = []; rotations: List[int] = []
    with _t.PyTessBaseAPI(path=_TESSDATA, lang=lang, psm=_t.PSM.AUTO) as api:
        def _run(im: Image.Image) -> Tuple[str, float]:
            api.SetImage(im)
            try:
                return (api.GetUTF8Text() or "").strip(), float(api.MeanTextConf() or 0.0)
            except Exception:  # noqa: BLE001
                return "", 0.0
        for img in images:
            g = _ocr_prepare(img)
            txt, conf = _run(g); rot = 0
            if detect_orientation and (conf < 60.0 or len(txt) < 20):
                txt2, conf2 = _run(g.rotate(180, expand=True))
                if conf2 > conf + 8.0 and len(txt2) >= len(txt) * 0.8:
                    txt, conf, rot = txt2, conf2, 180
            texts.append(txt); confs.append(conf); rotations.append(rot)
    return {"available": True, "texts": texts, "confs": confs, "rotations": rotations}


def merge_pdf(pages: List[Dict[str, Any]], enhance: bool = True, autocrop: bool = True, grayscale: bool = False, ocr: bool = True) -> Dict[str, Any]:
    """pages: [{data: bytes, mime, already_cropped}] → {pdf, page_count, ocr_text, ocr_conf}. Errori per pagina → ValueError('Pagina N: …').
    V50.z246: OCR Tesseract locale su ogni pagina (testo ricercabile + hash per i duplicati) e auto-raddrizzamento (OSD)."""
    import pymupdf as fitz  # PyMuPDF (il vecchio alias `fitz` stampa un warning su stdout e corromperebbe il protocollo JSON)
    images: List[Image.Image] = []
    for i, pg in enumerate(pages):
        raw = pg["data"]; mime = (pg.get("mime") or "").lower()
        if mime == "application/pdf":
            try:
                doc = fitz.open(stream=raw, filetype="pdf")
                for pn in range(doc.page_count):
                    pix = doc.load_page(pn).get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                    images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
                doc.close()
            except Exception as exc:  # noqa: BLE001
                raise ValueError(f"Pagina {i + 1}: PDF non valido ({exc})")
        else:
            try:
                out = _cv2_scan_document(raw, enhance=enhance, autocrop=(autocrop and not pg.get("already_cropped")), grayscale=grayscale)
                images.append(Image.open(io.BytesIO(out)).convert("RGB"))
            except Exception as exc:  # noqa: BLE001
                logger.warning("scan image fail: %s", exc)
                try:
                    images.append(Image.open(io.BytesIO(raw)).convert("RGB"))
                except Exception:
                    raise ValueError(f"Pagina {i + 1}: immagine non valida")
    if not images:
        raise ValueError("Nessuna pagina elaborabile")
    ocr_text = ""; ocr_conf = None
    if ocr:
        try:
            o = ocr_images(images)
            if o.get("available"):
                for i, rot in enumerate(o["rotations"]):
                    if rot:
                        images[i] = images[i].rotate(rot, expand=True)
                ocr_text = "\f".join(o["texts"]).strip()
                good = [c for c in o["confs"] if c > 0]
                ocr_conf = round(sum(good) / len(good), 1) if good else None
        except Exception as exc:  # noqa: BLE001
            logger.warning("ocr failed: %s", exc)
    buf = io.BytesIO()
    images[0].save(buf, format="PDF", save_all=True, append_images=images[1:], resolution=150.0)
    return {"pdf": buf.getvalue(), "page_count": len(images), "ocr_text": ocr_text, "ocr_conf": ocr_conf}


# ============================================================================ PDF (PyMuPDF / pdfplumber / pypdfium2)
def pdf_text(data: bytes, max_pages: int = 30, max_chars: int = 8000) -> Dict[str, Any]:
    """Testo delle pagine (PyMuPDF). max_pages=0 → tutte; il taglio a max_chars avviene sulla pagina che supera il limite."""
    import pymupdf as fitz
    parts: List[str] = []; n = 0
    with fitz.open(stream=data, filetype="pdf") as pdf:
        n = pdf.page_count
        stop = min(n, max_pages) if max_pages else n
        for page in pdf.pages(stop=stop):
            t = (page.get_text("text") or "").strip()
            if t:
                parts.append(t)
            if max_chars and sum(len(x) for x in parts) > max_chars:
                break
    txt = "\n\n".join(parts)
    return {"text": txt[:max_chars] if max_chars else txt, "page_count": n}


def pdf_page_count(data: bytes) -> Dict[str, Any]:
    import pymupdf as fitz
    with fitz.open(stream=data, filetype="pdf") as pdf:
        return {"page_count": pdf.page_count}


def pdf_render_pages(data: bytes, max_pages: int = 3, scale: float = 2.0, dpi: Optional[int] = None, fmt: str = "jpeg", quality: int = 80) -> Dict[str, Any]:
    """Rasterizza le prime max_pages pagine → lista di immagini (bytes) per OCR Vision."""
    import pymupdf as fitz
    out: List[bytes] = []
    with fitz.open(stream=data, filetype="pdf") as pdf:
        for page in pdf.pages(stop=min(pdf.page_count, max_pages)):
            pix = page.get_pixmap(dpi=dpi) if dpi else page.get_pixmap(matrix=fitz.Matrix(scale, scale))
            if fmt == "png":
                out.append(pix.tobytes("png"))
            else:
                im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                b = io.BytesIO(); im.save(b, format="JPEG", quality=quality); out.append(b.getvalue())
    return {"images": out}


def pdf_tables_text(data: bytes, max_pages: int = 8, mode: str = "markdown", max_tables: int = 0) -> Dict[str, Any]:
    """pdfplumber: testo + tabelle. mode=markdown → «[TABELLA pag.N]» + righe «| a | b |»; mode=tsv → righe tab-separate."""
    import pdfplumber
    parts: List[str] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for pg_i, page in enumerate(pdf.pages[:max_pages]):
            try:
                t = page.extract_text() or ""
                if t.strip():
                    parts.append(t.strip())
            except Exception:  # noqa: BLE001
                pass
            try:
                tables = page.extract_tables() or []
                if max_tables:
                    tables = tables[:max_tables]
                for table in tables:
                    if not table:
                        continue
                    if mode == "tsv":
                        for row in table:
                            parts.append("\t".join((c or "").strip() for c in row))
                        continue
                    rows = [[(c or "").strip() for c in row] for row in table if any(c for c in row)]
                    if not rows or len(rows[0]) < 2:
                        continue
                    md = f"\n[TABELLA pag.{pg_i + 1}]"
                    for row in rows[:30]:
                        md += "\n| " + " | ".join(row) + " |"
                    parts.append(md)
            except Exception:  # noqa: BLE001
                pass
    return {"text": "\n\n".join(parts) if mode == "markdown" else "\n".join(parts)}


def pdf_cover(data: bytes) -> Dict[str, Any]:
    """Immagine «più significativa» del PDF → JPEG 1600x900 16:9 (routes/25 event banners)."""
    import pymupdf as fitz
    best: Optional[bytes] = None; best_area = 0
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        for page_index in range(min(len(doc), 8)):
            for img in doc[page_index].get_images(full=True):
                try:
                    pix = fitz.Pixmap(doc, img[0])
                    if pix.width < 200 or pix.height < 200:
                        continue
                    area = pix.width * pix.height
                    if area > best_area:
                        if pix.n >= 5:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        best = pix.tobytes("png"); best_area = area
                except Exception:  # noqa: BLE001
                    continue
        if best is None and len(doc) > 0:
            pix = doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            best = pix.tobytes("png")
    finally:
        doc.close()
    if not best:
        return {"jpeg": None}
    im = Image.open(io.BytesIO(best)).convert("RGB")
    w, h = im.size; target = 16 / 9; cur = w / h
    if cur > target:
        nw = int(h * target); x0 = (w - nw) // 2; im = im.crop((x0, 0, x0 + nw, h))
    elif cur < target:
        nh = int(w / target); y0 = (h - nh) // 2; im = im.crop((0, y0, w, y0 + nh))
    im = im.resize((1600, 900), Image.LANCZOS)
    out = io.BytesIO(); im.save(out, "JPEG", quality=85, optimize=True)
    return {"jpeg": out.getvalue()}


OPS = {
    "scan_document": scan_document, "manual_crop": manual_crop, "detect_corners": detect_corners, "autocrop_preview": autocrop_preview, "merge_pdf": merge_pdf,
    "ocr_images": lambda images, **kw: ocr_images([Image.open(io.BytesIO(b)).convert("RGB") for b in images], **kw),
    "pdf_text": pdf_text, "pdf_page_count": pdf_page_count, "pdf_render_pages": pdf_render_pages, "pdf_tables_text": pdf_tables_text, "pdf_cover": pdf_cover,
}
