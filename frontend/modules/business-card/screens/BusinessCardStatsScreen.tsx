/**
 * BusinessCardStatsScreen — V28
 * Aggregated analytics for the master's public business-card link:
 *   - KPI cards (total, unique, last 30 days)
 *   - Mini 7-day sparkline chart (pure RN, no third-party chart lib)
 *   - Top cities & top countries lists
 *   - Recent openings feed
 *
 * Data source: GET /api/master/business-card/stats
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { fetchBusinessCardStats } from "../api";
import type { BusinessCardStats } from "../types";
import { CARD_NAVY } from "../constants";

const ACCENT = "#FF6B35";

function relativeTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return "";
    const diff = Date.now() - d;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "adesso";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min fa`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} ${h === 1 ? "ora" : "ore"} fa`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days} ${days === 1 ? "giorno" : "giorni"} fa`;
    return new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

function formatShortDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function BusinessCardStatsScreen(): React.ReactElement {
  const router = useRouter();
  const [stats, setStats] = useState<BusinessCardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMsg(null);
    const r = await fetchBusinessCardStats();
    if (r.ok) {
      setStats(r.data);
    } else {
      setErrorMsg(r.error);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={CARD_NAVY} />
          <Text style={styles.mutedTxt}>Caricamento statistiche…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (errorMsg) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={44} color="#DC2626" />
          <Text style={styles.errorTxt}>{errorMsg}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryTxt}>Riprova</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const s = stats!;
  const isEmpty = s.total_views === 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Header onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CARD_NAVY} />}
      >
        {isEmpty ? (
          <View style={styles.emptyBox}>
            <Ionicons name="stats-chart-outline" size={54} color={theme.color.muted} />
            <Text style={styles.emptyTitle}>Nessuna apertura ancora</Text>
            <Text style={styles.emptyHint}>
              Condividi il link del biglietto per iniziare a raccogliere statistiche.
              Ogni apertura viene tracciata in modo anonimo (città e paese).
            </Text>
          </View>
        ) : null}

        {/* KPI cards */}
        <View style={styles.kpiRow}>
          <KpiCard icon="eye" label="Aperture totali" value={s.total_views} color={CARD_NAVY} />
          <KpiCard icon="person" label="Visitatori unici" value={s.unique_views} color={ACCENT} />
        </View>
        <View style={styles.kpiRow}>
          <KpiCard icon="calendar" label="Ultimi 30 giorni" value={s.views_last_30_days} color="#16A34A" />
          <KpiCard
            icon="location"
            label="Città diverse"
            value={s.top_cities.length}
            color="#8B5CF6"
          />
        </View>

        {/* 7-day sparkline */}
        <Text style={styles.section}>Andamento ultimi 7 giorni</Text>
        <View style={styles.chartBox}>
          <Sparkline data={s.views_last_7_days} />
        </View>

        {/* Top cities */}
        <Text style={styles.section}>
          Città principali {s.top_cities.length > 0 ? `(${s.top_cities.length})` : ""}
        </Text>
        {s.top_cities.length === 0 ? (
          <Text style={styles.mutedRow}>Nessun dato geografico disponibile.</Text>
        ) : (
          <View style={styles.list}>
            {s.top_cities.map((c, idx) => {
              const maxCount = s.top_cities[0]?.count || 1;
              const pct = Math.max(6, Math.round((c.count / maxCount) * 100));
              return (
                <View key={`${c.city}-${idx}`} style={styles.cityRow}>
                  <View style={styles.cityHead}>
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Ionicons name="location" size={16} color={ACCENT} />
                      <Text style={styles.cityName} numberOfLines={1}>{c.city}</Text>
                      {c.country ? <Text style={styles.cityCountry}>· {c.country}</Text> : null}
                    </View>
                    <Text style={styles.cityCount}>{c.count}</Text>
                  </View>
                  <View style={styles.barBg}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Top countries */}
        {s.top_countries.length > 0 ? (
          <>
            <Text style={styles.section}>Paesi</Text>
            <View style={styles.chipsRow}>
              {s.top_countries.map((c, idx) => (
                <View key={`co-${idx}`} style={styles.chip}>
                  <Text style={styles.chipTxt}>{c.country || c.country_code || "—"}</Text>
                  <View style={styles.chipCount}>
                    <Text style={styles.chipCountTxt}>{c.count}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* Recent views */}
        {s.recent_views.length > 0 ? (
          <>
            <Text style={styles.section}>Aperture recenti</Text>
            <View style={styles.list}>
              {s.recent_views.map((r, idx) => (
                <View key={`rv-${idx}`} style={styles.recentRow}>
                  <View style={styles.recentDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recentLoc} numberOfLines={1}>
                      {r.city || r.country || "Località sconosciuta"}
                      {r.city && r.country ? ` · ${r.country}` : ""}
                    </Text>
                    <Text style={styles.recentTime}>{relativeTime(r.timestamp)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.footerNote}>
          I dati vengono raccolti in modo anonimo (indirizzo IP → città) al momento dell&apos;apertura del link pubblico. Nessun dato personale del visitatore viene salvato.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

type KpiCardProps = { icon: keyof typeof Ionicons.glyphMap; label: string; value: number; color: string };
function KpiCard({ icon, label, value, color }: KpiCardProps): React.ReactElement {
  return (
    <View style={[styles.kpiCard, { borderTopColor: color }]}>
      <View style={[styles.kpiIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Sparkline({ data }: { data: { date: string; count: number }[] }): React.ReactElement {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.sparkRow}>
        {data.map((d, i) => {
          const h = Math.round((d.count / max) * 88);
          const isToday = i === data.length - 1;
          return (
            <View key={d.date} style={styles.sparkCol}>
              <View style={styles.sparkTrack}>
                <View
                  style={[
                    styles.sparkBar,
                    { height: Math.max(3, h), backgroundColor: isToday ? ACCENT : CARD_NAVY },
                  ]}
                />
              </View>
              <Text style={styles.sparkCount}>{d.count}</Text>
              <Text style={styles.sparkLabel}>{formatShortDate(d.date)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }): React.ReactElement {
  return (
    <View style={styles.header}>
      <Pressable testID="bcs-back" onPress={onBack} hitSlop={10}>
        <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
      </Pressable>
      <Text style={styles.headerTitle}>Statistiche Biglietto</Text>
      <View style={{ width: 26 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  mutedTxt: { color: theme.color.muted, fontSize: 13 },
  errorTxt: { color: "#DC2626", fontWeight: "600", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: CARD_NAVY },
  retryTxt: { color: "#FFF", fontWeight: "700" },

  emptyBox: {
    padding: 24,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface, marginTop: 4 },
  emptyHint: { fontSize: 12, color: theme.color.muted, textAlign: "center", lineHeight: 18 },

  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  kpiCard: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#FFF",
    borderTopWidth: 3,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: 6,
  },
  kpiIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  kpiValue: { fontSize: 24, fontWeight: "800", color: theme.color.onSurface },
  kpiLabel: { fontSize: 11, color: theme.color.muted, fontWeight: "600" },

  section: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.color.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 22,
    marginBottom: 10,
  },

  chartBox: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 12,
  },
  sparkRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 4 },
  sparkCol: { flex: 1, alignItems: "center", gap: 4 },
  sparkTrack: { width: "100%", height: 90, alignItems: "center", justifyContent: "flex-end" },
  sparkBar: { width: "70%", borderRadius: 4 },
  sparkCount: { fontSize: 11, fontWeight: "700", color: theme.color.onSurface },
  sparkLabel: { fontSize: 9, color: theme.color.muted },

  list: { gap: 8 },
  mutedRow: { color: theme.color.muted, fontSize: 13, fontStyle: "italic", paddingVertical: 8 },
  cityRow: {
    backgroundColor: "#FFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 12,
    gap: 8,
  },
  cityHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cityName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, flexShrink: 1 },
  cityCountry: { fontSize: 12, color: theme.color.muted },
  cityCount: {
    fontSize: 13,
    fontWeight: "800",
    color: CARD_NAVY,
    minWidth: 30,
    textAlign: "right",
  },
  barBg: { height: 6, backgroundColor: "#F1F5F9", borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: ACCENT, borderRadius: 3 },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  chipTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  chipCount: {
    minWidth: 26,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: CARD_NAVY,
    alignItems: "center",
    justifyContent: "center",
  },
  chipCountTxt: { fontSize: 11, fontWeight: "800", color: "#FFF" },

  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  recentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#16A34A" },
  recentLoc: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  recentTime: { fontSize: 11, color: theme.color.muted, marginTop: 1 },

  footerNote: {
    marginTop: 24,
    fontSize: 11,
    color: theme.color.muted,
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 16,
  },
});
