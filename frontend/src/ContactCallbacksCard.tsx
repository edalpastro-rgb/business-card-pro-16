// ContactCallbacksCard.tsx — V50.z495 — Scheda cliente › tab «Chiamate»: ritelefonate programmate per il contatto
// (create a mano, da Axon chat o da Axon Drive: tutte passano da db.callbacks con lo stesso schema). GET /callbacks?contact_id=…
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { HT } from "@/src/homeTheme";

type Cb = { callback_id: string; title: string; scheduled_at: string; note?: string; phone?: string | null; done?: boolean; area?: string };

const fmt = (iso: string) => {
  const d = new Date(iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z");
  return isNaN(d.getTime()) ? "" : d.toLocaleString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export function ContactCallbacksCard({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Cb[] | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Cb[] }>("/callbacks", { query: { contact_id: contactId, include_done: true } });
      setItems((r.items || []).sort((a, b) => (a.scheduled_at < b.scheduled_at ? 1 : -1)));
    } catch { setItems([]); }
  }, [contactId]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (cb: Cb) => {
    try { await api(`/callbacks/${cb.callback_id}`, { method: "PUT", body: { done: !cb.done } }); await load(); } catch { /* ignore */ }
  };
  const open = (items || []).filter((c) => !c.done);

  return (
    <View style={s.card} testID="contact-callbacks">
      <View style={s.head}>
        <View style={s.orb}><Ionicons name="alarm" size={18} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Ritelefonate programmate</Text>
          <Text style={s.sub}>{items === null ? "Carico…" : open.length === 0 ? "Nessuna ritelefonata in programma" : `${open.length} da fare`}</Text>
        </View>
        <Pressable onPress={() => router.push("/callback/new" as any)} style={s.addBtn} hitSlop={8} testID="contact-callbacks-add">
          <Ionicons name="add" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
      {items === null ? <ActivityIndicator color={HT.brand} /> : null}
      {(items || []).slice(0, 8).map((cb) => (
        <View key={cb.callback_id} style={[s.row, cb.done && { opacity: 0.55 }]} testID={`contact-cb-${cb.callback_id}`}>
          <Pressable onPress={() => void toggle(cb)} hitSlop={8} testID={`contact-cb-toggle-${cb.callback_id}`}>
            <Ionicons name={cb.done ? "checkmark-circle" : "ellipse-outline"} size={26} color={cb.done ? HT.success : HT.brand} />
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={() => router.push(`/callback/${cb.callback_id}` as any)}>
            <Text style={[s.rowTitle, cb.done && { textDecorationLine: "line-through" }]} numberOfLines={1}>{fmt(cb.scheduled_at)}</Text>
            <Text style={s.sub} numberOfLines={2}>{cb.note || cb.title || "Ritelefonata"}{cb.phone ? ` · ${cb.phone}` : ""}</Text>
          </Pressable>
          <Ionicons name="chevron-forward" size={18} color={HT.muted} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: HT.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: HT.border, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  orb: { width: 40, height: 40, borderRadius: 20, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "800", color: HT.text },
  sub: { fontSize: 12, color: HT.muted, marginTop: 2 },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: HT.brand, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: HT.border, minHeight: 56 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: HT.text },
});
