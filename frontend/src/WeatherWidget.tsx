/**
 * V50.z116 — Widget Home "Meteo": card compatta (meteo di oggi + n. allerte).
 * Tap → pagina /meteo (dentro l'app) con previsioni dettagliate.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { getWeatherCoords, weatherIcon } from "@/src/utils/weather";
import { readWeatherCache, writeWeatherCache, fetchWeatherWithRetry, coordsKey } from "@/src/utils/weatherCache"; // V50.z337 — cache 30 min + retry 429
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Res = {
  alerts?: { id: string }[];
  weather?: { icon_key?: string; label?: string; temp?: number; temp_min?: number; temp_max?: number } | null;
  place?: string | null;
  needs_address?: boolean;
};

/**
 * V50.z337 — Allerte/meteo di oggi con cache locale 30 min: se il dato è fresco NON chiama l'API; se è scaduto lo
 * restituisce subito (`stale=true`) e aggiorna in background; su 429 riprova dopo 5 s.
 */
async function loadAlertsCached(onStale?: (r: Res) => void): Promise<Res> {
  const c = await getWeatherCoords().catch(() => null);
  const key = coordsKey(c, "_alerts");
  const cached = await readWeatherCache<Res>(key);
  if (cached?.fresh) return cached.data;
  if (cached && onStale) onStale(cached.data);
  try {
    const r = await fetchWeatherWithRetry<Res & { error?: string }>(() => api<Res>("/weather/alerts", { method: "POST", body: c ? { lat: c.lat, lon: c.lon } : {} }));
    if (r && !r.needs_address && r.weather) await writeWeatherCache(key, r);
    if ((!r?.weather) && cached) return cached.data; // il server non ha dati (429 anche lato server) → mostra l'ultimo noto
    return r;
  } catch (e) {
    if (cached) return cached.data;
    throw e;
  }
}

/**
 * @param alwaysVisible V50.z150 — widget "Meteo" della zona widget Home: mostra SEMPRE temperatura
 * attuale e condizioni (stessa fonte dell'icona in header), anche senza allerte e durante il caricamento.
 * Senza prop (default) resta il comportamento V50.z132 (solo con allerte attive).
 */
