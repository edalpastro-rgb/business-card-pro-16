import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type ReportStats = { period: string; start: string; end: string; stats: { energy: any; network: any } };
type Settings = { energy_title: string; energy_color: string; network_title: string; network_color: string };

const PERIODS: { key: "day" | "week" | "month" | "year"; label: string }[] = [
  { key: "day", label: "Giorno" }, { key: "week", label: "Settimana" }, { key: "month", label: "Mese" }, { key: "year", label: "Anno" },
];

export default function ReportScreen() {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("week");
  const [data, setData] = useState<ReportStats | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

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
    return (
      <View style={[styles.areaCard, { borderTopColor: color }]} testID={`report-${areaKey}`}>
        <Text style={[styles.areaTitle, { color }]}>{title}</Text>
        <View style={styles.grid}>
          <MetricBox label="Appuntamenti fatti" value={s?.appointments_done ?? 0} color={color} />
          <MetricBox label="Totale programmati" value={s?.appointments_total ?? 0} color={color} />
          <MetricBox label="Telefonate fatte" value={s?.phone_done ?? 0} color={color} />
          <MetricBox label="Contratti" value={s?.contracts ?? 0} color={color} />
          <MetricBox label="Prodotti venduti" value={s?.products ?? 0} color={color} />
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
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          {renderArea("energy")}
          {renderArea("network")}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetricBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricVal, { color }]}>{value}</Text>
      <Text style={styles.metricLbl}>{label}</Text>
    </View>
  );
}

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
});
