// V50.z10 — Time format preference (12h AM/PM vs 24h).
// Persistito globalmente in AsyncStorage, letto da widget Home e schermata
// Timer & Sveglie. Default 24h (standard italiano).
import { useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type TimeFormat = "12h" | "24h";

const KEY = "axon_time_format_v1";
let cachedFormat: TimeFormat = "24h";
const listeners = new Set<(f: TimeFormat) => void>();

export async function loadTimeFormat(): Promise<TimeFormat> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (s === "12h" || s === "24h") {
      cachedFormat = s;
      return s;
    }
  } catch { /* ignore */ }
  return "24h";
}

export async function setTimeFormat(f: TimeFormat): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, f);
    cachedFormat = f;
    listeners.forEach((l) => l(f));
  } catch { /* ignore */ }
}

export function useTimeFormat(): [TimeFormat, (f: TimeFormat) => void] {
  const [fmt, setFmt] = useState<TimeFormat>(cachedFormat);
  useEffect(() => {
    let mounted = true;
    loadTimeFormat().then((f) => {
      if (mounted) setFmt(f);
    });
    const l = (f: TimeFormat) => setFmt(f);
    listeners.add(l);
    return () => {
      mounted = false;
      listeners.delete(l);
    };
  }, []);
  const set = useCallback((f: TimeFormat) => {
    setTimeFormat(f);
  }, []);
  return [fmt, set];
}

/**
 * Formatta un orario "HH:MM" (24h) nel formato scelto dall'utente.
 * Es. formatHHMM("14:30", "12h") → "2:30 PM"
 *     formatHHMM("07:05", "24h") → "07:05"
 */
export function formatHHMM(hhmm: string, format: TimeFormat = cachedFormat): string {
  if (!hhmm || !hhmm.includes(":")) return hhmm;
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  return formatHM(h, m, format);
}

export function formatHM(h: number, m: number, format: TimeFormat = cachedFormat): string {
  const mm = String(m).padStart(2, "0");
  if (format === "12h") {
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${ampm}`;
  }
  return `${String(h).padStart(2, "0")}:${mm}`;
}

/**
 * Formatta un Date object per la visualizzazione.
 * Se `sameDay` true, mostra solo l'ora; altrimenti data+ora.
 */
export function formatDateTime(
  d: Date,
  format: TimeFormat = cachedFormat,
  opts: { forceDate?: boolean } = {},
): string {
  const now = new Date();
  const sameDay =
    !opts.forceDate &&
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = formatHM(d.getHours(), d.getMinutes(), format);
  if (sameDay) return time;
  const dateStr = d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  return `${dateStr} ${time}`;
}
