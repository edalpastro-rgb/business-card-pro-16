// CriticalBanner.tsx — V50.z496 — LIVELLO 1 dell'allarme prioritario: banner rosso in cima alla Home per gli eventi critici di sistema
// (stress test notturno sotto soglia, anomalie…). Resta finché l'utente non lo chiude con la X (POST /axon/critical-events/{id}/dismiss).
// «Vedi dettagli» apre direttamente il report (route dell'evento). Aggiornato a ogni focus della Home e ogni 60 s.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";

export type CriticalEvent = { event_id: string; source: string; title: string; message: string; route?: string | null; created_at: string };

const RED = "#DC2626";
const RED_DARK = "#991B1B";

export function CriticalBanner() {
  const router = useRouter();
  const [items, setItems] = useState<CriticalEvent[]>([]);
  const load = useCallback(async () => {
    try { const r = await api<{ items: CriticalEvent[] }>("/axon/critical-events/active"); setItems(r.items || []); } catch { /* offline: tengo quello che ho */ }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  if (items.length === 0) return null;
  const ev = items[0];
  const dismiss = async () => {
    setItems((prev) => prev.filter((x) => x.event_id !== ev.event_id));
    try { await api(`/axon/critical-events/${ev.event_id}/dismiss`, { method: "POST" }); } catch { void load(); }
  };
  const open = () => { if (ev.route) router.push(ev.route as any); };
  return (
    <View style={styles.wrap} testID="critical-banner" accessibilityRole="alert">
      <View style={styles.row}>
        <View style={styles.icon}><Ionicons name="warning" size={22} color="#FFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>{ev.title}</Text>
          <Text style={styles.msg}>{ev.message}</Text>
          {items.length > 1 ? <Text style={styles.more}>+{items.length - 1} altri avvisi critici</Text> : null}
        </View>
        <Pressable onPress={dismiss} hitSlop={10} style={styles.close} testID="critical-banner-close" accessibilityLabel="Chiudi avviso">
          <Ionicons name="close" size={20} color="#FFF" />
        </Pressable>
      </View>
      {ev.route ? (
        <Pressable onPress={open} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]} testID="critical-banner-details">
          <Ionicons name="document-text" size={18} color={RED} />
          <Text style={styles.ctaTxt}>Vedi dettagli</Text>
          <Ionicons name="chevron-forward" size={18} color={RED} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 8, marginBottom: 12, backgroundColor: RED, borderRadius: 16, padding: 14, gap: 12, borderWidth: 1.5, borderColor: RED_DARK,
    ...Platform.select({ web: { boxShadow: "0 6px 20px rgba(220,38,38,0.45)" } as any, default: { shadowColor: RED, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 } }) },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: RED_DARK, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFF", fontSize: 15, fontWeight: "900", lineHeight: 20 },
  msg: { color: "#FFF", fontSize: 14, lineHeight: 20, marginTop: 4, fontWeight: "600" },
  more: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 4, fontWeight: "700" },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, borderRadius: 12, backgroundColor: "#FFF" },
  ctaTxt: { color: RED, fontWeight: "900", fontSize: 15 },
});
