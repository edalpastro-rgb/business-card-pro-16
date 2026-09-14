// PersonalLockGate.tsx — V50.z237 — Cancello PIN 6 cifre (+ impronta/Face ID) per «Spazio Personale».
// Primo accesso: imposta PIN (2 passaggi). Aperture successive: PIN richiesto prima di mostrare i contenuti.
// Biometria (se il dispositivo la supporta) come alternativa al PIN. «Ho dimenticato il PIN» → codice via email → nuovo PIN.
// Il PIN vive sul server (bcrypt): vale su tutti i dispositivi. La preferenza biometria è locale (secure storage).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Platform, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { LockKeyIcon } from "@/src/LockKeyIcon";

const GREEN = "#059669";
const NAVY = "#1B2B4B";
const BIO_KEY = "personal_space_bio_enabled_v1";

type Status = { configured: boolean; attempts_left: number; locked_for_seconds: number; email?: string };
type Mode = "loading" | "setup" | "setup-confirm" | "setup-bio" | "verify" | "forgot" | "error";

export async function personalSpaceBioEnabled(): Promise<boolean> {
  return !!(await storage.secureGet<boolean>(BIO_KEY, false));
}
export async function setPersonalSpaceBioEnabled(v: boolean) {
  await storage.secureSet(BIO_KEY, v);
}

async function bioSupported(): Promise<{ ok: boolean; label: string }> {
  if (Platform.OS === "web") return { ok: false, label: "" };
  try {
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = hw && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) return { ok: false, label: "" };
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const label = face ? (Platform.OS === "ios" ? "Face ID" : "Riconoscimento volto") : Platform.OS === "ios" ? "Touch ID" : "Impronta digitale";
    return { ok: true, label };
  } catch {
    return { ok: false, label: "" };
  }
}

function PinField({ value, onChange, onFilled, autoFocus, testID, disabled }: { value: string; onChange: (v: string) => void; onFilled?: (v: string) => void; autoFocus?: boolean; testID: string; disabled?: boolean }) {
  const ref = useRef<TextInput>(null);
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 250); }, [autoFocus]);
  return (
    <Pressable onPress={() => ref.current?.focus()} style={styles.pinWrap} testID={`${testID}-boxes`}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} style={[styles.pinBox, i < value.length && styles.pinBoxFilled, i === value.length && styles.pinBoxActive]}>
          {i < value.length ? <View style={styles.pinDot} /> : null}
        </View>
      ))}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => {
          const d = t.replace(/\D/g, "").slice(0, 6);
          onChange(d);
          if (d.length === 6 && onFilled) onFilled(d);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={6}
        secureTextEntry
        autoComplete="off"
        textContentType="oneTimeCode"
        editable={!disabled}
        style={styles.pinHidden}
        testID={testID}
        caretHidden
      />
    </Pressable>
  );
}

