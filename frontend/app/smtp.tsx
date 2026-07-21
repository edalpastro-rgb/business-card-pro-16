import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type SmtpOut = { host: string; port: number; username: string; sender_name: string; sender_email: string; use_ssl: boolean; configured: boolean };

const PRESETS: { label: string; host: string; port: number; use_ssl: boolean }[] = [
  { label: "Aruba (smtps.aruba.it)", host: "smtps.aruba.it", port: 465, use_ssl: true },
  { label: "Gmail (smtp.gmail.com)", host: "smtp.gmail.com", port: 465, use_ssl: true },
  { label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, use_ssl: false },
  { label: "Custom", host: "", port: 465, use_ssl: true },
];

export default function SmtpConfigScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [configured, setConfigured] = useState(false);
  const [form, setForm] = useState({
    host: "", port: 465,
    username: "", password: "",
    sender_name: "", sender_email: "",
    use_ssl: true,
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await api<SmtpOut>("/smtp/config");
        setForm({
          host: r.host || "", port: r.port || 465,
          username: r.username || "", password: "",
          sender_name: r.sender_name || "", sender_email: r.sender_email || "",
          use_ssl: r.use_ssl,
        });
        setConfigured(r.configured);
      } finally { setLoading(false); }
    })();
  }, []);

  const applyPreset = (p: (typeof PRESETS)[0]) => {
    setForm((f) => ({ ...f, host: p.host, port: p.port, use_ssl: p.use_ssl }));
  };

  const save = async () => {
    if (!form.host || !form.username) {
      Alert.alert("Manca host o utente");
      return;
    }
    setSaving(true);
    try {
      const r = await api<SmtpOut>("/smtp/config", { method: "PUT", body: form });
      setConfigured(r.configured);
      setForm((f) => ({ ...f, password: "" }));
      Alert.alert("Salvato", "Configurazione SMTP salvata correttamente.");
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile salvare");
    } finally { setSaving(false); }
  };

  const runTest = async () => {
    if (!testEmail.trim()) return;
    setTesting(true);
    try {
      await api("/smtp/test", { method: "POST", body: { to_email: testEmail } });
      Alert.alert("Successo", "Email di test inviata. Controlla la casella.");
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Test fallito");
    } finally { setTesting(false); }
  };

  if (loading) return (
    <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} /></SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>SMTP Email</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color={theme.color.info} />
            <Text style={styles.infoTxt}>
              Configura le credenziali del tuo server email per inviare comunicazioni bulk ai gruppi contatti. Le password sono memorizzate solo sul tuo tenant.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Preset veloci</Text>
            <View style={styles.chipsRow}>
              {PRESETS.map((p) => (
                <Pressable key={p.label} testID={`smtp-preset-${p.host || "custom"}`} onPress={() => applyPreset(p)} style={styles.chip}>
                  <Text style={styles.chipTxt}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Server</Text>
            <Text style={styles.lbl}>Host SMTP *</Text>
            <TextInput testID="smtp-host" value={form.host} onChangeText={(t) => setForm({ ...form, host: t })} placeholder="smtps.aruba.it" placeholderTextColor="#94A3B8" style={styles.input} autoCapitalize="none" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>Porta *</Text>
                <TextInput testID="smtp-port" value={String(form.port)} onChangeText={(t) => setForm({ ...form, port: Number(t) || 0 })} keyboardType="number-pad" style={styles.input} />
              </View>
              <View style={{ flex: 1, justifyContent: "flex-end" }}>
                <Pressable testID="smtp-ssl-toggle" onPress={() => setForm({ ...form, use_ssl: !form.use_ssl })} style={styles.switchRow}>
                  <Text style={styles.switchLbl}>SSL / TLS</Text>
                  <Ionicons name={form.use_ssl ? "toggle" : "toggle-outline"} size={40} color={form.use_ssl ? theme.color.success : theme.color.muted} />
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Credenziali</Text>
            <Text style={styles.lbl}>Utente / Email login *</Text>
            <TextInput testID="smtp-user" value={form.username} onChangeText={(t) => setForm({ ...form, username: t })} placeholder="tu@tuodominio.it" placeholderTextColor="#94A3B8" style={styles.input} autoCapitalize="none" keyboardType="email-address" />
            <Text style={styles.lbl}>Password {configured ? "(compila solo per cambiare)" : "*"}</Text>
            <TextInput testID="smtp-pass" value={form.password} onChangeText={(t) => setForm({ ...form, password: t })} placeholder={configured ? "•••••••• (già configurata)" : "Password casella"} placeholderTextColor="#94A3B8" style={styles.input} secureTextEntry autoCapitalize="none" />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Mittente</Text>
            <Text style={styles.lbl}>Nome mittente</Text>
            <TextInput testID="smtp-sname" value={form.sender_name} onChangeText={(t) => setForm({ ...form, sender_name: t })} placeholder="Es. Dal Pastro CRM" placeholderTextColor="#94A3B8" style={styles.input} />
            <Text style={styles.lbl}>Email mittente (opzionale, default = utente)</Text>
            <TextInput testID="smtp-sender" value={form.sender_email} onChangeText={(t) => setForm({ ...form, sender_email: t })} placeholder="info@tuodominio.it" placeholderTextColor="#94A3B8" style={styles.input} autoCapitalize="none" keyboardType="email-address" />
          </View>

          <Pressable testID="smtp-save" onPress={save} disabled={saving} style={styles.saveBtn}>
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Salva configurazione</Text>}
          </Pressable>

          {configured && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Test invio</Text>
              <Text style={styles.lbl}>Email destinatario di test</Text>
              <TextInput testID="smtp-test-email" value={testEmail} onChangeText={setTestEmail} placeholder="tuo@indirizzo.it" placeholderTextColor="#94A3B8" style={styles.input} autoCapitalize="none" keyboardType="email-address" />
              <Pressable testID="smtp-test-btn" onPress={runTest} disabled={testing || !testEmail.trim()} style={[styles.saveBtn, { backgroundColor: theme.color.info, marginTop: 12, opacity: testEmail.trim() ? 1 : 0.5 }]}>
                {testing ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Invia test</Text>}
              </Pressable>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.color.border },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: theme.color.brandPrimary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  lbl: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center" },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 4 },
  switchLbl: { fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandTertiary },
  chipTxt: { color: theme.color.brandPrimary, fontWeight: "600", fontSize: 12 },
  infoBox: { flexDirection: "row", gap: 10, backgroundColor: "#DBEAFE", padding: 12, borderRadius: theme.radius.md },
  infoTxt: { flex: 1, fontSize: 12, color: theme.color.info, lineHeight: 18 },
});
