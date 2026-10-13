// admin/users.tsx — V50.z541 — PANNELLO SUPERMASTER «Utenti registrati»: tutti gli utenti di tutte le organizzazioni.
// Ricerca, filtri (ruolo / stato), stato verifica email + prova/abbonamento + piano, ruolo, ultimo accesso.
// Azioni: Cambia ruolo · Sposta sotto un altro Master/Manager · Assegna piano · Reinvia email di benvenuto · Verifica email · Elimina.
// Accesso: stesso login dell'app (JWT) — il server risponde 403 se non sei super_admin (nessun secondo login).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Modal, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { KScrollView, KModalBody } from "@/src/ui/keyboard";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { HT } from "@/src/homeTheme";
import { theme } from "@/src/theme";

type AdminUser = {
  user_id: string; email: string; name: string; role: "owner" | "admin" | "member" | "consultant"; role_label: string; super_admin: boolean; is_root_master: boolean;
  parent_user_id: string | null; parent_email: string | null; children: number; org_plan: string | null; org_plan_label: string | null; org_max_users: number | null; org_used: number | null;
  product: string; advisor_tier: string; company?: string | null; subscription: string; trial_expires_at?: string | null; email_verified: boolean;
  created_at?: string | null; last_login?: string | null; welcome_email_sent_at?: string | null; welcome_email_error?: string | null;
};
type Plan = { id: string; label: string; max_users: number | null };
type Parent = { user_id: string; email: string; name: string; role: string; role_label: string; is_root: boolean };

const ROLE_OPTS: { id: AdminUser["role"]; label: string }[] = [{ id: "owner", label: "Master" }, { id: "admin", label: "Manager" }, { id: "member", label: "Collaboratore" }, { id: "consultant", label: "Consulente" }];
const ROLE_FILTERS = [{ id: "all", label: "Tutti" }, { id: "superadmin", label: "Supermaster" }, { id: "master", label: "Master" }, { id: "submaster", label: "Master figli" }, { id: "manager", label: "Manager" }, { id: "collab", label: "Collaboratori" }];
const STATUS_FILTERS = [{ id: "all", label: "Ogni stato" }, { id: "unverified", label: "Email non verificata" }, { id: "trial", label: "In prova" }, { id: "expired", label: "Scaduti" }, { id: "active", label: "Attivi" }, { id: "no_welcome", label: "Senza benvenuto" }];
const SUB_LABEL: Record<string, string> = { trial: "In prova", expired: "Scaduto", active: "Attivo", free_forever: "Gratis per sempre" };
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const fmtDT = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "mai");

const confirm = (title: string, msg: string, onOk: () => void) => {
  if (Platform.OS === "web") { if (window.confirm(`${title}\n\n${msg}`)) onOk(); return; }
  Alert.alert(title, msg, [{ text: "Annulla", style: "cancel" }, { text: "Conferma", style: "destructive", onPress: onOk }]);
};

