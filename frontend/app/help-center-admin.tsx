// V50.z17 — HELP CENTER admin: elenca richieste di cancellazione dati.
// Master-only. Permette di marcare una richiesta come "gestita".

import { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Alert, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type DeletionRequest = {
  request_id: string;
  user_id: string;
  user_email?: string;
  user_name?: string;
  reason: string;
  status: "pending" | "handled" | "rejected";
  handled_by?: string | null;
  handled_at?: string | null;
  created_at?: string | null;
};

export default function HelpCenterAdminScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<DeletionRequest[]>([]);
  const [counts, setCounts] = useState<{ total: number; pending: number; handled: number }>({ total: 0, pending: 0, handled: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "handled">("all");

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: DeletionRequest[]; total: number; pending: number; handled: number }>(
        "/help-center/data-deletion-requests",
      );
      setItems(r.items || []);
      setCounts({ total: r.total || 0, pending: r.pending || 0, handled: r.handled || 0 });
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const markHandled = async (r: DeletionRequest) => {
    try {
      const updated = await api<DeletionRequest>(
        `/help-center/data-deletion-requests/${r.request_id}/handle`,
        { method: "POST", body: { status: "handled" } },
      );
      setItems((prev) => prev.map((x) => (x.request_id === r.request_id ? updated : x)));
      setCounts((prev) => ({ ...prev, pending: Math.max(0, prev.pending - 1), handled: prev.handled + 1 }));
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile aggiornare");
    }
  };

  const visible = items.filter((r) => filter === "all" ? true : r.status === filter);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Richieste cancellazione dati</Text>
          <Text style={styles.headerSub}>{counts.pending} in attesa · {counts.total} totali</Text>
        </View>
      </View>

      <View style={styles.filterBar}>
        {(["all", "pending", "handled"] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setFilter(k)}
            style={[styles.filterChip, filter === k && styles.filterChipOn]}
          >
            <Text style={[styles.filterTxt, filter === k && styles.filterTxtOn]}>
              {k === "all" ? "Tutte" : k === "pending" ? `In attesa (${counts.pending})` : `Gestite (${counts.handled})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.empty}><ActivityIndicator size="large" color="#7C3AED" /></View>
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-done" size={40} color={theme.color.muted} />
          <Text style={styles.emptyTxt}>Nessuna richiesta {filter === "pending" ? "in attesa" : filter === "handled" ? "gestita" : ""}</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r.request_id}
          contentContainerStyle={{ padding: 14, paddingBottom: pagePad, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardIcon}>
                  <Ionicons name="person-remove" size={18} color="#DC2626" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName} numberOfLines={1}>{item.user_name || item.user_email || item.user_id}</Text>
                  {item.user_email ? <Text style={styles.cardMail} numberOfLines={1}>{item.user_email}</Text> : null}
                </View>
                <View style={[styles.statusBadge, item.status === "pending" ? styles.statusPending : styles.statusHandled]}>
                  <Text style={[styles.statusTxt, item.status === "pending" ? { color: "#B91C1C" } : { color: "#059669" }]}>
                    {item.status === "pending" ? "IN ATTESA" : "GESTITA"}
                  </Text>
                </View>
              </View>
              {item.reason ? (
                <Text style={styles.cardReason}>{item.reason}</Text>
              ) : (
                <Text style={styles.cardReasonEmpty}>Nessun motivo indicato</Text>
              )}
              <Text style={styles.cardMeta}>
                Ricevuta: {item.created_at ? new Date(item.created_at).toLocaleString("it-IT") : "—"}
                {item.handled_at ? ` · Gestita: ${new Date(item.handled_at).toLocaleString("it-IT")}` : ""}
              </Text>
              {item.status === "pending" ? (
                <Pressable
                  onPress={() => markHandled(item)}
                  style={styles.handleBtn}
                  testID={`handle-${item.request_id}`}
                >
                  <Ionicons name="checkmark" size={16} color="#FFF" />
                  <Text style={styles.handleBtnTxt}>Marca come gestita</Text>
                </Pressable>
              ) : null}
            </View>
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
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 30 },
  emptyTxt: { color: theme.color.muted, fontSize: 13 },
  card: {
    padding: 12, borderRadius: 12, backgroundColor: "#FFF",
    borderWidth: 1, borderColor: theme.color.border, gap: 8,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIcon: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: "#FEF2F2",
    alignItems: "center", justifyContent: "center",
  },
  cardName: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  cardMail: { fontSize: 11, color: theme.color.muted, marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusPending: { backgroundColor: "#FEF2F2" },
  statusHandled: { backgroundColor: "#DCFCE7" },
  statusTxt: { fontSize: 10, fontWeight: "900", letterSpacing: 0.3 },
  cardReason: { fontSize: 13, color: "#334155", lineHeight: 18 },
  cardReasonEmpty: { fontSize: 12, color: theme.color.muted, fontStyle: "italic" },
  cardMeta: { fontSize: 11, color: theme.color.muted },
  handleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 4, paddingVertical: 10, borderRadius: 10, backgroundColor: "#7C3AED",
  },
  handleBtnTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
});
