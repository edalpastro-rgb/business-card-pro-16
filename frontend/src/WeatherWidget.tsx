/**
 * V50.z116 — Widget Home "Meteo": card compatta (meteo di oggi + n. allerte).
 * Tap → pagina /meteo (dentro l'app) con previsioni dettagliate.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { getWeatherCoords, weatherIcon } from "@/src/utils/weather";

type Res = {
  alerts?: { id: string }[];
  weather?: { icon_key?: string; label?: string; temp_min?: number; temp_max?: number } | null;
  place?: string | null;
  needs_address?: boolean;
};

export function WeatherWidget() {
  const router = useRouter();
  const [res, setRes] = useState<Res | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const c = await getWeatherCoords();
      const r = await api<Res>("/weather/alerts", { method: "POST", body: c ? { lat: c.lat, lon: c.lon } : {} });
      setRes(r);
    } catch { setRes(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const w = res?.weather;
  const icon = weatherIcon(w?.icon_key);
  const nAlerts = res?.alerts?.length || 0;

  return (
    <Pressable testID="weather-widget" onPress={() => router.push("/meteo" as any)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <View style={[styles.iconBox, { backgroundColor: icon.color + "1A" }]}>
        {loading ? <ActivityIndicator color={theme.color.brandPrimary} /> : <Ionicons name={icon.name} size={28} color={icon.color} />}
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
              <Text style={styles.temp} testID="weather-temp">{w?.temp_max != null ? `${Math.round(w.temp_max)}°` : (loading ? "…" : "—")}</Text>
              {w?.temp_min != null && <Text style={styles.min}>min {Math.round(w.temp_min)}°</Text>}
            </View>
            <Text style={styles.sub} numberOfLines={1}>{w?.label || (loading ? "Caricamento…" : "Meteo non disponibile · tocca per riprovare")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="location" size={11} color={theme.color.muted} />
              <Text style={styles.place} numberOfLines={1}>{res?.place || "Posizione"}</Text>
            </View>
          </>
        )}
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        {nAlerts > 0 ? (
          <View style={[styles.pill, { backgroundColor: "#FEF3C7" }]}>
            <Ionicons name="warning" size={12} color="#B45309" />
            <Text style={[styles.pillTxt, { color: "#B45309" }]}>{nAlerts} {nAlerts === 1 ? "allerta" : "allerte"}</Text>
          </View>
        ) : !loading && w ? (
          <View style={styles.pill}>
            <Ionicons name="shield-checkmark" size={12} color="#16A34A" />
            <Text style={styles.pillTxt}>Nessuna allerta</Text>
          </View>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.color.border, minHeight: 72 },
  iconBox: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  temp: { fontSize: 24, fontWeight: "900", color: theme.color.onSurface },
  min: { fontSize: 12, color: theme.color.muted, fontWeight: "600" },
  sub: { fontSize: 12.5, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  place: { fontSize: 11, color: theme.color.muted, flexShrink: 1 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: "#DCFCE7" },
  pillTxt: { fontSize: 10.5, fontWeight: "800", color: "#16A34A" },
});

export default WeatherWidget;
