// src/wizard/PrivacyNote.tsx — V50.z217 — Riga privacy visibile nel popup WOW del wizard e in fondo allo Step 4, con link alla privacy policy.
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export const PRIVACY_POLICY_ROUTE = "/privacy-policy"; // V50.z465 — schermata interna (niente browser)
export const PRIVACY_TEXT = "I tuoi dati restano nel tuo account AdvisorOS. Non vengono condivisi con terze parti, non vengono venduti e non vengono usati per addestrare modelli AI esterni. Sono accessibili solo a te e ai tuoi collaboratori autorizzati.";

export function PrivacyNote({ light = false }: { light?: boolean }) {
  const router = useRouter();
  const color = light ? "#E9D5FF" : HT.text2;
  return (
    <View style={[styles.box, light ? styles.boxLight : styles.boxDark]} testID="privacy-note">
      <Ionicons name="lock-closed" size={16} color={light ? "#FDE68A" : "#7C3AED"} style={{ marginTop: 1 }} />
      <Text style={[styles.txt, { color }]}>
        {PRIVACY_TEXT}{" "}
        <Text onPress={() => router.push(PRIVACY_POLICY_ROUTE as any)} style={[styles.link, light && { color: "#FDE68A" }]} testID="privacy-note-link" accessibilityRole="link">Leggi la privacy policy</Text>
      </Text>
    </View>
  );
}

export function PrivacyLink({ light = false }: { light?: boolean }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(PRIVACY_POLICY_ROUTE as any)} hitSlop={8} testID="privacy-link">
      <Text style={[styles.link, light && { color: "#FDE68A" }]}>Privacy policy</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, padding: 10 },
  boxLight: { backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  boxDark: { backgroundColor: HT.violetTint, borderWidth: 1, borderColor: HT.violet + '66' },
  txt: { flex: 1, fontSize: 11.5, lineHeight: 16 },
  link: { color: "#7C3AED", fontWeight: "800", textDecorationLine: "underline" },
});
