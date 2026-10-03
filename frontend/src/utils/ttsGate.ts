// V50.z453 — KILL-SWITCH GLOBALE TTS: con «Solo testo» attivo NESSUN audio da nessun percorso
// (SentenceSpeaker, playAudioBase64, deviceTtsSpeak, ViolaWake, cache, tasto play…). Unica eccezione: `force` (test voce nelle Impostazioni).
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "axon_tts_muted_v1";
let muted = false;
let loaded = false;

export function isTtsMuted(): boolean { return muted; }
/** true = la sintesi vocale è consentita (modalità voce/entrambi). false = «Solo testo»: NESSUN audio, nessuna eccezione. */
export function isTtsMode(): boolean { return !muted; }
/** Sincronizza il gate dalla modalità risposta salvata nelle impostazioni ("text" | "voice" | "both"). */
export function syncTtsModeFromSetting(mode: string | undefined | null): void { setTtsMuted((mode || "text") === "text"); }

export function setTtsMuted(v: boolean): void {
  muted = v; loaded = true;
  AsyncStorage.setItem(KEY, v ? "1" : "0").catch(() => {});
}

/** Da chiamare all'avvio (prima che la chat carichi le impostazioni): ripristina l'ultimo stato noto. */
export async function loadTtsMuted(): Promise<boolean> {
  if (loaded) return muted;
  try { const v = await AsyncStorage.getItem(KEY); if (v === "1") muted = true; } catch {}
  loaded = true;
  return muted;
}
