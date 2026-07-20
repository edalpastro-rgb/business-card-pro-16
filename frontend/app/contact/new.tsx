import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";

export default function NewContactScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const allowed = (user?.areas || ["energy", "network"]) as ("energy" | "network")[];
  const [form, setForm] = useState({
    first_name: "", last_name: "", phone: "", email: "", address: "",
    area: (allowed[0] || "energy") as "energy" | "network",
    source: "personal" as "personal" | "referral",
    referral_note: "", email_note: "", general_note: "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.first_name.trim()) return;
    setBusy(true);
    try {
      const c = await api<{ contact_id: string }>("/contacts", { method: "POST", body: form });
      router.replace(`/contact/${c.contact_id}`);
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.title}>Nuovo contatto</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Field label="Nome *" testID="c-first-name" value={form.first_name} onChangeText={(t) => setForm({ ...form, first_name: t })} />
          <Field label="Cognome" testID="c-last-name" value={form.last_name} onChangeText={(t) => setForm({ ...form, last_name: t })} />
          <Field label="Telefono" testID="c-phone" value={form.phone} onChangeText={(t) => setForm({ ...form, phone: t })} keyboardType="phone-pad" />
          <Field label="Email" testID="c-email" value={form.email} onChangeText={(t) => setForm({ ...form, email: t })} keyboardType="email-address" />
          <Field label="Indirizzo" testID="c-address" value={form.address} onChangeText={(t) => setForm({ ...form, address: t })} />

          <Text style={styles.lbl}>Area</Text>
          <View style={styles.pillsRow}>
            {(["energy", "network"] as const).filter((a) => allowed.includes(a)).map((a) => (
              <Pressable key={a} testID={`c-area-${a}`} onPress={() => setForm({ ...form, area: a })} style={[styles.pill, form.area === a && { backgroundColor: a === "energy" ? theme.color.energy : theme.color.network, borderColor: a === "energy" ? theme.color.energy : theme.color.network }]}>
                <Text style={[styles.pillTxt, form.area === a && styles.pillTxtActive]}>{a === "energy" ? "Energia" : "Network"}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.lbl}>Origine</Text>
          <View style={styles.pillsRow}>
            {(["personal", "referral"] as const).map((a) => (
              <Pressable key={a} testID={`c-source-${a}`} onPress={() => setForm({ ...form, source: a })} style={[styles.pill, form.source === a && styles.pillActive]}>
                <Text style={[styles.pillTxt, form.source === a && styles.pillTxtActive]}>{a === "personal" ? "Conoscenza personale" : "Referenza"}</Text>
              </Pressable>
            ))}
          </View>

          {form.source === "referral" && (
            <Field label="Nota alla referenza" testID="c-referral-note" value={form.referral_note} onChangeText={(t) => setForm({ ...form, referral_note: t })} multiline />
          )}

          <Field label="Nota email condivisibile" testID="c-email-note" value={form.email_note} onChangeText={(t) => setForm({ ...form, email_note: t })} multiline />
          <Field label="Note generali" testID="c-general-note" value={form.general_note} onChangeText={(t) => setForm({ ...form, general_note: t })} multiline />

          <Pressable testID="c-save-btn" onPress={submit} style={styles.saveBtn} disabled={busy}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnTxt}>Salva contatto</Text>}
          </Pressable>
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, multiline, ...rest }: any) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.lbl}>{label}</Text>
      <TextInput
        {...rest}
        style={[styles.input, multiline && { minHeight: 80, textAlignVertical: "top" }]}
        placeholderTextColor="#94A3B8"
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  content: { padding: 16 },
  lbl: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceTertiary, marginBottom: 6 },
  input: { backgroundColor: "#FFF", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.color.onSurface },
  pillsRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border },
  pillActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  pillTxt: { color: theme.color.onSurfaceTertiary, fontWeight: "600", fontSize: 13 },
  pillTxtActive: { color: "#FFF" },
  saveBtn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 20 },
  saveBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});
