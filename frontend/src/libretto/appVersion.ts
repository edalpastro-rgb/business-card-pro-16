// Libretto — badge versione dinamico (V50.z179).
// Legge la versione dell'app installata (build nativa) e la data dell'ultimo aggiornamento,
// così il badge si aggiorna da solo ad ogni nuova build senza interventi manuali.
import { Platform } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";

/** Versione app: nativa (APK/IPA installati) → app.json (web/Expo Go). "2.0.0" viene mostrata come "2.0". */
export function getAppVersion(fallback = "2.0"): string {
  const raw = (Platform.OS !== "web" && Application.nativeApplicationVersion) || Constants.expoConfig?.version || fallback;
  return String(raw).replace(/\.0$/, "");
}

/** Data ultimo aggiornamento: Android = ultimo update del pacchetto; iOS = installazione; web = null. */
export async function getAppLastUpdateDate(): Promise<Date | null> {
  try {
    if (Platform.OS === "android") return await Application.getLastUpdateTimeAsync();
    if (Platform.OS === "ios") return await Application.getInstallationTimeAsync();
  } catch {
    // ignora: fallback statico
  }
  return null;
}

/** "Settembre 2026" */
export function formatMonthYearIt(d: Date): string {
  const s = d.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Compone il badge "2.0 · Settembre 2026". `fallbackLabel` (LIBRETTO_META.version) fornisce la data quando
 * il sistema non la espone (web); la versione è sempre quella reale dell'app.
 */
export function buildVersionBadge(version: string, date: Date | null, fallbackLabel: string): string {
  const fallbackDate = fallbackLabel.split("·")[1]?.trim();
  const when = date ? formatMonthYearIt(date) : fallbackDate;
  return when ? `${version} · ${when}` : version;
}
