// paywallEvents.ts — V50.z330 — emitter senza dipendenze (evita import circolare api.ts ↔ paywall.ts)
const listeners = new Set<() => void>();
export function onSubscriptionExpired(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function emitSubscriptionExpired(): void { listeners.forEach((l) => { try { l(); } catch {} }); }
