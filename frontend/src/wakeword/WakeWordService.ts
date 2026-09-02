/**
 * V50.x — WakeWord Service (JS API layer)
 *
 * Espone un'API pulita per il resto dell'app:
 *   WakeWordService.start()    → attiva ascolto continuo
 *   WakeWordService.stop()     → disattiva
 *   WakeWordService.isRunning  → stato corrente
 *   WakeWordService.onWake(cb) → sottoscrizione all'evento "detected"
 *
 * Implementazione attuale:
 *   • Modalità MOCK (JS-only): permette di testare il flusso end-to-end
 *     dell'app SENZA il modulo nativo. Un pulsante "Simula rilevamento"
 *     nella schermata Wake Word emette manualmente un evento.
 *   • Modalità NATIVE: sarà collegata al modulo Android/iOS nella
 *     prossima sessione di sviluppo. Interfaccia già preparata.
 *
 * Quando arriverà il modulo nativo, dovrà esporre:
 *   - NativeModules.WakeWordModule.start(modelPath: string, threshold: number)
 *   - NativeModules.WakeWordModule.stop()
 *   - Emette DeviceEventEmitter event "WakeWordDetected" con { score }
 */
import { DeviceEventEmitter, NativeModules, Platform, EmitterSubscription } from "react-native";

type WakeListener = (payload: { score: number; source: "native" | "mock" }) => void;

const EVENT_NAME = "WakeWordDetected";
const listeners: WakeListener[] = [];
let running = false;
let nativeSub: EmitterSubscription | null = null;

function hasNativeModule(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (NativeModules as any).WakeWordModule;
  return !!mod && typeof mod.start === "function" && typeof mod.stop === "function";
}

export const WakeWordService = {
  get isRunning(): boolean { return running; },

  get hasNativeSupport(): boolean { return hasNativeModule(); },

  async start(opts?: { threshold?: number; modelPath?: string }): Promise<{ mode: "native" | "mock" }> {
    if (running) return { mode: hasNativeModule() ? "native" : "mock" };
    running = true;

    if (hasNativeModule() && Platform.OS !== "web") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (NativeModules as any).WakeWordModule;
      // Sottoscrizione all'evento nativo
      nativeSub = DeviceEventEmitter.addListener(EVENT_NAME, (raw: { score: number }) => {
        const payload = { score: raw?.score ?? 0, source: "native" as const };
        listeners.forEach((l) => { try { l(payload); } catch { /* noop */ } });
      });
      try {
        await mod.start(opts?.modelPath ?? "", opts?.threshold ?? 0.8);
        return { mode: "native" };
      } catch (e) {
        running = false;
        if (nativeSub) { nativeSub.remove(); nativeSub = null; }
        throw e;
      }
    }
    // Mock mode: nessuna operazione, aspetta triggerMock()
    return { mode: "mock" };
  },

  async stop(): Promise<void> {
    if (!running) return;
    running = false;
    if (nativeSub) { nativeSub.remove(); nativeSub = null; }
    if (hasNativeModule() && Platform.OS !== "web") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (NativeModules as any).WakeWordModule.stop();
      } catch { /* noop */ }
    }
  },

  /** Solo modalità mock: simula un rilevamento (usato dal pulsante di test in Impostazioni). */
  triggerMock(score = 0.95) {
    if (!running) return;
    const payload = { score, source: "mock" as const };
    listeners.forEach((l) => { try { l(payload); } catch { /* noop */ } });
  },

  onWake(cb: WakeListener): () => void {
    listeners.push(cb);
    return () => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};
