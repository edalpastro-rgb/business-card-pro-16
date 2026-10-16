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
from typing import Any, Callable, Dict, List, Optional

_log = logging.getLogger("axon.core.drive")

CHUNK_CHARS = 800
CHUNK_OVERLAP = 100
MAX_CHUNKS_PER_FILE = 120
_lock = threading.Lock()
_client = None
_embed_fn: Optional[Callable[[List[str]], List[List[float]]]] = None


def default_dir() -> str:
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.environ.get("AXON_DRIVE_INDEX_DIR") or os.environ.get("AXON_KB_DIR") or os.path.join(base, "data", "chroma")


def configure(embed_fn: Callable[[List[str]], List[List[float]]], client=None) -> None:
    """Iniezione dell'embedder (core.embedding.embedder.embed) e, opzionale, di un client Chroma (test: EphemeralClient)."""
    global _embed_fn, _client
    _embed_fn = embed_fn
    if client is not None:
        _client = client


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
    text = re.sub(r"[ \t]+", " ", (text or "").strip())
    if not text:
        return []
    out, i = [], 0
    while i < len(text) and len(out) < MAX_CHUNKS_PER_FILE:
        out.append(text[i:i + size])
        i += max(1, size - overlap)
    return out


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
    chunks = chunk_text(text)
    if not chunks:
        return 0
    chunks[0] = f"{folder_path}/{name}\n{chunks[0]}"
    ids = [f"{file_id}:{i}" for i in range(len(chunks))]
    metas = [{"file_id": file_id, "name": name, "folder_path": folder_path or "", "modified_time": modified_time or "", "chunk": i} for i in range(len(chunks))]
    col.upsert(ids=ids, documents=chunks, metadatas=metas, embeddings=_embed_fn(chunks))  # type: ignore[misc]
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
    return out[:k]


# ───────────────────────────── V50.z573 — FASCE ENERGETICHE: corrispondenza MATEMATICA, non testuale ─────────────────────────────
# «spread per cliente 400.000 kWh» → il listino ha la riga «DA 300.000 A 600.000 kWh | PUN + 0,008 €/kWh»: 400.000 non compare
# nel testo, quindi né la ricerca testuale né (a volte) il modello la riconoscono. Qui si estrae il consumo dalla domanda e si
# cercano nel TESTO COMPLETO del documento le righe-fascia che lo contengono; il wrapper (20) le inietta nel prompt come
# «FASCIA CORRISPONDENTE». Deterministico, nessuna rete, nessun modello.
_KWH_IN_QUERY_RX = re.compile(r"(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|m|g)?\s*(wh|w)\b", re.I)
_RANGE_ROW_RX = re.compile(r"\bDA\s+(\d{1,3}(?:[.\s]?\d{3})*|\d+)\s+A\s+(\d{1,3}(?:[.\s]?\d{3})*|\d+)\s*(k|m|g)?\s*wh\b", re.I)
_OPEN_ROW_RX = re.compile(r"\b(?:SUPERIOR[IE]\s+A|OLTRE(?:\s+I)?|MAGGIOR[IE]\s+DI|>)\s*(\d{1,3}(?:[.\s]?\d{3})*|\d+)\s*(k|m|g)?\s*wh\b", re.I)
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
    """Consumo numerico indicato dall'utente, in kWh (es. «400.000 kWh» → 400000; «0,4 GWh» → 400000). None se assente."""
    best = None
    for m in _KWH_IN_QUERY_RX.finditer(msg or ""):
        num, unit, tail = m.group(1), m.group(2), m.group(3).lower()
        if tail == "w":      # potenza (kW), non consumo
            continue
        try:
            v = _to_kwh(num, unit, base_wh=True)
        except ValueError:
            continue
        if v > 0 and (best is None or v > best):
            best = v
    return best


def range_rows_for_value(text: str, value_kwh: float, max_rows: int = 6) -> List[str]:
    """Righe (testo esatto, una per riga) del documento la cui fascia «DA X A Y kWh» contiene value_kwh (X ≤ v ≤ Y) oppure
    «superiori a / oltre X kWh» con v > X. Ordine del documento, senza duplicati.
    V50.z574 — testo del parser VECCHIO (una cella per riga: «DA 300.000 A 600.000 kWh» ↵ «PUN + 0,008 €/kWh» ↵ …): se la riga-fascia
    non contiene un valore (€/PUN/spread), le celle delle righe successive vengono accodate con « | » fino alla fascia seguente
    (max 8 righe), così la riga consegnata al prompt porta SEMPRE lo spread."""
    out: List[str] = []
    seen = set()
    page = ""
    lines = (text or "").splitlines()
    for idx, line in enumerate(lines):
        pm = re.search(r"\[pag\.\s*(\d+)\]", line)
        if pm:
            page = f"[pag.{pm.group(1)}] "
        hit = False
        for m in _RANGE_ROW_RX.finditer(line):
            try:
                lo, hi = _to_kwh(m.group(1), m.group(3)), _to_kwh(m.group(2), m.group(3))
            except ValueError:
                continue
            if lo <= value_kwh <= hi:
                hit = True; break
        if not hit:
            for m in _OPEN_ROW_RX.finditer(line):
                try:
                    lo = _to_kwh(m.group(1), m.group(2))
                except ValueError:
                    continue
                if value_kwh > lo:
                    hit = True; break
        if hit:
            row = re.sub(r"\s+", " ", line).strip(" |")
            if not _VALUE_RX.search(row):
                for nxt in lines[idx + 1: idx + 9]:
                    cell = re.sub(r"\s+", " ", nxt).strip(" |")
                    if not cell or _RANGE_ROW_RX.search(cell) or _OPEN_ROW_RX.search(cell) or _HEADING_RX.match(cell):
                        break
                    row += " | " + cell
            if row and row not in seen:
                seen.add(row); out.append(page + row if not row.startswith("[pag.") else row)
                if len(out) >= max_rows:
                    break
    return out


def format_kwh(value_kwh: float) -> str:
    v = int(round(value_kwh))
    return f"{v:,}".replace(",", ".") + " kWh"
