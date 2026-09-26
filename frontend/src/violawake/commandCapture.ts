// commandCapture.ts — V50.z370 — WEB (Desktop): cattura del COMANDO dopo «Axon» con il microfono del browser
// (MediaRecorder + soglia di silenzio) → trascrizione Whisper sul server (/viola-wake/transcribe). Permessi via getUserMedia.
import type { CaptureOptions, PermissionStatus } from "./types";
import { api } from "@/src/api";
import { setLastSpeaker } from "@/src/violawake/voiceprintApi";

const nav: any = typeof globalThis !== "undefined" ? (globalThis as any).navigator : null;
const SR: any = typeof globalThis !== "undefined" ? ((globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition) : null;
export const CAPTURE_SUPPORTED = !!(nav?.mediaDevices?.getUserMedia && (globalThis as any).MediaRecorder && SR);

let permState: PermissionStatus = { granted: false, canAskAgain: true };
let current: { stop: () => void } | null = null;

export async function getMicPermission(): Promise<PermissionStatus> {
  try {
    const q = await nav?.permissions?.query?.({ name: "microphone" as any });
    if (q?.state === "granted") permState = { granted: true, canAskAgain: true };
    else if (q?.state === "denied") permState = { granted: false, canAskAgain: false };
  } catch { /* browser senza permissions API: si scopre alla richiesta */ }
  return permState;
}
export async function requestMicPermission(): Promise<PermissionStatus> {
  try {
    const s = await nav.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t: any) => t.stop());
    permState = { granted: true, canAskAgain: true };
  } catch { permState = { granted: false, canAskAgain: false }; }
  return permState;
}
export async function requestRecognizerPermission(): Promise<PermissionStatus> { return requestMicPermission(); }
export function recognitionAvailable(): boolean { return CAPTURE_SUPPORTED; }
export function supportsOnDevice(): boolean { return false; }

export function captureCommand(opts: CaptureOptions): Promise<string> {
  return new Promise(async (resolve) => {
    let done = false; let stream: any = null; let rec: any = null; let ctx: any = null; let poll: any = null; let hard: any = null;
    const chunks: Blob[] = [];
    const finish = async (transcribe: boolean) => {
      if (done) return; done = true; current = null;
      if (poll) clearInterval(poll); if (hard) clearTimeout(hard);
      try {
        const blob: Blob = await new Promise((res) => { if (!rec || rec.state === "inactive") return res(new Blob(chunks, { type: "audio/webm" })); rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || "audio/webm" })); rec.stop(); });
        try { stream?.getTracks().forEach((t: any) => t.stop()); ctx?.close?.(); } catch { /* noop */ }
        if (!transcribe || blob.size < 2000) return resolve("");
        opts.onPartial?.("…");
        const b64: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(blob); });
        const r = await api<{ transcript: string; speaker?: any; reason?: string }>("/viola-wake/transcribe", { method: "POST", body: { audio_base64: b64, mime: blob.type || "audio/webm" } });
        setLastSpeaker(r?.speaker, r?.reason === "unknown_voice"); // V50.z372 — impronta vocale
        resolve((r?.transcript || "").trim());
      } catch { resolve(""); }
    };
    try {
      stream = await nav.mediaDevices.getUserMedia({ audio: true });
      permState = { granted: true, canAskAgain: true };
      const MR: any = (globalThis as any).MediaRecorder;
      rec = new MR(stream); rec.ondataavailable = (e: any) => { if (e.data?.size) chunks.push(e.data); }; rec.start(250);
      current = { stop: () => { void finish(false); } };
      hard = setTimeout(() => { void finish(true); }, Math.max(3, opts.maxSeconds) * 1000);
      // soglia di silenzio: baseline 350 ms, voce = baseline + 6 dB, stop dopo 900 ms di silenzio
      const AC: any = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
      if (AC) {
        ctx = new AC(); const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize); const t0 = Date.now(); const base: number[] = []; let noise: number | null = null; let spoke = false; let lastLoud = 0;
        poll = setInterval(() => {
          an.getByteTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const db = Math.max(-60, 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6)); const el = Date.now() - t0;
          if (el < 350) { base.push(db); return; }
          if (noise == null) noise = base.length ? base.reduce((a, b) => a + b, 0) / base.length : -60;
          if (db > Math.max(-45, noise + 6)) { if (!spoke) { spoke = true; opts.onPartial?.("Ti ascolto…"); } lastLoud = Date.now(); }
          else if (spoke && Date.now() - lastLoud > 900) void finish(true);
          else if (!spoke && el > 3500) void finish(false);
        }, 100);
      }
    } catch { permState = { granted: false, canAskAgain: false }; void finish(false); }
  });
}
export function abortCapture() { try { current?.stop(); } catch { /* noop */ } }
