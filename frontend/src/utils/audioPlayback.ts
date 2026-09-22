// V50.z311 — estratto da AssistantChat.tsx (nessuna modifica logica)
import { Platform } from "react-native";

/**
 * Cross-platform audio player. Uses <audio> on web, expo-audio on native.
 * Returns a cleanup function. Calls onEnded when playback naturally completes.
 * V50.z284 — la funzione restituita espone anche `.pause()` / `.resume()` (pausa/riprendi senza perdere la posizione).
 */
export type AudioStopper = (() => void) & { pause?: () => void; resume?: () => void };
export async function playAudioBase64(
  b64: string,
  mime: string = "audio/mpeg",
  onEnded?: () => void
): Promise<AudioStopper> {
  if (Platform.OS === "web") {
    const dataUri = `data:${mime};base64,${b64}`;
    const audio = new Audio(dataUri);
    if (onEnded) {
      audio.addEventListener("ended", () => { try { onEnded(); } catch {} }, { once: true });
    }
    try { await audio.play(); } catch {}
    const stopper: AudioStopper = () => {
      try { audio.pause(); } catch {}
    };
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
      try { onEnded?.(); } catch {}
    };
    if (onEnded) {
      // V50.z270 — fine REALE dell'audio (didJustFinish); il timer stimato dalla dimensione è solo una rete di sicurezza
      try { sub = player.addListener?.("playbackStatusUpdate", (s: any) => { if (s?.didJustFinish) finish(); }); } catch {}
      const bytes = (b64.length * 3) / 4;
      const estMs = Math.max(4000, (bytes * 8 / 24000) * 1000 * 1.3 + 3000); // ~24 kbps mp3 TTS, margine 30% + 3 s
      safetyDeadline = Date.now() + estMs;
      safety = setTimeout(finish, estMs);
    }
    try { player.play(); } catch {}
    const stopper: AudioStopper = () => {
      ended = true;
      try { sub?.remove?.(); } catch {}
      if (safety) clearTimeout(safety);
      try { player.pause?.(); } catch {}
      try { player.release?.(); } catch {}
    };
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
      if (onEnded && safetyLeft > 0) { safetyDeadline = Date.now() + safetyLeft; safety = setTimeout(finish, safetyLeft); }
      try { player.play?.(); } catch {}
    };
    return stopper;
  } catch {
    return () => {};
  }
}
