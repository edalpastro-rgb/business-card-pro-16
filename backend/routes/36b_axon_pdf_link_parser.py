# 36b_axon_pdf_link_parser.py — V50.z164 — Parser PDF da link esterni per AxonOS
#
# MODULO ISOLATO (nessuna modifica ai moduli esistenti). Caricato da server.py nel
# namespace condiviso DOPO 20_axon_memory (che definisce `_build_axon_teach_section`)
# e PRIMA di 37_app_startup_scheduler (include_router).
#
# Cosa fa:
#   • Quando il messaggio dell'utente contiene link http(s) a PDF (es. GME
#     https://www.mercatoelettrico.org/.../PrezziMedi.pdf) scarica il file,
#     estrae testo + valori numerici (formato italiano 1.234,56 / percentuali / €)
#     e li inietta nel contesto di Axon (sezione "PDF DAL LINK") per l'analisi.
#   • Cache 6h per URL (`axon_pdf_link_cache`) per non riscaricare.
#   • Endpoint `POST /api/axon/pdf-link/parse {url}` per uso diretto/test.
#
# Integrazione senza toccare il codice esistente: il modulo AVVOLGE la funzione
# globale `_build_axon_teach_section` (chiamata dagli endpoint chat/stream tramite
# il nome globale, risolto a runtime) aggiungendo la sezione PDF al risultato.

import time as _axon_time  # modulo isolato: import proprio

_AXON_PDF_LINK_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.IGNORECASE)
_AXON_PDF_MAX_BYTES = 15 * 1024 * 1024
_AXON_PDF_CACHE_TTL_H = 6
_AXON_PDF_TEXT_CAP = 14000  # caratteri di testo iniettati nel prompt per PDF
_AXON_PDF_MAX_LINKS = 3
# Numeri in formato italiano/internazionale, percentuali, euro: es. 1.234,56  12,5%  € 0,1234  2024
_AXON_NUM_RE = re.compile(r"(?<![\w/])(?:€\s?)?[-+]?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?%?|(?<![\w/,.])[-+]?\d+(?:\.\d+)?%?(?![\w/])")


def _axon_pdf_links_in(text: str) -> List[str]:
    """URL http(s) presenti nel testo che puntano (probabilmente) a un PDF."""
    out: List[str] = []
    for m in _AXON_PDF_LINK_RE.finditer(text or ""):
        u = m.group(0).rstrip(".,;:")
        low = u.lower()
        if ".pdf" in low.split("?")[0] or "format=pdf" in low or "/pdf/" in low:
            if u not in out:
                out.append(u)
    return out[:_AXON_PDF_MAX_LINKS]


def _axon_pdf_extract_numbers(text: str, max_lines: int = 120) -> List[Dict[str, Any]]:
    """Righe con valori numerici: [{line, values:[float], raw:[str]}] (prime max_lines)."""
    rows: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        ln = line.strip()
        if not ln or len(ln) > 400:
            continue
        raws = [r.strip() for r in _AXON_NUM_RE.findall(ln) if any(ch.isdigit() for ch in r)]
        if len(raws) < 1:
            continue
        vals: List[float] = []
        for r in raws:
            t = r.replace("€", "").replace("%", "").replace(" ", "").strip()
            # 1.234,56 → 1234.56 ; 12,5 → 12.5 ; 1234.56 (int'l) resta
            if "," in t:
                t = t.replace(".", "").replace(",", ".")
            elif t.count(".") > 1:
                t = t.replace(".", "")
            try:
                vals.append(float(t))
            except ValueError:
                pass
        if vals:
            rows.append({"line": ln[:240], "values": vals[:24], "raw": raws[:24]})
        if len(rows) >= max_lines:
            break
    return rows


async def axon_fetch_pdf_link(url: str, force: bool = False) -> Dict[str, Any]:
    """Scarica un PDF da URL, estrae testo e numeri. Ritorna dict serializzabile:
    {ok, url, bytes, pages, title, text, numbers, cached, error}."""
    now = utcnow()
    if not force:
        try:
            c = await db.axon_pdf_link_cache.find_one({"_id": url}, {"_id": 0})
            # epoch float: evita confronti naive/aware con i datetime letti da Mongo
            if c and c.get("fetched_ts") and (_axon_time.time() - float(c["fetched_ts"])) < _AXON_PDF_CACHE_TTL_H * 3600:
                c["cached"] = True
                return c
        except Exception:
            pass
    result: Dict[str, Any] = {"ok": False, "url": url, "bytes": 0, "pages": None, "title": None,
                              "text": "", "numbers": [], "cached": False, "error": None, "fetched_at": now,
                              "fetched_ts": _axon_time.time()}
    try:
        import httpx as _httpx
        headers = {"User-Agent": "Mozilla/5.0 (compatible; AdvisorOS-Axon/1.0)", "Accept": "application/pdf,*/*"}
        async with _httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=headers) as client:
            async with client.stream("GET", url) as r:
                if r.status_code != 200:
                    result["error"] = f"HTTP {r.status_code}"
                    return result
                buf = bytearray()
                async for chunk in r.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > _AXON_PDF_MAX_BYTES:
                        result["error"] = "PDF troppo grande (>15MB)"
                        return result
        data = bytes(buf)
        result["bytes"] = len(data)
        if not data.startswith(b"%PDF"):
            result["error"] = "Il link non restituisce un PDF"
            return result
        text = ""
        pages = None
        try:
            from pypdf import PdfReader  # type: ignore
            rd = PdfReader(io.BytesIO(data))
            pages = len(rd.pages)
            meta_title = None
            try:
                meta_title = (rd.metadata or {}).get("/Title")  # type: ignore
            except Exception:
                meta_title = None
            result["title"] = str(meta_title) if meta_title else None
        except Exception:
            pass
        try:
            text = _extract_pdf_text_bytes(data) or ""
        except Exception:
            text = ""
        if not text.strip():
            # fallback: pdfplumber (se presente) con tabelle → righe TSV
            try:
                import pdfplumber  # type: ignore
                parts = []
                with pdfplumber.open(io.BytesIO(data)) as pdf:
                    for pg in pdf.pages[:40]:
                        t = pg.extract_text() or ""
                        parts.append(t)
                        for tb in (pg.extract_tables() or [])[:5]:
                            for row in tb:
                                parts.append("\t".join((c or "").strip() for c in row))
                text = "\n".join(parts)
            except Exception:
                pass
        text = re.sub(r"[ \t]{2,}", " ", text or "").strip()
        result["text"] = text[:200000]
        result["numbers"] = _axon_pdf_extract_numbers(text)
        result["ok"] = bool(text.strip())
        if not result["ok"]:
            result["error"] = "Nessun testo estraibile (PDF scansionato/immagine)"
    except Exception as e:
        result["error"] = str(e)[:200]
    try:
        await db.axon_pdf_link_cache.update_one({"_id": url}, {"$set": result}, upsert=True)
    except Exception:
        pass
    return result


