// axon-system.tsx — V50.z200 — «Stato sistema»: cosa vede AxonOS del backend in tempo reale (schermata ISOLATA)
// Versione backend + CHANGELOG, app installata sui dispositivi (heartbeat), contatori 24h, job pianificati, integrazioni, eventi.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { sendSystemHeartbeat } from "@/src/systemHeartbeat";

type Ev = { event_id: string; ts: string; level: string; source: string; title: string; detail?: string | null; user_id?: string | null; ms?: number };
type Status = {
  backend: { version: string | null; boot_id: string; started_at: string; uptime_label: string; python: string; llm_key: boolean; push_configured: boolean; modules: number };
  changelog: { version: string; date: string; desc: string }[];
  devices: { device_key: string; platform: string; app_version?: string | null; build_number?: string | null; js_version?: string | null; device_name?: string | null; app_env?: string | null; last_seen: string; previous_version?: string }[];
  team_devices: { user_id: string; platform: string; app_version?: string | null; build_number?: string | null; device_name?: string | null; last_seen: string }[];
  events: Ev[]; counters: { errors_24h: number; warnings_24h: number; api_actions_24h: number };
  jobs: { id: string; next_run: string | null }[]; integrations: Record<string, boolean>; push_devices: number;
};

const LEVEL_ICON: Record<string, string> = { info: "ℹ️", warning: "⚠️", error: "🛑", deploy: "🚀", client: "📱" };
const LEVEL_COLOR: Record<string, string> = { info: "#475569", warning: "#B45309", error: "#DC2626", deploy: "#2563EB", client: "#059669" };
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const ver = (d: { app_version?: string | null; build_number?: string | null; js_version?: string | null }) => `${d.app_version || d.js_version || "?"}${d.build_number ? ` (build ${d.build_number})` : ""}`;

