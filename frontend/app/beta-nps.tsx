// app/beta-nps.tsx — V50.z474 — Sondaggio NPS in-app (Beta sul campo): punteggio 0-10, «lo consiglieresti?», cosa ha funzionato /
// cosa ti ha fatto arrabbiare, fascia di prezzo (solo se il Master ha attivato la domanda). Una risposta per utente per ondata.
// Aperto da: Help › «Dicci la tua», avviso in Home quando il Master attiva un'ondata, Axon ([[NAV:/beta-nps|…]]).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";
import { track } from "@/src/utils/beta";

type Status = { show: boolean; wave: number; ask_price: boolean };
const TIERS: { v: number; l: string; d: string }[] = [{ v: 0, l: "Non pagherei", d: "lo userei solo gratis" }, { v: 19, l: "19 €/mese", d: "base" }, { v: 29, l: "29 €/mese", d: "con Axon completo" }, { v: 49, l: "49 €/mese", d: "con team e Master" }];

export default function BetaNpsScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [rec, setRec] = useState<boolean | null>(null);
  const [tier, setTier] = useState<number | null>(null);
  const [best, setBest] = useState("");
  const [worst, setWorst] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { api<Status>("/beta/nps/status").then((s) => { setStatus(s); track("nps_shown", { wave: s.wave }); }).catch(() => setStatus({ show: true, wave: 1, ask_price: false })); }, []);

  const submit = async () => {
    if (score === null) { notify("Manca il punteggio", "Scegli un numero da 0 a 10"); return; }
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/beta/nps", { method: "POST", body: { wave: status?.wave || 1, score, would_recommend: rec, price_tier: status?.ask_price ? tier : null, best, worst } });
      setDone(true); notify("Grazie!", r.message);
    } catch (e: any) { notify("Invio non riuscito", e?.message || "Riprova"); }
    finally { setBusy(false); }
  };

  const scoreColor = (n: number) => (n <= 6 ? HT.danger : n <= 8 ? HT.warning : HT.success);

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as any))} style={s.back} hitSlop={8} testID="nps-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.hTitle}>Dicci la tua</Text><Text style={s.hSub}>2 minuti · le risposte guidano le prossime versioni</Text></View>
      </View>
      {!status ? <ActivityIndicator style={{ marginTop: 40 }} color={HT.brand} /> : done ? (
        <View style={s.center} testID="nps-done">
          <Ionicons name="heart-circle" size={56} color={HT.success} />
          <Text style={s.doneTitle}>Grazie!</Text>
          <Text style={s.doneTxt}>Il tuo parere è arrivato al Master e al team. Se ti viene in mente altro, trovi sempre «Segnala un problema» e «Invia un consiglio» nel tab Help.</Text>
          <Pressable onPress={() => router.back()} style={s.primary} testID="nps-close"><Text style={s.primaryTxt}>Chiudi</Text></Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" testID="nps-form">
            {!status.show ? <View style={s.note}><Ionicons name="information-circle" size={16} color={HT.muted} /><Text style={s.noteTxt}>Hai già risposto a questa ondata: puoi comunque aggiornare la tua risposta.</Text></View> : null}
            <Text style={s.q}>1. Quanto consiglieresti AdvisorOS a un collega? <Text style={s.qSub}>(0 = per niente · 10 = assolutamente)</Text></Text>
            <View style={s.scoreRow}>
              {Array.from({ length: 11 }, (_, i) => (
                <Pressable key={i} onPress={() => setScore(i)} style={[s.scoreBtn, score === i && { backgroundColor: scoreColor(i), borderColor: scoreColor(i) }]} testID={`nps-score-${i}`}>
                  <Text style={[s.scoreTxt, score === i && { color: "#FFF" }]}>{i}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.q}>2. Lo consiglieresti davvero, oggi?</Text>
            <View style={s.row}>
              {[true, false].map((v) => (
                <Pressable key={String(v)} onPress={() => setRec(v)} style={[s.chip, rec === v && s.chipOn]} testID={`nps-rec-${v ? "yes" : "no"}`}>
                  <Ionicons name={v ? "thumbs-up" : "thumbs-down"} size={16} color={rec === v ? "#FFF" : HT.text} /><Text style={[s.chipTxt, rec === v && { color: "#FFF" }]}>{v ? "Sì" : "Non ancora"}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.q}>3. Cosa ti ha fatto risparmiare più tempo?</Text>
            <TextInput value={best} onChangeText={setBest} placeholder="es. fissare appuntamenti a voce mentre guido" placeholderTextColor={HT.muted} style={s.input} multiline testID="nps-best" />
            <Text style={s.q}>4. Cosa ti ha fatto arrabbiare o hai dovuto fare a mano?</Text>
            <TextInput value={worst} onChangeText={setWorst} placeholder="es. lo scanner su Android, Axon non ha capito…" placeholderTextColor={HT.muted} style={s.input} multiline testID="nps-worst" />
            {status.ask_price ? (
              <>
                <Text style={s.q}>5. Quanto pagheresti al mese per continuare a usarlo?</Text>
                <View style={{ gap: 8 }}>
                  {TIERS.map((t) => (
                    <Pressable key={t.v} onPress={() => setTier(t.v)} style={[s.tier, tier === t.v && s.tierOn]} testID={`nps-tier-${t.v}`}>
                      <Ionicons name={tier === t.v ? "radio-button-on" : "radio-button-off"} size={20} color={tier === t.v ? HT.brand : HT.muted} />
                      <View style={{ flex: 1 }}><Text style={s.tierL}>{t.l}</Text><Text style={s.tierD}>{t.d}</Text></View>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            <Pressable onPress={submit} disabled={busy} style={[s.primary, busy && { opacity: 0.6 }]} testID="nps-submit">
              {busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="send" size={16} color="#FFF" /><Text style={s.primaryTxt}>Invia</Text></>}
            </Pressable>
            <Text style={s.privacy}>Le risposte sono visibili al Master della tua rete e al team AdvisorOS. Nessun dato dei tuoi clienti viene inviato.</Text>
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
  body: { padding: 16, gap: 10, paddingBottom: 60 },
  note: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: HT.card, borderRadius: 10, padding: 10 },
  noteTxt: { flex: 1, fontSize: 12, color: HT.muted },
  q: { fontSize: 15, fontWeight: "800", color: HT.text, marginTop: 10 },
  qSub: { fontSize: 12, fontWeight: "600", color: HT.muted },
  scoreRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  scoreBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card, alignItems: "center", justifyContent: "center" },
  scoreTxt: { fontSize: 15, fontWeight: "800", color: HT.text },
  row: { flexDirection: "row", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card },
  chipOn: { backgroundColor: HT.brand, borderColor: HT.brand },
  chipTxt: { fontSize: 14, fontWeight: "700", color: HT.text },
  input: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.border, borderRadius: 12, padding: 12, color: HT.text, fontSize: 14, minHeight: 72, textAlignVertical: "top" },
  tier: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: HT.border, backgroundColor: HT.card, minHeight: 56 },
  tierOn: { borderColor: HT.brand, backgroundColor: HT.brandTint },
  tierL: { fontSize: 14, fontWeight: "800", color: HT.text },
  tierD: { fontSize: 12, color: HT.muted },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: HT.brand, borderRadius: 14, minHeight: 50, marginTop: 16 },
  primaryTxt: { color: "#FFF", fontWeight: "900", fontSize: 15 },
  privacy: { fontSize: 11, color: HT.muted, textAlign: "center", marginTop: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  doneTitle: { fontSize: 22, fontWeight: "900", color: HT.text },
  doneTxt: { fontSize: 14, color: HT.muted, textAlign: "center", lineHeight: 20 },
});
