// SetupEntryCard.tsx — V50.z211/z216 — Profilo → «La mia configurazione Set Up»: completata → /setup-config (riepilogo modificabile); altrimenti → wizard.
import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

type S = { status: "not_started" | "deferred" | "in_progress" | "completed"; mode: "setup" | "full" | null; current_step: number; steps: Record<string, { done: boolean; skipped: boolean }> };

export function SetupEntryCard() {
  const router = useRouter();
  const [s, setS] = useState<S | null>(null);
  useFocusEffect(useCallback(() => { api<S>("/axon/setup/state").then(setS).catch(() => {}); }, []));

  const done = s?.steps ? Object.values(s.steps).filter((x) => x.done).length : 0;
  const label = !s ? "La mia configurazione Set Up" : s.status === "completed" ? "La mia configurazione Set Up" : s.status === "in_progress" ? `Configurazione in corso · passo ${s.current_step}` : "Completa la configurazione";
  const sub = !s ? "Set Up and Go" : s.status === "completed" ? `${s.mode === "setup" ? "Set Up and Go" : "Full and Go"} · ${done} step completati · tutti i campi modificabili, sincronizzati con AxonOS`
    : s.status === "in_progress" ? "Riprendi da dove eri rimasto" : "Pochi minuti: così AxonOS ti conosce e ti aiuta davvero";
  const ok = s?.status === "completed";

  return (
    <Pressable onPress={() => router.push((ok ? "/setup-config" : "/setup") as any)} style={[styles.card, !ok && s && styles.cardTodo]} testID="setup-entry-card">
      <View style={[styles.icon, ok && { backgroundColor: HT.successTint }]}><Ionicons name={ok ? "checkmark-done" : "rocket"} size={20} color={ok ? HT.success : HT.violet} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={HT.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.violetTint, padding: 12, minHeight: 64 },
  cardTodo: { borderColor: '#C4B5FD', backgroundColor: HT.violetTint },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2, lineHeight: 16 },
});
