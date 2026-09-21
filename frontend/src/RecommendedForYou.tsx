// V50.z300 — Card «Consigliato per te» (Home): scorciatoie alle funzioni a cui l'utente ha detto SÌ nel Tour guidato.
// Nascosta se il tour non è stato fatto o se tutte le voci sono state chiuse (×). Tap → apre la schermata della funzione.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Rec = { id: string; name: string; group: string; route: string };

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  contacts: "people", map: "map", route: "navigate", km: "speedometer", visits: "location", calendar: "calendar", deadlines: "alarm",
  referrals: "share-social", reviews: "star", call_log: "call", bills: "receipt", compare: "swap-horizontal", pun: "trending-up", offers: "pricetags",
  scanner: "scan", files: "folder-open", pdf: "document-text", business_card: "card", chat: "chatbubbles", voice: "mic", notes: "recording",
  wake: "ear", learn: "school", proactive: "notifications", wizard: "construct", email: "mail", whatsapp: "logo-whatsapp", birthday: "gift",
  team: "people-circle", kpi: "stats-chart", gym: "barbell", import: "cloud-upload", courses: "easel", courses_dashboard: "analytics",
  forms: "clipboard", iddocs: "id-card", axon_voice: "volume-high", offline: "cloud-offline", crt: "document-attach", security: "shield-checkmark",
  custom: "color-palette", help: "help-buoy",
};

export function RecommendedForYou() {
  const router = useRouter();
  const [items, setItems] = useState<Rec[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Rec[] }>("/tour/recommendations");
      setItems(r?.items || []);
    } catch { /* silent */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dismiss = async (id: string) => {
    setItems((l) => l.filter((x) => x.id !== id));
    try { await api("/tour/recommendations/dismiss", { method: "POST", body: { feature: id } }); } catch { /* silent */ }
  };

  if (items.length === 0) return null;
  return (
    <View style={s.wrap} testID="home-recommended">
      <View style={s.head}>
        <View style={s.iconBox}><Ionicons name="sparkles" size={15} color="#FFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Consigliato per te</Text>
          <Text style={s.sub}>In base alle risposte del Tour guidato</Text>
        </View>
        <Pressable onPress={() => router.push("/tour" as any)} hitSlop={8} style={s.editBtn} accessibilityLabel="Rifai il tour" testID="home-recommended-tour">
          <Ionicons name="refresh" size={16} color="#7C3AED" />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {items.map((it) => (
          <View key={it.id} style={s.card}>
            <Pressable onPress={() => router.push(it.route as any)} style={s.cardBody} testID={`home-recommended-${it.id}`} accessibilityLabel={it.name}>
              <View style={s.cardIcon}><Ionicons name={ICONS[it.id] || "sparkles"} size={20} color="#7C3AED" /></View>
              <Text style={s.cardTxt} numberOfLines={2}>{it.name}</Text>
              <Text style={s.cardGrp} numberOfLines={1}>{it.group}</Text>
            </Pressable>
            <Pressable onPress={() => dismiss(it.id)} hitSlop={10} style={s.close} accessibilityLabel={`Nascondi ${it.name}`} testID={`home-recommended-dismiss-${it.id}`}>
              <Ionicons name="close" size={13} color={theme.color.muted} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginBottom: 12, backgroundColor: "#FFF", borderRadius: 16, borderWidth: 1, borderColor: "#E9D5FF", paddingVertical: 12, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  iconBox: { width: 30, height: 30, borderRadius: 9, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "900", color: theme.color.onSurface },
  sub: { fontSize: 11, color: theme.color.muted },
  editBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#FAF5FF" },
  row: { paddingHorizontal: 12, gap: 8 },
  card: { width: 118, minHeight: 104, borderRadius: 14, backgroundColor: "#FAF5FF", borderWidth: 1, borderColor: "#EDE9FE", position: "relative" },
  cardBody: { flex: 1, padding: 10, gap: 6, justifyContent: "flex-start" },
  cardIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFF", alignItems: "center", justifyContent: "center" },
  cardTxt: { fontSize: 12, fontWeight: "800", color: theme.color.onSurface, lineHeight: 16 },
  cardGrp: { fontSize: 10, color: theme.color.muted },
  close: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF" },
});
