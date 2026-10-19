"""core/drive_retrieval.py — V50.z562 — RETRIEVAL SEMANTICO DEI FILE DRIVE (ChromaDB + MiniLM locale).

Prima: scelta dei file solo per parole nel NOME (+3) / PERCORSO (+1) → «potenza impegnata» non trovava `01_POWER.pdf`.
Ora: il testo estratto da ogni snapshot (`drive_snapshots.text`, OCR incluso) viene spezzato in chunk e indicizzato in una
collection ChromaDB per tenant (`drive_<tenant>`), aggiornata a ogni reindex (`upsert_file`) e rimossa con `delete_file`.
`search(tenant, query, k)` → file ordinati per pertinenza sul CONTENUTO (distanza coseno) + bonus lessicale sul nome.
Contratto stabile; i wrapper NON lo ridefiniscono (vedi core.integrity).
"""
import hashlib
import logging
import os
import re
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple

_log = logging.getLogger("axon.core.drive")

CHUNK_CHARS = 800
CHUNK_OVERLAP = 100
MAX_CHUNKS_PER_FILE = 120
_lock = threading.Lock()
_client = None
_embed_index_fn: Optional[Callable[[List[str]], List[List[float]]]] = None
_embed_fn: Optional[Callable[[List[str]], List[List[float]]]] = None


def default_dir() -> str:
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.environ.get("AXON_DRIVE_INDEX_DIR") or os.environ.get("AXON_KB_DIR") or os.path.join(base, "data", "chroma")


def configure(embed_fn: Callable[[List[str]], List[List[float]]], client=None, embed_index_fn: Callable[[List[str]], List[List[float]]] = None) -> None:
    """Iniezione dell'embedder (core.embedding.embedder.embed) e, opzionale, di un client Chroma (test: EphemeralClient)."""
    global _embed_index_fn, _embed_fn, _client
    _embed_fn = embed_fn
    if client is not None:
        _client = client
    _embed_index_fn = embed_index_fn


def _chroma():
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                import chromadb
                from chromadb.config import Settings
                os.makedirs(default_dir(), exist_ok=True)
                _client = chromadb.PersistentClient(path=default_dir(), settings=Settings(anonymized_telemetry=False, allow_reset=False))
    return _client


def available() -> bool:
    try:
        return _embed_fn is not None and _chroma() is not None
    except Exception as exc:  # noqa: BLE001
        _log.warning("[core-drive] chroma non disponibile: %s", exc)
        return False


def collection_name(tenant: str) -> str:
    return "drive_" + hashlib.sha1((tenant or "").encode()).hexdigest()[:24]


def collection(tenant: str):
    return _chroma().get_or_create_collection(collection_name(tenant), metadata={"hnsw:space": "cosine"})