def _axon_pdf_context_block(parsed: Dict[str, Any]) -> str:
    """Blocco di prompt per Axon con testo + sintesi numerica del PDF."""
    if not parsed.get("ok"):
        return (f"--- PDF dal link {parsed.get('url')} ---\n"
                f"⚠️ Non leggibile: {parsed.get('error') or 'errore sconosciuto'}. Dillo all'utente e chiedi di allegare il file.")
    head = f"--- PDF dal link {parsed.get('url')} ---\n"
    if parsed.get("title"):
        head += f"Titolo: {parsed['title']}\n"
    head += f"Pagine: {parsed.get('pages') or '?'} · dimensione: {round((parsed.get('bytes') or 0) / 1024)} KB\n"
    text = (parsed.get("text") or "")[:_AXON_PDF_TEXT_CAP]
    if len(parsed.get("text") or "") > _AXON_PDF_TEXT_CAP:
        text += "\n... (testo troncato)"
    nums = parsed.get("numbers") or []
    num_lines = "\n".join(f"  • {r['line']}" for r in nums[:40])
    block = head + "\nTESTO:\n" + text
    if num_lines:
        block += "\n\nRIGHE CON VALORI NUMERICI (prime 40, utili per tabelle/prezzi):\n" + num_lines
    return block


async def axon_pdf_links_section(user_msg: str) -> str:
    """Sezione prompt per i link PDF presenti nel messaggio utente ("" se nessuno)."""
    links = _axon_pdf_links_in(user_msg or "")
    if not links:
        return ""
    blocks: List[str] = []
    for u in links:
        try:
            parsed = await asyncio.wait_for(axon_fetch_pdf_link(u), timeout=30)
        except asyncio.TimeoutError:
            parsed = {"ok": False, "url": u, "error": "timeout download (30s)"}
        except Exception as e:
            parsed = {"ok": False, "url": u, "error": str(e)[:120]}
        blocks.append(_axon_pdf_context_block(parsed))
    return (
        "\n\n### 📄 PDF DAL LINK NELLA RICHIESTA (scaricati e letti ora dal server)\n"
        + "\n\n".join(blocks)
        + "\n\nQuesto è il CONTENUTO REALE dei PDF linkati dall'utente: usalo come FONTE PRIMARIA per "
        "l'analisi (prezzi, tabelle, date). Cita il nome/URL del documento. Se il testo è troncato, "
        "dillo e proponi di concentrarti su una sezione specifica."
    )


# --- Wrapping non invasivo di _build_axon_teach_section ---------------------
_axon_build_teach_section_orig = _build_axon_teach_section  # noqa: F821 — definito in 20_axon_memory


async def _build_axon_teach_section(tenant: str, user_msg: str) -> str:  # type: ignore[no-redef]
    base = await _axon_build_teach_section_orig(tenant, user_msg)
    try:
        extra = await axon_pdf_links_section(user_msg)
    except Exception as e:
        logger.warning("[axon-pdf-link] section failed: %s", e)
        extra = ""
    if not extra:
        return base
    return (base or "") + extra


# --- Endpoint diretto -------------------------------------------------------
class AxonPdfLinkIn(BaseModel):
    url: str
    force: bool = False


@api_router.post("/axon/pdf-link/parse")
async def axon_pdf_link_parse(body: AxonPdfLinkIn, user=Depends(get_current_user)):
    """Scarica un PDF esterno ed estrae testo + valori numerici (cache 6h)."""
    url = (body.url or "").strip()
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(status_code=400, detail="URL non valido (deve iniziare con http:// o https://)")
    parsed = await axon_fetch_pdf_link(url, force=body.force)
    out = dict(parsed)
    out.pop("fetched_at", None); out.pop("fetched_ts", None)
    out["text"] = (out.get("text") or "")[:60000]
    out["numbers"] = (out.get("numbers") or [])[:120]
    return out
