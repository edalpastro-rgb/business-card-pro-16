import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Platform, Modal, TextInput, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

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

const WEATHER_ICON: Record<string, { name: any; color: string }> = {
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

export function WeatherAlertsCard() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [weather, setWeather] = useState<WeatherToday | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [needsAddress, setNeedsAddress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [addrModal, setAddrModal] = useState(false);
  const [addrDraft, setAddrDraft] = useState("");
  const [saving, setSaving] = useState(false);
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
      setWeather(res?.weather || null);
      setPlace(res?.place || null);
      setNeedsAddress(!!res?.needs_address);
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

  const openAddrModal = async () => {
    try {
      const us = await api<{ home_address?: string }>("/user-settings");
      setAddrDraft(us?.home_address || "");
    } catch { setAddrDraft(""); }
    setAddrModal(true);
  };
  const saveAddress = async () => {
    setSaving(true);
    try {
      await api("/user-settings", { method: "PUT", body: { home_address: addrDraft.trim() } });
      setAddrModal(false);
      setLoading(true);
      await load();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  const icon = WEATHER_ICON[weather?.icon_key || ""] || WEATHER_ICON.cloudy;

  return (
    <View style={styles.wrap} testID="weather-widget">
      <View style={styles.weatherCard}>
        {loading ? (
          <ActivityIndicator color={theme.color.brandPrimary} style={{ marginVertical: 6 }} />
        ) : needsAddress ? (
          <View style={styles.weatherRow}>
            <View style={[styles.weatherIconBox, { backgroundColor: "#EEF2FF" }]}>
              <Ionicons name="location-outline" size={22} color={theme.color.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.weatherTitle}>Meteo & Allerte</Text>
              <Text style={styles.weatherSub}>Imposta il tuo indirizzo di residenza per vedere meteo e allerte della tua zona.</Text>
            </View>
            <Pressable onPress={openAddrModal} style={styles.setAddrBtn} testID="weather-set-address">
              <Text style={styles.setAddrTxt}>Imposta</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.weatherRow}>
            <View style={[styles.weatherIconBox, { backgroundColor: icon.color + "1A" }]}>
              <Ionicons name={icon.name} size={26} color={icon.color} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={styles.weatherTemp} testID="weather-temp">
                  {weather?.temp_max != null ? `${Math.round(weather.temp_max)}°` : "—"}
                </Text>
                {weather?.temp_min != null && <Text style={styles.weatherMin}>min {Math.round(weather.temp_min)}°</Text>}
              </View>
              <Text style={styles.weatherLabel} numberOfLines={1}>{weather?.label || "Meteo non disponibile"}</Text>
              <Pressable onPress={openAddrModal} style={styles.placeRow} hitSlop={6} testID="weather-place">
                <Ionicons name="location" size={11} color={theme.color.muted} />
                <Text style={styles.placeTxt} numberOfLines={1}>{place || "Posizione"}</Text>
                <Ionicons name="create-outline" size={11} color={theme.color.brandPrimary} />
              </Pressable>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              {visible.length === 0 ? (
                <View style={styles.okPill}>
                  <Ionicons name="shield-checkmark" size={12} color="#16A34A" />
                  <Text style={styles.okPillTxt}>Nessuna allerta</Text>
                </View>
              ) : (
                <View style={[styles.okPill, { backgroundColor: "#FEF3C7" }]}>
                  <Ionicons name="warning" size={12} color="#B45309" />
                  <Text style={[styles.okPillTxt, { color: "#B45309" }]}>{visible.length} {visible.length === 1 ? "allerta" : "allerte"}</Text>
                </View>
              )}
              {weather?.wind_kmh != null && <Text style={styles.weatherMeta}>vento {Math.round(weather.wind_kmh)} km/h</Text>}
              {weather?.precipitation_mm != null && weather.precipitation_mm > 0 && <Text style={styles.weatherMeta}>{weather.precipitation_mm} mm</Text>}
            </View>
          </View>
        )}
      </View>

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

      <Modal visible={addrModal} transparent animationType="fade" onRequestClose={() => setAddrModal(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Indirizzo di residenza</Text>
            <Text style={styles.modalHint}>Usato per meteo e allerte quando il GPS non è disponibile. Ogni utente (master, manager, collaboratore) ha il proprio.</Text>
            <TextInput
              testID="weather-address-input"
              value={addrDraft}
              onChangeText={setAddrDraft}
              placeholder="es. Via Roma 10, Torino"
              placeholderTextColor="#94A3B8"
              style={styles.modalInput}
              autoCapitalize="words"
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable onPress={() => setAddrModal(false)} style={[styles.modalBtn, { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border }]}>
                <Text style={{ color: theme.color.onSurface, fontWeight: "700" }}>Annulla</Text>
              </Pressable>
              <Pressable testID="weather-address-save" onPress={saveAddress} disabled={saving} style={[styles.modalBtn, { backgroundColor: theme.color.brandPrimary, opacity: saving ? 0.6 : 1 }]}>
                {saving ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontWeight: "700" }}>Salva</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  weatherCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.color.border },
  weatherRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  weatherIconBox: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  weatherTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  weatherSub: { fontSize: 11.5, color: theme.color.muted, marginTop: 2 },
  weatherTemp: { fontSize: 22, fontWeight: "900", color: theme.color.onSurface },
  weatherMin: { fontSize: 12, color: theme.color.muted, fontWeight: "600" },
  weatherLabel: { fontSize: 12.5, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  weatherMeta: { fontSize: 10.5, color: theme.color.muted },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, minHeight: 20 },
  placeTxt: { fontSize: 11, color: theme.color.muted, flexShrink: 1 },
  okPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: "#DCFCE7" },
  okPillTxt: { fontSize: 10.5, fontWeight: "800", color: "#16A34A" },
  setAddrBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.color.brandPrimary, minHeight: 36, justifyContent: "center" },
  setAddrTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  title: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  detail: { color: "rgba(255,255,255,0.9)", fontSize: 11, marginTop: 2 },
  dismissBtn: { padding: 6, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.2)" },
  modalBack: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, padding: 18 },
  modalTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  modalHint: { fontSize: 12, color: theme.color.muted, marginTop: 4, marginBottom: 10 },
  modalInput: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", minHeight: 44 },
});
