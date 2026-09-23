// V50.z102 — Dashboard analytics recensioni.
// Media stelle, distribuzione, trend mese-per-mese (12 mesi), top clienti,
// tasso di risposta, breakdown stato richieste.

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Svg, { Rect, Line, Text as SvgText } from "react-native-svg";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type MonthlyPoint = { month: string; count: number; approved: number; avg: number };
type TopClient = {
  contact_id: string;
  contact_name: string;
  rating: number;
  excerpt: string;
  submitted_at: string | null;
};
type Analytics = {
  average_rating: number | null;
  total_reviews: number;
  total_approved: number;
  total_pending: number;
  total_rejected: number;
  distribution: Record<string, number>;
  monthly_trend: MonthlyPoint[];
  top_clients: TopClient[];
  response_rate_pct: number | null;
  total_requests: number;
  requests_by_status: Record<string, number>;
};

const MONTH_LABELS = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];

function monthLabel(key: string): string {
  const parts = key.split("-");
  const m = parts[1] || "";
  const idx = parseInt(m, 10) - 1;
  return MONTH_LABELS[idx] || m;
}

export default function ReviewsAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api<Analytics>("/reviews/analytics");
      setData(r);
    } catch (e: any) {
      setError(e?.message || "Errore caricamento");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}><ActivityIndicator size="large" color={HT.brand} /></View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={48} color={HT.danger} />
          <Text style={styles.errTxt}>{error}</Text>
          <Pressable style={styles.btn} onPress={load}>
            <Text style={styles.btnTxt}>Riprova</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!data) return null;
  const avg = data.average_rating ?? 0;
  const maxCount = Math.max(1, ...data.monthly_trend.map(p => p.count));
  const dist = data.distribution || {};
  const maxDist = Math.max(1, ...Object.values(dist));

  const chartW = Math.min(Dimensions.get("window").width - 40, 520);
  const chartH = 180;
  const barW = (chartW - 40) / 12 * 0.7;
  const gap = (chartW - 40) / 12 * 0.3;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="analytics-back">
          <Ionicons name="chevron-back" size={24} color={HT.text} />
        </Pressable>
        <Text style={styles.title}>Analytics Recensioni</Text>
        <Pressable onPress={load} style={styles.reloadBtn}>
          <Ionicons name="refresh" size={20} color={HT.brand} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* KPI Cards */}
        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { backgroundColor: '#F59E0B' + "15" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="star" size={20} color="#F59E0B" />
              <Text style={[styles.kpiVal, { color: "#F59E0B" }]}>{avg ? avg.toFixed(2) : "—"}</Text>
            </View>
            <Text style={styles.kpiLbl}>Media stelle</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: HT.success + "15" }]}>
            <Text style={[styles.kpiVal, { color: HT.success }]}>{data.total_approved}</Text>
            <Text style={styles.kpiLbl}>Approvate</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: '#EA580C' + "15" }]}>
            <Text style={[styles.kpiVal, { color: "#EA580C" }]}>{data.total_pending}</Text>
            <Text style={styles.kpiLbl}>Da approvare</Text>
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { backgroundColor: HT.brand + "15" }]}>
            <Text style={[styles.kpiVal, { color: HT.brand }]}>
              {data.response_rate_pct != null ? data.response_rate_pct + "%" : "—"}
            </Text>
            <Text style={styles.kpiLbl}>Tasso risposta</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: HT.axon + "15" }]}>
            <Text style={[styles.kpiVal, { color: HT.axon }]}>{data.total_requests}</Text>
            <Text style={styles.kpiLbl}>Richieste totali</Text>
          </View>
          <View style={[styles.kpiCard, { backgroundColor: HT.danger + "15" }]}>
            <Text style={[styles.kpiVal, { color: HT.danger }]}>{data.total_rejected}</Text>
            <Text style={styles.kpiLbl}>Respinte</Text>
          </View>
        </View>

        {/* Distribuzione stelle */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Distribuzione stelle</Text>
          <Text style={styles.sectionSub}>Solo recensioni approvate ({data.total_approved})</Text>
          {["5","4","3","2","1"].map((k) => {
            const n = dist[k] || 0;
            const pct = maxDist > 0 ? (n / maxDist) * 100 : 0;
            return (
              <View key={k} style={styles.distRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 2, width: 42 }}>
                  <Text style={styles.distLbl}>{k}</Text>
                  <Ionicons name="star" size={12} color="#F59E0B" />
                </View>
                <View style={styles.distBarBg}>
                  <View style={[styles.distBarFg, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.distCount}>{n}</Text>
              </View>
            );
          })}
        </View>

        {/* Trend mensile */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trend ultimi 12 mesi</Text>
          <Text style={styles.sectionSub}>Recensioni ricevute per mese · media stelle sopra la barra</Text>
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <Svg width={chartW} height={chartH + 30}>
              {/* linee guida orizzontali */}
              {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
                <Line
                  key={i}
                  x1={20}
                  y1={chartH - t * chartH + 10}
                  x2={chartW - 20}
                  y2={chartH - t * chartH + 10}
                  stroke={HT.border}
                  strokeWidth={1}
                  strokeDasharray={i === 0 ? undefined : "3,3"}
                />
              ))}
              {data.monthly_trend.map((p, i) => {
                const h = p.count > 0 ? (p.count / maxCount) * chartH : 0;
                const x = 20 + i * ((chartW - 40) / 12) + gap / 2;
                const y = chartH - h + 10;
                return (
                  <React.Fragment key={p.month}>
                    <Rect
                      x={x}
                      y={y}
                      width={barW}
                      height={h}
                      rx={3}
                      fill={p.count > 0 ? HT.brand : HT.border}
                    />
                    {p.count > 0 ? (
                      <SvgText
                        x={x + barW / 2}
                        y={y - 4}
                        fontSize="9"
                        fill={HT.brand}
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        {p.avg.toFixed(1)}★
                      </SvgText>
                    ) : null}
                    <SvgText
                      x={x + barW / 2}
                      y={chartH + 25}
                      fontSize="10"
                      fill={HT.muted}
                      textAnchor="middle"
                    >
                      {monthLabel(p.month)}
                    </SvgText>
                  </React.Fragment>
                );
              })}
            </Svg>
          </View>
        </View>

        {/* Top clienti */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top clienti per rating</Text>
          {(data.top_clients || []).length === 0 ? (
            <Text style={styles.sectionSub}>Nessuna recensione approvata al momento.</Text>
          ) : (data.top_clients || []).map((c, idx) => (
            <Pressable
              key={c.contact_id + idx}
              style={styles.topRow}
              onPress={() => {
                if (c.contact_id && !c.contact_id.startsWith("demo_")) {
                  router.push(`/contact/${c.contact_id}` as any);
                }
              }}
              testID={`top-client-${idx}`}
            >
              <View style={styles.topRank}>
                <Text style={styles.topRankTxt}>#{idx + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.topName}>{c.contact_name}</Text>
                {c.excerpt ? <Text style={styles.topExcerpt} numberOfLines={2}>“{c.excerpt}”</Text> : null}
              </View>
              <View style={{ flexDirection: "row" }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Ionicons
                    key={s}
                    name={s <= c.rating ? "star" : "star-outline"}
                    size={13}
                    color="#F59E0B"
                  />
                ))}
              </View>
            </Pressable>
          ))}
        </View>

        {/* Stato richieste */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stato richieste</Text>
          <View style={styles.statusGrid}>
            <View style={[styles.statusChip, { backgroundColor: HT.muted + "22" }]}>
              <Text style={[styles.statusChipVal, { color: HT.muted }]}>
                {data.requests_by_status?.pending || 0}
              </Text>
              <Text style={styles.statusChipLbl}>In attesa</Text>
            </View>
            <View style={[styles.statusChip, { backgroundColor: "#EA580C22" }]}>
              <Text style={[styles.statusChipVal, { color: "#EA580C" }]}>
                {data.requests_by_status?.ready_to_send || 0}
              </Text>
              <Text style={styles.statusChipLbl}>Da inviare</Text>
            </View>
            <View style={[styles.statusChip, { backgroundColor: HT.axon + "22" }]}>
              <Text style={[styles.statusChipVal, { color: HT.axon }]}>
                {data.requests_by_status?.sent || 0}
              </Text>
              <Text style={styles.statusChipLbl}>Inviate</Text>
            </View>
            <View style={[styles.statusChip, { backgroundColor: HT.success + "22" }]}>
              <Text style={[styles.statusChipVal, { color: HT.success }]}>
                {data.requests_by_status?.responded || 0}
              </Text>
              <Text style={styles.statusChipLbl}>Risposte</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: HT.card2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: HT.border,
    backgroundColor: HT.card2,
  },
  backBtn: { padding: 8 },
  reloadBtn: { padding: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: HT.text, textAlign: "center" },
  scroll: { padding: 16, paddingBottom: 140 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errTxt: { color: HT.danger, marginTop: 8, textAlign: "center" },
  btn: { marginTop: 14, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: HT.brand },
  btnTxt: { color: "#FFF", fontWeight: "700" },
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  kpiCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 76,
  },
  kpiVal: { fontSize: 22, fontWeight: "800" },
  kpiLbl: { fontSize: 11, color: HT.muted, fontWeight: "600", marginTop: 2, textAlign: "center" },
  section: {
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: HT.card2,
    borderWidth: 1,
    borderColor: HT.border,
  },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: HT.text },
  sectionSub: { fontSize: 11, color: HT.muted, marginTop: 2, marginBottom: 6 },
  distRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  distLbl: { fontSize: 12, fontWeight: "700", color: HT.text },
  distBarBg: { flex: 1, height: 10, backgroundColor: HT.card2, borderRadius: 5, overflow: "hidden" },
  distBarFg: { height: "100%", backgroundColor: '#F59E0B', borderRadius: 5 },
  distCount: { width: 30, textAlign: "right", fontSize: 12, color: HT.text, fontWeight: "700" },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border },
  topRank: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: HT.brand + "20",
    alignItems: "center", justifyContent: "center",
  },
  topRankTxt: { fontSize: 11, fontWeight: "800", color: HT.brand },
  topName: { fontSize: 13, fontWeight: "700", color: HT.text },
  topExcerpt: { fontSize: 11, color: HT.muted, fontStyle: "italic", marginTop: 2 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  statusChip: { flex: 1, minWidth: 70, padding: 10, borderRadius: 10, alignItems: "center" },
  statusChipVal: { fontSize: 18, fontWeight: "800" },
  statusChipLbl: { fontSize: 10, color: HT.muted, fontWeight: "600", marginTop: 2 },
});
