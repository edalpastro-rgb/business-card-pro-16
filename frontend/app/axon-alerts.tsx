// V50.z20 — AXON ALERTS: notifiche in-app per eventi Axon.
// Mostra gli avvisi (nuovi PDF pubblicati, errori sorgenti) con badge di lettura.

import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Alert as RNAlert, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Alert = {
  alert_id: string;
  type: string;
  title: string;
  message: string;
  url_id?: string;
  source_url?: string;
  pdf_url?: string;
  pdf_name?: string;
  seen: boolean;
  created_at?: string;
};

export default function AxonAlertsScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Alert[]; unread: number }>(
        `/axon-alerts?unread_only=${filter === "unread" ? "true" : "false"}&limit=100`,
      );
      setItems(r.items || []);
      setUnread(r.unread || 0);
    } catch (e: any) {
      RNAlert.alert("Errore", e?.message || "Impossibile caricare gli avvisi");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const markSeen = async (a: Alert) => {
    if (a.seen) return;
    try {
      await api(`/axon-alerts/${a.alert_id}/seen`, { method: "POST" });
      setItems((prev) => prev.map((x) => x.alert_id === a.alert_id ? { ...x, seen: true } : x));
      setUnread((n) => Math.max(0, n - 1));
    } catch { /* ignore */ }
  };

  const markAllSeen = async () => {
    try {
      await api("/axon-alerts/mark-all-seen", { method: "POST" });
      setItems((prev) => prev.map((x) => ({ ...x, seen: true })));
      setUnread(0);
    } catch (e: any) {
      RNAlert.alert("Errore", e?.message || "Impossibile aggiornare");
    }
  };

  const removeAlert = (a: Alert) => {
    RNAlert.alert("Elimina avviso", "Confermi l'eliminazione dell'avviso?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/axon-alerts/${a.alert_id}`, { method: "DELETE" });
            setItems((prev) => prev.filter((x) => x.alert_id !== a.alert_id));
            if (!a.seen) setUnread((n) => Math.max(0, n - 1));
          } catch (e: any) {
            RNAlert.alert("Errore", e?.message || "Impossibile eliminare");
          }
        },
      },
    ]);
  };

  const openAlert = async (a: Alert) => {
    await markSeen(a);
    if (a.url_id) {
      router.push("/ai-teach" as any);
    }
  };

  const iconFor = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case "new_pdf": return "document-text";
      case "error": return "alert-circle";
      default: return "sparkles";
    }
  };
  const colorFor = (type: string): string => {
    switch (type) {
      case "new_pdf": return "#0EA5E9";
      case "error": return "#DC2626";
      default: return "#7C3AED";
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Notifiche Axon</Text>
          <Text style={styles.headerSub}>{unread > 0 ? `${unread} non lette` : "Tutto letto"}</Text>
        </View>
        {unread > 0 ? (
          <Pressable onPress={markAllSeen} hitSlop={8} style={styles.markAllBtn}>
            <Ionicons name="checkmark-done" size={14} color="#7C3AED" />
            <Text style={styles.markAllTxt}>Leggi tutte</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filterBar}>
        {(["all", "unread"] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setFilter(k)}
            style={[styles.filterChip, filter === k && styles.filterChipOn]}
          >
            <Text style={[styles.filterTxt, filter === k && styles.filterTxtOn]}>
              {k === "all" ? "Tutte" : `Non lette (${unread})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.empty}><ActivityIndicator size="large" color="#7C3AED" /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-off-outline" size={48} color={theme.color.muted} />
          <Text style={styles.emptyTxt}>
            {filter === "unread" ? "Nessun avviso non letto 🎉" : "Ancora nessun avviso"}
          </Text>
          <Text style={styles.emptyHint}>
            Riceverai una notifica quando Axon rileverà un nuovo PDF pubblicato da una sorgente insegnata (es. GME, ARERA).
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.alert_id}
          contentContainerStyle={{ padding: 14, paddingBottom: pagePad, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openAlert(item)}
              onLongPress={() => removeAlert(item)}
              style={[styles.card, !item.seen && styles.cardUnread]}
              testID={`alert-${item.alert_id}`}
            >
              <View style={[styles.iconBox, { backgroundColor: `${colorFor(item.type)}22` }]}>
                <Ionicons name={iconFor(item.type)} size={20} color={colorFor(item.type)} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.cardHead}>
                  <Text style={[styles.cardTitle, !item.seen && { fontWeight: "900" }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {!item.seen ? <View style={styles.unreadDot} /> : null}
                </View>
                <Text style={styles.cardMsg} numberOfLines={2}>{item.message}</Text>
                <Text style={styles.cardMeta}>
                  {item.created_at ? new Date(item.created_at).toLocaleString("it-IT", {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  }) : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.color.muted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
    backgroundColor: "#FFF",
  },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  headerSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  markAllBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "#F5F3FF", borderWidth: 1, borderColor: "#DDD6FE",
  },
  markAllTxt: { color: "#7C3AED", fontSize: 12, fontWeight: "800" },
  filterBar: {
    flexDirection: "row", gap: 8, padding: 10,
    borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: "#FFF",
  },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "#F1F5F9",
  },
  filterChipOn: { backgroundColor: "#7C3AED" },
  filterTxt: { color: theme.color.onSurface, fontWeight: "700", fontSize: 12 },
  filterTxtOn: { color: "#FFF" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  emptyTxt: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700" },
  emptyHint: { color: theme.color.muted, fontSize: 12, textAlign: "center", lineHeight: 18, maxWidth: 260 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12,
    backgroundColor: "#FFF", borderWidth: 1, borderColor: theme.color.border,
  },
  cardUnread: { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
  iconBox: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  cardMsg: { fontSize: 13, color: "#334155", marginTop: 2, lineHeight: 17 },
  cardMeta: { fontSize: 11, color: theme.color.muted, marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#7C3AED" },
});
