"""core/embedding.py — V50.z562 — Embedder locale all-MiniLM-L6-v2 (ONNX): unico per Knowledge Base e Retrieval Drive."""
import logging
import os
import threading
from typing import List

import numpy as np

EMBED_MAX_TOKENS = 256
EMBED_BATCH = 32
_log = logging.getLogger("axon.core.embedding")


def default_model_dir() -> str:
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # …/backend
    return os.environ.get("AXON_EMBED_MODEL_DIR") or os.path.join(base, "models", "minilm")


class LocalEmbedder:
    def __init__(self, model_dir: str, threads: int = None):
        self.model_dir = model_dir
        self.threads = threads  # None → AXON_EMBED_THREADS (query live, default 2); il reindex usa un'istanza a 1 thread
        self._lock = threading.Lock()
        self._session = None
        self._tok = None

    @property
    def available(self) -> bool:
        return os.path.isfile(os.path.join(self.model_dir, "model.onnx")) and os.path.isfile(os.path.join(self.model_dir, "tokenizer.json"))

    def _load(self):
        if self._session is not None:
            return
        with self._lock:
            if self._session is not None:
                return
            import onnxruntime as ort
            from tokenizers import Tokenizer
            tok = Tokenizer.from_file(os.path.join(self.model_dir, "tokenizer.json"))
            tok.enable_truncation(EMBED_MAX_TOKENS)
            tok.enable_padding()
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = max(1, int(self.threads or os.environ.get("AXON_EMBED_THREADS") or 2))  # tag 2026-10-19 — query live 2 thread (prep -0,4 s); reindex notturno/manuale: istanza separata a 1 thread (non satura la CPU)
            self._session = ort.InferenceSession(os.path.join(self.model_dir, "model.onnx"), sess_options=opts, providers=["CPUExecutionProvider"])
            self._tok = tok
            _log.info("[core-embed] MiniLM-L6-v2 ONNX caricato da %s", self.model_dir)

    def embed(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        self._load()
        out: List[List[float]] = []
        for i in range(0, len(texts), EMBED_BATCH):
            enc = self._tok.encode_batch(texts[i:i + EMBED_BATCH])
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            am = np.array([e.attention_mask for e in enc], dtype=np.int64)
            tt = np.array([e.type_ids for e in enc], dtype=np.int64)
            hidden = self._session.run(None, {"input_ids": ids, "attention_mask": am, "token_type_ids": tt})[0]
            mask = am[..., None].astype(np.float32)
            emb = (hidden * mask).sum(1) / np.clip(mask.sum(1), 1e-9, None)
            emb = emb / np.clip(np.linalg.norm(emb, axis=1, keepdims=True), 1e-9, None)
            out.extend(emb.astype(np.float32).tolist())
        return out


embedder = LocalEmbedder(default_model_dir())
index_embedder = LocalEmbedder(default_model_dir(), threads=1)  # tag 2026-10-19 — usato SOLO da upsert_file (reindex)
