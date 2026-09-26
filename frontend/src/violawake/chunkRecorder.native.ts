// chunkRecorder.native.ts — V50.z372 — Registrazione a SPEZZONI per l'impronta vocale (iOS/Android: expo-audio).
// Ogni spezzone = un file m4a autonomo: stop → base64 → nuovo registratore. Pausa tra spezzoni ~150 ms.
import { AudioModule, RecordingPresets } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import type { ChunkRecorder } from "./chunkRecorder";

export type { ChunkRecorder } from "./chunkRecorder";
export const CHUNK_RECORDER_SUPPORTED = true;

export function createChunkRecorder(): ChunkRecorder {
  let rec: any = null; let running = false;
  const newRec = async () => {
    rec = new AudioModule.AudioRecorder({ ...RecordingPresets.HIGH_QUALITY, sampleRate: 16000, numberOfChannels: 1, bitRate: 64000, isMeteringEnabled: true });
    await rec.prepareToRecordAsync();
    rec.record();
  };
  const closeRec = async (): Promise<{ base64: string; mime: string } | null> => {
    if (!rec) return null;
    const r = rec; rec = null;
    try {
      await r.stop();
      const uri: string | null = r.uri || null;
      if (!uri) return null;
      const info: any = await FileSystem.getInfoAsync(uri);
      if (!info?.exists || (info.size || 0) < 2000) { FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); return null; }
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      return { base64, mime: "audio/m4a" };
    } catch { return null; } finally { try { r.release?.(); } catch { /* noop */ } }
  };
  return {
    start: async () => {
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      running = true;
      await newRec();
    },
    cut: async () => { const out = await closeRec(); if (running) await newRec(); return out; },
    stop: async () => { running = false; return closeRec(); },
    level: () => { try { const st = rec?.getStatus?.(); return typeof st?.metering === "number" ? st.metering : null; } catch { return null; } },
  };
}
