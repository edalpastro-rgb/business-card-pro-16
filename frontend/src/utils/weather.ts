/**
 * V50.z116 — Utilità meteo condivise (widget Home + pagina /meteo).
 * Posizione: GPS (se già concesso o richiedibile su nativo) → altrimenti il
 * backend usa home_address dell'utente → office_address del tenant.
 */
import { Platform } from "react-native";
import * as Location from "expo-location";

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

export async function getWeatherCoords(): Promise<{ lat: number; lon: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) {
      const loc = await Location.getLastKnownPositionAsync({ maxAge: 1000 * 60 * 60 }).catch(() => null);
      if (loc?.coords) return { lat: loc.coords.latitude, lon: loc.coords.longitude };
      const cur = await Location.getCurrentPositionAsync({}).catch(() => null);
      if (cur?.coords) return { lat: cur.coords.latitude, lon: cur.coords.longitude };
    } else if (perm.canAskAgain && Platform.OS !== "web") {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.granted) {
        const cur = await Location.getCurrentPositionAsync({}).catch(() => null);
        if (cur?.coords) return { lat: cur.coords.latitude, lon: cur.coords.longitude };
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
