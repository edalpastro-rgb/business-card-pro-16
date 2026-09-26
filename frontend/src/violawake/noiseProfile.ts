// noiseProfile.ts — V50.z367 — Soglie rumore ambiente predefinite (3 scenari) + calibrazione microfono.
// Il metering di expo-audio è in dBFS (-60 silenzio … 0 saturazione). Per l'utente lo mostriamo come «dB ambiente» ≈ dBFS + 90
// (40 dB = stanza silenziosa, 65 dB = ufficio/strada, >65 dB = bar/traffico). ViolaWake sceglie il profilo da solo a ogni
// cattura misurando il rumore di fondo; la calibrazione salvata (10 s) sposta la base di partenza.
import AsyncStorage from "@react-native-async-storage/async-storage";

export type NoiseBand = "silent" | "normal" | "noisy";
export type NoiseProfile = { band: NoiseBand; label: string; maxAmbientDb: number; speechDeltaDb: number; minSpeechDb: number; trailingSilenceMs: number; noSpeechGiveupMs: number };

export const NOISE_PROFILES: Record<NoiseBand, NoiseProfile> = {
  silent: { band: "silent", label: "Silenzioso (< 40 dB)", maxAmbientDb: 40, speechDeltaDb: 5, minSpeechDb: -48, trailingSilenceMs: 1000, noSpeechGiveupMs: 4000 },
  normal: { band: "normal", label: "Normale (40–65 dB)", maxAmbientDb: 65, speechDeltaDb: 7, minSpeechDb: -42, trailingSilenceMs: 900, noSpeechGiveupMs: 3500 },
  noisy: { band: "noisy", label: "Rumoroso (> 65 dB)", maxAmbientDb: 999, speechDeltaDb: 10, minSpeechDb: -30, trailingSilenceMs: 700, noSpeechGiveupMs: 3000 },
};

export const DBFS_TO_AMBIENT = 90;
export const toAmbientDb = (dbfs: number): number => Math.max(0, Math.min(120, Math.round(dbfs + DBFS_TO_AMBIENT)));
export const bandForAmbient = (ambientDb: number): NoiseBand => (ambientDb < 40 ? "silent" : ambientDb <= 65 ? "normal" : "noisy");
export const profileForDbfs = (noiseDbfs: number): NoiseProfile => NOISE_PROFILES[bandForAmbient(toAmbientDb(noiseDbfs))];

export type MicCalibration = { baselineDbfs: number; ambientDb: number; band: NoiseBand; thresholdDbfs: number; measuredAt: string; samples: number };
const KEY = "viola_mic_calibration_v1";
let cache: MicCalibration | null | undefined;

export async function loadCalibration(): Promise<MicCalibration | null> {
  if (cache !== undefined) return cache;
  try { const raw = await AsyncStorage.getItem(KEY); cache = raw ? (JSON.parse(raw) as MicCalibration) : null; } catch { cache = null; }
  return cache;
}
export async function saveCalibration(c: MicCalibration | null): Promise<void> {
  cache = c;
  try { if (c) await AsyncStorage.setItem(KEY, JSON.stringify(c)); else await AsyncStorage.removeItem(KEY); } catch { /* noop */ }
}
/** Da una serie di campioni dBFS (10 s di ambiente) → calibrazione: base = mediana, soglia = base + delta del profilo. */
export function buildCalibration(samples: number[]): MicCalibration | null {
  const s = samples.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length < 10) return null;
  const median = s[Math.floor(s.length / 2)];
  const p = profileForDbfs(median);
  return { baselineDbfs: median, ambientDb: toAmbientDb(median), band: p.band, thresholdDbfs: Math.max(p.minSpeechDb, median + p.speechDeltaDb), measuredAt: new Date().toISOString(), samples: s.length };
}
