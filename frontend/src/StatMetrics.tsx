// V26.s — Shared clickable metric block + drill-down modal
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeBottom } from "@/src/hooks/useSafeBottom";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

export type MetricKey = "appointments_done" | "appointments_total" | "phone_done" | "contracts" | "products";
export const METRIC_LABELS: Record<MetricKey, string> = {
  appointments_done: "Appuntamenti fatti",
  appointments_total: "Totale programmati",
  phone_done: "Telefonate fatte",
  contracts: "Contratti",
  products: "Prodotti venduti",
};

export function MetricBoxClickable({ label, value, color, onPress, testID }: { label: string; value: number; color: string; onPress?: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={[styles.metric, { borderColor: color + "44" }]}>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel} numberOfLines={2}>{label}</Text>
      {onPress ? <Ionicons name="chevron-forward" size={12} color={color} style={{ position: "absolute", right: 4, top: 4 }} /> : null}
    </Pressable>
  );
}

type Item = {
  kind: "appt" | "call";
  id: string;
  title: string;
  subtitle?: string;
  when?: string;
  contact_id?: string | null;
};

export function MetricDrillModal({
  visible, onClose, metric, area, startIso, endIso, color, title,
}: {
  visible: boolean; onClose: () => void;
  metric: MetricKey | null; area: "energy" | "network" | null;
  startIso: string; endIso: string; color: string; title: string;
}) {
  const router = useRouter();
  const safeBottom = useSafeBottom();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !metric) return;
    (async () => {
      setLoading(true);
      setItems([]);
      setNote(null);
      try {
        if (metric === "appointments_done" || metric === "appointments_total" || metric === "phone_done") {
          const q: any = { start: startIso, end: endIso };
          if (area) q.area = area;
          const r = await api<{ items: any[] }>("/appointments", { query: q });
          let filtered = r.items || [];
          if (metric === "appointments_done") filtered = filtered.filter((a) => a.done);
          if (metric === "phone_done") filtered = filtered.filter((a) => a.done && a.is_phone);
          setItems(filtered.map((a) => ({
            kind: "appt",
            id: a.appointment_id,
            title: a.title,
            subtitle: [a.is_phone ? "Telefonico" : "In presenza", a.location].filter(Boolean).join(" · "),
            when: new Date(a.start_at).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
            contact_id: a.contact_id,
          })));
        } else {
          setNote("Il dettaglio è calcolato dagli esiti degli appuntamenti nel periodo. Apri gli appuntamenti effettuati per gestirli.");
        }
      } catch (e: any) {
        setNote("Errore nel caricamento: " + (e?.message || ""));
      } finally { setLoading(false); }
    })();
  }, [visible, metric, area, startIso, endIso]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: safeBottom + 12 }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headTitle}>{title}</Text>
              <Text style={styles.headSub}>{metric ? METRIC_LABELS[metric] : ""}{area ? ` · ${area === "energy" ? "Consulente Energetico" : "Networker"}` : ""}</Text>
            </View>
            <Pressable testID="drill-close" onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={theme.color.muted} /></Pressable>
          </View>
          {loading ? (
            <ActivityIndicator color={color} style={{ marginTop: 30 }} />
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
              {note ? <Text style={styles.note}>{note}</Text> : null}
              {items.length === 0 && !note ? (
                <View style={{ padding: 30, alignItems: "center" }}>
                  <Ionicons name="file-tray-outline" size={30} color={theme.color.muted} />
                  <Text style={styles.note}>Nessun elemento nel periodo selezionato</Text>
                </View>
              ) : null}
              {items.map((it) => (
                <Pressable
                  key={it.id}
                  testID={`drill-item-${it.id}`}
                  onPress={() => {
                    // Navigate FIRST, then close on next tick to avoid Modal intercepting the router push
                    if (it.kind === "appt") router.push(`/appointment/${it.id}`);
                    else if (it.contact_id) router.push(`/contact/${it.contact_id}`);
                    setTimeout(() => onClose(), 0);
                  }}
                  style={styles.itemRow}
                >
                  <View style={[styles.itemIcon, { backgroundColor: color + "22" }]}>
                    <Ionicons name={it.kind === "call" ? "call" : "calendar"} size={16} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{it.title}</Text>
                    <Text style={styles.itemSub} numberOfLines={1}>{it.when}{it.subtitle ? " · " + it.subtitle : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.color.muted} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  metric: { minWidth: 88, flexGrow: 1, flexBasis: "30%", backgroundColor: "#FFF", borderWidth: 1, borderRadius: 10, padding: 10, alignItems: "center", justifyContent: "center", position: "relative" },
  metricValue: { fontSize: 22, fontWeight: "800" },
  metricLabel: { fontSize: 10, color: theme.color.muted, marginTop: 4, textAlign: "center", lineHeight: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 32, maxHeight: "85%" },
  head: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  headTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  headSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  note: { fontSize: 12, color: theme.color.muted, textAlign: "center", padding: 20, lineHeight: 18 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  itemIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  itemSub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
});
