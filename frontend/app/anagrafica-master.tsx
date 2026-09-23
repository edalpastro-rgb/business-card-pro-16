// V50.z42 — Anagrafica Master & Password Vault
// Ogni utente vede SOLO i propri dati. Password cifrate lato server con Fernet.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert,
  ActivityIndicator, Modal, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { IdentityDocsSection } from "@/src/IdentityDocsSection"; // V50.z267
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type Cred = { cred_id: string; service: string; username?: string; url?: string; notes?: string; password_masked?: boolean };
type Profile = {
  first_name?: string; last_name?: string; phone?: string; address?: string;
  iban?: string; tax_id?: string; vat_id?: string; notes?: string;
  // V50.z212 — campi condivisi con il wizard Set Up and Go · Step 1 (stessa fonte: /master/profile)
  birth_date?: string; primary_email?: string; address_second?: string; address_relative?: string; emails?: string[];
  credentials?: Cred[];
};

export default function AnagraficaMasterScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [p, setP] = useState<Profile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  // form new credential
  const [nc, setNc] = useState<{ service: string; username: string; password: string; url: string; notes: string }>({
    service: "", username: "", password: "", url: "", notes: "",
  });

  const load = useCallback(async () => {
    try { const r = await api<Profile>("/master/profile"); setP(r); }
    catch (e: any) { Alert.alert("Errore", e?.message || ""); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api<Profile>("/master/profile", { method: "PUT", body: {
        first_name: p.first_name, last_name: p.last_name, phone: p.phone,
        address: p.address, iban: p.iban, tax_id: p.tax_id, vat_id: p.vat_id, notes: p.notes,
        birth_date: p.birth_date, primary_email: p.primary_email, address_second: p.address_second, address_relative: p.address_relative,
        emails: Array.from(new Set([...(p.emails || []), p.primary_email || ""].filter(Boolean))),
      }});
      setP(r);
      Alert.alert("✓", "Dati salvati");
    } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
    finally { setSaving(false); }
  };

  const addCred = async () => {
    if (!nc.service.trim() || !nc.password.trim()) {
      Alert.alert("Attenzione", "Servizio e password sono obbligatori"); return;
    }
    try {
      await api("/master/profile/credentials", { method: "POST", body: nc });
      setNc({ service: "", username: "", password: "", url: "", notes: "" });
      setAddOpen(false);
      load();
    } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
  };

  const reveal = async (c: Cred) => {
    if (revealed[c.cred_id]) { const n = { ...revealed }; delete n[c.cred_id]; setRevealed(n); return; }
    try {
      const r = await api<{ password: string }>(`/master/profile/credentials/${c.cred_id}/reveal`);
      setRevealed((prev) => ({ ...prev, [c.cred_id]: r.password }));
    } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
  };

  const copyPwd = async (c: Cred) => {
    try {
      const r = await api<{ password: string }>(`/master/profile/credentials/${c.cred_id}/reveal`);
      if (Platform.OS === "web") await (navigator as any).clipboard?.writeText(r.password);
      else { const Clipboard = await import("expo-clipboard"); await Clipboard.setStringAsync(r.password); }
      Alert.alert("✓", "Password copiata negli appunti");
    } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
  };

  const removeCred = (c: Cred) => {
    const doDel = async () => {
      try { await api(`/master/profile/credentials/${c.cred_id}`, { method: "DELETE" }); load(); }
      catch (e: any) { Alert.alert("Errore", e?.message || ""); }
    };
    if (Platform.OS === "web") { if (window.confirm(`Rimuovere ${c.service}?`)) doDel(); return; }
    Alert.alert("Rimuovi credenziale", `Rimuovere ${c.service}?`, [
      { text: "Annulla", style: "cancel" },
      { text: "Rimuovi", style: "destructive", onPress: doDel },
    ]);
  };

  if (loading) return <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.color.bg }}><ActivityIndicator size="large" color="#10B981" /></View>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Anagrafica Master</Text>
          <Text style={styles.sub}>Dati personali · Password vault cifrato</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: pagePad }}>
        {/* Dati anagrafici */}
        <View style={styles.card}>
          <Text style={styles.section}>Dati personali</Text>
          <Text style={{ fontSize: 11.5, color: HT.muted, marginBottom: 8 }}>🔄 Sincronizzati con il wizard «Set Up and Go» e con AxonOS: ogni modifica qui si riflette ovunque.</Text>
          {([
            ["first_name", "Nome"], ["last_name", "Cognome"], ["birth_date", "Data di nascita (AAAA-MM-GG)"], ["tax_id", "Codice Fiscale"],
            ["phone", "Telefono"], ["primary_email", "Mail per risposte e file"],
            ["address", "Indirizzo principale"], ["address_second", "Seconda abitazione"], ["address_relative", "Indirizzo di un parente"],
            ["iban", "IBAN"], ["vat_id", "P.IVA"], ["notes", "Note"],
          ] as [keyof Profile, string][]).map(([k, label]) => (
            <View key={k} style={{ marginBottom: 8 }}>
              <Text style={styles.label}>{label}</Text>
              <TextInput
                value={(p[k] as string) || ""}
                onChangeText={(t) => setP((prev) => ({ ...prev, [k]: t }))}
                style={[styles.input, k === "notes" && { minHeight: 60 }]}
                placeholder={label}
                placeholderTextColor={HT.muted}
                multiline={k === "notes"}
                autoCapitalize={k === "iban" || k === "tax_id" || k === "vat_id" ? "characters" : "sentences"}
              />
            </View>
          ))}
          <Pressable onPress={save} disabled={saving} style={styles.saveBtn}>
            {saving ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="save" size={16} color="#FFF" /><Text style={styles.saveTxt}>SALVA DATI</Text></>}
          </Pressable>
        </View>

        {/* V50.z267 — Documenti di riconoscimento (CI/patente/passaporto/CF): foto fronte-retro, OCR, scadenza, condivisione */}
        <View style={[styles.card, { marginTop: 14 }]}>
          <IdentityDocsSection subjectType="user" onExtracted={(d) => setP((prev) => ({
            ...prev, first_name: prev.first_name || d.first_name, last_name: prev.last_name || d.last_name, tax_id: prev.tax_id || d.tax_id,
            birth_date: prev.birth_date || d.birth_date, address: prev.address || [d.address, d.city].filter(Boolean).join(", "),
          }))} />
          <Text style={[styles.hint, { marginTop: 8, marginBottom: 0 }]}>Avvisi di scadenza automatici: email 3 mesi prima, popup in app 1 mese prima.</Text>
        </View>

        {/* Password vault */}
        <View style={[styles.card, { marginTop: 14 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
            <Text style={[styles.section, { flex: 1, marginBottom: 0 }]}>🔐 Password salvate ({p.credentials?.length || 0})</Text>
            <Pressable onPress={() => setAddOpen(true)} style={styles.addBtn}>
              <Ionicons name="add" size={16} color="#FFF" /><Text style={styles.addTxt}>NUOVA</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Le password sono cifrate lato server (Fernet). Solo tu puoi vederle.</Text>
          {(p.credentials || []).length === 0 ? (
            <Text style={styles.empty}>Nessuna password salvata</Text>
          ) : (p.credentials || []).map((c) => (
            <View key={c.cred_id} style={styles.credCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.credService}>{c.service}</Text>
                {c.username ? <Text style={styles.credUser}>👤 {c.username}</Text> : null}
                {c.url ? <Text style={styles.credUrl} numberOfLines={1}>🔗 {c.url}</Text> : null}
                <Text style={styles.credPwd}>
                  {revealed[c.cred_id] ? `🔓 ${revealed[c.cred_id]}` : "🔒 ••••••••"}
                </Text>
                {c.notes ? <Text style={styles.credNotes}>{c.notes}</Text> : null}
              </View>
              <View style={{ gap: 6 }}>
                <Pressable onPress={() => reveal(c)} style={styles.iconBtn}><Ionicons name={revealed[c.cred_id] ? "eye-off" : "eye"} size={18} color="#10B981" /></Pressable>
                <Pressable onPress={() => copyPwd(c)} style={styles.iconBtn}><Ionicons name="copy" size={18} color="#0EA5E9" /></Pressable>
                <Pressable onPress={() => removeCred(c)} style={styles.iconBtn}><Ionicons name="trash" size={18} color="#DC2626" /></Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Modal nuova credenziale */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.section}>Nuova credenziale</Text>
            {([["service", "Servizio (es. Aruba, Google, INPS)*"], ["username", "Username / email"], ["password", "Password*"], ["url", "URL sito (opzionale)"], ["notes", "Note (opzionale)"]] as [keyof typeof nc, string][]).map(([k, l]) => (
              <TextInput key={k} value={nc[k]} onChangeText={(t) => setNc((prev) => ({ ...prev, [k]: t }))} placeholder={l} placeholderTextColor={HT.muted} style={styles.input} secureTextEntry={k === "password"} autoCapitalize="none" />
            ))}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable onPress={() => setAddOpen(false)} style={[styles.saveBtn, { flex: 1, backgroundColor: '#94A3B8' }]}><Text style={styles.saveTxt}>ANNULLA</Text></Pressable>
              <Pressable onPress={addCred} style={[styles.saveBtn, { flex: 1 }]}><Text style={styles.saveTxt}>SALVA</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: HT.border },
  title: { fontSize: 18, fontWeight: "900", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  card: { backgroundColor: HT.card, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: HT.successTint },
  section: { fontSize: 14, fontWeight: "900", color: HT.success, marginBottom: 10 },
  label: { fontSize: 11, fontWeight: "700", color: HT.muted, marginBottom: 3 },
  input: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: HT.text, marginBottom: 8 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  saveTxt: { color: "#FFF", fontWeight: "900", fontSize: 13, letterSpacing: 0.5 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: '#10B981', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addTxt: { color: "#FFF", fontSize: 11, fontWeight: "900" },
  hint: { fontSize: 11, color: HT.muted, marginBottom: 10, fontStyle: "italic" },
  empty: { fontSize: 12, color: HT.muted, textAlign: "center", padding: 16 },
  credCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, backgroundColor: HT.successTint, borderWidth: 1, borderColor: HT.successTint, marginBottom: 8 },
  credService: { fontSize: 14, fontWeight: "800", color: HT.success },
  credUser: { fontSize: 12, color: HT.muted, marginTop: 2 },
  credUrl: { fontSize: 11, color: "#0EA5E9", marginTop: 2 },
  credPwd: { fontSize: 13, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: HT.success, marginTop: 4 },
  credNotes: { fontSize: 11, color: HT.muted, fontStyle: "italic", marginTop: 3 },
  iconBtn: { padding: 6, borderRadius: 6, backgroundColor: HT.card },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: HT.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 30 },
});
