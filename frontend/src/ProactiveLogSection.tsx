// ProactiveLogSection.tsx — V50.z196 — «Comunicazioni proattive» in Profilo → Memoria AxonOS (Blocco 9, modulo ISOLATO)
// Log di ogni briefing/suggerimento/alert/report inviato da AxonOS in autonomia: tipo, data, esito push, stato (risposto/ignorato).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { proactiveApi, ProactiveItem, KIND_ICON, KIND_COLOR } from "@/src/axonProactive";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const PURPLE = "#7C3AED";

function pushLabel(s?: string | null) {
  if (s === "sent") return "push inviata";
  if (s === "blocked_by_prefs") return "push disattivata";
  return "in-app";
}

export function ProactiveLogSection() {
  const router = useRouter();
  const [items, setItems] = useState<ProactiveItem[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => { try { setItems((await proactiveApi.items({ limit: 60 })).items || []); } catch { setItems([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  const list = showAll ? items || [] : (items || []).slice(0, 8);

  return (
    <View style={styles.card} testID="memory-sec-proactive">
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name="sparkles" size={16} color={HT.violet} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Comunicazioni proattive</Text>
          <Text style={styles.intro}>Tutto quello che AxonOS ti ha detto di sua iniziativa: briefing, suggerimenti, alert e report. Soglie e orari in Notifiche AxonOS → Preferenze.</Text>
        </View>
        <Pressable onPress={() => router.push("/axon-proactive" as any)} hitSlop={8} style={styles.iconBtn} testID="proactive-log-open"><Ionicons name="open-outline" size={20} color={HT.violet} /></Pressable>
      </View>
      {!items ? <ActivityIndicator color={HT.violet} style={{ marginVertical: 8 }} /> : items.length === 0 ? (
        <Text style={styles.empty}>Nessuna comunicazione ancora. Il primo briefing arriva domattina all{"'"}orario impostato.</Text>
      ) : (
        <>
          {list.map((it) => {
            const c = KIND_COLOR[it.kind] || PURPLE;
            return (
              <Pressable key={it.item_id} onPress={() => router.push(it.deeplink as any)} style={styles.row} testID={`proactive-log-${it.item_id}`}>
                <Ionicons name={(KIND_ICON[it.kind] || "sparkles") as any} size={16} color={c} style={{ width: 22 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{it.title}</Text>
                  <Text style={styles.rowMeta}>{new Date(it.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {it.type_label} · {pushLabel(it.push_status)}{it.responded_at ? " · risposto ✓" : it.dismissed_at ? " · ignorato" : ""}</Text>
                </View>
              </Pressable>
            );
          })}
          {items.length > 8 && (
            <Pressable onPress={() => setShowAll((v) => !v)} style={styles.more} testID="proactive-log-more"><Text style={styles.moreTxt}>{showAll ? "Mostra meno" : `Mostra tutte (${items.length})`}</Text></Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 14, padding: 12, gap: 8, borderWidth: 1, borderColor: HT.violetTint },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: HT.violetTint, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  intro: { fontSize: 11.5, color: HT.muted, marginTop: 1 },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  empty: { fontSize: 12.5, color: HT.muted, fontStyle: "italic", paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: HT.card2, minHeight: 48 },
  rowTitle: { fontSize: 13, fontWeight: "700", color: HT.text },
  rowMeta: { fontSize: 11, color: HT.muted, marginTop: 1 },
  more: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 12, minHeight: 40, justifyContent: "center" },
  moreTxt: { color: HT.violet, fontWeight: "800", fontSize: 13 },
});
