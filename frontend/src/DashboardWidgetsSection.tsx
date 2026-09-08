import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { WeatherAlertsCard } from "@/src/WeatherAlertsCard";

/**
 * V50.z81 — Sezione widget home configurabili.
 * Renderizza in ordine i widget abilitati dalla config utente
 * (fetch `/settings/dashboard-widgets`). I widget "coming soon" (PUN, Richieste info)
 * appaiono solo se l'utente li abilita e mostrano un placeholder "in arrivo".
 */

type Widget = { id: string; enabled: boolean; order: number; label: string; coming_soon: boolean };

export function DashboardWidgetsSection() {
  const router = useRouter();
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [counts, setCounts] = useState<{ contacts?: number; apptToday?: number; deadlines?: number }>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cfg, apptStats, dlRes, contactsRes] = await Promise.allSettled([
        api<{ widgets: Widget[] }>(`/settings/dashboard-widgets`),
        api<{ mine: { total: number; done: number; undone: number } }>(`/appointments/stats?days=1`),
        api<{ items: unknown[]; counts: { expired: number; critical: number; warning: number; ok: number } }>(`/deadlines/upcoming`),
        api<{ items?: unknown[]; total?: number }>(`/contacts?limit=1`),
      ]);
      if (cfg.status === "fulfilled") setWidgets(cfg.value.widgets || []);
      const next: typeof counts = {};
      if (apptStats.status === "fulfilled") next.apptToday = apptStats.value?.mine?.total || 0;
      if (dlRes.status === "fulfilled") {
        const c = dlRes.value?.counts || { expired: 0, critical: 0, warning: 0, ok: 0 };
        next.deadlines = (c.expired || 0) + (c.critical || 0) + (c.warning || 0);
      }
      if (contactsRes.status === "fulfilled") {
        const r: any = contactsRes.value;
        next.contacts = (typeof r?.total === "number" ? r.total : Array.isArray(r?.items) ? r.items.length : Array.isArray(r) ? r.length : 0);
      }
      setCounts(next);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = useMemo(() => widgets.filter((w) => w.enabled).sort((a, b) => a.order - b.order), [widgets]);

  if (loading && active.length === 0) {
    return <ActivityIndicator style={{ marginVertical: 8 }} color={theme.color.brandPrimary} />;
  }
  if (active.length === 0) return null;

  return (
    <View style={styles.wrap} testID="home-dashboard-widgets">
      {active.map((w) => {
        if (w.id === "weather") return <WeatherAlertsCard key="weather" />;
        if (w.coming_soon) return <ComingSoonCard key={w.id} label={w.label} icon={pickIcon(w.id)} />;
        if (w.id === "contacts_total") {
          return <MiniStatCard key="contacts_total" testID="widget-contacts" icon="people" label="Contatti totali" value={counts.contacts ?? "…"} color="#0EA5E9" onPress={() => router.push("/(tabs)/contatti" as any)} />;
        }
        if (w.id === "appointments_today") {
          return <MiniStatCard key="appointments_today" testID="widget-appt-today" icon="calendar" label="Appuntamenti di oggi" value={counts.apptToday ?? "…"} color="#7C3AED" onPress={() => router.push("/(tabs)/calendario" as any)} />;
        }
        if (w.id === "deadlines_alerts") {
          const n = counts.deadlines ?? 0;
          return <MiniStatCard key="deadlines_alerts" testID="widget-deadlines" icon="warning" label="Alert scadenze" value={n} color={n > 0 ? "#DC2626" : "#16A34A"} onPress={() => router.push("/(tabs)/report" as any)} />;
        }
        return null;
      })}
    </View>
  );
}

function pickIcon(id: string): keyof typeof Ionicons.glyphMap {
  if (id === "pun") return "flash";
  if (id === "info_requests") return "help-circle";
  return "square";
}

function MiniStatCard({ testID, icon, label, value, color, onPress }: { testID?: string; icon: keyof typeof Ionicons.glyphMap; label: string; value: number | string; color: string; onPress?: () => void }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      <View style={[styles.iconBadge, { backgroundColor: color + "22" }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.value}>{value}</Text>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
    </Pressable>
  );
}

function ComingSoonCard({ label, icon }: { label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={[styles.card, styles.coming]}>
      <View style={[styles.iconBadge, { backgroundColor: "#F1F5F9" }]}>
        <Ionicons name={icon} size={16} color={theme.color.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.value}>—</Text>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.badgeTxt}>Prossimamente</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 14, padding: 12 },
  coming: { backgroundColor: "#F8FAFC" },
  iconBadge: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  value: { fontSize: 22, fontWeight: "900", color: theme.color.onSurface, letterSpacing: -0.5 },
  label: { fontSize: 12, fontWeight: "700", color: theme.color.muted },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#E2E8F0" },
  badgeTxt: { fontSize: 10, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5 },
});
