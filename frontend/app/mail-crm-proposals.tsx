// V50.z22 — Mail Auto-CRM proposals: revisiona aggiornamenti anagrafica
// clienti proposti da Axon leggendo le firme delle mail in arrivo.

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { usePageBottomPadding } from "@/src/utils/bottomSheetInsets";

type Change = { from: string | null; to: string };
type Proposal = {
  proposal_id: string;
  contact_id: string;
  contact_name?: string;
  contact_email?: string;
  from_email: string;
  from_name?: string;
  subject: string;
  changes: Record<string, Change>;
  status: "pending" | "accepted" | "rejected";
  created_at?: string;
};

const FIELD_LABELS: Record<string, string> = {
  full_name: "Nome completo",
  role: "Ruolo",
  phone: "Telefono",
  mobile: "Cellulare",
  codice_fiscale: "Codice Fiscale",
  partita_iva: "Partita IVA",
  address: "Indirizzo",
  city: "Città",
  website: "Sito web",
};

export default function MailCrmProposalsScreen() {
  const router = useRouter();
  const pagePad = usePageBottomPadding();
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Proposal[] }>(`/mail/auto-crm/proposals?status=${filter}`);
      setItems(r.items || []);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile caricare");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const r = await api<{ stats: any }>("/mail/auto-crm/scan", { method: "POST", body: {} });
      const s = r.stats;
      Alert.alert("Scansione completata",
        `Scansionate: ${s.scanned}\nClienti trovati: ${s.clients_matched}\nAllegati salvati: ${s.attachments_saved}\nProposte create: ${s.proposals_created}`);
      load();
    } catch (e: any) {
      Alert.alert("Errore scan", e?.message || "");
    } finally {
      setScanning(false);
    }
  };

  const accept = async (p: Proposal) => {
    try {
      await api(`/mail/auto-crm/proposals/${p.proposal_id}/accept`, { method: "POST" });
      setItems((prev) => prev.filter((x) => x.proposal_id !== p.proposal_id));
    } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
  };
  const reject = async (p: Proposal) => {
    try {
      await api(`/mail/auto-crm/proposals/${p.proposal_id}/reject`, { method: "POST" });
      setItems((prev) => prev.filter((x) => x.proposal_id !== p.proposal_id));
    } catch (e: any) { Alert.alert("Errore", e?.message || ""); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Auto-CRM da Mail</Text>
          <Text style={styles.headerSub}>{items.length} proposte</Text>
        </View>
      </View>

      <View style={styles.scanBarWrap}>
        <Pressable onPress={runScan} disabled={scanning} style={[styles.scanBtn, scanning && { opacity: 0.6 }]}>
          {scanning ? <ActivityIndicator color="#FFF" /> : (
            <>
              <Ionicons name="scan" size={20} color="#FFF" />
              <Text style={styles.scanBtnTxt}>SCANSIONA MAIL ORA</Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={styles.filterBar}>
        <Pressable onPress={() => setFilter("pending")} style={[styles.filterChip, filter === "pending" && styles.filterChipOn]}>
          <Text style={[styles.filterTxt, filter === "pending" && styles.filterTxtOn]}>In attesa</Text>
        </Pressable>
        <Pressable onPress={() => setFilter("all")} style={[styles.filterChip, filter === "all" && styles.filterChipOn]}>
          <Text style={[styles.filterTxt, filter === "all" && styles.filterTxtOn]}>Tutte</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: Math.max(pagePad, 60), gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {loading ? (
          <View style={styles.empty}><ActivityIndicator size="large" color="#7C3AED" /></View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done" size={44} color={theme.color.muted} />
            <Text style={styles.emptyTxt}>Nessuna proposta {filter === "pending" ? "in attesa" : ""}</Text>
            <Text style={styles.emptyHint}>Tocca &quot;SCANSIONA MAIL ORA&quot; per cercare aggiornamenti da mail recenti</Text>
          </View>
        ) : items.map((p) => (
          <View key={p.proposal_id} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="person" size={22} color="#7C3AED" />
              <View style={{ flex: 1 }}>
                <Text style={styles.contactName}>{p.contact_name || p.from_email}</Text>
                <Text style={styles.mailSub}>da: {p.from_email}</Text>
                <Text style={styles.mailSub}>oggetto: {p.subject}</Text>
              </View>
            </View>
            <Text style={styles.changesTitle}>Modifiche proposte ({Object.keys(p.changes).length}):</Text>
            {Object.entries(p.changes).map(([field, delta]) => (
              <View key={field} style={styles.changeRow}>
                <Text style={styles.changeField}>{FIELD_LABELS[field] || field}</Text>
                {delta.from ? (
                  <View style={styles.diffBox}>
                    <Text style={styles.diffOld} numberOfLines={2}>{delta.from}</Text>
                    <Ionicons name="arrow-forward" size={14} color={theme.color.muted} />
                    <Text style={styles.diffNew} numberOfLines={2}>{delta.to}</Text>
                  </View>
                ) : (
                  <Text style={styles.diffNew}>+ {delta.to}</Text>
                )}
              </View>
            ))}
            {p.status === "pending" ? (
              <View style={styles.btnRow}>
                <Pressable onPress={() => reject(p)} style={styles.rejBtn}>
                  <Ionicons name="close" size={16} color="#DC2626" />
                  <Text style={styles.rejTxt}>Rifiuta</Text>
                </Pressable>
                <Pressable onPress={() => accept(p)} style={styles.accBtn}>
                  <Ionicons name="checkmark" size={16} color="#FFF" />
                  <Text style={styles.accTxt}>Applica modifiche</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.statusPill, p.status === "accepted" ? styles.statusOk : styles.statusRej]}>
                <Text style={[styles.statusTxt, p.status === "accepted" ? { color: "#065F46" } : { color: "#991B1B" }]}>
                  {p.status === "accepted" ? "✓ APPLICATA" : "✗ RIFIUTATA"}
                </Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#FFF",
    borderBottomWidth: 1, borderBottomColor: theme.color.border,
  },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  headerSub: { fontSize: 12, color: theme.color.muted, marginTop: 2 },
  scanBarWrap: { padding: 12, backgroundColor: "#FFF" },
  scanBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, borderRadius: 999, backgroundColor: "#7C3AED",
    shadowColor: "#7C3AED", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  scanBtnTxt: { color: "#FFF", fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  filterBar: {
    flexDirection: "row", gap: 8, padding: 10,
    borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: "#FFF",
  },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#F1F5F9" },
  filterChipOn: { backgroundColor: "#7C3AED" },
  filterTxt: { color: theme.color.onSurface, fontWeight: "700", fontSize: 12 },
  filterTxtOn: { color: "#FFF" },
  empty: { padding: 40, alignItems: "center", gap: 6 },
  emptyTxt: { color: theme.color.onSurface, fontSize: 15, fontWeight: "700" },
  emptyHint: { color: theme.color.muted, fontSize: 12, textAlign: "center", maxWidth: 250 },
  card: {
    padding: 12, borderRadius: 12, backgroundColor: "#FFF",
    borderWidth: 1, borderColor: theme.color.border, gap: 6,
  },
  cardHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  contactName: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  mailSub: { fontSize: 11, color: theme.color.muted, marginTop: 1 },
  changesTitle: { fontSize: 12, fontWeight: "800", color: "#7C3AED", marginTop: 6 },
  changeRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.color.border },
  changeField: { fontSize: 11, fontWeight: "700", color: theme.color.muted, marginBottom: 3 },
  diffBox: { flexDirection: "row", alignItems: "center", gap: 6 },
  diffOld: { flex: 1, fontSize: 12, color: "#991B1B", textDecorationLine: "line-through" },
  diffNew: { flex: 1, fontSize: 13, color: "#065F46", fontWeight: "700" },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  rejBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 10, borderRadius: 10, backgroundColor: "#FEE2E2",
  },
  rejTxt: { color: "#DC2626", fontWeight: "800", fontSize: 13 },
  accBtn: {
    flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 10, borderRadius: 10, backgroundColor: "#7C3AED",
  },
  accTxt: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  statusPill: { marginTop: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusOk: { backgroundColor: "#DCFCE7" },
  statusRej: { backgroundColor: "#FEE2E2" },
  statusTxt: { fontSize: 11, fontWeight: "900" },
});
