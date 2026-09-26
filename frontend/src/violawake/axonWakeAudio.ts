// axonWakeAudio.ts — V50.z377 — Ponte JS ↔ modulo nativo Android «AxonWakeAudio» (plugins/withAxonWakeAudio.js):
// streaming PCM16 16 kHz a blocchi di 80 ms (1280 campioni). Assente su iOS / Expo Go / web → AXON_WAKE_AUDIO_AVAILABLE = false.
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type Native = { start: (sampleRate: number, chunkSamples: number) => Promise<boolean>; stop: () => Promise<boolean>; isRunning: () => Promise<boolean> };
const native: Native | undefined = Platform.OS === "android" ? (NativeModules as any).AxonWakeAudio : undefined;

export const AXON_WAKE_AUDIO_AVAILABLE = !!native;
export const WAKE_SAMPLE_RATE = 16000;
export const WAKE_CHUNK_SAMPLES = 1280; // 80 ms

export type AudioChunk = { pcm: Int16Array; rms: number; dbfs: number };

const emitter = native ? new NativeEventEmitter((NativeModules as any).AxonWakeAudio) : null;

function decodePcm(b64: string): Int16Array {
  const bin = globalThis.atob ? globalThis.atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

export function startAudioStream(onChunk: (c: AudioChunk) => void, onError: (msg: string) => void): { stop: () => Promise<void> } | null {
  if (!native || !emitter) return null;
  const s1 = emitter.addListener("AxonWakeAudioChunk", (e: { pcm: string; rms: number; dbfs: number }) => {
    try { onChunk({ pcm: decodePcm(e.pcm), rms: e.rms, dbfs: e.dbfs }); } catch (err: any) { onError(String(err?.message || err)); }
  });
  const s2 = emitter.addListener("AxonWakeAudioError", (e: { message?: string }) => onError(e?.message || "errore audio"));
  native.start(WAKE_SAMPLE_RATE, WAKE_CHUNK_SAMPLES).catch((e: any) => onError(String(e?.message || e)));
  return {
    stop: async () => { s1.remove(); s2.remove(); try { await native.stop(); } catch { /* già fermo */ } },
  };
}
