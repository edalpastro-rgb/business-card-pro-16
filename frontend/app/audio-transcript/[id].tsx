// audio-transcript/[id].tsx — V50.z389 — Pagina trascrizione (deeplink dalla notifica «Trascrizione pronta»): stessa UI del foglio globale.
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { TranscriptReviewBody } from "@/src/audio/TranscriptReviewSheet";
import { HT } from "@/src/homeTheme";

export default function AudioTranscriptScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = () => { try { router.back(); } catch { router.replace("/(tabs)/home" as any); } };
  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.head}>
        <Pressable onPress={back} hitSlop={10} testID="transcript-page-back"><Ionicons name="chevron-back" size={24} color={HT.text} /></Pressable>
        <Text style={s.title}>Trascrizione</Text>
      </View>
      <TranscriptReviewBody transcriptId={String(id)} onDone={back} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: HT.border, backgroundColor: HT.card },
  title: { fontSize: 16, fontWeight: "900", color: HT.text },
});
