// Corporate Gym — utilità audio isolate per il role-play vocale.
// Registrazione: web → MediaRecorder; native → expo-audio (AudioRecorder passato dal componente).
// Riproduzione: web → <audio>; native → expo-audio createAudioPlayer (fine tramite playbackStatusUpdate).
import { Platform, Linking } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { AudioModule, createAudioPlayer, type AudioRecorder } from "expo-audio";

export type RecordedAudio = { b64: string; mime: string };

export type MicPermissionState = "granted" | "denied" | "blocked" | "undetermined";

/** Stato permesso microfono (senza richiederlo). */
export async function getMicPermission(): Promise<MicPermissionState> {
  if (Platform.OS === "web") {
    try {
      const nav: any = globalThis.navigator;
      if (!nav?.mediaDevices?.getUserMedia) return "blocked";
      if (nav.permissions?.query) {
        const st = await nav.permissions.query({ name: "microphone" as any });
        if (st.state === "granted") return "granted";
        if (st.state === "denied") return "blocked";
      }
      return "undetermined";
    } catch {
      return "undetermined";
    }
  }
  try {
    const p = await AudioModule.getRecordingPermissionsAsync();
    if (p.granted) return "granted";
    return p.canAskAgain ? (p.status === "undetermined" ? "undetermined" : "denied") : "blocked";
  } catch {
    return "undetermined";
  }
}

/** Richiede il permesso (da chiamare SOLO dopo un'azione esplicita dell'utente). */
export async function requestMicPermission(): Promise<MicPermissionState> {
  if (Platform.OS === "web") {
    try {
      const stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return "granted";
    } catch {
      return "blocked";
    }
  }
  try {
    const p = await AudioModule.requestRecordingPermissionsAsync();
    if (p.granted) return "granted";
    return p.canAskAgain ? "denied" : "blocked";
  } catch {
    return "denied";
  }
}

export function openAppSettings() {
  if (Platform.OS !== "web") Linking.openSettings?.();
}

// ---------------- Registrazione ----------------
let webRecorder: any = null;
let webChunks: Blob[] = [];
let webStream: MediaStream | null = null;
let webAnalyser: any = null; let webCtx: any = null; let webBuf: Uint8Array | null = null;

/** V50.z366 — livello voce istantaneo in dB (≈ -60 silenzio … 0 massimo) durante la registrazione; null se non disponibile. */
export function getLiveLevelDb(native: AudioRecorder | null): number | null {
  if (Platform.OS === "web") {
    if (!webStream) return null;
    try {
      if (!webAnalyser) {
        const AC: any = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
        if (!AC) return null;
        webCtx = new AC(); const src = webCtx.createMediaStreamSource(webStream);
        webAnalyser = webCtx.createAnalyser(); webAnalyser.fftSize = 512; src.connect(webAnalyser);
        webBuf = new Uint8Array(webAnalyser.fftSize);
      }
      webAnalyser.getByteTimeDomainData(webBuf!);
      let sum = 0; for (let i = 0; i < webBuf!.length; i++) { const v = (webBuf![i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / webBuf!.length);
      return rms > 0 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
    } catch { return null; }
  }
  if (!native) return null;
  try { const st: any = native.getStatus(); return typeof st?.metering === "number" ? Math.max(-60, st.metering) : null; } catch { return null; }
}

export async function startRecording(native: AudioRecorder | null): Promise<void> {
  if (Platform.OS === "web") {
    const MR: any = (globalThis as any).MediaRecorder;
    if (!MR) throw new Error("Registrazione non supportata su questo browser");
    webStream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
    let mimeType = "audio/webm;codecs=opus";
    if (MR.isTypeSupported && !MR.isTypeSupported(mimeType)) {
      mimeType = MR.isTypeSupported("audio/webm") ? "audio/webm" : MR.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    }
    webChunks = [];
    webRecorder = mimeType ? new MR(webStream, { mimeType }) : new MR(webStream);
    webRecorder.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size > 0) webChunks.push(ev.data); };
    webRecorder.start(250);
    return;
  }
  if (!native) throw new Error("Recorder non disponibile");
  await AudioModule.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
  await native.prepareToRecordAsync({ isMeteringEnabled: true }); // V50.z366 — metering per il tono in tempo reale
  native.record();
}

export async function stopRecording(native: AudioRecorder | null): Promise<RecordedAudio | null> {
  if (Platform.OS === "web") {
    const rec = webRecorder;
    webRecorder = null;
    if (!rec) return null;
    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(webChunks, { type: rec.mimeType || "audio/webm" }));
      try { rec.stop(); } catch { resolve(new Blob(webChunks, { type: "audio/webm" })); }
    });
    try { webStream?.getTracks().forEach((t) => t.stop()); } catch {}
    webStream = null;
    try { webCtx?.close?.(); } catch {}
    webAnalyser = null; webCtx = null; webBuf = null;
    if (blob.size < 1024) return null;
    const b64: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(String(fr.result || "").split(",")[1] || "");
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    return b64 ? { b64, mime: blob.type || "audio/webm" } : null;
  }
  if (!native) return null;
  await native.stop();
  // Torna in modalità riproduzione (altoparlante) per la voce del cliente
  try { await AudioModule.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); } catch {}
  const uri = native.uri;
  if (!uri) return null;
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
  if (!b64 || b64.length < 500) return null;
  return { b64, mime: "audio/m4a" };
}

// ---------------- Riproduzione ----------------
let currentStop: (() => void) | null = null;

export function stopPlayback() {
  try { currentStop?.(); } catch {}
  currentStop = null;
}

/** Riproduce un audio base64 e risolve quando finisce (o dopo stop). */
export function playBase64(b64: string, mime = "audio/mpeg"): Promise<void> {
  stopPlayback();
  const uri = `data:${mime};base64,${b64}`;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; currentStop = null; resolve(); } };
    if (Platform.OS === "web") {
      const audio = new Audio(uri);
      audio.addEventListener("ended", finish, { once: true });
      audio.addEventListener("error", finish, { once: true });
      currentStop = () => { try { audio.pause(); } catch {} finish(); };
      audio.play().catch(finish);
      return;
    }
    try {
      const player = createAudioPlayer({ uri }, { updateInterval: 200 });
      const sub = player.addListener("playbackStatusUpdate", (st: any) => {
        if (st?.didJustFinish) { try { sub.remove(); player.remove(); } catch {} finish(); }
      });
      currentStop = () => { try { player.pause(); sub.remove(); player.remove(); } catch {} finish(); };
      player.play();
      // Sicurezza: se nessun evento di fine entro 60s, sblocca
      setTimeout(() => { if (!done) currentStop?.(); }, 60000);
    } catch {
      finish();
    }
  });
}
