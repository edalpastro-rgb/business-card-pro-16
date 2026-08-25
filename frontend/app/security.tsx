import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Image, Alert, Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth, setPin, hasPin, clearPin, setBiometricEnabled, biometricEnabled, isAppLockEnabled, setAppLockEnabled } from "@/src/auth";
import { theme } from "@/src/theme";
import { ModuleErrorBoundary } from "@/src/shared";

type Status = {
  enabled: boolean;
  backup_codes_remaining: number;
  enabled_at: string | null;
};

export default function SecurityRoute() {
  return (
    <ModuleErrorBoundary moduleName="profile">
      <SecurityScreen />
    </ModuleErrorBoundary>
  );
}

function SecurityScreen() {
  const router = useRouter();
  const { refresh, trustExpiresAt, logout } = useAuth();

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Setup flow state
  const [setupQr, setSetupQr] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  // Disable flow
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePwd, setDisablePwd] = useState("");

  // Regen backup codes
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState("");

  // App lock state
  const [lockEnabled, setLockEnabled] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinConfirmDraft, setPinConfirmDraft] = useState("");
  const [showPinSetup, setShowPinSetup] = useState(false);

  // V29.b — Delete account state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePwd, setDeletePwd] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const CONFIRM_PHRASE = "ELIMINA IL MIO ACCOUNT";

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api<Status>("/auth/2fa/status");
      setStatus(s);
    } catch { setStatus(null); }
    try {
      const supported = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBioSupported(Platform.OS !== "web" && supported && enrolled);
    } catch { setBioSupported(false); }
    setBioEnabled(await biometricEnabled());
    setPinConfigured(await hasPin());
    setLockEnabled(await isAppLockEnabled());
    setLoading(false);
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const startSetup = async () => {
    setBusy(true);
    try {
      const r = await api<{ otpauth_uri: string; qr_code_data_url: string; secret: string }>(
        "/auth/2fa/setup/start", { method: "POST" }
      );
      setSetupQr(r.qr_code_data_url);
      setSetupSecret(r.secret);
      setConfirmCode("");
      setNewBackupCodes(null);
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Impossibile avviare 2FA");
    } finally { setBusy(false); }
  };

  const confirmSetup = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: true; backup_codes: string[] }>("/auth/2fa/setup/confirm", {
        method: "POST", body: { code: confirmCode.trim() },
      });
      setNewBackupCodes(r.backup_codes);
      setSetupQr(null);
      setSetupSecret(null);
      setConfirmCode("");
      await refresh();
      await loadAll();
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Codice non valido");
    } finally { setBusy(false); }
  };

  const doDisable = async () => {
    setBusy(true);
    try {
      await api("/auth/2fa/disable", { method: "POST", body: { password: disablePwd } });
      setDisableOpen(false);
      setDisablePwd("");
      await refresh();
      await loadAll();
      Alert.alert("2FA disattivato", "L'accesso a due fattori è stato disabilitato.");
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Password non valida");
    } finally { setBusy(false); }
  };

  const doRegen = async () => {
    setBusy(true);
    try {
      const r = await api<{ backup_codes: string[] }>("/auth/2fa/regenerate-backup-codes", {
        method: "POST", body: { code: regenCode.trim() },
      });
      setNewBackupCodes(r.backup_codes);
      setRegenOpen(false);
      setRegenCode("");
      await loadAll();
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Codice non valido");
    } finally { setBusy(false); }
  };

  // V29.b — Elimina account (Apple/Google compliance)
  const doDeleteAccount = async () => {
    const phrase = deleteConfirm.trim().toUpperCase();
    if (phrase !== CONFIRM_PHRASE) {
      Alert.alert("Frase non corretta", `Digita esattamente '${CONFIRM_PHRASE}' per confermare`);
      return;
    }
    if (!deletePwd) {
      Alert.alert("Password richiesta", "Inserisci la tua password per confermare");
      return;
    }
    setDeleteBusy(true);
    try {
      await api("/auth/me", {
        method: "DELETE",
        body: { password: deletePwd, confirmation: CONFIRM_PHRASE },
      });
      // Successo: chiudi tutto e riporta al login
      setDeleteOpen(false);
      setDeletePwd("");
      setDeleteConfirm("");
      Alert.alert(
        "Account eliminato",
        "Il tuo account e tutti i dati associati sono stati eliminati definitivamente.",
        [{ text: "OK", onPress: async () => { try { await logout(); } catch {} router.replace("/" as any); } }]
      );
    } catch (e: any) {
      Alert.alert("Errore", e.message || "Impossibile eliminare l'account");
    } finally {
      setDeleteBusy(false);
    }
  };

  const copyCodes = async (codes: string[]) => {
    await Clipboard.setStringAsync(codes.join("\n"));
    Alert.alert("Copiato", "Codici di recupero copiati negli appunti");
  };

  const copySecret = async () => {
    if (!setupSecret) return;
    await Clipboard.setStringAsync(setupSecret);
    Alert.alert("Copiato", "Codice segreto copiato");
  };

  const toggleBio = async () => {
    if (!bioSupported) {
      Alert.alert("Non disponibile", "La biometria non è configurata su questo dispositivo");
      return;
    }
    if (!bioEnabled) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Attiva sblocco veloce" });
      if (!r.success) { Alert.alert("Annullato", "Verifica biometrica non riuscita"); return; }
    }
    const next = !bioEnabled;
    await setBiometricEnabled(next);
    setBioEnabled(next);
    if (next && !(await isAppLockEnabled())) {
      await setAppLockEnabled(true);
      setLockEnabled(true);
    }
  };

  const toggleLock = async () => {
    const next = !lockEnabled;
    if (next && !bioEnabled && !pinConfigured) {
      Alert.alert("Configura prima", "Attiva biometria o imposta un PIN prima di abilitare il blocco app.");
      return;
    }
    await setAppLockEnabled(next);
    setLockEnabled(next);
  };

  const savePin = async () => {
    if (pinDraft.length !== 6 || !/^\d{6}$/.test(pinDraft)) {
      Alert.alert("PIN non valido", "Il PIN deve essere di 6 cifre");
      return;
    }
    if (pinDraft !== pinConfirmDraft) {
      Alert.alert("Non corrispondono", "I due PIN non coincidono");
      return;
    }
    await setPin(pinDraft);
    setPinConfigured(true);
    setShowPinSetup(false);
    setPinDraft(""); setPinConfirmDraft("");
    if (!(await isAppLockEnabled())) {
      await setAppLockEnabled(true);
      setLockEnabled(true);
    }
    Alert.alert("PIN impostato", "Puoi usarlo per sbloccare l'app.");
  };

  const removePin = () => {
    Alert.alert("Rimuovere PIN?", "Non potrai più sbloccare l'app con il PIN.", [
      { text: "Annulla", style: "cancel" },
      { text: "Rimuovi", style: "destructive", onPress: async () => {
        await clearPin();
        setPinConfigured(false);
        if (!bioEnabled) {
          await setAppLockEnabled(false);
          setLockEnabled(false);
        }
      }},
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.brandPrimary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Sicurezza & 2FA</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {/* 2FA CARD */}
        <View style={styles.card}>
          <View style={styles.rowHead}>
            <Ionicons name="shield-checkmark" size={26} color={theme.color.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Autenticazione a due fattori</Text>
              <Text style={styles.cardSub}>
                {status?.enabled ? "Attiva. Al login verrà richiesto il codice dell'app Authenticator." : "Non attiva. Aggiungi un livello di sicurezza al tuo account."}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: status?.enabled ? "#DCFCE7" : "#F1F5F9" }]}>
              <Text style={{ color: status?.enabled ? "#166534" : "#64748B", fontWeight: "800", fontSize: 12 }}>
                {status?.enabled ? "ON" : "OFF"}
              </Text>
            </View>
          </View>

          {status?.enabled ? (
            <View style={{ gap: 10, marginTop: 12 }}>
              <View style={styles.infoRow}>
                <Ionicons name="key" size={16} color={theme.color.muted} />
                <Text style={styles.infoTxt}>Codici di recupero rimasti: <Text style={{ fontWeight: "800", color: theme.color.onSurface }}>{status.backup_codes_remaining}</Text></Text>
              </View>
              <Pressable testID="regen-codes-btn" onPress={() => setRegenOpen(true)} style={styles.secondaryBtn}>
                <Ionicons name="refresh" size={16} color={theme.color.brandPrimary} />
                <Text style={styles.secondaryBtnTxt}>Rigenera codici di recupero</Text>
              </Pressable>
              <Pressable testID="disable-2fa-btn" onPress={() => setDisableOpen(true)} style={[styles.secondaryBtn, { borderColor: theme.color.error }]}>
                <Ionicons name="close-circle" size={16} color={theme.color.error} />
                <Text style={[styles.secondaryBtnTxt, { color: theme.color.error }]}>Disattiva 2FA</Text>
              </Pressable>
            </View>
          ) : setupQr ? (
            <View style={{ gap: 12, marginTop: 12 }}>
              <Text style={styles.hint}>1. Scarica <Text style={{ fontWeight: "700" }}>Google Authenticator</Text>, <Text style={{ fontWeight: "700" }}>Microsoft Authenticator</Text> o <Text style={{ fontWeight: "700" }}>Authy</Text>.</Text>
              <Text style={styles.hint}>2. Scansiona il QR:</Text>
              <View style={{ alignItems: "center" }}>
                <Image source={{ uri: setupQr }} style={{ width: 220, height: 220, backgroundColor: "#FFF", borderRadius: 12 }} />
              </View>
              <Text style={styles.hint}>Oppure inserisci manualmente questa chiave:</Text>
              <Pressable onPress={copySecret} style={styles.secretBox}>
                <Text style={styles.secretText}>{setupSecret}</Text>
                <Ionicons name="copy-outline" size={16} color={theme.color.brandPrimary} />
              </Pressable>
              <Text style={styles.hint}>3. Inserisci il codice a 6 cifre generato dall&apos;app:</Text>
              <TextInput
                testID="2fa-confirm-code-input"
                value={confirmCode}
                onChangeText={setConfirmCode}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor="#94A3B8"
                style={[styles.input, { textAlign: "center", fontSize: 22, letterSpacing: 6 }]}
              />
              <Pressable testID="2fa-confirm-btn" onPress={confirmSetup} disabled={busy || confirmCode.length !== 6} style={[styles.primaryBtn, (busy || confirmCode.length !== 6) && { opacity: 0.5 }]}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnTxt}>Conferma e attiva</Text>}
              </Pressable>
              <Pressable onPress={() => { setSetupQr(null); setSetupSecret(null); }} style={styles.linkBtn}>
                <Text style={styles.linkBtnTxt}>Annulla</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable testID="enable-2fa-btn" onPress={startSetup} disabled={busy} style={[styles.primaryBtn, { marginTop: 12 }]}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnTxt}>Attiva 2FA</Text>}
            </Pressable>
          )}
        </View>

        {/* NEW BACKUP CODES CARD */}
        {newBackupCodes && (
          <View style={[styles.card, { borderColor: "#F59E0B", borderWidth: 2 }]}>
            <View style={styles.rowHead}>
              <Ionicons name="warning" size={22} color="#B45309" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: "#92400E" }]}>Salva i codici di recupero</Text>
                <Text style={styles.cardSub}>Questi codici NON verranno mostrati di nuovo. Salvali in un luogo sicuro.</Text>
              </View>
            </View>
            <View style={styles.codeGrid}>
              {newBackupCodes.map((c) => (
                <View key={c} style={styles.codeChip}><Text style={styles.codeChipTxt}>{c}</Text></View>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={() => copyCodes(newBackupCodes)} style={[styles.secondaryBtn, { flex: 1 }]}>
                <Ionicons name="copy-outline" size={16} color={theme.color.brandPrimary} />
                <Text style={styles.secondaryBtnTxt}>Copia tutti</Text>
              </Pressable>
              <Pressable onPress={() => setNewBackupCodes(null)} style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]}>
                <Text style={styles.primaryBtnTxt}>Ho salvato</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* APP LOCK CARD */}
        <View style={styles.card}>
          <View style={styles.rowHead}>
            <Ionicons name="lock-closed" size={26} color={theme.color.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Blocco app (sblocco veloce 24h)</Text>
              <Text style={styles.cardSub}>Dopo un accesso 2FA riuscito, l&apos;app resta autorizzata per 24 ore. Nel frattempo puoi sbloccare con impronta o PIN.</Text>
            </View>
          </View>

          {trustExpiresAt && (
            <View style={styles.trustBox}>
              <Ionicons name="time" size={14} color={theme.color.brandPrimary} />
              <Text style={styles.trustTxt}>Sessione 2FA valida fino al {new Date(trustExpiresAt).toLocaleString("it-IT")}</Text>
            </View>
          )}

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Attiva blocco app</Text>
              <Text style={styles.toggleSub}>Richiedi biometria/PIN al riavvio dopo 5 minuti di inattività</Text>
            </View>
            <Pressable testID="toggle-lock" onPress={toggleLock} style={[styles.toggle, lockEnabled && styles.toggleOn]}>
              <View style={[styles.toggleKnob, lockEnabled && styles.toggleKnobOn]} />
            </Pressable>
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Impronta / Face ID</Text>
              <Text style={styles.toggleSub}>{bioSupported ? "Supportata su questo dispositivo" : "Non disponibile su questo dispositivo"}</Text>
            </View>
            <Pressable testID="toggle-bio" onPress={toggleBio} disabled={!bioSupported} style={[styles.toggle, bioEnabled && styles.toggleOn, !bioSupported && { opacity: 0.4 }]}>
              <View style={[styles.toggleKnob, bioEnabled && styles.toggleKnobOn]} />
            </Pressable>
          </View>

          <View style={{ marginTop: 8 }}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>PIN di sicurezza (6 cifre)</Text>
                <Text style={styles.toggleSub}>{pinConfigured ? "PIN impostato" : "Nessun PIN configurato"}</Text>
              </View>
              {pinConfigured ? (
                <Pressable onPress={removePin} style={styles.smallBtnDanger}>
                  <Text style={styles.smallBtnDangerTxt}>Rimuovi</Text>
                </Pressable>
              ) : (
                <Pressable testID="setup-pin-btn" onPress={() => setShowPinSetup(true)} style={styles.smallBtn}>
                  <Text style={styles.smallBtnTxt}>Imposta</Text>
                </Pressable>
              )}
            </View>
            {pinConfigured && (
              <Pressable onPress={() => setShowPinSetup(true)} style={[styles.linkBtn, { alignSelf: "flex-start" }]}>
                <Text style={styles.linkBtnTxt}>Cambia PIN</Text>
              </Pressable>
            )}
          </View>

          {showPinSetup && (
            <View style={{ marginTop: 10, gap: 8 }}>
              <TextInput
                testID="pin-new-input"
                value={pinDraft}
                onChangeText={(t) => setPinDraft(t.replace(/[^0-9]/g, "").slice(0, 6))}
                placeholder="Nuovo PIN (6 cifre)"
                placeholderTextColor="#94A3B8"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                style={[styles.input, { textAlign: "center", fontSize: 20, letterSpacing: 8 }]}
              />
              <TextInput
                testID="pin-confirm-input"
                value={pinConfirmDraft}
                onChangeText={(t) => setPinConfirmDraft(t.replace(/[^0-9]/g, "").slice(0, 6))}
                placeholder="Ripeti PIN"
                placeholderTextColor="#94A3B8"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                style={[styles.input, { textAlign: "center", fontSize: 20, letterSpacing: 8 }]}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => { setShowPinSetup(false); setPinDraft(""); setPinConfirmDraft(""); }} style={[styles.secondaryBtn, { flex: 1 }]}>
                  <Text style={styles.secondaryBtnTxt}>Annulla</Text>
                </Pressable>
                <Pressable testID="save-pin-btn" onPress={savePin} style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]}>
                  <Text style={styles.primaryBtnTxt}>Salva PIN</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* DISABLE MODAL */}
        {disableOpen && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Disattivare 2FA?</Text>
            <Text style={styles.cardSub}>Inserisci la password del tuo account per confermare.</Text>
            <TextInput
              testID="disable-password"
              value={disablePwd}
              onChangeText={setDisablePwd}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor="#94A3B8"
              style={[styles.input, { marginTop: 8 }]}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable onPress={() => { setDisableOpen(false); setDisablePwd(""); }} style={[styles.secondaryBtn, { flex: 1 }]}>
                <Text style={styles.secondaryBtnTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={doDisable} disabled={busy || !disablePwd} style={[styles.primaryBtn, { flex: 1, marginTop: 0, backgroundColor: theme.color.error }]}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnTxt}>Disattiva</Text>}
              </Pressable>
            </View>
          </View>
        )}

        {/* REGEN MODAL */}
        {regenOpen && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rigenera codici di recupero</Text>
            <Text style={styles.cardSub}>Inserisci un codice a 6 cifre dell&apos;app Authenticator per confermare. I vecchi codici saranno invalidati.</Text>
            <TextInput
              testID="regen-code"
              value={regenCode}
              onChangeText={setRegenCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor="#94A3B8"
              style={[styles.input, { marginTop: 8, textAlign: "center", fontSize: 20, letterSpacing: 6 }]}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable onPress={() => { setRegenOpen(false); setRegenCode(""); }} style={[styles.secondaryBtn, { flex: 1 }]}>
                <Text style={styles.secondaryBtnTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={doRegen} disabled={busy || regenCode.length !== 6} style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnTxt}>Rigenera</Text>}
              </Pressable>
            </View>
          </View>
        )}

        {/* V29.b · Zona pericolo · Elimina account (Apple/Google compliance) */}
        <View style={styles.dangerCard}>
          <View style={styles.dangerHead}>
            <Ionicons name="warning" size={18} color="#DC2626" />
            <Text style={styles.dangerTitle}>Zona pericolo</Text>
          </View>
          <Text style={styles.dangerDesc}>
            {"L'eliminazione dell'account è "}<Text style={{ fontWeight: "800" }}>permanente</Text>.
            {" "}Verranno cancellati definitivamente: profilo, contatti, appuntamenti, callback, bollette,
            biglietto da visita, impostazioni, memoria Axon e connessioni Google Drive.
          </Text>
          {!deleteOpen ? (
            <Pressable
              testID="delete-account-open"
              onPress={() => setDeleteOpen(true)}
              style={styles.deleteBtn}
            >
              <Ionicons name="trash" size={16} color="#DC2626" />
              <Text style={styles.deleteBtnTxt}>Elimina il mio account</Text>
            </Pressable>
          ) : (
            <View style={styles.deleteForm}>
              <Text style={styles.deleteLabel}>Password</Text>
              <TextInput
                testID="delete-account-password"
                value={deletePwd}
                onChangeText={setDeletePwd}
                placeholder="La tua password"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                style={styles.input}
              />
              <Text style={[styles.deleteLabel, { marginTop: 10 }]}>
                Digita <Text style={styles.mono}>{CONFIRM_PHRASE}</Text> per confermare
              </Text>
              <TextInput
                testID="delete-account-confirm"
                value={deleteConfirm}
                onChangeText={setDeleteConfirm}
                placeholder={CONFIRM_PHRASE}
                placeholderTextColor="#94A3B8"
                autoCapitalize="characters"
                style={styles.input}
              />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <Pressable
                  onPress={() => { setDeleteOpen(false); setDeletePwd(""); setDeleteConfirm(""); }}
                  style={[styles.secondaryBtn, { flex: 1 }]}
                  disabled={deleteBusy}
                >
                  <Text style={styles.secondaryBtnTxt}>Annulla</Text>
                </Pressable>
                <Pressable
                  testID="delete-account-confirm-btn"
                  onPress={doDeleteAccount}
                  disabled={deleteBusy}
                  style={[styles.deleteConfirmBtn, deleteBusy && { opacity: 0.7 }]}
                >
                  {deleteBusy ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="trash" size={16} color="#FFF" />
                      <Text style={styles.deleteConfirmBtnTxt}>Elimina definitivamente</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "700", color: theme.color.onSurface },
  card: { backgroundColor: "#FFF", borderRadius: theme.radius.md, padding: 16, borderWidth: 1, borderColor: theme.color.border },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  cardSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoTxt: { fontSize: 13, color: theme.color.muted },
  hint: { fontSize: 13, color: theme.color.onSurfaceTertiary },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.color.border, color: theme.color.onSurface },
  primaryBtn: { backgroundColor: theme.color.brandPrimary, borderRadius: theme.radius.md, paddingVertical: 12, alignItems: "center" },
  primaryBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FFF", paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.brandPrimary, borderRadius: theme.radius.md },
  secondaryBtnTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 13 },
  linkBtn: { alignItems: "center", paddingVertical: 8 },
  linkBtnTxt: { color: theme.color.brandPrimary, fontWeight: "600", fontSize: 13 },
  secretBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, borderRadius: 8, padding: 10 },
  secretText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, color: theme.color.onSurface },
  codeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 12 },
  codeChip: { backgroundColor: "#FEF3C7", borderColor: "#F59E0B", borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  codeChipTxt: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "700", color: "#78350F", fontSize: 13 },
  trustBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brandTertiary, padding: 8, borderRadius: 8, marginTop: 8 },
  trustTxt: { color: theme.color.brandPrimary, fontSize: 12, fontWeight: "600", flex: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.color.border, marginTop: 10 },
  toggleLabel: { fontSize: 14, fontWeight: "600", color: theme.color.onSurface },
  toggleSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: "#E2E8F0", justifyContent: "center", padding: 3 },
  toggleOn: { backgroundColor: theme.color.brandPrimary },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFF" },
  toggleKnobOn: { transform: [{ translateX: 18 }] },
  smallBtn: { backgroundColor: theme.color.brandPrimary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  smallBtnTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },
  smallBtnDanger: { backgroundColor: theme.color.error, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  smallBtnDangerTxt: { color: "#FFF", fontWeight: "700", fontSize: 12 },

  /* V29.b · Danger zone */
  dangerCard: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  dangerHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dangerTitle: { fontSize: 15, fontWeight: "800", color: "#991B1B", letterSpacing: -0.2 },
  dangerDesc: { fontSize: 12.5, color: "#7F1D1D", lineHeight: 18 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DC2626",
    backgroundColor: "#FFF",
  },
  deleteBtnTxt: { color: "#DC2626", fontWeight: "800", fontSize: 14 },
  deleteForm: { gap: 4, marginTop: 4 },
  deleteLabel: { fontSize: 12, color: "#7F1D1D", fontWeight: "700", marginBottom: 4 },
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    letterSpacing: 0.5,
    fontWeight: "800",
    color: "#991B1B",
  },
  deleteConfirmBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#DC2626",
  },
  deleteConfirmBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});
