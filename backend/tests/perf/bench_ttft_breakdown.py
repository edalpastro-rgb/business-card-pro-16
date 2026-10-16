"""bench_ttft_breakdown.py — V50.z564 — Misura dove vanno i secondi del TTFT: embedding MiniLM (cold/warm),
query ChromaDB (indice sintetico ~600 chunk), primo token LLM (Haiku) con prompt piccolo e grande.
Uso: cd /app/backend && python tests/perf/bench_ttft_breakdown.py
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))

from core import drive_retrieval, embedding  # noqa: E402


def t(label, fn):
    t0 = time.perf_counter()
    r = fn()
    dt = time.perf_counter() - t0
    print(f"{label:<52} {dt*1000:8.0f} ms")
    return r


def bench_retrieval():
    emb = embedding.LocalEmbedder(embedding.default_model_dir())
    print(f"MiniLM disponibile: {emb.available} ({emb.model_dir}); cpu={os.cpu_count()}")
    if not emb.available:
        return
    t("embed COLD (caricamento ONNX + tokenizer + 1 query)", lambda: emb.embed(["potenza impegnata corporate club"]))
    t("embed WARM (1 query)", lambda: emb.embed(["quanto costa il corporate club"]))
    import chromadb
    drive_retrieval.configure(emb.embed, client=chromadb.EphemeralClient())
    txt = " ".join(f"CORPORATE CLUB listino {i} quota annuale {100+i} euro servizi inclusi consulenza energia gas luce" for i in range(40))
    t0 = time.perf_counter()
    n = 0
    for f in range(6):  # 6 file × ~10 chunk ≈ 600 chunk
        n += drive_retrieval.upsert_file("bench", f"f{f}", f"doc_{f}.pdf", "CORPORATE CLUB", txt * 3, "2026-01-01")
    print(f"{'upsert 6 file (' + str(n) + ' chunk) — solo indicizzazione':<52} {(time.perf_counter()-t0)*1000:8.0f} ms")
    t("search WARM (embed query + chroma.query, 600 chunk)", lambda: drive_retrieval.search("bench", "quanto costa il corporate club", 4))
    t("search WARM #2", lambda: drive_retrieval.search("bench", "contratti energia luce", 4))


async def bench_llm():
    _ak = (os.environ.get("ANTHROPIC_API_KEY") or "").strip().strip('"').strip("'")
    key = _ak if _ak.startswith("sk-ant-") else os.environ.get("EMERGENT_LLM_KEY")  # stessa regola di _axon_anthropic_direct_key
    if not key:
        print("LLM: nessuna chiave (ANTHROPIC_API_KEY/EMERGENT_LLM_KEY)"); return
    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta
    big = ("Sei Axon. REGOLE:\n" + "\n".join(f"- regola {i}: rispondi sempre in italiano, cita i file Drive, non inventare dati." for i in range(400))
           + "\n--- File Drive: CORPORATE CLUB/listino.pdf ---\n" + ("CORPORATE CLUB quota annuale 1.200 euro, servizi inclusi: consulenza energia, gas, luce, telefonia. " * 400))
    for label, sysmsg in (("LLM Haiku TTFT — system ~1 KB", "Sei Axon, rispondi in italiano."), (f"LLM Haiku TTFT — system ~{len(big)//1000} KB (≈{len(big)//4} tok)", big)):
        chat = LlmChat(api_key=key, session_id=f"bench-{time.time()}", system_message=sysmsg).with_model("anthropic", "claude-haiku-4-5")
        t0 = time.perf_counter(); first = None; n = 0
        async for ev in chat.stream_message(UserMessage(text="Quanto costa il CORPORATE CLUB? Rispondi in una frase.")):
            if isinstance(ev, TextDelta) and ev.content:
                n += 1
                if first is None:
                    first = time.perf_counter() - t0
        print(f"{label:<52} first={first and first*1000:8.0f} ms  total={(time.perf_counter()-t0)*1000:8.0f} ms  deltas={n}")


if __name__ == "__main__":
    bench_retrieval()
    asyncio.run(bench_llm())
