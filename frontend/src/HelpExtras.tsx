// V50.z464 — Help: avviso pre-segnalazione + modulo «Invia un consiglio» + contatti di supporto (accanto al modulo bug = SupportForm).
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";
import { notify } from "@/src/utils/notify";

export const SUPPORT_EMAIL = "support@advisoros.it";

export function PreReportNotice() {
  return (
    <View style={s.notice} testID="help-pre-report-notice">
      <Ionicons name="alert-circle" size={22} color="#B45309" />
      <View style={{ flex: 1 }}>
        <Text style={s.noticeTitle}>Prima di segnalare un problema prova a:</Text>
        <Text style={s.noticeTxt}>{"1) Riavviare l'app.\n2) Verificare di avere l'ultima versione.\n3) Se persiste, disinstalla e reinstalla."}</Text>
        <Text style={[s.noticeTxt, { fontWeight: "800", marginTop: 4 }]}>Solo dopo invia la segnalazione.</Text>
      </View>
    </View>
  );
}

export function SuggestionForm() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (t.length < 5) { notify("Scrivi il tuo consiglio", "Almeno qualche parola 🙂"); return; }
    setBusy(true);
    try {
      await api("/support/tickets", { method: "POST", body: { checks: ["suggestion"], text: `💡 CONSIGLIO / IDEA: ${t}`, attachments: [] } });
      setSent(true); setText("");
    } catch (e: any) { notify("Invio non riuscito", e?.message); } finally { setBusy(false); }
  };
  return (
    <View style={s.card} testID="help-suggestion-form">
      <View style={s.row}><View style={[s.icon, { backgroundColor: "#F59E0B" }]}><Ionicons name="bulb" size={20} color="#FFF" /></View><View style={{ flex: 1 }}><Text style={s.title}>Invia un consiglio</Text><Text style={s.sub}>Idee, miglioramenti, funzioni che vorresti: arrivano al Master e al team.</Text></View></View>
      {sent ? (
        <View style={s.okBox}><Ionicons name="checkmark-circle" size={18} color={HT.success} /><Text style={{ color: HT.success, fontWeight: "700", flex: 1 }}>Grazie! Il tuo consiglio è stato inviato.</Text><Pressable onPress={() => setSent(false)} hitSlop={8}><Text style={{ color: HT.axon, fontWeight: "700" }}>Un altro</Text></Pressable></View>
      ) : (
        <>
          <TextInput value={text} onChangeText={setText} multiline placeholder="Es. «Vorrei poter esportare i contatti in Excel»…" placeholderTextColor={HT.muted} style={s.input} testID="help-suggestion-text" />
          <Pressable onPress={send} disabled={busy} style={[s.btn, busy && { opacity: 0.5 }]} testID="help-suggestion-send">
            {busy ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="paper-plane" size={16} color="#FFF" /><Text style={s.btnTxt}>Invia consiglio</Text></>}
          </Pressable>
        </>
      )}
    </View>
  );
}

export function SupportContacts({ masterName }: { masterName?: string | null }) {
  const router = useRouter();
  return (
    <View style={s.card} testID="help-support-contacts">
      <View style={s.row}><View style={[s.icon, { backgroundColor: "#0891B2" }]}><Ionicons name="headset" size={20} color="#FFF" /></View><View style={{ flex: 1 }}><Text style={s.title}>Contatti di supporto</Text><Text style={s.sub}>Orari: lun–ven 9:00–18:00 · risposta entro 1 giorno lavorativo</Text></View></View>
      <Pressable onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Supporto AdvisorOS")}`)} style={s.line} testID="help-contact-email">
        <Ionicons name="mail" size={18} color={HT.axon} /><Text style={s.lineTxt}>{SUPPORT_EMAIL}</Text><Ionicons name="open-outline" size={16} color={HT.muted} />
      </Pressable>
      <Pressable onPress={() => router.push("/assistant" as any)} style={s.line} testID="help-contact-axon">
        <Ionicons name="sparkles" size={18} color={HT.axon} /><Text style={s.lineTxt}>Chiedi ad Axon in chat (24/7)</Text><Ionicons name="chevron-forward" size={16} color={HT.muted} />
      </Pressable>
      {masterName ? <View style={s.line}><Ionicons name="person" size={18} color={HT.axon} /><Text style={s.lineTxt}>Il tuo Master: {masterName}</Text></View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  notice: { flexDirection: "row", gap: 10, backgroundColor: "#FEF3C7", borderColor: "#F59E0B", borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  noticeTitle: { fontSize: 14, fontWeight: "900", color: "#92400E" },
  noticeTxt: { fontSize: 13, color: "#92400E", lineHeight: 19, marginTop: 2 },
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: HT.border, marginBottom: 10, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  input: { minHeight: 80, borderWidth: 1, borderColor: HT.border, borderRadius: 10, padding: 12, color: HT.text, backgroundColor: HT.bg, textAlignVertical: "top", fontSize: 15 },
  btn: { minHeight: 46, borderRadius: 12, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  btnTxt: { color: "#FFF", fontWeight: "800" },
  okBox: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 4 },
  lineTxt: { flex: 1, fontSize: 14, color: HT.text, fontWeight: "600" },
});
