// wakeWord.ts — V50.z377 — Stub WEB dell'API WakeWord (il motore reale è in wakeWord.native.ts: AudioRecord + onnxruntime-react-native).
// Su web non c'è streaming nativo: isAvailable() = false; simulate() invoca comunque i callback onWake («Simula rilevamento Axon»).
type Cb<T> = (v: T) => void;
const wakeSubs = new Set<Cb<{ score: number; simulated: boolean }>>();

export const WakeWord = {
  isAvailable: () => false,
  isRunning: () => false,
  onWake: (cb: Cb<{ score: number; simulated: boolean }>) => { wakeSubs.add(cb); return () => { wakeSubs.delete(cb); }; },
  onScore: (_cb: Cb<number>) => () => {},
  onLevel: (_cb: Cb<number>) => () => {},
  onError: (_cb: Cb<string>) => () => {},
  async start(_opts: { sensitivity?: number; threshold?: number; keywordLabel?: string } = {}): Promise<void> { throw new Error("Ascolto continuo Axon disponibile solo nella build Android"); },
  async stop(): Promise<void> {},
  simulate(): void { wakeSubs.forEach((cb) => { try { cb({ score: 1, simulated: true }); } catch { /* noop */ } }); },
};
