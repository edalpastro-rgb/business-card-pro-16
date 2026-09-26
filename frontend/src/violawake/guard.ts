// guard.ts — V50.z371 — Blocco 4: conferma comandi critici con impronta/Face ID (expo-local-authentication) → fallback PIN 6 cifre.
// `confirmCritical(category)` → guard_token monouso (90 s) oppure null se l'utente annulla. Il PIN viene chiesto tramite
// <VoiceGuardSheet/> montato in _layout (store minimale a listener, nessuna dipendenza).
import { Platform } from "react-native";
import { api } from "@/src/api";

type PinRequest = { resolve: (pin: string | null) => void; error?: string | null } | null;
let pending: PinRequest = null;
const listeners = new Set<() => void>();
export const guardStore = {
  get: () => pending,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  set: (p: PinRequest) => { pending = p; listeners.forEach((l) => l()); },
};
const askPin = (error?: string | null) => new Promise<string | null>((resolve) => guardStore.set({ resolve, error: error || null }));

async function biometric(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const LA = await import("expo-local-authentication");
    if (!(await LA.hasHardwareAsync()) || !(await LA.isEnrolledAsync())) return false;
    const r = await LA.authenticateAsync({ promptMessage: "Conferma il comando critico di Axon", cancelLabel: "Usa il PIN", disableDeviceFallback: true });
    return !!r.success;
  } catch { return false; }
}

export async function confirmCritical(category: string = "delete"): Promise<string | null> {
  if (await biometric()) {
    try { const r = await api<{ guard_token: string }>("/voice-guard/biometric-ok", { method: "POST", body: { category } }); return r.guard_token; } catch { /* → PIN */ }
  }
  let err: string | null = null;
  for (let i = 0; i < 3; i++) {
    const pin = await askPin(err);
    if (!pin) return null;
    try { const r = await api<{ guard_token: string }>("/voice-guard/verify", { method: "POST", body: { pin, category } }); return r.guard_token; }
    catch (e: any) { err = e?.message || "PIN errato"; }
  }
  return null;
}
