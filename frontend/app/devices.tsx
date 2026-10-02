// devices.tsx — V50.z293 — «Dispositivi»: i miei dispositivi (1 telefono + 1 tablet + 1 PC), stato attivo/sospeso, rimozione;
// Master: dispositivi di tutto il team + log accessi (login, sospensioni, riattivazioni, rimozioni).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { useAuth } from "@/src/auth";
import { useRole } from "@/src/useRole"; // V50.z436 — permessi centralizzati
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Dev = { device_id: string; type: string; type_label: string; name: string; platform?: string; status: string; last_seen_at?: string; last_login_at?: string; last_ip?: string; is_current?: boolean; user_id: string; user_name?: string; user_email?: string };
type Log = { log_id: string; user_name?: string; device_name?: string; device_type?: string; event: string; ip?: string; note?: string; at: string };

const ICON: Record<string, string> = { phone: "phone-portrait", tablet: "tablet-portrait", pc: "desktop" };
const EVENT: Record<string, string> = { login: "Accesso", suspended: "Sospeso", reactivated: "Riattivato", revoked: "Disconnesso" };
const fmt = (s?: string) => (s ? new Date(s).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default function DevicesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isMaster } = useRole();
  const [mine, setMine] = useState<Dev[]>([]);
  const [team, setTeam] = useState<Dev[]>([]);
  const [log, setLog] = useState<Log[]>([]);
  const [tab, setTab] = useState<"mine" | "team" | "log">("mine");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await api<{ items: Dev[] }>("/auth/devices"); setMine(m.items);
      if (isMaster) {
        const [t, l] = await Promise.all([api<{ items: Dev[] }>("/team/devices"), api<{ items: Log[] }>("/team/access-log", { query: { limit: 80 } })]);
        setTeam(t.items); setLog(l.items);
      }
    } catch (e: any) { notify("Dispositivi", e?.message || ""); } finally { setLoading(false); setRefreshing(false); }
  }, [isMaster]);
  useEffect(() => { void load(); }, [load]);

  const remove = (d: Dev, scope: "mine" | "team") => {
    Alert.alert("Rimuovi dispositivo", `${d.name} (${d.type_label}) verrà disconnesso${d.is_current ? " — è QUESTO dispositivo: dovrai rifare il login" : ""}. Se c'era un dispositivo sospeso dello stesso tipo, verrà riattivato.`, [
      { text: "Annulla", style: "cancel" },
      { text: "Rimuovi", style: "destructive", onPress: async () => { try { await api(scope === "mine" ? `/auth/devices/${d.device_id}` : `/team/devices/${d.device_id}`, { method: "DELETE" }); await load(); } catch (e: any) { notify("Dispositivi", e?.message || ""); } } },
    ]);
  };

  const Row = ({ d, scope }: { d: Dev; scope: "mine" | "team" }) => (
    <View style={[s.row, d.status === "suspended" && s.rowSusp]} testID={`device-${d.device_id}`}>
      <View style={[s.ic, { backgroundColor: d.status === "active" ? "#DCFCE7" : "#FEF3C7" }]}><Ionicons name={(ICON[d.type] || "hardware-chip") as any} size={20} color={d.status === "active" ? HT.success : HT.warning} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{d.name} {d.is_current ? <Text style={s.cur}>· questo dispositivo</Text> : null}</Text>
        {scope === "team" ? <Text style={s.sub}>{d.user_name || d.user_email}</Text> : null}
        <Text style={s.sub}>{d.type_label} · {d.status === "active" ? "attivo" : "sospeso (in uso su un altro " + d.type_label.toLowerCase() + ")"} · ultimo accesso {fmt(d.last_seen_at)}{d.last_ip ? ` · ${d.last_ip}` : ""}</Text>
      </View>
      <Pressable onPress={() => remove(d, scope)} hitSlop={6} style={s.del} testID={`device-remove-${d.device_id}`} accessibilityLabel="Rimuovi dispositivo"><Ionicons name="trash-outline" size={18} color="#DC2626" /></Pressable>
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} hitSlop={8} testID="devices-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <Text style={s.title}>Dispositivi</Text>
      </View>
      <View style={s.tabs}>
        <Pressable onPress={() => setTab("mine")} style={[s.tab, tab === "mine" && s.tabOn]} testID="devices-tab-mine"><Text style={[s.tabTxt, tab === "mine" && s.tabTxtOn]}>I miei</Text></Pressable>
        {isMaster ? <Pressable onPress={() => setTab("team")} style={[s.tab, tab === "team" && s.tabOn]} testID="devices-tab-team"><Text style={[s.tabTxt, tab === "team" && s.tabTxtOn]}>Team ({team.length})</Text></Pressable> : null}
        {isMaster ? <Pressable onPress={() => setTab("log")} style={[s.tab, tab === "log" && s.tabOn]} testID="devices-tab-log"><Text style={[s.tabTxt, tab === "log" && s.tabTxtOn]}>Log accessi</Text></Pressable> : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        <View style={s.info}><Ionicons name="shield-checkmark" size={18} color={HT.brand} /><Text style={s.infoTxt}>Ogni account può essere attivo su <Text style={{ fontWeight: "900" }}>1 telefono, 1 tablet e 1 PC</Text>. Il login su un nuovo dispositivo dello stesso tipo disconnette e sospende il precedente; quando il nuovo termina la sessione (esci), il precedente torna attivo.</Text></View>
        {loading ? <ActivityIndicator color={HT.brand} style={{ marginTop: 20 }} /> : null}
        {tab === "mine" ? (mine.length ? mine.map((d) => <Row key={d.device_id} d={d} scope="mine" />) : !loading ? <Text style={s.empty}>Nessun dispositivo registrato: rifai il login da questo dispositivo per registrarlo.</Text> : null) : null}
        {tab === "team" ? (team.length ? team.map((d) => <Row key={d.device_id} d={d} scope="team" />) : !loading ? <Text style={s.empty}>Nessun dispositivo del team (i collaboratori devono rifare il login con l’app aggiornata).</Text> : null) : null}
        {tab === "log" ? (log.length ? log.map((l) => (
          <View key={l.log_id} style={s.logRow} testID={`access-log-${l.log_id}`}>
            <Ionicons name={l.event === "login" ? "log-in-outline" : l.event === "suspended" ? "pause-circle-outline" : l.event === "reactivated" ? "play-circle-outline" : "log-out-outline"} size={18} color={l.event === "suspended" ? HT.warning : l.event === "revoked" ? "#DC2626" : HT.success} />
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{EVENT[l.event] || l.event} · {l.user_name}</Text>
              <Text style={s.sub}>{l.device_name} ({l.device_type}) · {fmt(l.at)}{l.ip ? ` · ${l.ip}` : ""}{l.note ? ` · ${l.note}` : ""}</Text>
            </View>
          </View>
        )) : !loading ? <Text style={s.empty}>Nessun accesso registrato.</Text> : null) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HT.card2 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "900", color: HT.text },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16 },
  tab: { paddingHorizontal: 14, minHeight: 40, borderRadius: 20, backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, justifyContent: "center" },
  tabOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  tabTxt: { fontSize: 13, fontWeight: "800", color: HT.text }, tabTxtOn: { color: "#FFF" },
  info: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, backgroundColor: HT.violetTint, alignItems: "flex-start" },
  infoTxt: { flex: 1, fontSize: 12, lineHeight: 17, color: HT.text },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  rowSusp: { borderColor: '#FCD34D', backgroundColor: HT.warningTint },
  ic: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, fontWeight: "800", color: HT.text }, cur: { color: HT.brand, fontSize: 12 },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  del: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  logRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border },
  empty: { textAlign: "center", color: HT.muted, fontSize: 13, marginTop: 20 },
});
