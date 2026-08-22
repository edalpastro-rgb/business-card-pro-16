import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Share, Platform, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
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

type Invite = {
  invite_token: string;
  invite_role?: string | null;
  collaborator_name?: string | null;
  note?: string;
  created_at: string;
  used_at?: string | null;
  used_by_user_id?: string | null;
  invited_user?: { user_id: string; name?: string; email?: string; subscription?: { status: string } };
};

type TeamMember = { user_id: string; name?: string; email?: string; role?: string };

export default function InviteCollaboratorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ contact_id?: string; contact_name?: string; contact_email?: string; intent?: string }>();
  const linkedContactId = params.contact_id || null;
  const [role, setRole] = useState<Role>("basic");
  const [collaboratorName, setCollaboratorName] = useState("");
  const [note, setNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [invite, setInvite] = useState<{ invite_token: string; role?: string | null } | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [editRole, setEditRole] = useState<Invite | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  // V27 — Assign under an existing team member
  const [assignParentId, setAssignParentId] = useState<string | null>(null); // null = assign directly to master
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // V27 — Prefill collaboratore name from linked contact (if picked from rubrica)
  useEffect(() => {
    if (params.contact_name && !collaboratorName) {
      setCollaboratorName(String(params.contact_name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.contact_name]);

  const loadInvites = useCallback(async () => {
    try {
      const r = await api<{ items: Invite[] }>("/invites");
      setInvites(r.items || []);
    } catch (e: any) {
      console.warn("invites list", e?.message);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadTeam = useCallback(async () => {
    try {
      const r = await api<{ items: TeamMember[] }>("/team/members");
      setTeamMembers(r.items || []);
    } catch (e: any) {
      console.warn("team list", e?.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadInvites(); loadTeam(); }, [loadInvites, loadTeam]));

  const generate = async () => {
    if (!collaboratorName.trim()) { notify("Nome richiesto", "Inserisci il nome del collaboratore."); return; }
    try {
      setGenerating(true);
      const r = await api<{ invite_token: string; invite_role?: string }>("/invites", {
        method: "POST",
        body: {
          trial_days: 30,
          note,
          role,
          collaborator_name: collaboratorName.trim(),
          // Master figlio is a sub-tenant, so we ignore parent override for it.
          assign_parent_user_id: role !== "master_figlio" ? assignParentId : null,
          contact_id: linkedContactId,
          contact_intent: "collaborator",
        },
      });
      setInvite({ invite_token: r.invite_token, role: r.invite_role });
      await loadInvites();
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

  const deleteInvite = (inv: Invite) => notify(
    "Elimina invito",
    inv.used_at ? `Vuoi rimuovere il collaboratore "${inv.collaborator_name || inv.invited_user?.name || '?'}"?` : `Revocare l'invito a "${inv.collaborator_name || '?'}"?`,
    [
      { text: "Annulla", style: "cancel" },
      { text: "Elimina", style: "destructive", onPress: async () => {
        try { await api(`/invites/${inv.invite_token}`, { method: "DELETE" }); await loadInvites(); }
        catch (e: any) { notify("Errore", e?.message || ""); }
      }},
    ]
  );

  const changeRole = async (newRole: "member" | "admin" | "owner") => {
    if (!editRole?.invited_user?.user_id) return;
    try {
      setSavingRole(true);
      await api(`/team/${editRole.invited_user.user_id}/role`, { method: "PUT", body: { role: newRole } });
      notify("Ruolo aggiornato", `Il ruolo è stato modificato con successo.`);
      setEditRole(null);
      await loadInvites();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally {
      setSavingRole(false);
    }
  };

  const roleLabel = (backendRole?: string | null) => {
    if (backendRole === "member") return "Basic";
    if (backendRole === "admin") return "Manager";
    if (backendRole === "owner") return "Master figlio";
    return backendRole || "—";
  };
  const roleColor = (backendRole?: string | null) => {
    if (backendRole === "member") return "#0891B2";
    if (backendRole === "admin") return "#F59E0B";
    if (backendRole === "owner") return "#7C3AED";
    return "#6B7280";
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.background }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace("/(tabs)/home" as any)} style={styles.headerBtn} testID="invite-back-home"><Ionicons name="chevron-back" size={22} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Invita Collaboratore</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {!invite ? (
          <>
            <Text style={styles.label}>Nome collaboratore</Text>
            <TextInput
              value={collaboratorName}
              onChangeText={setCollaboratorName}
              style={styles.input}
              placeholder="Es. Mario Rossi"
              autoCapitalize="words"
              testID="invite-name"
            />

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

            {/* V27 — Assegnazione gerarchica (non applicabile a Master figlio che apre un sub-tenant) */}
            {role !== "master_figlio" && (
              <>
                <Text style={styles.label}>Assegna sotto</Text>
                <Pressable
                  onPress={() => setAssignParentId(null)}
                  testID="assign-self"
                  style={[styles.roleCard, assignParentId === null && { borderColor: "#0891B2", backgroundColor: "#0891B212" }]}
                >
                  <View style={[styles.roleIcon, { backgroundColor: "#0891B2" }]}><Ionicons name="person-circle" size={22} color="#FFF" /></View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.roleTitle}>Direttamente a te (Master)</Text>
                    <Text style={styles.roleDesc}>Il nuovo collaboratore risponde direttamente al tuo account.</Text>
                  </View>
                  {assignParentId === null && <Ionicons name="checkmark-circle" size={22} color="#0891B2" />}
                </Pressable>
                {teamMembers.length > 0 && (
                  <>
                    <Text style={styles.subLabel}>Oppure sotto un collaboratore esistente:</Text>
                    {teamMembers.map((tm) => {
                      const on = assignParentId === tm.user_id;
                      const tmRoleLabel = tm.role === "admin" ? "Manager" : tm.role === "owner" ? "Master" : "Basic";
                      return (
                        <Pressable
                          key={tm.user_id}
                          onPress={() => setAssignParentId(tm.user_id)}
                          testID={`assign-parent-${tm.user_id}`}
                          style={[styles.memberRow, on && { borderColor: "#F59E0B", backgroundColor: "#F59E0B12" }]}
                        >
                          <View style={[styles.avatarSmall, { backgroundColor: on ? "#F59E0B" : "#94A3B8" }]}>
                            <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 12 }}>
                              {(tm.name || tm.email || "?")[0]?.toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.memberName} numberOfLines={1}>{tm.name || tm.email || "—"}</Text>
                            <Text style={styles.memberSub} numberOfLines={1}>{tmRoleLabel}{tm.email ? ` · ${tm.email}` : ""}</Text>
                          </View>
                          {on && <Ionicons name="checkmark-circle" size={20} color="#F59E0B" />}
                        </Pressable>
                      );
                    })}
                  </>
                )}
              </>
            )}

            <Text style={styles.label}>Nota (opzionale)</Text>
            <TextInput value={note} onChangeText={setNote} style={[styles.input, { height: 60, textAlignVertical: "top" }]} multiline placeholder="Es. Team Milano" testID="invite-note" />

            <Pressable onPress={generate} disabled={generating} style={styles.submitBtn} testID="invite-generate">
              {generating ? <ActivityIndicator color="#FFF" /> : (<><Ionicons name="qr-code" size={20} color="#FFF" /><Text style={styles.submitTxt}>Genera link + QR</Text></>)}
            </Pressable>
          </>
        ) : (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>🎉 Invito generato</Text>
            <Text style={styles.resultSub}>Per <Text style={{ fontWeight: "800" }}>{collaboratorName}</Text> · Ruolo <Text style={{ fontWeight: "800" }}>{ROLES.find(r => r.id === role)?.label}</Text></Text>
            <View style={styles.qrWrap}>
              <QRCode value={inviteUrl} size={200} backgroundColor="#FFF" color="#0F172A" />
            </View>
            <View style={styles.linkBox}>
              <Text style={styles.linkTxt} numberOfLines={1} selectable>{inviteUrl}</Text>
            </View>
            <View style={styles.actionsRow}>
              <Pressable onPress={copy} style={[styles.actBtn, { backgroundColor: "#F1F5F9" }]} testID="copy-link"><Ionicons name="copy-outline" size={18} color={theme.color.onSurface} /><Text style={styles.actTxt}>Copia</Text></Pressable>
              <Pressable onPress={shareLink} style={[styles.actBtn, { backgroundColor: "#7C3AED" }]} testID="share-link"><Ionicons name="share-social" size={18} color="#FFF" /><Text style={[styles.actTxt, { color: "#FFF" }]}>Condividi</Text></Pressable>
            </View>
            <Pressable onPress={() => { setInvite(null); setCollaboratorName(""); setNote(""); }} style={{ marginTop: 16, alignSelf: "center" }}>
              <Text style={{ color: theme.color.brandPrimary, fontWeight: "700" }}>← Genera un altro invito</Text>
            </Pressable>
          </View>
        )}

        {/* Lista collaboratori invitati */}
        <View style={styles.listSection}>
          <Text style={styles.sectionTitle}>Collaboratori invitati ({invites.length})</Text>
          {loadingList ? (
            <ActivityIndicator style={{ marginTop: 20 }} color={theme.color.brandPrimary} />
          ) : invites.length === 0 ? (
            <Text style={styles.emptyTxt}>Nessun invito ancora generato.</Text>
          ) : (
            invites.map((inv) => {
              const active = !!inv.used_at;
              const displayName = inv.invited_user?.name || inv.collaborator_name || "—";
              const rColor = roleColor(inv.invite_role);
              return (
                <View key={inv.invite_token} style={styles.inviteRow} testID={`invite-row-${inv.invite_token}`}>
                  <View style={[styles.avatar, { backgroundColor: rColor + "22" }]}>
                    <Ionicons name={active ? "checkmark-circle" : "hourglass-outline"} size={22} color={rColor} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.inviteName}>{displayName}</Text>
                    <View style={styles.inviteMetaRow}>
                      <View style={[styles.rolePill, { backgroundColor: rColor + "22" }]}>
                        <Text style={[styles.rolePillTxt, { color: rColor }]}>{roleLabel(inv.invite_role)}</Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: active ? "#DCFCE7" : "#FEF3C7" }]}>
                        <Text style={[styles.statusPillTxt, { color: active ? "#166534" : "#92400E" }]}>{active ? "● Attivo" : "○ In attesa"}</Text>
                      </View>
                    </View>
                    {inv.invited_user?.email && <Text style={styles.inviteEmail}>{inv.invited_user.email}</Text>}
                    <Text style={styles.inviteDate}>Invitato {fmtDate(inv.created_at)}{active && inv.used_at ? ` · Registrato ${fmtDate(inv.used_at)}` : ""}</Text>
                  </View>
                  {active && (
                    <Pressable onPress={() => setEditRole(inv)} style={styles.trashBtn} testID={`invite-edit-role-${inv.invite_token}`}>
                      <Ionicons name="create-outline" size={18} color="#0891B2" />
                    </Pressable>
                  )}
                  <Pressable onPress={() => deleteInvite(inv)} style={styles.trashBtn} testID={`invite-delete-${inv.invite_token}`}>
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </Pressable>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal transparent visible={!!editRole} animationType="fade" onRequestClose={() => setEditRole(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.modalT}>Modifica ruolo</Text>
            <Text style={styles.modalSub}>{editRole?.invited_user?.name || editRole?.collaborator_name}</Text>
            {(["member","admin","owner"] as const).map((r) => {
              const info = r === "member" ? { label: "Basic", color: "#0891B2", icon: "person" as const, desc: "Vede solo i propri contatti" }
                : r === "admin" ? { label: "Manager", color: "#F59E0B", icon: "people" as const, desc: "Vede il proprio gruppo" }
                : { label: "Master figlio", color: "#7C3AED", icon: "star" as const, desc: "Sotto-master del proprio team" };
              const isCurrent = editRole?.invite_role === r;
              return (
                <Pressable key={r} onPress={() => changeRole(r)} disabled={savingRole || isCurrent} style={[styles.roleCard, { marginBottom: 8 }, isCurrent && { borderColor: info.color, backgroundColor: info.color + "12" }]} testID={`edit-role-${r}`}>
                  <View style={[styles.roleIcon, { backgroundColor: info.color }]}><Ionicons name={info.icon} size={20} color="#FFF" /></View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.roleTitle}>{info.label} {isCurrent && "(attuale)"}</Text>
                    <Text style={styles.roleDesc}>{info.desc}</Text>
                  </View>
                  {savingRole ? <ActivityIndicator color={info.color} /> : isCurrent && <Ionicons name="checkmark-circle" size={20} color={info.color} />}
                </Pressable>
              );
            })}
            <Pressable onPress={() => setEditRole(null)} style={{ marginTop: 8, alignItems: "center", padding: 10 }} testID="edit-role-cancel">
              <Text style={{ color: theme.color.muted, fontWeight: "700" }}>Annulla</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  label: { fontSize: 12, fontWeight: "700", color: theme.color.muted, marginTop: 16, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 },
  subLabel: { fontSize: 11, fontWeight: "700", color: theme.color.onSurfaceTertiary, marginTop: 6, marginBottom: 6 },
  memberRow: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 12, borderWidth: 2, borderColor: theme.color.border, backgroundColor: theme.color.surface, marginBottom: 6 },
  avatarSmall: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  memberName: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  memberSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  roleCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 2, borderColor: theme.color.border, backgroundColor: theme.color.surface, marginBottom: 8 },
  roleIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  roleTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  roleDesc: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  input: { borderWidth: 1, borderColor: theme.color.border, borderRadius: 10, padding: 12, fontSize: 14, color: theme.color.onSurface, backgroundColor: theme.color.surface },
  submitBtn: { marginTop: 24, backgroundColor: "#DB2777", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12 },
  submitTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  resultCard: { padding: 20, backgroundColor: theme.color.surface, borderRadius: 16, alignItems: "center", borderWidth: 1, borderColor: theme.color.border },
  resultTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface, marginBottom: 6 },
  resultSub: { fontSize: 13, color: theme.color.muted, marginBottom: 12, textAlign: "center" },
  qrWrap: { padding: 12, backgroundColor: "#FFF", borderRadius: 12, marginBottom: 12 },
  linkBox: { padding: 10, backgroundColor: "#F1F5F9", borderRadius: 8, width: "100%" },
  linkTxt: { fontSize: 11, color: theme.color.onSurface, fontFamily: Platform.OS === "web" ? "monospace" : undefined },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14, width: "100%" },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 12, borderRadius: 10 },
  actTxt: { fontWeight: "800", fontSize: 13, color: theme.color.onSurface },
  listSection: { marginTop: 28 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 },
  emptyTxt: { fontSize: 12, color: theme.color.muted, fontStyle: "italic", textAlign: "center", paddingVertical: 20 },
  inviteRow: { flexDirection: "row", alignItems: "flex-start", backgroundColor: theme.color.surface, padding: 12, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.color.border },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  inviteName: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  inviteMetaRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  rolePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  rolePillTxt: { fontSize: 10, fontWeight: "800" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  statusPillTxt: { fontSize: 10, fontWeight: "800" },
  inviteEmail: { fontSize: 11, color: theme.color.muted, marginTop: 4 },
  inviteDate: { fontSize: 10, color: theme.color.muted, marginTop: 2 },
  trashBtn: { padding: 6, marginLeft: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  modalBox: { backgroundColor: "#FFF", borderRadius: 18, padding: 18 },
  modalT: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, textAlign: "center" },
  modalSub: { fontSize: 13, color: theme.color.muted, textAlign: "center", marginBottom: 14, marginTop: 4 },
});
