import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { HT } from "@/src/homeTheme";

/** V50.z343 — Axon Lab · intestazione comune (back · titolo · sottotitolo · azione facoltativa). */
export function LabHeader({ title, sub, right, testID }: { title: string; sub?: string; right?: React.ReactNode; testID?: string }) {
  const router = useRouter();
  return (
    <View style={s.header} testID={testID}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={s.hBtn} testID="lab-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="flask" size={16} color={HT.axon} />
          <Text style={s.title} numberOfLines={1}>{title}</Text>
        </View>
        {sub ? <Text style={s.sub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  hBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "900", color: HT.text },
  sub: { fontSize: 12, color: HT.muted },
});

export const labStyles = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, borderColor: HT.border, padding: 14, gap: 8 },
  cardTitle: { color: HT.text, fontWeight: "900", fontSize: 15 },
  cardSub: { color: HT.muted, fontSize: 12.5, lineHeight: 17 },
  btn: { minHeight: 46, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16 },
  btnPrimary: { backgroundColor: HT.axon },
  btnBrand: { backgroundColor: HT.brand },
  btnGhost: { backgroundColor: HT.card2, borderWidth: 1, borderColor: HT.border },
  btnTxt: { fontWeight: "900", fontSize: 13.5, color: HT.white },
  input: { backgroundColor: HT.card2, color: HT.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: HT.border, minHeight: 44 },
  areaBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  areaBadgeTxt: { fontSize: 10.5, fontWeight: "900", letterSpacing: 0.6 },
  sectionTitle: { color: HT.text, fontWeight: "900", fontSize: 16, marginTop: 4 },
  muted: { color: HT.muted, fontSize: 12 },
});
