import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

/**
 * V50.z81 — Personalizza Home: toggle + reorder (↑↓) dei widget dashboard.
 * Widget "coming soon" (PUN, Richieste info) sono attivabili ma mostrano un placeholder.
 */

type Widget = { id: string; enabled: boolean; order: number; label: string; coming_soon: boolean };

const ICONS: Record<string, keyof typeof import("@expo/vector-icons/build/Ionicons").default.glyphMap> = {
  weather: "cloud",
  contacts_total: "people",
  appointments_today: "calendar",
  deadlines_alerts: "warning",
  pun: "flash",
  info_requests: "help-circle",
};

export default function DashboardConfigScreen() {
  const router = useRouter();
  const insets = useInsetsSafe(); // V50.z165 — fallback bottom dentro Modal
  // Sulla web preview c'è la tab bar persistente (~64px). Aggiungiamo margine.
  const footerBottom = (Platform.OS === "web" ? 72 : 0) + Math.max(insets.bottom, 8);
  const [items, setItems] = useState<Widget[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ widgets: Widget[] }>(`/settings/dashboard-widgets`);
      setItems((res.widgets || []).sort((a, b) => a.order - b.order));
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare la configurazione");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setItems(next.map((w, i) => ({ ...w, order: i })));
  };

  const toggle = (idx: number) => {
    const next = [...items];
    next[idx] = { ...next[idx], enabled: !next[idx].enabled };
    setItems(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { widgets: items.map((w, i) => ({ id: w.id, enabled: w.enabled, order: i })) };
      await api(`/settings/dashboard-widgets`, { method: "PUT", body: payload });
      notify("Salvato", "Configurazione home aggiornata");
      router.back();
    } catch (e: any) {
      notify("Errore", e?.message || "Salvataggio fallito");
    } finally { setSaving(false); }
  };

  const reset = () => {
    setItems([
      { id: "weather",            enabled: true,  order: 0, label: "Allerte meteo (solo se attive)", coming_soon: false },
      { id: "meteo",              enabled: true,  order: 1, label: "Meteo",                    coming_soon: false },
      { id: "contacts_total",     enabled: true,  order: 2, label: "Contatti totali",          coming_soon: false },
      { id: "appointments_today", enabled: true,  order: 2, label: "Appuntamenti di oggi",     coming_soon: false },
      { id: "deadlines_alerts",   enabled: true,  order: 3, label: "Alert scadenze",           coming_soon: false },
      { id: "pun",                enabled: false, order: 4, label: "PUN aggiornato",           coming_soon: true },
      { id: "cgym",               enabled: true,  order: 5, label: "Corporate Gym",            coming_soon: false },
      { id: "info_requests",      enabled: false, order: 5, label: "Richieste info in attesa", coming_soon: true },
    ]);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="dashcfg-back">
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Personalizza Home</Text>
        <Pressable onPress={reset} hitSlop={8} testID="dashcfg-reset">
          <Text style={styles.resetTxt}>Ripristina</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 + footerBottom }}>
        <Text style={styles.desc}>
          Scegli quali widget mostrare in home e in quale ordine. Le modifiche valgono solo per il tuo account.
        </Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={theme.color.brandPrimary} />
        ) : (
          items.map((w, i) => (
            <View key={w.id} style={[styles.card, !w.enabled && { opacity: 0.55 }]} testID={`dashcfg-item-${w.id}`}>
              <View style={styles.left}>
                <View style={styles.orderBox}>
                  <Pressable disabled={i === 0} onPress={() => move(i, -1)} hitSlop={6} style={[styles.arrow, i === 0 && { opacity: 0.3 }]} testID={`dashcfg-up-${w.id}`}>
                    <Ionicons name="chevron-up" size={16} color={theme.color.onSurface} />
                  </Pressable>
                  <Pressable disabled={i === items.length - 1} onPress={() => move(i, 1)} hitSlop={6} style={[styles.arrow, i === items.length - 1 && { opacity: 0.3 }]} testID={`dashcfg-down-${w.id}`}>
                    <Ionicons name="chevron-down" size={16} color={theme.color.onSurface} />
                  </Pressable>
                </View>
                <View style={styles.iconBox}>
                  <Ionicons name={ICONS[w.id] || "square"} size={18} color={theme.color.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{w.label}</Text>
                  {w.coming_soon ? <Text style={styles.hint}>In arrivo · placeholder</Text> : <Text style={styles.hint}>Posizione {i + 1}</Text>}
                </View>
              </View>
              <Switch
                value={w.enabled}
                onValueChange={() => toggle(i)}
                trackColor={{ true: theme.color.brandPrimary, false: "#CBD5E1" }}
                thumbColor="#FFF"
                testID={`dashcfg-toggle-${w.id}`}
              />
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { bottom: footerBottom }]}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="dashcfg-save">
          {saving ? <ActivityIndicator color="#FFF" /> : (
            <>
              <Ionicons name="checkmark-circle" size={16} color="#FFF" />
              <Text style={styles.saveTxt}>Salva configurazione</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  title: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  resetTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 13 },
  desc: { fontSize: 13, color: theme.color.muted, marginBottom: 14, lineHeight: 18 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  left: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  orderBox: { gap: 2 },
  arrow: { padding: 2, borderRadius: 6, backgroundColor: "#F1F5F9" },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.brandPrimary + "18" },
  name: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  hint: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  footer: { position: "absolute", left: 0, right: 0, padding: 16, backgroundColor: "#FFF", borderTopWidth: 1, borderTopColor: theme.color.border },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: 12 },
  saveTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
});