export function WeatherWidget({ alwaysVisible = false }: { alwaysVisible?: boolean } = {}) {
  const router = useRouter();
  const [res, setRes] = useState<Res | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false); // V50.z337 — dato in cache scaduto mostrato durante l'aggiornamento

  const load = useCallback(async () => {
    try {
      setStale(false);
      const r = await loadAlertsCached((old) => { setRes(old); setStale(true); setLoading(false); });
      setRes(r);
    } catch { setRes((prev) => prev); }
    finally { setLoading(false); setStale(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const w = res?.weather;
  const icon = weatherIcon(w?.icon_key);
  const nAlerts = res?.alerts?.length || 0;

  // V50.z132 — Il widget compare SOLO se ci sono allerte attive; le condizioni
  // correnti sono sempre visibili nella mini-icona sul banner (HeaderWeatherBadge).
  if (!alwaysVisible && (loading || nAlerts === 0)) return null;

  return (
    <Pressable testID="weather-widget" onPress={() => router.push("/meteo" as any)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <View style={[styles.iconBox, { backgroundColor: icon.color + "1A" }]}>
        {loading ? <ActivityIndicator color={HT.brand} /> : <Ionicons name={icon.name} size={28} color={icon.color} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {res?.needs_address ? (
          <>
            <Text style={styles.title}>Meteo</Text>
            <Text style={styles.sub} numberOfLines={2}>Tocca per impostare la tua località</Text>
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text style={styles.temp} testID="weather-temp">{(w?.temp ?? w?.temp_max) != null ? `${Math.round((w!.temp ?? w!.temp_max) as number)}°` : (loading ? "…" : "—")}</Text>
              {w?.temp_min != null && <Text style={styles.min}>min {Math.round(w.temp_min)}°{w?.temp_max != null ? ` · max ${Math.round(w.temp_max)}°` : ""}</Text>}
            </View>
            <Text style={styles.sub} numberOfLines={1} testID="weather-sub">{stale && w ? `${w.label || "Meteo"} · Aggiornamento in corso…` : (w?.label || (loading ? "Caricamento…" : "Meteo non disponibile · tocca per riprovare"))}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="location" size={11} color={HT.muted} />
              <Text style={styles.place} numberOfLines={1}>{res?.place || "Posizione"}</Text>
            </View>
          </>
        )}
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        {nAlerts > 0 ? (
          <View style={[styles.pill, { backgroundColor: HT.warningTint }]}>
            <Ionicons name="warning" size={12} color={HT.warning} />
            <Text style={[styles.pillTxt, { color: HT.warning }]}>{nAlerts} {nAlerts === 1 ? "allerta" : "allerte"}</Text>
          </View>
        ) : !loading && w ? (
          <View style={styles.pill}>
            <Ionicons name="shield-checkmark" size={12} color="#16A34A" />
            <Text style={styles.pillTxt}>Nessuna allerta</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={HT.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card2, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: HT.border, minHeight: 72 },
  iconBox: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  temp: { fontSize: 24, fontWeight: "900", color: HT.text },
  min: { fontSize: 12, color: HT.muted, fontWeight: "600" },
  sub: { fontSize: 12.5, color: HT.text2, fontWeight: "600" },
  place: { fontSize: 11, color: HT.muted, flexShrink: 1 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: HT.successTint },
  pillTxt: { fontSize: 10.5, fontWeight: "800", color: "#16A34A" },
  headerBadge: { position: "absolute", left: 8, bottom: 6, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(15,23,42,0.45)" },
  // V50.z334 — variante inline per la barra superiore dark della Home
  headerBadgeInline: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, minHeight: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)" },
  headerBadgeTxt: { color: "#FFF", fontSize: 11, fontWeight: "800" },
});

/**
 * V50.z132 — Mini indicatore meteo per il banner AdvisorOS della Home
 * (angolo in basso a sinistra): icona sole/pioggia/neve + temperatura.
 * Tap → pagina /meteo. Non renderizza nulla se il meteo non è disponibile.
 */
export function HeaderWeatherBadge({ inline }: { inline?: boolean } = {}) {
  const router = useRouter();
  const [res, setRes] = useState<Res | null>(null);
  // V50.z157 — Il badge è SEMPRE visibile: senza dati meteo (GPS negato/assente nella
  // build, indirizzo non impostato, rete) mostra un'icona "nuvola" generica che porta a
  // /meteo per impostare la località. Prima `return null` lo faceva sparire del tutto
  // (APK 1.0.49: permesso posizione assente → coords null → needs_address → nessun badge).
  const [tick, setTick] = useState(0);
  useFocusEffect(useCallback(() => { setTick((t) => t + 1); }, []));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // V50.z337 — cache 30 min + retry 429 (loadAlertsCached); 1 retry extra se la rete non è pronta al cold start
      for (let attempt = 0; attempt < 2 && !cancelled; attempt++) {
        try {
          const r = await loadAlertsCached((old) => { if (!cancelled) setRes(old); });
          if (!cancelled) setRes(r);
          return;
        } catch {
          if (attempt === 0) await new Promise((res) => setTimeout(res, 4000));
        }
      }
      if (!cancelled) setRes((prev) => prev);
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const w = res?.weather;
  const hasWeather = !!(w && w.icon_key);
  const icon = hasWeather ? weatherIcon(w!.icon_key) : { name: "cloud-outline" as any };
  const temp = hasWeather ? (w!.temp ?? w!.temp_max) : null;
  return (
    <Pressable
      testID="header-weather-badge"
      onPress={() => router.push("/meteo" as any)}
      hitSlop={8}
      accessibilityLabel={hasWeather ? `Meteo attuale: ${w!.label || ""}` : "Meteo: imposta la tua località"}
      style={inline ? styles.headerBadgeInline : styles.headerBadge}
    >
      <Ionicons name={icon.name} size={14} color={inline ? "#38BDF8" : "#FFF"} />
      {temp != null ? (
        <Text style={styles.headerBadgeTxt}>{Math.round(temp as number)}°</Text>
      ) : (
        <Text style={styles.headerBadgeTxt}>Meteo</Text>
      )}
    </Pressable>
  );
}

export default WeatherWidget;
