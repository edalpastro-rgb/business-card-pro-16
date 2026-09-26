// liveTone.ts — V50.z366 — Tono in TEMPO REALE dal volume e dal ritmo della voce (campioni di livello in dB ogni ~150 ms).
// verde = rapport/obiezione (voce morbida, ritmo lento, pause) · blu = spiegazione (volume medio, ritmo regolare) ·
// rosso = distacco/incalzare (voce alta, ritmo serrato, molti sbalzi). L'analisi LLM a fine frase resta quella "ufficiale".
import type { Tone } from "@/src/corporate-gym/areasApi";

export const LIVE_TONE_WINDOW = 13; // ≈ 2 s

export function classifyLiveTone(levels: number[]): Tone | null {
  const w = levels.slice(-LIVE_TONE_WINDOW);
  if (w.length < 4) return null;
  const speaking = w.filter((l) => l > -42);
  if (speaking.length === 0) return null;                      // silenzio: tono invariato
  const ratio = speaking.length / w.length;
  const avg = speaking.reduce((a, b) => a + b, 0) / speaking.length;
  let swings = 0;
  for (let i = 1; i < w.length; i++) if (Math.abs(w[i] - w[i - 1]) > 8) swings++;
  const loud = avg > -18, soft = avg < -28, fast = swings >= 5, slow = swings <= 2;
  if (loud && (fast || ratio > 0.9)) return "red";
  if (soft || (slow && ratio < 0.6)) return "green";
  return "blue";
}

/** Aggiunge un campione al grafico live compattando i tratti consecutivi dello stesso tono. */
export function pushLiveSegment(segs: { tone: Tone; pct: number }[], tone: Tone): { tone: Tone; pct: number }[] {
  const last = segs[segs.length - 1];
  if (last && last.tone === tone) return [...segs.slice(0, -1), { tone, pct: last.pct + 1 }];
  return [...segs, { tone, pct: 1 }];
}
