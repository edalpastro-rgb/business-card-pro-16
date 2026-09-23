// offline-sync.tsx — V50.z279 — Pannello «Modalità offline e sincronizzazione»
// Stato rete, modifiche in attesa/fallite (riprova/elimina), Sincronizza ora, precarica dati, cache.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { useOffline, prefetchForOffline } from "@/src/OfflineBanner";
import { getQueue, syncQueue, retryOp, dropOp, cacheStats, cacheClear, QueuedOp } from "@/src/offline";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const fmt = (iso?: string | number | null) => { if (!iso) return "—"; const d = new Date(iso); return `${d.toLocaleDateString("it-IT")} ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`; };

export default function OfflineSyncScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const st = useOffline();
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [stats, setStats] = useState<{ entries: number; bytes: number; newest: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { setOps(await getQueue()); setStats(await cacheStats()); }, []);
  useEffect(() => { void load(); }, [load, st.pending, st.failed, st.syncing]);

  const syncNow = async () => { setBusy("sync"); try { const r = await syncQueue(); notify("Sincronizzazione", r.done || r.failed ? `${r.done} inviate, ${r.failed} da controllare` : st.offline ? "Sei ancora offline" : "Nessuna modifica in attesa"); } finally { setBusy(null); await load(); } };
  const prefetch = async () => { setBusy("pre"); try { const n = await prefetchForOffline(true); notify("Dati offline", `${n} sezioni aggiornate e disponibili offline`); } finally { setBusy(null); await load(); } };
  const clear = () => Alert.alert("Svuota cache offline", "I dati salvati per l'uso offline verranno rimossi (le modifiche in attesa restano).", [{ text: "Annulla", style: "cancel" }, { text: "Svuota", style: "destructive", onPress: async () => { await cacheClear(); await load(); } }]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: HT.card2 }} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn} testID="offline-sync-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Modalità offline</Text><Text style={s.sub}>Navigazione senza rete e sincronizzazione delle modifiche</Text></View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: pagePad + 24 }}>
        <View style={[s.card, { borderColor: st.offline ? "#F59E0B" : "#86EFAC" }]} testID="offline-status">
          <View style={s.row}><Ionicons name={st.offline ? "airplane" : "wifi"} size={22} color={st.offline ? HT.warning : HT.success} /><Text style={s.big}>{st.offline ? "Sei offline" : "Sei connesso"}</Text></View>
          <Text style={s.hint}>{st.offline ? "Puoi continuare a navigare e a lavorare: le modifiche vengono salvate sul dispositivo e inviate automaticamente al ritorno della connessione. Axon AI, OCR, PDF/PowerPoint ed email tornano disponibili online." : "Tutto ciò che apri viene salvato per l'uso offline. Le modifiche fatte offline vengono inviate al gruppo appena torni connesso."}</Text>
          <View style={s.kpis}>
            <View style={s.kpi}><Text style={s.kpiN}>{st.pending}</Text><Text style={s.kpiL}>in attesa</Text></View>
            <View style={s.kpi}><Text style={[s.kpiN, st.failed ? { color: HT.warning } : null]}>{st.failed}</Text><Text style={s.kpiL}>da controllare</Text></View>
            <View style={s.kpi}><Text style={s.kpiN}>{stats?.entries ?? "—"}</Text><Text style={s.kpiL}>sezioni offline</Text></View>
          </View>
          <Text style={s.hint}>Ultima sincronizzazione: {fmt(st.lastSync)}{st.lastResult ? ` · ${st.lastResult}` : ""}</Text>
          <Pressable onPress={syncNow} disabled={busy === "sync" || st.syncing} style={[s.btn, { backgroundColor: HT.brand }]} testID="offline-sync-now">{busy === "sync" || st.syncing ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="sync" size={18} color="#FFF" /><Text style={s.btnTxt}>Sincronizza ora</Text></>}</Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.section}>Modifiche in coda ({ops.length})</Text>
          {ops.length === 0 ? <Text style={s.hint}>Nessuna modifica in attesa. Tutto è già sul server.</Text> : null}
          {ops.map((op) => (
            <View key={op.op_id} style={[s.op, op.status !== "pending" && { borderColor: '#FCD34D', backgroundColor: HT.warningTint }]} testID={`offline-op-${op.op_id}`}>
              <Ionicons name={op.status === "pending" ? "time-outline" : op.status === "conflict" ? "git-compare-outline" : "alert-circle-outline"} size={20} color={op.status === "pending" ? HT.brand : HT.warning} />
              <View style={{ flex: 1 }}>
                <Text style={s.opTitle}>{op.label}</Text>
                <Text style={s.hint}>{fmt(op.queued_at)} · {op.method} {op.path}</Text>
                {op.error ? <Text style={[s.hint, { color: HT.warning }]}>{op.status === "conflict" ? "Conflitto segnalato al Master · " : ""}{op.error}</Text> : null}
              </View>
              {op.status !== "pending" ? <Pressable onPress={() => void retryOp(op.op_id).then(load)} hitSlop={8} testID={`offline-op-retry-${op.op_id}`}><Ionicons name="refresh" size={20} color={HT.brand} /></Pressable> : null}
              <Pressable onPress={() => Alert.alert("Elimina modifica", "La modifica non verrà inviata al server.", [{ text: "Annulla", style: "cancel" }, { text: "Elimina", style: "destructive", onPress: () => void dropOp(op.op_id).then(load) }])} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.section}>Dati disponibili offline</Text>
          <Text style={s.hint}>{stats ? `${stats.entries} sezioni · ${(stats.bytes / 1024).toFixed(0)} KB · aggiornati ${fmt(stats.newest || null)}` : "—"}</Text>
          <Text style={s.hint}>Il precaricamento scarica clienti, agenda, corsi, team, notifiche e impostazioni così l'app resta navigabile in modalità aereo anche nelle sezioni che non hai ancora aperto.</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={prefetch} disabled={busy === "pre" || st.offline} style={[s.btn, s.btnGhost, { flex: 1 }]} testID="offline-prefetch">{busy === "pre" ? <ActivityIndicator color={HT.brand} /> : <><Ionicons name="cloud-download-outline" size={18} color={HT.brand} /><Text style={[s.btnTxt, { color: HT.brand }]}>Precarica ora</Text></>}</Pressable>
            <Pressable onPress={clear} style={[s.btn, s.btnGhost]} testID="offline-clear"><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  hBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, title: { fontSize: 18, fontWeight: "900", color: HT.text }, sub: { fontSize: 12, color: HT.muted },
  card: { backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 }, big: { fontSize: 18, fontWeight: "900", color: HT.text },
  section: { fontSize: 14, fontWeight: "900", color: HT.text }, hint: { fontSize: 12, color: HT.muted, lineHeight: 17 },
  kpis: { flexDirection: "row", gap: 8 }, kpi: { flex: 1, backgroundColor: HT.card2, borderRadius: 10, padding: 10, alignItems: "center" },
  kpiN: { fontSize: 20, fontWeight: "900", color: HT.brand }, kpiL: { fontSize: 11, color: HT.muted },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12, paddingHorizontal: 14 },
  btnGhost: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border }, btnTxt: { color: "#FFF", fontWeight: "900" },
  op: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: HT.border },
  opTitle: { fontSize: 13, fontWeight: "800", color: HT.text },
});
