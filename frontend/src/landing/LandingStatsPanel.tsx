// LandingStatsPanel.tsx — V50.z551 — Statistiche landing nel CMS: visite e click per giorno (Home · AxonOS · AdvisorOS, web + app).
// Dati da GET /landing/cms/stats?days=N (contatori anonimi di landing_stats). Nessun grafico pesante: tabella compatta + totali.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { theme } from "@/src/theme";

type Stats = {
  days: string[];
  by_day: Record<string, Record<string, Record<string, number>>>;
  totals: Record<string, Record<string, number>>;
  views_by_src: { web: number; app: number };
  events: string[];
  labels: Record<string, string>;
  pages: Record<string, string>;
};

const PAGE_KEYS = ["home", "axon", "advisor"] as const;
// click «di interesse» per pagina (richiesta: onboarding, confronto + CTA principali)
const PAGE_EVENTS: Record<(typeof PAGE_KEYS)[number], string[]> = {
  home: ["cta_axonos", "cta_advisoros"],
  axon: ["cta_register", "onboarding_open", "cta_advisoros"],
  advisor: ["cta_register", "compare_open", "cta_quote"],
};

const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function LandingStatsPanel({ headers }: { headers: Record<string, string> }) {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState<(typeof PAGE_KEYS)[number]>("home");

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Stats>(`/landing/cms/stats?days=${days}`, { headers })); } catch { /* resta l'ultimo dato */ } finally { setLoading(false); }
  }, [days, headers]);
  useEffect(() => { load(); }, [load]);

  const totals = data?.totals?.[page] || {};
  const events = PAGE_EVENTS[page];

  return (
    <View style={s.card} testID="cms-stats">
      <View style={s.head}>
        <Ionicons name="stats-chart" size={18} color={HT.brand} />
        <Text style={s.title}>Statistiche landing</Text>
        <View style={{ flex: 1 }} />
        {[7, 14, 30].map((n) => (
          <Pressable key={n} onPress={() => setDays(n)} style={[s.chip, days === n && s.chipOn]} testID={`cms-stats-days-${n}`}><Text style={[s.chipTxt, days === n && s.chipTxtOn]}>{n}g</Text></Pressable>
        ))}
        <Pressable onPress={load} hitSlop={8} style={s.refresh} testID="cms-stats-refresh">{loading ? <ActivityIndicator size="small" color={HT.brand} /> : <Ionicons name="refresh" size={16} color={HT.text2} />}</Pressable>
      </View>
      <Text style={s.muted}>Contatori anonimi (nessun cookie): italianbrain.it + pagine nell&apos;app. Visite web {data?.views_by_src?.web ?? 0} · app {data?.views_by_src?.app ?? 0} negli ultimi {days} giorni.</Text>

      <View style={s.tabs}>
        {PAGE_KEYS.map((k) => (
          <Pressable key={k} onPress={() => setPage(k)} style={[s.tab, page === k && s.tabOn]} testID={`cms-stats-page-${k}`}>
            <Text style={[s.tabTxt, page === k && s.tabTxtOn]} numberOfLines={1}>{data?.pages?.[k] || k}</Text>
            <Text style={[s.tabN, page === k && s.tabTxtOn]}>{data?.totals?.[k]?.view ?? 0} visite</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.totRow}>
        {events.map((e) => (
          <View key={e} style={s.tot} testID={`cms-stats-total-${page}-${e}`}>
            <Text style={s.totN}>{totals[e] ?? 0}</Text>
            <Text style={s.totL} numberOfLines={2}>{data?.labels?.[e] || e}</Text>
          </View>
        ))}
      </View>

      {data ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.table}>
            <View style={[s.tr, s.thead]}>
              <Text style={[s.th, { width: 64 }]}>Giorno</Text>
              <Text style={[s.th, { width: 64 }]}>Visite</Text>
              {events.map((e) => <Text key={e} style={[s.th, { width: 112 }]} numberOfLines={2}>{(data.labels[e] || e).replace("Click ", "").replace("Apertura ", "")}</Text>)}
            </View>
            {data.days.map((d) => {
              const row = data.by_day[d]?.[page] || {};
              const empty = !row.view && events.every((e) => !row[e]);
              return (
                <View key={d} style={[s.tr, empty && { opacity: 0.45 }]} testID={`cms-stats-row-${d}`}>
                  <Text style={[s.td, { width: 64, fontWeight: "800", color: HT.text }]}>{fmtDay(d)}</Text>
                  <Text style={[s.td, { width: 64 }]}>{row.view ?? 0}</Text>
                  {events.map((e) => <Text key={e} style={[s.td, { width: 112 }]}>{row[e] ?? 0}</Text>)}
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: HT.border, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: HT.text, fontWeight: "900", fontSize: 16 },
  muted: { color: HT.text2, fontSize: 12, lineHeight: 17 },
  chip: { paddingHorizontal: 10, minHeight: 30, borderRadius: 999, borderWidth: 1, borderColor: HT.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  chipTxt: { color: HT.text2, fontWeight: "800", fontSize: 12 },
  chipTxtOn: { color: theme.color.onBrandPrimary },
  refresh: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 10, gap: 2, minHeight: 44 },
  tabOn: { backgroundColor: HT.brandTint, borderColor: HT.brand },
  tabTxt: { color: HT.text2, fontWeight: "800", fontSize: 12 },
  tabTxtOn: { color: HT.brand },
  tabN: { color: HT.text, fontWeight: "900", fontSize: 14 },
  totRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tot: { flex: 1, minWidth: 90, backgroundColor: HT.bg, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: HT.border },
  totN: { color: HT.text, fontWeight: "900", fontSize: 20 },
  totL: { color: HT.text2, fontSize: 11, lineHeight: 14 },
  table: { borderRadius: 12, borderWidth: 1, borderColor: HT.border, overflow: "hidden" },
  thead: { backgroundColor: HT.bg },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: HT.border, gap: 6 },
  th: { color: HT.text2, fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  td: { color: HT.text2, fontSize: 13 },
});
