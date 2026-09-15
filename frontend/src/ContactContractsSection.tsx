// V50.z262 — Sezione «Contratti» nella scheda cliente (deep link /contact/{id}?tab=contracts)
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { theme } from "@/src/theme";

type Contract = { contract_id: string; contract_number?: string; contract_type?: string; supplier?: string; signed_date?: string; activation_date?: string; expiry_date?: string; amount_eur?: number; status?: string; notes?: string };

const STATUS: Record<string, { t: string; c: string; bg: string }> = {
  active: { t: "Attivo", c: "#166534", bg: "#DCFCE7" },
  draft: { t: "Bozza", c: "#374151", bg: "#F3F4F6" },
  expired: { t: "Scaduto", c: "#92400E", bg: "#FEF3C7" },
  cancelled: { t: "Annullato", c: "#991B1B", bg: "#FEE2E2" },
};
const TYPE: Record<string, string> = { energy: "Energia", luce: "Luce", gas: "Gas", telco: "Telco", other: "Altro" };
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString("it-IT") : "—");

export function ContactContractsSection({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Contract[] | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Contract[] } | Contract[]>("/contracts");
      const all = Array.isArray(r) ? r : r.items || [];
      setItems(all.filter((c: any) => c.contact_id === contactId));
    } catch { setItems([]); }
  }, [contactId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <ScrollView contentContainerStyle={styles.wrap} testID="contact-contracts">
      <Pressable onPress={() => router.push(`/contract/new?contact_id=${contactId}` as any)} style={styles.addBtn} testID="contact-contract-new">
        <Ionicons name="add-circle" size={18} color="#FFF" />
        <Text style={styles.addTxt}>Nuovo contratto</Text>
      </Pressable>
      {items === null ? <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 20 }} /> : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={28} color={theme.color.muted} />
          <Text style={styles.emptyTxt}>Nessun contratto associato a questo cliente.</Text>
        </View>
      ) : items.map((c) => {
        const st = STATUS[c.status || "active"] || STATUS.active;
        return (
          <View key={c.contract_id} style={styles.card} testID={`contact-contract-${c.contract_id}`}>
            <View style={styles.row}>
              <Text style={styles.title}>{TYPE[c.contract_type || ""] || c.contract_type || "Contratto"}{c.supplier ? ` · ${c.supplier}` : ""}</Text>
              <View style={[styles.badge, { backgroundColor: st.bg }]}><Text style={[styles.badgeTxt, { color: st.c }]}>{st.t}</Text></View>
            </View>
            {c.contract_number ? <Text style={styles.meta}>N. {c.contract_number}</Text> : null}
            <Text style={styles.meta}>Firma {fmtDate(c.signed_date)} · Attivazione {fmtDate(c.activation_date)} · Scadenza {fmtDate(c.expiry_date)}</Text>
            {c.amount_eur != null ? <Text style={styles.amount}>{c.amount_eur.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</Text> : null}
            {c.notes ? <Text style={styles.notes}>{c.notes}</Text> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 12, gap: 10, paddingBottom: 40 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: theme.color.brandPrimary, borderRadius: 12, minHeight: 44 },
  addTxt: { color: "#FFF", fontWeight: "900", fontSize: 13.5 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyTxt: { color: theme.color.muted, fontSize: 13, textAlign: "center" },
  card: { backgroundColor: "#FFF", borderRadius: 12, borderWidth: 1, borderColor: theme.color.border, padding: 12, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { flex: 1, fontSize: 14.5, fontWeight: "800", color: theme.color.onSurface },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }, badgeTxt: { fontSize: 11, fontWeight: "900" },
  meta: { fontSize: 12, color: theme.color.muted }, amount: { fontSize: 15, fontWeight: "900", color: theme.color.brandPrimary, marginTop: 2 },
  notes: { fontSize: 12.5, color: theme.color.onSurfaceTertiary, marginTop: 2 },
});
