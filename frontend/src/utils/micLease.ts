// micLease.ts — V50.z483 — «LEASE» DEL MICROFONO: mentre un registratore dell'app (dettatura, nota vocale, Axon Drive,
// allegati audio, chiamate…) sta registrando, l'ascolto continuo della wake-word (Viola/Axon) DEVE restare fermo.
// Prima il riconoscitore vocale di sistema si riavviava da solo dopo ~400-800 ms (speechWakeEngine.scheduleRestart) e si
// riprendeva il microfono: la registrazione dell'utente proseguiva «a vuoto» (silenzio) dopo ~2 secondi.
// Uso: const release = acquireMicLease("dettatura"); … await recorder.stop(); release();
let holders = 0;
const subs = new Set<(busy: boolean) => void>();

export function acquireMicLease(_who?: string): () => void {
  holders += 1;
  if (holders === 1) subs.forEach((f) => { try { f(true); } catch { /* noop */ } });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) subs.forEach((f) => { try { f(false); } catch { /* noop */ } });
  };
}

export function isMicLeased(): boolean { return holders > 0; }

/** Notifica true quando il primo registratore parte, false quando l'ultimo rilascia. */
export function onMicLease(f: (busy: boolean) => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
