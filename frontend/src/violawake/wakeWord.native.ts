// wakeWord.native.ts — V50.z381 — API pubblica dell'ascolto continuo «Axon» (Android, 100% offline, inferenza nativa):
//   WakeWord.isAvailable()            → modulo nativo AxonWakeAudio presente (build nativa Android)
//   WakeWord.start({ sensitivity })   → microfono (AudioRecord) + pipeline ONNX nativa (TemporalCNN Job #253) + servizio in primo piano
//   WakeWord.stop()
//   WakeWord.onWake(cb) / onScore(cb) / onLevel(cb) / onError(cb) → sottoscrizioni (ritornano remove())
//   WakeWord.simulate()               → invoca i callback onWake come se la parola fosse stata sentita («Simula rilevamento Axon»)
import { AXON_WAKE_AUDIO_AVAILABLE, startNativeWake, thresholdFromSensitivity } from "./axonWakeAudio";
import { startForegroundService, stopForegroundService } from "./foregroundService";

type Cb<T> = (v: T) => void;
const subs = { wake: new Set<Cb<{ score: number; simulated: boolean }>>(), score: new Set<Cb<number>>(), level: new Set<Cb<number>>(), error: new Set<Cb<string>>() };
let stream: { stop: () => Promise<void> } | null = null;
let running = false;

function emitWake(score: number, simulated: boolean) { subs.wake.forEach((cb) => { try { cb({ score, simulated }); } catch { /* noop */ } }); }

export const WakeWord = {
  isAvailable: () => AXON_WAKE_AUDIO_AVAILABLE,
  isRunning: () => running,
  onWake: (cb: Cb<{ score: number; simulated: boolean }>) => { subs.wake.add(cb); return () => { subs.wake.delete(cb); }; },
  onScore: (cb: Cb<number>) => { subs.score.add(cb); return () => { subs.score.delete(cb); }; },
  onLevel: (cb: Cb<number>) => { subs.level.add(cb); return () => { subs.level.delete(cb); }; },
  onError: (cb: Cb<string>) => { subs.error.add(cb); return () => { subs.error.delete(cb); }; },

  async start(opts: { sensitivity?: number; threshold?: number; keywordLabel?: string } = {}): Promise<void> {
    if (running) return;
    if (!AXON_WAKE_AUDIO_AVAILABLE) throw new Error("Modulo audio nativo non disponibile (serve la build Android)");
    const thr = opts.threshold ?? thresholdFromSensitivity(opts.sensitivity);
    stream = startNativeWake(thr, 2, {
      onWake: (score) => emitWake(score, false),
      onScore: (s) => subs.score.forEach((cb) => cb(s)),
      onLevel: (d) => subs.level.forEach((cb) => cb(d)),
      onError: (m) => subs.error.forEach((cb) => cb(m)),
    });
    if (!stream) throw new Error("Ascolto nativo non avviato");
    running = true;
    void startForegroundService(opts.keywordLabel || "Axon"); // Android: microfono vivo anche con schermo bloccato
  },

  async stop(): Promise<void> {
    running = false;
    const s = stream; stream = null;
    if (s) await s.stop();
    await stopForegroundService();
  },

  simulate(): void { emitWake(1, true); },
};
