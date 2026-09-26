// chunkRecorder.ts — V50.z372 — Registrazione a SPEZZONI per l'impronta vocale (WEB: MediaRecorder).
// Ogni spezzone è un file autonomo (nuovo MediaRecorder sullo stesso stream) → base64 + mime → /voiceprint/enroll/chunk.
export type ChunkRecorder = {
  start: () => Promise<void>;
  /** Chiude lo spezzone corrente e ne apre subito un altro. Ritorna l'audio chiuso. */
  cut: () => Promise<{ base64: string; mime: string } | null>;
  stop: () => Promise<{ base64: string; mime: string } | null>;
  /** Livello istantaneo in dBFS (-60..0) o null se non disponibile. */
  level: () => number | null;
};

export const CHUNK_RECORDER_SUPPORTED = !!((globalThis as any).navigator?.mediaDevices?.getUserMedia && (globalThis as any).MediaRecorder);

export function createChunkRecorder(): ChunkRecorder {
  let stream: any = null; let rec: any = null; let chunks: Blob[] = []; let ctx: any = null; let an: any = null; let buf: Uint8Array | null = null;
  const MR: any = (globalThis as any).MediaRecorder;
  const startRec = () => {
    chunks = [];
    rec = new MR(stream);
    rec.ondataavailable = (e: any) => { if (e.data?.size) chunks.push(e.data); };
    rec.start(500);
  };
  const closeRec = (): Promise<{ base64: string; mime: string } | null> => new Promise((resolve) => {
    if (!rec || rec.state === "inactive") return resolve(null);
    const r = rec;
    r.onstop = async () => {
      const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      if (blob.size < 2000) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve({ base64: String(fr.result).split(",")[1] || "", mime: blob.type || "audio/webm" });
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    };
    r.stop();
  });
  return {
    start: async () => {
      stream = await (globalThis as any).navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        const AC: any = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
        if (AC) { ctx = new AC(); an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an); buf = new Uint8Array(an.fftSize); }
      } catch { /* senza meter */ }
      startRec();
    },
    cut: async () => { const out = await closeRec(); if (stream) startRec(); return out; },
    stop: async () => {
      const out = await closeRec();
      try { stream?.getTracks().forEach((t: any) => t.stop()); ctx?.close?.(); } catch { /* noop */ }
      stream = null; rec = null;
      return out;
    },
    level: () => {
      if (!an || !buf) return null;
      an.getByteTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      return Math.max(-60, 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6));
    },
  };
}
