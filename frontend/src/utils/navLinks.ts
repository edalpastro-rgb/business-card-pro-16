// navLinks.ts — V50.z488 — Apertura navigatore con COORDINATE PRECISE, in tempo reale.
//   1) posizione utente letta ORA con expo-location (getLiveCoords, nessuna cache) nel momento esatto del tap
//   2) destinazione → lat/lon precisi via backend POST /geo/resolve-destination (Google Places searchText, bias sull'origine reale)
//   3) Waze:        waze://?ll=LAT,LNG&navigate=yes   (fallback web https://www.waze.com/ul?ll=…)
//      Google Maps: https://www.google.com/maps/dir/?api=1&origin=LAT_U,LNG_U&destination=LAT_D,LNG_D
// Usato da: chip nelle risposte di Axon (ContactActionChips), scheda contatto, dettaglio appuntamento, NavChooser (mappa / giro).
import { Linking, Platform } from "react-native";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { getLiveCoords } from "@/src/utils/liveLocation";
import { ensureDevicePermission } from "@/src/permissions/devicePermissions";

export type NavApp = "waze" | "google" | "apple";
export type NavDest = { address?: string | null; lat?: number | null; lon?: number | null; label?: string | null };
export type ResolvedDest = { lat: number; lon: number; formatted: string; source: string; distance_km?: number };

const fmt = (n: number) => n.toFixed(6);

export function wazeUrl(lat: number, lon: number): string { return `waze://?ll=${fmt(lat)},${fmt(lon)}&navigate=yes`; }
export function wazeWebUrl(lat: number, lon: number): string { return `https://www.waze.com/ul?ll=${fmt(lat)},${fmt(lon)}&navigate=yes`; }
export function gmapsUrl(dest: { lat: number; lon: number }, origin?: { lat: number; lon: number } | null): string {
  const o = origin ? `&origin=${fmt(origin.lat)},${fmt(origin.lon)}` : "";
  return `https://www.google.com/maps/dir/?api=1${o}&destination=${fmt(dest.lat)},${fmt(dest.lon)}&travelmode=driving`;
}
export function appleUrl(dest: { lat: number; lon: number }): string { return `https://maps.apple.com/?daddr=${fmt(dest.lat)},${fmt(dest.lon)}&dirflg=d`; }

/** Posizione dell'utente letta adesso (nessuna cache). null se permesso negato / GPS spento / timeout. */
export async function readOriginNow(): Promise<{ lat: number; lon: number } | null> {
  if (!(await ensureDevicePermission("location"))) return null;
  const p = await getLiveCoords({ maxAgeMs: 0, timeoutMs: 12000 });
  return p ? { lat: p.lat, lon: p.lon } : null;
}

/** Destinazione → coordinate precise (Google Places lato server; cache 30 gg). */
export async function resolveDestination(dest: NavDest, origin?: { lat: number; lon: number } | null): Promise<ResolvedDest | null> {
  if (dest.lat != null && dest.lon != null && Number.isFinite(dest.lat) && Number.isFinite(dest.lon)) {
    return { lat: dest.lat, lon: dest.lon, formatted: dest.address || dest.label || "", source: "given" };
  }
  const address = (dest.address || "").trim();
  if (address.length < 4) return null;
  try {
    const r = await api<ResolvedDest>("/geo/resolve-destination", { method: "POST", body: { address, origin: origin || undefined, label: dest.label || undefined } });
    return r && Number.isFinite(r.lat) && Number.isFinite(r.lon) ? r : null;
  } catch (e: any) {
    console.log("[navLinks] resolve-destination failed", e?.message);
    return null;
  }
}

async function openUrlWithFallback(primary: string, fallback?: string) {
  try {
    if (Platform.OS !== "web" && primary.startsWith("waze://")) {
      const ok = await Linking.canOpenURL(primary).catch(() => false);
      if (!ok && fallback) { await Linking.openURL(fallback); return; }
    }
    await Linking.openURL(primary);
  } catch {
    if (fallback) { await Linking.openURL(fallback).catch(() => notify("Navigazione", "Impossibile aprire il navigatore")); }
    else notify("Navigazione", "Impossibile aprire il navigatore");
  }
}

/**
 * Apre il navigatore scelto verso `dest`: GPS letto ora + destinazione risolta in coordinate.
 * Ritorna false se la destinazione non è risolvibile (mostra già un avviso).
 */
export async function openNavigation(app: NavApp, dest: NavDest): Promise<boolean> {
  if ((dest.lat == null || dest.lon == null) && !(dest.address || "").trim()) { notify("Indirizzo mancante", "Nessuna posizione disponibile per questa destinazione."); return false; }
  const origin = await readOriginNow(); // 1) posizione reale, adesso
  const d = await resolveDestination(dest, origin); // 2) destinazione in lat/lon precisi
  if (!d) { notify("Indirizzo non trovato", `Non riesco a localizzare «${dest.address || dest.label || ""}»: controlla via, civico e città.`); return false; }
  if (app === "waze") await openUrlWithFallback(wazeUrl(d.lat, d.lon), wazeWebUrl(d.lat, d.lon));
  else if (app === "apple") await openUrlWithFallback(appleUrl(d));
  else await openUrlWithFallback(gmapsUrl(d, origin));
  if (!origin && Platform.OS !== "web") notify("Posizione non letta", "Il navigatore partirà dalla posizione rilevata dall'app di navigazione: attiva il GPS per il percorso da dove sei.");
  return true;
}
