// Corporate Gym — schermata sottosezione (Blocco 1: banner header + placeholder "in arrivo" + conteggio sessioni del tipo)
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { CgymHeaderBanner } from "@/src/corporate-gym/CgymHeaderBanner";
import { CgymTileIcon } from "@/src/corporate-gym/CgymTileIcon";
import { cgymApi, CgymType, CGYM_TYPE_META, CGYM_ORANGE } from "@/src/corporate-gym/api";

export function CgymSubsection({ type, description }: { type: CgymType; description: string }) {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const meta = CGYM_TYPE_META[type];
  const [counts, setCounts] = useState<{ todo: number; done: number } | null>(null);

  useFocusEffect(useCallback(() => {
    cgymApi.list({ scope: "mine", type })
      .then((r) => {
        const items = r.items || [];
        setCounts({ todo: items.filter((s) => s.status !== "completata").length, done: items.filter((s) => s.status === "completata").length });
      })
      .catch(() => setCounts(null));
  }, [type]));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="cgym-sub-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/corporate-gym" as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>{meta.label}</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: pagePad }}>
        <CgymHeaderBanner subtitle={meta.label} />
        <View style={styles.card} testID={`cgym-sub-${type}`}>
          <CgymTileIcon type={type} size={96} />
          <Text style={styles.cardTitle}>{meta.label}</Text>
          <Text style={styles.cardSub}>{description}</Text>
          {type === "obiezioni" ? (
            <Pressable onPress={() => router.push("/corporate-gym/roleplay" as any)} style={styles.startBtn} testID="cgym-sub-start-roleplay">
              <Ionicons name="mic" size={18} color="#FFF" />
              <View style={{ flex: 1 }}>
                <Text style={styles.startTitle}>Role-play vocale · Obiezione TEMPO</Text>
                <Text style={styles.startSub}>AxonOS fa il cliente, tu rispondi a voce. Score e feedback alla fine.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#FFF" />
            </Pressable>
          ) : (
            <View style={styles.soon} testID="cgym-sub-coming-soon">
              <Ionicons name="time-outline" size={14} color={CGYM_ORANGE} />
              <Text style={styles.soonTxt}>Allenamento interattivo in arrivo</Text>
            </View>
          )}
        </View>
        {counts && (
          <View style={styles.stats} testID="cgym-sub-stats">
            <View style={styles.stat}><Text style={styles.statNum}>{counts.todo}</Text><Text style={styles.statLbl}>da fare</Text></View>
            <View style={styles.stat}><Text style={[styles.statNum, { color: theme.color.success }]}>{counts.done}</Text><Text style={styles.statLbl}>completate</Text></View>
          </View>
        )}
        <Pressable onPress={() => router.replace("/corporate-gym" as any)} style={styles.linkBtn} testID="cgym-sub-go-sessions">
          <Ionicons name="list" size={16} color={theme.color.brandPrimary} />
          <Text style={styles.linkTxt}>Vai alle mie sessioni</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 16, borderWidth: 1, borderColor: theme.color.border, padding: 20, alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 18, fontWeight: "900", color: theme.color.onSurface },
  cardSub: { fontSize: 13, color: theme.color.muted, textAlign: "center", lineHeight: 19 },
  soon: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: CGYM_ORANGE + "22", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 6 },
  soonTxt: { color: CGYM_ORANGE, fontWeight: "800", fontSize: 12 },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: CGYM_ORANGE, borderRadius: 14, padding: 14, marginTop: 8, alignSelf: "stretch", minHeight: 56 },
  startTitle: { color: "#FFF", fontWeight: "900", fontSize: 14 },
  startSub: { color: "#FFF", opacity: 0.9, fontSize: 11, marginTop: 2 },
  stats: { flexDirection: "row", gap: 10, marginTop: 12 },
  stat: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: theme.color.border, padding: 14, alignItems: "center" },
  statNum: { fontSize: 24, fontWeight: "900", color: CGYM_ORANGE },
  statLbl: { fontSize: 12, color: theme.color.muted, fontWeight: "700" },
  linkBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16, minHeight: 44 },
  linkTxt: { color: theme.color.brandPrimary, fontWeight: "800", fontSize: 14 },
});

export default CgymSubsection;
