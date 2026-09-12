/**
 * SentenceSpeaker — TTS incrementale durante lo streaming della risposta.
 *
 * Riceve i delta di testo man mano che arrivano dal server (SSE), li accumula
 * e appena riconosce una frase completa (., !, ?, …, a capo — oppure ~240
 * caratteri senza punteggiatura) la invia a POST /api/assistant/tts e mette
 * l'audio in coda. La riproduzione è sequenziale e mentre una frase è in
 * riproduzione le successive vengono già sintetizzate (prefetch, max 2 in
 * volo): la prima frase si sente pochi secondi dopo i primi token, senza
 * attendere il completamento della risposta.
 *
 * Cross-platform: <audio> su web, expo-audio (createAudioPlayer + evento
 * playbackStatusUpdate.didJustFinish) su iOS/Android.
 */
import { Platform } from "react-native";
import { api } from "@/src/api";

type Audio = { b64: string; mime: string } | null;
type QueueItem = { text: string; audio: Promise<Audio> | null };

export type SentenceSpeakerHandlers = {
  onStart?: () => void;                       // prima frase in riproduzione
  onEnd?: () => void;                         // coda esaurita (o stop)
  onAudioElement?: (audio: any | null) => void; // web: elemento <audio> corrente (per pausa/riprendi)
};

const MAX_INFLIGHT = 2;
const MIN_SENTENCE = 24;   // caratteri minimi prima di "chiudere" una frase
const HARD_SPLIT = 240;    // senza punteggiatura: taglia all'ultimo spazio

