// axonWakeModel.ts — V50.z377 — Rilevatore wake-word «Axon» 100% offline (onnxruntime-react-native), stessa pipeline validata in
// backend/tests/validate_wake_pipeline.py:
//   PCM16 16 kHz a blocchi di 1280 campioni (80 ms) → melspectrogram.onnx su (480 campioni precedenti + 1280) = 8 frame mel (x/10+2)
//   → finestra di 76 frame → embedding_model.onnx → 96-d → ultimi 9 embedding → axon.onnx (TemporalCNN, Job #253, Sigmoid) → score 0..1.
// Modello Axon custom = default. Un rilevamento richiede `consecutive` score consecutivi ≥ threshold (anti falsi positivi) + refrattario 1.5 s.
import { Asset } from "expo-asset";
import { InferenceSession, Tensor } from "onnxruntime-react-native";

/* eslint-disable @typescript-eslint/no-require-imports */
const MODELS = {
  mel: require("@/assets/wake/melspectrogram.onnx"),
  emb: require("@/assets/wake/embedding_model.onnx"),
  axon: require("@/assets/wake/axon.onnx"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

const CTX = 480, CHUNK = 1280, MEL_BINS = 32, MEL_WIN = 76, EMB_DIM = 96, N_EMB = 9;

async function loadSession(mod: number): Promise<InferenceSession> {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  return InferenceSession.create(uri.startsWith("file://") ? uri.replace("file://", "") : uri);
}

export type WakeDetectorOptions = { threshold?: number; consecutive?: number; onScore?: (score: number) => void };

export class AxonWakeDetector {
  private mel!: InferenceSession; private emb!: InferenceSession; private clf!: InferenceSession;
  private prev = new Float32Array(CTX);
  private melBuf = new Float32Array(MEL_WIN * MEL_BINS); private melFilled = 0;
  private embBuf = new Float32Array(N_EMB * EMB_DIM); private embFilled = 0;
  private hits = 0; private lastWake = 0; private busy = false; private queue: Int16Array[] = [];
  readonly threshold: number; readonly consecutive: number;
  private onScore?: (s: number) => void;
  ready = false;

  constructor(opts: WakeDetectorOptions = {}) {
    this.threshold = opts.threshold ?? 0.6;
    this.consecutive = Math.max(1, opts.consecutive ?? 2);
    this.onScore = opts.onScore;
  }

  async load(): Promise<void> {
    if (this.ready) return;
    [this.mel, this.emb, this.clf] = await Promise.all([loadSession(MODELS.mel), loadSession(MODELS.emb), loadSession(MODELS.axon)]);
    this.ready = true;
  }

  reset(): void { this.prev.fill(0); this.melFilled = 0; this.embFilled = 0; this.hits = 0; this.queue = []; }

  /** Accoda un blocco da 1280 campioni; risolve true se la wake-word è stata rilevata su questo blocco. */
  async feed(pcm: Int16Array): Promise<boolean> {
    if (!this.ready) return false;
    if (this.busy) { if (this.queue.length < 6) this.queue.push(pcm); return false; } // il telefono è lento: non accumulare ritardo
    this.busy = true;
    try {
      let wake = await this.process(pcm);
      while (this.queue.length) { const nx = this.queue.shift()!; if (await this.process(nx)) wake = true; }
      return wake;
    } finally { this.busy = false; }
  }

  private async process(pcm: Int16Array): Promise<boolean> {
    const n = Math.min(pcm.length, CHUNK);
    const input = new Float32Array(CTX + CHUNK);
    input.set(this.prev, 0);
    for (let i = 0; i < n; i++) input[CTX + i] = pcm[i];
    this.prev.set(input.subarray(CTX + CHUNK - CTX, CTX + CHUNK));
    const melOut = await this.mel.run({ input: new Tensor("float32", input, [1, CTX + CHUNK]) });
    const mel = (Object.values(melOut)[0] as Tensor).data as Float32Array; // 8 × 32
    const frames = mel.length / MEL_BINS;
    // scorri il buffer mel e aggiungi i nuovi frame (x/10 + 2)
    const keep = MEL_WIN - frames;
    this.melBuf.copyWithin(0, frames * MEL_BINS, MEL_WIN * MEL_BINS);
    for (let i = 0; i < frames * MEL_BINS; i++) this.melBuf[keep * MEL_BINS + i] = mel[i] / 10 + 2;
    this.melFilled = Math.min(MEL_WIN, this.melFilled + frames);
    if (this.melFilled < MEL_WIN) return false;
    const embOut = await this.emb.run({ input_1: new Tensor("float32", this.melBuf.slice(), [1, MEL_WIN, MEL_BINS, 1]) });
    const e = (Object.values(embOut)[0] as Tensor).data as Float32Array; // 96
    this.embBuf.copyWithin(0, EMB_DIM, N_EMB * EMB_DIM);
    this.embBuf.set(e.subarray(0, EMB_DIM), (N_EMB - 1) * EMB_DIM);
    this.embFilled = Math.min(N_EMB, this.embFilled + 1);
    if (this.embFilled < N_EMB) return false;
    const out = await this.clf.run({ embeddings: new Tensor("float32", this.embBuf.slice(), [1, N_EMB, EMB_DIM]) });
    const score = ((Object.values(out)[0] as Tensor).data as Float32Array)[0];
    this.onScore?.(score);
    if (score >= this.threshold) this.hits += 1; else this.hits = 0;
    const now = Date.now();
    if (this.hits >= this.consecutive && now - this.lastWake > 1500) {
      this.hits = 0; this.lastWake = now; this.embFilled = 0; // ricomincia la finestra: evita doppio trigger sulla coda della parola
      return true;
    }
    return false;
  }
}

/** Soglia dalla «sensibilità» 0..1 delle impostazioni ViolaWake: 0 → 0.85 (severa) · 0.5 → 0.6 · 1 → 0.35 (permissiva). */
export function thresholdFromSensitivity(sensitivity?: number): number {
  const s = Math.min(1, Math.max(0, sensitivity ?? 0.5));
  return Math.round((0.85 - s * 0.5) * 100) / 100;
}
