// manuale.tsx — V50.z554 — Manuale completo dell'app (mappa di ogni voce di menu/schermata/funzione) con ricerca full-text.
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { KScrollView } from "@/src/ui/keyboard";
import { HT } from "@/src/homeTheme";
import { ManualBrowser } from "@/src/ManualBrowser";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

export default function ManualeScreen() {
  const router = useRouter();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const bottomPad = usePageBottomPadding();
  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="manuale-screen">
      <View style={s.head}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/help-center" as any))} hitSlop={10} style={s.back} testID="manuale-back"><Ionicons name="chevron-back" size={22} color={HT.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Manuale completo</Text>
          <Text style={s.sub}>Ogni funzione: dove si trova, cosa fa, come si usa</Text>
        </View>
      </View>
      <KScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 24 }} keyboardShouldPersistTaps="handled">
        <ManualBrowser autoFocus={!!q} initialQuery={typeof q === "string" ? q : undefined} />
      </KScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: HT.border },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: HT.text, fontWeight: "900", fontSize: 18 },
  sub: { color: HT.muted, fontSize: 12.5 },
});
