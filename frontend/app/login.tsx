import { useState, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Platform, ScrollView, ActivityIndicator, useWindowDimensions, Image, Linking } from "react-native";
import { PasswordInput } from "@/src/PasswordInput"; // V50.z433 — occhio mostra/nascondi password
import { KeyboardAvoidingView } from "react-native-keyboard-controller"; // V50.z374 — behavior "padding" valido su iOS e Android
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PENDING_REFERRAL_KEY } from "@/src/PromoCodeField"; // V50.z322 — link «Invita un amico» ?ref=CODE
import { PENDING_PLAN_KEY } from "@/src/landing/landingSeen"; // V50.z530 — piano Founder scelto dalla landing
import { QuickUnlockCard, maybeOfferQuickUnlock } from "@/src/quickUnlock/QuickUnlockCard"; // V50.z187 — accesso rapido (isolato)
import { useAuth } from "@/src/auth";
import { notify } from "@/src/utils/notify"; // V50.z433
import { api } from "@/src/api";
import { solvePow } from "@/src/utils/pow"; // V50.z434 — proof-of-work anti-bot
import { TurnstileWidget } from "@/src/TurnstileWidget"; // V50.z434 — Cloudflare Turnstile (se configurato dal Master)
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

// V29.j — Logo AdvisorOS trasparente (senza card bianca): asset locale con
// alpha channel, aspect ratio 4.6:1 (compass + testo).
const ADVISOROS_LOGO_TRANSPARENT = require("@/assets/images/advisoros-logo-transparent.png");
const ADVISOROS_LOGO_ASPECT = 1656 / 358;

