# og_preview.py — V50.z536 — Anteprima Open Graph DINAMICA per italianbrain.it: logo AxonOS + contatore «posti Founder rimasti».
#
# • Render con Pillow (già nel Core) su tela 1200×630: logo in alto, fascia in basso con «Solo N posti Founder rimasti · 19€/mese
#   per sempre». N = posti liberi del piano Builder Founder (19€) calcolati da `_landing_seats` (landing_cms.py) — stessa fonte
#   del contatore della landing. Font Liberation Sans (OFL) e logo in backend/assets/og/ → inclusi nel pacchetto VPS.
# • Rigenerato ogni notte alle 03:05 (job APScheduler in 37_app_startup_scheduler) e on-demand alla prima richiesta se il PNG
#   manca; il Master può forzarlo dal CMS (POST /landing/cms/og/refresh).
# • Servito da GET /api/public/og-preview.png (Cache-Control 1h). Su italianbrain.it nginx fa `proxy_pass` di /og-preview.png
#   verso questo endpoint (vedi deploy/italianbrain-landing/nginx-italianbrain.conf) → i social vedono sempre il numero aggiornato.
import asyncio as _og_asyncio
import os as _og_os
import threading as _og_threading
from datetime import datetime as _og_datetime
from io import BytesIO as _OgBytesIO

from fastapi.responses import Response as _OgResponse

_OG_ASSETS = _og_os.path.join(_kb_base_dir(), "assets", "og")  # noqa: F821 — axon_knowledge_base
_OG_OUT_DIR = _og_os.environ.get("AXON_OG_DIR") or _og_os.path.join(_kb_base_dir(), "data", "og")  # noqa: F821 — volume core_kb sul VPS
_OG_OUT = _og_os.path.join(_OG_OUT_DIR, "og-preview.png")
_OG_W, _OG_H = 1200, 630
_OG_BG = (0, 10, 37)          # blu notte del logo AxonOS
_OG_BAND = (7, 21, 48)        # #071530 (card-box della landing)
_OG_BORDER = (16, 42, 84)     # #102a54
_OG_CYAN = (0, 240, 255)      # #00f0ff
_OG_WHITE = (255, 255, 255)
_OG_MUTED = (160, 176, 205)
_og_lock = _og_threading.Lock()
_og_state = {"generated_at": None, "left": None, "limit": None, "error": None}


def _og_font(name: str, size: int):
    from PIL import ImageFont
    try:
        return ImageFont.truetype(_og_os.path.join(_OG_ASSETS, name), size)
    except Exception:  # noqa: BLE001
        return ImageFont.load_default()


def _og_caption(left: int, limit: int, price: int) -> tuple:
    """→ (parte prima del numero, numero, parte dopo, riga 2)."""
    if left <= 0:
        return ("Posti Founder ", "esauriti", "", "Lista d'attesa aperta · italianbrain.it")
    return ("Solo ", str(left), f" post{'o' if left == 1 else 'i'} Founder rimast{'o' if left == 1 else 'i'}", f"{price}€/mese per sempre · italianbrain.it")


