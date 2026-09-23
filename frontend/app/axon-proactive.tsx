// axon-proactive.tsx — V50.z196 — Schermata «Proattività AxonOS» (Blocco 9, modulo ISOLATO)
// Deeplink dalle notifiche push: /axon-proactive?item=<id> → mostra la comunicazione (briefing/suggerimento/alert/report)
// con le azioni rapide (tap → chat con il prompt già inviato). Trigger manuale: «Briefing ora», «Report settimana», «Controlla ora».
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useInsetsSafe } from "@/src/hooks/useSafeBottom";
import { notify } from "@/src/utils/notify";
import { proactiveApi, respondToItem, openAxonChat, ProactiveItem, KIND_ICON, KIND_COLOR } from "@/src/axonProactive";
import { HT } from "@/src/homeTheme"; // V50.z335 — Contatti dark/premium

const PURPLE = "#7C3AED";

function fmt(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Testo markdown "leggero" → righe con grassetto semplificato (evita dipendenze). */
function Plain({ text }: { text: string }) {
  return (
    <View style={{ gap: 4 }}>
      {text.split("\n").map((ln, i) => {
        const parts = ln.split(/\*\*/g);
        return (
          <Text key={i} style={styles.chatLine}>
            {parts.map((p, j) => (j % 2 === 1 ? <Text key={j} style={{ fontWeight: "800" }}>{p}</Text> : <Text key={j}>{p}</Text>))}
          </Text>
        );
      })}
    </View>
  );
}

export default function AxonProactiveScreen() {
  const router = useRouter();
  const insets = useInsetsSafe();
  const { item: itemParam } = useLocalSearchParams<{ item?: string }>();
  const [current, setCurrent] = useState<ProactiveItem | null>(null);
  const [items, setItems] = useState<ProactiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await proactiveApi.items({ limit: 40 });
      setItems(r.items || []);
      if (itemParam) {
        const it = await proactiveApi.item(String(itemParam));
        setCurrent(it);
        proactiveApi.trigger("open", "notification_tap", it.item_id).catch(() => {});
      } else if (!current && r.items?.length) {
        setCurrent(r.items[0]);
      }
    } catch (e: any) { notify("Proattività", e?.message || String(e)); } finally { setLoading(false); }
  }, [itemParam]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const run = async (action: "briefing" | "weekly_report" | "scan") => {
    setBusy(action);
    try {
      const r = await proactiveApi.trigger(action, "manual");
      if (r.item) { setCurrent(r.item); setItems((p) => [r.item as ProactiveItem, ...p.filter((x) => x.item_id !== r.item!.item_id)]); }
      else notify("AxonOS", r.reply || "Nessuna novità.");
    } catch (e: any) { notify("Proattività", e?.message || String(e)); } finally { setBusy(""); }
  };

  const color = current ? KIND_COLOR[current.kind] || PURPLE : PURPLE;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="proactive-back"><Ionicons name="arrow-back" size={22} color="#FFF" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Proattività AxonOS</Text>
          <Text style={styles.sub}>Briefing · suggerimenti · alert · report</Text>
        </View>
        <Pressable onPress={() => router.push("/axon-notifications?tab=prefs" as any)} hitSlop={10} style={styles.gear} testID="proactive-settings"><Ionicons name="options-outline" size={20} color="#FFF" /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 120, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <View style={styles.quickRow}>
          {([["briefing", "sunny", "Briefing ora"], ["weekly_report", "calendar", "Report settimana"], ["scan", "search", "Controlla ora"]] as const).map(([a, ic, lb]) => (
            <Pressable key={a} onPress={() => run(a)} disabled={!!busy} style={[styles.quick, busy === a && { opacity: 0.6 }]} testID={`proactive-run-${a}`}>
              {busy === a ? <ActivityIndicator size="small" color={PURPLE} /> : <Ionicons name={ic as any} size={18} color={PURPLE} />}
              <Text style={styles.quickTxt}>{lb}</Text>
            </Pressable>
          ))}
        </View>

        {current && (
          <View style={[styles.card, { borderColor: color + "66" }]} testID="proactive-current">
            <View style={styles.cardHead}>
              <View style={[styles.icon, { backgroundColor: color + "22" }]}><Ionicons name={(KIND_ICON[current.kind] || "sparkles") as any} size={18} color={color} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardType}>{current.type_label}</Text>
                <Text style={styles.cardMeta}>{fmt(current.created_at)}{current.source && current.source !== "scheduler" ? ` · da ${current.source}` : " · automatico"}</Text>
              </View>
            </View>
            <Plain text={current.chat_text} />
            <View style={styles.actions}>
              {(current.actions || []).map((a, i) => (
                <Pressable key={i} onPress={() => respondToItem(current, a)} style={[styles.actBtn, { backgroundColor: i === 0 ? color : "#F5F3FF" }]} testID={`proactive-action-${i}`}>
                  <Ionicons name="chatbubble-ellipses" size={14} color={i === 0 ? "#FFF" : PURPLE} />
                  <Text style={[styles.actTxt, { color: i === 0 ? "#FFF" : PURPLE }]}>{a.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => openAxonChat()} style={[styles.actBtn, styles.ghost]} testID="proactive-open-chat">
                <Ionicons name="mic-outline" size={14} color={PURPLE} /><Text style={[styles.actTxt, { color: PURPLE }]}>Rispondi a voce in chat</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={styles.secTitle}>Ultime comunicazioni</Text>
        {loading && !items.length ? <ActivityIndicator color={PURPLE} /> : items.length === 0 ? (
          <Text style={styles.empty}>AxonOS non ha ancora inviato comunicazioni proattive. Il briefing arriva ogni mattina all{"'"}orario impostato nelle Preferenze.</Text>
        ) : items.map((it) => {
          const c = KIND_COLOR[it.kind] || PURPLE;
          return (
            <Pressable key={it.item_id} onPress={() => setCurrent(it)} style={[styles.row, current?.item_id === it.item_id && { borderColor: c }]} testID={`proactive-item-${it.item_id}`}>
              <View style={[styles.icon, { backgroundColor: c + "22" }]}><Ionicons name={(KIND_ICON[it.kind] || "sparkles") as any} size={16} color={c} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{it.title}</Text>
                <Text style={styles.rowMeta}>{it.type_label} · {fmt(it.created_at)}{it.responded_at ? " · risposto" : it.dismissed_at ? " · ignorato" : ""}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={HT.muted} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F5FA' },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: PURPLE },
  title: { color: "#FFF", fontWeight: "800", fontSize: 17 },
  sub: { color: "#EDE9FE", fontSize: 12 },
  gear: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  quickRow: { flexDirection: "row", gap: 8 },
  quick: { flex: 1, backgroundColor: HT.card, borderRadius: 14, borderWidth: 1, borderColor: HT.violetTint, paddingVertical: 12, alignItems: "center", gap: 4, minHeight: 60 },
  quickTxt: { fontSize: 11.5, fontWeight: "800", color: HT.text, textAlign: "center" },
  card: { backgroundColor: HT.card, borderRadius: 16, borderWidth: 1.5, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  cardType: { fontSize: 14, fontWeight: "800", color: HT.text },
  cardMeta: { fontSize: 11.5, color: HT.muted },
  chatLine: { fontSize: 14, color: HT.text, lineHeight: 21 },
  actions: { gap: 8, marginTop: 4 },
  actBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, minHeight: 44, paddingHorizontal: 12 },
  actTxt: { fontWeight: "800", fontSize: 13 },
  ghost: { backgroundColor: HT.card, borderWidth: 1, borderColor: HT.violet + '66' },
  secTitle: { fontSize: 12, fontWeight: "800", color: HT.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  empty: { fontSize: 13, color: HT.muted, fontStyle: "italic", lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: HT.card, borderRadius: 12, borderWidth: 1, borderColor: '#EEF0F6', padding: 10, minHeight: 56 },
  rowTitle: { fontSize: 13.5, fontWeight: "700", color: HT.text },
  rowMeta: { fontSize: 11.5, color: HT.muted, marginTop: 1 },
});
