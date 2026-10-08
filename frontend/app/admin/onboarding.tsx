// V50.z461 — Prompt 23: ONBOARDING CONSULENTI (pannello titolare / super-admin).
// Stato dei 3 checkpoint per ogni consulente registrato (Profilo configurato · Anagrafica salvata · Primo cliente inserito),
// data/ora di ciascuno, solleciti automatici inviati (3 gg → primo, 7 gg → secondo se manca l'anagrafica). Solo lettura: nessun intervento manuale.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";

const C = theme.color;
const VIOLET = "#7C3AED";

type Cp = { done: boolean; done_at: string | null; label: string; route: string };
type Row = { user_id: string; name?: string; email?: string; role?: string; registered_at: string | null; completed: boolean; completed_at: string | null; done_count: number;
  checkpoints: Record<string, Cp>; reminders: Record<string, { sent_at: string | null; checkpoint?: string }>; next_missing: string | null };
type Payload = { checkpoints: { key: string; label: string; hint: string }[]; rules: { first_reminder_days: number; second_reminder_days: number };
  stats: { total: number; completed: number; stuck: number; by_checkpoint: Record<string, number>; reminders_sent: number }; job: { last_run?: string | null; runs: number; emails_sent: number }; items: Row[] };

const fmt = (iso?: string | null) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const daysSince = (iso?: string | null) => { if (!iso) return null; const ms = Date.now() - new Date(iso).getTime(); return Math.max(0, Math.floor(ms / 86400000)); };

export default function AdminOnboarding() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "stuck" | "done">("all");

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try { setData(await api<Payload>("/admin/onboarding", { query: refresh ? { refresh: 1 } : undefined })); }
    catch (e: any) { notify("Errore", e?.message || "Impossibile caricare l'onboarding"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.items || []).filter((r) => filter === "all" ? true : filter === "done" ? r.completed : !r.completed);

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} testID="onboarding-back"><Ionicons name="chevron-back" size={24} color={C.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.hTitle}>Onboarding consulenti</Text>
          <Text style={s.hSub}>{data ? `${data.stats.completed}/${data.stats.total} completi · ${data.stats.stuck} fermi · ${data.stats.reminders_sent} solleciti inviati` : "Caricamento…"}</Text>
        </View>
        <Pressable onPress={() => load(true)} style={s.addBtn} disabled={loading} testID="onboarding-refresh">
          {loading ? <ActivityIndicator color={C.onSurfaceInverse} /> : <><Ionicons name="refresh" size={16} color={C.onSurfaceInverse} /><Text style={s.addTxt}>Ricalcola</Text></>}
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} />} testID="onboarding-list">
        {data ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>Avanzamento per checkpoint</Text>
            {data.checkpoints.map((c) => {
              const n = data.stats.by_checkpoint[c.key] || 0; const pct = data.stats.total ? Math.round((n / data.stats.total) * 100) : 0;
              return (
                <View key={c.key} style={{ gap: 4 }}>
                  <View style={s.rowBetween}><Text style={s.lbl}>{c.label}</Text><Text style={s.hint}>{n}/{data.stats.total} · {pct}%</Text></View>
                  <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` as any }]} /></View>
                </View>
              );
            })}
            <Text style={s.hint}>{`Solleciti automatici: dopo ${data.rules.first_reminder_days} giorni email con link al punto in cui si è fermato · dopo ${data.rules.second_reminder_days} giorni, se manca l'anagrafica, seconda email più diretta. Controllo ogni ora${data.job.last_run ? ` · ultimo: ${fmt(data.job.last_run)}` : ""}.`}</Text>
          </View>
        ) : null}
        <View style={s.filters}>
          {(["all", "stuck", "done"] as const).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[s.chip, filter === f && s.chipOn]} testID={`onboarding-filter-${f}`}>
              <Text style={[s.chipTxt, filter === f && s.chipTxtOn]}>{f === "all" ? "Tutti" : f === "stuck" ? "Fermi" : "Completi"}</Text>
            </Pressable>
          ))}
        </View>
        {rows.map((r) => {
          const d = daysSince(r.registered_at);
          return (
            <View key={r.user_id} style={s.card} testID={`onboarding-row-${r.user_id}`}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{r.name || r.email || r.user_id}</Text>
                  <Text style={s.hint} numberOfLines={1}>{r.email}{r.role ? ` · ${r.role === "owner" ? "titolare" : "consulente"}` : ""} · iscritto il {fmt(r.registered_at)}{d != null ? ` (${d} gg)` : ""}</Text>
                </View>
                <View style={[s.badge, { backgroundColor: r.completed ? C.success : r.done_count === 0 ? C.error : VIOLET }]}>
                  <Text style={s.badgeTxt}>{r.completed ? "Completo" : `${r.done_count}/3`}</Text>
                </View>
              </View>
              <View style={s.steps}>
                {Object.entries(r.checkpoints).map(([k, cp], i) => (
                  <View key={k} style={s.step}>
                    <Ionicons name={cp.done ? "checkmark-circle" : r.next_missing === k ? "alert-circle" : "ellipse-outline"} size={20} color={cp.done ? C.success : r.next_missing === k ? C.error : C.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.stepLbl, !cp.done && { color: C.muted }]}>{i + 1}. {cp.label}</Text>
                      <Text style={s.hint}>{cp.done ? fmt(cp.done_at) : r.next_missing === k ? "← fermo qui" : "in attesa"}</Text>
                    </View>
                  </View>
                ))}
              </View>
              {Object.keys(r.reminders).length ? (
                <Text style={s.hint}>
                  <Ionicons name="mail" size={12} color={C.muted} /> {r.reminders.first ? `1° sollecito ${fmt(r.reminders.first.sent_at)}` : ""}{r.reminders.first && r.reminders.second ? " · " : ""}{r.reminders.second ? `2° sollecito (anagrafica) ${fmt(r.reminders.second.sent_at)}` : ""}
                </Text>
              ) : null}
            </View>
          );
        })}
        {data && rows.length === 0 ? <Text style={[s.hint, { textAlign: "center" }]}>Nessun consulente in questo filtro.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider, backgroundColor: C.surfaceSecondary },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "800", color: C.onSurface },
  hSub: { fontSize: 12, color: C.muted },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: VIOLET, paddingHorizontal: 14, minHeight: 44, borderRadius: 12 },
  addTxt: { color: C.onSurfaceInverse, fontWeight: "800" },
  list: { padding: 16, gap: 12, paddingBottom: 140 },
  card: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.divider, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.onSurface },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  hint: { fontSize: 12.5, color: C.muted, lineHeight: 18 },
  lbl: { fontSize: 13, fontWeight: "700", color: C.onSurface },
  bar: { height: 8, borderRadius: 4, backgroundColor: C.divider, overflow: "hidden" },
  barFill: { height: 8, backgroundColor: VIOLET },
  filters: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 38, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: VIOLET, backgroundColor: C.surfaceSecondary },
  chipOn: { backgroundColor: VIOLET },
  chipTxt: { color: VIOLET, fontWeight: "700", fontSize: 12.5 },
  chipTxtOn: { color: C.onSurfaceInverse },
  badge: { paddingHorizontal: 10, minHeight: 28, borderRadius: 999, justifyContent: "center" },
  badgeTxt: { color: "#FFFFFF", fontWeight: "800", fontSize: 12 },
  steps: { gap: 8 },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepLbl: { fontSize: 13.5, fontWeight: "700", color: C.onSurface },
});
