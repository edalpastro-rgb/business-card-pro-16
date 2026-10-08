// app/beta-diary.tsx — V50.z475 — «Diario del venerdì» (Programma Beta): 3 domande, 30 secondi. Una voce per settimana (modificabile).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";

const TEAL = "#0F766E";
const QUESTIONS: { key: "saved_time" | "angry" | "manual"; q: string; ph: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "saved_time", q: "Cosa ti ha fatto risparmiare tempo questa settimana?", ph: "es. fissare gli appuntamenti a voce tra un cliente e l'altro", icon: "time-outline" },
  { key: "angry", q: "Cosa ti ha fatto arrabbiare?", ph: "es. Axon non ha capito un nome, lo scanner si è bloccato…", icon: "flame-outline" },
  { key: "manual", q: "Cosa hai fatto a mano che Axon avrebbe potuto fare?", ph: "es. ho scritto io il messaggio di conferma al cliente", icon: "hand-left-outline" },
];

export default function BetaDiaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ week?: string }>();
  const [week, setWeek] = useState<number>(Number(params.week) || 1);
  const [vals, setVals] = useState<Record<string, string>>({ saved_time: "", angry: "", manual: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { if (!params.week) api<{ enrolled: boolean; week?: number }>("/beta/program").then((p) => { if (p.enrolled && p.week) setWeek(p.week); }).catch(() => {}); }, [params.week]);

  const submit = async () => {
    if (!Object.values(vals).some((v) => v.trim())) { notify("Diario vuoto", "Scrivi almeno una risposta, anche una riga."); return; }
    setBusy(true);
    try { const r = await api<{ message: string }>("/beta/diary", { method: "POST", body: { week, ...vals } }); setDone(true); notify("Salvato", r.message); }
    catch (e: any) { notify("Invio non riuscito", e?.message || "Riprova"); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as any))} style={s.back} hitSlop={8} testID="diary-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.hTitle}>Diario del venerdì</Text><Text style={s.hSub}>Settimana {week} di 6 · 30 secondi, anche una riga per domanda</Text></View>
      </View>
      {done ? (
        <View style={s.center} testID="diary-done">
          <Ionicons name="book" size={52} color={TEAL} />
          <Text style={s.doneTitle}>Grazie, segnato.</Text>
          <Text style={s.doneTxt}>Il Master legge i diari il venerdì stesso e li trasforma in correzioni per il rilascio della settimana dopo.</Text>
          <Pressable onPress={() => router.back()} style={s.primary} testID="diary-close"><Text style={s.primaryTxt}>Torna alla Home</Text></Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" testID="diary-form">
            {QUESTIONS.map((qq, i) => (
              <View key={qq.key} style={s.block}>
                <View style={s.qRow}><Ionicons name={qq.icon} size={18} color={TEAL} /><Text style={s.q}>{i + 1}. {qq.q}</Text></View>
                <TextInput value={vals[qq.key]} onChangeText={(t) => setVals((v) => ({ ...v, [qq.key]: t }))} placeholder={qq.ph} placeholderTextColor={HT.muted} style={s.input} multiline testID={`diary-${qq.key}`} />
              </View>
            ))}
            <Pressable onPress={submit} disabled={busy} style={[s.primary, busy && { opacity: 0.6 }]} testID="diary-submit">
              {busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="checkmark" size={18} color="#FFF" /><Text style={s.primaryTxt}>Salva il diario</Text></>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hTitle: { fontSize: 18, fontWeight: "900", color: HT.text },
  hSub: { fontSize: 11.5, color: HT.muted, fontWeight: "600" },
  body: { padding: 16, gap: 14, paddingBottom: 60 },
  block: { gap: 8 },
  qRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  q: { flex: 1, fontSize: 15, fontWeight: "800", color: HT.text },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 12, color: HT.text, fontSize: 14, minHeight: 80, textAlignVertical: "top" },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: TEAL, borderRadius: 14, minHeight: 50, marginTop: 8 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  doneTitle: { fontSize: 22, fontWeight: "900", color: HT.text },
  doneTxt: { fontSize: 14, color: HT.muted, textAlign: "center", lineHeight: 20 },
});
