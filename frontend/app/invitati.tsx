import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, Platform, Share } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import Constants from "expo-constants";

type InvitedUser = { user_id: string; name: string; email: string; subscription: { status: string; days_left?: number | null; expires_at?: string | null; is_active: boolean } };
type Invite = { invite_token: string; trial_days: number; note: string; created_at: string; used_at?: string | null; invited_user?: InvitedUser };

function getPublicOrigin(): string {
  // Best-effort: use current origin on web, otherwise leave placeholder
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  const backend = (Constants.expoConfig?.extra as any)?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL || "";
  // Backend URL like https://xxx.preview.emergentagent.com — used to derive public app URL
  return backend || "https://tuoapp.it";
}

export default function InvitatiScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [trialDays, setTrialDays] = useState("30");
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Invite[] }>("/invites");
      setItems(r.items);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const createInvite = async () => {
    const days = parseInt(trialDays, 10) || 30;
    setCreating(true);
    try {
      const inv = await api<Invite>("/invites", { method: "POST", body: { trial_days: days, note } });
      setNote("");
      await load();
      // Share link automatically
      const url = `${getPublicOrigin()}/invite/${inv.invite_token}`;
      Alert.alert("Link invito creato ✓", url, [
        { text: "Copia link", onPress: async () => { await Clipboard.setStringAsync(url); Alert.alert("Link copiato"); } },
        { text: "Condividi", onPress: async () => { try { if (Platform.OS === "web" && (navigator as any).share) { await (navigator as any).share({ text: `Invito Dal Pastro CRM — accedi qui: ${url}` }); } else { await Share.share({ message: `Invito Dal Pastro CRM — accedi qui: ${url}` }); } } catch {} } },
        { text: "OK" },
      ]);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Creazione fallita");
    } finally { setCreating(false); }
  };

  const extendTrial = async (userId: string, days: number) => {
    try {
      const r = await api<{ subscription: { days_left: number } }>(`/users/${userId}/extend-trial`, { method: "PUT", body: { add_days: days } });
      Alert.alert("Trial esteso", `Ora ha ${r.subscription.days_left} giorni residui.`);
      load();
    } catch (e: any) { Alert.alert("Errore", e?.message || "Estensione fallita"); }
  };

  const extendCustom = (userId: string) => {
    if (Platform.OS === "web") {
      const v = window.prompt("Quanti giorni aggiungere?", "60");
      const n = parseInt(v || "", 10);
      if (n > 0) extendTrial(userId, n);
    } else {
      Alert.prompt?.("Estendi trial", "Quanti giorni aggiungere?", (v?: string) => {
        const n = parseInt(v || "", 10);
        if (n > 0) extendTrial(userId, n);
      }, "plain-text", "60");
    }
  };

  const setFreeForever = async (userId: string) => {
    try {
      await api(`/users/${userId}/free-forever`, { method: "PUT" });
      Alert.alert("Free Sempre attivato", "L'utente ora ha accesso gratuito illimitato.");
      load();
    } catch (e: any) { Alert.alert("Errore", e?.message || "Operazione fallita"); }
  };

  const revokeFreeForever = (userId: string) => {
    Alert.alert(
      "Rimuovere Free Sempre?",
      "L'utente tornerà a un trial. Al termine dovrà pagare per continuare.",
      [
        { text: "Annulla", style: "cancel" },
        { text: "Trial 30 gg", onPress: async () => {
          try {
            await api(`/users/${userId}/revoke-free-forever`, { method: "PUT", body: { mode: "trial", trial_days: 30 } });
            load();
          } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
        }},
        { text: "Scaduto (richiede pagamento subito)", style: "destructive", onPress: async () => {
          try {
            await api(`/users/${userId}/revoke-free-forever`, { method: "PUT", body: { mode: "expired" } });
            load();
          } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
        }},
      ],
    );
  };

  const copyInviteLink = async (token: string) => {
    const url = `${getPublicOrigin()}/invite/${token}`;
    await Clipboard.setStringAsync(url);
    Alert.alert("Copiato", url);
  };

  const deleteInvite = async (token: string) => {
    Alert.alert("Elimina invito", "Sei sicuro?", [
      { text: "Annulla", style: "cancel" },
      { text: "Elimina", style: "destructive", onPress: async () => { await api(`/invites/${token}`, { method: "DELETE" }); load(); } },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Clienti invitati</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Nuovo invito</Text>
          <Text style={styles.hint}>Genera un link da condividere con il cliente. Al primo accesso avrà un trial di N giorni.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lbl}>Giorni di trial</Text>
              <TextInput testID="inv-days" value={trialDays} onChangeText={setTrialDays} keyboardType="number-pad" style={styles.input} />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={styles.lbl}>Nota (opz.)</Text>
              <TextInput testID="inv-note" value={note} onChangeText={setNote} placeholder="Es. Presentazione demo Rossi" placeholderTextColor="#94A3B8" style={styles.input} />
            </View>
          </View>
          <Pressable testID="inv-create" onPress={createInvite} disabled={creating} style={styles.saveBtn}>
            {creating ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Genera link invito</Text>}
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Storico inviti ({items.length})</Text>
        {loading ? (
          <ActivityIndicator color={theme.color.brandPrimary} />
        ) : items.length === 0 ? (
          <Text style={styles.emptyTxt}>Ancora nessun invito. Crea il primo qui sopra.</Text>
        ) : items.map((i) => {
          const used = !!i.used_at;
          const invited = i.invited_user;
          const daysLeft = invited?.subscription?.days_left ?? null;
          const status = invited?.subscription?.status || (used ? "expired" : "pending");
          const isFreeForever = status === "free_forever";
          const statusColor =
            isFreeForever ? "#7A2E8E"
            : status === "trial" && (daysLeft ?? 0) > 5 ? theme.color.success
            : status === "trial" ? theme.color.warning
            : status === "expired" ? theme.color.error
            : theme.color.info;
          return (
            <View key={i.invite_token} style={styles.inviteCard}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={styles.statusLabel}>
                    {used ? (invited ? invited.name : "Utilizzato") : "In attesa"}
                    {isFreeForever ? " · Free Sempre ∞" : daysLeft !== null ? ` · ${daysLeft} gg residui` : ""}
                  </Text>
                </View>
                <Pressable onPress={() => deleteInvite(i.invite_token)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={theme.color.error} />
                </Pressable>
              </View>
              {invited && <Text style={styles.inviteEmail}>{invited.email}</Text>}
              {i.note && <Text style={styles.inviteNote}>&quot;{i.note}&quot;</Text>}
              <Text style={styles.inviteMeta}>Trial iniziale: {i.trial_days} gg · Creato: {new Date(i.created_at).toLocaleDateString("it-IT")}</Text>
              {!used ? (
                <Pressable testID={`inv-copy-${i.invite_token}`} onPress={() => copyInviteLink(i.invite_token)} style={styles.copyBtn}>
                  <Ionicons name="copy-outline" size={14} color="#FFF" />
                  <Text style={styles.copyBtnTxt}>Copia link invito</Text>
                </Pressable>
              ) : invited && (
                <View style={{ gap: 8 }}>
                  {!isFreeForever ? (
                    <>
                      <View style={styles.extendRow}>
                        <Text style={styles.extendLbl}>Estendi trial:</Text>
                        <Pressable onPress={() => extendTrial(invited.user_id, 7)} style={styles.extendBtn}><Text style={styles.extendBtnTxt}>+7</Text></Pressable>
                        <Pressable onPress={() => extendTrial(invited.user_id, 15)} style={styles.extendBtn}><Text style={styles.extendBtnTxt}>+15</Text></Pressable>
                        <Pressable onPress={() => extendTrial(invited.user_id, 30)} style={styles.extendBtn}><Text style={styles.extendBtnTxt}>+30</Text></Pressable>
                        <Pressable onPress={() => extendCustom(invited.user_id)} style={[styles.extendBtn, { backgroundColor: theme.color.brandPrimary }]}><Text style={[styles.extendBtnTxt, { color: "#FFF" }]}>Custom</Text></Pressable>
                      </View>
                      <Pressable
                        testID={`inv-free-forever-${invited.user_id}`}
                        onPress={() => setFreeForever(invited.user_id)}
                        style={[styles.extendBtn, { backgroundColor: "#7A2E8E", alignSelf: "flex-start", paddingHorizontal: 14 }]}
                      >
                        <Text style={[styles.extendBtnTxt, { color: "#FFF" }]}>♾️ Attiva Free Sempre</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      testID={`inv-revoke-free-forever-${invited.user_id}`}
                      onPress={() => revokeFreeForever(invited.user_id)}
                      style={[styles.extendBtn, { backgroundColor: theme.color.error, alignSelf: "flex-start", paddingHorizontal: 14 }]}
                    >
                      <Text style={[styles.extendBtnTxt, { color: "#FFF" }]}>Rimuovi Free Sempre → Passa a pagamento</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          );
        })}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: theme.color.brandPrimary, textTransform: "uppercase", letterSpacing: 0.5 },
  hint: { color: theme.color.muted, fontSize: 12, marginTop: 4, fontStyle: "italic" },
  lbl: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 12, borderRadius: theme.radius.md, alignItems: "center", marginTop: 12 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 14 },
  emptyTxt: { color: theme.color.muted, fontStyle: "italic", textAlign: "center", padding: 20 },
  inviteCard: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontWeight: "700", color: theme.color.onSurface, fontSize: 13 },
  inviteEmail: { color: theme.color.brandPrimary, fontSize: 13, marginBottom: 2 },
  inviteNote: { color: theme.color.onSurfaceTertiary, fontSize: 12, fontStyle: "italic", marginBottom: 4 },
  inviteMeta: { color: theme.color.muted, fontSize: 11, marginBottom: 8 },
  copyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: theme.color.brandPrimary, paddingVertical: 8, borderRadius: theme.radius.md },
  copyBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  extendRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  extendLbl: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginRight: 4 },
  extendBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  extendBtnTxt: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
});
