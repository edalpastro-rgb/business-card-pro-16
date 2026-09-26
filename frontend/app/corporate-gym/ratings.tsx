// corporate-gym/ratings.tsx — V50.z365 — Valutazioni nel tempo per consulente × area: OSCENO / MEDIOCRE / DOVERE / ECCELLENTE,
// storico (mini-grafico a barre), trend, flag «intervento di persona» per il Manager. Consulente: solo le proprie.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { cgaApi, CgaRatingRow, RATING_COLOR } from "@/src/corporate-gym/areasApi";
import { HT } from "@/src/homeTheme";

const SCALE = ["OSCENO", "MEDIOCRE", "DOVERE", "ECCELLENTE"];

export default function CgymRatingsScreen() {
  const router = useRouter();
  const { area_id } = useLocalSearchParams<{ area_id?: string }>();
  const pad = usePageBottomPadding();
  const [rows, setRows] = useState<CgaRatingRow[] | null>(null);
  const [master, setMaster] = useState(false);
  const [onlyCritical, setOnlyCritical] = useState(false);

  const load = useCallback(async () => {
    try { const r = await cgaApi.ratings(area_id ? { area_id: String(area_id) } : {}); setRows(r.items); setMaster(r.is_master); } catch { setRows([]); }
  }, [area_id]);
  useEffect(() => { void load(); }, [load]);

  const visible = (rows || []).filter((r) => !onlyCritical || r.needs_intervention);
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="cgym-ratings-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>Valutazioni nel tempo</Text><Text style={styles.sub}>{master ? "Team · dove intervenire di persona" : "Le tue sessioni per area"}</Text></View>
      </View>
      <View style={styles.scaleRow}>{SCALE.map((l) => <View key={l} style={[styles.scaleChip, { borderColor: RATING_COLOR[l] }]}><Text style={[styles.scaleTxt, { color: RATING_COLOR[l] }]}>{l}</Text></View>)}</View>
      {master ? <Pressable onPress={() => setOnlyCritical((v) => !v)} style={styles.filter} testID="cgym-ratings-critical"><Ionicons name={onlyCritical ? "checkbox" : "square-outline"} size={18} color={HT.danger} /><Text style={styles.filterTxt}>Solo chi richiede intervento diretto</Text></Pressable> : null}
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pad }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        {rows === null ? <ActivityIndicator color={HT.violet} /> : visible.length === 0 ? <Text style={styles.empty}>Nessuna sessione valutata ancora. Avvia una sessione live con Axon da un'area del Corporate Gym.</Text> : visible.map((r) => (
          <View key={`${r.user_id}_${r.area_id}`} style={[styles.card, r.needs_intervention && { borderColor: HT.danger }]} testID={`cgym-rating-${r.user_id}-${r.area_id}`}>
            <View style={styles.rowHead}>
              <View style={{ flex: 1 }}>{master ? <Text style={styles.name}>{r.user_name}</Text> : null}<Text style={styles.area}>{r.area_name}</Text></View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.rating, { color: RATING_COLOR[r.last_rating || ""] || HT.text }]}>{r.last_rating || "—"}</Text>
                <Text style={styles.meta}>ultimo {r.last_score ?? "—"} · media {r.avg_score ?? "—"}{r.trend != null ? ` · ${r.trend >= 0 ? "▲" : "▼"} ${Math.abs(r.trend)}` : ""}</Text>
              </View>
            </View>
            <View style={styles.bars}>
              {r.history.slice(-14).map((h) => (
                <Pressable key={h.session_id} onPress={() => router.push(`/corporate-gym/live?session=${h.session_id}` as any)} style={styles.barWrap}>
                  <View style={[styles.bar, { height: Math.max(6, ((h.score || 0) / 100) * 56), backgroundColor: RATING_COLOR[h.rating || ""] || HT.muted }]} />
                  <Text style={styles.barLbl}>{h.date.slice(5, 10).replace("-", "/")}</Text>
                </Pressable>
              ))}
            </View>
            {r.needs_intervention ? <View style={styles.alert}><Ionicons name="alert-circle" size={16} color={HT.danger} /><Text style={styles.alertTxt}>Sotto il minimo richiesto (DOVERE): consigliato intervento diretto del Manager.</Text></View> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  title: { fontSize: 17, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  scaleRow: { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingTop: 12 },
  scaleChip: { flex: 1, borderWidth: 1.5, borderRadius: 999, minHeight: 30, alignItems: "center", justifyContent: "center" }, scaleTxt: { fontSize: 10, fontWeight: "900" },
  filter: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, minHeight: 40 }, filterTxt: { fontSize: 13, fontWeight: "700", color: HT.text },
  empty: { fontSize: 13, color: HT.muted, textAlign: "center", lineHeight: 19, padding: 20 },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  rowHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  name: { fontSize: 15, fontWeight: "900", color: HT.text }, area: { fontSize: 12, color: HT.muted, fontWeight: "700" },
  rating: { fontSize: 15, fontWeight: "900" }, meta: { fontSize: 11, color: HT.muted },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 76 },
  barWrap: { alignItems: "center", gap: 3, flex: 1, justifyContent: "flex-end" }, bar: { width: "100%", maxWidth: 22, borderRadius: 4 }, barLbl: { fontSize: 8, color: HT.muted },
  alert: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: HT.dangerTint, borderRadius: 10, padding: 8 }, alertTxt: { flex: 1, fontSize: 12, color: HT.text, fontWeight: "700" },
});
