import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

/**
 * V50.z79 — Banner allerte meteo in Home (Open-Meteo + soglie Protezione Civile-like).
 * Comportamento:
 *  - GPS al primo utilizzo → fetch allerte per la posizione dell'agente.
 *  - Ogni allerta ha un id univoco per giorno; dopo dismiss l'id è salvato in AsyncStorage
 *    e non riappare fino a nuova allerta.
 *  - Icona lampeggiante ⚡ per attirare l'attenzione senza essere invasiva.
 */

type Alert = { id: string; severity: "red" | "orange" | "yellow"; icon: string; title: string; detail: string };
const STORAGE_KEY_PREFIX = "weather_alert_dismissed_";

export function WeatherAlertsCard() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const pulse = React.useRef(new Animated.Value(1)).current;

  const load = useCallback(async () => {
    try {
      // Permission GPS (best-effort)
      const perm = await Location.getForegroundPermissionsAsync();
      let coords: { latitude: number; longitude: number } | null = null;
      if (perm.granted) {
        try {
          const loc = await Location.getLastKnownPositionAsync({ maxAge: 1000 * 60 * 60 });
          coords = loc?.coords || null;
        } catch { /* ignore */ }
      } else if (perm.canAskAgain) {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.granted) {
          try {
            const loc = await Location.getCurrentPositionAsync({});
            coords = loc?.coords || null;
          } catch { /* ignore */ }
        }
      }
      if (!coords) {
        // Fallback: chiedi al backend le impostazioni per office_address; se manca, esci
        try {
          const settings = await api<{ office_address?: string }>("/settings");
          const office = (settings?.office_address || "").trim();
          if (!office) {
            setAlerts([]);
            return;
          }
          // Geocode office via backend distances endpoint (usa cache)
          // Semplificazione: chiediamo un finto batch con office = origin e stesso target → ci basta origin_valid
          // Per non complicare, se non abbiamo GPS non mostriamo allerte.
          setAlerts([]);
          return;
        } catch { setAlerts([]); return; }
      }
      const res = await api<{ alerts: Alert[] }>("/weather/alerts", {
        method: "POST",
        body: { lat: coords.latitude, lon: coords.longitude },
      });
      setAlerts(res?.alerts || []);
    } catch {
      setAlerts([]);
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

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {visible.map((a) => (
        <View key={a.id} style={[styles.card, sevStyle(a.severity)]}>
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
