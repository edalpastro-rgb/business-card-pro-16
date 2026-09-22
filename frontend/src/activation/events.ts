// V50.z318 — Eventi globali per l'effetto di attivazione AxonOS e «trova il mio telefono».
import { DeviceEventEmitter } from "react-native";

export const AXON_ACTIVATION_EVENT = "axon:activation-effect";
export const AXON_FIND_PHONE_EVENT = "axon:find-phone";
export const AXON_FIND_PHONE_STOP_EVENT = "axon:find-phone-stop";
/** Emesso dal controller quando l'onda di attivazione è terminata (per gli overlay «mirror» dentro i Modal). */
export const AXON_ACTIVATION_HIDE_EVENT = "axon:activation-hide";

export type ActivationPayload = { name: string; voice?: string; greet?: boolean };

/** Vibrazione doppia + onda di energia (3 s) + presentazione vocale «Ciao, sono {name}. Sono pronto.» */
export function playActivationEffect(p: ActivationPayload) {
  DeviceEventEmitter.emit(AXON_ACTIVATION_EVENT, p);
}
/** Vibrazione ritmica + suono identitario finché non si tocca lo schermo o si dice «stop». */
export function startFindPhone(name?: string) {
  DeviceEventEmitter.emit(AXON_FIND_PHONE_EVENT, { name: name || "Axon" });
}
export function stopFindPhone() {
  DeviceEventEmitter.emit(AXON_FIND_PHONE_STOP_EVENT, {});
}

/** Riconosce i comandi locali nella chat («Axon, fai l'effetto», «dove sei», «trova il mio telefono», «stop»). */
export function matchLocalCommand(text: string): "effect" | "find_phone" | "stop" | null {
  const low = (text || "").toLowerCase().trim();
  if (!low) return null;
  if (/\bfai (l'|lo |l )?effetto\b|\beffetto di attivazione\b/.test(low)) return "effect";
  if (/\bdove sei\b|\btrova il (mio )?telefono\b|\bdov'è il (mio )?telefono\b|\bcerca il (mio )?telefono\b/.test(low)) return "find_phone";
  if (/^(stop|basta|fermati|ok stop|trovato)[.!]?$/.test(low)) return "stop";
  return null;
}
