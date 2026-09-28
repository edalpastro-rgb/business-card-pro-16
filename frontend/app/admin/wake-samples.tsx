// admin/wake-samples.tsx — V50.z390 — Pannello Super Master (URL nascosto /admin/wake-samples): totale campioni wake-word
// per parola × ambiente + download ZIP (tutti o filtrati) per il retraining del modello.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Linking, Platform, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, getToken } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { HT } from "@/src/homeTheme";

type Stats = { total: number; total_bytes: number; sessions: number; last_at: string | null; positive: number; negative: number; environments: string[]; by_environment: Record<string, number>;
  words: { word: string; kind: "positive" | "negative"; total: number; environments: Record<string, number> }[]; expected_words: { positive: string[]; negative: string[] } };
const ENV_LABEL: Record<string, string> = { casa: "Casa", macchina: "Auto", aperto: "Aperto", bar: "Bar", sport: "Sport", autostrada: "Treno/A1", discoteca: "Disco" };
const fmtMb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

export default function WakeSamplesAdmin() {
  const router = useRouter();
  const pad = usePageBottomPadding();
  const [st, setSt] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { setSt(await api<Stats>("/wake-samples/stats")); } catch (e: any) { setErr(e?.message || "Accesso riservato al Super Master"); } finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const download = async (q: Record<string, string> = {}) => {
    const k = JSON.stringify(q); setBusy(k);
    try {
      const token = await getToken();
      const qs = new URLSearchParams({ ...q, token: token || "" }).toString();
      const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/wake-samples/export.zip?${qs}`;
      if (Platform.OS === "web") { const a = document.createElement("a"); a.href = url; a.download = "axon-wake-samples.zip"; a.click(); } else await Linking.openURL(url);
    } catch (e: any) { notify(e?.message || "Download non riuscito"); } finally { setBusy(null); }
  };

  const rows = st ? [...st.expected_words.positive.map((w) => ({ word: w, kind: "positive" as const })), ...st.expected_words.negative.map((w) => ({ word: w, kind: "negative" as const }))]
    .map((x) => st.words.find((r) => r.word === x.word) || { ...x, total: 0, environments: {} as Record<string, number> }) : [];

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="wake-admin-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Campioni wake-word «Axon»</Text><Text style={s.sub}>Pannello Super Master · raccolta pubblica /wake-training</Text></View>
        <Pressable onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_BACKEND_URL}/wake-training`)} hitSlop={8} style={s.iconBtn} testID="wake-admin-open-page"><Ionicons name="open-outline" size={20} color={HT.violet} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pad }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        {err ? <View style={s.card} testID="wake-admin-error"><Text style={s.err}>{err}</Text><Pressable onPress={load} style={s.btn}><Text style={s.btnTxt}>Riprova</Text></Pressable></View> : !st ? <ActivityIndicator color={HT.violet} style={{ marginTop: 30 }} /> : (<>
          <View style={s.statsRow} testID="wake-admin-totals">
            {[["Totale", st.total], ["«Axon»", st.positive], ["Simili", st.negative], ["Sessioni", st.sessions]].map(([l, v]) => <View key={String(l)} style={s.stat}><Text style={s.statN}>{v}</Text><Text style={s.statL}>{l}</Text></View>)}
          </View>
          <Text style={s.meta}>{fmtMb(st.total_bytes)} di audio · ultimo campione {st.last_at ? new Date(st.last_at).toLocaleString("it-IT") : "—"}</Text>

          <Pressable onPress={() => download()} disabled={!!busy || !st.total} style={[s.btn, !st.total && { opacity: 0.5 }]} testID="wake-admin-download-all">{busy === "{}" ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="download" size={18} color="#FFF" /><Text style={s.btnTxt}>Scarica tutto (ZIP + manifest.csv)</Text></>}</Pressable>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => download({ kind: "positive" })} disabled={!!busy || !st.positive} style={[s.ghost, { flex: 1 }, !st.positive && { opacity: 0.5 }]} testID="wake-admin-download-pos"><Text style={s.ghostTxt}>ZIP solo «Axon»</Text></Pressable>
            <Pressable onPress={() => download({ kind: "negative" })} disabled={!!busy || !st.negative} style={[s.ghost, { flex: 1 }, !st.negative && { opacity: 0.5 }]} testID="wake-admin-download-neg"><Text style={s.ghostTxt}>ZIP solo simili</Text></Pressable>
          </View>

          <View style={s.card}>
            <Text style={s.cardHead}>Per ambiente</Text>
            {st.environments.map((e) => (
              <View key={e} style={s.row}><Text style={s.rowTxt}>{ENV_LABEL[e] || e}</Text><View style={s.barWrap}><View style={[s.bar, { width: `${st.total ? Math.max(2, (st.by_environment[e] || 0) / st.total * 100) : 0}%` }]} /></View><Text style={s.rowN}>{st.by_environment[e] || 0}</Text></View>
            ))}
          </View>

          <View style={s.card} testID="wake-admin-matrix">
            <Text style={s.cardHead}>Per parola × ambiente</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={s.tr}><Text style={[s.th, { width: 96 }]}>Parola</Text>{st.environments.map((e) => <Text key={e} style={s.th}>{ENV_LABEL[e] || e}</Text>)}<Text style={[s.th, { fontWeight: "900" }]}>Tot</Text></View>
                {rows.map((r) => (
                  <View key={r.word} style={s.tr} testID={`wake-admin-row-${r.word}`}>
                    <View style={{ width: 96, flexDirection: "row", alignItems: "center", gap: 4 }}><View style={[s.dot, { backgroundColor: r.kind === "positive" ? "#22C55E" : "#F59E0B" }]} /><Text style={s.td} numberOfLines={1}>{r.word}</Text></View>
                    {st.environments.map((e) => <Text key={e} style={[s.td, !(r.environments[e] || 0) && { color: HT.muted }]}>{r.environments[e] || 0}</Text>)}
                    <Text style={[s.td, { fontWeight: "900" }]}>{r.total}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text style={s.meta}>● verde = campioni positivi («Axon») · ● arancio = negativi (parole simili)</Text>
          </View>
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  title: { fontSize: 16, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted }, iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: 8 }, stat: { flex: 1, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 10, alignItems: "center" }, statN: { fontSize: 20, fontWeight: "900", color: HT.violet }, statL: { fontSize: 11, color: HT.muted, fontWeight: "700" },
  meta: { fontSize: 11, color: HT.muted }, err: { color: HT.danger, fontWeight: "700" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: 14, backgroundColor: HT.violet }, btnTxt: { color: "#FFF", fontWeight: "800" },
  ghost: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint }, ghostTxt: { color: HT.violet, fontWeight: "800", fontSize: 13 },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 8 }, cardHead: { fontSize: 13, fontWeight: "900", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 }, rowTxt: { width: 80, color: HT.text, fontWeight: "700", fontSize: 13 }, rowN: { width: 40, textAlign: "right", color: HT.text, fontWeight: "900" },
  barWrap: { flex: 1, height: 8, borderRadius: 4, backgroundColor: HT.card2, overflow: "hidden" }, bar: { height: 8, borderRadius: 4, backgroundColor: HT.violet },
  tr: { flexDirection: "row", alignItems: "center", minHeight: 34, borderBottomWidth: 1, borderBottomColor: HT.border }, th: { width: 64, fontSize: 11, fontWeight: "800", color: HT.muted, textAlign: "center" }, td: { width: 64, fontSize: 13, color: HT.text, textAlign: "center", fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
