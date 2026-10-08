import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z334 — Home dark/premium
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
type PunLatest = { available: boolean; month_name?: string; month_short?: string; year?: number; data_last_day?: string | null; data_day?: number | null; F1?: number; F2?: number; F3?: number; monorario?: number; unit?: string; source_url?: string; delta_pct?: number | null; delta_f1_pct?: number | null; delta_f2_pct?: number | null; delta_f3_pct?: number | null; partial?: boolean; partial_days?: number | null; partial_updated_at?: string | null };

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
    return <ActivityIndicator style={{ marginVertical: 8 }} color={HT.brand} />;
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
      <Ionicons name="chevron-forward" size={16} color={HT.muted} />
    </Pressable>
  );
}

function ComingSoonCard({ label, icon }: { label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={[styles.card, styles.coming]}>
      <View style={[styles.iconBadge, { backgroundColor: HT.glassStrong }]}>
        <Ionicons name={icon} size={16} color={HT.muted} />
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
  const router = useRouter();
  // V50.z469 — Feature 5: widget cliccabile → schermata «Storico PUN» (18 mesi + PDF)
  const openHistory = () => router.push("/pun-storico" as any);
  if (!data || !data.available) {
    return (
      <Pressable onPress={openHistory} style={[styles.card, styles.coming]} testID="widget-pun">
        <View style={[styles.iconBadge, { backgroundColor: HT.warningTint }]}>
          <Ionicons name="flash" size={16} color={HT.warning} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.value}>—</Text>
          <Text style={styles.label} numberOfLines={1}>PUN — dati non disponibili</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={HT.muted} />
      </Pressable>
    );
  }
  const unit = data.unit || "€/MWh";
  // V50.z327 — mese corrente parziale (job giornaliero GME): etichetta «parziale · N gg · agg. gg/mm»
  const upd = data.partial_updated_at ? new Date(data.partial_updated_at) : null;
  const partialTxt = data.partial ? `PUN ${data.month_short || ""} parziale · ${data.partial_days || 0} gg${upd ? ` · agg. ${upd.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}` : ""}` : null;
  // V50.z334 — card dark con accenti vivaci (ciano F1 · arancio F2 · verde F3), niente pastelli
  return (
    <Pressable onPress={openHistory} style={({ pressed }) => [{ gap: 4 }, pressed && { opacity: 0.85 }]} testID="widget-pun">
      <View style={styles.punCardCompact}>
        <View style={styles.punHeadCol}>
          <View style={[styles.iconBadge, { backgroundColor: HT.warningTint }]}>
            <Ionicons name="flash" size={16} color={HT.warning} />
          </View>
          <Text style={styles.punTitle}>PUN</Text>
          {/* V50.z420 — etichetta = mese + ultimo giorno coperto dal job pun-fetcher (es. «SET 30»), non più l'anno troncato («SET 26») */}
          {data.month_short ? <Text style={styles.punMonth} testID="widget-pun-month">{data.month_short}{data.data_day ? ` ${data.data_day}` : ""}</Text> : null}
        </View>
        <PunFascia label="F1" value={data.F1} delta={data.delta_f1_pct} unit={unit} bg={HT.axonTint} fg={HT.axon} />
        <PunFascia label="F2" value={data.F2} delta={data.delta_f2_pct} unit={unit} bg={HT.brandTint} fg="#FB923C" />
        <PunFascia label="F3" value={data.F3} delta={data.delta_f3_pct} unit={unit} bg={HT.successTint} fg={HT.success} />
      </View>
      <Text style={styles.punPartial} testID="widget-pun-partial">{partialTxt ? `${partialTxt} · Δ vs mese chiuso · ` : ""}Tocca per lo storico 18 mesi ›</Text>
    </Pressable>
  );
}

function PunFascia({ label, value, delta, unit, bg, fg }: { label: string; value?: number; delta?: number | null; unit: string; bg: string; fg: string }) {
  const dTxt = typeof delta === "number" ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : null;
  const dColor = typeof delta === "number" ? (delta >= 0 ? HT.danger : HT.success) : fg;
  return (
    <View style={[styles.fasciaBox, { backgroundColor: bg, borderColor: fg + "55" }]}>
      <Text style={[styles.fasciaLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.fasciaVal, { color: HT.text }]}>{typeof value === "number" ? value.toFixed(1) : "—"}</Text>
      <Text style={styles.fasciaUnit}>{unit}</Text>
      {dTxt ? <Text style={[styles.fasciaDelta, { color: dColor }]}>{dTxt}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 8 },
  card: { ...HT.cardShadow, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 12 },
  coming: { backgroundColor: HT.card },
  iconBadge: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  value: { fontSize: 22, fontWeight: "900", color: HT.text, letterSpacing: -0.5 },
  label: { fontSize: 12, fontWeight: "700", color: HT.muted },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: HT.glassStrong },
  badgeTxt: { fontSize: 10, fontWeight: "800", color: HT.text2, textTransform: "uppercase", letterSpacing: 0.5 },
  punCardCompact: { ...HT.cardShadow, flexDirection: "row", alignItems: "stretch", gap: 6, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, padding: 8 },
  punHeadCol: { width: 52, alignItems: "center", justifyContent: "center", gap: 2 },
  punTitle: { fontSize: 11, fontWeight: "900", color: HT.text, letterSpacing: 0.8 },
  punMonth: { fontSize: 9, fontWeight: "700", color: HT.muted, textTransform: "uppercase" },
  fasciaBox: { flex: 1, alignItems: "center", paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1 },
  fasciaLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  punPartial: { fontSize: 10, color: HT.muted, textAlign: "center", fontWeight: "600" },
  fasciaVal: { fontSize: 15, fontWeight: "900", marginTop: 1, letterSpacing: -0.3 },
  fasciaUnit: { fontSize: 8, fontWeight: "700", color: HT.muted },
  fasciaDelta: { fontSize: 10, fontWeight: "800", marginTop: 2 },
});
