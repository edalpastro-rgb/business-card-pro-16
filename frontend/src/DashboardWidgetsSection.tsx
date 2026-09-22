import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { WeatherAlertsCard } from "@/src/WeatherAlertsCard";
import { WeatherWidget } from "@/src/WeatherWidget";
import { CgymWidget } from "@/src/corporate-gym/CgymWidget"; // Corporate Gym (Blocco 1)

/**
 * V50.z81 — Sezione widget home configurabili.
 * Renderizza in ordine i widget abilitati dalla config utente
 * (fetch `/settings/dashboard-widgets`). I widget "coming soon" (PUN, Richieste info)
 * appaiono solo se l'utente li abilita e mostrano un placeholder "in arrivo".
 */

type Widget = { id: string; enabled: boolean; order: number; label: string; coming_soon: boolean };
type PunLatest = { available: boolean; month_name?: string; month_short?: string; year?: number; F1?: number; F2?: number; F3?: number; monorario?: number; unit?: string; source_url?: string; delta_pct?: number | null; delta_f1_pct?: number | null; delta_f2_pct?: number | null; delta_f3_pct?: number | null; partial?: boolean; partial_days?: number | null; partial_updated_at?: string | null };

// V50.z132 — `only` / `exclude` permettono di renderizzare un sottoinsieme di
// widget in punti diversi della Home (es. "Appuntamenti di oggi" sotto Ritelefonate).
export function DashboardWidgetsSection({ only, exclude }: { only?: string[]; exclude?: string[] } = {}) {
  const router = useRouter();
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [counts, setCounts] = useState<{ apptToday?: number }>({});
  const [pun, setPun] = useState<PunLatest | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cfg, apptStats, punRes] = await Promise.allSettled([
        api<{ widgets: Widget[] }>(`/settings/dashboard-widgets`),
        api<{ mine: { total: number; done: number; undone: number } }>(`/appointments/stats?days=1`),
        api<PunLatest>(`/pun/latest`),
      ]);
      if (cfg.status === "fulfilled") setWidgets(cfg.value.widgets || []);
      const next: typeof counts = {};
      if (apptStats.status === "fulfilled") next.apptToday = apptStats.value?.mine?.total || 0;
      if (punRes.status === "fulfilled") setPun(punRes.value);
      setCounts(next);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const active = useMemo(
    () => widgets
      .filter((w) => w.enabled)
      .filter((w) => (only ? only.includes(w.id) : true) && !(exclude || []).includes(w.id))
      .sort((a, b) => a.order - b.order),
    [widgets, only, exclude],
  );

  if (loading && active.length === 0) {
    if (only) return null;
    return <ActivityIndicator style={{ marginVertical: 8 }} color={theme.color.brandPrimary} />;
  }
  if (active.length === 0) return null;

  return (
    <View style={styles.wrap} testID="home-dashboard-widgets">
      {active.map((w) => {
        if (w.id === "weather") return <WeatherAlertsCard key="weather" />;
        if (w.id === "meteo") return <WeatherWidget key="meteo" />; // V50.z162 — visibile SOLO con allerte attive (la temperatura resta nel badge header)
        if (w.id === "appointments_today") {
          return <MiniStatCard key="appointments_today" testID="widget-appt-today" icon="calendar" label="Appuntamenti di oggi" value={counts.apptToday ?? "…"} color="#7C3AED" onPress={() => router.push("/(tabs)/calendario" as any)} />;
        }
        if (w.id === "cgym") return <CgymWidget key="cgym" />; // Corporate Gym (Blocco 1)
        if (w.id === "pun") {
          return <PunLiveCard key="pun" data={pun} />;
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
  const unit = data.unit || "€/MWh";
  // V50.z327 — mese corrente parziale (job giornaliero GME): etichetta «parziale · N gg · agg. gg/mm»
  const upd = data.partial_updated_at ? new Date(data.partial_updated_at) : null;
  const partialTxt = data.partial ? `PUN ${data.month_short || ""} parziale · ${data.partial_days || 0} gg${upd ? ` · agg. ${upd.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}` : ""}` : null;
  return (
    <View style={{ gap: 4 }} testID="widget-pun">
      <View style={styles.punCardCompact}>
        <PunFascia label="F1" value={data.F1} delta={data.delta_f1_pct} monthTag={data.month_short} unit={unit} bg="#EEF2FF" fg="#4338CA" />
        <PunFascia label="F2" value={data.F2} delta={data.delta_f2_pct} unit={unit} bg="#FEF3C7" fg="#B45309" />
        <PunFascia label="F3" value={data.F3} delta={data.delta_f3_pct} unit={unit} bg="#DCFCE7" fg="#15803D" />
      </View>
      {partialTxt ? <Text style={styles.punPartial} testID="widget-pun-partial">{partialTxt} · Δ vs mese chiuso</Text> : null}
    </View>
  );
}

function PunFascia({ label, value, delta, monthTag, unit, bg, fg }: { label: string; value?: number; delta?: number | null; monthTag?: string; unit: string; bg: string; fg: string }) {
  const dTxt = typeof delta === "number" ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : null;
  const dColor = typeof delta === "number" ? (delta >= 0 ? "#DC2626" : "#16A34A") : fg;
  return (
    <View style={[styles.fasciaBox, { backgroundColor: bg }]}>
      <View style={styles.fasciaTopRow}>
        <Text style={[styles.fasciaLabel, { color: fg }]}>{label}</Text>
        {monthTag ? <Text style={[styles.fasciaMonth, { color: fg }]}>{monthTag}</Text> : null}
      </View>
      <Text style={[styles.fasciaVal, { color: fg }]}>{typeof value === "number" ? value.toFixed(1) : "—"}</Text>
      <Text style={[styles.fasciaUnit, { color: fg }]}>{unit}</Text>
      {dTxt ? <Text style={[styles.fasciaDelta, { color: dColor }]}>{dTxt}</Text> : null}
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
  // V50.z87 — Compatto: no header, solo 3 fasce (altezza ridotta)
  punCardCompact: { flexDirection: "row", gap: 6, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border, borderRadius: 14, padding: 6 },
  punHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  punTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  deltaPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  deltaTxt: { fontSize: 11, fontWeight: "800" },
  punFasce: { flexDirection: "row", gap: 6 },
  fasciaBox: { flex: 1, alignItems: "center", paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10 },
  fasciaTopRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  fasciaLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  fasciaMonth: { fontSize: 8, fontWeight: "800", letterSpacing: 0.6, opacity: 0.75 },
  punPartial: { fontSize: 10, color: theme.color.muted, textAlign: "center", fontWeight: "600" },
  fasciaVal: { fontSize: 14, fontWeight: "900", marginTop: 1 },
  fasciaUnit: { fontSize: 8, fontWeight: "700", opacity: 0.7 },
  fasciaDelta: { fontSize: 10, fontWeight: "800", marginTop: 2 },
});