export default function AdminUsersScreen() {
  const router = useRouter();
  const [data, setData] = useState<{ items: AdminUser[]; counts: Record<string, number>; plans: Plan[]; me: string } | null>(null);
  const [denied, setDenied] = useState(false);
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<AdminUser | null>(null);
  const [parents, setParents] = useState<Parent[]>([]);
  const [parentQ, setParentQ] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<typeof data>(`/admin/users?role=${roleF}&status=${statusF}`);
      setData(r); setDenied(false);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (/401|Not authenticated|Invalid token/i.test(msg)) { router.replace("/login" as any); return; }
      if (String(e?.status) === "403" || /super-admin|403/i.test(msg)) setDenied(true);
      else notify("Errore", msg || "Impossibile caricare gli utenti");
    }
  }, [roleF, statusF, router]);
  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => {
    if (!data) return [];
    const qn = q.trim().toLowerCase();
    return qn ? data.items.filter((u) => (u.email || "").toLowerCase().includes(qn) || (u.name || "").toLowerCase().includes(qn) || (u.parent_email || "").toLowerCase().includes(qn) || (u.company || "").toLowerCase().includes(qn)) : data.items;
  }, [data, q]);

  const run = async (id: string, fn: () => Promise<any>, okMsg: string) => {
    setBusy(id);
    try { await fn(); notify("Fatto", okMsg); await load(); }
    catch (e: any) {
      const d = e?.detail || e?.data?.detail;
      notify("Operazione non riuscita", (d && typeof d === "object" ? d.message : d) || e?.message || "Errore");
    } finally { setBusy(null); }
  };

  const del = (u: AdminUser) => {
    const cascade = u.children > 0;
    confirm(cascade ? `Eliminare ${u.email} e i suoi ${u.children} utenti?` : `Eliminare ${u.email}?`,
      cascade ? "Verranno eliminati anche TUTTI gli utenti sotto di lui (Manager e Collaboratori). Operazione irreversibile." : "L'utente non potrà più accedere. Operazione irreversibile.",
      () => void run(u.user_id, () => api(`/admin/users/${u.user_id}?cascade=${cascade ? 1 : 0}`, { method: "DELETE" }), "Utente eliminato"));
  };
  const setRole = (u: AdminUser, role: AdminUser["role"]) => run(u.user_id, () => api(`/admin/users/${u.user_id}`, { method: "PATCH", body: { role } }), `Ruolo: ${ROLE_OPTS.find((r) => r.id === role)?.label}`);
  const setPlan = (u: AdminUser, org_plan: string) => run(u.user_id, () => api(`/admin/users/${u.user_id}`, { method: "PATCH", body: { org_plan } }), org_plan ? "Piano assegnato" : "Piano rimosso (nessun limite)");
  const move = (u: AdminUser, parent_user_id: string) => run(u.user_id, () => api(`/admin/users/${u.user_id}`, { method: "PATCH", body: { parent_user_id } }), parent_user_id ? "Utente spostato" : "Ora è un Master indipendente");
  const resendWelcome = (u: AdminUser) => run(u.user_id, () => api(`/admin/users/${u.user_id}/welcome-email`, { method: "POST" }), `Email di benvenuto inviata a ${u.email}`);
  const forceVerify = (u: AdminUser) => run(u.user_id, () => api(`/admin/users/${u.user_id}/verify-email`, { method: "POST" }), "Email segnata come verificata");
  const openEdit = async (u: AdminUser) => {
    setEdit(u); setParentQ("");
    try { const r = await api<{ items: Parent[] }>("/admin/users/parents"); setParents(r.items.filter((p) => p.user_id !== u.user_id)); } catch { setParents([]); }
  };

  if (denied) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.header}><Pressable onPress={() => router.back()} hitSlop={10} testID="admin-users-back"><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable><Text style={s.title}>Utenti registrati</Text></View>
        <View style={s.center}><Ionicons name="lock-closed" size={36} color={HT.muted} /><Text style={s.deniedTxt} testID="admin-users-denied">Questa sezione è riservata al Supermaster.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="admin-users-back"><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Utenti registrati</Text>
          {data ? <Text style={s.sub} testID="admin-users-counts">{data.counts.total} totali · {data.counts.masters} Master · {data.counts.managers} Manager · {data.counts.collabs} Collaboratori{data.counts.unverified ? ` · ${data.counts.unverified} da verificare` : ""}</Text> : null}
        </View>
        <Pressable onPress={() => void load()} hitSlop={10} testID="admin-users-refresh"><Ionicons name="refresh" size={22} color={HT.violet} /></Pressable>
      </View>

      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={HT.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Cerca per email, nome, azienda o Master…" placeholderTextColor={HT.muted} style={s.searchInput} autoCapitalize="none" autoCorrect={false} testID="admin-users-search" />
        {q ? <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={HT.muted} /></Pressable> : null}
      </View>
      <KScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow} style={{ flexGrow: 0 }}>
        {ROLE_FILTERS.map((f) => <Pressable key={f.id} onPress={() => setRoleF(f.id)} style={[s.chip, roleF === f.id && s.chipOn]} testID={`admin-users-role-${f.id}`}><Text style={[s.chipTxt, roleF === f.id && s.chipTxtOn]}>{f.label}</Text></Pressable>)}
        <View style={s.chipSep} />
        {STATUS_FILTERS.map((f) => <Pressable key={f.id} onPress={() => setStatusF(f.id)} style={[s.chip, statusF === f.id && s.chipOn]} testID={`admin-users-status-${f.id}`}><Text style={[s.chipTxt, statusF === f.id && s.chipTxtOn]}>{f.label}</Text></Pressable>)}
      </KScrollView>

      <KScrollView contentContainerStyle={s.list}>
        {!data ? <ActivityIndicator color={HT.violet} style={{ marginTop: 40 }} /> : items.length === 0 ? <Text style={s.empty} testID="admin-users-empty">Nessun utente corrisponde ai filtri.</Text> : items.map((u) => {
          const isBusy = busy === u.user_id;
          return (
            <View key={u.user_id} style={[s.card, u.super_admin && s.cardSA]} testID={`admin-user-${u.user_id}`}>
              <View style={s.rowTop}>
                <View style={[s.avatar, { backgroundColor: u.super_admin ? HT.warning : u.role === "owner" ? HT.violet : u.role === "admin" ? HT.brand : HT.muted }]}><Text style={s.avatarTxt}>{(u.name || u.email || "?").slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{u.name || "—"}</Text>
                  <Text style={s.email} numberOfLines={1}>{u.email}</Text>
                </View>
                <View style={[s.roleBadge, u.super_admin && { backgroundColor: HT.warning + "22", borderColor: HT.warning }]}><Text style={[s.roleTxt, u.super_admin && { color: HT.warning }]}>{u.role_label}{u.role === "owner" && u.parent_user_id ? " figlio" : ""}</Text></View>
              </View>
              <View style={s.meta}>
                <Tag icon={u.email_verified === false ? "mail-unread-outline" : "checkmark-circle-outline"} txt={u.email_verified === false ? "Email da verificare" : "Email verificata"} warn={u.email_verified === false} />
                <Tag icon="time-outline" txt={`${SUB_LABEL[u.subscription] || u.subscription}${u.subscription === "trial" && u.trial_expires_at ? ` fino al ${fmt(u.trial_expires_at)}` : ""}`} warn={u.subscription === "expired"} />
                {u.is_root_master ? <Tag icon="layers-outline" txt={u.org_plan_label ? `${u.org_plan_label} · ${u.org_used}/${u.org_max_users ?? "∞"} utenti` : `Nessun piano · ${u.org_used} utenti`} warn={!!u.org_max_users && (u.org_used || 0) > u.org_max_users} /> : null}
                {u.parent_email ? <Tag icon="git-branch-outline" txt={`Sotto: ${u.parent_email}`} /> : null}
                {u.children ? <Tag icon="people-outline" txt={`${u.children} diretti`} /> : null}
                <Tag icon="log-in-outline" txt={`Ultimo accesso: ${fmtDT(u.last_login)}`} />
                <Tag icon="calendar-outline" txt={`Iscritto: ${fmt(u.created_at)}`} />
                <Tag icon={u.welcome_email_sent_at ? "mail-outline" : "alert-circle-outline"} txt={u.welcome_email_sent_at ? `Benvenuto inviato ${fmt(u.welcome_email_sent_at)}` : u.welcome_email_error ? `Benvenuto fallito: ${u.welcome_email_error.slice(0, 50)}` : "Benvenuto non inviato"} warn={!u.welcome_email_sent_at} />
              </View>
              <View style={s.actions}>
                <Act icon="create-outline" label="Gestisci" onPress={() => void openEdit(u)} disabled={isBusy} testID={`admin-user-edit-${u.user_id}`} />
                <Act icon="mail-outline" label="Reinvia benvenuto" onPress={() => void resendWelcome(u)} disabled={isBusy} testID={`admin-user-welcome-${u.user_id}`} />
                {u.email_verified === false ? <Act icon="checkmark-done-outline" label="Verifica email" onPress={() => void forceVerify(u)} disabled={isBusy} testID={`admin-user-verify-${u.user_id}`} /> : null}
                {!u.super_admin && u.user_id !== data.me ? <Act icon="trash-outline" label="Elimina" danger onPress={() => del(u)} disabled={isBusy} testID={`admin-user-delete-${u.user_id}`} /> : null}
                {isBusy ? <ActivityIndicator size="small" color={HT.violet} /> : null}
              </View>
            </View>
          );
        })}
      </KScrollView>

      <Modal visible={!!edit} transparent animationType="slide" onRequestClose={() => setEdit(null)}>
        <View style={s.modalBg}>
          <View style={s.modal}>
            <KModalBody>
              {edit ? (
                <View style={{ gap: 14 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>{edit.name || edit.email}</Text>
                    <Pressable onPress={() => setEdit(null)} hitSlop={10} testID="admin-user-modal-close"><Ionicons name="close" size={24} color={HT.text} /></Pressable>
                  </View>
                  <Text style={s.email}>{edit.email} · {edit.role_label}</Text>

                  <Text style={s.label}>Ruolo</Text>
                  <View style={s.optRow}>
                    {ROLE_OPTS.map((r) => <Pressable key={r.id} onPress={() => { setEdit(null); void setRole(edit, r.id); }} style={[s.opt, edit.role === r.id && s.optOn]} testID={`admin-user-role-${r.id}`}><Text style={[s.optTxt, edit.role === r.id && s.optTxtOn]}>{r.label}</Text></Pressable>)}
                  </View>
                  <Text style={s.help}>Supermaster › Master › Manager › Collaboratore. Un Master può avere più Manager; ogni Manager i propri Collaboratori.</Text>

                  {edit.is_root_master || !edit.parent_user_id ? (
                    <>
                      <Text style={s.label}>Piano dell&apos;organizzazione</Text>
                      <View style={s.optRow}>
                        {(data?.plans || []).map((p) => <Pressable key={p.id} onPress={() => { setEdit(null); void setPlan(edit, p.id); }} style={[s.opt, edit.org_plan === p.id && s.optOn]} testID={`admin-user-plan-${p.id}`}><Text style={[s.optTxt, edit.org_plan === p.id && s.optTxtOn]}>{p.label}{p.max_users ? ` (${p.max_users})` : ""}</Text></Pressable>)}
                        <Pressable onPress={() => { setEdit(null); void setPlan(edit, ""); }} style={[s.opt, !edit.org_plan && s.optOn]} testID="admin-user-plan-none"><Text style={[s.optTxt, !edit.org_plan && s.optTxtOn]}>Nessun limite</Text></Pressable>
                      </View>
                    </>
                  ) : null}

                  <Text style={s.label}>Sposta sotto un Master o Manager</Text>
                  <TextInput value={parentQ} onChangeText={setParentQ} placeholder="Cerca Master/Manager per email o nome…" placeholderTextColor={HT.muted} style={s.input} autoCapitalize="none" testID="admin-user-parent-search" />
                  <View style={{ gap: 6 }}>
                    {edit.parent_user_id ? <Pressable onPress={() => { setEdit(null); void move(edit, ""); }} style={s.parentRow} testID="admin-user-parent-none"><Ionicons name="star-outline" size={16} color={HT.warning} /><Text style={s.parentTxt}>Rendi Master indipendente (nessun parent)</Text></Pressable> : null}
                    {parents.filter((p) => !parentQ.trim() || `${p.email} ${p.name}`.toLowerCase().includes(parentQ.toLowerCase())).slice(0, 8).map((p) => (
                      <Pressable key={p.user_id} onPress={() => { setEdit(null); void move(edit, p.user_id); }} style={[s.parentRow, edit.parent_user_id === p.user_id && s.optOn]} testID={`admin-user-parent-${p.user_id}`}>
                        <Ionicons name={p.is_root ? "shield-outline" : "person-outline"} size={16} color={HT.violet} />
                        <View style={{ flex: 1 }}><Text style={s.parentTxt} numberOfLines={1}>{p.name || p.email}</Text><Text style={s.help} numberOfLines={1}>{p.email} · {p.role_label}{p.is_root ? " radice" : ""}</Text></View>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={s.help}>Lo spostamento porta con sé anche gli utenti sotto di lui e rispetta il limite del piano di destinazione.</Text>
                </View>
              ) : null}
            </KModalBody>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Tag({ icon, txt, warn }: { icon: React.ComponentProps<typeof Ionicons>["name"]; txt: string; warn?: boolean }) {
  return <View style={[s.tag, warn && s.tagWarn]}><Ionicons name={icon} size={12} color={warn ? HT.danger : HT.muted} /><Text style={[s.tagTxt, warn && { color: HT.danger }]} numberOfLines={1}>{txt}</Text></View>;
}
function Act({ icon, label, onPress, danger, disabled, testID }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; danger?: boolean; disabled?: boolean; testID?: string }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.act, danger && s.actDanger, disabled && { opacity: 0.5 }]} testID={testID}><Ionicons name={icon} size={15} color={danger ? HT.danger : HT.violet} /><Text style={[s.actTxt, danger && { color: HT.danger }]}>{label}</Text></Pressable>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  title: { color: HT.text, fontSize: 18, fontWeight: "800" },
  sub: { color: HT.muted, fontSize: 11.5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  deniedTxt: { color: HT.text2, fontSize: 14, textAlign: "center" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 46 },
  searchInput: { flex: 1, color: HT.text, fontSize: 14.5, paddingVertical: 10 },
  chipsRow: { gap: 6, paddingHorizontal: 12, paddingVertical: 10, alignItems: "center" },
  chip: { paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 16, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  chipOn: { backgroundColor: HT.violetTint, borderColor: HT.violet },
  chipTxt: { color: HT.text2, fontSize: 12.5, fontWeight: "600" },
  chipTxtOn: { color: HT.violet },
  chipSep: { width: 1, height: 20, backgroundColor: HT.border, marginHorizontal: 4 },
  list: { padding: 12, gap: 10, paddingBottom: 40 },
  empty: { color: HT.muted, textAlign: "center", marginTop: 30 },
  card: { backgroundColor: HT.card, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, padding: 12, gap: 10 },
  cardSA: { borderColor: HT.warning + "88" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#FFF", fontWeight: "800", fontSize: 16 },
  name: { color: HT.text, fontSize: 15, fontWeight: "800" },
  email: { color: HT.muted, fontSize: 12.5 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: HT.violet, backgroundColor: HT.violetTint },
  roleTxt: { color: HT.violet, fontSize: 11.5, fontWeight: "800" },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: HT.card2, maxWidth: "100%" },
  tagWarn: { backgroundColor: HT.danger + "14" },
  tagTxt: { color: HT.text2, fontSize: 11.5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  act: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: HT.violet + "66", backgroundColor: HT.violetTint },
  actDanger: { borderColor: HT.danger + "66", backgroundColor: HT.danger + "12" },
  actTxt: { color: HT.violet, fontSize: 12.5, fontWeight: "700" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modal: { backgroundColor: HT.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: "88%" },
  label: { color: HT.text, fontSize: 13.5, fontWeight: "800", marginTop: 4 },
  help: { color: HT.muted, fontSize: 12, lineHeight: 16 },
  optRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: { minHeight: 40, paddingHorizontal: 12, justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  optOn: { borderColor: HT.violet, backgroundColor: HT.violetTint },
  optTxt: { color: HT.text2, fontSize: 13, fontWeight: "600" },
  optTxtOn: { color: HT.violet },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, color: HT.text },
  parentRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  parentTxt: { color: HT.text, fontSize: 13.5, fontWeight: "600" },
});
