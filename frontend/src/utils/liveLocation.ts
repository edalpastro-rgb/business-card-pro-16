// liveLocation.ts — V50.z487 — Coordinate GPS IN TEMPO REALE (unico punto per tutta l'app).
// Prima: molte schermate leggevano `getLastKnownPositionAsync` (posizione vecchia, anche di ore) e solo in fallback la
// posizione corrente → con permesso «Consenti sempre + Posizione esatta» l'app sembrava non leggere il GPS.
// Ora: 1) servizi di localizzazione attivi? 2) permesso concesso? 3) getCurrentPositionAsync (High, poi Balanced) con timeout
// 4) SOLO se fallisce → ultima posizione nota recente (≤ 2 min). Web: navigator.geolocation (alta precisione).
import { Platform } from "react-native";
import * as Location from "expo-location";

export type LiveCoords = { lat: number; lon: number; accuracy_m: number | null; at: number; source: "live" | "last" };

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

let lastGood: LiveCoords | null = null;
let inflight: Promise<LiveCoords | null> | null = null;

function fromPos(p: { coords: { latitude: number; longitude: number; accuracy?: number | null }; timestamp?: number } | null, source: "live" | "last"): LiveCoords | null {
  if (!p?.coords) return null;
  const c: LiveCoords = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: typeof p.coords.accuracy === "number" ? Math.round(p.coords.accuracy) : null, at: p.timestamp || Date.now(), source };
  lastGood = c;
  return c;
}

async function readWeb(timeoutMs: number): Promise<LiveCoords | null> {
  const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
  if (!geo) return null;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    geo.getCurrentPosition(
      (p) => { clearTimeout(t); resolve(fromPos({ coords: { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }, timestamp: p.timestamp }, "live")); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/**
 * Coordinate attuali. Presuppone che il permesso sia già stato gestito dal chiamante (ensureDevicePermission / silent check).
 * `maxAgeMs`: riusa l'ultima lettura buona se più recente di così (default 0 = sempre fresca).
 */
export async function getLiveCoords(opts: { timeoutMs?: number; maxAgeMs?: number } = {}): Promise<LiveCoords | null> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const maxAge = opts.maxAgeMs ?? 0;
  if (maxAge > 0 && lastGood && Date.now() - lastGood.at < maxAge) return lastGood;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (Platform.OS === "web") return await readWeb(timeoutMs);
      const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!enabled) { console.log("[liveLocation] servizi di localizzazione disattivati"); return lastGood && Date.now() - lastGood.at < 120000 ? lastGood : null; }
      const perm = await withTimeout(Location.getForegroundPermissionsAsync(), 4000);
      if (!perm?.granted) return null;
      // 1) posizione corrente ad alta precisione
      let p = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null), timeoutMs);
      if (!p) p = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null), Math.max(3000, timeoutMs / 2));
      if (p) return fromPos(p, "live");
      // 2) fallback: ultima nota ma recente
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120000 }).catch(() => null);
      return last ? fromPos(last, "last") : null;
    } catch (e) {
      console.log("[liveLocation] errore lettura GPS", e);
      return null;
    } finally { inflight = null; }
  })();
  return inflight;
}

/** Coordinate senza mai mostrare popup di permesso; null se il permesso manca. Riusa letture ≤ `maxAgeMs` (default 20 s). */
export async function silentLiveCoords(maxAgeMs = 20000): Promise<LiveCoords | null> {
  try {
    if (Platform.OS !== "web") {
      const perm = await withTimeout(Location.getForegroundPermissionsAsync(), 4000);
      if (!perm?.granted) return null;
    }
    return await getLiveCoords({ maxAgeMs, timeoutMs: 8000 });
  } catch { return null; }
}

/** Payload compatto per Axon (client_context.position). */
export function positionForAxon(c: LiveCoords | null): { lat: number; lon: number; accuracy_m: number | null; age_s: number } | undefined {
  if (!c) return undefined;
  return { lat: Number(c.lat.toFixed(6)), lon: Number(c.lon.toFixed(6)), accuracy_m: c.accuracy_m, age_s: Math.max(0, Math.round((Date.now() - c.at) / 1000)) };
}