/** Rimuove markdown/tabelle/URL: il TTS deve leggere solo testo "parlabile". */
export function cleanForSpeech(raw: string): string {
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith("|")) return false;                 // righe di tabella
      if (/^[-:|\s]+$/.test(t)) return false;              // separatori tabella / hr
      if (t.startsWith("```")) return false;               // fence codice
      return true;
    })
    .join(" ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export class SentenceSpeaker {
  private buffer = "";
  private queue: QueueItem[] = [];
  private inflight = 0;
  private playing = false;
  private stopped = false;
  private flushed = false;
  private started = false;
  private ended = false;
  private fedChars = 0;
  private currentCleanup: (() => void) | null = null;
  // V50.z186 — pausa/riprendi per il barge-in nativo (stop vocale)
  private paused = false;
  private currentText = "";
  private currentPause: (() => void) | null = null;
  private currentResume: (() => void) | null = null;

  constructor(private voice: string | undefined, private handlers: SentenceSpeakerHandlers = {}) {}

  /** Quanto testo è stato ricevuto finora (per capire se lo stream ha prodotto delta). */
  get fedLength() { return this.fedChars; }

  feed(delta: string) {
    if (this.stopped || !delta) return;
    this.fedChars += delta.length;
    this.buffer += delta;
    this.extract(false);
  }

  /** Fine risposta: sintetizza il residuo e chiudi la coda quando finisce l'audio. */
  flush() {
    if (this.stopped) return;
    this.flushed = true;
    this.extract(true);
    this.pump();
    this.maybeFinish();
  }

  /** Fallback: nessun delta ricevuto (es. risposta non-stream) → parla tutto il testo. */
  finishWith(fullText: string) {
    if (this.fedChars === 0 && fullText) this.feed(fullText);
    this.flush();
  }

  /** Testo della frase attualmente in riproduzione (per distinguere l'eco del TTS dalla voce utente). */
  get speakingText() { return this.currentText; }
  get isPaused() { return this.paused; }

  /** V50.z186 — Silenzia subito la voce (senza perdere la coda). */
  pause() {
    if (this.stopped || this.paused) return;
    this.paused = true;
    try { this.currentPause?.(); } catch {}
  }

  /** V50.z186 — Riprende dal punto in cui era stata messa in pausa. */
  resume() {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    if (this.currentResume) { try { this.currentResume(); } catch {} }
    else void this.playNext();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.paused = false;
    this.queue = [];
    this.buffer = "";
    if (this.currentCleanup) { try { this.currentCleanup(); } catch {} this.currentCleanup = null; }
    this.handlers.onAudioElement?.(null);
    this.finish();
  }

  // ---- interni ----------------------------------------------------------

  private extract(final: boolean) {
    // Cerca confini di frase; accetta il segmento solo se abbastanza lungo,
    // altrimenti continua a cercare il confine successivo (evita frasi "1." o "Sì.").
    const re = /[.!?…;:]["»)]?(\s+|$)|\n+/g;
    let from = 0;
    for (;;) {
      re.lastIndex = from;
      const m = re.exec(this.buffer);
      if (!m) break;
      const end = m.index + m[0].length;
      const seg = this.buffer.slice(0, end);
      if (seg.trim().length >= MIN_SENTENCE || /\n/.test(m[0])) {
        this.enqueue(seg);
        this.buffer = this.buffer.slice(end);
        from = 0;
      } else {
        from = end;
        if (from >= this.buffer.length) break;
      }
    }
    // Prima frase "eager": finché non abbiamo ancora messo nulla in coda,
    // appena ci sono ≥ 60 caratteri tagliamo all'ultima virgola/punto e virgola
    // così la voce parte entro pochi secondi anche con frasi lunghe.
    if (!final && this.queue.length === 0 && !this.started && this.buffer.length >= 60) {
      const cut = Math.max(this.buffer.lastIndexOf(", "), this.buffer.lastIndexOf("; "));
      if (cut >= MIN_SENTENCE) {
        this.enqueue(this.buffer.slice(0, cut + 1));
        this.buffer = this.buffer.slice(cut + 1);
      }
    }
    // Taglio duro senza punteggiatura (liste lunghe, frasi infinite)
    while (this.buffer.length > HARD_SPLIT) {
      const cut = this.buffer.lastIndexOf(" ", HARD_SPLIT);
      const at = cut > MIN_SENTENCE ? cut : HARD_SPLIT;
      this.enqueue(this.buffer.slice(0, at));
      this.buffer = this.buffer.slice(at);
    }
    if (final && this.buffer.trim()) {
      this.enqueue(this.buffer);
      this.buffer = "";
    }
    this.pump();
  }

  private enqueue(text: string) {
    const clean = cleanForSpeech(text);
    if (!clean || clean.length < 2) return;
    this.queue.push({ text: clean, audio: null });
  }

  /** Avvia la sintesi delle prossime frasi (max MAX_INFLIGHT in volo) e la riproduzione. */
  private pump() {
    if (this.stopped) return;
    for (const item of this.queue) {
      if (this.inflight >= MAX_INFLIGHT) break;
      if (item.audio) continue;
      this.inflight += 1;
      item.audio = api<{ audio_base64: string; mime: string }>("/assistant/tts", {
        method: "POST",
        body: { text: item.text, voice: this.voice },
      })
        .then((r) => (r?.audio_base64 ? { b64: r.audio_base64, mime: r.mime || "audio/mpeg" } : null))
        .catch(() => null)
        .finally(() => { this.inflight -= 1; this.pump(); });
    }
    void this.playNext();
  }

  private async playNext() {
    if (this.playing || this.stopped || this.paused) return;
    const item = this.queue[0];
    if (!item) { this.maybeFinish(); return; }
    if (!item.audio) { this.pump(); return; }
    this.playing = true;
    const audio = await item.audio;
    if (this.stopped) return;
    if (!audio) {
      this.queue.shift();
      this.playing = false;
      void this.playNext();
      return;
    }
    if (!this.started) { this.started = true; try { this.handlers.onStart?.(); } catch {} }
    const done = () => {
      if (this.stopped) return;
      this.currentCleanup = null;
      this.currentPause = null; this.currentResume = null; this.currentText = "";
      this.handlers.onAudioElement?.(null);
      this.queue.shift();
      this.playing = false;
      this.pump();
      void this.playNext();
    };
    this.currentText = item.text;
    this.currentCleanup = await this.play(audio, item.text, done);
  }

  private maybeFinish() {
    if (this.flushed && !this.playing && this.queue.length === 0) this.finish();
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    try { this.handlers.onEnd?.(); } catch {}
  }

  private async play(audio: { b64: string; mime: string }, text: string, onEnded: () => void): Promise<() => void> {
    let ended = false;
    const fire = () => { if (ended) return; ended = true; onEnded(); };
    const uri = `data:${audio.mime};base64,${audio.b64}`;
    // Fallback: se l'evento di fine non arriva (stima ~65ms/carattere + margine)
    const fallback = setTimeout(fire, Math.max(1500, Math.min(60000, text.length * 65 + 1500)));

    if (Platform.OS === "web") {
      const el = new (globalThis as any).Audio(uri);
      this.handlers.onAudioElement?.(el);
      el.addEventListener("ended", () => { clearTimeout(fallback); fire(); }, { once: true });
      el.addEventListener("error", () => { clearTimeout(fallback); fire(); }, { once: true });
      this.currentPause = () => { try { el.pause(); } catch {} };
      this.currentResume = () => { try { void el.play(); } catch {} };
      try { await el.play(); } catch { clearTimeout(fallback); fire(); }
      return () => { clearTimeout(fallback); try { el.pause(); } catch {} };
    }
    try {
      const AudioMod: any = await import("expo-audio");
      const player = AudioMod.createAudioPlayer({ uri });
      let sub: any = null;
      let fb: any = fallback;
      try {
        sub = player.addListener?.("playbackStatusUpdate", (st: any) => {
          if (st?.didJustFinish) { clearTimeout(fb); try { sub?.remove?.(); } catch {} try { player.release?.(); } catch {} fire(); }
        });
      } catch {}
      this.currentPause = () => { clearTimeout(fb); try { player.pause?.(); } catch {} };
      this.currentResume = () => {
        fb = setTimeout(fire, Math.max(1500, Math.min(60000, text.length * 65 + 1500)));
        try { player.play?.(); } catch { clearTimeout(fb); fire(); }
      };
      try { player.play(); } catch { clearTimeout(fallback); fire(); }
      return () => {
        clearTimeout(fb);
        try { sub?.remove?.(); } catch {}
        try { player.pause?.(); } catch {}
        try { player.release?.(); } catch {}
      };
    } catch {
      clearTimeout(fallback);
      fire();
      return () => {};
    }
  }
}
