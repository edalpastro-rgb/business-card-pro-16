// V50.z433 — Recupero password: email → codice a 6 cifre (via email, 15 min) → nuova password.
// Nessun deep link richiesto: funziona su APK, iOS e web senza rebuild. Backend: /auth/password-reset/{request,confirm}.
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions } from "react-native";
import { PasswordInput } from "@/src/PasswordInput"; // V50.z433 — occhio mostra/nascondi password
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 700;
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState(typeof emailParam === "string" ? emailParam : "");
  const [resetId, setResetId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr("Inserisci un'email valida"); return; }
    setErr(null); setBusy(true);
    try {
      const r = await api<{ reset_id: string }>("/auth/password-reset/request", { method: "POST", body: { email: e } });
      setResetId(r.reset_id);
      setStep("code");
    } catch (ex: any) {
      setErr(ex?.message || "Impossibile inviare il codice, riprova");
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) { setErr("Inserisci il codice a 6 cifre ricevuto via email"); return; }
    if (password.length < 6) { setErr("La nuova password deve avere almeno 6 caratteri"); return; }
    if (password !== passwordConfirm) { setErr("Le due password non coincidono"); return; }
    setErr(null); setBusy(true);
    try {
      await api("/auth/password-reset/confirm", { method: "POST", body: { reset_id: resetId, code: code.trim(), new_password: password } });
      setStep("done");
    } catch (ex: any) {
      setErr(ex?.message || "Codice non valido o scaduto");
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={[HT.text, "#1C4869", "#3A739C"]} style={StyleSheet.absoluteFillObject as any} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }, isWide && styles.scrollCentered]} keyboardShouldPersistTaps="handled">
          <View style={[styles.container, isWide && styles.containerWide]}>
            <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10} testID="forgot-back">
              <Ionicons name="chevron-back" size={22} color="#FFF" />
              <Text style={styles.backTxt}>Accesso</Text>
            </Pressable>
            <View style={styles.hero}>
              <Ionicons name={step === "done" ? "checkmark-circle" : "key-outline"} size={44} color="#FFF" />
              <Text style={styles.title}>{step === "done" ? "Password aggiornata" : "Recupera password"}</Text>
              <Text style={styles.subtitle}>
                {step === "email" && "Inserisci l'email del tuo account: ti invieremo un codice a 6 cifre valido 15 minuti."}
                {step === "code" && `Abbiamo inviato un codice a ${email.trim()}. Inseriscilo qui sotto e scegli la nuova password.`}
                {step === "done" && "Ora puoi accedere con la nuova password."}
              </Text>
            </View>

            <View style={styles.card}>
              {step === "email" && (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>Email</Text>
                    <TextInput testID="forgot-email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="tu@email.it" placeholderTextColor={HT.muted} style={styles.input} autoFocus />
                  </View>
                  {err && <Text style={styles.err} testID="forgot-error">{err}</Text>}
                  <Pressable testID="forgot-send-btn" onPress={requestCode} style={styles.primaryBtn} disabled={busy}>
                    {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Invia codice</Text>}
                  </Pressable>
                </>
              )}
              {step === "code" && (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>Codice a 6 cifre</Text>
                    <TextInput testID="forgot-code-input" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" placeholder="123456" placeholderTextColor={HT.muted} style={[styles.input, styles.codeInput]} maxLength={6} autoFocus />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Nuova password</Text>
                    <PasswordInput testID="forgot-password-input" value={password} onChangeText={setPassword} autoComplete="new-password" placeholder="Almeno 6 caratteri" placeholderTextColor={HT.muted} style={styles.input} />
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Conferma nuova password</Text>
                    <PasswordInput testID="forgot-password-confirm-input" value={passwordConfirm} onChangeText={setPasswordConfirm} placeholder="Ripeti la password" placeholderTextColor={HT.muted} style={[styles.input, !!passwordConfirm && passwordConfirm !== password && styles.inputErr]} />
                  </View>
                  {err && <Text style={styles.err} testID="forgot-error">{err}</Text>}
                  <Pressable testID="forgot-confirm-btn" onPress={confirm} style={styles.primaryBtn} disabled={busy}>
                    {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Imposta nuova password</Text>}
                  </Pressable>
                  <Pressable testID="forgot-resend-btn" onPress={() => { setCode(""); setStep("email"); setErr(null); }} style={styles.linkBtn}>
                    <Text style={styles.linkBtnTxt}>Non hai ricevuto il codice? Invia di nuovo</Text>
                  </Pressable>
                </>
              )}
              {step === "done" && (
                <Pressable testID="forgot-done-btn" onPress={() => router.replace("/login")} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>Vai all&apos;accesso</Text>
                </Pressable>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.text },
  scroll: { flexGrow: 1, paddingHorizontal: 16 },
  scrollCentered: { justifyContent: "center", alignItems: "center" },
  container: { width: "100%" },
  containerWide: { maxWidth: 480 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", paddingVertical: 8, minHeight: 44 },
  backTxt: { color: "#FFF", fontWeight: "600", fontSize: 15 },
  hero: { alignItems: "center", gap: 8, paddingVertical: 20, paddingHorizontal: 12 },
  title: { color: "#FFFFFF", fontSize: 22, fontWeight: "800", textAlign: "center" },
  subtitle: { color: "rgba(255,255,255,0.85)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  card: { backgroundColor: HT.card2, borderRadius: 20, padding: 20, gap: 14 },
  field: { gap: 6 },
  label: { color: HT.text2, fontSize: 13, fontWeight: "600" },
  input: { backgroundColor: HT.card, borderRadius: theme.radius.md, borderWidth: 1, borderColor: HT.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: HT.text },
  inputErr: { borderColor: HT.danger },
  codeInput: { textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: "700" },
  primaryBtn: { backgroundColor: HT.brand, borderRadius: theme.radius.md, paddingVertical: 14, alignItems: "center", marginTop: 6, minHeight: 48, justifyContent: "center" },
  primaryBtnText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  err: { color: HT.danger, fontSize: 13 },
  linkBtn: { alignItems: "center", paddingVertical: 12 },
  linkBtnTxt: { color: HT.brand, fontWeight: "600", fontSize: 13 },
});