def chunk_text(text: str, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Compat (test/strumenti): solo i testi dei chunk per riga/paragrafo (vedi chunk_text_pages)."""
    return [c for c, _p in chunk_text_pages(text, size)]


_PAGE_MARK_RX = re.compile(r"^\s*\[(?:TABELLA\s+)?pag\.\s*(\d+)")


def chunk_text_pages(text: str, size: int = CHUNK_CHARS) -> List[Tuple[str, int]]:
    """V50 tag 2026-10-19 — CHUNKING PER RIGA/PARAGRAFO CON PAGINA. Mai una riga spezzata a metà (le righe-tabella
    «DA 300.000 A 600.000 kWh | PUN + 0,008 €/kWh» restano intere); la pagina corrente è tracciata dai marcatori
    «[pag.N]» / «[TABELLA pag.N …]» del parser e OGNI chunk è prefissato con «[pag.N]» (+ metadata `page`), così il
    modello cita la pagina reale invece di inventarla. Una riga più lunga di `size` diventa un chunk da sola."""
    t = (text or "").strip()
    if not t:
        return []
    out: List[Tuple[str, int]] = []
    page = 0
    buf: List[str] = []
    buf_len = 0
    buf_page = 0

    def _flush():
        nonlocal buf, buf_len
        body = "\n".join(buf).strip()
        if body:
            out.append((f"[pag.{buf_page}] {body}" if buf_page and not body.startswith("[pag.") else body, buf_page))
        buf, buf_len = [], 0

    for line in t.splitlines():
        ln = line.rstrip()
        m = _PAGE_MARK_RX.match(ln)
        if m:
            new_page = int(m.group(1))
            if buf and new_page != page:
                _flush()
            page = new_page
        if not ln.strip():
            continue
        if buf and buf_len + len(ln) + 1 > size - (len(f"[pag.{page}] ") if page else 0):  # il prefisso [pag.N] rientra nel budget
            _flush()
        if not buf:
            buf_page = page
        buf.append(ln)
        buf_len += len(ln) + 1
        if len(out) >= MAX_CHUNKS_PER_FILE:
            break
    if len(out) < MAX_CHUNKS_PER_FILE:
        _flush()
    return out[:MAX_CHUNKS_PER_FILE]


def upsert_file(tenant: str, file_id: str, name: str, folder_path: str, text: str, modified_time: str = "") -> int:
    """Indicizza (o reindicizza) il testo di un file. Ritorna il numero di chunk. Il nome del file è incluso nel primo
    chunk così anche «01_POWER» come parola chiave ha un vettore pertinente."""
    if not available():
        return 0
    col = collection(tenant)
    try:
        col.delete(where={"file_id": file_id})
    except Exception:  # noqa: BLE001
        pass
    pairs = chunk_text_pages(text, CHUNK_CHARS)
    if not pairs:
        return 0
    chunks = [c for c, _p in pairs]
    chunks[0] = f"{folder_path}/{name}\n{chunks[0]}"
    ids = [f"{file_id}:{i}" for i in range(len(chunks))]
    metas = [{"file_id": file_id, "name": name, "folder_path": folder_path or "", "modified_time": modified_time or "", "chunk": i, "page": pairs[i][1]} for i in range(len(chunks))]
    col.upsert(ids=ids, documents=chunks, metadatas=metas, embeddings=(_embed_index_fn or _embed_fn)(chunks))  # type: ignore[misc]
    return len(chunks)


def delete_file(tenant: str, file_id: str) -> None:
    if not available():
        return
    try:
        collection(tenant).delete(where={"file_id": file_id})
    except Exception:  # noqa: BLE001
        pass


def count(tenant: str) -> int:
    try:
        return collection(tenant).count() if available() else 0
    except Exception:  # noqa: BLE001
        return 0


def _name_bonus(query: str, name: str, folder: str) -> float:
    q = re.findall(r"[a-zà-ù0-9]{3,}", (query or "").lower())
    n, f = (name or "").lower(), (folder or "").lower()
    return sum(0.15 for w in q if w in n) + sum(0.05 for w in q if w in f)


def search(tenant: str, query: str, k: int = 4, n_chunks: int = 16) -> List[Dict[str, Any]]:
    """→ [{file_id, name, folder_path, modified_time, score, snippet, chunks}] ordinati per pertinenza (score 0..1+bonus).
    V50.z569 — `chunks` = fino a 3 chunk COMPLETI del file più vicini alla domanda (non solo i primi 300 caratteri): il prompt
    riceve ESATTAMENTE il passaggio che risponde (es. la riga di tabella «DA 150.000 A 300.000 kWh | PUN + 0,01 €/kWh»),
    anche quando sta oltre i primi 8.000 caratteri del documento."""
    if not available() or not (query or "").strip():
        return []
    col = collection(tenant)
    if col.count() == 0:
        return []
    res = col.query(query_embeddings=_embed_fn([query]), n_results=min(n_chunks, col.count()), include=["metadatas", "documents", "distances"])  # type: ignore[misc]
    best: Dict[str, Dict[str, Any]] = {}
    for meta, doc, dist in zip(res["metadatas"][0], res["documents"][0], res["distances"][0]):
        sim = 1.0 - float(dist)  # cosine distance → similarity
        fid = meta["file_id"]
        cur = best.get(fid)
        if cur is None:
            best[fid] = cur = {"file_id": fid, "name": meta.get("name"), "folder_path": meta.get("folder_path"), "modified_time": meta.get("modified_time"), "score": sim, "snippet": doc[:300], "chunks": []}
        elif sim > cur["score"]:
            cur["score"] = sim
            cur["snippet"] = doc[:300]
        if len(cur["chunks"]) < 3:
            cur["chunks"].append(doc)  # i risultati arrivano già ordinati per distanza crescente
    out = list(best.values())
    for r in out:
        r["score"] = round(r["score"] + _name_bonus(query, r["name"] or "", r["folder_path"] or ""), 4)
    out.sort(key=lambda r: -r["score"])
    out = out[:k]
    # tag 2026-10-19 — BOOST LESSICALE SUI NUMERI (ibrido): MiniLM non distingue «150-300k» da «50-150k». Se la domanda contiene
    # numeri, per i file selezionati si aggiungono (max 2) i chunk che contengono TUTTI quei numeri (150 → «150.000»/«150k»),
    # così la riga esatta della tabella arriva al prompt anche quando il vettore preferisce l'intestazione della tabella.
    nums = [n for n in re.findall(r"\d+(?:[.,]\d+)?", query or "") if n not in ("1", "2", "3")]
    if nums and out:
        pats = [re.compile(rf"(?<![\d.,]){re.escape(n)}(?:\.000|\s?k\b|\s?mila\b|\b)", re.I) for n in nums[:3]]
        for r in out:
            try:
                got = col.get(where={"file_id": r["file_id"]}, include=["documents"])
            except Exception:  # noqa: BLE001
                continue
            added = 0
            for doc in got.get("documents") or []:
                if added >= 2:
                    break
                if doc not in r["chunks"] and all(p.search(doc) for p in pats):
                    r["chunks"].append(doc); added += 1
    return out


# ───────────────────────────── V50.z573 — FASCE ENERGETICHE: corrispondenza MATEMATICA, non testuale ─────────────────────────────
# «spread per cliente 400.000 kWh» → il listino ha la riga «DA 300.000 A 600.000 kWh | PUN + 0,008 €/kWh»: 400.000 non compare
# nel testo, quindi né la ricerca testuale né (a volte) il modello la riconoscono. Qui si estrae il consumo dalla domanda e si
# cercano nel TESTO COMPLETO del documento le righe-fascia che lo contengono; il wrapper (20) le inietta nel prompt come
# «FASCIA CORRISPONDENTE». Deterministico, nessuna rete, nessun modello.
_KWH_IN_QUERY_RX = re.compile(r"(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|m|g)?\s*(wh|w|ilowattora|egawattora)\b", re.I)
# V50.z575 — forme abbreviate senza unità esplicita: «418k», «418 k», «418 mila», «418k kWh» (il «k» non è l'unità ma il moltiplicatore)
_KWH_SHORT_RX = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(k|mila|mln|m)\b(?:\s*kwh)?", re.I)
_KWH_BARE_RX = re.compile(r"\b(\d{1,3}(?:[.\s]\d{3})+|\d{4,7})\b")
_CONSUMPTION_CTX_RX = re.compile(r"consum|kwh|kw/h|spread|fasc|listin|offert|prezz|tariff|energ|luce|elettric|cliente da|utenza", re.I)
_RANGE_ROW_RX = re.compile(r"\bDA\s+(\d{1,3}(?:[.\s]?\d{3})*|\d+)\s+A\s+(\d{1,3}(?:[.\s]?\d{3})*|\d+)\s*(k|m|g)?\s*wh\b", re.I)
_OPEN_ROW_RX = re.compile(r"\b(?:SUPERIOR[IE]\s+(?:A|AI|DI)|OLTRE(?:\s+I)?|MAGGIOR[IE]\s+DI|>)\s*(\d{1,3}(?:[.\s]?\d{3})*|\d+)\s*(k|m|g)?\s*wh\b", re.I)
# V50.z577 — fasce basse e forme abbreviate dei listini: «FINO A 50.000 kWh», «inferiore a 10.000 kWh», «< 10.000 kWh» (0 ≤ v ≤ X)
# e «Fascia 0 -10k kWh», «10k-50k kWh», «0 - 10.000 kWh» (X ≤ v ≤ Y, «k»/«mila» = ×1000). Prima: 9.000 kWh → nessuna fascia.
_UPTO_ROW_RX = re.compile(r"\b(?:FINO\s+A(?:I)?|INFERIOR[IE]\s+(?:A|AI)|MENO\s+DI)\s*(\d{1,3}(?:[.\s]?\d{3})*|\d+)\s*(k|m|g)?\s*wh\b|(?:<=?|≤)\s*(\d{1,3}(?:[.\s]?\d{3})*|\d+)\s*(k|m|g)?\s*wh\b", re.I)
_DASH_ROW_RX = re.compile(r"(?<![\d.,])(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*(k(?!wh)|mila)?\s*[-–]\s*(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*(k(?!wh)|mila)?\s*(k|m|g)?\s*wh\b", re.I)
_PAGE_ANY_RX = re.compile(r"^\s*\[(?:TABELLA\s+)?pag\.\s*(\d+)", re.I)                          # «[pag.31]» e «[TABELLA pag.31 — …]»
_UNIT_KWH = {None: 1.0, "": 1.0, "k": 1.0, "m": 1000.0, "g": 1_000_000.0}
_VALUE_RX = re.compile(r"€|\bPUN\b|\bPSV\b|spread|/\s*kwh|/\s*smc", re.I)          # la riga porta già un valore/prezzo
_HEADING_RX = re.compile(r"^(?=[^\d]*$)[A-ZÀ-Ü][A-ZÀ-Ü' ]{5,}$")                      # intestazione MAIUSCOLA senza cifre (es. «TRATTATIVA AD HOC»)


def _to_kwh(num: str, unit: Optional[str], base_wh: bool = False) -> float:
    n = float(num.replace(" ", "").replace(".", "").replace(",", ".")) if re.search(r"\d[.\s]\d{3}\b", num) else float(num.replace(",", "."))
    mult = _UNIT_KWH.get((unit or "").lower(), 1.0)
    if base_wh and not unit:
        return n / 1000.0   # «400000 Wh» (raro)
    return n * mult


def consumption_kwh_in_query(msg: str) -> Optional[float]:
    """Consumo numerico indicato dall'utente, in kWh. Forme riconosciute: «400.000 kWh», «418000 kwh», «450 MWh», «0,4 GWh»,
    «418k», «418 mila», «418k kWh», e un numero ≥ 1.000 «nudo» se la frase parla di consumi/spread/fasce/listini.
    Ignora le potenze (kW) e gli intervalli «150-300k». None se assente."""
    m0 = msg or ""
    best = None
    for m in _KWH_IN_QUERY_RX.finditer(m0):
        num, unit, tail = m.group(1), m.group(2), m.group(3).lower()
        if tail == "w":      # potenza (kW), non consumo
            continue
        if tail == "egawattora":
            unit = "m"
        try:
            v = _to_kwh(num, unit, base_wh=True)
        except ValueError:
            continue
        if v > 0 and (best is None or v > best):
            best = v
    if best is None:
        for m in _KWH_SHORT_RX.finditer(m0):
            if re.search(r"\d\s*[-–]\s*$", m0[:m.start()]):   # «150-300k» → intervallo, non un consumo
                continue
            try:
                n = float(m.group(1).replace(".", "").replace(",", "."))
            except ValueError:
                continue
            mult = {"k": 1000.0, "mila": 1000.0, "mln": 1_000_000.0, "m": 1_000_000.0}[m.group(2).lower()]
            v = n * mult
            if v >= 1000 and (best is None or v > best):
                best = v
    if best is None and _CONSUMPTION_CTX_RX.search(m0) and not re.search(r"\b(19|20)\d\d\b", m0):
        for m in _KWH_BARE_RX.finditer(m0):
            if re.search(r"\d\s*[-–]\s*$", m0[:m.start()]):
                continue
            try:
                v = float(m.group(1).replace(".", "").replace(" ", ""))
            except ValueError:
                continue
            if v >= 1000 and (best is None or v > best):
                best = v
    return best


def _band_bounds(line: str) -> List[Tuple[float, float]]:
    """V50.z577 — tutti gli intervalli [lo, hi] in kWh descritti nella riga (DA X A Y · X-Y/«0 -10k» · FINO A X · oltre/superiore X)."""
    out: List[Tuple[float, float]] = []
    for m in _RANGE_ROW_RX.finditer(line):
        try:
            out.append((_to_kwh(m.group(1), m.group(3)), _to_kwh(m.group(2), m.group(3))))
        except ValueError:
            pass
    for m in _DASH_ROW_RX.finditer(line):
        try:
            unit = _UNIT_KWH.get((m.group(5) or "").lower(), 1.0)
            lo = _to_kwh(m.group(1), None) * (1000.0 if m.group(2) else 1.0) * unit
            hi = _to_kwh(m.group(3), None) * (1000.0 if m.group(4) else 1.0) * unit
        except ValueError:
            continue
        if lo < hi:
            out.append((lo, hi))
    for m in _UPTO_ROW_RX.finditer(line):
        num, unit = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        try:
            out.append((0.0, _to_kwh(num, unit)))
        except ValueError:
            pass
    for m in _OPEN_ROW_RX.finditer(line):
        try:
            out.append((_to_kwh(m.group(1), m.group(2)) + 1e-9, float("inf")))   # «oltre X»: v > X
        except ValueError:
            pass
    return out


def _is_price_row(row: str) -> bool:
    return bool(_VALUE_RX.search(row) and re.search(r"\d", row))


def _labelled_price_row(lines: List[str], pidx: int) -> str:
    """V50.z578 — riga-prezzo di tabella con i nomi di colonna (riga d'intestazione senza cifre subito sopra, stesso n. di celle):
    «Indice di riferimento + Spread: PUN + 0,025 €/kWh … | Fissi: 17.90 €/mese … | Variabili: 0.055 €/kWh». Senza intestazione: riga com'è."""
    cells = [c.strip() for c in lines[pidx].strip().strip("|").split("|")]
    for back in range(1, 4):
        j = pidx - back
        if j < 0 or not lines[j].lstrip().startswith("|"):
            break
        hdr = [c.strip() for c in lines[j].strip().strip("|").split("|")]
        if len(hdr) == len(cells) and not re.search(r"\d", lines[j]) and all(hdr):
            return " | ".join(f"{h}: {c}" for h, c in zip(hdr, cells))
    return re.sub(r"\s+", " ", lines[pidx]).strip(" |")


def range_rows_for_value(text: str, value_kwh: float, max_rows: int = 6) -> List[str]:
    """Righe (testo esatto, una per riga) del documento la cui fascia contiene value_kwh: «DA X A Y kWh» (X ≤ v ≤ Y),
    «superiori a / superiore di / oltre X kWh» (v > X), V50.z577: «FINO A X kWh» (v ≤ X) e «Fascia 0 -10k kWh» / «10k-50k kWh».
    Ordine del documento, senza duplicati.
    V50.z574 — testo del parser VECCHIO (una cella per riga): se la riga-fascia non contiene un valore (€/PUN/spread), le celle delle
    righe successive vengono accodate con « | » fino alla fascia seguente (max 8 righe).
    V50.z577 — PDF a slide (es. pag.31 «Super Impresa Smart»): il parser mette le TABELLE prezzi della pagina prima delle etichette
    «Fascia 0 -10k kWh», «Fascia 10k -50k kWh». Se sulla stessa pagina il numero di etichette-fascia senza prezzo è uguale al numero
    di righe-prezzo delle tabelle, l'N-esima fascia riceve l'N-esima riga-prezzo (stesso ordine dall'alto in basso nella slide)."""
    out: List[str] = []
    seen = set()
    lines = (text or "").splitlines()
    # pagina di ogni riga + per pagina: etichette-fascia senza prezzo e righe-prezzo di tabella (non fasce), in ordine
    page_of: List[str] = []
    cur = ""
    bare_bands: Dict[str, List[int]] = {}
    price_rows: Dict[str, List[int]] = {}
    for idx, line in enumerate(lines):
        pm = _PAGE_ANY_RX.match(line)
        if pm:
            cur = pm.group(1)
        page_of.append(cur)
        if _band_bounds(line):
            if not _is_price_row(line):
                bare_bands.setdefault(cur, []).append(idx)
        elif line.lstrip().startswith("|") and _is_price_row(line):
            price_rows.setdefault(cur, []).append(idx)
    for idx, line in enumerate(lines):
        if not any(lo <= value_kwh <= hi for lo, hi in _band_bounds(line)):
            continue
        row = re.sub(r"\s+", " ", line).strip(" |")
        if not _VALUE_RX.search(row):
            pg = page_of[idx]
            bands, prices = bare_bands.get(pg) or [], price_rows.get(pg) or []
            if pg and bands and len(bands) == len(prices) and idx in bands:
                row += " | " + _labelled_price_row(lines, prices[bands.index(idx)])
            else:
                for nxt in lines[idx + 1: idx + 9]:
                    cell = re.sub(r"\s+", " ", nxt).strip(" |")
                    if not cell or _band_bounds(cell) or _HEADING_RX.match(cell) or _PAGE_ANY_RX.match(nxt):
                        break
                    row += " | " + cell
        if row and row not in seen:
            seen.add(row)
            page = f"[pag.{page_of[idx]}] " if page_of[idx] else ""
            out.append(page + row if not row.startswith("[pag.") else row)
            if len(out) >= max_rows:
                break
    return out


def format_kwh(value_kwh: float) -> str:
    v = int(round(value_kwh))
    return f"{v:,}".replace(",", ".") + " kWh"
