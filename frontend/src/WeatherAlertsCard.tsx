import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api } from "@/src/api";

/**
 * V50.z79 — Widget "Meteo & Allerte" in Home (Open-Meteo + soglie Protezione Civile-like).
 * Comportamento:
 *  - Sempre visibile: meteo di oggi (icona, min/max, località) + eventuali allerte.
 *  - Posizione: GPS (se concesso) → fallback indirizzo di residenza dell'utente
 *    (user-settings.home_address, per master/collaboratore/manager) → indirizzo ufficio del tenant.
 *  - Ogni allerta ha un id univoco per giorno; dopo dismiss l'id è salvato in AsyncStorage.
 *  - Icona lampeggiante ⚡ per attirare l'attenzione senza essere invasiva.
 */

type Alert = { id: string; severity: "red" | "orange" | "yellow"; icon: string; title: string; detail: string };
type WeatherToday = { icon_key?: string; label?: string; temp_min?: number; temp_max?: number; precipitation_mm?: number; wind_kmh?: number };
type AlertsRes = { alerts: Alert[]; weather?: WeatherToday | null; place?: string | null; needs_address?: boolean };
const STORAGE_KEY_PREFIX = "weather_alert_dismissed_";


export function WeatherAlertsCard() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const pulse = React.useRef(new Animated.Value(1)).current;

  const load = useCallback(async () => {
    try {
      // Permission GPS (best-effort, senza forzare il prompt se già negato)
      let coords: { latitude: number; longitude: number } | null = null;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          try {
            const loc = await Location.getLastKnownPositionAsync({ maxAge: 1000 * 60 * 60 });
            coords = loc?.coords || null;
          } catch { /* ignore */ }
        } else if (perm.canAskAgain && Platform.OS !== "web") {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.granted) {
            try {
              const loc = await Location.getCurrentPositionAsync({});
              coords = loc?.coords || null;
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      // Senza GPS il backend usa home_address dell'utente → office_address del tenant
      const res = await api<AlertsRes>("/weather/alerts", {
        method: "POST",
        body: coords ? { lat: coords.latitude, lon: coords.longitude } : {},
      });
      setAlerts(res?.alerts || []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Load dismissed set
      try {
        const keys = await AsyncStorage.getAllKeys();
        const s = new Set<string>();
        keys.forEach((k) => { if (k.startsWith(STORAGE_KEY_PREFIX)) s.add(k.substring(STORAGE_KEY_PREFIX.length)); });
        setDismissed(s);
      } catch { /* ignore */ }
      await load();
    })();
  }, [load]);

  // Lampeggio icona flash
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== "web" }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const dismiss = async (id: string) => {
    setDismissed((prev) => new Set([...prev, id]));
    try { await AsyncStorage.setItem(STORAGE_KEY_PREFIX + id, "1"); } catch { /* ignore */ }
  };

  // V50.z116 — Questo componente mostra SOLO le allerte attive: se non ci sono,
  // non renderizza nulla (il meteo "sempre visibile" è il widget WeatherWidget).
  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (loading || visible.length === 0) return null;

  return (
    <View style={styles.wrap} testID="weather-alerts">
      {visible.map((a) => (
        <View key={a.id} style={[styles.card, sevStyle(a.severity)]} testID={`weather-alert-${a.id}`}>
          <Animated.View style={{ opacity: pulse }}>
            <Ionicons name="flash" size={22} color="#FFF" />
          </Animated.View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{a.title}</Text>
            <Text style={styles.detail}>{a.detail}</Text>
          </View>
          <Pressable onPress={() => dismiss(a.id)} hitSlop={8} style={styles.dismissBtn} testID={`alert-dismiss-${a.id}`}>
            <Ionicons name="eye-off" size={18} color="#FFF" />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function sevStyle(sev: string) {
  if (sev === "red") return { backgroundColor: "#DC2626" };
  if (sev === "orange") return { backgroundColor: "#EA580C" };
  return { backgroundColor: "#CA8A04" };
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  title: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  detail: { color: "rgba(255,255,255,0.9)", fontSize: 11, marginTop: 2 },
  dismissBtn: { padding: 6, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.2)" },
});
