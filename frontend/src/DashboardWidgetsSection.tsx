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
type PunLatest = { available: boolean; month_name?: string; year?: number; F1?: number; F2?: number; F3?: number; monorario?: number; unit?: string; source_url?: string; delta_pct?: number | null };

export function DashboardWidgetsSection() {
  const router = useRouter();
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [counts, setCounts] = useState<{ contacts?: number; apptToday?: number; deadlines?: number; infoPending?: number }>({});
  const [pun, setPun] = useState<PunLatest | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cfg, apptStats, dlRes, contactsRes, punRes, infoCnt] = await Promise.allSettled([
        api<{ widgets: Widget[] }>(`/settings/dashboard-widgets`),
        api<{ mine: { total: number; done: number; undone: number } }>(`/appointments/stats?days=1`),
        api<{ items: unknown[]; counts: { expired: number; critical: number; warning: number; ok: number } }>(`/deadlines/upcoming`),
        api<{ items?: unknown[]; total?: number }>(`/contacts?limit=1`),
        api<PunLatest>(`/pun/latest`),
        api<{ pending: number }>(`/info-requests/count`),
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
      if (infoCnt.status === "fulfilled") next.infoPending = infoCnt.value?.pending || 0;
      if (punRes.status === "fulfilled") setPun(punRes.value);
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
        if (w.id === "pun") {
          return <PunLiveCard key="pun" data={pun} />;
        }
        if (w.id === "info_requests") {
          const n = counts.infoPending ?? 0;
          return <MiniStatCard key="info_requests" testID="widget-info-req" icon="help-circle" label={`Richieste info in attesa`} value={n} color={n > 0 ? "#F59E0B" : "#16A34A"} onPress={() => router.push("/info-requests" as any)} />;
        }
        if (w.coming_soon) return <ComingSoonCard key={w.id} label={w.label} icon={pickIcon(w.id)} />;
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

function PunLiveCard({ data }: { data: PunLatest | null }) {
  if (!data || !data.available) {
    return (
      <View style={[styles.card, styles.coming]}>
        <View style={[styles.iconBadge, { backgroundColor: "#FEF3C7" }]}>
          <Ionicons name="flash" size={16} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.value}>—</Text>
          <Text style={styles.label} numberOfLines={1}>PUN — dati non disponibili</Text>
        </View>
      </View>
    );
  }
  const delta = data.delta_pct;
  return (
    <View style={styles.punCard} testID="widget-pun">
      <View style={styles.punHead}>
        <View style={[styles.iconBadge, { backgroundColor: "#FEF3C7" }]}>
          <Ionicons name="flash" size={16} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.punTitle} numberOfLines={1}>PUN · {data.month_name} {data.year}</Text>
          <Text style={styles.label} numberOfLines={1}>Prezzo Unico Nazionale — GME</Text>
        </View>
        {delta != null ? (
          <View style={[styles.deltaPill, { backgroundColor: delta >= 0 ? "#FEE2E2" : "#DCFCE7" }]}>
            <Ionicons name={delta >= 0 ? "trending-up" : "trending-down"} size={11} color={delta >= 0 ? "#DC2626" : "#16A34A"} />
            <Text style={[styles.deltaTxt, { color: delta >= 0 ? "#DC2626" : "#16A34A" }]}>{delta >= 0 ? "+" : ""}{delta}%</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.punFasce}>
        <PunFascia label="F1" value={data.F1} unit={data.unit || "€/MWh"} bg="#EEF2FF" fg="#4338CA" />
        <PunFascia label="F2" value={data.F2} unit={data.unit || "€/MWh"} bg="#FEF3C7" fg="#B45309" />
        <PunFascia label="F3" value={data.F3} unit={data.unit || "€/MWh"} bg="#DCFCE7" fg="#15803D" />
      </View>
    </View>
  );
}

function PunFascia({ label, value, unit, bg, fg }: { label: string; value?: number; unit: string; bg: string; fg: string }) {
  return (
    <View style={[styles.fasciaBox, { backgroundColor: bg }]}>
      <Text style={[styles.fasciaLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.fasciaVal, { color: fg }]}>{typeof value === "number" ? value.toFixed(1) : "—"}</Text>
      <Text style={[styles.fasciaUnit, { color: fg }]}>{unit}</Text>
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
  punCard: { backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 14, padding: 12, gap: 10 },
  punHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  punTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  deltaPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  deltaTxt: { fontSize: 11, fontWeight: "800" },
  punFasce: { flexDirection: "row", gap: 6 },
  fasciaBox: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10 },
  fasciaLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  fasciaVal: { fontSize: 15, fontWeight: "900", marginTop: 2 },
  fasciaUnit: { fontSize: 9, fontWeight: "700", opacity: 0.75, marginTop: 1 },
});
