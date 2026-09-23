import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Platform, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useAuth, biometricEnabled, hasPin, verifyPin } from "@/src/auth";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

/**
 * Full-screen overlay shown when `locked = true` in AuthContext.
 * Allows the user to unlock via biometrics OR a 6-digit PIN,
 * or fall back to full logout (which forces a new 2FA login).
 */
export function AppLockOverlay() {
  const { user, markUnlocked, logout } = useAuth();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [bioReady, setBioReady] = useState(false);

  useEffect(() => {
    (async () => {
      const bio = await biometricEnabled();
      const hp = await hasPin();
      setPinConfigured(hp);
      let supported = false;
      try {
        if (Platform.OS !== "web") {
          supported = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
        }
      } catch {}
      const canBio = bio && supported;
      setBioReady(canBio);
      if (canBio) await tryBio();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryBio = async () => {
    try {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: "Sblocca Dal Pastro CRM",
        fallbackLabel: pinConfigured ? "Usa PIN" : undefined,
        cancelLabel: "Annulla",
      });
      if (r.success) {
        await markUnlocked();
      }
    } catch (e: any) {
      setErr(e?.message || null);
    }
  };

  const trySubmit = async () => {
    if (pin.length !== 6) return;
    setBusy(true);
    setErr(null);
    try {
      const ok = await verifyPin(pin);
      if (ok) {
        await markUnlocked();
      } else {
        setErr("PIN errato");
        setPin("");
      }
    } finally { setBusy(false); }
  };

  const doFullLogout = () => {
    logout();
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={[HT.text, "#1C4869", "#3A739C"]} style={StyleSheet.absoluteFill} />
      <View style={styles.body}>
        <View style={styles.iconRing}>
          <Ionicons name="lock-closed" size={44} color="#FFF" />
        </View>
        <Text style={styles.title}>App bloccata</Text>
        <Text style={styles.subtitle}>Ciao {user?.name || ""}. Sblocca per continuare.</Text>

        {pinConfigured && (
          <>
            <TextInput
              testID="lock-pin-input"
              value={pin}
              onChangeText={(t) => setPin(t.replace(/[^0-9]/g, "").slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              placeholder="••••••"
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={styles.pinInput}
              autoFocus
              onSubmitEditing={trySubmit}
            />
            <Pressable testID="lock-unlock-btn" onPress={trySubmit} disabled={busy || pin.length !== 6} style={[styles.primaryBtn, (busy || pin.length !== 6) && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color={HT.text} /> : <Text style={styles.primaryBtnTxt}>Sblocca</Text>}
            </Pressable>
          </>
        )}

        {err && <Text style={styles.err}>{err}</Text>}

        {bioReady && (
          <Pressable testID="lock-bio-btn" onPress={tryBio} style={styles.bioBtn}>
            <Ionicons name="finger-print" size={22} color="#FFF" />
            <Text style={styles.bioBtnTxt}>Sblocca con biometria</Text>
          </Pressable>
        )}

        <Pressable onPress={doFullLogout} style={styles.linkBtn}>
          <Text style={styles.linkBtnTxt}>Esci e accedi con password + 2FA</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 9999 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  iconRing: { width: 88, height: 88, borderRadius: 44, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { color: "#FFF", fontSize: 24, fontWeight: "800" },
  subtitle: { color: "#CFE1EE", fontSize: 14, marginBottom: 12 },
  pinInput: { width: 220, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, textAlign: "center", color: "#FFF", fontSize: 28, letterSpacing: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  primaryBtn: { width: 220, backgroundColor: HT.card, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  primaryBtnTxt: { color: HT.text, fontWeight: "800", fontSize: 15 },
  bioBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 12 },
  bioBtnTxt: { color: "#FFF", fontWeight: "700" },
  err: { color: "#FCA5A5", fontSize: 13 },
  linkBtn: { paddingVertical: 10, marginTop: 6 },
  linkBtnTxt: { color: "#93C5FD", fontSize: 13, fontWeight: "600" },
});
