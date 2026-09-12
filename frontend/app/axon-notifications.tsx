// Notifiche AxonOS (V50.z181) — elenco notifiche + preferenze. Route: /axon-notifications?tab=prefs
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Switch, TextInput, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { axnApi, AxnNotification, AxnPrefs, AxnKind, AXN_KIND_ICON, setAppBadge } from "@/src/axonNotifications";
import { PushStatusCard } from "@/src/PushStatusCard"; // V50.z193 — Stato canale push + test a 2 minuti
import { ProactiveSettingsCard } from "@/src/ProactiveSettingsCard"; // V50.z196 — Blocco 9: impostazioni proattività

const AXON = "#7C3AED";

function fmt(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AxonNotificationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const pagePad = usePageBottomPadding();
  const [tab, setTab] = useState<"list" | "prefs">(params.tab === "prefs" ? "prefs" : "list");
  const [items, setItems] = useState<AxnNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<AxnPrefs | null>(null);
  const [plan, setPlan] = useState("");
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([axnApi.list(onlyUnread), axnApi.prefs()]);
      setItems(l.items); setUnread(l.unread); setAppBadge(l.unread);
      setPrefs(p); setPlan(String(p.credits_plan_monthly));
    } catch (e: any) {
      notify("Notifiche", e?.message || "Impossibile caricare le notifiche");
    } finally {
      setLoading(false);
    }
  }, [onlyUnread]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [onlyUnread, load]);

  const open = async (n: AxnNotification) => {
    if (!n.read) {
      try { const r = await axnApi.read(n.notif_id); setUnread(r.unread); setAppBadge(r.unread); } catch { /* ignore */ }
      setItems((p) => p.map((x) => (x.notif_id === n.notif_id ? { ...x, read: true } : x)));
    }
    const dl = n.data?.deeplink;
    if (dl && dl !== "/axon-notifications" && !dl.startsWith("/axon-notifications")) router.push(dl as any);
  };

  const remove = async (n: AxnNotification) => {
    try { const r = await axnApi.remove(n.notif_id); setUnread(r.unread); setAppBadge(r.unread); setItems((p) => p.filter((x) => x.notif_id !== n.notif_id)); }
    catch (e: any) { notify("Notifiche", e?.message || "Eliminazione fallita"); }
  };

  const readAll = async () => {
    try { await axnApi.readAll(); setUnread(0); setAppBadge(0); setItems((p) => p.map((x) => ({ ...x, read: true }))); } catch { /* ignore */ }
  };

  const savePrefs = async (patch: Parameters<typeof axnApi.setPrefs>[0]) => {
    try { setPrefs(await axnApi.setPrefs(patch)); } catch (e: any) { notify("Preferenze", e?.message || "Salvataggio fallito"); }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await axnApi.test();
      notify("Notifica di prova inviata", r.push_configured ? "Controlla la barra notifiche del telefono." : "In-app creata. Il push nativo si attiva nella build pubblicata (chiave push configurata dal deploy).");
      load();
    } catch (e: any) { notify("Notifiche", e?.message || "Invio fallito"); } finally { setTesting(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="axn-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home" as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.title}>Notifiche AxonOS</Text>
          <Text style={styles.sub}>{unread > 0 ? `${unread} non lette` : "Tutto letto"}</Text>
        </View>
        <Pressable onPress={readAll} hitSlop={10} disabled={unread === 0} testID="axn-read-all" accessibilityLabel="Segna tutte come lette">
          <Ionicons name="checkmark-done" size={24} color={unread > 0 ? AXON : theme.color.muted} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        <Pressable onPress={() => setTab("list")} style={[styles.tab, tab === "list" && styles.tabOn]} testID="axn-tab-list"><Text style={[styles.tabTxt, tab === "list" && styles.tabTxtOn]}>Notifiche</Text></Pressable>
        <Pressable onPress={() => setTab("prefs")} style={[styles.tab, tab === "prefs" && styles.tabOn]} testID="axn-tab-prefs"><Text style={[styles.tabTxt, tab === "prefs" && styles.tabTxtOn]}>Preferenze</Text></Pressable>
      </View>

      {loading ? <ActivityIndicator color={AXON} style={{ marginTop: 40 }} /> : tab === "list" ? (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: pagePad, gap: 8 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          <Pressable onPress={() => setOnlyUnread((v) => !v)} style={styles.filter} testID="axn-filter-unread">
            <Ionicons name={onlyUnread ? "checkbox" : "square-outline"} size={18} color={AXON} />
            <Text style={styles.filterTxt}>Solo non lette</Text>
          </Pressable>
          {items.length === 0 && (
            <View style={styles.empty} testID="axn-empty">
              <Ionicons name="notifications-off-outline" size={36} color={theme.color.muted} />
              <Text style={styles.emptyTxt}>Nessuna notifica{onlyUnread ? " da leggere" : ""}. AxonOS ti avviserà qui (e sul telefono) per sessioni Gym obbligatorie, richiamate urgenti, crediti, report e messaggi importanti.</Text>
            </View>
          )}
          {items.map((n) => (
            <Pressable key={n.notif_id} onPress={() => open(n)} style={[styles.row, !n.read && styles.rowUnread]} testID={`axn-row-${n.notif_id}`}>
              <View style={[styles.rowIcon, { backgroundColor: n.read ? theme.color.surfaceTertiary : "#EDE9FE" }]}>
                <Ionicons name={(AXN_KIND_ICON[n.kind] || "sparkles") as any} size={18} color={n.read ? theme.color.muted : AXON} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, !n.read && { fontWeight: "900" }]} numberOfLines={2}>{n.title}</Text>
                <Text style={styles.rowBody} numberOfLines={3}>{n.body}</Text>
                <Text style={styles.rowMeta}>{fmt(n.created_at)}{n.team_copy_of ? " · team" : ""}</Text>
              </View>
              <Pressable onPress={() => remove(n)} hitSlop={8} style={styles.del} testID={`axn-del-${n.notif_id}`} accessibilityLabel="Elimina">
                <Ionicons name="trash-outline" size={18} color={theme.color.muted} />
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      ) : prefs && (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: pagePad, gap: 12 }}>
          <PushStatusCard />
          <ProactiveSettingsCard />
          <View style={styles.card}>
            <View style={styles.prefRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Notifiche push AxonOS</Text>
                <Text style={styles.prefSub}>Interruttore generale (in-app + telefono)</Text>
              </View>
              <Switch value={prefs.enabled} onValueChange={(v) => savePrefs({ enabled: v })} trackColor={{ true: AXON }} testID="axn-pref-enabled" />
            </View>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardHead}>Tipi di notifica</Text>
            {(Object.keys(prefs.kinds_labels) as AxnKind[]).map((k) => (
              <View key={k} style={styles.prefRow} testID={`axn-pref-${k}`}>
                <Ionicons name={AXN_KIND_ICON[k] as any} size={18} color={AXON} style={{ width: 26 }} />
                <Text style={[styles.prefTitle, { flex: 1, fontSize: 14 }]}>{prefs.kinds_labels[k]}</Text>
                <Switch value={!!prefs.kinds[k]} disabled={!prefs.enabled} onValueChange={(v) => savePrefs({ kinds: { ...prefs.kinds, [k]: v } })} trackColor={{ true: AXON }} />
              </View>
            ))}
          </View>
          {prefs.is_owner && (
            <View style={styles.card}>
              <Text style={styles.cardHead}>Master</Text>
              <View style={styles.prefRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prefTitle}>Copie delle notifiche del team</Text>
                  <Text style={styles.prefSub}>Ricevi anche gli avvisi inviati ai tuoi collaboratori (prefisso [Team])</Text>
                </View>
                <Switch value={prefs.team_copies} onValueChange={(v) => savePrefs({ team_copies: v })} trackColor={{ true: AXON }} testID="axn-pref-team" />
              </View>
              <Text style={[styles.prefTitle, { marginTop: 8 }]}>Piano crediti AI (richieste AxonOS / mese)</Text>
              <Text style={styles.prefSub}>Usati questo mese: {prefs.credits_used_month ?? 0} / {prefs.credits_plan_monthly} — avvisi al 50%, 80% e 100%</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput value={plan} onChangeText={setPlan} keyboardType="number-pad" style={styles.input} testID="axn-pref-plan" />
                <Pressable onPress={() => savePrefs({ credits_plan_monthly: parseInt(plan || "0", 10) || prefs.credits_plan_monthly })} style={styles.btn} testID="axn-pref-plan-save">
                  <Text style={styles.btnTxt}>Salva</Text>
                </Pressable>
              </View>
            </View>
          )}
          <Pressable onPress={sendTest} disabled={testing} style={[styles.btn, { alignSelf: "stretch", backgroundColor: AXON, minHeight: 48 }]} testID="axn-test">
            {testing ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="paper-plane" size={16} color="#FFF" /><Text style={styles.btnTxt}>Invia notifica di prova</Text></>}
          </Pressable>
          <Text style={styles.note}>Le push native richiedono la build pubblicata (Android e iOS); nell&apos;anteprima web e in Expo Go le notifiche restano visibili in questa lista.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary, gap: 8 },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.muted },
  tabs: { flexDirection: "row", margin: 14, marginBottom: 0, backgroundColor: theme.color.surfaceTertiary, borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  tabOn: { backgroundColor: theme.color.surfaceSecondary },
  tabTxt: { fontSize: 14, fontWeight: "700", color: theme.color.muted },
  tabTxtOn: { color: AXON },
  filter: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, minHeight: 40 },
  filterTxt: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  empty: { alignItems: "center", gap: 10, padding: 28 },
  emptyTxt: { fontSize: 13, color: theme.color.muted, textAlign: "center", lineHeight: 19 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 12 },
  rowUnread: { borderColor: "#C4B5FD", backgroundColor: "#FAF5FF" },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  rowBody: { fontSize: 13, color: theme.color.onSurface, marginTop: 2, lineHeight: 18 },
  rowMeta: { fontSize: 11, color: theme.color.muted, marginTop: 4 },
  del: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 14, gap: 8 },
  cardHead: { fontSize: 13, fontWeight: "900", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  prefRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  prefTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  prefSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  input: { flex: 1, borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.color.brandPrimary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 44 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  note: { fontSize: 12, color: theme.color.muted, textAlign: "center", lineHeight: 17 },
});
