import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { CalculatorFAB } from "@/src/CalculatorFAB";
import { MetricBoxClickable, MetricDrillModal, MetricKey } from "@/src/StatMetrics";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Outcome = { id: string; name: string; color: string; icon?: string; counts_as?: string };
type ReportStats = { period: string; start: string; end: string; stats: { energy: any; network: any }; outcomes?: { outcome_id: string; count: number }[] };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string; appointment_outcomes?: Outcome[] };

const PERIODS: { key: "day" | "week" | "month" | "year"; label: string }[] = [
  { key: "day", label: "Giorno" }, { key: "week", label: "Settimana" }, { key: "month", label: "Mese" }, { key: "year", label: "Anno" },
];

export default function ReportScreen() {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("week");
  const [data, setData] = useState<ReportStats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<{ metric: MetricKey; area: "energy" | "network" | null; color: string; title: string } | null>(null);
  const pagePad = usePageBottomPadding();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([api<ReportStats>("/reports", { query: { period } }), api<Settings>("/settings")]);
      setData(r); setSettings(s);
    } finally { setLoading(false); }
  }, [period]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderArea = (areaKey: "energy" | "network") => {
    const s = data?.stats[areaKey];
    const title = areaKey === "energy" ? settings?.energy_title : settings?.network_title;
    const color = areaKey === "energy" ? (settings?.energy_color || theme.color.energy) : (settings?.network_color || theme.color.network);
    const openDrill = (m: MetricKey) => setDrill({ metric: m, area: areaKey, color, title: title || "" });
    return (
      <View style={[styles.areaCard, { borderTopColor: color }]} testID={`report-${areaKey}`}>
        <Text style={[styles.areaTitle, { color }]}>{title}</Text>
        <View style={styles.grid}>
          <MetricBoxClickable testID={`report-${areaKey}-appointments_done`} label="Appuntamenti fatti" value={s?.appointments_done ?? 0} color={color} onPress={() => openDrill("appointments_done")} />
          <MetricBoxClickable testID={`report-${areaKey}-appointments_total`} label="Totale programmati" value={s?.appointments_total ?? 0} color={color} onPress={() => openDrill("appointments_total")} />
          <MetricBoxClickable testID={`report-${areaKey}-phone_done`} label="Telefonate fatte" value={s?.phone_done ?? 0} color={color} onPress={() => openDrill("phone_done")} />
          <MetricBoxClickable testID={`report-${areaKey}-contracts`} label="Contratti" value={s?.contracts ?? 0} color={color} onPress={() => openDrill("contracts")} />
          <MetricBoxClickable testID={`report-${areaKey}-products`} label="Prodotti venduti" value={s?.products ?? 0} color={color} onPress={() => openDrill("products")} />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}><Text style={styles.title}>Report</Text></View>
      <View style={styles.segments}>
        {PERIODS.map((p) => (
          <Pressable
            key={p.key}
            testID={`period-${p.key}`}
            onPress={() => setPeriod(p.key)}
            style={[styles.seg, period === p.key && styles.segActive]}
          >
            <Text style={[styles.segTxt, period === p.key && styles.segTxtActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: pagePad }}>
          {renderArea("energy")}
          {renderArea("network")}

          {/* Outcomes breakdown */}
          {settings?.appointment_outcomes && settings.appointment_outcomes.length > 0 && (
            <View style={styles.areaCard}>
              <Text style={[styles.areaTitle, { color: theme.color.brandPrimary }]}>Esiti appuntamenti</Text>
              {(() => {
                const outMap: Record<string, number> = {};
                (data?.outcomes || []).forEach((o) => { outMap[o.outcome_id] = o.count; });
                const rows = (settings.appointment_outcomes || []).map((o) => ({ ...o, count: outMap[o.id] || 0 })).sort((a, b) => b.count - a.count);
                const totalMarked = rows.reduce((sum, r) => sum + r.count, 0);
                if (totalMarked === 0) {
                  return <Text style={{ color: theme.color.muted, fontStyle: "italic", fontSize: 13 }}>Nessun esito registrato nel periodo selezionato.</Text>;
                }
                return (
                  <View style={{ gap: 8 }}>
                    {rows.map((o) => {
                      const pct = totalMarked > 0 ? (o.count / totalMarked) : 0;
                      return (
                        <View key={o.id} style={styles.outcomeRow}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <View style={[styles.outDot, { backgroundColor: o.color }]} />
                            <Text style={styles.outName}>{o.name}</Text>
                            <View style={{ flex: 1 }} />
                            <Text style={[styles.outCount, { color: o.color }]}>{o.count}</Text>
                          </View>
                          <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: o.color }]} />
                          </View>
                        </View>
                      );
                    })}
                    <Text style={{ color: theme.color.muted, fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
                      Totale esiti registrati: {totalMarked}
                    </Text>
                  </View>
                );
              })()}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
      <CalculatorFAB />
      <MetricDrillModal
        visible={!!drill}
        onClose={() => setDrill(null)}
        metric={drill?.metric || null}
        area={drill?.area || null}
        startIso={data?.start || ""}
        endIso={data?.end || ""}
        color={drill?.color || theme.color.brandPrimary}
        title={drill?.title || "Dettaglio"}
      />
    </SafeAreaView>
  );
}

function _UnusedMetricBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricVal, { color }]}>{value}</Text>
      <Text style={styles.metricLbl}>{label}</Text>
    </View>
  );
}
void _UnusedMetricBox;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: theme.color.onSurface },
  segments: { flexDirection: "row", gap: 6, backgroundColor: theme.color.surfaceTertiary, marginHorizontal: 16, borderRadius: theme.radius.pill, padding: 4 },
  seg: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: theme.radius.pill },
  segActive: { backgroundColor: "#FFF" },
  segTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 12 },
  segTxtActive: { color: theme.color.brandPrimary },
  areaCard: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 16, borderTopWidth: 4, gap: 12, borderWidth: 1, borderColor: theme.color.border },
  areaTitle: { fontSize: 15, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { width: "48%", backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12 },
  metricVal: { fontSize: 26, fontWeight: "700" },
  metricLbl: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  outcomeRow: {},
  outDot: { width: 10, height: 10, borderRadius: 5 },
  outName: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface, flex: 1 },
  outCount: { fontSize: 16, fontWeight: "800" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: theme.color.surfaceTertiary, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
});
