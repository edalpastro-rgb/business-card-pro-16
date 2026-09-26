/**
 * V50.v — Wake Word "Axon" — Impostazioni & Placeholder
 *
 * Fase 1 in corso: infrastruttura preparata (onnxruntime-react-native installato,
 * config plugin aggiunto). L'inferenza continua richiede un modulo nativo custom
 * (Android AudioRecord + iOS AVAudioEngine → ONNX Runtime) che verrà completato
 * nella prossima sessione. Qui l'utente vede lo stato e attiva la funzione
 * quando pronta.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Switch, ScrollView, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WakeWordService } from "@/src/wakeword/WakeWordService";
import { theme } from "@/src/theme";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const WAKE_ENABLED_KEY = "wake_word_enabled_v1";
const WAKE_MODEL_KEY = "wake_word_model_v1"; // "hey_jarvis" | "axon_custom"
// V50.w — Modello Axon custom addestrato dall'utente su ViolaWake (Job #253)
//   • Architettura: TemporalCNN
//   • Framework: PyTorch 2.1 → export ONNX
//   • Corpus: 154 positivi + 2920 negativi
//   • Size: ~100 KB (leggerissimo)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AXON_MODEL = require("@/assets/wake/axon.onnx");
// Riferimento all'asset per essere sicuri che Metro lo bundle
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _AXON_MODEL_REF = AXON_MODEL;

export default function WakeWordSettingsScreen() {
  const router = useRouter();
  // V50.x — usa la utility globale per non essere coperti dalla tab bar
  const bottomPad = usePageBottomPadding();
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState<"hey_jarvis" | "axon_custom">("hey_jarvis");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [e, m] = await Promise.all([
          AsyncStorage.getItem(WAKE_ENABLED_KEY),
          AsyncStorage.getItem(WAKE_MODEL_KEY),
        ]);
        setEnabled(e === "1");
        if (m === "axon_custom") setModel("axon_custom");
      } catch {/* noop */}
      setReady(true);
    })();
  }, []);

  const toggle = useCallback(async (v: boolean) => {
    setEnabled(v);
    try { await AsyncStorage.setItem(WAKE_ENABLED_KEY, v ? "1" : "0"); } catch {/* noop */}
    try {
      if (v) {
        const r = await WakeWordService.start({ threshold: 0.8 });
        if (r.mode === "mock") {
          Alert.alert(
            "Wake-word in modalità TEST",
            "Il modulo nativo di ascolto continuo verrà attivato nella prossima build.\n\nPer ora puoi provare tutto il flusso premendo il pulsante 'Simula rilevamento' qui sotto: aprirà automaticamente il Axon Drive come farebbe la parola magica.",
          );
        }
      } else {
        await WakeWordService.stop();
      }
    } catch (e: any) {
      Alert.alert("Errore", e?.message || String(e));
    }
  }, []);

  const chooseModel = useCallback(async (m: "hey_jarvis" | "axon_custom") => {
    setModel(m);
    try { await AsyncStorage.setItem(WAKE_MODEL_KEY, m); } catch {/* noop */}
  }, []);

  if (!ready) return <SafeAreaView style={styles.root} edges={["top"]} />;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Wake Word &quot;Axon&quot;</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 16 }}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="mic" size={30} color="#FFF" />
          </View>
          <Text style={styles.heroTitle}>Chiama Axon senza toccare l&apos;app</Text>
          <Text style={styles.heroSub}>
            Attiva il rilevamento della parola magica: mentre guidi o hai le mani impegnate, di&apos; semplicemente &quot;Axon&quot; e l&apos;assistente si accende automaticamente.
          </Text>
        </View>

        {/* Toggle principale */}
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.rowTitle}>Attiva ascolto sempre attivo</Text>
              <Text style={styles.rowSub}>Il microfono resterà in ascolto in background solo della parola magica. Nessun altro audio viene registrato.</Text>
            </View>
            <Switch value={enabled} onValueChange={toggle} />
          </View>
          {enabled && !WakeWordService.hasNativeSupport && (
            <Pressable
              testID="wake-simulate-btn"
              onPress={() => WakeWordService.triggerMock(0.97)}
              style={styles.testBtn}
            >
              <Ionicons name="flash" size={18} color="#FFF" />
              <Text style={styles.testBtnTxt}>Simula rilevamento &quot;Axon&quot;</Text>
            </Pressable>
          )}
        </View>

        {/* Selezione modello */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Modello di rilevamento</Text>
          <Pressable style={[styles.modelRow, model === "hey_jarvis" && styles.modelActive]} onPress={() => chooseModel("hey_jarvis")}>
            <Ionicons name={model === "hey_jarvis" ? "radio-button-on" : "radio-button-off"} size={22} color={model === "hey_jarvis" ? "#EA580C" : HT.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modelName}>Hey Jarvis · pre-addestrato</Text>
              <Text style={styles.modelSub}>Modello di prova pronto all&apos;uso · OpenWakeWord</Text>
            </View>
          </Pressable>
          <Pressable style={[styles.modelRow, model === "axon_custom" && styles.modelActive]} onPress={() => chooseModel("axon_custom")}>
            <Ionicons name={model === "axon_custom" ? "radio-button-on" : "radio-button-off"} size={22} color={model === "axon_custom" ? "#EA580C" : HT.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.modelName}>Axon custom ✅</Text>
              <Text style={styles.modelSub}>Modello TemporalCNN addestrato · 154 samples · Job #253</Text>
            </View>
            <View style={styles.badgeReady}>
              <Text style={styles.badgeReadyTxt}>PRONTO</Text>
            </View>
          </Pressable>
        </View>

        {/* Status / roadmap */}
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>📋 Stato di sviluppo</Text>
          <StatusItem done label="Infrastruttura ONNX Runtime installata (onnxruntime-react-native 1.24)" />
          <StatusItem done label="Impostazioni + toggle salvataggio preferenze" />
          <StatusItem done label="Modello Axon custom addestrato e bundle nell'app (100 KB, TemporalCNN)" />
          <StatusItem label="Modulo nativo audio-streaming (Android AudioRecord + iOS AVAudioEngine)" />
          <StatusItem label="Foreground service Android per ascolto continuo" />
          <StatusItem label="Wiring: WakeWord.start() / stop() / onWake(callback) API JS" />
          <StatusItem label="Test su build reale Android + iOS" />
        </View>

        <View style={styles.hint}>
          <Ionicons name="information-circle" size={20} color="#EA580C" />
          <Text style={styles.hintTxt}>
            Ti ricorderò io quando sarà il momento di raccogliere le 20-50 registrazioni della parola &quot;Axon&quot; per il modello custom. Nel frattempo l&apos;infrastruttura è pronta a ricevere il modello.
          </Text>
        </View>

        <View style={styles.hint}>
          <Ionicons name="battery-half" size={20} color={HT.muted} />
          <Text style={styles.hintTxt}>
            Il rilevamento continuo consuma ~3-5% di batteria/ora. Quando non ti serve puoi spegnere l&apos;ascolto da questo switch e usare comunque il pulsante microfono nella chat.
          </Text>
        </View>

        {Platform.OS === "ios" && (
          <View style={styles.hint}>
            <Ionicons name="warning-outline" size={20} color="#DC2626" />
            <Text style={styles.hintTxt}>
              iOS: per l&apos;ascolto in background sarà necessario abilitare l&apos;entitlement &quot;Background Audio&quot; nel prossimo build dell&apos;app.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusItem({ done, label }: { done?: boolean; label: string }) {
  return (
    <View style={styles.statusRow}>
      <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={18} color={done ? "#16A34A" : HT.muted} />
      <Text style={[styles.statusLabel, done && { color: HT.text, fontWeight: "700" }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#0F2438',
  },
  headerTitle: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  hero: {
    backgroundColor: '#1C4869',
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  heroIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "rgba(234,88,12,0.9)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  heroTitle: { color: "#FFF", fontSize: 17, fontWeight: "900", textAlign: "center" },
  heroSub: { color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19, textAlign: "center" },
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: HT.border },
  cardTitle: { fontSize: 14, fontWeight: "900", color: HT.text, letterSpacing: 0.3 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowTitle: { fontSize: 14, fontWeight: "800", color: HT.text },
  rowSub: { fontSize: 12, color: HT.muted, lineHeight: 16 },
  modelRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: HT.border, backgroundColor: theme.color.background },
  modelActive: { borderColor: '#EA580C', backgroundColor: HT.brandTint },
  badgeReady: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#16A34A' },
  badgeReadyTxt: { color: "#FFF", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  testBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 4, paddingVertical: 12, borderRadius: 999,
    backgroundColor: '#EA580C',
    shadowColor: "#EA580C", shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  testBtnTxt: { color: "#FFF", fontWeight: "900", fontSize: 13.5, letterSpacing: 0.3 },
  modelName: { fontSize: 13.5, fontWeight: "800", color: HT.text },
  modelSub: { fontSize: 11.5, color: HT.muted, marginTop: 2 },
  statusCard: { backgroundColor: HT.card2, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: HT.border },
  statusTitle: { fontSize: 13, fontWeight: "900", color: HT.text, letterSpacing: 0.3, marginBottom: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusLabel: { fontSize: 12, color: HT.muted, flex: 1, lineHeight: 17 },
  hint: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 12, backgroundColor: HT.warningTint, borderWidth: 1, borderColor: HT.warning + '66' },
  hintTxt: { flex: 1, fontSize: 12, color: "#FDBA74", lineHeight: 17 },
});
