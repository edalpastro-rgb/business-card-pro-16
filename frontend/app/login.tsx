import { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, useWindowDimensions, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PENDING_REFERRAL_KEY } from "@/src/PromoCodeField"; // V50.z322 — link «Invita un amico» ?ref=CODE
import { QuickUnlockCard, maybeOfferQuickUnlock } from "@/src/quickUnlock/QuickUnlockCard"; // V50.z187 — accesso rapido (isolato)
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

// V29.j — Logo AdvisorOS trasparente (senza card bianca): asset locale con
// alpha channel, aspect ratio 4.6:1 (compass + testo).
const ADVISOROS_LOGO_TRANSPARENT = require("@/assets/images/advisoros-logo-transparent.png");
const ADVISOROS_LOGO_ASPECT = 1656 / 358;

export default function LoginScreen() {
  const router = useRouter();
  const { loginEmail, loginGoogle, register, verify2FA } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  // V50.z322 — arrivo da link amico (/login?ref=AMICO-…): memorizzo il codice (precompilato nell'onboarding) e apro la registrazione
  const { ref: refParam } = useLocalSearchParams<{ ref?: string }>();
  useEffect(() => {
    const code = typeof refParam === "string" ? refParam.trim().toUpperCase() : "";
    if (!code) return;
    AsyncStorage.setItem(PENDING_REFERRAL_KEY, code).catch(() => {});
    setMode("register");
  }, [refParam]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // V29.j — Logo AdvisorOS reso direttamente sullo sfondo blu, senza card bianca.
  const { width } = useWindowDimensions();
  const isWide = width >= 700;
  // Larghezza logo (aspect ratio orizzontale ~4.6:1). Cap ragionevoli.
  const logoWidth = isWide ? 340 : Math.min(300, Math.round(width * 0.78));
  const logoHeight = Math.round(logoWidth / ADVISOROS_LOGO_ASPECT);

  // 2FA state
  const [twoFAToken, setTwoFAToken] = useState<string | null>(null);
  const [twoFACode, setTwoFACode] = useState("");
  const [quickHidden, setQuickHidden] = useState(false); // V50.z187

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
      setTimeout(() => { void maybeOfferQuickUnlock(); }, 1500); // V50.z187
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
      setTimeout(() => { void maybeOfferQuickUnlock(); }, 1500); // V50.z187
    } catch (e: any) {
      setErr(e.message || "Codice non valido");
    } finally {
      setBusy(false);
    }
  };

  if (twoFAToken) {
    return (
      <View style={styles.root}>
        <LinearGradient colors={[HT.text, "#1C4869", "#3A739C"]} style={styles.hero}>
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
                placeholderTextColor={HT.muted}
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
      <LinearGradient colors={[HT.text, "#1C4869", "#3A739C"]} style={StyleSheet.absoluteFillObject as any} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.pageWrap}>
        <ScrollView
          contentContainerStyle={[styles.pageScroll, isWide && styles.pageScrollCentered]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.container, isWide && styles.containerWide]}>
            <View style={styles.hero}>
              <Image
                testID="login-logo"
                source={ADVISOROS_LOGO_TRANSPARENT}
                style={{ width: logoWidth, height: logoHeight }}
                resizeMode="contain"
              />
            </View>

            {/* V50.z187 — accesso rapido con impronta / Face ID / PIN (solo dispositivo registrato) */}
            {!quickHidden && !twoFAToken && (
              <QuickUnlockCard onUseOtherAccount={() => setQuickHidden(true)} onSuccess={() => router.replace("/(tabs)/home")} />
            )}
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
                placeholderTextColor={HT.muted}
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
              placeholderTextColor={HT.muted}
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
              placeholderTextColor={HT.muted}
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
            <Ionicons name="logo-google" size={20} color={HT.brand} />
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
  root: { flex: 1, backgroundColor: '#0F2438' },
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
    paddingBottom: 24,
  },
  // V50.z327 — schermata 2FA: prima questi stili non esistevano (testo nero su gradiente blu)
  heroContent: { alignItems: "center", gap: 8, paddingHorizontal: 24 },
  title: { color: "#FFFFFF", fontSize: 22, fontWeight: "800", textAlign: "center" },
  subtitle: { color: "rgba(255,255,255,0.85)", fontSize: 14, textAlign: "center" },
  formCard: {
    backgroundColor: HT.card2,
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
  segment: { flexDirection: "row", backgroundColor: HT.card2, borderRadius: theme.radius.pill, padding: 4, marginBottom: 6 },
  segItem: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: theme.radius.pill },
  segItemActive: { backgroundColor: HT.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  segText: { color: HT.text2, fontWeight: "600" },
  segTextActive: { color: HT.brand },
  field: { gap: 6 },
  label: { color: HT.text2, fontSize: 13, fontWeight: "600" },
  input: { backgroundColor: HT.card, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: HT.text },
  primaryBtn: { backgroundColor: HT.brand, borderRadius: theme.radius.md, paddingVertical: 14, alignItems: "center", marginTop: 6 },
  primaryBtnText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: HT.border },
  dividerText: { color: HT.muted, fontSize: 12 },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: HT.card, borderRadius: theme.radius.md, paddingVertical: 12, borderWidth: 1, borderColor: HT.border },
  googleBtnText: { color: HT.brand, fontWeight: "700" },
  err: { color: HT.danger, fontSize: 13 },
  linkBtn: { alignItems: "center", paddingVertical: 12 },
  linkBtnTxt: { color: HT.brand, fontWeight: "600", fontSize: 13 },
});
