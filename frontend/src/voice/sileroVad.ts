// sileroVad.ts — V50.z519 — SILERO VAD locale (web) per la modalità vocale di Axon.
// Analizza l'audio SUL DISPOSITIVO (modello ONNX Silero, ~1 MB, eseguito da onnxruntime-web) e distingue la VOCE UMANA dal
// rumore: la registrazione viene inviata al backend SOLO dopo che è stata rilevata voce e la frase è finita. Il modello e il
// runtime sono caricati da CDN alla prima conversazione (nessuna dipendenza npm: il preinstall guard del progetto blocca `yarn add`);
// se il caricamento fallisce (offline, CSP, browser vecchio) si torna al VAD energetico (RMS) già presente.
// Su app nativa (APK/iOS) non c'è accesso al PCM da JS: resta il VAD a metering di expo-audio (anch'esso locale) e il wake word
// on-device di ViolaWake.
import { Platform } from "react-native";

const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort.js";
const VAD_URL = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.19/dist/bundle.min.js";
const VAD_ASSETS = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.19/dist/";
const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/";

let loadP: Promise<any | null> | null = null;

const injectScript = (src: string) => new Promise<void>((resolve, reject) => {
  const d: any = (globalThis as any).document;
  if (!d) { reject(new Error("no document")); return; }
  if (d.querySelector(`script[src="${src}"]`)) { resolve(); return; }
  const el = d.createElement("script"); el.src = src; el.async = true;
  el.onload = () => resolve(); el.onerror = () => reject(new Error(`script load failed: ${src}`));
  d.head.appendChild(el);
});

/** Carica (una volta) onnxruntime-web + @ricky0123/vad-web. Ritorna l'oggetto `vad` globale oppure null. */
export function loadSileroVad(): Promise<any | null> {
  if (Platform.OS !== "web") return Promise.resolve(null);
  if (!loadP) {
    loadP = (async () => {
      try {
        await injectScript(ORT_URL);
        await injectScript(VAD_URL);
        const vad = (globalThis as any).vad;
        return vad?.MicVAD ? vad : null;
      } catch (e) {
        console.warn("[silero-vad] non disponibile, uso VAD energetico:", e);
        return null;
      }
    })();
  }
  return loadP;
}

export type SileroGate = { destroy: () => void };

/**
 * Avvia Silero sullo stream del microfono. `onSpeech(true)` quando inizia voce umana, `onSpeech(false)` a fine frase.
 * Ritorna null se Silero non è disponibile (il chiamante usa il VAD RMS).
 */
export async function startSileroGate(stream: MediaStream, onSpeech: (speaking: boolean) => void): Promise<SileroGate | null> {
  const vad = await loadSileroVad();
  if (!vad) return null;
  try {
    const mic = await vad.MicVAD.new({
      stream,
      baseAssetPath: VAD_ASSETS,
      onnxWASMBasePath: ORT_WASM,
      positiveSpeechThreshold: 0.6,  // probabilità Silero sopra cui è "voce"
      negativeSpeechThreshold: 0.35, // sotto cui è "silenzio" (isteresi)
      redemptionFrames: 6,           // ~0,2 s di tolleranza prima di chiudere la frase
      minSpeechFrames: 3,            // ignora i colpi brevissimi (porta, tosse)
      preSpeechPadFrames: 2,
      onSpeechStart: () => onSpeech(true),
      onSpeechEnd: () => onSpeech(false),
      onVADMisfire: () => onSpeech(false),
    });
    mic.start();
    return { destroy: () => { try { mic.pause(); } catch { /* noop */ } try { mic.destroy?.(); } catch { /* noop */ } } };
  } catch (e) {
    console.warn("[silero-vad] avvio fallito, uso VAD energetico:", e);
    return null;
  }
}
