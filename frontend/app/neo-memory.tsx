import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Memory = {
  memory_id: string;
  summary: string;
  facts: string[];
  created_at: string;
  session_id?: string;
};

const NEO_COLOR = "#8B5CF6";
const NEO_COLOR_DARK = "#6D28D9";

/**
 * V38T — Neo persistent memory management screen. Lists all memories
 * distilled from previous conversations and lets the user delete them
 * individually or all at once.
 */
export default function NeoMemoryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ items: Memory[]; total: number }>("/assistant/memory");
      setItems(r.items || []);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare la memoria");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirmDeleteOne = (mem: Memory) => {
    const doDelete = async () => {
      setBusy(mem.memory_id);
      try {
        await api(`/assistant/memory/${mem.memory_id}`, { method: "DELETE" });
        setItems((prev) => prev.filter((m) => m.memory_id !== mem.memory_id));
      } catch (e: any) {
        Alert.alert("Errore", e?.message || "");
      } finally {
        setBusy(null);
      }
    };
    if (Platform.OS === "web") {
      if ((globalThis as any).confirm(`Cancellare questa memoria?\n\n"${mem.summary}"`)) void doDelete();
    } else {
      Alert.alert("Cancellare memoria?", mem.summary, [
        { text: "Annulla", style: "cancel" },
        { text: "Cancella", style: "destructive", onPress: () => void doDelete() },
      ]);
    }
  };

  const confirmClearAll = () => {
    const doClear = async () => {
      setClearing(true);
      try {
        const r = await api<{ deleted_count: number }>("/assistant/memory", { method: "DELETE" });
        setItems([]);
        Alert.alert("Memoria cancellata", `Sono state eliminate ${r.deleted_count} voci.`);
      } catch (e: any) {
        Alert.alert("Errore", e?.message || "");
      } finally {
        setClearing(false);
      }
    };
    if (Platform.OS === "web") {
      if ((globalThis as any).confirm("Cancellare TUTTA la memoria di Neo? Questa azione non può essere annullata.")) void doClear();
    } else {
      Alert.alert(
        "Cancellare tutta la memoria?",
        "Neo dimenticherà tutte le conversazioni precedenti. Questa azione non può essere annullata.",
        [
          { text: "Annulla", style: "cancel" },
          { text: "Cancella tutto", style: "destructive", onPress: () => void doClear() },
        ]
      );
    }
  };

  const fmt = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F8FAFC" }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="neo-memory-back" hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color="#FFF" />
        </Pressable>
        <Text style={styles.title}>Memoria di Neo</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="sparkles" size={22} color={NEO_COLOR} />
          <Text style={styles.infoTxt}>
            Neo ricorda automaticamente le tue conversazioni per personalizzare le risposte future.
            Puoi consultare o cancellare i ricordi in qualsiasi momento.
          </Text>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={NEO_COLOR} size="large" />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="cloud-offline" size={48} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>Nessuna memoria salvata</Text>
            <Text style={styles.emptySub}>Le conversazioni significative verranno distillate qui.</Text>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text style={styles.count}>{items.length} {items.length === 1 ? "memoria" : "memorie"}</Text>
              <Pressable
                testID="neo-memory-clear-all"
                onPress={confirmClearAll}
                disabled={clearing}
                style={styles.clearBtn}
              >
                {clearing ? <ActivityIndicator size="small" color="#DC2626" /> : (
                  <>
                    <Ionicons name="trash" size={14} color="#DC2626" />
                    <Text style={styles.clearBtnTxt}>Cancella tutto</Text>
                  </>
                )}
              </Pressable>
            </View>

            {items.map((m) => (
              <View key={m.memory_id} style={styles.memCard}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.memSummary}>{m.summary || "(nessun riassunto)"}</Text>
                    <Text style={styles.memDate}>{fmt(m.created_at)}</Text>
                  </View>
                  <Pressable
                    testID={`neo-memory-del-${m.memory_id}`}
                    onPress={() => confirmDeleteOne(m)}
                    disabled={busy === m.memory_id}
                    hitSlop={8}
                    style={styles.delBtn}
                  >
                    {busy === m.memory_id ? (
                      <ActivityIndicator size="small" color="#DC2626" />
                    ) : (
                      <Ionicons name="trash-outline" size={16} color="#DC2626" />
                    )}
                  </Pressable>
                </View>
                {m.facts?.length > 0 && (
                  <View style={styles.factList}>
                    {m.facts.map((f, i) => (
                      <View key={i} style={styles.factRow}>
                        <View style={styles.factDot} />
                        <Text style={styles.factTxt}>{f}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: NEO_COLOR,
  },
  title: { color: "#FFF", fontSize: 17, fontWeight: "800", flex: 1, textAlign: "center" },
  content: { padding: 16, gap: 8, paddingBottom: 32 },
  infoCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    alignItems: "flex-start",
  },
  infoTxt: { flex: 1, fontSize: 12, color: NEO_COLOR_DARK, lineHeight: 17 },
  emptyBox: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 8,
  },
  emptyTxt: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  emptySub: { fontSize: 12, color: theme.color.muted, textAlign: "center", paddingHorizontal: 24 },
  count: { fontSize: 12, fontWeight: "700", color: theme.color.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FEE2E2",
    borderColor: "#FCA5A5",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  clearBtnTxt: { fontSize: 12, color: "#DC2626", fontWeight: "800" },
  memCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.color.border,
    marginTop: 8,
  },
  memSummary: { fontSize: 14, color: theme.color.onSurface, fontWeight: "700", lineHeight: 19 },
  memDate: { fontSize: 11, color: theme.color.muted, marginTop: 4 },
  delBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  factList: { marginTop: 10, gap: 4 },
  factRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  factDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: NEO_COLOR, marginTop: 7 },
  factTxt: { flex: 1, fontSize: 12, color: theme.color.onSurface, lineHeight: 17 },
});
