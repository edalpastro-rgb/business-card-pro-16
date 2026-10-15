"""core/integrity.py — V50.z562 — GUARDIANO DEL NAMESPACE PROTETTO.

I moduli routes/*.py vengono eseguiti nello stesso namespace: un wrapper può ridefinire qualunque funzione. Le funzioni core
sono importate da `core.*`; `check(namespace)` verifica a ogni avvio che i nomi protetti puntino ANCORA agli oggetti del
package core (identità), e `/api/health` espone `core_integrity`. Un deploy che rompe l'integrità viene bloccato dallo smoke gate.
"""
import logging
from typing import Any, Dict, List

from core import drive_retrieval, embedding, response_rules, streaming

_log = logging.getLogger("axon.core.integrity")

# nome nel namespace routes → oggetto core che DEVE essere (identità)
PROTECTED: Dict[str, Any] = {
    "_core_drive_search": drive_retrieval.search,
    "_core_drive_upsert": drive_retrieval.upsert_file,
    "_core_drive_delete": drive_retrieval.delete_file,
    "_core_wants_gme": response_rules.wants_gme_download,
    "_core_llm_self": response_rules.llm_can_answer_without_web,
    "_core_stream_record": streaming.record,
    "_core_stream_stats": streaming.stats,
    "_core_embedder": embedding.embedder,
}
_LAST: Dict[str, Any] = {"ok": None, "violations": []}


def check(namespace: Dict[str, Any]) -> Dict[str, Any]:
    violations: List[str] = []
    for name, obj in PROTECTED.items():
        cur = namespace.get(name)
        if cur is None:
            violations.append(f"{name}: MANCANTE nel namespace")
        elif cur is not obj:
            violations.append(f"{name}: RIDEFINITO da {getattr(cur, '__module__', '?')}")
    ok = not violations
    _LAST.update({"ok": ok, "violations": violations})
    if ok:
        _log.info("[core-integrity] ✔ %d funzioni protette intatte (core %s)", len(PROTECTED), __import__("core").CORE_VERSION)
    else:
        _log.error("[core-integrity] ✘ VIOLAZIONI: %s", "; ".join(violations))
    return {"ok": ok, "violations": violations}


def last() -> Dict[str, Any]:
    return dict(_LAST)
