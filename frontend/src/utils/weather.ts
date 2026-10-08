/**
 * V50.z116 — Utilità meteo condivise (widget Home + pagina /meteo).
 * Posizione: GPS (se già concesso o richiedibile su nativo) → altrimenti il
 * backend usa home_address dell'utente → office_address del tenant.
 */
import { Platform } from "react-native";
import * as Location from "expo-location";
import { getLiveCoords } from "@/src/utils/liveLocation"; // V50.z487 — posizione corrente

export const WEATHER_ICON: Record<string, { name: any; color: string }> = {
  sunny: { name: "sunny", color: "#F59E0B" },
  partly_cloudy: { name: "partly-sunny", color: "#F59E0B" },
  cloudy: { name: "cloudy", color: "#64748B" },
  fog: { name: "cloud-outline", color: "#94A3B8" },
  drizzle: { name: "rainy-outline", color: "#0EA5E9" },
  rain: { name: "rainy", color: "#0284C7" },
  rain_heavy: { name: "rainy", color: "#1D4ED8" },
  snow: { name: "snow", color: "#60A5FA" },
  snow_heavy: { name: "snow", color: "#3B82F6" },
  thunderstorm: { name: "thunderstorm", color: "#7C3AED" },
};

export function weatherIcon(key?: string | null) {
  return WEATHER_ICON[key || ""] || WEATHER_ICON.cloudy;
}

// V50.z148 — `getCurrentPositionAsync` su Android può non risolvere per molto tempo (GPS a
// freddo, indoor, dopo reinstallazione senza last-known position): senza timeout il badge
// meteo in header non compariva mai. Timeout 6s → fallback `null` (il backend usa l'indirizzo
// dello studio / Master).
const POSITION_TIMEOUT_MS = 6000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export async function getWeatherCoords(): Promise<{ lat: number; lon: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) {
      // V50.z487 — posizione CORRENTE (prima: last-known fino a 1 h → meteo della zona sbagliata dopo uno spostamento)
      const cur = await getLiveCoords({ timeoutMs: POSITION_TIMEOUT_MS, maxAgeMs: 60000 });
      if (cur) return { lat: cur.lat, lon: cur.lon };
      const loc = await Location.getLastKnownPositionAsync({ maxAge: 1000 * 60 * 10 }).catch(() => null);
      if (loc?.coords) return { lat: loc.coords.latitude, lon: loc.coords.longitude };
    } else if (perm.canAskAgain && Platform.OS !== "web") {
      const req = await withTimeout(Location.requestForegroundPermissionsAsync(), 20000);
      if (req?.granted) {
        const cur = await getLiveCoords({ timeoutMs: POSITION_TIMEOUT_MS });
        if (cur) return { lat: cur.lat, lon: cur.lon };
      }
    }
  } catch { /* ignore */ }
  return null;
}

export function fmtDayIt(dateIso: string, idx: number): string {
  if (idx === 0) return "Oggi";
  if (idx === 1) return "Domani";
  try {
    const d = new Date(dateIso + "T12:00:00");
    return d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
  } catch { return dateIso; }
}
