/**
 * V50.z337 — Cache locale meteo (30 min) + retry automatico su HTTP 429 (Open-Meteo «troppe richieste»).
 *
 *  - `readWeatherCache(key)`  → { data, fresh } | null   (fresh = più recente di 30 min)
 *  - `writeWeatherCache(key, data)`
 *  - `fetchWeatherWithRetry(fn)` → esegue `fn`; se fallisce con 429 (eccezione HTTP o campo `error`
 *    nella risposta) attende 5 s e riprova UNA volta.
 *
 * Il dato in cache scaduto viene comunque mostrato dai widget con etichetta «Aggiornamento in corso»
 * mentre la richiesta di rete è in volo: mai «Meteo non disponibile» se abbiamo un dato recente.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const WEATHER_TTL_MS = 30 * 60 * 1000;
export const WEATHER_429_BACKOFF_MS = 5000;

type Entry<T> = { data: T; at: number };

export async function readWeatherCache<T>(key: string): Promise<{ data: T; fresh: boolean; at: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(`weather_cache_${key}`);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry<T>;
    if (!e || typeof e.at !== "number" || !e.data) return null;
    return { data: e.data, at: e.at, fresh: Date.now() - e.at < WEATHER_TTL_MS };
  } catch {
    return null;
  }
}

export async function writeWeatherCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(`weather_cache_${key}`, JSON.stringify({ data, at: Date.now() } as Entry<T>));
  } catch { /* cache best-effort */ }
}

export function is429(e: unknown): boolean {
  const msg = typeof e === "string" ? e : String((e as any)?.message || (e as any)?.error || "");
  return /\b429\b|too many requests|troppe richieste/i.test(msg);
}

/** Esegue la chiamata meteo; su 429 (eccezione o `{ error: "... 429" }`) riprova una volta dopo 5 s. */
export async function fetchWeatherWithRetry<T extends { error?: string }>(fn: () => Promise<T>): Promise<T> {
  let r: T;
  try {
    r = await fn();
  } catch (e) {
    if (!is429(e)) throw e;
    await new Promise((res) => setTimeout(res, WEATHER_429_BACKOFF_MS));
    return fn();
  }
  if (r?.error && is429(r.error)) {
    await new Promise((res) => setTimeout(res, WEATHER_429_BACKOFF_MS));
    return fn();
  }
  return r;
}

export function coordsKey(c: { lat: number; lon: number } | null, extra = ""): string {
  return c ? `${c.lat.toFixed(2)}_${c.lon.toFixed(2)}${extra}` : `home${extra}`;
}
