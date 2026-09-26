// V50.z315 — ViolaWake SDK: motore wake-word NATIVO (Picovoice Porcupine, 100% offline).
// L'audio NON lascia mai il telefono: Porcupine analizza il microfono in locale e chiama onWake
// solo quando sente la parola. Servono: EXPO_PUBLIC_PICOVOICE_ACCESS_KEY + file .ppn «Axon»
// (assets/keywords/viola_android.ppn e viola_ios.ppn, copiati dal plugin plugins/withViolaWake.js).
// Senza i .ppn si usa la parola di fallback integrata («Jarvis») così il flusso è comunque provabile.
import { Platform } from "react-native";
import { PorcupineManager, BuiltInKeywords } from "@picovoice/porcupine-react-native";
import type { WakeEngine, WakeEngineOptions } from "./types";
import { VIOLA_FALLBACK_KEYWORD_LABEL, VIOLA_KEYWORD_LABEL } from "./types";
import { createSpeechWakeEngine } from "./speechWakeEngine.native"; // V50.z341 — fallback senza Picovoice
import { WakeWord } from "./wakeWord"; // V50.z377 — motore Axon custom (AudioRecord nativo + TemporalCNN onnx)

export const WAKE_ENGINE_SUPPORTED = true;

/** V50.z377 — Motore wake-word Axon: WakeWord.start()/stop() + onWake → opts.onWake (anche da «Simula rilevamento»). */
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

const CUSTOM_KEYWORD_PATH = Platform.OS === "android" ? "viola_android.ppn" : "ViolaWakeModels/viola_ios.ppn";
// «Axon» → Porcupine richiede il modello lingua IT (assets/keywords/porcupine_params_it.pv, copiato dal plugin)
const IT_MODEL_PATH = Platform.OS === "android" ? "porcupine_params_it.pv" : "ViolaWakeModels/porcupine_params_it.pv";

export function createWakeEngine(opts: WakeEngineOptions): WakeEngine {
  // V50.z377 — DEFAULT: modello Axon custom (TemporalCNN, Job #253) su streaming nativo AudioRecord, 100% offline, nessuna chiave.
  // Fallback (iOS / build senza modulo nativo): Porcupine se c'è la AccessKey, altrimenti riconoscimento vocale di sistema.
  if (WakeWord.isAvailable()) return createAxonWakeEngine(opts);
  // V50.z341 — Senza AccessKey Picovoice → riconoscimento vocale di sistema in ascolto continuo («Axon» nella trascrizione).
  // Appena la chiave viene inserita (EXPO_PUBLIC_PICOVOICE_ACCESS_KEY) l'app torna automaticamente a Porcupine (offline).
  if (!opts.accessKey) return createSpeechWakeEngine(opts);
  let manager: PorcupineManager | null = null;
  let lastWake = 0;
  let keywordLabel = opts.keywordMode === "custom" ? VIOLA_KEYWORD_LABEL : VIOLA_FALLBACK_KEYWORD_LABEL;

  const onDetect = () => {
    const now = Date.now();
    if (now - lastWake < 1500) return; // anti-doppio trigger
    lastWake = now;
    opts.onWake();
  };
  const onProcError = (e: unknown) => opts.onError(String((e as any)?.message || e));

  const build = async () => {
    if (opts.keywordMode === "custom") {
      try {
        return await PorcupineManager.fromKeywordPaths(opts.accessKey, [CUSTOM_KEYWORD_PATH], onDetect, onProcError, IT_MODEL_PATH, undefined, [opts.sensitivity]);
      } catch (e: any) {
        // .ppn assente o non valido → fallback alla parola integrata
        keywordLabel = VIOLA_FALLBACK_KEYWORD_LABEL;
        opts.onError(`Modello «Axon» non trovato (${String(e?.message || e).slice(0, 80)}). Uso la parola di prova «${VIOLA_FALLBACK_KEYWORD_LABEL}».`);
      }
    }
    return PorcupineManager.fromBuiltInKeywords(opts.accessKey, [BuiltInKeywords.JARVIS], onDetect, onProcError, undefined, undefined, [opts.sensitivity]);
  };

  return {
    get keywordLabel() { return keywordLabel; },
    async start() {
      if (manager) return;
      manager = await build();
      await manager.start();
    },
    async stop() {
      const m = manager;
      manager = null;
      if (!m) return;
      try { await m.stop(); } catch { /* già fermo */ }
      try { m.delete(); } catch { /* già rilasciato */ }
    },
  };
}
