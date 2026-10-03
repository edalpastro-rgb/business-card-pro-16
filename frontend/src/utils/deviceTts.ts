import { isTtsMuted } from "@/src/utils/ttsGate"; // V50.z453
// deviceTts.ts — V50.z412 — Sintesi vocale «del dispositivo» (motore browser: su Android Chrome = Google TTS it-IT).
// Selezione automatica della voce italiana di qualità più alta: Google it-IT > altre voci it-IT «network/enhanced» > it-IT generica.
// Nell'app nativa (iOS/Android build) il motore di sistema richiede il modulo `expo-speech`, NON installabile in questo
// ambiente (policy piattaforma): lì si usa la sintesi server (Kokoro/OpenAI) in streaming frase per frase.
import { Platform } from "react-native";

type WebVoice = { name: string; lang: string; voiceURI: string; localService: boolean; default: boolean };

let cachedVoice: WebVoice | null | undefined;

export function deviceTtsAvailable(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && !!(window as any).speechSynthesis && typeof (window as any).SpeechSynthesisUtterance !== "undefined";
}

function scoreVoice(v: WebVoice): number {
  const n = `${v.name} ${v.voiceURI}`.toLowerCase();
  let s = 0;
  if (!/^it([-_]|$)/i.test(v.lang)) return -1;
  if (/it[-_]it/i.test(v.lang)) s += 10;
  if (n.includes("google")) s += 50;            // Google TTS (Android Chrome / Chrome desktop)
  if (n.includes("natural") || n.includes("neural") || n.includes("online") || n.includes("network") || n.includes("enhanced") || n.includes("premium")) s += 20;
  if (n.includes("elsa") || n.includes("isabella") || n.includes("diego") || n.includes("giuseppe")) s += 8; // voci Microsoft/Apple di qualità
  if (!v.localService) s += 5;                  // le voci «online» sono in genere più naturali
  if (n.includes("compact") || n.includes("espeak")) s -= 30;
  return s;
}

async function loadVoices(): Promise<WebVoice[]> {
  const synth = (window as any).speechSynthesis;
  let voices: WebVoice[] = synth.getVoices() || [];
  if (voices.length) return voices;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 1200);
    synth.onvoiceschanged = () => { clearTimeout(t); resolve(); };
  });
  voices = synth.getVoices() || [];
  return voices;
}

/** Voce italiana migliore disponibile (memorizzata dopo la prima ricerca). */
export async function pickBestItalianVoice(): Promise<WebVoice | null> {
  if (!deviceTtsAvailable()) return null;
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = await loadVoices();
  const best = voices.map((v) => ({ v, s: scoreVoice(v) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.v || null;
  cachedVoice = best;
  return best;
}

export function deviceTtsStop() {
  try { (window as any).speechSynthesis?.cancel(); } catch {}
}

/**
 * Pronuncia `text` con la voce di sistema. Ritorna una funzione di stop. Nessun ritardo artificiale: parte subito.
 * Le chiamate consecutive vengono accodate dal motore stesso (nessuna pausa tra le frasi).
 */
export function deviceTtsSpeak(text: string, opts: { rate?: number; onStart?: () => void; onDone: () => void; force?: boolean }): () => void {
  if (isTtsMuted() && !opts.force) { try { opts.onDone(); } catch {} return () => {}; }  // V50.z453 — «Solo testo»: zero audio
  const synth = (window as any).speechSynthesis;
  const u = new (window as any).SpeechSynthesisUtterance(text);
  u.lang = "it-IT";
  u.rate = Math.min(2, Math.max(0.5, opts.rate || 1));
  let finished = false;
  const fire = () => { if (finished) return; finished = true; opts.onDone(); };
  u.onstart = () => { try { opts.onStart?.(); } catch {} };
  u.onend = fire;
  u.onerror = fire;
  void pickBestItalianVoice().then((v) => {
    if (v) { try { u.voice = synth.getVoices().find((x: WebVoice) => x.voiceURI === v.voiceURI) || null; } catch {} }
    synth.speak(u);
    // Chrome: il motore può «addormentarsi» su frasi lunghe → tieni vivo e fallback sulla durata stimata
    const est = Math.max(2500, text.length * 90 / u.rate);
    const fb = setTimeout(fire, est + 4000);
    u.onend = () => { clearTimeout(fb); fire(); };
    u.onerror = () => { clearTimeout(fb); fire(); };
  });
  return () => { finished = true; try { synth.cancel(); } catch {} };
}
