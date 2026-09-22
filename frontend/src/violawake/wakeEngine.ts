// V50.z315 — ViolaWake SDK: su WEB (e in Expo Go) il motore wake-word nativo non esiste.
// Questo file viene scelto da Metro al posto di wakeEngine.native.ts: nessun import nativo.
import type { WakeEngine, WakeEngineOptions } from "./types";
import { VIOLA_KEYWORD_LABEL } from "./types";

export const WAKE_ENGINE_SUPPORTED = false;

export function createWakeEngine(opts: WakeEngineOptions): WakeEngine {
  return {
    keywordLabel: VIOLA_KEYWORD_LABEL,
    async start() {
      opts.onError("ViolaWake richiede la build nativa (APK/IPA): non disponibile su web o Expo Go.");
    },
    async stop() { /* nulla da fermare */ },
  };
}