export function PersonalLockGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState<{ ok: boolean; label: string }>({ ok: false, label: "" });
  const [bioOn, setBioOn] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [lockLeft, setLockLeft] = useState(0);

  const tryBio = useCallback(async () => {
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Sblocca Spazio Personale", fallbackLabel: "Usa PIN", cancelLabel: "Annulla", disableDeviceFallback: true });
      if (r.success) onUnlocked();
    } catch {}
  }, [onUnlocked]);

  const init = useCallback(async () => {
    setMode("loading"); setErr(null);
    try {
      const [st, b, on] = await Promise.all([api<Status>("/personal-space/lock/status"), bioSupported(), personalSpaceBioEnabled()]);
      setBio(b); setBioOn(on);
      setLockLeft(st.locked_for_seconds || 0);
      if (!st.configured) setMode("setup");
      else {
        setMode("verify");
        if (b.ok && on && !(st.locked_for_seconds > 0)) void tryBio();
      }
    } catch (e: any) {
      setErr(e?.message || "Impossibile verificare il PIN"); setMode("error");
    }
  }, [tryBio]);
  useEffect(() => { void init(); }, [init]);

  // countdown blocco temporaneo
  useEffect(() => {
    if (lockLeft <= 0) return;
    const t = setInterval(() => setLockLeft((v) => (v > 1 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [lockLeft]);

  const reset = () => { setPin(""); setPin2(""); setErr(null); };

  const doSetup = async (confirm: string) => {
    if (confirm !== pin) { setErr("I due PIN non coincidono. Riprova."); setPin2(""); return; }
    setBusy(true); setErr(null);
    try {
      await api("/personal-space/lock/set", { method: "POST", body: { pin } });
      if (bio.ok) setMode("setup-bio"); else onUnlocked();
    } catch (e: any) { setErr(e?.message || "Errore"); setPin(""); setPin2(""); setMode("setup"); }
    finally { setBusy(false); }
  };

  const doVerify = async (v: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ ok: boolean; attempts_left: number; locked_for_seconds?: number }>("/personal-space/lock/verify", { method: "POST", body: { pin: v } });
      if (r.ok) { onUnlocked(); return; }
      setPin("");
      if (r.locked_for_seconds) { setLockLeft(r.locked_for_seconds); setErr("Troppi tentativi: accesso bloccato temporaneamente."); }
      else setErr(`PIN non corretto. Tentativi rimasti: ${r.attempts_left}`);
    } catch (e: any) {
      setPin("");
      const m = e?.message || "Errore";
      setErr(m);
      const mm = /(\d+)\s*min/.exec(m); if (mm) setLockLeft(parseInt(mm[1], 10) * 60);
    } finally { setBusy(false); }
  };

  const doForgot = async () => {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await api<{ ok: boolean; sent_to: string; expires_in_minutes: number }>("/personal-space/lock/forgot", { method: "POST" });
      setSentTo(r.sent_to); setCode(""); setPin(""); setPin2(""); setMode("forgot");
      setInfo(`Codice inviato a ${r.sent_to}. Vale ${r.expires_in_minutes} minuti.`);
    } catch (e: any) { setErr(e?.message || "Invio email non riuscito"); }
    finally { setBusy(false); }
  };

  const doReset = async () => {
    if (code.length !== 6) { setErr("Inserisci il codice a 6 cifre ricevuto via email."); return; }
    if (pin.length !== 6) { setErr("Scegli un nuovo PIN a 6 cifre."); return; }
    if (pin !== pin2) { setErr("I due PIN non coincidono."); return; }
    setBusy(true); setErr(null);
    try {
      await api("/personal-space/lock/reset", { method: "POST", body: { code, new_pin: pin } });
      onUnlocked();
    } catch (e: any) { setErr(e?.message || "Errore"); }
    finally { setBusy(false); }
  };

  const Header = ({ title, sub }: { title: string; sub: string }) => (
    <View style={styles.head}>
      <View style={styles.badge}><LockKeyIcon size={34} color="#FFF" /></View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
    </View>
  );

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="personal-lock-gate">
      {mode === "loading" ? <ActivityIndicator color={GREEN} style={{ marginTop: 60 }} /> : null}

      {mode === "error" ? (
        <>
          <Header title="Spazio Personale" sub="Non riesco a verificare il PIN in questo momento." />
          <Text style={styles.err}>{err}</Text>
          <Pressable onPress={init} style={styles.primaryBtn} testID="lock-retry"><Text style={styles.primaryTxt}>Riprova</Text></Pressable>
        </>
      ) : null}

      {mode === "setup" || mode === "setup-confirm" ? (
        <>
          <Header title={mode === "setup" ? "Crea il tuo PIN" : "Conferma il PIN"} sub={mode === "setup" ? "Proteggi lo Spazio Personale con un PIN a 6 cifre. Ti verrà chiesto ad ogni apertura." : "Digita di nuovo lo stesso PIN per confermarlo."} />
          {mode === "setup" ? (
            <PinField key="setup" value={pin} onChange={setPin} autoFocus testID="lock-pin-setup" onFilled={() => { setErr(null); setMode("setup-confirm"); }} />
          ) : (
            <PinField key="confirm" value={pin2} onChange={setPin2} autoFocus testID="lock-pin-confirm" onFilled={(v) => void doSetup(v)} disabled={busy} />
          )}
          {err ? <Text style={styles.err} testID="lock-error">{err}</Text> : null}
          {busy ? <ActivityIndicator color={GREEN} /> : null}
          {mode === "setup-confirm" ? (
            <Pressable onPress={() => { reset(); setMode("setup"); }} style={styles.linkBtn} testID="lock-setup-back"><Text style={styles.linkTxt}>Ricomincia</Text></Pressable>
          ) : (
            <Text style={styles.hint}>Evita sequenze (123456) o cifre tutte uguali.</Text>
          )}
        </>
      ) : null}

      {mode === "setup-bio" ? (
        <>
          <Header title={`Attivare ${bio.label}?`} sub={`Potrai aprire lo Spazio Personale con ${bio.label} invece di digitare il PIN. Il PIN resta sempre disponibile.`} />
          <Pressable onPress={async () => { await setPersonalSpaceBioEnabled(true); onUnlocked(); }} style={styles.primaryBtn} testID="lock-bio-yes">
            <Ionicons name="finger-print" size={18} color="#FFF" /><Text style={styles.primaryTxt}>Sì, attiva {bio.label}</Text>
          </Pressable>
          <Pressable onPress={async () => { await setPersonalSpaceBioEnabled(false); onUnlocked(); }} style={styles.linkBtn} testID="lock-bio-no"><Text style={styles.linkTxt}>No, solo PIN</Text></Pressable>
        </>
      ) : null}

      {mode === "verify" ? (
        <>
          <Header title="Spazio Personale" sub={lockLeft > 0 ? `Accesso bloccato per troppi tentativi. Riprova tra ${mmss(lockLeft)} oppure reimposta il PIN.` : "Inserisci il PIN a 6 cifre per continuare."} />
          <PinField key="verify" value={pin} onChange={setPin} autoFocus={!(bio.ok && bioOn)} testID="lock-pin-verify" onFilled={(v) => void doVerify(v)} disabled={busy || lockLeft > 0} />
          {busy ? <ActivityIndicator color={GREEN} /> : null}
          {err ? <Text style={styles.err} testID="lock-error">{err}</Text> : null}
          {bio.ok ? (
            <Pressable onPress={tryBio} style={styles.secondaryBtn} testID="lock-bio-btn">
              <Ionicons name={bio.label.toLowerCase().includes("face") || bio.label.toLowerCase().includes("volto") ? "scan" : "finger-print"} size={20} color={GREEN} />
              <Text style={styles.secondaryTxt}>Usa {bio.label}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={doForgot} disabled={busy} style={styles.linkBtn} testID="lock-forgot"><Text style={styles.linkTxt}>Ho dimenticato il PIN</Text></Pressable>
        </>
      ) : null}

      {mode === "forgot" ? (
        <>
          <Header title="Reimposta il PIN" sub={`Ti abbiamo inviato un codice a 6 cifre a ${sentTo || "l'email del tuo account"}. Inseriscilo e scegli un nuovo PIN.`} />
          {info ? <Text style={styles.info} testID="lock-forgot-info">{info}</Text> : null}
          <Text style={styles.fieldLabel}>Codice ricevuto via email</Text>
          <TextInput value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" inputMode="numeric" maxLength={6} style={styles.codeInput} placeholder="••••••" placeholderTextColor="#94A3B8" testID="lock-reset-code" autoFocus />
          <Text style={styles.fieldLabel}>Nuovo PIN</Text>
          <PinField key="reset-pin" value={pin} onChange={setPin} testID="lock-reset-pin" />
          <Text style={styles.fieldLabel}>Conferma nuovo PIN</Text>
          <PinField key="reset-pin2" value={pin2} onChange={setPin2} testID="lock-reset-pin2" />
          {err ? <Text style={styles.err} testID="lock-error">{err}</Text> : null}
          <Pressable onPress={doReset} disabled={busy} style={[styles.primaryBtn, busy && { opacity: 0.6 }]} testID="lock-reset-submit">
            {busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark-circle" size={18} color="#FFF" /><Text style={styles.primaryTxt}>Salva nuovo PIN</Text></>}
          </Pressable>
          <Pressable onPress={doForgot} disabled={busy} style={styles.linkBtn} testID="lock-resend"><Text style={styles.linkTxt}>Non ho ricevuto il codice, invia di nuovo</Text></Pressable>
          <Pressable onPress={() => { reset(); setCode(""); setMode("verify"); }} style={styles.linkBtn} testID="lock-forgot-back"><Text style={[styles.linkTxt, { color: "#64748B" }]}>Torna al PIN</Text></Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

/** V50.z237 — Pannello «Cambia PIN» (usato dall'header di Spazio Personale). */
export function ChangePinPanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [cur, setCur] = useState(""); const [n1, setN1] = useState(""); const [n2, setN2] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState<{ ok: boolean; label: string }>({ ok: false, label: "" }); const [bioOn, setBioOn] = useState(false);
  useEffect(() => { (async () => { setBio(await bioSupported()); setBioOn(await personalSpaceBioEnabled()); })(); }, []);
  const submit = async () => {
    if (cur.length !== 6 || n1.length !== 6) { setErr("Inserisci il PIN attuale e il nuovo PIN (6 cifre)."); return; }
    if (n1 !== n2) { setErr("I due nuovi PIN non coincidono."); return; }
    setBusy(true); setErr(null);
    try { await api("/personal-space/lock/change", { method: "POST", body: { current_pin: cur, new_pin: n1 } }); onDone(); }
    catch (e: any) { setErr(e?.message || "Errore"); }
    finally { setBusy(false); }
  };
  return (
    <View style={styles.sheet} testID="change-pin-panel">
      <Text style={styles.sheetTitle}>Sicurezza Spazio Personale</Text>
      {bio.ok ? (
        <Pressable onPress={async () => { const v = !bioOn; await setPersonalSpaceBioEnabled(v); setBioOn(v); }} style={styles.toggleRow} testID="change-pin-bio-toggle">
          <Ionicons name="finger-print" size={20} color={GREEN} />
          <Text style={styles.toggleLabel}>Sblocca con {bio.label}</Text>
          <View style={[styles.switch, bioOn && styles.switchOn]}><View style={[styles.knob, bioOn && styles.knobOn]} /></View>
        </Pressable>
      ) : null}
      <Text style={styles.fieldLabel}>PIN attuale</Text>
      <PinField value={cur} onChange={setCur} testID="change-pin-current" autoFocus />
      <Text style={styles.fieldLabel}>Nuovo PIN</Text>
      <PinField value={n1} onChange={setN1} testID="change-pin-new" />
      <Text style={styles.fieldLabel}>Conferma nuovo PIN</Text>
      <PinField value={n2} onChange={setN2} testID="change-pin-new2" />
      {err ? <Text style={styles.err} testID="change-pin-error">{err}</Text> : null}
      <Pressable onPress={submit} disabled={busy} style={[styles.primaryBtn, busy && { opacity: 0.6 }]} testID="change-pin-submit">
        {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryTxt}>Salva nuovo PIN</Text>}
      </Pressable>
      <Pressable onPress={onCancel} style={styles.linkBtn} testID="change-pin-cancel"><Text style={[styles.linkTxt, { color: "#64748B" }]}>Annulla</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F0FDF4" },
  content: { padding: 24, paddingTop: 36, gap: 16, alignItems: "stretch" },
  head: { alignItems: "center", gap: 8, marginBottom: 8 },
  badge: { width: 72, height: 72, borderRadius: 24, backgroundColor: GREEN, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  title: { fontSize: 22, fontWeight: "900", color: NAVY, textAlign: "center" },
  sub: { fontSize: 13.5, color: "#475569", textAlign: "center", lineHeight: 19, paddingHorizontal: 8 },
  pinWrap: { flexDirection: "row", justifyContent: "center", gap: 10, position: "relative", minHeight: 56 },
  pinBox: { width: 44, height: 54, borderRadius: 12, borderWidth: 1.5, borderColor: "#CBD5E1", backgroundColor: "#FFF", alignItems: "center", justifyContent: "center" },
  pinBoxFilled: { borderColor: GREEN },
  pinBoxActive: { borderColor: GREEN, borderWidth: 2 },
  pinDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: NAVY },
  pinHidden: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.01, fontSize: 1, color: "transparent" },
  err: { color: "#DC2626", fontWeight: "700", textAlign: "center", fontSize: 13 },
  info: { color: "#065F46", fontWeight: "700", textAlign: "center", fontSize: 13, backgroundColor: "#D1FAE5", padding: 10, borderRadius: 10 },
  hint: { color: "#64748B", fontSize: 12, textAlign: "center" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: GREEN, minHeight: 50, borderRadius: 14, paddingHorizontal: 16 },
  primaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FFF", borderWidth: 1.5, borderColor: GREEN, minHeight: 48, borderRadius: 14 },
  secondaryTxt: { color: GREEN, fontWeight: "800", fontSize: 14 },
  linkBtn: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  linkTxt: { color: GREEN, fontWeight: "800", fontSize: 14, textDecorationLine: "underline" },
  fieldLabel: { fontSize: 12, fontWeight: "800", color: "#475569", marginTop: 4, marginBottom: -6 },
  codeInput: { backgroundColor: "#FFF", borderWidth: 1.5, borderColor: "#CBD5E1", borderRadius: 12, minHeight: 54, textAlign: "center", fontSize: 24, letterSpacing: 10, fontWeight: "800", color: NAVY },
  sheet: { backgroundColor: "#FFF", borderRadius: 20, padding: 20, gap: 14 },
  sheetTitle: { fontSize: 17, fontWeight: "900", color: NAVY, textAlign: "center" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#ECFDF5", borderRadius: 12, padding: 12, minHeight: 48 },
  toggleLabel: { flex: 1, fontWeight: "800", color: NAVY, fontSize: 14 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: "#CBD5E1", padding: 3 },
  switchOn: { backgroundColor: GREEN },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFF" },
  knobOn: { alignSelf: "flex-end" },
});
