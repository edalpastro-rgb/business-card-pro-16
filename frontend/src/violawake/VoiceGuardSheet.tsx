// VoiceGuardSheet.tsx — V50.z371 — Foglio PIN (6 cifre) per confermare i comandi critici vocali quando impronta/Face ID
// non è disponibile o fallisce. Montato una volta in app/_layout.tsx. Impostazione PIN: <VoiceGuardPinCard/> (Impostazioni → Voce).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { notify } from "@/src/utils/notify";
import { guardStore } from "@/src/violawake/guard";
import { HT } from "@/src/homeTheme";

export function VoiceGuardSheet() {
  const [, force] = useState(0);
  const [pin, setPin] = useState("");
  useEffect(() => guardStore.subscribe(() => { setPin(""); force((n) => n + 1); }), []);
  const req = guardStore.get();
  if (!req) return null;
  const done = (v: string | null) => { const r = req; guardStore.set(null); r.resolve(v); };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => done(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.back}>
        <View style={styles.card} testID="voice-guard-sheet">
          <View style={styles.icon}><Ionicons name="shield-checkmark" size={22} color="#FFF" /></View>
          <Text style={styles.title}>Conferma comando critico</Text>
          <Text style={styles.sub}>Axon non esegue cancellazioni, modifiche alle impostazioni o accessi a dati sensibili solo a voce. Inserisci il PIN a 6 cifre.</Text>
          <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus placeholder="••••••" placeholderTextColor={HT.muted} style={styles.input} testID="voice-guard-pin" />
          {req.error ? <Text style={styles.err}>{req.error}</Text> : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => done(null)} style={[styles.btn, styles.ghost]} testID="voice-guard-cancel"><Text style={[styles.btnTxt, { color: HT.text }]}>Annulla</Text></Pressable>
            <Pressable onPress={() => pin.length === 6 && done(pin)} style={[styles.btn, pin.length < 6 && { opacity: 0.5 }]} testID="voice-guard-ok"><Text style={styles.btnTxt}>Conferma</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Impostazioni → Voce: imposta / cambia il PIN dei comandi critici. */
export function VoiceGuardPinCard() {
  const [has, setHas] = useState<boolean | null>(null);
  const [cur, setCur] = useState(""); const [pin, setPin] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ has_pin: boolean }>("/voice-guard").then((r) => setHas(r.has_pin)).catch(() => setHas(false)); }, []);
  const save = async () => {
    if (pin.length !== 6 || busy) return;
    setBusy(true);
    try { await api("/voice-guard/pin", { method: "PUT", body: { pin, current_pin: has ? cur : undefined } }); setHas(true); setPin(""); setCur(""); notify("PIN comandi critici salvato"); }
    catch (e: any) { notify(e?.message || "Errore salvataggio PIN"); } finally { setBusy(false); }
  };
  return (
    <View style={styles.pinCard} testID="voice-guard-pin-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={[styles.icon, { width: 36, height: 36, borderRadius: 10 }]}><Ionicons name="keypad" size={18} color="#FFF" /></View>
        <View style={{ flex: 1 }}><Text style={styles.pinTitle}>PIN comandi critici</Text><Text style={styles.pinSub}>{has ? "PIN impostato · usato se impronta/Face ID non è disponibile" : "Nessun PIN: i comandi critici a voce chiederanno impronta/Face ID, altrimenti verranno rifiutati"}</Text></View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {has ? <TextInput value={cur} onChangeText={(v) => setCur(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry placeholder="PIN attuale" placeholderTextColor={HT.muted} style={[styles.input, styles.small]} testID="voice-guard-current" /> : null}
        <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" secureTextEntry placeholder={has ? "Nuovo PIN" : "PIN 6 cifre"} placeholderTextColor={HT.muted} style={[styles.input, styles.small]} testID="voice-guard-new" />
        <Pressable onPress={save} disabled={pin.length !== 6 || busy} style={[styles.btn, { minWidth: 92 }, (pin.length !== 6 || busy) && { opacity: 0.5 }]} testID="voice-guard-save"><Text style={styles.btnTxt}>{has ? "Cambia" : "Imposta"}</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 22 },
  card: { backgroundColor: HT.card, borderRadius: 20, padding: 20, gap: 12, alignItems: "center" },
  icon: { width: 48, height: 48, borderRadius: 14, backgroundColor: HT.danger, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "900", color: HT.text }, sub: { fontSize: 13, color: HT.muted, textAlign: "center", lineHeight: 18 },
  input: { borderWidth: 1, borderColor: HT.border, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 22, letterSpacing: 8, color: HT.text, backgroundColor: HT.card2, textAlign: "center", width: "100%" },
  small: { flex: 1, fontSize: 16, letterSpacing: 3, width: undefined },
  err: { color: HT.danger, fontWeight: "700", fontSize: 12 },
  btn: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: HT.violet, paddingHorizontal: 12 },
  ghost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border }, btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  pinCard: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 12, marginTop: 14 },
  pinTitle: { fontSize: 15, fontWeight: "900", color: HT.text }, pinSub: { fontSize: 12, color: HT.muted, lineHeight: 17 },
});
