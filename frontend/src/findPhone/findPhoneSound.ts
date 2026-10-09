// findPhoneSound.ts — V50.z493 — Suono dello squillo «Trova il mio telefono»: 4 preset sintetici + registrazione personale.
// Il bersaglio lo legge al momento dello squillo (GET /axon/find-phone-sound, cache 60 s) e lo riproduce in loop.
import { api } from "@/src/api";

export type FindPhonePreset = "axon" | "bell" | "siren" | "beep";
export type FindPhoneSoundSetting = { kind: "preset" | "custom"; preset?: FindPhonePreset; mime?: string; b64?: string };
export const FIND_PHONE_PRESETS: { id: FindPhonePreset; label: string; hint: string }[] = [
  { id: "axon", label: "Squillo Axon", hint: "do-mi-sol, il motivo di AxonOS" },
  { id: "bell", label: "Campanella", hint: "rintocchi chiari" },
  { id: "siren", label: "Sirena", hint: "due toni alternati, molto udibile" },
  { id: "beep", label: "Doppio bip", hint: "discreto ma insistente" },
];

const SR = 22050;
function wavBase64(samples: number[]): string {
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, dataLen, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return typeof btoa === "function" ? btoa(bin) : ((globalThis as any).Buffer?.from(bin, "binary").toString("base64") as string) || "";
}

const cache: Partial<Record<FindPhonePreset, string>> = {};
export function presetBase64(id: FindPhonePreset): string {
  if (cache[id]) return cache[id]!;
  const out: number[] = [];
  const tone = (f: number, dur: number, vol = 0.6, decay = false) => {
    const n = Math.floor(SR * dur);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = decay ? Math.exp(-3 * t / dur) : Math.min(1, i / (SR * 0.01), (n - i) / (SR * 0.03));
      out.push(vol * env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t)));
    }
  };
  const sil = (dur: number) => { for (let i = 0, n = Math.floor(SR * dur); i < n; i++) out.push(0); };
  if (id === "axon") { for (let k = 0; k < 2; k++) { tone(1046, 0.12); sil(0.04); tone(1318, 0.12); sil(0.04); tone(1568, 0.18); sil(0.12); } tone(1568, 0.1); sil(0.03); tone(2093, 0.35); sil(0.5); }
  else if (id === "bell") { for (let k = 0; k < 3; k++) { tone(1760, 0.5, 0.7, true); sil(0.15); } sil(0.5); }
  else if (id === "siren") { for (let k = 0; k < 3; k++) { tone(880, 0.3, 0.65); tone(1175, 0.3, 0.65); } sil(0.3); }
  else { for (let k = 0; k < 2; k++) { tone(1400, 0.08, 0.7); sil(0.06); tone(1400, 0.08, 0.7); sil(0.35); } sil(0.4); }
  cache[id] = wavBase64(out);
  return cache[id]!;
}

let settingCache: { at: number; s: FindPhoneSoundSetting } | null = null;
export async function getFindPhoneSound(force = false): Promise<FindPhoneSoundSetting> {
  if (!force && settingCache && Date.now() - settingCache.at < 60000) return settingCache.s;
  try {
    const r = await api<{ sound: FindPhoneSoundSetting }>("/axon/find-phone-sound");
    settingCache = { at: Date.now(), s: r.sound || { kind: "preset", preset: "axon" } };
  } catch { settingCache = settingCache || { at: Date.now(), s: { kind: "preset", preset: "axon" } }; }
  return settingCache.s;
}
export function invalidateFindPhoneSound() { settingCache = null; }

/** Base64 + mime del suono da riprodurre in loop sul dispositivo bersaglio. */
export async function ringForPlayback(): Promise<{ b64: string; mime: string }> {
  const s = await getFindPhoneSound();
  if (s.kind === "custom" && s.b64) return { b64: s.b64, mime: s.mime || "audio/m4a" };
  return { b64: presetBase64((s.preset as FindPhonePreset) || "axon"), mime: "audio/wav" };
}
