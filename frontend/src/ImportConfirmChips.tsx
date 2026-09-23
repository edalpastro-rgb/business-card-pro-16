// ImportConfirmChips.tsx — V50.z194 — Pulsanti rapidi «Sì, memorizza» / «No grazie» sotto la domanda di AxonOS
// «Vuoi che memorizzi questi dati per uso futuro?» (modulo ISOLATO; il backend intercetta le frasi senza LLM).
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const AXON_DARK = HT.violet;
export const IMPORT_QUESTION_MARK = "memorizzi questi dati";
export const IMPORT_YES_TEXT = "Sì, memorizza i dati";
export const IMPORT_NO_TEXT = "No, non memorizzare i dati";

export function hasImportQuestion(content?: string): boolean {
  return !!content && content.toLowerCase().includes(IMPORT_QUESTION_MARK);
}

export function ImportConfirmChips({ onAnswer }: { onAnswer: (text: string) => void }) {
  return (
    <View style={styles.row} testID="import-confirm-chips">
      <Pressable onPress={() => onAnswer(IMPORT_YES_TEXT)} style={[styles.chip, styles.yes]} testID="import-confirm-yes">
        <Ionicons name="save-outline" size={15} color="#FFF" /><Text style={styles.yesTxt}>Sì, memorizza</Text>
      </Pressable>
      <Pressable onPress={() => onAnswer(IMPORT_NO_TEXT)} style={[styles.chip, styles.no]} testID="import-confirm-no">
        <Ionicons name="close" size={15} color={AXON_DARK} /><Text style={styles.noTxt}>No grazie</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingLeft: 30, marginTop: 6, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 14, minHeight: 40 },
  yes: { backgroundColor: AXON_DARK },
  no: { backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + '66' },
  yesTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  noTxt: { color: AXON_DARK, fontWeight: "800", fontSize: 13 },
});
