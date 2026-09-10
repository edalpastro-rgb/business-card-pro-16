import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { ModuleErrorBoundary } from "@/src/shared";
import { DeadlineActionsSheet, DeadlineItem } from "@/src/DeadlineActionsSheet";

const WINDOWS = [30, 60, 90, 180];
const TYPE = { luce: { i: "flash", c: "#F59E0B" }, gas: { i: "flame", c: "#EA580C" }, telco: { i: "wifi", c: "#0891B2" } } as const;
const STATUS: Record<string, { l: string; fg: string; bg: string }> = {
  expired: { l: "Scaduta", fg: "#DC2626", bg: "#FEE2E2" },
  critical: { l: "Urgente", fg: "#B45309", bg: "#FEF3C7" },
  warning: { l: "In arrivo", fg: "#0369A1", bg: "#DBEAFE" },
  ok: { l: "OK", fg: "#16A34A", bg: "#DCFCE7" },
};

export default function DeadlinesScreen() {
  return (
    <ModuleErrorBoundary moduleName="deadlines">
      <DeadlinesInner />
    </ModuleErrorBoundary>
  );
}

function DeadlinesInner() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [days, setDays] = useState<number>(60);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // V50.z153 — Azioni per scadenza (⋯)
  const [actionItem, setActionItem] = useState<DeadlineItem | null>(null);

  const load = useCallback(async (d: number, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await api<any>("/deadlines/upcoming", { query: { days: d } });
      setItems(r?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const us = await api<any>("/user-settings");
        const win = Number(us?.deadlines_window_days) > 0 ? Number(us.deadlines_window_days) : 60;
        setDays(win);
        await load(win);
      } catch {
        await load(60);
      }
    })();
  }, [load]);

  const changeDays = async (d: number) => {
    setDays(d);
    api("/user-settings", { method: "PUT", body: { deadlines_window_days: d } }).catch(() => {});
    await load(d);
  };

  const fmtDate = (s: string) => {
    try { const [y, m, dd] = String(s).split("-"); return `${dd}/${m}/${y}`; } catch { return s; }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Scadenze</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.chipsRow}>
        {WINDOWS.map((d) => {
          const active = d === days;
          return (
            <Pressable key={d} testID={`dl-window-${d}`} onPress={() => { if (!active) changeDays(d); }} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{d}gg</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(days, true); }} />}
      >
        {loading ? (
          <View style={[styles.card, { alignItems: "center", paddingVertical: 22 }]}>
            <ActivityIndicator color={theme.color.brandPrimary} />
          </View>
        ) : items.length === 0 ? (
          <View style={[styles.card, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
            <View style={styles.okBadge}>
              <Ionicons name="checkmark" size={18} color={STATUS.ok.fg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>Tutto in ordine</Text>
              <Text style={styles.meta}>Nessun contratto in scadenza nei prossimi {days} giorni.</Text>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.count}>{items.length} {items.length === 1 ? "contratto" : "contratti"} in scadenza nei prossimi {days} giorni</Text>
            {items.map((d) => {
              const tm = (TYPE as any)[d.bill_type] || TYPE.luce;
              const sm = STATUS[d.status] || STATUS.ok;
              const c = d.contact || {};
              const label = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Contatto";
              const dl = typeof d.days_left === "number" ? d.days_left : null;
              const dlTxt = dl === null ? "" : dl < 0 ? `${Math.abs(dl)} gg fa` : dl === 0 ? "oggi" : dl === 1 ? "domani" : `tra ${dl} gg`;
              return (
                <Pressable
                  key={d.bill_id}
                  testID={`deadline-${d.bill_id}`}
                  onPress={() => c.contact_id && router.push(`/contact/${c.contact_id}?tab=bills` as any)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                >
                  <View style={[styles.icon, { backgroundColor: tm.c + "1A" }]}>
                    <Ionicons name={tm.i as any} size={16} color={tm.c} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{label}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {(d.nome_offerta || d.fornitore || "Contratto")} · scade il {fmtDate(d.expiry_date)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <View style={[styles.pill, { backgroundColor: sm.bg }]}>
                      <Text style={[styles.pillTxt, { color: sm.fg }]}>{sm.l}</Text>
                    </View>
                    {!!dlTxt && <Text style={[styles.days, { color: sm.fg }]}>{dlTxt}</Text>}
                  </View>
                  <Pressable
                    testID={`deadline-more-${d.bill_id}`}
                    onPress={() => setActionItem(d)}
                    hitSlop={8}
                    accessibilityLabel="Azioni scadenza"
                    style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={theme.color.muted} />
                  </Pressable>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
      <DeadlineActionsSheet item={actionItem} onClose={() => setActionItem(null)} onChanged={() => load(days, true)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: theme.color.surface },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  chipsRow: { flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap", paddingHorizontal: 16, paddingTop: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border },
  chipActive: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 12, fontWeight: "800", color: theme.color.onSurface },
  chipTxtActive: { color: "#FFF" },
  count: { fontSize: 12, color: theme.color.muted, marginBottom: 10, textAlign: "center" },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: theme.color.border },
  okBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: STATUS.ok.bg, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border, borderRadius: 14, padding: 12, marginBottom: 8 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  meta: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillTxt: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.2 },
  days: { fontSize: 11.5, fontWeight: "700", marginTop: 4 },
  moreBtn: { width: 32, height: 44, alignItems: "center", justifyContent: "center", marginRight: -6 },
});
