import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, setToken } from "@/src/api";
import { theme } from "@/src/theme";

type InviteInfo = { trial_days: number; note: string };

export default function InvitePublicScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<InviteInfo>(`/invites/${token}/info`);
        setInfo(r);
      } catch (e: any) {
        setLoadErr(e?.message || "Invito non valido o già utilizzato");
      }
    })();
  }, [token]);

  const submit = async () => {
    if (!name.trim() || !email.trim() || password.length < 6) {
      Alert.alert("Dati mancanti", "Nome, email e password (min 6) sono obbligatori.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ token: string; user: any }>(`/invites/${token}/register`, {
        method: "POST",
        body: { name: name.trim(), email: email.trim().toLowerCase(), password },
      });
      await setToken(r.token);
      Alert.alert("Benvenuto!", `Il tuo trial di ${info?.trial_days} giorni è attivo.`, [
        { text: "Inizia", onPress: () => router.replace("/(tabs)/home") },
      ]);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Registrazione fallita");
    } finally { setBusy(false); }
  };

  if (loadErr) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.errBox}>
          <Ionicons name="alert-circle" size={40} color={theme.color.error} />
          <Text style={styles.errTitle}>Invito non disponibile</Text>
          <Text style={styles.errMsg}>{loadErr}</Text>
          <Pressable onPress={() => router.replace("/login")} style={styles.link}>
            <Text style={styles.linkTxt}>Vai al login →</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
  if (!info) return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 60 }} color={theme.color.brandPrimary} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 22 }}>
          <View style={styles.brand}>
            <Ionicons name="business" size={44} color={theme.color.brandPrimary} />
            <Text style={styles.brandTitle}>Sei stato invitato!</Text>
            <Text style={styles.brandSub}>Registra il tuo account per iniziare — il primo mese è gratis.</Text>
          </View>

          <View style={styles.trialBanner}>
            <Ionicons name="time" size={16} color={theme.color.success} />
            <Text style={styles.trialTxt}>Trial gratuito di <Text style={{ fontWeight: "800" }}>{info.trial_days} giorni</Text> incluso</Text>
          </View>
          {info.note ? <Text style={styles.note}>&quot;{info.note}&quot;</Text> : null}

          <View style={styles.form}>
            <Text style={styles.lbl}>Nome e Cognome</Text>
            <TextInput testID="reg-name" value={name} onChangeText={setName} placeholder="Mario Rossi" placeholderTextColor="#94A3B8" style={styles.input} />
            <Text style={styles.lbl}>Email</Text>
            <TextInput testID="reg-email" value={email} onChangeText={setEmail} placeholder="tu@email.it" placeholderTextColor="#94A3B8" style={styles.input} autoCapitalize="none" keyboardType="email-address" />
            <Text style={styles.lbl}>Password</Text>
            <TextInput testID="reg-password" value={password} onChangeText={setPassword} placeholder="Almeno 6 caratteri" placeholderTextColor="#94A3B8" style={styles.input} secureTextEntry />
            <Pressable testID="reg-submit" onPress={submit} disabled={busy} style={styles.btn}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnTxt}>Registrati e accedi</Text>}
            </Pressable>
          </View>

          <Text style={styles.legal}>Registrandoti accetti i Termini di Servizio e l&apos;Informativa Privacy. I dati che inserirai saranno tuoi e non condivisi.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  brand: { alignItems: "center", gap: 6, marginBottom: 24 },
  brandTitle: { fontSize: 24, fontWeight: "800", color: theme.color.onSurface },
  brandSub: { fontSize: 13, color: theme.color.muted, textAlign: "center" },
  trialBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: theme.radius.md, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: theme.color.success, justifyContent: "center", marginBottom: 8 },
  trialTxt: { color: theme.color.success, fontSize: 14 },
  note: { textAlign: "center", color: theme.color.muted, fontStyle: "italic", fontSize: 12, marginBottom: 12 },
  form: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 16, borderWidth: 1, borderColor: theme.color.border, marginTop: 12 },
  lbl: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface },
  btn: { backgroundColor: theme.color.brandPrimary, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center", marginTop: 18 },
  btnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  errBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 10 },
  errTitle: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  errMsg: { color: theme.color.muted, textAlign: "center" },
  link: { marginTop: 12 },
  linkTxt: { color: theme.color.brandPrimary, fontWeight: "700" },
  legal: { fontSize: 10, color: theme.color.muted, textAlign: "center", marginTop: 14, lineHeight: 14 },
});
