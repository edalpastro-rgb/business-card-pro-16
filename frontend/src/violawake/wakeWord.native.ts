// wakeWord.ts — V50.z377 — API pubblica dell'ascolto continuo «Axon» (Android, 100% offline):
//   WakeWord.isAvailable()            → modulo nativo AxonWakeAudio presente (build nativa Android)
//   WakeWord.start({ sensitivity })   → streaming microfono (AudioRecord) + servizio in primo piano + rilevatore TemporalCNN (Job #253)
//   WakeWord.stop()
//   WakeWord.onWake(cb) / onScore(cb) / onLevel(cb) / onError(cb) → sottoscrizioni (ritornano remove())
//   WakeWord.simulate()               → invoca i callback onWake come se la parola fosse stata sentita («Simula rilevamento Axon»)
import { AXON_WAKE_AUDIO_AVAILABLE, startAudioStream } from "./axonWakeAudio";
import { AxonWakeDetector, thresholdFromSensitivity } from "./axonWakeModel";
import { startForegroundService, stopForegroundService } from "./foregroundService";

type Cb<T> = (v: T) => void;
const subs = { wake: new Set<Cb<{ score: number; simulated: boolean }>>(), score: new Set<Cb<number>>(), level: new Set<Cb<number>>(), error: new Set<Cb<string>>() };
let stream: { stop: () => Promise<void> } | null = null;
let detector: AxonWakeDetector | null = null;
let running = false;

function emitWake(score: number, simulated: boolean) { subs.wake.forEach((cb) => { try { cb({ score, simulated }); } catch { /* noop */ } }); }
function emitError(msg: string) { subs.error.forEach((cb) => { try { cb(msg); } catch { /* noop */ } }); }

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
    const det = detector && detector.threshold === thr ? detector : new AxonWakeDetector({ threshold: thr, consecutive: 2, onScore: (s) => subs.score.forEach((cb) => cb(s)) });
    await det.load();
    det.reset();
    detector = det;
    stream = startAudioStream((c) => {
      subs.level.forEach((cb) => cb(c.dbfs));
      det.feed(c.pcm).then((wake) => { if (wake) emitWake(det.threshold, false); }).catch((e) => emitError(String(e?.message || e)));
    }, emitError);
    if (!stream) throw new Error("Streaming audio non avviato");
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