export default function AxonSystemScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const [st, setSt] = useState<Status | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "error" | "api" | "deploy">("all");
  const [openEv, setOpenEv] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setSt(await api<Status>("/axon/system/status")); }
    catch (e: any) { notify("Stato sistema", e?.message || String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); try { await sendSystemHeartbeat().catch(() => {}); await load(); } finally { setRefreshing(false); } };

  const events = (st?.events || []).filter((e) => filter === "all" ? true : filter === "error" ? (e.level === "error" || e.level === "warning") : filter === "api" ? e.source === "api" : (e.source === "deploy" || e.source === "client" || e.source === "scheduler"));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="axs-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>🛰️ Stato sistema</Text><Text style={styles.sub}>Tutto ciò che AxonOS vede del backend, in tempo reale</Text></View>
        <Pressable onPress={refresh} hitSlop={10} testID="axs-refresh"><Ionicons name="refresh" size={22} color="#FFF" /></Pressable>
      </View>
      {!st ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: insets.bottom + 120 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
          <View style={styles.card} testID="axs-backend">
            <Text style={styles.secTitle}>Backend</Text>
            <Text style={styles.big}>{st.backend.version || "n/d"}</Text>
            <Text style={styles.meta}>Avviato {fmt(st.backend.started_at)} · uptime {st.backend.uptime_label} · boot {st.backend.boot_id} · {st.backend.modules} moduli · Python {st.backend.python}</Text>
            <View style={styles.chips}>
              <Text style={[styles.chip, { borderColor: st.backend.llm_key ? "#059669" : "#DC2626" }]}>{st.backend.llm_key ? "✓" : "✗"} LLM</Text>
              <Text style={[styles.chip, { borderColor: st.backend.push_configured ? "#059669" : "#B45309" }]}>{st.backend.push_configured ? "✓ Push" : "Push solo su app pubblicata"}</Text>
              <Text style={styles.chip}>📱 {st.push_devices} dispositivi push</Text>
              {Object.entries(st.integrations).map(([k, v]) => <Text key={k} style={[styles.chip, { borderColor: v ? "#059669" : "#E5E7EB", color: v ? "#065F46" : "#94A3B8" }]}>{v ? "✓" : "✗"} {k.replace(/_/g, " ")}</Text>)}
            </View>
          </View>

          <View style={styles.kpis}>
            <View style={[styles.kpi, { borderColor: st.counters.errors_24h ? "#DC2626" : "#EEF0F6" }]}><Text style={[styles.kpiV, { color: st.counters.errors_24h ? "#DC2626" : "#1B2B4B" }]}>{st.counters.errors_24h}</Text><Text style={styles.kpiL}>errori 24h</Text></View>
            <View style={styles.kpi}><Text style={[styles.kpiV, { color: "#B45309" }]}>{st.counters.warnings_24h}</Text><Text style={styles.kpiL}>warning 24h</Text></View>
            <View style={styles.kpi}><Text style={styles.kpiV}>{st.counters.api_actions_24h}</Text><Text style={styles.kpiL}>azioni API 24h</Text></View>
          </View>

          <View style={styles.card} testID="axs-devices">
            <Text style={styles.secTitle}>App installata sui tuoi dispositivi</Text>
            {st.devices.length === 0 ? <Text style={styles.empty}>Nessun heartbeat ancora: apri l&apos;app installata (APK/IPA) e Axon registrerà la versione.</Text> : st.devices.map((d) => (
              <View key={d.device_key} style={styles.row}>
                <Ionicons name={d.platform === "ios" ? "logo-apple" : d.platform === "android" ? "logo-android" : "globe-outline"} size={20} color="#475569" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{d.device_name || d.platform} · <Text style={{ color: "#2563EB" }}>v{ver(d)}</Text></Text>
                  <Text style={styles.meta}>{d.app_env || ""} · JS {d.js_version || "?"} · ultimo contatto {fmt(d.last_seen)}{d.previous_version ? ` · aggiornata da ${d.previous_version}` : ""}</Text>
                </View>
              </View>
            ))}
            {st.team_devices.length > 0 && <Text style={[styles.meta, { marginTop: 6 }]}>Team: {st.team_devices.map((d) => `${d.device_name || d.platform} v${ver(d)}`).join(" · ")}</Text>}
          </View>

          <View style={styles.card} testID="axs-changelog">
            <Text style={styles.secTitle}>Ultime novità (CHANGELOG)</Text>
            {st.changelog.slice(0, 8).map((r) => <Text key={r.version} style={styles.line}><Text style={{ fontWeight: "800", color: "#7C3AED" }}>{r.version}</Text> <Text style={{ color: "#94A3B8" }}>{r.date}</Text> — {r.desc.replace(/\([^()]*`[^()]*\)/g, "").replace(/`[^`]*`/g, "").replace(/\s{2,}/g, " ").trim()}</Text>)}
          </View>

          <View style={styles.card} testID="axs-jobs">
            <Text style={styles.secTitle}>Job pianificati (prossima esecuzione)</Text>
            <View style={styles.chips}>{st.jobs.map((j) => <Text key={j.id} style={styles.chip}>{j.id} · {j.next_run ? new Date(j.next_run).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "—"}</Text>)}</View>
          </View>

          <View style={styles.card} testID="axs-events">
            <Text style={styles.secTitle}>Eventi backend</Text>
            <View style={styles.tabs}>
              {([["all", "Tutti"], ["error", "Errori"], ["api", "Azioni API"], ["deploy", "Deploy/App/Job"]] as const).map(([k, l]) => (
                <Pressable key={k} onPress={() => setFilter(k)} style={[styles.tab, filter === k && styles.tabOn]} testID={`axs-filter-${k}`}><Text style={[styles.tabTxt, filter === k && { color: "#FFF" }]}>{l}</Text></Pressable>
              ))}
            </View>
            {events.length === 0 ? <Text style={styles.empty}>Nessun evento.</Text> : events.map((e) => (
              <Pressable key={e.event_id} onPress={() => setOpenEv(openEv === e.event_id ? null : e.event_id)} style={styles.ev} testID={`axs-ev-${e.event_id}`}>
                <Text style={styles.evIcon}>{LEVEL_ICON[e.level] || "•"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.evTitle, { color: LEVEL_COLOR[e.level] || "#1B2B4B" }]} numberOfLines={openEv === e.event_id ? undefined : 2}>{e.title}</Text>
                  <Text style={styles.meta}>{fmt(e.ts)} · {e.source}{e.user_id ? ` · ${e.user_id.slice(-6)}` : ""}{typeof e.ms === "number" ? ` · ${e.ms} ms` : ""}</Text>
                  {openEv === e.event_id && !!e.detail && <Text style={styles.detail} selectable>{e.detail}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F5FA" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#7C3AED" },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 }, sub: { color: "#FFFFFFCC", fontSize: 12 },
  card: { backgroundColor: "#FFF", borderRadius: 16, borderWidth: 1.5, borderColor: "#EEF0F6", padding: 14, gap: 8 },
  secTitle: { fontSize: 12, fontWeight: "800", color: "#64748B", textTransform: "uppercase", letterSpacing: 0.4 },
  big: { fontSize: 26, fontWeight: "900", color: "#1B2B4B" },
  meta: { fontSize: 11.5, color: "#64748B", lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11.5, fontWeight: "700", color: "#1B2B4B" },
  kpis: { flexDirection: "row", gap: 8 },
  kpi: { flex: 1, backgroundColor: "#FFF", borderRadius: 14, borderWidth: 1.5, borderColor: "#EEF0F6", padding: 10, alignItems: "center" },
  kpiV: { fontSize: 22, fontWeight: "900", color: "#1B2B4B" }, kpiL: { fontSize: 11, color: "#64748B" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: "#1B2B4B" },
  line: { fontSize: 12.5, color: "#1B2B4B", lineHeight: 18 },
  empty: { fontSize: 12.5, color: "#94A3B8", fontStyle: "italic" },
  tabs: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tab: { minHeight: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" }, tabTxt: { fontSize: 12, fontWeight: "800", color: "#475569" },
  ev: { flexDirection: "row", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#F1F5F9", minHeight: 44 },
  evIcon: { fontSize: 14, width: 22, textAlign: "center", marginTop: 1 }, evTitle: { fontSize: 13, fontWeight: "700" },
  detail: { fontSize: 11.5, color: "#334155", backgroundColor: "#F8FAFC", borderRadius: 8, padding: 8, marginTop: 6, fontFamily: "monospace" as any },
});
