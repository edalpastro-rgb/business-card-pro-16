// wakeEngine.native.ts — V50.z378 — Motore wake-word NATIVO «Axon», 100% offline, SENZA Picovoice/Porcupine.
// DEFAULT: streaming AudioRecord (modulo nativo AxonWakeAudio) → pipeline ONNX in JS (assets/wake: melspectrogram → embedding →
// axon.onnx TemporalCNN Job #253) → onWake. L'audio non lascia mai il telefono.
// FALLBACK (iOS / build senza modulo nativo): riconoscimento vocale di sistema in ascolto continuo («Axon» nella trascrizione).
import type { WakeEngine, WakeEngineOptions } from "./types";
import { VIOLA_KEYWORD_LABEL } from "./types";
import { createSpeechWakeEngine } from "./speechWakeEngine.native"; // V50.z341 — fallback senza modulo nativo
import { WakeWord } from "./wakeWord"; // V50.z377 — motore Axon custom (AudioRecord nativo + TemporalCNN onnx)

export const WAKE_ENGINE_SUPPORTED = true;

/** Motore Axon ONNX: WakeWord.start()/stop() + onWake → opts.onWake (anche da «Simula rilevamento»). */
function createAxonWakeEngine(opts: WakeEngineOptions): WakeEngine {
  let unsub: (() => void)[] = [];
  return {
    get keywordLabel() { return VIOLA_KEYWORD_LABEL; },
    async start() {
      if (unsub.length) return;
      unsub = [
        WakeWord.onWake(() => opts.onWake()),
        WakeWord.onError((m) => opts.onError(m)),
      ];
      try { await WakeWord.start({ sensitivity: opts.sensitivity, keywordLabel: VIOLA_KEYWORD_LABEL }); }
      catch (e: any) { unsub.forEach((u) => u()); unsub = []; throw e; }
    },
    async stop() {
      unsub.forEach((u) => u()); unsub = [];
      await WakeWord.stop();
    },
  };
}

export function createWakeEngine(opts: WakeEngineOptions): WakeEngine {
  if (WakeWord.isAvailable()) return createAxonWakeEngine(opts);
  return createSpeechWakeEngine(opts);
}
