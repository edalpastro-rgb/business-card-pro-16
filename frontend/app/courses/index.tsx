// courses/index.tsx — V50.z273 — AREA CORSI (Fase 1): elenco cartelle corsi. Le nuove (mai aperte) lampeggiano con badge rosso.
// Master/Manager: tasto «Nuova cartella corso». Collaboratori: vedono solo i corsi assegnati.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Animated, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export type Course = {
  course_id: string; title: string; description?: string; course_date?: string; location?: string; status: string; created_at: string; creator_name?: string;
  is_creator: boolean; is_new: boolean; my_participation: "yes" | "no" | "pending"; recipient_count: number; read_count: number; yes_count: number; no_count: number; files: { file_id: string; name: string; mime: string }[];
};

export function Blink({ children }: { children: React.ReactNode }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => { const loop = Animated.loop(Animated.sequence([Animated.timing(op, { toValue: 0.25, duration: 550, useNativeDriver: true }), Animated.timing(op, { toValue: 1, duration: 550, useNativeDriver: true })])); loop.start(); return () => loop.stop(); }, [op]);
  return <Animated.View style={{ opacity: op }}>{children}</Animated.View>;
}

export default function CoursesScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<Course[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { const r = await api<{ items: Course[]; can_manage: boolean }>("/courses"); setItems(r.items || []); setCanManage(!!r.can_manage); } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn}><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Area Corsi</Text><Text style={s.sub}>{canManage ? "Cartelle corsi, lettura e partecipazione del team" : "I corsi assegnati a te"}</Text></View>
        {canManage ? <Pressable onPress={() => router.push("/courses/dashboard" as any)} hitSlop={8} style={s.hBtn} testID="courses-dashboard"><Ionicons name="stats-chart" size={22} color="#7C3AED" /></Pressable> : null}
        {canManage ? <Pressable onPress={() => router.push("/courses/new" as any)} style={s.addBtn} testID="courses-new"><Ionicons name="add" size={18} color="#FFF" /><Text style={s.addTxt}>Nuova</Text></Pressable> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: pagePad }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        {loading ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 30 }} /> : items.length === 0 ? (
          <View style={s.empty} testID="courses-empty"><Ionicons name="school-outline" size={40} color={HT.muted} /><Text style={s.emptyTxt}>{canManage ? "Nessuna cartella corso. Crea la prima con «Nuova»." : "Nessun corso assegnato al momento."}</Text></View>
        ) : items.map((c) => {
          const card = (
            <Pressable key={c.course_id} onPress={() => router.push(`/courses/${c.course_id}` as any)} style={[s.card, c.is_new && s.cardNew]} testID={`course-${c.course_id}`}>
              <View style={[s.icon, { backgroundColor: c.is_new ? "#FEE2E2" : "#EDE9FE" }]}><Ionicons name="folder" size={22} color={c.is_new ? "#DC2626" : "#7C3AED"} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{c.title}</Text>
                  {c.is_new ? <View style={s.newBadge} testID="course-new-badge"><Text style={s.newBadgeTxt}>NUOVO</Text></View> : null}
                </View>
                <Text style={s.meta} numberOfLines={1}>{c.course_date ? `📅 ${c.course_date.split("-").reverse().join("/")} · ` : ""}{c.location ? `📍 ${c.location} · ` : ""}{c.files.length} file{c.creator_name ? ` · di ${c.creator_name}` : ""}</Text>
                {c.is_creator ? (
                  <Text style={s.meta}>👀 {c.read_count}/{c.recipient_count} letto · ✅ {c.yes_count} · ❌ {c.no_count} · ⏳ {c.recipient_count - c.yes_count - c.no_count}</Text>
                ) : (
                  <Text style={[s.meta, { fontWeight: "800", color: c.my_participation === "yes" ? "#059669" : c.my_participation === "no" ? "#DC2626" : "#D97706" }]}>{c.my_participation === "yes" ? "✅ Partecipo" : c.my_participation === "no" ? "❌ Non partecipo" : "⏳ Indica se partecipi"}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={HT.muted} />
            </Pressable>
          );
          return c.is_new ? <Blink key={c.course_id}>{card}</Blink> : card;
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border },
  hBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: '#7C3AED', borderRadius: 10, paddingHorizontal: 12, minHeight: 40 }, addTxt: { color: "#FFF", fontWeight: "900" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, minHeight: 72 },
  cardNew: { borderColor: '#FCA5A5', borderWidth: 2 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "800", color: HT.text, flexShrink: 1 }, meta: { fontSize: 12, color: HT.muted, marginTop: 2 },
  newBadge: { backgroundColor: '#DC2626', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }, newBadgeTxt: { color: "#FFF", fontSize: 9, fontWeight: "900" },
  empty: { alignItems: "center", gap: 10, padding: 30 }, emptyTxt: { color: HT.muted, textAlign: "center", fontSize: 14 },
});
