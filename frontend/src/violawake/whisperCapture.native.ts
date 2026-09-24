// V50.z348 — ViolaWake SDK: cattura del COMANDO robusta al rumore (traffico, metro, esterni).
// Registra con expo-audio (metering attivo) e decide da solo quando l'utente ha finito di parlare:
//   • primi 350 ms → misura il rumore di fondo (baseline dBFS);
//   • «parlato» = livello > baseline + 6 dB (soglia adattiva: in metro il fondo è alto, la soglia sale);
//   • stop dopo 900 ms di silenzio relativo successivo al parlato, oppure allo scadere di maxSeconds.
// L'audio va al backend /viola-wake/transcribe (Whisper con vocabolario Axon + filtro allucinazioni/no-speech).
import { AudioModule, RecordingPresets } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import type { CaptureOptions } from "./types";

export const WHISPER_CAPTURE_SUPPORTED = true;

const BASELINE_MS = 350;
const SPEECH_DELTA_DB = 6;
const MIN_SPEECH_DB = -45;          // sotto questo livello non è mai «voce» (evita trigger su respiro/fruscio)
const TRAILING_SILENCE_MS = 900;
const NO_SPEECH_GIVEUP_MS = 3500;   // nessuna voce dopo la wake-word → rinuncia
const POLL_MS = 100;

let current: { stop: () => void } | null = null;

export type WhisperCaptureResult = { text: string; noiseDb: number | null; durationMs: number };

export function captureCommandWhisper(opts: CaptureOptions): Promise<WhisperCaptureResult> {
  return new Promise(async (resolve) => {
    let rec: any = null;
    let done = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let hard: ReturnType<typeof setTimeout> | null = null;
    const baseline: number[] = [];
    let noiseDb: number | null = null;
    let spoke = false;
    let lastLoud = 0;
    let startedAt = 0;

    const finish = async (transcribe: boolean) => {
      if (done) return;
      done = true;
      if (poll) clearInterval(poll);
      if (hard) clearTimeout(hard);
      current = null;
      let text = "";
      const durationMs = startedAt ? Date.now() - startedAt : 0;
      try {
        await rec?.stop();
        const uri: string | null = rec?.uri || null;
        if (transcribe && uri && spoke) {
          opts.onPartial?.("…");
          const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          const r = await api<{ transcript: string }>("/viola-wake/transcribe", { method: "POST", body: { audio_base64: b64, mime: "audio/m4a", noise_db: noiseDb } });
          text = (r?.transcript || "").trim();
        }
        if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      } catch { /* niente testo → il provider dice «non ho capito» */ }
      try { rec?.release?.(); } catch { /* noop */ }
      resolve({ text, noiseDb, durationMs });
    };

    try {
      rec = new AudioModule.AudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
      await rec.prepareToRecordAsync();
      rec.record();
      startedAt = Date.now();
      current = { stop: () => { void finish(false); } };
      hard = setTimeout(() => { void finish(true); }, Math.max(3, opts.maxSeconds) * 1000);
      poll = setInterval(() => {
        if (done) return;
        let st: any = null;
        try { st = rec.getStatus(); } catch { return; }
        const db = typeof st?.metering === "number" ? st.metering : null;
        if (db == null) return; // metering non disponibile → si affida al timeout massimo
        const elapsed = Date.now() - startedAt;
        if (elapsed < BASELINE_MS) { baseline.push(db); return; }
        if (noiseDb == null) noiseDb = baseline.length ? baseline.reduce((a, b) => a + b, 0) / baseline.length : -60;
        const threshold = Math.max(MIN_SPEECH_DB, noiseDb + SPEECH_DELTA_DB);
        if (db > threshold) {
          if (!spoke) { spoke = true; opts.onPartial?.("Ti ascolto…"); }
          lastLoud = Date.now();
        } else if (spoke && Date.now() - lastLoud > TRAILING_SILENCE_MS) {
          void finish(true);
        } else if (!spoke && elapsed > NO_SPEECH_GIVEUP_MS) {
          void finish(false);
        }
      }, POLL_MS);
    } catch {
      void finish(false);
    }
  });
}

export function abortWhisperCapture() {
  try { current?.stop(); } catch { /* noop */ }
}
