import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { AdvisorOSLogo } from "@/src/BrandLogos";

export default function LoginScreen() {
  const router = useRouter();
  const { loginEmail, loginGoogle, register, verify2FA } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // V29.h — Layout responsive (tablet/desktop) e logo più grande
  const { width } = useWindowDimensions();
  const isWide = width >= 700;
  const logoSize = isWide ? 180 : Math.min(160, Math.round(width * 0.42));

  // 2FA state
  const [twoFAToken, setTwoFAToken] = useState<string | null>(null);
  const [twoFACode, setTwoFACode] = useState("");

  const doAuth = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const r = await loginEmail(email.trim(), password);
        if (r.requires_2fa) {
          setTwoFAToken(r.temp_token);
          setBusy(false);
          return;
        }
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

  const doVerify2FA = async () => {
    if (!twoFAToken) return;
    setErr(null);
    setBusy(true);
    try {
      await verify2FA(twoFAToken, twoFACode.trim());
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e.message || "Codice non valido");
    } finally {
      setBusy(false);
    }
  };

  if (twoFAToken) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={["#0F2438", "#1C4869", "#3A739C"]} style={styles.hero}>
          <View style={styles.heroContent}>
            <Ionicons name="shield-checkmark" size={44} color="#FFF" />
            <Text style={styles.title}>Verifica in 2 passaggi</Text>
            <Text style={styles.subtitle}>Inserisci il codice della tua app Authenticator</Text>
          </View>
        </LinearGradient>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.formWrap}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <View style={styles.field}>
              <Text style={styles.label}>Codice a 6 cifre (o codice di recupero)</Text>
              <TextInput
                testID="2fa-code-input"
                value={twoFACode}
                onChangeText={setTwoFACode}
                autoCapitalize="characters"
                keyboardType="default"
                placeholder="123456 o XXXXX-XXXXX"
                placeholderTextColor="#94A3B8"
                style={[styles.input, { textAlign: "center", fontSize: 20, letterSpacing: 3 }]}
                maxLength={20}
                autoFocus
              />
            </View>
            {err && <Text style={styles.err} testID="auth-error">{err}</Text>}
            <Pressable testID="2fa-verify-btn" onPress={doVerify2FA} style={styles.primaryBtn} disabled={busy || !twoFACode.trim()}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Verifica</Text>}
            </Pressable>
            <Pressable onPress={() => { setTwoFAToken(null); setTwoFACode(""); setErr(null); }} style={styles.linkBtn}>
              <Text style={styles.linkBtnTxt}>Annulla e torna all&apos;accesso</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#0F2438", "#1C4869", "#3A739C"]} style={StyleSheet.absoluteFillObject as any} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.pageWrap}>
        <ScrollView
          contentContainerStyle={[styles.pageScroll, isWide && styles.pageScrollCentered]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.container, isWide && styles.containerWide]}>
            <View style={styles.hero}>
              <AdvisorOSLogo size={logoSize} testID="login-logo" style={styles.heroLogo as any} />
            </View>

            <View style={styles.formCard}>
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
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2438" },
  pageWrap: { flex: 1 },
  pageScroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  pageScrollCentered: {
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    width: "100%",
    alignSelf: "stretch",
  },
  containerWide: {
    maxWidth: 480,
    alignSelf: "center",
  },
  hero: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 24,
    paddingBottom: 20,
  },
  heroLogo: {
    // Ombra intorno alla card bianca per staccarla dal gradient
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  formCard: {
    backgroundColor: theme.color.surface,
    borderRadius: 20,
    padding: 20,
    gap: 14,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
      android: { elevation: 10 },
      default: { boxShadow: "0 12px 32px rgba(0,0,0,0.25)" as any },
    }),
  },
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
  linkBtn: { alignItems: "center", paddingVertical: 12 },
  linkBtnTxt: { color: theme.color.brandPrimary, fontWeight: "600", fontSize: 13 },
});
