// driveSettings.ts — V50.z495 — Axon Drive: modalità audio scelta dall'utente, memorizzata per le sessioni successive.
import AsyncStorage from "@react-native-async-storage/async-storage";

export type DriveAudioMode = "tap" | "always";
export const DRIVE_MODE_KEY = "axon_drive_audio_mode_v1";
/** Silenzio dopo cui il comando parte da solo (entrambe le modalità). */
export const DRIVE_SILENCE_MS = 1600;
/** Nessuna parola per questo tempo → l'ascolto si chiude senza inviare nulla. */
export const DRIVE_NO_SPEECH_MS = 9000;
/** Inattività dopo una risposta prima di tornare ai comandi suggeriti. */
export const DRIVE_IDLE_RESET_MS = 5000;

export async function loadDriveMode(): Promise<DriveAudioMode> {
  try {
    const v = await AsyncStorage.getItem(DRIVE_MODE_KEY);
    return v === "always" ? "always" : "tap";
  } catch {
    return "tap";
  }
}

export async function saveDriveMode(mode: DriveAudioMode): Promise<void> {
  try { await AsyncStorage.setItem(DRIVE_MODE_KEY, mode); } catch { /* ignore */ }
}

// V50.z500 — «Cosa puoi dirmi» chiuso con la X → non si mostra più nelle sessioni successive
export const DRIVE_SUGGESTIONS_HIDDEN_KEY = "axon_drive_suggestions_hidden_v1";
export async function loadSuggestionsHidden(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(DRIVE_SUGGESTIONS_HIDDEN_KEY)) === "1"; } catch { return false; }
}
export async function saveSuggestionsHidden(v: boolean): Promise<void> {
  try { await AsyncStorage.setItem(DRIVE_SUGGESTIONS_HIDDEN_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}
