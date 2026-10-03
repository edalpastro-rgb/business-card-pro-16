// V50.z311 — estratto da AssistantChat.tsx (nessuna modifica logica)
import { Platform } from "react-native";
import { acquireAudio } from "@/src/utils/audioMutex";
import { isTtsMuted } from "@/src/utils/ttsGate"; // V50.z453 // V50.z385 — una sola voce alla volta

/**
 * Cross-platform audio player. Uses <audio> on web, expo-audio on native.
 * Returns a cleanup function. Calls onEnded when playback naturally completes.
 * V50.z284 — la funzione restituita espone anche `.pause()` / `.resume()` (pausa/riprendi senza perdere la posizione).
 */
export type AudioStopper = (() => void) & { pause?: () => void; resume?: () => void };
export async function playAudioBase64(
  b64: string,
  mime: string = "audio/mpeg",
  onEnded?: () => void,
  opts?: { force?: boolean }
): Promise<AudioStopper> {
  if (isTtsMuted() && !opts?.force) {  // V50.z453 — «Solo testo»: zero audio, qualunque sia il chiamante
    try { onEnded?.(); } catch {}
    const noop: AudioStopper = () => {}; noop.pause = () => {}; noop.resume = () => {}; return noop;
  }
  // V50.z385 — mutex globale: ferma SEMPRE l'audio precedente prima di partire (qualunque percorso lo abbia avviato)
  let hardStop: () => void = () => {};
  const release = acquireAudio(() => hardStop());
  if (Platform.OS === "web") {
    const dataUri = `data:${mime};base64,${b64}`;
    const audio = new Audio(dataUri);
    let webEnded = false;
    audio.addEventListener("ended", () => { if (webEnded) return; webEnded = true; release(); try { onEnded?.(); } catch {} }, { once: true });
    audio.addEventListener("error", () => { if (webEnded) return; webEnded = true; release(); try { onEnded?.(); } catch {} }, { once: true });
    hardStop = () => { webEnded = true; release(); try { audio.pause(); } catch {} };
    try { await audio.play(); } catch { hardStop(); try { onEnded?.(); } catch {} }
    const stopper: AudioStopper = () => { hardStop(); };
    stopper.pause = () => { try { audio.pause(); } catch {} };
    stopper.resume = () => { try { void audio.play(); } catch {} };
    return stopper;
  }
  // Native — dynamic import so web bundle doesn't try to load it
  try {
    const AudioMod: any = await import("expo-audio");
    const { createAudioPlayer } = AudioMod;
    const player = createAudioPlayer({ uri: `data:${mime};base64,${b64}` });
    let ended = false;
    let sub: any = null;
    let safety: any = null;
    let safetyDeadline = 0;
    const finish = () => {
      if (ended) return;
      ended = true;
      try { sub?.remove?.(); } catch {}
      if (safety) clearTimeout(safety);
      release();
      try { onEnded?.(); } catch {}
    };
    // V50.z385 — fine REALE dell'audio (didJustFinish) su ogni riproduzione; il timer stimato è SOLO l'ultima risorsa
    // (2× la durata stimata + 5 s) e quando scatta ferma davvero il player, così non può sovrapporsi al successivo.
    try { sub = player.addListener?.("playbackStatusUpdate", (s: any) => { if (s?.didJustFinish) finish(); }); } catch {}
    const bytes = (b64.length * 3) / 4;
    const estMs = Math.max(6000, (bytes * 8 / 24000) * 1000 * 2 + 5000); // ~24 kbps mp3 TTS, margine 100% + 5 s
    safetyDeadline = Date.now() + estMs;
    const safetyFire = () => { try { player.pause?.(); } catch {} try { player.release?.(); } catch {} finish(); };
    safety = setTimeout(safetyFire, estMs);
    hardStop = () => {
      ended = true;
      try { sub?.remove?.(); } catch {}
      if (safety) clearTimeout(safety);
      release();
      try { player.pause?.(); } catch {}
      try { player.release?.(); } catch {}
    };
    try { player.play(); } catch { finish(); }
    const stopper: AudioStopper = () => { hardStop(); };
    // pausa/riprendi: il timer di sicurezza viene sospeso in pausa e ripristinato alla ripresa
    let pausedAt: number | null = null;
    let safetyLeft = 0;
    stopper.pause = () => {
      if (ended || pausedAt !== null) return;
      pausedAt = Date.now();
      if (safety) { clearTimeout(safety); safetyLeft = Math.max(1000, safetyDeadline - Date.now()); safety = null; }
      try { player.pause?.(); } catch {}
    };
    stopper.resume = () => {
      if (ended || pausedAt === null) return;
      pausedAt = null;
      if (safetyLeft > 0) { safetyDeadline = Date.now() + safetyLeft; safety = setTimeout(safetyFire, safetyLeft); }
      try { player.play?.(); } catch {}
    };
    return stopper;
  } catch {
    release();
    return () => {};
  }
}
