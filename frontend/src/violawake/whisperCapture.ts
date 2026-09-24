// V50.z348 — ViolaWake SDK: stub WEB della cattura Whisper (registratore nativo non disponibile nel browser).
import type { CaptureOptions } from "./types";

export const WHISPER_CAPTURE_SUPPORTED = false;
export type WhisperCaptureResult = { text: string; noiseDb: number | null; durationMs: number };
export async function captureCommandWhisper(_opts: CaptureOptions): Promise<WhisperCaptureResult> { return { text: "", noiseDb: null, durationMs: 0 }; }
export function abortWhisperCapture() { /* noop */ }
