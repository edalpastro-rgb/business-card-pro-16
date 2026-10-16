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
