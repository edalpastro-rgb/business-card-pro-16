// CostIndicators.tsx — V50.z517 — INDICATORI DI COSTO nella chat Axon (testo e vocale).
//  • SessionLight      → semaforo verde/giallo/rosso vicino alla barra di input (pesantezza della sessione = n. messaggi)
//  • HeavySessionBox   → avviso automatico dopo 15 messaggi con «Avvia Nuova Chat»
//  • VoiceSessionMeter → chat vocale: timer di sessione + efficienza (verde/giallo/rosso) + «Pulisci Memoria»
//  • CostTipsCard      → card informativa al primo accesso (AsyncStorage `axon_cost_tips_seen_v1`)
// Il backend invia al modello solo gli ultimi 10 messaggi (sliding window): oltre quella soglia il contesto non cresce più,
// ma ogni richiesta porta comunque il massimo di cronologia → conviene ripartire con una chat nuova.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { CT } from "@/src/assistant/chatTheme";

export const HEAVY_SESSION_MSGS = 15; // soglia avviso «Avvia Nuova Chat»
export const WINDOW_MSGS = 10; // finestra scorrevole lato backend

export type Weight = "green" | "yellow" | "red";
export const sessionWeight = (count: number): Weight => (count < WINDOW_MSGS ? "green" : count < HEAVY_SESSION_MSGS ? "yellow" : "red");
const W_COLOR: Record<Weight, string> = { green: CT.success, yellow: CT.warning, red: CT.danger };
const W_LABEL: Record<Weight, string> = { green: "Sessione leggera", yellow: "Sessione media", red: "Sessione pesante" };

export function SessionLight({ count, compact }: { count: number; compact?: boolean }) {
  const w = sessionWeight(count);
  return (
    <View style={s.lightRow} testID="axon-session-light" accessibilityLabel={`${W_LABEL[w]}: ${count} messaggi`}>
      <View style={[s.dot, { backgroundColor: W_COLOR[w] }]} />
      {!compact ? <Text style={s.lightTxt}>{W_LABEL[w]} · {count} msg{count >= WINDOW_MSGS ? ` · al modello solo gli ultimi ${WINDOW_MSGS}` : ""}</Text> : null}
    </View>
  );
}

export function HeavySessionBox({ count, onNewChat }: { count: number; onNewChat: () => void }) {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  if (count < HEAVY_SESSION_MSGS || (dismissedAt != null && count < dismissedAt + 10)) return null; // ricompare ogni 10 messaggi
  return (
    <View style={s.box} testID="axon-heavy-session-box">
      <Ionicons name="speedometer" size={18} color={CT.danger} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.boxTitle}>Conversazione lunga ({count} messaggi)</Text>
        <Text style={s.boxTxt}>Ogni risposta ora costa il massimo. Una chat nuova è più veloce ed economica: Axon ricorda comunque ciò che ha imparato di te.</Text>
      </View>
      <View style={{ gap: 6 }}>
        <Pressable onPress={onNewChat} style={s.boxBtn} testID="axon-heavy-new-chat"><Ionicons name="add-circle" size={15} color="#FFF" /><Text style={s.boxBtnTxt}>Avvia Nuova Chat</Text></Pressable>
        <Pressable onPress={() => setDismissedAt(count)} hitSlop={8} style={s.boxGhost} testID="axon-heavy-dismiss"><Text style={s.boxGhostTxt}>Continua qui</Text></Pressable>
      </View>
    </View>
  );
}

const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

