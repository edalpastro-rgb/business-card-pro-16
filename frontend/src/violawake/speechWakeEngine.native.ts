// V50.z341 — ViolaWake: motore wake-word di FALLBACK senza Picovoice.
// Usa il riconoscimento vocale del telefono (expo-speech-recognition, Apple/Google, on-device quando disponibile)
// in ascolto CONTINUO e fa scattare onWake quando nella trascrizione compare «Axon» (o la parola di fallback).
// Si riavvia da solo su "end"/"error" con un piccolo backoff finché è attivo. Quando è presente la chiave Picovoice
// l'app usa Porcupine (wakeEngine.native.ts); questo motore resta l'upgrade path inverso: zero chiavi, zero costi.
import { Platform } from "react-native";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import type { WakeEngine, WakeEngineOptions } from "./types";
import { VIOLA_KEYWORD_LABEL } from "./types";

// V50.z369 — varianti che il riconoscitore produce spesso al posto di «axon»
const WAKE_VARIANTS = ["axon", "acson", "akson", "axson", "axo", "ex on", "hey axon", "ehi axon", "ok axon", "ciao axon"];

function containsWake(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-zàèéìòù\s]/g, " ");
  return WAKE_VARIANTS.some((v) => new RegExp(`(^|\\s)${v}(\\s|$)`).test(t)) || /\ba[ck]s[oò]n[e]?\b/.test(t);
}

export function createSpeechWakeEngine(opts: Pick<WakeEngineOptions, "onWake" | "onError">): WakeEngine {
  let active = false;
  let restarting = false;
  let lastWake = 0;
  let failures = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  const subs: { remove: () => void }[] = [];

  const clearSubs = () => { subs.splice(0).forEach((s) => { try { s.remove(); } catch { /* noop */ } }); };

  const startRecognizer = () => {
    if (!active) return;
    // V50.z367 — Android: il riconoscimento «solo sul dispositivo» richiede il pacchetto lingua IT scaricato, altrimenti errore continuo
    // (language-not-supported) e la wake-word non risponde mai → su Android usiamo il riconoscitore standard (Google).
    let onDevice = false;
    if (Platform.OS === "ios") { try { onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(); } catch { /* noop */ } }
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "it-IT",
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: false,
        maxAlternatives: 1,
        // Android: evita che l'OS chiuda subito la sessione nei silenzi
        androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 60000, EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 60000 },
      } as any);
    } catch (e: any) {
      scheduleRestart(String(e?.message || e));
    }
  };

  const scheduleRestart = (reason?: string) => {
    if (!active || restarting) return;
    restarting = true;
    failures = Math.min(failures + 1, 6);
    if (reason && failures >= 3) opts.onError(`Riconoscitore vocale instabile (${reason.slice(0, 60)}). Riprovo…`);
    restartTimer = setTimeout(() => { restarting = false; startRecognizer(); }, 400 * failures);
  };

  const onDetect = () => {
    const now = Date.now();
    if (now - lastWake < 2500) return; // anti-doppio trigger
    lastWake = now;
    failures = 0;
    // il provider ferma questo motore (stop → abort) e cattura il COMANDO con una sessione dedicata, poi lo riavvia
    opts.onWake();
  };

  return {
    get keywordLabel() { return VIOLA_KEYWORD_LABEL; },
    async start() {
      if (active) return;
      active = true;
      failures = 0;
      clearSubs();
      subs.push(ExpoSpeechRecognitionModule.addListener("result", (ev: any) => {
        const t: string = ev?.results?.[0]?.transcript || "";
        if (t && containsWake(t)) onDetect();
        else if (ev?.isFinal) failures = 0; // sessione sana
      }));
      subs.push(ExpoSpeechRecognitionModule.addListener("end", () => {
        // riparte dopo la cattura comando (il provider tiene occupato il riconoscitore per ~listen_seconds)
        if (active) scheduleRestart();
      }));
      subs.push(ExpoSpeechRecognitionModule.addListener("error", (ev: any) => {
        const code = String(ev?.error || "");
        if (code === "not-allowed" || code === "service-not-allowed") {
          active = false;
          opts.onError("Microfono o riconoscimento vocale non autorizzati.");
          return;
        }
        if (active) scheduleRestart(code === "no-speech" ? undefined : code);
      }));
      startRecognizer();
    },
    async stop() {
      active = false;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      clearSubs();
      try { ExpoSpeechRecognitionModule.abort(); } catch { /* noop */ }
    },
  };
}
