"""backend/core — V50.z562 — MODULO PROTETTO (Accordo di produzione V1423+).

Qui vivono le logiche core che NON possono essere ridefinite dai moduli `routes/*.py` (che condividono un unico namespace
exec): embedding locale, regole di risposta (regex di classificazione), retrieval semantico Drive (ChromaDB), telemetria
dello streaming (TTFT p50/p95) e il guardiano d'integrità. È un package Python normale (importabile anche dai test senza
avviare il server). Le routes lo usano con `from core.<modulo> import …`; i wrapper possono solo *aggiungere* comportamento
tramite `core.hooks`, mai sostituire queste funzioni (verificato a ogni avvio da `core.integrity.check()`).
"""
CORE_VERSION = "V50.z562"
