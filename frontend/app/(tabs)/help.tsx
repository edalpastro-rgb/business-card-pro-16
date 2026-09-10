/**
 * V50.z141 — Tab "Help" della bottom bar.
 * Il tap sul tab apre direttamente la guida (`/libretto`, vedi listener in `(tabs)/_layout.tsx`);
 * questa schermata è il fallback raggiungibile via URL diretto e offre i tre accessi alla guida.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

export default function HelpTabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const bottomPad = usePageBottomPadding();

  const replayTour = async () => {
    try {
      await AsyncStorage.removeItem("libretto_seen_v1");
      if (user?.user_id) await AsyncStorage.removeItem(`onboarding_done_${user.user_id}`);
      api("/user-settings", { method: "PUT", body: { onboarding_done: false } }).catch(() => {});
    } catch {}
    router.push("/libretto?onboarding=1" as any);
  };

  const items: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; sub: string; onPress: () => void; testID: string }[] = [
    { icon: "book-outline", color: "#FF6B35", title: "Guida rapida", sub: "Come usare AdvisorOS, sezione per sezione", onPress: () => router.push("/libretto" as any), testID: "help-tab-guide" },
    { icon: "sparkles", color: "#7C3AED", title: "Rifai il tour guidato", sub: "Intro animata + giro guidato dell'app", onPress: replayTour, testID: "help-tab-replay" },
    { icon: "shield-checkmark-outline", color: "#0891B2", title: "Help Center", sub: "Termini assistente AI, richieste e supporto", onPress: () => router.push("/help-center" as any), testID: "help-tab-center" },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: bottomPad + 24 }}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="help-circle" size={34} color="#FFF" /></View>
        <Text style={styles.title}>Help & Guida</Text>
        <Text style={styles.sub}>Tutto quello che ti serve per usare al meglio AdvisorOS e AxonOS.</Text>
      </View>
      {items.map((it) => (
        <Pressable key={it.testID} onPress={it.onPress} style={styles.card} testID={it.testID} android_ripple={{ color: "#E5E7EB" }}>
          <View style={[styles.cardIcon, { backgroundColor: it.color }]}><Ionicons name={it.icon} size={22} color="#FFF" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{it.title}</Text>
            <Text style={styles.cardSub}>{it.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  hero: { alignItems: "center", marginBottom: 20, gap: 8 },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#FF6B35", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "900", color: theme.color.onSurface },
  sub: { fontSize: 13, color: theme.color.muted, textAlign: "center", lineHeight: 18 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFF", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.color.border, marginBottom: 10, minHeight: 64 },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  cardSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
});
