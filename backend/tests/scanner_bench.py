"""Harness: scene sintetiche 'documento su tavolo con oggetti attorno' → misura IoU del detector.
Uso: python3 tests/scanner_bench.py [nome_funzione]  (default: _detect_document_quad dal namespace server)
"""
import os, sys, io, math, random
sys.path.insert(0, "/app/backend"); os.chdir("/app/backend")
import numpy as np, cv2

def make_scene(seed, W=1200, H=1600):
    rng = random.Random(seed)
    # tavolo: legno/colore vario con texture rumorosa + gradiente luce
    base = np.array([rng.randint(60, 190) for _ in range(3)], np.float32)
    img = np.ones((H, W, 3), np.float32) * base
    noise = rng.uniform(4, 18)
    img += np.random.RandomState(seed).normal(0, noise, (H, W, 3))
    yy, xx = np.mgrid[0:H, 0:W]
    grad = (0.75 + 0.5 * (xx / W) * rng.uniform(-1, 1) + 0.4 * (yy / H) * rng.uniform(-1, 1))
    img *= grad[..., None]
    # venature legno
    if rng.random() < 0.6:
        for _ in range(40):
            y = rng.randint(0, H); cv2.line(img, (0, y), (W, y + rng.randint(-30, 30)), tuple(float(c) for c in base * rng.uniform(0.8, 1.15)), rng.randint(1, 4))
    img = np.clip(img, 0, 255).astype(np.uint8)

    # documento: A4 con prospettiva/rotazione, 45-75% del frame
    scale = rng.uniform(0.45, 0.72)
    dw = W * scale; dh = dw * math.sqrt(2)
    if dh > H * 0.85: dh = H * 0.85; dw = dh / math.sqrt(2)
    cx, cy = W / 2 + rng.uniform(-0.08, 0.08) * W, H / 2 + rng.uniform(-0.08, 0.08) * H
    ang = math.radians(rng.uniform(-12, 12))
    pts = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x = sx * dw / 2; y = sy * dh / 2
        # prospettiva leggera
        x *= 1 + 0.08 * sy * rng.uniform(-1, 1); 
        xr = x * math.cos(ang) - y * math.sin(ang); yr = x * math.sin(ang) + y * math.cos(ang)
        pts.append([cx + xr + rng.uniform(-8, 8), cy + yr + rng.uniform(-8, 8)])
    quad = np.array(pts, np.float32)
    paper_col = rng.randint(215, 250)
    cv2.fillPoly(img, [np.int32(quad)], (paper_col, paper_col, paper_col))
    # testo/tabelle sul foglio
    M = cv2.getPerspectiveTransform(np.array([[0, 0], [600, 0], [600, 848], [0, 848]], np.float32), quad)
    sheet = np.full((848, 600, 3), paper_col, np.uint8)
    for i in range(rng.randint(15, 30)):
        y = 60 + i * 26
        if y > 800: break
        cv2.rectangle(sheet, (40, y), (40 + rng.randint(200, 520), y + 10), (rng.randint(20, 80),) * 3, -1)
    if rng.random() < 0.6:  # tabella con bordi
        cv2.rectangle(sheet, (40, 300), (560, 600), (30, 30, 30), 2)
        for k in range(1, 5): cv2.line(sheet, (40, 300 + k * 60), (560, 300 + k * 60), (30, 30, 30), 1)
    if rng.random() < 0.5:  # logo colorato
        cv2.rectangle(sheet, (400, 30), (560, 110), (rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255)), -1)
    warped = cv2.warpPerspective(sheet, M, (W, H))
    mask = np.zeros((H, W), np.uint8); cv2.fillPoly(mask, [np.int32(quad)], 255)
    img[mask > 0] = warped[mask > 0]

    # oggetti attorno (fuori dal foglio, ma vicini/toccanti)
    def rand_outside_point():
        for _ in range(50):
            x, y = rng.randint(0, W - 1), rng.randint(0, H - 1)
            if mask[y, x] == 0: return x, y
        return 0, 0
    n_obj = rng.randint(3, 7)
    for _ in range(n_obj):
        kind = rng.choice(["phone", "pen", "cup", "paper", "keys", "card", "book"])
        x, y = rand_outside_point()
        col = tuple(int(c) for c in (rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255)))
        if kind == "phone":
            rect = ((x, y), (rng.randint(120, 200), rng.randint(250, 400)), rng.uniform(0, 180))
            cv2.fillPoly(img, [np.int32(cv2.boxPoints(rect))], (20, 20, 25))
            cv2.polylines(img, [np.int32(cv2.boxPoints(rect))], True, (90, 90, 95), 3)
        elif kind == "pen":
            rect = ((x, y), (rng.randint(14, 24), rng.randint(300, 500)), rng.uniform(0, 180))
            cv2.fillPoly(img, [np.int32(cv2.boxPoints(rect))], col)
        elif kind == "cup":
            r = rng.randint(80, 150); cv2.circle(img, (x, y), r, col, -1); cv2.circle(img, (x, y), r - 15, (240, 240, 240), -1)
        elif kind == "paper":  # altro foglio bianco più piccolo, può toccare il bordo del documento
            rect = ((x, y), (rng.randint(150, 320), rng.randint(200, 420)), rng.uniform(0, 180))
            pp = np.int32(cv2.boxPoints(rect)); m2 = np.zeros((H, W), np.uint8); cv2.fillPoly(m2, [pp], 255)
            m2[mask > 0] = 0; img[m2 > 0] = (rng.randint(200, 245),) * 3
        elif kind == "keys":
            for k in range(rng.randint(3, 6)):
                cv2.circle(img, (x + rng.randint(-40, 40), y + rng.randint(-40, 40)), rng.randint(8, 16), (170, 170, 160), -1)
        elif kind == "card":
            rect = ((x, y), (rng.randint(150, 200), rng.randint(90, 130)), rng.uniform(0, 180))
            cv2.fillPoly(img, [np.int32(cv2.boxPoints(rect))], col)
        elif kind == "book":
            rect = ((x, y), (rng.randint(250, 400), rng.randint(350, 550)), rng.uniform(0, 180))
            pp = np.int32(cv2.boxPoints(rect)); m2 = np.zeros((H, W), np.uint8); cv2.fillPoly(m2, [pp], 255)
            m2[mask > 0] = 0; img[m2 > 0] = col
    # ombra morbida / vignettatura
    if rng.random() < 0.7:
        sh = np.ones((H, W), np.float32)
        cv2.circle(sh, (rng.randint(0, W), rng.randint(0, H)), rng.randint(300, 700), 0.6, -1)
        sh = cv2.GaussianBlur(sh, (0, 0), 120)
        img = np.clip(img.astype(np.float32) * sh[..., None], 0, 255).astype(np.uint8)
    img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.6, 1.6))
    return img, quad, mask