export default function LoginScreen() {
  const router = useRouter();
  const { loginEmail, loginGoogle, register, verify2FA, verifyEmail, resendEmailCode, pendingEmailVerification } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  // V50.z322 — arrivo da link amico (/login?ref=AMICO-…): memorizzo il codice (precompilato nell'onboarding) e apro la registrazione
  // V50.z530 — arrivo dalla landing Founder (/login?plan=builder|professional&mode=register): piano salvato sull'account (contatori posti)
  const { ref: refParam, plan: planParam, mode: modeParam } = useLocalSearchParams<{ ref?: string; plan?: string; mode?: string }>();
  const [founderPlan, setFounderPlan] = useState<"builder" | "professional" | undefined>(undefined);
  useEffect(() => {
    const p = typeof planParam === "string" ? planParam.trim().toLowerCase() : "";
    if (p === "builder" || p === "professional") { setFounderPlan(p); AsyncStorage.setItem(PENDING_PLAN_KEY, p).catch(() => {}); }
    else AsyncStorage.getItem(PENDING_PLAN_KEY).then((v) => { if (v === "builder" || v === "professional") setFounderPlan(v); }).catch(() => {});
    if (modeParam === "register") setMode("register");
  }, [planParam, modeParam]);
  useEffect(() => {
    const code = typeof refParam === "string" ? refParam.trim().toUpperCase() : "";
    if (!code) return;
    AsyncStorage.setItem(PENDING_REFERRAL_KEY, code).catch(() => {});
    setPromoCode(code); // V50.z433 — precompila il campo «Codice promozionale»
    setMode("register");
  }, [refParam]);
  // V50.z433 — codice amico/promo salvato in precedenza (link landing) → precompilato nel modulo
  useEffect(() => {
    AsyncStorage.getItem(PENDING_REFERRAL_KEY).then((c) => { if (c) setPromoCode((cur) => cur || c); }).catch(() => {});
  }, []);
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState(""); // V50.z433
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState(""); // V50.z433
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState(""); // V50.z433
  const [promoCode, setPromoCode] = useState(""); // V50.z433
  // V50.z434 — «Fort Knox»: challenge anti-bot (PoW + tempo minimo + Turnstile opzionale), honeypot, consensi
  type Challenge = { challenge_id: string; prefix: string; difficulty: number; min_fill_ms: number; turnstile_site_key: string; privacy_url: string };
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [hp, setHp] = useState(""); // honeypot: campo invisibile, i bot lo compilano
  const [privacyOk, setPrivacyOk] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [securing, setSecuring] = useState(false);
  const loadChallenge = async () => {
    try { setChallenge(await api<Challenge>("/auth/register/challenge")); setTurnstileToken(null); } catch { setChallenge(null); }
  };
  useEffect(() => { if (mode === "register") void loadChallenge(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // V50.z465 — informativa privacy: schermata interna /privacy-policy (il link esterno advisoros.it/privacy non esiste)
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
  // V50.z433 — verifica email (codice a 6 cifre) dopo la registrazione / al login di un account non attivato
  const [verifyEmailAddr, setVerifyEmailAddr] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyInfo, setVerifyInfo] = useState<string | null>(null);
  useEffect(() => { if (pendingEmailVerification) setVerifyEmailAddr(pendingEmailVerification); }, [pendingEmailVerification]);
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
        if ("requires_email_verification" in r && r.requires_email_verification) { // V50.z433
          setVerifyEmailAddr(r.email);
          setBusy(false);
          return;
        }
      } else {
        // V50.z433 — validazioni modulo di registrazione
        if (!name.trim()) throw new Error("Inserisci il nome");
        if (!lastName.trim()) throw new Error("Inserisci il cognome");
        if (email.trim().toLowerCase() !== emailConfirm.trim().toLowerCase()) throw new Error("Le due email non coincidono");
        if (password.length < 6) throw new Error("La password deve avere almeno 6 caratteri");
        if (password !== passwordConfirm) throw new Error("Le due password non coincidono");
        if (!privacyOk) throw new Error("Devi accettare l'informativa privacy");
        if (challenge?.turnstile_site_key && !turnstileToken) throw new Error("Completa la verifica anti-bot");
        let ch = challenge;
        if (!ch) { ch = await api<Challenge>("/auth/register/challenge"); setChallenge(ch); }
        setSecuring(true);
        const powNonce = await solvePow(ch.prefix, ch.difficulty);
        setSecuring(false);
        let result;
        try {
          result = await register(email.trim(), password, name.trim(), {
            lastName: lastName.trim(), promoCode: promoCode.trim().toUpperCase() || undefined,
            privacyAccepted: privacyOk, newsletter, challengeId: ch.challenge_id, powNonce, turnstileToken, hp, plan: founderPlan,
          });
        } catch (e) {
          void loadChallenge(); // la challenge è monouso: nuova challenge per il prossimo tentativo
          throw e;
        }
        const { promo, requiresEmailVerification } = result;
        AsyncStorage.removeItem(PENDING_PLAN_KEY).catch(() => {}); // V50.z530
        if (promo) {
          if (promo.ok) AsyncStorage.removeItem(PENDING_REFERRAL_KEY).catch(() => {});
          setTimeout(() => notify(promo.ok ? "Codice promozionale applicato" : "Codice promozionale non applicato", promo.message), 600);
        }
        if (requiresEmailVerification) {
          setVerifyEmailAddr(email.trim().toLowerCase());
          setBusy(false);
          return;
        }
      }
      router.replace("/(tabs)/home");
      setTimeout(() => { void maybeOfferQuickUnlock(); }, 1500); // V50.z187
    } catch (e: any) {
      setErr(e.message || "Errore");
    } finally {
      setSecuring(false);
      setBusy(false);
    }
  };

  const doVerifyEmail = async () => {
    setErr(null);
    setBusy(true);
    try {
      await verifyEmail(verifyCode.trim());
      setVerifyEmailAddr(null);
      router.replace("/(tabs)/home");
      setTimeout(() => { void maybeOfferQuickUnlock(); }, 1500);
    } catch (e: any) {
      setErr(e.message || "Codice non valido");
    } finally {
      setBusy(false);
    }
  };

  const doResendEmail = async () => {
    setErr(null); setVerifyInfo(null);
    try { setVerifyInfo(await resendEmailCode()); } catch (e: any) { setErr(e.message || "Impossibile inviare il codice"); }
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

  if (verifyEmailAddr) {
    // V50.z433 — Attivazione account: codice di conferma a 6 cifre ricevuto via email
    return (
      <View style={styles.root}>
        <LinearGradient colors={[HT.text, "#1C4869", "#3A739C"]} style={styles.hero}>
          <View style={styles.heroContent}>
            <Ionicons name="mail-open-outline" size={44} color="#FFF" />
            <Text style={styles.title}>Conferma la tua email</Text>
            <Text style={styles.subtitle}>Abbiamo inviato un codice a 6 cifre a {verifyEmailAddr}. Inseriscilo per attivare l&apos;account.</Text>
          </View>
        </LinearGradient>
        <KeyboardAvoidingView behavior="padding" style={styles.formWrap}>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <View style={styles.field}>
              <Text style={styles.label}>Codice di conferma</Text>
              <TextInput
                testID="verify-email-code-input"
                value={verifyCode}
                onChangeText={(t) => setVerifyCode(t.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                placeholder="123456"
                placeholderTextColor={HT.muted}
                style={[styles.input, { textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: "700" }]}
                maxLength={6}
                autoFocus
              />
            </View>
            {verifyInfo && <Text style={styles.info} testID="verify-email-info">{verifyInfo}</Text>}
            {err && <Text style={styles.err} testID="auth-error">{err}</Text>}
            <Pressable testID="verify-email-btn" onPress={doVerifyEmail} style={styles.primaryBtn} disabled={busy || verifyCode.length !== 6}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Attiva account</Text>}
            </Pressable>
            <Pressable testID="verify-email-resend" onPress={doResendEmail} style={styles.linkBtn}>
              <Text style={styles.linkBtnTxt}>Non hai ricevuto il codice? Invia di nuovo</Text>
            </Pressable>
            <Pressable onPress={() => { setVerifyEmailAddr(null); setVerifyCode(""); setErr(null); setMode("login"); }} style={styles.linkBtn}>
              <Text style={styles.linkBtnTxt}>Torna all&apos;accesso</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

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
        <KeyboardAvoidingView behavior="padding" style={styles.formWrap}>
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
      <KeyboardAvoidingView behavior="padding" style={styles.pageWrap}>
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
                autoComplete="given-name"
              />
            </View>
          )}
          {mode === "register" && (
            <View style={styles.field}>
              <Text style={styles.label}>Cognome</Text>
              <TextInput
                testID="auth-lastname-input"
                value={lastName}
                onChangeText={setLastName}
                placeholder="Il tuo cognome"
                placeholderTextColor={HT.muted}
                style={styles.input}
                autoComplete="family-name"
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
          {mode === "register" && (
            <View style={styles.field}>
              <Text style={styles.label}>Conferma email</Text>
              <TextInput
                testID="auth-email-confirm-input"
                value={emailConfirm}
                onChangeText={setEmailConfirm}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Ripeti la tua email"
                placeholderTextColor={HT.muted}
                style={[styles.input, !!emailConfirm && emailConfirm.trim().toLowerCase() !== email.trim().toLowerCase() && styles.inputErr]}
              />
            </View>
          )}
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <PasswordInput
              testID="auth-password-input"
              value={password}
              onChangeText={setPassword}
              placeholder="Almeno 6 caratteri"
              placeholderTextColor={HT.muted}
              style={styles.input}
            />
          </View>
          {mode === "register" && (
            <View style={styles.field}>
              <Text style={styles.label}>Conferma password</Text>
              <PasswordInput
                testID="auth-password-confirm-input"
                value={passwordConfirm}
                onChangeText={setPasswordConfirm}
                placeholder="Ripeti la password"
                placeholderTextColor={HT.muted}
                style={[styles.input, !!passwordConfirm && passwordConfirm !== password && styles.inputErr]}
              />
            </View>
          )}
          {mode === "register" && (
            <View style={styles.field}>
              <Text style={styles.label}>Codice promozionale <Text style={styles.optional}>(facoltativo)</Text></Text>
              <TextInput
                testID="auth-promo-input"
                value={promoCode}
                onChangeText={(t) => setPromoCode(t.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="Es. BENVENUTO o AMICO-XXXX"
                placeholderTextColor={HT.muted}
                style={styles.input}
              />
            </View>
          )}
          {mode === "register" && (
            <>
              {/* V50.z434 — honeypot: invisibile agli umani (0×0, non focalizzabile), compilato dai bot */}
              <View style={styles.hpWrap} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <TextInput value={hp} onChangeText={setHp} style={styles.hpInput} tabIndex={-1 as any} autoComplete="off" testID="auth-hp-input" />
              </View>
              {challenge?.turnstile_site_key ? <TurnstileWidget siteKey={challenge.turnstile_site_key} onToken={setTurnstileToken} /> : null}
              <Pressable testID="auth-privacy-check" onPress={() => setPrivacyOk((v) => !v)} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: privacyOk }}>
                <Ionicons name={privacyOk ? "checkbox" : "square-outline"} size={24} color={privacyOk ? HT.brand : HT.muted} />
                <Text style={styles.checkTxt}>
                  Ho letto e accetto l&apos;
                  <Text testID="auth-privacy-link" style={styles.checkLink} onPress={() => router.push("/privacy-policy" as any)}>informativa privacy</Text>
                  {" "}<Text style={styles.required}>*</Text>
                </Text>
              </Pressable>
              <Pressable testID="auth-newsletter-check" onPress={() => setNewsletter((v) => !v)} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: newsletter }}>
                <Ionicons name={newsletter ? "checkbox" : "square-outline"} size={24} color={newsletter ? HT.brand : HT.muted} />
                <Text style={styles.checkTxt}>Iscrivimi alla newsletter con novità e consigli (facoltativo)</Text>
              </Pressable>
            </>
          )}
          {mode === "login" && (
            <Pressable testID="auth-forgot-link" onPress={() => router.push({ pathname: "/auth/forgot-password", params: email.trim() ? { email: email.trim() } : {} } as any)} style={styles.forgotBtn} hitSlop={8}>
              <Text style={styles.linkBtnTxt}>Recupera password</Text>
            </Pressable>
          )}

          {err && <Text style={styles.err} testID="auth-error">{err}</Text>}

          <Pressable testID="auth-submit-button" onPress={doAuth} style={styles.primaryBtn} disabled={busy}>
            {busy ? (securing ? <Text style={styles.primaryBtnText}>Verifica di sicurezza…</Text> : <ActivityIndicator color="#FFF" />) : <Text style={styles.primaryBtnText}>{mode === "login" ? "Accedi" : "Crea account"}</Text>}
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
  inputErr: { borderColor: HT.danger }, // V50.z433
  optional: { color: HT.muted, fontWeight: "400" },
  forgotBtn: { alignSelf: "flex-end", paddingVertical: 4 },
  // V50.z434
  hpWrap: { height: 0, width: 0, overflow: "hidden", opacity: 0 },
  hpInput: { height: 0, width: 0, padding: 0, margin: 0 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 44, paddingVertical: 6 },
  checkTxt: { flex: 1, color: HT.text2, fontSize: 13, lineHeight: 19 },
  checkLink: { color: HT.brand, fontWeight: "700", textDecorationLine: "underline" },
  required: { color: HT.danger, fontWeight: "800" },
  primaryBtn: { backgroundColor: HT.brand, borderRadius: theme.radius.md, paddingVertical: 14, alignItems: "center", marginTop: 6 },
  primaryBtnText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: HT.border },
  dividerText: { color: HT.muted, fontSize: 12 },
  googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: HT.card, borderRadius: theme.radius.md, paddingVertical: 12, borderWidth: 1, borderColor: HT.border },
  googleBtnText: { color: HT.brand, fontWeight: "700" },
  err: { color: HT.danger, fontSize: 13 },
  info: { color: HT.brand, fontSize: 13 }, // V50.z433
  linkBtn: { alignItems: "center", paddingVertical: 12 },
  linkBtnTxt: { color: HT.brand, fontWeight: "600", fontSize: 13 },
});
