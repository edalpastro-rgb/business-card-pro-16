import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";

export default function LoginScreen() {
  const router = useRouter();
  const { loginEmail, loginGoogle, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doAuth = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await loginEmail(email.trim(), password);
      } else {
        await register(email.trim(), password, name.trim() || email.split("@")[0]);
      }
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message || "Errore");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#0F2438", "#1C4869", "#3A739C"]} style={styles.hero}>
        <View style={styles.heroContent}>
          <Ionicons name="briefcase" size={44} color="#FFF" />
          <Text style={styles.title}>ProSync CRM</Text>
          <Text style={styles.subtitle}>Consulente Energetico · Networker</Text>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.formWrap}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.segment}>
            {(["login", "register"] as const).map((m) => (
              <Pressable
                key={m}
                testID={`auth-tab-${m}`}
                onPress={() => setMode(m)}
                style={[styles.segItem, mode === m && styles.segItemActive]}
              >
                <Text style={[styles.segText, mode === m && styles.segTextActive]}>
                  {m === "login" ? "Accedi" : "Registrati"}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === "register" && (
            <View style={styles.field}>
              <Text style={styles.label}>Nome</Text>
              <TextInput
                testID="auth-name-input"
                value={name}
                onChangeText={setName}
                placeholder="Il tuo nome"
                placeholderTextColor="#94A3B8"
                style={styles.input}
              />
            </View>
          )}
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="auth-email-input"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="tu@email.it"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="auth-password-input"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Almeno 6 caratteri"
              placeholderTextColor="#94A3B8"
              style={styles.input}
            />
          </View>

          {err && <Text style={styles.err} testID="auth-error">{err}</Text>}

          <Pressable testID="auth-submit-button" onPress={doAuth} style={styles.primaryBtn} disabled={busy}>
            {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>{mode === "login" ? "Accedi" : "Crea account"}</Text>}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>oppure</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable testID="auth-google-button" onPress={async () => {
            setErr(null); setBusy(true);
            try { await loginGoogle(); router.replace("/(tabs)/home"); }
            catch (e: any) { setErr(e.message || "Errore Google"); }
            finally { setBusy(false); }
          }} style={styles.googleBtn} disabled={busy}>
            <Ionicons name="logo-google" size={20} color={theme.color.brandPrimary} />
            <Text style={styles.googleBtnText}>Accedi con Google</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  hero: { paddingTop: 72, paddingBottom: 40, alignItems: "center", justifyContent: "center" },
  heroContent: { alignItems: "center" },
  title: { color: "#FFF", fontSize: 30, fontWeight: "700", marginTop: 10, letterSpacing: 0.3 },
  subtitle: { color: "#CFE1EE", marginTop: 4, fontSize: 13 },
  formWrap: { flex: 1 },
  form: { padding: 20, gap: 14 },
  segment: { flexDirection: "row", backgroundColor: theme.color.surfaceTertiary, borderRadius: theme.radius.pill, padding: 4, marginBottom: 6 },
  segItem: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: theme.radius.pill },
  segItemActive: { backgroundColor: "#FFF", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segText: { color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  segTextActive: { color: theme.color.brandPrimary },
  field: { gap: 6 },
  label: { color: theme.color.onSurfaceTertiary, fontSize: 13, fontWeight: "600" },
  input: { backgroundColor: "#FFF", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: theme.color.onSurface },
  primaryBtn: { backgroundColor: theme.color.brandPrimary, borderRadius: theme.radius.md, paddingVertical: 14, alignItems: "center", marginTop: 6 },
  primaryBtnText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.color.border },
  dividerText: { color: theme.color.muted, fontSize: 12 },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#FFF", borderRadius: theme.radius.md, paddingVertical: 12, borderWidth: 1, borderColor: theme.color.border },
  googleBtnText: { color: theme.color.brandPrimary, fontWeight: "700" },
  err: { color: theme.color.error, fontSize: 13 },
});
