// findPhoneClient.ts — V50.z492 — «Trova il mio telefono» via VPS: il dispositivo da cui parte il comando NON squilla mai se stesso.
// Chiede al backend di far squillare l'altro dispositivo (pc/tablet/carplay → telefono · telefono → tablet) con push reale +
// coda comandi. Qui: trigger, stop remoto, generazione dello squillo dedicato (WAV sintetico, stesso motivo di find_phone.wav).
import { api } from "@/src/api";
import { getDeviceInfo } from "@/src/device";
import { stopFindPhone } from "@/src/activation/events";

export type FindPhoneMode = "ring" | "vibrate";
export type FindPhoneTriggerResult = { cmd_id: string; mode: FindPhoneMode; push_sent: boolean; target: { device_id: string; type: string; name: string }; message: string };

/** Fa squillare/vibrare l'ALTRO dispositivo. Ritorna il testo da mostrare in chat (anche in caso di errore). */
export async function triggerFindPhone(text: string, opts: { sourceType?: "phone" | "tablet" | "pc" | "carplay"; mode?: FindPhoneMode } = {}): Promise<{ ok: boolean; message: string; result?: FindPhoneTriggerResult }> {
  try {
    const dev = await getDeviceInfo();
    const r = await api<FindPhoneTriggerResult>("/axon/find-phone/trigger", { method: "POST", body: { source_device_id: dev.device_id, source_type: opts.sourceType || dev.type, mode: opts.mode, text } });
    return { ok: true, message: r.message + (r.push_sent ? "" : " (notifica push non configurata su questo server: il dispositivo squilla appena l'app è aperta)"), result: r };
  } catch (e: any) {
    return { ok: false, message: `⚠️ ${e?.message || "Non riesco a contattare l'altro dispositivo."}` };
  }
}

/** «Stop» detto ovunque: ferma lo squillo locale (se questo è il bersaglio) e quello remoto. */
export async function stopFindPhoneEverywhere(): Promise<void> {
  stopFindPhone();
  try {
    const dev = await getDeviceInfo();
    await api("/axon/find-phone/stop", { method: "POST", body: { source_device_id: dev.device_id } });
  } catch { /* offline: lo stop locale basta */ }
}

// ---------------------------------------------------------------------------
// Squillo dedicato (sintetizzato: do-mi-sol ×2 + sol-do acuto, 2.2 s) → base64 WAV per playAudioBase64
// ---------------------------------------------------------------------------
let ringCache: string | null = null;
export function findPhoneRingBase64(): string {
  if (ringCache) return ringCache;
  const sr = 22050;
  const samples: number[] = [];
  const tone = (f: number, dur: number, vol = 0.6) => {
    const n = Math.floor(sr * dur);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, i / (sr * 0.01), (n - i) / (sr * 0.03));
      samples.push(vol * env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t)));
    }
  };
  const silence = (dur: number) => { for (let i = 0, n = Math.floor(sr * dur); i < n; i++) samples.push(0); };
  for (let k = 0; k < 2; k++) { tone(1046, 0.12); silence(0.04); tone(1318, 0.12); silence(0.04); tone(1568, 0.18); silence(0.12); }
  tone(1568, 0.1); silence(0.03); tone(2093, 0.35); silence(0.5);
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, dataLen, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  const b64: string = typeof btoa === "function" ? btoa(bin) : ((globalThis as any).Buffer?.from(bin, "binary").toString("base64") as string) || "";
  ringCache = b64;
  return b64;
}
