import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Share, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
type IconName = keyof typeof Ionicons.glyphMap;

type Role = "basic" | "manager" | "master_figlio";

const ROLES: { id: Role; label: string; icon: IconName; color: string; desc: string }[] = [
  { id: "basic", label: "Basic", icon: "person", color: "#0891B2", desc: "Collaboratore: vede solo i propri contatti" },
  { id: "manager", label: "Manager", icon: "people", color: "#F59E0B", desc: "Responsabile: vede il proprio gruppo" },
  { id: "master_figlio", label: "Master figlio", icon: "star", color: "#7C3AED", desc: "Sotto-master: gestisce il proprio sotto-team" },
];

export default function InviteCollaboratorScreen() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("basic");
  const [trialDays, setTrialDays] = useState("30");
  const [note, setNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [invite, setInvite] = useState<{ invite_token: string; role?: string | null } | null>(null);

  const generate = async () => {
    try {
      setGenerating(true);
      const days = Math.max(1, parseInt(trialDays) || 30);
      const r = await api<{ invite_token: string; invite_role?: string }>("/invites", { method: "POST", body: { trial_days: days, note, role } });
      setInvite({ invite_token: r.invite_token, role: r.invite_role });
    } catch (e: any) { notify("Errore", e?.message || ""); } finally { setGenerating(false); }
  };

  const inviteUrl = invite ? `${process.env.EXPO_PUBLIC_BACKEND_URL || ""}/invite/${invite.invite_token}`.replace("/api/invite", "/invite") : "";

  const copy = async () => {
    if (!inviteUrl) return;
    try { await Clipboard.setStringAsync(inviteUrl); notify("Copiato", "Link copiato negli appunti"); } catch {}
  };
  const shareLink = async () => {
    if (!inviteUrl) return;
    try {
      if (Platform.OS === "web") {
        const nav: any = (globalThis as any).navigator;
        if (nav?.share) { await nav.share({ title: "Invito Collaboratore", url: inviteUrl }); return; }
        await copy();
      } else {
        await Share.share({ message: inviteUrl });
      }
    } catch {}
  };
  const openInviteList = () => router.push("/invitati" as any);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}><Ionicons name="chevron-back" size={22} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Invita Collaboratore</Text>
        <Pressable onPress={openInviteList} style={styles.headerBtn}><Ionicons name="list" size={22} color={theme.color.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {!invite ? (
          <>
            <Text style={styles.label}>Ruolo</Text>
            {ROLES.map((r) => (
              <Pressable key={r.id} onPress={() => setRole(r.id)} testID={`role-${r.id}`} style={[styles.roleCard, role === r.id && { borderColor: r.color, backgroundColor: r.color + "12" }]}>
                <View style={[styles.roleIcon, { backgroundColor: r.color }]}><Ionicons name={r.icon} size={22} color="#FFF" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.roleTitle}>{r.label}</Text>
                  <Text style={styles.roleDesc}>{r.desc}</Text>
                </View>
                {role === r.id && <Ionicons name="checkmark-circle" size={22} color={r.color} />}
              </Pressable>
            ))}

            <Text style={styles.label}>Giorni di prova</Text>
            <TextInput value={trialDays} onChangeText={setTrialDays} keyboardType="numeric" style={styles.input} placeholder="30" testID="trial-days" />

            <Text style={styles.label}>Nota (opzionale)</Text>
            <TextInput value={note} onChangeText={setNote} style={[styles.input, { height: 60, textAlignVertical: "top" }]} multiline placeholder="Es. Team Milano" testID="invite-note" />

            <Pressable onPress={generate} disabled={generating} style={styles.submitBtn} testID="invite-generate">
              {generating ? <ActivityIndicator color="#FFF" /> : (<><Ionicons name="qr-code" size={20} color="#FFF" /><Text style={styles.submitTxt}>Genera link + QR</Text></>)}
            </Pressable>
          </>
        ) : (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>🎉 Invito generato</Text>
            <View style={styles.qrWrap}>
              <QRCode value={inviteUrl} size={200} backgroundColor="#FFF" color="#0F172A" />
            </View>
            <Text style={styles.roleTag}>Ruolo: <Text style={{ fontWeight: "800" }}>{ROLES.find(r => (r.id === "basic" && invite.role === "member") || (r.id === "manager" && invite.role === "admin") || (r.id === "master_figlio" && invite.role === "owner"))?.label || invite.role}</Text></Text>
            <View style={styles.linkBox}>
              <Text style={styles.linkTxt} numberOfLines={1} selectable>{inviteUrl}</Text>
            </View>
            <View style={styles.actionsRow}>
              <Pressable onPress={copy} style={[styles.actBtn, { backgroundColor: "#F1F5F9" }]} testID="copy-link"><Ionicons name="copy-outline" size={18} color={theme.color.onSurface} /><Text style={styles.actTxt}>Copia</Text></Pressable>
              <Pressable onPress={shareLink} style={[styles.actBtn, { backgroundColor: "#7C3AED" }]} testID="share-link"><Ionicons name="share-social" size={18} color="#FFF" /><Text style={[styles.actTxt, { color: "#FFF" }]}>Condividi</Text></Pressable>
            </View>
            <Pressable onPress={() => setInvite(null)} style={{ marginTop: 16, alignSelf: "center" }}>
              <Text style={{ color: theme.color.brandPrimary, fontWeight: "700" }}>← Genera un altro invito</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  label: { fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 16, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 },
  roleCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 2, borderColor: theme.color.border, backgroundColor: theme.color.surface, marginBottom: 8 },
  roleIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  roleTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  roleDesc: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  input: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  submitBtn: { marginTop: 30, backgroundColor: "#DB2777", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  submitTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  resultCard: { padding: 20, backgroundColor: theme.color.surface, borderRadius: 16, alignItems: "center", borderWidth: 1, borderColor: theme.color.border },
  resultTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface, marginBottom: 16 },
  qrWrap: { padding: 12, backgroundColor: "#FFF", borderRadius: 12, marginBottom: 12 },
  roleTag: { fontSize: 13, color: theme.color.muted, marginBottom: 10 },
  linkBox: { padding: 10, backgroundColor: "#F1F5F9", borderRadius: 8, width: "100%" },
  linkTxt: { fontSize: 11, color: theme.color.onSurface, fontFamily: Platform.OS === "web" ? "monospace" : undefined },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14, width: "100%" },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 12, borderRadius: 10 },
  actTxt: { fontWeight: "800", fontSize: 13, color: theme.color.onSurface },
});
