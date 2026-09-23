// ProactiveBubbles.tsx — V50.z196 — Bubble proattive di AxonOS in Home (Blocco 9, modulo ISOLATO)
// Mostra fino a 3 comunicazioni recenti non gestite (suggerimenti/alert/briefing): tap → chat con il prompt dell'azione
// (rispondi con un tap; in chat puoi rispondere anche a voce), ✕ → ignora.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { proactiveApi, respondToItem, ProactiveItem, KIND_ICON, KIND_COLOR } from "@/src/axonProactive";
import { HT } from "@/src/homeTheme"; // V50.z334 — Home dark/premium

export function ProactiveBubbles() {
  const router = useRouter();
  const [items, setItems] = useState<ProactiveItem[]>([]);
  const load = useCallback(async () => {
    try { const r = await proactiveApi.items({ home: true, limit: 6 }); setItems((r.items || []).slice(0, 3)); } catch { /* offline */ }
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, [load]);

  if (!items.length) return null;
  const dismiss = (it: ProactiveItem) => { setItems((p) => p.filter((x) => x.item_id !== it.item_id)); proactiveApi.act(it.item_id, "dismiss").catch(() => {}); };

  return (
    <View style={styles.wrap} testID="proactive-bubbles">
      <View style={styles.head}>
        <Ionicons name="sparkles" size={14} color="#7C3AED" />
        <Text style={styles.headTxt}>AxonOS ti segnala</Text>
        {/* V50.z233 — «Chiudi tutte»: svuota le card con un tap (persistente sul server) */}
        <Pressable onPress={() => { setItems([]); proactiveApi.dismissAll().catch(() => {}); }} hitSlop={8} testID="proactive-bubbles-dismiss-all" style={{ marginRight: 12 }}><Text style={[styles.link, { color: HT.muted }]}>Chiudi tutte</Text></Pressable>
        <Pressable onPress={() => router.push("/axon-proactive" as any)} hitSlop={8} testID="proactive-bubbles-all"><Text style={styles.link}>Vedi tutte</Text></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 2 }}>
        {items.map((it) => {
          const color = KIND_COLOR[it.kind] || "#7C3AED";
          return (
            <View key={it.item_id} style={[styles.bubble, { borderColor: color + "55" }]} testID={`proactive-bubble-${it.item_id}`}>
              <View style={styles.row}>
                <View style={[styles.icon, { backgroundColor: color + "22" }]}><Ionicons name={(KIND_ICON[it.kind] || "sparkles") as any} size={16} color={color} /></View>
                <Text style={styles.type}>{it.type_label}</Text>
                <Pressable onPress={() => dismiss(it)} hitSlop={10} style={styles.x} testID={`proactive-dismiss-${it.item_id}`}><Ionicons name="close" size={16} color={HT.muted} /></Pressable>
              </View>
              <Text style={styles.body} numberOfLines={3}>{it.body}</Text>
              <View style={styles.actions}>
                <Pressable onPress={() => respondToItem(it)} style={[styles.btn, { backgroundColor: color }]} testID={`proactive-respond-${it.item_id}`}>
                  <Ionicons name="chatbubble-ellipses" size={14} color="#FFF" /><Text style={styles.btnTxt}>{it.actions?.[0]?.label || "Rispondi"}</Text>
                </Pressable>
                <Pressable onPress={() => router.push(it.deeplink as any)} style={styles.btnGhost} hitSlop={6} testID={`proactive-open-${it.item_id}`}>
                  <Ionicons name="open-outline" size={16} color={color} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginTop: 8, marginBottom: 6, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  headTxt: { flex: 1, fontSize: 12, fontWeight: "800", color: HT.violet, textTransform: "uppercase", letterSpacing: 0.4 },
  link: { fontSize: 12, fontWeight: "700", color: HT.violet },
  bubble: { width: 272, backgroundColor: HT.card, borderRadius: 16, borderWidth: 1, padding: 12, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  type: { flex: 1, fontSize: 12, fontWeight: "800", color: HT.text },
  x: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  body: { fontSize: 13, color: HT.text2, lineHeight: 18 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, minHeight: 40, paddingHorizontal: 10 },
  btnTxt: { color: "#FFF", fontWeight: "800", fontSize: 12.5 },
  btnGhost: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: HT.borderStrong, alignItems: "center", justifyContent: "center" },
});
