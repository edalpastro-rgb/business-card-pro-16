// wakeEngine.ts — V50.z370 — WEB (Desktop = web app su PC): wake-word «Axon» con la Web Speech API del browser
// (Chrome/Edge: webkitSpeechRecognition continuo, it-IT). Su browser senza Web Speech API o in Expo Go → non supportato.
// Metro sceglie questo file al posto di wakeEngine.native.ts: nessun import nativo.
import type { WakeEngine, WakeEngineOptions } from "./types";
import { VIOLA_KEYWORD_LABEL } from "./types";

const SR: any = typeof globalThis !== "undefined" ? ((globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition) : null;
export const WAKE_ENGINE_SUPPORTED = !!SR;

const WAKE_RX = /(^|\s)(axon|acson|akson|axson|ex on|hey axon|ehi axon|ok axon|ciao axon)(\s|$)|\ba[ck]s[oò]ne?\b/;

export function createWakeEngine(opts: WakeEngineOptions): WakeEngine {
  let rec: any = null; let active = false; let lastWake = 0; let timer: ReturnType<typeof setTimeout> | null = null;
  const start = () => {
    if (!active) return;
    try {
      rec = new SR(); rec.lang = "it-IT"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.onresult = (ev: any) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = String(ev.results[i][0]?.transcript || "").toLowerCase().replace(/[^a-zàèéìòù\s]/g, " ");
          if (WAKE_RX.test(t) && Date.now() - lastWake > 2500) { lastWake = Date.now(); opts.onWake(); return; }
        }
      };
      rec.onerror = (e: any) => { if (e?.error === "not-allowed") { active = false; opts.onError("Microfono negato nel browser: consenti il microfono per la wake-word «Axon»."); } };
      rec.onend = () => { if (active) { timer = setTimeout(start, 400); } };
      rec.start();
    } catch (e: any) { opts.onError(String(e?.message || e)); }
  };
  return {
    keywordLabel: VIOLA_KEYWORD_LABEL,
    async start() {
      if (!SR) { opts.onError("I comandi vocali «Axon» su web richiedono Chrome o Edge (Web Speech API)."); throw new Error("unsupported"); }
      active = true; start();
    },
    async stop() {
      active = false; if (timer) { clearTimeout(timer); timer = null; }
      try { rec?.abort?.(); } catch { /* noop */ } rec = null;
    },
  };
}
