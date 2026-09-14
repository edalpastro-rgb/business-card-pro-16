// src/ExpenseHistory.tsx — V50.z229 — Storico spese: tab «Statistiche» (mese vs precedente / anno prima, per area, dieta di spesa)
// e tab «Archivio» (report mensili chiusi, catalogati per anno → mese, PDF in I miei file). Usato da app/axon-expenses.tsx.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { api, getToken } from "@/src/api";

const backendUrl = () => (process.env.EXPO_PUBLIC_BACKEND_URL || (Constants.expoConfig?.extra as any)?.backendUrl || "").replace(/\/$/, "");
import { notify } from "@/src/utils/notify";

export type Stats = {
  month: string; month_label: string; total: number; count: number; has_history: boolean; avg_6m: number;
  series: { month: string; label: string; total: number; count: number }[];
  vs_prev: { label: string; total: number; abs: number; pct: number | null; saving: number };
  vs_last_year: { label: string; total: number; abs: number; pct: number | null; saving: number };
  by_category: { category: string; label: string; total: number; share: number; prev: number; delta_pct: number | null }[];
  habits: { category: string; label: string; share_avg: number; share_now: number }[];
  insights: string[];
};
export type Report = { report_id: string; month: string; year: string; label: string; name: string; total: number; count: number; by_category: Record<string, number>; file_id: string; created_at: string };

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export function ExpenseStatsTab({ sphere, month, color }: { sphere: "business" | "home"; month: string; color: string }) {
  const [st, setSt] = useState<Stats | null>(null);
  useEffect(() => { setSt(null); api<Stats>("/axon/expenses/stats", { query: { sphere, month } }).then(setSt).catch((e: any) => notify("Statistiche", e?.message || String(e))); }, [sphere, month]);
  if (!st) return <ActivityIndicator color={color} />;
  const max = Math.max(1, ...st.series.map((s) => s.total));
  const Delta = ({ v, label, total }: { v: { pct: number | null; saving: number }; label: string; total: number }) => (
    <View style={styles.deltaBox}>
      <Text style={styles.deltaLbl}>vs {label}</Text>
      <Text style={styles.deltaTot}>{eur(total)}</Text>
      {v.pct === null ? <Text style={styles.deltaNa}>nessun dato</Text> : (
        <Text style={[styles.deltaVal, { color: v.saving >= 0 ? "#16A34A" : "#DC2626" }]}>{v.saving >= 0 ? "▼ risparmio " : "▲ +"}{eur(Math.abs(v.saving))} ({v.pct > 0 ? "+" : ""}{v.pct}%)</Text>
      )}
    </View>
  );
  return (
    <View style={{ gap: 12 }} testID="axe-stats">
      <View style={[styles.card, { borderColor: color + "66" }]}>
        <Text style={styles.big}>{eur(st.total)}</Text>
        <Text style={styles.sub}>{st.month_label} · {st.count} spese{st.avg_6m ? ` · media 6 mesi ${eur(st.avg_6m)}` : ""}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Delta v={st.vs_prev} label={st.vs_prev.label} total={st.vs_prev.total} />
          <Delta v={st.vs_last_year} label={st.vs_last_year.label} total={st.vs_last_year.total} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.secTitle}>Andamento 12 mesi</Text>
        <View style={styles.chart}>
          {st.series.map((s) => (
            <View key={s.month} style={styles.col} testID={`axe-stats-bar-${s.month}`}>
              <View style={[styles.bar, { height: Math.max(3, Math.round((s.total / max) * 90)), backgroundColor: s.month === st.month ? color : color + "66" }]} />
              <Text style={styles.colLbl}>{s.label.slice(0, 3)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.secTitle}>Per area di spesa · {st.month_label}</Text>
        {st.by_category.length === 0 ? <Text style={styles.empty}>Nessuna spesa nel mese.</Text> : st.by_category.map((c) => (
          <View key={c.category} style={{ marginTop: 8 }} testID={`axe-stats-cat-${c.category}`}>
            <View style={styles.rowBetween}>
              <Text style={styles.catLbl}>{c.label}</Text>
              <Text style={styles.catVal}>{eur(c.total)} · {c.share}%{c.delta_pct !== null ? <Text style={{ color: c.delta_pct > 0 ? "#DC2626" : "#16A34A" }}> ({c.delta_pct > 0 ? "+" : ""}{c.delta_pct}%)</Text> : null}</Text>
            </View>
            <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, c.share)}%` as any, backgroundColor: color }]} /></View>
          </View>
        ))}
      </View>

      {st.habits.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.secTitle}>Dieta di spesa · abitudini (6 mesi) vs questo mese</Text>
          {st.habits.slice(0, 7).map((h) => (
            <View key={h.category} style={[styles.rowBetween, { marginTop: 8 }]} testID={`axe-stats-habit-${h.category}`}>
              <Text style={styles.catLbl}>{h.label}</Text>
              <Text style={styles.catVal}>{h.share_avg}% → <Text style={{ color: h.share_now > h.share_avg + 5 ? "#DC2626" : h.share_now < h.share_avg - 5 ? "#16A34A" : "#1B2B4B", fontWeight: "900" }}>{h.share_now}%</Text></Text>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.card, { backgroundColor: "#FAF5FF", borderColor: "#DDD6FE" }]} testID="axe-stats-insights">
        <Text style={[styles.secTitle, { color: "#6D28D9" }]}>💡 Cosa dice AxonOS</Text>
        {st.insights.length === 0 ? <Text style={styles.empty}>Aggiungi qualche scontrino: dal secondo mese arrivano confronti e risparmio.</Text> : st.insights.map((t, i) => <Text key={i} style={styles.insight}>• {t}</Text>)}
      </View>
    </View>
  );
}

export function ExpenseArchiveTab({ sphere, color, onChanged }: { sphere: "business" | "home"; color: string; onChanged: () => void }) {
  const router = useRouter();
  const [years, setYears] = useState<{ year: string; total: number; reports: Report[] }[] | null>(null);
  const load = useCallback(async () => { try { setYears((await api<{ years: any[] }>("/axon/expenses/reports", { query: { sphere } })).years); } catch (e: any) { notify("Archivio", e?.message || String(e)); } }, [sphere]);
  useEffect(() => { void load(); }, [load]);
  const openPdf = async (r: Report) => {
    const tok = await getToken();
    const url = `${backendUrl()}/api/master-files/${r.file_id}/content?token=${encodeURIComponent(tok || "")}`;
    if (Platform.OS === "web") (globalThis as any).window.open(url, "_blank");
    else router.push({ pathname: "/(tabs)/webviewer", params: { url, title: r.name } } as any);
  };
  const reopen = (r: Report) => {
    const go = async () => { try { await api(`/axon/expenses/reports/${r.report_id}`, { method: "DELETE" }); await load(); onChanged(); notify("Mese riaperto", "Le spese sono tornate modificabili; il PDF è stato rimosso."); } catch (e: any) { notify("Errore", e?.message || String(e)); } };
    if (Platform.OS === "web") { if ((globalThis as any).window.confirm(`Riaprire ${r.label}? Il PDF verrà rimosso.`)) void go(); return; }
    Alert.alert("Riapri mese", `${r.label}: le spese tornano modificabili e il PDF viene rimosso.`, [{ text: "Annulla", style: "cancel" }, { text: "Riapri", style: "destructive", onPress: () => void go() }]);
  };
  if (!years) return <ActivityIndicator color={color} />;
  if (years.length === 0) return <Text style={styles.empty} testID="axe-archive-empty">Nessun mese chiuso. Dalla tab «Nota spese» seleziona le ricevute e tocca «Chiudi mese → PDF».</Text>;
  return (
    <View style={{ gap: 12 }} testID="axe-archive">
      {years.map((y) => (
        <View key={y.year} style={styles.card} testID={`axe-archive-year-${y.year}`}>
          <View style={styles.rowBetween}><Text style={styles.yearTitle}>📁 {y.year}</Text><Text style={styles.yearTot}>{eur(y.total)}</Text></View>
          {y.reports.map((r) => (
            <View key={r.report_id} style={styles.repRow} testID={`axe-archive-report-${r.month}`}>
              <View style={[styles.repIcon, { backgroundColor: color }]}><Ionicons name="document-text" size={18} color="#FFF" /></View>
              <Pressable onPress={() => openPdf(r)} style={{ flex: 1 }} testID={`axe-archive-open-${r.month}`}>
                <Text style={styles.repTitle}>📂 {r.label}</Text>
                <Text style={styles.repMeta}>{r.count} spese · {eur(r.total)} · {Object.entries(r.by_category).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(0)}€`).join(" · ")}</Text>
                <Text style={[styles.repMeta, { color }]}>Apri PDF · in I miei file</Text>
              </Pressable>
              <Pressable onPress={() => reopen(r)} hitSlop={8} style={styles.iconBtn} testID={`axe-archive-reopen-${r.month}`}><Ionicons name="lock-open-outline" size={18} color="#64748B" /></Pressable>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFF", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E2E8F0" },
  big: { fontSize: 30, fontWeight: "900", color: "#1B2B4B" },
  sub: { fontSize: 12.5, color: "#64748B", fontWeight: "700", marginTop: 2 },
  deltaBox: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, padding: 10, gap: 2 },
  deltaLbl: { fontSize: 11, color: "#64748B", fontWeight: "800", textTransform: "uppercase" },
  deltaTot: { fontSize: 15, fontWeight: "900", color: "#1B2B4B" },
  deltaVal: { fontSize: 12, fontWeight: "800" },
  deltaNa: { fontSize: 12, color: "#94A3B8", fontWeight: "700" },
  secTitle: { fontSize: 13.5, fontWeight: "900", color: "#1B2B4B" },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 118, marginTop: 10 },
  col: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  bar: { width: "100%", borderRadius: 4 },
  colLbl: { fontSize: 9, color: "#64748B", fontWeight: "700" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  catLbl: { fontSize: 13, fontWeight: "800", color: "#1B2B4B" },
  catVal: { fontSize: 12.5, fontWeight: "700", color: "#475569" },
  track: { height: 8, borderRadius: 4, backgroundColor: "#F1F5F9", marginTop: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  insight: { fontSize: 13, color: "#4C1D95", lineHeight: 19, marginTop: 6, fontWeight: "600" },
  empty: { color: "#64748B", fontSize: 13, textAlign: "center", paddingVertical: 12 },
  yearTitle: { fontSize: 16, fontWeight: "900", color: "#1B2B4B" },
  yearTot: { fontSize: 14, fontWeight: "900", color: "#475569" },
  repRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F1F5F9", marginTop: 8 },
  repIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  repTitle: { fontSize: 14, fontWeight: "800", color: "#1B2B4B" },
  repMeta: { fontSize: 11.5, color: "#64748B", fontWeight: "600", marginTop: 1 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
