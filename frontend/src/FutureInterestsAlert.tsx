// src/FutureInterestsAlert.tsx — V50.z219 — Avviso di setup dedicato agli «interessi futuri» (CarPlay / Android Auto, domotica avanzata,
// assistenti vocali) attivati nel wizard: non ancora disponibili, AxonOS avvisa quando saranno pronti.
// `variant="chat"`: card in chat finché non si tocca «Ok, ricevuto» (POST /axon/setup/alerts/seen). `variant="settings"`: card sempre
// visibile finché esistono interessi futuri, con accesso a «La mia configurazione Set Up» per cambiarli.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";

type Alert = { key: string; title: string; kind: string; seen: boolean };
type Res = { alerts: Alert[]; unseen: number; future_interests: string[] };
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = { carplay: "car-sport", domotica: "home", assistenti: "mic-circle" };

export function FutureInterestsAlert({ variant = "settings", onOpen }: { variant?: "chat" | "settings"; onOpen?: () => void }) {
  const router = useRouter();
  const [res, setRes] = useState<Res | null>(null);
  const load = useCallback(() => { api<Res>("/axon/setup/alerts").then(setRes).catch(() => {}); }, []);
  useEffect(load, [load]);
  useFocusEffect(useCallback(() => { if (variant === "settings") load(); }, [variant, load]));

  if (!res || !res.alerts.length) return null;
  const items = res.alerts.filter((a) => a.kind === "future_interest");
  if (!items.length) return null;
  if (variant === "chat" && res.unseen === 0) return null;

  const ack = async () => { setRes((r) => (r ? { ...r, unseen: 0, alerts: r.alerts.map((a) => ({ ...a, seen: true })) } : r)); try { await api("/axon/setup/alerts/seen", { method: "POST" }); } catch {} };
  const manage = () => { onOpen?.(); router.push("/setup-config" as any); };

  return (
    <View style={[styles.card, variant === "chat" && styles.cardChat]} testID={`future-interests-${variant}`}>
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name="rocket" size={18} color="#C2410C" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Interessi futuri registrati</Text>
          <Text style={styles.txt}>{variant === "chat" ? "Ho segnato cosa ti interessa: non è ancora disponibile, ti avviso io appena sarà pronto. Nel frattempo non lo proporrò come funzionante." : "Non ancora disponibili: AxonOS ti avviserà appena saranno pronti. Puoi cambiarli quando vuoi."}</Text>
        </View>
      </View>
      <View style={styles.chips}>
        {items.map((a) => (
          <View key={a.key} style={styles.chip} testID={`future-interest-${a.key}`}>
            <Ionicons name={ICONS[a.key] || "sparkles"} size={13} color="#9A3412" />
            <Text style={styles.chipTxt} numberOfLines={1}>{a.title}</Text>
          </View>
        ))}
      </View>
      <View style={styles.btns}>
        {variant === "chat" && <Pressable onPress={ack} style={styles.btnPrimary} testID="future-interests-ack"><Ionicons name="checkmark" size={16} color="#FFF" /><Text style={styles.btnPrimaryTxt}>Ok, ricevuto</Text></Pressable>}
        <Pressable onPress={manage} style={styles.btnAlt} testID="future-interests-manage"><Text style={styles.btnAltTxt}>{variant === "chat" ? "Gestisci" : "Modifica nella configurazione"}</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFF7ED", borderRadius: 14, borderWidth: 1, borderColor: "#FED7AA", padding: 12, gap: 10 },
  cardChat: { marginLeft: 30, marginTop: 6 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 12, backgroundColor: "#FFEDD5", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 12.5, fontWeight: "800", color: "#7C2D12" },
  txt: { fontSize: 11.5, color: "#9A3412", lineHeight: 15, marginTop: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FFF", borderRadius: 999, paddingHorizontal: 10, minHeight: 30, borderWidth: 1, borderColor: "#FED7AA", maxWidth: "100%" },
  chipTxt: { fontSize: 11.5, fontWeight: "700", color: "#7C2D12", flexShrink: 1 },
  btns: { flexDirection: "row", gap: 8, alignItems: "center" },
  btnPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#C2410C", borderRadius: 999, paddingHorizontal: 14, minHeight: 40 },
  btnPrimaryTxt: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  btnAlt: { alignItems: "center", justifyContent: "center", minHeight: 40, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: "#FDBA74" },
  btnAltTxt: { color: "#9A3412", fontWeight: "800", fontSize: 12 },
});
