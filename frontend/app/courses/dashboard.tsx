// courses/dashboard.tsx — V50.z274 — Dashboard Azienda corsi (Master; Manager vede i propri): filtri Manager / area-gruppo / periodo,
// totali, tabella corsi (partecipanti, letture, % partecipazione, test, media), statistiche per Manager e per area.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Row = { course_id: string; title: string; course_date: string; manager: string; recipients: number; reads: number; yes: number; no: number; participation_pct: number; test_responses: number; avg_score_pct: number | null; areas: string[] };
type Bucket = { key: string; label: string; courses: number; recipients: number; reads: number; yes: number; no: number; tests: number; participation_pct: number; read_pct: number; avg_score_pct: number | null };
type Dash = { courses: Row[]; totals: { courses: number; recipients: number; reads: number; yes: number; no: number; tests: number; participation_pct: number }; by_manager: Bucket[]; by_area: Bucket[]; filters: { managers: { user_id: string; name: string }[]; areas: string[] } };

export default function CoursesDashboard() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [d, setD] = useState<Dash | null>(null);
  const [manager, setManager] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setD(await api<Dash>("/courses-dashboard", { query: { manager_id: manager || undefined, area: area || undefined, date_from: from || undefined, date_to: to || undefined } })); } catch {} finally { setLoading(false); }
  }, [manager, area, from, to]);
  useEffect(() => { void load(); }, [load]);

  const Bucket = ({ b }: { b: Bucket }) => (
    <View style={s.bRow}>
      <Text style={s.bLabel} numberOfLines={1}>{b.label}</Text>
      <Text style={s.bVal}>{b.courses} corsi</Text><Text style={s.bVal}>👀 {b.read_pct}%</Text><Text style={[s.bVal, { color: "#059669" }]}>✅ {b.participation_pct}%</Text><Text style={s.bVal}>📝 {b.avg_score_pct != null ? `${b.avg_score_pct}%` : "—"}</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn}><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Dashboard Azienda · Corsi</Text><Text style={s.sub}>Vista globale con filtri Manager, area/gruppo, periodo</Text></View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad }}>
        <Text style={s.section}>Filtri</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Pressable onPress={() => setManager(null)} style={[s.chip, !manager && s.chipOn]}><Text style={[s.chipTxt, !manager && { color: "#FFF" }]}>Tutti i Manager</Text></Pressable>
          {(d?.filters.managers || []).map((m) => <Pressable key={m.user_id} onPress={() => setManager(m.user_id)} style={[s.chip, manager === m.user_id && s.chipOn]} testID={`dash-manager-${m.user_id}`}><Text style={[s.chipTxt, manager === m.user_id && { color: "#FFF" }]}>{m.name}</Text></Pressable>)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Pressable onPress={() => setArea(null)} style={[s.chip, !area && s.chipOn]}><Text style={[s.chipTxt, !area && { color: "#FFF" }]}>Tutte le aree</Text></Pressable>
          {(d?.filters.areas || []).map((a) => <Pressable key={a} onPress={() => setArea(a)} style={[s.chip, area === a && s.chipOn]} testID={`dash-area-${a}`}><Text style={[s.chipTxt, area === a && { color: "#FFF" }]}>{a}</Text></Pressable>)}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput value={from} onChangeText={setFrom} placeholder="Dal (AAAA-MM-GG)" placeholderTextColor={HT.muted} style={s.input} testID="dash-from" />
          <TextInput value={to} onChangeText={setTo} placeholder="Al (AAAA-MM-GG)" placeholderTextColor={HT.muted} style={s.input} testID="dash-to" />
        </View>
        {loading || !d ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 20 }} /> : (<>
          <View style={{ flexDirection: "row", gap: 8 }} testID="dash-totals">
            {[["Corsi", d.totals.courses], ["Iscritti", d.totals.recipients], ["Letture", d.totals.reads], ["Partecip.", `${d.totals.participation_pct}%`], ["Test", d.totals.tests]].map(([l, v]) => <View key={String(l)} style={s.stat}><Text style={s.statN}>{v}</Text><Text style={s.statL}>{l}</Text></View>)}
          </View>
          <Text style={s.section}>Per Master / Manager</Text>
          <View style={s.card}>{d.by_manager.length ? d.by_manager.map((b) => <Bucket key={b.key} b={b} />) : <Text style={s.hint}>Nessun dato</Text>}</View>
          <Text style={s.section}>Per area / gruppo</Text>
          <View style={s.card}>{d.by_area.length ? d.by_area.map((b) => <Bucket key={b.key} b={b} />) : <Text style={s.hint}>Nessun dato</Text>}</View>
          <Text style={s.section}>Corsi ({d.courses.length})</Text>
          {d.courses.map((r) => (
            <Pressable key={r.course_id} onPress={() => router.push(`/courses/${r.course_id}` as any)} style={s.card} testID={`dash-course-${r.course_id}`}>
              <Text style={{ fontWeight: "900", color: HT.text }}>{r.title}</Text>
              <Text style={s.hint}>{r.course_date ? r.course_date.split("-").reverse().join("/") + " · " : ""}{r.manager} · {r.areas.join(", ")}</Text>
              <Text style={s.hint}>👥 {r.recipients} iscritti · 👀 {r.reads} letto · ✅ {r.yes} / ❌ {r.no} ({r.participation_pct}%) · 📝 {r.test_responses} test{r.avg_score_pct != null ? ` · media ${r.avg_score_pct}%` : ""}</Text>
            </Pressable>
          ))}
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, title: { fontSize: 17, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  section: { fontSize: 14, fontWeight: "900", color: HT.text }, hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  chip: { paddingHorizontal: 12, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: HT.border, alignItems: "center", justifyContent: "center", backgroundColor: HT.card }, chipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' }, chipTxt: { fontSize: 12, fontWeight: "800", color: HT.text },
  input: { flex: 1, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 42, fontSize: 13, color: HT.text },
  stat: { flex: 1, backgroundColor: HT.violetTint, borderRadius: 10, padding: 8, alignItems: "center" }, statN: { fontSize: 16, fontWeight: "900", color: HT.violet }, statL: { fontSize: 9, color: HT.muted },
  card: { backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: HT.border, padding: 12, gap: 4 },
  bRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: HT.border }, bLabel: { flex: 1, fontWeight: "800", color: HT.text, fontSize: 13 }, bVal: { fontSize: 12, color: HT.muted, fontWeight: "700" },
});