def _og_render(left: int, limit: int, price: int = 19) -> bytes:
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (_OG_W, _OG_H), _OG_BG)
    d = ImageDraw.Draw(img)
    # ── logo (area alta) ──
    try:
        logo = Image.open(_og_os.path.join(_OG_ASSETS, "axon-logo.png")).convert("RGB")
        # pulizia artefatti JPEG: i pixel quasi-sfondo diventano ESATTAMENTE il colore di sfondo della tela (niente rettangolo visibile)
        import numpy as _np
        arr = _np.asarray(logo).astype(_np.int16)
        near = (_np.abs(arr - _np.array(_OG_BG, dtype=_np.int16)).sum(axis=2) < 60)
        arr[near] = _np.array(_OG_BG, dtype=_np.int16)
        logo = Image.fromarray(arr.astype(_np.uint8), "RGB")
        r = min(820 / logo.width, 300 / logo.height)
        logo = logo.resize((int(logo.width * r), int(logo.height * r)), Image.LANCZOS)
        img.paste(logo, ((_OG_W - logo.width) // 2, 70 + (300 - logo.height) // 2))
    except Exception:  # noqa: BLE001
        d.text((_OG_W // 2, 200), "AxonOS", font=_og_font("LiberationSans-Bold.ttf", 120), fill=_OG_WHITE, anchor="mm")
    # ── fascia in basso ──
    band_top = _OG_H - 210
    d.rounded_rectangle((48, band_top, _OG_W - 48, _OG_H - 36), radius=18, fill=_OG_BAND, outline=_OG_BORDER, width=2)
    pre, num, post, line2 = _og_caption(left, limit, price)
    f1 = _og_font("LiberationSans-Bold.ttf", 46)
    f2 = _og_font("LiberationSans-Regular.ttf", 30)
    # fiamma stilizzata (le emoji non sono renderizzabili con font TTF standard)
    flame_w = 44
    total_w = flame_w + 16 + d.textlength(pre, font=f1) + d.textlength(num, font=f1) + d.textlength(post, font=f1)
    x = (_OG_W - total_w) / 2
    y1 = band_top + 50
    fx, fy = x, y1
    d.ellipse((fx + 6, fy - 20, fx + 38, fy + 22), fill=(255, 122, 0))
    d.polygon([(fx + 22, fy - 40), (fx + 36, fy - 10), (fx + 8, fy - 10)], fill=(255, 122, 0))
    d.ellipse((fx + 14, fy - 4, fx + 30, fy + 18), fill=(255, 214, 10))
    x += flame_w + 16
    d.text((x, y1), pre, font=f1, fill=_OG_WHITE, anchor="lm")
    x += d.textlength(pre, font=f1)
    d.text((x, y1), num, font=f1, fill=_OG_CYAN, anchor="lm")
    x += d.textlength(num, font=f1)
    d.text((x, y1), post, font=f1, fill=_OG_WHITE, anchor="lm")
    d.text((_OG_W // 2, band_top + 108), line2, font=f2, fill=_OG_MUTED, anchor="mm")
    # barra progresso posti
    if limit > 0:
        bx0, bx1, by = 120, _OG_W - 120, _OG_H - 60
        d.rounded_rectangle((bx0, by - 3, bx1, by + 3), radius=3, fill=_OG_BORDER)
        taken = max(0, min(limit, limit - left))
        if taken:
            d.rounded_rectangle((bx0, by - 3, bx0 + (bx1 - bx0) * taken / limit, by + 3), radius=3, fill=_OG_CYAN)
    buf = _OgBytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


async def _og_regenerate() -> dict:
    data = await _landing_content()  # noqa: F821 — landing_cms
    seats = await _landing_seats(data["content"])  # noqa: F821
    b = seats.get("builder") or {"left": 0, "limit": 100}
    price = int((data["content"].get("plans", {}).get("builder", {}) or {}).get("price") or 19)
    png = await _og_asyncio.to_thread(_og_render, int(b["left"]), int(b["limit"]), price)
    _og_os.makedirs(_OG_OUT_DIR, exist_ok=True)
    tmp = _OG_OUT + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(png)
    _og_os.replace(tmp, _OG_OUT)
    _og_state.update({"generated_at": _og_datetime.utcnow().isoformat() + "Z", "left": b["left"], "limit": b["limit"], "error": None})
    logging.getLogger("axon.og").info("[axon-og] og-preview.png rigenerato: %s/%s posti Founder liberi", b["left"], b["limit"])  # noqa: F821
    return dict(_og_state)


async def _run_og_preview_job():
    try:
        await _og_regenerate()
    except Exception as e:  # noqa: BLE001
        _og_state["error"] = str(e)[:200]
        logging.getLogger("axon.og").exception("[axon-og] rigenerazione fallita")  # noqa: F821


@api_router.get("/public/og-preview.png")  # noqa: F821
async def public_og_preview():
    if not _og_os.path.isfile(_OG_OUT):
        await _run_og_preview_job()
    if not _og_os.path.isfile(_OG_OUT):
        raise HTTPException(status_code=503, detail=_og_state.get("error") or "Anteprima non disponibile")  # noqa: F821
    with open(_OG_OUT, "rb") as fh:
        png = fh.read()
    return _OgResponse(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=3600", "X-Og-Generated-At": str(_og_state.get("generated_at") or "")})


@api_router.get("/landing/cms/og")  # noqa: F821
async def landing_cms_og_info(user=Depends(_require_cms_admin)):  # noqa: F821
    return {**_og_state, "exists": _og_os.path.isfile(_OG_OUT), "path": _OG_OUT, "url": "/api/public/og-preview.png"}


@api_router.post("/landing/cms/og/refresh")  # noqa: F821
async def landing_cms_og_refresh(user=Depends(_require_cms)):  # noqa: F821
    try:
        return {"ok": True, **(await _og_regenerate())}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Rigenerazione fallita: {str(e)[:160]}")  # noqa: F821
