// axonWakeAudio.ts — V50.z381 — Ponte JS ↔ modulo nativo Android «AxonWakeAudio» (plugins/withAxonWakeAudio.js).
// Tutta l'inferenza (microfono + ONNX) è NATIVA: qui solo start/stop e gli eventi. Nessuna libreria nativa importata a livello
// di modulo oltre a react-native → nessun rischio di crash all'avvio. Assente su iOS / Expo Go / web → AVAILABLE = false.
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type Native = {
  start: (threshold: number, consecutive: number) => Promise<boolean>;
  stop: () => Promise<boolean>;
  isRunning: () => Promise<boolean>;
  setThreshold: (threshold: number, consecutive: number) => void;
};
const native: Native | undefined = Platform.OS === "android" ? (NativeModules as any).AxonWakeAudio : undefined;

export const AXON_WAKE_AUDIO_AVAILABLE = !!native;

export type WakeHandlers = { onWake: (score: number) => void; onScore?: (score: number) => void; onLevel?: (dbfs: number) => void; onError: (msg: string) => void };

export function startNativeWake(threshold: number, consecutive: number, h: WakeHandlers): { stop: () => Promise<void> } | null {
  if (!native) return null;
  const emitter = new NativeEventEmitter((NativeModules as any).AxonWakeAudio);
  const subs = [
    emitter.addListener("AxonWakeDetected", (e: { score: number }) => h.onWake(e?.score ?? 1)),
    emitter.addListener("AxonWakeScore", (e: { score: number }) => h.onScore?.(e?.score ?? 0)),
    emitter.addListener("AxonWakeLevel", (e: { dbfs: number }) => h.onLevel?.(e?.dbfs ?? -96)),
    emitter.addListener("AxonWakeError", (e: { message?: string }) => h.onError(e?.message || "errore audio")),
  ];
  native.start(threshold, consecutive).catch((e: any) => h.onError(String(e?.message || e)));
  return {
    stop: async () => { subs.forEach((s) => s.remove()); try { await native.stop(); } catch { /* già fermo */ } },
  };
}

export function setNativeWakeThreshold(threshold: number, consecutive: number): void { try { native?.setThreshold(threshold, consecutive); } catch { /* noop */ } }

/** Soglia dalla «sensibilità» 0..1 delle impostazioni ViolaWake: 0 → 0.85 (severa) · 0.5 → 0.6 · 1 → 0.35 (permissiva). */
export function thresholdFromSensitivity(sensitivity?: number): number {
  const s = Math.min(1, Math.max(0, sensitivity ?? 0.5));
  return Math.round((0.85 - s * 0.5) * 100) / 100;
}
