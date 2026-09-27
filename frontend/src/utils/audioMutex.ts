// audioMutex.ts — V50.z385 — MUTEX AUDIO GLOBALE: una sola riproduzione vocale alla volta in tutta l'app.
// Ogni percorso (SentenceSpeaker, playAudioBase64/speakReply, ViolaWakeProvider.speak) si registra qui prima di
// suonare: il precedente viene SEMPRE fermato → mai due voci sovrapposte.
let current: { stop: () => void } | null = null;

/** Ferma l'audio in corso (se c'è) e registra il nuovo. Ritorna la funzione di rilascio da chiamare a fine riproduzione. */
export function acquireAudio(stop: () => void): () => void {
  if (current) { try { current.stop(); } catch { /* noop */ } }
  const token = { stop };
  current = token;
  return () => { if (current === token) current = null; };
}

/** Ferma qualunque audio in riproduzione. */
export function stopAllAudio(): void {
  if (current) { try { current.stop(); } catch { /* noop */ } current = null; }
}