def iou_quad(q, mask):
    H, W = mask.shape
    m = np.zeros((H, W), np.uint8); cv2.fillPoly(m, [np.int32(q)], 255)
    inter = np.logical_and(m > 0, mask > 0).sum(); uni = np.logical_or(m > 0, mask > 0).sum()
    return inter / max(uni, 1)


if __name__ == "__main__":
    import logging; logging.disable(logging.CRITICAL)
    import server
    ns = vars(server)
    fn = ns[sys.argv[1] if len(sys.argv) > 1 else "_detect_document_quad"]
    N = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    ok = fail = wrong = 0; ious = []
    import time; t0 = time.time()
    for seed in range(N):
        img, gt, mask = make_scene(seed)
        q = fn(img)
        if q is None:
            fail += 1; print(f"seed {seed}: NONE"); cv2.imwrite(f"/tmp/scan/fail_{seed}.jpg", cv2.resize(img, None, fx=0.4, fy=0.4)); continue
        i = iou_quad(q, mask); ious.append(i)
        if i >= 0.85: ok += 1
        else:
            wrong += 1; print(f"seed {seed}: IoU {i:.2f}")
            vis = img.copy(); cv2.polylines(vis, [np.int32(q)], True, (0, 0, 255), 6); cv2.polylines(vis, [np.int32(gt)], True, (0, 255, 0), 3)
            cv2.imwrite(f"/tmp/scan/wrong_{seed}.jpg", cv2.resize(vis, None, fx=0.4, fy=0.4))
    print(f"OK {ok}/{N}  none {fail}  wrong {wrong}  meanIoU {np.mean(ious) if ious else 0:.3f}  {(time.time()-t0)/N*1000:.0f} ms/img")