/** Chat vocale: timer dall'avvio + efficienza (messaggi scambiati rispetto ai minuti) + «Pulisci Memoria». */
export function VoiceSessionMeter({ startedAt, count, onClearMemory, clearing }: { startedAt: number; count: number; onClearMemory: () => void; clearing?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  // efficienza: verde finché la sessione è corta e il contesto è sotto la finestra; giallo oltre i 10 msg o 10 min; rosso oltre 15 msg o 20 min
  const eff: Weight = count >= HEAVY_SESSION_MSGS || sec >= 1200 ? "red" : count >= WINDOW_MSGS || sec >= 600 ? "yellow" : "green";
  const effLabel: Record<Weight, string> = { green: "Efficienza alta", yellow: "Efficienza media", red: "Efficienza bassa" };
  return (
    <View style={s.meter} testID="axon-voice-meter">
      <View style={s.meterCol}><Ionicons name="time-outline" size={14} color={CT.text2} /><Text style={s.meterTxt} testID="axon-voice-timer">{fmt(sec)}</Text></View>
      <View style={s.meterCol}><View style={[s.dot, { backgroundColor: W_COLOR[eff] }]} /><Text style={s.meterTxt} testID="axon-voice-efficiency">{effLabel[eff]} · {count} msg</Text></View>
      <Pressable onPress={onClearMemory} disabled={clearing} style={[s.clearBtn, clearing && { opacity: 0.6 }]} testID="axon-voice-clear-memory" accessibilityLabel="Pulisci memoria della conversazione">
        <Ionicons name="refresh-circle" size={15} color={CT.accent} /><Text style={s.clearTxt}>{clearing ? "Pulisco…" : "Pulisci Memoria"}</Text>
      </Pressable>
    </View>
  );
}

const TIPS_KEY = "axon_cost_tips_seen_v1";
export function CostTipsCard() {
  const [show, setShow] = useState(false);
  useEffect(() => { AsyncStorage.getItem(TIPS_KEY).then((v) => setShow(v !== "1")).catch(() => {}); }, []);
  if (!show) return null;
  const close = () => { setShow(false); AsyncStorage.setItem(TIPS_KEY, "1").catch(() => {}); };
  return (
    <View style={s.tips} testID="axon-cost-tips">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="leaf" size={18} color={CT.success} />
        <Text style={s.tipsTitle}>Come usare Axon al meglio (e spendere meno)</Text>
        <Pressable onPress={close} hitSlop={10} testID="axon-cost-tips-close" accessibilityLabel="Chiudi"><Ionicons name="close" size={18} color={CT.muted} /></Pressable>
      </View>
      <Text style={s.tipsTxt}>• Il semaforo accanto alla barra mostra quanto è «pesante» la chat: <Text style={{ color: CT.success, fontWeight: "800" }}>verde</Text> leggera, <Text style={{ color: CT.warning, fontWeight: "800" }}>giallo</Text> media, <Text style={{ color: CT.danger, fontWeight: "800" }}>rosso</Text> pesante.</Text>
      <Text style={s.tipsTxt}>• Axon rilegge solo gli ultimi {WINDOW_MSGS} messaggi: per cambiare argomento apri una <Text style={s.b}>Nuova chat</Text> — è più veloce ed economica.</Text>
      <Text style={s.tipsTxt}>• Nella chat vocale usa <Text style={s.b}>Pulisci Memoria</Text> per azzerare il contesto senza chiudere la sessione.</Text>
      <Text style={s.tipsTxt}>• Una richiesta chiara e completa costa meno di tre richieste a pezzi.</Text>
      <Pressable onPress={close} style={s.tipsBtn} testID="axon-cost-tips-ok"><Text style={s.tipsBtnTxt}>Ho capito</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  lightRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingTop: 4 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  lightTxt: { fontSize: 11, color: CT.muted, fontWeight: "600" },
  box: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 12, marginTop: 6, padding: 10, borderRadius: 14, backgroundColor: CT.surface, borderWidth: 1, borderColor: CT.danger },
  boxTitle: { fontSize: 13, fontWeight: "800", color: CT.text },
  boxTxt: { fontSize: 12, lineHeight: 16, color: CT.text2 },
  boxBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: CT.accent, borderRadius: 10, paddingHorizontal: 10, minHeight: 36, justifyContent: "center" },
  boxBtnTxt: { color: "#FFF", fontSize: 12, fontWeight: "800" },
  boxGhost: { minHeight: 28, alignItems: "center", justifyContent: "center" },
  boxGhostTxt: { color: CT.muted, fontSize: 11.5, fontWeight: "700" },
  meter: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8 },
  meterCol: { flexDirection: "row", alignItems: "center", gap: 5 },
  meterTxt: { fontSize: 12.5, color: CT.text2, fontWeight: "700", fontVariant: ["tabular-nums"] },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: CT.borderGhost, borderRadius: 999, paddingHorizontal: 12, minHeight: 36 },
  clearTxt: { color: CT.accent, fontSize: 12.5, fontWeight: "800" },
  tips: { marginHorizontal: 12, marginTop: 6, padding: 12, gap: 6, borderRadius: 14, backgroundColor: CT.surface, borderWidth: 1, borderColor: CT.border },
  tipsTitle: { flex: 1, fontSize: 13.5, fontWeight: "800", color: CT.text },
  tipsTxt: { fontSize: 12.5, lineHeight: 18, color: CT.text2 },
  b: { fontWeight: "800", color: CT.text },
  tipsBtn: { alignSelf: "flex-end", backgroundColor: CT.accentTint, borderRadius: 10, paddingHorizontal: 14, minHeight: 36, justifyContent: "center", marginTop: 2 },
  tipsBtnTxt: { color: CT.accent, fontWeight: "800", fontSize: 13 },
});
