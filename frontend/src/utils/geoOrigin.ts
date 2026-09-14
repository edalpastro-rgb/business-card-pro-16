// geoOrigin.ts — V50.z241 — Origine per le distanze «da te»: GPS solo se il permesso è GIÀ concesso (nessun popup
// spontaneo); `requestGpsOrigin` chiede il permesso in modo contestuale (tap dell'utente) rispettando canAskAgain.
import { Linking } from "react-native";
import * as Location from "expo-location";
import { notify } from "@/src/utils/notify";

export type GeoPoint = { lat: number; lon: number };

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

async function readPosition(): Promise<GeoPoint | null> {
  const last = await Location.getLastKnownPositionAsync().catch(() => null);
  const p = last || (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 6000).catch(() => null));
  return p ? { lat: p.coords.latitude, lon: p.coords.longitude } : null;
}

/** Coordinate GPS senza mai mostrare il popup di permesso (null se non concesso). */
export async function silentGpsOrigin(): Promise<GeoPoint | null> {
  try {
    const perm = await withTimeout(Location.getForegroundPermissionsAsync(), 4000);
    if (!perm?.granted) return null;
    return await readPosition();
  } catch { return null; }
}

/** Chiede il permesso (contestuale, dopo un tap) e restituisce le coordinate; gestisce denied + Apri impostazioni. */
export async function requestGpsOrigin(): Promise<GeoPoint | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) return await readPosition();
    if (!perm.canAskAgain) {
      notify("Posizione disattivata", "Abilita la posizione nelle impostazioni del telefono per vedere le distanze da te.", [{ text: "Apri impostazioni", onPress: () => Linking.openSettings() }, { text: "Ok" }]);
      return null;
    }
    const req = await withTimeout(Location.requestForegroundPermissionsAsync(), 20000);
    if (!req?.granted) return null;
    return await readPosition();
  } catch { return null; }
}

export type GeoDistance = { km: number; min: number } | null;
export type GeoDistancesResp = { origin: { kind: "gps" | "office"; label: string } | null; results: Record<string, GeoDistance> };
export const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : String(Math.round(km))) + " km";
