/**
 * V50.z254 — Tab "Help" della bottom bar: schermata principale con
 *   • form «Richiesta aiuto» INLINE (SupportForm: problemi comuni, testo libero, allegati, risposte AI di Axon, escalation al Master)
 *   • sezione Privacy & Termini (Termini d'uso assistente AI + richiesta cancellazione dati → /help-center)
 *   • accessi secondari al Libretto Informativo (guida rapida, tour guidato).
 * Il tab NON reindirizza più al Libretto (V50.z141 rimosso).
 */
import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";
import { SupportForm } from "@/src/SupportFab";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

export default function HelpTabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const bottomPad = usePageBottomPadding();
  const isMaster = !!user && !user.parent_user_id;

  const replayTour = async () => {
    try {
      await AsyncStorage.removeItem("libretto_seen_v1");
      if (user?.user_id) await AsyncStorage.removeItem(`onboarding_done_${user.user_id}`);
      api("/user-settings", { method: "PUT", body: { onboarding_done: false } }).catch(() => {});
    } catch {}
    router.push("/tour" as any); // V50.z257
  };

  const Card = ({ icon, color, title, sub, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; sub: string; onPress: () => void; testID: string }) => (
    <Pressable onPress={onPress} style={styles.card} testID={testID} android_ripple={{ color: "#E5E7EB" }}>
      <View style={[styles.cardIcon, { backgroundColor: color }]}><Ionicons name={icon} size={22} color="#FFF" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={HT.muted} />
    </Pressable>
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: bottomPad + 24 }} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="help-circle" size={34} color="#FFF" /></View>
        <Text style={styles.title}>Help Center</Text>
        <Text style={styles.sub}>Chiedi aiuto, segnala un problema o gestisci la tua privacy. Axon risponde subito; se serve, la richiesta passa al Master.</Text>
      </View>

      {/* Form richiesta aiuto — sempre visibile nella schermata principale */}
      <Text style={styles.sectionLabel}>RICHIESTA AIUTO</Text>
      <SupportForm inline />

      {/* Privacy & Termini */}
      <Text style={styles.sectionLabel}>PRIVACY & TERMINI</Text>
      <Card icon="shield-checkmark-outline" color="#7C3AED" title="Termini d'uso assistente AI · Privacy" sub="Leggi l'informativa e i termini dell'assistente AxonOS" onPress={() => router.push("/help-center" as any)} testID="help-tab-privacy" />
      <Card icon="trash-bin-outline" color="#DC2626" title="Richiesta cancellazione dati" sub="Invia la richiesta di cancellazione dei tuoi dati personali" onPress={() => router.push("/help-center?deletion=1" as any)} testID="help-tab-deletion" />
      {isMaster ? <Card icon="file-tray-full-outline" color="#0891B2" title="Richieste ricevute (Master)" sub="Ticket inoltrati e richieste di cancellazione da gestire" onPress={() => router.push("/help-center-admin" as any)} testID="help-tab-admin" /> : null}

      {/* Libretto informativo — accessi secondari */}
      <Text style={styles.sectionLabel}>LIBRETTO INFORMATIVO</Text>
      <Card icon="book-outline" color="#FF6B35" title="Guida rapida" sub="Come usare AdvisorOS, sezione per sezione" onPress={() => router.push("/libretto" as any)} testID="help-tab-guide" />
      <Card icon="sparkles" color="#7C3AED" title="Rifai il tour guidato" sub="Conversazione con Axon in 4 schermate" onPress={replayTour} testID="help-tab-replay" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HT.bg },
  hero: { alignItems: "center", marginBottom: 18, gap: 8 },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FF6B35', alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "900", color: HT.text },
  sub: { fontSize: 13, color: HT.muted, textAlign: "center", lineHeight: 18 },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: HT.muted, letterSpacing: 0.4, marginBottom: 8, marginTop: 6 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: HT.border, marginBottom: 10, minHeight: 64 },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "800", color: HT.text },
  cardSub: { fontSize: 12, color: HT.muted, marginTop: 2 },
});
