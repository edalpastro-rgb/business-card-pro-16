// SetupNudgeCard.tsx — V50.z211 — Avviso in chat quando Axon non può rispondere bene per configurazione mancante:
// «Completa la configurazione così la prossima volta posso esserti davvero utile» → link diretto al wizard /setup.
// Il backend inserisce la frase-chiave solo se il wizard non è completato e non ha già avvisato nelle ultime 12 h.
import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export const SETUP_NUDGE_PHRASE = "Completa la configurazione così la prossima volta posso esserti davvero utile";

export function hasSetupNudge(content?: string): boolean {
  return !!content && content.toLowerCase().includes("completa la configurazione così la prossima volta");
}

export function SetupNudgeCard({ onOpen }: { onOpen?: () => void }) {
  const router = useRouter();
  useEffect(() => { api("/axon/setup/nudge", { method: "POST" }).catch(() => {}); }, []);
  return (
    <View style={styles.card} testID="setup-nudge">
      <View style={styles.icon}><Ionicons name="rocket" size={18} color="#7C3AED" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Configurazione incompleta</Text>
        <Text style={styles.txt}>Con il wizard «Set Up and Go» AxonOS conosce te, il tuo lavoro e le tue integrazioni: bastano pochi minuti.</Text>
      </View>
      <Pressable onPress={() => { onOpen?.(); router.push("/setup" as any); }} style={styles.btn} testID="setup-nudge-open">
        <Text style={styles.btnTxt}>Apri il wizard</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 10, marginLeft: 30, marginTop: 6, backgroundColor: HT.violetTint, borderRadius: 14, borderWidth: 1, borderColor: HT.violet + '66', padding: 10 },
  icon: { width: 34, height: 34, borderRadius: 12, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 12.5, fontWeight: "800", color: HT.violet },
  txt: { fontSize: 11.5, color: HT.violet, lineHeight: 15, marginTop: 1 },
  btn: { backgroundColor: '#7C3AED', borderRadius: 999, paddingHorizontal: 12, minHeight: 40, justifyContent: "center" },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
});
