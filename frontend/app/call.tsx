// call.tsx — V50.z506 — Modulo «Call»: tutte le telefonate programmate del giorno (appuntamenti di tipo TELEFONATA) + le call
// arretrate non spuntate («da fare»). Spunta fatta/da fare, chiama, apri, sposta data (→ diventa ritelefonata nel modulo Ritelefonate).
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { HT } from "@/src/homeTheme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CallsToday, fetchCallsToday } from "@/src/calls/callsApi";
import { CallRow } from "@/src/calls/CallRow";

export default function CallScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [data, setData] = useState<CallsToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");

  const load = useCallback(async () => {
    try { setData(await fetchCallsToday()); } catch { /* offline: tiene l'ultimo stato */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = (data?.items || []).filter((c) => (filter === "all" ? true : filter === "todo" ? !c.done : c.done));
  const dayLabel = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="call-screen">
      <View style={s.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Call</Text>
          <Text style={s.sub}>{dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)}</Text>
        </View>
        <Pressable testID="call-new-btn" onPress={() => router.push({ pathname: "/appointment/new", params: { is_phone: "1" } } as any)} style={s.addBtn} accessibilityLabel="Nuova call">
          <Ionicons name="add" size={16} color="#FFFFFF" /><Text style={s.addTxt}>Call</Text>
        </Pressable>
      </View>

      <View style={s.kpis}>
        {[{ k: "all", l: "Tutte", n: data?.total ?? 0 }, { k: "todo", l: "Da fare", n: data?.todo ?? 0 }, { k: "done", l: "Fatte", n: data?.done ?? 0 }].map((x) => (
          <Pressable key={x.k} onPress={() => setFilter(x.k as any)} style={[s.kpi, filter === x.k && s.kpiOn]} testID={`call-filter-${x.k}`}>
            <Text style={[s.kpiN, filter === x.k && { color: HT.brand }]}>{x.n}</Text>
            <Text style={s.kpiL}>{x.l}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: pagePad + 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {loading ? <ActivityIndicator color={HT.brand} style={{ marginTop: 24 }} /> : items.length === 0 ? (
          <View style={s.empty} testID="call-empty">
            <Ionicons name="call-outline" size={30} color={HT.muted} />
            <Text style={s.emptyTxt}>{filter === "done" ? "Nessuna call già fatta oggi" : "Nessuna call programmata per oggi"}</Text>
            <Text style={s.emptyHint}>Le telefonate fissate in Agenda o a voce («programma una telefonata con Rossi martedì alle 10») compaiono qui nel giorno previsto.</Text>
          </View>
        ) : items.map((c) => <CallRow key={c.appointment_id} c={c} onChanged={load} />)}
        <Text style={s.foot}>Le call non spuntate restano «da fare» anche nei giorni seguenti. Spostando la data, la call diventa una ritelefonata e la trovi nel modulo Ritelefonate.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  title: { color: HT.text, fontSize: 22, fontWeight: "900", fontStyle: "italic", letterSpacing: 1 },
  sub: { color: HT.muted, fontSize: 12, fontWeight: "600" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: HT.brand, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, minHeight: 36 },
  addTxt: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "800" },
  kpis: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 4 },
  kpi: { flex: 1, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 14, paddingVertical: 10, alignItems: "center", minHeight: 56 },
  kpiOn: { borderColor: HT.brand, backgroundColor: HT.brandTint },
  kpiN: { color: HT.text, fontWeight: "900", fontSize: 20 },
  kpiL: { color: HT.muted, fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", padding: 24, gap: 8, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, borderStyle: "dashed" },
  emptyTxt: { color: HT.text, fontWeight: "700" },
  emptyHint: { color: HT.muted, fontSize: 12, textAlign: "center", lineHeight: 17 },
  foot: { color: HT.muted, fontSize: 11.5, textAlign: "center", marginTop: 16, lineHeight: 16 },
});
