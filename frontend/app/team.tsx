import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { confirmAsync, notify } from "@/src/utils/notify";

type Member = { user_id: string; email: string; name: string; role: string; areas: string[]; agent_code?: string | null; created_at?: string };

// V28.z — Sotto-componente per i campi Master-only: codice agente + password dati sensibili.
// Il team screen è già Master-only (endpoint /team ritorna 403 altrimenti), quindi qui
// mostriamo i campi senza ulteriori check.
function MasterOnlyFields({ member, onUpdated }: { member: Member; onUpdated: () => void }) {
  const [agentCode, setAgentCode] = useState<string>(member.agent_code || "");
  const [savingCode, setSavingCode] = useState(false);
  const [sensLoading, setSensLoading] = useState(false);
  const [sensSaving, setSensSaving] = useState(false);
  const [sensReveal, setSensReveal] = useState(false);
  const [sensValue, setSensValue] = useState<string>("");
  const [sensLoaded, setSensLoaded] = useState(false);

  const saveAgentCode = async () => {
    if ((agentCode || "").trim() === (member.agent_code || "")) return;
    try {
      setSavingCode(true);
      await api(`/team/${member.user_id}`, { method: "PUT", body: { agent_code: agentCode.trim() } });
      onUpdated();
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setSavingCode(false); }
  };

  const loadSensitive = useCallback(async () => {
    if (sensLoaded) return;
    try {
      setSensLoading(true);
      const r = await api<{ value: string }>(`/team/${member.user_id}/sensitive-password`);
      setSensValue(r?.value || "");
      setSensLoaded(true);
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setSensLoading(false); }
  }, [sensLoaded, member.user_id]);

  const toggleReveal = async () => {
    if (!sensReveal) { await loadSensitive(); }
    setSensReveal((v) => !v);
  };

  const saveSensitive = async () => {
    try {
      setSensSaving(true);
      await api(`/team/${member.user_id}/sensitive-password`, { method: "PUT", body: { value: sensValue } });
      notify("Salvato", "Password dati sensibili aggiornata.");
    } catch (e: any) {
      notify("Errore", e?.message || "");
    } finally { setSensSaving(false); }
  };

  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name="pricetag" size={14} color={theme.color.muted} />
        <Text style={{ fontSize: 11, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Codice agente</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <TextInput
          testID={`agent-code-${member.user_id}`}
          value={agentCode}
          onChangeText={setAgentCode}
          onBlur={saveAgentCode}
          onSubmitEditing={saveAgentCode}
          placeholder="Es. AG-001-DP"
          placeholderTextColor="#94A3B8"
          style={{ flex: 1, backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: theme.color.onSurface }}
        />
        <Pressable onPress={saveAgentCode} disabled={savingCode} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: theme.color.brandPrimary, borderRadius: 8, alignItems: "center", justifyContent: "center" }}>
          {savingCode ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="save" size={14} color="#FFF" />}
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
        <Ionicons name="lock-closed" size={14} color={theme.color.muted} />
        <Text style={{ fontSize: 11, fontWeight: "800", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Password dati sensibili</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <TextInput
          testID={`sens-pwd-${member.user_id}`}
          value={sensValue}
          onChangeText={(t) => { setSensValue(t); setSensLoaded(true); }}
          onFocus={loadSensitive}
          secureTextEntry={!sensReveal}
          placeholder={sensLoading ? "Caricamento…" : "Non impostata"}
          placeholderTextColor="#94A3B8"
          style={{ flex: 1, backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: theme.color.onSurface }}
        />
        <Pressable onPress={toggleReveal} disabled={sensLoading} hitSlop={6} style={{ width: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#F1F5F9", borderRadius: 8 }}>
          {sensLoading ? <ActivityIndicator size="small" /> : <Ionicons name={sensReveal ? "eye-off" : "eye"} size={16} color={theme.color.muted} />}
        </Pressable>
        <Pressable onPress={saveSensitive} disabled={sensSaving || !sensLoaded} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: sensLoaded ? theme.color.brandPrimary : "#94A3B8", borderRadius: 8, alignItems: "center", justifyContent: "center" }}>
          {sensSaving ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="save" size={14} color="#FFF" />}
        </Pressable>
      </View>
      <Text style={{ fontSize: 10, color: theme.color.muted, fontStyle: "italic" }}>Cifrata a riposo (Fernet). Visibile solo a Master e diretto interessato.</Text>
    </View>
  );
}

export default function TeamScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", energy: true, network: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Member[] }>("/team");
      setItems(r.items);
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    setErr(null);
    if (!form.email || !form.name || !form.password) { setErr("Compila tutti i campi"); return; }
    const areas = [form.energy ? "energy" : null, form.network ? "network" : null].filter(Boolean);
    if (areas.length === 0) { setErr("Assegna almeno un'area"); return; }
    setBusy(true);
    try {
      await api("/team", { method: "POST", body: { email: form.email.trim(), name: form.name.trim(), password: form.password, areas } });
      setShowInvite(false);
      setForm({ email: "", name: "", password: "", energy: true, network: true });
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const toggleArea = async (m: Member, area: "energy" | "network") => {
    const has = m.areas.includes(area);
    const next = has ? m.areas.filter((a) => a !== area) : [...m.areas, area];
    if (next.length === 0) return;
    await api(`/team/${m.user_id}`, { method: "PUT", body: { areas: next } });
    load();
  };

  const remove = async (m: Member) => {
    const ok = await confirmAsync(
      "Eliminare il collaboratore?",
      `Vuoi rimuovere definitivamente "${m.name || m.email}"? Il collaboratore perderà l'accesso all'app e verrà scollegato dai contatti assegnati. L'operazione è irreversibile.`,
    );
    if (!ok) return;
    try {
      await api(`/team/${m.user_id}`, { method: "DELETE" });
      notify("Collaboratore rimosso", `${m.name || m.email} non ha più accesso.`);
      load();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile eliminare il collaboratore");
    }
  };

  const toggleAdmin = async (m: Member) => {
    const nextRole = m.role === "admin" ? "member" : "admin";
    try {
      await api(`/team/${m.user_id}/role`, { method: "PUT", body: { role: nextRole } });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Team</Text>
        <Pressable testID="invite-open-btn" onPress={() => setShowInvite(true)} style={styles.headerBtn}>
          <Ionicons name="person-add" size={20} color="#FFF" />
        </Pressable>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={40} color={theme.color.muted} />
              <Text style={styles.emptyTxt}>Nessun membro. Invita il tuo primo collaboratore.</Text>
            </View>
          ) : items.map((m) => (
            <View key={m.user_id} style={styles.card} testID={`member-${m.user_id}`}>
              <View style={styles.rowHead}>
                <View style={styles.avatar}><Text style={styles.avatarTxt}>{m.name[0]?.toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.name}>{m.name}</Text>
                    {m.role === "admin" && (
                      <View style={styles.adminBadge}>
                        <Ionicons name="star" size={10} color="#FFF" />
                        <Text style={styles.adminBadgeTxt}>Admin</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.email}>{m.email}</Text>
                </View>
                <Pressable
                  testID={`member-role-${m.user_id}`}
                  onPress={() => toggleAdmin(m)}
                  style={styles.roleBtn}
                >
                  <Ionicons name={m.role === "admin" ? "star" : "star-outline"} size={18} color={m.role === "admin" ? "#F59E0B" : theme.color.muted} />
                </Pressable>
                <Pressable testID={`member-del-${m.user_id}`} onPress={() => remove(m)}>
                  <Ionicons name="trash-outline" size={20} color={theme.color.error} />
                </Pressable>
              </View>
              <View style={styles.areasRow}>
                <Text style={styles.areasLbl}>Aree assegnate:</Text>
                <Pressable testID={`area-e-${m.user_id}`} onPress={() => toggleArea(m, "energy")} style={[styles.areaChip, m.areas.includes("energy") && { backgroundColor: theme.color.energy, borderColor: theme.color.energy }]}>
                  <Text style={[styles.areaTxt, m.areas.includes("energy") && { color: "#FFF" }]}>Energia</Text>
                </Pressable>
                <Pressable testID={`area-n-${m.user_id}`} onPress={() => toggleArea(m, "network")} style={[styles.areaChip, m.areas.includes("network") && { backgroundColor: theme.color.network, borderColor: theme.color.network }]}>
                  <Text style={[styles.areaTxt, m.areas.includes("network") && { color: "#FFF" }]}>Network</Text>
                </Pressable>
              </View>
              {/* V28.z — Master only fields: codice agente + password dati sensibili */}
              <MasterOnlyFields member={m} onUpdated={load} />
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={showInvite} animationType="slide" transparent onRequestClose={() => setShowInvite(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Invita membro</Text>
              <Pressable testID="invite-close" onPress={() => setShowInvite(false)}><Ionicons name="close" size={24} color={theme.color.onSurface} /></Pressable>
            </View>
            <Text style={styles.lbl}>Nome</Text>
            <TextInput testID="invite-name" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} style={styles.input} placeholder="Es. Anna Rossi" placeholderTextColor="#94A3B8" />
            <Text style={styles.lbl}>Email</Text>
            <TextInput testID="invite-email" value={form.email} onChangeText={(t) => setForm({ ...form, email: t })} style={styles.input} placeholder="anna@email.it" placeholderTextColor="#94A3B8" autoCapitalize="none" keyboardType="email-address" />
            <Text style={styles.lbl}>Password iniziale</Text>
            <TextInput testID="invite-password" value={form.password} onChangeText={(t) => setForm({ ...form, password: t })} style={styles.input} placeholder="Almeno 6 caratteri" placeholderTextColor="#94A3B8" secureTextEntry />
            <Text style={styles.lbl}>Aree assegnate</Text>
            <View style={styles.rowChips}>
              <Pressable testID="invite-area-e" onPress={() => setForm({ ...form, energy: !form.energy })} style={[styles.chip, form.energy && { backgroundColor: theme.color.energy, borderColor: theme.color.energy }]}>
                <Text style={[styles.chipTxt, form.energy && { color: "#FFF" }]}>Energia</Text>
              </Pressable>
              <Pressable testID="invite-area-n" onPress={() => setForm({ ...form, network: !form.network })} style={[styles.chip, form.network && { backgroundColor: theme.color.network, borderColor: theme.color.network }]}>
                <Text style={[styles.chipTxt, form.network && { color: "#FFF" }]}>Network</Text>
              </Pressable>
            </View>
            {err && <Text style={styles.err} testID="invite-err">{err}</Text>}
            <Pressable testID="invite-send" onPress={invite} disabled={busy} style={styles.sendBtn}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.sendBtnTxt}>Invita</Text>}
            </Pressable>
            <Text style={styles.hint}>Comunica manualmente al collaboratore email e password iniziale.</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  // V29.bc — Stile Optima
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.color.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.20,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  empty: { alignItems: "center", padding: 40, gap: 12 },
  emptyTxt: { color: theme.color.muted, textAlign: "center" },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border, gap: 12 },
  adminBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F59E0B", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  adminBadgeTxt: { color: "#FFF", fontWeight: "800", fontSize: 10 },
  roleBtn: { padding: 4 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 18 },
  name: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  email: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  areasRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  areasLbl: { fontSize: 12, color: theme.color.muted },
  areaChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border },
  areaTxt: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { backgroundColor: "#FFF", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 6 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, padding: 12, color: theme.color.onSurface },
  rowChips: { flexDirection: "row", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border },
  chipTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 13 },
  sendBtn: { backgroundColor: theme.color.brandPrimary, padding: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 16 },
  sendBtnTxt: { color: "#FFF", fontWeight: "700" },
  err: { color: theme.color.error, fontSize: 13, marginTop: 8 },
  hint: { fontSize: 11, color: theme.color.muted, textAlign: "center", marginTop: 10 },
});
