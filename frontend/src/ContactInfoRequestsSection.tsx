import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

/**
 * V50.z83 — Sezione "Richieste info & chat" nella scheda del contatto.
 * Mostra la cronologia delle richieste info collegate a questo cliente
 * (comprese le conversazioni Master ↔ collaboratore).
 */

type Req = {
  request_id: string;
  subject: string;
  body: string;
  status: "pending" | "resolved";
  created_by_name?: string;
  updated_at?: string;
  created_at: string;
  messages?: { text: string; at: string }[];
  unread?: boolean;
};

export function ContactInfoRequestsSection({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Req[] }>(`/contacts/${contactId}/info-requests`);
      setItems(r.items || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [contactId]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || items.length === 0) return null;

  const shown = expanded ? items : items.slice(0, 2);

  return (
    <View style={styles.wrap} testID="contact-info-requests">
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
          <Ionicons name="chatbubbles" size={16} color={theme.color.brandPrimary} />
          <Text style={styles.title}>Richieste info & chat</Text>
          <View style={styles.count}>
            <Text style={styles.countTxt}>{items.length}</Text>
          </View>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.color.muted} />
      </Pressable>

      {shown.map((r) => (
        <Pressable
          key={r.request_id}
          onPress={() => router.push(`/info-request-chat?id=${r.request_id}` as any)}
          style={[styles.card, r.unread && styles.cardUnread]}
          testID={`contact-ireq-${r.request_id}`}
        >
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {r.unread ? <View style={styles.unreadDot} /> : null}
                <Text style={styles.subject} numberOfLines={1}>{r.subject}</Text>
              </View>
              <Text style={styles.meta}>
                {r.created_by_name || "Collaboratore"} · {formatDate(r.updated_at || r.created_at)}
                {r.messages && r.messages.length > 0 ? ` · ${r.messages.length} risposte` : ""}
              </Text>
            </View>
            <View style={[styles.statusPill, r.status === "pending" ? styles.pillPending : styles.pillResolved]}>
              <Text style={styles.statusTxt}>{r.status === "pending" ? "Attesa" : "Ok"}</Text>
            </View>
          </View>
        </Pressable>
      ))}

      {!expanded && items.length > 2 ? (
        <Pressable onPress={() => setExpanded(true)} style={styles.more} testID="contact-ireq-more">
          <Text style={styles.moreTxt}>Mostra altre {items.length - 2}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, padding: 12 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  title: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface, letterSpacing: 0.3, textTransform: "uppercase" },
  count: { backgroundColor: theme.color.brandPrimary + "18", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  countTxt: { fontSize: 10, fontWeight: "800", color: theme.color.brandPrimary },
  card: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "#F8FAFC", marginTop: 6 },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: "#DC2626", backgroundColor: "#FEF2F2" },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#DC2626" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  subject: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  meta: { fontSize: 11, color: theme.color.muted, marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillPending: { backgroundColor: "#FEF3C7" },
  pillResolved: { backgroundColor: "#DCFCE7" },
  statusTxt: { fontSize: 10, fontWeight: "800", color: theme.color.onSurface, textTransform: "uppercase", letterSpacing: 0.3 },
  more: { alignItems: "center", paddingVertical: 8, marginTop: 4 },
  moreTxt: { color: theme.color.brandPrimary, fontWeight: "700", fontSize: 12 },
});
