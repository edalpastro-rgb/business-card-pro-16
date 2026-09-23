// V50.z187 — Accesso rapido dalla schermata di login (impronta / Face ID / PIN) — modulo isolato.
// Dopo un login completo il dispositivo può essere registrato come "fidato" (device_id + secret in
// SecureStore). Alla prossima apertura, sulla schermata di login compare la card «Bentornato, Nome»
// con i pulsanti Impronta/Face ID e PIN: superata la verifica locale, il secret viene scambiato con un
// JWT (`POST /auth/quick-unlock/login`). La 2FA TOTP resta sul login classico (il dispositivo fidato è il 2° fattore).
import React, { useEffect, useState } from "react";
import { getDeviceInfo } from "@/src/device"; // V50.z293
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { useAuth, hasPin, verifyPin, type User } from "@/src/auth";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const KEY = "quick_unlock_v1";
type Enrollment = { device_id: string; secret: string; email: string; name: string };

export async function getQuickUnlock(): Promise<Enrollment | null> {
  try {
    const raw = (await storage.secureGet<string | null>(KEY, null)) as string | null;
    return raw ? (JSON.parse(raw) as Enrollment) : null;
  } catch { return null; }
}
export async function clearQuickUnlock(): Promise<void> {
  const e = await getQuickUnlock();
  try { await storage.secureRemove(KEY); } catch { /* ignore */ }
  if (e) { try { await api(`/auth/quick-unlock/devices/${e.device_id}`, { method: "DELETE" }); } catch { /* ignore */ } }
}
export async function enrollQuickUnlock(user: User): Promise<boolean> {
  try {
    const r = await api<{ device_id: string; secret: string }>("/auth/quick-unlock/enroll", {
      method: "POST", body: { device_name: Platform.OS === "ios" ? "iPhone" : "Android", platform: Platform.OS },
    });
    await storage.secureSet(KEY, JSON.stringify({ device_id: r.device_id, secret: r.secret, email: user.email, name: user.name || user.email }));
    return true;
  } catch { return false; }
}

async function biometricAvailable(): Promise<{ ok: boolean; face: boolean }> {
  if (Platform.OS === "web") return { ok: false, face: false };
  try {
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = hw && (await LocalAuthentication.isEnrolledAsync());
    const types = hw ? await LocalAuthentication.supportedAuthenticationTypesAsync() : [];
    return { ok: !!enrolled, face: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) };
  } catch { return { ok: false, face: false }; }
}

/** Dopo un login riuscito (native): propone una volta di attivare l'accesso rapido. */
export async function maybeOfferQuickUnlock(u?: User | null): Promise<void> {
  if (Platform.OS === "web") return;
  if (await getQuickUnlock()) return;
  let user = u || null;
  if (!user) { try { user = await api<User>("/auth/me"); } catch { return; } }
  if (!user?.user_id) return;
  const asked = await storage.getItem<string | null>(`${KEY}_asked_${user.user_id}`, null);
  if (asked) return;
  await storage.setItem(`${KEY}_asked_${user.user_id}`, "1");
  const bio = await biometricAvailable();
  const pin = await hasPin();
  if (!bio.ok && !pin) return;
  const how = bio.ok ? (bio.face ? "Face ID" : "impronta digitale") : "PIN";
  Alert.alert("Accesso rapido", `Vuoi entrare la prossima volta con ${how} senza digitare la password?`, [
    { text: "Non ora", style: "cancel" },
    { text: "Attiva", onPress: () => { void enrollQuickUnlock(user).then((ok) => { if (!ok) Alert.alert("Accesso rapido", "Attivazione non riuscita, riprova da Sicurezza."); }); } },
  ]);
}

type Props = { onUseOtherAccount?: () => void; onSuccess: () => void };

