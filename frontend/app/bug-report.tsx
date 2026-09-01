/**
 * V49.j — Master page "Bug, Errori e Idee".
 *
 * Elenco di tutti i ticket di supporto del tenant. Il Master vede:
 *   • Nome/email dell'utente che ha aperto la segnalazione
 *   • Status (open · escalated · resolved) con badge colorato
 *   • Numero di tentativi
 *   • Storico completo dei messaggi utente + risposte Axon
 *   • Feedback 👍/👎 già registrati
 * Solo lettura: il Master analizza qui e agisce fuori dall'app.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { notify } from "@/src/utils/notify";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Msg = {
  from: "user" | "ai";
  text: string;
  checks?: string[];
  feedback?: "up" | "down";
  attachments?: { name: string; mime?: string; size?: number }[];
  created_at?: string;
};
type Ticket = {
  ticket_id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  status: "open" | "escalated" | "resolved";
  attempts: number;
  messages: Msg[];
  created_at?: string;
  updated_at?: string;
  escalated_at?: string;
};

const STATUS_COLOR: Record<Ticket["status"], string> = {
  open: "#64748B",
  escalated: "#EA580C",
  resolved: "#16A34A",
};
const STATUS_LABEL: Record<Ticket["status"], string> = {
  open: "Aperto",
  escalated: "Passato al Master",
  resolved: "Risolto",
};

export default function BugReportScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState({ total: 0, open: 0, escalated: 0, resolved: 0 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"all" | Ticket["status"]>("all");

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? "" : `?status=${filter}`;
      const r = await api<{ items: Ticket[]; total: number; open: number; escalated: number; resolved: number }>(
        `/support/tickets${q}`,
      );
      setItems(r.items || []);
      setCounts({ total: r.total || 0, open: r.open || 0, escalated: r.escalated || 0, resolved: r.resolved || 0 });
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare le segnalazioni");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const filters: Array<{ id: "all" | Ticket["status"]; label: string; count: number }> = useMemo(() => [
    { id: "all", label: "Tutte", count: counts.total },
    { id: "escalated", label: "Da gestire", count: counts.escalated },
    { id: "open", label: "In corso", count: counts.open },
    { id: "resolved", label: "Risolte", count: counts.resolved },
  ], [counts]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Bug, Errori e Idee</Text>
          <Text style={styles.sub}>Segnalazioni della tua rete</Text>
        </View>
        <View style={styles.headerBadge}>
          <Ionicons name="bug" size={18} color="#FFF" />
        </View>
      </View>

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFilter(f.id)}
            style={[styles.filterChip, filter === f.id && styles.filterChipActive]}
            testID={`bug-filter-${f.id}`}
          >
            <Text style={[styles.filterTxt, filter === f.id && styles.filterTxtActive]}>
              {f.label}{f.count > 0 ? ` · ${f.count}` : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={theme.color.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: pagePad }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {items.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="checkmark-done-circle" size={40} color={theme.color.muted} />
              <Text style={styles.emptyTxt}>Nessuna segnalazione</Text>
              <Text style={styles.emptySub}>Le nuove richieste degli utenti compariranno qui.</Text>
            </View>
          ) : (
            items.map((t) => {
              const isOpen = !!expanded[t.ticket_id];
              const lastUserMsg = [...t.messages].reverse().find((m) => m.from === "user");
              return (
                <View key={t.ticket_id} style={styles.card} testID={`bug-card-${t.ticket_id}`}>
                  <Pressable onPress={() => setExpanded((p) => ({ ...p, [t.ticket_id]: !p[t.ticket_id] }))} style={styles.cardHdr}>
                    <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[t.status] }]}>
                      <Text style={styles.statusTxt}>{STATUS_LABEL[t.status]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {t.user_name || t.user_email || "Utente"}
                      </Text>
                      <Text style={styles.userMeta} numberOfLines={1}>
                        {(t.user_email || "")}{t.attempts > 0 ? ` · Tentativi: ${t.attempts}` : ""}
                      </Text>
                    </View>
                    <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.color.muted} />
                  </Pressable>

                  {!isOpen ? (
                    lastUserMsg?.text ? (
                      <Text style={styles.preview} numberOfLines={2}>{lastUserMsg.text}</Text>
                    ) : null
                  ) : (
                    <View style={{ gap: 6, marginTop: 6 }}>
                      {t.messages.map((m, i) => (
                        <View key={i} style={[styles.msg, m.from === "user" ? styles.msgUser : styles.msgAi]}>
                          <Text style={styles.msgFrom}>{m.from === "user" ? "👤 Utente" : "🤖 Axon"}</Text>
                          {(m.checks && m.checks.length > 0) ? (
                            <Text style={styles.msgChecks}>Problemi: {m.checks.join(" · ")}</Text>
                          ) : null}
                          {m.text ? <Text style={styles.msgText}>{m.text}</Text> : null}
                          {(m.attachments || []).length > 0 ? (
                            <Text style={styles.msgAttach}>
                              📎 {(m.attachments || []).map((a) => a.name).join(", ")}
                            </Text>
                          ) : null}
                          {m.feedback ? (
                            <Text style={[styles.msgFb, m.feedback === "up" ? { color: "#16A34A" } : { color: "#DC2626" }]}>
                              {m.feedback === "up" ? "👍 Risolto per l'utente" : "👎 Non ha risolto"}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, backgroundColor: theme.color.surface,
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  title: { fontSize: 18, fontWeight: "900", color: theme.color.onSurface },
  sub: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  headerBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  filterRow: { flexDirection: "row", padding: 12, paddingBottom: 4, gap: 6, flexWrap: "wrap" },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#F1F5F9" },
  filterChipActive: { backgroundColor: theme.color.brandPrimary },
  filterTxt: { fontSize: 12, fontWeight: "800", color: "#64748B" },
  filterTxtActive: { color: "#FFF" },
  emptyBox: { alignItems: "center", padding: 30, gap: 6 },
  emptyTxt: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  emptySub: { fontSize: 12, color: theme.color.muted, textAlign: "center" },
  card: {
    backgroundColor: theme.color.surface, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: theme.color.border, gap: 6,
  },
  cardHdr: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusTxt: { color: "#FFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  userName: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  userMeta: { fontSize: 11, color: theme.color.muted },
  preview: { fontSize: 12, color: "#64748B", lineHeight: 17 },
  msg: { padding: 8, borderRadius: 10 },
  msgUser: { backgroundColor: "#F1F5F9" },
  msgAi: { backgroundColor: "#EDE9FE" },
  msgFrom: { fontSize: 10, fontWeight: "800", color: theme.color.muted, marginBottom: 2 },
  msgChecks: { fontSize: 11, color: "#334155", fontWeight: "700", marginBottom: 2 },
  msgText: { fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
  msgAttach: { fontSize: 11, color: theme.color.muted, marginTop: 3 },
  msgFb: { fontSize: 11, fontWeight: "800", marginTop: 4 },
});
