import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { ModuleErrorBoundary } from "@/src/shared";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type StatsRow = { user_id: string; name: string; role?: string; total: number; done: number; undone: number };
type StatsPayload = {
  range_days: number;
  mine: { total: number; done: number; undone: number };
  group: { total: number; done: number; undone: number };
  per_user: StatsRow[];
};

const RANGES = [7, 30, 90, 180, 365];

export default function AppointmentStatsRoute() {
  return (
    <ModuleErrorBoundary moduleName="appointment-stats">
      <AppointmentStatsScreen />
    </ModuleErrorBoundary>
  );
}

function AppointmentStatsScreen() {
  const router = useRouter();
  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<StatsPayload>(`/appointments/stats?range_days=${rangeDays}`);
      setData(r);
    } catch (e: any) {
      // silent
    } finally { setLoading(false); }
  }, [rangeDays]);

  useEffect(() => { load(); }, [load]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const query = q.trim().toLowerCase();
    if (!query) return data.per_user;
    return data.per_user.filter((r) => r.name.toLowerCase().includes(query));
  }, [data, q]);

  const donePct = (r: { total: number; done: number }) => (r.total === 0 ? 0 : Math.round((r.done / r.total) * 100));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Statistiche appuntamenti</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        {/* Range selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }} contentContainerStyle={{ gap: 6 }}>
          {RANGES.map((d) => (
            <Pressable
              key={d}
              testID={`range-${d}`}
              onPress={() => setRangeDays(d)}
              style={[styles.rangePill, rangeDays === d && styles.rangePillOn]}
            >
              <Text style={[styles.rangePillTxt, rangeDays === d && styles.rangePillTxtOn]}>
                {d === 7 ? "7 gg" : d === 30 ? "30 gg" : d === 90 ? "3 mesi" : d === 180 ? "6 mesi" : "1 anno"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={HT.brand} />
        ) : !data ? (
          <Text style={styles.emptyTxt}>Impossibile caricare le statistiche.</Text>
        ) : (
          <>
            {/* KPI: mine + group */}
            <View style={styles.kpiGrid}>
              <View style={[styles.kpiCard, { borderLeftColor: HT.brand }]}>
                <Text style={styles.kpiLbl}>I miei</Text>
                <Text style={styles.kpiTot}>{data.mine.total}</Text>
                <View style={styles.kpiRow}>
                  <Text style={[styles.kpiBadge, { backgroundColor: HT.successTint, color: HT.success }]}>{data.mine.done} fatti</Text>
                  <Text style={[styles.kpiBadge, { backgroundColor: HT.dangerTint, color: HT.danger }]}>{data.mine.undone} non fatti</Text>
                </View>
                <Text style={styles.kpiPct}>{donePct(data.mine)}% completati</Text>
              </View>

              <View style={[styles.kpiCard, { borderLeftColor: '#7C3AED' }]}>
                <Text style={styles.kpiLbl}>Gruppo</Text>
                <Text style={styles.kpiTot}>{data.group.total}</Text>
                <View style={styles.kpiRow}>
                  <Text style={[styles.kpiBadge, { backgroundColor: HT.successTint, color: HT.success }]}>{data.group.done} fatti</Text>
                  <Text style={[styles.kpiBadge, { backgroundColor: HT.dangerTint, color: HT.danger }]}>{data.group.undone} non fatti</Text>
                </View>
                <Text style={styles.kpiPct}>{donePct(data.group)}% completati</Text>
              </View>
            </View>

            {/* Search filter */}
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={HT.muted} />
              <TextInput
                testID="stats-search"
                value={q}
                onChangeText={setQ}
                placeholder="Cerca collaboratore…"
                placeholderTextColor={HT.muted}
                style={styles.searchInp}
              />
              {!!q && (
                <Pressable onPress={() => setQ("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={HT.muted} />
                </Pressable>
              )}
            </View>

            {/* Per-user breakdown */}
            <Text style={styles.sectionTitle}>Dettaglio collaboratori</Text>
            {filteredRows.length === 0 ? (
              <Text style={styles.emptyTxt}>Nessun collaboratore trovato.</Text>
            ) : (
              filteredRows.map((r) => {
                const pct = donePct(r);
                return (
                  <View key={r.user_id} style={styles.row} testID={`stats-row-${r.user_id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{r.name}</Text>
                      {r.role ? <Text style={styles.rowRole}>{r.role}</Text> : null}
                    </View>
                    <View style={styles.rowNumbers}>
                      <Text style={styles.rowTot}>{r.total}</Text>
                      <View style={styles.rowRow}>
                        <Text style={[styles.rowBadge, { color: HT.success }]}>✓ {r.done}</Text>
                        <Text style={[styles.rowBadge, { color: HT.danger }]}>✗ {r.undone}</Text>
                      </View>
                      <View style={styles.rowBar}>
                        <View style={[styles.rowBarFill, { width: `${pct}%` }]} />
                      </View>
                      <Text style={styles.rowPct}>{pct}%</Text>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card2 },
  title: { fontSize: 18, fontWeight: "800", color: HT.text },
  emptyTxt: { color: HT.muted, fontSize: 12, fontStyle: "italic", textAlign: "center", padding: 24 },
  rangePill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  rangePillOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  rangePillTxt: { fontSize: 12, fontWeight: "700", color: HT.text },
  rangePillTxtOn: { color: "#FFF" },
  kpiGrid: { flexDirection: "row", gap: 10, marginTop: 14 },
  kpiCard: {
    flex: 1, backgroundColor: HT.card2, borderRadius: 12, padding: 12,
    borderLeftWidth: 4, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: HT.border,
  },
  kpiLbl: { fontSize: 11, fontWeight: "700", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiTot: { fontSize: 28, fontWeight: "900", color: HT.text, marginTop: 2 },
  kpiRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  kpiBadge: { fontSize: 10, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  kpiPct: { fontSize: 11, fontWeight: "700", color: HT.muted, marginTop: 6 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: HT.card2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 16,
  },
  searchInp: { flex: 1, color: HT.text, fontSize: 13 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 14, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: HT.card2, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: HT.border },
  rowName: { fontSize: 14, fontWeight: "700", color: HT.text },
  rowRole: { fontSize: 11, color: HT.muted, marginTop: 2 },
  rowNumbers: { alignItems: "flex-end", minWidth: 110 },
  rowTot: { fontSize: 18, fontWeight: "900", color: HT.text },
  rowRow: { flexDirection: "row", gap: 6, marginTop: 2 },
  rowBadge: { fontSize: 11, fontWeight: "800" },
  rowBar: { width: 100, height: 6, backgroundColor: HT.border, borderRadius: 3, overflow: "hidden", marginTop: 4 },
  rowBarFill: { height: "100%", backgroundColor: '#16A34A' },
  rowPct: { fontSize: 11, fontWeight: "700", color: HT.muted, marginTop: 2 },
});
