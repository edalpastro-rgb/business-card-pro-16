// V50.z310 — Confronto collaboratori (Master). KPI per periodo, classifica con
// punteggio composito, grafico a barre per metrica, testa a testa e tabella completa.
// Route: /team-compare            → tutti i collaboratori
//        /team-compare?period=90   → periodo iniziale (30 | 90 | 365 | all)

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

type Metric = { key: string; label: string; unit: string; weight: number };
type Member = {
  user_id: string;
  name: string;
  email: string;
  role?: string;
  areas?: string[];
  kpi: Record<string, number>;
  score: number;
  wins: number;
  rank: number;
};
type CompareData = {
  period: string;
  days: number | null;
  metrics: Metric[];
  members: Member[];
  total: number;
  team_avg: Record<string, number>;
  team_total: Record<string, number>;
  best: Record<string, string | null>;
};

const PERIODS: { key: string; label: string }[] = [
  { key: "30", label: "30 gg" },
  { key: "90", label: "90 gg" },
  { key: "365", label: "12 mesi" },
  { key: "all", label: "Sempre" },
];

const C = theme.color;

function fmt(v: number | undefined, unit: string): string {
  const n = Number(v || 0);
  if (unit === "€") return n.toLocaleString("it-IT", { maximumFractionDigits: 0 }) + " €";
  if (unit === "%") return n.toLocaleString("it-IT", { maximumFractionDigits: 1 }) + "%";
  if (unit === "min") return n.toLocaleString("it-IT", { maximumFractionDigits: 0 }) + " min";
  return n.toLocaleString("it-IT", { maximumFractionDigits: 1 });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

const MEDALS = ["🥇", "🥈", "🥉"];

// -------------------------------------------------------------------------
// Classifica (punteggio composito 0-100)
// -------------------------------------------------------------------------
function RankingCard({ members, onOpen }: { members: Member[]; onOpen: (uid: string) => void }) {
  return (
    <View style={styles.card} testID="compare-ranking">
      <Text style={styles.cardTitle}>🏁 Classifica del periodo</Text>
      <Text style={styles.cardHint}>
        Punteggio 0-100 = media pesata dei KPI rispetto al migliore della squadra (contratti pesano di più).
      </Text>
      {members.map((m) => (
        <Pressable key={m.user_id} onPress={() => onOpen(m.user_id)} style={styles.rankRow} testID={`compare-rank-${m.user_id}`}>
          <Text style={styles.rankMedal}>{MEDALS[m.rank - 1] || `${m.rank}°`}</Text>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initials(m.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={styles.rankName} numberOfLines={1}>{m.name}</Text>
              {m.wins > 0 ? <Text style={styles.winsTxt}>🏆 {m.wins}</Text> : null}
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(2, m.score)}%`, backgroundColor: m.rank === 1 ? C.success : C.brandSecondary }]} />
            </View>
          </View>
          <Text style={styles.rankScore}>{m.score.toFixed(0)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// -------------------------------------------------------------------------
// Grafico a barre per UNA metrica
// -------------------------------------------------------------------------
function MetricBarsCard({
  data,
  metricKey,
  onMetric,
  onOpen,
}: {
  data: CompareData;
  metricKey: string;
  onMetric: (k: string) => void;
  onOpen: (uid: string) => void;
}) {
  const metric = data.metrics.find((m) => m.key === metricKey) || data.metrics[0];
  const sorted = useMemo(
    () => [...data.members].sort((a, b) => (b.kpi[metric.key] || 0) - (a.kpi[metric.key] || 0)),
    [data.members, metric.key]
  );
  const max = Math.max(0, ...sorted.map((m) => m.kpi[metric.key] || 0));
  const avg = data.team_avg[metric.key] || 0;
  return (
    <View style={styles.card} testID="compare-bars">
      <Text style={styles.cardTitle}>📊 Confronto per metrica</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
        {data.metrics.map((m) => {
          const on = m.key === metric.key;
          return (
            <Pressable key={m.key} onPress={() => onMetric(m.key)} style={[styles.chip, on && styles.chipOn]} testID={`compare-metric-${m.key}`}>
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.avgTxt}>
        Media squadra: <Text style={{ fontWeight: "800" }}>{fmt(avg, metric.unit)}</Text> · Totale:{" "}
        <Text style={{ fontWeight: "800" }}>{fmt(data.team_total[metric.key], metric.unit)}</Text>
      </Text>
      {max <= 0 ? (
        <Text style={styles.emptyTxt}>Nessun dato per «{metric.label}» in questo periodo.</Text>
      ) : (
        sorted.map((m) => {
          const v = m.kpi[metric.key] || 0;
          const isBest = data.best[metric.key] === m.user_id;
          const below = v < avg;
          return (
            <Pressable key={m.user_id} onPress={() => onOpen(m.user_id)} style={styles.barRow}>
              <Text style={styles.barName} numberOfLines={1}>{m.name}</Text>
              <View style={[styles.barTrack, { flex: 1, height: 14 }]}>
                <View
                  style={[
                    styles.barFill,
                    { height: 14, width: `${Math.max(2, (100 * v) / max)}%`, backgroundColor: isBest ? C.success : below ? C.warning : C.brandSecondary },
                  ]}
                />
              </View>
              <Text style={[styles.barVal, isBest && { color: C.success }]}>{fmt(v, metric.unit)}</Text>
            </Pressable>
          );
        })
      )}
      <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: C.success }]} /><Text style={styles.legendTxt}>migliore</Text>
        <View style={[styles.legendDot, { backgroundColor: C.brandSecondary }]} /><Text style={styles.legendTxt}>≥ media</Text>
        <View style={[styles.legendDot, { backgroundColor: C.warning }]} /><Text style={styles.legendTxt}>sotto media</Text>
      </View>
    </View>
  );
}

// -------------------------------------------------------------------------
// Testa a testa (2 collaboratori)
// -------------------------------------------------------------------------
function HeadToHeadCard({ data }: { data: CompareData }) {
  const [a, setA] = useState<string>(data.members[0]?.user_id || "");
  const [b, setB] = useState<string>(data.members[1]?.user_id || "");
  useEffect(() => {
    if (!data.members.find((m) => m.user_id === a)) setA(data.members[0]?.user_id || "");
    if (!data.members.find((m) => m.user_id === b)) setB(data.members[1]?.user_id || "");
  }, [data.members, a, b]);
  const ma = data.members.find((m) => m.user_id === a);
  const mb = data.members.find((m) => m.user_id === b);
  if (data.members.length < 2) return null;
  const Picker = ({ value, onChange, exclude, label }: { value: string; onChange: (v: string) => void; exclude: string; label: string }) => (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.pickerLbl}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {data.members.filter((m) => m.user_id !== exclude).map((m) => {
          const on = m.user_id === value;
          return (
            <Pressable key={m.user_id} onPress={() => onChange(m.user_id)} style={[styles.chip, on && styles.chipOn]} testID={`compare-h2h-${label}-${m.user_id}`}>
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]} numberOfLines={1}>{m.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
  return (
    <View style={styles.card} testID="compare-h2h">
      <Text style={styles.cardTitle}>⚔️ Testa a testa</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Picker label="A" value={a} onChange={setA} exclude={b} />
        <Picker label="B" value={b} onChange={setB} exclude={a} />
      </View>
      {ma && mb ? (
        <View style={{ marginTop: 10 }}>
          <View style={styles.h2hHead}>
            <Text style={[styles.h2hCell, styles.h2hLbl]}>Metrica</Text>
            <Text style={[styles.h2hCell, styles.h2hName]} numberOfLines={1}>{ma.name}</Text>
            <Text style={[styles.h2hCell, styles.h2hName]} numberOfLines={1}>{mb.name}</Text>
          </View>
          <View style={styles.h2hRow}>
            <Text style={[styles.h2hCell, styles.h2hLbl]}>Punteggio</Text>
            <Text style={[styles.h2hCell, styles.h2hVal, ma.score > mb.score && styles.h2hWin]}>{ma.score.toFixed(0)}</Text>
            <Text style={[styles.h2hCell, styles.h2hVal, mb.score > ma.score && styles.h2hWin]}>{mb.score.toFixed(0)}</Text>
          </View>
          {data.metrics.filter((m) => m.weight > 0).map((m) => {
            const va = ma.kpi[m.key] || 0;
            const vb = mb.kpi[m.key] || 0;
            return (
              <View key={m.key} style={styles.h2hRow}>
                <Text style={[styles.h2hCell, styles.h2hLbl]} numberOfLines={2}>{m.label}</Text>
                <Text style={[styles.h2hCell, styles.h2hVal, va > vb && styles.h2hWin]}>{fmt(va, m.unit)}</Text>
                <Text style={[styles.h2hCell, styles.h2hVal, vb > va && styles.h2hWin]}>{fmt(vb, m.unit)}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// -------------------------------------------------------------------------
// Tabella completa (scroll orizzontale)
// -------------------------------------------------------------------------
function FullTableCard({ data, onOpen }: { data: CompareData; onOpen: (uid: string) => void }) {
  return (
    <View style={styles.card} testID="compare-table">
      <Text style={styles.cardTitle}>📋 Tabella completa</Text>
      <Text style={styles.cardHint}>In verde il migliore di ogni riga · scorri a destra per tutti i collaboratori.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={styles.tRow}>
            <Text style={[styles.tCell, styles.tHead, styles.tFirst]}>Metrica</Text>
            {data.members.map((m) => (
              <Pressable key={m.user_id} onPress={() => onOpen(m.user_id)}>
                <Text style={[styles.tCell, styles.tHead]} numberOfLines={1}>{m.name}</Text>
              </Pressable>
            ))}
            <Text style={[styles.tCell, styles.tHead, { color: C.muted }]}>Media</Text>
          </View>
          {data.metrics.map((met, i) => (
            <View key={met.key} style={[styles.tRow, i % 2 === 1 && { backgroundColor: C.surface }]}>
              <Text style={[styles.tCell, styles.tFirst]} numberOfLines={2}>{met.label}</Text>
              {data.members.map((m) => {
                const isBest = data.best[met.key] === m.user_id && met.weight > 0;
                return (
                  <Text key={m.user_id} style={[styles.tCell, isBest && styles.tBest]}>{fmt(m.kpi[met.key], met.unit)}</Text>
                );
              })}
              <Text style={[styles.tCell, { color: C.muted }]}>{fmt(data.team_avg[met.key], met.unit)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// -------------------------------------------------------------------------
// Screen
// -------------------------------------------------------------------------
export default function TeamCompareScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ period?: string }>();
  const isMaster = !user?.parent_user_id && (user?.role || "member") === "owner";
  const [period, setPeriod] = useState<string>(PERIODS.some((p) => p.key === params.period) ? String(params.period) : "30");
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metricKey, setMetricKey] = useState("contracts");

  const load = useCallback(
    async (silent = false) => {
      if (!isMaster) return;
      if (!silent) setLoading(true);
      try {
        const r = await api<CompareData>("/team-insights/compare", { query: { period } });
        setData(r);
      } catch (e: any) {
        notify("Errore", e?.message || "Impossibile caricare il confronto");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [isMaster, period]
  );

  useEffect(() => {
    load();
  }, [load]);

  const openMember = useCallback((uid: string) => router.push(`/team-insights?member=${uid}` as any), [router]);

  if (!user || !isMaster) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={C.onSurfaceInverse} />
          </Pressable>
          <Text style={styles.headerTitle}>Confronto collaboratori</Text>
        </View>
        <View style={styles.empty}>
          {!user ? <ActivityIndicator color={C.brandPrimary} /> : (
            <>
              <Ionicons name="lock-closed-outline" size={40} color={C.muted} />
              <Text style={styles.emptyTitle}>Sezione riservata al Master</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn} testID="compare-back">
          <Ionicons name="chevron-back" size={22} color={C.onSurfaceInverse} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Confronto collaboratori</Text>
          <Text style={styles.headerSub}>{data ? `${data.total} collaboratori · ${PERIODS.find((p) => p.key === period)?.label}` : "KPI a confronto"}</Text>
        </View>
        <Pressable onPress={() => router.push("/team-insights" as any)} hitSlop={10} style={styles.backBtn} testID="compare-insights">
          <Ionicons name="analytics" size={20} color={C.onSurfaceInverse} />
        </Pressable>
      </View>

      <View style={styles.periodRow}>
        {PERIODS.map((p) => {
          const on = p.key === period;
          return (
            <Pressable key={p.key} onPress={() => setPeriod(p.key)} style={[styles.periodChip, on && styles.periodChipOn]} testID={`compare-period-${p.key}`}>
              <Text style={[styles.periodTxt, on && styles.periodTxtOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={C.brandPrimary} />}
      >
        {loading || !data ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator color={C.brandPrimary} />
          </View>
        ) : data.members.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={40} color={C.muted} />
            <Text style={styles.emptyTitle}>Nessun collaboratore</Text>
            <Text style={styles.emptyTxt}>Invita membri della tua rete dalla pagina Master per confrontarne i risultati.</Text>
          </View>
        ) : (
          <>
            <RankingCard members={data.members} onOpen={openMember} />
            <MetricBarsCard data={data} metricKey={metricKey} onMetric={setMetricKey} onOpen={openMember} />
            <HeadToHeadCard data={data} />
            <FullTableCard data={data} onOpen={openMember} />
            <Text style={styles.footNote}>
              I KPI contano i documenti creati da ciascun collaboratore nel periodo (contatti, appuntamenti, chiamate, richiamate, contratti) e la sua partecipazione ai corsi. Tocca un nome per aprire il profilo in Team Insights.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: C.brandPrimary },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { color: C.onSurfaceInverse, fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  headerSub: { color: C.onSurfaceInverse, opacity: 0.85, fontSize: 12, marginTop: 2 },
  periodRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  periodChip: { flex: 1, paddingVertical: 10, borderRadius: theme.radius.pill, backgroundColor: C.surfaceSecondary, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  periodChipOn: { backgroundColor: C.brandPrimary, borderColor: C.brandPrimary },
  periodTxt: { fontSize: 13, fontWeight: "700", color: C.onSurfaceTertiary },
  periodTxtOn: { color: C.onBrandPrimary },

  card: { backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  cardHint: { fontSize: 11, color: C.muted, lineHeight: 15 },
  empty: { alignItems: "center", gap: 6, padding: 32, margin: 16, backgroundColor: C.surfaceSecondary, borderRadius: 16, borderWidth: 1, borderColor: C.border, borderStyle: "dashed" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: C.onSurfaceTertiary, marginTop: 8 },
  emptyTxt: { fontSize: 12, color: C.muted, textAlign: "center", maxWidth: 300 },
  footNote: { fontSize: 11, color: C.muted, lineHeight: 15, paddingHorizontal: 4 },

  rankRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, minHeight: 48 },
  rankMedal: { fontSize: 18, width: 30, textAlign: "center" },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.brandSecondary, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: C.onBrandPrimary, fontSize: 13, fontWeight: "800" },
  rankName: { fontSize: 14, fontWeight: "800", color: C.onSurface, flexShrink: 1 },
  winsTxt: { fontSize: 11, fontWeight: "700", color: C.warning },
  rankScore: { fontSize: 18, fontWeight: "900", color: C.brandPrimary, minWidth: 36, textAlign: "right" },
  barTrack: { height: 8, borderRadius: 6, backgroundColor: C.surfaceTertiary, overflow: "hidden", marginTop: 4 },
  barFill: { height: 8, borderRadius: 6 },

  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: C.surfaceTertiary, borderWidth: 1, borderColor: C.border, minHeight: 36, justifyContent: "center" },
  chipOn: { backgroundColor: C.brandTertiary, borderColor: C.brandPrimary },
  chipTxt: { fontSize: 12, fontWeight: "700", color: C.onSurfaceTertiary },
  chipTxtOn: { color: C.onBrandTertiary },
  avgTxt: { fontSize: 12, color: C.onSurfaceTertiary },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  barName: { width: 96, fontSize: 12, fontWeight: "700", color: C.onSurface },
  barVal: { minWidth: 64, textAlign: "right", fontSize: 12, fontWeight: "800", color: C.onSurface },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { fontSize: 10, color: C.muted, marginRight: 8 },

  pickerLbl: { fontSize: 11, fontWeight: "800", color: C.muted },
  h2hHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 6 },
  h2hRow: { flexDirection: "row", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.divider },
  h2hCell: { fontSize: 12, color: C.onSurface },
  h2hLbl: { flex: 1.3, color: C.onSurfaceTertiary },
  h2hName: { flex: 1, textAlign: "center", fontWeight: "800" },
  h2hVal: { flex: 1, textAlign: "center", fontWeight: "700" },
  h2hWin: { color: C.success, fontWeight: "900" },

  tRow: { flexDirection: "row", alignItems: "center" },
  tCell: { width: 92, paddingVertical: 8, paddingHorizontal: 6, fontSize: 12, color: C.onSurface, textAlign: "center" },
  tFirst: { width: 130, textAlign: "left", fontWeight: "700", color: C.onSurfaceTertiary },
  tHead: { fontWeight: "800", color: C.brandPrimary, borderBottomWidth: 1, borderBottomColor: C.border },
  tBest: { color: C.success, fontWeight: "900" },
});
