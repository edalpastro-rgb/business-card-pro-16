// V50.z186 — Sessione audio per la conversazione vocale con AxonOS (modulo isolato).
// Registrazione + riproduzione che continuano quando l'app va in background o lo schermo si blocca:
//   • iOS: UIBackgroundModes "audio" (plugin expo-audio `enableBackgroundRecording`) + allowsBackgroundRecording
//   • Android: foreground service microfono (plugin) — notifica persistente "Registrazione audio"
//   • shouldPlayInBackground: senza questo flag il lifecycle handler di expo-audio mette in pausa il recorder
// NB: funziona SOLO su build nativa (APK/IPA), non in Expo Go / anteprima web.
import { Platform } from "react-native";
import { AudioModule } from "expo-audio";

let _last: string | null = null;

/** Attiva la sessione voce (registrazione consentita, anche in background). Idempotente. */
export async function ensureVoiceAudioMode(opts?: { recording?: boolean }): Promise<void> {
  if (Platform.OS === "web") return;
  const recording = opts?.recording !== false;
  const key = recording ? "rec" : "play";
  if (_last === key) return;
  try {
    await AudioModule.setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: recording,
      allowsBackgroundRecording: recording,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: "duckOthers",
    } as any);
    _last = key;
  } catch {
    _last = null;
  }
}

/** Da chiamare alla chiusura della chat vocale: riproduzione normale, niente microfono in background. */
export async function releaseVoiceAudioMode(): Promise<void> {
  if (Platform.OS === "web") return;
  _last = null;
  try {
    await AudioModule.setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      allowsBackgroundRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
      interruptionMode: "duckOthers",
    } as any);
  } catch { /* ignore */ }
}
