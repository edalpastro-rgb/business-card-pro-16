// V50.z186 — Barge-in NATIVO (stop vocale di AxonOS) — modulo isolato.
//
// Su web esiste già un detector RMS (V38T, AudioContext). Su Android/iOS non c'era nulla: mentre
// Axon parlava il microfono era spento e "stop!" veniva ignorato. Questo hook, quando `active`
// (Axon sta parlando), tiene acceso un recorder di servizio con metering (expo-audio) e:
//   1. rileva voce dell'utente (livello > soglia assoluta E > rumore di fondo/eco + delta, per ≥ 3 campioni)
//      → `onInterrupt()` IMMEDIATO (la voce si mette in pausa in < 0,5 s);
//   2. continua a registrare fino al silenzio (max 8 s), trascrive con /ai/transcribe e decide:
//      • parola di stop ("stop", "basta", "fermati", "zitto", "aspetta"…) → `onStop()` definitivo
//      • frase nuova (≥ 3 parole, diversa da ciò che Axon stava dicendo) → `onStop()` + `onUtterance(testo)`
//      • vuoto / eco del TTS (stesse parole della frase in riproduzione) → `onFalseAlarm()` (riprende la voce)
// Il recorder di servizio è separato da quello usato per la domanda (mai attivi insieme: `active` è
// true solo in fase "speaking").
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";
import { ensureVoiceAudioMode } from "@/src/voice/voiceAudioMode";

export const STOP_WORDS_RE = /\b(stop|basta|ferma(ti)?|fermo|zitt[oa]|silenzio|aspetta|smettila|taci|interrompi|pausa|ok grazie|va bene grazie)\b/i;

const POLL_MS = 150;
const ABS_DB = -22;          // sotto questo livello non è mai "voce vicina al telefono"
const DELTA_DB = 8;          // sopra il rumore di fondo/eco di almeno 8 dB
const LOUD_SAMPLES = 3;      // ~450 ms di voce continua
const SILENCE_MS = 1300;     // fine frase
const MAX_UTTERANCE_MS = 8000;
const WINDOW = 12;           // ~1,8 s di storico per il floor

export type NativeBargeInOpts = {
  active: boolean;
  /** Voce da mettere subito in pausa (chiamato al primo rilevamento). */
  onInterrupt: () => void;
  /** Stop definitivo (parola di stop o nuova domanda). */
  onStop: () => void;
  /** Falso allarme (eco/rumore): riprendi la voce. */
  onFalseAlarm?: () => void;
  /** Nuova domanda detta sopra la voce di Axon. */
  onUtterance?: (text: string) => void;
  /** Testo che Axon sta pronunciando (per riconoscere l'eco del TTS). */
  speakingText?: () => string;
};

function norm(s: string): string[] {
  return (s || "").toLowerCase().replace(/[^a-zàèéìòù0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}

/** Quota di parole del transcript presenti nel testo pronunciato da Axon (eco). */
function echoRatio(transcript: string, spoken: string): number {
  const t = norm(transcript); if (!t.length) return 0;
  const sp = new Set(norm(spoken));
  const hit = t.filter((w) => sp.has(w)).length;
  return hit / t.length;
}

export function useNativeBargeIn(opts: NativeBargeInOpts): void {
  const enabled = Platform.OS !== "web";
  const recorder = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, POLL_MS);
  const optsRef = useRef(opts); optsRef.current = opts;
  const listening = useRef(false);
  const triggered = useRef(false);
  const busy = useRef(false);
  const window_ = useRef<number[]>([]);
  const loud = useRef(0);
  const lastVoice = useRef(0);
  const triggeredAt = useRef(0);

  const stopRecorder = async (): Promise<string | null> => {
    listening.current = false;
    try { await recorder.stop(); } catch { /* ignore */ }
    return recorder.uri || null;
  };

  // avvio / arresto del recorder di servizio in base ad `active`
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    if (opts.active) {
      (async () => {
        if (listening.current || busy.current) return;
        try {
          await ensureVoiceAudioMode({ recording: true });
          await recorder.prepareToRecordAsync();
          if (cancelled) return;
          recorder.record();
          listening.current = true;
          triggered.current = false;
          window_.current = []; loud.current = 0; lastVoice.current = 0;
        } catch { listening.current = false; }
      })();
    } else if (listening.current && !triggered.current) {
      void stopRecorder();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.active, enabled]);

  // smontaggio: mai lasciare il microfono acceso
  useEffect(() => () => { if (listening.current) void stopRecorder(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // analisi del metering
  useEffect(() => {
    if (!enabled || !listening.current) return;
    const m = typeof state?.metering === "number" ? state.metering : -160;
    const now = Date.now();
    const o = optsRef.current;

    if (!triggered.current) {
      if (!o.active) return;
      const w = window_.current;
      const floor = w.length ? [...w].sort((a, b) => a - b)[Math.floor(w.length / 2)] : -60;
      const isVoice = m > ABS_DB && m > floor + DELTA_DB;
      if (isVoice) loud.current += 1; else loud.current = 0;
      w.push(m); if (w.length > WINDOW) w.shift();
      if (loud.current >= LOUD_SAMPLES) {
        triggered.current = true;
        triggeredAt.current = now;
        lastVoice.current = now;
        try { o.onInterrupt(); } catch { /* ignore */ }
      }
      return;
    }

    // fase "utterance": aspetta il silenzio poi trascrivi
    if (m > ABS_DB - 6) lastVoice.current = now;
    const silent = now - lastVoice.current >= SILENCE_MS;
    const tooLong = now - triggeredAt.current >= MAX_UTTERANCE_MS;
    if (!silent && !tooLong) return;
    if (busy.current) return;
    busy.current = true;
    (async () => {
      const uri = await stopRecorder();
      let text = "";
      try {
        if (uri) {
          const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
          if (b64 && b64.length > 500) {
            const r = await api<{ transcript: string }>("/ai/transcribe", { method: "POST", body: { audio_base64: b64, mime: "audio/m4a" } });
            text = (r?.transcript || "").trim();
          }
        }
      } catch { text = ""; }
      const oo = optsRef.current;
      const words = norm(text);
      const spoken = oo.speakingText?.() || "";
      const isEcho = words.length > 0 && spoken && echoRatio(text, spoken) >= 0.6;
      try {
        if (!text || isEcho) {
          oo.onFalseAlarm?.();
        } else if (STOP_WORDS_RE.test(text) && words.length <= 4) {
          oo.onStop();
        } else if (words.length >= 3) {
          oo.onStop();
          oo.onUtterance?.(text);
        } else {
          oo.onStop();
        }
      } catch { /* ignore */ }
      triggered.current = false;
      busy.current = false;
      // se Axon ha ripreso a parlare (falso allarme) l'effetto su `active` non scatta: riparti a mano
      if (optsRef.current.active && (!text || isEcho)) {
        try {
          await ensureVoiceAudioMode({ recording: true });
          await recorder.prepareToRecordAsync();
          recorder.record();
          listening.current = true; window_.current = []; loud.current = 0;
        } catch { listening.current = false; }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.metering, enabled]);
}