/** Card «Bentornato» sulla schermata di login. Non renderizza nulla se il dispositivo non è registrato. */
export function QuickUnlockCard({ onUseOtherAccount, onSuccess }: Props) {
  const { loginWithSession } = useAuth();
  const [enr, setEnr] = useState<Enrollment | null>(null);
  const [bio, setBio] = useState<{ ok: boolean; face: boolean }>({ ok: false, face: false });
  const [pinOk, setPinOk] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const e = await getQuickUnlock();
      setEnr(e);
      if (!e) return;
      setBio(await biometricAvailable());
      setPinOk(await hasPin());
    })();
  }, []);

  const finish = async () => {
    if (!enr) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ token: string; user: User }>("/auth/quick-unlock/login", { method: "POST", body: { device_id: enr.device_id, secret: enr.secret, device: await getDeviceInfo() } }); // V50.z293
      await loginWithSession(r.token, r.user);
      onSuccess();
    } catch (e: any) {
      setErr(e?.message || "Accesso rapido non disponibile: usa email e password.");
      try { await storage.secureRemove(KEY); } catch { /* ignore */ }
      setEnr(null);
    } finally { setBusy(false); }
  };

  const withBiometric = async () => {
    setErr(null);
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Accedi ad AdvisorOS", cancelLabel: "Annulla", disableDeviceFallback: true });
      if (!r.success) { setErr("Verifica non riuscita"); return; }
      await finish();
    } catch { setErr("Biometria non disponibile"); }
  };

  const withPin = async () => {
    if (pin.length !== 6) return;
    setErr(null);
    if (!(await verifyPin(pin))) { setErr("PIN errato"); setPin(""); return; }
    await finish();
  };

  if (!enr || (!bio.ok && !pinOk)) return null;
  return (
    <View style={styles.card} testID="quick-unlock-card">
      <View style={styles.avatar}><Text style={styles.avatarTxt}>{(enr.name || "?").slice(0, 1).toUpperCase()}</Text></View>
      <Text style={styles.title}>Bentornato, {enr.name.split(" ")[0]}</Text>
      <Text style={styles.sub}>{enr.email}</Text>
      {busy ? <ActivityIndicator color="#7C3AED" style={{ marginVertical: 14 }} /> : (
        <View style={styles.row}>
          {bio.ok && (
            <Pressable onPress={withBiometric} style={[styles.btn, styles.btnPrimary]} testID="quick-unlock-biometric">
              <Ionicons name={bio.face ? "scan-outline" : "finger-print"} size={20} color="#FFF" />
              <Text style={styles.btnTxt}>{bio.face ? "Face ID" : "Impronta"}</Text>
            </Pressable>
          )}
          {pinOk && (
            <Pressable onPress={() => setShowPin((v) => !v)} style={[styles.btn, styles.btnGhost]} testID="quick-unlock-pin">
              <Ionicons name="keypad" size={20} color="#7C3AED" />
              <Text style={[styles.btnTxt, { color: "#7C3AED" }]}>PIN</Text>
            </Pressable>
          )}
        </View>
      )}
      {showPin && !busy && (
        <View style={styles.pinRow}>
          <TextInput value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6}
            placeholder="PIN a 6 cifre" placeholderTextColor={HT.muted} style={styles.pinInput} testID="quick-unlock-pin-input" onSubmitEditing={withPin} />
          <Pressable onPress={withPin} disabled={pin.length !== 6} style={[styles.pinGo, pin.length !== 6 && { opacity: 0.5 }]} testID="quick-unlock-pin-go">
            <Ionicons name="arrow-forward" size={18} color="#FFF" />
          </Pressable>
        </View>
      )}
      {err && <Text style={styles.err}>{err}</Text>}
      <Pressable onPress={onUseOtherAccount} hitSlop={8} style={{ marginTop: 10 }} testID="quick-unlock-other">
        <Text style={styles.link}>Usa un altro account / password</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 18, padding: 18, alignItems: "center", marginBottom: 14, borderWidth: 1, borderColor: '#E9D5FF' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#7C3AED', alignItems: "center", justifyContent: "center", marginBottom: 8 },
  avatarTxt: { color: "#FFF", fontWeight: "800", fontSize: 22 },
  title: { fontSize: 17, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2, marginBottom: 12 },
  row: { flexDirection: "row", gap: 10 },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, minHeight: 46, borderRadius: 12 },
  btnPrimary: { backgroundColor: '#7C3AED' },
  btnGhost: { borderWidth: 1.5, borderColor: '#7C3AED' },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  pinRow: { flexDirection: "row", gap: 8, marginTop: 12, width: "100%" },
  pinInput: { flex: 1, backgroundColor: HT.card2, borderRadius: 12, borderWidth: 1, borderColor: HT.border, paddingHorizontal: 12, minHeight: 46, fontSize: 18, letterSpacing: 6, color: HT.text, textAlign: "center" },
  pinGo: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#7C3AED', alignItems: "center", justifyContent: "center" },
  err: { color: "#DC2626", fontSize: 12, marginTop: 8 },
  link: { color: "#7C3AED", fontSize: 13, fontWeight: "700" },
});

/** Riga per la pagina Sicurezza: stato + attiva/disattiva l'accesso rapido su questo dispositivo. */
export function QuickUnlockSettingRow() {
  const { user } = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  const refresh = async () => setOn(!!(await getQuickUnlock()));
  useEffect(() => { void refresh(); }, []);
  if (Platform.OS === "web" || on === null) return null;
  const toggle = async () => {
    if (on) { await clearQuickUnlock(); } else if (user) { const ok = await enrollQuickUnlock(user); if (!ok) Alert.alert("Accesso rapido", "Attivazione non riuscita."); }
    await refresh();
  };
  return (
    <View style={settingStyles.settingRow} testID="quick-unlock-setting">
      <View style={{ flex: 1 }}>
        <Text style={settingStyles.settingLabel}>Accesso rapido al login</Text>
        <Text style={settingStyles.settingSub}>{on ? "Attivo: entri con impronta / Face ID / PIN senza password" : "Entra con impronta / Face ID / PIN dalla schermata di login"}</Text>
      </View>
      <Pressable onPress={toggle} style={[settingStyles.settingBtn, on && { backgroundColor: HT.dangerTint, borderColor: '#FCA5A5' }]} testID="quick-unlock-toggle">
        <Text style={[settingStyles.settingBtnTxt, on && { color: HT.danger }]}>{on ? "Disattiva" : "Attiva"}</Text>
      </Pressable>
    </View>
  );
}

const settingStyles = StyleSheet.create({
  settingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: HT.border, marginTop: 8 },
  settingLabel: { fontSize: 14, fontWeight: "700", color: HT.text },
  settingSub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  settingBtn: { paddingHorizontal: 14, minHeight: 40, borderRadius: 10, borderWidth: 1.5, borderColor: '#7C3AED', alignItems: "center", justifyContent: "center", backgroundColor: HT.violetTint },
  settingBtnTxt: { color: "#7C3AED", fontWeight: "800", fontSize: 13 },
});
