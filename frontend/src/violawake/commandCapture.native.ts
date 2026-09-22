// V50.z315 — ViolaWake SDK: cattura del COMANDO dopo la wake-word con il riconoscimento vocale
// del telefono (Apple / Google, on-device quando disponibile): nessun costo, nessun credito,
// l'audio resta sul dispositivo. Fallback Whisper (cloud, solo dopo la wake-word) gestito dal provider.
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import type { CaptureOptions, PermissionStatus } from "./types";

export const CAPTURE_SUPPORTED = true;

export async function getMicPermission(): Promise<PermissionStatus> {
  const p = await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync();
  return { granted: !!p.granted, canAskAgain: p.canAskAgain !== false };
}

export async function requestMicPermission(): Promise<PermissionStatus> {
  const p = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
  return { granted: !!p.granted, canAskAgain: p.canAskAgain !== false };
}

/** iOS chiede anche il permesso «Riconoscimento vocale»; su Android è compreso nel microfono. */
export async function requestRecognizerPermission(): Promise<PermissionStatus> {
  try {
    const p = await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync();
    return { granted: !!p.granted, canAskAgain: p.canAskAgain !== false };
  } catch {
    return { granted: true, canAskAgain: true };
  }
}

export function recognitionAvailable(): boolean {
  try { return ExpoSpeechRecognitionModule.isRecognitionAvailable(); } catch { return false; }
}

export function supportsOnDevice(): boolean {
  try { return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(); } catch { return false; }
}

/** Ascolta una frase (max `maxSeconds`) e restituisce il testo. Stringa vuota se non ha capito nulla. */
export function captureCommand(opts: CaptureOptions): Promise<string> {
  return new Promise((resolve) => {
    let best = "";
    let done = false;
    const subs: { remove: () => void }[] = [];
    const finish = (text: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subs.forEach((s) => { try { s.remove(); } catch { /* noop */ } });
      resolve(text.trim());
    };
    const timer = setTimeout(() => {
      try { ExpoSpeechRecognitionModule.stop(); } catch { /* noop */ }
      setTimeout(() => finish(best), 600);
    }, Math.max(3, opts.maxSeconds) * 1000);

    subs.push(ExpoSpeechRecognitionModule.addListener("result", (ev: any) => {
      const t = ev?.results?.[0]?.transcript || "";
      if (t) { best = t; opts.onPartial?.(t); }
      if (ev?.isFinal) finish(best);
    }));
    subs.push(ExpoSpeechRecognitionModule.addListener("end", () => finish(best)));
    subs.push(ExpoSpeechRecognitionModule.addListener("error", (ev: any) => {
      // "no-speech" / "aborted" → nessun comando; altri errori → usiamo il parziale
      finish(ev?.error === "no-speech" ? "" : best);
    }));

    try {
      ExpoSpeechRecognitionModule.start({
        lang: "it-IT",
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: supportsOnDevice(),
        addsPunctuation: false,
        maxAlternatives: 1,
      });
    } catch (e) {
      finish("");
    }
  });
}

export function abortCapture() {
  try { ExpoSpeechRecognitionModule.abort(); } catch { /* noop */ }
}
